import { Router, type Request, type Response } from 'express';
import { EntryType, Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { HttpError } from '../types';
import {
  createJournalEntry,
  getCashBalance,
  createCorrection,
  type JournalEntryInput,
} from '../services/ledger.service';
import { register, login, signToken } from '../services/auth.service';
import { simulateKYCApproval, getKYCStatus } from '../services/kyc.service';
import {
  linkSandboxBank,
  initiateDeposit,
  settleDeposit,
  bounceDeposit,
  getBalances,
} from '../services/plaid.service';
import {
  submitPortfolioOrders,
  handleFillWebhook,
  getPositions,
  getLatestPrice,
  pollOpenOrders,
} from '../services/alpaca.service';
import { isPortfolioType } from '../services/portfolios';
import {
  runDailyValuation,
  getLatestValuation,
  getValuationHistory,
  calculateAccountValuation,
  storeValuation,
} from '../services/valuation.service';
import { fetchAndStorePrice, getLatestPrice as getStoredPrice } from '../services/market-price.service';
import {
  calculateTWRForPeriods,
  calculateTWRSinceInception,
  calculateSubPeriodReturn,
  updateValuationWithTWR,
} from '../services/twr.service';

/**
 * Dev-only helper routes for exercising the system without a UI or auth.
 * The whole router is disabled when NODE_ENV=production.
 */
export const testRouter = Router();

testRouter.use((_req, res, next) => {
  // Disabled in production UNLESS ENABLE_SIMULATE=true (for the live demo).
  if (process.env.NODE_ENV === 'production' && process.env.ENABLE_SIMULATE !== 'true') {
    res.status(404).json({ ok: false, error: { code: 'NOT_FOUND', message: 'disabled' } });
    return;
  }
  next();
});

/** Resolve the seeded investor account (investor@demo.com). */
async function investorAccountId(): Promise<string> {
  const user = await prisma.user.findUnique({
    where: { email: 'investor@demo.com' },
    include: { account: true },
  });
  if (!user?.account) {
    throw new HttpError(404, 'NO_DEMO_ACCOUNT', 'investor@demo.com account not found — run db:seed');
  }
  return user.account.id;
}

// --- DB connectivity ------------------------------------------------------
testRouter.get('/db', async (_req: Request, res: Response) => {
  const [users, accounts, ledgerEntries, positions, marketPrices] = await Promise.all([
    prisma.user.count(),
    prisma.account.count(),
    prisma.ledgerEntry.count(),
    prisma.position.count(),
    prisma.marketPrice.count(),
  ]);
  res.json({
    ok: true,
    db: 'connected',
    counts: { users, accounts, ledgerEntries, positions, marketPrices },
    timestamp: new Date().toISOString(),
  });
});

// --- Ledger dump (running balance) ----------------------------------------
testRouter.get('/ledger', async (_req: Request, res: Response) => {
  const entries = await prisma.ledgerEntry.findMany({
    orderBy: [{ effectiveDate: 'asc' }, { createdAt: 'asc' }],
    include: { account: { include: { user: { select: { email: true } } } } },
  });

  let running = 0n;
  const rows = entries.map((e) => {
    running += e.amount;
    return {
      id: e.id,
      account: e.account.user.email,
      type: e.type,
      amountCents: e.amount.toString(),
      runningCashCents: running.toString(),
      assetSymbol: e.assetSymbol,
      units: e.units?.toString() ?? null,
      description: e.description,
      effectiveDate: e.effectiveDate.toISOString().slice(0, 10),
      bookingDate: e.bookingDate.toISOString(),
    };
  });

  res.json({
    ok: true,
    count: rows.length,
    cashBalanceCents: running.toString(),
    cashBalanceUsd: (Number(running) / 100).toFixed(2),
    entries: rows,
  });
});

// --- POST /test/ledger/journal --------------------------------------------
// Creates a balanced test journal for investor@demo.com (defaults to a
// self-offsetting $500 deposit if no body is supplied).
testRouter.post('/ledger/journal', async (req: Request, res: Response) => {
  const accountId = await investorAccountId();

  const defaultEntries: JournalEntryInput[] = [
    { type: EntryType.CASH_DEPOSIT, amount: 50000n, description: 'Test deposit', effectiveDate: new Date() },
    { type: EntryType.CASH_DEPOSIT, amount: -50000n, description: 'Test deposit offset', effectiveDate: new Date() },
  ];

  const body = req.body as { entries?: Array<Record<string, unknown>> } | undefined;
  const entries: JournalEntryInput[] =
    body?.entries && Array.isArray(body.entries)
      ? body.entries.map((e) => ({
          type: e.type as EntryType,
          amount: BigInt(e.amount as string | number),
          assetSymbol: e.assetSymbol as string | undefined,
          units: e.units as string | undefined,
          description: (e.description as string) ?? 'Test entry',
          effectiveDate: e.effectiveDate ? new Date(e.effectiveDate as string) : new Date(),
        }))
      : defaultEntries;

  const created = await createJournalEntry(accountId, entries);
  res.status(201).json({ ok: true, created });
});

// --- GET /test/ledger/balance ---------------------------------------------
testRouter.get('/ledger/balance', async (_req: Request, res: Response) => {
  const accountId = await investorAccountId();
  const cash = await getCashBalance(accountId);
  res.json({
    cashBalanceCents: cash.toString(),
    cashBalanceUSD: (Number(cash) / 100).toFixed(2),
    asOfDate: new Date().toISOString(),
  });
});

// --- GET /test/ledger/correction-test -------------------------------------
// Proves the correction machinery end to end:
//   1. book a balanced journal with the WRONG value date
//   2. correct it to the RIGHT value date (reversal + rebook)
//   3. confirm the originals are untouched and report before/after balances
testRouter.get('/ledger/correction-test', async (_req: Request, res: Response) => {
  const accountId = await investorAccountId();

  const wrongDate = new Date('2020-01-01T00:00:00.000Z');
  const correctDate = new Date();
  correctDate.setUTCDate(correctDate.getUTCDate() - 5);

  // 1. Original balanced journal, mis-dated.
  const original = await createJournalEntry(accountId, [
    { type: EntryType.FEE, amount: -1000n, description: 'Advisory fee', effectiveDate: wrongDate },
    { type: EntryType.FEE, amount: 1000n, description: 'Advisory fee offset', effectiveDate: wrongDate },
  ]);
  const originalIds = original.map((o) => o.id);
  const balanceBefore = await getCashBalance(accountId);

  // 2. Correct the value date.
  const correction = await createCorrection({
    accountId,
    originalEntryIds: originalIds,
    reason: 'Fix mis-dated advisory fee (correction-test)',
    correctedEntries: [
      { type: EntryType.FEE, amount: -1000n, description: 'Advisory fee', effectiveDate: correctDate },
      { type: EntryType.FEE, amount: 1000n, description: 'Advisory fee offset', effectiveDate: correctDate },
    ],
    effectiveDate: correctDate,
  });

  // 3. Confirm originals untouched.
  const originalsNow = await prisma.ledgerEntry.findMany({ where: { id: { in: originalIds } } });
  const originalsUntouched = originalsNow.every((o, i) => {
    const before = original.find((x) => x.id === o.id)!;
    return (
      o.amount === before.amount &&
      o.effectiveDate.getTime() === before.effectiveDate.getTime() &&
      o.description === before.description
    );
  });

  const balanceAfter = await getCashBalance(accountId);

  res.json({
    ok: true,
    wrongEffectiveDate: wrongDate.toISOString(),
    correctEffectiveDate: correctDate.toISOString(),
    balanceBeforeCents: balanceBefore.toString(),
    balanceAfterCents: balanceAfter.toString(),
    originalsUntouched,
    reversals: correction.reversals,
    rebookedEntries: correction.rebookedEntries,
  });
});

// --- POST /test/auth/register ---------------------------------------------
testRouter.post('/auth/register', async (req: Request, res: Response) => {
  const { email, password, fullName } = (req.body ?? {}) as Record<string, string>;
  const { user, account } = await register({ email, password, fullName: fullName ?? 'Test User' });
  const token = signToken({ userId: user.id, email: user.email, role: user.role, accountId: account.id });
  res.status(201).json({ token, user, account });
});

// --- POST /test/auth/login ------------------------------------------------
testRouter.post('/auth/login', async (req: Request, res: Response) => {
  const { email, password } = (req.body ?? {}) as Record<string, string>;
  const { token, user } = await login({ email, password });
  res.json({ token, user });
});

// --- POST /test/kyc/simulate-approve --------------------------------------
testRouter.post('/kyc/simulate-approve', async (req: Request, res: Response) => {
  const { email } = (req.body ?? {}) as Record<string, string>;
  const user = await prisma.user.findUnique({ where: { email }, include: { account: true } });
  if (!user?.account) throw new HttpError(404, 'NOT_FOUND', `No account for ${email}`);
  const account = await simulateKYCApproval(user.account.id);
  res.json({ ok: true, account });
});

// --- GET /test/kyc/status?email= ------------------------------------------
testRouter.get('/kyc/status', async (req: Request, res: Response) => {
  const email = req.query.email as string | undefined;
  if (!email) throw new HttpError(400, 'EMAIL_REQUIRED', 'email query param is required');
  const user = await prisma.user.findUnique({ where: { email }, include: { account: true } });
  if (!user?.account) throw new HttpError(404, 'NOT_FOUND', `No account for ${email}`);
  res.json(await getKYCStatus(user.account.id));
});

/** Resolve an account id by email, defaulting to the seeded investor. */
async function accountIdByEmail(email = 'investor@demo.com'): Promise<string> {
  const user = await prisma.user.findUnique({ where: { email }, include: { account: true } });
  if (!user?.account) throw new HttpError(404, 'NOT_FOUND', `No account for ${email}`);
  return user.account.id;
}

// --- POST /test/plaid/simulate-link ---------------------------------------
testRouter.post('/plaid/simulate-link', async (req: Request, res: Response) => {
  const email = (req.body?.email as string) || 'investor@demo.com';
  const accountId = await accountIdByEmail(email);
  res.json(await linkSandboxBank(accountId));
});

// --- POST /test/plaid/deposit ---------------------------------------------
testRouter.post('/plaid/deposit', async (req: Request, res: Response) => {
  const { amountCents, email } = (req.body ?? {}) as { amountCents?: number | string; email?: string };
  if (amountCents == null) throw new HttpError(400, 'AMOUNT_REQUIRED', 'amountCents is required');
  const accountId = await accountIdByEmail(email);
  const user = await prisma.account.findUnique({ where: { id: accountId }, select: { userId: true } });
  try {
    const result = await initiateDeposit({
      accountId,
      amountCents: BigInt(amountCents),
      userId: user!.userId,
    });
    res.status(201).json({
      depositId: result.depositId,
      amountCents: result.amountCents.toString(),
      settlementDate: result.settlementDate.toISOString(),
      status: result.status,
    });
  } catch (err) {
    throw new HttpError(400, 'DEPOSIT_ERROR', err instanceof Error ? err.message : 'Deposit failed');
  }
});

// --- POST /test/plaid/settle ----------------------------------------------
testRouter.post('/plaid/settle', async (req: Request, res: Response) => {
  const { depositId } = (req.body ?? {}) as { depositId?: string };
  if (!depositId) throw new HttpError(400, 'DEPOSIT_ID_REQUIRED', 'depositId is required');
  const d = await settleDeposit(depositId);
  res.json({ status: d.status, amountCents: d.amountCents.toString() });
});

// --- POST /test/plaid/bounce ----------------------------------------------
testRouter.post('/plaid/bounce', async (req: Request, res: Response) => {
  const { depositId, reason } = (req.body ?? {}) as { depositId?: string; reason?: string };
  if (!depositId) throw new HttpError(400, 'DEPOSIT_ID_REQUIRED', 'depositId is required');
  const d = await bounceDeposit(depositId, reason || 'NSF');
  res.json({ status: d.status, reason: d.returnReason });
});

// --- GET /test/plaid/balance?email= ---------------------------------------
testRouter.get('/plaid/balance', async (req: Request, res: Response) => {
  const email = (req.query.email as string) || 'investor@demo.com';
  const accountId = await accountIdByEmail(email);
  const b = await getBalances(accountId);
  res.json({
    cashBalanceCents: b.cashBalanceCents.toString(),
    cashBalanceUSD: (Number(b.cashBalanceCents) / 100).toFixed(2),
    pendingDepositsCents: b.pendingDepositsCents.toString(),
    availableBalanceCents: b.availableBalanceCents.toString(),
  });
});

// --- POST /test/alpaca/submit-portfolio -----------------------------------
testRouter.post('/alpaca/submit-portfolio', async (req: Request, res: Response) => {
  const { email, portfolioType } = (req.body ?? {}) as { email?: string; portfolioType?: string };
  if (!isPortfolioType(portfolioType)) {
    throw new HttpError(400, 'INVALID_PORTFOLIO', 'portfolioType must be one of the 4 models');
  }
  const accountId = await accountIdByEmail(email);
  const availableCashCents = await getCashBalance(accountId);
  const orders = await submitPortfolioOrders({ accountId, portfolioType, availableCashCents });
  res.status(201).json({ orders, availableCashCents: availableCashCents.toString() });
});

// --- GET /test/alpaca/orders?email= ---------------------------------------
testRouter.get('/alpaca/orders', async (req: Request, res: Response) => {
  const accountId = await accountIdByEmail(req.query.email as string | undefined);
  const orders = await prisma.order.findMany({ where: { accountId }, orderBy: { createdAt: 'desc' } });
  res.json({ orders });
});

// --- POST /test/alpaca/simulate-fill --------------------------------------
testRouter.post('/alpaca/simulate-fill', async (req: Request, res: Response) => {
  const { orderId, fillPrice, fillQty } = (req.body ?? {}) as {
    orderId?: string;
    fillPrice?: number | string;
    fillQty?: number | string;
  };
  if (!orderId) throw new HttpError(400, 'ORDER_ID_REQUIRED', 'orderId is required');
  const order = await prisma.order.findUnique({ where: { id: orderId } });
  if (!order) throw new HttpError(404, 'NOT_FOUND', `Order ${orderId} not found`);

  const priceCents = fillPrice != null
    ? BigInt(Math.round(parseFloat(String(fillPrice)) * 100))
    : await getLatestPrice(order.symbol);
  const price = (Number(priceCents) / 100).toFixed(2);
  const qty = fillQty != null ? String(fillQty) : (order.requestedUnits?.toString() ?? '0');
  const refId = order.alpacaOrderId ?? order.id;

  const updated = await handleFillWebhook({
    event: 'fill',
    order_id: refId,
    client_order_id: order.id,
    symbol: order.symbol,
    qty,
    price,
    timestamp: new Date().toISOString(),
    execution_id: `sim-${order.id}`,
  });

  const ledgerEntries = await prisma.ledgerEntry.findMany({
    where: { referenceId: refId, referenceType: 'ALPACA_FILL' },
  });
  res.json({ order: updated, ledgerEntries });
});

// --- GET /test/alpaca/positions?email= ------------------------------------
testRouter.get('/alpaca/positions', async (req: Request, res: Response) => {
  const accountId = await accountIdByEmail(req.query.email as string | undefined);
  res.json({ positions: await getPositions(accountId) });
});

// --- POST /test/alpaca/check-fills -----------------------------------------
testRouter.post('/alpaca/check-fills', async (_req: Request, res: Response) => {
  res.json(await pollOpenOrders());
});

// ===========================================================================
// Valuation (Step 7)
// ===========================================================================

function startOfUtcDay(d: Date): Date {
  const x = new Date(d);
  x.setUTCHours(0, 0, 0, 0);
  return x;
}
const usd = (cents: bigint | number | string) => `$${(Number(cents) / 100).toFixed(2)}`;

// --- POST /test/valuation/run ---------------------------------------------
testRouter.post('/valuation/run', async (_req: Request, res: Response) => {
  res.json(await runDailyValuation());
});

// --- GET /test/valuation/latest?email= ------------------------------------
testRouter.get('/valuation/latest', async (req: Request, res: Response) => {
  const accountId = await accountIdByEmail(req.query.email as string | undefined);
  const v = await getLatestValuation(accountId);
  if (!v) {
    res.json({ valuation: null, message: 'No valuation yet — run /test/valuation/run' });
    return;
  }
  res.json({
    totalValueCents: Number(v.totalValueCents),
    totalValueUSD: usd(v.totalValueCents),
    cashCents: Number(v.cashCents),
    investedValueCents: Number(v.investedValueCents),
    valuationDate: v.valuationDate.toISOString().slice(0, 10),
  });
});

// --- GET /test/valuation/history?email=&days= -----------------------------
testRouter.get('/valuation/history', async (req: Request, res: Response) => {
  const accountId = await accountIdByEmail(req.query.email as string | undefined);
  const days = req.query.days ? Number(req.query.days) : 30;
  const start = new Date(Date.now() - days * 86_400_000);
  const valuations = await getValuationHistory(accountId, start);
  res.json({
    valuations: valuations.map((v) => ({
      date: v.valuationDate.toISOString().slice(0, 10),
      totalValueCents: Number(v.totalValueCents),
      totalValueUSD: usd(v.totalValueCents),
      cashCents: Number(v.cashCents),
      investedValueCents: Number(v.investedValueCents),
      isRestated: v.isRestated,
    })),
  });
});

// --- POST /test/valuation/fetch-prices ------------------------------------
testRouter.post('/valuation/fetch-prices', async (_req: Request, res: Response) => {
  const out: Record<string, { priceCents: number; priceUSD: string } | { error: string }> = {};
  for (const symbol of ['VTI', 'BND']) {
    try {
      const cents = await fetchAndStorePrice(symbol, new Date());
      out[symbol] = { priceCents: Number(cents), priceUSD: usd(cents) };
    } catch (err) {
      out[symbol] = { error: err instanceof Error ? err.message : String(err) };
    }
  }
  res.json(out);
});

// --- GET /test/valuation/prices?symbol= -----------------------------------
testRouter.get('/valuation/prices', async (req: Request, res: Response) => {
  const symbol = ((req.query.symbol as string) || 'VTI').toUpperCase();
  const prices = await prisma.marketPrice.findMany({
    where: { symbol },
    orderBy: { date: 'desc' },
    take: 7,
  });
  res.json({
    symbol,
    prices: prices.map((p) => ({
      date: p.date.toISOString().slice(0, 10),
      priceCents: Number(p.closePriceCents),
      priceUSD: usd(p.closePriceCents),
      isStale: p.isStale,
      source: p.source,
    })),
  });
});

// --- POST /test/valuation/simulate-day ------------------------------------
// Advances one trading day: nudges prices (VTI ±0.5%, BND ±0.2%), stores them,
// then re-values every active account under the new date.
testRouter.post('/valuation/simulate-day', async (_req: Request, res: Response) => {
  const lastVal = await prisma.valuation.findFirst({ orderBy: { valuationDate: 'desc' } });
  const base = lastVal ? startOfUtcDay(lastVal.valuationDate) : startOfUtcDay(new Date());
  const simDate = new Date(base.getTime() + 86_400_000);

  const moves: Record<string, number> = { VTI: 0.005, BND: 0.002 };
  const prices: Record<string, { priceCents: number; priceUSD: string }> = {};
  for (const [symbol, band] of Object.entries(moves)) {
    let currentCents: bigint;
    try {
      currentCents = (await getStoredPrice(symbol, simDate)).priceCents;
    } catch {
      continue; // no prior price for this symbol; skip
    }
    const pct = (Math.random() * 2 - 1) * band; // ±band
    const newCents = BigInt(Math.max(1, Math.round(Number(currentCents) * (1 + pct))));
    await prisma.marketPrice.upsert({
      where: { symbol_date: { symbol, date: simDate } },
      update: { closePriceCents: newCents, isStale: false, source: 'simulated' },
      create: { symbol, date: simDate, closePriceCents: newCents, isStale: false, source: 'simulated' },
    });
    prices[symbol] = { priceCents: Number(newCents), priceUSD: usd(newCents) };
  }

  const accounts = await prisma.account.findMany({ where: { status: 'ACTIVE' } });
  const portfolios: Array<{ accountId: string; totalValueUSD: string; totalValueCents: number }> = [];
  for (const acc of accounts) {
    const data = await calculateAccountValuation(acc.id, simDate);
    await storeValuation(acc.id, simDate, data);
    portfolios.push({
      accountId: acc.id,
      totalValueCents: Number(data.totalValueCents),
      totalValueUSD: usd(data.totalValueCents),
    });
  }

  res.json({ simDate: simDate.toISOString().slice(0, 10), prices, portfolios });
});

// ===========================================================================
// TWR (Step 8)
// ===========================================================================

// --- GET /test/twr/calculate?email= ---------------------------------------
testRouter.get('/twr/calculate', async (req: Request, res: Response) => {
  const accountId = await accountIdByEmail(req.query.email as string | undefined);
  res.json(await calculateTWRForPeriods(accountId));
});

// --- GET /test/twr/verify-deposit-excluded?email= -------------------------
// Proves a deposit does not change TWR: a deposit with no market move forms a
// sub-period whose return is exactly 0, so chaining leaves TWR unchanged.
testRouter.get('/twr/verify-deposit-excluded', async (req: Request, res: Response) => {
  const accountId = await accountIdByEmail(req.query.email as string | undefined);
  const before = await calculateTWRSinceInception(accountId);

  const depositCents = 5_000_000n; // $50,000
  const lastValue = BigInt(before.endValueCents || '0');
  const rDeposit = calculateSubPeriodReturn(lastValue, lastValue + depositCents, depositCents); // → 0
  const beforePct = new Prisma.Decimal(before.twrPct);
  const afterPct = beforePct.plus(1).times(rDeposit.plus(1)).minus(1);
  const depositsExcluded = afterPct.minus(beforePct).abs().lt(new Prisma.Decimal('0.000001'));

  res.json({
    note: 'A $50,000 deposit with no market movement is a 0% sub-period; TWR is unchanged.',
    twrBefore: before.twrDisplay,
    twrAfter: `${afterPct.times(100).toDecimalPlaces(2).gte(0) ? '+' : ''}${afterPct.times(100).toDecimalPlaces(2)}%`,
    twrBeforePct: beforePct.toString(),
    twrAfterPct: afterPct.toString(),
    depositSubPeriodReturn: rDeposit.toString(),
    depositsExcluded,
  });
});

// --- POST /test/twr/simulate-performance ----------------------------------
// Simulates 30 trading days for the demo investor: nudge prices, value & TWR
// each day. Returns chart data [{ date, value, twrPct }].
testRouter.post('/twr/simulate-performance', async (_req: Request, res: Response) => {
  const accountId = await accountIdByEmail('investor@demo.com');
  const lastVal = await prisma.valuation.findFirst({
    where: { accountId },
    orderBy: { valuationDate: 'desc' },
  });
  let cursor = lastVal ? startOfUtcDay(lastVal.valuationDate) : startOfUtcDay(new Date());

  const bands: Record<string, number> = { VTI: 0.005, BND: 0.002 };
  const chart: Array<{ date: string; valueCents: number; valueUSD: string; twrPct: string }> = [];

  for (let i = 0; i < 30; i++) {
    cursor = new Date(cursor.getTime() + 86_400_000);
    for (const [symbol, band] of Object.entries(bands)) {
      let currentCents: bigint;
      try {
        currentCents = (await getStoredPrice(symbol, cursor)).priceCents;
      } catch {
        continue;
      }
      const pct = (Math.random() * 2 - 1) * band;
      const newCents = BigInt(Math.max(1, Math.round(Number(currentCents) * (1 + pct))));
      await prisma.marketPrice.upsert({
        where: { symbol_date: { symbol, date: cursor } },
        update: { closePriceCents: newCents, isStale: false, source: 'simulated' },
        create: { symbol, date: cursor, closePriceCents: newCents, isStale: false, source: 'simulated' },
      });
    }
    const data = await calculateAccountValuation(accountId, cursor);
    await storeValuation(accountId, cursor, data);
    const updated = await updateValuationWithTWR(accountId, cursor);
    chart.push({
      date: cursor.toISOString().slice(0, 10),
      valueCents: Number(data.totalValueCents),
      valueUSD: usd(data.totalValueCents),
      twrPct: updated?.twrPct?.toString() ?? '0',
    });
  }

  res.json({ days: chart.length, chart });
});

export default testRouter;
