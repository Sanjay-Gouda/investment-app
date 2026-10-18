import { Router, type Response } from 'express';
import { authenticate, requireRole } from '../middleware/auth.middleware';
import { HttpError, type AuthedRequest } from '../types';
import {
  restateValuationsAfterPriceCorrection,
  getRestatementHistory,
  getValuationAsPublished,
  getValuationAsRestated,
} from '../services/restatement.service';

export const restatementRouter = Router();

// POST /restatement/correct-price (adviser only)
restatementRouter.post('/correct-price', authenticate, requireRole('ADVISER'), async (req: AuthedRequest, res: Response) => {
  const { symbol, date, correctPriceCents, reason } = req.body ?? {};
  if (!symbol || !date || correctPriceCents == null || !reason) {
    throw new HttpError(400, 'INVALID_CORRECTION', 'symbol, date, correctPriceCents and reason are required');
  }
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) throw new HttpError(400, 'INVALID_DATE', 'Invalid date');

  const result = await restateValuationsAfterPriceCorrection(
    String(symbol).toUpperCase(),
    d,
    BigInt(correctPriceCents),
    String(reason),
  );
  res.status(201).json(result);
});

// GET /restatement/history (auth)
restatementRouter.get('/history', authenticate, async (req: AuthedRequest, res: Response) => {
  res.json({ restatements: await getRestatementHistory(req.user!.accountId) });
});

// GET /restatement/valuation-as-published?valuationDate=&asOfDate= (auth)
restatementRouter.get('/valuation-as-published', authenticate, async (req: AuthedRequest, res: Response) => {
  if (!req.query.valuationDate || !req.query.asOfDate) {
    throw new HttpError(400, 'PARAMS_REQUIRED', 'valuationDate and asOfDate are required');
  }
  const valuation = await getValuationAsPublished(
    req.user!.accountId,
    new Date(String(req.query.valuationDate)),
    new Date(String(req.query.asOfDate)),
  );
  res.json({ valuation });
});

// GET /restatement/valuation-current?valuationDate= (auth)
restatementRouter.get('/valuation-current', authenticate, async (req: AuthedRequest, res: Response) => {
  if (!req.query.valuationDate) throw new HttpError(400, 'PARAMS_REQUIRED', 'valuationDate is required');
  const valuation = await getValuationAsRestated(req.user!.accountId, new Date(String(req.query.valuationDate)));
  res.json({ valuation });
});

export default restatementRouter;
