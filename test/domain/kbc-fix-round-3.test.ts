import { describe, expect, test } from "vitest";
import { cents, type Cents } from "../../src/platform/money";
import { plainDate } from "../../src/platform/plain-date";
import { interpretLedger } from "../../src/modules/ledger/domain/interpret";
import { reconcile } from "../../src/modules/ledger/domain/reconciliation";
import {
  deriveDeclaredSets,
  summarizeCardImports,
  type DeclaredAccount,
  type LedgerTransaction,
} from "../../src/modules/ledger/domain/ledger-transaction";
import { kbcMastercardTemplate } from "../../src/modules/import/domain/kbc-mastercard-template";
import { specEquals } from "../../src/modules/import/domain/source-profile";

// FIX ROUND 3 witnesses (delta hazard verdict HZ2-M3P3-01 and -02). Both
// findings say the same thing about the round before this one: the fix
// works on the path it was tested on and leaves a double count on a path
// it was not. These tests are written against the defective code first.

const IBAN_CURRENT = "BE68539007547034";

const ACCOUNTS: readonly DeclaredAccount[] = [
  { id: "acc-current", role: "POT", iban: IBAN_CURRENT },
  // A card account is a pot account with no IBAN, whatever format its
  // statements arrive in. NOTHING here is PDF-specific.
  { id: "acc-card", role: "POT" },
];

const tx = (input: {
  readonly id: string;
  readonly accountId: string;
  readonly importId: string;
  readonly date: string;
  readonly amount: number;
  readonly description: string;
}): LedgerTransaction => ({
  id: input.id,
  accountId: input.accountId,
  importId: input.importId,
  bookingDate: plainDate(input.date),
  amountCents: cents(input.amount) as Cents,
  description: input.description,
});

// One card month with an ORDINARY MERCHANT REFUND on it, plus the
// account-side direct debit for what the issuer actually collects.
//   debits          -300,00 and -200,00
//   refund           +50,00
//   settlement credit +500,00 (the PREVIOUS month's settlement arriving)
// The issuer collects 300 + 200 - 50 = 450,00, and that is what the
// account-side debit is. The magnitude of the debit rows is 500,00, which
// is the number the row-sum derivation produces and it is wrong.
const DEBIT_SUM_CENTS = 50000;
const TRUE_SETTLEMENT_CENTS = 45000;

const cardRows: readonly LedgerTransaction[] = [
  tx({ id: "c1", accountId: "acc-card", importId: "card-1", date: "2026-08-04", amount: -30000, description: "BOEKBINDERIJ DE PENSEELSTREEK" }),
  tx({ id: "c2", accountId: "acc-card", importId: "card-1", date: "2026-08-06", amount: -20000, description: "SPORTHAL DE WATERMOLEN" }),
  tx({ id: "c3", accountId: "acc-card", importId: "card-1", date: "2026-08-09", amount: 5000, description: "TERUGBETALING SPORTHAL DE WATERMOLEN" }),
  tx({ id: "m1", accountId: "acc-card", importId: "card-1", date: "2026-08-01", amount: 50000, description: "DOMICILIERING VIA JE BANK" }),
];

const accountDebit = tx({
  id: "d1",
  accountId: "acc-current",
  importId: "current-1",
  date: "2026-08-12",
  amount: -TRUE_SETTLEMENT_CENTS,
  description: "MASTERCARD AFREKENING NUMMER 42",
});

const world = [...cardRows, accountDebit];

