import Stripe from 'stripe';
import type { Account } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';

/**
 * KYC service — identity verification via Stripe Identity.
 *
 * A user registers PENDING and cannot deposit/invest until an identity check
 * approves them. Stripe runs the actual verification; we react to its webhooks
 * and persist kycStatus + account status. A sandbox-only simulate path lets us
 * test the whole downstream flow without the Stripe UI.
 */

/** Lazily construct the Stripe client so a missing key only fails on use. */
function getStripe(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error('STRIPE_SECRET_KEY is not configured');
  return new Stripe(key);
}

/**
 * Create a Stripe Identity VerificationSession for an account and persist the
 * session id. Returns the client secret the frontend uses to open the modal.
 */
export async function createVerificationSession(params: {
  accountId: string;
  userId: string;
}): Promise<{ clientSecret: string | null; sessionId: string }> {
  const stripe = getStripe();

  const session = await stripe.identity.verificationSessions.create({
    type: 'document',
    metadata: { accountId: params.accountId, userId: params.userId },
    options: {
      document: {
        allowed_types: ['driving_license', 'passport'],
        require_matching_selfie: true,
      },
    },
  });

  await prisma.account.update({
    where: { id: params.accountId },
    data: { stripeVerificationSessionId: session.id, kycStatus: 'PENDING' },
  });

  logger.info('Stripe Identity session created', {
    accountId: params.accountId,
    sessionId: session.id,
  });

  return { clientSecret: session.client_secret, sessionId: session.id };
}

/**
 * Verify and process an inbound Stripe webhook. Signature verification is
 * mandatory — a bad signature throws (the route maps it to 400).
 */
export async function handleWebhook(
  payload: Buffer,
  signature: string,
): Promise<{ received: true }> {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) throw new Error('STRIPE_WEBHOOK_SECRET is not configured');

  const stripe = getStripe();
  const event = stripe.webhooks.constructEvent(payload, signature, secret);

  const session = event.data.object as Stripe.Identity.VerificationSession;
  const accountId = session.metadata?.accountId;

  switch (event.type) {
    case 'identity.verification_session.verified': {
      if (accountId) {
        await prisma.account.update({
          where: { id: accountId },
          data: { kycStatus: 'APPROVED', status: 'ACTIVE' },
        });
        logger.info(`KYC approved for account ${accountId}`);
      }
      break;
    }
    case 'identity.verification_session.requires_input': {
      if (accountId) {
        await prisma.account.update({ where: { id: accountId }, data: { kycStatus: 'PENDING' } });
        logger.warn('KYC requires input', {
          accountId,
          reason: session.last_error?.reason ?? 'unknown',
        });
      }
      break;
    }
    case 'identity.verification_session.canceled': {
      if (accountId) {
        await prisma.account.update({ where: { id: accountId }, data: { kycStatus: 'REJECTED' } });
        logger.info(`KYC rejected for account ${accountId}`);
      }
      break;
    }
    default:
      logger.debug('Unhandled Stripe event', { type: event.type });
  }

  return { received: true };
}

/** Current KYC status for an account, plus whether it can transact. */
export async function getKYCStatus(accountId: string): Promise<{
  kycStatus: Account['kycStatus'];
  accountStatus: Account['status'];
  canTransact: boolean;
}> {
  const account = await prisma.account.findUnique({ where: { id: accountId } });
  if (!account) throw new Error('Account not found');
  return {
    kycStatus: account.kycStatus,
    accountStatus: account.status,
    canTransact: account.kycStatus === 'APPROVED',
  };
}

/**
 * SANDBOX ONLY — approve KYC without the Stripe UI, for testing the downstream
 * flow. Refuses to run in production.
 */
export async function simulateKYCApproval(accountId: string): Promise<Account> {
  const env = process.env.NODE_ENV;
  if (env !== 'development' && env !== 'test') {
    throw new Error('simulateKYCApproval is only available in development/test');
  }

  const account = await prisma.account.update({
    where: { id: accountId },
    data: { kycStatus: 'APPROVED', status: 'ACTIVE' },
  });

  // A zero-amount ledger note recording the simulated approval (audit trail).
  await prisma.ledgerEntry.create({
    data: {
      accountId,
      type: 'FEE',
      amount: 0n,
      description: 'KYC approved (simulated, sandbox)',
      effectiveDate: new Date(),
      metadata: { event: 'kyc_simulated_approval' },
    },
  });

  logger.info(`KYC approved for account ${accountId} (simulated)`);
  return account;
}

export const kycService = {
  createVerificationSession,
  handleWebhook,
  getKYCStatus,
  simulateKYCApproval,
};
export default kycService;
