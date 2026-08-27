// Layout template B: the KBC Mastercard uitgavenstaat (NL), per the v0.2
// addendum section 4 and the structure verified against the real
// statement's text layer (M3-P3 verification notes). Pure functions over
// reconstructed lines; no writes, no I/O, no library text assembly
// (mechanism rule at pdf-template.ts; sibling implementation:
// belfius-current-account-template.ts).
//
// Structure this template relies on, all verified on the real file:
// - Fingerprint: "KBC-Mastercard" plus "Uitgavenstaat" header text
//   (pulse-v0.2-pdf-addendum.md:73). Label matching everywhere in this
//   template tolerates glued interior spacing (\s* between label words),
//   because extraction word spacing is tolerance-sensitive on this
//   layout (notes/export-format-facts.md, M0-P2 scout fact 4).
// - A transaction row is ONE line: transaction date, settlement date,
//   description, and a signed amount at line end. The BOOKING DATE IS
//   THE TRANSACTION DATE, so spend lands in the month it happened
//   (addendum:76, finding PR2-004); the settlement date is kept verbatim
//   in rawLine and as the value date (datum verrekening).
// - Amounts are tight-signed with comma decimals and a SPACE thousands
//   separator ("-1 234,56" shape). The space form is handled HERE and
//   the digits go through the frozen parseAmountToCents comma style with
//   the spaces stripped; parse-amount.ts itself is unchanged because its
//   accepted shapes also feed delimited detection.
// - FX continuation lines ("Bedrag <n> <CCY>", "Koers (1 EUR = ..)")
//   belong to the PRECEDING row: folded into that row's rawLine, never
//   rows, never description (addendum:78, hazard H3.2). A continuation
//   line with NO open row is a structure error, loud, zero rows.
// - "Vorig saldo op <date> <amount>" is the opening balance. "Totaal
//   bedrag van de kaartverrichtingen op <date>" carries NO amount; the
//   closing figure sits on the "Afrekening via je bank op <date>
//   <amount>" line (scout fact 5). All three are balances, never
//   transactions; the "DOMICILIERING VIA JE BANK" credit row IS a
//   transaction (the card-side settlement leg, addendum:83).
//   CORRECTED RATHER THAN QUIETLY REWRITTEN (R-087, fix round 2, finding
//   HZ-M3P3-07): the sentence above states the shape as SINGULAR and
//   nothing used to keep it singular. The parse collected every opening
//   and every closing line it saw and silently kept the first opening and
//   the last closing, so a repeated or corrected balance line changed the
//   parsed identity with nothing said. Repeats carrying the SAME value are
//   now folded; two DIFFERENT values are a loud structure error.
// - THE CLOSING FIGURE IS ALSO THIS STATEMENT'S SETTLEMENT TOTAL: it is
//   the amount the issuer collects by direct debit, and it is returned as
//   settlementTotalCents so nothing downstream has to re-derive it from
//   the row signs (fix round 2, finding HZ-M3P3-01). The two differ by
//   exactly any ordinary merchant refund on the statement.
// - The file carries NO IBAN and NO sequence numbers: accountIbans is
//   empty and hasNaturalKey is false, so dedup takes the HASH path with
//   the occurrence ordinal (dedup.ts), which is what keeps the format's
//   legitimate identical duplicate rows distinct (addendum:86, hazard
//   H3.3).
// - ACCOUNT IDENTITY IS THE MASKED CARD NUMBER on the "Kaartnummer(s):"
//   header line, returned as the spec's accountIdentifier (fix round 2,
//   finding HZ-M3P3-02, and the plan's own step-1 wording at
//   pulse-v02.yaml:1087). CORRECTED RATHER THAN QUIETLY REWRITTEN
//   (R-087): this header used to say identity "rides the confirmed
//   profile's account binding" and nothing else, which is true of the
//   binding but not of IDENTITY: the spec carried no discriminator, so
//   two cards of one issuer produced one spec, one profile and one
//   account, and the second card's rows landed on the first card's
//   account with rows that matched an existing day, amount and merchant
//   absorbed as already known. The masked number is what tells them
//   apart, and a card file that does not carry one is a loud structure
//   error, never a silent bind.
//
// LINE CLASSIFICATION IS SHAPE-FIRST HERE, deliberately unlike the
// Belfius template's positional rule (HZ-001): on THIS layout the
// counterparty-controlled text is a SUBSTRING OF THE ROW LINE, not
// free-standing lines, so a crafted merchant string cannot mint a line
// of its own and the fabricated-row construction has no analogue.
// Header, footer and marketing lines are bank-controlled boilerplate
// and match none of the structural shapes; they are ignored. Two loud
// guards close the zero-sum corruption shapes the balance gate alone
// cannot see: a line STARTING with the two-date row prefix that does
// not parse as a full row is a structure error (a corrupted row can
// never be silently skipped), and a continuation line outside any open
// row is a structure error. RESIDUE, STATED: a corrupted row line whose
// two-date prefix is itself damaged is indistinguishable from
// boilerplate and drops silently when its amount is zero; the balance
// gate covers every nonzero variant, and this format has no sequence
// numbers to anchor a continuity gate on.

