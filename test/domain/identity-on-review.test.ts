// M3-P13. What the review screen is allowed to say about a group, decided
// in the domain and pinned here: the BASIS it was grouped on, the ACCOUNT
// ALIAS an account-basis group hands the screen when no row carries a
// counterparty name, and the TRANSACTIONS behind the group.
//
// EVERY IDENTIFIER USED HERE COMES FROM THE COMMITTED FIXTURE GENERATOR
// (criterion 13.9). Nothing is typed in as a literal, so no new identifier
// shape enters the tree and the privacy gate has nothing new to allow.

import { describe, expect, test } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { buildMerchantReview } from "@/modules/merchants/domain/merchant-review";
import type { CountedRow } from "@/modules/merchants/domain/merchant-review";
import { ACCOUNT_NAMESPACE } from "@/modules/merchants/domain/counterparty-identity";
import { maskAccountNumbers } from "@/platform/ui/mask-account-number";
import type { Cents } from "@/platform/money";
import { plainDate } from "@/platform/plain-date";
import {
  IDENTITY_FIXTURE_ACCOUNTS,
  IDENTITY_FIXTURE_LONG_SOURCES,
} from "../fixtures/generate-pdf-fixtures";
import {
  ACCOUNT_NAMESPACE as E2E_ACCOUNT_NAMESPACE,
  IDENTITY_FIXTURE_ACCOUNTS as E2E_ACCOUNTS,
} from "../e2e/identity-fixture-facts";

const cents = (value: number): Cents => value as Cents;

const spendRow = (
  id: string,
  day: string,
  amount: number,
  description: string,
  extra: {
    readonly counterpartyAccount?: string;
    readonly counterpartyName?: string;
  } = {},
): CountedRow => ({
  id,
  flow: "SPEND",
  amountCents: cents(amount),
  bookingDate: plainDate(`2026-03-${day}`),
  description,
  ...extra,
});

// Three rows to ONE counterparty account, each a different purpose and a
// different amount. This is DR-0027's accepted cost in its smallest form:
// one group, three lines.
const THREE_TO_ONE_ACCOUNT: readonly CountedRow[] = [
  spendRow("r1", "02", -12000, "TRANSFER ONE", {
    counterpartyAccount: IDENTITY_FIXTURE_ACCOUNTS.counterparty1,
  }),
  spendRow("r2", "05", -13550, "TRANSFER TWO", {
    counterpartyAccount: IDENTITY_FIXTURE_ACCOUNTS.counterparty1,
  }),
  spendRow("r3", "15", -14275, "TRANSFER THREE", {
    counterpartyAccount: IDENTITY_FIXTURE_ACCOUNTS.counterparty1,
  }),
];

describe("criterion 13.1: an unresolved group states the basis it was grouped on", () => {
  test("the account basis is reported for a group joined by a shared counterparty account", () => {
    const review = buildMerchantReview(THREE_TO_ONE_ACCOUNT, []);
    expect(review.spend).toHaveLength(1);
    expect(review.spend[0]?.basis).toBe("account");
    expect(review.spend[0]?.count).toBe(3);
  });

  test("the descriptor basis is reported for a group joined by a shared description", () => {
    const review = buildMerchantReview(
      [
        spendRow("d1", "02", -1000, "SHARED DESCRIPTOR"),
        spendRow("d2", "03", -2000, "SHARED DESCRIPTOR"),
      ],
      [],
    );
    expect(review.spend).toHaveLength(1);
    expect(review.spend[0]?.basis).toBe("descriptor");
  });

  test("a RESOLVED group reports no basis, because it is joined by the household's own naming", () => {
    const review = buildMerchantReview(
      THREE_TO_ONE_ACCOUNT.map((row) => ({ ...row, merchantId: "m1" })),
      [{ id: "m1", name: "Insurer" }],
    );
    expect(review.spend).toHaveLength(1);
    expect(review.spend[0]?.basis).toBeUndefined();
    expect(review.spend[0]?.label).toBe("Insurer");
  });
});

