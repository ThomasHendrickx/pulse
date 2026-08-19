import { describe, expect, test } from "vitest";
import { householdId, userId, type HouseholdContext } from "../../src/platform/tenancy";
import { confirmImport } from "../../src/modules/import/application/confirm-import";
import { fixSourceProfile } from "../../src/modules/import/application/fix-profile";
import { uploadStatement } from "../../src/modules/import/application/upload-statement";
import type { SourceProfileSpec } from "../../src/modules/import/domain/source-profile";
import { makeFakeImportWorld } from "./fake-import-world";

// Criterion 2.7, hazard H2.5 (H1.3 continued): a wrong confirmed profile
// has written wrong FACTS, and the repair is a re-parse from each row's
// stored rawLine: no re-upload, corrected amounts, and no declaration
// lost. The scenario is the classic H1.1 shape: a card export whose
// amounts are unsigned magnitudes beside a D/C indicator column, confirmed
// with a "signed column" spec that reads every debit as positive.

const context: HouseholdContext = {
  householdId: householdId("household-1"),
  userId: userId("user-1"),
};

const cardFile = [
  "Kaartuitgaven export - uitgavenstaat 42",
  "Datum;Datum verrekening;Omschrijving;Bedrag;D/C",
  "01.08.26;01.08.26;DOMICILIERING VIA JE BANK;850,00;C",
  "03.08.26;04.08.26;STARBUCKS ANTWERPEN;4,80;D",
  "03.08.26;04.08.26;STARBUCKS ANTWERPEN;4,80;D",
  "05.08.26;06.08.26;AMAZON US SEATTLE USD 25.00 KOERS 0,9210;23,03;D",
  "12.08.26;13.08.26;PIZZA NAPOLI BRUSSEL;18,50;D",
].join("\n");

const bytes = new TextEncoder().encode(cardFile);

const setupWrongProfile = async (): Promise<{
  world: ReturnType<typeof makeFakeImportWorld>;
  importId: string;
  profileId: string;
  detectedSpec: SourceProfileSpec;
  wrongSpec: SourceProfileSpec;
}> => {
  const world = makeFakeImportWorld();
  const detected = world.deps.parser.detect(bytes);
  expect(detected.ok).toBe(true);
  if (!detected.ok) {
    throw new Error("unreachable");
  }
  expect(detected.value.amountRepresentation.kind).toBe("indicator");

  // The wrong confirmation: the user fixed the detected spec into a
  // signed-column reading, so every magnitude lands positive.
  const wrongSpec: SourceProfileSpec = {
    ...detected.value,
    amountRepresentation: { kind: "signed", column: 3 },
  };

  const uploaded = await uploadStatement(context, world.deps, {
    fileName: "kaart-42.csv",
    bytes,
  });
  expect(uploaded.kind).toBe("awaiting-declaration");
  if (uploaded.kind !== "awaiting-declaration") {
    throw new Error("unreachable");
  }
  const confirmed = await confirmImport(context, world.deps, {
    importId: uploaded.importId,
    profileName: "Card export",
    spec: wrongSpec,
    declaration: { label: "Mastercard", bank: "Demobank", role: "POT" },
  });
  expect(confirmed.kind).toBe("ingested");
  const profileId = world.profiles[0]?.id;
  if (profileId === undefined) {
    throw new Error("no profile stored");
  }
  return {
    world,
    importId: uploaded.importId,
    profileId,
    detectedSpec: detected.value,
    wrongSpec,
  };
};

