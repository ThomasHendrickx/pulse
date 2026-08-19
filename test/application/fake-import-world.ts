// In-memory fakes of the import module's ports for the fast gate: no
// database in unit tests (pulse-typescript section 8). The fake repository
// reproduces the REAL insert semantics the schema enforces: a unique
// (householdId, dedupKey) pair with duplicate inserts skipped, counts
// reported from the one insert pass. The parser is the real domain parser,
// never a mock of code we own.

import { delimitedFileParser } from "../../src/modules/import/adapters/delimited-file-parser";
import { interpretForImport } from "../../src/modules/ledger/application/interpret-window";
import type { Flow } from "../../src/modules/ledger/domain/flow";
import type {
  DeclaredAccount,
  LedgerTransaction,
} from "../../src/modules/ledger/domain/ledger-transaction";
import type {
  InterpretationLinkWrite,
  LedgerDependencies,
} from "../../src/modules/ledger/application/ports";
import type {
  AccountsGateway,
  ImportDependencies,
  ImportFailureReason,
  ImportRecord,
  ImportRepositoryPort,
  ImportStatus,
  IngestRow,
  StoredProfile,
} from "../../src/modules/import/application/ports";
import type {
  AccountRecord,
  NewAccount,
} from "../../src/modules/accounts/application/ports";
import type { HouseholdContext } from "../../src/platform/tenancy";

export type StoredTransaction = IngestRow & {
  readonly id: string;
  readonly householdId: string;
  readonly accountId: string;
  readonly importId: string;
  // Interpretation column, written only through the ledger fake's
  // replaceInterpretation, mirroring the real schema's flow column.
  flow?: Flow;
};

export type StoredTransferLink = InterpretationLinkWrite & {
  readonly householdId: string;
};

type MutableImport = {
  id: string;
  householdId: string;
  status: ImportStatus;
  fileName: string;
  rawContent: Uint8Array;
  accountId?: string;
  sourceProfileId?: string;
  rowsAdded?: number;
  rowsKnown?: number;
  failureReason?: ImportFailureReason;
};

export type FakeImportWorld = {
  readonly deps: ImportDependencies;
  readonly ledgerDeps: LedgerDependencies;
  readonly transactions: readonly StoredTransaction[];
  readonly links: readonly StoredTransferLink[];
  readonly imports: ReadonlyMap<string, MutableImport>;
  readonly profiles: readonly (StoredProfile & { householdId: string })[];
  readonly accounts: readonly (AccountRecord & { householdId: string })[];
};

