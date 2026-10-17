import { Router, type Request, type Response } from 'express';
import { authenticate } from '../middleware/auth.middleware';
import { HttpError, type AuthedRequest } from '../types';
import {
  createVerificationSession,
  getKYCStatus,
  handleWebhook,
  simulateKYCApproval,
} from '../services/kyc.service';

export const kycRouter = Router();

// POST /kyc/start — begin a Stripe Identity session for the current account.
kycRouter.post('/start', authenticate, async (req: AuthedRequest, res: Response) => {
  const { clientSecret, sessionId } = await createVerificationSession({
    accountId: req.user!.accountId,
    userId: req.user!.userId,
  });
  res.json({ clientSecret, sessionId });
});

// GET /kyc/status — current KYC status for the authenticated account.
kycRouter.get('/status', authenticate, async (req: AuthedRequest, res: Response) => {
  res.json(await getKYCStatus(req.user!.accountId));
});

// POST /kyc/webhook — Stripe calls this directly. No auth; raw body is parsed
// by express.raw in index.ts so the signature can be verified byte-for-byte.
kycRouter.post('/webhook', async (req: Request, res: Response) => {
  const signature = req.header('stripe-signature');
  if (!signature) {
    throw new HttpError(400, 'MISSING_SIGNATURE', 'Missing Stripe-Signature header');
  }
  try {
    // req.body is a Buffer here (express.raw).
    const result = await handleWebhook(req.body as Buffer, signature);
    res.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Webhook error';
    throw new HttpError(400, 'WEBHOOK_ERROR', message);
  }
});

// POST /kyc/simulate-approve — SANDBOX ONLY.
kycRouter.post('/simulate-approve', authenticate, async (req: AuthedRequest, res: Response) => {
  try {
    const account = await simulateKYCApproval(req.user!.accountId);
    res.json({ ok: true, account });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Simulation failed';
    throw new HttpError(403, 'FORBIDDEN', message);
  }
});

export default kycRouter;
