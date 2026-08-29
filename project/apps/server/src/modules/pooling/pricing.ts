import {
  type PricingAllocation,
  type ShipmentShareDTO,
  type TripCapacity,
  type TripPricingDTO,
  OCCUPIES_CAPACITY,
  LOADED_STATES,
} from '@kisanpool/shared';
import { money, type Point } from '../../lib/geo';
import { commissionRate } from '../../lib/money';
import { markCommitted, operationKey, recordIntent } from '../resilience/journal';
import { getDirections } from '../maps/service';
import { PricingEvent, Trip, TripShipment, Vehicle } from '../../models';
import type { TripDoc, TripShipmentDoc } from '../../models';

/**
 * Shared pricing — the ONE place a rupee is decided (PROMPT_2 §12, ADR-031/034).
 *
 * Nothing else in the codebase multiplies a distance by a rate. Every screen on
 * both sides renders what `priceTrip` returned, which is the only reason the
 * farmer's "your share" and the transporter's "trip value" can never disagree.
 *
 *
 * THE MODEL
 * ---------
 * A trip is one vehicle driving a chain of pickups into one mandi:
 *
 *     P₁ ──▶ P₂ ──▶ P₃ ──▶ mandi
 *
 * That whole chain costs `effectiveRouteKm × ratePerKm`, and that is the only
 * money in the system. It is split in two parts, both physically grounded, so
 * there is no arbitrary percentage anywhere:
 *
 *   1. DETOUR — inserting a pickup lengthens the chain. That growth is caused by
 *      exactly one farmer, so they pay for it whole. The load that set the route
 *      (P₁) causes no growth and pays no detour.
 *
 *   2. LINE-HAUL — what is left is the base run P₁→mandi, which everybody rides
 *      some of. It is split by TONNE-KILOMETRES: `tonnes × rideKm`, where rideKm
 *      is how far that produce actually travels on the vehicle. Tonne-km is the
 *      freight industry's own unit and it is the reason the two things the brief
 *      demands — load and distance — both move the price:
 *
 *          0.5t riding 20 km  →   10 t·km
 *          2.0t riding 100 km →  200 t·km   → pays 20× as much of the shared leg
 *
 * The parts sum to the total exactly, by construction:
 *
 *     Σ detourᵢ + baseRouteKm = effectiveRouteKm
 *
 * because each marginal detour is measured as the chain's own growth. No
 * normalising fudge, no leftover paisa.
 *
 *
 * WHY NOT SPLIT BY WEIGHT ALONE
 * -----------------------------
 * The previous engine divided one route cost by weight share. It was wrong in
 * both directions the brief calls out: a farmer 100 km up the road paid the same
 * per kilo as one 5 km from the mandi, and the route never grew when a distant
 * pickup joined, so the farmers already aboard silently paid for the newcomer's
 * detour. Equal splitting is worse still and is explicitly out.
 *
 *
 * WHAT IS FROZEN
 * --------------
 * A delivered load's bill is final. Reallocation therefore prices the whole trip,
 * subtracts what the frozen loads already owe, and shares only the remainder — so
 * a farmer who is still aboard never inherits the leg of one who has left.
 */

/** Metric everything is measured with. Cached in maps/service, so this is cheap. */
async function roadKm(from: Point, to: Point): Promise<number> {
  const { distanceKm } = await getDirections(from, to);
  return distanceKm;
}

/** What the route costs the transporter to run, before it is split. */
export function routeCost(distanceKm: number, ratePerKm: number): number {
  return money(distanceKm * ratePerKm);
}

/** What one farmer would pay with the vehicle to themselves — the savings baseline. */
export function soloPrice(distanceKm: number, ratePerKm: number): number {
  return routeCost(distanceKm, ratePerKm);
}

/** What a farmer saved by pooling, as a percentage of going alone. */
export function savingPct(solo: number, shared: number): number {
  if (solo <= 0) return 0;
  return Math.max(0, Math.round(((solo - shared) / solo) * 100));
}

/**
 * The transporter's earning on a trip: the route cost less the platform's cut.
 *
 * The percentage comes from `PLATFORM_FEE_PCT` via `commissionRate()`, which is
 * the same number the Payment row is actually split by — so what a driver is
 * shown on the trip screen and what Razorpay transfers cannot drift apart
 * (ADR-043). The split BETWEEN farmers above is untouched.
 */
