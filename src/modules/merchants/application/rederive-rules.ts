// THE ONE-OFF RE-DERIVATION OF MERCHANT RULE DECLARATIONS (M3-P12, decision
// D-45). The counterparty identity changed what a rule is written against,
// and the stability contract at the head of domain/normalise-counterparty.ts
// says plainly what that owes: any change to what a stored pattern is
// compared against MUST ship, in the same change, a re-derivation of the
// stored patterns or an explicit decision to version the recipe instead.
// M3-P6 discharged that contract by measuring ZERO rule rows in the deployed
// database. That discharge is STALE: the deployed table now holds rules, so
// this phase owes the migration itself.
//
// IT ADDS. IT NEVER REWRITES A DECLARATION INTO A DIFFERENT ONE, AND IT
// DELETES NOTHING, EVER (decision D-39). Two passes, and the split is the
// whole design.
//
// IT DECIDES BEFORE IT WRITES, AND THAT IS THE SHAPE OF THE WHOLE ROUTINE
// (fix round, finding HZ-M3P12-03). Both passes run against an in-memory
// working copy of the rule set and record the writes they would make; the
// superset test, the conflicts and the exit code are computed against that
// copy; and only then, if the run is neither BLOCKED nor a DRY RUN, are the
// updates, the inserts and the recompute issued. The first shape of this
// routine wrote as it went and computed its blocking conditions afterwards,
// so exit 1 was a report about work already applied and the acknowledge path
// could not be used first: the only way to learn which rule ids to accept
// was a run that had already applied the loss. A blocked run now leaves the
// database exactly as it found it.
//
// PASS ONE is MECHANICAL, TOTAL over the rules it applies to, and consults
// no transaction. Every rule whose pattern does not already begin with a
// known namespace has its pattern rewritten to the descriptor namespace
// followed by its old pattern. It is MEANING-PRESERVING FOR ALL THREE KINDS
// AT ONCE, because the namespace is a constant prefix on BOTH sides of the
// comparison: an EXACT rule still matches exactly what it matched; a PREFIX
// rule does too, since ("descriptor:" + K).startsWith("descriptor:" + P)
// holds precisely when K.startsWith(P); and a PATTERN rule does too, since
// the glob is anchored at both ends. A property test over generated pairs
// asserts it for every kind (criterion 12.21).
//
// TWO RULES ARE LEFT ALONE BY PASS ONE and both are reachable on the FIRST
// run, not only on a second one:
//
//   A rule that ALREADY CARRIES A NAMESPACE. This is not hypothetical: the
//   code deploys before this routine runs (decision D-46), and assignMerchant
//   writes a namespaced subject from the moment it does, so a naming made
//   inside that window already carries one. Namespacing it twice would
//   produce "descriptor:descriptor:X" and kill a CORRECT rule on the first
//   run, where a second-run comparison would never see it (hazard H12.25).
//
//   A rule whose pattern is the EMPTY STRING. The bare namespace is
//   non-empty, so a PREFIX rule carrying it would match EVERY descriptor
//   key, where the empty pattern it replaced is inert under the matcher's
//   own filter. assignMerchant guards the empty subject; upsertRule does
//   not, so an empty pattern can exist (hazard H12.26).
//
// PASS TWO is PROMOTION. It is the only pass that reads facts, the only one
// that can BROADEN, and it is PURELY ADDITIVE. Where every transaction the
// old pattern matched carries a TRUSTED account and they all carry the SAME
// one, it ADDS an account-basis rule pointing at the SAME merchant and
// LEAVES the descriptor rule pass one produced exactly where it is.
//
// THE DESCRIPTOR RULE THAT REMAINS IS A LIVE FALLBACK, NOT DEAD WEIGHT. It
// is the only thing that keeps a row of that same counterparty whose account
// FAILED the trust gate, or which carries no account at all, attached to the
// merchant the owner named. The two can never both fire on one key, because
// one begins with the account namespace and the other with the descriptor
// namespace, so the matcher's tie-break is never reached between them.
//
// A DRY RUN IS A REAL DRY RUN (fix round, finding HZ-M3P12-02). `dryRun`
// decides everything, writes nothing and recomputes nothing, and returns the
// report a real run would return. The flag used to exist only in the script,
// where it substituted a no-op recompute and left both write paths untouched,
// so a person previewing the migration against the owner's live database
// performed it and left the rows un-recomputed on top.
//
// REVERSIBILITY IS STRUCTURAL AND RESTS ON NO FILE. Pass one's rewrite is
// invertible by stripping a constant prefix and pass two only adds, so a run
// is undone by deleting the rules it added and stripping the namespace from
// the rest. An earlier design rested this on a timestamped file the routine
// wrote beside itself; that file cannot be kept, because the routine runs
// against the deployed database from an ephemeral container and the file
// would be DATA that a public repository must never hold.

import type { HouseholdContext } from "@/platform/tenancy";
import {
  ACCOUNT_NAMESPACE,
  DESCRIPTOR_NAMESPACE,
  compactAccount,
  counterpartyIdentity,
  identityBasisOfKey,
  isTrustedCounterpartyAccount,
} from "../domain/counterparty-identity";
import { matchRules, type MerchantRuleLike } from "../domain/merchant-rule";
import {
  counterpartyText,
  normaliseCounterparty,
} from "../domain/normalise-counterparty";
import type {
  CountedTransaction,
  MerchantRepositoryPort,
  RecomputeInterpretation,
} from "./ports";

