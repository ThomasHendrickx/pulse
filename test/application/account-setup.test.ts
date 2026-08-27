import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { confirmImport } from "../../src/modules/import/application/confirm-import";
import { uploadStatement } from "../../src/modules/import/application/upload-statement";
import { detectSourceProfile } from "../../src/modules/import/domain/detect-profile";
import { recomputeInterpretation } from "../../src/modules/ledger/application/interpret-window";
import { changeAccountRing } from "../../src/modules/accounts/application/change-account-ring";
import { registerAccounts } from "../../src/modules/accounts/application/register-accounts";
import type {
  AccountRepositoryPort,
  AccountsSetupDependencies,
} from "../../src/modules/accounts/application/ports";
import type { AccountRecord, NewAccount } from "../../src/modules/accounts/application/ports";
import type { AccountRole } from "../../src/modules/accounts/domain/account-role";
import { canonicalAccountNumber } from "../../src/platform/account-number";
import { householdId, userId, type HouseholdContext } from "../../src/platform/tenancy";
import { makeFakeImportWorld } from "./fake-import-world";

// M3-P14, criteria 14.2, 14.3 and 14.8, at the APPLICATION level: what the
// server does with a submission, over in-memory fakes of the ports.
//
// Every account number here is invented: the run 900000000001 through
// 900000000008 with computed check digits, listed with its provenance in
// test/fixtures/allowed-identifiers.txt.

const context: HouseholdContext = {
  householdId: householdId("household-setup"),
  userId: userId("user-setup"),
};

const CURRENT = "BE73900000000001";
const SIBLING_A = "BE46900000000002";
const SIBLING_B = "BE19900000000003";
const SIBLING_C = "BE89900000000004";
const SAVINGS_A = "BE62900000000005";
const SAVINGS_B = "BE35900000000006";
const SAVINGS_C = "BE08900000000007";
const SAVINGS_D = "BE78900000000008";

type FakeAccountsWorld = {
  readonly deps: AccountsSetupDependencies;
  readonly rows: readonly AccountRecord[];
  readonly recomputes: () => number;
  readonly setOwnRows: (accountId: string) => void;
};

const makeAccountsWorld = (): FakeAccountsWorld => {
  const rows: AccountRecord[] = [];
  const withOwnRows = new Set<string>();
  let recomputes = 0;
  let next = 1;
  const create = (input: NewAccount): AccountRecord => {
    const record: AccountRecord = {
      id: `account-${next++}`,
      label: input.label,
      bank: input.bank,
      role: input.role,
      ...(input.iban === undefined
        ? {}
        : { iban: canonicalAccountNumber(input.iban) }),
    };
    rows.push(record);
    return record;
  };
  const accounts: AccountRepositoryPort = {
    createAccount: async (_context, input) => create(input),
    createAccounts: async (_context, input) => input.map(create),
    updateAccountRole: async (_context, accountId, role: AccountRole) => {
      const index = rows.findIndex((row) => row.id === accountId);
      const existing = rows[index];
      if (existing !== undefined) {
        rows[index] = { ...existing, role };
      }
    },
    listAccounts: async () => rows,
    findAccountByIban: async (_context, iban) =>
      rows.find(
        (row) =>
          row.iban !== undefined &&
          row.iban === canonicalAccountNumber(iban),
      ) ?? null,
    getAccountById: async (_context, accountId) =>
      rows.find((row) => row.id === accountId) ?? null,
  };
  return {
    deps: {
      accounts,
      ledger: {
        recompute: async () => {
          recomputes += 1;
        },
        hasImportedRows: async (_context, accountId) =>
          withOwnRows.has(accountId),
      },
    },
    rows,
    recomputes: () => recomputes,
    setOwnRows: (accountId) => withOwnRows.add(accountId),
  };
};

const row = (
  label: string,
  accountNumber: string,
  ring: string,
): { label: string; bank: string; accountNumber: string; ring: string } => ({
  label,
  bank: "Demobank",
  accountNumber,
  ring,
});

