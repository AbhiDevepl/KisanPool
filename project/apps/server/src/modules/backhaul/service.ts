import mongoose from 'mongoose';
import {
  OCCUPIES_CAPACITY,
  OCCUPIES_RETURN_CAPACITY,
  canTransitionBackhaul,
  canTransitionReturnLeg,
  type BackhaulBookingState,
  type ReturnLegState,
  type VehicleType,
} from '@kisanpool/shared';
import { ApiError } from '../../lib/envelope';
import { money, type Point } from '../../lib/geo';
import { supportsTransactions } from '../../db';
import { getDirections } from '../maps/service';
import {
  BackhaulBooking,
  BackhaulRequest,
  Trip,
  TripShipment,
  User,
  Vehicle,
} from '../../models';
import type { TripDoc } from '../../models';
import { transporterEarning } from '../pooling/pricing';
import { markCommitted, operationKey, recordIntent } from '../resilience/journal';
import { tripUtilisation } from './utilisation';
import {
  MAX_BACKHAUL_DETOUR_KM,
  MAX_BACKHAUL_PICKUP_KM,
  checkEligibility,
  quoteBackhaul,
  toMatchDTO,
  type LegGeometry,
} from './matching';

const OTP_LENGTH = 4;
const randomOtp = (): string =>
  String(Math.floor(Math.random() * 10 ** OTP_LENGTH)).padStart(OTP_LENGTH, '0');

const asPoint = (p: { lat?: number | null; lng?: number | null }): Point => ({
  lat: p.lat as number,
  lng: p.lng as number,
});

// ---------------------------------------------------------------------------
// the return leg
// ---------------------------------------------------------------------------

/**
 * Where "home" is for a trip.
 *
 * The first pickup the driver made on the way out. Not the vehicle's live GPS —
 * that is at the mandi right now — and not a stored home address, which no driver
 * has entered. The farmer they collected first is, by construction, in the region
 * the vehicle came from.
 */
async function homeFor(trip: TripDoc): Promise<Point> {
  const first = await TripShipment.findOne({ tripId: trip._id }).sort({ pickupSequence: 1 });
  if (first) return asPoint(first.pickup);

  const vehicle = await Vehicle.findById(trip.vehicleId);
  if (vehicle?.currentLocation) return asPoint(vehicle.currentLocation);
  return asPoint(trip.destination);
}

/**
 * Open the return leg.
 *
 * Only once EVERY outbound shipment is off the vehicle. That single condition is
 * what guarantees a backhaul can never interfere with a farmer's produce (§5):
 * there is physically nothing of theirs left aboard to interfere with, and the
 * capacity the return leg offers cannot overlap the capacity they were using.
 */
export async function openReturnLeg(tripId: string, transporterId: string) {
  const trip = await Trip.findById(tripId);
  if (!trip) throw new ApiError('RESOURCE_NOT_FOUND', 'That trip no longer exists.');
  if (String(trip.transporterId) !== transporterId) {
    throw new ApiError('AUTH_FORBIDDEN', 'That trip is not yours.');
  }

  const stillAboard = await TripShipment.countDocuments({
    tripId: trip._id,
    state: { $in: OCCUPIES_CAPACITY },
  });
  if (stillAboard) {
    throw new ApiError(
      'BOOKING_STATE_INVALID',
      `Deliver all ${stillAboard} farmer load(s) before opening the return journey.`,
    );
  }

  if (trip.returnLeg?.state && trip.returnLeg.state !== 'NONE') {
    return trip; // already open — opening twice is a no-op, not an error
  }

  const home = await homeFor(trip);
  const { distanceKm } = await getDirections(asPoint(trip.destination), home);

  trip.returnLeg = {
    state: 'OPEN',
    origin: {
      name: trip.destination.name || 'Mandi',
      lat: home.lat,
      lng: home.lng,
    },
    emptyReturnKm: Math.round(distanceKm * 10) / 10,
    routeKm: 0,
    openedAt: new Date(),
    startedAt: undefined,
    completedAt: undefined,
  };
  await trip.save();
  return trip;
}

/** Return-leg capacity, derived from its bookings — never a stored counter. */
export async function returnCapacityOf(trip: TripDoc): Promise<{
  totalKg: number;
  bookedKg: number;
  availableKg: number;
}> {
  const bookings = await BackhaulBooking.find({
    tripId: trip._id,
    state: { $in: OCCUPIES_RETURN_CAPACITY },
  });
  const bookedKg = bookings.reduce((sum, b) => sum + b.weightKg, 0);
  return {
    totalKg: trip.totalCapacityKg,
    bookedKg,
    availableKg: Math.max(0, trip.totalCapacityKg - bookedKg),
  };
}

