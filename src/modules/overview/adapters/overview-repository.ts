// Prisma repository for the overview module: the month read model as raw
// SQL, deliberately (pulse-v1-architecture.md:63: Prisma is weak at
// set-based aggregation, so the overview aggregations use raw SQL inside
// the repository). Every query takes the household context explicitly and
// filters on householdId (CLAUDE.md non-negotiable 6).
//
// READ ONLY: this repository writes nothing. It reads fact columns, the
// interpretation columns (flow, merchantId), the transfer_links table and
// the declaration tables (accounts, merchants, merchant_tags, tags).

import { Prisma } from "@prisma/client";
import { prisma } from "@/platform/db/client";
import { cents } from "@/platform/money";
import {
  plainDateFromDbDate,
  plainDateToDbDate,
} from "@/platform/plain-date";
import type { HouseholdContext } from "@/platform/tenancy";
import { CASH_WITHDRAWAL_PATTERNS } from "@/modules/ledger/application";
import type {
  CountedGroupRow,
  GapRow,
  RawMonthFigures,
  ReserveMovementGroup,
} from "../domain/month-projection";
import type { AccountRowCount, Period } from "../application/ports";

// The cash marker for SQL, derived from the ledger's published pattern
// list so there is ONE list (see the sibling note at the patterns'
// definition: every pattern stays valid Postgres ARE syntax, and the case
// insensitivity lives in `~*` here as in the `i` flag there).
const CASH_SQL_PATTERN = CASH_WITHDRAWAL_PATTERNS.map(
  (pattern) => `(${pattern.source})`,
).join("|");

// A transaction is a matched internal leg when a transfer link carries it
// with BOTH sides present (a pot-to-pot pair or a settled card debit with
// its mirror row). An INTERNAL row without such a link is an unmatched
// leg: excluded from both sides and surfaced, never dropped.
// THE MERCHANT-SOURCE RULE, IN SQL, WRITTEN ONCE (M3-P6 fix round 1,
// findings HZ-M3P6-05 and CR-M3P6-02). Which TEXT a transaction resolves
// under is one decision, decision D-11: the named counterparty when the
// export carries one, the description otherwise. The TypeScript definition
// lives at src/modules/merchants/domain/normalise-counterparty.ts and is
// pinned by an executable grep (criterion 6.10), but that grep is a
// TypeScript expression and is structurally blind to SQL, and this file is
// the copy the MONTH VIEW's grouping actually reads. It used to be written
// out twice in this file, in the grouped counted read and in the gap read.
//
// Two guards now hold it: this single fragment, so the file carries ONE
// copy, and a second pin in test/domain/merchant-review.test.ts that reads
// this file and asserts the SQL form is still here and still written once.
// If decision D-11 ever changes, this fragment changes with it.
// MODULE-LOCAL, not exported: this file is held by the tenancy gate, which
// fails closed on any repository export that does not take a household
// context (test/schema/tenancy.test.ts). The SQL pin reads this file's TEXT
// rather than importing the symbol, so nothing needs to be exported.
const COUNTERPARTY_TEXT_SQL = Prisma.sql`COALESCE(t."counterpartyName", t."description")`;

// THE RING PREDICATE, WRITTEN ONCE (M3-P14 decision D-56, M3-P15 step 5).
// Every read in this file that can reach a transaction row carries it, and
// they all carry the SAME one, because the cause block is gated on a COUNT
// while the rows under it come from a LISTING and the two disagreeing is how
// a household is shown a green verdict over money the repository is still
// handing the screen (criterion 14.14 case FOUR).
//
// SCOPING IS BY THE ACCOUNT'S RING AND NEVER BY DROPPING A NULL-FLOW
// CONDITION. A null flow on a POT account is a row ingest committed and
// interpretation never reached: it must go on holding the verdict open and
// go on being listed, which is finding CR-502 HELD rather than undone (see
// the note at monthFigures below). A null flow on an account outside the pot
// is the HELD state DR-0030 defines, and it is neither counted nor listed as
// a gap; the held read below is what reports it, and it carries the INVERSE
// of this predicate.
const POT_ROW = Prisma.sql`a."role" = 'POT'::"AccountRole"`;
const NON_POT_ROW = Prisma.sql`a."role" <> 'POT'::"AccountRole"`;
const ACCOUNT_JOIN = Prisma.sql`JOIN "accounts" a
      ON a."id" = t."accountId" AND a."householdId" = t."householdId"`;

