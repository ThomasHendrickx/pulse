import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { statementParser } from "../../src/modules/import/adapters/statement-parser";
import {
  FIXTURE_A_TRANSACTIONS,
  FIXTURE_A_TOTAL_CENTS,
} from "../fixtures/generate-pdf-fixtures";
import type { ParsedStatement } from "../../src/modules/import/domain/parse-statement";
import type { SourceProfileSpec } from "../../src/modules/import/domain/source-profile";

// Criterion 2.1: the Belfius template against the synthetic fixture PDF,
// THROUGH the real extraction adapter (D-3: generating real PDF bytes
// keeps pdfjs extraction and line reconstruction inside the tested path,
// not only the template logic).

const fixture = (name: string): Uint8Array =>
  new Uint8Array(readFileSync(join(__dirname, "..", "fixtures", name)));

const parseFixtureA = async (): Promise<{
  spec: SourceProfileSpec;
  statement: ParsedStatement;
}> => {
  const bytes = fixture("belfius-statement-a.pdf");
  const detected = await statementParser.detect(bytes);
  expect(detected.ok).toBe(true);
  if (!detected.ok) {
    throw new Error("unreachable");
  }
  const parsed = await statementParser.parse(bytes, detected.value);
  expect(parsed.ok).toBe(true);
  if (!parsed.ok) {
    throw new Error("unreachable");
  }
  return { spec: detected.value, statement: parsed.value };
};

describe("Belfius current-account template over the synthetic fixture (criterion 2.1)", () => {
  test("the fingerprint selects the Belfius template, never a user question", async () => {
    const detected = await statementParser.detect(fixture("belfius-statement-a.pdf"));
    expect(detected.ok).toBe(true);
    if (detected.ok) {
      expect(detected.value).toEqual({
        kind: "pdf-layout",
        templateId: "belfius-current-account-nl",
        templateVersion: 1,
      });
    }
  });

  test("the expected row count parses and the amount sum equals the fixture's known total", async () => {
    const { statement } = await parseFixtureA();
    expect(statement.rows).toHaveLength(FIXTURE_A_TRANSACTIONS.length);
    const sum = statement.rows.reduce((total, row) => total + row.amountCents, 0);
    expect(sum).toBe(FIXTURE_A_TOTAL_CENTS);
    expect(statement.accountIbans).toEqual(["BE90012345678944"]);
  });

  test("the annex page contributes zero rows WHILE the in-description annex phrase row parses with the phrase verbatim in rawLine (finding PR2-002)", async () => {
    const { statement } = await parseFixtureA();
    // The annex page's amount-like lines are not transactions: exactly
    // the declared sequences exist, nothing from the annex body.
    expect(statement.rows.map((row) => row.sequenceNumber)).toEqual(
      FIXTURE_A_TRANSACTIONS.map((transaction) => transaction.sequence),
    );
    expect(
      statement.rows.some((row) => row.description.includes("BEWIJSSTUK")),
    ).toBe(false);
    // ...while the TRANSACTION whose description block carries the full
    // annex marker phrase parses as a row, phrase verbatim in rawLine.
    // Marker-anywhere page skipping fails this pair; body-starts-with
    // passes it.
    const markerRow = statement.rows.find((row) => row.sequenceNumber === "0104");
    expect(markerRow).toBeDefined();
    expect(markerRow?.amountCents).toBe(-25);
    expect(markerRow?.rawLine).toBe(
      [
        "0104 08-05-2026 (VAL. 07-05-2026) - 0,25",
        "INTERESTEN : 01.02.2026 - 30.04.2026 - ZIE",
        "BIJLAGE BIJ VERRICHTING 0104",
      ].join("\n"),
    );
  });

  test("a multi-line description is joined and its rawLine holds the block verbatim", async () => {
    const { statement } = await parseFixtureA();
    const row = statement.rows.find((candidate) => candidate.sequenceNumber === "0101");
    expect(row?.description).toBe(
      "DEBITMASTERCARD-BETALING VIA Google Pay 03/05 Koffiehuis Anker BE 3,55 EUR KAART NR 5599 2088 7766 5544 - Jansen Pieter",
    );
    expect(row?.rawLine).toBe(
      [
        "0101 04-05-2026 (VAL. 04-05-2026) - 3,55",
        "DEBITMASTERCARD-BETALING VIA Google Pay 03/05 Koffiehuis",
        "Anker BE 3,55 EUR KAART NR 5599 2088 7766 5544 - Jansen",
        "Pieter",
      ].join("\n"),
    );
  });

  test("every sign-spacing and thousands-dot combination parses to its expected integer cents", async () => {
    const { statement } = await parseFixtureA();
    // The fixture covers: spaced and tight signs, each with and without
    // a thousands dot, both directions (see FIXTURE_A_TRANSACTIONS).
    const bySequence = new Map(
      statement.rows.map((row) => [row.sequenceNumber, row.amountCents]),
    );
    for (const transaction of FIXTURE_A_TRANSACTIONS) {
      expect(bySequence.get(transaction.sequence), transaction.amountText).toBe(
        transaction.amountCents,
      );
    }
    // The combination matrix is real, not asserted: both spacings occur
    // with and without a thousands dot among the fixture's amount texts.
    const texts = FIXTURE_A_TRANSACTIONS.map((t) => t.amountText);
    expect(texts.some((t) => /^[+-] \d+,\d{2}$/.test(t))).toBe(true);
    expect(texts.some((t) => /^[+-] \d{1,3}(?:\.\d{3})+,\d{2}$/.test(t))).toBe(true);
    expect(texts.some((t) => /^[+-]\d+,\d{2}$/.test(t))).toBe(true);
    expect(texts.some((t) => /^[+-]\d{1,3}(?:\.\d{3})+,\d{2}$/.test(t))).toBe(true);
  });

  test("D-4 natural-key components: booking year as statement scope, sequence per row; counterparty IBAN from the description where present", async () => {
    const { statement } = await parseFixtureA();
    for (const row of statement.rows) {
      expect(row.statementNumber).toBe("2026");
      expect(row.sequenceNumber).toMatch(/^\d{4}$/);
    }
    const deposit = statement.rows.find((row) => row.sequenceNumber === "0102");
    expect(deposit?.counterpartyIban).toBe("BE45678901234515");
    const card = statement.rows.find((row) => row.sequenceNumber === "0101");
    expect(card?.counterpartyIban).toBeUndefined();
  });

  test("same bytes, same rows: extraction and reconstruction are deterministic (hazard H2.3)", async () => {
    const first = await parseFixtureA();
    const second = await parseFixtureA();
    expect(second.statement).toEqual(first.statement);
  });
});

