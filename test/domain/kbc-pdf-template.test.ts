import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { statementParser } from "../../src/modules/import/adapters/statement-parser";
import { extractPdfPageItems } from "../../src/modules/import/adapters/pdf-text-extractor";
import { reconstructPdfLines } from "../../src/modules/import/domain/pdf-lines";
import { getTemplateById } from "../../src/modules/import/domain/pdf-template";
import {
  KBC_FIXTURE_OPENING_CENTS,
  KBC_FIXTURE_ROWS,
  KBC_FIXTURE_ROW_COUNT,
  KBC_FIXTURE_SUM_CENTS,
  KBC_MASKED_CARD,
} from "../fixtures/generate-pdf-fixtures";
import type { ParsedStatement } from "../../src/modules/import/domain/parse-statement";

// Criterion 3.1: the KBC Mastercard uitgavenstaat template against the
// synthetic fixture PDF, THROUGH the real extraction adapter (D-3), on
// the M3-P2 foundation: FX continuation lines fold into their row's
// rawLine and contribute zero rows, the DOMICILIERING credit is a real
// transaction row, the space-thousands Afrekening amount parses to
// integer cents, and the month-straddling row's bookingDate is its
// TRANSACTION date (pulse-v0.2-pdf-addendum.md:76, finding PR2-004).

const KBC_TEMPLATE_ID = "kbc-mastercard-uitgavenstaat";

const fixture = (name: string): Uint8Array =>
  new Uint8Array(readFileSync(join(__dirname, "..", "fixtures", name)));

const parseKbcFixture = async (): Promise<ParsedStatement> => {
  const bytes = fixture("kbc-statement-a.pdf");
  const detected = await statementParser.detect(bytes);
  expect(detected.ok).toBe(true);
  if (!detected.ok) {
    throw new Error("unreachable");
  }
  const parsed = await statementParser.parse(bytes, detected.value);
  expect(parsed.ok, JSON.stringify(parsed)).toBe(true);
  if (!parsed.ok) {
    throw new Error("unreachable");
  }
  return parsed.value;
};

