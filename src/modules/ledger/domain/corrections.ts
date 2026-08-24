// The four corrections that decide whether the numbers are right
// (pulse-domain section 3, pulse-v1-plan.md corrections list). Each is a
// named pure function; classify-flow.ts composes them in the declared
// order. Any change to the MEANING of a correction is an escalation per
// the charter's stop-for list, never a local call.

import { canonicalAccountNumber } from "@/platform/account-number";
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
  const candidates = settlementCandidateImports(transaction, cardImports);
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

// Every card import a settlement-pattern debit COULD settle: different
// account, exact total, positive total, inside the settlement window.
// Exported separately (finding CR-306) because exclusivity is decided
// across debits: interpretLedger allocates each card import to at most
// one debit over these candidate sets, and correctCardSettlement's own
// best-candidate answer is the single-debit special case of that
// allocation.
export const settlementCandidateImports = (
  transaction: LedgerTransaction,
  cardImports: readonly CardImportSummary[],
): readonly CardImportSummary[] => {
  if (
    transaction.amountCents >= 0 ||
    !matchesAny(transaction.description, SETTLEMENT_DEBIT_PATTERNS)
  ) {
    return [];
  }
  const magnitude = -transaction.amountCents;
  return cardImports.filter(
    (candidate) =>
      candidate.accountId !== transaction.accountId &&
      // THE EQUALITY IS THE MECHANISM (fix round 3, finding
      // HZ2-M3P3-05): `magnitude` is strictly positive by construction
      // two lines above, so a card statement standing in credit, whose
      // figure is non-positive, equals no candidate and settles nothing.
      // The positivity guard is redundant against that equality, measured
      // by deleting it and watching the whole fast gate stay green; it is
      // kept as a cheap statement of intent, not as the thing that works.
      //
      // CANDIDATES, PLURAL (fix round 4, finding HZ3-M3P3-01): an import
      // with no printed figure carries every total its rows could
      // plausibly settle for, because from the rows alone an unrecognised
      // settlement credit and an ordinary merchant refund are the same
      // shape and they imply different totals. Matching ONE of them is
      // what identifies which; matching none leaves the debit loud, as
      // before. Exclusivity is unchanged: interpretLedger still allocates
      // each import to at most one debit.
      candidate.settlementTotalsCents.some(
        (total) => total === magnitude && total > 0,
      ) &&
      dayDistance(transaction.bookingDate, candidate.periodEnd) <=
        SETTLEMENT_DATE_WINDOW_DAYS,
  );
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
  // Both sides canonical at comparison time: the set side was canonicalised
  // in deriveDeclaredSets, this side is a FACT column and is never rewritten
  // (M3-P14, decision D-47).
  reserveIbans.has(canonicalAccountNumber(transaction.counterpartyIban))
    ? "RESERVE"
    : undefined;

// CORRECTION 3: refunds. Incoming money from a counterparty with outgoing
// history is SPEND with a positive amount, never INCOME: it nets against
// that counterparty's spend and keeps the income side honest and small.
// The counterparty identity here is the pre-merchant-resolution key below;
// M1-P4's resolver refines grouping, not this rule.
//
// THE CARD ARM (fix round 2, finding HZ-M3P3-06), decided explicitly here
// rather than left to fall through the sign rule. On an account in the
// DECLARED card set, a positive row that is not the settlement credit is a
// refund BY CONSTRUCTION: a card account has no other way to receive
// money. Nobody is paid a salary onto a Mastercard. The history test the
// counterparty arm applies cannot see it, because it keys on descriptor
// text (counterpartyKey below) and a merchant's refund line is almost
// never byte-identical to the purchase it reverses, so before this arm an
// ordinary card refund classified INCOME and reported money that never
// entered the household as income for the month. The treatment is the one
// correction 3 already gives a matched refund: SPEND with a positive
// amount, netting against that merchant's spend.
//
// The mirror credit does NOT reach here: correctCardSettlement runs first
// (classify-flow.ts step 3) and returns INTERNAL for it. This arm is
// therefore "positive, on a card account, and not the settlement leg".
// The shape became reachable when phase M3-P3 made card statements
// importable from PDF; the observed statement carries no refund row, so
// nothing shipped is misreported today, which is why the rule is written
// down now rather than discovered later from a wrong month total.
export const correctRefund = (
  transaction: LedgerTransaction,
  outgoingHistoryKeys: ReadonlySet<string>,
  cardAccountIds?: ReadonlySet<string>,
): "SPEND" | undefined =>
  transaction.amountCents > 0 &&
  (outgoingHistoryKeys.has(counterpartyKey(transaction)) ||
    cardAccountIds?.has(transaction.accountId) === true)
    ? "SPEND"
    : undefined;

// CORRECTION 4: cash withdrawals. Money leaves the pot and its destination
// is unknowable from the data: it gets "cash" as its own destination,
// never split, never guessed at. The flow stays SPEND.
//
// CORRECTED CLAIM (R-087, corrected by M1-P4 itself): this comment used to
// end "the marker is what the merchant resolver (M1-P4) groups by", and
// that prediction did not come true. M1-P4's resolver deliberately does
// NOT consume this marker: destination-cash grouping is projection work
// and lands with the month view, so until then a cash row resolves like
// any counted row (a rule matching its descriptor may name it). The month
// view's grouping must give THIS marker precedence over any merchant
// assignment on the same row, or "cash is its own destination, never
// split" stops being true on screen; recorded as an M1-P4 open question.
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
// Structural parameter on purpose: the full-ledger history read (finding
// CR-303) returns only these three fields.
export type CounterpartyRef = Pick<
  LedgerTransaction,
  "counterpartyIban" | "counterpartyName" | "description"
>;

// THE IBAN HALF OF THIS KEY USES THE PLATFORM CANONICAL FORM (M3-P14,
// criterion 14.4). It used to write out its own uppercase-plus-
// whitespace-removal expression here, which is a SECOND COPY of one
// transformation living inside an identity derivation: it agreed with
// the platform form on the day it was written and nothing held the two
// together afterwards. The TEXT half below is deliberately NOT the
// merchants module's richer normalisation and must never become it
// (hazard H6.1, and the sibling note at
// src/modules/merchants/domain/normalise-counterparty.ts): that is a
// different rule about a different mechanism.
export const counterpartyKey = (transaction: CounterpartyRef): string => {
  if (transaction.counterpartyIban !== undefined) {
    return `iban:${canonicalAccountNumber(transaction.counterpartyIban)}`;
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
