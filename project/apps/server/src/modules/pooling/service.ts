import mongoose from 'mongoose';
import {
  MIN_UTILISATION,
  OCCUPIES_CAPACITY,
  canTransitionShipment,
  canTransitionTrip,
  type ShipmentState,
  type TripState,
} from '@kisanpool/shared';
import { ApiError } from '../../lib/envelope';
import { haversineKm, money } from '../../lib/geo';
import { getDirections } from '../maps/service';
import {
  TransporterOffer,
  TransportRequest,
  Trip,
  TripShipment,
  User,
  Vehicle,
} from '../../models';
import { supportsTransactions } from '../../db';
import { capacityOf, reallocate, routeCost, savingPct, soloPrice } from './pricing';

/** How far a transporter will reasonably divert to collect a load. */
const MAX_PICKUP_RADIUS_KM = 60;
/** A detour beyond this makes the load uneconomic however good the price. */
const MAX_DETOUR_KM = 25;
const OTP_LENGTH = 4;

const randomOtp = (): string =>
  String(Math.floor(Math.random() * 10 ** OTP_LENGTH)).padStart(OTP_LENGTH, '0');

// ---------------------------------------------------------------------------
// the request pool — what a given transporter should be shown
// ---------------------------------------------------------------------------

/**
 * Requests worth showing this transporter (PROMPT_2 §5, §10).
 *
 * Filters geographically and by capacity in the query where it can, then ranks by
 * how well the load fits the trip this driver is already building — a request two
 * villages off the current route is worse than a smaller one directly on it, even
 * if it pays more.
 */
export async function poolForTransporter(transporterId: string) {
  const vehicle = await Vehicle.findOne({ ownerId: transporterId });
  if (!vehicle) throw new ApiError('RESOURCE_NOT_FOUND', 'Register your vehicle first.');

  if (vehicle.verificationStatus !== 'VERIFIED') {
    throw new ApiError(
      'KYC_PENDING_REVIEW',
      'Your documents are still being verified. Requests will appear once they are approved.',
    );
  }
  if (vehicle.status === 'OFFLINE') {
    // not an error — the driver chose this; the screen shows an offline state
    return { offline: true as const, trip: null, requests: [] };
  }

  const trip = await activeFormingTrip(transporterId);
  const capacity = trip ? await capacityOf(trip) : null;
  const availableKg = capacity ? capacity.availableKg : vehicle.capacityKg;

  const from = vehicle.currentLocation
    ? { lat: vehicle.currentLocation.lat as number, lng: vehicle.currentLocation.lng as number }
    : null;

  // already-claimed requests should not come back in the pool
  const claimed = await TransporterOffer.find({
    transporterId,
    state: { $in: ['INTERESTED', 'SELECTED'] },
  }).distinct('requestId');

  const open = await TransportRequest.find({
    state: { $in: ['OPEN', 'TRANSPORTER_INTERESTED'] },
    farmerId: { $ne: transporterId },
    _id: { $nin: claimed },
    quantityKg: { $lte: availableKg },
  })
    .sort({ createdAt: -1 })
    .limit(60);

  const scored = [];
  for (const request of open) {
    const pickup = { lat: request.pickup.lat as number, lng: request.pickup.lng as number };
    const destination = {
      lat: request.destination.lat as number,
      lng: request.destination.lng as number,
    };

    // a forming trip is committed to one mandi — a different destination is a
    // different trip, not a detour
    if (trip && !sameDestination(trip, destination)) continue;

    const pickupDistanceKm = from ? haversineKm(from, pickup) : MAX_PICKUP_RADIUS_KM / 2;
    if (pickupDistanceKm > MAX_PICKUP_RADIUS_KM) continue;

    if (request.quantityKg / vehicle.capacityKg < MIN_UTILISATION) continue;

    const detourKm = trip ? await detourFor(trip, pickup) : 0;
    if (detourKm > MAX_DETOUR_KM) continue;

    const { distanceKm } = await getDirections(pickup, destination);
    const solo = soloPrice(distanceKm, vehicle.ratePerKm);
    const quoted = await quoteForJoining(trip, request.quantityKg, distanceKm, vehicle.ratePerKm);

    scored.push({
      request,
      pickupDistanceKm: Math.round(pickupDistanceKm * 10) / 10,
      detourKm: Math.round(detourKm * 10) / 10,
      distanceKm,
      etaMinutes: Math.round((pickupDistanceKm / 35) * 60),
      soloPrice: solo,
      quotedPrice: quoted,
      transporterEarning: money(routeCost(distanceKm, vehicle.ratePerKm)),
      utilisationPct: Math.round((request.quantityKg / vehicle.capacityKg) * 100),
      // on-route loads first, then near ones
      fitScore:
        1 - Math.min(1, detourKm / MAX_DETOUR_KM) * 0.6 -
        Math.min(1, pickupDistanceKm / MAX_PICKUP_RADIUS_KM) * 0.4,
    });
  }

  scored.sort((a, b) => b.fitScore - a.fitScore);

  return {
    offline: false as const,
    trip: trip ? { trip, capacity } : null,
    requests: scored.slice(0, 20),
  };
}

