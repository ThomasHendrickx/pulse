// THE INVOCATION POINT for the one-off re-derivation of merchant rule
// declarations (M3-P12, decision D-46, criterion 12.17).
//
//   npm run rederive:merchant-rules -- --household <id> [--accept <ruleId,...>] [--dry-run]
//
// WHEN IT RUNS, and why the order is FORCED rather than preferred: AFTER the
// code deploys. The routine imports the new derivation to compute the new
// patterns, so it cannot run against a build that does not carry it.
//
// WHAT THE WINDOW BETWEEN THE TWO COSTS, stated rather than left to be
// discovered: for its duration the stored patterns are pre-migration and the
// matcher computes namespaced keys, so those rules match nothing and the
// affected rows show as UNRESOLVED. No total moves (resolution renames and
// regroups, never reclassifies), nothing is lost, and the recompute the
// routine runs at its end closes the window.
//
// DESTRUCTIVE AUTHORITY, stated in this command's own contract and never
// inherited from a caller: THIS COMMAND DESTROYS NOTHING. It issues no
// DELETE against any table and no UPDATE against any transaction row. The
// only writes it makes are (a) rewriting a merchant_rules pattern in place
// by prefixing a constant namespace, which is invertible by stripping that
// prefix, and (b) inserting new merchant_rules rows. It has no force flag
// and takes none. `--accept` is not a force flag: it does not widen what the
// routine writes, it only marks a blocking condition as seen by a person so
// the process exits 0, and it clears exactly the rule ids it names.
//
// EXIT CODES. 0 for every outcome except the two the plan makes blocking: a
// MERCHANT CONFLICT, where two rules for different merchants would collide
// on one new pattern, and a LOST ASSIGNMENT, where a transaction that
// carried a merchant id before the run does not carry the same one after. A
// rule that could not be promoted is printed, counted, and exits 0.
//
// IT PRINTS NO PATTERN CONTENT. Rule ids, passes, bases, outcomes and
// counts only: this repository is public and a stored pattern is derived
// from a real statement's text.

import { householdId, userId, type HouseholdContext } from "@/platform/tenancy";
import { recomputeInterpretation } from "@/modules/ledger/application";
import {
  formatDecisionReport,
  merchantRepository,
  rederiveMerchantRules,
} from "@/modules/merchants/application";

const argument = (name: string): string | undefined => {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) {
    return undefined;
  }
  return process.argv[index + 1];
};

const main = async (): Promise<number> => {
  const household = argument("household");
  if (household === undefined || household.trim() === "") {
    console.error(
      "rederive-merchant-rules: --household <id> is required. Every table carries a household id and every query filters on it.",
    );
    return 2;
  }
  const dryRun = process.argv.includes("--dry-run");
  const accepted = (argument("accept") ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value !== "");

  const context: HouseholdContext = {
    householdId: householdId(household),
    // The routine writes declarations, not user-attributed records; the
    // context's user id is required by the type and is not read by any write
    // this routine makes.
    userId: userId("rederive-merchant-rules"),
  };

  const report = await rederiveMerchantRules(
    context,
    {
      merchants: merchantRepository,
      recompute: dryRun
        ? async () => undefined
        : (ctx) => recomputeInterpretation(ctx),
    },
    { acceptedRuleIds: accepted },
  );

  console.log("--- decision report ---");
  console.log(formatDecisionReport(report));
  console.log("--- matched counts (excluded from the idempotence comparison) ---");
  for (const row of [...report.counts].sort((a, b) =>
    a.ruleId < b.ruleId ? -1 : a.ruleId > b.ruleId ? 1 : 0,
  )) {
    console.log(
      `${row.ruleId} matched-before=${row.matchedBefore} matched-after=${row.matchedAfter}`,
    );
  }
  console.log("--- totals ---");
  console.log(`rules-before ${report.rulesBefore}`);
  console.log(`rules-after ${report.rulesAfter}`);
  console.log(`patterns-rewritten ${report.patternsRewritten}`);
  console.log(`rules-added ${report.rulesAdded}`);
  console.log(`assignments-before ${report.assignmentsBefore}`);
  console.log(`assignments-after ${report.assignmentsAfter}`);
  console.log(`broadened ${report.broadened.length}`);
  for (const ruleId of report.broadened) {
    console.log(`  broadened-rule ${ruleId}`);
  }
  console.log(`conflicts ${report.conflicts.length}`);
  for (const ruleId of report.conflicts) {
    console.log(`  conflict-rule ${ruleId}`);
  }
  for (const ruleId of report.acceptedConflicts) {
    console.log(`  accepted-conflict-rule ${ruleId}`);
  }
  console.log(`lost-assignments ${report.lostAssignments.length}`);
  for (const transactionId of report.lostAssignments) {
    console.log(`  lost-transaction ${transactionId}`);
  }
  console.log(`exit ${report.exitCode}`);
  return report.exitCode;
};

void main().then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  },
);
