/**
 * Shared-machine utilisation (ADR-042).
 *
 * ONE UNDERUSED MACHINE → MORE UTILISATION → LOWER PER-FARMER COST.
 *
 * When several farmers near each other want the same machine around the same
 * time, the provider can serve them in one outing instead of driving out and back
 * for each. The only cost that genuinely falls is TRAVEL — an acre is still an
 * acre, an hour still an hour — so travel is the only thing this splits, and it
 * splits by real physics: one round trip divided by the jobs on it.
 *
 * The scoring is deterministic and explainable. It never forces a grouping: if
 * the jobs are too far apart or too far in time, compatibility is NONE and the
 * hires stay separate. This is NOT a VRP optimiser — it groups compatible jobs
 * on ONE machine, it does not sequence a fleet.
 */
import mongoose from 'mongoose';
import {
  OCCUPIES_SCHEDULE,
  type GroupingAssessmentDTO,
  type GroupingCompatibility,
} from '@kisanpool/shared';
import { ApiError } from '../../lib/envelope';
import { haversineKm, money, type Point } from '../../lib/geo';
import { getDirections } from '../maps/service';
import { FarmMachine, MachineBooking } from '../../models';
import type { FarmMachineDoc } from '../../models';
import { quoteBooking } from './pricing';
import type { PricingUnit } from '@kisanpool/shared';

/** Jobs must be at least this close to share one outing. */
const GROUP_RADIUS_KM = 15;
/** …and their windows within this of each other (a working day). */
const WINDOW_GAP_HOURS = 24;
/** Not-yet-started states can still be re-quoted into a group. */
const GROUPABLE_STATES = ['REQUESTED', 'CONFIRMED'] as const;

const asPoint = (p: { lat?: number | null; lng?: number | null }): Point => ({
  lat: p.lat as number,
  lng: p.lng as number,
});

const hoursApart = (a: { start: Date; end: Date }, b: { start: Date; end: Date }): number => {
  const gap = Math.max(
    0,
    Math.max(a.start.getTime(), b.start.getTime()) - Math.min(a.end.getTime(), b.end.getTime()),
  );
  return gap / 3_600_000;
};

interface CandidateInput {
  machineId: string;
  site: { lat: number; lng: number };
  window: { start: Date; end: Date };
  areaAcres?: number | null;
  /** ignore this booking (when re-assessing an existing one) */
  excludeBookingId?: string;
  /** ignore this farmer's own other jobs */
  excludeFarmerId?: string;
}

/**
 * Could this prospective hire share a provider outing with jobs already booked
 * nearby? Pure read — assesses, never writes.
 */
export async function assessGrouping(input: CandidateInput): Promise<GroupingAssessmentDTO> {
  const machine = await FarmMachine.findById(input.machineId);
  const empty = (
    compatibility: GroupingCompatibility,
    reasons: string[],
    soloTravel = 0,
  ): GroupingAssessmentDTO => ({
    compatibility,
    nearbyJobs: 0,
    nearbyFarmers: 0,
    groupSize: 1,
    reasons,
    soloTravelCost: soloTravel,
    sharedTravelCost: soloTravel,
    projectedSaving: 0,
  });

  if (!machine) return empty('NONE', ['That machine is no longer listed.']);

  const { distanceKm } = await getDirections(asPoint(machine.baseLocation), input.site);
  const soloTravelCost = money(
    Math.round(distanceKm * 10) / 10 * 2 * machine.pricing.travelRatePerKm,
  );

  if (machine.pricing.travelRatePerKm <= 0) {
    return empty('NONE', ['This provider does not charge for travel, so there is nothing to share.']);
  }

  const others = await MachineBooking.find({
    machineId: machine._id,
    state: { $in: GROUPABLE_STATES },
    startedAt: { $exists: false },
    ...(input.excludeBookingId ? { _id: { $ne: input.excludeBookingId } } : {}),
    ...(input.excludeFarmerId ? { farmerId: { $ne: input.excludeFarmerId } } : {}),
  }).limit(50);

  const compatible = others.filter((b) => {
    const near = haversineKm(asPoint(b.location), input.site) <= GROUP_RADIUS_KM;
    const soon =
      hoursApart(
        { start: new Date(b.window.start), end: new Date(b.window.end) },
        input.window,
      ) <= WINDOW_GAP_HOURS;
    return near && soon;
  });

  if (!compatible.length) {
    return empty('NONE', ['No other nearby job on this machine around then — this would be a solo hire.'], soloTravelCost);
  }

  const nearbyFarmers = new Set(compatible.map((b) => String(b.farmerId))).size;
  const groupSize = compatible.length + 1;
  const sharedTravelCost = money(soloTravelCost / groupSize);
  const projectedSaving = money(soloTravelCost - sharedTravelCost);

  const avgKm =
    compatible.reduce((s, b) => s + haversineKm(asPoint(b.location), input.site), 0) /
    compatible.length;
  const tightWindow = compatible.every(
    (b) =>
      hoursApart(
        { start: new Date(b.window.start), end: new Date(b.window.end) },
        input.window,
      ) <= 6,
  );

  let compatibility: GroupingCompatibility;
  if (compatible.length >= 2 && avgKm <= 8 && tightWindow) compatibility = 'HIGH';
  else if (avgKm <= GROUP_RADIUS_KM && tightWindow) compatibility = 'MEDIUM';
  else compatibility = 'LOW';

  const reasons = [
    `${compatible.length} other job${compatible.length === 1 ? '' : 's'} on this machine ` +
      `(${nearbyFarmers} farmer${nearbyFarmers === 1 ? '' : 's'}) within ${Math.round(avgKm)} km, ` +
      `${tightWindow ? 'the same part of the day' : 'around the same day'}.`,
  ];
  if (projectedSaving > 0) {
    reasons.push(
      `Served together, the ${money(soloTravelCost)} round-trip travel splits ${groupSize} ways — ` +
        `you would pay about ₹${sharedTravelCost} instead of ₹${soloTravelCost}, saving ₹${projectedSaving}.`,
    );
  }
  if (compatibility === 'LOW') {
    reasons.push('The gap is wide enough that the provider may still come out separately.');
  }

  return {
    compatibility,
    nearbyJobs: compatible.length,
    nearbyFarmers,
    groupSize,
    reasons,
    soloTravelCost,
    sharedTravelCost,
    projectedSaving,
  };
}

