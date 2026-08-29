/**
 * KisanPool — the complete error-code system.
 *
 * These 25 codes are the ONLY error codes in the project. The backend REST layer,
 * the Socket.io layer and the mobile app all import from this file — none of them
 * declares its own copy, and no call site emits an ad-hoc string.
 *
 * The list is closed. Adding a 26th code requires an ADR in docs/DECISIONS.md that
 * changes docs/API_CONTRACTS.md §5 first. See ADR-018.
 */

export const ERROR_CODES = [
  // Authentication (4)
  'AUTH_UNAUTHENTICATED',
  'AUTH_FORBIDDEN',
  'AUTH_OTP_INVALID',
  'AUTH_RATE_LIMITED',

  // KYC (3)
  'KYC_REQUIRED',
  'KYC_PENDING_REVIEW',
  'KYC_DOCUMENT_REJECTED',

  // Payments (6)
  'PAYMENT_FAILED',
  'PAYMENT_SIGNATURE_INVALID',
  'PAYMENT_NOT_CAPTURED',
  'PAYMENT_REFUND_NOT_ALLOWED',
  'PAYOUT_ACCOUNT_INACTIVE',
  'PAYOUT_TRANSFER_FAILED',

  // Concurrency (2)
  'CAPACITY_EXCEEDED',
  'CONCURRENT_BOOKING',

  // Transport (3)
  'NO_VEHICLE_AVAILABLE',
  'MATCH_EXPIRED',
  'POD_REQUIRED',

  // Booking (2)
  'BOOKING_STATE_INVALID',
  'BOOKING_ALREADY_RATED',

  // AI (2)
  'AI_INTENT_UNCLEAR',
  'AI_TOOL_ERROR',

  // Cross-cutting (3)
  'VALIDATION_ERROR',
  'RESOURCE_NOT_FOUND',
  'EXTERNAL_SERVICE_ERROR',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

/** HTTP status each code is returned with. AI_INTENT_UNCLEAR is a 200 carrying success:false — it is a conversational turn, not a transport failure. */
export const ERROR_HTTP_STATUS: Record<ErrorCode, number> = {
  AUTH_UNAUTHENTICATED: 401,
  AUTH_FORBIDDEN: 403,
  AUTH_OTP_INVALID: 400,
  AUTH_RATE_LIMITED: 429,

  KYC_REQUIRED: 403,
  KYC_PENDING_REVIEW: 403,
  KYC_DOCUMENT_REJECTED: 403,

  PAYMENT_FAILED: 402,
  PAYMENT_SIGNATURE_INVALID: 400,
  PAYMENT_NOT_CAPTURED: 409,
  PAYMENT_REFUND_NOT_ALLOWED: 409,
  PAYOUT_ACCOUNT_INACTIVE: 403,
  PAYOUT_TRANSFER_FAILED: 502,

  CAPACITY_EXCEEDED: 409,
  CONCURRENT_BOOKING: 409,

  NO_VEHICLE_AVAILABLE: 404,
  MATCH_EXPIRED: 409,
  POD_REQUIRED: 400,

  BOOKING_STATE_INVALID: 409,
  BOOKING_ALREADY_RATED: 409,

  AI_INTENT_UNCLEAR: 200,
  AI_TOOL_ERROR: 502,

  VALIDATION_ERROR: 400,
  RESOURCE_NOT_FOUND: 404,
  EXTERNAL_SERVICE_ERROR: 502,
};

/**
 * How the app must handle each code. One strategy per code, so error handling is
 * deterministic rather than per-screen improvisation:
 *
 *  - `show`     — render the message in place; the user decides what to do next
 *  - `retry`    — safe to retry, with backoff (bounded, never infinite)
 *  - `redirect` — the current screen cannot proceed; route somewhere that can
 *  - `disable`  — keep the screen, disable the action that failed
 *  - `refresh`  — refetch the resource and re-render from its true server state
 */
export type ErrorStrategy = 'show' | 'retry' | 'redirect' | 'disable' | 'refresh';

export const ERROR_STRATEGY: Record<ErrorCode, ErrorStrategy> = {
  AUTH_UNAUTHENTICATED: 'redirect',   // refresh once first, then (auth)/welcome
  AUTH_FORBIDDEN: 'redirect',
  AUTH_OTP_INVALID: 'show',
  AUTH_RATE_LIMITED: 'disable',       // with a countdown on "Resend OTP"

  KYC_REQUIRED: 'redirect',           // (auth)/kyc
  KYC_PENDING_REVIEW: 'disable',      // banner + disabled accept/availability
  KYC_DOCUMENT_REJECTED: 'redirect',  // (auth)/kyc, rejected doc highlighted

  PAYMENT_FAILED: 'retry',            // "Try again" without re-accepting the match
  PAYMENT_SIGNATURE_INVALID: 'show',  // never auto-retry; surface support contact
  PAYMENT_NOT_CAPTURED: 'retry',      // hold "Confirming…" pending payment:captured
  PAYMENT_REFUND_NOT_ALLOWED: 'disable',
  PAYOUT_ACCOUNT_INACTIVE: 'redirect',
  PAYOUT_TRANSFER_FAILED: 'show',     // "Payout pending" — server retries

  CAPACITY_EXCEEDED: 'refresh',       // back to the match list
  CONCURRENT_BOOKING: 'refresh',      // must also state the refund is in progress

  NO_VEHICLE_AVAILABLE: 'show',       // empty state; stay joined for match:new
  MATCH_EXPIRED: 'refresh',
  POD_REQUIRED: 'disable',            // until a photo is attached

  BOOKING_STATE_INVALID: 'refresh',
  BOOKING_ALREADY_RATED: 'disable',

  AI_INTENT_UNCLEAR: 'show',          // speak + display the follow-up question
  AI_TOOL_ERROR: 'show',              // close the voice session; never fabricate

  VALIDATION_ERROR: 'show',           // inline, on the offending field
  RESOURCE_NOT_FOUND: 'redirect',
  EXTERNAL_SERVICE_ERROR: 'retry',    // once, with backoff, then degrade
};

/** The response envelope from docs/API_CONTRACTS.md §1 — used for REST, webhooks and socket `error` events alike. */
export type ApiSuccess<T> = { success: true; data: T; requestId: string };
export type ApiFailure = {
  success: false;
  error: { code: ErrorCode; message: string };
  requestId: string;
};
export type ApiResponse<T> = ApiSuccess<T> | ApiFailure;

export function isErrorCode(value: unknown): value is ErrorCode {
  return typeof value === 'string' && (ERROR_CODES as readonly string[]).includes(value);
}
