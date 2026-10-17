import { Router } from 'express';
import { authenticate, requireKYC } from '../middleware/auth.middleware';

/**
 * Deposit routes — skeleton only. Gated behind KYC: an account cannot deposit
 * until its identity check is APPROVED.
 *   POST /deposits/link-token   create a Plaid link token
 *   POST /deposits              initiate an ACH deposit
 *   GET  /deposits              list deposits for the account
 */
export const depositsRouter = Router();

depositsRouter.use(authenticate, requireKYC);

depositsRouter.post('/link-token', (_req, res) => {
  res.status(501).json({ ok: false, error: { code: 'NOT_IMPLEMENTED', message: 'create link token not implemented' } });
});

depositsRouter.post('/', (_req, res) => {
  res.status(501).json({ ok: false, error: { code: 'NOT_IMPLEMENTED', message: 'create deposit not implemented' } });
});

depositsRouter.get('/', (_req, res) => {
  res.status(501).json({ ok: false, error: { code: 'NOT_IMPLEMENTED', message: 'list deposits not implemented' } });
});

export default depositsRouter;
