import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, test } from "vitest";
import {
  ACCOUNT_NUMBER_LENGTH_BY_COUNTRY,
  accountNumberProblem,
  canonicalAccountNumber,
  isValidAccountNumber,
} from "../../src/platform/account-number";
import { classifyFlow } from "../../src/modules/ledger/domain/classify-flow";
import { deriveDeclaredSets } from "../../src/modules/ledger/domain/ledger-transaction";
import type { LedgerTransaction } from "../../src/modules/ledger/domain/ledger-transaction";
import { cents } from "../../src/platform/money";
import { plainDate } from "../../src/platform/plain-date";

// M3-P14, criteria 14.3 and 14.4. ONE canonical form and ONE validity test,
// witnessed where they matter.
//
// Every value in this file is INVENTED. The eight setup accounts are the
// run 900000000001 through 900000000008 with computed check digits; the
// counterparties are values already on test/fixtures/allowed-identifiers.txt
// with their provenance. Nothing here was transcribed from any document.

const SRC = join(__dirname, "..", "..", "src");

const sourceFiles = (dir: string): readonly string[] => {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...sourceFiles(full));
    } else if (entry.endsWith(".ts") || entry.endsWith(".tsx")) {
      out.push(full);
    }
  }
  return out;
};

const filesMatching = (pattern: RegExp): readonly string[] =>
  sourceFiles(SRC)
    .filter((file) => pattern.test(readFileSync(file, "utf8")))
    .map((file) => relative(SRC, file).split("\\").join("/"))
    .sort();

describe("criterion 14.4: one canonical form, one country table, one mod-97", () => {
  test("the canonical form is DEFINED exactly once under src/, in the platform module", () => {
    expect(filesMatching(/export const canonicalAccountNumber\s*=/)).toEqual([
      "platform/account-number.ts",
    ]);
  });

  test("the pinned country-length table is DEFINED exactly once under src/, in the platform module", () => {
    // The table's own contents, not its name: an alias re-exporting it is
    // not a second definition, and a second literal table would be.
    expect(filesMatching(/\["BE",\s*16\]/)).toEqual([
      "platform/account-number.ts",
    ]);
  });

  test("the ISO 7064 mod-97 arithmetic is IMPLEMENTED exactly once under src/, in the platform module", () => {
    expect(filesMatching(/%\s*97/)).toEqual(["platform/account-number.ts"]);
  });

  // THE CALL-SITE ENUMERATION, published rather than summarised. Every
  // consumer imports the platform definitions; none re-derives them.
  test("every consumer of the canonical form imports it rather than re-deriving it", () => {
    expect(filesMatching(/canonicalAccountNumber/)).toEqual([
      "modules/accounts/adapters/account-repository.ts",
      "modules/accounts/domain/account-registration.ts",
      "modules/import/domain/belfius-current-account-template.ts",
      "modules/import/domain/detect-profile.ts",
      "modules/ledger/domain/classify-flow.ts",
      "modules/ledger/domain/corrections.ts",
      "modules/ledger/domain/ledger-transaction.ts",
      "modules/ledger/domain/pair-transfers.ts",
      "modules/merchants/domain/counterparty-identity.ts",
      // The reserves join names the canonical form in a comment because it
      // is SQL and cannot import it: the join canonicalises with
      // upper(regexp_replace(...)), which mirrors this definition, and the
      // comment there points at it so a change to one meets the other.
      "modules/overview/adapters/overview-repository.ts",
      "platform/account-number.ts",
    ]);
  });

  // THE OTHER WHITESPACE-REMOVALS IN THE TREE, named one by one, because
  // criterion 14.4 requires the pre-existing helper at
  // belfius-current-account-template.ts to be either replaced or recorded
  // as a permitted exception WITH ITS REASON.
  //
  //   belfius-current-account-template.ts  REPLACED. Its private
  //     `text.replace(/\s/g, "")` is now the platform canonical form. The
  //     platform form additionally uppercases, which that call site cannot
  //     observe: both patterns it feeds (BAND_LINE and DESCRIPTION_IBAN)
  //     match uppercase letters only.
  //
  //   ledger/domain/corrections.ts  THE ONE PERMITTED EXCEPTION. Its
  //     counterpartyKey strips whitespace for the REFUND correction's key,
  //     and that key feeds FLOW CLASSIFICATION. The decision to keep it
  //     separate is recorded at the head of
  //     merchants/domain/counterparty-identity.ts: swapping a shared
  //     derivation in there would move flows, where resolution must rename
  //     and regroup and never reclassify (hazard H3.2). Its sameness of
  //     shape is a coincidence of value, not a shared decision. This test
  //     PINS that exception, so a third one is red.
  //
  // The remaining matches collapse runs of whitespace to a single space
  // and are not a canonical account form at all.
  test("no third whitespace-removal exists, and the two that do are the named ones", () => {
    const removals = filesMatching(/replace\(\/\\s\+?\/g,\s*""\)/);
    expect(removals).toEqual([
      "modules/ledger/domain/corrections.ts",
      "platform/account-number.ts",
    ]);
    // And the replaced helper really is gone from the Belfius template.
    const template = readFileSync(
      join(SRC, "modules/import/domain/belfius-current-account-template.ts"),
      "utf8",
    );
    expect(template).toContain("const compactIban = canonicalAccountNumber;");
  });

  test("the canonical form is idempotent", () => {
    for (const value of [
      "BE73 9000 0000 0001",
      "be73900000000001",
      "  BE73900000000001  ",
      "",
      "not an account",
    ]) {
      const once = canonicalAccountNumber(value);
      expect(canonicalAccountNumber(once)).toBe(once);
    }
  });

  test("the spaced, compact and mixed-case renderings of one account produce ONE identical result", () => {
    const renderings = [
      "BE73900000000001",
      "BE73 9000 0000 0001",
      "be73 9000 0000 0001",
      "Be73900000000001",
      "\tBE73 9000\n0000 0001 ",
    ];
    const canonical = new Set(renderings.map(canonicalAccountNumber));
    expect([...canonical]).toEqual(["BE73900000000001"]);
    for (const rendering of renderings) {
      expect(isValidAccountNumber(rendering)).toBe(true);
    }
  });
});

