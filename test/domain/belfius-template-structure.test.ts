import { describe, expect, test } from "vitest";
import { belfiusCurrentAccountTemplate } from "../../src/modules/import/domain/belfius-current-account-template";
import { parsePdfStatement } from "../../src/modules/import/domain/parse-pdf-statement";
import type { PdfLine } from "../../src/modules/import/domain/pdf-lines";

// Fix round 1, finding HZ-001: the review's executed constructions,
// committed as guards. Each of these was RED against the pre-fix
// template (captured in the work history): the fabricated row parsed as
// rows=2 with a truncated description, the corrupted zero row and the
// compensating pair vanished with parse OK, and the balance-shaped
// description line truncated description and rawLine, all with the
// balance gate green, because the gate compares sums only and zero-sum
// corruption is invisible to it. The fixes under test: positional line
// classification (indented lines are data, whatever their shape) and
// the within-file sequence-continuity gate.

const MARGIN = 87.8;
const INDENT = 99.8;
const margin = (text: string): PdfLine => ({ text, x: MARGIN });
const indented = (text: string): PdfLine => ({ text, x: INDENT });

const opening = [
  margin("BLZ. : 3/1"),
  margin(
    "----------------- BE72 0123 4567 8944 BIC: DEMOBEBB ------------------",
  ),
  margin("SALDO OP 30-04-2026 EUR + 100,00"),
];

const parse = belfiusCurrentAccountTemplate.parse;

