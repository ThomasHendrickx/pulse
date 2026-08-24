import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import {
  householdId,
  userId,
  type HouseholdContext,
} from "../../src/platform/tenancy";
import { confirmImport } from "../../src/modules/import/application/confirm-import";
import { uploadStatement } from "../../src/modules/import/application/upload-statement";
import { statementParser } from "../../src/modules/import/adapters/statement-parser";
import { recomputeInterpretation } from "../../src/modules/ledger/application/interpret-window";
import {
  RederiveRecomputeError,
  formatDecisionReport,
  rederiveMerchantRules,
} from "../../src/modules/merchants/application/rederive-rules";
import type { RederiveDependencies } from "../../src/modules/merchants/application/rederive-rules";
import type { MerchantRepositoryPort } from "../../src/modules/merchants/application/ports";
import {
  ACCOUNT_NAMESPACE,
  DESCRIPTOR_NAMESPACE,
} from "../../src/modules/merchants/domain/counterparty-identity";
import { IDENTITY_FIXTURE_ACCOUNTS } from "../fixtures/generate-pdf-fixtures";
import { cents } from "../../src/platform/money";
import type { CountedTransaction } from "../../src/modules/merchants/application/ports";
import { makeFakeImportWorld } from "./fake-import-world";

// CRITERIA 12.7, 12.8 and 12.9.
//
// WHAT THE SUBJECT ACTUALLY IS, corrected in the M3-P12 fix round under
// finding CR-M3P12-03 because the sentence that stood here was FALSE. It
// said the re-derivation runs against a SEEDED DATABASE holding MerchantRule
// rows. It does not: the subject is the IN-MEMORY FAKE REPOSITORY at
// test/application/fake-import-world.ts, bound below, and no database is
// involved and no SQL runs. The criteria say "database", the work history
// records that as a deviation, and this comment was the only place in the
// tree saying the false thing, which is the place a next implementer reads
// first when deciding whether the routine has database coverage.
//
// THE ADAPTER'S OWN WRITE PATH IS COVERED SEPARATELY, at
// test/e2e/merchant-rule-write.spec.ts, which runs in the PLAYWRIGHT gate
// because that is the only lane in this tree with a live database (finding
// CR-M3P12-02). CORRECTED IN FIX ROUND TWO under finding HZ-M3P12-R2-05: this
// sentence named test/db/merchant-rule-write.test.ts, a path that does not
// exist, inside a paragraph whose whole purpose is correcting an earlier
// false claim. It is the sentence a next implementer reads when deciding
// whether the routine's production write path has database coverage, and it
// led nowhere.
//
// The seed deliberately contains all three shapes criterion 12.8 names: a
// rule that cannot be promoted, a rule whose matched rows split across the
// two bases, and a merchant conflict. It also contains the two shapes pass
// one's guards exist for and which criterion 12.21 requires to be REACHED
// rather than merely present: an already-namespaced pattern and an empty one.

const context: HouseholdContext = {
  householdId: householdId("household-1"),
  userId: userId("user-1"),
};

const repositoryRoot = join(__dirname, "..", "..");

const FIXTURE = "belfius-counterparty-identity.pdf";

const fixtureBytes = (): Uint8Array =>
  new Uint8Array(readFileSync(join(__dirname, "..", "fixtures", FIXTURE)));

type World = ReturnType<typeof makeFakeImportWorld>;

const ingestFixture = async (): Promise<World> => {
  const world = makeFakeImportWorld();
  const bytes = fixtureBytes();
  const uploaded = await uploadStatement(context, world.deps, {
    fileName: "identity.pdf",
    bytes,
  });
  if (uploaded.kind !== "awaiting-declaration") {
    throw new Error("expected the account declaration to be asked");
  }
  const detected = await statementParser.detect(bytes);
  if (!detected.ok) {
    throw new Error("detection failed");
  }
  const confirmed = await confirmImport(context, world.deps, {
    importId: uploaded.importId,
    profileName: "belfius-current-account-nl",
    spec: detected.value,
    declaration: { label: "Daily account", bank: "Belfius", role: "POT" },
  });
  if (confirmed.kind !== "ingested") {
    throw new Error("ingest failed");
  }
  return world;
};

// The baseline key of a row, which is what a rule written before this phase
// was stored as.
const baselineKeyOfRow = async (
  world: World,
  predicate: (description: string) => boolean,
): Promise<string> => {
  const counted = await world.merchantsPort.listCountedTransactions(context);
  const row = counted.find((candidate) => predicate(candidate.description));
  if (row === undefined) {
    throw new Error("no row matched the predicate");
  }
  const { normaliseCounterparty, counterpartyText } = await import(
    "../../src/modules/merchants/domain/normalise-counterparty"
  );
  return normaliseCounterparty(counterpartyText(row));
};

type Seed = {
  readonly world: World;
  readonly ruleIds: {
    readonly promotable: string;
    readonly promotableSecond: string;
    readonly unpromotable: string;
    readonly split: string;
    readonly severalAccounts: string;
    readonly alreadyNamespaced: string;
    readonly conflicting: string;
    readonly emptyPattern: string;
    readonly accountSquatter: string;
    readonly promotableIntoConflict: string;
  };
};

const seedWorld = async (): Promise<Seed> => {
  const world = await ingestFixture();
  const merchantA = await world.merchantsPort.createMerchant(context, "Alpha");
  const merchantB = await world.merchantsPort.createMerchant(context, "Beta");
  const merchantC = await world.merchantsPort.createMerchant(context, "Gamma");

  // (1) and (2) PROMOTABLE: one row each of two different counterparties,
  // both on trusted accounts, both named to the SAME merchant. Naming
  // reached one row each before; after promotion each reaches three.
  const promotable = await world.merchantsPort.upsertRule(context, {
    merchantId: merchantA.id,
    kind: "EXACT",
    pattern: await baselineKeyOfRow(world, (d) => d.includes("Premie kwartaal een")),
  });
  const promotableSecond = await world.merchantsPort.upsertRule(context, {
    merchantId: merchantA.id,
    kind: "EXACT",
    pattern: await baselineKeyOfRow(world, (d) => d.includes("Afrekening een")),
  });

  // (3) UNPROMOTABLE: a card row, which carries no counterparty account at
  // all, so pass two has nothing to promote to.
  const unpromotable = await world.merchantsPort.upsertRule(context, {
    merchantId: merchantB.id,
    kind: "EXACT",
    pattern: await baselineKeyOfRow(world, (d) => d.includes("Boekhandel")),
  });

  // (4) SPLIT: a PREFIX rule matching rows on BOTH bases, which is the shape
  // hazard H12.27 is about: its matched-after count legitimately differs
  // between the first and second run while its decision does not. It points
  // at the same merchant as (1) and (2), so the rows that leave it are
  // caught by the rules pass two adds and NOTHING is lost.
  const split = await world.merchantsPort.upsertRule(context, {
    merchantId: merchantA.id,
    kind: "PREFIX",
    pattern: "OVERSCHRIJVING NAAR",
  });

  // (5) SEVERAL ACCOUNTS: a glob whose matched rows all carry a TRUSTED
  // account but not the SAME one, which is the other reason pass two
  // declines to promote. It never wins a match, because the matcher tries
  // EXACT then PREFIX before PATTERN, so it holds no assignment to lose.
  const severalAccounts = await world.merchantsPort.upsertRule(context, {
    merchantId: merchantC.id,
    kind: "PATTERN",
    pattern: "OVERSCHRIJVING NAAR BE*",
  });

  // (6) ALREADY NAMESPACED: the shape of a naming made inside the deploy
  // window, before this routine ran. Pass one must leave it exactly as it is.
  const alreadyNamespaced = await world.merchantsPort.upsertRule(context, {
    merchantId: merchantC.id,
    kind: "EXACT",
    pattern: `${DESCRIPTOR_NAMESPACE}GEEN ENKELE RIJ DEMO`,
  });

  // (7) CONFLICTING: an un-namespaced rule for a DIFFERENT merchant whose
  // namespaced form would collide with (6). It matches no row, so the
  // conflict is a conflict and not also a lost assignment: those two
  // blocking conditions are witnessed separately, on purpose.
  const conflicting = await world.merchantsPort.upsertRule(context, {
    merchantId: merchantB.id,
    kind: "EXACT",
    pattern: "GEEN ENKELE RIJ DEMO",
  });

  // (9) and (10) A PASS-TWO MERCHANT CONFLICT, which is where the blocking
  // condition lives since fix round three moved pass one's collision from a
  // conflict to a supersede (finding CR3-M3P12-01). An EXACT rule already
  // holding an ACCOUNT pattern for merchant B, and a descriptor rule for
  // merchant A whose rows carry that same account: pass two promotes A's rule
  // to that account pattern, finds B's rule holding it, and blocks. This is a
  // genuine ambiguity a person must settle, unlike the pass-one case, because
  // both rules are live under the new key.
  // AN ACCOUNT-BASIS RULE ALREADY IN THE TABLE, which is what a naming made
  // inside decision D-46's deploy window looks like: assignMerchant writes a
  // namespaced subject from the moment the code deploys. It points at
  // merchant B and holds the account pass two is about to promote merchant
  // A's rule onto, so pass two blocks. It matches its rows immediately, which
  // is why the superset test below no longer starts from an empty observed
  // set: the window suspends the UN-NAMESPACED rules, not this one.
  const accountSquatter = await world.merchantsPort.upsertRule(context, {
    merchantId: merchantB.id,
    kind: "EXACT",
    pattern: `${ACCOUNT_NAMESPACE}${IDENTITY_FIXTURE_ACCOUNTS.counterparty2}`,
  });
  const promotableIntoConflict = await world.merchantsPort.upsertRule(context, {
    merchantId: merchantA.id,
    kind: "EXACT",
    pattern: await baselineKeyOfRow(world, (d) => d.includes("REFERTE 9000000101")),
  });

  // (8) EMPTY PATTERN: inert under the matcher today. Namespacing it would
  // make the bare namespace a live PREFIX matching every descriptor key.
  const emptyPattern = await world.merchantsPort.upsertRule(context, {
    merchantId: merchantC.id,
    kind: "PREFIX",
    pattern: "",
  });

  await recomputeInterpretation(context, world.ledgerDeps);
  return {
    world,
    ruleIds: {
      promotable: promotable.id,
      promotableSecond: promotableSecond.id,
      unpromotable: unpromotable.id,
      split: split.id,
      severalAccounts: severalAccounts.id,
      alreadyNamespaced: alreadyNamespaced.id,
      conflicting: conflicting.id,
      emptyPattern: emptyPattern.id,
      accountSquatter: accountSquatter.id,
      promotableIntoConflict: promotableIntoConflict.id,
    },
  };
};

