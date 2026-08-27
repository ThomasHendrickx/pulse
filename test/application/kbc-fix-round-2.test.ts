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
import { fixSourceProfile } from "../../src/modules/import/application/fix-profile";
import { statementParser } from "../../src/modules/import/adapters/statement-parser";
import { specEquals } from "../../src/modules/import/domain/source-profile";
import {
  KBC_MASKED_CARD_IDENTITY,
  KBC_REFUND_DEBIT_SUM_CENTS,
  KBC_REFUND_OPENING_CENTS,
  KBC_REFUND_ROW_COUNT,
  KBC_REFUND_SETTLEMENT_CENTS,
  KBC_CREDIT_SETTLEMENT_CENTS,
  KBC_UNDERPAID_DEBIT_SUM_CENTS,
  KBC_UNDERPAID_ROWS,
  KBC_UNDERPAID_SETTLEMENT_CENTS,
  KBC_REFUND_STATEMENT_NUMBER,
  KBC_SECOND_MASKED_CARD_IDENTITY,
} from "../fixtures/generate-pdf-fixtures";
import { makeFakeImportWorld } from "./fake-import-world";

// FIX ROUND 2 witnesses, one describe per finding. Each of these reddens
// on the pre-fix code and greens on the fix; the work history records the
// captured output of both halves.

const context: HouseholdContext = {
  householdId: householdId("household-1"),
  userId: userId("user-1"),
};

const fixture = (name: string): Uint8Array =>
  new Uint8Array(readFileSync(join(__dirname, "..", "fixtures", name)));

// Upload a file and complete the ask-once declaration. Returns the import
// id, or the upload outcome kind when no declaration was asked, which is
// itself the thing HZ-M3P3-02 is about.
const ingest = async (
  world: ReturnType<typeof makeFakeImportWorld>,
  name: string,
  declaration: { label: string; bank: string; role: "POT" },
): Promise<{ importId: string; askedDeclaration: boolean }> => {
  const bytes = fixture(name);
  const uploaded = await uploadStatement(context, world.deps, {
    fileName: name,
    bytes,
  });
  if (uploaded.kind === "ingested") {
    return { importId: uploaded.importId, askedDeclaration: false };
  }
  expect(uploaded.kind, JSON.stringify(uploaded)).toBe("awaiting-declaration");
  if (uploaded.kind !== "awaiting-declaration") {
    throw new Error("unreachable");
  }
  const detected = await world.deps.parser.detect(bytes);
  expect(detected.ok).toBe(true);
  if (!detected.ok) {
    throw new Error("unreachable");
  }
  // SETUP FIRST (M3-P14): the account a statement belongs to is registered
  // before the file is confirmed. A card carries no own-account column and
  // registers nothing.
  await world.registerAccountForStatement(
    context,
    bytes,
    detected.value,
    declaration,
  );
  const confirmed = await confirmImport(context, world.deps, {
    importId: uploaded.importId,
    profileName: "kbc-mastercard-uitgavenstaat",
    spec: detected.value,
    declaration,
  });
  expect(confirmed.kind, JSON.stringify(confirmed)).toBe("ingested");
  return { importId: uploaded.importId, askedDeclaration: true };
};

describe("the fixture family is no longer arithmetically degenerate (HZ-M3P3-05)", () => {
  test("the refund statement's previous balance, debit-row sum and settlement figure are three DIFFERENT numbers", () => {
    const previousBalanceMagnitude = -KBC_REFUND_OPENING_CENTS;
    expect(previousBalanceMagnitude).not.toBe(KBC_REFUND_DEBIT_SUM_CENTS);
    expect(previousBalanceMagnitude).not.toBe(KBC_REFUND_SETTLEMENT_CENTS);
    expect(KBC_REFUND_DEBIT_SUM_CENTS).not.toBe(KBC_REFUND_SETTLEMENT_CENTS);
    // And the gap is exactly the refund, which is the whole mechanism.
    expect(KBC_REFUND_DEBIT_SUM_CENTS - KBC_REFUND_SETTLEMENT_CENTS).toBe(2500);
  });

  test("the refund statement parses, carries a NON-SETTLEMENT credit, and reports the statement's own settlement figure", async () => {
    const bytes = fixture("kbc-statement-refund.pdf");
    const detected = await statementParser.detect(bytes);
    expect(detected.ok).toBe(true);
    if (!detected.ok) {
      throw new Error("unreachable");
    }
    const parsed = await statementParser.parse(bytes, detected.value);
    expect(parsed.ok, JSON.stringify(parsed)).toBe(true);
    if (!parsed.ok) {
      throw new Error("unreachable");
    }
    expect(parsed.value.rows).toHaveLength(KBC_REFUND_ROW_COUNT);
    const positives = parsed.value.rows.filter((row) => row.amountCents > 0);
    // Two positive rows: the settlement credit AND an ordinary refund.
    // No fixture anywhere carried the second one before this round.
    expect(positives).toHaveLength(2);
    expect(
      positives.some(
        (row) => !row.description.startsWith("DOMICILIERING VIA JE BANK"),
      ),
    ).toBe(true);
    // HZ-M3P3-01: the statement's own figure survives the balance gate.
    expect(parsed.value.settlementTotalCents).toBe(KBC_REFUND_SETTLEMENT_CENTS);
  });
});