// THE ERROR A RECOMPUTE FAILURE THROWS, and why it is its own type (fix
// round three, findings CR3-M3P12-02 and CR3-M3P12-01 of the criteria lane).
// The rule writes go through one port member the adapter runs in a database
// transaction; the recompute runs AFTER it and outside it, deliberately. So
// there are two failure sources with two opposite answers to the only
// question an operator has, and the command's rejection handler could not
// tell them apart: it printed, for both, that the table is as the run found
// it. After a recompute failure that sentence is false in both halves, and
// the action a false "nothing happened" invites is rolling the code deploy
// back, which is the one action that turns every migrated pattern into a rule
// that matches nothing under the pre-deploy derivation.
//
// The error therefore carries the fact that the writes COMMITTED and the
// report describing exactly what was written, so the operator gets the record
// rather than an exit code and a false sentence.
export class RederiveRecomputeError extends Error {
  readonly writesCommitted = true;
  readonly report: RederiveReport;

  constructor(report: RederiveReport, cause: unknown) {
    super("the rule writes committed and the recompute then failed", { cause });
    this.name = "RederiveRecomputeError";
    this.report = report;
  }
}

export type RederivePass = "one" | "two";

export type RederiveOutcomeKind =
  // Pass one. ONE token covers both the rule this run namespaced and the
  // rule that already carried the descriptor namespace, and that is forced
  // rather than sloppy: criterion 12.8 requires the decision report to be
  // BYTE-IDENTICAL across runs, and on the second run every rule the first
  // run namespaced is one that already carries the namespace. The report
  // therefore states the RESULTING STATE; whether this run put the rule in
  // that state is the `patternsRewritten` counter beside it, which is 0 on a
  // second run and is what makes "already migrated" visible.
  | "descriptor-namespaced"
  | "empty-pattern-left-alone"
  // A SAME-MERCHANT TWIN ALREADY HOLDS THE TARGET PATTERN (fix round two,
  // findings CR2-M3P12-02 and HZ-M3P12-R2-01). The declaration table's key is
  // (householdId, kind, pattern), so rewriting this rule's pattern would
  // collide with a live rule of the same kind that already carries it. When
  // that rule belongs to a DIFFERENT merchant it is a genuine ambiguity and
  // blocks; when it belongs to the SAME merchant there is no ambiguity at
  // all, because the two rules already say the same thing about the same
  // merchant. The rewrite is redundant, so it is not made. The source rule is
  // left exactly as it is, which loses nothing: every row it reached under
  // the old key is reached by the twin under the new one, and the superset
  // test proves that rather than assuming it. Deleting it is forbidden
  // (decision D-39).
  //
  // THIS IS THE SHAPE DECISION D-46's DEPLOY WINDOW INVITES. The code deploys
  // before this routine runs, the owner's pre-migration rules match nothing
  // and their rows show as unresolved, so the owner names those groups again;
  // findMerchantByName reuses the merchant, and a namespaced EXACT rule lands
  // beside the old un-namespaced one for the same merchant.
  | "already-held-by-same-merchant-twin"
  // The same structural fact with a DIFFERENT merchant on the claiming rule
  // (fix round three, finding CR3-M3P12-01). It is NOT a conflict a person
  // must settle. A rule whose pattern carries no namespace can never be
  // applied again by the shipped matcher, because every key it is handed
  // carries a lowercase namespace and normaliseCounterparty emits no
  // lowercase letter: the namespaced rule is what the deployed resolver has
  // been applying since the code deployed, whatever merchant it points at,
  // and the un-namespaced one is already dead. Calling that a conflict
  // blocked the whole migration on a decision the owner had already made on
  // the screen, and reported a LOST assignment for a row that in production
  // carries the owner's current merchant and never carried the old one.
  | "superseded-by-namespaced-rule"
  // Pass two.
  //
  // WHAT "promoted" MEANS, said because a reviewer read it as "a rule was
  // inserted on this run" and that is not what it says (fix round five,
  // CRITERIA finding CR5-M3P12-11, and see the deviation this phase records
  // against that finding). It means: after this run, this rule's naming is
  // expressed in the account key space. Sometimes that took an insert and
  // sometimes the pattern was already held by a rule of the same merchant and
  // nothing needed writing. THE TWO CANNOT BE DISTINGUISHED IN THIS TOKEN
  // without breaking criterion 12.8, whose whole content is that a second run
  // prints the report of the first BYTE FOR BYTE: run two always finds the
  // rule run one inserted, so a token that separated the cases would differ
  // between the two runs by construction. HOW MANY RULES A RUN ACTUALLY ADDED
  // is reported, on its own line, as rules-added.
  | "promoted"
  // A promotion whose whole evidence is ONE row (fix round, finding
  // HZ-M3P12-06). It is still a promotion, and the reason it is not refused
  // is the owner's own case: their deployed naming is a single EXACT rule
  // written from one row, so a two-row floor would decline to promote the
  // one declaration this phase exists to carry. What was wrong was that it
  // was INVISIBLE: the same-account test is vacuous over one row, and a
  // one-row rule promoted to a one-row account key reports matchedBefore
  // equal to matchedAfter, so it landed in no broadened list and no report
  // line distinguished it from a promotion several agreeing rows support.
  // The account it keys on is whatever the first-wins scrape stored for that
  // single row, and hazard H12.16 records that choice as unanswered, so this
  // token is what turns a parked READ question into a visible WRITE.
  | "promoted-on-one-row"
  | "not-promoted-no-matching-rows"
  | "not-promoted-untrusted-account"
  | "not-promoted-several-accounts"
  // Either pass, blocking unless accepted.
  | "merchant-conflict"
  | "merchant-conflict-accepted";

// One line of the DECISION REPORT (criterion 12.8). Rule id, the pass that
// touched it, the basis the resulting pattern has, and the outcome. The
// matched counts are deliberately NOT part of this record: on a second run a
// rule's old pattern is the pattern the first run wrote, so for any rule
// whose rows split across the two bases the counts legitimately differ while
// the decision does not (hazard H12.27).
export type RuleDecision = {
  readonly ruleId: string;
  readonly pass: RederivePass;
  readonly basis: "account" | "descriptor";
  readonly outcome: RederiveOutcomeKind;
};

