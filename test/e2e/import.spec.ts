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
  // Finding F1 (transparency): the account is not known yet, and the
  // screen says so before asking for the declaration.
  await expect(page.getByTestId("landing-new")).toBeVisible();
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

  // Completed: six rows in, none previously known, INTO the named
  // account (finding F1: counts never render without their account).
  await expect(page.getByTestId("import-result")).toBeVisible();
  await expect(page.getByTestId("landing-account")).toHaveText("Daily account");
  await expect(page.getByTestId("rows-added")).toHaveText("6");
  await expect(page.getByTestId("rows-known")).toHaveText("0");

  // Re-upload of the SAME file: no declaration, no confirmation, no
  // questions. Straight to the result with zero new rows.
  await page.goto("/import");
  await page.getByLabel("Bank export file").setInputFiles(FIXTURE);
  await page.getByRole("button", { name: "Upload" }).click();

  await expect(page.getByTestId("import-result")).toBeVisible();
  await expect(page.getByTestId("landing-account")).toHaveText("Daily account");
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

// Criterion 2.5: the PDF journey. A recognised Belfius-layout PDF goes
// upload -> ask-once account declaration (no format question) -> import
// detail reporting rows added -> a month view whose books close. The
// rendered copy of the empty state and of the import screen names PDF
// (finding PR2-007: the previous copy told the owner the product reads
// CSV exports only).

const PDF_FIXTURE = join(
  __dirname,
  "..",
  "fixtures",
  "belfius-statement-a.pdf",
);

test("PDF upload: ask-once declaration, rows added, month reconciles, copy names PDF", async ({
  page,
}) => {
  const unique = `pdf-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
  const email = `${unique}@pulse-e2e.test`;
  const password = `pw-${unique}`;

  await page.goto("/sign-up");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Create household" }).click();
  await expect(page.getByTestId("household-context")).toHaveText(unique);

  // The empty state names PDF among the accepted formats (PR2-007).
  await expect(page.getByTestId("empty-state")).toBeVisible();
  await expect(page.getByTestId("empty-state")).toContainText("PDF");

  // The import screen's own copy names PDF as well.
  await page.goto("/import");
  await expect(page.getByRole("heading", { name: "Import" })).toBeVisible();
  await expect(page.locator(".import-lead")).toContainText("PDF");

  await page.getByLabel("Bank export file").setInputFiles(PDF_FIXTURE);
  await page.getByRole("button", { name: "Upload" }).click();

  // The ask-once account declaration, with the format question GONE for
  // a recognised layout: no format-name field, no spec editor, and the
  // five-row preview rendered from the layout template.
  await expect(
    page.getByRole("heading", { name: "Confirm the detected format" }),
  ).toBeVisible();
  await expect(page.getByTestId("landing-new")).toBeVisible();
  await expect(page.getByTestId("preview-row")).toHaveCount(5);
  await expect(page.getByTestId("preview-table")).toContainText("2026-05-04");
  await expect(page.getByLabel("Format name")).toHaveCount(0);
  await expect(page.locator(".spec-editor")).toHaveCount(0);
  await expect(page.getByTestId("account-declaration")).toBeVisible();

  await page.getByLabel("Label").fill("Daily account");
  await page.getByLabel("Bank").fill("Belfius");
  await page.getByLabel("Ring").selectOption("POT");
  await page.getByTestId("confirm-import").click();

  // Import detail: all nine fixture rows added into the declared account.
  await expect(page.getByTestId("import-result")).toBeVisible();
  await expect(page.getByTestId("landing-account")).toHaveText("Daily account");
  await expect(page.getByTestId("rows-added")).toHaveText("9");
  await expect(page.getByTestId("rows-known")).toHaveText("0");

  // The fixture's month reconciles: opening + rows == closing held at
  // parse time, and the interpreted month's books close on screen.
  await page.goto("/?month=2026-05");
  await expect(page.getByTestId("recon-panel")).toBeVisible();
  await expect(page.getByTestId("recon-panel")).toHaveAttribute(
    "data-state",
    "ok",
  );
});

// Criterion 3.4 (M3-P3): the KBC card journey across TWO PDF imports.
// The card statement carries no IBAN, so the ask-once declaration binds
// the profile to the declared card account; the companion Belfius
// statement carries the account-side settlement debit. With both
// imported, June's books close: the settlement debit and the
// DOMICILIERING mirror credit pair INTERNAL (D-11) and the card's own
// line items are the only counted spend.

const KBC_FIXTURE = join(__dirname, "..", "fixtures", "kbc-statement-a.pdf");
const COMPANION_FIXTURE = join(
  __dirname,
  "..",
  "fixtures",
  "belfius-settlement-companion.pdf",
);

test("KBC card PDF plus companion account PDF: two ask-once declarations, June reconciles", async ({
  page,
}) => {
  const unique = `kbc-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
  const email = `${unique}@pulse-e2e.test`;
  const password = `pw-${unique}`;

  await page.goto("/sign-up");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Create household" }).click();
  await expect(page.getByTestId("household-context")).toHaveText(unique);

  // The card statement: recognised layout, so no format question, only
  // the account declaration. The preview's first row is the
  // month-straddling row, shown under its TRANSACTION date (PR2-004).
  await page.goto("/import");
  await page.getByLabel("Bank export file").setInputFiles(KBC_FIXTURE);
  await page.getByRole("button", { name: "Upload" }).click();

  await expect(
    page.getByRole("heading", { name: "Confirm the detected format" }),
  ).toBeVisible();
  await expect(page.getByTestId("landing-new")).toBeVisible();
  await expect(page.getByTestId("preview-row")).toHaveCount(5);
  await expect(page.getByTestId("preview-table")).toContainText("2026-05-31");
  await expect(page.getByTestId("preview-table")).toContainText("48,20");
  await expect(page.getByLabel("Format name")).toHaveCount(0);
  await expect(page.getByTestId("account-declaration")).toBeVisible();

  await page.getByLabel("Label").fill("Credit card");
  await page.getByLabel("Bank").fill("KBC");
  await page.getByLabel("Ring").selectOption("POT");
  await page.getByTestId("confirm-import").click();

  await expect(page.getByTestId("import-result")).toBeVisible();
  await expect(page.getByTestId("landing-account")).toHaveText("Credit card");
  await expect(page.getByTestId("rows-added")).toHaveText("9");
  await expect(page.getByTestId("rows-known")).toHaveText("0");

  // The companion current-account statement with the settlement debit.
  await page.goto("/import");
  await page.getByLabel("Bank export file").setInputFiles(COMPANION_FIXTURE);
  await page.getByRole("button", { name: "Upload" }).click();

  await expect(
    page.getByRole("heading", { name: "Confirm the detected format" }),
  ).toBeVisible();
  await expect(page.getByTestId("account-declaration")).toBeVisible();
  await page.getByLabel("Label").fill("Daily account");
  await page.getByLabel("Bank").fill("Belfius");
  await page.getByLabel("Ring").selectOption("POT");
  await page.getByTestId("confirm-import").click();

  await expect(page.getByTestId("import-result")).toBeVisible();
  await expect(page.getByTestId("landing-account")).toHaveText("Daily account");
  await expect(page.getByTestId("rows-added")).toHaveText("4");
  await expect(page.getByTestId("rows-known")).toHaveText("0");

  // June's books close: the settlement pair is INTERNAL on both legs,
  // nothing is unmatched, and the reconciliation panel reads ok.
  await page.goto("/?month=2026-06");
  await expect(page.getByTestId("recon-panel")).toBeVisible();
  await expect(page.getByTestId("recon-panel")).toHaveAttribute(
    "data-state",
    "ok",
  );
});

