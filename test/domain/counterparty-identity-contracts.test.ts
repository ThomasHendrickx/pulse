import { execFileSync } from "node:child_process";
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

  test("the MerchantRuleKind enum in the Prisma schema is UNCHANGED from the branch point", () => {
    const diff = execFileSync(
      "git",
      ["diff", "7f4aafb", "--", "prisma/schema/merchants.prisma"],
      { cwd: repositoryRoot, encoding: "utf8" },
    );
    // The schema comment may be corrected; the enum may not move.
    expect(diff).not.toMatch(/^[+-]\s*(EXACT|PREFIX|PATTERN)\s*$/m);
    expect(diff).not.toMatch(/^[+-]enum MerchantRuleKind/m);
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
  test("the ledger's own counterparty key is UNCHANGED from the branch point, so no flow classification moves", () => {
    const diff = execFileSync(
      "git",
      ["diff", "7f4aafb", "--", "src/modules/ledger/domain/corrections.ts"],
      { cwd: repositoryRoot, encoding: "utf8" },
    );
    expect(diff).toBe("");
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

  test("no sentence remains saying the key is the normalised counterparty string", () => {
    // The exact sentence this phase replaced.
    expect(skill).not.toMatch(
      /Exact match on normalised counterparty string, from MerchantRule/,
    );
    expect(skill).not.toMatch(
      /[Ee]xact match on the normalised counterparty string/,
    );
  });
});
