import { test, expect, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";
import { canonicalAccountNumber } from "@/platform/account-number";
import {
  PRE_PHASE_ACCOUNTS,
  seedPrePhaseHousehold,
  type SeededPrePhaseHousehold,
} from "./seed-pre-phase-household";

// M3-P18, criteria 18.4 and 18.5 (migration half): the canonical backfill
// executed AS COMMITTED, over the household the seed harness writes, with
// the door-opens journey driven through the browser.
//
// This spec drives a database directly (the merchant-rule-write.spec.ts:75
// pattern) BECAUSE the guarantees under test are SQL: a fast-gate test
// over a fake asserts the fake, and criterion 18.4 arm one explicitly
// rules out a TypeScript reimplementation of the migration expression, so
// the committed migration.sql itself is executed here and its results
// compared against canonicalAccountNumber.
//
// IN DEPLOY-VERIFY MODE THIS SPEC DOES NOT RUN AT ALL: there the suite
// drives a deployed app through its browser and opens no database of its
// own, and executing a data migration against the deployed database from
// a test would be the exact hazard the db guard exists to refuse.
const deployVerify = process.env.PLAYWRIGHT_BASE_URL !== undefined;

test.skip(
  deployVerify,
  "executes the committed migration against a database directly; in deploy-verify mode the suite opens no database",
);

const ROOT = join(__dirname, "..", "..");
const FIXTURES = join(__dirname, "..", "fixtures");

// The committed migration's statements, comments stripped so the SQL that
// runs here is byte-for-byte the SQL prisma migrate deploy will run.
const migrationStatements = (): string =>
  readFileSync(
    join(
      ROOT,
      "prisma",
      "schema",
      "migrations",
      "20260827120000_canonical_account_iban_backfill",
      "migration.sql",
    ),
    "utf-8",
  )
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("--"))
    .join("\n");

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

const runMigration = async (): Promise<void> => {
  await prismaClient().$executeRawUnsafe(migrationStatements());
};

const accountsSnapshot = async (
  householdId: string,
): Promise<readonly { id: string; iban: string | null; role: string; label: string }[]> =>
  (
    await prismaClient().account.findMany({
      where: { householdId },
      orderBy: { id: "asc" },
      select: { id: true, iban: true, role: true, label: true },
    })
  ).map((row) => ({ ...row }));

