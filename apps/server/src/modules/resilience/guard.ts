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
import type { JournalEventType } from '@kisanpool/shared';
import { ApiError } from '../../lib/envelope';
import type { AuthedRequest } from '../../middleware/auth';
import { recoveryState, writesRestricted } from './health';
import { operationKey, recordIntent } from './journal';

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
  next(refusal());
}

function refusal(): ApiError {
  return new ApiError(
    'EXTERNAL_SERVICE_ERROR',
    recoveryState() === 'RECONCILING'
      ? 'We are finishing a recovery and re-checking recent activity. Please try again in a moment — nothing has been lost.'
      : 'The system is recovering and cannot confirm new bookings or payments right now. Please try again shortly — nothing you have already done is affected.',
  );
}

// ---------------------------------------------------------------------------
// deferral — the difference between "refused" and "lost"
// ---------------------------------------------------------------------------

/**
 * What a route promises to journal if it cannot be committed right now.
 *
 * `entityId` must be MINTED BY THE ROUTE for a creation, because it is both the
 * identity the replay will create and the idempotency anchor: replaying the same
 * entry twice writes the same `_id` twice, and the primary key refuses the
 * second. That is what makes replay safe without a second bookkeeping table.
 */
export interface DeferredIntent {
  eventType: JournalEventType;
  entityType: string;
  entityId: string;
  discriminator?: string;
  payload: Record<string, unknown>;
}

/**
 * Accept a critical operation into the durable journal when the authoritative
 * store cannot take it, instead of refusing it into thin air (ADR-045).
 *
 * THE BUG THIS FIXES
 * ------------------
 * `requireWritable` ran as middleware AHEAD of the handler, so during an outage
 * the service — and therefore its `recordIntent` call — never executed. The
 * pending queue stayed empty for the whole incident, which meant
 * `replayPending()` always found nothing and every applier in recovery.ts was
 * unreachable code. The operation did not just fail; it left no trace that it had
 * ever been attempted.
 *
 * WHAT IS AND IS NOT DEFERRED
 * ---------------------------
 * Only operations whose every non-secret input is present in the request itself,
 * and which have a replay applier that re-drives the REAL business service with
 * its own validation. Anything that has to read the database to know whether it
 * is even legal (a state transition, a capacity check, an OTP) cannot be
 * validated during an outage and is still refused — journalling an intent we
 * could not validate would be a promise we have no right to make.
 *
 * Money is never deferred. A payment order stays on `requireWritable`.
 *
 * THE RESPONSE IS STILL A FAILURE
 * -------------------------------
 * Deliberately. The operation is preserved, not performed: no capacity is
 * reserved, no price is fixed and nothing is confirmed. So it returns the same
 * `EXTERNAL_SERVICE_ERROR` envelope any client already handles — with a message
 * that says, truthfully, that it was saved and carries the reference to prove it.
 */
export function deferrable(plan: (req: AuthedRequest) => DeferredIntent) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!writesRestricted()) {
      next();
      return;
    }

    void (async () => {
      try {
        const intent = plan(req as AuthedRequest);
        const event = await recordIntent({
          eventType: intent.eventType,
          entityType: intent.entityType,
          entityId: intent.entityId,
          actorId: (req as AuthedRequest).userId ?? null,
          operationKey: operationKey(intent.eventType, intent.entityId, intent.discriminator),
          payload: intent.payload,
        });

        // no durable record => no promise. Refuse exactly as before.
        if (!event) {
          next(refusal());
          return;
        }

        next(
          new ApiError(
            'EXTERNAL_SERVICE_ERROR',
            `The system is recovering, so this could not be confirmed yet. We have safely saved it (reference ${event.eventId.slice(0, 8)}) and it will be completed automatically once recovery finishes. Nothing has been lost.`,
          ),
        );
      } catch (err) {
        // a body that does not even validate is not something to journal
        next(err);
      }
    })();
  };
}
