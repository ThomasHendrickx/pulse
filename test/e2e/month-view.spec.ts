import { expect, test, type Page } from "@playwright/test";
import { join } from "node:path";

// The month view's dangerous states (criteria 4.2, 4.3, 4.4), each on a
// fresh household. The webServer's clock is fixed at 2026-09-15T12:00:00Z
// (playwright.config.ts), so September 2026 is the partial current month
// mid-month (day 15 of 30) and August 2026 a closed month, forever.
//
// Fixture arithmetic, derived by hand:
//   mv-partial.csv (September): +2.500,00 salary; -45,00 and -12,00
//     spend; -100,00 MAESTRO GELDOPNAME cash withdrawal (its own "cash"
//     destination, never split, M1-P4 open question M1P4-C7 resolved in
//     this phase's projection)
//     => income 2.500,00, spend 157,00, pot change 2.343,00.
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
//   mv-transit-a.csv (August, account A): +1.500,00 salary; -300,00
//     transfer to B booked 30/08. mv-transit-b.csv (account B): the
//     +300,00 other leg booked 02/09. The pair MATCHES (3 days apart),
//     and each month sees exactly one leg: money in transit across the
//     month boundary (fix round 1, CR-501). August: income 1.500,00,
//     spend 0,00, pot change 1.200,00, difference -300,00 explained
//     entirely by the in-transit leg.
//   mv-cancel-a.csv (August, account A): +1.000,00 salary; -400,00
//     transfer to B booked 05/08. mv-cancel-b.csv (account B): +400,00
//     from A booked 25/08. Twenty days apart, so the legs do NOT pair:
//     two genuine unmatched legs whose amounts cancel, difference zero
//     over two real export gaps (fix round 1, CR-501 probe P-B1).

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
  await uploadPotFile(page, "mv-partial.csv", "Daily account", "4");

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
  await expect(page.getByTestId("spend-total")).toHaveText("157,00");
  await expect(page.getByTestId("pot-change")).toHaveText("2.343,00");

  // The cash withdrawal is its own destination (correction 4, M1P4-C7):
  // one "Cash" spend group carrying the withdrawn amount, and the raw
  // descriptor appears in no group.
  const cashGroup = page.getByTestId("spend-group").filter({ hasText: "Cash" });
  await expect(cashGroup).toHaveCount(1);
  await expect(cashGroup.getByTestId("group-total")).toHaveText("100,00");
  await expect(
    page.getByTestId("spend-group").filter({ hasText: "GELDOPNAME" }),
  ).toHaveCount(0);
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
  // Fix round 1 (CR-501): "Books close" must never render above a
  // listed gap, so the ok verdict is refused even though the
  // zero-amount row leaves the difference at zero.
  await expect(recon).toHaveAttribute("data-state", "broken");
  await expect(recon.getByTestId("recon-difference")).toHaveCount(0);
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

// Fix round 1, CR-501: a matched pair whose legs book in neighbouring
// months is money in transit, not a bare alarm. The panel names it as
// its own cause, the causes sum exactly to the difference, and the ok
// verdict is refused while anything is in transit.
test("a transfer in transit across the month boundary is a named cause, not a bare alarm", async ({
  page,
}) => {
  await signUp(page, "mv-transit");
  await uploadPotFile(page, "mv-transit-a.csv", "Daily account", "2");
  await uploadPotFile(page, "mv-transit-b.csv", "Second account", "1");

  await page.goto("/?month=2026-08");
  await expect(page.getByTestId("income-total")).toHaveText("1.500,00");
  await expect(page.getByTestId("spend-total")).toHaveText("0,00");
  await expect(page.getByTestId("pot-change")).toHaveText("1.200,00");

  const recon = page.getByTestId("recon-panel");
  await expect(recon).toHaveAttribute("data-state", "broken");
  await expect(recon.getByTestId("recon-difference")).toHaveText("-300,00");

  // The one cause names the leg, and the causes sum exactly to the
  // difference: the in-transit net of -300,00 IS the -300,00 above,
  // with no unmatched and no unresolved contribution.
  const cause = recon.getByTestId("recon-cause-in-transit");
  await expect(cause).toBeVisible();
  await expect(cause).toContainText("1 transfer leg");
  await expect(cause).toContainText("300,00");
  const leg = cause.getByTestId("in-transit-leg");
  await expect(leg).toHaveCount(1);
  await expect(leg).toContainText("Demobank Plus");
  await expect(recon.getByTestId("recon-cause-unmatched")).toHaveCount(0);
  await expect(recon.getByTestId("recon-cause-unresolved")).toHaveCount(0);

  // The neighbouring month carries the opposite leg of the same pair.
  await page.goto("/?month=2026-09");
  const reconNext = page.getByTestId("recon-panel");
  await expect(reconNext).toHaveAttribute("data-state", "broken");
  await expect(reconNext.getByTestId("recon-difference")).toHaveText("300,00");
  await expect(reconNext.getByTestId("recon-cause-in-transit")).toBeVisible();
});

