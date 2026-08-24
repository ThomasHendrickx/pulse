import fc from "fast-check";
import { describe, expect, test } from "vitest";
import { cents } from "../../src/platform/money";
import { householdId, userId, type HouseholdContext } from "../../src/platform/tenancy";
import type { CountedTransaction } from "../../src/modules/merchants/application/ports";
import type { MerchantRuleLike } from "../../src/modules/merchants/domain/merchant-rule";
import {
  assignmentSet,
  identityKeyOfRow,
  rederiveMerchantRules,
  type RederiveDependencies,
} from "../../src/modules/merchants/application/rederive-rules";
import {
  ACCOUNT_NAMESPACE,
  DESCRIPTOR_NAMESPACE,
} from "../../src/modules/merchants/domain/counterparty-identity";
import { IDENTITY_FIXTURE_ACCOUNTS } from "../fixtures/generate-pdf-fixtures";

// M3-P12 FIX ROUND FIVE, HAZARD finding HAZ5-1.
//
// WHY THIS IS A PROPERTY AND NOT A FOURTH EXAMPLE. The re-derivation's loss
// exemption has been rewritten three times and each rewrite traded one bug
// for another: round two reported losses that had not happened, round three
// hid losses that had, and round four hid a silent REASSIGNMENT of a row from
// one merchant to an unrelated third one. Every rewrite was correct against
// the counterexample in front of it and wrong about the shape nobody had
// built yet. Three more example tests aimed at three known witnesses would
// buy nothing against a fourth.
//
// So this file states the guarantee itself, over generated worlds, as ONE
// biconditional:
//
//   a row is reported in the loss set  IF AND ONLY IF  its merchant changed
//   and the change is licensed by the supersede lineage.
//
// The three known shapes are corollaries of it, and so is any fourth:
//
//   A FALSE LOSS is reported && !changed.
//   A HIDDEN LOSS is changed (to nothing) && !reported && !licensed.
//   A HIDDEN REASSIGNMENT is changed (to another merchant) && !reported
//   && !licensed.
//
// WHAT "LICENSED" MEANS, and it is read from the run's own published lineage
// rather than recomputed: the row's coverage after the run must descend from
// the specific rule that superseded the rule making the claim, either by
// being that claimant or by carrying its promotion. The lineage the run
// publishes is not taken on trust: the last test in this file checks every
// claimed supersede against the seed, so a run cannot license itself by
// inventing a relationship.
//
// EVERY VALUE BELOW IS INVENTED. The accounts are the identity fixture's own
// invented IBANs, already listed with their provenance in
// test/fixtures/allowed-identifiers.txt; the counterparty text is a
// hand-typed English phrase.

const context: HouseholdContext = {
  householdId: householdId("household-property"),
  userId: userId("user-property"),
};

// Uppercase and free of punctuation, so the shipped normaliser is the
// identity on it and a bare rule pattern equals the rows' baseline key.
const SHARED_TEXT = "SHARED COUNTERPARTY TEXT";

const ACCOUNTS = [
  IDENTITY_FIXTURE_ACCOUNTS.counterparty1,
  IDENTITY_FIXTURE_ACCOUNTS.counterparty2,
  IDENTITY_FIXTURE_ACCOUNTS.counterparty3,
] as const;

const MERCHANTS = ["merchant-one", "merchant-two", "merchant-three"] as const;

type Seed = {
  readonly rules: readonly MerchantRuleLike[];
  readonly rows: readonly CountedTransaction[];
};

