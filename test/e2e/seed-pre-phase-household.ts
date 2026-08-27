import type { PrismaClient } from "@prisma/client";

// THE ONE SEED HARNESS FOR A PRE-M3-P14 HOUSEHOLD (M3-P18 step 2, review
// finding P17-006: two constructions of the same household drift, and the
// seeded shape is what the guarantees are measured against). Every
// database-connected test and capture in M3-P18 constructs its pre-phase
// household through THIS helper and never inline. Fast-gate tests over
// fakes do not use it: the fast gate is in-process by design and this
// harness writes real rows through a direct PrismaClient.
//
// WHAT "PRE-PHASE" MEANS HERE. Before M3-P14, the import path wrote
// Account.iban verbatim from a delimited cell
// (src/modules/import/domain/parse-statement.ts), and a Belgian statement
// prints its accounts SPACED. So a pre-phase household's stored numbers
// are whatever the file printed: spaced, compact, valid or not. This
// harness writes that population deliberately, including:
//
//   - at least one NON-CANONICAL spaced rendering (spacedPot),
//   - at least one number that FAILS the validity test (invalidNumber:
//     its check digits are deliberately wrong, so ISO 7064 refuses it),
//   - at least one CARD account with no number at all (card),
//   - a COLLISION PAIR: two Account rows that are ONE real account, one
//     spaced as the delimited parse stores a cell and one compact,
//     answered with TWO DIFFERENT RINGS (collisionSpaced POT,
//     collisionCompact RESERVE), the pair criterion 18.5's migration
//     half is measured against,
//   - TWO accounts registered in the SAVINGS ring with CANONICAL stored
//     numbers (savingsOne, savingsTwo), the pair of savings accounts
//     criterion 18.2's fixture statement is written against.
//
// EVERY account-shaped value below is INVENTED and listed with its
// provenance in test/fixtures/allowed-identifiers.txt (review finding
// P17-007): the bodies are the run 910000000001 through 910000000005
// with computed ISO 7064 check digits, except invalidNumber whose check
// digits are deliberately wrong so the value fails the validity test.

export type SeedAccountSpec = {
  readonly key: string;
  readonly label: string;
  readonly bank: string;
  // Stored EXACTLY as written here, spaces included: the pre-phase import
  // path stored the cell verbatim, and reproducing that verbatim storage
  // is the harness's whole point. Null for the card account.
  readonly iban: string | null;
  readonly role: "POT" | "RESERVE";
};

export const PRE_PHASE_ACCOUNTS = {
  // Stored SPACED, the way the delimited cell printed it. Its canonical
  // form is BE11910000000001, which the backfill must produce.
  spacedPot: {
    key: "spacedPot",
    label: "Daily account",
    bank: "Demobank",
    iban: "BE11 9100 0000 0001",
    role: "POT",
  },
  // FAILS the validity test: the check digits are deliberately wrong
  // (82 where ISO 7064 computes 81 for this body). Stored spaced, so the
  // backfill has something to canonicalise; it is backfilled like any
  // other row and never refused, nulled or named as a problem
  // (criterion 18.4 arm three, review findings P14-006 and P17-004).
  invalidNumber: {
    key: "invalidNumber",
    label: "Old book account",
    bank: "Demobank",
    iban: "BE82 9100 0000 0002",
    role: "POT",
  },
  // A card account carries no number at all and the backfill must leave
  // it untouched throughout (criterion 18.4).
  card: {
    key: "card",
    label: "Credit card",
    bank: "Demokaart",
    iban: null,
    role: "POT",
  },
  // THE COLLISION PAIR: one real account stored twice, spaced and
  // compact, with two different rings. The backfill leaves BOTH rows
  // byte identical to this seeded state and the detection script names
  // exactly these two row ids (criterion 18.5).
  collisionSpaced: {
    key: "collisionSpaced",
    label: "Buffer account",
    bank: "Demobank",
    iban: "BE54 9100 0000 0003",
    role: "POT",
  },
  collisionCompact: {
    key: "collisionCompact",
    label: "Buffer savings",
    bank: "Demobank",
    iban: "BE54910000000003",
    role: "RESERVE",
  },
  // The two SAVINGS-ring accounts, stored CANONICAL (compact uppercase):
  // the backfill is a proven no-op over them, and criterion 18.2's
  // savings fixture statement is written against this pair.
  savingsOne: {
    key: "savingsOne",
    label: "Savings",
    bank: "Demobank",
    iban: "BE27910000000004",
    role: "RESERVE",
  },
  savingsTwo: {
    key: "savingsTwo",
    label: "Holiday savings",
    bank: "Demobank",
    iban: "BE97910000000005",
    role: "RESERVE",
  },
} as const satisfies Record<string, SeedAccountSpec>;

