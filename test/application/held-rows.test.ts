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
import { registerAccount } from "../../src/modules/accounts/application/register-account";
import { cents } from "../../src/platform/money";
import {
  deriveMonthFigures,
  type MonthFigures,
  type RawMonthFigures,
} from "../../src/modules/overview/domain/month-projection";
import { makeFakeImportWorld, type FakeImportWorld } from "./fake-import-world";

// CRITERION 14.16: the held row changes nothing, and the declaration changes
// exactly what it should. FOUR ARMS, because a pot-side row referencing a
// reserve account takes THREE classification paths across the declaration
// that creates that account and no single arm asserts more than one of them.
//
// WHY THE ORDER EACH ARM MEASURES IS NAMED. Importing a statement is not a
// read-only act on the rest of the household: confirm-import calls the
// ledger's interpret after ingest, and interpretation rebuilds the declared
// sets from listAccounts on every run, so an import that DECLARES an account
// reclassifies every pot row that references it. A criterion that did not
// say which order it measures would be red for a correct implementation on
// one and near vacuous on the other.

const context: HouseholdContext = {
  householdId: householdId("household-1"),
  userId: userId("user-1"),
};

const RESERVE = "BE24902200001138";

const fixture = (name: string): string =>
  readFileSync(join(__dirname, "..", "fixtures", name), "utf8");

const importFile = async (
  world: FakeImportWorld,
  name: string,
  declaration?: { label: string; bank: string; role?: "POT" | "RESERVE" },
): Promise<void> => {
  const bytes = new TextEncoder().encode(fixture(name));
  const upload = await uploadStatement(context, world.deps, {
    fileName: name,
    bytes,
  });
  if (upload.kind === "ingested") {
    return;
  }
  if (upload.kind !== "awaiting-declaration") {
    throw new Error(`upload did not park: ${JSON.stringify(upload)}`);
  }
  const detected = await world.deps.parser.detect(bytes);
  if (!detected.ok) {
    throw new Error("detection failed");
  }
  const outcome = await confirmImport(context, world.deps, {
    importId: upload.importId,
    profileName: `profile-${name}`,
    spec: detected.value,
    ...(declaration === undefined ? {} : { declaration }),
  });
  if (outcome.kind !== "ingested") {
    throw new Error(`import did not ingest: ${JSON.stringify(outcome)}`);
  }
};

// THE SEVEN FIGURES ALL FOUR ARMS ASSERT, DERIVED BY THE SHIPPED CODE.
//
// CORRECTED AFTER A CLEAN-ROOM REVIEW (CRIT-P14-04). This used to be a local
// function that walked the fake world's rows and RE-DERIVED income, spend,
// netToReserves, changeInPot, the difference, the counts and the verdict in
// TypeScript, spelling out the very ring predicates the arms are meant to be
// testing. Two things were wrong with that and both are worth stating.
//
// FIRST, a test that re-implements its own subject certifies the test. If
// the shipped held read lost its inverse ring predicate, or the month
// aggregate lost its POT_ROW, every arm stayed green.
//
// SECOND, the re-implementation had ALREADY DIVERGED: it computed the
// verdict as difference and uninterpreted and unmatched all zero, while the
// shipped verdict at month-projection.ts also requires unresolvedCount and
// inTransitCount to be zero. The two agreed on these fixtures by luck of the
// fixtures rather than by construction, which is precisely the drift a
// re-implementation invites.
//
// WHAT IT DOES NOW. It builds the RawMonthFigures the SQL would return, and
// hands them to the SHIPPED deriveMonthFigures, so the identity, the verdict
// and every display magnitude come from src/modules/overview/domain. The
// aggregation over rows is still local, because the fast gate has no
// database and the fake world is where these fixtures live; THE SQL ITSELF
// is executed against a real database in test/e2e/overview-reads.spec.ts,
// which is where the ring predicates are guarded. This file's job is the
// four arms' ARITHMETIC across a declaration change, and it now shares the
// shipped derivation for every figure it reports.
type Figures = MonthFigures & {
  heldEntries: { label: string; rowCount: number }[];
};

