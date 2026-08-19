import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { detectSourceProfile } from "../../src/modules/import/domain/detect-profile";
import { parseAmountToCents } from "../../src/modules/import/domain/parse-amount";
import { parseStatement } from "../../src/modules/import/domain/parse-statement";
import type { SourceProfileSpec } from "../../src/modules/import/domain/source-profile";

// Criterion 1.1: deterministic profile detection and parsing against the
// committed synthetic fixtures. The fixtures reproduce the structural
// quirks of the owner's two real statements (notes/export-format-facts.md)
// with invented IBANs, names and amounts:
//   belfius-account-a.csv   ";", Windows-1252, DD/MM/YYYY, 1.234,56,
//                           signed column, preamble above the header,
//                           statement and sequence numbers, own-account
//                           and counterparty IBAN columns
//   kbc-card.csv            ";", UTF-8, DD.MM.YY, comma decimals, amount
//                           plus D/C indicator, NO counterparty-account
//                           column, NO statement or sequence numbers, an
//                           FX row with original amount and exchange rate
//                           in the description, two legitimate identical
//                           rows, and the positive settlement row
//   generic-debit-credit.csv ",", UTF-8, YYYY-MM-DD, 1234.56, debit and
//                           credit column pair

const fixture = (name: string): Uint8Array =>
  new Uint8Array(readFileSync(join(__dirname, "..", "fixtures", name)));

const detectOrThrow = (name: string): SourceProfileSpec => {
  const detected = detectSourceProfile(fixture(name));
  if (!detected.ok) {
    throw new Error(`detection failed for ${name}: ${detected.error.reason}`);
  }
  return detected.value;
};

describe("belfius-shaped current account fixture (signed column)", () => {
  const spec = detectOrThrow("belfius-account-a.csv");

  test("detects delimiter, encoding, header offset, date format, decimal style", () => {
    expect(spec.delimiter).toBe(";");
    expect(spec.encoding).toBe("windows-1252");
    expect(spec.headerRowIndex).toBe(1);
    expect(spec.dateFormat).toBe("DD/MM/YYYY");
    expect(spec.decimalStyle).toBe("comma");
  });

  test("detects the signed amount representation (hazard H1.1)", () => {
    expect(spec.amountRepresentation).toEqual({ kind: "signed", column: 8 });
  });

  test("detects column roles including statement and sequence numbers", () => {
    expect(spec.columns).toEqual({
      bookingDate: 2,
      valueDate: 3,
      accountIban: 4,
      counterpartyIban: 5,
      counterpartyName: 6,
      description: 7,
      statementNumber: 0,
      sequenceNumber: 1,
      // reference: none in this layout
    });
  });

  test("parses every row with integer-cent amounts and correct signs", () => {
    const parsed = parseStatement(fixture("belfius-account-a.csv"), spec);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }
    const amounts = parsed.value.rows.map((row) => row.amountCents);
    expect(amounts).toEqual([250000, -1250, -12530, -8647, -95000, 4200000]);
    for (const amount of amounts) {
      expect(Number.isInteger(amount)).toBe(true);
    }
    expect(parsed.value.rows[0]?.bookingDate).toBe("2026-08-03");
    expect(parsed.value.rows[1]?.description).toBe(
      "BETALING MET DEBETKAART CAFÉ ZOMER GENT",
    );
    expect(parsed.value.accountIbans).toEqual(["BE68539007547034"]);
  });

  test("keeps the verbatim source line on every parsed row", () => {
    const parsed = parseStatement(fixture("belfius-account-a.csv"), spec);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }
    expect(parsed.value.rows[0]?.rawLine).toBe(
      "7;0319;03/08/2026;03/08/2026;BE68539007547034;BE71096123456769;Acme Salaris BV;LOON JULI 2026;+2.500,00",
    );
  });
});

