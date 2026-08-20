import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, expectTypeOf, test } from "vitest";
import {
  householdId,
  userId,
  type HouseholdContext,
} from "../../src/platform/tenancy";
import { confirmImport } from "../../src/modules/import/application/confirm-import";
import { uploadStatement } from "../../src/modules/import/application/upload-statement";
import { recomputeInterpretation } from "../../src/modules/ledger/application/interpret-window";
import type { LedgerDependencies } from "../../src/modules/ledger/application/ports";
import { assignMerchant } from "../../src/modules/merchants/application/assign-merchant";
import { resolveCounterparties } from "../../src/modules/merchants/application/resolve-counterparties";
import { tagMerchant } from "../../src/modules/merchants/application/tag-merchant";
import { matchRules } from "../../src/modules/merchants/domain/merchant-rule";
import { makeFakeImportWorld } from "./fake-import-world";

// Criterion 3.2: a manual assignment writes a MerchantRule DECLARATION
// (never a row edit), recompute applies it to every past matching
// transaction, and no code path in interpretation writes a MerchantRule,
// asserted BY CONSTRUCTION: the interpret use case's whole merchants
// surface is the read-only MerchantResolverPort. Hazard H3.1 (a correction
// stored as a row edit, silently undone by the next recompute, teaching
// the system nothing) gets its own witness below. The real parser, use
// cases, resolver and interpretation engine run over in-memory fakes of
// the ports.

const context: HouseholdContext = {
  householdId: householdId("household-1"),
  userId: userId("user-1"),
};

const IBAN_A = "BE68539007547034";
const IBAN_B = "BE71096123456769";

// Statement 7: salary in, two shop spends, the outgoing leg of an internal
// transfer to account B.
const fileA = [
  "Demobank NV - Verrichtingen export",
  "Afschrift;Volgnummer;Boekingsdatum;Valutadatum;Rekening;Tegenrekening;Naam;Omschrijving;Bedrag",
  `7;0301;03/08/2026;03/08/2026;${IBAN_A};BE39103123456719;Acme Salaris BV;LOON JULI 2026;+2.500,00`,
  `7;0302;04/08/2026;04/08/2026;${IBAN_A};BE54540123456789;Supermarkt Noord;BETALING MET DEBETKAART SUPERMARKT NOORD GENT;-86,47`,
  `7;0303;05/08/2026;05/08/2026;${IBAN_A};BE02979245566602;Café Zomer;BETALING MET DEBETKAART CAFÉ ZOMER GENT;-12,50`,
  `7;0304;06/08/2026;06/08/2026;${IBAN_A};${IBAN_B};Eigen rekening;OVERSCHRIJVING EIGEN REKENING;-600,00`,
].join("\n");

// Statement 8, a LATER import of the same account: the same shop again
// (this row is the "past matching transaction in another import" the
// retroactivity assertion needs when the naming happens after both).
const fileA2 = [
  "Demobank NV - Verrichtingen export",
  "Afschrift;Volgnummer;Boekingsdatum;Valutadatum;Rekening;Tegenrekening;Naam;Omschrijving;Bedrag",
  `8;0305;11/08/2026;11/08/2026;${IBAN_A};BE54540123456789;Supermarkt Noord;BETALING MET DEBETKAART SUPERMARKT NOORD ANTWERPEN;-23,10`,
].join("\n");

const bytes = (content: string): Uint8Array => new TextEncoder().encode(content);

type World = ReturnType<typeof makeFakeImportWorld>;

const uploadAndDeclare = async (
  world: World,
  fileName: string,
  content: string,
): Promise<void> => {
  const outcome = await uploadStatement(context, world.deps, {
    fileName,
    bytes: bytes(content),
  });
  if (outcome.kind === "ingested") {
    return;
  }
  expect(outcome.kind).toBe("awaiting-declaration");
  if (outcome.kind !== "awaiting-declaration") {
    throw new Error("unreachable");
  }
  const detected = world.deps.parser.detect(bytes(content));
  if (!detected.ok) {
    throw new Error("detection failed");
  }
  const confirmed = await confirmImport(context, world.deps, {
    importId: outcome.importId,
    profileName: "Current A export",
    spec: detected.value,
    declaration: { label: "Current A", bank: "Demobank", role: "POT" },
  });
  expect(confirmed.kind).toBe("ingested");
};

const declareAccountB = (world: World): Promise<unknown> =>
  world.deps.accounts.declareAccount(context, {
    label: "Current B",
    bank: "Demobank",
    role: "POT",
    iban: IBAN_B,
  });

