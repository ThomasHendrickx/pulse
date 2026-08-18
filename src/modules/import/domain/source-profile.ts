// The SourceProfile parsing spec: a declaration the user confirms once per
// source, and the one declaration that shapes FACTS, because it decides how
// a raw line is parsed (pulse-domain section 2, the explicit exception).
// There are no per-bank parsers; one generic parser is driven entirely by
// this spec (pulse-domain section 5).

import { err, ok, type Result } from "@/platform/result";

export type Delimiter = ";" | ",";
export type FileEncoding = "utf-8" | "windows-1252";
export type DateFormat = "DD/MM/YYYY" | "YYYY-MM-DD" | "DD.MM.YY";
export type DecimalStyle = "comma" | "dot";

// Amount representation is the field a naive column mapping misses, and it
// silently inverts every sign in a history (hazard H1.1). A discriminated
// union, never three optional fields (pulse-typescript section 4).
export type AmountRepresentation =
  | { readonly kind: "signed"; readonly column: number }
  | {
      readonly kind: "debitCredit";
      readonly debitColumn: number;
      readonly creditColumn: number;
    }
  | {
      readonly kind: "indicator";
      readonly amountColumn: number;
      readonly indicatorColumn: number;
      readonly debitValue: string;
      // Both members of the marker pair are declared. A marker matching
      // neither fails the row: a sign is never guessed (finding F2).
      readonly creditValue: string;
    };

// Column roles, by zero-based column index. bookingDate and description
// are the only mandatory roles; card exports carry neither a
// counterparty-account column nor statement and sequence numbers.
export type ColumnRoles = {
  readonly bookingDate: number;
  readonly description: number;
  readonly valueDate?: number;
  readonly counterpartyName?: number;
  readonly counterpartyIban?: number;
  readonly accountIban?: number;
  readonly reference?: number;
  readonly statementNumber?: number;
  readonly sequenceNumber?: number;
};

export type SourceProfileSpec = {
  readonly delimiter: Delimiter;
  readonly encoding: FileEncoding;
  readonly headerRowIndex: number;
  readonly dateFormat: DateFormat;
  readonly decimalStyle: DecimalStyle;
  readonly amountRepresentation: AmountRepresentation;
  readonly columns: ColumnRoles;
};

// The dedup key choice is a per-profile property (verification-first step):
// the statement-plus-sequence natural key exists only when the profile has
// both columns; card profiles have neither and take the hash path.
export const hasNaturalKey = (spec: SourceProfileSpec): boolean =>
  spec.columns.statementNumber !== undefined &&
  spec.columns.sequenceNumber !== undefined;

export type SpecParseError = { readonly kind: "invalid-spec"; readonly at: string };

const isIndex = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= 0;

const OPTIONAL_ROLES = [
  "valueDate",
  "counterpartyName",
  "counterpartyIban",
  "accountIban",
  "reference",
  "statementNumber",
  "sequenceNumber",
] as const;

// Boundary validation for the Json column on SourceProfile: everything
// crossing a boundary is parsed, never cast (pulse-typescript section 6).
export const parseSourceProfileSpec = (
  input: unknown,
): Result<SourceProfileSpec, SpecParseError> => {
  if (typeof input !== "object" || input === null) {
    return err({ kind: "invalid-spec" as const, at: "root" });
  }
  const record = input as Record<string, unknown>;

  const delimiter = record.delimiter;
  if (delimiter !== ";" && delimiter !== ",") {
    return err({ kind: "invalid-spec" as const, at: "delimiter" });
  }
  const encoding = record.encoding;
  if (encoding !== "utf-8" && encoding !== "windows-1252") {
    return err({ kind: "invalid-spec" as const, at: "encoding" });
  }
  const dateFormat = record.dateFormat;
  if (
    dateFormat !== "DD/MM/YYYY" &&
    dateFormat !== "YYYY-MM-DD" &&
    dateFormat !== "DD.MM.YY"
  ) {
    return err({ kind: "invalid-spec" as const, at: "dateFormat" });
  }
  const decimalStyle = record.decimalStyle;
  if (decimalStyle !== "comma" && decimalStyle !== "dot") {
    return err({ kind: "invalid-spec" as const, at: "decimalStyle" });
  }
  if (!isIndex(record.headerRowIndex)) {
    return err({ kind: "invalid-spec" as const, at: "headerRowIndex" });
  }

  const rep = record.amountRepresentation;
  if (typeof rep !== "object" || rep === null) {
    return err({ kind: "invalid-spec" as const, at: "amountRepresentation" });
  }
  const repRecord = rep as Record<string, unknown>;
  let amountRepresentation: AmountRepresentation;
  if (repRecord.kind === "signed" && isIndex(repRecord.column)) {
    amountRepresentation = { kind: "signed", column: repRecord.column };
  } else if (
    repRecord.kind === "debitCredit" &&
    isIndex(repRecord.debitColumn) &&
    isIndex(repRecord.creditColumn)
  ) {
    amountRepresentation = {
      kind: "debitCredit",
      debitColumn: repRecord.debitColumn,
      creditColumn: repRecord.creditColumn,
    };
  } else if (
    repRecord.kind === "indicator" &&
    isIndex(repRecord.amountColumn) &&
    isIndex(repRecord.indicatorColumn) &&
    typeof repRecord.debitValue === "string" &&
    repRecord.debitValue !== "" &&
    typeof repRecord.creditValue === "string" &&
    repRecord.creditValue !== ""
  ) {
    amountRepresentation = {
      kind: "indicator",
      amountColumn: repRecord.amountColumn,
      indicatorColumn: repRecord.indicatorColumn,
      debitValue: repRecord.debitValue,
      creditValue: repRecord.creditValue,
    };
  } else {
    return err({ kind: "invalid-spec" as const, at: "amountRepresentation" });
  }

  const columnsInput = record.columns;
  if (typeof columnsInput !== "object" || columnsInput === null) {
    return err({ kind: "invalid-spec" as const, at: "columns" });
  }
  const columnsRecord = columnsInput as Record<string, unknown>;
  if (!isIndex(columnsRecord.bookingDate)) {
    return err({ kind: "invalid-spec" as const, at: "columns.bookingDate" });
  }
  if (!isIndex(columnsRecord.description)) {
    return err({ kind: "invalid-spec" as const, at: "columns.description" });
  }
  const columns: {
    bookingDate: number;
    description: number;
    [key: string]: number;
  } = {
    bookingDate: columnsRecord.bookingDate,
    description: columnsRecord.description,
  };
  for (const role of OPTIONAL_ROLES) {
    const value = columnsRecord[role];
    if (value !== undefined) {
      if (!isIndex(value)) {
        return err({ kind: "invalid-spec" as const, at: `columns.${role}` });
      }
      columns[role] = value;
    }
  }

  return ok({
    delimiter,
    encoding,
    headerRowIndex: record.headerRowIndex,
    dateFormat,
    decimalStyle,
    amountRepresentation,
    columns: columns as ColumnRoles,
  });
};

// Structural spec equality, used to recognise a re-uploaded source without
// asking anything (criterion 1.5). Detection is deterministic, so the same
// file always detects the same spec; JSON with sorted keys is a faithful
// canonical form because the spec is plain data.
const canonical = (value: unknown): string => {
  if (Array.isArray(value)) {
    return `[${value.map(canonical).join(",")}]`;
  }
  if (typeof value === "object" && value !== null) {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value);
};

export const specEquals = (a: SourceProfileSpec, b: SourceProfileSpec): boolean =>
  canonical(a) === canonical(b);
