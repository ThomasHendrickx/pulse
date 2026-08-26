// The month overview use case: the four grouped queries for the viewed
// month, the same four for the previous month when the viewed month is
// CLOSED, folded and compared. Computed on read, per request, nothing
// materialised and nothing cached (pulse-v1-architecture.md section 8:
// "every complication you skip here is a staleness bug you never write").

import type { HouseholdContext } from "@/platform/tenancy";
import type { Cents } from "@/platform/money";
import { cents } from "@/platform/money";
import type { PlainDate } from "@/platform/plain-date";
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
  // THE HELD ROWS THEMSELVES, empty on a counted entry (criterion 14.15
  // witness SEVEN). A reserve statement's interest credit, its movement to
  // another of the household's own reserve accounts and its payment made
  // straight out of savings have NO counterpart row on any pot account, so
  // registering the account could never have made them visible and only
  // rendering them can. rowCount is their number and is never computed
  // separately, so the count on the entry and the rows under it cannot
  // disagree.
  //
  // NO SUM OF THESE IS CARRIED ANYWHERE, which is decision D-60.
  readonly rows: readonly MonthAccountRow[];
};

export type MonthAccountRow = {
  readonly id: string;
  readonly bookingDate: PlainDate;
  readonly text: string;
  readonly amountCents: Cents;
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
  const countedEntry = (row: AccountRowCount): MonthAccountEntry => ({
    accountId: row.accountId,
    label: row.label,
    state: "counted",
    rowCount: row.rowCount,
    rows: [],
  });
  // The held read returns ROWS; the entries are those rows grouped by their
  // account, and each entry's row count is the length of its own group. One
  // read, one number, so the count the entry renders and the rows rendered
  // under it are the same fact (criterion 14.15 witness SEVEN).
  const heldEntries: MonthAccountEntry[] = [];
  const heldByAccount = new Map<string, MonthAccountRow[]>();
  for (const row of heldAccounts) {
    let group = heldByAccount.get(row.accountId);
    if (group === undefined) {
      group = [];
      heldByAccount.set(row.accountId, group);
      heldEntries.push({
        accountId: row.accountId,
        label: row.label,
        state: "held",
        rowCount: 0,
        rows: group,
      });
    }
    group.push({
      id: row.id,
      bookingDate: row.bookingDate,
      text: row.text,
      amountCents: row.amountCents,
    });
  }
  // Sorted by label so the element reads the same way twice. The two reads
  // carry complementary ring predicates, so this concatenation cannot
  // produce two entries for one account; criterion 14.15 witness ONE
  // asserts that rather than assuming it.
  const accountsInPeriod: readonly MonthAccountEntry[] = [
    ...countedAccounts.map(countedEntry),
    ...heldEntries.map((held) => ({ ...held, rowCount: held.rows.length })),
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
