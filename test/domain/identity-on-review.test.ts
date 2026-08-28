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
import {
  ACCOUNT_NUMBER_LENGTH_BY_COUNTRY,
  accountNumberChecksumHolds,
  canonicalAccountNumber,
} from "@/platform/account-number";
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

describe("hazard H13.2: the label the group would otherwise have carried prints the account in full", () => {
  test("the normalised descriptor of an account-basis row carries the account exactly as the statement printed it", () => {
    const account = IDENTITY_FIXTURE_ACCOUNTS.counterparty1;
    const spaced = account.replace(/(.{4})(?=.)/g, "$1 ");
    const descriptor = `OVERSCHRIJVING NAAR ${spaced} DEMO COUNTERPARTY`;
    const review = buildMerchantReview(
      [
        spendRow("h1", "02", -12000, descriptor, {
          counterpartyAccount: account,
        }),
      ],
      [],
    );
    const group = review.spend[0];
    // This is what the screen showed before this phase, and it is why the
    // account label exists: the descriptor label prints the account.
    expect(group?.label).toContain(spaced);
    // The screen no longer renders that label for this group; it renders the
    // masked alias instead, and the alias carries neither shape.
    expect(group?.accountAlias).toBe(account);
    expect(maskAccountNumbers(group?.accountAlias ?? "")).not.toContain(account);
    expect(maskAccountNumbers(group?.accountAlias ?? "")).not.toContain(spaced);
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

  // CORRECTED LOUDLY RATHER THAN QUIETLY REWRITTEN (clause R-087, fix round,
  // finding HZ-M3P13-04). This test used to be titled "a token whose country
  // the registry does not know, OR whose length the registry disagrees with,
  // is LEFT ALONE" and it asserted both halves. The first half was a
  // FAIL-OPEN defect rather than a property: an account of a country the
  // pinned table does not carry was printed in full. Only the second half
  // survives, and the first is now its opposite, below.
  test("a token whose length the registry disagrees with, for a country it DOES carry, is left alone", () => {
    // The truncated long source: a real country code, the wrong length for
    // it. Masking on shape alone would rewrite it; this helper does not.
    const truncated = IDENTITY_FIXTURE_LONG_SOURCES.storedPrefix;
    expect(maskAccountNumbers(truncated)).toBe(truncated);
    // ...and the full-length source IS masked, which is what says the
    // assertion above is about the length and not about the helper being
    // inert.
    const full = IDENTITY_FIXTURE_LONG_SOURCES.spacedA;
    expect(maskAccountNumbers(full)).not.toBe(full);
    expect(maskAccountNumbers(full)).toContain("****");
  });

  // AN UNREGISTERED COUNTRY NOW FAILS CLOSED (fix round, finding
  // HZ-M3P13-04). The value is BUILT here rather than written down, so no new
  // identifier shape enters the tree: the country letters are a code ISO 13616
  // does not assign, the body is the committed fixture account's own body, and
  // the two check digits are found by asking the platform predicate rather
  // than by repeating its arithmetic.
  const unregistered = (body: string): string => {
    for (let candidate = 0; candidate < 100; candidate += 1) {
      const value = `ZZ${String(candidate).padStart(2, "0")}${body}`;
      if (accountNumberChecksumHolds(value)) {
        return value;
      }
    }
    throw new Error("no check digits satisfy the checksum for this body");
  };

  test("an account of a country the registry does not carry is REDACTED when the checksum holds", () => {
    const body = IDENTITY_FIXTURE_ACCOUNTS.counterparty1.slice(4);
    const value = unregistered(body);
    expect(ACCOUNT_NUMBER_LENGTH_BY_COUNTRY.has("ZZ")).toBe(false);
    expect(accountNumberChecksumHolds(value)).toBe(true);
    const masked = maskAccountNumbers(value);
    expect(masked).toBe(`${value.slice(0, 4)} **** ${value.slice(-4)}`);
    expect(masked).not.toContain(value);
    // ...and inside a sentence, where the scan must not swallow the next word.
    expect(maskAccountNumbers(`NAAR ${value} DEMO COUNTERPARTY`)).toBe(
      `NAAR ${value.slice(0, 4)} **** ${value.slice(-4)} DEMO COUNTERPARTY`,
    );
  });

  // ROUND TWO, FINDING HZ2-M3P13-02. THE FALLBACK MUST CONSUME THE WHOLE
  // TOKEN OR NOTHING. Round one's fail-closed branch looped from the
  // registry's longest length down to its shortest and took the first run
  // whose checksum held, and runOfLength crosses separators, so on
  // space-separated text SEVERAL lengths reached a legal end and each got a
  // one-in-ninety-seven draw, longest first. Measured over 40,000
  // constructed reference-shaped descriptors before the fix: 2,035 masked
  // with no account present, 428 of those with a following word eaten into
  // the mask, output of the shape "MANDAAT ZZnn **** OORD". That is the
  // greediness this file's own header says it was rewritten to avoid, and it
  // is visible to the reader as silently deleted text.
  test("the unregistered-country fallback never eats a following word", () => {
    const swallowed: string[] = [];
    let masked = 0;
    for (let seed = 0; seed < 4000; seed += 1) {
      const body =
        String(seed).padStart(4, "0") +
        "1234" +
        String(seed % 10000).padStart(4, "0") +
        "5678" +
        String((seed * 7) % 10000).padStart(4, "0");
      const groups = body.match(/.{4}/g) ?? [];
      const text = `MANDAAT ZZ${String(seed % 100).padStart(2, "0")} ${groups.join(" ")} DEMO WOORD`;
      const out = maskAccountNumbers(text);
      if (out !== text) {
        masked += 1;
        if (!out.includes("DEMO") || !out.includes("WOORD")) {
          swallowed.push(out);
        }
      }
    }
    expect(
      swallowed.slice(0, 3),
      `${swallowed.length} of ${masked} masked descriptors ate a following word`,
    ).toEqual([]);
  });

  test("the swallow rule holds on the UNREGISTERED path too, not only the known-country one", () => {
    const body = IDENTITY_FIXTURE_ACCOUNTS.counterparty1.slice(4);
    const value = unregistered(body);
    expect(maskAccountNumbers(`NAAR ${value} DEMO WOORD`)).toBe(
      `NAAR ${value.slice(0, 4)} **** ${value.slice(-4)} DEMO WOORD`,
    );
    // A token one character longer than a real one is not an account of any
    // registry length that also checks out, so it is left whole rather than
    // partly eaten.
    const longer = `${value}7`;
    expect(maskAccountNumbers(`NAAR ${longer} DEMO WOORD`)).toContain("DEMO WOORD");
  });

  // THE TWO COSTS OF THE ROUND-TWO RULES, PINNED RATHER THAN ONLY WRITTEN
  // DOWN, so a later reader meets them as checked facts and a later change
  // that alters either one is red rather than silent.
  test("an unregistered-country account written in SPACE-separated groups is not redacted, which is what buys the no-swallowing guarantee", () => {
    const body = IDENTITY_FIXTURE_ACCOUNTS.counterparty1.slice(4);
    const value = unregistered(body);
    const spaced = value.replace(/(.{4})(?=.)/g, "$1 ");
    expect(maskAccountNumbers(spaced)).toBe(spaced);
    // ...while the same account grouped with a NON-whitespace separator, or
    // written compactly, is redacted. Words are separated by spaces and
    // identifiers are not, which is the whole of the distinction.
    const hyphenated = value.replace(/(.{4})(?=.)/g, "$1-");
    expect(maskAccountNumbers(hyphenated)).toBe(
      `${value.slice(0, 4)} **** ${value.slice(-4)}`,
    );
    expect(maskAccountNumbers(value)).toBe(
      `${value.slice(0, 4)} **** ${value.slice(-4)}`,
    );
  });

  test("an account GLUED to a preceding word is not redacted, because the scan anchors on a word boundary", () => {
    const compact = IDENTITY_FIXTURE_ACCOUNTS.counterparty1;
    expect(maskAccountNumbers(`NAAR${compact}`)).toBe(`NAAR${compact}`);
    // The same account with a boundary in front of it IS redacted, so this
    // is about the anchor and not about the mask being inert.
    expect(maskAccountNumbers(`NAAR ${compact}`)).toBe(
      `NAAR ${compact.slice(0, 4)} **** ${compact.slice(-4)}`,
    );
  });

  // ROUND TWO, FINDING CR2-M3P13-03. The ISO 11649 structured creditor
  // reference is RF, two check digits and an alphanumeric body, and its check
  // is the SAME mod-97 over the same rearrangement, so it satisfies the
  // fallback's grammar and its arithmetic by construction. It is excluded by
  // name.
  test("an ISO 11649 creditor reference is left alone, because it shares this checksum by construction", () => {
    const rfWithLength = (length: number): string => {
      const body = "1234567890".repeat(4).slice(0, length - 4);
      for (let candidate = 0; candidate < 100; candidate += 1) {
        const value = `RF${String(candidate).padStart(2, "0")}${body}`;
        if (accountNumberChecksumHolds(value)) {
          return value;
        }
      }
      throw new Error("no check digits satisfy the checksum for this body");
    };
    for (const length of [16, 20, 24]) {
      const reference = rfWithLength(length);
      expect(accountNumberChecksumHolds(reference)).toBe(true);
      expect(
        maskAccountNumbers(`MEDEDELING ${reference} DEMO`),
        `an RF reference of length ${length} was redacted`,
      ).toBe(`MEDEDELING ${reference} DEMO`);
    }
  });

  test("an unregistered-country token whose checksum does NOT hold is left alone, so the fallback is a grammar test and not a shape test", () => {
    const body = IDENTITY_FIXTURE_ACCOUNTS.counterparty1.slice(4);
    const valid = unregistered(body);
    // Move the check digits off by one: same shape, same length, broken
    // checksum.
    const digits = Number(valid.slice(2, 4));
    const broken = `ZZ${String((digits + 1) % 100).padStart(2, "0")}${body}`;
    expect(accountNumberChecksumHolds(broken)).toBe(false);
    expect(maskAccountNumbers(broken)).toBe(broken);
    // A long run of digits with no country grammar at all is untouched, which
    // is what keeps a mandate reference and a phone number readable.
    expect(maskAccountNumbers("REFERTE 9000000101 20260302")).toBe(
      "REFERTE 9000000101 20260302",
    );
  });

  // THE SEPARATOR TABLE (fix round, finding HZ-M3P13-01). The mask used to
  // tolerate the ASCII space and NOTHING else, so an account grouped with any
  // other separator broke the run, fell short of the registry length and was
  // COPIED THROUGH IN FULL. That is the failure direction that costs: an
  // unrecognised rendering is printed rather than redacted.
  //
  // U+00A0 is not hypothetical in this project. It is the single byte 0xA0 in
  // Windows-1252, one of exactly two encodings the importer accepts
  // (src/modules/import/domain/source-profile.ts), and this repository has
  // already witnessed it live inside stored account renderings (M3-P18
  // finding HZ-M3P18-01, recorded at src/platform/account-number.ts).
  //
  // The table is a CLASS witness, not one member: it reddens under a
  // no-break space, a narrow no-break space, a thin space, a tab, a newline,
  // a full stop and a hyphen, which are structurally different members
  // (three invisible spaces, two control-ish whitespace characters and two
  // punctuation marks).
  test.each([
    ["no-break space U+00A0", "\u00a0"],
    ["narrow no-break space U+202F", "\u202f"],
    ["thin space U+2002", "\u2002"],
    ["tab U+0009", "\t"],
    ["newline U+000A", "\n"],
    ["full stop", "."],
    ["hyphen", "-"],
    ["ASCII space U+0020", " "],
    ["form feed U+000C", "\f"],
  ])(
    "an account grouped with %s is redacted, not printed",
    (_name, separator) => {
      const compact = IDENTITY_FIXTURE_ACCOUNTS.counterparty1;
      const expected = `${compact.slice(0, 4)} **** ${compact.slice(-4)}`;
      const rendered = compact.replace(/(.{4})(?=.)/g, `$1${separator}`);
      expect(maskAccountNumbers(rendered)).toBe(expected);
      expect(
        maskAccountNumbers(`OVERSCHRIJVING NAAR ${rendered} DEMO COUNTERPARTY`),
      ).toBe(`OVERSCHRIJVING NAAR ${expected} DEMO COUNTERPARTY`);
    },
  );

  // ROUND TWO, FINDING HZ2-M3P13-01. THE SEPARATOR RULE MUST CLOSE, NOT
  // ENUMERATE. Round one replaced one literal with a set, which fixed the
  // members it named and left every member nobody had thought of returning
  // the account VERBATIM. These are the shapes the lane measured at 2a0cc03,
  // and the point of the table is that the rule below it is stated as "any
  // character that is not a letter or a digit" rather than as a list, so a
  // character nobody has thought of is covered too.
  test.each([
    ["zero-width space U+200B", "​"],
    ["word joiner U+2060", "⁠"],
    ["soft hyphen U+00AD", "­"],
    ["en dash U+2013", "–"],
    ["underscore", "_"],
    ["solidus", "/"],
    ["comma", ","],
    ["middle dot U+00B7", "·"],
  ])(
    "an account grouped with %s is redacted, not printed",
    (_name, separator) => {
      const compact = IDENTITY_FIXTURE_ACCOUNTS.counterparty1;
      const expected = `${compact.slice(0, 4)} **** ${compact.slice(-4)}`;
      const rendered = compact.replace(/(.{4})(?=.)/g, `$1${separator}`);
      expect(maskAccountNumbers(rendered)).toBe(expected);
    },
  );

  test("a separator between the country code and the check digits does not defeat the mask", () => {
    const compact = IDENTITY_FIXTURE_ACCOUNTS.counterparty1;
    const expected = `${compact.slice(0, 4)} **** ${compact.slice(-4)}`;
    expect(maskAccountNumbers(`${compact.slice(0, 2)} ${compact.slice(2)}`)).toBe(
      expected,
    );
  });

  // THE BOUND, AND IT IS THE OTHER HALF OF CLOSING THE RULE. Once ANY
  // non-alphanumeric character separates run characters, an unbounded run of
  // them would let the scan cross arbitrary punctuation between unrelated
  // tokens. Whitespace stays unbounded, because a doubled space is a real
  // rendering this mask already handled and unmasking it would be a new
  // fail-open; at most ONE non-whitespace separator is crossed per gap.
  test("a doubled WHITESPACE separator still masks, because unmasking it would be a new leak", () => {
    const compact = IDENTITY_FIXTURE_ACCOUNTS.counterparty1;
    const expected = `${compact.slice(0, 4)} **** ${compact.slice(-4)}`;
    expect(maskAccountNumbers(compact.replace(/(.{4})(?=.)/g, "$1  "))).toBe(
      expected,
    );
  });

  test("two non-whitespace separators in one gap are NOT crossed, so the scan cannot walk across punctuation between unrelated tokens", () => {
    const compact = IDENTITY_FIXTURE_ACCOUNTS.counterparty1;
    const glued = `${compact.slice(0, 8)}--${compact.slice(8)}`;
    expect(maskAccountNumbers(glued)).toBe(glued);
  });

  test("the separator set the mask accepts is the set the canonical form removes, plus the two the card mask already tolerates", () => {
    // ONE ANSWER, NOT TWO (finding HZ-M3P13-01). This file used to hold a
    // separator rule of its own while importing canonicalAccountNumber, whose
    // \s strips every whitespace character including all three no-break
    // spaces, so the file gave two different answers to what separates an
    // account number. Derived rather than asserted from memory: every
    // character the canonical form removes must also be a separator the mask
    // tolerates.
    const compact = IDENTITY_FIXTURE_ACCOUNTS.counterparty1;
    const expected = `${compact.slice(0, 4)} **** ${compact.slice(-4)}`;
    const whitespace = [
      "\u0009", "\u000a", "\u000b", "\u000c", "\u000d", "\u0020",
      "\u00a0", "\u1680", "\u2000", "\u2001", "\u2002", "\u2003",
      "\u2004", "\u2005", "\u2006", "\u2007", "\u2008", "\u2009",
      "\u200a", "\u2028", "\u2029", "\u202f", "\u205f", "\u3000",
      "\ufeff",
    ];
    for (const character of whitespace) {
      expect(
        canonicalAccountNumber(`X${character}Y`),
        `canonicalAccountNumber does not remove ${character.codePointAt(0)}`,
      ).toBe("XY");
      expect(
        maskAccountNumbers(compact.replace(/(.{4})(?=.)/g, `$1${character}`)),
        `the mask does not tolerate ${character.codePointAt(0)}`,
      ).toBe(expected);
    }
  });

  test("a separator at the start or the end of the run does not extend it, so the mask cannot swallow a neighbouring word", () => {
    const compact = IDENTITY_FIXTURE_ACCOUNTS.counterparty1;
    // A run that would need a leading separator is not an account number: the
    // country code and the check digits are the first four characters.
    expect(maskAccountNumbers(`BE 78 DEMO`)).toBe("BE 78 DEMO");
    // The token immediately followed by another alphanumeric is refused, so
    // a longer identifier is never partially redacted.
    expect(maskAccountNumbers(`${compact}9`)).toBe(`${compact}9`);
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

// THE REACH SENTENCE MAY NOT NAME A PERIOD (fix round, finding HZ-M3P13-03).
// The read behind it is HOUSEHOLD-WIDE: listCountedTransactions filters on
// householdId and flow and carries no date bound, listMerchantReview takes no
// period and the route passes no month. The first version of this copy said
// "of this month" in all three languages, which was true only of a household
// with a single imported month and UNDERSTATED what the reader was about to
// do, because assignMerchant's recompute carries the rule to every past
// matching transaction. This assertion is what stops the claim coming back.
describe("the reach copy states no period, because the read it renders has none", () => {
  const MONTH_TOKENS = [
    "this month", "month", "months",
    "deze maand", "maand", "maanden",
    "ce mois", "mois",
  ];
  test.each(["en", "nl", "fr"])(
    "the %s reach string names no period",
    (locale) => {
      const catalogue = JSON.parse(
        readFileSync(
          join(__dirname, "..", "..", "messages", `${locale}.json`),
          "utf8",
        ),
      ) as Readonly<Record<string, string>>;
      const reach = catalogue["groupReach"];
      expect(reach, `${locale} has no groupReach`).toBeDefined();
      for (const token of MONTH_TOKENS) {
        expect(
          (reach ?? "").toLowerCase(),
          `the ${locale} reach string names the period "${token}", which the read behind it does not carry`,
        ).not.toContain(token);
      }
      // NOT VACUOUS: the string is the plural form the screen renders and it
      // still carries the count placeholder, so this is a test about a live
      // sentence rather than about an absent key.
      expect(reach).toContain("{count, plural,");
    },
  );
});
