// Interpretation over a period window across ALL pot accounts, never over
// the imported rows (pulse-v1-architecture.md: the second leg of a
// transfer usually arrives in a different file, so scoping to the import
// would leave unmatched legs wrong forever; scoping to the window lets
// them heal on the next upload). Recompute is this same step with no
// import attached, over everything.

import type { PlainDate } from "@/platform/plain-date";
import type { HouseholdContext } from "@/platform/tenancy";
import { counterpartyText } from "@/modules/merchants/application";
import { INTERPRETATION_WINDOW_PADDING_DAYS } from "../domain/constants";
import { counterpartyKey } from "../domain/corrections";
import { interpretLedger } from "../domain/interpret";
import {
  deriveDeclaredSets,
  type LedgerTransaction,
} from "../domain/ledger-transaction";
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
  const sets = deriveDeclaredSets(accounts);
  const cardAccountIds = [...sets.cardAccountIds];
  const windowedAccountIds = [...sets.potAccountIds].filter(
    (accountId) => !sets.cardAccountIds.has(accountId),
  );

  // Finding CR-301: settlement matching resolves against card IMPORTS,
  // whole, never against the slice of them a window happens to load. A
  // date-bounded load of a card account can truncate an import's
  // settlement total or hide it entirely, flipping an already settled
  // debit to SPEND and double counting the card month while the books
  // still reconcile. So card accounts are loaded UNBOUNDED (every card
  // import complete, cheap at household scale) and only the other pot
  // accounts are windowed.
  const windowed = await deps.ledger.listPotTransactions(context, {
    accountIds: windowedAccountIds,
    ...(window.from === undefined ? {} : { from: window.from }),
    ...(window.to === undefined ? {} : { to: window.to }),
  });
  const cardRows =
    cardAccountIds.length === 0
      ? []
      : await deps.ledger.listPotTransactions(context, {
          accountIds: cardAccountIds,
        });
  const transactions = [...windowed, ...cardRows];

  // Finding HZ-M3P3-01: a card import's settlement total is the figure its
  // own statement carries, read from the stored fact column, never
  // re-derived from the row signs. Loaded over the same unbounded card
  // account set and for the same reason (CR-301): the figure describes the
  // whole import, not the rows a window happened to load.
  const statementTotals =
    cardAccountIds.length === 0
      ? []
      : await deps.ledger.listCardStatementTotals(context, {
          accountIds: cardAccountIds,
        });
  const statementSettlementTotals = new Map(
    statementTotals.map((entry) => [entry.importId, entry.settlementTotalCents]),
  );

  // Finding CR-303: refund history over the WHOLE ledger, so a window run
  // and a recompute agree on every refund. The read happens after ingest
  // persisted the new rows, so it includes the window's own outgoing rows.
  const historyRefs = await deps.ledger.listOutgoingCounterpartyRefs(context, {
    accountIds: [...sets.potAccountIds],
  });
  const outgoingHistoryKeys = new Set(historyRefs.map(counterpartyKey));

  const interpretation = interpretLedger({
    transactions,
    accounts,
    outgoingHistoryKeys,
    statementSettlementTotals,
  });

  // Merchant resolution over the SAME interpreted set (M1-P4): counted
  // rows (INCOME and SPEND) resolve their counterparty text through the
  // MerchantResolver port, distinct texts rather than rows. Everything
  // else (INTERNAL, RESERVE, UNRESOLVED) carries no merchant: its
  // counterparty is the household itself or unknown. Resolution renames
  // and regroups ONLY: the flows above are already decided and nothing
  // here feeds back into them (hazard H3.2). Null assignments are written
  // too, so a rebuild clears whatever no rule supports any more.
  const isCounted = (transactionId: string): boolean => {
    const flow = interpretation.flows.get(transactionId);
    return flow === "INCOME" || flow === "SPEND";
  };
  // The counterparty-source rule has ONE definition (decision D-11), and it
  // is the merchants module's, reached through that module's published
  // application interface rather than copied here. This file used to carry
  // its own copy of the expression, which meant the ledger and the merchant
  // review could silently disagree about which text a transaction resolves
  // under while both looked right in isolation.
  const merchantText = (transaction: LedgerTransaction): string =>
    counterpartyText(transaction);
  const countedTexts = [
    ...new Set(
      transactions
        .filter((transaction) => isCounted(transaction.id))
        .map(merchantText),
    ),
  ];
  const resolvedMerchants = await deps.merchants.resolveCounterparties(
    context,
    countedTexts,
  );
  const merchants = transactions.map((transaction) => ({
    transactionId: transaction.id,
    merchantId: isCounted(transaction.id)
      ? (resolvedMerchants.get(merchantText(transaction)) ?? null)
      : null,
  }));

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
    merchants,
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
