import { logger } from '../lib/logger';
import { pollOpenOrders } from '../services/alpaca.service';

/**
 * Order-fill polling fallback. Every 30s, checks Alpaca for open orders that
 * have filled and books them — so fills are captured even if a webhook is missed.
 * handleFillWebhook is idempotent, so polling never double-books.
 */
const POLL_INTERVAL_MS = 30_000;
let timer: NodeJS.Timeout | null = null;

export function startOrderPolling(): void {
  if (timer) return;
  timer = setInterval(async () => {
    try {
      const { checked, filled } = await pollOpenOrders();
      if (filled > 0) logger.info('Order polling booked fills', { checked, filled });
    } catch (err) {
      logger.debug('Order polling error', { error: err instanceof Error ? err.message : String(err) });
    }
  }, POLL_INTERVAL_MS);
  // Don't keep the process alive just for polling.
  timer.unref?.();
  logger.info('Order polling started (30s)');
}

export function stopOrderPolling(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
