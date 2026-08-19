// Deterministic source-profile detection over the file's own lines:
// delimiter by frequency, decimal style by pattern, date format by parsing
// candidates against every row, amount representation by column shape.
// No LLM anywhere in this phase, and nothing here is random or
// order-dependent: the same bytes always detect the same spec, which is
// what lets a re-upload be recognised by spec equality (criterion 1.5).

import { err, ok, type Result } from "@/platform/result";
import {
  decodeStatementBytes,
  isValidUtf8,
  splitDelimitedLine,
  splitLines,
} from "./delimited-text";
import { isAmountLike } from "./parse-amount";
import { isDateLike } from "./parse-date";
import type {
  AmountRepresentation,
  ColumnRoles,
  DateFormat,
  DecimalStyle,
  Delimiter,
  FileEncoding,
  SourceProfileSpec,
} from "./source-profile";

export type DetectionError = {
  readonly kind: "undetectable";
  readonly reason:
    | "empty-file"
    | "no-delimiter"
    | "no-date-column"
    | "no-header-row"
    | "no-amount-column"
    | "ambiguous-amount-columns"
    | "no-description-column";
};

const DATE_FORMATS: readonly DateFormat[] = [
  "DD/MM/YYYY",
  "YYYY-MM-DD",
  "DD.MM.YY",
];

const IBAN = /^[A-Z]{2}\d{2}[A-Z0-9]{8,30}$/;
const INTEGER = /^\d+$/;

// Comma-style signatures: a decimal comma, with optional dot thousands.
const COMMA_DECIMAL = /^[-+]?(?:\d{1,3}(?:\.\d{3})+|\d+),\d{1,2}$/;

// Indicator token pairs seen in Belgian exports: the first member is the
// debit token. A closed list, fail closed: an unknown pair is not an
// indicator column (pulse-typescript: pin accepted shapes, never widen).
const INDICATOR_PAIRS: readonly (readonly [string, string])[] = [
  ["D", "C"],
  ["DBIT", "CRDT"],
  ["AF", "BIJ"],
  ["DEBIT", "CREDIT"],
];

type Table = {
  readonly header: readonly string[];
  readonly dataRows: readonly (readonly string[])[];
};

const nonEmptyValues = (table: Table, column: number): string[] =>
  table.dataRows
    .map((row) => (row[column] ?? "").trim())
    .filter((value) => value !== "");

const columnCount = (table: Table): number =>
  Math.max(table.header.length, ...table.dataRows.map((row) => row.length));

