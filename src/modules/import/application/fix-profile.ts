// The profile-fix re-parse (pulse-v1-architecture.md section 2, hazard
// H1.3 continued as H2.5, criterion 2.7). A SourceProfile is the one
// declaration that shapes FACTS: a wrong amount representation writes
// inverted or unsigned amounts into the ledger and no recompute fixes
// that. Every transaction keeps its verbatim rawLine and every Import
// keeps its rawContent, so the repair is a RE-PARSE: no re-upload,
// corrected amounts, row identity preserved, no declaration lost.
// Re-parse (rebuilds facts) and recompute (rebuilds interpretation) are
// different operations; this use case runs the first and then triggers
// the second for every affected import.
//
// KEY RECOMPUTATION (finding CR-302, corrected in fix round 1 and stated
// loudly per R-087): an earlier version re-ran assignDedupKeys over each
// import's STORED SUBSET and claimed any deterministic row order yields
// the same key set as a fresh parse of the file. That claim was FALSE
// whenever an import stored a proper subset of its file's rows: with two
// overlapping card exports sharing a keyless identical twin (the
// fixture-observed real shape), the subset ordinal renumbered a stored
// twin onto a key an earlier import already holds, and the per-household
// unique index aborted the repair, permanently denying the H2.5 path.
// Keys are now derived from the FULL re-parse of each import's
// rawContent, simulating ingest's cross-import insert-ignore in import
// order: a stored row takes the file occurrence's key that ingest would
// have stored it under, so an unchanged-spec re-parse is a strict no-op
// and a corrected-spec re-parse converges, with re-uploads adding zero.

import type { HouseholdContext } from "@/platform/tenancy";
import { err, ok, type Result } from "@/platform/result";
import {
  assignDedupKeys,
  compareDedupKeys,
  nextFreeDedupKey,
} from "../domain/dedup";
import type { ParsedRow } from "../domain/parse-statement";
import type { SourceProfileSpec } from "../domain/source-profile";
import type { ImportDependencies } from "./ports";

export type FixProfileError =
  | { readonly kind: "profile-not-found" }
  | {
      // A raw line of an affected import does not parse under the
      // corrected spec: the correction is wrong (or the file needs a
      // different profile), so NOTHING is rewritten and the facts stand
      // as they were. transactionId is present when the failing line is
      // one the import stored (an ingest-skipped duplicate line has no
      // stored row).
      readonly kind: "row-unparseable";
      readonly importId: string;
      readonly transactionId?: string;
      readonly problem:
        | "date"
        | "amount"
        | "missing-column"
        | "indicator"
        | "empty-file"
        // The PDF-path failures: a corrected spec whose re-parse breaks
        // the balance identity, a structural mismatch against the layout
        // template, a spec naming a template or template version this
        // build lacks (HZ-002: a version bump fails stored re-parses
        // closed), or bytes the extractor no longer reads. All rewrite
        // NOTHING, like every other member of this union.
        | "balance-mismatch"
        | "pdf-structure"
        | "unknown-template"
        | "template-version-mismatch"
        | "extraction-failed";
    };

export type FixProfileResult = {
  readonly importsReparsed: number;
  readonly rowsReparsed: number;
};

type ReparseRow = ParsedRow & {
  readonly transactionId: string;
  readonly dedupKey: string;
};

type FactRow = {
  readonly id: string;
  readonly accountId: string;
  readonly rawLine: string;
  readonly dedupKey: string;
};

