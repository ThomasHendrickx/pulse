import { expect, test, type Locator, type Page } from "@playwright/test";
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
//
// FIX ROUND 1, FINDING HZ-M3P9-01. Everything above this line presses with
// page.mouse.down. A mouse press under a phone device descriptor is a mouse
// measurement at a phone width, and the report this phase answers came from
// a finger. The touch measurement lives at the bottom of this file, under
// the chromium-phone project only, and it is the one that decides whether
// the pressed appearance is reachable from the input the owner uses.

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
  // THE ONLY ANIMATION THIS PHASE SHIPS IS ON A PSEUDO-ELEMENT, and the two
  // control-level animation fields above are "none" and "0s" on every
  // control at both motion settings whether the reduced-motion block exists
  // or not. Reading them and calling that a reduced-motion check is a
  // vacuous assertion, which is finding HZ-M3P9-03. These two are read from
  // getComputedStyle(node, "::after"), where the loop actually lives.
  readonly afterAnimationName: string;
  readonly afterAnimationDuration: string;
  readonly pointerEvents: string;
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
      afterAnimationName: after.animationName,
      afterAnimationDuration: after.animationDuration,
      pointerEvents: cs.pointerEvents,
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

// EVERY SNAPSHOT IS TAKEN AFTER THE TRANSITION HAS FINISHED, AND THE RULE IS
// NOT LOCAL TO THIS FILE. The mechanism is READING A COMPUTED STYLE ACROSS A
// STATE CHANGE THAT IS TRANSITIONED: the read returns the value the element
// is transitioning FROM, not the one it is transitioning to. This phase is
// the first to put a transition on anything in this product, so this file is
// where the rule was paid for: the first attempt at a green run failed with a
// contrast ratio of exactly 1.000 on a control whose disabled rule was
// present and correct, which is a false red, and the same mechanism produces
// a false GREEN wherever a measurement expects two states to look the same.
//
// THE SIBLINGS THAT SHARE IT, so the next reader knows the rule is not local:
// every existing spec that reads getComputedStyle after changing state or
// route, which today is test/e2e/month-view.spec.ts, and, next, M3-P10's
// measurement of the interval between a press and the first DOM change,
// which reads a style immediately after a press by design and is the phase
// this trap is most likely to bite. The remedy is the settle() below, not a
// fixed wait.
//
// Infinite animations are excluded from the wait, because the busy mark's
// loop does not finish by design.
const settle = async (el: Locator): Promise<void> => {
  await el.evaluate(async (node) => {
    // Force the pending style recalculation, so a transition that has just
    // been triggered exists before it is asked for.
    void getComputedStyle(node).backgroundColor;
    const running = node.getAnimations().filter((animation) => {
      const timing = animation.effect?.getComputedTiming();
      return animation.playState === "running" && timing?.iterations !== Infinity;
    });
    await Promise.all(
      running.map((animation) =>
        animation.finished.then(
          () => undefined,
          () => undefined,
        ),
      ),
    );
  });
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
    await settle(el);
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
    await settle(el);
    const disabled = (await el.evaluate((n) => window.__m3p9.snapshot(n))) as Snapshot;
    await el.evaluate((n, attr) => n.removeAttribute(attr), disabledAttr);
    await assertMagnitude(page, rest, disabled, `disabled ${where}`);
    expect(disabled.cursor, `disabled control still computes a pointer cursor: ${where}`).not.toBe(
      "pointer",
    );

    // A CONTROL THAT LOOKS DISABLED MUST NOT STILL WORK (fix round 1,
    // finding HZ-M3P9-02). aria-disabled is the ONLY way eight of these
    // nineteen controls can be marked, because a link and a summary have no
    // disabled attribute; before this round the aria branch dressed a
    // control in the full disabled appearance including cursor: default and
    // removed nothing, so a disabled-looking link still navigated, a
    // disabled-looking submit still posted and a disabled-looking
    // disclosure still toggled. This pass sets aria-disabled on EVERY
    // control whatever its tag, so the summary and the buttons are covered
    // by the same assertion as the links; the real activation refusal is
    // measured on two structurally different shapes in its own test below.
    await el.evaluate((n) => n.setAttribute("aria-disabled", "true"));
    const ariaDisabled = (await el.evaluate((n) => window.__m3p9.snapshot(n))) as Snapshot;
    await el.evaluate((n) => n.removeAttribute("aria-disabled"));
    expect(
      ariaDisabled.pointerEvents,
      `an aria-disabled control still accepts pointer input: ${where}`,
    ).toBe("none");

    // ---------- 9.3(b): busy ----------
    await el.evaluate((n) => n.setAttribute("aria-busy", "true"));
    await settle(el);
    const busy = (await el.evaluate((n) => window.__m3p9.snapshot(n))) as Snapshot;
    const busyAnimations = await el.evaluate((n) =>
      n
        .getAnimations({ subtree: true })
        .filter((a) => a.playState === "running")
        .map((a) => String(a.effect?.getComputedTiming().duration ?? "")),
    );
    await el.evaluate((n) => n.removeAttribute("aria-busy"));
    await assertMagnitude(page, rest, busy, `busy ${where}`);
    expect(busy.afterContent, `busy mark has no content on ${where}`).not.toBe("none");
    expect(parseFloat(busy.afterWidth), `busy mark has zero width on ${where}`).toBeGreaterThan(0);

    // 9.4(a), THE ANIMATION HALF, READ WHERE THE ANIMATION ACTUALLY IS
    // (fix round 1, finding HZ-M3P9-03). The loop is declared on
    // [aria-busy="true"]::after, so the control's own animation-name is
    // "none" at both motion settings and asserting on it proves nothing:
    // deleting --duration-busy-cycle from the reduced-motion block would
    // leave the mark spinning under reduce and the old assertion stayed
    // green. Both halves below redden on exactly that removal: the computed
    // duration of the pseudo-element's animation, and the running-animation
    // enumeration, which is the one a constant field cannot satisfy.
    if (reduced) {
      const afterAnimated =
        busy.afterAnimationName !== "none" &&
        busy.afterAnimationDuration.split(",").some((d) => parseFloat(d) > 0);
      expect(
        afterAnimated,
        `the busy mark still animates under reduce on ${where}` +
          ` (name ${busy.afterAnimationName}, duration ${busy.afterAnimationDuration})`,
      ).toBe(false);
      expect(
        busyAnimations,
        `a running animation under reduce while busy on ${where}`,
      ).toEqual([]);
    } else {
      expect(
        busy.afterAnimationName,
        `the busy mark declares no animation under no-preference on ${where}`,
      ).not.toBe("none");
      expect(
        busy.afterAnimationDuration.split(",").some((d) => parseFloat(d) > 0),
        `the busy mark's loop has zero duration under no-preference on ${where}`,
      ).toBe(true);
    }

    // .pulse-busy IS SHIPPED, SO .pulse-busy IS MEASURED (fix round 1,
    // finding HZ-M3P9-04). It is the class M3-P10 is told to put on a
    // link-shaped control, and before this round nothing in the suite
    // touched it: the selectors could have been deleted or misspelled and
    // every criterion stayed green. It carries the same magnitude and the
    // same mark as the attribute branch, so it is asserted the same way.
    await el.evaluate((n) => n.classList.add("pulse-busy"));
    await settle(el);
    const classBusy = (await el.evaluate((n) => window.__m3p9.snapshot(n))) as Snapshot;
    await el.evaluate((n) => n.classList.remove("pulse-busy"));
    await assertMagnitude(page, rest, classBusy, `class-busy ${where}`);
    expect(classBusy.afterContent, `.pulse-busy mark has no content on ${where}`).not.toBe("none");
    expect(
      parseFloat(classBusy.afterWidth),
      `.pulse-busy mark has zero width on ${where}`,
    ).toBeGreaterThan(0);

    // ---------- 9.2(b): the pressed difference, against the HOVERING state ----------
    await page.mouse.move(centre.x, centre.y);
    await settle(el);
    const hovering = (await el.evaluate((n) => window.__m3p9.snapshot(n))) as Snapshot;
    await page.mouse.down();
    await settle(el);
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
  await settle(row);
  const rowRest = (await row.evaluate((n) => window.__m3p9.snapshot(n))) as Snapshot;
  await row.evaluate((n) => n.setAttribute("data-unconfirmed", ""));
  await settle(row);
  const rowMarked = (await row.evaluate((n) => window.__m3p9.snapshot(n))) as Snapshot;
  await row.evaluate((n) => n.removeAttribute("data-unconfirmed"));
  await assertMagnitude(page, rowRest, rowMarked, "unconfirmed row");
  expect(rowMarked.afterContent, "unconfirmed row carries no mark").not.toBe("none");
  // Criterion 9.3's zero-width falsification binds the unconfirmed mark as
  // well as the busy one, and before this round only the content half was
  // asserted here (fix round 1, finding CR-M3P9-02): a later phase could
  // have zeroed the mark's width without turning the suite red.
  expect(
    parseFloat(rowMarked.afterWidth),
    "unconfirmed mark has zero width",
  ).toBeGreaterThan(0);

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

  // 9.2(a): the collected set, in BOTH directions. The set is PRINTED as
  // well as asserted, so a reader of a run can see the denominator the
  // measurement used rather than taking the count on trust.
  const found = [...collected].sort();
  console.log(
    `swept control set (${found.length}):\n  ${found.join("\n  ")}`,
  );
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

// =====================================================================
// THE TOUCH PRESS (fix round 1, finding HZ-M3P9-01)
//
// THE MECHANISM, named rather than the instance: A PRESSED APPEARANCE
// REACHED ONLY THROUGH :active IS REACHED ONLY THROUGH THE INPUT PATHS THE
// ENGINE GRANTS :active TO. Everything above this line drives
// page.mouse.down, and a mouse press inside a context that merely DECLARES
// touch is still a mouse press. Measured in this container, under the
// chromium-phone project's own device options, on the shipped sign-in
// submit and on a bare div outside the product alike: a held CDP
// Input.dispatchTouchEvent touchStart, Input.synthesizeTapGesture with
// gestureSourceType "touch" and page.touchscreen.tap each fire pointerdown
// and touchstart on the control and produce ZERO frames in :active and zero
// frames with a transform, while a held page.mouse.down in the same context
// produces both. The bare-div control is what says this is the engine's
// gesture pipeline and not the product's stylesheet.
//
// So the vocabulary does not rest on :active alone. src/app/globals.css
// gives the pressed appearance to [data-pressed] as well, which is the
// selector the plan's verification-first step (e) pre-authorises for
// exactly this condition, and pointerdown FIRES on every touch path above.
// The handler below is the six lines that set it; this phase ships no
// client script (criterion 9.7 prints only two stylesheets, the Playwright
// config and this spec), so the handler is installed by this measurement
// and the product's own copy of it is M3-P10's, which already opens a
// client boundary. What this test therefore witnesses is that the SHIPPED
// STYLESHEET produces a pressed appearance from an event that fires under
// touch; what it does not witness is a shipped handler setting it, and
// that gap is stated in the phase work history rather than papered over.
// =====================================================================

// The handler M3-P10 ships, verbatim. Capture phase on the document, so one
// listener covers every control and no component gains a prop.
const POINTER_PRESS_HANDLER = `
(() => {
  const CONTROL =
    'button, a[href], summary, input[type="submit"], input[type="button"], [role="button"]';
  const clear = () => {
    for (const el of document.querySelectorAll("[data-pressed]")) {
      el.removeAttribute("data-pressed");
    }
  };
  document.addEventListener("pointerdown", (event) => {
    const node = event.target;
    const control = node && node.closest ? node.closest(CONTROL) : null;
    if (control) control.setAttribute("data-pressed", "");
  }, true);
  document.addEventListener("pointerup", clear, true);
  document.addEventListener("pointercancel", clear, true);
})();
`;

// EVERY ANIMATION FRAME IS SAMPLED, not one reading after the fact: a
// pressed appearance that exists for no frame and a pressed appearance that
// exists for twenty are the same single after-the-fact reading, and the
// first is the defect this phase is about.
const INSTALL_TRACE = `
window.__m3p9trace = (probe) => {
  const el = document.querySelector(probe);
  const restTop = el.getBoundingClientRect().top;
  const state = {
    frames: 0,
    framesActive: 0,
    framesPressed: 0,
    framesWithTransform: 0,
    peakDisplacementPx: 0,
    events: [],
    pressAt: null,
    firstChangeAt: null,
    sampling: true,
  };
  window.__m3p9traceState = state;
  const inControl = (node) => node === el || (node && el.contains(node));
  for (const type of [
    "pointerdown", "touchstart", "pointerup", "touchend",
    "pointercancel", "mousedown", "click",
  ]) {
    document.addEventListener(type, (event) => {
      if (!inControl(event.target)) return;
      state.events.push(type);
      if (type === "pointerdown" && state.pressAt === null) {
        state.pressAt = performance.now();
      }
    }, true);
  }
  const tick = (now) => {
    if (!state.sampling) return;
    const cs = getComputedStyle(el);
    state.frames += 1;
    if (el.matches(":active")) state.framesActive += 1;
    if (el.matches("[data-pressed]")) state.framesPressed += 1;
    if (cs.transform !== "none" && cs.transform !== "matrix(1, 0, 0, 1, 0, 0)") {
      state.framesWithTransform += 1;
      if (state.firstChangeAt === null) state.firstChangeAt = now;
    }
    const travelled = Math.abs(el.getBoundingClientRect().top - restTop);
    if (travelled > state.peakDisplacementPx) state.peakDisplacementPx = travelled;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
};
`;

type TouchTrace = {
  readonly frames: number;
  readonly framesActive: number;
  readonly framesPressed: number;
  readonly framesWithTransform: number;
  readonly peakDisplacementPx: number;
  readonly events: readonly string[];
  readonly pressAt: number | null;
  readonly firstChangeAt: number | null;
};

const TOUCH_HOLD_MS = 400;

const holdTouch = async (
  page: Page,
  cdp: { send(method: string, params?: unknown): Promise<unknown> },
  probe: string,
): Promise<{ readonly trace: TouchTrace; readonly held: Snapshot }> => {
  const el = page.locator(probe);
  await el.scrollIntoViewIfNeeded();
  const box = await el.boundingBox();
  expect(box, `no box for ${probe}`).not.toBeNull();
  const centre = {
    x: (box?.x ?? 0) + (box?.width ?? 0) / 2,
    y: (box?.y ?? 0) + (box?.height ?? 0) / 2,
  };
  await page.evaluate(INSTALL_TRACE);
  await page.evaluate(
    (p) => (window as unknown as { __m3p9trace: (p: string) => void }).__m3p9trace(p),
    probe,
  );
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x: centre.x, y: centre.y, id: 1 }],
  });
  await page.waitForTimeout(TOUCH_HOLD_MS);
  const held = (await el.evaluate((n) => window.__m3p9.snapshot(n))) as Snapshot;
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  const trace = (await page.evaluate(() => {
    const s = (window as unknown as { __m3p9traceState: TouchTrace & { sampling: boolean } })
      .__m3p9traceState;
    s.sampling = false;
    return s;
  })) as TouchTrace;
  return { trace, held };
};