// Fix round 1, finding CR-902, extending the phone-viewport rule the
// M3-P1 defect round instituted (its criterion 1.5: no horizontal
// scroll at 390x844) to the PDF confirm step, where the preview table's
// long unbreakable tokens overflowed the viewport by 3px before the
// preview block got its own scroll container.
test.describe("phone viewport (CR-902)", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("at 390x844 the PDF confirm step shows the declaration with no page-level horizontal scroll", async ({
    page,
  }) => {
    const unique = `pdfm-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
    await page.goto("/sign-up");
    await page.getByLabel("Email").fill(`${unique}@pulse-e2e.test`);
    await page.getByLabel("Password").fill(`pw-${unique}`);
    await page.getByRole("button", { name: "Create household" }).click();
    await expect(page.getByTestId("household-context")).toHaveText(unique);

    await page.goto("/import");
    await page.getByLabel("Bank export file").setInputFiles(PDF_FIXTURE);
    await page.getByRole("button", { name: "Upload" }).click();

    await expect(
      page.getByRole("heading", { name: "Confirm the detected format" }),
    ).toBeVisible();
    await expect(page.getByTestId("preview-row")).toHaveCount(5);
    await expect(page.getByTestId("account-declaration")).toBeVisible();

    // The page itself never scrolls horizontally; wide content scrolls
    // inside its own container.
    const scrollWidth = await page.evaluate(
      () => document.documentElement.scrollWidth,
    );
    expect(scrollWidth, "no horizontal scroll on the PDF confirm step").toBeLessThanOrEqual(390);

    // And the declaration is usable at this width, end to end.
    await page.getByLabel("Label").fill("Daily account");
    await page.getByLabel("Bank").fill("Belfius");
    await page.getByLabel("Ring").selectOption("POT");
    await page.getByTestId("confirm-import").click();
    await expect(page.getByTestId("rows-added")).toHaveText("9");
  });
});