import { err, ok, type Result } from "@/platform/result";
import type { Cents } from "@/platform/money";
import { isValidPlainDate, plainDate, type PlainDate } from "@/platform/plain-date";
import { parseAmountToCents } from "./parse-amount";
import type { ParsedRow } from "./parse-statement";
import type {
  PdfLayoutTemplate,
  PdfPageLines,
  PdfTemplateError,
  PdfTemplateOutcome,
} from "./pdf-template";

const FINGERPRINT_CARD = "KBC-Mastercard";
const FINGERPRINT_DOCUMENT = "Uitgavenstaat";

// Signed amount, tight or spaced sign, comma decimals, thousands either
// absent or space-grouped (the layout's own form; the Belfius dot form
// does not occur here).
const AMOUNT = "[+-]\\s?(?:\\d{1,3}(?: \\d{3})+|\\d+),\\d{2}";

const TWO_DATE_PREFIX = /^\d{2}-\d{2}-\d{4}\s+\d{2}-\d{2}-\d{4}(?:\s|$)/;
const TRANSACTION_ROW = new RegExp(
  `^(\\d{2}-\\d{2}-\\d{4})\\s+(\\d{2}-\\d{2}-\\d{4})\\s+(.+?)\\s+(${AMOUNT})$`,
);

// FX continuation shapes (addendum:78): the original amount and the
// exchange rate. \s* between label words: glue-tolerant.
const FX_AMOUNT_LINE = /^Bedrag\s*[\d.,]+\s*[A-Z]{3}$/;
const FX_RATE_LINE = /^Koers\s*\(1\s*EUR\s*=\s*[\d.,]+\s*[A-Z]{3}\)$/;

// Balance-block lines, glue-tolerant between label words.
const PREVIOUS_BALANCE_LINE = new RegExp(
  `^Vorig\\s*saldo\\s*op\\s*(\\d{2}-\\d{2}-\\d{4})\\s*(${AMOUNT})$`,
);
// The masked card number on the header line, and on the per-card
// sub-heading under the previous balance. Glue-tolerant like every other
// label here. Mask glyphs are part of the value: a card statement never
// prints a bare PAN.
//
// CORRECTED RATHER THAN QUIETLY REWRITTEN (R-087, fix round 3, finding
// HZ2-M3P3-02): this comment used to say the value is taken VERBATIM as
// the file's own-account identifier, and that is exactly what made one
// card into several. The capture below deliberately tolerates the
// separator being a space, a hyphen or nothing at all, and the mask glyph
// being upper or lower case, because extraction word spacing on this
// layout is tolerance-sensitive and the line reconstructor decides word
// gaps against a numeric threshold, so a hair of kerning between two
// statements of ONE card flips a separator in or out of the captured
// string. Taken verbatim, each of those printings was a different
// identity, therefore a different profile, a different account and a
// different dedup scope, and the same facts were stored twice. The value
// is now NORMALISED at the point of capture: identity is the digits and
// the mask POSITIONS, never the typography.
const CARD_NUMBER_LINE =
  /^Kaartnummer(?:\s*\(s\))?\s*:?\s*([0-9Xx*]{4}(?:[ -]?[0-9Xx*]{4}){3})$/;

