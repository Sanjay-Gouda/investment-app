import type { Request } from 'express';
import type { Role } from '@corgi/shared';

// Re-export the shared contract so backend code can import from one place.
export * from '@corgi/shared';

/** JWT claims carried in the auth token. */
export interface AuthTokenPayload {
  userId: string;
  email: string;
  role: Role;
  accountId: string;
}

/** An Express request after the auth middleware has attached the user. */
export interface AuthedRequest extends Request {
  user?: AuthTokenPayload;
}

/** Thrown by route/service code; mapped to an HTTP response by the error handler. */
export class HttpError extends Error {
  constructor(
    public statusCode: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}
