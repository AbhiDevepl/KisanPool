import { randomUUID } from 'crypto';
import type { Request, Response } from 'express';
import { ERROR_HTTP_STATUS, type ErrorCode } from '@kisanpool/shared';

/**
 * The only way a failure leaves this server (docs/API_CONTRACTS.md §1, §5).
 * Every throw site uses ApiError with one of the 25 shared codes — no ad-hoc strings.
 */
export class ApiError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details?: unknown;

  constructor(code: ErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = ERROR_HTTP_STATUS[code];
    this.details = details;
  }
}

export function requestIdOf(req: Request): string {
  return (req as Request & { requestId?: string }).requestId ?? `req_${randomUUID()}`;
}

export function ok<T>(res: Response, data: T, status = 200): Response {
  return res.status(status).json({
    success: true,
    data,
    requestId: requestIdOf(res.req),
  });
}

export function fail(res: Response, error: ApiError): Response {
  return res.status(error.status).json({
    success: false,
    error: { code: error.code, message: error.message },
    requestId: requestIdOf(res.req),
  });
}

/** Same envelope for socket `error` events (docs/API_CONTRACTS.md §5 rule 3). */
export function socketError(error: ApiError) {
  return {
    success: false as const,
    error: { code: error.code, message: error.message },
    requestId: `req_${randomUUID()}`,
  };
}
