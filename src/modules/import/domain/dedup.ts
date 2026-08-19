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

// The tuple is JSON-encoded (finding F6): a plain join lets a field value
// carrying the delimiter shift the boundaries so two distinct
// transactions collide onto one key. JSON escaping makes the encoding
// injective over the five fields. Fixed in the once-only window before
// any production transaction existed; the encoding is part of the frozen
// recipe from here on.
const contentTuple = (accountId: string, row: ParsedRow): string =>
  JSON.stringify([
    accountId,
    row.bookingDate,
    String(row.amountCents),
    normalizeCounterpartyForKey(row.counterpartyName ?? row.description),
    row.reference ?? "",
  ]);

// Pair rows with their assigned keys positionally. A length mismatch or
// an empty key is a BUG (a desync between assignDedupKeys and its caller)
// and throws rather than softening (finding F7): an empty dedup key would
// collapse every affected row onto one stored row under duplicate
// skipping, which is silent multi-row loss, the worst failure this module
// has. Unexpected failures are exceptions (pulse-typescript section 5).
export const zipRowsWithDedupKeys = <R>(
  rows: readonly R[],
  keys: readonly string[],
): readonly (R & { readonly dedupKey: string })[] => {
  if (rows.length !== keys.length) {
    throw new Error(
      `Dedup key desync: ${rows.length} rows but ${keys.length} keys`,
    );
  }
  return rows.map((row, index) => {
    const dedupKey = keys[index];
    if (dedupKey === undefined || dedupKey === "") {
      throw new Error(`Dedup key desync: empty key at row ${index}`);
    }
    return { ...row, dedupKey };
  });
};

// The ordinal counts occurrences among HASH-PATH identical-content rows
// ONLY (finding F5, owner v0.2 addendum section 5). Counting natural-keyed
// twins as well would make a keyless row's key depend on which siblings
// its file happens to carry, so an overlapping re-export would store the
// same fact twice (ordinal 1 in one file, ordinal 0 in the other). An
// earlier version of this file counted every identical-content row while
// its comment claimed the hash-path-only rule; the code was wrong and the
// comment right, corrected here rather than silently (R-087).
export const assignDedupKeys = (
  accountId: string,
  rows: readonly ParsedRow[],
  spec: SourceProfileSpec,
): readonly string[] => {
  const natural = hasNaturalKey(spec);
  const hashPathOrdinals = new Map<string, number>();
  return rows.map((row) => {
    // The profile may declare both columns while a single row still
    // misses a value; such a row falls back to the hash path.
    if (
      natural &&
      row.statementNumber !== undefined &&
      row.sequenceNumber !== undefined
    ) {
      return `nat:${accountId}:${row.statementNumber}:${row.sequenceNumber}`;
    }
    const tuple = contentTuple(accountId, row);
    const ordinal = hashPathOrdinals.get(tuple) ?? 0;
    hashPathOrdinals.set(tuple, ordinal + 1);
    const digest = createHash("sha256").update(tuple).digest("hex");
    return `h:${digest}#${ordinal}`;
  });
};
