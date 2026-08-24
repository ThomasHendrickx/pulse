// In-memory fakes of the import module's ports for the fast gate: no
// database in unit tests (pulse-typescript section 8). The fake repository
// reproduces the REAL insert semantics the schema enforces: a unique
// (householdId, dedupKey) pair with duplicate inserts skipped, counts
// reported from the one insert pass. The parser is the real domain parser,
// never a mock of code we own.

import { statementParser } from "../../src/modules/import/adapters/statement-parser";
import {
  interpretForImport,
  recomputeInterpretation,
} from "../../src/modules/ledger/application/interpret-window";
import { previewDeclarationChange } from "../../src/modules/ledger/application/preview-declaration-change";
import { canonicalAccountNumber } from "../../src/platform/account-number";
import { resolveCounterparties } from "../../src/modules/merchants/application/resolve-counterparties";
import type { MerchantRuleLike } from "../../src/modules/merchants/domain/merchant-rule";
import type {
  MerchantRecord,
  MerchantRepositoryPort,
  TagRecord,
} from "../../src/modules/merchants/application/ports";
import type { Cents } from "../../src/platform/money";
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
  AccountRepositoryPort,
  DeclarationChangePreviewPort,
  NewAccount,
  RecomputeInterpretation,
} from "../../src/modules/accounts/application/ports";
import type { HouseholdContext } from "../../src/platform/tenancy";

export type StoredTransaction = IngestRow & {
  readonly id: string;
  readonly householdId: string;
  readonly accountId: string;
  readonly importId: string;
  // Interpretation columns, written only through the ledger fake's
  // replaceInterpretation, mirroring the real schema's flow and merchantId
  // columns.
  flow?: Flow;
  merchantId?: string;
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
  settlementTotalCents?: number;
  failureReason?: ImportFailureReason;
};

export type StoredMerchant = MerchantRecord & { readonly householdId: string };
export type StoredRule = MerchantRuleLike & { readonly householdId: string };
export type StoredTag = TagRecord & { readonly householdId: string };
export type StoredMerchantTag = {
  readonly householdId: string;
  readonly merchantId: string;
  readonly tagId: string;
  isPrimary: boolean;
};

export type FakeImportWorld = {
  readonly deps: ImportDependencies;
  readonly ledgerDeps: LedgerDependencies;
  readonly accountsRepository: AccountRepositoryPort;
  readonly engine: {
    readonly preview: DeclarationChangePreviewPort;
    readonly recompute: RecomputeInterpretation;
  };
  readonly merchantsPort: MerchantRepositoryPort;
  readonly transactions: readonly StoredTransaction[];
  readonly links: readonly StoredTransferLink[];
  readonly imports: ReadonlyMap<string, MutableImport>;
  readonly profiles: readonly (StoredProfile & { householdId: string })[];
  readonly accounts: readonly (AccountRecord & { householdId: string })[];
  readonly merchants: readonly StoredMerchant[];
  readonly rules: readonly StoredRule[];
  readonly tags: readonly StoredTag[];
  readonly merchantTags: readonly StoredMerchantTag[];
  // Every write into the merchants module's DECLARATION stores, counted:
  // criterion 3.2's runtime half asserts interpretation makes NONE.
  readonly declarationWrites: () => number;
};

