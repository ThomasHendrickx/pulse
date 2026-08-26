import { expect, test } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { cents } from "@/platform/money";
import { plainDate } from "@/platform/plain-date";
import type { HouseholdContext } from "@/platform/tenancy";
import {
  listCountedAccountRows,
  listGapRows,
  listHeldAccountRows,
  listIncomeGroups,
  listReserveMovements,
  listSpendGroups,
  monthFigures,
} from "@/modules/overview/adapters/overview-repository";
import { deriveMonthFigures } from "@/modules/overview/domain/month-projection";

// THE HELD READ RETURNS ROWS, NOT COUNTS (criterion 14.15 witness SEVEN), so
// the per-account shape these cases assert is folded here rather than read
// back off the implementation. Each case still asserts the ROWS as well
// wherever the row identity is the point.
const heldPerAccount = (
  rows: readonly { readonly label: string }[],
): readonly { readonly label: string; readonly rowCount: number }[] => {
  const counts = new Map<string, number>();
  for (const row of rows) {
    counts.set(row.label, (counts.get(row.label) ?? 0) + 1);
  }
  return [...counts].map(([label, rowCount]) => ({ label, rowCount }));
};

// THE READS, EXECUTED, AGAINST A REAL DATABASE.
//
// WHY THIS FILE EXISTS AND WHY IT IS IN THE PLAYWRIGHT LANE. Criterion 14.14
// says "Five cases, all at the application level over the real repository",
// and criterion 15.4 asks for an application test in this phase's diff
// asserting a recorded MonthFigures baseline. The first round shipped those
// as CAPTURED OUTPUT in the work history, with the stated blocker that the
// fast gate has no database.
//
// THE BLOCKER WAS A CHOICE, NOT A CONSTRAINT, and a clean-room review said so.
// `npm test` has no database; THIS LANE DOES. playwright.config.ts brings up a
// webServer that serves the month view from these very reads, so a live
// Postgres is already a precondition of the gate. Nothing else in the tree
// executes src/modules/overview/adapters/overview-repository.ts at all: the
// month-overview application test supplies every read as a fake, and the
// absent-flow enumeration reads the file as TEXT. So a query could lose its
// ring predicate and nothing anywhere would run the resulting SQL.
//
// These tests use NO BROWSER. They call the shipped repository functions
// directly against seeded households, which is what "at the application level
// over the real repository" asks for.

const prisma = new PrismaClient();

const PERIOD = { from: plainDate("2026-08-01"), to: plainDate("2026-08-31") };

// Every account number below is invented and listed in
// test/fixtures/allowed-identifiers.txt.
const CURRENT = "BE90901100001132";
const POT_SIBLING = "BE66901100002243";
const RESERVE = "BE24902200001138";
const OUTSIDE = "BE54540123456789";

type SeedAccount = {
  readonly label: string;
  readonly role: "POT" | "RESERVE";
  readonly iban?: string;
};

// [accountIndex, amountCents, description, counterpartyIban, flow]
type SeedRow = readonly [
  number,
  number,
  string,
  string | null,
  "INCOME" | "SPEND" | "RESERVE" | "INTERNAL" | "UNRESOLVED" | null,
];

let seq = 0;

const seed = async (
  accounts: readonly SeedAccount[],
  rows: readonly SeedRow[],
): Promise<{ context: HouseholdContext; accountIds: readonly string[] }> => {
  seq += 1;
  const household = await prisma.household.create({
    data: { name: `reads-${Date.now()}-${seq}` },
  });
  const accountIds: string[] = [];
  for (const account of accounts) {
    const created = await prisma.account.create({
      data: {
        householdId: household.id,
        label: account.label,
        bank: "Demobank",
        role: account.role,
        iban: account.iban ?? null,
      },
    });
    accountIds.push(created.id);
  }
  const record = await prisma.import.create({
    data: {
      householdId: household.id,
      status: "INTERPRETED",
      fileName: "seed",
      rawContent: Buffer.from("seed"),
    },
  });
  for (const [index, row] of rows.entries()) {
    const [account, amountCents, description, counterpartyIban, flow] = row;
    await prisma.transaction.create({
      data: {
        householdId: household.id,
        accountId: accountIds[account] ?? "",
        importId: record.id,
        bookingDate: new Date(`2026-08-${String((index % 27) + 1).padStart(2, "0")}`),
        amountCents,
        description,
        counterpartyIban,
        rawLine: `raw-${index}`,
        dedupKey: `${household.id}-${index}`,
        ...(flow === null ? {} : { flow }),
      },
    });
  }
  return {
    context: { householdId: household.id } as HouseholdContext,
    accountIds,
  };
};

