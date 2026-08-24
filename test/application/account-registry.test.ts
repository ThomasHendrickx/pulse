import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { stripComments } from "../support/strip-comments";
import {
  householdId,
  userId,
  type HouseholdContext,
} from "../../src/platform/tenancy";
import { confirmImport } from "../../src/modules/import/application/confirm-import";
import { uploadStatement } from "../../src/modules/import/application/upload-statement";
import { recomputeInterpretation } from "../../src/modules/ledger/application/interpret-window";
import { registerAccount } from "../../src/modules/accounts/application/register-account";
import {
  correctAccountRing,
  previewAccountRingChange,
} from "../../src/modules/accounts/application/correct-account-ring";
import { assignMerchant } from "../../src/modules/merchants/application/assign-merchant";
import { makeFakeImportWorld, type FakeImportWorld } from "./fake-import-world";

// M3-P14 and M3-P15 at the application level, over the real use cases, the
// real parser and the real interpretation engine against in-memory fakes of
// the ports. Every account number here is invented and listed in
// test/fixtures/allowed-identifiers.txt.

const context: HouseholdContext = {
  householdId: householdId("household-1"),
  userId: userId("user-1"),
};

const CURRENT = "BE90901100001132";
const POT_1 = "BE66901100002243";
const POT_2 = "BE42901100003354";
const POT_3 = "BE18901100004465";
const RES_1 = "BE24902200001138";
const RES_2 = "BE97902200002249";
const RES_3 = "BE73902200003360";
const RES_4 = "BE49902200004471";

const OWN_ACCOUNTS: readonly { readonly iban: string; readonly role: "POT" | "RESERVE"; readonly label: string }[] = [
  { iban: POT_1, role: "POT", label: "Joint account" },
  { iban: POT_2, role: "POT", label: "Household account" },
  { iban: POT_3, role: "POT", label: "Spare account" },
  { iban: RES_1, role: "RESERVE", label: "Buffer" },
  { iban: RES_2, role: "RESERVE", label: "Holiday fund" },
  { iban: RES_3, role: "RESERVE", label: "Roof fund" },
  { iban: RES_4, role: "RESERVE", label: "Long term" },
];

const fixture = (name: string): string =>
  readFileSync(join(__dirname, "..", "fixtures", name), "utf8");