// THE CANONICAL ACCOUNT-NUMBER FORM, IN SQL. The TypeScript definition is
// src/platform/account-number.ts and it is the authority; this is the copy
// the reserves join and its GROUPING actually read, and it is written ONCE
// here for the same reason COUNTERPARTY_TEXT_SQL above is.
//
// IT IS NOT A TRANSLATION OF THE WHOLE FUNCTION and the difference is
// deliberate: the TypeScript form is SHAPE-GATED and returns a string that
// is not an account number unchanged, because it is applied to a column that
// usually holds a free-text descriptor. Here the surrounding query already
// restricts to RESERVE rows with a non-null counterparty account, so every
// value reaching this expression is an account number and the gate would
// decide nothing.
//
// THE GROUPING USES IT TOO, not only the join, and that is the half that is
// easy to miss: the stored column really does hold two surface forms for one
// account, so a normalised join with a raw GROUP BY shows the household one
// savings account twice, under the right name both times, with the money
// split (criterion 14.2, seventh assertion).
const CANONICAL_COUNTERPARTY_SQL = Prisma.sql`upper(replace(replace(t."counterpartyIban", ' ', ''), '-', ''))`;

const MATCHED_LINK_EXISTS = Prisma.sql`EXISTS (
  SELECT 1 FROM "transfer_links" l
  WHERE l."householdId" = t."householdId"
    AND (
      (l."outgoingTransactionId" = t."id" AND l."incomingTransactionId" IS NOT NULL)
      OR l."incomingTransactionId" = t."id"
    )
)`;

// A MATCHED leg whose partner books OUTSIDE the viewed period: money in
// transit across the month boundary (fix round 1, finding CR-501). Both
// sides are matched and correct, but only one of them is inside the
// month, so the leg's amount sits in the month's difference and must be
// NAMED there, never left as a bare alarm. The partner is resolved
// through the link (for a settlement debit with no imported mirror the
// CASE yields NULL and the join drops the row: that leg is unmatched,
// not in transit). Legs of a pair fully inside the period never match
// this predicate, so the sum over in-transit legs equals the sum over
// ALL matched INTERNAL legs in the period, which is what closes the
// difference identity exactly.
const inTransitExists = (period: Period): Prisma.Sql => Prisma.sql`EXISTS (
  SELECT 1 FROM "transfer_links" l
  JOIN "transactions" p
    ON p."householdId" = t."householdId"
   AND p."id" = CASE
    WHEN l."outgoingTransactionId" = t."id" THEN l."incomingTransactionId"
    ELSE l."outgoingTransactionId" END
  WHERE l."householdId" = t."householdId"
    AND (l."outgoingTransactionId" = t."id" OR l."incomingTransactionId" = t."id")
    AND (
      p."bookingDate" < ${plainDateToDbDate(period.from)}
      OR p."bookingDate" > ${plainDateToDbDate(period.to)}
    )
)`;

const countedGroups = async (
  context: HouseholdContext,
  period: Period,
  flow: "INCOME" | "SPEND",
): Promise<readonly CountedGroupRow[]> => {
  const rows = await prisma.$queryRaw<
    readonly {
      merchantId: string | null;
      merchantName: string | null;
      primaryTag: string | null;
      counterpartyText: string;
      isCash: boolean;
      totalCents: bigint;
      rowCount: bigint;
    }[]
  >`
    SELECT
      t."merchantId"                                        AS "merchantId",
      m."name"                                              AS "merchantName",
      pt."name"                                             AS "primaryTag",
      ${COUNTERPARTY_TEXT_SQL}                              AS "counterpartyText",
      (t."description" ~* ${CASH_SQL_PATTERN})              AS "isCash",
      SUM(t."amountCents")::bigint                          AS "totalCents",
      COUNT(*)::bigint                                      AS "rowCount"
    FROM "transactions" t
    ${ACCOUNT_JOIN}
    LEFT JOIN "merchants" m
      ON m."id" = t."merchantId" AND m."householdId" = t."householdId"
    LEFT JOIN "merchant_tags" mt
      ON mt."merchantId" = t."merchantId"
     AND mt."isPrimary"
     AND mt."householdId" = t."householdId"
    LEFT JOIN "tags" pt
      ON pt."id" = mt."tagId" AND pt."householdId" = t."householdId"
    WHERE t."householdId" = ${context.householdId}::uuid
      AND ${POT_ROW}
      AND t."flow" = ${flow}::"Flow"
      AND t."bookingDate" >= ${plainDateToDbDate(period.from)}
      AND t."bookingDate" <= ${plainDateToDbDate(period.to)}
    GROUP BY 1, 2, 3, 4, 5
  `;
  return rows.map((row) => ({
    merchantId: row.merchantId,
    merchantName: row.merchantName,
    primaryTag: row.primaryTag,
    counterpartyText: row.counterpartyText,
    isCash: row.isCash,
    totalCents: cents(Number(row.totalCents)),
    rowCount: Number(row.rowCount),
  }));
};

