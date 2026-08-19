import { describe, expect, test } from "vitest";
import { cents, type Cents } from "../../src/platform/money";
import { plainDate } from "../../src/platform/plain-date";
import {
  classifyFlow,
  type ClassificationContext,
} from "../../src/modules/ledger/domain/classify-flow";
import { buildOutgoingHistoryKeys } from "../../src/modules/ledger/domain/corrections";
import {
  deriveDeclaredSets,
  summarizeCardImports,
  type DeclaredAccount,
  type LedgerTransaction,
} from "../../src/modules/ledger/domain/ledger-transaction";

// Criterion 2.1: all five flow values, and the declared-set precedence
// (reserve set before pot set, both before the settlement step, all
// before the sign fallback). Classification runs against sets the user
// DECLARED, never sets the system guessed.

const IBAN_A = "BE68539007547034";
const IBAN_B = "BE71096123456769";
const IBAN_RESERVE = "BE43068999999501";

const ACCOUNTS: readonly DeclaredAccount[] = [
  { id: "acc-a", role: "POT", iban: IBAN_A },
  { id: "acc-b", role: "POT", iban: IBAN_B },
  { id: "acc-card", role: "POT" },
  { id: "acc-reserve", role: "RESERVE", iban: IBAN_RESERVE },
];

const tx = (input: {
  readonly id: string;
  readonly accountId?: string;
  readonly importId?: string;
  readonly date?: string;
  readonly amount: number;
  readonly description?: string;
  readonly counterpartyIban?: string;
  readonly counterpartyName?: string;
}): LedgerTransaction => ({
  id: input.id,
  accountId: input.accountId ?? "acc-a",
  importId: input.importId ?? "import-1",
  bookingDate: plainDate(input.date ?? "2026-08-10"),
  amountCents: cents(input.amount) as Cents,
  description: input.description ?? "SOME COUNTERPARTY GENT",
  ...(input.counterpartyIban === undefined
    ? {}
    : { counterpartyIban: input.counterpartyIban }),
  ...(input.counterpartyName === undefined
    ? {}
    : { counterpartyName: input.counterpartyName }),
});

const contextFor = (
  transactions: readonly LedgerTransaction[],
  accounts: readonly DeclaredAccount[] = ACCOUNTS,
): ClassificationContext => {
  const sets = deriveDeclaredSets(accounts);
  return {
    sets,
    cardImports: summarizeCardImports(transactions, sets),
    outgoingHistoryKeys: buildOutgoingHistoryKeys(transactions),
  };
};

describe("the five flow values are each reachable", () => {
  test("INCOME: money entering the pot from outside", () => {
    const t = tx({ id: "t1", amount: 250000, counterpartyIban: "BE39103123456719" });
    expect(classifyFlow(t, contextFor([t])).flow).toBe("INCOME");
  });

  test("SPEND: money leaving the pot to outside", () => {
    const t = tx({ id: "t1", amount: -8647, counterpartyIban: "BE54540123456789" });
    expect(classifyFlow(t, contextFor([t])).flow).toBe("SPEND");
  });

  test("INTERNAL: counterparty in the declared pot set", () => {
    const t = tx({ id: "t1", amount: -50000, counterpartyIban: IBAN_B });
    expect(classifyFlow(t, contextFor([t])).flow).toBe("INTERNAL");
  });

  test("RESERVE: counterparty in the declared reserve set, both directions", () => {
    const parked = tx({ id: "t1", amount: -100000, counterpartyIban: IBAN_RESERVE });
    const drawn = tx({ id: "t2", amount: 75000, counterpartyIban: IBAN_RESERVE });
    const context = contextFor([parked, drawn]);
    expect(classifyFlow(parked, context).flow).toBe("RESERVE");
    expect(classifyFlow(drawn, context).flow).toBe("RESERVE");
  });

  test("UNRESOLVED: a zero amount has no direction to read, and is never dropped", () => {
    const t = tx({ id: "t1", amount: 0, counterpartyIban: "BE39103123456719" });
    expect(classifyFlow(t, contextFor([t])).flow).toBe("UNRESOLVED");
  });
});

