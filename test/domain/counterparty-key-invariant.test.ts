import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { stripComments } from "../support/strip-comments";
import { counterpartyKey } from "../../src/modules/ledger/domain/corrections";

// THE INVARIANT THE ACCOUNT-NUMBER MIGRATION RESTS ON, MADE EXPLICIT AND
// TESTED (hazard finding HZ-M3P14-01).
//
// M3-P14 replaced an UNCONDITIONAL uppercase-plus-whitespace-removal inside
// the refund correction's identity key with the platform canonical form,
// which is SHAPE-GATED: a value that is not shaped like an account number
// comes back unchanged. The two therefore agree only while every value
// reaching the key is already shape-valid, and nothing asserted that. It was
// traced by hand in review and found to hold; a traced invariant that no test
// pins is one refactor away from being false, and it would fail as a
// MIS-KEYED REFUND rather than as a crash.
//
// Every account number below is invented and listed in
// test/fixtures/allowed-identifiers.txt.

// The transform this migration replaced, kept here as the thing to compare
// against. It is not exported by the source and must not be: this copy exists
// only so the test can state what changed.
const theOldUnconditionalTransform = (iban: string): string =>
  `iban:${iban.toUpperCase().replace(/\s+/g, "")}`;

const keyFor = (counterpartyIban: string): string =>
  counterpartyKey({ counterpartyIban, description: "irrelevant" });

