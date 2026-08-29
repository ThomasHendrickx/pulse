import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { getDMMF } from "@prisma/internals";
import { describe, expect, test } from "vitest";
import { confirmImport } from "../../src/modules/import/application/confirm-import";
import { uploadStatement } from "../../src/modules/import/application/upload-statement";
import { detectSourceProfile } from "../../src/modules/import/domain/detect-profile";
import { assignDedupKeys, zipRowsWithDedupKeys } from "../../src/modules/import/domain/dedup";
import { parseStatement } from "../../src/modules/import/domain/parse-statement";
import { householdId, userId, type HouseholdContext } from "../../src/platform/tenancy";
import { makeFakeImportWorld, type FakeImportWorld } from "./fake-import-world";

// Criteria 1.2, 1.3, 1.4: idempotent ingest over dedup keys, the
// mixed-account hard failure, and rawLine on every stored row. The use
// cases run against in-memory fakes of the ports (the fast gate has no
// database, pulse-typescript section 8); the REAL uniqueness mechanism is
// asserted by name over the DMMF below, and the migration side is covered
// by test/schema/rls.test.ts's sibling assertions.

const context: HouseholdContext = {
  householdId: householdId("00000000-0000-4000-8000-0000000000aa"),
  userId: userId("00000000-0000-4000-8000-0000000000ab"),
};

const otherHousehold: HouseholdContext = {
  householdId: householdId("00000000-0000-4000-8000-0000000000ba"),
  userId: userId("00000000-0000-4000-8000-0000000000bb"),
};

const fixture = (name: string): Uint8Array =>
  new Uint8Array(readFileSync(join(__dirname, "..", "fixtures", name)));

const detectedSpec = (name: string) => {
  const detected = detectSourceProfile(fixture(name));
  if (!detected.ok) {
    throw new Error(`detection failed for ${name}`);
  }
  return detected.value;
};

// Walk the full flow for a first-seen file: upload (which asks), then
// confirm with an account declaration.
const uploadAndDeclare = async (
  world: FakeImportWorld,
  ctx: HouseholdContext,
  name: string,
  declaration: { label: string; bank: string; role: "POT" | "RESERVE" },
) => {
  const uploaded = await uploadStatement(ctx, world.deps, {
    fileName: name,
    bytes: fixture(name),
  });
  expect(uploaded.kind).toBe("awaiting-declaration");
  if (uploaded.kind !== "awaiting-declaration") {
    throw new Error("unreachable");
  }
  // SETUP FIRST (M3-P14): the account a statement belongs to is registered
  // before the file is confirmed, because confirmImport now refuses a file
  // whose own account is not one the household registered. A card carries no
  // own-account column and registers nothing.
  await world.registerAccountForStatement(
    ctx,
    fixture(name),
    detectedSpec(name),
    declaration,
  );
  const confirmed = await confirmImport(ctx, world.deps, {
    importId: uploaded.importId,
    profileName: `${name} profile`,
    spec: detectedSpec(name),
    declaration,
  });
  expect(confirmed.kind).toBe("ingested");
  if (confirmed.kind !== "ingested") {
    throw new Error("unreachable");
  }
  return confirmed;
};

