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

export type PdfExtractionError = { readonly kind: "pdf-extraction-failed" };

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

export const extractPdfPageItems = async (
  bytes: Uint8Array,
): Promise<Result<readonly PdfPageItems[], PdfExtractionError>> => {
  // The legacy build is the Node-compatible entry point; the modern
  // build assumes browser globals. Dynamic import keeps the dependency
  // out of every client bundle and off the delimited path entirely.
  //
  // DELIBERATELY OUTSIDE the try below (fix round 1, finding HZ-003): a
  // failure to LOAD the module is infrastructure breakage (a bundling or
  // packaging regression, the serverExternalPackages incident's class),
  // not a property of the uploaded bytes, so it THROWS and surfaces as a
  // server error with a stack instead of mislabelling every upload as an
  // unsupported bank layout. The Result path below is reserved for what
  // the BYTES did.
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
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
