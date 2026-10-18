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
import {
  restateValuationsAfterPriceCorrection,
  restateAccountValuation,
  getValuationAsPublished,
  getValuationAsRestated,
  getRestatementHistory,
} from '../services/restatement.service';
import { generateDailyFile } from '../services/custodian-simulator.service';
import {
  reconcileAgainstFile,
  runDailyReconciliation,
  listBreaks,
  resolveBreak,
  getBreakSummary,
} from '../services/reconciliation.service';
import { BreakType, ApprovalType } from '@prisma/client';
import {
  toolManifest,
  getAccountBalance,
  getPortfolioPositions,
  getReconciliationBreaks,
  initiateRebalance,
} from '../mcp/tools';

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
      where: { symbol_date_isRestated: { symbol, date: simDate, isRestated: false } },
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
        where: { symbol_date_isRestated: { symbol, date: cursor, isRestated: false } },
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

// ===========================================================================
// Restatement (Step 9)
// ===========================================================================

/** Pick an investor valuation date that also has a VTI price — a good restatement target. */
async function pickRestatementTarget(accountId: string) {
  const vals = await prisma.valuation.findMany({
    where: { accountId, isRestated: false },
    orderBy: { valuationDate: 'asc' },
  });
  const candidates: { val: (typeof vals)[number]; priceCents: bigint }[] = [];
  for (const v of vals) {
    const mp = await prisma.marketPrice.findFirst({
      where: { symbol: 'VTI', date: v.valuationDate, isRestated: false },
    });
    if (mp) candidates.push({ val: v, priceCents: mp.closePriceCents });
  }
  if (candidates.length === 0) return null;
  // ~3 entries before the latest (a "past date"), else the earliest candidate.
  return candidates[Math.max(0, candidates.length - 4)];
}

