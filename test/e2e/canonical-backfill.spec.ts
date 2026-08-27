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
  // The FULL fact snapshot, every column, before anything runs (fix
  // round, finding CR-M3P18-03: the comment beneath used to claim byte
  // identity while the code asserted only a row count).
  const factsBefore = await prismaClient().transaction.findMany({
    where: { householdId: household.id },
    orderBy: { id: "asc" },
  });
  await runMigration();
  const afterRun = await accountsSnapshot(household.id);

  // ARM: the committed expression agrees with canonicalAccountNumber
  // over EVERY rendering the harness wrote, the DIVERGENT-whitespace
  // rendering included (fix round, hazard finding HZ-M3P18-01: the
  // narrowNbsp row's U+202F separators and leading U+FEFF must be
  // stripped, which bare [[:space:]] cannot do), except the TWO
  // collision pairs, which are left byte identical (criterion 18.5),
  // and the card's NULL number, which is untouched. The NBSP pair is
  // the second pair: its members share a canonical form only under the
  // corrected class, so its byte identity here is what witnesses the
  // collision guard and the class agreeing.
  const pairIds = new Set([
    seeded.accountIds.collisionSpaced,
    seeded.accountIds.collisionCompact,
    seeded.accountIds.nbspSpaced,
    seeded.accountIds.nbspCompact,
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

  // ARM: the narrowNbsp rendering, which has no twin, IS canonicalised:
  // the U+202F separators and the leading BOM are gone (fix round,
  // hazard finding HZ-M3P18-01; before the corrected class this row
  // stayed at its SQL fixed point and its statement stayed refused).
  const narrowRow = afterRun.find(
    (row) => row.id === seeded.accountIds.narrowNbsp,
  );
  expect(narrowRow?.iban).toBe("BE43910000000007");

  // ARM: idempotent. A second run leaves every row byte identical.
  await runMigration();
  const afterSecondRun = await accountsSnapshot(household.id);
  expect(afterSecondRun).toEqual(afterRun);

  // ARM: no fact moved, asserted as the byte identity it claims (fix
  // round, finding CR-M3P18-03): every transaction column, deep-compared
  // across BOTH migration runs against the pre-run snapshot.
  const factsAfter = await prismaClient().transaction.findMany({
    where: { householdId: household.id },
    orderBy: { id: "asc" },
  });
  expect(factsAfter).toEqual(factsBefore);
  expect(factsAfter).toHaveLength(4);

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
  // The NBSP pair is a collision only under the corrected whitespace
  // class: the superseded [[:space:]] grouping saw two unrelated rows
  // here, which was hazard finding HZ-M3P18-01's blindness half.
  const expectedNbspLine = [
    seeded.accountIds.nbspSpaced,
    seeded.accountIds.nbspCompact,
  ]
    .sort()
    .join(" ");
  const lines = stdout.trim().split("\n").filter((line) => line !== "");
  expect(lines).toContain(expectedLine);
  expect(lines).toContain(expectedNbspLine);
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

  // AUGUST IS NOT BYTE IDENTICAL, and the reason is the product's own
  // interpretation window rather than the import's rows (slow-gate repair
  // round). This block used to assert every August figure unchanged
  // "because the fixture books in July". The window is padded by
  // SETTLEMENT_DATE_WINDOW_DAYS (45) plus TRANSFER_DATE_TOLERANCE_DAYS (4)
  // on each side, so an import booking 3 to 6 July interprets everything
  // from mid-May to 24 August, and the padding is there so a transfer leg
  // imported later can pair with one imported earlier. The seeded
  // pre-phase row t3 books 8 August, inside it.
  //
  // What happens to that row is the point. classifyFlow never returns
  // null: a null flow is a row NOT YET INTERPRETED, never a gap the reader
  // has to close, and the seed writes one deliberately to model a
  // pre-phase household. The first interpretation that reaches it gives it
  // the flow its own description and sign earn, which for a 10,00 debit on
  // a pot account is SPEND. So August's spend rises by exactly that row and
  // the pot falls by it, the income and the reserves do not move, and the
  // uninterpreted cause goes because the one pot-ring row that raised it
  // has now been read. The savings row t4 is untouched: it is held by
  // construction, counted nowhere, and outside the ring-scoped count.
  //
  //   income   2.500,00  (t1, unchanged)
  //   spend       96,47  (t2 86,47 plus t3 10,00, now interpreted)
  //   reserves     0,00  (unchanged)
  //   pot      2.403,53  (250000 - 8647 - 1000)
  //   rows            3  (flow IS NOT NULL; was 2)
  await page.goto("/?month=2026-08");
  await expect(page.getByTestId("recon-income")).toHaveText(
    augustBaseline.income,
  );
  await expect(page.getByTestId("recon-spend")).toHaveText("96,47");
  await expect(page.getByTestId("recon-reserves")).toHaveText(
    augustBaseline.reserves,
  );
  await expect(page.getByTestId("recon-pot")).toHaveText("2.403,53");
  await expect(page.getByTestId("month-meta")).toHaveText("3 rows");
  await expect(page.getByTestId("recon-cause-uninterpreted")).toHaveCount(0);
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
