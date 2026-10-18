import { Router, type Response } from 'express';
import { authenticate, requireKYC } from '../middleware/auth.middleware';
import { HttpError, type AuthedRequest } from '../types';
import { prisma } from '../lib/prisma';
import { MODEL_PORTFOLIOS, isPortfolioType } from '../services/portfolios';
import { submitPortfolioOrders, getPositions, getLatestPrice } from '../services/alpaca.service';
import { getCashBalance } from '../services/ledger.service';
import { Prisma } from '@prisma/client';

const MIN_INVEST_CENTS = 1000n; // $10 minimum

export const portfolioRouter = Router();

// GET /portfolio/models (public) — the 4 model portfolios.
portfolioRouter.get('/models', (_req, res: Response) => {
  const models = Object.values(MODEL_PORTFOLIOS).map((m) => ({
    name: m.name,
    type: m.type,
    description: m.description,
    riskLevel: m.riskLevel,
    expectedReturn: m.expectedReturn,
    weights: m.weights,
    cashBufferPct: m.cashBufferPct,
  }));
  res.json({ models });
});

// GET /portfolio/my (auth) — current portfolio snapshot.
portfolioRouter.get('/my', authenticate, async (req: AuthedRequest, res: Response) => {
  const accountId = req.user!.accountId;
  const [account, positions, cashBalanceCents, orders] = await Promise.all([
    prisma.account.findUnique({ where: { id: accountId } }),
    getPositions(accountId),
    getCashBalance(accountId),
    prisma.order.findMany({ where: { accountId }, orderBy: { createdAt: 'desc' } }),
  ]);
  const totalInvestedCents = positions.reduce((s, p) => s + BigInt(p.currentValueCents), 0n);
  res.json({
    portfolioType: account?.selectedPortfolio ?? null,
    positions,
    cashBalanceCents: cashBalanceCents.toString(),
    totalValueCents: (cashBalanceCents + totalInvestedCents).toString(),
    orders,
  });
});

// POST /portfolio/invest (auth + KYC) — pick a portfolio and place orders.
portfolioRouter.post('/invest', authenticate, requireKYC, async (req: AuthedRequest, res: Response) => {
  const { portfolioType } = req.body ?? {};
  if (!isPortfolioType(portfolioType)) {
    throw new HttpError(400, 'INVALID_PORTFOLIO', 'portfolioType must be one of the 4 models');
  }
  const accountId = req.user!.accountId;
  const availableCashCents = await getCashBalance(accountId);
  if (availableCashCents < MIN_INVEST_CENTS) {
    throw new HttpError(400, 'INSUFFICIENT_CASH', 'Minimum investable balance is $10.00');
  }

  const orders = await submitPortfolioOrders({ accountId, portfolioType, availableCashCents });

  // Estimated total = sum of requestedUnits * latest price (cents).
  let estimatedTotalCents = 0n;
  for (const o of orders) {
    if (!o.requestedUnits) continue;
    const price = await getLatestPrice(o.symbol);
    estimatedTotalCents += BigInt(
      o.requestedUnits.mul(price.toString()).toDecimalPlaces(0, Prisma.Decimal.ROUND_DOWN).toFixed(0),
    );
  }
  res.status(201).json({ orders, estimatedTotalCents: estimatedTotalCents.toString() });
});

// GET /portfolio/orders (auth)
portfolioRouter.get('/orders', authenticate, async (req: AuthedRequest, res: Response) => {
  const orders = await prisma.order.findMany({
    where: { accountId: req.user!.accountId },
    orderBy: { createdAt: 'desc' },
  });
  res.json({ orders });
});

// GET /portfolio/positions (auth)
portfolioRouter.get('/positions', authenticate, async (req: AuthedRequest, res: Response) => {
  res.json({ positions: await getPositions(req.user!.accountId) });
});

export default portfolioRouter;
