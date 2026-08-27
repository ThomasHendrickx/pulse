import { expect, test, type Locator, type Page, type CDPSession } from "@playwright/test";
import { readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { FIXTURE_ACCOUNT_A, registerCurrentAccount } from "./setup-accounts";

// M3-P9. THE PRESSED APPEARANCE IS MEASURED BY PRESSING, the disabled, busy
// and unconfirmed appearances are measured by entering them, and the press a
// FINGER makes is measured in the SHIPPED document with nothing installed by
// this file.
//
// Why this file exists at all: at 89ed187 the product declared no :active
// rule, no :disabled rule and no transition anywhere, so a control looked
// identical the instant before, during and after a press. The only
// pressability cue in the tree was cursor: pointer on five rules, which the
// phone the owner reported from cannot draw. A grep for ":active" would have
// proved nothing about what the screen does, which is why every assertion
// below reads getComputedStyle out of a real browser with the pointer down.
//
// AND WHY THE TOUCH HALVES EXIST, which is the whole of criterion 9.9. The
// first implementation round measured, under this config's own phone project
// and across four touch input paths, ZERO frames in :active on a shipped
// control and zero on a bare element outside the product, against 22 of 28
// frames for a held mouse press in the same context. A pressed appearance
// reached only through :active is reached by no finger, so the stylesheet
// answers [data-pressed] as well and src/app/layout.tsx ships the one
// document-level listener that raises it. Hazard H9.11 is this phase merging
// as a stylesheet nothing ever triggers, and criterion 9.9 is what fails when
// the listener is missing: every other criterion here is satisfiable without
// it, because 9.2 presses with a mouse and 9.3 and 9.4 apply their states
// through the DOM.
//
// THE DISABLED AND BUSY STATES ARE APPLIED THROUGH THE DOM (decision D-28).
// Nothing in the product enters them until M3-P10. What that technique
// proves is that the shipped stylesheet renders a visibly different control
// when the state is present; what it does not prove is that anything ever
// sets the state, which is M3-P10's job and is measured there. The disabled
// half is the exception and criterion 9.3(a) makes it one: the refusal is
// measured with a real hit-tested click, not inferred from a property.

const CSV_FIXTURE = join(__dirname, "..", "fixtures", "belfius-account-a.csv");
const REJECTED_FIXTURE = join(__dirname, "..", "fixtures", "unknown-layout.pdf");

// The sweep selector. The set is COLLECTED by running this on every screen
// the journey reaches, never by looking up a list of known controls: a spec
// that looks up its own denominator decides its own score, which is the
// error hazard H9.8 records.
const CONTROL_SELECTOR =
  'button, a[href], summary, input[type="submit"], input[type="button"], [role="button"]';

// THE ENUMERATION, twenty-one controls, the shell's NavLink accounting for
// four of them.
//
// AMENDED IN M3-P14 rather than the sweep narrowed, which is what criterion
// 9.2(a) requires when the two disagree. That phase adds a fourth
// navigation link and a second call to action on the empty state, both of
// which the sweep reaches on screens it already visits. It also adds the
// accounts screen's own controls, which are NOT here and are NOT swept: the
// journey below walks that screen to register an account, but takes no
// measurement on it, so it contributes nothing to this set. That is a real
// gap in the pressed-feedback coverage of a new screen and it is recorded
// as one rather than papered over; closing it belongs to whichever phase
// next owns this file, because criterion 14.9 pins M3-P14 to the gates it
// names and this spec's control set is M3-P9's contract. Criterion 9.2(a) fails in
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
  // The nine navigating controls.
  "a[data-testid=nav-overview]",
  "a[data-testid=nav-import]",
  "a[data-testid=nav-merchants]",
  "a[data-testid=nav-accounts]",
  "a[data-testid=empty-state-import-link]",
  "a[data-testid=empty-state-accounts-link]",
  "a[data-testid=unresolved-pill]",
  // AMENDED IN M3-P10, which is what criterion 9.2(a) asks for when the
  // sweep and the enumeration disagree: the enumeration is amended, never
  // the sweep narrowed. These two Links carried no data-testid and were
  // identified here by their glyph child. M3-P10's criterion 10.5(a)
  // forbids a spec binding to that glyph, which is a punctuation mark
  // rather than text, and explicitly permits that phase to give the two
  // controls testids; it did, so their identity in this sweep changed.
  // Nothing was added or removed: the set is still twenty-one.
  "a[data-testid=month-step-previous]",
  "a[data-testid=month-step-next]",
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

// Criterion 9.9(b): the hold is the one the first round actually measured,
// and the frame floor is what separates a measurement from a thin sample. A
// run under the floor is a MACHINE result and is retaken with the load
// captured beside it; it is never repaired by lowering the floor.
const TOUCH_HOLD_MS = 400;
const MIN_SAMPLED_FRAMES = 8;

// Criterion 9.9(a): the number of tests this file contributes under the
// phone project, so the work history can put the run's PASSED count beside a
// number the spec itself declares rather than beside a number read off the
// run. Kept next to the tests it counts.
const CHROMIUM_PHONE_TEST_COUNT = 6;

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
  readonly pointerEvents: string;
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
  // vacuous assertion. These two are read from getComputedStyle(node,
  // "::after"), where the loop actually lives.
  readonly afterAnimationName: string;
  readonly afterAnimationDuration: string;
};

type Swept = { readonly index: number; readonly identity: string; readonly tag: string };

// THE FRAME AND EVENT RECORD criterion 9.9 reads. Per sampled frame, per
// tracked element: whether it carries the shipped marking, its computed
// transform and the vertical translation out of that matrix, its rect top,
// and the document-wide count of marked elements, which is what half (e)
// asserts is zero after every ending.
type Frame = {
  readonly t: number;
  readonly pressed: readonly boolean[];
  readonly transform: readonly string[];
  readonly matrixY: readonly number[];
  readonly rectTop: readonly number[];
  readonly active: readonly boolean[];
  readonly scrollY: number;
  readonly markedCount: number;
};

type CapturedEvent = {
  readonly type: string;
  readonly t: number;
  readonly onTracked: readonly boolean[];
  readonly targetTag: string;
};

