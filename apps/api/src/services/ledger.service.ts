import { Prisma, EntryType, type LedgerEntry } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';

/**
 * Ledger service — the single source of truth for every money event.
 *
 * Invariants (never broken):
 *  - Append-only: we only ever INSERT. No update/delete of ledger rows, ever.
 *    (A DB trigger enforces this too — see migration `ledger_append_only`.)
 *  - Double-entry: a journal is a set of rows whose signed amounts sum to zero.
 *  - Money is BigInt cents; units (shares) are Decimal(20,6) via Prisma.Decimal
 *    (which is decimal.js under the hood — exact, no float error).
 *  - Bitemporal: `effectiveDate` = when it happened (value date),
 *    `bookingDate` = when we recorded it (defaults to now()).
 *  - Corrections never mutate: a reversal row + a rebook row instead.
 *
 * NOTE on balances: a journal's legs all share one accountId and sum to zero,
 * so a balanced journal contributes 0 to that account's own balance. Real,
 * balance-moving postings therefore live as single-sided rows (as the seed
 * does) or would use a second counter-account. See DECISIONS.md.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** One leg of a journal entry. `amount` is signed cents (+credit / -debit). */
export interface JournalEntryInput {
  type: EntryType;
  amount: bigint;
  assetSymbol?: string;
  units?: Prisma.Decimal | string | number;
  description: string;
  referenceId?: string;
  referenceType?: string;
  effectiveDate: Date;
  metadata?: Prisma.InputJsonValue;
}

export interface CreateCorrectionInput {
  accountId: string;
  originalEntryIds: string[];
  reason: string;
  correctedEntries: JournalEntryInput[];
  /** The corrected (value) date applied to rebook legs lacking their own. */
  effectiveDate: Date;
}

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

/**
 * Create a balanced, double-entry journal (>= 2 rows) atomically.
 *
 * Why: a journal is the only way money enters the ledger. Writing all legs in
 * one Prisma transaction guarantees we never persist a half-written, unbalanced
 * journal. The zero-sum check is the accounting guard rail.
 *
 * @throws if fewer than 2 legs, or if the signed amounts do not sum to zero
 *   ("Journal entry does not balance: debits must equal credits").
 */
export async function createJournalEntry(
  accountId: string,
  entries: JournalEntryInput[],
): Promise<LedgerEntry[]> {
  if (entries.length < 2) {
    throw new Error('Journal entry must have at least 2 entries');
  }

  const sum = entries.reduce((acc, e) => acc + e.amount, 0n);
  if (sum !== 0n) {
    throw new Error('Journal entry does not balance: debits must equal credits');
  }

  const created = await prisma.$transaction(
    entries.map((e) =>
      prisma.ledgerEntry.create({
        data: {
          accountId,
          type: e.type,
          amount: e.amount,
          assetSymbol: e.assetSymbol ?? null,
          units: e.units != null ? new Prisma.Decimal(e.units) : null,
          description: e.description,
          referenceId: e.referenceId ?? null,
          referenceType: e.referenceType ?? null,
          effectiveDate: e.effectiveDate,
          metadata: e.metadata ?? Prisma.JsonNull,
        },
      }),
    ),
  );

  logger.info('Journal entry created', {
    accountId,
    legs: created.length,
    types: created.map((c) => c.type),
    entryIds: created.map((c) => c.id),
  });

  // Append-only safety net: warn (never throw) if cash went negative.
  const cash = await getCashBalance(accountId);
  if (cash < 0n) {
    logger.warn('Account cash balance is negative after journal entry', {
      accountId,
      cashBalanceCents: cash.toString(),
    });
  }

  return created;
}

// ---------------------------------------------------------------------------
// Balances
// ---------------------------------------------------------------------------

/**
 * Counter/clearing buckets (set via metadata.bucket) that represent the OTHER
 * side of a double-entry journal — the external bank and in-transit clearing
 * accounts. They are excluded from an account's own *cash* balance so that a
 * balanced journal can still move the customer's available cash. Legacy entries
 * with no bucket are treated as real settled cash. See DECISIONS.md.
 */
export const COUNTER_BUCKETS = ['IN_TRANSIT', 'EXTERNAL'] as const;

/**
 * Point-in-time balance from the ledger as of a value date (inclusive).
 *
 * Why inclusive `<= asOfDate` on effectiveDate: balances are value-dated, so
 * "balance on day D" means every event whose value date is on or before D.
 *
 * Cash balance = SUM(amount) of the account's own cash legs, EXCLUDING the
 * counter/clearing buckets (so pending deposits and the external side don't
 * inflate available cash).
 *
 * @param symbol when given, returns the units balance (Decimal) for that
 *   asset; otherwise returns the cash balance in cents (bigint).
 */
export async function getBalanceAsOf(
  accountId: string,
  asOfDate: Date,
  symbol?: string,
): Promise<bigint | Prisma.Decimal> {
  if (symbol) {
    const agg = await prisma.ledgerEntry.aggregate({
      where: { accountId, assetSymbol: symbol, effectiveDate: { lte: asOfDate } },
      _sum: { units: true },
    });
    return agg._sum.units ?? new Prisma.Decimal(0);
  }

  // Raw SQL so the JSON-null / missing-key cases are handled cleanly.
  const rows = await prisma.$queryRaw<{ bal: bigint }[]>`
    SELECT CAST(COALESCE(SUM(amount), 0) AS BIGINT) AS bal
    FROM "LedgerEntry"
    WHERE "accountId" = ${accountId}
      AND "effectiveDate" <= ${asOfDate}
      AND COALESCE(metadata->>'bucket', '') NOT IN ('IN_TRANSIT', 'EXTERNAL')
  `;
  return rows[0]?.bal ?? 0n;
}

