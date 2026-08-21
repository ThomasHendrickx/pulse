import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { householdId, userId, type HouseholdContext } from "../../src/platform/tenancy";
import { confirmImport } from "../../src/modules/import/application/confirm-import";
import { uploadStatement } from "../../src/modules/import/application/upload-statement";
import {
  KBC_FIXTURE_ROW_COUNT,
  KBC_STATEMENT_NUMBER,
} from "../fixtures/generate-pdf-fixtures";
import { makeFakeImportWorld } from "./fake-import-world";

// Criteria 3.2 and 3.3: the KBC card format through the PDF path end to
// end over the fake world (real parser adapter, real interpretation,
// fake persistence with the real insert semantics). The card file
// carries no IBAN, so the account rides the confirmed profile's binding,
// and no sequence numbers, so dedup takes the HASH path with the
// occurrence ordinal.

const context: HouseholdContext = {
  householdId: householdId("household-1"),
  userId: userId("user-1"),
};

const fixture = (name: string): Uint8Array =>
  new Uint8Array(readFileSync(join(__dirname, "..", "fixtures", name)));

const DUPLICATE_DESCRIPTION = "TAPAUTOMAAT PERRON 7 GENT B";

// Upload the KBC card fixture into the given world and complete the
// ask-once account declaration (label, bank, ring; the file has no IBAN
// so the profile is bound to the declared card account).
const ingestKbcFixture = async (
  world: ReturnType<typeof makeFakeImportWorld>,
): Promise<{ importId: string; added: number; known: number }> => {
  const uploaded = await uploadStatement(context, world.deps, {
    fileName: "kbc-statement-a.pdf",
    bytes: fixture("kbc-statement-a.pdf"),
  });
  expect(uploaded.kind).toBe("awaiting-declaration");
  if (uploaded.kind !== "awaiting-declaration") {
    throw new Error("unreachable");
  }
  const detected = await world.deps.parser.detect(fixture("kbc-statement-a.pdf"));
  expect(detected.ok).toBe(true);
  if (!detected.ok) {
    throw new Error("unreachable");
  }
  const confirmed = await confirmImport(context, world.deps, {
    importId: uploaded.importId,
    profileName: "kbc-mastercard-uitgavenstaat",
    spec: detected.value,
    declaration: { label: "Credit card", bank: "KBC", role: "POT" },
  });
  expect(confirmed.kind).toBe("ingested");
  if (confirmed.kind !== "ingested") {
    throw new Error("unreachable");
  }
  return {
    importId: uploaded.importId,
    added: confirmed.added,
    known: confirmed.known,
  };
};

const ingestCompanionFixture = async (
  world: ReturnType<typeof makeFakeImportWorld>,
): Promise<{ importId: string }> => {
  const uploaded = await uploadStatement(context, world.deps, {
    fileName: "belfius-settlement-companion.pdf",
    bytes: fixture("belfius-settlement-companion.pdf"),
  });
  expect(uploaded.kind).toBe("awaiting-declaration");
  if (uploaded.kind !== "awaiting-declaration") {
    throw new Error("unreachable");
  }
  const detected = await world.deps.parser.detect(
    fixture("belfius-settlement-companion.pdf"),
  );
  expect(detected.ok).toBe(true);
  if (!detected.ok) {
    throw new Error("unreachable");
  }
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
  return { importId: uploaded.importId };
};