type PressRecord = {
  readonly frames: readonly Frame[];
  readonly events: readonly CapturedEvent[];
  readonly markers: Readonly<Record<string, number>>;
  readonly restRectTop: readonly number[];
  readonly restScrollY: number;
};

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
    readonly __m3p9press: {
      begin(selectors: readonly string[]): void;
      mark(name: string): void;
      end(): PressRecord;
      refuseClicks(): void;
      allowClicks(): void;
      refusedTargets(): readonly string[];
      clickedTargetRelation(selector: string): readonly string[];
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
      pointerEvents: cs.pointerEvents,
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
    };
  };
  return { parse, composite, ratio, identify, snapshot };
})();
`;

// THE RECORDER. EVERYTHING IN IT IS READ-ONLY ABOUT THE MECHANISM UNDER
// TEST, and that is the point of criterion 9.9(a): nothing this file injects
// may produce the pressed appearance. It reads whether an element matches
// the shipped marking, it reads computed styles and rects, and it records
// event NAMES. It writes no attribute; the only writes in this file are the
// disabled, busy and unconfirmed states criterion 9.3 applies through the
// DOM, and those are a different measurement on a different criterion.
//
// THE ONE BEHAVIOUR IT CHANGES is the capture-phase CLICK refusal, which
// criterion 9.9(a) permits by name and which criteria 9.3(a) and 9.9(e) both
// need: without it a press released on a control submits a form, follows a
// link or ends the session, and the refused activation criterion 9.3(a)
// measures has no observable. It is off until refuseClicks() turns it on.
//
// THE PASSIVE EVENT RECORDER IS A DECLARED DEVIATION and is written here
// rather than hidden. Criterion 9.9(a) says the spec adds no page.evaluate
// listener for pointerdown, touchstart or mousedown; criteria 9.9(c) and
// 9.9(e) require the spec to prove those very events were DELIVERED before
// concluding anything from a zero or from an absence. The two cannot both be
// obeyed, so the recorder exists, it is registered on document in the
// capture phase, and every handler it installs does exactly one thing: push
// a string into an array. The property the prohibition protects, that
// nothing the test installs can produce the pressed appearance, is the one
// the grep in criterion 9.9(a) checks, and it holds.
const INSTALL_RECORDER = `
window.__m3p9press = (() => {
  const TRACKED_TYPES = [
    "pointerdown", "touchstart", "pointerup", "touchend",
    "pointercancel", "mousedown", "click",
  ];
  let state = null;
  let refusing = false;
  const refusedTargets = [];
  const clicked = [];
  const matrixTranslationY = (transform) => {
    if (!transform || transform === "none") return 0;
    const two = transform.match(/^matrix\\(([^)]+)\\)$/);
    if (two) return parseFloat(two[1].split(",")[5]) || 0;
    const three = transform.match(/^matrix3d\\(([^)]+)\\)$/);
    if (three) return parseFloat(three[1].split(",")[13]) || 0;
    return 0;
  };
  const describe = (node) => {
    if (!node || !node.tagName) return String(node);
    const cls = (node.getAttribute && node.getAttribute("class")) || "";
    return node.tagName.toLowerCase() + (cls ? "." + cls.trim().split(/\\s+/).join(".") : "");
  };
  document.addEventListener(
    "click",
    (event) => {
      if (!refusing) return;
      refusedTargets.push(describe(event.target));
      clicked.push(event.target);
      event.preventDefault();
      event.stopPropagation();
    },
    true,
  );
  // AND THE NATIVE DRAG, for the same reason and measured the same way. A
  // mouse press begun on an ANCHOR and moved away starts a drag-and-drop,
  // which the engine ends with a pointercancel and no pointerup at all, so
  // ending four could not be driven on a link-shaped control. This prevents
  // the drag and nothing else; it mutates no attribute and it is not a
  // listener for pointerdown, touchstart or mousedown.
  document.addEventListener(
    "dragstart",
    (event) => {
      if (refusing) event.preventDefault();
    },
    true,
  );
  for (const type of TRACKED_TYPES) {
    document.addEventListener(
      type,
      (event) => {
        if (!state) return;
        state.events.push({
          type: type,
          t: performance.now(),
          onTracked: state.elements.map(
            (el) => !!el && (el === event.target || el.contains(event.target)),
          ),
          targetTag: describe(event.target),
        });
      },
      true,
    );
  }
  const tick = (now) => {
    if (!state || !state.sampling) return;
    const els = state.elements;
    const transform = els.map((el) => (el ? getComputedStyle(el).transform : "none"));
    state.frames.push({
      t: now,
      pressed: els.map((el) => !!el && el.matches("[data-pressed]")),
      active: els.map((el) => !!el && el.matches(":active")),
      transform: transform,
      matrixY: transform.map(matrixTranslationY),
      rectTop: els.map((el) => (el ? el.getBoundingClientRect().top : 0)),
      scrollY: window.scrollY,
      markedCount: document.querySelectorAll("[data-pressed]").length,
    });
    requestAnimationFrame(tick);
  };
  return {
    begin(selectors) {
      const elements = selectors.map((s) => document.querySelector(s));
      state = {
        elements: elements,
        frames: [],
        events: [],
        markers: {},
        sampling: true,
        restRectTop: elements.map((el) => (el ? el.getBoundingClientRect().top : 0)),
        restScrollY: window.scrollY,
      };
      requestAnimationFrame(tick);
    },
    mark(name) {
      if (state) state.markers[name] = performance.now();
    },
    end() {
      if (!state) return null;
      state.sampling = false;
      return {
        frames: state.frames,
        events: state.events,
        markers: state.markers,
        restRectTop: state.restRectTop,
        restScrollY: state.restScrollY,
      };
    },
    refuseClicks() {
      refusing = true;
      refusedTargets.length = 0;
      clicked.length = 0;
    },
    allowClicks() {
      refusing = false;
    },
    refusedTargets() {
      return refusedTargets.slice();
    },
    clickedTargetRelation(selector) {
      const control = document.querySelector(selector);
      return clicked.map((t) => {
        if (!control || !t) return "none";
        if (control === t) return "control";
        if (control.contains(t)) return "descendant";
        if (t.contains && t.contains(control)) return "ancestor";
        return "other";
      });
    },
  };
})();
`;

// Criterion 9.9(a): the spec PRINTS what it injected, so a reader checks the
// claim instead of trusting a grep. Every page.evaluate of a script constant
// in this file appends its name here.
const INJECTED: string[] = [];

const install = async (page: Page): Promise<void> => {
  await page.evaluate(INSTALL_HELPERS);
  await page.evaluate(INSTALL_RECORDER);
  if (!INJECTED.includes("INSTALL_HELPERS")) INJECTED.push("INSTALL_HELPERS");
  if (!INJECTED.includes("INSTALL_RECORDER")) INJECTED.push("INSTALL_RECORDER");
};

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
  await install(page);
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

const centreOf = async (el: Locator): Promise<{ x: number; y: number }> => {
  const box = await el.boundingBox();
  expect(box, "no bounding box for a control under measurement").not.toBeNull();
  return { x: (box?.x ?? 0) + (box?.width ?? 0) / 2, y: (box?.y ?? 0) + (box?.height ?? 0) / 2 };
};

const touchPoint = (at: { x: number; y: number }, id: number) => ({ x: at.x, y: at.y, id });


// ---------------------------------------------------------------------
// CRITERION 9.9(b): A HELD TOUCH PRESS, SAMPLED EVERY FRAME, ON THE SHIPPED
// DOCUMENT. Nothing here installs the mechanism; the marking comes from the
// listener src/app/layout.tsx serves.
// ---------------------------------------------------------------------
type PressMeasurement = {
  readonly framesInWindow: number;
  readonly framesPressed: number;
  readonly framesMoved: number;
  readonly firstMovedIndex: number;
  readonly firstMovedMs: number;
  readonly peakMatrixY: number;
  readonly peakRectDelta: number;
  readonly simultaneous: number;
  readonly events: readonly string[];
};

const holdTouchPress = async (
  page: Page,
  cdp: CDPSession,
  selector: string,
  holdMs: number,
): Promise<PressMeasurement> => {
  const el = page.locator(selector);
  await el.scrollIntoViewIfNeeded();
  await settle(el);
  const at = await centreOf(el);
  await page.evaluate((s) => window.__m3p9press.begin([s]), selector);
  await page.evaluate(() => window.__m3p9press.mark("beforePointerdown"));
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [touchPoint(at, 1)],
  });
  await page.waitForTimeout(holdMs);
  // THE WINDOW ENDS WHERE THE RELEASE BEGINS. The release moves the touch
  // point off the control before lifting it, per criterion 9.9(b), and the
  // frames during that move belong to the ending rather than to the hold.
  await page.evaluate(() => window.__m3p9press.mark("releaseStarted"));
  // THE RELEASE MOVES THE TOUCH POINT AND DISPATCHES NO touchMove, which is
  // measured rather than stylistic: a touchMove on a screen that scrolls is
  // taken by the engine as a scroll, which produces a pointercancel and
  // scrolls the page under the next measurement. A touchEnd carrying moved
  // coordinates ends the touch away from the control with no gesture and
  // yields the pointerup this release is.
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [touchPoint(PARKING_SPOT, 1)],
  });
  await page.waitForTimeout(60);
  const record = (await page.evaluate(() => window.__m3p9press.end())) as PressRecord;

  const pointerdown = record.events.find((e) => e.type === "pointerdown" && e.onTracked[0]);
  const startedAt = pointerdown?.t ?? record.markers.beforePointerdown ?? 0;
  const endedAt = record.markers.releaseStarted ?? Number.POSITIVE_INFINITY;
  const window_ = record.frames.filter((f) => f.t >= startedAt && f.t < endedAt);
  const pressOffsetPx = parseFloat(
    (await el.evaluate((n) => getComputedStyle(n).getPropertyValue("--press-offset"))).trim(),
  );
  const bar = Math.max(pressOffsetPx, MIN_PRESS_TRAVEL_PX) - 0.01;
  const movedIndex = window_.findIndex((f) => f.transform[0] !== "none");
  return {
    framesInWindow: window_.length,
    framesPressed: window_.filter((f) => f.pressed[0]).length,
    framesMoved: window_.filter((f) => f.transform[0] !== "none").length,
    firstMovedIndex: movedIndex,
    firstMovedMs: movedIndex < 0 ? -1 : (window_[movedIndex]?.t ?? 0) - startedAt,
    peakMatrixY: Math.max(0, ...window_.map((f) => Math.abs(f.matrixY[0] ?? 0))),
    peakRectDelta: Math.max(
      0,
      ...window_.map((f) =>
        Math.abs(
          (f.rectTop[0] ?? 0) + f.scrollY - ((record.restRectTop[0] ?? 0) + record.restScrollY),
        ),
      ),
    ),
    simultaneous: window_.filter((f) => f.pressed[0] && Math.abs(f.matrixY[0] ?? 0) >= bar).length,
    events: record.events.filter((e) => e.onTracked[0]).map((e) => e.type),
  };
};

const assertPress = async (
  page: Page,
  selector: string,
  measured: PressMeasurement,
  where: string,
  full: boolean,
): Promise<void> => {
  const pressOffsetPx = parseFloat(
    (
      await page
        .locator(selector)
        .evaluate((n) => getComputedStyle(n).getPropertyValue("--press-offset"))
    ).trim(),
  );
  const bar = Math.max(pressOffsetPx, MIN_PRESS_TRAVEL_PX);

  // The frame floor. A run under it is a MACHINE result and is retaken with
  // the load captured beside it, never repaired by lowering the floor.
  expect(
    measured.framesInWindow,
    `THIN SAMPLE, NOT A RESULT: only ${measured.framesInWindow} animation frames fell between` +
      ` the pointerdown and the release on ${where}. This is a machine result. Retake it with` +
      ` the load captured beside it and never lower the floor.`,
  ).toBeGreaterThanOrEqual(MIN_SAMPLED_FRAMES);

  // (i) on the WHOLE set, never scoped: the marking is carried on every
  // sampled frame in the window except at most the first.
  expect(
    measured.framesInWindow - measured.framesPressed,
    `${where} lost the shipped marking during a held touch press:` +
      ` ${measured.framesPressed} of ${measured.framesInWindow} frames carried it,` +
      ` events ${JSON.stringify(measured.events)}`,
  ).toBeLessThanOrEqual(1);

  if (!full) return;

  // (ii) the movement is real.
  expect(
    measured.framesMoved,
    `${where} never carried a transform under a held touch press`,
  ).toBeGreaterThan(0);

  // (iii) the peak vertical displacement, out of the control's own matrix,
  // with the rect delta as a second witness so a transform the compositor
  // never draws is still caught.
  expect(
    measured.peakMatrixY,
    `${where} moved ${measured.peakMatrixY.toFixed(3)}px under a held touch press,` +
      ` below --press-offset ${pressOffsetPx}px and the 1.0 device-independent pixel floor`,
  ).toBeGreaterThanOrEqual(bar - 0.01);
  expect(
    Math.abs(measured.peakMatrixY - measured.peakRectDelta),
    `${where}: the computed matrix says ${measured.peakMatrixY.toFixed(3)}px and the scroll-corrected` +
      ` bounding rect says ${measured.peakRectDelta.toFixed(3)}px, so the transform is not one the box took`,
  ).toBeLessThanOrEqual(0.5);

  // (iv) the movement arrives at the first or second sampled frame at or
  // after the pointerdown. The assertion is on the FRAME INDEX and not on
  // the millisecond count: a delayed animation frame under load would redden
  // a wall-clock budget for the machine rather than for the code.
  expect(
    measured.firstMovedIndex,
    `${where} first moved at sampled frame ${measured.firstMovedIndex}` +
      ` (${measured.firstMovedMs.toFixed(1)}ms after pointerdown), later than the second frame`,
  ).toBeGreaterThanOrEqual(0);
  expect(
    measured.firstMovedIndex,
    `${where} first moved at sampled frame ${measured.firstMovedIndex}` +
      ` (${measured.firstMovedMs.toFixed(1)}ms after pointerdown), later than the second frame`,
  ).toBeLessThanOrEqual(1);

  // (v) the tallies are the same event: one frame carrying BOTH the marking
  // and a translation meeting (iii). Counts taken separately can be met by
  // two unrelated mechanisms.
  expect(
    measured.simultaneous,
    `${where}: no single frame carried the shipped marking AND a translation of at least` +
      ` ${bar}px at the same time, so the two tallies are not the same event`,
  ).toBeGreaterThan(0);
};

// ---------------------------------------------------------------------
// CRITERION 9.9(e): THE PRESS ENDS WHEN THE FINGER DOES, AND A SCROLL IS AN
// ENDING. Five endings, each FIRST shown to have happened, because every
// assertion here concludes from an ABSENCE and an ending that never happened
// produces the same absence.
// ---------------------------------------------------------------------
type EndingResult = {
  readonly endingEvents: readonly string[];
  readonly markedAtSecondFrame: number;
  readonly framesAfter: number;
  readonly restoredMatrixY: number;
  readonly restoredRectDelta: number;
  readonly bothMarkedSimultaneously: number;
  readonly upTargetWasControl: boolean;
  readonly activeTailFrames: number;
};

// CLEARING THE BROWSER'S OWN ACTIVE CHAIN BETWEEN THE TWO HALVES OF AN
// ENDING, and why it has to happen. Ending one releases ON the control,
// which criterion 9.9(e) requires, and the activation is stopped by the
// capture-phase click refusal criterion 9.9(a) permits. MEASURED IN THIS
// ROUND: a refused compatibility click leaves Chromium's active chain set on
// the control until the next input, so the :active half of the pressed rule
// keeps the control drawn pressed after the shipped marking has gone, for
// every one of the twenty frames sampled after the ending. That is this
// spec's own instrument, not the product: a held touch press reaches :active
// on ZERO frames on every path this file drives, so no finger can enter that
// state. The marking assertion is taken BEFORE this neutral press, so a
// stuck marking is still caught; the restoration is read after it.
const NEUTRAL_SPOT = { x: 2, y: 2 };

const clearActiveChain = async (page: Page): Promise<void> => {
  const onAControl = await page.evaluate((selector) => {
    const el = document.elementFromPoint(2, 2);
    return !!el && !!el.closest(selector);
  }, CONTROL_SELECTOR);
  expect(
    onAControl,
    "the neutral spot this spec presses to clear the browser's active chain is on a control," +
      " so the clear would itself be a press",
  ).toBe(false);
  await page.mouse.move(NEUTRAL_SPOT.x, NEUTRAL_SPOT.y);
  await page.mouse.down();
  await page.mouse.up();
};

const analyseEnding = (record: PressRecord, endingType: string): EndingResult => {
  const neutralAt = record.markers.beforeNeutral ?? Number.POSITIVE_INFINITY;
  // The neutral press that clears the browser's active chain fires pointer
  // events of its own, so the ending is looked for among the events that
  // happened BEFORE it. Without this the ending would be found in the clear.
  const ownEvents = record.events.filter((e) => e.t < neutralAt);
  const ending = [...ownEvents].reverse().find((e) => e.type === endingType);
  const endedAt = ending?.t ?? Number.POSITIVE_INFINITY;
  const after = record.frames.filter((f) => f.t > endedAt && f.t < neutralAt);
  const second = after[1] ?? after[after.length - 1];
  // THE RESTORATION IS READ ON A FRAME THE CONTROL IS NOT IN :active, and
  // that is measured rather than assumed. Ending one releases ON the control,
  // which criterion 9.9(e) requires and whose activation the capture-phase
  // click refusal criterion 9.9(a) permits stops; and a refused compatibility
  // click leaves Chromium's active chain set on the control, so the :active
  // half of the pressed rule keeps drawing the control pressed after the
  // marking has gone. That is this spec's own instrument and not the shipped
  // mechanism: measured in this round, a held touch press reaches :active on
  // ZERO frames on every path, so no finger can enter that state at all. The
  // marking assertion below is taken on the second frame regardless, because
  // the marking is what this phase ships and a stuck marking is the defect.
  const afterNeutral = record.frames.filter((f) => f.t >= neutralAt);
  const pool = afterNeutral.length > 0 ? afterNeutral : after;
  const last = [...pool].reverse().find((f) => !f.active[0]) ?? pool[pool.length - 1];
  return {
    endingEvents: ownEvents.map((e) => `${e.type}${e.onTracked[0] ? "@control" : "@other"}`),
    markedAtSecondFrame: second?.markedCount ?? -1,
    framesAfter: after.length,
    restoredMatrixY: Math.abs(last?.matrixY[0] ?? 0),
    restoredRectDelta: Math.abs(
      (last?.rectTop[0] ?? 0) + (last?.scrollY ?? 0) -
        ((record.restRectTop[0] ?? 0) + record.restScrollY),
    ),
    bothMarkedSimultaneously: record.frames
      .filter((f) => f.t < neutralAt)
      .filter((f) => f.pressed[0] && f.pressed[1]).length,
    upTargetWasControl: ending?.onTracked[0] ?? false,
    activeTailFrames: after.filter((f) => f.active[0]).length,
  };
};

const assertCleared = (
  result: EndingResult,
  label: string,
  endingType: string,
  deliveredTo: "@control" | "@other",
): void => {
  // The ending is shown to have HAPPENED first, AND to have been delivered
  // where this ending says it is delivered. An absence is exactly what an
  // ending that never happened also produces, and a prefix match on the event
  // NAME accepts an ending delivered to any element in the document, which is
  // the shape-not-identity hole finding CR2-M3P9-10 names: the label carries
  // the delivery target as a suffix and the old check threw it away. Ending
  // four is the one where "@other" is the correct answer, and it is the whole
  // reason that ending exists.
  expect(
    result.endingEvents.some((e) => e === `${endingType}${deliveredTo}`),
    `${label}: no ${endingType} was captured on ${deliveredTo}, so nothing can be concluded` +
      ` from the absence of a marking. Events: ${JSON.stringify(result.endingEvents)}`,
  ).toBe(true);
  expect(
    result.framesAfter,
    `${label}: no animation frame was sampled after the ending`,
  ).toBeGreaterThanOrEqual(2);
  expect(
    result.markedAtSecondFrame,
    `${label}: ${result.markedAtSecondFrame} elements still carried the pressed marking at the` +
      ` second animation frame after the ending. Events: ${JSON.stringify(result.endingEvents)}`,
  ).toBe(0);
  // THE TRANSFORM RETURNS OVER THE TRANSITION AND NOT INSIDE TWO FRAMES, and
  // that is declared rather than worked around: --duration-press is 90ms, so
  // a transitioned transform is still unwinding at the second frame by
  // construction. The attribute assertion above is the one that catches a
  // stuck press; this one catches a press that never returns at all, and it
  // is read on the last sampled frame the control is not in :active for the
  // reason analyseEnding gives.
  expect(
    result.restoredMatrixY,
    `${label}: the control's transform is still ${result.restoredMatrixY.toFixed(3)}px from rest` +
      ` at the last sampled frame it was not in :active` +
      ` (${result.activeTailFrames} of the frames after the ending were :active)`,
  ).toBeLessThanOrEqual(0.05);
  expect(
    result.restoredRectDelta,
    `${label}: the control's scroll-corrected box is still` +
      ` ${result.restoredRectDelta.toFixed(3)}px from rest at the last sampled frame it was` +
      ` not in :active`,
  ).toBeLessThanOrEqual(0.6);
};

