-- AlterTable
ALTER TABLE "ReconciliationBreak" ADD COLUMN     "accountId" TEXT,
ADD COLUMN     "description" TEXT,
ADD COLUMN     "resolution" TEXT;

-- CreateTable
CREATE TABLE "CustodianFile" (
    "id" TEXT NOT NULL,
    "fileDate" TIMESTAMP(3) NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'SIMULATED_CUSTODIAN',
    "rawData" JSONB NOT NULL,
    "processedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CustodianFile_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CustodianFile_fileDate_idx" ON "CustodianFile"("fileDate");

-- CreateIndex
CREATE INDEX "ReconciliationBreak_status_agingDays_idx" ON "ReconciliationBreak"("status", "agingDays");
