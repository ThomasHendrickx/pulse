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

// THE SEVEN FIGURES ALL FOUR ARMS ASSERT. Every arm asserts the same seven
// and they differ only in which two are allowed to move.
type Figures = {
  incomeCents: number;
  spendCents: number;
  netToReservesCents: number;
  changeInPotCents: number;
  differenceCents: number;
  uninterpretedCount: number;
  rowCount: number;
  reconciles: boolean;
  heldEntries: { label: string; rowCount: number }[];
};

const figuresOf = (world: FakeImportWorld): Figures => {
  const potIds = new Set(
    world.accounts.filter((a) => a.role === "POT").map((a) => a.id),
  );
  const byId = new Map(world.accounts.map((a) => [a.id, a]));
  let income = 0;
  let spend = 0;
  let reserve = 0;
  let changeInPot = 0;
  let rowCount = 0;
  let uninterpreted = 0;
  let internalUnmatched = 0;
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
    // Every figure below carries the ring predicate AND its own flow
    // condition, exactly as the scoped SQL reads do.
    if (row.flow === undefined) {
      uninterpreted += 1;
      continue;
    }
    rowCount += 1;
    changeInPot += row.amountCents;
    if (row.flow === "INCOME") income += row.amountCents;
    if (row.flow === "SPEND") spend += row.amountCents;
    if (row.flow === "RESERVE") reserve += row.amountCents;
    if (row.flow === "INTERNAL") {
      const linked = world.links.some(
        (link) =>
          (link.outgoingTransactionId === row.id &&
            link.incomingTransactionId !== undefined) ||
          link.incomingTransactionId === row.id,
      );
      if (!linked) {
        internalUnmatched += 1;
      }
    }
  }
  const incomeCents = income;
  const spendCents = 0 - spend;
  const netToReservesCents = 0 - reserve;
  const differenceCents =
    changeInPot - (incomeCents - spendCents - netToReservesCents);
  return {
    incomeCents,
    spendCents,
    netToReservesCents,
    changeInPotCents: changeInPot,
    differenceCents,
    uninterpretedCount: uninterpreted,
    rowCount,
    reconciles:
      differenceCents === 0 && uninterpreted === 0 && internalUnmatched === 0,
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
