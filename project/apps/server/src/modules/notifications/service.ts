import { Expo, type ExpoPushMessage } from 'expo-server-sdk';
import { User } from '../../models';
import { participantsOf } from '../chat/service';

const expo = new Expo();

/**
 * Sockets only reach a foregrounded app; a farmer waiting on a match will background
 * it. Pushes cover the other half (ADR-005). A failed push never fails the request
 * that triggered it.
 */
async function push(userIds: string[], title: string, body: string, data: Record<string, unknown> = {}): Promise<void> {
  try {
    const users = await User.find({ _id: { $in: userIds }, pushToken: { $ne: null } });
    const messages: ExpoPushMessage[] = users
      .filter((u) => u.pushToken && Expo.isExpoPushToken(u.pushToken))
      .map((u) => ({
        to: u.pushToken as string,
        sound: 'default',
        title,
        body,
        data,
      }));

    if (!messages.length) return;
    for (const chunk of expo.chunkPushNotifications(messages)) {
      await expo.sendPushNotificationsAsync(chunk);
    }
  } catch (err) {
    console.warn('[notifications] push failed (non-fatal)', err);
  }
}

export async function notifyMatchFound(farmerId: string, requestId: string): Promise<void> {
  await push([farmerId], 'Transporters interested', 'Tap to compare who can carry your produce.', {
    route: `/(farmer)/requests/${requestId}/offers`,
  });
}

export async function notifyPaymentCaptured(userIds: string[], tripId: string): Promise<void> {
  await push(userIds, 'Payment received', 'Thanks — your load is settled.', {
    // a TRIP id: the farmer's trip screen is keyed by the shared journey now
    route: `/(farmer)/trips/${tripId}`,
  });
}

export async function notifyTripStatus(userIds: string[], tripId: string, status: string): Promise<void> {
  const label: Record<string, string> = {
    BOOKED: 'Your trip is booked.',
    IN_TRANSIT: 'Your produce is on the way.',
    DELIVERED: 'Your produce has been delivered.',
    CANCELLED: 'The trip was cancelled.',
  };
  await push(userIds, 'Trip update', label[status] ?? `Trip status: ${status}`, {
    route: `/trips/${tripId}`,
  });
}

export async function notifyChatMessage(tripId: string, senderId: string, text: string): Promise<void> {
  const { transporterId, farmerIds } = await participantsOf(tripId);
  // everyone sharing the vehicle except whoever typed it
  const recipients = [transporterId, ...farmerIds].filter((id) => id && id !== senderId);
  await push(recipients, 'New message', text.slice(0, 120), { route: `/trips/${tripId}` });
}

/** A transporter claimed a request — the farmer now has an option to compare. */
export async function notifyOfferReceived(farmerId: string, requestId: string, who: string): Promise<void> {
  await push([farmerId], 'A transporter is interested', `${who} can carry your produce. Tap to compare.`, {
    route: `/(farmer)/requests/${requestId}/offers`,
  });
}

/** The farmer chose this driver. */
export async function notifyOfferSelected(transporterId: string, tripId: string): Promise<void> {
  await push([transporterId], 'You were selected', 'A farmer chose you for their load.', {
    route: `/(transporter)/trips/${tripId}`,
  });
}

/** Someone joined the pool and everyone's share moved. */
export async function notifyPriceChanged(
  farmerIds: string[],
  tripId: string,
  direction: 'down' | 'up',
): Promise<void> {
  await push(
    farmerIds,
    direction === 'down' ? 'Your cost went down' : 'Your cost changed',
    direction === 'down'
      ? 'Another farmer joined your trip, so the cost is shared further.'
      : 'The shared cost on your trip has been updated.',
    { route: `/(farmer)/trips/${tripId}` },
  );
}

export async function notifyPayoutSent(transporterId: string, amount: number): Promise<void> {
  await push([transporterId], 'Payout sent', `₹${amount} is on its way to your bank account.`, {
    route: '/(transporter)/payouts',
  });
}

// ---------------------------------------------------------------------------
// V2 — Farm Resource Network
// ---------------------------------------------------------------------------

/**
 * Something happened to a machine hire. One helper for both directions: the
 * provider hears about a request, the farmer hears about the answer, and the
 * caller decides which of the two is the recipient.
 */
export async function notifyMachineBooking(
  userId: string,
  bookingId: string,
  headline: string,
): Promise<void> {
  await push([userId], headline, 'Open Farm Services to see the details.', {
    route: `/(farmer)/services/bookings?id=${bookingId}`,
  });
}

// ---------------------------------------------------------------------------
// V2 — Backhaul Network
// ---------------------------------------------------------------------------

/** Return loads are waiting for a driver who has just finished delivering. */
export async function notifyBackhaulAvailable(
  transporterId: string,
  tripId: string,
  count: number,
): Promise<void> {
  await push(
    [transporterId],
    `${count} return load${count === 1 ? '' : 's'} on your way home`,
    'You are driving back anyway — one of these could pay for the return.',
    { route: `/(transporter)/trips/${tripId}/return` },
  );
}

/** The requester's goods have been taken by a driver heading their way. */
export async function notifyBackhaulBooked(
  requesterId: string,
  bookingId: string,
  who: string,
): Promise<void> {
  await push([requesterId], 'Your return load is booked', `${who} will carry it.`, {
    route: `/(farmer)/backhaul/${bookingId}`,
  });
}
