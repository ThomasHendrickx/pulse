import fc from "fast-check";
import { describe, expect, test } from "vitest";
import { cents } from "../../src/platform/money";
import { householdId, userId, type HouseholdContext } from "../../src/platform/tenancy";
import type { CountedTransaction } from "../../src/modules/merchants/application/ports";
import type { MerchantRuleLike } from "../../src/modules/merchants/domain/merchant-rule";
import {
  rederiveMerchantRules,
  type RederiveDependencies,
} from "../../src/modules/merchants/application/rederive-rules";
import { IDENTITY_FIXTURE_ACCOUNTS } from "../fixtures/generate-pdf-fixtures";

// CRITERION 12.7, THE WHOLE OF IT, AS TWO BICONDITIONALS OVER GENERATED
// WORLDS.
//
// WHY THIS IS A PROPERTY AND NOT EXAMPLES. The re-derivation's loss reporting
// has been rewritten in three consecutive fix rounds and EACH ROUND PASSED ITS
// OWN EXAMPLES: round two reported losses that had not happened, round three
// hid a real loss, round four hid a reassignment of a row to an unrelated
// third merchant. Every one was correct against the witness in front of it and
// wrong about a shape nobody had built yet.
//
// NOTHING HERE IS COMPUTED BY THE ROUTINE. The merchant a row carried before
// and after is decided by a resolver this file writes against the seed and the
// captured write batch, using this file's own model of the two key spaces.
// Importing the routine's assignment-set helper or its identity-key helper
// would certify the function against itself, which is exactly what a mechanism
// wrong three times running cannot afford.
//
// THE FIRST BICONDITIONAL IS DECIDED FROM MERCHANT IDENTITY ALONE and names no
// relation the RUN publishes, so a run cannot green it by publishing a
// relationship that is not true.
//
// ONE HONEST QUALIFICATION, because the criterion's prose says the first
// biconditional "names no lineage" while its own sentence names the claimant
// of the rule the row resolved through. It does name that relation. What
// makes the property independent is that the relation is not READ FROM THE
// RUN: the table's unique key is (householdId, kind, pattern), so for a
// superseded EXACT rule with pattern P the claimant is the UNIQUE rule of the
// same kind whose pattern is the namespaced form of P, and this file finds it
// in the SEED. A forged pair in the report cannot move it. The neighbouring
// never-re-derive rule binds the ROUTINE's comparison, which reads published
// ids; it does not bind a test that must decide the same fact independently.
//
// EVERY VALUE BELOW IS INVENTED: the accounts are the identity fixture's own
// invented IBANs, already listed with their provenance in
// test/fixtures/allowed-identifiers.txt, the untrusted token is a hand-typed
// string that is not an account at all, and the counterparty texts are
// hand-typed English phrases.

const context: HouseholdContext = {
  householdId: householdId("household-property"),
  userId: userId("user-property"),
};

const SHARED = "SHARED COUNTERPARTY TEXT";
const OTHER = "OTHER COUNTERPARTY TEXT";

const ACCOUNTS = [
  IDENTITY_FIXTURE_ACCOUNTS.counterparty1,
  IDENTITY_FIXTURE_ACCOUNTS.counterparty2,
  IDENTITY_FIXTURE_ACCOUNTS.counterparty3,
] as const;
// Not an account: it fails the trust gate, so a row carrying it takes the
// DESCRIPTOR basis. It is what makes a promotion decline, which is what makes
// the claimant-merchant class reachable.
const UNTRUSTED = "NOT-AN-ACCOUNT";
const TRUSTED = new Set<string>(ACCOUNTS);

const MERCHANTS = ["merchant-one", "merchant-two", "merchant-three"] as const;

const ACCOUNT_NS = "account:";
const DESCRIPTOR_NS = "descriptor:";
const isNamespaced = (pattern: string): boolean =>
  pattern.startsWith(ACCOUNT_NS) || pattern.startsWith(DESCRIPTOR_NS);

