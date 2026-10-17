import type { Request, Response, NextFunction } from 'express';
import { ZodError, type ZodSchema } from 'zod';
import { HttpError } from '../types';

type RequestPart = 'body' | 'query' | 'params';

/**
 * Validate a request part against a Zod schema. On success the parsed value
 * replaces the raw one so downstream handlers get typed, coerced data.
 */
export function validate(schema: ZodSchema, part: RequestPart = 'body') {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req[part]);
    if (!result.success) {
      next(zodToHttpError(result.error));
      return;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (req as any)[part] = result.data;
    next();
  };
}

function zodToHttpError(error: ZodError): HttpError {
  return new HttpError(
    400,
    'VALIDATION_ERROR',
    'Request validation failed',
    error.flatten(),
  );
}
