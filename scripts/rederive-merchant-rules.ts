// THE INVOCATION POINT for the one-off re-derivation of merchant rule
// declarations (M3-P12, decision D-46, criterion 12.17).
//
//   npm run rederive:merchant-rules -- --expect-host <host> --expect-ref <ref>
//     --household <id> [--accept <ruleId,...>] [--dry-run]
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
// WHAT A BLOCKED RUN LEAVES BEHIND, said here rather than left to be
// discovered (fix round, findings HZ-M3P12-03 and CR-M3P12-08): NOTHING. The
// routine decides everything against an in-memory copy of the rule set and
// issues no write at all unless the run is clean, so a BLOCKED run leaves the
// database exactly as it was found and the printed report describes work that
// did NOT happen.
//
// AND WHAT A FAILED RUN LEAVES BEHIND, which is a different question with the
// same exit code and used to have a different answer (fix round two, finding
// CR2-M3P12-03). Exit 1 is also what the rejection handler sets, and the
// apply block used to be separate awaits with nothing around them, so a
// rejection partway through left some patterns rewritten, nothing inserted,
// no recompute run and no report printed at all. The whole write set now goes
// through ONE port member that the adapter runs inside a database
// transaction, so a failure anywhere rolls back every write that preceded it
// and the sentence above is true of a failed run as well. The recompute is
// deliberately outside that transaction: it writes interpretation output, it
// is idempotent, and re-running it alone is safe. That is what makes --accept usable: an operator runs,
// is blocked, reads the rule ids off a report of unapplied work, decides, and
// re-runs. The FIRST shape of this routine did the opposite, applying every
// non-blocking write and the full recompute before returning exit 1, so the
// report was about work already done.
//
// THE TARGET INTERLOCK (criterion 12.23, hazard H12.30). Before this command
// reads or writes ANYTHING it requires --expect-host AND --expect-ref, and it
// refuses unless the connection it would actually open matches both. There is
// no override, because an override would be a second assertion of the very
// thing being checked. The ref is not optional and a host match is not enough:
// the session pooler host is regional infrastructure shared by every project
// in the region, and in this fleet the ambient DATABASE_URL belongs to a
// different project of the owner's, with a working password, in that same
// region. See src/platform/db/target-guard.ts for where the ref lives in each
// endpoint shape and for the one accepted equivalence gap.
//
// --dry-run DECIDES AND WRITES NOTHING. It is threaded into the routine
// itself; it is not a substitution made here, which is what it used to be
// and what made the flag's name a lie.
//
// IT PRINTS NO PATTERN CONTENT. Rule ids, passes, bases, outcomes and
// counts only: this repository is public and a stored pattern is derived
// from a real statement's text.

import { householdId, userId, type HouseholdContext } from "@/platform/tenancy";
import { resolveDbEnv } from "@/platform/db/resolve-env";
import { assessRederiveTarget } from "@/platform/db/target-guard";
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
  // THE INTERLOCK RUNS FIRST, before the household argument is even read and before
  // any repository call. A refused run has read nothing and written nothing.
  const target = assessRederiveTarget(
    { DATABASE_URL: resolveDbEnv("DATABASE_URL") },
    { host: argument("expect-host"), projectRef: argument("expect-ref") },
  );
  if (!target.allowed) {
    console.error(`rederive-merchant-rules: ${target.reason}`);
    return 3;
  }
  console.log(`target guard: ${target.reason}`);

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

  // THE FLAG IS THREADED INTO THE ROUTINE, which is the only place that can
  // honour it (fix round, finding HZ-M3P12-02). It used to be handled HERE,
  // by substituting a no-op recompute, while the real repository was passed
  // unconditionally: --dry-run rewrote the patterns, inserted the rules and
  // skipped only the step that would have made the result visible.
  const report = await rederiveMerchantRules(
    context,
    {
      merchants: merchantRepository,
      recompute: (ctx) => recomputeInterpretation(ctx),
    },
    { acceptedRuleIds: accepted, dryRun },
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
  console.log(`already-namespaced ${report.alreadyNamespaced}`);
  console.log(
    `already-held-by-same-merchant-twin ${report.alreadyHeldBySameMerchantTwin.length}`,
  );
  for (const ruleId of report.alreadyHeldBySameMerchantTwin) {
    console.log(`  twin-holds-pattern-rule ${ruleId}`);
  }
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
  for (const lost of report.lostAssignments) {
    console.log(
      `  lost-transaction ${lost.transactionId} held-by-rule ${lost.ruleId}`,
    );
  }
  // ACCEPTED LOSSES ARE PRINTED AND COUNTED (finding CR-M3P12-01). They
  // leave the blocking decision and nothing else; a run that lost one of the
  // owner's namings with a person's consent must not read like a run that
  // lost nothing.
  console.log(
    `accepted-lost-assignments ${report.acceptedLostAssignments.length}`,
  );
  for (const lost of report.acceptedLostAssignments) {
    console.log(
      `  accepted-lost-transaction ${lost.transactionId} held-by-rule ${lost.ruleId}`,
    );
  }
  console.log(`promoted-on-one-row ${report.promotedOnOneRow.length}`);
  if (report.promotedOnOneRow.length > 0) {
    // WHAT THE COUNT MEANS, for the operator and not only for the code's
    // reader (fix round two, finding CR2-M3P12-06). These rules were promoted
    // on the evidence of a SINGLE transaction, so the account they now key on
    // is that one row's scraped value, and which of several account-shaped
    // tokens in a description the importer stored is a first-wins rule this
    // phase pins and does not answer.
    console.log(
      "  these were promoted on the evidence of ONE transaction each, so the account each now keys on is that single row's scraped value",
    );
  }
  for (const ruleId of report.promotedOnOneRow) {
    console.log(`  promoted-on-one-row-rule ${ruleId}`);
  }
  // WHETHER ANYTHING WAS WRITTEN AT ALL, said in one word rather than left
  // to be inferred from the exit code.
  console.log(`applied ${report.applied ? "yes" : "no"}`);
  if (!report.applied) {
    console.log(
      report.exitCode === 0
        ? "  nothing was written: this was a dry run"
        : "  nothing was written: the run is blocked, and the database is exactly as it was found",
    );
  }
  console.log(`exit ${report.exitCode}`);
  return report.exitCode;
};

void main().then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    // A DATABASE ERROR CARRIES THE FAILING ROW (fix round two, finding
    // CR2-M3P12-04). This handler printed error.message, and for a Prisma
    // query error that message embeds the driver's detail, which on a
    // constraint violation names the WHOLE FAILING ROW: the rule id, the
    // household id, the merchant id, the kind, THE PATTERN and the timestamp.
    // A pattern is derived from a real statement's text, this repository is
    // public, and this fleet's history is that such output reaches a note
    // before anyone thinks about it. So the message is not printed: the
    // error's kind and, for a Prisma error, its code, which is what an
    // operator needs to decide whether to re-run, and nothing else. The
    // detail is in the database log.
    const kind = error instanceof Error ? error.constructor.name : typeof error;
    const code =
      typeof error === "object" && error !== null && "code" in error
        ? String((error as { code: unknown }).code)
        : "none";
    console.error(
      `rederive-merchant-rules: the run failed. error kind ${kind}, code ${code}. The message is deliberately not printed: a database error can quote the failing row, and a stored pattern is derived from a real statement. Read the database log for the detail.`,
    );
    console.error(
      "  the rule writes are applied in ONE transaction, so a failure inside them wrote nothing and the table is as this run found it. Re-running is safe and converges: a rule an earlier attempt namespaced is left alone by the next.",
    );
    process.exitCode = 1;
  },
);
