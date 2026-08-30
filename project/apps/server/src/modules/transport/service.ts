import mongoose from 'mongoose';
import { ApiError } from '../../lib/envelope';
import { TransporterOffer, TransportRequest, Trip, TripShipment } from '../../models';
import { capacityOf, reallocate } from '../pooling/pricing';
import { markCommitted, operationKey, recordIntent } from '../resilience/journal';
import type { GeoPoint } from '@kisanpool/shared';

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
}

/** How long a request waits for a claim before it stops being shown. */
const POOL_TTL_HOURS = 24;

/**
 * Journalled write-ahead (ADR-044). This is the very first critical write in the
 * whole pipeline — if MongoDB blips right here, the farmer's intent must not just
 * vanish. There is no pre-existing entity to key off (unlike selecting a
 * transporter, which keys off the request), so the operation key is derived from
 * WHAT the farmer asked for: the same submission retried hashes to the same key,
 * and the request's own _id is derived from that key too, so a retry that lands
 * after an earlier attempt already committed recognises the same document rather
 * than creating a duplicate open request.
 */
function requestIdempotencyKey(farmerId: string, input: CreateRequestInput): string {
  return operationKey(
    'REQUEST_CREATED',
    farmerId,
    `${input.cropType}:${input.quantityKg}:${input.pickup.lat}:${input.pickup.lng}:${input.destination.lat}:${input.destination.lng}:${input.preferredDate.toISOString()}`,
  );
}

export async function createRequest(farmerId: string, input: CreateRequestInput) {
  const opKey = requestIdempotencyKey(farmerId, input);
  // the operation key is 32 hex chars; the first 24 make a valid, deterministic
  // ObjectId, so a replayed retry always points at the same document
  const requestId = new mongoose.Types.ObjectId(opKey.slice(0, 24));

  const intent = await recordIntent({
    eventType: 'REQUEST_CREATED',
    entityType: 'TransportRequest',
    entityId: String(requestId),
    actorId: farmerId,
    operationKey: opKey,
    payload: { farmerId },
  });

  // a genuine retry of an attempt that actually landed must return the existing
  // request, not a duplicate-key error — "processing an event twice changes
  // nothing" applies here just as it does to replay (recovery.ts)
  const existing = await TransportRequest.findById(requestId);
  if (existing) {
    await markCommitted(intent);
    return existing;
  }

  const request = await TransportRequest.create({
    _id: requestId,
    ...input,
    farmerId,
    state: 'OPEN',
    expiresAt: new Date(Date.now() + POOL_TTL_HOURS * 3600_000),
  });

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

  return { request, shipment, pricing, capacity, tripId: shipment?.tripId ?? null };
}
