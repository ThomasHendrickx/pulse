import { plainDate } from "@/platform/plain-date";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { statementParser } from "../../src/modules/import/adapters/statement-parser";
import type { ParsedRow } from "../../src/modules/import/domain/parse-statement";
import {
  ACCOUNT_NAMESPACE,
  DESCRIPTOR_NAMESPACE,
  IBAN_LENGTH_BY_COUNTRY,
  compactAccount,
  counterpartyIdentity,
  identityBasisOfKey,
  isBareIdentityKey,
  isTrustedCounterpartyAccount,
} from "../../src/modules/merchants/domain/counterparty-identity";
import { matchRules } from "../../src/modules/merchants/domain/merchant-rule";
import { buildMerchantReview } from "../../src/modules/merchants/domain/merchant-review";
import { cents } from "../../src/platform/money";
import {
  counterpartyText,
  normaliseCounterparty,
} from "../../src/modules/merchants/domain/normalise-counterparty";
import {
  IDENTITY_FIXTURE_ACCOUNTS,
  IDENTITY_FIXTURE_LONG_SOURCES,
  IDENTITY_FIXTURE_ROW_TO_COUNTERPARTY,
  IDENTITY_FIXTURE_TWO_TOKEN,
  buildFixtureRecords,
  buildPdfFixtures,
} from "../fixtures/generate-pdf-fixtures";

const repositoryRoot = join(__dirname, "..", "..");

const FIXTURE = "belfius-counterparty-identity.pdf";

const fixturePath = (name: string): string =>
  join(__dirname, "..", "fixtures", name);

const fixtureBytes = (name: string): Uint8Array =>
  new Uint8Array(readFileSync(fixturePath(name)));

const parseFixture = async (name: string): Promise<readonly ParsedRow[]> => {
  const bytes = fixtureBytes(name);
  const detected = await statementParser.detect(bytes);
  expect(detected.ok, name).toBe(true);
  if (!detected.ok) {
    throw new Error("unreachable");
  }
  const parsed = await statementParser.parse(bytes, detected.value);
  expect(parsed.ok, name).toBe(true);
  if (!parsed.ok) {
    throw new Error("unreachable");
  }
  return parsed.value.rows;
};

const identityOf = (row: ParsedRow) =>
  counterpartyIdentity({
    description: row.description,
    ...(row.counterpartyName === undefined
      ? {}
      : { counterpartyName: row.counterpartyName }),
    ...(row.counterpartyIban === undefined
      ? {}
      : { counterpartyAccount: row.counterpartyIban }),
  });

const baselineOf = (row: ParsedRow): string =>
  normaliseCounterparty(counterpartyText(row));

describe("CRITERION 12.1: convergence, counted", () => {
  test("24 rows over 12 invented counterparties produce exactly 12 identity keys, against a baseline of exactly 24", async () => {
    const rows = await parseFixture(FIXTURE);
    const identityKeys = new Set(rows.map((row) => identityOf(row).key));
    const baselineKeys = new Set(rows.map(baselineOf));
    console.log(
      `fixture rows ${rows.length}, identity keys ${identityKeys.size}, baseline keys ${baselineKeys.size}`,
    );
    expect(rows).toHaveLength(24);
    expect(identityKeys.size).toBe(12);
    // A BASELINE BELOW 24 WOULD MEAN THE FIXTURE IS ALREADY PARTLY
    // CONVERGED, and the proof would be measuring the fixture's convenience
    // rather than the change. The owner's real month shows TOTAL
    // non-convergence on its account-carrying rows, and this asserts the
    // fixture reproduces that rather than a softer version of it.
    expect(baselineKeys.size).toBe(24);
  });

  test("neither basis carries the proof alone", async () => {
    const rows = await parseFixture(FIXTURE);
    const identities = rows.map(identityOf);
    const accountRows = identities.filter(
      (identity) => identity.basis === "account",
    );
    const descriptorRows = identities.filter(
      (identity) => identity.basis === "descriptor",
    );
    const distinctAccounts = new Set(accountRows.map((i) => i.key));
    console.log(
      `account-basis rows ${accountRows.length} over ${distinctAccounts.size} accounts, descriptor-basis rows ${descriptorRows.length}`,
    );
    expect(accountRows.length).toBeGreaterThanOrEqual(8);
    expect(distinctAccounts.size).toBeGreaterThanOrEqual(4);
    expect(descriptorRows.length).toBeGreaterThanOrEqual(8);
  });
});

