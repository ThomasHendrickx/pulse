import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import {
  ACCOUNT_NAMESPACE,
  DESCRIPTOR_NAMESPACE,
} from "../../src/modules/merchants/domain/counterparty-identity";
import {
  matchRules,
  type MerchantRuleKind,
  type MerchantRuleLike,
} from "../../src/modules/merchants/domain/merchant-rule";

const repositoryRoot = join(__dirname, "..", "..");
const read = (relative: string): string =>
  readFileSync(join(repositoryRoot, relative), "utf8");

const rule = (
  id: string,
  merchantId: string,
  kind: MerchantRuleKind,
  pattern: string,
): MerchantRuleLike => ({ id, merchantId, kind, pattern });

describe("CRITERION 12.10: PREFIX and PATTERN are settled", () => {
  test("a PREFIX rule whose pattern is a proper prefix of an ACCOUNT-basis key returns undefined", () => {
    const key = `${ACCOUNT_NAMESPACE}BE31111122223333`;
    // A prefix of an account number is a DIFFERENT account, and matching it
    // would merge two counterparties.
    expect(
      matchRules(key, [rule("r1", "m1", "PREFIX", `${ACCOUNT_NAMESPACE}BE31`)]),
    ).toBeUndefined();
  });

  test("a PATTERN rule whose glob matches an account-basis key returns undefined", () => {
    const key = `${ACCOUNT_NAMESPACE}BE31111122223333`;
    expect(
      matchRules(key, [rule("r1", "m1", "PATTERN", `${ACCOUNT_NAMESPACE}*`)]),
    ).toBeUndefined();
  });

  test("both kinds still match a DESCRIPTOR-basis key exactly as they do today", () => {
    const key = `${DESCRIPTOR_NAMESPACE}BOEKHANDEL ZILVERBLAD BE`;
    expect(
      matchRules(key, [
        rule("r1", "m1", "PREFIX", `${DESCRIPTOR_NAMESPACE}BOEKHANDEL`),
      ])?.merchantId,
    ).toBe("m1");
    expect(
      matchRules(key, [
        rule("r2", "m2", "PATTERN", `${DESCRIPTOR_NAMESPACE}BOEKHANDEL*BE`),
      ])?.merchantId,
    ).toBe("m2");
  });

  // PINNED BY CONTENT, NOT BY A BRANCH POINT (fix round, finding
  // CR-M3P12-09). This used to shell out to `git diff <literal sha>`, which
  // passes here and throws after a rebase, a squash-merge or a shallow
  // clone, and the failure would read as a regression in the enum rather
  // than as a broken fixture. The property is the same; the mechanism now
  // survives history being rewritten under it.
  test("the MerchantRuleKind enum in the Prisma schema is UNCHANGED: it is these three members, in this order", () => {
    const schema = read("prisma/schema/merchants.prisma");
    const block = /enum MerchantRuleKind \{([^}]*)\}/.exec(schema);
    expect(block).not.toBeNull();
    const members = (block?.[1] ?? "")
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line !== "");
    expect(members).toEqual(["EXACT", "PREFIX", "PATTERN"]);
    // And exactly one such enum exists, so a second one cannot be added
    // beside it and satisfy the assertion above.
    expect(schema.match(/enum MerchantRuleKind/g)).toHaveLength(1);
  });

  test("the stated disposition, that no product surface writes either kind today, appears in BOTH files", () => {
    const schema = read("prisma/schema/merchants.prisma");
    const resolver = read("src/modules/merchants/domain/merchant-rule.ts");
    for (const [name, text] of [
      ["prisma/schema/merchants.prisma", schema],
      ["src/modules/merchants/domain/merchant-rule.ts", resolver],
    ] as const) {
      expect(text, name).toMatch(/NO PRODUCT SURFACE WRITES PREFIX OR PATTERN/);
      expect(text, name).toMatch(/assignMerchant writes kind EXACT/);
      expect(text, name).toMatch(/slice[- ]5/);
    }
  });
});

describe("CRITERION 12.12: the module boundary holds", () => {
  // PINNED BY CONTENT for the reason above (finding CR-M3P12-09). The
  // function body is restated here verbatim, so a change to the ledger's own
  // key reddens on THIS file's name rather than on a branch point that may
  // no longer exist.
  test("the ledger's own counterparty key is UNCHANGED, so no flow classification moves", () => {
    const corrections = read("src/modules/ledger/domain/corrections.ts");
    expect(corrections).toContain(
      [
        "export const counterpartyKey = (transaction: CounterpartyRef): string => {",
        "  if (transaction.counterpartyIban !== undefined) {",
        "    return `iban:${transaction.counterpartyIban.toUpperCase().replace(/\\s+/g, \"\")}`;",
        "  }",
        "  const text = transaction.counterpartyName ?? transaction.description;",
        "  return `text:${text.toUpperCase().replace(/\\s+/g, \" \").trim()}`;",
        "};",
      ].join("\n"),
    );
    // Exactly one definition, so the pin cannot be satisfied by a copy left
    // beside a rewritten original.
    expect(corrections.match(/export const counterpartyKey/g)).toHaveLength(1);
  });

  test("the merchants module's identity derivation is NOT imported by the ledger domain, so the two keys stay separate", () => {
    const corrections = read("src/modules/ledger/domain/corrections.ts");
    expect(corrections).not.toMatch(/counterparty-identity/);
    expect(corrections).not.toMatch(/counterpartyIdentity/);
  });
});

