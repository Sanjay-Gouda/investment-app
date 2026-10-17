import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import type { Account, User } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';
import type { AuthTokenPayload } from '../types';

/**
 * Auth service — registration, login, and the current-user lookup.
 *
 * Security rules:
 *  - Passwords are bcrypt-hashed (12 rounds). The plaintext never persists.
 *  - passwordHash is NEVER returned to callers — we always strip it.
 *  - JWTs are signed with process.env.JWT_SECRET.
 */

const BCRYPT_ROUNDS = 12;

/** A User with its passwordHash removed — the only shape we expose. */
export type SafeUser = Omit<User, 'passwordHash'>;

/** Strip the password hash before a user object leaves the service. */
function toSafeUser(user: User): SafeUser {
  const { passwordHash: _omit, ...safe } = user;
  return safe;
}

/** Sign a JWT carrying { userId, email, role, accountId }. */
export function signToken(payload: AuthTokenPayload): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET is not configured');
  const expiresIn = process.env.JWT_EXPIRES_IN || '7d';
  return jwt.sign(payload, secret, { expiresIn } as jwt.SignOptions);
}

/**
 * Register a new investor: creates the User (hashed password) and its Account
 * in PENDING / INACTIVE state. The account can't transact until KYC approves.
 *
 * @throws "Email already registered" if the email is taken.
 */
export async function register(params: {
  email: string;
  password: string;
  fullName: string;
}): Promise<{ user: SafeUser; account: Account }> {
  const email = params.email.toLowerCase().trim();

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    throw new Error('Email already registered');
  }

  const passwordHash = await bcrypt.hash(params.password, BCRYPT_ROUNDS);

  const user = await prisma.user.create({
    data: {
      email,
      passwordHash,
      fullName: params.fullName,
      role: 'INVESTOR',
      account: { create: { kycStatus: 'PENDING', status: 'INACTIVE' } },
    },
    include: { account: true },
  });

  logger.info('User registered', { userId: user.id, email });
  return { user: toSafeUser(user), account: user.account! };
}

/**
 * Log in with email + password. Returns a signed JWT plus the safe user and
 * account. Uses a single generic error for both unknown-email and wrong-password
 * so we don't leak which emails exist.
 *
 * @throws "Invalid credentials" on any mismatch.
 */
export async function login(params: {
  email: string;
  password: string;
}): Promise<{ token: string; user: SafeUser; account: Account }> {
  const email = params.email.toLowerCase().trim();

  const user = await prisma.user.findUnique({ where: { email }, include: { account: true } });
  if (!user || !user.account) {
    throw new Error('Invalid credentials');
  }

  const ok = await bcrypt.compare(params.password, user.passwordHash);
  if (!ok) {
    throw new Error('Invalid credentials');
  }

  const token = signToken({
    userId: user.id,
    email: user.email,
    role: user.role,
    accountId: user.account.id,
  });

  logger.info('User logged in', { userId: user.id, email });
  return { token, user: toSafeUser(user), account: user.account };
}

/** Current user + account for an authenticated userId (no passwordHash). */
export async function getMe(userId: string): Promise<{ user: SafeUser; account: Account | null }> {
  const user = await prisma.user.findUnique({ where: { id: userId }, include: { account: true } });
  if (!user) throw new Error('User not found');
  return { user: toSafeUser(user), account: user.account };
}

export const authService = { register, login, getMe, signToken };
export default authService;