export type RuleCounts = {
  readonly ruleId: string;
  readonly matchedBefore: number;
  readonly matchedAfter: number;
};

// A transaction that carried a merchant before the run and does not carry
// the SAME one after it. The rule id is the one that HELD the assignment,
// because that is what a person accepts: acceptance is per declaration.
export type LostAssignment = {
  readonly transactionId: string;
  readonly ruleId: string;
};

export type RederiveReport = {
  readonly decisions: readonly RuleDecision[];
  readonly counts: readonly RuleCounts[];
  readonly rulesBefore: number;
  readonly rulesAfter: number;
  readonly patternsRewritten: number;
  readonly alreadyNamespaced: number;
  readonly rulesAdded: number;
  readonly broadened: readonly string[];
  readonly conflicts: readonly string[];
  readonly acceptedConflicts: readonly string[];
  readonly lostAssignments: readonly LostAssignment[];
  // ACCEPTED LOSSES ARE PRINTED, COUNTED AND NAMED (fix round, finding
  // CR-M3P12-01). They were filtered out of lostAssignments and put nowhere,
  // so a run in which a person deliberately accepted losing one of the
  // owner's namings printed lost-assignments 0 and was byte-indistinguishable
  // from a run that lost nothing. Acceptance removes an assignment from the
  // BLOCKING decision and from nothing else.
  readonly acceptedLostAssignments: readonly LostAssignment[];
  // Rules promoted on the evidence of exactly one row (finding HZ-M3P12-06).
  readonly promotedOnOneRow: readonly string[];
  // Rules pass one left alone because a same-merchant twin already holds the
  // pattern they would have been rewritten to (fix round two).
  readonly alreadyHeldBySameMerchantTwin: readonly string[];
  // Rules pass one left alone because a namespaced rule of the same kind for
  // a DIFFERENT merchant already holds the pattern they would have been
  // rewritten to (fix round three). Printed and counted, never blocking.
  // EXACT ONLY (fix round four, CRITERIA finding CR4-M3P12-03): the argument
  // a rule is dead is an argument about EQUALITY, and a colliding PREFIX or
  // PATTERN rule of another merchant blocks as a conflict instead.
  readonly supersededByNamespacedRule: readonly string[];
  // THE LINEAGE THE LOSS EXEMPTION RESTS ON, published rather than kept
  // private (fix round five, hazard finding HAZ5-1). Ids only, never a
  // pattern. Two relations, and between them they say why any dismissed
  // claim was dismissed:
  //
  //   supersededBy: the dead rule, and the namespaced rule that already held
  //   the pattern it would have been rewritten to.
  //
  //   promotedFrom: a rule that now carries an account-basis promotion, and
  //   the descriptor rule the promotion was made from. For a promotion this
  //   run INSERTED, ruleId is the placeholder `pending-<n>`, where n is the
  //   one-based index of that insert in the batch handed to applyRuleWrites,
  //   in that order. It is not a database id and must not be used as one.
  readonly supersededBy: readonly {
    readonly ruleId: string;
    readonly claimantRuleId: string;
  }[];
  readonly promotedFrom: readonly {
    readonly ruleId: string;
    readonly sourceRuleId: string;
  }[];
  // Whether the writes this report describes were ISSUED. False on a dry run
  // and false on a blocked run, which are the only two ways a report can
  // describe work that did not happen.
  readonly applied: boolean;
  readonly assignmentsBefore: number;
  readonly assignmentsAfter: number;
  readonly exitCode: number;
};

export type RederiveDependencies = {
  readonly merchants: Pick<
    MerchantRepositoryPort,
    | "listRules"
    | "listCountedTransactions"
    | "upsertRule"
    | "applyRuleWrites"
  >;
  readonly recompute: RecomputeInterpretation;
};

export type RederiveInput = {
  // Rule ids whose merchant-conflict or lost assignment a PERSON has seen
  // and accepted. It clears exactly the ids it names and nothing else.
  readonly acceptedRuleIds?: readonly string[];
  // A REAL DRY RUN (fix round, finding HZ-M3P12-02). Decide everything,
  // write nothing, recompute nothing, and return the report a real run would
  // return. The flag used to live only in the script, where it swapped the
  // recompute dependency for a no-op and left both write paths untouched, so
  // a person previewing the migration against the owner's live database
  // migrated it. It is threaded to the write paths here because that is the
  // only place that can honour it.
  readonly dryRun?: boolean;
};

// The key a rule was WRITTEN against before this phase: the whole normalised
// counterparty text. Pass two's "which rows did this rule match" question is
// asked against this key, because that is what the rule was matching when
// the owner wrote it.
const baselineKey = (row: CountedTransaction): string =>
  normaliseCounterparty(counterpartyText(row));

const identityKey = (row: CountedTransaction): string =>
  counterpartyIdentity(row).key;

const matchedBy = (
  rule: MerchantRuleLike,
  rows: readonly CountedTransaction[],
  key: (row: CountedTransaction) => string,
): readonly CountedTransaction[] =>
  rows.filter((row) => matchRules(key(row), [rule]) !== undefined);