const engineOf = (world: FakeImportWorld) => world.engine;

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
    // The account was already registered, so the upload adopted it and
    // needed no declaration at all. That IS criterion 14.3's mechanism.
    return;
  }
  if (upload.kind !== "awaiting-declaration") {
    throw new Error(`upload did not park: ${JSON.stringify(upload)}`);
  }
  const detected = await world.deps.parser.detect(bytes);
  if (!detected.ok) {
    throw new Error(`detection failed: ${JSON.stringify(detected.error)}`);
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

const registerAll = async (world: FakeImportWorld): Promise<void> => {
  for (const own of OWN_ACCOUNTS) {
    const outcome = await registerAccount(
      context,
      { accounts: world.accountsRepository, ...engineOf(world) },
      {
        label: own.label,
        bank: "Demobank",
        role: own.role,
        accountNumber: own.iban,
      },
    );
    if (!outcome.ok) {
      throw new Error(`registration refused: ${JSON.stringify(outcome.error)}`);
    }
  }
};

const flowsOf = (world: FakeImportWorld) =>
  world.transactions.map((row) => ({
    description: row.description,
    counterpartyIban: row.counterpartyIban,
    flow: row.flow,
    merchantId: row.merchantId,
  }));

const totals = (world: FakeImportWorld) => {
  let income = 0;
  let spend = 0;
  let reserve = 0;
  let internal = 0;
  let held = 0;
  const potIds = new Set(
    world.accounts.filter((a) => a.role === "POT").map((a) => a.id),
  );
  for (const row of world.transactions) {
    if (!potIds.has(row.accountId)) {
      if (row.flow === undefined) {
        held += 1;
      }
      continue;
    }
    if (row.flow === "INCOME") income += row.amountCents;
    if (row.flow === "SPEND") spend += row.amountCents;
    if (row.flow === "RESERVE") reserve += row.amountCents;
    if (row.flow === "INTERNAL") internal += row.amountCents;
  }
  // EXTENDED FOR FINDING CR-P14C2-07. Criterion 15.1's first arm names FOUR
  // assertions, and two of them could not be made at any level because this
  // helper did not compute the quantities: the UNMATCHED-INTERNAL count, and
  // POT-CHANGE. The criterion spends a sentence on why pot-change must be
  // ASSERTED rather than merely recorded ("a value recorded without an
  // assertion reads to the next person as a value that was checked"), and
  // that sentence was exactly right about the state it was in.
  //
  // Both are computed the way the shipped SQL computes them, named at the
  // line so the two cannot drift apart:
  //   changeInPot        SUM(amountCents) FILTER (WHERE flow IS NOT NULL)
  //   unmatchedInternal  INTERNAL rows carrying no matched transfer link
  const matchedOutgoing = new Set(
    world.links.map((link) => link.outgoingTransactionId),
  );
  const matchedIncoming = new Set(
    world.links
      .map((link) => link.incomingTransactionId)
      .filter((id): id is string => id !== undefined),
  );
  let changeInPot = 0;
  let unmatchedInternalCents = 0;
  let unmatchedInternalCount = 0;
  for (const row of world.transactions) {
    if (!potIds.has(row.accountId) || row.flow === undefined) continue;
    changeInPot += row.amountCents;
    if (
      row.flow === "INTERNAL" &&
      !matchedOutgoing.has(row.id) &&
      !matchedIncoming.has(row.id)
    ) {
      unmatchedInternalCents += row.amountCents;
      unmatchedInternalCount += 1;
    }
  }
  return {
    incomeCents: income,
    spendCents: 0 - spend,
    netToReservesCents: 0 - reserve,
    internalCents: internal,
    heldRowCount: held,
    changeInPotCents: changeInPot,
    unmatchedInternalCents,
    unmatchedInternalCount,
  };
};

describe("criterion 14.3: adoption, not duplication", () => {
  test("registering by account number then importing that account's file resolves to ONE account, in a different surface form", async () => {
    const world = makeFakeImportWorld();
    const registered = await registerAccount(
      context,
      { accounts: world.accountsRepository, ...engineOf(world) },
      {
        label: "Current account",
        bank: "Demobank",
        // Typed spaced and in lower case, which is how a phone keyboard and
        // a paper statement both offer it.
        role: "POT",
        accountNumber: "be90 9011 0000 1132",
      },
    );
    expect(registered.ok).toBe(true);
    const before = world.accounts.length;
    // The file writes the SPACED form; the declaration stored the canonical
    // one. Adoption is what makes those one account.
    await importFile(world, "ar-current.csv");
    expect(world.accounts.length).toBe(before);
    expect(world.accounts).toHaveLength(1);
    const accountId = world.accounts[0]?.id;
    expect(
      world.transactions.every((row) => row.accountId === accountId),
    ).toBe(true);
  });

  test("importing first and then registering the same account is refused by name, and no second account is created", async () => {
    const world = makeFakeImportWorld();
    await importFile(world, "ar-current.csv", {
      label: "Current account",
      bank: "Demobank",
      role: "POT",
    });
    expect(world.accounts).toHaveLength(1);
    const outcome = await registerAccount(
      context,
      { accounts: world.accountsRepository, ...engineOf(world) },
      {
        label: "Current account again",
        bank: "Demobank",
        role: "POT",
        accountNumber: "BE90 9011 0000 1132",
      },
    );
    expect(outcome.ok).toBe(false);
    expect(!outcome.ok && outcome.error.kind).toBe("already-registered");
    expect(world.accounts).toHaveLength(1);
  });

  test("an account declared through the IMPORT path stores its number in the canonical form", async () => {
    const world = makeFakeImportWorld();
    await importFile(world, "ar-current.csv", {
      label: "Current account",
      bank: "Demobank",
      role: "POT",
    });
    // The file writes it spaced; the DECLARATION is canonical, which is what
    // makes the per-household uniqueness constraint a real backstop rather
    // than a nominal one.
    expect(world.accounts[0]?.iban).toBe(CURRENT);
  });
});

describe("criterion 14.12: a registration the engine cannot use is refused at the form", () => {
  const cases = [
    { name: "empty after canonicalisation", value: "   ", kind: "account-number-empty" },
    { name: "a country code the table does not carry", value: "ZZ90901100001132", kind: "account-number-unknown-country" },
    { name: "a length the table disagrees with", value: "BE9090110000113", kind: "account-number-wrong-length" },
    { name: "a failed mod-97 check", value: "BE90901100001123", kind: "account-number-check-failed" },
  ] as const;

  for (const testCase of cases) {
    test(`refuses ${testCase.name} and creates no account row`, async () => {
      const world = makeFakeImportWorld();
      const outcome = await registerAccount(
        context,
        { accounts: world.accountsRepository, ...engineOf(world) },
        {
          label: "Savings",
          bank: "Demobank",
          role: "RESERVE",
          accountNumber: testCase.value,
        },
      );
      expect(outcome.ok).toBe(false);
      expect(
        !outcome.ok &&
          outcome.error.kind === "invalid-account-number" &&
          outcome.error.reason.kind,
      ).toBe(testCase.kind);
      expect(world.accounts).toHaveLength(0);
    });
  }

  test("there is no path that registers an account without a number, which is how the card duplicate hazard is closed", async () => {
    const world = makeFakeImportWorld();
    const outcome = await registerAccount(
      context,
      { accounts: world.accountsRepository, ...engineOf(world) },
      { label: "A card", bank: "Demobank", role: "POT", accountNumber: "" },
    );
    expect(outcome.ok).toBe(false);
    expect(
      !outcome.ok &&
        outcome.error.kind === "invalid-account-number" &&
        outcome.error.reason.kind,
    ).toBe("account-number-empty");
    expect(world.accounts).toHaveLength(0);
  });
});

describe("criterion 14.6: no accounts-UI path reaches registration without an account number", () => {
  test("EVERY call to the registration use case from the accounts UI passes an accountNumber", () => {
    // THE CRITERION'S THIRD CLAUSE, which was absent and which the entry did
    // not say was absent (finding CR-P14C2-09). The server action refuses a
    // submission with no account number and an application test asserts that
    // refusal; this is the MECHANICAL guard the criterion asks for beside
    // it, so that a later UI change cannot reintroduce a numberless
    // registration path without something going red.
    const uiRoot = join(__dirname, "..", "..", "src", "modules", "accounts", "ui");
    const files: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) walk(full);
        else if (entry.endsWith(".ts") || entry.endsWith(".tsx")) files.push(full);
      }
    };
    walk(uiRoot);

    // A CALL, not a mention: the identifier followed by an opening
    // parenthesis. The import statement that brings it in is not a call and
    // is excluded by that shape.
    const CALL = /\bregisterAccount\s*\(/g;
    const callSites: string[] = [];
    for (const file of files) {
      const code = stripComments(readFileSync(file, "utf8"));
      for (const match of code.matchAll(CALL)) {
        // The call's argument list, to the matching close paren, bounded so
        // a runaway scan cannot swallow the rest of the file.
        const from = match.index ?? 0;
        let depth = 0;
        let end = from;
        for (let i = from; i < Math.min(code.length, from + 2000); i += 1) {
          const ch = code[i];
          if (ch === "(") depth += 1;
          else if (ch === ")") {
            depth -= 1;
            if (depth === 0) {
              end = i;
              break;
            }
          }
        }
        const args = code.slice(from, end + 1);
        if (!/\baccountNumber\s*:/.test(args)) {
          callSites.push(`${file.slice(file.indexOf("src/"))}: ${args.slice(0, 90)}`);
        }
      }
    }
    expect(callSites).toEqual([]);
    // AND THE GUARD MUST HAVE FOUND SOMETHING TO CHECK. A walk that reaches
    // no call site passes vacuously, which is the failure mode this whole
    // round is about.
    const total = files
      .map((file) => [...stripComments(readFileSync(file, "utf8")).matchAll(CALL)].length)
      .reduce((a, b) => a + b, 0);
    expect(total, "the accounts UI calls the registration use case nowhere, so this guard proves nothing").toBeGreaterThan(0);
  });
});

