import { Prisma, type ReconciliationBreak, BreakType, BreakStatus } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';
import { getCashBalance } from './ledger.service';
import { getLatestPrice } from './market-price.service';
import {
  generateDailyFile,
  type CustodianFileData,
} from './custodian-simulator.service';

/**
 * Reconciliation — compare our ledger/positions/prices against the (simulated)
 * custodian file and surface mismatches as "breaks". Idempotent: a break found
 * again is not duplicated; running twice a day yields the same result.
 */

const UNIT_TOLERANCE = new Prisma.Decimal('0.000001');
const CASH_TOLERANCE_CENTS = 1n; // $0.01
const PRICE_TOLERANCE_PCT = new Prisma.Decimal('0.001'); // 0.1%

function startOfUtcDay(d: Date): Date {
  const x = new Date(d);
  x.setUTCHours(0, 0, 0, 0);
  return x;
}

export interface CreateBreakInput {
  breakDate: Date;
  symbol?: string | null;
  accountId?: string | null;
  breakType: BreakType;
  ledgerValue?: Prisma.Decimal | null;
  custodianValue?: Prisma.Decimal | null;
  difference?: Prisma.Decimal | null;
  description: string;
}

/** Create a break, de-duplicating against existing OPEN breaks (idempotent). */
export async function createBreak(input: CreateBreakInput): Promise<ReconciliationBreak> {
  const breakDate = startOfUtcDay(input.breakDate);
  const existing = await prisma.reconciliationBreak.findFirst({
    where: {
      breakDate,
      breakType: input.breakType,
      symbol: input.symbol ?? null,
      accountId: input.accountId ?? null,
      status: BreakStatus.OPEN,
    },
  });
  if (existing) return existing;

  return prisma.reconciliationBreak.create({
    data: {
      breakDate,
      symbol: input.symbol ?? null,
      accountId: input.accountId ?? null,
      breakType: input.breakType,
      ledgerValue: input.ledgerValue ?? null,
      custodianValue: input.custodianValue ?? null,
      difference: input.difference ?? null,
      description: input.description,
      status: BreakStatus.OPEN,
      agingDays: 0,
    },
  });
}

/** Compare positions + cash in the custodian file against our ledger. */
export async function reconcilePositions(
  fileData: CustodianFileData,
  date: Date,
): Promise<{ breaks: ReconciliationBreak[]; matched: number; broken: number; totalPositions: number }> {
  const ours = await prisma.position.findMany({ where: { units: { gt: 0 } } });
  const key = (a: string, s: string) => `${a}|${s}`;
  const ourMap = new Map(ours.map((p) => [key(p.accountId, p.symbol), p]));
  const custMap = new Map(fileData.positions.map((p) => [key(p.accountId, p.symbol), p]));

  const breaks: ReconciliationBreak[] = [];
  let matched = 0;

  // Custodian → ours: missing-in-ledger or amount mismatch.
  for (const cp of fileData.positions) {
    const op = ourMap.get(key(cp.accountId, cp.symbol));
    const custUnits = new Prisma.Decimal(cp.units);
    if (!op) {
      breaks.push(
        await createBreak({
          breakDate: date,
          symbol: cp.symbol,
          accountId: cp.accountId,
          breakType: BreakType.MISSING_IN_LEDGER,
          custodianValue: custUnits,
          description: `${cp.symbol} present at custodian but missing in ledger`,
        }),
      );
    } else if (op.units.minus(custUnits).abs().greaterThan(UNIT_TOLERANCE)) {
      breaks.push(
        await createBreak({
          breakDate: date,
          symbol: cp.symbol,
          accountId: cp.accountId,
          breakType: BreakType.AMOUNT_MISMATCH,
          ledgerValue: op.units,
          custodianValue: custUnits,
          difference: custUnits.minus(op.units),
          description: `${cp.symbol} units differ`,
        }),
      );
    } else {
      matched++;
    }
  }

  // Ours → custodian: missing-in-custodian.
  for (const op of ours) {
    if (!custMap.has(key(op.accountId, op.symbol))) {
      breaks.push(
        await createBreak({
          breakDate: date,
          symbol: op.symbol,
          accountId: op.accountId,
          breakType: BreakType.MISSING_IN_CUSTODIAN,
          ledgerValue: op.units,
          description: `${op.symbol} held in ledger but missing at custodian`,
        }),
      );
    }
  }

  // Cash per account.
  for (const c of fileData.cash) {
    const ourCents = await getCashBalance(c.accountId);
    const custCents = BigInt(Math.round(parseFloat(c.amount) * 100));
    if (ourCents - custCents > CASH_TOLERANCE_CENTS || custCents - ourCents > CASH_TOLERANCE_CENTS) {
      breaks.push(
        await createBreak({
          breakDate: date,
          symbol: 'CASH',
          accountId: c.accountId,
          breakType: BreakType.AMOUNT_MISMATCH,
          ledgerValue: new Prisma.Decimal(ourCents.toString()).div(100),
          custodianValue: new Prisma.Decimal(custCents.toString()).div(100),
          difference: new Prisma.Decimal((custCents - ourCents).toString()).div(100),
          description: 'Cash balance differs',
        }),
      );
    }
  }

  return { breaks, matched, broken: breaks.length, totalPositions: fileData.positions.length };
}

