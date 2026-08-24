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
const REPOSITORY = join(
  SRC,
  "modules",
  "overview",
  "adapters",
  "overview-repository.ts",
);

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

describe("the domain skill records DR-0030 rather than the sentence it superseded", () => {
  // CRITERION 14.10's last clause: the superseded sentence in the always-in-
  // context skill "is corrected in this phase's commit to record DR-0030 and
  // the held state; a grep asserts the superseded sentence is gone".
  //
  // WRITTEN AGAINST WHAT ACTUALLY MATTERS, and a clean-room review is why.
  // The correction is made in the R-087 corrected-in-place style, which
  // QUOTES the old clause in order to say it is false. A grep written to the
  // criterion's letter would therefore be RED against a correctly corrected
  // file, and green against one where the sentence had been silently
  // deleted, which is the outcome R-087 exists to prevent. So this asserts
  // the property the criterion is for: the file records the decision, and the
  // old clause survives only inside a paragraph that marks it as corrected.
  const SKILL = join(
    __dirname,
    "..",
    "..",
    ".claude",
    "skills",
    "pulse-domain",
    "SKILL.md",
  );
  const skill = readFileSync(SKILL, "utf8");
  const SUPERSEDED = "their statements are not imported in v1";

  test("the skill records DR-0030 and the held state", () => {
    expect(skill).toContain("DR-0030");
    expect(skill).toContain("HELD");
    expect(skill).toMatch(/ACCEPTS a reserve account's own statement/i);
  });

  test("the superseded sentence survives only inside a paragraph marked as corrected", () => {
    const occurrences = skill.split(SUPERSEDED).length - 1;
    expect(
      occurrences,
      "the superseded sentence is not quoted at all, so a reader who met it cannot tell it changed",
    ).toBe(1);
    // The quotation sits inside the correction, which is the paragraph that
    // says the clause is FALSE. Asserted by proximity so a future edit that
    // moves the quote out of the correction reddens.
    const at = skill.indexOf(SUPERSEDED);
    const paragraph = skill.slice(Math.max(0, at - 600), at + 600);
    expect(paragraph).toMatch(/CORRECTED, NOT QUIETLY REWRITTEN/);
    expect(paragraph).toContain("FALSE");
  });
});

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
    const repository = readFileSync(REPOSITORY, "utf8");
    expect(repository).toContain('t."flow" IS NOT NULL');
  });

  test("EVERY ONE OF THE THREE READS CARRIES A RING PREDICATE IN ITS OWN WHERE CLAUSE", () => {
    // CORRECTED AFTER BEING SHOWN GREEN AGAINST THE STATE IT FORBIDS
    // (R-037a). This used to assert that the file text CONTAINED the strings
    // "POT_ROW" and "NON_POT_ROW". Both are DEFINED at the top of the file,
    // so the definitions alone satisfied that. Delete "AND ${POT_ROW}" from
    // the WHERE of listGapRows and both identifiers remain defined and
    // remain used elsewhere: the test stayed green, lint stayed green, and
    // the gap listing began handing the screen held rows under a verdict
    // that says the books close, which is hazard H14.19 exactly.
    // Demonstrated, not argued: with that line removed, six of six passed.
    //
    // It now reads each read's OWN body and requires the predicate to be
    // inside it. The bodies are found by the same enclosing-declaration walk
    // the enumeration above uses, so the two cannot drift apart.
    const lines = readFileSync(REPOSITORY, "utf8").split("\n");
    const bodyOf = (name: string): string => {
      const start = lines.findIndex((line) =>
        new RegExp(`^(export )?const ${name}\\b`).test(line),
      );
      expect(start, `${name} is not declared in the repository`).toBeGreaterThan(-1);
      let end = lines.length;
      for (let i = start + 1; i < lines.length; i += 1) {
        if (/^(export )?const \w+\s*[=:]/.test(lines[i] ?? "")) {
          end = i;
          break;
        }
      }
      return lines.slice(start, end).join("\n");
    };

    // Each read, with the predicate its own WHERE must carry. The held read
    // carries the INVERSE, which is the whole reason it can see what the
    // other two must not.
    const expectations = [
      { read: "monthFigures", predicate: "${POT_ROW}" },
      { read: "listGapRows", predicate: "${POT_ROW}" },
      { read: "accountRowCounts", predicate: "NON_POT_ROW" },
    ] as const;

    for (const { read, predicate } of expectations) {
      const body = bodyOf(read);
      expect(
        body.includes(predicate),
        `${read} does not carry ${predicate} in its own body: a read that can see a row with no flow and does not filter by the ring hands the screen rows the verdict has already declared absent`,
      ).toBe(true);
      // And it must be in the WHERE, not merely mentioned: the predicate has
      // to sit after the word WHERE in that same body.
      const where = body.slice(body.search(/\bWHERE\b/));
      expect(
        where.includes(predicate),
        `${read} mentions ${predicate} but not inside its WHERE clause`,
      ).toBe(true);
    }

    // The counted read and the held read share one body, selected by a
    // ternary, so both arms are asserted rather than only the one the
    // enumeration names.
    const shared = bodyOf("accountRowCounts");
    expect(shared).toContain("POT_ROW");
    expect(shared).toContain("NON_POT_ROW");
  });
});
