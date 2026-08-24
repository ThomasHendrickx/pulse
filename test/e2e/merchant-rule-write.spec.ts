import { test, expect } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { householdId, userId } from "@/platform/tenancy";
import { assertGateDbTargetIsLocal } from "@/platform/db/gate-target";
import { applyRuleWrites } from "@/modules/merchants/adapters/merchant-repository";

// M3-P12 FIX ROUND, finding CR-M3P12-02, REPOINTED IN FIX ROUND THREE under
// findings CR3-M3P12-04 and CR3-M3P12-07. applyRuleWrites is the
// re-derivation's ONLY production write path, and nothing exercised it: the
// application tests bind the in-memory fake, which REIMPLEMENTS this method
// rather than calling it, so the Prisma statement, its household filter and
// its foreign-rule throw were all unverified. This is the one function
// standing between the owner's existing declarations and the migration.
//
// IT USED TO DRIVE updateRulePattern, which the routine stopped calling when
// fix round two moved the whole write set onto one transactional member, and
// which fix round three removed from the port altogether. So the one
// real-database spec was covering the path the routine had abandoned. It now
// drives the member that is actually used, and it asserts the two things a
// fake cannot: that the household filter lives in the statement, and that a
// rejection anywhere in the batch leaves NOTHING behind.
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

// THIS SPEC OPENS A DATABASE, SO IT SAYS WHICH ONE (M3-P12 fix round four,
// CRITERIA finding CR4-M3P12-02). new PrismaClient() reads process.env and
// else, so before this round the target of every write below was whatever
// DATABASE_URL the invoking shell carried, and in this fleet's containers
// that is a DEPLOYED pooler belonging to a different project with a working
// password. Nothing in this file, in playwright.config.ts or in the npm
// script named a target. That is the shape the plan calls hazard H12.30, and
// this phase shipped an interlock against exactly it for one command while
// adding a second writing surface without one.
//
// TWO THINGS NOW STAND BETWEEN THESE WRITES AND A STRANGER'S DATABASE.
// playwright.config.ts resolves and PINS the target before a worker starts,
// refusing anything that is not a local stack; and the beforeAll below reads
// what the client will actually open and refuses again. The second is not
// redundant: the config covers every run through `playwright test`, and this
// covers a spec imported by some other runner, now or later.
//
// IN DEPLOY-VERIFY MODE THIS SPEC DOES NOT RUN AT ALL. There the suite drives
// a DEPLOYED app through its browser and opens no database of its own, and
// this is the only spec that would; running it would point direct writes at
// the deployed database, which is worse than the hole it replaced.
const deployVerify = process.env.PLAYWRIGHT_BASE_URL !== undefined;

test.skip(
  deployVerify,
  "drives a database directly; in deploy-verify mode the suite opens no database",
);

const prisma = new PrismaClient();

test.beforeAll(() => {
  assertGateDbTargetIsLocal();
});

test.afterAll(async () => {
  if (!deployVerify) {
    await prisma.$disconnect();
  }
});

