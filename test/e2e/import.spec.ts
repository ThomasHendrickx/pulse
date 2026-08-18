import { expect, test } from "@playwright/test";
import { join } from "node:path";

// Criterion 1.5: upload a first file, get asked to declare the account
// (label, bank, ring) and confirm the detected profile over a five-row
// preview, complete, re-upload the same file, and assert zero new rows
// with no questions asked. Runs against the dev server with a fresh
// household per run (unique sign-up email), so imports from earlier runs
// cannot leak into the counts.

const FIXTURE = join(__dirname, "..", "fixtures", "belfius-account-a.csv");

test("first upload asks once; re-upload adds zero and asks nothing", async ({
  page,
}) => {
  const unique = `import-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
  const email = `${unique}@pulse-e2e.test`;
  const password = `pw-${unique}`;

  // Fresh household.
  await page.goto("/sign-up");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Create household" }).click();
  await expect(page.getByTestId("household-context")).toHaveText(unique);

  // First upload: the file is parsed and the conversation starts.
  await page.goto("/import");
  await expect(page.getByRole("heading", { name: "Import" })).toBeVisible();
  await page.getByLabel("Bank export file").setInputFiles(FIXTURE);
  await page.getByRole("button", { name: "Upload" }).click();

  // The confirmation screen: detected profile over a five-row preview,
  // and the account declaration asked at first sight.
  await expect(
    page.getByRole("heading", { name: "Confirm the detected format" }),
  ).toBeVisible();
  await expect(page.getByTestId("preview-row")).toHaveCount(5);
  // The preview renders rows as they will be stored: booking date as a
  // plain date, the amount in Belgian notation through the shared
  // formatter.
  await expect(page.getByTestId("preview-table")).toContainText("2026-08-03");
  await expect(page.getByTestId("preview-table")).toContainText("2.500,00");
  await expect(page.getByTestId("account-declaration")).toBeVisible();

  await page.getByLabel("Format name").fill("Demobank current account");
  await page.getByLabel("Label").fill("Daily account");
  await page.getByLabel("Bank").fill("Demobank");
  await page.getByLabel("Ring").selectOption("POT");
  await page.getByTestId("confirm-import").click();

  // Completed: six rows in, none previously known.
  await expect(page.getByTestId("import-result")).toBeVisible();
  await expect(page.getByTestId("rows-added")).toHaveText("6");
  await expect(page.getByTestId("rows-known")).toHaveText("0");

  // Re-upload of the SAME file: no declaration, no confirmation, no
  // questions. Straight to the result with zero new rows.
  await page.goto("/import");
  await page.getByLabel("Bank export file").setInputFiles(FIXTURE);
  await page.getByRole("button", { name: "Upload" }).click();

  await expect(page.getByTestId("import-result")).toBeVisible();
  await expect(page.getByTestId("rows-added")).toHaveText("0");
  await expect(page.getByTestId("rows-known")).toHaveText("6");
  // No questions were asked on the way: the result screen is the landing
  // page of the re-upload, and neither the declaration fieldset nor the
  // confirmation heading exists on it.
  await expect(page.getByTestId("account-declaration")).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "Confirm the detected format" }),
  ).toHaveCount(0);
});
