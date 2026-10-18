import { Prisma, type Valuation } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';
import { getCashBalance } from './ledger.service';
import { getLatestPrice, fetchAllActivePrices } from './market-price.service';
// NOTE: twr.service imports from this module too — a benign circular import.
// Both only reference each other inside functions, so CommonJS resolves fine.
import { updateValuationWithTWR } from './twr.service';

/**
 * Valuation service — daily account snapshots.
 *
 * Value = Σ(units × price) + cash. Units are Decimal(20,6); money is BigInt
 * cents. Decimal × price math is done in Decimal and converted to BigInt only at
 * the end. Each snapshot is immutable (upsert keyed by day so re-runs are
 * idempotent). TWR is a placeholder 0 here — Step 8 computes it properly.
 */

function startOfUtcDay(d: Date): Date {
  const x = new Date(d);
  x.setUTCHours(0, 0, 0, 0);
  return x;
}

const STALE_AFTER_DAYS = 3;

export interface PositionValue {
  symbol: string;
  units: string;
  priceCents: string;
  valueCents: string;
  missing?: boolean;
}

export interface AccountValuation {
  accountId: string;
  valuationDate: Date;
  cashCents: bigint;
  investedValueCents: bigint;
  totalValueCents: bigint;
  positionValues: PositionValue[];
  hasStalePrice: boolean;
}

/** Compute (without storing) an account's value as of a date. */
export async function calculateAccountValuation(
  accountId: string,
  valuationDate: Date,
): Promise<AccountValuation> {
  const cashCents = await getCashBalance(accountId);
  const positions = await prisma.position.findMany({ where: { accountId, units: { gt: 0 } } });

  const positionValues: PositionValue[] = [];
  let investedValueCents = 0n;
  let hasStalePrice = false;

  for (const p of positions) {
    try {
      const { priceCents, isStale, daysOld } = await getLatestPrice(p.symbol, valuationDate);
      // Decimal math, converted to BigInt cents only at the very end.
      const valueCents = BigInt(p.units.times(priceCents.toString()).toFixed(0));
      investedValueCents += valueCents;
      if (isStale || daysOld > STALE_AFTER_DAYS) hasStalePrice = true;
      positionValues.push({
        symbol: p.symbol,
        units: p.units.toString(),
        priceCents: priceCents.toString(),
        valueCents: valueCents.toString(),
      });
    } catch {
      // No price at all — count as zero, flag stale, never crash.
      hasStalePrice = true;
      positionValues.push({
        symbol: p.symbol,
        units: p.units.toString(),
        priceCents: '0',
        valueCents: '0',
        missing: true,
      });
    }
  }

  const totalValueCents = cashCents + investedValueCents;
  return { accountId, valuationDate, cashCents, investedValueCents, totalValueCents, positionValues, hasStalePrice };
}

/** Persist a valuation snapshot (idempotent per day via upsert). */
export async function storeValuation(
  accountId: string,
  valuationDate: Date,
  data: AccountValuation,
  twrPct: Prisma.Decimal = new Prisma.Decimal(0),
): Promise<Valuation> {
  const day = startOfUtcDay(valuationDate);
  // Manual upsert of the ORIGINAL (isRestated=false) row — there is no longer a
  // unique constraint (restatements add extra rows per date).
  const existing = await prisma.valuation.findFirst({
    where: { accountId, valuationDate: day, isRestated: false },
  });
  const fields = {
    totalValueCents: data.totalValueCents,
    cashCents: data.cashCents,
    investedValueCents: data.investedValueCents,
    returnPct: twrPct,
    twrPct,
  };
  if (existing) {
    return prisma.valuation.update({ where: { id: existing.id }, data: fields });
  }
  return prisma.valuation.create({
    data: { accountId, valuationDate: day, isRestated: false, ...fields },
  });
}

