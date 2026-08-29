import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// THE BUSY STATE'S TWO STANDING RULES (M3-P10 fix round, findings
// HZ-M3P10-01 and HZ-M3P10-02).
//
// WHY THESE ARE PINNED HERE AND NOT ONLY IN THE PLAYWRIGHT SUITE. The
// behaviour lives in test/e2e/busy-state.spec.ts, which needs a server and
// an auth service. That is the right place for it and it stays there. What
// this file guards is the two SHAPES whose reintroduction produced the
// findings, both of which are one character of a diff away and neither of
// which any fast-gate test could see before:
//
//   1. `disabled={pending}` on the control that was just pressed. A focused
//      element that becomes disabled leaves the tab order, so the browser
//      moves focus to document.body and nothing puts it back. Measured in
//      chromium on the shipped leaf: activeElement went from the pressed
//      control to BODY and the control was no longer tabbable.
//   2. The disabled appearance dressing a control that is busy. The
//      disabled selectors carry an element name and outrank the bare
//      attribute selector the busy state uses, so a control that was
//      working rendered as one that was dead until every disabled rule was
//      scoped away from a busy control.
//
// Neither assertion says the busy state WORKS. They say the two defects
// this round removed are not back.

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..", "..");
const src = join(root, "src");

const walkFiles = (dir: string): readonly string[] =>
  readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    return statSync(full).isDirectory()
      ? walkFiles(full)
      : [full].filter((path) => /\.tsx?$/.test(path));
  });

// COMMENTS ARE STRIPPED BEFORE ANY SOURCE IS READ, and that is the same
// instrument defect finding HZ-M3P10-05 records against criterion 10.6(a)'s
// grep: this file's own first run reported the shape it forbids, and the
// match was the sentence in src/platform/ui/submit-button.tsx explaining why
// the shape is forbidden. A comment naming a shape is not that shape.
const withoutComments = (text: string): string =>
  text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const sources = walkFiles(src).map((path) => ({
  path: relative(root, path),
  text: withoutComments(readFileSync(path, "utf8")),
}));

