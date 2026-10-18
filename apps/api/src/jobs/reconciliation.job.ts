import { Worker, type Job } from 'bullmq';
import { redisConnection } from '../lib/redis';
import { QueueName, reconciliationQueue } from '../lib/queue';
import { logger } from '../lib/logger';
import { runDailyReconciliation } from '../services/reconciliation.service';

/**
 * Daily reconciliation job — compares our ledger to the (simulated) custodian
 * file and surfaces breaks. Weekdays at 6am ET. Idempotent (breaks de-dup).
 */
const CRON_6AM_ET = '0 6 * * 1-5';

export async function processReconciliation(_job: Job): Promise<void> {
  const result = await runDailyReconciliation();
  logger.info('Reconciliation job finished', result);
}

let worker: Worker | null = null;

export function startReconciliationWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(QueueName.Reconciliation, processReconciliation, { connection: redisConnection });
  worker.on('failed', (job, err) => logger.error('Reconciliation job failed', { jobId: job?.id, error: err.message }));
  worker.on('error', (err) => logger.warn('Reconciliation worker error (is Redis up?)', { error: err.message }));

  reconciliationQueue
    .add('run-reconciliation', {}, { repeat: { pattern: CRON_6AM_ET, tz: 'America/New_York' } })
    .then(() => logger.info('Reconciliation scheduled (weekdays 6am ET)'))
    .catch((err) => logger.warn('Could not schedule reconciliation', { error: err.message }));

  return worker;
}
