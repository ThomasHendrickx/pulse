import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

// CRITERION 14.14 CASE FIVE, first assertion, and it is the structural half
// of that criterion: the reads that can see a row with no flow are
// ENUMERATED AGAINST A STATED PATTERN rather than a described one, because
// the answer otherwise depends on the pattern.
//
// WHY BOTH STYLES. This repository writes transaction reads two ways: raw
// SQL in the overview repository, and the Prisma client's where clause in
// the merchants repository. A guard that saw only raw SQL would be blind to
// half of them, so both are matched: the SQL string flow" IS NULL,
// case-insensitively because Postgres accepts lower case, and the client
// form in which the same condition is written as a null flow inside a where.
//
// THE NUMBER OF OCCURRENCES IS NOT THREE AND THIS DOES NOT CLAIM IT IS: the
// gap listing carries two of its own. What is pinned is that every
// occurrence sits inside one of exactly THREE READS.
//
// TWO FURTHER TESTS OF AN ABSENT FLOW EXIST IN TYPESCRIPT RATHER THAN SQL,
// at src/modules/ledger/application/interpret-window.ts and
// src/modules/ledger/domain/reconciliation.ts, and the STATED PATTERN is
// what keeps them out of the count: neither is a database query.

const SRC = join(__dirname, "..", "..", "src");

const collectSources = (dir: string): readonly string[] => {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...collectSources(full));
    } else if (entry.endsWith(".ts") || entry.endsWith(".tsx")) {
      out.push(full);
    }
  }
  return out;
};

// THE THREE READS, by name, never by count over a registry a later phase
// appends to.
const THE_THREE_READS = [
  "the uninterpreted count (monthFigures)",
  "the gap listing (listGapRows)",
  "the held read (accountRowCounts)",
] as const;

type Occurrence = {
  readonly file: string;
  readonly line: number;
  readonly text: string;
  readonly read: (typeof THE_THREE_READS)[number] | "UNCLAIMED";
};

// Which read an occurrence sits in, decided by the nearest preceding
// exported or module-local function declaration, so the mapping is derived
// from the source rather than from a line number that goes stale.
// CORRECTED AFTER BEING SHOWN GREEN AGAINST A FOURTH READ IN RAW SQL
// (R-037a). The first version walked backwards until it found ANY of the
// three names, so a fourth read added anywhere BELOW one of them was
// attributed to it and the guard reported clean. It reddened correctly on
// the Prisma-client member and not on the raw-SQL one, which is exactly the
// shape of a witness that has only been tried one way.
//
// It now stops at the FIRST enclosing top-level declaration and asks whether
// THAT is one of the three, so an occurrence can only be claimed by the
// function it is actually inside.
const NAMES: Readonly<Record<string, Occurrence["read"]>> = {
  monthFigures: "the uninterpreted count (monthFigures)",
  listGapRows: "the gap listing (listGapRows)",
  accountRowCounts: "the held read (accountRowCounts)",
};

const readContaining = (
  lines: readonly string[],
  index: number,
): Occurrence["read"] => {
  for (let i = index; i >= 0; i -= 1) {
    const match = /^(?:export )?const (\w+)\s*[=:]/.exec(lines[i] ?? "");
    if (match === null) {
      continue;
    }
    const name = match[1] ?? "";
    return NAMES[name] ?? "UNCLAIMED";
  }
  return "UNCLAIMED";
};

// THE PATTERN IS SCOPED TO adapters/, AND THAT IS A REAL BOUNDARY RATHER
// THAN A CONVENIENCE. Adapters are the only layer permitted to reach the
// database in this codebase, and that is not a convention: it is held by
// test/schema/tenancy.test.ts, which fails closed on any repository export
// that does not take a household context and is what stops a query from
// growing outside this directory. A query written elsewhere would redden
// there before it reached here.
//
// WHY THE SCOPING IS NEEDED AT ALL, recorded because the first version of
// this test did not have it and went red for a reason worth keeping: the
// Prisma-client form of the CONDITION, `flow: null` inside a where, is
// written identically to the null-flow WRITE that M3-P15 adds to
// interpret-window.ts to CLEAR a held row's interpretation. One is a query
// and one is an assignment, and no line-level pattern tells them apart. The
// layer does.
const isAdapter = (file: string): boolean =>
  file.includes(`${"/"}adapters${"/"}`);