describe("the profile-fix re-parse rebuilds facts from stored rawLine", () => {
  test("corrected amounts, preserved identity, intact declarations and dedup behaviour, no re-upload", async () => {
    const { world, importId, profileId, detectedSpec } = await setupWrongProfile();

    // The wrong spec wrote wrong facts: every amount positive.
    const before = world.transactions.map((t) => ({
      id: t.id,
      rawLine: t.rawLine,
      amountCents: t.amountCents,
      dedupKey: t.dedupKey,
    }));
    expect(before.map((t) => t.amountCents)).toEqual([85000, 480, 480, 2303, 1850]);

    const accountsBefore = JSON.parse(JSON.stringify(world.accounts)) as unknown;
    const profileBefore = world.profiles[0];
    expect(profileBefore?.accountId).toBeDefined();

    // The repair: correct the profile to the true (detected) spec.
    const outcome = await fixSourceProfile(context, world.deps, {
      profileId,
      spec: detectedSpec,
    });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) {
      return;
    }
    expect(outcome.value).toEqual({ importsReparsed: 1, rowsReparsed: 5 });

    // Corrected amounts: debits negative, the settlement credit positive.
    const after = world.transactions.map((t) => ({
      id: t.id,
      rawLine: t.rawLine,
      amountCents: t.amountCents,
      dedupKey: t.dedupKey,
    }));
    expect(after.map((t) => t.amountCents)).toEqual([85000, -480, -480, -2303, -1850]);

    // Row identity and the verbatim source lines are preserved: the facts
    // were rebuilt in place, not replaced by new rows.
    expect(after.map((t) => t.id)).toEqual(before.map((t) => t.id));
    expect(after.map((t) => t.rawLine)).toEqual(before.map((t) => t.rawLine));

    // The dedup keys changed with the amounts (the amount is a hash
    // input), including distinct keys for the two identical rows.
    const keys = after.map((t) => t.dedupKey);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).not.toEqual(before.map((t) => t.dedupKey));

    // Declarations intact: the account, the profile name and its account
    // binding all stand; only the spec changed.
    expect(world.accounts).toEqual(accountsBefore);
    expect(world.profiles).toHaveLength(1);
    expect(world.profiles[0]?.name).toBe("Card export");
    expect(world.profiles[0]?.accountId).toBe(profileBefore?.accountId);
    expect(world.profiles[0]?.spec).toEqual(detectedSpec);

    // Interpretation was rebuilt over the corrected facts: the card line
    // items are SPEND, the settlement credit is the INTERNAL mirror leg.
    const flows = world.transactions.map((t) => t.flow);
    expect(flows).toEqual(["INTERNAL", "SPEND", "SPEND", "SPEND", "SPEND"]);
    expect(world.imports.get(importId)?.status).toBe("INTERPRETED");

    // Dedup behaviour intact: re-uploading the SAME file now recognises
    // the corrected profile by spec equality, resolves the account through
    // its binding, asks nothing, and adds zero rows.
    const reupload = await uploadStatement(context, world.deps, {
      fileName: "kaart-42.csv",
      bytes,
    });
    expect(reupload.kind).toBe("ingested");
    if (reupload.kind === "ingested") {
      expect(reupload.added).toBe(0);
      expect(reupload.known).toBe(5);
    }
    expect(world.transactions).toHaveLength(5);
  });

  test("a correction the stored lines cannot parse under rewrites nothing", async () => {
    const { world, profileId, detectedSpec } = await setupWrongProfile();
    const factsBefore = JSON.parse(JSON.stringify(world.transactions)) as unknown;
    const profilesBefore = JSON.parse(JSON.stringify(world.profiles)) as unknown;

    // DD/MM/YYYY cannot parse "01.08.26": every row fails loudly.
    const badSpec: SourceProfileSpec = {
      ...detectedSpec,
      dateFormat: "DD/MM/YYYY",
    };
    const outcome = await fixSourceProfile(context, world.deps, {
      profileId,
      spec: badSpec,
    });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) {
      return;
    }
    expect(outcome.error.kind).toBe("row-unparseable");

    // Nothing moved: facts and declarations exactly as they were.
    expect(JSON.parse(JSON.stringify(world.transactions))).toEqual(factsBefore);
    expect(JSON.parse(JSON.stringify(world.profiles))).toEqual(profilesBefore);
  });

  test("an unknown profile is rejected", async () => {
    const { world } = await setupWrongProfile();
    const outcome = await fixSourceProfile(context, world.deps, {
      profileId: "profile-does-not-exist",
      spec: world.profiles[0]?.spec as SourceProfileSpec,
    });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.error.kind).toBe("profile-not-found");
    }
  });
});
