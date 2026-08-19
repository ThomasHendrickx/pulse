import fc from "fast-check";
import { describe, expect, test } from "vitest";
import { cents, type Cents } from "../../src/platform/money";
import { plainDate, type PlainDate } from "../../src/platform/plain-date";
import { interpretLedger } from "../../src/modules/ledger/domain/interpret";
import type {
  DeclaredAccount,
  LedgerTransaction,
} from "../../src/modules/ledger/domain/ledger-transaction";
import { reconcile } from "../../src/modules/ledger/domain/reconciliation";

// Criterion 2.4, hazard H2.4: the reconciliation identity must hold on any
// dataset the model admits, not only on the cases someone thought of.
//
//   income - spend - netToReserves === changeInPot
//
// changeInPot comes from the FACTS side only (the sum of raw transaction
// amounts over pot accounts); income, spend and net-to-reserves come from
// the interpretation output. The property: the identity holds EXACTLY, in
// integer cents, whenever interpretation surfaces no UNRESOLVED rows and
// no unmatched internal legs; otherwise the computed difference equals the
// sum of the surfaced gaps, exactly.

const IBAN_A = "BE68539007547034";
const IBAN_B = "BE71096123456769";
const IBAN_RESERVE = "BE43068999999501";

const ACCOUNTS: readonly DeclaredAccount[] = [
  { id: "acc-a", role: "POT", iban: IBAN_A },
  { id: "acc-b", role: "POT", iban: IBAN_B },
  { id: "acc-card", role: "POT" },
  { id: "acc-reserve", role: "RESERVE", iban: IBAN_RESERVE },
];

const OUTSIDE_IBANS = [
  "BE54540123456789",
  "BE02979245566602",
  "BE39103123456719",
] as const;

const BASE = Date.UTC(2026, 6, 1); // 2026-07-01
const day = (offset: number): PlainDate =>
  plainDate(new Date(BASE + offset * 86_400_000).toISOString().slice(0, 10));

// The scenario vocabulary: each generated shape expands into one or more
// fact rows. Together they cover all five flow values, unmatched internal
// legs, and all four correction shapes.
type Shape =
  | { readonly kind: "income"; readonly amount: number; readonly at: number; readonly counterparty: number }
  | { readonly kind: "spend"; readonly amount: number; readonly at: number; readonly counterparty: number }
  | { readonly kind: "refund"; readonly amount: number; readonly at: number; readonly counterparty: number }
  | { readonly kind: "cash-withdrawal"; readonly amount: number; readonly at: number }
  | { readonly kind: "reserve-park"; readonly amount: number; readonly at: number }
  | { readonly kind: "reserve-drawdown"; readonly amount: number; readonly at: number }
  | { readonly kind: "transfer"; readonly amount: number; readonly at: number; readonly lag: number; readonly aToB: boolean }
  | { readonly kind: "unmatched-internal"; readonly amount: number; readonly at: number }
  | {
      readonly kind: "card-settlement";
      readonly items: readonly number[];
      readonly at: number;
      readonly settleLag: number;
      readonly withMirror: boolean;
    }
  | { readonly kind: "unitemised-settlement-debit"; readonly amount: number; readonly at: number }
  | { readonly kind: "zero-row"; readonly at: number };

const amount = fc.integer({ min: 1, max: 500_000 });
const at = fc.integer({ min: 0, max: 40 });
const counterparty = fc.integer({ min: 0, max: OUTSIDE_IBANS.length - 1 });

const shapeArb: fc.Arbitrary<Shape> = fc.oneof(
  fc.record({ kind: fc.constant("income" as const), amount, at, counterparty }),
  fc.record({ kind: fc.constant("spend" as const), amount, at, counterparty }),
  fc.record({ kind: fc.constant("refund" as const), amount, at, counterparty }),
  fc.record({ kind: fc.constant("cash-withdrawal" as const), amount, at }),
  fc.record({ kind: fc.constant("reserve-park" as const), amount, at }),
  fc.record({ kind: fc.constant("reserve-drawdown" as const), amount, at }),
  fc.record({
    kind: fc.constant("transfer" as const),
    amount,
    at,
    lag: fc.integer({ min: 0, max: 4 }),
    aToB: fc.boolean(),
  }),
  fc.record({ kind: fc.constant("unmatched-internal" as const), amount, at }),
  fc.record({
    kind: fc.constant("card-settlement" as const),
    items: fc.array(fc.integer({ min: 1, max: 50_000 }), { minLength: 1, maxLength: 3 }),
    at,
    settleLag: fc.integer({ min: 1, max: 10 }),
    withMirror: fc.boolean(),
  }),
  fc.record({ kind: fc.constant("unitemised-settlement-debit" as const), amount, at }),
  fc.record({ kind: fc.constant("zero-row" as const), at }),
);

