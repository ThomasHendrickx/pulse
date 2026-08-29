// THE ONE CANONICAL FORM AND THE ONE VALIDITY TEST FOR AN ACCOUNT NUMBER
// (M3-P14, criterion 14.4; DR-0028's four tests).
//
// WHY IT LIVES IN PLATFORM AND NOT IN A MODULE. Four modules need it:
// `accounts` (registration at setup), `import` (resolving a file's own
// account to a registered one), `ledger` (the declared-set comparisons in
// classify-flow and corrections, and the leg match in pair-transfers) and
// `merchants` (the counterparty trust gate). The ledger's `domain` folder
// imports nothing from another module by rule (pulse-domain section 9), so
// a definition living in `merchants` could not be reached from there. This
// is the one place every consumer may import from.
//
// ONE DEFINITION, THREE PARTS, and the test at
// test/domain/account-number.test.ts enumerates the call sites and asserts
// there is exactly one of each under src/:
//
//   canonicalAccountNumber          the canonical form
//   ACCOUNT_NUMBER_LENGTH_BY_COUNTRY the pinned country-length table
//   mod97 (private, reached through accountNumberProblem)  the checksum
//
// WHAT MOVED HERE, so a later reader can find the history: all three used
// to live in src/modules/merchants/domain/counterparty-identity.ts, added
// there by M3-P12 for the counterparty trust gate. That file now imports
// them from here and keeps its own name for the gate
// (isTrustedCounterpartyAccount), because the DECISION the gate encodes
// (fall back to the descriptor basis rather than merge two counterparties)
// is a merchants decision even though the test it runs is this one.
//
// MECHANISM RULE, RECORDED AT THE DEFINITION (clause mechanism-sibling).
// The mechanism is COMPARING A DECLARED ACCOUNT NUMBER AGAINST ONE STORED
// ON A FACT ROW. Its rule: the DECLARATION is stored canonical, and every
// COMPARISON canonicalises BOTH SIDES at comparison time, because the
// stored counterparty column is a FACT and a fact is never rewritten to
// fix an interpretation (pulse-domain section 2, rule 1). The same account
// number reaches this tree spaced on one path and compact on another: the
// delimited parser stores the cell verbatim
// (src/modules/import/domain/parse-statement.ts) and the PDF template
// compacts its scrape
// (src/modules/import/domain/belfius-current-account-template.ts), so a
// comparison of raw stored strings answers "different account" for one
// account written two ways. THE SIBLING IMPLEMENTATIONS of this mechanism
// in this tree, so the next reader knows the rule is not local:
//
//   src/modules/ledger/domain/ledger-transaction.ts  deriveDeclaredSets
//   src/modules/ledger/domain/classify-flow.ts       the two set lookups
//   src/modules/ledger/domain/corrections.ts         the reserve drawdown
//   src/modules/ledger/domain/pair-transfers.ts      the leg match
//   src/modules/overview/adapters/overview-repository.ts  the reserves join
//   src/modules/import/application/confirm-import.ts the registered lookup
//   src/modules/accounts/adapters/account-repository.ts  the stored form
//   src/modules/accounts/application/register-accounts.ts  the typed
//       duplicate check (M3-P18: known set over canonical forms)
//
// AND THE SQL MIRRORS, which cannot import this function and must agree
// with it by test rather than by reading (each is pinned by a spec):
//   src/modules/overview/adapters/overview-repository.ts  the reserves join
//   prisma/schema/migrations/20260827120000_canonical_account_iban_backfill
//       the canonical backfill of stored declarations (M3-P18)
//   scripts/detect-account-collisions.ts  the collision grouping (M3-P18)
//
// A new consumer joins that list rather than growing a second copy.

// The canonical form: uppercase, every whitespace character removed. This
// is the ONLY transformation applied. No masking (a masked value could
// never match a second row), no truncation, no repair.
export const canonicalAccountNumber = (value: string): string =>
  value.replace(/\s/g, "").toUpperCase();

