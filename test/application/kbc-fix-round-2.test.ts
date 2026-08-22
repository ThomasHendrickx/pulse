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
import { specEquals } from "../../src/modules/import/domain/source-profile";
import {
  KBC_MASKED_CARD,
  KBC_REFUND_DEBIT_SUM_CENTS,
  KBC_REFUND_OPENING_CENTS,
  KBC_REFUND_ROW_COUNT,
  KBC_REFUND_SETTLEMENT_CENTS,
  KBC_REFUND_STATEMENT_NUMBER,
  KBC_SECOND_MASKED_CARD,
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
    expect(first.value).toMatchObject({ accountIdentifier: KBC_MASKED_CARD });
    expect(second.value).toMatchObject({
      accountIdentifier: KBC_SECOND_MASKED_CARD,
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
