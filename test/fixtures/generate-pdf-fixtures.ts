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
// THE FIVE-CATEGORY PRIVACY CONTRACT (hazard H2.1, criterion 2.6):
// every IDENTIFIER (IBAN, card number, reference), NAME, MERCHANT
// STRING, AMOUNT and DATE below is invented, and the criterion 2.6
// scrub greps exactly those five categories against the real
// statements. What MAY coincide with a real statement, sanctioned as
// layout vocabulary, is digit-free format boilerplate: the institution
// fingerprint, balance and annex markers (SALDO OP, BIJLAGE BIJ
// VERRICHTING), transaction-type and payment-rail phrasing
// (DEBITMASTERCARD-BETALING VIA, BANCONTACT-AANKOOP, STORTING VAN,
// OVERSCHRIJVING, UW EUROPESE DOMICILIERING, INTERESTEN), and footer
// and annex boilerplate (the GARANTIEFONDS line, BEWIJSSTUK IN EUR,
// DEBET CREDIT RESULTAAT), because a Belfius-layout fixture that
// carried none of the layout's own vocabulary would not exercise the
// template. CORRECTED RATHER THAN QUIETLY REWRITTEN (R-087, fix round
// 1, finding HZ-006): this comment used to claim only plan-and-addendum
// vocabulary could coincide, which was narrower than what the file
// does; the five-category form above is what is promised, enforced and
// enforceable. Fixture dates are chosen OUTSIDE the real statements'
// date range so no date string can collide.
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

const ACCOUNT_IBAN_SPACED = "BE72 0123 4567 8944";
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
      "BANCONTACT-AANKOOP - Bakkerij Zonnig - 3700 TONGEREN BE -",
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

const bandWithBic = (ibanSpaced: string): string =>
  `----------------- ${ibanSpaced} BIC: DEMOBEBB ------------------`;
const bandPlain = (ibanSpaced: string): string =>
  `------------------------- ${ibanSpaced} -------------------------`;

