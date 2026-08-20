// The RuleResolver: the rules-only implementation behind the ledger's
// MerchantResolver port (pulse-v1-architecture.md:183-197). Exact match on
// the normalised counterparty string, then prefix and pattern, all from
// MerchantRule declarations, all certain confidence; no LLM in this phase
// (rules only until slice 5). Income sources resolve through this same
// function: a salary string and a shop string differ only in the flow of
// the rows that carry them.
//
// The input is DISTINCT RAW STRINGS, not transactions (thirty new
// merchants across four hundred rows is one rule scan with thirty items);
// the result maps each input string that resolved to its merchant id.
// Strings that resolve to nothing are absent from the map: unresolved is a
// visible state the caller keeps, never a default.

import type { HouseholdContext } from "@/platform/tenancy";
import { matchRules } from "../domain/merchant-rule";
import { normaliseCounterparty } from "../domain/normalise-counterparty";
import type { MerchantRepositoryPort } from "./ports";

export type ResolverDependencies = {
  readonly merchants: Pick<MerchantRepositoryPort, "listRules">;
};

export const resolveCounterparties = async (
  context: HouseholdContext,
  deps: ResolverDependencies,
  texts: readonly string[],
): Promise<ReadonlyMap<string, string>> => {
  const distinct = [...new Set(texts)];
  if (distinct.length === 0) {
    return new Map();
  }
  const rules = await deps.merchants.listRules(context);
  const resolved = new Map<string, string>();
  for (const text of distinct) {
    const match = matchRules(normaliseCounterparty(text), rules);
    if (match !== undefined) {
      resolved.set(text, match.merchantId);
    }
  }
  return resolved;
};
