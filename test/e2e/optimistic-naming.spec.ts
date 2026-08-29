import { expect, test, type Locator, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { FIXTURE_ACCOUNT_A, registerCurrentAccount, signUpFresh } from "./setup-accounts";

// M3-P11: THE NAMING ACTION PREDICTS ITS RESULT (DR-0025) AND FAILS LOUDLY
// (DR-0026). This spec measures the prediction contract end to end, against
// the PRODUCTION build only (decision D-34): it is registered under the
// chromium-phone-prod project at 390 by 844 and under the chromium-prod
// desktop project, and deliberately NOT under the development projects,
// because it drives en, nl and fr itself (finding DELTA-M0P4-09).
//
// What is measured, criterion by criterion:
//   11.2  the predicted label is on the row within 200ms, marked
//         data-unconfirmed with the mark drawn, announced through a polite
//         live region whose text is OBSERVED ENTERING, described from the
//         submit control, with aria-busy on the submit control ONLY.
//   11.3  no money figure and no row moves while the prediction is on
//         screen: small seed, dense seed, and a naming into an EXISTING
//         merchant's name.
//   11.4  a forced DOMAIN failure (whitespace-only name) and a forced
//         TRANSPORT failure (the route handler fulfils the action POST
//         with a 500, the form criterion 11.1(e) settled) revert the label
//         and raise a dismiss-only assertive notice with the catalogue
//         copy of the reader's language.
//   11.5  a name typed with surrounding whitespace is stored trimmed: the
//         difference is told on the row in a polite notice, never swapped
//         in silently.
//
// THE ROW UNDER TEST IS ADDRESSED BY ITS data-group-key, captured before
// the click: criterion 11.2 requires the prediction to change the row's
// testid and label, so any locator built on those two identities loses the
// row at the exact moment the measurement starts. The key is the one
// identity the prediction never changes (criterion 11.3).
//
// Every merchant name typed here is invented, and every fixture row is
// synthetic (test/fixtures/belfius-account-a.csv, mv-dense.csv). The prod
// server runs without the frozen clock; nothing below depends on "now".

const FIXTURES = join(__dirname, "..", "fixtures");
const SMALL_FIXTURE = join(FIXTURES, "belfius-account-a.csv");
const DENSE_FIXTURE = join(FIXTURES, "mv-dense.csv");

const LANGUAGES = ["en", "nl", "fr"] as const;
type Language = (typeof LANGUAGES)[number];

const catalogue = (language: Language): Record<string, string> =>
  JSON.parse(
    readFileSync(join(__dirname, "..", "..", "messages", `${language}.json`), "utf8"),
  ) as Record<string, string>;

// The delay that keeps the prediction observable: 2000ms against the 200ms
// ceiling and the 1000ms mid-flight checkpoint. Failures are HELD for the
// same reason: a refusal answered faster than the first poll would revert
// the label before the spec could witness the prediction it reverts.
const DELAY_MS = 2000;
const FAIL_DELAY_MS = 1000;
const PREDICT_CEILING_MS = 200;

// Hold every server-action POST for DELAY_MS and let it through, or hold
// it for FAIL_DELAY_MS and fulfil it with a 500 (the transport-failure
// form criterion 11.1(e) settled: the fulfilled 500 reaches the awaiting
// client wrapper as a rejection).
type ActionRoute = {
  armDelay: () => void;
  armFail: () => void;
  disarm: () => void;
};

const routeServerActions = async (page: Page): Promise<ActionRoute> => {
  let mode: "off" | "delay" | "fail" = "off";
  await page.route("**/*", async (route) => {
    const request = route.request();
    if (request.method() !== "POST" || request.headers()["next-action"] === undefined) {
      await route.fallback();
      return;
    }
    if (mode === "fail") {
      await new Promise((resolve) => setTimeout(resolve, FAIL_DELAY_MS));
      await route.fulfill({
        status: 500,
        contentType: "text/plain",
        body: "forced transport failure",
      });
      return;
    }
    if (mode === "delay") {
      await new Promise((resolve) => setTimeout(resolve, DELAY_MS));
    }
    await route.continue();
  });
  return {
    armDelay: () => {
      mode = "delay";
    },
    armFail: () => {
      mode = "fail";
    },
    disarm: () => {
      mode = "off";
    },
  };
};

const importFixture = async (page: Page, fixture: string): Promise<void> => {
  await page.goto("/import");
  await page.getByLabel("Bank export file").setInputFiles(fixture);
  await page.getByRole("button", { name: "Upload" }).click();
  await expect(
    page.getByRole("heading", { name: "Confirm the detected format" }),
  ).toBeVisible();
  await page.getByLabel("Format name").fill("Demobank current account");
  await page.getByTestId("confirm-import").click();
  await expect(page.getByTestId("import-result")).toBeVisible();
};

const openMerchants = async (page: Page, language: Language): Promise<void> => {
  const origin = new URL(page.url()).origin;
  await page.context().addCookies([{ name: "locale", value: language, url: origin }]);
  await page.goto("/merchants");
  await expect(page.getByTestId("unresolved-group").first()).toBeVisible();
};

// Everything criterion 11.3 compares: the three counters, every group
// total, the data-group-key sequence in DOM order, and every row's testid
// and label.
type Figures = {
  readonly income: string;
  readonly spend: string;
  readonly unresolved: string;
  readonly groupTotals: readonly string[];
  readonly groupKeys: readonly (string | null)[];
  readonly rows: readonly { readonly testid: string | null; readonly label: string }[];
};

const captureFigures = async (page: Page): Promise<Figures> => ({
  income: (await page.getByTestId("income-total").textContent()) ?? "",
  spend: (await page.getByTestId("spend-total").textContent()) ?? "",
  unresolved: (await page.getByTestId("unresolved-count").textContent()) ?? "",
  groupTotals: await page.getByTestId("group-total").allTextContents(),
  groupKeys: await page
    .locator("[data-group-key]")
    .evaluateAll((rows) => rows.map((row) => row.getAttribute("data-group-key"))),
  rows: await page.locator("[data-group-key]").evaluateAll((rows) =>
    rows.map((row) => ({
      testid: row.getAttribute("data-testid"),
      label: row.querySelector('[data-testid="group-label"]')?.textContent ?? "",
    })),
  ),
});

// Byte-identical figure comparison; the NAMED row's testid and label are
// the only two identities criterion 11.2 requires to change, so the row
// list comparison exempts exactly that index and nothing else. Pass -1 to
// exempt nothing (the failure journeys, where the revert restores
// everything).
const expectFiguresUnmoved = (
  before: Figures,
  after: Figures,
  namedRowIndex: number,
): void => {
  expect(after.income).toBe(before.income);
  expect(after.spend).toBe(before.spend);
  expect(after.unresolved).toBe(before.unresolved);
  expect(after.groupTotals).toEqual(before.groupTotals);
  expect(after.groupKeys).toEqual(before.groupKeys);
  expect(after.rows.length).toBe(before.rows.length);
  for (const [index, row] of after.rows.entries()) {
    if (index === namedRowIndex) {
      continue;
    }
    expect(row).toEqual(before.rows[index]);
  }
};

// The raw textContent of the row's label, compared WITHOUT whitespace
// normalisation: toHaveText normalises, and criterion 11.5 turns on the
// difference between " typed " and "typed".
const waitForRawLabel = async (
  row: Locator,
  expected: string,
  timeoutMs: number,
): Promise<void> => {
  await row
    .locator('[data-testid="group-label"]')
    .evaluate(
      (element, { text, timeout }) =>
        new Promise<void>((resolve, reject) => {
          const started = Date.now();
          const check = () => {
            if (element.textContent === text) {
              resolve();
              return;
            }
            if (Date.now() - started > timeout) {
              reject(
                new Error(
                  `label did not reach the expected raw text within ${timeout}ms`,
                ),
              );
              return;
            }
            setTimeout(check, 10);
          };
          check();
        }),
      { text: expected, timeout: timeoutMs },
    );
};

// The row whose group-label textContent is EXACTLY this string, returned
// by its data-group-key. Raw equality rather than a substring filter (fix
// round, finding CR-M3P11-04): "  Typed  " CONTAINS "Typed", so a
// substring match is satisfied by the untrimmed prediction and cannot tell
// the confirmed answer from the predicted one, which is the whole of what
// criterion 11.5 measures. Refuses ambiguity rather than taking the first.
const rowKeyWithRawLabel = async (
  page: Page,
  text: string,
  timeoutMs: number,
): Promise<string> =>
  page.evaluate(
    ({ text, timeout }) =>
      new Promise<string>((resolve, reject) => {
        const started = Date.now();
        const check = () => {
          const matches = [
            ...document.querySelectorAll("[data-group-key]"),
          ].filter(
            (row) =>
              row.querySelector('[data-testid="group-label"]')?.textContent ===
              text,
          );
          if (matches.length > 1) {
            reject(new Error(`${matches.length} rows carry that exact label`));
            return;
          }
          if (matches.length === 1) {
            resolve(matches[0]?.getAttribute("data-group-key") ?? "");
            return;
          }
          if (Date.now() - started > timeout) {
            reject(new Error("no row reached that exact label"));
            return;
          }
          setTimeout(check, 25);
        };
        check();
      }),
    { text, timeout: timeoutMs },
  );

const namableGroup = (page: Page): Locator =>
  page
    .getByTestId("unresolved-group")
    .filter({ has: page.locator(".merchant-name-form") })
    .first();

// The same thing, confined to the SPEND section (slow-gate repair round).
// A merchant with groups on both sides renders TWO rows, one per direction
// (finding HZ-M3P11-02), so a merge test that names one income group and
// one spend group into a single name ends with two rows and no summed
// total, which is the product being right rather than a merge failing. The
// merge measurement below therefore names two groups on the SAME side, and
// this is how it reaches them: the section is the one carrying the spend
// total, which is the only stable handle the screen offers.
const namableSpendGroup = (page: Page): Locator =>
  page
    .locator(".merchant-section")
    .filter({ has: page.getByTestId("spend-total") })
    .getByTestId("unresolved-group")
    .filter({ has: page.locator(".merchant-name-form") })
    .first();

// The key-addressed handle on the row under test: survives the testid and
// label changing at the moment the prediction lands.
const rowByKey = (page: Page, key: string): Locator =>
  page.locator(`[data-group-key="${key}"]`);

const nameInput = (row: Locator): Locator =>
  row.locator('input[name="merchantName"]');

const submitControl = (row: Locator): Locator =>
  row.locator(".merchant-name-button");

const observeUnconfirmedRegion = async (row: Locator): Promise<void> => {
  await row.getByTestId("unconfirmed-note").evaluate((region) => {
    const bag = window as unknown as { __observedUnconfirmed: string[] };
    bag.__observedUnconfirmed = [];
    const observer = new MutationObserver(() => {
      bag.__observedUnconfirmed.push(region.textContent ?? "");
    });
    observer.observe(region, { childList: true, characterData: true, subtree: true });
  });
};

const observedUnconfirmed = async (page: Page): Promise<readonly string[]> =>
  page.evaluate(
    () => (window as unknown as { __observedUnconfirmed: string[] }).__observedUnconfirmed,
  );

// The full 11.2 marking check on the predicting row, valid at any moment
// between the click and the release.
const expectMarkedPrediction = async (
  row: Locator,
  page: Page,
  unconfirmedCopy: string,
): Promise<void> => {
  await expect(row).toHaveAttribute("data-unconfirmed", "");
  // The visual mark M3-P9 shipped for [data-unconfirmed] is drawn.
  const afterContent = await row.evaluate(
    (element) => getComputedStyle(element, "::after").content,
  );
  expect(afterContent).not.toBe("none");
  // The row leaves the unresolved treatment while predicted (11.2, D-31).
  await expect(row).toHaveAttribute("data-testid", "merchant-group");
  // The polite region inside the row carries the catalogue copy.
  const region = row.getByTestId("unconfirmed-note");
  await expect(region).toHaveText(unconfirmedCopy);
  await expect(region).toHaveAttribute("role", "status");
  // The submit control is described by that region (11.2(c)).
  const describedBy = await submitControl(row).getAttribute("aria-describedby");
  expect(describedBy).not.toBeNull();
  const described = await page.evaluate(
    (id) => document.getElementById(id)?.textContent ?? null,
    describedBy ?? "",
  );
  expect(described).toBe(unconfirmedCopy);
  // AND IT IS REACHABLE (fix round, finding CR-M3P11-02): the submit
  // control is disabled for exactly this window, so the naming field
  // inside the same form carries the same description and can still take
  // keyboard focus.
  const fieldDescribedBy = await row
    .locator('input[name="merchantName"]')
    .getAttribute("aria-describedby");
  expect(fieldDescribedBy).toBe(describedBy);
  await row.locator('input[name="merchantName"]').focus();
  expect(
    await page.evaluate(
      () => document.activeElement?.getAttribute("name") ?? null,
    ),
  ).toBe("merchantName");
  // THE CARVE-OUT (11.2(d)): aria-busy on the submit control, and nowhere
  // else on the row.
  await expect(row).not.toHaveAttribute("aria-busy", "true");
  await expect(row.locator('[data-testid="group-label"]')).not.toHaveAttribute(
    "aria-busy",
    "true",
  );
  await expect(region).not.toHaveAttribute("aria-busy", "true");
  await expect(submitControl(row)).toHaveAttribute("aria-busy", "true");
};

const expectMarkingGone = async (page: Page): Promise<void> => {
  await expect(page.locator("[data-unconfirmed]")).toHaveCount(0);
  for (const text of await page.getByTestId("unconfirmed-note").allTextContents()) {
    expect(text).toBe("");
  }
  await expect(page.locator("button[aria-describedby]")).toHaveCount(0);
};

// Criterion 11.6(a): the three catalogues carry the SAME complete key set,
// compared as sorted lists, and (d) the copy rules made checkable: no new
// key's English value carries an exclamation mark, sorry, oops, or the
// word error.
test("the catalogues agree and the new copy follows the rules", () => {
  const keySets = LANGUAGES.map((language) =>
    Object.keys(catalogue(language)).sort(),
  );
  expect(keySets[1]).toEqual(keySets[0]);
  expect(keySets[2]).toEqual(keySets[0]);
  const english = catalogue("en");
  for (const key of ["namingFailed", "namingDiffers", "nameUnconfirmed", "noticeDismiss"]) {
    const value = english[key] ?? "";
    expect(value).not.toBe("");
    expect(value).not.toContain("!");
    expect(value.toLowerCase()).not.toContain("sorry");
    expect(value.toLowerCase()).not.toContain("oops");
    expect(value.toLowerCase()).not.toContain("error");
  }
});

for (const language of LANGUAGES) {
  test(`the prediction is shown, marked, and moves nothing (${language})`, async ({
    page,
  }) => {
    const copy = catalogue(language);
    await signUpFresh(page, `opt-${language}`);
    await registerCurrentAccount(page, FIXTURE_ACCOUNT_A);
    await importFixture(page, SMALL_FIXTURE);
    await openMerchants(page, language);

    const route = await routeServerActions(page);
    const target = namableGroup(page);
    await expect(target).toBeVisible();
    const rowKey = (await target.getAttribute("data-group-key")) ?? "";
    expect(rowKey).not.toBe("");
    const row = rowByKey(page, rowKey);
    const before = await captureFigures(page);
    const namedRowIndex = before.groupKeys.indexOf(rowKey);
    expect(namedRowIndex).toBeGreaterThanOrEqual(0);

    await observeUnconfirmedRegion(row);
    expect(await row.getByTestId("unconfirmed-note").textContent()).toBe("");

    const typed = "Bakkerij Demo";
    await nameInput(row).fill(typed);
    route.armDelay();
    const clickAt = Date.now();
    await submitControl(row).click();

    // (a) the typed string is the label within 200ms of the click.
    await waitForRawLabel(row, typed, PREDICT_CEILING_MS);
    // (b)-(d) the two-part marking with the exact carve-out.
    await expectMarkedPrediction(row, page, copy["nameUnconfirmed"] ?? "");
    // (c) the copy was OBSERVED ENTERING the region, not found sitting
    // there (criterion 11.1(g)'s lesson).
    expect(await observedUnconfirmed(page)).toContain(copy["nameUnconfirmed"] ?? "");

    // (e) at 1000ms, before the response is released, everything above
    // still holds and nothing else on the screen has moved (11.3).
    const elapsed = Date.now() - clickAt;
    if (elapsed < 1000) {
      await page.waitForTimeout(1000 - elapsed);
    }
    await waitForRawLabel(row, typed, 50);
    await expectMarkedPrediction(row, page, copy["nameUnconfirmed"] ?? "");
    expectFiguresUnmoved(before, await captureFigures(page), namedRowIndex);

    // After the release: the confirmed row, no marking anywhere, and no
    // difference notice, because the server agreed with the prediction.
    route.disarm();
    const named = page.getByTestId("merchant-group").filter({ hasText: typed });
    await expect(named).toHaveCount(1, { timeout: 15_000 });
    await expectMarkingGone(page);
    await expect(page.getByTestId("naming-differs")).toHaveCount(0);
    await expect(page.getByTestId("naming-failed")).toHaveCount(0);
  });

  test(`a failed naming reverts loudly, twice, and a different answer is told (${language})`, async ({
    page,
  }) => {
    const copy = catalogue(language);
    await signUpFresh(page, `fail-${language}`);
    await registerCurrentAccount(page, FIXTURE_ACCOUNT_A);
    await importFixture(page, SMALL_FIXTURE);
    await openMerchants(page, language);

    const route = await routeServerActions(page);

    // --- The DOMAIN failure: a whitespace-only name, which the required
    // attribute does not block and the use case refuses. Held in flight
    // long enough for the prediction to be witnessed before it reverts. ---
    {
      const target = namableGroup(page);
      const rowKey = (await target.getAttribute("data-group-key")) ?? "";
      const row = rowByKey(page, rowKey);
      const labelBefore = await row.locator('[data-testid="group-label"]').textContent();
      const before = await captureFigures(page);
      const typed = "   ";
      await nameInput(row).fill(typed);
      route.armDelay();
      await submitControl(row).click();
      // (a) the prediction was on the row: the reader saw what reverts.
      await waitForRawLabel(row, typed, PREDICT_CEILING_MS);
      // (e), AN EXTRA READING WHILE THE REQUEST IS STILL IN FLIGHT.
      // Criterion 11.4(e) says the figures are byte identical THROUGHOUT,
      // so they are read here too, with the prediction on the row, and not
      // only before the click and after the revert (fix round, finding
      // CR-M3P11-04).
      expectFiguresUnmoved(
        before,
        await captureFigures(page),
        before.groupKeys.indexOf(rowKey),
      );
      // (b) the failure reaches the client: label back, marking gone.
      await expect(row.locator('[data-testid="group-label"]')).toHaveText(
        labelBefore ?? "",
        { timeout: 15_000 },
      );
      // (c) the notice: visible, assertive, catalogue copy of THIS language.
      const notice = page.getByTestId("naming-failed");
      await expect(notice).toBeVisible();
      await expect(notice).toHaveText(copy["namingFailed"] ?? "");
      const box = await notice.boundingBox();
      expect(box !== null && box.width > 0 && box.height > 0).toBe(true);
      expect(
        await notice.evaluate((element) => element.closest('[role="alert"]') !== null),
      ).toBe(true);
      await expectMarkingGone(page);
      // (d) the notice WAITS: still there 5000ms later, gone on dismiss.
      await page.waitForTimeout(5000);
      await expect(notice).toBeVisible();
      await page.locator(".pulse-toast-dismiss").click();
      await expect(notice).toHaveCount(0);
      // (e) no figure moved at any point.
      expectFiguresUnmoved(before, await captureFigures(page), -1);
      route.disarm();
    }

    // --- The TRANSPORT failure: the route handler fulfils the action POST
    // with a 500, the form criterion 11.1(e) settled. ---
    {
      const target = namableGroup(page);
      const rowKey = (await target.getAttribute("data-group-key")) ?? "";
      const row = rowByKey(page, rowKey);
      const labelBefore = await row.locator('[data-testid="group-label"]').textContent();
      const before = await captureFigures(page);
      const typed = "Vervoer Test";
      await nameInput(row).fill(typed);
      route.armFail();
      await submitControl(row).click();
      await waitForRawLabel(row, typed, PREDICT_CEILING_MS);
      // (e), AN EXTRA READING WHILE THE REQUEST IS STILL IN FLIGHT.
      // Criterion 11.4(e) says the figures are byte identical THROUGHOUT,
      // so they are read here too, with the prediction on the row, and not
      // only before the click and after the revert (fix round, finding
      // CR-M3P11-04).
      expectFiguresUnmoved(
        before,
        await captureFigures(page),
        before.groupKeys.indexOf(rowKey),
      );
      await expect(row.locator('[data-testid="group-label"]')).toHaveText(
        labelBefore ?? "",
        { timeout: 15_000 },
      );
      const notice = page.getByTestId("naming-failed");
      await expect(notice).toBeVisible();
      await expect(notice).toHaveText(copy["namingFailed"] ?? "");
      expect(
        await notice.evaluate((element) => element.closest('[role="alert"]') !== null),
      ).toBe(true);
      await expectMarkingGone(page);
      await page.waitForTimeout(5000);
      await expect(notice).toBeVisible();
      await page.locator(".pulse-toast-dismiss").click();
      await expect(notice).toHaveCount(0);
      expectFiguresUnmoved(before, await captureFigures(page), -1);
      route.disarm();
    }

    // --- The DIFFERENCE (11.5): surrounding whitespace, stored trimmed,
    // and the row says so instead of swapping the value in silently. ---
    {
      const target = namableGroup(page);
      const rowKey = (await target.getAttribute("data-group-key")) ?? "";
      const row = rowByKey(page, rowKey);
      const typed = "  Verschil Proef  ";
      const trimmed = typed.trim();
      await nameInput(row).fill(typed);
      route.armDelay();
      await submitControl(row).click();
      // Within 200ms the label carries the string AS TYPED.
      await waitForRawLabel(row, typed, PREDICT_CEILING_MS);
      route.disarm();
      // After the response the confirmed row carries the TRIMMED string
      // and the polite difference notice, on that row. Raw equality, not a
      // substring: the predicted label CONTAINS the trimmed one.
      const namedKey = await rowKeyWithRawLabel(page, trimmed, 15_000);
      const named = rowByKey(page, namedKey);
      await expect(named).toHaveAttribute("data-testid", "merchant-group");
      const notice = named.getByTestId("naming-differs");
      await expect(notice).toBeVisible();
      await expect(notice).toHaveText(copy["namingDiffers"] ?? "");
      const box = await notice.boundingBox();
      expect(box !== null && box.width > 0 && box.height > 0).toBe(true);
      expect(
        await notice.evaluate((element) => element.closest('[role="status"]') !== null),
      ).toBe(true);
      // Still present 5000ms later: no timer takes it away.
      await page.waitForTimeout(5000);
      await expect(notice).toBeVisible();
    }
  });
}

// M3-P11 fix round, finding HZ-M3P11-01. Two notices raised on two
// different rows before either is dismissed. Every notice is drawn in the
// same fixed rectangle, so this is the journey where one would have
// covered the other; the queue makes that impossible instead, and nothing
// is removed that the reader has not dismissed.
test("a second notice waits for the first rather than covering it", async ({
  page,
}) => {
  const copy = catalogue("en");
  await signUpFresh(page, "two-notices");
  await registerCurrentAccount(page, FIXTURE_ACCOUNT_A);
  await importFixture(page, SMALL_FIXTURE);
  await openMerchants(page, "en");

  const route = await routeServerActions(page);

  // Row one fails and its notice stays up, undismissed.
  // Every namable row's key, captured BEFORE anything is submitted, so the
  // second row can be addressed by identity rather than by a filter.
  const namableKeys = await page
    .getByTestId("unresolved-group")
    .filter({ has: page.locator(".merchant-name-form") })
    .evaluateAll((rows) =>
      rows.map((row) => row.getAttribute("data-group-key") ?? ""),
    );
  expect(namableKeys.length).toBeGreaterThan(1);
  const firstKey = namableKeys[0] ?? "";
  const firstRow = rowByKey(page, firstKey);
  await nameInput(firstRow).fill("   ");
  route.armDelay();
  await submitControl(firstRow).click();
  await expect(page.getByTestId("naming-failed")).toBeVisible({
    timeout: 15_000,
  });
  route.disarm();

  // Row two fails while it is still there. THE SECOND ROW IS PICKED BY KEY
  // (round two, finding CR2-M3P11-02): filtering with hasNot on
  // data-group-key excluded nothing, because hasNot excludes rows that
  // CONTAIN a match and that attribute sits on the row element itself, so
  // the filter returned the first row again. The namable keys are captured
  // before the first submit and the second is the first key that is not the
  // first row's, which is the identity-addressed style the rest of this
  // spec uses.
  const secondKey = namableKeys.find((key) => key !== firstKey) ?? "";
  expect(secondKey).not.toBe("");
  expect(secondKey).not.toBe(firstKey);
  const secondRow = rowByKey(page, secondKey);
  await nameInput(secondRow).fill("   ");
  route.armFail();
  await submitControl(secondRow).click();

  // EXACTLY ONE NOTICE IS ON SCREEN, so neither can be hidden behind the
  // other, and the dismiss control is unambiguous.
  await expect(page.locator(".pulse-toast")).toHaveCount(1, {
    timeout: 15_000,
  });
  await expect(page.locator(".pulse-toast-dismiss")).toHaveCount(1);
  await expect(page.getByTestId("naming-failed")).toHaveText(
    copy["namingFailed"] ?? "",
  );

  // EACH NOTICE IS ATTRIBUTABLE TO ITS OWN ROW. The id is read from the
  // NOTICE ELEMENT that carries it (round two, finding CR2-M3P11-02): the
  // id sits on the .pulse-toast wrapper and the test id on the message
  // inside it, so reading the id off the message element yields null. The
  // testid stays where it is, because the criteria measure the notice's
  // trimmed text as exactly the catalogue value and the wrapper also
  // carries the dismiss control's label.
  //
  // ATTRIBUTION IS MEASURED THE WAY THE PRODUCT DEFINES IT (slow-gate
  // repair round). This block used to require BOTH rows to carry an
  // aria-describedby at once, and that is unreachable by construction:
  // src/modules/merchants/ui/merchant-row.tsx sets the attribute only
  // while the row's own notice is the one ON SCREEN, and the queue above
  // shows exactly one at a time. A row whose notice is waiting points at
  // nothing, because there is nothing on screen for it to point at, which
  // is the correct behaviour and not a gap: an aria-describedby aimed at
  // an element that is not rendered would describe a control by a sentence
  // no reader can reach. So what is asserted is the pair of properties the
  // criterion actually needs. Exactly ONE of the two rows points at the
  // notice on screen, and it points at THAT notice and not the other; and
  // after the dismissal the OTHER row is the one pointing, at a different
  // notice. Nothing is weakened: the old form could pass with both rows
  // pointing at the SAME notice, which this one refuses.
  const describedByOf = async (row: Locator): Promise<string | null> =>
    row.getAttribute("aria-describedby");
  const shownNoticeId = async (): Promise<string | null> =>
    page.locator(".pulse-toast").getAttribute("id");
  const pointingRows = async (): Promise<readonly (string | null)[]> =>
    (await Promise.all([describedByOf(firstRow), describedByOf(secondRow)]))
      .map((value) => value);

  const shownFirst = await shownNoticeId();
  expect(shownFirst).not.toBeNull();
  const pointingWhileFirstShown = await pointingRows();
  expect(
    pointingWhileFirstShown.filter((value) => value !== null),
    "exactly one row points at the notice on screen, and it is that notice",
  ).toEqual([shownFirst]);
  const rowShownFirst = pointingWhileFirstShown.indexOf(shownFirst);

  // Dismissing it REVEALS the one that was waiting rather than losing it,
  // and the revealed one belongs to the OTHER row.
  await page.locator(".pulse-toast-dismiss").click();
  await expect(page.locator(".pulse-toast")).toHaveCount(1);
  await expect(page.getByTestId("naming-failed")).toBeVisible();
  await expect(page.getByTestId("naming-failed")).toHaveText(
    copy["namingFailed"] ?? "",
  );
  const shownSecond = await shownNoticeId();
  expect(shownSecond).not.toBeNull();
  expect(shownSecond).not.toBe(shownFirst);
  const pointingWhileSecondShown = await pointingRows();
  expect(
    pointingWhileSecondShown.filter((value) => value !== null),
    "the revealed notice is pointed at too, and by one row only",
  ).toEqual([shownSecond]);
  expect(
    pointingWhileSecondShown.indexOf(shownSecond),
    "the revealed notice belongs to the OTHER row",
  ).not.toBe(rowShownFirst);

  // And dismissing that one leaves the screen with none.
  await page.locator(".pulse-toast-dismiss").click();
  await expect(page.locator(".pulse-toast")).toHaveCount(0);
  route.disarm();
});

// M3-P11 round two, finding HZ2-M3P11-02. The reader acts on a row whose
// notice is already up while a second row's notice waits behind it. What
// appears at the bottom of the screen must be about the row they just
// acted on.
test("the notice on screen is the one the reader's last action produced", async ({
  page,
}) => {
  const copy = catalogue("en");
  await signUpFresh(page, "re-raise");
  await registerCurrentAccount(page, FIXTURE_ACCOUNT_A);
  await importFixture(page, SMALL_FIXTURE);
  await openMerchants(page, "en");

  const route = await routeServerActions(page);
  const namableKeys = await page
    .getByTestId("unresolved-group")
    .filter({ has: page.locator(".merchant-name-form") })
    .evaluateAll((rows) =>
      rows.map((row) => row.getAttribute("data-group-key") ?? ""),
    );
  expect(namableKeys.length).toBeGreaterThan(1);
  const firstKey = namableKeys[0] ?? "";
  const secondKey = namableKeys.find((key) => key !== firstKey) ?? "";
  const firstRow = rowByKey(page, firstKey);
  const secondRow = rowByKey(page, secondKey);

  // Row one fails, then row two fails, both left undismissed.
  route.armDelay();
  await nameInput(firstRow).fill("   ");
  await submitControl(firstRow).click();
  await expect(page.getByTestId("naming-failed")).toBeVisible({
    timeout: 15_000,
  });
  // THE ROW'S OWN NOTICE IS WAITED FOR, NOT THE TOAST COUNT (slow-gate
  // repair round). This used to wait for .pulse-toast to have count 1 and
  // then read row two's aria-describedby in the next statement. The count
  // was already 1 from row ONE's notice, so the wait returned at once and
  // the read landed while row two's action was still held by armDelay:
  // the attribute was null and the comparison failed against a toast id
  // that was real. The condition that actually says row two's notice has
  // taken the screen is row two POINTING at it, which is what is waited
  // for here. It is not a wait added to hide a race: the race was reading
  // a state before the action that produces it had answered, and this
  // fails on a product that never reaches the state.
  await nameInput(secondRow).fill("   ");
  await submitControl(secondRow).click();
  await expect
    .poll(async () => secondRow.getAttribute("aria-describedby"), {
      timeout: 15_000,
    })
    .not.toBeNull();
  const secondDescribedBy = await secondRow.getAttribute("aria-describedby");
  await expect(page.locator(".pulse-toast")).toHaveCount(1);
  expect(await page.locator(".pulse-toast").getAttribute("id")).toBe(
    secondDescribedBy,
  );

  // The reader now acts on row ONE again. Its own notice must take the
  // screen back, and row two's must still be waiting rather than gone.
  // Row one points at its notice only once that notice is the one on
  // screen, so the same wait applies here.
  await nameInput(firstRow).fill("   ");
  await submitControl(firstRow).click();
  await expect
    .poll(async () => firstRow.getAttribute("aria-describedby"), {
      timeout: 15_000,
    })
    .not.toBeNull();
  const firstDescribedBy = await firstRow.getAttribute("aria-describedby");
  expect(firstDescribedBy).not.toBe(secondDescribedBy);
  expect(await page.locator(".pulse-toast").getAttribute("id")).toBe(
    firstDescribedBy,
  );
  await expect(page.locator(".pulse-toast")).toHaveCount(1);
  // Row two's notice is waiting rather than showing, so row two points at
  // nothing while row one's is up.
  expect(await secondRow.getAttribute("aria-describedby")).toBeNull();
  await expect(page.getByTestId("naming-failed")).toHaveText(
    copy["namingFailed"] ?? "",
  );

  // Row two's notice was not lost: dismissing row one's reveals it.
  await page.locator(".pulse-toast-dismiss").click();
  await expect(page.locator(".pulse-toast")).toHaveCount(1);
  expect(await page.locator(".pulse-toast").getAttribute("id")).toBe(
    secondDescribedBy,
  );
  route.disarm();
});

// Criterion 11.3's two further datasets, in English: the dense month
// M3-P7's criterion 7.13 introduced, and the naming whose typed name is an
// EXISTING merchant's name, which is the case that would merge and sum two
// totals if anything predicted them.
test("no figure and no row moves on the dense dataset", async ({ page }) => {
  const copy = catalogue("en");
  await signUpFresh(page, "dense");
  await registerCurrentAccount(page, FIXTURE_ACCOUNT_A);
  await importFixture(page, DENSE_FIXTURE);
  await openMerchants(page, "en");

  const route = await routeServerActions(page);
  const target = namableGroup(page);
  await expect(target).toBeVisible();
  const rowKey = (await target.getAttribute("data-group-key")) ?? "";
  const row = rowByKey(page, rowKey);
  const before = await captureFigures(page);
  const namedRowIndex = before.groupKeys.indexOf(rowKey);
  expect(namedRowIndex).toBeGreaterThanOrEqual(0);

  const typed = "Dichte Reeks";
  await nameInput(row).fill(typed);
  route.armDelay();
  const clickAt = Date.now();
  await submitControl(row).click();
  await waitForRawLabel(row, typed, PREDICT_CEILING_MS);
  const elapsed = Date.now() - clickAt;
  if (elapsed < 1000) {
    await page.waitForTimeout(1000 - elapsed);
  }
  await expectMarkedPrediction(row, page, copy["nameUnconfirmed"] ?? "");
  expectFiguresUnmoved(before, await captureFigures(page), namedRowIndex);
  route.disarm();
  await expect(
    page.getByTestId("merchant-group").filter({ hasText: typed }),
  ).toHaveCount(1, { timeout: 15_000 });
});

test("naming into an existing merchant predicts no merge and no sum", async ({
  page,
}) => {
  const copy = catalogue("en");
  await signUpFresh(page, "merge");
  await registerCurrentAccount(page, FIXTURE_ACCOUNT_A);
  await importFixture(page, SMALL_FIXTURE);
  await openMerchants(page, "en");

  const route = await routeServerActions(page);

  // First naming, allowed to settle: creates the existing merchant.
  const shared = "Gedeelde Naam";
  {
    const target = namableSpendGroup(page);
    await nameInput(target).fill(shared);
    await submitControl(target).click();
    await expect(
      page.getByTestId("merchant-group").filter({ hasText: shared }),
    ).toHaveCount(1, { timeout: 15_000 });
  }

  // Second naming with the SAME name, held in flight: while the prediction
  // is on screen the two groups must still be two rows with two totals.
  // Same side as the first, so the merge this measures really is one row.
  const target = namableSpendGroup(page);
  await expect(target).toBeVisible();
  const rowKey = (await target.getAttribute("data-group-key")) ?? "";
  const row = rowByKey(page, rowKey);
  const before = await captureFigures(page);
  const namedRowIndex = before.groupKeys.indexOf(rowKey);
  expect(namedRowIndex).toBeGreaterThanOrEqual(0);

  await nameInput(row).fill(shared);
  route.armDelay();
  const clickAt = Date.now();
  await submitControl(row).click();
  await waitForRawLabel(row, shared, PREDICT_CEILING_MS);
  const elapsed = Date.now() - clickAt;
  if (elapsed < 1000) {
    await page.waitForTimeout(1000 - elapsed);
  }
  await expectMarkedPrediction(row, page, copy["nameUnconfirmed"] ?? "");
  expectFiguresUnmoved(before, await captureFigures(page), namedRowIndex);
  // Two rows carry the shared name mid-flight: the existing merchant row
  // and the predicting row. Nothing has merged and no total moved.
  await expect(
    page.locator('[data-group-key] [data-testid="group-label"]', {
      hasText: shared,
    }),
  ).toHaveCount(2);

  // After the release the server merges: one row, whose total is the SUM
  // of the two originals, which is exactly what the browser refused to
  // predict (the 11.1(b) browser witness records the merged figure).
  route.disarm();
  await expect(
    page.getByTestId("merchant-group").filter({ hasText: shared }),
  ).toHaveCount(1, { timeout: 15_000 });
  const after = await captureFigures(page);
  expect(after.groupTotals.length).toBe(before.groupTotals.length - 1);
  expect(after.income).toBe(before.income);
  expect(after.spend).toBe(before.spend);
});
