// THE ONE CANONICAL FORM OF AN ACCOUNT NUMBER, and the one deterministic
// test of whether a string is one at all (M3-P14, decisions D-47, D-57 and
// DR-0028).
//
// WHY IT LIVES IN src/platform AND NOT IN A MODULE. Registration, the
// import path, the ledger's declared-set derivation and the overview's
// reserves join all compare account numbers, and the ledger domain imports
// nothing from other modules by rule (.claude/skills/pulse-domain/SKILL.md
// section 9, and the note at src/modules/ledger/domain/ledger-transaction.ts).
// A form that lives in one module is a form the other three copy. This is
// the shared value type, beside money and plain-date, and every consumer
// imports it.
//
// THE RULE THIS FILE ESTABLISHES, recorded here at the mechanism's own
// definition rather than only where it was learned:
//
//   A DECLARATION IS NORMALISED ON THE WAY IN. What the household typed at
//   registration, and what the import path declares from a file's own
//   account column, are both stored canonical, so Account.iban holds ONE
//   form tree-wide and the per-household uniqueness constraint at
//   prisma/schema/accounts.prisma:28 is a real backstop.
//
//   A FACT IS NEVER REWRITTEN, so every COMPARISON against a transaction's
//   counterparty account canonicalises BOTH SIDES at comparison time
//   (.claude/skills/pulse-domain/SKILL.md section 2 rule 1). The stored
//   Transaction.counterpartyIban column keeps whatever surface form the
//   document printed.
//
//   SIBLING IMPLEMENTATIONS THAT SHARE THIS MECHANISM, named here so the
//   next reader knows the rule is not local to one of them:
//     - src/modules/ledger/domain/ledger-transaction.ts (deriveDeclaredSets)
//     - src/modules/ledger/domain/classify-flow.ts (the two declared-set arms)
//     - src/modules/overview/adapters/overview-repository.ts (the reserves join)
//     - src/modules/import/domain/belfius-current-account-template.ts
//       (the PDF path's own-account and counterparty extraction, which used
//       to carry a private whitespace-removal helper called compactIban)
//     - src/modules/import/application/confirm-import.ts (the declaration
//       the import path writes)
//
// WHY A VALIDITY TEST SITS BESIDE THE CANONICAL FORM. A canonical form that
// cannot say whether a string IS an account number can only be applied
// blindly. The owner types these by hand from paper documents on a
// phone-first product, and one transposed pair of digits produces an
// account number that matches nothing at
// src/modules/ledger/domain/classify-flow.ts:62 through :77, so the
// transfer falls to the sign rule, lands in the spend total and is offered
// on the naming screen: a state indistinguishable from never having
// registered at all. DR-0028 settles that this test is DETERMINISTIC, a
// pinned country-length table plus the ISO 7064 mod-97 check, and that no
// model ever decides identity.

// The canonical shape, tested AFTER separators are removed: two letters,
// two check digits, then ten to thirty letters-or-digits. Deliberately the
// same ground the privacy gate's own account patterns cover
// (scripts/gate-privacy.sh), so a value this module calls an account number
// is a value that gate expects to find on the allow list.
const CANONICAL_SHAPE = /^[A-Z]{2}[0-9]{2}[0-9A-Z]{6,30}$/;

// THE CANONICAL FORM. Uppercase, separators removed. Total and idempotent.
//
// A STRING THAT IS NOT AN ACCOUNT NUMBER IS RETURNED UNCHANGED rather than
// mangled: this function is applied at comparison time to a stored
// counterparty column that often holds a free-text descriptor and
// sometimes holds nothing shaped like an account number at all, and an
// upper-cased descriptor compared against an upper-cased descriptor is a
// silent change of meaning in the one place this codebase is most careful
// about. The shape test is what makes it safe to apply everywhere.
export const canonicalAccountNumber = (value: string): string => {
  const stripped = value.replace(/[\s -]/g, "").toUpperCase();
  return CANONICAL_SHAPE.test(stripped) ? stripped : value;
};

