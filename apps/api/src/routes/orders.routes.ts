import { Router } from 'express';
import { authenticate } from '../middleware/auth.middleware';

/**
 * Order routes — skeleton only.
 *   POST /orders        place an order (may route to approval queue)
 *   GET  /orders        list orders for the account
 *   GET  /orders/:id    order detail
 */
export const ordersRouter = Router();

ordersRouter.use(authenticate);

ordersRouter.post('/', (_req, res) => {
  res.status(501).json({ ok: false, error: { code: 'NOT_IMPLEMENTED', message: 'place order not implemented' } });
});

ordersRouter.get('/', (_req, res) => {
  res.status(501).json({ ok: false, error: { code: 'NOT_IMPLEMENTED', message: 'list orders not implemented' } });
});

ordersRouter.get('/:id', (_req, res) => {
  res.status(501).json({ ok: false, error: { code: 'NOT_IMPLEMENTED', message: 'get order not implemented' } });
});

export default ordersRouter;