const sameDestination = (trip: { destination: { lat?: number | null; lng?: number | null } }, dest: { lat: number; lng: number }): boolean =>
  haversineKm(
    { lat: trip.destination.lat as number, lng: trip.destination.lng as number },
    dest,
  ) < 5;

/** Extra distance to collect one more pickup on the way. */
async function detourFor(trip: { _id: unknown; destination: { lat?: number | null; lng?: number | null } }, pickup: { lat: number; lng: number }): Promise<number> {
  const existing = await TripShipment.find({
    tripId: trip._id,
    state: { $in: OCCUPIES_CAPACITY },
  });
  if (!existing.length) return 0;

  const last = existing[existing.length - 1];
  const lastPoint = { lat: last.pickup.lat as number, lng: last.pickup.lng as number };
  const destination = {
    lat: trip.destination.lat as number,
    lng: trip.destination.lng as number,
  };

  const direct = haversineKm(lastPoint, destination);
  const viaPickup = haversineKm(lastPoint, pickup) + haversineKm(pickup, destination);
  return Math.max(0, viaPickup - direct);
}

/** What this farmer would pay if they joined — the whole point is that it drops. */
async function quoteForJoining(
  trip: Awaited<ReturnType<typeof activeFormingTrip>>,
  quantityKg: number,
  distanceKm: number,
  ratePerKm: number,
): Promise<number> {
  const solo = soloPrice(distanceKm, ratePerKm);
  if (!trip) return solo;

  const existing = await TripShipment.find({
    tripId: trip._id,
    state: { $in: OCCUPIES_CAPACITY },
  });
  const existingKg = existing.reduce((sum, s) => sum + s.quantityKg, 0);
  if (!existingKg) return solo;

  const cost = routeCost(trip.routeDistanceKm || distanceKm, ratePerKm);
  return money((cost * quantityKg) / (existingKg + quantityKg));
}

export async function activeFormingTrip(transporterId: string) {
  return Trip.findOne({ transporterId, state: { $in: ['FORMING', 'EN_ROUTE'] } }).sort({
    createdAt: -1,
  });
}

// ---------------------------------------------------------------------------
// transporter claims a request
// ---------------------------------------------------------------------------

/**
 * Claiming is an expression of interest, not a booking (PROMPT_1 §4).
 *
 * Nothing is reserved here — several transporters may claim the same request, and
 * one transporter may claim several requests. Capacity is only checked as a
 * feasibility test so a driver cannot offer to carry what will not fit.
 */
