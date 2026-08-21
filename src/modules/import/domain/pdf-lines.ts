// Deliberate line reconstruction from positioned PDF text items.
//
// MECHANISM RULE (verification-first, notes/export-format-facts.md in the
// fleet home): a PDF's default library text assembly GLUES WORDS together
// (measured on the real KBC statement), so no code in this module may
// consume a text layer assembled by the extraction library. Lines are
// rebuilt here, deterministically, from positioned items: group by y
// within a fixed tolerance, sort by x, insert ONE space wherever the gap
// between two runs exceeds a fixed threshold. Same bytes always yield the
// same lines: no randomness, no clock, no environment dependence (hazard
// H2.3). SIBLING IMPLEMENTATION: none; the extraction adapter
// (adapters/pdf-text-extractor.ts) feeds this function and must never
// grow its own line assembly.
//
// EACH LINE CARRIES ITS LEFT EDGE (fix round 1, finding HZ-001): layout
// templates need the line's horizontal position to tell MARGIN-LEVEL
// structure (transaction starts, balance lines, band lines) from INDENTED
// description text, because description lines are counterparty-controlled
// free text and may carry any shape, including the exact transaction-start
// or balance shape. Classifying lines by text shape alone let a crafted
// description fabricate a row and a balance-shaped description line
// truncate a block (the review's executed constructions); the line's
// position is the layout fact that separates structure from data.

// One positioned text run, in PDF text space (origin bottom-left, y grows
// upward). x and y are the run's transform origin; width is the run's
// advance width as the extraction library measures it.
export type PdfTextItem = {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly text: string;
};

export type PdfPageItems = {
  readonly items: readonly PdfTextItem[];
};

// One reconstructed visual line: its text and its left edge (the x of its
// leftmost run), which templates use for indentation classification.
export type PdfLine = {
  readonly text: string;
  readonly x: number;
};

// Runs whose baselines differ by no more than this many text-space units
// belong to one visual line. Statement body text is 8pt to 10pt with line
// advances of 10+ units, so 2.0 separates lines with a wide margin.
const LINE_Y_TOLERANCE = 2.0;

// A horizontal gap wider than this many units between two runs on one
// line renders as word spacing. Word gaps measured on the real statements
// are 2.5 units and up; fragment continuations are 0 or negative.
const WORD_GAP_THRESHOLD = 1.0;

// Reconstruct the visual lines of one page, top to bottom. Whitespace-only
// runs carry no text of their own (spacing is re-derived from geometry)
// and are dropped; runs of consecutive spaces collapse to one.
export const reconstructPdfLines = (
  page: PdfPageItems,
): readonly PdfLine[] => {
  const runs = page.items.filter((item) => item.text.trim() !== "");
  // Stable sort: top to bottom, then left to right. Array.prototype.sort
  // is specified stable, so equal keys keep extraction order and the
  // result is a pure function of the input.
  const ordered = [...runs].sort((a, b) => b.y - a.y || a.x - b.x);

  const groups: { anchorY: number; items: PdfTextItem[] }[] = [];
  for (const run of ordered) {
    const current = groups[groups.length - 1];
    if (current !== undefined && Math.abs(current.anchorY - run.y) <= LINE_Y_TOLERANCE) {
      current.items.push(run);
    } else {
      groups.push({ anchorY: run.y, items: [run] });
    }
  }

  const lines: PdfLine[] = [];
  for (const group of groups) {
    const items = [...group.items].sort((a, b) => a.x - b.x);
    let text = "";
    let previousEnd: number | undefined;
    for (const item of items) {
      if (previousEnd !== undefined && item.x - previousEnd > WORD_GAP_THRESHOLD) {
        text += " ";
      }
      text += item.text;
      previousEnd = item.x + item.width;
    }
    const trimmed = text.replace(/\s+/g, " ").trim();
    const leftmost = items[0];
    if (trimmed !== "" && leftmost !== undefined) {
      lines.push({ text: trimmed, x: leftmost.x });
    }
  }
  return lines;
};