describe("idempotent ingest with overlap (criterion 1.2)", () => {
  test("importing A then overlapping A2 adds exactly the non-overlapping rows and reports counts", async () => {
    const world = makeFakeImportWorld();

    const first = await uploadAndDeclare(world, context, "belfius-account-a.csv", {
      label: "Daily account",
      bank: "Demobank",
      role: "POT",
    });
    expect(first.added).toBe(6);
    expect(first.known).toBe(0);

    // The overlapping re-export: same profile, same account, no questions.
    const second = await uploadStatement(context, world.deps, {
      fileName: "belfius-account-a2.csv",
      bytes: fixture("belfius-account-a2.csv"),
    });
    expect(second.kind).toBe("ingested");
    if (second.kind !== "ingested") {
      return;
    }
    expect(second.added).toBe(3);
    expect(second.known).toBe(3);
    expect(world.transactions).toHaveLength(9);
  });

  test("dedup keys are unique per household in the stored rows", async () => {
    const world = makeFakeImportWorld();
    await uploadAndDeclare(world, context, "belfius-account-a.csv", {
      label: "Daily account",
      bank: "Demobank",
      role: "POT",
    });
    await uploadStatement(context, world.deps, {
      fileName: "belfius-account-a2.csv",
      bytes: fixture("belfius-account-a2.csv"),
    });
    // A second household importing the same file keeps its own key space.
    await uploadAndDeclare(world, otherHousehold, "belfius-account-a.csv", {
      label: "Daily account",
      bank: "Demobank",
      role: "POT",
    });

    const perHousehold = new Map<string, Set<string>>();
    for (const row of world.transactions) {
      const keys = perHousehold.get(row.householdId) ?? new Set<string>();
      expect(keys.has(row.dedupKey)).toBe(false);
      keys.add(row.dedupKey);
      perHousehold.set(row.householdId, keys);
    }
    // And the second household really did store its six rows.
    expect(
      world.transactions.filter((row) => row.householdId === otherHousehold.householdId),
    ).toHaveLength(6);
  });

  test("the real schema enforces the same uniqueness, asserted by name over the DMMF", async () => {
    const schemaDir = join(__dirname, "..", "..", "prisma", "schema");
    const datamodel = readdirSync(schemaDir)
      .filter((name) => name.endsWith(".prisma"))
      .sort()
      .map((name) => readFileSync(join(schemaDir, name), "utf-8"))
      .join("\n");
    const dmmf = await getDMMF({ datamodel });
    const transaction = dmmf.datamodel.models.find(
      (model) => model.name === "Transaction",
    );
    expect(transaction).toBeDefined();
    expect(
      transaction?.uniqueFields.some(
        (fields) => fields.join(",") === "householdId,dedupKey",
      ),
    ).toBe(true);
  });

  test("two legitimate identical rows store two Transaction rows; re-upload adds zero", async () => {
    const world = makeFakeImportWorld();

    // Card shape: no own-account column, so the account is declared at the
    // profile's first sight and bound to it.
    const first = await uploadAndDeclare(world, context, "kbc-card.csv", {
      label: "Credit card",
      bank: "Demokaart",
      role: "POT",
    });
    expect(first.added).toBe(6);

    const duplicates = world.transactions.filter(
      (row) => row.description === "STARBUCKS ANTWERPEN",
    );
    expect(duplicates).toHaveLength(2);
    expect(new Set(duplicates.map((row) => row.dedupKey)).size).toBe(2);

    // Re-upload of the SAME file: recognised by spec, account through the
    // profile binding, nothing asked, nothing added.
    const second = await uploadStatement(context, world.deps, {
      fileName: "kbc-card.csv",
      bytes: fixture("kbc-card.csv"),
    });
    expect(second.kind).toBe("ingested");
    if (second.kind !== "ingested") {
      return;
    }
    expect(second.added).toBe(0);
    expect(second.known).toBe(6);
    expect(world.transactions).toHaveLength(6);
  });

  test("partial overlap keeps the highest occurrence count per identical tuple (owner v0.2 addendum section 5)", async () => {
    const world = makeFakeImportWorld();

    // Import A carries ONE occurrence of the identical tuple.
    await uploadAndDeclare(world, context, "kbc-card.csv", {
      label: "Credit card",
      bank: "Demokaart",
      role: "POT",
    });
    expect(
      world.transactions.filter((row) => row.description === "PIZZA NAPOLI BRUSSEL"),
    ).toHaveLength(1);

    // Overlapping import B carries TWO occurrences of that same tuple.
    const second = await uploadStatement(context, world.deps, {
      fileName: "kbc-card-b.csv",
      bytes: fixture("kbc-card-b.csv"),
    });
    expect(second.kind).toBe("ingested");
    if (second.kind !== "ingested") {
      return;
    }
    // Ordinal #0 is already known, ordinal #1 and the new row are added.
    expect(second.added).toBe(2);
    expect(second.known).toBe(1);

    // The end state is EXACTLY two rows for the tuple: the highest
    // occurrence count seen across imports, never three, never one.
    expect(
      world.transactions.filter((row) => row.description === "PIZZA NAPOLI BRUSSEL"),
    ).toHaveLength(2);
  });
});

