import type { Server as SocketServer, Socket } from 'socket.io';
import type {
  ChatMessageEvent,
  PaymentCapturedEvent,
  TripLocationEvent,
  TripStatusEvent,
  Role,
} from '@kisanpool/shared';
import type {
  OfferReceivedEvent,
  OfferWithdrawnEvent,
  PricingUpdatedEvent,
  ShipmentStateEvent,
  TransporterSelectedEvent,
  TripCapacityEvent,
} from '@kisanpool/shared';
import type {
  BackhaulBookedEvent,
  BackhaulOfferedEvent,
  BackhaulStateEvent,
  MachineBookingRequestedEvent,
  MachineBookingStateEvent,
  ReturnLegStateEvent,
} from '@kisanpool/shared';
import { ApiError, socketError } from '../../lib/envelope';
import { verifyAccessToken } from '../../lib/jwt';
import { Trip, TripShipment } from '../../models';
import { isParticipant, saveChatMessage } from '../chat/service';
import { notifyChatMessage } from '../notifications/service';
import { estimateEtaMinutes } from '../maps/service';

interface AuthedSocket extends Socket {
  userId: string;
  role: Role;
}

let io: SocketServer | null = null;

export function setIo(server: SocketServer): void {
  io = server;
}

const requestRoom = (requestId: string): string => `request:${requestId}`;
const tripRoom = (tripId: string): string => `trip:${tripId}`;
/**
 * Every socket joins its own user room on connect. Without it a driver who has no
 * open trip has no room to be reached in, so the one event that matters most to
 * them — a farmer choosing them — would only arrive on a screen refresh.
 */
const userRoom = (userId: string): string => `user:${userId}`;

export function emitToUser(userId: string, event: string, payload: unknown): void {
  io?.to(userRoom(userId)).emit(event, payload);
}

// ---- pooling events (PROMPT_2 §13, §14). Sockets deliver; Mongo decides. ----

/** A transporter claimed a request — the farmer gains an option to compare. */
export function emitOfferReceived(payload: OfferReceivedEvent): void {
  io?.to(requestRoom(payload.requestId)).emit('offer:received', payload);
}

export function emitOfferWithdrawn(payload: OfferWithdrawnEvent): void {
  io?.to(requestRoom(payload.requestId)).emit('offer:withdrawn', payload);
}

export function emitTransporterSelected(payload: TransporterSelectedEvent): void {
  io?.to(requestRoom(payload.requestId)).emit('offer:selected', payload);
  io?.to(tripRoom(payload.tripId)).emit('offer:selected', payload);
  // reaches the driver even before they have a trip room to be in
  io?.to(userRoom(payload.transporterId)).emit('offer:selected', payload);
}

/**
 * Everyone's share moved because the pool changed. Sent to the trip room so each
 * farmer's screen updates without a refresh — and it carries the version, so a
 * client that reconnects can tell whether it is behind.
 */
export function emitPricingUpdated(payload: PricingUpdatedEvent): void {
  io?.to(tripRoom(payload.tripId)).emit('trip:pricing_updated', payload);
}

export function emitTripCapacity(payload: TripCapacityEvent): void {
  io?.to(tripRoom(payload.tripId)).emit('trip:capacity', payload);
}

export function emitShipmentState(payload: ShipmentStateEvent): void {
  io?.to(tripRoom(payload.tripId)).emit('shipment:state', payload);
  io?.to(requestRoom(payload.requestId)).emit('shipment:state', payload);
}

// ---- V2: Farm Resource Network ----
//
// A machine hire has exactly two parties and no shared room to put them in, so
// these go to the user rooms every socket already joins on connect. No new room
// type, no new access check to get wrong.

export function emitMachineBookingRequested(payload: MachineBookingRequestedEvent): void {
  io?.to(userRoom(payload.providerId)).emit('machine:booking_requested', payload);
}

/**
 * A booking moved. Both parties need it, and the caller knows who they are — the
 * booking row carries providerId and farmerId, so this takes them explicitly
 * rather than re-reading the database inside an emitter.
 */
export function emitMachineBookingState(
  payload: MachineBookingStateEvent,
  parties: string[] = [],
): void {
  for (const userId of parties) {
    io?.to(userRoom(userId)).emit('machine:booking_state', payload);
  }
}

// ---- V2: Backhaul Network ----

/** Return loads are waiting for this driver. Reaches them wherever they are. */
export function emitBackhaulOffered(payload: BackhaulOfferedEvent): void {
  io?.to(userRoom(payload.transporterId)).emit('backhaul:offered', payload);
}

export function emitBackhaulBooked(payload: BackhaulBookedEvent): void {
  io?.to(tripRoom(payload.tripId)).emit('backhaul:booked', payload);
  // the requester is not a party to the trip, so they are reached by user room
  io?.to(userRoom(payload.requesterId)).emit('backhaul:booked', payload);
}

export function emitBackhaulState(payload: BackhaulStateEvent, requesterId?: string): void {
  io?.to(tripRoom(payload.tripId)).emit('backhaul:state', payload);
  if (requesterId) io?.to(userRoom(requesterId)).emit('backhaul:state', payload);
}

