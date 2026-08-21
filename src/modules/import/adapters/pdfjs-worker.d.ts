// Ambient module declaration for the pdf.js worker entry, which ships no
// type file of its own (pdfjs-dist has no exports map and only
// legacy/build/pdf.d.mts). The one export the fake-worker global needs is
// WorkerMessageHandler (see pdf-text-extractor.ts).
declare module "pdfjs-dist/legacy/build/pdf.worker.mjs" {
  export const WorkerMessageHandler: unknown;
}
