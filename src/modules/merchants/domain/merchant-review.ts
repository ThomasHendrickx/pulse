// Grouping counted transactions for the review screen, pure. Resolution
// renames and regroups, NEVER reclassifies (hazard H3.2): this function
// reads flows and amounts the ledger engine already derived and only
// decides which group a row displays under, so naming a counterparty can
// move cents between groups but can never move a cent between the income
// and spend totals. The totals are computed here from the same rows the
// groups are, which is what the e2e asserts stays fixed across a naming.

import type { Cents } from "@/platform/money";
import type { PlainDate } from "@/platform/plain-date";
import {
  counterpartyIdentity,
  identityRemainder,
  isBareIdentityKey,
  type CounterpartyIdentityBasis,
} from "./counterparty-identity";
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
  // M3-P13: the row's own booking date, carried through to the lines behind
  // a group so that two purposes paid to one counterparty read as two dated
  // lines rather than as one opaque total (DR-0027, hazard H13.3).
  readonly bookingDate: PlainDate;
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

// ONE TRANSACTION BEHIND A GROUP (M3-P13). Facts only, exactly as the
// engine stored them: no interpretation is added here and nothing is
// rewritten (CLAUDE.md non-negotiable 5). The description is raw source
// text, so the RENDERING masks it; the mask is never applied here, because
// this value is a fact and because a masked value must never reach a key
// (criterion 13.2, hazard H13.1).
export type ReviewGroupRow = {
  readonly id: string;
  readonly bookingDate: PlainDate;
  readonly amountCents: Cents;
  readonly description: string;
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
  // WHY THIS GROUP CANNOT BE NAMED (fix round two, findings CR2-M3P12-07 and
  // HZ-M3P12-R2-04). Withholding the form was right and leaving the row blank
  // was not: the reader met a list item with an empty label, a row count and
  // an amount, no control and no sentence, counted in the number the screen
  // prints as work they are being asked to do. The screen renders this where
  // the form would have been.
  readonly unnameableReason?: "no-counterparty-text";
  // WHAT JOINED THESE TRANSACTIONS (M3-P13, criterion 13.1). Read straight
  // off M3-P12's identity, never re-derived here: `account` means the rows
  // share a counterparty account, `descriptor` means they share a
  // description. Present on UNRESOLVED groups only, because a resolved
  // group is joined by the household's own naming and says so by carrying
  // the merchant's name.
  readonly basis?: CounterpartyIdentityBasis;
  // THE ACCOUNT AN ACCOUNT-BASIS GROUP IS RECOGNISED BY, UNMASKED, and
  // present ONLY when no row of the group carries a counterparty name
  // (decision D-41). The screen renders it MASKED; this field is the
  // unmasked input to that display rule and must never reach a key, which
  // is the hazard H13.1 that criterion 13.2 pins. A group whose rows carry
  // a name has that name in `label` instead and carries nothing here.
  readonly accountAlias?: string;
  // THE TRANSACTIONS BEHIND THE GROUP, in the order the read returned them.
  // The same read that builds the groups (M3-P13 step 5): no second query,
  // no new server action.
  readonly rows: readonly ReviewGroupRow[];
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
    {
      label: string;
      merchantId?: string;
      counterpartyText?: string;
      unnameableReason?: "no-counterparty-text";
      basis?: CounterpartyIdentityBasis;
      // The counterparty name an account-basis group is labelled by
      // (decision D-41), chosen as the lexicographically SMALLEST non-empty
      // name any of its rows carries. Smallest rather than first for the
      // same reason the descriptor label is: the rows arrive from SQL in no
      // guaranteed order, so first-wins would label one group two ways on
      // two screens.
      counterpartyName?: string;
      accountAlias?: string;
      rows: ReviewGroupRow[];
      total: number;
      count: number;
    }
  >();
  for (const row of rows) {
    const merchantId = row.merchantId;
    const identity = counterpartyIdentity(row);
    // THE UNRESOLVED LABEL IS UNCHANGED BY THIS PHASE FOR A DESCRIPTOR
    // GROUP: it is still the normalised counterparty text. What M3-P13 adds
    // is the ACCOUNT-BASIS label decision D-41 fixes, below: the carried
    // counterparty name where a row has one, and otherwise the account,
    // which travels UNMASKED in accountAlias and is masked by the screen.
    // A bare account number is never put in `label`, because `label` is
    // what the rendering masks with the CARD mask and an account is not a
    // card number.
    const unresolvedLabel = normaliseCounterparty(counterpartyText(row));
    const key = merchantId ?? identity.key;
    const line: ReviewGroupRow = {
      id: row.id,
      bookingDate: row.bookingDate,
      amountCents: row.amountCents,
      description: row.description,
    };
    const carriedName = row.counterpartyName?.trim();
    const entry = groups.get(key);
    if (entry !== undefined) {
      entry.total += row.amountCents;
      entry.count += 1;
      entry.rows.push(line);
      if (merchantId === undefined && unresolvedLabel < entry.label) {
        entry.label = unresolvedLabel;
      }
      if (
        carriedName !== undefined &&
        carriedName !== "" &&
        (entry.counterpartyName === undefined ||
          carriedName < entry.counterpartyName)
      ) {
        entry.counterpartyName = carriedName;
      }
      continue;
    }
    groups.set(key, {
      label:
        merchantId === undefined
          ? unresolvedLabel
          : (merchantNames.get(merchantId) ?? unresolvedLabel),
      // THE NAMING FORM IS WITHHELD FROM A BARE-NAMESPACE GROUP (fix round,
      // finding HZ-M3P12-01). `counterpartyText` is what the form submits,
      // and the screen renders no form for a group that has none. A group
      // keyed on a bare namespace holds rows that carry NO counterparty text
      // at all, so there is nothing to recognise the next such row by;
      // offering a naming there would offer to put every one of them under
      // one merchant. The group is still SHOWN and its money is still
      // counted, which is what it did before this phase; what it cannot do
      // is be named, and the write boundary refuses the subject as well, so
      // the two guards agree.
      ...(merchantId === undefined
        ? isBareIdentityKey(identity.key)
          ? { unnameableReason: "no-counterparty-text" as const }
          : { counterpartyText: identity.key }
        : { merchantId }),
      // The basis is M3-P12's, read off the identity and never re-derived
      // (M3-P13 grounding: this phase adds no derivation of its own). It is
      // recorded for UNRESOLVED groups only: a resolved group is joined by
      // the household's own naming.
      ...(merchantId === undefined ? { basis: identity.basis } : {}),
      ...(carriedName === undefined || carriedName === ""
        ? {}
        : { counterpartyName: carriedName }),
      rows: [line],
      total: row.amountCents,
      count: 1,
    });
  }
  return [...groups.entries()]
    .map(([key, entry]) => {
      // DECISION D-41, APPLIED AT ONE PLACE. An account-basis group that is
      // still unresolved is labelled by the counterparty name where any of
      // its rows carries one, and otherwise it hands the screen the account
      // to render in masked display form. The account comes off the KEY
      // rather than off a row, so the label can never disagree with what
      // decided membership.
      const remainder =
        entry.merchantId === undefined && entry.basis === "account"
          ? identityRemainder(key)
          : undefined;
      const named =
        remainder === undefined ? undefined : entry.counterpartyName;
      const alias =
        remainder === undefined || remainder === "" || named !== undefined
          ? undefined
          : remainder;
      return {
        key,
        label: named ?? entry.label,
        ...(entry.merchantId === undefined ? {} : { merchantId: entry.merchantId }),
        ...(entry.counterpartyText === undefined
          ? {}
          : { counterpartyText: entry.counterpartyText }),
        ...(entry.unnameableReason === undefined
          ? {}
          : { unnameableReason: entry.unnameableReason }),
        ...(entry.basis === undefined ? {} : { basis: entry.basis }),
        ...(alias === undefined ? {} : { accountAlias: alias }),
        rows: entry.rows,
        totalCents: entry.total as Cents,
        count: entry.count,
      };
    })
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
