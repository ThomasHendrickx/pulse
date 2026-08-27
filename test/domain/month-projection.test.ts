import { describe, expect, test } from "vitest";
import { cents } from "@/platform/money";
import { plainDate } from "@/platform/plain-date";
import {
  brusselsDayOf,
  daysInMonth,
  isAfter,
  monthBounds,
  monthOfPlainDate,
  nextMonth,
  parseMonth,
  previousMonth,
  type Month,
} from "@/modules/overview/domain/month";
import {
  attachDeltas,
  deriveMonthFigures,
  foldGroups,
  sumGroups,
  type CountedGroupRow,
  type RawMonthFigures,
} from "@/modules/overview/domain/month-projection";
import {
  counterpartyIdentity,
  normaliseCounterparty,
} from "@/modules/merchants/application";

// The pure projection layer's fast-gate suite (fix round 1, CR-504: the
// layer shipped with e2e coverage only, so a silent sign flip or an
// off-by-one month would have survived the fast gate). The verdict
// tests double as the red witnesses for CR-501 and CR-502's semantics:
// written before the reconciles tightening and shown red against the
// difference===0 verdict.

const month = (value: string): Month => {
  const parsed = parseMonth(value);
  if (parsed === undefined) {
    throw new Error(`Not a month: ${value}`);
  }
  return parsed;
};

const rawFigures = (overrides: Partial<RawMonthFigures>): RawMonthFigures => ({
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
  ...overrides,
});

describe("calendar month arithmetic (month.ts)", () => {
  test("previousMonth crosses the year boundary: January compares to last December", () => {
    expect(previousMonth(month("2026-01"))).toBe("2025-12");
    expect(previousMonth(month("2026-08"))).toBe("2026-07");
  });

  test("nextMonth crosses the year boundary forward", () => {
    expect(nextMonth(month("2025-12"))).toBe("2026-01");
    expect(nextMonth(month("2026-08"))).toBe("2026-09");
  });

  test("month bounds are inclusive and leap-aware", () => {
    expect(monthBounds(month("2028-02"))).toEqual({
      from: "2028-02-01",
      to: "2028-02-29",
    });
    expect(monthBounds(month("2026-02"))).toEqual({
      from: "2026-02-01",
      to: "2026-02-28",
    });
    expect(daysInMonth(month("2026-09"))).toBe(30);
    expect(daysInMonth(month("2026-12"))).toBe(31);
  });

  test("parseMonth accepts only real YYYY-MM values", () => {
    expect(parseMonth("2026-08")).toBe("2026-08");
    for (const bad of ["2026-13", "2026-0", "2026-1", "202608", "aaaa-bb", "", undefined]) {
      expect(parseMonth(bad)).toBeUndefined();
    }
  });

  test("the Brussels day rolls the month at the household's midnight, not UTC's", () => {
    // 22:30 UTC on 31 August is 00:30 CEST on 1 September.
    expect(brusselsDayOf(new Date("2026-08-31T22:30:00Z"))).toBe("2026-09-01");
    // 23:30 UTC on 31 December is 00:30 CET on 1 January.
    expect(brusselsDayOf(new Date("2026-12-31T23:30:00Z"))).toBe("2027-01-01");
    // Midday stays inside the same day either side of DST.
    expect(brusselsDayOf(new Date("2026-09-15T12:00:00Z"))).toBe("2026-09-15");
    expect(monthOfPlainDate(plainDate("2026-09-15"))).toBe("2026-09");
    expect(isAfter(month("2026-10"), month("2026-09"))).toBe(true);
  });
});

