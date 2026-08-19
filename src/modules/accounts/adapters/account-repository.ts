// Prisma repository for the accounts module. Every function takes the
// household context explicitly and filters on householdId (CLAUDE.md
// non-negotiable 6); the static tenancy gate holds this file to that rule.

import { prisma } from "@/platform/db/client";
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
      iban: input.iban ?? null,
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

export const findAccountByIban = async (
  context: HouseholdContext,
  iban: string,
): Promise<AccountRecord | null> => {
  const row = await prisma.account.findFirst({
    where: { householdId: context.householdId, iban },
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