describe("CRITERION 12.4: different counterparties stay different where the stored values differ", () => {
  test("no two rows on different trusted accounts share a key, and no account key equals a descriptor key", async () => {
    const rows = await parseFixture(FIXTURE);
    const identities = rows.map(identityOf);
    const accountByKey = new Map<string, string>();
    for (const [index, identity] of identities.entries()) {
      if (identity.basis !== "account") {
        continue;
      }
      const account = compactAccount(rows[index]?.counterpartyIban ?? "");
      const seen = accountByKey.get(identity.key);
      if (seen === undefined) {
        accountByKey.set(identity.key, account);
      } else {
        expect(seen, `row ${index + 1}`).toBe(account);
      }
    }
    // The map is injective in both directions: one key per account, one
    // account per key.
    expect(new Set(accountByKey.values()).size).toBe(accountByKey.size);

    const accountKeys = new Set(
      identities.filter((i) => i.basis === "account").map((i) => i.key),
    );
    const descriptorKeys = new Set(
      identities.filter((i) => i.basis === "descriptor").map((i) => i.key),
    );
    for (const key of accountKeys) {
      expect(descriptorKeys.has(key)).toBe(false);
    }
  });

  test("the 12 keys partition the 24 rows exactly as the GENERATOR'S OWN INPUT RECORD says, row by row", async () => {
    const rows = await parseFixture(FIXTURE);
    // The oracle is the generator's INPUT: which invented counterparty each
    // row was WRITTEN FOR. It is not read back out of counterpartyIdentity,
    // so this comparison cannot certify the derivation against itself
    // (hazard H12.17).
    const expected = IDENTITY_FIXTURE_ROW_TO_COUNTERPARTY;
    expect(expected).toHaveLength(rows.length);

    const keyByCounterparty = new Map<number, string>();
    const counterpartyByKey = new Map<string, number>();
    for (const entry of expected) {
      const row = rows[entry.row - 1];
      expect(row, `row ${entry.row}`).toBeDefined();
      if (row === undefined) {
        continue;
      }
      const key = identityOf(row).key;
      const boundKey = keyByCounterparty.get(entry.counterparty);
      if (boundKey === undefined) {
        keyByCounterparty.set(entry.counterparty, key);
      } else {
        // A row that drifted OUT of its counterparty's group.
        expect(key, `row ${entry.row}`).toBe(boundKey);
      }
      const boundCounterparty = counterpartyByKey.get(key);
      if (boundCounterparty === undefined) {
        counterpartyByKey.set(key, entry.counterparty);
      } else {
        // A row that MERGED with another counterparty's group. This is the
        // failure that a count of 12 would still hide.
        expect(boundCounterparty, `row ${entry.row}`).toBe(entry.counterparty);
      }
    }
    expect(keyByCounterparty.size).toBe(12);
    expect(counterpartyByKey.size).toBe(12);
  });

  test("regenerating the fixture reproduces the PDF and the record byte for byte, so the record cannot have been hand-edited", () => {
    for (const [name, bytes] of [...buildPdfFixtures(), ...buildFixtureRecords()]) {
      const committed = new Uint8Array(readFileSync(fixturePath(name)));
      expect(committed, name).toEqual(bytes);
    }
  });
});

