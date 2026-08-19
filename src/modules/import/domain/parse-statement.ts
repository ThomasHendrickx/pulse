// The one generic delimited-file parser. No per-bank parsers exist or may
// be added (pulse-domain section 5); everything format-specific lives in
// the SourceProfileSpec that drives this function. Parsing is pure and
// in-memory: no writes happen here.

import type { Cents } from "@/platform/money";
import type { PlainDate } from "@/platform/plain-date";
import { err, ok, type Result } from "@/platform/result";
import {
  decodeStatementBytes,
  splitDelimitedLine,
  splitLines,
} from "./delimited-text";
import { parseAmountToCents } from "./parse-amount";
import { parseBusinessDate } from "./parse-date";
import type { SourceProfileSpec } from "./source-profile";

// One parsed row, exactly as it will be stored (facts layer). rawLine is
// the verbatim source line; it is what a later profile fix re-parses from.
export type ParsedRow = {
  readonly bookingDate: PlainDate;
  readonly amountCents: Cents;
  readonly description: string;
  readonly rawLine: string;
  readonly valueDate?: PlainDate;
  readonly counterpartyName?: string;
  readonly counterpartyIban?: string;
  readonly accountIban?: string;
  readonly reference?: string;
  readonly statementNumber?: string;
  readonly sequenceNumber?: string;
};

export type ParsedStatement = {
  readonly rows: readonly ParsedRow[];
  // Distinct own-account identifiers seen in the file, in first-seen
  // order. More than one entry means a mixed-account file, which the
  // ingest use case fails loudly (hazard H1.2); resolving which account a
  // file belongs to is the use case's job, not the parser's.
  readonly accountIbans: readonly string[];
};

export type StatementParseError =
  | { readonly kind: "empty-file" }
  | {
      readonly kind: "row-error";
      readonly lineNumber: number;
      readonly rawLine: string;
      readonly problem: "date" | "amount" | "missing-column" | "indicator";
    };

const cellAt = (fields: readonly string[], index: number): string =>
  (fields[index] ?? "").trim();

// One data line, parsed exactly as it will be stored. Used by the full
// statement parse below AND by the profile-fix re-parse, which rebuilds an
// import's fact rows from each stored rawLine (pulse-domain section 2, the
// explicit SourceProfile exception): the two paths MUST parse a line
// identically, which is why this is one function and not two.
export const parseStatementRow = (
  line: string,
  spec: SourceProfileSpec,
): Result<ParsedRow, "date" | "amount" | "missing-column" | "indicator"> => {
  const fields = splitDelimitedLine(line, spec.delimiter);

  const bookingDateResult = parseBusinessDate(
    cellAt(fields, spec.columns.bookingDate),
    spec.dateFormat,
  );
  if (!bookingDateResult.ok) {
    return err("date" as const);
  }

  const amountResult = amountOf(fields, spec);
  if (!amountResult.ok) {
    return err(amountResult.error);
  }

  const row: {
    bookingDate: PlainDate;
    amountCents: Cents;
    description: string;
    rawLine: string;
    valueDate?: PlainDate;
    counterpartyName?: string;
    counterpartyIban?: string;
    accountIban?: string;
    reference?: string;
    statementNumber?: string;
    sequenceNumber?: string;
  } = {
    bookingDate: bookingDateResult.value,
    amountCents: amountResult.value,
    description: cellAt(fields, spec.columns.description),
    rawLine: line,
  };

  if (spec.columns.valueDate !== undefined) {
    const valueDateResult = parseBusinessDate(
      cellAt(fields, spec.columns.valueDate),
      spec.dateFormat,
    );
    if (valueDateResult.ok) {
      row.valueDate = valueDateResult.value;
    }
  }
  const optionalText = (
    role: "counterpartyName" | "counterpartyIban" | "accountIban" | "reference" | "statementNumber" | "sequenceNumber",
  ): void => {
    const column = spec.columns[role];
    if (column !== undefined) {
      const value = cellAt(fields, column);
      if (value !== "") {
        row[role] = value;
      }
    }
  };
  optionalText("counterpartyName");
  optionalText("counterpartyIban");
  optionalText("accountIban");
  optionalText("reference");
  optionalText("statementNumber");
  optionalText("sequenceNumber");

  return ok(row);
};

