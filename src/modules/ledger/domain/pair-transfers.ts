// Transfer pairing: the only algorithm in v1 with real edge cases. It is
// deterministic, order-independent and idempotent: re-running over the
// same data produces the identical pair set, which is what makes recompute
// safe (pulse-domain section 4, hazard H2.3).
//
// A candidate pair requires ALL of (pulse-v1-architecture.md):
//   1. Both legs in pot accounts of the same household, different accounts.
//   2. Amounts exactly opposite.
//   3. Booking dates within TRANSFER_DATE_TOLERANCE_DAYS (decision D-7).
//   4. Each leg's counterparty account matches the other leg's account.
//
// Where several candidates fit: smallest date difference, then lowest
// transaction id. Never insertion order, never whatever the database
// returns first.
//
// Reserve movements are NEVER paired: the reserve statements are not
// imported, so classification from the pot side is sufficient and complete
// (pulse-v1-architecture.md). Callers pass only INTERNAL transfer legs.

import { canonicalAccountNumber } from "@/platform/account-number";
import { TRANSFER_DATE_TOLERANCE_DAYS } from "./constants";
import type { DeclaredSets, LedgerTransaction } from "./ledger-transaction";
import { dayDistance } from "./plain-date-distance";

export type TransferPair = {
  readonly outgoingId: string;
  readonly incomingId: string;
};

export type PairingResult = {
  readonly pairs: readonly TransferPair[];
  // Legs whose partner is absent: still INTERNAL, still excluded from
  // both sides, surfaced as "waiting for the other side" (criterion 2.5).
  readonly unmatchedIds: readonly string[];
};

const compareIds = (a: string, b: string): number =>
  a < b ? -1 : a > b ? 1 : 0;

export const pairInternalTransfers = (
  legs: readonly LedgerTransaction[],
  sets: DeclaredSets,
): PairingResult => {
  const accountIban = new Map<string, string>();
  for (const [iban, accountId] of sets.potIbanToAccountId) {
    accountIban.set(accountId, iban);
  }

  const outgoing = legs.filter((leg) => leg.amountCents < 0);
  const incoming = legs.filter((leg) => leg.amountCents > 0);

  type Edge = {
    readonly out: LedgerTransaction;
    readonly inc: LedgerTransaction;
    readonly distance: number;
  };
  const edges: Edge[] = [];
  for (const out of outgoing) {
    for (const inc of incoming) {
      if (out.accountId === inc.accountId) {
        continue;
      }
      if (
        !sets.potAccountIds.has(out.accountId) ||
        !sets.potAccountIds.has(inc.accountId)
      ) {
        continue;
      }
      if (inc.amountCents !== -out.amountCents) {
        continue;
      }
      const distance = dayDistance(out.bookingDate, inc.bookingDate);
      if (distance > TRANSFER_DATE_TOLERANCE_DAYS) {
        continue;
      }
      // Canonical on both sides (M3-P14, criterion 14.4): accountIban
      // carries the canonical declared form, the leg's counterparty column
      // is the fact the source printed, and one account is written spaced
      // on one path and compact on another.
      if (
        out.counterpartyIban === undefined ||
        canonicalAccountNumber(out.counterpartyIban) !==
          accountIban.get(inc.accountId)
      ) {
        continue;
      }
      if (
        inc.counterpartyIban === undefined ||
        canonicalAccountNumber(inc.counterpartyIban) !==
          accountIban.get(out.accountId)
      ) {
        continue;
      }
      edges.push({ out, inc, distance });
    }
  }

  // Content-ordered greedy matching: the sort key is (date distance,
  // outgoing id, incoming id), all properties of the DATA, so the result
  // cannot depend on insertion order.
  edges.sort((a, b) => {
    if (a.distance !== b.distance) {
      return a.distance - b.distance;
    }
    const byOut = compareIds(a.out.id, b.out.id);
    if (byOut !== 0) {
      return byOut;
    }
    return compareIds(a.inc.id, b.inc.id);
  });

  const used = new Set<string>();
  const pairs: TransferPair[] = [];
  for (const edge of edges) {
    if (used.has(edge.out.id) || used.has(edge.inc.id)) {
      continue;
    }
    used.add(edge.out.id);
    used.add(edge.inc.id);
    pairs.push({ outgoingId: edge.out.id, incomingId: edge.inc.id });
  }

  const unmatchedIds = legs
    .filter((leg) => !used.has(leg.id))
    .map((leg) => leg.id)
    .sort(compareIds);

  return {
    pairs: [...pairs].sort(
      (a, b) => compareIds(a.outgoingId, b.outgoingId) || compareIds(a.incomingId, b.incomingId),
    ),
    unmatchedIds,
  };
};