export function transporterEarning(cost: number): number {
  return money(cost * (1 - commissionRate()));
}

export function platformFee(cost: number): number {
  return money(cost * commissionRate());
}

// ---------------------------------------------------------------------------
// the engine
// ---------------------------------------------------------------------------

/** One farmer's produce as the engine sees it — no Mongoose, so it is unit-testable. */
export interface PricedShipmentInput {
  id: string;
  farmerId: string;
  quantityKg: number;
  pickup: Point;
  /** the order the driver collects them in; ties break on id so runs are identical */
  sequence: number;
  /** set once delivered — the bill is final and no longer moves */
  frozenPrice?: number | null;
}

export interface PriceTripInput {
  ratePerKm: number;
  destination: Point;
  shipments: PricedShipmentInput[];
  version?: number;
}

const EMPTY_PRICING = (ratePerKm: number, version: number): TripPricingDTO => ({
  ratePerKm,
  effectiveRouteKm: 0,
  baseRouteKm: 0,
  totalCost: 0,
  baseCost: 0,
  detourCost: 0,
  totalQuantityKg: 0,
  totalTonneKm: 0,
  poolSize: 0,
  transporterEarning: 0,
  platformFee: 0,
  shares: [],
  version,
});

/**
 * Price a whole trip. Pure with respect to the database — hand it a hypothetical
 * pool and it prices that, which is how a quote for a farmer who has not joined
 * yet is guaranteed to equal what they will actually be allocated.
 */
