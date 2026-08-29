import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// THE CLIENT BOUNDARY GUARD (M3-P10, criterion 10.6(e)).
//
// WHY A CLOSURE WALK AND NOT A GREP. A grep for the "use client" directive
// counts client FILES, not client MODULES. In this framework a module
// imported by a client file joins the client bundle without carrying the
// directive itself, so a leaf that imports a shared helper which itself
// imports a domain module ships that module to the browser and every
// file-level check sees nothing. This walks the closure instead.
//
// THE FIVE RULES, because a walk that passes by failing to look is a green
// and worthless guard:
//  1. It follows `export ... from` RE-EXPORTS as well as `import` and
//     `import type`, because this repository publishes every module through
//     a barrel and a walk that follows only imports stops at the first one.
//  2. It follows ONLY relative specifiers and specifiers beginning "@/". A
//     bare package specifier (react, next/link) is RECORDED and not entered.
//  3. It resolves an extensionless specifier by trying .ts, then .tsx, then
//     /index.ts.
//  4. It FAILS on any specifier it cannot resolve rather than skipping it,
//     because a walk that skips what it cannot read reports a clean closure
//     for a tree it never opened.
//  5. TYPE-ONLY IMPORTS COUNT. Decision D-23's rule is that no domain type
//     crosses the boundary, so `import type` from a forbidden path fails
//     exactly as a value import does.
//
// THE SIXTH RULE, ADDED BY M3-P10 AND NOT IN THE PLAN'S FOUR, with its
// reason, because it is the one that decides whether the accounts screen
// passes. A module whose own first directive is "use server" is a SERVER
// ACTION module: the bundler never includes its body in a client bundle,
// and a client file importing one receives a reference stub. It is
// therefore recorded as a boundary and NOT entered, on exactly the same
// terms as a bare package specifier. Without this rule the walk would
// follow src/modules/accounts/ui/actions.ts into the accounts application
// layer and report a domain leak that does not exist in any bundle.
// WHAT THIS COSTS, stated rather than left to be found: a "use server"
// module that is ALSO imported for a value that is not an action would slip
// through. Nothing in the tree does that today; the assertion below pins
// which modules are treated as action boundaries so a new one is visible.

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..", "..");
const src = join(root, "src");

const FORBIDDEN = [
  /^src\/modules\/[^/]+\/application\//,
  /^src\/modules\/[^/]+\/domain\//,
  /^src\/modules\/[^/]+\/adapters\//,
  /^src\/platform\/auth\//,
];

const walkFiles = (dir: string): readonly string[] =>
  readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    return statSync(full).isDirectory()
      ? walkFiles(full)
      : /\.(ts|tsx)$/.test(full)
        ? [full]
        : [];
  });

const directive = (text: string, name: string): boolean =>
  new RegExp(`^\\s*(?:\\/\\/[^\\n]*\\n|\\/\\*[\\s\\S]*?\\*\\/\\s*)*["']${name}["']`).test(
    text,
  );

// Every `from "..."` on an import or an export-from line, plus bare side
// effect imports. A regex over specifiers is all this needs and it adds no
// package: the only path mapping tsconfig declares is "@/*" -> "./src/*".
// MULTI-LINE IMPORTS COUNT, and this is a correction of a defect this file
// shipped with for one run (clause R-087). The first version bounded the
// match with [^\n;]*?, so it matched only single-line imports and MISSED
// the multi-line one in src/modules/accounts/ui/account-setup-form.tsx,
// which is exactly the specifier the accounts island reaches its actions
// through. A walk that silently skips a specifier is the green and
// worthless guard rule 4 exists against, and it reported a clean closure
// while never opening that edge. The bound is now the statement terminator
// rather than the line break: an import statement carries no ";" before its
// "from", and a non-import "export" statement carries one before any later
// "from" in the file.
const SPECIFIER =
  /^[ \t]*(?:import|export)\b[^;]*?\bfrom\s*["']([^"']+)["']|^[ \t]*import\s*["']([^"']+)["']/gm;