const seedArbitrary = fc
  .record({
    // The rule this whole mechanism is about: un-namespaced, so pass one
    // either rewrites it or finds it already superseded.
    deadMerchant: fc.constantFrom(...MERCHANTS),
    // The claimant, present or not. Absent means pass one rewrites the dead
    // rule instead of superseding it, which is the ordinary first-run shape.
    claimant: fc.option(
      fc.record({ merchantId: fc.constantFrom(...MERCHANTS) }),
      { nil: undefined },
    ),
    // A pre-existing account-basis rule with no relationship to either. This
    // is what turned round four's exemption into a hidden reassignment.
    unrelated: fc.option(
      fc.record({
        merchantId: fc.constantFrom(...MERCHANTS),
        account: fc.constantFrom(...ACCOUNTS),
      }),
      { nil: undefined },
    ),
    // A second un-namespaced rule on a DIFFERENT text, so worlds exist in
    // which more than one rule is migrating at once.
    second: fc.option(
      fc.record({ merchantId: fc.constantFrom(...MERCHANTS) }),
      { nil: undefined },
    ),
    rows: fc.array(
      fc.record({
        account: fc.option(fc.constantFrom(...ACCOUNTS), { nil: undefined }),
        otherText: fc.boolean(),
      }),
      { minLength: 1, maxLength: 5 },
    ),
  })
  .map(({ deadMerchant, claimant, unrelated, second, rows }): Seed => {
    const rules: MerchantRuleLike[] = [
      {
        id: "dead",
        merchantId: deadMerchant,
        kind: "EXACT",
        pattern: SHARED_TEXT,
      },
    ];
    if (claimant !== undefined) {
      rules.push({
        id: "claimant",
        merchantId: claimant.merchantId,
        kind: "EXACT",
        pattern: `${DESCRIPTOR_NAMESPACE}${SHARED_TEXT}`,
      });
    }
    if (unrelated !== undefined) {
      rules.push({
        id: "unrelated",
        merchantId: unrelated.merchantId,
        kind: "EXACT",
        pattern: `${ACCOUNT_NAMESPACE}${unrelated.account}`,
      });
    }
    if (second !== undefined) {
      rules.push({
        id: "second",
        merchantId: second.merchantId,
        kind: "EXACT",
        pattern: "OTHER COUNTERPARTY TEXT",
      });
    }
    return {
      rules,
      rows: rows.map((row, index) => ({
        id: `row-${index}`,
        flow: "SPEND" as const,
        amountCents: cents(-1_000),
        description: row.otherText ? "OTHER COUNTERPARTY TEXT" : SHARED_TEXT,
        ...(row.account === undefined ? {} : { counterpartyAccount: row.account }),
      })),
    };
  });

type Captured = {
  readonly updates: { readonly ruleId: string; readonly pattern: string }[];
  readonly inserts: {
    readonly merchantId: string;
    readonly kind: MerchantRuleLike["kind"];
    readonly pattern: string;
  }[];
};

const runOnce = async (seed: Seed) => {
  const captured: Captured = { updates: [], inserts: [] };
  const deps = {
    merchants: {
      listRules: async () => seed.rules,
      listCountedTransactions: async () => seed.rows,
      upsertRule: async () => {
        throw new Error("the routine must not reach upsertRule");
      },
      applyRuleWrites: async (
        _context: HouseholdContext,
        input: {
          updates: readonly { ruleId: string; pattern: string }[];
          inserts: readonly {
            merchantId: string;
            kind: MerchantRuleLike["kind"];
            pattern: string;
          }[];
        },
      ) => {
        captured.updates.push(...input.updates);
        captured.inserts.push(...input.inserts);
      },
    },
    recompute: async () => {},
  } as unknown as RederiveDependencies;

  // EVERY RULE IS ACCEPTED, so no world blocks and the writes are always
  // issued. Acceptance PARTITIONS the loss set rather than filtering it, so
  // the report still names every change; what it buys is that the captured
  // writes are the real after state in every generated world rather than only
  // in the ones that happened not to block.
  const report = await rederiveMerchantRules(context, deps, {
    acceptedRuleIds: seed.rules.map((rule) => rule.id),
  });

  // THE AFTER STATE, built from what the run actually wrote. The inserted
  // rules take the placeholder ids the report's own contract names:
  // pending-<n>, one-based, in batch order.
  const rewritten = new Map(
    captured.updates.map((update) => [update.ruleId, update.pattern]),
  );
  const rulesAfter: MerchantRuleLike[] = [
    ...seed.rules.map((rule) => ({
      ...rule,
      pattern: rewritten.get(rule.id) ?? rule.pattern,
    })),
    ...captured.inserts.map((insert, index) => ({
      id: `pending-${index + 1}`,
      merchantId: insert.merchantId,
      kind: insert.kind,
      pattern: insert.pattern,
    })),
  ];

  return {
    report,
    before: assignmentSet(seed.rows, seed.rules),
    after: assignmentSet(seed.rows, rulesAfter, identityKeyOfRow),
  };
};

