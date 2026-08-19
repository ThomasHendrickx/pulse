import { describe, expect, test } from "vitest";
import { cents, type Cents } from "../../src/platform/money";
import { plainDate } from "../../src/platform/plain-date";
import {
  correctCardSettlement,
  correctCashWithdrawal,
  correctRefund,
  correctReserveDrawdown,
  buildOutgoingHistoryKeys,
} from "../../src/modules/ledger/domain/corrections";
import { interpretLedger } from "../../src/modules/ledger/domain/interpret";
import {
  deriveDeclaredSets,
  summarizeCardImports,
  type DeclaredAccount,
  type LedgerTransaction,
} from "../../src/modules/ledger/domain/ledger-transaction";
import { reconcile } from "../../src/modules/ledger/domain/reconciliation";

// Criterion 2.3: the four corrections, one describe block per correction,
// with card settlement fixtures mirroring the OBSERVED real shapes
// (notes/export-format-facts.md, owner v0.2 addendum): the account-side
// debit carries no counterparty IBAN and names the card statement number
// in its settlement-pattern description; the card-side settlement row is
// positive and has no counterparty account column. Criterion 2.8: the
// unimported-card fallback.

const IBAN_CURRENT = "BE68539007547034";
const IBAN_RESERVE = "BE43068999999501";

const ACCOUNTS: readonly DeclaredAccount[] = [
  { id: "acc-current", role: "POT", iban: IBAN_CURRENT },
  // The card account: a pot account recognised through its bound profile,
  // no IBAN in its exports.
  { id: "acc-card", role: "POT" },
  { id: "acc-reserve", role: "RESERVE", iban: IBAN_RESERVE },
];

const tx = (input: {
  readonly id: string;
  readonly accountId: string;
  readonly importId: string;
  readonly date: string;
  readonly amount: number;
  readonly description: string;
  readonly counterpartyIban?: string;
  readonly counterpartyName?: string;
}): LedgerTransaction => ({
  id: input.id,
  accountId: input.accountId,
  importId: input.importId,
  bookingDate: plainDate(input.date),
  amountCents: cents(input.amount) as Cents,
  description: input.description,
  ...(input.counterpartyIban === undefined
    ? {}
    : { counterpartyIban: input.counterpartyIban }),
  ...(input.counterpartyName === undefined
    ? {}
    : { counterpartyName: input.counterpartyName }),
});

