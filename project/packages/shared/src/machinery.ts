/**
 * The Farm Resource Network — machinery and farm services (V2).
 *
 * KisanPool V1 turned an under-used *vehicle* into shared capacity. This is the
 * same idea applied to the other resource sitting idle in every village: a
 * tractor that works twenty days a year, a harvester that runs for one season, a
 * rotavator borrowed twice and parked for eleven months.
 *
 * The two networks are deliberately separate modules with separate models. A
 * machine booking is a *custom-hiring* job — one provider, one farmer, one time
 * window, priced per hour or per acre — not a transport request with a different
 * label. Forcing it through Trip/TripShipment would have meant a "trip" with no
 * route, a "shipment" with no cargo, and a pooled price split across nobody.
 */

// ---------------------------------------------------------------------------
// what can be hired
// ---------------------------------------------------------------------------

/**
 * Deliberately a flat, open list rather than a hierarchy.
 *
 * Rural equipment naming varies by district, and a two-level taxonomy would need
 * maintaining for no gain at this size. `OTHER` plus the machine's own free-text
 * title is what keeps this extensible without a migration every time a new
 * implement shows up.
 */
export const MACHINE_CATEGORIES = [
  'TRACTOR',
  'TRACTOR_TROLLEY',
  'COMBINE_HARVESTER',
  'HARVESTER',
  'ROTAVATOR',
  'CULTIVATOR',
  'SEED_DRILL',
  'THRESHER',
  'SPRAYER',
  'REAPER',
  'PLOUGH',
  'LEVELLER',
  'WATER_TANKER',
  'BALER',
  'OTHER',
] as const;
export type MachineCategory = (typeof MACHINE_CATEGORIES)[number];

/** Whether the hire includes a driver/operator. Drives both price and eligibility. */
export const OPERATOR_MODES = [
  /** the machine only — the farmer drives it themselves */
  'SELF_DRIVE',
  /** machine plus the provider's operator; the usual custom-hiring arrangement */
  'WITH_OPERATOR',
  /** the provider offers either, and the farmer picks per booking */
  'EITHER',
] as const;
export type OperatorMode = (typeof OPERATOR_MODES)[number];

/** What a booking actually asked for — never 'EITHER', which is only an offer. */
export const BOOKING_OPERATOR_MODES = ['SELF_DRIVE', 'WITH_OPERATOR'] as const;
export type BookingOperatorMode = (typeof BOOKING_OPERATOR_MODES)[number];

// ---------------------------------------------------------------------------
// how it is charged
// ---------------------------------------------------------------------------

/**
 * The unit a provider quotes in. Which unit suits which machine is a real-world
 * fact, not a preference: harvesting is sold by the acre because that is the work
 * done, a tractor with a trolley is sold by the hour because the work varies, and
 * a thresher is often taken for a whole day.
 *
 * The engine converts a booking into billable units of whichever unit the
 * provider chose, so one formula serves all four.
 */
export const PRICING_UNITS = ['PER_HOUR', 'PER_ACRE', 'PER_DAY', 'PER_JOB'] as const;
export type PricingUnit = (typeof PRICING_UNITS)[number];

export const PRICING_UNIT_LABEL: Record<PricingUnit, string> = {
  PER_HOUR: 'per hour',
  PER_ACRE: 'per acre',
  PER_DAY: 'per day',
  PER_JOB: 'per job',
};

/** The units that make sense for each category — the app offers these, the server enforces them. */
export const DEFAULT_UNIT_FOR: Record<MachineCategory, PricingUnit> = {
  TRACTOR: 'PER_HOUR',
  TRACTOR_TROLLEY: 'PER_HOUR',
  COMBINE_HARVESTER: 'PER_ACRE',
  HARVESTER: 'PER_ACRE',
  ROTAVATOR: 'PER_ACRE',
  CULTIVATOR: 'PER_ACRE',
  SEED_DRILL: 'PER_ACRE',
  THRESHER: 'PER_DAY',
  SPRAYER: 'PER_ACRE',
  REAPER: 'PER_ACRE',
  PLOUGH: 'PER_ACRE',
  LEVELLER: 'PER_HOUR',
  WATER_TANKER: 'PER_JOB',
  BALER: 'PER_ACRE',
  OTHER: 'PER_HOUR',
};

