// Rule-based merchant resolution: the RuleResolver's pure half
// (pulse-v1-architecture.md:183-197). A chain, first confident answer
// wins: exact match on the counterparty IDENTITY KEY, then prefix, then
// pattern, all from MerchantRule declarations, all certain confidence. No
// LLM in this phase (rules only until slice 5, pulse-v1-plan.md:192); an
// unmatched key stays unresolved and is SHOWN, never defaulted.
//
// WHAT IS MATCHED, since M3-P12: a namespaced counterparty identity key,
// `account:<ACCOUNT>` or `descriptor:<NORMALISED DESCRIPTOR>`, derived by
// counterparty-identity.ts. Patterns are stored in that same form.
//
// THE DISPOSITION OF THE THREE KINDS, stated here rather than left to be
// inferred from the enum (decision D-40). All three are LIVE in this
// matcher and all three stay in the schema enum. NO PRODUCT SURFACE WRITES
// PREFIX OR PATTERN TODAY: assignMerchant writes kind EXACT and only EXACT
// (application/assign-merchant.ts), which is the only writer of a rule in
// the tree, and the deployed database holds zero rows of either kind. Both
// are RESERVED for the slice-5 accepted-answer path the pulse-domain
// skill's section 7 names, where an accepted LLM answer may declare a
// broader subject than one exact string.
//
// AND THE ONE RULE THE NEW KEY MAKES NECESSARY: a PREFIX or a PATTERN rule
// is NEVER applied to an ACCOUNT-basis key. A prefix of an account number
// is a DIFFERENT account, and a glob over one merges counterparties that
// have nothing to do with each other, which is the silent merge this whole
// phase is built to refuse (hazard H12.13). The refusal is here, at the
// matcher, rather than at the writer, because a rule written by hand or by
// a later slice never passes through the writer.
//
// Determinism is load-bearing exactly as it is for transfer pairing:
// resolving the same string against the same rules must always name the
// same merchant, never one that depends on what order the database
// returned rows in. Every step therefore carries an explicit tie-break:
// longest pattern first (the most specific declaration wins), then
// lexicographically smallest pattern, then lowest rule id.

import { ACCOUNT_NAMESPACE } from "./counterparty-identity";

export type MerchantRuleKind = "EXACT" | "PREFIX" | "PATTERN";

// A MerchantRule declaration as the resolver sees it. `pattern` is ALWAYS
// a counterparty identity key or a prefix/glob over one: the application
// layer validates the namespace before writing a rule
// (application/assign-merchant.ts), and matching runs on identity keys
// only.
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

// Resolve one counterparty IDENTITY KEY against the household's rules.
// Callers derive the key with counterpartyIdentity first; passing a raw
// text here is a bug, not a fallback.
export const matchRules = (
  normalised: string,
  rules: readonly MerchantRuleLike[],
): RuleMatch | undefined => {
  if (normalised === "") {
    return undefined;
  }
  const usable = rules.filter((rule) => rule.pattern !== "");
  // D-40's refusal. Read off the key's own namespace, so it needs no extra
  // argument and cannot be bypassed by a caller that forgot to pass one.
  const isAccountBasis = normalised.startsWith(ACCOUNT_NAMESPACE);

  const exact = usable
    .filter((rule) => rule.kind === "EXACT" && rule.pattern === normalised)
    .sort(bySpecificity)[0];
  if (exact !== undefined) {
    return { merchantId: exact.merchantId, ruleId: exact.id };
  }

  if (isAccountBasis) {
    return undefined;
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
