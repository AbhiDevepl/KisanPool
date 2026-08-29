/**
 * The pooled-transport domain.
 *
 * Three state machines, deliberately kept apart (PROMPT_1 §8, PROMPT_2 §16) — a
 * request, the trip carrying it, and one farmer's produce on that trip fail and
 * advance for different reasons, so collapsing them into one status field makes
 * every transition ambiguous.
 */

// ---------------------------------------------------------------------------
// 1. the farmer's request — its own lifecycle, ending when a transporter is chosen
// ---------------------------------------------------------------------------

export const REQUEST_STATES = [
  /** in the pool, visible to eligible nearby transporters */
  'OPEN',
  /** at least one transporter has claimed it; the farmer now has options to compare */
  'TRANSPORTER_INTERESTED',
  /** the farmer picked one; capacity is reserved and a shipment exists */
  'CONFIRMED',
  /** withdrawn by the farmer before confirming */
  'CANCELLED',
  /** nobody claimed it before the pickup window closed */
  'EXPIRED',
] as const;
export type RequestState = (typeof REQUEST_STATES)[number];

// ---------------------------------------------------------------------------
// 2. a transporter's claim on one request — many per request, one wins
// ---------------------------------------------------------------------------

export const OFFER_STATES = [
  /** the transporter wants this load */
  'INTERESTED',
  /** the transporter changed their mind before the farmer chose */
  'WITHDRAWN',
  /** the farmer chose this one */
  'SELECTED',
  /** the farmer chose someone else */
  'REJECTED',
  /** the request closed, or the offer went stale */
  'EXPIRED',
] as const;
export type OfferState = (typeof OFFER_STATES)[number];

// ---------------------------------------------------------------------------
// 3. the shared vehicle journey
// ---------------------------------------------------------------------------

export const TRIP_STATES = [
  /** accepting more farmers — capacity and route still open */
  'FORMING',
  /** the transporter has stopped taking loads and is heading to the first pickup */
  'EN_ROUTE',
  /** every pickup done, driving to the mandi */
  'IN_TRANSIT',
  /** arrived at the destination mandi */
  'AT_DESTINATION',
  /** all shipments delivered */
  'COMPLETED',
  'CANCELLED',
] as const;
export type TripState = (typeof TRIP_STATES)[number];

// ---------------------------------------------------------------------------
// 4. one farmer's produce on that journey — advances independently of the trip
// ---------------------------------------------------------------------------

export const SHIPMENT_STATES = [
  'ASSIGNED',
  'EN_ROUTE',
  'ARRIVED',
  'PICKED_UP',
  'IN_TRANSIT',
  'DELIVERED',
  'PAYMENT_PENDING',
  'PAID',
  'COMPLETED',
  'CANCELLED',
] as const;
export type ShipmentState = (typeof SHIPMENT_STATES)[number];

/** Legal shipment transitions — enforced server-side, never inferred from the client. */
export const SHIPMENT_TRANSITIONS: Record<ShipmentState, ShipmentState[]> = {
  ASSIGNED: ['EN_ROUTE', 'CANCELLED'],
  EN_ROUTE: ['ARRIVED', 'CANCELLED'],
  ARRIVED: ['PICKED_UP', 'CANCELLED'],
  PICKED_UP: ['IN_TRANSIT', 'CANCELLED'],
  IN_TRANSIT: ['DELIVERED'],
  DELIVERED: ['PAYMENT_PENDING'],
  PAYMENT_PENDING: ['PAID'],
  PAID: ['COMPLETED'],
  COMPLETED: [],
  CANCELLED: [],
};

export const TRIP_TRANSITIONS: Record<TripState, TripState[]> = {
  FORMING: ['EN_ROUTE', 'CANCELLED'],
  EN_ROUTE: ['IN_TRANSIT', 'CANCELLED'],
  IN_TRANSIT: ['AT_DESTINATION', 'CANCELLED'],
  AT_DESTINATION: ['COMPLETED'],
  COMPLETED: [],
  CANCELLED: [],
};

export const canTransitionShipment = (from: ShipmentState, to: ShipmentState): boolean =>
  SHIPMENT_TRANSITIONS[from].includes(to);

export const canTransitionTrip = (from: TripState, to: TripState): boolean =>
  TRIP_TRANSITIONS[from].includes(to);

