import { Prisma, type Valuation } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';
import { calculateAccountValuation } from './valuation.service';
import { calculateTWR } from './twr.service';

/**
 * Restatement machinery — bitemporal corrections.
 *
 * When a custodian sends a corrected close for a past date, we NEVER rewrite
 * history. We add new rows: a restated MarketPrice (isRestated=true) and a
 * restated Valuation (same valuationDate, new bookingDate). The originals stay
 * queryable forever, which is what makes the figures auditable.
 */

function startOfUtcDay(d: Date): Date {
  const x = new Date(d);
  x.setUTCHours(0, 0, 0, 0);
  return x;
}

async function inceptionDate(accountId: string): Promise<Date> {
  const first = await prisma.ledgerEntry.findFirst({
    where: { accountId },
    orderBy: { effectiveDate: 'asc' },
    select: { effectiveDate: true },
  });
  return first?.effectiveDate ?? new Date();
}

export interface PriceCorrection {
  symbol: string;
  date: Date;
  originalPriceCents: bigint;
  correctPriceCents: bigint;
  differenceCents: bigint;
}

/**
 * Record a corrected closing price as a NEW row (isRestated=true). The original
 * (isRestated=false) row is never touched. Re-correcting updates the restated row.
 */
export async function correctPrice(
  symbol: string,
  date: Date,
  correctPriceCents: bigint,
  reason: string,
): Promise<PriceCorrection> {
  const day = startOfUtcDay(date);
  const original = await prisma.marketPrice.findFirst({
    where: { symbol, date: day, isRestated: false },
    orderBy: { createdAt: 'desc' },
  });
  if (!original) {
    throw new Error(`No price found for ${symbol} on ${day.toISOString().slice(0, 10)}`);
  }
  const originalPriceCents = original.closePriceCents;

  await prisma.marketPrice.upsert({
    where: { symbol_date_isRestated: { symbol, date: day, isRestated: true } },
    update: {
      closePriceCents: correctPriceCents,
      originalPriceCents,
      restatementReason: reason,
      restatementDate: new Date(),
      source: 'restatement',
      isStale: false,
    },
    create: {
      symbol,
      date: day,
      closePriceCents: correctPriceCents,
      isRestated: true,
      originalPriceCents,
      restatementReason: reason,
      restatementDate: new Date(),
      source: 'restatement',
    },
  });

  logger.info('Price corrected (restated row added)', {
    symbol,
    date: day.toISOString().slice(0, 10),
    was: originalPriceCents.toString(),
    corrected: correctPriceCents.toString(),
  });

  return {
    symbol,
    date: day,
    originalPriceCents,
    correctPriceCents,
    differenceCents: correctPriceCents - originalPriceCents,
  };
}

export interface RestatementResult {
  accountId: string;
  valuationDate: string;
  original: { totalValueCents: string; twrPct: string; bookingDate: string };
  restated: { totalValueCents: string; twrPct: string; bookingDate: string };
  differenceCents: string;
}

/**
 * Add a restated valuation for one account/date using the corrected prices.
 * Creates a NEW row; the original valuation is never modified.
 */
export async function restateAccountValuation(
  accountId: string,
  valuationDate: Date,
  reason: string,
  correctedPrices: Prisma.InputJsonValue,
): Promise<RestatementResult> {
  const day = startOfUtcDay(valuationDate);
  const original = await prisma.valuation.findFirst({
    where: { accountId, valuationDate: day, isRestated: false },
  });
  if (!original) {
    throw new Error(`No original valuation for ${accountId} on ${day.toISOString().slice(0, 10)}`);
  }

  // Recompute value with the corrected price (getLatestPrice now returns it).
  const data = await calculateAccountValuation(accountId, day);

  // Create the restated row first (placeholder TWR), so the effective series for
  // this date is the corrected value when we recompute TWR.
  const restated = await prisma.valuation.create({
    data: {
      accountId,
      valuationDate: day,
      bookingDate: new Date(),
      totalValueCents: data.totalValueCents,
      cashCents: data.cashCents,
      investedValueCents: data.investedValueCents,
      returnPct: original.twrPct,
      twrPct: original.twrPct,
      isRestated: true,
      restatementReason: reason,
      originalTotalValueCents: original.totalValueCents,
      originalTwrPct: original.twrPct,
      originalBookingDate: original.bookingDate,
      correctedPrices,
    },
  });

  // Recalculate TWR through the corrected date and write it onto the restated row.
  const inception = await inceptionDate(accountId);
  const twr = await calculateTWR(accountId, inception, day);
  const twrDec = new Prisma.Decimal(twr.twrPct).toDecimalPlaces(6);
  const finalRestated = await prisma.valuation.update({
    where: { id: restated.id },
    data: { twrPct: twrDec, returnPct: twrDec },
  });

  return {
    accountId,
    valuationDate: day.toISOString(),
    original: {
      totalValueCents: original.totalValueCents.toString(),
      twrPct: original.twrPct.toString(),
      bookingDate: original.bookingDate.toISOString(),
    },
    restated: {
      totalValueCents: finalRestated.totalValueCents.toString(),
      twrPct: finalRestated.twrPct.toString(),
      bookingDate: finalRestated.bookingDate.toISOString(),
    },
    differenceCents: (finalRestated.totalValueCents - original.totalValueCents).toString(),
  };
}

