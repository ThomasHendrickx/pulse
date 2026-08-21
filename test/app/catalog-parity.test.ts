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
// Asserting by NAME, never by count: the assertions below name the missing
// and extra keys per locale, so the failure message says which key drifted
// instead of pinning a total that every later phase would break by adding
// a legitimate key.

const CATALOG_DIR = join(__dirname, "..", "..", "messages");
const SOURCE_LOCALE = "en";
const TARGET_LOCALES = ["nl", "fr"] as const;

const readCatalogKeys = (locale: string): ReadonlySet<string> => {
  const raw = readFileSync(join(CATALOG_DIR, `${locale}.json`), "utf8");
  const parsed: unknown = JSON.parse(raw);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`messages/${locale}.json is not a JSON object`);
  }
  return new Set(Object.keys(parsed));
};

describe("message catalog parity across en, nl, fr", () => {
  const sourceKeys = readCatalogKeys(SOURCE_LOCALE);

  for (const locale of TARGET_LOCALES) {
    test(`${locale} carries exactly the ${SOURCE_LOCALE} key set`, () => {
      const targetKeys = readCatalogKeys(locale);
      const missing = [...sourceKeys].filter((key) => !targetKeys.has(key)).sort();
      const extra = [...targetKeys].filter((key) => !sourceKeys.has(key)).sort();
      expect(missing, `keys in ${SOURCE_LOCALE} but not in ${locale}`).toEqual([]);
      expect(extra, `keys in ${locale} but not in ${SOURCE_LOCALE}`).toEqual([]);
    });
  }

  test("the source catalog is not empty", () => {
    // Guards the guard: if en.json ever failed to parse into a non-empty
    // key set, both loops above would compare empty sets and pass.
    expect(sourceKeys.size).toBeGreaterThan(0);
  });
});
