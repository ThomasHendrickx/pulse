// The accounts module's PUBLISHED interface. Other modules import from
// here and from nowhere else inside this module (pulse-domain section 9).
//
// This file is also the module's composition root: use-case logic depends
// on the ports in ports.ts, and this index binds them to the Prisma
// adapter. Tests exercise the same signatures against in-memory fakes of
// the ports, never against this composed binding.

import type { Result } from "@/platform/result";
import type { HouseholdContext } from "@/platform/tenancy";
import * as repository from "../adapters/account-repository";
import type {
  AccountRecord,
  AccountRepositoryPort,
  AccountsLedgerGateway,
  NewAccount,
} from "./ports";
import {
  changeAccountRing as changeAccountRingUseCase,
  type ChangeAccountRingFailure,
} from "./change-account-ring";
import {
  registerAccounts as registerAccountsUseCase,
  type RegisterAccountsFailure,
  type RegisterAccountsOutcome,
} from "./register-accounts";
import type { AccountRegistrationInput } from "../domain/account-registration";
import type { AccountRole } from "../domain/account-role";

export type {
  AccountRecord,
  AccountRepositoryPort,
  AccountsLedgerGateway,
  AccountsSetupDependencies,
  NewAccount,
} from "./ports";
export type { AccountRole } from "../domain/account-role";
export { parseAccountRole } from "../domain/account-role";
export type {
  AccountRegistrationInput,
  AccountRegistrationProblem,
  AccountRegistrationRowProblem,
} from "../domain/account-registration";
export { validateAccountRegistration } from "../domain/account-registration";
export type { RegisterAccountsFailure, RegisterAccountsOutcome } from "./register-accounts";
export type { ChangeAccountRingFailure } from "./change-account-ring";
// The use cases with their dependencies still open, for the fast-gate
// tests, which run them against in-memory fakes rather than this binding.
export { registerAccounts as registerAccountsWith } from "./register-accounts";
export { changeAccountRing as changeAccountRingWith } from "./change-account-ring";

const liveRepository: AccountRepositoryPort = {
  createAccount: repository.createAccount,
  createAccounts: repository.createAccounts,
  updateAccountRole: repository.updateAccountRole,
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

// SETUP: every account the household owns, registered in one submission
// (M3-P14). The LEDGER half of the dependencies is passed IN rather than
// bound here, because the ledger's own composition root already imports
// this file and two module indexes importing each other at evaluation time
// is a cycle. This module's UI actions bind it; see the note on
// AccountsLedgerGateway in ports.ts.
export const registerAccounts = (
  context: HouseholdContext,
  ledger: AccountsLedgerGateway,
  input: { readonly rows: readonly AccountRegistrationInput[] },
): Promise<Result<RegisterAccountsOutcome, RegisterAccountsFailure>> => registerAccountsUseCase(context, { accounts: liveRepository, ledger }, input);

// The one ring correction v1 allows, refused for an account that already
// carries its own imported rows (decision D-51, criterion 14.8).
export const changeAccountRing = (
  context: HouseholdContext,
  ledger: AccountsLedgerGateway,
  input: { readonly accountId: string; readonly role: AccountRole },
): Promise<Result<{ readonly accountId: string }, ChangeAccountRingFailure>> => changeAccountRingUseCase(context, { accounts: liveRepository, ledger }, input);
