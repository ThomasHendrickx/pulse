import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

// Catalog parity (M3-P1 criterion 1.2, hazard H1.2): every user-facing
// string lives in all three catalogs. English is the source, Dutch and
// French are translations (pulse-frontend section 7), so a key present in
// one file and absent from another is an untranslated string waiting to
// leak. This test reads the real committed catalogs, not fixtures, so the
// fast gate fails the moment any later phase ships a key in fewer than
// three languages.
//
// CORRECTED IN THE M3-P1 FIX ROUND (finding CR-602): the first version of
// this test compared TOP-LEVEL key names only, so an entry dropped from an
// array-valued key (steps, emptySteps, prevMonth) stayed green; the
// reviewer's construction (one array entry removed from one locale, 3
// passed) is captured in the work history. Parity is therefore asserted
// over DEEP leaf paths including array indices: "emptySteps[2]" is a path
// of its own, and a locale missing it is named in the failure.
//
// Asserting by NAME, never by count: the assertions below name the missing
// and extra paths per locale, so the failure message says which leaf
// drifted instead of pinning a total that every later phase would break by
// adding a legitimate key.

const CATALOG_DIR = join(__dirname, "..", "..", "messages");
const SOURCE_LOCALE = "en";
const TARGET_LOCALES = ["nl", "fr"] as const;

// Every leaf path in the catalog: object keys join with ".", array
// entries append "[index]". A leaf is anything that is not an object or
// an array, so an array shortened by one entry loses a path, and a value
// that changes SHAPE (an array where the source has a string) changes its
// path set rather than comparing equal by name.
const collectLeafPaths = (value: unknown, prefix: string, out: string[]): void => {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => {
      collectLeafPaths(entry, `${prefix}[${index}]`, out);
    });
    return;
  }
  if (typeof value === "object" && value !== null) {
    for (const [key, child] of Object.entries(value)) {
      collectLeafPaths(child, prefix === "" ? key : `${prefix}.${key}`, out);
    }
    return;
  }
  out.push(prefix);
};

const readCatalogLeafPaths = (locale: string): ReadonlySet<string> => {
  const raw = readFileSync(join(CATALOG_DIR, `${locale}.json`), "utf8");
  const parsed: unknown = JSON.parse(raw);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`messages/${locale}.json is not a JSON object`);
  }
  const paths: string[] = [];
  collectLeafPaths(parsed, "", paths);
  return new Set(paths);
};

describe("message catalog parity across en, nl, fr", () => {
  const sourcePaths = readCatalogLeafPaths(SOURCE_LOCALE);

  for (const locale of TARGET_LOCALES) {
    test(`${locale} carries exactly the ${SOURCE_LOCALE} leaf path set`, () => {
      const targetPaths = readCatalogLeafPaths(locale);
      const missing = [...sourcePaths].filter((path) => !targetPaths.has(path)).sort();
      const extra = [...targetPaths].filter((path) => !sourcePaths.has(path)).sort();
      expect(missing, `paths in ${SOURCE_LOCALE} but not in ${locale}`).toEqual([]);
      expect(extra, `paths in ${locale} but not in ${SOURCE_LOCALE}`).toEqual([]);
    });
  }

  test("the source catalog is not empty", () => {
    // Guards the guard: if en.json ever failed to parse into a non-empty
    // path set, both loops above would compare empty sets and pass.
    expect(sourcePaths.size).toBeGreaterThan(0);
  });
});