// A SECOND seed whose only rule genuinely loses assignments: a PREFIX over
// rows spanning several counterparties, with nothing else pointing at that
// merchant. Pass two declines to promote it (several accounts), so the rows
// that move to the account basis have nothing left holding them. This is the
// LOST ASSIGNMENT blocking condition, witnessed on its own rather than
// tangled with the conflict.
const seedLossyWorld = async (): Promise<{
  world: World;
  ruleId: string;
}> => {
  const world = await ingestFixture();
  const merchant = await world.merchantsPort.createMerchant(context, "Delta");
  const rule = await world.merchantsPort.upsertRule(context, {
    merchantId: merchant.id,
    kind: "PREFIX",
    pattern: "OVERSCHRIJVING NAAR",
  });
  await recomputeInterpretation(context, world.ledgerDeps);
  return { world, ruleId: rule.id };
};

const deps = (world: World) => ({
  merchants: world.merchantsPort as Pick<
    MerchantRepositoryPort,
    | "listRules"
    | "listCountedTransactions"
    | "upsertRule"
    | "applyRuleWrites"
  >,
  recompute: (ctx: HouseholdContext) =>
    recomputeInterpretation(ctx, world.ledgerDeps),
});

const assignmentPairs = (world: World): ReadonlySet<string> =>
  new Set(
    world.transactions
      .filter((row) => row.merchantId !== undefined)
      .map((row) => `${row.id}:${row.merchantId ?? ""}`),
  );

describe("CRITERION 12.7: no naming the owner made is discarded, measured as EFFECT", () => {
  // WHICH "BEFORE" THIS COMPARES, said plainly rather than left to be
  // discovered, because the obvious reading of the criterion is VACUOUS in
  // this harness and a test that took it would pass while measuring nothing.
  // Running recompute before the re-derivation produces the EMPTY assignment
  // set: the code is already deployed at that point (decision D-46 runs the
  // routine after the deploy), so the matcher already computes identity keys
  // while the stored patterns are still pre-migration. That empty set is a
  // superset of nothing and would prove nothing.
  //
  // The comparison that carries the meaning is the one the routine itself
  // makes and refuses to finish without: the assignment set the stored rules
  // produced under the OLD key, which is what the owner's naming was
  // actually reaching when they made it, against the set the migrated rules
  // produce under the NEW key. Both are asserted below, and the recompute
  // pair is asserted too, as the window closing.
  test("the after assignment set is a SUPERSET of the pre-migration one, and the recompute that follows restores every assignment the deploy window suspended", async () => {
    const { world, ruleIds } = await seedWorld();
    const rulesBefore = world.rules.length;
    const observedBefore = assignmentPairs(world);

    const report = await rederiveMerchantRules(context, deps(world), {
      acceptedRuleIds: [ruleIds.promotableIntoConflict],
    });
    await recomputeInterpretation(context, world.ledgerDeps);
    const observedAfter = assignmentPairs(world);

    console.log(
      `routine assignment sets: before ${report.assignmentsBefore}, after ${report.assignmentsAfter}; lost ${report.lostAssignments.length}`,
    );
    console.log(
      `recompute-observed pairs: before ${observedBefore.size}, after ${observedAfter.size}; merchant_rules before ${rulesBefore}, after ${world.rules.length}`,
    );
    // THE SUPERSET, measured as EFFECT: not one transaction that carried a
    // merchant id loses it, and not one changes from one merchant to another.
    expect(report.assignmentsBefore).toBeGreaterThan(0);
    expect(report.lostAssignments).toEqual([]);
    expect(report.assignmentsAfter).toBeGreaterThanOrEqual(
      report.assignmentsBefore,
    );
    expect(report.exitCode).toBe(0);
    // SELECT COUNT(*) reported beside it, and NOT sufficient by itself: a
    // rule left byte-identical survives as a row and, once the key has
    // changed under it, matches nothing, so the row count would report a
    // dead naming as clean.
    expect(world.rules.length).toBeGreaterThanOrEqual(rulesBefore);
    // And the window closes: the rows the deploy left unresolved come back.
    // FIX ROUND THREE: the seed now also holds an account-basis rule written
    // inside the deploy window, and that one resolves its rows immediately,
    // so the observed set does not start empty. What the window suspends is
    // the un-namespaced rules, and the assertion that they come back is that
    // the observed set GROWS to the routine's own after-count.
    expect(observedBefore.size).toBeLessThan(observedAfter.size);
    expect(observedAfter.size).toBe(report.assignmentsAfter);
  });

  test("the routine issues NO update and NO delete against an account-namespaced pattern, and never rewrites a descriptor pattern into an account one", async () => {
    const { world, ruleIds } = await seedWorld();
    const updates: { ruleId: string; pattern: string }[] = [];
    const deletes: string[] = [];
    const patternsBefore = new Map(
      world.rules.map((rule) => [rule.id, rule.pattern]),
    );
    // FIX ROUND TWO: the routine issues its write set through ONE member, so
    // the spy sits there. FIX ROUND THREE: updateRulePattern is gone from the
    // port entirely (finding CR3-M3P12-07), so this is the only write path to
    // watch, which is the point of removing it.
    const spied = {
      ...world.merchantsPort,
      applyRuleWrites: async (
        ctx: HouseholdContext,
        input: Parameters<World["merchantsPort"]["applyRuleWrites"]>[1],
      ) => {
        updates.push(...input.updates.map((update) => ({ ...update })));
        return world.merchantsPort.applyRuleWrites(ctx, input);
      },
    };
    // The port carries no delete at all, which is the structural half of
    // decision D-39. Recorded rather than assumed.
    expect(
      Object.keys(world.merchantsPort).some((key) =>
        key.toLowerCase().includes("delete"),
      ),
    ).toBe(false);

    await rederiveMerchantRules(
      context,
      { merchants: spied, recompute: async () => undefined },
      // The conflict is ACCEPTED so the run is not blocked and the writes are
      // actually issued. Since the fix round a blocked run writes nothing at
      // all (finding HZ-M3P12-03), so without this the assertions below
      // would pass over an empty list and measure nothing.
      { acceptedRuleIds: [ruleIds.promotableIntoConflict] },
    );
    expect(deletes).toEqual([]);
    expect(updates.length).toBeGreaterThan(0);
    for (const update of updates) {
      const previous = patternsBefore.get(update.ruleId) ?? "";
      // Never an account-namespaced pattern on either side.
      expect(previous.startsWith(ACCOUNT_NAMESPACE)).toBe(false);
      expect(update.pattern.startsWith(ACCOUNT_NAMESPACE)).toBe(false);
      // The only rewrite pass one makes is prefixing a constant, so the old
      // pattern survives verbatim inside the new one. That is what makes the
      // run invertible by stripping a prefix.
      expect(update.pattern).toBe(`${DESCRIPTOR_NAMESPACE}${previous}`);
    }
    // Every rule row that existed before still exists after.
    for (const ruleId of patternsBefore.keys()) {
      expect(world.rules.some((rule) => rule.id === ruleId), ruleId).toBe(true);
    }
  });

  test("the promotion ADDS a rule beside the naming and the naming survives verbatim, and the broadening is a printed number", async () => {
    const { world, ruleIds } = await seedWorld();
    const report = await rederiveMerchantRules(context, deps(world), {
      acceptedRuleIds: [ruleIds.promotableIntoConflict],
    });
    const promotable = world.rules.find(
      (rule) => rule.id === ruleIds.promotable,
    );
    expect(promotable?.pattern.startsWith(DESCRIPTOR_NAMESPACE)).toBe(true);
    // The added rule points at the SAME merchant and is EXACT on the account.
    const added = world.rules.find(
      (rule) =>
        rule.pattern ===
        `${ACCOUNT_NAMESPACE}${IDENTITY_FIXTURE_ACCOUNTS.counterparty1}`,
    );
    expect(added).toBeDefined();
    expect(added?.merchantId).toBe(promotable?.merchantId);
    expect(added?.kind).toBe("EXACT");

    // The broadening is visible as a number rather than inferred: this rule
    // reached one row and now reaches three.
    const counts = report.counts.find(
      (row) => row.ruleId === ruleIds.promotable,
    );
    const promotionCounts = report.counts.filter(
      (row) => row.ruleId === ruleIds.promotable,
    );
    console.log(
      `promotable rule matched ${promotionCounts.map((c) => `${c.matchedBefore}->${c.matchedAfter}`).join(", ")}`,
    );
    expect(counts).toBeDefined();
    expect(report.broadened).toContain(ruleIds.promotable);
  });

  test("a rule that could not be promoted, for either reason, is printed, counted and does NOT block", async () => {
    const { world, ruleIds } = await seedWorld();
    const report = await rederiveMerchantRules(context, deps(world), {
      acceptedRuleIds: [ruleIds.promotableIntoConflict],
    });
    const outcomes = new Map(
      report.decisions
        .filter((decision) => decision.pass === "two")
        .map((decision) => [decision.ruleId, decision.outcome]),
    );
    // No account at all on the rows it reached.
    expect(outcomes.get(ruleIds.unpromotable)).toBe(
      "not-promoted-untrusted-account",
    );
    // Reached rows on both bases, so one of them carries an account the trust
    // gate refuses.
    expect(outcomes.get(ruleIds.split)).toBe("not-promoted-untrusted-account");
    // Reached rows whose accounts are all trusted but not all the same.
    expect(outcomes.get(ruleIds.severalAccounts)).toBe(
      "not-promoted-several-accounts",
    );
    // A pattern matching no row at all.
    expect(outcomes.get(ruleIds.alreadyNamespaced)).toBe(
      "not-promoted-no-matching-rows",
    );
    expect(report.exitCode).toBe(0);
  });

  test("pass one leaves an already-namespaced pattern and an empty pattern exactly as they are, on the FIRST run", async () => {
    const { world, ruleIds } = await seedWorld();
    const before = new Map(world.rules.map((rule) => [rule.id, rule.pattern]));
    const report = await rederiveMerchantRules(context, deps(world), {
      acceptedRuleIds: [ruleIds.promotableIntoConflict],
    });
    const after = new Map(world.rules.map((rule) => [rule.id, rule.pattern]));
    expect(after.get(ruleIds.alreadyNamespaced)).toBe(
      before.get(ruleIds.alreadyNamespaced),
    );
    expect(after.get(ruleIds.alreadyNamespaced)).not.toContain(
      `${DESCRIPTOR_NAMESPACE}${DESCRIPTOR_NAMESPACE}`,
    );
    expect(after.get(ruleIds.emptyPattern)).toBe("");
    expect(report.alreadyNamespaced).toBeGreaterThanOrEqual(1);
    const passOne = new Map(
      report.decisions
        .filter((decision) => decision.pass === "one")
        .map((decision) => [decision.ruleId, decision.outcome]),
    );
    expect(passOne.get(ruleIds.emptyPattern)).toBe("empty-pattern-left-alone");
    expect(passOne.get(ruleIds.alreadyNamespaced)).toBe("descriptor-namespaced");
  });

  test("BLOCKING CONDITION ONE, a merchant conflict: it blocks, and the acknowledge path clears ONLY the id it names", async () => {
    const unaccepted = await seedWorld();
    const blocked = await rederiveMerchantRules(
      context,
      deps(unaccepted.world),
      {},
    );
    console.log(
      `unaccepted run: conflicts ${blocked.conflicts.length}, lost ${blocked.lostAssignments.length}, exit ${blocked.exitCode}`,
    );
    expect(blocked.conflicts).toEqual([unaccepted.ruleIds.promotableIntoConflict]);
    expect(blocked.exitCode).toBe(1);

    // Accepting a DIFFERENT rule id clears nothing.
    const wrongId = await seedWorld();
    const stillBlocked = await rederiveMerchantRules(
      context,
      deps(wrongId.world),
      { acceptedRuleIds: [wrongId.ruleIds.promotable] },
    );
    expect(stillBlocked.conflicts).toEqual([wrongId.ruleIds.promotableIntoConflict]);
    expect(stillBlocked.exitCode).toBe(1);

    // Accepting the named id clears exactly that one.
    const acceptedRun = await seedWorld();
    const cleared = await rederiveMerchantRules(
      context,
      deps(acceptedRun.world),
      { acceptedRuleIds: [acceptedRun.ruleIds.promotableIntoConflict] },
    );
    expect(cleared.conflicts).toEqual([]);
    expect(cleared.acceptedConflicts).toEqual([
      acceptedRun.ruleIds.promotableIntoConflict,
    ]);
    expect(cleared.exitCode).toBe(0);
  });

  test("BLOCKING CONDITION TWO, a lost assignment: it blocks, and the acknowledge path clears ONLY the rule that held it", async () => {
    const lossy = await seedLossyWorld();
    const blocked = await rederiveMerchantRules(
      context,
      deps(lossy.world),
      {},
    );
    console.log(
      `lossy run: lost ${blocked.lostAssignments.length}, exit ${blocked.exitCode}`,
    );
    expect(blocked.conflicts).toEqual([]);
    expect(blocked.lostAssignments.length).toBeGreaterThan(0);
    for (const lost of blocked.lostAssignments) {
      expect(lost.ruleId).toBe(lossy.ruleId);
    }
    expect(blocked.exitCode).toBe(1);

    const wrongId = await seedLossyWorld();
    const stillBlocked = await rederiveMerchantRules(
      context,
      deps(wrongId.world),
      { acceptedRuleIds: ["some-other-rule-id"] },
    );
    expect(stillBlocked.lostAssignments.length).toBeGreaterThan(0);
    expect(stillBlocked.exitCode).toBe(1);

    const acceptedRun = await seedLossyWorld();
    const cleared = await rederiveMerchantRules(
      context,
      deps(acceptedRun.world),
      { acceptedRuleIds: [acceptedRun.ruleId] },
    );
    expect(cleared.lostAssignments).toEqual([]);
    expect(cleared.exitCode).toBe(0);
    // AND NOTHING WAS DELETED to achieve that: the rule is still there.
    expect(
      acceptedRun.world.rules.some((rule) => rule.id === acceptedRun.ruleId),
    ).toBe(true);
  });
});

