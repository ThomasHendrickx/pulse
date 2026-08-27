import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { formatCollisionGroups } from "../../scripts/detect-account-collisions";
import { ACCOUNT_NUMBER_SQL_WHITESPACE_CLASS } from "../../src/platform/account-number";

// M3-P18, criterion 18.4 arm one and criterion 18.5's wiring pins, at the
// only level the fast gate can see: the committed TEXT of the migration
// and the detection script. What text cannot prove (that the SQL mirror
// agrees with canonicalAccountNumber over real renderings, that the
// migration completes over the collision pair, that the door opens) runs
// in the slow gate against a real database
// (test/e2e/canonical-backfill.spec.ts).

const ROOT = join(__dirname, "..", "..");

const migrationSql = (): string =>
  readFileSync(
    join(
      ROOT,
      "prisma",
      "schema",
      "migrations",
      "20260827120000_canonical_account_iban_backfill",
      "migration.sql",
    ),
    "utf-8",
  );

// The statements alone, with SQL comments stripped, so a table name
// inside a comment cannot satisfy or fail an assertion about what the
// migration TOUCHES.
const statements = (): string =>
  migrationSql()
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("--"))
    .join("\n");

describe("the canonical backfill touches only the declaration (criterion 18.4)", () => {
  test("only the accounts table is written, and no transaction column appears", () => {
    const sql = statements();
    // Exactly one statement kind: UPDATE of "accounts". A migration that
    // is already rewriting one column is one WHERE clause away from
    // rewriting another (hazard H18.5), so anything beyond the one UPDATE
    // fails here by name.
    expect(sql).toMatch(/UPDATE\s+"accounts"/);
    expect(sql).not.toMatch(/"transactions"/);
    expect(sql).not.toMatch(/counterparty/i);
    expect(sql).not.toMatch(/\b(INSERT|DELETE|DROP|ALTER|TRUNCATE)\b/i);
    // One UPDATE and nothing else.
    expect(sql.match(/\bUPDATE\b/gi)).toHaveLength(1);
  });

  test("the expression is the SQL mirror of the canonical form, the ONE shared whitespace class inlined", () => {
    const sql = statements();
    // CORRECTED IN THE M3-P18 FIX ROUND (hazard finding HZ-M3P18-01):
    // this pin used to hold the migration to bare [[:space:]], which
    // retains U+00A0, U+202F and U+FEFF where the platform \s strips
    // them. The migration cannot import, so it INLINES the class; this
    // assertion is what keeps the inlined copy byte-equal to
    // ACCOUNT_NUMBER_SQL_WHITESPACE_CLASS at the mechanism's definition.
    // Executable equivalence with canonicalAccountNumber over renderings
    // carrying the divergent characters is the slow-gate spec's arm.
    expect(sql).toContain(
      `upper(regexp_replace(a."iban", '${ACCOUNT_NUMBER_SQL_WHITESPACE_CLASS}', '', 'g'))`,
    );
    // And no site in the migration falls back to the bare POSIX class.
    expect(sql).not.toContain(`'[[:space:]]'`);
    // Canonicalisation is applied WITHOUT validation (findings P14-006,
    // P17-004): no validity machinery may appear in the migration.
    expect(sql).not.toMatch(/mod97|checksum|valid/i);
  });

  test("the shared SQL whitespace class enumerates exactly the JavaScript whitespace set", () => {
    // The class is parsed from its own text: the POSIX [[:space:]] head
    // contributes the six ASCII members, then every visible ARE escape,
    // single or range. The expected set is DERIVED by sweeping every
    // Unicode code point through the same regex canonicalAccountNumber
    // uses, so this test reddens if either side ever drifts: a character
    // \s gains, a character the class loses, or a typo in an escape.
    const body = ACCOUNT_NUMBER_SQL_WHITESPACE_CLASS;
    expect(body.startsWith("[[:space:]")).toBe(true);
    expect(body.endsWith("]")).toBe(true);
    const classSet = new Set<number>([9, 10, 11, 12, 13, 32]);
    for (const match of body.matchAll(
      /\\u([0-9a-f]{4})(?:-\\u([0-9a-f]{4}))?/g,
    )) {
      const from = parseInt(match[1] ?? "", 16);
      const to = match[2] === undefined ? from : parseInt(match[2], 16);
      for (let code = from; code <= to; code += 1) {
        classSet.add(code);
      }
    }
    const jsSet = new Set<number>();
    for (let code = 0; code <= 0x10ffff; code += 1) {
      if (code >= 0xd800 && code <= 0xdfff) {
        continue;
      }
      if (/\s/u.test(String.fromCodePoint(code))) {
        jsSet.add(code);
      }
    }
    expect([...classSet].sort((a, b) => a - b)).toEqual(
      [...jsSet].sort((a, b) => a - b),
    );
    // The named divergent characters the hazard lane witnessed are in
    // the class, and U+200B, which \s does not match, is not.
    expect(classSet.has(0x00a0)).toBe(true);
    expect(classSet.has(0x202f)).toBe(true);
    expect(classSet.has(0xfeff)).toBe(true);
    expect(classSet.has(0x200b)).toBe(false);
  });

  test("the collision pair is excluded first and null numbers are untouched", () => {
    const sql = statements();
    expect(sql).toMatch(/NOT EXISTS/);
    expect(sql).toMatch(/a\."iban"\s+IS\s+NOT\s+NULL/);
    // Idempotence lives in the IS DISTINCT FROM filter: a second run
    // matches nothing.
    expect(sql).toMatch(/IS DISTINCT FROM/);
  });
});

