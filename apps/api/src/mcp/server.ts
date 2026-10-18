/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  toolSchemas,
  getAccountBalance,
  getPortfolioPositions,
  getReconciliationBreaks,
  initiateRebalance,
} from './tools';

/**
 * Corgi MCP stdio server.
 *
 * The @modelcontextprotocol/sdk is ESM-only, so we load it with a native dynamic
 * import that TypeScript won't rewrite to require() (the CJS build would then
 * ERR_REQUIRE_ESM). The tool logic lives in ./tools (SDK-free) and is shared
 * with the HTTP surface.
 *
 * Run: `node dist/mcp/server.js` (after `npm run build`).
 */
const esmImport = (specifier: string): Promise<any> =>
  (Function('s', 'return import(s)') as (s: string) => Promise<any>)(specifier);

async function startMCPServer(): Promise<void> {
  const { McpServer } = await esmImport('@modelcontextprotocol/sdk/server/mcp.js');
  const { StdioServerTransport } = await esmImport('@modelcontextprotocol/sdk/server/stdio.js');

  const server = new McpServer({ name: 'corgi-investment', version: '1.0.0' });

  server.tool(
    'get_account_balance',
    'Get current portfolio balance (total value, cash, invested, pending deposits, TWR) for an account.',
    toolSchemas.get_account_balance,
    async (args: any) => getAccountBalance(args),
  );
  server.tool(
    'get_portfolio_positions',
    'Get all current positions with units, price, market value and unrealized gain/loss.',
    toolSchemas.get_portfolio_positions,
    async (args: any) => getPortfolioPositions(args),
  );
  server.tool(
    'get_reconciliation_breaks',
    'Get reconciliation breaks between our ledger and the custodian file, with aging.',
    toolSchemas.get_reconciliation_breaks,
    async (args: any) => getReconciliationBreaks(args),
  );
  server.tool(
    'initiate_rebalance',
    'Initiate a portfolio rebalance request. Does NOT execute — it creates a pending approval a human adviser must review. The agent cannot approve its own request.',
    toolSchemas.initiate_rebalance,
    async (args: any) => initiateRebalance(args),
  );

  await server.connect(new StdioServerTransport());
  // stderr so it never corrupts the stdio protocol on stdout.
  process.stderr.write('Corgi MCP Server running (stdio)\n');
}

// Only start when executed directly (`node dist/mcp/server.js`), not on import.
if (require.main === module) {
  startMCPServer().catch((err) => {
    process.stderr.write(`MCP server failed: ${err}\n`);
    process.exit(1);
  });
}

export { startMCPServer };