describe("a card import's settlement total is the statement's own figure (HZ-M3P3-01, hazard H3.4)", () => {
  test("the account-side debit for the AFREKENING amount is INTERNAL and linked, on a statement whose debit rows sum to something else", async () => {
    const world = makeFakeImportWorld();
    const { importId: cardImportId } = await ingest(
      world,
      "kbc-statement-refund.pdf",
      { label: "Credit card two", bank: "KBC", role: "POT" },
    );
    await ingest(world, "belfius-settlement-companion-refund.pdf", {
      label: "Daily account",
      bank: "Belfius",
      role: "POT",
    });

    const debit = world.transactions.find((transaction) =>
      transaction.description.includes(
        `MASTERCARD AFREKENING NUMMER ${KBC_REFUND_STATEMENT_NUMBER}`,
      ),
    );
    expect(debit).toBeDefined();
    // The debit is the statement's own settlement figure, which is NOT
    // the sum of the statement's debit rows.
    expect(debit?.amountCents).toBe(-KBC_REFUND_SETTLEMENT_CENTS);
    expect(debit?.amountCents).not.toBe(-KBC_REFUND_DEBIT_SUM_CENTS);
    // The whole finding, in one assertion: re-deriving the total from the
    // row signs leaves this SPEND while the card's own rows are counted
    // too, which double counts an entire card statement.
    expect(debit?.flow).toBe("INTERNAL");

    const link = world.links.find(
      (candidate) => candidate.settlementImportId !== undefined,
    );
    expect(link?.settlementImportId).toBe(cardImportId);
    expect(link?.outgoingTransactionId).toBe(debit?.id);
  });
});

describe("an ordinary card refund is SPEND, never INCOME (HZ-M3P3-06)", () => {
  test("the non-settlement credit on a declared card account classifies SPEND with a positive amount", async () => {
    const world = makeFakeImportWorld();
    await ingest(world, "kbc-statement-refund.pdf", {
      label: "Credit card two",
      bank: "KBC",
      role: "POT",
    });

    const refund = world.transactions.find((transaction) =>
      transaction.description.startsWith("TERUGBETALING"),
    );
    expect(refund).toBeDefined();
    expect(refund?.amountCents).toBeGreaterThan(0);
    // Money that never entered the household is not income for the month.
    expect(refund?.flow).toBe("SPEND");

    // The settlement credit is untouched by that arm: it is INTERNAL.
    const mirror = world.transactions.find(
      (transaction) => transaction.description === "DOMICILIERING VIA JE BANK",
    );
    expect(mirror?.flow).toBe("INTERNAL");
  });
});

describe("two cards of one issuer are two sources (HZ-M3P3-02, CR-M3P3-02)", () => {
  test("two card documents differing only in the masked card number detect to DIFFERENT specs", async () => {
    const first = await statementParser.detect(fixture("kbc-statement-a.pdf"));
    const second = await statementParser.detect(
      fixture("kbc-statement-second-card.pdf"),
    );
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) {
      throw new Error("unreachable");
    }
    expect(first.value).toMatchObject({
      accountIdentifier: KBC_MASKED_CARD_IDENTITY,
    });
    expect(second.value).toMatchObject({
      accountIdentifier: KBC_SECOND_MASKED_CARD_IDENTITY,
    });
    expect(specEquals(first.value, second.value)).toBe(false);
  });

  test("the second card asks its own declaration and lands in its OWN account, and neither card's rows are absorbed by the other", async () => {
    const world = makeFakeImportWorld();
    const cardOne = await ingest(world, "kbc-statement-a.pdf", {
      label: "Card one",
      bank: "KBC",
      role: "POT",
    });
    const cardTwo = await ingest(world, "kbc-statement-second-card.pdf", {
      label: "Card two",
      bank: "KBC",
      role: "POT",
    });
    // The declaration is ASKED for the second card: before the fix the
    // upload found a spec-equal profile and went straight to ingest.
    expect(cardTwo.askedDeclaration).toBe(true);

    const accountsHoldingRows = new Set(
      world.transactions.map((transaction) => transaction.accountId),
    );
    expect(accountsHoldingRows.size).toBe(2);

    // NOTHING WAS ABSORBED. The two documents carry identical rows, and
    // with one shared account the dedup tuple silently swallowed every
    // one of the second card's rows but the differing ones.
    const rowsOne = world.transactions.filter(
      (transaction) => transaction.importId === cardOne.importId,
    );
    const rowsTwo = world.transactions.filter(
      (transaction) => transaction.importId === cardTwo.importId,
    );
    expect(rowsTwo.length).toBe(rowsOne.length);
    expect(rowsTwo.length).toBeGreaterThan(0);
    expect(rowsOne[0]?.accountId).not.toBe(rowsTwo[0]?.accountId);
  });
});

