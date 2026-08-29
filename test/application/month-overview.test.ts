import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { fixedClock } from "@/platform/clock";
import { cents } from "@/platform/money";
import { plainDate } from "@/platform/plain-date";
import type { HouseholdContext } from "@/platform/tenancy";
import {
  counterpartyIdentity,
  isBareIdentityKey,
  normaliseCounterparty,
} from "@/modules/merchants/application";
import { getMonthOverviewWith } from "@/modules/overview/application";
import type {
  CountedGroupRow,
  GapRow,
  HeldRow,
  OverviewDependencies,
  OverviewRepositoryPort,
  Period,
  RawMonthFigures,
  ReserveMovementGroup,
} from "@/modules/overview/application";

// The month overview use case over an in-memory fake of the repository
// port (fix round 1, CR-504), with the real domain fold and the real
// merchants normalisation, the same shape as the other application
// suites. The clock is fixed mid-September 2026 like the e2e webServer.

const context = { householdId: "00000000-0000-4000-8000-000000000001" } as HouseholdContext;

const emptyFigures: RawMonthFigures = {
  incomeSignedCents: cents(0),
  spendSignedCents: cents(0),
  reserveSignedCents: cents(0),
  changeInPotCents: cents(0),
  unresolvedCents: cents(0),
  unresolvedCount: 0,
  unmatchedInternalCents: cents(0),
  unmatchedInternalCount: 0,
  inTransitCents: cents(0),
  inTransitCount: 0,
  uninterpretedCount: 0,
  rowCount: 0,
};

type MonthData = {
  readonly income?: readonly CountedGroupRow[];
  readonly spend?: readonly CountedGroupRow[];
  readonly reserves?: readonly ReserveMovementGroup[];
  readonly figures?: RawMonthFigures;
  readonly gaps?: readonly GapRow[];
  readonly held?: readonly HeldRow[];
};

const fakeWorld = (byMonth: Record<string, MonthData>) => {
  const reads: string[] = [];
  const dataFor = (period: Period): MonthData =>
    byMonth[period.from.slice(0, 7)] ?? {};
  const overview: OverviewRepositoryPort = {
    listIncomeGroups: async (_context, period) => {
      reads.push(`income:${period.from.slice(0, 7)}`);
      return dataFor(period).income ?? [];
    },
    listSpendGroups: async (_context, period) => dataFor(period).spend ?? [],
    listReserveMovements: async (_context, period) =>
      dataFor(period).reserves ?? [],
    monthFigures: async (_context, period) =>
      dataFor(period).figures ?? emptyFigures,
    listGapRows: async (_context, period) => dataFor(period).gaps ?? [],
    listHeldRows: async (_context, period) => dataFor(period).held ?? [],
    hasAnyTransactions: async () => Object.keys(byMonth).length > 0,
  };
  const deps: OverviewDependencies = {
    overview,
    clock: fixedClock(new Date("2026-09-15T12:00:00Z")),
    counterpartyIdentity,
    isBareIdentityKey,
    normaliseCounterparty,
  };
  return { deps, reads };
};

const incomeRow = (totalCents: number): CountedGroupRow => ({
  merchantId: null,
  merchantName: null,
  primaryTag: null,
  counterpartyText: "Acme Salaris BV",
  counterpartyAccount: null,
  isCash: false,
  totalCents: cents(totalCents),
  rowCount: 1,
});

describe("the partial current month is never compared (hazard H4.1)", () => {
  test("no previous-month read even happens for the current month", async () => {
    const { deps, reads } = fakeWorld({
      "2026-09": { income: [incomeRow(250000)], figures: { ...emptyFigures, incomeSignedCents: cents(250000), changeInPotCents: cents(250000), rowCount: 1 } },
      "2026-08": { income: [incomeRow(240000)] },
    });
    const overview = await getMonthOverviewWith(context, deps);
    expect(overview.month).toBe("2026-09");
    expect(overview.partial).toBe(true);
    expect(overview.compared).toBe(false);
    expect(overview.daysElapsed).toBe(15);
    expect(overview.daysInMonth).toBe(30);
    expect(overview.income.deltaCents).toBeUndefined();
    expect(overview.income.groups[0]?.deltaCents).toBeUndefined();
    // The structural half: the comparison was never even read.
    expect(reads).toEqual(["income:2026-09"]);
  });

  test("a closed month compares to its predecessor, joining groups by key", async () => {
    const { deps, reads } = fakeWorld({
      "2026-08": { income: [incomeRow(250000)], figures: { ...emptyFigures, incomeSignedCents: cents(250000), changeInPotCents: cents(250000), rowCount: 1 } },
      "2026-07": { income: [incomeRow(240000)], figures: { ...emptyFigures, incomeSignedCents: cents(240000), changeInPotCents: cents(240000), rowCount: 1 } },
    });
    const overview = await getMonthOverviewWith(context, deps, "2026-08");
    expect(overview.partial).toBe(false);
    expect(overview.compared).toBe(true);
    expect(overview.income.groups[0]?.deltaCents).toBe(10000);
    expect(overview.income.deltaCents).toBe(10000);
    expect(reads).toEqual(["income:2026-08", "income:2026-07"]);
  });

  test("a future month request falls back to the current month", async () => {
    const { deps } = fakeWorld({ "2026-09": {} });
    const overview = await getMonthOverviewWith(context, deps, "2027-03");
    expect(overview.month).toBe("2026-09");
    expect(overview.partial).toBe(true);
  });
});

