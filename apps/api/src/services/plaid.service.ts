import {
  Configuration,
  PlaidApi,
  PlaidEnvironments,
  Products,
  CountryCode,
} from 'plaid';
import type { Deposit } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';
import { encrypt } from '../lib/crypto';
import { achSettlementQueue } from '../lib/queue';
import { createJournalEntry, getCashBalance } from './ledger.service';

/**
 * Plaid bank-linking + deposits.
 *
 * Deposit lifecycle: PENDING (T+1) -> SETTLED, or PENDING -> RETURNED (bounce).
 * Pending cash is NOT available cash.
 *
 * Ledger model (resolves the Step 3 double-entry tension): every leg carries a
 * metadata.bucket so a balanced (zero-sum) journal still moves the customer's
 * available cash. Buckets:
 *   SETTLED_CASH — the customer's available cash (what getCashBalance counts)
 *   IN_TRANSIT   — deposit in clearing (pending; excluded from cash)
 *   EXTERNAL     — the external bank counter-account (excluded from cash)
 *
 *   initiate: +IN_TRANSIT / -EXTERNAL      (cash unchanged — pending)
 *   settle:   +SETTLED_CASH / -IN_TRANSIT  (cash increases)
 *   bounce:   -IN_TRANSIT / +EXTERNAL      (cash unchanged — pending reversed)
 */

const MIN_DEPOSIT_CENTS = 100n; // $1.00
const MAX_DEPOSIT_CENTS = 1_000_000_000n; // $10,000,000.00

// --- Plaid client (lazy) ---------------------------------------------------

let _plaid: PlaidApi | null = null;
function getPlaid(): PlaidApi {
  if (_plaid) return _plaid;
  const env = (process.env.PLAID_ENV || 'sandbox') as keyof typeof PlaidEnvironments;
  const config = new Configuration({
    basePath: PlaidEnvironments[env],
    baseOptions: {
      headers: {
        'PLAID-CLIENT-ID': process.env.PLAID_CLIENT_ID,
        'PLAID-SECRET': process.env.PLAID_SECRET,
      },
    },
  });
  _plaid = new PlaidApi(config);
  return _plaid;
}

// --- Link / exchange -------------------------------------------------------

/** Create a Plaid Link token for the frontend widget. */
export async function createLinkToken(userId: string): Promise<{ linkToken: string }> {
  const res = await getPlaid().linkTokenCreate({
    user: { client_user_id: userId },
    client_name: 'Corgi Investment',
    products: [Products.Auth, Products.Transactions],
    country_codes: [CountryCode.Us],
    language: 'en',
  });
  return { linkToken: res.data.link_token };
}

/**
 * Exchange a public token for an access token, fetch the linked account's
 * details, and persist them (access token AES-256 encrypted — never plaintext).
 */
export async function exchangePublicToken(params: {
  userId: string;
  publicToken: string;
  accountId: string;
}): Promise<{ bankName: string; bankAccountLast4: string; linked: true }> {
  const plaid = getPlaid();
  const exchange = await plaid.itemPublicTokenExchange({ public_token: params.publicToken });
  const accessToken = exchange.data.access_token;
  const itemId = exchange.data.item_id;

  const auth = await plaid.authGet({ access_token: accessToken });
  const bankAccount = auth.data.accounts[0];
  const last4 = bankAccount?.mask ?? '0000';

  let bankName = 'Linked Bank';
  try {
    const instId = auth.data.item.institution_id;
    if (instId) {
      const inst = await plaid.institutionsGetById({
        institution_id: instId,
        country_codes: [CountryCode.Us],
      });
      bankName = inst.data.institution.name;
    }
  } catch {
    // Institution lookup is best-effort.
  }

  await prisma.account.update({
    where: { id: params.accountId },
    data: {
      plaidAccessToken: encrypt(accessToken), // encrypted at rest
      plaidItemId: itemId,
      plaidAccountId: bankAccount?.account_id ?? null,
      bankAccountLast4: last4,
      bankName,
    },
  });

  logger.info('Bank linked via Plaid', { accountId: params.accountId, bankName });
  return { bankName, bankAccountLast4: last4, linked: true };
}

/**
 * SANDBOX helper — link a fake bank without the Plaid UI (for dev/testing).
 */
