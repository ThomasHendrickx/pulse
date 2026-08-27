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

// REMOVED IN M3-P12's THIRD FIX ROUND, finding CR3-M3P12-07: updateRulePattern
// lived here as a bare updateManyAndReturn outside any transaction, with a
// comment saying pass one of the re-derivation writes through it. Both halves
// went false when the fix round moved the whole write set onto applyRuleWrites
// below, and a declaration rewrite outside a transaction is exactly the thing
// that round bought. It is gone rather than kept with a corrected comment, so
// there is one write path for a declaration and it is the atomic one.

export const applyRuleWrites = async (
  context: HouseholdContext,
  input: {
    readonly updates: readonly { readonly ruleId: string; readonly pattern: string }[];
    readonly inserts: readonly {
      readonly merchantId: string;
      readonly kind: MerchantRuleKind;
      readonly pattern: string;
    }[];
  },
): Promise<void> => {
  if (input.updates.length === 0 && input.inserts.length === 0) {
    return;
  }
  // THE INTERACTIVE FORM, so the tenancy check can throw from INSIDE the
  // transaction (fix round three, finding CR3-M3P12-04). The batch form ran
  // every statement and returned, and the household check then ran on the
  // results, AFTER the commit: on the one path that check exists for, a rule
  // id belonging to another household, the caller got an exception and the
  // inserts had already landed. A guard that fires after the row exists has
  // not enforced anything, and CLAUDE.md non-negotiable 6 is not a message,
  // it is a rule about what reaches the table. Throwing inside the callback
  // makes the rollback the database's.
  await prisma.$transaction(async (tx) => {
    for (const update of input.updates) {
      // Household ownership is verified in the SAME statement as the write.
      const result = await tx.merchantRule.updateMany({
        where: { id: update.ruleId, householdId: context.householdId },
        data: { pattern: update.pattern },
      });
      if (result.count === 0) {
        throw new Error(
          "applyRuleWrites: one or more rules did not belong to the household",
        );
      }
    }
    // THE INSERT HALF'S OWN TENANCY CHECK (fix round four, finding
    // HAZARD finding CR4-M3P12-03). The update loop above verifies ownership
    // statement as the write; this loop verified nothing at all. A rule row
    // carries the CALLING household's id in its own column, so every read
    // that filters on householdId still finds it, but its merchantId pointed
    // wherever the caller said: the schema's foreign key on
    // MerchantRule.merchantId references Merchant.id with no household
    // component, so the database permits a declaration in household A that
    // names a merchant owned by household B. WITNESSED against real Postgres
    // before this fix: a cross-household insert succeeded, threw nothing, and
    // created the row. CLAUDE.md non-negotiable 6 is not a severity
    // judgement, so this is not one either.
    //
    // upsertRule, above in this same file, has always made exactly this
    // check and calls a foreign merchantId "a bug or an attack". The fake
    // repository the fast gate binds routes its inserts through upsertRule,
    // so the fake was STRICTER than the adapter it stands in for and could
    // not have caught this: the real-database spec is what pins it, with an
    // INSERT submitted ALONE so the update loop cannot throw first.
    const insertedMerchantIds = [
      ...new Set(input.inserts.map((insert) => insert.merchantId)),
    ];
    if (insertedMerchantIds.length > 0) {
      const owned = await tx.merchant.findMany({
        where: {
          id: { in: insertedMerchantIds },
          householdId: context.householdId,
        },
        select: { id: true },
      });
      if (owned.length !== insertedMerchantIds.length) {
        throw new Error(
          "applyRuleWrites: one or more inserted rules point at a merchant that does not belong to the household",
        );
      }
    }
    for (const insert of input.inserts) {
      await tx.merchantRule.create({
        data: {
          householdId: context.householdId,
          merchantId: insert.merchantId,
          kind: insert.kind,
          pattern: insert.pattern,
        },
      });
    }
  });
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