export async function claimRequest(
  requestId: string,
  transporterId: string,
  message?: string,
) {
  const vehicle = await Vehicle.findOne({ ownerId: transporterId });
  if (!vehicle) throw new ApiError('RESOURCE_NOT_FOUND', 'Register your vehicle first.');
  if (vehicle.verificationStatus !== 'VERIFIED') {
    throw new ApiError('KYC_PENDING_REVIEW', 'Your documents are still being verified.');
  }

  const request = await TransportRequest.findById(requestId);
  if (!request) throw new ApiError('RESOURCE_NOT_FOUND', 'That request no longer exists.');
  if (String(request.farmerId) === transporterId) {
    throw new ApiError('AUTH_FORBIDDEN', 'You cannot claim your own request.');
  }
  if (!['OPEN', 'TRANSPORTER_INTERESTED'].includes(request.state)) {
    throw new ApiError('BOOKING_STATE_INVALID', 'That request is no longer open.');
  }

  const trip = await activeFormingTrip(transporterId);
  const capacity = trip ? await capacityOf(trip) : null;
  const availableKg = capacity ? capacity.availableKg : vehicle.capacityKg;

  // the load must fit — server-side, always (PROMPT_1 §9)
  if (request.quantityKg > availableKg) {
    throw new ApiError(
      'CAPACITY_EXCEEDED',
      `This load is ${request.quantityKg} kg but you only have ${availableKg} kg free.`,
    );
  }

  const pickup = { lat: request.pickup.lat as number, lng: request.pickup.lng as number };
  const destination = {
    lat: request.destination.lat as number,
    lng: request.destination.lng as number,
  };
  const { distanceKm } = await getDirections(pickup, destination);

  const from = vehicle.currentLocation
    ? { lat: vehicle.currentLocation.lat as number, lng: vehicle.currentLocation.lng as number }
    : pickup;
  const pickupDistanceKm = haversineKm(from, pickup);

  const solo = soloPrice(distanceKm, vehicle.ratePerKm);
  const quoted = await quoteForJoining(trip, request.quantityKg, distanceKm, vehicle.ratePerKm);

  const offer = await TransporterOffer.findOneAndUpdate(
    { requestId: request._id, transporterId },
    {
      requestId: request._id,
      transporterId,
      vehicleId: vehicle._id,
      tripId: trip?._id,
      state: 'INTERESTED',
      quotedPrice: quoted,
      soloPrice: solo,
      pickupDistanceKm: Math.round(pickupDistanceKm * 10) / 10,
      detourKm: trip ? Math.round((await detourFor(trip, pickup)) * 10) / 10 : 0,
      etaMinutes: Math.round((pickupDistanceKm / 35) * 60),
      message,
      withdrawnAt: undefined,
    },
    { new: true, upsert: true, setDefaultsOnInsert: true },
  );

  if (request.state === 'OPEN') {
    request.state = 'TRANSPORTER_INTERESTED';
    await request.save();
  }

  return { offer, request };
}

export async function withdrawOffer(offerId: string, transporterId: string) {
  const offer = await TransporterOffer.findById(offerId);
  if (!offer) throw new ApiError('RESOURCE_NOT_FOUND', 'That offer no longer exists.');
  if (String(offer.transporterId) !== transporterId) {
    throw new ApiError('AUTH_FORBIDDEN', 'That offer is not yours.');
  }
  if (offer.state !== 'INTERESTED') {
    throw new ApiError('BOOKING_STATE_INVALID', 'That offer can no longer be withdrawn.');
  }

  offer.state = 'WITHDRAWN';
  offer.withdrawnAt = new Date();
  await offer.save();

  // if that was the last claim, the request goes back to plain OPEN
  const remaining = await TransporterOffer.countDocuments({
    requestId: offer.requestId,
    state: 'INTERESTED',
  });
  if (!remaining) {
    await TransportRequest.updateOne(
      { _id: offer.requestId, state: 'TRANSPORTER_INTERESTED' },
      { state: 'OPEN' },
    );
  }

  return offer;
}

// ---------------------------------------------------------------------------
// farmer compares and selects
// ---------------------------------------------------------------------------

