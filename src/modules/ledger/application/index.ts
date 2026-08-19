// The ledger module's PUBLISHED interface (pulse-domain section 9), and
// its composition root: use cases depend on the ports in ports.ts, and
// this index binds them to the Prisma adapter and to the accounts module's
// published application interface. Tests exercise the use cases against
// in-memory fakes of the same ports, never this binding.

import type { HouseholdContext } from "@/platform/tenancy";
import { listAccounts } from "@/modules/accounts/application";
import * as repository from "../adapters/ledger-repository";
import {
  interpretForImport as interpretForImportUseCase,
  recomputeInterpretation as recomputeUseCase,
  type InterpretationSummary,
} from "./interpret-window";
import type { LedgerDependencies } from "./ports";

export type { InterpretationSummary } from "./interpret-window";
export type {
  LedgerAccountsGateway,
  LedgerDependencies,
  LedgerRepositoryPort,
} from "./ports";
export type { Flow } from "../domain/flow";
export type {
  DeclaredAccount,
  LedgerTransaction,
} from "../domain/ledger-transaction";
export { interpretLedger } from "../domain/interpret";
export { reconcile, type ReconciliationReport } from "../domain/reconciliation";
export {
  interpretForImport as interpretForImportWith,
  interpretWindow,
  recomputeInterpretation as recomputeInterpretationWith,
} from "./interpret-window";

const liveDependencies: LedgerDependencies = {
  accounts: {
    listAccounts: async (context) =>
      (await listAccounts(context)).map((account) => ({
        id: account.id,
        role: account.role,
        ...(account.iban === undefined ? {} : { iban: account.iban }),
      })),
  },
  ledger: {
    listPotTransactions: repository.listPotTransactions,
    importPeriod: repository.importPeriod,
    replaceInterpretation: repository.replaceInterpretation,
  },
};

// Interpretation over the period window an import affects, across all pot
// accounts. Called by the import module after every successful ingest.
export const interpretForImport = (
  context: HouseholdContext,
  importId: string,
): Promise<InterpretationSummary | null> =>
  interpretForImportUseCase(context, liveDependencies, importId);

// Recompute: the same step over everything, no import attached. One
// internal dev-only action (pulse-v1-architecture.md).
export const recomputeInterpretation = (
  context: HouseholdContext,
): Promise<InterpretationSummary> => recomputeUseCase(context, liveDependencies);