describe("card settlement", () => {
  // Statement 42 of the card: line items are the real spend, in the shape
  // of the observed KBC export (two legitimate identical rows, an FX row).
  const cardStatement42 = [
    tx({ id: "c1", accountId: "acc-card", importId: "card-42", date: "2026-07-03", amount: -480, description: "STARBUCKS ANTWERPEN" }),
    tx({ id: "c2", accountId: "acc-card", importId: "card-42", date: "2026-07-03", amount: -480, description: "STARBUCKS ANTWERPEN" }),
    tx({ id: "c3", accountId: "acc-card", importId: "card-42", date: "2026-07-05", amount: -2303, description: "AMAZON US SEATTLE USD 25.00 KOERS 0,9210" }),
    tx({ id: "c4", accountId: "acc-card", importId: "card-42", date: "2026-07-12", amount: -1850, description: "PIZZA NAPOLI BRUSSEL" }),
  ];
  const statement42Total = 480 + 480 + 2303 + 1850; // 5113 cents

  // The account-side settlement debit: no counterparty IBAN, the statement
  // number in a settlement-pattern description, the exact statement total,
  // booked days after the statement period ends.
  const settlementDebit = tx({
    id: "d1",
    accountId: "acc-current",
    importId: "current-8",
    date: "2026-08-03",
    amount: -statement42Total,
    description: "MASTERCARD AFREKENING NUMMER 42",
  });

  // The card-side mirror: the settlement arriving on the card in the NEXT
  // statement, positive, no counterparty account column in the format.
  const mirrorCredit = tx({
    id: "m1",
    accountId: "acc-card",
    importId: "card-43",
    date: "2026-08-03",
    amount: statement42Total,
    description: "DOMICILIERING VIA JE BANK",
  });

  const world = [...cardStatement42, settlementDebit, mirrorCredit];

  test("the settlement debit classifies INTERNAL, paired to the card import (never double-counted spend)", () => {
    const sets = deriveDeclaredSets(ACCOUNTS);
    const match = correctCardSettlement(
      settlementDebit,
      sets,
      summarizeCardImports(world, sets),
    );
    expect(match).toEqual({ kind: "settled-debit", cardImportId: "card-42" });

    const interpretation = interpretLedger({ transactions: world, accounts: ACCOUNTS });
    expect(interpretation.flows.get("d1")).toBe("INTERNAL");
    expect(interpretation.settlements).toEqual([
      {
        debitTransactionId: "d1",
        cardImportId: "card-42",
        mirrorCreditTransactionId: "m1",
      },
    ]);
  });

  test("the card-side settlement row classifies INTERNAL as the mirror leg", () => {
    const sets = deriveDeclaredSets(ACCOUNTS);
    expect(correctCardSettlement(mirrorCredit, sets, [])).toEqual({
      kind: "mirror-credit",
    });
    const interpretation = interpretLedger({ transactions: world, accounts: ACCOUNTS });
    expect(interpretation.flows.get("m1")).toBe("INTERNAL");
  });

  test("the card line items are the only counted spend, and the books close (hazard H2.1)", () => {
    const interpretation = interpretLedger({ transactions: world, accounts: ACCOUNTS });
    const report = reconcile(world, interpretation);
    expect(report.spendCents).toBe(statement42Total);
    expect(report.incomeCents).toBe(0);
    expect(report.reconciles).toBe(true);
    expect(report.differenceCents).toBe(0);
  });

  test("criterion 2.8: a settlement-pattern debit with no matching card import inside the window is SPEND, exactly once, never INTERNAL, never UNRESOLVED", () => {
    // A card whose statements the household does not import: only the
    // current account is in the dataset.
    const salary = tx({
      id: "s1",
      accountId: "acc-current",
      importId: "current-8",
      date: "2026-08-01",
      amount: 250000,
      description: "LOON JULI 2026",
      counterpartyIban: "BE71096123456769",
      counterpartyName: "Acme Salaris BV",
    });
    const unmatchedDebit = tx({
      id: "d9",
      accountId: "acc-current",
      importId: "current-8",
      date: "2026-08-03",
      amount: -85000,
      description: "MASTERCARD AFREKENING NUMMER 17",
    });
    const transactions = [salary, unmatchedDebit];
    const interpretation = interpretLedger({ transactions, accounts: ACCOUNTS });
    expect(interpretation.flows.get("d9")).toBe("SPEND");
    expect(interpretation.flows.get("d9")).not.toBe("INTERNAL");
    expect(interpretation.flows.get("d9")).not.toBe("UNRESOLVED");
    const report = reconcile(transactions, interpretation);
    // Entered the spend total exactly once, so the books close exactly.
    expect(report.spendCents).toBe(85000);
    expect(report.reconciles).toBe(true);
    // Its grouping under the card issuer as merchant rides the normal
    // resolver chain once M1-P4 lands; nothing here pre-empts that.
  });

  test("settlement matching is exclusive per card import (finding CR-306)", () => {
    // Two equal-amount settlement-pattern debits, one imported statement:
    // a statement is settled once, so exactly ONE debit pairs (smallest
    // date distance to the statement's period end, then lowest id) and
    // the loser falls through to the honest unitemised SPEND, keeping the
    // month's spend from vanishing on an exact-cent coincidence.
    const secondAccounts: readonly DeclaredAccount[] = [
      ...ACCOUNTS,
      { id: "acc-second", role: "POT", iban: "BE71096123456769" },
    ];
    const nearDebit = tx({
      id: "d-near",
      accountId: "acc-current",
      importId: "current-8",
      date: "2026-08-02",
      amount: -statement42Total,
      description: "MASTERCARD AFREKENING NUMMER 42",
    });
    const farDebit = tx({
      id: "d-far",
      accountId: "acc-second",
      importId: "second-3",
      date: "2026-08-09",
      amount: -statement42Total,
      description: "MASTERCARD AFREKENING NUMMER 42",
    });
    const world = [...cardStatement42, nearDebit, farDebit];
    const interpretation = interpretLedger({ transactions: world, accounts: secondAccounts });
    expect(interpretation.settlements).toEqual([
      { debitTransactionId: "d-near", cardImportId: "card-42" },
    ]);
    expect(interpretation.flows.get("d-near")).toBe("INTERNAL");
    expect(interpretation.flows.get("d-far")).toBe("SPEND");
    // The loser is honest SPEND, not a surfaced gap and not UNRESOLVED.
    expect(interpretation.unmatchedInternalIds).not.toContain("d-far");
  });

  test("at equal date distance the lowest transaction id wins the settlement (finding CR-306)", () => {
    const secondAccounts: readonly DeclaredAccount[] = [
      ...ACCOUNTS,
      { id: "acc-second", role: "POT", iban: "BE71096123456769" },
    ];
    const debitB = tx({
      id: "d-b",
      accountId: "acc-second",
      importId: "second-3",
      date: "2026-08-02",
      amount: -statement42Total,
      description: "MASTERCARD AFREKENING NUMMER 42",
    });
    const debitA = tx({
      id: "d-a",
      accountId: "acc-current",
      importId: "current-8",
      date: "2026-08-02",
      amount: -statement42Total,
      description: "MASTERCARD AFREKENING NUMMER 42",
    });
    const interpretation = interpretLedger({
      transactions: [...cardStatement42, debitB, debitA],
      accounts: secondAccounts,
    });
    expect(interpretation.settlements).toEqual([
      { debitTransactionId: "d-a", cardImportId: "card-42" },
    ]);
    expect(interpretation.flows.get("d-b")).toBe("SPEND");
  });

  test("two card imports and two debits allocate one settlement each", () => {
    const otherStatement = [
      tx({ id: "c9", accountId: "acc-card", importId: "card-43", date: "2026-08-01", amount: -statement42Total, description: "KAARTBETALING HANDELAAR" }),
    ];
    const debitOne = tx({
      id: "d-one",
      accountId: "acc-current",
      importId: "current-8",
      date: "2026-08-02",
      amount: -statement42Total,
      description: "MASTERCARD AFREKENING NUMMER 42",
    });
    const debitTwo = tx({
      id: "d-two",
      accountId: "acc-current",
      importId: "current-8",
      date: "2026-08-05",
      amount: -statement42Total,
      description: "MASTERCARD AFREKENING NUMMER 43",
    });
    const interpretation = interpretLedger({
      transactions: [...cardStatement42, ...otherStatement, debitOne, debitTwo],
      accounts: ACCOUNTS,
    });
    const byDebit = new Map(
      interpretation.settlements.map((link) => [link.debitTransactionId, link.cardImportId]),
    );
    expect(byDebit.size).toBe(2);
    expect(new Set(byDebit.values()).size).toBe(2);
    expect(interpretation.flows.get("d-one")).toBe("INTERNAL");
    expect(interpretation.flows.get("d-two")).toBe("INTERNAL");
  });

  test("the date window binds: a card import outside SETTLEMENT_DATE_WINDOW_DAYS does not match", () => {
    const staleDebit = tx({
      id: "d2",
      accountId: "acc-current",
      importId: "current-9",
      date: "2026-11-15", // far beyond the window after statement 42
      amount: -statement42Total,
      description: "MASTERCARD AFREKENING NUMMER 42",
    });
    const sets = deriveDeclaredSets(ACCOUNTS);
    const match = correctCardSettlement(
      staleDebit,
      sets,
      summarizeCardImports(cardStatement42, sets),
    );
    expect(match).toEqual({ kind: "unitemised-card-spend" });
  });
});

