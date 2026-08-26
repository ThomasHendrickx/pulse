import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";
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

  // THE HAZARD ESCALATION CARRIED FROM ROUND 0, answered here. The one
  // fixture pair above varies a BRANCH token inside the merchant name, and
  // the two collapse paths this phase introduces are outside its reach: the
  // rail prefix, which sits BEFORE the merchant name, and the trailing-city
  // loop, which sits after it. Both now have their own pair, and a collapse
  // in either writes ONE stored EXACT rule over two merchants, which no
  // total reveals.
  test("a descriptor opening with an ordinary hyphenated word is NOT read as a payment rail (finding HZ-M3P6-03)", async () => {
    const world = await importedWorld();
    const review = await reviewOf(world);
    const withPrefix = review.spend.filter((group) =>
      group.label.includes("GROEPS-AANKOOP"),
    );
    const withoutPrefix = review.spend.filter(
      (group) =>
        group.label.includes("SAMENTUIN") && !group.label.includes("GROEPS"),
    );
    expect(withPrefix).toHaveLength(1);
    expect(withoutPrefix).toHaveLength(1);
    expect(withPrefix[0]?.key).not.toBe(withoutPrefix[0]?.key);
  });

  test("the same merchant paid on BOTH payment rails is ONE key and ONE group (finding HZ-M3P6-06)", async () => {
    const world = await importedWorld();
    const rows = world.transactions.filter((row) =>
      row.description.includes("BAKKERIJ ZONNEBLOEM"),
    );
    // Two rows on the contactless rail, one on the wallet rail.
    expect(rows).toHaveLength(3);
    expect(
      rows.filter((row) => row.description.startsWith("BANCONTACT-AANKOOP")),
    ).toHaveLength(2);
    expect(
      rows.filter((row) =>
        row.description.startsWith("DEBITMASTERCARD-BETALING"),
      ),
    ).toHaveLength(1);
    expect(
      new Set(rows.map((row) => normaliseCounterparty(counterpartyText(row))))
        .size,
    ).toBe(1);
    const review = await reviewOf(world);
    const groups = review.spend.filter((group) =>
      group.label.includes("BAKKERIJ ZONNEBLOEM"),
    );
    expect(groups).toHaveLength(1);
    expect(groups[0]?.count).toBe(3);
  });
});

describe("the key space is closed under the pipeline, which is what makes a stored rule match (hazard H6.4)", () => {
  // assign-merchant.ts normalises the submitted subject AGAIN before storing
  // it, and the review form submits the already-normalised key, so a key the
  // pipeline would strip further becomes a stored EXACT rule that matches
  // NOTHING while every total stays right. This is the invariant, asserted
  // over every group the fixture produces rather than over one example.
  test("normalising any group's submitted subject returns that subject unchanged", async () => {
    const world = await importedWorld();
    const review = await reviewOf(world);
    const subjects = [...review.income, ...review.spend]
      .map((group) => group.counterpartyText)
      .filter((subject): subject is string => subject !== undefined);
    expect(subjects.length).toBeGreaterThan(0);
    for (const subject of subjects) {
      expect(normaliseCounterparty(subject), subject).toBe(subject);
    }
  });

  test("the fixture reaches the shape that broke closure, so this invariant is not measuring the fixture's convenience", async () => {
    // FINDING CR-M3P6-06b. The round-1 version of this invariant read only
    // the fixture's groups, and the fixture carried no run of four-digit
    // groups before a capitalised word, so it was green while the property
    // was false on ten of the owner's own rows. An invariant that reads only
    // the fixture measures the fixture. Two rows now carry that shape, and
    // the EXHAUSTIVE corpus lives beside the recipe it constrains, in
    // test/domain/normalise-counterparty.test.ts, where it is also run
    // against a second and a third application to catch erosion.
    const world = await importedWorld();
    const runsOfGroups = world.transactions.filter((row) =>
      /\b\d{4} \d{4}(?: \d{4})* [A-Z]/.test(row.description.toUpperCase()),
    );
    expect(runsOfGroups.length).toBeGreaterThanOrEqual(2);
    for (const row of runsOfGroups) {
      const key = normaliseCounterparty(counterpartyText(row));
      expect(normaliseCounterparty(key), key).toBe(key);
      // Not merely equal: the same number of tokens, so a defect that
      // erodes one group per pass is visible even if it later stabilises.
      expect(normaliseCounterparty(key).split(" ").length).toBe(
        key.split(" ").length,
      );
    }
  });
});

