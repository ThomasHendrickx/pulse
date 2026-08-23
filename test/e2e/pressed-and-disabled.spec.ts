import { expect, test, type Page } from "@playwright/test";
import { join } from "node:path";

// M3-P9, criteria 9.2, 9.3 and 9.4. THE PRESSED APPEARANCE IS MEASURED BY
// PRESSING, and the disabled, busy and unconfirmed appearances are measured
// by entering them.
//
// Why this file exists at all: at 89ed187 the product declared no :active
// rule, no :disabled rule and no transition anywhere, so a control looked
// identical the instant before, during and after a press. The only
// pressability cue in the tree was cursor: pointer on five rules, which the
// phone the owner reported from cannot draw. A grep for ":active" would have
// proved nothing about what the screen does, which is why every assertion
// below reads getComputedStyle out of a real browser with the pointer held
// down.
//
// THE DISABLED AND BUSY STATES ARE APPLIED THROUGH THE DOM (decision D-28).
// Nothing in the product enters them until M3-P10. What that technique
// proves is that the shipped stylesheet renders a visibly different control
// when the state is present; what it does not prove is that anything ever
// sets the state, which is M3-P10's job and is measured there.

const CSV_FIXTURE = join(__dirname, "..", "fixtures", "belfius-account-a.csv");
const REJECTED_FIXTURE = join(__dirname, "..", "fixtures", "unknown-layout.pdf");

// The sweep selector. The set is COLLECTED by running this on every screen
// the journey reaches, never by looking up a list of known controls: a spec
// that looks up its own denominator decides its own score, which is the
// error hazard H9.8 records.
const CONTROL_SELECTOR =
  'button, a[href], summary, input[type="submit"], input[type="button"], [role="button"]';

// THE ENUMERATION, nineteen controls from seventeen source sites, the
// shell's NavLink accounting for three of them. Criterion 9.2(a) fails in
// BOTH directions against this list: a control the sweep does not reach
// fails, and a control the sweep finds that is not named here fails too. If
// the two disagree the enumeration is amended and the sweep is never
// narrowed.
const ENUMERATION: readonly string[] = [
  // The seven submit controls.
  "button.auth-submit|Sign in",
  "button.auth-submit|Create household",
  "button.import-primary|Upload",
  "button|Preview again",
  "button[data-testid=confirm-import]",
  "button.merchant-name-button|Name",
  "button.app-signout|Sign out",
  // The seven navigating controls.
  "a[data-testid=nav-overview]",
  "a[data-testid=nav-import]",
  "a[data-testid=nav-merchants]",
  "a[data-testid=empty-state-import-link]",
  "a[data-testid=unresolved-pill]",
  "a.month-nav|‹",
  "a.month-nav|›",
  // The spec editor's disclosure summary.
  "summary|Detected format description",
  // The four remaining links.
  "a|Create household",
  "a|Sign in",
  "a|Import another file",
  "a|Back to import",
];

// The magnitudes. Both were put into the criteria after a review round
// found that "transform: translateY(0.01px)" and an opacity change of 0.005
// satisfied the first version of them on every control.
const MIN_CONTRAST_RATIO = 1.1;
const MIN_OPACITY_DELTA = 0.15;
const MIN_PRESS_TRAVEL_PX = 1;

type Snapshot = {
  readonly backgroundColor: string;
  readonly color: string;
  readonly borderColor: string;
  readonly borderTopColor: string;
  readonly boxShadow: string;
  readonly transform: string;
  readonly opacity: string;
  readonly textDecorationLine: string;
  readonly cursor: string;
  readonly transitionDuration: string;
  readonly animationDuration: string;
  readonly animationName: string;
  readonly ancestorBackground: string;
  readonly pressOffset: string;
  readonly rectTop: number;
  readonly afterContent: string;
  readonly afterWidth: string;
};

type Swept = { readonly index: number; readonly identity: string; readonly tag: string };

declare global {
  interface Window {
    readonly __m3p9: {
      identify(el: Element): string;
      snapshot(el: Element): Snapshot;
      parse(color: string): readonly [number, number, number, number];
      composite(
        over: readonly [number, number, number, number],
        under: readonly [number, number, number, number],
      ): readonly [number, number, number, number];
      ratio(
        a: readonly [number, number, number, number],
        b: readonly [number, number, number, number],
      ): number;
    };
  }
}