// THE ONE SQL WHITESPACE CLASS THE MIRRORS STRIP, NOT BARE [[:space:]].
// Corrected in the M3-P18 fix round under HAZARD finding HZ-M3P18-01 and
// stated loudly (clause R-087): the sibling note above used to let the
// mirrors stand on the POSIX class alone, and the delivered mirror tests
// exercised ASCII renderings only, over which [[:space:]] and
// JavaScript's \s happen to agree. Witnessed live on Postgres 16.13
// (C.utf8): POSIX [[:space:]] does NOT match U+00A0, U+202F or U+FEFF,
// all of which \s strips, and U+00A0 is the single byte 0xA0 in
// Windows-1252, the encoding common for Belgian exports, so the
// divergence sat exactly on the population the backfill exists for (a
// stored NBSP-spaced rendering stayed at its SQL fixed point, the
// canonical lookup still missed it, and the canonical duplicate check
// refused the retype: a full lockout).
//
// The class below unions the POSIX class with every remaining member of
// ECMAScript's WhiteSpace and LineTerminator productions (the definition
// of \s): U+00A0, U+1680, U+2000..U+200A, U+2028, U+2029, U+202F,
// U+205F, U+3000, U+FEFF. It deliberately does NOT include U+200B, which
// \s does not match. Written as VISIBLE Postgres ARE escapes, never raw
// characters, so the source shows what it strips; consumers pass it as a
// bind parameter or splice it into SQL text, and the migration, which
// cannot import anything, inlines the same class with a pin in
// test/domain/canonical-backfill.test.ts asserting byte equality. The
// same test derives the \s set by sweeping EVERY Unicode code point and
// asserts this class enumerates exactly that set.
export const ACCOUNT_NUMBER_SQL_WHITESPACE_CLASS =
  "[[:space:]\\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000\\ufeff]";

// THE PINNED COUNTRY-LENGTH TABLE. Source: the ISO 13616 IBAN Registry
// published by SWIFT as the registration authority, which assigns each
// participating country code exactly one total length. Populated FROM THAT
// REGISTRY rather than from the countries this project has seen, because a
// table grown from observed data silently refuses the first row of the
// next country.
//
// A COUNTRY CODE THIS TABLE DOES NOT CARRY IS REFUSED, never admitted on a
// length guess. The full contents are pinned by a regression test
// (test/domain/counterparty-identity.test.ts), so adding, removing or
// altering an entry is RED rather than silent.
export const ACCOUNT_NUMBER_LENGTH_BY_COUNTRY: ReadonlyMap<string, number> =
  new Map([
    ["AD", 24], ["AE", 23], ["AL", 28], ["AT", 20], ["AZ", 28],
    ["BA", 20], ["BE", 16], ["BG", 22], ["BH", 22], ["BI", 27],
    ["BR", 29], ["BY", 28], ["CH", 21], ["CR", 22], ["CY", 28],
    ["CZ", 24], ["DE", 22], ["DJ", 27], ["DK", 18], ["DO", 28],
    ["EE", 20], ["EG", 29], ["ES", 24], ["FI", 18], ["FK", 18],
    ["FO", 18], ["FR", 27], ["GB", 22], ["GE", 22], ["GI", 23],
    ["GL", 18], ["GR", 27], ["GT", 28], ["HN", 28], ["HR", 21],
    ["HU", 28], ["IE", 22], ["IL", 23], ["IQ", 23], ["IS", 26],
    ["IT", 27], ["JO", 30], ["KW", 30], ["KZ", 20], ["LB", 28],
    ["LC", 32], ["LI", 21], ["LT", 20], ["LU", 20], ["LV", 21],
    ["LY", 25], ["MC", 27], ["MD", 24], ["ME", 22], ["MK", 19],
    ["MN", 20], ["MR", 27], ["MT", 31], ["MU", 30], ["NI", 28],
    ["NL", 18], ["NO", 15], ["OM", 23], ["PK", 24], ["PL", 28],
    ["PS", 29], ["PT", 25], ["QA", 29], ["RO", 24], ["RS", 22],
    ["RU", 33], ["SA", 24], ["SC", 31], ["SD", 18], ["SE", 24],
    ["SI", 19], ["SK", 24], ["SM", 27], ["SO", 23], ["ST", 25],
    ["SV", 28], ["TL", 23], ["TN", 24], ["TR", 26], ["UA", 29],
    ["VA", 22], ["VG", 24], ["XK", 20], ["YE", 30],
  ]);

// ISO 7064 mod-97-10, computed in chunks so no intermediate exceeds the
// safe integer range. Letters carry their position value (A = 10 ... Z =
// 35). A character that is neither a digit nor an uppercase letter returns
// -1, which no valid value can produce.
const mod97 = (compact: string): number => {
  const rearranged = `${compact.slice(4)}${compact.slice(0, 4)}`;
  let remainder = 0;
  for (const character of rearranged) {
    const code = character.charCodeAt(0);
    const digits =
      code >= 65 && code <= 90
        ? String(code - 55)
        : code >= 48 && code <= 57
          ? character
          : undefined;
    if (digits === undefined) {
      return -1;
    }
    for (const digit of digits) {
      remainder = (remainder * 10 + Number(digit)) % 97;
    }
  }
  return remainder;
};

