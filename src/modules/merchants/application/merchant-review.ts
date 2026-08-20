// The review read: counted transactions grouped by merchant (or by
// normalised counterparty text while unresolved), per direction, with the
// direction totals the grouping can never change (hazard H3.2). Pure
// grouping lives in the domain; this use case only fetches and maps.

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