// The recompute dependency exactly as the UI action binds it: the ledger
// module's published recompute over the same world.
const assignDeps = (world: World) => ({
  merchants: world.merchantsPort,
  recompute: (ctx: HouseholdContext) =>
    recomputeInterpretation(ctx, world.ledgerDeps),
});

const rowsFor = (world: World, iban: string) =>
  world.transactions.filter((row) => row.counterpartyIban === iban);

// The FACT columns only, named explicitly: interpretation columns (flow,
// merchantId) are excluded because they are exactly what assignment and
// recompute are allowed to rewrite.
const factSnapshot = (world: World): string =>
  JSON.stringify(
    world.transactions.map((row) => ({
      id: row.id,
      householdId: row.householdId,
      accountId: row.accountId,
      importId: row.importId,
      bookingDate: row.bookingDate,
      amountCents: row.amountCents,
      description: row.description,
      counterpartyIban: row.counterpartyIban,
      counterpartyName: row.counterpartyName,
      rawLine: row.rawLine,
      dedupKey: row.dedupKey,
    })),
  );

describe("manual assignment writes a declaration and recompute applies it retroactively (criterion 3.2)", () => {
  test("naming a counterparty writes ONE exact MerchantRule on the normalised string and every past matching transaction regroups, across imports", async () => {
    const world = makeFakeImportWorld();
    await declareAccountB(world);
    await uploadAndDeclare(world, "a.csv", fileA);
    await uploadAndDeclare(world, "a2.csv", fileA2);

    const supermarktRows = rowsFor(world, "BE54540123456789");
    expect(supermarktRows).toHaveLength(2);
    expect(new Set(supermarktRows.map((row) => row.importId)).size).toBe(2);
    expect(supermarktRows.every((row) => row.merchantId === undefined)).toBe(true);

    // Facts snapshot: the assignment must not edit a single fact column.
    const factsBefore = factSnapshot(world);

    const outcome = await assignMerchant(context, assignDeps(world), {
      counterpartyText: "BETALING MET DEBETKAART SUPERMARKT NOORD GENT",
      merchantName: "Supermarkt",
    });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) {
      return;
    }

    // The declaration: one EXACT rule, normalised subject, pointing at the
    // created merchant.
    expect(world.rules).toHaveLength(1);
    expect(world.rules[0]).toMatchObject({
      kind: "EXACT",
      pattern: "SUPERMARKT NOORD",
      merchantId: outcome.value.merchant.id,
    });
    expect(world.merchants.map((merchant) => merchant.name)).toEqual([
      "Supermarkt",
    ]);

    // Retroactivity: BOTH past rows now carry the merchant, including the
    // one in the other import, whose raw text normalises to the same key
    // (different city, GENT versus ANTWERPEN).
    const regrouped = rowsFor(world, "BE54540123456789");
    expect(regrouped.map((row) => row.merchantId)).toEqual([
      outcome.value.merchant.id,
      outcome.value.merchant.id,
    ]);

    // Nothing else moved, and no fact column changed.
    expect(
      rowsFor(world, "BE02979245566602").every(
        (row) => row.merchantId === undefined,
      ),
    ).toBe(true);
    expect(factSnapshot(world)).toBe(factsBefore);
  });

  test("re-assigning the same counterparty UPDATES the one decision instead of stacking a second rule", async () => {
    const world = makeFakeImportWorld();
    await declareAccountB(world);
    await uploadAndDeclare(world, "a.csv", fileA);

    const first = await assignMerchant(context, assignDeps(world), {
      counterpartyText: "Supermarkt Noord",
      merchantName: "Supermarkt",
    });
    const second = await assignMerchant(context, assignDeps(world), {
      counterpartyText: "SUPERMARKT NOORD",
      merchantName: "Colruyt Group",
    });
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) {
      return;
    }
    expect(world.rules).toHaveLength(1);
    expect(world.rules[0]?.merchantId).toBe(second.value.merchant.id);
    expect(
      rowsFor(world, "BE54540123456789").map((row) => row.merchantId),
    ).toEqual([second.value.merchant.id]);
  });

  test("an income source resolves through the SAME resolver: naming the salary string groups the INCOME row", async () => {
    const world = makeFakeImportWorld();
    await declareAccountB(world);
    await uploadAndDeclare(world, "a.csv", fileA);

    const outcome = await assignMerchant(context, assignDeps(world), {
      counterpartyText: "Acme Salaris BV",
      merchantName: "Acme (salary)",
    });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) {
      return;
    }
    const salaryRow = world.transactions.find(
      (row) => row.description === "LOON JULI 2026",
    );
    expect(salaryRow?.flow).toBe("INCOME");
    expect(salaryRow?.merchantId).toBe(outcome.value.merchant.id);
  });

  test("INTERNAL rows never carry a merchant, even when a rule matches their counterparty text", async () => {
    const world = makeFakeImportWorld();
    await declareAccountB(world);
    await uploadAndDeclare(world, "a.csv", fileA);

    const outcome = await assignMerchant(context, assignDeps(world), {
      counterpartyText: "Eigen rekening",
      merchantName: "Should never appear",
    });
    expect(outcome.ok).toBe(true);
    const transferLeg = world.transactions.find(
      (row) => row.counterpartyIban === IBAN_B,
    );
    expect(transferLeg?.flow).toBe("INTERNAL");
    expect(transferLeg?.merchantId).toBeUndefined();
  });
});

