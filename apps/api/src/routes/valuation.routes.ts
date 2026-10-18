import { Router, type Response } from 'express';
import { authenticate, requireRole } from '../middleware/auth.middleware';
import { HttpError, type AuthedRequest } from '../types';
import {
  getValuationHistory,
  getLatestValuation,
  getValuationAsOf,
  calculateAccountValuation,
  runDailyValuation,
} from '../services/valuation.service';

export const valuationRouter = Router();

// GET /valuation/history?startDate=&endDate= (auth)
valuationRouter.get('/history', authenticate, async (req: AuthedRequest, res: Response) => {
  const startDate = req.query.startDate ? new Date(String(req.query.startDate)) : undefined;
  const endDate = req.query.endDate ? new Date(String(req.query.endDate)) : undefined;
  const valuations = await getValuationHistory(req.user!.accountId, startDate, endDate);
  res.json({ valuations });
});

// GET /valuation/latest (auth)
valuationRouter.get('/latest', authenticate, async (req: AuthedRequest, res: Response) => {
  const valuation = await getLatestValuation(req.user!.accountId);
  res.json({ valuation });
});

// GET /valuation/as-of/:date (auth)
valuationRouter.get('/as-of/:date', authenticate, async (req: AuthedRequest, res: Response) => {
  const d = new Date(req.params.date);
  if (Number.isNaN(d.getTime())) throw new HttpError(400, 'INVALID_DATE', 'Invalid date');
  const valuation = await getValuationAsOf(req.user!.accountId, d);
  res.json({ valuation });
});

// GET /valuation/portfolio-value (auth) — live, not from a snapshot.
valuationRouter.get('/portfolio-value', authenticate, async (req: AuthedRequest, res: Response) => {
  const data = await calculateAccountValuation(req.user!.accountId, new Date());
  res.json({
    cashCents: data.cashCents.toString(),
    investedValueCents: data.investedValueCents.toString(),
    totalValueCents: data.totalValueCents.toString(),
    positionValues: data.positionValues,
    hasStalePrice: data.hasStalePrice,
    asOf: new Date().toISOString(),
  });
});

// POST /valuation/run (adviser only) — manual full run.
valuationRouter.post('/run', authenticate, requireRole('ADVISER'), async (_req: AuthedRequest, res: Response) => {
  const result = await runDailyValuation();
  res.json(result);
});

export default valuationRouter;
