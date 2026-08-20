// The month projection's pure half: folding the repository's grouped rows
// into display groups, attaching previous-month deltas, and deriving the
// reconciliation figures from raw sums. Computed on read, per request; no
// materialisation and no cache exists to go stale
// (pulse-v1-architecture.md section 8).

import type { Cents } from "@/platform/money";
import { cents } from "@/platform/money";
import type { PlainDate } from "@/platform/plain-date";

// One row of the repository's grouped counted query: already aggregated
// per (merchant, primary tag, counterparty text, cash marker) by SQL; the
// fold below only merges these into display groups.
export type CountedGroupRow = {
  readonly merchantId: string | null;
  readonly merchantName: string | null;
  readonly primaryTag: string | null;
  readonly counterpartyText: string;
  readonly isCash: boolean;
  readonly totalCents: Cents;
  readonly rowCount: number;
};

export type OverviewGroupKind = "tag" | "merchant" | "cash" | "unresolved";

export type OverviewGroup = {
  readonly key: string;
  readonly kind: OverviewGroupKind;
  // Display label. Empty for the cash group: its name is translated copy
  // ("cash" is a destination the UI names in the viewer's language), and
  // an English label baked here could not be.
  readonly label: string;
  // Signed as stored: spend groups are negative, income groups positive.
  readonly totalCents: Cents;
  readonly rowCount: number;
  // Magnitude change against the previous closed month: |current| minus
  // |previous|. Present only when the viewed month is closed (the partial
  // current month is NEVER compared, pulse-v1-plan.md:206).
  readonly deltaCents?: Cents;
};

// Grouping order for spend, deliberate (M1P4-C7 resolved here): the cash
// marker takes PRECEDENCE over any merchant assignment, so a named cash
// row still lands under the "cash" destination; then the merchant's
// primary tag; then the merchant alone; unresolved rows group under their
// normalised counterparty text exactly like the merchant review screen,
// so both screens name an unknown the same way.
export const foldGroups = (
  rows: readonly CountedGroupRow[],
  options: {
    readonly useTags: boolean;
    readonly normalise: (text: string) => string;
  },
): readonly OverviewGroup[] => {
  const groups = new Map<
    string,
    { kind: OverviewGroupKind; label: string; total: number; rowCount: number }
  >();
  for (const row of rows) {
    let key: string;
    let kind: OverviewGroupKind;
    let label: string;
    if (row.isCash) {
      key = "cash";
      kind = "cash";
      label = "";
    } else if (
      options.useTags &&
      row.merchantId !== null &&
      row.primaryTag !== null
    ) {
      key = `tag:${row.primaryTag}`;
      kind = "tag";
      label = row.primaryTag;
    } else if (row.merchantId !== null) {
      key = `merchant:${row.merchantId}`;
      kind = "merchant";
      label = row.merchantName ?? "";
    } else {
      const normalised = options.normalise(row.counterpartyText);
      key = `text:${normalised}`;
      kind = "unresolved";
      label = normalised;
    }
    const existing = groups.get(key);
    if (existing === undefined) {
      groups.set(key, {
        kind,
        label,
        total: row.totalCents,
        rowCount: row.rowCount,
      });
    } else {
      existing.total += row.totalCents;
      existing.rowCount += row.rowCount;
    }
  }
  return [...groups.entries()]
    .map(([key, entry]) => ({
      key,
      kind: entry.kind,
      label: entry.label,
      totalCents: cents(entry.total),
      rowCount: entry.rowCount,
    }))
    .sort(
      (a, b) =>
        Math.abs(b.totalCents) - Math.abs(a.totalCents) ||
        a.label.localeCompare(b.label) ||
        (a.key < b.key ? -1 : 1),
    );
};

// Deltas by group key against the previous CLOSED month: magnitude change,
// so "spent 8,73 less at this merchant" is negative whichever sign the
// stored totals carry. Groups present only in the previous month are not
// resurrected as zero rows; the section totals carry the full difference.
export const attachDeltas = (
  current: readonly OverviewGroup[],
  previous: readonly OverviewGroup[],
): readonly OverviewGroup[] => {
  const previousByKey = new Map(previous.map((group) => [group.key, group]));
  return current.map((group) => {
    const before = previousByKey.get(group.key);
    return {
      ...group,
      deltaCents: cents(
        Math.abs(group.totalCents) - Math.abs(before?.totalCents ?? 0),
      ),
    };
  });
};

export const sumGroups = (groups: readonly OverviewGroup[]): Cents =>
  cents(groups.reduce((total, group) => total + group.totalCents, 0));

// Raw signed sums straight from SQL, over the viewed month's interpreted
// (pot) rows only.
export type RawMonthFigures = {
  readonly incomeSignedCents: Cents;
  readonly spendSignedCents: Cents;
  readonly reserveSignedCents: Cents;
  readonly changeInPotCents: Cents;
  readonly unresolvedCents: Cents;
  readonly unresolvedCount: number;
  readonly unmatchedInternalCents: Cents;
  readonly unmatchedInternalCount: number;
  readonly rowCount: number;
};

export type MonthFigures = {
  readonly incomeCents: Cents;
  // Positive magnitudes for display; the signs live in the identity.
  readonly spendCents: Cents;
  readonly netToReservesCents: Cents;
  readonly changeInPotCents: Cents;
  // changeInPot - (income - spend - netToReserves). Zero when the books
  // close. By construction of the per-month sums this equals the sum of
  // the month's INTERNAL and UNRESOLVED amounts, which is exactly what
  // the named causes below account for.
  readonly differenceCents: Cents;
  readonly reconciles: boolean;
  readonly unresolvedCents: Cents;
  readonly unresolvedCount: number;
  readonly unmatchedInternalCents: Cents;
  readonly unmatchedInternalCount: number;
  readonly rowCount: number;
};

export const deriveMonthFigures = (raw: RawMonthFigures): MonthFigures => {
  const income = raw.incomeSignedCents;
  // 0 - x rather than -x: unary negation of 0 yields -0 (the same guard
  // as ledger/domain/reconciliation.ts).
  const spend = 0 - raw.spendSignedCents;
  const netToReserves = 0 - raw.reserveSignedCents;
  const difference = raw.changeInPotCents - (income - spend - netToReserves);
  return {
    incomeCents: cents(income),
    spendCents: cents(spend),
    netToReservesCents: cents(netToReserves),
    changeInPotCents: raw.changeInPotCents,
    differenceCents: cents(difference),
    reconciles: difference === 0,
    unresolvedCents: raw.unresolvedCents,
    unresolvedCount: raw.unresolvedCount,
    unmatchedInternalCents: raw.unmatchedInternalCents,
    unmatchedInternalCount: raw.unmatchedInternalCount,
    rowCount: raw.rowCount,
  };
};

// One reserve movement group: RESERVE rows grouped by the counterparty
// (reserve) account. Stored sums are signed pot-side (negative parks);
// the DISPLAY amount is the parked direction, positive when money moved
// to the reserve, matching the block's "net movement" heading.
export type ReserveMovementGroup = {
  readonly counterpartyIban: string;
  readonly label: string;
  readonly parkedCents: Cents;
  readonly rowCount: number;
};

// A surfaced gap row: an unmatched INTERNAL leg waiting for its other
// side's export, or an UNRESOLVED row no rule can classify. Never folded
// into a total; the reconciliation panel names each one.
export type GapRow = {
  readonly id: string;
  readonly gap: "unmatched-internal" | "unresolved";
  readonly bookingDate: PlainDate;
  readonly text: string;
  readonly accountLabel: string;
  readonly amountCents: Cents;
};
