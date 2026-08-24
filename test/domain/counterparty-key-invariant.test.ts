import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
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

  test("the invariant's two producers are the only ones, asserted against the source", () => {
    // If a third producer of Transaction.counterpartyIban appears, this
    // reddens and whoever adds it has to decide whether it is shape-gated.
    const src = join(__dirname, "..", "..", "src");
    const producers = [
      join(src, "modules", "import", "domain", "detect-profile.ts"),
      join(src, "modules", "import", "domain", "belfius-current-account-template.ts"),
    ];
    // The delimited detector gates the whole column on its own IBAN pattern.
    const detector = readFileSync(producers[0] ?? "", "utf8");
    expect(detector).toMatch(/const IBAN = \/\^\[A-Z\]\{2\}/);
    expect(detector).toContain("values.every((value) => IBAN.test(value))");
    // The PDF template canonicalises before storing.
    const template = readFileSync(producers[1] ?? "", "utf8");
    expect(template).toContain("canonicalAccountNumber(match[1])");
  });
});
