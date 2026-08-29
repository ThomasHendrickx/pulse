import { expect, type Page } from "@playwright/test";

// SETUP, THROUGH THE REAL SCREEN (M3-P14). Every spec that imports a
// current-account statement now has to register that account first, because
// the confirm step refuses a file whose own account is not one the household
// registered. This is the one helper that does it, driving the same form the
// owner drives.
//
// Every account number that reaches this helper is INVENTED and listed with
// its provenance in test/fixtures/allowed-identifiers.txt.

export type SetupRow = {
  readonly label: string;
  readonly bank: string;
  readonly accountNumber: string;
  readonly ring: "POT" | "RESERVE";
};

export const signUpFresh = async (
  page: Page,
  prefix: string,
): Promise<string> => {
  const unique = `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
  await page.goto("/sign-up");
  await page.getByLabel("Email").fill(`${unique}@pulse-e2e.test`);
  await page.getByLabel("Password").fill(`pw-${unique}`);
  await page.getByRole("button", { name: "Create household" }).click();
  await expect(page.getByTestId("household-context")).toHaveText(unique);
  return unique;
};

// Fill the setup form with every row in ONE submission, adding a row for
// each account past the first, and submit once.
export const fillSetupRows = async (
  page: Page,
  rows: readonly SetupRow[],
): Promise<void> => {
  for (let index = 1; index < rows.length; index += 1) {
    await page.getByTestId("add-account-row").click();
  }
  await expect(page.getByTestId("account-row")).toHaveCount(rows.length);
  for (const [index, row] of rows.entries()) {
    const fields = page.getByTestId("account-row").nth(index);
    await fields.getByLabel("Label").fill(row.label);
    await fields.getByLabel("Bank").fill(row.bank);
    await fields.getByLabel("Account number").fill(row.accountNumber);
    await fields.getByLabel("Ring").selectOption(row.ring);
  }
};

export const registerAccounts = async (
  page: Page,
  rows: readonly SetupRow[],
): Promise<void> => {
  await page.goto("/accounts");
  await fillSetupRows(page, rows);
  await page.getByTestId("register-accounts").click();
  await expect(page.getByTestId("accounts-status")).toBeVisible();
  await expect(page.getByTestId("registered-account")).toHaveCount(rows.length);
};

// The shorthand almost every existing spec needs: one current account, in
// the spending ring, whose number the fixture's own-account column carries.
export const registerCurrentAccount = async (
  page: Page,
  accountNumber: string,
  label = "Daily account",
  bank = "Demobank",
): Promise<void> => {
  await registerAccounts(page, [
    { label, bank, accountNumber, ring: "POT" },
  ]);
};

// Register ONE account only if it is not registered already, for the specs
// that upload several fixtures belonging to two accounts of the same
// household. Registering the same number twice is refused by name, which is
// correct behaviour and not what those specs are testing.
export const ensureRegistered = async (
  page: Page,
  row: SetupRow,
): Promise<void> => {
  await page.goto("/accounts");
  const already = await page
    .getByTestId("registered-account-number")
    .filter({ hasText: row.accountNumber })
    .count();
  if (already > 0) {
    return;
  }
  await fillSetupRows(page, [row]);
  await page.getByTestId("register-accounts").click();
  await expect(page.getByTestId("accounts-status")).toBeVisible();
  await expect(
    page
      .getByTestId("registered-account-number")
      .filter({ hasText: row.accountNumber }),
  ).toHaveCount(1);
};

// The account numbers the committed month-view and golden-journey fixtures
// carry in their own-account column, so a spec registers what its fixture
// actually belongs to rather than a value typed twice. Both are invented and
// listed with their provenance in test/fixtures/allowed-identifiers.txt.
export const FIXTURE_ACCOUNT_A = "BE68539007547034";
export const FIXTURE_ACCOUNT_B = "BE59539007547099";
