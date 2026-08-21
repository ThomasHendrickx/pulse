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
  try {
    // The legacy build is the Node-compatible entry point; the modern
    // build assumes browser globals. Dynamic import keeps the dependency
    // out of every client bundle and off the delimited path entirely.
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    // pdfjs transfers the buffer it is given (it may be detached by the
    // worker shim), so it gets its own copy, never the caller's bytes.
    // Deterministic extraction: fixed bytes, lockfile-pinned library, no
    // network fetches (text content needs no font files).
    const task = pdfjs.getDocument({
      data: new Uint8Array(bytes),
      useSystemFonts: true,
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
