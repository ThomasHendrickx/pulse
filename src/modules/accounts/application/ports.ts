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
  // THE RING CORRECTION (M3-P15). A DECLARATION EDIT and nothing else: it
  // writes ONE declaration column and the caller then calls the ledger's
  // published recompute, which is the same shape as naming a merchant. No
  // path here writes a transaction row, and a correction is never a row
  // rewrite (pulse-domain section 2 rule 1, hazard H15.1).
  // Whether a statement has ever been imported for each account. A count
  // of imports and never an amount (decision D-60).
  readonly listAccountsWithImportState: (
    context: HouseholdContext,
  ) => Promise<readonly (AccountRecord & { readonly hasImport: boolean })[]>;
  readonly updateAccountRole: (
    context: HouseholdContext,
    accountId: string,
    role: AccountRole,
  ) => Promise<AccountRecord | null>;
};

// The recompute the ledger publishes, injected as an explicit argument the
// way assignMerchant takes it, so the accounts module never imports the
// ledger module and no cycle exists.
export type RecomputeInterpretation = (
  context: HouseholdContext,
) => Promise<unknown>;

// The DRY RUN the ledger publishes (decision D-58): what a proposed
// declaration set would do, computed by the same interpretation the
// recompute runs, writing nothing.
export type DeclarationChangePreviewPort = (
  context: HouseholdContext,
  input: {
    readonly proposedAccounts: readonly {
      readonly id: string;
      readonly role: AccountRole;
      readonly iban?: string;
    }[];
    readonly subjectAccountId?: string;
  },
) => Promise<{
  readonly rowsOnAccount: number;
  readonly rowsOnAccountDirection: "stop-counting" | "start-counting" | "none";
  readonly spendDeltaCents: number;
  readonly reservesDeltaCents: number;
  readonly incomeDeltaCents: number;
  readonly merchantRulesStoppedMatching: number;
}>;
