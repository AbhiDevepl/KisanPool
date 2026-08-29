import mongoose from 'mongoose';
import {
  BILLABLE_BOOKING_STATES,
  DEFAULT_UNIT_FOR,
  OCCUPIES_SCHEDULE,
  canTransitionMachineBooking,
  type BookingOperatorMode,
  type MachineBookingState,
  type MachineCategory,
  type PricingUnit,
} from '@kisanpool/shared';
import { ApiError } from '../../lib/envelope';
import { haversineKm, type Point } from '../../lib/geo';
import { supportsTransactions } from '../../db';
import { FarmMachine, MachineBooking, User } from '../../models';
import type { FarmMachineDoc } from '../../models';
import { needsArea, quoteBooking, requoteOnCompletion } from './pricing';

const OTP_LENGTH = 4;
const randomOtp = (): string =>
  String(Math.floor(Math.random() * 10 ** OTP_LENGTH)).padStart(OTP_LENGTH, '0');

/** How far past a machine's own service radius we will still show it, so a farmer
 *  on the edge of two villages is not shown an empty screen. */
const DISCOVERY_SLACK_KM = 10;

const asPoint = (p: { lat?: number | null; lng?: number | null }): Point => ({
  lat: p.lat as number,
  lng: p.lng as number,
});

// ---------------------------------------------------------------------------
// availability — derived, never stored
// ---------------------------------------------------------------------------

/** Two windows overlap when each starts before the other ends. */
const overlaps = (a: { start: Date; end: Date }, b: { start: Date; end: Date }): boolean =>
  a.start < b.end && b.start < a.end;

/**
 * Is this machine free for this window?
 *
 * Reads the bookings, which ARE the calendar (ADR-038), plus the owner's declared
 * blackouts. There is no availability field to consult because there is no
 * availability field — the same reasoning that keeps V1's vehicle capacity derived
 * from its shipments rather than counted into a column that drifts.
 */
export async function isMachineFree(
  machine: FarmMachineDoc,
  window: { start: Date; end: Date },
  options: { ignoreBookingId?: string; session?: mongoose.ClientSession | null } = {},
): Promise<boolean> {
  const blackedOut = (machine.blackouts ?? []).some((b) =>
    overlaps(window, { start: new Date(b.start), end: new Date(b.end) }),
  );
  if (blackedOut) return false;

  const clashing = await MachineBooking.find({
    machineId: machine._id,
    state: { $in: OCCUPIES_SCHEDULE },
    ...(options.ignoreBookingId ? { _id: { $ne: options.ignoreBookingId } } : {}),
    // a cheap index-friendly prefilter; the exact overlap test runs below
    'window.start': { $lt: window.end },
    'window.end': { $gt: window.start },
  }).session(options.session ?? null);

  return clashing.length === 0;
}

/** The windows a machine is already committed to — what a calendar view renders. */
export async function machineSchedule(machineId: string, fromISO?: string) {
  const from = fromISO ? new Date(fromISO) : new Date();
  const bookings = await MachineBooking.find({
    machineId,
    state: { $in: OCCUPIES_SCHEDULE },
    'window.end': { $gte: from },
  })
    .sort({ 'window.start': 1 })
    .limit(60);

  const machine = await FarmMachine.findById(machineId);
  return {
    busy: bookings.map((b) => ({
      bookingId: String(b._id),
      start: b.window.start,
      end: b.window.end,
      state: b.state,
    })),
    blackouts: (machine?.blackouts ?? []).filter((b) => new Date(b.end) >= from),
  };
}

// ---------------------------------------------------------------------------
// discovery
// ---------------------------------------------------------------------------

export interface DiscoverInput {
  site: Point;
  category?: MachineCategory;
  window?: { start: Date; end: Date };
  operatorMode?: BookingOperatorMode;
  areaAcres?: number;
}

