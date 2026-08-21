// Deterministic generator for the committed synthetic PDF fixtures
// (decision D-3, plan step 7). Run from the repository root:
//
//   npx tsx test/fixtures/generate-pdf-fixtures.ts
//
// It writes the four fixture PDFs next to itself. The fast gate asserts
// byte-for-byte equality between buildPdfFixtures() and the committed
// files (test/domain/pdf-fixtures.test.ts), so the committed bytes are
// reproducible on demand and cannot drift from this source.
//
// EVERY IDENTIFIER, NAME, AMOUNT, DATE AND MERCHANT STRING BELOW IS
// INVENTED (hazard H2.1). Only format vocabulary shared with the plan
// and the intake addendum (SALDO OP, BIJLAGE BIJ VERRICHTING, the
// institution fingerprint, payment-rail phrasing) may coincide with any
// real statement. Fixture dates live in February to May 2026 so no date
// string from the real statements (June and July 2026) can collide.
//
// Determinism: no clock, no randomness, no metadata (no /Info, no /ID),
// uncompressed content streams, ASCII text only. Same source, same bytes.

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// ---------------------------------------------------------------------
// Minimal PDF writer: fixed-layout text pages, Helvetica, WinAnsi.
// ---------------------------------------------------------------------

type Run = { readonly x: number; readonly text: string };
type Line = { readonly y: number; readonly runs: readonly Run[] };
type PageContent = readonly Line[];

const FONT_SIZE = 9;

const escapePdfText = (text: string): string => {
  if (!/^[\x20-\x7e]*$/.test(text)) {
    throw new Error(`Fixture text must be ASCII: ${text}`);
  }
  return text.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
};

const contentStream = (lines: PageContent): string => {
  const ops: string[] = [];
  for (const line of lines) {
    for (const run of line.runs) {
      ops.push(
        `BT /F1 ${FONT_SIZE} Tf 1 0 0 1 ${run.x.toFixed(1)} ${line.y.toFixed(1)} Tm (${escapePdfText(run.text)}) Tj ET`,
      );
    }
  }
  return ops.join("\n") + "\n";
};