const describeTrace = (label: string, trace: TouchTrace): string =>
  `${label}: frames ${trace.frames}, in :active ${trace.framesActive},` +
  ` carrying [data-pressed] ${trace.framesPressed},` +
  ` with a transform ${trace.framesWithTransform},` +
  ` peak box displacement ${trace.peakDisplacementPx.toFixed(3)}px,` +
  ` events ${JSON.stringify(trace.events)}`;

test.describe("the pressed appearance under a touch press", () => {
  test.skip(({ hasTouch }) => hasTouch !== true, "touch paths need the phone project");

  test("a held touch press moves the control and changes its surface", async ({ page }) => {
    test.setTimeout(120_000);
    const cdp = await page.context().newCDPSession(page);
    await page.goto("/sign-in");
    await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
    await page.evaluate(INSTALL_HELPERS);
    // A held touch that ends where it started is a tap, and a tap on this
    // screen submits a form or follows a link. The activation is refused
    // here and nowhere else; the pressed appearance is what is measured.
    await page.evaluate(() => {
      document.addEventListener(
        "click",
        (event) => {
          event.preventDefault();
          event.stopPropagation();
        },
        true,
      );
    });

    // An opaque control on the inverse surface, and a bare anchor with no
    // background of its own: the two shapes the pressed rules treat
    // differently, so one passing tells nothing about the other.
    const probes = ["button.auth-submit", "p.auth-alt a"] as const;

    for (const probe of probes) {
      // ---- THE RED WITNESS, recorded as an assertion rather than a note.
      // No handler installed, so :active is the only route to the pressed
      // appearance, which is what the phase shipped before this round.
      const before = await holdTouch(page, cdp, probe);
      console.log(describeTrace(`touch press, :active only, ${probe}`, before.trace));
      expect(
        before.trace.events,
        `no pointerdown reached ${probe} under a held touch press`,
      ).toContain("pointerdown");
      expect(
        before.trace.events,
        `no touchstart reached ${probe} under a held touch press`,
      ).toContain("touchstart");
      expect(
        before.trace.framesActive,
        `THIS ASSERTION IS A RECORDED MEASUREMENT, NOT A REQUIREMENT.` +
          ` It locks in what this engine does today: a held touch press puts` +
          ` ${probe} into :active for no frame at all, which is why the pressed` +
          ` appearance is not built on :active alone. If it reddens because` +
          ` :active now applies to a touch press, that is good news: re-measure,` +
          ` update this number and say so in the work history.`,
      ).toBe(0);
      expect(
        before.trace.framesWithTransform,
        `${probe} moved under a held touch press with no handler installed,` +
          ` which contradicts the :active measurement above`,
      ).toBe(0);
    }

    // ---- THE GREEN WITNESS. pointerdown fired on every touch path above,
    // so the pressed appearance is driven from it.
    await page.evaluate(POINTER_PRESS_HANDLER);

    for (const probe of probes) {
      const el = page.locator(probe);
      await el.scrollIntoViewIfNeeded();
      await settle(el);
      const rest = (await el.evaluate((n) => window.__m3p9.snapshot(n))) as Snapshot;
      const after = await holdTouch(page, cdp, probe);
      console.log(describeTrace(`touch press, [data-pressed], ${probe}`, after.trace));

      expect(
        after.trace.framesPressed,
        `${probe} never carried [data-pressed] under a held touch press`,
      ).toBeGreaterThan(0);
      expect(
        after.trace.framesWithTransform,
        `${probe} never carried a transform under a held touch press`,
      ).toBeGreaterThan(0);

      const offset = parseFloat(after.held.pressOffset);
      expect(
        after.trace.peakDisplacementPx,
        `${probe} did not move on screen under a held touch press` +
          ` (peak ${after.trace.peakDisplacementPx.toFixed(3)}px,` +
          ` --press-offset ${offset}px)`,
      ).toBeGreaterThanOrEqual(Math.min(offset, MIN_PRESS_TRAVEL_PX) - 0.01);

      const bgRatio = await compositedRatio(page, rest, after.held, "backgroundColor");
      const inkRatio = await compositedRatio(page, rest, after.held, "color");
      expect(
        Math.max(bgRatio, inkRatio),
        `the touch-pressed surface is too close to the resting surface for ${probe}` +
          ` (background ${bgRatio.toFixed(3)}, colour ${inkRatio.toFixed(3)})`,
      ).toBeGreaterThanOrEqual(MIN_CONTRAST_RATIO);
      if ((await alphaOf(page, rest.backgroundColor)) === 0) {
        expect(
          await alphaOf(page, after.held.backgroundColor),
          `touch-pressed tint below the alpha floor on a transparent control: ${probe}`,
        ).toBeGreaterThanOrEqual(0.08);
      }

      // PRESS TO FIRST VISIBLE CHANGE, under touch. This is the first half
      // of the owner's report only; the dead interval between the release
      // and the server's answer is M3-P10's and is not measured here.
      const { pressAt, firstChangeAt } = after.trace;
      expect(pressAt, `no pointerdown timestamp for ${probe}`).not.toBeNull();
      expect(firstChangeAt, `no visible change ever for ${probe}`).not.toBeNull();
      const latency = (firstChangeAt ?? 0) - (pressAt ?? 0);
      console.log(
        `press to first visible change under touch on ${probe}: ${latency.toFixed(1)}ms`,
      );
      expect(
        latency,
        `${probe} took ${latency.toFixed(1)}ms from pointerdown to the first frame` +
          ` carrying a transform, which is more than three animation frames`,
      ).toBeLessThan(50);
    }
  });
});

