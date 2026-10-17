import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';
import {
  createJournalEntry,
  getBalanceAsOf,
  getCashBalance,
  createCorrection,
  getStatementForPeriod,
} from '../services/ledger.service';
import { EntryType } from '@prisma/client';

// --- helpers ---------------------------------------------------------------

function daysAgo(n: number): Date {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() - n);
  return d;
}
function daysFromNow(n: number): Date {
  return daysAgo(-n);
}

let accountId: string;

async function wipe(): Promise<void> {
  // TRUNCATE bypasses the per-row append-only trigger, so tests can reset.
  await prisma.$executeRawUnsafe(
    'TRUNCATE "LedgerEntry","TaxLot","Position","Order","Valuation","MarketPrice","ReconciliationBreak","ApprovalQueue","Account","User" RESTART IDENTITY CASCADE',
  );
}

beforeEach(async () => {
  await wipe();
  const user = await prisma.user.create({
    data: {
      email: 'ledger-test@corgi.test',
      passwordHash: 'x',
      role: 'INVESTOR',
      account: { create: { kycStatus: 'APPROVED', status: 'ACTIVE' } },
    },
    include: { account: true },
  });
  accountId = user.account!.id;
});

afterAll(async () => {
  await prisma.$disconnect();
});

// --- Test 1 ----------------------------------------------------------------
test('creates a balanced journal entry', async () => {
  const eff = daysAgo(1);
  const entries = await createJournalEntry(accountId, [
    { type: EntryType.CASH_DEPOSIT, amount: 50000n, description: 'Deposit', effectiveDate: eff },
    { type: EntryType.CASH_DEPOSIT, amount: -50000n, description: 'Deposit offset', effectiveDate: eff },
  ]);

  // sum of amounts = 0
  expect(entries.reduce((s, e) => s + e.amount, 0n)).toBe(0n);

  // saved to DB
  const saved = await prisma.ledgerEntry.findMany({ where: { accountId } });
  expect(saved).toHaveLength(2);

  // cannot be updated after creation (DB-level append-only trigger)
  await expect(
    prisma.ledgerEntry.update({ where: { id: entries[0].id }, data: { description: 'hacked' } }),
  ).rejects.toThrow();

  // ...nor deleted
  await expect(
    prisma.ledgerEntry.delete({ where: { id: entries[0].id } }),
  ).rejects.toThrow();
});

// --- Test 2 ----------------------------------------------------------------
test('rejects unbalanced journal entry', async () => {
  const eff = daysAgo(1);
  await expect(
    createJournalEntry(accountId, [
      { type: EntryType.CASH_DEPOSIT, amount: 50000n, description: 'Deposit', effectiveDate: eff },
      { type: EntryType.CASH_WITHDRAWAL, amount: -40000n, description: 'Partial offset', effectiveDate: eff },
    ]),
  ).rejects.toThrow('Journal entry does not balance');

  // nothing persisted
  expect(await prisma.ledgerEntry.count({ where: { accountId } })).toBe(0);
});

// --- Test 3 ----------------------------------------------------------------
test('getBalanceAsOf returns correct historical balance', async () => {
  // +$500 value-dated 10 days ago, -$500 value-dated 1 day ago (nets to 0 today)
  await createJournalEntry(accountId, [
    { type: EntryType.CASH_DEPOSIT, amount: 50000n, description: 'Early', effectiveDate: daysAgo(10) },
    { type: EntryType.CASH_WITHDRAWAL, amount: -50000n, description: 'Late', effectiveDate: daysAgo(1) },
  ]);

  // As of 5 days ago, only the early leg counts.
  const historical = (await getBalanceAsOf(accountId, daysAgo(5))) as bigint;
  expect(historical).toBe(50000n);

  // As of today, both legs count -> 0.
  expect(await getCashBalance(accountId)).toBe(0n);
});