// ---- THIS FILE'S OWN RESOLVER ------------------------------------------
// The two key spaces, modelled from the criterion's words rather than from the
// code. Every generated description is uppercase ASCII with single spaces, so
// the pre-phase normalisation is the identity on it; every generated account
// is already compact and uppercase. If either model were wrong the
// biconditionals below would break, because the REPORTED side comes from the
// routine and only this side comes from here.
const prePhaseKey = (row: CountedTransaction): string => row.description;
const identityKey = (row: CountedTransaction): string =>
  row.counterpartyAccount !== undefined && TRUSTED.has(row.counterpartyAccount)
    ? `${ACCOUNT_NS}${row.counterpartyAccount}`
    : `${DESCRIPTOR_NS}${row.description}`;

// THE MATCHER'S OWN TIE-BREAK, modelled here rather than imported, because the
// criterion's before set is defined as "with the matcher's own tie-break
// applied within each space" and this file must decide that for itself. It is
// short enough to state: EXACT wins on equality; then, and ONLY where the key
// is not account-basis, the longest matching PREFIX wins (decision D-40 refuses
// a prefix against an account key, because an account namespace plus a prefix
// of an account number is a different account). PATTERN is not modelled because
// the generator does not build one, and a kind the generator cannot build is a
// kind this resolver must not pretend to judge.
const resolve = (
  key: string,
  rules: readonly MerchantRuleLike[],
): MerchantRuleLike | undefined => {
  const exact = rules.filter(
    (rule) => rule.kind === "EXACT" && rule.pattern === key,
  );
  if (exact.length > 0) {
    return [...exact].sort((a, b) => (a.id < b.id ? -1 : 1))[0];
  }
  if (key.startsWith(ACCOUNT_NS)) {
    return undefined;
  }
  const prefixes = rules.filter(
    (rule) => rule.kind === "PREFIX" && key.startsWith(rule.pattern),
  );
  return [...prefixes].sort(
    (a, b) => b.pattern.length - a.pattern.length || (a.id < b.id ? -1 : 1),
  )[0];
};

// THE PRE-PHASE SPACE IS CONSULTED FIRST, the identity space only for a row no
// un-namespaced rule reaches. The order is the criterion's and it is what
// decides whether a row claimed in BOTH spaces carries the superseded rule's
// merchant before the run, which is the state the exception exists to carry.
const holderBefore = (
  row: CountedTransaction,
  rules: readonly MerchantRuleLike[],
): MerchantRuleLike | undefined =>
  resolve(
    prePhaseKey(row),
    rules.filter((rule) => !isNamespaced(rule.pattern)),
  ) ??
  resolve(
    identityKey(row),
    rules.filter((rule) => isNamespaced(rule.pattern)),
  );

const holderAfter = (
  row: CountedTransaction,
  rules: readonly MerchantRuleLike[],
): MerchantRuleLike | undefined => resolve(identityKey(row), rules);

// THE CLAIMANT, FOUND IN THE SEED AND NOT IN THE REPORT. Pinned uniquely by
// the table's unique key over (household, kind, pattern). EXACT only: the
// argument that an un-namespaced pattern is dead is an argument about
// EQUALITY, so the criterion admits the exception for no other kind.
// TWO ABSENCES THAT MUST NOT BE EQUAL. "The merchant it carries after" is not
// a merchant at all when nothing covers the row, and "the merchant the
// claimant carries" is not a merchant when there is no claimant. Comparing
// those two as undefined makes a row nothing covers, held by a rule with no
// claimant, look like a row that ended at the claimant's merchant, which is
// the criterion's plainest case of a LOST assignment read as its exception.
// Distinct sentinels keep the three merchant terms comparable without that
// collision, and the criterion says the same thing in words: a row that ends
// covered by nothing at all is a lost assignment.
const COVERED_BY_NOTHING = Symbol("covered by nothing");
const THERE_IS_NO_CLAIMANT = Symbol("there is no claimant");
type MerchantTerm = string | typeof COVERED_BY_NOTHING | typeof THERE_IS_NO_CLAIMANT;

const claimantInSeed = (
  rule: MerchantRuleLike,
  rules: readonly MerchantRuleLike[],
): MerchantRuleLike | undefined =>
  rule.kind !== "EXACT" || isNamespaced(rule.pattern)
    ? undefined
    : rules.find(
        (candidate) =>
          candidate.kind === "EXACT" &&
          candidate.pattern === `${DESCRIPTOR_NS}${rule.pattern}`,
      );