// Typography out, identity in: separators dropped, mask glyphs folded to
// one form. A number printed with spaces, with hyphens, with neither, and
// with the mask written in lower case or as asterisks is one card and now
// one identity. No example is written out here: a card-shaped literal in a
// source comment is exactly the shape gate:privacy exists to stop, and the
// cases are enumerated in the test instead.
//
// HOW UNIQUE THIS IDENTITY IS, corrected rather than quietly rewritten
// (R-087, fix round 4, finding HZ3-M3P3-04). This sentence used to say two
// genuinely different numbers still differ, because only the separators
// and the glyph character are normalised away, never a digit and never a
// position. That is true of the NORMALISER and it is NOT true of the
// identity it produces. The identity is the MASKED form, and a masked form
// is not a card: two different cards that share their visible digits and
// their mask positions print the same one, and this template cannot tell
// them apart because the document never shows the rest. The consequence of
// such a collision is exactly the defect round 1 raised, two cards on one
// profile, one account and one dedup scope, and it is silent. It needs two
// cards of one household on one issuer product sharing their visible
// digits, which is roughly a one in ten thousand coincidence, and the
// normalisation barely moves that number since folding the glyph only
// merges cards whose statements print different glyph characters. So: the
// normaliser preserves every digit and every mask position, and the
// identity is as unique as the masked form is, which is not absolutely.
const normaliseCardIdentifier = (raw: string): string =>
  raw.replace(/[ -]/g, "").replace(/[x*]/g, "X");

const TOTAL_LINE =
  /^Totaal\s*bedrag\s*van\s*de\s*kaartverrichtingen\s*op\s*\d{2}-\d{2}-\d{4}$/;
const SETTLEMENT_TOTAL_LINE = new RegExp(
  `^Afrekening\\s*via\\s*je\\s*bank\\s*op\\s*(\\d{2}-\\d{2}-\\d{4})\\s*(${AMOUNT})$`,
);

const parseBelgianDate = (text: string): PlainDate | undefined => {
  const match = /^(\d{2})-(\d{2})-(\d{4})$/.exec(text);
  if (!match) {
    return undefined;
  }
  const iso = `${match[3]}-${match[2]}-${match[1]}`;
  return isValidPlainDate(iso) ? plainDate(iso) : undefined;
};

// The layout's amount text to cents: spaces (the layout's thousands
// separator and any sign spacing) are stripped, then the FROZEN comma
// style does the digits without a float anywhere.
const parseKbcAmount = (text: string): Result<Cents, { readonly kind: "unparseable-amount"; readonly text: string }> =>
  parseAmountToCents(text.replace(/ /g, ""), "comma");

type OpenRow = {
  readonly transactionDateText: string;
  readonly settlementDateText: string;
  readonly description: string;
  readonly amountText: string;
  readonly lines: string[];
};

const structureError = (
  problem: PdfTemplateError["problem"],
): Result<PdfTemplateOutcome, PdfTemplateError> =>
  err({ kind: "pdf-structure" as const, problem });

// Every distinct masked card number the document prints, in first-seen
// order. Read WITHOUT parsing anything else, because detection needs it
// before a parse has happened (pdf-template.ts, accountIdentifier).
const cardNumbersIn = (pages: readonly PdfPageLines[]): readonly string[] => {
  const seen: string[] = [];
  for (const page of pages) {
    for (const line of page) {
      const match = CARD_NUMBER_LINE.exec(line.text);
      const raw = match?.[1];
      if (raw === undefined) {
        continue;
      }
      const value = normaliseCardIdentifier(raw);
      if (!seen.includes(value)) {
        seen.push(value);
      }
    }
  }
  return seen;
};

