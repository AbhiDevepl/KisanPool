/**
 * The Backhaul Network — the return half of every trip (V2).
 *
 * V1 pooled farmers into one outbound run so a truck went to the mandi full.
 * It then came home empty. On a 220 km run to Lasalgaon that is 220 km of diesel,
 * driver time and tyre wear earning nothing, and it is priced into every farmer's
 * outbound share whether anyone says so or not.
 *
 * A backhaul is a load going the other way. The vehicle is already making the
 * journey, so the marginal cost of carrying something home is small — which is
 * exactly why it can be sold cheaply and still be pure additional revenue.
 *
 *
 * WHY A SEPARATE REQUEST TYPE
 * ---------------------------
 * A backhaul load is not a farmer's produce request. It starts at a town and ends
 * in a village, it comes from a shopkeeper as often as a farmer, and it is offered
 * to ONE transporter who is already heading that way rather than pooled and
 * compared. `BackhaulRequest` is deliberately the smallest thing that can exist
 * without a farmer, a crop or a mandi behind it.
 *
 *
 * WHY IT IS A LEG, NOT A SECOND TRIP
 * ----------------------------------
 * One vehicle, one journey, two directions. Modelling the return as its own Trip
 * would have collided with V1's "one open trip per vehicle" unique index (ADR-032)
 * — correctly, because the vehicle really is not free. The return is a leg of the
 * trip that already exists.
 */
import type { VehicleType } from './types';

// ---------------------------------------------------------------------------
// what may be carried
// ---------------------------------------------------------------------------

/**
 * Cargo categories, each with the vehicle types that may legally and practically
 * carry it. This is a safety boundary, not a filter: §13 of the V2 brief is
 * explicit that not every vehicle can carry every category, and the prototype
 * stays conservative where the real rules are uncertain.
 *
 * The list is configuration — categories and their vehicle rules are meant to be
 * edited as a deployment learns its own district's rules, and the server
 * validates against whatever this says rather than trusting the client.
 */
export const CARGO_CATEGORIES = [
  'GENERAL_GOODS',
  'GROCERY_RETAIL',
  'AGRI_INPUTS',
  'PACKAGING_MATERIAL',
  'ANIMAL_FEED',
  'CONSTRUCTION_MATERIAL',
  'EMPTY_CRATES',
] as const;
export type CargoCategory = (typeof CARGO_CATEGORIES)[number];

export interface CargoRule {
  label: string;
  /** vehicle types allowed to carry it — the whitelist is the safety boundary */
  allowedVehicleTypes: VehicleType[];
  /** beyond this, the load needs arrangements this prototype does not model */
  maxWeightKg: number;
  /** shown to the requester, and to the driver before they accept */
  note?: string;
}

/**
 * Deliberately conservative.
 *
 * TRACTOR is excluded from every long-haul category: a tractor-trolley is a farm
 * vehicle, and in most Indian states it is not registered for commercial goods
 * carriage on highways. It stays eligible only for empty crates, which is a
 * short-hop, low-risk, genuinely common case.
 *
 * Anything requiring a licence we cannot verify — agrochemicals, fuel, anything
 * hazardous, anything perishable needing a cold chain — is simply absent. An
 * absent category cannot be booked by mistake, which is the safe failure mode.
 */
export const CARGO_RULES: Record<CargoCategory, CargoRule> = {
  GENERAL_GOODS: {
    label: 'General goods',
    allowedVehicleTypes: ['TRUCK', 'MINI_TRUCK', 'TEMPO', 'PICKUP'],
    maxWeightKg: 5000,
  },
  GROCERY_RETAIL: {
    label: 'Grocery & retail stock',
    allowedVehicleTypes: ['TRUCK', 'MINI_TRUCK', 'TEMPO', 'PICKUP'],
    maxWeightKg: 4000,
    note: 'Dry goods only. Nothing needing refrigeration.',
  },
  AGRI_INPUTS: {
    label: 'Agricultural inputs',
    allowedVehicleTypes: ['TRUCK', 'MINI_TRUCK', 'TEMPO', 'PICKUP'],
    maxWeightKg: 4000,
    note: 'Seed, tools and packaged soil inputs. No agrochemicals or pesticides.',
  },
  PACKAGING_MATERIAL: {
    label: 'Packaging material',
    allowedVehicleTypes: ['TRUCK', 'MINI_TRUCK', 'TEMPO', 'PICKUP'],
    maxWeightKg: 3000,
  },
  ANIMAL_FEED: {
    label: 'Animal feed',
    allowedVehicleTypes: ['TRUCK', 'MINI_TRUCK', 'TEMPO', 'PICKUP'],
    maxWeightKg: 5000,
  },
  CONSTRUCTION_MATERIAL: {
    label: 'Construction material',
    allowedVehicleTypes: ['TRUCK', 'MINI_TRUCK'],
    maxWeightKg: 6000,
    note: 'Heavy and abrasive — open-body vehicles only.',
  },
  EMPTY_CRATES: {
    label: 'Empty crates & sacks',
    allowedVehicleTypes: ['TRUCK', 'MINI_TRUCK', 'TEMPO', 'PICKUP', 'TRACTOR'],
    maxWeightKg: 1500,
    note: 'Light and bulky — the usual thing going back to the village.',
  },
};