const buildPdf = (pages: readonly PageContent[]): Uint8Array => {
  const pageCount = pages.length;
  const fontObjectNumber = 2 + 2 * pageCount + 1;
  const objects: string[] = [];
  // 1: catalog, 2: page tree.
  objects.push(`1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n`);
  const kids = pages.map((_, index) => `${3 + 2 * index} 0 R`).join(" ");
  objects.push(
    `2 0 obj\n<< /Type /Pages /Kids [${kids}] /Count ${pageCount} >>\nendobj\n`,
  );
  pages.forEach((page, index) => {
    const pageNumber = 3 + 2 * index;
    const contentNumber = pageNumber + 1;
    objects.push(
      `${pageNumber} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 ${fontObjectNumber} 0 R >> >> /Contents ${contentNumber} 0 R >>\nendobj\n`,
    );
    const stream = contentStream(page);
    objects.push(
      `${contentNumber} 0 obj\n<< /Length ${stream.length} >>\nstream\n${stream}endstream\nendobj\n`,
    );
  });
  objects.push(
    `${fontObjectNumber} 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>\nendobj\n`,
  );

  const header = "%PDF-1.4\n";
  let body = header;
  const offsets: number[] = [];
  for (const object of objects) {
    offsets.push(body.length);
    body += object;
  }
  const xrefOffset = body.length;
  const size = objects.length + 1;
  let xref = `xref\n0 ${size}\n0000000000 65535 f \n`;
  for (const offset of offsets) {
    xref += `${String(offset).padStart(10, "0")} 00000 n \n`;
  }
  const trailer = `trailer\n<< /Size ${size} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  const text = body + xref + trailer;
  const bytes = new Uint8Array(text.length);
  for (let index = 0; index < text.length; index += 1) {
    bytes[index] = text.charCodeAt(index) & 0xff;
  }
  return bytes;
};

// ---------------------------------------------------------------------
// Belfius-layout page building blocks (all content invented).
// ---------------------------------------------------------------------

const ACCOUNT_IBAN_SPACED = "BE90 0123 4567 8944";
const COUNTERPARTY_DEPOSIT = "BE45 6789 0123 4515";
const COUNTERPARTY_SAVINGS = "BE77 1234 5678 9012";

const LEFT = 87.8;
const INDENT = 99.8;
const AMOUNT_X = 470.0;
const TOP = 810.0;
const LINE_STEP = 11.9;

type LineBuilder = {
  lines: Line[];
  y: number;
  push: (runs: readonly Run[]) => void;
  gap: (steps?: number) => void;
};

const makeBuilder = (): LineBuilder => {
  const state: LineBuilder = {
    lines: [],
    y: TOP,
    push: (runs) => {
      state.lines.push({ y: state.y, runs });
      state.y -= LINE_STEP;
    },
    gap: (steps = 1) => {
      state.y -= steps * LINE_STEP;
    },
  };
  return state;
};

// The repeated per-page header block. The institution name is split into
// word runs and the reconstruction must re-join them with spaces; the
// header deliberately carries the BANK'S OWN (invented) IBAN so a
// template reading account identity from anywhere but the band line
// fails the fixture tests.
const pushHeader = (builder: LineBuilder, pageMarker: string): void => {
  builder.push([
    { x: 88.7, text: "Belfius" },
    { x: 120.0, text: "Bank" },
    { x: 142.0, text: "NV" },
  ]);
  builder.push([{ x: 88.7, text: "Voorbeeldlaan 12 - 1000 Brussel" }]);
  builder.push([{ x: 88.7, text: "IBAN: BE10 9876 5432 1001 - BIC: DEMOBEBB" }]);
  builder.push([{ x: 88.7, text: "Ondernemingsnummer 0999.999.999" }]);
  builder.gap();
  builder.push([{ x: 272.6, text: pageMarker }]);
  builder.gap();
};

const txStart = (
  builder: LineBuilder,
  sequence: string,
  bookingDate: string,
  valueDate: string,
  amountText: string,
): void => {
  builder.push([
    { x: LEFT, text: `${sequence} ${bookingDate} (VAL. ${valueDate})` },
    { x: AMOUNT_X, text: amountText },
  ]);
};

const descriptionLines = (builder: LineBuilder, lines: readonly string[]): void => {
  for (const line of lines) {
    builder.push([{ x: INDENT, text: line }]);
  }
  builder.gap();
};

export type FixtureTransaction = {
  readonly sequence: string;
  readonly bookingDate: string;
  readonly valueDate: string;
  // The amount exactly as rendered, sign spacing and thousands dots
  // included, plus its integer-cent value; the generator refuses a pair
  // that disagrees, so a fixture cannot lie about its own total.
  readonly amountText: string;
  readonly amountCents: number;
  readonly description: readonly string[];
};

const centsOfAmountText = (text: string): number => {
  const match = /^([+-])\s?((?:\d{1,3}(?:\.\d{3})+|\d+)),(\d{2})$/.exec(text);
  if (!match || match[1] === undefined || match[2] === undefined || match[3] === undefined) {
    throw new Error(`Bad fixture amount text: ${text}`);
  }
  const sign = match[1] === "-" ? -1 : 1;
  return sign * (Number(match[2].replace(/\./g, "")) * 100 + Number(match[3]));
};

const formatClosingCents = (cents: number): string => {
  const sign = cents < 0 ? "-" : "+";
  const magnitude = Math.abs(cents);
  const whole = Math.floor(magnitude / 100);
  const fraction = String(magnitude % 100).padStart(2, "0");
  const grouped = whole
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${sign}${grouped},${fraction}`;
};

const checkedCents = (transaction: FixtureTransaction): number => {
  const parsed = centsOfAmountText(transaction.amountText);
  if (parsed !== transaction.amountCents) {
    throw new Error(
      `Fixture ${transaction.sequence} declares ${transaction.amountCents} but renders ${parsed}`,
    );
  }
  return parsed;
};

