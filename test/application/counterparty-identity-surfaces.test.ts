import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import type { Cents } from "../../src/platform/money";
import {
  householdId,
  userId,
  type HouseholdContext,
} from "../../src/platform/tenancy";
import { confirmImport } from "../../src/modules/import/application/confirm-import";
import { uploadStatement } from "../../src/modules/import/application/upload-statement";
import { statementParser } from "../../src/modules/import/adapters/statement-parser";
import { recomputeInterpretation } from "../../src/modules/ledger/application/interpret-window";
import { assignMerchant } from "../../src/modules/merchants/application/assign-merchant";
import { buildMerchantReview } from "../../src/modules/merchants/domain/merchant-review";
import {
  ACCOUNT_NAMESPACE,
  DESCRIPTOR_NAMESPACE,
  counterpartyIdentity,
} from "../../src/modules/merchants/domain/counterparty-identity";
import { normaliseCounterparty } from "../../src/modules/merchants/domain/normalise-counterparty";
import { foldGroups } from "../../src/modules/overview/domain/month-projection";
import type { CountedGroupRow } from "../../src/modules/overview/domain/month-projection";
import { IDENTITY_FIXTURE_ACCOUNTS } from "../fixtures/generate-pdf-fixtures";
import { makeFakeImportWorld } from "./fake-import-world";

const context: HouseholdContext = {
  householdId: householdId("household-1"),
  userId: userId("user-1"),
};

const repositoryRoot = join(__dirname, "..", "..");
const FIXTURE = "belfius-counterparty-identity.pdf";

const fixtureBytes = (): Uint8Array =>
  new Uint8Array(readFileSync(join(repositoryRoot, "test", "fixtures", FIXTURE)));

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

