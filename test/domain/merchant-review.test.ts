import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { confirmImport } from "../../src/modules/import/application/confirm-import";
import { uploadStatement } from "../../src/modules/import/application/upload-statement";
import { recomputeInterpretation } from "../../src/modules/ledger/application/interpret-window";
import { assignMerchant } from "../../src/modules/merchants/application/assign-merchant";
import { listMerchantReview } from "../../src/modules/merchants/application/merchant-review";
import { counterpartyText } from "../../src/modules/merchants/domain/merchant-review";
import { normaliseCounterparty } from "../../src/modules/merchants/domain/normalise-counterparty";
import { foldGroups } from "../../src/modules/overview/domain/month-projection";
import type { CountedGroupRow } from "../../src/modules/overview/domain/month-projection";
import { maskCardNumbers } from "../../src/platform/ui/mask-card-number";
import type { Cents } from "../../src/platform/money";
import {
  householdId,
  userId,
  type HouseholdContext,
} from "../../src/platform/tenancy";
import { makeFakeImportWorld } from "../application/fake-import-world";

// M3-P6. Card rows carry no counterparty account, so the merchant key is
// the WHOLE descriptor, and a card descriptor embeds the transaction's own
// date, its own amount, the card number and the holder name. Every row
// therefore became its own group and naming a merchant wrote an EXACT rule
// that could never match a second transaction.
//
// Everything here runs over test/fixtures/card-descriptors.csv, which is
// SYNTHETIC: invented merchants, an invented card number (4000 1234 5678
// 9010) and an invented holder (JANSSENS PIETER), written in the grammar a
// real Belgian statement uses. No real statement content is committed
// anywhere in this repository, and the counts a real statement produced are
// NOT what any assertion here asserts.
//
// The whole flow is real: the real detector, the real parser, the real
// dedup, the real ledger engine and the real merchants use cases, over
// in-memory fakes of the ports (pulse-typescript section 8).

const context: HouseholdContext = {
  householdId: householdId("household-m3p6"),
  userId: userId("user-m3p6"),
};

const FIXTURE = "card-descriptors.csv";
const fixtureBytes = (): Uint8Array =>
  new Uint8Array(readFileSync(join(__dirname, "..", "fixtures", FIXTURE)));

const INVENTED_CARD_NUMBER = "4000123456789010";
const INVENTED_HOLDER = "JANSSENS PIETER";

// The descriptors of the ONE fixture merchant: five rows, two months, both
// printed card-tail shapes.
const ONE_MERCHANT_DESCRIPTORS = [
  "DEBITMASTERCARD-BETALING VIA GOOGLE PAY 04/08 KOFFIEHUIS DE MOLEN GENT BE 4,20 EUR KAART NR 4000 1234 5678 9010 - JANSSENS PIETER",
  "DEBITMASTERCARD-BETALING VIA GOOGLE PAY 11/08 KOFFIEHUIS DE MOLEN GENT BE 3,80 EUR KAART NR 4000 1234 5678 9010 - JANSSENS PIETER",
  "DEBITMASTERCARD-BETALING VIA GOOGLE PAY 18/08 KOFFIEHUIS DE MOLEN GENT BE 4,20 EUR KAART 4000 12XX XXXX 9010 - JANSSENS PIETER",
  "DEBITMASTERCARD-BETALING VIA GOOGLE PAY 02/09 KOFFIEHUIS DE MOLEN GENT BE 5,10 EUR KAART NR 4000 1234 5678 9010 - JANSSENS PIETER",
  "DEBITMASTERCARD-BETALING VIA GOOGLE PAY 09/09 KOFFIEHUIS DE MOLEN GENT BE 6,00 EUR KAART 4000 12XX XXXX 9010 - JANSSENS PIETER",
] as const;