describe("interpretation has no rule repository dependency, by construction (criterion 3.2, hazard H3.1)", () => {
  test("the interpret use case's whole merchants surface is the one read-only resolver function", () => {
    // Type-level: adding ANY second member to the port (a rule write, a
    // merchant create) turns the typecheck gate red here.
    expectTypeOf<keyof LedgerDependencies["merchants"]>().toEqualTypeOf<"resolveCounterparties">();
    const world = makeFakeImportWorld();
    expect(Object.keys(world.ledgerDeps.merchants)).toEqual([
      "resolveCounterparties",
    ]);
  });

  test("a full upload-interpret cycle and a recompute make ZERO declaration writes", async () => {
    const world = makeFakeImportWorld();
    await declareAccountB(world);
    await uploadAndDeclare(world, "a.csv", fileA);
    await uploadAndDeclare(world, "a2.csv", fileA2);
    await recomputeInterpretation(context, world.ledgerDeps);
    expect(world.declarationWrites()).toBe(0);
    expect(world.rules).toHaveLength(0);
    expect(world.merchants).toHaveLength(0);
  });

  test("HAZARD H3.1 witness: a merchant set by row edit is undone by the next recompute; the declaration survives it", async () => {
    const world = makeFakeImportWorld();
    await declareAccountB(world);
    await uploadAndDeclare(world, "a.csv", fileA);

    const assigned = await assignMerchant(context, assignDeps(world), {
      counterpartyText: "Supermarkt Noord",
      merchantName: "Supermarkt",
    });
    expect(assigned.ok).toBe(true);
    if (!assigned.ok) {
      return;
    }

    // The row edit the domain forbids, simulated directly on the store: a
    // one-row correction pointing the café spend at the supermarket.
    const cafeRow = world.transactions.find(
      (row) => row.counterpartyIban === "BE02979245566602",
    );
    expect(cafeRow).toBeDefined();
    if (cafeRow === undefined) {
      return;
    }
    cafeRow.merchantId = assigned.value.merchant.id;

    await recomputeInterpretation(context, world.ledgerDeps);

    // The row edit taught the system nothing and is gone; the declared
    // assignment held.
    expect(cafeRow.merchantId).toBeUndefined();
    expect(
      rowsFor(world, "BE54540123456789").map((row) => row.merchantId),
    ).toEqual([assigned.value.merchant.id]);
  });
});

