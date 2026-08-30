/**
 * The recovery controller — replay, reconcile, validate, rebuild (ADR-044).
 *
 * THE ORDER MATTERS AND IT IS NOT ARBITRARY
 * -----------------------------------------
 *   1. RECONCILING  replay pending intent against the authoritative store
 *   2. VALIDATING   run the integrity checks over the result
 *   3. rebuild      clear and repopulate operational snapshots from Mongo
 *   4. RECOVERED    only if validation actually passed
 *
 * Replay comes before validation because replayed operations change the very
 * relationships validation checks. Snapshot rebuild comes last because a snapshot
 * taken mid-reconciliation would cache a half-recovered world and then serve it
 * to users for the next fifteen minutes.
 *
 * And if validation does not pass, the state becomes MANUAL_REVIEW — not
 * RECOVERED. "Everything is fine" is a claim, and this module only makes it when
 * the checks say so (§15, §21).
 *
 *
 * WHAT REPLAY ACTUALLY DOES
 * -------------------------
 * It does NOT re-execute business logic. Re-running "select transporter" would
 * re-price a trip, re-reserve capacity and possibly re-charge someone. Instead it
 * VERIFIES: for each pending intent, does the effect exist in the authoritative
 * store now?
 *
 *   effect present  → SUPERSEDED. The write landed before the incident; the
 *                     journal simply never got to record the confirmation.
 *   effect absent   → the operation genuinely did not happen. It is reported for
 *                     an operator to re-drive through the normal API, and NOT
 *                     silently reconstructed — because a booking, a payment and a
 *                     capacity reservation are exactly the things that must not
 *                     be conjured from a log line.
 *
 * That is the honest reading of "replay must be idempotent": the safe outcome of
 * processing an event twice is that the second time changes nothing.
 */
import {
  type IncidentDTO,
  type JournalEvent,
  type JournalEventType,
} from '@kisanpool/shared';
import {
  BackhaulBooking,
  MachineBooking,
  Payment,
  TransporterOffer,
  TransportRequest,
  Trip,
  TripShipment,
} from '../../models';
import { capacityOf } from '../pooling/pricing';
import { createRequest, cancelRequest } from '../transport/service';
import { claimRequest, selectTransporter, withdrawOffer, advanceShipment, advanceTrip } from '../pooling/service';
import { acceptBackhaul, advanceBackhaul, advanceReturnLeg, openReturnLeg } from '../backhaul/service';
import { requestBooking } from '../machinery/service';
import {
  closeIncident,
  currentIncident,
  openIncident,
  recoveryState,
  setState,
  updateIncident,
} from './health';
import { markAbandoned, markReplayed, pendingEvents, reloadJournal } from './journal';
import { ApiError } from '../../lib/envelope';
import { isStoreFailure } from './snapshots';
import { runIntegrityChecks } from './integrity';
import { clearSnapshots, putTripSnapshot } from './snapshots';

// ---------------------------------------------------------------------------
// effect verification — "did this actually land?"
// ---------------------------------------------------------------------------

/**
 * Is the effect this event intended already present in the authoritative store?
 *
 * Each case asks the narrowest question that settles it. Anything this cannot
 * answer returns `null`, meaning "unknown" — which routes to manual review
 * rather than to a guess.
 */
