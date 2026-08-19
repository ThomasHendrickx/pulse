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
  readonly findAccountByIban: (
    context: HouseholdContext,
    iban: string,
  ) => Promise<AccountRecord | null>;
  readonly getAccountById: (
    context: HouseholdContext,
    accountId: string,
  ) => Promise<AccountRecord | null>;
};
