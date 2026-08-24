// The month overview use case: the four grouped queries for the viewed
// month, the same four for the previous month when the viewed month is
// CLOSED, folded and compared. Computed on read, per request, nothing
// materialised and nothing cached (pulse-v1-architecture.md section 8:
// "every complication you skip here is a staleness bug you never write").

import type { HouseholdContext } from "@/platform/tenancy";
import type { Cents } from "@/platform/money";
import { cents } from "@/platform/money";
import {
  brusselsDayOf,
  dayOfMonth,
  daysInMonth,
  isAfter,
  monthBounds,
  monthOfPlainDate,
  parseMonth,
  previousMonth,
  type Month,
} from "../domain/month";
import {
  attachDeltas,
  deriveMonthFigures,
  foldGroups,
  sumGroups,
  type GapRow,
  type MonthFigures,
  type OverviewGroup,
  type ReserveMovementGroup,
} from "../domain/month-projection";
import type { AccountRowCount, OverviewDependencies } from "./ports";

export type MonthSection = {
  readonly groups: readonly OverviewGroup[];
  // Positive display magnitude for the section header.
  readonly totalCents: Cents;
  // Magnitude change against the previous closed month; absent while the
  // viewed month is partial (never compared, pulse-v1-plan.md:206).
  readonly deltaCents?: Cents;
};

export type MonthOverview = {
  readonly month: Month;
  readonly previous: Month;
  // The partial current month: rendered in progress, never compared.
  readonly partial: boolean;
  readonly daysElapsed: number;
  readonly daysInMonth: number;
  readonly compared: boolean;
  readonly canGoNext: boolean;
  readonly hasAnyData: boolean;
  readonly income: MonthSection;
  readonly spend: MonthSection;
  readonly reserves: {
    readonly groups: readonly ReserveMovementGroup[];
    readonly netCents: Cents;
  };
  readonly figures: MonthFigures;
  readonly unmatchedLegs: readonly GapRow[];
  readonly unresolvedRows: readonly GapRow[];
  // Matched legs whose partner books in a neighbouring month (CR-501).
  readonly inTransitLegs: readonly GapRow[];
  // Committed rows interpretation has not stamped yet (CR-502).
  readonly uninterpretedRows: readonly GapRow[];
  // Counted rows without a merchant, for the review pill in the header.
  readonly unresolvedCounterpartyCount: number;
  // EVERY ACCOUNT THAT PUT ROWS IN THIS MONTH, with whether those rows were
  // COUNTED or HELD (M3-P14, DR-0030, criterion 14.15). ONE field carrying
  // both, fed by two reads with complementary ring predicates, so an account
  // appears at most once by construction.
  readonly accountsInPeriod: readonly MonthAccountEntry[];
};

export type MonthAccountEntry = {
  readonly accountId: string;
  readonly label: string;
  // "counted": the rows entered this month's income and spend.
  // "held": the rows are kept and counted in no month (DR-0030).
  readonly state: "counted" | "held";
  readonly rowCount: number;
};

