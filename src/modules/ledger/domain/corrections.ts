// The four corrections that decide whether the numbers are right
// (pulse-domain section 3, pulse-v1-plan.md corrections list). Each is a
// named pure function; classify-flow.ts composes them in the declared
// order. Any change to the MEANING of a correction is an escalation per
// the charter's stop-for list, never a local call.

import {
  CASH_WITHDRAWAL_PATTERNS,
  SETTLEMENT_CREDIT_PATTERNS,
  SETTLEMENT_DATE_WINDOW_DAYS,
  SETTLEMENT_DEBIT_PATTERNS,
  matchesAny,
} from "./constants";
import type {
  CardImportSummary,
  DeclaredSets,
  LedgerTransaction,
} from "./ledger-transaction";
import { dayDistance } from "./plain-date-distance";

// CORRECTION 1: card settlement (owner v0.2 addendum section 5, which
// binds v0.1; decision D-11, superseding the reviewer-proposed
// declared-identifier mechanism). A debit matching a code-owned settlement
// pattern whose amount equals an imported card statement's settlement
// total, within SETTLEMENT_DATE_WINDOW_DAYS of that statement's period
// end, is INTERNAL and paired to that card import: the card's own line
// items are the only counted spend (hazard H2.1, the double-count trap).
// The card-side positive settlement row is INTERNAL as the mirror leg.
// A settlement-pattern debit with NO matching card import stays SPEND,
// aggregated against the card issuer as merchant: the honest reading of a
// card whose statements the household does not import (criterion 2.8,
// hazard H2.6). Never INTERNAL without a match, never UNRESOLVED.
export type SettlementCorrection =
  | { readonly kind: "settled-debit"; readonly cardImportId: string }
  | { readonly kind: "mirror-credit" }
  | { readonly kind: "unitemised-card-spend" };

export const correctCardSettlement = (
  transaction: LedgerTransaction,
  sets: DeclaredSets,
  cardImports: readonly CardImportSummary[],
): SettlementCorrection | undefined => {
  if (
    transaction.amountCents > 0 &&
    sets.cardAccountIds.has(transaction.accountId) &&
    matchesAny(transaction.description, SETTLEMENT_CREDIT_PATTERNS)
  ) {
    return { kind: "mirror-credit" };
  }
  if (
    transaction.amountCents >= 0 ||
    !matchesAny(transaction.description, SETTLEMENT_DEBIT_PATTERNS)
  ) {
    return undefined;
  }
  const magnitude = -transaction.amountCents;
  const candidates = cardImports.filter(
    (candidate) =>
      candidate.accountId !== transaction.accountId &&
      candidate.settlementTotalCents === magnitude &&
      candidate.settlementTotalCents > 0 &&
      dayDistance(transaction.bookingDate, candidate.periodEnd) <=
        SETTLEMENT_DATE_WINDOW_DAYS,
  );
  if (candidates.length === 0) {
    return { kind: "unitemised-card-spend" };
  }
  // Deterministic choice among candidates, the same shape as transfer
  // pairing's tie-break (decision D-7): smallest date distance to the
  // statement's period end, then lowest import id.
  const best = [...candidates].sort((a, b) => {
    const byDistance =
      dayDistance(transaction.bookingDate, a.periodEnd) -
      dayDistance(transaction.bookingDate, b.periodEnd);
    if (byDistance !== 0) {
      return byDistance;
    }
    return a.importId < b.importId ? -1 : 1;
  })[0];
  if (best === undefined) {
    return { kind: "unitemised-card-spend" };
  }
  return { kind: "settled-debit", cardImportId: best.importId };
};

// CORRECTION 2: reserve drawdown (hazard H2.2). Money coming back from a
// reserve account into the pot is a negative reserve movement, NEVER
// income: without this, income spikes the month something big is funded
// from savings. The parking direction is the plain reserve-set check; this
// named function is the incoming half, so the rule "never income" has a
// name and its own test.
export const correctReserveDrawdown = (
  transaction: LedgerTransaction,
  reserveIbans: ReadonlySet<string>,
): "RESERVE" | undefined =>
  transaction.amountCents > 0 &&
  transaction.counterpartyIban !== undefined &&
  reserveIbans.has(transaction.counterpartyIban)
    ? "RESERVE"
    : undefined;

// CORRECTION 3: refunds. Incoming money from a counterparty with outgoing
// history is SPEND with a positive amount, never INCOME: it nets against
// that counterparty's spend and keeps the income side honest and small.
// The counterparty identity here is the pre-merchant-resolution key below;
// M1-P4's resolver refines grouping, not this rule.
export const correctRefund = (
  transaction: LedgerTransaction,
  outgoingHistoryKeys: ReadonlySet<string>,
): "SPEND" | undefined =>
  transaction.amountCents > 0 &&
  outgoingHistoryKeys.has(counterpartyKey(transaction))
    ? "SPEND"
    : undefined;

// CORRECTION 4: cash withdrawals. Money leaves the pot and its destination
// is unknowable from the data: it gets "cash" as its own destination,
// never split, never guessed at. The flow stays SPEND; the marker is what
// the merchant resolver (M1-P4) groups by.
export const correctCashWithdrawal = (
  transaction: LedgerTransaction,
): { readonly flow: "SPEND"; readonly destination: "cash" } | undefined =>
  transaction.amountCents < 0 &&
  matchesAny(transaction.description, CASH_WITHDRAWAL_PATTERNS)
    ? { flow: "SPEND", destination: "cash" }
    : undefined;

// The pre-merchant-resolution counterparty identity used by the refund
// correction: IBAN when the row carries one, otherwise the counterparty
// name, otherwise the description, normalised the minimal way (uppercase,
// collapse whitespace, trim). This is NOT the merchants module's richer
// normalisation (M1-P4); it exists so refunds work before merchants do.
export const counterpartyKey = (transaction: LedgerTransaction): string => {
  if (transaction.counterpartyIban !== undefined) {
    return `iban:${transaction.counterpartyIban.toUpperCase().replace(/\s+/g, "")}`;
  }
  const text = transaction.counterpartyName ?? transaction.description;
  return `text:${text.toUpperCase().replace(/\s+/g, " ").trim()}`;
};

export const buildOutgoingHistoryKeys = (
  transactions: readonly LedgerTransaction[],
): ReadonlySet<string> => {
  const keys = new Set<string>();
  for (const transaction of transactions) {
    if (transaction.amountCents < 0) {
      keys.add(counterpartyKey(transaction));
    }
  }
  return keys;
};