/** The single eligibility test. Both the server and the app call this — never their own copy. */
export function cargoAllowedOn(
  category: CargoCategory,
  vehicleType: VehicleType,
  weightKg: number,
): { ok: true } | { ok: false; reason: string } {
  const rule = CARGO_RULES[category];
  if (!rule) return { ok: false, reason: 'That cargo category is not recognised.' };

  if (!rule.allowedVehicleTypes.includes(vehicleType)) {
    return {
      ok: false,
      reason: `A ${vehicleType.toLowerCase().replace(/_/g, ' ')} is not eligible to carry ${rule.label.toLowerCase()}.`,
    };
  }
  if (weightKg > rule.maxWeightKg) {
    return {
      ok: false,
      reason: `${rule.label} is limited to ${rule.maxWeightKg} kg on this platform.`,
    };
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// the return leg of a trip
// ---------------------------------------------------------------------------

/**
 * A trip's return leg opens only once the outbound work is done, which is what
 * keeps a backhaul from ever interfering with the farmers' produce (§5).
 */
export const RETURN_LEG_STATES = [
  /** no return leg yet — the outbound trip is still running */
  'NONE',
  /** outbound delivered; the driver is looking at return loads */
  'OPEN',
  /** at least one backhaul booked; the driver is collecting it */
  'LOADING',
  /** driving home with the return cargo */
  'IN_TRANSIT',
  /** every return load delivered */
  'COMPLETED',
  'CANCELLED',
] as const;
export type ReturnLegState = (typeof RETURN_LEG_STATES)[number];

export const RETURN_LEG_TRANSITIONS: Record<ReturnLegState, ReturnLegState[]> = {
  NONE: ['OPEN'],
  OPEN: ['LOADING', 'CANCELLED'],
  LOADING: ['IN_TRANSIT', 'CANCELLED'],
  IN_TRANSIT: ['COMPLETED', 'CANCELLED'],
  COMPLETED: [],
  CANCELLED: [],
};

export const canTransitionReturnLeg = (from: ReturnLegState, to: ReturnLegState): boolean =>
  RETURN_LEG_TRANSITIONS[from].includes(to);

// ---------------------------------------------------------------------------
// a return-load request, and its booking
// ---------------------------------------------------------------------------

export const BACKHAUL_REQUEST_STATES = [
  /** waiting for a transporter heading that way */
  'OPEN',
  /** a driver took it; it rides on their return leg */
  'BOOKED',
  'DELIVERED',
  'CANCELLED',
  /** nobody was heading that way before the ready window closed */
  'EXPIRED',
] as const;
export type BackhaulRequestState = (typeof BACKHAUL_REQUEST_STATES)[number];

export const BACKHAUL_BOOKING_STATES = [
  /** the driver accepted it onto their return leg */
  'BOOKED',
  'PICKED_UP',
  'IN_TRANSIT',
  'DELIVERED',
  'CANCELLED',
] as const;
export type BackhaulBookingState = (typeof BACKHAUL_BOOKING_STATES)[number];

export const BACKHAUL_BOOKING_TRANSITIONS: Record<BackhaulBookingState, BackhaulBookingState[]> = {
  BOOKED: ['PICKED_UP', 'CANCELLED'],
  PICKED_UP: ['IN_TRANSIT', 'CANCELLED'],
  IN_TRANSIT: ['DELIVERED'],
  DELIVERED: [],
  CANCELLED: [],
};

export const canTransitionBackhaul = (
  from: BackhaulBookingState,
  to: BackhaulBookingState,
): boolean => BACKHAUL_BOOKING_TRANSITIONS[from].includes(to);

/** Return loads that hold space on the vehicle. */
export const OCCUPIES_RETURN_CAPACITY: BackhaulBookingState[] = [
  'BOOKED',
  'PICKED_UP',
  'IN_TRANSIT',
];

// ---------------------------------------------------------------------------
// DTOs
// ---------------------------------------------------------------------------

export interface BackhaulRequestDTO {
  _id: string;
  /** any signed-in user — a farmer, a shopkeeper, an input dealer */
  requesterId: string;
  cargoCategory: CargoCategory;
  description: string;
  weightKg: number;
  pickup: { name: string; lat: number; lng: number };
  destination: { name: string; lat: number; lng: number };
  /** the window the goods can be collected in */
  readyFrom: string;
  readyUntil: string;
  state: BackhaulRequestState;
  /** what the requester is willing to pay, if they named a figure */
  offeredPrice?: number;
  notes?: string;
  createdAt: string;
  requester?: { _id: string; name: string; phone?: string; ratingAvg: number };
}

/**
 * One return load scored against one driver's actual homeward journey.
 *
 * Every number here is the reason the row is in the list, and the driver sees all
 * of them — a backhaul that pays well but adds 40 km is a worse deal than one
 * that pays less and is on the way, and only showing the fare would hide that.
 */
export interface BackhaulMatchDTO {
  request: BackhaulRequestDTO;
  /** km from where the driver is now (the mandi) to the cargo's pickup */
  pickupDistanceKm: number;
  /** km the homeward journey grows by taking this load */
  detourKm: number;
  /** minutes those extra km cost */
  addedMinutes: number;
  /** the leg this cargo actually rides */
  carryKm: number;
  /** what the driver earns for it, after the platform's cut */
  expectedEarning: number;
  /** empty kilometres this load turns into paid kilometres */
  emptyKmRecovered: number;
  /** share of the vehicle this load uses */
  utilisationPct: number;
  /** 0–1, deterministic; see backhaulScore in the matching module */
  fitScore: number;
  /** why it scored what it did, in words the driver can read */
  fitReason: string;
}

export interface BackhaulBookingDTO {
  _id: string;
  tripId: string;
  requestId: string;
  transporterId: string;
  requesterId: string;
  cargoCategory: CargoCategory;
  weightKg: number;
  pickup: { name: string; lat: number; lng: number };
  destination: { name: string; lat: number; lng: number };
  state: BackhaulBookingState;
  /** what the requester pays */
  price: number;
  /** what the driver keeps */
  transporterEarning: number;
  detourKm: number;
  pickupOtp?: string;
  bookedAt: string;
  deliveredAt?: string;
  requester?: { _id: string; name: string; phone?: string; ratingAvg: number };
}

/** The whole journey's economics, both directions, in one object. */
export interface TripUtilisationDTO {
  outboundKm: number;
  returnKm: number;
  totalKm: number;
  outboundEarning: number;
  returnEarning: number;
  totalEarning: number;
  /** kg carried out, and back */
  outboundLoadKg: number;
  returnLoadKg: number;
  capacityKg: number;
  /** how much of the round trip was driven with something aboard, 0–100 */
  utilisationPct: number;
  /** km that would have been driven empty and now are not */
  emptyKmRecovered: number;
}

// ---------------------------------------------------------------------------
// socket events
// ---------------------------------------------------------------------------

export interface BackhaulOfferedEvent {
  tripId: string;
  transporterId: string;
  /** how many compatible return loads are waiting for this driver */
  matchCount: number;
}

export interface BackhaulBookedEvent {
  tripId: string;
  requestId: string;
  bookingId: string;
  requesterId: string;
  transporterId: string;
}

export interface BackhaulStateEvent {
  tripId: string;
  bookingId: string;
  requestId: string;
  state: BackhaulBookingState;
  at: string;
}

export interface ReturnLegStateEvent {
  tripId: string;
  state: ReturnLegState;
  at: string;
}
