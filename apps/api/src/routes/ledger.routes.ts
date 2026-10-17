import { Router, type Response } from 'express';
import { authenticate, requireRole } from '../middleware/auth.middleware';
import { HttpError, type AuthedRequest } from '../types';
import {
  getBalanceAsOf,
  getCashBalance,
  getPositionBalance,
  getStatementForPeriod,
  getLedgerHistory,
  countLedgerEntries,
  createCorrection,
} from '../services/ledger.service';

/**
 * Ledger routes. All require auth (currently a no-op passthrough until auth
 * lands). Until then the account is resolved from `req.user` when present, else
 * from an `accountId` query param / `x-account-id` header as a dev shim.
 */
export const ledgerRouter = Router();

ledgerRouter.use(authenticate);

/** Resolve the target account id from the authenticated user. */
function resolveAccountId(req: AuthedRequest): string {
  const accountId = req.user?.accountId;
  if (!accountId) {
    throw new HttpError(401, 'UNAUTHORIZED', 'Authentication required');
  }
  return accountId;
}

/** Parse an ISO date query param, throwing a 400 on an invalid value. */
function parseDate(value: unknown, field: string): Date {
  const d = new Date(String(value));
  if (Number.isNaN(d.getTime())) {
    throw new HttpError(400, 'INVALID_DATE', `Invalid ${field}`);
  }
  return d;
}

// GET /ledger/balance?asOfDate=&symbol=
ledgerRouter.get('/balance', async (req: AuthedRequest, res: Response) => {
  const accountId = resolveAccountId(req);
  const asOfDate = req.query.asOfDate ? parseDate(req.query.asOfDate, 'asOfDate') : new Date();
  const symbol = req.query.symbol as string | undefined;

  if (symbol) {
    const units = await getBalanceAsOf(accountId, asOfDate, symbol);
    res.json({ symbol, units: units.toString(), asOfDate: asOfDate.toISOString() });
    return;
  }

  const cash = (await getBalanceAsOf(accountId, asOfDate)) as bigint;
  res.json({ cashBalanceCents: cash.toString(), asOfDate: asOfDate.toISOString() });
});

// GET /ledger/position/:symbol
ledgerRouter.get('/position/:symbol', async (req: AuthedRequest, res: Response) => {
  const accountId = resolveAccountId(req);
  const { symbol } = req.params;
  const asOfDate = new Date();
  const units = await getPositionBalance(accountId, symbol);
  res.json({ symbol, units: units.toString(), asOfDate: asOfDate.toISOString() });
});

// GET /ledger/history?limit=&offset=
ledgerRouter.get('/history', async (req: AuthedRequest, res: Response) => {
  const accountId = resolveAccountId(req);
  const limit = req.query.limit ? Number(req.query.limit) : 50;
  const offset = req.query.offset ? Number(req.query.offset) : 0;
  const [entries, total] = await Promise.all([
    getLedgerHistory(accountId, limit, offset),
    countLedgerEntries(accountId),
  ]);
  res.json({ entries, total, limit, offset });
});

// GET /ledger/statement?startDate=&endDate=
ledgerRouter.get('/statement', async (req: AuthedRequest, res: Response) => {
  const accountId = resolveAccountId(req);
  if (!req.query.startDate || !req.query.endDate) {
    throw new HttpError(400, 'DATE_RANGE_REQUIRED', 'startDate and endDate are required');
  }
  const startDate = parseDate(req.query.startDate, 'startDate');
  const endDate = parseDate(req.query.endDate, 'endDate');

  const [entries, openingBalance, closingBalance] = await Promise.all([
    getStatementForPeriod(accountId, startDate, endDate),
    getBalanceAsOf(accountId, new Date(startDate.getTime() - 1)), // strictly before start
    getBalanceAsOf(accountId, endDate),
  ]);

  res.json({
    entries,
    startDate: startDate.toISOString(),
    endDate: endDate.toISOString(),
    openingBalanceCents: openingBalance.toString(),
    closingBalanceCents: closingBalance.toString(),
  });
});

// POST /ledger/correction (adviser only)
ledgerRouter.post(
  '/correction',
  requireRole('ADVISER'),
  async (req: AuthedRequest, res: Response) => {
    const accountId = resolveAccountId(req);
    const { originalEntryIds, reason, correctedEntries, effectiveDate } = req.body ?? {};

    if (!Array.isArray(originalEntryIds) || originalEntryIds.length === 0) {
      throw new HttpError(400, 'INVALID_CORRECTION', 'originalEntryIds is required');
    }
    if (!Array.isArray(correctedEntries) || correctedEntries.length === 0) {
      throw new HttpError(400, 'INVALID_CORRECTION', 'correctedEntries is required');
    }
    if (!reason) {
      throw new HttpError(400, 'INVALID_CORRECTION', 'reason is required');
    }

    const result = await createCorrection({
      accountId,
      originalEntryIds,
      reason,
      // amounts arrive as strings/numbers over JSON — coerce cents to BigInt.
      correctedEntries: correctedEntries.map((e: Record<string, unknown>) => ({
        ...e,
        amount: BigInt(e.amount as string | number),
        effectiveDate: e.effectiveDate ? new Date(e.effectiveDate as string) : new Date(effectiveDate),
      })) as never,
      effectiveDate: new Date(effectiveDate),
    });

    res.status(201).json(result);
  },
);

export default ledgerRouter;
