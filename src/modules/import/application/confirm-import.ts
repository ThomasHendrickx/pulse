// Confirm use case: the user has seen the detected profile over the
// five-row preview, named it, fixed it if needed, and declared the account
// if it was unknown. Only now does anything reach the ledger. The
// mixed-account check runs again against the CONFIRMED spec, because a
// spec fix can change which column is the account column.

import type { HouseholdContext } from "@/platform/tenancy";
import { assignDedupKeys, zipRowsWithDedupKeys } from "../domain/dedup";
import type { SourceProfileSpec } from "../domain/source-profile";
import type { NewAccount } from "@/modules/accounts/application";
import { findProfileBySpec } from "./upload-statement";
import type { ImportDependencies, ImportFailureReason } from "./ports";

export type ConfirmOutcome =
  | { readonly kind: "ingested"; readonly importId: string; readonly added: number; readonly known: number }
  | { readonly kind: "failed"; readonly importId: string; readonly reason: ImportFailureReason }
  | {
      readonly kind: "rejected";
      readonly reason:
        | "import-not-found"
        | "not-awaiting-declaration"
        | "declaration-needed";
    };

export const confirmImport = async (
  context: HouseholdContext,
  deps: ImportDependencies,
  input: {
    readonly importId: string;
    readonly profileName: string;
    readonly spec: SourceProfileSpec;
    readonly declaration?: NewAccount;
  },
): Promise<ConfirmOutcome> => {
  const record = await deps.imports.getImport(context, input.importId);
  if (record === null) {
    return { kind: "rejected", reason: "import-not-found" };
  }
  if (record.status !== "AWAITING_DECLARATION") {
    return { kind: "rejected", reason: "not-awaiting-declaration" };
  }

  const parsed = deps.parser.parse(record.rawContent, input.spec);
  if (!parsed.ok) {
    // A file that does not parse under the confirmed spec (an unknown
    // indicator marker included, finding F2) fails the import loudly with
    // nothing written, the same discipline as the mixed-account check. A
    // bricked import is re-uploadable; a silently mis-signed one is not
    // repairable at all.
    await deps.imports.markImportFailed(context, record.id, "unparseable");
    return { kind: "failed", importId: record.id, reason: "unparseable" };
  }
  if (parsed.value.accountIbans.length > 1) {
    // Confirmed or not, a mixed-account file writes NOTHING (hazard H1.2):
    // the existing import row moves to FAILED and no transaction row lands.
    await deps.imports.markImportFailed(context, record.id, "mixed-accounts");
    return { kind: "failed", importId: record.id, reason: "mixed-accounts" };
  }

  const fileIban = parsed.value.accountIbans[0];
  let accountId: string | undefined;
  if (fileIban !== undefined) {
    const existing = await deps.accounts.findAccountByIban(context, fileIban);
    accountId = existing?.id;
  }
  if (accountId === undefined) {
    if (input.declaration === undefined) {
      return { kind: "rejected", reason: "declaration-needed" };
    }
    const created = await deps.accounts.declareAccount(context, {
      ...input.declaration,
      ...(fileIban !== undefined ? { iban: fileIban } : {}),
    });
    accountId = created.id;
  }

  // Reuse a spec-identical stored profile rather than storing a twin; the
  // profile is bound to the account exactly when the file itself carries
  // no own-account column (the card shape), so a later re-upload can
  // resolve its account without asking.
  const existingProfile = await findProfileBySpec(context, deps, input.spec);
  const profile =
    existingProfile ??
    (await deps.imports.createProfile(context, {
      name: input.profileName,
      spec: input.spec,
      ...(fileIban === undefined ? { accountId } : {}),
    }));

  const keys = assignDedupKeys(accountId, parsed.value.rows, input.spec);
  const { added, known } = await deps.imports.ingestRows(context, {
    importId: record.id,
    accountId,
    sourceProfileId: profile.id,
    // zipRowsWithDedupKeys THROWS on a row/key desync (finding F7).
    rows: zipRowsWithDedupKeys(parsed.value.rows, keys),
  });
  return { kind: "ingested", importId: record.id, added, known };
};