export async function priceTrip(input: PriceTripInput): Promise<TripPricingDTO> {
  const { ratePerKm, destination, version = 0 } = input;
  const pool = [...input.shipments].sort(
    (a, b) => a.sequence - b.sequence || a.id.localeCompare(b.id),
  );

  if (!pool.length || ratePerKm <= 0) return EMPTY_PRICING(ratePerKm, version);

  // ---- geometry: the chain, and what each load rides of it -------------------
  //
  // closingKm[i] is the run from pickup i straight to the mandi; hopKm[i] is the
  // leg from pickup i to pickup i+1. Between them they describe every prefix of
  // the chain, which is what both the ride distances and the detours need.
  const closingKm: number[] = [];
  for (const shipment of pool) closingKm.push(await roadKm(shipment.pickup, destination));

  const hopKm: number[] = [];
  for (let i = 0; i < pool.length - 1; i += 1) {
    hopKm.push(await roadKm(pool[i].pickup, pool[i + 1].pickup));
  }

  /** The chain P₁ → … → P_k → mandi. routeTo(0) is the base route. */
  const routeTo = (k: number): number =>
    hopKm.slice(0, k).reduce((sum, leg) => sum + leg, 0) + closingKm[k];

  const baseRouteKm = Math.round(routeTo(0) * 10) / 10;
  const effectiveRouteKm = Math.round(routeTo(pool.length - 1) * 10) / 10;

  // rideKm: from this pickup onward — the rest of the hops plus the final run in
  const rideKm = pool.map((_, i) => {
    const remaining = hopKm.slice(i).reduce((sum, leg) => sum + leg, 0);
    return Math.round((remaining + closingKm[pool.length - 1]) * 10) / 10;
  });

  // detour: how much the chain grew when this pickup was appended to it. The
  // triangle inequality makes this non-negative; clamp anyway, road distances
  // are not a perfect metric.
  const detourKm = pool.map((_, i) =>
    i === 0 ? 0 : Math.max(0, Math.round((routeTo(i) - routeTo(i - 1)) * 10) / 10),
  );

  // ---- money -----------------------------------------------------------------
  const totalCost = routeCost(effectiveRouteKm, ratePerKm);
  const baseCost = routeCost(baseRouteKm, ratePerKm);
  const detourCost = money(totalCost - baseCost);

  const frozenTotal = money(
    pool.reduce((sum, s) => sum + (s.frozenPrice ?? 0), 0),
  );
  const openIndexes = pool.map((s, i) => (s.frozenPrice == null ? i : -1)).filter((i) => i >= 0);

  const detourCostOf = pool.map((_, i) => money(detourKm[i] * ratePerKm));
  const openDetourTotal = money(
    openIndexes.reduce((sum, i) => sum + detourCostOf[i], 0),
  );

  // whatever the delivered loads have not already taken, less the open loads' own
  // detours, is the shared line-haul still to be divided
  const lineHaulPool = Math.max(0, money(totalCost - frozenTotal - openDetourTotal));

  const tonneKm = pool.map((s, i) => Math.round((s.quantityKg / 1000) * rideKm[i] * 100) / 100);
  const openTonneKm = openIndexes.reduce((sum, i) => sum + tonneKm[i], 0);

  // divide by tonne-km, giving the last open load the remainder so the shares sum
  // to exactly the pool — never ±0.01 off
  const lineHaulOf = pool.map(() => 0);
  let assigned = 0;
  openIndexes.forEach((index, nth) => {
    if (nth === openIndexes.length - 1) {
      lineHaulOf[index] = money(lineHaulPool - assigned);
      return;
    }
    const slice = openTonneKm
      ? money((lineHaulPool * tonneKm[index]) / openTonneKm)
      : money(lineHaulPool / openIndexes.length);
    lineHaulOf[index] = slice;
    assigned = money(assigned + slice);
  });

  const shares: ShipmentShareDTO[] = pool.map((shipment, i) => {
    const frozen = shipment.frozenPrice != null;
    const amount = frozen ? money(shipment.frozenPrice as number) : money(detourCostOf[i] + lineHaulOf[i]);
    const solo = soloPrice(closingKm[i], ratePerKm);
    return {
      shipmentId: shipment.id,
      farmerId: shipment.farmerId,
      quantityKg: shipment.quantityKg,
      rideKm: rideKm[i],
      detourKm: detourKm[i],
      tonneKm: tonneKm[i],
      detourCost: frozen ? 0 : detourCostOf[i],
      lineHaulCost: frozen ? 0 : lineHaulOf[i],
      amount,
      soloPrice: solo,
      savingPct: savingPct(solo, amount),
      frozen,
    };
  });

  return {
    ratePerKm,
    effectiveRouteKm,
    baseRouteKm,
    totalCost,
    baseCost,
    detourCost,
    totalQuantityKg: pool.reduce((sum, s) => sum + s.quantityKg, 0),
    totalTonneKm: Math.round(tonneKm.reduce((sum, t) => sum + t, 0) * 100) / 100,
    poolSize: pool.length,
    transporterEarning: transporterEarning(totalCost),
    platformFee: platformFee(totalCost),
    shares,
    version,
  };
}

// ---------------------------------------------------------------------------
// database-facing helpers
// ---------------------------------------------------------------------------

/** Shipment states whose price is still live — cancelled loads are off the trip. */
const PRICED_STATES = OCCUPIES_CAPACITY.concat(['DELIVERED', 'PAYMENT_PENDING', 'PAID', 'COMPLETED']);

const asPoint = (p: { lat?: number | null; lng?: number | null }): Point => ({
  lat: p.lat as number,
  lng: p.lng as number,
});

const toInput = (shipment: TripShipmentDoc): PricedShipmentInput => ({
  id: String(shipment._id),
  farmerId: String(shipment.farmerId),
  quantityKg: shipment.quantityKg,
  pickup: asPoint(shipment.pickup),
  sequence: shipment.pickupSequence,
  frozenPrice: shipment.finalPrice ?? null,
});

/**
 * Price a trip as it stands in the database.
 *
 * `extra` prices a hypothetical joiner alongside the real pool without writing
 * anything — that is how an offer is quoted, and why the quote a farmer accepts
 * is the number they are then allocated.
 */
export async function priceTripById(
  tripId: string,
  extra?: Omit<PricedShipmentInput, 'sequence'>,
): Promise<TripPricingDTO | null> {
  const trip = await Trip.findById(tripId);
  if (!trip) return null;

  const vehicle = await Vehicle.findById(trip.vehicleId);
  const shipments = await TripShipment.find({
    tripId: trip._id,
    state: { $in: PRICED_STATES },
  }).sort({ pickupSequence: 1, createdAt: 1 });

  const pool = shipments.map(toInput);
  if (extra) pool.push({ ...extra, sequence: pool.length });

  return priceTrip({
    ratePerKm: vehicle?.ratePerKm ?? 0,
    destination: asPoint(trip.destination),
    shipments: pool,
    version: trip.pricingVersion,
  });
}

