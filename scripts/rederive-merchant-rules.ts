// THE INVOCATION POINT for the one-off re-derivation of merchant rule
// declarations (M3-P12, decision D-46, criterion 12.17).
//
//   npm run rederive:merchant-rules -- --expect-host <host> --expect-ref <ref>
//     [--expect-port <port>]
//     --household <id> [--accept <ruleId,...>]
//     [--accept-loss <ruleId:transactionId,...>] [--dry-run]
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
// same exit code and has TWO answers, not one (fix round two finding
// CR2-M3P12-03 for the first, fix round three finding CR3-M3P12-02 for the
// correction). This command has two failure surfaces and they leave the
// database in opposite states, so it reports them separately and exits with
// different codes.
//
//   EXIT 1, A FAILURE INSIDE THE RULE WRITES. The whole write set goes
//   through ONE port member the adapter runs inside a database transaction,
//   so a rejection there rolls back every write that preceded it and the
//   table is exactly as this run found it.
//
//   EXIT 4, A FAILURE AFTER THEM, WHICH MEANS THE RECOMPUTE. The rule writes
//   are COMMITTED and the table is NOT as this run found it: the declarations
//   are migrated and the interpretation output is stale, so the affected rows
//   show as unresolved until a recompute completes. The decision report is
//   printed before the failure is reported, so there is a record of what was
//   rewritten. THE FIX IS TO RE-RUN THIS COMMAND, never to roll the code
//   deploy back: a rolled-back deploy turns every migrated pattern into a
//   rule that matches nothing under the pre-deploy derivation.
//
// AN EARLIER SHAPE OF THIS FILE PRINTED THE FIRST SENTENCE FOR BOTH, which
// was false on the second path and invited exactly the rollback above.
//
// The recompute is outside the transaction deliberately: it writes
// interpretation output, it is idempotent, and re-running it alone is safe.
// A BLOCKED run, which is a different thing again, writes nothing at all:
// that is what makes --accept usable, since an operator runs, is blocked,
// reads the rule ids off a report of unapplied work, decides, and re-runs.
// The FIRST shape of this routine did the opposite, applying every
// non-blocking write and the full recompute before returning exit 1, so the
// report was about work already done.
//
// THIS COMMAND CANNOT BE POINTED AT A LOCAL DATABASE (fix round three,
// finding CR3-M3P12-05). The interlock below requires a project ref, and a
// local connection carries one in neither its username nor its host, so it is
// refused as unparseable. That is deliberate and criterion 12.23 buys it; the
// consequence to know before running this is that the write path's FIRST
// execution through this command is the deploy-time run itself. Its rehearsal
// lives in the application-level tests and in the Playwright spec that drives
// the adapter against a real database, not in a local invocation of this
// script.
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
import { resolveClientDbUrl } from "@/platform/db/resolve-env";
import { assessRederiveTarget } from "@/platform/db/target-guard";
import { recomputeInterpretation } from "@/modules/ledger/application";
import {
  RederiveRecomputeError,
  formatDecisionReport,
  merchantRepository,
  rederiveMerchantRules,
} from "@/modules/merchants/application";
import type {
  RederiveDependencies,
  RederiveReport,
} from "@/modules/merchants/application";

// EVERYTHING IMPURE main() TOUCHES, in one parameter with a production
// default (M3-P12 fix round four, CRITERIA finding CR4-M3P12-05). Before this,
// read process.argv and process.env directly and closed over the real
// repository, so it could not be called from a test, so the exit codes it
// returns were pinned only by a toContain over the file's own header comment:
// changing `return 4` to `return 1` left every assertion green while the
// header kept promising 4. A contract nothing can execute is prose.
export type RederiveMainDeps = {
  readonly argv: readonly string[];
  readonly databaseUrl: string | undefined;
  readonly merchants: RederiveDependencies["merchants"];
  readonly recompute: RederiveDependencies["recompute"];
};

