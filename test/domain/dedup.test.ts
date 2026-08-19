import { describe, expect, test } from "vitest";
import { assignDedupKeys } from "../../src/modules/import/domain/dedup";
import type { ParsedRow } from "../../src/modules/import/domain/parse-statement";
import type { SourceProfileSpec } from "../../src/modules/import/domain/source-profile";
import { cents } from "../../src/platform/money";
import { plainDate } from "../../src/platform/plain-date";

// Findings F5 and F6: the occurrence ordinal counts occurrences among
// HASH-PATH identical-content rows only (owner v0.2 addendum section 5),
// and the content tuple is encoded so field values carrying the join
// delimiter can never collide onto one key.

const ACCOUNT = "acc-1";

const naturalKeySpec: SourceProfileSpec = {
  delimiter: ";",
  encoding: "utf-8",
  headerRowIndex: 0,
  dateFormat: "DD/MM/YYYY",
  decimalStyle: "comma",
  amountRepresentation: { kind: "signed", column: 4 },
  columns: {
    bookingDate: 1,
    description: 3,
    statementNumber: 0,
    sequenceNumber: 2,
  },
};

const hashOnlySpec: SourceProfileSpec = {
  ...naturalKeySpec,
  columns: { bookingDate: 1, description: 3 },
};

const row = (overrides: Partial<ParsedRow> & { rawLine: string }): ParsedRow => ({
  bookingDate: plainDate("2026-08-14"),
  amountCents: cents(-4200),
  description: "COFFEE CORNER GENT",
  ...overrides,
});

describe("the ordinal counts hash-path rows only (finding F5)", () => {
  test("a keyless row keeps the same key whether or not a natural-keyed twin precedes it", () => {
    // File A: a natural-keyed row and a keyless row with the SAME content
    // tuple. File B (overlapping re-export): only the keyless row.
    const naturalTwin = row({
      rawLine: "7;14/08/2026;0330;COFFEE CORNER GENT;-42,00",
      statementNumber: "7",
      sequenceNumber: "0330",
    });
    const keyless = row({
      rawLine: ";14/08/2026;;COFFEE CORNER GENT;-42,00",
    });

    const fileAKeys = assignDedupKeys(ACCOUNT, [naturalTwin, keyless], naturalKeySpec);
    const fileBKeys = assignDedupKeys(ACCOUNT, [keyless], naturalKeySpec);

    expect(fileAKeys[0]).toBe(`nat:${ACCOUNT}:7:0330`);
    // One fact, one key: the keyless row's key must not depend on how many
    // natural-keyed twins its file happens to carry, or an overlapping
    // re-export stores the same fact twice.
    expect(fileAKeys[1]).toBe(fileBKeys[0]);
  });

  test("hash-path duplicates still get distinct ordinals among themselves", () => {
    const one = row({ rawLine: "a" });
    const two = row({ rawLine: "b" });
    const keys = assignDedupKeys(ACCOUNT, [one, two], hashOnlySpec);
    expect(keys[0]).not.toBe(keys[1]);
    expect(keys[0]?.endsWith("#0")).toBe(true);
    expect(keys[1]?.endsWith("#1")).toBe(true);
  });
});

describe("tuple fields carrying the join delimiter never collide (finding F6)", () => {
  test("shifted field boundaries produce distinct keys", () => {
    // Same account, date and amount; the counterparty and reference split
    // the same character stream at different boundaries. Distinct
    // transactions, so the keys must differ.
    const shiftedLeft = row({
      rawLine: "x",
      counterpartyName: "AAA|BBB",
      reference: "CCC",
    });
    const shiftedRight = row({
      rawLine: "y",
      counterpartyName: "AAA",
      reference: "BBB|CCC",
    });
    const keyLeft = assignDedupKeys(ACCOUNT, [shiftedLeft], hashOnlySpec)[0];
    const keyRight = assignDedupKeys(ACCOUNT, [shiftedRight], hashOnlySpec)[0];
    expect(keyLeft).not.toBe(keyRight);
  });
});
