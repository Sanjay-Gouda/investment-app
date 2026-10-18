import { Worker, type Job } from 'bullmq';
import { redisConnection } from '../lib/redis';
import { QueueName, dailyValuationQueue } from '../lib/queue';
import { logger } from '../lib/logger';
import { runDailyValuation } from '../services/valuation.service';

/**
 * Daily valuation job. Values every ACTIVE account at market close.
 * Scheduled weekdays at 4pm ET (market is closed on weekends). Idempotent —
 * storeValuation upserts per day, so a re-run updates the same snapshot.
 * On failure we do NOT retry; tomorrow's run will catch up.
 */

const CRON_4PM_ET = '0 16 * * 1-5'; // Mon–Fri 16:00 America/New_York

export async function processValuation(_job: Job): Promise<void> {
  const result = await runDailyValuation();
  logger.info('Daily valuation job finished', result);
}

let worker: Worker | null = null;

export function startDailyValuationWorker(): Worker {
  if (worker) return worker;

  worker = new Worker(QueueName.DailyValuation, processValuation, {
    connection: redisConnection,
    // No auto-retry — we run again next day.
  });
  worker.on('failed', (job, err) => {
    logger.error('Daily valuation job failed (no retry)', { jobId: job?.id, error: err.message });
  });
  worker.on('error', (err) => {
    logger.warn('Daily valuation worker error (is Redis up?)', { error: err.message });
  });

  // Schedule the repeatable cron job (deduped by repeat key). Non-fatal.
  dailyValuationQueue
    .add('run-valuation', {}, { repeat: { pattern: CRON_4PM_ET, tz: 'America/New_York' } })
    .then(() => logger.info('Daily valuation scheduled (weekdays 4pm ET)'))
    .catch((err) => logger.warn('Could not schedule daily valuation', { error: err.message }));

  return worker;
}

/** Enqueue a one-off valuation run now (manual trigger). */
export async function triggerValuationNow(): Promise<void> {
  await dailyValuationQueue.add('run-valuation', { manual: true });
}
