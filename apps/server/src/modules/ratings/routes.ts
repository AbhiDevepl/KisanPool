import { Router } from 'express';
import { z } from 'zod';
import { ApiError, ok } from '../../lib/envelope';
import { asyncHandler } from '../../middleware/error';
import { requireAuth, type AuthedRequest } from '../../middleware/auth';
import { Rating, Trip, TripShipment, User } from '../../models';

export const ratingsRouter = Router();

ratingsRouter.get(
  '/:id/ratings',
  requireAuth,
  asyncHandler<AuthedRequest>(async (req, res) => {
    ok(res, await Rating.find({ shipmentId: req.params.id }));
  }),
);

ratingsRouter.post(
  '/:id/ratings',
  requireAuth,
  asyncHandler<AuthedRequest>(async (req, res) => {
    const { stars, comment } = z
      .object({ stars: z.number().int().min(1).max(5), comment: z.string().max(500).optional() })
      .parse(req.body);

    // :id is a shipment — one leg of a shared trip, which is what a rating is about
    const shipment = await TripShipment.findById(req.params.id);
    if (!shipment) throw new ApiError('RESOURCE_NOT_FOUND', 'That load no longer exists.');
    if (!['DELIVERED', 'PAYMENT_PENDING', 'PAID', 'COMPLETED'].includes(shipment.state)) {
      throw new ApiError('BOOKING_STATE_INVALID', 'You can rate this once it has been delivered.');
    }

    const trip = await Trip.findById(shipment.tripId);
    if (!trip) throw new ApiError('RESOURCE_NOT_FOUND', 'That trip no longer exists.');

    const farmerId = String(shipment.farmerId);
    const transporterId = String(trip.transporterId);

    // the subject is whichever party the rater is not
    let toUserId: string;
    if (req.userId === farmerId) toUserId = transporterId;
    else if (req.userId === transporterId) toUserId = farmerId;
    else throw new ApiError('AUTH_FORBIDDEN', "You don't have access to this load.");

    const already = await Rating.findOne({ shipmentId: shipment._id, fromUserId: req.userId });
    if (already) throw new ApiError('BOOKING_ALREADY_RATED', 'You have already rated this.');

    const rating = await Rating.create({
      tripId: trip._id,
      shipmentId: shipment._id,
      fromUserId: req.userId,
      toUserId,
      stars,
      comment: comment ?? '',
    });

    // roll up into the subject's average — derived, never client-written
    const all = await Rating.find({ toUserId });
    const avg = all.reduce((sum, r) => sum + r.stars, 0) / all.length;
    await User.findByIdAndUpdate(toUserId, {
      ratingAvg: Math.round(avg * 10) / 10,
      ratingCount: all.length,
    });

    ok(res, rating, 201);
  }),
);
