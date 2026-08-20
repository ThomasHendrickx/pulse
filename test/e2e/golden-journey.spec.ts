import { expect, test, type Page } from "@playwright/test";
import { join } from "node:path";

// THE GOLDEN JOURNEY (criterion 4.1, pulse-v1-architecture.md:243: written
// FIRST, before the view exists; it is the strongest spec artifact in the
// project and the red witness for the whole month view). A three-file
// journey across two source profiles, on a fresh household:
//
//   1. sign in (fresh sign-up, so no earlier run can leak into totals)
//   2. upload the current-account fixture (profile 1), declare and confirm
//   3. upload the second pot account fixture with the other transfer leg
//   4. upload the card fixture (profile 2: no counterparty-account column,
//      no sequence numbers, line items plus the settlement mirror row)
//   5. open the month view for August 2026 and assert everything below
//
// The Playwright webServer runs with PULSE_FIXED_NOW=2026-09-15T12:00:00Z
// (playwright.config.ts), so August 2026 is a CLOSED month compared to
// July 2026, and the suite is deterministic forever.
//
// FIXTURE ARITHMETIC, derived from the committed fixtures BY HAND, never
// read back from the implementation.
//
// gj-current.csv (account A, IBAN BE68539007547034, profile 1):
//   July:   +2.400,00 salary (INCOME), -95,20 Supermarkt Noord (SPEND)
//   August: +2.500,00 salary (INCOME)
//           -12,50 Cafe Zomer, -86,47 Supermarkt Noord,
//           -950,00 Jan Peeters (all SPEND)
//           -300,00 transfer to B's IBAN (INTERNAL, paired with B's leg)
//           -850,00 MASTERCARD AFREKENING NUMMER 51 (INTERNAL, settles
//                   the card statement below; card line items are the
//                   only counted spend)
// gj-pot-b.csv (account B, IBAN BE20539007547099, same profile 1):
//   August: +300,00 from A (INTERNAL, the other transfer leg)
//           -20,00 Bakkerij Centrum (SPEND)
// gj-card.csv (card account, profile 2):
//   August line items (SPEND, counted exactly once):
//           -450,00 PIZZA NAPOLI, -250,00 ELEKTRO CITY,
//           -150,00 BOEKHANDEL DE MAAN; debits total 850,00
//           +850,00 DOMICILIERING VIA JE BANK (INTERNAL mirror leg)
//
// August totals:
//   income        = 2.500,00
//   spend         = 12,50 + 86,47 + 950,00 + 20,00
//                 + 450,00 + 250,00 + 150,00              = 1.918,97
//   net to reserves = 0,00 (no reserve account declared)
//   change in pot = (2.500,00 - 12,50 - 86,47 - 950,00 - 300,00 - 850,00)
//                 + (300,00 - 20,00) + (-850,00 + 850,00) = 581,03
//   identity: 2.500,00 - 1.918,97 - 0,00 = 581,03; difference ZERO.
// July totals (comparison baseline): income 2.400,00, spend 95,20, so the
//   Acme income group moves up 100,00 and Supermarkt Noord down 8,73.

const FIXTURES = join(__dirname, "..", "fixtures");

const uploadAndDeclare = async (
  page: Page,
  file: string,
  declaration:
    | { readonly profileName: string; readonly label: string; readonly bank: string }
    | undefined,
  expectedAdded: string,
): Promise<void> => {
  await page.goto("/import");
  await page.getByLabel("Bank export file").setInputFiles(join(FIXTURES, file));
  await page.getByRole("button", { name: "Upload" }).click();
  await expect(
    page.getByRole("heading", { name: "Confirm the detected format" }),
  ).toBeVisible();
  if (declaration !== undefined) {
    await page.getByLabel("Format name").fill(declaration.profileName);
    await page.getByLabel("Label").fill(declaration.label);
    await page.getByLabel("Bank").fill(declaration.bank);
    await page.getByLabel("Ring").selectOption("POT");
  }
  await page.getByTestId("confirm-import").click();
  await expect(page.getByTestId("import-result")).toBeVisible();
  await expect(page.getByTestId("rows-added")).toHaveText(expectedAdded);
};