async function legGeometry(trip: TripDoc): Promise<LegGeometry> {
  const home = trip.returnLeg?.origin
    ? asPoint(trip.returnLeg.origin)
    : await homeFor(trip);
  return {
    origin: asPoint(trip.destination),
    home,
    emptyReturnKm: trip.returnLeg?.emptyReturnKm ?? 0,
  };
}

// ---------------------------------------------------------------------------
// matching
// ---------------------------------------------------------------------------

/**
 * Return loads worth this driver's while, ranked.
 *
 * Filters on things that are facts before it scores anything: the cargo has to be
 * legal for this vehicle type, it has to fit in what is free, its collection
 * window has to still be open, and it has to be roughly on the way. Only what
 * survives all four gets priced and scored — showing a load the driver cannot
 * legally take is worse than showing none.
 */
export async function backhaulMatchesFor(tripId: string, transporterId: string) {
  const trip = await Trip.findById(tripId);
  if (!trip) throw new ApiError('RESOURCE_NOT_FOUND', 'That trip no longer exists.');
  if (String(trip.transporterId) !== transporterId) {
    throw new ApiError('AUTH_FORBIDDEN', 'That trip is not yours.');
  }
  if (!trip.returnLeg || trip.returnLeg.state === 'NONE') {
    return { open: false as const, capacity: null, matches: [], leg: null };
  }

  const vehicle = await Vehicle.findById(trip.vehicleId);
  if (!vehicle) throw new ApiError('RESOURCE_NOT_FOUND', 'That vehicle no longer exists.');

  const capacity = await returnCapacityOf(trip);
  const leg = await legGeometry(trip);
  const now = new Date();

  const open = await BackhaulRequest.find({
    state: 'OPEN',
    requesterId: { $ne: transporterId },
    readyUntil: { $gte: now },
    weightKg: { $lte: capacity.availableKg },
  })
    .sort({ createdAt: -1 })
    .limit(60);

  const vehicleInput = {
    vehicleType: vehicle.vehicleType as VehicleType,
    capacityKg: vehicle.capacityKg,
    availableKg: capacity.availableKg,
    ratePerKm: vehicle.ratePerKm,
  };

  const matches = [];
  for (const request of open) {
    const candidate = {
      pickup: asPoint(request.pickup),
      destination: asPoint(request.destination),
      weightKg: request.weightKg,
      cargoCategory: request.cargoCategory,
    };

    // legality and capacity first — neither is negotiable
    const eligible = checkEligibility(candidate, vehicleInput);
    if (!eligible.ok) continue;

    const quote = await quoteBackhaul(leg, candidate, vehicleInput);

    // a load this far off the way home is a second job, not a backhaul
    if (quote.detourKm > MAX_BACKHAUL_DETOUR_KM) continue;
    if (quote.pickupDistanceKm > MAX_BACKHAUL_PICKUP_KM) continue;

    const requester = await User.findById(request.requesterId);
    matches.push(
      toMatchDTO(
        {
          ...request.toJSON(),
          requester: requester && {
            _id: String(requester._id),
            name: requester.name,
            ratingAvg: requester.ratingAvg,
          },
        } as never,
        quote,
      ),
    );
  }

  matches.sort((a, b) => b.fitScore - a.fitScore);

  return {
    open: true as const,
    capacity,
    leg: {
      from: trip.destination,
      to: trip.returnLeg.origin,
      emptyReturnKm: trip.returnLeg.emptyReturnKm ?? 0,
      state: trip.returnLeg.state as ReturnLegState,
    },
    matches: matches.slice(0, 15),
  };
}

// ---------------------------------------------------------------------------
// accepting a return load
// ---------------------------------------------------------------------------

/**
 * Take a return load onto this trip's homeward leg.
 *
 * Same race, same fix as everywhere else in this codebase: two drivers reaching
 * the same mandi can accept the same load at the same instant, and two INSERTs
 * conflict on nothing. The unique index on `BackhaulBooking.requestId` is the real
 * guarantee here — one request can only ever be booked once — and the transaction
 * plus the conditioned state update make the loser fail cleanly rather than
 * half-writing (ADR-033).
 */
