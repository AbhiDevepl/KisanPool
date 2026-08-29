import {
  PLATFORM_COMMISSION_PCT,
  cargoAllowedOn,
  type BackhaulMatchDTO,
  type CargoCategory,
  type VehicleType,
} from '@kisanpool/shared';
import { money, type Point } from '../../lib/geo';
import { getDirections } from '../maps/service';

/**
 * Backhaul pricing and matching (ADR-039).
 *
 * THE PRICING MODEL
 * -----------------
 * The driver is going home anyway. That is the whole economic insight, and it is
 * also the thing that makes it easy to price dishonestly — "free return!" is a lie
 * that costs the driver diesel. So the price is built from the two things carrying
 * a load *actually* costs them, and nothing else:
 *
 *   DETOUR    The homeward run grows from `M → H` to `M → P → D → H`. Those extra
 *             kilometres exist only because of this load, so this load pays for
 *             all of them. Same principle as the outbound engine (ADR-035).
 *
 *   CARRIAGE  The load also occupies space that could have gone to another load,
 *             so it pays a share of the kilometres it rides, in proportion to the
 *             capacity it consumes. A load filling the vehicle pays the carriage
 *             in full; one taking a fifth pays a fifth, leaving the rest of the
 *             truck — and the rest of the cost — genuinely available.
 *
 *       price = detourKm × rate  +  carryKm × rate × (weight / capacity)
 *
 * No invented multiplier, no "backhaul discount" percentage. The discount is
 * structural: the driver was already covering `M → H`, so the second term is a
 * fraction of a journey the farmers on the outbound leg have effectively paid to
 * position. That is why a return load can be cheap for the shipper and still be
 * pure additional revenue for the driver.
 *
 *
 * THE SCORE
 * ---------
 * `fitScore` ONLY orders the list. It never changes a price, and the driver sees
 * every input to it, because a load that pays ₹900 while adding 40 km is a worse
 * deal than one paying ₹600 on the way — and a single "recommended" badge would
 * hide exactly that.
 */

/** Past this, a return load stops being a backhaul and becomes a second job. */
export const MAX_BACKHAUL_DETOUR_KM = 35;
/** Beyond this from the mandi, collecting the load is its own trip. */
export const MAX_BACKHAUL_PICKUP_KM = 40;
/** Average road speed used to turn added km into added minutes for the driver. */
const AVERAGE_SPEED_KMH = 35;

export interface LegGeometry {
  /** where the driver is now — the mandi they just delivered at */
  origin: Point;
  /** where they are heading — where the outbound trip began */
  home: Point;
  /** the empty run this leg would otherwise be */
  emptyReturnKm: number;
}

export interface CandidateInput {
  pickup: Point;
  destination: Point;
  weightKg: number;
  cargoCategory: CargoCategory;
}

export interface VehicleInput {
  vehicleType: VehicleType;
  capacityKg: number;
  availableKg: number;
  ratePerKm: number;
}

export interface BackhaulQuote {
  pickupDistanceKm: number;
  carryKm: number;
  detourKm: number;
  addedMinutes: number;
  detourCost: number;
  carriageCost: number;
  price: number;
  platformFee: number;
  transporterEarning: number;
  emptyKmRecovered: number;
  utilisationPct: number;
}

/**
 * Price one return load against one driver's actual homeward journey.
 *
 * Pure with respect to the database — the match list, the accept call and the
 * stored booking all run this, so the number a driver taps is the number they get.
 */
export async function quoteBackhaul(
  leg: LegGeometry,
  candidate: CandidateInput,
  vehicle: VehicleInput,
): Promise<BackhaulQuote> {
  const [toPickup, carry, homeFromDrop] = await Promise.all([
    getDirections(leg.origin, candidate.pickup),
    getDirections(candidate.pickup, candidate.destination),
    getDirections(candidate.destination, leg.home),
  ]);

  const pickupDistanceKm = round1(toPickup.distanceKm);
  const carryKm = round1(carry.distanceKm);

  // what the homeward journey grows by: M→P→D→H against the plain M→H
  const withLoad = toPickup.distanceKm + carry.distanceKm + homeFromDrop.distanceKm;
  const detourKm = Math.max(0, round1(withLoad - leg.emptyReturnKm));

  const capacityShare = vehicle.capacityKg > 0
    ? Math.min(1, candidate.weightKg / vehicle.capacityKg)
    : 0;

  const detourCost = money(detourKm * vehicle.ratePerKm);
  const carriageCost = money(carryKm * vehicle.ratePerKm * capacityShare);
  const price = money(detourCost + carriageCost);

  return {
    pickupDistanceKm,
    carryKm,
    detourKm,
    addedMinutes: Math.round((detourKm / AVERAGE_SPEED_KMH) * 60),
    detourCost,
    carriageCost,
    price,
    platformFee: money(price * PLATFORM_COMMISSION_PCT),
    transporterEarning: money(price * (1 - PLATFORM_COMMISSION_PCT)),
    // kilometres that were going to be driven empty and now are not
    emptyKmRecovered: round1(Math.min(carryKm, leg.emptyReturnKm)),
    utilisationPct: Math.round(capacityShare * 100),
  };
}

