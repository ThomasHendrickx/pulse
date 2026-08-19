// Ports of the ledger module. The use cases depend on these interfaces
// only; adapters/ledger-repository.ts implements the repository over
// Prisma, the composition root binds the accounts gateway to the accounts
// module's PUBLISHED application interface, and tests run the use cases
// against in-memory fakes.

import type { PlainDate } from "@/platform/plain-date";
import type { HouseholdContext } from "@/platform/tenancy";
import type { Flow } from "../domain/flow";
import type {
  DeclaredAccount,
  LedgerTransaction,
} from "../domain/ledger-transaction";

// The declaration-layer slice the engine needs: every account with its
// ring and IBAN, satisfied by the accounts module's published interface.
export type LedgerAccountsGateway = {
  readonly listAccounts: (
    context: HouseholdContext,
  ) => Promise<readonly DeclaredAccount[]>;
};

export type InterpretationLinkWrite = {
  readonly outgoingTransactionId: string;
  readonly incomingTransactionId?: string;
  readonly settlementImportId?: string;
};

export type LedgerRepositoryPort = {
  // Fact rows over the given pot accounts, optionally bounded by booking
  // date (both bounds inclusive). No bounds means everything: recompute.
  readonly listPotTransactions: (
    context: HouseholdContext,
    input: {
      readonly accountIds: readonly string[];
      readonly from?: PlainDate;
      readonly to?: PlainDate;
    },
  ) => Promise<readonly LedgerTransaction[]>;
  // The booking-date span of one import's fact rows; null when the import
  // has no rows.
  readonly importPeriod: (
    context: HouseholdContext,
    importId: string,
  ) => Promise<{ readonly from: PlainDate; readonly to: PlainDate } | null>;
  // Atomic interpretation rewrite for the interpreted set: every transfer
  // link touching one of the transactions is deleted, the new links are
  // inserted, every flow is written, and the named imports move
  // INGESTED -> INTERPRETED, in one database transaction. Interpretation
  // is derived state: this rewrite touches NO fact column.
  readonly replaceInterpretation: (
    context: HouseholdContext,
    input: {
      readonly transactionIds: readonly string[];
      readonly flows: readonly {
        readonly transactionId: string;
        readonly flow: Flow;
      }[];
      readonly links: readonly InterpretationLinkWrite[];
      readonly interpretedImportIds: readonly string[];
    },
  ) => Promise<void>;
};

export type LedgerDependencies = {
  readonly accounts: LedgerAccountsGateway;
  readonly ledger: LedgerRepositoryPort;
};
