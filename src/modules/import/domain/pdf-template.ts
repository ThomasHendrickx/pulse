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
// mechanism: the Belfius current-account template (this phase) and the
// KBC card template (M3-P3).

import type { Cents } from "@/platform/money";
import type { Result } from "@/platform/result";
import type { ParsedRow } from "./parse-statement";
import { belfiusCurrentAccountTemplate } from "./belfius-current-account-template";

// The reconstructed text lines of one page, in reading order.
export type PdfPageLines = readonly string[];

export type PdfTemplateError = {
  readonly kind: "pdf-structure";
  // Which structural expectation of the layout failed. Machine-readable
  // and closed, like every error union here (pulse-typescript section 5).
  readonly problem:
    | "extraction"
    | "page-marker"
    | "no-account-iban"
    | "no-balance-lines"
    | "transaction-amount"
    | "transaction-date";
};

export type PdfTemplateOutcome = {
  readonly rows: readonly ParsedRow[];
  // Distinct own-account IBANs seen in the file, first-seen order,
  // compact form; more than one entry is the mixed-account failure the
  // use case owns (same contract as ParsedStatement.accountIbans).
  readonly accountIbans: readonly string[];
  readonly openingBalanceCents: Cents;
  readonly closingBalanceCents: Cents;
};

export type PdfLayoutTemplate = {
  readonly id: string;
  readonly version: number;
  // Whether rows carry natural-key components (statementNumber and
  // sequenceNumber fields): the per-profile dedup key choice, owned by
  // the template because the layout is code-owned (D-4).
  readonly hasNaturalKey: boolean;
  readonly matches: (pages: readonly PdfPageLines[]) => boolean;
  readonly parse: (
    pages: readonly PdfPageLines[],
  ) => Result<PdfTemplateOutcome, PdfTemplateError>;
};

// Registration order is match order and is part of the deterministic
// contract: fingerprints must be institution-distinctive, and the first
// match wins.
export const PDF_LAYOUT_TEMPLATES: readonly PdfLayoutTemplate[] = [
  belfiusCurrentAccountTemplate,
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