export const listIncomeGroups = (
  context: HouseholdContext,
  period: Period,
): Promise<readonly CountedGroupRow[]> =>
  countedGroups(context, period, "INCOME");

export const listSpendGroups = (
  context: HouseholdContext,
  period: Period,
): Promise<readonly CountedGroupRow[]> =>
  countedGroups(context, period, "SPEND");

export const listReserveMovements = async (
  context: HouseholdContext,
  period: Period,
): Promise<readonly ReserveMovementGroup[]> => {
  const rows = await prisma.$queryRaw<
    readonly {
      counterpartyIban: string;
      label: string | null;
      totalCents: bigint;
      rowCount: bigint;
    }[]
  >`
    SELECT
      ${CANONICAL_COUNTERPARTY_SQL} AS "counterpartyIban",
      ra."label"                    AS "label",
      SUM(t."amountCents")::bigint  AS "totalCents",
      COUNT(*)::bigint              AS "rowCount"
    FROM "transactions" t
    ${ACCOUNT_JOIN}
    LEFT JOIN "accounts" ra
      ON ra."iban" = ${CANONICAL_COUNTERPARTY_SQL}
     AND ra."householdId" = t."householdId"
    WHERE t."householdId" = ${context.householdId}::uuid
      AND ${POT_ROW}
      AND t."flow" = 'RESERVE'::"Flow"
      AND t."counterpartyIban" IS NOT NULL
      AND t."bookingDate" >= ${plainDateToDbDate(period.from)}
      AND t."bookingDate" <= ${plainDateToDbDate(period.to)}
    GROUP BY 1, 2
    ORDER BY 3 ASC
  `;
  return rows.map((row) => ({
    counterpartyIban: row.counterpartyIban,
    label: row.label ?? row.counterpartyIban,
    // Stored pot-side signs: negative parked. Display is the parked
    // direction, positive toward the reserve.
    parkedCents: cents(0 - Number(row.totalCents)),
    rowCount: Number(row.rowCount),
  }));
};