describe("CRITERION 12.5: this phase strips nothing new", () => {
  test("normaliseCounterparty never emits a lowercase letter, so no descriptor key can begin with either namespace", async () => {
    const names = [
      "belfius-counterparty-identity.pdf",
      "belfius-statement-a.pdf",
      "belfius-statement-b-overlap.pdf",
      "belfius-inline-shapes.pdf",
      "kbc-statement-a.pdf",
      "kbc-statement-refund.pdf",
    ];
    const samples: string[] = [];
    for (const name of names) {
      for (const row of await parseFixture(name)) {
        samples.push(baselineOf(row));
      }
    }
    // Invented lowercase inputs beside the real corpus, so the property is
    // exercised where it could fail rather than only where it does not.
    samples.push(
      normaliseCounterparty("account:something"),
      normaliseCounterparty("descriptor:something"),
      normaliseCounterparty("mixed Case demo tekst"),
    );
    expect(samples.length).toBeGreaterThan(0);
    for (const sample of samples) {
      expect(/[a-z]/.test(sample), sample.slice(0, 0)).toBe(false);
      expect(sample.startsWith(ACCOUNT_NAMESPACE)).toBe(false);
      expect(sample.startsWith(DESCRIPTOR_NAMESPACE)).toBe(false);
    }
  });

  test("every descriptor-basis key's suffix is byte-identical to the baseline key for that row, over every parsable committed fixture", async () => {
    // THE PIN WAS GENERATED AT THE BASELINE COMMIT (7f4aafb), by running
    // that commit's own normaliser over every parsable committed fixture,
    // and copied here unchanged. It is therefore a record of what the key
    // WAS, not a record of what this branch produces.
    const table = JSON.parse(
      readFileSync(fixturePath("baseline-descriptor-keys.json"), "utf8"),
    ) as Record<string, readonly string[]>;
    const names = Object.keys(table).sort();
    expect(names.length).toBeGreaterThan(0);
    for (const name of names) {
      const rows = await parseFixture(name);
      const expected = table[name];
      expect(expected, name).toBeDefined();
      expect(rows.length, name).toBe(expected?.length);
      for (const [index, row] of rows.entries()) {
        const identity = identityOf(row);
        const pinned = expected?.[index];
        expect(pinned, `${name} row ${index + 1}`).toBeTypeOf("string");
        if (identity.basis !== "descriptor") {
          // A row on the account basis has no descriptor key to compare.
          // The pin still carries its baseline key, so the table stays
          // row-aligned and a reordering of rows reddens rather than slips.
          continue;
        }
        expect(identity.key.slice(DESCRIPTOR_NAMESPACE.length), `${name} row ${index + 1}`).toBe(
          pinned,
        );
        // And it equals what THIS branch's normaliser produces, so the pin
        // reddens on a recipe change rather than only on a namespace change.
        expect(identity.key.slice(DESCRIPTOR_NAMESPACE.length)).toBe(
          baselineOf(row),
        );
      }
    }
  });
});

