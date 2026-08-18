import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { getDMMF } from "@prisma/internals";
import { describe, expect, test } from "vitest";
import { confirmImport } from "../../src/modules/import/application/confirm-import";
import { uploadStatement } from "../../src/modules/import/application/upload-statement";
import { detectSourceProfile } from "../../src/modules/import/domain/detect-profile";
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
