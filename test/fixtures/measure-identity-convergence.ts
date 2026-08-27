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

// A label that can never carry an identifier out of a real document.
export const measurementLabel = (path: string): string => {
  const name = basename(path);
  return resolve(path).startsWith(`${FIXTURE_DIRECTORY}/`) ? name : name.slice(0, 8);
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

export const measureFile = async (path: string): Promise<IdentityMeasurement> => {
  const bytes = new Uint8Array(readFileSync(path));
  const detected = await statementParser.detect(bytes);
  if (!detected.ok) {
    throw new Error(`detect failed for ${measurementLabel(path)}: ${detected.error.kind}`);
  }
  const parsed = await statementParser.parse(bytes, detected.value);
  if (!parsed.ok) {
    throw new Error(`parse failed for ${measurementLabel(path)}: ${parsed.error.kind}`);
  }
  return measureRows(measurementLabel(path), parsed.value.rows);
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
  for (const path of paths) {
    try {
      console.log(formatMeasurement(await measureFile(path)));
    } catch (error) {
      failures += 1;
      console.log(`file ${measurementLabel(path)}`);
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