/** A shipment still occupying capacity — used by every capacity calculation. */
export const OCCUPIES_CAPACITY: ShipmentState[] = [
  'ASSIGNED',
  'EN_ROUTE',
  'ARRIVED',
  'PICKED_UP',
  'IN_TRANSIT',
];

/** A shipment physically in the vehicle right now. */
export const LOADED_STATES: ShipmentState[] = ['PICKED_UP', 'IN_TRANSIT'];

// ---------------------------------------------------------------------------
// DTOs
// ---------------------------------------------------------------------------

export interface GeoPointDTO {
  name: string;
  lat: number;
  lng: number;
}

export interface TransporterOfferDTO {
  _id: string;
  requestId: string;
  transporterId: string;
  vehicleId: string;
  tripId: string | null;
  state: OfferState;
  /** what this farmer would pay if they picked this offer, from the backend only */
  quotedPrice: number;
  /** what they'd pay with nobody else aboard — the two together give the saving */
  soloPrice: number;
  savingPct: number;
  pickupDistanceKm: number;
  detourKm: number;
  etaMinutes: number;
  message?: string;
  createdAt: string;
  transporter?: {
    _id: string;
    name: string;
    ratingAvg: number;
    ratingCount: number;
  };
  vehicle?: {
    _id: string;
    registrationNumber: string;
    vehicleType: string;
    capacityKg: number;
    remainingCapacityKg: number;
  };
  /** who else is already on this trip — the farmer is joining a pool, not a taxi */
  poolSize: number;
}

export interface TripCapacity {
  totalKg: number;
  /** reserved by confirmed shipments not yet delivered */
  committedKg: number;
  /** physically in the vehicle right now */
  loadedKg: number;
  availableKg: number;
}

export interface TripDTO {
  _id: string;
  transporterId: string;
  vehicleId: string;
  destination: GeoPointDTO;
  state: TripState;
  capacity: TripCapacity;
  routeDistanceKm: number;
  estimatedRouteCost: number;
  pricingVersion: number;
  startedAt?: string;
  completedAt?: string;
  shipments?: TripShipmentDTO[];
}

export interface TripShipmentDTO {
  _id: string;
  tripId: string;
  requestId: string;
  farmerId: string;
  quantityKg: number;
  cropType: string;
  pickup: GeoPointDTO;
  pickupSequence: number;
  state: ShipmentState;
  allocatedPrice: number;
  finalPrice?: number;
  soloPrice: number;
  pickupOtp?: string;
  pickedUpAt?: string;
  deliveredAt?: string;
  farmer?: { _id: string; name: string; phone?: string; ratingAvg: number };
}

export interface PricingAllocation {
  shipmentId: string;
  farmerId: string;
  amount: number;
  previousAmount: number | null;
}

export interface PricingEventDTO {
  _id: string;
  tripId: string;
  version: number;
  reason: string;
  routeDistanceKm: number;
  routeCost: number;
  allocations: PricingAllocation[];
  createdAt: string;
}

// ---------------------------------------------------------------------------
// socket events (PROMPT_2 §13, §14) — delivery only; Mongo stays the source of truth
// ---------------------------------------------------------------------------

export interface OfferReceivedEvent {
  requestId: string;
  offer: TransporterOfferDTO;
}

export interface OfferWithdrawnEvent {
  requestId: string;
  offerId: string;
}

export interface TransporterSelectedEvent {
  requestId: string;
  tripId: string;
  shipmentId: string;
  transporterId: string;
}

export interface PricingUpdatedEvent {
  tripId: string;
  pricingVersion: number;
  reason: string;
  updates: Array<{ farmerId: string; shipmentId: string; amount: number; previousAmount: number | null }>;
}

export interface TripCapacityEvent {
  tripId: string;
  capacity: TripCapacity;
  poolSize: number;
}

export interface ShipmentStateEvent {
  tripId: string;
  shipmentId: string;
  requestId: string;
  state: ShipmentState;
  at: string;
}

// ---------------------------------------------------------------------------
// pricing constants
// ---------------------------------------------------------------------------

/** Platform's cut of the route cost. The rest is the transporter's earning. */
export const PLATFORM_COMMISSION_PCT = 0.1;

/** A detour costs the trip real distance; it is added to the route before splitting. */
export const DETOUR_WEIGHT = 1.0;

/** Below this, a vehicle is not worth offering to — avoids 5kg loads on a 4t truck. */
export const MIN_UTILISATION = 0.02;
