import { Router } from 'express';
import { z } from 'zod';
import { ApiError, ok } from '../../lib/envelope';
import { asyncHandler } from '../../middleware/error';
import { requireAuth, type AuthedRequest } from '../../middleware/auth';
import {
  BILLABLE_BOOKING_STATES,
  BOOKING_OPERATOR_MODES,
  MACHINE_BOOKING_STATES,
  MACHINE_CATEGORIES,
  MACHINE_STATUSES,
  OPERATOR_MODES,
  PRICING_UNITS,
} from '@kisanpool/shared';
import { FarmMachine, MachineBooking, User } from '../../models';
import {
  advanceBooking,
  demandClusters,
  discoverMachines,
  machineSchedule,
  requestBooking,
} from './service';
import { emitMachineBookingRequested, emitMachineBookingState } from '../realtime';
import { notifyMachineBooking } from '../notifications/service';

export const machineryRouter = Router();

const geoPoint = z.object({ name: z.string().min(1), lat: z.number(), lng: z.number() });

/**
 * Farm machinery and services (ADR-038).
 *
 * Note what is NOT here: a role gate. Any signed-in user may list a machine and
 * any signed-in user may hire one, because "provider" is a fact about owning a
 * FarmMachine rather than a claim in a JWT. That is what lets the farmer whose
 * tractor sits idle eleven months a year become supply, which is the entire point
 * of the feature.
 */

// ---------------------------------------------------------------------------
// discovery — the farmer's side
// ---------------------------------------------------------------------------

const discoverSchema = z.object({
  lat: z.coerce.number(),
  lng: z.coerce.number(),
  category: z.enum(MACHINE_CATEGORIES).optional(),
  start: z.coerce.date().optional(),
  end: z.coerce.date().optional(),
  operatorMode: z.enum(BOOKING_OPERATOR_MODES).optional(),
  areaAcres: z.coerce.number().positive().optional(),
});

machineryRouter.get(
  '/machines',
  requireAuth,
  asyncHandler<AuthedRequest>(async (req, res) => {
    const q = discoverSchema.parse(req.query);
    const window = q.start && q.end ? { start: q.start, end: q.end } : undefined;
    if (window && window.end <= window.start) {
      throw new ApiError('VALIDATION_ERROR', 'end: must be after start.');
    }

    ok(
      res,
      await discoverMachines({
        site: { lat: q.lat, lng: q.lng },
        category: q.category,
        window,
        operatorMode: q.operatorMode,
        areaAcres: q.areaAcres,
      }),
    );
  }),
);

/** Nearby demand for the same category — the "you are not the only one" signal. */
machineryRouter.get(
  '/demand',
  requireAuth,
  asyncHandler<AuthedRequest>(async (req, res) => {
    const q = z
      .object({ lat: z.coerce.number(), lng: z.coerce.number(), radiusKm: z.coerce.number().optional() })
      .parse(req.query);
    ok(res, await demandClusters({ lat: q.lat, lng: q.lng }, q.radiusKm ?? 40));
  }),
);

// ---------------------------------------------------------------------------
// the provider's own machines
// ---------------------------------------------------------------------------

/** MUST stay above `/machines/:id` — see ADR-036; a literal never follows its parameter. */
machineryRouter.get(
  '/machines/mine',
  requireAuth,
  asyncHandler<AuthedRequest>(async (req, res) => {
    const machines = await FarmMachine.find({ ownerId: req.userId, status: { $ne: 'RETIRED' } })
      .sort({ createdAt: -1 })
      .limit(20);

    ok(
      res,
      await Promise.all(
        machines.map(async (machine) => ({
          ...machine.toJSON(),
          completedJobs: await MachineBooking.countDocuments({
            machineId: machine._id,
            state: { $in: BILLABLE_BOOKING_STATES },
          }),
          upcoming: await MachineBooking.countDocuments({
            machineId: machine._id,
            state: { $in: ['REQUESTED', 'CONFIRMED'] },
          }),
        })),
      ),
    );
  }),
);

const machineSchema = z.object({
  category: z.enum(MACHINE_CATEGORIES),
  title: z.string().min(3).max(80),
  makeModel: z.string().max(60).optional(),
  operatorMode: z.enum(OPERATOR_MODES).default('WITH_OPERATOR'),
  attachments: z.array(z.string().max(40)).max(8).default([]),
  baseLocation: geoPoint,
  serviceRadiusKm: z.number().min(1).max(200).default(25),
  pricing: z.object({
    unit: z.enum(PRICING_UNITS),
    rate: z.number().min(1),
    minimumCharge: z.number().min(0).default(0),
    travelRatePerKm: z.number().min(0).default(0),
  }),
});