export async function offersForRequest(requestId: string, farmerId: string) {
  const request = await TransportRequest.findById(requestId);
  if (!request) throw new ApiError('RESOURCE_NOT_FOUND', 'That request no longer exists.');
  if (String(request.farmerId) !== farmerId) {
    throw new ApiError('AUTH_FORBIDDEN', "That request isn't yours.");
  }

  const offers = await TransporterOffer.find({
    requestId: request._id,
    state: { $in: ['INTERESTED', 'SELECTED'] },
  }).sort({ quotedPrice: 1 });

  return Promise.all(
    offers.map(async (offer) => {
      const [transporter, vehicle] = await Promise.all([
        User.findById(offer.transporterId),
        Vehicle.findById(offer.vehicleId),
      ]);

      const trip = offer.tripId ? await Trip.findById(offer.tripId) : null;
      const capacity = trip ? await capacityOf(trip) : null;
      const poolSize = trip
        ? await TripShipment.countDocuments({
            tripId: trip._id,
            state: { $in: OCCUPIES_CAPACITY },
          })
        : 0;

      return {
        ...offer.toJSON(),
        savingPct: savingPct(offer.soloPrice, offer.quotedPrice),
        poolSize,
        transporter: transporter && {
          _id: String(transporter._id),
          name: transporter.name,
          ratingAvg: transporter.ratingAvg,
          ratingCount: transporter.ratingCount,
        },
        vehicle: vehicle && {
          _id: String(vehicle._id),
          registrationNumber: vehicle.registrationNumber,
          vehicleType: vehicle.vehicleType,
          capacityKg: vehicle.capacityKg,
          remainingCapacityKg: capacity ? capacity.availableKg : vehicle.capacityKg,
        },
      };
    }),
  );
}

/**
 * The farmer's final choice — the only place capacity is actually reserved.
 *
 * Two farmers can be selecting the last 200kg at the same instant, so the reserve
 * runs inside a transaction and re-checks capacity against the shipments that
 * exist at commit time. Losing that race returns CONCURRENT_BOOKING; nothing is
 * half-written (PROMPT_2 §11).
 */
export async function selectTransporter(requestId: string, offerId: string, farmerId: string) {
  const useTransaction = await supportsTransactions();
  const session = useTransaction ? await mongoose.startSession() : undefined;

  try {
    if (session) session.startTransaction();

    const request = await TransportRequest.findById(requestId).session(session ?? null);
    if (!request) throw new ApiError('RESOURCE_NOT_FOUND', 'That request no longer exists.');
    if (String(request.farmerId) !== farmerId) {
      throw new ApiError('AUTH_FORBIDDEN', "That request isn't yours.");
    }
    if (request.state === 'CONFIRMED') {
      throw new ApiError('BOOKING_STATE_INVALID', 'You have already chosen a transporter.');
    }
    if (request.state !== 'TRANSPORTER_INTERESTED') {
      throw new ApiError('BOOKING_STATE_INVALID', 'This request is not open for selection.');
    }

    const offer = await TransporterOffer.findById(offerId).session(session ?? null);
    if (!offer || String(offer.requestId) !== String(request._id)) {
      throw new ApiError('RESOURCE_NOT_FOUND', 'That offer no longer exists.');
    }
    if (offer.state !== 'INTERESTED') {
      throw new ApiError('MATCH_EXPIRED', 'That transporter is no longer available.');
    }

    const vehicle = await Vehicle.findById(offer.vehicleId).session(session ?? null);
    if (!vehicle) throw new ApiError('RESOURCE_NOT_FOUND', 'That vehicle no longer exists.');

    // Find or open the trip this load joins.
    //
    // The offer's tripId is only a hint: it records the trip that existed when the
    // driver claimed, and claims usually happen before any farmer has confirmed —
    // so it is normally empty. Falling straight through to "create a trip" here is
    // what made every farmer their own trip and defeated pooling entirely; look for
    // the driver's open trip to the same mandi first.
    let trip = offer.tripId ? await Trip.findById(offer.tripId).session(session ?? null) : null;

    if (!trip || !['FORMING', 'EN_ROUTE'].includes(trip.state)) {
      const destination = {
        lat: request.destination.lat as number,
        lng: request.destination.lng as number,
      };
      // the vehicle can only be on one trip at a time, so this is the trip
      const open = await Trip.findOne({ openForVehicle: vehicle._id }).session(session ?? null);

      if (open) {
        // a load for a different mandi cannot join a trip already committed elsewhere
        const heading = haversineKm(
          { lat: open.destination.lat as number, lng: open.destination.lng as number },
          destination,
        );
        if (heading >= 5) {
          throw new ApiError(
            'CAPACITY_EXCEEDED',
            'That vehicle is already running a trip to a different mandi.',
          );
        }
        trip = open;
      }
    }

    if (!trip) {
      const dest = {
        lat: request.destination.lat as number,
        lng: request.destination.lng as number,
      };
      const pickup = { lat: request.pickup.lat as number, lng: request.pickup.lng as number };
      const { distanceKm } = await getDirections(pickup, dest);

      const created = await Trip.create(
        [
          {
            transporterId: offer.transporterId,
            vehicleId: vehicle._id,
            destination: {
              name: request.destination.name,
              lat: dest.lat,
              lng: dest.lng,
            },
            state: 'FORMING',
            openForVehicle: vehicle._id,
            totalCapacityKg: vehicle.capacityKg,
            routeDistanceKm: distanceKm,
            estimatedRouteCost: routeCost(distanceKm, vehicle.ratePerKm),
          },
        ],
        session ? { session } : undefined,
      );
      trip = created[0];
    }

    // the race: re-check against shipments as they stand right now
    const existing = await TripShipment.find({
      tripId: trip._id,
      state: { $in: OCCUPIES_CAPACITY },
    }).session(session ?? null);
    const committedKg = existing.reduce((sum, s) => sum + s.quantityKg, 0);

    if (committedKg + request.quantityKg > trip.totalCapacityKg) {
      throw new ApiError(
        'CONCURRENT_BOOKING',
        'That vehicle filled up while you were choosing. Please pick another transporter.',
      );
    }

    const shipmentDocs = await TripShipment.create(
      [
        {
          tripId: trip._id,
          requestId: request._id,
          farmerId: request.farmerId,
          quantityKg: request.quantityKg,
          cropType: request.cropType,
          pickup: {
            name: request.pickup.name,
            lat: request.pickup.lat,
            lng: request.pickup.lng,
          },
          pickupSequence: existing.length + 1,
          state: 'ASSIGNED',
          allocatedPrice: offer.quotedPrice,
          soloPrice: offer.soloPrice,
          pickupOtp: randomOtp(),
        },
      ],
      session ? { session } : undefined,
    );
    const shipment = shipmentDocs[0];

    offer.state = 'SELECTED';
    offer.tripId = trip._id;
    await offer.save({ session });

    await TransporterOffer.updateMany(
      { requestId: request._id, _id: { $ne: offer._id }, state: 'INTERESTED' },
      { state: 'REJECTED' },
      session ? { session } : undefined,
    );

    request.state = 'CONFIRMED';
    request.tripId = trip._id;
    await request.save({ session });

    if (session) await session.commitTransaction();

    // prices move for everyone already aboard — after the commit, so a failed
    // reallocation can never roll back a confirmed booking
    const pricing = await reallocate(String(trip._id), 'farmer joined the trip');

    return { trip, shipment, offer, pricing };
  } catch (err) {
    if (session?.inTransaction()) await session.abortTransaction();
    throw asPoolingError(err);
  } finally {
    await session?.endSession();
  }
}

