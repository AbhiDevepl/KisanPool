import { ERROR_STRATEGY, isErrorCode, type ErrorCode, type ErrorStrategy } from '@kisanpool/shared';

/**
 * Every failure the app sees is one of the 25 shared codes (ADR-018). Screens
 * branch on `code`; they never parse `message`.
 */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly strategy: ErrorStrategy;

  constructor(code: ErrorCode, message: string) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.strategy = ERROR_STRATEGY[code];
  }
}

export function toAppError(err: unknown): AppError {
  if (err instanceof AppError) return err;
  if (err instanceof Error && isErrorCode((err as AppError).code)) {
    return new AppError((err as AppError).code, err.message);
  }
  // a dropped connection is an upstream failure with no domain meaning
  return new AppError(
    'EXTERNAL_SERVICE_ERROR',
    'We could not reach KisanPool. Please check your connection.',
  );
}

export const strategyOf = (err: unknown): ErrorStrategy => toAppError(err).strategy;

/** True when it is safe to offer a "Try again" button for this failure. */
export const isRetryable = (err: unknown): boolean => strategyOf(err) === 'retry';
