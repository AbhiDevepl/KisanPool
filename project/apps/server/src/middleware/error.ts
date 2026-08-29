import type { NextFunction, Request, Response } from 'express';
import mongoose from 'mongoose';
import { ZodError } from 'zod';
import { ApiError, fail } from '../lib/envelope';

export function notFoundHandler(_req: Request, res: Response): void {
  fail(res, new ApiError('RESOURCE_NOT_FOUND', 'No such endpoint.'));
}

/**
 * The single funnel every failure passes through. An unmapped throw becomes
 * EXTERNAL_SERVICE_ERROR rather than leaking a stack or an ad-hoc string.
 */
export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (err instanceof ApiError) {
    if (err.status >= 500) console.error('[error]', err.code, err.message, err.details ?? '');
    fail(res, err);
    return;
  }

  if (err instanceof ZodError) {
    const first = err.errors[0];
    const field = first?.path.join('.') || 'body';
    fail(res, new ApiError('VALIDATION_ERROR', `${field}: ${first?.message ?? 'invalid'}`));
    return;
  }

  // a malformed ObjectId is a missing resource, not a server fault
  if (err instanceof mongoose.Error.CastError) {
    fail(res, new ApiError('RESOURCE_NOT_FOUND', 'We could not find that.'));
    return;
  }

  if (err instanceof mongoose.Error.ValidationError) {
    const first = Object.values(err.errors)[0];
    fail(res, new ApiError('VALIDATION_ERROR', first?.message ?? 'Invalid data.'));
    return;
  }

  // unique index violation — the state already exists
  if ((err as { code?: number }).code === 11000) {
    fail(res, new ApiError('BOOKING_STATE_INVALID', 'That has already been recorded.'));
    return;
  }

  console.error('[error] unhandled', err);
  fail(res, new ApiError('EXTERNAL_SERVICE_ERROR', 'Something went wrong. Please try again.'));
}

/** Wraps async route handlers so a rejected promise reaches errorHandler. */
export function asyncHandler<T extends Request>(
  fn: (req: T, res: Response, next: NextFunction) => Promise<unknown>,
) {
  return (req: Request, res: Response, next: NextFunction): void => {
    void fn(req as T, res, next).catch(next);
  };
}
