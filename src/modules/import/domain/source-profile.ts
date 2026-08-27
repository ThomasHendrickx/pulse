// The SourceProfile parsing spec: a declaration the user confirms once per
// source, and the one declaration that shapes FACTS, because it decides how
// a raw line is parsed (pulse-domain section 2, the explicit exception).
// There are no per-bank parsers; one generic parser is driven entirely by
// this spec (pulse-domain section 5).

import { err, ok, type Result } from "@/platform/result";
import { templateHasNaturalKey } from "./pdf-template";

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

// D-2 (v0.2 plan): the spec is a discriminated union. "delimited" carries
// the pre-widening shape unchanged; "pdf-layout" names a CODE-OWNED layout
// template by id and version (pulse-v0.2-pdf-addendum.md:23), because a
// PDF layout is not something a user can declare by answering questions.
// COMPATIBILITY CONTRACT (criterion 2.4, hazard H2.4): every profile
// stored BEFORE the widening carries no kind field, so the parser below
// normalises a kind-less object to the delimited variant, and both sides
// of every specEquals comparison pass through parseSourceProfileSpec or
// detection, so a pre-widening stored profile keeps being recognised by
// findProfileBySpec on the next upload.
export type DelimitedSourceProfileSpec = {
  readonly kind: "delimited";
  readonly delimiter: Delimiter;
  readonly encoding: FileEncoding;
  readonly headerRowIndex: number;
  readonly dateFormat: DateFormat;
  readonly decimalStyle: DecimalStyle;
  readonly amountRepresentation: AmountRepresentation;
  readonly columns: ColumnRoles;
};

export type PdfLayoutSourceProfileSpec = {
  readonly kind: "pdf-layout";
  readonly templateId: string;
  readonly templateVersion: number;
  // THE FILE'S OWN-ACCOUNT IDENTITY when the layout carries no IBAN (fix
  // round 2, finding HZ-M3P3-02): the masked card number a card statement
  // prints. It is part of the SPEC, and therefore of specEquals, because
  // spec equality is what decides whether an upload is a known source or
  // a new one to declare. Without it two cards of one issuer detect to
  // one spec, reuse one profile, land on one account, and their rows
  // share a dedup scope, so a payment on one card that matches a day, an
  // amount and a merchant on the other is silently absorbed as already
  // known. Absent for a layout whose files identify themselves by IBAN;
  // absent stays absent through canonicalisation, so a pre-existing
  // stored spec is still exactly equal to itself.
  readonly accountIdentifier?: string;
};

export type SourceProfileSpec =
  | DelimitedSourceProfileSpec
  | PdfLayoutSourceProfileSpec;

// The dedup key choice is a per-profile property (verification-first step):
// for delimited sources the statement-plus-sequence natural key exists only
// when the profile has both columns; card profiles have neither and take
// the hash path. For PDF layouts the choice belongs to the code-owned
// template (the Belfius template emits natural-key components per D-4; the
// KBC card format has no sequence numbers and will not).
export const hasNaturalKey = (spec: SourceProfileSpec): boolean =>
  spec.kind === "pdf-layout"
    ? templateHasNaturalKey(spec.templateId)
    : spec.columns.statementNumber !== undefined &&
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
// Branches on the kind discriminant; an ABSENT kind is the pre-widening
// stored shape and parses as the delimited variant (criterion 2.4).
export const parseSourceProfileSpec = (
  input: unknown,
): Result<SourceProfileSpec, SpecParseError> => {
  if (typeof input !== "object" || input === null) {
    return err({ kind: "invalid-spec" as const, at: "root" });
  }
  const record = input as Record<string, unknown>;

  if (record.kind === "pdf-layout") {
    const templateId = record.templateId;
    if (typeof templateId !== "string" || templateId === "") {
      return err({ kind: "invalid-spec" as const, at: "templateId" });
    }
    const templateVersion = record.templateVersion;
    if (
      typeof templateVersion !== "number" ||
      !Number.isInteger(templateVersion) ||
      templateVersion < 1
    ) {
      return err({ kind: "invalid-spec" as const, at: "templateVersion" });
    }
    const accountIdentifier = record.accountIdentifier;
    if (
      accountIdentifier !== undefined &&
      (typeof accountIdentifier !== "string" || accountIdentifier === "")
    ) {
      return err({ kind: "invalid-spec" as const, at: "accountIdentifier" });
    }
    // Whether the template EXISTS in this build's registry is a parse-time
    // question for the statement parser, not a validity question for the
    // stored declaration: a spec naming a template this build does not
    // carry must still round-trip so the profile row stays readable.
    return ok({
      kind: "pdf-layout" as const,
      templateId,
      templateVersion,
      ...(accountIdentifier === undefined ? {} : { accountIdentifier }),
    });
  }
  if (record.kind !== undefined && record.kind !== "delimited") {
    return err({ kind: "invalid-spec" as const, at: "kind" });
  }

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
    repRecord.creditValue !== "" &&
    // Finding CR-209: the parser compares indicator markers
    // case-insensitively (detection normalises tokens to uppercase), so a
    // pair equal after uppercasing makes the credit token UNREACHABLE and
    // every matching row a silent debit. The degenerate pair bounces here,
    // at the boundary, with the existing bad-spec error.
    repRecord.debitValue.toUpperCase() !== repRecord.creditValue.toUpperCase()
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
    kind: "delimited" as const,
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
