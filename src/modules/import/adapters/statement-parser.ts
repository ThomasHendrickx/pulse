// The ONE StatementParser adapter. It routes on the PDF magic bytes and
// nothing else: PDF bytes go through pdfjs-dist extraction, deliberate
// line reconstruction and the code-owned layout-template registry;
// everything else flows down the generic delimited path untouched,
// exactly as it did before PDFs existed (v0.2 addendum section 1).
//
// CORRECTED RATHER THAN QUIETLY REWRITTEN (R-087): the predecessor file
// (delimited-file-parser.ts) said "there are no per-bank parsers and none
// may be added". That sentence was written for the delimited world and
// remains true THERE (one generic spec-driven parser, pulse-domain
// section 5); the v0.2 addendum deliberately introduces PER-INSTITUTION
// LAYOUT TEMPLATES for PDFs, owned by code and selected by fingerprint,
// never by asking the user (pulse-v0.2-pdf-addendum.md:23). The old
// absolute is therefore narrowed, not violated: per-bank CSV parsers stay
// forbidden; PDF layout templates are the sanctioned per-institution
// surface, and they live in domain/ behind this one adapter.

import { err, ok, type Result } from "@/platform/result";
import { detectSourceProfile } from "../domain/detect-profile";
import { parseStatement, type ParsedStatement } from "../domain/parse-statement";
import { reconstructPdfLines } from "../domain/pdf-lines";
import { parsePdfStatement } from "../domain/parse-pdf-statement";
import { findTemplateByFingerprint, type PdfPageLines } from "../domain/pdf-template";
import type { SourceProfileSpec } from "../domain/source-profile";
import type {
  StatementDetectError,
  StatementParseFailure,
  StatementParser,
} from "../application/ports";
import { extractPdfPageItems, isPdfBytes } from "./pdf-text-extractor";

const extractPages = async (
  bytes: Uint8Array,
): Promise<readonly PdfPageLines[] | undefined> => {
  const extracted = await extractPdfPageItems(bytes);
  if (!extracted.ok) {
    return undefined;
  }
  return extracted.value.map((page) => reconstructPdfLines(page));
};

const detect = async (
  bytes: Uint8Array,
): Promise<Result<SourceProfileSpec, StatementDetectError>> => {
  if (!isPdfBytes(bytes)) {
    return detectSourceProfile(bytes);
  }
  const pages = await extractPages(bytes);
  // Unreadable PDF bytes and a readable PDF matching no template land on
  // the same loud failure: this is a PDF Pulse has no layout for yet, a
  // backlog item and never a user question (addendum:27, D-5).
  if (pages === undefined) {
    return err({ kind: "layout-unsupported" as const });
  }
  const template = findTemplateByFingerprint(pages);
  if (template === undefined) {
    return err({ kind: "layout-unsupported" as const });
  }
  return ok({
    kind: "pdf-layout" as const,
    templateId: template.id,
    templateVersion: template.version,
  });
};

const parse = async (
  bytes: Uint8Array,
  spec: SourceProfileSpec,
): Promise<Result<ParsedStatement, StatementParseFailure>> => {
  if (spec.kind === "pdf-layout") {
    const pages = await extractPages(bytes);
    if (pages === undefined) {
      // A pdf-layout spec over bytes the extractor cannot read: surfaced
      // as a structural parse failure so the import fails loudly with
      // zero rows, the same discipline as every other parse failure.
      return err({ kind: "pdf-structure" as const, problem: "extraction" as const });
    }
    // The shared path applies THE BALANCE CONTRACT for every template
    // (parse-pdf-statement.ts); templates never enforce it themselves.
    return parsePdfStatement(pages, spec.templateId);
  }
  return parseStatement(bytes, spec);
};

export const statementParser: StatementParser = { detect, parse };
