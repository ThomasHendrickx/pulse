// REGISTER EVERY ACCOUNT THE HOUSEHOLD OWNS, ONCE (M3-P14, criteria 14.2
// and 14.8). The owner's complaint this answers, in their words: "When I
// upload 1 bank account first, that one contains transfers to other
// accounts. Now Pulse asks me to name them as merchants, but they are not
// merchants."
//
// WHAT THIS USE CASE WRITES: declaration rows, and nothing else. It never
// touches a transaction column. Interpretation is rebuilt afterwards by
// calling the LEDGER'S PUBLISHED RECOMPUTE exactly once, the same way
// naming a merchant does (assign-merchant.ts), because interpretation runs
// over a window across all pot accounts rather than over rows just
// imported: registering the siblings is a change to the DECLARED SETS, and
// every already-imported row is reclassified against them.

import type { HouseholdContext } from "@/platform/tenancy";
import { err, ok, type Result } from "@/platform/result";
import {
  validateAccountRegistration,
  type AccountRegistrationInput,
  type AccountRegistrationProblem,
} from "../domain/account-registration";
import type { AccountsSetupDependencies } from "./ports";

export type RegisterAccountsFailure =
  | { readonly kind: "invalid"; readonly problems: readonly AccountRegistrationProblem[] }
  // A number the household has already registered, in a submission that is
  // internally consistent. Reported against the row that carries it.
  | { readonly kind: "already-registered"; readonly row: number };

export type RegisterAccountsOutcome = { readonly registered: number };

export const registerAccounts = async (
  context: HouseholdContext,
  deps: AccountsSetupDependencies,
  input: { readonly rows: readonly AccountRegistrationInput[] },
): Promise<Result<RegisterAccountsOutcome, RegisterAccountsFailure>> => {
  const validated = validateAccountRegistration(input.rows);
  if (!validated.ok) {
    return err({ kind: "invalid", problems: validated.error });
  }

  // Already-registered numbers are refused rather than merged: the
  // per-household uniqueness constraint would refuse the write anyway, and
  // a named refusal is what the screen can render.
  const existing = await deps.accounts.listAccounts(context);
  const known = new Set(
    existing.flatMap((account) =>
      account.iban === undefined ? [] : [account.iban],
    ),
  );
  const clash = validated.value.findIndex((row) => known.has(row.iban));
  if (clash !== -1) {
    return err({ kind: "already-registered", row: clash });
  }

  await deps.accounts.createAccounts(context, validated.value);

  // ONE recompute, after every declaration row has landed. Not one per
  // account: interpretation is a whole-window rebuild, so running it per
  // row would classify the second account's transfers against a set that
  // does not yet carry the third.
  await deps.ledger.recompute(context);

  return ok({ registered: validated.value.length });
};
