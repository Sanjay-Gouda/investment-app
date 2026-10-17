import IORedis from 'ioredis';
import { logger } from './logger';

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

/**
 * Shared Redis connection. BullMQ requires `maxRetriesPerRequest: null` on the
 * connection it uses for blocking commands, so we set it here and reuse it.
 */
export const redisConnection = new IORedis(REDIS_URL, {
  maxRetriesPerRequest: null,
  lazyConnect: true,
});

redisConnection.on('error', (err) => {
  logger.error('Redis connection error', { error: err.message });
});

redisConnection.on('connect', () => {
  logger.info('Redis connected');
});

export default redisConnection;
