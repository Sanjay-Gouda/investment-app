import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { authenticate, requireKYC } from '../middleware/auth.middleware';
import { validate } from '../middleware/validate.middleware';
import { HttpError, type AuthedRequest } from '../types';
import { logger } from '../lib/logger';
import {
  createLinkToken,
  exchangePublicToken,
  getBankDetails,
  initiateDeposit,
  listDeposits,
  getBalances,
} from '../services/plaid.service';

export const plaidRouter = Router();

// POST /plaid/link-token (auth + KYC)
plaidRouter.post('/link-token', authenticate, requireKYC, async (req: AuthedRequest, res: Response) => {
  const { linkToken } = await createLinkToken(req.user!.userId);
  res.json({ linkToken });
});

// POST /plaid/exchange-token (auth + KYC)
const exchangeSchema = z.object({ publicToken: z.string().min(1) });
plaidRouter.post(
  '/exchange-token',
  authenticate,
  requireKYC,
  validate(exchangeSchema),
  async (req: AuthedRequest, res: Response) => {
    const result = await exchangePublicToken({
      userId: req.user!.userId,
      publicToken: req.body.publicToken,
      accountId: req.user!.accountId,
    });
    res.json(result);
  },
);

// GET /plaid/bank-details (auth)
plaidRouter.get('/bank-details', authenticate, async (req: AuthedRequest, res: Response) => {
  res.json(await getBankDetails(req.user!.accountId));
});

// POST /plaid/deposit (auth + KYC)
const depositSchema = z.object({
  amountCents: z.number().int().positive(),
});
plaidRouter.post(
  '/deposit',
  authenticate,
  requireKYC,
  validate(depositSchema),
  async (req: AuthedRequest, res: Response) => {
    try {
      const result = await initiateDeposit({
        accountId: req.user!.accountId,
        amountCents: BigInt(req.body.amountCents),
        userId: req.user!.userId,
      });
      res.status(201).json({
        depositId: result.depositId,
        amountCents: result.amountCents.toString(),
        settlementDate: result.settlementDate.toISOString(),
        status: result.status,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Deposit failed';
      throw new HttpError(400, 'DEPOSIT_ERROR', msg);
    }
  },
);

// GET /plaid/deposits (auth)
plaidRouter.get('/deposits', authenticate, async (req: AuthedRequest, res: Response) => {
  const deposits = await listDeposits(req.user!.accountId);
  res.json({ deposits });
});

// GET /plaid/balance (auth) — cash / pending / available for the dashboard.
plaidRouter.get('/balance', authenticate, async (req: AuthedRequest, res: Response) => {
  const b = await getBalances(req.user!.accountId);
  res.json({
    cashBalanceCents: b.cashBalanceCents.toString(),
    pendingDepositsCents: b.pendingDepositsCents.toString(),
    availableBalanceCents: b.availableBalanceCents.toString(),
  });
});

// POST /plaid/webhook (no auth; raw body parsed in index.ts)
plaidRouter.post('/webhook', (req: Request, res: Response) => {
  let event: { webhook_type?: string; webhook_code?: string } = {};
  try {
    event = JSON.parse(Buffer.isBuffer(req.body) ? req.body.toString('utf8') : JSON.stringify(req.body));
  } catch {
    // ignore malformed body
  }
  const { webhook_type: type, webhook_code: code } = event;
  logger.info('Plaid webhook', { type, code });

  if (type === 'ITEM' && code === 'ERROR') {
    logger.warn('Plaid item error — access token may need re-linking', { code });
  }
  // TRANSACTIONS/DEFAULT_UPDATE and AUTH/AUTOMATICALLY_VERIFIED: ack only for now.
  res.json({ received: true });
});

export default plaidRouter;