describe("CRITERION 12.8: the re-derivation is idempotent, and idempotent means the same ANSWER", () => {
  test("a second run rewrites zero patterns, adds zero rules, prints the same decision report byte for byte and returns the same exit code", async () => {
    const { world, ruleIds } = await seedWorld();
    const accepted = { acceptedRuleIds: [ruleIds.promotableIntoConflict] };

    const first = await rederiveMerchantRules(context, deps(world), accepted);
    const tableAfterFirst = world.rules
      .map((rule) => `${rule.id}|${rule.kind}|${rule.pattern}|${rule.merchantId}`)
      .sort();

    const second = await rederiveMerchantRules(context, deps(world), accepted);
    const tableAfterSecond = world.rules
      .map((rule) => `${rule.id}|${rule.kind}|${rule.pattern}|${rule.merchantId}`)
      .sort();

    console.log(
      `run one: rewritten ${first.patternsRewritten}, added ${first.rulesAdded}, exit ${first.exitCode}; run two: rewritten ${second.patternsRewritten}, added ${second.rulesAdded}, exit ${second.exitCode}`,
    );
    expect(second.patternsRewritten).toBe(0);
    expect(second.rulesAdded).toBe(0);
    expect(formatDecisionReport(second)).toBe(formatDecisionReport(first));
    expect(second.exitCode).toBe(first.exitCode);
    // The FULL merchant_rules table is compared in full, not only the report.
    expect(tableAfterSecond).toEqual(tableAfterFirst);
  });

  test("the seed really does contain all three shapes, so the idempotence above is not measured on a dataset chosen to be easy", async () => {
    const { world, ruleIds } = await seedWorld();
    const report = await rederiveMerchantRules(context, deps(world), {});
    const passTwo = new Map(
      report.decisions
        .filter((d) => d.pass === "two")
        .map((d) => [d.ruleId, d.outcome]),
    );
    // A rule that cannot be promoted.
    expect(passTwo.get(ruleIds.unpromotable)).toBe(
      "not-promoted-untrusted-account",
    );
    expect(passTwo.get(ruleIds.severalAccounts)).toBe(
      "not-promoted-several-accounts",
    );
    // A rule whose matched rows split across the two bases: it matched rows
    // under the old key and its namespaced form reaches strictly fewer,
    // because the account-basis rows moved to the other namespace.
    const splitCounts = report.counts.find((c) => c.ruleId === ruleIds.split);
    expect(splitCounts).toBeDefined();
    console.log(
      `split rule matched-before ${splitCounts?.matchedBefore} matched-after ${splitCounts?.matchedAfter}`,
    );
    expect(splitCounts?.matchedBefore ?? 0).toBeGreaterThan(
      splitCounts?.matchedAfter ?? 0,
    );
    // A merchant conflict.
    expect(report.conflicts).toContain(ruleIds.promotableIntoConflict);
    // And the two pass-one guards, REACHED rather than merely present.
    const passOne = new Map(
      report.decisions
        .filter((d) => d.pass === "one")
        .map((d) => [d.ruleId, d.outcome]),
    );
    expect(passOne.get(ruleIds.emptyPattern)).toBe("empty-pattern-left-alone");
    expect(report.alreadyNamespaced).toBeGreaterThanOrEqual(1);
  });

  test("a second run does NOT have to exit 0, and this seed proves it: the conflict persists because nothing is deleted", async () => {
    const { world } = await seedWorld();
    const first = await rederiveMerchantRules(context, deps(world), {});
    const second = await rederiveMerchantRules(context, deps(world), {});
    expect(first.exitCode).toBe(1);
    expect(second.exitCode).toBe(1);
    expect(formatDecisionReport(second)).toBe(formatDecisionReport(first));
  });
});