test("golden journey: three files, two profiles, one month view whose books close", async ({
  page,
}) => {
  const unique = `golden-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
  const email = `${unique}@pulse-e2e.test`;
  const password = `pw-${unique}`;

  // Sign in on a fresh household.
  await page.goto("/sign-up");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Create household" }).click();
  await expect(page.getByTestId("household-context")).toHaveText(unique);

  // File 1: the current account (profile 1), declared at first sight.
  await uploadAndDeclare(
    page,
    "gj-current.csv",
    { profileName: "Demobank current account", label: "Daily account", bank: "Demobank" },
    "8",
  );

  // File 2: the second pot account, same profile, new account. It carries
  // the OTHER leg of the 300,00 transfer, which heals A's unmatched leg.
  await page.goto("/import");
  await page
    .getByLabel("Bank export file")
    .setInputFiles(join(FIXTURES, "gj-pot-b.csv"));
  await page.getByRole("button", { name: "Upload" }).click();
  await expect(
    page.getByRole("heading", { name: "Confirm the detected format" }),
  ).toBeVisible();
  await page.getByLabel("Format name").fill("Demobank current account");
  await page.getByLabel("Label").fill("Second account");
  await page.getByLabel("Bank").fill("Demobank");
  await page.getByLabel("Ring").selectOption("POT");
  await page.getByTestId("confirm-import").click();
  await expect(page.getByTestId("import-result")).toBeVisible();
  await expect(page.getByTestId("rows-added")).toHaveText("2");

  // File 3: the card (profile 2: no counterparty-account column, no
  // sequence numbers, line items plus the settlement mirror row).
  await uploadAndDeclare(
    page,
    "gj-card.csv",
    { profileName: "Card statement", label: "Credit card", bank: "KBC" },
    "4",
  );

  // The month view, August 2026 (a closed month under the fixed clock).
  await page.goto("/?month=2026-08");
  await expect(page.getByTestId("month-title")).toHaveText("August 2026");
  await expect(page.getByTestId("in-progress-badge")).toHaveCount(0);

  // Income, spend, reserves and pot-change totals against the fixtures'
  // known values (derived in the header comment above).
  await expect(page.getByTestId("income-total")).toHaveText("2.500,00");
  await expect(page.getByTestId("spend-total")).toHaveText("1.918,97");
  await expect(page.getByTestId("reserves-net")).toHaveText("0,00");
  await expect(page.getByTestId("no-reserves")).toBeVisible();
  await expect(page.getByTestId("pot-change")).toHaveText("581,03");

  // Card line items are counted as spend EXACTLY ONCE: each card merchant
  // appears as one spend group carrying the line item amount.
  const pizza = page.getByTestId("spend-group").filter({ hasText: "PIZZA NAPOLI" });
  await expect(pizza).toHaveCount(1);
  await expect(pizza.getByTestId("group-total")).toHaveText("450,00");
  const elektro = page.getByTestId("spend-group").filter({ hasText: "ELEKTRO CITY" });
  await expect(elektro).toHaveCount(1);
  await expect(elektro.getByTestId("group-total")).toHaveText("250,00");

  // The settlement pair is excluded from BOTH sides: the 850,00 debit and
  // its card-side mirror appear in no group and no total, and the paired
  // 300,00 internal transfer is excluded the same way. The whole main
  // region is checked, so neither amount can hide in any block.
  await expect(page.getByRole("main")).not.toContainText("850,00");
  await expect(page.getByRole("main")).not.toContainText("MASTERCARD");
  await expect(page.getByRole("main")).not.toContainText("300,00");
  // The card settlement is INTERNAL, not income: income holds exactly the
  // one salary group.
  await expect(page.getByTestId("income-group")).toHaveCount(1);
  await expect(page.getByTestId("income-group")).toContainText("ACME SALARIS");

  // Comparison against the previous CLOSED month is part of the view:
  // July's baseline gives the salary group +100,00 and Supermarkt -8,73.
  await expect(page.getByTestId("compare-head")).toContainText("July");
  await expect(
    page.getByTestId("income-group").getByTestId("group-delta"),
  ).toContainText("100,00");
  const supermarkt = page
    .getByTestId("spend-group")
    .filter({ hasText: "SUPERMARKT NOORD" });
  await expect(supermarkt.getByTestId("group-delta")).toContainText("8,73");

  // The reconciliation panel SHIPS in the view and the books close:
  // income - spend - net to reserves = change in pot, difference zero.
  const recon = page.getByTestId("recon-panel");
  await expect(recon).toBeVisible();
  await expect(recon).toHaveAttribute("data-state", "ok");
  await expect(recon.getByTestId("recon-income")).toHaveText("2.500,00");
  await expect(recon.getByTestId("recon-spend")).toHaveText("1.918,97");
  await expect(recon.getByTestId("recon-reserves")).toHaveText("0,00");
  await expect(recon.getByTestId("recon-pot")).toHaveText("581,03");
  // Zero difference: no difference figure and no named cause is shown.
  await expect(recon.getByTestId("recon-difference")).toHaveCount(0);
  await expect(recon.getByTestId("recon-cause-unmatched")).toHaveCount(0);
  await expect(recon.getByTestId("recon-cause-unresolved")).toHaveCount(0);
});
