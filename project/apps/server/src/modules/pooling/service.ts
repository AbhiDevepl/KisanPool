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
import {
  capacityOf,
  priceTrip,
  priceTripById,
  reallocate,
  routeCost,
  savingPct,
  soloPrice,
  transporterEarning,
} from './pricing';
import { markCommitted, operationKey, recordIntent } from '../resilience/journal';
import { putTripSnapshot } from '../resilience/snapshots';

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

  // what the driver is on course to earn as things stand — every row below is
  // quoted as the difference this load would make to it, not as a standalone fare
  const current = trip ? await priceTripById(String(trip._id)) : null;
  const currentEarning = current?.transporterEarning ?? 0;

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

  // Optimization: Pre-fetch the last pickup point once for the active forming trip
  // to avoid executing `TripShipment.find` up to 60 times in the request prefiltering loop.
  let lastPickupPoint: { lat: number; lng: number } | null = null;
  if (trip) {
    const existing = await TripShipment.find({
      tripId: trip._id,
      state: { $in: OCCUPIES_CAPACITY },
    });
    if (existing.length) {
      const last = existing[existing.length - 1];
      lastPickupPoint = { lat: last.pickup.lat as number, lng: last.pickup.lng as number };
    }
  }

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

    // cheap straight-line prefilter first — the engine is the authority, but it
    // costs route lookups, so obviously-wrong loads never reach it
    if (trip && detourFor(trip, lastPickupPoint, pickup) > MAX_DETOUR_KM * 1.5) continue;

    const { distanceKm } = await getDirections(pickup, destination);
    const quote = await quoteForJoining(
      trip,
      {
        requestId: String(request._id),
        farmerId: String(request.farmerId),
        quantityKg: request.quantityKg,
        pickup,
      },
      destination,
      distanceKm,
      vehicle.ratePerKm,
    );

    // the real road detour, from the same engine that prices it
    if (quote.detourKm > MAX_DETOUR_KM) continue;

    // what taking this load actually adds to the driver's earning, after the
    // platform's cut — never the gross fare, which was double-counting the
    // kilometres the trip was already going to drive.
    // Optimization: quoteForJoining already runs priceTrip/priceTripById and
    // returns quote.transporterEarning, avoiding duplicate database queries.
    const earningAfter = quote.transporterEarning;

    scored.push({
      request,
      pickupDistanceKm: Math.round(pickupDistanceKm * 10) / 10,
      detourKm: quote.detourKm,
      distanceKm,
      etaMinutes: Math.round((pickupDistanceKm / 35) * 60),
      soloPrice: quote.solo,
      quotedPrice: quote.quoted,
      /** what this load adds to what the driver takes home */
      transporterEarning: money(Math.max(0, earningAfter - currentEarning)),
      /** and what the whole trip would then be worth to them */
      tripEarningAfter: money(earningAfter),
      utilisationPct: Math.round((request.quantityKg / vehicle.capacityKg) * 100),
      // on-route loads first, then near ones
      fitScore:
        1 - Math.min(1, quote.detourKm / MAX_DETOUR_KM) * 0.6 -
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
function detourFor(
  trip: { _id: unknown; destination: { lat?: number | null; lng?: number | null } },
  lastPickupPoint: { lat: number; lng: number } | null,
  pickup: { lat: number; lng: number },
): number {
  if (!lastPickupPoint) return 0;

  const destination = {
    lat: trip.destination.lat as number,
    lng: trip.destination.lng as number,
  };

  const direct = haversineKm(lastPickupPoint, destination);
  const viaPickup = haversineKm(lastPickupPoint, pickup) + haversineKm(pickup, destination);
  return Math.max(0, viaPickup - direct);
}

/**
 * What this farmer would pay if they joined — quoted by the real engine.
 *
 * It prices the driver's actual trip with this load appended, so the number the
 * farmer compares offers on is literally the allocation they will receive on
 * confirmation. Quoting with a second, simpler formula is what used to make the
 * offer screen and the trip screen disagree (ADR-035).
 */
async function quoteForJoining(
  trip: Awaited<ReturnType<typeof activeFormingTrip>>,
  candidate: { requestId: string; farmerId: string; quantityKg: number; pickup: { lat: number; lng: number } },
  destination: { lat: number; lng: number },
  distanceKm: number,
  ratePerKm: number,
): Promise<{ quoted: number; solo: number; detourKm: number; rideKm: number; transporterEarning: number }> {
  const solo = soloPrice(distanceKm, ratePerKm);

  // no trip yet: this load would BE the route, so the quote is the solo price —
  // and the engine says so itself rather than us special-casing the arithmetic
  if (!trip) {
    const pricing = await priceTrip({
      ratePerKm,
      destination,
      shipments: [
        {
          id: candidate.requestId,
          farmerId: candidate.farmerId,
          quantityKg: candidate.quantityKg,
          pickup: candidate.pickup,
          sequence: 0,
        },
      ],
    });
    const share = pricing.shares[0];
    return {
      quoted: share?.amount ?? solo,
      solo,
      detourKm: 0,
      rideKm: share?.rideKm ?? distanceKm,
      transporterEarning: pricing.transporterEarning,
    };
  }

  const pricing = await priceTripById(String(trip._id), {
    id: candidate.requestId,
    farmerId: candidate.farmerId,
    quantityKg: candidate.quantityKg,
    pickup: candidate.pickup,
  });
  const share = pricing?.shares.find((s) => s.shipmentId === candidate.requestId);
  if (!share || !pricing) {
    return {
      quoted: solo,
      solo,
      detourKm: 0,
      rideKm: distanceKm,
      transporterEarning: transporterEarning(solo),
    };
  }

  return {
    quoted: share.amount,
    solo,
    detourKm: share.detourKm,
    rideKm: share.rideKm,
    transporterEarning: pricing.transporterEarning,
  };
}

export async function activeFormingTrip(transporterId: string) {
  return Trip.findOne({ transporterId, state: { $in: ['FORMING', 'EN_ROUTE'] } }).sort({
    createdAt: -1,
  });
}

/**
 * The trip a load bound for `destination` would actually join.
 *
 * A driver's open trip is committed to one mandi. Quoting a load for a different
 * mandi against it would price a pool the load can never enter — the farmer would
 * be shown a pooled saving, tap confirm, and get CAPACITY_EXCEEDED ("that vehicle
 * is already running a trip to a different mandi"). Such a load is priced solo,
 * which is what it would actually cost.
 */
async function joinableTrip(
  transporterId: string,
  destination: { lat: number; lng: number },
): Promise<Awaited<ReturnType<typeof activeFormingTrip>>> {
  const trip = await activeFormingTrip(transporterId);
  if (!trip) return null;
  return sameDestination(trip, destination) ? trip : null;
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

  const pickup = { lat: request.pickup.lat as number, lng: request.pickup.lng as number };
  const destination = {
    lat: request.destination.lat as number,
    lng: request.destination.lng as number,
  };

  // an open trip to a DIFFERENT mandi cannot take this load at all — refuse here
  // rather than letting the driver accept and the farmer hit the error on confirm
  const openTrip = await activeFormingTrip(transporterId);
  if (openTrip && !sameDestination(openTrip, destination)) {
    throw new ApiError(
      'CAPACITY_EXCEEDED',
      `You are already running a trip to ${openTrip.destination.name || 'another mandi'}. Finish it before taking loads for a different one.`,
    );
  }

  const trip = openTrip;
  const capacity = trip ? await capacityOf(trip) : null;
  const availableKg = capacity ? capacity.availableKg : vehicle.capacityKg;

  // the load must fit — server-side, always (PROMPT_1 §9)
  if (request.quantityKg > availableKg) {
    throw new ApiError(
      'CAPACITY_EXCEEDED',
      `This load is ${request.quantityKg} kg but you only have ${availableKg} kg free.`,
    );
  }

  const { distanceKm } = await getDirections(pickup, destination);

  const from = vehicle.currentLocation
    ? { lat: vehicle.currentLocation.lat as number, lng: vehicle.currentLocation.lng as number }
    : pickup;
  const pickupDistanceKm = haversineKm(from, pickup);

  // the same engine that will allocate this load if the farmer confirms
  const quote = await quoteForJoining(
    trip,
    {
      requestId: String(request._id),
      farmerId: String(request.farmerId),
      quantityKg: request.quantityKg,
      pickup,
    },
    destination,
    distanceKm,
    vehicle.ratePerKm,
  );

  const offer = await TransporterOffer.findOneAndUpdate(
    { requestId: request._id, transporterId },
    {
      requestId: request._id,
      transporterId,
      vehicleId: vehicle._id,
      tripId: trip?._id,
      state: 'INTERESTED',
      quotedPrice: quote.quoted,
      soloPrice: quote.solo,
      pickupDistanceKm: Math.round(pickupDistanceKm * 10) / 10,
      detourKm: quote.detourKm,
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

  const pickup = { lat: request.pickup.lat as number, lng: request.pickup.lng as number };
  const destination = {
    lat: request.destination.lat as number,
    lng: request.destination.lng as number,
  };
  const { distanceKm } = await getDirections(pickup, destination);

  // Optimization: Pre-fetch all transporters and vehicles in batch using $in
  // to reduce 2N database queries (N User.findById + N Vehicle.findById) to 2 batch queries.
  const transporterIds = Array.from(new Set(offers.map((o) => o.transporterId)));
  const vehicleIds = Array.from(new Set(offers.map((o) => o.vehicleId)));

  const [transporters, vehicles] = await Promise.all([
    User.find({ _id: { $in: transporterIds } }),
    Vehicle.find({ _id: { $in: vehicleIds } }),
  ]);

  const transporterMap = new Map(transporters.map((t) => [String(t._id), t]));
  const vehicleMap = new Map(vehicles.map((v) => [String(v._id), v]));

  return Promise.all(
    offers.map(async (offer) => {
      const transporter = transporterMap.get(String(offer.transporterId));
      const vehicle = vehicleMap.get(String(offer.vehicleId));

      // A driver's open trip may have gained or lost farmers since they claimed,
      // which moves what this farmer would pay. Re-quoting here is what makes the
      // comparison screen live rather than a snapshot of claim time — and it is
      // the same engine call that will allocate the load on confirmation, so the
      // price the farmer taps is the price they get (ADR-035).
      const openTrip = await joinableTrip(String(offer.transporterId), destination);

      const quote = await quoteForJoining(
        openTrip,
        {
          requestId: String(request._id),
          farmerId: String(request.farmerId),
          quantityKg: request.quantityKg,
          pickup,
        },
        destination,
        distanceKm,
        vehicle?.ratePerKm ?? 0,
      );

      if (offer.quotedPrice !== quote.quoted || offer.soloPrice !== quote.solo) {
        offer.quotedPrice = quote.quoted;
        offer.soloPrice = quote.solo;
        offer.detourKm = quote.detourKm;
        await offer.save();
      }

      const capacity = openTrip ? await capacityOf(openTrip) : null;
      const poolSize = openTrip
        ? await TripShipment.countDocuments({
            tripId: openTrip._id,
            state: { $in: OCCUPIES_CAPACITY },
          })
        : 0;

      return {
        ...offer.toJSON(),
        savingPct: savingPct(quote.solo, quote.quoted),
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
  /*
   * Write-ahead intent (ADR-044).
   *
   * Recorded BEFORE the transaction so that if the database goes away mid-commit
   * the intent survives and reconciliation can ask afterwards whether it landed.
   * The operation key is the REQUEST id, because a request may only ever ride
   * once — the same fact the unique index on TripShipment.requestId enforces — so
   * a replay of this event can never produce a second booking.
   *
   * The journal is best-effort and never blocks the booking: it makes recovery
   * possible, it is not a precondition for serving the farmer.
   */
  const intent = await recordIntent({
    eventType: 'TRANSPORTER_SELECTED',
    entityType: 'TransportRequest',
    entityId: requestId,
    actorId: farmerId,
    operationKey: operationKey('TRANSPORTER_SELECTED', requestId),
    payload: { requestId, offerId },
  });

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

    /*
     * Serialise every reservation for this trip through the trip document.
     *
     * The capacity re-check below reads TripShipment; two farmers confirming at
     * once each INSERT a different shipment, so neither transaction sees the
     * other's uncommitted row and MongoDB finds no document written by both.
     * Both re-checks would pass against the same stale committed total and the
     * vehicle would be overbooked — 1.5t + 1.5t into the last 1.5t.
     *
     * Touching one shared document makes the second writer conflict, and
     * asPoolingError turns that into CONCURRENT_BOOKING (ADR-033).
     */
    const guarded = await Trip.findOneAndUpdate(
      { _id: trip._id },
      { $inc: { reservationSeq: 1 } },
      { new: true, ...(session ? { session } : {}) },
    );
    if (!guarded) throw new ApiError('RESOURCE_NOT_FOUND', 'That trip no longer exists.');
    trip = guarded;

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
          // 0-based: the UI renders `pickupSequence + 1`, so starting at 1 here
          // made the driver's very first pickup read "#2"
          pickupSequence: existing.length,
          state: 'ASSIGNED',
          // provisional — reallocate() below prices the whole pool and is what
          // actually decides this. Seeding it with the accepted quote means the
          // row is never briefly priced at zero.
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

    // reallocate() wrote the real allocation to the database; the in-memory doc
    // still holds the provisional quote it was created with. Callers (the REST
    // response, and Servo AI's acceptMatch, which reads it to tell the farmer what
    // they will pay) must see the final number, not the seed.
    const settled = pricing.pricing?.shares.find(
      (share) => share.shipmentId === String(shipment._id),
    );
    if (settled) {
      shipment.allocatedPrice = settled.amount;
      // the baseline the saving is quoted against comes from the same engine, so
      // "you save X%" means the same thing on every screen that shows it
      shipment.soloPrice = settled.soloPrice;
      await shipment.save();
    }

    // the authoritative store has confirmed it — the intent is now history
    await markCommitted(intent);

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

  /*
   * Journalled write-ahead (ADR-044). The key includes the TARGET state, so the
   * intent is "this shipment reaches DELIVERED" — an idempotent fact. Replay
   * checks whether it is already in that state and does nothing if so, rather
   * than re-running the transition.
   */
  const intent = await recordIntent({
    eventType: to === 'CANCELLED' ? 'SHIPMENT_CANCELLED' : 'SHIPMENT_STATE_CHANGED',
    entityType: 'TripShipment',
    entityId: shipmentId,
    actorId,
    operationKey: operationKey('SHIPMENT_STATE_CHANGED', shipmentId, to),
    payload: { fromState: shipment.state, toState: to, tripId: String(trip._id) },
  });

  shipment.state = to;
  await shipment.save();
  await markCommitted(intent);

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

  const intent = await recordIntent({
    eventType: 'TRIP_STATE_CHANGED',
    entityType: 'Trip',
    entityId: tripId,
    actorId: transporterId,
    operationKey: operationKey('TRIP_STATE_CHANGED', tripId, to),
    payload: { fromState: trip.state, toState: to },
  });

  trip.state = to;
  await trip.save();
  await markCommitted(intent);
  return trip;
}

/**
 * The Live Track hand-off (ADR-042).
 *
 * KisanPool does not reproduce turn-by-turn navigation. This returns the two
 * coordinates Google Maps needs — the transporter's latest known position and the
 * trip's actual destination mandi — plus a ready `directions` deep link, and a
 * single `trackable` decision driven by BUSINESS STATE, not a timer:
 *
 *     trip EN_ROUTE / IN_TRANSIT / AT_DESTINATION   → trackable
 *     this viewer's own load DELIVERED or later      → tracking has ended for them
 *     trip COMPLETED / CANCELLED                     → tracking is over for everyone
 *
 * One trip, one vehicle, one live stream: every authorised farmer on a pooled
 * trip calls this and gets the same origin and the same destination. Access is the
 * existing authenticated trip identity — a non-party gets AUTH_FORBIDDEN and no
 * JWT or internal id ever travels in the Maps URL, only lat/lng.
 *
 * `staleMinutes` is a safety signal only: the position may be old, but an old
 * position on an active trip is still the best the farmer has, so it is labelled,
 * not withheld.
 */
const TRACKABLE_TRIP_STATES: TripState[] = ['EN_ROUTE', 'IN_TRANSIT', 'AT_DESTINATION'];
const TRACKING_ENDED_FOR_SHIPMENT: ShipmentState[] = [
  'DELIVERED',
  'PAYMENT_PENDING',
  'PAID',
  'COMPLETED',
  'CANCELLED',
];
/** Past this the last GPS ping is stale enough to warn about — advisory only. */
const LOCATION_STALE_MINUTES = 20;

export async function trackTrip(tripId: string, viewerId: string) {
  const trip = await Trip.findById(tripId);
  if (!trip) throw new ApiError('RESOURCE_NOT_FOUND', 'That trip no longer exists.');

  const shipments = await TripShipment.find({ tripId: trip._id });
  const isTransporter = String(trip.transporterId) === viewerId;
  const mine = shipments.find((s) => String(s.farmerId) === viewerId);
  if (!isTransporter && !mine) {
    throw new ApiError('AUTH_FORBIDDEN', "You don't have access to this trip.");
  }

  const destination = {
    name: trip.destination.name || 'Destination mandi',
    lat: trip.destination.lat as number,
    lng: trip.destination.lng as number,
  };

  let trackable = TRACKABLE_TRIP_STATES.includes(trip.state);
  let reason: string | undefined;
  if (['COMPLETED', 'CANCELLED'].includes(trip.state)) {
    trackable = false;
    reason = 'This trip has finished.';
  } else if (trip.state === 'FORMING') {
    trackable = false;
    reason = 'The driver is still taking on loads and has not set off.';
  } else if (mine && TRACKING_ENDED_FOR_SHIPMENT.includes(mine.state)) {
    trackable = false;
    reason = 'Your produce has been delivered — live tracking has ended.';
  }

  const vehicle = await Vehicle.findById(trip.vehicleId);
  const loc = vehicle?.currentLocation;
  const origin =
    loc && loc.lat != null && loc.lng != null
      ? { lat: loc.lat as number, lng: loc.lng as number }
      : null;
  const lastSeenAt =
    origin && vehicle?.updatedAt ? new Date(vehicle.updatedAt as unknown as Date).toISOString() : null;
  const staleMinutes = lastSeenAt
    ? Math.max(0, Math.round((Date.now() - new Date(lastSeenAt).getTime()) / 60000))
    : null;

  // https://developers.google.com/maps/documentation/urls/get-started#directions-action
  // origin omitted → Google Maps uses the device's own location, which is a safe
  // fallback when the driver has not pinged yet.
  const base = 'https://www.google.com/maps/dir/?api=1';
  const directionsUrl = trackable
    ? `${base}${origin ? `&origin=${origin.lat},${origin.lng}` : ''}` +
      `&destination=${destination.lat},${destination.lng}&travelmode=driving`
    : null;

  if (trackable && !origin) {
    reason = 'The driver has not shared a location yet — this will open the route to the mandi.';
  }

  return {
    tripId: String(trip._id),
    tripState: trip.state,
    trackable,
    reason,
    origin,
    destination,
    lastSeenAt,
    stale: staleMinutes != null && staleMinutes > LOCATION_STALE_MINUTES,
    staleMinutes,
    directionsUrl,
  };
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

  // one set of numbers for both sides of the trip — the farmer reads their own
  // share out of `pricing.shares`, the driver reads totalCost / transporterEarning
  const pricing = await priceTripById(tripId);
  const shareOf = new Map((pricing?.shares ?? []).map((share) => [share.shipmentId, share]));

  /*
   * Capture a continuity snapshot on the way past (ADR-044).
   *
   * Fire-and-forget: this is a display-only convenience, so it must never delay
   * or fail the response that produced it. If the database later goes away, this
   * is what lets the farmer still see their trip — clearly stamped with when it
   * was true, never presented as live.
   */
  const capacityNow = await capacityOf(trip);
  void putTripSnapshot({
    tripId: String(trip._id),
    state: trip.state,
    destination: trip.destination?.name ?? '',
    routeDistanceKm: trip.routeDistanceKm,
    capacity: capacityNow,
    poolSize: shipments.filter((s) => s.state !== 'CANCELLED').length,
    pricingVersion: trip.pricingVersion,
    totalCost: pricing?.totalCost ?? null,
    shipments: shipments.map((s) => ({
      shipmentId: String(s._id),
      farmerId: String(s.farmerId),
      state: s.state,
      amount: s.finalPrice ?? s.allocatedPrice ?? null,
    })),
  }).catch(() => undefined);

  return {
    trip: { ...trip.toJSON(), capacity: await capacityOf(trip) },
    pricing,
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
      const share = shareOf.get(String(shipment._id));
      return {
        ...shipment.toJSON(),
        // a farmer sees their own pickup code; the driver never sees any of them
        pickupOtp: mine ? shipment.pickupOtp : undefined,
        // the working behind this load's bill, so a screen can explain it rather
        // than just assert a number
        pricing: share ?? null,
        savingPct: share
          ? share.savingPct
          : savingPct(shipment.soloPrice, shipment.finalPrice ?? shipment.allocatedPrice),
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
