// The month projection's pure half: folding the repository's grouped rows
// into display groups, attaching previous-month deltas, and deriving the
// reconciliation figures from raw sums. Computed on read, per request; no
// materialisation and no cache exists to go stale
// (pulse-v1-architecture.md section 8).

import type { Cents } from "@/platform/money";
import { cents } from "@/platform/money";
import type { PlainDate } from "@/platform/plain-date";

// One row of the repository's grouped counted query: already aggregated
// per (merchant, primary tag, counterparty text, cash marker) by SQL; the
// fold below only merges these into display groups.
export type CountedGroupRow = {
  readonly merchantId: string | null;
  readonly merchantName: string | null;
  readonly primaryTag: string | null;
  readonly counterpartyText: string;
  // M3-P12: the counterparty ACCOUNT the read now returns beside the text,
  // so this fold can key on the same counterparty IDENTITY the merchant
  // review keys on. Null where the row carries none.
  readonly counterpartyAccount: string | null;
  readonly isCash: boolean;
  readonly totalCents: Cents;
  readonly rowCount: number;
};

// The counterparty identity as this fold consumes it. STRUCTURAL on purpose:
// the derivation lives in the merchants domain and is injected by the
// application layer, exactly as the normaliser it replaces was, so the
// overview module still imports nothing from merchants.
export type CountedGroupIdentity = (input: {
  readonly description: string;
  readonly counterpartyAccount?: string;
}) => { readonly key: string; readonly basis: "account" | "descriptor" };

// STRUCTURAL, like the identity beside it: the predicate lives in the
// merchants domain and is injected by the application layer, so the overview
// module still imports nothing from merchants.
export type CountedGroupBareKey = (key: string) => boolean;

export type OverviewGroupKind = "tag" | "merchant" | "cash" | "unresolved";

// WHETHER AN UNRESOLVED GROUP CAN BE NAMED AT ALL (fix round three, finding
// CR3-M3P12-06, THE FIFTH CONSUMER). The derivation's floor says a bare
// namespace is not an identity, and round two enforced that at the matcher,
// the write boundary and the merchant review. The month view was the one
// place that took an identity and applied no guard: two rows carrying no
// counterparty information at all landed in ONE group whose LABEL is the
// empty string, with their money summed and a row count beside it, counted
// into the unresolved pill as work the reader is being asked to do.
//
// THE MONEY STAYS IN THE MONTH, so the group is not dropped and the rows are
// not refused the way the matcher refuses them: a total that silently loses
// rows would be a worse answer than a blank one. What changes is that the
// group says why it cannot be named, and the UI renders that instead of an
// empty label.
export type OverviewUnnameableReason = "no-counterparty-text";

export type OverviewGroup = {
  readonly key: string;
  readonly kind: OverviewGroupKind;
  // Display label. Empty for the cash group: its name is translated copy
  // ("cash" is a destination the UI names in the viewer's language), and
  // an English label baked here could not be.
  readonly label: string;
  // Present only on an unresolved group the reader cannot name (fix round
  // three, finding CR3-M3P12-06). The UI renders the reason where a name
  // would have been.
  readonly unnameableReason?: OverviewUnnameableReason;
  // Signed as stored: spend groups are negative, income groups positive.
  readonly totalCents: Cents;
  readonly rowCount: number;
  // Magnitude change against the previous closed month: |current| minus
  // |previous|. Present only when the viewed month is closed (the partial
  // current month is NEVER compared, pulse-v1-plan.md:206).
  readonly deltaCents?: Cents;
};