const productionDeps = (): RederiveMainDeps => ({
  argv: process.argv,
  // THE STRING THE CLIENT WILL OPEN, not the one the Prisma CLI would
  // resolve (fix round three, finding CR3-M3P12-03). new PrismaClient()
  // reads process.env only, so the interlock reads process.env only.
  databaseUrl: resolveClientDbUrl(),
  merchants: merchantRepository,
  recompute: (context) => recomputeInterpretation(context),
});

const argumentIn = (argv: readonly string[], name: string): string | undefined => {
  const index = argv.indexOf(`--${name}`);
  if (index === -1) {
    return undefined;
  }
  return argv[index + 1];
};

// THE REPORT, PRINTED FROM ONE PLACE, so the recompute-failure path shows
// the same record a clean run shows (fix round three, finding
// CR3-M3P12-02). Before this the report was printed only after the routine
// RETURNED, so a failure left the operator an exit code and no record of
// which patterns had been rewritten.
const printReport = (report: RederiveReport): void => {
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
  // SUPERSEDED DECLARATIONS (fix round three, finding CR3-M3P12-01;
  // narrowed in fix round four, CRITERIA finding CR4-M3P12-03). An EXACT rule
  // pattern carries no namespace can never be applied again, because every
  // identity key carries a lowercase namespace and nothing uppercases into an
  // ASCII lowercase letter, so equality can never hold; and a namespaced rule
  // of the same kind for a DIFFERENT merchant already holds the pattern it
  // would have been rewritten to. It is dead rather than contested: the owner
  // chose the other merchant on the screen, and the deployed resolver has been
  // applying that choice since the code deployed. It is left in place, because
  // decision D-39 forbids deleting a declaration, and it is printed here so
  // the operator can see which declarations are now inert.
  //
  // ONLY EXACT RULES REACH THIS LIST. The impossibility above is about
  // equality and does not extend to a glob or a prefix, so a colliding PREFIX
  // or PATTERN rule of another merchant blocks as a conflict instead. Today's
  // table holds no rule of either kind, so this list is the whole story of the
  // owner's own migration.
  console.log(
    `superseded-by-namespaced-rule ${report.supersededByNamespacedRule.length}`,
  );
  // THE CLAIMANT IS NAMED BESIDE THE DEAD RULE (fix round five, hazard
  // finding HAZ5-1). The list used to print an id and leave the operator to
  // guess which declaration replaced it, and the same relationship is what
  // licenses the routine to dismiss a change of merchant as not a loss, so
  // it belongs where the operator can check it. Ids only, as everywhere here.
  const claimantOf = new Map(
    report.supersededBy.map((link) => [link.ruleId, link.claimantRuleId]),
  );
  for (const ruleId of report.supersededByNamespacedRule) {
    console.log(
      `  superseded-rule ${ruleId} superseded-by ${claimantOf.get(ruleId) ?? "unknown"}`,
    );
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
  // THE CLAIMANT-MERCHANT CLASS, printed under its own name and never folded
  // into the losses above (criterion 12.7, fix round six). A row here ended at
  // the merchant the CLAIMANT carries, through a rule outside the lineage, so
  // under the deployed code it already carried that merchant and nothing
  // moved. It is not a loss, it does not block, and a run reporting the two
  // under one name does not meet the criterion. Ids only, as everywhere here.
  console.log(
    `claimant-merchant-reports ${report.claimantMerchantReports.length}`,
  );
  if (report.claimantMerchantReports.length > 0) {
    console.log(
      "  these rows end at the merchant the claimant carries, reached by a rule outside the claimant's lineage. This is the ordinary shape of a group split across the two bases: nothing moved and nothing is lost, and it is listed so the operator can see it rather than infer it.",
    );
  }
  for (const report_ of report.claimantMerchantReports) {
    console.log(
      `  claimant-merchant-transaction ${report_.transactionId} held-by-rule ${report_.heldByRuleId} now-held-by-rule ${report_.nowHeldByRuleId}`,
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
};

export const main = async (
  deps: RederiveMainDeps = productionDeps(),
): Promise<number> => {
  const argument = (name: string): string | undefined =>
    argumentIn(deps.argv, name);
  // THE INTERLOCK RUNS FIRST, before the household argument is even read and before
  // any repository call. A refused run has read nothing and written nothing.
  const target = assessRederiveTarget(
    { DATABASE_URL: deps.databaseUrl },
    {
      host: argument("expect-host"),
      projectRef: argument("expect-ref"),
      // OPTIONAL (fix round four, hazard finding CR4-M3P12-02). Unnamed, the
      // port must be one of the two this product's own connection strings
      // use; named, it must match exactly.
      port: argument("expect-port"),
    },
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
  const dryRun = deps.argv.includes("--dry-run");
  const accepted = (argument("accept") ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value !== "");
  // A LOSS IS ACCEPTED BY THE PAIR, never by the rule (criterion 12.7, fix
  // round six). --accept clears a merchant-conflict, which is a property of a
  // RULE; --accept-loss clears one lost assignment, named as
  // <ruleId>:<transactionId>, because one rule can hold a real loss on one row
  // and an ordinary claimant-merchant report on another, and a flag that
  // cleared the rule would clear rows the person never saw.
  const acceptedLosses = (argument("accept-loss") ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value !== "")
    .map((pair) => {
      const separator = pair.indexOf(":");
      return separator === -1
        ? undefined
        : {
            ruleId: pair.slice(0, separator),
            transactionId: pair.slice(separator + 1),
          };
    })
    .filter(
      (pair): pair is { ruleId: string; transactionId: string } =>
        pair !== undefined && pair.ruleId !== "" && pair.transactionId !== "",
    );

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
  let report: RederiveReport;
  try {
    report = await rederiveMerchantRules(
      context,
      { merchants: deps.merchants, recompute: deps.recompute },
      { acceptedRuleIds: accepted, acceptedLosses, dryRun },
    );
  } catch (error: unknown) {
    if (!(error instanceof RederiveRecomputeError)) {
      throw error;
    }
    // THE RULE WRITES COMMITTED AND THE RECOMPUTE THEN FAILED (fix round
    // three, finding CR3-M3P12-02). The operator gets the record of what was
    // written, then the truth about the state, then the one action that is
    // correct. Nothing here prints a pattern or a database message.
    printReport(error.report);
    console.error(
      "rederive-merchant-rules: the rule writes COMMITTED and the recompute then failed.",
    );
    console.error(
      "  the table is NOT as this run found it: the declarations above are migrated and the interpretation output is stale, so the affected rows show as unresolved until a recompute completes.",
    );
    console.error(
      "  RE-RUN THIS COMMAND. Do not roll the code deploy back: under the pre-deploy derivation every migrated pattern matches nothing. Re-running is safe and converges, because a rule an earlier attempt namespaced is left alone by the next.",
    );
    return 4;
  }

  printReport(report);
  console.log(`exit ${report.exitCode}`);
  return report.exitCode;
};

// RUN ONLY WHEN THIS FILE IS THE ENTRY POINT. main() is exported so a test
// can drive its exit codes; without this check, importing it would start a
// run against whatever the importing process's environment holds.
const invokedDirectly =
  process.argv[1] !== undefined &&
  /rederive-merchant-rules\.[cm]?ts$/.test(process.argv[1]);

if (invokedDirectly) {
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
    // THIS PATH IS EVERYTHING EXCEPT A RECOMPUTE FAILURE, which main() catches
    // and reports separately with exit 4 (fix round three, finding
    // CR3-M3P12-02). Every failure that reaches here happened before or
    // inside the rule writes, and the rule writes are one transaction, so the
    // sentence below is true here and only here.
    console.error(
      "  the failure was before or inside the rule writes. Those are applied in ONE transaction, so nothing was written and the table is as this run found it. Re-running is safe and converges: a rule an earlier attempt namespaced is left alone by the next.",
    );
    process.exitCode = 1;
  },
);
}
