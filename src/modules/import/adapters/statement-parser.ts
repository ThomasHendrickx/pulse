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
  // Fix round 1 (HZ-003): unreadable PDF bytes and a readable PDF
  // matching no template are DIFFERENT failures with different remedies
  // (a corrupt or truncated file versus a bank layout Pulse has no
  // template for yet, addendum:27, D-5), so each carries its own machine
  // reason and its own translated copy.
  if (pages === undefined) {
    return err({ kind: "pdf-extraction-failed" as const });
  }
  const template = findTemplateByFingerprint(pages);
  if (template === undefined) {
    return err({ kind: "layout-unsupported" as const });
  }
  // Fix round 2 (HZ-M3P3-02): a layout that carries no IBAN identifies
  // its account by a line of its own (the masked card number), and that
  // identity belongs in the SPEC, because spec equality is what decides
  // known-source versus new-source. A template that declares the reader
  // and finds nothing yields an identifier-less spec here; its own parse
  // then fails loudly rather than letting the file bind to whatever
  // account a spec-equal profile happens to hold.
  const identifier = template.accountIdentifier?.(pages);
  return ok({
    kind: "pdf-layout" as const,
    templateId: template.id,
    templateVersion: template.version,
    ...(identifier === undefined ? {} : { accountIdentifier: identifier }),
  });
};

const parse = async (
  bytes: Uint8Array,
  spec: SourceProfileSpec,
): Promise<Result<ParsedStatement, StatementParseFailure>> => {
  if (spec.kind === "pdf-layout") {
    const pages = await extractPages(bytes);
    if (pages === undefined) {
      // A pdf-layout spec over bytes the extractor cannot read: the same
      // distinct extraction-failure reason as on detect (HZ-003), loud,
      // zero rows.
      return err({ kind: "pdf-extraction-failed" as const });
    }
    // The shared path applies THE BALANCE CONTRACT and the
    // template-version gate for every template (parse-pdf-statement.ts);
    // templates never enforce either themselves.
    return parsePdfStatement(pages, spec.templateId, spec.templateVersion);
  }
  return parseStatement(bytes, spec);
};

export const statementParser: StatementParser = { detect, parse };