describe("the rule chain: exact, then prefix, then pattern, deterministically", () => {
  const rule = (
    id: string,
    merchantId: string,
    kind: "EXACT" | "PREFIX" | "PATTERN",
    pattern: string,
  ) => ({ id, merchantId, kind, pattern });

  test("exact beats prefix beats pattern", () => {
    const rules = [
      rule("r3", "m-pattern", "PATTERN", "SUPERMARKT*"),
      rule("r2", "m-prefix", "PREFIX", "SUPERMARKT"),
      rule("r1", "m-exact", "EXACT", "SUPERMARKT NOORD"),
    ];
    expect(matchRules("SUPERMARKT NOORD", rules)?.merchantId).toBe("m-exact");
    expect(matchRules("SUPERMARKT ZUID", rules)?.merchantId).toBe("m-prefix");
    const patternOnly = [rule("r3", "m-pattern", "PATTERN", "*MARKT*")];
    expect(matchRules("SUPERMARKT ZUID", patternOnly)?.merchantId).toBe(
      "m-pattern",
    );
  });

  test("the longest prefix wins, then the lexically smaller pattern, then the lower rule id: never insertion order", () => {
    const longest = [
      rule("r1", "m-short", "PREFIX", "SUPER"),
      rule("r2", "m-long", "PREFIX", "SUPERMARKT"),
    ];
    expect(matchRules("SUPERMARKT NOORD", longest)?.merchantId).toBe("m-long");
    expect(
      matchRules("SUPERMARKT NOORD", [...longest].reverse())?.merchantId,
    ).toBe("m-long");
    const tie = [
      rule("r2", "m-b", "EXACT", "SUPERMARKT"),
      rule("r1", "m-a", "EXACT", "SUPERMARKT"),
    ];
    expect(matchRules("SUPERMARKT", tie)?.merchantId).toBe("m-a");
  });

  test("a pattern is a whole-string glob: * spans, everything else is literal", () => {
    const rules = [rule("r1", "m1", "PATTERN", "ZIEKENFONDS *BETALING")];
    expect(
      matchRules("ZIEKENFONDS X TERUGBETALING", rules)?.merchantId,
    ).toBe("m1");
    expect(matchRules("ZIEKENFONDS", rules)).toBeUndefined();
    // Regex metacharacters in the stored pattern stay literal.
    const meta = [rule("r2", "m2", "PATTERN", "A.B*")];
    expect(matchRules("A.B C", meta)?.merchantId).toBe("m2");
    expect(matchRules("AXB C", meta)).toBeUndefined();
  });

  test("empty patterns and empty strings never match anything", () => {
    const rules = [
      rule("r1", "m1", "EXACT", ""),
      rule("r2", "m2", "PREFIX", ""),
      rule("r3", "m3", "PATTERN", ""),
    ];
    expect(matchRules("ANYTHING", rules)).toBeUndefined();
    expect(matchRules("", [rule("r4", "m4", "PREFIX", "A")])).toBeUndefined();
  });
});

describe("the resolver use case: distinct raw strings in, certain assignments out", () => {
  test("a PREFIX rule resolves city variants the household has never seen, and unresolved strings stay absent", async () => {
    const world = makeFakeImportWorld();
    const merchant = await world.merchantsPort.createMerchant(
      context,
      "Supermarkt",
    );
    await world.merchantsPort.upsertRule(context, {
      merchantId: merchant.id,
      kind: "PREFIX",
      pattern: "SUPERMARKT",
    });
    const resolved = await resolveCounterparties(
      context,
      { merchants: world.merchantsPort },
      [
        "BETALING MET DEBETKAART SUPERMARKT NOORD 9000 GENT",
        "Supermarkt Zuid Leuven",
        "ONBEKENDE BAKKER",
      ],
    );
    expect(
      resolved.get("BETALING MET DEBETKAART SUPERMARKT NOORD 9000 GENT"),
    ).toBe(merchant.id);
    expect(resolved.get("Supermarkt Zuid Leuven")).toBe(merchant.id);
    expect(resolved.has("ONBEKENDE BAKKER")).toBe(false);
  });
});