/**
 * Full flow: correct a price, then restate every affected account's valuation
 * for that date.
 */
export async function restateValuationsAfterPriceCorrection(
  symbol: string,
  correctedDate: Date,
  correctPriceCents: bigint,
  reason: string,
): Promise<{
  correctedPrice: { symbol: string; date: string; wasCents: string; correctedCents: string };
  affectedAccounts: number;
  restatements: RestatementResult[];
}> {
  const correction = await correctPrice(symbol, correctedDate, correctPriceCents, reason);
  const correctedPrices = {
    [symbol]: { was: Number(correction.originalPriceCents), corrected: Number(correctPriceCents) },
  };

  const positions = await prisma.position.findMany({ where: { symbol }, select: { accountId: true } });
  const accountIds = [...new Set(positions.map((p) => p.accountId))];

  const restatements: RestatementResult[] = [];
  for (const accountId of accountIds) {
    try {
      restatements.push(await restateAccountValuation(accountId, correctedDate, reason, correctedPrices));
    } catch (err) {
      logger.warn('Skipped restatement (no original valuation)', {
        accountId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return {
    correctedPrice: {
      symbol,
      date: correction.date.toISOString(),
      wasCents: correction.originalPriceCents.toString(),
      correctedCents: correctPriceCents.toString(),
    },
    affectedAccounts: restatements.length,
    restatements,
  };
}

/** What we believed on `asOfBookingDate` (latest booking ≤ that moment). */
export async function getValuationAsPublished(
  accountId: string,
  valuationDate: Date,
  asOfBookingDate: Date,
): Promise<Valuation | null> {
  return prisma.valuation.findFirst({
    where: { accountId, valuationDate: startOfUtcDay(valuationDate), bookingDate: { lte: asOfBookingDate } },
    orderBy: { bookingDate: 'desc' },
  });
}

/** The current (possibly restated) valuation for a date. */
export async function getValuationAsRestated(accountId: string, valuationDate: Date): Promise<Valuation | null> {
  return prisma.valuation.findFirst({
    where: { accountId, valuationDate: startOfUtcDay(valuationDate) },
    orderBy: { bookingDate: 'desc' },
  });
}

/** Every restatement ever made for an account. */
export async function getRestatementHistory(accountId: string) {
  const rows = await prisma.valuation.findMany({
    where: { accountId, isRestated: true },
    orderBy: { bookingDate: 'desc' },
  });
  return rows.map((r) => ({
    valuationDate: r.valuationDate.toISOString(),
    restatementDate: r.bookingDate.toISOString(),
    reason: r.restatementReason,
    original: {
      totalValueCents: r.originalTotalValueCents?.toString() ?? null,
      twrPct: r.originalTwrPct?.toString() ?? null,
      bookingDate: r.originalBookingDate?.toISOString() ?? null,
    },
    corrected: { totalValueCents: r.totalValueCents.toString(), twrPct: r.twrPct.toString() },
    differenceCents:
      r.originalTotalValueCents != null ? (r.totalValueCents - r.originalTotalValueCents).toString() : null,
    correctedPrices: r.correctedPrices,
  }));
}

export const restatementService = {
  correctPrice,
  restateAccountValuation,
  restateValuationsAfterPriceCorrection,
  getValuationAsPublished,
  getValuationAsRestated,
  getRestatementHistory,
};
export default restatementService;
