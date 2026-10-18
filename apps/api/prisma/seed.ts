import path from 'path';
import dotenv from 'dotenv';
import bcrypt from 'bcryptjs';
import { PrismaClient, Prisma } from '@prisma/client';

dotenv.config({ path: path.resolve(__dirname, '../../../.env') });
dotenv.config();

const prisma = new PrismaClient();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** UTC midnight for `n` days before today — stable, timezone-independent dates. */
function daysAgo(n: number): Date {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() - n);
  return d;
}

/**
 * Deterministic pseudo-random in [0,1) from an integer seed, so re-running the
 * seed produces the same "realistic" price series every time.
 */
function rand(seed: number): number {
  const x = Math.sin(seed * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

/**
 * Build a 30-day daily close series (cents). Starts near `startCents`, drifts
 * gently upward with small day-to-day wiggle so valuations show a modest gain.
 */
function priceSeries(
  symbol: string,
  startCents: number,
  driftPerDay: number,
  volCents: number,
): { symbol: string; date: Date; closePriceCents: bigint; source: string; isStale: boolean }[] {
  const rows = [];
  for (let i = 29; i >= 0; i--) {
    const dayIndex = 29 - i; // 0 .. 29
    const drift = driftPerDay * dayIndex;
    const wiggle = (rand(startCents + dayIndex) - 0.5) * 2 * volCents;
    const close = Math.max(1, Math.round(startCents + drift + wiggle));
    rows.push({
      symbol,
      date: daysAgo(i),
      closePriceCents: BigInt(close),
      source: 'seed',
      isStale: false,
    });
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Seed
// ---------------------------------------------------------------------------

async function main() {
  // Idempotent reset. TRUNCATE (not deleteMany) because the LedgerEntry
  // append-only trigger blocks DELETE; per-row triggers do not fire on TRUNCATE.
  await prisma.$executeRawUnsafe(
    'TRUNCATE "LedgerEntry","TaxLot","Position","Order","Valuation","MarketPrice","ReconciliationBreak","ApprovalQueue","CustodianFile","Account","User" RESTART IDENTITY CASCADE',
  );

  const passwordHash = await bcrypt.hash('demo123456', 10);

  // --- Users + accounts -----------------------------------------------------
  const investor = await prisma.user.create({
    data: {
      email: 'investor@demo.com',
      passwordHash,
      fullName: 'Demo Investor',
      role: 'INVESTOR',
      account: {
        create: { kycStatus: 'APPROVED', status: 'ACTIVE' },
      },
    },
    include: { account: true },
  });

  await prisma.user.create({
    data: {
      email: 'adviser@demo.com',
      passwordHash,
      fullName: 'Demo Adviser',
      role: 'ADVISER',
      account: {
        create: { kycStatus: 'APPROVED', status: 'ACTIVE' },
      },
    },
  });

  const accountId = investor.account!.id;

  // --- Ledger entries (all cash amounts in cents as BigInt) -----------------
  await prisma.ledgerEntry.createMany({
    data: [
      {
        accountId,
        type: 'CASH_DEPOSIT',
        amount: BigInt(1_000_000), // +$10,000.00
        description: 'Initial ACH deposit',
        effectiveDate: daysAgo(30),
      },
      {
        accountId,
        type: 'TRADE_BUY_CASH',
        amount: BigInt(-600_000), // -$6,000.00
        assetSymbol: 'VTI',
        description: 'Buy VTI — cash leg',
        effectiveDate: daysAgo(28),
      },
      {
        accountId,
        type: 'TRADE_BUY_UNITS',
        amount: BigInt(0), // units leg carries no cash
        assetSymbol: 'VTI',
        units: new Prisma.Decimal('30.123456'),
        description: 'Buy VTI — units leg',
        effectiveDate: daysAgo(28),
      },
      {
        accountId,
        type: 'TRADE_BUY_CASH',
        amount: BigInt(-200_000), // -$2,000.00
        assetSymbol: 'BND',
        description: 'Buy BND — cash leg',
        effectiveDate: daysAgo(28),
      },
      {
        accountId,
        type: 'TRADE_BUY_UNITS',
        amount: BigInt(0),
        assetSymbol: 'BND',
        units: new Prisma.Decimal('20.456789'),
        description: 'Buy BND — units leg',
        effectiveDate: daysAgo(28),
      },
      {
        accountId,
        type: 'DIVIDEND_CASH',
        amount: BigInt(4_500), // +$45.00
        assetSymbol: 'VTI',
        description: 'VTI dividend',
        effectiveDate: daysAgo(10),
      },
    ],
  });

  // --- Positions + tax lots -------------------------------------------------
  const vtiPosition = await prisma.position.create({
    data: {
      accountId,
      symbol: 'VTI',
      units: new Prisma.Decimal('30.123456'),
    },
  });
  await prisma.taxLot.create({
    data: {
      positionId: vtiPosition.id,
      symbol: 'VTI',
      units: new Prisma.Decimal('30.123456'),
      remainingUnits: new Prisma.Decimal('30.123456'),
      costBasisCents: BigInt(600_000),
      openedAt: daysAgo(28),
    },
  });

  const bndPosition = await prisma.position.create({
    data: {
      accountId,
      symbol: 'BND',
      units: new Prisma.Decimal('20.456789'),
    },
  });
  await prisma.taxLot.create({
    data: {
      positionId: bndPosition.id,
      symbol: 'BND',
      units: new Prisma.Decimal('20.456789'),
      remainingUnits: new Prisma.Decimal('20.456789'),
      costBasisCents: BigInt(200_000),
      openedAt: daysAgo(28),
    },
  });

  // --- Market prices (last 30 days, VTI + BND) ------------------------------
  // Anchored near the seeded cost basis so the portfolio shows a modest gain:
  //   VTI cost ~= 600000 / 30.123456 ≈ 19918 c/unit
  //   BND cost ~= 200000 / 20.456789 ≈  9776 c/unit
  const vtiPrices = priceSeries('VTI', 19_800, 18, 90); // ~ +1.1k c drift over 30d
  const bndPrices = priceSeries('BND', 9_740, 3, 25);
  await prisma.marketPrice.createMany({ data: [...vtiPrices, ...bndPrices] });

  // --- A planted reconciliation break (for the breaks screen demo) ----------
  await prisma.reconciliationBreak.create({
    data: {
      breakDate: daysAgo(2),
      symbol: 'VTI',
      accountId,
      breakType: 'AMOUNT_MISMATCH',
      ledgerValue: new Prisma.Decimal('30.123456'),
      custodianValue: new Prisma.Decimal('30.500000'),
      difference: new Prisma.Decimal('0.376544'),
      description: 'VTI units differ (seed)',
      status: 'OPEN',
      agingDays: 2,
    },
  });

  // --- A pending approval in the adviser queue ------------------------------
  await prisma.approvalQueue.create({
    data: {
      initiatorId: investor.id,
      type: 'REBALANCE',
      status: 'PENDING',
      payload: {
        accountId,
        portfolioType: 'GROWTH',
        action: 'Monthly portfolio rebalance',
        requestedBy: 'investor@demo.com',
      },
    },
  });

  // eslint-disable-next-line no-console
  console.log('Seed complete:', {
    users: ['investor@demo.com', 'adviser@demo.com'],
    password: 'demo123456',
    ledgerEntries: 6,
    positions: ['VTI 30.123456', 'BND 20.456789'],
    taxLots: 2,
    marketPrices: vtiPrices.length + bndPrices.length,
    latest: {
      VTI: `${vtiPrices[vtiPrices.length - 1].closePriceCents} c`,
      BND: `${bndPrices[bndPrices.length - 1].closePriceCents} c`,
    },
  });
}

main()
  .catch((e) => {
    // eslint-disable-next-line no-console
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
