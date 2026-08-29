/**
 * Predictive Insights — read-only, advisory (ADR-041, `docs/API_CONTRACTS.md` §9).
 *
 * Nothing here writes. Nothing here can be made to act on a trip, a price or a
 * transporter. `/simulate` runs the pure engine on a caller-supplied signal
 * payload so the behaviour can be pinned in tests without staging real trips.
 */
import { Router } from 'express';
import { z } from 'zod';
import { ok } from '../../lib/envelope';
import { asyncHandler } from '../../middleware/error';
import { requireAuth, requireAdmin, type AuthedRequest } from '../../middleware/auth';
import { ApiError } from '../../lib/envelope';
import { Trip, TripShipment } from '../../models';
import { assessDemand, assessOps, assessTrip } from './service';
import {
  scoreCancellationRisk,
  scoreDelayRisk,
  scoreDemand,
  type CancellationSignals,
  type DelaySignals,
  type DemandSignals,
} from './engine';

export const predictionsRouter = Router();

async function assertTripViewer(tripId: string, userId: string): Promise<{ isTransporter: boolean }> {
  const trip = await Trip.findById(tripId);
  if (!trip) throw new ApiError('RESOURCE_NOT_FOUND', 'That trip no longer exists.');
  const isTransporter = String(trip.transporterId) === userId;
  if (isTransporter) return { isTransporter };
  const aboard = await TripShipment.exists({ tripId: trip._id, farmerId: userId });
  if (!aboard) throw new ApiError('AUTH_FORBIDDEN', "You don't have access to this trip.");
  return { isTransporter: false };
}

/**
 * The delay/cancellation call for one trip.
 *
 * Cancellation risk is only returned to the trip's transporter — a farmer is
 * shown delivery risk alone (brief §7). Admin reads the full picture at
 * `/predictions/ops`.
 */
predictionsRouter.get(
  '/trips/:id',
  requireAuth,
  asyncHandler<AuthedRequest>(async (req, res) => {
    const { isTransporter } = await assertTripViewer(req.params.id, req.userId);
    ok(res, await assessTrip(req.params.id, { includeCancellation: isTransporter }));
  }),
);

/** High-demand corridors — any signed-in user (a transporter deciding where to go). */
predictionsRouter.get(
  '/demand',
  requireAuth,
  asyncHandler<AuthedRequest>(async (_req, res) => {
    ok(res, await assessDemand());
  }),
);

/** The operator roll-up — at-risk live trips plus the demand board. */
predictionsRouter.get(
  '/ops',
  requireAdmin,
  asyncHandler(async (_req, res) => {
    ok(res, await assessOps());
  }),
);

// ---------------------------------------------------------------------------
// deterministic engine check — admin only, no database read
// ---------------------------------------------------------------------------

const delaySchema = z.object({
  tripState: z.string(),
  routeKm: z.number(),
  pickupCount: z.number().int().min(0),
  pickupsDone: z.number().int().min(0),
  delivered: z.number().int().min(0),
  minutesSinceStart: z.number(),
  etaMinutes: z.number().nullable().default(null),
  minutesSinceLastPing: z.number().nullable().default(null),
  leadShipmentStuckMinutes: z.number().min(0).default(0),
  pickupOverdueMinutes: z.number().min(0).default(0),
});

const cancellationSchema = z.object({
  tripState: z.string(),
  completedTrips: z.number().int().min(0),
  cancelledTrips: z.number().int().min(0),
  offersMade: z.number().int().min(0),
  offersWithdrawn: z.number().int().min(0),
  minutesSinceFirstConfirm: z.number().min(0),
  vehicleOffline: z.boolean(),
  minutesSinceLastPing: z.number().nullable().default(null),
  pickupOverdueMinutes: z.number().min(0).default(0),
});

const demandSchema = z.object({
  mandi: z.string(),
  recentRequests: z.number().int().min(0),
  windowDays: z.number().int().min(1),
  openRequests: z.number().int().min(0),
  activeTrips: z.number().int().min(0),
  historicalTrips: z.number().int().min(0),
  distinctFarmers: z.number().int().min(0),
});

predictionsRouter.post(
  '/simulate',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const body = z
      .object({
        kind: z.enum(['DELIVERY_DELAY', 'CANCELLATION', 'DEMAND']),
        signals: z.record(z.string(), z.unknown()),
      })
      .parse(req.body);

    const computedAt = new Date().toISOString();
    if (body.kind === 'DELIVERY_DELAY') {
      const s = delaySchema.parse(body.signals) as DelaySignals;
      return ok(res, scoreDelayRisk(s, computedAt));
    }
    if (body.kind === 'CANCELLATION') {
      const s = cancellationSchema.parse(body.signals) as CancellationSignals;
      return ok(res, scoreCancellationRisk(s, computedAt));
    }
    const s = demandSchema.parse(body.signals) as DemandSignals;
    return ok(res, scoreDemand(s, computedAt));
  }),
);