/**
 * Machines a farmer at `site` could actually hire.
 *
 * Filtered by real constraints before anything is ranked: the provider's own
 * service radius, the machine's status, and — when the farmer named a window —
 * whether it is genuinely free. Showing a machine that cannot come is worse than
 * showing nothing, because the farmer wastes the one afternoon they had.
 *
 * Each row carries a live quote, so the farmer compares real prices for THEIR job
 * rather than headline rates in different units they cannot mentally convert.
 */
export async function discoverMachines(input: DiscoverInput) {
  const machines = await FarmMachine.find({
    status: 'LISTED',
    ...(input.category ? { category: input.category } : {}),
  }).limit(200);

  const rows = [];
  for (const machine of machines) {
    const distanceKm = haversineKm(asPoint(machine.baseLocation), input.site);
    if (distanceKm > machine.serviceRadiusKm + DISCOVERY_SLACK_KM) continue;

    // a self-drive-only machine cannot serve a farmer who needs an operator
    if (input.operatorMode && machine.operatorMode !== 'EITHER') {
      if (machine.operatorMode !== input.operatorMode) continue;
    }

    const available = input.window ? await isMachineFree(machine, input.window) : true;

    // priced for THIS job, in rupees the farmer can compare across units
    const quote = input.window
      ? await quoteBooking({
          unit: machine.pricing.unit as PricingUnit,
          rate: machine.pricing.rate,
          minimumCharge: machine.pricing.minimumCharge,
          travelRatePerKm: machine.pricing.travelRatePerKm,
          window: input.window,
          areaAcres: input.areaAcres,
          base: asPoint(machine.baseLocation),
          site: input.site,
        })
      : null;

    const [owner, completedJobs] = await Promise.all([
      User.findById(machine.ownerId),
      MachineBooking.countDocuments({
        machineId: machine._id,
        state: { $in: BILLABLE_BOOKING_STATES },
      }),
    ]);

    rows.push({
      ...machine.toJSON(),
      distanceKm: Math.round(distanceKm * 10) / 10,
      availableForWindow: available,
      completedJobs,
      quote,
      owner: owner && {
        _id: String(owner._id),
        name: owner.name,
        ratingAvg: owner.ratingAvg,
        ratingCount: owner.ratingCount,
      },
    });
  }

  /*
   * Ranking, deterministic and in this order:
   *   1. machines that can actually come on the day
   *   2. cheapest for this specific job
   *   3. nearest, as the tie-break
   *
   * Availability outranks price because an unavailable machine has no price worth
   * comparing, and price outranks distance because travel is already IN the price.
   */
  rows.sort((a, b) => {
    if (a.availableForWindow !== b.availableForWindow) return a.availableForWindow ? -1 : 1;
    const priceDelta = (a.quote?.total ?? Infinity) - (b.quote?.total ?? Infinity);
    if (Math.abs(priceDelta) > 0.01) return priceDelta;
    return a.distanceKm - b.distanceKm;
  });

  return rows.slice(0, 30);
}

// ---------------------------------------------------------------------------
// booking
// ---------------------------------------------------------------------------

export interface BookInput {
  machineId: string;
  farmerId: string;
  window: { start: Date; end: Date };
  location: { name: string; lat: number; lng: number };
  operatorMode: BookingOperatorMode;
  workType?: string;
  areaAcres?: number;
  notes?: string;
}

/**
 * Request a machine for a window. THIS is where the slot is held.
 *
 * Two farmers can be asking for the same Tuesday morning at the same instant, so
 * the hold runs inside a transaction that re-checks the calendar at commit time.
 * The `reservationSeq` bump is doing the same job it does for trips (ADR-033):
 * each request otherwise only INSERTs its own booking, MongoDB raises no conflict
 * between two inserts, and both would pass a check against the same stale
 * calendar. Touching the machine document makes the second writer lose.
 */