describe("foldGroups partitions every row into exactly one group", () => {
  const options = { useTags: true, identity: counterpartyIdentity, normalise: normaliseCounterparty };

  const row = (overrides: Partial<CountedGroupRow>): CountedGroupRow => ({
    merchantId: null,
    merchantName: null,
    primaryTag: null,
    counterpartyText: "SUPERMARKT NOORD GENT",
    counterpartyAccount: null,
    isCash: false,
    totalCents: cents(-1000),
    rowCount: 1,
    ...overrides,
  });

  test("group totals sum to the row totals, whatever the mix", () => {
    const rows = [
      row({ merchantId: "m1", merchantName: "Colruyt", totalCents: cents(-4200) }),
      row({ merchantId: "m1", merchantName: "Colruyt", totalCents: cents(-800) }),
      row({ merchantId: "m2", merchantName: "Luminus", primaryTag: "Housing", totalCents: cents(-17600) }),
      row({ totalCents: cents(-8647) }),
      row({ isCash: true, totalCents: cents(-10000) }),
    ];
    const groups = foldGroups(rows, options);
    const rowSum = rows.reduce((total, r) => total + r.totalCents, 0);
    expect(sumGroups(groups)).toBe(rowSum);
    expect(groups.reduce((total, g) => total + g.rowCount, 0)).toBe(rows.length);
  });

  test("the cash marker takes precedence over a merchant assignment on the same row (M1P4-C7)", () => {
    const groups = foldGroups(
      [
        row({
          isCash: true,
          merchantId: "m9",
          merchantName: "Named By User",
          primaryTag: "Groceries",
          totalCents: cents(-10000),
        }),
      ],
      options,
    );
    expect(groups).toHaveLength(1);
    expect(groups[0]?.kind).toBe("cash");
    expect(groups[0]?.totalCents).toBe(-10000);
  });

  test("unresolved rows fold under the merchants module's normalised key", () => {
    const groups = foldGroups(
      [
        row({ counterpartyText: "SUPERMARKT NOORD GENT", totalCents: cents(-1000) }),
        row({ counterpartyText: "Supermarkt Noord", totalCents: cents(-2000) }),
      ],
      options,
    );
    expect(groups).toHaveLength(1);
    expect(groups[0]?.kind).toBe("unresolved");
    expect(groups[0]?.label).toBe("SUPERMARKT NOORD");
    expect(groups[0]?.totalCents).toBe(-3000);
  });

  test("a merchant's primary tag groups it; an untagged merchant stands alone", () => {
    const groups = foldGroups(
      [
        row({ merchantId: "m2", merchantName: "Luminus", primaryTag: "Housing", totalCents: cents(-17600) }),
        row({ merchantId: "m3", merchantName: "Telenet", primaryTag: "Housing", totalCents: cents(-6899) }),
        row({ merchantId: "m1", merchantName: "Colruyt", totalCents: cents(-5000) }),
      ],
      options,
    );
    expect(groups.map((g) => [g.kind, g.label, g.totalCents])).toEqual([
      ["tag", "Housing", -24499],
      ["merchant", "Colruyt", -5000],
    ]);
  });
});

describe("attachDeltas joins by group key and pins the magnitude semantics", () => {
  test("deltas join by key across the year boundary, not by array position", () => {
    const january = foldGroups(
      [
        { merchantId: "m1", merchantName: "Colruyt", primaryTag: null, counterpartyText: "COLRUYT", counterpartyAccount: null, isCash: false, totalCents: cents(-5000), rowCount: 2 },
        { merchantId: null, merchantName: null, primaryTag: null, counterpartyText: "BAKKERIJ CENTRUM", counterpartyAccount: null, isCash: false, totalCents: cents(-1500), rowCount: 1 },
      ],
      { useTags: true, identity: counterpartyIdentity, normalise: normaliseCounterparty },
    );
    const december = foldGroups(
      [
        { merchantId: null, merchantName: null, primaryTag: null, counterpartyText: "BAKKERIJ CENTRUM", counterpartyAccount: null, isCash: false, totalCents: cents(-1000), rowCount: 1 },
        { merchantId: "m1", merchantName: "Colruyt", primaryTag: null, counterpartyText: "COLRUYT", counterpartyAccount: null, isCash: false, totalCents: cents(-6000), rowCount: 3 },
      ],
      { useTags: true, identity: counterpartyIdentity, normalise: normaliseCounterparty },
    );
    const withDeltas = attachDeltas(january, december);
    const byKey = new Map(withDeltas.map((g) => [g.key, g.deltaCents]));
    expect(byKey.get("merchant:m1")).toBe(-1000);
    // M3-P12: the unresolved key is the counterparty IDENTITY under the
    // fold's own text: prefix. These rows carry no account, so the identity
    // is the descriptor basis and the suffix is the key they always had.
    expect(byKey.get("text:descriptor:BAKKERIJ CENTRUM")).toBe(500);
  });

  test("PINNED DECISION (review probe P-F11): the delta is the MAGNITUDE change, |current| minus |previous|, including across a sign flip", () => {
    // A group that was 60,00 spend last month and is a 10,00 net refund
    // this month renders delta -50,00 (the group's weight in the month
    // shrank by 50,00), NOT the signed swing of +70,00. The section
    // totals carry the signed story; the per-group column answers "is
    // this group bigger or smaller than last month".
    const current = [
      { key: "merchant:m1", kind: "merchant" as const, label: "Refunder", totalCents: cents(1000), rowCount: 1 },
    ];
    const previous = [
      { key: "merchant:m1", kind: "merchant" as const, label: "Refunder", totalCents: cents(-6000), rowCount: 2 },
    ];
    expect(attachDeltas(current, previous)[0]?.deltaCents).toBe(-5000);
  });

  test("a group with no previous-month counterpart deltas against zero", () => {
    const current = [
      { key: "cash", kind: "cash" as const, label: "", totalCents: cents(-10000), rowCount: 1 },
    ];
    expect(attachDeltas(current, [])[0]?.deltaCents).toBe(10000);
  });
});