export const fixSourceProfile = async (
  context: HouseholdContext,
  deps: ImportDependencies,
  input: { readonly profileId: string; readonly spec: SourceProfileSpec },
): Promise<Result<FixProfileResult, FixProfileError>> => {
  const profile = await deps.imports.getProfile(context, input.profileId);
  if (profile === null) {
    return err({ kind: "profile-not-found" as const });
  }

  // Imports are processed in ingest (creation) order, and assignedKeys
  // accumulates across them: that is what reproduces the cross-import
  // insert-ignore end state ingest produced (or would produce under the
  // corrected spec).
  const importIds = await deps.imports.listImportIdsForProfile(
    context,
    input.profileId,
  );
  const assignedKeys = new Set<string>();

  const reparsedImports: { importId: string; rows: ReparseRow[] }[] = [];
  let rowsReparsed = 0;

  for (const importId of importIds) {
    const factRows = await deps.imports.listFactRowsForImport(context, importId);
    if (factRows.length === 0) {
      continue;
    }
    // One file is one account: every fact row of an import carries the
    // same account. A mix here is a corrupted ledger, not an expected
    // failure.
    const accountId = factRows[0]?.accountId;
    if (
      accountId === undefined ||
      factRows.some((row) => row.accountId !== accountId)
    ) {
      throw new Error(`Import ${importId} carries rows from more than one account`);
    }

    const record = await deps.imports.getImport(context, importId);
    if (record === null) {
      throw new Error(`Import ${importId} vanished during re-parse`);
    }
    const parsedFile = await deps.parser.parse(record.rawContent, input.spec);
    if (!parsedFile.ok) {
      const parseError = parsedFile.error;
      if (parseError.kind === "row-error") {
        const failingLine = parseError.rawLine;
        const storedMatch = factRows.find((row) => row.rawLine === failingLine);
        return err({
          kind: "row-unparseable" as const,
          importId,
          ...(storedMatch === undefined ? {} : { transactionId: storedMatch.id }),
          problem: parseError.problem,
        });
      }
      // File-level failures (empty file, PDF structure, an unknown
      // template, a broken balance identity) have no single failing line
      // to name; the repair is refused whole, nothing rewritten.
      return err({
        kind: "row-unparseable" as const,
        importId,
        problem:
          parseError.kind === "pdf-structure"
            ? ("pdf-structure" as const)
            : parseError.kind === "pdf-extraction-failed"
              ? ("extraction-failed" as const)
              : parseError.kind,
      });
    }
    const fileRows = parsedFile.value.rows;
    const fileKeys = assignDedupKeys(accountId, fileRows, input.spec);

    // File occurrences grouped by rawLine, in file order.
    const fileIndicesByRawLine = new Map<string, number[]>();
    fileRows.forEach((row, index) => {
      const indices = fileIndicesByRawLine.get(row.rawLine);
      if (indices === undefined) {
        fileIndicesByRawLine.set(row.rawLine, [index]);
      } else {
        indices.push(index);
      }
    });

    // Stored rows grouped by rawLine, twins ranked by their existing key
    // (numeric-aware, so ten-plus twins keep their order); rows in one
    // group are content-identical by construction, so the allocation
    // among them only needs to be deterministic.
    const storedByRawLine = new Map<string, FactRow[]>();
    for (const factRow of factRows) {
      const group = storedByRawLine.get(factRow.rawLine);
      if (group === undefined) {
        storedByRawLine.set(factRow.rawLine, [factRow]);
      } else {
        group.push(factRow);
      }
    }

    const rows: ReparseRow[] = [];
    for (const [rawLine, group] of storedByRawLine) {
      group.sort(
        (a, b) =>
          compareDedupKeys(a.dedupKey, b.dedupKey) ||
          (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
      );
      const candidateIndices = fileIndicesByRawLine.get(rawLine);
      if (candidateIndices === undefined) {
        throw new Error(
          `Import ${importId} stores a row whose rawLine is not in its stored file`,
        );
      }
      let cursor = 0;
      for (const storedRow of group) {
        // The earliest unconsumed file occurrence whose key is not held
        // by an earlier-processed row: consumed-but-taken occurrences are
        // exactly the lines ingest skipped as cross-import duplicates.
        let chosenIndex: number | undefined;
        let chosenKey: string | undefined;
        while (cursor < candidateIndices.length) {
          const fileIndex = candidateIndices[cursor];
          cursor += 1;
          const key = fileIndex === undefined ? undefined : fileKeys[fileIndex];
          if (fileIndex !== undefined && key !== undefined && !assignedKeys.has(key)) {
            chosenIndex = fileIndex;
            chosenKey = key;
            break;
          }
        }
        if (chosenIndex === undefined || chosenKey === undefined) {
          // Every occurrence's key is held elsewhere: the corrected spec
          // merged previously distinct tuples. The row keeps the group's
          // parse and takes the tuple's next free ordinal, which is the
          // insert-ignore end state one row further on.
          const firstIndex = candidateIndices[0];
          const baseKey = firstIndex === undefined ? undefined : fileKeys[firstIndex];
          if (firstIndex === undefined || baseKey === undefined) {
            throw new Error(
              `Import ${importId} has no file occurrence for a stored rawLine`,
            );
          }
          chosenIndex = firstIndex;
          chosenKey = nextFreeDedupKey(baseKey, (key) => assignedKeys.has(key));
        }
        assignedKeys.add(chosenKey);
        const fileRow = fileRows[chosenIndex];
        if (fileRow === undefined) {
          throw new Error(`Import ${importId} re-parse lost a file row`);
        }
        rows.push({ ...fileRow, transactionId: storedRow.id, dedupKey: chosenKey });
      }
    }

    reparsedImports.push({ importId, rows });
    rowsReparsed += rows.length;
  }

  await deps.imports.applyReparse(context, {
    profileId: input.profileId,
    spec: input.spec,
    imports: reparsedImports,
  });

  // The facts changed, so the interpretation over each affected window is
  // stale: rebuild it (the recompute half of the repair). applyReparse
  // already moved the affected imports back to INGESTED in the same
  // transaction as the facts (finding CR-304), so a death here leaves the
  // visible needs-interpretation marker and the next interpretation run
  // is the recovery.
  for (const entry of reparsedImports) {
    await deps.interpret(context, entry.importId);
  }

  return ok({ importsReparsed: reparsedImports.length, rowsReparsed });
};