export const makeFakeImportWorld = (): FakeImportWorld => {
  let nextId = 1;
  const id = (prefix: string): string => `${prefix}-${nextId++}`;

  const transactions: StoredTransaction[] = [];
  const links: StoredTransferLink[] = [];
  const imports = new Map<string, MutableImport>();
  const profiles: (StoredProfile & { householdId: string })[] = [];
  const accounts: (AccountRecord & { householdId: string })[] = [];

  const importsPort: ImportRepositoryPort = {
    createImport: async (context, input) => {
      const record: MutableImport = {
        id: id("import"),
        householdId: context.householdId,
        status: input.status,
        fileName: input.fileName,
        rawContent: input.rawContent,
        ...(input.accountId === undefined ? {} : { accountId: input.accountId }),
        ...(input.sourceProfileId === undefined
          ? {}
          : { sourceProfileId: input.sourceProfileId }),
        ...(input.failureReason === undefined
          ? {}
          : { failureReason: input.failureReason }),
      };
      imports.set(record.id, record);
      return toImportRecord(record);
    },
    getImport: async (context, importId) => {
      const record = imports.get(importId);
      return record === undefined || record.householdId !== context.householdId
        ? null
        : toImportRecord(record);
    },
    listProfiles: async (context) =>
      profiles.filter((profile) => profile.householdId === context.householdId),
    createProfile: async (context, input) => {
      const profile = {
        id: id("profile"),
        householdId: context.householdId,
        name: input.name,
        spec: input.spec,
        ...(input.accountId === undefined ? {} : { accountId: input.accountId }),
      };
      profiles.push(profile);
      return profile;
    },
    getProfile: async (context, profileId) => {
      const profile = profiles.find(
        (candidate) =>
          candidate.householdId === context.householdId && candidate.id === profileId,
      );
      return profile ?? null;
    },
    listImportIdsForProfile: async (context, profileId) =>
      [...imports.values()]
        .filter(
          (record) =>
            record.householdId === context.householdId &&
            record.sourceProfileId === profileId &&
            (record.status === "INGESTED" || record.status === "INTERPRETED"),
        )
        .map((record) => record.id),
    listFactRowsForImport: async (context, importId) =>
      transactions
        .filter(
          (stored) =>
            stored.householdId === context.householdId &&
            stored.importId === importId,
        )
        .map((stored) => ({
          id: stored.id,
          accountId: stored.accountId,
          rawLine: stored.rawLine,
          dedupKey: stored.dedupKey,
        })),
    applyReparse: async (context, input) => {
      // Mirrors the adapter's contract: the profile spec and every listed
      // row's fact columns move together; row identity, importId,
      // accountId and rawLine never change. Finding CR-302: this fake now
      // ALSO enforces the per-household unique (householdId, dedupKey)
      // index the schema carries, all-or-nothing like the adapter's
      // database transaction: the rewrite is staged and committed only if
      // no key collides, and a collision throws with nothing applied
      // (before this, the header's claim of mirrored insert semantics was
      // false for this method and the fast gate could not see the abort).
      const staged = transactions.map((stored) => ({ ...stored }));
      for (const entry of input.imports) {
        for (const row of entry.rows) {
          const index = staged.findIndex(
            (stored) =>
              stored.householdId === context.householdId &&
              stored.id === row.transactionId,
          );
          const stored = staged[index];
          if (index < 0 || stored === undefined) {
            continue;
          }
          const { transactionId, ...parsed } = row;
          void transactionId;
          staged[index] = {
            ...parsed,
            id: stored.id,
            householdId: stored.householdId,
            accountId: stored.accountId,
            importId: stored.importId,
            rawLine: stored.rawLine,
            ...(stored.flow === undefined ? {} : { flow: stored.flow }),
          };
        }
      }
      const seen = new Set<string>();
      for (const stored of staged) {
        const key = `${stored.householdId}|${stored.dedupKey}`;
        if (seen.has(key)) {
          throw new Error(
            `Unique constraint violation on (householdId, dedupKey): ${stored.dedupKey}`,
          );
        }
        seen.add(key);
      }
      const profileIndex = profiles.findIndex(
        (candidate) =>
          candidate.householdId === context.householdId &&
          candidate.id === input.profileId,
      );
      const existing = profiles[profileIndex];
      if (profileIndex >= 0 && existing !== undefined) {
        profiles[profileIndex] = { ...existing, spec: input.spec };
      }
      transactions.splice(0, transactions.length, ...staged);
      // Finding CR-304, mirroring the adapter: the facts rewrite and the
      // INTERPRETED -> INGESTED downgrade commit together.
      for (const entry of input.imports) {
        const record = imports.get(entry.importId);
        if (
          record !== undefined &&
          record.householdId === context.householdId &&
          record.status === "INTERPRETED"
        ) {
          record.status = "INGESTED";
        }
      }
    },
    markImportFailed: async (context, importId, reason) => {
      // Conditional, mirroring the adapter (finding F4): FAILED is
      // claimed only from AWAITING_DECLARATION.
      const record = imports.get(importId);
      if (
        record === undefined ||
        record.householdId !== context.householdId ||
        record.status !== "AWAITING_DECLARATION"
      ) {
        return false;
      }
      record.status = "FAILED";
      record.failureReason = reason;
      return true;
    },
    ingestRows: async (context, input) => {
      // Mirrors the adapter's semantics: the CLAIM first (a conditional
      // transition out of fromStatus, finding F4), then
      // insert-with-duplicates-skipped over the per-household unique key,
      // exactly @@unique([householdId, dedupKey]) plus
      // createMany({ skipDuplicates: true }).
      const record = imports.get(input.importId);
      if (
        record === undefined ||
        record.householdId !== context.householdId ||
        record.status !== input.fromStatus
      ) {
        return { ok: false, error: "not-in-expected-status" as const };
      }
      record.status = "INGESTED";
      record.accountId = input.accountId;
      record.sourceProfileId = input.sourceProfileId;
      let added = 0;
      for (const row of input.rows) {
        const exists = transactions.some(
          (stored) =>
            stored.householdId === context.householdId &&
            stored.dedupKey === row.dedupKey,
        );
        if (!exists) {
          transactions.push({
            ...row,
            id: id("tx"),
            householdId: context.householdId,
            accountId: input.accountId,
            importId: input.importId,
          });
          added += 1;
        }
      }
      const known = input.rows.length - added;
      record.rowsAdded = added;
      record.rowsKnown = known;
      return { ok: true, added, known };
    },
  };

  const accountsPort: AccountsGateway = {
    findAccountByIban: async (context, iban) =>
      accounts.find(
        (account) =>
          account.householdId === context.householdId && account.iban === iban,
      ) ?? null,
    getAccountById: async (context, accountId) =>
      accounts.find(
        (account) =>
          account.householdId === context.householdId && account.id === accountId,
      ) ?? null,
    declareAccount: async (context: HouseholdContext, input: NewAccount) => {
      const account = {
        id: id("account"),
        householdId: context.householdId,
        label: input.label,
        bank: input.bank,
        role: input.role,
        ...(input.iban === undefined ? {} : { iban: input.iban }),
      };
      accounts.push(account);
      return account;
    },
  };

  // The ledger side of the fake world: the same stores, seen through the
  // ledger module's ports, so the import pipeline's interpret stage runs
  // the REAL interpretation use case over the fake persistence.
  const toLedgerTransaction = (stored: StoredTransaction): LedgerTransaction => ({
    id: stored.id,
    accountId: stored.accountId,
    importId: stored.importId,
    bookingDate: stored.bookingDate,
    amountCents: stored.amountCents,
    description: stored.description,
    ...(stored.counterpartyIban === undefined
      ? {}
      : { counterpartyIban: stored.counterpartyIban }),
    ...(stored.counterpartyName === undefined
      ? {}
      : { counterpartyName: stored.counterpartyName }),
  });

  const ledgerDeps: LedgerDependencies = {
    accounts: {
      listAccounts: async (context): Promise<readonly DeclaredAccount[]> =>
        accounts
          .filter((account) => account.householdId === context.householdId)
          .map((account) => ({
            id: account.id,
            role: account.role,
            ...(account.iban === undefined ? {} : { iban: account.iban }),
          })),
    },
    ledger: {
      listPotTransactions: async (context, input) =>
        transactions
          .filter(
            (stored) =>
              stored.householdId === context.householdId &&
              input.accountIds.includes(stored.accountId) &&
              (input.from === undefined || stored.bookingDate >= input.from) &&
              (input.to === undefined || stored.bookingDate <= input.to),
          )
          .map(toLedgerTransaction),
      listOutgoingCounterpartyRefs: async (context, input) =>
        transactions
          .filter(
            (stored) =>
              stored.householdId === context.householdId &&
              input.accountIds.includes(stored.accountId) &&
              stored.amountCents < 0,
          )
          .map((stored) => ({
            description: stored.description,
            ...(stored.counterpartyIban === undefined
              ? {}
              : { counterpartyIban: stored.counterpartyIban }),
            ...(stored.counterpartyName === undefined
              ? {}
              : { counterpartyName: stored.counterpartyName }),
          })),
      importPeriod: async (context, importId) => {
        const dates = transactions
          .filter(
            (stored) =>
              stored.householdId === context.householdId &&
              stored.importId === importId,
          )
          .map((stored) => stored.bookingDate)
          .sort();
        const from = dates[0];
        const to = dates[dates.length - 1];
        return from === undefined || to === undefined ? null : { from, to };
      },
      replaceInterpretation: async (context, input) => {
        const touched = new Set(input.transactionIds);
        for (let i = links.length - 1; i >= 0; i -= 1) {
          const link = links[i];
          if (
            link !== undefined &&
            link.householdId === context.householdId &&
            (touched.has(link.outgoingTransactionId) ||
              (link.incomingTransactionId !== undefined &&
                touched.has(link.incomingTransactionId)))
          ) {
            links.splice(i, 1);
          }
        }
        for (const entry of input.flows) {
          const stored = transactions.find(
            (candidate) =>
              candidate.householdId === context.householdId &&
              candidate.id === entry.transactionId,
          );
          if (stored !== undefined) {
            stored.flow = entry.flow;
          }
        }
        for (const link of input.links) {
          links.push({ ...link, householdId: context.householdId });
        }
        for (const importId of input.interpretedImportIds) {
          const record = imports.get(importId);
          if (
            record !== undefined &&
            record.householdId === context.householdId &&
            record.status === "INGESTED"
          ) {
            record.status = "INTERPRETED";
          }
        }
      },
    },
  };

  return {
    deps: {
      parser: delimitedFileParser,
      imports: importsPort,
      accounts: accountsPort,
      interpret: async (context, importId) => {
        await interpretForImport(context, ledgerDeps, importId);
      },
    },
    ledgerDeps,
    transactions,
    links,
    imports,
    profiles,
    accounts,
  };
};

const toImportRecord = (record: MutableImport): ImportRecord => ({
  id: record.id,
  status: record.status,
  fileName: record.fileName,
  rawContent: record.rawContent,
  ...(record.accountId === undefined ? {} : { accountId: record.accountId }),
  ...(record.sourceProfileId === undefined
    ? {}
    : { sourceProfileId: record.sourceProfileId }),
  ...(record.rowsAdded === undefined ? {} : { rowsAdded: record.rowsAdded }),
  ...(record.rowsKnown === undefined ? {} : { rowsKnown: record.rowsKnown }),
  ...(record.failureReason === undefined
    ? {}
    : { failureReason: record.failureReason }),
});
