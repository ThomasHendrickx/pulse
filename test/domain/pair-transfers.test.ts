import { describe, expect, test } from "vitest";
import { cents, type Cents } from "../../src/platform/money";
import { plainDate } from "../../src/platform/plain-date";
import { interpretLedger } from "../../src/modules/ledger/domain/interpret";
import {
  deriveDeclaredSets,
  type DeclaredAccount,
  type LedgerTransaction,
} from "../../src/modules/ledger/domain/ledger-transaction";
import { pairInternalTransfers } from "../../src/modules/ledger/domain/pair-transfers";
import { reconcile } from "../../src/modules/ledger/domain/reconciliation";

// Criterion 2.2: pairing is deterministic and order-independent, with the
// tie-break by date distance then transaction id (decision D-7: 4-day
// window). Criterion 2.5 (first half): an unmatched internal leg is
// excluded from both sides and surfaced. Hazard H2.3: totals must never
// depend on upload or insertion order.

const IBAN_A = "BE68539007547034";
const IBAN_B = "BE71096123456769";
const IBAN_C = "BE02979245566602";
const IBAN_RESERVE = "BE43068999999501";

const ACCOUNTS: readonly DeclaredAccount[] = [
  { id: "acc-a", role: "POT", iban: IBAN_A },
  { id: "acc-b", role: "POT", iban: IBAN_B },
  { id: "acc-c", role: "POT", iban: IBAN_C },
  { id: "acc-reserve", role: "RESERVE", iban: IBAN_RESERVE },
];

const SETS = deriveDeclaredSets(ACCOUNTS);

const ibanOf: Record<string, string> = {
  "acc-a": IBAN_A,
  "acc-b": IBAN_B,
  "acc-c": IBAN_C,
};

const leg = (input: {
  readonly id: string;
  readonly accountId: string;
  readonly date: string;
  readonly amount: number;
  readonly counterpartyAccountId?: string;
  readonly counterpartyIban?: string;
}): LedgerTransaction => ({
  id: input.id,
  accountId: input.accountId,
  importId: `import-${input.accountId}`,
  bookingDate: plainDate(input.date),
  amountCents: cents(input.amount) as Cents,
  description: "OVERSCHRIJVING EIGEN REKENING",
  ...(input.counterpartyAccountId !== undefined
    ? { counterpartyIban: ibanOf[input.counterpartyAccountId] as string }
    : input.counterpartyIban !== undefined
      ? { counterpartyIban: input.counterpartyIban }
      : {}),
});

// A deterministic in-test shuffle so order-independence is exercised over
// several genuinely different insertion orders.
const shuffled = <T>(items: readonly T[], seed: number): readonly T[] => {
  const result = [...items];
  let state = seed;
  const next = (): number => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(next() * (i + 1));
    const a = result[i] as T;
    result[i] = result[j] as T;
    result[j] = a;
  }
  return result;
};

describe("pairing is deterministic and order-independent", () => {
  const legs: readonly LedgerTransaction[] = [
    // Pair 1: a -> b, same day.
    leg({ id: "t1", accountId: "acc-a", date: "2026-08-03", amount: -50000, counterpartyAccountId: "acc-b" }),
    leg({ id: "t2", accountId: "acc-b", date: "2026-08-03", amount: 50000, counterpartyAccountId: "acc-a" }),
    // Pair 2: b -> c, two days apart (within the 4-day window).
    leg({ id: "t3", accountId: "acc-b", date: "2026-08-10", amount: -20000, counterpartyAccountId: "acc-c" }),
    leg({ id: "t4", accountId: "acc-c", date: "2026-08-12", amount: 20000, counterpartyAccountId: "acc-b" }),
    // Same amount as pair 2 but a second, later candidate incoming.
    leg({ id: "t5", accountId: "acc-c", date: "2026-08-13", amount: 20000, counterpartyAccountId: "acc-b" }),
    // An unmatched outgoing leg: the other export stops earlier.
    leg({ id: "t6", accountId: "acc-a", date: "2026-08-20", amount: -7500, counterpartyAccountId: "acc-c" }),
  ];

  test("every insertion order produces the identical pair set", () => {
    const reference = pairInternalTransfers(legs, SETS);
    expect(reference.pairs).toEqual([
      { outgoingId: "t1", incomingId: "t2" },
      { outgoingId: "t3", incomingId: "t4" },
    ]);
    expect(reference.unmatchedIds).toEqual(["t5", "t6"]);
    for (const seed of [1, 7, 42, 1337, 90210]) {
      const result = pairInternalTransfers(shuffled(legs, seed), SETS);
      expect(result.pairs).toEqual(reference.pairs);
      expect(result.unmatchedIds).toEqual(reference.unmatchedIds);
    }
  });

  test("re-running over the same data produces the identical set (idempotent)", () => {
    const first = pairInternalTransfers(legs, SETS);
    const second = pairInternalTransfers(legs, SETS);
    expect(second).toEqual(first);
  });
});

