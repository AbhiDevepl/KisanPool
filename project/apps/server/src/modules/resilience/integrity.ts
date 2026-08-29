/**
 * Integrity and reconciliation (ADR-044, §13).
 *
 * WHAT THIS DOES NOT DO
 * ---------------------
 * It does not repair anything ambiguous. That is the design, not a shortcut.
 *
 * A restored database with an orphaned shipment could be repaired three ways —
 * delete the shipment, recreate the trip, or reattach it to a different trip —
 * and the three produce different capacity, different pricing and different
 * money. A checker that picks one silently has just made an accounting decision
 * nobody reviewed. So findings are CLASSIFIED and reported:
 *
 *   AUTO_RECOVERED  intact, or derivable with no ambiguity at all
 *   RECONSTRUCTED   rebuilt from the journal or from derived state, and it agrees
 *   INCONSISTENT    genuinely disagrees — surfaced, deliberately left alone
 *   MANUAL_REVIEW   ambiguous, and guessing would risk capacity or money
 *
 * Every check is READ-ONLY. Nothing in this file writes.
 *
 * The relationships checked are the ones that carry consequences: capacity
 * (overbooking), pricing (what a farmer owes), and payment/payout (money that
 * has actually moved).
 */
import {
  OCCUPIES_CAPACITY,
  type FindingClass,
  type IntegrityFinding,
  type IntegrityReport,
} from '@kisanpool/shared';
import {
  BackhaulBooking,
  FarmMachine,
  MachineBooking,
  Payment,
  PricingEvent,
  TransportRequest,
  Trip,
  TripShipment,
  User,
  Vehicle,
} from '../../models';

const MAX_SAMPLES = 5;

function finding(
  check: string,
  classification: FindingClass,
  count: number,
  detail: string,
  samples: string[] = [],
): IntegrityFinding {
  return { check, classification, count, detail, samples: samples.slice(0, MAX_SAMPLES) };
}

/**
 * Run every relationship check.
 *
 * `passed` means nothing needs a human: no INCONSISTENT and no MANUAL_REVIEW.
 * AUTO_RECOVERED and RECONSTRUCTED findings are informational — they record what
 * was verified, which is what makes "integrity checks passed" a claim with
 * evidence behind it rather than a green tick.
 */
