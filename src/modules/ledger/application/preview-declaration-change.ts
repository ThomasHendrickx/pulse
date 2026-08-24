// WHAT A DECLARATION CHANGE WILL DO, BEFORE IT IS MADE (M3-P14 criterion
// 14.13, M3-P15 criterion 15.7, decision D-58).
//
// Registering an account and correcting an account's ring are both
// declaration writes followed by a recompute, and both MOVE MONEY between
// the figures the household already trusts. The owner is told what will move
// before they confirm, and the number they are shown is not an estimate.
//
// D-58 SETTLES HOW EACH FIGURE IS PRODUCED, and the reason is worth keeping
// at the mechanism rather than in a plan document. Every quantity describing
// a RECLASSIFICATION is produced by a DRY RUN of the SAME domain
// interpretation the recompute runs, over the PROPOSED declaration set,
// writing nothing. Never by a second query that sums rows whose counterparty
// account matches. A second query agrees on a simple fixture and diverges
// wherever the engine applies a correction: at the settlement match, at the
// reserve drawdown, at the refund arm, and in the unmatched or in-transit
// leg accounting. Two rules for one question is one rule that can drift, and
// this is a rule whose drift the household reads as a lie.
//
// A CORRECTION OUT OF THE POT MAKES TWO MOVEMENTS, NOT ONE, which is the
// thing an implementation gets wrong by describing only the obvious half.
// The rows ON the account are cleared and stop being counted at all, while
// the reserves block gains a DIFFERENT set of rows: the counterparty rows on
// the household's OTHER pot accounts, which move from INTERNAL to RESERVE.
// Both are reported.
//
// THIS FILE WRITES NOTHING. It uses the same repository reads recompute
// uses, and it never calls replaceInterpretation.

import type { Cents } from "@/platform/money";
import { cents } from "@/platform/money";
import type { HouseholdContext } from "@/platform/tenancy";
import { counterpartyText } from "@/modules/merchants/application";
import { counterpartyKey } from "../domain/corrections";
import { interpretLedger } from "../domain/interpret";
import {
  deriveDeclaredSets,
  type DeclaredAccount,
  type LedgerTransaction,
} from "../domain/ledger-transaction";
import type { LedgerDependencies } from "./ports";

export type DeclarationChangePreview = {
  // Rows ON the subject account whose counted state changes, with the
  // direction. "stop-counting" is the count of rows on that account
  // carrying a flow TODAY: clearing them is an APPLICATION act, so it is
  // read off the interpretation that actually loads them rather than asked
  // of a domain run that does not (criterion 15.7 names it that way on
  // purpose). "start-counting" is its mirror, for a correction INTO the pot.
  readonly rowsOnAccount: number;
  readonly rowsOnAccountDirection: "stop-counting" | "start-counting" | "none";
  // Signed change in the DISPLAY magnitude of the spend total: negative
  // means the spend total falls.
  readonly spendDeltaCents: Cents;
  // Signed change in the DISPLAY magnitude of the reserves block's net:
  // positive means the reserves block gains.
  readonly reservesDeltaCents: Cents;
  // Signed change in the display magnitude of the income total. Present
  // because the drawdown arm moves income rather than spend, and a preview
  // that could only describe one of the two would be silent on exactly the
  // case a savings account that is drawn from produces.
  readonly incomeDeltaCents: Cents;
  // Merchant rules the change leaves matching nothing. Never deleted, on
  // decision D-49's terms: kept, counted and named.
  readonly merchantRulesStoppedMatching: number;
};

type SideTotals = {
  readonly incomeCents: number;
  readonly spendCents: number;
  readonly netToReservesCents: number;
  readonly countedTexts: readonly string[];
  readonly flowsByTransactionId: ReadonlyMap<string, string>;
};

const totalsFor = (
  transactions: readonly LedgerTransaction[],
  accounts: readonly DeclaredAccount[],
  outgoingHistoryKeys: ReadonlySet<string>,
  statementSettlementTotals: ReadonlyMap<string, Cents>,
): SideTotals => {
  const sets = deriveDeclaredSets(accounts);
  const potRows = transactions.filter((transaction) =>
    sets.potAccountIds.has(transaction.accountId),
  );
  const interpretation = interpretLedger({
    transactions: potRows,
    accounts,
    outgoingHistoryKeys,
    statementSettlementTotals,
  });
  let incomeSigned = 0;
  let spendSigned = 0;
  let reserveSigned = 0;
  const countedTexts = new Set<string>();
  for (const transaction of potRows) {
    const flow = interpretation.flows.get(transaction.id);
    if (flow === "INCOME") {
      incomeSigned += transaction.amountCents;
    } else if (flow === "SPEND") {
      spendSigned += transaction.amountCents;
    } else if (flow === "RESERVE") {
      reserveSigned += transaction.amountCents;
    }
    if (flow === "INCOME" || flow === "SPEND") {
      countedTexts.add(counterpartyText(transaction));
    }
  }
  return {
    incomeCents: incomeSigned,
    // The same 0 - x the projection uses: unary negation of 0 yields -0.
    spendCents: 0 - spendSigned,
    netToReservesCents: 0 - reserveSigned,
    countedTexts: [...countedTexts],
    flowsByTransactionId: interpretation.flows,
  };
};