const figuresOf = (world: FakeImportWorld): Figures => {
  const potIds = new Set(
    world.accounts.filter((a) => a.role === "POT").map((a) => a.id),
  );
  const byId = new Map(world.accounts.map((a) => [a.id, a]));
  let incomeSigned = 0;
  let spendSigned = 0;
  let reserveSigned = 0;
  let changeInPot = 0;
  let rowCount = 0;
  let uninterpreted = 0;
  let unresolvedSigned = 0;
  let unresolvedCount = 0;
  let unmatchedSigned = 0;
  let unmatchedCount = 0;
  const held = new Map<string, number>();
  for (const row of world.transactions) {
    if (!potIds.has(row.accountId)) {
      // THE HELD READ'S PREDICATE: no flow, on an account outside the pot.
      if (row.flow === undefined) {
        const label = byId.get(row.accountId)?.label ?? "?";
        held.set(label, (held.get(label) ?? 0) + 1);
      }
      continue;
    }
    if (row.flow === undefined) {
      uninterpreted += 1;
      continue;
    }
    rowCount += 1;
    changeInPot += row.amountCents;
    if (row.flow === "INCOME") incomeSigned += row.amountCents;
    if (row.flow === "SPEND") spendSigned += row.amountCents;
    if (row.flow === "RESERVE") reserveSigned += row.amountCents;
    if (row.flow === "UNRESOLVED") {
      unresolvedSigned += row.amountCents;
      unresolvedCount += 1;
    }
    if (row.flow === "INTERNAL") {
      const linked = world.links.some(
        (link) =>
          (link.outgoingTransactionId === row.id &&
            link.incomingTransactionId !== undefined) ||
          link.incomingTransactionId === row.id,
      );
      if (!linked) {
        unmatchedSigned += row.amountCents;
        unmatchedCount += 1;
      }
    }
  }
  // THE SHIPPED DERIVATION. Every figure below, including the verdict, comes
  // from src/modules/overview/domain/month-projection.ts.
  const raw: RawMonthFigures = {
    incomeSignedCents: cents(incomeSigned),
    spendSignedCents: cents(spendSigned),
    reserveSignedCents: cents(reserveSigned),
    changeInPotCents: cents(changeInPot),
    unresolvedCents: cents(unresolvedSigned),
    unresolvedCount,
    unmatchedInternalCents: cents(unmatchedSigned),
    unmatchedInternalCount: unmatchedCount,
    inTransitCents: cents(0),
    inTransitCount: 0,
    uninterpretedCount: uninterpreted,
    rowCount,
  };
  return {
    ...deriveMonthFigures(raw),
    heldEntries: [...held.entries()].map(([label, count]) => ({
      label,
      rowCount: count,
    })),
  };
};

describe("criterion 14.16 arm ONE: the held row changes nothing", () => {
  test("the reserve account is REGISTERED before any import, so the declaration set is identical before and after the act being measured", async () => {
    const world = makeFakeImportWorld();
    // REGISTERED FIRST. That is what makes this arm measure the HELD ROWS
    // and not the declaration: nothing about the declared sets changes when
    // the reserve statement arrives.
    const registered = await registerAccount(
      context,
      { accounts: world.accountsRepository, ...world.engine },
      {
        label: "Buffer",
        bank: "Demobank",
        role: "RESERVE",
        accountNumber: RESERVE,
      },
    );
    expect(registered.ok).toBe(true);

    await importFile(world, "ar-pot-outgoing.csv", {
      label: "Current account",
      bank: "Demobank",
      role: "POT",
    });
    const before = figuresOf(world);
    expect(before.heldEntries).toEqual([]);

    // The reserve account's OWN statement, with no other change.
    await importFile(world, "ar-reserve-own.csv");
    const after = figuresOf(world);

    // EVERY ONE OF THE SEVEN IS BYTE IDENTICAL.
    expect(after.incomeCents).toBe(before.incomeCents);
    expect(after.spendCents).toBe(before.spendCents);
    expect(after.netToReservesCents).toBe(before.netToReservesCents);
    expect(after.changeInPotCents).toBe(before.changeInPotCents);
    expect(after.differenceCents).toBe(before.differenceCents);
    expect(after.uninterpretedCount).toBe(before.uninterpretedCount);
    expect(after.rowCount).toBe(before.rowCount);
    expect(after.reconciles).toBe(true);
    expect(before.reconciles).toBe(true);

    // AND THE MONTH-ACCOUNTS ELEMENT HAS GAINED A HELD ENTRY naming that
    // account with its row count.
    expect(after.heldEntries).toEqual([{ label: "Buffer", rowCount: 2 }]);
  });
});

