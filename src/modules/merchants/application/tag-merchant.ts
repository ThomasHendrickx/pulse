// Freeform tags on merchants (charter tags decision): user-created, on the
// MERCHANT never the transaction, many-to-many, at most one primary per
// merchant, nothing seeded. Tags are declarations: recompute never touches
// them, and re-tagging the same pair updates the link instead of stacking.

import { err, ok, type Result } from "@/platform/result";
import type { HouseholdContext } from "@/platform/tenancy";
import type { MerchantRepositoryPort, TagRecord } from "./ports";

export type TagMerchantError = { readonly kind: "empty-tag-name" };

export type TagMerchantInput = {
  readonly merchantId: string;
  readonly tagName: string;
  readonly isPrimary: boolean;
};

export type TagMerchantDependencies = {
  readonly merchants: Pick<
    MerchantRepositoryPort,
    "findTagByName" | "createTag" | "setMerchantTag"
  >;
};

export const tagMerchant = async (
  context: HouseholdContext,
  deps: TagMerchantDependencies,
  input: TagMerchantInput,
): Promise<Result<TagRecord, TagMerchantError>> => {
  const name = input.tagName.trim();
  if (name === "") {
    return err({ kind: "empty-tag-name" as const });
  }
  const tag =
    (await deps.merchants.findTagByName(context, name)) ??
    (await deps.merchants.createTag(context, name));
  await deps.merchants.setMerchantTag(context, {
    merchantId: input.merchantId,
    tagId: tag.id,
    isPrimary: input.isPrimary,
  });
  return ok(tag);
};
