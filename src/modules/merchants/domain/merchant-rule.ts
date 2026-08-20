// Rule-based merchant resolution: the RuleResolver's pure half
// (pulse-v1-architecture.md:183-197). A chain, first confident answer
// wins: exact match on the normalised counterparty string, then prefix,
// then pattern, all from MerchantRule declarations, all certain
// confidence. No LLM in this phase (rules only until slice 5,
// pulse-v1-plan.md:192); an unmatched string stays unresolved and is
// SHOWN, never defaulted.
//
// Determinism is load-bearing exactly as it is for transfer pairing:
// resolving the same string against the same rules must always name the
// same merchant, never one that depends on what order the database
// returned rows in. Every step therefore carries an explicit tie-break:
// longest pattern first (the most specific declaration wins), then
// lexicographically smallest pattern, then lowest rule id.

export type MerchantRuleKind = "EXACT" | "PREFIX" | "PATTERN";

// A MerchantRule declaration as the resolver sees it. `pattern` is ALWAYS
// in normalised form (normaliseCounterparty): the application layer
// normalises before writing a rule, and matching runs on normalised
// strings only.
export type MerchantRuleLike = {
  readonly id: string;
  readonly merchantId: string;
  readonly kind: MerchantRuleKind;
  readonly pattern: string;
};

export type RuleMatch = {
  readonly merchantId: string;
  readonly ruleId: string;
};

const bySpecificity = (a: MerchantRuleLike, b: MerchantRuleLike): number => {
  if (a.pattern.length !== b.pattern.length) {
    return b.pattern.length - a.pattern.length;
  }
  if (a.pattern !== b.pattern) {
    return a.pattern < b.pattern ? -1 : 1;
  }
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
};

// A PATTERN rule is a glob over the whole normalised string: `*` matches
// any run of characters (including none), everything else is literal.
// Compiled fresh per call; rule counts are household scale.
const patternMatches = (glob: string, normalised: string): boolean => {
  const escaped = glob
    .split("*")
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  return new RegExp(`^${escaped}$`).test(normalised);
};

// Resolve one NORMALISED counterparty string against the household's
// rules. Callers normalise first; passing a raw string here is a bug, not
// a fallback.
export const matchRules = (
  normalised: string,
  rules: readonly MerchantRuleLike[],
): RuleMatch | undefined => {
  if (normalised === "") {
    return undefined;
  }
  const usable = rules.filter((rule) => rule.pattern !== "");

  const exact = usable
    .filter((rule) => rule.kind === "EXACT" && rule.pattern === normalised)
    .sort(bySpecificity)[0];
  if (exact !== undefined) {
    return { merchantId: exact.merchantId, ruleId: exact.id };
  }

  const prefix = usable
    .filter((rule) => rule.kind === "PREFIX" && normalised.startsWith(rule.pattern))
    .sort(bySpecificity)[0];
  if (prefix !== undefined) {
    return { merchantId: prefix.merchantId, ruleId: prefix.id };
  }

  const pattern = usable
    .filter(
      (rule) => rule.kind === "PATTERN" && patternMatches(rule.pattern, normalised),
    )
    .sort(bySpecificity)[0];
  if (pattern !== undefined) {
    return { merchantId: pattern.merchantId, ruleId: pattern.id };
  }

  return undefined;
};
