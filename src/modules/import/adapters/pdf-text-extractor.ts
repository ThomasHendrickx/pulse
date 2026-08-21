// PDF text extraction behind the adapter-internal extraction port, using
// the DR-0020 dependency (pdfjs-dist), SERVER SIDE ONLY: this module is
// imported by the statement-parser adapter, which only ever runs inside
// server actions and server components. The library is loaded lazily so
// no client bundle can pick it up.
//
// WHAT THIS ADAPTER DOES NOT DO: assemble text. It hands POSITIONED text
// items to the domain's reconstructPdfLines, because default library text
// assembly glues words together (measured on the real KBC statement; see
// pdf-lines.ts for the mechanism rule). Extraction is deterministic for
// fixed bytes and a lockfile-pinned library version: no randomness, no
// clock, no environment dependence (hazard H2.3).

import { err, ok, type Result } from "@/platform/result";
import type { PdfPageItems } from "../domain/pdf-lines";

// Two failure kinds, deliberately distinct: what the BYTES did
// (pdf-extraction-failed: corrupt or truncated file) versus what the
// RUNTIME did (pdf-module-unavailable: the extraction library cannot
// load where this code is running). Both surface as a loud FAILED
// import; the runtime kind additionally logs the real stack server-side
// once and is what the /api/health/pdf probe reports.
export type PdfExtractionError =
  | { readonly kind: "pdf-extraction-failed" }
  | { readonly kind: "pdf-module-unavailable" };

// The PDF magic bytes: %PDF- at offset zero. Non-PDF bytes flow down the
// delimited path untouched, so this sniff is the ONLY branch point
// between the two parser families.
export const isPdfBytes = (bytes: Uint8Array): boolean =>
  bytes.length >= 5 &&
  bytes[0] === 0x25 && // %
  bytes[1] === 0x50 && // P
  bytes[2] === 0x44 && // D
  bytes[3] === 0x46 && // F
  bytes[4] === 0x2d; // -

// The legacy build is the Node-compatible entry point; the modern build
// assumes browser globals. Dynamic import keeps the dependency out of
// every client bundle and off the delimited path entirely.
//
// CORRECTED RATHER THAN QUIETLY REWRITTEN (R-087, deploy-verify defect
// round): the fix-round-1 design let a module-load failure THROW out of
// this adapter on the argument that infrastructure breakage should
// surface as a server error with a stack. IN PRODUCTION THAT THROW WAS
// REACHED FROM THE UPLOAD SERVER ACTION and rendered the owner a
// page-wide "Application error" digest with zero import rows (reproduced
// in production mode with the package absent: ERR_MODULE_NOT_FOUND,
// "Cannot find package 'pdfjs-dist'"). A throw here is a USER-FLOW
// 500 by construction, so the load failure is now a Result member
// (pdf-module-unavailable) that lands a loud FAILED import instead; the
// diagnosability the throw was meant to buy lives in the ONE
// console.error below (the real stack, server logs) and in the
// /api/health/pdf probe, which reports the deployed runtime's module
// state without needing log access.
let moduleFailureLogged = false;

const loadPdfjs = async (): Promise<
  typeof import("pdfjs-dist/legacy/build/pdf.mjs") | undefined
> => {
  try {
    return await import("pdfjs-dist/legacy/build/pdf.mjs");
  } catch (cause) {
    if (!moduleFailureLogged) {
      moduleFailureLogged = true;
      console.error("[pulse:pdf] pdfjs-dist failed to load in this runtime", cause);
    }
    return undefined;
  }
};

export const extractPdfPageItems = async (
  bytes: Uint8Array,
): Promise<Result<readonly PdfPageItems[], PdfExtractionError>> => {
  const pdfjs = await loadPdfjs();
  if (pdfjs === undefined) {
    return err({ kind: "pdf-module-unavailable" as const });
  }
  try {
    // pdfjs transfers the buffer it is given (it may be detached by the
    // worker shim), so it gets its own copy, never the caller's bytes.
    // Deterministic extraction: fixed bytes, lockfile-pinned library, no
    // network fetches, and NO SYSTEM FONTS (fix round 1, finding
    // HZ-005): useSystemFonts false pins extraction to embedded fonts
    // plus the library's built-in standard metrics, removing the one
    // environment surface the previous setting opened. CORRECTED RATHER
    // THAN QUIETLY REWRITTEN (R-087): this call used to pass
    // useSystemFonts true while the surrounding comments claimed no
    // environment dependence; both real statements and the fixtures
    // extract identically under false (re-verified in the fix round), so
    // the claim and the setting now agree.
    const task = pdfjs.getDocument({
      data: new Uint8Array(bytes),
      useSystemFonts: false,
      // Errors only: with system fonts off, pdfjs warns once per font
      // that no standardFontDataUrl is provided and falls back to its
      // BUILT-IN metrics, which is exactly the environment-free
      // behaviour wanted here; the warning would otherwise repeat on
      // every upload in the server logs. Extraction of both real
      // statements and every fixture is unchanged under the fallback
      // (re-verified in the fix round).
      verbosity: 0,
    });
    const document = await task.promise;
    try {
      const pages: PdfPageItems[] = [];
      for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
        const page = await document.getPage(pageNumber);
        const content = await page.getTextContent();
        const items = content.items.flatMap((item) =>
          "str" in item
            ? [
                {
                  x: item.transform[4] ?? 0,
                  y: item.transform[5] ?? 0,
                  width: item.width,
                  text: item.str,
                },
              ]
            : [],
        );
        pages.push({ items });
      }
      return ok(pages);
    } finally {
      // destroy() lives on the loading task and tears down the document
      // and its (in-process) worker shim.
      await task.destroy();
    }
  } catch {
    // Corrupt or truncated bytes behind a PDF magic header. An expected
    // failure of external input, so a Result, never a throw
    // (pulse-typescript section 5).
    return err({ kind: "pdf-extraction-failed" as const });
  }
};

