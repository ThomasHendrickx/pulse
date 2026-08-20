// Named policy constants of the interpretation engine. Every window and
// pattern the engine matches against lives here, named, so widening one is
// a one-line change plus a recompute.

// Transfer pairing date tolerance (decision D-7, from
// pulse-v1-architecture.md: "start at 4 days, bank timing is not tight").
export const TRANSFER_DATE_TOLERANCE_DAYS = 4;

// Card settlement matching window (owner v0.2 addendum section 5, decision
// D-11: "within a date window", held as a named constant). The window is
// measured between the settlement debit's booking date and the card
// statement's period end. 45 days spans a monthly statement cycle plus the
// direct-debit lag with room to spare; the match also requires the
// settlement pattern AND an exact amount, so the width buys robustness,
// not false positives.
export const SETTLEMENT_DATE_WINDOW_DAYS = 45;

// Settlement description patterns are CODE-OWNED (decision D-11), never
// user-declared. The debit side is the direct debit paying the card from a
// current account; the credit side is the same settlement arriving on the
// card ("DOMICILIERING VIA JE BANK", observed in the real KBC statement).
export const SETTLEMENT_DEBIT_PATTERNS: readonly RegExp[] = [
  /MASTERCARD\s+AFREKENING\s+NUMMER/i,
];

export const SETTLEMENT_CREDIT_PATTERNS: readonly RegExp[] = [
  /DOMICILIERING\s+VIA\s+JE\s+BANK/i,
];

// How far the interpretation window is padded on both sides when loading
// context around an import's period: wide enough that every settlement
// match (45 days) and every transfer partner (4 days) of a row inside the
// period is loaded. CORRECTED IN FIX ROUND 1 (finding CR-301) rather than
// quietly rewritten: this padding is NOT what protects settlement
// matching. A padded window can still truncate or hide a card import, so
// interpret-window.ts loads card accounts UNBOUNDED and settlement totals
// are always computed over complete card imports; the padding protects
// transfer pairing and nothing else. RESIDUE, STATED: a pair whose one
// leg sits exactly in the outer padding rim while its partner lies beyond
// it can be re-marked unmatched by a window run; recompute over
// everything is the canonical repair and the read model surfaces the leg
// rather than hiding it.
export const INTERPRETATION_WINDOW_PADDING_DAYS =
  SETTLEMENT_DATE_WINDOW_DAYS + TRANSFER_DATE_TOLERANCE_DAYS;

// Cash withdrawal patterns, code-owned. Money that leaves the pot through
// one of these has "cash" as its own destination, never split, never
// guessed at (pulse-domain section 3).
//
// SIBLING CONSUMER (M1-P5, open question M1P4-C7 resolved there): the
// month projection groups cash rows under their own "cash" destination
// WITH PRECEDENCE over any merchant assignment on the same row, and its
// raw SQL derives a Postgres `~*` predicate from these patterns' .source
// (src/modules/overview/adapters/overview-repository.ts). Two rules
// follow: every pattern here must stay valid Postgres ARE syntax with the
// same meaning (plain words and \s+ are; lookarounds and \b are NOT the
// same dialect), and the case-insensitivity lives in the `i` flag here
// and in `~*` there. One pattern list, two engines, so a new pattern is
// checked against both at the definition, which is this comment's job.
export const CASH_WITHDRAWAL_PATTERNS: readonly RegExp[] = [
  /GELDOPNAME/i,
  /GELDAFHALING/i,
  /CASH\s+WITHDRAWAL/i,
];

// The cash marker as a named predicate, published through the ledger's
// application index for the month projection (correction 4's consumer).
export const isCashWithdrawalDescription = (description: string): boolean =>
  matchesAny(description, CASH_WITHDRAWAL_PATTERNS);

export const matchesAny = (
  text: string,
  patterns: readonly RegExp[],
): boolean => patterns.some((pattern) => pattern.test(text));
