import { Router, type Response } from 'express';
import { z } from 'zod';
import { validate } from '../middleware/validate.middleware';
import { authenticate } from '../middleware/auth.middleware';
import { HttpError, type AuthedRequest } from '../types';
import { register, login, getMe, signToken } from '../services/auth.service';

/**
 * Auth routes: register, login, me.
 * passwordHash is never included in any response (the service strips it).
 */
export const authRouter = Router();

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  fullName: z.string().min(2, 'Full name must be at least 2 characters'),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

// POST /auth/register -> { token, user, account }
authRouter.post('/register', validate(registerSchema), async (req: AuthedRequest, res: Response) => {
  try {
    const { user, account } = await register(req.body);
    const token = signToken({
      userId: user.id,
      email: user.email,
      role: user.role,
      accountId: account.id,
    });
    res.status(201).json({ token, user, account });
  } catch (err) {
    if (err instanceof Error && err.message === 'Email already registered') {
      throw new HttpError(409, 'EMAIL_TAKEN', err.message);
    }
    throw err;
  }
});

// POST /auth/login -> { token, user, account }
authRouter.post('/login', validate(loginSchema), async (req: AuthedRequest, res: Response) => {
  try {
    const result = await login(req.body);
    res.json(result);
  } catch (err) {
    if (err instanceof Error && err.message === 'Invalid credentials') {
      throw new HttpError(401, 'INVALID_CREDENTIALS', err.message);
    }
    throw err;
  }
});

// GET /auth/me -> { user, account }
authRouter.get('/me', authenticate, async (req: AuthedRequest, res: Response) => {
  const { user, account } = await getMe(req.user!.userId);
  res.json({ user, account });
});

export default authRouter;