describe("the detection script's selection and wiring (criterion 18.5, findings R2-M3P18-01 and R2-M3P18-02)", () => {
  const scriptSource = (): string =>
    readFileSync(join(ROOT, "scripts", "detect-account-collisions.ts"), "utf-8");

  test("the selection GROUPS by canonical form and emits groups of two or more", () => {
    const source = scriptSource();
    // R2-M3P18-01: a grouping over ALL rows, never a not-canonical
    // filter, because the compact member of a pair IS stored canonically
    // and a not-canonical filter can never emit a complete pair.
    expect(source).toMatch(/GROUP BY\s+a\."householdId",\s*upper\(regexp_replace/);
    expect(source).toMatch(/HAVING count\(\*\) > 1/);
    // Row ids and nothing else reach the output: the SELECT list is one
    // aggregate over the id column.
    expect(source).toMatch(/SELECT array_agg\(a\."id"::text ORDER BY a\."id"\) AS "ids"/);
    expect(source).not.toMatch(/SELECT[^\n]*"iban"/);
    // The grouping strips the ONE shared whitespace class, bound as a
    // parameter, never a local copy and never the bare POSIX class
    // (M3-P18 fix round, hazard finding HZ-M3P18-01).
    expect(source).toMatch(
      /regexp_replace\(a\."iban", \$\{ACCOUNT_NUMBER_SQL_WHITESPACE_CLASS\}, '', 'g'\)/,
    );
    expect(source).not.toContain(`'[[:space:]]'`);
  });

  test("the guard wiring is the surviving contract only (D-62)", () => {
    const source = scriptSource();
    expect(source).toMatch(/from "\.\.\/src\/platform\/db\/guard"/);
    expect(source).toMatch(/from "\.\.\/src\/platform\/db\/resolve-env"/);
    expect(source).toContain("assessNonProductionDbTarget");
    expect(source).toContain("resolveClientDbUrl");
    // The withdrawn modules may be NAMED in the comment that records their
    // withdrawal, but never imported: no import specifier resolves to any
    // of them.
    expect(source).not.toMatch(
      /from\s+"[^"]*(target-guard|runtime-target|gate-target|connection-string)[^"]*"/,
    );
  });

  test("the output format is one line per group, row ids space separated", () => {
    expect(
      formatCollisionGroups([
        { ids: ["row-a", "row-b"] },
        { ids: ["row-c", "row-d", "row-e"] },
      ]),
    ).toBe("row-a row-b\nrow-c row-d row-e");
    expect(formatCollisionGroups([])).toBe("");
  });
});

// What follows from an UNDETECTED pair, stated as a test rather than a
// comment (criterion 18.5's domain half): the declared sets canonicalise
// BOTH declarations, so both rows of a spaced-plus-compact pair claim the
// same fact rows, and where their rings disagree the reserve arm wins
// first. This is why the backfill refuses to guess and the typed check
// refuses the second row.
describe("both rows of a canonical pair claim the same fact rows, and the reserve arm wins (criterion 18.5)", () => {
  test("a spaced POT row and a compact RESERVE row collapse to one canonical member, classified RESERVE", async () => {
    const { deriveDeclaredSets } = await import(
      "../../src/modules/ledger/domain/ledger-transaction"
    );
    const { classifyFlow } = await import(
      "../../src/modules/ledger/domain/classify-flow"
    );
    const { cents } = await import("../../src/platform/money");
    const { plainDate } = await import("../../src/platform/plain-date");

    // The harness's collision pair: ONE real account stored twice
    // (provenance in test/fixtures/allowed-identifiers.txt).
    const sets = deriveDeclaredSets([
      { id: "row-spaced", role: "POT", iban: "BE54 9100 0000 0003" },
      { id: "row-compact", role: "RESERVE", iban: "BE54910000000003" },
    ]);
    // Both declarations canonicalise to the SAME member, so the two rows
    // claim the same fact rows: the canonical form sits in BOTH sets.
    expect(sets.potIbans.has("BE54910000000003")).toBe(true);
    expect(sets.reserveIbans.has("BE54910000000003")).toBe(true);

    // And where the rings disagree, the reserve arm wins FIRST: a pot
    // row moving money to this account classifies RESERVE, never
    // INTERNAL, so the pair's ring disagreement decides where every
    // movement to that account is counted.
    const classified = classifyFlow(
      {
        id: "t-1",
        accountId: "some-pot-account",
        importId: "i-1",
        bookingDate: plainDate("2026-08-05"),
        amountCents: cents(-10000),
        description: "OVERSCHRIJVING",
        counterpartyIban: "BE54 9100 0000 0003",
      },
      { sets, cardImports: [], outgoingHistoryKeys: new Set() },
    );
    expect(classified.flow).toBe("RESERVE");
  });
});
