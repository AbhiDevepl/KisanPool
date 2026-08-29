/**
 * Signal gathering — the only place that reads the database for a prediction.
 *
 * It pulls real rows (trip, shipments, vehicle, the transporter's own history,
 * recent requests on the corridor), shapes them into the plain signal objects the
 * engine expects, and returns the engine's call unchanged. No scoring lives here;
 * no writing happens anywhere. Swapping the engine for a trained model later means
 * changing `engine.ts` only.
 */
import {
  OCCUPIES_CAPACITY,
  type DemandAssessment,
  type OpsPredictionDTO,
  type RiskAssessment,
  type TripPredictionDTO,
} from '@kisanpool/shared';
import { ApiError } from '../../lib/envelope';
import {
  TransportRequest,
  TransporterOffer,
  Trip,
  TripShipment,
  Vehicle,
} from '../../models';
import type { TripDoc } from '../../models';
import {
  type CancellationSignals,
  type DelaySignals,
  scoreCancellationRisk,
  scoreDelayRisk,
  scoreDemand,
} from './engine';

const minutesSince = (d: Date | null | undefined, now: number): number =>
  d ? Math.max(0, Math.round((now - new Date(d).getTime()) / 60000)) : 0;

const DELIVERED_OR_LATER = ['DELIVERED', 'PAYMENT_PENDING', 'PAID', 'COMPLETED'];
const COLLECTED_OR_LATER = ['PICKED_UP', 'IN_TRANSIT', ...DELIVERED_OR_LATER];

const DEMAND_WINDOW_DAYS = 7;

// ---------------------------------------------------------------------------
// one trip: delay + cancellation
// ---------------------------------------------------------------------------

async function delaySignalsFor(
  trip: TripDoc,
  now: number,
): Promise<DelaySignals> {
  const shipments = await TripShipment.find({
    tripId: trip._id,
    state: { $ne: 'CANCELLED' },
  }).sort({ pickupSequence: 1 });

  const vehicle = await Vehicle.findById(trip.vehicleId);

  const pickupsDone = shipments.filter((s) => COLLECTED_OR_LATER.includes(s.state)).length;
  const delivered = shipments.filter((s) => DELIVERED_OR_LATER.includes(s.state)).length;

  // the stop the driver is working now: first shipment not yet collected
  const lead = shipments.find((s) => !COLLECTED_OR_LATER.includes(s.state));

  // GPS freshness: the location handler bumps Vehicle on every ping, so the
  // vehicle's updatedAt is a fair proxy for "last heard from" while a trip runs.
  // Null when it has never reported a position.
  const minutesSinceLastPing =
    vehicle?.currentLocation && vehicle.updatedAt
      ? minutesSince(vehicle.updatedAt as unknown as Date, now)
      : null;

  return {
    tripState: trip.state,
    routeKm: trip.routeDistanceKm || 0,
    pickupCount: shipments.length,
    pickupsDone,
    delivered,
    minutesSinceStart: minutesSince(trip.startedAt as unknown as Date, now),
    etaMinutes: null,
    minutesSinceLastPing,
    leadShipmentStuckMinutes: lead ? minutesSince(lead.updatedAt as unknown as Date, now) : 0,
    // not persisted per pickup yet — progress-vs-plan carries this for now (ADR-041)
    pickupOverdueMinutes: 0,
  };
}

async function cancellationSignalsFor(
  trip: TripDoc,
  now: number,
): Promise<CancellationSignals> {
  const [completedTrips, cancelledTrips, offersMade, offersWithdrawn, firstShipment, vehicle] =
    await Promise.all([
      Trip.countDocuments({ transporterId: trip.transporterId, state: 'COMPLETED' }),
      Trip.countDocuments({ transporterId: trip.transporterId, state: 'CANCELLED' }),
      TransporterOffer.countDocuments({ transporterId: trip.transporterId }),
      TransporterOffer.countDocuments({ transporterId: trip.transporterId, state: 'WITHDRAWN' }),
      TripShipment.findOne({ tripId: trip._id, state: { $ne: 'CANCELLED' } }).sort({ createdAt: 1 }),
      Vehicle.findById(trip.vehicleId),
    ]);

  const minutesSinceLastPing =
    vehicle?.currentLocation && vehicle.updatedAt
      ? minutesSince(vehicle.updatedAt as unknown as Date, now)
      : null;

  return {
    tripState: trip.state,
    completedTrips,
    cancelledTrips,
    offersMade,
    offersWithdrawn,
    minutesSinceFirstConfirm: firstShipment
      ? minutesSince(firstShipment.createdAt as unknown as Date, now)
      : 0,
    vehicleOffline: vehicle?.status === 'OFFLINE',
    minutesSinceLastPing,
    pickupOverdueMinutes: 0,
  };
}