// Grouping order for spend, deliberate (M1P4-C7 resolved here): the cash
// marker takes PRECEDENCE over any merchant assignment, so a named cash
// row still lands under the "cash" destination; then the merchant's
// primary tag; then the merchant alone; unresolved rows group under their
// normalised counterparty text exactly like the merchant review screen,
// so both screens name an unknown the same way.
export const foldGroups = (
  rows: readonly CountedGroupRow[],
  options: {
    readonly useTags: boolean;
    readonly normalise: (text: string) => string;
    readonly identity: CountedGroupIdentity;
    readonly isBareKey: CountedGroupBareKey;
  },
): readonly OverviewGroup[] => {
  const groups = new Map<
    string,
    {
      kind: OverviewGroupKind;
      label: string;
      unnameableReason?: OverviewUnnameableReason;
      total: number;
      rowCount: number;
    }
  >();
  for (const row of rows) {
    let key: string;
    let kind: OverviewGroupKind;
    let label: string;
    let unnameableReason: OverviewUnnameableReason | undefined;
    if (row.isCash) {
      key = "cash";
      kind = "cash";
      label = "";
    } else if (
      options.useTags &&
      row.merchantId !== null &&
      row.primaryTag !== null
    ) {
      key = `tag:${row.primaryTag}`;
      kind = "tag";
      label = row.primaryTag;
    } else if (row.merchantId !== null) {
      key = `merchant:${row.merchantId}`;
      kind = "merchant";
      label = row.merchantName ?? "";
    } else {
      // The unresolved key is the counterparty IDENTITY, still under this
      // fold's own `text:` prefix so the overview's four key spaces stay
      // disjoint. The identity key carries its own namespace inside it, so
      // an account group and a descriptor group can never collide.
      const normalisedText = options.normalise(row.counterpartyText);
      const identity = options.identity({
        description: row.counterpartyText,
        ...(row.counterpartyAccount === null
          ? {}
          : { counterpartyAccount: row.counterpartyAccount }),
      });
      key = `text:${identity.key}`;
      kind = "unresolved";
      unnameableReason = options.isBareKey(identity.key)
        ? "no-counterparty-text"
        : undefined;
      // THE LABEL IS UNCHANGED BY M3-P12: still the normalised counterparty
      // text. An account-basis group now holds several of them, and the one
      // shown is the lexicographically smallest, which is the same rule the
      // merchant review builder applies, so the two screens agree without
      // depending on the order rows leave SQL in. Naming the group properly
      // is decision D-41 and belongs to M3-P13.
      label = normalisedText;
    }
    const existing = groups.get(key);
    if (existing === undefined) {
      groups.set(key, {
        kind,
        label,
        ...(unnameableReason === undefined ? {} : { unnameableReason }),
        total: row.totalCents,
        rowCount: row.rowCount,
      });
    } else {
      existing.total += row.totalCents;
      existing.rowCount += row.rowCount;
      if (kind === "unresolved" && label < existing.label) {
        existing.label = label;
      }
    }
  }
  return [...groups.entries()]
    .map(([key, entry]) => ({
      key,
      kind: entry.kind,
      label: entry.label,
      ...(entry.unnameableReason === undefined
        ? {}
        : { unnameableReason: entry.unnameableReason }),
      totalCents: cents(entry.total),
      rowCount: entry.rowCount,
    }))
    .sort(
      (a, b) =>
        Math.abs(b.totalCents) - Math.abs(a.totalCents) ||
        a.label.localeCompare(b.label) ||
        (a.key < b.key ? -1 : 1),
    );
};

// Deltas by group key against the previous CLOSED month: magnitude change,
// so "spent 8,73 less at this merchant" is negative whichever sign the
// stored totals carry. Groups present only in the previous month are not
// resurrected as zero rows; the section totals carry the full difference.
export const attachDeltas = (
  current: readonly OverviewGroup[],
  previous: readonly OverviewGroup[],
): readonly OverviewGroup[] => {
  const previousByKey = new Map(previous.map((group) => [group.key, group]));
  return current.map((group) => {
    const before = previousByKey.get(group.key);
    return {
      ...group,
      deltaCents: cents(
        Math.abs(group.totalCents) - Math.abs(before?.totalCents ?? 0),
      ),
    };
  });
};

export const sumGroups = (groups: readonly OverviewGroup[]): Cents =>
  cents(groups.reduce((total, group) => total + group.totalCents, 0));

// Raw signed sums straight from SQL. The named sums, changeInPot and
// rowCount cover interpreted rows; uninterpretedCount counts committed
// rows interpretation has not stamped yet (flow NULL), which the panel
// must surface rather than let vanish (fix round 1, finding CR-502).
export type RawMonthFigures = {
  readonly incomeSignedCents: Cents;
  readonly spendSignedCents: Cents;
  readonly reserveSignedCents: Cents;
  readonly changeInPotCents: Cents;
  readonly unresolvedCents: Cents;
  readonly unresolvedCount: number;
  readonly unmatchedInternalCents: Cents;
  readonly unmatchedInternalCount: number;
  // Matched INTERNAL legs whose partner books outside the period: money
  // in transit across the month boundary. The count covers only such
  // straddling legs; the cents equal the net of ALL matched INTERNAL
  // legs in the period, because a pair fully inside contributes zero.
  readonly inTransitCents: Cents;
  readonly inTransitCount: number;
  readonly uninterpretedCount: number;
  readonly rowCount: number;
};

