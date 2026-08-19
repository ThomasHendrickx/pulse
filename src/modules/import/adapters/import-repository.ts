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
import type { ParsedRow } from "../domain/parse-statement";
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

export const getProfile = async (
  context: HouseholdContext,
  profileId: string,
): Promise<StoredProfile | null> => {
  const row = await prisma.sourceProfile.findFirst({
    where: { id: profileId, householdId: context.householdId },
  });
  if (row === null) {
    return null;
  }
  const spec = parseSourceProfileSpec(row.spec);
  if (!spec.ok) {
    throw new Error(`Stored source profile ${row.id} carries an invalid spec`);
  }
  return {
    id: row.id,
    name: row.name,
    spec: spec.value,
    ...(row.accountId === null ? {} : { accountId: row.accountId }),
  };
};

export const listImportIdsForProfile = async (
  context: HouseholdContext,
  profileId: string,
): Promise<readonly string[]> => {
  const rows = await prisma.import.findMany({
    where: {
      householdId: context.householdId,
      sourceProfileId: profileId,
      status: { in: ["INGESTED", "INTERPRETED"] },
    },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  return rows.map((row) => row.id);
};

export const listFactRowsForImport = async (
  context: HouseholdContext,
  importId: string,
): Promise<
  readonly {
    readonly id: string;
    readonly accountId: string;
    readonly rawLine: string;
    readonly dedupKey: string;
  }[]
> => {
  const rows = await prisma.transaction.findMany({
    where: { householdId: context.householdId, importId },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { id: true, accountId: true, rawLine: true, dedupKey: true },
  });
  return rows;
};

// THE ONE SANCTIONED FACTS REBUILD (see the port contract in
// application/ports.ts): everything below runs in ONE database
// transaction, so a failure rewrites nothing. Dedup keys move in two
// phases inside that transaction (every touched row to a
// collision-free temporary key derived from its id, then to its final
// key), because the per-household unique index is checked per statement
// and two rows may exchange keys under the corrected spec.
export const applyReparse = async (
  context: HouseholdContext,
  input: {
    readonly profileId: string;
    readonly spec: SourceProfileSpec;
    readonly imports: readonly {
      readonly importId: string;
      readonly rows: readonly (ParsedRow & {
        readonly transactionId: string;
        readonly dedupKey: string;
      })[];
    }[];
  },
): Promise<void> => {
  await prisma.$transaction(async (tx) => {
    await tx.sourceProfile.updateMany({
      where: { id: input.profileId, householdId: context.householdId },
      data: { spec: input.spec as unknown as Prisma.InputJsonValue },
    });
    const touchedIds = input.imports.flatMap((entry) =>
      entry.rows.map((row) => row.transactionId),
    );
    if (touchedIds.length === 0) {
      return;
    }
    // Phase 1: park every touched row on a temporary key that cannot
    // collide with any real key (real keys start with "nat:" or "h:").
    await tx.$executeRaw`
      UPDATE "transactions"
      SET "dedupKey" = 'reparse-tmp:' || "id"
      WHERE "householdId" = ${context.householdId}::uuid
        AND "id" = ANY(${touchedIds}::uuid[])`;
    // Phase 2: rewrite each row's fact columns and final key from its
    // re-parsed rawLine. Row identity, importId, accountId and rawLine
    // itself never change.
    for (const entry of input.imports) {
      for (const row of entry.rows) {
        await tx.transaction.updateMany({
          where: { id: row.transactionId, householdId: context.householdId },
          data: {
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
            dedupKey: row.dedupKey,
          },
        });
      }
    }
    // Finding CR-304: the facts rewrite invalidates the stored
    // interpretation, so the SAME transaction moves every affected import
    // back to INGESTED, the pipeline's visible needs-interpretation
    // marker. The reinterpretation that follows restores INTERPRETED; a
    // death between the two leaves the marker, and recovery is the
    // existing pipeline.
    await tx.import.updateMany({
      where: {
        householdId: context.householdId,
        id: { in: input.imports.map((entry) => entry.importId) },
        status: "INTERPRETED",
      },
      data: { status: "INGESTED" },
    });
  });
};

// Conditional transition (finding F4): FAILED is claimed only from
// AWAITING_DECLARATION, so a racer that already ingested the import can
// never be overwritten with a failure that lies about its stored rows.
export const markImportFailed = async (
  context: HouseholdContext,
  importId: string,
  reason: ImportFailureReason,
): Promise<boolean> => {
  const updated = await prisma.import.updateMany({
    where: {
      id: importId,
      householdId: context.householdId,
      status: "AWAITING_DECLARATION",
    },
    data: { status: "FAILED", failureReason: reason },
  });
  return updated.count === 1;
};

export const ingestRows = async (
  context: HouseholdContext,
  input: {
    readonly importId: string;
    readonly accountId: string;
    readonly sourceProfileId: string;
    readonly fromStatus: ImportStatus;
    readonly rows: readonly IngestRow[];
  },
): Promise<
  | { readonly ok: true; readonly added: number; readonly known: number }
  | { readonly ok: false; readonly error: "not-in-expected-status" }
> => {
  return prisma.$transaction(async (tx) => {
    // THE CLAIM, first and conditional (finding F4): exactly one racer
    // can move the import out of fromStatus. Running inside the same
    // transaction as the insert means a loser observed here has written
    // nothing, and a crash after the claim rolls the claim back too.
    const claimed = await tx.import.updateMany({
      where: {
        id: input.importId,
        householdId: context.householdId,
        status: input.fromStatus,
      },
      data: {
        status: "INGESTED",
        accountId: input.accountId,
        sourceProfileId: input.sourceProfileId,
      },
    });
    if (claimed.count !== 1) {
      return { ok: false, error: "not-in-expected-status" as const };
    }
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
      data: { rowsAdded: added, rowsKnown: known },
    });
    return { ok: true, added, known };
  });
};
