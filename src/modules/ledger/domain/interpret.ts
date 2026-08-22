// The interpretation engine as one pure function: classification, the
// settlement links, transfer pairing, and the surfaced gaps, over whatever
// set of pot-account transactions it is given. The APPLICATION layer
// decides the set (a period window across all pot accounts after an
// import, everything on recompute); the engine itself has no notion of an
// import (pulse-v1-architecture.md: interpretation runs over a window,
// never over the imported rows).
//
// Everything here is derived, disposable and rebuildable from facts plus
// declarations. Nothing here writes; persistence is an adapter concern.

import type { Cents } from "@/platform/money";
import { classifyFlow, type Classification } from "./classify-flow";
import { TRANSFER_DATE_TOLERANCE_DAYS } from "./constants";
import {
  buildOutgoingHistoryKeys,
  settlementCandidateImports,
} from "./corrections";
import type { Flow } from "./flow";
import {
  deriveDeclaredSets,
  summarizeCardImports,
  type DeclaredAccount,
  type LedgerTransaction,
} from "./ledger-transaction";
import { pairInternalTransfers, type TransferPair } from "./pair-transfers";
import { dayDistance } from "./plain-date-distance";

export type SettlementLink = {
  readonly debitTransactionId: string;
  readonly cardImportId: string;
  // The card-side settlement row, when its statement has been imported.
  // Absent, the debit leg is surfaced as waiting for the other side.
  readonly mirrorCreditTransactionId?: string;
};

export type LedgerInterpretation = {
  readonly flows: ReadonlyMap<string, Flow>;
  readonly transferPairs: readonly TransferPair[];
  readonly settlements: readonly SettlementLink[];
  // INTERNAL legs whose opposite side is absent from the interpreted set:
  // unpartnered transfer legs, settlement debits without their card-side
  // row, card-side settlement rows without their debit. Excluded from both
  // sides, surfaced, never dropped (criterion 2.5).
  readonly unmatchedInternalIds: readonly string[];
  readonly unresolvedIds: readonly string[];
  // Rows the cash-withdrawal correction marked: destination "cash".
  readonly cashTransactionIds: readonly string[];
};

const compareIds = (a: string, b: string): number =>
  a < b ? -1 : a > b ? 1 : 0;

