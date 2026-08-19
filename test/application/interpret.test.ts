import { describe, expect, test } from "vitest";
import { householdId, userId, type HouseholdContext } from "../../src/platform/tenancy";
import { confirmImport } from "../../src/modules/import/application/confirm-import";
import { uploadStatement } from "../../src/modules/import/application/upload-statement";
import { recomputeInterpretation } from "../../src/modules/ledger/application/interpret-window";
import { makeFakeImportWorld } from "./fake-import-world";

// Criterion 2.5 (second half): interpretation runs over the affected
// PERIOD WINDOW across all pot accounts, never over the imported rows, so
// an unmatched transfer leg heals when the other account's file arrives in
// a later upload. The real parser, the real use cases and the real
// interpretation engine run against in-memory fakes of the ports.

const context: HouseholdContext = {
  householdId: householdId("household-1"),
  userId: userId("user-1"),
};

const IBAN_A = "BE68539007547034";
const IBAN_B = "BE71096123456769";

// Account A's export: salary in, and the outgoing leg of a transfer to
// account B. Semicolons, DD/MM/YYYY, signed amounts: the current-account
// shape the detector recognises.
const fileA = [
  "Demobank NV - Verrichtingen export",
  "Afschrift;Volgnummer;Boekingsdatum;Valutadatum;Rekening;Tegenrekening;Naam;Omschrijving;Bedrag",
  `7;0301;03/08/2026;03/08/2026;${IBAN_A};BE39103123456719;Acme Salaris BV;LOON JULI 2026;+2.500,00`,
  `7;0302;05/08/2026;05/08/2026;${IBAN_A};${IBAN_B};Eigen rekening;OVERSCHRIJVING EIGEN REKENING;-600,00`,
].join("\n");

// Account B's export, uploaded later: the incoming leg of the same
// transfer, two days after the outgoing one (inside the 4-day window).
const fileB = [
  "Demobank NV - Verrichtingen export",
  "Afschrift;Volgnummer;Boekingsdatum;Valutadatum;Rekening;Tegenrekening;Naam;Omschrijving;Bedrag",
  `3;0101;07/08/2026;07/08/2026;${IBAN_B};${IBAN_A};Eigen rekening;OVERSCHRIJVING EIGEN REKENING;+600,00`,
  `3;0102;08/08/2026;08/08/2026;${IBAN_B};BE54540123456789;Supermarkt Noord;BETALING MET DEBETKAART;-45,00`,
].join("\n");

const bytes = (content: string): Uint8Array => new TextEncoder().encode(content);

const uploadAndDeclare = async (
  world: ReturnType<typeof makeFakeImportWorld>,
  fileName: string,
  content: string,
  declaration: { readonly label: string; readonly bank: string },
): Promise<string> => {
  const outcome = await uploadStatement(context, world.deps, {
    fileName,
    bytes: bytes(content),
  });
  if (outcome.kind === "ingested") {
    return outcome.importId;
  }
  expect(outcome.kind).toBe("awaiting-declaration");
  if (outcome.kind !== "awaiting-declaration") {
    throw new Error("unreachable");
  }
  const detected = world.deps.parser.detect(bytes(content));
  expect(detected.ok).toBe(true);
  if (!detected.ok) {
    throw new Error("unreachable");
  }
  const confirmed = await confirmImport(context, world.deps, {
    importId: outcome.importId,
    profileName: `${declaration.label} export`,
    spec: detected.value,
    declaration: { ...declaration, role: "POT" },
  });
  expect(confirmed.kind).toBe("ingested");
  if (confirmed.kind !== "ingested") {
    throw new Error("unreachable");
  }
  return confirmed.importId;
};

// Both pot accounts are declared (account B at an earlier first sight);
// the classification sets are the DECLARED sets, so the transfer leg in
// file A is INTERNAL from the moment it lands, partner or no partner.
const declareAccountB = async (
  world: ReturnType<typeof makeFakeImportWorld>,
): Promise<void> => {
  await world.deps.accounts.declareAccount(context, {
    label: "Current B",
    bank: "Demobank",
    role: "POT",
    iban: IBAN_B,
  });
};