/** A unit priced by area needs the farmer to say how much area — the server rejects it otherwise. */
export const AREA_BASED_UNITS: PricingUnit[] = ['PER_ACRE'];

// ---------------------------------------------------------------------------
// the machine's own lifecycle
// ---------------------------------------------------------------------------

export const MACHINE_STATUSES = [
  /** listed and taking bookings */
  'LISTED',
  /** temporarily withdrawn by the owner — existing bookings stand */
  'PAUSED',
  /** delisted; no new bookings */
  'RETIRED',
] as const;
export type MachineStatus = (typeof MACHINE_STATUSES)[number];

// ---------------------------------------------------------------------------
// one hire, start to finish
// ---------------------------------------------------------------------------

/**
 * A booking's lifecycle. Mirrors the shape V1 proved on TripShipment — a request
 * the other side may decline, then a committed job that advances through the work
 * and ends in money — but the states are the ones a hire actually has.
 *
 * REQUESTED reserves the slot. That is the deliberate difference from V1's
 * transporter offer, which reserves nothing: a farmer asking for a harvester on
 * Tuesday morning is asking for one specific slot, and there is nothing to pool
 * or compare afterwards. Holding it while the provider answers is what stops two
 * farmers being told the same slot is free.
 */
export const MACHINE_BOOKING_STATES = [
  /** farmer asked; the slot is held while the provider decides */
  'REQUESTED',
  /** provider said yes — the job is on */
  'CONFIRMED',
  /** provider or machine is on the way / work has begun */
  'IN_PROGRESS',
  /** work finished; the bill is final */
  'COMPLETED',
  /** billed and settled */
  'PAID',
  /** withdrawn by the farmer before the work started */
  'CANCELLED',
  /** the provider could not take it */
  'DECLINED',
] as const;
export type MachineBookingState = (typeof MACHINE_BOOKING_STATES)[number];

export const MACHINE_BOOKING_TRANSITIONS: Record<MachineBookingState, MachineBookingState[]> = {
  REQUESTED: ['CONFIRMED', 'DECLINED', 'CANCELLED'],
  CONFIRMED: ['IN_PROGRESS', 'CANCELLED'],
  IN_PROGRESS: ['COMPLETED'],
  COMPLETED: ['PAID'],
  PAID: [],
  CANCELLED: [],
  DECLINED: [],
};

export const canTransitionMachineBooking = (
  from: MachineBookingState,
  to: MachineBookingState,
): boolean => MACHINE_BOOKING_TRANSITIONS[from].includes(to);

/**
 * States that hold the machine's time.
 *
 * Availability is DERIVED from these on every read, exactly as V1 derives vehicle
 * capacity from its shipments (ADR-030). There is no availability counter and no
 * calendar table to fall out of step with the bookings that are the real truth.
 */
export const OCCUPIES_SCHEDULE: MachineBookingState[] = [
  'REQUESTED',
  'CONFIRMED',
  'IN_PROGRESS',
];

/** A booking whose work is done — it no longer blocks the calendar but still bills. */
export const BILLABLE_BOOKING_STATES: MachineBookingState[] = ['COMPLETED', 'PAID'];

// ---------------------------------------------------------------------------
// DTOs
// ---------------------------------------------------------------------------

export interface MachinePricingDTO {
  unit: PricingUnit;
  /** rupees per unit — set by the provider, never by the platform */
  rate: number;
  /** the provider will not turn out for less than this, however small the job */
  minimumCharge: number;
  /** what the provider charges to bring the machine to the field, per km */
  travelRatePerKm: number;
}

