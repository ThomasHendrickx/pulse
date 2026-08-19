// The import module's PUBLISHED interface (pulse-domain section 9), and
// its composition root: the use cases depend on the ports in ports.ts,
// and this index binds them to the real adapters. Tests exercise the use
// cases against in-memory fakes of the same ports, never this binding.

import type { HouseholdContext } from "@/platform/tenancy";
import {
  declareAccount,
  findAccountByIban,
  getAccountById,
} from "@/modules/accounts/application";
import { interpretForImport } from "@/modules/ledger/application";
import { delimitedFileParser } from "../adapters/delimited-file-parser";
import * as repository from "../adapters/import-repository";
import type { NewAccount } from "@/modules/accounts/application";
import type { SourceProfileSpec } from "../domain/source-profile";
import { confirmImport as confirmImportUseCase, type ConfirmOutcome } from "./confirm-import";
import {
  findProfileBySpec,
  uploadStatement as uploadStatementUseCase,
  type UploadOutcome,
} from "./upload-statement";
import {
  fixSourceProfile as fixSourceProfileUseCase,
  type FixProfileError,
  type FixProfileResult,
} from "./fix-profile";
import type { Result } from "@/platform/result";
import type { ImportDependencies, ImportRecord } from "./ports";

export type { ConfirmOutcome } from "./confirm-import";
export type { FixProfileError, FixProfileResult } from "./fix-profile";
export type { UploadOutcome } from "./upload-statement";
export type {
  ImportFailureReason,
  ImportRecord,
  ImportStatus,
  StoredProfile,
} from "./ports";
export type { SourceProfileSpec } from "../domain/source-profile";
export { parseSourceProfileSpec } from "../domain/source-profile";
export { detectSourceProfile } from "../domain/detect-profile";
export { parseStatement, type ParsedRow } from "../domain/parse-statement";

const liveDependencies: ImportDependencies = {
  parser: delimitedFileParser,
  imports: {
    createImport: repository.createImport,
    getImport: repository.getImport,
    listProfiles: repository.listProfiles,
    createProfile: repository.createProfile,
    getProfile: repository.getProfile,
    listImportIdsForProfile: repository.listImportIdsForProfile,
    listFactRowsForImport: repository.listFactRowsForImport,
    applyReparse: repository.applyReparse,
    markImportFailed: repository.markImportFailed,
    ingestRows: repository.ingestRows,
  },
  accounts: { findAccountByIban, getAccountById, declareAccount },
  interpret: async (context, importId) => {
    await interpretForImport(context, importId);
  },
};

export const uploadStatement = (
  context: HouseholdContext,
  input: { readonly fileName: string; readonly bytes: Uint8Array },
): Promise<UploadOutcome> =>
  uploadStatementUseCase(context, liveDependencies, input);

export const confirmImport = (
  context: HouseholdContext,
  input: {
    readonly importId: string;
    readonly profileName: string;
    readonly spec: SourceProfileSpec;
    readonly declaration?: NewAccount;
  },
): Promise<ConfirmOutcome> =>
  confirmImportUseCase(context, liveDependencies, input);

// Which stored profile a detected spec resolves to, so the confirmation
// screen can name the landing account the ingest will actually use
// (finding F1, transparency).
export const findProfileForSpec = (
  context: HouseholdContext,
  spec: SourceProfileSpec,
) => findProfileBySpec(context, liveDependencies, spec);

// The profile-fix re-parse: repairs facts written under a wrong spec from
// each row's stored rawLine, then re-runs interpretation over the
// affected imports (hazard H1.3/H2.5, criterion 2.7).
export const fixSourceProfile = (
  context: HouseholdContext,
  input: { readonly profileId: string; readonly spec: SourceProfileSpec },
): Promise<Result<FixProfileResult, FixProfileError>> =>
  fixSourceProfileUseCase(context, liveDependencies, input);

export const getImport = (
  context: HouseholdContext,
  importId: string,
): Promise<ImportRecord | null> => repository.getImport(context, importId);

export const listImports = (
  context: HouseholdContext,
): Promise<readonly ImportRecord[]> => repository.listImports(context);
