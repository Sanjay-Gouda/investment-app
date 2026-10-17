import { Router } from 'express';
import { authenticate } from '../middleware/auth.middleware';

/**
 * Account routes — skeleton only.
 *   GET  /accounts/me        current user's account
 *   GET  /accounts           (adviser) list accounts
 *   POST /accounts/:id/kyc   kick off / refresh KYC
 */
export const accountsRouter = Router();

accountsRouter.use(authenticate);

accountsRouter.get('/me', (_req, res) => {
  res.status(501).json({ ok: false, error: { code: 'NOT_IMPLEMENTED', message: 'get my account not implemented' } });
});

accountsRouter.get('/', (_req, res) => {
  res.status(501).json({ ok: false, error: { code: 'NOT_IMPLEMENTED', message: 'list accounts not implemented' } });
});

accountsRouter.post('/:id/kyc', (_req, res) => {
  res.status(501).json({ ok: false, error: { code: 'NOT_IMPLEMENTED', message: 'start kyc not implemented' } });
});

export default accountsRouter;