describe("mixed-account files fail loudly with nothing written (criterion 1.3)", () => {
  test("a file with rows from two accounts becomes a FAILED import with zero rows", async () => {
    const world = makeFakeImportWorld();
    const outcome = await uploadStatement(context, world.deps, {
      fileName: "mixed-accounts.csv",
      bytes: fixture("mixed-accounts.csv"),
    });
    expect(outcome.kind).toBe("failed");
    if (outcome.kind !== "failed") {
      return;
    }
    expect(outcome.reason).toBe("mixed-accounts");
    const record = world.imports.get(outcome.importId);
    expect(record?.status).toBe("FAILED");
    expect(record?.failureReason).toBe("mixed-accounts");
    expect(world.transactions).toHaveLength(0);
  });

  test("a mixed-account file caught at confirm time also writes nothing", async () => {
    const world = makeFakeImportWorld();
    // Force the confirm path: upload leaves it awaiting because nothing is
    // declared yet. Confirming with a spec that maps the account column
    // still refuses to ingest a two-account file.
    const uploaded = await uploadStatement(context, world.deps, {
      fileName: "mixed-accounts.csv",
      bytes: fixture("mixed-accounts.csv"),
    });
    // Upload already fails it; construct the confirm-time case directly on
    // a fresh awaiting import carrying the mixed bytes.
    expect(uploaded.kind).toBe("failed");
    const awaiting = await world.deps.imports.createImport(context, {
      fileName: "mixed-accounts.csv",
      rawContent: fixture("mixed-accounts.csv"),
      status: "AWAITING_DECLARATION",
    });
    const confirmed = await confirmImport(context, world.deps, {
      importId: awaiting.id,
      profileName: "mixed profile",
      spec: detectedSpec("mixed-accounts.csv"),
      declaration: { label: "x", bank: "y", role: "POT" },
    });
    expect(confirmed.kind).toBe("failed");
    expect(world.transactions).toHaveLength(0);
    expect(world.imports.get(awaiting.id)?.status).toBe("FAILED");
  });
});

describe("unknown indicator markers fail the import loudly at confirm time (finding F2)", () => {
  test("a STORNO row confirmed with the card spec ends FAILED unparseable with zero rows", async () => {
    const world = makeFakeImportWorld();
    const awaiting = await world.deps.imports.createImport(context, {
      fileName: "kbc-card-storno.csv",
      rawContent: fixture("kbc-card-storno.csv"),
      status: "AWAITING_DECLARATION",
    });
    const confirmed = await confirmImport(context, world.deps, {
      importId: awaiting.id,
      profileName: "card profile",
      spec: detectedSpec("kbc-card.csv"),
      declaration: { label: "Credit card", bank: "Demokaart", role: "POT" },
    });
    expect(confirmed.kind).toBe("failed");
    if (confirmed.kind === "failed") {
      expect(confirmed.reason).toBe("unparseable");
    }
    expect(world.imports.get(awaiting.id)?.status).toBe("FAILED");
    expect(world.imports.get(awaiting.id)?.failureReason).toBe("unparseable");
    expect(world.transactions).toHaveLength(0);
  });
});