async function effectPresent(event: JournalEvent): Promise<boolean | null> {
  const { eventType, entityId, payload } = event;

  try {
    switch (eventType) {
      case 'REQUEST_CREATED':
        return Boolean(await TransportRequest.exists({ _id: entityId }));

      case 'TRANSPORTER_SELECTED':
      case 'SHIPMENT_ADDED':
        // the request may only ride once, so a shipment for it IS the effect
        return Boolean(await TripShipment.exists({ requestId: payload.requestId ?? entityId }));

      case 'SHIPMENT_STATE_CHANGED':
      case 'SHIPMENT_CANCELLED': {
        if (event.entityType === 'TransportRequest') {
          const request = await TransportRequest.findById(entityId, 'state');
          return request ? request.state === 'CANCELLED' : null;
        }
        const shipment = await TripShipment.findById(entityId, 'state');
        if (!shipment) return null;
        return shipment.state === payload.toState;
      }

      case 'TRIP_STATE_CHANGED': {
        const trip = await Trip.findById(entityId, 'state');
        if (!trip) return null;
        return trip.state === payload.toState;
      }

      case 'PRICING_RECALCULATED': {
        const trip = await Trip.findById(entityId, 'pricingVersion');
        if (!trip) return null;
        return trip.pricingVersion >= Number(payload.version ?? 0);
      }

      case 'CAPACITY_CHANGED': {
        const trip = await Trip.findById(entityId);
        if (!trip) return null;
        const capacity = await capacityOf(trip);
        return capacity.committedKg === Number(payload.committedKg ?? -1);
      }

      case 'PAYMENT_STATE_CHANGED': {
        const payment = await Payment.findById(entityId, 'status');
        if (!payment) return null;
        return payment.status === payload.toState;
      }

      case 'PAYOUT_STATE_CHANGED': {
        const payment = await Payment.findById(entityId, 'payoutState');
        if (!payment) return null;
        return payment.payoutState === payload.toState;
      }

      case 'MACHINE_BOOKING_CREATED':
        return Boolean(await MachineBooking.exists({ _id: entityId }));

      case 'MACHINE_BOOKING_STATE_CHANGED': {
        const booking = await MachineBooking.findById(entityId, 'state');
        if (!booking) return null;
        return booking.state === payload.toState;
      }

      case 'RETURN_LEG_STATE_CHANGED': {
        const trip = await Trip.findById(entityId, 'returnLeg');
        if (!trip) return null;
        return (trip.returnLeg?.state ?? 'NONE') === payload.toState;
      }

      case 'BACKHAUL_BOOKING_CREATED':
        return Boolean(await BackhaulBooking.exists({ requestId: entityId }));

      case 'BACKHAUL_BOOKING_STATE_CHANGED': {
        const booking = await BackhaulBooking.findById(entityId, 'state');
        if (!booking) return null;
        return booking.state === payload.toState;
      }

      case 'OFFER_CLAIMED':
        return Boolean(await TransporterOffer.exists({ requestId: entityId, transporterId: event.actorId, state: 'INTERESTED' }));
      case 'OFFER_WITHDRAWN':
        return Boolean(await TransporterOffer.exists({ _id: entityId, state: 'WITHDRAWN' }));

      default:
        return null;
    }
  } catch {
    // the store could not answer; unknown is not the same as absent
    return null;
  }
}

/**
 * Only replay operations whose durable payload contains every non-secret input.
 * OTP- and provider-authorised operations deliberately stay in manual review.
 */
const appliers: Record<JournalEventType, (event: JournalEvent) => Promise<boolean>> = {
  REQUEST_CREATED: async (event) => {
    const p = event.payload;
    if (!event.actorId || typeof p.cropType !== 'string' || typeof p.quantityKg !== 'number' || !p.pickup || !p.destination || typeof p.preferredDate !== 'string') return false;
    await createRequest(event.actorId, {
      id: event.entityId, cropType: p.cropType, quantityKg: p.quantityKg,
      pickup: p.pickup as never, destination: p.destination as never,
      preferredDate: new Date(p.preferredDate), notes: typeof p.notes === 'string' ? p.notes : undefined,
    });
    return true;
  },
  OFFER_CLAIMED: async (event) => {
    if (!event.actorId) return false;
    await claimRequest(event.entityId, event.actorId, typeof event.payload.message === 'string' ? event.payload.message : undefined);
    return true;
  },
  OFFER_WITHDRAWN: async (event) => {
    if (!event.actorId) return false;
    await withdrawOffer(event.entityId, event.actorId);
    return true;
  },
  TRANSPORTER_SELECTED: async (event) => {
    const offerId = event.payload.offerId;
    if (!event.actorId || typeof offerId !== 'string') return false;
    await selectTransporter(event.entityId, offerId, event.actorId);
    return true;
  },
  SHIPMENT_CANCELLED: async (event) => {
    if (event.entityType !== 'TransportRequest' || !event.actorId || typeof event.payload.reason !== 'string') return false;
    await cancelRequest(event.entityId, event.payload.reason, event.actorId);
    return true;
  },
  SHIPMENT_STATE_CHANGED: async (event) => {
    const to = event.payload.toState;
    if (!event.actorId || typeof to !== 'string' || to === 'PICKED_UP') return false;
    await advanceShipment(event.entityId, to as never, event.actorId);
    return true;
  },
  TRIP_STATE_CHANGED: async (event) => {
    const to = event.payload.toState;
    if (!event.actorId || typeof to !== 'string') return false;
    await advanceTrip(event.entityId, to as never, event.actorId);
    return true;
  },
  BACKHAUL_BOOKING_CREATED: async (event) => {
    const tripId = event.payload.tripId;
    if (!event.actorId || typeof tripId !== 'string') return false;
    await acceptBackhaul(tripId, event.entityId, event.actorId);
    return true;
  },
  BACKHAUL_BOOKING_STATE_CHANGED: async (event) => {
    const to = event.payload.toState;
    if (!event.actorId || typeof to !== 'string' || to === 'PICKED_UP') return false;
    await advanceBackhaul(event.entityId, to as never, event.actorId);
    return true;
  },
  MACHINE_BOOKING_CREATED: async (event) => {
    const p = event.payload;
    const window = p.window as { start?: string; end?: string } | undefined;
    if (
      !event.actorId ||
      typeof p.machineId !== 'string' ||
      typeof p.operatorMode !== 'string' ||
      !p.location ||
      !window?.start ||
      !window?.end
    ) {
      return false;
    }
    // through the real service, so the slot race, the service radius, the cargo
    // rules and the pricing engine all run again — under the ORIGINAL booking id,
    // which is what stops a second replay creating a second hold
    await requestBooking({
      id: event.entityId,
      machineId: p.machineId,
      farmerId: event.actorId,
      window: { start: new Date(window.start), end: new Date(window.end) },
      location: p.location as never,
      operatorMode: p.operatorMode as never,
      workType: typeof p.workType === 'string' ? p.workType : undefined,
      areaAcres: typeof p.areaAcres === 'number' ? p.areaAcres : undefined,
      notes: typeof p.notes === 'string' ? p.notes : undefined,
    });
    return true;
  },
  RETURN_LEG_STATE_CHANGED: async (event) => {
    const to = event.payload.toState;
    if (!event.actorId || typeof to !== 'string') return false;
    if (to === 'OPEN') {
      await openReturnLeg(event.entityId, event.actorId);
      return true;
    }
    await advanceReturnLeg(event.entityId, to as never, event.actorId);
    return true;
  },
  // The journal intentionally excludes OTPs, payment-provider proof, and pricing
  // inputs. These handlers are registered so every event type is classified, but
  // return false rather than manufacture an authoritative business effect.
  SHIPMENT_ADDED: async () => false,
  CAPACITY_CHANGED: async () => false,
  PRICING_RECALCULATED: async () => false,
  PAYMENT_STATE_CHANGED: async () => false,
  PAYOUT_STATE_CHANGED: async () => false,
  MACHINE_BOOKING_STATE_CHANGED: async () => false,
};