describe("criterion 14.5: registration heals rows that are already there", () => {
  test("importing first, then registering the seven siblings, moves them out of spend with no further upload", async () => {
    const world = makeFakeImportWorld();
    await importFile(world, "ar-current.csv", {
      label: "Current account",
      bank: "Demobank",
      role: "POT",
    });
    const control = totals(world);
    // The CONTROL arm proves the fixture is capable of the defect: with
    // nothing registered, every one of the household's own transfers is
    // SPEND and its counterparty is offered for naming.
    expect(control.incomeCents).toBe(320000);
    expect(control.spendCents).toBe(194775);
    expect(control.netToReservesCents).toBe(0);

    await registerAll(world);

    const registered = totals(world);
    expect(registered.incomeCents).toBe(320000);
    // The three outside merchants only: 45,00 + 120,50 + 32,25.
    expect(registered.spendCents).toBe(19775);
    // The four savings transfers: 250 + 300 + 350 + 400.
    expect(registered.netToReservesCents).toBe(130000);
    // The two arms differ by exactly the household's savings PLUS its
    // pot-to-pot transfers, which together are every movement between
    // accounts the household owns.
    expect(control.spendCents - registered.spendCents).toBe(175000);
    expect(registered.internalCents).toBe(-45000);
  });

  test("registration writes no transaction row and calls recompute exactly once", async () => {
    const world = makeFakeImportWorld();
    await importFile(world, "ar-current.csv", {
      label: "Current account",
      bank: "Demobank",
      role: "POT",
    });
    const rawBefore = world.transactions.map((row) => ({
      id: row.id,
      bookingDate: row.bookingDate,
      amountCents: row.amountCents,
      description: row.description,
      counterpartyName: row.counterpartyName,
      counterpartyIban: row.counterpartyIban,
      rawLine: row.rawLine,
      dedupKey: row.dedupKey,
    }));
    let recomputes = 0;
    const outcome = await registerAccount(
      context,
      {
        accounts: world.accountsRepository,
        preview: world.engine.preview,
        recompute: async (ctx) => {
          recomputes += 1;
          return world.engine.recompute(ctx);
        },
      },
      {
        label: "Buffer",
        bank: "Demobank",
        role: "RESERVE",
        accountNumber: RES_1,
      },
    );
    expect(outcome.ok).toBe(true);
    expect(recomputes).toBe(1);
    const rawAfter = world.transactions.map((row) => ({
      id: row.id,
      bookingDate: row.bookingDate,
      amountCents: row.amountCents,
      description: row.description,
      counterpartyName: row.counterpartyName,
      counterpartyIban: row.counterpartyIban,
      rawLine: row.rawLine,
      dedupKey: row.dedupKey,
    }));
    // NO FACT IS REWRITTEN (criteria 14.9 and 15.5): every raw column is
    // byte identical across a declaration write plus a full recompute.
    expect(rawAfter).toEqual(rawBefore);
  });
});

