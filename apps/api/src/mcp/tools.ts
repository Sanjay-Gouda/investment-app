import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';
import { getBalanceAsOf } from '../services/ledger.service';

/**
 * MCP tool handlers — the single source of truth for the agent surface.
 *
 * SDK-free on purpose: the @modelcontextprotocol/sdk is ESM-only and clashes
 * with this CommonJS API, so the stdio server (mcp/server.ts) loads the SDK
 * dynamically and delegates here, and the HTTP routes (routes/mcp.routes.ts)
 * call these directly. One implementation, two transports.
 *
 * Rules: read tools are free; the one write tool NEVER executes — it only
 * creates a PENDING ApprovalQueue entry for a human adviser. All responses are
 * JSON strings; all money shown in both cents and USD; empty data returns empty
 * arrays, never errors (except genuinely-missing accounts).
 */

export type ToolResult = { content: { type: 'text'; text: string }[] };

function formatUSD(cents: bigint): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Number(cents) / 100);
}
function formatTWR(twr: unknown): string {
  if (twr == null) return '0.00%';
  const pct = Number(twr) * 100;
  return `${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%`;
}
function wrap(obj: unknown): ToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(obj, null, 2) }] };
}

// --- Zod shapes (shared by the MCP server registration) --------------------
export const toolSchemas = {
  get_account_balance: {
    account_id: z.string().describe('The account ID to get balance for'),
    as_of_date: z.string().optional().describe('ISO date for a historical balance (default: today)'),
  },
  get_portfolio_positions: {
    account_id: z.string().describe('The account ID to get positions for'),
  },
  get_reconciliation_breaks: {
    status: z.enum(['OPEN', 'RESOLVED', 'ALL']).optional().describe('Filter breaks by status (default OPEN)'),
    min_age_days: z.number().optional().describe('Minimum age in days to include (default 0)'),
  },
  initiate_rebalance: {
    account_id: z.string().describe('The account ID to rebalance'),
    reason: z.string().describe('Reason for requesting the rebalance'),
    initiated_by: z.string().optional().describe('Who/what is initiating (e.g. "MCP Agent")'),
  },
};

export const toolManifest = [
  { name: 'get_account_balance', description: 'Get current portfolio balance (total value, cash, invested, pending deposits, TWR) for an account.', access: 'read', parameters: Object.keys(toolSchemas.get_account_balance) },
  { name: 'get_portfolio_positions', description: 'Get all current positions with units, price, market value and unrealized gain/loss.', access: 'read', parameters: Object.keys(toolSchemas.get_portfolio_positions) },
  { name: 'get_reconciliation_breaks', description: 'Get reconciliation breaks between our ledger and the custodian, with aging.', access: 'read', parameters: Object.keys(toolSchemas.get_reconciliation_breaks) },
  { name: 'initiate_rebalance', description: 'Create a PENDING rebalance approval for a human adviser. Does NOT execute; the agent cannot approve its own request.', access: 'write (human approval)', parameters: Object.keys(toolSchemas.initiate_rebalance) },
];

// --- READ 1: get_account_balance -------------------------------------------
export async function getAccountBalance(args: { account_id: string; as_of_date?: string }): Promise<ToolResult> {
  logger.info('MCP get_account_balance', { account_id: args.account_id });
  const account = await prisma.account.findUnique({ where: { id: args.account_id } });
  if (!account) throw new Error('Account not found');

  const asOfDate = args.as_of_date ? new Date(args.as_of_date) : new Date();
  const cashBalance = (await getBalanceAsOf(args.account_id, asOfDate)) as bigint;
  const valuation = await prisma.valuation.findFirst({
    where: { accountId: args.account_id },
    orderBy: [{ valuationDate: 'desc' }, { bookingDate: 'desc' }],
  });
  const pending = await prisma.deposit.findMany({ where: { accountId: args.account_id, status: 'PENDING' } });
  const pendingTotal = pending.reduce((s, d) => s + d.amountCents, 0n);

  return wrap({
    accountId: args.account_id,
    asOfDate: asOfDate.toISOString(),
    totalValueCents: valuation?.totalValueCents?.toString() ?? '0',
    totalValueUSD: formatUSD(valuation?.totalValueCents ?? 0n),
    cashBalanceCents: cashBalance.toString(),
    cashBalanceUSD: formatUSD(cashBalance),
    investedValueCents: valuation?.investedValueCents?.toString() ?? '0',
    investedValueUSD: formatUSD(valuation?.investedValueCents ?? 0n),
    pendingDepositsCents: pendingTotal.toString(),
    pendingDepositsUSD: formatUSD(pendingTotal),
    twrPct: valuation?.twrPct?.toString() ?? '0',
    twrDisplay: formatTWR(valuation?.twrPct),
    lastValuationDate: valuation?.valuationDate?.toISOString() ?? null,
    portfolioType: account.selectedPortfolio ?? 'None',
  });
}