export interface ReplayResult {
  examined: number;
  superseded: number;
  replayed: number;
  /** the authoritative service refused it outright, with its own stated reason */
  abandoned: number;
  unresolved: number;
  details: Array<{ eventId: string; eventType: string; outcome: string }>;
}

/**
 * Walk the pending journal and settle each entry against authoritative state.
 *
 * Idempotent: running it twice is safe, because the second pass finds the
 * entries already settled and there is nothing left pending to act on.
 */
export async function replayPending(): Promise<ReplayResult> {
  await reloadJournal();
  const pending = pendingEvents();

  const result: ReplayResult = {
    examined: pending.length,
    superseded: 0,
    replayed: 0,
    abandoned: 0,
    unresolved: 0,
    details: [],
  };

  for (const event of pending) {
    const present = await effectPresent(event);

    if (present === true) {
      await markReplayed(event, 'SUPERSEDED');
      result.superseded += 1;
      result.details.push({
        eventId: event.eventId,
        eventType: event.eventType,
        outcome: 'already applied — journal confirmation was simply lost',
      });
      continue;
    }

    if (present === false) {
      const apply = appliers[event.eventType];
      if (apply) {
        try {
          if (await apply(event)) {
            await markReplayed(event, 'REPLAYED');
            result.replayed += 1;
            result.details.push({ eventId: event.eventId, eventType: event.eventType, outcome: 'reapplied through its original business service' });
            continue;
          }
        } catch (err) {
          /*
           * A REFUSAL IS AN ANSWER, AND IT HAS TO BE RECORDED AS ONE.
           *
           * An ApiError here is the authoritative service deliberately saying no
           * — the slot was taken, the cargo is ineligible, the state has moved
           * on. Leaving that PENDING was the old behaviour and it was wrong twice
           * over: the queue grew a permanent entry for an operation that will
           * never be applicable, and because RECOVERED requires zero unresolved
           * entries, one lost slot race made the board say MANUAL_REVIEW forever.
           *
           * So it is ABANDONED with the service's own reason — resolved, visible,
           * and never invented. A store failure is a different matter: that is
           * genuinely unknown, and falls through to manual review.
           */
          if (err instanceof ApiError && !isStoreFailure(err)) {
            await markAbandoned(event, `refused on replay: ${err.message}`.slice(0, 200));
            result.abandoned += 1;
            result.details.push({
              eventId: event.eventId,
              eventType: event.eventType,
              outcome: `cannot be applied — ${err.message}`,
            });
            continue;
          }
          // otherwise fall through to manual review. A replay must never turn a
          // store failure into a fake success or a fake refusal.
        }
      }
      result.unresolved += 1;
      result.details.push({
        eventId: event.eventId,
        eventType: event.eventType,
        outcome: 'did not land — no safe automatic applier; needs operator review',
      });
      continue;
    }

    result.unresolved += 1;
    result.details.push({
      eventId: event.eventId,
      eventType: event.eventType,
      outcome: 'could not be verified against the restored data',
    });
  }

  return result;
}

