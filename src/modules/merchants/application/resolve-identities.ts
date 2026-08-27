// The RuleResolver: the rules-only implementation behind the ledger's
// MerchantResolver port (pulse-v1-architecture.md:183-197). Exact match on
// the counterparty IDENTITY key, then prefix, then pattern, all from
// MerchantRule declarations, all certain confidence; no LLM in this phase
// (rules only until slice 5). Income sources resolve through this same
// function: a salary string and a shop string differ only in the flow of
// the rows that carry them.
//
// The input is DISTINCT IDENTITY KEYS, not transactions and no longer raw
// text (thirty new merchants across four hundred rows is one rule scan with
// thirty items); the result maps each input key that resolved to its
// merchant id. Keys that resolve to nothing are absent from the map:
// unresolved is a visible state the caller keeps, never a default.
//
// THIS FUNCTION NO LONGER NORMALISES (M3-P12). It used to call
// normaliseCounterparty on what it was handed, which was correct while the
// argument was raw text and is WRONG now: an identity key carries a
// lowercase namespace, and normalising would uppercase it into a string no
// stored pattern can equal. The caller derives the key with
// counterpartyIdentity and this function matches it verbatim. The port
// member was renamed in the same change so a caller still passing raw text
// is a compile error rather than a silent nil result (hazard H12.10).

import type { HouseholdContext } from "@/platform/tenancy";
import { matchRules } from "../domain/merchant-rule";
import type { MerchantRepositoryPort } from "./ports";

export type ResolverDependencies = {
  readonly merchants: Pick<MerchantRepositoryPort, "listRules">;
};

export const resolveIdentities = async (
  context: HouseholdContext,
  deps: ResolverDependencies,
  identityKeys: readonly string[],
): Promise<ReadonlyMap<string, string>> => {
  const distinct = [...new Set(identityKeys)];
  if (distinct.length === 0) {
    return new Map();
  }
  const rules = await deps.merchants.listRules(context);
  const resolved = new Map<string, string>();
  for (const key of distinct) {
    const match = matchRules(key, rules);
    if (match !== undefined) {
      resolved.set(key, match.merchantId);
    }
  }
  return resolved;
};