// WHAT THE PRE-CHANGE RECIPE PRODUCED FOR THOSE FIVE ROWS, captured by
// running the base recipe (68fc7ee) over the same committed fixture and
// pinned here as literals. These are NEVER produced by calling the current
// normaliser: a self-seeded "before" is green for any recipe whatever.
const PRE_CHANGE_KEYS_OF_THE_ONE_MERCHANT = [
  "DEBITMASTERCARD-BETALING VIA GOOGLE PAY 04/08 KOFFIEHUIS DE MOLEN GENT BE 4,20 EUR KAART NR 4000 1234 5678 9010 - JANSSENS PIETER",
  "DEBITMASTERCARD-BETALING VIA GOOGLE PAY 11/08 KOFFIEHUIS DE MOLEN GENT BE 3,80 EUR KAART NR 4000 1234 5678 9010 - JANSSENS PIETER",
  "DEBITMASTERCARD-BETALING VIA GOOGLE PAY 18/08 KOFFIEHUIS DE MOLEN GENT BE 4,20 EUR KAART 4000 12XX - JANSSENS PIETER",
  "DEBITMASTERCARD-BETALING VIA GOOGLE PAY 02/09 KOFFIEHUIS DE MOLEN GENT BE 5,10 EUR KAART NR 4000 1234 5678 9010 - JANSSENS PIETER",
  "DEBITMASTERCARD-BETALING VIA GOOGLE PAY 09/09 KOFFIEHUIS DE MOLEN GENT BE 6,00 EUR KAART 4000 12XX - JANSSENS PIETER",
] as const;

const LONG_STRUCTURED_REFERENCE_DESCRIPTOR =
  "OVERSCHRIJVING NAAR ENERGIE NOORD BV MEDEDELING 415123456789012";
const LONG_STRUCTURED_REFERENCE = "415123456789012";

const NON_CARD_X_TOKEN_CONTROL_DESCRIPTOR =
  "ONLINE AANKOOP WEBSHOP DE VLIEGER 4000 12XX XXXX 9010 - JANSSENS PIETER";
// Captured against the base recipe, same as above.
const NON_CARD_X_TOKEN_CONTROL_PRE_CHANGE_KEY =
  "ONLINE AANKOOP WEBSHOP DE VLIEGER 4000 12XX - JANSSENS PIETER";

// THE SEPARATOR-INSENSITIVE TEST, used by BOTH halves of criterion 6.3: a
// card-number run is 13 to 19 digits once spaces, dots and dashes are
// removed. Not a contiguous-digit test: measured through the shipped
// pipeline on a real statement, descriptors carrying a CONTIGUOUS 16-digit
// run numbered zero while every card row carried a separator-insensitive
// one, so a contiguous regex here would match nothing and could never fail
// (finding PR3-001).
const cardNumberRuns = (text: string): readonly string[] =>
  text.replace(/[ .\-]/g, "").match(/(?<!\d)\d{13,19}(?!\d)/g) ?? [];

type World = ReturnType<typeof makeFakeImportWorld>;

const importFixture = async (world: World): Promise<void> => {
  const uploaded = await uploadStatement(context, world.deps, {
    fileName: FIXTURE,
    bytes: fixtureBytes(),
  });
  expect(uploaded.kind).toBe("awaiting-declaration");
  if (uploaded.kind !== "awaiting-declaration") {
    throw new Error("unreachable");
  }
  const detected = await world.deps.parser.detect(fixtureBytes());
  if (!detected.ok) {
    throw new Error("detection failed");
  }
  const confirmed = await confirmImport(context, world.deps, {
    importId: uploaded.importId,
    profileName: "Card descriptors export",
    spec: detected.value,
    declaration: { label: "Current A", bank: "Demobank", role: "POT" },
  });
  expect(confirmed.kind).toBe("ingested");
};

const importedWorld = async (): Promise<World> => {
  const world = makeFakeImportWorld();
  await importFixture(world);
  return world;
};

const reviewOf = (world: World) =>
  listMerchantReview(context, { merchants: world.merchantsPort });