describe("CRITERION 12.9: facts are not rewritten; the change is a derivation plus a recompute", () => {
  test("the re-derivation issues NO write against the transactions table at all", async () => {
    const { world, ruleIds } = await seedWorld();
    const factSnapshot = (): string =>
      JSON.stringify(
        world.transactions.map((row) => ({
          id: row.id,
          bookingDate: row.bookingDate,
          amountCents: row.amountCents,
          description: row.description,
          counterpartyIban: row.counterpartyIban,
          counterpartyName: row.counterpartyName,
          rawLine: row.rawLine,
          dedupKey: row.dedupKey,
        })),
      );
    const before = factSnapshot();
    await rederiveMerchantRules(
      context,
      // NO recompute bound, so nothing but the routine itself can touch a
      // row: if a transaction moves here, the routine moved it.
      { merchants: world.merchantsPort, recompute: async () => undefined },
      // ACCEPTED so the run APPLIES its writes: since the fix round a blocked
      // run issues none, and "no transaction was written" is only worth
      // asserting over a run that wrote everything it was going to write.
      { acceptedRuleIds: [ruleIds.promotableIntoConflict] },
    );
    expect(factSnapshot()).toBe(before);
  });

  test("clearing every merchant id and recomputing returns the IDENTICAL assignment set, so the naming survives as a declaration plus a derivation", async () => {
    const { world, ruleIds } = await seedWorld();
    await rederiveMerchantRules(context, deps(world), {
      acceptedRuleIds: [ruleIds.promotableIntoConflict],
    });
    await recomputeInterpretation(context, world.ledgerDeps);
    const before = assignmentPairs(world);
    expect(before.size).toBeGreaterThan(0);

    for (const row of world.transactions) {
      // pulse-domain section 2: merchantId is INTERPRETATION output, so
      // clearing it is legitimate here and recompute is what must put it
      // back. The delete keeps exactOptionalPropertyTypes honest.
      delete (row as { merchantId?: string }).merchantId;
    }
    expect(assignmentPairs(world).size).toBe(0);

    await recomputeInterpretation(context, world.ledgerDeps);
    expect(assignmentPairs(world)).toEqual(before);
  });
});

// =====================================================================
// FIX ROUND. Findings HZ-M3P12-02, HZ-M3P12-03, HZ-M3P12-06 and
// CR-M3P12-01. Every one of these is about a write that happened when the
// routine said it would not, or a fact the report did not carry, so every
// one of them is measured by COUNTING REPOSITORY CALLS rather than by
// reading the report the routine chose to print.
// =====================================================================

type WriteLog = {
  readonly updates: string[];
  readonly inserts: string[];
  readonly recomputes: { count: number };
};

const countingDeps = (world: World): { deps: ReturnType<typeof deps>; log: WriteLog } => {
  const log: WriteLog = { updates: [], inserts: [], recomputes: { count: 0 } };
  const merchants = {
    ...world.merchantsPort,
    upsertRule: async (
      ctx: HouseholdContext,
      input: Parameters<World["merchantsPort"]["upsertRule"]>[1],
    ) => {
      log.inserts.push(input.kind);
      return world.merchantsPort.upsertRule(ctx, input);
    },
  };
  // FIX ROUND TWO: the routine now issues its whole write set through ONE
  // port member so the adapter can run it in a transaction, so the recorder
  // has to sit there too. It routes back through the two spied members above,
  // which is what keeps the update and insert logs meaningful, and it keeps
  // the fake's all-or-nothing behaviour by delegating to the fake's own
  // implementation.
  const withApply = {
    ...merchants,
    applyRuleWrites: async (
      ctx: HouseholdContext,
      input: Parameters<World["merchantsPort"]["applyRuleWrites"]>[1],
    ) => {
      log.updates.push(...input.updates.map((update) => update.ruleId));
      log.inserts.push(...input.inserts.map((insert) => insert.kind));
      return world.merchantsPort.applyRuleWrites(ctx, input);
    },
  };
  return {
    deps: {
      merchants: withApply as Pick<
        MerchantRepositoryPort,
        | "listRules"
        | "listCountedTransactions"
        | "upsertRule"
        | "applyRuleWrites"
      >,
      recompute: async (ctx: HouseholdContext) => {
        log.recomputes.count += 1;
        return recomputeInterpretation(ctx, world.ledgerDeps);
      },
    },
    log,
  };
};

describe("HZ-M3P12-02: --dry-run writes NOTHING", () => {
  test("a dry run issues no update, no insert and no recompute, and returns the report a real run returns", async () => {
    const dry = await seedWorld();
    const dryRun = countingDeps(dry.world);
    const patternsBefore = dry.world.rules
      .map((rule) => `${rule.id}|${rule.pattern}`)
      .sort();
    const previewed = await rederiveMerchantRules(context, dryRun.deps, {
      acceptedRuleIds: [dry.ruleIds.promotableIntoConflict],
      dryRun: true,
    });

    console.log(
      `dry run: updates ${dryRun.log.updates.length}, inserts ${dryRun.log.inserts.length}, recomputes ${dryRun.log.recomputes.count}, applied ${String(previewed.applied)}`,
    );
    expect(dryRun.log.updates).toEqual([]);
    expect(dryRun.log.inserts).toEqual([]);
    expect(dryRun.log.recomputes.count).toBe(0);
    expect(previewed.applied).toBe(false);
    // THE DATABASE IS UNTOUCHED, which is the whole promise of the word.
    expect(
      dry.world.rules.map((rule) => `${rule.id}|${rule.pattern}`).sort(),
    ).toEqual(patternsBefore);

    // AND THE REPORT IS THE ONE A REAL RUN PRODUCES, so a preview is worth
    // reading. Measured against a SECOND identical seed run for real.
    const wet = await seedWorld();
    const realRun = countingDeps(wet.world);
    const applied = await rederiveMerchantRules(context, realRun.deps, {
      acceptedRuleIds: [wet.ruleIds.promotableIntoConflict],
    });
    console.log(
      `real run: updates ${realRun.log.updates.length}, inserts ${realRun.log.inserts.length}, recomputes ${realRun.log.recomputes.count}, applied ${String(applied.applied)}`,
    );
    expect(formatDecisionReport(previewed)).toBe(formatDecisionReport(applied));
    expect(previewed.exitCode).toBe(applied.exitCode);
    expect(previewed.patternsRewritten).toBe(applied.patternsRewritten);
    expect(previewed.rulesAdded).toBe(applied.rulesAdded);
    expect(previewed.rulesAfter).toBe(applied.rulesAfter);
    expect(previewed.assignmentsAfter).toBe(applied.assignmentsAfter);
    // And the real run really did write, so the comparison above is between
    // a preview and something rather than between two nothings.
    expect(applied.applied).toBe(true);
    expect(realRun.log.updates.length).toBeGreaterThan(0);
    expect(realRun.log.inserts.length).toBeGreaterThan(0);
    expect(realRun.log.recomputes.count).toBe(1);
  });

  test("the script passes the flag INTO the routine rather than substituting a no-op recompute", () => {
    const script = readFileSync(
      join(__dirname, "..", "..", "scripts", "rederive-merchant-rules.ts"),
      "utf8",
    );
    expect(script).toMatch(/dryRun/);
    expect(script).toMatch(/\{ acceptedRuleIds: accepted, dryRun \}/);
    // The substitution that made the flag a lie.
    expect(script).not.toMatch(/recompute: dryRun/);
  });
});

describe("HZ-M3P12-03: a blocking condition blocks BEFORE any write", () => {
  test("a merchant conflict issues no update, no insert and no recompute, and leaves every pattern verbatim", async () => {
    const seed = await seedWorld();
    const counting = countingDeps(seed.world);
    const patternsBefore = seed.world.rules
      .map((rule) => `${rule.id}|${rule.pattern}`)
      .sort();
    const rulesBefore = seed.world.rules.length;

    const blocked = await rederiveMerchantRules(context, counting.deps, {});

    console.log(
      `blocked conflict run: exit ${blocked.exitCode}, updates ${counting.log.updates.length}, inserts ${counting.log.inserts.length}, recomputes ${counting.log.recomputes.count}`,
    );
    expect(blocked.exitCode).toBe(1);
    expect(blocked.conflicts.length).toBeGreaterThan(0);
    expect(blocked.applied).toBe(false);
    expect(counting.log.updates).toEqual([]);
    expect(counting.log.inserts).toEqual([]);
    expect(counting.log.recomputes.count).toBe(0);
    expect(seed.world.rules).toHaveLength(rulesBefore);
    expect(
      seed.world.rules.map((rule) => `${rule.id}|${rule.pattern}`).sort(),
    ).toEqual(patternsBefore);
  });

  test("a LOST ASSIGNMENT blocks before the recompute, so no transaction is moved to a different merchant", async () => {
    const lossy = await seedLossyWorld();
    const counting = countingDeps(lossy.world);
    const assignedBefore = assignmentPairs(lossy.world);

    const blocked = await rederiveMerchantRules(context, counting.deps, {});

    console.log(
      `blocked lossy run: exit ${blocked.exitCode}, lost ${blocked.lostAssignments.length}, recomputes ${counting.log.recomputes.count}`,
    );
    expect(blocked.exitCode).toBe(1);
    expect(blocked.lostAssignments.length).toBeGreaterThan(0);
    expect(blocked.applied).toBe(false);
    expect(counting.log.updates).toEqual([]);
    expect(counting.log.inserts).toEqual([]);
    // THE RECOMPUTE IS THE ONE THAT CARRIES THE LOSS ONTO A ROW. It must not
    // have run, and the rows must still hold what they held.
    expect(counting.log.recomputes.count).toBe(0);
    expect(assignmentPairs(lossy.world)).toEqual(assignedBefore);
  });

  test("THE ACKNOWLEDGE PATH IS USABLE FIRST: the ids a person must accept are learnable from a run that wrote nothing", async () => {
    const seed = await seedWorld();
    const counting = countingDeps(seed.world);
    const blocked = await rederiveMerchantRules(context, counting.deps, {
      dryRun: true,
    });
    expect(counting.log.updates).toEqual([]);
    expect(counting.log.inserts).toEqual([]);
    expect(blocked.conflicts).toEqual([seed.ruleIds.promotableIntoConflict]);

    // And accepting exactly those ids on the SAME world then applies.
    const cleared = await rederiveMerchantRules(context, counting.deps, {
      acceptedRuleIds: blocked.conflicts,
    });
    expect(cleared.exitCode).toBe(0);
    expect(cleared.applied).toBe(true);
    expect(counting.log.updates.length).toBeGreaterThan(0);
  });
});

