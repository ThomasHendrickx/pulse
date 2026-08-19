-- CreateTable
CREATE TABLE "transfer_links" (
    "id" UUID NOT NULL,
    "householdId" UUID NOT NULL,
    "outgoingTransactionId" UUID NOT NULL,
    "incomingTransactionId" UUID,
    "settlementImportId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "transfer_links_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "transfer_links_householdId_idx" ON "transfer_links"("householdId");

-- CreateIndex
CREATE UNIQUE INDEX "transfer_links_outgoingTransactionId_key" ON "transfer_links"("outgoingTransactionId");

-- CreateIndex
CREATE UNIQUE INDEX "transfer_links_incomingTransactionId_key" ON "transfer_links"("incomingTransactionId");

-- AddForeignKey
ALTER TABLE "transfer_links" ADD CONSTRAINT "transfer_links_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "households"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transfer_links" ADD CONSTRAINT "transfer_links_outgoingTransactionId_fkey" FOREIGN KEY ("outgoingTransactionId") REFERENCES "transactions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transfer_links" ADD CONSTRAINT "transfer_links_incomingTransactionId_fkey" FOREIGN KEY ("incomingTransactionId") REFERENCES "transactions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transfer_links" ADD CONSTRAINT "transfer_links_settlementImportId_fkey" FOREIGN KEY ("settlementImportId") REFERENCES "imports"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Enable ROW LEVEL SECURITY on the new table, the same backstop every
-- public table carries (orchestrator amendment A, M1-P2 migration). No
-- policies in v1: the app connects as table owner; test/schema/rls.test.ts
-- derives the table list from the Prisma schema and reddens without this.
ALTER TABLE "transfer_links" ENABLE ROW LEVEL SECURITY;