export async function requestBooking(input: BookInput) {
  const useTransaction = await supportsTransactions();
  const session = useTransaction ? await mongoose.startSession() : undefined;

  try {
    if (session) session.startTransaction();

    const machine = await FarmMachine.findById(input.machineId).session(session ?? null);
    if (!machine) throw new ApiError('RESOURCE_NOT_FOUND', 'That machine is no longer listed.');
    if (machine.status !== 'LISTED') {
      throw new ApiError('BOOKING_STATE_INVALID', 'That machine is not taking bookings right now.');
    }
    if (String(machine.ownerId) === input.farmerId) {
      throw new ApiError('AUTH_FORBIDDEN', 'You cannot book your own machine.');
    }

    if (input.window.end <= input.window.start) {
      throw new ApiError('VALIDATION_ERROR', 'window: the end must be after the start.');
    }

    // the operator arrangement has to be one the provider actually offers
    if (machine.operatorMode !== 'EITHER' && machine.operatorMode !== input.operatorMode) {
      throw new ApiError(
        'VALIDATION_ERROR',
        `operatorMode: this provider offers ${machine.operatorMode === 'WITH_OPERATOR' ? 'machine with operator' : 'self-drive'} only.`,
      );
    }

    // the field has to be inside the service area the provider declared
    const site = { lat: input.location.lat, lng: input.location.lng };
    const distanceKm = haversineKm(asPoint(machine.baseLocation), site);
    if (distanceKm > machine.serviceRadiusKm) {
      throw new ApiError(
        'VALIDATION_ERROR',
        `location: that field is ${distanceKm.toFixed(0)} km away and this provider travels up to ${machine.serviceRadiusKm} km.`,
      );
    }

    const unit = machine.pricing.unit as PricingUnit;
    if (needsArea(unit) && !(input.areaAcres && input.areaAcres > 0)) {
      throw new ApiError(
        'VALIDATION_ERROR',
        'areaAcres: this machine is priced per acre, so the area is required.',
      );
    }

    /*
     * Serialise every reservation for this machine through the machine document,
     * for exactly the reason ADR-033 gives for trips. Without it the overlap check
     * below reads correctly and proves nothing.
     */
    const guarded = await FarmMachine.findOneAndUpdate(
      { _id: machine._id },
      { $inc: { reservationSeq: 1 } },
      { new: true, ...(session ? { session } : {}) },
    );
    if (!guarded) throw new ApiError('RESOURCE_NOT_FOUND', 'That machine is no longer listed.');

    // the race: re-check the calendar as it stands right now
    const free = await isMachineFree(guarded, input.window, { session: session ?? null });
    if (!free) {
      throw new ApiError(
        'CONCURRENT_BOOKING',
        'That slot was taken while you were booking. Please pick another time.',
      );
    }

    const quote = await quoteBooking({
      unit,
      rate: machine.pricing.rate,
      minimumCharge: machine.pricing.minimumCharge,
      travelRatePerKm: machine.pricing.travelRatePerKm,
      window: input.window,
      areaAcres: input.areaAcres,
      base: asPoint(machine.baseLocation),
      site,
    });

    const created = await MachineBooking.create(
      [
        {
          machineId: machine._id,
          providerId: machine.ownerId,
          farmerId: input.farmerId,
          category: machine.category,
          operatorMode: input.operatorMode,
          window: input.window,
          location: input.location,
          workType: input.workType,
          areaAcres: input.areaAcres,
          notes: input.notes,
          state: 'REQUESTED',
          quote,
          startOtp: randomOtp(),
        },
      ],
      session ? { session } : undefined,
    );

    if (session) await session.commitTransaction();
    return { booking: created[0], machine };
  } catch (err) {
    if (session?.inTransaction()) await session.abortTransaction();
    throw asBookingError(err);
  } finally {
    await session?.endSession();
  }
}

/** A write conflict on the same machine is the same event as losing the slot race. */
function asBookingError(err: unknown): unknown {
  if (err instanceof ApiError) return err;
  const mongoErr = err as {
    code?: number;
    errorLabels?: string[];
    hasErrorLabel?: (label: string) => boolean;
  };
  const conflict =
    mongoErr.code === 112 ||
    mongoErr.code === 11000 ||
    mongoErr.errorLabels?.includes('TransientTransactionError') === true ||
    mongoErr.hasErrorLabel?.('TransientTransactionError') === true;

  if (conflict) {
    return new ApiError(
      'CONCURRENT_BOOKING',
      'That slot was taken while you were booking. Please pick another time.',
    );
  }
  return err;
}

