import { expect, test, type Locator, type Page } from "@playwright/test";
import { join } from "node:path";
import {
  FIXTURE_ACCOUNT_A,
  FIXTURE_ACCOUNT_B,
  fillSetupRows,
} from "./setup-accounts";

// M3-P10. THE INTERVAL BETWEEN THE PRESS AND THE FIRST DOM CHANGE.
//
// Why this file exists: the owner, on the deployed phone build, reported
// twice that after pressing a control nothing happens on screen until the
// whole server cycle comes back. M3-P9 answered the press itself. This
// answers the gap AFTER the press, and the only honest way to measure a gap
// is to make the server slow on purpose and time the screen.
//
// WHAT WOULD MAKE THIS FILE WORTHLESS, stated first because the plan's own
// first version of criterion 10.2 was defeated by exactly it: an observer
// watching the whole document accepts the first record from any source, so
// one line setting a data attribute on document.body turns it green with the
// screen dead. Every measurement below therefore scopes the observer to the
// pressed control's own form, DISCARDS every record outside the pressed
// control's subtree, and then requires the control's COMPUTED APPEARANCE to
// have changed inside the callback that stopped the clock. The control run
// that proves the measurement can fail is recorded in the phase work history
// rather than committed, because it requires the leaf to be removed.

const FIXTURES = join(__dirname, "..", "fixtures");
const CSV_FIXTURE = join(FIXTURES, "belfius-account-a.csv");

// 2000ms of delay against a 200ms ceiling leaves 300ms of slack after the
// 1500ms floor half (d) requires. A later reader tuning either number is
// spending that slack.
const DELAY_MS = 2000;
const CEILING_MS = 200;
const MEDIAN_CEILING_MS = 100;
const SETTLE_MS = 1000;

type ActionProbe = {
  requests: number;
  firstReleaseGapMs: number | null;
  reset: (clickAt: number) => void;
};

// THE ROUTE HANDLER. A server action is a POST carrying the framework's own
// action header; the handler counts those, holds them for DELAY_MS and then
// lets them through unchanged. Nothing test-only is added to product code.
const delayServerActions = async (page: Page): Promise<ActionProbe> => {
  const probe: ActionProbe = {
    requests: 0,
    firstReleaseGapMs: null,
    reset: () => undefined,
  };
  let clickAt = 0;
  probe.reset = (at: number): void => {
    probe.requests = 0;
    probe.firstReleaseGapMs = null;
    clickAt = at;
  };
  await page.route("**/*", async (route) => {
    const request = route.request();
    const headers = request.headers();
    if (request.method() !== "POST" || headers["next-action"] === undefined) {
      await route.fallback();
      return;
    }
    probe.requests += 1;
    await new Promise((resolve) => setTimeout(resolve, DELAY_MS));
    if (probe.firstReleaseGapMs === null) {
      probe.firstReleaseGapMs = Date.now() - clickAt;
    }
    await route.continue();
  });
  return probe;
};

// The destination side of the same instrument, for the navigating controls:
// an app-router navigation asks for its payload with the framework's RSC
// header, and a plain document navigation is a GET for text/html.
const delayNavigations = async (page: Page): Promise<{ requests: number }> => {
  const seen = { requests: 0 };
  await page.route("**/*", async (route) => {
    const request = route.request();
    const headers = request.headers();
    const isPayload =
      request.method() === "GET" &&
      (headers["rsc"] !== undefined ||
        (request.isNavigationRequest() &&
          (headers["accept"] ?? "").includes("text/html")));
    if (!isPayload) {
      await route.fallback();
      return;
    }
    seen.requests += 1;
    await new Promise((resolve) => setTimeout(resolve, DELAY_MS));
    await route.continue();
  });
  return seen;
};

type Measurement = {
  readonly clickAt: number | null;
  readonly firstAt: number | null;
  readonly kind: string | null;
  readonly appearanceChanged: boolean | null;
  readonly discarded: number;
};

