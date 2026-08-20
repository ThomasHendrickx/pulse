// Ports of the ledger module. The use cases depend on these interfaces
// only; adapters/ledger-repository.ts implements the repository over
// Prisma, the composition root binds the accounts gateway to the accounts
// module's PUBLISHED application interface, and tests run the use cases
// against in-memory fakes.

import type { PlainDate } from "@/platform/plain-date";
import type { HouseholdContext } from "@/platform/tenancy";
import type { CounterpartyRef } from "../domain/corrections";
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

// The MerchantResolver port (pulse-domain section 9's named port). ONE
// member, deliberately and load-bearingly: the interpret use case may ASK
// which merchant a counterparty string resolves to, and can do nothing
// else to the merchants module. In particular it has no rule repository
// dependency, so no code path in interpretation can write a MerchantRule,
// by construction (criterion 3.2, hazard H3.1; pulse-domain section 2
// rule 3: recompute never writes to the declarations layer, even when it
// looks like caching). test/application/resolve-merchants.test.ts asserts
// this port's key set stays exactly this.
export type MerchantResolverPort = {
  // Distinct raw counterparty texts in, merchant assignments out; the
  // resolver normalises internally and unresolved texts are absent from
  // the map. Bound to the merchants module's rules-only resolver until
  // slice 5 adds the LLM step behind this same port.
  readonly resolveCounterparties: (
    context: HouseholdContext,
    texts: readonly string[],
  ) => Promise<ReadonlyMap<string, string>>;
};

export type InterpretationMerchantWrite = {
  readonly transactionId: string;
  // Null CLEARS a stale assignment: interpretation output is rebuilt
  // wholesale, so an assignment that no rule supports any more stops
  // applying instead of lingering.
  readonly merchantId: string | null;
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
  // Every outgoing (negative) row's counterparty fields over the given
  // accounts, UNBOUNDED: the refund correction's history is scope-free
  // (finding CR-303), so window runs read it from the whole ledger.
  readonly listOutgoingCounterpartyRefs: (
    context: HouseholdContext,
    input: { readonly accountIds: readonly string[] },
  ) => Promise<readonly CounterpartyRef[]>;
  // The booking-date span of one import's fact rows; null when the import
  // has no rows.
  readonly importPeriod: (
    context: HouseholdContext,
    importId: string,
  ) => Promise<{ readonly from: PlainDate; readonly to: PlainDate } | null>;
  // Atomic interpretation rewrite for the interpreted set: every transfer
  // link touching one of the transactions is deleted, the new links are
  // inserted, every flow and merchant assignment is written, and the named
  // imports move INGESTED -> INTERPRETED, in one database transaction.
  // Interpretation is derived state: this rewrite touches NO fact column
  // and NO declaration table.
  readonly replaceInterpretation: (
    context: HouseholdContext,
    input: {
      readonly transactionIds: readonly string[];
      readonly flows: readonly {
        readonly transactionId: string;
        readonly flow: Flow;
      }[];
      readonly merchants: readonly InterpretationMerchantWrite[];
      readonly links: readonly InterpretationLinkWrite[];
      readonly interpretedImportIds: readonly string[];
    },
  ) => Promise<void>;
};

export type LedgerDependencies = {
  readonly accounts: LedgerAccountsGateway;
  readonly ledger: LedgerRepositoryPort;
  readonly merchants: MerchantResolverPort;
};