// THE PINNED COUNTRY-LENGTH TABLE (DR-0028). One definition under src/,
// enumerated by test/domain/account-number.test.ts, which fails on a second
// copy anywhere. Lengths are the total length of the canonical form,
// country code and check digits included, as the ISO 13616 registry
// assigns them. The set is the SEPA zone plus the countries whose worked
// examples this repository's fixtures already use; a country absent from
// it is REFUSED rather than waved through, because waving one through is
// the mistyped-account hazard with a different cause.
export const ACCOUNT_NUMBER_LENGTHS: ReadonlyMap<string, number> = new Map([
  ["AD", 24], ["AE", 23], ["AL", 28], ["AT", 20], ["AZ", 28],
  ["BA", 20], ["BE", 16], ["BG", 22], ["BH", 22], ["BR", 29],
  ["BY", 28], ["CH", 21], ["CR", 22], ["CY", 28], ["CZ", 24],
  ["DE", 22], ["DK", 18], ["DO", 28], ["EE", 20], ["EG", 29],
  ["ES", 24], ["FI", 18], ["FO", 18], ["FR", 27], ["GB", 22],
  ["GE", 22], ["GI", 23], ["GL", 18], ["GR", 27], ["GT", 28],
  ["HR", 21], ["HU", 28], ["IE", 22], ["IL", 23], ["IS", 26],
  ["IT", 27], ["JO", 30], ["KW", 30], ["KZ", 20], ["LB", 28],
  ["LC", 32], ["LI", 21], ["LT", 20], ["LU", 20], ["LV", 21],
  ["MC", 27], ["MD", 24], ["ME", 22], ["MK", 19], ["MR", 27],
  ["MT", 31], ["MU", 30], ["NL", 18], ["NO", 15], ["PK", 24],
  ["PL", 28], ["PS", 29], ["PT", 25], ["QA", 29], ["RO", 24],
  ["RS", 22], ["SA", 24], ["SC", 31], ["SE", 24], ["SI", 19],
  ["SK", 24], ["SM", 27], ["ST", 25], ["SV", 28], ["TL", 23],
  ["TN", 24], ["TR", 26], ["UA", 29], ["VA", 22], ["VG", 24],
  ["XK", 20],
]);

// THE ISO 7064 MOD-97 CHECK. One definition under src/, pinned by the same
// enumeration test. Moves the first four characters to the end, replaces
// each letter by its position value (A = 10), and reduces modulo 97 by
// running digits: the remainder is 1 for a valid account number. Reduced
// digit by digit because the integer is far past the safe range of a
// JavaScript number, which is the shape of arithmetic error this codebase
// forbids everywhere it touches money and forbids here for the same reason.
const mod97 = (canonical: string): number => {
  const moved = `${canonical.slice(4)}${canonical.slice(0, 4)}`;
  let remainder = 0;
  for (const character of moved) {
    const code = character.charCodeAt(0);
    // "0"-"9" are 48-57, "A"-"Z" are 65-90 and map to 10-35.
    const value = code <= 57 ? code - 48 : code - 55;
    remainder = value > 9
      ? (remainder * 100 + value) % 97
      : (remainder * 10 + value) % 97;
  }
  return remainder;
};

export type AccountNumberError =
  | { readonly kind: "account-number-empty" }
  | { readonly kind: "account-number-unknown-country"; readonly country: string }
  | {
      readonly kind: "account-number-wrong-length";
      readonly country: string;
      readonly expected: number;
      readonly actual: number;
    }
  | { readonly kind: "account-number-check-failed" };

export type AccountNumberVerdict =
  | { readonly ok: true; readonly canonical: string }
  | { readonly ok: false; readonly error: AccountNumberError };

// THE FOUR REFUSALS, in the order DR-0028 states them and criterion 14.12
// asserts them: empty after canonicalisation, a country code the table does
// not carry, a length the table disagrees with, and a failed mod-97 check.
// Four rather than one, because the household is typing from paper and
// "that is not an account number" is not a message anybody can act on.
export const verifyAccountNumber = (value: string): AccountNumberVerdict => {
  const stripped = value.replace(/[\s -]/g, "").toUpperCase();
  if (stripped === "") {
    return { ok: false, error: { kind: "account-number-empty" } };
  }
  const country = stripped.slice(0, 2);
  if (!/^[A-Z]{2}$/.test(country)) {
    return {
      ok: false,
      error: { kind: "account-number-unknown-country", country },
    };
  }
  const expected = ACCOUNT_NUMBER_LENGTHS.get(country);
  if (expected === undefined) {
    return {
      ok: false,
      error: { kind: "account-number-unknown-country", country },
    };
  }
  if (stripped.length !== expected) {
    return {
      ok: false,
      error: {
        kind: "account-number-wrong-length",
        country,
        expected,
        actual: stripped.length,
      },
    };
  }
  if (!/^[A-Z]{2}[0-9]{2}[0-9A-Z]+$/.test(stripped) || mod97(stripped) !== 1) {
    return { ok: false, error: { kind: "account-number-check-failed" } };
  }
  return { ok: true, canonical: stripped };
};

export const isValidAccountNumber = (value: string): boolean =>
  verifyAccountNumber(value).ok;
