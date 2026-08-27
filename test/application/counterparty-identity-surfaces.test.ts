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
  isBareIdentityKey,
  isTrustedCounterpartyAccount,
} from "../../src/modules/merchants/domain/counterparty-identity";
import { matchRules } from "../../src/modules/merchants/domain/merchant-rule";
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
  // SETUP FIRST (M3-P14): the account a statement belongs to is registered
  // before the file is confirmed. A card carries no own-account column and
  // registers nothing.
  await world.registerAccountForStatement(context, bytes, detected.value, {
    label: "Daily account",
    bank: "Belfius",
    role: "POT",
  });
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
      { useTags: false, identity: counterpartyIdentity, isBareKey: isBareIdentityKey, normalise: normaliseCounterparty },
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

  // FIX ROUND, finding HZ-M3P12-01. The descriptor side had NO emptiness
  // test at all: the trim test above passes for any namespaced subject, and
  // the only emptiness test lived on the account branch. A page rendering a
  // group of rows that carry no counterparty text submitted `descriptor:`
  // and the boundary wrote an EXACT rule on the bare namespace.
  test("a DESCRIPTOR-basis subject with nothing after the namespace is refused and writes NOTHING", async () => {
    const world = await ingestFixture();
    for (const remainder of ["", "   ", "\t"]) {
      const outcome = await assignMerchant(context, deps(world), {
        counterpartyText: `${DESCRIPTOR_NAMESPACE}${remainder}`,
        merchantName: "Demo Bank",
      });
      expect(outcome.ok).toBe(false);
      if (!outcome.ok) {
        expect(outcome.error.kind).toBe("unidentifiable-counterparty");
      }
    }
    expect(world.rules).toHaveLength(0);
    expect(world.merchants).toHaveLength(0);
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
  test("it runs over the committed fixtures and prints counts, and every line is a label or a count", () => {
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

  // CORRECTED TWICE, AND THE SECOND CORRECTION IS THE POINT (fix round nine,
  // HAZARD finding CR7-M3P12-01, clause R-087).
  //
  // Fix round eight replaced "looks like a bank filename" with "looks like a
  // fleet handle" and called the claim enforced. Both are SHAPE. Belgium's
  // country code lowercases into the hex alphabet, so the very case the fix
  // was built for defeated it one case fold away: the uppercase basename was
  // refused and the same digits lowercased returned the country code, both
  // check digits and four digits of the account.
  //
  // The label is now decided by PROVENANCE. A committed fixture is named by
  // its basename, because that name is already public in this tree. Anything
  // else is named by its ORDINAL POSITION in the invocation, which the
  // operator chose and which carries no byte of the document, or by nothing at
  // all if no ordinal is given. NO OUTSIDE NAME IS READ, so there is no
  // spelling for a hostile one to have.
  test("no character of an OUTSIDE file name reaches a label, whatever the name is spelled like", async () => {
    const { measurementLabel, UNLABELLED } = await import(
      "../fixtures/measure-identity-convergence"
    );
    // A committed fixture keeps its basename: its provenance is the tree.
    expect(measurementLabel("test/fixtures/belfius-statement-a.pdf")).toBe(
      "belfius-statement-a.pdf",
    );

    // EVERY ONE OF THESE IS INVENTED, and they are chosen to be the shapes a
    // spelling test would disagree about: the fleet's own handle, the account
    // number that broke the first fix, the SAME account number lowercased that
    // broke the second, a mixed case of it, and two ordinary names. The point
    // is that the guard no longer distinguishes between them at all.
    const outside = [
      "/somewhere/else/abcd1234-a-name-with-identifiers.pdf",
      "/uploads/BE68539007547034-2026-06-statement.pdf",
      "/uploads/be68539007547034-2026-06-statement.pdf",
      "/uploads/Be68539007547034-2026-06-statement.pdf",
      "/uploads/Statement June 2026.pdf",
      "/uploads/deadbeef-cafe-1234-statement.pdf",
    ];
    for (const path of outside) {
      // With no ordinal: nothing at all. Fail closed.
      expect(measurementLabel(path)).toBe(UNLABELLED);
      // With one: the operator's own position, and nothing else.
      expect(measurementLabel(path, 2)).toBe("document-2");
    }

    // AND THE LEAK ITSELF, asserted directly rather than only through the
    // equality above: no fragment of the account number survives in any form,
    // in either case.
    const bankShaped = "/uploads/be68539007547034-2026-06-statement.pdf";
    for (const label of [
      measurementLabel(bankShaped),
      measurementLabel(bankShaped, 1),
    ]) {
      for (const fragment of ["BE68", "be68", "5390", "68539007"]) {
        expect(label).not.toContain(fragment);
      }
    }
  });

  // THE THIRD LEAK IN THE SAME FUNCTION (fix round nine, CRITERIA finding
  // CR7-M3P12-02). The committed-fixture branch tested a path PREFIX, so the
  // exemption was inherited by anything sitting at or below the fixture
  // directory whether the tree carried it or not. A real upload copied there
  // for one measurement run printed its own file name. The exemption is now
  // membership of the tracked tree, which is the provenance the header claims
  // and not the location it was standing in for.
  test("an UNTRACKED file under the fixture directory is an outside file, and so is anything in a subdirectory", async () => {
    const { measurementLabel, UNLABELLED } = await import(
      "../fixtures/measure-identity-convergence"
    );
    // Every value here is invented. None of these paths is in the tree.
    const notCommitted = [
      "test/fixtures/be68539007547034-2026-06-statement.pdf",
      "test/fixtures/BE68539007547034-2026-06-statement.pdf",
      "test/fixtures/uploads/be68539007547034-2026-06-statement.pdf",
      "test/fixtures/uploads/deeper/Statement June 2026.pdf",
    ];
    for (const path of notCommitted) {
      expect(measurementLabel(path)).toBe(UNLABELLED);
      expect(measurementLabel(path, 3)).toBe("document-3");
      for (const fragment of ["BE68", "be68", "5390", "Statement", "June"]) {
        expect(measurementLabel(path, 3)).not.toContain(fragment);
      }
    }
    // THE CONTROL, so the four refusals above are refusals and not a function
    // that now refuses everything: a fixture the tree really carries keeps its
    // basename.
    expect(measurementLabel("test/fixtures/kbc-card.csv")).toBe("kbc-card.csv");
  });
});

// FIX ROUND, finding HZ-M3P12-09. The privacy check that gate:privacy cannot
// make is now a COMMITTED harness with its definition in its own header, the
// way the convergence harness already was. This covers it in the fast gate
// and pins the definition, so a number recorded against it can be re-derived
// by anyone rather than only replicated in conclusion.
describe("the fixture token-overlap check is committed and covered (HZ-M3P12-09)", () => {
  test("its population is the fixture's own alphabetic runs of four or more, with the statement grammar subtracted", async () => {
    const { STATEMENT_GRAMMAR, fixtureDescriptions, nameLikeTokens, overlap } =
      await import("../fixtures/measure-fixture-token-overlap");
    const tokens = nameLikeTokens(fixtureDescriptions());
    expect(tokens.length).toBeGreaterThan(0);
    // Every token is uppercase, alphabetic, at least four characters, and
    // not a grammar word: the definition, asserted rather than described.
    for (const token of tokens) {
      expect(token).toMatch(/^[A-Z]{4,}$/);
      expect(STATEMENT_GRAMMAR.has(token)).toBe(false);
    }
    // A grammar word IS present in the fixture and IS excluded, so the
    // subtraction is doing work rather than being a no-op.
    expect(
      fixtureDescriptions().some((line) => line.includes("OVERSCHRIJVING")),
    ).toBe(true);
    expect(tokens).not.toContain("OVERSCHRIJVING");

    // The overlap function finds what is there and nothing else.
    const someToken = tokens[0] ?? "";
    expect(overlap(tokens, `PREFIX ${someToken} SUFFIX`)).toEqual([someToken]);
    expect(overlap(tokens, "")).toEqual([]);
  });

  test("it prints only strings drawn from the COMMITTED fixture, never from the corpus", async () => {
    const source = readFileSync(
      join(repositoryRoot, "test/fixtures/measure-fixture-token-overlap.ts"),
      "utf8",
    );
    // The corpus text is joined into one string, `corpusHaystack`, and that
    // string is only ever an argument to `includes`. Nothing logs it, and no
    // parsed description or counterparty name is logged either. What the
    // harness DOES print from a corpus path is a label and a row count, and
    // since fix round eight (CRITERIA finding CR6-M3P12-02) that label is
    // derived by the SAME guarded function the convergence harness uses, not
    // by a bare eight-character truncation: a truncation is safe only for a
    // file already carrying the fleet's hex handle, and a real bank export
    // leads its name with an account number.
    expect(source).not.toMatch(/console\.log\([^)]*corpusHaystack[^)]*\)/);
    expect(source).not.toMatch(/console\.log\([^)]*row\.description[^)]*\)/);
    expect(source).not.toMatch(/console\.log\([^)]*counterpartyName[^)]*\)/);
    expect(source).toMatch(/NEVER printed/);
    // And the label really goes through the guard, in every place it is
    // printed, WITH the invocation's own ordinal, rather than being derived
    // from the name here. The negative half is what stops a future edit
    // reintroducing either of the two truncations this has already had.
    //
    // READ AS CODE, NOT AS PROSE. This file's header QUOTES both discarded
    // implementations, because that is how clause R-087 requires a correction
    // to be written, so a search over the raw text finds the very strings the
    // negative assertions forbid. The lesson was first paid for by the client
    // scanner in test/db/gate-target.test.ts, a file since withdrawn with the
    // target interlock (decision D-62): a check that reads comments is
    // checking what the file SAYS rather than what it DOES.
    const code = source
      .split("\n")
      .map((line) => line.replace(/\/\/.*$/, ""))
      .join("\n");
    expect(code).toMatch(/measurementLabel\(path, ordinal\)/);
    expect(code).not.toMatch(/basename\(path\)/);
    expect(code).not.toMatch(/measurementLabel\(path\)/);
  });
});

