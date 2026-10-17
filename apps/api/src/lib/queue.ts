import { Queue, QueueOptions } from 'bullmq';
import { redisConnection } from './redis';

/**
 * Central registry of background queues. Workers for these are wired in
 * src/jobs/*. Keeping the names in one enum avoids typos across producers and
 * consumers.
 */
export const QueueName = {
  DailyValuation: 'daily-valuation',
  MonthlyRebalance: 'monthly-rebalance',
  Reconciliation: 'reconciliation',
  AchSettlement: 'ach-settlement',
} as const;

export type QueueName = (typeof QueueName)[keyof typeof QueueName];

const defaultQueueOptions: QueueOptions = {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 5_000 },
    removeOnComplete: { age: 24 * 3600, count: 1_000 },
    removeOnFail: { age: 7 * 24 * 3600 },
  },
};

export const dailyValuationQueue = new Queue(QueueName.DailyValuation, defaultQueueOptions);
export const monthlyRebalanceQueue = new Queue(QueueName.MonthlyRebalance, defaultQueueOptions);
export const reconciliationQueue = new Queue(QueueName.Reconciliation, defaultQueueOptions);
export const achSettlementQueue = new Queue(QueueName.AchSettlement, defaultQueueOptions);

export const queues = {
  [QueueName.DailyValuation]: dailyValuationQueue,
  [QueueName.MonthlyRebalance]: monthlyRebalanceQueue,
  [QueueName.Reconciliation]: reconciliationQueue,
  [QueueName.AchSettlement]: achSettlementQueue,
};

export default queues;