describe("in-description structure shapes through the real extraction path (fix round 1, HZ-001)", () => {
  test("the inline transaction-start and balance shapes stay verbatim description data", async () => {
    const bytes = fixture("belfius-inline-shapes.pdf");
    const detected = await statementParser.detect(bytes);
    expect(detected.ok).toBe(true);
    if (!detected.ok) {
      throw new Error("unreachable");
    }
    const parsed = await statementParser.parse(bytes, detected.value);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }
    expect(parsed.value.rows).toHaveLength(2);
    expect(parsed.value.rows.map((row) => row.sequenceNumber)).toEqual([
      "0120",
      "0121",
    ]);
    // The fabricated-row shape: kept inside the description, no phantom
    // row, no phantom 2026:0198 natural key.
    expect(parsed.value.rows[0]?.description).toBe(
      "MEDEDELING VAN DE TEGENPARTIJ 0198 17-05-2026 (VAL. 17-05-2026) - 0,00 REST VAN DE VRIJE MEDEDELING",
    );
    // The balance shape: no truncation of description or rawLine.
    expect(parsed.value.rows[1]?.description).toBe(
      "TERUGBETALING MET VRIJE TEKST SALDO OP 17-05-2026 EUR + 480,00 EINDE VAN DE MEDEDELING",
    );
    expect(parsed.value.rows[1]?.rawLine).toBe(
      [
        "0121 18-05-2026 (VAL. 18-05-2026) + 35,00",
        "TERUGBETALING MET VRIJE TEKST",
        "SALDO OP 17-05-2026 EUR + 480,00",
        "EINDE VAN DE MEDEDELING",
      ].join("\n"),
    );
    const sum = parsed.value.rows.reduce((total, row) => total + row.amountCents, 0);
    expect(sum).toBe(1500);
  });
});
