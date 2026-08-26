// Layout template A: the Belfius current-account statement (NL), per the
// v0.2 addendum section 3 and the structure verified against the real
// statement's text layer (M3-P2 verification-first notes). Pure functions
// over reconstructed lines; no writes, no I/O, no library text assembly.
//
// Structure this template relies on, all verified on the real file:
// - Every page repeats a header block that ends with a page-marker line:
//   "BLZ. : N/P" on the first page, "DD-MM-YYYY N/P" on later pages. The
//   page BODY is everything after that marker.
// - A body that STARTS with the annex marker ("BIJLAGE BIJ VERRICHTING")
//   is an annex page (interest detail) and contributes zero rows. The
//   check is BODY-STARTS-WITH on purpose (finding PR2-002): the bare
//   marker phrase also occurs INSIDE transaction descriptions on
//   transaction pages, so marker-anywhere skipping would drop real rows.
// - Account identity is the IBAN in the band line between dashes, NEVER
//   the header's "IBAN: .." line, which carries the BANK'S OWN account.
// - Opening and closing balances are the first and last "SALDO OP" lines;
//   the closing line carries an HH:MM time after its date.
// - A transaction starts AT THE MARGIN with a 4-digit sequence, a
//   DD-MM-YYYY booking date, "(VAL. DD-MM-YYYY)" and sign plus amount at
//   line end. Sign spacing and thousands-dot presence vary INDEPENDENTLY
//   (the strict correlation the addendum implies does not hold on the
//   real file), so every combination is accepted. Following INDENTED
//   lines up to the next margin-level structure line or page end are the
//   description; the whole block is kept verbatim (line-joined) as
//   rawLine.
// - LINE CLASSIFICATION IS POSITIONAL, NOT SHAPE-ONLY (fix round 1,
//   finding HZ-001): on the real layout every structural line (band,
//   balance, transaction start) sits at the left margin and every
//   description line is indented by about 12 units. Description text is
//   counterparty-controlled, so an INDENTED line in the exact
//   transaction-start or balance shape is DESCRIPTION DATA, kept
//   verbatim, never a fabricated row and never a block terminator (the
//   review's constructions 1 and 4). A margin-level line inside an open
//   block that matches no known structure is a STRUCTURE ERROR, never
//   silently skipped (constructions 2 and 3, the corrupted-start drops).
// - SEQUENCE CONTINUITY IS A GATE (fix round 1, finding HZ-001): the
//   fleet's format facts record consecutive sequence numbers on the real
//   statement, so within one file the parsed sequences must be strictly
//   consecutive; any gap or duplicate is a structure error with zero
//   rows. This is the second net under the balance contract: it catches
//   zero-sum drops and fabrications the sum comparison is blind to.
//   RESIDUE, stated rather than hidden: a corrupted start line of the
//   VERY FIRST transaction (before any block is open) still drops that
//   row silently when its amount is zero, because continuity has no
//   lower anchor and a zero drop keeps the sum; the balance gate covers
//   every nonzero variant of that corner.
// - D-4 natural key: rows emit the BOOKING YEAR as the statement-scope
//   key component (statementNumber) and the 4-digit sequence as
//   sequenceNumber, so the existing dedup mechanism produces the
//   addendum's account + year + sequence key and a re-exported or
//   overlapping statement maps shared rows onto their existing keys.
//   Cross-statement sequence continuity remains an owner-asserted
//   assumption; the year-scoped key does not depend on it for dedup
//   correctness (criterion 2.3's overlap witness).

import { canonicalAccountNumber } from "@/platform/account-number";
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

const FINGERPRINT_HEADER = "Belfius Bank NV";
const BALANCE_PREFIX = "SALDO OP ";
export const ANNEX_MARKER = "BIJLAGE BIJ VERRICHTING";

const PAGE_MARKER = /^(?:BLZ\.\s*:\s*\d+\/\d+|\d{2}-\d{2}-\d{4}\s+\d+\/\d+)$/;

// A description line is indented by about 12 units relative to the
// margin on the real layout; anything at least this far right of the
// page body's leftmost line is INDENTED (description-only, never
// structure).
const INDENT_THRESHOLD = 6.0;
const BAND_LINE =
  /^-{2,}\s*([A-Z]{2}\d{2}(?:\s\d{4}){3})(?:\s+BIC:\s*[A-Z0-9]+)?\s*-{2,}$/;