export type MonthFigures = {
  readonly incomeCents: Cents;
  // Positive magnitudes for display; the signs live in the identity.
  readonly spendCents: Cents;
  readonly netToReservesCents: Cents;
  readonly changeInPotCents: Cents;
  // changeInPot - (income - spend - netToReserves). By construction of
  // the per-month sums this equals the sum of the month's INTERNAL and
  // UNRESOLVED amounts, and the three cause sums below partition it
  // EXACTLY: difference = unresolvedCents + unmatchedInternalCents +
  // inTransitCents. CORRECTED CLAIM (R-087, fix round 1 finding
  // CR-501): this comment used to end "which is exactly what the named
  // causes below account for" while the named causes covered only
  // unmatched and unresolved rows; matched legs of a pair straddling
  // the month boundary sat in the sum with NO named cause, witnessed by
  // the review's probe P-A (a settlement pair over a month end alarming
  // with 850,00 and zero cause blocks). The in-transit cause closes the
  // partition, and the sentence above is true again.
  readonly differenceCents: Cents;
  // The verdict. Zero difference is NECESSARY, not sufficient: the
  // books close only when there is also no unmatched leg, no unresolved
  // row, no in-transit leg and no uninterpreted row, so cancelling gaps
  // can never flip the verdict and "Books close" can never render above
  // a listed gap (fix round 1, findings CR-501 and CR-502).
  readonly reconciles: boolean;
  readonly unresolvedCents: Cents;
  readonly unresolvedCount: number;
  readonly unmatchedInternalCents: Cents;
  readonly unmatchedInternalCount: number;
  readonly inTransitCents: Cents;
  readonly inTransitCount: number;
  readonly uninterpretedCount: number;
  readonly rowCount: number;
};

export const deriveMonthFigures = (raw: RawMonthFigures): MonthFigures => {
  const income = raw.incomeSignedCents;
  // 0 - x rather than -x: unary negation of 0 yields -0 (the same guard
  // as ledger/domain/reconciliation.ts).
  const spend = 0 - raw.spendSignedCents;
  const netToReserves = 0 - raw.reserveSignedCents;
  const difference = raw.changeInPotCents - (income - spend - netToReserves);
  return {
    incomeCents: cents(income),
    spendCents: cents(spend),
    netToReservesCents: cents(netToReserves),
    changeInPotCents: raw.changeInPotCents,
    differenceCents: cents(difference),
    reconciles:
      difference === 0 &&
      raw.unmatchedInternalCount === 0 &&
      raw.unresolvedCount === 0 &&
      raw.inTransitCount === 0 &&
      raw.uninterpretedCount === 0,
    unresolvedCents: raw.unresolvedCents,
    unresolvedCount: raw.unresolvedCount,
    unmatchedInternalCents: raw.unmatchedInternalCents,
    unmatchedInternalCount: raw.unmatchedInternalCount,
    inTransitCents: raw.inTransitCents,
    inTransitCount: raw.inTransitCount,
    uninterpretedCount: raw.uninterpretedCount,
    rowCount: raw.rowCount,
  };
};

// One reserve movement group: RESERVE rows grouped by the counterparty
// (reserve) account. Stored sums are signed pot-side (negative parks);
// the DISPLAY amount is the parked direction, positive when money moved
// to the reserve, matching the block's "net movement" heading.
export type ReserveMovementGroup = {
  readonly counterpartyIban: string;
  readonly label: string;
  readonly parkedCents: Cents;
  readonly rowCount: number;
};

// A surfaced gap row, one of four kinds (fix round 1 grew this from
// two): an unmatched INTERNAL leg waiting for its other side's export,
// an UNRESOLVED row no rule can classify, a matched leg whose partner
// books in a neighbouring month (in transit), or a committed row whose
// interpretation has not run (uninterpreted). Never folded into a
// total; the reconciliation panel names each one.
export type GapRow = {
  readonly id: string;
  readonly gap:
    | "unmatched-internal"
    | "unresolved"
    | "in-transit"
    | "uninterpreted";
  readonly bookingDate: PlainDate;
  readonly text: string;
  readonly accountLabel: string;
  readonly amountCents: Cents;
};
