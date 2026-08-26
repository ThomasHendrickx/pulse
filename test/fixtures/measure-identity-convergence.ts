// The committed measurement harness for M3-P12 (plan step 1, criteria
// 12.2, 12.15 and 12.20). Every number this phase records cites this path,
// so anyone can re-run it rather than trusting a transcription: the M0-P5
// amendment's figures came from an uncommitted scratchpad and could not be
// re-derived, which is the failure this file exists to avoid.
//
// Run from the repository root:
//
//   npx tsx test/fixtures/measure-identity-convergence.ts <path> [<path> ...]
//
// It parses each file through the SHIPPED import path (statementParser
// detect + parse, the same entry the app uses) and prints COUNTS ONLY.
//
// IT PRINTS NO PARSED STRING, EVER, and that is the whole privacy contract
// of this file (fleet warning 12, criterion 12.13). No description, no
// counterparty name, no account number, no amount, no date and no derived
// key is written to stdout: only integers, and a file LABEL. The label is
// the basename for a file inside this repository's test/fixtures directory
// and the first eight characters of the basename otherwise, because the
// real statement uploads' FILE NAMES themselves embed an account number and
// a document reference (fleet warning 9). Nothing is written to disk.
//
// The identity counts are computed by importing the shipped derivation
// (src/modules/merchants/domain/counterparty-identity.ts), so this harness
// cannot disagree with the product: there is one implementation and this
// file measures it.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { statementParser } from "../../src/modules/import/adapters/statement-parser";
import type { ParsedRow } from "../../src/modules/import/domain/parse-statement";
import {
  counterpartyIdentity,
  type CounterpartyIdentityBasis,
} from "../../src/modules/merchants/domain/counterparty-identity";
import {
  counterpartyText,
  normaliseCounterparty,
} from "../../src/modules/merchants/domain/normalise-counterparty";

const FIXTURE_DIRECTORY = resolve(fileURLToPath(new URL(".", import.meta.url)));

// A LABEL THAT CANNOT CARRY AN IDENTIFIER OUT OF A REAL DOCUMENT, and in fix
// round nine that is decided by PROVENANCE rather than by spelling (HAZARD
// finding CR7-M3P12-01, clause R-087).
//
// TWO THINGS THIS COMMENT HAS SAID AND BOTH WERE WRONG, quoted because the
// second was written as the fix for the first and repeated its mistake one
// level up.
//
// IT FIRST SAID: "A label that can never carry an identifier out of a real
// document", over an implementation that returned the first eight characters
// of any outside basename. A real bank export leads its file name with an
// account number, so for such a file those eight characters were eight
// characters of it.
//
// IT THEN SAID the claim was "enforced rather than asserted", over an
// implementation that returned those eight characters whenever they matched
// /^[0-9a-f]{8}$/, the shape of this fleet's renaming handle. THAT IS THE SAME
// ERROR, one case fold away: BELGIUM'S COUNTRY CODE LOWERCASES INTO THE HEX
// ALPHABET. `BE68539007547034-...` was refused and `be68539007547034-...`, the
// same digits, returned `be685390`, which is the country code, both check
// digits and four digits of the account. The owner banks with Belgian
// institutions and many upload pipelines lowercase file names.
//
// WHY BOTH FAILED THE SAME WAY: each asked what the name LOOKS LIKE. "Looks
// like a bank filename" and "looks like a fleet handle" are both shape. The
// identity of a fleet handle is its PROVENANCE, that the fleet named this
// file, and provenance is not recoverable from the spelling of the name.
//
// SO NOTHING IS DERIVED FROM AN OUTSIDE NAME AT ALL. There are exactly two
// sources of a label and both are facts about the invocation rather than
// guesses about a string:
//
//   A COMMITTED FIXTURE is labelled by its basename. Its provenance is that
//   it is in this repository, so every byte of that name is already public and
//   reviewable in the tree.
//
//   AND THAT PROVENANCE IS NOW TESTED RATHER THAN INFERRED FROM A PATH
//   PREFIX (fix round nine, CRITERIA finding CR7-M3P12-02, third leak). The
//   branch used to ask whether the resolved path STARTED WITH the fixture
//   directory, which is a location and not a provenance: any file dropped
//   into the fixture directory, or into any subdirectory below it, returned
//   its FULL basename whether the tree carried it or not, and a real upload
//   copied there for a measurement run would have printed its own name. It
//   now asks git whether the path is TRACKED, which is the actual claim the
//   paragraph above makes. An untracked file in the fixture directory is an
//   outside file and is labelled like one.
//
//   ANY OTHER PATH is labelled by its ORDINAL POSITION in the invocation,
//   which the operator chose and which carries no byte of the file name. It
//   distinguishes several documents in one run, which is what the label is
//   for, and it can leak nothing because it is not derived from the document.
//
//   A caller that supplies no ordinal gets UNLABELLED. Fail closed.
export const UNLABELLED = "unlabelled";