// THE OBSERVER, INSTALLED BEFORE THE PRESS AND SCOPED TO THE PRESSED
// CONTROL'S OWN FORM.
const armMeasurement = async (control: Locator): Promise<void> => {
  await control.evaluate((node) => {
    const control = node as HTMLElement;
    const scope = control.closest("form") ?? control.parentElement;
    if (scope === null) {
      throw new Error("the pressed control has no ancestor form to scope to");
    }
    const PROPERTIES = [
      "opacity",
      "cursor",
      "color",
      "background-color",
      "border-color",
      "transform",
      "box-shadow",
      "text-decoration-line",
    ];
    const snapshot = (): string => {
      const own = getComputedStyle(control);
      const mark = getComputedStyle(control, "::after");
      return [
        ...PROPERTIES.map((property) => own.getPropertyValue(property)),
        mark.content,
        ...PROPERTIES.map((property) => mark.getPropertyValue(property)),
      ].join("|");
    };
    const before = snapshot();
    const state: Measurement & {
      clickAt: number | null;
      firstAt: number | null;
      kind: string | null;
      appearanceChanged: boolean | null;
      discarded: number;
    } = {
      clickAt: null,
      firstAt: null,
      kind: null,
      appearanceChanged: null,
      discarded: 0,
    };
    (window as unknown as { __pulseBusy: typeof state }).__pulseBusy = state;
    control.addEventListener(
      "click",
      () => {
        state.clickAt = performance.now();
      },
      { capture: true, once: true },
    );
    const ATTRIBUTES = ["aria-busy", "aria-disabled", "disabled", "class"];
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        if (state.firstAt !== null) {
          return;
        }
        const target = record.target;
        const inside =
          target === control ||
          (target.nodeType === Node.ELEMENT_NODE
            ? control.contains(target)
            : control.contains(target.parentNode));
        const named =
          record.type === "attributes"
            ? ATTRIBUTES.includes(record.attributeName ?? "")
            : record.type === "childList" || record.type === "characterData";
        if (!inside || !named) {
          state.discarded += 1;
          continue;
        }
        state.firstAt = performance.now();
        state.kind = `${record.type}:${record.attributeName ?? ""}`;
        state.appearanceChanged = snapshot() !== before;
      }
    });
    observer.observe(scope, {
      childList: true,
      subtree: true,
      attributes: true,
      characterData: true,
    });
  });
};

const readMeasurement = (page: Page): Promise<Measurement> =>
  page.evaluate(
    () =>
      (window as unknown as { __pulseBusy: Measurement }).__pulseBusy ?? {
        clickAt: null,
        firstAt: null,
        kind: null,
        appearanceChanged: null,
        discarded: 0,
      },
  );

const collectTestidText = (page: Page): Promise<readonly (readonly string[])[]> =>
  page.evaluate(() =>
    [...document.querySelectorAll("[data-testid]")].map((element) => [
      element.getAttribute("data-testid") ?? "",
      (element.textContent ?? "").trim(),
    ]),
  );

type PressResult = {
  readonly name: string;
  readonly intervalMs: number;
  readonly kind: string;
  readonly appearanceChanged: boolean;
  readonly requests: number;
  readonly releaseGapMs: number;
  readonly busyAtSettle: boolean;
  readonly pressableAtSettle: boolean;
  readonly markAtSettle: string;
  readonly testidsStable: boolean;
};

// ONE PRESS SEQUENCE, CARRYING FOUR CRITERIA. The control is pressed, then
// pressed again 100ms later inside the delay window (criterion 10.4); the
// first DOM change inside the pressed control is timed (10.2); the busy
// state is read at 1000ms, before the response is released (10.3); and the
// testid/text collection is compared across the same window (10.10).
const pressAndMeasure = async (
  page: Page,
  probe: ActionProbe,
  name: string,
  control: Locator,
): Promise<PressResult> => {
  const before = await collectTestidText(page);
  await armMeasurement(control);
  const clickAt = Date.now();
  probe.reset(clickAt);
  await control.click();
  await page.waitForTimeout(100);
  // THE SECOND PRESS, forced past actionability on purpose: a control that
  // refuses the press is exactly what is being measured, and waiting for it
  // to become actionable would wait out the delay window.
  await control.click({ force: true, timeout: 1000 }).catch(() => undefined);

  const measurement = await readMeasurement(page);
  await page.waitForTimeout(Math.max(0, SETTLE_MS - (Date.now() - clickAt)));

  const settle = await control.evaluate((node) => {
    const element = node as HTMLButtonElement;
    return {
      busy: element.getAttribute("aria-busy") === "true",
      pressable: !element.disabled && element.getAttribute("aria-disabled") !== "true",
      mark: getComputedStyle(element, "::after").content,
    };
  });
  const after = await collectTestidText(page);

  // Let the delayed response through and the resulting navigation settle.
  await page.waitForTimeout(DELAY_MS + 500);

  return {
    name,
    intervalMs:
      measurement.firstAt === null || measurement.clickAt === null
        ? Number.POSITIVE_INFINITY
        : measurement.firstAt - measurement.clickAt,
    kind: measurement.kind ?? "none",
    appearanceChanged: measurement.appearanceChanged === true,
    requests: probe.requests,
    releaseGapMs: probe.firstReleaseGapMs ?? 0,
    busyAtSettle: settle.busy,
    pressableAtSettle: settle.pressable,
    markAtSettle: settle.mark,
    testidsStable: JSON.stringify(before) === JSON.stringify(after),
  };
};