describe("a card import with no STORED settlement figure still settles for the truth (HZ2-M3P3-01)", () => {
  test("the summariser nets the line items instead of summing the debit magnitudes", () => {
    const sets = deriveDeclaredSets(ACCOUNTS);
    // No statement figure map: this is the delimited card path, where
    // nothing is printed to store.
    const summaries = summarizeCardImports(cardRows, sets);
    expect(summaries).toHaveLength(1);
    expect(summaries[0]?.settlementTotalCents).toBe(TRUE_SETTLEMENT_CENTS);
    expect(summaries[0]?.settlementTotalCents).not.toBe(DEBIT_SUM_CENTS);
  });

  test("the account-side debit is INTERNAL and linked to the card import", () => {
    const interpretation = interpretLedger({
      transactions: world,
      accounts: ACCOUNTS,
    });
    expect(interpretation.flows.get("d1")).toBe("INTERNAL");
    expect(interpretation.settlements).toHaveLength(1);
    expect(interpretation.settlements[0]?.cardImportId).toBe("card-1");
    expect(interpretation.settlements[0]?.debitTransactionId).toBe("d1");
    // BOTH LEGS ARE STILL WAITING, and that is the honest shape of a
    // single imported card month rather than a defect. This card's
    // DOMICILIERING credit settles the PREVIOUS statement, which this
    // world does not import, and this month's direct debit will be
    // mirrored on the NEXT statement, which it does not import either. The
    // legs are surfaced, never dropped. What the fix changes is the
    // classification and the link, not the waiting.
    expect(interpretation.unmatchedInternalIds).toEqual(["d1", "m1"]);
  });

  test("the month's spend is the card's own line items, counted ONCE", () => {
    const interpretation = interpretLedger({
      transactions: world,
      accounts: ACCOUNTS,
    });
    const spend = world
      .filter((t) => interpretation.flows.get(t.id) === "SPEND")
      .reduce((sum, t) => sum + t.amountCents, 0);
    // Two debits and one refund netting against them: -450,00. Under the
    // row-sum derivation the direct debit falls through to SPEND as well
    // and the total is -950,00, more than twice the truth.
    expect(spend).toBe(-TRUE_SETTLEMENT_CENTS);
  });

  test("the reconciliation gap is the unimported previous statement, NOT a doubled month", () => {
    const interpretation = interpretLedger({
      transactions: world,
      accounts: ACCOUNTS,
    });
    const report = reconcile(world, interpretation);
    // The gap is the NET of the two waiting legs, each of which belongs
    // to a statement this world does not import: 500,00 arriving minus
    // 450,00 leaving. Before the fix the direct debit was not a leg at
    // all, it was SPEND, so the gap was the credit alone AND the month's
    // spend was more than twice the truth. The spend total is the
    // assertion that matters and it is now the card own line items,
    // reported by the reconciliation as a positive magnitude.
    expect(report.unmatchedInternalGapCents).toBe(
      50000 - TRUE_SETTLEMENT_CENTS,
    );
    expect(report.spendCents).toBe(TRUE_SETTLEMENT_CENTS);
  });

  test("a STORED figure still wins over the derivation", () => {
    const sets = deriveDeclaredSets(ACCOUNTS);
    const stored = new Map([["card-1", cents(12345) as Cents]]);
    const summaries = summarizeCardImports(cardRows, sets, stored);
    expect(summaries[0]?.settlementTotalCents).toBe(12345);
  });
});

describe("one card is one identity however its statement prints it (HZ2-M3P3-02)", () => {
  const page = (cardLine: string): { text: string; x: number }[][] => [
    [
      { text: "KBC-Mastercard", x: 59.5 },
      { text: "Uitgavenstaat", x: 59.5 },
      { text: cardLine, x: 59.5 },
      { text: "Vorig saldo op 16-05-2026 -10,00", x: 204.2 },
      { text: "Afrekening via je bank op 22-06-2026 -10,00", x: 204.2 },
    ],
  ];

  // The SAME physical card, printed or extracted five ways. Word spacing on
  // this layout is tolerance-sensitive and the line reconstructor decides
  // gaps against a numeric threshold, so a hair of kerning moves a
  // separator in or out of the captured string.
  const printings = [
    "Kaartnummer(s): 5417 88XX XXXX 3210",
    "Kaartnummer(s): 541788XXXXXX3210",
    "Kaartnummer(s): 5417-88XX-XXXX-3210",
    "Kaartnummer(s): 5417 88xx xxxx 3210",
    "Kaartnummer: 5417 88XX XXXX 3210",
  ];

  test("five printings of one card give ONE identity", () => {
    const identities = new Set(
      printings.map((line) => kbcMastercardTemplate.accountIdentifier?.(page(line))),
    );
    expect([...identities].every((value) => value !== undefined)).toBe(true);
    expect(identities.size).toBe(1);
  });

  test("every pair of those printings is spec-EQUAL, so one card stays one account", () => {
    const specs = printings.map((line) => ({
      kind: "pdf-layout" as const,
      templateId: kbcMastercardTemplate.id,
      templateVersion: kbcMastercardTemplate.version,
      accountIdentifier: kbcMastercardTemplate.accountIdentifier?.(page(line)) ?? "",
    }));
    for (let i = 0; i < specs.length; i += 1) {
      for (let j = i + 1; j < specs.length; j += 1) {
        const a = specs[i];
        const b = specs[j];
        expect(a && b && specEquals(a, b)).toBe(true);
      }
    }
  });

  test("two genuinely DIFFERENT cards still give two identities", () => {
    const one = kbcMastercardTemplate.accountIdentifier?.(
      page("Kaartnummer(s): 5417 88XX XXXX 3210"),
    );
    const two = kbcMastercardTemplate.accountIdentifier?.(
      page("Kaartnummer(s): 5417 88XX XXXX 7654"),
    );
    expect(one).toBeDefined();
    expect(two).toBeDefined();
    expect(one).not.toBe(two);
  });

  test("a repeated card line whose PRINTING differs is one card, not an ambiguous document", () => {
    const pages = [
      [
        { text: "KBC-Mastercard", x: 59.5 },
        { text: "Uitgavenstaat", x: 59.5 },
        { text: "Kaartnummer(s): 5417 88XX XXXX 3210", x: 59.5 },
        { text: "Vorig saldo op 16-05-2026 -10,00", x: 204.2 },
        { text: "Kaartnummer 541788XXXXXX3210", x: 204.2 },
        { text: "Afrekening via je bank op 22-06-2026 -10,00", x: 204.2 },
      ],
    ];
    expect(kbcMastercardTemplate.accountIdentifier?.(pages)).toBeDefined();
    expect(kbcMastercardTemplate.parse(pages).ok).toBe(true);
  });
});
