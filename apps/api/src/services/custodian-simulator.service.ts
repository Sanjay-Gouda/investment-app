import { Prisma, type CustodianFile } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';
import { getCashBalance } from './ledger.service';
import { getLatestPrice } from './market-price.service';

/**
 * Custodian file simulator — SIMULATED custodian data for reconciliation.
 *
 * Builds a "custodian" file from our own ledger/positions/prices (so a clean
 * file reconciles with zero breaks), and can inject a deliberate break for the
 * debrief ("plant a break and watch us find it").
 *
 * NOTE: This is SIMULATED. In production this would be a real custodian feed.
 */

export interface CustodianPosition {
  accountId: string;
  symbol: string;
  units: string; // 6dp
  marketPrice: string; // dollars
  marketValue: string; // dollars
}
export interface CustodianCash {
  accountId: string;
  currency: 'USD';
  amount: string; // dollars
}
export interface CustodianTransaction {
  accountId: string;
  type: 'BUY' | 'SELL' | 'DIVIDEND' | 'DEPOSIT';
  symbol?: string;
  units?: string;
  amount: string;
  settledAt: string;
}
export interface CustodianFileData {
  date: string;
  generatedAt: string;
  source: 'SIMULATED_CUSTODIAN';
  positions: CustodianPosition[];
  cash: CustodianCash[];
  transactions: CustodianTransaction[];
}

export interface BreakConfig {
  type: 'missing' | 'amount' | 'price';
  symbol?: string;
  amount?: number;
}

const dollars = (cents: bigint) => (Number(cents) / 100).toFixed(2);

/**
 * Generate (and persist) a custodian file for a date. With `injectBreak`, a
 * single deliberate discrepancy is introduced per `breakConfig`.
 */
export async function generateDailyFile(
  date: Date,
  injectBreak = false,
  breakConfig?: BreakConfig,
): Promise<CustodianFileData> {
  const ourPositions = await prisma.position.findMany({ where: { units: { gt: 0 } } });

  const positions: CustodianPosition[] = [];
  for (const p of ourPositions) {
    let priceCents = 0n;
    try {
      priceCents = (await getLatestPrice(p.symbol, date)).priceCents;
    } catch {
      priceCents = 0n;
    }
    const marketValue = p.units.times(priceCents.toString()).div(100).toDecimalPlaces(2);
    positions.push({
      accountId: p.accountId,
      symbol: p.symbol,
      units: p.units.toFixed(6),
      marketPrice: (Number(priceCents) / 100).toFixed(2),
      marketValue: marketValue.toFixed(2),
    });
  }

  // Cash per account that holds positions (and any account with a cash balance).
  const accountIds = [...new Set(ourPositions.map((p) => p.accountId))];
  const cash: CustodianCash[] = [];
  for (const accountId of accountIds) {
    const bal = await getCashBalance(accountId);
    cash.push({ accountId, currency: 'USD', amount: dollars(bal) });
  }

  const filledOrders = await prisma.order.findMany({
    where: { status: 'FILLED' },
    orderBy: { filledAt: 'desc' },
    take: 50,
  });
  const transactions: CustodianTransaction[] = filledOrders.map((o) => ({
    accountId: o.accountId,
    type: o.side === 'BUY' ? 'BUY' : 'SELL',
    symbol: o.symbol,
    units: o.filledUnits?.toFixed(6),
    amount: o.filledAvgPriceCents ? dollars(o.filledAvgPriceCents) : '0.00',
    settledAt: (o.filledAt ?? o.createdAt).toISOString(),
  }));

  const file: CustodianFileData = {
    date: date.toISOString(),
    generatedAt: new Date().toISOString(),
    source: 'SIMULATED_CUSTODIAN',
    positions,
    cash,
    transactions,
  };

  if (injectBreak && breakConfig) {
    applyBreak(file, breakConfig);
  }

  await saveFile(date, file);
  return file;
}

/** Mutate the file in place to inject a single deliberate break. */
function applyBreak(file: CustodianFileData, cfg: BreakConfig): void {
  const pick = () =>
    cfg.symbol ? file.positions.findIndex((p) => p.symbol === cfg.symbol) : file.positions.length ? 0 : -1;

  if (cfg.type === 'missing') {
    // MISSING_IN_CUSTODIAN — custodian is missing a position we hold.
    const idx = pick();
    if (idx >= 0) {
      const removed = file.positions.splice(idx, 1)[0];
      logger.info('Injected MISSING_IN_CUSTODIAN break', { symbol: removed.symbol });
    }
  } else if (cfg.type === 'amount') {
    // AMOUNT_MISMATCH — custodian units differ by +5%.
    const idx = pick();
    if (idx >= 0) {
      const p = file.positions[idx];
      const newUnits = new Prisma.Decimal(p.units).times('1.05').toDecimalPlaces(6);
      p.units = newUnits.toFixed(6);
      logger.info('Injected AMOUNT_MISMATCH break', { symbol: p.symbol, custodianUnits: p.units });
    }
  } else if (cfg.type === 'price') {
    // PRICE_MISMATCH — custodian price differs by +3%.
    const idx = pick();
    if (idx >= 0) {
      const p = file.positions[idx];
      const newPrice = new Prisma.Decimal(p.marketPrice).times('1.03').toDecimalPlaces(2);
      p.marketPrice = newPrice.toFixed(2);
      logger.info('Injected PRICE_MISMATCH break', { symbol: p.symbol, custodianPrice: p.marketPrice });
    }
  }
}

/** Persist a custodian file. */
export async function saveFile(date: Date, fileData: CustodianFileData): Promise<CustodianFile> {
  return prisma.custodianFile.create({
    data: {
      fileDate: date,
      source: 'SIMULATED_CUSTODIAN',
      rawData: fileData as unknown as Prisma.InputJsonValue,
    },
  });
}

/** Most recent custodian file. */
export async function getLatestFile(): Promise<CustodianFile | null> {
  return prisma.custodianFile.findFirst({ orderBy: { createdAt: 'desc' } });
}

export const custodianSimulator = { generateDailyFile, saveFile, getLatestFile };
export default custodianSimulator;