test.afterAll(async () => {
  await prisma.$disconnect();
});

// ---------------------------------------------------------------------
// CRITERION 14.14, all five cases, over the reads themselves.
// ---------------------------------------------------------------------

test("14.14 case ONE: a non-pot account's null-flow rows are excluded from the count AND from the listing, and the month reconciles", async () => {
  const { context } = await seed(
    [
      { label: "Current account", role: "POT", iban: CURRENT },
      { label: "Buffer", role: "RESERVE", iban: RESERVE },
    ],
    [
      [0, 320000, "LOON JULI 2026", OUTSIDE, "INCOME"],
      [1, 25000, "SPAREN AUGUSTUS", CURRENT, null],
      [1, 137, "RENTE AUGUSTUS", null, null],
    ],
  );
  const raw = await monthFigures(context, PERIOD);
  const gaps = await listGapRows(context, PERIOD);
  // The COUNT and the LISTING agree, which is what stops a green verdict
  // rendering above rows the repository is still handing the screen.
  expect(raw.uninterpretedCount).toBe(0);
  expect(gaps).toEqual([]);
  expect(deriveMonthFigures(raw).reconciles).toBe(true);
  // And the held read names them, so they are not merely absent.
  const held = await listHeldAccountRows(context, PERIOD);
  expect(heldPerAccount(held)).toEqual([{ label: "Buffer", rowCount: 2 }]);
  // AND THE ROWS THEMSELVES, with the descriptor the screen renders and the
  // row's own amount: witness SEVEN's interest credit is one of these, and a
  // read that returned only a count could not carry it.
  expect(held.map((row) => [row.text, row.amountCents])).toEqual([
    ["SPAREN AUGUSTUS", 25000],
    ["RENTE AUGUSTUS", 137],
  ]);
});

test("14.14 case THREE: a null-flow row on a POT account is STILL counted, STILL listed, and STILL holds the verdict open", async () => {
  // CR-502 held rather than undone. The scoping is by the account's ring and
  // never by dropping the null-flow condition.
  const { context } = await seed(
    [{ label: "Current account", role: "POT", iban: CURRENT }],
    [
      [0, 320000, "LOON JULI 2026", OUTSIDE, "INCOME"],
      [0, -4500, "Bakkerij Ochtend", OUTSIDE, null],
    ],
  );
  const raw = await monthFigures(context, PERIOD);
  const gaps = await listGapRows(context, PERIOD);
  expect(raw.uninterpretedCount).toBe(1);
  expect(gaps.map((row) => row.gap)).toEqual(["uninterpreted"]);
  expect(deriveMonthFigures(raw).reconciles).toBe(false);
  // And it is NOT held: held is derived from the ring, and this is a pot
  // account.
  expect(await listHeldAccountRows(context, PERIOD)).toEqual([]);
});

test("14.14 case FOUR: the count and the listing are scoped by the SAME predicate, asserted by flipping one account's ring", async () => {
  const { context, accountIds } = await seed(
    [
      { label: "Current account", role: "POT", iban: CURRENT },
      { label: "Second account", role: "POT", iban: POT_SIBLING },
    ],
    [
      [0, 320000, "LOON JULI 2026", OUTSIDE, "INCOME"],
      [1, -4500, "Bakkerij Ochtend", OUTSIDE, null],
      [1, -1200, "Warenhuis Zuid", OUTSIDE, null],
    ],
  );
  const before = await monthFigures(context, PERIOD);
  const gapsBefore = await listGapRows(context, PERIOD);
  expect(before.uninterpretedCount).toBe(2);
  expect(gapsBefore).toHaveLength(2);

  // ONE declaration column, the way a ring correction writes it.
  await prisma.account.update({
    where: { id: accountIds[1] ?? "" },
    data: { role: "RESERVE" },
  });

  const after = await monthFigures(context, PERIOD);
  const gapsAfter = await listGapRows(context, PERIOD);
  // THEY MOVE TOGETHER. A phase in which the count excludes a row the
  // listing still returns, or the reverse, fails here: the cause block is
  // gated on the count while the rows under it come from the listing.
  expect(after.uninterpretedCount).toBe(0);
  expect(gapsAfter).toEqual([]);
});