// ---------------------------------------------------------------------
// Fixture A: the reconciling Belfius-style statement (statement 3).
// ---------------------------------------------------------------------

export const FIXTURE_A_OPENING_CENTS = 95075; // "+ 950,75"

export const FIXTURE_A_TRANSACTIONS: readonly FixtureTransaction[] = [
  {
    sequence: "0101",
    bookingDate: "04-05-2026",
    valueDate: "04-05-2026",
    amountText: "- 3,55",
    amountCents: -355,
    description: [
      "DEBITMASTERCARD-BETALING VIA Google Pay 03/05 Koffiehuis",
      "Anker BE 3,55 EUR KAART NR 5599 2088 7766 5544 - Jansen",
      "Pieter",
    ],
  },
  {
    sequence: "0102",
    bookingDate: "05-05-2026",
    valueDate: "05-05-2026",
    amountText: "+ 100,00",
    amountCents: 10000,
    description: [
      `STORTING VAN ${COUNTERPARTY_DEPOSIT} Gezin Voorbeeld`,
      "Huishoudgeld",
    ],
  },
  {
    sequence: "0103",
    bookingDate: "06-05-2026",
    valueDate: "06-05-2026",
    amountText: "-1.234,56",
    amountCents: -123456,
    description: [
      `OVERSCHRIJVING DEMO MOBILE NAAR ${COUNTERPARTY_SAVINGS}`,
      "Sparen Demo",
    ],
  },
  {
    // Finding PR2-002: a TRANSACTION page carries the full annex marker
    // phrase INSIDE a description block. Body-starts-with page skipping
    // keeps this row; marker-anywhere skipping loses it and reddens
    // criterion 2.1's paired assertions.
    sequence: "0104",
    bookingDate: "08-05-2026",
    valueDate: "07-05-2026",
    amountText: "- 0,25",
    amountCents: -25,
    description: [
      "INTERESTEN : 01.02.2026 - 30.04.2026 - ZIE",
      "BIJLAGE BIJ VERRICHTING 0104",
    ],
  },
  {
    sequence: "0105",
    bookingDate: "11-05-2026",
    valueDate: "11-05-2026",
    amountText: "+2.000,00",
    amountCents: 200000,
    description: [
      `INSTANT STORTING VAN ${COUNTERPARTY_DEPOSIT} Demo Werkgever`,
      "Loon mei",
    ],
  },
  {
    sequence: "0106",
    bookingDate: "12-05-2026",
    valueDate: "12-05-2026",
    amountText: "- 987,65",
    amountCents: -98765,
    description: [
      "UW EUROPESE DOMICILIERING 9000000001-001 VOOR DEMO",
      "VERZEKERINGEN MEDEDELING: Kenmerk: +++900/0000/00000+++",
    ],
  },
  {
    sequence: "0107",
    bookingDate: "14-05-2026",
    valueDate: "14-05-2026",
    amountText: "-15,00",
    amountCents: -1500,
    description: [
      "BANCONTACT-AANKOOP - Bakkerij Zonnig - 3000 LEUVEN BE -",
      "14/05/26 08:12 - CONTACTLOOS - KAART 5599 20XX XXXX 5544",
    ],
  },
  {
    sequence: "0108",
    bookingDate: "15-05-2026",
    valueDate: "15-05-2026",
    amountText: "+ 1.500,00",
    amountCents: 150000,
    description: [
      `STORTING VAN ${COUNTERPARTY_DEPOSIT} Demo Werkgever`,
      "Bonus",
    ],
  },
  {
    sequence: "0109",
    bookingDate: "15-05-2026",
    valueDate: "15-05-2026",
    amountText: "+25,00",
    amountCents: 2500,
    description: [
      `OVERSCHRIJVING DEMO MOBILE VAN ${COUNTERPARTY_SAVINGS}`,
      "Terugboeking",
    ],
  },
];