export const makeFakeImportWorld = (): FakeImportWorld => {
  let nextId = 1;
  const id = (prefix: string): string => `${prefix}-${nextId++}`;

  const transactions: StoredTransaction[] = [];
  const links: StoredTransferLink[] = [];
  const imports = new Map<string, MutableImport>();
  const profiles: (StoredProfile & { householdId: string })[] = [];
  // MUTABLE ROLE, deliberately: the ring correction is a DECLARATION EDIT
  // (M3-P15) and this store has to be able to represent one, or every
  // correction test would be exercising a world where rings never change.
  const accounts: (Omit<AccountRecord, "role"> & {
    householdId: string;
    role: AccountRecord["role"];
  })[] = [];
  const merchants: StoredMerchant[] = [];
  const rules: StoredRule[] = [];
  const tags: StoredTag[] = [];
  const merchantTags: StoredMerchantTag[] = [];
  let declarationWriteCount = 0;

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
      // HZ2-M3P3-04: the settlement figure is rebuilt by the same
      // operation that rebuilds the facts it belongs to.
      for (const entry of input.imports) {
        const record = imports.get(entry.importId);
        if (record !== undefined && record.householdId === context.householdId) {
          if (entry.settlementTotalCents === undefined) {
            delete record.settlementTotalCents;
          } else {
            record.settlementTotalCents = entry.settlementTotalCents;
          }
        }
      }
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
      if (input.settlementTotalCents !== undefined) {
        record.settlementTotalCents = input.settlementTotalCents;
      }
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
    // CANONICAL ON BOTH SIDES, mirroring the Prisma adapter (M3-P14,
    // decision D-47). Account.iban is stored canonical by every writer, so
    // canonicalising the argument is the whole adoption mechanism; a fake
    // that compared raw strings would let every adoption test pass while the
    // real repository failed on exactly the surface forms that occur.
    findAccountByIban: async (context, iban) =>
      accounts.find(
        (account) =>
          account.householdId === context.householdId &&
          account.iban === canonicalAccountNumber(iban),
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
        // Normalised on the way in, exactly as the adapter does.
        ...(input.iban === undefined
          ? {}
          : { iban: canonicalAccountNumber(input.iban) }),
      };
      accounts.push(account);
      return account;
    },
  };

  // THE ACCOUNTS MODULE'S OWN REPOSITORY PORT over the same store (M3-P14).
  // The gateway above is the slice the IMPORT module sees; this is the full
  // port the registration and ring-correction use cases depend on.
  const accountsRepository: AccountRepositoryPort = {
    createAccount: async (context, input) => {
      const account = {
        id: id("account"),
        householdId: context.householdId,
        label: input.label,
        bank: input.bank,
        role: input.role,
        ...(input.iban === undefined
          ? {}
          : { iban: canonicalAccountNumber(input.iban) }),
      };
      accounts.push(account);
      return account;
    },
    listAccounts: async (context) =>
      accounts.filter((account) => account.householdId === context.householdId),
    findAccountByIban: accountsPort.findAccountByIban,
    getAccountById: accountsPort.getAccountById,
    listAccountsWithImportState: async (context) =>
      accounts
        .filter((account) => account.householdId === context.householdId)
        .map((account) => ({
          ...account,
          hasImport: [...imports.values()].some(
            (record) =>
              record.householdId === context.householdId &&
              record.accountId === account.id,
          ),
        })),
    updateAccountRole: async (context, accountId, role) => {
      const account = accounts.find(
        (candidate) =>
          candidate.householdId === context.householdId &&
          candidate.id === accountId,
      );
      if (account === undefined) {
        return null;
      }
      // ONE DECLARATION COLUMN. Nothing here touches a transaction row, and
      // the fake is written so that a use case which tried to would have no
      // way through this port to do it.
      account.role = role;
      return account;
    },
  };

  // THE FAKE REJECTS AN ACCOUNT ID THAT DOES NOT EXIST, exactly as the real
  // database does (M3-P14 fix). Prisma types Account.id as a uuid column, so
  // a synthetic placeholder id reaches Postgres as
  // "Inconsistent column data: Error creating UUID" and the request 500s.
  // The fake used to accept any string and return nothing, so a caller
  // asking for an account that does not exist was GREEN here and RED in the
  // browser, which is precisely the gap that let the registration preview
  // ship a 500 into an e2e run.
  //
  // THE MECHANISM, not the instance: "a repository read asked for an
  // identifier that was never issued". The rule belongs at the fake's own
  // boundary because that is where the difference between the fake and the
  // database lives.
  const requireRealAccountIds = (
    context: HouseholdContext,
    accountIds: readonly string[],
    where: string,
  ): void => {
    const known = new Set(
      accounts
        .filter((account) => account.householdId === context.householdId)
        .map((account) => account.id),
    );
    const unknown = accountIds.filter((accountId) => !known.has(accountId));
    if (unknown.length > 0) {
      throw new Error(
        `${where}: asked for account ids that do not exist: ${unknown.join(", ")}. The real database rejects this rather than returning nothing.`,
      );
    }
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

  // The merchants module's repository port over the same in-memory world.
  // Mirrors the Prisma adapter's semantics: unique (householdId, name) for
  // merchants and tags, upsert-by-(householdId, kind, pattern) for rules,
  // and setMerchantTag's atomic demote-then-promote so at most one primary
  // exists per merchant. Every DECLARATION write bumps the counter the
  // criterion 3.2 test reads.
  const merchantsPort: MerchantRepositoryPort = {
    listRules: async (context) =>
      rules.filter((rule) => rule.householdId === context.householdId),
    listMerchants: async (context) =>
      merchants.filter(
        (merchant) => merchant.householdId === context.householdId,
      ),
    findMerchantByName: async (context, name) =>
      merchants.find(
        (merchant) =>
          merchant.householdId === context.householdId && merchant.name === name,
      ) ?? null,
    createMerchant: async (context, name) => {
      declarationWriteCount += 1;
      const merchant = { id: id("merchant"), householdId: context.householdId, name };
      merchants.push(merchant);
      return merchant;
    },
    upsertRule: async (context, input) => {
      // Finding CR-401, mirrored from the adapter: the merchant the rule
      // points at must belong to the calling household.
      const owned = merchants.some(
        (merchant) =>
          merchant.householdId === context.householdId &&
          merchant.id === input.merchantId,
      );
      if (!owned) {
        throw new Error("upsertRule: merchant does not belong to the household");
      }
      declarationWriteCount += 1;
      const existing = rules.find(
        (rule) =>
          rule.householdId === context.householdId &&
          rule.kind === input.kind &&
          rule.pattern === input.pattern,
      );
      if (existing !== undefined) {
        const updated = { ...existing, merchantId: input.merchantId };
        rules[rules.indexOf(existing)] = updated;
        return updated;
      }
      const rule = {
        id: id("rule"),
        householdId: context.householdId,
        merchantId: input.merchantId,
        kind: input.kind,
        pattern: input.pattern,
      };
      rules.push(rule);
      return rule;
    },
    findTagByName: async (context, name) =>
      tags.find(
        (tag) => tag.householdId === context.householdId && tag.name === name,
      ) ?? null,
    createTag: async (context, name) => {
      declarationWriteCount += 1;
      const tag = { id: id("tag"), householdId: context.householdId, name };
      tags.push(tag);
      return tag;
    },
    setMerchantTag: async (context, input) => {
      // Finding CR-401, mirrored from the adapter: merchant AND tag are
      // verified under the household before any write. (The adapter's
      // second layer, the partial unique index on (merchantId) where
      // isPrimary, lives in the migration SQL; this single-threaded fake
      // cannot interleave transactions, so the index is asserted from the
      // committed SQL by the suite and witnessed against the real
      // database by the fix-round race probe.)
      const ownedMerchant = merchants.some(
        (merchant) =>
          merchant.householdId === context.householdId &&
          merchant.id === input.merchantId,
      );
      if (!ownedMerchant) {
        throw new Error("setMerchantTag: merchant does not belong to the household");
      }
      const ownedTag = tags.some(
        (tag) => tag.householdId === context.householdId && tag.id === input.tagId,
      );
      if (!ownedTag) {
        throw new Error("setMerchantTag: tag does not belong to the household");
      }
      declarationWriteCount += 1;
      if (input.isPrimary) {
        for (const link of merchantTags) {
          if (
            link.householdId === context.householdId &&
            link.merchantId === input.merchantId
          ) {
            link.isPrimary = false;
          }
        }
      }
      const existing = merchantTags.find(
        (link) =>
          link.householdId === context.householdId &&
          link.merchantId === input.merchantId &&
          link.tagId === input.tagId,
      );
      if (existing !== undefined) {
        existing.isPrimary = input.isPrimary;
        return;
      }
      merchantTags.push({
        householdId: context.householdId,
        merchantId: input.merchantId,
        tagId: input.tagId,
        isPrimary: input.isPrimary,
      });
    },
    listMerchantTags: async (context, merchantId) =>
      merchantTags
        .filter(
          (link) =>
            link.householdId === context.householdId &&
            link.merchantId === merchantId,
        )
        .map((link) => {
          const tag = tags.find((candidate) => candidate.id === link.tagId);
          return {
            tagId: link.tagId,
            tagName: tag?.name ?? "",
            isPrimary: link.isPrimary,
          };
        }),
    listCountedTransactions: async (context) =>
      transactions
        .filter(
          (stored) =>
            stored.householdId === context.householdId &&
            (stored.flow === "INCOME" || stored.flow === "SPEND"),
        )
        .map((stored) => ({
          id: stored.id,
          flow: stored.flow === "INCOME" ? ("INCOME" as const) : ("SPEND" as const),
          amountCents: stored.amountCents,
          description: stored.description,
          ...(stored.counterpartyName === undefined
            ? {}
            : { counterpartyName: stored.counterpartyName }),
          ...(stored.merchantId === undefined
            ? {}
            : { merchantId: stored.merchantId }),
        })),
  };

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
      listPotTransactions: async (context, input) => {
        requireRealAccountIds(context, input.accountIds, "listPotTransactions");
        return transactions
          .filter(
            (stored) =>
              stored.householdId === context.householdId &&
              input.accountIds.includes(stored.accountId) &&
              (input.from === undefined || stored.bookingDate >= input.from) &&
              (input.to === undefined || stored.bookingDate <= input.to),
          )
          .map(toLedgerTransaction);
      },
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
      listCardStatementTotals: async (context, input) =>
        [...imports.values()]
          .filter(
            (record) =>
              record.householdId === context.householdId &&
              record.accountId !== undefined &&
              input.accountIds.includes(record.accountId) &&
              record.settlementTotalCents !== undefined,
          )
          .map((record) => ({
            importId: record.id,
            settlementTotalCents: record.settlementTotalCents as Cents,
          }))
          .sort((a, b) => (a.importId < b.importId ? -1 : 1)),
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
            // A NULL FLOW CLEARS THE INTERPRETATION, the same way a null
            // merchantId clears an assignment below: the held state
            // (DR-0030, decision D-59) is the ABSENCE of a flow on a row
            // whose account is not a pot account, so the fake must be able
            // to represent it or every held-row test passes vacuously.
            if (entry.flow === null) {
              delete stored.flow;
            } else {
              stored.flow = entry.flow;
            }
          }
        }
        for (const entry of input.merchants) {
          const stored = transactions.find(
            (candidate) =>
              candidate.householdId === context.householdId &&
              candidate.id === entry.transactionId,
          );
          if (stored !== undefined) {
            if (entry.merchantId === null) {
              delete stored.merchantId;
            } else {
              stored.merchantId = entry.merchantId;
            }
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
    // The REAL rules-only resolver use case over the fake repository: the
    // fast gate exercises the same resolution code production runs, and
    // interpretation's whole merchants surface is this one read-only
    // function (criterion 3.2).
    merchants: {
      resolveCounterparties: (context, texts) =>
        resolveCounterparties(context, { merchants: merchantsPort }, texts),
    },
  };

  return {
    deps: {
      parser: statementParser,
      imports: importsPort,
      accounts: accountsPort,
      interpret: async (context, importId) => {
        await interpretForImport(context, ledgerDeps, importId);
      },
    },
    ledgerDeps,
    accountsRepository,
    // The two engine dependencies the accounts module's use cases take as
    // explicit arguments, bound here to the REAL ledger use cases over this
    // fake persistence, so an accounts test exercises the real dry run and
    // the real recompute rather than a stub of either.
    engine: {
      preview: (context, input) =>
        previewDeclarationChange(context, ledgerDeps, input),
      recompute: (context) => recomputeInterpretation(context, ledgerDeps),
    },
    merchantsPort,
    transactions,
    links,
    imports,
    profiles,
    accounts,
    merchants,
    rules,
    tags,
    merchantTags,
    declarationWrites: () => declarationWriteCount,
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
  ...(record.settlementTotalCents === undefined
    ? {}
    : { settlementTotalCents: record.settlementTotalCents }),
  ...(record.failureReason === undefined
    ? {}
    : { failureReason: record.failureReason }),
});
