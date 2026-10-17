import { logger } from '../lib/logger';

/**
 * Restatement service — handles late-arriving corrections.
 *
 * When a price or trade is corrected after valuations have been published, prior
 * valuations must be restated. We keep both the original and restated figures
 * (Valuation.isRestated + original* columns) for an auditable before/after.
 * Skeleton only.
 */
export const restatementService = {
  /** Recompute and persist restated valuations from `fromDate` forward. */
  async restateFrom(_accountId: string, _fromDate: Date): Promise<{ restatedCount: number }> {
    logger.info('restatementService.restateFrom (stub)');
    throw new Error('NOT_IMPLEMENTED: restatementService.restateFrom');
  },
};

export default restatementService;