describe("reserve drawdown", () => {
  const drawdown = tx({
    id: "r1",
    accountId: "acc-current",
    importId: "current-8",
    date: "2026-08-14",
    amount: 300000,
    description: "OVERSCHRIJVING VAN SPAARREKENING",
    counterpartyIban: IBAN_RESERVE,
  });

  test("money coming back from reserves is RESERVE, never INCOME (hazard H2.2)", () => {
    expect(correctReserveDrawdown(drawdown, new Set([IBAN_RESERVE]))).toBe("RESERVE");
    const interpretation = interpretLedger({ transactions: [drawdown], accounts: ACCOUNTS });
    expect(interpretation.flows.get("r1")).toBe("RESERVE");
  });

  test("it lands in the reserves block as a negative movement, not on the income side", () => {
    const interpretation = interpretLedger({ transactions: [drawdown], accounts: ACCOUNTS });
    const report = reconcile([drawdown], interpretation);
    expect(report.incomeCents).toBe(0);
    expect(report.netToReservesCents).toBe(-300000);
    expect(report.reconciles).toBe(true);
  });

  test("it does not fire for money entering from outside", () => {
    const salary = tx({
      id: "s1",
      accountId: "acc-current",
      importId: "current-8",
      date: "2026-08-01",
      amount: 250000,
      description: "LOON",
      counterpartyIban: "BE71096123456769",
    });
    expect(correctReserveDrawdown(salary, new Set([IBAN_RESERVE]))).toBeUndefined();
  });
});

