import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { confirmImport } from "../../src/modules/import/application/confirm-import";
import { uploadStatement } from "../../src/modules/import/application/upload-statement";
import { detectSourceProfile } from "../../src/modules/import/domain/detect-profile";
import { accountNumberProblem } from "../../src/platform/account-number";
import { householdId, userId, type HouseholdContext } from "../../src/platform/tenancy";
import { makeFakeImportWorld } from "./fake-import-world";

// M3-P18, DR-0030: a statement whose own account sits in the SAVINGS ring
// is ACCEPTED, its rows stored as facts, and they keep NO flow by
// construction because interpretation runs over the pot accounts alone.
// This is the application-level witness for criterion 18.1's acceptance
// half; the browser-level witness lives in test/e2e/import.spec.ts.
//
// RED WITNESS (clause R-037a): this test was run against the unfixed code
// (the account-in-savings-ring refusal arm still present) and failed with
// kind "rejected"; the run is recorded in the phase work history.

const context: HouseholdContext = {
  householdId: householdId("00000000-0000-4000-8000-0000000000ca"),
  userId: userId("00000000-0000-4000-8000-0000000000cb"),
};

const FIXTURE = "savings-statement.csv";

const fixture = (): Uint8Array =>
  new Uint8Array(readFileSync(join(__dirname, "..", "fixtures", FIXTURE)));

const spec = () => {
  const detected = detectSourceProfile(fixture());
  if (!detected.ok) {
    throw new Error("detection failed for the savings fixture");
  }
  return detected.value;
};

describe("a savings account's own statement is accepted and held (DR-0030, criterion 18.1)", () => {
  test("the statement is ingested, not refused, and its rows keep no flow", async () => {
    const world = makeFakeImportWorld();
    const uploaded = await uploadStatement(context, world.deps, {
      fileName: FIXTURE,
      bytes: fixture(),
    });
    expect(uploaded.kind).toBe("awaiting-declaration");
    if (uploaded.kind !== "awaiting-declaration") {
      throw new Error("unreachable");
    }
    // The account is registered at setup, in the SAVINGS ring.
    await world.registerAccountForStatement(context, fixture(), spec(), {
      label: "Savings",
      bank: "Demobank",
      role: "RESERVE",
    });

    const confirmed = await confirmImport(context, world.deps, {
      importId: uploaded.importId,
      profileName: "Demobank savings statement",
      spec: spec(),
    });

    // DR-0030: ACCEPTED. Before this phase the confirm refused with reason
    // account-in-savings-ring; a tree in which this returns "rejected"
    // fails criterion 18.1.
    expect(confirmed.kind).toBe("ingested");
    if (confirmed.kind !== "ingested") {
      throw new Error("unreachable");
    }
    expect(confirmed.added).toBe(6);

    // The rows are FACTS on the savings account, and every one keeps NO
    // flow: the interpretation window is built from the pot account ids
    // alone, so a held row is held by construction, not by a flag.
    expect(world.transactions).toHaveLength(6);
    for (const row of world.transactions) {
      expect(row.flow).toBeUndefined();
    }

    // AND THE IMPORT'S STATUS IS TERMINAL AT INGESTED (M3-P18 fix round,
    // hazard finding HZ-M3P18-03): interpretation ran (confirm always
    // runs it) but a savings import's rows never enter the window, so
    // replaceInterpretation never flips it to INTERPRETED. This pin is
    // the tested half of the corrected marker documentation at
    // src/modules/import/adapters/import-repository.ts: for a savings
    // import, INGESTED means settled and nothing is owed, and a future
    // pending-work consumer must scope itself to pot-ring imports.
    const record = world.imports.get(uploaded.importId);
    expect(record?.status).toBe("INGESTED");
  });

  test("every account number the savings fixture introduces passes the validity test (criterion 18.2)", () => {
    // The fixture's own account and the second savings account it
    // transfers to, both invented for M3-P18 with computed check digits.
    expect(accountNumberProblem("BE27 9100 0000 0004")).toBeUndefined();
    expect(accountNumberProblem("BE97 9100 0000 0005")).toBeUndefined();
  });

  test("the harness's deliberately invalid stored number really fails the validity test", () => {
    // BE82910000000002: check digits 82 where ISO 7064 computes 81. The
    // backfill must canonicalise it WITHOUT validating (criterion 18.4
    // arm three); this pin is what keeps the fixture honest about failing.
    expect(accountNumberProblem("BE82 9100 0000 0002")).toEqual({
      kind: "checksum-failed",
    });
  });
});
