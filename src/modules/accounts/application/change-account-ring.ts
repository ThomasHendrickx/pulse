// THE ONE WAY TO FIX A RING, AND IT IS DELIBERATELY SMALL (M3-P14,
// decision D-51 as rewritten, criterion 14.8).
//
// A ring can be changed WHILE THE ACCOUNT CARRIES NO IMPORTED ROWS OF ITS
// OWN, and not otherwise. That covers every case the setup shape can
// produce: a savings account answered as a spending account at setup has
// no statement of its own (savings statements are not imported in v1,
// pulse-domain section 1), so correcting it only reclassifies the CURRENT
// account's transfers TO it, and those rows sit on a pot account and are
// handled by the ordinary whole-window recompute.
//
// WHY THE GUARD IS WHAT MAKES A STALE FLOW UNREACHABLE, and therefore why
// this plan carries no clearing and no read scoping: a row can only carry
// a flow computed against the old ring if it sits on the account whose
// ring changed, and an account with no rows of its own has none. Recompute
// then rewrites every remaining affected row from facts plus declarations.
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
