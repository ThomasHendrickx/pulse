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
// must never run inside the suite it is measuring. It is wired into npm so it
// cannot bit-rot unnoticed (fix round seven, hazard finding HZ6-M3P12-03),
// because an anchor drifting or a mutant becoming unreachable is silent, and
// both defects this harness has already had were found only because somebody
// remembered to run it:
//
//   npm run test:mutants
//
// It exits non-zero when any mutant is left green, so a checklist item or a CI
// job can stand where remembering used to.
//
// It restores the file from a saved copy on every exit path, including a
// throw, and prints the restored file's checksum beside the original's so a
// reader can see the tree was left as it was found.

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { scoreMutantRun } from "./mutant-scoring";

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
  // WHAT THIS MUTANT IS FOR. Every wrong predicate expects "caught": an
  // assertion fired in a named property. ONE entry expects "dies", and it is
  // not a wrong predicate at all: it is the harness checking its own
  // discriminator, which is the thing CR6-M3P12-01 found missing. Without it
  // the crash-versus-catch distinction is code nothing exercises, which is how
  // this file got the defect in the first place.
  readonly expect: "caught" | "dies";
};

const mutants: readonly Mutant[] = [
  {
    id: "M1",
    expect: "caught",
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
    expect: "caught",
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
    expect: "caught",
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
    id: "M6",
    expect: "caught",
    what: "consults the IDENTITY space before the pre-phase space in the before set",
    shipped: "never, but a comment in the source claimed the property could not catch it",
    edits: [
      [
        `        ? matchRules(baselineKey(row), rules.filter((r) => keyForRule(r) === baselineKey)) ??
          matchRules(identityKey(row), rules.filter((r) => keyForRule(r) === identityKey))`,
        `        ? matchRules(identityKey(row), rules.filter((r) => keyForRule(r) === identityKey)) ??
          matchRules(baselineKey(row), rules.filter((r) => keyForRule(r) === baselineKey))`,
      ],
    ],
  },
  {
    id: "M5",
    expect: "caught",
    what: "takes a rule of ANY kind for a claimant, not one of the same kind",
    shipped: "never, and that is the point: it is the one dimension no seed could reach",
    edits: [
      [
        `        rule.id !== exceptRuleId &&
        rule.kind === kind &&
        rule.pattern === pattern,`,
        `        rule.id !== exceptRuleId &&
        rule.pattern === pattern,`,
      ],
    ],
  },
  {
    id: "M4",
    expect: "caught",
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

// THE HARNESS'S OWN SELF-CHECK. It breaks the module so the property file
// cannot run at all, and the harness must score that as DIED rather than as
// caught. Before fix round eight it scored exactly this as "counted as CAUGHT"
// and exited 0, because the only thing it read was vitest's exit code and a
// file that dies exits non-zero as readily as one whose assertion fired.
const selfCheck: Mutant = {
  id: "SELF",
  what: "breaks the module so the property file DIES without any assertion firing",
  shipped: "never: this is the harness testing its own discriminator",
  expect: "dies",
  edits: [
    [
      "  const decisions: RuleDecision[] = [];",
      "  const decisions: RuleDecision[] = [];\n  thisIdentifierDoesNotExist();",
    ],
  ],
};

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

// THE SCORING IS A PURE FUNCTION IN ITS OWN MODULE (fix round nine, HAZARD
// finding CR7-M3P12-02), so all four of its branches are reachable from the
// fast gate rather than only from a run of this harness. The SELF entry below
// still exercises the crash branch LIVE, because a canned report cannot show
// that a real crash produces no AssertionError; the two checks are
// complementary rather than duplicates.

let failures = 0;
try {
  for (const mutant of [...mutants, selfCheck]) {
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
    const { outcome, properties, message } = scoreMutantRun(failed, report);
    console.log(`--- ${mutant.id}: ${mutant.what} (${mutant.shipped}) ---`);
    if (outcome !== mutant.expect) {
      failures += 1;
    }
    switch (outcome) {
      case "green":
        console.log(
          "  EVERY PROPERTY STAYED GREEN. That is a defect in the properties, not a passing mutant.",
        );
        break;
      case "dies":
        console.log(
          mutant.expect === "dies"
            ? "  DIED, as this entry expects: the property file exited non-zero with NO AssertionError, and the harness scored that as died rather than as caught. That is the discriminator working."
            : "  THE MUTANT DIED RATHER THAN BEING CAUGHT: the property file exited non-zero with no AssertionError, so nothing in the properties discriminated anything. Repair the mutant until it fails an assertion.",
        );
        break;
      case "unattributed":
        console.log(
          "  AN ASSERTION FIRED BUT NEITHER PROPERTY OWNS IT: the failure could not be attributed to a named property, so the record would say nothing about which check caught this.",
        );
        break;
      case "caught":
        console.log(`  red on: ${properties.join(" and ")}`);
        console.log(`  ${message}`);
        break;
    }
  }
} finally {
  writeFileSync(target, original);
  console.log(
    `\nrestored: original ${digest(original)}, on disk ${digest(readFileSync(target, "utf-8"))}`,
  );
}

if (failures > 0) {
  console.log(
    `\n${failures} mutant(s) were not CAUGHT by an assertion: left green, died, or unattributed.`,
  );
  process.exitCode = 1;
}