export const previewDeclarationChange = async (
  context: HouseholdContext,
  deps: LedgerDependencies,
  input: {
    // The declaration set as it would be AFTER the change. For a
    // registration this is the current set plus the new account; for a ring
    // correction it is the current set with one role replaced.
    readonly proposedAccounts: readonly DeclaredAccount[];
    // The account being registered or corrected, when it already has rows.
    readonly subjectAccountId?: string;
  },
): Promise<DeclarationChangePreview> => {
  const currentAccounts = await deps.accounts.listAccounts(context);
  const currentSets = deriveDeclaredSets(currentAccounts);
  const proposedSets = deriveDeclaredSets(input.proposedAccounts);

  // The union of both sides' pot accounts, plus the subject, so that every
  // row either side would classify is loaded ONCE and both sides see the
  // same facts. Unbounded, exactly like the recompute this previews.
  const loadIds = [
    ...new Set([
      ...currentSets.potAccountIds,
      ...proposedSets.potAccountIds,
      ...(input.subjectAccountId === undefined
        ? []
        : [input.subjectAccountId]),
    ]),
  ];
  const transactions =
    loadIds.length === 0
      ? []
      : await deps.ledger.listPotTransactions(context, { accountIds: loadIds });

  const cardAccountIds = [
    ...new Set([...currentSets.cardAccountIds, ...proposedSets.cardAccountIds]),
  ];
  const statementTotals =
    cardAccountIds.length === 0
      ? []
      : await deps.ledger.listCardStatementTotals(context, {
          accountIds: cardAccountIds,
        });
  const statementSettlementTotals = new Map(
    statementTotals.map((entry) => [entry.importId, entry.settlementTotalCents]),
  );

  // The refund correction's history is scope-free (finding CR-303) and is
  // read over the union for the same reason the rows are.
  const historyRefs =
    loadIds.length === 0
      ? []
      : await deps.ledger.listOutgoingCounterpartyRefs(context, {
          accountIds: loadIds,
        });
  const outgoingHistoryKeys = new Set(historyRefs.map(counterpartyKey));

  const before = totalsFor(
    transactions,
    currentAccounts,
    outgoingHistoryKeys,
    statementSettlementTotals,
  );
  const after = totalsFor(
    transactions,
    input.proposedAccounts,
    outgoingHistoryKeys,
    statementSettlementTotals,
  );

  // WHICH MERCHANT RULES STOP MATCHING, asked of the ONE port interpretation
  // is allowed to reach the merchants module through (criterion 3.2): the
  // resolver takes distinct counterparty texts and answers which merchant
  // each resolves to. A text that resolves today and is no longer COUNTED
  // after the change resolves to nothing afterwards, because interpretation
  // only ever asks about counted rows. That is one rule per text, which is
  // what assignMerchant writes.
  const [resolvedBefore, resolvedAfter] = await Promise.all([
    deps.merchants.resolveCounterparties(context, before.countedTexts),
    deps.merchants.resolveCounterparties(context, after.countedTexts),
  ]);
  const stillResolved = new Set(
    after.countedTexts.filter((text) => resolvedAfter.has(text)),
  );
  const merchantRulesStoppedMatching = before.countedTexts.filter(
    (text) => resolvedBefore.has(text) && !stillResolved.has(text),
  ).length;

  // The rows ON the subject account, and which way they move. Read off
  // whichever side actually LOADS them, never asked of a run that does not.
  const subject = input.subjectAccountId;
  const rowsOn = (side: SideTotals): number =>
    subject === undefined
      ? 0
      : transactions.filter(
          (transaction) =>
            transaction.accountId === subject &&
            side.flowsByTransactionId.get(transaction.id) !== undefined,
        ).length;
  const countedBefore = rowsOn(before);
  const countedAfter = rowsOn(after);
  const rowsOnAccount = Math.abs(countedAfter - countedBefore);
  const rowsOnAccountDirection =
    countedAfter < countedBefore
      ? ("stop-counting" as const)
      : countedAfter > countedBefore
        ? ("start-counting" as const)
        : ("none" as const);

  return {
    rowsOnAccount,
    rowsOnAccountDirection,
    spendDeltaCents: cents(after.spendCents - before.spendCents),
    reservesDeltaCents: cents(
      after.netToReservesCents - before.netToReservesCents,
    ),
    incomeDeltaCents: cents(after.incomeCents - before.incomeCents),
    merchantRulesStoppedMatching,
  };
};
