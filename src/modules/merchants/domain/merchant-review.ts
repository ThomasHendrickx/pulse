// Grouping counted transactions for the review screen, pure. Resolution
// renames and regroups, NEVER reclassifies (hazard H3.2): this function
// reads flows and amounts the ledger engine already derived and only
// decides which group a row displays under, so naming a counterparty can
// move cents between groups but can never move a cent between the income
// and spend totals. The totals are computed here from the same rows the
// groups are, which is what the e2e asserts stays fixed across a naming.

import type { Cents } from "@/platform/money";
import { normaliseCounterparty } from "./normalise-counterparty";

export type CountedRow = {
  readonly id: string;
  readonly flow: "INCOME" | "SPEND";
  readonly amountCents: Cents;
  readonly description: string;
  readonly counterpartyName?: string;
  readonly merchantId?: string;
};

export type MerchantNameLike = {
  readonly id: string;
  readonly name: string;
};

export type ReviewGroup = {
  // Merchant id for resolved groups, normalised counterparty text for
  // unresolved ones: stable within a household either way.
  readonly key: string;
  readonly label: string;
  readonly merchantId?: string;
  // The text the assignment form submits for an unresolved group; absent
  // on resolved groups.
  readonly counterpartyText?: string;
  readonly totalCents: Cents;
  readonly count: number;
};

export type MerchantReview = {
  readonly incomeTotalCents: Cents;
  readonly spendTotalCents: Cents;
  readonly income: readonly ReviewGroup[];
  readonly spend: readonly ReviewGroup[];
  readonly unresolvedCount: number;
};

// The one counterparty-text convention: the named counterparty when the
// export carries one, the description otherwise (card rows). The same
// fallback the ledger's counterpartyKey applies on its own side.
export const counterpartyText = (row: {
  readonly description: string;
  readonly counterpartyName?: string;
}): string => row.counterpartyName ?? row.description;

const byGroupOrder = (a: ReviewGroup, b: ReviewGroup): number => {
  const magnitudeA = Math.abs(a.totalCents);
  const magnitudeB = Math.abs(b.totalCents);
  if (magnitudeA !== magnitudeB) {
    return magnitudeB - magnitudeA;
  }
  if (a.label !== b.label) {
    return a.label < b.label ? -1 : 1;
  }
  return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
};

const groupDirection = (
  rows: readonly CountedRow[],
  merchantNames: ReadonlyMap<string, string>,
): readonly ReviewGroup[] => {
  const groups = new Map<
    string,
    { label: string; merchantId?: string; counterpartyText?: string; total: number; count: number }
  >();
  for (const row of rows) {
    const merchantId = row.merchantId;
    const normalised = normaliseCounterparty(counterpartyText(row));
    const key = merchantId ?? normalised;
    const entry = groups.get(key);
    if (entry !== undefined) {
      entry.total += row.amountCents;
      entry.count += 1;
      continue;
    }
    groups.set(key, {
      label:
        merchantId === undefined
          ? normalised
          : (merchantNames.get(merchantId) ?? normalised),
      ...(merchantId === undefined
        ? { counterpartyText: normalised }
        : { merchantId }),
      total: row.amountCents,
      count: 1,
    });
  }
  return [...groups.entries()]
    .map(([key, entry]) => ({
      key,
      label: entry.label,
      ...(entry.merchantId === undefined ? {} : { merchantId: entry.merchantId }),
      ...(entry.counterpartyText === undefined
        ? {}
        : { counterpartyText: entry.counterpartyText }),
      totalCents: entry.total as Cents,
      count: entry.count,
    }))
    .sort(byGroupOrder);
};

export const buildMerchantReview = (
  rows: readonly CountedRow[],
  merchants: readonly MerchantNameLike[],
): MerchantReview => {
  const merchantNames = new Map(
    merchants.map((merchant) => [merchant.id, merchant.name]),
  );
  const incomeRows = rows.filter((row) => row.flow === "INCOME");
  const spendRows = rows.filter((row) => row.flow === "SPEND");
  const income = groupDirection(incomeRows, merchantNames);
  const spend = groupDirection(spendRows, merchantNames);
  const sum = (list: readonly CountedRow[]): Cents =>
    list.reduce((total, row) => total + row.amountCents, 0) as Cents;
  return {
    incomeTotalCents: sum(incomeRows),
    spendTotalCents: sum(spendRows),
    income,
    spend,
    unresolvedCount:
      income.filter((group) => group.merchantId === undefined).length +
      spend.filter((group) => group.merchantId === undefined).length,
  };
};
