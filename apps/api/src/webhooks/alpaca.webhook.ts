import type { Request, Response } from 'express';
import { logger } from '../lib/logger';

/**
 * Alpaca brokerage webhook handler — skeleton.
 *
 * Will reconcile Order status / fills (order.filled, order.partial_fill, etc.)
 * and post the corresponding ledger entries once brokerage integration lands.
 */
export function handleAlpacaWebhook(req: Request, res: Response): void {
  logger.info('Alpaca webhook (stub)', { event: req.body?.event ?? 'unknown' });
  res.status(200).json({ received: true });
}
