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
import type { Period } from "../application/ports";

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
const MATCHED_LINK_EXISTS = Prisma.sql`EXISTS (
  SELECT 1 FROM "transfer_links" l
  WHERE l."householdId" = t."householdId"
    AND (
      (l."outgoingTransactionId" = t."id" AND l."incomingTransactionId" IS NOT NULL)
      OR l."incomingTransactionId" = t."id"
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
      COALESCE(t."counterpartyName", t."description")       AS "counterpartyText",
      (t."description" ~* ${CASH_SQL_PATTERN})              AS "isCash",
      SUM(t."amountCents")::bigint                          AS "totalCents",
      COUNT(*)::bigint                                      AS "rowCount"
    FROM "transactions" t
    LEFT JOIN "merchants" m
      ON m."id" = t."merchantId" AND m."householdId" = t."householdId"
    LEFT JOIN "merchant_tags" mt
      ON mt."merchantId" = t."merchantId"
     AND mt."isPrimary"
     AND mt."householdId" = t."householdId"
    LEFT JOIN "tags" pt
      ON pt."id" = mt."tagId" AND pt."householdId" = t."householdId"
    WHERE t."householdId" = ${context.householdId}::uuid
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
      t."counterpartyIban"          AS "counterpartyIban",
      a."label"                     AS "label",
      SUM(t."amountCents")::bigint  AS "totalCents",
      COUNT(*)::bigint              AS "rowCount"
    FROM "transactions" t
    LEFT JOIN "accounts" a
      ON a."iban" = t."counterpartyIban" AND a."householdId" = t."householdId"
    WHERE t."householdId" = ${context.householdId}::uuid
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
      rowCount: bigint;
    }[]
  >`
    SELECT
      COALESCE(SUM(t."amountCents") FILTER (WHERE t."flow" = 'INCOME'), 0)::bigint      AS "incomeSigned",
      COALESCE(SUM(t."amountCents") FILTER (WHERE t."flow" = 'SPEND'), 0)::bigint       AS "spendSigned",
      COALESCE(SUM(t."amountCents") FILTER (WHERE t."flow" = 'RESERVE'), 0)::bigint     AS "reserveSigned",
      COALESCE(SUM(t."amountCents"), 0)::bigint                                         AS "changeInPot",
      COALESCE(SUM(t."amountCents") FILTER (WHERE t."flow" = 'UNRESOLVED'), 0)::bigint  AS "unresolvedCents",
      COUNT(*) FILTER (WHERE t."flow" = 'UNRESOLVED')::bigint                           AS "unresolvedCount",
      COALESCE(SUM(t."amountCents") FILTER (
        WHERE t."flow" = 'INTERNAL' AND NOT ${MATCHED_LINK_EXISTS}), 0)::bigint         AS "unmatchedCents",
      COUNT(*) FILTER (
        WHERE t."flow" = 'INTERNAL' AND NOT ${MATCHED_LINK_EXISTS})::bigint             AS "unmatchedCount",
      COUNT(*)::bigint                                                                  AS "rowCount"
    FROM "transactions" t
    WHERE t."householdId" = ${context.householdId}::uuid
      AND t."flow" IS NOT NULL
      AND t."bookingDate" >= ${plainDateToDbDate(period.from)}
      AND t."bookingDate" <= ${plainDateToDbDate(period.to)}
  `;
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
      CASE WHEN t."flow" = 'UNRESOLVED'
        THEN 'unresolved' ELSE 'unmatched-internal' END AS "gap",
      t."bookingDate"                                 AS "bookingDate",
      COALESCE(t."counterpartyName", t."description") AS "text",
      a."label"                                       AS "accountLabel",
      t."amountCents"                                 AS "amountCents"
    FROM "transactions" t
    JOIN "accounts" a ON a."id" = t."accountId" AND a."householdId" = t."householdId"
    WHERE t."householdId" = ${context.householdId}::uuid
      AND t."bookingDate" >= ${plainDateToDbDate(period.from)}
      AND t."bookingDate" <= ${plainDateToDbDate(period.to)}
      AND (
        t."flow" = 'UNRESOLVED'::"Flow"
        OR (t."flow" = 'INTERNAL'::"Flow" AND NOT ${MATCHED_LINK_EXISTS})
      )
    ORDER BY t."bookingDate" ASC, t."id" ASC
  `;
  return rows.map((row) => ({
    id: row.id,
    gap: row.gap === "unresolved" ? "unresolved" : "unmatched-internal",
    bookingDate: plainDateFromDbDate(row.bookingDate),
    text: row.text,
    accountLabel: row.accountLabel,
    amountCents: cents(row.amountCents),
  }));
};

export const hasAnyTransactions = async (
  context: HouseholdContext,
): Promise<boolean> => {
  const first = await prisma.transaction.findFirst({
    where: { householdId: context.householdId },
    select: { id: true },
  });
  return first !== null;
};
