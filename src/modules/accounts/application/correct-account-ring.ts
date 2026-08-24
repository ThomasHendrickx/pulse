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
  // WHAT ACTUALLY MOVED, MEASURED AFTER THE WRITE AND THE RECOMPUTE.
  //
  // CORRECTED IN PLACE RATHER THAN QUIETLY REWRITTEN (R-087). This comment
  // used to make exactly the claim below and the code did NOT do it: the
  // function returned the PREVIEW object, computed before the declaration
  // was written and never re-read, so the comparison it advertised was a
  // tautology. Correct in every single-request run and wrong under a
  // concurrent write, which is the shape of defect that is invisible
  // precisely because the comment says otherwise. A clean-room review found
  // it.
  //
  // The code now matches: the movement is derived a SECOND time, from the
  // declaration set as it stands after the write, against the same rows the
  // recompute has just re-interpreted. Nothing stands between the first
  // preview and the write, so if another import or another correction lands
  // in that window the two differ, and `previewWasStale` says so instead of
  // the household being shown a figure that was true a moment ago.
  readonly moved: RingChangeMovement;
  // The movement shown to the owner BEFORE they confirmed. Kept so the two
  // can be compared, which is the thing the old comment claimed and did not
  // provide.
  readonly previewed: RingChangeMovement;
  // True when the two differ, which can only happen if something else wrote
  // to this household between the preview and the recompute.
  readonly previewWasStale: boolean;
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

  // MEASURED AGAIN, AFTER THE WRITE AND THE RECOMPUTE, and measured as the
  // INVERSE. Asking the dry run what it would take to reach the ring the
  // account now HAS answers nothing, because the household is already there.
  // What it can answer, from the household as it now stands, is what putting
  // the ring BACK would do; negate that and you have what this correction
  // did. That is a genuine post-write reading rather than an echo: it loads
  // the rows the recompute has just re-interpreted, and if another import or
  // another correction landed between the preview and here, it differs from
  // the preview and previewWasStale says so.
  //
  // It is a read and writes nothing, exactly as the first call does. It costs
  // one more pass over the household's rows on an action the owner takes by
  // hand; correctness on a figure that moves money between totals is worth
  // that.
  const accounts = await deps.accounts.listAccounts(context);
  const previousRole = input.role === "POT" ? "RESERVE" : "POT";
  const undo = await deps.preview(context, {
    proposedAccounts: proposedSet(accounts, input.accountId, previousRole),
    subjectAccountId: input.accountId,
  });
  const previewed = movement.value;
  const moved: RingChangeMovement = {
    // 0 - x rather than -x: unary negation of 0 yields -0, the same guard
    // the projection and the reconciliation both use.
    spendDeltaCents: 0 - undo.spendDeltaCents,
    reservesDeltaCents: 0 - undo.reservesDeltaCents,
    incomeDeltaCents: 0 - undo.incomeDeltaCents,
    // NOT SYMMETRIC UNDER THE INVERSE, and this is stated rather than
    // assumed because assuming it was wrong. The dry run counts rules that
    // STOP matching; run backwards it counts the rules that would stop on
    // the way back, which is zero, not the rules that started. The count of
    // rules this correction retired is a statement about the TRANSITION, and
    // the pre-write dry run is the only place both sides of that transition
    // are visible, so this one field is the previewed number and says so.
    // Measured: with the naive symmetric assumption the count came back 0
    // where the test required 1.
    merchantRulesStoppedMatching: previewed.merchantRulesStoppedMatching,
    // The rows-on-the-account count is symmetric under the inverse too: the
    // rows that stopped being counted are the rows that would start again.
    rowsOnAccount: undo.rowsOnAccount,
    rowsOnAccountDirection:
      undo.rowsOnAccountDirection === "start-counting"
        ? "stop-counting"
        : undo.rowsOnAccountDirection === "stop-counting"
          ? "start-counting"
          : "none",
  };
  return ok({
    account,
    moved,
    previewed,
    // Compared over the three MONEY deltas and the row count, which are the
    // fields measured after the write. The rule count is not compared with
    // itself.
    previewWasStale:
      moved.spendDeltaCents !== previewed.spendDeltaCents ||
      moved.reservesDeltaCents !== previewed.reservesDeltaCents ||
      moved.incomeDeltaCents !== previewed.incomeDeltaCents ||
      moved.rowsOnAccount !== previewed.rowsOnAccount,
  });
};
