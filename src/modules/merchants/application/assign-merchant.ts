// Manual assignment: an unresolved counterparty is named in one click, and
// the naming is a DECLARATION, never a row edit (pulse-domain section 2
// rule 2, hazard H3.1). The use case writes a MerchantRule (EXACT, on the
// normalised string), creating the Merchant by name if it does not exist,
// then triggers recompute so the rule applies to every past matching
// transaction; future imports pick it up through the same resolver. No
// transaction row is touched here: the assignment reaches rows only
// through interpretation re-derived from facts plus declarations, which is
// exactly why the next recompute confirms it instead of undoing it.

import { err, ok, type Result } from "@/platform/result";
import type { HouseholdContext } from "@/platform/tenancy";
import type { MerchantRuleLike } from "../domain/merchant-rule";
import { normaliseCounterparty } from "../domain/normalise-counterparty";
import type {
  MerchantRecord,
  MerchantRepositoryPort,
  RecomputeInterpretation,
} from "./ports";

export type AssignMerchantError =
  | { readonly kind: "empty-merchant-name" }
  | { readonly kind: "empty-counterparty" };

export type AssignMerchantInput = {
  // The counterparty text being named: raw or already-normalised, both
  // work, because the rule subject is the normalised form either way.
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
  const pattern = normaliseCounterparty(input.counterpartyText);
  if (pattern === "") {
    return err({ kind: "empty-counterparty" as const });
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