describe("HAZ5-1: the loss report is exactly the set of unlicensed merchant changes", () => {
  test("THE BICONDITIONAL, over generated worlds", async () => {
    await fc.assert(
      fc.asyncProperty(seedArbitrary, async (seed) => {
        const { report, before, after } = await runOnce(seed);
        // The writes were issued, so `after` is the real post-run state.
        expect(report.applied).toBe(true);

        const claimantOf = new Map(
          report.supersededBy.map((link) => [link.ruleId, link.claimantRuleId]),
        );
        const sourceOf = new Map(
          report.promotedFrom.map((link) => [link.ruleId, link.sourceRuleId]),
        );
        const reported = new Set(
          [...report.lostAssignments, ...report.acceptedLostAssignments].map(
            (lost) => lost.transactionId,
          ),
        );

        for (const row of seed.rows) {
          const held = before.get(row.id);
          if (held === undefined) {
            // A row no declaration reached before the run cannot lose a
            // naming, so it must never be reported.
            expect(reported.has(row.id)).toBe(false);
            continue;
          }
          const nowHeldBy = after.get(row.id);
          const changed =
            nowHeldBy === undefined || nowHeldBy.merchantId !== held.merchantId;
          const claimant = claimantOf.get(held.ruleId);
          const licensed =
            claimant !== undefined &&
            nowHeldBy !== undefined &&
            (sourceOf.get(nowHeldBy.ruleId) ?? nowHeldBy.ruleId) === claimant;

          expect({
            row: row.id,
            reported: reported.has(row.id),
          }).toEqual({ row: row.id, reported: changed && !licensed });
        }
      }),
      { numRuns: 400 },
    );
  });

  // THE LINEAGE IS NOT TAKEN ON TRUST. The property above reads the run's own
  // published relationships to decide what is licensed, so a run that
  // invented a claimant could license anything. This checks every claimed
  // link against the seed: the claimant must exist, must be of the same kind,
  // and must hold exactly the namespaced form of the superseded pattern.
  test("EVERY PUBLISHED SUPERSEDE IS A REAL ONE", async () => {
    await fc.assert(
      fc.asyncProperty(seedArbitrary, async (seed) => {
        const { report } = await runOnce(seed);
        const byId = new Map(seed.rules.map((rule) => [rule.id, rule]));
        for (const link of report.supersededBy) {
          const dead = byId.get(link.ruleId);
          const claimant = byId.get(link.claimantRuleId);
          expect(dead).toBeDefined();
          expect(claimant).toBeDefined();
          expect(claimant?.kind).toBe(dead?.kind);
          expect(claimant?.pattern).toBe(
            `${DESCRIPTOR_NAMESPACE}${dead?.pattern ?? ""}`,
          );
        }
        // And a promotion is always attributed to a rule that exists and was
        // itself a candidate for promotion, never to a phantom.
        const promotableIds = new Set(seed.rules.map((rule) => rule.id));
        for (const link of report.promotedFrom) {
          expect(promotableIds.has(link.sourceRuleId)).toBe(true);
        }
      }),
      { numRuns: 200 },
    );
  });
});
