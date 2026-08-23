import fc from "fast-check";
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

// CRITERION 12.21: PASS ONE CANNOT LOSE A RULE'S MEANING, FOR ANY KIND.
//
// Pass one prefixes a constant namespace onto a stored pattern, and the
// matcher compares that pattern against a key that has gained the SAME
// constant prefix. The claim is that this changes no answer, for EXACT
// (equality is preserved under a common prefix), for PREFIX (since
// ("descriptor:" + K).startsWith("descriptor:" + P) holds precisely when
// K.startsWith(P)) and for PATTERN (since the glob is anchored at both ends).
//
// The generator below produces the two cases pass one SKIPS as well as the
// ones it rewrites, and the two skips have their own witnesses: each shows
// that applying pass one's rewrite to that case WOULD change the answer,
// which is what makes the guards red rather than unreached.

const KINDS: readonly MerchantRuleKind[] = ["EXACT", "PREFIX", "PATTERN"];

const rule = (kind: MerchantRuleKind, pattern: string): MerchantRuleLike => ({
  id: "rule-1",
  merchantId: "merchant-1",
  kind,
  pattern,
});

// A bare key, as the baseline derivation produced one: upper case, no
// lowercase namespace can appear in it.
const bareKey = fc
  .stringMatching(/^[A-Z0-9 ]{1,24}$/)
  .filter((value) => value.trim() !== "");

// Patterns the generator produces, INCLUDING the two pass one skips.
const barePattern = fc.oneof(
  fc.stringMatching(/^[A-Z0-9 ]{0,12}$/),
  fc.stringMatching(/^[A-Z0-9 ]{0,8}\*[A-Z0-9 ]{0,8}$/),
  // The EMPTY pattern, which pass one leaves alone (hazard H12.26).
  fc.constant(""),
  // An ALREADY-NAMESPACED pattern, which pass one leaves alone (H12.25).
  fc.constant(`${DESCRIPTOR_NAMESPACE}DEMO`),
  fc.constant(`${DESCRIPTOR_NAMESPACE}`),
);

const isSkippedByPassOne = (pattern: string): boolean =>
  pattern === "" ||
  pattern.startsWith(DESCRIPTOR_NAMESPACE) ||
  pattern.startsWith(ACCOUNT_NAMESPACE);

describe("CRITERION 12.21: pass one preserves meaning for every kind", () => {
  test("for every kind and every pattern pass one REWRITES, the namespaced comparison returns exactly what the bare comparison returned", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...KINDS),
        barePattern,
        bareKey,
        (kind, pattern, key) => {
          if (isSkippedByPassOne(pattern)) {
            return true;
          }
          const before = matchRules(key, [rule(kind, pattern)]);
          const after = matchRules(`${DESCRIPTOR_NAMESPACE}${key}`, [
            rule(kind, `${DESCRIPTOR_NAMESPACE}${pattern}`),
          ]);
          return (
            (before === undefined) === (after === undefined) &&
            before?.merchantId === after?.merchantId
          );
        },
      ),
      { numRuns: 2000 },
    );
  });

  test("the generator really does produce the two skipped shapes, so the guards below are reached", () => {
    const produced = fc.sample(barePattern, { numRuns: 400, seed: 12 });
    expect(produced.some((pattern) => pattern === "")).toBe(true);
    expect(
      produced.some((pattern) => pattern.startsWith(DESCRIPTOR_NAMESPACE)),
    ).toBe(true);
  });

  test("GUARD ONE, WITNESSED: namespacing an EMPTY pattern would turn an inert rule into one that matches every descriptor key", () => {
    const keys = ["DEMO ALFA", "KOSTEN DEMO REKENINGPAKKET", "A"];
    for (const key of keys) {
      // Today: an empty pattern is filtered out by the matcher, so it is
      // inert whatever the key.
      expect(matchRules(key, [rule("PREFIX", "")])).toBeUndefined();
      // If pass one namespaced it, the bare namespace would be a non-empty
      // PREFIX matching EVERY descriptor-basis key. This is why pass one
      // leaves it alone.
      expect(
        matchRules(`${DESCRIPTOR_NAMESPACE}${key}`, [
          rule("PREFIX", DESCRIPTOR_NAMESPACE),
        ]),
      ).toBeDefined();
      // And with the guard, the rule stays inert after the migration too.
      expect(
        matchRules(`${DESCRIPTOR_NAMESPACE}${key}`, [rule("PREFIX", "")]),
      ).toBeUndefined();
    }
  });

  test("GUARD TWO, WITNESSED: namespacing an ALREADY-NAMESPACED pattern would kill a correct rule on the FIRST run", () => {
    const key = `${DESCRIPTOR_NAMESPACE}DEMO ALFA`;
    const correct = rule("EXACT", `${DESCRIPTOR_NAMESPACE}DEMO ALFA`);
    // A naming made inside the deploy window already matches.
    expect(matchRules(key, [correct])).toBeDefined();
    // A second namespacing would produce this, which matches nothing.
    const doubled = rule(
      "EXACT",
      `${DESCRIPTOR_NAMESPACE}${DESCRIPTOR_NAMESPACE}DEMO ALFA`,
    );
    expect(matchRules(key, [doubled])).toBeUndefined();
  });

  test("THE CASE THE PROPERTY TEST CANNOT GENERATE: no PREFIX or PATTERN rule pass one produced ever matches an ACCOUNT-basis key (D-40's refusal)", () => {
    const account = `${ACCOUNT_NAMESPACE}BE31111122223333`;
    // Every proper prefix of the account key, and a glob over it.
    for (let length = 1; length < account.length; length += 1) {
      expect(
        matchRules(account, [rule("PREFIX", account.slice(0, length))]),
        account.slice(0, length),
      ).toBeUndefined();
    }
    for (const glob of [
      "*",
      `${ACCOUNT_NAMESPACE}*`,
      `${ACCOUNT_NAMESPACE}BE31*`,
      `*BE31111122223333`,
    ]) {
      expect(matchRules(account, [rule("PATTERN", glob)]), glob).toBeUndefined();
    }
    // A descriptor-namespaced PREFIX, which is exactly what pass one writes,
    // never reaches an account key either.
    expect(
      matchRules(account, [rule("PREFIX", DESCRIPTOR_NAMESPACE)]),
    ).toBeUndefined();
    // An EXACT rule on the whole account key still matches, so the refusal
    // above is a refusal of the two broadening kinds and not of the basis.
    expect(matchRules(account, [rule("EXACT", account)])).toBeDefined();
  });
});