export const getMonthOverview = async (
  context: HouseholdContext,
  deps: OverviewDependencies,
  requestedMonth?: string,
): Promise<MonthOverview> => {
  const today = brusselsDayOf(deps.clock.now());
  const currentMonth = monthOfPlainDate(today);
  const requested = parseMonth(requestedMonth);
  // A future month has no facts and no meaning yet; requests for one fall
  // back to the current month rather than rendering an empty future.
  const month =
    requested === undefined || isAfter(requested, currentMonth)
      ? currentMonth
      : requested;
  const partial = month === currentMonth;
  const previous = previousMonth(month);

  const period = monthBounds(month);
  const [
    incomeRows,
    spendRows,
    reserveGroups,
    rawFigures,
    gapRows,
    hasAnyData,
    countedAccounts,
    heldAccounts,
  ] = await Promise.all([
    deps.overview.listIncomeGroups(context, period),
    deps.overview.listSpendGroups(context, period),
    deps.overview.listReserveMovements(context, period),
    deps.overview.monthFigures(context, period),
    deps.overview.listGapRows(context, period),
    deps.overview.hasAnyTransactions(context),
    deps.overview.listCountedAccountRows(context, period),
    deps.overview.listHeldAccountRows(context, period),
  ]);
  const entry = (
    row: AccountRowCount,
    state: "counted" | "held",
  ): MonthAccountEntry => ({
    accountId: row.accountId,
    label: row.label,
    state,
    rowCount: row.rowCount,
  });
  // Sorted by label so the element reads the same way twice. The two reads
  // carry complementary ring predicates, so this concatenation cannot
  // produce two entries for one account; criterion 14.15 witness ONE
  // asserts that rather than assuming it.
  const accountsInPeriod: readonly MonthAccountEntry[] = [
    ...countedAccounts.map((row) => entry(row, "counted")),
    ...heldAccounts.map((row) => entry(row, "held")),
  ].sort(
    (a, b) =>
      a.label.localeCompare(b.label) || (a.accountId < b.accountId ? -1 : 1),
  );

  const foldOptions = {
    normalise: deps.normaliseCounterparty,
  };
  let incomeGroups = foldGroups(incomeRows, { ...foldOptions, useTags: false });
  let spendGroups = foldGroups(spendRows, { ...foldOptions, useTags: true });
  const figures = deriveMonthFigures(rawFigures);

  // The previous-month half of the read model: the same four queries,
  // fetched ONLY for a closed month. The partial current month is never
  // compared, so its comparison is never even read (hazard H4.1 addressed
  // structurally, not by hiding a computed value).
  let incomeDelta: Cents | undefined;
  let spendDelta: Cents | undefined;
  if (!partial) {
    const previousPeriod = monthBounds(previous);
    const [previousIncomeRows, previousSpendRows, , previousRawFigures] =
      await Promise.all([
        deps.overview.listIncomeGroups(context, previousPeriod),
        deps.overview.listSpendGroups(context, previousPeriod),
        deps.overview.listReserveMovements(context, previousPeriod),
        deps.overview.monthFigures(context, previousPeriod),
      ]);
    const previousIncome = foldGroups(previousIncomeRows, {
      ...foldOptions,
      useTags: false,
    });
    const previousSpend = foldGroups(previousSpendRows, {
      ...foldOptions,
      useTags: true,
    });
    incomeGroups = attachDeltas(incomeGroups, previousIncome);
    spendGroups = attachDeltas(spendGroups, previousSpend);
    const previousFigures = deriveMonthFigures(previousRawFigures);
    incomeDelta = cents(figures.incomeCents - previousFigures.incomeCents);
    spendDelta = cents(figures.spendCents - previousFigures.spendCents);
  }

  const unresolvedCounterpartyCount = [...incomeGroups, ...spendGroups]
    .filter((group) => group.kind === "unresolved")
    .reduce((total, group) => total + group.rowCount, 0);

  return {
    month,
    previous,
    partial,
    daysElapsed: partial ? dayOfMonth(today) : daysInMonth(month),
    daysInMonth: daysInMonth(month),
    compared: !partial,
    canGoNext: !partial,
    hasAnyData,
    income: {
      groups: incomeGroups,
      totalCents: sumGroups(incomeGroups),
      ...(incomeDelta === undefined ? {} : { deltaCents: incomeDelta }),
    },
    spend: {
      groups: spendGroups,
      totalCents: cents(0 - sumGroups(spendGroups)),
      ...(spendDelta === undefined ? {} : { deltaCents: spendDelta }),
    },
    reserves: {
      groups: reserveGroups,
      netCents: cents(
        reserveGroups.reduce((total, group) => total + group.parkedCents, 0),
      ),
    },
    figures,
    unmatchedLegs: gapRows.filter((row) => row.gap === "unmatched-internal"),
    unresolvedRows: gapRows.filter((row) => row.gap === "unresolved"),
    inTransitLegs: gapRows.filter((row) => row.gap === "in-transit"),
    uninterpretedRows: gapRows.filter((row) => row.gap === "uninterpreted"),
    unresolvedCounterpartyCount,
    accountsInPeriod,
  };
};
