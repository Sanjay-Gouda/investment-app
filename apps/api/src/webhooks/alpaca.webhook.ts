import type { Request, Response } from 'express';
import { logger } from '../lib/logger';
import { handleFillWebhook, handleOrderTerminal, type AlpacaTradeEvent } from '../services/alpaca.service';

/**
 * Alpaca trade_update webhook. Normalizes the payload into an AlpacaTradeEvent
 * and routes it. Idempotency is enforced inside the service (Redis + DB guards).
 * Raw body is parsed in index.ts; we JSON-parse it here.
 */
export async function handleAlpacaWebhook(req: Request, res: Response): Promise<void> {
  let body: Record<string, unknown> = {};
  try {
    body = JSON.parse(Buffer.isBuffer(req.body) ? req.body.toString('utf8') : JSON.stringify(req.body ?? {}));
  } catch {
    res.status(400).json({ ok: false, error: { code: 'BAD_PAYLOAD', message: 'Invalid JSON' } });
    return;
  }

  // Accept either a flat event or a { event, order } trade_update shape.
  const order = (body.order ?? {}) as Record<string, unknown>;
  const eventType = String(body.event ?? '');
  const normalized: AlpacaTradeEvent = {
    event: eventType as AlpacaTradeEvent['event'],
    order_id: String(order.id ?? body.order_id ?? ''),
    client_order_id: (order.client_order_id as string) ?? (body.client_order_id as string) ?? undefined,
    symbol: (order.symbol as string) ?? (body.symbol as string) ?? undefined,
    qty: String(body.qty ?? order.filled_qty ?? order.qty ?? '0'),
    price: String(body.price ?? order.filled_avg_price ?? '0'),
    timestamp: (body.timestamp as string) ?? (order.filled_at as string) ?? undefined,
    execution_id: (body.execution_id as string) ?? undefined,
  };

  logger.info('Alpaca webhook', { event: normalized.event, orderId: normalized.order_id });

  try {
    if (normalized.event === 'fill' || normalized.event === 'partial_fill') {
      await handleFillWebhook(normalized);
    } else if (normalized.event === 'canceled' || normalized.event === 'rejected') {
      await handleOrderTerminal(normalized);
    }
  } catch (err) {
    logger.error('Alpaca webhook processing failed', { error: err instanceof Error ? err.message : String(err) });
  }

  // Always 200 so Alpaca does not retry endlessly.
  res.status(200).json({ received: true });
}