test("applyRuleWrites is atomic, stays within the household, and rolls back the whole batch on any rejection", async () => {
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

  // THE OWNING HOUSEHOLD: an update and an insert in one call, both applied.
  await applyRuleWrites(contextA, {
    updates: [{ ruleId: rule.id, pattern: `descriptor:${unique}-BEFORE` }],
    inserts: [
      { merchantId: merchant.id, kind: "EXACT", pattern: `account:${unique}` },
    ],
  });
  const afterOwned = await prisma.merchantRule.findUnique({
    where: { id: rule.id },
  });
  expect(afterOwned?.pattern).toBe(`descriptor:${unique}-BEFORE`);
  expect(afterOwned?.merchantId).toBe(merchant.id);
  expect(afterOwned?.kind).toBe("EXACT");
  expect(
    await prisma.merchantRule.count({
      where: { householdId: householdA.id, pattern: `account:${unique}` },
    }),
  ).toBe(1);

  // A REJECTION ANYWHERE LEAVES NOTHING BEHIND. The batch's FIRST statement
  // is a valid update and its SECOND is an insert whose pattern collides with
  // the row the first statement just wrote, which the unique key refuses. The
  // update must not survive. This is what a fake cannot witness, because the
  // rollback is the database's.
  const beforeRollback = await prisma.merchantRule.findMany({
    where: { householdId: householdA.id },
    orderBy: { id: "asc" },
    select: { id: true, pattern: true },
  });
  await expect(
    applyRuleWrites(contextA, {
      updates: [{ ruleId: rule.id, pattern: `descriptor:${unique}-ROLLED-BACK` }],
      inserts: [
        {
          merchantId: merchant.id,
          kind: "EXACT",
          pattern: `account:${unique}`,
        },
      ],
    }),
  ).rejects.toThrow();
  expect(
    await prisma.merchantRule.findMany({
      where: { householdId: householdA.id },
      orderBy: { id: "asc" },
      select: { id: true, pattern: true },
    }),
  ).toEqual(beforeRollback);

  // A FOREIGN HOUSEHOLD: it throws, the row is untouched, AND the insert that
  // travelled with it does not survive either. Before fix round three the
  // household check ran on the batch's results, after the commit, so the
  // insert landed and only then was the caller told the update was refused.
  await expect(
    applyRuleWrites(contextB, {
      updates: [{ ruleId: rule.id, pattern: `descriptor:${unique}-STOLEN` }],
      inserts: [
        {
          merchantId: merchant.id,
          kind: "EXACT",
          pattern: `descriptor:${unique}-SMUGGLED`,
        },
      ],
    }),
  ).rejects.toThrow(/did not belong to the household/);
  expect(
    await prisma.merchantRule.count({
      where: { pattern: `descriptor:${unique}-SMUGGLED` },
    }),
  ).toBe(0);
  const afterForeign = await prisma.merchantRule.findUnique({
    where: { id: rule.id },
  });
  expect(afterForeign?.pattern).toBe(`descriptor:${unique}-BEFORE`);

  // THE INSERT PATH ON ITS OWN (fix round four, HAZARD finding CR4-M3P12-03).
  // foreign-household case above submits an update AND an insert, so the
  // update loop's check throws first and the insert path is never reached:
  // that case cannot tell "the insert was refused" from "the batch never got
  // there". This one submits an INSERT ALONE, pointing at a merchant owned by
  // the OTHER household. Before this round it SUCCEEDED against real
  // Postgres, threw nothing, and created a declaration in household A naming
  // a merchant of household B, because the schema's foreign key on
  // merchantId carries no household component and this loop checked nothing.
  const foreignMerchant = await prisma.merchant.create({
    data: { householdId: householdB.id, name: `${unique}-foreign-merchant` },
  });
  await expect(
    applyRuleWrites(contextA, {
      updates: [],
      inserts: [
        {
          merchantId: foreignMerchant.id,
          kind: "EXACT",
          pattern: `descriptor:${unique}-CROSS-HOUSEHOLD`,
        },
      ],
    }),
  ).rejects.toThrow(/does not belong to the household/);
  expect(
    await prisma.merchantRule.count({
      where: { pattern: `descriptor:${unique}-CROSS-HOUSEHOLD` },
    }),
  ).toBe(0);

  // AND THE SAME SHAPE WITH AN OWNED MERCHANT STILL WORKS, so the refusal
  // above is a refusal and not a broken insert path.
  await applyRuleWrites(contextA, {
    updates: [],
    inserts: [
      {
        merchantId: merchant.id,
        kind: "EXACT",
        pattern: `descriptor:${unique}-OWNED-INSERT`,
      },
    ],
  });
  expect(
    await prisma.merchantRule.count({
      where: {
        householdId: householdA.id,
        pattern: `descriptor:${unique}-OWNED-INSERT`,
      },
    }),
  ).toBe(1);

  await prisma.merchantRule.deleteMany({ where: { householdId: householdA.id } });
  await prisma.merchant.deleteMany({ where: { householdId: householdA.id } });
  await prisma.merchantRule.deleteMany({ where: { householdId: householdB.id } });
  await prisma.merchant.deleteMany({ where: { householdId: householdB.id } });
  await prisma.household.deleteMany({
    where: { id: { in: [householdA.id, householdB.id] } },
  });
});