// The helpers live in the page rather than in node because getComputedStyle
// returns oklch() strings here (the ramp is declared in oklch and Chromium
// serialises it back unchanged), and the browser's own canvas is the one
// parser guaranteed to agree with the browser's own painting.
const INSTALL_HELPERS = `
window.__m3p9 = (() => {
  const canvas = document.createElement("canvas");
  canvas.width = 1;
  canvas.height = 1;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  const parse = (color) => {
    ctx.clearRect(0, 0, 1, 1);
    ctx.fillStyle = "#000";
    ctx.fillStyle = color;
    ctx.clearRect(0, 0, 1, 1);
    ctx.fillRect(0, 0, 1, 1);
    const d = ctx.getImageData(0, 0, 1, 1).data;
    return [d[0], d[1], d[2], d[3] / 255];
  };
  const composite = (over, under) => {
    const a = over[3];
    if (a >= 1) return [over[0], over[1], over[2], 1];
    return [
      over[0] * a + under[0] * (1 - a),
      over[1] * a + under[1] * (1 - a),
      over[2] * a + under[2] * (1 - a),
      1,
    ];
  };
  const channel = (v) => {
    const s = v / 255;
    return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  const luminance = (c) =>
    0.2126 * channel(c[0]) + 0.7152 * channel(c[1]) + 0.0722 * channel(c[2]);
  const ratio = (a, b) => {
    const la = luminance(a);
    const lb = luminance(b);
    const hi = Math.max(la, lb);
    const lo = Math.min(la, lb);
    return (hi + 0.05) / (lo + 0.05);
  };
  const identify = (el) => {
    const tag = el.tagName.toLowerCase();
    const testid = el.getAttribute("data-testid");
    if (testid) return tag + "[data-testid=" + testid + "]";
    const cls = (el.getAttribute("class") || "").trim();
    const text = (el.textContent || "").replace(/\\s+/g, " ").trim();
    return cls ? tag + "." + cls.split(/\\s+/).join(".") + "|" + text : tag + "|" + text;
  };
  const ancestorBackground = (el) => {
    let node = el.parentElement;
    while (node) {
      const bg = getComputedStyle(node).backgroundColor;
      if (parse(bg)[3] > 0) return bg;
      node = node.parentElement;
    }
    return getComputedStyle(document.documentElement).backgroundColor;
  };
  const snapshot = (el) => {
    const cs = getComputedStyle(el);
    const after = getComputedStyle(el, "::after");
    const rect = el.getBoundingClientRect();
    return {
      backgroundColor: cs.backgroundColor,
      color: cs.color,
      borderColor: cs.borderColor,
      borderTopColor: cs.borderTopColor,
      boxShadow: cs.boxShadow,
      transform: cs.transform,
      opacity: cs.opacity,
      textDecorationLine: cs.textDecorationLine,
      cursor: cs.cursor,
      transitionDuration: cs.transitionDuration,
      animationDuration: cs.animationDuration,
      animationName: cs.animationName,
      ancestorBackground: ancestorBackground(el),
      pressOffset: cs.getPropertyValue("--press-offset").trim(),
      rectTop: rect.top,
      afterContent: after.content,
      afterWidth: after.width,
    };
  };
  return { parse, composite, ratio, identify, snapshot };
})();
`;

const compositedRatio = async (
  page: Page,
  first: Snapshot,
  second: Snapshot,
  key: "backgroundColor" | "color" | "borderTopColor",
): Promise<number> =>
  page.evaluate(
    ([a, b, k]) => {
      const h = window.__m3p9;
      const of = (snap: Snapshot, prop: string) => {
        const under = h.parse(snap.ancestorBackground);
        const bg = h.composite(h.parse(snap.backgroundColor), under);
        return prop === "backgroundColor"
          ? bg
          : h.composite(h.parse((snap as unknown as Record<string, string>)[prop] ?? ""), bg);
      };
      return h.ratio(of(a as Snapshot, k as string), of(b as Snapshot, k as string));
    },
    [first, second, key] as const,
  );

const alphaOf = async (page: Page, color: string): Promise<number> =>
  page.evaluate((c) => window.__m3p9.parse(c)[3], color);

// Every held press is RELEASED AWAY FROM THE CONTROL: the pointer leaves the
// control's box before the button is raised, so no measurement submits a
// form, follows a link or ends the session, and the sign-out control can be
// measured in place.
const PARKING_SPOT = { x: 2, y: 2 };

