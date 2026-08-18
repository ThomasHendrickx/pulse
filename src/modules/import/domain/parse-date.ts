// Business date parsing per profile date format. Output is the branded
// PlainDate string, never a Date: no timezone can touch a booking date on
// this path (pulse-typescript section 2).

import { isValidPlainDate, plainDate, type PlainDate } from "@/platform/plain-date";
import { err, ok, type Result } from "@/platform/result";
import type { DateFormat } from "./source-profile";

export type DateParseError = {
  readonly kind: "unparseable-date";
  readonly text: string;
  readonly format: DateFormat;
};

const PATTERNS: Record<DateFormat, RegExp> = {
  "DD/MM/YYYY": /^(\d{2})\/(\d{2})\/(\d{4})$/,
  "YYYY-MM-DD": /^(\d{4})-(\d{2})-(\d{2})$/,
  "DD.MM.YY": /^(\d{2})\.(\d{2})\.(\d{2})$/,
};

export const parseBusinessDate = (
  rawText: string,
  format: DateFormat,
): Result<PlainDate, DateParseError> => {
  const text = rawText.trim();
  const match = PATTERNS[format].exec(text);
  if (!match) {
    return err({ kind: "unparseable-date" as const, text: rawText, format });
  }

  let isoCandidate: string;
  if (format === "YYYY-MM-DD") {
    isoCandidate = text;
  } else if (format === "DD/MM/YYYY") {
    isoCandidate = `${match[3]}-${match[2]}-${match[1]}`;
  } else {
    // DD.MM.YY: bank exports carry current-era dates; the century is 2000.
    isoCandidate = `20${match[3]}-${match[2]}-${match[1]}`;
  }

  if (!isValidPlainDate(isoCandidate)) {
    return err({ kind: "unparseable-date" as const, text: rawText, format });
  }
  return ok(plainDate(isoCandidate));
};

export const isDateLike = (text: string, format: DateFormat): boolean =>
  parseBusinessDate(text, format).ok;