describe("CRITERION 12.6: a row matching no family is not guessed at", () => {
  test("a row with no account whose descriptor the card predicate does not recognise keeps exactly its baseline key", () => {
    const row = { description: "BIJDRAGE DEMO VERENIGING JAARLIJKS" };
    const identity = counterpartyIdentity(row);
    expect(identity.basis).toBe("descriptor");
    expect(identity.key).toBe(
      `${DESCRIPTOR_NAMESPACE}${normaliseCounterparty(counterpartyText(row))}`,
    );
    expect(identity.key.slice(DESCRIPTOR_NAMESPACE.length)).toBe(
      normaliseCounterparty("BIJDRAGE DEMO VERENIGING JAARLIJKS"),
    );
  });

  test("an empty or whitespace-only stored account takes the descriptor basis rather than an account key", () => {
    for (const account of ["", " ", "\t", "   \n  "]) {
      const identity = counterpartyIdentity({
        description: "KOSTEN DEMO REKENINGPAKKET",
        counterpartyAccount: account,
      });
      expect(identity.basis).toBe("descriptor");
      expect(identity.key).not.toBe(ACCOUNT_NAMESPACE);
      expect(identity.key.startsWith(ACCOUNT_NAMESPACE)).toBe(false);
    }
  });

  // FIX ROUND, finding HZ-M3P12-01. The test above used to be NAMED "so no
  // row is ever keyed on a bare namespace" and asserted only the account
  // side, which is exactly how the descriptor side shipped open. The name is
  // now what it asserts, and the sentence it used to claim is asserted here,
  // on the side that can actually produce a bare key.
  describe("THE BARE NAMESPACE IS NOT AN IDENTITY (fix round, HZ-M3P12-01)", () => {
    const EMPTY_TEXTS = ["", "   ", "\t", "  \n "];

    test("the descriptor branch CAN emit a bare namespace, which is why the floor is needed and not hypothetical", () => {
      for (const description of EMPTY_TEXTS) {
        const identity = counterpartyIdentity({ description });
        expect(normaliseCounterparty(description)).toBe("");
        expect(identity.key).toBe(DESCRIPTOR_NAMESPACE);
        expect(isBareIdentityKey(identity.key)).toBe(true);
      }
      // And a key with anything after the namespace is NOT bare, so the
      // predicate is a floor rather than a blanket refusal.
      expect(
        isBareIdentityKey(counterpartyIdentity({ description: "DEMO ALFA" }).key),
      ).toBe(false);
      expect(isBareIdentityKey("KOSTEN DEMO REKENINGPAKKET")).toBe(false);
    });

    test("THE MATCHER refuses a bare key, so two rows carrying no counterparty text can never resolve to one merchant", () => {
      const rule = {
        id: "r1",
        merchantId: "m1",
        kind: "EXACT" as const,
        pattern: DESCRIPTOR_NAMESPACE,
      };
      for (const description of EMPTY_TEXTS) {
        const key = counterpartyIdentity({ description }).key;
        expect(matchRules(key, [rule])).toBeUndefined();
      }
    });

    test("THE MATCHER refuses a bare PATTERN, which would otherwise sweep every key of that basis onto one merchant (H12.26)", () => {
      const ordinary = counterpartyIdentity({
        description: "BIJDRAGE DEMO VERENIGING JAARLIJKS",
      }).key;
      const account = counterpartyIdentity({
        description: "DEMO",
        counterpartyAccount: IDENTITY_FIXTURE_ACCOUNTS.counterparty1,
      }).key;
      expect(account.startsWith(ACCOUNT_NAMESPACE)).toBe(true);
      for (const kind of ["PREFIX", "PATTERN", "EXACT"] as const) {
        const sweeper = {
          id: "r2",
          merchantId: "m2",
          kind,
          pattern: kind === "PATTERN" ? `${DESCRIPTOR_NAMESPACE}*` : DESCRIPTOR_NAMESPACE,
        };
        // The glob form is not bare and is refused by D-40 only for account
        // keys, so it is asserted separately below; the bare forms are
        // refused outright.
        if (kind !== "PATTERN") {
          expect(matchRules(ordinary, [sweeper])).toBeUndefined();
        }
        expect(
          matchRules(account, [{ ...sweeper, pattern: ACCOUNT_NAMESPACE }]),
        ).toBeUndefined();
      }
    });

    test("THE REVIEW SURFACE offers no naming form for a bare-namespace group, so the group is shown and counted but cannot be named", () => {
      const rows = [
        {
          id: "t1",
          flow: "SPEND" as const,
          amountCents: cents(-1234),
          bookingDate: plainDate("2026-03-02"),
          description: "",
        },
        {
          id: "t2",
          flow: "SPEND" as const,
          amountCents: cents(-7543),
          bookingDate: plainDate("2026-03-03"),
          description: "   ",
        },
      ];
      const review = buildMerchantReview(rows, []);
      const bare = review.spend.filter(
        (group) => group.merchantId === undefined,
      );
      // They still group and their money is still counted, exactly as before
      // this phase: what changes is that the group carries no submittable
      // subject.
      expect(bare).toHaveLength(1);
      expect(bare[0]?.count).toBe(2);
      expect(bare[0]?.totalCents).toBe(cents(-8777));
      expect(bare[0]?.counterpartyText).toBeUndefined();
      // A group with real text keeps its form, so this is a floor and not a
      // screen that stopped offering namings.
      const named = buildMerchantReview(
        [{ ...rows[0]!, description: "BIJDRAGE DEMO VERENIGING JAARLIJKS" }],
        [],
      );
      expect(named.spend[0]?.counterpartyText).toBe(
        `${DESCRIPTOR_NAMESPACE}${normaliseCounterparty("BIJDRAGE DEMO VERENIGING JAARLIJKS")}`,
      );
    });
  });

  test("no truncation, no opening-prefix key and no fallback bucket: two rows share a descriptor key only when their full normalised descriptors are equal", () => {
    const a = counterpartyIdentity({ description: "DEMO ALFA BESTELLING EEN" });
    const b = counterpartyIdentity({ description: "DEMO ALFA BESTELLING TWEE" });
    const c = counterpartyIdentity({ description: "demo alfa bestelling een" });
    expect(a.key).not.toBe(b.key);
    expect(a.key).toBe(c.key);
    expect(a.key.slice(DESCRIPTOR_NAMESPACE.length)).toBe(
      normaliseCounterparty("DEMO ALFA BESTELLING EEN"),
    );
  });
});

