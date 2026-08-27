// THE ONE WAY TO FIX A RING, AND IT IS DELIBERATELY SMALL (M3-P14,
// decision D-51 as rewritten, criterion 14.8; the ring is fixed at setup
// by the OWNER'S decision DR-0031, and that stands).
//
// THE RULE, in one sentence: a ring can be changed while NO ROW ON THAT
// ACCOUNT CARRIES AN INTERPRETATION BUILT AGAINST THE RING BEING LEFT.
// That is what this guard has always protected, and it is now what this
// guard tests.
//
// WHY THE TEST IS THE ACCOUNT'S CURRENT RING AND NOT ITS ROW COUNT. A
// flow is stamped only over POT accounts: the interpretation window is
// built from the pot account ids alone
// (src/modules/ledger/application/interpret-window.ts), so a
// RESERVE-ring account's own rows carry NO flow, by construction rather
// than by luck. That invariant is maintained by this very guard,
// inductively: an account reaches the RESERVE ring either at setup, with
// no rows at all, or from POT while carrying no own rows, so a stamped
// row can never arrive on a reserve-ring account. A reserve-ring account
// is therefore ALWAYS safe to move back into the pot, however many held
// rows it holds, and the recompute below is what brings those rows into
// the window and stamps them for the first time. Nothing is cleared,
// because nothing stale exists; no fact is touched, because a flow is an
// INTERPRETATION column, derived and recomputable (pulse-domain section
// 2, rule 1 stands untouched).
//
// The other direction still refuses once rows exist: a POT account whose
// rows already carry flows would leave the window when it moved to the
// reserve ring, and recompute would not reach them, so their flows would
// go stale where they sit. Clearing rows on an account leaving the pot is
// exactly the work DR-0031 deleted from the plan, and it is not smuggled
// back in here.
//
// CORRECTED TWICE, LOUDLY (clause R-087), because both superseded
// sentences were arguments rather than decoration.
//
//   FIRST superseded sentence (M3-P14): the no-own-rows window "covers
//   every case the setup shape can produce: a savings account answered
//   as a spending account at setup has no statement of its own (savings
//   statements are not imported in v1, pulse-domain section 1)". DR-0030
//   superseded that premise: a reserve-ring account's own statement IS
//   now accepted and its rows are stored as held facts.
//
//   SECOND superseded sentence (the M3-P18 fix round's first attempt):
//   "whether the guard itself should admit a correction over flow-free
//   held rows is a consequence recorded against the plan's PARKED
//   ring-change entry, awaiting an owner record, and is deliberately NOT
//   decided here: hasImportedRows stays flow-agnostic and no ring-change
//   path is added". Leaving it parked shipped a state with no reachable
//   remedy: a household that answered a spending account as SAVINGS at
//   setup and then uploaded that account's statement had the wrong
//   answer made permanent by its own first upload. Its rows are held and
//   counted in no total, transfers into it read as money set aside, the
//   uninterpreted count is pot-scoped so nothing is flagged, and the
//   banner reads as books closing. A confidently wrong month with no
//   control anywhere in the product that could undo it is not a
//   consequence to park. DR-0031's own words are that the ring is
//   "correctable only while the account has no imported rows of its
//   own"; this guard now reads that condition in the only sense that
//   stays true after DR-0030, namely no rows whose interpretation was
//   built against the ring being left.
//
// An account whose own rows already carry an interpretation cannot have
// its ring changed in v1, and the screen SAYS SO rather than failing
// silently.

import type { HouseholdContext } from "@/platform/tenancy";
import { err, ok, type Result } from "@/platform/result";
import type { AccountRole } from "../domain/account-role";
import type { AccountsSetupDependencies } from "./ports";

export type ChangeAccountRingFailure =
  | { readonly kind: "account-not-found" }
  // The refusal that keeps a stale flow unreachable. Named, so the screen
  // can say what it costs rather than just refusing.
  | { readonly kind: "account-has-own-rows" }
  | { readonly kind: "ring-unchanged" };

export const changeAccountRing = async (
  context: HouseholdContext,
  deps: AccountsSetupDependencies,
  input: { readonly accountId: string; readonly role: AccountRole },
): Promise<Result<{ readonly accountId: string }, ChangeAccountRingFailure>> => {
  const account = await deps.accounts.getAccountById(context, input.accountId);
  if (account === null) {
    return err({ kind: "account-not-found" });
  }
  if (account.role === input.role) {
    return err({ kind: "ring-unchanged" });
  }
  // Only an account LEAVING the pot can strand a stamped row. An account
  // leaving the reserve ring carries none, whatever its row count, so the
  // correction is admitted and the recompute below stamps its held rows
  // for the first time.
  if (
    account.role === "POT" &&
    (await deps.ledger.hasImportedRows(context, input.accountId))
  ) {
    return err({ kind: "account-has-own-rows" });
  }

  await deps.accounts.updateAccountRole(context, input.accountId, input.role);

  // The declaration changed, so the interpretation built against it is
  // stale everywhere it was used. One published recompute, exactly as
  // registration does.
  await deps.ledger.recompute(context);

  return ok({ accountId: input.accountId });
};