const specifiersOf = (text: string): readonly string[] => {
  const out: string[] = [];
  for (const match of text.matchAll(SPECIFIER)) {
    const specifier = match[1] ?? match[2];
    if (specifier !== undefined) {
      out.push(specifier);
    }
  }
  return out;
};

const resolveSpecifier = (fromFile: string, specifier: string): string => {
  const base = specifier.startsWith("@/")
    ? join(src, specifier.slice(2))
    : resolve(dirname(fromFile), specifier);
  for (const candidate of [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    join(base, "index.ts"),
    join(base, "index.tsx"),
  ]) {
    try {
      if (statSync(candidate).isFile()) {
        return candidate;
      }
    } catch {
      // try the next candidate
    }
  }
  throw new Error(
    `unresolvable specifier ${specifier} from ${relative(root, fromFile)}`,
  );
};

type Closure = {
  readonly entered: readonly string[];
  readonly externals: readonly string[];
  readonly actionBoundaries: readonly string[];
};

const closureOf = (entries: readonly string[]): Closure => {
  const entered: string[] = [];
  const externals = new Set<string>();
  const actionBoundaries = new Set<string>();
  const queue = [...entries];
  const seen = new Set<string>(entries);
  while (queue.length > 0) {
    const file = queue.shift() as string;
    entered.push(file);
    const text = readFileSync(file, "utf8");
    for (const specifier of specifiersOf(text)) {
      if (!specifier.startsWith(".") && !specifier.startsWith("@/")) {
        externals.add(specifier);
        continue;
      }
      const target = resolveSpecifier(file, specifier);
      if (directive(readFileSync(target, "utf8"), "use server")) {
        actionBoundaries.add(relative(root, target));
        continue;
      }
      if (!seen.has(target)) {
        seen.add(target);
        queue.push(target);
      }
    }
  }
  return { entered, externals: [...externals].sort(), actionBoundaries: [...actionBoundaries].sort() };
};

describe("the client boundary", () => {
  const clientFiles = walkFiles(src).filter((file) =>
    directive(readFileSync(file, "utf8"), "use client"),
  );

  it("is opened by files that are named rather than counted", () => {
    // ASSERTED BY NAME AND NOT BY COUNT: a pinned count is a claim about
    // every future phase and it is false the moment the next one appends.
    expect(clientFiles.map((file) => relative(root, file)).sort()).toEqual([
      // M3-P11 adds the predicted merchant row (DR-0025) and the
      // hand-built toast under it (DR-0026). The row leaf reaches its
      // server action through a PROP bound by the server component, not an
      // import, so no new action boundary appears in the closure below.
      "src/modules/accounts/ui/account-setup-form.tsx",
      "src/modules/merchants/ui/merchant-row.tsx",
      "src/platform/ui/link-pending.tsx",
      "src/platform/ui/nav-link.tsx",
      "src/platform/ui/submit-button.tsx",
      "src/platform/ui/toast.tsx",
    ]);
  });

  it("reaches no application, domain, adapter or auth module, transitively", () => {
    const closure = closureOf(clientFiles);
    const leaks = closure.entered
      .map((file) => relative(root, file))
      .filter((path) => FORBIDDEN.some((pattern) => pattern.test(path)));
    expect(leaks).toEqual([]);
  });

  it("imports no household context type", () => {
    const closure = closureOf(clientFiles);
    for (const file of closure.entered) {
      expect(readFileSync(file, "utf8")).not.toMatch(/["']@\/platform\/tenancy["']/);
    }
  });

  it("records the packages and the action modules it did not enter", () => {
    const closure = closureOf(clientFiles);
    expect(closure.externals).toEqual(["next/link", "next/navigation", "react", "react-dom"]);
    expect(closure.actionBoundaries).toEqual(["src/modules/accounts/ui/actions.ts"]);
  });
});
