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

import { classifyFlow, type Classification } from "./classify-flow";
import { TRANSFER_DATE_TOLERANCE_DAYS } from "./constants";
import { buildOutgoingHistoryKeys } from "./corrections";
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
}): LedgerInterpretation => {
  const sets = deriveDeclaredSets(input.accounts);
  const potTransactions = input.transactions.filter((transaction) =>
    sets.potAccountIds.has(transaction.accountId),
  );
  const cardImports = summarizeCardImports(potTransactions, sets);
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

  // Settlement links: pair each settled debit with the card-side mirror
  // row on the settled statement's account, deterministically (smallest
  // date distance, then lowest transaction id; each row used once). The
  // date window between the two legs of one direct debit is the transfer
  // tolerance (decision D-7): they are the same movement seen twice.
  const settledDebits = potTransactions
    .filter((t) => classifications.get(t.id)?.settledCardImportId !== undefined)
    .sort((a, b) => compareIds(a.id, b.id));
  const mirrorCredits = potTransactions
    .filter((t) => classifications.get(t.id)?.settlementMirror === true)
    .sort((a, b) => compareIds(a.id, b.id));
  const cardImportById = new Map(cardImports.map((c) => [c.importId, c]));
  const usedMirrors = new Set<string>();
  const settlements: SettlementLink[] = [];
  for (const debit of settledDebits) {
    const cardImportId = classifications.get(debit.id)?.settledCardImportId;
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