const sweep = async (page: Page): Promise<readonly Swept[]> => {
  await page.evaluate(INSTALL_HELPERS);
  return page.evaluate((selector) => {
    const els = Array.from(document.querySelectorAll(selector));
    const seen = new Set<string>();
    const out: { index: number; identity: string; tag: string }[] = [];
    els.forEach((el, index) => {
      el.setAttribute("data-m3p9-probe", String(index));
      const identity = window.__m3p9.identify(el);
      if (seen.has(identity)) return;
      seen.add(identity);
      out.push({ index, identity, tag: el.tagName.toLowerCase() });
    });
    return out;
  }, CONTROL_SELECTOR);
};

const measureScreen = async (
  page: Page,
  reduced: boolean,
  collected: Set<string>,
  nonZeroTransition: { seen: boolean },
): Promise<void> => {
  for (const control of await sweep(page)) {
    collected.add(control.identity);
    const where = `${control.identity} (${page.url()})`;
    const el = page.locator(`[data-m3p9-probe="${control.index}"]`);
    await el.scrollIntoViewIfNeeded();
    const box = await el.boundingBox();
    expect(box, `no box for ${where}`).not.toBeNull();
    if (box === null) continue;
    const centre = { x: box.x + box.width / 2, y: box.y + box.height / 2 };

    // ---------- at rest, pointer parked away from the control ----------
    await page.mouse.move(PARKING_SPOT.x, PARKING_SPOT.y);
    const rest = (await el.evaluate((n) => window.__m3p9.snapshot(n))) as Snapshot;

    // ---------- 9.4(a) and 9.4(b): the motion budget ----------
    const durations = rest.transitionDuration.split(",").map((d) => parseFloat(d));
    expect(durations.length, `no transition declared on ${where}`).toBeGreaterThan(0);
    if (reduced) {
      for (const d of durations) {
        expect(d, `non-zero transition-duration under reduce on ${where}`).toBe(0);
      }
      const animated =
        rest.animationName !== "none" &&
        rest.animationDuration.split(",").some((d) => parseFloat(d) > 0);
      expect(animated, `a running animation under reduce on ${where}`).toBe(false);
    } else if (durations.some((d) => d > 0)) {
      nonZeroTransition.seen = true;
    }

    // ---------- 9.3(a): disabled ----------
    const disabledAttr =
      control.tag === "button" || control.tag === "input" ? "disabled" : "aria-disabled";
    await el.evaluate((n, attr) => n.setAttribute(attr, attr === "disabled" ? "" : "true"), disabledAttr);
    const disabled = (await el.evaluate((n) => window.__m3p9.snapshot(n))) as Snapshot;
    await el.evaluate((n, attr) => n.removeAttribute(attr), disabledAttr);
    await assertMagnitude(page, rest, disabled, `disabled ${where}`);
    expect(disabled.cursor, `disabled control still computes a pointer cursor: ${where}`).not.toBe(
      "pointer",
    );

    // ---------- 9.3(b): busy ----------
    await el.evaluate((n) => n.setAttribute("aria-busy", "true"));
    const busy = (await el.evaluate((n) => window.__m3p9.snapshot(n))) as Snapshot;
    await el.evaluate((n) => n.removeAttribute("aria-busy"));
    await assertMagnitude(page, rest, busy, `busy ${where}`);
    expect(busy.afterContent, `busy mark has no content on ${where}`).not.toBe("none");
    expect(parseFloat(busy.afterWidth), `busy mark has zero width on ${where}`).toBeGreaterThan(0);

    // ---------- 9.2(b): the pressed difference, against the HOVERING state ----------
    await page.mouse.move(centre.x, centre.y);
    const hovering = (await el.evaluate((n) => window.__m3p9.snapshot(n))) as Snapshot;
    await page.mouse.down();
    const held = (await el.evaluate((n) => window.__m3p9.snapshot(n))) as Snapshot;
    await page.mouse.move(PARKING_SPOT.x, PARKING_SPOT.y);
    await page.mouse.up();

    // (i) MOVEMENT. The computed transform is checked AND the element's own
    // box is checked, because getComputedStyle reports a translation matrix
    // on a non-replaced inline box that does not move at all: the computed
    // value alone is satisfiable without anything on screen changing.
    const travel = translationY(held.transform);
    const offset = parseFloat(held.pressOffset);
    expect(offset, `--press-offset below one pixel for ${where}`).toBeGreaterThanOrEqual(
      MIN_PRESS_TRAVEL_PX,
    );
    expect(Math.abs(travel), `pressed transform does not translate ${where}`).toBeGreaterThanOrEqual(
      MIN_PRESS_TRAVEL_PX,
    );
    expect(
      Math.abs(Math.abs(travel) - offset),
      `pressed translation ${travel} does not equal --press-offset ${offset} for ${where}`,
    ).toBeLessThan(0.01);
    expect(
      Math.abs(held.rectTop - hovering.rectTop),
      `the pressed control's own box did not move for ${where}`,
    ).toBeGreaterThanOrEqual(MIN_PRESS_TRAVEL_PX - 0.01);

    // (ii) SURFACE, composited, against the hovering value.
    const bgRatio = await compositedRatio(page, hovering, held, "backgroundColor");
    const inkRatio = await compositedRatio(page, hovering, held, "color");
    expect(
      Math.max(bgRatio, inkRatio),
      `pressed surface too close to the hovering surface for ${where}` +
        ` (background ${bgRatio.toFixed(3)}, colour ${inkRatio.toFixed(3)})`,
    ).toBeGreaterThanOrEqual(MIN_CONTRAST_RATIO);
    if ((await alphaOf(page, hovering.backgroundColor)) === 0) {
      expect(
        await alphaOf(page, held.backgroundColor),
        `pressed tint below the alpha floor on a transparent control: ${where}`,
      ).toBeGreaterThanOrEqual(0.08);
    }
  }
};