export const parseStatement = (
  bytes: Uint8Array,
  spec: SourceProfileSpec,
): Result<ParsedStatement, StatementParseError> => {
  const lines = splitLines(decodeStatementBytes(bytes, spec.encoding));
  const dataLines = lines
    .map((line, index) => ({ line, index }))
    .filter(({ index }) => index > spec.headerRowIndex)
    .filter(({ line }) => line.trim() !== "");

  if (dataLines.length === 0) {
    return err({ kind: "empty-file" as const });
  }

  const rows: ParsedRow[] = [];
  const accountIbans: string[] = [];

  for (const { line, index } of dataLines) {
    const lineNumber = index + 1;
    const rowResult = parseStatementRow(line, spec);
    if (!rowResult.ok) {
      return err({
        kind: "row-error" as const,
        lineNumber,
        rawLine: line,
        problem: rowResult.error,
      });
    }
    const row = rowResult.value;

    if (row.accountIban !== undefined && !accountIbans.includes(row.accountIban)) {
      accountIbans.push(row.accountIban);
    }

    rows.push(row);
  }

  return ok({ rows, accountIbans });
};

// MECHANISM RULE (finding CR-208): in a DIRECTIONAL column, the column is
// the sign authority and the cell must be a bare magnitude. A cell carrying
// its own sign is a convention the profile did not declare, and a sign is
// never guessed: before this rule the debitCredit branch negated the parsed
// value instead of a magnitude, so "-742.10" under a Debit header stored
// +74210, a silent full inversion (hazard H1.1). SIBLING IMPLEMENTATION,
// same mechanism: the indicator branch below also derives the sign from
// representation metadata; its own fail-loud rule (a marker equal to
// neither declared token fails the row, finding F2) came in with the
// M1-P2 fix round. CORRECTED RATHER THAN QUIETLY REWRITTEN: an earlier
// version of this note said the F2 repair was absent from this branch's
// base, which was true when written (the M1-P2 squash had missed the fix
// round) and became false when the base was repaired at 6fc43c9; the
// M1-P3 work history records that escalation and its resolution. The
// indicator branch still takes Math.abs of the cell, so an explicitly
// signed cell there is absoluted, with the sign authority staying on the
// marker; making a signed cell fail loud there too is a candidate
// follow-up, not silently added here.
const carriesExplicitSign = (text: string): boolean =>
  text.startsWith("-") || text.startsWith("+");

const amountOf = (
  fields: readonly string[],
  spec: SourceProfileSpec,
): Result<Cents, "amount" | "missing-column" | "indicator"> => {
  const representation = spec.amountRepresentation;
  if (representation.kind === "signed") {
    const parsed = parseAmountToCents(
      cellAt(fields, representation.column),
      spec.decimalStyle,
    );
    return parsed.ok ? parsed : err("amount" as const);
  }
  if (representation.kind === "debitCredit") {
    const debitText = cellAt(fields, representation.debitColumn);
    const creditText = cellAt(fields, representation.creditColumn);
    if (debitText !== "" && creditText !== "") {
      return err("amount" as const);
    }
    if (debitText !== "") {
      if (carriesExplicitSign(debitText)) {
        return err("amount" as const);
      }
      const parsed = parseAmountToCents(debitText, spec.decimalStyle);
      return parsed.ok
        ? ok((-parsed.value) as Cents)
        : err("amount" as const);
    }
    if (creditText !== "") {
      if (carriesExplicitSign(creditText)) {
        return err("amount" as const);
      }
      const parsed = parseAmountToCents(creditText, spec.decimalStyle);
      return parsed.ok ? parsed : err("amount" as const);
    }
    return err("missing-column" as const);
  }
  // indicator
  const parsed = parseAmountToCents(
    cellAt(fields, representation.amountColumn),
    spec.decimalStyle,
  );
  if (!parsed.ok) {
    return err("amount" as const);
  }
  // A sign is NEVER guessed (finding F2): the marker must equal one of the
  // pair's two declared tokens, compared case-insensitively because
  // detection normalises the tokens to uppercase. Anything else, a blank
  // cell included, fails the row, which fails the import loudly with
  // nothing written, the same discipline as the mixed-account check.
  const indicator = cellAt(fields, representation.indicatorColumn).toUpperCase();
  const magnitude = Math.abs(parsed.value);
  if (indicator === representation.debitValue.toUpperCase()) {
    return ok((-magnitude) as Cents);
  }
  if (indicator === representation.creditValue.toUpperCase()) {
    return ok(magnitude as Cents);
  }
  return err("indicator" as const);
};
