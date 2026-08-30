import { Router } from 'express';
import { z } from 'zod';
import { ApiError, ok } from '../../lib/envelope';
import { asyncHandler } from '../../middleware/error';
import { requireAuth, requireRole, type AuthedRequest } from '../../middleware/auth';
import { VEHICLE_STATUSES, VEHICLE_TYPES } from '@kisanpool/shared';
import { Vehicle } from '../../models';

export const vehiclesRouter = Router();

const createSchema = z.object({
  vehicleType: z.enum(VEHICLE_TYPES),
  registrationNumber: z.string().min(4).max(20),
  capacityKg: z.number().positive(),
  ratePerKm: z.number().positive(),
  currentLocation: z.object({ lat: z.number(), lng: z.number() }).optional(),
});

/** Register or update the caller's vehicle. Always starts PENDING — KYC gates matching (ADR-010). */
vehiclesRouter.post(
  '/',
  requireAuth,
  requireRole('TRANSPORTER'),
  asyncHandler<AuthedRequest>(async (req, res) => {
    const body = createSchema.parse(req.body);
    const existing = await Vehicle.findOne({ ownerId: req.userId });

    if (existing) {
      existing.set({
        ...body,
        // capacity change resets what's free, but never re-opens a verified gate
        availableCapacityKg: body.capacityKg,
      });
      await existing.save();
      ok(res, existing);
      return;
    }

    const vehicle = await Vehicle.create({
      ...body,
      ownerId: req.userId,
      availableCapacityKg: body.capacityKg,
      status: 'OFFLINE',
      verificationStatus: 'PENDING',
    });
    ok(res, vehicle, 201);
  }),
);

vehiclesRouter.get(
  '/me',
  requireAuth,
  requireRole('TRANSPORTER'),
  asyncHandler<AuthedRequest>(async (req, res) => {
    ok(res, await Vehicle.findOne({ ownerId: req.userId }));
  }),
);

vehiclesRouter.patch(
  '/:id/availability',
  requireAuth,
  requireRole('TRANSPORTER'),
  asyncHandler<AuthedRequest>(async (req, res) => {
    const { status } = z.object({ status: z.enum(VEHICLE_STATUSES) }).parse(req.body);
    const vehicle = await Vehicle.findById(req.params.id);

    if (!vehicle) throw new ApiError('RESOURCE_NOT_FOUND', 'Vehicle not found.');
    if (String(vehicle.ownerId) !== req.userId) {
      throw new ApiError('AUTH_FORBIDDEN', 'That vehicle is not yours.');
    }
    // going online is meaningless while unverified — say so rather than silently failing
    if (status === 'AVAILABLE' && vehicle.verificationStatus !== 'VERIFIED') {
      throw new ApiError(
        'KYC_PENDING_REVIEW',
        'Your documents are still being verified. You can go online once they are approved.',
      );
    }

    vehicle.status = status;
    await vehicle.save();
    ok(res, vehicle);
  }),
);

/** The driver's live position, so the request pool can match by where they are now. */
vehiclesRouter.patch(
  '/me/location',
  requireAuth,
  requireRole('TRANSPORTER'),
  asyncHandler<AuthedRequest>(async (req, res) => {
    const { lat, lng } = z
      .object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) })
      .parse(req.body);
    const vehicle = await Vehicle.findOneAndUpdate(
      { ownerId: req.userId },
      { currentLocation: { lat, lng } },
      { new: true },
    );
    if (!vehicle) throw new ApiError('RESOURCE_NOT_FOUND', 'Register your vehicle first.');
    ok(res, vehicle);
  }),
);
