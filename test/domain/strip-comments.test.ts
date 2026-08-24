import { describe, expect, test } from "vitest";
import { stripComments } from "../support/strip-comments";

// THE STRIPPER IS ITSELF A GUARD COMPONENT, so it is pointed at the states it
// exists to handle rather than trusted. Every case below is a shape that
// defeated a real guard in this phase's review, or the inverse of one.
describe("the shared comment stripper", () => {
  test("it removes an ordinary line comment", () => {
    expect(stripComments("const a = 1; // gone\n")).not.toContain("gone");
  });

  test("it removes a block comment", () => {
    expect(stripComments("const a = /* gone */ 1;")).not.toContain("gone");
  });

  test("A DOUBLE SLASH INSIDE A STRING IS NOT A COMMENT, which is finding CR-P14C2-03", () => {
    // The naive stripper discarded the rest of this line, taking the call
    // after it out of the guard's sight.
    const source =
      'const auditUrl = "https://audit.example/rules"; await tx.merchantRule.deleteMany({});';
    const stripped = stripComments(source);
    expect(stripped).toContain("merchantRule");
    expect(stripped).toContain("deleteMany");
  });

  test("a double slash inside a single-quoted string is not a comment either", () => {
    const source = "const u = 'a//b'; forbiddenCall();";
    expect(stripComments(source)).toContain("forbiddenCall");
  });

  test("A SQL LINE COMMENT INSIDE A TEMPLATE IS REMOVED, which is finding CR-P14C2-01 witness TWO", () => {
    // A predicate deleted from a WHERE and left on a SQL comment line is not
    // applied by Postgres, so a guard must not see it either.
    const source = 'const q = sql`SELECT 1\n  -- the ring scoping used to read AND ${POT_ROW} here\n`;';
    const stripped = stripComments(source);
    expect(stripped).not.toContain("POT_ROW");
  });

  test("an interpolation is CODE, so a real predicate in a template survives", () => {
    const source = 'const q = sql`WHERE x = 1 AND ${POT_ROW}`;';
    expect(stripComments(source)).toContain("POT_ROW");
  });

  test("a hyphen that is not doubled is untouched, so ordinary SQL survives", () => {
    const source = "const q = sql`SELECT a - b AS diff`;";
    expect(stripComments(source)).toContain("a - b");
  });

  test("offsets are preserved, so a guard that slices by index stays correct", () => {
    const source = "const a = 1; // comment\nconst b = 2;\n";
    expect(stripComments(source)).toHaveLength(source.length);
    expect(stripComments(source).split("\n")).toHaveLength(source.split("\n").length);
  });

  test("a template inside an interpolation nests rather than terminating early", () => {
    const source = "const q = sql`A ${inner(sql`B -- gone\n`)} C -- alsogone\n`;";
    const stripped = stripComments(source);
    expect(stripped).not.toContain("gone");
    expect(stripped).toContain("A ");
    expect(stripped).toContain(" C ");
  });
});
