import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { stripComments } from "../support/strip-comments";
import { detectSourceProfile } from "../../src/modules/import/domain/detect-profile";
import { parseStatement } from "../../src/modules/import/domain/parse-statement";
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

  // THE SECOND RESERVE ACCOUNT of the savings statement, named once so both
  // tests below say the same thing about the same value (criterion 14.15
  // witness SEVEN).
  const SECOND_RESERVE = "BE25902200005582";

  // EVERY ACCOUNT NUMBER M3-P14 INVENTED, in the three bank-code groups its
  // provenance note in test/fixtures/allowed-identifiers.txt records: 901
  // for the pot ring, 902 for the reserve ring, 903 for the ring-correction
  // arms.
  const PHASE_ACCOUNT_NUMBERS = [
    "BE90901100001132",
    "BE66901100002243",
    "BE42901100003354",
    "BE18901100004465",
    "BE24902200001138",
    "BE97902200002249",
    "BE73902200003360",
    "BE49902200004471",
    SECOND_RESERVE,
    "BE55903300001144",
    "BE31903300002255",
    "BE07903300003366",
    "BE80903300004477",
  ] as const;

  test("every account number this phase's fixtures introduce passes the check", () => {
    // Criterion 14.1's clause: a fixture invented the way every existing
    // fixture in this repository was invented mostly does not pass, so this
    // reddens at the fixture rather than in the middle of a Playwright run.
    for (const value of PHASE_ACCOUNT_NUMBERS) {
      expect(isValidAccountNumber(value)).toBe(true);
    }
  });

  test("and every account number M3-P14 invented is found by WALKING its fixtures, so the list above cannot go stale in silence", () => {
    // THE LIST ABOVE IS A LITERAL AND A LITERAL GOES STALE. This walks the
    // fixture files this phase introduced, pulls out every account-shaped
    // token whose BANK CODE is one of the three groups M3-P14 invented, and
    // requires the literal above to name exactly that set and every member
    // of it to pass the shipped check. A fixture number added later in the
    // same groups reddens here without anyone remembering the list.
    //
    // WHY THE BANK CODE AND NOT EVERY TOKEN, said plainly rather than left
    // as an unexplained filter. These fixtures also reference counterparty
    // accounts borrowed from the OLDER fixture blocks in
    // test/fixtures/allowed-identifiers.txt, which were invented before any
    // criterion required validity and mostly do not pass: the re-measurement
    // this phase ran at its own base found 7 of 17 distinct account-shaped
    // values in the tree passing. Criterion 14.11 witness FOUR re-invents
    // only the numbers a criterion requires to be REGISTERED, and says the
    // rest are left alone. An outside merchant's counterparty is never
    // registered and never reaches the form's refusal, so requiring it to
    // pass would be asserting something the plan deliberately does not ask
    // for.
    //
    // WHAT THIS DOES NOT COVER, therefore: a NEW invalid counterparty
    // borrowed from outside the three groups, and any fixture outside the
    // ar- family. Both are covered by the privacy gate's allow list, which
    // is a different property (known, not valid).
    const dir = join(__dirname, "..", "fixtures");
    const files = readdirSync(dir).filter(
      (name) => name.startsWith("ar-") && name.endsWith(".csv"),
    );
    // NOT VACUOUS, asserted rather than assumed: a walk that found no files,
    // or files carrying no account numbers in these groups, would satisfy
    // every assertion below by finding nothing.
    expect(files.length).toBeGreaterThan(0);
    const found = new Set<string>();
    for (const name of files) {
      const text = readFileSync(join(dir, name), "utf8");
      for (const match of text.matchAll(/\bBE[0-9]{2}(90[123])[0-9]{9}\b/g)) {
        found.add(match[0]);
      }
    }
    expect(found.size).toBeGreaterThan(0);
    // The second reserve account criterion 14.15 witness SEVEN adds really
    // is in there, so this is pointed at the thing that witness introduced
    // and not merely at the file set that was already here.
    expect(found.has(SECOND_RESERVE)).toBe(true);
    for (const value of found) {
      expect(
        isValidAccountNumber(value),
        `${value} is in one of M3-P14's own invented groups and fails the platform check, which criterion 14.12 makes a refusal at the registration form`,
      ).toBe(true);
      expect(
        (PHASE_ACCOUNT_NUMBERS as readonly string[]).includes(value),
        `${value} is in the fixtures and not on this test's own list, so the list has gone stale`,
      ).toBe(true);
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

  // A separator-removing transformation in any of the forms this codebase
  // could write it in. [\s\S] rather than . so a copy that wraps is reached.
  const REMOVES_SEPARATORS: readonly RegExp[] = [
    // WIDENED AFTER BEING SHOWN GREEN AGAINST THE STATE IT FORBIDS, round
    // two, finding CR-P14C2-02. The previous form required the regex
    // literal's character class to BEGIN with a backslash, an s, a hyphen or
    // a space, so a NEGATED class matched nothing. That is the single most
    // ordinary way to write an account-number normaliser:
    //   counterpartyIban.toUpperCase().replace(/[^A-Z0-9]/g, "")
    // A working second copy of canonicalAccountNumber in exactly that shape
    // sat in src/modules/ledger/domain and the guard reported 17 of 17.
    // It now matches THE ACT rather than one idiom: any replace whose
    // pattern is a regex literal at all and whose replacement is the empty
    // string. The proximity window below is what keeps that from firing on
    // unrelated normalisers.
    /\.replace(All)?\(\s*\/(?:\\.|\[(?:\\.|[^\]\\])*\]|[^/\\\n])+\/[a-z]*\s*,\s*(""|'')\s*\)/,
    /\.replace(All)?\(\s*(""|'' |" "|' ')\s*,\s*(""|'')\s*\)/,
    /\.split\(\s*[^)]{0,20}\)\s*\.\s*join\(\s*(""|'')\s*\)/,
  ];
  // The SQL form: a case fold and a separator strip in ONE expression, in
  // EITHER nesting order and over the replace family rather than two names.
  // Also widened for CR-P14C2-02: the previous form pinned upper(replace(
  // and upper(regexp_replace(, so regexp_replace(upper(x), ...) and
  // upper(translate(x, ' -', '')) both passed straight through.
  const SQL_CANONICALISATION =
    /upper\s*\(\s*(replace|regexp_replace|translate)\s*\(|(replace|regexp_replace|translate)\s*\(\s*upper\s*\(/i;
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
      // ADDED IN ROUND TWO, finding CR-P14C2-02. Every one of these was
      // MISSED by the previous patterns, and the first is the exact shape
      // criterion 14.4 names: an inline copy inside another module's
      // identity derivation.
      'const counterpartyIdentity = (counterpartyIban: string) =>\n  counterpartyIban.toUpperCase().replace(/[^A-Z0-9]/g, "");',
      'const c = (accountNumber: string) => accountNumber.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();',
      'const c = (iban: string) => iban.replace(/\\W/g, "").toUpperCase();',
      'const sql = `regexp_replace(upper(t."counterpartyIban"), \'[^A-Z0-9]\', \'\', \'g\')`;',
      'const sql = `upper(translate(t."counterpartyIban", \' -\', \'\'))`;',
    ];
    const mustNotCatch = [
      // A replacement that is NOT the empty string is not a separator strip.
      'const label = raw.replace(/\\s+/g, " ").trim();',
      'const key = text.toUpperCase().trim();',
      // A separator strip with no account-bearing token anywhere near it.
      'const digits = phoneNumber.replace(/[^0-9]/g, "");',
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

// ---------------------------------------------------------------------
// THE OUTSIDE COUNTERPARTY IS AN OUTSIDE COUNTERPARTY, ASSERTED RATHER THAN
// GLOSSED (criterion 14.15 witness SEVEN, third shape).
// ---------------------------------------------------------------------
//
// WHY THIS EXISTS. Witness SEVEN's third shape is "exactly one NEGATIVE row
// whose counterpartyIban belongs to no account of this household", which is
// the payment made straight out of savings. The row that carries it in
// test/fixtures/ar-savings.csv names BE07903300003366, and the whole shape
// depends on that number never becoming an account of a household in any
// fixture. If it ever did, the row would become a SECOND movement between
// two of the household's own accounts, the fixture would carry none of the
// third shape, and the money-string count in the Playwright half would stay
// green because the row still renders exactly one amount. The witness would
// stop witnessing the thing it exists for, silently.
//
// A NOTE ON AN ALLOW LIST IS NOT A GUARD. test/fixtures/allowed-identifiers.txt
// now says this number is an outside counterparty and is not an account of
// any household; this is what makes that true.
describe("the outside counterparty of the payment out is never a household account", () => {
  const OUTSIDE_COUNTERPARTY = "BE07903300003366";
  const FIXTURES = join(__dirname, "..", "fixtures");

  // WHERE THIS NUMBER IS ALLOWED TO APPEAR, by file and by role, written by
  // hand. Anything else is a new use nobody has looked at.
  const PERMITTED = [
    {
      file: "fixtures/ar-savings.csv",
      role: "the COUNTERPARTY of the payment made straight out of savings, which is witness SEVEN's third shape",
    },
    {
      file: "fixtures/allowed-identifiers.txt",
      role: "the privacy allow list, where the number's provenance and this role are written down",
    },
    {
      file: "domain/account-number.test.ts",
      role: "the validity list and this guard's own subject",
    },
  ] as const;

  test("no committed CSV fixture declares it as the file's OWN account, read through the shipped detector and parser", () => {
    // THE PRODUCT'S OWN PATH, not a column-index rule of this test's own:
    // an account is declared from the file's own-account identifiers
    // (src/modules/import/application/confirm-import.ts reads exactly this
    // list), so asking the shipped parser what those are is asking the
    // question that actually decides.
    const files = readdirSync(FIXTURES).filter((name) => name.endsWith(".csv"));
    // NOT VACUOUS: a walk that found no files, or files none of which
    // declared any own account, would satisfy the assertion by finding
    // nothing.
    expect(files.length).toBeGreaterThan(0);
    const declared = new Set<string>();
    let parsed = 0;
    for (const name of files) {
      const bytes = new TextEncoder().encode(
        readFileSync(join(FIXTURES, name), "utf8"),
      );
      const spec = detectSourceProfile(bytes);
      if (!spec.ok) {
        continue;
      }
      const statement = parseStatement(bytes, spec.value);
      if (!statement.ok) {
        continue;
      }
      parsed += 1;
      for (const iban of statement.value.accountIbans) {
        declared.add(canonicalAccountNumber(iban));
      }
    }
    expect(parsed).toBeGreaterThan(0);
    expect(
      declared.size,
      "no committed CSV fixture declares an own account, so this assertion would pass by finding nothing",
    ).toBeGreaterThan(0);
    expect(
      declared.has(OUTSIDE_COUNTERPARTY),
      `${OUTSIDE_COUNTERPARTY} is declared as a file's OWN account, so it is an account of a household and the payment-out row of ar-savings.csv is no longer a payment out: criterion 14.15 witness SEVEN's third shape has no row`,
    ).toBe(false);
    // AND THE WALK REALLY REACHES THE FILE THIS IS ABOUT, so a detector
    // change that silently stopped parsing it cannot make this green.
    expect(declared.has("BE24902200001138")).toBe(true);
  });

  test("every textual occurrence of it in the test tree sits on the permitted list, so a registration written anywhere reddens", () => {
    // THE OTHER DECLARATION PATH. A fixture is not the only way this number
    // could become a household account: a test can register it through the
    // accounts use case or the accounts form. That is a source-level act, so
    // this is a source-level scan.
    const root = join(__dirname, "..");
    const walk = (dir: string): readonly string[] => {
      const out: string[] = [];
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) {
          out.push(...walk(full));
        } else {
          out.push(full);
        }
      }
      return out;
    };
    const found: string[] = [];
    for (const file of walk(root)) {
      let text: string;
      try {
        text = readFileSync(file, "utf8");
      } catch {
        continue;
      }
      if (!text.includes(OUTSIDE_COUNTERPARTY)) {
        continue;
      }
      found.push(file.slice(root.length + 1));
    }
    // NOT VACUOUS: the number is really in the tree, so a broken walk that
    // found nothing fails here rather than passing.
    expect(found.length).toBeGreaterThan(0);
    expect(
      [...found].sort(),
      "an occurrence of the outside counterparty outside the permitted list: if this is a registration, witness SEVEN's third shape has just lost its row",
    ).toEqual(PERMITTED.map((entry) => entry.file).sort());
  });
});