const occurrences: Occurrence[] = [];
for (const file of collectSources(SRC)) {
  const lines = readFileSync(file, "utf8").split("\n");
  for (const [index, line] of lines.entries()) {
    // Pattern one: the SQL string, case-insensitively.
    const sql = /flow"\s+is\s+null/i.test(line);
    // Pattern two: the Prisma client form, a null flow inside a where.
    const client = isAdapter(file) && /\bflow\s*:\s*null\b/.test(line);
    if (!sql && !client) {
      continue;
    }
    // A COMMENT IS NOT A QUERY. The stated pattern is a test for an absent
    // flow IN A DATABASE QUERY, and this file's own prose mentions the
    // condition repeatedly.
    const trimmed = line.trim();
    if (
      trimmed.startsWith("//") ||
      trimmed.startsWith("*") ||
      trimmed.startsWith("/*")
    ) {
      continue;
    }
    occurrences.push({
      file: file.slice(SRC.length + 1),
      line: index + 1,
      text: trimmed,
      read: readContaining(lines, index),
    });
  }
}

describe("every read that can see a row with no flow is one of exactly three", () => {
  test("the enumeration finds occurrences at all, so a broken walk cannot pass by finding nothing", () => {
    expect(occurrences.length).toBeGreaterThan(0);
  });

  test("every occurrence sits in one of the three named reads, and a fourth read fails this wherever and however it is written", () => {
    const unclaimed = occurrences.filter(
      (occurrence) => occurrence.read === "UNCLAIMED",
    );
    expect(
      unclaimed,
      `an absent-flow database condition outside the three named reads: ${JSON.stringify(unclaimed)}`,
    ).toEqual([]);
  });

  test("all three reads are present, asserted BY NAME and never by a count", () => {
    const found = new Set(occurrences.map((occurrence) => occurrence.read));
    for (const read of THE_THREE_READS) {
      expect(found.has(read), `${read} has no absent-flow condition`).toBe(true);
    }
  });

  test("the two TypeScript tests of an absent flow are NOT database queries, and the stated pattern keeps them out", () => {
    // Named so a reader can check the claim rather than trust it.
    const outsiders = [
      join(SRC, "modules", "ledger", "application", "interpret-window.ts"),
      join(SRC, "modules", "ledger", "domain", "reconciliation.ts"),
    ];
    for (const file of outsiders) {
      const text = readFileSync(file, "utf8");
      // Each really does test for an absent flow ...
      expect(/flow === undefined|flow === null|!flow/.test(text)).toBe(true);
      // ... and neither writes the condition as SQL.
      expect(/flow"\s+is\s+null/i.test(text)).toBe(false);
      // Neither is under adapters/, which is what keeps the Prisma-client
      // form out of the enumeration.
      expect(isAdapter(file)).toBe(false);
    }
  });

  test("interpret-window carries a null-flow WRITE and it is deliberately not a read", () => {
    // Said as an assertion rather than left implied, because this is the
    // one line in the tree that looks exactly like the Prisma-client form
    // of the condition and is not one. It is the CLEARING write that puts a
    // row on a non-pot account into the held state (M3-P15 step 4), and it
    // is why the enumeration above is scoped to the adapter layer.
    const text = readFileSync(
      join(SRC, "modules", "ledger", "application", "interpret-window.ts"),
      "utf8",
    );
    expect(text).toContain("flow: null");
    expect(text).toContain("heldIds.map");
  });

  test("the counted read carries NO absent-flow condition, which is why it is correctly absent from this enumeration", () => {
    // Criterion 14.15 needs a counted read as well as a held read, and the
    // two do different work. The counted read is rows WITH a flow on pot
    // accounts, so it widens nothing here. Stated as an assertion rather
    // than as a sentence, because a sentence claiming a guard covers
    // something it does not is worse than no guard.
    const repository = readFileSync(
      join(SRC, "modules", "overview", "adapters", "overview-repository.ts"),
      "utf8",
    );
    expect(repository).toContain('t."flow" IS NOT NULL');
    // And the ring predicate is on it, which is NOT made redundant by the
    // flow condition: a row outside the pot that still carries a flow is
    // the clearing-that-missed-a-row state, and without the restriction
    // this read would report it as counted money.
    expect(repository).toContain("NON_POT_ROW");
    expect(repository).toContain("POT_ROW");
  });
});