export const FIXTURE_A_TOTAL_CENTS = FIXTURE_A_TRANSACTIONS.reduce(
  (sum, transaction) => sum + transaction.amountCents,
  0,
);

const bandLineWithBic = `----------------- ${ACCOUNT_IBAN_SPACED} BIC: DEMOBEBB ------------------`;
const bandLinePlain = `------------------------- ${ACCOUNT_IBAN_SPACED} -------------------------`;

const belfiusStatement = (input: {
  readonly pageMarkerFirst: string;
  readonly pageMarkerRest: string;
  readonly holderDateLine: string;
  readonly openingLine: string;
  readonly closingLine: string;
  readonly pageOneCount: number;
  readonly transactions: readonly FixtureTransaction[];
  readonly annexPage: boolean;
}): PageContent[] => {
  const pageOne = makeBuilder();
  pushHeader(pageOne, input.pageMarkerFirst);
  pageOne.push([{ x: 409.7, text: "DEMO PLUS-REKENING" }]);
  pageOne.push([{ x: LEFT, text: "Jansen Pieter" }]);
  pageOne.push([{ x: LEFT, text: input.holderDateLine }]);
  pageOne.push([{ x: LEFT, text: "2000 DEMOSTAD" }]);
  pageOne.gap();
  pageOne.push([{ x: LEFT, text: bandLineWithBic }]);
  pageOne.gap();
  pageOne.push([{ x: LEFT, text: input.openingLine }]);
  pageOne.gap();
  for (const transaction of input.transactions.slice(0, input.pageOneCount)) {
    txStart(
      pageOne,
      transaction.sequence,
      transaction.bookingDate,
      transaction.valueDate,
      transaction.amountText,
    );
    descriptionLines(pageOne, transaction.description);
  }

  const pageTwo = makeBuilder();
  pushHeader(pageTwo, input.pageMarkerRest);
  pageTwo.push([{ x: LEFT, text: bandLinePlain }]);
  pageTwo.gap();
  for (const transaction of input.transactions.slice(input.pageOneCount)) {
    txStart(
      pageTwo,
      transaction.sequence,
      transaction.bookingDate,
      transaction.valueDate,
      transaction.amountText,
    );
    descriptionLines(pageTwo, transaction.description);
  }
  pageTwo.push([{ x: LEFT, text: input.closingLine }]);
  pageTwo.push([
    { x: LEFT, text: "DIT PRODUCT IS BESCHERMD DOOR HET GARANTIEFONDS." },
  ]);

  const pages = [pageOne.lines, pageTwo.lines];

  if (input.annexPage) {
    // The annex page: its BODY (everything after the page marker) starts
    // with the marker phrase, and it deliberately carries amount-like
    // lines that are not transactions.
    const annex = makeBuilder();
    pushHeader(annex, input.pageMarkerRest.replace(/\/\d+$/, "/3"));
    annex.push([{ x: LEFT, text: "BIJLAGE BIJ VERRICHTING 0104" }]);
    annex.push([{ x: LEFT, text: bandLinePlain }]);
    annex.gap();
    annex.push([{ x: 248.8, text: "BEWIJSSTUK IN EUR" }]);
    annex.push([{ x: 105.7, text: `INTERESTEN REKENING ${ACCOUNT_IBAN_SPACED}` }]);
    annex.push([{ x: 105.7, text: "VOOR DE PERIODE VAN 01/02/2026 TOT 30/04/2026" }]);
    annex.gap();
    annex.push([{ x: 105.7, text: "INTERESTEN DEBET CREDIT RESULTAAT" }]);
    annex.push([{ x: 207.0, text: "-0,20 +0,00 -0,20" }]);
    annex.push([{ x: 105.7, text: "OVERSCHRIJDING -0,05" }]);
    annex.push([{ x: 105.7, text: "TE BOEKEN BEDRAG -0,25" }]);
    pages.push(annex.lines);
  }

  return pages;
};

