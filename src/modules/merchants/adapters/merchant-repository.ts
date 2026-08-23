// Prisma repository for the merchants module. Every function takes the
// household context explicitly and filters on householdId (CLAUDE.md
// non-negotiable 6).
//
// LAYER CONTRACT: this repository WRITES declaration state only
// (merchants, merchant_rules, tags, merchant_tags). It READS the
// transactions table's interpretation output (flow, merchantId) plus the
// fact columns the review needs, and writes NOTHING to transactions: the
// one writer of transactions.merchantId is the ledger repository's
// replaceInterpretation, and the one writer of fact columns is the import
// module. The boundary held is the facts/declarations/interpretation
// LAYER, the same reading as the ledger adapter's header.

import { prisma } from "@/platform/db/client";
import type { Cents } from "@/platform/money";
import type { HouseholdContext } from "@/platform/tenancy";
import type { MerchantRuleKind, MerchantRuleLike } from "../domain/merchant-rule";
import type {
  CountedTransaction,
  MerchantRecord,
  MerchantTagRecord,
  TagRecord,
} from "../application/ports";

export const listRules = async (
  context: HouseholdContext,
): Promise<readonly MerchantRuleLike[]> => {
  const rows = await prisma.merchantRule.findMany({
    where: { householdId: context.householdId },
    orderBy: { id: "asc" },
  });
  return rows.map((row) => ({
    id: row.id,
    merchantId: row.merchantId,
    kind: row.kind,
    pattern: row.pattern,
  }));
};

export const listMerchants = async (
  context: HouseholdContext,
): Promise<readonly MerchantRecord[]> => {
  const rows = await prisma.merchant.findMany({
    where: { householdId: context.householdId },
    orderBy: { name: "asc" },
  });
  return rows.map((row) => ({ id: row.id, name: row.name }));
};

export const findMerchantByName = async (
  context: HouseholdContext,
  name: string,
): Promise<MerchantRecord | null> => {
  const row = await prisma.merchant.findUnique({
    where: {
      householdId_name: { householdId: context.householdId, name },
    },
  });
  return row === null ? null : { id: row.id, name: row.name };
};

export const createMerchant = async (
  context: HouseholdContext,
  name: string,
): Promise<MerchantRecord> => {
  const row = await prisma.merchant.create({
    data: { householdId: context.householdId, name },
  });
  return { id: row.id, name: row.name };
};

export const upsertRule = async (
  context: HouseholdContext,
  input: {
    readonly merchantId: string;
    readonly kind: MerchantRuleKind;
    readonly pattern: string;
  },
): Promise<MerchantRuleLike> => {
  // Finding CR-401: the merchant the rule points at is verified to belong
  // to THIS household inside the same transaction as the write (CLAUDE.md
  // non-negotiable 6). A foreign merchantId indicates a bug or an attack,
  // so it throws rather than returning a Result.
  const row = await prisma.$transaction(async (tx) => {
    const merchant = await tx.merchant.findFirst({
      where: { id: input.merchantId, householdId: context.householdId },
      select: { id: true },
    });
    if (merchant === null) {
      throw new Error("upsertRule: merchant does not belong to the household");
    }
    return tx.merchantRule.upsert({
      where: {
        householdId_kind_pattern: {
          householdId: context.householdId,
          kind: input.kind,
          pattern: input.pattern,
        },
      },
      create: {
        householdId: context.householdId,
        merchantId: input.merchantId,
        kind: input.kind,
        pattern: input.pattern,
      },
      update: { merchantId: input.merchantId },
    });
  });
  return {
    id: row.id,
    merchantId: row.merchantId,
    kind: row.kind,
    pattern: row.pattern,
  };
};

export const findTagByName = async (
  context: HouseholdContext,
  name: string,
): Promise<TagRecord | null> => {
  const row = await prisma.tag.findUnique({
    where: {
      householdId_name: { householdId: context.householdId, name },
    },
  });
  return row === null ? null : { id: row.id, name: row.name };
};

export const createTag = async (
  context: HouseholdContext,
  name: string,
): Promise<TagRecord> => {
  const row = await prisma.tag.create({
    data: { householdId: context.householdId, name },
  });
  return { id: row.id, name: row.name };
};