// Resolved once per process and cached. FAIL CLOSED on every failure shape:
// no git, not a repository, a path outside the tree. An empty set labels
// everything as an outside file, which prints a placeholder rather than a
// name, and a placeholder is the safe direction.
let trackedFixtures: ReadonlySet<string> | undefined;

const committedFixturePaths = (): ReadonlySet<string> => {
  if (trackedFixtures === undefined) {
    try {
      trackedFixtures = new Set(
        execFileSync("git", ["ls-files", "-z", "--", "."], {
          cwd: FIXTURE_DIRECTORY,
          encoding: "utf-8",
          maxBuffer: 32 * 1024 * 1024,
        })
          .split("\0")
          .filter((name) => name !== "")
          .map((name) => resolve(FIXTURE_DIRECTORY, name)),
      );
    } catch {
      trackedFixtures = new Set<string>();
    }
  }
  return trackedFixtures;
};

export const measurementLabel = (path: string, ordinal?: number): string => {
  if (committedFixturePaths().has(resolve(path))) {
    return basename(path);
  }
  return ordinal === undefined ? UNLABELLED : `document-${ordinal}`;
};

export type IdentityMeasurement = {
  readonly label: string;
  readonly rows: number;
  readonly rowsWithAccount: number;
  readonly rowsWithName: number;
  readonly baselineDistinctKeys: number;
  readonly baselineSingletonKeys: number;
  readonly baselineSingletonRows: number;
  readonly identityDistinctKeys: number;
  readonly identityAccountKeys: number;
  readonly identityDescriptorKeys: number;
  readonly identityRowsAccountBasis: number;
  readonly identityRowsDescriptorBasis: number;
  readonly identitySingletonKeys: number;
  readonly identitySingletonRows: number;
};

const countDistinct = (keys: readonly string[]): number => new Set(keys).size;

const singletons = (keys: readonly string[]): { keys: number; rows: number } => {
  const tally = new Map<string, number>();
  for (const key of keys) {
    tally.set(key, (tally.get(key) ?? 0) + 1);
  }
  const ones = [...tally.values()].filter((count) => count === 1).length;
  return { keys: ones, rows: ones };
};