const assertMagnitude = async (
  page: Page,
  rest: Snapshot,
  entered: Snapshot,
  label: string,
): Promise<void> => {
  const bgRatio = await compositedRatio(page, rest, entered, "backgroundColor");
  const inkRatio = await compositedRatio(page, rest, entered, "color");
  const borderRatio = await compositedRatio(page, rest, entered, "borderTopColor");
  const opacityDelta = Math.abs(parseFloat(rest.opacity) - parseFloat(entered.opacity));
  const best = Math.max(bgRatio, inkRatio, borderRatio);
  const passes = best >= MIN_CONTRAST_RATIO || opacityDelta >= MIN_OPACITY_DELTA;
  expect(
    passes,
    `${label}: background ${bgRatio.toFixed(3)}, colour ${inkRatio.toFixed(3)},` +
      ` border ${borderRatio.toFixed(3)}, opacity delta ${opacityDelta.toFixed(3)}`,
  ).toBe(true);
  const restAlpha = await alphaOf(page, rest.backgroundColor);
  if (restAlpha === 0 && bgRatio >= MIN_CONTRAST_RATIO) {
    expect(
      await alphaOf(page, entered.backgroundColor),
      `${label}: tint below the alpha floor on a transparent control`,
    ).toBeGreaterThanOrEqual(0.08);
  }
};

const translationY = (transform: string): number => {
  if (transform === "none") return 0;
  const matrix = transform.match(/^matrix\(([^)]+)\)$/);
  if (matrix) {
    const parts = (matrix[1] ?? "").split(",").map((p) => parseFloat(p));
    return parts[5] ?? 0;
  }
  const matrix3d = transform.match(/^matrix3d\(([^)]+)\)$/);
  if (matrix3d) {
    const parts = (matrix3d[1] ?? "").split(",").map((p) => parseFloat(p));
    return parts[13] ?? 0;
  }
  return 0;
};

