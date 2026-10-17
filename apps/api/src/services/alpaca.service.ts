import { logger } from '../lib/logger';
import type { OrderSide, OrderType } from '../types';

/**
 * Alpaca service (brokerage) — SIMULATED.
 *
 * Real implementation will submit orders to the Alpaca paper/live API and pull
 * market data. Stubbed with deterministic responses for now.
 */
export interface SubmitOrderInput {
  symbol: string;
  side: OrderSide;
  type: OrderType;
  units: string; // decimal string
}

export const alpacaService = {
  async submitOrder(input: SubmitOrderInput): Promise<{ alpacaOrderId: string; status: 'SUBMITTED' }> {
    logger.info('alpacaService.submitOrder (simulated)', { symbol: input.symbol, side: input.side });
    return { alpacaOrderId: `alp_sim_${Date.now()}`, status: 'SUBMITTED' };
  },

  async getLatestPriceCents(_symbol: string): Promise<bigint> {
    logger.info('alpacaService.getLatestPriceCents (simulated)');
    return 10_000n; // $100.00 placeholder
  },
};

export default alpacaService;
