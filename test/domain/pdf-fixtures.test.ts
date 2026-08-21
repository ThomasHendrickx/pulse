import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { buildPdfFixtures } from "../fixtures/generate-pdf-fixtures";

// D-3: fixture bytes are stable across runs and machines (fixed layout,
// no timestamps, no metadata), and the committed PDFs are EXACTLY what
// the committed generator produces, so neither can drift from the other
// without this test naming the drifted file.

describe("synthetic PDF fixture generator (D-3)", () => {
  const fixtures = buildPdfFixtures();

  test("generating twice yields byte-identical output", () => {
    const again = buildPdfFixtures();
    for (const [name, bytes] of fixtures) {
      expect(again.get(name), name).toEqual(bytes);
    }
  });

  test("the committed fixture files are the generator's output, byte for byte", () => {
    for (const [name, bytes] of fixtures) {
      const committed = new Uint8Array(
        readFileSync(join(__dirname, "..", "fixtures", name)),
      );
      expect(committed, name).toEqual(bytes);
    }
  });
});
