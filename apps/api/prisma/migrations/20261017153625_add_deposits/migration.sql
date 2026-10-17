-- CreateEnum
CREATE TYPE "DepositStatus" AS ENUM ('PENDING', 'SETTLED', 'RETURNED');

-- AlterTable
ALTER TABLE "Account" ADD COLUMN     "bankAccountLast4" TEXT,
ADD COLUMN     "bankName" TEXT,
ADD COLUMN     "plaidAccessToken" TEXT,
ADD COLUMN     "plaidAccountId" TEXT,
ADD COLUMN     "plaidItemId" TEXT;

-- CreateTable
CREATE TABLE "Deposit" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "amountCents" BIGINT NOT NULL,
    "status" "DepositStatus" NOT NULL DEFAULT 'PENDING',
    "plaidItemId" TEXT,
    "settlementDate" TIMESTAMP(3) NOT NULL,
    "settledAt" TIMESTAMP(3),
    "returnedAt" TIMESTAMP(3),
    "returnReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Deposit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Deposit_accountId_status_idx" ON "Deposit"("accountId", "status");

-- AddForeignKey
ALTER TABLE "Deposit" ADD CONSTRAINT "Deposit_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
