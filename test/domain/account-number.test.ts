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

  test("no file outside the platform module writes its own uppercase-plus-whitespace-removal of an account-bearing field", () => {
    // The shape a second copy takes: a replace that removes whitespace or
    // separators, on a line that also mentions an account-bearing field or
    // is chained with toUpperCase. Written as an enumeration rather than a
    // bare grep so a reader can check the list.
    const PERMITTED: readonly string[] = [];
    const offenders: string[] = [];
    for (const file of sources) {
      if (file === PLATFORM_MODULE) {
        continue;
      }
      const text = readFileSync(file, "utf8");
      for (const [index, line] of text.split("\n").entries()) {
        const removesSeparators =
          /\.replace\(\s*\/\[?[\\s -]+\]?[^)]*\/[a-z]*\s*,\s*""\s*\)/.test(line);
        if (!removesSeparators) {
          continue;
        }
        const accountBearing =
          /iban|Iban|IBAN|accountNumber|counterpartyAccount/.test(line) ||
          /toUpperCase\(\)/.test(line);
        if (accountBearing) {
          offenders.push(`${file}:${index + 1}`);
        }
      }
    }
    expect(offenders.filter((o) => !PERMITTED.includes(o))).toEqual([]);
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