// FIX ROUND TWO, findings CR2-M3P12-08 and HZ-M3P12-R2-02, raised
// independently by both clean-room lanes. The trust gate compacts and
// uppercases INTERNALLY before testing, so it accepted an account written
// spaced or lowercase; the boundary then stored the submitted string
// verbatim, while the derivation only ever emits the compact uppercase form.
// The naming was accepted and could never match a row.
describe("the stored subject is the subject that was validated (CR2-M3P12-08)", () => {
  const deps = (world: World) => ({
    merchants: world.merchantsPort,
    recompute: (ctx: HouseholdContext) =>
      recomputeInterpretation(ctx, world.ledgerDeps),
  });

  test("a SPACED LOWERCASE account subject is stored COMPACTED, equal to the key the derivation produces", async () => {
    const world = await ingestFixture();
    const compact = IDENTITY_FIXTURE_ACCOUNTS.counterparty1;
    const spacedLower = (compact.match(/.{1,4}/g) ?? []).join(" ").toLowerCase();
    expect(spacedLower).not.toBe(compact);
    // The gate accepts it, which is what made the old behaviour silent.
    expect(isTrustedCounterpartyAccount(spacedLower)).toBe(true);

    const outcome = await assignMerchant(context, deps(world), {
      counterpartyText: `${ACCOUNT_NAMESPACE}${spacedLower}`,
      merchantName: "Demo Verzekering",
    });
    expect(outcome.ok).toBe(true);

    const derived = counterpartyIdentity({
      description: "irrelevant",
      counterpartyAccount: spacedLower,
    }).key;
    const stored = world.rules[0]?.pattern;
    expect(stored).toBe(derived);
    // AND IT MATCHES, which is the property that was broken: one naming, one
    // stored rule, and the derived key resolves to it.
    expect(
      matchRules(derived, world.rules as never)?.merchantId,
    ).toBe(outcome.ok ? outcome.value.merchant.id : "");
  });

  test("a DESCRIPTOR subject that the normaliser would not emit for itself is REFUSED rather than repaired", async () => {
    const world = await ingestFixture();
    const outcome = await assignMerchant(context, deps(world), {
      counterpartyText: `${DESCRIPTOR_NAMESPACE}kosten demo rekeningpakket`,
      merchantName: "Demo Bank",
    });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.error.kind).toBe("non-canonical-counterparty");
    }
    expect(world.rules).toHaveLength(0);
    expect(world.merchants).toHaveLength(0);
  });

  test("a canonical descriptor subject is still ACCEPTED, so the refusal is a refusal and not a closed door", async () => {
    const world = await ingestFixture();
    const canonical = normaliseCounterparty("KOSTEN DEMO REKENINGPAKKET");
    const outcome = await assignMerchant(context, deps(world), {
      counterpartyText: `${DESCRIPTOR_NAMESPACE}${canonical}`,
      merchantName: "Demo Bank",
    });
    expect(outcome.ok).toBe(true);
    expect(world.rules[0]?.pattern).toBe(`${DESCRIPTOR_NAMESPACE}${canonical}`);
  });

  test("every refusal kind the use case can return is rendered by the screen, so none is silent", () => {
    const source = readFileSync(
      join(repositoryRoot, "src/modules/merchants/application/assign-merchant.ts"),
      "utf8",
    );
    const kinds = [...source.matchAll(/kind: "([a-z-]+)"/g)].map((m) => m[1]);
    expect(kinds.length).toBeGreaterThan(0);
    const screen = readFileSync(
      join(repositoryRoot, "src/modules/merchants/ui/merchant-review.tsx"),
      "utf8",
    );
    for (const kind of new Set(kinds)) {
      if (kind === "EXACT") {
        continue;
      }
      expect(screen, kind).toContain(`"${kind ?? ""}"`);
    }
  });
});