// The file's own-account identity: exactly one masked card number after
// normalisation, or nothing. Two different numbers in one document is the
// multi-card uitgavenstaat nobody has seen (open question M3P3-Q2); it
// resolves to undefined here and the parse below turns that into a loud
// structure error rather than a guess about which card the rows belong
// to. Because the comparison is over NORMALISED values, the same card
// printed two ways on one document (the header line and the per-card
// sub-heading, which the real layout prints differently) is one number
// and not an ambiguous document.
const accountIdentifier = (
  pages: readonly PdfPageLines[],
): string | undefined => {
  const numbers = cardNumbersIn(pages);
  return numbers.length === 1 ? numbers[0] : undefined;
};

const parse = (
  pages: readonly PdfPageLines[],
): Result<PdfTemplateOutcome, PdfTemplateError> => {
  const openings: Cents[] = [];
  const closings: Cents[] = [];
  const completedRows: OpenRow[] = [];
  let open: OpenRow | null = null;
  const closeOpenRow = (): void => {
    if (open !== null) {
      completedRows.push(open);
      open = null;
    }
  };

  let badBalance = false;
  for (const page of pages) {
    for (const line of page) {
      const row = TRANSACTION_ROW.exec(line.text);
      if (
        row !== null &&
        row[1] !== undefined &&
        row[2] !== undefined &&
        row[3] !== undefined &&
        row[4] !== undefined
      ) {
        closeOpenRow();
        open = {
          transactionDateText: row[1],
          settlementDateText: row[2],
          description: row[3],
          amountText: row[4],
          lines: [line.text],
        };
        continue;
      }
      if (TWO_DATE_PREFIX.test(line.text)) {
        // A line that starts like a transaction row but does not parse
        // as one is a corrupted or foreign structure line; skipping it
        // silently is the zero-sum drop the balance gate cannot see.
        return structureError("unrecognized-line");
      }
      if (FX_AMOUNT_LINE.test(line.text) || FX_RATE_LINE.test(line.text)) {
        if (open === null) {
          // FX detail belongs to a preceding row; with no row open it
          // is orphaned structure, never silently dropped.
          return structureError("unrecognized-line");
        }
        open.lines.push(line.text);
        continue;
      }
      const previous = PREVIOUS_BALANCE_LINE.exec(line.text);
      if (previous !== null && previous[2] !== undefined) {
        closeOpenRow();
        const parsed = parseKbcAmount(previous[2]);
        if (!parsed.ok) {
          badBalance = true;
          continue;
        }
        openings.push(parsed.value);
        continue;
      }
      const settlementTotal = SETTLEMENT_TOTAL_LINE.exec(line.text);
      if (settlementTotal !== null && settlementTotal[2] !== undefined) {
        closeOpenRow();
        const parsed = parseKbcAmount(settlementTotal[2]);
        if (!parsed.ok) {
          badBalance = true;
          continue;
        }
        closings.push(parsed.value);
        continue;
      }
      if (TOTAL_LINE.test(line.text)) {
        // A balance-block line that deliberately carries NO amount
        // (scout fact 5): recognised so it can never be misread as
        // anything else, contributes nothing.
        closeOpenRow();
        continue;
      }
      // Everything else on this layout is bank boilerplate: the header
      // block (fingerprint, references, limit, masked card, period and
      // column-header lines), the per-card sub-heading and holder lines
      // under the previous balance, and the marketing footer. None of it
      // is row data, and none of it can close over a row's FX lines
      // because continuations directly follow their row.
    }
  }
  closeOpenRow();

  if (badBalance || openings.length === 0 || closings.length === 0) {
    return structureError("no-balance-lines");
  }
  // HZ-M3P3-07: repeats of the SAME value (a header block reprinted on a
  // later page) are folded; two DIFFERENT values are ambiguous and loud.
  const opening = openings[0];
  const closing = closings[0];
  if (opening === undefined || closing === undefined) {
    return structureError("no-balance-lines");
  }
  if (
    openings.some((value) => value !== opening) ||
    closings.some((value) => value !== closing)
  ) {
    return structureError("ambiguous-balance-lines");
  }

  // HZ-M3P3-02: identity is the masked card number, and a card file that
  // does not carry exactly one is never bound to an account by guesswork.
  const identifier = accountIdentifier(pages);
  if (identifier === undefined) {
    return structureError("no-account-identifier");
  }

  const rows: ParsedRow[] = [];
  for (const completed of completedRows) {
    const bookingDate = parseBelgianDate(completed.transactionDateText);
    const settlementDate = parseBelgianDate(completed.settlementDateText);
    if (bookingDate === undefined || settlementDate === undefined) {
      return structureError("transaction-date");
    }
    const amount = parseKbcAmount(completed.amountText);
    if (!amount.ok) {
      return structureError("transaction-amount");
    }
    rows.push({
      // PR2-004: the TRANSACTION date, never the settlement date.
      bookingDate,
      // Datum verrekening has value-date semantics: the day the money
      // settled, kept alongside its verbatim form in rawLine.
      valueDate: settlementDate,
      amountCents: amount.value,
      description: completed.description,
      // The row line verbatim plus its folded FX continuation lines:
      // what a profile-fix re-parse would rebuild this row from.
      rawLine: completed.lines.join("\n"),
    });
  }

  return ok({
    rows,
    // No IBAN exists anywhere in this format. Identity is the masked card
    // number, carried in the profile spec (accountIdentifier above), not
    // here: accountIbans feeds the account-by-IBAN lookup and the
    // mixed-account refusal, and a masked card number is neither.
    accountIbans: [],
    openingBalanceCents: opening,
    closingBalanceCents: closing,
    // The Afrekening magnitude: what the bank collects for this
    // statement. Negative closing means money owed, which is the ordinary
    // case; a card standing in credit yields a non-positive settlement
    // total.
    // CORRECTED RATHER THAN QUIETLY REWRITTEN (R-087, fix round 3,
    // finding HZ2-M3P3-05): this comment used to credit the positive-total
    // guard in settlementCandidateImports for making that case safe, and
    // that guard is REDUNDANT, measured by deleting it and watching the
    // whole fast gate stay green. What actually makes a non-positive
    // figure safe is the equality one line above it: the figure is
    // compared against the MAGNITUDE of a debit, which is strictly
    // positive, so a non-positive figure equals no candidate and the
    // statement is honestly reported as settling nothing. The guard is
    // kept as a cheap statement of intent; the equality is the mechanism.
    settlementTotalCents: (-closing) as Cents,
  });
};

