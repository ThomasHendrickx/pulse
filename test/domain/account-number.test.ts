import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import {
  ACCOUNT_NUMBER_LENGTHS,
  canonicalAccountNumber,
  isValidAccountNumber,
  verifyAccountNumber,
} from "../../src/platform/account-number";

// M3-P14 criteria 14.4 and 14.12. Two halves: the canonical form and the
// validity predicate behave as the criteria state, and NEITHER has a second
// definition anywhere under src/.
//
// Every account number written out below is invented. Each is listed in
// test/fixtures/allowed-identifiers.txt with a provenance note.

const SRC = join(__dirname, "..", "..", "src");
const PLATFORM_MODULE = join(SRC, "platform", "account-number.ts");

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

describe("the canonical account-number form", () => {
  test("the spaced, compact and mixed-case renderings of one account number produce one identical result", () => {
    expect(canonicalAccountNumber("BE90 9011 0000 1132")).toBe(
      "BE90901100001132",
    );
    expect(canonicalAccountNumber("be90901100001132")).toBe(
      "BE90901100001132",
    );
    expect(canonicalAccountNumber("BE90-9011-0000-1132")).toBe(
      "BE90901100001132",
    );
    expect(canonicalAccountNumber("BE90901100001132")).toBe(
      "BE90901100001132",
    );
  });

  test("it is idempotent", () => {
    for (const value of [
      "BE90 9011 0000 1132",
      "BE90901100001132",
      "NL91 ABNA 0417164300",
      "a supermarket descriptor",
      "",
    ]) {
      expect(canonicalAccountNumber(canonicalAccountNumber(value))).toBe(
        canonicalAccountNumber(value),
      );
    }
  });

  test("a string that is not an account number is returned unchanged rather than mangled", () => {
    // The comparison sites apply this to a stored counterparty column that
    // usually holds a free-text descriptor. Upper-casing one of those would
    // be a silent change of meaning.
    for (const value of [
      "Supermarkt Noord Gent",
      "overschrijving naar spaarrekening",
      "  ",
      "",
      "BE90",
    ]) {
      expect(canonicalAccountNumber(value)).toBe(value);
    }
  });
});

describe("the deterministic validity test (DR-0028)", () => {
  test("a correctly typed account number is accepted and returned canonical", () => {
    const verdict = verifyAccountNumber("BE90 9011 0000 1132");
    expect(verdict.ok).toBe(true);
    expect(verdict.ok && verdict.canonical).toBe("BE90901100001132");
  });

  test("refusal one: empty after canonicalisation", () => {
    const verdict = verifyAccountNumber("   ");
    expect(verdict.ok).toBe(false);
    expect(!verdict.ok && verdict.error.kind).toBe("account-number-empty");
  });

  test("refusal two: a country code the pinned table does not carry", () => {
    const verdict = verifyAccountNumber("ZZ90901100001132");
    expect(verdict.ok).toBe(false);
    expect(!verdict.ok && verdict.error.kind).toBe(
      "account-number-unknown-country",
    );
  });

  test("refusal three: a length the pinned table disagrees with", () => {
    const verdict = verifyAccountNumber("BE9090110000113");
    expect(verdict.ok).toBe(false);
    expect(!verdict.ok && verdict.error.kind).toBe(
      "account-number-wrong-length",
    );
  });

  test("refusal four: the ISO 7064 mod-97 check fails", () => {
    // One transposed pair of digits in the body of the valid number above.
    const verdict = verifyAccountNumber("BE90901100001123");
    expect(verdict.ok).toBe(false);
    expect(!verdict.ok && verdict.error.kind).toBe(
      "account-number-check-failed",
    );
  });

  test("a mistyped single character is refused, which is the hazard the check exists for", () => {
    expect(isValidAccountNumber("BE90901100001132")).toBe(true);
    expect(isValidAccountNumber("BE90901100001133")).toBe(false);
  });

  test("account numbers whose body carries letters validate too", () => {
    expect(isValidAccountNumber("NL91ABNA0417164300")).toBe(true);
    expect(isValidAccountNumber("FR1420041010050500013M02606")).toBe(true);
    expect(isValidAccountNumber("DE89370400440532013000")).toBe(true);
  });

  test("every account number this phase's fixtures introduce passes the check", () => {
    // Criterion 14.1's clause: a fixture invented the way every existing
    // fixture in this repository was invented mostly does not pass, so this
    // reddens at the fixture rather than in the middle of a Playwright run.
    for (const value of [
      "BE90901100001132",
      "BE66901100002243",
      "BE42901100003354",
      "BE18901100004465",
      "BE24902200001138",
      "BE97902200002249",
      "BE73902200003360",
      "BE49902200004471",
      "BE55903300001144",
      "BE31903300002255",
      "BE07903300003366",
      "BE80903300004477",
    ]) {
      expect(isValidAccountNumber(value)).toBe(true);
    }
  });
});