type World = {
  readonly transactions: readonly LedgerTransaction[];
};

const expand = (shapes: readonly Shape[], order: number): World => {
  const transactions: LedgerTransaction[] = [];
  let sequence = 0;
  let cardStatement = 100;
  const id = (): string => `t${String(sequence++).padStart(4, "0")}`;
  const push = (input: {
    readonly accountId: string;
    readonly importId: string;
    readonly at: number;
    readonly amount: number;
    readonly description: string;
    readonly counterpartyIban?: string;
  }): void => {
    transactions.push({
      id: id(),
      accountId: input.accountId,
      importId: input.importId,
      bookingDate: day(input.at),
      amountCents: cents(input.amount) as Cents,
      description: input.description,
      ...(input.counterpartyIban === undefined
        ? {}
        : { counterpartyIban: input.counterpartyIban }),
    });
  };

  for (const shape of shapes) {
    switch (shape.kind) {
      case "income":
        push({
          accountId: "acc-a",
          importId: "cur-a",
          at: shape.at,
          amount: shape.amount,
          description: `LOON PERIODE ${shape.at}`,
          counterpartyIban: OUTSIDE_IBANS[shape.counterparty] as string,
        });
        break;
      case "spend":
        push({
          accountId: "acc-a",
          importId: "cur-a",
          at: shape.at,
          amount: -shape.amount,
          description: "BETALING MET DEBETKAART WINKEL",
          counterpartyIban: OUTSIDE_IBANS[shape.counterparty] as string,
        });
        break;
      case "refund": {
        const iban = OUTSIDE_IBANS[shape.counterparty] as string;
        push({
          accountId: "acc-a",
          importId: "cur-a",
          at: shape.at,
          amount: -shape.amount,
          description: "BETALING WEBSHOP",
          counterpartyIban: iban,
        });
        push({
          accountId: "acc-a",
          importId: "cur-a",
          at: Math.min(shape.at + 3, 45),
          amount: shape.amount,
          description: "TERUGBETALING WEBSHOP",
          counterpartyIban: iban,
        });
        break;
      }
      case "cash-withdrawal":
        push({
          accountId: "acc-a",
          importId: "cur-a",
          at: shape.at,
          amount: -shape.amount,
          description: "MAESTRO GELDOPNAME BANCONTACT GENT",
        });
        break;
      case "reserve-park":
        push({
          accountId: "acc-a",
          importId: "cur-a",
          at: shape.at,
          amount: -shape.amount,
          description: "OVERSCHRIJVING NAAR SPAARREKENING",
          counterpartyIban: IBAN_RESERVE,
        });
        break;
      case "reserve-drawdown":
        push({
          accountId: "acc-a",
          importId: "cur-a",
          at: shape.at,
          amount: shape.amount,
          description: "OVERSCHRIJVING VAN SPAARREKENING",
          counterpartyIban: IBAN_RESERVE,
        });
        break;
      case "transfer": {
        const [fromAccount, fromIban, toAccount, toIban] = shape.aToB
          ? (["acc-a", IBAN_A, "acc-b", IBAN_B] as const)
          : (["acc-b", IBAN_B, "acc-a", IBAN_A] as const);
        push({
          accountId: fromAccount,
          importId: `cur-${fromAccount}`,
          at: shape.at,
          amount: -shape.amount,
          description: "OVERSCHRIJVING EIGEN REKENING",
          counterpartyIban: toIban,
        });
        push({
          accountId: toAccount,
          importId: `cur-${toAccount}`,
          at: shape.at + shape.lag,
          amount: shape.amount,
          description: "OVERSCHRIJVING EIGEN REKENING",
          counterpartyIban: fromIban,
        });
        break;
      }
      case "unmatched-internal":
        push({
          accountId: "acc-a",
          importId: "cur-a",
          at: shape.at,
          amount: -shape.amount,
          description: "OVERSCHRIJVING EIGEN REKENING",
          counterpartyIban: IBAN_B,
        });
        break;
      case "card-settlement": {
        const statement = cardStatement++;
        const importId = `card-${statement}`;
        let periodEnd = shape.at;
        for (const [index, item] of shape.items.entries()) {
          const itemAt = shape.at + index;
          periodEnd = Math.max(periodEnd, itemAt);
          push({
            accountId: "acc-card",
            importId,
            at: itemAt,
            amount: -item,
            description: "KAARTBETALING HANDELAAR",
          });
        }
        const total = shape.items.reduce((sum, item) => sum + item, 0);
        const settleAt = periodEnd + shape.settleLag;
        push({
          accountId: "acc-a",
          importId: "cur-a",
          at: settleAt,
          amount: -total,
          description: `MASTERCARD AFREKENING NUMMER ${statement}`,
        });
        if (shape.withMirror) {
          push({
            accountId: "acc-card",
            importId: `card-${statement + 1000}`,
            at: settleAt,
            amount: total,
            description: "DOMICILIERING VIA JE BANK",
          });
        }
        break;
      }
      case "unitemised-settlement-debit":
        // A card whose statements are never imported: the pattern debit
        // must stay SPEND (criterion 2.8). The statement number is chosen
        // outside the generated card range.
        push({
          accountId: "acc-a",
          importId: "cur-a",
          at: shape.at,
          amount: -shape.amount,
          description: "MASTERCARD AFREKENING NUMMER 9",
        });
        break;
      case "zero-row":
        push({
          accountId: "acc-a",
          importId: "cur-a",
          at: shape.at,
          amount: 0,
          description: "ONBEKENDE NULVERRICHTING",
        });
        break;
    }
  }

  // Deterministic reordering derived from the generated seed, so the
  // identity is also exercised against arbitrary insertion orders.
  const reordered = [...transactions];
  let state = order;
  for (let i = reordered.length - 1; i > 0; i -= 1) {
    state = (state * 1664525 + 1013904223) % 4294967296;
    const j = state % (i + 1);
    const swap = reordered[i] as LedgerTransaction;
    reordered[i] = reordered[j] as LedgerTransaction;
    reordered[j] = swap;
  }
  return { transactions: reordered };
};

