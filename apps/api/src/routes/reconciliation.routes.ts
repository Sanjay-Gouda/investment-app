import { Router, type Response } from 'express';
import { BreakStatus, BreakType } from '@prisma/client';
import { authenticate, requireRole } from '../middleware/auth.middleware';
import { HttpError, type AuthedRequest } from '../types';
import { prisma } from '../lib/prisma';
import {
  listBreaks,
  resolveBreak,
  getBreakSummary,
  runDailyReconciliation,
} from '../services/reconciliation.service';

/**
 * Reconciliation routes — ADVISER ONLY (investors never see breaks).
 */
export const reconciliationRouter = Router();
reconciliationRouter.use(authenticate, requireRole('ADVISER'));

// GET /reconciliation/breaks?status=&breakType=&minAgeDays=
reconciliationRouter.get('/breaks', async (req: AuthedRequest, res: Response) => {
  const status = req.query.status as BreakStatus | 'all' | undefined;
  const breakType = req.query.breakType as BreakType | undefined;
  const minAgeDays = req.query.minAgeDays ? Number(req.query.minAgeDays) : undefined;
  const breaks = await listBreaks({ status: status ?? BreakStatus.OPEN, breakType, minAgeDays });
  res.json({ breaks });
});

// GET /reconciliation/summary
reconciliationRouter.get('/summary', async (_req: AuthedRequest, res: Response) => {
  res.json(await getBreakSummary());
});

// GET /reconciliation/history — breaks grouped by day.
reconciliationRouter.get('/history', async (_req: AuthedRequest, res: Response) => {
  const grouped = await prisma.reconciliationBreak.groupBy({
    by: ['breakDate', 'status'],
    _count: { _all: true },
    orderBy: { breakDate: 'desc' },
  });
  const files = await prisma.custodianFile.findMany({ orderBy: { fileDate: 'desc' }, take: 30, select: { fileDate: true, source: true, createdAt: true } });
  res.json({ breakCounts: grouped, custodianFiles: files });
});

// GET /reconciliation/breaks/:id
reconciliationRouter.get('/breaks/:id', async (req: AuthedRequest, res: Response) => {
  const b = await prisma.reconciliationBreak.findUnique({ where: { id: req.params.id } });
  if (!b) throw new HttpError(404, 'NOT_FOUND', 'Break not found');
  res.json({ break: b });
});

// POST /reconciliation/breaks/:id/resolve
reconciliationRouter.post('/breaks/:id/resolve', async (req: AuthedRequest, res: Response) => {
  const resolution = (req.body?.resolution as string) ?? 'Resolved';
  const b = await resolveBreak(req.params.id, resolution);
  res.json({ break: b });
});

// POST /reconciliation/run — manual trigger.
reconciliationRouter.post('/run', async (_req: AuthedRequest, res: Response) => {
  res.json(await runDailyReconciliation());
});

export default reconciliationRouter;