/** Capacity is derived from shipments, never from a stored counter that can drift. */
export async function capacityOf(trip: TripDoc): Promise<TripCapacity> {
  const shipments = await TripShipment.find({ tripId: trip._id });

  const committedKg = shipments
    .filter((s) => OCCUPIES_CAPACITY.includes(s.state))
    .reduce((sum, s) => sum + s.quantityKg, 0);

  const loadedKg = shipments
    .filter((s) => LOADED_STATES.includes(s.state))
    .reduce((sum, s) => sum + s.quantityKg, 0);

  return {
    totalKg: trip.totalCapacityKg,
    committedKg,
    loadedKg,
    availableKg: Math.max(0, trip.totalCapacityKg - committedKg),
  };
}

/**
 * Recompute every open share and record why.
 *
 * Called whenever the pool changes — a farmer joins, cancels, or a load is
 * delivered and its bill freezes. Writes the PricingEvent before touching the
 * shipments, so the audit trail exists even if the update below fails partway.
 */
export async function reallocate(
  tripId: string,
  reason: string,
): Promise<{ version: number; allocations: PricingAllocation[]; pricing: TripPricingDTO | null }> {
  const trip = await Trip.findById(tripId);
  if (!trip) return { version: 0, allocations: [], pricing: null };

  const pricing = await priceTripById(tripId);
  if (!pricing || !pricing.shares.length) {
    return { version: trip.pricingVersion, allocations: [], pricing };
  }

  const shipments = await TripShipment.find({
    _id: { $in: pricing.shares.map((s) => s.shipmentId) },
  });
  const previousOf = new Map(shipments.map((s) => [String(s._id), s.allocatedPrice]));

  const open = pricing.shares.filter((share) => !share.frozen);
  const allocations: PricingAllocation[] = open.map((share) => ({
    shipmentId: share.shipmentId,
    farmerId: share.farmerId,
    amount: share.amount,
    previousAmount: previousOf.get(share.shipmentId) ?? null,
  }));

  const version = trip.pricingVersion + 1;

  await PricingEvent.create({
    tripId: trip._id,
    version,
    reason,
    routeDistanceKm: pricing.effectiveRouteKm,
    routeCost: pricing.totalCost,
    totalQuantityKg: pricing.totalQuantityKg,
    allocations: open.map((share) => ({
      shipmentId: share.shipmentId,
      farmerId: share.farmerId,
      quantityKg: share.quantityKg,
      rideKm: share.rideKm,
      detourKm: share.detourKm,
      tonneKm: share.tonneKm,
      detourCost: share.detourCost,
      lineHaulCost: share.lineHaulCost,
      amount: share.amount,
      previousAmount: previousOf.get(share.shipmentId) ?? null,
    })),
  });

  await Promise.all(
    allocations.map((a) =>
      TripShipment.updateOne({ _id: a.shipmentId }, { allocatedPrice: a.amount }),
    ),
  );

  // journalled so a reallocation interrupted by an incident can be recognised
  // afterwards: the key is the trip plus the VERSION it produced, and replay
  // simply asks whether the trip already reached that version (ADR-044)
  const intent = await recordIntent({
    eventType: 'PRICING_RECALCULATED',
    entityType: 'Trip',
    entityId: tripId,
    actorId: null,
    operationKey: operationKey('PRICING_RECALCULATED', tripId, String(version)),
    payload: { version, reason, totalCost: pricing.totalCost, poolSize: pricing.poolSize },
  });

  trip.pricingVersion = version;
  // the route itself grew or shrank with the pool — record what it actually is now
  trip.routeDistanceKm = pricing.effectiveRouteKm;
  trip.estimatedRouteCost = pricing.totalCost;
  await trip.save();
  await markCommitted(intent);

  return { version, allocations, pricing: { ...pricing, version } };
}

export type { TripShipmentDoc, TripPricingDTO };