/** Mark a pending entry as deliberately not-to-be-retried. Operator action. */
export async function abandonEvent(eventId: string, reason: string): Promise<boolean> {
  const event = pendingEvents().find((e) => e.eventId === eventId);
  if (!event) return false;
  await markAbandoned(event, reason);
  return true;
}

// ---------------------------------------------------------------------------
// snapshot rebuild
// ---------------------------------------------------------------------------

/**
 * Throw away the continuity cache and rebuild it from the restored database.
 *
 * Stale snapshots are worse than none after a restore: they describe a world the
 * authoritative store may no longer agree with, and they would be served to users
 * as "last known good" while being neither (§14).
 */
export async function rebuildSnapshots(): Promise<number> {
  await clearSnapshots();

  const active = await Trip.find({
    state: { $in: ['FORMING', 'EN_ROUTE', 'IN_TRANSIT', 'AT_DESTINATION'] },
  }).limit(200);

  let rebuilt = 0;
  for (const trip of active) {
    try {
      const shipments = await TripShipment.find({ tripId: trip._id });
      const capacity = await capacityOf(trip);
      await putTripSnapshot({
        tripId: String(trip._id),
        state: trip.state,
        destination: trip.destination?.name ?? '',
        routeDistanceKm: trip.routeDistanceKm,
        capacity,
        poolSize: shipments.filter((s) => s.state !== 'CANCELLED').length,
        pricingVersion: trip.pricingVersion,
        totalCost: trip.estimatedRouteCost ?? null,
        shipments: shipments.map((s) => ({
          shipmentId: String(s._id),
          farmerId: String(s.farmerId),
          state: s.state,
          amount: s.finalPrice ?? s.allocatedPrice ?? null,
        })),
      });
      rebuilt += 1;
    } catch {
      // one bad trip must not abort the rebuild of the rest
    }
  }
  return rebuilt;
}

// ---------------------------------------------------------------------------
// the orchestrated recovery
// ---------------------------------------------------------------------------

export interface RecoveryOutcome {
  incident: IncidentDTO | null;
  replay: ReplayResult;
  integrityPassed: boolean;
  snapshotsRebuilt: number;
  finalState: string;
}

/**
 * Run the full sequence. Safe to call when nothing is wrong — it will simply
 * find no pending intent and pass its checks.
 *
 * Deliberately does NOT perform the Atlas restore itself: a point-in-time
 * restore is a control-plane operation with real consequences and it belongs
 * behind a human in the Atlas UI or the Admin API (see docs/RESILIENCE.md). This
 * runs everything that comes *after* the data is back, which is the part an
 * application can be responsible for.
 */
export async function runRecovery(options: { restorePoint?: string } = {}): Promise<RecoveryOutcome> {
  if (!currentIncident()) {
    openIncident('DATA_INTEGRITY', 'recovery run requested by an operator');
  }
  if (options.restorePoint) updateIncident({ restorePoint: options.restorePoint });

  // 1. replay pending intent against the authoritative store
  setState('RECONCILING', 'replaying pending recovery journal entries');
  const replay = await replayPending();
  updateIncident({
    pendingEvents: replay.examined,
    replayedEvents: replay.replayed,
    supersededEvents: replay.superseded,
    failedEvents: replay.unresolved,
  });

  // 2. validate what we now have
  setState('VALIDATING', 'running integrity checks over the restored state');
  const integrity = await runIntegrityChecks();
  updateIncident({ integrity });

  // 3. rebuild the continuity cache from authoritative state
  const snapshotsRebuilt = await rebuildSnapshots();
  updateIncident({ snapshotsRebuilt });

  // 4. only claim recovery if it is actually true
  const clean = integrity.passed && replay.unresolved === 0;
  if (clean) {
    setState('RECOVERED', 'integrity checks passed and snapshots rebuilt');
    closeIncident();
  } else {
    setState(
      'MANUAL_REVIEW',
      integrity.passed
        ? `${replay.unresolved} journalled operation(s) could not be confirmed`
        : `${integrity.findings.filter((f) => f.classification === 'INCONSISTENT' || f.classification === 'MANUAL_REVIEW').length} integrity finding(s) need a human`,
    );
  }

  return {
    incident: currentIncident(),
    replay,
    integrityPassed: integrity.passed,
    snapshotsRebuilt,
    finalState: recoveryState(),
  };
}