describe("a settled debit survives a later import's window (finding CR-301)", () => {
  // The reviewer's two-upload flip probe as a regression test. A March
  // card statement and its April settlement debit interpret correctly;
  // a JUNE checking import's padded window [2026-04-13, 2026-08-18]
  // loads the debit but none of the March card rows. Settlement matching
  // must resolve against card IMPORTS loaded whole, so the debit stays
  // INTERNAL and linked; before the fix the window-sliced summary
  // flipped it to SPEND and deleted the link while the books still
  // reconciled (spend double counted, hazard H2.1).
  const cardFile = [
    "Kaartuitgaven export - uitgavenstaat 42",
    "Datum;Datum verrekening;Omschrijving;Bedrag;D/C",
    "05.03.26;06.03.26;STARBUCKS ANTWERPEN;600,00;D",
    "20.03.26;21.03.26;PIZZA NAPOLI BRUSSEL;400,00;D",
  ].join("\n");
  const checkingApril = [
    "Demobank NV - Verrichtingen export",
    "Afschrift;Volgnummer;Boekingsdatum;Valutadatum;Rekening;Tegenrekening;Naam;Omschrijving;Bedrag",
    `4;0201;14/04/2026;14/04/2026;${IBAN_A};;;MASTERCARD AFREKENING NUMMER 42;-1.000,00`,
    `4;0202;15/04/2026;15/04/2026;${IBAN_A};BE54540123456789;Supermarkt Noord;BETALING MET DEBETKAART;-50,00`,
  ].join("\n");
  const checkingJune = [
    "Demobank NV - Verrichtingen export",
    "Afschrift;Volgnummer;Boekingsdatum;Valutadatum;Rekening;Tegenrekening;Naam;Omschrijving;Bedrag",
    `6;0301;01/06/2026;01/06/2026;${IBAN_A};BE54540123456789;Supermarkt Noord;BETALING MET DEBETKAART;-30,00`,
    `6;0302;30/06/2026;30/06/2026;${IBAN_A};BE39103123456719;Acme Salaris BV;LOON JUNI 2026;+2.500,00`,
  ].join("\n");

  test("a later unrelated import's interpretation does not flip the settled debit", async () => {
    const world = makeFakeImportWorld();
    await uploadAndDeclare(world, "kaart-42.csv", cardFile, {
      label: "Mastercard",
      bank: "Demobank",
    });
    await uploadAndDeclare(world, "checking-april.csv", checkingApril, {
      label: "Checking",
      bank: "Demobank",
    });

    const debit = world.transactions.find((t) =>
      t.description.startsWith("MASTERCARD AFREKENING"),
    );
    expect(debit).toBeDefined();
    expect(debit?.flow).toBe("INTERNAL");
    const cardImportId = world.transactions.find(
      (t) => t.description === "STARBUCKS ANTWERPEN",
    )?.importId;
    expect(world.links).toEqual([
      {
        householdId: "household-1",
        outgoingTransactionId: debit?.id,
        settlementImportId: cardImportId,
      },
    ]);

    // The June upload: same checking account, known profile, no questions.
    // Its padded window contains the April debit and none of the March
    // card rows.
    const june = await uploadStatement(context, world.deps, {
      fileName: "checking-june.csv",
      bytes: bytes(checkingJune),
    });
    expect(june.kind).toBe("ingested");

    expect(debit?.flow).toBe("INTERNAL");
    expect(world.links).toContainEqual({
      householdId: "household-1",
      outgoingTransactionId: debit?.id,
      settlementImportId: cardImportId,
    });
  });
});

describe("refund history reads the full ledger, not the window (finding CR-303)", () => {
  // The reviewer's probe P9 as a regression test: the plan's refund rule
  // is scope-free (incoming from a counterparty with outgoing history is
  // SPEND), so an outgoing payment older than the window padding must
  // still make a later refund classify SPEND under a window run, exactly
  // as it does under recompute.
  const checkingJanuary = [
    "Demobank NV - Verrichtingen export",
    "Afschrift;Volgnummer;Boekingsdatum;Valutadatum;Rekening;Tegenrekening;Naam;Omschrijving;Bedrag",
    `1;0101;10/01/2026;10/01/2026;${IBAN_A};BE54540123456789;Webshop NV;BETALING WEBSHOP;-49,99`,
  ].join("\n");
  const checkingJuneRefund = [
    "Demobank NV - Verrichtingen export",
    "Afschrift;Volgnummer;Boekingsdatum;Valutadatum;Rekening;Tegenrekening;Naam;Omschrijving;Bedrag",
    `6;0501;15/06/2026;15/06/2026;${IBAN_A};BE54540123456789;Webshop NV;TERUGBETALING WEBSHOP;+49,99`,
    `6;0502;16/06/2026;16/06/2026;${IBAN_A};BE39103123456719;Acme Salaris BV;LOON JUNI 2026;+2.500,00`,
  ].join("\n");

  test("a refund of a January payment classifies SPEND under the June window", async () => {
    const world = makeFakeImportWorld();
    await uploadAndDeclare(world, "checking-january.csv", checkingJanuary, {
      label: "Checking",
      bank: "Demobank",
    });
    const june = await uploadStatement(context, world.deps, {
      fileName: "checking-june-refund.csv",
      bytes: bytes(checkingJuneRefund),
    });
    expect(june.kind).toBe("ingested");

    const refund = world.transactions.find(
      (t) => t.description === "TERUGBETALING WEBSHOP",
    );
    const salary = world.transactions.find(
      (t) => t.description === "LOON JUNI 2026",
    );
    expect(refund?.flow).toBe("SPEND");
    expect(salary?.flow).toBe("INCOME");
  });
});

