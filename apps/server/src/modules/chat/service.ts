import { ChatMessage, Trip, TripShipment } from '../../models';
import { ApiError } from '../../lib/envelope';

/**
 * In-trip chat is per TRIP, not per request — everyone sharing the vehicle is in
 * one thread with the driver. That is the natural unit now that a trip carries
 * several farmers: "where are you?" has one answer for all of them.
 */

/** Driver plus every farmer with produce aboard. */
export async function participantsOf(tripId: string): Promise<{
  transporterId: string;
  farmerIds: string[];
}> {
  const trip = await Trip.findById(tripId);
  if (!trip) throw new ApiError('RESOURCE_NOT_FOUND', 'That trip no longer exists.');

  const shipments = await TripShipment.find({
    tripId: trip._id,
    state: { $ne: 'CANCELLED' },
  });

  return {
    transporterId: String(trip.transporterId),
    farmerIds: shipments.map((s) => String(s.farmerId)),
  };
}

export async function isParticipant(tripId: string, userId: string): Promise<boolean> {
  const { transporterId, farmerIds } = await participantsOf(tripId);
  return transporterId === userId || farmerIds.includes(userId);
}

export async function saveChatMessage(
  tripId: string,
  senderId: string,
  text: string,
): Promise<{ text: string; createdAt: Date }> {
  const message = await ChatMessage.create({ tripId, senderId, text });
  return { text: message.text, createdAt: message.get('createdAt') as Date };
}

/** History is persisted so a reconnect doesn't blank the thread. */
export async function listChatMessages(tripId: string, userId: string) {
  if (!(await isParticipant(tripId, userId))) {
    throw new ApiError('AUTH_FORBIDDEN', "You don't have access to this trip.");
  }
  return ChatMessage.find({ tripId }).sort({ createdAt: 1 }).limit(200);
}