/** A write conflict on the same trip is the same event as losing the capacity race. */
function asPoolingError(err: unknown): unknown {
  if (err instanceof ApiError) return err;
  const mongoErr = err as {
    code?: number;
    errorLabels?: string[];
    hasErrorLabel?: (label: string) => boolean;
  };
  const conflict =
    mongoErr.code === 112 ||
    mongoErr.code === 11000 ||
    mongoErr.errorLabels?.includes('TransientTransactionError') === true ||
    mongoErr.hasErrorLabel?.('TransientTransactionError') === true;

  if (conflict) {
    return new ApiError(
      'CONCURRENT_BOOKING',
      'That vehicle filled up while you were choosing. Please pick another transporter.',
    );
  }
  return err;
}

// ---------------------------------------------------------------------------
// lifecycle
// ---------------------------------------------------------------------------

export async function advanceShipment(
  shipmentId: string,
  to: ShipmentState,
  actorId: string,
  otp?: string,
) {
  const shipment = await TripShipment.findById(shipmentId);
  if (!shipment) throw new ApiError('RESOURCE_NOT_FOUND', 'That shipment no longer exists.');

  const trip = await Trip.findById(shipment.tripId);
  if (!trip || String(trip.transporterId) !== actorId) {
    throw new ApiError('AUTH_FORBIDDEN', 'Only the assigned transporter can update this.');
  }

  if (!canTransitionShipment(shipment.state, to)) {
    throw new ApiError(
      'BOOKING_STATE_INVALID',
      `A shipment cannot go from ${shipment.state} to ${to}.`,
    );
  }

  // the farmer's OTP is what proves the right produce was collected
  if (to === 'PICKED_UP') {
    if (!otp || otp !== shipment.pickupOtp) {
      throw new ApiError('VALIDATION_ERROR', 'otp: that pickup code is not correct.');
    }
    shipment.pickedUpAt = new Date();
  }
  if (to === 'DELIVERED') {
    shipment.deliveredAt = new Date();
    // the bill freezes here — later joiners must not change what this farmer owes
    shipment.finalPrice = shipment.allocatedPrice;
  }

  shipment.state = to;
  await shipment.save();

  return { shipment, trip };
}

