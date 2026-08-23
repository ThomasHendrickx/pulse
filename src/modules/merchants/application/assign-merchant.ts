// Manual assignment: an unresolved counterparty is named in one click, and
// the naming is a DECLARATION, never a row edit (pulse-domain section 2
// rule 2, hazard H3.1). The use case writes a MerchantRule (EXACT, on the
// counterparty IDENTITY KEY since M3-P12), creating the Merchant if absent,
// then triggers recompute so the rule applies to every past matching
// transaction; future imports pick it up through the same resolver. No
// transaction row is touched here: the assignment reaches rows only
// through interpretation re-derived from facts plus declarations, which is
// exactly why the next recompute confirms it instead of undoing it.

import { err, ok, type Result } from "@/platform/result";
import type { HouseholdContext } from "@/platform/tenancy";
import type { MerchantRuleLike } from "../domain/merchant-rule";
import {
  ACCOUNT_NAMESPACE,
  compactAccount,
  identityBasisOfKey,
  isTrustedCounterpartyAccount,
} from "../domain/counterparty-identity";
import type {
  MerchantRecord,
  MerchantRepositoryPort,
  RecomputeInterpretation,
} from "./ports";

export type AssignMerchantError =
  | { readonly kind: "empty-merchant-name" }
  | { readonly kind: "empty-counterparty" }
  // The subject is not a counterparty identity key at all: it carries
  // neither namespace. The page that submitted it was rendered before this
  // phase deployed (decision D-46's window), so the key it holds is a
  // pre-migration normalised text and a rule written on it could never
  // match anything. REFUSED AND SHOWN rather than written (criterion 12.18).
  | { readonly kind: "unnamespaced-counterparty" }
  // An account-basis subject whose remainder is empty, or which the trust
  // gate refuses. Writing it would attach the naming to a key the derivation
  // can never produce.
  | { readonly kind: "untrusted-counterparty-account" };

export type AssignMerchantInput = {
  // The counterparty IDENTITY KEY being named, exactly as the review screen
  // rendered it (M3-P12). It is NO LONGER a raw text: the rule subject is
  // the key verbatim, so what the form submits and what the resolver later
  // matches are the same string by construction rather than because two
  // normalisations agree.
  readonly counterpartyText: string;
  readonly merchantName: string;
};

export type AssignMerchantOutcome = {
  readonly merchant: MerchantRecord;
  readonly rule: MerchantRuleLike;
};

export type AssignMerchantDependencies = {
  readonly merchants: Pick<
    MerchantRepositoryPort,
    "findMerchantByName" | "createMerchant" | "upsertRule"
  >;
  readonly recompute: RecomputeInterpretation;
};

export const assignMerchant = async (
  context: HouseholdContext,
  deps: AssignMerchantDependencies,
  input: AssignMerchantInput,
): Promise<Result<AssignMerchantOutcome, AssignMerchantError>> => {
  const name = input.merchantName.trim();
  if (name === "") {
    return err({ kind: "empty-merchant-name" as const });
  }
  // THE WRITE BOUNDARY (criterion 12.18). This REPLACES the normalisation
  // that used to happen here, and the replacement is not optional: with the
  // normalisation gone, an un-namespaced subject would be written verbatim
  // as a rule that can never match a key, and a stale page is exactly the
  // thing that submits one (hazard H12.21). The subject is stored VERBATIM
  // after these checks; normalising it again would uppercase the namespace.
  const pattern = input.counterpartyText;
  if (pattern.trim() === "") {
    return err({ kind: "empty-counterparty" as const });
  }
  const basis = identityBasisOfKey(pattern);
  if (basis === undefined) {
    return err({ kind: "unnamespaced-counterparty" as const });
  }
  if (basis === "account") {
    const account = pattern.slice(ACCOUNT_NAMESPACE.length);
    if (
      compactAccount(account) === "" ||
      !isTrustedCounterpartyAccount(account)
    ) {
      return err({ kind: "untrusted-counterparty-account" as const });
    }
  }
  const merchant =
    (await deps.merchants.findMerchantByName(context, name)) ??
    (await deps.merchants.createMerchant(context, name));
  const rule = await deps.merchants.upsertRule(context, {
    merchantId: merchant.id,
    kind: "EXACT",
    pattern,
  });
  // The declaration is written; recompute is what carries it to every past
  // matching transaction (charter: corrections are declarations, recompute
  // applies them). Retroactivity is this line, not a row update.
  await deps.recompute(context);
  return ok({ merchant, rule });
};