describe("the identical duplicate pair through the PDF path (criterion 3.2, hazard H3.3)", () => {
  test("both identical rows survive the first import; re-import adds zero and reports all known, both rows still present", async () => {
    const world = makeFakeImportWorld();
    const { added, known } = await ingestKbcFixture(world);
    expect({ added, known }).toEqual({ added: KBC_FIXTURE_ROW_COUNT, known: 0 });

    const duplicates = world.transactions.filter(
      (transaction) => transaction.description === DUPLICATE_DESCRIPTION,
    );
    expect(duplicates).toHaveLength(2);
    // Distinct HASH keys differing only in the occurrence ordinal: the
    // dedup mechanism that keeps two legitimate identical payments as
    // two facts.
    const keys = duplicates.map((transaction) => transaction.dedupKey).sort();
    expect(keys[0]).toMatch(/^h:[0-9a-f]{64}#0$/);
    expect(keys[1]).toMatch(/^h:[0-9a-f]{64}#1$/);
    expect(keys[0]?.slice(0, -2)).toBe(keys[1]?.slice(0, -2));

    // Re-importing the same fixture: recognised by spec equality, the
    // account resolved through the profile binding, nothing asked, zero
    // added, all known.
    const again = await uploadStatement(context, world.deps, {
      fileName: "kbc-statement-a.pdf",
      bytes: fixture("kbc-statement-a.pdf"),
    });
    expect(again.kind).toBe("ingested");
    if (again.kind === "ingested") {
      expect(again.added).toBe(0);
      expect(again.known).toBe(KBC_FIXTURE_ROW_COUNT);
    }
    expect(world.transactions).toHaveLength(KBC_FIXTURE_ROW_COUNT);
    expect(
      world.transactions.filter(
        (transaction) => transaction.description === DUPLICATE_DESCRIPTION,
      ),
    ).toHaveLength(2);
  });

  test("the non-reconciling KBC variant fails the upload with balance-mismatch and zero rows written (criterion 3.1)", async () => {
    const world = makeFakeImportWorld();
    const outcome = await uploadStatement(context, world.deps, {
      fileName: "kbc-broken.pdf",
      bytes: fixture("kbc-nonreconciling.pdf"),
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
});

describe("the settlement pairing across two PDF imports (criterion 3.3, hazard H3.4)", () => {
  test("the account-side settlement debit is INTERNAL and linked to the KBC import; the DOMICILIERING credit is INTERNAL as its mirror leg", async () => {
    const world = makeFakeImportWorld();
    const { importId: cardImportId } = await ingestKbcFixture(world);
    await ingestCompanionFixture(world);

    const debit = world.transactions.find((transaction) =>
      transaction.description.includes(
        `MASTERCARD AFREKENING NUMMER ${KBC_STATEMENT_NUMBER}`,
      ),
    );
    expect(debit).toBeDefined();
    expect(debit?.amountCents).toBe(-123456);
    // D-11 (classify-flow.ts:87): INTERNAL, never SPEND, so the card's
    // own line items are the only counted spend.
    expect(debit?.flow).toBe("INTERNAL");

    const mirror = world.transactions.find(
      (transaction) => transaction.description === "DOMICILIERING VIA JE BANK",
    );
    expect(mirror).toBeDefined();
    // classify-flow.ts:90: the card-side positive settlement row is the
    // mirror leg, INTERNAL.
    expect(mirror?.flow).toBe("INTERNAL");

    // The persisted settlement link pairs the debit to the KBC IMPORT,
    // with the mirror credit as its incoming side.
    const link = world.links.find(
      (candidate) => candidate.settlementImportId !== undefined,
    );
    expect(link).toBeDefined();
    expect(link?.settlementImportId).toBe(cardImportId);
    expect(link?.outgoingTransactionId).toBe(debit?.id);
    expect(link?.incomingTransactionId).toBe(mirror?.id);

    // The card statement's own line items stay counted SPEND.
    const cardSpend = world.transactions.filter(
      (transaction) =>
        transaction.importId === cardImportId && transaction.amountCents < 0,
    );
    expect(cardSpend.length).toBeGreaterThan(0);
    expect(cardSpend.every((transaction) => transaction.flow === "SPEND")).toBe(
      true,
    );
  });

  test("without the KBC import, the settlement debit stays SPEND against the card issuer (the honest unitemised aggregate)", async () => {
    const world = makeFakeImportWorld();
    await ingestCompanionFixture(world);

    const debit = world.transactions.find((transaction) =>
      transaction.description.includes(
        `MASTERCARD AFREKENING NUMMER ${KBC_STATEMENT_NUMBER}`,
      ),
    );
    expect(debit).toBeDefined();
    // No matching card import: honest aggregate SPEND, never INTERNAL,
    // never UNRESOLVED (classify-flow.ts settlement fallback), and no
    // settlement link exists.
    expect(debit?.flow).toBe("SPEND");
    expect(
      world.links.some((link) => link.settlementImportId !== undefined),
    ).toBe(false);
  });
});