describe("CR-M3P12-01: an accepted loss is printed, counted and named", () => {
  test("acceptance removes a lost assignment from the BLOCKING decision and from nothing else", async () => {
    const accepted = await seedLossyWorld();
    const report = await rederiveMerchantRules(context, deps(accepted.world), {
      acceptedRuleIds: [accepted.ruleId],
    });
    console.log(
      `accepted-loss run: lost ${report.lostAssignments.length}, accepted-lost ${report.acceptedLostAssignments.length}, exit ${report.exitCode}`,
    );
    expect(report.exitCode).toBe(0);
    expect(report.applied).toBe(true);
    // Not blocking...
    expect(report.lostAssignments).toEqual([]);
    // ...and NOT invisible. This is the assertion whose absence let a run
    // that lost one of the owner's namings print lost-assignments 0.
    expect(report.acceptedLostAssignments.length).toBeGreaterThan(0);
    for (const lost of report.acceptedLostAssignments) {
      expect(lost.ruleId).toBe(accepted.ruleId);
      expect(lost.transactionId).not.toBe("");
    }
    // A run with nothing to lose carries an empty list, so the field is a
    // measurement rather than a constant. The deploy-window seed is the clean
    // one: one merchant, one superseded rule, nothing contested.
    const clean = await seedDeployWindowWorld();
    const cleanReport = await rederiveMerchantRules(context, deps(clean.world), {});
    expect(cleanReport.exitCode).toBe(0);
    expect(cleanReport.acceptedLostAssignments).toEqual([]);
    expect(cleanReport.lostAssignments).toEqual([]);
  });

  test("the script prints the accepted losses, so the report a person reads carries them", () => {
    const script = readFileSync(
      join(__dirname, "..", "..", "scripts", "rederive-merchant-rules.ts"),
      "utf8",
    );
    expect(script).toMatch(/accepted-lost-assignments \$\{report\.acceptedLostAssignments\.length\}/);
    expect(script).toMatch(/accepted-lost-transaction/);
  });
});

describe("HZ-M3P12-06: a promotion backed by ONE row says so", () => {
  test("a one-row promotion carries its own outcome token and is listed, and a many-row promotion is not", async () => {
    const seed = await seedWorld();
    const report = await rederiveMerchantRules(context, deps(seed.world), {
      acceptedRuleIds: [seed.ruleIds.promotableIntoConflict],
    });
    const outcomes = new Map(
      report.decisions
        .filter((decision) => decision.pass === "two")
        .map((decision) => [decision.ruleId, decision.outcome]),
    );
    const counts = new Map(
      report.counts.map((row) => [row.ruleId, row.matchedBefore]),
    );
    console.log(
      `one-row promotions ${report.promotedOnOneRow.length} of ${[...outcomes.values()].filter((o) => o.startsWith("promoted")).length} promotions`,
    );
    // The seed's promotable rules are each written from ONE row, which is
    // the owner's own shape, so they are the case this token exists for.
    expect(counts.get(seed.ruleIds.promotable)).toBe(1);
    expect(outcomes.get(seed.ruleIds.promotable)).toBe("promoted-on-one-row");
    expect(report.promotedOnOneRow).toContain(seed.ruleIds.promotable);
    expect(report.promotedOnOneRow).toContain(seed.ruleIds.promotableSecond);
    // AND THE TOKEN IS STABLE ACROSS RUNS, which criterion 12.8 requires of
    // the whole decision report: matchedBefore is counted under the OLD key,
    // so a second run reaches the same answer.
    const second = await rederiveMerchantRules(context, deps(seed.world), {
      acceptedRuleIds: [seed.ruleIds.promotableIntoConflict],
    });
    expect(formatDecisionReport(second)).toBe(formatDecisionReport(report));
  });

  test("the plain promoted token still exists, so the one-row token is a distinction and not a rename", async () => {
    const seed = await seedWorld();
    // A PREFIX over a counterparty NO other seeded rule points at, whose
    // rows all carry the same trusted account. It must not be the
    // counterparty the seed's pass-two conflict uses, or it joins that
    // conflict instead of promoting. It matches several rows under
    // the old key, so its promotion is backed by several agreeing rows.
    const merchant = await seed.world.merchantsPort.createMerchant(
      context,
      "Epsilon",
    );
    const many = await seed.world.merchantsPort.upsertRule(context, {
      merchantId: merchant.id,
      kind: "PREFIX",
      pattern: "STORTING VAN",
    });
    const report = await rederiveMerchantRules(context, deps(seed.world), {
      acceptedRuleIds: [seed.ruleIds.promotableIntoConflict],
    });
    const decision = report.decisions.find(
      (d) => d.ruleId === many.id && d.pass === "two",
    );
    const matchedBefore = report.counts.find(
      (c) => c.ruleId === many.id,
    )?.matchedBefore;
    console.log(
      `many-row rule matched-before ${matchedBefore ?? 0}, outcome ${decision?.outcome ?? "none"}`,
    );
    expect(matchedBefore ?? 0).toBeGreaterThan(1);
    expect(decision?.outcome).toBe("promoted");
    expect(report.promotedOnOneRow).not.toContain(many.id);
  });
});

// =====================================================================
// FIX ROUND TWO. Findings CR2-M3P12-02 and HZ-M3P12-R2-01, found
// independently by both clean-room lanes: a SAME-MERCHANT pattern collision
// was not a conflict, was not reported, and crashed the migration part way
// through applying. The fake below enforces the unique key the schema
// declares, which is what makes these tests able to see it at all; before
// this round it modelled rule identity, kind and pattern and not the one
// constraint the real table enforces over exactly those three fields.
// =====================================================================

// THE DEPLOY WINDOW SHAPE, seeded exactly. Decision D-46 deploys the code
// before this routine runs, so the owner's pre-migration rules match nothing,
// their rows show as unresolved, and the owner names those groups again.
// findMerchantByName reuses the merchant, so a namespaced EXACT rule lands
// beside the old un-namespaced one FOR THE SAME MERCHANT.
// THE KIND IS A PARAMETER (fix round four, CRITERIA finding CR4-M3P12-03).
// supersede treatment rests on an argument about EQUALITY, so it holds for
// EXACT and for nothing else; the same shape at kind PREFIX must reach the
// conservative branch, and a seed that can only build EXACT cannot show that.
const seedDeployWindowWorld = async (
  kind: "EXACT" | "PREFIX" = "EXACT",
): Promise<{
  world: World;
  oldRuleId: string;
  twinRuleId: string;
  merchantId: string;
}> => {
  const world = await ingestFixture();
  const merchant = await world.merchantsPort.createMerchant(context, "Alpha");
  const bare = await baselineKeyOfRow(world, (d) =>
    d.includes("Premie kwartaal een"),
  );
  const old = await world.merchantsPort.upsertRule(context, {
    merchantId: merchant.id,
    kind,
    pattern: bare,
  });
  const twin = await world.merchantsPort.upsertRule(context, {
    merchantId: merchant.id,
    kind,
    pattern: `${DESCRIPTOR_NAMESPACE}${bare}`,
  });
  await recomputeInterpretation(context, world.ledgerDeps);
  return {
    world,
    oldRuleId: old.id,
    twinRuleId: twin.id,
    merchantId: merchant.id,
  };
};