const EIGHT = [
  row("Daily account", CURRENT, "POT"),
  row("Joint account", SIBLING_A, "POT"),
  row("Household account", SIBLING_B, "POT"),
  row("Buffer account", SIBLING_C, "POT"),
  row("Savings", SAVINGS_A, "RESERVE"),
  row("Holiday savings", SAVINGS_B, "RESERVE"),
  row("Pension savings", SAVINGS_C, "RESERVE"),
  row("Car savings", SAVINGS_D, "RESERVE"),
];

describe("criterion 14.2: the server refuses a submission carrying no ring, by name", () => {
  test("a missing ring is a NAMED error against its own row and nothing is defaulted", async () => {
    const world = makeAccountsWorld();
    const outcome = await registerAccounts(context, world.deps, {
      rows: [
        row("Daily account", CURRENT, "POT"),
        // The ring left unanswered on the second row only.
        row("Joint account", SIBLING_A, ""),
      ],
    });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) {
      throw new Error("unreachable");
    }
    expect(outcome.error).toEqual({
      kind: "invalid",
      problems: [{ kind: "row", row: 1, problem: { kind: "ring-missing" } }],
    });
    // NOT DEFAULTED and NOT PARTIALLY WRITTEN: the whole submission is
    // refused, so the first row is not registered either.
    expect(world.rows).toHaveLength(0);
    expect(world.recomputes()).toBe(0);
  });

  test("a ring value that is neither ring is refused too, rather than falling back", async () => {
    const world = makeAccountsWorld();
    const outcome = await registerAccounts(context, world.deps, {
      rows: [row("Daily account", CURRENT, "SOMETHING ELSE")],
    });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) {
      throw new Error("unreachable");
    }
    expect(outcome.error).toEqual({
      kind: "invalid",
      problems: [
        {
          kind: "row",
          row: 0,
          problem: { kind: "ring-invalid", value: "SOMETHING ELSE" },
        },
      ],
    });
    expect(world.rows).toHaveLength(0);
  });
});

describe("criterion 14.3: each of the four refusals, and no account row for any of them", () => {
  const cases = [
    { name: "empty after canonicalisation", value: "   ", kind: "empty" },
    {
      name: "a country code the table does not carry",
      value: "ZZ73900000000001",
      kind: "unknown-country",
    },
    {
      name: "a length the table does not assign that country",
      value: "BE7390000000000",
      kind: "wrong-length",
    },
    {
      name: "one transposed character, so the mod-97 check fails",
      value: "BE73900000000010",
      kind: "checksum-failed",
    },
  ] as const;

  for (const { name, value, kind } of cases) {
    test(`${name}: refused by name, and NO account row is created`, async () => {
      const world = makeAccountsWorld();
      const outcome = await registerAccounts(context, world.deps, {
        rows: [
          row("Daily account", CURRENT, "POT"),
          row("Second account", value, "POT"),
        ],
      });
      expect(outcome.ok).toBe(false);
      if (outcome.ok) {
        throw new Error("unreachable");
      }
      expect(outcome.error.kind).toBe("invalid");
      if (outcome.error.kind !== "invalid") {
        throw new Error("unreachable");
      }
      // The problem names the ROW the owner is looking at, which is what
      // lets the screen say which one is wrong.
      expect(outcome.error.problems).toEqual([
        {
          kind: "row",
          row: 1,
          problem: {
            kind: "account-number-invalid",
            problem: expect.objectContaining({ kind }),
          },
        },
      ]);
      expect(world.rows).toHaveLength(0);
      expect(world.recomputes()).toBe(0);
    });
  }

  test("a valid submission of EIGHT accounts registers eight and recomputes exactly ONCE", async () => {
    const world = makeAccountsWorld();
    const outcome = await registerAccounts(context, world.deps, {
      rows: EIGHT,
    });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) {
      throw new Error("unreachable");
    }
    expect(outcome.value.registered).toBe(8);
    expect(world.rows).toHaveLength(8);
    // ONE recompute for the whole submission, not one per account: a
    // per-row rebuild would classify the second account's transfers
    // against a set that does not yet carry the third.
    expect(world.recomputes()).toBe(1);
    // The stored form is canonical, which is what makes the per-household
    // uniqueness constraint a real backstop.
    expect(world.rows.map((account) => account.iban)).toEqual([
      CURRENT,
      SIBLING_A,
      SIBLING_B,
      SIBLING_C,
      SAVINGS_A,
      SAVINGS_B,
      SAVINGS_C,
      SAVINGS_D,
    ]);
  });

  test("a number typed SPACED registers as the same account as the compact form", async () => {
    const world = makeAccountsWorld();
    const first = await registerAccounts(context, world.deps, {
      rows: [row("Daily account", "BE73 9000 0000 0001", "POT")],
    });
    expect(first.ok).toBe(true);
    expect(world.rows[0]?.iban).toBe(CURRENT);
    // And the second attempt at the same account, compact this time, is
    // refused as already registered rather than creating a twin.
    const second = await registerAccounts(context, world.deps, {
      rows: [row("Daily account again", CURRENT, "POT")],
    });
    expect(second.ok).toBe(false);
    if (second.ok) {
      throw new Error("unreachable");
    }
    expect(second.error).toEqual({ kind: "already-registered", row: 0 });
    expect(world.rows).toHaveLength(1);
  });
});

