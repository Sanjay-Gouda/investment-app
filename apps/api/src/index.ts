import path from 'path';
import dotenv from 'dotenv';

// Load env from the monorepo root .env (shared by api + web), then local.
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });
dotenv.config();

// Must be imported before routes so async errors reach the error handler.
import 'express-async-errors';

import express, { type NextFunction, type Request, type Response } from 'express';
import cors from 'cors';
import helmet from 'helmet';

import { logger } from './lib/logger';
import { HttpError } from './types';
import { preventLedgerMutation } from './middleware/ledger.middleware';

import { authRouter } from './routes/auth.routes';
import { accountsRouter } from './routes/accounts.routes';
import { portfolioRouter } from './routes/portfolio.routes';
import { ordersRouter } from './routes/orders.routes';
import { depositsRouter } from './routes/deposits.routes';
import { reconciliationRouter } from './routes/reconciliation.routes';
import { ledgerRouter } from './routes/ledger.routes';
import { kycRouter } from './routes/kyc.routes';
import { plaidRouter } from './routes/plaid.routes';
import { alpacaRouter } from './routes/alpaca.routes';
import { valuationRouter } from './routes/valuation.routes';
import { twrRouter } from './routes/twr.routes';
import { webhooksRouter } from './routes/webhooks.routes';
import { testRouter } from './routes/test.routes';
import { startAchSettlementWorker } from './jobs/ach-settlement.job';
import { startOrderPolling } from './jobs/order-polling.job';
import { startDailyValuationWorker } from './jobs/daily-valuation.job';

// Make BigInt serializable so ledger/money fields survive res.json().
// (Values are cents; the shared contract types them as strings over the wire.)
(BigInt.prototype as unknown as { toJSON: () => string }).toJSON = function () {
  return this.toString();
};

const app = express();

app.use(helmet());
app.use(cors());

// Provider webhooks need the RAW body (Stripe for signature verification; Plaid
// parsed from raw), so their parsers MUST be registered before the JSON parser.
app.use('/kyc/webhook', express.raw({ type: 'application/json' }));
app.use('/plaid/webhook', express.raw({ type: 'application/json' }));
app.use('/alpaca/webhook', express.raw({ type: 'application/json' }));
app.use(express.json());

// Health check
app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// API routes
app.use('/auth', authRouter);
app.use('/kyc', kycRouter);
app.use('/plaid', plaidRouter);
app.use('/accounts', accountsRouter);
app.use('/portfolio', portfolioRouter);
app.use('/orders', ordersRouter);
app.use('/deposits', depositsRouter);
app.use('/reconciliation', reconciliationRouter);
// Ledger is append-only: block PUT/PATCH/DELETE before the router.
app.use('/ledger', preventLedgerMutation, ledgerRouter);
app.use('/alpaca', alpacaRouter);
app.use('/valuation', valuationRouter);
app.use('/twr', twrRouter);
app.use('/webhooks', webhooksRouter);

// Dev-only helper routes (disabled in production inside the router).
app.use('/test', testRouter);

// 404
app.use((req: Request, res: Response) => {
  res.status(404).json({
    ok: false,
    error: { code: 'NOT_FOUND', message: `Route not found: ${req.method} ${req.path}` },
  });
});

// Global error handler
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof HttpError) {
    res.status(err.statusCode).json({
      ok: false,
      error: { code: err.code, message: err.message, details: err.details },
    });
    return;
  }
  const message = err instanceof Error ? err.message : 'Unknown error';
  logger.error('Unhandled error', { error: message });
  res.status(500).json({
    ok: false,
    error: { code: 'INTERNAL_ERROR', message: 'Internal server error' },
  });
});

const PORT = Number(process.env.PORT) || 4000;

const server = app.listen(PORT, () => {
  logger.info(`API listening on http://localhost:${PORT}`);
});

// Background workers. Resilient: log if Redis / Alpaca are unavailable.
startAchSettlementWorker();
startOrderPolling();
startDailyValuationWorker();

// Graceful shutdown
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    logger.info(`${signal} received, shutting down`);
    server.close(() => process.exit(0));
  });
}

export { app };