machineryRouter.post(
  '/machines',
  requireAuth,
  asyncHandler<AuthedRequest>(async (req, res) => {
    const body = machineSchema.parse(req.body);
    const machine = await FarmMachine.create({ ...body, ownerId: req.userId, status: 'LISTED' });
    ok(res, machine, 201);
  }),
);

machineryRouter.patch(
  '/machines/:id',
  requireAuth,
  asyncHandler<AuthedRequest>(async (req, res) => {
    const body = machineSchema.partial().extend({ status: z.enum(MACHINE_STATUSES).optional() }).parse(req.body);
    const machine = await FarmMachine.findById(req.params.id);
    if (!machine) throw new ApiError('RESOURCE_NOT_FOUND', 'That machine no longer exists.');
    if (String(machine.ownerId) !== req.userId) {
      throw new ApiError('AUTH_FORBIDDEN', 'That machine is not yours.');
    }
    machine.set(body);
    await machine.save();
    ok(res, machine);
  }),
);

/** Owner-declared unavailability. Not a booking, so it never reaches earnings. */
machineryRouter.post(
  '/machines/:id/blackouts',
  requireAuth,
  asyncHandler<AuthedRequest>(async (req, res) => {
    const body = z
      .object({ start: z.coerce.date(), end: z.coerce.date(), reason: z.string().max(80).optional() })
      .parse(req.body);
    if (body.end <= body.start) throw new ApiError('VALIDATION_ERROR', 'end: must be after start.');

    const machine = await FarmMachine.findById(req.params.id);
    if (!machine) throw new ApiError('RESOURCE_NOT_FOUND', 'That machine no longer exists.');
    if (String(machine.ownerId) !== req.userId) {
      throw new ApiError('AUTH_FORBIDDEN', 'That machine is not yours.');
    }

    machine.blackouts.push(body);
    await machine.save();
    ok(res, machine, 201);
  }),
);

machineryRouter.get(
  '/machines/:id',
  requireAuth,
  asyncHandler<AuthedRequest>(async (req, res) => {
    const machine = await FarmMachine.findById(req.params.id);
    if (!machine) throw new ApiError('RESOURCE_NOT_FOUND', 'That machine no longer exists.');

    const owner = await User.findById(machine.ownerId);
    ok(res, {
      ...machine.toJSON(),
      owner: owner && {
        _id: String(owner._id),
        name: owner.name,
        ratingAvg: owner.ratingAvg,
        ratingCount: owner.ratingCount,
      },
      completedJobs: await MachineBooking.countDocuments({
        machineId: machine._id,
        state: { $in: BILLABLE_BOOKING_STATES },
      }),
      schedule: await machineSchedule(String(machine._id)),
    });
  }),
);

// ---------------------------------------------------------------------------
// bookings
// ---------------------------------------------------------------------------

const bookSchema = z.object({
  machineId: z.string(),
  start: z.coerce.date(),
  end: z.coerce.date(),
  location: geoPoint,
  operatorMode: z.enum(BOOKING_OPERATOR_MODES),
  workType: z.string().max(60).optional(),
  areaAcres: z.number().positive().max(5000).optional(),
  notes: z.string().max(300).optional(),
});

machineryRouter.post(
  '/bookings',
  requireAuth,
  asyncHandler<AuthedRequest>(async (req, res) => {
    const body = bookSchema.parse(req.body);
    const { booking, machine } = await requestBooking({
      machineId: body.machineId,
      farmerId: req.userId,
      window: { start: body.start, end: body.end },
      location: body.location,
      operatorMode: body.operatorMode,
      workType: body.workType,
      areaAcres: body.areaAcres,
      notes: body.notes,
    });

    emitMachineBookingRequested({
      bookingId: String(booking._id),
      machineId: String(machine._id),
      providerId: String(machine.ownerId),
      category: booking.category,
      window: {
        start: booking.window.start.toISOString(),
        end: booking.window.end.toISOString(),
      },
      total: booking.quote.total,
    });
    await notifyMachineBooking(String(machine.ownerId), String(booking._id), machine.title);

    ok(res, booking, 201);
  }),
);