describe("CRITERION 12.17: the re-derivation has ONE named invocation point", () => {
  test("package.json carries a script that runs scripts/rederive-merchant-rules.ts", () => {
    const packageJson = JSON.parse(read("package.json")) as {
      scripts?: Record<string, string>;
    };
    const scripts = packageJson.scripts ?? {};
    const entries = Object.entries(scripts).filter(([, command]) =>
      command.includes("scripts/rederive-merchant-rules.ts"),
    );
    expect(entries).toHaveLength(1);
    expect(entries[0]?.[0]).toBe("rederive:merchant-rules");
  });

  test("the script states the order, the window it opens and its destructive authority in its OWN contract", () => {
    const script = read("scripts/rederive-merchant-rules.ts");
    expect(script).toMatch(/AFTER the\n\/\/ code deploys/);
    expect(script).toMatch(/DESTRUCTIVE AUTHORITY/);
    expect(script).toMatch(/THIS COMMAND DESTROYS NOTHING/);
    // It has no force flag and inherits none.
    expect(script).not.toMatch(/--force/);
  });
});

describe("CRITERION 12.19: the governing document says what the code does", () => {
  const skill = read(".claude/skills/pulse-domain/SKILL.md");

  test("the resolution chain states the namespaced identity with its two bases and the trust gate", () => {
    expect(skill).toMatch(/counterparty IDENTITY/);
    expect(skill).toMatch(/account:/);
    expect(skill).toMatch(/descriptor:/);
    expect(skill).toMatch(/trust/i);
  });

  test("PREFIX and PATTERN are stated never to apply to an account basis", () => {
    expect(skill).toMatch(
      /PREFIX and PATTERN never apply to an account[- ]basis/i,
    );
  });

  // THE CLAIM, NOT TWO SPELLINGS OF IT (fix round five, CRITERIA finding
  // CR5-M3P12-10). The two regexes this replaces pinned two exact wordings,
  // and the phrase criterion 12.19 asks be gone still occurs once in the
  // document, differing from both by a single word, inside a quotation of
  // what the section USED TO say and immediately negated. That occurrence is
  // correct and must stay; a REINTRODUCTION phrased the same way would also
  // have passed. So the check is scoped to the merchant-resolution section
  // and refuses the phrase anywhere it is not explicitly historical.
  // THE QUALIFIER WAS THE DOOR (fix round eight, CRITERIA finding
  // CR6-M3P12-05). Scoping to the section narrowed the hole; exempting any
  // line carrying "used to" reopened it, because that is exactly how an R-087
  // correction is written, so a reintroduction of the form "the key is the
  // normalised counterparty string, as it used to be" passed. The exemption is
  // gone. What replaces it is an identity rather than a shape: the phrase must
  // occur EXACTLY ONCE in the section, and that one occurrence must be the
  // known historical sentence, pinned by its full text. A reintroduction makes
  // the count two whatever words it carries, and an edit to the historical
  // sentence itself makes the pinned text stop matching, which is a change
  // somebody should have to look at.
  const HISTORICAL_SENTENCE =
    'This is the whole point of the chain and it used to be wrong here: the first step said "exact match on normalised counterparty string", and for a transfer row that string is the whole description, communication and per-transaction reference included, so a naming matched the one row it was written from and never the next one.';

  // AND THE COUNT IS OVER THE WHOLE DOCUMENT (fix round nine, CRITERIA
  // finding CR7-M3P12-03). The section slice narrowed the hole a third time
  // rather than closing it: criterion 12.19's second clause is about the FILE,
  // "shows no remaining sentence saying the key is the normalised counterparty
  // string", and a reintroduction one section away passed while the document
  // carried two occurrences. The two sibling pins in this same block already
  // read the whole document, so the narrow one was the odd member.
  //
  // THREE ASSERTIONS ON TEXT ALREADY READ, and together they are strictly
  // stronger than the slice was: the phrase occurs exactly once in the
  // DOCUMENT, that occurrence is inside the merchant-resolution section, and
  // it is the known historical sentence pinned by its full text.
  test("the forbidden phrase occurs EXACTLY ONCE in the WHOLE document, inside section 7, in the sentence that negates it", () => {
    const section = skill.slice(skill.indexOf("## 7. Merchant resolution"));
    const body = section.slice(0, section.indexOf("\n## ", 1));
    // The section really was read, so nothing below can pass by having sliced
    // the wrong text.
    expect(body.length).toBeGreaterThan(500);

    const documentOccurrences = skill.match(/normalised counterparty string/gi) ?? [];
    expect(documentOccurrences).toHaveLength(1);

    const sectionOccurrences = body.match(/normalised counterparty string/gi) ?? [];
    expect(sectionOccurrences).toHaveLength(1);

    expect(body).toContain(HISTORICAL_SENTENCE);
  });
});