describe("KBC card template over the synthetic fixture (criterion 3.1)", () => {
  test("the fingerprint selects the KBC template, never a user question", async () => {
    const detected = await statementParser.detect(fixture("kbc-statement-a.pdf"));
    expect(detected.ok).toBe(true);
    if (detected.ok) {
      expect(detected.value).toEqual({
        kind: "pdf-layout",
        templateId: KBC_TEMPLATE_ID,
        templateVersion: 1,
        // Fix round 2 (HZ-M3P3-02): the card's own identity is part of
        // the spec, so two cards of one issuer are two sources.
        accountIdentifier: KBC_MASKED_CARD,
      });
    }
  });

  test("the expected row count parses, FX continuation lines contribute ZERO rows, and the sum matches the fixture's known total", async () => {
    const statement = await parseKbcFixture();
    expect(statement.rows).toHaveLength(KBC_FIXTURE_ROW_COUNT);
    const sum = statement.rows.reduce((total, row) => total + row.amountCents, 0);
    expect(sum).toBe(KBC_FIXTURE_SUM_CENTS);
    // No row was minted from a continuation line: no description is a
    // Bedrag/Koers line, and every fixture description appears exactly
    // as often as the fixture declares it.
    expect(
      statement.rows.some((row) => /^(Bedrag|Koers)\b/.test(row.description)),
    ).toBe(false);
    expect(statement.rows.map((row) => row.description)).toEqual(
      KBC_FIXTURE_ROWS.map((row) => row.description),
    );
    // The card file carries no IBAN: account identity rides the profile
    // binding (upload-statement.ts resolveAccount), so the template
    // reports NO own-account identifier.
    expect(statement.accountIbans).toEqual([]);
  });

  test("FX continuation lines appear VERBATIM in their row's rawLine, and only there (hazard H3.2)", async () => {
    const statement = await parseKbcFixture();
    for (const fixtureRow of KBC_FIXTURE_ROWS) {
      const expectedRawLine = [
        `${fixtureRow.transactionDate} ${fixtureRow.settlementDate} ${fixtureRow.description} ${fixtureRow.amountText}`,
        ...(fixtureRow.fxLines ?? []),
      ].join("\n");
      const row = statement.rows.find(
        (candidate) => candidate.description === fixtureRow.description,
      );
      expect(row?.rawLine, fixtureRow.description).toBe(expectedRawLine);
    }
    // Both FX rows carry both their continuation lines; non-FX rows
    // carry none (single-line rawLine).
    const fxRows = statement.rows.filter((row) => row.rawLine.includes("\n"));
    expect(fxRows).toHaveLength(
      KBC_FIXTURE_ROWS.filter((row) => row.fxLines !== undefined).length,
    );
  });

  test("the DOMICILIERING credit is a transaction row with positive cents", async () => {
    const statement = await parseKbcFixture();
    const credit = statement.rows.find(
      (row) => row.description === "DOMICILIERING VIA JE BANK",
    );
    expect(credit).toBeDefined();
    expect(credit?.amountCents).toBe(123456);
    // It equals the negated previous balance, the card-side settlement
    // leg of the previous statement.
    expect(credit?.amountCents).toBe(-KBC_FIXTURE_OPENING_CENTS);
  });

  test("the space-thousands amounts parse to their expected integer cents, balances included", async () => {
    const bytes = fixture("kbc-statement-a.pdf");
    const extracted = await extractPdfPageItems(bytes);
    expect(extracted.ok).toBe(true);
    if (!extracted.ok) {
      throw new Error("unreachable");
    }
    const pages = extracted.value.map((page) => reconstructPdfLines(page));
    const template = getTemplateById(KBC_TEMPLATE_ID);
    expect(template).toBeDefined();
    const outcome = template?.parse(pages);
    expect(outcome?.ok).toBe(true);
    if (outcome?.ok !== true) {
      throw new Error("unreachable");
    }
    // "Vorig saldo op ... -1 234,56" and "Afrekening via je bank op ...
    // -1 234,56": the space thousands separator, read to exact cents.
    expect(outcome.value.openingBalanceCents).toBe(KBC_FIXTURE_OPENING_CENTS);
    expect(outcome.value.closingBalanceCents).toBe(
      KBC_FIXTURE_OPENING_CENTS + KBC_FIXTURE_SUM_CENTS,
    );
    // And a ROW amount in the space-thousands form.
    const bigRow = outcome.value.rows.find((row) =>
      row.description.startsWith("REISBUREAU"),
    );
    expect(bigRow?.amountCents).toBe(-105093);
  });

  test("the month-straddling row's bookingDate is its TRANSACTION date, never its settlement date (PR2-004)", async () => {
    const statement = await parseKbcFixture();
    const straddler = statement.rows.find((row) =>
      row.description.startsWith("KANTOORBOEK"),
    );
    expect(straddler).toBeDefined();
    // Transaction 31-05, settlement 02-06: the spend lands in May, the
    // month it happened.
    expect(straddler?.bookingDate).toBe("2026-05-31");
    expect(straddler?.bookingDate).not.toBe("2026-06-02");
    // The settlement date is kept: in the raw row text verbatim, and as
    // the value date.
    expect(straddler?.rawLine).toContain("02-06-2026");
    expect(straddler?.valueDate).toBe("2026-06-02");
  });

  test("no natural-key components: the card format has no sequence numbers, so the hash dedup path applies", async () => {
    const statement = await parseKbcFixture();
    for (const row of statement.rows) {
      expect(row.statementNumber).toBeUndefined();
      expect(row.sequenceNumber).toBeUndefined();
    }
  });

  test("same bytes, same rows: extraction and reconstruction are deterministic", async () => {
    const first = await parseKbcFixture();
    const second = await parseKbcFixture();
    expect(second).toEqual(first);
  });
});

describe("the balance identity gate on the KBC layout (criterion 3.1, hazard H3.2)", () => {
  test("the non-reconciling KBC variant fails the parse with balance-mismatch", async () => {
    const bytes = fixture("kbc-nonreconciling.pdf");
    const detected = await statementParser.detect(bytes);
    expect(detected.ok).toBe(true);
    if (!detected.ok) {
      throw new Error("unreachable");
    }
    const parsed = await statementParser.parse(bytes, detected.value);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.error.kind).toBe("balance-mismatch");
    }
  });
});

describe("loud structure guards on the KBC layout", () => {
  const template = getTemplateById(KBC_TEMPLATE_ID);
  const line = (text: string, x = 62.4): { text: string; x: number } => ({ text, x });
  const framed = (bodyLines: readonly { text: string; x: number }[]) => [
    [
      line("KBC-Mastercard", 59.5),
      line("Uitgavenstaat", 59.5),
      line("Vorig saldo op 16-05-2026 -10,00", 204.2),
      ...bodyLines,
      line("Afrekening via je bank op 22-06-2026 -10,00", 204.2),
    ],
  ];

  test("a corrupted row line (two-date prefix without a parseable amount) fails the parse with zero rows", () => {
    const outcome = template?.parse(
      framed([line("02-06-2026 03-06-2026 KAPOTTE REGEL ZONDER BEDRAG")]),
    );
    expect(outcome?.ok).toBe(false);
    if (outcome?.ok === false) {
      expect(outcome.error).toEqual({
        kind: "pdf-structure",
        problem: "unrecognized-line",
      });
    }
  });

  test("an FX continuation line with no open row fails the parse instead of being dropped", () => {
    const outcome = template?.parse(framed([line("Bedrag 5 USD", 218.4)]));
    expect(outcome?.ok).toBe(false);
    if (outcome?.ok === false) {
      expect(outcome.error).toEqual({
        kind: "pdf-structure",
        problem: "unrecognized-line",
      });
    }
  });
});

