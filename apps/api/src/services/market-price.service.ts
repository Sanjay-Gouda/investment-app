import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';

/**
 * Market price service — fetches daily closing prices from Alpaca's data API
 * and persists them as immutable MarketPrice snapshots. Valuation reads prices
 * from here (the DB), never live, so a snapshot is reproducible.
 *
 * Resilience: a failed fetch never crashes the caller — the last known price is
 * flagged stale and we move on.
 */

const DATA_BASE = (process.env.ALPACA_DATA_URL || 'https://data.alpaca.markets').replace(/\/$/, '');

function alpacaHeaders(): Record<string, string> {
  return {
    'APCA-API-KEY-ID': process.env.ALPACA_API_KEY ?? '',
    'APCA-API-SECRET-KEY': process.env.ALPACA_API_SECRET ?? '',
  };
}

/** UTC midnight for a date — our canonical per-day key. */
function startOfUtcDay(d: Date): Date {
  const x = new Date(d);
  x.setUTCHours(0, 0, 0, 0);
  return x;
}

export interface LatestPrice {
  priceCents: bigint;
  date: Date;
  isStale: boolean;
  daysOld: number;
}

/**
 * Fetch the most recent daily close for a symbol from Alpaca (IEX feed) and
 * upsert it into MarketPrice under `date`. Uses a small lookback window and
 * takes the latest bar, so it still resolves on weekends/holidays.
 *
 * @returns the close price in cents.
 * @throws if Alpaca returns no bars (caller decides how to degrade).
 */
export async function fetchAndStorePrice(symbol: string, date: Date): Promise<bigint> {
  const day = startOfUtcDay(date);
  const start = new Date(day.getTime() - 7 * 86_400_000).toISOString();
  const end = new Date(day.getTime() + 86_400_000 - 1).toISOString();

  const url =
    `${DATA_BASE}/v2/stocks/${symbol}/bars` +
    `?timeframe=1Day&start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}` +
    `&feed=iex&limit=10&sort=asc`;

  const r = await fetch(url, { headers: alpacaHeaders() });
  if (!r.ok) {
    throw new Error(`Alpaca bars ${symbol} failed: ${r.status} ${(await r.text()).slice(0, 120)}`);
  }
  const j = (await r.json()) as { bars?: Array<{ c: number; t: string }> };
  const bars = j.bars ?? [];
  if (bars.length === 0) throw new Error(`No bars returned for ${symbol}`);

  const close = bars[bars.length - 1].c; // most recent close in the window
  const priceCents = BigInt(Math.round(close * 100));

  await prisma.marketPrice.upsert({
    where: { symbol_date: { symbol, date: day } },
    update: { closePriceCents: priceCents, isStale: false, source: 'alpaca' },
    create: { symbol, date: day, closePriceCents: priceCents, isStale: false, source: 'alpaca' },
  });

  logger.info('Stored market price', { symbol, priceCents: priceCents.toString() });
  return priceCents;
}

/**
 * Most recent known price for a symbol as of a date (from the DB), with how
 * stale it is.
 * @throws "No price available for {symbol}" if nothing is stored.
 */
export async function getLatestPrice(symbol: string, asOfDate: Date = new Date()): Promise<LatestPrice> {
  const asOf = startOfUtcDay(asOfDate);
  const row = await prisma.marketPrice.findFirst({
    where: { symbol, date: { lte: new Date(asOf.getTime() + 86_400_000 - 1) } },
    orderBy: { date: 'desc' },
  });
  if (!row) throw new Error(`No price available for ${symbol}`);

  const daysOld = Math.max(0, Math.floor((asOf.getTime() - startOfUtcDay(row.date).getTime()) / 86_400_000));
  return { priceCents: row.closePriceCents, date: row.date, isStale: row.isStale, daysOld };
}

/** Flag a specific snapshot stale (or the latest one when no date is given). */
export async function markPriceStale(symbol: string, date?: Date): Promise<void> {
  if (date) {
    await prisma.marketPrice.updateMany({ where: { symbol, date: startOfUtcDay(date) }, data: { isStale: true } });
    return;
  }
  const latest = await prisma.marketPrice.findFirst({ where: { symbol }, orderBy: { date: 'desc' } });
  if (latest) {
    await prisma.marketPrice.update({ where: { id: latest.id }, data: { isStale: true } });
  }
}

/**
 * Fetch today's price for every symbol currently held. A per-symbol failure is
 * logged, the last known price is marked stale, and we continue.
 */
export async function fetchAllActivePrices(): Promise<{ fetched: string[]; failed: string[]; stale: string[] }> {
  const rows = await prisma.position.findMany({
    where: { units: { gt: 0 } },
    distinct: ['symbol'],
    select: { symbol: true },
  });
  const symbols = rows.map((r) => r.symbol);

  const fetched: string[] = [];
  const failed: string[] = [];
  const stale: string[] = [];
  const today = new Date();

  for (const symbol of symbols) {
    try {
      await fetchAndStorePrice(symbol, today);
      fetched.push(symbol);
    } catch (err) {
      logger.warn(`Failed to fetch price for ${symbol}`, {
        error: err instanceof Error ? err.message : String(err),
      });
      await markPriceStale(symbol);
      failed.push(symbol);
      stale.push(symbol);
    }
  }
  return { fetched, failed, stale };
}

export const marketPriceService = {
  fetchAndStorePrice,
  getLatestPrice,
  markPriceStale,
  fetchAllActivePrices,
};
export default marketPriceService;