describe("criterion 14.8: the ring change, and what makes a stale flow unreachable", () => {
  test("a ring change is REFUSED for an account that already carries its own imported rows", async () => {
    const world = makeAccountsWorld();
    await registerAccounts(context, world.deps, { rows: EIGHT });
    const account = world.rows[0];
    if (account === undefined) {
      throw new Error("unreachable");
    }
    world.setOwnRows(account.id);
    const recomputesBefore = world.recomputes();

    const outcome = await changeAccountRing(context, world.deps, {
      accountId: account.id,
      role: "RESERVE",
    });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) {
      throw new Error("unreachable");
    }
    expect(outcome.error).toEqual({ kind: "account-has-own-rows" });
    // Nothing written and nothing rebuilt.
    expect(world.rows[0]?.role).toBe("POT");
    expect(world.recomputes()).toBe(recomputesBefore);
  });

  // M3-P18 FIX ROUND TWO. The ring answered wrongly at setup must stay
  // correctable AFTER the household uploads that account's statement,
  // because under DR-0030 that upload is now ACCEPTED and the account
  // acquires rows of its own at the first confirm. Before this fix the
  // guard consulted the row count alone, so the first upload froze the
  // wrong answer for the life of the account: the rows were held and
  // counted in no total, transfers into the account read as money set
  // aside, the pot-scoped uninterpreted count flagged nothing, and the
  // banner read as books closing, with no control anywhere in the
  // product able to undo it. A savings-ring account's own rows carry NO
  // flow (the interpretation window is built from the pot account ids
  // alone), so nothing can be stranded in this direction, and the
  // recompute that follows is what stamps those rows for the first time.
  test("a SAVINGS-ring account carrying its own imported rows CAN be corrected back to spending, and recomputes once", async () => {
    const world = makeAccountsWorld();
    await registerAccounts(context, world.deps, { rows: EIGHT });
    // Row index 4 is the first RESERVE-ring account: stand-in for the
    // spending account the household answered as savings at setup.
    const misRinged = world.rows[4];
    if (misRinged === undefined) {
      throw new Error("unreachable");
    }
    expect(misRinged.role).toBe("RESERVE");
    // Its own statement has been uploaded and accepted (DR-0030), so it
    // carries imported rows of its own.
    world.setOwnRows(misRinged.id);
    const recomputesBefore = world.recomputes();

    const outcome = await changeAccountRing(context, world.deps, {
      accountId: misRinged.id,
      role: "POT",
    });
    expect(outcome.ok).toBe(true);
    expect(world.rows[4]?.role).toBe("POT");
    // Exactly one recompute, which is what brings the previously held
    // rows into the interpretation window.
    expect(world.recomputes()).toBe(recomputesBefore + 1);
  });

  test("a ring change is ALLOWED while the account carries no rows of its own, and recomputes once", async () => {
    const world = makeAccountsWorld();
    await registerAccounts(context, world.deps, { rows: EIGHT });
    const sibling = world.rows[1];
    if (sibling === undefined) {
      throw new Error("unreachable");
    }
    const recomputesBefore = world.recomputes();

    const outcome = await changeAccountRing(context, world.deps, {
      accountId: sibling.id,
      role: "RESERVE",
    });
    expect(outcome.ok).toBe(true);
    expect(world.rows[1]?.role).toBe("RESERVE");
    expect(world.recomputes()).toBe(recomputesBefore + 1);
  });

  test("an account that is not the household's is refused rather than silently ignored", async () => {
    const world = makeAccountsWorld();
    await registerAccounts(context, world.deps, { rows: EIGHT });
    const outcome = await changeAccountRing(context, world.deps, {
      accountId: "account-belonging-to-nobody",
      role: "RESERVE",
    });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) {
      throw new Error("unreachable");
    }
    expect(outcome.error).toEqual({ kind: "account-not-found" });
  });
});

