import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { detectSourceProfile } from "../../src/modules/import/domain/detect-profile";
import {
  parseSourceProfileSpec,
  specEquals,
} from "../../src/modules/import/domain/source-profile";

// Criterion 2.4, hazard H2.4 (finding PR2-001): the D-2 widening of
// SourceProfileSpec to a discriminated union must leave every profile
// STORED BEFORE THE WIDENING readable AND recognisable. A stored spec at
// e4ea3ba carries no kind discriminant, so parseSourceProfileSpec must
// normalise the kind-less shape to the delimited variant; and because
// findProfileBySpec (upload-statement.ts:101) compares the STORED parsed
// spec against the spec detect emits for the next upload of the same
// file, the two must compare specEquals-TRUE. A parse-only assertion
// would let canonical-JSON specEquals compare differing key sets unequal
// (stored side without kind, detected side with it) while every parse
// test stays green, which is exactly the every-source-unrecognised
// failure H2.4 names.

const fixture = (name: string): Uint8Array =>
  new Uint8Array(readFileSync(join(__dirname, "..", "fixtures", name)));

// The EXACT shape createProfile stored at e4ea3ba for the
// belfius-account-a.csv source: the detect output of that file, as plain
// JSON, with NO kind discriminant anywhere. This literal is the
// migration contract; it is written out in full rather than derived so
// a change to detection cannot silently rewrite what "stored before the
// widening" means.
const storedAtE4ea3ba: unknown = {
  delimiter: ";",
  encoding: "windows-1252",
  headerRowIndex: 1,
  dateFormat: "DD/MM/YYYY",
  decimalStyle: "comma",
  amountRepresentation: { kind: "signed", column: 8 },
  columns: {
    bookingDate: 2,
    description: 7,
    valueDate: 3,
    accountIban: 4,
    counterpartyIban: 5,
    statementNumber: 0,
    sequenceNumber: 1,
    counterpartyName: 6,
  },
};

describe("pre-widening stored profile specs (criterion 2.4)", () => {
  test("a kind-less e4ea3ba spec parses to the delimited variant", () => {
    const parsed = parseSourceProfileSpec(storedAtE4ea3ba);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }
    expect(parsed.value.kind).toBe("delimited");
  });

  test("the parsed pre-widening spec is specEquals-recognised against the detect-emitted spec of a matching upload", () => {
    const parsed = parseSourceProfileSpec(storedAtE4ea3ba);
    expect(parsed.ok).toBe(true);
    const detected = detectSourceProfile(fixture("belfius-account-a.csv"));
    expect(detected.ok).toBe(true);
    if (!parsed.ok || !detected.ok) {
      return;
    }
    // The recognition round-trip: this is the comparison
    // findProfileBySpec runs on the next upload, so true here means the
    // stored profile is recognised without re-asking the declaration.
    expect(specEquals(parsed.value, detected.value)).toBe(true);
  });
});
