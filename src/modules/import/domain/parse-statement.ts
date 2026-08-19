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
      readonly problem: "date" | "amount" | "missing-column";
    };

const cellAt = (fields: readonly string[], index: number): string =>
  (fields[index] ?? "").trim();

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
    const fields = splitDelimitedLine(line, spec.delimiter);

    const bookingDateResult = parseBusinessDate(
      cellAt(fields, spec.columns.bookingDate),
      spec.dateFormat,
    );
    if (!bookingDateResult.ok) {
      return err({
        kind: "row-error" as const,
        lineNumber,
        rawLine: line,
        problem: "date" as const,
      });
    }

    const amountResult = amountOf(fields, spec);
    if (!amountResult.ok) {
      return err({
        kind: "row-error" as const,
        lineNumber,
        rawLine: line,
        problem: amountResult.error,
      });
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

    if (row.accountIban !== undefined && !accountIbans.includes(row.accountIban)) {
      accountIbans.push(row.accountIban);
    }

    rows.push(row);
  }

  return ok({ rows, accountIbans });
};

const amountOf = (
  fields: readonly string[],
  spec: SourceProfileSpec,
): Result<Cents, "amount" | "missing-column"> => {
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
      const parsed = parseAmountToCents(debitText, spec.decimalStyle);
      return parsed.ok
        ? ok((-parsed.value) as Cents)
        : err("amount" as const);
    }
    if (creditText !== "") {
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
  const indicator = cellAt(fields, representation.indicatorColumn);
  const magnitude = Math.abs(parsed.value);
  return ok(
    (indicator === representation.debitValue ? -magnitude : magnitude) as Cents,
  );
};
