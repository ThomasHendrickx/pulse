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

// Cash withdrawal patterns, code-owned. Money that leaves the pot through
// one of these has "cash" as its own destination, never split, never
// guessed at (pulse-domain section 3).
export const CASH_WITHDRAWAL_PATTERNS: readonly RegExp[] = [
  /GELDOPNAME/i,
  /GELDAFHALING/i,
  /CASH\s+WITHDRAWAL/i,
];

export const matchesAny = (
  text: string,
  patterns: readonly RegExp[],
): boolean => patterns.some((pattern) => pattern.test(text));
