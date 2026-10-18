import { Prisma, type Order } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';
import { redisConnection } from '../lib/redis';
import { createJournalEntry } from './ledger.service';
import { MODEL_PORTFOLIOS, type PortfolioType } from './portfolios';

/**
 * Alpaca brokerage integration (paper trading).
 *
 * Money vs units are kept strictly separate: cash is BigInt cents, units are
 * Prisma.Decimal (6dp). A fill books a BALANCED double-entry journal using the
 * counter-account model:
 *   TRADE_BUY_CASH  -cost  (bucket SETTLED_CASH — available cash goes down)
 *   TRADE_BUY_UNITS +cost  (bucket INVESTED, carries units — investment goes up)
 * so cash drops, invested rises, the journal nets to zero, and the ledger stays
 * append-only. (The spec's units leg used amount 0n, which wouldn't balance;
 * we book the cost on the units/INVESTED leg instead. See DECISIONS.md.)
 */

// --- Client (lazy) ---------------------------------------------------------

/* eslint-disable @typescript-eslint/no-explicit-any */
// We talk to Alpaca over its REST API directly (Node global fetch) rather than
// the SDK — the installed SDK major version has an incompatible client surface,
// and the REST contract is stable. Paper trading only.
const TRADE_BASE = (process.env.ALPACA_BASE_URL || 'https://paper-api.alpaca.markets')
  .replace(/\/v2\/?$/, '')
  .replace(/\/$/, '');
const DATA_BASE = (process.env.ALPACA_DATA_URL || 'https://data.alpaca.markets').replace(/\/$/, '');

function alpacaHeaders(): Record<string, string> {
  return {
    'APCA-API-KEY-ID': process.env.ALPACA_API_KEY ?? '',
    'APCA-API-SECRET-KEY': process.env.ALPACA_API_SECRET ?? '',
    'Content-Type': 'application/json',
  };
}

// --- Types -----------------------------------------------------------------

export interface AlpacaTradeEvent {
  event: 'fill' | 'partial_fill' | 'canceled' | 'rejected';
  order_id: string; // Alpaca order id
  client_order_id?: string; // our DB order id
  symbol?: string;
  qty: string; // this fill's quantity
  price: string; // fill price (dollars)
  timestamp?: string;
  execution_id?: string;
}

export interface GeneratedOrder {
  symbol: string;
  units: Prisma.Decimal;
  estimatedCostCents: bigint;
  portfolioWeight: number;
}

// --- Prices ----------------------------------------------------------------

/** Floor a Decimal cents value to an integer BigInt (never over-spend). */
function floorToCents(d: Prisma.Decimal): bigint {
  return BigInt(d.toDecimalPlaces(0, Prisma.Decimal.ROUND_DOWN).toFixed(0));
}

/**
 * Latest price in cents. Tries Alpaca market data, falls back to the most recent
 * MarketPrice row, and throws only if neither has a price.
 */