// ---------------------------------------------------------------------
// Fixture B: overlapping re-export (statement 4). It re-carries fixture
// A's final year-and-sequence pairs (0108, 0109) verbatim alongside
// three genuinely new rows (finding PR2-003): under the D-4 year-scoped
// key the shared rows are already known; a statement-scoped key would
// duplicate them.
// ---------------------------------------------------------------------

export const FIXTURE_B_SHARED_SEQUENCES = ["0108", "0109"] as const;

export const FIXTURE_B_NEW_TRANSACTIONS: readonly FixtureTransaction[] = [
  {
    sequence: "0110",
    bookingDate: "20-05-2026",
    valueDate: "20-05-2026",
    amountText: "- 45,90",
    amountCents: -4590,
    description: [
      "BANCONTACT-AANKOOP - Slagerij Duif - 3001 HEVERLEE BE -",
      "20/05/26 11:03 - CONTACTLOOS - KAART 5599 20XX XXXX 5544",
    ],
  },
  {
    sequence: "0111",
    bookingDate: "22-05-2026",
    valueDate: "22-05-2026",
    amountText: "+ 60,00",
    amountCents: 6000,
    description: [`STORTING VAN ${COUNTERPARTY_DEPOSIT} Gezin Voorbeeld Cadeau`],
  },
  {
    sequence: "0112",
    bookingDate: "28-05-2026",
    valueDate: "28-05-2026",
    amountText: "-12,34",
    amountCents: -1234,
    description: [
      "DEBITMASTERCARD-BETALING VIA Google Pay 27/05 Koffiehuis",
      "Anker BE 12,34 EUR KAART NR 5599 2088 7766 5544 - Jansen",
      "Pieter",
    ],
  },
];

const fixtureBTransactions: readonly FixtureTransaction[] = [
  ...FIXTURE_A_TRANSACTIONS.filter((transaction) =>
    (FIXTURE_B_SHARED_SEQUENCES as readonly string[]).includes(
      transaction.sequence,
    ),
  ),
  ...FIXTURE_B_NEW_TRANSACTIONS,
];

// ---------------------------------------------------------------------
// Fixture C: the deliberately NON-RECONCILING variant (statement 5): its
// rendered closing balance is exactly 1,00 EUR higher than opening plus
// the sum of its rows, so the shared balance gate must fail the import
// with zero rows written (criterion 2.2, hazard H2.2).
// ---------------------------------------------------------------------

const FIXTURE_C_OPENING_CENTS = 233650;

const fixtureCTransactions: readonly FixtureTransaction[] = [
  {
    sequence: "0113",
    bookingDate: "30-05-2026",
    valueDate: "30-05-2026",
    amountText: "- 10,00",
    amountCents: -1000,
    description: ["BANCONTACT-AANKOOP - Bakkerij Zonnig - 3000 LEUVEN BE"],
  },
  {
    sequence: "0114",
    bookingDate: "31-05-2026",
    valueDate: "31-05-2026",
    amountText: "- 20,00",
    amountCents: -2000,
    description: [`OVERSCHRIJVING DEMO MOBILE NAAR ${COUNTERPARTY_SAVINGS}`],
  },
];

export const FIXTURE_C_BROKEN_BY_CENTS = 100;

// ---------------------------------------------------------------------
// Fixture D: a perfectly valid PDF that matches NO registered template.
// ---------------------------------------------------------------------

const unknownLayoutPages = (): PageContent[] => {
  const page = makeBuilder();
  page.push([{ x: LEFT, text: "Demobank NV" }]);
  page.push([{ x: LEFT, text: "Maandstaat mei 2026" }]);
  page.gap();
  page.push([{ x: LEFT, text: "Datum Omschrijving Bedrag" }]);
  page.push([{ x: LEFT, text: "02-05-2026 Overschrijving huur -800,00" }]);
  page.push([{ x: LEFT, text: "09-05-2026 Storting loon +2.100,00" }]);
  page.push([{ x: LEFT, text: "Einde van dit overzicht" }]);
  return [page.lines];
};