describe("zero-sum corruption shapes the balance gate alone is blind to (HZ-001)", () => {
  test("an INDENTED line in the exact transaction-start shape is description data, never a fabricated row", () => {
    const result = parse([
      [
        ...opening,
        margin("0101 04-05-2026 (VAL. 04-05-2026) - 10,00"),
        indented("MEDEDELING VAN DE TEGENPARTIJ"),
        indented("0099 01-05-2026 (VAL. 01-05-2026) - 0,00"),
        indented("REST VAN DE MEDEDELING"),
        margin("SALDO OP 15-05-2026 17:45 EUR +90,00"),
      ],
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.rows).toHaveLength(1);
    // The crafted shape stays verbatim inside the one real row, so no
    // phantom natural key (2026:0099) exists to poison a future genuine
    // transaction's dedup key.
    expect(result.value.rows[0]?.description).toBe(
      "MEDEDELING VAN DE TEGENPARTIJ 0099 01-05-2026 (VAL. 01-05-2026) - 0,00 REST VAN DE MEDEDELING",
    );
    expect(result.value.rows[0]?.sequenceNumber).toBe("0101");
  });

  test("a corrupted margin-level start line inside the list fails loudly instead of dropping its zero-amount row", () => {
    const result = parse([
      [
        ...opening,
        margin("0101 04-05-2026 (VAL. 04-05-2026) - 10,00"),
        indented("EERSTE MEDEDELING"),
        // The glued sequence-and-date corruption: no longer a valid
        // start line, previously skipped silently with its row lost.
        margin("010205-05-2026 (VAL. 05-05-2026) - 0,00"),
        indented("TWEEDE MEDEDELING"),
        margin("0103 06-05-2026 (VAL. 06-05-2026) - 5,00"),
        margin("SALDO OP 15-05-2026 17:45 EUR +85,00"),
      ],
    ]);
    expect(result).toEqual({
      ok: false,
      error: { kind: "pdf-structure", problem: "unrecognized-line" },
    });
  });

  test("a corrupted compensating pair fails loudly instead of vanishing sum-neutrally", () => {
    const result = parse([
      [
        ...opening,
        margin("0101 04-05-2026 (VAL. 04-05-2026) - 10,00"),
        indented("EERSTE MEDEDELING"),
        margin("010205-05-2026 (VAL. 05-05-2026) + 5,00"),
        margin("010305-05-2026 (VAL. 05-05-2026) - 5,00"),
        margin("0104 06-05-2026 (VAL. 06-05-2026) - 5,00"),
        margin("SALDO OP 15-05-2026 17:45 EUR +85,00"),
      ],
    ]);
    expect(result).toEqual({
      ok: false,
      error: { kind: "pdf-structure", problem: "unrecognized-line" },
    });
  });

  test("an INDENTED line in the exact balance shape stays description data: no truncation of description or rawLine", () => {
    const result = parse([
      [
        ...opening,
        margin("0101 04-05-2026 (VAL. 04-05-2026) - 10,00"),
        indented("MEDEDELING DEEL EEN"),
        indented("SALDO OP 01-05-2026 EUR + 1,00"),
        indented("MEDEDELING DEEL TWEE"),
        margin("SALDO OP 15-05-2026 17:45 EUR +90,00"),
      ],
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.rows[0]?.description).toBe(
      "MEDEDELING DEEL EEN SALDO OP 01-05-2026 EUR + 1,00 MEDEDELING DEEL TWEE",
    );
    expect(result.value.rows[0]?.rawLine).toBe(
      [
        "0101 04-05-2026 (VAL. 04-05-2026) - 10,00",
        "MEDEDELING DEEL EEN",
        "SALDO OP 01-05-2026 EUR + 1,00",
        "MEDEDELING DEEL TWEE",
      ].join("\n"),
    );
    // Only the genuine margin-level balance lines counted as balances:
    // opening 100,00 plus the one -10,00 row reconciles to 90,00.
    expect(result.value.openingBalanceCents).toBe(10000);
    expect(result.value.closingBalanceCents).toBe(9000);
  });

  test("a sequence gap fails loudly (second structural member of the continuity class)", () => {
    const result = parse([
      [
        ...opening,
        margin("0101 04-05-2026 (VAL. 04-05-2026) - 10,00"),
        indented("EERSTE"),
        margin("0103 06-05-2026 (VAL. 06-05-2026) - 5,00"),
        indented("DERDE"),
        margin("SALDO OP 15-05-2026 17:45 EUR +85,00"),
      ],
    ]);
    expect(result).toEqual({
      ok: false,
      error: { kind: "pdf-structure", problem: "sequence-order" },
    });
  });

  test("a duplicated sequence fails loudly (third structural member)", () => {
    const result = parse([
      [
        ...opening,
        margin("0101 04-05-2026 (VAL. 04-05-2026) - 10,00"),
        indented("EERSTE"),
        margin("0101 05-05-2026 (VAL. 05-05-2026) + 10,00"),
        indented("DUBBEL"),
        margin("SALDO OP 15-05-2026 17:45 EUR +100,00"),
      ],
    ]);
    expect(result).toEqual({
      ok: false,
      error: { kind: "pdf-structure", problem: "sequence-order" },
    });
  });

  test("the real page shape stays green: holder furniture above the band, footer after the closing balance", () => {
    const result = parse([
      [
        margin("BLZ. : 3/1"),
        margin("Jansen Pieter"),
        margin("VOORBEELDSTRAAT 7 DATUM : 15-05-2026"),
        ...opening.slice(1),
        margin("0101 04-05-2026 (VAL. 04-05-2026) - 10,00"),
        indented("EERSTE MEDEDELING"),
        margin("SALDO OP 15-05-2026 17:45 EUR +90,00"),
        margin("DIT PRODUCT IS BESCHERMD DOOR HET GARANTIEFONDS."),
      ],
    ]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.rows).toHaveLength(1);
    }
  });
});

describe("templateVersion is consulted, fail closed (HZ-002)", () => {
  const pages = [
    [
      ...opening,
      margin("0101 04-05-2026 (VAL. 04-05-2026) - 10,00"),
      indented("MEDEDELING"),
      margin("SALDO OP 15-05-2026 17:45 EUR +90,00"),
    ],
  ];

  test("a declared version differing from the registered template's version refuses to parse", () => {
    // RED against the pre-fix code: parse ignored the version entirely
    // and produced byte-identical output for version 999 (captured in
    // the work history).
    const result = parsePdfStatement(pages, "belfius-current-account-nl", 999);
    expect(result).toEqual({
      ok: false,
      error: {
        kind: "template-version-mismatch",
        templateId: "belfius-current-account-nl",
        declaredVersion: 999,
        registeredVersion: 1,
      },
    });
  });

  test("the registered version parses", () => {
    expect(
      parsePdfStatement(pages, "belfius-current-account-nl", 1).ok,
    ).toBe(true);
  });
});
