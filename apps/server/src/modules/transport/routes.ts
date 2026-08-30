import { Router } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import { ok } from '../../lib/envelope';
import { asyncHandler } from '../../middleware/error';
import { requireAuth, requireRole, type AuthedRequest } from '../../middleware/auth';
import { listChatMessages } from '../chat/service';
import { emitPricingUpdated, emitTripCapacity } from '../realtime';
import { deferrable, requireWritable } from '../resilience/guard';
import { listKey, okOrLastKnown } from '../resilience/snapshots';
import {
  cancelRequest,
  createRequest,
  getRequestForFarmer,
  myRequests,
} from './service';

export const transportRouter = Router();

const geoPoint = z.object({ name: z.string().min(1), lat: z.number(), lng: z.number() });

const createRequestSchema = z.object({
  cropType: z.string().min(1),
  quantityKg: z.number().positive(),
  pickup: geoPoint,
  destination: geoPoint,
  preferredDate: z.coerce.date(),
  notes: z.string().max(300).optional(),
});

transportRouter.post(
  '/requests',
  requireAuth,
  requireRole('FARMER'),
  /*
   * Every input a replay needs is in this body and `createRequest` accepts a
   * preset `id`, so an outage does not have to lose it — it is journalled with
   * the identity it will be created under, and replayed through the same service
   * (ADR-045).
   */
  deferrable((req) => {
    const body = createRequestSchema.parse(req.body);
    return {
      eventType: 'REQUEST_CREATED',
      entityType: 'TransportRequest',
      entityId: String(new mongoose.Types.ObjectId()),
      payload: { ...body, preferredDate: body.preferredDate.toISOString() },
    };
  }),
  asyncHandler<AuthedRequest>(async (req, res) => {
    const body = createRequestSchema.parse(req.body);
    ok(res, await createRequest(req.userId, body), 201);
  }),
);

transportRouter.get(
  '/requests',
  requireAuth,
  asyncHandler<AuthedRequest>(async (req, res) => {
    await okOrLastKnown(res, listKey('requests', req.userId), () => myRequests(req.userId));
  }),
);

transportRouter.get(
  '/requests/:id',
  requireAuth,
  asyncHandler<AuthedRequest>(async (req, res) => {
    await okOrLastKnown(res, `request:${req.params.id}:${req.userId}`, () =>
      getRequestForFarmer(req.params.id, req.userId),
    );
  }),
);

transportRouter.post(
  '/requests/:id/cancel',
  requireAuth,
  requireWritable,
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
          pricing: result.pricing.pricing ?? undefined,
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

/** Chat is per trip now — everyone sharing the vehicle is in one thread. */
transportRouter.get(
  '/trips/:tripId/messages',
  requireAuth,
  asyncHandler<AuthedRequest>(async (req, res) => {
    ok(res, await listChatMessages(req.params.tripId, req.userId));
  }),
);
