import { Worker, type Job } from 'bullmq';
import { redisConnection } from '../lib/redis';
import { QueueName } from '../lib/queue';
import { logger } from '../lib/logger';

/**
 * Monthly rebalance job — checks portfolio drift against targets and queues
 * rebalance trades (routed through the approval queue when over threshold).
 * Skeleton processor.
 */
export async function processMonthlyRebalance(job: Job): Promise<void> {
  logger.info('monthly-rebalance job (stub)', { jobId: job.id });
  // TODO: compute drift vs REBALANCE_DRIFT_THRESHOLD_PCT -> propose trades.
}

export function startMonthlyRebalanceWorker(): Worker {
  return new Worker(QueueName.MonthlyRebalance, processMonthlyRebalance, {
    connection: redisConnection,
  });
}