describe("criterion 13.2 and decision D-41: the account is the label of last resort, and it never enters the key", () => {
  test("with no counterparty name on any row, the group hands the screen its ACCOUNT and the key stays the namespaced identity", () => {
    const review = buildMerchantReview(THREE_TO_ONE_ACCOUNT, []);
    const group = review.spend[0];
    expect(group?.accountAlias).toBe(IDENTITY_FIXTURE_ACCOUNTS.counterparty1);
    // THE KEY AND THE SUBMITTED SUBJECT ARE UNMASKED AND NAMESPACED
    // (hazard H13.1): a masked subject would be stored as the rule pattern
    // and could never match a second transaction.
    expect(group?.key).toBe(
      `${ACCOUNT_NAMESPACE}${IDENTITY_FIXTURE_ACCOUNTS.counterparty1}`,
    );
    expect(group?.counterpartyText).toBe(group?.key);
    expect(group?.accountAlias).not.toContain("*");
  });

  test("with a counterparty name on one row, the NAME is the label and no account alias is handed over", () => {
    const named = [
      ...THREE_TO_ONE_ACCOUNT.slice(0, 2),
      spendRow("r3", "15", -14275, "TRANSFER THREE", {
        counterpartyAccount: IDENTITY_FIXTURE_ACCOUNTS.counterparty1,
        counterpartyName: "Demo Insurer",
      }),
    ];
    const group = buildMerchantReview(named, [])?.spend[0];
    expect(group?.label).toBe("Demo Insurer");
    expect(group?.accountAlias).toBeUndefined();
    expect(group?.key).toBe(
      `${ACCOUNT_NAMESPACE}${IDENTITY_FIXTURE_ACCOUNTS.counterparty1}`,
    );
  });

  test("the name is chosen deterministically, so two orderings of the same rows label the group the same way", () => {
    const rows = [
      spendRow("a", "02", -100, "ONE", {
        counterpartyAccount: IDENTITY_FIXTURE_ACCOUNTS.counterparty4,
        counterpartyName: "Zeta Syndic",
      }),
      spendRow("b", "03", -200, "TWO", {
        counterpartyAccount: IDENTITY_FIXTURE_ACCOUNTS.counterparty4,
        counterpartyName: "Alpha Syndic",
      }),
    ];
    expect(buildMerchantReview(rows, []).spend[0]?.label).toBe("Alpha Syndic");
    expect(buildMerchantReview([...rows].reverse(), []).spend[0]?.label).toBe(
      "Alpha Syndic",
    );
  });

  test("a DESCRIPTOR-basis group hands over no account alias, whatever its descriptor carries", () => {
    // The long source the trust gate refuses: it takes the descriptor basis,
    // which is exactly the behaviour it had before M3-P12.
    const review = buildMerchantReview(
      [
        spendRow("l1", "07", -21000, "TRANSFER TO A LONG SOURCE", {
          counterpartyAccount: IDENTITY_FIXTURE_LONG_SOURCES.storedPrefix,
        }),
      ],
      [],
    );
    expect(review.spend[0]?.basis).toBe("descriptor");
    expect(review.spend[0]?.accountAlias).toBeUndefined();
  });

  // CRITERION 13.2's SECOND HALF, as a derivation rather than as a
  // sentence: the display mask is a DISPLAY rule, so a call to it from the
  // domain or the application layer is red. A masked value reaching a key,
  // a rule pattern or a stored declaration is hazard H13.1, and the cheapest
  // way to make that impossible is for those layers never to hold one.
  test("the account mask is not called anywhere in the merchants domain or application", () => {
    const src = join(__dirname, "..", "..", "src");
    const walk = (dir: string): readonly string[] => {
      const out: string[] = [];
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) {
          out.push(...walk(full));
        } else if (entry.endsWith(".ts") || entry.endsWith(".tsx")) {
          out.push(full);
        }
      }
      return out;
    };
    const scanned = [
      ...walk(join(src, "modules/merchants/domain")),
      ...walk(join(src, "modules/merchants/application")),
    ];
    // The walk must find files at all, so a broken path cannot pass by
    // scanning nothing.
    expect(scanned.length).toBeGreaterThan(5);
    const offenders = scanned.filter((file) =>
      /maskAccountNumbers\s*\(|maskCardNumbers\s*\(/.test(
        readFileSync(file, "utf8"),
      ),
    );
    expect(offenders.map((file) => relative(src, file))).toEqual([]);
  });
});