describe("every stored Transaction carries its verbatim source line (criterion 1.4)", () => {
  test("rawLine equals the source line for every ingested row, both fixtures", async () => {
    const world = makeFakeImportWorld();
    await uploadAndDeclare(world, context, "belfius-account-a.csv", {
      label: "Daily account",
      bank: "Demobank",
      role: "POT",
    });
    await uploadAndDeclare(world, context, "kbc-card.csv", {
      label: "Credit card",
      bank: "Demokaart",
      role: "POT",
    });

    const sourceLines = (name: string, encoding: string): string[] =>
      new TextDecoder(encoding)
        .decode(fixture(name))
        .split("\n")
        .map((line) => line.replace(/\r$/, ""))
        .filter((line) => line.trim() !== "")
        .slice(2); // preamble + header

    const expected = [
      ...sourceLines("belfius-account-a.csv", "windows-1252"),
      ...sourceLines("kbc-card.csv", "utf-8"),
    ];
    const stored = world.transactions.map((row) => row.rawLine);
    expect(stored).toHaveLength(expected.length);
    expect([...stored].sort()).toEqual([...expected].sort());
  });
});

describe("racing confirms cannot double-ingest one awaiting import (finding F4)", () => {
  test("the status transition is claimed atomically: the second ingest is refused with zero rows", async () => {
    const world = makeFakeImportWorld();
    const awaiting = await world.deps.imports.createImport(context, {
      fileName: "kbc-card.csv",
      rawContent: fixture("kbc-card.csv"),
      status: "AWAITING_DECLARATION",
    });
    const spec = detectedSpec("kbc-card.csv");
    const parsed = parseStatement(fixture("kbc-card.csv"), spec);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }
    const accountA = await world.deps.accounts.declareAccount(context, {
      label: "Card A",
      bank: "Demokaart",
      role: "POT",
    });
    const accountB = await world.deps.accounts.declareAccount(context, {
      label: "Card B",
      bank: "Demokaart",
      role: "POT",
    });
    const created = await world.deps.imports.createProfile(context, {
      name: "card",
      spec,
      accountId: accountA.id,
    });
    if (!created.ok) {
      throw new Error("the fixture profile name is free in a fresh world");
    }
    const profile = created.profile;

    // Both racers passed the read-time status check; the claim inside the
    // ingest transaction is what must arbitrate.
    const ingestAs = (accountId: string) =>
      world.deps.imports.ingestRows(context, {
        importId: awaiting.id,
        accountId,
        sourceProfileId: profile.id,
        fromStatus: "AWAITING_DECLARATION",
        rows: zipRowsWithDedupKeys(
          parsed.value.rows,
          assignDedupKeys(accountId, parsed.value.rows, spec),
        ),
      });

    const first = await ingestAs(accountA.id);
    expect(first.ok).toBe(true);
    if (first.ok) {
      expect(first.added).toBe(6);
    }

    const second = await ingestAs(accountB.id);
    expect(second.ok).toBe(false);
    if (!second.ok) {
      expect(second.error).toBe("not-in-expected-status");
    }
    // Nothing from the losing racer landed: six rows, all on account A.
    expect(world.transactions).toHaveLength(6);
    expect(
      world.transactions.filter((row) => row.accountId === accountB.id),
    ).toHaveLength(0);
  });

  test("a second confirm of an already-confirmed import is rejected with zero new rows", async () => {
    const world = makeFakeImportWorld();
    const awaiting = await world.deps.imports.createImport(context, {
      fileName: "kbc-card.csv",
      rawContent: fixture("kbc-card.csv"),
      status: "AWAITING_DECLARATION",
    });
    const spec = detectedSpec("kbc-card.csv");
    const first = await confirmImport(context, world.deps, {
      importId: awaiting.id,
      profileName: "card profile",
      spec,
      declaration: { label: "Card A", bank: "Demokaart", role: "POT" },
    });
    expect(first.kind).toBe("ingested");
    const countAfterFirst = world.transactions.length;

    const second = await confirmImport(context, world.deps, {
      importId: awaiting.id,
      profileName: "card profile twin",
      spec,
      declaration: { label: "Card B", bank: "Demokaart", role: "POT" },
    });
    expect(second.kind).toBe("rejected");
    expect(world.transactions).toHaveLength(countAfterFirst);
  });
});

