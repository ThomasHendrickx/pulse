// Dedup keys, one per parsed row (finding PR-001; owner v0.2 addendum
// section 5, which binds v0.1).
//
// Per-profile key choice (verification-first evidence in
// notes/export-format-facts.md): the statement-plus-sequence natural key
// HOLDS for the Belfius current-account format and FAILS for the KBC card
// format, which has no per-row sequence. So: natural key where the profile
// carries both columns, content hash otherwise.
//
// The hash path carries an OCCURRENCE ORDINAL among identical-content rows
// within the same file. Two legitimate identical rows (same day, same
// amount, same merchant, observed twice in a real card statement) get
// distinct keys, while re-uploading the same file maps each row to the
// same key and adds nothing. Across imports, insert-ignore over
// ordinal-suffixed keys keeps, per identical tuple, the highest occurrence
// count seen, which is exactly the addendum's cross-import rule.
//
// STABILITY CONTRACT: every input to the hash, including the local
// normalisation below, is FROZEN. Changing any of it changes every stored
// key and turns the next re-upload into a full duplicate import. The
// merchants module's richer normalisation (M1-P4) is a different function
// for a different purpose and must never be substituted here.

import { createHash } from "node:crypto";
import { hasNaturalKey, type SourceProfileSpec } from "./source-profile";
import type { ParsedRow } from "./parse-statement";

// Minimal, frozen normalisation for hashing only: uppercase, collapse
// whitespace, trim. See the stability contract above.
export const normalizeCounterpartyForKey = (value: string): string =>
  value.toUpperCase().replace(/\s+/g, " ").trim();

const contentTuple = (accountId: string, row: ParsedRow): string =>
  [
    accountId,
    row.bookingDate,
    String(row.amountCents),
    normalizeCounterpartyForKey(row.counterpartyName ?? row.description),
    row.reference ?? "",
  ].join("|");

export const assignDedupKeys = (
  accountId: string,
  rows: readonly ParsedRow[],
  spec: SourceProfileSpec,
): readonly string[] => {
  if (hasNaturalKey(spec)) {
    return rows.map((row, index) => {
      // The profile declares both columns, but a single row may still miss
      // a value; such a row falls back to the hash path with an ordinal of
      // its position among equally-keyless identical rows.
      if (row.statementNumber !== undefined && row.sequenceNumber !== undefined) {
        return `nat:${accountId}:${row.statementNumber}:${row.sequenceNumber}`;
      }
      return hashKey(accountId, rows, row, index);
    });
  }
  return rows.map((row, index) => hashKey(accountId, rows, row, index));
};

const hashKey = (
  accountId: string,
  rows: readonly ParsedRow[],
  row: ParsedRow,
  index: number,
): string => {
  const tuple = contentTuple(accountId, row);
  let ordinal = 0;
  for (let i = 0; i < index; i += 1) {
    const earlier = rows[i];
    if (earlier !== undefined && contentTuple(accountId, earlier) === tuple) {
      ordinal += 1;
    }
  }
  const digest = createHash("sha256").update(tuple).digest("hex");
  return `h:${digest}#${ordinal}`;
};