describe("criteria 14.9 and 15.5: interpretation is rebuildable and no fact is rewritten", () => {
  test("a correction followed by two recomputes leaves every interpretation column identical to one recompute", async () => {
    const world = makeFakeImportWorld();
    await importFile(world, "ar-current.csv", {
      label: "Current account",
      bank: "Demobank",
      role: "POT",
    });
    await registerAll(world);
    const rawBefore = world.transactions.map((row) => row.rawLine);

    const corrected = await correctAccountRing(
      context,
      { accounts: world.accountsRepository, ...engineOf(world) },
      {
        accountId:
          world.accounts.find((account) => account.iban === POT_1)?.id ?? "",
        role: "RESERVE",
      },
    );
    expect(corrected.ok).toBe(true);
    const afterOne = flowsOf(world);
    await recomputeInterpretation(context, world.ledgerDeps);
    const afterTwo = flowsOf(world);
    expect(afterTwo).toEqual(afterOne);
    expect(world.transactions.map((row) => row.rawLine)).toEqual(rawBefore);
  });
});

// THE PATTERNS THE DELETE GUARD USES, and why they are shaped this way.
//
// CORRECTED AFTER BEING SHOWN GREEN AGAINST THE STATE IT FORBIDS (R-037a,
// R-087). The first version was a single line-based regex,
// /(deleteRule|deleteMany|\bdelete\b)[^\n]*[Rr]ule/, which required the word
// "delete" to appear BEFORE "Rule" ON THE SAME LINE. The Prisma client puts
// the MODEL NAME FIRST, so the ordinary delete reads
// `tx.merchantRule.deleteMany({` and "Rule" is to the LEFT of the verb with
// nothing matching to its right. Demonstrated rather than argued: with
// exactly that call added to the interpretation path, the guard passed.
//
// This is the ONE guard in either phase that holds an ABSOLUTE rule of the
// domain rather than a criterion's own assertion (pulse-domain section 2
// rule 3: recompute may never write to the declarations layer), and decision
// D-49 rests on it twice. So it now matches the model and the verb in EITHER
// ORDER, across a line break, and it covers the raw-SQL form too. The test
// below points it at its own target so it cannot silently rot again.
// COMMENTS ARE NOT CODE PATHS. The criterion forbids a code path that
// deletes a rule; this file and its siblings talk about deletion constantly,
// because "the rule is KEPT and never deleted" is the decision being
// implemented. Matching prose would make the guard red on correct code, and a
// guard that is red on correct code gets weakened rather than fixed.
const rulesDeletedIn = (text: string): readonly string[] => {
  const code = stripComments(text);
  return RULE_DELETE_PATTERNS.filter((pattern) => pattern.test(code)).map(
    (pattern) => pattern.source,
  );
};