describe("criterion 13.3: the transactions behind a group are carried, dated and summing to the group total", () => {
  test("three rows to one account produce one group of three lines whose amounts sum to the group total in integer cents", () => {
    const group = buildMerchantReview(THREE_TO_ONE_ACCOUNT, []).spend[0];
    expect(group?.rows).toHaveLength(3);
    const dates = group?.rows.map((row) => row.bookingDate) ?? [];
    const descriptions = group?.rows.map((row) => row.description) ?? [];
    expect(new Set(dates).size).toBe(3);
    expect(new Set(descriptions).size).toBe(3);
    const sum = (group?.rows ?? []).reduce(
      (total, row) => total + row.amountCents,
      0,
    );
    expect(sum).toBe(group?.totalCents);
    expect(sum).toBe(-39825);
  });

  test("a resolved group carries its rows too, so naming a group does not hide what is inside it", () => {
    const group = buildMerchantReview(
      THREE_TO_ONE_ACCOUNT.map((row) => ({ ...row, merchantId: "m1" })),
      [{ id: "m1", name: "Insurer" }],
    ).spend[0];
    expect(group?.rows).toHaveLength(3);
  });
});

describe("criterion 13.2 and hazard H13.2: the display mask redacts an account and leaves everything else alone", () => {
  test("an account number is masked to its country, its check digits and its last four characters, spaced or compact", () => {
    const compact = IDENTITY_FIXTURE_ACCOUNTS.counterparty1;
    const expected = `${compact.slice(0, 4)} **** ${compact.slice(-4)}`;
    expect(maskAccountNumbers(compact)).toBe(expected);
    expect(
      maskAccountNumbers(`OVERSCHRIJVING NAAR ${compact} DEMO VERZEKERING`),
    ).toBe(`OVERSCHRIJVING NAAR ${expected} DEMO VERZEKERING`);
    const spaced = compact.replace(/(.{4})(?=.)/g, "$1 ");
    expect(maskAccountNumbers(spaced)).toBe(expected);
  });

  test("a token whose country the registry does not know, or whose length the registry disagrees with, is LEFT ALONE", () => {
    // The truncated long source: a real country code, the wrong length for
    // it. Masking on shape alone would rewrite it; this helper does not.
    const truncated = IDENTITY_FIXTURE_LONG_SOURCES.storedPrefix;
    expect(maskAccountNumbers(truncated)).toBe(truncated);
    // ...and the full-length source IS masked, which is what says the test
    // above is about the length and not about the helper being inert.
    const full = IDENTITY_FIXTURE_LONG_SOURCES.spacedA;
    expect(maskAccountNumbers(full)).not.toBe(full);
    expect(maskAccountNumbers(full)).toContain("****");
  });

  test("ordinary descriptor text carrying no account number is returned unchanged", () => {
    const plain = "SUPERMARKT NOORD BETAALTERMINAL 12345678";
    expect(maskAccountNumbers(plain)).toBe(plain);
  });
});

// THE SLOW GATE'S COPY OF THESE VALUES IS PINNED HERE, in the FAST gate, so
// a fixture change reddens in twelve seconds rather than in thirty minutes.
// The Playwright project compiles test/e2e/ on its own and the fixture
// generator reaches into src/ through the "@/" alias, so the spec restates
// the two values it needs; restating them is only safe while something
// compares the two statements, and this is that something.
describe("the e2e facts module agrees with the fixture generator", () => {
  // DERIVED PER KEY AT RUN TIME, never a hand-written list of comparisons,
  // and the AUTHORITY is the generator (mechanism index, "Checking a
  // generated artifact against its own generator"): a comparison written
  // out field by field is silent about a field somebody adds to the restated
  // copy later, which is the containment failure that entry names.
  test("every value the e2e module restates is the generator's value under the same name", () => {
    expect(E2E_ACCOUNT_NAMESPACE).toBe(ACCOUNT_NAMESPACE);
    const restated = Object.entries(E2E_ACCOUNTS);
    expect(restated.length).toBeGreaterThan(0);
    for (const [name, value] of restated) {
      expect(
        Object.hasOwn(IDENTITY_FIXTURE_ACCOUNTS, name),
        `the e2e module restates ${name}, which the fixture generator does not export`,
      ).toBe(true);
      expect(
        value,
        `the e2e module and the fixture generator disagree on ${name}`,
      ).toBe(
        (IDENTITY_FIXTURE_ACCOUNTS as Readonly<Record<string, string>>)[name],
      );
    }
  });
});
