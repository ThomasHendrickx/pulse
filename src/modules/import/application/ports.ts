// Ports of the import module. The use cases depend on these interfaces
// only. The StatementParser port is implemented by the ONE statement
// parser adapter, which routes delimited bytes through the generic
// spec-driven parser (no per-bank CSV parsers, pulse-domain section 5)
// and PDF bytes through code-owned layout templates selected by
// fingerprint (v0.2 addendum section 1, decision D-2); the repository
// port is implemented over Prisma in adapters/, and tests run the use
// cases against in-memory fakes.

import type { HouseholdContext } from "@/platform/tenancy";
import type { Result } from "@/platform/result";
import type { AccountRecord, NewAccount } from "@/modules/accounts/application";
import type { DetectionError } from "../domain/detect-profile";
import type {
  ParsedStatement,
  StatementParseError,
} from "../domain/parse-statement";
import type { PdfStatementParseError } from "../domain/parse-pdf-statement";
import type { PdfExtractionError } from "../adapters/pdf-text-extractor";
import type { SourceProfileSpec } from "../domain/source-profile";
import type { ParsedRow } from "../domain/parse-statement";

// A PDF whose bytes match no registered layout template: failed loudly
// upstream as layout-unsupported, never asked of the user
// (pulse-v0.2-pdf-addendum.md:27, decision D-5).
export type LayoutUnsupportedError = { readonly kind: "layout-unsupported" };

// Fix round 1 (HZ-003): an unreadable PDF (corrupt or truncated bytes)
// is a distinct failure from an unrecognised layout, on detect and on
// parse alike, so a build or packaging regression class diagnoses
// itself instead of reading as bank drift.
export type StatementDetectError =
  | DetectionError
  | LayoutUnsupportedError
  | PdfExtractionError;

export type StatementParseFailure =
  | StatementParseError
  | PdfStatementParseError
  | PdfExtractionError;

// Both methods return Promises: DR-0020's extraction library (pdfjs-dist)
// is Promise-based end to end with no synchronous entry point, so the
// port's RETURN TYPES are asynchronous while its shape (detect bytes to
// spec, parse bytes plus spec to statement, one port, no parallel PDF
// port) stands as D-2 fixed it. The delimited path stays a pure
// synchronous computation wrapped in a resolved Promise.
export type StatementParser = {
  readonly detect: (
    bytes: Uint8Array,
  ) => Promise<Result<SourceProfileSpec, StatementDetectError>>;
  readonly parse: (
    bytes: Uint8Array,
    spec: SourceProfileSpec,
  ) => Promise<Result<ParsedStatement, StatementParseFailure>>;
};

export type ImportStatus =
  | "PARSED"
  | "AWAITING_DECLARATION"
  | "INGESTED"
  | "INTERPRETED"
  | "FAILED";

// Machine-readable failure tags; the UI translates them (never English
// sentences in error values, pulse-typescript section 5). D-5: the two
// PDF-era reasons are "layout-unsupported" (a PDF matching no registered
// template) and "balance-mismatch" (a recognised statement whose opening
// plus transaction sum does not equal its closing, the addendum's hard
// gate); both fail the import with zero rows written.
export type ImportFailureReason =
  | "mixed-accounts"
  | "undetectable"
  | "unparseable"
  | "layout-unsupported"
  | "balance-mismatch"
  // Fix round 1: corrupt or truncated PDF bytes (HZ-003), and a stored
  // pdf-layout profile whose template version this build does not carry
  // (HZ-002, fail closed until a migration).
  | "extraction-failed"
  | "layout-version-mismatch";

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
  // The statement's own settlement figure, SIGNED integer cents, for a
  // layout that prints one (finding HZ-M3P3-01). Absent otherwise. Signed
  // rather than positive because a card standing in credit prints a
  // figure owed to the household (finding HZ2-M3P3-05).
  readonly settlementTotalCents?: number;
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
  // identity, account, the verbatim source line, and the current dedup key
  // (finding CR-302: stored twins are ranked by their existing key when
  // the re-parse re-derives keys from the full file). Deterministic order.
  readonly listFactRowsForImport: (
    context: HouseholdContext,
    importId: string,
  ) => Promise<
    readonly {
      readonly id: string;
      readonly accountId: string;
      readonly rawLine: string;
      readonly dedupKey: string;
    }[]
  >;
  // THE ONE SANCTIONED FACTS REBUILD (pulse-domain section 2, the explicit
  // SourceProfile exception; hazard H1.3/H2.5): atomically replaces the
  // profile's spec AND rewrites the fact columns of every listed row from
  // its re-parsed rawLine, preserving row identity, importId, accountId
  // and rawLine itself. Declarations (accounts, profile name and binding)
  // are untouched. All-or-nothing: a failure writes no row. CORRECTED
  // RATHER THAN QUIETLY REWRITTEN (finding CR-302, R-087): this contract
  // used to say dedup keys are recomputed so re-uploads keep mapping onto
  // the same rows, which was FALSE when an import stored a proper subset
  // of its file's rows (overlap around a keyless twin renumbered onto an
  // occupied key and the unique index aborted the repair). The keys the
  // caller passes are now derived from the FULL re-parsed file with
  // ingest's cross-import insert-ignore semantics (see fix-profile.ts).
  // ALSO IN THIS TRANSACTION (finding CR-304): every affected import
  // moves INTERPRETED -> INGESTED, because the facts rewrite invalidates
  // the stored interpretation; the reinterpretation that follows is what
  // restores INTERPRETED, and a death between the two leaves the same
  // visible needs-interpretation marker the upload path has.
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
        // The RE-PARSED settlement figure (fix round 3, finding
        // HZ2-M3P3-04). The column is a fact of the document, so the one
        // sanctioned facts rebuild rebuilds it too, in the same
        // transaction as the rows it belongs to. Absent means the
        // re-parse produced none and the stored value is cleared, so a
        // figure can never outlive the reading that produced it.
        readonly settlementTotalCents?: number;
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
      // Written on the import row inside the SAME transaction as the
      // rows, because it is a fact of the same document and must never
      // exist without them (finding HZ-M3P3-01). Absent for a statement
      // that prints no such figure.
      readonly settlementTotalCents?: number;
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
