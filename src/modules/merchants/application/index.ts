// The merchants module's PUBLISHED interface (pulse-domain section 9), and
// its composition root: use cases bound to the Prisma adapter. Tests
// exercise the use cases against in-memory fakes of the same ports, never
// this binding.
//
// DELIBERATELY NOT IMPORTED HERE: the ledger module. Recompute (the step
// that carries a new rule to every past matching transaction) enters
// assignMerchant as an explicit argument, bound by the UI action to the
// ledger's published recomputeInterpretation. The ledger's own composition
// root imports THIS module for its resolver binding, so importing the
// ledger back from here would create a module cycle.

import type { HouseholdContext } from "@/platform/tenancy";
import * as repository from "../adapters/merchant-repository";
import {
  assignMerchant as assignMerchantUseCase,
  type AssignMerchantError,
  type AssignMerchantInput,
  type AssignMerchantOutcome,
} from "./assign-merchant";
import {
  listMerchantReview as listMerchantReviewUseCase,
} from "./merchant-review";
import { resolveCounterparties as resolveCounterpartiesUseCase } from "./resolve-counterparties";
import {
  tagMerchant as tagMerchantUseCase,
  type TagMerchantError,
  type TagMerchantInput,
} from "./tag-merchant";
import type {
  MerchantRepositoryPort,
  RecomputeInterpretation,
  TagRecord,
} from "./ports";
import type { Result } from "@/platform/result";
import type { MerchantReview } from "../domain/merchant-review";

export type {
  AssignMerchantError,
  AssignMerchantInput,
  AssignMerchantOutcome,
} from "./assign-merchant";
export type { TagMerchantError, TagMerchantInput } from "./tag-merchant";
export type {
  CountedTransaction,
  MerchantRecord,
  MerchantRepositoryPort,
  MerchantTagRecord,
  RecomputeInterpretation,
  TagRecord,
} from "./ports";
export type {
  MerchantReview,
  ReviewGroup,
  CountedRow,
} from "../domain/merchant-review";
export type {
  MerchantRuleKind,
  MerchantRuleLike,
  RuleMatch,
} from "../domain/merchant-rule";
export { matchRules } from "../domain/merchant-rule";
export { buildMerchantReview, counterpartyText } from "../domain/merchant-review";
export { normaliseCounterparty } from "../domain/normalise-counterparty";
export { assignMerchant as assignMerchantWith } from "./assign-merchant";
export { listMerchantReview as listMerchantReviewWith } from "./merchant-review";
export { resolveCounterparties as resolveCounterpartiesWith } from "./resolve-counterparties";
export { tagMerchant as tagMerchantWith } from "./tag-merchant";

const liveRepository: MerchantRepositoryPort = {
  listRules: repository.listRules,
  listMerchants: repository.listMerchants,
  findMerchantByName: repository.findMerchantByName,
  createMerchant: repository.createMerchant,
  upsertRule: repository.upsertRule,
  findTagByName: repository.findTagByName,
  createTag: repository.createTag,
  setMerchantTag: repository.setMerchantTag,
  listMerchantTags: repository.listMerchantTags,
  listCountedTransactions: repository.listCountedTransactions,
};

// The RuleResolver behind the ledger's MerchantResolver port: distinct raw
// strings in, merchant assignments out, rules only (slice 5 adds the LLM
// step BEHIND this same interface).
export const resolveCounterparties = (
  context: HouseholdContext,
  texts: readonly string[],
): Promise<ReadonlyMap<string, string>> =>
  resolveCounterpartiesUseCase(context, { merchants: liveRepository }, texts);

export const assignMerchant = (
  context: HouseholdContext,
  input: AssignMerchantInput,
  recompute: RecomputeInterpretation,
): Promise<Result<AssignMerchantOutcome, AssignMerchantError>> =>
  assignMerchantUseCase(
    context,
    { merchants: liveRepository, recompute },
    input,
  );

export const tagMerchant = (
  context: HouseholdContext,
  input: TagMerchantInput,
): Promise<Result<TagRecord, TagMerchantError>> =>
  tagMerchantUseCase(context, { merchants: liveRepository }, input);

export const listMerchantReview = (
  context: HouseholdContext,
): Promise<MerchantReview> =>
  listMerchantReviewUseCase(context, { merchants: liveRepository });