// WHICH KEY A STORED RULE IS ACTUALLY WRITTEN AGAINST (fix round two,
// finding HZ-M3P12-R2-03). The before-set used to be computed with the
// BASELINE key for every rule, which is right on the FIRST run and dead on
// every run after it: once a pattern carries a namespace it can never match a
// bare key, because EXACT compares unequal, a PREFIX cannot start with a
// longer string and a PATTERN glob is anchored. So the before-set came back
// EMPTY, the lost-assignment set was empty by construction, and the
// lost-assignment half of the exit code could not be reached at all, while
// the run still wrote and still recomputed. A guard that reports safe by
// construction is worse than no guard, because the operator is told it
// checked. It matters on a table that is NOT in the clean post-run state the
// routine assumes: a partially migrated one, or a hand-edited one.
const keyForRule = (rule: MerchantRuleLike): ((row: CountedTransaction) => string) =>
  identityBasisOfKey(rule.pattern) === undefined ? baselineKey : identityKey;

// EXPORTED FOR THE PROPERTY TEST (fix round five, hazard finding HAZ5-1),
// with the identity key beside it. The property that keeps the loss
// exemption honest has to ask, of a generated world, which merchant each row
// carried before the run and which it carries after, and it must ask that
// question the way the routine asks it or the two are not comparing the same
// thing. This function's own correctness is pinned separately by the
// half-migrated-table cases (finding HZ-M3P12-R2-03); what the property tests
// is the exemption, which is the part that has been rewritten three times.
export const identityKeyOfRow = identityKey;

export const assignmentSet = (
  rows: readonly CountedTransaction[],
  rules: readonly MerchantRuleLike[],
  key?: (row: CountedTransaction) => string,
): ReadonlyMap<string, { merchantId: string; ruleId: string }> => {
  const pairs = new Map<string, { merchantId: string; ruleId: string }>();
  for (const row of rows) {
    // EACH RULE UNDER ITS OWN KEY when no single key is imposed, so a table
    // holding both migrated and un-migrated patterns is read correctly rather
    // than reported empty. The tie-break is the matcher's own: the most
    // specific declaration wins, so the candidates are collected and handed
    // to matchRules together per key space.
    const match =
      key === undefined
        ? matchRules(baselineKey(row), rules.filter((r) => keyForRule(r) === baselineKey)) ??
          matchRules(identityKey(row), rules.filter((r) => keyForRule(r) === identityKey))
        : matchRules(key(row), rules);
    if (match !== undefined) {
      pairs.set(row.id, { merchantId: match.merchantId, ruleId: match.ruleId });
    }
  }
  return pairs;
};