test("14.14 case FIVE, second assertion: the ROWS partition by the ring of their account", async () => {
  const { context } = await seed(
    [
      { label: "Current account", role: "POT", iban: CURRENT },
      { label: "Buffer", role: "RESERVE", iban: RESERVE },
    ],
    [
      [0, -4500, "Bakkerij Ochtend", OUTSIDE, null],
      [1, 25000, "SPAREN AUGUSTUS", CURRENT, null],
    ],
  );
  const raw = await monthFigures(context, PERIOD);
  const gaps = await listGapRows(context, PERIOD);
  const held = await listHeldAccountRows(context, PERIOD);

  // The POT row: counted by uninterpretedCount AND returned by listGapRows
  // AND absent from the held read.
  expect(raw.uninterpretedCount).toBe(1);
  expect(gaps.map((row) => row.accountLabel)).toEqual(["Current account"]);
  // The RESERVE row: absent from both, present in the held read.
  expect(heldPerAccount(held)).toEqual([{ label: "Buffer", rowCount: 1 }]);
  // A held read written with NO ring filter returns both rows and fails here.
  expect(held).toHaveLength(1);
  expect(held[0]?.text).toBe("SPAREN AUGUSTUS");
});

test("14.15 witness ONE: an account outside the pot holding a cleared row AND a stale-flow row renders exactly ONE entry, held", async () => {
  // The clearing-that-missed-a-row state, which is why the COUNTED read's
  // ring restriction is not made redundant by its flow condition.
  const { context } = await seed(
    [
      { label: "Current account", role: "POT", iban: CURRENT },
      { label: "Buffer", role: "RESERVE", iban: RESERVE },
    ],
    [
      [0, 320000, "LOON JULI 2026", OUTSIDE, "INCOME"],
      [1, 25000, "SPAREN AUGUSTUS", CURRENT, null],
      [1, -5500, "OPNAME", CURRENT, "SPEND"],
    ],
  );
  const counted = await listCountedAccountRows(context, PERIOD);
  const held = await listHeldAccountRows(context, PERIOD);
  // The stale-flow row is reported by NEITHER read.
  expect(counted).toEqual([
    expect.objectContaining({ label: "Current account", rowCount: 1 }),
  ]);
  expect(heldPerAccount(held)).toEqual([{ label: "Buffer", rowCount: 1 }]);
  // And it reaches no figure: spend is zero, not 55,00.
  const figures = deriveMonthFigures(await monthFigures(context, PERIOD));
  expect(figures.spendCents).toBe(0);
});

// ---------------------------------------------------------------------
// CRITERION 14.2, seventh assertion: the normalised join AND the normalised
// GROUPING, over a household that holds one reserve account in TWO surface
// forms.
// ---------------------------------------------------------------------