describe("fix round 2 structure guards on the KBC layout", () => {
  const template = getTemplateById(KBC_TEMPLATE_ID);
  const line = (text: string, x = 62.4): { text: string; x: number } => ({ text, x });
  // A well-formed miniature document: fingerprint, one card number, one
  // opening, one row, one closing. Each test below breaks exactly one of
  // those and asserts the specific loud failure.
  const document = (
    bodyLines: readonly { text: string; x: number }[],
  ): { text: string; x: number }[][] => [
    [
      line("KBC-Mastercard", 59.5),
      line("Uitgavenstaat", 59.5),
      ...bodyLines,
    ],
  ];
  const CARD = line("Kaartnummer(s): 5417 88XX XXXX 3210", 59.5);
  const OPENING = line("Vorig saldo op 16-05-2026 -10,00", 204.2);
  const CLOSING = line("Afrekening via je bank op 22-06-2026 -10,00", 204.2);

  test("the well-formed miniature parses, so every failure below is about the ONE thing it breaks", () => {
    const outcome = template?.parse(document([CARD, OPENING, CLOSING]));
    expect(outcome?.ok).toBe(true);
  });

  // HZ-M3P3-07: the header used to state the balance shape as singular
  // and nothing kept it singular. The parse silently kept the first
  // opening and the LAST closing, so a repeated or corrected balance line
  // changed the parsed identity with nothing said.
  test("two DIFFERENT previous-balance lines fail loudly instead of silently keeping the first", () => {
    const outcome = template?.parse(
      document([
        CARD,
        OPENING,
        line("Vorig saldo op 16-05-2026 -20,00", 204.2),
        CLOSING,
      ]),
    );
    expect(outcome?.ok).toBe(false);
    if (outcome?.ok === false) {
      expect(outcome.error).toEqual({
        kind: "pdf-structure",
        problem: "ambiguous-balance-lines",
      });
    }
  });

  test("two DIFFERENT settlement-total lines fail loudly instead of silently keeping the last", () => {
    const outcome = template?.parse(
      document([
        CARD,
        OPENING,
        CLOSING,
        line("Afrekening via je bank op 22-06-2026 -20,00", 204.2),
      ]),
    );
    expect(outcome?.ok).toBe(false);
    if (outcome?.ok === false) {
      expect(outcome.error).toEqual({
        kind: "pdf-structure",
        problem: "ambiguous-balance-lines",
      });
    }
  });

  test("a balance line REPEATED with the same value is a reprinted header block, folded rather than refused", () => {
    const outcome = template?.parse(
      document([CARD, OPENING, OPENING, CLOSING, CLOSING]),
    );
    expect(outcome?.ok).toBe(true);
  });

  // HZ-M3P3-02: a card file whose own identity cannot be read is never
  // bound to whatever account a spec-equal profile happens to hold.
  test("a card document carrying NO card number fails loudly rather than binding to a profile's account", () => {
    const outcome = template?.parse(document([OPENING, CLOSING]));
    expect(outcome?.ok).toBe(false);
    if (outcome?.ok === false) {
      expect(outcome.error).toEqual({
        kind: "pdf-structure",
        problem: "no-account-identifier",
      });
    }
  });

  test("a card document carrying TWO DIFFERENT card numbers fails loudly (the unobserved multi-card statement, M3P3-Q2)", () => {
    const outcome = template?.parse(
      document([
        CARD,
        line("Kaartnummer(s): 5417 88XX XXXX 7654", 59.5),
        OPENING,
        CLOSING,
      ]),
    );
    expect(outcome?.ok).toBe(false);
    if (outcome?.ok === false) {
      expect(outcome.error).toEqual({
        kind: "pdf-structure",
        problem: "no-account-identifier",
      });
    }
    // And detection reports no identity for it either, rather than
    // guessing which card the rows belong to.
    expect(
      template?.accountIdentifier?.(
        document([
          CARD,
          line("Kaartnummer(s): 5417 88XX XXXX 7654", 59.5),
          OPENING,
          CLOSING,
        ]),
      ),
    ).toBeUndefined();
  });
});

describe("the companion Belfius fixture still parses under the Belfius template", () => {
  test("the settlement debit row is present with the card statement number and no counterparty IBAN", async () => {
    const bytes = fixture("belfius-settlement-companion.pdf");
    const detected = await statementParser.detect(bytes);
    expect(detected.ok).toBe(true);
    if (!detected.ok) {
      throw new Error("unreachable");
    }
    expect(detected.value).toEqual({
      kind: "pdf-layout",
      templateId: "belfius-current-account-nl",
      templateVersion: 1,
    });
    const parsed = await statementParser.parse(bytes, detected.value);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      throw new Error("unreachable");
    }
    const debit = parsed.value.rows.find((row) => row.sequenceNumber === "0131");
    expect(debit?.amountCents).toBe(-123456);
    expect(debit?.description).toContain("MASTERCARD AFREKENING NUMMER 30456");
    expect(debit?.counterpartyIban).toBeUndefined();
  });
});
