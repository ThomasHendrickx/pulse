// THE COUNTERPARTY IDENTITY (M3-P12, DR-0027). What a merchant naming is
// written against, and what a later transaction is matched on. One pure
// function, one definition, called by every place that groups or resolves a
// counterparty: the merchant review builder, the ledger's interpret window,
// the overview fold and assignMerchant.
//
// WHY IT EXISTS. Before this, a rule matched on the whole normalised
// counterparty TEXT, which for a transfer row is the whole description
// including a free-text communication and a per-transaction reference. Every
// such row was therefore its own group, so a naming matched the one row it
// was written from and never the next one. Measured through the shipped
// pipeline on the owner's real month: the rows carrying a counterparty
// account produced one distinct key per row over strictly fewer distinct
// accounts, and every account appearing on more than one row disagreed on
// every row. That is the merchant review's promise failing in front of the
// owner, which is the defect DR-0027 answers.
//
// THE TWO BASES, and the asymmetry between them (decision D-43).
//
//   account:<COMPACT UPPERCASE ACCOUNT>   where the row carries a
//                                         counterparty account AND that
//                                         account is TRUSTED
//   descriptor:<normaliseCounterparty(counterpartyText(row))>  otherwise
//
// Where the account branch applies, NOTHING ELSE IS CONSULTED: not the
// counterparty name, not the description, not the communication (DR-0027,
// decision D-37). The same account is the same counterparty, always, and the
// accepted cost is that two purposes paid to one counterparty land in one
// group; separating them is a tag question, not a merchant question.
//
// THE NAMESPACES ARE LOWERCASE ON PURPOSE and the collision-freedom is
// STRUCTURAL rather than a matter of inspection: normaliseCounterparty
// uppercases its input (normalise-counterparty.ts, the first line of the
// exported function), so it can never emit a lowercase letter and therefore
// no descriptor key can ever begin with either namespace. A test in
// test/domain/counterparty-identity.test.ts asserts the uppercase property
// directly rather than trusting this sentence.
//
// THE SIBLING THAT IS DELIBERATELY NOT UNIFIED WITH THIS ONE: the ledger's
// refund key at src/modules/ledger/domain/corrections.ts uses the same
// `iban:` / text shape and must keep its own copy. The warning at the head
// of normalise-counterparty.ts says why: that key feeds FLOW
// CLASSIFICATION, and swapping this derivation in would move flows, where
// resolution must rename and regroup and never reclassify (hazard H3.2).
// Their sameness of shape is a coincidence of value, not a shared decision.
//
// MECHANISM RULE, RECORDED AT THE DEFINITION (clause mechanism-sibling).
// The mechanism is DERIVING A GROUPING KEY FROM A ROW'S STORED FIELDS. Its
// rule: a key derived from a value that is not validated must FAIL CLOSED to
// the longer, more specific key rather than open to the shorter one, because
// a visible failure to converge is recoverable by the owner and a silent
// merge of two counterparties' money is not. THE SIBLING IMPLEMENTATIONS of
// this mechanism in this tree are src/modules/ledger/domain/corrections.ts
// (counterpartyKey, for refund correction), src/modules/import/domain/dedup.ts
// (the frozen dedup hash) and src/modules/merchants/domain/normalise-counterparty.ts
// (the descriptor normaliser, whose non-destructive floor is the same rule
// one tier down). The rule is not local to this file.

import { counterpartyText, normaliseCounterparty } from "./normalise-counterparty";

export const ACCOUNT_NAMESPACE = "account:";
export const DESCRIPTOR_NAMESPACE = "descriptor:";

// Both namespaces, for the callers that must decide whether a string is
// already an identity key (assignMerchant's write-boundary guard, the
// re-derivation's pass one, matchRules' refusal).
export const IDENTITY_NAMESPACES = [ACCOUNT_NAMESPACE, DESCRIPTOR_NAMESPACE] as const;

export type CounterpartyIdentityBasis = "account" | "descriptor";

export type CounterpartyIdentity = {
  readonly key: string;
  readonly basis: CounterpartyIdentityBasis;
};

export type CounterpartyIdentityRow = {
  readonly description: string;
  readonly counterpartyName?: string;
  readonly counterpartyAccount?: string;
};

