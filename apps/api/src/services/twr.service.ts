import { Prisma, type Valuation } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';
import { getValuationHistory } from './valuation.service';

/**
 * Time-Weighted Return (TWR) — the industry-standard performance measure.
 *
 * TWR = Π(1 + Rᵢ) − 1, where each sub-period return
 *   Rᵢ = (End − Start − CashFlow) / (Start + CashFlow)
 * External cash flows (deposits/withdrawals) are removed from the numerator and
 * added to the capital base, so they NEVER inflate the return — a deposit is not
 * a return. ALL math is Decimal (never JS floats).
 *
 * Cash flows here are value-affecting external flows only. Because deposits are
 * booked with the bucket model (a CASH_DEPOSIT has an IN_TRANSIT + an EXTERNAL
 * leg that net to zero, and settlement moves it into SETTLED_CASH), we sum only
 * the non-counter-bucket legs — the same filter as the cash balance.
 */

const D0 = new Prisma.Decimal(0);
const D1 = new Prisma.Decimal(1);

export interface SubPeriod {
  start: string;
  end: string;
  startValueCents: string;
  endValueCents: string;
  cashFlowCents: string;
  returnPct: string;
}

export interface TWRResult {
  twrPct: string;
  twrDisplay: string;
  subPeriods: SubPeriod[];
  startDate: string;
  endDate: string;
  startValueCents: string;
  endValueCents: string;
  totalCashFlowsCents: string;
}

/** Format a decimal return (0.0234) as "+2.34%". */
function display(twr: Prisma.Decimal): string {
  const pct = twr.times(100).toDecimalPlaces(2);
  return `${pct.gte(0) ? '+' : ''}${pct.toString()}%`;
}

function emptyResult(startDate: Date, endDate: Date): TWRResult {
  return {
    twrPct: '0',
    twrDisplay: '+0.00%',
    subPeriods: [],
    startDate: startDate.toISOString(),
    endDate: endDate.toISOString(),
    startValueCents: '0',
    endValueCents: '0',
    totalCashFlowsCents: '0',
  };
}

/**
 * One sub-period's return as a Decimal.
 * denominator ≤ 0 (no capital at start) → 0.
 */
export function calculateSubPeriodReturn(
  startValueCents: bigint,
  endValueCents: bigint,
  cashFlowsCents: bigint,
): Prisma.Decimal {
  const start = new Prisma.Decimal(startValueCents.toString());
  const end = new Prisma.Decimal(endValueCents.toString());
  const cf = new Prisma.Decimal(cashFlowsCents.toString());
  const denom = start.plus(cf);
  if (denom.lte(0)) return D0;
  return end.minus(start).minus(cf).div(denom);
}

/**
 * Net external cash flow (value-affecting legs only) for (afterExclusive, untilInclusive].
 * Excludes the IN_TRANSIT/EXTERNAL counter legs so a deposit counts once, at
 * settlement. Dividends are NOT cash flows (they are return).
 */
async function netCashFlowCents(accountId: string, afterExclusive: Date, untilInclusive: Date): Promise<bigint> {
  const rows = await prisma.$queryRaw<{ cf: bigint }[]>`
    SELECT CAST(COALESCE(SUM(amount), 0) AS BIGINT) AS cf
    FROM "LedgerEntry"
    WHERE "accountId" = ${accountId}
      AND "effectiveDate" > ${afterExclusive}
      AND "effectiveDate" <= ${untilInclusive}
      AND "type" IN ('CASH_DEPOSIT', 'CASH_WITHDRAWAL', 'CASH_DEPOSIT_RETURN')
      AND COALESCE(metadata->>'bucket', '') NOT IN ('IN_TRANSIT', 'EXTERNAL')
  `;
  return rows[0]?.cf ?? 0n;
}

/**
 * Public: net cash flow over [startDate, endDate] (inclusive both), as a BigInt.
 */
export async function getCashFlowsForPeriod(
  accountId: string,
  startDate: Date,
  endDate: Date,
): Promise<bigint> {
  const rows = await prisma.$queryRaw<{ cf: bigint }[]>`
    SELECT CAST(COALESCE(SUM(amount), 0) AS BIGINT) AS cf
    FROM "LedgerEntry"
    WHERE "accountId" = ${accountId}
      AND "effectiveDate" >= ${startDate}
      AND "effectiveDate" <= ${endDate}
      AND "type" IN ('CASH_DEPOSIT', 'CASH_WITHDRAWAL', 'CASH_DEPOSIT_RETURN')
      AND COALESCE(metadata->>'bucket', '') NOT IN ('IN_TRANSIT', 'EXTERNAL')
  `;
  return rows[0]?.cf ?? 0n;
}

/**
 * TWR over [startDate, endDate], chaining the return between each pair of
 * consecutive daily valuation snapshots. Needs ≥ 2 snapshots; otherwise 0.
 */
