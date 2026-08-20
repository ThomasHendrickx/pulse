-- CreateEnum
CREATE TYPE "MerchantRuleKind" AS ENUM ('EXACT', 'PREFIX', 'PATTERN');

-- AlterTable
ALTER TABLE "transactions" ADD COLUMN     "merchantId" UUID;

-- CreateTable
CREATE TABLE "merchants" (
    "id" UUID NOT NULL,
    "householdId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "merchants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "merchant_rules" (
    "id" UUID NOT NULL,
    "householdId" UUID NOT NULL,
    "merchantId" UUID NOT NULL,
    "kind" "MerchantRuleKind" NOT NULL,
    "pattern" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "merchant_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tags" (
    "id" UUID NOT NULL,
    "householdId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "merchant_tags" (
    "id" UUID NOT NULL,
    "householdId" UUID NOT NULL,
    "merchantId" UUID NOT NULL,
    "tagId" UUID NOT NULL,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "merchant_tags_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "merchants_householdId_idx" ON "merchants"("householdId");

-- CreateIndex
CREATE UNIQUE INDEX "merchants_householdId_name_key" ON "merchants"("householdId", "name");

-- CreateIndex
CREATE INDEX "merchant_rules_householdId_idx" ON "merchant_rules"("householdId");

-- CreateIndex
CREATE UNIQUE INDEX "merchant_rules_householdId_kind_pattern_key" ON "merchant_rules"("householdId", "kind", "pattern");

-- CreateIndex
CREATE INDEX "tags_householdId_idx" ON "tags"("householdId");

-- CreateIndex
CREATE UNIQUE INDEX "tags_householdId_name_key" ON "tags"("householdId", "name");

-- CreateIndex
CREATE INDEX "merchant_tags_householdId_idx" ON "merchant_tags"("householdId");

-- CreateIndex
CREATE UNIQUE INDEX "merchant_tags_merchantId_tagId_key" ON "merchant_tags"("merchantId", "tagId");

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "merchants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "merchants" ADD CONSTRAINT "merchants_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "households"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "merchant_rules" ADD CONSTRAINT "merchant_rules_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "households"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "merchant_rules" ADD CONSTRAINT "merchant_rules_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "merchants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tags" ADD CONSTRAINT "tags_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "households"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "merchant_tags" ADD CONSTRAINT "merchant_tags_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "households"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "merchant_tags" ADD CONSTRAINT "merchant_tags_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "merchants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "merchant_tags" ADD CONSTRAINT "merchant_tags_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "tags"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Row level security (Amendment A, carried from the M1-P1 review): enabled
-- on every new table. No policies in v1; the app connects as table owner,
-- so behaviour is unchanged and RLS-on is the declared backstop
-- (pulse-domain section 10). test/schema/rls.test.ts derives this list
-- from the Prisma schema and reds if any table below loses its statement.
ALTER TABLE "merchants" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "merchant_rules" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tags" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "merchant_tags" ENABLE ROW LEVEL SECURITY;