// ---------------------------------------------------------------------
// Assembly.
// ---------------------------------------------------------------------

export const buildPdfFixtures = (): ReadonlyMap<string, Uint8Array> => {
  const sumA = FIXTURE_A_TRANSACTIONS.reduce(
    (sum, transaction) => sum + checkedCents(transaction),
    0,
  );
  // The generator PROVES the balance identity of its own reconciling
  // fixtures arithmetically, the same identity the real statement
  // satisfies: closing is computed, never hand-written.
  const closingA = FIXTURE_A_OPENING_CENTS + sumA;
  const fixtureA = buildPdf(
    belfiusStatement({
      pageMarkerFirst: "BLZ. : 3/1",
      pageMarkerRest: "15-05-2026 3/2",
      holderDateLine: "VOORBEELDSTRAAT 7 DATUM : 15-05-2026",
      openingLine: "SALDO OP 30-04-2026 EUR + 950,75",
      closingLine: `SALDO OP 15-05-2026 17:45 EUR ${formatClosingCents(closingA)}`,
      pageOneCount: 3,
      transactions: FIXTURE_A_TRANSACTIONS,
      annexPage: true,
    }),
  );

  const openingB = FIXTURE_A_OPENING_CENTS +
    FIXTURE_A_TRANSACTIONS.filter(
      (transaction) =>
        !(FIXTURE_B_SHARED_SEQUENCES as readonly string[]).includes(
          transaction.sequence,
        ),
    ).reduce((sum, transaction) => sum + transaction.amountCents, 0);
  const sumB = fixtureBTransactions.reduce(
    (sum, transaction) => sum + checkedCents(transaction),
    0,
  );
  const closingB = openingB + sumB;
  const fixtureB = buildPdf(
    belfiusStatement({
      pageMarkerFirst: "BLZ. : 4/1",
      pageMarkerRest: "29-05-2026 4/2",
      holderDateLine: "VOORBEELDSTRAAT 7 DATUM : 29-05-2026",
      openingLine: `SALDO OP 15-05-2026 EUR ${formatClosingCents(openingB)}`,
      closingLine: `SALDO OP 29-05-2026 16:20 EUR ${formatClosingCents(closingB)}`,
      pageOneCount: 3,
      transactions: fixtureBTransactions,
      annexPage: false,
    }),
  );

  const sumC = fixtureCTransactions.reduce(
    (sum, transaction) => sum + checkedCents(transaction),
    0,
  );
  const brokenClosingC = FIXTURE_C_OPENING_CENTS + sumC + FIXTURE_C_BROKEN_BY_CENTS;
  const fixtureC = buildPdf(
    belfiusStatement({
      pageMarkerFirst: "BLZ. : 5/1",
      pageMarkerRest: "31-05-2026 5/2",
      holderDateLine: "VOORBEELDSTRAAT 7 DATUM : 31-05-2026",
      openingLine: `SALDO OP 29-05-2026 EUR ${formatClosingCents(FIXTURE_C_OPENING_CENTS)}`,
      closingLine: `SALDO OP 31-05-2026 09:00 EUR ${formatClosingCents(brokenClosingC)}`,
      pageOneCount: 1,
      transactions: fixtureCTransactions,
      annexPage: false,
    }),
  );

  const fixtureD = buildPdf(unknownLayoutPages());

  return new Map([
    ["belfius-statement-a.pdf", fixtureA],
    ["belfius-statement-b-overlap.pdf", fixtureB],
    ["belfius-nonreconciling.pdf", fixtureC],
    ["unknown-layout.pdf", fixtureD],
  ]);
};

const isMain = (): boolean => {
  const entry = process.argv[1];
  return entry !== undefined && fileURLToPath(import.meta.url) === entry;
};

if (isMain()) {
  const directory = fileURLToPath(new URL(".", import.meta.url));
  for (const [name, bytes] of buildPdfFixtures()) {
    writeFileSync(join(directory, name), bytes);
    console.log(`${name}: ${bytes.length} bytes`);
  }
}