const assertAcknowledged = (result: PressResult, predicts: boolean): void => {
  // (c) the interval, and the change is one a reader could see
  expect(
    result.intervalMs,
    `${result.name}: first DOM change inside the pressed control`,
  ).toBeLessThanOrEqual(CEILING_MS);
  expect(result.kind, `${result.name}: the record that stopped the clock`).not.toBe(
    "none",
  );
  expect(
    result.appearanceChanged,
    `${result.name}: computed appearance changed in the callback that stopped the clock`,
  ).toBe(true);
  // (d) the server really waited
  expect(result.requests, `${result.name}: server action requests`).toBe(1);
  expect(
    result.releaseGapMs,
    `${result.name}: response released after the click`,
  ).toBeGreaterThanOrEqual(1500);
  // criterion 10.3, at 1000ms and before the response is released
  expect(result.busyAtSettle, `${result.name}: aria-busy at 1000ms`).toBe(true);
  expect(result.pressableAtSettle, `${result.name}: pressable at 1000ms`).toBe(false);
  expect(result.markAtSettle, `${result.name}: busy mark at 1000ms`).not.toBe("none");
  // criterion 10.10, nothing is predicted
  if (!predicts) {
    expect(
      result.testidsStable,
      `${result.name}: no rendered testid changed before the server answered`,
    ).toBe(true);
  }
};

