import { Router } from 'express';
import { z } from 'zod';
import { ApiError, ok } from '../../lib/envelope';
import { asyncHandler } from '../../middleware/error';
import { requireAuth, requireRole, type AuthedRequest } from '../../middleware/auth';
import {
  BACKHAUL_BOOKING_STATES,
  CARGO_CATEGORIES,
  CARGO_RULES,
  RETURN_LEG_STATES,
} from '@kisanpool/shared';
import { BackhaulBooking, BackhaulRequest, Trip, User } from '../../models';
import {
  acceptBackhaul,
  advanceBackhaul,
  advanceReturnLeg,
  backhaulMatchesFor,
  openReturnLeg,
  returnCapacityOf,
  tripUtilisation,
} from './service';
import { emitBackhaulBooked, emitBackhaulState, emitReturnLegState } from '../realtime';
import { notifyBackhaulBooked } from '../notifications/service';
import { requireWritable } from '../resilience/guard';

export const backhaulRouter = Router();

const geoPoint = z.object({ name: z.string().min(1), lat: z.number(), lng: z.number() });

/**
 * The Backhaul Network (ADR-039).
 *
 * Posting a return load needs no role: a farmer sending crates home and a
 * shopkeeper sending stock out are the same operation, and requiring a third role
 * would have meant reopening ADR-002 for no gain. Taking one is TRANSPORTER-only,
 * because it consumes a vehicle.
 */

// ---------------------------------------------------------------------------
// what may be carried — configuration the app renders, the server enforces
// ---------------------------------------------------------------------------

backhaulRouter.get(
  '/cargo-categories',
  requireAuth,
  asyncHandler<AuthedRequest>(async (_req, res) => {
    ok(
      res,
      CARGO_CATEGORIES.map((key) => ({
        key,
        ...CARGO_RULES[key],
      })),
    );
  }),
);

// ---------------------------------------------------------------------------
// the requester's side — anyone with goods to send
// ---------------------------------------------------------------------------

const createSchema = z
  .object({
    cargoCategory: z.enum(CARGO_CATEGORIES),
    description: z.string().min(3).max(140),
    weightKg: z.number().positive(),
    pickup: geoPoint,
    destination: geoPoint,
    readyFrom: z.coerce.date(),
    readyUntil: z.coerce.date(),
    offeredPrice: z.number().min(0).optional(),
    notes: z.string().max(300).optional(),
  })
  .refine((v) => v.readyUntil > v.readyFrom, {
    message: 'readyUntil: must be after readyFrom',
  });

backhaulRouter.post(
  '/requests',
  requireAuth,
  asyncHandler<AuthedRequest>(async (req, res) => {
    const body = createSchema.parse(req.body);

    // the weight ceiling is part of the cargo rule, so it is checked here rather
    // than only when a driver happens to look at it
    const rule = CARGO_RULES[body.cargoCategory];
    if (body.weightKg > rule.maxWeightKg) {
      throw new ApiError(
        'VALIDATION_ERROR',
        `weightKg: ${rule.label} is limited to ${rule.maxWeightKg} kg on this platform.`,
      );
    }

    const request = await BackhaulRequest.create({ ...body, requesterId: req.userId, state: 'OPEN' });
    ok(res, request, 201);
  }),
);

/** MUST stay above `/requests/:id` — ADR-036. */
backhaulRouter.get(
  '/requests/mine',
  requireAuth,
  asyncHandler<AuthedRequest>(async (req, res) => {
    const requests = await BackhaulRequest.find({ requesterId: req.userId })
      .sort({ createdAt: -1 })
      .limit(50);

    const bookings = await BackhaulBooking.find({
      requestId: { $in: requests.map((r) => r._id) },
    });
    const byRequest = new Map(bookings.map((b) => [String(b.requestId), b]));
    const drivers = await User.find({ _id: { $in: bookings.map((b) => b.transporterId) } });
    const driverById = new Map(drivers.map((u) => [String(u._id), u]));

    ok(
      res,
      requests.map((request) => {
        const booking = byRequest.get(String(request._id));
        const driver = booking ? driverById.get(String(booking.transporterId)) : null;
        return {
          ...request.toJSON(),
          booking: booking && {
            _id: String(booking._id),
            tripId: String(booking.tripId),
            state: booking.state,
            price: booking.price,
            // the requester reads this out when the driver arrives
            pickupOtp: booking.pickupOtp,
            transporter: driver && {
              _id: String(driver._id),
              name: driver.name,
              // exchanged only once a driver has actually taken the load
              phone: driver.phone,
              ratingAvg: driver.ratingAvg,
            },
          },
        };
      }),
    );
  }),
);

backhaulRouter.post(
  '/requests/:id/cancel',
  requireAuth,
  asyncHandler<AuthedRequest>(async (req, res) => {
    const request = await BackhaulRequest.findById(req.params.id);
    if (!request) throw new ApiError('RESOURCE_NOT_FOUND', 'That return load no longer exists.');
    if (String(request.requesterId) !== req.userId) {
      throw new ApiError('AUTH_FORBIDDEN', "That return load isn't yours.");
    }
    if (request.state === 'DELIVERED') {
      throw new ApiError('BOOKING_STATE_INVALID', 'That load has already been delivered.');
    }

    const booking = await BackhaulBooking.findOne({ requestId: request._id });
    if (booking && booking.state !== 'BOOKED') {
      throw new ApiError(
        'BOOKING_STATE_INVALID',
        'That load is already on a vehicle. Please contact the driver.',
      );
    }
    if (booking) {
      booking.state = 'CANCELLED';
      booking.cancelledAt = new Date();
      await booking.save();
    }

    request.state = 'CANCELLED';
    request.cancelledAt = new Date();
    await request.save();
    ok(res, { request, booking });
  }),
);

