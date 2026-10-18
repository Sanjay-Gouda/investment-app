import { Prisma, type Valuation } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';
import { getCashBalance } from './ledger.service';
import { getLatestPrice, fetchAllActivePrices } from './market-price.service';

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
  return prisma.valuation.upsert({
    where: { accountId_valuationDate_isRestated: { accountId, valuationDate: day, isRestated: false } },
    update: {
      totalValueCents: data.totalValueCents,
      cashCents: data.cashCents,
      investedValueCents: data.investedValueCents,
      returnPct: twrPct,
      twrPct,
    },
    create: {
      accountId,
      valuationDate: day,
      totalValueCents: data.totalValueCents,
      cashCents: data.cashCents,
      investedValueCents: data.investedValueCents,
      returnPct: twrPct,
      twrPct,
      isRestated: false,
    },
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

/** Latest snapshot for an account. */
export async function getLatestValuation(accountId: string): Promise<Valuation | null> {
  return prisma.valuation.findFirst({
    where: { accountId, isRestated: false },
    orderBy: { valuationDate: 'desc' },
  });
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
      await storeValuation(account.id, today, data, new Prisma.Decimal(0));
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