// ---------------------------------------------------------------------------
// forming the group — a write, bounded to not-yet-started bookings
// ---------------------------------------------------------------------------

/** Re-quote one booking with a new travel-share count and persist it. */
async function requoteForShare(bookingId: string, machine: FarmMachineDoc, shareCount: number) {
  const booking = await MachineBooking.findById(bookingId);
  if (!booking) return null;
  const quote = await quoteBooking({
    unit: machine.pricing.unit as PricingUnit,
    rate: machine.pricing.rate,
    minimumCharge: machine.pricing.minimumCharge,
    travelRatePerKm: machine.pricing.travelRatePerKm,
    window: { start: booking.window.start, end: booking.window.end },
    areaAcres: booking.areaAcres,
    base: asPoint(machine.baseLocation),
    site: asPoint(booking.location),
    travelShareCount: shareCount,
  });
  booking.quote = quote;
  await booking.save();
  return booking;
}

/**
 * Group two or more not-yet-started bookings on ONE machine so their outing —
 * and its travel cost — is shared. Provider action.
 *
 * Only travel changes, and only REQUESTED/CONFIRMED bookings are touched, so a
 * job that has already started keeps the bill it began under.
 */
export async function groupBookings(providerId: string, bookingIds: string[]) {
  if (bookingIds.length < 2) {
    throw new ApiError('VALIDATION_ERROR', 'bookingIds: group needs at least two bookings.');
  }

  const bookings = await MachineBooking.find({ _id: { $in: bookingIds } });
  if (bookings.length !== bookingIds.length) {
    throw new ApiError('RESOURCE_NOT_FOUND', 'One of those bookings no longer exists.');
  }

  const machineId = String(bookings[0].machineId);
  for (const b of bookings) {
    if (String(b.providerId) !== providerId) {
      throw new ApiError('AUTH_FORBIDDEN', 'One of those bookings is not on your machine.');
    }
    if (String(b.machineId) !== machineId) {
      throw new ApiError('VALIDATION_ERROR', 'bookingIds: all jobs must be on the same machine.');
    }
    if (!GROUPABLE_STATES.includes(b.state as (typeof GROUPABLE_STATES)[number]) || b.startedAt) {
      throw new ApiError('BOOKING_STATE_INVALID', 'A job that has started cannot be regrouped.');
    }
  }

  // compatibility gate — refuse to group jobs that are not actually near/soon
  for (let i = 0; i < bookings.length; i += 1) {
    for (let j = i + 1; j < bookings.length; j += 1) {
      const near =
        haversineKm(asPoint(bookings[i].location), asPoint(bookings[j].location)) <= GROUP_RADIUS_KM;
      const soon =
        hoursApart(
          { start: new Date(bookings[i].window.start), end: new Date(bookings[i].window.end) },
          { start: new Date(bookings[j].window.start), end: new Date(bookings[j].window.end) },
        ) <= WINDOW_GAP_HOURS;
      if (!near || !soon) {
        throw new ApiError(
          'VALIDATION_ERROR',
          'bookingIds: those jobs are too far apart in place or time to share one outing.',
        );
      }
    }
  }

  const machine = await FarmMachine.findById(machineId);
  if (!machine) throw new ApiError('RESOURCE_NOT_FOUND', 'That machine no longer exists.');

  // reuse an existing group id if any of them already carry one
  const existing = bookings.find((b) => b.groupId);
  const groupId = existing?.groupId ?? bookings[0]._id;

  const allInGroup = await MachineBooking.find({
    $or: [{ _id: { $in: bookingIds } }, { groupId }],
    state: { $in: GROUPABLE_STATES },
  });
  const uniqueIds = [...new Set(allInGroup.map((b) => String(b._id)))];
  const shareCount = uniqueIds.length;

  const updated = [];
  for (const id of uniqueIds) {
    const b = await MachineBooking.findById(id);
    if (!b) continue;
    b.groupId = groupId as mongoose.Types.ObjectId;
    await b.save();
    const requoted = await requoteForShare(id, machine, shareCount);
    if (requoted) updated.push(requoted);
  }

  return { groupId: String(groupId), shareCount, bookings: updated };
}