// --- Test 4 ----------------------------------------------------------------
test('createCorrection creates reversal and rebook', async () => {
  const wrongDate = daysAgo(20);
  const correctDate = daysAgo(2);

  const original = await createJournalEntry(accountId, [
    { type: EntryType.FEE, amount: -1000n, description: 'Advisory fee', effectiveDate: wrongDate },
    { type: EntryType.FEE, amount: 1000n, description: 'Advisory fee offset', effectiveDate: wrongDate },
  ]);
  const originalIds = original.map((o) => o.id);

  const { reversals, rebookedEntries } = await createCorrection({
    accountId,
    originalEntryIds: originalIds,
    reason: 'Fix mis-dated fee',
    correctedEntries: [
      { type: EntryType.FEE, amount: -1000n, description: 'Advisory fee', effectiveDate: correctDate },
      { type: EntryType.FEE, amount: 1000n, description: 'Advisory fee offset', effectiveDate: correctDate },
    ],
    effectiveDate: correctDate,
  });

  // originals untouched
  const originalsNow = await prisma.ledgerEntry.findMany({ where: { id: { in: originalIds } } });
  for (const o of originalsNow) {
    const before = original.find((x) => x.id === o.id)!;
    expect(o.amount).toBe(before.amount);
    expect(o.effectiveDate.getTime()).toBe(before.effectiveDate.getTime());
    expect(o.description).toBe(before.description);
  }

  // reversals have flipped amounts and the original value date
  expect(reversals).toHaveLength(2);
  const reversedSum = reversals.reduce((s, r) => s + r.amount, 0n);
  expect(reversedSum).toBe(0n);
  for (const r of reversals) {
    expect(r.type).toBe(EntryType.CORRECTION_REVERSAL);
    expect(r.effectiveDate.getTime()).toBe(wrongDate.getTime());
    const orig = original.find((o) => o.id === r.referenceId)!;
    expect(r.amount).toBe(-orig.amount);
  }

  // rebooked entries carry the corrected value date
  expect(rebookedEntries).toHaveLength(2);
  for (const rb of rebookedEntries) {
    expect(rb.type).toBe(EntryType.CORRECTION_REBOOK);
    expect(rb.effectiveDate.getTime()).toBe(correctDate.getTime());
  }

  // final balance reflects the correction: original + reversal cancel, rebook nets 0
  expect(await getCashBalance(accountId)).toBe(0n);
});

// --- Test 5 ----------------------------------------------------------------
test('getStatementForPeriod is reproducible', async () => {
  await createJournalEntry(accountId, [
    { type: EntryType.CASH_DEPOSIT, amount: 30000n, description: 'A', effectiveDate: daysAgo(9) },
    { type: EntryType.CASH_WITHDRAWAL, amount: -30000n, description: 'B', effectiveDate: daysAgo(3) },
  ]);

  const start = daysAgo(10);
  const end = daysAgo(1);

  const first = await getStatementForPeriod(accountId, start, end);
  const second = await getStatementForPeriod(accountId, start, end);

  expect(first).toEqual(second);
  expect(first.map((e) => e.id)).toEqual(second.map((e) => e.id));
});

// --- Test 6 ----------------------------------------------------------------
test('cash balance below zero logs a warning but does not throw', async () => {
  const warnSpy = jest.spyOn(logger, 'warn');

  // A withdrawal value-dated today, offset by a deposit value-dated tomorrow.
  // As of today the account is overdrawn — a warning, not an error.
  const promise = createJournalEntry(accountId, [
    { type: EntryType.CASH_WITHDRAWAL, amount: -50000n, description: 'Withdrawal', effectiveDate: daysAgo(0) },
    { type: EntryType.CASH_DEPOSIT, amount: 50000n, description: 'Settles tomorrow', effectiveDate: daysFromNow(1) },
  ]);

  await expect(promise).resolves.toHaveLength(2);
  expect(await getCashBalance(accountId)).toBe(-50000n);
  expect(warnSpy).toHaveBeenCalled();
});
