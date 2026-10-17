import { Router } from 'express';
import { authenticate } from '../middleware/auth.middleware';
import { requireRole } from '../middleware/auth.middleware';

/**
 * Reconciliation routes — skeleton only. Adviser-facing.
 *   GET  /reconciliation/breaks        list reconciliation breaks
 *   POST /reconciliation/run           trigger a reconciliation pass
 *   POST /reconciliation/breaks/:id/resolve
 */
export const reconciliationRouter = Router();

reconciliationRouter.use(authenticate, requireRole('ADVISER'));

reconciliationRouter.get('/breaks', (_req, res) => {
  res.status(501).json({ ok: false, error: { code: 'NOT_IMPLEMENTED', message: 'list breaks not implemented' } });
});

reconciliationRouter.post('/run', (_req, res) => {
  res.status(501).json({ ok: false, error: { code: 'NOT_IMPLEMENTED', message: 'run reconciliation not implemented' } });
});

reconciliationRouter.post('/breaks/:id/resolve', (_req, res) => {
  res.status(501).json({ ok: false, error: { code: 'NOT_IMPLEMENTED', message: 'resolve break not implemented' } });
});

export default reconciliationRouter;
