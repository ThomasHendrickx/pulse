// Prisma repository for the import module. Every function takes the
// household context explicitly and filters on householdId (CLAUDE.md
// non-negotiable 6).
//
// FACTS ARE IMMUTABLE: this file exposes NO update path for Transaction
// rows. Ingest inserts with duplicate dedup keys skipped in ONE statement
// (never a read-then-write loop) and the import status transition rides
// the same database transaction, so a mixed-account or crashed ingest can
// never leave half a file in the ledger.

import { Prisma } from "@prisma/client";
import { prisma } from "@/platform/db/client";
import { plainDateToDbDate } from "@/platform/plain-date";
import type { HouseholdContext } from "@/platform/tenancy";
import {
  parseSourceProfileSpec,
  type SourceProfileSpec,
} from "../domain/source-profile";
import type {
  ImportFailureReason,
  ImportRecord,
  ImportStatus,
  IngestRow,
  StoredProfile,
} from "../application/ports";

const FAILURE_REASONS: readonly ImportFailureReason[] = [
  "mixed-accounts",
  "undetectable",
  "unparseable",
];

const toImportRecord = (row: {
  id: string;
  status: ImportStatus;
  fileName: string;
  rawContent: Uint8Array;
  accountId: string | null;
  sourceProfileId: string | null;
  rowsAdded: number | null;
  rowsKnown: number | null;
  failureReason: string | null;
}): ImportRecord => ({
  id: row.id,
  status: row.status,
  fileName: row.fileName,
  rawContent: new Uint8Array(row.rawContent),
  ...(row.accountId === null ? {} : { accountId: row.accountId }),
  ...(row.sourceProfileId === null ? {} : { sourceProfileId: row.sourceProfileId }),
  ...(row.rowsAdded === null ? {} : { rowsAdded: row.rowsAdded }),
  ...(row.rowsKnown === null ? {} : { rowsKnown: row.rowsKnown }),
  ...(row.failureReason !== null &&
  (FAILURE_REASONS as readonly string[]).includes(row.failureReason)
    ? { failureReason: row.failureReason as ImportFailureReason }
    : {}),
});

export const createImport = async (
  context: HouseholdContext,
  input: {
    readonly fileName: string;
    readonly rawContent: Uint8Array;
    readonly status: ImportStatus;
    readonly accountId?: string;
    readonly sourceProfileId?: string;
    readonly failureReason?: ImportFailureReason;
  },
): Promise<ImportRecord> => {
  const row = await prisma.import.create({
    data: {
      householdId: context.householdId,
      fileName: input.fileName,
      rawContent: Buffer.from(input.rawContent),
      status: input.status,
      accountId: input.accountId ?? null,
      sourceProfileId: input.sourceProfileId ?? null,
      failureReason: input.failureReason ?? null,
    },
  });
  return toImportRecord(row);
};

export const getImport = async (
  context: HouseholdContext,
  importId: string,
): Promise<ImportRecord | null> => {
  const row = await prisma.import.findFirst({
    where: { id: importId, householdId: context.householdId },
  });
  return row === null ? null : toImportRecord(row);
};

export const listImports = async (
  context: HouseholdContext,
): Promise<readonly ImportRecord[]> => {
  const rows = await prisma.import.findMany({
    where: { householdId: context.householdId },
    orderBy: { createdAt: "desc" },
  });
  return rows.map(toImportRecord);
};

export const listProfiles = async (
  context: HouseholdContext,
): Promise<readonly StoredProfile[]> => {
  const rows = await prisma.sourceProfile.findMany({
    where: { householdId: context.householdId },
    orderBy: { createdAt: "asc" },
  });
  const profiles: StoredProfile[] = [];
  for (const row of rows) {
    const spec = parseSourceProfileSpec(row.spec);
    if (spec.ok) {
      profiles.push({
        id: row.id,
        name: row.name,
        spec: spec.value,
        ...(row.accountId === null ? {} : { accountId: row.accountId }),
      });
    }
    // A stored spec that fails validation is a bug, not an expected
    // failure; skipping it silently would hide it, so throw.
    else {
      throw new Error(`Stored source profile ${row.id} carries an invalid spec`);
    }
  }
  return profiles;
};

export const createProfile = async (
  context: HouseholdContext,
  input: {
    readonly name: string;
    readonly spec: SourceProfileSpec;
    readonly accountId?: string;
  },
): Promise<StoredProfile> => {
  const row = await prisma.sourceProfile.create({
    data: {
      householdId: context.householdId,
      name: input.name,
      // Outbound serialisation, not an inbound shape assertion: the spec
      // is validated plain data and Prisma's InputJsonValue just cannot
      // see through the readonly union. The inbound path (listProfiles)
      // parses, never casts.
      spec: input.spec as unknown as Prisma.InputJsonValue,
      accountId: input.accountId ?? null,
    },
  });
  return {
    id: row.id,
    name: row.name,
    spec: input.spec,
    ...(row.accountId === null ? {} : { accountId: row.accountId }),
  };
};

export const markImportFailed = async (
  context: HouseholdContext,
  importId: string,
  reason: ImportFailureReason,
): Promise<void> => {
  await prisma.import.updateMany({
    where: { id: importId, householdId: context.householdId },
    data: { status: "FAILED", failureReason: reason },
  });
};

export const ingestRows = async (
  context: HouseholdContext,
  input: {
    readonly importId: string;
    readonly accountId: string;
    readonly sourceProfileId: string;
    readonly rows: readonly IngestRow[];
  },
): Promise<{ readonly added: number; readonly known: number }> => {
  return prisma.$transaction(async (tx) => {
    const created = await tx.transaction.createMany({
      data: input.rows.map((row) => ({
        householdId: context.householdId,
        accountId: input.accountId,
        importId: input.importId,
        bookingDate: plainDateToDbDate(row.bookingDate),
        valueDate:
          row.valueDate === undefined ? null : plainDateToDbDate(row.valueDate),
        amountCents: row.amountCents,
        counterpartyName: row.counterpartyName ?? null,
        counterpartyIban: row.counterpartyIban ?? null,
        description: row.description,
        reference: row.reference ?? null,
        statementNumber: row.statementNumber ?? null,
        sequenceNumber: row.sequenceNumber ?? null,
        rawLine: row.rawLine,
        dedupKey: row.dedupKey,
      })),
      skipDuplicates: true,
    });
    const added = created.count;
    const known = input.rows.length - added;
    await tx.import.updateMany({
      where: { id: input.importId, householdId: context.householdId },
      data: {
        status: "INGESTED",
        accountId: input.accountId,
        sourceProfileId: input.sourceProfileId,
        rowsAdded: added,
        rowsKnown: known,
      },
    });
    return { added, known };
  });
};

// Read side for the import screens and the e2e assertions: how many
// transaction rows an account carries.
export const countTransactionsForAccount = async (
  context: HouseholdContext,
  accountId: string,
): Promise<number> =>
  prisma.transaction.count({
    where: { householdId: context.householdId, accountId },
  });
