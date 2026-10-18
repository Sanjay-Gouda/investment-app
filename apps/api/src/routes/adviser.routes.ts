import { Router, type Response } from 'express';
import { ApprovalStatus } from '@prisma/client';
import { authenticate, requireRole } from '../middleware/auth.middleware';
import { HttpError, type AuthedRequest } from '../types';
import { prisma } from '../lib/prisma';
import { getLatestValuation, calculateAccountValuation } from '../services/valuation.service';
import { getBreakSummary } from '../services/reconciliation.service';

/** Adviser console backend — ADVISER ONLY. */
export const adviserRouter = Router();
adviserRouter.use(authenticate, requireRole('ADVISER'));

async function accountValueCents(accountId: string): Promise<bigint> {
  const latest = await getLatestValuation(accountId);
  if (latest) return latest.totalValueCents;
  const calc = await calculateAccountValuation(accountId, new Date());
  return calc.totalValueCents;
}

// GET /adviser/accounts — all accounts with value + portfolio + status.
adviserRouter.get('/accounts', async (_req: AuthedRequest, res: Response) => {
  const accounts = await prisma.account.findMany({ include: { user: { select: { email: true, fullName: true } } } });
  const rows = [];
  for (const a of accounts) {
    rows.push({
      accountId: a.id,
      email: a.user.email,
      fullName: a.user.fullName,
      portfolio: a.selectedPortfolio,
      kycStatus: a.kycStatus,
      status: a.status,
      valueCents: (await accountValueCents(a.id)).toString(),
    });
  }
  res.json({ accounts: rows });
});

// GET /adviser/overview — AUM, active accounts, open breaks.
adviserRouter.get('/overview', async (_req: AuthedRequest, res: Response) => {
  const accounts = await prisma.account.findMany({ where: { status: 'ACTIVE' } });
  let aum = 0n;
  for (const a of accounts) aum += await accountValueCents(a.id);
  const breaks = await getBreakSummary();
  res.json({
    aumCents: aum.toString(),
    activeAccounts: accounts.length,
    openBreaks: breaks.totalOpen,
    oldestBreakDays: breaks.oldestBreakDays,
  });
});

// GET /adviser/approvals — pending approvals.
adviserRouter.get('/approvals', async (_req: AuthedRequest, res: Response) => {
  const approvals = await prisma.approvalQueue.findMany({
    where: { status: ApprovalStatus.PENDING },
    orderBy: { createdAt: 'desc' },
  });
  res.json({ approvals });
});

// POST /adviser/approvals/:id/approve — cannot approve your own request.
adviserRouter.post('/approvals/:id/approve', async (req: AuthedRequest, res: Response) => {
  const a = await prisma.approvalQueue.findUnique({ where: { id: req.params.id } });
  if (!a) throw new HttpError(404, 'NOT_FOUND', 'Approval not found');
  if (a.initiatorId === req.user!.userId) {
    throw new HttpError(403, 'SELF_APPROVAL', 'You cannot approve your own request');
  }
  const updated = await prisma.approvalQueue.update({
    where: { id: req.params.id },
    data: { status: ApprovalStatus.APPROVED, approverId: req.user!.userId, approvedAt: new Date() },
  });
  res.json({ approval: updated });
});

// POST /adviser/approvals/:id/reject
adviserRouter.post('/approvals/:id/reject', async (req: AuthedRequest, res: Response) => {
  const updated = await prisma.approvalQueue.update({
    where: { id: req.params.id },
    data: { status: ApprovalStatus.REJECTED, approverId: req.user!.userId, rejectedAt: new Date() },
  });
  res.json({ approval: updated });
});

export default adviserRouter;