describe("the landing account is resolved as the screens name it (finding F1)", () => {
  test("a card file confirmed while a spec-identical bound profile exists lands in the bound account, no declaration needed", async () => {
    const world = makeFakeImportWorld();
    await uploadAndDeclare(world, context, "kbc-card.csv", {
      label: "Credit card",
      bank: "Demokaart",
      role: "POT",
    });
    const boundAccountId = world.accounts[0]?.id;
    expect(boundAccountId).toBeDefined();

    // An overlapping card export in the same format, reaching the confirm
    // path directly: the account rides the stored profile's binding, the
    // exact rule the confirmation screen renders as the landing account.
    const awaiting = await world.deps.imports.createImport(context, {
      fileName: "kbc-card-b.csv",
      rawContent: fixture("kbc-card-b.csv"),
      status: "AWAITING_DECLARATION",
    });
    const confirmed = await confirmImport(context, world.deps, {
      importId: awaiting.id,
      profileName: "unused twin name",
      spec: detectedSpec("kbc-card-b.csv"),
    });
    expect(confirmed.kind).toBe("ingested");
    if (confirmed.kind !== "ingested") {
      return;
    }
    expect(confirmed.added).toBe(2);
    expect(confirmed.known).toBe(1);
    // Every stored row from that import sits on the BOUND account: what
    // the screen names is what the ingest used.
    const rowsFromB = world.transactions.filter(
      (row) => row.importId === awaiting.id,
    );
    expect(rowsFromB.length).toBeGreaterThan(0);
    for (const row of rowsFromB) {
      expect(row.accountId).toBe(boundAccountId);
    }
    // No second account and no twin profile appeared.
    expect(world.accounts).toHaveLength(1);
    expect(world.profiles).toHaveLength(1);
  });
});