export async function calculateTWR(accountId: string, startDate: Date, endDate: Date): Promise<TWRResult> {
  const all = await getValuationHistory(accountId, startDate, endDate);
  const series = all.filter((v) => !v.isRestated);
  if (series.length < 2) return emptyResult(startDate, endDate);

  let chain = D1;
  let totalCF = 0n;
  const subPeriods: SubPeriod[] = [];

  for (let i = 1; i < series.length; i++) {
    const prev = series[i - 1];
    const curr = series[i];
    const cf = await netCashFlowCents(accountId, prev.valuationDate, curr.valuationDate);
    totalCF += cf;
    const r = calculateSubPeriodReturn(prev.totalValueCents, curr.totalValueCents, cf);
    chain = chain.times(r.plus(1));
    subPeriods.push({
      start: prev.valuationDate.toISOString(),
      end: curr.valuationDate.toISOString(),
      startValueCents: prev.totalValueCents.toString(),
      endValueCents: curr.totalValueCents.toString(),
      cashFlowCents: cf.toString(),
      returnPct: r.toString(),
    });
  }

  const twr = chain.minus(1);
  return {
    twrPct: twr.toString(),
    twrDisplay: display(twr),
    subPeriods,
    startDate: startDate.toISOString(),
    endDate: endDate.toISOString(),
    startValueCents: series[0].totalValueCents.toString(),
    endValueCents: series[series.length - 1].totalValueCents.toString(),
    totalCashFlowsCents: totalCF.toString(),
  };
}

/** Earliest ledger entry date for an account (inception), or null. */
async function inceptionDate(accountId: string): Promise<Date | null> {
  const first = await prisma.ledgerEntry.findFirst({
    where: { accountId },
    orderBy: { effectiveDate: 'asc' },
    select: { effectiveDate: true },
  });
  return first?.effectiveDate ?? null;
}

/**
 * The reference "end" for return windows. Normally now, but if snapshots exist
 * beyond now (e.g. simulated trading days in the demo) we extend to the latest
 * snapshot so the whole series is included.
 */
async function referenceEnd(accountId: string): Promise<Date> {
  const now = new Date();
  const latest = await prisma.valuation.findFirst({
    where: { accountId, isRestated: false },
    orderBy: { valuationDate: 'desc' },
    select: { valuationDate: true },
  });
  return latest && latest.valuationDate.getTime() > now.getTime() ? latest.valuationDate : now;
}

/** TWR from the first ledger entry to the latest snapshot (or today). */
export async function calculateTWRSinceInception(accountId: string): Promise<TWRResult> {
  const inception = await inceptionDate(accountId);
  const end = await referenceEnd(accountId);
  if (!inception) return emptyResult(end, end);
  return calculateTWR(accountId, inception, end);
}

/** TWR for a set of standard trailing periods (null if shorter than account age). */
export async function calculateTWRForPeriods(accountId: string): Promise<Record<string, TWRResult | null>> {
  const inception = await inceptionDate(accountId);
  const now = await referenceEnd(accountId);
  if (!inception) {
    return {
      sinceInception: emptyResult(now, now),
      oneYear: null,
      sixMonths: null,
      threeMonths: null,
      oneMonth: null,
      oneWeek: null,
      today: emptyResult(now, now),
    };
  }

  const ageMs = now.getTime() - inception.getTime();
  const day = 86_400_000;
  const since = (ms: number) => new Date(now.getTime() - ms);
  const forPeriod = async (ms: number): Promise<TWRResult | null> =>
    ageMs >= ms ? calculateTWR(accountId, since(ms), now) : null;

  const startOfToday = new Date(now);
  startOfToday.setUTCHours(0, 0, 0, 0);

  return {
    sinceInception: await calculateTWR(accountId, inception, now),
    oneYear: await forPeriod(365 * day),
    sixMonths: await forPeriod(182 * day),
    threeMonths: await forPeriod(91 * day),
    oneMonth: await forPeriod(30 * day),
    oneWeek: await forPeriod(7 * day),
    today: await calculateTWR(accountId, startOfToday, now),
  };
}

/** Recompute TWR-since-inception up to a date and write it onto that snapshot. */
export async function updateValuationWithTWR(accountId: string, valuationDate: Date): Promise<Valuation | null> {
  const day = new Date(valuationDate);
  day.setUTCHours(0, 0, 0, 0);
  const inception = await inceptionDate(accountId);
  if (!inception) return null;

  const twr = await calculateTWR(accountId, inception, valuationDate);
  const twrDec = new Prisma.Decimal(twr.twrPct).toDecimalPlaces(6);

  try {
    return await prisma.valuation.update({
      where: { accountId_valuationDate_isRestated: { accountId, valuationDate: day, isRestated: false } },
      data: { twrPct: twrDec, returnPct: twrDec },
    });
  } catch (err) {
    logger.warn('updateValuationWithTWR: no snapshot to update', {
      accountId,
      date: day.toISOString().slice(0, 10),
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

export const twrService = {
  calculateSubPeriodReturn,
  getCashFlowsForPeriod,
  calculateTWR,
  calculateTWRSinceInception,
  calculateTWRForPeriods,
  updateValuationWithTWR,
};
export default twrService;
