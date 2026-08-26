// Ports of the overview module. The month overview use case depends on
// these interfaces only; adapters/overview-repository.ts implements them
// over Prisma with raw SQL (the read model is grouped aggregation, which
// is exactly where Prisma is weak, pulse-v1-architecture.md:63), and the
// Clock comes from the platform port so the current month is injectable.

import type { Cents } from "@/platform/money";
import type { PlainDate } from "@/platform/plain-date";
import type { HouseholdContext } from "@/platform/tenancy";
import type { Clock } from "@/platform/clock";
import type {
  CountedGroupRow,
  GapRow,
  RawMonthFigures,
  ReserveMovementGroup,
} from "../domain/month-projection";

// Both bounds inclusive, the same convention as the ledger repository.
export type Period = {
  readonly from: PlainDate;
  readonly to: PlainDate;
};

// One account that put COUNTED rows in the requested period, with how many.
// Never an amount and never a count outside the period (decision D-60): the
// reserves block is a MONTHLY MOVEMENT, and nothing in v1 accumulates across
// months, so a number on this element must not be readable as a balance.
export type AccountRowCount = {
  readonly accountId: string;
  readonly label: string;
  readonly rowCount: number;
};

// ONE HELD ROW. The held read returns ROWS rather than a count (criterion
// 14.15 witness SEVEN).
//
// WHY THE SHAPE IS THIS AND NOT A COUNT, said here rather than left for the
// next reader to reconcile against the plan's own step text. M3-P14 step 8
// describes BOTH new reads as returning "COUNTS PER ACCOUNT and never an
// amount". Criterion 14.15 witness SEVEN, added to the plan afterwards,
// requires the held entry to render each held row's DESCRIPTOR and ITS OWN
// AMOUNT, and requires the money-formatted strings under that entry to
// number exactly "the number of rows the HELD READ returned". The criterion
// is the newer text and it is the acceptance contract, so the held read
// returns rows.
//
// AND THE ALTERNATIVE IS FORBIDDEN BY ANOTHER CRITERION, which is what
// settles this rather than a preference: keeping the held read as a count
// and adding a SEPARATE held-rows read would make a FOURTH test of an absent
// flow in a database query, and criterion 14.14 case FIVE enumerates exactly
// THREE and "fails on a fourth wherever and however it is written". So there
// is one held read, it returns rows, and the per-account row count witness
// ONE renders is the length of that account's rows.
//
// WHAT DECISION D-60 STILL FORBIDS AND THIS DOES NOT DO: no sum of these
// amounts, no per-account held total, nothing accumulated across months. The
// rows are bounded by the requested period by the read's own WHERE.
export type HeldRow = {
  readonly accountId: string;
  readonly label: string;
  // The transaction's own id, so the screen can key each row on its own
  // rendered identity (criterion 14.15 witness THREE).
  readonly id: string;
  readonly bookingDate: PlainDate;
  // The counterparty text the product already projects for a row, the same
  // projection the gap listing uses.
  readonly text: string;
  readonly amountCents: Cents;
};

export type OverviewRepositoryPort = {
  // Query 1 of the read model: income grouped by merchant (income source),
  // with the counterparty text for unresolved grouping.
  readonly listIncomeGroups: (
    context: HouseholdContext,
    period: Period,
  ) => Promise<readonly CountedGroupRow[]>;
  // Query 2: spend grouped by primary tag then merchant, with the cash
  // marker computed in SQL from the ledger's published pattern list.
  readonly listSpendGroups: (
    context: HouseholdContext,
    period: Period,
  ) => Promise<readonly CountedGroupRow[]>;
  // Query 3: reserve movements grouped by (reserve) counterparty account.
  readonly listReserveMovements: (
    context: HouseholdContext,
    period: Period,
  ) => Promise<readonly ReserveMovementGroup[]>;
  // Query 4: the reconciliation figures in one aggregate pass.
  readonly monthFigures: (
    context: HouseholdContext,
    period: Period,
  ) => Promise<RawMonthFigures>;
  // The surfaced gaps behind query 4's counts: each unmatched INTERNAL
  // leg and each UNRESOLVED row, so the panel can NAME the cause instead
  // of only counting it (pulse-v1-architecture.md:209).
  readonly listGapRows: (
    context: HouseholdContext,
    period: Period,
  ) => Promise<readonly GapRow[]>;
  // Queries 5 and 6, the two reads behind the month-accounts element
  // (M3-P14, DR-0030, criterion 14.15): every account that put rows in the
  // period, with whether those rows were COUNTED or HELD. Their ring
  // predicates are complementary, so an account can appear in at most one of
  // them by construction and the element can never show one account twice.
  readonly listCountedAccountRows: (
    context: HouseholdContext,
    period: Period,
  ) => Promise<readonly AccountRowCount[]>;
  // The HELD read returns the rows themselves: criterion 14.15 witness SEVEN
  // renders each held row's descriptor and its own amount under the entry,
  // and the entry's period row count is the length of that account's rows.
  readonly listHeldAccountRows: (
    context: HouseholdContext,
    period: Period,
  ) => Promise<readonly HeldRow[]>;
  // The empty state runs before the first import ever lands; one EXISTS.
  readonly hasAnyTransactions: (context: HouseholdContext) => Promise<boolean>;
};

export type OverviewDependencies = {
  readonly overview: OverviewRepositoryPort;
  readonly clock: Clock;
  // The merchants module's published normalisation, injected so the
  // domain fold stays import-free: unresolved rows group under the SAME
  // key the merchant review screen uses.
  readonly normaliseCounterparty: (text: string) => string;
};