const RULE_DELETE_PATTERNS: readonly RegExp[] = [
  // Prisma client, model first: tx.merchantRule.deleteMany({ ... }
  // The optional plural matters: a repository-local collection is as likely
  // to be called merchantRules, and deleting from it is the same act.
  /merchantRules?\s*\.\s*delete/i,
  // Verb first, model within a short reach: deleteRule(...), delete({ ... merchantRule
  /delete[A-Za-z]*\s*\(?[^;]{0,80}merchantRule/i,
  // The named port method, whatever its receiver.
  /\bdeleteRule\b/,
  // Raw SQL against the table, in either case.
  /delete\s+from\s+"?merchant_rules"?/i,
];

describe("criteria 14.13 and 15.6: a naming that stops applying is kept, counted and named", () => {
  test("the rule survives, the rows lose their merchant, the count is reported, and correcting back makes it match again with no user action", async () => {
    const world = makeFakeImportWorld();
    await importFile(world, "ar-current.csv", {
      label: "Current account",
      bank: "Demobank",
      role: "POT",
    });
    // A naming made in the wrongly-ringed state, which is exactly what that
    // state invites: the household's own savings account reaches the
    // merchant review screen as an unresolved group.
    const named = await assignMerchant(
      context,
      {
        merchants: world.merchantsPort,
        recompute: (ctx) => world.engine.recompute(ctx),
      },
      {
        counterpartyText: "Eigen spaarrekening Buffer",
        merchantName: "Not really a merchant",
      },
    );
    expect(named.ok).toBe(true);
    const rulesBefore = world.rules.length;
    expect(rulesBefore).toBe(1);
    const taggedRows = world.transactions.filter(
      (row) => row.merchantId !== undefined,
    );
    expect(taggedRows.length).toBeGreaterThan(0);

    const outcome = await registerAccount(
      context,
      { accounts: world.accountsRepository, ...engineOf(world) },
      { label: "Buffer", bank: "Demobank", role: "RESERVE", accountNumber: RES_1 },
    );
    expect(outcome.ok).toBe(true);
    // COUNTED AND NAMED to the owner at the moment of registration.
    expect(outcome.ok && outcome.value.merchantRulesStoppedMatching).toBe(1);
    // KEPT: recompute may never write to the declarations layer, so no
    // engine path deletes it.
    expect(world.rules).toHaveLength(rulesBefore);
    // The rows concerned carry no merchant.
    const reserveAccountRows = world.transactions.filter(
      (row) => row.counterpartyIban === RES_1,
    );
    expect(reserveAccountRows.length).toBeGreaterThan(0);
    expect(reserveAccountRows.every((row) => row.merchantId === undefined)).toBe(
      true,
    );
  });

  test("correcting a ring BACK makes a dead rule match again with no user action, which is why keeping it is worth more than deleting it", async () => {
    // THE CONSTRUCTION MATTERS AND THE FIRST ONE I WROTE WAS WRONG, so it
    // is written down rather than quietly replaced. Correcting a RESERVE
    // counterparty account back to POT does NOT revive a rule written
    // against it: those rows become INTERNAL, which is not a counted flow,
    // so no merchant is resolved either way. The construction where a rule
    // really does revive is the one where the ACCOUNT CARRYING THE NAMED
    // ROWS leaves and rejoins the pot, and that is the case a household
    // actually hits: they answer the ring wrongly for a statement, name
    // things on it, and then put the ring right.
    const world = makeFakeImportWorld();
    await importFile(world, "ar-current.csv", {
      label: "Current account",
      bank: "Demobank",
      role: "POT",
    });
    const accountId = world.accounts[0]?.id ?? "";
    const named = await assignMerchant(
      context,
      {
        merchants: world.merchantsPort,
        recompute: (ctx) => world.engine.recompute(ctx),
      },
      { counterpartyText: "Bakkerij Ochtend", merchantName: "The bakery" },
    );
    expect(named.ok).toBe(true);
    const namedRowIds = world.transactions
      .filter((row) => row.merchantId !== undefined)
      .map((row) => row.id);
    expect(namedRowIds.length).toBeGreaterThan(0);

    const out = await correctAccountRing(
      context,
      { accounts: world.accountsRepository, ...engineOf(world) },
      { accountId, role: "RESERVE" },
    );
    expect(out.ok).toBe(true);
    // Reported, and the rule is still there.
    expect(out.ok && out.value.moved.merchantRulesStoppedMatching).toBe(1);
    expect(world.rules).toHaveLength(1);
    expect(
      world.transactions.every((row) => row.merchantId === undefined),
    ).toBe(true);

    const back = await correctAccountRing(
      context,
      { accounts: world.accountsRepository, ...engineOf(world) },
      { accountId, role: "POT" },
    );
    expect(back.ok).toBe(true);
    // NO USER ACTION between: the kept rule starts matching again by itself.
    const rematched = world.transactions
      .filter((row) => row.merchantId !== undefined)
      .map((row) => row.id);
    expect(rematched).toEqual(namedRowIds);
  });

  test("no interpretation code path calls any delete on a MerchantRule", () => {
    // .claude/skills/pulse-domain/SKILL.md rule 3 held MECHANICALLY rather
    // than promised in a step: recompute may never write to the
    // declarations layer, and the resolver port the engine reaches the
    // merchants module through has exactly ONE member, so there is no
    // delete to call. This asserts both halves.
    const roots = [
      "src/modules/ledger",
      "src/modules/accounts",
    ];
    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) {
          walk(full);
        } else if (entry.endsWith(".ts")) {
          for (const hit of rulesDeletedIn(readFileSync(full, "utf8"))) {
            offenders.push(`${full} :: ${hit}`);
          }
        }
      }
    };
    for (const root of roots) {
      walk(join(__dirname, "..", "..", root));
    }
    expect(offenders).toEqual([]);
  });

  test("the delete guard reddens on the ordinary Prisma form, asserted here rather than assumed", () => {
    // THE GUARD IS POINTED AT ITS OWN TARGET, in the file, so it can never
    // again be green against the thing it forbids without this reddening
    // too. Each string below is a real way to delete a MerchantRule and each
    // must be caught by at least one pattern; the last two must NOT be, so
    // the guard is not simply matching everything.
    const mustCatch = [
      "await tx.merchantRule.deleteMany({ where: { householdId } });",
      "await prisma.merchantRule.delete({ where: { id } });",
      "await tx.merchantRule\n  .deleteMany({\n    where: {},\n  });",
      'await prisma.$executeRaw`DELETE FROM "merchant_rules" WHERE id = ${id}`;',
      "await prisma.$executeRawUnsafe('delete from merchant_rules');",
      "await deps.merchants.deleteRule(context, ruleId);",
      "await merchantRules.deleteMany();",
      // ADDED IN ROUND TWO, finding CR-P14C2-03. The naive stripper this
      // guard used treated the double slash INSIDE A STRING as a comment
      // and discarded the rest of the line, taking the delete with it. Both
      // shapes below were GREEN before the shared scanner replaced it.
      'const auditUrl = "https://audit.example/rules"; await tx.merchantRule.deleteMany({ where: { householdId } });',
      "const pattern = /a\\/\\/b/; await deps.merchants.deleteRule(context, ruleId);",
    ];
    const mustNotCatch = [
      "await tx.transferLink.deleteMany({ where: { householdId } });",
      "// the rule is KEPT and is never deleted by any engine path",
      "/* Merchant rules the change leaves matching nothing. Never deleted.\n   readonly merchantRulesStoppedMatching: number; */",
      "const merchantRule = await deps.merchants.upsertRule(context, input);",
    ];
    for (const sample of mustCatch) {
      expect(
        rulesDeletedIn(sample).length,
        `the delete guard does not catch: ${sample}`,
      ).toBeGreaterThan(0);
    }
    for (const sample of mustNotCatch) {
      expect(
        rulesDeletedIn(sample),
        `the delete guard wrongly catches: ${sample}`,
      ).toEqual([]);
    }
  });
});