export const measureRows = (
  label: string,
  rows: readonly ParsedRow[],
): IdentityMeasurement => {
  const baselineKeys = rows.map((row) =>
    normaliseCounterparty(counterpartyText(row)),
  );
  const identities = rows.map((row) =>
    counterpartyIdentity({
      description: row.description,
      ...(row.counterpartyName === undefined
        ? {}
        : { counterpartyName: row.counterpartyName }),
      ...(row.counterpartyIban === undefined
        ? {}
        : { counterpartyAccount: row.counterpartyIban }),
    }),
  );
  const identityKeys = identities.map((identity) => identity.key);
  const ofBasis = (basis: CounterpartyIdentityBasis): readonly string[] =>
    identities.filter((identity) => identity.basis === basis).map((i) => i.key);
  const baselineSingle = singletons(baselineKeys);
  const identitySingle = singletons(identityKeys);
  return {
    label,
    rows: rows.length,
    rowsWithAccount: rows.filter((row) => row.counterpartyIban !== undefined).length,
    rowsWithName: rows.filter((row) => row.counterpartyName !== undefined).length,
    baselineDistinctKeys: countDistinct(baselineKeys),
    baselineSingletonKeys: baselineSingle.keys,
    baselineSingletonRows: baselineSingle.rows,
    identityDistinctKeys: countDistinct(identityKeys),
    identityAccountKeys: countDistinct(ofBasis("account")),
    identityDescriptorKeys: countDistinct(ofBasis("descriptor")),
    identityRowsAccountBasis: ofBasis("account").length,
    identityRowsDescriptorBasis: ofBasis("descriptor").length,
    identitySingletonKeys: identitySingle.keys,
    identitySingletonRows: identitySingle.rows,
  };
};

export const measureFile = async (
  path: string,
  ordinal?: number,
): Promise<IdentityMeasurement> => {
  const bytes = new Uint8Array(readFileSync(path));
  const detected = await statementParser.detect(bytes);
  if (!detected.ok) {
    throw new Error(
      `detect failed for ${measurementLabel(path, ordinal)}: ${detected.error.kind}`,
    );
  }
  const parsed = await statementParser.parse(bytes, detected.value);
  if (!parsed.ok) {
    throw new Error(
      `parse failed for ${measurementLabel(path, ordinal)}: ${parsed.error.kind}`,
    );
  }
  return measureRows(measurementLabel(path, ordinal), parsed.value.rows);
};

export const formatMeasurement = (m: IdentityMeasurement): string =>
  [
    `file ${m.label}`,
    `  rows ${m.rows}`,
    `  rows-with-account ${m.rowsWithAccount}`,
    `  rows-with-name ${m.rowsWithName}`,
    `  baseline-distinct-keys ${m.baselineDistinctKeys}`,
    `  baseline-singleton-keys ${m.baselineSingletonKeys}`,
    `  baseline-singleton-rows ${m.baselineSingletonRows}`,
    `  identity-distinct-keys ${m.identityDistinctKeys}`,
    `  identity-account-keys ${m.identityAccountKeys}`,
    `  identity-descriptor-keys ${m.identityDescriptorKeys}`,
    `  identity-rows-account-basis ${m.identityRowsAccountBasis}`,
    `  identity-rows-descriptor-basis ${m.identityRowsDescriptorBasis}`,
    `  identity-singleton-keys ${m.identitySingletonKeys}`,
    `  identity-singleton-rows ${m.identitySingletonRows}`,
  ].join("\n");

const isMain = (): boolean => {
  const entry = process.argv[1];
  return entry !== undefined && fileURLToPath(import.meta.url) === resolve(entry);
};

const main = async (paths: readonly string[]): Promise<number> => {
  if (paths.length === 0) {
    console.error("usage: measure-identity-convergence.ts <path> [<path> ...]");
    return 2;
  }
  let failures = 0;
  for (const [index, path] of paths.entries()) {
    // THE ORDINAL IS THE INVOCATION'S OWN, one-based and in argument order, so
    // a run over several real documents can tell them apart without any of
    // them contributing a character to the output.
    const ordinal = index + 1;
    try {
      console.log(formatMeasurement(await measureFile(path, ordinal)));
    } catch (error) {
      failures += 1;
      console.log(`file ${measurementLabel(path, ordinal)}`);
      const reason =
        error instanceof Error
          ? (error.message.split(":").pop()?.trim() ?? "error")
          : "error";
      console.log(`  status unparsed (${reason})`);
    }
  }
  return failures > 0 ? 1 : 0;
};

if (isMain()) {
  void main(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