describe("criterion 14.16 arm TWO: the declaration DOES change something, and the criterion says which", () => {
  test("on the order every household is in, the reserve account is declared by the reserve import itself and the outgoing transfers move from SPEND to RESERVE", async () => {
    const world = makeFakeImportWorld();
    // NOTHING REGISTERED. The reserve account is DECLARED BY THE RESERVE
    // IMPORT ITSELF, which is the order criterion 14.11 witness ONE
    // establishes as the one every household is actually in.
    await importFile(world, "ar-pot-outgoing.csv", {
      label: "Current account",
      bank: "Demobank",
      role: "POT",
    });
    const before = figuresOf(world);
    // Before the declaration the transfer matches nothing, misses both
    // declared-set arms, and falls to the sign rule as SPEND.
    expect(before.spendCents).toBe(34000);
    expect(before.netToReservesCents).toBe(0);

    await importFile(world, "ar-reserve-own.csv", {
      label: "Buffer",
      bank: "Demobank",
      role: "RESERVE",
    });
    const after = figuresOf(world);

    // THE MOVEMENT, ASSERTED EXACTLY AND NOT AS STILLNESS. THE FIXTURE FOR
    // THIS ARM CARRIES OUTGOING TRANSFERS TO THAT ACCOUNT ONLY, which is
    // pinned rather than relied on: with a drawdown present the two
    // movements would no longer be the same magnitude, which is arm FOUR.
    expect(before.spendCents - after.spendCents).toBe(30000);
    expect(after.netToReservesCents - before.netToReservesCents).toBe(30000);
    // And the other five do not move.
    expect(after.incomeCents).toBe(before.incomeCents);
    expect(after.changeInPotCents).toBe(before.changeInPotCents);
    expect(after.differenceCents).toBe(before.differenceCents);
    expect(after.uninterpretedCount).toBe(before.uninterpretedCount);
    // rowCount cannot move either: it counts rows carrying a flow, the held
    // rows carry none, and the reclassified rows carry one on both sides of
    // the declaration.
    expect(after.rowCount).toBe(before.rowCount);
    expect(after.reconciles).toBe(true);
    expect(after.heldEntries).toEqual([{ label: "Buffer", rowCount: 2 }]);
  });
});

