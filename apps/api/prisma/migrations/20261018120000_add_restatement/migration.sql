-- Restatement / bitemporality support.

-- Valuation: drop the single-restated-row uniqueness (we now allow many rows
-- per (account, valuationDate): the original + N restatements).
ALTER TABLE "Valuation" DROP CONSTRAINT IF EXISTS "Valuation_accountId_valuationDate_isRestated_key";
DROP INDEX IF EXISTS "Valuation_accountId_valuationDate_isRestated_key";

-- Valuation: bitemporal + restatement columns.
ALTER TABLE "Valuation" ADD COLUMN "bookingDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "Valuation" ADD COLUMN "restatementReason" TEXT;
ALTER TABLE "Valuation" ADD COLUMN "originalTotalValueCents" BIGINT;
ALTER TABLE "Valuation" ADD COLUMN "originalBookingDate" TIMESTAMP(3);
ALTER TABLE "Valuation" ADD COLUMN "correctedPrices" JSONB;

-- Backfill bookingDate = createdAt for existing rows (their true record time).
UPDATE "Valuation" SET "bookingDate" = "createdAt";

-- Drop the obsolete original-value column (always null in existing data).
ALTER TABLE "Valuation" DROP COLUMN IF EXISTS "originalValueCents";

CREATE INDEX "Valuation_accountId_valuationDate_bookingDate_idx"
  ON "Valuation"("accountId", "valuationDate", "bookingDate");

-- MarketPrice: restatement columns; widen uniqueness to include isRestated so a
-- correction can coexist with the original for the same symbol+date.
ALTER TABLE "MarketPrice" ADD COLUMN "isRestated" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "MarketPrice" ADD COLUMN "originalPriceCents" BIGINT;
ALTER TABLE "MarketPrice" ADD COLUMN "restatementReason" TEXT;
ALTER TABLE "MarketPrice" ADD COLUMN "restatementDate" TIMESTAMP(3);

DROP INDEX IF EXISTS "MarketPrice_symbol_date_key";
CREATE UNIQUE INDEX "MarketPrice_symbol_date_isRestated_key"
  ON "MarketPrice"("symbol", "date", "isRestated");