// ---- THE GENERATED WORLDS ----------------------------------------------
type Seed = {
  readonly rules: readonly MerchantRuleLike[];
  readonly rows: readonly CountedTransaction[];
  readonly label: string;
};

const makeRow = (
  id: string,
  description: string,
  account?: string,
): CountedTransaction => ({
  id,
  flow: "SPEND",
  amountCents: cents(-1_000),
  description,
  ...(account === undefined ? {} : { counterpartyAccount: account }),
});

// THE SCENARIOS EXIST SO EVERY SHAPE IS REACHABLE, not so the property knows
// which shape it is looking at: the assertions never read the label. Three of
// the six shapes need a claimant to exist AND need its promotion to happen or
// to be declined, which independent coin flips reach too rarely to be relied
// on, and a shape the generator cannot reach is a conjunct the property never
// exercises.
const scenarios = [
  "no-claimant",
  "claimant-covers-descriptor-row",
  "claimant-promotes-onto-one-account",
  "promotion-declined-nothing-covers",
  "promotion-declined-third-merchant-covers",
  "promotion-declined-claimant-merchant-covers",
  // THE WORLD THE FORGED-PAIR MUTANT NEEDS, and the generator did not have it
  // until that mutant asked for it. Pass two reaches its COLLISION branch only
  // when the promotion is actually attempted, which needs every row the
  // claimant reaches to carry one trusted account, and only takes the conflict
  // arm when the holder of that account pattern carries a DIFFERENT merchant.
  // Without such a world a run that forges a promotion pair has nowhere to
  // forge one, and the mutant looks caught when it was merely unreachable.
  "promotion-collides-with-third-merchant",
  // THE KIND DIMENSION (fix round seven, hazard finding HZ6-M3P12-01). Until
  // this scenario every rule in every generated world was EXACT, so the
  // "same kind" conjunct in the routine's claimant lookup, and the same-kind
  // assertions in the lineage check below, could not be falsified by anything
  // the generator could build. The schema's unique key is
  // (householdId, kind, pattern), so an EXACT rule and a PREFIX rule may hold
  // the IDENTICAL pattern string, and the pattern planted here is exactly the
  // namespaced form a same-kind claimant would hold. With the conjunct in
  // place there is no claimant, the dead rule is rewritten and the row keeps
  // its merchant; without it the PREFIX rule is taken for a claimant, the dead
  // rule is left in place, and the row silently changes merchant. It is a
  // missing GENERATOR DIMENSION rather than a seventh row outcome, so it adds
  // no count: the shapes it produces are ones already counted.
  "cross-kind-pattern-collision",
] as const;