// ---------------------------------------------------------------------
// FIX ROUND 3, finding HZ2-M3P3-01: the SAME witness on the DELIMITED
// card path, which prints no settlement figure and therefore stores none.
// This is the path v0.1 shipped and the one round 2 left defective.
// ---------------------------------------------------------------------

describe("a delimited card export settles for the truth with no stored figure (HZ2-M3P3-01)", () => {
  test("the account-side debit is INTERNAL and linked, and the card's rows are counted once", async () => {
    const world = makeFakeImportWorld();
    const card = await ingest(world, "kbc-card-refund.csv", {
      label: "Card, delimited export",
      bank: "KBC",
      role: "POT",
    });
    await ingest(world, "card-refund-companion.csv", {
      label: "Daily account",
      bank: "Demobank",
      role: "POT",
    });

    // Nothing was stored for this import: a delimited parse prints no
    // settlement figure and sets none.
    const record = world.imports.get(card.importId);
    expect(record?.settlementTotalCents).toBeUndefined();

    const debit = world.transactions.find((transaction) =>
      transaction.description.includes("MASTERCARD AFREKENING NUMMER 44"),
    );
    expect(debit).toBeDefined();
    // The issuer collects the NET of the line items, which is not the sum
    // of the debit rows: the refund is the difference.
    expect(debit?.amountCents).toBe(-45000);
    expect(debit?.flow).toBe("INTERNAL");

    const link = world.links.find(
      (candidate) => candidate.settlementImportId !== undefined,
    );
    expect(link?.settlementImportId).toBe(card.importId);
    expect(link?.outgoingTransactionId).toBe(debit?.id);

    // And the card's own rows stay the counted spend, once.
    const cardSpend = world.transactions.filter(
      (transaction) =>
        transaction.importId === card.importId && transaction.flow === "SPEND",
    );
    const total = cardSpend.reduce((sum, t) => sum + t.amountCents, 0);
    expect(total).toBe(-45000);
  });
});

// ---------------------------------------------------------------------
// FIX ROUND 3, finding HZ2-M3P3-04: the settlement figure is a FACT, and
// the one sanctioned facts rebuild rebuilds it with the rows it belongs
// to rather than skipping it silently.
// ---------------------------------------------------------------------

describe("the profile-fix re-parse rebuilds the settlement figure too (HZ2-M3P3-04)", () => {
  test("a re-parse of a card import writes the figure its own re-parse produced", async () => {
    const world = makeFakeImportWorld();
    const card = await ingest(world, "kbc-statement-refund.pdf", {
      label: "Credit card two",
      bank: "KBC",
      role: "POT",
    });
    const stored = world.imports.get(card.importId);
    expect(stored?.settlementTotalCents).toBe(KBC_REFUND_SETTLEMENT_CENTS);

    // Corrupt the stored figure the way only a bug could, then re-parse:
    // the rebuild must restore it from the document rather than leave a
    // figure describing a reading the rows no longer have.
    if (stored !== undefined) {
      stored.settlementTotalCents = 1;
    }
    const profileId = world.profiles.find(
      (candidate) => candidate.spec.kind === "pdf-layout",
    )?.id;
    expect(profileId).toBeDefined();
    const detected = await world.deps.parser.detect(
      fixture("kbc-statement-refund.pdf"),
    );
    expect(detected.ok).toBe(true);
    if (!detected.ok || profileId === undefined) {
      throw new Error("unreachable");
    }
    const outcome = await fixSourceProfile(context, world.deps, {
      profileId,
      spec: detected.value,
    });
    expect(outcome.ok).toBe(true);
    expect(world.imports.get(card.importId)?.settlementTotalCents).toBe(
      KBC_REFUND_SETTLEMENT_CENTS,
    );
  });
});

// ---------------------------------------------------------------------
// FIX ROUND 3, finding HZ2-M3P3-05: a card standing in CREDIT. Round 2
// made a non-positive settlement figure storable and nothing measured it.
// ---------------------------------------------------------------------