describe("interpretation over the period window across accounts", () => {
  test("an unmatched leg from an earlier import heals when the second file arrives", async () => {
    const world = makeFakeImportWorld();
    await declareAccountB(world);

    // First upload: account A. Its transfer leg has no partner yet: it
    // stays INTERNAL, excluded from both sides, with no link (the
    // surfaced waiting-for-the-other-side state).
    const importA = await uploadAndDeclare(world, "account-a.csv", fileA, {
      label: "Current A",
      bank: "Demobank",
    });
    const legOut = world.transactions.find(
      (t) => t.description === "OVERSCHRIJVING EIGEN REKENING" && t.amountCents < 0,
    );
    expect(legOut).toBeDefined();
    expect(legOut?.flow).toBe("INTERNAL");
    expect(world.links).toHaveLength(0);
    expect(world.imports.get(importA)?.status).toBe("INTERPRETED");

    // Second upload: account B, a DIFFERENT import. Interpretation re-runs
    // over the window and pairs the two legs ACROSS imports: the healing
    // is only possible because the window spans all pot accounts rather
    // than the rows just ingested.
    const importB = await uploadAndDeclare(world, "account-b.csv", fileB, {
      label: "Current B",
      bank: "Demobank",
    });
    const legIn = world.transactions.find(
      (t) => t.description === "OVERSCHRIJVING EIGEN REKENING" && t.amountCents > 0,
    );
    expect(legIn).toBeDefined();
    expect(legIn?.importId).toBe(importB);
    expect(legOut?.importId).toBe(importA);

    expect(legOut?.flow).toBe("INTERNAL");
    expect(legIn?.flow).toBe("INTERNAL");
    expect(world.links).toEqual([
      {
        householdId: "household-1",
        outgoingTransactionId: legOut?.id,
        incomingTransactionId: legIn?.id,
      },
    ]);

    // The other rows kept their honest flows.
    const salary = world.transactions.find((t) => t.description === "LOON JULI 2026");
    const groceries = world.transactions.find(
      (t) => t.description === "BETALING MET DEBETKAART",
    );
    expect(salary?.flow).toBe("INCOME");
    expect(groceries?.flow).toBe("SPEND");
    expect(world.imports.get(importB)?.status).toBe("INTERPRETED");
  });

  test("re-uploading the same file is idempotent for interpretation too", async () => {
    const world = makeFakeImportWorld();
    await declareAccountB(world);
    await uploadAndDeclare(world, "account-a.csv", fileA, {
      label: "Current A",
      bank: "Demobank",
    });
    await uploadAndDeclare(world, "account-b.csv", fileB, {
      label: "Current B",
      bank: "Demobank",
    });
    const linksAfterFirst = JSON.parse(JSON.stringify(world.links)) as unknown;
    const flowsAfterFirst = world.transactions.map((t) => [t.id, t.flow]);

    // Same file again: zero new rows, and interpretation lands on the
    // identical state (deterministic, order-independent, idempotent).
    const again = await uploadStatement(context, world.deps, {
      fileName: "account-b.csv",
      bytes: bytes(fileB),
    });
    expect(again.kind).toBe("ingested");
    if (again.kind === "ingested") {
      expect(again.added).toBe(0);
    }
    expect(world.links).toEqual(linksAfterFirst);
    expect(world.transactions.map((t) => [t.id, t.flow])).toEqual(flowsAfterFirst);
  });

  test("recompute is the same step over everything and reproduces the identical state", async () => {
    const world = makeFakeImportWorld();
    await declareAccountB(world);
    await uploadAndDeclare(world, "account-a.csv", fileA, {
      label: "Current A",
      bank: "Demobank",
    });
    await uploadAndDeclare(world, "account-b.csv", fileB, {
      label: "Current B",
      bank: "Demobank",
    });
    const linksBefore = JSON.parse(JSON.stringify(world.links)) as unknown;
    const flowsBefore = world.transactions.map((t) => [t.id, t.flow]);

    const summary = await recomputeInterpretation(context, world.ledgerDeps);
    expect(summary.transactionsInterpreted).toBe(world.transactions.length);
    expect(world.links).toEqual(linksBefore);
    expect(world.transactions.map((t) => [t.id, t.flow])).toEqual(flowsBefore);
  });
});
