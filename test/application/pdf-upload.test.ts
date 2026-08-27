import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { householdId, userId, type HouseholdContext } from "../../src/platform/tenancy";
import { confirmImport } from "../../src/modules/import/application/confirm-import";
import { uploadStatement } from "../../src/modules/import/application/upload-statement";
import { statementParser } from "../../src/modules/import/adapters/statement-parser";
import { FIXTURE_A_TRANSACTIONS } from "../fixtures/generate-pdf-fixtures";
import { makeFakeImportWorld } from "./fake-import-world";

// Criteria 2.2 and 2.3: the PDF path through uploadStatement end to end
// over the fake world (real parser adapter, real interpretation, fake
// persistence with the real insert semantics).

const context: HouseholdContext = {
  householdId: householdId("household-1"),
  userId: userId("user-1"),
};

const fixture = (name: string): Uint8Array =>
  new Uint8Array(readFileSync(join(__dirname, "..", "fixtures", name)));

const ROW_COUNT_A = FIXTURE_A_TRANSACTIONS.length;

// Upload fixture A into a fresh world and complete the ask-once account
// declaration (the account is unseen, so the upload parks the import in
// AWAITING_DECLARATION; ONLY the declaration is asked, the format
// question does not exist for a recognised layout).
const setupIngestedFixtureA = async (): Promise<{
  world: ReturnType<typeof makeFakeImportWorld>;
  importId: string;
  added: number;
  known: number;
}> => {
  const world = makeFakeImportWorld();
  const uploaded = await uploadStatement(context, world.deps, {
    fileName: "statement-a.pdf",
    bytes: fixture("belfius-statement-a.pdf"),
  });
  expect(uploaded.kind).toBe("awaiting-declaration");
  if (uploaded.kind !== "awaiting-declaration") {
    throw new Error("unreachable");
  }
  const detected = await statementParser.detect(fixture("belfius-statement-a.pdf"));
  expect(detected.ok).toBe(true);
  if (!detected.ok) {
    throw new Error("unreachable");
  }
  // SETUP FIRST (M3-P14): the account a statement belongs to is registered
  // before the file is confirmed. A card carries no own-account column and
  // registers nothing.
  await world.registerAccountForStatement(
    context,
    fixture("belfius-statement-a.pdf"),
    detected.value,
    { label: "Daily account", bank: "Belfius", role: "POT" },
  );
  const confirmed = await confirmImport(context, world.deps, {
    importId: uploaded.importId,
    profileName: "belfius-current-account-nl",
    spec: detected.value,
    declaration: { label: "Daily account", bank: "Belfius", role: "POT" },
  });
  expect(confirmed.kind).toBe("ingested");
  if (confirmed.kind !== "ingested") {
    throw new Error("unreachable");
  }
  return {
    world,
    importId: uploaded.importId,
    added: confirmed.added,
    known: confirmed.known,
  };
};

describe("loud FAILED imports on the PDF path (criterion 2.2)", () => {
  test("the non-reconciling fixture fails with balance-mismatch and zero rows written", async () => {
    const world = makeFakeImportWorld();
    const outcome = await uploadStatement(context, world.deps, {
      fileName: "broken.pdf",
      bytes: fixture("belfius-nonreconciling.pdf"),
    });
    expect(outcome.kind).toBe("failed");
    if (outcome.kind === "failed") {
      expect(outcome.reason).toBe("balance-mismatch");
    }
    const imports = [...world.imports.values()];
    expect(imports).toHaveLength(1);
    expect(imports[0]?.status).toBe("FAILED");
    expect(imports[0]?.failureReason).toBe("balance-mismatch");
    expect(world.transactions).toHaveLength(0);
  });

  test("a valid PDF matching no template fails with layout-unsupported and zero rows", async () => {
    const world = makeFakeImportWorld();
    const outcome = await uploadStatement(context, world.deps, {
      fileName: "unknown.pdf",
      bytes: fixture("unknown-layout.pdf"),
    });
    expect(outcome.kind).toBe("failed");
    if (outcome.kind === "failed") {
      expect(outcome.reason).toBe("layout-unsupported");
    }
    const imports = [...world.imports.values()];
    expect(imports).toHaveLength(1);
    expect(imports[0]?.status).toBe("FAILED");
    expect(imports[0]?.failureReason).toBe("layout-unsupported");
    expect(world.transactions).toHaveLength(0);
  });
});

