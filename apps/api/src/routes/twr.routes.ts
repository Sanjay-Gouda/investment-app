import { Router, type Response } from 'express';
import { authenticate } from '../middleware/auth.middleware';
import { HttpError, type AuthedRequest } from '../types';
import {
  calculateTWR,
  calculateTWRSinceInception,
  calculateTWRForPeriods,
} from '../services/twr.service';

export const twrRouter = Router();

// GET /twr/current — TWR for all standard periods.
twrRouter.get('/current', authenticate, async (req: AuthedRequest, res: Response) => {
  res.json(await calculateTWRForPeriods(req.user!.accountId));
});

// GET /twr/since-inception — first ledger entry → today.
twrRouter.get('/since-inception', authenticate, async (req: AuthedRequest, res: Response) => {
  res.json(await calculateTWRSinceInception(req.user!.accountId));
});

// GET /twr/range?startDate=&endDate= — custom range.
twrRouter.get('/range', authenticate, async (req: AuthedRequest, res: Response) => {
  if (!req.query.startDate || !req.query.endDate) {
    throw new HttpError(400, 'DATE_RANGE_REQUIRED', 'startDate and endDate are required');
  }
  const start = new Date(String(req.query.startDate));
  const end = new Date(String(req.query.endDate));
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    throw new HttpError(400, 'INVALID_DATE', 'Invalid startDate/endDate');
  }
  res.json(await calculateTWR(req.user!.accountId, start, end));
});

// GET /twr/sub-periods?startDate=&endDate= — the transparent breakdown.
twrRouter.get('/sub-periods', authenticate, async (req: AuthedRequest, res: Response) => {
  const result = req.query.startDate && req.query.endDate
    ? await calculateTWR(
        req.user!.accountId,
        new Date(String(req.query.startDate)),
        new Date(String(req.query.endDate)),
      )
    : await calculateTWRSinceInception(req.user!.accountId);
  res.json({
    twrPct: result.twrPct,
    twrDisplay: result.twrDisplay,
    subPeriods: result.subPeriods,
    totalCashFlowsCents: result.totalCashFlowsCents,
  });
});

export default twrRouter;
