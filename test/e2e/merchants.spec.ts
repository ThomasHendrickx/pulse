import { expect, test } from "@playwright/test";
import { join } from "node:path";

// Criterion 3.3 (hazard H3.2): name an unresolved counterparty on the
// merchant review screen and assert the month's data REGROUPS it without a
// cent moving between the income and spend totals. Resolution renames and
// regroups; it never reclassifies flow. Fresh household per run (unique
// sign-up email), so earlier runs cannot leak into the totals.
//
// Fixture arithmetic (belfius-account-a.csv, all rows in August 2026):
//   income: +2.500,00 salary and +42.000,00 refund from the same
//           counterparty with no outgoing history, so both INCOME:
//           44.500,00 total
//   spend:  -12,50 -125,30 -86,47 -950,00 = -1.174,27 total

const FIXTURE = join(__dirname, "..", "fixtures", "belfius-account-a.csv");

test("naming an unresolved counterparty regroups it and changes no total", async ({
  page,
}) => {
  const unique = `merchants-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
  const email = `${unique}@pulse-e2e.test`;
  const password = `pw-${unique}`;

  // Fresh household.
  await page.goto("/sign-up");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Create household" }).click();
  await expect(page.getByTestId("household-context")).toHaveText(unique);

  // One import: declare the account and confirm the detected format.
  await page.goto("/import");
  await page.getByLabel("Bank export file").setInputFiles(FIXTURE);
  await page.getByRole("button", { name: "Upload" }).click();
  await expect(
    page.getByRole("heading", { name: "Confirm the detected format" }),
  ).toBeVisible();
  await page.getByLabel("Format name").fill("Demobank current account");
  await page.getByLabel("Label").fill("Daily account");
  await page.getByLabel("Bank").fill("Demobank");
  await page.getByLabel("Ring").selectOption("POT");
  await page.getByTestId("confirm-import").click();
  await expect(page.getByTestId("import-result")).toBeVisible();
  await expect(page.getByTestId("rows-added")).toHaveText("6");

  // The review screen: every counted counterparty is unresolved, and the
  // totals are the fixture's known values.
  await page.goto("/merchants");
  await expect(page.getByRole("heading", { name: "Merchant review" })).toBeVisible();
  await expect(page.getByTestId("income-total")).toHaveText("44.500,00");
  await expect(page.getByTestId("spend-total")).toHaveText("-1.174,27");
  await expect(page.getByTestId("merchant-group")).toHaveCount(0);
  await expect(page.getByTestId("unresolved-group")).toHaveCount(5);
  const incomeBefore = await page.getByTestId("income-total").textContent();
  const spendBefore = await page.getByTestId("spend-total").textContent();

  // Name ONE unresolved counterparty, in one click: type the name, submit.
  const supermarkt = page
    .getByTestId("unresolved-group")
    .filter({ hasText: "SUPERMARKT NOORD" });
  await expect(supermarkt).toHaveCount(1);
  await supermarkt.getByPlaceholder("Name this counterparty").fill("Supermarkt");
  await supermarkt.getByRole("button", { name: "Name" }).click();

  // Regrouped: the row now sits under the merchant's name, resolved, and
  // the raw descriptor group is gone.
  const named = page.getByTestId("merchant-group").filter({ hasText: "Supermarkt" });
  await expect(named).toHaveCount(1);
  await expect(named.getByTestId("group-total")).toHaveText("-86,47");
  await expect(
    page.getByTestId("unresolved-group").filter({ hasText: "SUPERMARKT NOORD" }),
  ).toHaveCount(0);
  await expect(page.getByTestId("unresolved-group")).toHaveCount(4);

  // The whole point: naming moved cents between GROUPS and none between
  // TOTALS (hazard H3.2). Same values, digit for digit.
  await expect(page.getByTestId("income-total")).toHaveText(incomeBefore ?? "");
  await expect(page.getByTestId("spend-total")).toHaveText(spendBefore ?? "");
  await expect(page.getByTestId("income-total")).toHaveText("44.500,00");
  await expect(page.getByTestId("spend-total")).toHaveText("-1.174,27");
});
