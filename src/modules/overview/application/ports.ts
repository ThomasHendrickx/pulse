// Ports of the overview module. The month overview use case depends on
// these interfaces only; adapters/overview-repository.ts implements them
// over Prisma with raw SQL (the read model is grouped aggregation, which
// is exactly where Prisma is weak, pulse-v1-architecture.md:63), and the
// Clock comes from the platform port so the current month is injectable.

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