describe("CRITERION 12.11: the two screens agree where they are meant to", () => {
  test("over ONE dataset, the merchant review and the overview fold produce the same unresolved group keys and the same row count per key", async () => {
    const world = await ingestFixture();
    const counted = await world.merchantsPort.listCountedTransactions(context);
    expect(counted.length).toBeGreaterThan(0);

    const review = buildMerchantReview(counted, []);
    const reviewKeys = new Map<string, number>();
    for (const group of [...review.income, ...review.spend]) {
      if (group.merchantId === undefined && group.counterpartyText !== undefined) {
        reviewKeys.set(
          group.counterpartyText,
          (reviewKeys.get(group.counterpartyText) ?? 0) + group.count,
        );
      }
    }

    // The overview's grouped read, built from the SAME rows. The cash
    // predicate is what the overview branches on FIRST and the review has no
    // cash concept at all, so the rows it matches are excluded here and
    // asserted separately below.
    const CASH = /GELDOPNAME|CASH|ATM/i;
    const rows: readonly CountedGroupRow[] = counted.map((row) => ({
      merchantId: row.merchantId ?? null,
      merchantName: null,
      primaryTag: null,
      counterpartyText: row.counterpartyName ?? row.description,
      counterpartyAccount: row.counterpartyAccount ?? null,
      isCash: CASH.test(row.description),
      totalCents: row.amountCents as Cents,
      rowCount: 1,
    }));
    const folded = foldGroups(
      rows.filter((row) => !row.isCash),
      { useTags: false, identity: counterpartyIdentity, normalise: normaliseCounterparty },
    );
    const foldKeys = new Map<string, number>();
    for (const group of folded) {
      if (group.kind === "unresolved") {
        foldKeys.set(group.key.slice("text:".length), group.rowCount);
      }
    }

    expect([...foldKeys.keys()].sort()).toEqual([...reviewKeys.keys()].sort());
    for (const [key, count] of reviewKeys) {
      expect(foldKeys.get(key), key).toBe(count);
    }
  });

  test("the three divergences are asserted at their named sites rather than avoided by choosing a dataset without them", () => {
    const projection = readFileSync(
      join(repositoryRoot, "src/modules/overview/domain/month-projection.ts"),
      "utf8",
    );
    const reviewSource = readFileSync(
      join(repositoryRoot, "src/modules/merchants/domain/merchant-review.ts"),
      "utf8",
    );
    const overviewRepository = readFileSync(
      join(repositoryRoot, "src/modules/overview/adapters/overview-repository.ts"),
      "utf8",
    );
    const merchantRepository = readFileSync(
      join(repositoryRoot, "src/modules/merchants/adapters/merchant-repository.ts"),
      "utf8",
    );

    // ONE: the fold branches on cash FIRST into one shared key; the review
    // has no cash concept at all.
    expect(projection).toMatch(/if \(row\.isCash\)/);
    expect(projection).toMatch(/key = "cash"/);
    expect(reviewSource).not.toMatch(/isCash|"cash"/);

    // TWO: the fold regroups by primary tag when useTags is set; the review
    // never does.
    expect(projection).toMatch(/options\.useTags/);
    expect(projection).toMatch(/key = `tag:\$\{row\.primaryTag\}`/);
    expect(reviewSource).not.toMatch(/useTags|primaryTag/);

    // THREE: they differ in SCOPE. The overview bounds by booking date;
    // listCountedTransactions has no date bound.
    expect(overviewRepository).toMatch(/t\."bookingDate" >= /);
    expect(overviewRepository).toMatch(/t\."bookingDate" <= /);
    const countedRead = merchantRepository.slice(
      merchantRepository.indexOf("export const listCountedTransactions"),
    );
    expect(countedRead).not.toMatch(/bookingDate: \{/);
  });

  test("the SQL fragment for the counterparty-source rule still appears exactly once and both reads use it", () => {
    const source = readFileSync(
      join(repositoryRoot, "src/modules/overview/adapters/overview-repository.ts"),
      "utf8",
    );
    const definitions = source.match(
      /const COUNTERPARTY_TEXT_SQL = Prisma\.sql`COALESCE\(t\."counterpartyName", t\."description"\)`/g,
    );
    expect(definitions).toHaveLength(1);
    const uses = source.match(/\$\{COUNTERPARTY_TEXT_SQL\}/g);
    expect(uses?.length ?? 0).toBeGreaterThanOrEqual(2);
    // And the account column the identity needs is selected and grouped on.
    expect(source).toMatch(/t\."counterpartyIban"\s+AS "counterpartyAccount"/);
    expect(source).toMatch(/GROUP BY 1, 2, 3, 4, 5, 6/);
  });
});

describe("CRITERION 12.15: a split is recoverable by the owner", () => {
  test("naming BOTH of two split groups with the SAME merchant name lands both under ONE merchant id", async () => {
    const world = await ingestFixture();
    const deps = {
      merchants: world.merchantsPort,
      recompute: (ctx: HouseholdContext) =>
        recomputeInterpretation(ctx, world.ledgerDeps),
    };
    // Two DIFFERENT counterparty accounts of the fixture, standing in for one
    // merchant paid through two accounts: the split hazard H12.9 names.
    const first = await assignMerchant(context, deps, {
      counterpartyText: `${ACCOUNT_NAMESPACE}${IDENTITY_FIXTURE_ACCOUNTS.counterparty1}`,
      merchantName: "Demo Verzekering",
    });
    const second = await assignMerchant(context, deps, {
      counterpartyText: `${ACCOUNT_NAMESPACE}${IDENTITY_FIXTURE_ACCOUNTS.counterparty4}`,
      merchantName: "Demo Verzekering",
    });
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) {
      return;
    }
    // ONE merchant, TWO rules: naming the second group with the same name
    // attaches a second rule to the merchant that already exists.
    expect(first.value.merchant.id).toBe(second.value.merchant.id);
    expect(world.merchants).toHaveLength(1);
    expect(world.rules).toHaveLength(2);

    await recomputeInterpretation(context, world.ledgerDeps);
    const assigned = world.transactions.filter(
      (row) => row.merchantId === first.value.merchant.id,
    );
    // Both groups' rows now carry the one merchant id.
    expect(assigned).toHaveLength(6);
    expect(
      new Set(assigned.map((row) => row.counterpartyIban)).size,
    ).toBe(2);
  });
});

