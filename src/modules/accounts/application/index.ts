// The accounts module's PUBLISHED interface. Other modules import from
// here and from nowhere else inside this module (pulse-domain section 9).
//
// This file is also the module's composition root: use-case logic depends
// on the ports in ports.ts, and this index binds them to the Prisma
// adapter. Tests exercise the same signatures against in-memory fakes of
// the ports, never against this composed binding.

import type { HouseholdContext } from "@/platform/tenancy";
import * as repository from "../adapters/account-repository";
import type { Result } from "@/platform/result";
import type { AccountRole } from "../domain/account-role";
import {
  registerAccount as registerAccountUseCase,
  type RegisterAccountError,
  type RegisterAccountInput,
  type RegisterAccountOutcome,
} from "./register-account";
import {
  correctAccountRing as correctRingUseCase,
  previewAccountRingChange as previewRingUseCase,
  type CorrectAccountRingError,
  type CorrectAccountRingOutcome,
  type RingChangeMovement,
} from "./correct-account-ring";
import type {
  AccountRecord,
  AccountRepositoryPort,
  DeclarationChangePreviewPort,
  NewAccount,
  RecomputeInterpretation,
} from "./ports";

export type {
  AccountRecord,
  AccountRepositoryPort,
  DeclarationChangePreviewPort,
  NewAccount,
  RecomputeInterpretation,
} from "./ports";
export type {
  RegisterAccountError,
  RegisterAccountInput,
  RegisterAccountOutcome,
} from "./register-account";
export type {
  CorrectAccountRingError,
  CorrectAccountRingOutcome,
  RingChangeMovement,
} from "./correct-account-ring";
export { registerAccount as registerAccountWith } from "./register-account";
export {
  correctAccountRing as correctAccountRingWith,
  previewAccountRingChange as previewAccountRingChangeWith,
} from "./correct-account-ring";
export type { AccountRole } from "../domain/account-role";
export { parseAccountRole } from "../domain/account-role";

const liveRepository: AccountRepositoryPort = {
  createAccount: repository.createAccount,
  listAccounts: repository.listAccounts,
  findAccountByIban: repository.findAccountByIban,
  getAccountById: repository.getAccountById,
  updateAccountRole: repository.updateAccountRole,
  listAccountsWithImportState: repository.listAccountsWithImportState,
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

export const listAccountsWithImportState = (
  context: HouseholdContext,
): Promise<readonly (AccountRecord & { readonly hasImport: boolean })[]> =>
  liveRepository.listAccountsWithImportState(context);

export const getAccountById = (
  context: HouseholdContext,
  accountId: string,
): Promise<AccountRecord | null> =>
  liveRepository.getAccountById(context, accountId);

// THE TWO USE CASES THIS MODULE PUBLISHES WITH AN ENGINE DEPENDENCY, on the
// same terms assignMerchant takes its recompute: the ledger's composition
// root imports THIS module for its declared-set read, so importing the
// ledger back from here would be a module cycle. The UI action binds both
// arguments to the ledger's published interface (see the note at the top of
// src/modules/accounts/ui/actions.ts).

export const registerAccount = (
  context: HouseholdContext,
  input: RegisterAccountInput,
  engine: {
    readonly preview: DeclarationChangePreviewPort;
    readonly recompute: RecomputeInterpretation;
  },
): Promise<Result<RegisterAccountOutcome, RegisterAccountError>> =>
  registerAccountUseCase(
    context,
    { accounts: liveRepository, ...engine },
    input,
  );

export const previewAccountRingChange = (
  context: HouseholdContext,
  input: { readonly accountId: string; readonly role: AccountRole },
  engine: { readonly preview: DeclarationChangePreviewPort },
): Promise<Result<RingChangeMovement, CorrectAccountRingError>> =>
  previewRingUseCase(context, { accounts: liveRepository, ...engine }, input);

export const correctAccountRing = (
  context: HouseholdContext,
  input: { readonly accountId: string; readonly role: AccountRole },
  engine: {
    readonly preview: DeclarationChangePreviewPort;
    readonly recompute: RecomputeInterpretation;
  },
): Promise<Result<CorrectAccountRingOutcome, CorrectAccountRingError>> =>
  correctRingUseCase(context, { accounts: liveRepository, ...engine }, input);
