// Prisma repository for the ledger module. Every function takes the
// household context explicitly and filters on householdId (CLAUDE.md
// non-negotiable 6).
//
// LAYER CONTRACT: this repository reads FACT columns of transactions and
// writes ONLY interpretation state: the transactions.flow and
// transactions.merchantId columns, the transfer_links table, and the
// INGESTED -> INTERPRETED import status.
// The facts columns (raw fields, rawLine, dedup keys) are the import
// module's and are never written here; the one sanctioned facts rebuild is
// the import module's profile-fix re-parse, which is a different path.

import { prisma } from "@/platform/db/client";
import {
  plainDateFromDbDate,
  plainDateToDbDate,
  type PlainDate,
} from "@/platform/plain-date";
import type { Cents } from "@/platform/money";
import type { HouseholdContext } from "@/platform/tenancy";
import type { LedgerTransaction } from "../domain/ledger-transaction";
import type { Flow } from "../domain/flow";
import type {
  InterpretationLinkWrite,
  InterpretationMerchantWrite,
} from "../application/ports";

export const listPotTransactions = async (
  context: HouseholdContext,
  input: {
    readonly accountIds: readonly string[];
    readonly from?: PlainDate;
    readonly to?: PlainDate;
  },
): Promise<readonly LedgerTransaction[]> => {
  const rows = await prisma.transaction.findMany({
    where: {
      householdId: context.householdId,
      accountId: { in: [...input.accountIds] },
      ...(input.from !== undefined || input.to !== undefined
        ? {
            bookingDate: {
              ...(input.from === undefined
                ? {}
                : { gte: plainDateToDbDate(input.from) }),
              ...(input.to === undefined
                ? {}
                : { lte: plainDateToDbDate(input.to) }),
            },
          }
        : {}),
    },
    orderBy: [{ bookingDate: "asc" }, { id: "asc" }],
  });
  return rows.map((row) => ({
    id: row.id,
    accountId: row.accountId,
    importId: row.importId,
    bookingDate: plainDateFromDbDate(row.bookingDate),
    amountCents: row.amountCents as Cents,
    description: row.description,
    ...(row.counterpartyIban === null
      ? {}
      : { counterpartyIban: row.counterpartyIban }),
    ...(row.counterpartyName === null
      ? {}
      : { counterpartyName: row.counterpartyName }),
  }));
};

export const listOutgoingCounterpartyRefs = async (
  context: HouseholdContext,
  input: { readonly accountIds: readonly string[] },
): Promise<
  readonly {
    readonly counterpartyIban?: string;
    readonly counterpartyName?: string;
    readonly description: string;
  }[]
> => {
  const rows = await prisma.transaction.findMany({
    where: {
      householdId: context.householdId,
      accountId: { in: [...input.accountIds] },
      amountCents: { lt: 0 },
    },
    select: {
      counterpartyIban: true,
      counterpartyName: true,
      description: true,
    },
  });
  return rows.map((row) => ({
    description: row.description,
    ...(row.counterpartyIban === null
      ? {}
      : { counterpartyIban: row.counterpartyIban }),
    ...(row.counterpartyName === null
      ? {}
      : { counterpartyName: row.counterpartyName }),
  }));
};

// The settlement figure each card import's own statement carries, over
// the given accounts (finding HZ-M3P3-01). A FACT column, read here and
// never written here: the import module owns writing it, with the rows.
// Imports whose statement printed no such figure are absent from the
// result rather than reported as zero, so the row-sum fallback stays
// distinguishable from a statement that really settles at nothing.
export const listCardStatementTotals = async (
  context: HouseholdContext,
  input: { readonly accountIds: readonly string[] },
): Promise<
  readonly { readonly importId: string; readonly settlementTotalCents: Cents }[]
> => {
  if (input.accountIds.length === 0) {
    return [];
  }
  const rows = await prisma.import.findMany({
    where: {
      householdId: context.householdId,
      accountId: { in: [...input.accountIds] },
      settlementTotalCents: { not: null },
    },
    select: { id: true, settlementTotalCents: true },
    orderBy: { id: "asc" },
  });
  return rows.flatMap((row) =>
    row.settlementTotalCents === null
      ? []
      : [
          {
            importId: row.id,
            settlementTotalCents: row.settlementTotalCents as Cents,
          },
        ],
  );
};