export const interpretLedger = (input: {
  readonly transactions: readonly LedgerTransaction[];
  readonly accounts: readonly DeclaredAccount[];
  // The refund correction's outgoing history is SCOPE-FREE (finding
  // CR-303): a window run passes the household's full outgoing history
  // here so the same row classifies identically under a window and under
  // recompute. When absent (recompute, pure-domain tests over complete
  // datasets), history is derived from the given transactions.
  readonly outgoingHistoryKeys?: ReadonlySet<string>;
  // Import id to the settlement figure that import's own statement
  // carries (fix round 2, finding HZ-M3P3-01). Absent entries fall back
  // to the row-sum derivation; an absent map is the pure-domain default
  // for a dataset built from rows alone.
  readonly statementSettlementTotals?: ReadonlyMap<string, Cents>;
}): LedgerInterpretation => {
  const sets = deriveDeclaredSets(input.accounts);
  const potTransactions = input.transactions.filter((transaction) =>
    sets.potAccountIds.has(transaction.accountId),
  );
  const cardImports = summarizeCardImports(
    potTransactions,
    sets,
    input.statementSettlementTotals,
  );
  const outgoingHistoryKeys =
    input.outgoingHistoryKeys ?? buildOutgoingHistoryKeys(potTransactions);

  const classifications = new Map<string, Classification>();
  const flows = new Map<string, Flow>();
  for (const transaction of potTransactions) {
    const classification = classifyFlow(transaction, {
      sets,
      cardImports,
      outgoingHistoryKeys,
    });
    classifications.set(transaction.id, classification);
    flows.set(transaction.id, classification.flow);
  }

  // Exclusive settlement allocation (finding CR-306): a statement is
  // settled ONCE, so each card import pairs with AT MOST ONE settlement
  // debit. Candidates are enumerated per debit and allocated globally by
  // the D-7-style tie-break, and losers fall through to the sign rule's
  // honest unitemised SPEND, the same arm a no-match debit takes, so an
  // exact-cent coincidence can never make real spend vanish onto an
  // already-settled statement.
  //
  // THE STRENGTH OF THE READING COMES FIRST (fix round 5, finding
  // HZ4-M3P3-01). An import with no printed figure can offer TWO totals,
  // because from the rows alone an unrecognised settlement credit and an
  // ordinary merchant refund are the same shape (ledger-transaction.ts).
  // The second of those is the weaker reading, and a review lane built the
  // link it uniquely enables: one statement's SECOND total coinciding with
  // another statement's ONLY total, with the weaker match nearer in time,
  // so a date-first tie-break credited the debit to the statement that did
  // not receive it. Every consequence of that was loud, and what it cost
  // was the settlement RECORD rather than the month, but a link made on
  // the weaker of two readings should lose to one made on the only reading
  // there is. So the order is now: matches on the import's PRIMARY total
  // (its printed figure, or its net when both derivations agree) before
  // one that matches only on the secondary; then the smallest date
  // distance to the statement's period end; then lowest transaction id;
  // then lowest import id. An import offering ONE total always matches on
  // its primary, so this subsumes "prefer the unambiguous import" without
  // punishing an ambiguous one that matches on its trustworthy reading.
  const patternDebits = potTransactions
    .filter((t) => classifications.get(t.id)?.settledCardImportId !== undefined)
    .sort((a, b) => compareIds(a.id, b.id));
  const settlementEdges = patternDebits
    .flatMap((debit) =>
      settlementCandidateImports(debit, cardImports).map((candidate) => ({
        debit,
        candidate,
        // 0 when the debit's magnitude is the import's PRIMARY total, 1
        // when it only equals a secondary candidate. An import with a
        // stored figure, or one whose two derivations agree, has exactly
        // one total and is therefore always 0.
        readingRank:
          candidate.settlementTotalsCents[0] === -debit.amountCents ? 0 : 1,
        distance: dayDistance(debit.bookingDate, candidate.periodEnd),
      })),
    )
    .sort(
      (a, b) =>
        a.readingRank - b.readingRank ||
        a.distance - b.distance ||
        compareIds(a.debit.id, b.debit.id) ||
        compareIds(a.candidate.importId, b.candidate.importId),
    );
  const allocatedDebits = new Set<string>();
  const allocatedImports = new Set<string>();
  const allocations = new Map<string, string>();
  for (const edge of settlementEdges) {
    if (
      allocatedDebits.has(edge.debit.id) ||
      allocatedImports.has(edge.candidate.importId)
    ) {
      continue;
    }
    allocatedDebits.add(edge.debit.id);
    allocatedImports.add(edge.candidate.importId);
    allocations.set(edge.debit.id, edge.candidate.importId);
  }
  const settledDebits: LedgerTransaction[] = [];
  for (const debit of patternDebits) {
    if (allocations.has(debit.id)) {
      settledDebits.push(debit);
    } else {
      // The loser of the exclusivity tie-break: honest aggregate SPEND,
      // never INTERNAL, never a surfaced gap.
      flows.set(debit.id, "SPEND");
    }
  }

  // Settlement links: pair each allocated debit with the card-side mirror
  // row on the settled statement's account, deterministically (smallest
  // date distance, then lowest transaction id; each row used once). The
  // date window between the two legs of one direct debit is the transfer
  // tolerance (decision D-7): they are the same movement seen twice.
  const mirrorCredits = potTransactions
    .filter((t) => classifications.get(t.id)?.settlementMirror === true)
    .sort((a, b) => compareIds(a.id, b.id));
  const cardImportById = new Map(cardImports.map((c) => [c.importId, c]));
  const usedMirrors = new Set<string>();
  const settlements: SettlementLink[] = [];
  for (const debit of settledDebits) {
    const cardImportId = allocations.get(debit.id);
    if (cardImportId === undefined) {
      continue;
    }
    const cardAccountId = cardImportById.get(cardImportId)?.accountId;
    const candidates = mirrorCredits
      .filter(
        (credit) =>
          !usedMirrors.has(credit.id) &&
          credit.accountId === cardAccountId &&
          credit.amountCents === -debit.amountCents &&
          dayDistance(debit.bookingDate, credit.bookingDate) <=
            TRANSFER_DATE_TOLERANCE_DAYS,
      )
      .sort((a, b) => {
        const byDistance =
          dayDistance(debit.bookingDate, a.bookingDate) -
          dayDistance(debit.bookingDate, b.bookingDate);
        return byDistance !== 0 ? byDistance : compareIds(a.id, b.id);
      });
    const mirror = candidates[0];
    if (mirror !== undefined) {
      usedMirrors.add(mirror.id);
      settlements.push({
        debitTransactionId: debit.id,
        cardImportId,
        mirrorCreditTransactionId: mirror.id,
      });
    } else {
      settlements.push({ debitTransactionId: debit.id, cardImportId });
    }
  }

  // Transfer pairing over the INTERNAL legs that are NOT settlement legs.
  // Reserve movements never reach pairing: they classified RESERVE.
  const settlementLegIds = new Set<string>();
  for (const link of settlements) {
    settlementLegIds.add(link.debitTransactionId);
    if (link.mirrorCreditTransactionId !== undefined) {
      settlementLegIds.add(link.mirrorCreditTransactionId);
    }
  }
  for (const credit of mirrorCredits) {
    // An unlinked mirror row is a settlement leg too: it must not enter
    // transfer pairing, it is simply waiting for its debit.
    settlementLegIds.add(credit.id);
  }
  const transferLegs = potTransactions.filter(
    (t) => flows.get(t.id) === "INTERNAL" && !settlementLegIds.has(t.id),
  );
  const pairing = pairInternalTransfers(transferLegs, sets);

  const unmatched = new Set<string>(pairing.unmatchedIds);
  for (const link of settlements) {
    if (link.mirrorCreditTransactionId === undefined) {
      unmatched.add(link.debitTransactionId);
    }
  }
  for (const credit of mirrorCredits) {
    if (!usedMirrors.has(credit.id)) {
      unmatched.add(credit.id);
    }
  }

  const unresolvedIds = potTransactions
    .filter((t) => flows.get(t.id) === "UNRESOLVED")
    .map((t) => t.id)
    .sort(compareIds);
  const cashTransactionIds = potTransactions
    .filter((t) => classifications.get(t.id)?.cashDestination === true)
    .map((t) => t.id)
    .sort(compareIds);

  return {
    flows,
    transferPairs: pairing.pairs,
    settlements,
    unmatchedInternalIds: [...unmatched].sort(compareIds),
    unresolvedIds,
    cashTransactionIds,
  };
};