describe("CRITERION 12.18: the rule subject is validated at the write boundary", () => {
  const deps = (world: World) => ({
    merchants: world.merchantsPort,
    recompute: (ctx: HouseholdContext) =>
      recomputeInterpretation(ctx, world.ledgerDeps),
  });

  test("a PRE-MIGRATION un-namespaced key is refused with a typed error and writes NOTHING", async () => {
    const world = await ingestFixture();
    const rulesBefore = world.rules.length;
    const merchantsBefore = world.merchants.length;
    // Exactly what a page left open across the deploy submits: the
    // normalised text the review rendered before this phase.
    const outcome = await assignMerchant(context, deps(world), {
      counterpartyText: "KOSTEN DEMO REKENINGPAKKET",
      merchantName: "Demo Bank",
    });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) {
      return;
    }
    expect(outcome.error.kind).toBe("unnamespaced-counterparty");
    expect(world.rules).toHaveLength(rulesBefore);
    expect(world.merchants).toHaveLength(merchantsBefore);
  });

  test("an ACCOUNT-basis subject whose remainder is empty after compaction is refused", async () => {
    const world = await ingestFixture();
    for (const remainder of ["", "   ", "\t"]) {
      const outcome = await assignMerchant(context, deps(world), {
        counterpartyText: `${ACCOUNT_NAMESPACE}${remainder}`,
        merchantName: "Demo Bank",
      });
      expect(outcome.ok).toBe(false);
      if (!outcome.ok) {
        expect(outcome.error.kind).toBe("untrusted-counterparty-account");
      }
    }
    expect(world.rules).toHaveLength(0);
  });

  test("an ACCOUNT-basis subject that fails the trust gate is refused", async () => {
    const world = await ingestFixture();
    const valid = IDENTITY_FIXTURE_ACCOUNTS.counterparty1;
    const broken = `${valid.slice(0, -1)}${valid.endsWith("0") ? "1" : "0"}`;
    const outcome = await assignMerchant(context, deps(world), {
      counterpartyText: `${ACCOUNT_NAMESPACE}${broken}`,
      merchantName: "Demo Bank",
    });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.error.kind).toBe("untrusted-counterparty-account");
    }
    expect(world.rules).toHaveLength(0);
  });

  test("a valid subject of either basis is ACCEPTED, so the refusals above are refusals and not a boundary that refuses everything", async () => {
    const world = await ingestFixture();
    const accountSubject = await assignMerchant(context, deps(world), {
      counterpartyText: `${ACCOUNT_NAMESPACE}${IDENTITY_FIXTURE_ACCOUNTS.counterparty1}`,
      merchantName: "Demo Verzekering",
    });
    const descriptorSubject = await assignMerchant(context, deps(world), {
      counterpartyText: `${DESCRIPTOR_NAMESPACE}KOSTEN DEMO REKENINGPAKKET`,
      merchantName: "Demo Bank",
    });
    expect(accountSubject.ok).toBe(true);
    expect(descriptorSubject.ok).toBe(true);
    expect(world.rules).toHaveLength(2);
    // Stored VERBATIM: the namespace survives, which normalising would have
    // upper-cased away.
    expect(world.rules.map((rule) => rule.pattern).sort()).toEqual(
      [
        `${ACCOUNT_NAMESPACE}${IDENTITY_FIXTURE_ACCOUNTS.counterparty1}`,
        `${DESCRIPTOR_NAMESPACE}KOSTEN DEMO REKENINGPAKKET`,
      ].sort(),
    );
    expect(world.rules.every((rule) => rule.kind === "EXACT")).toBe(true);
  });

  test("the guard this REPLACES is gone, and the replacement is in its place", () => {
    const source = readFileSync(
      join(repositoryRoot, "src/modules/merchants/application/assign-merchant.ts"),
      "utf8",
    );
    // The old guard normalised the subject and refused an empty result.
    expect(source).not.toMatch(/normaliseCounterparty\(input\.counterpartyText\)/);
    // The replacement.
    expect(source).toMatch(/identityBasisOfKey\(pattern\)/);
    expect(source).toMatch(/unnamespaced-counterparty/);
    expect(source).toMatch(/untrusted-counterparty-account/);
  });
});

describe("the measurement harness is covered by the fast gate (plan step 1)", () => {
  test("it runs over the committed fixtures and prints counts, and its label can never carry an identifier out of a real document", () => {
    const output = execFileSync(
      "npx",
      [
        "tsx",
        "test/fixtures/measure-identity-convergence.ts",
        "test/fixtures/belfius-counterparty-identity.pdf",
        "test/fixtures/belfius-statement-a.pdf",
        "test/fixtures/kbc-statement-a.pdf",
      ],
      { cwd: repositoryRoot, encoding: "utf8" },
    );
    // COUNTS ONLY: every line is either a file label or a name followed by
    // an integer. Nothing parsed out of a statement ever reaches stdout.
    for (const line of output.trim().split("\n")) {
      expect(line, line).toMatch(/^(file [A-Za-z0-9._-]+|\s{2}[a-z-]+ \d+)$/);
    }
    expect(output).toMatch(/file belfius-counterparty-identity\.pdf/);
    expect(output).toMatch(/\n {2}rows 24\n/);
    expect(output).toMatch(/\n {2}identity-distinct-keys 12\n/);
    expect(output).toMatch(/\n {2}baseline-distinct-keys 24\n/);
  });

  test("a path OUTSIDE test/fixtures is labelled by its first eight characters only, which is what keeps a real upload's file name out of any record", async () => {
    const { measurementLabel } = await import(
      "../fixtures/measure-identity-convergence"
    );
    expect(measurementLabel("test/fixtures/belfius-statement-a.pdf")).toBe(
      "belfius-statement-a.pdf",
    );
    // A real upload's name embeds an account number and a document
    // reference; only its eight-character prefix survives.
    expect(
      measurementLabel("/somewhere/else/abcd1234-a-name-with-identifiers.pdf"),
    ).toBe("abcd1234");
  });
});
