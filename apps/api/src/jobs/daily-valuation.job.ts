import { Worker, type Job } from 'bullmq';
import { redisConnection } from '../lib/redis';
import { QueueName } from '../lib/queue';
import { logger } from '../lib/logger';

/**
 * Daily valuation job — values every active account and records its TWR.
 * Scheduled after market close. Skeleton processor.
 */
export async function processDailyValuation(job: Job): Promise<void> {
  logger.info('daily-valuation job (stub)', { jobId: job.id });
  // TODO: iterate active accounts -> valuationService.valueAccount -> persist.
}

export function startDailyValuationWorker(): Worker {
  return new Worker(QueueName.DailyValuation, processDailyValuation, {
    connection: redisConnection,
  });
}
