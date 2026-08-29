import {
  PLATFORM_COMMISSION_PCT,
  type PricingAllocation,
  type TripCapacity,
  OCCUPIES_CAPACITY,
  LOADED_STATES,
} from '@kisanpool/shared';
import { money } from '../../lib/geo';
import { PricingEvent, Trip, TripShipment, Vehicle } from '../../models';
import type { TripDoc, TripShipmentDoc } from '../../models';

/**
 * Shared pricing (PROMPT_2 §12).
 *
 * One route has one cost. Every farmer on it pays a share of that cost in
 * proportion to the weight they contribute — so the same truck run that cost one
 * farmer ₹500 alone costs ₹167 once two more join. That is the entire product
 * promise, and it was the thing the old per-request pricing never did: it charged
 * each farmer the full fare and let the vehicle collect it twice.
 *
 * Deterministic and explainable on purpose — no optimiser (PROMPT_1 §5).
 */

/** What the route costs the transporter to run, before it is split. */
export function routeCost(distanceKm: number, ratePerKm: number): number {
  return money(distanceKm * ratePerKm);
}

/**
 * Split a route cost across shipments by weight share.
 *
 * Weight is the fairest simple basis: it is what consumes the scarce resource
 * (capacity) and it is the one number every farmer already understands. Splitting
 * evenly would let a 50kg load pay the same as a 900kg one.
 */
export function allocateByWeight(
  cost: number,
  shipments: Array<{ id: string; quantityKg: number }>,
): Map<string, number> {
  const allocations = new Map<string, number>();
  const totalKg = shipments.reduce((sum, s) => sum + s.quantityKg, 0);
  if (!totalKg) return allocations;

  // allocate all but the last from the ratio, then give the remainder to the last
  // one so the shares always sum to exactly the route cost — never ±0.01 off
  let assigned = 0;
  shipments.forEach((shipment, index) => {
    if (index === shipments.length - 1) {
      allocations.set(shipment.id, money(cost - assigned));
      return;
    }
    const share = money((cost * shipment.quantityKg) / totalKg);
    allocations.set(shipment.id, share);
    assigned = money(assigned + share);
  });

  return allocations;
}

/** What one farmer would pay with the vehicle to themselves — the savings baseline. */
export function soloPrice(distanceKm: number, ratePerKm: number): number {
  return routeCost(distanceKm, ratePerKm);
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
 * Recompute every shipment's share and record why.
 *
 * Called whenever the pool changes — a farmer joins, cancels, or the route grows.
 * Writes a PricingEvent before touching the shipments, so the audit trail exists
 * even if the update below fails partway.
 */
export async function reallocate(
  tripId: string,
  reason: string,
): Promise<{ version: number; allocations: PricingAllocation[] }> {
  const trip = await Trip.findById(tripId);
  if (!trip) return { version: 0, allocations: [] };

  const vehicle = await Vehicle.findById(trip.vehicleId);
  const shipments = await TripShipment.find({
    tripId: trip._id,
    state: { $in: OCCUPIES_CAPACITY.concat(['DELIVERED', 'PAYMENT_PENDING']) },
  }).sort({ createdAt: 1 });

  // a delivered shipment's price is frozen; it no longer absorbs route changes
  const open = shipments.filter((s) => s.finalPrice == null);

  if (!open.length) {
    return { version: trip.pricingVersion, allocations: [] };
  }

  const cost = routeCost(trip.routeDistanceKm, vehicle?.ratePerKm ?? 0);
  const shares = allocateByWeight(
    cost,
    open.map((s) => ({ id: String(s._id), quantityKg: s.quantityKg })),
  );

  const allocations: PricingAllocation[] = open.map((shipment) => ({
    shipmentId: String(shipment._id),
    farmerId: String(shipment.farmerId),
    amount: shares.get(String(shipment._id)) ?? shipment.allocatedPrice,
    previousAmount: shipment.allocatedPrice,
  }));

  const version = trip.pricingVersion + 1;

  await PricingEvent.create({
    tripId: trip._id,
    version,
    reason,
    routeDistanceKm: trip.routeDistanceKm,
    routeCost: cost,
    totalQuantityKg: open.reduce((sum, s) => sum + s.quantityKg, 0),
    allocations: allocations.map((a, i) => ({
      shipmentId: a.shipmentId,
      farmerId: a.farmerId,
      quantityKg: open[i].quantityKg,
      amount: a.amount,
      previousAmount: a.previousAmount,
    })),
  });

  await Promise.all(
    allocations.map((a) =>
      TripShipment.updateOne({ _id: a.shipmentId }, { allocatedPrice: a.amount }),
    ),
  );

  trip.pricingVersion = version;
  trip.estimatedRouteCost = cost;
  await trip.save();

  return { version, allocations };
}

/** The transporter's earning on a trip: the route cost less the platform's cut. */
export function transporterEarning(cost: number): number {
  return money(cost * (1 - PLATFORM_COMMISSION_PCT));
}

export function platformFee(cost: number): number {
  return money(cost * PLATFORM_COMMISSION_PCT);
}

/** What a farmer saved by pooling, as a percentage of going alone. */
export function savingPct(solo: number, shared: number): number {
  if (solo <= 0) return 0;
  return Math.max(0, Math.round(((solo - shared) / solo) * 100));
}

export type { TripShipmentDoc };