test("14.2 seventh assertion: one reserve account stored in two surface forms is ONE group, with the typed label and the sum of both rows", async () => {
  // THIS IS THE INPUT THAT MAKES THE ASSERTION DISCRIMINATE, and the first
  // round did not have it: every fixture wrote its counterparty accounts
  // compact, so the stored value already WAS its own canonical form and a
  // raw join selected exactly the same rows as a normalised one. Measured by
  // a clean-room lane on a live database: raw 4, normalised 4, identical.
  //
  // CORRECTED RATHER THAN QUIETLY REWRITTEN (R-087, finding CR-P14C2-11).
  // This paragraph used to read: "The mixed state is real rather than
  // contrived. The delimited parse stores the cell verbatim while the PDF
  // path canonicalises, so one household really can hold both forms for one
  // account." THAT IS FALSE AT THIS TREE, and this branch's own
  // test/domain/counterparty-key-invariant.test.ts asserts the opposite.
  //
  // WHY IT IS FALSE, traced by a clean-room lane and confirmed here. The
  // delimited detector assigns the counterparty-account column only when
  // EVERY value in it matches an anchored COMPACT pattern
  // (detect-profile.ts), so a spaced cell drops the column rather than
  // storing a spaced value; and upload-statement.ts re-detects the spec on
  // EVERY upload and matches it against the stored profile, so a later file
  // written spaced matches no profile and never reaches the verbatim store
  // at all. NO SHIPPED PATH CAN PUT A SPACED VALUE IN
  // Transaction.counterpartyIban.
  //
  // SO WHAT THIS TEST IS: honest defence in depth against a state the
  // product cannot currently produce. It is seeded directly because nothing
  // else can produce it, not because seeding is more convenient. That makes
  // criterion 14.2's premise, that the stored column really does hold two
  // surface forms for one account, false at this tree, and its separate
  // fixture clause unsatisfiable through the delimited path. That is a PLAN
  // finding and it is raised as one; the assertion below is kept because a
  // normalised join and grouping should not depend on an import path's
  // current behaviour staying what it is today.
  //
  // WHY THIS IS SEEDED DIRECTLY RATHER THAN WRITTEN INTO ar-current.csv, and
  // this is the half of the review's suggested fix that is NOT takeable. The
  // delimited DETECTOR assigns the counterparty-account column only when
  // EVERY non-empty value in it matches its own compact pattern
  // (src/modules/import/domain/detect-profile.ts). Writing the four reserve
  // cells spaced was tried and measured: the detected spec came back with NO
  // counterpartyIban column at all and all eleven rows parsed with a null
  // counterparty, which does not make the join discriminate, it removes the
  // join's input entirely and breaks every other assertion in the phase.
  // Changing the detector is outside both phases. So the discriminating
  // input is built HERE, where the stored column can hold what a mixed
  // household really holds, and it reddens on a raw join AND on a raw
  // GROUPING, which a fixture-level assertion could only ever have done for
  // the join.
  const spaced = "BE24 9022 0000 1138";
  const { context } = await seed(
    [
      { label: "Current account", role: "POT", iban: CURRENT },
      { label: "Buffer", role: "RESERVE", iban: RESERVE },
    ],
    [
      [0, -25000, "SPAREN AUGUSTUS", RESERVE, "RESERVE"],
      [0, -30000, "SPAREN AUGUSTUS", spaced, "RESERVE"],
    ],
  );
  const groups = await listReserveMovements(context, PERIOD);
  // ONE group. A normalised join with a RAW grouping returns two, and the
  // household sees one savings account twice, under the right name both
  // times, with the money split.
  expect(groups).toHaveLength(1);
  expect(groups[0]?.label).toBe("Buffer");
  // Carrying the SUM of both rows.
  expect(groups[0]?.parkedCents).toBe(cents(55000));
  expect(groups[0]?.rowCount).toBe(2);
});

test("14.2: the reserves join and the platform form strip the SAME character class, including a tab", async () => {
  // The behavioural cross-check the fast gate cannot make. The TypeScript
  // side is asserted in test/domain/account-number.test.ts; this is the SQL
  // side, against the database, on a character a chain of literal replaces
  // would have missed.
  const withTab = "BE24\t9022 0000 1138";
  const { context } = await seed(
    [
      { label: "Current account", role: "POT", iban: CURRENT },
      { label: "Buffer", role: "RESERVE", iban: RESERVE },
    ],
    [[0, -25000, "SPAREN AUGUSTUS", withTab, "RESERVE"]],
  );
  const groups = await listReserveMovements(context, PERIOD);
  expect(groups).toHaveLength(1);
  // The LABEL is the household's typed one, which is only possible if the
  // join canonicalised a value carrying a tab.
  expect(groups[0]?.label).toBe("Buffer");
});

// ---------------------------------------------------------------------
// CRITERION 15.4: scoping the reads moves nothing that exists today.
// ---------------------------------------------------------------------