const keysOf = (world: World): readonly string[] =>
  world.transactions.map((row) => normaliseCounterparty(counterpartyText(row)));

describe("criterion 6.1: the rows of ONE card merchant become ONE key and ONE review group", () => {
  test("the pre-change recipe produced one key per row, pinned as captured literals", () => {
    // Five rows, five keys: the defect. Pinned, never recomputed.
    expect(PRE_CHANGE_KEYS_OF_THE_ONE_MERCHANT).toHaveLength(5);
    expect(new Set(PRE_CHANGE_KEYS_OF_THE_ONE_MERCHANT).size).toBe(5);
  });

  test("the same five descriptors, differing in date, amount, month AND card-tail shape, now produce exactly ONE key", () => {
    const keys = ONE_MERCHANT_DESCRIPTORS.map((text) =>
      normaliseCounterparty(text),
    );
    expect(keys).toHaveLength(5);
    expect(new Set(keys).size).toBe(1);
  });

  test("the imported fixture yields exactly ONE review group for that merchant, holding all five rows", async () => {
    const world = await importedWorld();
    const review = await reviewOf(world);
    const groups = review.spend.filter((group) =>
      group.label.includes("KOFFIEHUIS DE MOLEN"),
    );
    expect(groups).toHaveLength(1);
    expect(groups[0]?.count).toBe(5);
  });

  test("the row carrying a legitimate 13-to-19-digit structured reference keeps it in its key", () => {
    const key = normaliseCounterparty(LONG_STRUCTURED_REFERENCE_DESCRIPTOR);
    expect(key).toContain(LONG_STRUCTURED_REFERENCE);
    // Exercised rather than dodged: the reference is inside the same 13-to-19
    // window the card-number sweep uses, which is the length real statements
    // carry (finding PR4-001).
    expect(cardNumberRuns(key)).toEqual([LONG_STRUCTURED_REFERENCE]);
  });

  test("the non-card control row, an X-masked token followed by holder-like text with NO card-number label, is UNCHANGED by the strip", () => {
    // This is what witnesses the anchor. An implementation that keys the
    // masked-tail pattern on the X token or on the holder text alone fires
    // here and fails: measured on a real statement, holder-like text follows
    // the X token in 8 of the 11 X-token descriptors, while the card-number
    // label occurs in 0 of them (finding PR5-003).
    expect(normaliseCounterparty(NON_CARD_X_TOKEN_CONTROL_DESCRIPTOR)).toBe(
      NON_CARD_X_TOKEN_CONTROL_PRE_CHANGE_KEY,
    );
  });
});

describe("criterion 6.2: over-stripping is refused", () => {
  test("two distinct merchants sharing a chain prefix AND a city stay two keys and two review groups", async () => {
    const world = await importedWorld();
    const review = await reviewOf(world);
    const chain = review.spend.filter((group) =>
      group.label.includes("SUPERMARKT DE LINDE"),
    );
    expect(chain).toHaveLength(2);
    expect(new Set(chain.map((group) => group.key)).size).toBe(2);
    expect(chain.some((group) => group.label.includes("NOORD"))).toBe(true);
    expect(chain.some((group) => group.label.includes("ZUID"))).toBe(true);
  });
});