// ---------------------------------------------------------------------------
// the driver's side
// ---------------------------------------------------------------------------

backhaulRouter.post(
  '/trips/:id/return-leg/open',
  requireAuth,
  requireRole('TRANSPORTER'),
  asyncHandler<AuthedRequest>(async (req, res) => {
    const trip = await openReturnLeg(req.params.id, req.userId);
    emitReturnLegState({
      tripId: String(trip._id),
      state: trip.returnLeg.state,
      at: new Date().toISOString(),
    });
    ok(res, { trip, capacity: await returnCapacityOf(trip) }, 201);
  }),
);

/** Compatible return loads, ranked. Every input to the ranking is in the payload. */
backhaulRouter.get(
  '/trips/:id/return-loads',
  requireAuth,
  requireRole('TRANSPORTER'),
  asyncHandler<AuthedRequest>(async (req, res) => {
    ok(res, await backhaulMatchesFor(req.params.id, req.userId));
  }),
);

backhaulRouter.post(
  '/trips/:id/return-loads/:requestId/accept',
  requireAuth,
  requireRole('TRANSPORTER'),
  // reserves return-leg capacity — an irreversible reservation (ADR-044),
  // exactly like machinery's requestBooking and pooling's selectTransporter
  requireWritable,
  asyncHandler<AuthedRequest>(async (req, res) => {
    const { booking, trip, quote } = await acceptBackhaul(
      req.params.id,
      req.params.requestId,
      req.userId,
    );

    emitBackhaulBooked({
      tripId: String(trip._id),
      requestId: String(booking.requestId),
      bookingId: String(booking._id),
      requesterId: String(booking.requesterId),
      transporterId: req.userId,
    });
    const driver = await User.findById(req.userId);
    await notifyBackhaulBooked(
      String(booking.requesterId),
      String(booking._id),
      driver?.name || 'A transporter',
    );

    ok(res, { booking, quote, capacity: await returnCapacityOf(trip) }, 201);
  }),
);

/** Everything on this trip's return leg, plus the round-trip economics. */
backhaulRouter.get(
  '/trips/:id/return-leg',
  requireAuth,
  requireRole('TRANSPORTER'),
  asyncHandler<AuthedRequest>(async (req, res) => {
    const trip = await Trip.findById(req.params.id);
    if (!trip) throw new ApiError('RESOURCE_NOT_FOUND', 'That trip no longer exists.');
    if (String(trip.transporterId) !== req.userId) {
      throw new ApiError('AUTH_FORBIDDEN', 'That trip is not yours.');
    }

    const bookings = await BackhaulBooking.find({ tripId: trip._id, state: { $ne: 'CANCELLED' } })
      .sort({ createdAt: 1 });
    const requesters = await User.find({ _id: { $in: bookings.map((b) => b.requesterId) } });
    const byId = new Map(requesters.map((u) => [String(u._id), u]));

    ok(res, {
      returnLeg: trip.returnLeg,
      capacity: await returnCapacityOf(trip),
      utilisation: await tripUtilisation(String(trip._id)),
      bookings: bookings.map((b) => ({
        ...b.toJSON(),
        // the driver never sees the collection code; the requester reads it out
        pickupOtp: undefined,
        requester: (() => {
          const u = byId.get(String(b.requesterId));
          return u && { _id: String(u._id), name: u.name, phone: u.phone, ratingAvg: u.ratingAvg };
        })(),
      })),
    });
  }),
);

backhaulRouter.patch(
  '/bookings/:id/state',
  requireAuth,
  requireRole('TRANSPORTER'),
  asyncHandler<AuthedRequest>(async (req, res) => {
    const body = z
      .object({ state: z.enum(BACKHAUL_BOOKING_STATES), otp: z.string().optional() })
      .parse(req.body);

    const { booking, trip } = await advanceBackhaul(
      req.params.id,
      body.state,
      req.userId,
      body.otp,
    );

    emitBackhaulState(
      {
        tripId: String(booking.tripId),
        bookingId: String(booking._id),
        requestId: String(booking.requestId),
        state: booking.state,
        at: new Date().toISOString(),
      },
      String(booking.requesterId),
    );

    ok(res, {
      booking,
      utilisation: trip ? await tripUtilisation(String(trip._id)) : null,
    });
  }),
);

backhaulRouter.patch(
  '/trips/:id/return-leg/state',
  requireAuth,
  requireRole('TRANSPORTER'),
  asyncHandler<AuthedRequest>(async (req, res) => {
    const { state } = z.object({ state: z.enum(RETURN_LEG_STATES) }).parse(req.body);
    const trip = await advanceReturnLeg(req.params.id, state, req.userId);

    emitReturnLegState({
      tripId: String(trip._id),
      state: trip.returnLeg.state,
      at: new Date().toISOString(),
    });
    ok(res, { trip, utilisation: await tripUtilisation(String(trip._id)) });
  }),
);