export const monthFigures = async (
  context: HouseholdContext,
  period: Period,
): Promise<RawMonthFigures> => {
  const rows = await prisma.$queryRaw<
    readonly {
      incomeSigned: bigint;
      spendSigned: bigint;
      reserveSigned: bigint;
      changeInPot: bigint;
      unresolvedCents: bigint;
      unresolvedCount: bigint;
      unmatchedCents: bigint;
      unmatchedCount: bigint;
      inTransitCents: bigint;
      inTransitCount: bigint;
      uninterpretedCount: bigint;
      rowCount: bigint;
    }[]
  >`
    SELECT
      COALESCE(SUM(t."amountCents") FILTER (WHERE t."flow" = 'INCOME'), 0)::bigint      AS "incomeSigned",
      COALESCE(SUM(t."amountCents") FILTER (WHERE t."flow" = 'SPEND'), 0)::bigint       AS "spendSigned",
      COALESCE(SUM(t."amountCents") FILTER (WHERE t."flow" = 'RESERVE'), 0)::bigint     AS "reserveSigned",
      COALESCE(SUM(t."amountCents") FILTER (WHERE t."flow" IS NOT NULL), 0)::bigint     AS "changeInPot",
      COALESCE(SUM(t."amountCents") FILTER (WHERE t."flow" = 'UNRESOLVED'), 0)::bigint  AS "unresolvedCents",
      COUNT(*) FILTER (WHERE t."flow" = 'UNRESOLVED')::bigint                           AS "unresolvedCount",
      COALESCE(SUM(t."amountCents") FILTER (
        WHERE t."flow" = 'INTERNAL' AND NOT ${MATCHED_LINK_EXISTS}), 0)::bigint         AS "unmatchedCents",
      COUNT(*) FILTER (
        WHERE t."flow" = 'INTERNAL' AND NOT ${MATCHED_LINK_EXISTS})::bigint             AS "unmatchedCount",
      COALESCE(SUM(t."amountCents") FILTER (
        WHERE t."flow" = 'INTERNAL' AND ${inTransitExists(period)}), 0)::bigint         AS "inTransitCents",
      COUNT(*) FILTER (
        WHERE t."flow" = 'INTERNAL' AND ${inTransitExists(period)})::bigint             AS "inTransitCount",
      COUNT(*) FILTER (WHERE t."flow" IS NULL)::bigint                                  AS "uninterpretedCount",
      COUNT(*) FILTER (WHERE t."flow" IS NOT NULL)::bigint                              AS "rowCount"
    FROM "transactions" t
    ${ACCOUNT_JOIN}
    WHERE t."householdId" = ${context.householdId}::uuid
      AND ${POT_ROW}
      AND t."bookingDate" >= ${plainDateToDbDate(period.from)}
      AND t."bookingDate" <= ${plainDateToDbDate(period.to)}
  `;
  // The WHERE deliberately carries NO flow filter (fix round 1, finding
  // CR-502): a row committed by ingest whose interpretation never ran
  // (flow NULL) must be COUNTED here as uninterpreted, not vanish from
  // every surface with a green panel. The named sums, changeInPot and
  // rowCount each filter on flow themselves, so the figures over
  // interpreted rows are unchanged.
  //
  // WHAT THE WHERE DOES CARRY, ADDED BY M3-P14 UNDER DECISION D-56, is the
  // RING. CR-502 is held, not undone: a null flow on a POT account is still
  // counted here and still holds the verdict open. What leaves is a null
  // flow on an account OUTSIDE the pot, which is a HELD row under DR-0030
  // and not a gap: without this scoping a household that ever imported a
  // savings statement would see its books never close, over rows the
  // product had decided on purpose not to interpret. The SAME predicate is
  // on listGapRows below, because the cause block is gated on this count
  // while its rows come from that listing.
  const row = rows[0];
  if (row === undefined) {
    throw new Error("Aggregate query returned no row");
  }
  return {
    incomeSignedCents: cents(Number(row.incomeSigned)),
    spendSignedCents: cents(Number(row.spendSigned)),
    reserveSignedCents: cents(Number(row.reserveSigned)),
    changeInPotCents: cents(Number(row.changeInPot)),
    unresolvedCents: cents(Number(row.unresolvedCents)),
    unresolvedCount: Number(row.unresolvedCount),
    unmatchedInternalCents: cents(Number(row.unmatchedCents)),
    unmatchedInternalCount: Number(row.unmatchedCount),
    inTransitCents: cents(Number(row.inTransitCents)),
    inTransitCount: Number(row.inTransitCount),
    uninterpretedCount: Number(row.uninterpretedCount),
    rowCount: Number(row.rowCount),
  };
};

export const listGapRows = async (
  context: HouseholdContext,
  period: Period,
): Promise<readonly GapRow[]> => {
  const rows = await prisma.$queryRaw<
    readonly {
      id: string;
      gap: string;
      bookingDate: Date;
      text: string;
      accountLabel: string;
      amountCents: number;
    }[]
  >`
    SELECT
      t."id"                                          AS "id",
      CASE
        WHEN t."flow" IS NULL THEN 'uninterpreted'
        WHEN t."flow" = 'UNRESOLVED' THEN 'unresolved'
        WHEN ${MATCHED_LINK_EXISTS} THEN 'in-transit'
        ELSE 'unmatched-internal'
      END                                             AS "gap",
      t."bookingDate"                                 AS "bookingDate",
      ${COUNTERPARTY_TEXT_SQL}                        AS "text",
      a."label"                                       AS "accountLabel",
      t."amountCents"                                 AS "amountCents"
    FROM "transactions" t
    ${ACCOUNT_JOIN}
    WHERE t."householdId" = ${context.householdId}::uuid
      AND ${POT_ROW}
      AND t."bookingDate" >= ${plainDateToDbDate(period.from)}
      AND t."bookingDate" <= ${plainDateToDbDate(period.to)}
      AND (
        t."flow" IS NULL
        OR t."flow" = 'UNRESOLVED'::"Flow"
        OR (t."flow" = 'INTERNAL'::"Flow" AND NOT ${MATCHED_LINK_EXISTS})
        OR (t."flow" = 'INTERNAL'::"Flow" AND ${inTransitExists(period)})
      )
    ORDER BY t."bookingDate" ASC, t."id" ASC
  `;
  return rows.map((row) => ({
    id: row.id,
    gap: parseGapKind(row.gap),
    bookingDate: plainDateFromDbDate(row.bookingDate),
    text: row.text,
    accountLabel: row.accountLabel,
    amountCents: cents(row.amountCents),
  }));
};