describe("a card statement standing in credit imports and settles nothing (HZ2-M3P3-05)", () => {
  test("the figure is stored SIGNED, and it matches no direct debit", async () => {
    const world = makeFakeImportWorld();
    const card = await ingest(world, "kbc-statement-credit.pdf", {
      label: "Credit card three",
      bank: "KBC",
      role: "POT",
    });
    // The statement imports: money owed back is an ordinary statement.
    expect(world.imports.get(card.importId)?.status).toBe("INTERPRETED");
    const stored = world.imports.get(card.importId)?.settlementTotalCents;
    expect(stored).toBe(KBC_CREDIT_SETTLEMENT_CENTS);
    expect(stored).toBeLessThan(0);

    // Both refunds are SPEND with a positive amount, never INCOME, and
    // the settlement credit is INTERNAL.
    const refunds = world.transactions.filter((transaction) =>
      transaction.description.startsWith("TERUGBETALING"),
    );
    expect(refunds).toHaveLength(2);
    expect(refunds.every((r) => r.flow === "SPEND")).toBe(true);
    expect(
      world.transactions.find(
        (t) => t.description === "DOMICILIERING VIA JE BANK",
      )?.flow,
    ).toBe("INTERNAL");

    // And no settlement link exists, because a negative figure equals the
    // magnitude of no debit. Nothing is silently matched.
    expect(
      world.links.some((link) => link.settlementImportId !== undefined),
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------
// FIX ROUND 4. Two witnesses the tree had no shape for.
// ---------------------------------------------------------------------

describe("a delimited card export whose credit wording is NOT the observed one (HZ3-M3P3-01)", () => {
  test("the account-side debit still links, and the month is not doubled", async () => {
    const world = makeFakeImportWorld();
    const card = await ingest(world, "kbc-card-unrecognised-credit.csv", {
      label: "Card, unobserved wording",
      bank: "KBC",
      role: "POT",
    });
    await ingest(world, "unrecognised-credit-companion.csv", {
      label: "Daily account",
      bank: "Demobank",
      role: "POT",
    });
    // A delimited parse prints and stores no figure, so this is the
    // derivation path, and the credit's wording is outside the one
    // code-owned pattern.
    expect(world.imports.get(card.importId)?.settlementTotalCents).toBeUndefined();

    const debit = world.transactions.find((transaction) =>
      transaction.description.includes("MASTERCARD AFREKENING NUMMER 45"),
    );
    expect(debit?.amountCents).toBe(-50000);
    // Before the candidate fix this fell through to SPEND on top of the
    // card's own rows: the doubled month.
    expect(debit?.flow).toBe("INTERNAL");
    const link = world.links.find(
      (candidate) => candidate.settlementImportId !== undefined,
    );
    expect(link?.settlementImportId).toBe(card.importId);
  });
});

describe("a card statement whose credit does NOT cancel its previous balance (CR3-M3P3-01)", () => {
  test("the three numbers differ, so only the STORED figure can settle the debit", async () => {
    // The discrimination criterion 3.3 had lost: on every other fixture
    // the stored figure and both derivations agree, so the witnesses held
    // under an implementation that never read the stored figure.
    expect(KBC_UNDERPAID_SETTLEMENT_CENTS).not.toBe(KBC_UNDERPAID_DEBIT_SUM_CENTS);
    const netOfLineItems = -(
      KBC_UNDERPAID_ROWS.reduce((sum, row) => sum + row.amountCents, 0)
    );
    expect(netOfLineItems).not.toBe(KBC_UNDERPAID_SETTLEMENT_CENTS);
    expect(netOfLineItems).not.toBe(KBC_UNDERPAID_DEBIT_SUM_CENTS);

    const world = makeFakeImportWorld();
    const card = await ingest(world, "kbc-statement-underpaid.pdf", {
      label: "Credit card four",
      bank: "KBC",
      role: "POT",
    });
    expect(world.imports.get(card.importId)?.settlementTotalCents).toBe(
      KBC_UNDERPAID_SETTLEMENT_CENTS,
    );
    await ingest(world, "underpaid-companion.csv", {
      label: "Daily account",
      bank: "Demobank",
      role: "POT",
    });
    const debit = world.transactions.find((transaction) =>
      transaction.description.includes("MASTERCARD AFREKENING NUMMER 31776"),
    );
    expect(debit?.amountCents).toBe(-KBC_UNDERPAID_SETTLEMENT_CENTS);
    expect(debit?.flow).toBe("INTERNAL");
    expect(
      world.links.find((l) => l.settlementImportId !== undefined)
        ?.settlementImportId,
    ).toBe(card.importId);
  });
});