export const detectSourceProfile = (
  bytes: Uint8Array,
): Result<SourceProfileSpec, DetectionError> => {
  const encoding: FileEncoding = isValidUtf8(bytes) ? "utf-8" : "windows-1252";
  const lines = splitLines(decodeStatementBytes(bytes, encoding)).filter(
    // Keep indexes: map first, filter later where index matters.
    () => true,
  );
  if (lines.length === 0) {
    return err({ kind: "undetectable" as const, reason: "empty-file" as const });
  }

  // Delimiter by frequency, counted with quote awareness (a field count of
  // n is n-1 delimiters). Tie breaks to ";", the Belgian default.
  const counts = new Map<Delimiter, number>();
  for (const candidate of [";", ","] as const) {
    let total = 0;
    for (const line of lines) {
      if (line.trim() === "") {
        continue;
      }
      total += splitDelimitedLine(line, candidate).length - 1;
    }
    counts.set(candidate, total);
  }
  const semicolons = counts.get(";") ?? 0;
  const commas = counts.get(",") ?? 0;
  if (semicolons === 0 && commas === 0) {
    return err({ kind: "undetectable" as const, reason: "no-delimiter" as const });
  }
  const delimiter: Delimiter = semicolons >= commas ? ";" : ",";

  const split = lines.map((line) => splitDelimitedLine(line, delimiter));

  // First data row: the first line with a cell parsing under any candidate
  // date format. Everything above it is header and preamble.
  const isDataRow = (fields: readonly string[]): boolean =>
    fields.some((cell) =>
      DATE_FORMATS.some((format) => isDateLike(cell.trim(), format)),
    );
  const firstDataRow = split.findIndex(isDataRow);
  if (firstDataRow === -1) {
    return err({
      kind: "undetectable" as const,
      reason: "no-date-column" as const,
    });
  }
  if (firstDataRow === 0) {
    return err({
      kind: "undetectable" as const,
      reason: "no-header-row" as const,
    });
  }
  const headerRowIndex = firstDataRow - 1;

  const table: Table = {
    header: (split[headerRowIndex] ?? []).map((cell) => cell.trim().toLowerCase()),
    dataRows: split
      .slice(firstDataRow)
      .filter((fields) => fields.join("").trim() !== ""),
  };
  const width = columnCount(table);

  // Date format: the format under which some full column parses on every
  // data row. The three candidate patterns are structurally disjoint, so a
  // column matches at most one.
  let dateFormat: DateFormat | undefined;
  const dateColumns: number[] = [];
  for (const format of DATE_FORMATS) {
    for (let column = 0; column < width; column += 1) {
      const values = nonEmptyValues(table, column);
      if (values.length > 0 && values.every((value) => isDateLike(value, format))) {
        if (dateFormat === undefined) {
          dateFormat = format;
        }
        if (format === dateFormat) {
          dateColumns.push(column);
        }
      }
    }
    if (dateFormat !== undefined) {
      break;
    }
  }
  const bookingDateColumn = dateColumns[0];
  if (dateFormat === undefined || bookingDateColumn === undefined) {
    return err({
      kind: "undetectable" as const,
      reason: "no-date-column" as const,
    });
  }

  // Decimal style by pattern: any comma-decimal cell anywhere decides
  // comma; otherwise dot.
  const allCells = table.dataRows.flatMap((row) =>
    row.map((cell) => cell.trim()),
  );
  const decimalStyle: DecimalStyle = allCells.some((cell) =>
    COMMA_DECIMAL.test(cell),
  )
    ? "comma"
    : "dot";

  // Amount columns: every non-empty cell parses as an amount AND at least
  // one cell carries a decimal separator or a sign. The second condition
  // is what keeps sequence-number columns (pure integers) out.
  const decimalOrSign =
    decimalStyle === "comma" ? /(^[-+])|,\d{1,2}$/ : /(^[-+])|\.\d{1,2}$/;
  const amountColumns: number[] = [];
  for (let column = 0; column < width; column += 1) {
    if (dateColumns.includes(column)) {
      continue;
    }
    const values = nonEmptyValues(table, column);
    if (
      values.length > 0 &&
      values.every((value) => isAmountLike(value, decimalStyle)) &&
      values.some((value) => decimalOrSign.test(value))
    ) {
      amountColumns.push(column);
    }
  }

  const headerOf = (column: number): string => table.header[column] ?? "";

  let amountRepresentation: AmountRepresentation;
  const firstAmountColumn = amountColumns[0];
  const secondAmountColumn = amountColumns[1];
  if (firstAmountColumn === undefined) {
    return err({
      kind: "undetectable" as const,
      reason: "no-amount-column" as const,
    });
  } else if (amountColumns.length > 2) {
    return err({
      kind: "undetectable" as const,
      reason: "ambiguous-amount-columns" as const,
    });
  } else if (secondAmountColumn !== undefined) {
    // Two amount columns with never both filled on one row: a debit and
    // credit pair. The debit column is named by its header when it is;
    // otherwise the first column is the debit, which is the common layout.
    const bothFilled = table.dataRows.some(
      (row) =>
        (row[firstAmountColumn] ?? "").trim() !== "" &&
        (row[secondAmountColumn] ?? "").trim() !== "",
    );
    if (bothFilled) {
      return err({
        kind: "undetectable" as const,
        reason: "ambiguous-amount-columns" as const,
      });
    }
    const firstIsCredit = /credit|bij/.test(headerOf(firstAmountColumn));
    const [debitColumn, creditColumn] = firstIsCredit
      ? [secondAmountColumn, firstAmountColumn]
      : [firstAmountColumn, secondAmountColumn];
    amountRepresentation = { kind: "debitCredit", debitColumn, creditColumn };
  } else {
    const values = nonEmptyValues(table, firstAmountColumn);
    const hasNegative = values.some((value) => value.startsWith("-"));
    const indicator = hasNegative
      ? undefined
      : findIndicatorColumn(table, width, [...dateColumns, ...amountColumns]);
    amountRepresentation = indicator
      ? {
          kind: "indicator",
          amountColumn: firstAmountColumn,
          indicatorColumn: indicator.column,
          debitValue: indicator.debitValue,
        }
      : { kind: "signed", column: firstAmountColumn };
  }

  // Role assignment for the remaining columns.
  const assigned = new Set<number>([...dateColumns]);
  assigned.add(firstAmountColumn);
  if (secondAmountColumn !== undefined) {
    assigned.add(secondAmountColumn);
  }
  if (amountRepresentation.kind === "indicator") {
    assigned.add(amountRepresentation.indicatorColumn);
  }

  const columns: {
    bookingDate: number;
    description: number;
    valueDate?: number;
    counterpartyName?: number;
    counterpartyIban?: number;
    accountIban?: number;
    reference?: number;
    statementNumber?: number;
    sequenceNumber?: number;
  } = {
    bookingDate: bookingDateColumn,
    // Placeholder, assigned below; kept in the literal so the type is
    // complete from construction.
    description: -1,
  };
  const secondDateColumn = dateColumns[1];
  if (secondDateColumn !== undefined) {
    columns.valueDate = secondDateColumn;
  }

  // IBAN columns, split into own account versus counterparty by header
  // hint first, then by distinct-value shape: a file's own account column
  // carries one repeated value.
  for (let column = 0; column < width; column += 1) {
    if (assigned.has(column)) {
      continue;
    }
    const values = nonEmptyValues(table, column);
    if (values.length === 0 || !values.every((value) => IBAN.test(value))) {
      continue;
    }
    const header = headerOf(column);
    const distinct = new Set(values);
    const isCounterpartyByHeader = /tegenrekening|tegenpartij|counterparty/.test(
      header,
    );
    const isOwnByHeader =
      !isCounterpartyByHeader && /rekening|account|iban/.test(header);
    if (isCounterpartyByHeader) {
      columns.counterpartyIban ??= column;
    } else if (isOwnByHeader || distinct.size === 1) {
      columns.accountIban ??= column;
    } else {
      columns.counterpartyIban ??= column;
    }
    assigned.add(column);
  }

  // Statement and sequence numbers: integer columns named by their header.
  // No fallback on purpose: card exports have neither, and guessing one
  // would hand the dedup key a column that is not a key.
  for (let column = 0; column < width; column += 1) {
    if (assigned.has(column)) {
      continue;
    }
    const values = nonEmptyValues(table, column);
    if (values.length === 0 || !values.every((value) => INTEGER.test(value))) {
      continue;
    }
    const header = headerOf(column);
    if (/afschrift|statement/.test(header)) {
      columns.statementNumber = column;
      assigned.add(column);
    } else if (/volg|sequence/.test(header)) {
      columns.sequenceNumber = column;
      assigned.add(column);
    }
  }

  // Named text roles by header hint.
  for (let column = 0; column < width; column += 1) {
    if (assigned.has(column)) {
      continue;
    }
    const header = headerOf(column);
    if (columns.counterpartyName === undefined && /naam|name/.test(header)) {
      columns.counterpartyName = column;
      assigned.add(column);
    } else if (
      columns.reference === undefined &&
      /referentie|reference|\bref\b/.test(header)
    ) {
      columns.reference = column;
      assigned.add(column);
    }
  }

  // Description: header hint first, otherwise the unassigned column with
  // the longest average text, which in a bank export is the free text.
  let descriptionColumn = -1;
  for (let column = 0; column < width; column += 1) {
    if (assigned.has(column)) {
      continue;
    }
    if (/omschrijving|description|mededeling|details/.test(headerOf(column))) {
      descriptionColumn = column;
      break;
    }
  }
  if (descriptionColumn === -1) {
    let bestLength = -1;
    for (let column = 0; column < width; column += 1) {
      if (assigned.has(column)) {
        continue;
      }
      const values = nonEmptyValues(table, column);
      const totalLength = values.reduce((sum, value) => sum + value.length, 0);
      const average = values.length === 0 ? 0 : totalLength / values.length;
      if (average > bestLength) {
        bestLength = average;
        descriptionColumn = column;
      }
    }
  }
  if (descriptionColumn === -1) {
    return err({
      kind: "undetectable" as const,
      reason: "no-description-column" as const,
    });
  }
  columns.description = descriptionColumn;

  return ok({
    delimiter,
    encoding,
    headerRowIndex,
    dateFormat,
    decimalStyle,
    amountRepresentation,
    columns: columns as ColumnRoles,
  });
};

const findIndicatorColumn = (
  table: Table,
  width: number,
  excluded: readonly number[],
): { column: number; debitValue: string } | undefined => {
  for (let column = 0; column < width; column += 1) {
    if (excluded.includes(column)) {
      continue;
    }
    const distinct = new Set(
      nonEmptyValues(table, column).map((value) => value.toUpperCase()),
    );
    if (distinct.size === 0) {
      continue;
    }
    for (const [debit, credit] of INDICATOR_PAIRS) {
      const known = new Set([debit, credit]);
      if (
        [...distinct].every((value) => known.has(value)) &&
        distinct.has(debit)
      ) {
        return { column, debitValue: debit };
      }
    }
  }
  return undefined;
};
