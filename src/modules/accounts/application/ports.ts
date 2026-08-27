// Ports of the accounts module. Use cases depend on these interfaces
// only; the Prisma implementation lives in adapters/account-repository.ts
// and tests provide in-memory fakes.

import type { HouseholdContext } from "@/platform/tenancy";
import type { AccountRole } from "../domain/account-role";

export type AccountRecord = {
  readonly id: string;
  readonly label: string;
  readonly bank: string;
  readonly role: AccountRole;
  readonly iban?: string;
};

export type NewAccount = {
  readonly label: string;
  readonly bank: string;
  readonly role: AccountRole;
  readonly iban?: string;
};

export type AccountRepositoryPort = {
  readonly createAccount: (
    context: HouseholdContext,
    input: NewAccount,
  ) => Promise<AccountRecord>;
  // Setup registers EVERY account in one submission (M3-P14), so the
  // declaration rows land in one write rather than eight: a submission
  // that half-lands would leave the household in exactly the state this
  // phase exists to remove, with some siblings registered and the rest
  // still offered as merchants.
  readonly createAccounts: (
    context: HouseholdContext,
    input: readonly NewAccount[],
  ) => Promise<readonly AccountRecord[]>;
  // The ONE declaration column this module updates. It writes no
  // transaction column and this port carries no function that could
  // (criterion 14.8).
  readonly updateAccountRole: (
    context: HouseholdContext,
    accountId: string,
    role: AccountRole,
  ) => Promise<void>;
  readonly listAccounts: (
    context: HouseholdContext,
  ) => Promise<readonly AccountRecord[]>;
  readonly findAccountByIban: (
    context: HouseholdContext,
    iban: string,
  ) => Promise<AccountRecord | null>;
  readonly getAccountById: (
    context: HouseholdContext,
    accountId: string,
  ) => Promise<AccountRecord | null>;
};

// THE LEDGER EDGE, as a port rather than an import (M3-P14). Two questions
// and no more: rebuild the interpretation, and does this account carry
// imported rows of its own.
//
// WHY IT IS A PORT AND WHERE IT IS BOUND. The ledger module's composition
// root already imports the accounts module's published interface
// (src/modules/ledger/application/index.ts), so binding the reverse edge
// in THIS module's index would make two module indexes import each other
// at evaluation time. The binding therefore happens one layer out, in this
// module's own UI actions (src/modules/accounts/ui/actions.ts), which is
// the composition point for this edge. Tests bind an in-memory fake.
export type AccountsLedgerGateway = {
  // The ledger's PUBLISHED recompute (recomputeInterpretation): a whole
  // rebuild of the interpretation layer from facts plus declarations.
  // Called exactly once after a declaration write, never per row.
  readonly recompute: (context: HouseholdContext) => Promise<void>;
  // Whether this account carries imported fact rows of its own. Read
  // only: nothing in this module may write a transaction column.
  readonly hasImportedRows: (
    context: HouseholdContext,
    accountId: string,
  ) => Promise<boolean>;
};

export type AccountsSetupDependencies = {
  readonly accounts: AccountRepositoryPort;
  readonly ledger: AccountsLedgerGateway;
};