export const kbcMastercardTemplate: PdfLayoutTemplate = {
  id: "kbc-mastercard-uitgavenstaat",
  // VERSION 2 (fix round 3, finding CR2-M3P3-01). Fix round 2 changed what
  // this template RETURNS (a settlement total, and a spec-borne account
  // identifier) and what it ACCEPTS (a document carrying no card number,
  // or two different ones, is now a loud structure error where it used to
  // parse), and fix round 3 changed the identifier's normalisation, all
  // while the registered version stayed 1. parse-pdf-statement.ts states
  // that a declared templateVersion must equal the registered one or the
  // parse fails closed, and that a version bump is a migration rather than
  // a silent reinterpretation of stored bytes; that is the mechanism this
  // codebase names for exactly this change and it could not fire while the
  // number stood still. The bump is FREE here, measured rather than
  // assumed: this template does not exist on main, so no stored
  // declaration anywhere names version 1 of it outside this branch.
  version: 2,
  // No sequence numbers exist in this format: the dedup key is the HASH
  // path with the occurrence ordinal, never a natural key (addendum:86).
  hasNaturalKey: false,
  matches: (pages) =>
    pages.some((page) =>
      page.some((line) => line.text.includes(FINGERPRINT_CARD)),
    ) &&
    pages.some((page) =>
      page.some((line) => line.text.includes(FINGERPRINT_DOCUMENT)),
    ),
  accountIdentifier,
  parse,
};
