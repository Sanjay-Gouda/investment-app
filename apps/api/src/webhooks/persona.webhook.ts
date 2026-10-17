import type { Request, Response } from 'express';
import { logger } from '../lib/logger';

/**
 * Persona KYC webhook handler — skeleton.
 *
 * Will update Account.kycStatus based on inquiry events
 * (inquiry.approved / inquiry.declined) once KYC integration lands.
 */
export function handlePersonaWebhook(req: Request, res: Response): void {
  logger.info('Persona webhook (stub)', { type: req.body?.data?.type ?? 'unknown' });
  // Always 200 so the provider does not retry a skeleton endpoint.
  res.status(200).json({ received: true });
}