/** Valuation history (ascending), optionally bounded by date. */
export async function getValuationHistory(
  accountId: string,
  startDate?: Date,
  endDate?: Date,
): Promise<Valuation[]> {
  return prisma.valuation.findMany({
    where: {
      accountId,
      ...(startDate || endDate
        ? { valuationDate: { ...(startDate ? { gte: startDate } : {}), ...(endDate ? { lte: endDate } : {}) } }
        : {}),
    },
    orderBy: [{ valuationDate: 'asc' }, { isRestated: 'asc' }],
  });
}

/** Snapshot as of a date; falls back to the most recent prior (interpolated). */
export async function getValuationAsOf(
  accountId: string,
  asOfDate: Date,
): Promise<(Valuation & { interpolated: boolean }) | null> {
  const day = startOfUtcDay(asOfDate);
  const row = await prisma.valuation.findFirst({
    where: { accountId, isRestated: false, valuationDate: { lte: new Date(day.getTime() + 86_400_000 - 1) } },
    orderBy: { valuationDate: 'desc' },
  });
  if (!row) return null;
  const interpolated = startOfUtcDay(row.valuationDate).getTime() !== day.getTime();
  return { ...row, interpolated };
}

/** Latest EFFECTIVE snapshot (newest value date, newest booking = corrected). */
export async function getLatestValuation(accountId: string): Promise<Valuation | null> {
  return prisma.valuation.findFirst({
    where: { accountId },
    orderBy: [{ valuationDate: 'desc' }, { bookingDate: 'desc' }],
  });
}

/**
 * The EFFECTIVE value series: one row per valuationDate — the latest booking
 * (so a restatement supersedes the original). This is the "current truth" the
 * TWR and charts should use, while originals stay untouched for audit.
 */
export async function getEffectiveValuationHistory(
  accountId: string,
  startDate: Date,
  endDate: Date,
): Promise<{ valuationDate: Date; totalValueCents: bigint }[]> {
  return prisma.$queryRaw<{ valuationDate: Date; totalValueCents: bigint }[]>`
    SELECT DISTINCT ON ("valuationDate") "valuationDate", "totalValueCents"
    FROM "Valuation"
    WHERE "accountId" = ${accountId}
      AND "valuationDate" >= ${startDate}
      AND "valuationDate" <= ${endDate}
    ORDER BY "valuationDate" ASC, "bookingDate" DESC
  `;
}

/**
 * The daily job: fetch prices, value every ACTIVE account, store snapshots.
 * TWR is 0 for now (Step 8). Per-account failures are collected, not thrown.
 */
export async function runDailyValuation(): Promise<{
  accountsValued: number;
  pricesFetched: string[];
  errors: string[];
}> {
  logger.info('Starting daily valuation job');
  const prices = await fetchAllActivePrices();
  const accounts = await prisma.account.findMany({ where: { status: 'ACTIVE' } });

  const errors: string[] = [];
  let accountsValued = 0;
  const today = new Date();

  for (const account of accounts) {
    try {
      const data = await calculateAccountValuation(account.id, today);
      // Store the snapshot first (so today's value is in the series), then
      // compute TWR-since-inception and write it onto the snapshot.
      await storeValuation(account.id, today, data, new Prisma.Decimal(0));
      await updateValuationWithTWR(account.id, today);
      accountsValued++;
      logger.info(`Valued account ${account.id}: $${(Number(data.totalValueCents) / 100).toFixed(2)}`, {
        hasStalePrice: data.hasStalePrice,
      });
    } catch (err) {
      const msg = `${account.id}: ${err instanceof Error ? err.message : String(err)}`;
      errors.push(msg);
      logger.error('Valuation failed for account', { error: msg });
    }
  }

  logger.info(`Daily valuation complete. Valued ${accountsValued} accounts`, {
    pricesFetched: prices.fetched,
    failed: prices.failed,
  });
  return { accountsValued, pricesFetched: prices.fetched, errors };
}

export const valuationService = {
  calculateAccountValuation,
  storeValuation,
  getValuationHistory,
  getValuationAsOf,
  getLatestValuation,
  runDailyValuation,
};
export default valuationService;