/** The delay call on its own — used by the realtime push where cancellation is not needed. */
export async function assessTripDelay(tripId: string): Promise<RiskAssessment | null> {
  const trip = await Trip.findById(tripId);
  if (!trip) return null;
  const now = Date.now();
  return scoreDelayRisk(await delaySignalsFor(trip, now), new Date(now).toISOString());
}

export async function assessTrip(
  tripId: string,
  opts: { includeCancellation: boolean },
): Promise<TripPredictionDTO> {
  const trip = await Trip.findById(tripId);
  if (!trip) throw new ApiError('RESOURCE_NOT_FOUND', 'That trip no longer exists.');

  const now = Date.now();
  const computedAt = new Date(now).toISOString();

  const delay = scoreDelayRisk(await delaySignalsFor(trip, now), computedAt);
  const dto: TripPredictionDTO = { tripId: String(trip._id), tripState: trip.state, delay };

  if (opts.includeCancellation) {
    dto.cancellation = scoreCancellationRisk(await cancellationSignalsFor(trip, now), computedAt);
  }
  return dto;
}

// ---------------------------------------------------------------------------
// demand across corridors
// ---------------------------------------------------------------------------

export async function assessDemand(): Promise<DemandAssessment[]> {
  const now = Date.now();
  const computedAt = new Date(now).toISOString();
  const since = new Date(now - DEMAND_WINDOW_DAYS * 86400000);

  // group requests by their destination mandi name
  const recent = await TransportRequest.find({ createdAt: { $gte: since } }).select(
    'destination state farmerId createdAt',
  );
  const openNow = await TransportRequest.find({
    state: { $in: ['OPEN', 'TRANSPORTER_INTERESTED'] },
  }).select('destination farmerId');
  const activeTrips = await Trip.find({ state: { $in: ['FORMING', 'EN_ROUTE', 'IN_TRANSIT'] } }).select(
    'destination',
  );
  const doneTrips = await Trip.find({ state: 'COMPLETED' }).select('destination');

  const byMandi = new Map<
    string,
    { recent: number; open: number; active: number; historical: number; farmers: Set<string> }
  >();
  const bucket = (name: string) => {
    const key = name || 'Unknown mandi';
    if (!byMandi.has(key))
      byMandi.set(key, { recent: 0, open: 0, active: 0, historical: 0, farmers: new Set() });
    return byMandi.get(key)!;
  };

  for (const r of recent) bucket(r.destination?.name ?? '').recent += 1;
  for (const r of openNow) {
    const b = bucket(r.destination?.name ?? '');
    b.open += 1;
    b.farmers.add(String(r.farmerId));
  }
  for (const t of activeTrips) bucket(t.destination?.name ?? '').active += 1;
  for (const t of doneTrips) bucket(t.destination?.name ?? '').historical += 1;

  return [...byMandi.entries()]
    .map(([mandi, b]) =>
      scoreDemand(
        {
          mandi,
          recentRequests: b.recent,
          windowDays: DEMAND_WINDOW_DAYS,
          openRequests: b.open,
          activeTrips: b.active,
          historicalTrips: b.historical,
          distinctFarmers: b.farmers.size,
        },
        computedAt,
      ),
    )
    .sort((a, b) => b.score - a.score);
}

// ---------------------------------------------------------------------------
// admin roll-up
// ---------------------------------------------------------------------------

export async function assessOps(): Promise<OpsPredictionDTO> {
  const now = Date.now();
  const trips = await Trip.find({ state: { $in: ['FORMING', 'EN_ROUTE', 'IN_TRANSIT'] } })
    .sort({ createdAt: -1 })
    .limit(40);

  const rows = await Promise.all(
    trips.map(async (trip) => {
      const computedAt = new Date(now).toISOString();
      const [delay, cancellation, transporter, poolSize] = await Promise.all([
        scoreDelayRisk(await delaySignalsFor(trip, now), computedAt),
        scoreCancellationRisk(await cancellationSignalsFor(trip, now), computedAt),
        (await import('../../models')).User.findById(trip.transporterId).select('name'),
        TripShipment.countDocuments({ tripId: trip._id, state: { $in: OCCUPIES_CAPACITY } }),
      ]);
      return {
        tripId: String(trip._id),
        to: trip.destination?.name ?? 'mandi',
        transporter: transporter?.name ?? 'Unknown',
        poolSize,
        delay,
        cancellation,
      };
    }),
  );

  // most urgent first: HIGH before MEDIUM, then by score
  const rank = { HIGH: 2, MEDIUM: 1, LOW: 0 } as const;
  rows.sort(
    (a, b) =>
      rank[b.delay.level] - rank[a.delay.level] ||
      rank[b.cancellation.level] - rank[a.cancellation.level] ||
      b.delay.score - a.delay.score,
  );

  return { generatedAt: new Date(now).toISOString(), trips: rows, demand: await assessDemand() };
}