describe("the refund key's account half, before and after the canonical-form migration", () => {
  // WHAT THE KNOWN PRODUCERS CAN EMIT. The delimited detector assigns the
  // counterparty-account column only when every non-empty value matches
  // /^[A-Z]{2}\d{2}[A-Z0-9]{8,30}$/, and the Belfius PDF template lifts the
  // value out with /\b([A-Z]{2}\d{2}(?:\s?\d{4}){3})\b/ and canonicalises it
  // before storing. So the reachable set is upper-case, compact, and
  // account-shaped.
  const reachable = [
    "BE90901100001132",
    "BE24902200001138",
    "NL91ABNA0417164300",
    "DE89370400440532013000",
    "FR1420041010050500013M02606",
  ];

  test("on every value the known producers can emit, the new key equals the old one", () => {
    for (const value of reachable) {
      expect(
        keyFor(value),
        `the migration changed the refund key for ${value}`,
      ).toBe(theOldUnconditionalTransform(value));
    }
  });

  test("and they DISAGREE outside that shape, which is what makes the assertion above mean something", () => {
    // Without this, the test above would pass against a shipped function that
    // simply WAS the old transform, and would be asserting nothing.
    const outsideTheShape = "not an account number";
    expect(keyFor(outsideTheShape)).not.toBe(
      theOldUnconditionalTransform(outsideTheShape),
    );
  });

  test("the invariant's producers are ENUMERATED over the source, not asserted about two named files", () => {
    // CORRECTED AFTER BEING SHOWN GREEN AGAINST THE STATE IT FORBIDS
    // (R-087, finding CR-P14C2-12). The comment here used to say "if a third
    // producer of Transaction.counterpartyIban appears, this reddens and
    // whoever adds it has to decide whether it is shape-gated." THAT WAS
    // FALSE. The body read only the two files it named and asserted their
    // contents; it enumerated nothing, so a third producer added anywhere
    // could not redden it. A clean-room lane added one to
    // src/modules/import/domain/parse-statement.ts and got 3 passed of 3.
    //
    // AND THE TWO FILES IT NAMED WERE NOT THE PRODUCERS. detect-profile.ts
    // assigns a column INDEX (columns.counterpartyIban ??= column), never a
    // value; the delimited path's value is written by parse-statement.ts.
    // detect-profile is the SHAPE GATE on that writer, which is a different
    // role, and the old wording conflated them.
    const src = join(__dirname, "..", "..", "src");
    const files: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) walk(full);
        else if (entry.endsWith(".ts")) files.push(full);
      }
    };
    walk(src);

    // A WRITE of the field's VALUE. Three forms this codebase can express it
    // in. The `=(?!=)` lookahead matters: without it, `=== undefined`
    // matched and three consumer files were reported as producers.
    const OBJECT_WRITE = /counterpartyIban\s*:\s*([^,;\n]+)/g;
    const DIRECT_WRITE = /counterpartyIban\s*=(?!=)\s*([^,;\n]+)/g;
    const NAMED_FIELD_WRITE = /optionalText\(\s*"counterpartyIban"\s*\)/g;
    // Not writes: a type member, a Prisma select flag, a column index, or a
    // forward of a value that already exists on a row.
    const NOT_A_WRITE =
      /^(?:string|number|true|false|\(?\s*string\s*\||null\s*\||undefined\s*\|)/;
    const PASS_THROUGH =
      /^\(?\s*[A-Za-z_$][\w$]*\.counterpartyIban(\s*\?\?\s*(null|undefined))?\s*\)?$/;
    const COLUMN_INDEX = /^column\b/;

    const writesByFile = new Map<string, string[]>();
    for (const file of files) {
      const code = stripComments(readFileSync(file, "utf8"));
      const relative = file.slice(file.indexOf("src/"));
      const hits: string[] = [];
      for (const pattern of [OBJECT_WRITE, DIRECT_WRITE]) {
        for (const match of code.matchAll(new RegExp(pattern.source, "g"))) {
          // Trim the syntax that closes an enclosing object or spread, so a
          // conditional pass-through written `: { counterpartyIban:
          // row.counterpartyIban })` is recognised as the forward it is.
          const rhs = (match[1] ?? "").trim().replace(/[)}\]\s]+$/, "");
          if (
            rhs === "" ||
            NOT_A_WRITE.test(rhs) ||
            PASS_THROUGH.test(rhs) ||
            COLUMN_INDEX.test(rhs)
          ) {
            continue;
          }
          hits.push(rhs);
        }
      }
      for (const match of code.matchAll(NAMED_FIELD_WRITE)) {
        hits.push(match[0]);
      }
      if (hits.length > 0) writesByFile.set(relative, hits);
    }

    // THE PRODUCING SET. A producer in a THIRD file reddens this.
    expect([...writesByFile.keys()].sort()).toEqual([
      "src/modules/import/domain/belfius-current-account-template.ts",
      "src/modules/import/domain/parse-statement.ts",
    ]);

    // AND EACH FILE'S WRITES ARE PINNED, so a SECOND, ungated producer
    // inside one of the two known files reddens too. This is the half the
    // clean-room lane's witness defeated: it added its copy INSIDE a
    // producer file, where a file-level enumeration alone would not see it.
    expect(writesByFile.get("src/modules/import/domain/parse-statement.ts")).toEqual([
      'optionalText("counterpartyIban")',
    ]);
    // The PDF template's writes are pinned by their exact right-hand sides,
    // and the one local they go through is pinned to the canonical form
    // below. A write with any other source reddens this.
    expect(
      writesByFile.get(
        "src/modules/import/domain/belfius-current-account-template.ts",
      ),
    ).toEqual(["candidate"]);
    const pdf = stripComments(
      readFileSync(
        join(src, "modules", "import", "domain", "belfius-current-account-template.ts"),
        "utf8",
      ),
    );
    expect(pdf).toMatch(/const candidate =[\s\S]{0,120}canonicalAccountNumber\(/);

    // THE GATE ON THE DELIMITED WRITER, which is what makes its verbatim
    // store safe: the column is assigned only when EVERY value in it matches
    // the anchored compact pattern.
    const detector = readFileSync(
      join(src, "modules", "import", "domain", "detect-profile.ts"),
      "utf8",
    );
    expect(detector).toMatch(/const IBAN = \/\^\[A-Z\]\{2\}/);
    expect(detector).toContain("values.every((value) => IBAN.test(value))");
    const template = readFileSync(
      join(src, "modules", "import", "domain", "belfius-current-account-template.ts"),
      "utf8",
    );
    expect(template).toContain("canonicalAccountNumber(match[1])");
  });
});