// The four ways a value can fail, as a tagged union rather than a boolean,
// because criterion 14.3 requires the setup screen to say WHICH row is
// wrong and the UI decides the wording in three languages (pulse-typescript
// section 5: an error carrying an English sentence cannot be translated).
export type AccountNumberProblem =
  | { readonly kind: "empty" }
  | { readonly kind: "unknown-country"; readonly country: string }
  | {
      readonly kind: "wrong-length";
      readonly country: string;
      readonly expected: number;
      readonly actual: number;
    }
  | { readonly kind: "checksum-failed" };

// DR-0028's four tests, in order, over the canonical form. Deterministic
// and never a model's judgement.
//
//   1. non-empty after canonicalisation
//   2. a country code the pinned table carries
//   3. the exact length that table assigns that country code
//   4. the ISO 7064 mod-97 check
//
// Returns the first problem found, or undefined when the value passes.
export const accountNumberProblem = (
  value: string,
): AccountNumberProblem | undefined => {
  const compact = canonicalAccountNumber(value);
  if (compact === "") {
    return { kind: "empty" };
  }
  // A value whose shape is not two letters, two digits and an
  // alphanumeric body has no country code to look up: the country test is
  // what refuses it, and it is reported as such rather than as a checksum
  // failure, because "this is not an account number" is what the owner
  // needs to read.
  if (!/^[A-Z]{2}[0-9]{2}[A-Z0-9]+$/.test(compact)) {
    return { kind: "unknown-country", country: compact.slice(0, 2) };
  }
  const country = compact.slice(0, 2);
  const expected = ACCOUNT_NUMBER_LENGTH_BY_COUNTRY.get(country);
  if (expected === undefined) {
    return { kind: "unknown-country", country };
  }
  if (compact.length !== expected) {
    return { kind: "wrong-length", country, expected, actual: compact.length };
  }
  if (mod97(compact) !== 1) {
    return { kind: "checksum-failed" };
  }
  return undefined;
};

// THE WHITESPACE CLASS THIS MODULE REMOVES, PUBLISHED SO A SECOND CONSUMER
// REUSES IT RATHER THAN WRITING A THIRD ANSWER (M3-P13 fix round, finding
// HZ-M3P13-01). canonicalAccountNumber strips /\s/, which includes the three
// no-break spaces; the display masker in src/platform/ui/mask-account-number.ts
// had its own separator rule that accepted the ASCII space alone, so the tree
// held two different answers to what separates an account number and the
// masker FAILED OPEN on the difference. It now asks this predicate. Anything
// else that needs the question answered asks here too.
export const isAccountNumberWhitespace = (character: string): boolean =>
  /\s/.test(character);

// The registry's shortest and longest entries, DERIVED from the table rather
// than written down beside it, so a country added to the table cannot leave
// a hand-written bound stale.
export const ACCOUNT_NUMBER_LENGTH_BOUNDS: {
  readonly shortest: number;
  readonly longest: number;
} = {
  shortest: Math.min(...ACCOUNT_NUMBER_LENGTH_BY_COUNTRY.values()),
  longest: Math.max(...ACCOUNT_NUMBER_LENGTH_BY_COUNTRY.values()),
};

// THE ISO 7064 CHECK ALONE, over an already-canonical value, with no country
// and no length test in front of it (M3-P13 fix round, finding HZ-M3P13-04).
// It exists so the display masker can FAIL CLOSED on a country this registry
// does not carry.
//
// CORRECTED LOUDLY IN ROUND TWO (clause R-087, finding CR2-M3P13-03). This
// paragraph used to say: "a checksum is a grammar test rather than a shape
// test, so it cannot fire on a mandate reference, a card number or a phone
// number". THE MANDATE-REFERENCE HALF WAS FALSE, and not marginally: the ISO
// 11649 structured creditor reference is RF, two check digits and an
// alphanumeric body, and its check is THIS check, over the same
// rearrangement, so a valid RF reference satisfies this predicate by
// construction. Probe-confirmed at lengths 16, 20 and 24. What is true: this
// predicate cannot fire on a value carrying no country-code grammar at all,
// which is what keeps a card number and a phone number intact, and the one
// family that shares the arithmetic is the RF family, which the masker
// refuses BY NAME rather than by hoping it cannot arise
// (src/platform/ui/mask-account-number.ts, CREDITOR_REFERENCE_PREFIX). It is NOT a validity test and no registration
// path may use it: DR-0028 requires all four tests, and accountNumberProblem
// above is the only place that answers "is this an account number".
export const accountNumberChecksumHolds = (value: string): boolean => {
  const compact = canonicalAccountNumber(value);
  return /^[A-Z]{2}[0-9]{2}[A-Z0-9]+$/.test(compact) && mod97(compact) === 1;
};

// The same four tests read as a predicate. This is what the merchants
// trust gate and the ledger comparisons consult; nothing re-derives it.
export const isValidAccountNumber = (value: string | undefined): boolean =>
  value !== undefined && accountNumberProblem(value) === undefined;