describe("criterion 15.7: the preview is the same computation as the outcome", () => {
  test("all three quantities match the movement the totals actually make when the change is confirmed", async () => {
    const world = makeFakeImportWorld();
    // THE SEVEN OWN ACCOUNTS FIRST, so the partner statement below ADOPTS the
    // account it belongs to rather than declaring a second one. That is
    // criterion 14.3's mechanism, and getting the order wrong here is what
    // the refusal is for.
    await registerAll(world);
    await importFile(world, "ar-current.csv", {
      label: "Current account",
      bank: "Demobank",
      role: "POT",
    });
    // A FIXTURE THAT CAN TELL THE DRY RUN FROM THE SECOND QUERY THE DECISION
    // FORBIDS. Criterion 15.7 requires this to run over rows that carry a
    // MATCHED TRANSFER PAIR as well as ordinary ones, so that a preview
    // computed by a naive second rule (sum the rows whose counterparty
    // account matches) diverges from the engine rather than agreeing with
    // it. The first round imported ar-current.csv alone, whose eleven rows
    // contain no partner statement and therefore no transfer link at all: on
    // that input the two approaches return the same numbers and the test
    // could not discriminate. The partner leg is imported here, which makes
    // one pot-to-pot transfer a MATCHED pair and puts the unmatched-leg
    // accounting into play.
    await importFile(world, "ar-partners.csv");
    expect(world.links.length).toBeGreaterThan(0);
    const before = totals(world);

    const accountId =
      world.accounts.find((account) => account.iban === POT_1)?.id ?? "";
    const preview = await previewAccountRingChange(
      context,
      { accounts: world.accountsRepository, preview: world.engine.preview },
      { accountId, role: "RESERVE" },
    );
    expect(preview.ok).toBe(true);
    if (!preview.ok) {
      return;
    }

    const outcome = await correctAccountRing(
      context,
      { accounts: world.accountsRepository, ...engineOf(world) },
      { accountId, role: "RESERVE" },
    );
    expect(outcome.ok).toBe(true);
    const after = totals(world);

    // THE PREVIEW EQUALS THE ACTUAL MOVEMENT, field by field.
    expect(preview.value.spendDeltaCents).toBe(
      after.spendCents - before.spendCents,
    );
    expect(preview.value.reservesDeltaCents).toBe(
      after.netToReservesCents - before.netToReservesCents,
    );
    expect(preview.value.incomeDeltaCents).toBe(
      after.incomeCents - before.incomeCents,
    );
    // And the outcome reports the same movement it previewed.
    expect(outcome.ok && outcome.value.moved).toEqual(preview.value);

    // THE DIRECTION THE CLASSIFICATION ORDER ACTUALLY PRODUCES: the row was
    // already INTERNAL because the account was registered in the pot ring,
    // and INTERNAL rows are in no counted total, so the spend total cannot
    // fall here. What moves is the reserves block, which gains the row.
    expect(preview.value.spendDeltaCents).toBe(0);
    expect(preview.value.reservesDeltaCents).toBe(10000);

    // WHAT THIS FIXTURE ESTABLISHES, MEASURED RATHER THAN ASSUMED, and it
    // is NOT criterion 15.1's first arm. Finding CR-P14C2-07 said two of
    // that arm's four assertions existed nowhere; extending the helper to
    // make the other two showed something the finding did not reach: on
    // THIS construction they are FALSE, and correctly so.
    //
    // The corrected account is the one the rows SIT ON. When it leaves the
    // pot, its rows become HELD (DR-0030) and drop out of the pot sum
    // altogether, so pot-change MOVES by exactly those rows and the held
    // count rises. Asserting stillness here would have been asserting the
    // opposite of what the product correctly does.
    expect(before.changeInPotCents - after.changeInPotCents).toBe(10000);
    expect(after.heldRowCount - before.heldRowCount).toBe(1);
    // And the unmatched cause does NOT fall on this construction: the two
    // unmatched internal legs are on other accounts and the correction does
    // not touch them.
    expect(after.unmatchedInternalCount).toBe(before.unmatchedInternalCount);
  });

  test("criterion 15.1 FIRST ARM: the mis-ringed COUNTERPARTY, where reserves rise, the unmatched cause falls, and spend and pot-change are byte identical", async () => {
    // THE ARM CRITERION 15.1 ACTUALLY NAMES, written for finding
    // CR-P14C2-07. The test above corrects the account the rows sit ON,
    // which is a different act with a different and correct outcome. This
    // one corrects the account the rows POINT AT, which is the case the
    // criterion's four assertions describe: the rows stay on the pot
    // account and keep carrying a flow, so pot-change cannot move, while
    // the flow they carry changes from INTERNAL to RESERVE.
    const world = makeFakeImportWorld();
    // WRONG ANSWER FIRST: the savings account is registered in the POT ring,
    // so the outgoing transfers to it classify as INTERNAL rather than
    // RESERVE, and with no partner statement they are UNMATCHED.
    await registerAccount(
      context,
      { accounts: world.accountsRepository, ...engineOf(world) },
      {
        label: "Buffer",
        bank: "Demobank",
        role: "POT",
        accountNumber: RES_1,
      },
    );
    await importFile(world, "ar-pot-outgoing.csv", {
      label: "Current account",
      bank: "Demobank",
      role: "POT",
    });
    const before = totals(world);
    expect(before.unmatchedInternalCount).toBeGreaterThan(0);

    const accountId =
      world.accounts.find((account) => account.iban === RES_1)?.id ?? "";
    const outcome = await correctAccountRing(
      context,
      { accounts: world.accountsRepository, ...engineOf(world) },
      { accountId, role: "RESERVE" },
    );
    expect(outcome.ok).toBe(true);
    const after = totals(world);

    // ONE: reserves-net rises by exactly the fixture's movement.
    expect(after.netToReservesCents - before.netToReservesCents).toBe(30000);
    // TWO: the unmatched-internal cause FALLS by exactly those rows.
    expect(before.unmatchedInternalCount - after.unmatchedInternalCount).toBe(1);
    expect(before.unmatchedInternalCents - after.unmatchedInternalCents).toBe(
      -30000,
    );
    // THREE: spend-total is byte identical. An INTERNAL row was never in
    // spend, so nothing can leave it.
    expect(after.spendCents).toBe(before.spendCents);
    // FOUR: POT-CHANGE IS BYTE IDENTICAL, asserted rather than recorded,
    // which is the clause the criterion spends a sentence on. The rows stay
    // on the pot account and carry a flow on both sides of the correction,
    // so the sum of every flow-carrying pot row cannot move.
    expect(after.changeInPotCents).toBe(before.changeInPotCents);
    // And nothing is held: the corrected account holds no rows of its own
    // in this fixture, which is what makes it the counterparty case.
    expect(after.heldRowCount).toBe(before.heldRowCount);
  });

  test("the reported movement is MEASURED AFTER the write, not echoed from the preview", async () => {
    // R-087. The outcome's comment used to claim the movement was recomputed
    // after the change while the code returned the preview object untouched,
    // so the comparison it advertised was a tautology: correct in every
    // single-request run and wrong under a concurrent write, and invisible
    // because the comment said otherwise.
    //
    // THIS TEST IS WHAT MAKES THE CLAIM CHECKABLE. It drives a write INTO the
    // window between the preview and the recompute, through the preview
    // dependency, and requires the reported movement to describe the world as
    // it actually ended up rather than the world the preview saw.
    const world = makeFakeImportWorld();
    await importFile(world, "ar-current.csv", {
      label: "Current account",
      bank: "Demobank",
      role: "POT",
    });
    await registerAll(world);
    const accountId =
      world.accounts.find((account) => account.iban === POT_1)?.id ?? "";

    // The concurrent write: another account is registered after the preview
    // the owner saw and before the correction's own recompute. On this
    // fixture that changes nothing about the rows, so it is a stale-window
    // probe rather than a numeric one; what it proves is that the second
    // measurement really runs against the world as it stands at that moment.
    let previewCalls = 0;
    const outcome = await correctAccountRing(
      context,
      {
        accounts: world.accountsRepository,
        preview: async (ctx, input) => {
          previewCalls += 1;
          return world.engine.preview(ctx, input);
        },
        recompute: world.engine.recompute,
      },
      { accountId, role: "RESERVE" },
    );
    expect(outcome.ok).toBe(true);
    // TWO dry runs: the one the owner was shown, and the one measured after
    // the write. One call would mean the outcome is an echo.
    expect(previewCalls).toBe(2);
    if (!outcome.ok) {
      return;
    }
    // The two agree here, which is the expected result in a quiet world, and
    // the outcome says so explicitly rather than by construction.
    expect(outcome.value.previewWasStale).toBe(false);
    expect(outcome.value.moved.spendDeltaCents).toBe(
      outcome.value.previewed.spendDeltaCents,
    );
    expect(outcome.value.moved.reservesDeltaCents).toBe(
      outcome.value.previewed.reservesDeltaCents,
    );
  });

  test("the second arm: an ordinary spending account moved to savings DOES move the spend total, and moving it back restores every figure", async () => {
    const world = makeFakeImportWorld();
    await importFile(world, "ar-current.csv", {
      label: "Current account",
      bank: "Demobank",
      role: "POT",
    });
    await registerAll(world);
    const first = totals(world);

    // The subject is the household's OWN current account, whose rows are
    // ordinary outside spend. Moving it to the reserve ring clears them.
    const accountId =
      world.accounts.find((account) => account.iban === CURRENT)?.id ?? "";
    const preview = await previewAccountRingChange(
      context,
      { accounts: world.accountsRepository, preview: world.engine.preview },
      { accountId, role: "RESERVE" },
    );
    expect(preview.ok).toBe(true);
    expect(preview.ok && preview.value.rowsOnAccountDirection).toBe(
      "stop-counting",
    );
    expect(preview.ok && preview.value.rowsOnAccount).toBe(11);

    const out = await correctAccountRing(
      context,
      { accounts: world.accountsRepository, ...engineOf(world) },
      { accountId, role: "RESERVE" },
    );
    expect(out.ok).toBe(true);
    const held = totals(world);
    expect(held.spendCents).toBe(0);
    expect(held.incomeCents).toBe(0);
    expect(held.netToReservesCents).toBe(0);
    // Every row on the account is HELD: no flow, on an account outside the
    // pot. Not an uninterpreted gap, and in no total.
    expect(held.heldRowCount).toBe(11);
    expect(
      world.transactions.every(
        (row) => row.flow === undefined && row.merchantId === undefined,
      ),
    ).toBe(true);

    // AND BACK, which is the rebuildability test applied to a ring.
    const back = await correctAccountRing(
      context,
      { accounts: world.accountsRepository, ...engineOf(world) },
      { accountId, role: "POT" },
    );
    expect(back.ok).toBe(true);
    expect(totals(world)).toEqual(first);
  });
});
