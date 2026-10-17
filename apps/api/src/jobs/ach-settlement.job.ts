import { Worker, type Job } from 'bullmq';
import { redisConnection } from '../lib/redis';
import { QueueName } from '../lib/queue';
import { logger } from '../lib/logger';
import { settleDeposit } from '../services/plaid.service';

/**
 * ACH settlement job — settles a pending deposit after its settlement window
 * (10s in sandbox, T+1 in production). settleDeposit is idempotent, so a retry
 * or a duplicate job never double-credits.
 */
interface SettlementJobData {
  depositId: string;
}

export async function processSettlement(job: Job<SettlementJobData>): Promise<void> {
  const { depositId } = job.data;
  await settleDeposit(depositId);
  logger.info(`Deposit settled: ${depositId}`);
}

let worker: Worker<SettlementJobData> | null = null;

/** Start the settlement worker. Safe to call once at boot; errors are logged. */
export function startAchSettlementWorker(): Worker<SettlementJobData> {
  if (worker) return worker;
  worker = new Worker<SettlementJobData>(QueueName.AchSettlement, processSettlement, {
    connection: redisConnection,
  });
  worker.on('failed', (job, err) => {
    logger.error('Settlement job failed', { jobId: job?.id, error: err.message });
  });
  worker.on('error', (err) => {
    logger.warn('Settlement worker error (is Redis up?)', { error: err.message });
  });
  return worker;
}
