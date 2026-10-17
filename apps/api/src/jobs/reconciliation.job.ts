import { Worker, type Job } from 'bullmq';
import { redisConnection } from '../lib/redis';
import { QueueName } from '../lib/queue';
import { logger } from '../lib/logger';

/**
 * Reconciliation job — runs a daily ledger-vs-custodian reconciliation pass and
 * ages any open breaks. Skeleton processor.
 */
export async function processReconciliation(job: Job): Promise<void> {
  logger.info('reconciliation job (stub)', { jobId: job.id });
  // TODO: reconciliationService.run(asOf) + increment agingDays on open breaks.
}

export function startReconciliationWorker(): Worker {
  return new Worker(QueueName.Reconciliation, processReconciliation, {
    connection: redisConnection,
  });
}
