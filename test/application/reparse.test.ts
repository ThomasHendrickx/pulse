import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { householdId, userId, type HouseholdContext } from "../../src/platform/tenancy";
import { confirmImport } from "../../src/modules/import/application/confirm-import";
import { fixSourceProfile } from "../../src/modules/import/application/fix-profile";
import { uploadStatement } from "../../src/modules/import/application/upload-statement";
import { detectSourceProfile } from "../../src/modules/import/domain/detect-profile";
import type { DelimitedSourceProfileSpec, SourceProfileSpec } from "../../src/modules/import/domain/source-profile";
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
  detectedSpec: DelimitedSourceProfileSpec;
  wrongSpec: SourceProfileSpec;
}> => {
  const world = makeFakeImportWorld();
  const detected = detectSourceProfile(bytes);
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
  // SETUP FIRST (M3-P14): the account a statement belongs to is registered
  // before the file is confirmed, because confirmImport now refuses a file
  // whose own account is not one the household registered. A card carries no
  // own-account column and registers nothing.
  await world.registerAccountForStatement(context, bytes, wrongSpec, {
    label: "Mastercard",
    bank: "Demobank",
    role: "POT",
  });
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

// The overlap family (finding CR-302): two overlapping card exports
// sharing a keyless identical twin, the fixture-observed real shape. File
// B carries file A's rows plus a THIRD twin occurrence and one new row,
// so ingest of B adds 2 and knows 3, and the cross-import twin keys are
// #0, #1 (import A) and #2 (import B).
const overlapFileA = [
  "Kaartuitgaven export - uitgavenstaat 42",
  "Datum;Datum verrekening;Omschrijving;Bedrag;D/C",
  "03.08.26;04.08.26;STARBUCKS ANTWERPEN;4,80;D",
  "03.08.26;04.08.26;STARBUCKS ANTWERPEN;4,80;D",
  "05.08.26;06.08.26;PIZZA NAPOLI BRUSSEL;18,50;D",
].join("\n");
const overlapFileB = [
  "Kaartuitgaven export - uitgavenstaat 42",
  "Datum;Datum verrekening;Omschrijving;Bedrag;D/C",
  "03.08.26;04.08.26;STARBUCKS ANTWERPEN;4,80;D",
  "03.08.26;04.08.26;STARBUCKS ANTWERPEN;4,80;D",
  "03.08.26;04.08.26;STARBUCKS ANTWERPEN;4,80;D",
  "05.08.26;06.08.26;PIZZA NAPOLI BRUSSEL;18,50;D",
  "12.08.26;13.08.26;BAKKERIJ CENTRUM BRUGGE;6,90;D",
].join("\n");

const setupOverlapWorld = async (
  confirmSpec: (detected: DelimitedSourceProfileSpec) => SourceProfileSpec,
): Promise<{
  world: ReturnType<typeof makeFakeImportWorld>;
  profileId: string;
  detectedSpec: DelimitedSourceProfileSpec;
}> => {
  const world = makeFakeImportWorld();
  const bytesA = new TextEncoder().encode(overlapFileA);
  const bytesB = new TextEncoder().encode(overlapFileB);
  const detected = detectSourceProfile(bytesA);
  expect(detected.ok).toBe(true);
  if (!detected.ok) {
    throw new Error("unreachable");
  }
  const uploadedA = await uploadStatement(context, world.deps, {
    fileName: "kaart-a.csv",
    bytes: bytesA,
  });
  expect(uploadedA.kind).toBe("awaiting-declaration");
  if (uploadedA.kind !== "awaiting-declaration") {
    throw new Error("unreachable");
  }
  // SETUP FIRST (M3-P14): the account a statement belongs to is registered
  // before the file is confirmed, because confirmImport now refuses a file
  // whose own account is not one the household registered. A card carries no
  // own-account column and registers nothing.
  await world.registerAccountForStatement(
    context,
    bytesA,
    confirmSpec(detected.value),
    { label: "Mastercard", bank: "Demobank", role: "POT" },
  );
  const confirmed = await confirmImport(context, world.deps, {
    importId: uploadedA.importId,
    profileName: "Card export",
    spec: confirmSpec(detected.value),
    declaration: { label: "Mastercard", bank: "Demobank", role: "POT" },
  });
  expect(confirmed.kind).toBe("ingested");
  // Upload B: with an unchanged (detected) spec the stored profile is
  // recognised and ingest is automatic; with a user-fixed spec, detection
  // does not match the stored profile, so the confirm path re-runs with
  // the same fixed spec and resolves the account through the binding.
  const uploadedB = await uploadStatement(context, world.deps, {
    fileName: "kaart-b.csv",
    bytes: bytesB,
  });
  let ingestB: { added: number; known: number } | undefined;
  if (uploadedB.kind === "ingested") {
    ingestB = { added: uploadedB.added, known: uploadedB.known };
  } else {
    expect(uploadedB.kind).toBe("awaiting-declaration");
    if (uploadedB.kind !== "awaiting-declaration") {
      throw new Error("unreachable");
    }
    const confirmedB = await confirmImport(context, world.deps, {
      importId: uploadedB.importId,
      profileName: "Card export",
      spec: confirmSpec(detected.value),
    });
    expect(confirmedB.kind).toBe("ingested");
    if (confirmedB.kind === "ingested") {
      ingestB = { added: confirmedB.added, known: confirmedB.known };
    }
  }
  expect(ingestB).toEqual({ added: 2, known: 3 });
  const profileId = world.profiles[0]?.id;
  if (profileId === undefined) {
    throw new Error("no profile stored");
  }
  return { world, profileId, detectedSpec: detected.value };
};

describe("re-parse over overlapping imports sharing a keyless twin (finding CR-302)", () => {
  test("an unchanged-spec re-parse is a strict no-op: keys identical, re-upload adds zero", async () => {
    const { world, profileId, detectedSpec } = await setupOverlapWorld(
      (detected) => detected,
    );
    const keysBefore = world.transactions.map((t) => [t.id, t.dedupKey]);

    const outcome = await fixSourceProfile(context, world.deps, {
      profileId,
      spec: detectedSpec,
    });
    expect(outcome.ok).toBe(true);

    expect(world.transactions.map((t) => [t.id, t.dedupKey])).toEqual(keysBefore);

    const reupload = await uploadStatement(context, world.deps, {
      fileName: "kaart-b.csv",
      bytes: new TextEncoder().encode(overlapFileB),
    });
    expect(reupload.kind).toBe("ingested");
    if (reupload.kind === "ingested") {
      expect(reupload.added).toBe(0);
    }
    expect(world.transactions).toHaveLength(5);
  });

  test("a corrected-spec re-parse converges across the overlapping imports", async () => {
    const { world, profileId, detectedSpec } = await setupOverlapWorld(
      (detected) => ({
        ...detected,
        amountRepresentation: { kind: "signed", column: 3 },
      }),
    );
    // The wrong spec stored every magnitude positive.
    expect(world.transactions.every((t) => t.amountCents > 0)).toBe(true);

    const outcome = await fixSourceProfile(context, world.deps, {
      profileId,
      spec: detectedSpec,
    });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) {
      return;
    }
    expect(outcome.value.importsReparsed).toBe(2);

    // Corrected amounts on BOTH imports, unique keys across the household,
    // and the cross-import twin family intact (three distinct keys).
    expect(world.transactions.every((t) => t.amountCents < 0)).toBe(true);
    const keys = world.transactions.map((t) => t.dedupKey);
    expect(new Set(keys).size).toBe(keys.length);
    const twinKeys = world.transactions
      .filter((t) => t.description === "STARBUCKS ANTWERPEN")
      .map((t) => t.dedupKey);
    expect(new Set(twinKeys).size).toBe(3);

    // Dedup behaviour intact: the same overlapping file adds nothing.
    const reupload = await uploadStatement(context, world.deps, {
      fileName: "kaart-b.csv",
      bytes: new TextEncoder().encode(overlapFileB),
    });
    expect(reupload.kind).toBe("ingested");
    if (reupload.kind === "ingested") {
      expect(reupload.added).toBe(0);
    }
    expect(world.transactions).toHaveLength(5);
  });
});