describe("criterion 14.16 arm FIVE: the row that moves no money and still changes the verdict", () => {
  test("A ZERO-AMOUNT POT-SIDE ROW referencing the account being declared RESERVE is UNRESOLVED before and RESERVE after, so unresolvedCount falls by one and the books close, with ZERO CENTS MOVED", async () => {
    // THE FIFTH CLASSIFICATION PATH, found by a clean-room hazard lane
    // (finding CR-H2-03) and not constructed by any of the four arms above,
    // none of whose fixtures carries a zero-amount row.
    //
    // WHY IT EXISTS, read off the shipped classifier rather than reasoned:
    // src/modules/ledger/domain/classify-flow.ts sends a row whose
    // counterparty is NOT in the declared reserve set through the sign
    // rules, and a zero amount is neither negative (:112) nor positive
    // (:119), so it falls to the last line, "A zero amount has no direction
    // to read", and is UNRESOLVED. Once the same account IS declared
    // RESERVE, branch 1 at :78 fires FIRST, and because amountCents > 0 is
    // false for a zero it takes the `: { flow: "RESERVE" }` arm directly and
    // never reaches that fallback.
    //
    // WHY IT MATTERS TO THE OWNER, which is why it is an arm and not a note:
    // deriveMonthFigures requires unresolvedCount === 0 for `reconciles`, so
    // this household's books are held OPEN before the declaration by a
    // genuine counted gap and CLOSE after it, purely because a row carrying
    // no money stopped being a gap. A verdict that flips from "not closing"
    // to "closing" on a row that never moved a cent is exactly the kind of
    // surprise DR-0030 exists to prevent elsewhere.
    const world = makeFakeImportWorld();
    await importFile(world, "ar-pot-zero-amount.csv", {
      label: "Current account",
      bank: "Demobank",
      role: "POT",
    });
    const before = figuresOf(world);

    // THE ARM IS NOT VACUOUS: the fixture also carries an ordinary
    // non-zero transfer to the same account, so the declaration moves real
    // money too and the zero row's effect is isolated by subtraction rather
    // than by being the only thing that happens.
    expect(before.uninterpretedCount).toBe(0);
    expect(before.unresolvedCount).toBe(1);
    expect(before.reconciles).toBe(false);
    expect(before.spendCents).toBe(34000);

    await importFile(world, "ar-reserve-own.csv", {
      label: "Buffer",
      bank: "Demobank",
      role: "RESERVE",
    });
    const after = figuresOf(world);

    // THE VERDICT FLIPS, AND THE GAP CLOSES.
    expect(after.unresolvedCount).toBe(0);
    expect(after.unresolvedCents).toBe(0);
    expect(after.reconciles).toBe(true);

    // AND THE ZERO ROW MOVED NOTHING. The only money that moved is the
    // ordinary transfer, which is arm TWO's movement exactly; if the zero
    // row had contributed a cent to either side, these two would differ.
    expect(before.spendCents - after.spendCents).toBe(30000);
    expect(after.netToReservesCents - before.netToReservesCents).toBe(30000);
    expect(after.incomeCents).toBe(before.incomeCents);
    expect(after.changeInPotCents).toBe(before.changeInPotCents);
    expect(after.uninterpretedCount).toBe(before.uninterpretedCount);
  });
});

describe("criterion 14.16 arm THREE: the drawdown, which arm two's fixture deliberately excludes", () => {
  test("a POSITIVE pot-side row with no prior outgoing transfer is INCOME beforehand, and income and netToReserves BOTH fall", async () => {
    const world = makeFakeImportWorld();
    await importFile(world, "ar-pot-drawdown-only.csv", {
      label: "Current account",
      bank: "Demobank",
      role: "POT",
    });
    const before = figuresOf(world);
    // No outgoing transfer to that counterparty exists, so the refund
    // correction does not fire and the row is INCOME.
    expect(before.incomeCents).toBe(212000);
    expect(before.netToReservesCents).toBe(0);

    await importFile(world, "ar-reserve-own.csv", {
      label: "Buffer",
      bank: "Demobank",
      role: "RESERVE",
    });
    const after = figuresOf(world);

    // BOTH FALL, by the same string.
    expect(before.incomeCents - after.incomeCents).toBe(12000);
    expect(before.netToReservesCents - after.netToReservesCents).toBe(12000);
    expect(after.spendCents).toBe(before.spendCents);
    expect(after.changeInPotCents).toBe(before.changeInPotCents);
    expect(after.differenceCents).toBe(before.differenceCents);
    expect(after.uninterpretedCount).toBe(before.uninterpretedCount);
    expect(after.rowCount).toBe(before.rowCount);
    expect(after.reconciles).toBe(true);
  });
});

