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
  formatDecisionReport,
  rederiveMerchantRules,
} from "../../src/modules/merchants/application/rederive-rules";
import type { MerchantRepositoryPort } from "../../src/modules/merchants/application/ports";
import {
  ACCOUNT_NAMESPACE,
  DESCRIPTOR_NAMESPACE,
} from "../../src/modules/merchants/domain/counterparty-identity";
import { IDENTITY_FIXTURE_ACCOUNTS } from "../fixtures/generate-pdf-fixtures";
import { makeFakeImportWorld } from "./fake-import-world";

// CRITERIA 12.7, 12.8 and 12.9. The re-derivation runs against a SEEDED
// database holding MerchantRule rows written under the BASELINE derivation,
// deliberately containing all three shapes criterion 12.8 names: a rule that
// cannot be promoted, a rule whose matched rows split across the two bases,
// and a merchant conflict. It also contains the two shapes pass one's guards
// exist for and which criterion 12.21 requires to be REACHED rather than
// merely present: an already-namespaced pattern and an empty one.

const context: HouseholdContext = {
  householdId: householdId("household-1"),
  userId: userId("user-1"),
};

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
    "listRules" | "listCountedTransactions" | "upsertRule" | "updateRulePattern"
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
      acceptedRuleIds: [ruleIds.conflicting],
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
    expect(observedBefore.size).toBe(0);
    expect(observedAfter.size).toBe(report.assignmentsAfter);
  });

  test("the routine issues NO update and NO delete against an account-namespaced pattern, and never rewrites a descriptor pattern into an account one", async () => {
    const { world } = await seedWorld();
    const updates: { ruleId: string; pattern: string }[] = [];
    const deletes: string[] = [];
    const patternsBefore = new Map(
      world.rules.map((rule) => [rule.id, rule.pattern]),
    );
    const spied = {
      ...world.merchantsPort,
      updateRulePattern: async (
        ctx: HouseholdContext,
        input: { readonly ruleId: string; readonly pattern: string },
      ) => {
        updates.push({ ...input });
        return world.merchantsPort.updateRulePattern(ctx, input);
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
      {},
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
      acceptedRuleIds: [ruleIds.conflicting],
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
      acceptedRuleIds: [ruleIds.conflicting],
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
      acceptedRuleIds: [ruleIds.conflicting],
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
    expect(blocked.conflicts).toEqual([unaccepted.ruleIds.conflicting]);
    expect(blocked.exitCode).toBe(1);

    // Accepting a DIFFERENT rule id clears nothing.
    const wrongId = await seedWorld();
    const stillBlocked = await rederiveMerchantRules(
      context,
      deps(wrongId.world),
      { acceptedRuleIds: [wrongId.ruleIds.promotable] },
    );
    expect(stillBlocked.conflicts).toEqual([wrongId.ruleIds.conflicting]);
    expect(stillBlocked.exitCode).toBe(1);

    // Accepting the named id clears exactly that one.
    const acceptedRun = await seedWorld();
    const cleared = await rederiveMerchantRules(
      context,
      deps(acceptedRun.world),
      { acceptedRuleIds: [acceptedRun.ruleIds.conflicting] },
    );
    expect(cleared.conflicts).toEqual([]);
    expect(cleared.acceptedConflicts).toEqual([
      acceptedRun.ruleIds.conflicting,
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
    const accepted = { acceptedRuleIds: [ruleIds.conflicting] };

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
    expect(report.conflicts).toContain(ruleIds.conflicting);
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
    const { world } = await seedWorld();
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
      {},
    );
    expect(factSnapshot()).toBe(before);
  });

  test("clearing every merchant id and recomputing returns the IDENTICAL assignment set, so the naming survives as a declaration plus a derivation", async () => {
    const { world, ruleIds } = await seedWorld();
    await rederiveMerchantRules(context, deps(world), {
      acceptedRuleIds: [ruleIds.conflicting],
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