const seedArbitrary = fc
  .record({
    scenario: fc.constantFrom(...scenarios),
    deadMerchant: fc.constantFrom(...MERCHANTS),
    claimantMerchant: fc.constantFrom(...MERCHANTS),
    thirdMerchant: fc.constantFrom(...MERCHANTS),
    account: fc.constantFrom(...ACCOUNTS),
    // A second un-namespaced rule on a different text, so worlds exist in
    // which more than one rule is migrating at once.
    second: fc.option(fc.constantFrom(...MERCHANTS), { nil: undefined }),
    // Rows carrying no relation to any of it.
    noise: fc.array(fc.option(fc.constantFrom(...ACCOUNTS), { nil: undefined }), {
      maxLength: 2,
    }),
  })
  .map(
    ({
      scenario,
      deadMerchant,
      claimantMerchant,
      thirdMerchant,
      account,
      second,
      noise,
    }): Seed => {
      const rules: MerchantRuleLike[] = [
        { id: "dead", merchantId: deadMerchant, kind: "EXACT", pattern: SHARED },
      ];
      const rows: CountedTransaction[] = [];
      const claimant = (): void => {
        rules.push({
          id: "claimant",
          merchantId: claimantMerchant,
          kind: "EXACT",
          pattern: `${DESCRIPTOR_NS}${SHARED}`,
        });
      };
      const unrelatedAccountRule = (merchantId: string): void => {
        rules.push({
          id: "unrelated",
          merchantId,
          kind: "EXACT",
          pattern: `${ACCOUNT_NS}${account}`,
        });
      };
      // A SUPERSEDED RULE'S ROWS SPLIT ACROSS THE TWO BASES is what makes the
      // promotion link load bearing rather than decorative, so it is the shape
      // every declined scenario carries: one row that stays on the descriptor
      // basis because its account is not one, and one that moves to the
      // account basis.
      const splitRows = (): void => {
        rows.push(makeRow("descriptorRow", SHARED, UNTRUSTED));
        rows.push(makeRow("accountRow", SHARED, account));
      };
      switch (scenario) {
        case "no-claimant":
          rows.push(makeRow("descriptorRow", SHARED));
          rows.push(makeRow("accountRow", SHARED, account));
          break;
        case "claimant-covers-descriptor-row":
          claimant();
          rows.push(makeRow("descriptorRow", SHARED));
          break;
        case "claimant-promotes-onto-one-account":
          claimant();
          // Every row the claimant reaches under the pre-phase key carries the
          // SAME trusted account, so the promotion is made and the row that
          // moved to the account basis is covered by it.
          rows.push(makeRow("accountRow", SHARED, account));
          break;
        case "promotion-declined-nothing-covers":
          claimant();
          splitRows();
          break;
        case "promotion-declined-third-merchant-covers":
          claimant();
          splitRows();
          unrelatedAccountRule(thirdMerchant);
          break;
        case "promotion-declined-claimant-merchant-covers":
          claimant();
          splitRows();
          unrelatedAccountRule(claimantMerchant);
          break;
        case "promotion-collides-with-third-merchant":
          claimant();
          rows.push(makeRow("accountRow", SHARED, account));
          unrelatedAccountRule(thirdMerchant);
          break;
        case "cross-kind-pattern-collision":
          rules.push({
            id: "prefixHolder",
            merchantId: claimantMerchant,
            kind: "PREFIX",
            pattern: `${DESCRIPTOR_NS}${SHARED}`,
          });
          rows.push(makeRow("descriptorRow", SHARED));
          break;
      }
      if (second !== undefined) {
        rules.push({ id: "second", merchantId: second, kind: "EXACT", pattern: OTHER });
      }
      noise.forEach((noiseAccount, index) => {
        rows.push(makeRow(`noise-${index}`, OTHER, noiseAccount));
      });
      return { rules, rows, label: scenario };
    },
  );

// ---- RUNNING ONE WORLD --------------------------------------------------
type Insert = {
  readonly merchantId: string;
  readonly kind: MerchantRuleLike["kind"];
  readonly pattern: string;
};

const runOnce = async (seed: Seed) => {
  const updates: { ruleId: string; pattern: string }[] = [];
  const inserts: Insert[] = [];
  const deps = {
    merchants: {
      listRules: async () => seed.rules,
      listCountedTransactions: async () => seed.rows,
      upsertRule: async () => {
        throw new Error("the routine must not reach upsertRule");
      },
      applyRuleWrites: async (
        _context: HouseholdContext,
        input: { updates: readonly { ruleId: string; pattern: string }[]; inserts: readonly Insert[] },
      ) => {
        updates.push(...input.updates);
        inserts.push(...input.inserts);
      },
    },
    recompute: async () => {},
  } as unknown as RederiveDependencies;

  // A FIRST RUN TO LEARN WHAT BLOCKS, then a run that accepts exactly that, so
  // the writes are issued in EVERY generated world rather than only in the
  // ones that happened not to block. A blocked run writes nothing, so the
  // learning run leaves the seed untouched. Acceptance PARTITIONS the loss set
  // rather than filtering it, so the report still names every row.
  const blocked = await rederiveMerchantRules(context, deps, {});
  const report = await rederiveMerchantRules(context, deps, {
    acceptedRuleIds: blocked.conflicts,
    acceptedLosses: blocked.lostAssignments.map((lost) => ({
      ruleId: lost.ruleId,
      transactionId: lost.transactionId,
    })),
  });

  // THE AFTER STATE, from the write batch the routine ISSUED. A promotion this
  // run inserted is named in the lineage by a placeholder, and the criterion
  // fixes the correspondence: `pending-<n>` where n is the one-based position
  // of that insert in this batch, in this order. It is resolved HERE, against
  // the batch, and never against the report's own account of itself.
  const rewritten = new Map(updates.map((update) => [update.ruleId, update.pattern]));
  const rulesAfter: MerchantRuleLike[] = [
    ...seed.rules.map((rule) => ({
      ...rule,
      pattern: rewritten.get(rule.id) ?? rule.pattern,
    })),
    ...inserts.map((insert, index) => ({
      id: `pending-${index + 1}`,
      merchantId: insert.merchantId,
      kind: insert.kind,
      pattern: insert.pattern,
    })),
  ];
  return { report, rulesAfter, inserts };
};

