import type { Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { prisma } from '../lib/prisma';
import { HttpError, type AuthedRequest, type AuthTokenPayload, type Role } from '../types';

/**
 * Verify the Bearer JWT and attach { userId, email, role, accountId } to
 * req.user. Rejects with 401 when the header is missing/malformed or the token
 * is invalid or expired.
 */
export function authenticate(
  req: AuthedRequest,
  _res: Response,
  next: NextFunction,
): void {
  const header = req.header('authorization') || req.header('Authorization');
  if (!header || !header.startsWith('Bearer ')) {
    throw new HttpError(401, 'UNAUTHORIZED', 'Missing or malformed Authorization header');
  }
  const token = header.slice('Bearer '.length).trim();

  const secret = process.env.JWT_SECRET;
  if (!secret) throw new HttpError(500, 'CONFIG_ERROR', 'JWT_SECRET is not configured');

  try {
    const decoded = jwt.verify(token, secret) as AuthTokenPayload;
    req.user = {
      userId: decoded.userId,
      email: decoded.email,
      role: decoded.role,
      accountId: decoded.accountId,
    };
    next();
  } catch {
    throw new HttpError(401, 'UNAUTHORIZED', 'Invalid or expired token');
  }
}

/**
 * Role guard. Must run after `authenticate`. Returns 403 if the authenticated
 * user's role is not among the allowed roles.
 */
export function requireRole(...roles: Role[]) {
  return (req: AuthedRequest, _res: Response, next: NextFunction): void => {
    if (!req.user) {
      throw new HttpError(401, 'UNAUTHORIZED', 'Authentication required');
    }
    if (!roles.includes(req.user.role)) {
      throw new HttpError(403, 'FORBIDDEN', 'Insufficient role');
    }
    next();
  };
}

/**
 * KYC gate. Must run after `authenticate`. Blocks actions (e.g. deposits,
 * trades) until the account's KYC is APPROVED.
 */
export async function requireKYC(
  req: AuthedRequest,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  if (!req.user) {
    throw new HttpError(401, 'UNAUTHORIZED', 'Authentication required');
  }
  const account = await prisma.account.findUnique({ where: { id: req.user.accountId } });
  if (!account || account.kycStatus !== 'APPROVED') {
    throw new HttpError(
      403,
      'KYC_REQUIRED',
      'KYC verification required before you can perform this action',
    );
  }
  next();
}
