import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { stripComments } from "../support/strip-comments";

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
  "the held read (heldAccountRows)",
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
  heldAccountRows: "the held read (heldAccountRows)",
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

  test("EVERY ONE OF THE THREE READS CARRIES A RING PREDICATE IN ITS OWN WHERE CLAUSE, AND SO DOES THE COUNTED READ", () => {
    // CORRECTED THREE TIMES NOW, AND EVERY CORRECTION IS RECORDED RATHER
    // THAN THE WORDING REPLACED (R-087), because twice the comment above
    // this test asserted a property the test did not have.
    //
    // ROUND ONE: it asserted the file text CONTAINED "POT_ROW" and
    // "NON_POT_ROW". Both are DEFINED at the top of the file, so the
    // definitions alone satisfied it and every read could lose its filter.
    //
    // ROUND TWO: the rewrite that replaced it claimed two further things
    // that were also false, and a clean-room lane broke it three ways with
    // the whole fast gate green:
    //   ONE. "both arms are asserted" was false. POT_ROW is a LITERAL
    //     SUBSTRING of NON_POT_ROW, so `toContain("POT_ROW")` was satisfied
    //     by the held arm's own predicate and no edit to the counted arm
    //     could ever redden it. The counted read could lose its ring
    //     restriction entirely (hazard H14.21) with 489 of 489 green.
    //   TWO. It had no comment-stripping pass. A predicate deleted from a
    //     WHERE and left on a SQL double-hyphen comment line inside the
    //     template is not applied by Postgres, and the guard still saw the
    //     token (hazard H14.19).
    //   THREE. It located the WHERE by the first occurrence of the word, and
    //     the FIRST match inside monthFigures is a FILTER (WHERE ...) in the
    //     SELECT list, so "inside the WHERE" degenerated to "anywhere in the
    //     query" and the predicate could be moved into an aggregate filter
    //     (hazards H14.10 and H14.14).
    //
    // ROUND THREE, THIS ROUND, IS NOT A CORRECTION OF A FALSE CLAIM. The
    // counted read and the held read USED TO SHARE ONE FUNCTION BODY and
    // chose their predicate with a ternary, which is why round two had to
    // assert that ternary's own spelling to reach the counted arm at all.
    // Criterion 14.15 witness SEVEN made the held read return ROWS while the
    // counted read still returns a COUNT, so they are two functions now and
    // each is asserted on its OWN row filter. That is strictly stronger: the
    // counted arm no longer depends on a regular expression matching one
    // spelling of a ternary, and a counted read rewritten in any shape at
    // all still has to carry POT_ROW in the WHERE that follows its FROM.
    //
    // WHAT IT DOES NOW, and each clause exists because one of those states
    // defeated a previous version:
    //   - comments are stripped first, by the shared string-aware and
    //     SQL-aware scanner in test/support/strip-comments.ts;
    //   - the WHERE is the one that FOLLOWS the FROM, never a FILTER's;
    //   - POT_ROW is matched as a TOKEN, so NON_POT_ROW cannot satisfy it;
    //   - the counted read is asserted on its own body, and it is asserted
    //     to carry POT_ROW and NOT to carry NON_POT_ROW, so swapping the two
    //     reads' predicates reddens rather than passing.
    const source = stripComments(readFileSync(REPOSITORY, "utf8"));
    const lines = source.split("\n");
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

    // THE QUERY'S OWN WHERE, not an aggregate's. Every read here is a single
    // flat SELECT whose row filter follows FROM "transactions" t; the FILTER
    // (WHERE ...) forms all sit in the SELECT list ahead of it.
    const rowFilterOf = (read: string, body: string): string => {
      const from = body.search(/\bFROM\b/);
      expect(from, `${read} has no FROM clause`).toBeGreaterThan(-1);
      const after = body.slice(from);
      const where = after.search(/\bWHERE\b/);
      expect(where, `${read} has no WHERE clause after its FROM`).toBeGreaterThan(-1);
      return after.slice(where);
    };

    // POT_ROW as a TOKEN. The negative lookbehind is the whole point: without
    // it, NON_POT_ROW satisfies a search for POT_ROW.
    const POT_TOKEN = /(?<![A-Z_])POT_ROW\b/;
    const NON_POT_TOKEN = /\bNON_POT_ROW\b/;

    const expectations = [
      { read: "monthFigures", pattern: POT_TOKEN, label: "POT_ROW" },
      { read: "listGapRows", pattern: POT_TOKEN, label: "POT_ROW" },
      { read: "heldAccountRows", pattern: NON_POT_TOKEN, label: "NON_POT_ROW" },
      // THE COUNTED READ. It carries no absent-flow condition, so it is
      // correctly absent from the enumeration above and its ring restriction
      // has no other guard anywhere in the fast gate. Losing it is hazard
      // H14.21, which a clean-room lane constructed with the whole fast gate
      // green (finding CR-P14C2-01 witness ONE).
      { read: "countedAccountRows", pattern: POT_TOKEN, label: "POT_ROW" },
    ] as const;

    for (const { read, pattern, label } of expectations) {
      const body = bodyOf(read);
      const rowFilter = rowFilterOf(read, body);
      expect(
        pattern.test(rowFilter),
        `${read} does not carry ${label} in the WHERE that follows its FROM: a read that can see a row with no flow and does not filter by the ring hands the screen rows the verdict has already declared absent`,
      ).toBe(true);
    }

    // THE TWO RINGS ARE NOT INTERCHANGEABLE, asserted from the other side as
    // well rather than left implied. POT_TOKEN's lookbehind already refuses
    // to match NON_POT_ROW, so a counted read whose predicate was SWAPPED
    // reddens above; this says the same thing forwards, so a reader can check
    // the claim instead of deriving it from a lookbehind.
    expect(
      NON_POT_TOKEN.test(
        rowFilterOf("countedAccountRows", bodyOf("countedAccountRows")),
      ),
      "the counted read carries NON_POT_ROW in its row filter: the two reads' ring predicates are complementary and the counted one is rows on POT accounts",
    ).toBe(false);
    expect(
      POT_TOKEN.test(rowFilterOf("heldAccountRows", bodyOf("heldAccountRows"))),
      "the held read carries a bare POT_ROW in its row filter: the held state is rows on accounts OUTSIDE the pot",
    ).toBe(false);

    // AND THE HELD READ RETURNS ROWS RATHER THAN AN AGGREGATE, which
    // criterion 14.15 witness SEVEN depends on: the entry renders each held
    // row's own amount, and a COUNT could carry none. Asserted on the body so
    // an edit that folds it back to a count reddens here rather than
    // silently emptying the one screen state DR-0030 is paying for.
    expect(
      /COUNT\(\*\)/.test(bodyOf("heldAccountRows")),
      "the held read aggregates: criterion 14.15 witness SEVEN renders each held row's descriptor and its own amount, which a count cannot carry",
    ).toBe(false);
    expect(bodyOf("heldAccountRows")).toContain('t."amountCents"');
  });

  test("the ring-predicate guard reddens on each of the three states that defeated it, asserted here rather than assumed", () => {
    // POINTED AT ITS OWN TARGET, in the file. Each sample is a row filter in
    // one of the shapes a clean-room lane used to defeat the previous
    // version, and each must be judged UNSAFE by the same predicates the
    // test above uses. The last two must be judged SAFE, so the guard is not
    // simply refusing everything.
    const POT_TOKEN = /(?<![A-Z_])POT_ROW\b/;
    const unsafe = [
      // ONE: the counted read loses its ring restriction entirely, which is
      // hazard H14.21. Under the shared-body shape this state was invisible,
      // because POT_ROW is a substring of NON_POT_ROW and the held arm's own
      // predicate satisfied a search for it; the reads are two functions now,
      // so the counted read's own row filter carries no POT_ROW token at all.
      'WHERE t."householdId" = $1 AND t."flow" IS NOT NULL AND t."bookingDate" >= $2',
      // ONE-B, a structurally different member of the same class: the
      // restriction is not removed but SWAPPED for the other ring, so the
      // counted read would report a held row to the household as counted
      // money on the one screen state built to tell counted from held.
      'WHERE t."householdId" = $1 AND ${NON_POT_ROW} AND t."flow" IS NOT NULL',
      // TWO: the predicate survives only on a SQL comment line. Written
      // inside a template literal because that is where this codebase's SQL
      // lives, and the stripper's SQL rule is scoped to templates.
      stripComments(
        "const q = Prisma.sql`WHERE t.\"householdId\" = $1\n  -- used to read AND ${POT_ROW} here\n`;",
      ),
    ];
    for (const sample of unsafe) {
      expect(
        POT_TOKEN.test(sample),
        `the guard's own POT_ROW token still matches a state it must refuse: ${sample}`,
      ).toBe(false);
    }
    // THREE is about WHERE the token sits, not whether it is present, so it
    // is asserted against the row-filter rule rather than the token rule: a
    // predicate moved into a SELECT-list FILTER is not in the WHERE that
    // follows FROM, and slicing from FROM is what makes that visible.
    const movedIntoAggregate = [
      'SELECT COUNT(*) FILTER (WHERE t."flow" IS NOT NULL AND ${POT_ROW})',
      'FROM "transactions" t',
      'WHERE t."householdId" = $1',
      '  AND t."bookingDate" >= $2',
    ].join("\n");
    const rowFilter = movedIntoAggregate.slice(
      movedIntoAggregate.search(/\bFROM\b/),
    );
    expect(
      POT_TOKEN.test(rowFilter),
      "slicing from FROM still finds POT_ROW after it was moved into a SELECT-list aggregate filter, which is the state hazards H14.10 and H14.14 name",
    ).toBe(false);
    expect(
      POT_TOKEN.test(movedIntoAggregate),
      "the sample must carry the token somewhere, or this case proves nothing",
    ).toBe(true);

    const safe = [
      'WHERE t."householdId" = $1 AND ${POT_ROW} AND t."bookingDate" >= $2',
      'WHERE t."householdId" = $1 AND ${ring === "counted" ? POT_ROW : NON_POT_ROW}',
    ];
    for (const sample of safe) {
      expect(
        POT_TOKEN.test(sample),
        `the guard refuses a correct row filter: ${sample}`,
      ).toBe(true);
    }
  });
});