describe("card fixture family mirroring the observed KBC shape (indicator)", () => {
  const spec = detectOrThrow("kbc-card.csv");

  test("detects UTF-8, DD.MM.YY dates and the amount-plus-indicator representation", () => {
    expect(spec.delimiter).toBe(";");
    expect(spec.encoding).toBe("utf-8");
    expect(spec.dateFormat).toBe("DD.MM.YY");
    expect(spec.decimalStyle).toBe("comma");
    expect(spec.amountRepresentation).toEqual({
      kind: "indicator",
      amountColumn: 3,
      indicatorColumn: 4,
      debitValue: "D",
      creditValue: "C",
    });
  });

  test("has no counterparty-account column and no statement or sequence numbers", () => {
    expect(spec.columns.counterpartyIban).toBeUndefined();
    expect(spec.columns.accountIban).toBeUndefined();
    expect(spec.columns.statementNumber).toBeUndefined();
    expect(spec.columns.sequenceNumber).toBeUndefined();
  });

  test("parses the FX row's EUR amount to integer cents, sub-line content intact", () => {
    const parsed = parseStatement(fixture("kbc-card.csv"), spec);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }
    const fxRow = parsed.value.rows.find((row) =>
      row.description.includes("USD 25.00"),
    );
    expect(fxRow).toBeDefined();
    expect(fxRow?.amountCents).toBe(-2303);
    expect(Number.isInteger(fxRow?.amountCents)).toBe(true);
    expect(fxRow?.description).toBe(
      "AMAZON US SEATTLE USD 25.00 KOERS 0,9210",
    );
  });

  test("keeps both legitimate identical rows and the positive settlement row", () => {
    const parsed = parseStatement(fixture("kbc-card.csv"), spec);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }
    const duplicates = parsed.value.rows.filter(
      (row) => row.description === "STARBUCKS ANTWERPEN",
    );
    expect(duplicates).toHaveLength(2);
    expect(duplicates.map((row) => row.amountCents)).toEqual([-480, -480]);
    const settlement = parsed.value.rows.find(
      (row) => row.description === "DOMICILIERING VIA JE BANK",
    );
    expect(settlement?.amountCents).toBe(85000);
    expect(parsed.value.accountIbans).toEqual([]);
  });
});

describe("generic comma-delimited fixture (debit and credit pair)", () => {
  const spec = detectOrThrow("generic-debit-credit.csv");

  test("detects comma delimiter, YYYY-MM-DD dates and dot decimal style", () => {
    expect(spec.delimiter).toBe(",");
    expect(spec.encoding).toBe("utf-8");
    expect(spec.headerRowIndex).toBe(1);
    expect(spec.dateFormat).toBe("YYYY-MM-DD");
    expect(spec.decimalStyle).toBe("dot");
  });

  test("detects the debit and credit column pair by header", () => {
    expect(spec.amountRepresentation).toEqual({
      kind: "debitCredit",
      debitColumn: 4,
      creditColumn: 5,
    });
  });

  test("assigns own-account versus counterparty IBAN columns by header", () => {
    expect(spec.columns.accountIban).toBe(6);
    expect(spec.columns.counterpartyIban).toBe(1);
  });

  test("parses debits negative and credits positive, in integer cents", () => {
    const parsed = parseStatement(fixture("generic-debit-credit.csv"), spec);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }
    const amounts = parsed.value.rows.map((row) => row.amountCents);
    expect(amounts).toEqual([-74210, 250000, -1525, -8800]);
    for (const amount of amounts) {
      expect(Number.isInteger(amount)).toBe(true);
    }
    expect(parsed.value.rows[0]?.counterpartyName).toBe("Müller GmbH");
  });
});

describe("signed values in directional columns fail loud (finding CR-208)", () => {
  // A debit or credit column is DIRECTIONAL: the column decides the sign,
  // so a cell that carries its own sign is a convention the profile did
  // not declare. Before this fix, the debitCredit branch negated the
  // parsed value instead of a magnitude, so "-742.10" in a Debit column
  // silently stored +74210: a full sign inversion (reviewer construction
  // P7b, filed as CR-208). A sign is never guessed: the row fails, which
  // fails the import loudly with zero rows written.
  const pairSpec: SourceProfileSpec = {
    delimiter: ",",
    encoding: "utf-8",
    headerRowIndex: 0,
    dateFormat: "YYYY-MM-DD",
    decimalStyle: "dot",
    amountRepresentation: { kind: "debitCredit", debitColumn: 1, creditColumn: 2 },
    columns: { bookingDate: 0, description: 3 },
  };
  const bytes = (rows: readonly string[]): Uint8Array =>
    new TextEncoder().encode(["Date,Debit,Credit,Description", ...rows].join("\n"));

  const expectRowError = (row: string): void => {
    const parsed = parseStatement(bytes([row]), pairSpec);
    expect(parsed.ok).toBe(false);
    if (parsed.ok) {
      return;
    }
    expect(parsed.error).toMatchObject({ kind: "row-error", problem: "amount" });
  };

  test("a negative value inside the debit column is a row error, never an inverted sign", () => {
    expectRowError("2026-08-03,-742.10,,ACME STORE");
  });

  test("a negative value inside the credit column is a row error", () => {
    expectRowError("2026-08-04,,-15.25,REFUND CORNER SHOP");
  });

  test("an explicit plus sign inside the debit column is a row error", () => {
    expectRowError("2026-08-05,+88.00,,ACME STORE");
  });

  test("unsigned magnitudes keep parsing: debit negative, credit positive", () => {
    const parsed = parseStatement(
      bytes(["2026-08-03,742.10,,ACME STORE", "2026-08-04,,15.25,REFUND"]),
      pairSpec,
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }
    expect(parsed.value.rows.map((row) => row.amountCents)).toEqual([-74210, 1525]);
  });
});