const runEndings = async (
  page: Page,
  cdp: CDPSession,
  shape: string,
  primary: string,
  second: string,
): Promise<void> => {
  const el = page.locator(primary);
  await el.scrollIntoViewIfNeeded();
  await settle(el);
  const at = await centreOf(el);
  const other = page.locator(second);
  await other.scrollIntoViewIfNeeded();
  const tail = async () => {
    // Long enough for the second animation frame after the ending, which is
    // where the marking assertion is taken.
    await page.waitForTimeout(140);
    await page.evaluate(() => window.__m3p9press.mark("beforeNeutral"));
    await clearActiveChain(page);
    await page.waitForTimeout(260);
    return (await page.evaluate(() => window.__m3p9press.end())) as PressRecord;
  };
  const begin = async () => {
    await page.evaluate((s) => window.__m3p9press.begin(s), [primary, second]);
  };
  // Ending one releases ON the control, which is an activation. The
  // capture-phase click refusal criterion 9.9(a) permits is what keeps it
  // from submitting a form, following a link or ending the session.
  await page.evaluate(() => window.__m3p9press.refuseClicks());

  // ONE: a touch release ON the control, its activation refused by the
  // capture-phase click handler criterion 9.9(a) permits.
  await begin();
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [touchPoint(at, 1)] });
  await page.waitForTimeout(150);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  const one = analyseEnding(await tail(), "pointerup");
  console.log(`ending 1 (touch release on the control), ${shape}: ${JSON.stringify(one)}`);
  assertCleared(one, `ending 1, touch release on ${shape}`, "pointerup", "@control");
  expect(
    one.upTargetWasControl,
    `ending 1, ${shape}: the pointerup was not delivered to the control itself`,
  ).toBe(true);

  // TWO: a touch release AWAY from the control.
  await begin();
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [touchPoint(at, 1)] });
  await page.waitForTimeout(150);
  // Moved coordinates on the touchEnd itself, for the reason holdTouchPress
  // gives: a touchMove on a screen that scrolls is a scroll, and a scroll is
  // ending THREE. Releasing away from the control must stay a release.
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [touchPoint(PARKING_SPOT, 1)],
  });
  const two = analyseEnding(await tail(), "pointerup");
  console.log(`ending 2 (touch release away), ${shape}: ${JSON.stringify(two)}`);
  assertCleared(two, `ending 2, touch release away from ${shape}`, "pointerup", "@control");

  // THREE: a POINTERCANCEL, produced by a touch that begins on the control
  // and then moves far enough that the engine takes the gesture, which is
  // what a scroll begun on a control is. The screen is asserted scrollable
  // first, because a gesture the engine cannot take produces a pointerup and
  // this ending would then be a different ending wearing its name.
  const scrollable = await page.evaluate(
    () => document.documentElement.scrollHeight > window.innerHeight + 8,
  );
  expect(
    scrollable,
    `ending 3, ${shape}: the screen does not scroll, so a scroll begun on the control cannot` +
      ` produce the pointercancel this ending is about`,
  ).toBe(true);
  const room = await page.evaluate(() => ({
    y: window.scrollY,
    max: Math.max(0, document.documentElement.scrollHeight - window.innerHeight),
    height: window.innerHeight,
  }));
  // The finger moves in the direction the page still has room to scroll in.
  // scrollIntoViewIfNeeded may already have taken the control to the bottom,
  // where a swipe upward scrolls nothing and the assertion below would fail
  // for the position rather than for the mechanism.
  const direction = room.y > 4 ? 1 : -1;
  const scrollBefore = room.y;
  await begin();
  // A REAL TOUCH THAT BEGINS ON THE CONTROL AND THEN MOVES, which is what a
  // scroll begun on a control is. Input.synthesizeScrollGesture was tried
  // first and delivered a pointerup rather than a pointercancel here, so the
  // gesture is driven as raw touch events and the engine is left to decide:
  // the pointercancel below is the engine taking it, and the scroll position
  // moving is the second witness that it really did.
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [touchPoint(at, 1)] });
  await page.waitForTimeout(80);
  for (const step of [40, 110, 200]) {
    const y = Math.min(room.height - 4, Math.max(4, at.y + direction * step));
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [touchPoint({ x: at.x, y }, 1)],
    });
    await page.waitForTimeout(30);
  }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  const three = analyseEnding(await tail(), "pointercancel");
  const scrollAfter = await page.evaluate(() => window.scrollY);
  console.log(
    `ending 3 (scroll taken by the engine), ${shape}: ${JSON.stringify(three)},` +
      ` scrollY ${scrollBefore} to ${scrollAfter}`,
  );
  expect(
    scrollAfter,
    `ending 3, ${shape}: the page did not scroll, so the engine did not take the gesture and` +
      ` this ending is not the one it claims to be`,
  ).not.toBe(scrollBefore);
  assertCleared(three, `ending 3, scroll begun on ${shape}`, "pointercancel", "@control");
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(150);

  // FOUR: a MOUSE press begun on the control and released elsewhere. THE
  // DISCRIMINATOR: a touch pointer has implicit capture, so a touch pointerup
  // reaches its pointerdown target however far the finger travelled, and
  // endings one through three cannot tell a document-wide clear from a
  // target-scoped one. A mouse pointer has none, so a listener bound to the
  // control alone passes those three and fails this.
  await el.scrollIntoViewIfNeeded();
  const atNow = await centreOf(el);
  await begin();
  await page.mouse.move(atNow.x, atNow.y);
  await page.mouse.down();
  await page.waitForTimeout(150);
  await page.mouse.move(PARKING_SPOT.x, PARKING_SPOT.y);
  await page.mouse.up();
  const four = analyseEnding(await tail(), "pointerup");
  console.log(`ending 4 (mouse press released elsewhere), ${shape}: ${JSON.stringify(four)}`);
  assertCleared(four, `ending 4, mouse press begun on ${shape} and released elsewhere`, "pointerup", "@other");
  expect(
    four.upTargetWasControl,
    `ending 4, ${shape}: the pointerup DID reach the control, so this run did not exercise the` +
      ` case the ending exists for and cannot tell a document-wide clear from a target-scoped one`,
  ).toBe(false);

  // FIVE: TWO PRESSES IN FLIGHT. A clear that remembers the pressed element
  // in a SINGLE SLOT passes endings one through four and, under two presses,
  // overwrites the slot and leaves the first control drawn pressed with
  // nothing left that will ever clear it.
  // BOTH CONTROLS HAVE TO BE ON SCREEN AT THE SAME TIME, or the second touch
  // lands on whatever happens to be at those coordinates and the overlap
  // this ending exists to witness never happens. Measured once as exactly
  // that: the second touch fired a pointerdown somewhere and the second
  // control was never marked.
  await page.evaluate(
    (selectors: readonly string[]) => {
      const a = document.querySelector(selectors[0] ?? "");
      const b = document.querySelector(selectors[1] ?? "");
      if (!a || !b) return;
      const top =
        Math.min(a.getBoundingClientRect().top, b.getBoundingClientRect().top) + window.scrollY;
      window.scrollTo(0, Math.max(0, top - 80));
    },
    [primary, second] as readonly string[],
  );
  await page.waitForTimeout(150);
  const atA = await centreOf(el);
  const atB = await centreOf(other);
  const viewportHeight = page.viewportSize()?.height ?? 0;
  for (const [label, point] of [
    ["the first", atA],
    ["the second", atB],
  ] as const) {
    expect(
      point.y > 0 && point.y < viewportHeight,
      `ending 5, ${shape}: ${label} control's centre is off screen at y ${point.y.toFixed(0)},` +
        ` so the two presses cannot be in flight together`,
    ).toBe(true);
  }
  await begin();
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [touchPoint(atA, 1)] });
  await page.waitForTimeout(120);
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [touchPoint(atA, 1), touchPoint(atB, 2)],
  });
  await page.waitForTimeout(160);
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [touchPoint(atA, 1)],
  });
  await page.waitForTimeout(120);
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [touchPoint(atB, 2)],
  });
  const five = analyseEnding(await tail(), "pointerup");
  console.log(`ending 5 (two presses in flight), ${shape}: ${JSON.stringify(five)}`);
  // THE OVERLAP IS WITNESSED AND NOT ASSUMED. Ending five proves each ENDING
  // happened; it does not prove the two presses were ever in flight together,
  // and a multitouch setup that silently drove one press instead of two
  // produces the same green as a correct implementation. Both controls carry
  // the marking in the window before either release under any implementation
  // that marks them, so this costs nothing and closes the hole.
  expect(
    five.bothMarkedSimultaneously,
    `ending 5, ${shape}: no sampled frame carried the marking on BOTH controls at once, so the` +
      ` two presses were never in flight together and this ending measured one press twice.` +
      ` Events: ${JSON.stringify(five.endingEvents)}`,
  ).toBeGreaterThan(0);
  assertCleared(five, `ending 5, two presses in flight from ${shape}`, "pointerup", "@control");

  await page.evaluate(() => window.__m3p9press.allowClicks());
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
  // WHY THE SECOND CONDITION IS HERE, and why removing it would be wrong
  // (finding CR2-M3P9-09, raised against this line and REFUTED with the
  // stylesheet rather than adopted; fleet warning 15, a review's
  // concrete-edit is a proposal and not a patch). Criterion 9.2(b)(ii)'s
  // alpha floor exists for a state that CHANGES THE BACKGROUND: it stops a
  // pressed tint clearing the contrast bar only by being nearly opaque.
  // Criterion 9.3's states are not all of that kind. The busy rule sets
  // opacity and cursor and NO background at all (src/app/globals.css,
  // [aria-busy="true"] and .pulse-busy), so on a control whose resting
  // background is transparent, the entered background is transparent too;
  // an unconditional floor would demand an alpha of 0.08 from a background
  // the state never touched and redden a magnitude that legitimately passes
  // on an opacity delta of 0.30 against a bar of 0.15. The floor therefore
  // applies where the BACKGROUND COMPARISON is the branch being relied on,
  // which is what this condition says. The criterion's sentence is the half
  // that should carry the qualification; that is recorded for the plan.
  const restAlpha = await alphaOf(page, rest.backgroundColor);
  if (restAlpha === 0 && bgRatio >= MIN_CONTRAST_RATIO) {
    expect(
      await alphaOf(page, entered.backgroundColor),
      `${label}: tint below the alpha floor on a transparent control`,
    ).toBeGreaterThanOrEqual(0.08);
  }
};

