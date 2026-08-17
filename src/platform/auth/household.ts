import { prisma } from "../db/client";
import type { HouseholdContext } from "../tenancy";

// Household bootstrap and lookup. Creation happens once per sign-up, BEFORE
// a household context exists, so it is the one platform function keyed on
// the auth user rather than on a context. Everything after sign-up goes
// through HouseholdContext.

export const createHouseholdForNewUser = async (input: {
  readonly authUserId: string;
  readonly email: string;
}): Promise<void> => {
  const existing = await prisma.user.findUnique({ where: { id: input.authUserId } });
  if (existing) {
    // Retried sign-up for an already linked user: nothing to create.
    return;
  }

  const name = input.email.split("@")[0] ?? input.email;
  await prisma.household.create({
    data: {
      name,
      users: { create: { id: input.authUserId, email: input.email } },
    },
  });
};

export const getHousehold = async (context: HouseholdContext) => {
  return prisma.household.findUniqueOrThrow({
    where: { id: context.householdId },
  });
};