/** Compare our prices against the custodian's for each symbol in the file. */
export async function reconcilePrices(fileData: CustodianFileData, date: Date): Promise<ReconciliationBreak[]> {
  const breaks: ReconciliationBreak[] = [];
  const seen = new Set<string>();

  for (const cp of fileData.positions) {
    if (seen.has(cp.symbol)) continue;
    seen.add(cp.symbol);

    let ourPriceCents: bigint;
    try {
      ourPriceCents = (await getLatestPrice(cp.symbol, date)).priceCents;
    } catch {
      continue;
    }
    const ourPrice = new Prisma.Decimal(ourPriceCents.toString()).div(100);
    const custPrice = new Prisma.Decimal(cp.marketPrice);
    if (ourPrice.lte(0)) continue;

    const relDiff = custPrice.minus(ourPrice).abs().div(ourPrice);
    if (relDiff.greaterThan(PRICE_TOLERANCE_PCT)) {
      breaks.push(
        await createBreak({
          breakDate: date,
          symbol: cp.symbol,
          breakType: BreakType.PRICE_MISMATCH,
          ledgerValue: ourPrice,
          custodianValue: custPrice,
          difference: custPrice.minus(ourPrice),
          description: `${cp.symbol} price differs`,
        }),
      );
    }
  }
  return breaks;
}

/** Reconcile a specific file (positions + prices). */
export async function reconcileAgainstFile(fileData: CustodianFileData, date: Date) {
  const pos = await reconcilePositions(fileData, date);
  const priceBreaks = await reconcilePrices(fileData, date);
  const allBreaks = [...pos.breaks, ...priceBreaks];
  return { matched: pos.matched, breaks: allBreaks, totalPositions: pos.totalPositions };
}

/** Age all OPEN breaks (days since breakDate). */
async function ageOpenBreaks(): Promise<void> {
  const open = await prisma.reconciliationBreak.findMany({ where: { status: BreakStatus.OPEN } });
  const now = startOfUtcDay(new Date()).getTime();
  for (const b of open) {
    const age = Math.max(0, Math.floor((now - startOfUtcDay(b.breakDate).getTime()) / 86_400_000));
    if (age !== b.agingDays) {
      await prisma.reconciliationBreak.update({ where: { id: b.id }, data: { agingDays: age } });
    }
  }
}

/** The daily job: generate a clean file, reconcile, age breaks. */
export async function runDailyReconciliation(): Promise<{
  date: string;
  matched: number;
  newBreaks: number;
  totalOpen: number;
}> {
  logger.info('Starting daily reconciliation');
  const today = startOfUtcDay(new Date());
  const file = await generateDailyFile(today, false);
  const result = await reconcileAgainstFile(file, today);
  await ageOpenBreaks();

  const totalOpen = await prisma.reconciliationBreak.count({ where: { status: BreakStatus.OPEN } });
  logger.info(`Reconciliation complete: ${result.matched} matched, ${result.breaks.length} breaks found`);
  return { date: today.toISOString().slice(0, 10), matched: result.matched, newBreaks: result.breaks.length, totalOpen };
}

/** Resolve a break. */
export async function resolveBreak(breakId: string, resolution: string): Promise<ReconciliationBreak> {
  return prisma.reconciliationBreak.update({
    where: { id: breakId },
    data: { status: BreakStatus.RESOLVED, resolution, resolvedAt: new Date() },
  });
}

/** List breaks (optionally filtered), oldest first. */
export async function listBreaks(filter?: {
  status?: BreakStatus | 'all';
  breakType?: BreakType;
  minAgeDays?: number;
}): Promise<ReconciliationBreak[]> {
  const where: Prisma.ReconciliationBreakWhereInput = {};
  if (filter?.status && filter.status !== 'all') where.status = filter.status;
  if (filter?.breakType) where.breakType = filter.breakType;
  if (filter?.minAgeDays != null) where.agingDays = { gte: filter.minAgeDays };
  return prisma.reconciliationBreak.findMany({ where, orderBy: [{ agingDays: 'desc' }, { createdAt: 'desc' }] });
}

/** Break summary for the dashboard header. */
export async function getBreakSummary() {
  const open = await prisma.reconciliationBreak.findMany({ where: { status: BreakStatus.OPEN } });
  const byType: Record<BreakType, number> = {
    MISSING_IN_LEDGER: 0,
    MISSING_IN_CUSTODIAN: 0,
    AMOUNT_MISMATCH: 0,
    PRICE_MISMATCH: 0,
  };
  for (const b of open) byType[b.breakType]++;
  const oldest = open.reduce((m, b) => Math.max(m, b.agingDays), 0);
  const total = await prisma.reconciliationBreak.count();
  return { totalOpen: open.length, byType, oldestBreakDays: oldest, totalBreaks: total };
}

export const reconciliationService = {
  createBreak,
  reconcilePositions,
  reconcilePrices,
  reconcileAgainstFile,
  runDailyReconciliation,
  resolveBreak,
  listBreaks,
  getBreakSummary,
};
export default reconciliationService;