// The deploy-verify self-check behind /api/health/pdf: staged booleans
// (module load, then a real extraction over the inline probe document),
// plus at most an error NAME and string CODE; never a message, an env
// value or a path. The probe document is EMBEDDED so the check does not
// depend on any file the deployment bundle might omit, which is exactly
// the failure class it exists to detect.
const PROBE_PDF_BASE64 =
  "JVBERi0xLjQKMSAwIG9iago8PCAvVHlwZSAvQ2F0YWxvZyAvUGFnZXMgMiAwIFIgPj4KZW5kb2JqCjIgMCBvYmoKPDwgL1R5cGUgL1BhZ2VzIC9LaWRzIFszIDAgUl0gL0NvdW50IDEgPj4KZW5kb2JqCjMgMCBvYmoKPDwgL1R5cGUgL1BhZ2UgL1BhcmVudCAyIDAgUiAvTWVkaWFCb3ggWzAgMCA1OTUgODQyXSAvUmVzb3VyY2VzIDw8IC9Gb250IDw8IC9GMSA1IDAgUiA+PiA+PiAvQ29udGVudHMgNCAwIFIgPj4KZW5kb2JqCjQgMCBvYmoKPDwgL0xlbmd0aCA2NSA+PgpzdHJlYW0KQlQgL0YxIDkgVGYgMSAwIDAgMSA4Ny44IDcwMC4wIFRtIChQVUxTRSBQREYgSEVBTFRIIFBST0JFKSBUaiBFVAplbmRzdHJlYW0KZW5kb2JqCjUgMCBvYmoKPDwgL1R5cGUgL0ZvbnQgL1N1YnR5cGUgL1R5cGUxIC9CYXNlRm9udCAvSGVsdmV0aWNhIC9FbmNvZGluZyAvV2luQW5zaUVuY29kaW5nID4+CmVuZG9iagp4cmVmCjAgNgowMDAwMDAwMDAwIDY1NTM1IGYgCjAwMDAwMDAwMDkgMDAwMDAgbiAKMDAwMDAwMDA1OCAwMDAwMCBuIAowMDAwMDAwMTE1IDAwMDAwIG4gCjAwMDAwMDAyNDEgMDAwMDAgbiAKMDAwMDAwMDM1NSAwMDAwMCBuIAp0cmFpbGVyCjw8IC9TaXplIDYgL1Jvb3QgMSAwIFIgPj4Kc3RhcnR4cmVmCjQ1MgolJUVPRgo=";

export type PdfExtractionProbe = {
  readonly moduleLoad: "ok" | "failed";
  readonly extraction: "ok" | "failed";
  readonly errorName?: string;
  readonly errorCode?: string;
};

const stringCodeOf = (cause: unknown): string | undefined => {
  if (typeof cause === "object" && cause !== null && "code" in cause) {
    const code = (cause as { code?: unknown }).code;
    return typeof code === "string" ? code : undefined;
  }
  return undefined;
};

export const probePdfExtraction = async (): Promise<PdfExtractionProbe> => {
  const pdfjs = await loadPdfjs();
  if (pdfjs === undefined) {
    return { moduleLoad: "failed", extraction: "failed" };
  }
  try {
    const data = Uint8Array.from(atob(PROBE_PDF_BASE64), (c) => c.charCodeAt(0));
    const task = pdfjs.getDocument({ data, useSystemFonts: false, verbosity: 0 });
    try {
      const document = await task.promise;
      const page = await document.getPage(1);
      const content = await page.getTextContent();
      return content.items.length > 0
        ? { moduleLoad: "ok", extraction: "ok" }
        : { moduleLoad: "ok", extraction: "failed" };
    } finally {
      await task.destroy();
    }
  } catch (cause) {
    const name = cause instanceof Error ? cause.name : "non-error";
    const code = stringCodeOf(cause);
    return {
      moduleLoad: "ok",
      extraction: "failed",
      errorName: name,
      ...(code !== undefined ? { errorCode: code } : {}),
    };
  }
};
