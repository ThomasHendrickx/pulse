// Prisma repository for the accounts module. Every function takes the
// household context explicitly and filters on householdId (CLAUDE.md
// non-negotiable 6); the static tenancy gate holds this file to that rule.

import { canonicalAccountNumber } from "@/platform/account-number";
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

// THE STORED FORM IS CANONICAL (M3-P14, criterion 14.4). Account.iban is a
// DECLARATION, so it may be normalised on the way in, and storing it
// canonical is what makes the per-household uniqueness constraint at
// prisma/schema/accounts.prisma a real backstop: one account written two
// ways would otherwise register twice. The stored counterparty column on a
// fact row is NOT normalised, which is why every comparison canonicalises
// both sides instead; see src/platform/account-number.ts.
const canonicalIban = (iban: string | undefined): string | null =>
  iban === undefined ? null : canonicalAccountNumber(iban);

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
      iban: canonicalIban(input.iban),
    },
  });
  return toRecord(row);
};

// ONE WRITE FOR THE WHOLE SUBMISSION (M3-P14): setup asks for every
// account at once, and a submission that half-lands leaves the household
// in the state this phase exists to remove. The transaction is what makes
// "all eight or none" true.
export const createAccounts = async (
  context: HouseholdContext,
  input: readonly NewAccount[],
): Promise<readonly AccountRecord[]> => {
  const rows = await prisma.$transaction(
    input.map((account) =>
      prisma.account.create({
        data: {
          householdId: context.householdId,
          label: account.label,
          bank: account.bank,
          role: account.role,
          iban: canonicalIban(account.iban),
        },
      }),
    ),
  );
  return rows.map(toRecord);
};

// The ONE declaration column this module updates. Filtered on the
// household like every query here (CLAUDE.md non-negotiable 6); an
// accountId belonging to another household matches nothing and writes
// nothing.
export const updateAccountRole = async (
  context: HouseholdContext,
  accountId: string,
  role: AccountRole,
): Promise<void> => {
  await prisma.account.updateMany({
    where: { householdId: context.householdId, id: accountId },
    data: { role },
  });
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

// CANONICAL ON BOTH SIDES (M3-P14, criterion 14.4). The caller passes the
// account number a FILE carries, which a Belgian statement prints spaced
// on one path and compact on another; the stored declaration is canonical.
// Comparing the raw strings answered "not registered" for an account that
// is.
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
