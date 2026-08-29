import { Router } from 'express';
import { z } from 'zod';
import { ok } from '../../lib/envelope';
import { asyncHandler } from '../../middleware/error';
import { requireAuth, requireRole, type AuthedRequest } from '../../middleware/auth';
import { SHIPMENT_STATES, TRIP_STATES } from '@kisanpool/shared';
import { PricingEvent, TransporterOffer, Trip, TripShipment, User } from '../../models';
import {
  advanceShipment,
  advanceTrip,
  claimRequest,
  offersForRequest,
  poolForTransporter,
  selectTransporter,
  trackTrip,
  tripDetail,
  withdrawOffer,
} from './service';
import { capacityOf, priceTripById, reallocate, savingPct } from './pricing';
import {
  emitOfferReceived,
  emitOfferWithdrawn,
  emitPricingUpdated,
  emitShipmentState,
  emitTransporterSelected,
  emitTripCapacity,
} from '../realtime';
import {
  notifyOfferReceived,
  notifyOfferSelected,
  notifyPriceChanged,
} from '../notifications/service';

export const poolRouter = Router();

// ---------------------------------------------------------------------------
// transporter: the pool
// ---------------------------------------------------------------------------

poolRouter.get(
  '/requests',
  requireAuth,
  requireRole('TRANSPORTER'),
  asyncHandler<AuthedRequest>(async (req, res) => {
    ok(res, await poolForTransporter(req.userId));
  }),
);

poolRouter.post(
  '/requests/:id/claim',
  requireAuth,
  requireRole('TRANSPORTER'),
  asyncHandler<AuthedRequest>(async (req, res) => {
    const { message } = z.object({ message: z.string().max(200).optional() }).parse(req.body);
    const { offer, request } = await claimRequest(req.params.id, req.userId, message);

    const transporter = await User.findById(req.userId);
    emitOfferReceived({
      requestId: String(request._id),
      offer: {
        _id: String(offer._id),
        requestId: String(offer.requestId),
        transporterId: String(offer.transporterId),
        vehicleId: String(offer.vehicleId),
        tripId: offer.tripId ? String(offer.tripId) : null,
        state: offer.state,
        quotedPrice: offer.quotedPrice,
        soloPrice: offer.soloPrice,
        savingPct: savingPct(offer.soloPrice, offer.quotedPrice),
        pickupDistanceKm: offer.pickupDistanceKm,
        detourKm: offer.detourKm,
        etaMinutes: offer.etaMinutes,
        message: offer.message ?? undefined,
        createdAt: new Date().toISOString(),
        poolSize: 0,
        transporter: transporter
          ? {
              _id: String(transporter._id),
              name: transporter.name,
              ratingAvg: transporter.ratingAvg,
              ratingCount: transporter.ratingCount,
            }
          : undefined,
      },
    });
    await notifyOfferReceived(
      String(request.farmerId),
      String(request._id),
      transporter?.name ?? 'A transporter',
    );

    ok(res, offer, 201);
  }),
);

poolRouter.post(
  '/offers/:id/withdraw',
  requireAuth,
  requireRole('TRANSPORTER'),
  asyncHandler<AuthedRequest>(async (req, res) => {
    const offer = await withdrawOffer(req.params.id, req.userId);
    emitOfferWithdrawn({ requestId: String(offer.requestId), offerId: String(offer._id) });
    ok(res, offer);
  }),
);

/** Offers this transporter is waiting on — the "you claimed it, farmer deciding" list. */
poolRouter.get(
  '/offers/mine',
  requireAuth,
  requireRole('TRANSPORTER'),
  asyncHandler<AuthedRequest>(async (req, res) => {
    const offers = await TransporterOffer.find({
      transporterId: req.userId,
      state: { $in: ['INTERESTED', 'SELECTED'] },
    }).sort({ createdAt: -1 });

    const { TransportRequest } = await import('../../models');
    const requests = await TransportRequest.find({
      _id: { $in: offers.map((o) => o.requestId) },
    });
    const byId = new Map(requests.map((r) => [String(r._id), r]));

    // the DTO promises savingPct and poolSize, so this must serve them rather than
    // dumping the raw model and letting the screen quietly render nothing
    const tripIds = offers.map((o) => o.tripId).filter(Boolean);
    const poolSizes = await TripShipment.aggregate<{ _id: unknown; count: number }>([
      { $match: { tripId: { $in: tripIds }, state: { $ne: 'CANCELLED' } } },
      { $group: { _id: '$tripId', count: { $sum: 1 } } },
    ]);
    const sizeByTrip = new Map(poolSizes.map((p) => [String(p._id), p.count]));

    ok(
      res,
      offers.map((offer) => ({
        ...offer.toJSON(),
        savingPct: savingPct(offer.soloPrice, offer.quotedPrice),
        poolSize: offer.tripId ? (sizeByTrip.get(String(offer.tripId)) ?? 0) : 0,
        request: byId.get(String(offer.requestId)),
      })),
    );
  }),
);

