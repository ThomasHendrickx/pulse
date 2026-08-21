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
// - A transaction starts with a 4-digit sequence, a DD-MM-YYYY booking
//   date, "(VAL. DD-MM-YYYY)" and sign plus amount at line end. Sign
//   spacing and thousands-dot presence vary INDEPENDENTLY (the strict
//   correlation the addendum implies does not hold on the real file), so
//   every combination is accepted. Following lines up to the next
//   transaction start, balance line or page end are the description; the
//   whole block is kept verbatim (line-joined) as rawLine.
// - D-4 natural key: rows emit the BOOKING YEAR as the statement-scope
//   key component (statementNumber) and the 4-digit sequence as
//   sequenceNumber, so the existing dedup mechanism produces the
//   addendum's account + year + sequence key and a re-exported or
//   overlapping statement maps shared rows onto their existing keys.
//   Cross-statement sequence continuity remains an owner-asserted
//   assumption; the year-scoped key does not depend on it for dedup
//   correctness (criterion 2.3's overlap witness).

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
const BAND_LINE =
  /^-{2,}\s*([A-Z]{2}\d{2}(?:\s\d{4}){3})(?:\s+BIC:\s*[A-Z0-9]+)?\s*-{2,}$/;
const BALANCE_LINE =
  /^SALDO OP (\d{2}-\d{2}-\d{4})(?:\s+\d{2}:\d{2})?\s+EUR\s*([+-]\s?(?:\d{1,3}(?:\.\d{3})+|\d+),\d{2})$/;
const TRANSACTION_START =
  /^(\d{4})\s(\d{2}-\d{2}-\d{4})\s\(VAL\.\s(\d{2}-\d{2}-\d{4})\)\s+([+-]\s?(?:\d{1,3}(?:\.\d{3})+|\d+),\d{2})$/;
// IBANs inside descriptions appear spaced in groups of four or compact;
// Belgian IBANs are two letters, two digits, twelve digits.
const DESCRIPTION_IBAN = /\b([A-Z]{2}\d{2}(?:\s?\d{4}){3})\b/g;

const compactIban = (text: string): string => text.replace(/\s/g, "");

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
    const markerIndex = page.findIndex((line) => PAGE_MARKER.test(line));
    if (markerIndex === -1) {
      return structureError("page-marker");
    }
    const body = page.slice(markerIndex + 1);
    // Annex pages contribute NOTHING: body-starts-with, never
    // marker-anywhere (finding PR2-002, see the header comment).
    if (body[0]?.startsWith(ANNEX_MARKER) === true) {
      continue;
    }

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
      const band = BAND_LINE.exec(line);
      if (band !== null && band[1] !== undefined) {
        closeOpenBlock();
        const iban = compactIban(band[1]);
        if (!accountIbans.includes(iban)) {
          accountIbans.push(iban);
        }
        continue;
      }
      const balance = BALANCE_LINE.exec(line);
      if (balance !== null && balance[2] !== undefined) {
        closeOpenBlock();
        const parsed = parseAmountToCents(balance[2], "comma");
        if (!parsed.ok) {
          return structureError("no-balance-lines");
        }
        balances.push(parsed.value);
        continue;
      }
      const start = TRANSACTION_START.exec(line);
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
            startLine: line,
          },
          descriptionLines: [],
        };
        continue;
      }
      if (open !== null) {
        open.descriptionLines.push(line);
      }
      // Lines outside any block (the guarantee footer after the closing
      // balance, page furniture) carry no transaction data: ignored.
    }
    closeOpenBlock();
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
    pages.some((page) => page.some((line) => line.includes(FINGERPRINT_HEADER))) &&
    pages.some((page) => page.some((line) => line.startsWith(BALANCE_PREFIX))),
  parse,
};