export async function advanceTrip(tripId: string, to: TripState, transporterId: string) {
  const trip = await Trip.findById(tripId);
  if (!trip) throw new ApiError('RESOURCE_NOT_FOUND', 'That trip no longer exists.');
  if (String(trip.transporterId) !== transporterId) {
    throw new ApiError('AUTH_FORBIDDEN', 'That trip is not yours.');
  }
  if (!canTransitionTrip(trip.state, to)) {
    throw new ApiError('BOOKING_STATE_INVALID', `A trip cannot go from ${trip.state} to ${to}.`);
  }

  if (to === 'EN_ROUTE') {
    const aboard = await TripShipment.countDocuments({
      tripId: trip._id,
      state: { $in: OCCUPIES_CAPACITY },
    });
    if (!aboard) {
      throw new ApiError('BOOKING_STATE_INVALID', 'Add at least one load before starting.');
    }
    trip.startedAt = new Date();
  }
  if (['COMPLETED', 'CANCELLED'].includes(to)) {
    // release the vehicle's open slot so the driver can form the next trip
    trip.openForVehicle = undefined;
  }
  if (to === 'COMPLETED') {
    const undelivered = await TripShipment.countDocuments({
      tripId: trip._id,
      state: { $in: OCCUPIES_CAPACITY },
    });
    if (undelivered) {
      throw new ApiError(
        'BOOKING_STATE_INVALID',
        `${undelivered} load(s) are still to be delivered.`,
      );
    }
    trip.completedAt = new Date();
  }

  trip.state = to;
  await trip.save();
  return trip;
}

/** Full trip view for the transporter — pool, capacity, pickup order. */
export async function tripDetail(tripId: string, viewerId: string) {
  const trip = await Trip.findById(tripId);
  if (!trip) throw new ApiError('RESOURCE_NOT_FOUND', 'That trip no longer exists.');

  const shipments = await TripShipment.find({ tripId: trip._id }).sort({ pickupSequence: 1 });

  const isTransporter = String(trip.transporterId) === viewerId;
  const isParticipant = shipments.some((s) => String(s.farmerId) === viewerId);
  if (!isTransporter && !isParticipant) {
    throw new ApiError('AUTH_FORBIDDEN', "You don't have access to this trip.");
  }

  const farmers = await User.find({ _id: { $in: shipments.map((s) => s.farmerId) } });
  const vehicle = await Vehicle.findById(trip.vehicleId);
  const transporter = await User.findById(trip.transporterId);

  return {
    trip: { ...trip.toJSON(), capacity: await capacityOf(trip) },
    vehicle,
    transporter: transporter && {
      _id: String(transporter._id),
      name: transporter.name,
      // the driver's number is for the farmers riding with him, and nobody else
      phone: isParticipant || isTransporter ? transporter.phone : undefined,
      ratingAvg: transporter.ratingAvg,
    },
    shipments: shipments.map((shipment) => {
      const farmer = farmers.find((f) => String(f._id) === String(shipment.farmerId));
      const mine = String(shipment.farmerId) === viewerId;
      return {
        ...shipment.toJSON(),
        // a farmer sees their own pickup code; the driver never sees any of them
        pickupOtp: mine ? shipment.pickupOtp : undefined,
        savingPct: savingPct(shipment.soloPrice, shipment.finalPrice ?? shipment.allocatedPrice),
        farmer: farmer && {
          _id: String(farmer._id),
          name: farmer.name,
          phone: isTransporter || mine ? farmer.phone : undefined,
          ratingAvg: farmer.ratingAvg,
        },
      };
    }),
  };
}
