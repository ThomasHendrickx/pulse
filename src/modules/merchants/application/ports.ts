// Ports of the merchants module. Use cases depend on these interfaces
// only; adapters/merchant-repository.ts implements them over Prisma and
// the fast gate binds in-memory fakes.
//
// LAYER NOTE, the line this phase exists to hold: everything writable
// through MerchantRepositoryPort is DECLARATION state (MerchantRule, Tag,
// MerchantTag) plus the Merchant name rows those declarations point at.
// Interpretation NEVER holds this port: the ledger's interpret use case
// sees merchants only through the read-only MerchantResolverPort declared
// in the ledger module, so no code path in interpretation can write a
// rule, by construction (criterion 3.2, hazard H3.1).

import type { Cents } from "@/platform/money";
import type { HouseholdContext } from "@/platform/tenancy";
import type { MerchantRuleKind, MerchantRuleLike } from "../domain/merchant-rule";

export type MerchantRecord = {
  readonly id: string;
  readonly name: string;
};

export type TagRecord = {
  readonly id: string;
  readonly name: string;
};

export type MerchantTagRecord = {
  readonly tagId: string;
  readonly tagName: string;
  readonly isPrimary: boolean;
};

// A counted transaction as the review list needs it: interpretation has
// already run, so flow is INCOME or SPEND and merchantId carries the
// engine's current assignment (absent while no rule matches).
export type CountedTransaction = {
  readonly id: string;
  readonly flow: "INCOME" | "SPEND";
  readonly amountCents: Cents;
  readonly description: string;
  readonly counterpartyName?: string;
  readonly merchantId?: string;
};

export type MerchantRepositoryPort = {
  // The declaration layer the resolver reads.
  readonly listRules: (
    context: HouseholdContext,
  ) => Promise<readonly MerchantRuleLike[]>;
  readonly listMerchants: (
    context: HouseholdContext,
  ) => Promise<readonly MerchantRecord[]>;
  readonly findMerchantByName: (
    context: HouseholdContext,
    name: string,
  ) => Promise<MerchantRecord | null>;
  readonly createMerchant: (
    context: HouseholdContext,
    name: string,
  ) => Promise<MerchantRecord>;
  // One household decision per (kind, pattern): writing the same subject
  // again UPDATES the decision's merchant instead of stacking a second,
  // contradictory rule the resolver would tie-break by accident.
  readonly upsertRule: (
    context: HouseholdContext,
    input: {
      readonly merchantId: string;
      readonly kind: MerchantRuleKind;
      readonly pattern: string;
    },
  ) => Promise<MerchantRuleLike>;
  readonly findTagByName: (
    context: HouseholdContext,
    name: string,
  ) => Promise<TagRecord | null>;
  readonly createTag: (
    context: HouseholdContext,
    name: string,
  ) => Promise<TagRecord>;
  // Links tag to merchant (upsert on the merchantId+tagId unique). When
  // isPrimary is true, every other primary on the merchant is demoted in
  // the SAME atomic write: at most one primary per merchant is an
  // application-enforced invariant (a Prisma-modelled partial unique index
  // does not exist; stated at the MerchantTag model).
  readonly setMerchantTag: (
    context: HouseholdContext,
    input: {
      readonly merchantId: string;
      readonly tagId: string;
      readonly isPrimary: boolean;
    },
  ) => Promise<void>;
  readonly listMerchantTags: (
    context: HouseholdContext,
    merchantId: string,
  ) => Promise<readonly MerchantTagRecord[]>;
  // Interpretation OUTPUT, read-only here: the review list groups what the
  // engine already assigned. Writing merchantId stays the ledger
  // repository's replaceInterpretation, never this port.
  readonly listCountedTransactions: (
    context: HouseholdContext,
  ) => Promise<readonly CountedTransaction[]>;
};

// Recompute as the merchants module sees it: after a declaration is
// written, interpretation is re-derived so the rule reaches every past
// matching transaction. Bound by the CALLER (the UI action) to the ledger
// module's published recomputeInterpretation, so the merchants module
// never imports the ledger module and no import cycle exists.
export type RecomputeInterpretation = (
  context: HouseholdContext,
) => Promise<unknown>;
