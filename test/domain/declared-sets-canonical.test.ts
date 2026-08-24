import { describe, expect, test } from "vitest";
import { classifyFlow } from "../../src/modules/ledger/domain/classify-flow";
import {
  deriveDeclaredSets,
  type DeclaredAccount,
} from "../../src/modules/ledger/domain/ledger-transaction";
import type { LedgerTransaction } from "../../src/modules/ledger/domain/ledger-transaction";
import { cents } from "../../src/platform/money";
import { plainDate } from "../../src/platform/plain-date";

// M3-P14 criterion 14.4, third assertion. Every account number below is
// invented and listed in test/fixtures/allowed-identifiers.txt.
//
// WHY THIS TEST EXISTS AND WHY IT IS THE SPACED FORM THAT IS STORED. Every
// account-shaped token in the owner's own current-account document is
// written spaced; the delimited parse stores such a cell verbatim
// (src/modules/import/domain/parse-statement.ts) while the PDF path
// canonicalises. So one household holds two surface forms of one account,
// and a comparison against the raw stored column classifies nothing.

const RESERVE = "BE24902200001138";
const POT_SIBLING = "BE66901100002243";

const spaced = (compact: string): string =>
  `${compact.slice(0, 4)} ${compact.slice(4, 8)} ${compact.slice(8, 12)} ${compact.slice(12)}`;

const row = (counterpartyIban: string, amount: number): LedgerTransaction => ({
  id: "t1",
  accountId: "own",
  importId: "i1",
  bookingDate: plainDate("2026-05-11"),
  amountCents: cents(amount),
  description: "transfer",
  counterpartyIban,
});

const context = (accounts: readonly DeclaredAccount[]) => ({
  sets: deriveDeclaredSets(accounts),
  cardImports: [],
  outgoingHistoryKeys: new Set<string>(),
});

describe("the declared sets compare canonically on both sides", () => {
  const accounts: readonly DeclaredAccount[] = [
    { id: "own", role: "POT", iban: "BE90901100001132" },
    { id: "res", role: "RESERVE", iban: RESERVE },
    { id: "pot", role: "POT", iban: POT_SIBLING },
  ];

  test("a stored counterparty written spaced classifies as RESERVE against a reserve account registered compact", () => {
    expect(
      classifyFlow(row(spaced(RESERVE), -25000), context(accounts)).flow,
    ).toBe("RESERVE");
  });

  test("a stored counterparty written spaced classifies as INTERNAL against a pot account registered compact", () => {
    expect(
      classifyFlow(row(spaced(POT_SIBLING), -25000), context(accounts)).flow,
    ).toBe("INTERNAL");
  });

  test("the same rows against a household that registered nothing fall to the sign rule, which is the defect this closes", () => {
    const none = context([{ id: "own", role: "POT", iban: "BE90901100001132" }]);
    expect(classifyFlow(row(spaced(RESERVE), -25000), none).flow).toBe("SPEND");
    expect(classifyFlow(row(spaced(POT_SIBLING), -25000), none).flow).toBe(
      "SPEND",
    );
  });

  test("a reserve drawdown written spaced is RESERVE and never INCOME", () => {
    expect(
      classifyFlow(row(spaced(RESERVE), 40000), context(accounts)).flow,
    ).toBe("RESERVE");
  });

  test("declaring the account in a spaced surface form works too, because both sides canonicalise", () => {
    const spacedDeclaration = context([
      { id: "own", role: "POT", iban: "BE90901100001132" },
      { id: "res", role: "RESERVE", iban: spaced(RESERVE) },
    ]);
    expect(classifyFlow(row(RESERVE, -25000), spacedDeclaration).flow).toBe(
      "RESERVE",
    );
  });
});
