import { Router } from 'express';
import { verifyWebhookSignature } from '../middleware/webhook-signature.middleware';
import { handlePersonaWebhook } from '../webhooks/persona.webhook';
import { handleAlpacaWebhook } from '../webhooks/alpaca.webhook';
import { handlePlaidWebhook } from '../webhooks/plaid.webhook';

/**
 * Inbound provider webhooks. Each verifies a provider-specific signature
 * (skeleton passthrough for now) before handing off to its handler.
 *   POST /webhooks/persona
 *   POST /webhooks/alpaca
 *   POST /webhooks/plaid
 */
export const webhooksRouter = Router();

webhooksRouter.post('/persona', verifyWebhookSignature('persona'), handlePersonaWebhook);
webhooksRouter.post('/alpaca', verifyWebhookSignature('alpaca'), handleAlpacaWebhook);
webhooksRouter.post('/plaid', verifyWebhookSignature('plaid'), handlePlaidWebhook);

export default webhooksRouter;
