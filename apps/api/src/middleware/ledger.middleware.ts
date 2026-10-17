import type { Request, Response, NextFunction } from 'express';

/**
 * Append-only guard for /ledger/* routes.
 *
 * Why: the ledger is immutable. Any attempt to mutate an entry in place (PUT /
 * PATCH / DELETE) is a category error — the correct way to fix a mistake is a
 * correction (reversal + rebook). We reject those methods with 405 before they
 * ever reach a handler. (A DB trigger is the second line of defense.)
 */
export function preventLedgerMutation(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (req.method === 'PUT' || req.method === 'PATCH' || req.method === 'DELETE') {
    res.status(405).json({
      ok: false,
      error: {
        code: 'METHOD_NOT_ALLOWED',
        message:
          'Ledger entries are immutable. Use /ledger/correction to correct errors.',
      },
    });
    return;
  }
  next();
}

export default preventLedgerMutation;