export type PrePhaseAccountKey = keyof typeof PRE_PHASE_ACCOUNTS;

// The seeded transactions, all booking in August 2026 (a CLOSED month
// under the gate's fixed clock, 2026-09-15). Hand-derivable MonthFigures
// baseline for that month, stated here so every spec asserts against the
// same arithmetic rather than re-deriving it:
//
//   incomeSignedCents    +250000   (t1)
//   spendSignedCents      -8647    (t2)
//   reserveSignedCents        0
//   changeInPotCents    +241353    (t1 + t2; NULL-flow rows counted in
//                                   no sum)
//   unresolved / unmatched / in-transit: all zero
//   rowCount                  2    (flow IS NOT NULL)
//
//   NULL-flow rows: t3 on a POT account (a REAL gap that must go on
//   holding the verdict open) and t4 on a SAVINGS account (held by
//   construction, counted in no total, returned by the held read).
//   The ring-scoped uninterpreted count over this household is 1.
export type SeededTransactionSpec = {
  readonly key: string;
  readonly account: PrePhaseAccountKey;
  readonly bookingDate: string;
  readonly amountCents: number;
  readonly description: string;
  readonly counterpartyName?: string;
  readonly flow: "INCOME" | "SPEND" | "INTERNAL" | "RESERVE" | "UNRESOLVED" | null;
};

export const PRE_PHASE_TRANSACTIONS: readonly SeededTransactionSpec[] = [
  {
    key: "t1",
    account: "spacedPot",
    bookingDate: "2026-08-03",
    amountCents: 250000,
    description: "LOON AUGUSTUS",
    counterpartyName: "Acme Salaris BV",
    flow: "INCOME",
  },
  {
    key: "t2",
    account: "spacedPot",
    bookingDate: "2026-08-05",
    amountCents: -8647,
    description: "BETALING MET DEBETKAART SUPERMARKT NOORD",
    counterpartyName: "Supermarkt Noord",
    flow: "SPEND",
  },
  {
    key: "t3",
    account: "spacedPot",
    bookingDate: "2026-08-08",
    amountCents: -1000,
    description: "NOG NIET GELEZEN RIJ",
    flow: null,
  },
  {
    key: "t4",
    account: "savingsOne",
    bookingDate: "2026-08-10",
    amountCents: 1103,
    description: "BASISRENTE",
    flow: null,
  },
];

export type SeededPrePhaseHousehold = {
  readonly householdId: string;
  readonly importId: string;
  // Account row id per key above.
  readonly accountIds: Readonly<Record<PrePhaseAccountKey, string>>;
  // Transaction row id per key above.
  readonly transactionIds: Readonly<Record<string, string>>;
};

// Seed the pre-phase population. When `into` carries a householdId (a
// household created through the sign-up screen, so a browser can drive
// it), the rows land there; otherwise a fresh Household row is created
// with the given name. Idempotence is NOT attempted: callers seed into a
// fresh household per run, the same discipline as every other spec.
export const seedPrePhaseHousehold = async (
  client: PrismaClient,
  into: { readonly name: string; readonly householdId?: string },
): Promise<SeededPrePhaseHousehold> => {
  const householdId =
    into.householdId ??
    (await client.household.create({ data: { name: into.name } })).id;

  const accountIds = {} as Record<PrePhaseAccountKey, string>;
  for (const spec of Object.values(PRE_PHASE_ACCOUNTS)) {
    const row = await client.account.create({
      data: {
        householdId,
        label: spec.label,
        bank: spec.bank,
        role: spec.role,
        iban: spec.iban,
      },
    });
    accountIds[spec.key as PrePhaseAccountKey] = row.id;
  }

  const imported = await client.import.create({
    data: {
      householdId,
      status: "INGESTED",
      fileName: `${into.name}-pre-phase.csv`,
      rawContent: Buffer.from("seeded by test/e2e/seed-pre-phase-household.ts"),
      rowsAdded: PRE_PHASE_TRANSACTIONS.length,
      rowsKnown: 0,
    },
  });

  const transactionIds: Record<string, string> = {};
  for (const spec of PRE_PHASE_TRANSACTIONS) {
    const row = await client.transaction.create({
      data: {
        householdId,
        accountId: accountIds[spec.account],
        importId: imported.id,
        bookingDate: new Date(`${spec.bookingDate}T00:00:00Z`),
        amountCents: spec.amountCents,
        description: spec.description,
        ...(spec.counterpartyName === undefined
          ? {}
          : { counterpartyName: spec.counterpartyName }),
        rawLine: `seeded;${spec.key}`,
        dedupKey: `${into.name}-${spec.key}`,
        flow: spec.flow,
      },
    });
    transactionIds[spec.key] = row.id;
  }

  return { householdId, importId: imported.id, accountIds, transactionIds };
};
