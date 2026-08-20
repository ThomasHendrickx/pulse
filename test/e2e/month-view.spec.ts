import { expect, test, type Page } from "@playwright/test";
import { join } from "node:path";

// The month view's dangerous states (criteria 4.2, 4.3, 4.4), each on a
// fresh household. The webServer's clock is fixed at 2026-09-15T12:00:00Z
// (playwright.config.ts), so September 2026 is the partial current month
// mid-month (day 15 of 30) and August 2026 a closed month, forever.
//
// Fixture arithmetic, derived by hand:
//   mv-partial.csv (September): +2.500,00 salary; -45,00 and -12,00 spend
//     => income 2.500,00, spend 57,00, pot change 2.443,00.
//   mv-gapped-a.csv (August, account A): +2.000,00 salary, -100,00 spend,
//     -400,00 transfer to account B's IBAN.
//   mv-gapped-b.csv (August, account B): -50,00 spend and NO incoming
//     400,00 leg: a deliberate export gap. A's leg stays INTERNAL and
//     unmatched => income 2.000,00, spend 150,00, pot change 1.450,00,
//     difference 1.450,00 - (2.000,00 - 150,00) = -400,00.
//   mv-unresolved.csv (August): +1.000,00 salary, -200,00 rent, and one
//     zero-amount row no rule can classify (sign carries the whole
//     classification fallback, and zero has no direction to read):
//     UNRESOLVED, visible, in no total, named by the panel.

const FIXTURES = join(__dirname, "..", "fixtures");