describe("the tie-break: smallest date difference, then lowest transaction id", () => {
  test("the nearer-dated candidate wins", () => {
    const legs = [
      leg({ id: "out", accountId: "acc-a", date: "2026-08-10", amount: -10000, counterpartyAccountId: "acc-b" }),
      leg({ id: "far", accountId: "acc-b", date: "2026-08-13", amount: 10000, counterpartyAccountId: "acc-a" }),
      leg({ id: "near", accountId: "acc-b", date: "2026-08-11", amount: 10000, counterpartyAccountId: "acc-a" }),
    ];
    const result = pairInternalTransfers(legs, SETS);
    expect(result.pairs).toEqual([{ outgoingId: "out", incomingId: "near" }]);
    expect(result.unmatchedIds).toEqual(["far"]);
  });

  test("at equal date distance the lowest transaction id wins", () => {
    const legs = [
      leg({ id: "out", accountId: "acc-a", date: "2026-08-10", amount: -10000, counterpartyAccountId: "acc-b" }),
      leg({ id: "in-2", accountId: "acc-b", date: "2026-08-11", amount: 10000, counterpartyAccountId: "acc-a" }),
      leg({ id: "in-1", accountId: "acc-b", date: "2026-08-11", amount: 10000, counterpartyAccountId: "acc-a" }),
    ];
    const result = pairInternalTransfers(legs, SETS);
    expect(result.pairs).toEqual([{ outgoingId: "out", incomingId: "in-1" }]);
    expect(result.unmatchedIds).toEqual(["in-2"]);
  });
});

describe("the candidate conditions all bind", () => {
  const out = leg({ id: "out", accountId: "acc-a", date: "2026-08-10", amount: -10000, counterpartyAccountId: "acc-b" });

  test("booking dates exactly at the window edge pair; one day beyond do not", () => {
    const atEdge = leg({ id: "in", accountId: "acc-b", date: "2026-08-14", amount: 10000, counterpartyAccountId: "acc-a" });
    expect(pairInternalTransfers([out, atEdge], SETS).pairs).toHaveLength(1);
    const beyond = leg({ id: "in", accountId: "acc-b", date: "2026-08-15", amount: 10000, counterpartyAccountId: "acc-a" });
    const result = pairInternalTransfers([out, beyond], SETS);
    expect(result.pairs).toHaveLength(0);
    expect(result.unmatchedIds).toEqual(["in", "out"]);
  });

  test("amounts must be exactly opposite, in integer cents", () => {
    const offByOne = leg({ id: "in", accountId: "acc-b", date: "2026-08-10", amount: 10001, counterpartyAccountId: "acc-a" });
    expect(pairInternalTransfers([out, offByOne], SETS).pairs).toHaveLength(0);
  });

  test("each leg's counterparty must name the other leg's account", () => {
    // The incoming leg points at acc-c, not acc-a: no pair.
    const wrongCounterparty = leg({ id: "in", accountId: "acc-b", date: "2026-08-10", amount: 10000, counterpartyAccountId: "acc-c" });
    expect(pairInternalTransfers([out, wrongCounterparty], SETS).pairs).toHaveLength(0);
  });
});

describe("unmatched internal legs are excluded from both sides and surfaced (criterion 2.5)", () => {
  test("interpretation flags the leg, and reconciliation shows it as the exact difference", () => {
    const transactions = [
      leg({ id: "t1", accountId: "acc-a", date: "2026-08-03", amount: -50000, counterpartyAccountId: "acc-b" }),
      // The other side of t1 has not been uploaded yet.
      {
        ...leg({ id: "t2", accountId: "acc-a", date: "2026-08-05", amount: 250000 }),
        description: "LOON JULI 2026",
      },
    ];
    const interpretation = interpretLedger({ transactions, accounts: ACCOUNTS });
    expect(interpretation.flows.get("t1")).toBe("INTERNAL");
    expect(interpretation.transferPairs).toHaveLength(0);
    expect(interpretation.unmatchedInternalIds).toEqual(["t1"]);

    const report = reconcile(transactions, interpretation);
    // Excluded from both sides: neither income nor spend moved.
    expect(report.incomeCents).toBe(250000);
    expect(report.spendCents).toBe(0);
    expect(report.netToReservesCents).toBe(0);
    // Surfaced: the books do not close, and the difference IS the leg.
    expect(report.reconciles).toBe(false);
    expect(report.differenceCents).toBe(-50000);
    expect(report.unmatchedInternalGapCents).toBe(-50000);
  });
});

describe("reserve movements are never paired", () => {
  test("a parked-and-drawn pair of reserve movements produces no transfer pair", () => {
    const transactions = [
      leg({ id: "t1", accountId: "acc-a", date: "2026-08-03", amount: -100000, counterpartyIban: IBAN_RESERVE }),
      leg({ id: "t2", accountId: "acc-a", date: "2026-08-04", amount: 100000, counterpartyIban: IBAN_RESERVE }),
    ];
    const interpretation = interpretLedger({ transactions, accounts: ACCOUNTS });
    expect(interpretation.flows.get("t1")).toBe("RESERVE");
    expect(interpretation.flows.get("t2")).toBe("RESERVE");
    expect(interpretation.transferPairs).toHaveLength(0);
    expect(interpretation.unmatchedInternalIds).toHaveLength(0);
  });
});
