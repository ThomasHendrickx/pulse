// The review read: counted transactions grouped by merchant (or by
// normalised counterparty text while unresolved), per direction, with the
// direction totals the grouping can never change (hazard H3.2). Pure
// grouping lives in the domain; this use case only fetches and maps.
//
// THIS READ IS HOUSEHOLD-WIDE AND CARRIES NO PERIOD, AND ANY COPY WRITTEN
// AGAINST IT MUST NOT NAME ONE (M3-P13 fix round, finding HZ-M3P13-03).
// listCountedTransactions filters on householdId and flow and has no date
// bound; this function takes a HouseholdContext and nothing else; the route
// at src/app/(app)/merchants/page.tsx reads only the status parameter. So
// every count this read produces, group.count included, spans every month
// the household has ever imported.
//
// M3-P13 shipped a reach sentence saying "of this month" against it. That
// was true only of a household with one imported month, and it understated
// what the reader was about to do, because assignMerchant writes a rule and
// recompute carries it to every past matching transaction
// (src/modules/merchants/application/assign-merchant.ts). The copy now says
// "already imported" and test/domain/identity-on-review.test.ts asserts that
// no period word can come back into it in any of the three languages.

import type { HouseholdContext } from "@/platform/tenancy";
import {
  buildMerchantReview,
  type MerchantReview,
} from "../domain/merchant-review";
import type { MerchantRepositoryPort } from "./ports";

export type MerchantReviewDependencies = {
  readonly merchants: Pick<
    MerchantRepositoryPort,
    "listCountedTransactions" | "listMerchants"
  >;
};

export const listMerchantReview = async (
  context: HouseholdContext,
  deps: MerchantReviewDependencies,
): Promise<MerchantReview> => {
  const [rows, merchants] = await Promise.all([
    deps.merchants.listCountedTransactions(context),
    deps.merchants.listMerchants(context),
  ]);
  return buildMerchantReview(rows, merchants);
};