describe("one definition, enumerated (criterion 14.4)", () => {
  const sources = collectSources(SRC);

  test("the canonical form has exactly one definition and every consumer imports it", () => {
    const definitions = sources.filter((file) =>
      /export const canonicalAccountNumber\b/.test(readFileSync(file, "utf8")),
    );
    expect(definitions).toEqual([PLATFORM_MODULE]);
  });

  // THE DUPLICATE DETECTOR, and the shapes it must catch.
  //
  // CORRECTED AFTER BEING SHOWN GREEN AGAINST THE STATE IT FORBIDS (R-037a,
  // R-087). The first version tested LINE BY LINE for a dot-prefixed
  // `.replace(` taking a REGEX LITERAL. A clean-room review proved it green
  // against a working duplicate written with `.replaceAll`, and it was
  // additionally green against a copy spread over two lines, a split/join
  // copy, and the SQL copy that is IN THE TREE at
  // src/modules/overview/adapters/overview-repository.ts. It caught only the
  // two shapes the criterion names by name, which is the shape of a guard
  // built against the examples in its own brief.
  //
  // It now matches over the WHOLE FILE with comments stripped, so a copy
  // spread across lines is reached; it accepts replace and replaceAll and
  // split/join; and it carries a second detector for the SQL form, because a
  // SQL copy matches no JavaScript idiom at all.
  const stripComments = (text: string): string =>
    text.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");

  // A separator-removing transformation in any of the forms this codebase
  // could write it in. [\s\S] rather than . so a copy that wraps is reached.
  const REMOVES_SEPARATORS: readonly RegExp[] = [
    /\.replace(All)?\(\s*\/\[?[\\s\- ]+\]?[^)]*\/[a-z]*\s*,\s*(""|'')\s*\)/,
    /\.replace(All)?\(\s*(""|'' |" "|' ')\s*,\s*(""|'')\s*\)/,
    /\.split\(\s*[^)]{0,20}\)\s*\.\s*join\(\s*(""|'')\s*\)/,
  ];
  // The SQL form: a separator strip wrapped in upper(), on any column.
  const SQL_CANONICALISATION =
    /upper\s*\(\s*(replace|regexp_replace)\s*\(/i;
  const ACCOUNT_BEARING = /iban|Iban|IBAN|accountNumber|counterpartyAccount/;

  // PROXIMITY, NOT SAME-FILE. The first widening asked whether the file
  // mentioned an account anywhere and whether it stripped separators
  // anywhere, and went red on
  // src/modules/import/domain/kbc-mastercard-template.ts, where the strip is
  // the CARD-MASK normaliser and the only account-bearing token is two
  // hundred lines away in an unrelated function. That is a false positive on
  // correct code, which is how a guard gets weakened rather than fixed. The
  // window is wide enough to reach a copy that wraps over several lines and
  // narrow enough that two unrelated functions in one file do not combine.
  const WINDOW = 200;

  const canonicalisationsIn = (text: string): readonly string[] => {
    const code = stripComments(text);
    const hits: string[] = [];
    for (const pattern of REMOVES_SEPARATORS) {
      const global = new RegExp(pattern.source, "g");
      let match: RegExpExecArray | null;
      while ((match = global.exec(code)) !== null) {
        const from = Math.max(0, match.index - WINDOW);
        const near = code.slice(from, match.index + match[0].length + WINDOW);
        if (ACCOUNT_BEARING.test(near)) {
          hits.push(`js:${pattern.source.slice(0, 24)}`);
          break;
        }
      }
    }
    if (SQL_CANONICALISATION.test(code)) {
      hits.push("sql:upper(replace(");
    }
    return hits;
  };

  test("no file outside the platform module writes its own uppercase-plus-separator-removal of an account-bearing field", () => {
    // THE ONE PERMITTED EXCEPTION, recorded here with its reason, which is
    // what criterion 14.4's own compactIban clause establishes this list
    // for. It is listed rather than removed because SQL cannot import
    // TypeScript: the reserves join and its GROUPING have to express the
    // transformation in the database or not at all.
    //
    // AND IT IS HELD TO THE SAME CHARACTER CLASS. The two copies used to
    // strip different sets, the TypeScript form removing every whitespace
    // character and the SQL form removing a literal space and hyphen only.
    // That is asserted below rather than promised here.
    const PERMITTED: readonly string[] = [
      "src/modules/overview/adapters/overview-repository.ts::sql:upper(replace(",
    ];
    const offenders: string[] = [];
    for (const file of sources) {
      if (file === PLATFORM_MODULE) {
        continue;
      }
      const relative = file.slice(file.indexOf("src/"));
      for (const hit of canonicalisationsIn(readFileSync(file, "utf8"))) {
        const key = `${relative}::${hit}`;
        if (!PERMITTED.includes(key)) {
          offenders.push(key);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  test("the permitted SQL copy strips the SAME character class as the platform form", () => {
    // WHY THIS MATTERS. If the two disagree, a stored counterparty account
    // carrying a tab or a non-breaking space canonicalises in TypeScript and
    // does NOT canonicalise in the reserves join, and the household sees one
    // savings account listed twice with its money split between the lines.
    // That is the exact defect the normalised join exists to prevent,
    // arriving through the half that had no guard.
    //
    // THE TYPESCRIPT SIDE IS ASSERTED BY BEHAVIOUR, not by matching its
    // source text: what matters is which characters it removes, and a test
    // that greps for a regex literal breaks on the spelling while missing a
    // change of meaning.
    const compact = "BE90901100001132";
    for (const separator of [" ", "\t", "\u00a0", "-", "\n"]) {
      const spaced = `BE90${separator}9011${separator}0000${separator}1132`;
      expect(
        canonicalAccountNumber(spaced),
        `the platform form does not strip ${JSON.stringify(separator)}`,
      ).toBe(compact);
    }
    // THE SQL SIDE is asserted on its source, because SQL cannot be called
    // from the fast gate. It must use a CHARACTER CLASS rather than a chain
    // of literal replaces, which is what it used to do: replace(replace(x,
    // ' ', ''), '-', '') removes a literal space and a literal hyphen only.
    // The behavioural cross-check against a real database, that the two
    // agree on a tab, lives in the database-backed lane
    // (test/e2e/overview-reads.spec.ts).
    // Comments stripped, because the corrected comment at that fragment
    // QUOTES the old chained form in order to say what changed, and a guard
    // that reads prose would go red on a correct file.
    const repository = stripComments(
      readFileSync(
        join(SRC, "modules", "overview", "adapters", "overview-repository.ts"),
        "utf8",
      ),
    );
    expect(repository).toContain("regexp_replace");
    expect(repository).not.toContain("replace(replace(");
  });

  test("the duplicate detector reddens on every shape a second copy can take, asserted here rather than assumed", () => {
    // THE GUARD IS POINTED AT ITS OWN TARGET. Each entry is a working second
    // copy of the transformation; each must be caught. The two at the end
    // must NOT be, so the guard is not simply matching everything.
    const mustCatch = [
      'const c = (iban: string) => iban.replace(/[\\s-]/g, "").toUpperCase();',
      'const c = (iban: string) => iban.replaceAll(/\\s/g, "").toUpperCase();',
      'const c = (iban: string) => iban.split(" ").join("").toUpperCase();',
      'const c = (iban: string) =>\n  iban\n    .replace(/[\\s-]/g, "")\n    .toUpperCase();',
      'const sql = `upper(replace(replace(t."counterpartyIban", \' \', \'\'), \'-\', \'\'))`;',
    ];
    const mustNotCatch = [
      'const label = raw.replace(/\\s+/g, " ").trim();',
      'const key = text.toUpperCase().trim();',
    ];
    for (const sample of mustCatch) {
      expect(
        canonicalisationsIn(sample).length,
        `the duplicate detector does not catch: ${sample}`,
      ).toBeGreaterThan(0);
    }
    for (const sample of mustNotCatch) {
      expect(
        canonicalisationsIn(sample),
        `the duplicate detector wrongly catches: ${sample}`,
      ).toEqual([]);
    }
  });

  test("the pinned country-length table has exactly one definition", () => {
    const definitions = sources.filter((file) =>
      /ACCOUNT_NUMBER_LENGTHS\s*:/.test(readFileSync(file, "utf8")),
    );
    expect(definitions).toEqual([PLATFORM_MODULE]);
    expect(ACCOUNT_NUMBER_LENGTHS.get("BE")).toBe(16);
    expect(ACCOUNT_NUMBER_LENGTHS.get("NL")).toBe(18);
  });

  test("the ISO 7064 mod-97 loop has exactly one definition", () => {
    // A second copy of the check matches no whitespace-and-uppercase grep,
    // so it is enumerated on its own: the modulus itself.
    const definitions = sources.filter((file) =>
      /%\s*97\b/.test(readFileSync(file, "utf8")),
    );
    expect(definitions).toEqual([PLATFORM_MODULE]);
  });
});
