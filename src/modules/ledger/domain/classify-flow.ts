// Deterministic flow classification against the sets the user DECLARED,
// never sets the system guessed (pulse-v1-plan.md classification order;
// phase M1-P3 step 1). The order is the semantics:
//
//   1. Counterparty in the declared reserve set: RESERVE, signed by
//      direction (the incoming half is the reserve drawdown correction).
//   2. Counterparty in the declared pot set: INTERNAL.
//   3. The settlement-match step (owner v0.2 addendum section 5, decision
//      D-11), BETWEEN the declared-set checks and the sign fallback.
//   4. Otherwise sign decides: negative SPEND, positive INCOME, with the
//      refund and cash-withdrawal corrections applied on the way. On a
//      DECLARED CARD ACCOUNT the positive branch never reaches INCOME: a
//      card can only receive money as a settlement (step 3) or as a
//      merchant refund (finding HZ-M3P3-06).
//
// A row none of that reaches (a zero amount: no direction to read) is
// UNRESOLVED: shown as a visible gap, never dropped, never defaulted into
// a total (charter constraint).
//
// Whether an INTERNAL leg finds its partner is pairing's question, not
// classification's: an unmatched leg STAYS INTERNAL and is flagged by the
// interpretation (pulse-domain section 4).

import { canonicalAccountNumber } from "@/platform/account-number";
import type { Flow } from "./flow";
import {
  correctCardSettlement,
  correctCashWithdrawal,
  correctRefund,
  correctReserveDrawdown,
} from "./corrections";
import type {
  CardImportSummary,
  DeclaredSets,
  LedgerTransaction,
} from "./ledger-transaction";

export type ClassificationContext = {
  readonly sets: DeclaredSets;
  readonly cardImports: readonly CardImportSummary[];
  readonly outgoingHistoryKeys: ReadonlySet<string>;
};

export type Classification = {
  readonly flow: Flow;
  // Set when the settlement-match step paired this debit to a card import.
  readonly settledCardImportId?: string;
  // Set on the card-side positive settlement row (the mirror leg).
  readonly settlementMirror?: boolean;
  // Set by the cash-withdrawal correction: the row's destination is
  // "cash", its own destination, never split.
  readonly cashDestination?: boolean;
};

export const classifyFlow = (
  transaction: LedgerTransaction,
  context: ClassificationContext,
): Classification => {
  const { sets } = context;

  // THE COUNTERPARTY ACCOUNT COLUMN IS A FACT AND IS NEVER REWRITTEN
  // (pulse-domain section 2 rule 1), so it is canonicalised HERE, at
  // comparison time, against sets whose own side was canonicalised in
  // deriveDeclaredSets. Measured rather than supposed: every account-shaped
  // token in the owner's own current-account document is written spaced,
  // the delimited parse stores such a cell verbatim
  // (src/modules/import/domain/parse-statement.ts) while the PDF path
  // compacts it, so one household really does hold two surface forms of one
  // account. A raw comparison silently classifies nothing, which is exactly
  // the defect this round exists to remove.
  const counterparty =
    transaction.counterpartyIban === undefined
      ? undefined
      : canonicalAccountNumber(transaction.counterpartyIban);

  // 1. Declared reserve set, both directions. Outgoing parks money;
  // incoming is the drawdown correction: RESERVE, never INCOME.
  if (counterparty !== undefined && sets.reserveIbans.has(counterparty)) {
    return transaction.amountCents > 0
      ? { flow: correctReserveDrawdown(transaction, sets.reserveIbans) ?? "RESERVE" }
      : { flow: "RESERVE" };
  }

  // 2. Declared pot set: a movement between two of the household's own
  // pot accounts, excluded from both sides whatever pairing finds.
  if (counterparty !== undefined && sets.potIbans.has(counterparty)) {
    return { flow: "INTERNAL" };
  }

  // 3. The settlement-match step, between the declared-set checks and the
  // sign fallback: the settlement debit carries no counterparty IBAN, so
  // only its pattern, amount and date can identify it (decision D-11).
  const settlement = correctCardSettlement(
    transaction,
    sets,
    context.cardImports,
  );
  if (settlement !== undefined) {
    if (settlement.kind === "settled-debit") {
      return { flow: "INTERNAL", settledCardImportId: settlement.cardImportId };
    }
    if (settlement.kind === "mirror-credit") {
      return { flow: "INTERNAL", settlementMirror: true };
    }
    // A settlement-pattern debit with no matching card import: honest
    // aggregate SPEND against the issuer, never INTERNAL, never
    // UNRESOLVED (criterion 2.8, hazard H2.6).
    return { flow: "SPEND" };
  }

  // 4. Sign decides, with the remaining corrections.
  if (transaction.amountCents < 0) {
    const cash = correctCashWithdrawal(transaction);
    if (cash !== undefined) {
      return { flow: cash.flow, cashDestination: true };
    }
    return { flow: "SPEND" };
  }
  if (transaction.amountCents > 0) {
    // The card arm of correction 3 (finding HZ-M3P3-06): a positive row on
    // a declared card account that the settlement step did not claim is a
    // merchant refund, not income.
    const refund = correctRefund(
      transaction,
      context.outgoingHistoryKeys,
      sets.cardAccountIds,
    );
    if (refund !== undefined) {
      return { flow: refund };
    }
    return { flow: "INCOME" };
  }

  // A zero amount has no direction to read.
  return { flow: "UNRESOLVED" };
};