describe("criterion 6.3: no card number in a key, in a rendered label, or on either screen", () => {
  test("(a) no normalised key from the card fixture contains the invented card number", async () => {
    const world = await importedWorld();
    for (const key of keysOf(world)) {
      expect(key.replace(/[ .\-]/g, "")).not.toContain(INVENTED_CARD_NUMBER);
    }
    // The holder name comes out with the card tail it follows. It survives
    // in exactly ONE key, the non-card control row, which carries
    // holder-like text with NO card-number label and which the strip must
    // therefore leave exactly where it was.
    const carryingHolder = keysOf(world).filter((key) =>
      key.includes(INVENTED_HOLDER),
    );
    expect(carryingHolder).toEqual([NON_CARD_X_TOKEN_CONTROL_PRE_CHANGE_KEY]);
  });

  test("(b) exactly ONE key carries a 13-to-19-digit run, and it is the named exception", async () => {
    const world = await importedWorld();
    const carrying = keysOf(world).filter(
      (key) => cardNumberRuns(key).length > 0,
    );
    // THE ONE PERMITTED EXCEPTION, named explicitly: the row criterion 6.1
    // declares as carrying a legitimate structured reference. Every other
    // key must be clean.
    expect(carrying).toEqual([LONG_STRUCTURED_REFERENCE_DESCRIPTOR]);
  });

  test("(b) no RENDERED group label carries a 13-to-19-digit run, on either label surface", async () => {
    const world = await importedWorld();
    const review = await reviewOf(world);
    // The merchant review's label surface.
    for (const group of [...review.income, ...review.spend]) {
      const rendered = maskCardNumbers(group.label);
      expect(cardNumberRuns(rendered)).toEqual([]);
      expect(rendered.replace(/[ .\-]/g, "")).not.toContain(
        INVENTED_CARD_NUMBER,
      );
    }
    // The month view's label surface. For an unresolved group both screens
    // set the label to the normalised text that IS the key (finding
    // PR5-002), so the sweep has to cover both or it is satisfied by the
    // accident of a row happening to be resolved.
    const rows: readonly CountedGroupRow[] = world.transactions.map((row) => ({
      merchantId: null,
      merchantName: null,
      primaryTag: null,
      counterpartyText: counterpartyText(row),
      isCash: false,
      totalCents: row.amountCents as Cents,
      rowCount: 1,
    }));
    const folded = foldGroups(rows, {
      useTags: false,
      normalise: normaliseCounterparty,
    });
    for (const group of folded) {
      const rendered = maskCardNumbers(group.label);
      expect(cardNumberRuns(rendered)).toEqual([]);
      expect(rendered.replace(/[ .\-]/g, "")).not.toContain(
        INVENTED_CARD_NUMBER,
      );
    }
  });

  test("the display helper masks a card-number run to its last four digits, in every printed shape", () => {
    expect(maskCardNumbers("KAART 4000 1234 5678 9010 X")).toBe(
      "KAART **** 9010 X",
    );
    expect(maskCardNumbers("KAART 4000-1234-5678-9010")).toBe("KAART **** 9010");
    expect(maskCardNumbers("KAART 4000.1234.5678.9010")).toBe("KAART **** 9010");
    expect(maskCardNumbers("KAART 4000123456789010")).toBe("KAART **** 9010");
    // The window boundaries: 13 and 19 are masked, 12 and 20 are not.
    expect(maskCardNumbers("1234567890123")).toBe("**** 0123");
    expect(maskCardNumbers("1234567890123456789")).toBe("**** 6789");
    expect(maskCardNumbers("123456789012")).toBe("123456789012");
    // A run LONGER than a card number is left whole rather than having its
    // first nineteen digits masked out of it.
    expect(maskCardNumbers("A 12345678901234567890 B")).toBe(
      "A 12345678901234567890 B",
    );
    // A short number a reader needs is untouched.
    expect(maskCardNumbers("BUS 42 GENT")).toBe("BUS 42 GENT");
  });

  test("the display helper is a pure string function and never touches the value the review form submits", async () => {
    const world = await importedWorld();
    const review = await reviewOf(world);
    for (const group of review.spend) {
      if (group.counterpartyText === undefined) {
        continue;
      }
      // The submitted subject is the UNMASKED normalised text. Masking it
      // would produce an EXACT rule that matches nothing (hazard H6.4).
      expect(group.counterpartyText).not.toContain("****");
      expect(group.counterpartyText).toBe(normaliseCounterparty(group.label));
    }
  });
});

