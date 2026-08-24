// Prisma repository for the accounts module. Every function takes the
// household context explicitly and filters on householdId (CLAUDE.md
// non-negotiable 6); the static tenancy gate holds this file to that rule.

import { prisma } from "@/platform/db/client";
import { canonicalAccountNumber } from "@/platform/account-number";
import type { HouseholdContext } from "@/platform/tenancy";
import type { AccountRole } from "../domain/account-role";
import type { AccountRecord, NewAccount } from "../application/ports";

type AccountRow = {
  readonly id: string;
  readonly label: string;
  readonly bank: string;
  readonly role: AccountRole;
  readonly iban: string | null;
};

const toRecord = (row: AccountRow): AccountRecord => ({
  id: row.id,
  label: row.label,
  bank: row.bank,
  role: row.role,
  ...(row.iban === null ? {} : { iban: row.iban }),
});

// A DECLARATION IS NORMALISED ON THE WAY IN (M3-P14, decision D-47). Every
// writer of Account.iban goes through here, so the column holds ONE form
// tree-wide. The rule and its sibling list live at
// src/platform/account-number.ts.
export const createAccount = async (
  context: HouseholdContext,
  input: NewAccount,
): Promise<AccountRecord> => {
  const row = await prisma.account.create({
    data: {
      householdId: context.householdId,
      label: input.label,
      bank: input.bank,
      role: input.role,
      iban:
        input.iban === undefined ? null : canonicalAccountNumber(input.iban),
    },
  });
  return toRecord(row);
};

export const listAccounts = async (
  context: HouseholdContext,
): Promise<readonly AccountRecord[]> => {
  const rows = await prisma.account.findMany({
    where: { householdId: context.householdId },
    orderBy: { createdAt: "asc" },
  });
  return rows.map(toRecord);
};

// THE LOOKUP THAT MAKES ADOPTION WORK (M3-P14 criterion 14.3). A later
// import of an account the household already registered must resolve to the
// SAME account, whatever surface form the file writes it in. Account.iban is
// a DECLARATION and is stored canonical by every writer, so canonicalising
// the argument is the whole mechanism; the per-household uniqueness
// constraint at prisma/schema/accounts.prisma:28 is the backstop behind it.
export const findAccountByIban = async (
  context: HouseholdContext,
  iban: string,
): Promise<AccountRecord | null> => {
  const row = await prisma.account.findFirst({
    where: {
      householdId: context.householdId,
      iban: canonicalAccountNumber(iban),
    },
  });
  return row === null ? null : toRecord(row);
};

export const getAccountById = async (
  context: HouseholdContext,
  accountId: string,
): Promise<AccountRecord | null> => {
  const row = await prisma.account.findFirst({
    where: { householdId: context.householdId, id: accountId },
  });
  return row === null ? null : toRecord(row);
};

// THE RING CORRECTION, AS A DECLARATION EDIT (M3-P15). ONE declaration
// column is written and nothing else: no transaction row is touched here or
// anywhere on the correction path, because a wrong interpretation is
// repaired by changing the declaration and recomputing, never by rewriting
// a stored row (pulse-domain section 2 rule 1). The recompute is the
// caller's, so this function has no engine dependency and cannot acquire
// one by accident.
export const updateAccountRole = async (
  context: HouseholdContext,
  accountId: string,
  role: AccountRole,
): Promise<AccountRecord | null> => {
  const updated = await prisma.account.updateMany({
    where: { householdId: context.householdId, id: accountId },
    data: { role },
  });
  if (updated.count === 0) {
    return null;
  }
  return getAccountById(context, accountId);
};

// WHETHER A STATEMENT HAS EVER BEEN IMPORTED FOR EACH ACCOUNT, for the
// accounts screen's list. A COUNT OF IMPORTS AND NEVER AN AMOUNT: nothing on
// that screen may be readable as how much is in savings, which is decision
// D-60, and nothing here sums or counts money at all.
export const listAccountsWithImportState = async (
  context: HouseholdContext,
): Promise<readonly (AccountRecord & { readonly hasImport: boolean })[]> => {
  const rows = await prisma.account.findMany({
    where: { householdId: context.householdId },
    orderBy: { createdAt: "asc" },
    include: { imports: { select: { id: true }, take: 1 } },
  });
  return rows.map((row) => ({
    ...toRecord(row),
    hasImport: row.imports.length > 0,
  }));
};
