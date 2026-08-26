import type { Page } from "@playwright/test";

// THE PHONE MEASUREMENTS, ONE DEFINITION (M3-P7, extended in M3-P14).
//
// These were defined inside test/e2e/month-view.spec.ts and are now here so
// a second phone spec measures with the SAME instruments rather than a
// second copy of them. That is the same rule this phase applies to the
// account number's canonical form one layer down: two copies of a
// measurement drift, and a drifted measurement is worse than none because
// it is believed.

export const TAP_MIN = 44;

export const INTERACTIVE =
  "a, button, input:not([type=hidden]), select, [role=button]";

// Criterion 7.5, widened in M3-P14 for criterion 14.7. Every interactive
// control in the shell header and in main clears TAP_MIN, and the failure
// message names each offender with the measurement that failed.
//
// THE AXES ARGUMENT IS THE M3-P14 HALF, and it is not a refinement for its
// own sake. This helper compared HEIGHT ONLY. A fourth navigation link in a
// row of links that flex to an equal share of the width changes their WIDTH
// and not their height, so the one dimension the new link can break was the
// one dimension nothing measured. "height" keeps the pre-existing callers
// measuring exactly what they measured before; "both" is what criterion
// 14.7 asks for.
export const tapTargetOffenders = (
  page: Page,
  axes: "height" | "both" = "height",
): Promise<string[]> =>
  page.evaluate(
    ({ selector, min, measureWidth }) => {
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
          const name =
            element.getAttribute("data-testid") ??
            (element.textContent ?? "").trim().slice(0, 40);
          if (rect.height < min) {
            offenders.push(`${name}: ${Math.round(rect.height)}px tall`);
          }
          if (measureWidth && rect.width < min) {
            offenders.push(`${name}: ${Math.round(rect.width)}px wide`);
          }
        }
      }
      return offenders;
    },
    { selector: INTERACTIVE, min: TAP_MIN, measureWidth: axes === "both" },
  );

// A platform text-scaling setting multiplies each element's own size once.
//
// SNAPSHOT FIRST, THEN APPLY. Reading a computed size after an ancestor has
// already been written compounds the factor down the tree, because
// font-size inherits: the first draft of this helper did exactly that and
// reported a document 17 times too wide.
export const applyTextScale = (page: Page, factor: number): Promise<void> =>
  page.evaluate((scale) => {
    const elements = [...document.querySelectorAll("*")].filter(
      (element): element is HTMLElement => element instanceof HTMLElement,
    );
    const sizes = elements.map((element) =>
      parseFloat(getComputedStyle(element).fontSize),
    );
    elements.forEach((element, index) => {
      const size = sizes[index];
      if (size !== undefined && Number.isFinite(size)) {
        element.style.fontSize = `${size * scale}px`;
      }
    });
  }, factor);

export const horizontalOverflow = (
  page: Page,
): Promise<{ readonly scrollWidth: number; readonly clientWidth: number }> =>
  page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));

// Criterion 7.7 (a) and (b). Horizontal clipping over everything inside
// main that is not .visually-hidden, and vertical clipping over the
// elements that actually clip: an element with visible overflow reports
// content height it is not hiding.
export const clippingOffenders = (
  page: Page,
): Promise<{ readonly horizontal: string[]; readonly vertical: string[] }> =>
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

// How many LINES a nav link's label renders on, per link, keyed by its
// data-testid. Criterion 14.7 requires the added link to render on at most
// the largest line count any existing link renders on, so the number is
// MEASURED off the row rather than carried as a constant.
export const navLinkLineCounts = (
  page: Page,
): Promise<Record<string, number>> =>
  page.evaluate(() => {
    const counts: Record<string, number> = {};
    for (const link of document.querySelectorAll(
      '[data-testid="main-nav"] a',
    )) {
      const testId = link.getAttribute("data-testid") ?? "";
      const rect = link.getBoundingClientRect();
      const style = getComputedStyle(link);
      const lineHeight = parseFloat(style.lineHeight);
      const fontSize = parseFloat(style.fontSize);
      // A computed lineHeight of "normal" parses to NaN; the usual
      // approximation is 1.2 times the font size, and the ratio is what
      // this measurement compares, not the absolute number.
      const line = Number.isFinite(lineHeight) ? lineHeight : fontSize * 1.2;
      const padding =
        parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
      const textHeight = rect.height - (Number.isFinite(padding) ? padding : 0);
      counts[testId] = Math.max(1, Math.round(textHeight / line));
    }
    return counts;
  });
