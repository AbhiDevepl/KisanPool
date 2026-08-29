import { ApiError } from '../../lib/envelope';
import { TransporterOffer, TransportRequest, Trip, TripShipment } from '../../models';
import { capacityOf, reallocate } from '../pooling/pricing';
import type { GeoPoint } from '@kisanpool/shared';
import { markCommitted, operationKey, recordIntent } from '../resilience/journal';

/**
 * The farmer's side of the pool.
 *
 * A request is created, sits in the pool for nearby transporters to claim, and
 * ends when the farmer selects one. Everything after that — pickup, transit,
 * delivery, payment — belongs to the shipment, not the request (ADR-030).
 */

export interface CreateRequestInput {
  cropType: string;
  quantityKg: number;
  pickup: GeoPoint;
  destination: GeoPoint;
  preferredDate: Date;
  notes?: string;
  /** recovery-only: preserve the original identity across a replay */
  id?: string;
}

/** How long a request waits for a claim before it stops being shown. */
const POOL_TTL_HOURS = 24;

export async function createRequest(farmerId: string, input: CreateRequestInput) {
  const request = new TransportRequest({
    _id: input.id,
    ...input,
    farmerId,
    state: 'OPEN',
    expiresAt: new Date(Date.now() + POOL_TTL_HOURS * 3600_000),
  });
  const intent = await recordIntent({
    eventType: 'REQUEST_CREATED',
    entityType: 'TransportRequest',
    entityId: String(request._id),
    actorId: farmerId,
    operationKey: operationKey('REQUEST_CREATED', String(request._id)),
    payload: {
      cropType: input.cropType,
      quantityKg: input.quantityKg,
      pickup: input.pickup,
      destination: input.destination,
      preferredDate: input.preferredDate.toISOString(),
      notes: input.notes ?? null,
    },
  });
  await request.save();
  await markCommitted(intent);
  return request;
}

export async function myRequests(farmerId: string) {
  const requests = await TransportRequest.find({ farmerId }).sort({ createdAt: -1 }).limit(50);

  // one round trip for the counts the list needs, rather than one per row
  const [offerCounts, shipments] = await Promise.all([
    TransporterOffer.aggregate<{ _id: unknown; count: number }>([
      { $match: { requestId: { $in: requests.map((r) => r._id) }, state: 'INTERESTED' } },
      { $group: { _id: '$requestId', count: { $sum: 1 } } },
    ]),
    TripShipment.find({ requestId: { $in: requests.map((r) => r._id) } }),
  ]);

  const counts = new Map(offerCounts.map((o) => [String(o._id), o.count]));
  const byRequest = new Map(shipments.map((s) => [String(s.requestId), s]));

  return requests.map((request) => {
    const shipment = byRequest.get(String(request._id));
    return {
      ...request.toJSON(),
      offerCount: counts.get(String(request._id)) ?? 0,
      shipment: shipment
        ? {
            _id: String(shipment._id),
            tripId: String(shipment.tripId),
            state: shipment.state,
            allocatedPrice: shipment.allocatedPrice,
            finalPrice: shipment.finalPrice ?? null,
            soloPrice: shipment.soloPrice,
            pickupOtp: shipment.pickupOtp,
          }
        : null,
    };
  });
}

export async function getRequestForFarmer(requestId: string, farmerId: string) {
  const request = await TransportRequest.findById(requestId);
  if (!request) throw new ApiError('RESOURCE_NOT_FOUND', 'That request no longer exists.');
  if (String(request.farmerId) !== farmerId) {
    throw new ApiError('AUTH_FORBIDDEN', "That request isn't yours.");
  }

  const shipment = await TripShipment.findOne({ requestId: request._id });
  const trip = shipment ? await Trip.findById(shipment.tripId) : null;

  return { request, shipment, trip };
}

/**
 * Cancelling.
 *
 * Before a transporter is chosen this is free — nothing was reserved. Afterwards
 * it releases the capacity the shipment held, and the remaining farmers on that
 * trip get re-priced, since the route cost now splits fewer ways.
 */
export async function cancelRequest(requestId: string, reason: string, farmerId: string) {
  const request = await TransportRequest.findById(requestId);
  if (!request) throw new ApiError('RESOURCE_NOT_FOUND', 'That request no longer exists.');
  if (String(request.farmerId) !== farmerId) {
    throw new ApiError('AUTH_FORBIDDEN', "That request isn't yours.");
  }
  if (['CANCELLED', 'EXPIRED'].includes(request.state)) {
    throw new ApiError('BOOKING_STATE_INVALID', 'This request is already closed.');
  }

  // A cancellation can release capacity and reprice a pool, so retain the intent
  // before changing either record. The request id is stable across retries.
  const intent = await recordIntent({
    eventType: 'SHIPMENT_CANCELLED',
    entityType: 'TransportRequest',
    entityId: requestId,
    actorId: farmerId,
    operationKey: operationKey('SHIPMENT_CANCELLED', requestId),
    payload: { requestId, reason },
  });

  const shipment = await TripShipment.findOne({ requestId: request._id });

  if (shipment && ['PICKED_UP', 'IN_TRANSIT', 'DELIVERED'].includes(shipment.state)) {
    throw new ApiError(
      'PAYMENT_REFUND_NOT_ALLOWED',
      'Your produce is already on the vehicle. Please contact support to cancel.',
    );
  }

  if (shipment) {
    shipment.state = 'CANCELLED';
    shipment.cancelledAt = new Date();
    await shipment.save();
  }

  await TransporterOffer.updateMany(
    { requestId: request._id, state: 'INTERESTED' },
    { state: 'EXPIRED' },
  );

  request.state = 'CANCELLED';
  request.cancelledAt = new Date();
  request.cancelReason = reason;
  await request.save();

  // Leaving the pool moves everyone else's share — the route no longer detours to
  // this pickup and the line-haul splits fewer ways. This used to be promised in
  // a comment and never actually done, so the remaining farmers kept a price that
  // had been computed for a pool they were no longer in.
  let pricing = null;
  let capacity = null;
  if (shipment?.tripId) {
    const trip = await Trip.findById(shipment.tripId);
    if (trip) {
      const result = await reallocate(String(trip._id), 'a farmer left the trip');
      pricing = result;
      capacity = await capacityOf(trip);
    }
  }

  await markCommitted(intent);
  return { request, shipment, pricing, capacity, tripId: shipment?.tripId ?? null };
}
