// The reconciliation identity, the quality bar of the whole product
// (pulse-v1-plan.md: "a finance overview that does not reconcile is a
// spreadsheet with better fonts"):
//
//   income - spend - netToReserves === changeInPot
//
// Exact, integer cents, zero tolerance. changeInPot comes from the FACTS
// side only: the sum of raw transaction amounts over pot accounts. Income,
// spend and net-to-reserves come from the interpretation. When the
// identity does not hold, the difference is computed and surfaced with its
// causes, never hidden and never rounded away (charter stop-for list: any
// change to this identity is an escalation).

import type { Cents } from "@/platform/money";
import type { LedgerInterpretation } from "./interpret";
import type { LedgerTransaction } from "./ledger-transaction";

export type ReconciliationReport = {
  // Positive: what entered the pot from outside.
  readonly incomeCents: Cents;
  // Positive: what left the pot to outside (refunds subtract: they are
  // SPEND with a positive raw amount).
  readonly spendCents: Cents;
  // Positive when the pot parked money in reserves this period; a
  // drawdown pushes it down.
  readonly netToReservesCents: Cents;
  // Facts side only: the sum of raw amounts over pot transactions.
  readonly changeInPotCents: Cents;
  // changeInPot - (income - spend - netToReserves). Zero when the books
  // close.
  readonly differenceCents: Cents;
  // The surfaced causes: the difference equals their sum, exactly.
  readonly unresolvedGapCents: Cents;
  readonly unmatchedInternalGapCents: Cents;
  readonly reconciles: boolean;
};

// SIBLING RULE (fix round 1 of M1-P5, finding CR-501, recorded at the
// mechanism's definition per the fleet's mechanism-sibling clause): a
// boolean derived from the RESIDUAL ALONE must never be rendered as a
// user-facing verdict. Cancelling gaps (two unmatched legs whose
// amounts sum to zero) leave `reconciles` true here while
// unresolvedIds/unmatchedInternalIds are non-empty; over a full window
// that is honest as an IDENTITY statement, but any consumer showing it
// as "the books close" must ALSO require the gap lists to be empty,
// exactly as the month view's MonthFigures.reconciles does
// (src/modules/overview/domain/month-projection.ts). The month
// projection additionally names matched legs whose partner books
// outside the viewed month; that case cannot arise here because
// pairing runs inside the interpreted set, so both legs of a matched
// pair are always in this report's window.
export const reconcile = (
  transactions: readonly LedgerTransaction[],
  interpretation: LedgerInterpretation,
): ReconciliationReport => {
  let income = 0;
  let spendSigned = 0;
  let reserveSigned = 0;
  let changeInPot = 0;
  for (const transaction of transactions) {
    const flow = interpretation.flows.get(transaction.id);
    if (flow === undefined) {
      // A transaction outside the interpreted set (a non-pot account row)
      // takes no part in the identity.
      continue;
    }
    changeInPot += transaction.amountCents;
    if (flow === "INCOME") {
      income += transaction.amountCents;
    } else if (flow === "SPEND") {
      spendSigned += transaction.amountCents;
    } else if (flow === "RESERVE") {
      reserveSigned += transaction.amountCents;
    }
  }

  // 0 - x rather than -x: unary negation of 0 yields -0, which is not
  // Object.is-equal to 0 and would leak into assertions and JSON.
  const spend = 0 - spendSigned;
  const netToReserves = 0 - reserveSigned;
  const difference = changeInPot - (income - spend - netToReserves);

  const amountById = new Map(
    transactions.map((transaction) => [transaction.id, transaction.amountCents]),
  );
  const sumOf = (ids: readonly string[]): number =>
    ids.reduce((total, id) => total + (amountById.get(id) ?? 0), 0);
  const unresolvedGap = sumOf(interpretation.unresolvedIds);
  const unmatchedInternalGap = sumOf(interpretation.unmatchedInternalIds);

  return {
    incomeCents: income as Cents,
    spendCents: spend as Cents,
    netToReservesCents: netToReserves as Cents,
    changeInPotCents: changeInPot as Cents,
    differenceCents: difference as Cents,
    unresolvedGapCents: unresolvedGap as Cents,
    unmatchedInternalGapCents: unmatchedInternalGap as Cents,
    reconciles: difference === 0,
  };
};