describe("CRITERION 12.7: the two biconditionals, over generated worlds", () => {
  test("the loss set and the claimant-merchant class are exactly what the criterion says, and every shape is reached", async () => {
    // THE SIX SHAPES. The counts prove the generator REACHED each one; they do
    // not prove the property can fail at one, which is what the mutant record
    // in the phase work history is for.
    const shapes = {
      unchanged: 0,
      coveredByNothing: 0,
      takenByAStranger: 0,
      licensedByTheClaimant: 0,
      licensedByThePromotion: 0,
      claimantMerchantClass: 0,
    };

    await fc.assert(
      fc.asyncProperty(seedArbitrary, async (seed) => {
        const { report, rulesAfter } = await runOnce(seed);
        expect(report.applied).toBe(true);

        const reportedLost = new Set(
          [...report.lostAssignments, ...report.acceptedLostAssignments].map(
            (lost) => lost.transactionId,
          ),
        );
        const reportedClaimantMerchant = new Set(
          report.claimantMerchantReports.map((entry) => entry.transactionId),
        );
        // The licence is the test's OWN reading of the published lineage, and
        // it is used only by the SECOND biconditional.
        const claimantOfPublished = new Map(
          report.supersededBy.map((link) => [link.ruleId, link.claimantRuleId]),
        );
        const promotionSource = new Map(
          report.promotedFrom.map((link) => [link.ruleId, link.sourceRuleId]),
        );

        for (const row of seed.rows) {
          const held = holderBefore(row, seed.rules);
          if (held === undefined) {
            // A row no declaration reached before the run cannot lose a naming
            // and cannot be in either class.
            expect(reportedLost.has(row.id)).toBe(false);
            expect(reportedClaimantMerchant.has(row.id)).toBe(false);
            continue;
          }
          const nowHeldBy = holderAfter(row, rulesAfter);
          const before: MerchantTerm = held.merchantId;
          const after: MerchantTerm = nowHeldBy?.merchantId ?? COVERED_BY_NOTHING;
          const claimantMerchant: MerchantTerm =
            claimantInSeed(held, seed.rules)?.merchantId ?? THERE_IS_NO_CLAIMANT;

          // FIRST BICONDITIONAL, IN MERCHANTS AND IN NOTHING ELSE.
          const isLoss = before !== after && after !== claimantMerchant;
          expect({ row: row.id, lost: reportedLost.has(row.id) }).toEqual({
            row: row.id,
            lost: isLoss,
          });

          // SECOND BICONDITIONAL, where the lineage decides, separating the two
          // non-blocking outcomes that both end at the claimant's merchant.
          const claimantRuleId = claimantOfPublished.get(held.id);
          const licensed =
            claimantRuleId !== undefined &&
            nowHeldBy !== undefined &&
            (promotionSource.get(nowHeldBy.id) ?? nowHeldBy.id) === claimantRuleId;
          const isClaimantMerchantClass =
            before !== after && !licensed && after === claimantMerchant;
          expect({
            row: row.id,
            claimantMerchant: reportedClaimantMerchant.has(row.id),
          }).toEqual({ row: row.id, claimantMerchant: isClaimantMerchantClass });

          if (before === after) {
            shapes.unchanged += 1;
          } else if (after === COVERED_BY_NOTHING) {
            shapes.coveredByNothing += 1;
          } else if (licensed) {
            if (nowHeldBy?.id === claimantRuleId) {
              shapes.licensedByTheClaimant += 1;
            } else {
              shapes.licensedByThePromotion += 1;
            }
          } else if (after === claimantMerchant) {
            shapes.claimantMerchantClass += 1;
          } else {
            shapes.takenByAStranger += 1;
          }
        }
      }),
      { numRuns: 500 },
    );

    console.log(
      `shapes reached: unchanged ${shapes.unchanged}, coveredByNothing ${shapes.coveredByNothing}, takenByAStranger ${shapes.takenByAStranger}, licensedByTheClaimant ${shapes.licensedByTheClaimant}, licensedByThePromotion ${shapes.licensedByThePromotion}, claimantMerchantClass ${shapes.claimantMerchantClass}`,
    );
    for (const [name, count] of Object.entries(shapes)) {
      expect({ shape: name, reached: count > 0 }).toEqual({
        shape: name,
        reached: true,
      });
    }
  });

  // THE PUBLISHED LINEAGE IS NOT SELF-CERTIFYING, AND BOTH RELATIONS ARE
  // CHECKED, because the licence reads both and a verification covering one
  // leaves the other as the escape hatch.
  test("every published claimant pair and every published promotion pair is a real one", async () => {
    await fc.assert(
      fc.asyncProperty(seedArbitrary, async (seed) => {
        const { report, rulesAfter, inserts } = await runOnce(seed);
        const seedById = new Map(seed.rules.map((rule) => [rule.id, rule]));
        const afterById = new Map(rulesAfter.map((rule) => [rule.id, rule]));

        for (const link of report.supersededBy) {
          const dead = seedById.get(link.ruleId);
          const claimant = seedById.get(link.claimantRuleId);
          expect(dead).toBeDefined();
          expect(claimant).toBeDefined();
          // EXACT ONLY: the criterion admits the exception for no other kind,
          // and a run recording a claimant for a PREFIX or PATTERN rule does
          // not meet it.
          expect(dead?.kind).toBe("EXACT");
          expect(claimant?.kind).toBe("EXACT");
          expect(claimant?.pattern).toBe(`${DESCRIPTOR_NS}${dead?.pattern ?? ""}`);
        }

        for (const link of report.promotedFrom) {
          const holder = afterById.get(link.ruleId);
          const source = afterById.get(link.sourceRuleId);
          expect(holder).toBeDefined();
          expect(source).toBeDefined();
          if (holder === undefined || source === undefined) {
            continue;
          }
          expect(source.pattern.startsWith(DESCRIPTOR_NS)).toBe(true);
          expect(holder.kind).toBe("EXACT");
          expect(holder.pattern.startsWith(ACCOUNT_NS)).toBe(true);
          // A promotion is the source's OWN naming: same merchant. The pair
          // that fails this is the one that licenses a reassignment.
          expect(holder.merchantId).toBe(source.merchantId);
          // And it keys on the ONE trusted account carried by every row the
          // source matched under the pre-phase key.
          const bare = source.pattern.slice(DESCRIPTOR_NS.length);
          const reached = seed.rows.filter((row) => prePhaseKey(row) === bare);
          expect(reached.length).toBeGreaterThan(0);
          const accounts = new Set(
            reached.map((row) => row.counterpartyAccount ?? ""),
          );
          expect(accounts.size).toBe(1);
          const only = [...accounts][0] ?? "";
          expect(TRUSTED.has(only)).toBe(true);
          expect(holder.pattern).toBe(`${ACCOUNT_NS}${only}`);
          // A PLACEHOLDER IS RESOLVED AGAINST THE ISSUED BATCH, never against
          // the report's own account of itself.
          if (link.ruleId.startsWith("pending-")) {
            const position = Number(link.ruleId.slice("pending-".length));
            expect(Number.isInteger(position)).toBe(true);
            expect(position).toBeGreaterThan(0);
            expect(position).toBeLessThanOrEqual(inserts.length);
            expect(inserts[position - 1]?.pattern).toBe(holder.pattern);
            expect(inserts[position - 1]?.merchantId).toBe(holder.merchantId);
          }
        }
      }),
      { numRuns: 250 },
    );
  });
});