/**
 * Auto-join a fresh REQUESTED booking to a HIGHLY compatible existing cluster,
 * re-quoting the cluster so everyone's travel share drops. The request-time
 * analogue of pooled-transport reallocation, bounded to not-yet-started jobs.
 * Returns the group id and the re-priced siblings, or null when nothing grouped.
 */
export async function autoGroupOnRequest(bookingId: string): Promise<{
  groupId: string;
  shareCount: number;
  repriced: Array<{ bookingId: string; farmerId: string; total: number; previousTotal: number }>;
} | null> {
  const booking = await MachineBooking.findById(bookingId);
  if (!booking || booking.state !== 'REQUESTED') return null;

  const assessment = await assessGrouping({
    machineId: String(booking.machineId),
    site: asPoint(booking.location),
    window: { start: booking.window.start, end: booking.window.end },
    areaAcres: booking.areaAcres,
    excludeBookingId: String(booking._id),
    excludeFarmerId: String(booking.farmerId),
  });
  if (assessment.compatibility !== 'HIGH') return null;

  const machine = await FarmMachine.findById(booking.machineId);
  if (!machine) return null;

  const siblings = await MachineBooking.find({
    machineId: booking.machineId,
    state: 'REQUESTED',
    startedAt: { $exists: false },
    _id: { $ne: booking._id },
    farmerId: { $ne: booking.farmerId },
  }).limit(20);

  const compatible = siblings.filter(
    (b) =>
      haversineKm(asPoint(b.location), asPoint(booking.location)) <= 8 &&
      hoursApart(
        { start: new Date(b.window.start), end: new Date(b.window.end) },
        { start: booking.window.start, end: booking.window.end },
      ) <= 6,
  );
  if (compatible.length < 2) return null;

  const existing = compatible.find((b) => b.groupId);
  const groupId = existing?.groupId ?? booking._id;
  const members = [booking, ...compatible];
  const shareCount = members.length;

  const repriced: Array<{ bookingId: string; farmerId: string; total: number; previousTotal: number }> = [];
  for (const m of members) {
    const previousTotal = m.quote.total;
    m.groupId = groupId as mongoose.Types.ObjectId;
    await m.save();
    const requoted = await requoteForShare(String(m._id), machine, shareCount);
    if (requoted && String(m._id) !== String(booking._id)) {
      repriced.push({
        bookingId: String(m._id),
        farmerId: String(m.farmerId),
        total: requoted.quote.total,
        previousTotal,
      });
    }
  }

  return { groupId: String(groupId), shareCount, repriced };
}

/** The combined workload/earnings for a group — what the provider sees. */
export async function groupSummary(groupId: string) {
  const members = await MachineBooking.find({ groupId }).sort({ 'window.start': 1 });
  if (!members.length) return null;
  return {
    id: groupId,
    size: members.length,
    combinedTotal: money(members.reduce((s, b) => s + (b.finalAmount ?? b.quote.total), 0)),
    combinedProviderEarning: money(members.reduce((s, b) => s + b.quote.providerEarning, 0)),
    windowFrom: members[0].window.start.toISOString(),
    windowTo: members
      .reduce((latest, b) => (b.window.end > latest ? b.window.end : latest), members[0].window.end)
      .toISOString(),
  };
}
