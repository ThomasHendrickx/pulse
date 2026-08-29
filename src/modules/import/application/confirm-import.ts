// Confirm use case: the user has seen the detected profile over the
// five-row preview, named it, fixed it if needed, and declared the account
// if it was unknown. Only now does anything reach the ledger. The
// mixed-account check runs again against the CONFIRMED spec, because a
// spec fix can change which column is the account column.

import type { HouseholdContext } from "@/platform/tenancy";
import { assignDedupKeys, zipRowsWithDedupKeys } from "../domain/dedup";
import { specEquals, type SourceProfileSpec } from "../domain/source-profile";
import type { NewAccount } from "@/modules/accounts/application";
import { failureReasonForParseError } from "./upload-statement";
import type { ImportDependencies, ImportFailureReason } from "./ports";

export type ConfirmOutcome =
  | { readonly kind: "ingested"; readonly importId: string; readonly added: number; readonly known: number }
  | { readonly kind: "failed"; readonly importId: string; readonly reason: ImportFailureReason }
  | {
      readonly kind: "rejected";
      readonly reason:
        | "import-not-found"
        | "not-awaiting-declaration"
        | "declaration-needed"
        | "already-confirmed"
        // M3-P14: the file's own account number is not one the household
        // registered at setup. Nothing is written and no account is
        // created; the message names the setup screen and links to it.
        //
        // THE account-in-savings-ring REFUSAL THAT STOOD BESIDE THIS ONE
        // IS REMOVED ROOT AND BRANCH (M3-P18, DR-0030 superseding D-55):
        // a statement whose own account sits in the SAVINGS ring is now
        // ACCEPTED, its rows stored as facts, shown on that account
        // marked held and counted in no total.
        | "account-not-registered"
        // The format question answered twice with the same name. The
        // (householdId, name) index on source_profiles used to raise an
        // unhandled unique-constraint violation here, which the framework
        // rendered as an application error page; it is a refusal the
        // reader can act on, so it is a value like every other one.
        | "profile-name-taken";
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

  const parsed = await deps.parser.parse(record.rawContent, input.spec);
  if (!parsed.ok) {
    // A file that does not parse under the confirmed spec (an unknown
    // indicator marker included, finding F2) fails the import loudly with
    // nothing written, the same discipline as the mixed-account check. A
    // bricked import is re-uploadable; a silently mis-signed one is not
    // repairable at all. The reason mapping is shared with the upload
    // path, so a non-reconciling PDF reports balance-mismatch here too.
    const reason = failureReasonForParseError(parsed.error);
    const marked = await deps.imports.markImportFailed(
      context,
      record.id,
      reason,
    );
    if (!marked) {
      // A racer ingested it between the read and this write (finding F4).
      return { kind: "rejected", reason: "already-confirmed" };
    }
    return { kind: "failed", importId: record.id, reason };
  }
  if (parsed.value.accountIbans.length > 1) {
    // Confirmed or not, a mixed-account file writes NOTHING (hazard H1.2):
    // the existing import row moves to FAILED and no transaction row lands.
    const marked = await deps.imports.markImportFailed(
      context,
      record.id,
      "mixed-accounts",
    );
    if (!marked) {
      return { kind: "rejected", reason: "already-confirmed" };
    }
    return { kind: "failed", importId: record.id, reason: "mixed-accounts" };
  }

  // ACCOUNT RESOLUTION, AND THE GATE M3-P14 PUTS IN FRONT OF IT.
  //
  // Accounts used to come into existence HERE and only here, one statement
  // at a time, which is the verified root cause of the owner's complaint:
  // a transfer to an account no file had yet introduced missed both
  // declared-set arms in classification, fell to the sign rule, landed in
  // the spend total and offered its counterparty on the naming screen. So
  // the file's own account is now either ALREADY REGISTERED, or the file
  // carries no own-account column at all, which is the card shape.
  //
  // Two arms, and a card is the only thing declared at first sight:
  //
  //   the file carries an own account -> it must resolve to an account
  //   registered at setup, in EITHER ring (DR-0030): a savings account's
  //   own statement is accepted and its rows are held by construction,
  //   because the interpretation window is built from the pot account
  //   ids alone. An UNREGISTERED account is a refusal with nothing
  //   written.
  //
  //   the file carries NO own account -> it is a card (decision D-48: a
  //   card statement carries no account number and is recognised through
  //   its bound SourceProfile), resolved from a spec-identical stored
  //   profile or declared here.
  // One read of the stored declarations answers two questions: which
  // profile this spec already is, and whether the name the reader typed
  // belongs to a different one.
  const profiles = await deps.imports.listProfiles(context);
  const existingProfile = profiles.find((candidate) =>
    specEquals(candidate.spec, input.spec),
  );

  // THE NAME IS REFUSED BEFORE ANYTHING IS WRITTEN. A spec-identical
  // profile is reused below and never reaches this check, so what is
  // refused here is a SECOND format wearing a name the household already
  // gave a different one. Placing the check ahead of account resolution
  // is deliberate: a refused confirm must not leave a declared account
  // behind for a card whose format never landed.
  if (
    existingProfile === undefined &&
    profiles.some((candidate) => candidate.name === input.profileName)
  ) {
    return { kind: "rejected", reason: "profile-name-taken" };
  }

  const fileIban = parsed.value.accountIbans[0];
  let accountId: string | undefined;
  if (fileIban !== undefined) {
    // Canonical on both sides inside the repository (criterion 14.4): the
    // file prints its account spaced on one path and compact on another.
    const existing = await deps.accounts.findAccountByIban(context, fileIban);
    if (existing === null) {
      return { kind: "rejected", reason: "account-not-registered" };
    }
    // A RESERVE-ring account's own statement is accepted like any other
    // (M3-P18, DR-0030, superseding D-55's refusal): its rows land as
    // facts on that account and keep no flow, because interpretation
    // runs over the pot accounts alone. Accepting is not interpreting.
    accountId = existing.id;
  } else {
    accountId = existingProfile?.accountId;
    if (accountId === undefined) {
      if (input.declaration === undefined) {
        return { kind: "rejected", reason: "declaration-needed" };
      }
      const created = await deps.accounts.declareAccount(
        context,
        input.declaration,
      );
      accountId = created.id;
    }
  }

  // Reuse a spec-identical stored profile rather than storing a twin; the
  // profile is bound to the account exactly when the file itself carries
  // no own-account column (the card shape), so a later re-upload can
  // resolve its account without asking.
  let profile = existingProfile;
  if (profile === undefined) {
    const created = await deps.imports.createProfile(context, {
      name: input.profileName,
      spec: input.spec,
      ...(fileIban === undefined ? { accountId } : {}),
    });
    if (!created.ok) {
      // The window the read above cannot close: another confirm stored
      // that name between the read and this write. The unique index
      // arbitrates, and its refusal is the SAME value, so the reader sees
      // one sentence either way rather than a crash on the rarer path.
      return { kind: "rejected", reason: "profile-name-taken" };
    }
    profile = created.profile;
  }

  const keys = assignDedupKeys(accountId, parsed.value.rows, input.spec);
  const ingested = await deps.imports.ingestRows(context, {
    importId: record.id,
    accountId,
    sourceProfileId: profile.id,
    // The atomic claim (finding F4): the read-time status check above is
    // advisory only; two racing confirms both pass it, and the claim
    // inside the ingest transaction is what arbitrates. The loser writes
    // nothing and reports already-confirmed.
    fromStatus: "AWAITING_DECLARATION",
    // zipRowsWithDedupKeys THROWS on a row/key desync (finding F7).
    rows: zipRowsWithDedupKeys(parsed.value.rows, keys),
    // The document's own settlement figure travels with its rows
    // (HZ-M3P3-01); absent for every statement that prints none.
    ...(parsed.value.settlementTotalCents === undefined
      ? {}
      : { settlementTotalCents: parsed.value.settlementTotalCents }),
  });
  if (!ingested.ok) {
    return { kind: "rejected", reason: "already-confirmed" };
  }
  await deps.interpret(context, record.id);
  return {
    kind: "ingested",
    importId: record.id,
    added: ingested.added,
    known: ingested.known,
  };
};