export async function runIntegrityChecks(): Promise<IntegrityReport> {
  const findings: IntegrityFinding[] = [];
  let checked = 0;

  // ---- 1. shipments ↔ trips ------------------------------------------------
  const shipments = await TripShipment.find({}, 'tripId requestId farmerId quantityKg state allocatedPrice finalPrice').limit(5000);
  checked += shipments.length;
  const tripIds = [...new Set(shipments.map((s) => String(s.tripId)))];
  const trips = await Trip.find({ _id: { $in: tripIds } });
  const tripById = new Map(trips.map((t) => [String(t._id), t]));

  const orphanShipments = shipments.filter((s) => !tripById.has(String(s.tripId)));
  findings.push(
    orphanShipments.length
      ? finding(
          'shipments ↔ trips',
          // a load with no trip cannot be repaired without deciding what it was
          // on; that decision changes capacity and price, so it is a human's
          'MANUAL_REVIEW',
          orphanShipments.length,
          'Shipments referencing a trip that no longer exists. Reattaching or deleting changes capacity and pricing, so this is not auto-resolved.',
          orphanShipments.map((s) => String(s._id)),
        )
      : finding('shipments ↔ trips', 'AUTO_RECOVERED', shipments.length, 'Every shipment resolves to an existing trip.'),
  );

  // ---- 2. shipments ↔ requests --------------------------------------------
  const requestIds = [...new Set(shipments.map((s) => String(s.requestId)))];
  const requests = await TransportRequest.find({ _id: { $in: requestIds } }, 'state tripId farmerId');
  const requestById = new Map(requests.map((r) => [String(r._id), r]));
  const orphanRequests = shipments.filter((s) => !requestById.has(String(s.requestId)));
  findings.push(
    orphanRequests.length
      ? finding(
          'shipments ↔ requests',
          'INCONSISTENT',
          orphanRequests.length,
          'Shipments whose originating request is missing.',
          orphanRequests.map((s) => String(s._id)),
        )
      : finding('shipments ↔ requests', 'AUTO_RECOVERED', shipments.length, 'Every shipment traces back to a request.'),
  );

  // ---- 3. vehicles ↔ capacity (the overbooking check) ----------------------
  //
  // Capacity is DERIVED from shipments by design (ADR-030), so this does not
  // compare against a stored counter — it re-derives and asserts the physical
  // constraint: a vehicle cannot be carrying more than it is rated for.
  const overbooked: string[] = [];
  for (const trip of trips) {
    const aboard = shipments.filter(
      (s) => String(s.tripId) === String(trip._id) && OCCUPIES_CAPACITY.includes(s.state),
    );
    const committed = aboard.reduce((sum, s) => sum + s.quantityKg, 0);
    if (committed > trip.totalCapacityKg) overbooked.push(String(trip._id));
  }
  checked += trips.length;
  findings.push(
    overbooked.length
      ? finding(
          'vehicle capacity',
          'INCONSISTENT',
          overbooked.length,
          'Trips whose committed load exceeds the vehicle capacity — an impossible physical state.',
          overbooked,
        )
      : finding('vehicle capacity', 'AUTO_RECOVERED', trips.length, 'No trip is carrying more than its rated capacity.'),
  );

  // ---- 4. pricing ↔ pricing history ---------------------------------------
  const pricedTrips = trips.filter((t) => t.pricingVersion > 0);
  const events = await PricingEvent.find(
    { tripId: { $in: pricedTrips.map((t) => t._id) } },
    'tripId version',
  );
  const versionsByTrip = new Map<string, number>();
  for (const event of events) {
    const key = String(event.tripId);
    versionsByTrip.set(key, Math.max(versionsByTrip.get(key) ?? 0, event.version));
  }
  // a trip claiming a pricing version with no event to justify it means the audit
  // trail was lost — the price is still usable, the RECEIPT for it is not
  const missingHistory = pricedTrips.filter(
    (t) => (versionsByTrip.get(String(t._id)) ?? 0) < t.pricingVersion,
  );
  findings.push(
    missingHistory.length
      ? finding(
          'pricing ↔ pricing history',
          'INCONSISTENT',
          missingHistory.length,
          'Trips whose pricingVersion is ahead of the newest recorded PricingEvent — the price stands, but its audit trail is incomplete.',
          missingHistory.map((t) => String(t._id)),
        )
      : finding('pricing ↔ pricing history', 'AUTO_RECOVERED', pricedTrips.length, 'Every priced trip has a matching pricing event.'),
  );

  // ---- 5. payments ↔ shipments (money, so the strictest) -------------------
  const payments = await Payment.find({}, 'shipmentId status amountPaise platformFeePaise transporterPayoutPaise payoutState transferId').limit(5000);
  checked += payments.length;
  const shipmentIds = new Set(shipments.map((s) => String(s._id)));
  const orphanPayments = payments.filter((p) => !shipmentIds.has(String(p.shipmentId)));
  findings.push(
    orphanPayments.length
      ? finding(
          'payments ↔ shipments',
          'MANUAL_REVIEW',
          orphanPayments.length,
          'Payments whose shipment is missing. Money may have moved for a load the database no longer has — never auto-resolved.',
          orphanPayments.map((p) => String(p._id)),
        )
      : finding('payments ↔ shipments', 'AUTO_RECOVERED', payments.length, 'Every payment resolves to an existing shipment.'),
  );

  // ---- 6. the split still adds up -----------------------------------------
  const brokenSplit = payments.filter(
    (p) => p.amountPaise > 0 && p.platformFeePaise + p.transporterPayoutPaise !== p.amountPaise,
  );
  findings.push(
    brokenSplit.length
      ? finding(
          'payment split arithmetic',
          'INCONSISTENT',
          brokenSplit.length,
          'Payments where platform fee + transporter share no longer equals the amount.',
          brokenSplit.map((p) => String(p._id)),
        )
      : finding('payment split arithmetic', 'AUTO_RECOVERED', payments.length, 'Every payment splits exactly into commission and transporter share.'),
  );

  // ---- 7. payments ↔ payouts ----------------------------------------------
  //
  // The dangerous state is a payout marked PROCESSED with no transfer id: it
  // claims a driver was paid with nothing to evidence it.
  const phantomPayouts = payments.filter((p) => p.payoutState === 'PROCESSED' && !p.transferId);
  findings.push(
    phantomPayouts.length
      ? finding(
          'payments ↔ payouts',
          'MANUAL_REVIEW',
          phantomPayouts.length,
          'Payouts marked processed with no transfer id — cannot be confirmed against the payment provider without a human.',
          phantomPayouts.map((p) => String(p._id)),
        )
      : finding('payments ↔ payouts', 'AUTO_RECOVERED', payments.length, 'Every processed payout carries a transfer reference.'),
  );

  // ---- 8. users ↔ their records -------------------------------------------
  const farmerIds = [...new Set(shipments.map((s) => String(s.farmerId)))];
  const users = await User.find({ _id: { $in: farmerIds } }, '_id');
  const knownUsers = new Set(users.map((u) => String(u._id)));
  const orphanFarmers = farmerIds.filter((id) => !knownUsers.has(id));
  findings.push(
    orphanFarmers.length
      ? finding(
          'users ↔ shipments',
          'INCONSISTENT',
          orphanFarmers.length,
          'Shipments belonging to a user record that no longer exists.',
          orphanFarmers,
        )
      : finding('users ↔ shipments', 'AUTO_RECOVERED', farmerIds.length, 'Every shipment has an existing owner.'),
  );

  // ---- 9. machinery ↔ bookings --------------------------------------------
  const machineBookings = await MachineBooking.find({}, 'machineId state window').limit(2000);
  checked += machineBookings.length;
  const machineIds = [...new Set(machineBookings.map((b) => String(b.machineId)))];
  const machines = await FarmMachine.find({ _id: { $in: machineIds } }, '_id');
  const knownMachines = new Set(machines.map((m) => String(m._id)));
  const orphanBookings = machineBookings.filter((b) => !knownMachines.has(String(b.machineId)));
  findings.push(
    orphanBookings.length
      ? finding(
          'machinery ↔ bookings',
          'INCONSISTENT',
          orphanBookings.length,
          'Machine bookings whose machine is missing.',
          orphanBookings.map((b) => String(b._id)),
        )
      : finding('machinery ↔ bookings', 'AUTO_RECOVERED', machineBookings.length, 'Every machine booking resolves to a listed machine.'),
  );

  // ---- 10. backhaul ↔ trips -----------------------------------------------
  const backhaul = await BackhaulBooking.find({}, 'tripId state').limit(2000);
  checked += backhaul.length;
  const backhaulTripIds = [...new Set(backhaul.map((b) => String(b.tripId)))];
  const backhaulTrips = await Trip.find({ _id: { $in: backhaulTripIds } }, '_id');
  const knownBackhaulTrips = new Set(backhaulTrips.map((t) => String(t._id)));
  const orphanBackhaul = backhaul.filter((b) => !knownBackhaulTrips.has(String(b.tripId)));
  findings.push(
    orphanBackhaul.length
      ? finding(
          'backhaul ↔ trip legs',
          'INCONSISTENT',
          orphanBackhaul.length,
          'Return-leg bookings whose trip is missing.',
          orphanBackhaul.map((b) => String(b._id)),
        )
      : finding('backhaul ↔ trip legs', 'AUTO_RECOVERED', backhaul.length, 'Every return load resolves to an existing trip.'),
  );

  // ---- 11. duplicate shipments per request --------------------------------
  //
  // A request may only ride once (unique index). If a replay ever produced two,
  // this is where it shows — which is the check that proves idempotency held.
  const perRequest = new Map<string, string[]>();
  for (const s of shipments) {
    const key = String(s.requestId);
    perRequest.set(key, [...(perRequest.get(key) ?? []), String(s._id)]);
  }
  const duplicated = [...perRequest.entries()].filter(([, ids]) => ids.length > 1);
  findings.push(
    duplicated.length
      ? finding(
          'duplicate shipments',
          'INCONSISTENT',
          duplicated.length,
          'A transport request has more than one shipment — a replay or race created a duplicate booking.',
          duplicated.map(([requestId]) => requestId),
        )
      : finding('duplicate shipments', 'AUTO_RECOVERED', perRequest.size, 'No request has been booked more than once.'),
  );

  // ---- 12. vehicles exist for trips ---------------------------------------
  const vehicleIds = [...new Set(trips.map((t) => String(t.vehicleId)))];
  const vehicles = await Vehicle.find({ _id: { $in: vehicleIds } }, '_id');
  const knownVehicles = new Set(vehicles.map((v) => String(v._id)));
  const orphanTrips = trips.filter((t) => !knownVehicles.has(String(t.vehicleId)));
  findings.push(
    orphanTrips.length
      ? finding(
          'trips ↔ vehicles',
          'INCONSISTENT',
          orphanTrips.length,
          'Trips whose vehicle record is missing.',
          orphanTrips.map((t) => String(t._id)),
        )
      : finding('trips ↔ vehicles', 'AUTO_RECOVERED', trips.length, 'Every trip has an existing vehicle.'),
  );

  const needsAttention = findings.filter(
    (f) => f.classification === 'INCONSISTENT' || f.classification === 'MANUAL_REVIEW',
  );

  return {
    ranAt: new Date().toISOString(),
    passed: needsAttention.length === 0,
    checked,
    findings,
  };
}