// Fix round 1, CR-501 (probe P-B1): two genuine unmatched legs whose
// amounts cancel leave the difference at zero; the books must still
// refuse to close, because the verdict is about gaps, not about the
// residual happening to cancel.
test("cancelling gaps do not close the books", async ({ page }) => {
  await signUp(page, "mv-cancel");
  await uploadPotFile(page, "mv-cancel-a.csv", "Daily account", "2");
  await uploadPotFile(page, "mv-cancel-b.csv", "Second account", "1");

  await page.goto("/?month=2026-08");
  const recon = page.getByTestId("recon-panel");
  await expect(recon).toHaveAttribute("data-state", "broken");
  await expect(recon).toContainText("Books do not close");
  // The difference is zero, so no difference figure renders; the named
  // gaps are what keep the verdict honest.
  await expect(recon.getByTestId("recon-difference")).toHaveCount(0);
  const cause = recon.getByTestId("recon-cause-unmatched");
  await expect(cause).toBeVisible();
  await expect(cause).toContainText("2 transfer legs");
  await expect(cause.getByTestId("unmatched-leg")).toHaveCount(2);
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

// ---------------------------------------------------------------------
// M3-P7, the mobile-first rebuild (DR-0022). Everything below MEASURES
// WHETHER THE SCREEN CAN BE USED, which is the bar the orchestrator's own
// recorded wording ("visible and clickable with no horizontal scrolling")
// did not reach: the row this phase replaced neither overflowed nor
// clipped at 390 and was still graded 1 out of 10 for usability.
//
// Every measurement below runs on the DENSE dataset as well as on the
// small committed ones (criterion 7.13). The dense one exists because the
// owner's real month is dozens of transactions with zero merchant rules,
// so every spend row folds under a raw bank descriptor, and a three-row
// fixture cannot reproduce the screen that was graded.
// ---------------------------------------------------------------------

const PHONE = { width: 390, height: 844 } as const;
const NARROW_PHONE = { width: 360, height: 740 } as const;
const DESK = { width: 1280, height: 720 } as const;

// The tap-target floor, and the floors criterion 7.14 sets. Literals
// belong in a spec: the ban on literals is a ban on literals in
// COMPONENTS (CLAUDE.md non-negotiable 4), and a measurement that read its
// own bar out of the stylesheet it is measuring would be a mirror.
const TAP_MIN = 44;
const NAME_RATIO_MIN = 0.55;
const NAME_FLOOR = { 390: 180, 360: 160 } as const;
const FOLD = 700;
const ROW_TESTIDS = ["spend-group", "income-group", "reserve-group"] as const;
const LABEL_MIN_LENGTH = 28;
const DENSE_SPEND_GROUPS = 23;

const INTERACTIVE = "a, button, input:not([type=hidden]), select, [role=button]";

const seedDense = async (page: Page): Promise<void> => {
  await signUp(page, "mv-dense");
  await uploadPotFile(page, "mv-dense.csv", "Daily account", "25");
};

// Criterion 7.5. Every interactive control in the shell header and in main
// is at least TAP_MIN tall, and the failure message names each offender.
const tapTargetOffenders = (page: Page): Promise<string[]> =>
  page.evaluate(
    ({ selector, min }) => {
      const roots = [
        document.querySelector("header.app-header"),
        document.querySelector("main"),
      ];
      const offenders: string[] = [];
      for (const root of roots) {
        if (root === null) {
          continue;
        }
        for (const element of root.querySelectorAll(selector)) {
          const rect = element.getBoundingClientRect();
          if (rect.width === 0 && rect.height === 0) {
            continue;
          }
          if (rect.height < min) {
            const name =
              element.getAttribute("data-testid") ??
              (element.textContent ?? "").trim().slice(0, 40);
            offenders.push(`${name}: ${Math.round(rect.height)}px`);
          }
        }
      }
      return offenders;
    },
    { selector: INTERACTIVE, min: TAP_MIN },
  );

// Criterion 7.6. Every element carrying a data-testid, as the pair of its
// testid and its trimmed text, sorted, with its box and its hiding.
const collectTestids = (page: Page) =>
  page.evaluate(() =>
    [...document.querySelectorAll("[data-testid]")]
      .map((element) => {
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return {
          testId: element.getAttribute("data-testid") ?? "",
          text: (element.textContent ?? "").trim(),
          width: rect.width,
          height: rect.height,
          hidden:
            style.display === "none" ||
            style.visibility === "hidden" ||
            element.classList.contains("visually-hidden"),
        };
      })
      .sort((a, b) =>
        `${a.testId} ${a.text}`.localeCompare(`${b.testId} ${b.text}`),
      ),
  );

// Criterion 7.7 (a) and (b). Horizontal clipping over everything inside
// main that is not .visually-hidden, and vertical clipping over the
// elements that actually clip: an element with visible overflow reports
// content height it is not hiding.
const clippingOffenders = (page: Page) =>
  page.evaluate(() => {
    const horizontal: string[] = [];
    const vertical: string[] = [];
    const main = document.querySelector("main");
    if (main === null) {
      return { horizontal: ["no main element"], vertical: [] };
    }
    const name = (element: Element): string =>
      element.getAttribute("data-testid") ??
      (element.textContent ?? "").trim().slice(0, 40);
    for (const element of main.querySelectorAll("*")) {
      if (!(element instanceof HTMLElement)) {
        continue;
      }
      if (
        !element.matches(".visually-hidden") &&
        element.scrollWidth > element.clientWidth + 1
      ) {
        horizontal.push(`${name(element)} (horizontal)`);
      }
      const overflowY = getComputedStyle(element).overflowY;
      if (
        ["hidden", "clip", "scroll", "auto"].includes(overflowY) &&
        element.scrollHeight > element.clientHeight + 1
      ) {
        vertical.push(`${name(element)} (vertical)`);
      }
    }
    return { horizontal, vertical };
  });

// Criterion 7.14, the criterion this phase exists for. Track count, name
// width against the row's BORDER box, and the two lines. The border box is
// the denominator on purpose: the row's own padding sits inside the
// content box, so padding the row out can no longer move the number the
// ratio is taken against, and the absolute floor catches the other cheat,
// narrowing everything one level up.
const rowOffenders = (page: Page, viewportWidth: 390 | 360) =>
  page.evaluate(
    ({ testIds, ratioMin, floor }) => {
      const trackCount: string[] = [];
      const nameWidth: string[] = [];
      const twoLines: string[] = [];
      const main = document.querySelector("main");
      if (main === null) {
        return { trackCount: ["no main element"], nameWidth: [], twoLines: [] };
      }
      const tracks = (element: Element): number => {
        const value = getComputedStyle(element).gridTemplateColumns;
        return value === "none" ? 0 : value.trim().split(/\s+/).length;
      };
      for (const element of main.querySelectorAll(".month-columns, .month-row")) {
        const count = tracks(element);
        if (count > 2) {
          trackCount.push(
            `${(element.textContent ?? "").trim().slice(0, 40)}: ${count} tracks`,
          );
        }
      }
      const selector = testIds.map((id) => `[data-testid="${id}"]`).join(", ");
      for (const row of main.querySelectorAll(selector)) {
        const label = row.querySelector(
          '[data-testid="group-label"], .month-group-label',
        );
        const total = row.querySelector('[data-testid="group-total"]');
        const count = row.querySelector(".month-row-count");
        const delta = row.querySelector('[data-testid="group-delta"]');
        const rowName = (label?.textContent ?? "").trim().slice(0, 40);
        if (label === null || total === null) {
          nameWidth.push(`${rowName}: missing label or total`);
          continue;
        }
        const rowRect = row.getBoundingClientRect();
        const labelRect = label.getBoundingClientRect();
        const totalRect = total.getBoundingClientRect();
        const distance = totalRect.left - labelRect.left;
        const ratio = distance / rowRect.width;
        if (ratio < ratioMin || distance < floor) {
          nameWidth.push(
            `${rowName}: name area ${Math.round(distance)}px of a ${Math.round(rowRect.width)}px border box, ${Math.round(ratio * 100)} percent`,
          );
        }
        if (Math.abs(totalRect.top - labelRect.top) > 6) {
          twoLines.push(`${rowName}: the amount is not on line one`);
        }
        if (count === null) {
          twoLines.push(`${rowName}: no row count renders`);
        } else if (count.getBoundingClientRect().top < labelRect.bottom - 2) {
          twoLines.push(`${rowName}: the row count sits beside the name`);
        }
        if (
          delta !== null &&
          delta.getBoundingClientRect().top < labelRect.bottom - 2
        ) {
          twoLines.push(`${rowName}: the delta sits beside the name`);
        }
      }
      return { trackCount, nameWidth, twoLines };
    },
    {
      testIds: ROW_TESTIDS,
      ratioMin: NAME_RATIO_MIN,
      floor: NAME_FLOOR[viewportWidth],
    },
  );

const setLocale = async (
  page: Page,
  locale: string,
  base: string | undefined,
): Promise<void> => {
  await page.context().addCookies([
    { name: "locale", value: locale, url: base ?? "http://127.0.0.1:3000" },
  ]);
};

// Criterion 7.2 (hazard H7.7). The tag is a FRAMEWORK DEFAULT this project
// does not control, which is why it is pinned rather than dropped: a later
// viewport export that lost width=device-width would silently render the
// product at the 980px fallback on a real phone while every measurement
// here stayed green. Only a project with isMobile can see it at all.
test("the rendered page pins the layout viewport to the device width", async ({
  page,
}) => {
  await page.goto("/sign-in");
  const content = await page.evaluate(
    () =>
      document.querySelector('meta[name="viewport"]')?.getAttribute("content") ??
      null,
  );
  expect(content).not.toBeNull();
  expect(content).toContain("width=device-width");
});

// Criteria 7.5, 7.7, 7.8, 7.9 and 7.14 on the DENSE dataset (criterion
// 7.13): 23 spend groups under raw descriptors, which is the shape of the
// screen the owner graded.
test("the dense month is usable at 390 and at 360: targets, rows, cards and the verdict", async ({
  page,
  baseURL,
}) => {
  await seedDense(page);

  for (const viewport of [PHONE, NARROW_PHONE] as const) {
    await page.setViewportSize(viewport);
    await page.goto("/?month=2026-08");
    await expect(page.getByTestId("spend-group")).toHaveCount(DENSE_SPEND_GROUPS);

    expect(
      await tapTargetOffenders(page),
      `tap targets at ${viewport.width}`,
    ).toEqual([]);

    const rows = await rowOffenders(page, viewport.width as 390 | 360);
    expect(rows.trackCount, `track count at ${viewport.width}`).toEqual([]);
    expect(rows.nameWidth, `name width at ${viewport.width}`).toEqual([]);
    expect(rows.twoLines, `two-line rows at ${viewport.width}`).toEqual([]);

    for (const locale of ["en", "nl", "fr"]) {
      await setLocale(page, locale, baseURL);
      await page.goto("/?month=2026-08");
      const clipped = await clippingOffenders(page);
      expect(clipped.horizontal, `${locale} at ${viewport.width}`).toEqual([]);
      expect(clipped.vertical, `${locale} at ${viewport.width}`).toEqual([]);

      // Criterion 7.7 (d): the label is not shortened BEFORE render, which
      // clips nothing and would pass every other axis here. The fixture
      // defines these strings, so the comparison is exact.
      const labels = (
        await page
          .getByTestId("spend-group")
          .getByTestId("group-label")
          .allTextContents()
      ).map((text) => text.trim());
      for (const label of labels) {
        expect(label.length, label).toBeGreaterThanOrEqual(LABEL_MIN_LENGTH);
        expect(label).not.toContain("…");
        expect(label).not.toMatch(/\.\.\.$/);
      }
      expect(labels).toContain("ONDERHOUDSCONTRACT VERWARMINGSKETEL WARMTEHUIS");
      expect(labels).toContain(
        "WASSERIJ EN STRIJKATELIER SCHONE VOUW BESTELLING",
      );
    }
    await setLocale(page, "en", baseURL);
  }

  // Criterion 7.8: the verdict is inside the first screenful at 390, in
  // all three languages. 700 is 844 less an allowance for the browser
  // chrome a real phone spends and Playwright does not render.
  await page.setViewportSize(PHONE);
  for (const locale of ["en", "nl", "fr"]) {
    await setLocale(page, locale, baseURL);
    await page.goto("/?month=2026-08");
    const box = await page.getByTestId("recon-verdict").boundingBox();
    expect(box, `verdict box in ${locale}`).not.toBeNull();
    expect(box?.y ?? -1, `verdict top in ${locale}`).toBeGreaterThanOrEqual(0);
    expect(
      (box?.y ?? 0) + (box?.height ?? 0),
      `verdict bottom in ${locale}`,
    ).toBeLessThanOrEqual(FOLD);
  }
  await setLocale(page, "en", baseURL);

  // Criterion 7.9: one column in DOM order income, spend, reserves at
  // phone width, and the rail as a WIDENING at the desk width.
  await page.goto("/?month=2026-08");
  const domOrder = await page.evaluate(() =>
    [
      ...document.querySelectorAll(
        '[data-testid="income-card"], [data-testid="spend-card"], [data-testid="reserves-card"]',
      ),
    ].map((element) => element.getAttribute("data-testid")),
  );
  expect(domOrder).toEqual(["income-card", "spend-card", "reserves-card"]);

  const cardBoxes = (target: Page) =>
    target.evaluate(() =>
      ["income-card", "spend-card", "reserves-card"].map((id) => {
        const rect = document
          .querySelector(`[data-testid="${id}"]`)
          ?.getBoundingClientRect();
        return {
          id,
          x: rect?.x ?? -1,
          y: rect?.y ?? -1,
          width: rect?.width ?? -1,
        };
      }),
    );

  const phoneBoxes = await cardBoxes(page);
  expect(phoneBoxes).toHaveLength(3);
  const [phoneIncome, phoneSpend, phoneReserves] = phoneBoxes as [
    (typeof phoneBoxes)[number],
    (typeof phoneBoxes)[number],
    (typeof phoneBoxes)[number],
  ];
  expect(Math.abs(phoneIncome.x - phoneSpend.x)).toBeLessThanOrEqual(1);
  expect(Math.abs(phoneIncome.x - phoneReserves.x)).toBeLessThanOrEqual(1);
  expect(Math.abs(phoneIncome.width - phoneSpend.width)).toBeLessThanOrEqual(1);
  expect(Math.abs(phoneIncome.width - phoneReserves.width)).toBeLessThanOrEqual(1);
  expect(phoneIncome.y).toBeLessThan(phoneSpend.y);
  expect(phoneSpend.y).toBeLessThan(phoneReserves.y);

  await page.setViewportSize(DESK);
  await page.goto("/?month=2026-08");
  const deskBoxes = await cardBoxes(page);
  expect(deskBoxes).toHaveLength(3);
  const [deskIncome, deskSpend, deskReserves] = deskBoxes as [
    (typeof deskBoxes)[number],
    (typeof deskBoxes)[number],
    (typeof deskBoxes)[number],
  ];
  expect(deskSpend.x).toBeLessThan(deskIncome.x);
  expect(Math.abs(deskIncome.x - deskReserves.x)).toBeLessThanOrEqual(1);
});

// Criterion 7.6 (hazard H7.2). The mockup is not allowed to make the phone
// tidy by saying less: the SAME testids with the SAME text render at both
// widths, every one of them has a box, and nothing is hidden at one width
// and not at the other.
test("the dense month says exactly the same things at 1280 and at 390", async ({
  page,
}) => {
  await seedDense(page);

  await page.setViewportSize(DESK);
  await page.goto("/?month=2026-08");
  const desk = await collectTestids(page);

  await page.setViewportSize(PHONE);
  await page.goto("/?month=2026-08");
  const phone = await collectTestids(page);

  expect(phone.map((entry) => [entry.testId, entry.text])).toEqual(
    desk.map((entry) => [entry.testId, entry.text]),
  );

  expect(
    phone.filter((entry) => entry.width <= 0 || entry.height <= 0).map((e) => e.testId),
  ).toEqual([]);

  expect(
    phone
      .filter((entry, index) => entry.hidden && desk[index]?.hidden !== true)
      .map((entry) => entry.testId),
  ).toEqual([]);

  const present = new Set(phone.map((entry) => entry.testId));
  for (const required of [
    "month-title",
    "month-meta",
    "compare-head",
    "pot-change",
    "recon-panel",
    "recon-verdict",
    "spend-delta",
    "group-label",
    "group-total",
    "group-delta",
    "income-total",
    "spend-total",
    "reserves-net",
    "unresolved-pill",
    "no-reserves",
    "income-card",
    "spend-card",
    "reserves-card",
  ]) {
    expect(present.has(required), `${required} is missing at 390`).toBe(true);
  }

  // A month this household has data for, with no rows of its own: the note
  // still renders at phone width.
  await page.goto("/?month=2026-07");
  await expect(page.getByTestId("month-no-rows")).toBeVisible();
});

// The same measurements on the NON-RECONCILING dataset, which is the one
// that renders the difference figure and a cause block. Between this, the
// dense month and the partial month, every testid criterion 7.6 names is
// covered by a dataset that renders it.
test("the non-reconciling month is usable at phone width and keeps its causes", async ({
  page,
  baseURL,
}) => {
  await signUp(page, "mv-gap-phone");
  await uploadPotFile(page, "mv-gapped-a.csv", "Daily account", "3");
  await uploadPotFile(page, "mv-gapped-b.csv", "Second account", "1");

  for (const viewport of [PHONE, NARROW_PHONE] as const) {
    await page.setViewportSize(viewport);
    await page.goto("/?month=2026-08");
    expect(
      await tapTargetOffenders(page),
      `tap targets at ${viewport.width}`,
    ).toEqual([]);
    const rows = await rowOffenders(page, viewport.width as 390 | 360);
    expect(rows.trackCount, `track count at ${viewport.width}`).toEqual([]);
    expect(rows.nameWidth, `name width at ${viewport.width}`).toEqual([]);
    expect(rows.twoLines, `two-line rows at ${viewport.width}`).toEqual([]);
    for (const locale of ["en", "nl", "fr"]) {
      await setLocale(page, locale, baseURL);
      await page.goto("/?month=2026-08");
      const clipped = await clippingOffenders(page);
      expect(clipped.horizontal, `${locale} at ${viewport.width}`).toEqual([]);
      expect(clipped.vertical, `${locale} at ${viewport.width}`).toEqual([]);
    }
    await setLocale(page, "en", baseURL);
  }

  await page.setViewportSize(PHONE);
  for (const locale of ["en", "nl", "fr"]) {
    await setLocale(page, locale, baseURL);
    await page.goto("/?month=2026-08");
    const verdict = await page.getByTestId("recon-verdict").boundingBox();
    expect(verdict?.y ?? -1, `verdict top in ${locale}`).toBeGreaterThanOrEqual(0);
    expect(
      (verdict?.y ?? 0) + (verdict?.height ?? 0),
      `verdict bottom in ${locale}`,
    ).toBeLessThanOrEqual(FOLD);
    const difference = await page.getByTestId("recon-difference").boundingBox();
    expect(
      (difference?.y ?? 0) + (difference?.height ?? 0),
      `difference bottom in ${locale}`,
    ).toBeLessThanOrEqual(FOLD);
  }
  await setLocale(page, "en", baseURL);

  await page.goto("/?month=2026-08");
  const gapTestids = new Set(
    (await collectTestids(page)).map((entry) => entry.testId),
  );
  for (const required of [
    "recon-difference",
    "recon-cause-unmatched",
    "unmatched-leg",
  ]) {
    expect(gapTestids.has(required), `${required} is missing at 390`).toBe(true);
  }
});

test("the partial month renders its own states at phone width", async ({
  page,
}) => {
  await signUp(page, "mv-partial-phone");
  await uploadPotFile(page, "mv-partial.csv", "Daily account", "4");
  await page.setViewportSize(PHONE);
  await page.goto("/");

  expect(await tapTargetOffenders(page)).toEqual([]);
  const rows = await rowOffenders(page, 390);
  expect(rows.trackCount).toEqual([]);
  expect(rows.nameWidth).toEqual([]);
  expect(rows.twoLines).toEqual([]);

  const testids = new Set(
    (await collectTestids(page)).map((entry) => entry.testId),
  );
  for (const required of ["in-progress-badge", "compare-na", "month-meta"]) {
    expect(testids.has(required), `${required} is missing at 390`).toBe(true);
  }
});

// Criterion 7.5 second half: the EMPTY STATE is a screen too, and its one
// control is the import link the owner's first complaint was about.
test("the empty state's controls clear the tap target minimum at 390 and 360", async ({
  page,
}) => {
  await signUp(page, "mv-empty-phone");
  for (const viewport of [PHONE, NARROW_PHONE] as const) {
    await page.setViewportSize(viewport);
    await page.goto("/");
    await expect(page.getByTestId("empty-state")).toBeVisible();
    expect(
      await tapTargetOffenders(page),
      `empty state tap targets at ${viewport.width}`,
    ).toEqual([]);
    const clipped = await clippingOffenders(page);
    expect(clipped.horizontal).toEqual([]);
    expect(clipped.vertical).toEqual([]);
  }
});