export async function acceptBackhaul(tripId: string, requestId: string, transporterId: string) {
  /*
   * Write-ahead intent (ADR-044), keyed on the requestId exactly like
   * selectTransporter — a return-load request may only ever be booked once
   * (the unique index below is the real guarantee), so "a booking for THIS
   * request exists" is the idempotent fact replay checks (see recovery.ts).
   */
  const intent = await recordIntent({
    eventType: 'BACKHAUL_BOOKING_CREATED',
    entityType: 'BackhaulRequest',
    entityId: requestId,
    actorId: transporterId,
    operationKey: operationKey('BACKHAUL_BOOKING_CREATED', requestId),
    payload: { requestId, tripId },
  });

  const useTransaction = await supportsTransactions();
  const session = useTransaction ? await mongoose.startSession() : undefined;

  try {
    if (session) session.startTransaction();

    const trip = await Trip.findById(tripId).session(session ?? null);
    if (!trip) throw new ApiError('RESOURCE_NOT_FOUND', 'That trip no longer exists.');
    if (String(trip.transporterId) !== transporterId) {
      throw new ApiError('AUTH_FORBIDDEN', 'That trip is not yours.');
    }
    if (!trip.returnLeg || !['OPEN', 'LOADING'].includes(trip.returnLeg.state)) {
      throw new ApiError(
        'BOOKING_STATE_INVALID',
        'This trip is not taking return loads right now.',
      );
    }

    const vehicle = await Vehicle.findById(trip.vehicleId).session(session ?? null);
    if (!vehicle) throw new ApiError('RESOURCE_NOT_FOUND', 'That vehicle no longer exists.');

    /*
     * Claim the request by moving it OPEN -> BOOKED conditionally. Whoever's
     * update matches first wins; the loser matches nothing and is told so. This
     * is the single point at which a return load is spoken for.
     */
    const claimed = await BackhaulRequest.findOneAndUpdate(
      { _id: requestId, state: 'OPEN' },
      { state: 'BOOKED', bookedAt: new Date() },
      { new: true, ...(session ? { session } : {}) },
    );
    if (!claimed) {
      const exists = await BackhaulRequest.findById(requestId).session(session ?? null);
      if (!exists) throw new ApiError('RESOURCE_NOT_FOUND', 'That return load no longer exists.');
      // it may already be BOOKED because THIS very intent landed just before an
      // outage cut the confirmation off — that is a replay's job to notice, not
      // an error to hand back to a driver retrying in good faith
      const already = await BackhaulBooking.findOne({ requestId }).session(session ?? null);
      if (already && String(already.transporterId) === transporterId) {
        if (session) await session.commitTransaction();
        await markCommitted(intent);
        // reconstruct the fields the route actually re-serves from what was
        // persisted — everything else in a full BackhaulQuote is presentational
        // and not worth re-deriving for what is, by construction, a retry
        const reconstructedQuote = {
          price: already.price,
          transporterEarning: already.transporterEarning,
          detourKm: already.detourKm,
          carryKm: already.carryKm,
        };
        return { booking: already, request: exists, trip, quote: reconstructedQuote };
      }
      throw new ApiError(
        'CONCURRENT_BOOKING',
        'Another driver took that return load a moment ago.',
      );
    }

    if (claimed.readyUntil < new Date()) {
      throw new ApiError('MATCH_EXPIRED', 'That return load is no longer available for collection.');
    }

    const capacity = await returnCapacityOf(trip);
    const candidate = {
      pickup: asPoint(claimed.pickup),
      destination: asPoint(claimed.destination),
      weightKg: claimed.weightKg,
      cargoCategory: claimed.cargoCategory,
    };
    const vehicleInput = {
      vehicleType: vehicle.vehicleType as VehicleType,
      capacityKg: vehicle.capacityKg,
      availableKg: capacity.availableKg,
      ratePerKm: vehicle.ratePerKm,
    };

    // re-checked server-side at commit time, never trusted from the match list
    const eligible = checkEligibility(candidate, vehicleInput);
    if (!eligible.ok) {
      throw new ApiError(
        eligible.kind === 'CAPACITY' ? 'CAPACITY_EXCEEDED' : 'VALIDATION_ERROR',
        eligible.reason,
      );
    }

    const leg = await legGeometry(trip);
    const quote = await quoteBackhaul(leg, candidate, vehicleInput);

    const created = await BackhaulBooking.create(
      [
        {
          tripId: trip._id,
          requestId: claimed._id,
          transporterId,
          requesterId: claimed.requesterId,
          cargoCategory: claimed.cargoCategory,
          weightKg: claimed.weightKg,
          pickup: claimed.pickup,
          destination: claimed.destination,
          state: 'BOOKED',
          price: quote.price,
          transporterEarning: quote.transporterEarning,
          detourKm: quote.detourKm,
          carryKm: quote.carryKm,
          pickupOtp: randomOtp(),
        },
      ],
      session ? { session } : undefined,
    );

    if (trip.returnLeg.state === 'OPEN') trip.returnLeg.state = 'LOADING';
    trip.returnLeg.routeKm = money((trip.returnLeg.routeKm ?? 0) + quote.detourKm);
    await trip.save({ session });

    if (session) await session.commitTransaction();
    await markCommitted(intent);
    return { booking: created[0], request: claimed, trip, quote };
  } catch (err) {
    if (session?.inTransaction()) await session.abortTransaction();
    throw asBackhaulError(err);
  } finally {
    await session?.endSession();
  }
}

