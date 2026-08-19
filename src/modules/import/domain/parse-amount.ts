// Amount text to integer cents, without a float anywhere on the path
// (CLAUDE.md non-negotiable 3). The digits are taken apart as strings and
// assembled with integer arithmetic only; parseFloat never appears, so a
// value like 30941.50 can never pick up representation error on its way to
// the ledger.

import { cents, type Cents } from "@/platform/money";
import { err, ok, type Result } from "@/platform/result";
import type { DecimalStyle } from "./source-profile";

export type AmountParseError = {
  readonly kind: "unparseable-amount";
  readonly text: string;
};

// Accepted shapes per style, sign and currency noise aside:
//   comma: 1.234,56  1234,56  1234  (dot thousands, comma decimals)
//   dot:   1234.56   1234     (no thousands separator, dot decimals)
const COMMA_STYLE = /^(\d{1,3}(?:\.\d{3})*|\d+)(?:,(\d{1,2}))?$/;
const DOT_STYLE = /^(\d+)(?:\.(\d{1,2}))?$/;

// The one normalisation both entry points share: currency noise (EUR, the
// euro sign) is stripped BEFORE anything reads a sign, so a guard and the
// parser can never judge different strings (finding CR-307).
const stripCurrencyNoise = (rawText: string): string =>
  rawText.trim().replace(/(?:EUR|€)/gi, "").trim();

export const parseAmountToCents = (
  rawText: string,
  style: DecimalStyle,
): Result<Cents, AmountParseError> => {
  let text = stripCurrencyNoise(rawText);

  let sign = 1;
  if (text.startsWith("-")) {
    sign = -1;
    text = text.slice(1).trim();
  } else if (text.startsWith("+")) {
    text = text.slice(1).trim();
  }

  const match =
    style === "comma" ? COMMA_STYLE.exec(text) : DOT_STYLE.exec(text);
  if (!match || match[1] === undefined) {
    return err({ kind: "unparseable-amount" as const, text: rawText });
  }

  const wholeDigits =
    style === "comma" ? match[1].replace(/\./g, "") : match[1];
  const fractionDigits = (match[2] ?? "").padEnd(2, "0");

  const value = Number(wholeDigits) * 100 + Number(fractionDigits);
  if (!Number.isSafeInteger(value)) {
    return err({ kind: "unparseable-amount" as const, text: rawText });
  }
  return ok(cents(sign * value));
};

// Does this cell LOOK like an amount under the style? Used by detection,
// which needs a cheap probe before it commits to column roles.
export const isAmountLike = (text: string, style: DecimalStyle): boolean =>
  parseAmountToCents(text, style).ok;

// UNSIGNED entry point for DIRECTIONAL cells (findings CR-208, CR-305,
// CR-307): under a debit column, a credit column or an indicator marker,
// the column or marker is the sign authority and the cell must be a bare
// magnitude. Fix round 1 guarded the RAW cell's first character, and fix
// round 2's finding CR-307 showed that guard and the parser judged
// DIFFERENT strings: "EUR -742,10" starts with "E", passed the guard, and
// parsed signed after the currency strip, storing the exact CR-208
// inversion one normalisation step deeper. This entry point rejects any
// sign remaining AFTER the same normalisation the parser applies, so the
// two can never diverge again. A sign is never guessed and never
// silently discarded: the row fails, the import fails loudly, zero rows.
export const parseUnsignedAmountToCents = (
  rawText: string,
  style: DecimalStyle,
): Result<Cents, AmountParseError> => {
  const text = stripCurrencyNoise(rawText);
  if (text.startsWith("-") || text.startsWith("+")) {
    return err({ kind: "unparseable-amount" as const, text: rawText });
  }
  return parseAmountToCents(text, style);
};