describe("tags: freeform, on the merchant, many-to-many, one primary (nothing seeded)", () => {
  test("tagging creates the tag on first use, links many-to-many, and promoting a new primary demotes the old one", async () => {
    const world = makeFakeImportWorld();
    const deps = { merchants: world.merchantsPort };
    const shop = await world.merchantsPort.createMerchant(context, "Supermarkt");
    const cafe = await world.merchantsPort.createMerchant(context, "Café Zomer");

    const groceries = await tagMerchant(context, deps, {
      merchantId: shop.id,
      tagName: "groceries",
      isPrimary: true,
    });
    expect(groceries.ok).toBe(true);
    await tagMerchant(context, deps, {
      merchantId: shop.id,
      tagName: "weekly",
      isPrimary: false,
    });
    // The same tag on a second merchant: many-to-many, no duplicate tag row.
    await tagMerchant(context, deps, {
      merchantId: cafe.id,
      tagName: "weekly",
      isPrimary: true,
    });
    expect(world.tags.map((tag) => tag.name).sort()).toEqual([
      "groceries",
      "weekly",
    ]);

    // Promote "weekly" on the shop: "groceries" is demoted in the same
    // write. This exercises the SEQUENTIAL half of the one-primary
    // invariant; the concurrent half is held by the partial unique index
    // the describe block below asserts from the migration SQL (finding
    // CR-401), witnessed against the real database by the fix-round
    // race probe.
    await tagMerchant(context, deps, {
      merchantId: shop.id,
      tagName: "weekly",
      isPrimary: true,
    });
    const shopTags = await world.merchantsPort.listMerchantTags(context, shop.id);
    expect(shopTags.filter((tag) => tag.isPrimary).map((tag) => tag.tagName)).toEqual([
      "weekly",
    ]);
    expect(shopTags).toHaveLength(2);
    const cafeTags = await world.merchantsPort.listMerchantTags(context, cafe.id);
    expect(cafeTags.filter((tag) => tag.isPrimary)).toHaveLength(1);
  });

  // Finding CR-401 red witnesses (fix round 1): the one-primary invariant
  // and the tenancy rule are only as strong as the adapter's checks, and
  // the fake mirrors the adapter's contract. A merchant or tag belonging
  // to ANOTHER household must be refused before any write (CLAUDE.md
  // non-negotiable 6): a cross-household id here is a bug or an attack,
  // so it throws rather than returning a Result.
  test("setMerchantTag refuses a merchant the household does not own (finding CR-401)", async () => {
    const world = makeFakeImportWorld();
    const foreign: HouseholdContext = {
      householdId: householdId("household-2"),
      userId: userId("user-2"),
    };
    const merchant = await world.merchantsPort.createMerchant(context, "Supermarkt");
    const tag = await world.merchantsPort.createTag(foreign, "groceries");
    await expect(
      world.merchantsPort.setMerchantTag(foreign, {
        merchantId: merchant.id,
        tagId: tag.id,
        isPrimary: true,
      }),
    ).rejects.toThrow();
    expect(world.merchantTags).toHaveLength(0);
  });

  test("setMerchantTag refuses a tag the household does not own (finding CR-401)", async () => {
    const world = makeFakeImportWorld();
    const foreign: HouseholdContext = {
      householdId: householdId("household-2"),
      userId: userId("user-2"),
    };
    const merchant = await world.merchantsPort.createMerchant(context, "Supermarkt");
    const foreignTag = await world.merchantsPort.createTag(foreign, "groceries");
    await expect(
      world.merchantsPort.setMerchantTag(context, {
        merchantId: merchant.id,
        tagId: foreignTag.id,
        isPrimary: false,
      }),
    ).rejects.toThrow();
    expect(world.merchantTags).toHaveLength(0);
  });

  test("upsertRule refuses a merchant the household does not own (finding CR-401)", async () => {
    const world = makeFakeImportWorld();
    const foreign: HouseholdContext = {
      householdId: householdId("household-2"),
      userId: userId("user-2"),
    };
    const merchant = await world.merchantsPort.createMerchant(context, "Supermarkt");
    await expect(
      world.merchantsPort.upsertRule(foreign, {
        merchantId: merchant.id,
        kind: "EXACT",
        pattern: "SUPERMARKT NOORD",
      }),
    ).rejects.toThrow();
    expect(world.rules).toHaveLength(0);
  });

  test("a blank tag name is refused as a value, not an exception", async () => {
    const world = makeFakeImportWorld();
    const shop = await world.merchantsPort.createMerchant(context, "Supermarkt");
    const outcome = await tagMerchant(
      context,
      { merchants: world.merchantsPort },
      { merchantId: shop.id, tagName: "   ", isPrimary: false },
    );
    expect(outcome).toEqual({ ok: false, error: { kind: "empty-tag-name" } });
  });
});

describe("one primary per merchant is enforced by the database, not only by the demote (finding CR-401)", () => {
  // Two CONCURRENT promotes under read committed can each take a demote
  // snapshot that misses the other's uncommitted primary and commit two
  // primaries; the application-level demote alone is weaker than the
  // stated invariant. The structural guard is a partial unique index on
  // (merchantId) where isPrimary, which no interleaving can defeat: the
  // second promote surfaces as a unique violation instead of a second
  // primary. This test derives its evidence from the committed migration
  // SQL, the same mechanism as test/schema/rls.test.ts.
  test("the committed migration SQL carries the partial unique index on merchant_tags", () => {
    const migrationsDir = join(__dirname, "..", "..", "prisma", "schema", "migrations");
    const chunks: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir)) {
        const fullPath = join(dir, entry);
        if (statSync(fullPath).isDirectory()) {
          walk(fullPath);
        } else if (entry.endsWith(".sql")) {
          chunks.push(readFileSync(fullPath, "utf-8"));
        }
      }
    };
    walk(migrationsDir);
    const sql = chunks.join("\n");
    // Pinned BY NAME as well as by predicate (backlog CR-404): the
    // migration comment claims "asserted by name and predicate", and the
    // earlier `"?\w*"?` name slot accepted ANY index name, witnessed by a
    // rename probe that left this test green. The name is load-bearing:
    // the M1-P4 race probe and the live-database check both identify the
    // index as merchant_tags_one_primary_per_merchant.
    expect(sql).toMatch(
      /CREATE\s+UNIQUE\s+INDEX\s+"merchant_tags_one_primary_per_merchant"\s+ON\s+"?merchant_tags"?\s*\("merchantId"\)\s*WHERE\s+"isPrimary"/i,
    );
  });
});