// THE FORMAT QUESTION ANSWERED TWICE WITH THE SAME NAME. Live defect,
// pre-existing: a second format given a name the household already gave a
// different one hit the (householdId, name) unique index on
// source_profiles, and the unhandled P2002 reached the framework as an
// application error page. It is an ordinary thing for a reader to do, so
// it is an EXPECTED failure and comes back as a typed refusal the screen
// renders. The fake repository reproduces the index, so this runs without
// a database; the index itself is asserted by name over the DMMF above.
describe("a format name already used is refused, not crashed on", () => {
  const CARD_DECLARATION = {
    label: "Credit card",
    bank: "Demokaart",
    role: "POT",
  } as const;

  // A first format, named, stored.
  const withFirstFormat = async (name: string): Promise<FakeImportWorld> => {
    const world = makeFakeImportWorld();
    const uploaded = await uploadStatement(context, world.deps, {
      fileName: "belfius-account-a.csv",
      bytes: fixture("belfius-account-a.csv"),
    });
    if (uploaded.kind !== "awaiting-declaration") {
      throw new Error("the first file should ask");
    }
    await world.registerAccountForStatement(
      context,
      fixture("belfius-account-a.csv"),
      detectedSpec("belfius-account-a.csv"),
      { label: "Daily account", bank: "Demobank", role: "POT" },
    );
    const confirmed = await confirmImport(context, world.deps, {
      importId: uploaded.importId,
      profileName: name,
      spec: detectedSpec("belfius-account-a.csv"),
    });
    expect(confirmed.kind).toBe("ingested");
    return world;
  };

  // A second, DIFFERENT format reaching the confirm step: the card export
  // detects a different spec, so no stored profile is reused and the name
  // is the only thing in the way.
  const confirmCardAs = async (world: FakeImportWorld, profileName: string) => {
    const uploaded = await uploadStatement(context, world.deps, {
      fileName: "kbc-card.csv",
      bytes: fixture("kbc-card.csv"),
    });
    if (uploaded.kind !== "awaiting-declaration") {
      throw new Error("the card file should ask");
    }
    const outcome = await confirmImport(context, world.deps, {
      importId: uploaded.importId,
      profileName,
      spec: detectedSpec("kbc-card.csv"),
      declaration: CARD_DECLARATION,
    });
    return { importId: uploaded.importId, outcome };
  };

  test("a second format under a used name is rejected with profile-name-taken", async () => {
    const world = await withFirstFormat("Household export");
    const { outcome } = await confirmCardAs(world, "Household export");
    expect(outcome.kind).toBe("rejected");
    if (outcome.kind !== "rejected") {
      return;
    }
    expect(outcome.reason).toBe("profile-name-taken");
  });

  test("the refused confirm writes nothing: no twin profile, no account, no rows", async () => {
    const world = await withFirstFormat("Household export");
    const rowsBefore = world.transactions.length;
    const { importId } = await confirmCardAs(world, "Household export");
    // One profile and one account, both from the first file. The card's
    // account declaration is NOT written by a refused confirm, which is
    // why the name check runs ahead of account resolution.
    expect(world.profiles).toHaveLength(1);
    expect(world.accounts).toHaveLength(1);
    expect(world.transactions).toHaveLength(rowsBefore);
    // And the import is still awaiting, so answering again is all it takes.
    expect(world.imports.get(importId)?.status).toBe("AWAITING_DECLARATION");
  });

  test("answering again with a free name imports the same file", async () => {
    const world = await withFirstFormat("Household export");
    const refused = await confirmCardAs(world, "Household export");
    expect(refused.outcome.kind).toBe("rejected");
    const outcome = await confirmImport(context, world.deps, {
      importId: refused.importId,
      profileName: "Card export",
      spec: detectedSpec("kbc-card.csv"),
      declaration: CARD_DECLARATION,
    });
    expect(outcome.kind).toBe("ingested");
    if (outcome.kind !== "ingested") {
      return;
    }
    expect(outcome.added).toBe(6);
    expect(world.profiles).toHaveLength(2);
  });

  test("the SAME name on a spec-identical file is reuse, not a refusal", async () => {
    // The refusal is narrow on purpose: re-confirming the format already
    // stored reuses that profile and stores no twin, exactly as before.
    const world = await withFirstFormat("Household export");
    const awaiting = await world.deps.imports.createImport(context, {
      fileName: "belfius-account-a2.csv",
      rawContent: fixture("belfius-account-a2.csv"),
      status: "AWAITING_DECLARATION",
    });
    const outcome = await confirmImport(context, world.deps, {
      importId: awaiting.id,
      profileName: "Household export",
      spec: detectedSpec("belfius-account-a2.csv"),
    });
    expect(outcome.kind).toBe("ingested");
    expect(world.profiles).toHaveLength(1);
  });

  test("the repository's own refusal is honoured, for the race the read cannot close", async () => {
    // Two confirms both pass the read-time name check and the unique
    // index arbitrates: the loser gets the SAME typed refusal rather than
    // an escaping constraint violation.
    const world = makeFakeImportWorld();
    const uploaded = await uploadStatement(context, world.deps, {
      fileName: "kbc-card.csv",
      bytes: fixture("kbc-card.csv"),
    });
    if (uploaded.kind !== "awaiting-declaration") {
      throw new Error("the card file should ask");
    }
    const stored = await world.deps.imports.createProfile(context, {
      name: "Card export",
      // A spec no confirm will match, so the name is the only collision.
      spec: detectedSpec("belfius-account-a.csv"),
    });
    expect(stored.ok).toBe(true);
    // The port refuses the second write of that name, by value.
    const twin = await world.deps.imports.createProfile(context, {
      name: "Card export",
      spec: detectedSpec("kbc-card.csv"),
    });
    expect(twin.ok).toBe(false);
    if (twin.ok) {
      return;
    }
    expect(twin.error).toBe("name-taken");
    // And the use case in front of it refuses rather than throwing.
    const outcome = await confirmImport(context, world.deps, {
      importId: uploaded.importId,
      profileName: "Card export",
      spec: detectedSpec("kbc-card.csv"),
      declaration: CARD_DECLARATION,
    });
    expect(outcome.kind).toBe("rejected");
    if (outcome.kind !== "rejected") {
      return;
    }
    expect(outcome.reason).toBe("profile-name-taken");
  });
});