describe("a re-parse invalidates interpretation until it is rebuilt (finding CR-304)", () => {
  test("a death between the facts rewrite and reinterpretation leaves a visible marker, never INTERPRETED", async () => {
    const { world, importId, profileId, detectedSpec } = await setupWrongProfile();
    expect(world.imports.get(importId)?.status).toBe("INTERPRETED");

    // The interpret stage dies after the facts transaction committed.
    const dyingDeps = {
      ...world.deps,
      interpret: async (): Promise<void> => {
        throw new Error("simulated crash before reinterpretation");
      },
    };
    await expect(
      fixSourceProfile(context, dyingDeps, { profileId, spec: detectedSpec }),
    ).rejects.toThrow("simulated crash");

    // Facts were corrected (the rewrite committed first, by design)...
    expect(world.transactions.map((t) => t.amountCents)).toEqual([
      85000, -480, -480, -2303, -1850,
    ]);
    // ...so the import must NOT read as INTERPRETED: the same visible
    // needs-interpretation marker the upload path has (INGESTED), from
    // the same transaction that committed the facts.
    expect(world.imports.get(importId)?.status).toBe("INGESTED");

    // Recovery is the existing pipeline: the next interpretation restores
    // INTERPRETED over the corrected facts.
    await world.deps.interpret(context, importId);
    expect(world.imports.get(importId)?.status).toBe("INTERPRETED");
  });
});

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