export interface FarmMachineDTO {
  _id: string;
  ownerId: string;
  category: MachineCategory;
  /** the provider's own words — "Mahindra 575 with rotavator" */
  title: string;
  makeModel?: string;
  operatorMode: OperatorMode;
  /** implements or attachments this machine comes with */
  attachments: string[];
  baseLocation: { name: string; lat: number; lng: number };
  /** how far the provider will travel to a field */
  serviceRadiusKm: number;
  pricing: MachinePricingDTO;
  status: MachineStatus;
  /** owner-declared windows the machine cannot be booked in */
  blackouts: Array<{ start: string; end: string; reason?: string }>;
  createdAt: string;

  // joined on read, never stored here
  owner?: { _id: string; name: string; phone?: string; ratingAvg: number; ratingCount: number };
  /** km from the farmer's work site — only present on a search result */
  distanceKm?: number;
  /** jobs completed on this machine; the utilisation story in one number */
  completedJobs?: number;
  /** true when nothing conflicts with the window the farmer asked about */
  availableForWindow?: boolean;
}

/** The full working behind a quote, so a screen can explain the number it shows. */
export interface MachineQuoteDTO {
  unit: PricingUnit;
  rate: number;
  /** hours, acres, days or 1 — whatever the unit counts */
  billableUnits: number;
  /** rate × billableUnits, before travel and the minimum */
  workCost: number;
  /** distance from the machine's base to the field, one way */
  travelKm: number;
  /** charged both ways — the machine has to get home again */
  travelCost: number;
  /** what the minimum charge added, when the job was too small to reach it */
  minimumTopUp: number;
  total: number;
  platformFee: number;
  providerEarning: number;
}

export interface MachineBookingDTO {
  _id: string;
  machineId: string;
  providerId: string;
  farmerId: string;
  category: MachineCategory;
  operatorMode: BookingOperatorMode;
  window: { start: string; end: string };
  location: { name: string; lat: number; lng: number };
  /** what the machine is being hired to do — "sugarcane harvesting" */
  workType?: string;
  areaAcres?: number;
  notes?: string;
  state: MachineBookingState;
  quote: MachineQuoteDTO;
  /** what the farmer was finally billed — frozen at completion */
  finalAmount?: number;
  /** the farmer reads this out when the machine arrives */
  startOtp?: string;
  requestedAt: string;
  confirmedAt?: string;
  startedAt?: string;
  completedAt?: string;
  cancelledAt?: string;
  declineReason?: string;

  machine?: Pick<FarmMachineDTO, '_id' | 'category' | 'title' | 'makeModel' | 'baseLocation'>;
  provider?: { _id: string; name: string; phone?: string; ratingAvg: number };
  farmer?: { _id: string; name: string; phone?: string; ratingAvg: number };
}

/**
 * Nearby demand for one category, in one district, around one week.
 *
 * The cheapest useful form of demand aggregation: it tells a provider "four
 * farmers near you want a harvester this week" without any prediction model, and
 * it tells a farmer they are not the only one waiting — which is what makes a
 * provider worth calling out for.
 */
export interface DemandClusterDTO {
  category: MachineCategory;
  /** the rough centre of the demand */
  centre: { lat: number; lng: number };
  placeName: string;
  farmerCount: number;
  totalAcres: number;
  /** the span the requests fall in */
  from: string;
  to: string;
}

// ---------------------------------------------------------------------------
// socket events — delivery only; Mongo stays the source of truth
// ---------------------------------------------------------------------------

export interface MachineBookingRequestedEvent {
  bookingId: string;
  machineId: string;
  providerId: string;
  category: MachineCategory;
  window: { start: string; end: string };
  total: number;
}

export interface MachineBookingStateEvent {
  bookingId: string;
  machineId: string;
  state: MachineBookingState;
  at: string;
  /** present when the state change moved money */
  finalAmount?: number;
}
