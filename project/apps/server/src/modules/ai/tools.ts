import { ApiError } from '../../lib/envelope';
import { Mandi, TransportRequest, User, Vehicle } from '../../models';
import { cancelRequest, createRequest, getRequestForFarmer } from '../transport/service';
import { offersForRequest, selectTransporter } from '../pooling/service';
import type { AiTool } from '@kisanpool/shared';

/** Straight-line km between two lat/lng points. */
function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.lat * Math.PI) / 180) *
      Math.cos((b.lat * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

/** The farmer's saved pickup point — every geo tool needs an origin. */
async function farmerOrigin(userId: string): Promise<{ lat: number; lng: number; name: string }> {
  const user = await User.findById(userId);
  const loc = user?.defaultLocation;
  if (!loc || loc.lat == null || loc.lng == null) {
    throw new ApiError(
      'AI_INTENT_UNCLEAR',
      'I do not know where you are yet. Set your location on the home screen and ask me again.',
    );
  }
  return { lat: loc.lat, lng: loc.lng, name: loc.name ?? 'Your location' };
}

/**
 * The tools Servo AI may call — a closed set (ADR-014, extended in ADR-043). Each one calls the SAME
 * service function the REST route calls, so every validation a human tap triggers
 * also runs here. The model never touches Mongoose directly.
 */
export const STATE_CHANGING: AiTool[] = ['createTransportRequest', 'acceptMatch', 'cancelRequest'];

export interface ToolContext {
  /** always from the JWT, never from speech */
  userId: string;
}

export async function runTool(
  tool: AiTool,
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<unknown> {
  switch (tool) {
    case 'getUserProfile': {
      const user = await User.findById(ctx.userId);
      if (!user) throw new ApiError('RESOURCE_NOT_FOUND', 'Account not found.');
      return {
        name: user.name,
        language: user.language,
        defaultLocation: user.defaultLocation,
        ratingAvg: user.ratingAvg,
      };
    }

    case 'findMatchingVehicles': {
      // offers exist against a request; find the farmer's latest open one
      const request = await TransportRequest.findOne({
        farmerId: ctx.userId,
        state: { $in: ['OPEN', 'TRANSPORTER_INTERESTED'] },
      }).sort({ createdAt: -1 });

      if (!request) {
        throw new ApiError(
          'NO_VEHICLE_AVAILABLE',
          'There is no open request. Tell me what you want to send first.',
        );
      }
      return offersForRequest(String(request._id), ctx.userId);
    }

    case 'createTransportRequest': {
      const input = requireFields(args, [
        'cropType',
        'quantityKg',
        'pickupLocation',
        'destination',
      ]);
      const user = await User.findById(ctx.userId);

      const pickup = asPoint(input.pickupLocation, user?.defaultLocation);
      const destination = asPoint(input.destination);
      if (!pickup || !destination) {
        throw new ApiError(
          'AI_INTENT_UNCLEAR',
          'I need both a pickup place and a mandi to send it to. Which mandi should I use?',
        );
      }

      return createRequest(ctx.userId, {
        cropType: String(input.cropType),
        quantityKg: Number(input.quantityKg),
        pickup,
        destination,
        preferredDate: args.preferredDate ? new Date(String(args.preferredDate)) : new Date(),
      });
    }

    case 'acceptMatch': {
      // "accept" is now the farmer choosing one of the transporters who claimed
      // their request. It reserves capacity but takes no money — billing happens
      // after delivery (ADR-031), so there is nothing for the assistant to pay.
      const input = requireFields(args, ['requestId', 'offerId']);
      const result = await selectTransporter(
        String(input.requestId),
        String(input.offerId),
        ctx.userId,
      );
      return {
        requestId: String(input.requestId),
        tripId: String(result.trip._id),
        estimatedShare: result.shipment.allocatedPrice,
        handoff: `/(farmer)/trips/${String(result.trip._id)}`,
      };
    }

    case 'getTripStatus': {
      const requestId = args.requestId
        ? String(args.requestId)
        : String(
            (
              await TransportRequest.findOne({ farmerId: ctx.userId }).sort({ createdAt: -1 })
            )?._id ?? '',
          );
      if (!requestId) throw new ApiError('RESOURCE_NOT_FOUND', 'You have no trips yet.');

      const { request, shipment } = await getRequestForFarmer(requestId, ctx.userId);
      return {
        requestId: String(request._id),
        // the request's own state, or the shipment's once one exists
        status: shipment ? shipment.state : request.state,
        cropType: request.cropType,
        quantityKg: request.quantityKg,
        destination: request.destination.name,
        share: shipment ? (shipment.finalPrice ?? shipment.allocatedPrice) : null,
      };
    }

    case 'cancelRequest': {
      const input = requireFields(args, ['requestId']);
      return cancelRequest(
        String(input.requestId),
        String(args.reason ?? 'Cancelled by voice request'),
        ctx.userId,
      );
    }

    case 'findNearbyMandis': {
      const origin = await farmerOrigin(ctx.userId);
      const radiusKm = Math.min(Number(args.radiusKm) || 150, 500);

      const near = await Mandi.find({
        active: true,
        geo: {
          $near: {
            $geometry: { type: 'Point', coordinates: [origin.lng, origin.lat] },
            $maxDistance: radiusKm * 1000,
          },
        },
      }).limit(6);

      return {
        origin,
        mandis: near.map((m) => {
          const [lng, lat] = (m.geo?.coordinates ?? [0, 0]) as [number, number];
          return {
            name: m.name,
            city: m.city,
            state: m.state,
            crops: m.crops,
            lat,
            lng,
            distanceKm: Math.round(haversineKm(origin, { lat, lng }) * 10) / 10,
          };
        }),
      };
    }

    case 'findNearbyTransporters': {
      const origin = await farmerOrigin(ctx.userId);
      const radiusKm = Math.min(Number(args.radiusKm) || 30, 150);

      // an "online" transporter is a VERIFIED vehicle that is ONLINE with a
      // known position and spare capacity (same gate matching uses, ADR-010)
      const vehicles = await Vehicle.find({
        status: 'ONLINE',
        verificationStatus: 'VERIFIED',
        availableCapacityKg: { $gt: 0 },
        currentLocation: { $ne: null },
      })
        .populate('ownerId', 'name ratingAvg')
        .limit(50);

      const within = vehicles
        .map((v) => {
          const loc = v.currentLocation!;
          const owner = v.ownerId as unknown as { name?: string; ratingAvg?: number };
          return {
            name: owner?.name || 'Transporter',
            vehicleType: v.vehicleType,
            capacityKg: v.availableCapacityKg,
            ratePerKm: v.ratePerKm,
            ratingAvg: owner?.ratingAvg ?? 0,
            lat: loc.lat as number,
            lng: loc.lng as number,
            distanceKm:
              Math.round(haversineKm(origin, { lat: loc.lat as number, lng: loc.lng as number }) * 10) /
              10,
          };
        })
        .filter((v) => v.distanceKm <= radiusKm)
        .sort((a, b) => a.distanceKm - b.distanceKm)
        .slice(0, 8);

      return { origin, transporters: within };
    }

    default:
      // anything outside the tool contract
      throw new ApiError('AI_TOOL_ERROR', 'I am not able to do that.');
  }
}

function requireFields(
  args: Record<string, unknown>,
  fields: string[],
): Record<string, unknown> {
  const missing = fields.filter((f) => args[f] === undefined || args[f] === null || args[f] === '');
  if (missing.length) {
    throw new ApiError(
      'AI_INTENT_UNCLEAR',
      `I still need: ${missing.join(', ')}. Could you tell me that?`,
    );
  }
  return args;
}

function asPoint(
  value: unknown,
  fallback?: { name?: string | null; lat?: number | null; lng?: number | null } | null,
): { name: string; lat: number; lng: number } | null {
  if (value && typeof value === 'object' && 'lat' in value && 'lng' in value) {
    const point = value as { name?: string; lat: number; lng: number };
    return { name: point.name ?? '', lat: point.lat, lng: point.lng };
  }
  // a spoken place name with no coordinates falls back to the saved default pickup
  if (typeof value === 'string' && fallback?.lat != null && fallback?.lng != null) {
    return { name: value, lat: fallback.lat, lng: fallback.lng };
  }
  return null;
}