export const setMerchantTag = async (
  context: HouseholdContext,
  input: {
    readonly merchantId: string;
    readonly tagId: string;
    readonly isPrimary: boolean;
  },
): Promise<void> => {
  // At most one primary per merchant. Two layers, and the DIVISION OF
  // LABOUR matters (finding CR-401): the demote-then-promote below keeps
  // the COMMON path clean, and the partial unique index
  // merchant_tags_one_primary_per_merchant (migration
  // one_primary_per_merchant: UNIQUE ON merchant_tags(merchantId) WHERE
  // isPrimary) is what makes the invariant hold under CONCURRENT
  // promotes, where read committed lets two transactions each demote a
  // snapshot missing the other's uncommitted primary (witnessed against
  // this adapter pre-fix: 19 of 20 probe rounds ended with two
  // primaries). With the index, the losing promote surfaces as a unique
  // violation, an exception per pulse-typescript section 5: unexpected
  // contention on a one-household UI, and the caller's retry heals it.
  //
  // Tenancy (CLAUDE.md non-negotiable 6, same finding): the merchant and
  // the tag are both verified to belong to THIS household inside the
  // transaction before any write, and every write clause carries
  // householdId. A foreign id indicates a bug or an attack: throw.
  await prisma.$transaction(async (tx) => {
    const merchant = await tx.merchant.findFirst({
      where: { id: input.merchantId, householdId: context.householdId },
      select: { id: true },
    });
    if (merchant === null) {
      throw new Error("setMerchantTag: merchant does not belong to the household");
    }
    const tag = await tx.tag.findFirst({
      where: { id: input.tagId, householdId: context.householdId },
      select: { id: true },
    });
    if (tag === null) {
      throw new Error("setMerchantTag: tag does not belong to the household");
    }
    if (input.isPrimary) {
      await tx.merchantTag.updateMany({
        where: {
          householdId: context.householdId,
          merchantId: input.merchantId,
          isPrimary: true,
        },
        data: { isPrimary: false },
      });
    }
    const updated = await tx.merchantTag.updateMany({
      where: {
        householdId: context.householdId,
        merchantId: input.merchantId,
        tagId: input.tagId,
      },
      data: { isPrimary: input.isPrimary },
    });
    if (updated.count === 0) {
      await tx.merchantTag.create({
        data: {
          householdId: context.householdId,
          merchantId: input.merchantId,
          tagId: input.tagId,
          isPrimary: input.isPrimary,
        },
      });
    }
  });
};

export const listMerchantTags = async (
  context: HouseholdContext,
  merchantId: string,
): Promise<readonly MerchantTagRecord[]> => {
  const rows = await prisma.merchantTag.findMany({
    where: { householdId: context.householdId, merchantId },
    include: { tag: true },
    orderBy: { tag: { name: "asc" } },
  });
  return rows.map((row) => ({
    tagId: row.tagId,
    tagName: row.tag.name,
    isPrimary: row.isPrimary,
  }));
};

export const listCountedTransactions = async (
  context: HouseholdContext,
): Promise<readonly CountedTransaction[]> => {
  const rows = await prisma.transaction.findMany({
    where: {
      householdId: context.householdId,
      flow: { in: ["INCOME", "SPEND"] },
    },
    select: {
      id: true,
      flow: true,
      amountCents: true,
      description: true,
      counterpartyName: true,
      // M3-P12: the review keys on the counterparty IDENTITY, whose account
      // branch reads this column. It was not selected before this phase,
      // which is why the structured account the importer already stored
      // reached merchant identity through nothing.
      counterpartyIban: true,
      merchantId: true,
    },
    orderBy: [{ bookingDate: "asc" }, { id: "asc" }],
  });
  return rows.flatMap((row) => {
    // The where-clause narrows flow to the two counted values; the Prisma
    // type does not, so narrow by check rather than by cast.
    if (row.flow !== "INCOME" && row.flow !== "SPEND") {
      return [];
    }
    return [
      {
        id: row.id,
        flow: row.flow,
        amountCents: row.amountCents as Cents,
        description: row.description,
        ...(row.counterpartyName === null
          ? {}
          : { counterpartyName: row.counterpartyName }),
        ...(row.counterpartyIban === null
          ? {}
          : { counterpartyAccount: row.counterpartyIban }),
        ...(row.merchantId === null ? {} : { merchantId: row.merchantId }),
      },
    ];
  });
};