function asBackhaulError(err: unknown): unknown {
  if (err instanceof ApiError) return err;
  const mongoErr = err as { code?: number; hasErrorLabel?: (l: string) => boolean };
  if (mongoErr.code === 112 || mongoErr.code === 11000 || mongoErr.hasErrorLabel?.('TransientTransactionError')) {
    return new ApiError('CONCURRENT_BOOKING', 'Another driver took that return load a moment ago.');
  }
  return err;
}

// ---------------------------------------------------------------------------
// lifecycle
// ---------------------------------------------------------------------------

export async function advanceBackhaul(
  bookingId: string,
  to: BackhaulBookingState,
  transporterId: string,
  otp?: string,
) {
  const booking = await BackhaulBooking.findById(bookingId);
  if (!booking) throw new ApiError('RESOURCE_NOT_FOUND', 'That return load no longer exists.');
  if (String(booking.transporterId) !== transporterId) {
    throw new ApiError('AUTH_FORBIDDEN', 'That return load is not yours.');
  }
  if (!canTransitionBackhaul(booking.state, to)) {
    throw new ApiError('BOOKING_STATE_INVALID', `A return load cannot go from ${booking.state} to ${to}.`);
  }

  if (to === 'PICKED_UP') {
    if (!otp || otp !== booking.pickupOtp) {
      throw new ApiError('VALIDATION_ERROR', 'otp: that collection code is not correct.');
    }
    booking.pickedUpAt = new Date();
  }
  if (to === 'DELIVERED') {
    booking.deliveredAt = new Date();
    await BackhaulRequest.findByIdAndUpdate(booking.requestId, { state: 'DELIVERED' });
  }
  if (to === 'CANCELLED') {
    booking.cancelledAt = new Date();
    // the goods go back in the pool for another driver
    await BackhaulRequest.findByIdAndUpdate(booking.requestId, { state: 'OPEN', bookedAt: undefined });
  }

  /*
   * Journalled write-ahead (ADR-044), matching advanceTrip/advanceShipment. The
   * key includes the TARGET state, so replay checks "does this booking already
   * read as DELIVERED" rather than re-running the OTP check or the sibling
   * request update above.
   */
  const intent = await recordIntent({
    eventType: 'BACKHAUL_BOOKING_STATE_CHANGED',
    entityType: 'BackhaulBooking',
    entityId: bookingId,
    actorId: transporterId,
    operationKey: operationKey('BACKHAUL_BOOKING_STATE_CHANGED', bookingId, to),
    payload: { fromState: booking.state, toState: to },
  });

  booking.state = to;
  await booking.save();
  await markCommitted(intent);

  const trip = await Trip.findById(booking.tripId);
  return { booking, trip };
}

export async function advanceReturnLeg(tripId: string, to: ReturnLegState, transporterId: string) {
  const trip = await Trip.findById(tripId);
  if (!trip) throw new ApiError('RESOURCE_NOT_FOUND', 'That trip no longer exists.');
  if (String(trip.transporterId) !== transporterId) {
    throw new ApiError('AUTH_FORBIDDEN', 'That trip is not yours.');
  }

  const from = (trip.returnLeg?.state ?? 'NONE') as ReturnLegState;
  if (!canTransitionReturnLeg(from, to)) {
    throw new ApiError('BOOKING_STATE_INVALID', `A return leg cannot go from ${from} to ${to}.`);
  }

  if (to === 'COMPLETED') {
    const undelivered = await BackhaulBooking.countDocuments({
      tripId: trip._id,
      state: { $in: OCCUPIES_RETURN_CAPACITY },
    });
    if (undelivered) {
      throw new ApiError(
        'BOOKING_STATE_INVALID',
        `${undelivered} return load(s) are still to be delivered.`,
      );
    }
    trip.returnLeg.completedAt = new Date();
  }
  if (to === 'IN_TRANSIT') trip.returnLeg.startedAt = new Date();

  trip.returnLeg.state = to;
  await trip.save();
  return trip;
}

export { transporterEarning };
export { tripUtilisation } from './utilisation';