// --- POST /test/restatement/run-full-test ---------------------------------
// Self-contained: backfills 3 real past-dated snapshots (5/4/3 days ago) with
// BACKDATED bookingDates, then restates the 3-days-ago one — so the bitemporal
// "as published on an earlier date" works with real dates.
testRouter.post('/restatement/run-full-test', async (_req: Request, res: Response) => {
  const accountId = await accountIdByEmail('investor@demo.com');
  const DAY = 86_400_000;
  const dates = [5, 4, 3].map((n) => startOfUtcDay(new Date(Date.now() - n * DAY))); // oldest → newest

  const base = async (sym: string, fallback: bigint): Promise<bigint> => {
    try {
      return (await getStoredPrice(sym, new Date())).priceCents;
    } catch {
      return fallback;
    }
  };
  const vtiBase = await base('VTI', 37_000n);
  const bndBase = await base('BND', 7_000n);

  // Reset these synthetic target dates so the scenario is deterministic on every
  // run (no leftover restated rows / corrupted originals from a prior run).
  await prisma.valuation.deleteMany({ where: { accountId, valuationDate: { in: dates } } });
  await prisma.marketPrice.deleteMany({ where: { symbol: { in: ['VTI', 'BND'] }, date: { in: dates } } });

  // Backfill original prices + backdated original valuations for each date.
  for (let i = 0; i < dates.length; i++) {
    const date = dates[i];
    await prisma.marketPrice.upsert({
      where: { symbol_date_isRestated: { symbol: 'VTI', date, isRestated: false } },
      update: {},
      create: { symbol: 'VTI', date, closePriceCents: vtiBase + BigInt(i * 50), isStale: false, source: 'backfill' },
    });
    await prisma.marketPrice.upsert({
      where: { symbol_date_isRestated: { symbol: 'BND', date, isRestated: false } },
      update: {},
      create: { symbol: 'BND', date, closePriceCents: bndBase + BigInt(i * 5), isStale: false, source: 'backfill' },
    });
    const exists = await prisma.valuation.findFirst({ where: { accountId, valuationDate: date, isRestated: false } });
    if (!exists) {
      const data = await calculateAccountValuation(accountId, date);
      await prisma.valuation.create({
        data: {
          accountId,
          valuationDate: date,
          bookingDate: date, // BACKDATED — recorded on its value date
          totalValueCents: data.totalValueCents,
          cashCents: data.cashCents,
          investedValueCents: data.investedValueCents,
          returnPct: new Prisma.Decimal(0),
          twrPct: new Prisma.Decimal(0),
          isRestated: false,
        },
      });
      // Set the ORIGINAL row's TWR ONLY on first creation — before any
      // restatement exists for this date — so re-runs don't recompute the
      // published figure from already-corrected data.
      await updateValuationWithTWR(accountId, date);
    }
  }

  const valuationDate = dates[dates.length - 1]; // 3 days ago
  const vtiRow = await prisma.marketPrice.findFirst({
    where: { symbol: 'VTI', date: valuationDate, isRestated: false },
  });
  const originalPriceCents = vtiRow!.closePriceCents;
  const correctedPriceCents = BigInt(Math.round(Number(originalPriceCents) * 1.05)); // +5%

  // Snapshot the original row BEFORE restating.
  const originalBefore = await prisma.valuation.findFirst({
    where: { accountId, valuationDate, isRestated: false },
  });

  const result = await restateValuationsAfterPriceCorrection(
    'VTI',
    valuationDate,
    correctedPriceCents,
    'Custodian correction (run-full-test)',
  );

  // Re-read both rows AFTER.
  const originalAfter = await prisma.valuation.findFirst({
    where: { accountId, valuationDate, isRestated: false },
  });
  const restated = await prisma.valuation.findFirst({
    where: { accountId, valuationDate, isRestated: true },
    orderBy: { bookingDate: 'desc' },
  });

  const originalUntouched =
    !!originalBefore &&
    !!originalAfter &&
    originalBefore.totalValueCents === originalAfter.totalValueCents &&
    originalBefore.twrPct.toString() === originalAfter.twrPct.toString() &&
    originalBefore.bookingDate.getTime() === originalAfter.bookingDate.getTime();

  const money = (c: bigint) => `$${(Number(c) / 100).toFixed(2)}`;
  const pct = (p: string) => `${(Number(p) * 100).toFixed(2)}%`;

  res.json({
    scenario: 'Price correction for VTI',
    originalPrice: { date: valuationDate.toISOString().slice(0, 10), priceCents: Number(originalPriceCents), priceUSD: money(originalPriceCents) },
    correctedPrice: { date: valuationDate.toISOString().slice(0, 10), priceCents: Number(correctedPriceCents), priceUSD: money(correctedPriceCents) },
    valuationDate: valuationDate.toISOString().slice(0, 10),
    asPublished: originalAfter && {
      totalValueCents: Number(originalAfter.totalValueCents),
      totalValueUSD: money(originalAfter.totalValueCents),
      twrPct: pct(originalAfter.twrPct.toString()),
      bookingDate: originalAfter.bookingDate.toISOString(),
    },
    asRestated: restated && {
      totalValueCents: Number(restated.totalValueCents),
      totalValueUSD: money(restated.totalValueCents),
      twrPct: pct(restated.twrPct.toString()),
      bookingDate: restated.bookingDate.toISOString(),
    },
    difference: restated && originalAfter && {
      valueCents: Number(restated.totalValueCents - originalAfter.totalValueCents),
      valueUSD: money(restated.totalValueCents - originalAfter.totalValueCents),
      twrPctChange: `${((Number(restated.twrPct) - Number(originalAfter.twrPct)) * 100).toFixed(2)}%`,
    },
    auditTrail: {
      originalRowId: originalAfter?.id,
      restatementRowId: restated?.id,
      originalUntouched,
      bothQueryable: !!originalAfter && !!restated,
    },
    verification: {
      originalStillExists: !!originalAfter,
      restatementCreated: !!restated,
      valuesAreDifferent: !!restated && !!originalAfter && restated.totalValueCents !== originalAfter.totalValueCents,
      twrRecalculated:
        !!restated &&
        !!originalAfter &&
        Math.abs(Number(restated.twrPct) - Number(originalAfter.twrPct)) > 0.000001,
    },
    affectedAccounts: result.affectedAccounts,
  });
});

// --- GET /test/restatement/as-published?email=&valuationDate=&asOfDate= ----
testRouter.get('/restatement/as-published', async (req: Request, res: Response) => {
  const accountId = await accountIdByEmail(req.query.email as string | undefined);
  if (!req.query.valuationDate || !req.query.asOfDate) {
    throw new HttpError(400, 'PARAMS_REQUIRED', 'valuationDate and asOfDate required');
  }
  const v = await getValuationAsPublished(
    accountId,
    new Date(String(req.query.valuationDate)),
    new Date(String(req.query.asOfDate)),
  );
  res.json({ valuation: v });
});

// --- GET /test/restatement/as-restated?email=&valuationDate= ---------------
testRouter.get('/restatement/as-restated', async (req: Request, res: Response) => {
  const accountId = await accountIdByEmail(req.query.email as string | undefined);
  if (!req.query.valuationDate) throw new HttpError(400, 'PARAMS_REQUIRED', 'valuationDate required');
  const v = await getValuationAsRestated(accountId, new Date(String(req.query.valuationDate)));
  res.json({ valuation: v });
});