const stylesheet = readFileSync(join(src, "app", "globals.css"), "utf8");
// Comments are stripped before any selector is read. A comment naming a
// selector is not a selector, and reading one as if it were is exactly the
// instrument defect finding HZ-M3P10-05 records against a grep.
const rules = stylesheet.replace(/\/\*[\s\S]*?\*\//g, "");

describe("the busy state does not take the keyboard's place", () => {
  it("no control binds the native disabled attribute to a pending flag", () => {
    const offenders = sources
      // The lookbehind is load-bearing: `aria-disabled={pending}` ends in
      // the same eleven characters and is the fix, not the defect.
      .filter(({ text }) => /(?<![-\w])disabled=\{\s*pending\b/.test(text))
      .map(({ path }) => path);
    expect(offenders, "use aria-disabled and a handler guard instead").toEqual([]);
  });

  it("every control that marks itself busy also marks the refusal", () => {
    const marksBusy = sources.filter(({ text }) => /aria-busy=\{\s*pending\b/.test(text));
    expect(marksBusy.map(({ path }) => path)).toEqual([
      "src/modules/accounts/ui/account-setup-form.tsx",
      "src/platform/ui/submit-button.tsx",
    ]);
    for (const { path, text } of marksBusy) {
      expect(/aria-disabled=\{\s*pending\b/.test(text), `${path}: no refusal`).toBe(true);
      // The attribute is set in BOTH states, which is what reserves the
      // mark's box at rest and stops the press widening the control
      // (finding HZ-M3P10-07).
      expect(
        /aria-busy=\{\s*pending \? "true" : "false"\s*\}/.test(text),
        `${path}: aria-busy is absent at rest, so the mark has no box to occupy`,
      ).toBe(true);
    }
  });

  it("the pending press is refused in a handler, on both submit surfaces", () => {
    const leaf = sources.find(({ path }) => path.endsWith("platform/ui/submit-button.tsx"));
    const form = sources.find(({ path }) =>
      path.endsWith("accounts/ui/account-setup-form.tsx"),
    );
    expect(leaf?.text).toMatch(/onClick=\{[\s\S]*?if \(pending\)[\s\S]*?preventDefault\(\)/);
    expect(form?.text).toMatch(/onSubmit=\{[\s\S]*?if \(pending\) \{\s*return;/);
  });

  // THE TWO HALVES THE KEYBOARD MEASUREMENT PROVED LOAD-BEARING (fix round
  // 2, criteria finding CR-M3P10-01). The guard is a handler plus a
  // stylesheet rule, and a chromium run over the built stylesheet counted
  // real submit events on each half separately:
  //   shipped guard, busy: real Enter 0, real Space 0, forced pointer click
  //     0, scripted click 0; two presses 100 ms apart total exactly 1
  //   the SAME markup with the handler removed, busy: real Enter 1, real
  //     Space 1, forced pointer click 0, two presses 100 ms apart total 2
  // So the stylesheet closes the pointer path and ONLY the pointer path,
  // and the handler closes the keyboard path. Deleting either one produces
  // criterion 10.4's own falsifying count of 2, and neither deletion was
  // visible to any fast-gate test before these two assertions.
  //
  // WHAT THESE DO NOT SAY, and it is the whole of CR-M3P10-01: a source
  // shape is not a request count. The count against a real server action
  // lives in test/e2e/busy-state.spec.ts and needs the Docker-based stack.
  it("the stylesheet still refuses the pointer on an aria-disabled control", () => {
    // Not merely "the selector is unscoped" (the test above): the
    // DECLARATION. Removing the body of this rule leaves every selector
    // assertion in this file green and reopens the pointer path.
    expect(rules).toMatch(/\[aria-disabled="true"\]\s*\{\s*pointer-events:\s*none;\s*\}/);
  });

  it("the leaf's guard stops the event as well as its default", () => {
    const leaf = sources.find(({ path }) => path.endsWith("platform/ui/submit-button.tsx"));
    expect(leaf?.text).toMatch(/if \(pending\)[\s\S]*?stopPropagation\(\)/);
  });

  it("the transition that drives a busy state has both branches written", () => {
    const form = sources.find(({ path }) =>
      path.endsWith("accounts/ui/account-setup-form.tsx"),
    );
    // Finding HZ-M3P10-04: without the catch, a rejected call never reaches
    // setState and whether the busy state ends is the framework's business.
    expect(form?.text).toMatch(/startTransition\(async \(\) => \{\s*try \{/);
    expect(form?.text).toMatch(/\} catch \(error\) \{/);
  });
});

describe("the busy appearance is not the disabled appearance", () => {
  const selectorLists = rules
    .split("}")
    .map((block) => block.split("{")[0] ?? "")
    .filter((list) => /:disabled|\[aria-disabled="true"\]/.test(list));

  it("every rule that draws the disabled appearance is scoped away from a busy control", () => {
    const unscoped = selectorLists
      .flatMap((list) => list.split(","))
      .map((selector) => selector.trim())
      .filter((selector) => /:disabled|\[aria-disabled="true"\]/.test(selector))
      // The pointer-events refusal is the one disabled rule that MUST also
      // reach a busy control: it is what stops a second pointer activation
      // while the first is in flight, and it takes nothing away visually.
      .filter((selector) => selector !== '[aria-disabled="true"]')
      .filter((selector) => !selector.includes(':where(:not([aria-busy="true"]))'));
    expect(unscoped).toEqual([]);
  });

  it("the mark's box is reserved whenever the attribute is present, not only when it is true", () => {
    expect(stylesheet).toMatch(/\[aria-busy\]::after,\n\.pulse-busy::after \{/);
    expect(stylesheet).toMatch(/--color-busy-mark/);
  });
});
