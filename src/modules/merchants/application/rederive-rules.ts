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
  // Pass two.
  | "promoted"
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
  readonly assignmentsBefore: number;
  readonly assignmentsAfter: number;
  readonly exitCode: number;
};

export type RederiveDependencies = {
  readonly merchants: Pick<
    MerchantRepositoryPort,
    "listRules" | "listCountedTransactions" | "upsertRule" | "updateRulePattern"
  >;
  readonly recompute: RecomputeInterpretation;
};

export type RederiveInput = {
  // Rule ids whose merchant-conflict or lost assignment a PERSON has seen
  // and accepted. It clears exactly the ids it names and nothing else.
  readonly acceptedRuleIds?: readonly string[];
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

const assignmentSet = (
  rows: readonly CountedTransaction[],
  rules: readonly MerchantRuleLike[],
  key: (row: CountedTransaction) => string,
): ReadonlyMap<string, { merchantId: string; ruleId: string }> => {
  const pairs = new Map<string, { merchantId: string; ruleId: string }>();
  for (const row of rows) {
    const match = matchRules(key(row), rules);
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
  const assignmentsBefore = assignmentSet(rows, before, baselineKey);

  const decisions: RuleDecision[] = [];
  const counts: RuleCounts[] = [];
  const conflicts: string[] = [];
  const acceptedConflicts: string[] = [];
  const broadened: string[] = [];
  let patternsRewritten = 0;
  let alreadyNamespaced = 0;
  let rulesAdded = 0;

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
    if (collision !== undefined && collision.merchantId !== rule.merchantId) {
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
    await deps.merchants.updateRulePattern(context, {
      ruleId: rule.id,
      pattern: newPattern,
    });
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
      const added = await deps.merchants.upsertRule(context, {
        merchantId: rule.merchantId,
        kind: "EXACT",
        pattern: accountPattern,
      });
      working.push({
        id: added.id,
        merchantId: rule.merchantId,
        kind: "EXACT",
        pattern: accountPattern,
      });
      rulesAdded += 1;
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
    decisions.push({
      ruleId: rule.id,
      pass: "two",
      basis: "account",
      outcome: "promoted",
    });
  }

  const after = await deps.merchants.listRules(context);
  const assignmentsAfter = assignmentSet(rows, after, identityKey);
  // THE SUPERSET TEST, measured as EFFECT rather than as rows (criterion
  // 12.7). A rule left byte-identical survives as a row and, once the key
  // has changed under it, matches nothing: the row count is preserved while
  // the naming is dead, so counting rows would report that clean.
  const lostAssignments = [...assignmentsBefore.entries()]
    .filter(
      ([id, held]) => assignmentsAfter.get(id)?.merchantId !== held.merchantId,
    )
    .map(([id, held]) => ({ transactionId: id, ruleId: held.ruleId }))
    // ACCEPTANCE IS PER RULE ID and clears exactly the ids it names.
    .filter((lost) => !accepted.has(lost.ruleId));

  await deps.recompute(context);

  return {
    decisions,
    counts,
    rulesBefore: before.length,
    rulesAfter: after.length,
    patternsRewritten,
    alreadyNamespaced,
    rulesAdded,
    broadened,
    conflicts,
    acceptedConflicts,
    lostAssignments,
    assignmentsBefore: assignmentsBefore.size,
    assignmentsAfter: assignmentsAfter.size,
    // EXACTLY TWO BLOCKING CONDITIONS. Every other outcome, including a rule
    // that could not be promoted, is printed, counted and exits 0: a rule
    // left safely in place is not a reason to block a deploy.
    exitCode: conflicts.length > 0 || lostAssignments.length > 0 ? 1 : 0,
  };
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