describe("CRITERION 12.16: the account basis fails closed", () => {
  // WHOLLY INVENTED VALUES. The valid ones are the fixture's own accounts,
  // built by hand and listed with their provenance in
  // test/fixtures/allowed-identifiers.txt.
  const VALID = IDENTITY_FIXTURE_ACCOUNTS.counterparty1;

  test("a valid account is trusted, so the refusals below are refusals rather than a gate that refuses everything", () => {
    expect(isTrustedCounterpartyAccount(VALID)).toBe(true);
    expect(counterpartyIdentity({ description: "X", counterpartyAccount: VALID }).basis).toBe(
      "account",
    );
  });

  test("empty or whitespace after compaction yields a descriptor key", () => {
    for (const value of ["", "   ", "\t\n"]) {
      expect(isTrustedCounterpartyAccount(value)).toBe(false);
      expect(
        counterpartyIdentity({ description: "X", counterpartyAccount: value }).basis,
      ).toBe("descriptor");
    }
  });

  test("a country code the pinned table does not carry is REFUSED rather than admitted", () => {
    // ZZ is not an ISO 13616 participant and never will be: the two-letter
    // codes beginning ZZ are reserved for private use. Built from a listed
    // value rather than written out, so no unlisted identifier shape sits in
    // this file.
    const unknownCountry = `ZZ${VALID.slice(2)}`;
    expect(IBAN_LENGTH_BY_COUNTRY.has("ZZ")).toBe(false);
    expect(isTrustedCounterpartyAccount(unknownCountry)).toBe(false);
    expect(
      counterpartyIdentity({ description: "X", counterpartyAccount: unknownCountry })
        .basis,
    ).toBe("descriptor");
  });

  test("a length that differs from the table's entry for the country code is refused, in both directions", () => {
    const short = VALID.slice(0, VALID.length - 1);
    const long = `${VALID}7`;
    expect(short.length).not.toBe(IBAN_LENGTH_BY_COUNTRY.get("BE"));
    expect(long.length).not.toBe(IBAN_LENGTH_BY_COUNTRY.get("BE"));
    expect(isTrustedCounterpartyAccount(short)).toBe(false);
    expect(isTrustedCounterpartyAccount(long)).toBe(false);
  });

  test("a value failing the ISO 7064 mod-97 check is refused even at the right length and country", () => {
    // EVERY single-digit variation of the last position: same length, same
    // country code, wrong check digit. This is the residual mod-97 catches
    // that the length test alone does not, and sweeping all ten values means
    // the assertion does not rest on one lucky choice. Built from a listed
    // value rather than written out.
    let refused = 0;
    for (const digit of "0123456789") {
      const variant = `${VALID.slice(0, -1)}${digit}`;
      expect(variant.length).toBe(IBAN_LENGTH_BY_COUNTRY.get("BE"));
      if (variant === VALID) {
        expect(isTrustedCounterpartyAccount(variant)).toBe(true);
        continue;
      }
      expect(isTrustedCounterpartyAccount(variant)).toBe(false);
      refused += 1;
    }
    expect(refused).toBe(9);
  });

  test("THE TRUNCATION CASE, END TO END through the SHIPPED importer: the stored account is a strict PREFIX of the invented source, and the row takes the descriptor basis", async () => {
    const rows = await parseFixture(FIXTURE);
    const sourceA = IDENTITY_FIXTURE_LONG_SOURCES.spacedA.replace(/\s/g, "");
    const sourceB = IDENTITY_FIXTURE_LONG_SOURCES.spacedB.replace(/\s/g, "");
    const stored = IDENTITY_FIXTURE_LONG_SOURCES.storedPrefix;

    // The two rows the generator wrote them into, found by their stored
    // account rather than by ordinal, so the assertion survives a reorder.
    const truncated = rows.filter((row) => row.counterpartyIban === stored);
    expect(truncated).toHaveLength(2);

    // A STRICT prefix: shorter than the source, and the source starts with it.
    expect(stored.length).toBeLessThan(sourceA.length);
    expect(sourceA.startsWith(stored)).toBe(true);
    expect(sourceB.startsWith(stored)).toBe(true);
    // The two sources are genuinely different accounts that differ only
    // after the twelfth digit, which is why the scrape stores ONE value for
    // both. Without the trust gate they would be one counterparty.
    expect(sourceA).not.toBe(sourceB);
    expect(sourceA.slice(0, 16)).toBe(sourceB.slice(0, 16));
    expect(isTrustedCounterpartyAccount(sourceA)).toBe(true);
    expect(isTrustedCounterpartyAccount(sourceB)).toBe(true);
    expect(isTrustedCounterpartyAccount(stored)).toBe(false);

    // Both rows fall to the descriptor basis, and their keys DIFFER, so the
    // silent merge does not happen.
    const identities = truncated.map(identityOf);
    for (const identity of identities) {
      expect(identity.basis).toBe("descriptor");
    }
    expect(identities[0]?.key).not.toBe(identities[1]?.key);
  });

  test("THE TABLE CLOSES TRUNCATION OF A NON-BELGIAN SOURCE deterministically, because BE is the only entry of length 16", () => {
    // This is the half of the old claim that is TRUE and it is what the
    // fixture's truncation rows witness: a source whose registry length is
    // not sixteen truncates to a sixteen-character value whose country code
    // the table gives a different length, so the LENGTH test refuses it
    // every time rather than 96 times in 97.
    const sixteens = [...IBAN_LENGTH_BY_COUNTRY.entries()].filter(
      ([, length]) => length === 16,
    );
    expect(sixteens.map(([code]) => code)).toEqual(["BE"]);
    expect(IBAN_LENGTH_BY_COUNTRY.get("BE")).toBe(16);
  });

  // FIX ROUND, finding HZ-M3P12-05. The test above used to be named "THE
  // TABLE CLOSES TRUNCATION DETERMINISTICALLY" and asserted only that BE is
  // the sole sixteen-length entry, which does not establish the claim its
  // name made. Here is the counterexample, pinned, so the residual is a fact
  // a reader meets rather than a sentence they believe.
  test("THE RESIDUAL, PINNED: a BE-prefixed over-long SPACED token truncates to a TRUSTED value, so mod-97 alone stands in that direction", () => {
    // The shipped scrape, copied verbatim from the importer's template so
    // this test measures the real grammar and not a paraphrase of it.
    const DESCRIPTION_IBAN = /\b([A-Z]{2}\d{2}(?:\s?\d{4}){3})\b/g;
    const scrape = (description: string): string | undefined => {
      for (const match of description.matchAll(DESCRIPTION_IBAN)) {
        if (match[1] !== undefined) {
          return match[1].replace(/\s/g, "");
        }
      }
      return undefined;
    };
    // The fixture's own allow-listed Belgian account, spaced, with ONE EXTRA
    // four-digit group. Two sources differing ONLY in that extra group.
    const spaced = IDENTITY_FIXTURE_ACCOUNTS.counterparty1.replace(
      /^(.{4})(.{4})(.{4})(.{4})$/,
      "$1 $2 $3 $4",
    );
    const sourceA = `${spaced} 9001`;
    const sourceB = `${spaced} 9002`;
    const storedA = scrape(`OVERSCHRIJVING NAAR ${sourceA} DEMO`);
    const storedB = scrape(`OVERSCHRIJVING NAAR ${sourceB} DEMO`);

    // ONE stored value for TWO different sources...
    expect(storedA).toBeDefined();
    expect(storedA).toBe(storedB);
    expect(storedA).toHaveLength(16);
    // ...and the trust gate ADMITS it, because its country code is BE and
    // its length is BE's table length. This is the case the length test
    // cannot reach.
    expect(isTrustedCounterpartyAccount(storedA)).toBe(true);
    const identityA = counterpartyIdentity({
      description: `OVERSCHRIJVING NAAR ${sourceA} DEMO`,
      ...(storedA === undefined ? {} : { counterpartyAccount: storedA }),
    });
    const identityB = counterpartyIdentity({
      description: `OVERSCHRIJVING NAAR ${sourceB} DEMO`,
      ...(storedB === undefined ? {} : { counterpartyAccount: storedB }),
    });
    expect(identityA.basis).toBe("account");
    expect(identityA.key).toBe(identityB.key);

    // THE SOURCE SAYS SO. If someone rewrites the comment back to the
    // determinism claim, this reddens.
    const source = readFileSync(
      join(
        repositoryRoot,
        "src/modules/merchants/domain/counterparty-identity.ts",
      ),
      "utf8",
    );
    // The corrected statement, and the false one it replaced. Both are
    // asserted, so neither a silent revert nor a silent deletion passes.
    expect(source).toMatch(/mod-97 alone\n\/\/   stands there/);
    expect(source).toMatch(/WHY IT IS FALSE/);
    expect(source).not.toMatch(/closes\n\/\/ truncation DETERMINISTICALLY/);
  });

  test("FIRST-WINS IS PINNED, not incidental: the row carrying two account-shaped tokens keys on the one the generator wrote FIRST", async () => {
    const rows = await parseFixture(FIXTURE);
    const row = rows[IDENTITY_FIXTURE_TWO_TOKEN.rowOrdinal - 1];
    expect(row).toBeDefined();
    if (row === undefined) {
      return;
    }
    const first = IDENTITY_FIXTURE_TWO_TOKEN.firstTokenSpaced.replace(/\s/g, "");
    const second = IDENTITY_FIXTURE_TWO_TOKEN.secondTokenSpaced.replace(/\s/g, "");
    expect(first).not.toBe(second);
    // Both are valid accounts, so the choice between them is the IMPORTER'S
    // and not the trust gate's.
    expect(isTrustedCounterpartyAccount(first)).toBe(true);
    expect(isTrustedCounterpartyAccount(second)).toBe(true);
    expect(row.counterpartyIban).toBe(first);
    expect(identityOf(row).key).toBe(`${ACCOUNT_NAMESPACE}${first}`);
    // THE PARKED ITEM THAT OWNS THE QUESTION: hazard H12.16, carried on the
    // plan's parked surface. Choosing between two account-shaped candidates
    // is an IMPORTER decision about a fact column, so answering it is a
    // template version bump and a re-parse rather than a derivation change.
    // A later move from first-wins to last-wins or longest-wins is RED here
    // before it silently moves rows of the owner's real month.
  });
});