// ---------------------------------------------------------------------------
// farmer: compare and choose
// ---------------------------------------------------------------------------

poolRouter.get(
  '/requests/:id/offers',
  requireAuth,
  asyncHandler<AuthedRequest>(async (req, res) => {
    ok(res, await offersForRequest(req.params.id, req.userId));
  }),
);

poolRouter.post(
  '/requests/:id/select',
  requireAuth,
  requireRole('FARMER'),
  asyncHandler<AuthedRequest>(async (req, res) => {
    const { offerId } = z.object({ offerId: z.string() }).parse(req.body);
    const { trip, shipment, offer, pricing } = await selectTransporter(
      req.params.id,
      offerId,
      req.userId,
    );

    emitTransporterSelected({
      requestId: req.params.id,
      tripId: String(trip._id),
      shipmentId: String(shipment._id),
      transporterId: String(offer.transporterId),
    });
    await notifyOfferSelected(String(offer.transporterId), String(trip._id));

    // everyone already aboard just got cheaper — tell them
    if (pricing.allocations.length > 1) {
      emitPricingUpdated({
        tripId: String(trip._id),
        pricingVersion: pricing.version,
        reason: 'a farmer joined the trip',
        updates: pricing.allocations.map((a) => ({
          farmerId: a.farmerId,
          shipmentId: a.shipmentId,
          amount: a.amount,
          previousAmount: a.previousAmount,
        })),
        // the whole re-priced trip, so every screen updates its headline share,
        // the trip total and the other farmers' rows without a refetch (ADR-040)
        pricing: pricing.pricing ?? undefined,
      });

      const cheaper = pricing.allocations.filter(
        (a) => a.previousAmount != null && a.amount < a.previousAmount,
      );
      if (cheaper.length) {
        await notifyPriceChanged(
          cheaper.map((a) => a.farmerId),
          String(trip._id),
          'down',
        );
      }
    }

    const capacity = await capacityOf(trip);
    emitTripCapacity({
      tripId: String(trip._id),
      capacity,
      // every load aboard, not just the ones whose price still moves — a delivered
      // farmer is still a farmer on this trip
      poolSize: pricing.pricing?.poolSize ?? pricing.allocations.length,
    });

    ok(
      res,
      {
        trip,
        shipment,
        capacity,
        pricingVersion: pricing.version,
        pricing: pricing.pricing,
      },
      201,
    );
  }),
);

// ---------------------------------------------------------------------------
// the shared trip
// ---------------------------------------------------------------------------

/**
 * The driver's own trips.
 *
 * MUST stay above `/trips/:id`. Express matches in registration order, so with
 * the parameter route first this resolved as id="mine", `Trip.findById('mine')`
 * threw a CastError, and the whole transporter Dashboard and Trips tab rendered
 * "We could not find that" instead of the driver's trips.
 */
poolRouter.get(
  '/trips/mine',
  requireAuth,
  requireRole('TRANSPORTER'),
  asyncHandler<AuthedRequest>(async (req, res) => {
    const trips = await Trip.find({ transporterId: req.userId }).sort({ createdAt: -1 }).limit(30);
    ok(
      res,
      await Promise.all(
        trips.map(async (trip) => ({
          ...trip.toJSON(),
          capacity: await capacityOf(trip),
          poolSize: await TripShipment.countDocuments({
            tripId: trip._id,
            state: { $ne: 'CANCELLED' },
          }),
          // the trip's economics, from the same engine the farmers are priced by
          pricing: await priceTripById(String(trip._id)),
        })),
      ),
    );
  }),
);

