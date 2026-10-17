import { logger } from '../lib/logger';

/**
 * Reconciliation service — compares the internal ledger to the custodian
 * (Alpaca) positions and cash, and records any breaks.
 *
 * Break types: MISSING_IN_LEDGER, MISSING_IN_CUSTODIAN, AMOUNT_MISMATCH,
 * PRICE_MISMATCH. Open breaks age daily until resolved. Skeleton only.
 */
export interface ReconciliationRunResult {
  runDate: Date;
  breaksOpened: number;
  breaksResolved: number;
}

export const reconciliationService = {
  /** Run a reconciliation pass as of a date. */
  async run(_asOf: Date): Promise<ReconciliationRunResult> {
    logger.info('reconciliationService.run (stub)');
    throw new Error('NOT_IMPLEMENTED: reconciliationService.run');
  },

  /** Mark a break resolved. */
  async resolveBreak(_breakId: string): Promise<void> {
    throw new Error('NOT_IMPLEMENTED: reconciliationService.resolveBreak');
  },
};

export default reconciliationService;