describe("distinct PDF failure reasons (fix round 1, HZ-002 and HZ-003)", () => {
  test("corrupt bytes behind a PDF magic header fail as extraction-failed, not layout-unsupported", async () => {
    const world = makeFakeImportWorld();
    const outcome = await uploadStatement(context, world.deps, {
      fileName: "corrupt.pdf",
      bytes: new TextEncoder().encode("%PDF-1.4 not really a pdf at all"),
    });
    expect(outcome.kind).toBe("failed");
    if (outcome.kind === "failed") {
      expect(outcome.reason).toBe("extraction-failed");
    }
    const imports = [...world.imports.values()];
    expect(imports[0]?.failureReason).toBe("extraction-failed");
    expect(world.transactions).toHaveLength(0);
  });

  test("a stored profile at a stale template version fails the upload loudly instead of silently twinning (HZ-002)", async () => {
    const world = makeFakeImportWorld();
    // A profile stored under a template version this build does not
    // carry (the state after a future version bump without migration).
    await world.deps.imports.createProfile(context, {
      name: "belfius-current-account-nl",
      spec: {
        kind: "pdf-layout",
        templateId: "belfius-current-account-nl",
        templateVersion: 999,
      },
    });
    const outcome = await uploadStatement(context, world.deps, {
      fileName: "statement-a.pdf",
      bytes: fixture("belfius-statement-a.pdf"),
    });
    expect(outcome.kind).toBe("failed");
    if (outcome.kind === "failed") {
      expect(outcome.reason).toBe("layout-version-mismatch");
    }
    // Zero rows, and no twin profile was created.
    expect(world.transactions).toHaveLength(0);
    expect(world.profiles).toHaveLength(1);
  });
});

describe("PDF dedup under the D-4 year-scoped natural key (criterion 2.3)", () => {
  test("the same fixture twice: all rows added first, zero added and all known second, nothing asked", async () => {
    const { world, added, known } = await setupIngestedFixtureA();
    expect({ added, known }).toEqual({ added: ROW_COUNT_A, known: 0 });

    const again = await uploadStatement(context, world.deps, {
      fileName: "statement-a.pdf",
      bytes: fixture("belfius-statement-a.pdf"),
    });
    // Recognised by spec equality and account identity from the band
    // IBAN: no question, straight to an idempotent ingest.
    expect(again.kind).toBe("ingested");
    if (again.kind === "ingested") {
      expect(again.added).toBe(0);
      expect(again.known).toBe(ROW_COUNT_A);
    }
    expect(world.transactions).toHaveLength(ROW_COUNT_A);
  });

  test("the overlapping re-export adds only its genuinely new rows (finding PR2-003): shared year-and-sequence pairs are known", async () => {
    const { world } = await setupIngestedFixtureA();
    const overlap = await uploadStatement(context, world.deps, {
      fileName: "statement-b.pdf",
      bytes: fixture("belfius-statement-b-overlap.pdf"),
    });
    expect(overlap.kind).toBe("ingested");
    if (overlap.kind === "ingested") {
      // Fixture B re-carries 0108 and 0109 from fixture A and adds 0110,
      // 0111, 0112. A template emitting STATEMENT-scoped key components
      // would report all five added and this test reddens.
      expect(overlap.added).toBe(3);
      expect(overlap.known).toBe(2);
    }
    expect(world.transactions).toHaveLength(ROW_COUNT_A + 3);
    // The shared rows kept their original keys: one row per key.
    const keys = world.transactions.map((transaction) => transaction.dedupKey);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
