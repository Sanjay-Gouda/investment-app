import type { Request, Response } from 'express';
import { logger } from '../lib/logger';

/**
 * Plaid bank-linking webhook handler — skeleton.
 *
 * Will react to item / transfer events (e.g. TRANSFER_EVENTS_UPDATE) to drive
 * ACH deposit settlement once bank-linking integration lands.
 */
export function handlePlaidWebhook(req: Request, res: Response): void {
  logger.info('Plaid webhook (stub)', { webhookType: req.body?.webhook_type ?? 'unknown' });
  res.status(200).json({ received: true });
}