/** Everything this user is party to, on either side of the hire. */
machineryRouter.get(
  '/bookings/mine',
  requireAuth,
  asyncHandler<AuthedRequest>(async (req, res) => {
    const role = z.enum(['farmer', 'provider']).default('farmer').parse(req.query.role ?? 'farmer');
    const filter = role === 'provider' ? { providerId: req.userId } : { farmerId: req.userId };

    const bookings = await MachineBooking.find(filter).sort({ createdAt: -1 }).limit(50);
    const machines = await FarmMachine.find({ _id: { $in: bookings.map((b) => b.machineId) } });
    const people = await User.find({
      _id: { $in: bookings.flatMap((b) => [b.providerId, b.farmerId]) },
    });

    const machineById = new Map(machines.map((m) => [String(m._id), m]));
    const userById = new Map(people.map((u) => [String(u._id), u]));
    const brief = (id: unknown, withPhone: boolean) => {
      const u = userById.get(String(id));
      return u && {
        _id: String(u._id),
        name: u.name,
        phone: withPhone ? u.phone : undefined,
        ratingAvg: u.ratingAvg,
      };
    };

    ok(
      res,
      bookings.map((booking) => {
        const machine = machineById.get(String(booking.machineId));
        // phones are exchanged only once the job is actually on
        const committed = ['CONFIRMED', 'IN_PROGRESS', 'COMPLETED', 'PAID'].includes(booking.state);
        return {
          ...booking.toJSON(),
          // the farmer reads their own start code; the provider never sees it
          startOtp: role === 'farmer' ? booking.startOtp : undefined,
          machine: machine && {
            _id: String(machine._id),
            category: machine.category,
            title: machine.title,
            makeModel: machine.makeModel,
            baseLocation: machine.baseLocation,
          },
          provider: brief(booking.providerId, committed),
          farmer: brief(booking.farmerId, committed),
        };
      }),
    );
  }),
);

const advanceSchema = z.object({
  state: z.enum(MACHINE_BOOKING_STATES),
  otp: z.string().optional(),
  reason: z.string().max(200).optional(),
});

machineryRouter.patch(
  '/bookings/:id/state',
  requireAuth,
  asyncHandler<AuthedRequest>(async (req, res) => {
    const body = advanceSchema.parse(req.body);
    const booking = await advanceBooking(req.params.id, body.state, req.userId, {
      otp: body.otp,
      reason: body.reason,
    });

    emitMachineBookingState(
      {
        bookingId: String(booking._id),
        machineId: String(booking.machineId),
        state: booking.state,
        at: new Date().toISOString(),
        finalAmount: booking.finalAmount ?? undefined,
      },
      [String(booking.providerId), String(booking.farmerId)],
    );

    // tell whichever side did NOT make the move
    const actorIsProvider = String(booking.providerId) === req.userId;
    await notifyMachineBooking(
      String(actorIsProvider ? booking.farmerId : booking.providerId),
      String(booking._id),
      `Booking ${booking.state.toLowerCase().replace(/_/g, ' ')}`,
    );

    ok(res, booking);
  }),
);

/** What the provider has earned, and how well the machine is being used. */
machineryRouter.get(
  '/earnings',
  requireAuth,
  asyncHandler<AuthedRequest>(async (req, res) => {
    const bookings = await MachineBooking.find({
      providerId: req.userId,
      state: { $in: BILLABLE_BOOKING_STATES },
    })
      .sort({ completedAt: -1 })
      .limit(100);

    const machines = await FarmMachine.find({ ownerId: req.userId });
    const byMachine = new Map(machines.map((m) => [String(m._id), m]));

    const jobs = bookings.map((b) => ({
      bookingId: String(b._id),
      machineId: String(b.machineId),
      machineTitle: byMachine.get(String(b.machineId))?.title ?? 'Machine',
      category: b.category,
      completedAt: b.completedAt,
      amount: b.finalAmount ?? b.quote.total,
      earning: b.quote.providerEarning,
      paid: b.state === 'PAID',
    }));

    ok(res, {
      jobs,
      total: jobs.reduce((sum, j) => sum + j.earning, 0),
      settled: jobs.filter((j) => j.paid).reduce((sum, j) => sum + j.earning, 0),
      machineCount: machines.length,
    });
  }),
);
