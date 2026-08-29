import { ApiError } from '../../lib/envelope';
import { TransportRequest, User } from '../../models';
import { cancelRequest, createRequest, getRequestForFarmer } from '../transport/service';
import { offersForRequest, selectTransporter } from '../pooling/service';
import type { AiTool } from '@kisanpool/shared';

/**
 * The six tools Servo AI may call — no more (ADR-014). Each one calls the SAME
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

    default:
      // anything outside the six-tool contract
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