describe("criterion 14.8: nothing in the setup path writes a fact, and the rebuild is stable", () => {
  const fixtureBytes = (): Uint8Array =>
    new Uint8Array(
      readFileSync(join(__dirname, "..", "fixtures", "setup-current.csv")),
    );

  const importedWorld = async (): Promise<ReturnType<typeof makeFakeImportWorld>> => {
    const world = makeFakeImportWorld();
    const detected = detectSourceProfile(fixtureBytes());
    if (!detected.ok) {
      throw new Error("detection failed");
    }
    // Setup registers every account BEFORE the statement is imported,
    // which is the whole shape this phase ships.
    for (const [label, iban, role] of [
      ["Daily account", CURRENT, "POT"],
      ["Joint account", SIBLING_A, "POT"],
      ["Household account", SIBLING_B, "POT"],
      ["Buffer account", SIBLING_C, "POT"],
      ["Savings", SAVINGS_A, "RESERVE"],
      ["Holiday savings", SAVINGS_B, "RESERVE"],
      ["Pension savings", SAVINGS_C, "RESERVE"],
      ["Car savings", SAVINGS_D, "RESERVE"],
    ] as const) {
      await world.deps.accounts.declareAccount(context, {
        label,
        bank: "Demobank",
        role,
        iban,
      });
    }
    const uploaded = await uploadStatement(context, world.deps, {
      fileName: "setup-current.csv",
      bytes: fixtureBytes(),
    });
    if (uploaded.kind !== "awaiting-declaration") {
      throw new Error(`expected the confirm step, got ${uploaded.kind}`);
    }
    const confirmed = await confirmImport(context, world.deps, {
      importId: uploaded.importId,
      profileName: "Demobank current account",
      spec: detected.value,
    });
    expect(confirmed.kind, JSON.stringify(confirmed)).toBe("ingested");
    return world;
  };

  test("the registered household's own movements are INTERNAL and RESERVE, never SPEND", async () => {
    const world = await importedWorld();
    const flows = world.transactions.map((stored) => stored.flow);
    expect(flows.filter((flow) => flow === "INTERNAL")).toHaveLength(3);
    expect(flows.filter((flow) => flow === "RESERVE")).toHaveLength(4);
    expect(flows.filter((flow) => flow === "SPEND")).toHaveLength(2);
    expect(flows.filter((flow) => flow === "INCOME")).toHaveLength(1);
  });

  test("running recompute twice afterwards leaves every interpretation column identical", async () => {
    const world = await importedWorld();
    const snapshot = (): string =>
      JSON.stringify(
        [...world.transactions]
          .map((stored) => ({
            id: stored.id,
            flow: stored.flow ?? null,
            merchantId: stored.merchantId ?? null,
          }))
          .sort((a, b) => (a.id < b.id ? -1 : 1)),
      );

    await recomputeInterpretation(context, world.ledgerDeps);
    const once = snapshot();
    await recomputeInterpretation(context, world.ledgerDeps);
    const twice = snapshot();
    expect(twice).toBe(once);
  });

  test("the accounts module's repository exports no function that updates a transaction", async () => {
    const source = readFileSync(
      join(
        __dirname,
        "..",
        "..",
        "src",
        "modules",
        "accounts",
        "adapters",
        "account-repository.ts",
      ),
      "utf8",
    );
    // The ONLY Prisma model this repository names is the account. The
    // sweep matches a model access (prisma.<model>.<method>), so the
    // client's own prisma.$transaction batching call is not a model and
    // does not appear.
    const models = [...source.matchAll(/prisma\.([A-Za-z]+)\./g)].map(
      (match) => match[1],
    );
    expect([...new Set(models)].sort()).toEqual(["account"]);
    expect(source).not.toContain("prisma.transaction.");
  });
});