// Whether an account carries imported FACT ROWS of its own (M3-P14,
// criterion 14.8). A READ, published so the accounts module can refuse a
// ring change on an account whose rows would otherwise keep a flow
// computed against the old ring. Nothing here writes.
export const hasImportedRows = async (
  context: HouseholdContext,
  accountId: string,
): Promise<boolean> => {
  const row = await prisma.transaction.findFirst({
    where: { householdId: context.householdId, accountId },
    select: { id: true },
  });
  return row !== null;
};

export const importPeriod = async (
  context: HouseholdContext,
  importId: string,
): Promise<{ readonly from: PlainDate; readonly to: PlainDate } | null> => {
  const span = await prisma.transaction.aggregate({
    where: { householdId: context.householdId, importId },
    _min: { bookingDate: true },
    _max: { bookingDate: true },
  });
  if (span._min.bookingDate === null || span._max.bookingDate === null) {
    return null;
  }
  return {
    from: plainDateFromDbDate(span._min.bookingDate),
    to: plainDateFromDbDate(span._max.bookingDate),
  };
};

export const replaceInterpretation = async (
  context: HouseholdContext,
  input: {
    readonly transactionIds: readonly string[];
    readonly flows: readonly {
      readonly transactionId: string;
      readonly flow: Flow;
    }[];
    readonly merchants: readonly InterpretationMerchantWrite[];
    readonly links: readonly InterpretationLinkWrite[];
    readonly interpretedImportIds: readonly string[];
  },
): Promise<void> => {
  const ids = [...input.transactionIds];
  await prisma.$transaction(async (tx) => {
    await tx.transferLink.deleteMany({
      where: {
        householdId: context.householdId,
        OR: [
          { outgoingTransactionId: { in: ids } },
          { incomingTransactionId: { in: ids } },
        ],
      },
    });
    // Flows are written per flow value: set-based updates, never a
    // row-by-row loop over thousands of rows.
    const byFlow = new Map<Flow, string[]>();
    for (const entry of input.flows) {
      const list = byFlow.get(entry.flow);
      if (list === undefined) {
        byFlow.set(entry.flow, [entry.transactionId]);
      } else {
        list.push(entry.transactionId);
      }
    }
    for (const [flow, flowIds] of byFlow) {
      await tx.transaction.updateMany({
        where: { householdId: context.householdId, id: { in: flowIds } },
        data: { flow },
      });
    }
    // Merchant assignments the same way: grouped per merchant id (null
    // included, which CLEARS stale assignments on rebuild), set-based.
    // This writes the transactions.merchantId INTERPRETATION column and
    // nothing in the merchants module's declaration tables.
    const byMerchant = new Map<string | null, string[]>();
    for (const entry of input.merchants) {
      const list = byMerchant.get(entry.merchantId);
      if (list === undefined) {
        byMerchant.set(entry.merchantId, [entry.transactionId]);
      } else {
        list.push(entry.transactionId);
      }
    }
    for (const [merchantId, merchantTransactionIds] of byMerchant) {
      await tx.transaction.updateMany({
        where: {
          householdId: context.householdId,
          id: { in: merchantTransactionIds },
        },
        data: { merchantId },
      });
    }
    if (input.links.length > 0) {
      await tx.transferLink.createMany({
        data: input.links.map((link) => ({
          householdId: context.householdId,
          outgoingTransactionId: link.outgoingTransactionId,
          incomingTransactionId: link.incomingTransactionId ?? null,
          settlementImportId: link.settlementImportId ?? null,
        })),
      });
    }
    await tx.import.updateMany({
      where: {
        householdId: context.householdId,
        id: { in: [...input.interpretedImportIds] },
        status: "INGESTED",
      },
      data: { status: "INTERPRETED" },
    });
  });
};
