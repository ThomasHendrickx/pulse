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
      counterpartyAccount: string | null;
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
      t."counterpartyIban"                                  AS "counterpartyAccount",
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
    GROUP BY 1, 2, 3, 4, 5, 6
  `;
  return rows.map((row) => ({
    merchantId: row.merchantId,
    merchantName: row.merchantName,
    primaryTag: row.primaryTag,
    counterpartyText: row.counterpartyText,
    counterpartyAccount: row.counterpartyAccount,
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

// THE RESERVES JOIN CANONICALISES BOTH SIDES (M3-P14, criterion 14.1 and
// 14.4). It used to compare the stored strings raw, so a savings account
// registered compact and a transfer row whose counterparty column the
// source printed SPACED joined to nothing and the row rendered under its
// account number instead of the label the household typed. The stored fact
// column is never rewritten to fix that (pulse-domain section 2, rule 1);
// the comparison canonicalises instead, the same rule as the ledger's
// declared-set lookups. The SQL form mirrors canonicalAccountNumber in
// src/platform/account-number.ts: uppercase, every whitespace removed.
//
// THE WHITESPACE CLASS IS WRITTEN [[:space:]] AND NOT \s ON PURPOSE, and
// this is a correction of a defect this phase shipped and its own journey
// spec caught (clause R-087). These queries are Prisma tagged TEMPLATE
// LITERALS, so the SQL text passes through JavaScript escaping first: a
// backslash-s in the source is not a recognised JavaScript escape and
// collapses to a bare `s`, so the join ran regexp_replace(col, 's', ...)
// and stripped the letter s from both sides instead of stripping
// whitespace. It joined nothing, the reserve rows rendered under their
// account numbers, and criterion 14.1's label assertion was what said so.
// The POSIX class carries no backslash and cannot be eaten that way.
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
      upper(regexp_replace(t."counterpartyIban", '[[:space:]]', '', 'g'))
                                    AS "counterpartyIban",
      a."label"                     AS "label",
      SUM(t."amountCents")::bigint  AS "totalCents",
      COUNT(*)::bigint              AS "rowCount"
    FROM "transactions" t
    LEFT JOIN "accounts" a
      ON upper(regexp_replace(a."iban", '[[:space:]]', '', 'g'))
         = upper(regexp_replace(t."counterpartyIban", '[[:space:]]', '', 'g'))
     AND a."householdId" = t."householdId"
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
    WHERE t."householdId" = ${context.householdId}::uuid
      AND t."bookingDate" >= ${plainDateToDbDate(period.from)}
      AND t."bookingDate" <= ${plainDateToDbDate(period.to)}
  `;
  // The WHERE deliberately carries NO flow filter (fix round 1, finding
  // CR-502): a row committed by ingest whose interpretation never ran
  // (flow NULL) must be COUNTED here as uninterpreted, not vanish from
  // every surface with a green panel. The named sums, changeInPot and
  // rowCount each filter on flow themselves, so the figures over
  // interpreted rows are unchanged.
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
    JOIN "accounts" a ON a."id" = t."accountId" AND a."householdId" = t."householdId"
    WHERE t."householdId" = ${context.householdId}::uuid
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

export const hasAnyTransactions = async (
  context: HouseholdContext,
): Promise<boolean> => {
  const first = await prisma.transaction.findFirst({
    where: { householdId: context.householdId },
    select: { id: true },
  });
  return first !== null;
};
