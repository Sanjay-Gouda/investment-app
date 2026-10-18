import { Router, type Request, type Response } from 'express';
import { HttpError } from '../types';
import {
  toolManifest,
  getAccountBalance,
  getPortfolioPositions,
  getReconciliationBreaks,
  initiateRebalance,
  type ToolResult,
} from '../mcp/tools';

/**
 * HTTP surface for the MCP tools — lets the tools be exercised without an MCP
 * client. Same handlers the stdio server uses.
 */
export const mcpRouter = Router();

// GET /mcp/tools — the tool manifest.
mcpRouter.get('/tools', (_req: Request, res: Response) => {
  res.json({ server: 'corgi-investment', version: '1.0.0', tools: toolManifest });
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const HANDLERS: Record<string, (args: any) => Promise<ToolResult>> = {
  get_account_balance: getAccountBalance,
  get_portfolio_positions: getPortfolioPositions,
  get_reconciliation_breaks: getReconciliationBreaks,
  initiate_rebalance: initiateRebalance,
};

// POST /mcp/tools/:name — invoke a tool.
mcpRouter.post('/tools/:name', async (req: Request, res: Response) => {
  const handler = HANDLERS[req.params.name];
  if (!handler) throw new HttpError(404, 'UNKNOWN_TOOL', `No MCP tool named ${req.params.name}`);
  try {
    const result = await handler(req.body ?? {});
    res.json(result);
  } catch (err) {
    throw new HttpError(400, 'TOOL_ERROR', err instanceof Error ? err.message : 'Tool failed');
  }
});

export default mcpRouter;