// `bandIban` is OPTIONAL and defaults to the statement account every
// fixture before M3-P12 used, so introducing it moves no committed byte
// (test/domain/pdf-fixtures.test.ts is what says so). M3-P12 needs a second
// statement account: its fixture must be ingestible beside the others
// without sharing their account scope.
const belfiusStatement = (input: {
  readonly pageMarkerFirst: string;
  readonly pageMarkerRest: string;
  readonly holderDateLine: string;
  readonly openingLine: string;
  readonly closingLine: string;
  readonly pageOneCount: number;
  readonly transactions: readonly FixtureTransaction[];
  readonly annexPage: boolean;
  readonly bandIban?: string;
}): PageContent[] => {
  const bandIban = input.bandIban ?? ACCOUNT_IBAN_SPACED;
  const bandLineWithBic = bandWithBic(bandIban);
  const bandLinePlain = bandPlain(bandIban);
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
    annex.push([{ x: 105.7, text: `INTERESTEN REKENING ${bandIban}` }]);
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
    description: ["BANCONTACT-AANKOOP - Bakkerij Zonnig - 3700 TONGEREN BE"],
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
// Fixture E (fix round 1, finding HZ-001): in-description STRUCTURE
// SHAPES. One row's description block carries a full line in the exact
// transaction-start shape with a zero amount (the review's fabricated-row
// construction) and another's carries a full line in the exact balance
// shape (the truncation construction). Both lines are INDENTED
// description data on the real layout, so the template must keep them
// verbatim: two rows, intact descriptions, reconciling balances.
// ---------------------------------------------------------------------

export const FIXTURE_E_OPENING_CENTS = 50000;

export const FIXTURE_E_TRANSACTIONS: readonly FixtureTransaction[] = [
  {
    sequence: "0120",
    bookingDate: "17-05-2026",
    valueDate: "17-05-2026",
    amountText: "- 20,00",
    amountCents: -2000,
    description: [
      "MEDEDELING VAN DE TEGENPARTIJ",
      "0198 17-05-2026 (VAL. 17-05-2026) - 0,00",
      "REST VAN DE VRIJE MEDEDELING",
    ],
  },
  {
    sequence: "0121",
    bookingDate: "18-05-2026",
    valueDate: "18-05-2026",
    amountText: "+ 35,00",
    amountCents: 3500,
    description: [
      "TERUGBETALING MET VRIJE TEKST",
      "SALDO OP 17-05-2026 EUR + 480,00",
      "EINDE VAN DE MEDEDELING",
    ],
  },
];

// ---------------------------------------------------------------------
// KBC-layout fixtures (M3-P3, plan step 3; all content invented). The
// layout mirrors the verified structure of the real uitgavenstaat:
// header block with fingerprint lines, an indented Vorig saldo line with
// a per-card sub-heading under it, one-line two-date transaction rows at
// the row margin with the amount at line end, FX continuation lines at
// a deeper indent, marketing footer blocks between the last row of a
// page and the page end, and the closing figure on the Afrekening line
// with a SPACE thousands separator while the Totaal bedrag line carries
// no amount. Same five-category privacy contract as the Belfius
// fixtures above; the KBC layout vocabulary sanctioned as digit-free
// boilerplate additionally covers: KBC-Mastercard, Uitgavenstaat,
// Klantenreferentie, Uitgavenstaatnummer, Gebruikslimiet,
// Kaartnummer(s), the period-line phrasing (Overzicht van je
// verrichtingen van .. tot ..), the column-header words, Vorig saldo
// op, DOMICILIERING VIA JE BANK, Bedrag, Koers (1 EUR = ..), Totaal
// bedrag van de kaartverrichtingen op, and Afrekening via je bank op.
// Fixture dates are chosen outside BOTH real statements' date sets.
//
// BANK-CONTROLLED BOILERPLATE IS SANCTIONED AS LAYOUT VOCABULARY, and
// COUNTERPARTY-CONTROLLED TEXT IS NOT (fix round 2, findings HZ-M3P3-08
// and CR-M3P3-06). The three marketing and group-identity footer lines
// this fixture prints (kbcFooter below) are bank-composed, identical on
// every statement of this product, and carry no household data, so they
// may coincide with a real document; one of the three does, measured at
// fix-round-2 review time. Anything a MERCHANT, a PAYER or the HOLDER
// controls, meaning row descriptors, names, addresses, references,
// amounts and dates, may never coincide and is invented here. The line
// between the two is the decision, not the habit: bank-controlled text
// is a property of the layout, counterparty-controlled text is a
// property of the household.
// ---------------------------------------------------------------------

const KBC_LEFT = 59.5;
const KBC_ROW_X = 62.4;
const KBC_CONTINUATION_X = 218.4;
const KBC_BALANCE_X = 204.2;
const KBC_AMOUNT_X = 470.0;
const KBC_FOOTER_X = 94.1;

export const KBC_MASKED_CARD = "5417 88XX XXXX 3210";
// A SECOND, GENUINELY DIFFERENT CARD of the same issuer (fix round 2,
// finding HZ-M3P3-02). The household this product is built for is a
// two-person household, so a second card is the ordinary case: the
// second-card fixture below is the first one with this number in place of
// the one above and nothing else changed, which is what makes it a clean
// witness that two cards are two sources. Invented, and on the allow list
// at test/fixtures/allowed-identifiers.txt with its provenance.
export const KBC_SECOND_MASKED_CARD = "5417 88XX XXXX 7654";
// The IDENTITY those two printings normalise to (fix round 3, finding
// HZ2-M3P3-02): separators dropped, mask glyphs folded to one form. What
// the statement PRINTS is above; what the profile spec carries is this.
export const KBC_MASKED_CARD_IDENTITY = KBC_MASKED_CARD.replace(/[ -]/g, "");
export const KBC_SECOND_MASKED_CARD_IDENTITY = KBC_SECOND_MASKED_CARD.replace(
  /[ -]/g,
  "",
);
export const KBC_STATEMENT_NUMBER = "30456";
export const KBC_REFUND_STATEMENT_NUMBER = "30871";
// A THIRD card, for the credit-balance statement (fix round 3, finding
// HZ2-M3P3-05): its own card so the fixture family keeps one card per
// document and the identity witnesses stay unambiguous. Invented the same
// way as the other two and probed against both real documents in its
// masked form, its six-digit head and its four-digit tail before listing.
export const KBC_THIRD_MASKED_CARD = "5417 88XX XXXX 9081";
export const KBC_THIRD_MASKED_CARD_IDENTITY = KBC_THIRD_MASKED_CARD.replace(
  /[ -]/g,
  "",
);
export const KBC_CREDIT_STATEMENT_NUMBER = "31204";
// A FOURTH card, for the underpaid statement (fix round 4). Invented and
// probed against both real documents in its masked form, its six-digit
// head and its four-digit tail before being listed.
export const KBC_FOURTH_MASKED_CARD = "5417 88XX XXXX 6503";
export const KBC_FOURTH_MASKED_CARD_IDENTITY = KBC_FOURTH_MASKED_CARD.replace(
  /[ -]/g,
  "",
);
export const KBC_UNDERPAID_STATEMENT_NUMBER = "31776";

export type KbcFixtureRow = {
  // DD-MM-YYYY, as rendered. Booking date is the TRANSACTION date
  // (pulse-v0.2-pdf-addendum.md:76, finding PR2-004); the settlement
  // date stays in the raw row text.
  readonly transactionDate: string;
  readonly settlementDate: string;
  readonly description: string;
  // Rendered amount: tight sign, comma decimals, SPACE thousands from
  // 1 000,00 up, verified against amountCents by the generator.
  readonly amountText: string;
  readonly amountCents: number;
  // FX continuation lines (original amount, exchange rate), rendered at
  // the continuation indent and folded into the row's rawLine by the
  // template, never rows.
  readonly fxLines?: readonly string[];
};

const centsOfKbcAmountText = (text: string): number => {
  const match = /^([+-])((?:\d{1,3}(?: \d{3})+|\d+)),(\d{2})$/.exec(text);
  if (!match || match[1] === undefined || match[2] === undefined || match[3] === undefined) {
    throw new Error(`Bad KBC fixture amount text: ${text}`);
  }
  const sign = match[1] === "-" ? -1 : 1;
  return sign * (Number(match[2].replace(/ /g, "")) * 100 + Number(match[3]));
};

const checkedKbcCents = (row: KbcFixtureRow): number => {
  const parsed = centsOfKbcAmountText(row.amountText);
  if (parsed !== row.amountCents) {
    throw new Error(
      `KBC fixture row ${row.description} declares ${row.amountCents} but renders ${parsed}`,
    );
  }
  return parsed;
};

const formatKbcCents = (cents: number): string => {
  const sign = cents < 0 ? "-" : "+";
  const magnitude = Math.abs(cents);
  const whole = Math.floor(magnitude / 100);
  const fraction = String(magnitude % 100).padStart(2, "0");
  const grouped = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  return `${sign}${grouped},${fraction}`;
};

// Vorig saldo: what the previous statement settled at, negative (owed).
// The DOMICILIERING credit below equals its negation exactly, as on the
// real statement. The magnitude also equals THIS statement's Afrekening
// magnitude by construction (the debit rows sum to it), so the
// account-side settlement debit in the companion fixture both matches
// the card import's settlement total and finds this credit as its
// mirror leg within the pairing windows (criteria 3.3 and 3.4).
export const KBC_FIXTURE_OPENING_CENTS = -123456; // "-1 234,56"

export const KBC_FIXTURE_ROWS: readonly KbcFixtureRow[] = [
  {
    // The month-straddling row (finding PR2-004): transaction in May,
    // settlement in June. The stored bookingDate must be 2026-05-31.
    transactionDate: "31-05-2026",
    settlementDate: "02-06-2026",
    description: "KANTOORBOEK PLUS HASSELT B",
    amountText: "-48,20",
    amountCents: -4820,
  },
  {
    transactionDate: "02-06-2026",
    settlementDate: "03-06-2026",
    description: "STREAMFLIX ABONNEMENT AMSTERDAM N",
    amountText: "-11,99",
    amountCents: -1199,
  },
  {
    transactionDate: "04-06-2026",
    settlementDate: "05-06-2026",
    description: "CLOUDKRACHT HOSTING BERLIN D",
    amountText: "-27,50",
    amountCents: -2750,
    fxLines: ["Bedrag 30 USD", "Koers (1 EUR = 1,092345678 USD)"],
  },
  {
    transactionDate: "06-06-2026",
    settlementDate: "07-06-2026",
    description: "BOEKENHUIS DE MIJLPAAL OXFORD B",
    amountText: "-14,84",
    amountCents: -1484,
    fxLines: ["Bedrag 12,79 GBP", "Koers (1 EUR = 0,861234567 GBP)"],
  },
  {
    // The legitimate identical duplicate pair (addendum section 5, one
    // real pair observed): same dates, same description, same amount.
    transactionDate: "08-06-2026",
    settlementDate: "09-06-2026",
    description: "TAPAUTOMAAT PERRON 7 GENT B",
    amountText: "-2,40",
    amountCents: -240,
  },
  {
    transactionDate: "08-06-2026",
    settlementDate: "09-06-2026",
    description: "TAPAUTOMAAT PERRON 7 GENT B",
    amountText: "-2,40",
    amountCents: -240,
  },
  {
    // A ROW amount with the space thousands separator.
    transactionDate: "10-06-2026",
    settlementDate: "11-06-2026",
    description: "REISBUREAU NOORDERLICHT OSLO N",
    amountText: "-1 050,93",
    amountCents: -105093,
  },
  {
    transactionDate: "12-06-2026",
    settlementDate: "13-06-2026",
    description: "WEBWINKEL ZONNELICHT GENT B",
    amountText: "-76,30",
    amountCents: -7630,
  },
  {
    // The settlement of the previous statement arriving on the card: a
    // REAL transaction (the card-side settlement leg), rendered last
    // among the rows as on the real statement despite its early dates.
    transactionDate: "01-06-2026",
    settlementDate: "01-06-2026",
    description: "DOMICILIERING VIA JE BANK",
    amountText: "+1 234,56",
    amountCents: 123456,
  },
];

// ---------------------------------------------------------------------
// THE REFUND FIXTURE (fix round 2, findings HZ-M3P3-01, HZ-M3P3-05 and
// HZ-M3P3-06). The fixture above is arithmetically DEGENERATE and was
// recorded as deliberately so: its previous-balance magnitude, its
// debit-row sum and its Afrekening figure are ONE NUMBER, because a card
// statement with no positive row other than the settlement credit has
// Afrekening == the debit-row sum by identity, and this family's single
// companion debit had to satisfy the settlement window and the mirror
// window at once. A test over it therefore holds under three mutually
// incompatible definitions of a card import's settlement total, which is
// how an implementation that never read the statement's own figure passed
// criterion 3.3.
//
// This statement carries ONE ORDINARY MERCHANT REFUND, and that single
// row separates all three numbers:
//   previous-balance magnitude   87500  (and the settlement credit)
//   debit-row sum magnitude      48850
//   Afrekening (settlement)      46350  = 48850 - 2500
// The companion below carries a settlement debit equal to the AFREKENING
// figure, which is the truthful one. Under the old row-sum derivation
// that debit matches no card import at all; that is the red witness.
// It also carries the first non-settlement credit any fixture anywhere
// has, which is what makes the card-refund classification testable.
export const KBC_REFUND_OPENING_CENTS = -87500; // "-875,00"

export const KBC_REFUND_ROWS: readonly KbcFixtureRow[] = [
  {
    transactionDate: "02-06-2026",
    settlementDate: "03-06-2026",
    description: "BLOEMENHOEK DE ZONNEBLOEM GENT B",
    amountText: "-65,40",
    amountCents: -6540,
  },
  {
    transactionDate: "04-06-2026",
    settlementDate: "05-06-2026",
    description: "SPORTHAL DE WATERMOLEN TONGEREN B",
    amountText: "-123,10",
    amountCents: -12310,
  },
  {
    transactionDate: "06-06-2026",
    settlementDate: "07-06-2026",
    description: "MEUBELMAKERIJ DE ESDOORN BRUGGE B",
    amountText: "-300,00",
    amountCents: -30000,
  },
  {
    // THE ORDINARY MERCHANT REFUND. Its descriptor is deliberately NOT
    // byte-identical to the purchase it reverses, because a real refund
    // line never is, and that is exactly why the descriptor-keyed refund
    // correction cannot see it (finding HZ-M3P3-06).
    transactionDate: "08-06-2026",
    settlementDate: "09-06-2026",
    description: "TERUGBETALING SPORTHAL DE WATERMOLEN",
    amountText: "+25,00",
    amountCents: 2500,
  },
  {
    // The settlement of the previous statement arriving on the card.
    transactionDate: "01-06-2026",
    settlementDate: "01-06-2026",
    description: "DOMICILIERING VIA JE BANK",
    amountText: "+875,00",
    amountCents: 87500,
  },
];

export const KBC_REFUND_ROW_COUNT = KBC_REFUND_ROWS.length;

// The three numbers the degenerate fixture cannot tell apart, computed
// here so a test can assert they really are distinct rather than trust
// the table above.
export const KBC_REFUND_SUM_CENTS = KBC_REFUND_ROWS.reduce(
  (sum, row) => sum + row.amountCents,
  0,
);
export const KBC_REFUND_DEBIT_SUM_CENTS = KBC_REFUND_ROWS.reduce(
  (sum, row) => sum + (row.amountCents < 0 ? -row.amountCents : 0),
  0,
);
export const KBC_REFUND_SETTLEMENT_CENTS =
  -(KBC_REFUND_OPENING_CENTS + KBC_REFUND_SUM_CENTS);

// ---------------------------------------------------------------------
// THE CREDIT-BALANCE STATEMENT (fix round 3, finding HZ2-M3P3-05). Fix
// round 2 made a non-positive settlement figure STORABLE and three
// comments declared the column positive, while nothing measured the one
// state the column had newly gained. A card can stand in credit: the
// household paid the previous statement in full and then returned more
// than it bought, so the Afrekening line prints money owed BACK. That is
// an ordinary statement, not a corrupt one, so it must import.
//
//   previous balance   -40000  (and the settlement credit that cancels it)
//   one debit           -8000
//   two refunds        +12000 and +27550
//   Afrekening         +31550, money owed TO the household
//
// What keeps a negative settlement total safe is not a range check: the
// settlement match compares it against the MAGNITUDE of a debit, which is
// strictly positive, so this statement settles nothing and says so.
export const KBC_CREDIT_OPENING_CENTS = -40000; // "-400,00"

export const KBC_CREDIT_ROWS: readonly KbcFixtureRow[] = [
  {
    transactionDate: "02-06-2026",
    settlementDate: "03-06-2026",
    description: "BOEKBINDERIJ DE PENSEELSTREEK TONGEREN B",
    amountText: "-80,00",
    amountCents: -8000,
  },
  {
    transactionDate: "05-06-2026",
    settlementDate: "06-06-2026",
    description: "TERUGBETALING REISBUREAU NOORDERLICHT",
    amountText: "+120,00",
    amountCents: 12000,
  },
  {
    transactionDate: "07-06-2026",
    settlementDate: "08-06-2026",
    description: "TERUGBETALING WEBWINKEL ZONNELICHT",
    amountText: "+275,50",
    amountCents: 27550,
  },
  {
    transactionDate: "01-06-2026",
    settlementDate: "01-06-2026",
    description: "DOMICILIERING VIA JE BANK",
    amountText: "+400,00",
    amountCents: 40000,
  },
];

export const KBC_CREDIT_ROW_COUNT = KBC_CREDIT_ROWS.length;
export const KBC_CREDIT_SETTLEMENT_CENTS = -(
  KBC_CREDIT_OPENING_CENTS +
  KBC_CREDIT_ROWS.reduce((sum, row) => sum + row.amountCents, 0)
);

// ---------------------------------------------------------------------
// THE UNDERPAID STATEMENT (fix round 4, findings CR3-M3P3-01 and
// HZ3-M3P3-01). Every other card fixture in this tree has a settlement
// credit that exactly cancels its previous balance AND is worded so the
// code-owned credit pattern claims it, which means the STORED figure and
// both row derivations agree, which means criterion 3.3's witnesses hold
// under an implementation that never reads the stored figure at all.
// Measured: with the stored figure ignored, exactly one test in the whole
// fast gate reddens, and it is not one of 3.3's.
//
// This statement breaks the agreement twice over. Its credit settles LESS
// than the previous balance, because the household underpaid, and its
// wording is not the observed one, so the pattern does not claim it:
//
//   previous balance   -60000
//   credit            +55000, worded so the pattern does not match
//   debits            -20000 and -15000
//   Afrekening         -40000, so the issuer collects 40000
//
// and the three numbers are all different:
//   printed figure               40000   (the truth, and stored)
//   net of the line items       -20000   (the credit counted as an item)
//   sum of the debit magnitudes  35000
// So a companion debit for the printed figure links ONLY when the stored
// figure is read, which is the discrimination criterion 3.3 had lost.
export const KBC_UNDERPAID_OPENING_CENTS = -60000; // "-600,00"

export const KBC_UNDERPAID_ROWS: readonly KbcFixtureRow[] = [
  {
    transactionDate: "02-06-2026",
    settlementDate: "03-06-2026",
    description: "MEUBELMAKERIJ DE ESDOORN BRUGGE B",
    amountText: "-200,00",
    amountCents: -20000,
  },
  {
    transactionDate: "04-06-2026",
    settlementDate: "05-06-2026",
    description: "BOEKBINDERIJ DE PENSEELSTREEK TONGEREN B",
    amountText: "-150,00",
    amountCents: -15000,
  },
  {
    // The settlement of the previous statement, PARTIAL and worded so the
    // code-owned pattern does not claim it. Both properties matter and
    // both are deliberate.
    transactionDate: "01-06-2026",
    settlementDate: "01-06-2026",
    description: "AFBETALING VORIGE STAAT",
    amountText: "+550,00",
    amountCents: 55000,
  },
];

export const KBC_UNDERPAID_ROW_COUNT = KBC_UNDERPAID_ROWS.length;
export const KBC_UNDERPAID_SETTLEMENT_CENTS = -(
  KBC_UNDERPAID_OPENING_CENTS +
  KBC_UNDERPAID_ROWS.reduce((sum, row) => sum + row.amountCents, 0)
);
export const KBC_UNDERPAID_DEBIT_SUM_CENTS = KBC_UNDERPAID_ROWS.reduce(
  (sum, row) => sum + (row.amountCents < 0 ? -row.amountCents : 0),
  0,
);

export const KBC_FIXTURE_ROW_COUNT = KBC_FIXTURE_ROWS.length;

export const KBC_FIXTURE_SUM_CENTS = KBC_FIXTURE_ROWS.reduce(
  (sum, row) => sum + row.amountCents,
  0,
);

const kbcHeaderBlock = (builder: LineBuilder, periodLine: string): void => {
  builder.push([{ x: KBC_LEFT, text: periodLine }]);
  builder.push([
    { x: KBC_LEFT, text: "datum" },
    { x: 110.0, text: "datum" },
    { x: 170.0, text: "omschrijving verrichtingen" },
    { x: 420.0, text: "bedrag in EUR" },
  ]);
  builder.push([
    { x: KBC_LEFT, text: "verrichting" },
    { x: 110.0, text: "verrekening" },
  ]);
  builder.gap();
};

const kbcRow = (builder: LineBuilder, row: KbcFixtureRow): void => {
  builder.push([
    {
      x: KBC_ROW_X,
      text: `${row.transactionDate} ${row.settlementDate} ${row.description}`,
    },
    { x: KBC_AMOUNT_X, text: row.amountText },
  ]);
  for (const fxLine of row.fxLines ?? []) {
    builder.push([{ x: KBC_CONTINUATION_X, text: fxLine }]);
  }
};

// Bank-composed, identical on every statement of this product, carrying
// no household data: sanctioned layout vocabulary per the block comment
// above, not invented content.
const kbcFooter = (builder: LineBuilder, pageMarker: string): void => {
  builder.gap();
  builder.push([
    { x: KBC_FOOTER_X, text: "Kaart blokkeren? Open KBC Mobile en volg de stappen." },
  ]);
  builder.push([
    { x: KBC_FOOTER_X, text: "Tip: beheer je kaart met Kate in KBC Mobile." },
  ]);
  builder.push([{ x: KBC_LEFT, text: "Een onderneming van de KBC-groep" }]);
  builder.push([{ x: 534.7, text: pageMarker }]);
  builder.push([{ x: 435.8, text: "004512 / 4083321870/2210035/202606 /" }]);
};

const kbcStatement = (input: {
  readonly openingCents: number;
  readonly closingCents: number;
  readonly rows: readonly KbcFixtureRow[];
  readonly pageOneCount: number;
  // Which card this document belongs to, and which statement number it
  // carries. Parameters rather than constants since fix round 2, because
  // the second-card witness (HZ-M3P3-02) is this same document under a
  // different card identity.
  readonly maskedCard?: string;
  readonly statementNumber?: string;
}): PageContent[] => {
  const maskedCard = input.maskedCard ?? KBC_MASKED_CARD;
  const statementNumber = input.statementNumber ?? KBC_STATEMENT_NUMBER;
  const period = "Overzicht van je verrichtingen van 17-05-2026 tot 14-06-2026";

  const pageOne = makeBuilder();
  pageOne.push([{ x: 93.6, text: "Jansen Pieter" }]);
  pageOne.push([{ x: 93.6, text: "Voorbeeldstraat 7" }]);
  pageOne.push([{ x: 93.6, text: "2000 Demostad" }]);
  pageOne.gap();
  pageOne.push([{ x: KBC_LEFT, text: "KBC-Mastercard" }]);
  pageOne.push([{ x: KBC_LEFT, text: "Uitgavenstaat" }]);
  pageOne.push([{ x: KBC_LEFT, text: "Klantenreferentie: 4083321870" }]);
  pageOne.push([
    { x: KBC_LEFT, text: `Uitgavenstaatnummer: ${statementNumber}` },
  ]);
  pageOne.push([{ x: KBC_LEFT, text: "Gebruikslimiet: 2 500,00 EUR" }]);
  pageOne.push([{ x: KBC_LEFT, text: `Kaartnummer(s): ${maskedCard}` }]);
  pageOne.gap();
  kbcHeaderBlock(pageOne, period);
  pageOne.push([
    { x: KBC_BALANCE_X, text: "Vorig saldo op 16-05-2026" },
    { x: KBC_AMOUNT_X, text: formatKbcCents(input.openingCents) },
  ]);
  pageOne.push([{ x: KBC_BALANCE_X, text: `Kaartnummer ${maskedCard}` }]);
  pageOne.push([{ x: KBC_BALANCE_X, text: "Jansen Pieter" }]);
  for (const row of input.rows.slice(0, input.pageOneCount)) {
    kbcRow(pageOne, row);
  }
  kbcFooter(pageOne, "1/2");

  const pageTwo = makeBuilder();
  pageTwo.push([{ x: KBC_LEFT, text: `Vervolg ${period.toLowerCase()}` }]);
  kbcHeaderBlock(pageTwo, period);
  for (const row of input.rows.slice(input.pageOneCount)) {
    kbcRow(pageTwo, row);
  }
  pageTwo.push([
    { x: KBC_BALANCE_X, text: "Totaal bedrag van de kaartverrichtingen op 14-06-2026" },
  ]);
  pageTwo.push([
    { x: KBC_BALANCE_X, text: "Afrekening via je bank op 22-06-2026" },
    { x: KBC_AMOUNT_X, text: formatKbcCents(input.closingCents) },
  ]);
  kbcFooter(pageTwo, "2/2");

  return [pageOne.lines, pageTwo.lines];
};

// ---------------------------------------------------------------------
// Companion Belfius-side fixture (statement 7): the account-side
// settlement debit whose amount equals the KBC fixture's Afrekening
// total, so the D-11 pairing is witnessable end to end across two PDF
// imports (plan step 3, criteria 3.3 and 3.4). Booked 03-06, two days
// after the card-side DOMICILIERING credit: inside the 4-day mirror
// window and inside the 45-day settlement window of the card import's
// period end.
// ---------------------------------------------------------------------

export const COMPANION_SETTLEMENT_DEBIT_SEQUENCE = "0131";

export const COMPANION_OPENING_CENTS = 120000; // "+1.200,00"

// The refund family's own companion (fix round 2): its settlement debit
// equals the REFUND statement's Afrekening figure, which differs from
// that statement's debit-row sum by exactly the refund. Under the
// pre-fix row-sum derivation this debit matches no card import and stays
// SPEND while the card's own rows are counted too; under the fix it is
// INTERNAL and linked. Booked two days after the card statement's last
// row, inside the settlement window.
//
// STATED PLAINLY, because it is a property of this fixture and not a
// defect: this statement's card-side DOMICILIERING credit settles the
// PREVIOUS card statement, which this scenario does not import, so the
// credit has no debit to mirror here and stays a surfaced unmatched
// INTERNAL leg. That is the honest shape of a single imported card
// month; the zero-gap month view lives on the other family, whose
// companion debit does double duty precisely because that family is
// degenerate.
export const COMPANION_REFUND_SETTLEMENT_SEQUENCE = "0141";

export const COMPANION_REFUND_OPENING_CENTS = 90000; // "+900,00"

export const COMPANION_REFUND_TRANSACTIONS: readonly FixtureTransaction[] = [
  {
    sequence: "0140",
    bookingDate: "05-06-2026",
    valueDate: "05-06-2026",
    amountText: "+1.500,00",
    amountCents: 150000,
    description: [
      `INSTANT STORTING VAN ${COUNTERPARTY_DEPOSIT} Demo Werkgever`,
      "Loon juni deel twee",
    ],
  },
  {
    sequence: COMPANION_REFUND_SETTLEMENT_SEQUENCE,
    bookingDate: "10-06-2026",
    valueDate: "10-06-2026",
    amountText: "-463,50",
    amountCents: -46350,
    description: [
      `MASTERCARD AFREKENING NUMMER ${KBC_REFUND_STATEMENT_NUMBER}`,
      `KAART ${KBC_SECOND_MASKED_CARD}`,
    ],
  },
  {
    sequence: "0142",
    bookingDate: "12-06-2026",
    valueDate: "12-06-2026",
    amountText: "- 40,00",
    amountCents: -4000,
    description: [
      "BANCONTACT-AANKOOP - Kruidenier De Notelaar - 9000 GENT BE -",
      "12/06/26 17:40 - CONTACTLOOS - KAART 5599 20XX XXXX 5544",
    ],
  },
];

export const COMPANION_TRANSACTIONS: readonly FixtureTransaction[] = [
  {
    sequence: "0130",
    bookingDate: "01-06-2026",
    valueDate: "01-06-2026",
    amountText: "+2.000,00",
    amountCents: 200000,
    description: [
      `INSTANT STORTING VAN ${COUNTERPARTY_DEPOSIT} Demo Werkgever`,
      "Loon juni",
    ],
  },
  {
    sequence: COMPANION_SETTLEMENT_DEBIT_SEQUENCE,
    bookingDate: "03-06-2026",
    valueDate: "03-06-2026",
    amountText: "-1.234,56",
    amountCents: -123456,
    description: [
      `MASTERCARD AFREKENING NUMMER ${KBC_STATEMENT_NUMBER}`,
      `KAART ${KBC_MASKED_CARD}`,
    ],
  },
  {
    sequence: "0132",
    bookingDate: "06-06-2026",
    valueDate: "06-06-2026",
    amountText: "- 25,00",
    amountCents: -2500,
    description: [
      "BANCONTACT-AANKOOP - Bakkerij Zonnig - 3700 TONGEREN BE -",
      "06/06/26 09:15 - CONTACTLOOS - KAART 5599 20XX XXXX 5544",
    ],
  },
  {
    sequence: "0133",
    bookingDate: "10-06-2026",
    valueDate: "10-06-2026",
    amountText: "+ 50,00",
    amountCents: 5000,
    description: [
      `STORTING VAN ${COUNTERPARTY_DEPOSIT} Gezin Voorbeeld`,
      "Verjaardag",
    ],
  },
];

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
// M3-P12 counterparty-identity fixture. It reproduces the SHAPE of the
// owner's real month and nothing of its content: rows sharing one
// counterparty account with a different free-text communication on each,
// rows sharing one counterparty account with a different reference on each,
// card-descriptor rows carrying their own date and amount, and rows with
// neither an account nor a card shape whose descriptors differ per row.
//
// EVERY VALUE BELOW IS INVENTED. The accounts are hand-built digit runs
// with the ISO 7064 check digits computed for them so the trust gate has
// something valid to accept; the card number is the one the earlier Belfius
// fixtures already carry; the merchant-like words are Dutch nouns with DEMO
// or VOORBEELD in them; the dates are in March 2026, outside both real
// documents' ranges and outside every other fixture's. All of it is listed
// in test/fixtures/allowed-identifiers.txt with its provenance.
//
// THE COMPOSITION IS ARITHMETIC, not taste (criterion 12.1). 24 rows must
// carry 12 counterparties with a BASELINE of 24 distinct keys, at least 8
// rows on a trusted account over at least 4 distinct accounts, and at least
// 8 rows on no trusted account. Writing r for rows, k for identity keys, A
// for trusted-account rows, D for descriptor-basis rows and n for distinct
// accounts: every descriptor row is its own key (that is what a baseline of
// 24 means), so k = n + D and r = A + D, giving A - n = 12. D >= 8 forces
// n <= 4 and n >= 4 forces D <= 8, so n = 4, D = 8 and A = 16 EXACTLY. There
// is one composition, not a family of them.
//
// THE THREE ROWS THAT ATTACK THE ACCOUNT BASIS are rows 8, 13 and 20. Rows 8
// and 13 carry a longer-than-Belgian account written spaced: the shipped
// scrape's account shape is the Belgian one, so it stores a SIXTEEN-CHARACTER
// PREFIX, and these two sources are chosen to differ only after that prefix
// so both store the IDENTICAL value. That is hazard H12.14 built rather than
// argued: without the trust gate those two rows would be one counterparty.
// Row 20 carries TWO distinct account-shaped tokens, and the record below
// says which one the generator wrote FIRST, so criterion 12.16 pins the
// importer's first-wins rule instead of being satisfied by writing the
// intended token first.
// ---------------------------------------------------------------------

// The statement's own account. A different one from every other fixture, so
// this fixture can be ingested beside them.
const IDENTITY_OWN_IBAN_SPACED = "BE31 1111 2222 3333";

// The four trusted counterparty accounts, one per account-basis
// counterparty, and the fifth that exists only as row 20's SECOND token and
// must therefore never appear in any identity key.
const IDENTITY_CP1_IBAN_SPACED = "BE78 2222 3333 4444";
const IDENTITY_CP2_IBAN_SPACED = "BE28 3333 4444 5555";
const IDENTITY_CP3_IBAN_SPACED = "BE75 4444 5555 6666";
const IDENTITY_CP4_IBAN_SPACED = "BE25 5555 6666 7777";
const IDENTITY_SECOND_TOKEN_IBAN_SPACED = "BE72 6666 7777 8888";

// The two longer-than-Belgian sources. Both are valid under ISO 7064 at
// their full length, they carry the SAME check digits, and they differ only
// in their last three digits, so the sixteen-character prefix the shipped
// scrape stores is byte-identical for both.
const IDENTITY_LONG_A_SPACED = "FR02 3000 6000 0112 3456 7890 066";
const IDENTITY_LONG_B_SPACED = "FR02 3000 6000 0112 3456 7890 163";

export const IDENTITY_FIXTURE_LONG_SOURCES = {
  spacedA: IDENTITY_LONG_A_SPACED,
  spacedB: IDENTITY_LONG_B_SPACED,
  // What the shipped Belfius scrape actually stores for BOTH of them.
  storedPrefix: IDENTITY_LONG_A_SPACED.replace(/\s/g, "").slice(0, 16),
} as const;

export const IDENTITY_FIXTURE_TWO_TOKEN = {
  rowOrdinal: 20,
  firstTokenSpaced: IDENTITY_CP4_IBAN_SPACED,
  secondTokenSpaced: IDENTITY_SECOND_TOKEN_IBAN_SPACED,
} as const;

export const IDENTITY_FIXTURE_ACCOUNTS = {
  own: IDENTITY_OWN_IBAN_SPACED.replace(/\s/g, ""),
  counterparty1: IDENTITY_CP1_IBAN_SPACED.replace(/\s/g, ""),
  counterparty2: IDENTITY_CP2_IBAN_SPACED.replace(/\s/g, ""),
  counterparty3: IDENTITY_CP3_IBAN_SPACED.replace(/\s/g, ""),
  counterparty4: IDENTITY_CP4_IBAN_SPACED.replace(/\s/g, ""),
  secondToken: IDENTITY_SECOND_TOKEN_IBAN_SPACED.replace(/\s/g, ""),
} as const;

// The counterparty criterion 12.3 names. Three SPEND rows, differing in
// booking date, in amount and in free-text communication.
export const IDENTITY_FIXTURE_DESIGNATED_COUNTERPARTY = 1;
export const IDENTITY_FIXTURE_DESIGNATED_ROW_COUNT = 3;

// A row of the fixture, carrying the INVENTED COUNTERPARTY ORDINAL it was
// generated FROM. That ordinal is the generator's INPUT: the description is
// written to belong to it, never read back out of it. This is what makes the
// record below an independent oracle rather than a transcription of
// counterpartyIdentity's own output (criterion 12.4, hazard H12.17).
type IdentityFixtureRow = FixtureTransaction & {
  readonly counterparty: number;
};

export const IDENTITY_FIXTURE_TRANSACTIONS: readonly IdentityFixtureRow[] = [
  {
    counterparty: 1,
    sequence: "0301",
    bookingDate: "02-03-2026",
    valueDate: "02-03-2026",
    amountText: "- 120,00",
    amountCents: -12000,
    description: [
      `OVERSCHRIJVING NAAR ${IDENTITY_CP1_IBAN_SPACED} DEMO VERZEKERING`,
      "MEDEDELING: Premie kwartaal een",
    ],
  },
  {
    counterparty: 7,
    sequence: "0302",
    bookingDate: "02-03-2026",
    valueDate: "02-03-2026",
    amountText: "- 21,50",
    amountCents: -2150,
    description: [
      "DEBITMASTERCARD-BETALING VIA Google Pay 01/03 Boekhandel",
      "Zilverblad BE 21,50 EUR KAART NR 5599 2088 7766 5544 -",
      "Jansen Pieter",
    ],
  },
  {
    counterparty: 2,
    sequence: "0303",
    bookingDate: "03-03-2026",
    valueDate: "03-03-2026",
    amountText: "- 60,00",
    amountCents: -6000,
    description: [
      `UW EUROPESE DOMICILIERING ${IDENTITY_CP2_IBAN_SPACED} DEMO ENERGIE`,
      "REFERTE 9000000101",
    ],
  },
  {
    counterparty: 3,
    sequence: "0304",
    bookingDate: "03-03-2026",
    valueDate: "03-03-2026",
    amountText: "+2.100,00",
    amountCents: 210000,
    description: [
      `STORTING VAN ${IDENTITY_CP3_IBAN_SPACED} DEMO WERKGEVER`,
      "MEDEDELING: Vergoeding deel een",
    ],
  },
  {
    counterparty: 10,
    sequence: "0305",
    bookingDate: "04-03-2026",
    valueDate: "04-03-2026",
    amountText: "- 9,50",
    amountCents: -950,
    description: ["KOSTEN DEMO REKENINGPAKKET"],
  },
  {
    counterparty: 1,
    sequence: "0306",
    bookingDate: "05-03-2026",
    valueDate: "05-03-2026",
    amountText: "- 135,50",
    amountCents: -13550,
    description: [
      `OVERSCHRIJVING NAAR ${IDENTITY_CP1_IBAN_SPACED} DEMO VERZEKERING`,
      "MEDEDELING: Premie kwartaal twee",
    ],
  },
  {
    counterparty: 2,
    sequence: "0307",
    bookingDate: "06-03-2026",
    valueDate: "06-03-2026",
    amountText: "- 61,00",
    amountCents: -6100,
    description: [
      `UW EUROPESE DOMICILIERING ${IDENTITY_CP2_IBAN_SPACED} DEMO ENERGIE`,
      "REFERTE 9000000102",
    ],
  },
  {
    counterparty: 5,
    sequence: "0308",
    bookingDate: "07-03-2026",
    valueDate: "07-03-2026",
    amountText: "- 210,00",
    amountCents: -21000,
    description: [
      `OVERSCHRIJVING NAAR ${IDENTITY_LONG_A_SPACED} DEMO ALFA`,
      "MEDEDELING: Bestelling alfa",
    ],
  },
  {
    counterparty: 3,
    sequence: "0309",
    bookingDate: "08-03-2026",
    valueDate: "08-03-2026",
    amountText: "+2.150,00",
    amountCents: 215000,
    description: [
      `STORTING VAN ${IDENTITY_CP3_IBAN_SPACED} DEMO WERKGEVER`,
      "MEDEDELING: Vergoeding deel twee",
    ],
  },
  {
    counterparty: 8,
    sequence: "0310",
    bookingDate: "09-03-2026",
    valueDate: "09-03-2026",
    amountText: "- 32,40",
    amountCents: -3240,
    description: [
      "DEBITMASTERCARD-BETALING VIA Google Pay 08/03 Bloemenhoek",
      "Voorbeeld BE 32,40 EUR KAART NR 5599 2088 7766 5544 -",
      "Jansen Pieter",
    ],
  },
  {
    counterparty: 4,
    sequence: "0311",
    bookingDate: "10-03-2026",
    valueDate: "10-03-2026",
    amountText: "- 85,00",
    amountCents: -8500,
    description: [
      `OVERSCHRIJVING NAAR ${IDENTITY_CP4_IBAN_SPACED} DEMO SYNDIC`,
      "MEDEDELING: Afrekening een",
    ],
  },
  {
    counterparty: 2,
    sequence: "0312",
    bookingDate: "11-03-2026",
    valueDate: "11-03-2026",
    amountText: "- 62,00",
    amountCents: -6200,
    description: [
      `UW EUROPESE DOMICILIERING ${IDENTITY_CP2_IBAN_SPACED} DEMO ENERGIE`,
      "REFERTE 9000000103",
    ],
  },
  {
    counterparty: 6,
    sequence: "0313",
    bookingDate: "12-03-2026",
    valueDate: "12-03-2026",
    amountText: "- 211,00",
    amountCents: -21100,
    description: [
      `OVERSCHRIJVING NAAR ${IDENTITY_LONG_B_SPACED} DEMO BETA`,
      "MEDEDELING: Bestelling beta",
    ],
  },
  {
    counterparty: 3,
    sequence: "0314",
    bookingDate: "13-03-2026",
    valueDate: "13-03-2026",
    amountText: "+2.200,00",
    amountCents: 220000,
    description: [
      `STORTING VAN ${IDENTITY_CP3_IBAN_SPACED} DEMO WERKGEVER`,
      "MEDEDELING: Vergoeding deel drie",
    ],
  },
  {
    counterparty: 11,
    sequence: "0315",
    bookingDate: "14-03-2026",
    valueDate: "14-03-2026",
    amountText: "- 4,00",
    amountCents: -400,
    description: ["BIJDRAGE DEMO VERENIGING JAARLIJKS"],
  },
  {
    counterparty: 1,
    sequence: "0316",
    bookingDate: "15-03-2026",
    valueDate: "15-03-2026",
    amountText: "- 142,75",
    amountCents: -14275,
    description: [
      `OVERSCHRIJVING NAAR ${IDENTITY_CP1_IBAN_SPACED} DEMO VERZEKERING`,
      "MEDEDELING: Premie kwartaal drie",
    ],
  },
  {
    counterparty: 2,
    sequence: "0317",
    bookingDate: "16-03-2026",
    valueDate: "16-03-2026",
    amountText: "- 63,00",
    amountCents: -6300,
    description: [
      `UW EUROPESE DOMICILIERING ${IDENTITY_CP2_IBAN_SPACED} DEMO ENERGIE`,
      "REFERTE 9000000104",
    ],
  },
  {
    counterparty: 9,
    sequence: "0318",
    bookingDate: "17-03-2026",
    valueDate: "17-03-2026",
    amountText: "- 18,95",
    amountCents: -1895,
    description: [
      "DEBITMASTERCARD-BETALING VIA Google Pay 16/03 Kaaswinkel",
      "Voorbeelddal BE 18,95 EUR KAART NR 5599 2088 7766 5544 -",
      "Jansen Pieter",
    ],
  },
  {
    counterparty: 3,
    sequence: "0319",
    bookingDate: "18-03-2026",
    valueDate: "18-03-2026",
    amountText: "+2.250,00",
    amountCents: 225000,
    description: [
      `STORTING VAN ${IDENTITY_CP3_IBAN_SPACED} DEMO WERKGEVER`,
      "MEDEDELING: Vergoeding deel vier",
    ],
  },
  {
    // ROW 20, the two-token row. The FIRST account-shaped token is
    // counterparty 4's; the second belongs to nothing else in this fixture.
    counterparty: 4,
    sequence: "0320",
    bookingDate: "19-03-2026",
    valueDate: "19-03-2026",
    amountText: "- 86,00",
    amountCents: -8600,
    description: [
      `OVERSCHRIJVING NAAR ${IDENTITY_CP4_IBAN_SPACED} DEMO SYNDIC`,
      `VIA ${IDENTITY_SECOND_TOKEN_IBAN_SPACED} MEDEDELING: Afrekening twee`,
    ],
  },
  {
    counterparty: 2,
    sequence: "0321",
    bookingDate: "20-03-2026",
    valueDate: "20-03-2026",
    amountText: "- 64,00",
    amountCents: -6400,
    description: [
      `UW EUROPESE DOMICILIERING ${IDENTITY_CP2_IBAN_SPACED} DEMO ENERGIE`,
      "REFERTE 9000000105",
    ],
  },
  {
    counterparty: 12,
    sequence: "0322",
    bookingDate: "21-03-2026",
    valueDate: "21-03-2026",
    amountText: "+ 15,00",
    amountCents: 1500,
    description: ["TERUGGAVE DEMO WAARBORG VOORBEELD"],
  },
  {
    counterparty: 3,
    sequence: "0323",
    bookingDate: "22-03-2026",
    valueDate: "22-03-2026",
    amountText: "+2.300,00",
    amountCents: 230000,
    description: [
      `STORTING VAN ${IDENTITY_CP3_IBAN_SPACED} DEMO WERKGEVER`,
      "MEDEDELING: Vergoeding deel vijf",
    ],
  },
  {
    counterparty: 4,
    sequence: "0324",
    bookingDate: "23-03-2026",
    valueDate: "23-03-2026",
    amountText: "- 87,00",
    amountCents: -8700,
    description: [
      `OVERSCHRIJVING NAAR ${IDENTITY_CP4_IBAN_SPACED} DEMO SYNDIC`,
      "MEDEDELING: Afrekening drie",
    ],
  },
];

export const IDENTITY_FIXTURE_OPENING_CENTS = 25000;

// THE GENERATOR'S OWN INPUT RECORD (criterion 12.4). Row ordinal, one-based
// in the order the parser returns rows, to the invented counterparty ordinal
// the row was WRITTEN FOR. Derived from the declarations above and from
// nothing else: no import of counterpartyIdentity reaches this file.
export const IDENTITY_FIXTURE_ROW_TO_COUNTERPARTY: readonly {
  readonly row: number;
  readonly counterparty: number;
}[] = IDENTITY_FIXTURE_TRANSACTIONS.map((transaction, index) => ({
  row: index + 1,
  counterparty: transaction.counterparty,
}));

const IDENTITY_FIXTURE_RECORD_BYTES = (): Uint8Array =>
  new TextEncoder().encode(
    `${JSON.stringify(
      {
        fixture: "belfius-counterparty-identity.pdf",
        rows: IDENTITY_FIXTURE_TRANSACTIONS.length,
        counterparties: new Set(
          IDENTITY_FIXTURE_TRANSACTIONS.map((t) => t.counterparty),
        ).size,
        rowToCounterparty: IDENTITY_FIXTURE_ROW_TO_COUNTERPARTY,
      },
      null,
      2,
    )}\n`,
  );

// ---------------------------------------------------------------------
// Assembly.
// ---------------------------------------------------------------------

// Non-PDF records the generator emits in the SAME run as the PDFs. Kept
// separate from buildPdfFixtures because the privacy gate's third rule
// enumerates tracked PDFs and these are not PDFs.
export const buildFixtureRecords = (): ReadonlyMap<string, Uint8Array> =>
  new Map([
    ["belfius-counterparty-identity-map.json", IDENTITY_FIXTURE_RECORD_BYTES()],
  ]);

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

  // KBC family: the generator PROVES the balance identity of the
  // reconciling KBC fixture arithmetically, the same identity the real
  // statement satisfies (Vorig saldo + all rows including the credit =
  // Afrekening): the closing is computed, never hand-written, and the
  // non-reconciling variant is exactly 1,00 EUR off.
  const kbcSum = KBC_FIXTURE_ROWS.reduce(
    (sum, row) => sum + checkedKbcCents(row),
    0,
  );
  const kbcClosing = KBC_FIXTURE_OPENING_CENTS + kbcSum;
  const kbcFixtureA = buildPdf(
    kbcStatement({
      openingCents: KBC_FIXTURE_OPENING_CENTS,
      closingCents: kbcClosing,
      rows: KBC_FIXTURE_ROWS,
      pageOneCount: 4,
    }),
  );
  const kbcNonreconciling = buildPdf(
    kbcStatement({
      openingCents: KBC_FIXTURE_OPENING_CENTS,
      closingCents: kbcClosing - 100,
      rows: KBC_FIXTURE_ROWS,
      pageOneCount: 4,
    }),
  );
  // THE SECOND CARD (HZ-M3P3-02): byte-for-byte the reconciling fixture
  // above except for which card it belongs to. Two documents, two cards,
  // one household: the case a two-person household actually hits.
  const kbcSecondCard = buildPdf(
    kbcStatement({
      openingCents: KBC_FIXTURE_OPENING_CENTS,
      closingCents: kbcClosing,
      rows: KBC_FIXTURE_ROWS,
      pageOneCount: 4,
      maskedCard: KBC_SECOND_MASKED_CARD,
    }),
  );
  // THE REFUND STATEMENT (HZ-M3P3-01, -05, -06): the closing is computed
  // from the same identity, so the three numbers separate arithmetically
  // rather than by hand.
  const kbcRefundSum = KBC_REFUND_ROWS.reduce(
    (sum, row) => sum + checkedKbcCents(row),
    0,
  );
  const kbcRefundClosing = KBC_REFUND_OPENING_CENTS + kbcRefundSum;
  const kbcRefund = buildPdf(
    kbcStatement({
      openingCents: KBC_REFUND_OPENING_CENTS,
      closingCents: kbcRefundClosing,
      rows: KBC_REFUND_ROWS,
      pageOneCount: 3,
      maskedCard: KBC_SECOND_MASKED_CARD,
      statementNumber: KBC_REFUND_STATEMENT_NUMBER,
    }),
  );

  const companionSum = COMPANION_TRANSACTIONS.reduce(
    (sum, transaction) => sum + checkedCents(transaction),
    0,
  );
  const companionClosing = COMPANION_OPENING_CENTS + companionSum;
  const companionFixture = buildPdf(
    belfiusStatement({
      pageMarkerFirst: "BLZ. : 7/1",
      pageMarkerRest: "13-06-2026 7/2",
      holderDateLine: "VOORBEELDSTRAAT 7 DATUM : 13-06-2026",
      openingLine: `SALDO OP 31-05-2026 EUR ${formatClosingCents(COMPANION_OPENING_CENTS)}`,
      closingLine: `SALDO OP 13-06-2026 11:30 EUR ${formatClosingCents(companionClosing)}`,
      pageOneCount: 2,
      transactions: COMPANION_TRANSACTIONS,
      annexPage: false,
    }),
  );

  const kbcCreditSum = KBC_CREDIT_ROWS.reduce(
    (sum, row) => sum + checkedKbcCents(row),
    0,
  );
  const kbcCredit = buildPdf(
    kbcStatement({
      openingCents: KBC_CREDIT_OPENING_CENTS,
      closingCents: KBC_CREDIT_OPENING_CENTS + kbcCreditSum,
      rows: KBC_CREDIT_ROWS,
      pageOneCount: 2,
      maskedCard: KBC_THIRD_MASKED_CARD,
      statementNumber: KBC_CREDIT_STATEMENT_NUMBER,
    }),
  );

  const kbcUnderpaidSum = KBC_UNDERPAID_ROWS.reduce(
    (sum, row) => sum + checkedKbcCents(row),
    0,
  );
  const kbcUnderpaid = buildPdf(
    kbcStatement({
      openingCents: KBC_UNDERPAID_OPENING_CENTS,
      closingCents: KBC_UNDERPAID_OPENING_CENTS + kbcUnderpaidSum,
      rows: KBC_UNDERPAID_ROWS,
      pageOneCount: 2,
      maskedCard: KBC_FOURTH_MASKED_CARD,
      statementNumber: KBC_UNDERPAID_STATEMENT_NUMBER,
    }),
  );

  const companionRefundSum = COMPANION_REFUND_TRANSACTIONS.reduce(
    (sum, transaction) => sum + checkedCents(transaction),
    0,
  );
  const companionRefundFixture = buildPdf(
    belfiusStatement({
      pageMarkerFirst: "BLZ. : 8/1",
      pageMarkerRest: "13-06-2026 8/2",
      holderDateLine: "VOORBEELDSTRAAT 7 DATUM : 13-06-2026",
      openingLine: `SALDO OP 31-05-2026 EUR ${formatClosingCents(COMPANION_REFUND_OPENING_CENTS)}`,
      closingLine: `SALDO OP 13-06-2026 11:30 EUR ${formatClosingCents(COMPANION_REFUND_OPENING_CENTS + companionRefundSum)}`,
      pageOneCount: 2,
      transactions: COMPANION_REFUND_TRANSACTIONS,
      annexPage: false,
    }),
  );

  const sumE = FIXTURE_E_TRANSACTIONS.reduce(
    (sum, transaction) => sum + checkedCents(transaction),
    0,
  );
  const closingE = FIXTURE_E_OPENING_CENTS + sumE;
  const fixtureE = buildPdf(
    belfiusStatement({
      pageMarkerFirst: "BLZ. : 6/1",
      pageMarkerRest: "18-05-2026 6/2",
      holderDateLine: "VOORBEELDSTRAAT 7 DATUM : 18-05-2026",
      openingLine: "SALDO OP 16-05-2026 EUR + 500,00",
      closingLine: `SALDO OP 18-05-2026 12:00 EUR ${formatClosingCents(closingE)}`,
      pageOneCount: 1,
      transactions: FIXTURE_E_TRANSACTIONS,
      annexPage: false,
    }),
  );

  const identitySum = IDENTITY_FIXTURE_TRANSACTIONS.reduce(
    (sum, transaction) => sum + checkedCents(transaction),
    0,
  );
  const identityFixture = buildPdf(
    belfiusStatement({
      pageMarkerFirst: "BLZ. : 9/1",
      pageMarkerRest: "24-03-2026 9/2",
      holderDateLine: "VOORBEELDSTRAAT 7 DATUM : 24-03-2026",
      openingLine: `SALDO OP 28-02-2026 EUR ${formatClosingCents(IDENTITY_FIXTURE_OPENING_CENTS)}`,
      closingLine: `SALDO OP 24-03-2026 09:15 EUR ${formatClosingCents(IDENTITY_FIXTURE_OPENING_CENTS + identitySum)}`,
      pageOneCount: 12,
      transactions: IDENTITY_FIXTURE_TRANSACTIONS,
      annexPage: false,
      bandIban: IDENTITY_OWN_IBAN_SPACED,
    }),
  );

  return new Map([
    ["belfius-counterparty-identity.pdf", identityFixture],
    ["belfius-statement-a.pdf", fixtureA],
    ["belfius-statement-b-overlap.pdf", fixtureB],
    ["belfius-nonreconciling.pdf", fixtureC],
    ["unknown-layout.pdf", fixtureD],
    ["belfius-inline-shapes.pdf", fixtureE],
    ["kbc-statement-a.pdf", kbcFixtureA],
    ["kbc-nonreconciling.pdf", kbcNonreconciling],
    ["kbc-statement-second-card.pdf", kbcSecondCard],
    ["kbc-statement-refund.pdf", kbcRefund],
    ["kbc-statement-credit.pdf", kbcCredit],
    ["kbc-statement-underpaid.pdf", kbcUnderpaid],
    ["belfius-settlement-companion.pdf", companionFixture],
    ["belfius-settlement-companion-refund.pdf", companionRefundFixture],
  ]);
};

const isMain = (): boolean => {
  const entry = process.argv[1];
  return entry !== undefined && fileURLToPath(import.meta.url) === entry;
};

if (isMain()) {
  const directory = fileURLToPath(new URL(".", import.meta.url));
  // ONE RUN WRITES BOTH (criterion 12.4): the PDF and the record of what the
  // PDF was generated FROM. A record written by a second command could be
  // edited between the two, and a record transcribed from the derivation's
  // output would certify that derivation against itself.
  for (const [name, bytes] of [...buildPdfFixtures(), ...buildFixtureRecords()]) {
    writeFileSync(join(directory, name), bytes);
    console.log(`${name}: ${bytes.length} bytes`);
  }
}