// Criterion 2.3, third leg (hazard H2.3): an unchanged-spec re-parse of
// an ingested PDF import is a STRICT NO-OP. The re-parse rebuilds rows
// from rawContent through extraction and line reconstruction, so any
// nondeterminism in that path would surface here as changed dedup keys
// or changed rows.
describe("unchanged-spec re-parse of an ingested PDF import (criterion 2.3)", () => {
  const pdfFixture = (name: string): Uint8Array =>
    new Uint8Array(readFileSync(join(__dirname, "..", "fixtures", name)));

  test("zero dedup key changes and zero row changes", async () => {
    const world = makeFakeImportWorld();
    const bytesA = pdfFixture("belfius-statement-a.pdf");
    const uploaded = await uploadStatement(context, world.deps, {
      fileName: "statement-a.pdf",
      bytes: bytesA,
    });
    expect(uploaded.kind).toBe("awaiting-declaration");
    if (uploaded.kind !== "awaiting-declaration") {
      throw new Error("unreachable");
    }
    const detected = await world.deps.parser.detect(bytesA);
    expect(detected.ok).toBe(true);
    if (!detected.ok) {
      throw new Error("unreachable");
    }
    expect(detected.value.kind).toBe("pdf-layout");
    await world.registerAccountForStatement(context, bytesA, detected.value, {
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
    const profileId = world.profiles[0]?.id;
    if (profileId === undefined) {
      throw new Error("no profile stored");
    }

    const before = JSON.parse(JSON.stringify(world.transactions)) as unknown;
    const keysBefore = world.transactions.map((t) => [t.id, t.dedupKey]);

    const outcome = await fixSourceProfile(context, world.deps, {
      profileId,
      spec: detected.value,
    });
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.value.importsReparsed).toBe(1);
      expect(outcome.value.rowsReparsed).toBe(9);
    }

    expect(world.transactions.map((t) => [t.id, t.dedupKey])).toEqual(keysBefore);
    expect(JSON.parse(JSON.stringify(world.transactions))).toEqual(before);

    // And a re-upload after the no-op re-parse still adds nothing.
    const reupload = await uploadStatement(context, world.deps, {
      fileName: "statement-a.pdf",
      bytes: bytesA,
    });
    expect(reupload.kind).toBe("ingested");
    if (reupload.kind === "ingested") {
      expect(reupload.added).toBe(0);
    }
  });
});