describe("criterion 6.3: no card number in a key, in a rendered label, or on either screen", () => {
  test("(a) no normalised key from the card fixture contains the invented card number", async () => {
    const world = await importedWorld();
    for (const key of keysOf(world)) {
      expect(key.replace(/[ .\-]/g, "")).not.toContain(INVENTED_CARD_NUMBER);
    }
    // FINDING HZ-M3P6-02: the fixture now carries a card descriptor with NO
    // merchant span, which strips to nothing and reaches the non-destructive
    // floor. The floor used to be the RAW input, which put the full card
    // number into the key and therefore into the stored rule pattern.
    const floored = keysOf(world).filter((key) => key === "KAART NR");
    expect(floored).toHaveLength(1);
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

  test("(b) no RENDERED group label carries a 13-to-19-digit run except the ONE named exception, on either label surface", async () => {
    const world = await importedWorld();
    const review = await reviewOf(world);
    // THE ONE PERMITTED EXCEPTION, on the label side as well as the key
    // side. Both are needed because for an UNRESOLVED group the key and the
    // rendered label are the SAME STRING (finding PR5-002), so an exception
    // covering only the key would be satisfiable by the accident of the row
    // being resolved. Since fix round 1 narrowed the display helper to the
    // card-tail grammar (finding HZ-M3P6-01), this exception is REAL rather
    // than vacuous: the reference is not a card number, so nothing masks it,
    // and it stays legible to the owner exactly as it should (finding
    // HZ-M3P6-07).
    const carryingReview: string[] = [];
    for (const group of [...review.income, ...review.spend]) {
      const rendered = maskCardNumbers(group.label);
      if (cardNumberRuns(rendered).length > 0) {
        carryingReview.push(rendered);
      }
      expect(rendered.replace(/[ .\-]/g, "")).not.toContain(
        INVENTED_CARD_NUMBER,
      );
    }
    expect(carryingReview).toEqual([LONG_STRUCTURED_REFERENCE_DESCRIPTOR]);
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
    const carryingMonth: string[] = [];
    for (const group of folded) {
      const rendered = maskCardNumbers(group.label);
      if (cardNumberRuns(rendered).length > 0) {
        carryingMonth.push(rendered);
      }
      expect(rendered.replace(/[ .\-]/g, "")).not.toContain(
        INVENTED_CARD_NUMBER,
      );
    }
    expect(carryingMonth).toEqual([LONG_STRUCTURED_REFERENCE_DESCRIPTOR]);
  });

  test("the display helper masks a card-number tail to its last four characters, in every printed shape", () => {
    expect(maskCardNumbers("KAART NR 4000 1234 5678 9010 X")).toBe(
      "KAART NR **** 9010 X",
    );
    expect(maskCardNumbers("KAART 4000-1234-5678-9010")).toBe("KAART **** 9010");
    expect(maskCardNumbers("KAART NR 4000.1234.5678.9010")).toBe(
      "KAART NR **** 9010",
    );
    expect(maskCardNumbers("KAART NR 4000123456789010")).toBe(
      "KAART NR **** 9010",
    );
    // The partially masked tail the bank itself prints.
    expect(maskCardNumbers("KAART 4000 12XX XXXX 9010")).toBe(
      "KAART **** 9010",
    );
    // FINDING CR-M3P6-04: a DOUBLE separator between two groups must not
    // slip a whole card number past the mask. This helper reads RAW
    // descriptors on the confirm preview, where nothing has collapsed the
    // whitespace first.
    expect(maskCardNumbers("KAART NR 4000  1234 5678 9010")).toBe(
      "KAART NR **** 9010",
    );
  });

  test("the display helper leaves an ordinary noun that happens to be a label word untouched (finding HZ-M3P6-12)", () => {
    // The mirror of the normaliser's negative pins. Before the final micro
    // round both of these rendered as a four-star mask plus four digits,
    // turning a non-card reference into something that looks like a masked
    // card number, which is the display class of finding HZ-M3P6-01
    // returning in a narrow form.
    for (const text of [
      "RESTAURANT BISTRO A LA CARTE 1234 5678 9012 3456",
      "DIENST CARTE N 1234 5678 9012 3456",
    ]) {
      expect(maskCardNumbers(text), text).toBe(text);
    }
    // ... while the printed French and English card tails still mask.
    expect(maskCardNumbers("CARTE N\u00b0 4000 1234 5678 9010")).toBe(
      "CARTE N\u00b0 **** 9010",
    );
    expect(maskCardNumbers("CARD NO 4000 1234 5678 9010")).toBe(
      "CARD NO **** 9010",
    );
  });

  test("the display helper leaves every NON-card identifier untouched (finding HZ-M3P6-01)", () => {
    // THE SIX SHAPES THE REVIEW MEASURED THE OLD, SHAPE-ONLY HELPER
    // DAMAGING on the owner's two real statements, reproduced here with
    // INVENTED values in the same grammar. Each is an identity the owner
    // reads to tell one unresolved group from another, and none is a card
    // number. The old helper masked six of these on real data while masking
    // zero card numbers.
    const untouched = [
      // A spaced IBAN inside a transfer descriptor.
      "OVERSCHRIJVING NAAR BE68 5390 0754 7034 ENERGIE NOORD",
      // The same IBAN printed compact.
      "OVERSCHRIJVING NAAR BE68539007547034 ENERGIE NOORD",
      // A hyphenated SEPA mandate reference.
      "DOMICILIERING MANDAAT 4152036987-001 ENERGIE NOORD",
      // A Belgian phone number as a merchant prints it.
      "KLANTENDIENST 02 123 45 67 ENERGIE NOORD",
      // Two short numeric fields ONE SPACE apart: the join the old helper's
      // own comment claimed could never happen.
      "SHOP REF 07 24681357913 S",
      // The digit tail of an ALPHANUMERIC merchant token, joined across one
      // space to the field after it: the old helper ate four characters out
      // of the merchant's own name.
      "SHOP Q82B07 24681357913 S",
      // A legitimate long structured reference, the row criterion 6.3(b)
      // names as its permitted exception.
      "OVERSCHRIJVING NAAR ENERGIE NOORD BV MEDEDELING 415123456789012",
    ];
    for (const text of untouched) {
      expect(maskCardNumbers(text), text).toBe(text);
    }
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

describe("criterion 6.10, the SQL half: the merchant-source rule is written ONCE per language (findings HZ-M3P6-05 and CR-M3P6-02)", () => {
  // Criterion 6.10's pin is a TypeScript expression and is structurally
  // blind to SQL, while the copy the MONTH VIEW's grouping actually reads is
  // written in SQL. Decision D-11's operative content is "one definition",
  // so the rule needs one pin per language. This is the SQL one: no
  // database, one file read.
  const repositorySource = readFileSync(
    join(
      __dirname,
      "..",
      "..",
      "src",
      "modules",
      "overview",
      "adapters",
      "overview-repository.ts",
    ),
    "utf8",
  );

  test("the SQL form of the rule appears exactly once, as the shared fragment", () => {
    const occurrences =
      repositorySource.match(
        /COALESCE\(\s*t\."counterpartyName",\s*t\."description"\s*\)/g,
      ) ?? [];
    expect(occurrences).toHaveLength(1);
    expect(repositorySource).toContain(
      'const COUNTERPARTY_TEXT_SQL = Prisma.sql`COALESCE(t."counterpartyName", t."description")`',
    );
  });

  test("every SQL read that projects the descriptor uses the shared fragment rather than its own copy", () => {
    // THREE USES AT THIS HEAD, and the count is exact rather than a floor so
    // that a fourth read growing its own COALESCE is caught by the test
    // above (which pins the raw form to ONE occurrence) rather than passing
    // here. M3-P14 criterion 14.15 witness SEVEN added the third: the held
    // read projects each held row's descriptor, because a reserve
    // statement's interest credit has no counterpart row on any pot account
    // and the household could otherwise never see it.
    const uses = repositorySource.match(/\$\{COUNTERPARTY_TEXT_SQL\}/g) ?? [];
    expect(uses).toHaveLength(3);
  });

  // CORRECTED RATHER THAN QUIETLY RENAMED (clause R-087, fix round 2,
  // finding CR-M3P6-07). A test here used to be named "the SQL rule and the
  // TypeScript rule agree on every value Prisma can produce" and its body
  // called counterpartyText three times, evaluating no SQL at all. The
  // review demonstrated the gap rather than arguing it: setting the shared
  // fragment to the OPPOSITE precedence and updating the two pin literals
  // the way a pin update looks left the suite green at 22 passed, with the
  // two rules then saying opposite things. That test is split in two below.
  // The first says only what it establishes. The second closes the gap the
  // old name claimed to close, WITHOUT a database: it reads the SQL
  // fragment out of the repository file, derives the operand ORDER from the
  // text, and evaluates that order against the TypeScript helper over a
  // value corpus. Flipping the precedence in the SQL now reddens it, and no
  // pin literal can be updated to hide that, because the expectation is
  // derived from the SQL rather than written beside it.
  test("the TypeScript rule's fallthrough is pinned on every value Prisma can produce", () => {
    expect(counterpartyText({ description: "D" })).toBe("D");
    expect(counterpartyText({ description: "D", counterpartyName: "N" })).toBe(
      "N",
    );
    expect(counterpartyText({ description: "D", counterpartyName: "" })).toBe(
      "",
    );
  });

  test("the SQL rule, evaluated from its own text, agrees with the TypeScript rule on every value Prisma can produce", () => {
    // The operand order is READ from the shipped SQL, never assumed.
    const operands = /COALESCE\(\s*t\."(\w+)",\s*t\."(\w+)"\s*\)/.exec(
      repositorySource,
    );
    expect(operands).not.toBeNull();
    if (operands === null) {
      return;
    }
    const [, first, second] = operands as unknown as [string, string, string];
    // COALESCE returns its first non-NULL argument. Prisma maps a nullable
    // text column to string | null, and the domain type carries the same
    // field as optional, so undefined and null are the same absence here.
    const evaluateSql = (row: Record<string, string | undefined>): string => {
      const a = row[first];
      const b = row[second];
      return a ?? b ?? "";
    };
    const corpus: readonly Record<string, string | undefined>[] = [
      { description: "D" },
      { description: "D", counterpartyName: "N" },
      { description: "D", counterpartyName: "" },
      { description: "", counterpartyName: "N" },
      { description: "", counterpartyName: "" },
      { description: "SAME", counterpartyName: "SAME" },
    ];
    for (const row of corpus) {
      const description = row["description"] ?? "";
      const name = row["counterpartyName"];
      const typescriptResult = counterpartyText({
        description,
        ...(name === undefined ? {} : { counterpartyName: name }),
      });
      expect(evaluateSql(row), JSON.stringify(row)).toBe(typescriptResult);
    }
  });

  test("the card-number LABEL vocabulary is identical in the two definitions that use it (finding HZ-M3P6-10)", () => {
    // A label pinned in only one of the two puts a card number on SCREEN or
    // into a STORED RULE depending on which one was missed. The two files
    // cannot import from each other (domain code imports nothing; the
    // masker lives in platform/ui), so the duplication is deliberate and
    // this is its guard.
    // The declaration spans two lines since the final micro round narrowed
    // the alternation, so the pattern reads to the terminating semicolon
    // rather than to the end of a line.
    const labelLine = /^const CARD_NUMBER_LABEL =[\s\S]*?;$/m;
    const inNormaliser = labelLine.exec(
      readFileSync(
        join(
          __dirname,
          "..",
          "..",
          "src",
          "modules",
          "merchants",
          "domain",
          "normalise-counterparty.ts",
        ),
        "utf8",
      ),
    );
    const inMasker = labelLine.exec(
      readFileSync(
        join(__dirname, "..", "..", "src", "platform", "ui", "mask-card-number.ts"),
        "utf8",
      ),
    );
    expect(inNormaliser).not.toBeNull();
    expect(inMasker).not.toBeNull();
    expect(inMasker?.[0]).toBe(inNormaliser?.[0]);
    // And it really does carry the three languages, so a future narrowing
    // reddens here rather than silently on a French export.
    expect(inNormaliser?.[0]).toContain("KAART");
    expect(inNormaliser?.[0]).toContain("CARTE");
    expect(inNormaliser?.[0]).toContain("CARD");
    // ... and that only the DUTCH label may appear bare (finding
    // HZ-M3P6-12): the French and English forms must carry the number word,
    // because their label word is an ordinary noun and the bare form is
    // observed in Dutch only.
    expect(inNormaliser?.[0]).toContain("(?:CARTE|CARD)");
    expect(inNormaliser?.[0]).toMatch(/\(\?:CARTE\|CARD\)\\\\s\+/);
  });
});

describe("every rendering surface that shows descriptor text is derived, not remembered (finding CR-M3P6-08)", () => {
  // THE DERIVATION IS THIS TEST, not a grep in a comment. Round 1 recorded a
  // single-line grep; applying the fix moved the cells onto several lines
  // and the grep stopped finding them, so the record of how the surface set
  // was found was falsified by the act of using it. Worse, the review
  // constructed the dangerous direction: with the descriptor cell reverted
  // to an UNMASKED multi-line expression the recorded grep found NOTHING in
  // that file and the suite stayed green.
  //
  // This walks the real JSX with the TypeScript compiler API, the same tool
  // test/schema/tenancy.test.ts uses, so it cannot be defeated by
  // reformatting. Every JSX expression that reads a descriptor-derived field
  // must either pass through maskCardNumbers or appear in the EXCLUSIONS
  // table below with its reason.

  // A field whose value is, or can be, text a counterparty controls.
  const DESCRIPTOR_FIELDS = [
    "description",
    "counterpartyText",
    "counterpartyName",
    "rawLine",
    "label",
    "text",
  ] as const;

  // Keyed by FILE and EXPRESSION TEXT, never by a line number, because a
  // line number is what went stale last round. RESIDUE, stated rather than
  // left to be found: an exclusion excuses that exact expression ANYWHERE in
  // that file, so a second bare {group.label} added to month-view.tsx would
  // be excused by the reserves entry. It would still have to be written in
  // a file already on this list, and the e2e sweeps the two label surfaces
  // independently.
  const EXCLUSIONS: readonly {
    readonly file: string;
    readonly expression: string;
    readonly why: string;
  }[] = [
    {
      file: "modules/merchants/ui/merchant-review.tsx",
      expression: "group.counterpartyText",
      why: "The hidden field the review form submits. It becomes the EXACT MerchantRule pattern, and a masked subject would match nothing (decision D-12, hazard H6.4).",
    },
    {
      file: "modules/overview/ui/month-view.tsx",
      expression: "group.label",
      why: "The RESERVES group label, which is the household's own declared account label or a counterparty IBAN, never a descriptor: the reserves query requires counterpartyIban IS NOT NULL and falls back to the account's declared label.",
    },
    {
      file: "modules/overview/ui/month-view.tsx",
      expression: "part.label",
      why: "The reconciliation part label: translated copy from t(), never counterparty text.",
    },
    {
      file: "app/(app)/import/[id]/page.tsx",
      expression: "account?.label",
      why: "The account's DECLARED label, typed by the household itself at first sight, never parsed from a statement line.",
    },
    {
      file: "app/(app)/import/[id]/page.tsx",
      expression: "landingAccount?.label",
      why: "The same declared account label on the landing branch of the same route.",
    },
    {
      file: "modules/overview/ui/month-view.tsx",
      expression: "entry.label",
      why: "The month-accounts entry label (M3-P14 criterion 14.15): the household's own DECLARED account label, typed by them at registration or at first sight, and read back from the accounts table by the two per-account reads. It is never parsed from a statement line, so there is no descriptor for a card number to be hiding in.",
    },
    {
      file: "modules/accounts/ui/accounts-screen.tsx",
      expression: "account.label",
      why: "The accounts screen's own list: the same declared account label, from the same column, on the screen where the household typed it.",
    },
    {
      file: "modules/accounts/ui/accounts-screen.tsx",
      expression: "t(key, { label: params.label ?? \"\", country: params.country ?? \"\", expected: params.expected ?? \"\", actual: params.actual ?? \"\", })",
      why: "Translated copy from t(), interpolating a declared account label and the validity refusal's own country and length values. No descriptor field reaches it; the walk sees it only because one interpolated key is named label.",
    },
    {
      file: "modules/accounts/ui/accounts-screen.tsx",
      expression: "t(\"accountsRulesStopped\", { count: rules, label: params.label ?? \"\", })",
      why: "Translated copy from t(), interpolating the same declared account label and a count of merchant rules. Named for the same reason as the line above.",
    },
  ];

  const collectSourceFiles = (dir: string): readonly string[] => {
    const out: string[] = [];
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        out.push(...collectSourceFiles(full));
      } else if (entry.endsWith(".tsx")) {
        out.push(full);
      }
    }
    return out;
  };

  const srcRoot = join(__dirname, "..", "..", "src");

  type Surface = {
    readonly file: string;
    readonly expression: string;
    readonly masked: boolean;
  };

  const surfaces: Surface[] = [];
  for (const file of collectSourceFiles(srcRoot)) {
    const sourceText = readFileSync(file, "utf8");
    const sourceFile = ts.createSourceFile(
      file,
      sourceText,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX,
    );
    // Only LEAF expressions: a map callback or a ternary whose body is JSX
    // is a container for the real site, and the real site is visited on its
    // own. Counting containers would inflate the set and hide the leaf.
    const containsJsx = (node: ts.Node): boolean => {
      let found = false;
      const look = (child: ts.Node): void => {
        if (
          ts.isJsxElement(child) ||
          ts.isJsxSelfClosingElement(child) ||
          ts.isJsxFragment(child)
        ) {
          found = true;
        }
        ts.forEachChild(child, look);
      };
      ts.forEachChild(node, look);
      return found;
    };
    const visit = (node: ts.Node): void => {
      if (ts.isJsxExpression(node) && node.expression !== undefined) {
        const expression = node.expression.getText(sourceFile);
        const readsDescriptor = DESCRIPTOR_FIELDS.some((field) =>
          new RegExp(`\\.${field}\\b`).test(expression),
        );
        if (readsDescriptor && !containsJsx(node.expression)) {
          surfaces.push({
            file: relative(srcRoot, file),
            expression: expression.replace(/\s+/g, " ").trim(),
            masked: expression.includes("maskCardNumbers("),
          });
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
  }

  test("the walk finds surfaces at all, so a broken walk cannot pass by finding nothing", () => {
    // FOURTEEN leaf sites in FIVE files at this head: five masked and nine
    // declared exclusions. The round-1 grep recorded eight in three and did
    // not reproduce; this walk also reaches a file that grep never saw, the
    // import route, which renders TWO declared account labels rather than
    // the one this comment used to count.
    //
    // CORRECTED IN PLACE (clause R-087, finding CR-M3P6-10). This comment
    // said NINE and the walk returned TEN, and the assertion below was a
    // FLOOR, so the recorded number could drift from the measured one with
    // nothing going red: the same mechanism this test exists to eliminate,
    // one level up. The assertion is now EXACT.
    //
    // UPDATED BY M3-P14, which adds a fifth file (the accounts screen) and
    // four leaf sites: the month-accounts entry label, the accounts list's
    // own label, and two translated copy strings the walk reaches only
    // because one of their interpolated keys is named "label". All four are
    // the household's own DECLARED account label or copy around it, and each
    // is on the exclusions table above with that reason.
    //
    // CORRECTED IN PLACE, NOT QUIETLY REWRITTEN (clause R-087). This comment
    // used to end "Note what did NOT change: the masked count. This phase
    // adds no new descriptor surface, which is the fact worth reading off
    // these three numbers together." THAT IS NO LONGER TRUE and the sentence
    // is kept here rather than deleted so the next reader can see that it
    // changed. Criterion 14.15 witness SEVEN made this phase render the HELD
    // ROWS of a reserve statement under their account's entry, each with the
    // counterparty text the product projects for a row, which IS a
    // descriptor surface and the first one this phase adds. It is MASKED, so
    // the masked count rises from five to six and the leaf count from
    // fourteen to fifteen while the number of declared exclusions is
    // unchanged at nine. That is the fact worth reading off these three
    // numbers now: a new descriptor reached the screen and it went through
    // the masking rule rather than around it.
    expect(surfaces.length).toBe(15);
    expect(new Set(surfaces.map((surface) => surface.file)).size).toBe(5);
    expect(surfaces.filter((surface) => surface.masked).length).toBe(6);
  });

  test("every unmasked descriptor surface is a DECLARED exclusion with a reason", () => {
    const unmasked = surfaces.filter((surface) => !surface.masked);
    expect(unmasked.length).toBe(EXCLUSIONS.length);
    for (const surface of unmasked) {
      const declared = EXCLUSIONS.find(
        (exclusion) =>
          exclusion.file === surface.file &&
          exclusion.expression === surface.expression,
      );
      expect(
        declared,
        `${surface.file}: ${surface.expression} renders descriptor-derived text without masking and is not a declared exclusion`,
      ).toBeDefined();
      expect(declared?.why.length).toBeGreaterThan(20);
    }
  });

  test("the surfaces that must mask, do", () => {
    const mustMask = [
      "profile-confirmation.tsx",
      "merchant-review.tsx",
      "month-view.tsx",
    ];
    for (const file of mustMask) {
      const inFile = surfaces.filter((surface) => surface.file.endsWith(file));
      expect(inFile.length, file).toBeGreaterThan(0);
      expect(
        inFile.some((surface) => surface.masked),
        file,
      ).toBe(true);
    }
    // The confirm preview is the screen the owner photographed: BOTH of its
    // descriptor cells mask, and neither is a declared exclusion.
    const preview = surfaces.filter((surface) =>
      surface.file.endsWith("profile-confirmation.tsx"),
    );
    expect(preview).toHaveLength(2);
    expect(preview.every((surface) => surface.masked)).toBe(true);
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
    expect(rowCount).toBe(21);
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
