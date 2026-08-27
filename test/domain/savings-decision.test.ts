import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

// M3-P18, DR-0030. Two static sweeps, both over the source TEXT because
// what they pin is wiring rather than behaviour:
//
//   1. Criterion 18.1: the account-in-savings-ring refusal is gone ROOT
//      AND BRANCH. A dead reason left wired in the union, the routing,
//      the whitelist, the SETUP_LINKED membership or a catalogue is the
//      cheapest way for the refusal to come back, and the compiler
//      catching a stale set member is an accident of the
//      KnownImportStatus generic that no criterion may lean on.
//
//   2. Criterion 18.3: EXACTLY TWO reads test for an absent flow in a
//      database query, both scoped by the account's ring, and no third
//      occurrence appears. The held read is correctly absent from this
//      enumeration because it carries NO flow condition at all; a held
//      read written as an absent flow on an account outside the pot IS a
//      third occurrence and fails here.
//
// The ring scoping itself is SQL and a test over source text cannot
// prove SQL semantics; the behavioural witness runs in the slow gate
// (test/e2e/held-and-gap-rows.spec.ts) against the real repository.

const ROOT = join(__dirname, "..", "..");

const walk = (dir: string): readonly string[] => {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      out.push(...walk(path));
    } else if (/\.(ts|tsx)$/.test(entry)) {
      out.push(path);
    }
  }
  return out;
};

const sourceFiles = (): readonly string[] => walk(join(ROOT, "src"));

describe("the savings-ring refusal is gone root and branch (criterion 18.1)", () => {
  test("no source file and no catalogue carries the refusal reason or its key", () => {
    const offenders: string[] = [];
    for (const file of sourceFiles()) {
      const text = readFileSync(file, "utf-8");
      // The refusal REASON may survive only in comments that record its
      // removal; a QUOTED occurrence (string literal) is the wired form.
      if (/["']account-in-savings-ring["']/.test(text)) {
        offenders.push(file);
      }
      if (/AccountInSavingsRing/.test(text)) {
        offenders.push(file);
      }
    }
    for (const catalogue of ["en", "nl", "fr"]) {
      const text = readFileSync(
        join(ROOT, "messages", `${catalogue}.json`),
        "utf-8",
      );
      if (text.includes("importAccountInSavingsRing")) {
        offenders.push(`messages/${catalogue}.json`);
      }
    }
    expect(offenders).toEqual([]);
  });

  test("the three superseded sentences are gone from the domain skill", () => {
    const skill = readFileSync(
      join(ROOT, ".claude", "skills", "pulse-domain", "SKILL.md"),
      "utf-8",
    );
    expect(skill).not.toContain("registered for their IBAN only");
    expect(skill).not.toContain("Their statements are not imported in v1");
    expect(skill).not.toContain(
      "A reserve movement is classified entirely from the pot side",
    );
    // And the corrected paragraph states what the product now does.
    expect(skill).toContain("DR-0030");
    expect(skill).toContain("marked HELD");
  });
});

describe("both null-flow reads are ring-scoped and no third exists (criterion 18.3)", () => {
  // The three arms of the sweep, stated as patterns because the pinned
  // literal is one of several texts for one condition:
  //   a. the SQL string form: "flow" IS NULL (case-insensitive; IS NOT
  //      NULL is a test for a PRESENT flow and is not counted),
  //   b. a SQL COALESCE over the flow column compared to a sentinel,
  //   c. the Prisma client form in all its spellings: a bare null, an
  //      equals-null object, and an in-list carrying null.
  const absentFlowSql = /"flow"\s+IS\s+NULL/gi;
  const coalesceFlow = /COALESCE\s*\(\s*t?\.?"?flow"?\s*,/gi;
  const prismaNull =
    /flow:\s*(null|\{\s*equals:\s*null|\{\s*(in|notIn):\s*\[[^\]]*null)/g;

  test("the SQL absent-flow occurrences are exactly the two reads, each ring-scoped", () => {
    const hits: { file: string; line: string }[] = [];
    for (const file of sourceFiles()) {
      const text = readFileSync(file, "utf-8");
      for (const line of text.split("\n")) {
        if (absentFlowSql.test(line)) {
          hits.push({ file: file.slice(ROOT.length + 1), line: line.trim() });
        }
        absentFlowSql.lastIndex = 0;
      }
    }
    // Exactly three textual occurrences, all in the overview repository:
    // the uninterpreted COUNT, listGapRows' CASE label, and listGapRows'
    // WHERE arm. Asserted BY NAME over the lines, never by count alone.
    expect(
      hits.every(
        (hit) =>
          hit.file === "src/modules/overview/adapters/overview-repository.ts",
      ),
    ).toBe(true);
    const countLine = hits.find((hit) =>
      hit.line.includes("uninterpretedCount"),
    );
    const whereLine = hits.find((hit) => hit.line.startsWith("("));
    const caseLine = hits.find((hit) => hit.line.startsWith("WHEN"));
    expect(countLine).toBeDefined();
    expect(whereLine).toBeDefined();
    expect(caseLine).toBeDefined();
    expect(hits).toHaveLength(3);
    // BOTH reads are scoped by the account's RING, on the same predicate
    // (never by dropping the null-flow condition, finding CR-502):
    expect(countLine?.line).toMatch(
      /"flow"\s+IS\s+NULL\s+AND\s+a\."role"\s*=\s*'POT'/i,
    );
    expect(whereLine?.line).toMatch(
      /"flow"\s+IS\s+NULL\s+AND\s+a\."role"\s*=\s*'POT'/i,
    );
    // The CASE arm only LABELS a row the ring-scoped WHERE admitted; the
    // admission is the WHERE line above.
  });

  test("no COALESCE-to-sentinel form and no Prisma null form tests an absent flow", () => {
    const offenders: string[] = [];
    for (const file of sourceFiles()) {
      const text = readFileSync(file, "utf-8");
      if (coalesceFlow.test(text)) {
        offenders.push(`${file}: coalesce-over-flow`);
      }
      coalesceFlow.lastIndex = 0;
      if (prismaNull.test(text)) {
        offenders.push(`${file}: prisma-null-flow`);
      }
      prismaNull.lastIndex = 0;
    }
    expect(offenders).toEqual([]);
  });

  test("the held read carries no flow condition at all", () => {
    const repository = readFileSync(
      join(
        ROOT,
        "src",
        "modules",
        "overview",
        "adapters",
        "overview-repository.ts",
      ),
      "utf-8",
    );
    const start = repository.indexOf("export const listHeldRows");
    const end = repository.indexOf("const parseGapKind");
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const heldRead = repository.slice(start, end);
    // Keyed on the RING alone: any "flow" in the held read's SQL or
    // mapping would make it a third null-flow read, which criterion 18.3
    // forbids by name.
    expect(heldRead).not.toMatch(/"flow"/);
    expect(heldRead).toMatch(/a\."role"\s*=\s*'RESERVE'/);
    // And NOTHING IS SUMMED (decision D-60): no aggregate over the
    // amount column in the held read.
    expect(heldRead).not.toMatch(/SUM\s*\(/i);
  });
});