describe("criterion 6.4: the review form's subject round-trips into a rule that matches every row", () => {
  test("naming a card group writes an EXACT rule on the unmasked text and resolves every row of that merchant, including the other month's", async () => {
    const world = await importedWorld();
    const before = await reviewOf(world);
    const group = before.spend.find((candidate) =>
      candidate.label.includes("KOFFIEHUIS DE MOLEN"),
    );
    expect(group).toBeDefined();
    if (group === undefined) {
      return;
    }
    const submitted = group.counterpartyText;
    expect(submitted).toBeDefined();
    if (submitted === undefined) {
      return;
    }
    expect(submitted).not.toContain("****");

    const outcome = await assignMerchant(
      context,
      {
        merchants: world.merchantsPort,
        recompute: (ctx: HouseholdContext) =>
          recomputeInterpretation(ctx, world.ledgerDeps),
      },
      { counterpartyText: submitted, merchantName: "Koffiehuis" },
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) {
      return;
    }
    expect(world.rules).toHaveLength(1);
    expect(world.rules[0]).toMatchObject({
      kind: "EXACT",
      pattern: submitted,
    });

    // Every row of that merchant now carries the merchant id, including the
    // September rows, which were not the row named.
    const rowsOfMerchant = world.transactions.filter((row) =>
      row.description.includes("KOFFIEHUIS DE MOLEN"),
    );
    expect(rowsOfMerchant).toHaveLength(5);
    expect(
      rowsOfMerchant.every(
        (row) => row.merchantId === outcome.value.merchant.id,
      ),
    ).toBe(true);
    expect(
      rowsOfMerchant.filter((row) => row.bookingDate.startsWith("2026-09")),
    ).toHaveLength(2);

    const after = await reviewOf(world);
    const named = after.spend.filter(
      (candidate) => candidate.merchantId === outcome.value.merchant.id,
    );
    expect(named).toHaveLength(1);
    expect(named[0]?.count).toBe(5);
  });
});

describe("criterion 6.5: facts untouched and no stored dedup key moved", () => {
  test("re-importing the card fixture adds zero rows and reports every row known", async () => {
    const world = await importedWorld();
    const rowCount = world.transactions.length;
    expect(rowCount).toBe(13);
    const again = await uploadStatement(context, world.deps, {
      fileName: FIXTURE,
      bytes: fixtureBytes(),
    });
    expect(again.kind).toBe("ingested");
    if (again.kind !== "ingested") {
      return;
    }
    expect(again.added).toBe(0);
    expect(again.known).toBe(rowCount);
    expect(world.transactions).toHaveLength(rowCount);
  });

  test("the stored rawLine is the source line verbatim and still carries the UNMASKED card number", async () => {
    const world = await importedWorld();
    const source = new TextDecoder()
      .decode(fixtureBytes())
      .split(/\r?\n/)
      .filter((line) => line.trim() !== "");
    // Every stored rawLine is one of the file's own lines, byte for byte.
    for (const row of world.transactions) {
      expect(source).toContain(row.rawLine);
    }
    // Masking is DISPLAY-only: the fact keeps the number the bank printed,
    // which is what the M3-P2 re-parse contract rebuilds rows from
    // (prisma/schema/import.prisma, CLAUDE.md non-negotiable 5).
    const cardRows = world.transactions.filter((row) =>
      row.description.includes("KAART NR"),
    );
    expect(cardRows.length).toBeGreaterThan(0);
    expect(
      cardRows.every((row) =>
        row.rawLine.replace(/[ .\-]/g, "").includes(INVENTED_CARD_NUMBER),
      ),
    ).toBe(true);
    expect(cardRows.every((row) => !row.rawLine.includes("****"))).toBe(true);
  });

  test("the stored rawContent is the uploaded bytes, byte for byte", async () => {
    const world = await importedWorld();
    const stored = [...world.imports.values()];
    expect(stored).toHaveLength(1);
    expect(stored[0]?.rawContent).toEqual(fixtureBytes());
  });
});
