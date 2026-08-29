import { ApiError } from '../../lib/envelope';
import { TransporterOffer, TransportRequest, Trip, TripShipment } from '../../models';
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

export async function createRequest(farmerId: string, input: CreateRequestInput) {
  return TransportRequest.create({
    ...input,
    farmerId,
    state: 'OPEN',
    expiresAt: new Date(Date.now() + POOL_TTL_HOURS * 3600_000),
  });
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

  return { request, shipment };
}
