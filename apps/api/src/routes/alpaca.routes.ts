import { Router, type Response } from 'express';
import { authenticate } from '../middleware/auth.middleware';
import { type AuthedRequest } from '../types';
import { handleAlpacaWebhook } from '../webhooks/alpaca.webhook';
import { getLatestPrice } from '../services/alpaca.service';

export const alpacaRouter = Router();

// POST /alpaca/webhook (no auth; raw body parsed in index.ts)
alpacaRouter.post('/webhook', handleAlpacaWebhook);

// GET /alpaca/price/:symbol (auth)
alpacaRouter.get('/price/:symbol', authenticate, async (req: AuthedRequest, res: Response) => {
  const priceCents = await getLatestPrice(req.params.symbol.toUpperCase());
  res.json({ symbol: req.params.symbol.toUpperCase(), priceCents: priceCents.toString() });
});

export default alpacaRouter;