const BALANCE_LINE =
  /^SALDO OP (\d{2}-\d{2}-\d{4})(?:\s+\d{2}:\d{2})?\s+EUR\s*([+-]\s?(?:\d{1,3}(?:\.\d{3})+|\d+),\d{2})$/;
const TRANSACTION_START =
  /^(\d{4})\s(\d{2}-\d{2}-\d{4})\s\(VAL\.\s(\d{2}-\d{2}-\d{4})\)\s+([+-]\s?(?:\d{1,3}(?:\.\d{3})+|\d+),\d{2})$/;
// IBANs inside descriptions appear spaced in groups of four or compact;
// Belgian IBANs are two letters, two digits, twelve digits.
const DESCRIPTION_IBAN = /\b([A-Z]{2}\d{2}(?:\s?\d{4}){3})\b/g;

// THE PLATFORM CANONICAL FORM, not a local one (M3-P14, criterion 14.4).
// This helper used to be a private whitespace-removal written out by hand
// here, and it was NAMED by that criterion as the second such derivation in
// the tree.
// It is replaced rather than kept as an exception: the platform form adds
// an uppercase that this call site cannot observe (DESCRIPTION_IBAN and
// BAND_LINE both match uppercase letters only), so the two agree on every
// input this template can produce, and one form is one form.
const compactIban = canonicalAccountNumber;

const parseBelgianDate = (text: string): PlainDate | undefined => {
  const match = /^(\d{2})-(\d{2})-(\d{4})$/.exec(text);
  if (!match) {
    return undefined;
  }
  const iso = `${match[3]}-${match[2]}-${match[1]}`;
  return isValidPlainDate(iso) ? plainDate(iso) : undefined;
};

type TransactionBlock = {
  readonly sequence: string;
  readonly bookingDateText: string;
  readonly valueDateText: string;
  readonly amountText: string;
  readonly startLine: string;
  readonly descriptionLines: readonly string[];
};

const structureError = (
  problem: PdfTemplateError["problem"],
): Result<PdfTemplateOutcome, PdfTemplateError> =>
  err({ kind: "pdf-structure" as const, problem });

