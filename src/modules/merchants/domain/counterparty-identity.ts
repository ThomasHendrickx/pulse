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

import {
  ACCOUNT_NUMBER_LENGTH_BY_COUNTRY,
  canonicalAccountNumber,
  isValidAccountNumber,
} from "@/platform/account-number";
import { counterpartyText, normaliseCounterparty } from "./normalise-counterparty";

export const ACCOUNT_NAMESPACE = "account:";
export const DESCRIPTOR_NAMESPACE = "descriptor:";

// THE FLOOR ON THIS DERIVATION (fix round, finding HZ-M3P12-01). A BARE
// NAMESPACE IS NOT AN IDENTITY. The descriptor branch calls a normaliser
// that returns the empty string for a row whose counterparty text is empty
// or whitespace, so `descriptor:` is a value this function CAN emit, and
// before the namespaces existed that same row produced the empty string,
// which the matcher refused at its first line and the writer refused before
// storing anything. Namespacing every key made the empty case NON-EMPTY and
// so turned a refused bucket into a live, nameable, matchable grouping key:
// two rows that carry no counterparty information at all would have shared
// one key, grouped, been named once and resolved to one merchant. That is
// the silent merge this whole phase exists to refuse, and it arrived inside
// the fix for it.
//
// The floor is NOT a shorter or a longer key, because there is nothing to
// derive one from: a row with no counterparty text and no trusted account
// carries no information about who it was paid to. It is a REFUSAL, and it
// is enforced at the three places that could act on such a key, each of
// which reads this predicate rather than re-deriving the rule:
//
//   the matcher       src/modules/merchants/domain/merchant-rule.ts
//   the write boundary src/modules/merchants/application/assign-merchant.ts
//   the review surface src/modules/merchants/domain/merchant-review.ts
//
// The rows still GROUP and their money still shows, exactly as it did
// before this phase; what they cannot do is be named or resolve, so no two
// of them can ever land on one merchant.
export const identityRemainder = (key: string): string | undefined => {
  if (key.startsWith(ACCOUNT_NAMESPACE)) {
    return key.slice(ACCOUNT_NAMESPACE.length);
  }
  if (key.startsWith(DESCRIPTOR_NAMESPACE)) {
    return key.slice(DESCRIPTOR_NAMESPACE.length);
  }
  return undefined;
};

// True for exactly `account:` and exactly `descriptor:`. False for a key
// carrying no namespace at all, which is a different refusal with a
// different error (assign-merchant.ts).
//
// STRICT, NOT TRIMMED, AND THE DIFFERENCE IS LOAD-BEARING. The first draft
// of this predicate treated a whitespace-only remainder as bare too, and the
// property test for criterion 12.21 refuted it in 218 cases: the pattern
// `descriptor: ` is a PREFIX rule that matched exactly what ` ` matched
// before the namespaces existed, so refusing it would have broken pass one's
// meaning-preservation for a rule that is not a sweep at all. Only the
// EXACTLY bare namespace is a prefix of every key of its basis, and only the
// exactly bare namespace is what the derivation can emit: normaliseCounterparty
// collapses and trims, and compactAccount removes whitespace, so neither
// branch can produce a blank remainder that is not empty.
//
// The WRITE boundary is deliberately stricter and trims, because a subject
// arriving from a form is not a derived key and a whitespace-only remainder
// there identifies nothing either. That asymmetry is stated at the boundary.
export const isBareIdentityKey = (key: string): boolean =>
  identityRemainder(key) === "";

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

// THE ACCOUNT-LENGTH TABLE AND THE CANONICAL FORM MOVED TO PLATFORM in
// M3-P14 (criterion 14.4). They used to be DEFINED here; four modules now
// need them and the ledger domain may not import from another module, so
// there is exactly one definition, in src/platform/account-number.ts, and
// these two names are aliases of it kept so the merchants module's own
// vocabulary does not change. The registry provenance, the refusal of an
// unknown country code and the pinning test's contract are all recorded at
// that definition.
export const IBAN_LENGTH_BY_COUNTRY = ACCOUNT_NUMBER_LENGTH_BY_COUNTRY;