describe("declared-set precedence: reserve before pot before sign", () => {
  test("an IBAN in both declared sets classifies RESERVE, never INTERNAL", () => {
    // Degenerate on purpose: the same IBAN declared on a reserve account
    // and a pot account. The reserve check runs first, so RESERVE wins.
    const accounts: readonly DeclaredAccount[] = [
      { id: "acc-a", role: "POT", iban: IBAN_A },
      { id: "acc-x", role: "POT", iban: IBAN_B },
      { id: "acc-r", role: "RESERVE", iban: IBAN_B },
    ];
    const t = tx({ id: "t1", amount: -5000, counterpartyIban: IBAN_B });
    expect(classifyFlow(t, contextFor([t], accounts)).flow).toBe("RESERVE");
  });

  test("the pot set beats the sign fallback in both directions", () => {
    const out = tx({ id: "t1", amount: -5000, counterpartyIban: IBAN_B });
    const back = tx({ id: "t2", accountId: "acc-b", amount: 5000, counterpartyIban: IBAN_A });
    const context = contextFor([out, back]);
    expect(classifyFlow(out, context).flow).toBe("INTERNAL");
    expect(classifyFlow(back, context).flow).toBe("INTERNAL");
  });

  test("the reserve set beats the refund correction: a drawdown is RESERVE even with outgoing history", () => {
    const parked = tx({ id: "t1", amount: -100000, counterpartyIban: IBAN_RESERVE });
    const drawn = tx({ id: "t2", amount: 100000, counterpartyIban: IBAN_RESERVE });
    const context = contextFor([parked, drawn]);
    expect(classifyFlow(drawn, context).flow).toBe("RESERVE");
  });
});

describe("the settlement step sits between the declared-set checks and the sign fallback", () => {
  const cardRows = [
    tx({
      id: "c1",
      accountId: "acc-card",
      importId: "import-42",
      date: "2026-07-28",
      amount: -4830,
      description: "STARBUCKS ANTWERPEN",
    }),
    tx({
      id: "c2",
      accountId: "acc-card",
      importId: "import-42",
      date: "2026-07-30",
      amount: -1728,
      description: "PIZZA NAPOLI BRUSSEL",
    }),
  ];

  test("a settlement-pattern debit matching a card import classifies INTERNAL, not SPEND", () => {
    const debit = tx({
      id: "t1",
      amount: -6558,
      date: "2026-08-02",
      description: "MASTERCARD AFREKENING NUMMER 42",
    });
    const classification = classifyFlow(debit, contextFor([...cardRows, debit]));
    expect(classification.flow).toBe("INTERNAL");
    expect(classification.settledCardImportId).toBe("import-42");
  });

  test("a declared-set counterparty wins over the settlement pattern", () => {
    // Same description, but the row carries a counterparty IBAN in the
    // declared reserve set: the declared-set check runs first.
    const debit = tx({
      id: "t1",
      amount: -6558,
      date: "2026-08-02",
      description: "MASTERCARD AFREKENING NUMMER 42",
      counterpartyIban: IBAN_RESERVE,
    });
    expect(classifyFlow(debit, contextFor([...cardRows, debit])).flow).toBe("RESERVE");
  });

  test("a settlement-pattern debit with no matching card import stays SPEND, never UNRESOLVED", () => {
    const debit = tx({
      id: "t1",
      amount: -85000,
      date: "2026-08-02",
      description: "MASTERCARD AFREKENING NUMMER 41",
    });
    const classification = classifyFlow(debit, contextFor([debit]));
    expect(classification.flow).toBe("SPEND");
    expect(classification.settledCardImportId).toBeUndefined();
  });
});

describe("sign fallback corrections", () => {
  test("a refund (incoming from a counterparty with outgoing history) is SPEND, not INCOME", () => {
    const purchase = tx({
      id: "t1",
      amount: -4999,
      counterpartyIban: "BE54540123456789",
      counterpartyName: "Webshop NV",
    });
    const refund = tx({
      id: "t2",
      amount: 4999,
      counterpartyIban: "BE54540123456789",
      counterpartyName: "Webshop NV",
    });
    const context = contextFor([purchase, refund]);
    expect(classifyFlow(refund, context).flow).toBe("SPEND");
  });

  test("a cash withdrawal is SPEND with cash as its own destination", () => {
    const t = tx({
      id: "t1",
      amount: -10000,
      description: "MAESTRO GELDOPNAME BANCONTACT GENT",
    });
    const classification = classifyFlow(t, contextFor([t]));
    expect(classification.flow).toBe("SPEND");
    expect(classification.cashDestination).toBe(true);
  });
});