// ---------------------------------------------------------------------------
// lifecycle
// ---------------------------------------------------------------------------

/**
 * Advance a booking. Who may make which move is part of the rule, not a UI
 * convention: only the provider can confirm or decline, only the farmer can
 * cancel, and the OTP is what proves the job actually started.
 */
export async function advanceBooking(
  bookingId: string,
  to: MachineBookingState,
  actorId: string,
  options: { otp?: string; reason?: string } = {},
) {
  const booking = await MachineBooking.findById(bookingId);
  if (!booking) throw new ApiError('RESOURCE_NOT_FOUND', 'That booking no longer exists.');

  const isProvider = String(booking.providerId) === actorId;
  const isFarmer = String(booking.farmerId) === actorId;
  if (!isProvider && !isFarmer) {
    throw new ApiError('AUTH_FORBIDDEN', 'That booking is not yours.');
  }

  if (!canTransitionMachineBooking(booking.state, to)) {
    throw new ApiError(
      'BOOKING_STATE_INVALID',
      `A booking cannot go from ${booking.state} to ${to}.`,
    );
  }

  const providerOnly: MachineBookingState[] = ['CONFIRMED', 'DECLINED', 'IN_PROGRESS', 'COMPLETED'];
  if (providerOnly.includes(to) && !isProvider) {
    throw new ApiError('AUTH_FORBIDDEN', 'Only the provider can do that.');
  }
  if (to === 'CANCELLED' && !isFarmer) {
    throw new ApiError('AUTH_FORBIDDEN', 'Only the farmer can cancel a booking.');
  }

  if (to === 'CONFIRMED') {
    // the slot may have been blacked out since; confirming must not overbook
    const machine = await FarmMachine.findById(booking.machineId);
    if (
      machine &&
      !(await isMachineFree(
        machine,
        { start: booking.window.start, end: booking.window.end },
        { ignoreBookingId: String(booking._id) },
      ))
    ) {
      throw new ApiError('CONCURRENT_BOOKING', 'That slot now clashes with another job.');
    }
    booking.confirmedAt = new Date();
  }

  if (to === 'IN_PROGRESS') {
    // the farmer's code proves the machine reached the right field
    if (!options.otp || options.otp !== booking.startOtp) {
      throw new ApiError('VALIDATION_ERROR', 'otp: that start code is not correct.');
    }
    booking.startedAt = new Date();
  }

  if (to === 'COMPLETED') {
    const completedAt = new Date();
    booking.completedAt = completedAt;

    /*
     * Bill what the work actually took, not what was estimated.
     *
     * A per-hour job that ran two hours over is two hours the provider could not
     * be elsewhere; a per-acre job is the same acres however long it took. The
     * engine knows which units can move, so this stays honest without the app
     * having to reason about it.
     */
    const machine = await FarmMachine.findById(booking.machineId);
    if (machine) {
      const requoted = await requoteOnCompletion(
        {
          unit: machine.pricing.unit as PricingUnit,
          rate: machine.pricing.rate,
          minimumCharge: machine.pricing.minimumCharge,
          travelRatePerKm: machine.pricing.travelRatePerKm,
          window: { start: booking.window.start, end: booking.window.end },
          areaAcres: booking.areaAcres,
          base: asPoint(machine.baseLocation),
          site: asPoint(booking.location),
        },
        { start: booking.startedAt ?? booking.window.start, end: completedAt },
      );
      booking.quote = requoted;
      booking.finalAmount = requoted.total;
    } else {
      booking.finalAmount = booking.quote.total;
    }
  }

  if (to === 'CANCELLED') {
    booking.cancelledAt = new Date();
    booking.cancelReason = options.reason;
  }
  if (to === 'DECLINED') {
    booking.declineReason = options.reason;
  }

  booking.state = to;
  await booking.save();
  return booking;
}

export { DEFAULT_UNIT_FOR };
export { demandClusters } from './demand';
