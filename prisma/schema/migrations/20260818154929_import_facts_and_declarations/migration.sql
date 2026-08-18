-- CreateEnum
CREATE TYPE "AccountRole" AS ENUM ('POT', 'RESERVE');

-- CreateEnum
CREATE TYPE "ImportStatus" AS ENUM ('PARSED', 'AWAITING_DECLARATION', 'INGESTED', 'INTERPRETED', 'FAILED');

-- CreateEnum
CREATE TYPE "Flow" AS ENUM ('INCOME', 'SPEND', 'INTERNAL', 'RESERVE', 'UNRESOLVED');

-- CreateTable
CREATE TABLE "accounts" (
    "id" UUID NOT NULL,
    "householdId" UUID NOT NULL,
    "label" TEXT NOT NULL,
    "bank" TEXT NOT NULL,
    "role" "AccountRole" NOT NULL,
    "iban" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "source_profiles" (
    "id" UUID NOT NULL,
    "householdId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "spec" JSONB NOT NULL,
    "accountId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "source_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "imports" (
    "id" UUID NOT NULL,
    "householdId" UUID NOT NULL,
    "sourceProfileId" UUID,
    "accountId" UUID,
    "status" "ImportStatus" NOT NULL,
    "fileName" TEXT NOT NULL,
    "rawContent" BYTEA NOT NULL,
    "rowsAdded" INTEGER,
    "rowsKnown" INTEGER,
    "failureReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "imports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transactions" (
    "id" UUID NOT NULL,
    "householdId" UUID NOT NULL,
    "accountId" UUID NOT NULL,
    "importId" UUID NOT NULL,
    "bookingDate" DATE NOT NULL,
    "valueDate" DATE,
    "amountCents" INTEGER NOT NULL,
    "counterpartyName" TEXT,
    "counterpartyIban" TEXT,
    "description" TEXT NOT NULL,
    "reference" TEXT,
    "statementNumber" TEXT,
    "sequenceNumber" TEXT,
    "rawLine" TEXT NOT NULL,
    "dedupKey" TEXT NOT NULL,
    "flow" "Flow",
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "transactions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "accounts_householdId_idx" ON "accounts"("householdId");

-- CreateIndex
CREATE UNIQUE INDEX "accounts_householdId_iban_key" ON "accounts"("householdId", "iban");

-- CreateIndex
CREATE INDEX "source_profiles_householdId_idx" ON "source_profiles"("householdId");

-- CreateIndex
CREATE UNIQUE INDEX "source_profiles_householdId_name_key" ON "source_profiles"("householdId", "name");

-- CreateIndex
CREATE INDEX "imports_householdId_idx" ON "imports"("householdId");

-- CreateIndex
CREATE INDEX "transactions_householdId_accountId_bookingDate_idx" ON "transactions"("householdId", "accountId", "bookingDate");

-- CreateIndex
CREATE UNIQUE INDEX "transactions_householdId_dedupKey_key" ON "transactions"("householdId", "dedupKey");

-- AddForeignKey
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "households"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "source_profiles" ADD CONSTRAINT "source_profiles_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "households"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "source_profiles" ADD CONSTRAINT "source_profiles_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "imports" ADD CONSTRAINT "imports_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "households"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "imports" ADD CONSTRAINT "imports_sourceProfileId_fkey" FOREIGN KEY ("sourceProfileId") REFERENCES "source_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "imports" ADD CONSTRAINT "imports_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "households"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_importId_fkey" FOREIGN KEY ("importId") REFERENCES "imports"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Enable ROW LEVEL SECURITY on every public table, existing and new
-- (orchestrator amendment A, the charter's declared backstop). No policies
-- in v1: the application connects as table owner via Prisma, and a table
-- owner bypasses RLS, so behaviour is unchanged; any OTHER role loses all
-- access until a policy grants it, which is exactly the backstop. Every
-- later migration that creates a table must enable RLS on it too;
-- test/schema/rls.test.ts derives the table list from the Prisma schema
-- and reddens when one is missing.
ALTER TABLE "households" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "users" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "accounts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "source_profiles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "imports" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "transactions" ENABLE ROW LEVEL SECURITY;
