// THE ONE WAY TO FIX A RING, AND IT IS DELIBERATELY SMALL (M3-P14,
// decision D-51 as rewritten, criterion 14.8; the freeze is the OWNER'S
// decision, DR-0031, and stands).
//
// A ring can be changed WHILE THE ACCOUNT CARRIES NO IMPORTED ROWS OF ITS
// OWN, and not otherwise.
//
// THE JUSTIFYING SENTENCE THAT STOOD HERE IS CORRECTED, LOUDLY (M3-P18
// fix round, hazard finding HZ-M3P18-02, clause R-087). It read: the
// no-own-rows window "covers every case the setup shape can produce: a
// savings account answered as a spending account at setup has no
// statement of its own (savings statements are not imported in v1,
// pulse-domain section 1)". DR-0030 superseded that premise: a
// reserve-ring account's OWN statement is now accepted and its rows are
// stored as held facts, so a reserve-ring account CAN acquire own rows,
// and from its first confirmed upload this guard refuses the correction.
// The no-own-rows window therefore no longer covers every setup mistake:
// a household that answered a spending account as savings and then
// uploaded its statement is past this guard's window, its rows held and
// counted nowhere, with no ring correction reachable. The held block on
// the month view names the state (the rows are held because the account
// is REGISTERED in the savings ring), which is the in-contract half;
// whether the guard itself should admit a correction over flow-free held
// rows is a consequence recorded against the plan's PARKED ring-change
// entry, awaiting an owner record, and is deliberately NOT decided here:
// hasImportedRows stays flow-agnostic and no ring-change path is added.
//
// WHY THE GUARD IS WHAT MAKES A STALE FLOW UNREACHABLE, and therefore why
// this plan carries no clearing and no read scoping: a row can only carry
// a flow computed against the old ring if it sits on the account whose
// ring changed, and an account with no rows of its own has none. Recompute
// then rewrites every remaining affected row from facts plus declarations.
// (A HELD row carries no flow either; that observation belongs to the
// parked consequence above, not to this guard's contract today.)
//
// An account that already carries its own imported rows cannot have its
// ring changed in v1, and the screen SAYS SO rather than failing silently.

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
  if (await deps.ledger.hasImportedRows(context, input.accountId)) {
    return err({ kind: "account-has-own-rows" });
  }

  await deps.accounts.updateAccountRole(context, input.accountId, input.role);

  // The declaration changed, so the interpretation built against it is
  // stale everywhere it was used. One published recompute, exactly as
  // registration does.
  await deps.ledger.recompute(context);

  return ok({ accountId: input.accountId });
};