describe("deriveMonthFigures: the identity and the verdict (CR-501, CR-502)", () => {
  test("the difference equals the sum of the named causes, by construction", () => {
    // Consistent raw sums, as one table produces them: income 2.500,00,
    // spend 1.918,97, one unmatched leg of -400,00, one in-transit leg
    // of +100,00, so the pot moved 281,03 and the difference is the
    // legs' net -300,00, partitioned exactly by the two cause sums.
    const figures = deriveMonthFigures(
      rawFigures({
        incomeSignedCents: cents(250000),
        spendSignedCents: cents(-191897),
        changeInPotCents: cents(250000 - 191897 - 40000 + 10000),
        unmatchedInternalCents: cents(-40000),
        unmatchedInternalCount: 1,
        inTransitCents: cents(10000),
        inTransitCount: 1,
        rowCount: 12,
      }),
    );
    expect(figures.differenceCents).toBe(
      figures.unresolvedCents +
        figures.unmatchedInternalCents +
        figures.inTransitCents,
    );
  });

  test("a matched pair in transit across the month boundary is a named cause and blocks the ok verdict", () => {
    const figures = deriveMonthFigures(
      rawFigures({
        incomeSignedCents: cents(150000),
        changeInPotCents: cents(120000),
        inTransitCents: cents(-30000),
        inTransitCount: 1,
        rowCount: 2,
      }),
    );
    expect(figures.differenceCents).toBe(-30000);
    expect(figures.inTransitCents).toBe(-30000);
    expect(figures.reconciles).toBe(false);
  });

  test("cancelling unmatched gaps leave the difference at zero and the verdict must still refuse ok", () => {
    const figures = deriveMonthFigures(
      rawFigures({
        incomeSignedCents: cents(100000),
        changeInPotCents: cents(100000),
        unmatchedInternalCents: cents(0),
        unmatchedInternalCount: 2,
        rowCount: 3,
      }),
    );
    expect(figures.differenceCents).toBe(0);
    expect(figures.reconciles).toBe(false);
  });

  test("a zero-amount unresolved row blocks the ok verdict even though it moves no cent", () => {
    const figures = deriveMonthFigures(
      rawFigures({ unresolvedCount: 1, rowCount: 1 }),
    );
    expect(figures.differenceCents).toBe(0);
    expect(figures.reconciles).toBe(false);
  });

  test("a committed row interpretation has not stamped yet blocks the ok verdict (CR-502)", () => {
    const figures = deriveMonthFigures(
      rawFigures({ uninterpretedCount: 1, rowCount: 0 }),
    );
    expect(figures.reconciles).toBe(false);
    expect(figures.uninterpretedCount).toBe(1);
  });

  test("the ok verdict requires a zero difference AND empty causes, and then holds", () => {
    const figures = deriveMonthFigures(
      rawFigures({
        incomeSignedCents: cents(250000),
        spendSignedCents: cents(-191897),
        reserveSignedCents: cents(0),
        changeInPotCents: cents(58103),
        rowCount: 12,
      }),
    );
    expect(figures.differenceCents).toBe(0);
    expect(figures.reconciles).toBe(true);
    expect(figures.spendCents).toBe(191897);
    expect(figures.netToReservesCents).toBe(0);
  });
});
