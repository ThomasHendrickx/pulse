// SETUP ASKS ONCE (M3-P14). The household types every account it owns in
// one submission: a label, a bank, an account number and a ring for each.
// This file is the pure validation of that submission. No database, no
// household context, no ports.
//
// WHY THE WHOLE SUBMISSION IS VALIDATED AS A SET rather than row by row:
// the owner is typing eight numbers by hand from paper on a phone, and a
// screen that accepts seven and silently drops the eighth is the original
// defect with a new cause. Every problem found is reported with the INDEX
// of the row it belongs to, so the screen can name which row is wrong and
// keep the rest of what was typed (criterion 14.3).
//
// CARDS ARE NOT ENTERED HERE (decision D-48). A card statement carries no
// account number, so a card account is recognised through its bound
// SourceProfile and declared at first sight when its statement arrives.
// There is no shape in this file for an account without a number.

import {
  accountNumberProblem,
  canonicalAccountNumber,
  type AccountNumberProblem,
} from "@/platform/account-number";
import { err, ok, type Result } from "@/platform/result";
import type { AccountRole } from "./account-role";

// One row exactly as it left the form: every field is still a raw string,
// including the ring, because "the ring was not answered" is a case this
// must be able to report rather than default (criterion 14.2, hazard
// H14.4).
export type AccountRegistrationInput = {
  readonly label: string;
  readonly bank: string;
  readonly accountNumber: string;
  readonly ring: string;
};

export type AccountRegistrationRowProblem =
  | { readonly kind: "label-missing" }
  | { readonly kind: "bank-missing" }
  // NEVER DEFAULTED. The ring decides whether a row is counted in the
  // month or shown as money set aside, and a default is a guess the
  // household cannot see (pulse-domain section 1).
  | { readonly kind: "ring-missing" }
  | { readonly kind: "ring-invalid"; readonly value: string }
  | {
      readonly kind: "account-number-invalid";
      readonly problem: AccountNumberProblem;
    }
  // The same number typed on two rows of one submission. Refused rather
  // than deduplicated, because the household meant two different accounts
  // and one of the two numbers is wrong.
  | { readonly kind: "duplicate-in-submission" };

export type AccountRegistrationProblem =
  // No row at all: an empty submission registers nothing and says so.
  | { readonly kind: "no-rows" }
  | {
      readonly kind: "row";
      // Zero-based index into the submitted rows, so the screen can name
      // the row the owner is looking at.
      readonly row: number;
      readonly problem: AccountRegistrationRowProblem;
    };

// A row that passed. The account number is stored CANONICAL, because
// Account.iban is a DECLARATION and a declaration may be normalised on the
// way in; the stored counterparty column on a fact row may not, which is
// why every comparison canonicalises both sides instead (the rule and its
// siblings are recorded at src/platform/account-number.ts).
export type ValidatedAccountRegistration = {
  readonly label: string;
  readonly bank: string;
  readonly iban: string;
  readonly role: AccountRole;
};

const parseRing = (
  value: string,
): Result<AccountRole, AccountRegistrationRowProblem> => {
  const trimmed = value.trim();
  if (trimmed === "") {
    return err({ kind: "ring-missing" as const });
  }
  if (trimmed === "POT" || trimmed === "RESERVE") {
    return ok(trimmed);
  }
  return err({ kind: "ring-invalid" as const, value: trimmed });
};

// Every problem in the submission, in row order, or the validated rows.
// ALL problems are returned rather than the first, so the owner fixes one
// screenful rather than one round trip per row.
export const validateAccountRegistration = (
  rows: readonly AccountRegistrationInput[],
): Result<
  readonly ValidatedAccountRegistration[],
  readonly AccountRegistrationProblem[]
> => {
  if (rows.length === 0) {
    return err([{ kind: "no-rows" as const }]);
  }
  const problems: AccountRegistrationProblem[] = [];
  const validated: ValidatedAccountRegistration[] = [];
  const seen = new Set<string>();
  rows.forEach((row, index) => {
    const at = (problem: AccountRegistrationRowProblem): void => {
      problems.push({ kind: "row", row: index, problem });
    };
    const label = row.label.trim();
    const bank = row.bank.trim();
    if (label === "") {
      at({ kind: "label-missing" });
    }
    if (bank === "") {
      at({ kind: "bank-missing" });
    }
    const ring = parseRing(row.ring);
    if (!ring.ok) {
      at(ring.error);
    }
    const problem = accountNumberProblem(row.accountNumber);
    if (problem !== undefined) {
      at({ kind: "account-number-invalid", problem });
    }
    const canonical = canonicalAccountNumber(row.accountNumber);
    if (problem === undefined) {
      if (seen.has(canonical)) {
        at({ kind: "duplicate-in-submission" });
      }
      seen.add(canonical);
    }
    if (label !== "" && bank !== "" && ring.ok && problem === undefined) {
      validated.push({ label, bank, iban: canonical, role: ring.value });
    }
  });
  return problems.length === 0 ? ok(validated) : err(problems);
};
