import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";
import { householdId, userId } from "@/platform/tenancy";
import { plainDate } from "@/platform/plain-date";
import * as repository from "@/modules/overview/adapters/overview-repository";
import { deriveMonthFigures } from "@/modules/overview/domain/month-projection";
import { seedPrePhaseHousehold } from "./seed-pre-phase-household";

// M3-P18, criterion 18.3: BOTH reads that can see a deliberately
// uninterpreted row are scoped by the account's ring, AND a gap on a
// spending account is still a gap, witnessed at the ONLY level that can
// see it. The ring scoping under test is SQL; the fast gate is in-process
// over fakes, and a test over a fake asserts the fake, so this spec
// constructs a PrismaClient directly (the merchant-rule-write.spec.ts:75
// pattern), seeds through the ONE harness, and calls the REAL repository
// methods.
//
// THE SWEEP IS OVER THE WHOLE PORT rather than over two named reads: this
// spec calls EVERY method src/modules/overview/application/ports.ts
// publishes, on the real repository, and asserts per method which of the
// two null-flow rows (t3 on a SPENDING account, t4 on a SAVINGS account)
// it returns or counts, so a read nobody thought about cannot quietly see
// either. A completeness pin below parses the port's own text and reddens
// if a method is added without joining this sweep.
const deployVerify = process.env.PLAYWRIGHT_BASE_URL !== undefined;

test.skip(
  deployVerify,
  "drives a database directly; in deploy-verify mode the suite opens no database",
);

let client: PrismaClient | undefined;
const prismaClient = (): PrismaClient => {
  if (client === undefined) {
    throw new Error("the Prisma client is constructed in beforeAll");
  }
  return client;
};

test.beforeAll(() => {
  client = new PrismaClient();
});

test.afterAll(async () => {
  if (!deployVerify && client !== undefined) {
    await client.$disconnect();
  }
});

const AUGUST = {
  from: plainDate("2026-08-01"),
  to: plainDate("2026-08-31"),
};

test("every port method sees the pot gap and never the savings row, and the held read sees only the savings row", async () => {
  const unique = `heldgap-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
  const seeded = await seedPrePhaseHousehold(prismaClient(), { name: unique });
  const context = {
    householdId: householdId(seeded.householdId),
    userId: userId(`${unique}-user`),
  };
  const potGapId = seeded.transactionIds["t3"];
  const savingsHeldId = seeded.transactionIds["t4"];
  expect(potGapId).toBeDefined();
  expect(savingsHeldId).toBeDefined();

  const covered = new Set<string>();

  // listIncomeGroups: counted flows only; neither null-flow row appears.
  covered.add("listIncomeGroups");
  const income = await repository.listIncomeGroups(context, AUGUST);
  expect(income.reduce((total, group) => total + group.rowCount, 0)).toBe(1);
  expect(
    income.some((group) => group.counterpartyText.includes("NOG NIET")),
  ).toBe(false);
  expect(
    income.some((group) => group.counterpartyText.includes("BASISRENTE")),
  ).toBe(false);

  // listSpendGroups: counted flows only; neither null-flow row appears.
  covered.add("listSpendGroups");
  const spend = await repository.listSpendGroups(context, AUGUST);
  expect(spend.reduce((total, group) => total + group.rowCount, 0)).toBe(1);
  expect(
    spend.some((group) => group.counterpartyText.includes("NOG NIET")),
  ).toBe(false);
  expect(
    spend.some((group) => group.counterpartyText.includes("BASISRENTE")),
  ).toBe(false);

  // listReserveMovements: RESERVE flows only; the seeded household has
  // none, and neither null-flow row can appear here.
  covered.add("listReserveMovements");
  const reserves = await repository.listReserveMovements(context, AUGUST);
  expect(reserves).toEqual([]);

  // monthFigures: the SPENDING row is counted by the uninterpreted count
  // and holds the verdict open (month-projection.ts arm); the SAVINGS row
  // is counted NOWHERE. The full figures equal the harness's hand-derived
  // baseline, which is the step-1 MonthFigures capture.
  covered.add("monthFigures");
  const raw = await repository.monthFigures(context, AUGUST);
  expect(raw.incomeSignedCents).toBe(250000);
  expect(raw.spendSignedCents).toBe(-8647);
  expect(raw.reserveSignedCents).toBe(0);
  expect(raw.changeInPotCents).toBe(241353);
  expect(raw.unresolvedCount).toBe(0);
  expect(raw.unmatchedInternalCount).toBe(0);
  expect(raw.inTransitCount).toBe(0);
  expect(raw.uninterpretedCount).toBe(1);
  expect(raw.rowCount).toBe(2);
  const figures = deriveMonthFigures(raw);
  expect(figures.reconciles).toBe(false);

  // listGapRows: the SPENDING row is returned, labelled uninterpreted.
  // THE LISTING-ALONE ASSERTION: listGapRows itself returns NO
  // savings-account row over this household. This is the only witness
  // that can see an UNSCOPED LISTING, because the cause block is gated on
  // the scoped count, so an unscoped listing's savings rows would be
  // returned by the repository and rendered nowhere, the defect decision
  // D-56 calls worse than scoping neither.
  covered.add("listGapRows");
  const gaps = await repository.listGapRows(context, AUGUST);
  expect(gaps.map((row) => row.id)).toContain(potGapId);
  expect(gaps.find((row) => row.id === potGapId)?.gap).toBe("uninterpreted");
  expect(gaps.map((row) => row.id)).not.toContain(savingsHeldId);
  expect(gaps.some((row) => row.accountLabel === "Savings")).toBe(false);
  expect(gaps.some((row) => row.accountLabel === "Holiday savings")).toBe(
    false,
  );

  // listHeldRows: the SAVINGS row is returned, with the account's typed
  // label; the SPENDING row is not.
  covered.add("listHeldRows");
  const held = await repository.listHeldRows(context, AUGUST);
  expect(held.map((row) => row.id)).toContain(savingsHeldId);
  expect(held.find((row) => row.id === savingsHeldId)?.accountLabel).toBe(
    "Savings",
  );
  expect(held.map((row) => row.id)).not.toContain(potGapId);

  // hasAnyTransactions: an existence probe over the household; it sees
  // the household as a whole rather than either row specifically.
  covered.add("hasAnyTransactions");
  expect(await repository.hasAnyTransactions(context)).toBe(true);

  // THE COMPLETENESS PIN: every method the port publishes was called
  // above. Parsed from the port's own text, so a method added later
  // reddens this sweep instead of quietly seeing a row nobody asserted
  // over. Asserted BY NAME, never by count.
  const portSource = readFileSync(
    join(
      __dirname,
      "..",
      "..",
      "src",
      "modules",
      "overview",
      "application",
      "ports.ts",
    ),
    "utf-8",
  );
  const portBody = portSource.slice(
    portSource.indexOf("export type OverviewRepositoryPort"),
    portSource.indexOf("export type OverviewDependencies"),
  );
  const published = [...portBody.matchAll(/readonly (\w+):/g)].map(
    (match) => match[1],
  );
  expect(published.length).toBeGreaterThan(0);
  for (const method of published) {
    expect(covered.has(method ?? ""), `port method ${method} is swept`).toBe(
      true,
    );
  }
});