const parse = (
  pages: readonly PdfPageLines[],
): Result<PdfTemplateOutcome, PdfTemplateError> => {
  const accountIbans: string[] = [];
  const balances: Cents[] = [];
  const blocks: TransactionBlock[] = [];

  for (const page of pages) {
    const markerIndex = page.findIndex((line) => PAGE_MARKER.test(line.text));
    if (markerIndex === -1) {
      return structureError("page-marker");
    }
    const body = page.slice(markerIndex + 1);
    // Annex pages contribute NOTHING: body-starts-with, never
    // marker-anywhere (finding PR2-002, see the header comment).
    if (body[0]?.text.startsWith(ANNEX_MARKER) === true) {
      continue;
    }

    // The margin is the page body's leftmost line; indented lines sit at
    // least INDENT_THRESHOLD to its right (HZ-001: positional
    // classification, see the header comment).
    const marginX = body.reduce(
      (min, line) => Math.min(min, line.x),
      Number.POSITIVE_INFINITY,
    );
    const isIndented = (line: { readonly x: number }): boolean =>
      line.x >= marginX + INDENT_THRESHOLD;

    let open: {
      block: Omit<TransactionBlock, "descriptionLines">;
      descriptionLines: string[];
    } | null = null;
    const closeOpenBlock = (): void => {
      if (open !== null) {
        blocks.push({ ...open.block, descriptionLines: open.descriptionLines });
        open = null;
      }
    };

    for (const line of body) {
      if (isIndented(line)) {
        // Indented lines are DATA, whatever their shape: description
        // text inside an open block (kept verbatim, even in the exact
        // transaction-start or balance shape), page furniture outside
        // one (the first page's product and holder block).
        if (open !== null) {
          open.descriptionLines.push(line.text);
        }
        continue;
      }
      const band = BAND_LINE.exec(line.text);
      if (band !== null && band[1] !== undefined) {
        closeOpenBlock();
        const iban = compactIban(band[1]);
        if (!accountIbans.includes(iban)) {
          accountIbans.push(iban);
        }
        continue;
      }
      const balance = BALANCE_LINE.exec(line.text);
      if (balance !== null && balance[2] !== undefined) {
        closeOpenBlock();
        const parsed = parseAmountToCents(balance[2], "comma");
        if (!parsed.ok) {
          return structureError("no-balance-lines");
        }
        balances.push(parsed.value);
        continue;
      }
      const start = TRANSACTION_START.exec(line.text);
      if (
        start !== null &&
        start[1] !== undefined &&
        start[2] !== undefined &&
        start[3] !== undefined &&
        start[4] !== undefined
      ) {
        closeOpenBlock();
        open = {
          block: {
            sequence: start[1],
            bookingDateText: start[2],
            valueDateText: start[3],
            amountText: start[4],
            startLine: line.text,
          },
          descriptionLines: [],
        };
        continue;
      }
      if (open !== null) {
        // A margin-level line inside an open block that matches no known
        // structure is a corrupted or foreign structure line; skipping
        // it silently is exactly the zero-sum drop HZ-001 demonstrated.
        return structureError("unrecognized-line");
      }
      // Margin-level lines outside any block (the first page's holder
      // block above the band line, the guarantee footer after the
      // closing balance) carry no transaction data: ignored.
    }
    closeOpenBlock();
  }

  // SEQUENCE CONTINUITY (HZ-001): within one file the sequence numbers
  // are strictly consecutive on the real layout; any gap or duplicate
  // means a dropped, fabricated or corrupted line and fails the parse
  // with zero rows, including the zero-sum cases the balance gate is
  // blind to.
  for (let index = 1; index < blocks.length; index += 1) {
    const previous = blocks[index - 1];
    const current = blocks[index];
    if (previous === undefined || current === undefined) {
      return structureError("sequence-order");
    }
    if (Number(current.sequence) !== Number(previous.sequence) + 1) {
      return structureError("sequence-order");
    }
  }

  const primaryIban = accountIbans[0];
  if (primaryIban === undefined) {
    return structureError("no-account-iban");
  }
  if (balances.length < 2) {
    return structureError("no-balance-lines");
  }
  const opening = balances[0];
  const closing = balances[balances.length - 1];
  if (opening === undefined || closing === undefined) {
    return structureError("no-balance-lines");
  }

  const ownAccounts = new Set(accountIbans);
  const rows: ParsedRow[] = [];
  for (const block of blocks) {
    const bookingDate = parseBelgianDate(block.bookingDateText);
    const valueDate = parseBelgianDate(block.valueDateText);
    if (bookingDate === undefined || valueDate === undefined) {
      return structureError("transaction-date");
    }
    const amount = parseAmountToCents(block.amountText, "comma");
    if (!amount.ok) {
      return structureError("transaction-amount");
    }
    const description = block.descriptionLines.join(" ");
    // First IBAN in the description that is not the account's own: the
    // counterparty where the movement names one (deposits, transfers);
    // card payments and fees have none. IBANs may wrap across description
    // lines at group boundaries, which the line join above restores.
    let counterpartyIban: string | undefined;
    for (const match of description.matchAll(DESCRIPTION_IBAN)) {
      const candidate = match[1] === undefined ? undefined : compactIban(match[1]);
      if (candidate !== undefined && !ownAccounts.has(candidate)) {
        counterpartyIban = candidate;
        break;
      }
    }
    rows.push({
      bookingDate,
      valueDate,
      amountCents: amount.value,
      description,
      // The whole block verbatim, newline-joined in page order: what a
      // profile-fix re-parse would rebuild this row from.
      rawLine: [block.startLine, ...block.descriptionLines].join("\n"),
      ...(counterpartyIban === undefined ? {} : { counterpartyIban }),
      // D-4: booking YEAR as the statement-scope key component.
      statementNumber: bookingDate.slice(0, 4),
      sequenceNumber: block.sequence,
      accountIban: primaryIban,
    });
  }

  return ok({
    rows,
    accountIbans,
    openingBalanceCents: opening,
    closingBalanceCents: closing,
  });
};

export const belfiusCurrentAccountTemplate: PdfLayoutTemplate = {
  id: "belfius-current-account-nl",
  version: 1,
  hasNaturalKey: true,
  // Fingerprint per the addendum: the institution header text plus a
  // SALDO OP line (pulse-v0.2-pdf-addendum.md:50).
  matches: (pages) =>
    pages.some((page) =>
      page.some((line) => line.text.includes(FINGERPRINT_HEADER)),
    ) &&
    pages.some((page) =>
      page.some((line) => line.text.startsWith(BALANCE_PREFIX)),
    ),
  parse,
};
