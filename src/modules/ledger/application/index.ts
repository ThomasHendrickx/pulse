// The ledger module's PUBLISHED interface (pulse-domain section 9), and
// its composition root: use cases depend on the ports in ports.ts, and
// this index binds them to the Prisma adapter and to the accounts module's
// published application interface. Tests exercise the use cases against
// in-memory fakes of the same ports, never this binding.

import type { HouseholdContext } from "@/platform/tenancy";
import { listAccounts } from "@/modules/accounts/application";
import { resolveIdentities } from "@/modules/merchants/application";
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
  MerchantResolverPort,
} from "./ports";
export type { Flow } from "../domain/flow";
export type {
  DeclaredAccount,
  LedgerTransaction,
} from "../domain/ledger-transaction";
export { interpretLedger } from "../domain/interpret";
// The cash-withdrawal marker, published for the month projection (M1-P5,
// resolving M1-P4 open question M1P4-C7): the overview groups cash rows
// under their own destination with precedence over merchant assignment,
// consuming ONE pattern list rather than duplicating it. See the sibling
// note at the patterns' definition in ../domain/constants.ts.
export {
  CASH_WITHDRAWAL_PATTERNS,
  isCashWithdrawalDescription,
} from "../domain/constants";
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
    listOutgoingCounterpartyRefs: repository.listOutgoingCounterpartyRefs,
    listCardStatementTotals: repository.listCardStatementTotals,
    importPeriod: repository.importPeriod,
    replaceInterpretation: repository.replaceInterpretation,
  },
  // The MerchantResolver port, bound to the merchants module's PUBLISHED
  // rules-only resolver (RuleResolver). Read-only by port shape: this is
  // the whole merchants surface interpretation gets (criterion 3.2).
  merchants: {
    resolveIdentities: (context, identityKeys) =>
      resolveIdentities(context, identityKeys),
  },
};

// Interpretation over the period window an import affects, across all pot
// accounts. Called by the import module after every successful ingest.
export const interpretForImport = (
  context: HouseholdContext,
  importId: string,
): Promise<InterpretationSummary | null> =>
  interpretForImportUseCase(context, liveDependencies, importId);

// Whether an account carries imported fact rows of its own (M3-P14). A
// read on the ledger's own tables, published because the accounts module
// needs the answer to refuse a ring change (decision D-51) and may not
// reach into another module's repository (pulse-domain section 9).
export const hasImportedRows = (
  context: HouseholdContext,
  accountId: string,
): Promise<boolean> => repository.hasImportedRows(context, accountId);

// Recompute: the same step over everything, no import attached. One
// internal dev-only action (pulse-v1-architecture.md).
export const recomputeInterpretation = (
  context: HouseholdContext,
): Promise<InterpretationSummary> => recomputeUseCase(context, liveDependencies);