export async function getLatestPrice(symbol: string): Promise<bigint> {
  try {
    const r = await fetch(`${DATA_BASE}/v2/stocks/${symbol}/trades/latest`, { headers: alpacaHeaders() });
    if (r.ok) {
      const j: any = await r.json();
      const price = j?.trade?.p;
      if (price != null) return BigInt(Math.round(parseFloat(String(price)) * 100));
    }
  } catch (err) {
    logger.warn('Alpaca price lookup failed; falling back to MarketPrice', {
      symbol,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  const last = await prisma.marketPrice.findFirst({
    where: { symbol },
    orderBy: { date: 'desc' },
  });
  if (last) return last.closePriceCents;

  throw new Error(`No price available for ${symbol}`);
}

// --- Order generation ------------------------------------------------------

/**
 * Turn available cash + a model portfolio into a set of buy orders, keeping a
 * 10% cash buffer. Units are floored to 6dp so we never spend more than we have.
 */
export async function generateOrders(
  _accountId: string,
  portfolioType: PortfolioType,
  availableCashCents: bigint,
): Promise<GeneratedOrder[]> {
  const model = MODEL_PORTFOLIOS[portfolioType];
  // Weights are fractions of the TOTAL account and sum to (1 - cash buffer),
  // so the 10% buffer is simply what's left unallocated. target = weight * cash.
  const orders: GeneratedOrder[] = [];
  let totalCost = 0n;

  for (const [symbol, weight] of Object.entries(model.weights)) {
    const targetCents = (availableCashCents * BigInt(Math.round(weight * 1000))) / 1000n;
    const priceCents = await getLatestPrice(symbol);
    if (priceCents <= 0n) continue;

    // units = targetCents / priceCents, floored to 6dp
    const units = new Prisma.Decimal(targetCents.toString())
      .div(priceCents.toString())
      .toDecimalPlaces(6, Prisma.Decimal.ROUND_DOWN);
    if (units.lessThanOrEqualTo(0)) continue;

    const estimatedCostCents = floorToCents(units.mul(priceCents.toString()));
    totalCost += estimatedCostCents;
    orders.push({ symbol, units, estimatedCostCents, portfolioWeight: weight });
  }

  const cap = (availableCashCents * 90n) / 100n;
  if (totalCost > cap) {
    throw new Error('Generated orders exceed 90% of available cash');
  }
  return orders;
}

// --- Order submission ------------------------------------------------------

/**
 * Create our Order row (PENDING), submit a market order to Alpaca (best-effort —
 * fractional/market-closed constraints are tolerated), then mark it SUBMITTED.
 * client_order_id = our order id, so fills map back to us.
 */
export async function submitOrder(params: {
  accountId: string;
  symbol: string;
  units: Prisma.Decimal;
  side: 'buy' | 'sell';
}): Promise<Order> {
  const order = await prisma.order.create({
    data: {
      accountId: params.accountId,
      symbol: params.symbol,
      side: params.side === 'buy' ? 'BUY' : 'SELL',
      type: 'MARKET',
      status: 'PENDING',
      requestedUnits: params.units,
    },
  });

  let alpacaOrderId: string | null = null;
  try {
    const r = await fetch(`${TRADE_BASE}/v2/orders`, {
      method: 'POST',
      headers: alpacaHeaders(),
      body: JSON.stringify({
        symbol: params.symbol,
        qty: params.units.toString(),
        side: params.side,
        type: 'market',
        time_in_force: 'day',
        client_order_id: order.id,
      }),
    });
    if (r.ok) {
      const res: any = await r.json();
      alpacaOrderId = res?.id ?? null;
    } else {
      const body = await r.text();
      logger.warn('Alpaca createOrder rejected (will rely on simulate/poll)', {
        orderId: order.id,
        symbol: params.symbol,
        status: r.status,
        body: body.slice(0, 200),
      });
    }
  } catch (err) {
    logger.warn('Alpaca createOrder failed (will rely on simulate/poll)', {
      orderId: order.id,
      symbol: params.symbol,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  return prisma.order.update({
    where: { id: order.id },
    data: { alpacaOrderId, status: 'SUBMITTED' },
  });
}

/** Generate + submit all orders for a portfolio, and record the selection. */
export async function submitPortfolioOrders(params: {
  accountId: string;
  portfolioType: PortfolioType;
  availableCashCents: bigint;
}): Promise<Order[]> {
  const generated = await generateOrders(params.accountId, params.portfolioType, params.availableCashCents);

  const submitted: Order[] = [];
  for (const g of generated) {
    submitted.push(await submitOrder({ accountId: params.accountId, symbol: g.symbol, units: g.units, side: 'buy' }));
  }

  await prisma.account.update({
    where: { id: params.accountId },
    data: { selectedPortfolio: params.portfolioType },
  });

  logger.info('Portfolio orders submitted', {
    accountId: params.accountId,
    portfolioType: params.portfolioType,
    orders: submitted.length,
  });
  return submitted;
}

// --- Fills -----------------------------------------------------------------

/**
 * Book a fill: idempotent. Writes the balanced buy journal, upserts the Position,
 * opens a tax lot (one per fill), and advances the Order. A replayed fill (same
 * execution id, or an already-FILLED order) is a no-op.
 */
export async function handleFillWebhook(event: AlpacaTradeEvent): Promise<Order | null> {
  if (event.event !== 'fill' && event.event !== 'partial_fill') return null;

  // Idempotency 1: per-execution Redis lock.
  const execId = event.execution_id || `${event.order_id}-${event.qty}-${event.price}`;
  const dedupKey = `alpaca:exec:${execId}`;
  try {
    const set = await redisConnection.set(dedupKey, '1', 'EX', 86_400, 'NX');
    if (set !== 'OK') {
      logger.info('Fill already processed (redis dedup)', { execId });
      return null;
    }
  } catch {
    // If Redis is unavailable, fall through to the DB-level guards below.
  }

  const order = await prisma.order.findFirst({
    where: {
      OR: [{ alpacaOrderId: event.order_id }, { id: event.client_order_id ?? event.order_id }],
    },
  });
  if (!order) {
    logger.warn('Fill for unknown order', { orderId: event.order_id });
    return null;
  }
  // Idempotency 2: a fully-filled order is never reprocessed.
  if (order.status === 'FILLED') {
    logger.info('Order already FILLED, skipping fill', { orderId: order.id });
    return order;
  }

  const symbol = event.symbol || order.symbol;
  const filledUnits = new Prisma.Decimal(event.qty);
  const fillPriceCents = BigInt(Math.round(parseFloat(event.price) * 100));
  const totalCostCents = floorToCents(filledUnits.mul(fillPriceCents.toString()));
  const effectiveDate = event.timestamp ? new Date(event.timestamp) : new Date();
  const priceUsd = (Number(fillPriceCents) / 100).toFixed(2);
  const desc = `Buy ${event.qty} ${symbol} @ $${priceUsd}`;

  // Balanced buy journal (cash out of SETTLED_CASH, value into INVESTED).
  await createJournalEntry(order.accountId, [
    {
      type: 'TRADE_BUY_CASH',
      amount: -totalCostCents,
      assetSymbol: symbol,
      description: desc,
      referenceId: event.order_id,
      referenceType: 'ALPACA_FILL',
      effectiveDate,
      metadata: { bucket: 'SETTLED_CASH', alpacaOrderId: event.order_id, fillPrice: event.price, qty: event.qty },
    },
    {
      type: 'TRADE_BUY_UNITS',
      amount: totalCostCents, // balances the journal; this is the invested cost
      units: filledUnits,
      assetSymbol: symbol,
      description: desc,
      referenceId: event.order_id,
      referenceType: 'ALPACA_FILL',
      effectiveDate,
      metadata: { bucket: 'INVESTED', qty: event.qty },
    },
  ]);

  // Upsert position (get id for the tax lot), then open a tax lot for THIS fill.
  const position = await prisma.position.upsert({
    where: { accountId_symbol: { accountId: order.accountId, symbol } },
    update: { units: { increment: filledUnits } },
    create: { accountId: order.accountId, symbol, units: filledUnits },
  });
  await prisma.taxLot.create({
    data: {
      positionId: position.id,
      symbol,
      units: filledUnits,
      remainingUnits: filledUnits,
      costBasisCents: totalCostCents,
      openedAt: effectiveDate,
    },
  });

  // Advance the order.
  const newFilled = (order.filledUnits ?? new Prisma.Decimal(0)).add(filledUnits);
  const fullyFilled =
    event.event === 'fill' ||
    (order.requestedUnits != null && newFilled.greaterThanOrEqualTo(order.requestedUnits));
  const updated = await prisma.order.update({
    where: { id: order.id },
    data: {
      filledUnits: newFilled,
      filledAvgPriceCents: fillPriceCents,
      status: fullyFilled ? 'FILLED' : 'PARTIALLY_FILLED',
      filledAt: effectiveDate,
    },
  });

  logger.info('Fill booked', { orderId: order.id, symbol, qty: event.qty, totalCostCents: totalCostCents.toString() });
  return updated;
}

/** Mark an order canceled/rejected (no cash was reserved, so nothing to release). */
export async function handleOrderTerminal(event: AlpacaTradeEvent): Promise<void> {
  const order = await prisma.order.findFirst({
    where: { OR: [{ alpacaOrderId: event.order_id }, { id: event.client_order_id ?? event.order_id }] },
  });
  if (!order) return;
  await prisma.order.update({
    where: { id: order.id },
    data: { status: event.event === 'canceled' ? 'CANCELLED' : 'REJECTED' },
  });
  logger.info(`Order ${event.event}`, { orderId: order.id });
}

// --- Positions -------------------------------------------------------------

export interface PositionView {
  symbol: string;
  units: string;
  currentPriceCents: string;
  currentValueCents: string;
  costBasisCents: string;
  unrealizedGainCents: string;
  unrealizedGainPct: string;
}

/** Positions with current market value and unrealized gain. */
export async function getPositions(accountId: string): Promise<PositionView[]> {
  const positions = await prisma.position.findMany({
    where: { accountId },
    include: { taxLots: true },
  });

  const views: PositionView[] = [];
  for (const p of positions) {
    if (p.units.lessThanOrEqualTo(0)) continue;
    let priceCents = 0n;
    try {
      priceCents = await getLatestPrice(p.symbol);
    } catch {
      priceCents = 0n;
    }
    const currentValueCents = floorToCents(p.units.mul(priceCents.toString()));
    const costBasisCents = p.taxLots.reduce((s, lot) => s + lot.costBasisCents, 0n);
    const unrealizedGainCents = currentValueCents - costBasisCents;
    const pct =
      costBasisCents > 0n
        ? new Prisma.Decimal(unrealizedGainCents.toString())
            .div(costBasisCents.toString())
            .mul(100)
            .toDecimalPlaces(2)
            .toString()
        : '0';
    views.push({
      symbol: p.symbol,
      units: p.units.toString(),
      currentPriceCents: priceCents.toString(),
      currentValueCents: currentValueCents.toString(),
      costBasisCents: costBasisCents.toString(),
      unrealizedGainCents: unrealizedGainCents.toString(),
      unrealizedGainPct: pct,
    });
  }
  return views;
}

// --- Polling fallback ------------------------------------------------------

/** Poll Alpaca for open orders and book any that have filled. */
export async function pollOpenOrders(): Promise<{ checked: number; filled: number }> {
  const open = await prisma.order.findMany({
    where: { status: { in: ['SUBMITTED', 'PARTIALLY_FILLED'] }, alpacaOrderId: { not: null } },
  });
  let filled = 0;
  for (const order of open) {
    try {
      const r = await fetch(`${TRADE_BASE}/v2/orders/${order.alpacaOrderId}`, { headers: alpacaHeaders() });
      if (!r.ok) continue;
      const o: any = await r.json();
      if (o?.status === 'filled' && o.filled_avg_price) {
        await handleFillWebhook({
          event: 'fill',
          order_id: order.alpacaOrderId!,
          client_order_id: order.id,
          symbol: order.symbol,
          qty: String(o.filled_qty),
          price: String(o.filled_avg_price),
          timestamp: o.filled_at ?? new Date().toISOString(),
          execution_id: `${order.alpacaOrderId}-poll-filled`,
        });
        filled++;
      }
    } catch (err) {
      logger.debug('Poll order failed', { orderId: order.id, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return { checked: open.length, filled };
}

export const alpacaService = {
  getLatestPrice,
  generateOrders,
  submitOrder,
  submitPortfolioOrders,
  handleFillWebhook,
  handleOrderTerminal,
  getPositions,
  pollOpenOrders,
};
export default alpacaService;