export function emitReturnLegState(payload: ReturnLegStateEvent): void {
  io?.to(tripRoom(payload.tripId)).emit('trip:return_leg', payload);
}

// ---- server -> client emitters (docs/API_CONTRACTS.md §3) ----

export function emitTripStatus(payload: TripStatusEvent): void {
  io?.to(tripRoom(payload.tripId)).emit('trip:status', payload);
  io?.to(requestRoom(payload.tripId)).emit('trip:status', payload);
}

export function emitTripLocation(payload: TripLocationEvent): void {
  io?.to(tripRoom(payload.tripId)).emit('trip:location', payload);
}

export function emitPaymentCaptured(payload: PaymentCapturedEvent): void {
  io?.to(requestRoom(payload.requestId)).emit('payment:captured', payload);
  io?.to(tripRoom(payload.requestId)).emit('payment:captured', payload);
}

export function emitChatMessage(payload: ChatMessageEvent): void {
  io?.to(tripRoom(payload.tripId)).emit('chat:message', payload);
}

// ---- handshake + handlers ----

/**
 * Room ids are request/trip ids, so joining must prove the caller is a party to
 * that trip — otherwise an id becomes an enumeration vector (docs/ARCHITECTURE.md §5).
 */
async function assertTripParty(socket: AuthedSocket, tripId: string): Promise<void> {
  if (!(await isParticipant(tripId, socket.userId))) {
    throw new ApiError('AUTH_FORBIDDEN', "You don't have access to this trip.");
  }
}

/** A request room is the farmer's own — it is where their offers arrive. */
async function assertRequestOwner(socket: AuthedSocket, requestId: string): Promise<void> {
  const { TransportRequest } = await import('../../models');
  const request = await TransportRequest.findById(requestId);
  if (!request) throw new ApiError('RESOURCE_NOT_FOUND', 'That request no longer exists.');
  if (String(request.farmerId) !== socket.userId) {
    throw new ApiError('AUTH_FORBIDDEN', "That request isn't yours.");
  }
}

function handle(socket: AuthedSocket, fn: () => Promise<void>): void {
  void fn().catch((err: unknown) => {
    const apiErr =
      err instanceof ApiError
        ? err
        : new ApiError('EXTERNAL_SERVICE_ERROR', 'Something went wrong.');
    socket.emit('error', socketError(apiErr));
  });
}

export function registerSocketHandlers(server: SocketServer): void {
  setIo(server);

  // same JWT as REST (docs/API_CONTRACTS.md §3)
  server.use((socket, next) => {
    try {
      const token = (socket.handshake.auth?.token ?? '') as string;
      if (!token) throw new ApiError('AUTH_UNAUTHENTICATED', 'Please sign in to continue.');
      const payload = verifyAccessToken(token);
      const authed = socket as AuthedSocket;
      authed.userId = payload.sub;
      authed.role = payload.role;
      next();
    } catch (err) {
      next(err instanceof Error ? err : new Error('AUTH_UNAUTHENTICATED'));
    }
  });

  server.on('connection', (socket) => {
    const authed = socket as AuthedSocket;
    void socket.join(userRoom(authed.userId));

    socket.on('join:request', ({ requestId }: { requestId: string }) => {
      handle(authed, async () => {
        await assertRequestOwner(authed, requestId);
        await socket.join(requestRoom(requestId));
      });
    });

    socket.on('join:trip', ({ tripId }: { tripId: string }) => {
      handle(authed, async () => {
        await assertTripParty(authed, tripId);
        await socket.join(tripRoom(tripId));
      });
    });

    // transporter publishes GPS every ~5s during an active trip
    socket.on('vehicle:location', ({ tripId, lat, lng }: { tripId: string; lat: number; lng: number }) => {
      handle(authed, async () => {
        await assertTripParty(authed, tripId);
        const trip = await Trip.findById(tripId);
        if (!trip) return;

        const { Vehicle } = await import('../../models');
        await Vehicle.findByIdAndUpdate(trip.vehicleId, { currentLocation: { lat, lng } });

        // ETA to the next pickup if there is one, otherwise to the mandi
        const next = await TripShipment.findOne({
          tripId: trip._id,
          state: { $in: ['ASSIGNED', 'EN_ROUTE', 'ARRIVED'] },
        }).sort({ pickupSequence: 1 });

        const target = next
          ? { lat: next.pickup.lat as number, lng: next.pickup.lng as number }
          : { lat: trip.destination.lat as number, lng: trip.destination.lng as number };

        const etaMinutes = await estimateEtaMinutes({ lat, lng }, target);
        emitTripLocation({ tripId, lat, lng, etaMinutes });
      });
    });

    socket.on('chat:send', ({ tripId, text }: { tripId: string; text: string }) => {
      handle(authed, async () => {
        await assertTripParty(authed, tripId);
        const trimmed = (text ?? '').trim();
        if (!trimmed) throw new ApiError('VALIDATION_ERROR', 'text: message cannot be empty');

        const message = await saveChatMessage(tripId, authed.userId, trimmed);
        emitChatMessage({
          tripId,
          senderId: authed.userId,
          text: message.text,
          ts: message.createdAt.toISOString(),
        });
        await notifyChatMessage(tripId, authed.userId, trimmed);
      });
    });
  });
}
