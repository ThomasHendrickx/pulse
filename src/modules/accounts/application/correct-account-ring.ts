// CORRECTING AN ACCOUNT'S RING AFTER IT WAS DECLARED (M3-P15).
//
// WHY THIS EXISTS. Under DR-0030 the ring a household answers on its FIRST
// upload decides whether that statement's rows are counted or held, in both
// directions, and no refusal stands behind the answer. A savings account
// declared as a spending account has its interest taken as income, its
// outgoings as spend and both legs of every transfer paired as internal, so
// no cause block appears, the reserves card reads zero and the verdict reads
// that the books close: nothing on the month view's FIGURES differs from a
// correct month. A current account declared as savings has its rows held and
// counted nowhere. Both were wrong forever until this use case existed.
//
// WHAT IT IS. A DECLARATION EDIT followed by a recompute, and never a row
// rewrite. It writes one declaration column and then calls the ledger's
// published recompute, which is the same shape as naming a merchant. No code
// path on this route updates a raw transaction column at all: the rows move
// between counted and held because INTERPRETATION is re-derived from facts
// plus declarations, which is exactly why running it twice changes nothing.

import { err, ok, type Result } from "@/platform/result";
import type { HouseholdContext } from "@/platform/tenancy";
import { canonicalAccountNumber } from "@/platform/account-number";
import type { AccountRole } from "../domain/account-role";
import type {
  AccountRecord,
  AccountRepositoryPort,
  DeclarationChangePreviewPort,
  RecomputeInterpretation,
} from "./ports";

export type CorrectAccountRingError =
  | { readonly kind: "account-not-found" }
  // A CARD CANNOT BE MOVED INTO THE RESERVE RING. A card account carries no
  // account number, and an account in the reserve ring with no account
  // number sits in no declared set at all, holds its rows forever, is
  // invisible to settlement matching, and cannot be deduplicated by the
  // per-household uniqueness constraint because Postgres does not collide
  // nulls. The confirm path refuses the same combination on the same
  // grounds; refusing it here too means the state cannot be reached from
  // either direction.
  | { readonly kind: "reserve-ring-needs-account-number" };

export type RingChangeMovement = {
  // Rows ON the account whose counted state changes, and which way.
  readonly rowsOnAccount: number;
  readonly rowsOnAccountDirection: "stop-counting" | "start-counting" | "none";
  // The SECOND movement, which is a different set of rows: the counterparty
  // rows on the household's OTHER pot accounts, which move between the
  // spend total and the reserves block. Signed display magnitudes.
  readonly spendDeltaCents: number;
  readonly reservesDeltaCents: number;
  readonly incomeDeltaCents: number;
  readonly merchantRulesStoppedMatching: number;
};

export type CorrectAccountRingOutcome = {
  readonly account: AccountRecord;
  // What ACTUALLY moved, recomputed after the change rather than restated
  // from the preview, so the two can be compared and criterion 15.7's
  // "byte identical" is a fact rather than a tautology.
  readonly moved: RingChangeMovement;
};

export type CorrectAccountRingDependencies = {
  readonly accounts: Pick<
    AccountRepositoryPort,
    "getAccountById" | "listAccounts" | "updateAccountRole"
  >;
  readonly preview: DeclarationChangePreviewPort;
  readonly recompute: RecomputeInterpretation;
};

const proposedSet = (
  accounts: readonly AccountRecord[],
  accountId: string,
  role: AccountRole,
): readonly {
  readonly id: string;
  readonly role: AccountRole;
  readonly iban?: string;
}[] =>
  accounts.map((account) => ({
    id: account.id,
    role: account.id === accountId ? role : account.role,
    ...(account.iban === undefined
      ? {}
      : { iban: canonicalAccountNumber(account.iban) }),
  }));

// WHAT WILL MOVE, BEFORE THE OWNER CONFIRMS (criterion 15.7). Read only.
export const previewAccountRingChange = async (
  context: HouseholdContext,
  deps: Pick<CorrectAccountRingDependencies, "accounts" | "preview">,
  input: { readonly accountId: string; readonly role: AccountRole },
): Promise<Result<RingChangeMovement, CorrectAccountRingError>> => {
  const account = await deps.accounts.getAccountById(context, input.accountId);
  if (account === null) {
    return err({ kind: "account-not-found" as const });
  }
  if (input.role === "RESERVE" && account.iban === undefined) {
    return err({ kind: "reserve-ring-needs-account-number" as const });
  }
  const accounts = await deps.accounts.listAccounts(context);
  const preview = await deps.preview(context, {
    proposedAccounts: proposedSet(accounts, input.accountId, input.role),
    subjectAccountId: input.accountId,
  });
  return ok(preview);
};

export const correctAccountRing = async (
  context: HouseholdContext,
  deps: CorrectAccountRingDependencies,
  input: { readonly accountId: string; readonly role: AccountRole },
): Promise<Result<CorrectAccountRingOutcome, CorrectAccountRingError>> => {
  const movement = await previewAccountRingChange(context, deps, input);
  if (!movement.ok) {
    return movement;
  }
  // ONE DECLARATION COLUMN. Everything else is derived.
  const account = await deps.accounts.updateAccountRole(
    context,
    input.accountId,
    input.role,
  );
  if (account === null) {
    return err({ kind: "account-not-found" as const });
  }
  await deps.recompute(context);
  return ok({ account, moved: movement.value });
};