describe("CR2-M3P12-02 and HZ-M3P12-R2-01: a same-merchant collision is DECIDED, not thrown", () => {
  test("the D-46 window shape: no update is issued against the colliding rule, the run exits 0, and nothing throws", async () => {
    const seed = await seedDeployWindowWorld();
    const counting = countingDeps(seed.world);
    const patternsBefore = seed.world.rules
      .map((rule) => `${rule.id}|${rule.pattern}`)
      .sort();

    const report = await rederiveMerchantRules(context, counting.deps, {});

    console.log(
      `deploy-window run: exit ${report.exitCode}, updates ${counting.log.updates.length}, twin-outcomes ${report.alreadyHeldBySameMerchantTwin.length}`,
    );
    expect(report.exitCode).toBe(0);
    // The colliding rule is NOT updated. Before this round the routine queued
    // exactly this update and the unique key refused it mid-apply.
    expect(counting.log.updates).not.toContain(seed.oldRuleId);
    // It is REPORTED rather than silent, with its own outcome token.
    expect(report.alreadyHeldBySameMerchantTwin).toContain(seed.oldRuleId);
    const outcome = report.decisions.find(
      (decision) => decision.ruleId === seed.oldRuleId && decision.pass === "one",
    )?.outcome;
    expect(outcome).toBe("already-held-by-same-merchant-twin");
    // The source rule survives verbatim: decision D-39 forbids deleting it,
    // and this round does not rewrite it either.
    const after = seed.world.rules.find((rule) => rule.id === seed.oldRuleId);
    expect(after).toBeDefined();
    expect(
      patternsBefore.includes(`${seed.oldRuleId}|${after?.pattern ?? ""}`),
    ).toBe(true);
    // AND NOTHING IS LOST, which is what makes leaving it alone correct: the
    // twin reaches under the new key every row the old rule reached under the
    // old one.
    expect(report.lostAssignments).toEqual([]);
  });

  test("PARTIAL APPLICATION IS UNREACHABLE: a clean rewrite and a colliding one in the same run leave no half-migrated table", async () => {
    const seed = await seedDeployWindowWorld();
    // A third rule whose rewrite is clean, so the run has both shapes in it.
    const other = await seed.world.merchantsPort.createMerchant(context, "Beta");
    const cleanRule = await seed.world.merchantsPort.upsertRule(context, {
      merchantId: other.id,
      kind: "EXACT",
      pattern: await baselineKeyOfRow(seed.world, (d) => d.includes("Boekhandel")),
    });
    const counting = countingDeps(seed.world);

    const report = await rederiveMerchantRules(context, counting.deps, {});

    console.log(
      `mixed run: exit ${report.exitCode}, updates ${counting.log.updates.length}, applied ${String(report.applied)}`,
    );
    expect(report.exitCode).toBe(0);
    expect(report.applied).toBe(true);
    // The clean one IS rewritten, so the run did its work.
    expect(counting.log.updates).toContain(cleanRule.id);
    expect(
      seed.world.rules.find((rule) => rule.id === cleanRule.id)?.pattern,
    ).toMatch(new RegExp(`^${DESCRIPTOR_NAMESPACE}`));
    // The colliding one is left alone, and no exception reached the caller,
    // so there is no half-migrated state to recover from.
    expect(counting.log.updates).not.toContain(seed.oldRuleId);
    expect(counting.log.recomputes.count).toBe(1);
  });

  // FIX ROUND THREE, finding CR3-M3P12-01. A pass-one claimant carrying a
  // DIFFERENT merchant is not a conflict either. It used to be, and that made
  // the next ordinary re-naming a permanent block: the un-namespaced rule the
  // shipped matcher can never apply again was reported as a merchant conflict
  // AND as a lost assignment for a row whose merchant the owner had just
  // changed on the screen, and decision D-39 forbids deleting the dead row,
  // so the condition never cleared on its own.
  test("A PASS-ONE claimant carrying a DIFFERENT merchant SUPERSEDES rather than blocking, and reports no loss", async () => {
    const seed = await seedDeployWindowWorld();
    // The owner re-names the group to a DIFFERENT merchant, which upsertRule
    // applies by moving the namespaced rule's merchantId. One form submission.
    const rival = await seed.world.merchantsPort.createMerchant(context, "Gamma");
    const twin = seed.world.rules.find((rule) => rule.id === seed.twinRuleId);
    expect(twin).toBeDefined();
    await seed.world.merchantsPort.upsertRule(context, {
      merchantId: rival.id,
      kind: "EXACT",
      pattern: twin?.pattern ?? "",
    });
    const counting = countingDeps(seed.world);

    const report = await rederiveMerchantRules(context, counting.deps, {});

    console.log(
      `pass-one different merchant: exit ${report.exitCode}, conflicts ${report.conflicts.length}, lost ${report.lostAssignments.length}, superseded ${report.supersededByNamespacedRule.length}`,
    );
    expect(report.exitCode).toBe(0);
    expect(report.applied).toBe(true);
    expect(report.conflicts).toEqual([]);
    // THE LOSS THAT NEVER HAPPENED. In production the row carries the rival's
    // merchant both before and after, because a bare pattern cannot match a
    // namespaced key; the old merchant existed only in the routine's own
    // before-set, which now excludes superseded rules.
    expect(report.lostAssignments).toEqual([]);
    expect(report.supersededByNamespacedRule).toContain(seed.oldRuleId);
    const outcome = report.decisions.find(
      (decision) => decision.ruleId === seed.oldRuleId,
    )?.outcome;
    expect(outcome).toBe("superseded-by-namespaced-rule");
    // The dead rule is neither rewritten nor deleted: D-39.
    expect(counting.log.updates).not.toContain(seed.oldRuleId);
    expect(
      seed.world.rules.some((rule) => rule.id === seed.oldRuleId),
    ).toBe(true);
  });

  // FIX ROUND FOUR, CRITERIA finding CR4-M3P12-03. The supersede rests on an
  // argument about EQUALITY: a bare pattern can never equal a namespaced key,
  // because every key carries a lowercase namespace and nothing uppercases
  // into an ASCII lowercase letter. That argument says nothing about a glob or
  // a prefix, and a reviewer disproved the generalisation against the shipped
  // matcher: a PATTERN rule beginning with a star matches a namespaced key,
  // and a PREFIX rule whose pattern is a prefix of the NAMESPACE matches every
  // key of that basis. So the treatment splits on kind, and these two tests
  // are what keep it split.
  test("A PASS-ONE claimant at kind PREFIX carrying a DIFFERENT merchant BLOCKS rather than superseding", async () => {
    const seed = await seedDeployWindowWorld("PREFIX");
    const rival = await seed.world.merchantsPort.createMerchant(context, "Gamma");
    const twin = seed.world.rules.find((rule) => rule.id === seed.twinRuleId);
    await seed.world.merchantsPort.upsertRule(context, {
      merchantId: rival.id,
      kind: "PREFIX",
      pattern: twin?.pattern ?? "",
    });
    const counting = countingDeps(seed.world);

    const report = await rederiveMerchantRules(context, counting.deps, {});

    console.log(
      `pass-one PREFIX different merchant: exit ${report.exitCode}, conflicts ${report.conflicts.length}, superseded ${report.supersededByNamespacedRule.length}`,
    );
    expect(report.conflicts).toContain(seed.oldRuleId);
    expect(report.supersededByNamespacedRule).toEqual([]);
    expect(report.exitCode).toBe(1);
    expect(report.applied).toBe(false);
    const outcome = report.decisions.find(
      (decision) => decision.ruleId === seed.oldRuleId,
    )?.outcome;
    expect(outcome).toBe("merchant-conflict");
    // And it has the ordinary acknowledge path, like every other conflict.
    const accepted = await rederiveMerchantRules(context, countingDeps(seed.world).deps, {
      acceptedRuleIds: [seed.oldRuleId],
    });
    expect(accepted.conflicts).toEqual([]);
    expect(accepted.acceptedConflicts).toContain(seed.oldRuleId);
  });

  test("A PASS-ONE claimant at kind PREFIX carrying the SAME merchant is still a skip: no row can change hands", async () => {
    const seed = await seedDeployWindowWorld("PREFIX");
    const counting = countingDeps(seed.world);

    const report = await rederiveMerchantRules(context, counting.deps, {});

    expect(report.alreadyHeldBySameMerchantTwin).toContain(seed.oldRuleId);
    expect(report.supersededByNamespacedRule).toEqual([]);
    expect(report.conflicts).toEqual([]);
    expect(counting.log.updates).not.toContain(seed.oldRuleId);
  });

  // THE ASSUMPTION, PINNED SO IT GOES RED RATHER THAN SILENT. Only EXACT rules
  // may ever reach the superseded list. The day a PREFIX or PATTERN rule is
  // written and collides, this fails instead of quietly treating a live rule
  // as dead.
  test("EVERY superseded rule is EXACT, on a run that produces one", async () => {
    const seed = await seedDeployWindowWorld();
    const rival = await seed.world.merchantsPort.createMerchant(context, "Gamma");
    const twin = seed.world.rules.find((rule) => rule.id === seed.twinRuleId);
    await seed.world.merchantsPort.upsertRule(context, {
      merchantId: rival.id,
      kind: "EXACT",
      pattern: twin?.pattern ?? "",
    });

    const report = await rederiveMerchantRules(context, countingDeps(seed.world).deps, {});

    expect(report.supersededByNamespacedRule.length).toBeGreaterThan(0);
    for (const ruleId of report.supersededByNamespacedRule) {
      const rule = seed.world.rules.find((candidate) => candidate.id === ruleId);
      expect(rule?.kind).toBe("EXACT");
    }
  });

  test("A PASS-TWO collision between DIFFERENT merchants still BLOCKS, so the blocking condition is a distinction and not gone", async () => {
    const seed = await seedWorld();
    const counting = countingDeps(seed.world);

    const report = await rederiveMerchantRules(context, counting.deps, {});

    console.log(
      `pass-two conflict: exit ${report.exitCode}, conflicts ${report.conflicts.length}, updates ${counting.log.updates.length}`,
    );
    expect(report.conflicts).toContain(seed.ruleIds.promotableIntoConflict);
    expect(report.exitCode).toBe(1);
    expect(report.applied).toBe(false);
    expect(counting.log.updates).toEqual([]);
    const outcome = report.decisions.find(
      (decision) =>
        decision.ruleId === seed.ruleIds.promotableIntoConflict &&
        decision.pass === "two",
    )?.outcome;
    expect(outcome).toBe("merchant-conflict");
  });

  test("THE FAKE ENFORCES THE UNIQUE KEY, so these tests can see what the schema refuses", async () => {
    const seed = await seedDeployWindowWorld();
    const twin = seed.world.rules.find((rule) => rule.id === seed.twinRuleId);
    expect(twin).toBeDefined();
    await expect(
      seed.world.merchantsPort.applyRuleWrites(context, {
        updates: [{ ruleId: seed.oldRuleId, pattern: twin?.pattern ?? "" }],
        inserts: [],
      }),
    ).rejects.toThrow(/Unique constraint failed/);
  });

  test("the second run prints the same decision report, so the new outcome is stable", async () => {
    const seed = await seedDeployWindowWorld();
    const first = await rederiveMerchantRules(context, deps(seed.world), {});
    const second = await rederiveMerchantRules(context, deps(seed.world), {});
    expect(formatDecisionReport(second)).toBe(formatDecisionReport(first));
    expect(second.exitCode).toBe(first.exitCode);
  });
});