test("15.4: over a household whose accounts are ALL pot accounts, every MonthFigures field equals the recorded baseline", async () => {
  // THE BASELINE, captured from the PHASE BASE (999d378) before any edit and
  // written in here BY HAND from that captured output, never read back from
  // the implementation. The capture is in the phase work history under
  // "BASELINE ONE"; this is the same household and the same rows.
  const { context } = await seed(
    [
      { label: "Current account", role: "POT", iban: CURRENT },
      { label: "Joint account", role: "POT", iban: POT_SIBLING },
    ],
    [
      [0, 320000, "LOON JULI 2026", "BE39103123456719", "INCOME"],
      [0, -4500, "Bakkerij Ochtend", OUTSIDE, "SPEND"],
      [0, -12050, "Warenhuis Zuid", "BE71096123456769", "SPEND"],
      [0, -10000, "OVERSCHRIJVING EIGEN REKENING", POT_SIBLING, "INTERNAL"],
      [1, 10000, "OVERSCHRIJVING EIGEN REKENING", CURRENT, "INTERNAL"],
    ],
  );
  const raw = await monthFigures(context, PERIOD);
  expect(raw.incomeSignedCents).toBe(320000);
  expect(raw.spendSignedCents).toBe(-16550);
  expect(raw.reserveSignedCents).toBe(0);
  expect(raw.changeInPotCents).toBe(303450);
  expect(raw.unresolvedCents).toBe(0);
  expect(raw.unresolvedCount).toBe(0);
  expect(raw.unmatchedInternalCents).toBe(0);
  expect(raw.unmatchedInternalCount).toBe(2);
  expect(raw.inTransitCents).toBe(0);
  expect(raw.inTransitCount).toBe(0);
  expect(raw.uninterpretedCount).toBe(0);
  expect(raw.rowCount).toBe(5);

  // And listGapRows, byte for byte against the same captured output.
  const gaps = await listGapRows(context, PERIOD);
  expect(
    gaps.map((row) => ({
      gap: row.gap,
      text: row.text,
      accountLabel: row.accountLabel,
      amountCents: row.amountCents,
    })),
  ).toEqual([
    {
      gap: "unmatched-internal",
      text: "OVERSCHRIJVING EIGEN REKENING",
      accountLabel: "Current account",
      amountCents: -10000,
    },
    {
      gap: "unmatched-internal",
      text: "OVERSCHRIJVING EIGEN REKENING",
      accountLabel: "Joint account",
      amountCents: 10000,
    },
  ]);
});

test("15.4 third case: a household that also holds a non-pot account carrying rows differs ONLY in the fields the scoping is meant to change", async () => {
  const potOnly: readonly SeedAccount[] = [
    { label: "Current account", role: "POT", iban: CURRENT },
  ];
  const rows: readonly SeedRow[] = [
    [0, 320000, "LOON JULI 2026", "BE39103123456719", "INCOME"],
    [0, -4500, "Bakkerij Ochtend", OUTSIDE, "SPEND"],
  ];
  const a = await seed(potOnly, rows);
  const b = await seed(
    [...potOnly, { label: "Buffer", role: "RESERVE", iban: RESERVE }],
    [...rows, [1, 25000, "SPAREN AUGUSTUS", CURRENT, null]],
  );
  const figuresA = await monthFigures(a.context, PERIOD);
  const figuresB = await monthFigures(b.context, PERIOD);
  // EVERY counted field is identical: the extra household's held row reaches
  // none of them.
  expect(figuresB).toEqual(figuresA);
  // What differs is the held read, which is the field the scoping exists for
  // and the one this test can tell a working scoping from a no-op by.
  expect(await listHeldAccountRows(a.context, PERIOD)).toEqual([]);
  expect(heldPerAccount(await listHeldAccountRows(b.context, PERIOD))).toEqual([
    { label: "Buffer", rowCount: 1 },
  ]);
});

// ---------------------------------------------------------------------
// CRITERION 15.2 and 15.3, over the reads: the counted reads and the naming
// screen's read are scoped too.
// ---------------------------------------------------------------------

test("15.2: a stale counted row on an account that LEFT the pot reaches no counted group", async () => {
  const { context } = await seed(
    [
      { label: "Current account", role: "POT", iban: CURRENT },
      { label: "Was a spending account", role: "RESERVE", iban: POT_SIBLING },
    ],
    [
      [0, 320000, "LOON JULI 2026", "BE39103123456719", "INCOME"],
      [1, -4500, "Bakkerij Ochtend", OUTSIDE, "SPEND"],
      [1, 1000, "Refund", OUTSIDE, "INCOME"],
    ],
  );
  // Defence in depth against a clearing that missed a row: the rows still
  // carry a flow and the reads must not see them anyway.
  expect(await listSpendGroups(context, PERIOD)).toEqual([]);
  const income = await listIncomeGroups(context, PERIOD);
  expect(income).toHaveLength(1);
  expect(income[0]?.totalCents).toBe(cents(320000));
});