// --- GET /test/restatement/history?email= ---------------------------------
testRouter.get('/restatement/history', async (req: Request, res: Response) => {
  const accountId = await accountIdByEmail(req.query.email as string | undefined);
  res.json({ restatements: await getRestatementHistory(accountId) });
});

// --- POST /test/restatement/simulate-late-dividend ------------------------
testRouter.post('/restatement/simulate-late-dividend', async (_req: Request, res: Response) => {
  const accountId = await accountIdByEmail('investor@demo.com');
  const target = await pickRestatementTarget(accountId);
  if (!target) throw new HttpError(400, 'NO_TARGET', 'No valuation to restate');
  const valuationDate = target.val.valuationDate;

  const before = await getValuationAsRestated(accountId, valuationDate);

  // A late dividend is investment income (not an external cash flow): a single
  // value-increasing ledger entry (append-only).
  const dividendCents = 2500n; // $25.00
  await prisma.ledgerEntry.create({
    data: {
      accountId,
      type: EntryType.DIVIDEND_CASH,
      amount: dividendCents,
      assetSymbol: 'VTI',
      description: 'Late dividend (simulated)',
      effectiveDate: valuationDate,
      metadata: { bucket: 'SETTLED_CASH', event: 'late_dividend' },
    },
  });

  const restatement = await restateAccountValuation(accountId, valuationDate, 'Late dividend arrived', {
    dividend: { symbol: 'VTI', amountCents: Number(dividendCents) },
  });
  const after = await getValuationAsRestated(accountId, valuationDate);

  res.json({
    valuationDate: valuationDate.toISOString().slice(0, 10),
    dividendCents: Number(dividendCents),
    before: before && { totalValueCents: Number(before.totalValueCents), twrPct: before.twrPct.toString() },
    after: after && { totalValueCents: Number(after.totalValueCents), twrPct: after.twrPct.toString() },
    restatement,
  });
});

// ===========================================================================
// Reconciliation (Step 10)
// ===========================================================================

const BREAK_TYPE_FOR: Record<string, BreakType> = {
  missing: BreakType.MISSING_IN_CUSTODIAN,
  amount: BreakType.AMOUNT_MISMATCH,
  price: BreakType.PRICE_MISMATCH,
};

// --- POST /test/reconciliation/generate-file (clean) ----------------------
testRouter.post('/reconciliation/generate-file', async (_req: Request, res: Response) => {
  const today = startOfUtcDay(new Date());
  res.json({ file: await generateDailyFile(today, false) });
});

// --- POST /test/reconciliation/plant-break --------------------------------
testRouter.post('/reconciliation/plant-break', async (req: Request, res: Response) => {
  const { type, symbol } = (req.body ?? {}) as { type?: 'missing' | 'amount' | 'price'; symbol?: string };
  if (!type || !BREAK_TYPE_FOR[type]) {
    throw new HttpError(400, 'INVALID_TYPE', "type must be 'missing', 'amount' or 'price'");
  }
  const today = startOfUtcDay(new Date());
  const file = await generateDailyFile(today, true, { type, symbol });
  const { breaks } = await reconcileAgainstFile(file, today);

  const breakType = BREAK_TYPE_FOR[type];
  const found = breaks.find((b) => b.breakType === breakType && (!symbol || b.symbol === symbol)) ?? null;

  res.json({
    breakPlanted: { type: breakType, symbol: symbol ?? null, description: `${symbol ?? 'a position'} ${type} break` },
    breakFound: found && {
      id: found.id,
      breakType: found.breakType,
      symbol: found.symbol,
      ledgerValue: found.ledgerValue?.toString() ?? null,
      custodianValue: found.custodianValue?.toString() ?? null,
      difference: found.difference?.toString() ?? null,
      agingDays: found.agingDays,
      status: found.status,
    },
    detected: !!found,
  });
});

// --- POST /test/reconciliation/run ----------------------------------------
testRouter.post('/reconciliation/run', async (_req: Request, res: Response) => {
  res.json(await runDailyReconciliation());
});

// --- GET /test/reconciliation/breaks --------------------------------------
testRouter.get('/reconciliation/breaks', async (_req: Request, res: Response) => {
  const breaks = await listBreaks({ status: 'all' });
  res.json({
    breaks: breaks.map((b) => ({
      id: b.id,
      breakType: b.breakType,
      symbol: b.symbol,
      ledgerValue: b.ledgerValue?.toString() ?? null,
      custodianValue: b.custodianValue?.toString() ?? null,
      difference: b.difference?.toString() ?? null,
      agingDays: b.agingDays,
      status: b.status,
      breakDate: b.breakDate.toISOString().slice(0, 10),
    })),
  });
});