export async function linkSandboxBank(accountId: string): Promise<{
  linked: true;
  bankName: string;
  bankAccountLast4: string;
}> {
  const bankName = 'Chase Bank (Sandbox)';
  const bankAccountLast4 = '0000';
  await prisma.account.update({
    where: { id: accountId },
    data: {
      plaidAccessToken: encrypt('sandbox-access-token'),
      plaidItemId: 'sandbox-item',
      plaidAccountId: 'sandbox-account',
      bankAccountLast4,
      bankName,
    },
  });
  logger.info('Sandbox bank linked', { accountId, bankName });
  return { linked: true, bankName, bankAccountLast4 };
}

/** Bank link status for an account — never returns the access token. */
export async function getBankDetails(accountId: string): Promise<{
  linked: boolean;
  bankName?: string;
  bankAccountLast4?: string;
}> {
  const account = await prisma.account.findUnique({ where: { id: accountId } });
  const linked = !!account?.bankName && !!account?.plaidAccountId;
  return linked
    ? { linked: true, bankName: account!.bankName!, bankAccountLast4: account!.bankAccountLast4 ?? undefined }
    : { linked: false };
}

// --- Deposits --------------------------------------------------------------

/** Start of today (UTC midnight) — stable value date. */
function todayUtc(): Date {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

/**
 * Initiate an ACH deposit: validate, create the Deposit record (PENDING), post
 * the pending (IN_TRANSIT) journal, and schedule a T+1 settlement job.
 */
export async function initiateDeposit(params: {
  accountId: string;
  amountCents: bigint;
  userId: string;
}): Promise<{ depositId: string; amountCents: bigint; settlementDate: Date; status: 'PENDING' }> {
  const { accountId, amountCents } = params;

  const account = await prisma.account.findUnique({ where: { id: accountId } });
  if (!account) throw new Error('Account not found');
  if (account.kycStatus !== 'APPROVED') throw new Error('KYC required');
  if (!account.bankName || !account.plaidAccountId) throw new Error('Bank account not linked');
  if (amountCents < MIN_DEPOSIT_CENTS) throw new Error('Minimum deposit is $1.00');
  if (amountCents > MAX_DEPOSIT_CENTS) throw new Error('Maximum deposit exceeded');

  const effectiveDate = todayUtc();
  const settlementDate = process.env.NODE_ENV === 'production'
    ? new Date(Date.now() + 86_400_000) // T+1
    : new Date(Date.now() + 10_000); // 10s in sandbox for a quick demo

  const deposit = await prisma.deposit.create({
    data: {
      accountId,
      amountCents,
      status: 'PENDING',
      plaidItemId: account.plaidItemId,
      settlementDate,
    },
  });

  // Pending journal: money is in transit, NOT yet available cash.
  await createJournalEntry(accountId, [
    {
      type: 'CASH_DEPOSIT',
      amount: amountCents,
      description: 'ACH deposit - pending settlement',
      referenceId: deposit.id,
      referenceType: 'PLAID_DEPOSIT',
      effectiveDate,
      metadata: { bucket: 'IN_TRANSIT', status: 'PENDING', settlementDate: settlementDate.toISOString() },
    },
    {
      type: 'CASH_DEPOSIT',
      amount: -amountCents,
      description: 'ACH deposit offset - external bank',
      referenceId: deposit.id,
      referenceType: 'PLAID_DEPOSIT',
      effectiveDate,
      metadata: { bucket: 'EXTERNAL', status: 'PENDING' },
    },
  ]);

  // Schedule settlement (non-fatal if Redis is unavailable).
  try {
    const delay = process.env.NODE_ENV === 'production' ? 86_400_000 : 10_000;
    await achSettlementQueue.add('settle', { depositId: deposit.id }, { delay, jobId: `settle-${deposit.id}` });
  } catch (err) {
    logger.warn('Could not schedule settlement job (will need manual/settle)', {
      depositId: deposit.id,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  logger.info('Deposit initiated', { depositId: deposit.id, amountCents: amountCents.toString() });
  return { depositId: deposit.id, amountCents, settlementDate, status: 'PENDING' };
}

/**
 * Settle a pending deposit — moves money from IN_TRANSIT to SETTLED_CASH.
 * Idempotent: settling a non-PENDING deposit is a no-op.
 */
export async function settleDeposit(depositId: string): Promise<Deposit> {
  const deposit = await prisma.deposit.findUnique({ where: { id: depositId } });
  if (!deposit) throw new Error('Deposit not found');
  if (deposit.status !== 'PENDING') {
    logger.info('settleDeposit no-op (not pending)', { depositId, status: deposit.status });
    return deposit;
  }

  await createJournalEntry(deposit.accountId, [
    {
      type: 'CASH_DEPOSIT',
      amount: deposit.amountCents,
      description: 'ACH deposit - settled',
      referenceId: deposit.id,
      referenceType: 'PLAID_SETTLEMENT',
      effectiveDate: deposit.createdAt, // original deposit value date
      metadata: { bucket: 'SETTLED_CASH', status: 'SETTLED' },
    },
    {
      type: 'CASH_DEPOSIT',
      amount: -deposit.amountCents,
      description: 'Settlement offset - clearing',
      referenceId: deposit.id,
      referenceType: 'PLAID_SETTLEMENT',
      effectiveDate: new Date(),
      metadata: { bucket: 'IN_TRANSIT', status: 'SETTLED' },
    },
  ]);

  const updated = await prisma.deposit.update({
    where: { id: depositId },
    data: { status: 'SETTLED', settledAt: new Date() },
  });
  logger.info('Deposit settled', { depositId });
  return updated;
}

/**
 * Bounce (ACH return) a pending deposit — reverses the pending journal so the
 * money never becomes available. Never edits existing rows.
 * Idempotent: bouncing a non-PENDING deposit is a no-op.
 */
export async function bounceDeposit(depositId: string, reason: string): Promise<Deposit> {
  const deposit = await prisma.deposit.findUnique({ where: { id: depositId } });
  if (!deposit) throw new Error('Deposit not found');
  if (deposit.status !== 'PENDING') {
    logger.info('bounceDeposit no-op (not pending)', { depositId, status: deposit.status });
    return deposit;
  }

  await createJournalEntry(deposit.accountId, [
    {
      type: 'CASH_DEPOSIT_RETURN',
      amount: -deposit.amountCents,
      description: `ACH return - ${reason}`,
      referenceId: deposit.id,
      referenceType: 'PLAID_RETURN',
      effectiveDate: new Date(),
      metadata: { bucket: 'IN_TRANSIT', reason, status: 'RETURNED' },
    },
    {
      type: 'CASH_DEPOSIT_RETURN',
      amount: deposit.amountCents,
      description: 'ACH return offset - external bank',
      referenceId: deposit.id,
      referenceType: 'PLAID_RETURN',
      effectiveDate: new Date(),
      metadata: { bucket: 'EXTERNAL', status: 'RETURNED' },
    },
  ]);

  const updated = await prisma.deposit.update({
    where: { id: depositId },
    data: { status: 'RETURNED', returnedAt: new Date(), returnReason: reason },
  });
  logger.warn(`Deposit returned (${reason})`, { depositId });
  return updated;
}

/** All deposits for an account, newest first. */
export async function listDeposits(accountId: string): Promise<Deposit[]> {
  return prisma.deposit.findMany({ where: { accountId }, orderBy: { createdAt: 'desc' } });
}

/** Available cash + pending deposits summary for an account. */
export async function getBalances(accountId: string): Promise<{
  cashBalanceCents: bigint;
  pendingDepositsCents: bigint;
  availableBalanceCents: bigint;
}> {
  const cashBalanceCents = await getCashBalance(accountId);
  const pending = await prisma.deposit.aggregate({
    where: { accountId, status: 'PENDING' },
    _sum: { amountCents: true },
  });
  const pendingDepositsCents = pending._sum.amountCents ?? 0n;
  return {
    cashBalanceCents,
    pendingDepositsCents,
    availableBalanceCents: cashBalanceCents, // pending is not available
  };
}

export const plaidService = {
  createLinkToken,
  exchangePublicToken,
  linkSandboxBank,
  getBankDetails,
  initiateDeposit,
  settleDeposit,
  bounceDeposit,
  listDeposits,
  getBalances,
};
export default plaidService;