// CRITERION 9.3(a), THE REFUSAL, MEASURED AND NOT ASSERTED IN PROSE. A real
// hit-tested click at the control's viewport centre, never
// element.dispatchEvent, which bypasses hit testing and would fire whatever
// pointer-events says.
//
// THE OBSERVABLE IS THE CLICK'S TARGET, observed at the capture-phase
// refusal and nowhere else. A listener on the control cannot be it: the
// refusal calls stopPropagation on document and document heads the capture
// path, so a listener below runs in NEITHER condition and the experiment
// passes vacuously in one direction. "A click was captured" cannot be it
// either: with pointer-events none the click still lands on the ancestor
// behind the control and is still captured, in both conditions. What moves
// is the TARGET, and the control's rect is pinned identical across the two
// attempts so the difference is the marking's doing and not the
// coordinates'.
const assertActivationRefused = async (
  page: Page,
  probe: string,
  where: string,
): Promise<void> => {
  const el = page.locator(probe);
  await el.scrollIntoViewIfNeeded();
  const before = await el.boundingBox();
  expect(before, `no box for ${where}`).not.toBeNull();
  const centre = {
    x: (before?.x ?? 0) + (before?.width ?? 0) / 2,
    y: (before?.y ?? 0) + (before?.height ?? 0) / 2,
  };

  await page.evaluate(() => window.__m3p9press.refuseClicks());
  await el.evaluate((n) => n.setAttribute("aria-disabled", "true"));
  await settle(el);
  const marked = (await el.evaluate((n) => window.__m3p9.snapshot(n))) as Snapshot;
  expect(
    marked.pointerEvents,
    `an aria-disabled control still accepts pointer input: ${where}`,
  ).toBe("none");
  const rectWhileMarked = await el.boundingBox();
  await page.mouse.click(centre.x, centre.y);
  const whileMarked = await page.evaluate(
    (s) => window.__m3p9press.clickedTargetRelation(s),
    probe,
  );

  await el.evaluate((n) => n.removeAttribute("aria-disabled"));
  await settle(el);
  const rectWhileUnmarked = await el.boundingBox();
  await page.evaluate(() => window.__m3p9press.refuseClicks());
  await page.mouse.click(centre.x, centre.y);
  const whileUnmarked = await page.evaluate(
    (s) => window.__m3p9press.clickedTargetRelation(s),
    probe,
  );
  await page.evaluate(() => window.__m3p9press.allowClicks());

  // THE UNCHANGED RECT IS WHAT MAKES THE SECOND CLICK THE SAME CLICK.
  expect(
    [rectWhileMarked?.x, rectWhileMarked?.y, rectWhileMarked?.width, rectWhileMarked?.height],
    `${where}: the control's box moved between the two activation attempts, so a moved page` +
      ` could pass for a refusal`,
  ).toEqual([
    rectWhileUnmarked?.x,
    rectWhileUnmarked?.y,
    rectWhileUnmarked?.width,
    rectWhileUnmarked?.height,
  ]);
  expect(
    whileMarked,
    `${where}: with aria-disabled set, the click at the control's centre was targeted` +
      ` ${JSON.stringify(whileMarked)}; an ancestor was expected, which is what a refused` +
      ` activation looks like`,
  ).toEqual(["ancestor"]);
  expect(
    whileUnmarked,
    `${where}: with the marking removed, the SAME click at the SAME coordinates was targeted` +
      ` ${JSON.stringify(whileUnmarked)}; the control itself was expected, so the refusal above` +
      ` proves nothing`,
  ).toEqual(["control"]);
};

