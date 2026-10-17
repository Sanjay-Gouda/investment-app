import { logger } from '../lib/logger';

/**
 * Valuation service — computes daily account value and Time-Weighted Return.
 *
 * TWR chains daily sub-period returns, neutralizing the effect of external cash
 * flows (deposits/withdrawals) so performance reflects the portfolio, not the
 * timing of the client's cash (see DECISIONS.md). Skeleton only.
 */
export interface DailyValuationResult {
  valuationDate: Date;
  totalValueCents: bigint;
  cashCents: bigint;
  investedValueCents: bigint;
  returnPct: string; // decimal string
  twrPct: string; // decimal string
}

export const valuationService = {
  /** Value a single account as of a date and compute its TWR contribution. */
  async valueAccount(_accountId: string, _asOf: Date): Promise<DailyValuationResult> {
    logger.debug('valuationService.valueAccount (stub)');
    throw new Error('NOT_IMPLEMENTED: valuationService.valueAccount');
  },
};

export default valuationService;