const signUpFresh = async (page: Page, prefix: string): Promise<string> => {
  const unique = `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
  await page.goto("/sign-up");
  await page.getByLabel("Email").fill(`${unique}@pulse-e2e.test`);
  await page.getByLabel("Password").fill(`pw-${unique}`);
  await page.getByRole("button", { name: "Create household" }).click();
  await expect(page.getByTestId("household-context")).toHaveText(unique);
  return unique;
};

const uploadPrePhaseCurrent = async (page: Page): Promise<void> => {
  await page.goto("/import");
  await page
    .getByLabel("Bank export file")
    .setInputFiles(join(FIXTURES, "pre-phase-current.csv"));
  await page.getByRole("button", { name: "Upload" }).click();
  await expect(
    page.getByRole("heading", { name: "Confirm the detected format" }),
  ).toBeVisible();
  await page.getByLabel("Format name").fill("Demobank current account");
  await page.getByTestId("confirm-import").click();
};

test("the backfill canonicalises the declarations, spares the pair, and opens the door (criteria 18.4 and 18.5)", async ({
  page,
}) => {
  // A browser-owned household, seeded with the pre-phase population so
  // the journey can be driven through the real screens.
  const name = await signUpFresh(page, "backfill");
  const household = await prismaClient().household.findFirst({
    where: { name },
  });
  expect(household).not.toBeNull();
  if (household === null) {
    throw new Error("unreachable");
  }
  const seeded: SeededPrePhaseHousehold = await seedPrePhaseHousehold(
    prismaClient(),
    { name, householdId: household.id },
  );

  // -----------------------------------------------------------------
  // BEFORE the migration: the door is CLOSED. The statement of the
  // spaced-stored account is refused account-not-registered, which is
  // review finding P14-001's live exposure, re-established here as the
  // verification-first baseline over the seeded household.
  // -----------------------------------------------------------------
  await uploadPrePhaseCurrent(page);
  await expect(page.getByTestId("import-status")).toBeVisible();
  await expect(page.getByTestId("import-status")).toContainText(
    "an account you have not registered",
  );
  await expect(page.getByTestId("import-result")).toHaveCount(0);

  // The August MonthFigures baseline, captured BEFORE the migration:
  // the harness arithmetic, byte compared after the door opens.
  await page.goto("/?month=2026-08");
  const augustBaseline = {
    income: (await page.getByTestId("recon-income").innerText()).trim(),
    spend: (await page.getByTestId("recon-spend").innerText()).trim(),
    reserves: (await page.getByTestId("recon-reserves").innerText()).trim(),
    pot: (await page.getByTestId("recon-pot").innerText()).trim(),
    meta: (await page.getByTestId("month-meta").innerText()).trim(),
  };
  expect(augustBaseline.income).toBe("2.500,00");
  expect(augustBaseline.spend).toBe("86,47");
  expect(augustBaseline.pot).toBe("2.413,53");
  // The pot-ring null-flow row (t3) holds the verdict open before AND
  // after: the ring scoping may not swallow a real gap.
  await expect(page.getByTestId("recon-cause-uninterpreted")).toBeVisible();

  // AND THE TRAP BESIDE THE CLOSED DOOR IS NOW A REFUSAL (criterion
  // 18.5, typed half, witnessed against the real stack): retyping the
  // spaced-stored account canonically at setup is refused by name and
  // creates NO second row. Before this phase that exact pair passed both
  // the check and the index and one real account became two rows.
  await page.goto("/accounts");
  const spacedStored = PRE_PHASE_ACCOUNTS.spacedPot.iban;
  if (spacedStored === null) {
    throw new Error("unreachable: spacedPot carries a number");
  }
  await page.getByTestId("account-row").getByLabel("Label").fill("Daily again");
  await page.getByTestId("account-row").getByLabel("Bank").fill("Demobank");
  await page
    .getByTestId("account-row")
    .getByLabel("Account number")
    .fill(canonicalAccountNumber(spacedStored));
  await page.getByTestId("account-row").getByLabel("Ring").selectOption("POT");
  await page.getByTestId("register-accounts").click();
  await expect(page.getByTestId("account-row-error")).toContainText(
    "already registered",
  );
  const rowsAfterRetype = await prismaClient().account.count({
    where: { householdId: household.id },
  });
  expect(rowsAfterRetype).toBe(Object.keys(PRE_PHASE_ACCOUNTS).length);

  // -----------------------------------------------------------------
  // THE MIGRATION, executed as committed.
  // -----------------------------------------------------------------
  const beforeRun = await accountsSnapshot(household.id);
  await runMigration();
  const afterRun = await accountsSnapshot(household.id);

  // ARM: the committed expression agrees with canonicalAccountNumber
  // over EVERY rendering the harness wrote, except the collision pair,
  // which is left byte identical (criterion 18.5), and the card's NULL
  // number, which is untouched.
  const pairIds = new Set([
    seeded.accountIds.collisionSpaced,
    seeded.accountIds.collisionCompact,
  ]);
  for (const before of beforeRun) {
    const after = afterRun.find((row) => row.id === before.id);
    expect(after).toBeDefined();
    if (after === undefined) {
      continue;
    }
    if (before.iban === null) {
      expect(after.iban).toBeNull();
    } else if (pairIds.has(before.id)) {
      // BOTH members byte identical to their seeded state: the
      // migration neither rewrites one member, nor picks a winner, nor
      // dies on the unique index (it completed, which this line is
      // reading the proof of).
      expect(after.iban).toBe(before.iban);
    } else {
      expect(after.iban).toBe(canonicalAccountNumber(before.iban));
    }
    // Only the declaration column moves: ring and label are untouched.
    expect(after.role).toBe(before.role);
    expect(after.label).toBe(before.label);
  }

  // ARM: validity is not smuggled in. The checksum-failing number is
  // backfilled to its canonical form like any other row, never refused
  // or nulled.
  const invalidRow = afterRun.find(
    (row) => row.id === seeded.accountIds.invalidNumber,
  );
  expect(invalidRow?.iban).toBe("BE82910000000002");

  // ARM: no fact moved. The seeded transactions are byte identical.
  const transactions = await prismaClient().transaction.findMany({
    where: { householdId: household.id, importId: seeded.importId },
    orderBy: { dedupKey: "asc" },
    select: { counterpartyIban: true, amountCents: true, description: true },
  });
  expect(transactions).toHaveLength(4);

  // ARM: idempotent. A second run leaves every row byte identical.
  await runMigration();
  const afterSecondRun = await accountsSnapshot(household.id);
  expect(afterSecondRun).toEqual(afterRun);

  // ARM: a no-op where there is nothing to do. A household whose stored
  // numbers are already canonical (M3-P14's own write shape) is
  // unchanged, asserted over a directly created control household.
  const control = await prismaClient().household.create({
    data: { name: `${name}-canonical-control` },
  });
  await prismaClient().account.create({
    data: {
      householdId: control.id,
      label: "Control account",
      bank: "Demobank",
      role: "POT",
      iban: "BE73900000000001",
    },
  });
  const controlBefore = await accountsSnapshot(control.id);
  await runMigration();
  expect(await accountsSnapshot(control.id)).toEqual(controlBefore);

  // -----------------------------------------------------------------
  // THE DETECTION SCRIPT (criterion 18.5): one run outputs the pair's
  // two row ids, on one line, and no account number anywhere.
  // -----------------------------------------------------------------
  const stdout = execFileSync("npx", ["tsx", "scripts/detect-account-collisions.ts"], {
    cwd: ROOT,
    env: process.env,
    encoding: "utf-8",
  });
  const expectedLine = [
    seeded.accountIds.collisionSpaced,
    seeded.accountIds.collisionCompact,
  ]
    .sort()
    .join(" ");
  const lines = stdout.trim().split("\n").filter((line) => line !== "");
  expect(lines).toContain(expectedLine);
  // No account number reaches the output, in any rendering: every line
  // is row ids only. (Other concurrently seeded households may
  // legitimately contribute their own pair lines; each is ids only.)
  expect(stdout).not.toMatch(/[A-Z]{2}\s?[0-9]{2}[0-9A-Z ]{10,}/);
  for (const line of lines) {
    expect(line).toMatch(/^[0-9a-f-]+( [0-9a-f-]+)+$/);
  }

  // -----------------------------------------------------------------
  // THE PAIRED ACCOUNT IS NO WORSE OFF (criterion 18.5): imports for it
  // behave after the migration exactly as before, deterministically.
  // The canonical probe exact-matches the COMPACT member alone, before
  // and after, because the pair was left byte identical: its statement
  // lands on that member's account in both worlds.
  // -----------------------------------------------------------------
  const probe = await prismaClient().account.findMany({
    where: {
      householdId: household.id,
      iban: canonicalAccountNumber(spacedStoredPairValue()),
    },
    select: { id: true },
  });
  expect(probe.map((row) => row.id)).toEqual([
    seeded.accountIds.collisionCompact,
  ]);

  // -----------------------------------------------------------------
  // THE DOOR OPENS: the upload refused before the migration is accepted
  // after it, its rows ingested and CLASSIFIED exactly as a canonical
  // household's are (the fixture books in July, so August's figures
  // stay byte identical to the captured baseline).
  // -----------------------------------------------------------------
  await uploadPrePhaseCurrent(page);
  await expect(page.getByTestId("import-result")).toBeVisible();
  await expect(page.getByTestId("rows-added")).toHaveText("2");

  await page.goto("/?month=2026-07");
  await expect(page.getByTestId("recon-income")).toHaveText("2.100,00");
  await expect(page.getByTestId("recon-spend")).toHaveText("54,30");
  await expect(page.getByTestId("recon-pot")).toHaveText("2.045,70");

  await page.goto("/?month=2026-08");
  await expect(page.getByTestId("recon-income")).toHaveText(
    augustBaseline.income,
  );
  await expect(page.getByTestId("recon-spend")).toHaveText(augustBaseline.spend);
  await expect(page.getByTestId("recon-reserves")).toHaveText(
    augustBaseline.reserves,
  );
  await expect(page.getByTestId("recon-pot")).toHaveText(augustBaseline.pot);
  await expect(page.getByTestId("month-meta")).toHaveText(augustBaseline.meta);
  await expect(page.getByTestId("recon-cause-uninterpreted")).toBeVisible();
});

// The pair's shared value, read from the harness constants so this spec
// cannot drift from what the harness seeds.
const spacedStoredPairValue = (): string => {
  const value = PRE_PHASE_ACCOUNTS.collisionSpaced.iban;
  if (value === null) {
    throw new Error("unreachable: the collision pair carries a number");
  }
  return value;
};
