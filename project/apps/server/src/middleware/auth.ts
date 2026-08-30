import type { NextFunction, Request, Response } from 'express';
import { ApiError } from '../lib/envelope';
import { verifyAccessToken } from '../lib/jwt';
import type { Role } from '@kisanpool/shared';

export interface AuthedRequest extends Request {
  userId: string;
  role: Role;
  isAdmin: boolean;
}

/**
 * The authenticated user id always comes from the token — never from a body field
 * and never from speech (docs/ARCHITECTURE.md §5).
 */
export function requireAuth(req: Request, _res: Response, next: NextFunction): void {
  const header = req.headers.authorization ?? '';
  const [scheme, token] = header.split(' ');

  if (scheme !== 'Bearer' || !token) {
    next(new ApiError('AUTH_UNAUTHENTICATED', 'Please sign in to continue.'));
    return;
  }

  try {
    const payload = verifyAccessToken(token);
    const authed = req as AuthedRequest;
    authed.userId = payload.sub;
    authed.role = payload.role;
    authed.isAdmin = payload.admin === true;
    next();
  } catch (err) {
    next(err);
  }
}

/**
 * Operator-only routes. Checks the `admin` claim, never a User.role — a marketplace
 * account can never reach these however it was obtained.
 */
export function requireAdmin(req: Request, _res: Response, next: NextFunction): void {
  const header = req.headers.authorization ?? '';
  const [scheme, token] = header.split(' ');

  if (scheme !== 'Bearer' || !token) {
    next(new ApiError('AUTH_UNAUTHENTICATED', 'Sign in to the admin console to continue.'));
    return;
  }

  try {
    const payload = verifyAccessToken(token);
    if (payload.admin !== true) {
      next(new ApiError('AUTH_FORBIDDEN', 'This action is only available to an operator.'));
      return;
    }
    (req as AuthedRequest).userId = payload.sub;
    next();
  } catch (err) {
    next(err);
  }
}

export function requireRole(role: Role) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if ((req as AuthedRequest).role !== role) {
      next(new ApiError('AUTH_FORBIDDEN', `This action is only available to a ${role.toLowerCase()}.`));
      return;
    }
    next();
  };
}