/**
 * Current cash balance in cents for an account.
 * Thin wrapper over getBalanceAsOf(today, no symbol).
 */
export async function getCashBalance(accountId: string): Promise<bigint> {
  return (await getBalanceAsOf(accountId, new Date())) as bigint;
}

/**
 * Current units held of `symbol` for an account.
 * Thin wrapper over getBalanceAsOf(today, symbol).
 */
export async function getPositionBalance(
  accountId: string,
  symbol: string,
): Promise<Prisma.Decimal> {
  return (await getBalanceAsOf(accountId, new Date(), symbol)) as Prisma.Decimal;
}

// ---------------------------------------------------------------------------
// Corrections (reversal + rebook — never edit)
// ---------------------------------------------------------------------------

/**
 * Correct earlier entries without ever mutating them.
 *
 * Why: an immutable ledger stays auditable only if mistakes are fixed by
 * *adding* compensating rows. For each original we post a sign-flipped
 * CORRECTION_REVERSAL at the original value date, then post the fresh
 * CORRECTION_REBOOK rows at the corrected value date. All in one transaction.
 *
 * @returns the created { reversals, rebookedEntries }.
 */
export async function createCorrection(
  input: CreateCorrectionInput,
): Promise<{ reversals: LedgerEntry[]; rebookedEntries: LedgerEntry[] }> {
  const { accountId, originalEntryIds, reason, correctedEntries, effectiveDate } = input;

  const originals = await prisma.ledgerEntry.findMany({
    where: { id: { in: originalEntryIds }, accountId },
  });

  if (originals.length !== originalEntryIds.length) {
    throw new Error('One or more original entries not found for this account');
  }

  const reversalOps = originals.map((o) =>
    prisma.ledgerEntry.create({
      data: {
        accountId,
        type: EntryType.CORRECTION_REVERSAL,
        amount: -o.amount, // flip the sign
        assetSymbol: o.assetSymbol,
        units: o.units ? o.units.negated() : null, // flip units too
        description: `Reversal: ${o.description}`,
        referenceId: o.id, // links the reversal back to what it reverses
        referenceType: 'CORRECTION_REVERSAL',
        effectiveDate: o.effectiveDate, // same value date as the original
        // bookingDate defaults to now() — when we learned of the error
        metadata: { reason, correctionOf: o.id } as Prisma.InputJsonValue,
      },
    }),
  );

  const rebookOps = correctedEntries.map((e) =>
    prisma.ledgerEntry.create({
      data: {
        accountId,
        type: EntryType.CORRECTION_REBOOK,
        amount: e.amount,
        assetSymbol: e.assetSymbol ?? null,
        units: e.units != null ? new Prisma.Decimal(e.units) : null,
        description: `Rebook: ${e.description}`,
        referenceId: e.referenceId ?? null,
        referenceType: 'CORRECTION_REBOOK',
        effectiveDate: e.effectiveDate ?? effectiveDate, // corrected value date
        metadata: { reason } as Prisma.InputJsonValue,
      },
    }),
  );

  const results = await prisma.$transaction([...reversalOps, ...rebookOps]);
  const reversals = results.slice(0, reversalOps.length);
  const rebookedEntries = results.slice(reversalOps.length);

  logger.info('Ledger correction posted', {
    accountId,
    reason,
    reversed: reversals.map((r) => r.id),
    reversalOf: originalEntryIds,
    rebooked: rebookedEntries.map((r) => r.id),
  });

  return { reversals, rebookedEntries };
}

// ---------------------------------------------------------------------------
// Reads (statements & history)
// ---------------------------------------------------------------------------

/**
 * All entries whose value date falls within [startDate, endDate], ordered
 * deterministically (effectiveDate ASC, then createdAt ASC).
 *
 * Why deterministic ordering: a statement for a past period must be byte-for-
 * byte reproducible forever — same inputs, same output, for audit.
 */
export async function getStatementForPeriod(
  accountId: string,
  startDate: Date,
  endDate: Date,
): Promise<LedgerEntry[]> {
  return prisma.ledgerEntry.findMany({
    where: { accountId, effectiveDate: { gte: startDate, lte: endDate } },
    orderBy: [{ effectiveDate: 'asc' }, { createdAt: 'asc' }],
  });
}

/**
 * Paginated ledger history, newest value date first.
 * For UI tables where the most recent activity should lead.
 */
export async function getLedgerHistory(
  accountId: string,
  limit = 50,
  offset = 0,
): Promise<LedgerEntry[]> {
  return prisma.ledgerEntry.findMany({
    where: { accountId },
    orderBy: [{ effectiveDate: 'desc' }, { createdAt: 'desc' }],
    take: limit,
    skip: offset,
  });
}

/** Count of all ledger entries for an account (for pagination totals). */
export async function countLedgerEntries(accountId: string): Promise<number> {
  return prisma.ledgerEntry.count({ where: { accountId } });
}

export const ledgerService = {
  createJournalEntry,
  getBalanceAsOf,
  getCashBalance,
  getPositionBalance,
  createCorrection,
  getStatementForPeriod,
  getLedgerHistory,
  countLedgerEntries,
};

export default ledgerService;