describe("CR2-M3P12-03: the write set is applied ALL OR NOTHING", () => {
  test("the routine issues its writes through ONE port member, which the adapter runs in a transaction", () => {
    const source = readFileSync(
      join(
        repositoryRoot,
        "src/modules/merchants/application/rederive-rules.ts",
      ),
      "utf8",
    );
    // One call, not a loop of separate awaits.
    expect(source).toContain("deps.merchants.applyRuleWrites(context, {");
    expect(source).not.toMatch(/for \(const update of pendingUpdates\) \{\s*await/);
    expect(source).not.toMatch(/for \(const insert of pendingInserts\) \{\s*await/);
    const adapter = readFileSync(
      join(
        repositoryRoot,
        "src/modules/merchants/adapters/merchant-repository.ts",
      ),
      "utf8",
    );
    expect(adapter).toContain("prisma.$transaction(async (tx)");
    // Every statement in it still carries the household id: the update's
    // where clause and the insert's data both name it.
    const block = adapter.slice(adapter.indexOf("export const applyRuleWrites"));
    expect(block).toContain("where: { id: update.ruleId, householdId: context.householdId }");
    expect(block).toContain("householdId: context.householdId,");
  });

  test("a rejection anywhere in the write set leaves the table as the run found it", async () => {
    const seed = await seedWorld();
    const patternsBefore = seed.world.rules
      .map((rule) => `${rule.id}|${rule.pattern}`)
      .sort();
    // A write set whose SECOND update is refused. The fake restores its array
    // on any rejection, exactly as the adapter's transaction rolls back.
    const first = seed.world.rules[0];
    expect(first).toBeDefined();
    await expect(
      seed.world.merchantsPort.applyRuleWrites(context, {
        updates: [
          { ruleId: first?.id ?? "", pattern: "descriptor:SOMETHING NEW" },
          { ruleId: "a-rule-that-does-not-exist", pattern: "descriptor:X" },
        ],
        inserts: [],
      }),
    ).rejects.toThrow();
    expect(
      seed.world.rules.map((rule) => `${rule.id}|${rule.pattern}`).sort(),
    ).toEqual(patternsBefore);
  });
});

describe("HZ-M3P12-R2-03: the superset guard is alive on every run, not only the first", () => {
  test("the SECOND run's before-set equals the FIRST run's after-set, rather than reading 0", async () => {
    const { world, ruleIds } = await seedWorld();
    const accepted = { acceptedRuleIds: [ruleIds.promotableIntoConflict] };
    const first = await rederiveMerchantRules(context, deps(world), accepted);
    const second = await rederiveMerchantRules(context, deps(world), accepted);
    console.log(
      `run 1 before/after ${first.assignmentsBefore}/${first.assignmentsAfter}; run 2 before/after ${second.assignmentsBefore}/${second.assignmentsAfter}`,
    );
    // Before this round the second run reported before 0, so allLost was
    // empty by construction and the lost-assignment half of the exit code
    // could not be reached while the run still wrote and still recomputed.
    expect(first.assignmentsAfter).toBeGreaterThan(0);
    expect(second.assignmentsBefore).toBe(first.assignmentsAfter);
    expect(second.assignmentsAfter).toBe(second.assignmentsBefore);
  });

  test("a HALF-MIGRATED table is read correctly: the un-migrated rules under the baseline key and the migrated ones under the identity key", async () => {
    const { world, ruleIds } = await seedWorld();
    // Migrate exactly one rule by hand, leaving the rest pre-migration.
    const target = world.rules.find((rule) => rule.id === ruleIds.unpromotable);
    expect(target).toBeDefined();
    await world.merchantsPort.applyRuleWrites(context, {
      updates: [
        {
          ruleId: ruleIds.unpromotable,
          pattern: `${DESCRIPTOR_NAMESPACE}${target?.pattern ?? ""}`,
        },
      ],
      inserts: [],
    });
    const report = await rederiveMerchantRules(context, deps(world), {
      acceptedRuleIds: [ruleIds.promotableIntoConflict],
      dryRun: true,
    });
    console.log(
      `half-migrated table: before ${report.assignmentsBefore}, after ${report.assignmentsAfter}`,
    );
    // The hand-migrated rule still holds its rows, so the before-set is not
    // the empty one a single-key read would produce.
    expect(report.assignmentsBefore).toBeGreaterThan(0);
    expect(report.assignmentsAfter).toBeGreaterThanOrEqual(
      report.assignmentsBefore,
    );
  });
});

describe("CR2-M3P12-04: a database error is never printed raw", () => {
  test("the rejection handler prints the error's kind and code and NOT its message", () => {
    const script = readFileSync(
      join(repositoryRoot, "scripts", "rederive-merchant-rules.ts"),
      "utf8",
    );
    const handler = script.slice(script.indexOf("void main().then("));
    // A Postgres constraint violation quotes the whole failing row inside the
    // message, and a stored pattern is derived from a real statement's text.
    // The only occurrence left is the comment saying it USED to print it.
    const code = handler
      .split("\n")
      .filter((line) => !line.trim().startsWith("//"))
      .join("\n");
    expect(code).not.toContain("error.message");
    expect(handler).toContain("error.constructor.name");
    expect(handler).toContain("code");
    expect(handler).toContain("deliberately not printed");
  });

  test("the contract now answers the FAILED run as well as the blocked one", () => {
    const script = readFileSync(
      join(repositoryRoot, "scripts", "rederive-merchant-rules.ts"),
      "utf8",
    );
    expect(script).toContain("AND WHAT A FAILED RUN LEAVES BEHIND");
    expect(script).toContain("rolls back every write that preceded it");
    // And the promise rests on a real mechanism rather than on the sentence.
    const routine = readFileSync(
      join(repositoryRoot, "src/modules/merchants/application/rederive-rules.ts"),
      "utf8",
    );
    expect(routine).toContain("applyRuleWrites");
  });

  test("the new twin outcome and the one-row explanation both reach the operator's console", () => {
    const script = readFileSync(
      join(repositoryRoot, "scripts", "rederive-merchant-rules.ts"),
      "utf8",
    );
    expect(script).toContain("already-held-by-same-merchant-twin");
    expect(script).toContain("twin-holds-pattern-rule");
    expect(script).toContain("promoted on the evidence of ONE transaction");
  });
});

// FIX ROUND THREE, finding CR3-M3P12-01. The twin skip left a permanently
// dead un-namespaced pattern that the routine's own before-set still read as
// live, so the next ordinary re-naming became a permanent block on a loss
// that never happened, escapable only by a person passing --accept for that
// rule id on every future run.
describe("CR3-M3P12-01: a superseded rule is not counted as a live assignment", () => {
  test("the before-set excludes it, so no loss is reported for a row whose merchant the owner changed", async () => {
    const seed = await seedDeployWindowWorld();
    const rival = await seed.world.merchantsPort.createMerchant(context, "Gamma");
    const twin = seed.world.rules.find((rule) => rule.id === seed.twinRuleId);
    await seed.world.merchantsPort.upsertRule(context, {
      merchantId: rival.id,
      kind: "EXACT",
      pattern: twin?.pattern ?? "",
    });
    const report = await rederiveMerchantRules(context, deps(seed.world), {});
    console.log(
      `superseded: before ${report.assignmentsBefore}, after ${report.assignmentsAfter}, lost ${report.lostAssignments.length}`,
    );
    expect(report.lostAssignments).toEqual([]);
    expect(report.exitCode).toBe(0);
    // The rows are held by the NAMESPACED rule both before and after, which
    // is what production sees, so nothing is lost and the after-set is a
    // superset. Before this round the before-set also credited the DEAD
    // un-namespaced rule, and the difference was reported as a loss.
    expect(report.assignmentsAfter).toBeGreaterThanOrEqual(
      report.assignmentsBefore,
    );
  });

  test("ONLY superseded ids are excluded: on a FIRST run every rule is un-namespaced and the before-set is the whole point of criterion 12.7", async () => {
    const seed = await seedWorld();
    const report = await rederiveMerchantRules(context, deps(seed.world), {
      acceptedRuleIds: [seed.ruleIds.promotableIntoConflict],
      dryRun: true,
    });
    // The seed's un-namespaced rules DO hold rows under the baseline key, and
    // they are counted. A blanket exclusion of un-namespaced patterns would
    // have made this zero and the superset test vacuous.
    expect(report.assignmentsBefore).toBeGreaterThan(0);
  });

  test("the superseded rule is neither rewritten nor deleted, and the second run says the same thing", async () => {
    const seed = await seedDeployWindowWorld();
    const first = await rederiveMerchantRules(context, deps(seed.world), {});
    const second = await rederiveMerchantRules(context, deps(seed.world), {});
    expect(formatDecisionReport(second)).toBe(formatDecisionReport(first));
    expect(second.exitCode).toBe(first.exitCode);
    expect(seed.world.rules.some((rule) => rule.id === seed.oldRuleId)).toBe(true);
  });

  test("the script prints the superseded rules, so the operator sees the dead declarations", () => {
    const script = readFileSync(
      join(repositoryRoot, "scripts", "rederive-merchant-rules.ts"),
      "utf8",
    );
    expect(script).toContain("superseded-by-namespaced-rule");
  });
});

// FIX ROUND THREE, finding CR3-M3P12-02. The command told the operator that
// nothing was written on a path where the whole write set is committed.
describe("CR3-M3P12-02: a recompute failure is reported as what it is", () => {
  test("the routine throws a DISTINGUISHABLE error carrying the report and the fact that the writes committed", async () => {
    const seed = await seedDeployWindowWorld();
    const patternsBefore = seed.world.rules
      .map((rule) => `${rule.id}|${rule.pattern}`)
      .sort();
    let caught: unknown;
    try {
      await rederiveMerchantRules(
        context,
        {
          merchants: seed.world.merchantsPort,
          recompute: async () => {
            throw new Error("recompute failed");
          },
        },
        {},
      );
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(RederiveRecomputeError);
    if (!(caught instanceof RederiveRecomputeError)) {
      return;
    }
    expect(caught.writesCommitted).toBe(true);
    // THE RECORD OF WHAT WAS WRITTEN travels with the failure, because before
    // this the report was printed only after the routine RETURNED, so a
    // failure left the operator an exit code and nothing else.
    expect(caught.report.applied).toBe(true);
    expect(formatDecisionReport(caught.report).length).toBeGreaterThan(0);
    // And the writes really did commit, which is why the old sentence was
    // false: the table is NOT as the run found it.
    expect(
      seed.world.rules.map((rule) => `${rule.id}|${rule.pattern}`).sort(),
    ).not.toEqual(patternsBefore);
  });

  test("a failure INSIDE the write set is not that error, and leaves the table as it found it", async () => {
    const seed = await seedWorld();
    const patternsBefore = seed.world.rules
      .map((rule) => `${rule.id}|${rule.pattern}`)
      .sort();
    let caught: unknown;
    try {
      await rederiveMerchantRules(
        context,
        {
          merchants: {
            ...seed.world.merchantsPort,
            applyRuleWrites: async () => {
              throw new Error("write set refused");
            },
          },
          recompute: async () => undefined,
        },
        { acceptedRuleIds: [seed.ruleIds.promotableIntoConflict] },
      );
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(Error);
    expect(caught).not.toBeInstanceOf(RederiveRecomputeError);
    expect(
      seed.world.rules.map((rule) => `${rule.id}|${rule.pattern}`).sort(),
    ).toEqual(patternsBefore);
  });

  test("the script branches on it: the report is printed, the state is named, and re-running is the instruction", () => {
    const script = readFileSync(
      join(repositoryRoot, "scripts", "rederive-merchant-rules.ts"),
      "utf8",
    );
    expect(script).toContain("RederiveRecomputeError");
    expect(script).toContain("the rule writes COMMITTED and the recompute then failed");
    expect(script).toContain("RE-RUN THIS COMMAND");
    expect(script).toContain("Do not roll the code deploy back");
    // The header no longer claims a failure ANYWHERE rolls everything back.
    expect(script).not.toContain("so a failure anywhere rolls back every write");
    expect(script).toContain("EXIT 4, A FAILURE AFTER THEM");
    // And the top-level handler's sentence is now scoped to the path it can
    // actually see.
    expect(script).toContain("the failure was before or inside the rule writes");
  });

  test("the command states that it cannot be pointed at a local database (CR3-M3P12-05)", () => {
    const script = readFileSync(
      join(repositoryRoot, "scripts", "rederive-merchant-rules.ts"),
      "utf8",
    );
    expect(script).toContain("CANNOT BE POINTED AT A LOCAL DATABASE");
  });
});

// FIX ROUND THREE, finding CR3-M3P12-07. A declaration rewrite outside a
// transaction is the thing fix round two bought; leaving a second write path
// on the published port is how that guarantee gets lost.
describe("CR3-M3P12-07: there is ONE write path for a declaration", () => {
  test("updateRulePattern is gone from the port, the binding and the adapter", () => {
    for (const path of [
      "src/modules/merchants/application/ports.ts",
      "src/modules/merchants/application/index.ts",
      "src/modules/merchants/adapters/merchant-repository.ts",
      "src/modules/merchants/application/rederive-rules.ts",
    ]) {
      const source = readFileSync(join(repositoryRoot, path), "utf8");
      const code = source
        .split("\n")
        .filter((line) => !line.trim().startsWith("//"))
        .join("\n");
      expect(code, path).not.toContain("updateRulePattern");
    }
  });

  test("the only remaining declaration write on the port is the atomic one", () => {
    const ports = readFileSync(
      join(repositoryRoot, "src/modules/merchants/application/ports.ts"),
      "utf8",
    );
    expect(ports).toContain("applyRuleWrites");
    expect(ports).not.toMatch(/readonly deleteRule/);
  });
});

// M3-P12 FIX ROUND FOUR, HAZARD finding CR4-M3P12-01, high.
//
// THE BEFORE-SET EXCLUSION ROUND THREE ADDED TRADED A FALSE LOSS FOR A HIDDEN
// ONE. It excluded the WHOLE superseded rule from the before-set, and the
// justification for doing so only covers the rows the namespaced claimant can
// actually reach. The baseline key is basis-agnostic, so a superseded rule
// also claims rows that have MIGRATED TO THE ACCOUNT BASIS, which a
// descriptor-namespaced claimant can never match and which pass two promotes
// only when they all carry one trusted account. Those rows were dropped from
// both sides of the superset test, so a real loss vanished with no entry, no
// count and no line in the report.
//
// THIS SEED IS THE ONE THE REVIEWER EXECUTED, rebuilt here so the routine's
// own superset test is what proves the fix. Two rules in the CR3-M3P12-01
// shape, and rows whose baseline key routes to the dead rule but whose
// IDENTITY keys split: one descriptor-basis row the claimant covers, and two
// account-basis rows on DIFFERENT trusted accounts, which pass two refuses to
// promote ("not-promoted-several-accounts") and which nothing else covers.
describe("CR4-M3P12-01 (hazard): the superseded exclusion is narrowed to the rows the claimant reaches", () => {
  const SHARED = "SHARED COUNTERPARTY TEXT";

  const row = (
    id: string,
    account?: string,
  ): CountedTransaction => ({
    id,
    flow: "SPEND",
    amountCents: cents(-1_000),
    description: SHARED,
    ...(account === undefined ? {} : { counterpartyAccount: account }),
  });

  const world = (rows: readonly CountedTransaction[]) => {
    const rules = [
      { id: "dead", merchantId: "alpha", kind: "EXACT" as const, pattern: SHARED },
      {
        id: "claimant",
        merchantId: "beta",
        kind: "EXACT" as const,
        pattern: `${DESCRIPTOR_NAMESPACE}${SHARED}`,
      },
    ];
    const deps = {
      listRules: async () => rules,
      listCountedTransactions: async () => rows,
      upsertRule: async () => {
        throw new Error("not used");
      },
      applyRuleWrites: async () => {},
    } as unknown as RederiveDependencies["merchants"];
    return { merchants: deps, recompute: async () => {} };
  };

  test("A DESCRIPTOR-BASIS ROW THE CLAIMANT COVERS is still not a loss: the round-three landmine stays closed", async () => {
    const report = await rederiveMerchantRules(context, world([row("descriptorRow")]), {});
    console.log(
      `narrowed, covered row: exit ${report.exitCode}, before ${report.assignmentsBefore}, after ${report.assignmentsAfter}, lost ${report.lostAssignments.length}`,
    );
    expect(report.lostAssignments).toEqual([]);
    expect(report.exitCode).toBe(0);
    expect(report.supersededByNamespacedRule).toContain("dead");
  });

  // THE HIDDEN LOSS ITSELF. Both rows take the ACCOUNT basis on two different
  // trusted accounts, so the claimant cannot match either and pass two refuses
  // the promotion. Under round three's code this reported exit 0, lost 0, and
  // both rows appeared nowhere in the report.
  test("AN ACCOUNT-BASIS ROW THE CLAIMANT CANNOT REACH IS A REAL LOSS, and it blocks", async () => {
    const report = await rederiveMerchantRules(
      context,
      world([
        row("accountRowB", IDENTITY_FIXTURE_ACCOUNTS.counterparty2),
        row("accountRowC", IDENTITY_FIXTURE_ACCOUNTS.counterparty3),
      ]),
      {},
    );
    console.log(
      `narrowed, unreachable rows: exit ${report.exitCode}, lost ${report.lostAssignments.length}`,
    );
    expect(report.lostAssignments.map((lost) => lost.transactionId).sort()).toEqual([
      "accountRowB",
      "accountRowC",
    ]);
    for (const lost of report.lostAssignments) {
      expect(lost.ruleId).toBe("dead");
    }
    expect(report.exitCode).toBe(1);
    expect(report.applied).toBe(false);
  });

  test("THE TWO KINDS OF ROW IN ONE RUN: the covered one is silent, the unreachable ones block", async () => {
    const report = await rederiveMerchantRules(
      context,
      world([
        row("descriptorRow"),
        row("accountRowB", IDENTITY_FIXTURE_ACCOUNTS.counterparty2),
        row("accountRowC", IDENTITY_FIXTURE_ACCOUNTS.counterparty3),
      ]),
      {},
    );
    expect(report.lostAssignments.map((lost) => lost.transactionId).sort()).toEqual([
      "accountRowB",
      "accountRowC",
    ]);
    expect(report.exitCode).toBe(1);
  });

  // AND THE LOSS HAS THE ORDINARY ACKNOWLEDGE PATH, so an operator who has
  // looked at it can proceed. A hidden loss has no such path, which is what
  // made hiding it worse than blocking on it.
  test("the acknowledge path clears it, and clears only the rule it names", async () => {
    const report = await rederiveMerchantRules(
      context,
      world([
        row("accountRowB", IDENTITY_FIXTURE_ACCOUNTS.counterparty2),
        row("accountRowC", IDENTITY_FIXTURE_ACCOUNTS.counterparty3),
      ]),
      { acceptedRuleIds: ["dead"] },
    );
    expect(report.lostAssignments).toEqual([]);
    expect(
      report.acceptedLostAssignments.map((lost) => lost.transactionId).sort(),
    ).toEqual(["accountRowB", "accountRowC"]);
    expect(report.exitCode).toBe(0);
  });

  // AND WHERE THE PROMOTION *DOES* COVER THE ROW there is no loss to report,
  // which is the other half of "narrowed": a single account-basis row lets
  // pass two promote the claimant onto that account, so the row is covered
  // afterwards and the run is silent. This is what keeps the narrowing from
  // being a blanket restoration of round two's blocking.
  test("an account-basis row the promotion DOES cover is not reported, so the narrowing is narrow", async () => {
    const report = await rederiveMerchantRules(
      context,
      world([row("accountRowB", IDENTITY_FIXTURE_ACCOUNTS.counterparty2)]),
      {},
    );
    expect(report.lostAssignments).toEqual([]);
    expect(report.exitCode).toBe(0);
    // AND THE BEFORE-SET IS WHOLE, which is the structural half of the fix and
    // the assertion that fails round three's wholesale exclusion even on a run
    // with no loss: the dead rule is the ONLY rule that claims this row before
    // the run, so excluding it made assignmentsBefore 0 and the superset test
    // had nothing to compare.
    expect(report.assignmentsBefore).toBe(1);
    expect(report.assignmentsAfter).toBe(1);
  });
});
