import { Router } from 'express';
import { z } from 'zod';
import { ok } from '../../lib/envelope';
import { asyncHandler } from '../../middleware/error';
import { requireAuth, requireRole, type AuthedRequest } from '../../middleware/auth';
import { listChatMessages } from '../chat/service';
import { emitPricingUpdated, emitTripCapacity } from '../realtime';
import {
  cancelRequest,
  createRequest,
  deleteRequest,
  getRequestForFarmer,
  myRequests,
} from './service';

export const transportRouter = Router();

const geoPoint = z.object({ name: z.string().min(1), lat: z.number(), lng: z.number() });

transportRouter.post(
  '/requests',
  requireAuth,
  requireRole('FARMER'),
  asyncHandler<AuthedRequest>(async (req, res) => {
    const body = z
      .object({
        cropType: z.string().min(1),
        quantityKg: z.number().positive(),
        pickup: geoPoint,
        destination: geoPoint,
        preferredDate: z.coerce.date(),
        notes: z.string().max(300).optional(),
      })
      .parse(req.body);

    ok(res, await createRequest(req.userId, body), 201);
  }),
);

transportRouter.get(
  '/requests',
  requireAuth,
  asyncHandler<AuthedRequest>(async (req, res) => {
    ok(res, await myRequests(req.userId));
  }),
);

transportRouter.get(
  '/requests/:id',
  requireAuth,
  asyncHandler<AuthedRequest>(async (req, res) => {
    ok(res, await getRequestForFarmer(req.params.id, req.userId));
  }),
);

transportRouter.post(
  '/requests/:id/cancel',
  requireAuth,
  asyncHandler<AuthedRequest>(async (req, res) => {
    const { reason } = z.object({ reason: z.string().min(1) }).parse(req.body);
    const result = await cancelRequest(req.params.id, reason, req.userId);

    // the farmers still aboard have just been re-priced and the driver has space
    // back — both sides need to hear it without pulling to refresh
    if (result.tripId && result.pricing) {
      const tripId = String(result.tripId);
      if (result.pricing.allocations.length) {
        emitPricingUpdated({
          tripId,
          pricingVersion: result.pricing.version,
          reason: 'a farmer left the trip',
          updates: result.pricing.allocations.map((a) => ({
            farmerId: a.farmerId,
            shipmentId: a.shipmentId,
            amount: a.amount,
            previousAmount: a.previousAmount,
          })),
        });
      }
      if (result.capacity) {
        emitTripCapacity({
          tripId,
          capacity: result.capacity,
          poolSize: result.pricing.pricing?.poolSize ?? 0,
        });
      }
    }

    ok(res, result);
  }),
);

transportRouter.delete(
  '/requests/:id',
  requireAuth,
  asyncHandler<AuthedRequest>(async (req, res) => {
    ok(res, await deleteRequest(req.params.id, req.userId));
  }),
);

/** Chat is per trip now — everyone sharing the vehicle is in one thread. */
transportRouter.get(
  '/trips/:tripId/messages',
  requireAuth,
  asyncHandler<AuthedRequest>(async (req, res) => {
    ok(res, await listChatMessages(req.params.tripId, req.userId));
  }),
);