export const rederiveMerchantRules = async (
  context: HouseholdContext,
  deps: RederiveDependencies,
  input: RederiveInput = {},
): Promise<RederiveReport> => {
  const accepted = new Set(input.acceptedRuleIds ?? []);
  const before = await deps.merchants.listRules(context);
  const rows = await deps.merchants.listCountedTransactions(context);
  // ONLY COUNTED ROWS, and the reason is not convenience: interpretation
  // resolves a merchant for INCOME and SPEND rows and for nothing else, so a
  // counted row is the only kind a rule can ever reach. Widening this read
  // would change no decision and would count rows no assignment can land on.
  // ---- LINEAGE --------------------------------------------------------
  // WHICH RULE SUPERSEDED WHICH, AND WHICH RULE CARRIES WHOSE PROMOTION.
  //
  // These two maps replace a bare Set of superseded ids (fix round five,
  // hazard finding HAZ5-1), and the replacement is the point rather than a
  // refactor. The loss exemption has been rewritten three times, each time as
  // a boolean short-circuit reacting to the last counterexample: round two
  // reported false losses, round three hid real ones by dropping the rule
  // from the before-set, round four asked only "is the row covered by
  // ANYTHING afterwards" and thereby hid a silent REASSIGNMENT to a merchant
  // no one in the relationship names. A predicate phrased as "is there any
  // subsequent coverage" cannot be right, because the supersede argument is
  // not about coverage in general: it is about ONE relationship, between the
  // dead rule and the namespaced rule that took its pattern.
  //
  // So the relationship itself is recorded where it is known, and the
  // exemption asks whether the row's eventual coverage DESCENDS FROM IT. That
  // is decidable from the lineage alone and needs no case analysis, which is
  // what makes it correct by construction rather than correct against three
  // witnesses.
  //
  // supersededByClaimant: the dead rule's id, to the id of the namespaced
  // rule of the same kind that already held the pattern it would have been
  // rewritten to. Filled in pass one, which is the only place a claimant is
  // identified, and read when the before-set is compared AFTER pass two.
  const supersededByClaimant = new Map<string, string>();
  // promotionSource: the id of a rule that now carries an account-basis
  // promotion, to the id of the descriptor rule the promotion was made FROM.
  // Both outcomes are recorded, because both are the source rule's naming
  // expressed in the account key space: a promotion this run INSERTS, and a
  // pre-existing rule of the same merchant that already held the pattern and
  // therefore made the insert unnecessary. Pass two matches under the OLD
  // key, so a promotion made from a claimant can and does cover rows the
  // superseded rule used to claim, which is exactly why one link is not
  // enough and the exemption has to follow a chain.
  const promotionSource = new Map<string, string>();
  // The rule a row's coverage ultimately descends from: itself, unless it is
  // carrying somebody's promotion.
  const lineageRoot = (ruleId: string): string =>
    promotionSource.get(ruleId) ?? ruleId;

  const decisions: RuleDecision[] = [];
  const counts: RuleCounts[] = [];
  const conflicts: string[] = [];
  const acceptedConflicts: string[] = [];
  const broadened: string[] = [];
  const promotedOnOneRow: string[] = [];
  const alreadyHeldBySameMerchantTwin: string[] = [];
  const supersededByNamespacedRule: string[] = [];
  let patternsRewritten = 0;
  let alreadyNamespaced = 0;
  let rulesAdded = 0;

  // DECIDE FIRST, APPLY LAST (fix round, finding HZ-M3P12-03). Both passes
  // used to issue their writes as they went and the routine computed its
  // blocking conditions afterwards, so the exit code was a report about work
  // already done: a run that DETECTED a lost assignment had already rewritten
  // the patterns, added the rules and run the recompute that put the wrong
  // merchant on the row. "Blocking" named nothing, and the acknowledge path
  // could not be used first, because the only way to learn which ids to
  // accept was a run that had already applied the loss.
  //
  // Every write is therefore recorded here and issued at the very end, and
  // only when the run is neither blocked nor a dry run. The in-memory
  // working copy below is what the passes read and write instead, so the
  // report is identical to what a real run produces either way.
  const pendingUpdates: { ruleId: string; pattern: string }[] = [];
  const pendingInserts: {
    merchantId: string;
    kind: MerchantRuleLike["kind"];
    pattern: string;
  }[] = [];

  // A working copy of the rule set, so the two passes see each other's
  // effects and so conflicts are decided against the state that will exist.
  const working: { id: string; merchantId: string; kind: MerchantRuleLike["kind"]; pattern: string }[] =
    before.map((rule) => ({ ...rule }));

  const claimant = (
    kind: MerchantRuleLike["kind"],
    pattern: string,
    exceptRuleId: string,
  ): { id: string; merchantId: string } | undefined =>
    working.find(
      (rule) =>
        rule.id !== exceptRuleId &&
        rule.kind === kind &&
        rule.pattern === pattern,
    );

  // ---- PASS ONE -------------------------------------------------------
  for (const rule of before) {
    const entry = working.find((candidate) => candidate.id === rule.id);
    if (entry === undefined) {
      continue;
    }
    const existingBasis = identityBasisOfKey(rule.pattern);
    // AN ACCOUNT-NAMESPACED PATTERN IS NOT A PASS-ONE CANDIDATE AT ALL and
    // is not reported as one: pass one moves a pattern INTO the descriptor
    // namespace, and this pattern is already final. Criterion 12.7 asserts
    // the routine issues no UPDATE and no DELETE against one, and reporting
    // a decision here would report a decision that was never available. It
    // is also what keeps the report byte-identical across runs, since every
    // rule pass two added on the first run is account-namespaced on the
    // second.
    if (existingBasis === "account") {
      alreadyNamespaced += 1;
      continue;
    }
    if (existingBasis === "descriptor") {
      // LEFT EXACTLY AS IT IS (hazard H12.25). Namespacing it again would
      // produce a doubled namespace and kill a CORRECT rule, and the case is
      // reachable on the FIRST run: the code deploys before this routine
      // runs, so a naming made in that window already carries a namespace.
      alreadyNamespaced += 1;
      decisions.push({
        ruleId: rule.id,
        pass: "one",
        basis: "descriptor",
        outcome: "descriptor-namespaced",
      });
      continue;
    }
    if (rule.pattern === "") {
      decisions.push({
        ruleId: rule.id,
        pass: "one",
        basis: "descriptor",
        outcome: "empty-pattern-left-alone",
      });
      continue;
    }
    const newPattern = `${DESCRIPTOR_NAMESPACE}${rule.pattern}`;
    const collision = claimant(rule.kind, newPattern, rule.id);
    // A CLAIMANT MEANS THIS RULE IS ALREADY SUPERSEDED, WHICHEVER MERCHANT
    // THE CLAIMANT CARRIES (fix round two for the same-merchant half, fix
    // round three for the rest, finding CR3-M3P12-01).
    //
    // WHY THE CLAIMANT IS ALWAYS A PRE-EXISTING NAMESPACED RULE, which is
    // what makes one treatment correct for both cases: the table's unique key
    // is (householdId, kind, pattern), so no two rules of one kind share a
    // bare pattern, so no rule pass one rewrote EARLIER in this same run can
    // be holding this rule's target pattern. The claimant existed before the
    // run, already namespaced, which is the shape decision D-46's deploy
    // window produces when the owner names a group again.
    //
    // AN EXACT SOURCE RULE IS DEAD, not contested, AND A PREFIX OR PATTERN
    // ONE IS NOT. Corrected in fix round four under CRITERIA finding
    // and corrected loudly, because the sentence that stood here claimed an
    // impossibility that a reviewer disproved against the shipped matcher.
    //
    // WHAT IT USED TO SAY: "The shipped matcher can never apply an
    // un-namespaced pattern again: every key carries a lowercase namespace,
    // EXACT is equality, and PREFIX and PATTERN would need a pattern that is
    // a strict prefix of a lowercase namespace, which the uppercasing
    // normaliser cannot emit."
    //
    // THE HALF THAT HOLDS, and it was verified exhaustively rather than
    // sampled: over every Unicode code point, none uppercases into a string
    // containing an ASCII lowercase letter, and none survives the shipped
    // normaliser as one. So a bare pattern can never EQUAL a namespaced key,
    // and an EXACT rule holding one is dead by construction.
    //
    // THE HALF THAT IS FALSE: a glob is not required to be a prefix of
    // anything. Witnessed against the shipped matcher, a PATTERN rule whose
    // pattern begins with a star matches a namespaced key, and a bare star
    // matches every key of every basis; a PREFIX rule whose pattern is a
    // prefix of the NAMESPACE itself matches too. Neither needs a pattern the
    // normaliser could emit, and merchant-rule.ts says in as many words that
    // PREFIX and PATTERN exist for rules written by hand.
    //
    // SO THE TREATMENT SPLITS ON KIND rather than resting on a claim that
    // covers only one of them. An EXACT collision is recorded as superseded
    // and left in place, because decision D-39 forbids deleting a declaration
    // and blocking on a dead row would stop a migration for nothing. A
    // PREFIX or PATTERN collision is NOT assumed dead: for the same merchant
    // it is still a skip, since no assignment can change hands between one
    // merchant and itself, and for a different merchant it BLOCKS with the
    // ordinary conflict outcome and the ordinary acknowledge path, which is
    // what a live rule whose target pattern another merchant holds deserves.
    //
    // THIS IS A MEASURED FACT ABOUT TODAY'S TABLE, not a structural one:
    // assignMerchant writes EXACT and only EXACT, so the deployed declaration
    // holds no row of either other kind and the split changes nothing about
    // the owner's own migration. The day a PREFIX rule is written, the
    // conservative branch is the one that runs.
    if (collision !== undefined) {
      const sameMerchant = collision.merchantId === rule.merchantId;
      if (sameMerchant) {
        // Safe for every kind: the claimant carries the same merchant, so
        // whether the source rule is dead or live, no row can change hands.
        if (rule.kind === "EXACT") {
          supersededByClaimant.set(rule.id, collision.id);
        }
        alreadyHeldBySameMerchantTwin.push(rule.id);
        decisions.push({
          ruleId: rule.id,
          pass: "one",
          basis: "descriptor",
          outcome: "already-held-by-same-merchant-twin",
        });
        continue;
      }
      if (rule.kind === "EXACT") {
        supersededByClaimant.set(rule.id, collision.id);
        supersededByNamespacedRule.push(rule.id);
        decisions.push({
          ruleId: rule.id,
          pass: "one",
          basis: "descriptor",
          outcome: "superseded-by-namespaced-rule",
        });
        continue;
      }
      const isAccepted = accepted.has(rule.id);
      (isAccepted ? acceptedConflicts : conflicts).push(rule.id);
      decisions.push({
        ruleId: rule.id,
        pass: "one",
        basis: "descriptor",
        outcome: isAccepted ? "merchant-conflict-accepted" : "merchant-conflict",
      });
      continue;
    }
    const matchedBefore = matchedBy(rule, rows, baselineKey).length;
    pendingUpdates.push({ ruleId: rule.id, pattern: newPattern });
    entry.pattern = newPattern;
    patternsRewritten += 1;
    const matchedAfter = matchedBy(
      { ...rule, pattern: newPattern },
      rows,
      identityKey,
    ).length;
    counts.push({ ruleId: rule.id, matchedBefore, matchedAfter });
    if (matchedAfter > matchedBefore) {
      broadened.push(rule.id);
    }
    decisions.push({
      ruleId: rule.id,
      pass: "one",
      basis: "descriptor",
      outcome: "descriptor-namespaced",
    });
  }

  // ---- PASS TWO -------------------------------------------------------
  // Snapshot the descriptor rules pass one left, so a rule ADDED here is
  // never itself considered for promotion.
  const promotable = working
    .filter((rule) => rule.pattern.startsWith(DESCRIPTOR_NAMESPACE))
    .map((rule) => ({ ...rule }));

  for (const rule of promotable) {
    // The rows the rule matched under the OLD key: what the owner's naming
    // was actually reaching when they made it.
    const bare = { ...rule, pattern: rule.pattern.slice(DESCRIPTOR_NAMESPACE.length) };
    const matched = matchedBy(bare, rows, baselineKey);
    const matchedBefore = matched.length;
    if (matchedBefore === 0) {
      decisions.push({
        ruleId: rule.id,
        pass: "two",
        basis: "descriptor",
        outcome: "not-promoted-no-matching-rows",
      });
      continue;
    }
    const trusted = matched.every((row) =>
      isTrustedCounterpartyAccount(row.counterpartyAccount),
    );
    if (!trusted) {
      decisions.push({
        ruleId: rule.id,
        pass: "two",
        basis: "descriptor",
        outcome: "not-promoted-untrusted-account",
      });
      continue;
    }
    const accounts = new Set(
      matched.map((row) => compactAccount(row.counterpartyAccount ?? "")),
    );
    if (accounts.size !== 1) {
      decisions.push({
        ruleId: rule.id,
        pass: "two",
        basis: "descriptor",
        outcome: "not-promoted-several-accounts",
      });
      continue;
    }
    const [account] = [...accounts];
    const accountPattern = `${ACCOUNT_NAMESPACE}${account ?? ""}`;
    // A promotion is always EXACT: an account-basis key admits no prefix and
    // no glob (decision D-40), so writing either kind here would be writing
    // a rule the matcher refuses to apply.
    const collision = claimant("EXACT", accountPattern, rule.id);
    if (collision !== undefined && collision.merchantId !== rule.merchantId) {
      const isAccepted = accepted.has(rule.id);
      (isAccepted ? acceptedConflicts : conflicts).push(rule.id);
      decisions.push({
        ruleId: rule.id,
        pass: "two",
        basis: "account",
        outcome: isAccepted ? "merchant-conflict-accepted" : "merchant-conflict",
      });
      continue;
    }
    if (collision === undefined) {
      pendingInserts.push({
        merchantId: rule.merchantId,
        kind: "EXACT",
        pattern: accountPattern,
      });
      // The id is a placeholder because the real one is only known once the
      // insert is issued. It is NOT private any more: assignmentsAfter is
      // keyed on it, the lineage below names it, and the report publishes it,
      // so the correspondence is part of the contract. It is
      // `pending-<n>` where n is the ONE-BASED index of the insert in the
      // batch handed to applyRuleWrites, in that same order. Nothing may
      // treat it as a database id.
      const promotedRuleId = `pending-${pendingInserts.length}`;
      working.push({
        id: promotedRuleId,
        merchantId: rule.merchantId,
        kind: "EXACT",
        pattern: accountPattern,
      });
      promotionSource.set(promotedRuleId, rule.id);
      rulesAdded += 1;
    } else {
      // NO INSERT, BUT STILL THIS RULE'S PROMOTION. Control only reaches here
      // when the existing holder carries the SAME merchant, because a
      // different one took the conflict branch above. That existing rule is
      // the source rule's naming already recorded in the account key space,
      // which is precisely why the insert is unnecessary, so it belongs to
      // the source rule's lineage exactly as an inserted one would. Leaving
      // it out would make the exemption depend on whether the owner happened
      // to have named the account group already.
      //
      // TWO SOURCES CAN LAND ON ONE HOLDER, and the last one written wins.
      // Checked rather than left to chance: it happens when two descriptor
      // rules of the SAME merchant promote onto one account pattern, so the
      // holder expresses both namings and either attribution is true of it.
      // The only consequence is for the exemption, where the source that is
      // not recorded stops licensing its own dead rule's rows, and those rows
      // are then REPORTED as changes rather than dismissed. That is the safe
      // direction and it is the direction this predicate must fail in.
      promotionSource.set(collision.id, rule.id);
    }
    const matchedAfter = matchedBy(
      { id: rule.id, merchantId: rule.merchantId, kind: "EXACT", pattern: accountPattern },
      rows,
      identityKey,
    ).length;
    counts.push({ ruleId: rule.id, matchedBefore, matchedAfter });
    if (matchedAfter > matchedBefore) {
      broadened.push(rule.id);
    }
    // ONE ROW OF EVIDENCE IS STILL A PROMOTION, BUT IT SAYS SO (finding
    // HZ-M3P12-06). matchedBefore is the count under the OLD key, so it is
    // the same on a second run and the decision report stays byte-identical
    // across runs (criterion 12.8).
    const onOneRow = matchedBefore === 1;
    if (onOneRow) {
      promotedOnOneRow.push(rule.id);
    }
    decisions.push({
      ruleId: rule.id,
      pass: "two",
      basis: "account",
      outcome: onOneRow ? "promoted-on-one-row" : "promoted",
    });
  }

  // THE BEFORE-SET IS COMPUTED AFTER PASS ONE, and that ordering is the fix
  // for finding CR3-M3P12-01 rather than a tidy-up. It reads each stored rule
  // under the key it is actually written against (fix round two, finding
  // HZ-M3P12-R2-03), so a migrated or half-migrated table produces the
  // assignment set it really holds. What it must NOT do is credit a rule the
  // deployed matcher can no longer apply: a pattern superseded by a
  // namespaced rule of the same kind is dead in production, and counting it
  // as a live assignment made the next ordinary re-naming report a LOST
  // assignment for a row whose merchant the owner had themselves changed, and
  // block the whole migration on it, permanently, since decision D-39 forbids
  // deleting the dead row.
  //
  // THE EXCLUSION IS NARROWED TO THE ROWS THE CLAIMANT ACTUALLY REACHES, and
  // it happens at the COMPARISON rather than by removing the source rule from
  // the before-set (fix round four, HAZARD finding CR4-M3P12-01). Round three
  // excluded the whole superseded rule, and that traded a false loss for a
  // hidden one, witnessed by executing this routine against a constructed
  // seed rather than by reading it.
  //
  // WHY THE WHOLESALE EXCLUSION WAS WRONG. The before-set reads a rule under
  // the key it is written against, so an un-namespaced rule is read under the
  // BASELINE key, and the baseline key is basis-agnostic: it is computed for
  // every row whatever basis that row takes under the new scheme. A
  // superseded rule therefore claims two kinds of row. The first is a
  // DESCRIPTOR-basis row, which the namespaced claimant matches by
  // construction, because the identity key of such a row is exactly the
  // namespace plus its baseline key. The second is an ACCOUNT-basis row,
  // which the claimant can NEVER match, because a descriptor-namespaced
  // pattern cannot match an account-namespaced key (decision D-40), and which
  // pass two's promotion covers only when every row routed to the rule
  // carries the same trusted account. Excluding the whole rule dropped the
  // second kind from BOTH sides of the superset test, so a row that the
  // owner's naming used to cover and that nothing covers afterwards vanished
  // with no loss, no count and no line in the report. That is the very shape
  // criterion 12.7 exists to catch, and hazards H12.3 and H12.18 name it.
  //
  // SO THE BEFORE-SET IS WHOLE AGAIN and the artifact is filtered where it
  // can be told apart from a real loss: below, at allLost.
  const assignmentsBefore = assignmentSet(rows, before);

  // THE AFTER STATE IS THE WORKING COPY, not a re-read. Nothing has been
  // written yet, so there is nothing to read back; `working` IS the state
  // the pending writes would produce, and computing the superset test
  // against it is what lets the routine block BEFORE it writes.
  const assignmentsAfter = assignmentSet(rows, working, identityKey);
  // THE SUPERSET TEST, measured as EFFECT rather than as rows (criterion
  // 12.7). A rule left byte-identical survives as a row and, once the key
  // has changed under it, matches nothing: the row count is preserved while
  // the naming is dead, so counting rows would report that clean.
  const allLost = [...assignmentsBefore.entries()]
    .filter(([id, held]) => {
      const after = assignmentsAfter.get(id);
      if (after?.merchantId === held.merchantId) {
        return false;
      }
      // THE ONE ARTIFACT THAT IS NOT A LOSS, stated as the lineage it rests on
      // (fix round five, hazard finding HAZ5-1). A superseded rule's claim on
      // a row is a claim the deployed matcher stopped honouring the moment the
      // code deployed, because its pattern carries no namespace. What licenses
      // dismissing that claim is not that SOMETHING covers the row now. It is
      // that the specific namespaced rule which took the dead rule's pattern
      // covers it, because that rule is the owner's own later naming of the
      // same group, made on the screen inside decision D-46's deploy window.
      //
      // SO THE TEST IS DESCENT, NOT COVERAGE: the rule holding the row after
      // the run must BE the claimant, or must be carrying the claimant's own
      // promotion into the account key space. Anything else covering the row
      // is an unrelated declaration, and a row moving to it has changed
      // merchant by something nobody in this relationship named. Criterion
      // 12.7 guarantees two things, that no transaction loses its merchant
      // AND that none changes from one merchant to another, and round four's
      // "covered by anything" reading silently gave up the second.
      //
      // THE ERROR THIS CAN STILL MAKE IS THE SAFE ONE. A row that ends up at
      // the claimant's merchant through an unrelated rule is reported as a
      // change, which blocks with an acknowledge path rather than passing in
      // silence. After three rounds of this predicate hiding things, over
      // reporting is the direction to err in, and it is the direction a
      // person can clear in one flag.
      const claimantOfHeld = supersededByClaimant.get(held.ruleId);
      if (
        claimantOfHeld !== undefined &&
        after !== undefined &&
        lineageRoot(after.ruleId) === claimantOfHeld
      ) {
        return false;
      }
      return true;
    })
    .map(([id, held]) => ({ transactionId: id, ruleId: held.ruleId }));
  // ACCEPTANCE IS PER RULE ID and clears exactly the ids it names. It
  // PARTITIONS rather than filters (finding CR-M3P12-01): an accepted loss
  // leaves the blocking decision and nothing else, so it is still printed,
  // still counted and still named in the report.
  const lostAssignments = allLost.filter((lost) => !accepted.has(lost.ruleId));
  const acceptedLostAssignments = allLost.filter((lost) =>
    accepted.has(lost.ruleId),
  );

  // EXACTLY TWO BLOCKING CONDITIONS. Every other outcome, including a rule
  // that could not be promoted, is printed, counted and exits 0: a rule
  // left safely in place is not a reason to block a deploy.
  const exitCode =
    conflicts.length > 0 || lostAssignments.length > 0 ? 1 : 0;

  // ---- APPLY ----------------------------------------------------------
  // The only place in this routine that writes, and it is reached only when
  // the run is neither blocked nor a dry run. A blocked run therefore leaves
  // the database exactly as it found it, which is what the word blocking has
  // to mean for the acknowledge path to be usable: an operator runs it, is
  // blocked, reads the ids off a report describing work that did NOT happen,
  // and decides. The recompute is inside the same gate, so a blocked run
  // never carries a lost assignment onto a transaction row.
  const applied = exitCode === 0 && input.dryRun !== true;

  // ONE PLACE THAT SHAPES THE REPORT, so the value a recompute failure
  // carries is the same value a clean run returns, with `applied` the only
  // difference.
  const buildReport = (didApply: boolean): RederiveReport => ({
    decisions,
    counts,
    rulesBefore: before.length,
    rulesAfter: working.length,
    patternsRewritten,
    alreadyNamespaced,
    rulesAdded,
    broadened,
    promotedOnOneRow,
    alreadyHeldBySameMerchantTwin,
    supersededByNamespacedRule,
    supersededBy: [...supersededByClaimant].map(([ruleId, claimantRuleId]) => ({
      ruleId,
      claimantRuleId,
    })),
    promotedFrom: [...promotionSource].map(([ruleId, sourceRuleId]) => ({
      ruleId,
      sourceRuleId,
    })),
    conflicts,
    acceptedConflicts,
    lostAssignments,
    acceptedLostAssignments,
    assignmentsBefore: assignmentsBefore.size,
    assignmentsAfter: assignmentsAfter.size,
    exitCode,
    applied: didApply,
  });
  if (applied) {
    // ONE CALL, ONE TRANSACTION (fix round two, finding CR2-M3P12-03). The
    // whole write set goes through a single port member the adapter runs
    // inside a database transaction, so a rejection anywhere rolls back every
    // write that preceded it. Before this, the updates and inserts were
    // separate awaits with nothing around them, and a failure partway through
    // left the table half migrated while the command's own contract told the
    // operator that a non-zero exit meant nothing had happened.
    //
    // THE RECOMPUTE IS OUTSIDE IT, deliberately and not by omission. It
    // writes transactions.merchantId, which is INTERPRETATION output rather
    // than a declaration (pulse-domain section 2), it is idempotent, and it
    // is the one step that is safe to re-run on its own. Holding a
    // transaction open across the whole recompute would put a long write lock
    // on the transactions table for no guarantee the recompute does not
    // already give.
    await deps.merchants.applyRuleWrites(context, {
      updates: pendingUpdates,
      inserts: pendingInserts,
    });
    // THE RECOMPUTE'S FAILURE IS A DIFFERENT EVENT FROM THE WRITE SET'S, and
    // is thrown as one (fix round three, finding CR3-M3P12-02). Everything
    // above this line is inside one transaction and rolls back together; by
    // the time this runs, the rule writes are committed. The caller needs to
    // know which side failed, because the two have opposite answers to what
    // the table now holds, and it needs the report so it can say WHAT was
    // written rather than only that something was.
    try {
      await deps.recompute(context);
    } catch (cause) {
      throw new RederiveRecomputeError(buildReport(true), cause);
    }
  }

  return buildReport(applied);
};

// The DECISION REPORT, byte-comparable across runs (criterion 12.8). The
// matched counts are printed by the script beside it and are NOT here.
export const formatDecisionReport = (report: RederiveReport): string =>
  report.decisions
    .map(
      (decision) =>
        `${decision.ruleId} pass=${decision.pass} basis=${decision.basis} outcome=${decision.outcome}`,
    )
    .sort()
    .join("\n");
