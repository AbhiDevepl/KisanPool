/**
 * The safe-mode guard (ADR-044, §9).
 *
 * THE RULE IT ENFORCES
 * --------------------
 * While the authoritative store cannot confirm a write, an irreversible business
 * action must be REFUSED — clearly, early, and with a reason — rather than
 * half-accepted and reported as done.
 *
 * The failure mode this prevents is the seductive one: the database is down, the
 * request looks fine, a continuity layer happily records it, and the farmer is
 * told their booking is confirmed. It is not confirmed. Nobody has reserved the
 * capacity, no money has moved, and the truck may already be full. Telling
 * someone their produce is on a lorry when it is not is worse than telling them
 * to try again in a minute.
 *
 * So: reads keep working from snapshots, writes that cannot be made authoritative
 * are declined. The pending INTENT is still journalled by the services themselves,
 * so nothing is lost — but nothing is promised either.
 *
 * The code returned is `EXTERNAL_SERVICE_ERROR` (502), which the closed error set
 * already defines as "an upstream we depend on failed" with a retry-then-degrade
 * client behaviour. That is exactly this situation, so no 26th code is invented
 * (docs/API_CONTRACTS.md §5).
 */
import type { NextFunction, Request, Response } from 'express';
import { ApiError } from '../../lib/envelope';
import { recoveryState, writesRestricted } from './health';

/**
 * Refuse irreversible mutations while the system cannot commit them.
 *
 * Applied to the routes that reserve capacity, move money or advance a trip —
 * not to reads, and not to the payment provider's webhook, which must be allowed
 * to fail naturally so the provider retries it.
 */
export function requireWritable(_req: Request, _res: Response, next: NextFunction): void {
  if (!writesRestricted()) {
    next();
    return;
  }

  next(
    new ApiError(
      'EXTERNAL_SERVICE_ERROR',
      recoveryState() === 'RECONCILING'
        ? 'We are finishing a recovery and re-checking recent activity. Please try again in a moment — nothing has been lost.'
        : 'The system is recovering and cannot confirm new bookings or payments right now. Please try again shortly — nothing you have already done is affected.',
    ),
  );
}
