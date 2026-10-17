import type { Request, Response, NextFunction } from 'express';
import { logger } from '../lib/logger';

/**
 * Skeleton webhook signature verification.
 *
 * Each provider (Persona, Alpaca, Plaid) signs its payloads differently. When
 * integrations land, this factory will compute the provider-specific HMAC over
 * the RAW request body and constant-time compare it to the signature header.
 *
 * For now it logs and passes through so webhook routes can be exercised. It
 * MUST become enforcing before any real credentials are used.
 */
export function verifyWebhookSignature(provider: 'persona' | 'alpaca' | 'plaid') {
  return (req: Request, _res: Response, next: NextFunction): void => {
    // TODO(webhooks): verify signature against the provider secret using the
    // raw body buffer. Reject with 401 on mismatch.
    logger.debug('Webhook received (signature check skipped — skeleton)', {
      provider,
      path: req.path,
    });
    next();
  };
}