const parseGapKind = (value: string): GapRow["gap"] => {
  switch (value) {
    case "unresolved":
    case "unmatched-internal":
    case "in-transit":
    case "uninterpreted":
      return value;
    default:
      throw new Error(`Unknown gap kind from SQL: ${value}`);
  }
};

// THE TWO READS THAT NAME EVERY ACCOUNT WITH ROWS IN THE PERIOD (M3-P14,
// DR-0030, criterion 14.15). Two rather than one, and they do different
// work, which an earlier draft of this plan conflated.
//
// THE HELD READ is the THIRD test of an absent flow in this repository, and
// it carries the INVERSE ring predicate of the other two: rows with no flow
// on accounts that are NOT pot accounts, counted per account over the
// requested period. That is the held state, and criterion 14.14 case FIVE
// enumerates exactly three such reads and fails on a fourth.
//
// THE COUNTED READ carries NO null-flow condition at all, which is why it
// sits OUTSIDE that enumeration rather than widening it: it is rows WITH a
// flow ON pot accounts. It exists because the account whose ring was
// answered wrongly toward the spending side IS a pot account, so a read
// restricted to non-pot accounts could never see the very case the screen
// element exists to surface, and that case is the dangerous one: a savings
// account answered as a spending account has its interest taken as income,
// its outgoings as spend and both legs of every transfer paired as internal,
// so no cause block appears, the reserves card reads zero and the verdict
// reads that the books close. Nothing on the month view's FIGURES differs
// from a correct month.
//
// THE RING RESTRICTION ON THE COUNTED READ IS NOT MADE REDUNDANT BY THE FLOW
// CONDITION. A row on a non-pot account that STILL CARRIES A FLOW is the
// clearing-that-missed-a-row state; without the restriction this read would
// report it to the household as counted money on the one screen state built
// to tell counted from held.
//
// BOTH RETURN COUNTS PER ACCOUNT, never an amount and never a sum outside
// the requested period, which is decision D-60: no figure in v1 is
// accumulated across months, and a count of statements held is not a
// balance.
//
// Written in raw SQL rather than through the Prisma client deliberately: it
// is the style the other two absent-flow reads use and the style criterion
// 14.14 case FIVE's enumeration was built for.
const accountRowCounts = async (
  context: HouseholdContext,
  period: Period,
  ring: "counted" | "held",
): Promise<readonly AccountRowCount[]> => {
  const rows = await prisma.$queryRaw<
    readonly {
      accountId: string;
      label: string;
      rowCount: bigint;
    }[]
  >`
    SELECT
      t."accountId"     AS "accountId",
      a."label"         AS "label",
      COUNT(*)::bigint  AS "rowCount"
    FROM "transactions" t
    ${ACCOUNT_JOIN}
    WHERE t."householdId" = ${context.householdId}::uuid
      AND ${ring === "counted" ? POT_ROW : NON_POT_ROW}
      AND ${
        ring === "counted"
          ? Prisma.sql`t."flow" IS NOT NULL`
          : Prisma.sql`t."flow" IS NULL`
      }
      AND t."bookingDate" >= ${plainDateToDbDate(period.from)}
      AND t."bookingDate" <= ${plainDateToDbDate(period.to)}
    GROUP BY 1, 2
    ORDER BY 2 ASC, 1 ASC
  `;
  return rows.map((row) => ({
    accountId: row.accountId,
    label: row.label,
    rowCount: Number(row.rowCount),
  }));
};

export const listCountedAccountRows = (
  context: HouseholdContext,
  period: Period,
): Promise<readonly AccountRowCount[]> =>
  accountRowCounts(context, period, "counted");

export const listHeldAccountRows = (
  context: HouseholdContext,
  period: Period,
): Promise<readonly AccountRowCount[]> =>
  accountRowCounts(context, period, "held");

export const hasAnyTransactions = async (
  context: HouseholdContext,
): Promise<boolean> => {
  const first = await prisma.transaction.findFirst({
    where: { householdId: context.householdId },
    select: { id: true },
  });
  return first !== null;
};
