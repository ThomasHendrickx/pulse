// THE COMMITTED PRIVACY CHECK for M3-P12's fixture (fix round, finding
// HZ-M3P12-09). `npm run gate:privacy` is documented as unable to see a
// merchant name, a place name, a date or an amount inside a file, because
// those look exactly like invented ones (fleet warning 12). The only thing
// that catches a real one is reading the fixture back against the document
// it might have come from. That check was made for this phase and its
// numbers were recorded, but the DEFINITION behind them was not, so a
// reviewer re-running it by their own definition got different counts and
// could not reproduce them. This file is that definition, committed the way
// test/fixtures/measure-identity-convergence.ts committed the convergence
// harness, for exactly the same reason.
//
// Run from the repository root:
//
//   npx tsx test/fixtures/measure-fixture-token-overlap.ts <corpus> [<corpus> ...]
//
// It prints COUNTS and TOKEN NAMES, and the token names it prints are drawn
// from the COMMITTED FIXTURE ONLY, never from the corpus: every string it
// can emit is already public in this repository. The corpus documents are
// parsed in memory through the shipped path and nothing parsed from them is
// printed or written to disk.
//
// WHAT "NAME-LIKE" MEANS HERE, which is the thing that was missing:
//
//   THE POPULATION is every whitespace-and-punctuation-separated ALPHABETIC
//   run of four or more characters in the fixture's transaction
//   DESCRIPTIONS. Digits are excluded because every identifier shape in the
//   tree is covered by test/fixtures/allowed-identifiers.txt and by
//   gate:privacy, which is the check that CAN see them.
//
//   THE GRAMMAR IS SUBTRACTED. A statement fixture must reproduce the bank's
//   own vocabulary or it would not parse, so the words the shipped templates
//   and the shipped normaliser match on are not evidence of anything and are
//   listed below. What remains is the shop-like, place-like and person-like
//   population, which is the only population the question is about.
//
// A NON-EMPTY "name-like-overlap" IS NOT PROOF OF A LEAK and an empty one is
// not proof of its absence. It is a pointer at the strings a person must
// read. This file narrows the reading; it does not do it.

import { readFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { statementParser } from "../../src/modules/import/adapters/statement-parser";
import { IDENTITY_FIXTURE_TRANSACTIONS } from "./generate-pdf-fixtures";

// The bank's own transaction grammar, the card rail's vocabulary and the
// bank's letterhead: words a fixture MUST carry to parse. Subtracted from
// the population, and listed rather than pattern-matched so a reader can
// argue with the list.
export const STATEMENT_GRAMMAR: ReadonlySet<string> = new Set(
  [
    "OVERSCHRIJVING", "NAAR", "STORTING", "DOMICILIERING", "EUROPESE",
    "MEDEDELING", "REFERTE", "BETALING", "DEBITMASTERCARD", "KAART",
    "BIJDRAGE", "TERUGGAVE", "KOSTEN", "AFREKENING", "BEDRAG", "KOERS",
    "SALDO", "DATUM", "BLZ", "BIJLAGE", "EUR", "GOOGLE", "PAY", "VIA",
    "VOOR", "VAN", "MET", "DOOR", "OVER", "BANK", "REKENING",
  ].map((word) => word.toUpperCase()),
);

const ALPHABETIC_RUN = /[^A-Za-z]+/;

export const nameLikeTokens = (
  descriptions: readonly string[],
): readonly string[] => {
  const tokens = new Set<string>();
  for (const description of descriptions) {
    for (const run of description.split(ALPHABETIC_RUN)) {
      const token = run.toUpperCase();
      if (token.length >= 4 && !STATEMENT_GRAMMAR.has(token)) {
        tokens.add(token);
      }
    }
  }
  return [...tokens].sort();
};

export const fixtureDescriptions = (): readonly string[] =>
  IDENTITY_FIXTURE_TRANSACTIONS.flatMap(
    (transaction) => transaction.description,
  );

// The corpus text, held in memory and NEVER printed.
const corpusText = async (paths: readonly string[]): Promise<string> => {
  const chunks: string[] = [];
  for (const path of paths) {
    const bytes = new Uint8Array(readFileSync(path));
    const detected = await statementParser.detect(bytes);
    if (!detected.ok) {
      console.log(`corpus ${basename(path).slice(0, 8)}: unparsed (detect)`);
      continue;
    }
    const parsed = await statementParser.parse(bytes, detected.value);
    if (!parsed.ok) {
      console.log(`corpus ${basename(path).slice(0, 8)}: unparsed (parse)`);
      continue;
    }
    for (const row of parsed.value.rows) {
      chunks.push(row.description.toUpperCase());
      if (row.counterpartyName !== undefined) {
        chunks.push(row.counterpartyName.toUpperCase());
      }
    }
    console.log(`corpus ${basename(path).slice(0, 8)}: rows ${parsed.value.rows.length}`);
  }
  return chunks.join("\n");
};

export const overlap = (
  tokens: readonly string[],
  corpus: string,
): readonly string[] => tokens.filter((token) => corpus.includes(token));

const isMain = (): boolean => {
  const entry = process.argv[1];
  return entry !== undefined && fileURLToPath(import.meta.url) === resolve(entry);
};

const main = async (paths: readonly string[]): Promise<number> => {
  if (paths.length === 0) {
    console.error(
      "usage: measure-fixture-token-overlap.ts <corpus> [<corpus> ...]",
    );
    return 2;
  }
  const tokens = nameLikeTokens(fixtureDescriptions());
  // NAMED SO THE COVERING TEST CAN PIN IT: this string holds text parsed
  // out of the real documents and is only ever an argument to `includes`.
  const corpusHaystack = await corpusText(paths);
  const hits = overlap(tokens, corpusHaystack);
  console.log(`fixture name-like tokens ${tokens.length}`);
  console.log(`name-like overlap ${hits.length}`);
  for (const token of hits) {
    // A FIXTURE token, already public in this repository.
    console.log(`  overlap ${token}`);
  }
  return 0;
};

if (isMain()) {
  void main(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
