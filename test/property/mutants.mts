// THE MUTANT RECORD CRITERION 12.7 REQUIRES, as a runnable harness rather than
// four remembered substitutions.
//
// WHY IT EXISTS. Six shape counts prove the GENERATOR reached each shape; they
// do not prove the PROPERTY can fail at one, and a property that cannot fail
// passes every count it is asked for. After four consecutive green-and-wrong
// implementations of this one mechanism the discriminating instrument is a
// mutant. Each predicate below SHIPPED, so each is a wrong answer somebody
// once believed, not an invented one.
//
// It is deliberately NOT a vitest file: it edits the module under test, so it
// must never run inside the suite it is measuring. Run it directly:
//
//   npx tsx test/property/mutants.mts
//
// It restores the file from a saved copy on every exit path, including a
// throw, and prints the restored file's checksum beside the original's so a
// reader can see the tree was left as it was found.

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dirname, "..", "..");
const target = join(
  root,
  "src",
  "modules",
  "merchants",
  "application",
  "rederive-rules.ts",
);
const propertyFile = "test/property/rederive-loss-reporting.test.ts";

const EXEMPTION = `    const claimantOfHeld = supersededByClaimant.get(held.ruleId);
    if (
      claimantOfHeld !== undefined &&
      after !== undefined &&
      lineageRoot(after.ruleId) === claimantOfHeld
    ) {
      continue;
    }`;

const CLAIMANT_MERCHANT_BRANCH = `    if (
      after !== undefined &&
      claimantMerchant !== undefined &&
      after.merchantId === claimantMerchant
    ) {
      claimantMerchantReports.push({
        transactionId: id,
        heldByRuleId: held.ruleId,
        nowHeldByRuleId: after.ruleId,
      });
      continue;
    }`;

type Mutant = {
  readonly id: string;
  readonly what: string;
  readonly shipped: string;
  readonly edits: readonly (readonly [string, string])[];
};

const mutants: readonly Mutant[] = [
  {
    id: "M1",
    what: "reports every change",
    shipped: "round two",
    // The DECLARATION of the claimant stays, because removing it too would
    // leave the next statement referring to a name that no longer exists and
    // the mutant would die of a ReferenceError instead of being caught. A
    // mutant that crashes proves nothing about the properties.
    edits: [
      [EXEMPTION, "    const claimantOfHeld = supersededByClaimant.get(held.ruleId);"],
      [CLAIMANT_MERCHANT_BRANCH, ""],
    ],
  },
  {
    id: "M2",
    what: "excludes a superseded rule's whole claim from the before set",
    shipped: "round three",
    edits: [
      [
        "  const assignmentsBefore = assignmentSet(rows, before);",
        "  const assignmentsBefore = assignmentSet(\n    rows,\n    before.filter((rule) => !supersededByClaimant.has(rule.id)),\n  );",
      ],
    ],
  },
  {
    id: "M3",
    what: "asks only whether the row is covered by ANYTHING after the run",
    shipped: "round four",
    edits: [
      [
        `      claimantOfHeld !== undefined &&
      after !== undefined &&
      lineageRoot(after.ruleId) === claimantOfHeld`,
        `      claimantOfHeld !== undefined &&
      after !== undefined`,
      ],
    ],
  },
  {
    id: "M4",
    what: "publishes one promotion pair whose holder and source name DIFFERENT merchants",
    shipped: "the forged lineage",
    edits: [
      [
        "    if (collision !== undefined && collision.merchantId !== rule.merchantId) {",
        "    if (collision !== undefined && collision.merchantId !== rule.merchantId) {\n      promotionSource.set(collision.id, rule.id);",
      ],
    ],
  },
];

const original = readFileSync(target, "utf-8");
const digest = (text: string): string =>
  createHash("sha256").update(text).digest("hex").slice(0, 16);

const runProperty = (): { failed: boolean; report: string } => {
  try {
    execFileSync("npx", ["vitest", "run", propertyFile], {
      cwd: root,
      encoding: "utf-8",
      stdio: "pipe",
    });
    return { failed: false, report: "" };
  } catch (error) {
    const out = `${(error as { stdout?: string }).stdout ?? ""}${(error as { stderr?: string }).stderr ?? ""}`;
    return { failed: true, report: out };
  }
};

// The two properties, named so the record says WHICH one caught each mutant.
const FIRST = "the loss set and the claimant-merchant class";
const SECOND = "every published claimant pair and every published promotion pair";

// ATTRIBUTION READS THE FAILURE LINES AND NOT THE WHOLE OUTPUT. Vitest prints
// every test's title on a pass as well as a failure, so a substring search
// over the report says both properties caught every mutant, which is the
// opposite of the thing this harness exists to establish.
const summarise = (report: string): { properties: string[]; message: string } => {
  const failed = report
    .split("\n")
    .filter((line) => line.trimStart().startsWith("FAIL"))
    .map((line) => line.trim());
  const properties: string[] = [];
  if (failed.some((line) => line.includes(FIRST))) {
    properties.push("FIRST biconditional");
  }
  if (failed.some((line) => line.includes(SECOND))) {
    properties.push("SECOND, the lineage check");
  }
  const line =
    report
      .split("\n")
      .map((l) => l.trim())
      .find((l) => l.includes("AssertionError:"))
      ?.replace(/^Caused by: /, "") ?? "(no assertion line found)";
  return { properties, message: line };
};

let failures = 0;
try {
  for (const mutant of mutants) {
    let mutated = original;
    for (const [from, to] of mutant.edits) {
      if (mutated.split(from).length - 1 !== 1) {
        throw new Error(
          `${mutant.id}: its anchor no longer matches the source exactly once. The mutant record is stale and must be repaired before it is trusted.`,
        );
      }
      mutated = mutated.replace(from, to);
    }
    writeFileSync(target, mutated);
    const { failed, report } = runProperty();
    const { properties, message } = summarise(report);
    console.log(`--- ${mutant.id}: ${mutant.what} (${mutant.shipped}) ---`);
    if (!failed) {
      failures += 1;
      console.log(
        "  EVERY PROPERTY STAYED GREEN. That is a defect in the properties, not a passing mutant.",
      );
      continue;
    }
    console.log(`  red on: ${properties.join(" and ") || "(unattributed)"}`);
    console.log(`  ${message}`);
  }
} finally {
  writeFileSync(target, original);
  console.log(
    `\nrestored: original ${digest(original)}, on disk ${digest(readFileSync(target, "utf-8"))}`,
  );
}

if (failures > 0) {
  console.log(`\n${failures} mutant(s) left every property green.`);
  process.exitCode = 1;
}
