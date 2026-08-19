// The accounts module's PUBLISHED interface. Other modules import from
// here and from nowhere else inside this module (pulse-domain section 9).
//
// This file is also the module's composition root: use-case logic depends
// on the ports in ports.ts, and this index binds them to the Prisma
// adapter. Tests exercise the same signatures against in-memory fakes of
// the ports, never against this composed binding.

import type { HouseholdContext } from "@/platform/tenancy";
import * as repository from "../adapters/account-repository";
import type { AccountRecord, AccountRepositoryPort, NewAccount } from "./ports";

export type { AccountRecord, AccountRepositoryPort, NewAccount } from "./ports";
export type { AccountRole } from "../domain/account-role";
export { parseAccountRole } from "../domain/account-role";

const liveRepository: AccountRepositoryPort = {
  createAccount: repository.createAccount,
  listAccounts: repository.listAccounts,
  findAccountByIban: repository.findAccountByIban,
  getAccountById: repository.getAccountById,
};

// Declaring an account is a pure declaration-layer write: the user names
// the account and its ring at first sight (label, bank, role, optionally
// the IBAN the file identified it by).
export const declareAccount = (
  context: HouseholdContext,
  input: NewAccount,
): Promise<AccountRecord> => liveRepository.createAccount(context, input);

// The declaration-layer read the ledger engine classifies against: every
// account with its ring and IBAN (M1-P3).
export const listAccounts = (
  context: HouseholdContext,
): Promise<readonly AccountRecord[]> => liveRepository.listAccounts(context);

export const findAccountByIban = (
  context: HouseholdContext,
  iban: string,
): Promise<AccountRecord | null> =>
  liveRepository.findAccountByIban(context, iban);

export const getAccountById = (
  context: HouseholdContext,
  accountId: string,
): Promise<AccountRecord | null> =>
  liveRepository.getAccountById(context, accountId);