// THE ACCOUNT-LENGTH TABLE (criterion 12.22). Source: the ISO 13616 IBAN
// Registry published by SWIFT as the registration authority, which assigns
// each participating country code exactly one total IBAN length. Populated
// FROM THAT REGISTRY rather than from the countries this project has seen,
// because a table grown from observed data is a table that silently refuses
// the first row of the next country.
//
// A COUNTRY CODE THIS TABLE DOES NOT CARRY IS REFUSED, never admitted on a
// length guess: admitting it is what would let a truncated value through.
// The full contents are pinned by a regression test
// (test/domain/counterparty-identity.test.ts), so adding, removing or
// altering an entry is RED rather than silent (hazard H12.28). Widening the
// table is a deliberate act with a test update beside it; that is the same
// discipline the card-descriptor shapes one tier down already carry in
// normalise-counterparty.ts.
export const IBAN_LENGTH_BY_COUNTRY: ReadonlyMap<string, number> = new Map([
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

// Uppercase and drop every whitespace character. This is the ONLY
// transformation the account branch applies: no masking (a masked key could
// never match a second transaction, hazard H6.4 one module over), no
// truncation, no repair.
export const compactAccount = (value: string): string =>
  value.replace(/\s/g, "").toUpperCase();

// ISO 7064 mod-97-10, computed in chunks so no intermediate exceeds the
// safe integer range. Letters carry their position value (A = 10 ... Z = 35).
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

// THE TRUST GATE (decision D-43, criterion 12.16). THREE tests, and a value
// failing ANY of them is not trusted.
//
// The gate exists because the counterparty account is NOT a structured
// field on the path that matters. The Belfius template SCRAPES it out of
// free text with a regex whose account shape is the Belgian one
// (src/modules/import/domain/belfius-current-account-template.ts, the
// DESCRIPTION_IBAN constant), so a longer-than-Belgian account written in
// spaced groups matches a SIXTEEN-CHARACTER PREFIX of itself and two
// different foreign accounts differing only after the twelfth digit are
// stored as ONE value. Nothing in src validates the stored column.
//
// WHY BOTH THE LENGTH TEST AND mod-97, RATHER THAN EITHER. Truncation can
// only ever emit a sixteen-character value, so it only reaches accounts
// whose true length exceeds sixteen, and such a value always carries a
// country code whose table length is not sixteen: the LENGTH test closes
// truncation DETERMINISTICALLY. mod-97 alone would leave a residual of
// roughly one in ninety-seven, uniform across source lengths, which is a
// silent merge every hundredth time rather than never.
//
// WHAT REFUSAL COSTS: a refused value takes the descriptor basis, which is
// EXACTLY today's behaviour for that row. Nothing is lost by refusing and a
// silent merge is what is risked by admitting, which is the asymmetry
// decision D-43 fixes.
export const isTrustedCounterpartyAccount = (value: string | undefined): boolean => {
  if (value === undefined) {
    return false;
  }
  const compact = compactAccount(value);
  if (compact === "") {
    return false;
  }
  if (!/^[A-Z]{2}[0-9]{2}[A-Z0-9]+$/.test(compact)) {
    return false;
  }
  const expected = IBAN_LENGTH_BY_COUNTRY.get(compact.slice(0, 2));
  if (expected === undefined || compact.length !== expected) {
    return false;
  }
  return mod97(compact) === 1;
};

// Which basis a key was produced under, read from its namespace. This is
// what D-40's refusal in matchRules consults and what assignMerchant's
// write-boundary guard consults; neither re-derives the basis from a row.
export const identityBasisOfKey = (
  key: string,
): CounterpartyIdentityBasis | undefined => {
  if (key.startsWith(ACCOUNT_NAMESPACE)) {
    return "account";
  }
  if (key.startsWith(DESCRIPTOR_NAMESPACE)) {
    return "descriptor";
  }
  return undefined;
};

export const counterpartyIdentity = (
  row: CounterpartyIdentityRow,
): CounterpartyIdentity => {
  const account = row.counterpartyAccount;
  if (isTrustedCounterpartyAccount(account)) {
    // The narrowing above is on the trust predicate rather than on the
    // field, so the non-null assertion is avoided by re-reading the field.
    return {
      key: `${ACCOUNT_NAMESPACE}${compactAccount(account ?? "")}`,
      basis: "account",
    };
  }
  // NO NEW STRIPPING AND NO FALLBACK BUCKET (decision D-38, criterion 12.6).
  // The suffix is byte-identical to the key this row had before this phase:
  // a row whose account is absent or refused, and a row whose descriptor
  // matches no family, both keep exactly the key they have today. Neither is
  // ever given a shorter key that could merge it with something else.
  return {
    key: `${DESCRIPTOR_NAMESPACE}${normaliseCounterparty(counterpartyText(row))}`,
    basis: "descriptor",
  };
};