const measureScreen = async (
  page: Page,
  reduced: boolean,
  collected: Set<string>,
  nonZeroTransition: { seen: boolean },
  touched: Set<string>,
  cdp: CDPSession | null,
): Promise<void> => {
  for (const control of await sweep(page)) {
    collected.add(control.identity);
    const where = `${control.identity} (${page.url()})`;
    const probe = `[data-m3p9-probe="${control.index}"]`;
    const el = page.locator(probe);
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

    // THE REFUSAL, on the controls that can only be marked this way: the
    // eleven links and the disclosure summary. Once per identity across the
    // journey, because the set criterion 9.2(a) pins is the identities.
    if (disabledAttr === "aria-disabled" && !touched.has(`refuse:${control.identity}`)) {
      touched.add(`refuse:${control.identity}`);
      await assertActivationRefused(page, probe, where);
    }

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

    // 9.4(a), THE ANIMATION HALF, READ WHERE THE ANIMATION ACTUALLY IS. The
    // loop is declared on [aria-busy="true"]::after, so the control's own
    // animation-name is "none" at both motion settings and asserting on it
    // proves nothing: deleting --duration-busy-cycle from the reduced-motion
    // block would leave the mark spinning under reduce and the old assertion
    // stayed green. Both halves below redden on exactly that removal.
    if (reduced) {
      const afterAnimated =
        busy.afterAnimationName !== "none" &&
        busy.afterAnimationDuration.split(",").some((d) => parseFloat(d) > 0);
      expect(
        afterAnimated,
        `the busy mark still animates under reduce on ${where}` +
          ` (name ${busy.afterAnimationName}, duration ${busy.afterAnimationDuration})`,
      ).toBe(false);
      expect(busyAnimations, `a running animation under reduce while busy on ${where}`).toEqual([]);
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

    // .pulse-busy IS SHIPPED, SO .pulse-busy IS MEASURED. It is the class
    // M3-P10 is told to put on a link-shaped control, and before this round
    // nothing in the suite touched it: the selectors could have been deleted
    // or misspelled and every criterion stayed green.
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

    // ---------- 9.9(b): the same control, pressed by a FINGER, in the
    // shipped document, with nothing installed by this file ----------
    if (cdp !== null && !touched.has(control.identity)) {
      touched.add(control.identity);
      const measured = await holdTouchPress(page, cdp, probe, TOUCH_HOLD_MS);
      console.log(
        `touch press ${reduced ? "(reduce)" : "(full motion)"} ${control.identity}:` +
          ` ${measured.framesPressed}/${measured.framesInWindow} frames marked,` +
          ` ${measured.framesMoved} with a transform, peak ${measured.peakMatrixY.toFixed(3)}px` +
          ` (rect ${measured.peakRectDelta.toFixed(3)}px), first movement at frame` +
          ` ${measured.firstMovedIndex} (${measured.firstMovedMs.toFixed(1)}ms),` +
          ` ${measured.simultaneous} frames marked AND moved`,
      );
      await assertPress(page, probe, measured, where, true);
    }
  }
};

const runJourney = async (page: Page, reduced: boolean, cdp: CDPSession | null): Promise<void> => {
  const collected = new Set<string>();
  const touched = new Set<string>();
  const nonZeroTransition = { seen: false };
  const measure = () => measureScreen(page, reduced, collected, nonZeroTransition, touched, cdp);

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

  // M3-P14: a household that has registered nothing is sent to the accounts
  // screen before the import screen will accept a file, so the account this
  // fixture belongs to is registered first. No measurement is taken on the
  // accounts screen; see the note on the enumeration above.
  await registerCurrentAccount(page, FIXTURE_ACCOUNT_A);

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

  // 9.9(e), THE DISCLOSURE SUMMARY SHAPE. It exists on this screen and
  // nowhere else, which is why the endings for it are driven here.
  if (cdp !== null && !reduced) {
    await install(page);
    await runEndings(
      page,
      cdp,
      "the disclosure summary",
      "details.spec-editor summary",
      "details.spec-editor button",
    );
  }

  await page.getByLabel("Format name").fill("Demobank current account");
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
  await install(page);
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
  // well as the busy one, and only the content half was asserted here
  // before: a later phase could have zeroed the mark's width without turning
  // the suite red. What it binds against is width AND border both zeroed,
  // because Tailwind's preflight puts box-sizing: border-box on ::after and
  // a one-pixel border computes a width of 2px at width: 0.
  expect(parseFloat(rowMarked.afterWidth), "unconfirmed mark has zero width").toBeGreaterThan(0);

  // A CLOSED MONTH THAT HAS A LATER ONE, reached by the month view's own
  // query parameter rather than by whatever month the clock lands on, so the
  // next month step renders.
  await page.goto("/?month=2026-08");
  await expect(page.getByTestId("month-title")).toBeVisible();
  await expect(page.getByLabel("Next month")).toBeVisible();
  await expect(page.getByTestId("unresolved-pill")).toBeVisible();
  await measure();

  // 9.9(e), THE OTHER TWO SHAPES. This screen scrolls, which ending three
  // needs: a scroll the engine takes is what produces the pointercancel, and
  // a screen that cannot scroll turns that ending into a different ending
  // wearing its name.
  if (cdp !== null && !reduced) {
    await install(page);
    await runEndings(
      page,
      cdp,
      "a submit button",
      "button.app-signout",
      '[data-testid="nav-import"]',
    );
    await runEndings(
      page,
      cdp,
      "a link-shaped control with no background of its own",
      '[data-testid="nav-overview"]',
      "button.app-signout",
    );
  }

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
  console.log(`swept control set (${found.length}):\n  ${found.join("\n  ")}`);
  const expected = [...ENUMERATION].sort();
  expect(found, "the swept control set is not the enumeration").toEqual(expected);
  expect(found).toHaveLength(21);

  if (cdp !== null) {
    // Criterion 9.9(b) is taken over the SET, so the count of controls the
    // touch press reached is printed beside the swept set and asserted equal
    // to it: a touch measurement that quietly reached fewer controls than the
    // sweep is the denominator error hazard H9.8 records, arriving through a
    // second door.
    const pressed = [...touched].filter((k) => !k.startsWith("refuse:")).sort();
    console.log(`touch-pressed control set (${pressed.length})`);
    expect(pressed, "the touch press did not reach every control in the swept set").toEqual(found);
  }

  if (!reduced) {
    expect(
      nonZeroTransition.seen,
      "no control reported a non-zero transition-duration under no-preference",
    ).toBe(true);
  }
};

// =====================================================================
// CRITERION 9.9(a), THE HALF WITH NO SKIP CONDITION. It is a claim about the
// CONFIG and it sits OUTSIDE the describe block that carries the hasTouch
// skip deliberately: inside it, this test would pass under the phone project,
// skip under the desktop one, and be silent in exactly the case it exists
// for, which is a later phase narrowing testMatch so the phone project stops
// collecting this file. A file no project matches is never LOADED, so nothing
// inside it can fail; what binds is this assertion running under every
// project that still collects it.
//
// CR2-M3P9-02: Playwright decides collection with BOTH halves,
// `!testIgnore(file) && testMatch(file)`, and a project with no testIgnore of
// its own falls back to the top-level config's testIgnore. A predicate that
// reads testMatch alone reports a project as collecting a file it has since
// been testIgnore'd out of, which is exactly the silent-empty failure this
// check exists to catch. matchesPattern below is the shared shape matcher for
// both halves; matchesSpec combines them the same way Playwright does. An
// ABSENT testMatch is Playwright's own default and DOES collect the file, so
// it reads as a match rather than as no match.
// =====================================================================
const matchesPattern = (pattern: unknown, file: string): boolean => {
  if (pattern === undefined || pattern === null) return false;
  if (Array.isArray(pattern)) return pattern.some((m) => matchesPattern(m, file));
  if (pattern instanceof RegExp) return pattern.test(file);
  if (typeof pattern === "string") return file.includes(pattern);
  return false;
};

const matchesSpec = (
  testMatch: unknown,
  testIgnore: unknown,
  topLevelTestIgnore: unknown,
  file: string,
): boolean => {
  const effectiveIgnore = testIgnore ?? topLevelTestIgnore;
  if (matchesPattern(effectiveIgnore, file)) return false;
  if (testMatch === undefined || testMatch === null) return true;
  return matchesPattern(testMatch, file);
};

test("a project with touch collects this spec, and the config still says so", async () => {
  const file = basename(test.info().file);
  type Loaded = {
    projects?: {
      name?: string;
      use?: { hasTouch?: boolean };
      testMatch?: unknown;
      testIgnore?: unknown;
    }[];
    testIgnore?: unknown;
    default?: Loaded;
  };
  // Playwright's own TypeScript loader hands back a module whose default is
  // itself a module with a default, so the config is unwrapped rather than
  // assumed: read from disk would have the same shape problem in reverse.
  const imported = (await import("../../playwright.config")) as unknown as Loaded;
  const loaded: Loaded = imported.default?.default ?? imported.default ?? imported;
  const projects = loaded.projects ?? [];
  expect(
    projects.length,
    "playwright.config.ts was imported but declares no projects, so this check read nothing",
  ).toBeGreaterThan(0);
  const touchProjects = projects.filter((p) => p.use?.hasTouch === true);
  expect(
    touchProjects.map((p) => p.name),
    "no Playwright project declares hasTouch, so nothing in this config can press with a finger",
  ).not.toEqual([]);
  const collecting = touchProjects.filter((p) =>
    matchesSpec(p.testMatch, p.testIgnore, loaded.testIgnore, file),
  );
  expect(
    collecting.map((p) => p.name),
    `no project with hasTouch collects ${file}. The touch measurement in this file is the only` +
      ` evidence this product's press feedback reaches a finger, and a project that no longer` +
      ` collects it (by testMatch or by testIgnore, its own or the top-level config's) empties` +
      ` that measurement silently instead of failing.`,
  ).not.toEqual([]);
  console.log(
    `config membership: ${file} is collected by ${JSON.stringify(collecting.map((p) => p.name))}` +
      ` with hasTouch, out of projects ${JSON.stringify(projects.map((p) => p.name))}`,
  );
});

// =====================================================================
// DECISION D-61's STANDING CONSTRAINT, GIVEN A MECHANISM (finding R2H-02).
// The listener is a string constant and is therefore not typechecked, and
// D-61 permits that only because the constant carries NO INTERPOLATION,
// ever: no template expression, no token, no request value, no locale and
// no user input, so it has no injection surface at all. The clean-room
// hazard lane found that constraint true and enforced by NOTHING, which
// makes "ever" a hope rather than a property. This is the check.
//
// It has NO SKIP CONDITION, deliberately, for the same reason the config
// membership test has none: a guard that only runs where touch is declared
// is silent in half the runs. It reads the shipped file from disk rather
// than importing it, because importing a server component into a test
// proves nothing about the text that reaches the browser.
// =====================================================================
test("the press listener constant carries no interpolation", async () => {
  const layout = readFileSync(join(__dirname, "..", "..", "src", "app", "layout.tsx"), "utf8");
  const constant = layout.match(/const PRESS_FEEDBACK = `([\s\S]*?)`;/);
  expect(
    constant,
    "src/app/layout.tsx no longer declares a module-scope PRESS_FEEDBACK template constant." +
      " If the listener moved to a client island, decision D-61 has been reopened and this" +
      " check, criterion 9.9(a) and hazard H9.5 all need re-reading before it lands.",
  ).not.toBeNull();
  const body = constant?.[1] ?? "";
  expect(body.length, "the PRESS_FEEDBACK constant is empty").toBeGreaterThan(0);
  // A template expression is the only way a value can reach this string.
  const interpolations = body.match(/\$\{/g) ?? [];
  expect(
    interpolations,
    `the PRESS_FEEDBACK constant carries ${interpolations.length} template expression(s).` +
      ` Decision D-61 permits an unchecked inline script ONLY because nothing can be` +
      ` interpolated into it. A phase that needs a value inside it does not add one here:` +
      ` it moves the listener to a client island and reopens D-61.`,
  ).toEqual([]);
  console.log(
    `PRESS_FEEDBACK: ${body.length} characters, ${interpolations.length} template expressions`,
  );
});

// =====================================================================
// CRITERION 9.9(a): THE MECHANISM IS SERVED, IT IS NOT INJECTED.
// =====================================================================
// The marker is the bare attribute data-press-feedback and deliberately
// not a data-testid: a pre-existing helper sweeps every data-testid in the
// document and requires a non-zero bounding rect, which a script element
// cannot have. What this reads is the RAW RESPONSE BODY, matched as text,
// so the marker never has to be a Playwright locator.
const SCRIPT_TAG = /<script data-press-feedback[^>]*>([\s\S]*?)<\/script>/;

test("the press listener is served in the document, on the shell and on the sign-in screen", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const bodies: Record<string, string> = {};

  const signIn = await page.goto("/sign-in");
  expect(signIn, "no navigation response for /sign-in").not.toBeNull();
  bodies["/sign-in"] = (await signIn?.text()) ?? "";

  const unique = `served-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
  await page.goto("/sign-up");
  await page.getByLabel("Email").fill(`${unique}@pulse-e2e.test`);
  await page.getByLabel("Password").fill(`pw-${unique}`);
  await page.getByRole("button", { name: "Create household" }).click();
  await expect(page.getByTestId("household-context")).toHaveText(unique);
  const shell = await page.goto("/");
  expect(shell, "no navigation response for the authenticated shell").not.toBeNull();
  bodies["/"] = (await shell?.text()) ?? "";

  for (const [route, body] of Object.entries(bodies)) {
    const match = body.match(SCRIPT_TAG);
    expect(
      match,
      `the raw response body for ${route} carries no script element with` +
        ` the bare attribute data-press-feedback. A pressed rule nothing raises` +
        ` is an inert stylesheet.`,
    ).not.toBeNull();
    const served = match?.[1] ?? "";
    expect(
      served.trim().length,
      `the script element served for ${route} has an EMPTY body. A tag with a test id and no` +
        ` body satisfies an element assertion and ships no listener.`,
    ).toBeGreaterThan(0);
    expect(
      served.includes("addEventListener") && served.includes("pointerdown"),
      `the script served for ${route} registers no pointerdown listener`,
    ).toBe(true);
  }

  // The live element is byte identical to what the response carried, so the
  // measurement is of the served document and not of something a client
  // bundle replaced.
  const live = await page.evaluate(
    () => document.querySelector("script[data-press-feedback]")?.textContent ?? "",
  );
  expect(
    live,
    "the live script element's text differs from the text the shell's response carried",
  ).toBe((bodies["/"] ?? "").match(SCRIPT_TAG)?.[1] ?? "");

  // CR2-M3P9-03: a BEHAVIOURAL witness beside the two text checks above, so a
  // script element whose entire body is a comment naming the words
  // "addEventListener" and "pointerdown" cannot pass this test. This drives a
  // real pointerdown at a live control on the served, unmodified document and
  // reads back the attribute the SHIPPED listener is supposed to raise;
  // nothing has been installed yet at this point in the test, so what answers
  // is the served script and not this spec's own recorder. It runs here,
  // outside the touch describe block's hasTouch skip, so the desktop project
  // witnesses it too and not only chromium-phone.
  const witness = page.locator("button.app-signout");
  await expect(witness).toBeVisible();
  const witnessAt = await centreOf(witness);
  await page.mouse.move(witnessAt.x, witnessAt.y);
  await page.mouse.down();
  const raisedByServedListener = await witness.evaluate((el) => el.matches("[data-pressed]"));
  await page.mouse.up();
  expect(
    raisedByServedListener,
    "a real pointerdown on a live control did not raise [data-pressed]. The script served for" +
      " / carries the text \"addEventListener\" and \"pointerdown\" but the listener it" +
      " registers does not mark the control pressed.",
  ).toBe(true);

  // Criterion 9.9(a): the spec PRINTS what it injected, so a reader checks
  // the claim rather than trusting a grep. Nothing here writes the marking.
  await install(page);
  console.log(`scripts this spec injects: ${JSON.stringify(INJECTED)}`);
  console.log(
    `this file declares ${CHROMIUM_PHONE_TEST_COUNT} tests under the phone project;` +
      ` the run's PASSED count for that project is what the work history puts beside it`,
  );
});

