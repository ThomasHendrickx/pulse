// Code-owned PDF layout templates, selected by fingerprint, never by
// asking the user (pulse-v0.2-pdf-addendum.md:23, decision D-2). One
// template per institution and document type; a PDF matching no template
// fails the import loudly upstream (layout-unsupported), it is a backlog
// item and never a user question.
//
// MECHANISM RULE for every template in this registry: a template parses
// RECONSTRUCTED LINES ONLY (see pdf-lines.ts) and must be a pure,
// deterministic function of them. It returns its rows TOGETHER WITH the
// statement's opening and closing balances; the balance contract itself
// (opening + sum(rows) == closing, in integer cents) is enforced in the
// SHARED parse path (parse-pdf-statement.ts), never inside a template, so
// every future template inherits the gate by construction
// (pulse-v0.2-pdf-addendum.md:35). Sibling implementations that share the
// mechanism: the Belfius current-account template (M3-P2) and the KBC
// Mastercard uitgavenstaat template (M3-P3); both parse reconstructed
// lines only and neither enforces the balance gate itself.

import type { Cents } from "@/platform/money";
import type { Result } from "@/platform/result";
import type { ParsedRow } from "./parse-statement";
import type { PdfLine } from "./pdf-lines";
import { belfiusCurrentAccountTemplate } from "./belfius-current-account-template";
import { kbcMastercardTemplate } from "./kbc-mastercard-template";

// The reconstructed lines of one page, in reading order, each carrying
// its left edge so templates can classify margin-level structure versus
// indented description text (finding HZ-001).
export type PdfPageLines = readonly PdfLine[];

export type PdfTemplateError = {
  readonly kind: "pdf-structure";
  // Which structural expectation of the layout failed. Machine-readable
  // and closed, like every error union here (pulse-typescript section 5).
  readonly problem:
    | "page-marker"
    | "no-account-iban"
    | "no-balance-lines"
    | "transaction-amount"
    | "transaction-date"
    // Fix round 1 (HZ-001): a margin-level line inside an open
    // transaction block that matches no known structure, and a break in
    // the statement's continuous sequence numbering. Both are the
    // zero-sum corruption shapes the balance gate alone is blind to.
    | "unrecognized-line"
    | "sequence-order"
    // Fix round 2 (HZ-M3P3-02): a layout whose own-account identity is
    // carried by a line the template MUST find (the masked card number on
    // a card statement) and that line is absent or repeated. Binding such
    // a file to whatever account the profile happens to hold is the
    // silent cross-card write that finding names.
    | "no-account-identifier"
    // Fix round 2 (HZ-M3P3-07): more than one DIFFERENT opening or
    // closing balance line in one document. Keeping the first opening and
    // the last closing was a silent choice; two different values now fail
    // loudly, like every other ambiguous shape in these templates.
    | "ambiguous-balance-lines";
};

export type PdfTemplateOutcome = {
  readonly rows: readonly ParsedRow[];
  // Distinct own-account IBANs seen in the file, first-seen order,
  // compact form; more than one entry is the mixed-account failure the
  // use case owns (same contract as ParsedStatement.accountIbans).
  readonly accountIbans: readonly string[];
  readonly openingBalanceCents: Cents;
  readonly closingBalanceCents: Cents;
  // THE FIGURE THE STATEMENT ITSELF CARRIES as the amount its issuer will
  // collect by direct debit, in positive integer cents (fix round 2,
  // finding HZ-M3P3-01). Present only for a layout that prints one, which
  // today means a card statement; a current-account statement has no such
  // number and leaves this absent. It is a FACT of the document and is
  // stored as one: nothing downstream may re-derive it from the row signs,
  // because an ordinary merchant refund makes the two differ.
  readonly settlementTotalCents?: Cents;
};

export type PdfLayoutTemplate = {
  readonly id: string;
  readonly version: number;
  // Whether rows carry natural-key components (statementNumber and
  // sequenceNumber fields): the per-profile dedup key choice, owned by
  // the template because the layout is code-owned (D-4).
  readonly hasNaturalKey: boolean;
  readonly matches: (pages: readonly PdfPageLines[]) => boolean;
  // The file's OWN-ACCOUNT identity when the layout carries no IBAN (fix
  // round 2, finding HZ-M3P3-02). Read at DETECT time, before any parse,
  // because it belongs in the profile spec: two cards of one issuer share
  // a template and must not share a profile, an account or a dedup scope.
  // Absent on a layout whose files identify themselves by IBAN; undefined
  // from a template that declares it means the identifying line was not
  // found, and that template's parse must fail loudly rather than let the
  // file bind to whatever account the profile holds.
  readonly accountIdentifier?: (
    pages: readonly PdfPageLines[],
  ) => string | undefined;
  readonly parse: (
    pages: readonly PdfPageLines[],
  ) => Result<PdfTemplateOutcome, PdfTemplateError>;
};

// TEMPLATE VERSION BUMP PROCEDURE (fix round 1, HZ-002): the version on
// a template is CONSULTED, not decorative. parsePdfStatement refuses a
// stored spec whose templateVersion differs from the registered
// template's version (template-version-mismatch, fail closed), and the
// upload path refuses to silently re-ask a declaration when a stored
// profile carries a stale version. So bumping a template's version is a
// MIGRATION, not an edit: (1) bump the version here only together with a
// deliberate migration of stored pdf-layout profile specs and, if row or
// key emission changed, a re-parse plan for stored imports; (2) never
// reuse a version number; (3) expect every stored profile and re-parse
// on the old version to fail loudly until the migration lands. A bump
// without a migration bricks PDF re-uploads LOUDLY, by design; before
// HZ-002 it silently re-parsed stored imports under new code instead.
//
// Registration order is match order and is part of the deterministic
// contract: fingerprints must be institution-distinctive, and the first
// match wins.
export const PDF_LAYOUT_TEMPLATES: readonly PdfLayoutTemplate[] = [
  belfiusCurrentAccountTemplate,
  kbcMastercardTemplate,
];

export const findTemplateByFingerprint = (
  pages: readonly PdfPageLines[],
): PdfLayoutTemplate | undefined =>
  PDF_LAYOUT_TEMPLATES.find((template) => template.matches(pages));

export const getTemplateById = (
  templateId: string,
): PdfLayoutTemplate | undefined =>
  PDF_LAYOUT_TEMPLATES.find((template) => template.id === templateId);

export const templateHasNaturalKey = (templateId: string): boolean =>
  getTemplateById(templateId)?.hasNaturalKey ?? false;