// --- READ 2: get_portfolio_positions ---------------------------------------
export async function getPortfolioPositions(args: { account_id: string }): Promise<ToolResult> {
  logger.info('MCP get_portfolio_positions', { account_id: args.account_id });
  const positions = await prisma.position.findMany({ where: { accountId: args.account_id, units: { gt: 0 } } });

  const details = await Promise.all(
    positions.map(async (p) => {
      const price = await prisma.marketPrice.findFirst({
        where: { symbol: p.symbol },
        orderBy: [{ date: 'desc' }, { isRestated: 'desc' }, { createdAt: 'desc' }],
      });
      const priceCents = price?.closePriceCents ?? 0n;
      const valueCents = BigInt(p.units.times(priceCents.toString()).toDecimalPlaces(0).toFixed(0));
      const lots = await prisma.taxLot.findMany({ where: { symbol: p.symbol, position: { accountId: args.account_id } } });
      const costBasisCents = lots.reduce((s, l) => s + l.costBasisCents, 0n);
      const gainCents = valueCents - costBasisCents;
      const gainPct = costBasisCents > 0n ? (Number(gainCents) / Number(costBasisCents)) * 100 : 0;
      return {
        symbol: p.symbol,
        units: p.units.toString(),
        currentPriceCents: priceCents.toString(),
        currentPriceUSD: formatUSD(priceCents),
        marketValueCents: valueCents.toString(),
        marketValueUSD: formatUSD(valueCents),
        costBasisCents: costBasisCents.toString(),
        costBasisUSD: formatUSD(costBasisCents),
        unrealizedGainCents: gainCents.toString(),
        unrealizedGainUSD: formatUSD(gainCents < 0n ? -gainCents : gainCents),
        unrealizedGainPct: `${gainPct.toFixed(2)}%`,
        isGain: gainCents >= 0n,
        priceDate: price?.date?.toISOString() ?? null,
        priceIsStale: price?.isStale ?? false,
      };
    }),
  );

  const totalMarketValue = details.reduce((s, d) => s + BigInt(d.marketValueCents), 0n);
  return wrap({ accountId: args.account_id, positionCount: positions.length, positions: details, totalMarketValueUSD: formatUSD(totalMarketValue) });
}

// --- READ 3: get_reconciliation_breaks -------------------------------------
export async function getReconciliationBreaks(args: { status?: 'OPEN' | 'RESOLVED' | 'ALL'; min_age_days?: number }): Promise<ToolResult> {
  const status = args.status ?? 'OPEN';
  const minAge = args.min_age_days ?? 0;
  logger.info('MCP get_reconciliation_breaks', { status, minAge });

  const where: { status?: 'OPEN' | 'RESOLVED'; agingDays?: { gte: number } } = {};
  if (status !== 'ALL') where.status = status;
  if (minAge > 0) where.agingDays = { gte: minAge };

  const breaks = await prisma.reconciliationBreak.findMany({ where, orderBy: { agingDays: 'desc' } });
  const summary = {
    totalOpen: breaks.filter((b) => b.status === 'OPEN').length,
    totalResolved: breaks.filter((b) => b.status === 'RESOLVED').length,
    byType: {
      AMOUNT_MISMATCH: breaks.filter((b) => b.breakType === 'AMOUNT_MISMATCH').length,
      MISSING_IN_LEDGER: breaks.filter((b) => b.breakType === 'MISSING_IN_LEDGER').length,
      MISSING_IN_CUSTODIAN: breaks.filter((b) => b.breakType === 'MISSING_IN_CUSTODIAN').length,
      PRICE_MISMATCH: breaks.filter((b) => b.breakType === 'PRICE_MISMATCH').length,
    },
    oldestBreakDays: breaks.reduce((m, b) => Math.max(m, b.agingDays), 0),
  };

  return wrap({
    summary,
    breaks: breaks.map((b) => ({
      id: b.id,
      breakDate: b.breakDate.toISOString(),
      symbol: b.symbol,
      breakType: b.breakType,
      status: b.status,
      agingDays: b.agingDays,
      ledgerValue: b.ledgerValue?.toString() ?? null,
      custodianValue: b.custodianValue?.toString() ?? null,
      difference: b.difference?.toString() ?? null,
      resolvedAt: b.resolvedAt?.toISOString() ?? null,
    })),
  });
}

// --- WRITE: initiate_rebalance (approval only — NEVER executes) -------------
export async function initiateRebalance(args: { account_id: string; reason: string; initiated_by?: string }): Promise<ToolResult> {
  const initiatedBy = args.initiated_by ?? 'MCP Agent';
  logger.info('MCP initiate_rebalance (approval only)', { account_id: args.account_id, initiatedBy });

  const account = await prisma.account.findUnique({ where: { id: args.account_id }, include: { user: true } });
  if (!account) throw new Error('Account not found');
  if (account.status !== 'ACTIVE') throw new Error('Account is not active');
  if (!account.selectedPortfolio) throw new Error('No portfolio selected for account');

  const existing = await prisma.approvalQueue.findFirst({
    where: { type: 'REBALANCE', status: 'PENDING', payload: { path: ['accountId'], equals: args.account_id } },
  });
  if (existing) throw new Error(`A rebalance request is already pending approval. Approval ID: ${existing.id}`);

  const positions = await prisma.position.findMany({ where: { accountId: args.account_id } });

  const approval = await prisma.approvalQueue.create({
    data: {
      initiatorId: account.userId,
      type: 'REBALANCE',
      status: 'PENDING',
      payload: {
        accountId: args.account_id,
        portfolioType: account.selectedPortfolio,
        reason: args.reason,
        initiatedBy,
        initiatedAt: new Date().toISOString(),
        initiatedVia: 'MCP_AGENT',
        currentPositions: positions.map((p) => ({ symbol: p.symbol, units: p.units.toString() })),
        note: 'Initiated by an AI agent. A human adviser must review and approve.',
      },
    },
  });

  return wrap({
    success: true,
    message: 'Rebalance request created and pending human approval',
    approvalId: approval.id,
    status: 'PENDING_HUMAN_APPROVAL',
    accountId: args.account_id,
    portfolioType: account.selectedPortfolio,
    reason: args.reason,
    initiatedBy,
    initiatedVia: 'MCP_AGENT',
    createdAt: approval.createdAt.toISOString(),
    nextStep: 'A human adviser must approve this request at /adviser/approvals',
    warning: 'The AI agent that created this request CANNOT approve it (maker-checker).',
  });
}

export const mcpTools = { getAccountBalance, getPortfolioPositions, getReconciliationBreaks, initiateRebalance };
