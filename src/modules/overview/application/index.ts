// The overview module's PUBLISHED interface (pulse-domain section 9), and
// its composition root: the month overview use case bound to the Prisma
// raw-SQL repository, the app clock and the merchants module's published
// normalisation. Tests exercise the use case against in-memory fakes of
// the same ports, never this binding.

import type { HouseholdContext } from "@/platform/tenancy";
import { appClock } from "@/platform/clock";
import {
  counterpartyIdentity,
  isBareIdentityKey,
  normaliseCounterparty,
} from "@/modules/merchants/application";
import * as repository from "../adapters/overview-repository";
import {
  getMonthOverview as getMonthOverviewUseCase,
  type MonthOverview,
} from "./month-overview";
import type { OverviewDependencies } from "./ports";

export type { MonthOverview, MonthSection } from "./month-overview";
export type { OverviewDependencies, OverviewRepositoryPort, Period } from "./ports";
export type {
  CountedGroupRow,
  GapRow,
  MonthFigures,
  OverviewGroup,
  OverviewGroupKind,
  RawMonthFigures,
  ReserveMovementGroup,
} from "../domain/month-projection";
export type { Month } from "../domain/month";
export {
  daysInMonth,
  monthBounds,
  nextMonth,
  parseMonth,
  previousMonth,
} from "../domain/month";
export {
  attachDeltas,
  deriveMonthFigures,
  foldGroups,
  sumGroups,
} from "../domain/month-projection";
export { getMonthOverview as getMonthOverviewWith } from "./month-overview";

const liveDependencies: OverviewDependencies = {
  overview: {
    listIncomeGroups: repository.listIncomeGroups,
    listSpendGroups: repository.listSpendGroups,
    listReserveMovements: repository.listReserveMovements,
    monthFigures: repository.monthFigures,
    listGapRows: repository.listGapRows,
    hasAnyTransactions: repository.hasAnyTransactions,
  },
  // Lazy on purpose: platform/config's build-safe contract forbids env
  // reads at module load (a Vercel build imports every route module), and
  // appClock reads the PULSE_FIXED_NOW override. Resolving per call keeps
  // the read at request time.
  clock: { now: () => appClock().now() },
  counterpartyIdentity,
  isBareIdentityKey,
  normaliseCounterparty,
};

export const getMonthOverview = (
  context: HouseholdContext,
  requestedMonth?: string,
): Promise<MonthOverview> =>
  getMonthOverviewUseCase(context, liveDependencies, requestedMonth);
