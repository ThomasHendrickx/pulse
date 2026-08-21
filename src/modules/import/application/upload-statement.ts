// Upload use case: file in, and either a finished idempotent ingest (both
// the profile and the account are already known, so nothing is asked,
// criterion 1.5), a declaration request (unknown account or profile, asked
// once, at first sight, against parsed data), or a loud failure that wrote
// no rows. Parsing itself is pure and in memory; the only writes are the
// Import row and, on the known-source path, the ingest.

import type { HouseholdContext } from "@/platform/tenancy";
import { assignDedupKeys, zipRowsWithDedupKeys } from "../domain/dedup";
import type { ParsedStatement } from "../domain/parse-statement";
import { specEquals, type SourceProfileSpec } from "../domain/source-profile";
import type {
  ImportDependencies,
  ImportFailureReason,
  StatementDetectError,
  StatementParseFailure,
  StoredProfile,
} from "./ports";

// Machine reasons for the FAILED import row, mapped from the parser's
// error unions in ONE place so the upload and confirm paths cannot
// disagree about what a failure is called (D-5).
export const failureReasonForDetectError = (
  error: StatementDetectError,
): ImportFailureReason =>
  error.kind === "layout-unsupported"
    ? "layout-unsupported"
    : error.kind === "pdf-extraction-failed"
      ? "extraction-failed"
      : "undetectable";

export const failureReasonForParseError = (
  error: StatementParseFailure,
): ImportFailureReason =>
  error.kind === "balance-mismatch"
    ? "balance-mismatch"
    : error.kind === "pdf-extraction-failed"
      ? "extraction-failed"
      : error.kind === "template-version-mismatch"
        ? "layout-version-mismatch"
        : "unparseable";

export type UploadOutcome =
  | { readonly kind: "ingested"; readonly importId: string; readonly added: number; readonly known: number }
  | { readonly kind: "awaiting-declaration"; readonly importId: string }
  | { readonly kind: "failed"; readonly importId: string; readonly reason: ImportFailureReason };

export const uploadStatement = async (
  context: HouseholdContext,
  deps: ImportDependencies,
  input: { readonly fileName: string; readonly bytes: Uint8Array },
): Promise<UploadOutcome> => {
  const failed = async (reason: ImportFailureReason): Promise<UploadOutcome> => {
    const record = await deps.imports.createImport(context, {
      fileName: input.fileName,
      rawContent: input.bytes,
      status: "FAILED",
      failureReason: reason,
    });
    return { kind: "failed", importId: record.id, reason };
  };

  const detected = await deps.parser.detect(input.bytes);
  if (!detected.ok) {
    return failed(failureReasonForDetectError(detected.error));
  }
  const parsed = await deps.parser.parse(input.bytes, detected.value);
  if (!parsed.ok) {
    // The balance contract is enforced inside the parse (D-6): a
    // recognised statement that does not reconcile lands HERE, before
    // any declaration question, with zero rows written (criterion 2.2).
    return failed(failureReasonForParseError(parsed.error));
  }

  // One file is one account. More than one own-account identifier fails
  // the ENTIRE import with zero rows written (hazard H1.2): the FAILED
  // import row is the only write on this path.
  if (parsed.value.accountIbans.length > 1) {
    return failed("mixed-accounts");
  }

  const profiles = await deps.imports.listProfiles(context);
  const profile = profiles.find((candidate) =>
    specEquals(candidate.spec, detected.value),
  );
  // Fix round 1 (HZ-002): a stored pdf-layout profile for the SAME
  // template at a DIFFERENT version means this build's template code is
  // not the code the stored declaration recorded. Re-asking the ask-once
  // declaration here would silently create a twin profile and re-parse
  // history under new rules; instead the upload fails closed and loud
  // until a deliberate migration lands (procedure at pdf-template.ts).
  if (profile === undefined && detected.value.kind === "pdf-layout") {
    const detectedSpec = detected.value;
    const staleVersionTwin = profiles.find(
      (candidate) =>
        candidate.spec.kind === "pdf-layout" &&
        candidate.spec.templateId === detectedSpec.templateId &&
        candidate.spec.templateVersion !== detectedSpec.templateVersion,
    );
    if (staleVersionTwin !== undefined) {
      return failed("layout-version-mismatch");
    }
  }
  const account = await resolveAccount(context, deps, parsed.value, profile);

  if (profile === undefined || account === undefined) {
    const record = await deps.imports.createImport(context, {
      fileName: input.fileName,
      rawContent: input.bytes,
      status: "AWAITING_DECLARATION",
    });
    return { kind: "awaiting-declaration", importId: record.id };
  }

  const record = await deps.imports.createImport(context, {
    fileName: input.fileName,
    rawContent: input.bytes,
    status: "PARSED",
    accountId: account,
    sourceProfileId: profile.id,
  });
  const keys = assignDedupKeys(account, parsed.value.rows, detected.value);
  const ingested = await deps.imports.ingestRows(context, {
    importId: record.id,
    accountId: account,
    sourceProfileId: profile.id,
    // The import row was created as PARSED two statements ago in this
    // same request; a failed claim here is a BUG, so it throws (finding
    // F4 gives ingestRows its conditional claim, and expected losers
    // exist only on the confirm path).
    fromStatus: "PARSED",
    // zipRowsWithDedupKeys THROWS on a row/key desync (finding F7): a
    // softened empty key would be silent multi-row loss.
    rows: zipRowsWithDedupKeys(parsed.value.rows, keys),
  });
  if (!ingested.ok) {
    throw new Error(
      `Freshly created import ${record.id} could not be claimed for ingest`,
    );
  }
  await deps.interpret(context, record.id);
  return {
    kind: "ingested",
    importId: record.id,
    added: ingested.added,
    known: ingested.known,
  };
};

export const findProfileBySpec = async (
  context: HouseholdContext,
  deps: ImportDependencies,
  spec: SourceProfileSpec,
): Promise<StoredProfile | undefined> => {
  const profiles = await deps.imports.listProfiles(context);
  return profiles.find((candidate) => specEquals(candidate.spec, spec));
};

// Account identity is resolved FROM THE FILE where the profile carries an
// own-account column; card-shaped files carry none, so the account rides
// the confirmed profile's binding.
const resolveAccount = async (
  context: HouseholdContext,
  deps: ImportDependencies,
  parsed: ParsedStatement,
  profile: StoredProfile | undefined,
): Promise<string | undefined> => {
  const iban = parsed.accountIbans[0];
  if (iban !== undefined) {
    const account = await deps.accounts.findAccountByIban(context, iban);
    return account?.id;
  }
  return profile?.accountId;
};
