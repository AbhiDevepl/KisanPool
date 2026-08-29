/**
 * The pooling vocabulary the UI is allowed to speak.
 *
 * THE RULE THIS FILE EXISTS TO ENFORCE
 * ------------------------------------
 * A transporter claiming a load is an EXPRESSION OF INTEREST. It is not a booking,
 * it reserves nothing, and several transporters may claim the same load at once.
 * Only the farmer's selection confirms anything — that is the step that creates a
 * shipment and reserves capacity, inside a transaction, server-side.
 *
 * So no screen may ever render an offer as a confirmed booking. Every label the
 * app shows for these two states comes from here, which makes the distinction a
 * property of the codebase rather than a thing each screen has to remember.
 *
 *   TRANSPORTER ACCEPTED   offer.state === 'INTERESTED'   nothing reserved
 *   FARMER CONFIRMED       shipment exists                capacity reserved
 */
import type { OfferState, RequestState, ShipmentState, TripCapacity } from '@kisanpool/shared';
import { OCCUPIES_CAPACITY } from '@kisanpool/shared';

export type Tone = 'neutral' | 'info' | 'warning' | 'success' | 'error';

export interface StateCopy {
  /** short badge text */
  label: string;
  /** one line explaining what the user should understand or do */
  detail: string;
  tone: Tone;
  /** the StatusBadge tone key */
  badge: string;
}

// ---------------------------------------------------------------------------
// the farmer's request
// ---------------------------------------------------------------------------

export const REQUEST_COPY: Record<RequestState, StateCopy> = {
  OPEN: {
    label: 'Finding transporters',
    detail: 'Your request is in the pool. Nearby verified drivers can see it now.',
    tone: 'info',
    badge: 'SEARCHING',
  },
  TRANSPORTER_INTERESTED: {
    // the pivotal state: transporters have accepted, but nothing is booked yet
    label: 'Awaiting your confirmation',
    detail: 'Transporters have accepted your request. Compare them and pick one to confirm.',
    tone: 'warning',
    badge: 'MATCHED',
  },
  CONFIRMED: {
    label: 'Booking confirmed',
    detail: 'You chose a transporter. Your space on the vehicle is reserved.',
    tone: 'success',
    badge: 'BOOKED',
  },
  CANCELLED: {
    label: 'Cancelled',
    detail: 'This request was withdrawn. Nothing was charged.',
    tone: 'error',
    badge: 'CANCELLED',
  },
  EXPIRED: {
    label: 'Expired',
    detail: 'No transporter claimed this before the pickup window closed.',
    tone: 'neutral',
    badge: 'EXPIRED',
  },
};

// ---------------------------------------------------------------------------
// a transporter's claim — as the TRANSPORTER sees it
// ---------------------------------------------------------------------------

export const OFFER_COPY: Record<OfferState, StateCopy> = {
  INTERESTED: {
    label: 'Accepted — awaiting farmer',
    detail: 'You accepted this load. It is not booked until the farmer chooses you.',
    tone: 'warning',
    badge: 'PENDING',
  },
  SELECTED: {
    label: 'Farmer confirmed you',
    detail: 'The farmer chose you. This load is booked and its weight is now reserved.',
    tone: 'success',
    badge: 'BOOKED',
  },
  REJECTED: {
    label: 'Farmer chose another',
    detail: 'The farmer went with a different transporter. Nothing was reserved.',
    tone: 'neutral',
    badge: 'REJECTED',
  },
  WITHDRAWN: {
    label: 'You withdrew',
    detail: 'You took this claim back before the farmer decided.',
    tone: 'neutral',
    badge: 'WITHDRAWN',
  },
  EXPIRED: {
    label: 'Expired',
    detail: 'This request closed before the farmer chose anyone.',
    tone: 'neutral',
    badge: 'EXPIRED',
  },
};

// ---------------------------------------------------------------------------
// one farmer's produce on the shared trip
// ---------------------------------------------------------------------------

export const SHIPMENT_COPY: Record<ShipmentState, StateCopy> = {
  ASSIGNED: {
    label: 'Confirmed',
    detail: 'Booked and reserved. Waiting for the driver to set off.',
    tone: 'success',
    badge: 'ASSIGNED',
  },
  EN_ROUTE: {
    label: 'Driver on the way',
    detail: 'The driver is heading to your pickup point.',
    tone: 'info',
    badge: 'EN_ROUTE',
  },
  ARRIVED: {
    label: 'Driver has arrived',
    detail: 'Read your pickup code out to the driver.',
    tone: 'warning',
    badge: 'ARRIVED',
  },
  PICKED_UP: {
    label: 'Loaded',
    detail: 'Your produce is on the vehicle.',
    tone: 'success',
    badge: 'PICKED_UP',
  },
  IN_TRANSIT: {
    label: 'On the way to the mandi',
    detail: 'Track the vehicle live on the map.',
    tone: 'info',
    badge: 'IN_TRANSIT',
  },
  DELIVERED: {
    label: 'Delivered',
    detail: 'Your produce reached the mandi. Your share is now final.',
    tone: 'success',
    badge: 'DELIVERED',
  },
  PAYMENT_PENDING: {
    label: 'Payment due',
    detail: 'Delivered. Pay your share to close this trip.',
    tone: 'warning',
    badge: 'PAYMENT_PENDING',
  },
  PAID: { label: 'Paid', detail: 'Payment received. Thank you.', tone: 'success', badge: 'PAID' },
  COMPLETED: { label: 'Completed', detail: 'This trip is closed.', tone: 'success', badge: 'COMPLETED' },
  CANCELLED: {
    label: 'Cancelled',
    detail: 'This load was cancelled.',
    tone: 'error',
    badge: 'CANCELLED',
  },
};