test.describe("an aria-disabled control refuses activation", () => {
  // FIX ROUND 1, FINDING HZ-M3P9-02. Eight of the nineteen controls have no
  // disabled attribute to set, so aria-disabled is the only marking they
  // can carry, and before this round the aria branch gave them the whole
  // disabled appearance including cursor: default and took nothing away: a
  // disabled-looking link still navigated and a disabled-looking submit
  // still posted. BOTH DIRECTIONS ARE ASSERTED HERE, because "the link did
  // not navigate" is also what a click that missed looks like.
  test("a marked link does not navigate and a marked submit does not post", async ({ page }) => {
    test.setTimeout(120_000);
    let posts = 0;
    page.on("request", (request) => {
      if (request.method() === "POST") posts += 1;
    });

    // WARM THE DESTINATION ROUTE FIRST. The dev server compiles a route on
    // its first request, which took longer than the wait below and made the
    // negative assertion pass while a navigation was still in flight: the
    // link HAD navigated and the URL had simply not changed yet. A vacuous
    // green on the exact assertion this test exists for is the failure this
    // warm-up removes, and the positive control below is what caught it.
    await page.goto("/sign-up");
    await expect(page.getByRole("button", { name: "Create household" })).toBeVisible();

    await page.goto("/sign-in");
    const link = page.locator("p.auth-alt a");
    await expect(link).toBeVisible();
    const linkBox = await link.boundingBox();
    expect(linkBox, "no box for the sign-up cross-link").not.toBeNull();
    const linkCentre = {
      x: (linkBox?.x ?? 0) + (linkBox?.width ?? 0) / 2,
      y: (linkBox?.y ?? 0) + (linkBox?.height ?? 0) / 2,
    };

    await link.evaluate((n) => n.setAttribute("aria-disabled", "true"));
    await page.mouse.click(linkCentre.x, linkCentre.y);
    await page.waitForTimeout(2_500);
    expect(
      new URL(page.url()).pathname,
      "a link wearing the full disabled appearance still navigated",
    ).toBe("/sign-in");

    // The positive control: the same click, at the same coordinates, with
    // the marking removed. Without this the assertion above is satisfied by
    // a click that never reached the link.
    await link.evaluate((n) => n.removeAttribute("aria-disabled"));
    await page.mouse.click(linkCentre.x, linkCentre.y);
    await expect(page).toHaveURL(/\/sign-up$/);

    await page.goto("/sign-in");
    await page.getByLabel("Email").fill("aria-disabled@pulse-e2e.test");
    await page.getByLabel("Password").fill("aria-disabled-probe");
    const submit = page.locator("button.auth-submit");
    const submitBox = await submit.boundingBox();
    expect(submitBox, "no box for the sign-in submit").not.toBeNull();
    const submitCentre = {
      x: (submitBox?.x ?? 0) + (submitBox?.width ?? 0) / 2,
      y: (submitBox?.y ?? 0) + (submitBox?.height ?? 0) / 2,
    };

    await submit.evaluate((n) => n.setAttribute("aria-disabled", "true"));
    posts = 0;
    await page.mouse.click(submitCentre.x, submitCentre.y);
    await page.waitForTimeout(1_000);
    expect(posts, "a submit wearing the full disabled appearance still posted").toBe(0);

    await submit.evaluate((n) => n.removeAttribute("aria-disabled"));
    posts = 0;
    await page.mouse.click(submitCentre.x, submitCentre.y);
    await page.waitForTimeout(2_000);
    expect(
      posts,
      "the unmarked submit posted nothing either, so the refusal above proves nothing",
    ).toBeGreaterThan(0);
  });
});

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