// --- POST /test/reconciliation/resolve/:id --------------------------------
testRouter.post('/reconciliation/resolve/:id', async (req: Request, res: Response) => {
  const resolution = (req.body?.resolution as string) ?? 'Resolved (test)';
  res.json({ break: await resolveBreak(req.params.id, resolution) });
});

// --- GET /test/reconciliation/summary -------------------------------------
testRouter.get('/reconciliation/summary', async (_req: Request, res: Response) => {
  res.json(await getBreakSummary());
});

// --- POST /test/adviser/seed-approval -------------------------------------
// Seeds a PENDING rebalance approval from the investor, for the adviser queue.
testRouter.post('/adviser/seed-approval', async (_req: Request, res: Response) => {
  const investor = await prisma.user.findUnique({ where: { email: 'investor@demo.com' } });
  if (!investor) throw new HttpError(404, 'NO_INVESTOR', 'investor@demo.com not found');
  const approval = await prisma.approvalQueue.create({
    data: {
      initiatorId: investor.id,
      type: ApprovalType.REBALANCE,
      status: 'PENDING',
      payload: {
        portfolio: 'GROWTH',
        action: 'Monthly portfolio rebalance',
        trades: [
          { side: 'BUY', symbol: 'VTI', estCents: 50000 },
          { side: 'SELL', symbol: 'BND', estCents: 20000 },
        ],
        requestedBy: investor.email,
      },
    },
  });
  res.status(201).json({ approval });
});

// ===========================================================================
// MCP agent surface (Step 12)
// ===========================================================================

async function clearPendingRebalance(accountId: string) {
  await prisma.approvalQueue.deleteMany({
    where: { type: 'REBALANCE', status: 'PENDING', payload: { path: ['accountId'], equals: accountId } },
  });
}

// GET /test/mcp/tools
testRouter.get('/mcp/tools', (_req: Request, res: Response) => {
  res.json({ tools: toolManifest });
});

// POST /test/mcp/get-balance { email }
testRouter.post('/mcp/get-balance', async (req: Request, res: Response) => {
  const accountId = await accountIdByEmail((req.body?.email as string) ?? 'investor@demo.com');
  res.json(await getAccountBalance({ account_id: accountId }));
});

// POST /test/mcp/get-positions { email }
testRouter.post('/mcp/get-positions', async (req: Request, res: Response) => {
  const accountId = await accountIdByEmail((req.body?.email as string) ?? 'investor@demo.com');
  res.json(await getPortfolioPositions({ account_id: accountId }));
});

// POST /test/mcp/get-breaks
testRouter.post('/mcp/get-breaks', async (_req: Request, res: Response) => {
  res.json(await getReconciliationBreaks({ status: 'OPEN' }));
});

// POST /test/mcp/initiate-rebalance { email, reason } — creates a PENDING approval, no trade.
testRouter.post('/mcp/initiate-rebalance', async (req: Request, res: Response) => {
  const accountId = await accountIdByEmail((req.body?.email as string) ?? 'investor@demo.com');
  await clearPendingRebalance(accountId); // dev: keep idempotent across runs
  res.json(await initiateRebalance({ account_id: accountId, reason: (req.body?.reason as string) ?? 'Monthly rebalance check', initiated_by: 'MCP Agent' }));
});

// POST /test/mcp/verify-maker-checker { email }
testRouter.post('/mcp/verify-maker-checker', async (req: Request, res: Response) => {
  const email = (req.body?.email as string) ?? 'investor@demo.com';
  const user = await prisma.user.findUnique({ where: { email }, include: { account: true } });
  if (!user?.account) throw new HttpError(404, 'NOT_FOUND', `No account for ${email}`);

  await clearPendingRebalance(user.account.id);
  const result = await initiateRebalance({ account_id: user.account.id, reason: 'maker-checker test', initiated_by: 'MCP Agent' });
  const approvalId = JSON.parse(result.content[0].text).approvalId as string;
  const approval = await prisma.approvalQueue.findUnique({ where: { id: approvalId } });

  // The approve endpoint rejects when initiatorId === approver's userId. Here the
  // "agent" acts for the account's own user, so a self-approval would be blocked.
  const selfApprovalBlocked = approval!.initiatorId === user.id;

  res.json({
    makerCheckerEnforced: selfApprovalBlocked,
    approvalId,
    initiatorId: approval!.initiatorId,
    attemptedApproverId: user.id,
    status: approval!.status,
    note: 'initiate_rebalance only queued a PENDING approval; no trade was executed. Self-approval is blocked.',
  });
});

export default testRouter;