// ---------------------------------------------------------------------
// M3-P18, criterion 18.5, THE TYPED HALF: the already-registered check
// compares CANONICAL forms. Before this phase that exact pair, a stored
// NON-CANONICAL rendering (a pre-M3-P14 row, written verbatim from a
// delimited cell) beside the same account typed canonically at setup,
// passed both the check (stored strings) and the unique index (stored
// strings too), and one real account became two rows.
//
// The fake here seeds the STORED row raw, the pre-phase shape, because
// makeAccountsWorld's create canonicalises on write exactly like the
// adapter and can therefore never hold a pre-phase rendering.
// ---------------------------------------------------------------------
describe("the typed duplicate check compares canonical forms (criterion 18.5)", () => {
  const makePrePhaseWorld = (storedIban: string) => {
    const rows: AccountRecord[] = [
      {
        id: "account-pre-phase",
        label: "Daily account",
        bank: "Demobank",
        role: "POT",
        iban: storedIban,
      },
    ];
    let next = 1;
    const create = (input: NewAccount): AccountRecord => {
      const record: AccountRecord = {
        id: `account-new-${next++}`,
        label: input.label,
        bank: input.bank,
        role: input.role,
        ...(input.iban === undefined
          ? {}
          : { iban: canonicalAccountNumber(input.iban) }),
      };
      rows.push(record);
      return record;
    };
    const accounts: AccountRepositoryPort = {
      createAccount: async (_context, input) => create(input),
      createAccounts: async (_context, input) => input.map(create),
      updateAccountRole: async () => {},
      listAccounts: async () => rows,
      findAccountByIban: async (_context, iban) =>
        rows.find(
          (row) =>
            row.iban !== undefined &&
            canonicalAccountNumber(row.iban) === canonicalAccountNumber(iban),
        ) ?? null,
      getAccountById: async (_context, accountId) =>
        rows.find((row) => row.id === accountId) ?? null,
    };
    const deps: AccountsSetupDependencies = {
      accounts,
      ledger: {
        recompute: async () => {},
        hasImportedRows: async () => false,
      },
    };
    return { deps, rows };
  };

  test("a typed row whose canonical form matches a non-canonically stored account is refused, and no second row is created", async () => {
    // The stored rendering is SPACED, the way the pre-P14 import path
    // wrote it (invented for M3-P18, provenance in
    // test/fixtures/allowed-identifiers.txt).
    const world = makePrePhaseWorld("BE11 9100 0000 0001");
    const outcome = await registerAccounts(context, world.deps, {
      rows: [
        {
          label: "Daily account again",
          bank: "Demobank",
          accountNumber: "BE11910000000001",
          ring: "POT",
        },
      ],
    });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) {
      throw new Error("unreachable");
    }
    // The named error points at the offending typed row by index, the
    // shape the setup screen renders against that row in all three
    // catalogues (accountsErrorAlreadyRegistered).
    expect(outcome.error).toEqual({ kind: "already-registered", row: 0 });
    // And NO second row was created: one real account stays one row.
    expect(world.rows).toHaveLength(1);
  });

  test("a canonical stored row still refuses its spaced typed twin (both directions)", async () => {
    const world = makePrePhaseWorld("BE11910000000001");
    const outcome = await registerAccounts(context, world.deps, {
      rows: [
        {
          label: "Daily account spaced",
          bank: "Demobank",
          accountNumber: "BE11 9100 0000 0001",
          ring: "POT",
        },
      ],
    });
    expect(outcome.ok).toBe(false);
    expect(world.rows).toHaveLength(1);
  });
});
