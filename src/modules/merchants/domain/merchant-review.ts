// Grouping counted transactions for the review screen, pure. Resolution
// renames and regroups, NEVER reclassifies (hazard H3.2): this function
// reads flows and amounts the ledger engine already derived and only
// decides which group a row displays under, so naming a counterparty can
// move cents between groups but can never move a cent between the income
// and spend totals. The totals are computed here from the same rows the
// groups are, which is what the e2e asserts stays fixed across a naming.

import type { Cents } from "@/platform/money";
import { counterpartyIdentity } from "./counterparty-identity";
import {
  counterpartyText,
  normaliseCounterparty,
} from "./normalise-counterparty";

// The counterparty-source rule has ONE definition (decision D-11), in
// normalise-counterparty.ts beside the normaliser that consumes it. This
// module used to carry its own copy of the expression; re-exporting keeps
// the merchants module's published interface unchanged for every existing
// importer while leaving exactly one place where the rule is written.
export { counterpartyText };

export type CountedRow = {
  readonly id: string;
  readonly flow: "INCOME" | "SPEND";
  readonly amountCents: Cents;
  readonly description: string;
  readonly counterpartyName?: string;
  // The counterparty ACCOUNT as the importer stored it, unvalidated. M3-P12:
  // the review keys on counterpartyIdentity, whose account branch reads this
  // field, so the repository read must select it. A row that carries none, or
  // carries one the trust gate refuses, keeps exactly the descriptor key it
  // had before this phase.
  readonly counterpartyAccount?: string;
  readonly merchantId?: string;
};

export type MerchantNameLike = {
  readonly id: string;
  readonly name: string;
};

export type ReviewGroup = {
  // Merchant id for resolved groups, the namespaced counterparty IDENTITY
  // key for unresolved ones (M3-P12): stable within a household either way.
  readonly key: string;
  readonly label: string;
  readonly merchantId?: string;
  // What the assignment form submits for an unresolved group: the identity
  // key, which is what assignMerchant stores as the rule subject. Absent on
  // resolved groups. NAME KEPT rather than renamed to `identityKey`, because
  // this field is the wire contract of the shipped form and the server action
  // reads it by this name; the comment is what says it is no longer a text.
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
    const identity = counterpartyIdentity(row);
    // THE UNRESOLVED LABEL IS UNCHANGED BY THIS PHASE: it is still the
    // normalised counterparty text. What changed is that an account-basis
    // group now holds SEVERAL such texts, so "the label" needs a rule; the
    // rule is the lexicographically smallest, which is deterministic
    // whatever order the rows arrive in and is therefore the same on this
    // screen and on the month view, whose rows come out of SQL in no
    // guaranteed order. Naming the group properly (the carried counterparty
    // name, or the masked account) is decision D-41 and belongs to M3-P13
    // with the basis and the row count; putting a bare account number here
    // would be that phase's work done badly and early.
    const unresolvedLabel = normaliseCounterparty(counterpartyText(row));
    const key = merchantId ?? identity.key;
    const entry = groups.get(key);
    if (entry !== undefined) {
      entry.total += row.amountCents;
      entry.count += 1;
      if (merchantId === undefined && unresolvedLabel < entry.label) {
        entry.label = unresolvedLabel;
      }
      continue;
    }
    groups.set(key, {
      label:
        merchantId === undefined
          ? unresolvedLabel
          : (merchantNames.get(merchantId) ?? unresolvedLabel),
      ...(merchantId === undefined
        ? { counterpartyText: identity.key }
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
