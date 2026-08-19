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
  // Conditional transition to FAILED, claimed only from
  // AWAITING_DECLARATION (finding F4: no unconditional status writes).
  // Returns whether this caller made the transition; false means another
  // writer got there first. Never touches transaction rows.
  readonly markImportFailed: (
    context: HouseholdContext,
    importId: string,
    reason: ImportFailureReason,
) => Promise<boolean>;
  readonly getProfile: (
    context: HouseholdContext,
    profileId: string,
  ) => Promise<StoredProfile | null>;
  // Imports whose facts were parsed with the given profile and have
  // reached the ledger (INGESTED or INTERPRETED): the set a profile fix
  // must re-parse.
  readonly listImportIdsForProfile: (
    context: HouseholdContext,
    profileId: string,
  ) => Promise<readonly string[]>;
  // The stored fact rows of one import, reduced to what a re-parse needs:
  // identity, account and the verbatim source line. Deterministic order.
  readonly listFactRowsForImport: (
    context: HouseholdContext,
    importId: string,
  ) => Promise<
    readonly {
      readonly id: string;
      readonly accountId: string;
      readonly rawLine: string;
    }[]
  >;
  // THE ONE SANCTIONED FACTS REBUILD (pulse-domain section 2, the explicit
  // SourceProfile exception; hazard H1.3/H2.5): atomically replaces the
  // profile's spec AND rewrites the fact columns of every listed row from
  // its re-parsed rawLine, preserving row identity, importId, accountId
  // and rawLine itself. Declarations (accounts, profile name and binding)
  // are untouched; dedup keys are recomputed so re-uploads keep mapping
  // onto the same rows. All-or-nothing: a failure writes no row.
  readonly applyReparse: (
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
  ) => Promise<void>;
  // Transactional AND guarded (finding F4): the import row is claimed by
  // a conditional update from `fromStatus` FIRST, inside the same
  // database transaction as the row insert, so two racing ingests of one
  // import cannot both land. The loser gets not-in-expected-status and
  // writes nothing. The insert itself skips duplicate dedup keys in one
  // statement, never a read-then-write loop.
  readonly ingestRows: (
    context: HouseholdContext,
    input: {
      readonly importId: string;
      readonly accountId: string;
      readonly sourceProfileId: string;
      readonly fromStatus: ImportStatus;
      readonly rows: readonly IngestRow[];
    },
  ) => Promise<
    | { readonly ok: true; readonly added: number; readonly known: number }
    | { readonly ok: false; readonly error: "not-in-expected-status" }
  >;
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
  // The interpret stage of the pipeline (parse -> identify -> declare ->
  // ingest -> interpret): after a successful ingest, the ledger re-runs
  // interpretation over the affected period window across all pot
  // accounts, so an unmatched transfer leg heals on the next upload.
  // Bound to the ledger module's published application interface.
  readonly interpret: (
    context: HouseholdContext,
    importId: string,
  ) => Promise<void>;
};