// ---------------------------------------------------------------------------
// the capacity ledger
// ---------------------------------------------------------------------------

/**
 * Four different truths about one vehicle, deliberately kept apart.
 *
 * `acceptedKg` is the one that must never be folded into the others: it is weight
 * the transporter has offered to carry but no farmer has confirmed, so it is NOT
 * reserved and it does not reduce `availableKg`. Treating a pending claim as
 * reserved capacity would stop other farmers being offered space that is in fact
 * still free, and would break pooling exactly when it matters most.
 *
 * The server derives committed/loaded/available from shipments; `acceptedKg` is
 * added here from the transporter's own open offers, because only they can see it.
 */
export interface CapacityLedger {
  /** the vehicle's rated capacity */
  totalKg: number;
  /** claimed by this transporter, awaiting a farmer's decision — NOT reserved */
  acceptedKg: number;
  /** confirmed by farmers; reserved and counted against availability */
  confirmedKg: number;
  /** physically in the vehicle right now */
  loadedKg: number;
  /** what a new farmer could still confirm into */
  availableKg: number;
}

export function ledgerFrom(capacity: TripCapacity, acceptedKg = 0): CapacityLedger {
  return {
    totalKg: capacity.totalKg,
    acceptedKg,
    confirmedKg: capacity.committedKg,
    loadedKg: capacity.loadedKg,
    availableKg: capacity.availableKg,
  };
}

/** The ledger for a transporter with no trip yet — the vehicle is wholly free. */
export function emptyLedger(totalKg: number, acceptedKg = 0): CapacityLedger {
  return { totalKg, acceptedKg, confirmedKg: 0, loadedKg: 0, availableKg: totalKg };
}

const pct = (part: number, whole: number): number =>
  whole > 0 ? Math.max(0, Math.min(100, (part / whole) * 100)) : 0;

/**
 * Stacked-bar segments for <ProgressTrack />: loaded, then confirmed-but-not-yet-
 * loaded. Accepted weight is drawn separately as a hatched hint, never as fill —
 * it has not consumed anything.
 */
export function ledgerSegments(
  ledger: CapacityLedger,
  colors: { loaded: string; confirmed: string },
): Array<{ pct: number; color: string }> {
  const loadedPct = pct(ledger.loadedKg, ledger.totalKg);
  const confirmedPct = pct(Math.max(0, ledger.confirmedKg - ledger.loadedKg), ledger.totalKg);
  return [
    { pct: loadedPct, color: colors.loaded },
    { pct: confirmedPct, color: colors.confirmed },
  ];
}

export const usedPct = (ledger: CapacityLedger): number =>
  Math.round(pct(ledger.confirmedKg, ledger.totalKg));

/** True when a load of this size can still be confirmed onto the vehicle. */
export const fits = (ledger: CapacityLedger, quantityKg: number): boolean =>
  quantityKg <= ledger.availableKg;

/** Weight the transporter has claimed but no farmer has confirmed. */
export function acceptedKgFrom(
  offers: Array<{ state: OfferState; request?: { quantityKg: number } | null }>,
): number {
  return offers
    .filter((offer) => offer.state === 'INTERESTED')
    .reduce((sum, offer) => sum + (offer.request?.quantityKg ?? 0), 0);
}

/** Shipment states that still hold reserved space — re-exported so screens agree. */
export const RESERVES_CAPACITY = OCCUPIES_CAPACITY;

/** A shipment the farmer should still be able to watch on a map. */
export const LIVE_SHIPMENT_STATES: ShipmentState[] = [
  'ASSIGNED',
  'EN_ROUTE',
  'ARRIVED',
  'PICKED_UP',
  'IN_TRANSIT',
];

/** A trip the transporter is still working. */
export const OPEN_TRIP_STATES = ['FORMING', 'EN_ROUTE', 'IN_TRANSIT', 'AT_DESTINATION'] as const;

// ---------------------------------------------------------------------------
// ranking the transporters who accepted
// ---------------------------------------------------------------------------

export interface ScorableOffer {
  savingPct: number;
  pickupDistanceKm: number;
  etaMinutes: number;
  poolSize: number;
  transporter?: { ratingAvg: number } | null;
}

/**
 * How well one accepted offer suits this farmer, 0–100.
 *
 * Derived, never stored: price saving dominates because that is why pooling
 * exists, then the driver's rating, then how close they already are. It only ever
 * ORDERS options the backend produced — it never changes a price or a promise.
 */
export function offerMatchScore(offer: ScorableOffer): number {
  const saving = Math.max(0, Math.min(45, offer.savingPct));           // 0–45
  const rating = ((offer.transporter?.ratingAvg ?? 0) / 5) * 25;        // 0–25
  const proximity = Math.max(0, 20 - offer.pickupDistanceKm);           // 0–20
  const pooling = Math.min(10, offer.poolSize * 5);                     // 0–10
  return Math.round(Math.max(0, Math.min(100, saving + rating + proximity + pooling)));
}