const signUpFreshAndMeasure = async (
  page: Page,
  probe: ActionProbe,
): Promise<{ readonly email: string; readonly password: string; readonly result: PressResult }> => {
  const unique = `busy-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
  const email = `${unique}@pulse-e2e.test`;
  const password = `pw-${unique}`;
  await page.goto("/sign-up");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  const result = await pressAndMeasure(
    page,
    probe,
    "sign-up submit",
    page.getByRole("button", { name: "Create household" }),
  );
  await expect(page.getByTestId("household-context")).toHaveText(unique);
  return { email, password, result };
};

test.describe("the busy state", () => {
  test.setTimeout(300_000);

  test("every submit control acknowledges the press before the server answers", async ({
    page,
  }) => {
    const probe = await delayServerActions(page);
    const results: PressResult[] = [];

    // 1. sign up
    const { email, password, result: signUp } = await signUpFreshAndMeasure(page, probe);
    results.push(signUp);

    // 2. register accounts, the one submit that is not the shared leaf
    await page.goto("/accounts");
    await fillSetupRows(page, [
      { label: "Daily account", bank: "Demobank", accountNumber: FIXTURE_ACCOUNT_A, ring: "POT" },
      { label: "Savings", bank: "Demobank", accountNumber: FIXTURE_ACCOUNT_B, ring: "RESERVE" },
    ]);
    results.push(
      await pressAndMeasure(page, probe, "register accounts submit", page.getByTestId("register-accounts")),
    );
    await expect(page.getByTestId("registered-account")).toHaveCount(2);

    // 3. the ring switch, on the account no fixture belongs to
    const savingsRow = page.getByTestId("registered-account").filter({ hasText: "Savings" });
    results.push(
      await pressAndMeasure(page, probe, "ring switch submit", savingsRow.getByTestId("switch-account-ring")),
    );

    // 4. the upload submit
    await page.goto("/import");
    await page.getByLabel("Bank export file").setInputFiles(CSV_FIXTURE);
    results.push(
      await pressAndMeasure(page, probe, "upload submit", page.getByRole("button", { name: "Upload" })),
    );
    await expect(page.getByRole("heading", { name: "Confirm the detected format" })).toBeVisible();

    // 5. the preview-again submit, inside the disclosure it lives in
    await page.getByRole("group").filter({ hasText: "Format spec" }).first().click().catch(() => undefined);
    const disclosure = page.locator("details.spec-editor");
    await disclosure.locator("summary").click();
    results.push(
      await pressAndMeasure(page, probe, "preview-again submit", disclosure.getByRole("button", { name: "Preview again" })),
    );
    await expect(page.getByRole("heading", { name: "Confirm the detected format" })).toBeVisible();

    // 6. the confirm submit
    await page.getByLabel("Format name").fill("Demobank current account");
    results.push(
      await pressAndMeasure(page, probe, "confirm submit", page.getByTestId("confirm-import")),
    );
    await expect(page.getByTestId("import-result")).toBeVisible();

    // 7. the merchant naming submit, the one surface M3-P11 will make predict
    await page.goto("/merchants");
    const group = page.getByTestId("unresolved-group").first();
    await group.getByPlaceholder("Name this counterparty").fill("Named once");
    results.push(
      await pressAndMeasure(page, probe, "merchant naming submit", group.getByRole("button", { name: "Name" })),
    );

    // 8. the sign-out submit
    results.push(
      await pressAndMeasure(page, probe, "sign-out submit", page.getByRole("button", { name: "Sign out" })),
    );

    // 9. the sign-in submit
    await page.goto("/sign-in");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(password);
    results.push(
      await pressAndMeasure(page, probe, "sign-in submit", page.getByRole("button", { name: "Sign in" })),
    );

    // (a) THE SET IS THE ONE THIS PHASE COVERS, asserted by name so a
    // control the spec never reached fails rather than being skipped.
    expect(results.map((result) => result.name)).toEqual([
      "sign-up submit",
      "register accounts submit",
      "ring switch submit",
      "upload submit",
      "preview-again submit",
      "confirm submit",
      "merchant naming submit",
      "sign-out submit",
      "sign-in submit",
    ]);

    console.log(`[busy-state:${test.info().project.name}] ${JSON.stringify(results, null, 1)}`);

    for (const result of results) {
      assertAcknowledged(result, result.name === "merchant naming submit");
    }

    // Criterion 10.3, second half: the busy state does not survive the
    // response.
    await expect(page.locator('[aria-busy="true"]')).toHaveCount(0);
  });

  test("the merchant naming submit, five different rows, is acknowledged in under a tenth of a second", async ({
    page,
  }) => {
    const probe = await delayServerActions(page);
    await signUpFreshAndMeasure(page, probe);

    await page.goto("/accounts");
    await fillSetupRows(page, [
      { label: "Daily account", bank: "Demobank", accountNumber: FIXTURE_ACCOUNT_A, ring: "POT" },
    ]);
    await page.getByTestId("register-accounts").click();
    await expect(page.getByTestId("registered-account")).toHaveCount(1);

    await page.goto("/import");
    await page.getByLabel("Bank export file").setInputFiles(CSV_FIXTURE);
    await page.getByRole("button", { name: "Upload" }).click();
    await expect(page.getByRole("heading", { name: "Confirm the detected format" })).toBeVisible();
    await page.getByLabel("Format name").fill("Demobank current account");
    await page.getByTestId("confirm-import").click();
    await expect(page.getByTestId("import-result")).toBeVisible();

    await page.goto("/merchants");
    await expect(page.getByTestId("unresolved-group")).toHaveCount(5);

    const intervals: number[] = [];
    for (let index = 0; index < 5; index += 1) {
      const remaining = await page.getByTestId("unresolved-group").count();
      expect(remaining, "a naming that fails does not satisfy this").toBe(5 - index);
      const group = page.getByTestId("unresolved-group").first();
      const label = (await group.getByTestId("group-label").textContent()) ?? "";
      await group.getByPlaceholder("Name this counterparty").fill(`Named ${index}`);
      const result = await pressAndMeasure(
        page,
        probe,
        `naming row ${index}`,
        group.getByRole("button", { name: "Name" }),
      );
      expect(result.requests, `${label.slice(0, 0)}row ${index}: one request`).toBe(1);
      expect(result.appearanceChanged).toBe(true);
      intervals.push(result.intervalMs);
      await expect(page.getByTestId("unresolved-group")).toHaveCount(4 - index);
    }

    const median = [...intervals].sort((a, b) => a - b)[2] as number;
    console.log(
      `[busy-state:${test.info().project.name}] naming intervals ${JSON.stringify(intervals)} median ${median}`,
    );
    expect(median).toBeLessThanOrEqual(MEDIAN_CEILING_MS);
  });

  test("every navigating control changes the screen within the same window", async ({
    page,
  }) => {
    const probe = await delayServerActions(page);
    await signUpFreshAndMeasure(page, probe);
    await page.unrouteAll({ behavior: "ignoreErrors" });

    type Branch = { readonly name: string; readonly branch: string };
    const branches: Branch[] = [];

    // THE DESTINATION IS DELAYED, not the action: a Link press is not a
    // form. Installed and removed around the measurements so the journey
    // that seeds the data does not pay 2000ms per navigation.
    let navDelay: { requests: number } | undefined;
    const withNavDelay = async (): Promise<void> => {
      navDelay = await delayNavigations(page);
    };
    const withoutNavDelay = async (): Promise<void> => {
      await page.unrouteAll({ behavior: "ignoreErrors" });
    };

    const measureNavigation = async (
      name: string,
      control: Locator,
      destination: RegExp,
    ): Promise<void> => {
      await control.scrollIntoViewIfNeeded();
      await expect(page.locator("[data-link-pending]")).toHaveCount(0);
      // BOTH WAITERS ARE ARMED BEFORE THE PRESS, each capped at the
      // criterion's own window, so "neither branch inside 200ms" is a real
      // outcome rather than a polling artefact.
      const marker = page
        .locator("[data-link-pending]")
        .first()
        .waitFor({ state: "visible", timeout: CEILING_MS })
        .then(() => "marker" as const)
        .catch(() => null);
      const arrived = page
        .waitForURL(destination, { timeout: CEILING_MS })
        .then(() => "destination" as const)
        .catch(() => null);
      await control.click({ noWaitAfter: true });
      const [byMarker, byDestination] = await Promise.all([marker, arrived]);
      branches.push({ name, branch: byMarker ?? byDestination ?? "neither" });
      await page.waitForURL(destination, { timeout: 60_000 });
      // A marker left behind after the destination rendered fails.
      await expect(page.locator("[data-link-pending]")).toHaveCount(0, {
        timeout: 500,
      });
    };

    // The two empty-state calls to action, on a household with no data.
    await withNavDelay();
    await page.goto("/");
    await expect(page.getByTestId("empty-state")).toBeVisible();
    await measureNavigation(
      "empty-state-accounts-link",
      page.getByTestId("empty-state-accounts-link"),
      /\/accounts$/,
    );
    await page.goto("/");
    await measureNavigation(
      "empty-state-import-link",
      page.getByTestId("empty-state-import-link"),
      /\/import$/,
    );

    // The four shell links.
    for (const [testId, destination] of [
      ["nav-merchants", /\/merchants$/],
      ["nav-accounts", /\/accounts$/],
      ["nav-import", /\/import$/],
      ["nav-overview", /\/(\?.*)?$/],
    ] as const) {
      await measureNavigation(testId, page.getByTestId(testId), destination);
    }
    await withoutNavDelay();

    // The month controls need data.
    await page.goto("/accounts");
    await fillSetupRows(page, [
      { label: "Daily account", bank: "Demobank", accountNumber: FIXTURE_ACCOUNT_A, ring: "POT" },
    ]);
    await page.getByTestId("register-accounts").click();
    await expect(page.getByTestId("registered-account")).toHaveCount(1);
    await page.goto("/import");
    await page.getByLabel("Bank export file").setInputFiles(CSV_FIXTURE);
    await page.getByRole("button", { name: "Upload" }).click();
    await expect(page.getByRole("heading", { name: "Confirm the detected format" })).toBeVisible();
    await page.getByLabel("Format name").fill("Demobank current account");
    await page.getByTestId("confirm-import").click();
    await expect(page.getByTestId("import-result")).toBeVisible();

    // The month the fixture lives in, reached by the view's own query
    // parameter so the measurement does not depend on the clock: the
    // production server refuses a frozen one.
    await withNavDelay();
    await page.goto("/?month=2026-08");
    await measureNavigation("unresolved-pill", page.getByTestId("unresolved-pill"), /\/merchants$/);
    await page.goto("/?month=2026-08");
    await measureNavigation(
      "month-step-previous",
      page.getByTestId("month-step-previous"),
      /month=2026-07/,
    );
    await measureNavigation(
      "month-step-next",
      page.getByTestId("month-step-next"),
      /month=2026-08/,
    );
    expect(navDelay?.requests ?? 0, "the destination really waited").toBeGreaterThan(0);
    await withoutNavDelay();

    // (a) THE SET, asserted by name.
    expect(branches.map((entry) => entry.name).sort()).toEqual([
      "empty-state-accounts-link",
      "empty-state-import-link",
      "month-step-next",
      "month-step-previous",
      "nav-accounts",
      "nav-import",
      "nav-merchants",
      "nav-overview",
      "unresolved-pill",
    ]);
    console.log(
      `[busy-state:${test.info().project.name}] navigation branches ${JSON.stringify(branches)}`,
    );
    for (const entry of branches) {
      expect(entry.branch, `${entry.name}: neither branch inside the window`).not.toBe(
        "neither",
      );
    }
  });
});