const runJourney = async (page: Page, reduced: boolean): Promise<void> => {
  const collected = new Set<string>();
  const nonZeroTransition = { seen: false };
  const measure = () => measureScreen(page, reduced, collected, nonZeroTransition);

  const unique = `press-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
  const email = `${unique}@pulse-e2e.test`;
  const password = `pw-${unique}`;

  // THE SIGN-IN SCREEN, which a journey that signs UP never visits: the
  // middleware sends an authenticated visitor away from both auth paths, so
  // both are measured before the household exists.
  await page.goto("/sign-in");
  await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
  await measure();

  await page.goto("/sign-up");
  await expect(page.getByRole("button", { name: "Create household" })).toBeVisible();
  await measure();

  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Create household" }).click();
  await expect(page.getByTestId("household-context")).toHaveText(unique);

  // THE MONTH VIEW BEFORE ANY IMPORT, which is the only state that renders
  // the empty-state link.
  await expect(page.getByTestId("empty-state")).toBeVisible();
  await measure();

  await page.goto("/import");
  await expect(page.getByRole("button", { name: "Upload" })).toBeVisible();
  await measure();

  // THE DELIMITED PATH, not the PDF one: the spec editor and its
  // preview-again submit render only for a delimited source.
  await page.getByLabel("Bank export file").setInputFiles(CSV_FIXTURE);
  await page.getByRole("button", { name: "Upload" }).click();
  await expect(
    page.getByRole("heading", { name: "Confirm the detected format" }),
  ).toBeVisible();
  // The disclosure carries no open attribute, so the preview-again submit is
  // not rendered until it is opened.
  await page.locator("details.spec-editor summary").click();
  await expect(page.getByRole("button", { name: "Preview again" })).toBeVisible();
  await measure();

  await page.getByLabel("Format name").fill("Demobank current account");
  await page.getByLabel("Label").fill("Daily account");
  await page.getByLabel("Bank").fill("Demobank");
  await page.getByLabel("Ring").selectOption("POT");
  await page.getByTestId("confirm-import").click();
  await expect(page.getByTestId("import-result")).toBeVisible();
  await measure();

  await page.goto("/merchants");
  await expect(page.getByRole("heading", { name: "Merchant review" })).toBeVisible();
  await measure();

  // 9.3(c): the unconfirmed marking M3-P11 will put on a predicted row. It
  // is NOT aria-busy, because aria-busy tells assistive technology to hold
  // back the changes inside the element and would suppress the announcement
  // of the very change it marks.
  await page.evaluate(INSTALL_HELPERS);
  const row = page.getByTestId("unresolved-group").first();
  await expect(row).toBeVisible();
  const rowRest = (await row.evaluate((n) => window.__m3p9.snapshot(n))) as Snapshot;
  await row.evaluate((n) => n.setAttribute("data-unconfirmed", ""));
  const rowMarked = (await row.evaluate((n) => window.__m3p9.snapshot(n))) as Snapshot;
  await row.evaluate((n) => n.removeAttribute("data-unconfirmed"));
  await assertMagnitude(page, rowRest, rowMarked, "unconfirmed row");
  expect(rowMarked.afterContent, "unconfirmed row carries no mark").not.toBe("none");

  // A CLOSED MONTH THAT HAS A LATER ONE, reached by the month view's own
  // query parameter rather than by whatever month the clock lands on, so the
  // next month step renders.
  await page.goto("/?month=2026-08");
  await expect(page.getByTestId("month-title")).toBeVisible();
  await expect(page.getByLabel("Next month")).toBeVisible();
  await expect(page.getByTestId("unresolved-pill")).toBeVisible();
  await measure();

  // AN IMPORT THE PARSER REJECTS, for the back-to-import link on the failed
  // screen.
  await page.goto("/import");
  await page.getByLabel("Bank export file").setInputFiles(REJECTED_FIXTURE);
  await page.getByRole("button", { name: "Upload" }).click();
  await expect(page.getByTestId("import-failed")).toBeVisible();
  await measure();

  // 9.2(a): the collected set, in BOTH directions.
  const found = [...collected].sort();
  const expected = [...ENUMERATION].sort();
  expect(found, "the swept control set is not the enumeration").toEqual(expected);
  expect(found).toHaveLength(19);

  if (!reduced) {
    expect(
      nonZeroTransition.seen,
      "no control reported a non-zero transition-duration under no-preference",
    ).toBe(true);
  }
};

test.describe("pressed, disabled and busy appearances at full motion", () => {
  test.use({ contextOptions: { reducedMotion: "no-preference" } });

  test("every control looks pressed while held, unusable while disabled and busy while busy", async ({
    page,
  }) => {
    test.setTimeout(180_000);
    await runJourney(page, false);
  });
});

test.describe("pressed, disabled and busy appearances under reduced motion", () => {
  test.use({ contextOptions: { reducedMotion: "reduce" } });

  test("the same appearances survive reduce, and only the easing is gone", async ({ page }) => {
    test.setTimeout(180_000);
    await runJourney(page, true);
  });
});