describe("the reconciliation identity is a property of the model, not of chosen examples", () => {
  test("holds exactly in integer cents across at least 500 generated datasets", () => {
    const seenFlows = new Set<string>();
    const seenShapes = new Set<string>();
    let sawUnmatched = false;
    let sawCleanBooks = false;

    fc.assert(
      fc.property(
        fc.array(shapeArb, { minLength: 1, maxLength: 12 }),
        fc.integer({ min: 0, max: 2 ** 31 }),
        (shapes, order) => {
          for (const shape of shapes) {
            seenShapes.add(shape.kind);
          }
          const { transactions } = expand(shapes, order);
          const interpretation = interpretLedger({ transactions, accounts: ACCOUNTS });
          const report = reconcile(transactions, interpretation);

          for (const flow of interpretation.flows.values()) {
            seenFlows.add(flow);
          }

          // Everything is integer cents; a float anywhere is a bug.
          for (const value of [
            report.incomeCents,
            report.spendCents,
            report.netToReservesCents,
            report.changeInPotCents,
            report.differenceCents,
            report.unresolvedGapCents,
            report.unmatchedInternalGapCents,
          ]) {
            expect(Number.isInteger(value)).toBe(true);
          }

          const hasGaps =
            interpretation.unresolvedIds.length > 0 ||
            interpretation.unmatchedInternalIds.length > 0;
          if (hasGaps) {
            sawUnmatched = sawUnmatched || interpretation.unmatchedInternalIds.length > 0;
            // The difference is never hidden: it equals the surfaced gaps,
            // exactly.
            expect(report.differenceCents).toBe(
              report.unresolvedGapCents + report.unmatchedInternalGapCents,
            );
            expect(report.reconciles).toBe(report.differenceCents === 0);
          } else {
            sawCleanBooks = true;
            // No unresolved rows, no unmatched legs: the books close to
            // zero, exactly.
            expect(report.differenceCents).toBe(0);
            expect(report.reconciles).toBe(true);
            expect(
              report.incomeCents - report.spendCents - report.netToReservesCents,
            ).toBe(report.changeInPotCents);
          }
        },
      ),
      { numRuns: 500 },
    );

    // The generators genuinely produced the model's whole vocabulary:
    // all five flow values, unmatched internal legs, and all four
    // correction shapes (card settlement, reserve drawdown, refund, cash
    // withdrawal). Asserted from what actually ran, not assumed.
    expect([...seenFlows].sort()).toEqual([
      "INCOME",
      "INTERNAL",
      "RESERVE",
      "SPEND",
      "UNRESOLVED",
    ]);
    for (const requiredShape of [
      "card-settlement",
      "reserve-drawdown",
      "refund",
      "cash-withdrawal",
      "unmatched-internal",
      "unitemised-settlement-debit",
      "zero-row",
      "transfer",
    ]) {
      expect(seenShapes).toContain(requiredShape);
    }
    expect(sawUnmatched).toBe(true);
    expect(sawCleanBooks).toBe(true);
  });
});