describe("CRITERION 12.22: the trust table is pinned and sourced", () => {
  test("the FULL contents are pinned, so adding, removing or altering an entry is red rather than silent", () => {
    const pinned: readonly (readonly [string, number])[] = [
      ["AD", 24], ["AE", 23], ["AL", 28], ["AT", 20], ["AZ", 28],
      ["BA", 20], ["BE", 16], ["BG", 22], ["BH", 22], ["BI", 27],
      ["BR", 29], ["BY", 28], ["CH", 21], ["CR", 22], ["CY", 28],
      ["CZ", 24], ["DE", 22], ["DJ", 27], ["DK", 18], ["DO", 28],
      ["EE", 20], ["EG", 29], ["ES", 24], ["FI", 18], ["FK", 18],
      ["FO", 18], ["FR", 27], ["GB", 22], ["GE", 22], ["GI", 23],
      ["GL", 18], ["GR", 27], ["GT", 28], ["HN", 28], ["HR", 21],
      ["HU", 28], ["IE", 22], ["IL", 23], ["IQ", 23], ["IS", 26],
      ["IT", 27], ["JO", 30], ["KW", 30], ["KZ", 20], ["LB", 28],
      ["LC", 32], ["LI", 21], ["LT", 20], ["LU", 20], ["LV", 21],
      ["LY", 25], ["MC", 27], ["MD", 24], ["ME", 22], ["MK", 19],
      ["MN", 20], ["MR", 27], ["MT", 31], ["MU", 30], ["NI", 28],
      ["NL", 18], ["NO", 15], ["OM", 23], ["PK", 24], ["PL", 28],
      ["PS", 29], ["PT", 25], ["QA", 29], ["RO", 24], ["RS", 22],
      ["RU", 33], ["SA", 24], ["SC", 31], ["SD", 18], ["SE", 24],
      ["SI", 19], ["SK", 24], ["SM", 27], ["SO", 23], ["ST", 25],
      ["SV", 28], ["TL", 23], ["TN", 24], ["TR", 26], ["UA", 29],
      ["VA", 22], ["VG", 24], ["XK", 20], ["YE", 30],
    ];
    expect([...IBAN_LENGTH_BY_COUNTRY.entries()]).toEqual(pinned);
    expect(IBAN_LENGTH_BY_COUNTRY.size).toBe(pinned.length);
  });

  test("the entry for the country of the committed fixtures resolves to the length those fixtures use, so a wrong entry fails the FAST gate", () => {
    const accounts = Object.values(IDENTITY_FIXTURE_ACCOUNTS);
    expect(accounts.length).toBeGreaterThan(0);
    for (const account of accounts) {
      expect(account.slice(0, 2)).toBe("BE");
      expect(account.length).toBe(IBAN_LENGTH_BY_COUNTRY.get("BE"));
      expect(isTrustedCounterpartyAccount(account)).toBe(true);
    }
  });
});

describe("the identity key's namespace is what says which basis it has", () => {
  test("identityBasisOfKey reads the namespace and refuses anything else", () => {
    expect(identityBasisOfKey(`${ACCOUNT_NAMESPACE}BE31111122223333`)).toBe(
      "account",
    );
    expect(identityBasisOfKey(`${DESCRIPTOR_NAMESPACE}DEMO`)).toBe("descriptor");
    expect(identityBasisOfKey("DEMO")).toBeUndefined();
    expect(identityBasisOfKey("")).toBeUndefined();
    expect(identityBasisOfKey("ACCOUNT:BE31111122223333")).toBeUndefined();
  });
});