describe("amount parsing never leaves integer cents (both decimal styles)", () => {
  const cases: readonly (readonly ["comma" | "dot", string, number])[] = [
    ["comma", "1.234,56", 123456],
    ["comma", "-30.941,50", -3094150],
    ["comma", "+42.000,00", 4200000],
    ["comma", "12,5", 1250],
    ["comma", "850,00", 85000],
    ["dot", "1234.56", 123456],
    ["dot", "-742.10", -74210],
    ["dot", "2500.00", 250000],
    ["dot", "15", 1500],
  ];
  for (const [style, text, expected] of cases) {
    test(`${style} style: ${text} -> ${expected} cents`, () => {
      const parsed = parseAmountToCents(text, style);
      expect(parsed.ok).toBe(true);
      if (parsed.ok) {
        expect(parsed.value).toBe(expected);
        expect(Number.isInteger(parsed.value)).toBe(true);
      }
    });
  }

  test("rejects text that is not an amount under the declared style", () => {
    expect(parseAmountToCents("12,50", "dot").ok).toBe(false);
    expect(parseAmountToCents("abc", "comma").ok).toBe(false);
    expect(parseAmountToCents("1,234.56", "comma").ok).toBe(false);
  });
});

describe("a debit and credit pair with an empty credit column this month (finding F3)", () => {
  // Hazard H1.1 outside the fixture matrix: a month with no credits must
  // not detect as a signed column and propose every debit POSITIVE. The
  // headers name the pair; an empty sibling column completes it.
  const spec = detectOrThrow("generic-debits-only.csv");

  test("detects the debit and credit pair, not a signed column", () => {
    expect(spec.amountRepresentation).toEqual({
      kind: "debitCredit",
      debitColumn: 4,
      creditColumn: 5,
    });
  });

  test("parses every debit NEGATIVE, in integer cents", () => {
    const parsed = parseStatement(fixture("generic-debits-only.csv"), spec);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }
    const amounts = parsed.value.rows.map((row) => row.amountCents);
    expect(amounts).toEqual([-31840, -1275, -8800]);
    for (const amount of amounts) {
      expect(Number.isInteger(amount)).toBe(true);
    }
  });
});

describe("an indicator value outside the detected pair fails the row (finding F2)", () => {
  // A sign is never guessed. The card spec's indicator pair is D/C; a row
  // whose marker is neither token (STORNO) or is blank must fail the row,
  // which fails the import loudly with nothing written, the same
  // discipline as the mixed-account check.
  const spec = detectOrThrow("kbc-card.csv");

  test("an unknown marker (STORNO) is a row error, not a guessed credit", () => {
    const parsed = parseStatement(fixture("kbc-card-storno.csv"), spec);
    expect(parsed.ok).toBe(false);
    if (parsed.ok) {
      return;
    }
    expect(parsed.error).toMatchObject({
      kind: "row-error",
      problem: "indicator",
      lineNumber: 4,
    });
  });

  test("a blank marker is a row error, not a guessed credit", () => {
    const parsed = parseStatement(fixture("kbc-card-blank-indicator.csv"), spec);
    expect(parsed.ok).toBe(false);
    if (parsed.ok) {
      return;
    }
    expect(parsed.error).toMatchObject({
      kind: "row-error",
      problem: "indicator",
      lineNumber: 4,
    });
  });

  test("the detected card spec names both members of the indicator pair", () => {
    expect(spec.amountRepresentation).toMatchObject({
      kind: "indicator",
      debitValue: "D",
      creditValue: "C",
    });
  });
});

describe("detection is deterministic", () => {
  test("the same bytes always detect the same spec", () => {
    const first = detectSourceProfile(fixture("kbc-card.csv"));
    const second = detectSourceProfile(fixture("kbc-card.csv"));
    expect(first).toEqual(second);
  });
});
