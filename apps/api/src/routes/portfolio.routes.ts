import { Router } from 'express';
import { authenticate } from '../middleware/auth.middleware';

/**
 * Portfolio routes — skeleton only.
 *   GET /portfolio              positions + cash summary
 *   GET /portfolio/valuations   historical valuations (TWR series)
 *   GET /portfolio/ledger       ledger entries
 */
export const portfolioRouter = Router();

portfolioRouter.use(authenticate);

portfolioRouter.get('/', (_req, res) => {
  res.status(501).json({ ok: false, error: { code: 'NOT_IMPLEMENTED', message: 'get portfolio not implemented' } });
});

portfolioRouter.get('/valuations', (_req, res) => {
  res.status(501).json({ ok: false, error: { code: 'NOT_IMPLEMENTED', message: 'get valuations not implemented' } });
});

portfolioRouter.get('/ledger', (_req, res) => {
  res.status(501).json({ ok: false, error: { code: 'NOT_IMPLEMENTED', message: 'get ledger not implemented' } });
});

export default portfolioRouter;