/**
 * How well this load suits this journey, 0–1.
 *
 * Four inputs, each normalised to 0–1 and weighted. The weights order a list;
 * they are not a price, and nothing downstream multiplies money by them.
 *
 *   alignment  0.40  — the point of a backhaul is not driving extra kilometres
 *   loadFit    0.25  — a load that fills the truck beats three that rattle in it
 *   earning    0.20  — rupees per kilometre actually driven
 *   proximity  0.15  — a pickup at the mandi gate beats one 30 km out
 *
 * Alignment leads because a backhaul that adds 30 km to save an empty run has
 * spent most of what it earned. Deterministic: the same inputs always produce the
 * same order, so two drivers looking at the same load see the same ranking.
 */
export function backhaulScore(quote: BackhaulQuote): { fitScore: number; fitReason: string } {
  const alignment = 1 - Math.min(1, quote.detourKm / MAX_BACKHAUL_DETOUR_KM);
  const loadFit = Math.min(1, quote.utilisationPct / 100);
  const drivenKm = quote.carryKm + quote.detourKm;
  // ₹40/km is a good rate on this platform; that is the yardstick, not a price
  const earning = drivenKm > 0 ? Math.min(1, quote.transporterEarning / drivenKm / 40) : 0;
  const proximity = 1 - Math.min(1, quote.pickupDistanceKm / MAX_BACKHAUL_PICKUP_KM);

  const fitScore =
    alignment * 0.4 + loadFit * 0.25 + earning * 0.2 + proximity * 0.15;

  return {
    fitScore: Math.round(fitScore * 100) / 100,
    fitReason: reasonFor({ alignment, loadFit, quote }),
  };
}

/** The score in words — a driver reads "barely off your route", not "0.87". */
function reasonFor({
  alignment,
  loadFit,
  quote,
}: {
  alignment: number;
  loadFit: number;
  quote: BackhaulQuote;
}): string {
  const parts: string[] = [];

  if (quote.detourKm < 3) parts.push('almost exactly on your way home');
  else if (alignment > 0.6) parts.push(`only ${quote.detourKm.toFixed(0)} km off your route`);
  else parts.push(`${quote.detourKm.toFixed(0)} km out of your way`);

  if (loadFit > 0.6) parts.push('fills most of the empty vehicle');
  else if (loadFit > 0.25) parts.push('uses a good part of the space');

  if (quote.emptyKmRecovered > 20) {
    parts.push(`turns ${quote.emptyKmRecovered.toFixed(0)} empty km into paid km`);
  }

  return parts.join(' · ');
}

/**
 * Can this vehicle legally and physically take this load?
 *
 * Two separate questions, deliberately kept apart: eligibility is a rule about the
 * vehicle TYPE (§13), and capacity is a fact about what is already aboard. A
 * tractor is never eligible for retail stock however empty it is.
 */
export function checkEligibility(
  candidate: CandidateInput,
  vehicle: VehicleInput,
): { ok: true } | { ok: false; reason: string; kind: 'ELIGIBILITY' | 'CAPACITY' } {
  const legal = cargoAllowedOn(candidate.cargoCategory, vehicle.vehicleType, candidate.weightKg);
  if (!legal.ok) return { ok: false, reason: legal.reason, kind: 'ELIGIBILITY' };

  if (candidate.weightKg > vehicle.availableKg) {
    return {
      ok: false,
      reason: `That load is ${candidate.weightKg} kg and you have ${vehicle.availableKg} kg free on the return.`,
      kind: 'CAPACITY',
    };
  }
  return { ok: true };
}

export function toMatchDTO(
  request: BackhaulMatchDTO['request'],
  quote: BackhaulQuote,
): BackhaulMatchDTO {
  const { fitScore, fitReason } = backhaulScore(quote);
  return {
    request,
    pickupDistanceKm: quote.pickupDistanceKm,
    detourKm: quote.detourKm,
    addedMinutes: quote.addedMinutes,
    carryKm: quote.carryKm,
    expectedEarning: quote.transporterEarning,
    emptyKmRecovered: quote.emptyKmRecovered,
    utilisationPct: quote.utilisationPct,
    fitScore,
    fitReason,
  };
}

const round1 = (n: number): number => Math.round(n * 10) / 10;