describe("criterion 14.3: the four refusals, over wholly invented inputs", () => {
  test("empty after canonicalisation", () => {
    expect(accountNumberProblem("   ")).toEqual({ kind: "empty" });
    expect(accountNumberProblem("")).toEqual({ kind: "empty" });
  });

  test("a country code the pinned table does not carry", () => {
    // ZZ is not an ISO 13616 registry entry and this asserts the table
    // itself does not carry it, so the refusal is the table's and not a
    // coincidence of the value.
    expect(ACCOUNT_NUMBER_LENGTH_BY_COUNTRY.has("ZZ")).toBe(false);
    expect(accountNumberProblem("ZZ73900000000001")).toEqual({
      kind: "unknown-country",
      country: "ZZ",
    });
  });

  test("a length the table does not assign that country code", () => {
    expect(ACCOUNT_NUMBER_LENGTH_BY_COUNTRY.get("BE")).toBe(16);
    expect(accountNumberProblem("BE7390000000000")).toEqual({
      kind: "wrong-length",
      country: "BE",
      expected: 16,
      actual: 15,
    });
    expect(accountNumberProblem("BE739000000000012")).toEqual({
      kind: "wrong-length",
      country: "BE",
      expected: 16,
      actual: 17,
    });
  });

  test("a value of the right country and length that fails the mod-97 check", () => {
    // ONE TRANSPOSED CHARACTER, which is the mistake the criterion names:
    // the last two digits of a valid invented account swapped.
    expect(isValidAccountNumber("BE73900000000001")).toBe(true);
    expect(accountNumberProblem("BE73900000000010")).toEqual({
      kind: "checksum-failed",
    });
  });
});

describe("criterion 14.1: every account number the setup fixture introduces is valid", () => {
  // Read from the fixture itself rather than retyped, so a later edit to
  // the fixture cannot introduce a number no household could register.
  const fixture = readFileSync(
    join(__dirname, "..", "fixtures", "setup-current.csv"),
    "utf8",
  );

  test("the fixture's own account and every account-shaped counterparty pass the validity test", () => {
    const shapes = [
      ...fixture.matchAll(/\bBE[0-9]{2}(?:\s?[0-9]{4}){3}\b/g),
    ].map((match) => match[0]);
    // The fixture really does carry account-shaped values, so a broken
    // sweep cannot pass by finding nothing.
    expect(shapes.length).toBeGreaterThanOrEqual(18);
    for (const shape of shapes) {
      expect(
        isValidAccountNumber(shape),
        `${canonicalAccountNumber(shape).slice(0, 4)}... does not pass the validity test`,
      ).toBe(true);
    }
  });

  test("the fixture writes its counterparty accounts SPACED, which is what the reserves join has to survive", () => {
    const spaced = [
      ...fixture.matchAll(/\bBE[0-9]{2}(?:\s[0-9]{4}){3}\b/g),
    ].map((match) => match[0]);
    expect(spaced.length).toBeGreaterThanOrEqual(9);
  });
});

describe("criterion 14.4: a SPACED stored counterparty classifies against a COMPACT registration", () => {
  const row = (counterparty: string, amountCents: number): LedgerTransaction => ({
    id: "tx-1",
    accountId: "account-current",
    importId: "import-1",
    bookingDate: plainDate("2026-08-10"),
    amountCents: cents(amountCents),
    description: "OVERSCHRIJVING NAAR EIGEN REKENING",
    counterpartyIban: counterparty,
  });

  // The declarations are stored CANONICAL, exactly as registration writes
  // them; the fact rows carry the account written the way the source
  // printed it.
  const sets = deriveDeclaredSets([
    { id: "account-current", role: "POT", iban: "BE73900000000001" },
    { id: "account-sibling", role: "POT", iban: "BE46900000000002" },
    { id: "account-savings", role: "RESERVE", iban: "BE62900000000005" },
  ]);
  const context = {
    sets,
    cardImports: [],
    outgoingHistoryKeys: new Set<string>(),
  };

  test("RESERVE against a savings account registered compact", () => {
    expect(classifyFlow(row("BE62 9000 0000 0005", -50_000), context).flow).toBe(
      "RESERVE",
    );
  });

  test("INTERNAL against a spending account registered compact", () => {
    expect(classifyFlow(row("BE46 9000 0000 0002", -30_000), context).flow).toBe(
      "INTERNAL",
    );
  });

  test("and the same rows without the fix would have been SPEND, so this is not vacuous", () => {
    // The control: a counterparty that IS spaced and belongs to nobody
    // still falls to the sign rule, which is what the two rows above did
    // before the comparison canonicalised.
    expect(classifyFlow(row("BE71 0961 2345 6769", -30_000), context).flow).toBe(
      "SPEND",
    );
  });
});
