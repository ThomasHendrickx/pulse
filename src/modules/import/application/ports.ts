// Ports of the import module. The use cases depend on these interfaces
// only. The StatementParser port is implemented by the one generic
// delimited-file parser (no per-bank parsers, pulse-domain section 5); the
// repository port is implemented over Prisma in adapters/, and tests run
// the use cases against in-memory fakes.

import type { HouseholdContext } from "@/platform/tenancy";
import type { Result } from "@/platform/result";
import type { AccountRecord, NewAccount } from "@/modules/accounts/application";
import type { DetectionError } from "../domain/detect-profile";
import type {
  ParsedStatement,
  StatementParseError,
} from "../domain/parse-statement";
import type { SourceProfileSpec } from "../domain/source-profile";
import type { ParsedRow } from "../domain/parse-statement";

export type StatementParser = {
  readonly detect: (
    bytes: Uint8Array,
  ) => Result<SourceProfileSpec, DetectionError>;
  readonly parse: (
    bytes: Uint8Array,
    spec: SourceProfileSpec,
  ) => Result<ParsedStatement, StatementParseError>;
};

export type ImportStatus =
  | "PARSED"
  | "AWAITING_DECLARATION"
  | "INGESTED"
  | "INTERPRETED"
  | "FAILED";

// Machine-readable failure tags; the UI translates them (never English
// sentences in error values, pulse-typescript section 5).
export type ImportFailureReason =
  | "mixed-accounts"
  | "undetectable"
  | "unparseable";

export type ImportRecord = {
  readonly id: string;
  readonly status: ImportStatus;
  readonly fileName: string;
  readonly rawContent: Uint8Array;
  readonly accountId?: string;
  readonly sourceProfileId?: string;
  readonly rowsAdded?: number;
  readonly rowsKnown?: number;
  readonly failureReason?: ImportFailureReason;
};

export type StoredProfile = {
  readonly id: string;
  readonly name: string;
  readonly spec: SourceProfileSpec;
  readonly accountId?: string;
};

export type IngestRow = ParsedRow & { readonly dedupKey: string };

export type ImportRepositoryPort = {
  readonly createImport: (
    context: HouseholdContext,
    input: {
      readonly fileName: string;
      readonly rawContent: Uint8Array;
      readonly status: ImportStatus;
      readonly accountId?: string;
      readonly sourceProfileId?: string;
      readonly failureReason?: ImportFailureReason;
    },
  ) => Promise<ImportRecord>;
  readonly getImport: (
    context: HouseholdContext,
    importId: string,
  ) => Promise<ImportRecord | null>;
  readonly listProfiles: (
    context: HouseholdContext,
  ) => Promise<readonly StoredProfile[]>;
  readonly createProfile: (
    context: HouseholdContext,
    input: {
      readonly name: string;
      readonly spec: SourceProfileSpec;
      readonly accountId?: string;
    },
  ) => Promise<StoredProfile>;
  // The one status transition a confirm-time failure needs: to FAILED,
  // with the reason. Never touches transaction rows.
  readonly markImportFailed: (
    context: HouseholdContext,
    importId: string,
    reason: ImportFailureReason,
  ) => Promise<void>;
  // Transactional: inserts the rows with duplicate dedup keys skipped
  // (one statement, never a read-then-write loop) and moves the import to
  // INGESTED with the added and already-known counts, atomically.
  readonly ingestRows: (
    context: HouseholdContext,
    input: {
      readonly importId: string;
      readonly accountId: string;
      readonly sourceProfileId: string;
      readonly rows: readonly IngestRow[];
    },
  ) => Promise<{ readonly added: number; readonly known: number }>;
};

// The slice of the accounts module the import use cases need, satisfied by
// the accounts module's published application interface.
export type AccountsGateway = {
  readonly findAccountByIban: (
    context: HouseholdContext,
    iban: string,
  ) => Promise<AccountRecord | null>;
  readonly getAccountById: (
    context: HouseholdContext,
    accountId: string,
  ) => Promise<AccountRecord | null>;
  readonly declareAccount: (
    context: HouseholdContext,
    input: NewAccount,
  ) => Promise<AccountRecord>;
};

export type ImportDependencies = {
  readonly parser: StatementParser;
  readonly imports: ImportRepositoryPort;
  readonly accounts: AccountsGateway;
};
