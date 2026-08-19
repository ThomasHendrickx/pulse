// The profile-fix re-parse (pulse-v1-architecture.md section 2, hazard
// H1.3 continued as H2.5, criterion 2.7). A SourceProfile is the one
// declaration that shapes FACTS: a wrong amount representation writes
// inverted or unsigned amounts into the ledger and no recompute fixes
// that. Every transaction keeps its verbatim rawLine, so the repair is a
// RE-PARSE from stored raw lines: no re-upload, no lost declarations, row
// identity preserved. Re-parse (rebuilds facts) and recompute (rebuilds
// interpretation) are different operations; this use case runs the first
// and then triggers the second for every affected import.

import type { HouseholdContext } from "@/platform/tenancy";
import { err, ok, type Result } from "@/platform/result";
import { assignDedupKeys } from "../domain/dedup";
import { parseStatementRow, type ParsedRow } from "../domain/parse-statement";
import type { SourceProfileSpec } from "../domain/source-profile";
import type { ImportDependencies } from "./ports";

export type FixProfileError =
  | { readonly kind: "profile-not-found" }
  | {
      // A stored raw line does not parse under the corrected spec: the
      // correction is wrong (or the line needs a different profile), so
      // NOTHING is rewritten and the facts stand as they were.
      readonly kind: "row-unparseable";
      readonly importId: string;
      readonly transactionId: string;
      readonly problem: "date" | "amount" | "missing-column" | "indicator";
    };

export type FixProfileResult = {
  readonly importsReparsed: number;
  readonly rowsReparsed: number;
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

  const importIds = await deps.imports.listImportIdsForProfile(
    context,
    input.profileId,
  );

  const reparsedImports: {
    importId: string;
    rows: (ParsedRow & { transactionId: string; dedupKey: string })[];
  }[] = [];
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
    if (accountId === undefined || factRows.some((row) => row.accountId !== accountId)) {
      throw new Error(`Import ${importId} carries rows from more than one account`);
    }

    const parsedRows: ParsedRow[] = [];
    for (const factRow of factRows) {
      const parsed = parseStatementRow(factRow.rawLine, input.spec);
      if (!parsed.ok) {
        return err({
          kind: "row-unparseable" as const,
          importId,
          transactionId: factRow.id,
          problem: parsed.error,
        });
      }
      parsedRows.push(parsed.value);
    }

    // Dedup keys are recomputed over the corrected rows with the same key
    // recipe ingest uses, so a later re-upload of the same file maps every
    // row onto its rebuilt twin and adds nothing. The ordinal among
    // identical rows counts duplicates, so any deterministic row order
    // yields the same key SET as a fresh parse of the file.
    const keys = assignDedupKeys(accountId, parsedRows, input.spec);
    reparsedImports.push({
      importId,
      rows: parsedRows.map((row, index) => ({
        ...row,
        transactionId: factRows[index]?.id ?? "",
        dedupKey: keys[index] ?? "",
      })),
    });
    rowsReparsed += parsedRows.length;
  }

  await deps.imports.applyReparse(context, {
    profileId: input.profileId,
    spec: input.spec,
    imports: reparsedImports,
  });

  // The facts changed, so the interpretation over each affected window is
  // stale: rebuild it (recompute half of the repair).
  for (const entry of reparsedImports) {
    await deps.interpret(context, entry.importId);
  }

  return ok({ importsReparsed: reparsedImports.length, rowsReparsed });
};
