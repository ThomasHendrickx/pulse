import { test, expect } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { householdId, userId } from "@/platform/tenancy";
import { updateRulePattern } from "@/modules/merchants/adapters/merchant-repository";

// M3-P12 FIX ROUND, finding CR-M3P12-02. updateRulePattern is the
// re-derivation's ONLY production write path, and nothing exercised it: the
// application tests bind the in-memory fake, which REIMPLEMENTS this method
// rather than calling it, so the Prisma statement, its household filter and
// its foreign-rule throw were all unverified. This is the one function
// standing between the owner's existing declarations and the migration.
//
// WHY IT LIVES IN THE PLAYWRIGHT GATE AND NOT IN `npm test`, said plainly
// because the review that raised this finding assumed otherwise: this tree
// has NO live-Postgres lane in the fast gate. test/schema/rls.test.ts and
// test/schema/tenancy.test.ts are static analysis over the schema, the
// migration SQL and the source text, and test/db/db-guard.test.ts tests a
// pure function and a CLI that refuses to run; not one of them opens a
// connection. Putting a connecting test in `npm test` would change what the
// fast gate requires of every contributor and every CI runner. The
// Playwright gate already boots the local stack with the migrations applied
// and must pass before this slice closes, so it is the lane that exists.
//
// This spec drives no browser on purpose. It is a database contract test.

const prisma = new PrismaClient();

test.afterAll(async () => {
  await prisma.$disconnect();
});

test("updateRulePattern writes within the household and REFUSES a rule belonging to another one", async () => {
  const unique = `rulewrite-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
  const householdA = await prisma.household.create({
    data: { name: `${unique}-a` },
  });
  const householdB = await prisma.household.create({
    data: { name: `${unique}-b` },
  });
  const merchant = await prisma.merchant.create({
    data: { householdId: householdA.id, name: `${unique}-merchant` },
  });
  const rule = await prisma.merchantRule.create({
    data: {
      householdId: householdA.id,
      merchantId: merchant.id,
      kind: "EXACT",
      pattern: `${unique}-BEFORE`,
    },
  });

  const contextA = {
    householdId: householdId(householdA.id),
    userId: userId(`${unique}-user`),
  };
  const contextB = {
    householdId: householdId(householdB.id),
    userId: userId(`${unique}-user`),
  };

  // THE OWNING HOUSEHOLD: the row is rewritten and the returned record
  // carries the new pattern with the rest of the row unchanged.
  const updated = await updateRulePattern(contextA, {
    ruleId: rule.id,
    pattern: `descriptor:${unique}-BEFORE`,
  });
  expect(updated.id).toBe(rule.id);
  expect(updated.merchantId).toBe(merchant.id);
  expect(updated.kind).toBe("EXACT");
  expect(updated.pattern).toBe(`descriptor:${unique}-BEFORE`);
  const afterOwned = await prisma.merchantRule.findUnique({
    where: { id: rule.id },
  });
  expect(afterOwned?.pattern).toBe(`descriptor:${unique}-BEFORE`);

  // A FOREIGN HOUSEHOLD: it throws, and the row is untouched. This is the
  // half a fake cannot witness, because the filter lives in the statement.
  await expect(
    updateRulePattern(contextB, {
      ruleId: rule.id,
      pattern: `descriptor:${unique}-STOLEN`,
    }),
  ).rejects.toThrow(/does not belong to the household/);
  const afterForeign = await prisma.merchantRule.findUnique({
    where: { id: rule.id },
  });
  expect(afterForeign?.pattern).toBe(`descriptor:${unique}-BEFORE`);

  await prisma.merchantRule.deleteMany({ where: { householdId: householdA.id } });
  await prisma.merchant.deleteMany({ where: { householdId: householdA.id } });
  await prisma.household.deleteMany({
    where: { id: { in: [householdA.id, householdB.id] } },
  });
});