const signUp = async (page: Page, prefix: string): Promise<void> => {
  const unique = `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
  await page.goto("/sign-up");
  await page.getByLabel("Email").fill(`${unique}@pulse-e2e.test`);
  await page.getByLabel("Password").fill(`pw-${unique}`);
  await page.getByRole("button", { name: "Create household" }).click();
  await expect(page.getByTestId("household-context")).toHaveText(unique);
};

const uploadPotFile = async (
  page: Page,
  file: string,
  label: string,
  expectedAdded: string,
): Promise<void> => {
  await page.goto("/import");
  await page.getByLabel("Bank export file").setInputFiles(join(FIXTURES, file));
  await page.getByRole("button", { name: "Upload" }).click();
  await expect(
    page.getByRole("heading", { name: "Confirm the detected format" }),
  ).toBeVisible();
  await page.getByLabel("Format name").fill("Demobank current account");
  await page.getByLabel("Label").fill(label);
  await page.getByLabel("Bank").fill("Demobank");
  await page.getByLabel("Ring").selectOption("POT");
  await page.getByTestId("confirm-import").click();
  await expect(page.getByTestId("import-result")).toBeVisible();
  await expect(page.getByTestId("rows-added")).toHaveText(expectedAdded);
};

// Criterion 4.2 (hazard H4.1): the partial current month renders the
// in-progress state and NO comparison, under the fixed mid-month clock.
test("the partial current month is in progress and never compared", async ({
  page,
}) => {
  await signUp(page, "mv-partial");
  await uploadPotFile(page, "mv-partial.csv", "Daily account", "3");

  await page.goto("/");
  await expect(page.getByTestId("month-title")).toHaveText("September 2026");
  await expect(page.getByTestId("in-progress-badge")).toBeVisible();
  await expect(page.getByTestId("in-progress-badge")).toHaveText("In progress");
  await expect(page.getByTestId("month-meta")).toContainText("15 / 30 days");

  // No comparison anywhere: the compare column head says so, and not one
  // delta renders, neither per group nor on the section total.
  await expect(page.getByTestId("compare-na")).toBeVisible();
  await expect(page.getByTestId("group-delta")).toHaveCount(0);
  await expect(page.getByTestId("spend-delta")).toHaveCount(0);

  // The totals still render, marked in progress, not as a collapse.
  await expect(page.getByTestId("income-total")).toHaveText("2.500,00");
  await expect(page.getByTestId("spend-total")).toHaveText("57,00");
  await expect(page.getByTestId("pot-change")).toHaveText("2.443,00");
  const recon = page.getByTestId("recon-panel");
  await expect(recon).toHaveAttribute("data-state", "ok");
  await expect(recon).toContainText("Holds so far this month.");
});

// Criterion 4.3 first half (hazard H4.2): a deliberately gapped export
// leaves an unmatched internal leg; the view shows the unexplained
// difference in the ALARM treatment and NAMES the leg, and the leg's
// amount is folded into no total.
test("a gapped export shows the difference in alarm treatment and names the unmatched leg", async ({
  page,
}) => {
  await signUp(page, "mv-gapped");
  await uploadPotFile(page, "mv-gapped-a.csv", "Daily account", "3");
  await uploadPotFile(page, "mv-gapped-b.csv", "Second account", "1");

  await page.goto("/?month=2026-08");
  const recon = page.getByTestId("recon-panel");
  await expect(recon).toHaveAttribute("data-state", "broken");
  await expect(recon).toContainText("Books do not close");
  await expect(recon.getByTestId("recon-difference")).toHaveText("-400,00");

  // The alarm treatment is real, not a label: the verdict renders in the
  // one alarm colour the design system has (--color-alarm, used for
  // unreconciled books and nothing else).
  const alarmApplied = await page.evaluate(() => {
    const panel = document.querySelector('[data-testid="recon-panel"]');
    const verdict = panel?.querySelector(".recon-verdict");
    if (!(verdict instanceof HTMLElement)) {
      return { verdict: "", alarm: "" };
    }
    const probe = document.createElement("span");
    probe.style.color = "var(--color-alarm)";
    document.body.appendChild(probe);
    const alarm = getComputedStyle(probe).color;
    probe.remove();
    return { verdict: getComputedStyle(verdict).color, alarm };
  });
  expect(alarmApplied.verdict).toBe(alarmApplied.alarm);
  expect(alarmApplied.alarm).not.toBe("");

  // The cause is named: one unmatched transfer leg, its amount, its
  // counterparty and the account whose export has the gap's other side.
  const cause = recon.getByTestId("recon-cause-unmatched");
  await expect(cause).toBeVisible();
  await expect(cause).toContainText("1 transfer leg");
  await expect(cause).toContainText("400,00");
  const leg = cause.getByTestId("unmatched-leg");
  await expect(leg).toHaveCount(1);
  await expect(leg).toContainText("Demobank Plus");
  await expect(leg).toContainText("Daily account");

  // Excluded from both sides: the totals carry no cent of the leg.
  await expect(page.getByTestId("income-total")).toHaveText("2.000,00");
  await expect(page.getByTestId("spend-total")).toHaveText("150,00");
  await expect(page.getByTestId("pot-change")).toHaveText("1.450,00");
});

// Criterion 4.3 second half: a transaction no rule can classify renders
// as a visible UNRESOLVED gap, its amount appears in no income, spend or
// reserves total, and the reconciliation panel names it.
test("an unclassifiable transaction is a visible unresolved gap, in no total, named by the panel", async ({
  page,
}) => {
  await signUp(page, "mv-unres");
  await uploadPotFile(page, "mv-unresolved.csv", "Daily account", "3");

  await page.goto("/?month=2026-08");
  await expect(page.getByTestId("income-total")).toHaveText("1.000,00");
  await expect(page.getByTestId("spend-total")).toHaveText("200,00");
  await expect(page.getByTestId("reserves-net")).toHaveText("0,00");
  await expect(page.getByTestId("pot-change")).toHaveText("800,00");

  const recon = page.getByTestId("recon-panel");
  const cause = recon.getByTestId("recon-cause-unresolved");
  await expect(cause).toBeVisible();
  await expect(cause).toContainText("1 transaction");
  await expect(cause).toContainText("0,00");
  const gap = cause.getByTestId("unresolved-gap");
  await expect(gap).toHaveCount(1);
  await expect(gap).toContainText("KAARTVERGOEDING");

  // The unclassifiable row does not leak into any group either.
  await expect(
    page.getByTestId("spend-group").filter({ hasText: "KAARTVERGOEDING" }),
  ).toHaveCount(0);
  await expect(
    page.getByTestId("income-group").filter({ hasText: "KAARTVERGOEDING" }),
  ).toHaveCount(0);
});

// Criterion 4.4 (hazard H4.3): all three locales render the month view
// without truncation or layout overflow. The gapped dataset is used
// because it renders the longest copy the view has (alarm note, cause
// sentences, unmatched leg rows). Dutch and French run longer than
// English, so nothing may depend on short text.
test("the month view renders in EN, NL and FR without truncation or overflow", async ({
  page,
  baseURL,
}) => {
  await signUp(page, "mv-locale");
  await uploadPotFile(page, "mv-gapped-a.csv", "Daily account", "3");
  await uploadPotFile(page, "mv-gapped-b.csv", "Second account", "1");

  const expectations = [
    { locale: "en", title: "August 2026", verdict: "Books do not close" },
    { locale: "nl", title: "augustus 2026", verdict: "De boeken kloppen niet" },
    { locale: "fr", title: "août 2026", verdict: "Les comptes ne sont pas bouclés" },
  ] as const;

  for (const { locale, title, verdict } of expectations) {
    await page.context().addCookies([
      { name: "locale", value: locale, url: baseURL ?? "http://127.0.0.1:3000" },
    ]);
    await page.goto("/?month=2026-08");
    await expect(page.getByTestId("month-title")).toHaveText(title);
    await expect(page.getByTestId("recon-panel")).toContainText(verdict);
    await expect(page.getByTestId("recon-cause-unmatched")).toBeVisible();

    // No layout overflow: the page body never scrolls horizontally.
    const overflow = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth);

    // No truncation: every element the view marks as non-wrapping (and
    // the headline pieces) fits its box, so no locale's copy is clipped.
    const clipped = await page.evaluate(() => {
      const selectors = [
        '[data-testid="month-title"]',
        '[data-testid="in-progress-badge"]',
        ".recon-verdict",
        ".recon-part-label",
        ".pulse-amount",
        ".month-row-meta",
        '[data-testid="compare-head"]',
      ];
      const offenders: string[] = [];
      for (const selector of selectors) {
        for (const element of document.querySelectorAll(selector)) {
          if (
            element instanceof HTMLElement &&
            element.scrollWidth > element.clientWidth + 1
          ) {
            offenders.push(`${selector}: ${element.textContent ?? ""}`);
          }
        }
      }
      return offenders;
    });
    expect(clipped).toEqual([]);
  }
});