describe("refund", () => {
  const purchase = tx({
    id: "p1",
    accountId: "acc-current",
    importId: "current-8",
    date: "2026-08-02",
    amount: -4999,
    description: "BETALING WEBSHOP",
    counterpartyIban: "BE54540123456789",
    counterpartyName: "Webshop NV",
  });
  const refund = tx({
    id: "p2",
    accountId: "acc-current",
    importId: "current-8",
    date: "2026-08-09",
    amount: 4999,
    description: "TERUGBETALING WEBSHOP",
    counterpartyIban: "BE54540123456789",
    counterpartyName: "Webshop NV",
  });

  test("incoming from a counterparty with outgoing history is SPEND with a positive amount", () => {
    const history = buildOutgoingHistoryKeys([purchase]);
    expect(correctRefund(refund, history)).toBe("SPEND");
    const interpretation = interpretLedger({ transactions: [purchase, refund], accounts: ACCOUNTS });
    expect(interpretation.flows.get("p2")).toBe("SPEND");
  });

  test("the refund nets against spend and keeps the income side honest", () => {
    const transactions = [purchase, refund];
    const interpretation = interpretLedger({ transactions, accounts: ACCOUNTS });
    const report = reconcile(transactions, interpretation);
    expect(report.incomeCents).toBe(0);
    expect(report.spendCents).toBe(0);
    expect(report.reconciles).toBe(true);
  });

  test("incoming from a counterparty without outgoing history stays INCOME", () => {
    const history = buildOutgoingHistoryKeys([purchase]);
    const salary = tx({
      id: "s1",
      accountId: "acc-current",
      importId: "current-8",
      date: "2026-08-01",
      amount: 250000,
      description: "LOON",
      counterpartyIban: "BE71096123456769",
    });
    expect(correctRefund(salary, history)).toBeUndefined();
  });
});

describe("cash withdrawal", () => {
  const withdrawal = tx({
    id: "w1",
    accountId: "acc-current",
    importId: "current-8",
    date: "2026-08-13",
    amount: -10000,
    description: "MAESTRO GELDOPNAME BANCONTACT GENT",
  });

  test("cash is its own destination: SPEND, marked cash, never split", () => {
    expect(correctCashWithdrawal(withdrawal)).toEqual({
      flow: "SPEND",
      destination: "cash",
    });
    const interpretation = interpretLedger({ transactions: [withdrawal], accounts: ACCOUNTS });
    expect(interpretation.flows.get("w1")).toBe("SPEND");
    expect(interpretation.cashTransactionIds).toEqual(["w1"]);
    // Never split: one fact row stays one interpreted row with the full
    // amount on the spend side.
    const report = reconcile([withdrawal], interpretation);
    expect(report.spendCents).toBe(10000);
    expect(report.reconciles).toBe(true);
  });

  test("an incoming row never becomes a cash withdrawal", () => {
    const deposit = tx({
      id: "w2",
      accountId: "acc-current",
      importId: "current-8",
      date: "2026-08-13",
      amount: 5000,
      description: "STORTING GELDOPNAME AUTOMAAT",
    });
    expect(correctCashWithdrawal(deposit)).toBeUndefined();
  });
});