describe("gap partitioning feeds the panel (CR-501, CR-502)", () => {
  const gap = (
    kind: GapRow["gap"],
    amount: number,
  ): GapRow => ({
    id: `row-${kind}-${amount}`,
    gap: kind,
    bookingDate: plainDate("2026-08-30"),
    text: "OVERSCHRIJVING NAAR EIGEN REKENING",
    accountLabel: "Daily account",
    amountCents: cents(amount),
  });

  test("in-transit legs land in their own list and block the ok verdict", async () => {
    const { deps } = fakeWorld({
      "2026-08": {
        figures: {
          ...emptyFigures,
          incomeSignedCents: cents(150000),
          changeInPotCents: cents(120000),
          inTransitCents: cents(-30000),
          inTransitCount: 1,
          rowCount: 2,
        },
        gaps: [gap("in-transit", -30000)],
      },
      "2026-07": {},
    });
    const overview = await getMonthOverviewWith(context, deps, "2026-08");
    expect(overview.inTransitLegs).toHaveLength(1);
    expect(overview.unmatchedLegs).toHaveLength(0);
    expect(overview.figures.reconciles).toBe(false);
    expect(overview.figures.differenceCents).toBe(-30000);
  });

  test("a committed but uninterpreted row surfaces instead of vanishing (CR-502)", async () => {
    const { deps } = fakeWorld({
      "2026-08": {
        figures: { ...emptyFigures, uninterpretedCount: 1 },
        gaps: [gap("uninterpreted", 77700)],
      },
      "2026-07": {},
    });
    const overview = await getMonthOverviewWith(context, deps, "2026-08");
    expect(overview.uninterpretedRows).toHaveLength(1);
    expect(overview.uninterpretedRows[0]?.amountCents).toBe(77700);
    expect(overview.figures.reconciles).toBe(false);
  });

  test("unmatched and unresolved rows partition into their own lists", async () => {
    const { deps } = fakeWorld({
      "2026-08": {
        figures: {
          ...emptyFigures,
          unmatchedInternalCents: cents(-40000),
          unmatchedInternalCount: 1,
          unresolvedCount: 1,
          changeInPotCents: cents(-40000),
          rowCount: 2,
        },
        gaps: [gap("unmatched-internal", -40000), gap("unresolved", 0)],
      },
      "2026-07": {},
    });
    const overview = await getMonthOverviewWith(context, deps, "2026-08");
    expect(overview.unmatchedLegs).toHaveLength(1);
    expect(overview.unresolvedRows).toHaveLength(1);
    expect(overview.inTransitLegs).toHaveLength(0);
    expect(overview.uninterpretedRows).toHaveLength(0);
    expect(overview.figures.reconciles).toBe(false);
  });
});

describe("repository SQL shape: every query filters on householdId (non-negotiable 6, fix round finding CR-507)", () => {
  const source = readFileSync(
    join(
      __dirname,
      "..",
      "..",
      "src",
      "modules",
      "overview",
      "adapters",
      "overview-repository.ts",
    ),
    "utf-8",
  );

  test("the in-transit partner join carries the household filter by name", () => {
    // The reviewer's finding: the partner row was read through the link
    // with no householdId predicate of its own. Links are written only
    // within a household today, which is why no harm was constructible,
    // but non-negotiable 6 is the letter: EVERY query filters on
    // householdId, so the next refactor of the link writer does not
    // silently turn this into a cross-tenant read.
    expect(source).toMatch(
      /JOIN "transactions" p\s+ON p\."householdId" = t\."householdId"/,
    );
  });

  test("every JOIN in the repository carries a householdId predicate near its ON clause", () => {
    const joins = [...source.matchAll(/JOIN "[a-z_]+" \w+/g)];
    expect(joins.length).toBeGreaterThanOrEqual(6);
    const offenders = joins
      .filter((match) => {
        const window = source.slice(match.index, (match.index ?? 0) + 300);
        return !window.includes("householdId");
      })
      .map((match) => match[0]);
    expect(offenders).toEqual([]);
  });
});
