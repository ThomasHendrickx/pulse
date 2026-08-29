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
import { assignMerchant } from "../../src/modules/merchants/application/assign-merchant";
import { buildMerchantReview } from "../../src/modules/merchants/domain/merchant-review";
import {
  IDENTITY_FIXTURE_ACCOUNTS,
  IDENTITY_FIXTURE_DESIGNATED_COUNTERPARTY,
  IDENTITY_FIXTURE_DESIGNATED_ROW_COUNT,
  IDENTITY_FIXTURE_ROW_TO_COUNTERPARTY,
} from "../fixtures/generate-pdf-fixtures";
import { makeFakeImportWorld } from "./fake-import-world";

// CRITERION 12.3: NAMED ONCE, MATCHED AGAIN. This is the phase's whole
// point, and it is asserted as a JOURNEY rather than as a unit: the fixture
// is imported through the shipped path, the designated counterparty appears
// as ONE unresolved group, assignMerchant is called EXACTLY ONCE against
// that group's key, interpretation runs, and a DIFFERENT transaction of the
// same counterparty (different booking date, different amount, different
// free-text communication) then carries the merchant id.
//
// This test is the red witness for the phase. Against the baseline
// derivation, where a rule matches on the whole normalised description, the
// designated group's count is 1 rather than 3 and the second transaction
// carries no merchant, so it fails on the group assertion first and on the
// second-transaction assertion after that.

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
  expect(uploaded.kind).toBe("awaiting-declaration");
  if (uploaded.kind !== "awaiting-declaration") {
    throw new Error("unreachable");
  }
  const detected = await statementParser.detect(bytes);
  expect(detected.ok).toBe(true);
  if (!detected.ok) {
    throw new Error("unreachable");
  }
  // SETUP FIRST (M3-P14): the account a statement belongs to is registered
  // before the file is confirmed, because confirmImport now refuses a file
  // whose own account is not one the household registered. A card carries no
  // own-account column and registers nothing.
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
  expect(confirmed.kind).toBe("ingested");
  return world;
};

// The row ordinals of the designated counterparty, read from the
// GENERATOR'S OWN INPUT RECORD rather than from any derivation's output.
const designatedRowOrdinals = IDENTITY_FIXTURE_ROW_TO_COUNTERPARTY.filter(
  (entry) => entry.counterparty === IDENTITY_FIXTURE_DESIGNATED_COUNTERPARTY,
).map((entry) => entry.row);

describe("named once, matched again (criterion 12.3)", () => {
  test("one naming of the designated counterparty reaches a later transaction it was not made from", async () => {
    const world = await ingestFixture();

    // A CALL COUNTER ON THE FAKE MERCHANTS PORT. The criterion requires the
    // naming to happen ONCE; counting the rule writes is what makes "once"
    // an assertion rather than a reading of the test body.
    let ruleWrites = 0;
    const countingPort = {
      ...world.merchantsPort,
      upsertRule: async (
        ctx: HouseholdContext,
        input: Parameters<World["merchantsPort"]["upsertRule"]>[1],
      ) => {
        ruleWrites += 1;
        return world.merchantsPort.upsertRule(ctx, input);
      },
    };

    // Transactions in parse order, so a row ordinal from the generator's
    // record names one transaction.
    const rows = world.transactions;
    expect(rows).toHaveLength(IDENTITY_FIXTURE_ROW_TO_COUNTERPARTY.length);
    expect(designatedRowOrdinals).toHaveLength(
      IDENTITY_FIXTURE_DESIGNATED_ROW_COUNT,
    );

    const designatedRows = designatedRowOrdinals.map((ordinal) => {
      const row = rows[ordinal - 1];
      if (row === undefined) {
        throw new Error(`fixture row ${ordinal} missing`);
      }
      return row;
    });
    // Every designated row carries the SAME counterparty account and a
    // DIFFERENT description, which is the shape the owner's month has.
    expect(
      new Set(designatedRows.map((row) => row.counterpartyIban)),
    ).toEqual(new Set([IDENTITY_FIXTURE_ACCOUNTS.counterparty1]));
    expect(new Set(designatedRows.map((row) => row.description)).size).toBe(
      IDENTITY_FIXTURE_DESIGNATED_ROW_COUNT,
    );
    expect(new Set(designatedRows.map((row) => row.bookingDate)).size).toBe(
      IDENTITY_FIXTURE_DESIGNATED_ROW_COUNT,
    );
    expect(new Set(designatedRows.map((row) => row.amountCents)).size).toBe(
      IDENTITY_FIXTURE_DESIGNATED_ROW_COUNT,
    );

    const nameFrom = designatedRows[0];
    const laterOne = designatedRows[1];
    const laterTwo = designatedRows[2];
    if (
      nameFrom === undefined ||
      laterOne === undefined ||
      laterTwo === undefined
    ) {
      throw new Error("unreachable");
    }

    // ONE unresolved group whose count is 3.
    const counted = await world.merchantsPort.listCountedTransactions(context);
    const reviewBefore = buildMerchantReview(counted, []);
    const groupsBefore = [...reviewBefore.income, ...reviewBefore.spend].filter(
      (group) => group.merchantId === undefined,
    );
    // The group is keyed on the counterparty ACCOUNT, so its submitted
    // subject is the account-namespaced identity key. Under the baseline
    // derivation no such group exists at all, which is where this test
    // reddens.
    const expectedKey = `account:${IDENTITY_FIXTURE_ACCOUNTS.counterparty1}`;
    const designatedGroups = groupsBefore.filter(
      (group) => group.counterpartyText === expectedKey,
    );
    expect(designatedGroups).toHaveLength(1);
    const designatedGroup = designatedGroups[0];
    if (designatedGroup === undefined) {
      throw new Error("unreachable");
    }
    expect(designatedGroup.count).toBe(IDENTITY_FIXTURE_DESIGNATED_ROW_COUNT);

    // EXACTLY ONE naming, made against the group's own key.
    const outcome = await assignMerchant(
      context,
      {
        merchants: countingPort,
        recompute: (ctx: HouseholdContext) =>
          recomputeInterpretation(ctx, world.ledgerDeps),
      },
      {
        counterpartyText: designatedGroup.counterpartyText ?? "",
        merchantName: "Demo Verzekering",
      },
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) {
      throw new Error("assignment failed");
    }
    expect(ruleWrites).toBe(1);

    await recomputeInterpretation(context, world.ledgerDeps);

    const byId = new Map(world.transactions.map((row) => [row.id, row]));
    // The transaction the naming WAS made from.
    expect(byId.get(nameFrom.id)?.merchantId).toBe(outcome.value.merchant.id);
    // The two transactions the naming was NOT made from, named by id.
    expect(byId.get(laterOne.id)?.merchantId).toBe(outcome.value.merchant.id);
    expect(byId.get(laterTwo.id)?.merchantId).toBe(outcome.value.merchant.id);
  });
});