describe("criterion 14.16 arm FOUR: the ordinary savings account, paid into AND drawn from", () => {
  test("the refund correction fires on the drawdown, so the movement is the NET and not the outgoing alone", async () => {
    const world = makeFakeImportWorld();
    await importFile(world, "ar-pot-both-ways.csv", {
      label: "Current account",
      bank: "Demobank",
      role: "POT",
    });
    const before = figuresOf(world);
    // Before the declaration: the outgoing 300,00 is SPEND, and the
    // drawdown of 120,00 is ALSO SPEND with a positive amount, because the
    // refund correction fires against the outgoing history for that same
    // counterparty account. So spend is 40,00 + 300,00 - 120,00.
    expect(before.spendCents).toBe(22000);
    expect(before.netToReservesCents).toBe(0);

    await importFile(world, "ar-reserve-own.csv", {
      label: "Buffer",
      bank: "Demobank",
      role: "RESERVE",
    });
    const after = figuresOf(world);

    // THE MOVEMENT IS THE NET of the outgoing transfers and the drawdown,
    // 300,00 - 120,00, and NOT the outgoing alone. THE FIXTURE PINS ITS
    // DIRECTION TOO: the outgoing exceeds the drawdown, so the net is
    // positive and FALLS and RISES are exact rather than approximate.
    expect(before.spendCents - after.spendCents).toBe(18000);
    expect(after.netToReservesCents - before.netToReservesCents).toBe(18000);
    expect(after.incomeCents).toBe(before.incomeCents);
    expect(after.changeInPotCents).toBe(before.changeInPotCents);
    expect(after.differenceCents).toBe(before.differenceCents);
    expect(after.uninterpretedCount).toBe(before.uninterpretedCount);
    expect(after.rowCount).toBe(before.rowCount);
    expect(after.reconciles).toBe(true);
    expect(after.heldEntries).toEqual([{ label: "Buffer", rowCount: 2 }]);
  });
});

describe("criterion 14.15 witness ONE and criterion 14.14 case FIVE, at the row level", () => {
  test("an account outside the pot holding BOTH a cleared row and a stale-flow row renders exactly ONE entry, held, and the stale row is counted by neither read", async () => {
    // This is asserted HERE because nothing else reaches it: the counted
    // read carries no null-flow condition and returns no null-flow rows, so
    // it is absent from criterion 14.14 case FIVE's enumeration and from
    // its row-class test alike.
    const world = makeFakeImportWorld();
    await importFile(world, "ar-pot-outgoing.csv", {
      label: "Current account",
      bank: "Demobank",
      role: "POT",
    });
    await importFile(world, "ar-reserve-own.csv", {
      label: "Buffer",
      bank: "Demobank",
      role: "RESERVE",
    });
    const buffer = world.accounts.find((a) => a.label === "Buffer");
    expect(buffer).toBeDefined();
    const bufferRows = world.transactions.filter(
      (row) => row.accountId === buffer?.id,
    );
    expect(bufferRows).toHaveLength(2);
    expect(bufferRows.every((row) => row.flow === undefined)).toBe(true);

    // THE CLEARING-THAT-MISSED-A-ROW STATE, constructed directly: one row
    // on the non-pot account still carries a flow. A counted read written
    // WITHOUT its ring restriction would report it to the household as
    // counted money on the one screen state built to tell counted from
    // held, which is hazard H14.21.
    const stale = bufferRows[0];
    if (stale !== undefined) {
      (stale as { flow?: string }).flow = "SPEND";
    }
    const figures = figuresOf(world);
    // ONE entry, held, and the stale row is in NO figure.
    expect(figures.heldEntries).toEqual([{ label: "Buffer", rowCount: 1 }]);
    // Spend is the outside merchant alone: the 300,00 transfer became
    // RESERVE when the reserve import declared that account, which is arm
    // TWO's movement happening here as well.
    expect(figures.spendCents).toBe(4000);
    expect(figures.netToReservesCents).toBe(30000);
    expect(figures.reconciles).toBe(true);
  });

  test("a null-flow row on a POT account is STILL uninterpreted and STILL holds the verdict open, which is CR-502 held rather than undone", async () => {
    const world = makeFakeImportWorld();
    await importFile(world, "ar-pot-outgoing.csv", {
      label: "Current account",
      bank: "Demobank",
      role: "POT",
    });
    const potRow = world.transactions[0];
    expect(potRow).toBeDefined();
    if (potRow !== undefined) {
      delete (potRow as { flow?: string }).flow;
    }
    const figures = figuresOf(world);
    expect(figures.uninterpretedCount).toBe(1);
    expect(figures.reconciles).toBe(false);
    // And it is NOT reported as held: held is derived from the account's
    // ring, and this account is a pot account.
    expect(figures.heldEntries).toEqual([]);
  });
});