// Uppercase and drop every whitespace character. This is the ONLY
// transformation the account branch applies: no masking (a masked key could
// never match a second transaction, hazard H6.4 one module over), no
// truncation, no repair.
export const compactAccount = canonicalAccountNumber;

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
// WHY BOTH THE LENGTH TEST AND mod-97, RATHER THAN EITHER, AND WHAT THEY DO
// NOT CLOSE. CORRECTED IN THE M3-P12 FIX ROUND, finding HZ-M3P12-05, and
// corrected rather than quietly rewritten because the sentence that stood
// here was FALSE and it was repeated in the plan and in a test name.
//
// WHAT IT SAID: truncation can only emit a sixteen-character value, so it
// only reaches accounts whose true length exceeds sixteen, and such a value
// always carries a country code whose table length is not sixteen, so the
// length test closes truncation DETERMINISTICALLY.
//
// WHY IT IS FALSE: the argument is about IBANs, and the scrape does not
// operate on IBANs. It operates on free text, matching a country code, two
// digits and exactly THREE four-digit groups
// (belfius-current-account-template.ts, the DESCRIPTION_IBAN constant). Once
// the source is allowed to be any token in that group grammar, the country
// code of the TRUNCATION is the country code of the prefix rather than of
// any real account: a Belgian-prefixed token written spaced with MORE than
// three groups truncates to a sixteen-character value whose country code IS
// BE and whose length IS the table's entry for BE. Demonstrated on two such
// invented sources differing only in their fourth group: both store one
// identical value, and that value passes all three tests.
//
// WHAT IS TRUE, and it is the whole of what these two tests buy:
//
//   The LENGTH test closes truncation of a token whose country code the
//   registry gives a length OTHER than sixteen, deterministically. That is
//   every non-Belgian source, which is the direction the fixture witnesses.
//
//   For a BE-prefixed over-long spaced token, the length test cannot fire,
//   because the truncation is a well-formed Belgian length. mod-97 alone
//   stands there, on the sixteen-character PREFIX rather than on the source,
//   and it leaves a residual of roughly one in ninety-seven. That residual
//   is REAL and it is not closed here.
//
// WHY IT IS NOT CLOSED HERE. Closing it means refusing a scrape match whose
// next characters continue the group grammar, which is a change to the
// IMPORTER's template and therefore a layout version bump and a re-parse of
// every stored source. That is not a fix-round change. It is recorded as a
// residual on the parked surface that already owns the scrape's ambiguity,
// beside hazard H12.16, with the counterexample pinned by a test so a later
// reader meets the fact rather than the old sentence.
//
// mod-97 alone, everywhere else, would leave a residual of roughly one in
// ninety-seven uniform across source lengths, which is why both tests are
// required and not either.
//
// WHAT REFUSAL COSTS: a refused value takes the descriptor basis, which is
// EXACTLY today's behaviour for that row. Nothing is lost by refusing and a
// silent merge is what is risked by admitting, which is the asymmetry
// decision D-43 fixes.
// THE TEST ITSELF IS PLATFORM'S (M3-P14, criterion 14.4): one canonical
// form, one country-length table, one mod-97 implementation, and this gate
// is the merchants module's DECISION about what to do with the answer, not
// a second copy of the test.
export const isTrustedCounterpartyAccount = (
  value: string | undefined,
): boolean => isValidAccountNumber(value);

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
  // The one bucket this branch CAN emit is the bare namespace, for a row
  // whose counterparty text normalises to empty. It is not a fallback: it is
  // refused by the matcher, by the write boundary and by the review surface,
  // through isBareIdentityKey above (finding HZ-M3P12-01).
  // The suffix is byte-identical to the key this row had before this phase:
  // a row whose account is absent or refused, and a row whose descriptor
  // matches no family, both keep exactly the key they have today. Neither is
  // ever given a shorter key that could merge it with something else.
  return {
    key: `${DESCRIPTOR_NAMESPACE}${normaliseCounterparty(counterpartyText(row))}`,
    basis: "descriptor",
  };
};
