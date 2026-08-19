// Interpretation over a period window across ALL pot accounts, never over
// the imported rows (pulse-v1-architecture.md: the second leg of a
// transfer usually arrives in a different file, so scoping to the import
// would leave unmatched legs wrong forever; scoping to the window lets
// them heal on the next upload). Recompute is this same step with no
// import attached, over everything.

import type { PlainDate } from "@/platform/plain-date";
import type { HouseholdContext } from "@/platform/tenancy";
import { INTERPRETATION_WINDOW_PADDING_DAYS } from "../domain/constants";
import { interpretLedger } from "../domain/interpret";
import { addDays } from "../domain/plain-date-distance";
import type { LedgerDependencies } from "./ports";

export type InterpretationSummary = {
  readonly transactionsInterpreted: number;
  readonly transferPairs: number;
  readonly settlements: number;
  readonly unmatchedInternalIds: readonly string[];
  readonly unresolvedIds: readonly string[];
};

export const interpretWindow = async (
  context: HouseholdContext,
  deps: LedgerDependencies,
  window: { readonly from?: PlainDate; readonly to?: PlainDate },
): Promise<InterpretationSummary> => {
  const accounts = await deps.accounts.listAccounts(context);
  const potAccountIds = accounts
    .filter((account) => account.role === "POT")
    .map((account) => account.id);

  const transactions = await deps.ledger.listPotTransactions(context, {
    accountIds: potAccountIds,
    ...(window.from === undefined ? {} : { from: window.from }),
    ...(window.to === undefined ? {} : { to: window.to }),
  });

  const interpretation = interpretLedger({ transactions, accounts });

  const links = [
    ...interpretation.transferPairs.map((pair) => ({
      outgoingTransactionId: pair.outgoingId,
      incomingTransactionId: pair.incomingId,
    })),
    ...interpretation.settlements.map((link) => ({
      outgoingTransactionId: link.debitTransactionId,
      settlementImportId: link.cardImportId,
      ...(link.mirrorCreditTransactionId === undefined
        ? {}
        : { incomingTransactionId: link.mirrorCreditTransactionId }),
    })),
  ];

  const transactionIds = transactions.map((transaction) => transaction.id);
  const interpretedImportIds = [
    ...new Set(transactions.map((transaction) => transaction.importId)),
  ].sort();

  await deps.ledger.replaceInterpretation(context, {
    transactionIds,
    flows: transactionIds.flatMap((transactionId) => {
      const flow = interpretation.flows.get(transactionId);
      return flow === undefined ? [] : [{ transactionId, flow }];
    }),
    links,
    interpretedImportIds,
  });

  return {
    transactionsInterpreted: transactionIds.length,
    transferPairs: interpretation.transferPairs.length,
    settlements: interpretation.settlements.length,
    unmatchedInternalIds: interpretation.unmatchedInternalIds,
    unresolvedIds: interpretation.unresolvedIds,
  };
};

// The window an import affects: its own booking-date span, padded on both
// sides so every possible transfer partner and settlement match of a row
// in the period is inside the loaded context.
export const interpretForImport = async (
  context: HouseholdContext,
  deps: LedgerDependencies,
  importId: string,
): Promise<InterpretationSummary | null> => {
  const period = await deps.ledger.importPeriod(context, importId);
  if (period === null) {
    return null;
  }
  return interpretWindow(context, deps, {
    from: addDays(period.from, -INTERPRETATION_WINDOW_PADDING_DAYS),
    to: addDays(period.to, INTERPRETATION_WINDOW_PADDING_DAYS),
  });
};

// Recompute: the same step with no import attached, over everything. One
// internal action, dev-only surface (pulse-v1-architecture.md).
export const recomputeInterpretation = (
  context: HouseholdContext,
  deps: LedgerDependencies,
): Promise<InterpretationSummary> => interpretWindow(context, deps, {});