poolRouter.get(
  '/trips/:id',
  requireAuth,
  asyncHandler<AuthedRequest>(async (req, res) => {
    ok(res, await tripDetail(req.params.id, req.userId));
  }),
);

/**
 * Live Track hand-off to Google Maps (ADR-042). Read-only: latest transporter
 * position + destination mandi + a ready directions deep link, plus one
 * business-state `trackable` flag. Trip-party only.
 */
poolRouter.get(
  '/trips/:id/track',
  requireAuth,
  asyncHandler<AuthedRequest>(async (req, res) => {
    ok(res, await trackTrip(req.params.id, req.userId));
  }),
);

poolRouter.patch(
  '/trips/:id/state',
  requireAuth,
  requireRole('TRANSPORTER'),
  asyncHandler<AuthedRequest>(async (req, res) => {
    const { state } = z.object({ state: z.enum(TRIP_STATES) }).parse(req.body);
    ok(res, await advanceTrip(req.params.id, state, req.userId));
  }),
);

/** The pricing audit trail — what changed, when and why (PROMPT_2 §22). */
poolRouter.get(
  '/trips/:id/pricing',
  requireAuth,
  asyncHandler<AuthedRequest>(async (req, res) => {
    await tripDetail(req.params.id, req.userId); // reuses the access check
    ok(
      res,
      await PricingEvent.find({ tripId: req.params.id }).sort({ version: -1 }).limit(20),
    );
  }),
);

// ---------------------------------------------------------------------------
// shipments — each farmer's load advances on its own
// ---------------------------------------------------------------------------

poolRouter.patch(
  '/shipments/:id/state',
  requireAuth,
  requireRole('TRANSPORTER'),
  asyncHandler<AuthedRequest>(async (req, res) => {
    const { state, otp } = z
      .object({ state: z.enum(SHIPMENT_STATES), otp: z.string().optional() })
      .parse(req.body);

    const { shipment, trip } = await advanceShipment(req.params.id, state, req.userId, otp);

    emitShipmentState({
      tripId: String(trip._id),
      shipmentId: String(shipment._id),
      requestId: String(shipment.requestId),
      state: shipment.state,
      at: new Date().toISOString(),
    });

    // delivering frees the space it held, so the driver can take another load
    if (state === 'DELIVERED') {
      // billing opens the moment the produce is handed over
      shipment.state = 'PAYMENT_PENDING';
      await shipment.save();

      // this load's bill just froze, so what is left of the route now splits
      // among the farmers still aboard — without this they kept carrying a share
      // computed for a pool that had already changed
      const repriced = await reallocate(String(trip._id), 'a load was delivered');
      if (repriced.allocations.length) {
        emitPricingUpdated({
          tripId: String(trip._id),
          pricingVersion: repriced.version,
          reason: 'a load was delivered',
          updates: repriced.allocations.map((a) => ({
            farmerId: a.farmerId,
            shipmentId: a.shipmentId,
            amount: a.amount,
            previousAmount: a.previousAmount,
          })),
          pricing: repriced.pricing ?? undefined,
        });
      }

      emitTripCapacity({
        tripId: String(trip._id),
        capacity: await capacityOf(trip),
        poolSize: await TripShipment.countDocuments({
          tripId: trip._id,
          state: { $nin: ['CANCELLED'] },
        }),
      });
    }

    ok(res, shipment);
  }),
);

/** The farmer's own loads, across every trip. */
poolRouter.get(
  '/shipments/mine',
  requireAuth,
  asyncHandler<AuthedRequest>(async (req, res) => {
    const shipments = await TripShipment.find({ farmerId: req.userId })
      .sort({ createdAt: -1 })
      .limit(50);
    const trips = await Trip.find({ _id: { $in: shipments.map((s) => s.tripId) } });
    const byId = new Map(trips.map((t) => [String(t._id), t]));

    ok(
      res,
      shipments.map((shipment) => ({
        ...shipment.toJSON(),
        savingPct: savingPct(shipment.soloPrice, shipment.finalPrice ?? shipment.allocatedPrice),
        trip: byId.get(String(shipment.tripId)) ?? null,
      })),
    );
  }),
);