// =====================================================================
// CRITERION 9.9(c): :active STAYS AT ZERO, ON PATHS SHOWN TO BE ALIVE.
// =====================================================================
test.describe("the press a finger makes", () => {
  test.skip(({ hasTouch }) => hasTouch !== true, "the touch halves need a project with hasTouch");

  test("three touch paths deliver input and none of them reaches :active", async ({ page }) => {
    test.setTimeout(120_000);
    const cdp = await page.context().newCDPSession(page);
    await page.goto("/sign-in");
    await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
    await install(page);
    await page.evaluate(() => window.__m3p9press.refuseClicks());

    const probe = "button.auth-submit";
    const at = await centreOf(page.locator(probe));
    // How many of the three paths measured their :active zero over at least
    // one sampled animation frame. Asserted at the end of the loop.
    let sampledPaths = 0;

    // The third path is marked NOT HELD deliberately. page.touchscreen.tap
    // dispatches its touchstart and its touchend inside one task, so no
    // animation frame falls between them and NO mechanism, this product's or
    // any other, can be observed in a held state under it. Its zero is
    // therefore a weaker witness than the two held paths', and saying so is
    // the difference between a measurement and a number.
    const paths: readonly [string, boolean, () => Promise<void>][] = [
      [
        "held CDP Input.dispatchTouchEvent touchStart",
        true,
        async () => {
          await cdp.send("Input.dispatchTouchEvent", {
            type: "touchStart",
            touchPoints: [touchPoint(at, 1)],
          });
          await page.waitForTimeout(TOUCH_HOLD_MS);
          await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
        },
      ],
      [
        'Input.synthesizeTapGesture with gestureSourceType "touch"',
        true,
        async () => {
          await cdp.send("Input.synthesizeTapGesture", {
            x: at.x,
            y: at.y,
            duration: TOUCH_HOLD_MS,
            gestureSourceType: "touch",
          });
          await page.waitForTimeout(120);
        },
      ],
      [
        "page.touchscreen.tap",
        false,
        async () => {
          await page.touchscreen.tap(at.x, at.y);
          await page.waitForTimeout(120);
        },
      ],
    ];

    for (const [name, held, drive] of paths) {
      // CLEAR THE BROWSER'S ACTIVE CHAIN BETWEEN PATHS. The path before this
      // one ends with a compatibility mouse click that this spec refuses, and
      // a refused click leaves Chromium's active chain set on the control
      // until the next input, so ONE frame of the next path's window can
      // still carry :active from the previous path rather than from the touch
      // under test. Measured as exactly that: a single :active frame on the
      // second path, with zero on the same path in isolation. This is the
      // same residue the endings clear, for the same reason.
      await clearActiveChain(page);
      await page.evaluate((s) => window.__m3p9press.begin([s]), probe);
      await drive();
      await page.waitForTimeout(60);
      const record = (await page.evaluate(() => window.__m3p9press.end())) as PressRecord;
      const onControl = record.events.filter((e) => e.onTracked[0]);
      const events = onControl.map((e) => e.type);
      // THE WINDOW IS THE PRESS, AND THAT IS THE DEFINITION AND NOT A
      // WEAKENING. Frames after the touch has ended are by construction not
      // the touch press. It matters here because of something measured in
      // this round rather than reasoned about: with the capture-phase click
      // refusal installed, the compatibility MOUSE click Chromium synthesises
      // after a raw touch sequence leaves the control in :active from about
      // 14ms after touchend onward, so a count taken over the whole record
      // reports :active frames produced by this spec's own instrument. The
      // captured probe is in the phase work history. Both numbers are printed.
      const startedAt = onControl.find((e) => e.type === "pointerdown")?.t ?? 0;
      const endedAt =
        onControl.filter((e) => e.type === "touchend" || e.type === "pointerup").pop()?.t ??
        Number.POSITIVE_INFINITY;
      const duringPress = record.frames.filter((f) => f.t >= startedAt && f.t <= endedAt);
      const activeFrames = duringPress.filter((f) => f.active[0]).length;
      const activeAfterRelease = record.frames.filter((f) => f.t > endedAt && f.active[0]).length;
      const pressedFrames = duringPress.filter((f) => f.pressed[0]).length;
      // WHAT THIS PATH'S ZERO IS WORTH, printed rather than left to be
      // inferred (finding CR2-M3P9-13). A zero counted over an EMPTY window
      // is numerically identical to a zero counted over 24 frames, and
      // page.touchscreen.tap dispatches its touchstart and its touchend
      // inside one task, so no animation frame can fall between them and no
      // mechanism, this product's or any other, can be observed held under
      // it. Its liveness clause proves DELIVERY and not SAMPLING, so its zero
      // is recorded as VACUOUS and the two held paths are what the zero binds
      // on. The count of paths whose zero was measured over a non-empty
      // window is asserted below, so this can never quietly become zero.
      const verdictOfZero = duringPress.length > 0 ? "LOAD-BEARING" : "VACUOUS, sampled no frame";
      if (duringPress.length > 0) sampledPaths += 1;
      console.log(
        `touch path "${name}": events ${JSON.stringify(events)},` +
          ` ${duringPress.length} frames during the press, in :active ${activeFrames}` +
          ` (${verdictOfZero}),` +
          ` carrying the shipped marking ${pressedFrames};` +
          ` :active frames after the release ${activeAfterRelease}` +
          ` (the compatibility mouse click, not the touch)`,
      );
      if (held) {
        expect(
          duringPress.length,
          `touch path "${name}" holds the touch open and still sampled no animation frame` +
            ` between the pointerdown and the release`,
        ).toBeGreaterThan(0);
      }

      // THE PATH IS SHOWN TO BE ALIVE FIRST. A zero from a path that
      // delivered nothing is the same number as a zero from an engine that
      // grants no :active, and the whole value of this half is that the two
      // can be told apart.
      expect(events, `touch path "${name}" delivered no pointerdown to the control`).toContain(
        "pointerdown",
      );
      expect(events, `touch path "${name}" delivered no touchstart to the control`).toContain(
        "touchstart",
      );
      // AND ONLY THEN THE ZERO. It is kept deliberately: an engine version
      // that later begins granting :active under a synthesized touch turns
      // this suite RED and forces the mechanism to be re-derived, instead of
      // quietly making the press measurement pass for a reason nobody chose.
      expect(
        activeFrames,
        `touch path "${name}" put the control into :active for ${activeFrames} frames during the press.` +
          ` THIS IS A RECORDED MEASUREMENT AND NOT A REQUIREMENT: if it reddened because this` +
          ` engine now grants :active to a touch, that is good news. Re-measure, update this` +
          ` number and say so in the work history.`,
      ).toBe(0);
    }

    // THE ZERO HAS TO HAVE BEEN LOOKED FOR SOMEWHERE. Criterion 9.9(c)'s own
    // reason for its liveness clause is that "a zero from a path that
    // delivered nothing is the same number as a zero from an engine that
    // grants no :active"; the same argument applies one level down, to a
    // zero from a path that SAMPLED nothing. Two of the three paths hold the
    // touch open and carry the measurement; the third cannot, by
    // construction, and its zero is printed as vacuous rather than counted.
    expect(
      sampledPaths,
      `only ${sampledPaths} of the three touch paths measured their :active zero over a` +
        ` non-empty window of animation frames. A zero nothing looked at is not a measurement.`,
    ).toBeGreaterThanOrEqual(2);
    await page.evaluate(() => window.__m3p9press.allowClicks());
  });
});

test.describe("pressed, disabled and busy appearances at full motion", () => {
  test.use({ contextOptions: { reducedMotion: "no-preference" } });

  test("every control looks pressed while held, unusable while disabled and busy while busy", async ({
    page,
    hasTouch,
  }) => {
    test.setTimeout(420_000);
    const cdp = hasTouch === true ? await page.context().newCDPSession(page) : null;
    await runJourney(page, false, cdp);
  });
});

test.describe("pressed, disabled and busy appearances under reduced motion", () => {
  test.use({ contextOptions: { reducedMotion: "reduce" } });

  test("the same appearances survive reduce, and only the easing is gone", async ({
    page,
    hasTouch,
  }) => {
    test.setTimeout(420_000);
    const cdp = hasTouch === true ? await page.context().newCDPSession(page) : null;
    await runJourney(page, true, cdp);
  });
});
