/**
 * The shared trip, seen by one farmer aboard it.
 *
 * Everything here is about the pool: who else is riding, how much of the vehicle
 * is used, and what this farmer's share has fallen to. The share moves while the
 * screen is open — a `trip:pricing_updated` is applied in place rather than
 * refetched, so the farmer literally watches the number drop when someone joins.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Linking, Pressable, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';
import type { Socket } from 'socket.io-client';
import type {
  PricingUpdatedEvent,
  ShipmentState,
  ShipmentStateEvent,
  TripCapacityEvent,
  TripState,
} from '@kisanpool/shared';
import { api, type TripShipmentView } from '../../../../lib/api';
import { AppError } from '../../../../lib/errors';
import { openCheckout } from '../../../../lib/razorpayCheckout';
import { connectTripSocket, useSocket } from '../../../../lib/socket';
import { getUser } from '../../../../lib/session';
import { kg, rupees } from '../../../../lib/format';
import { SUPPORT_PHONE } from '../../../../lib/support';
import {
  Banner,
  Button,
  Card,
  Divider,
  Header,
  Loading,
  RatingStars,
  Row,
  Screen,
  StatusBadge,
  Txt,
} from '../../../../components/ui';
import { ErrorView } from '../../../../components/ErrorView';
import { TripMap, decodePolyline } from '../../../../components/TripMap';
import { ChatSheet } from '../../../../components/ChatSheet';
import { colors, radius, space } from '../../../../theme';

type TripDetail = Awaited<ReturnType<typeof api.getTrip>>;

/** The farmer's own load, step by step. The trip has its own separate lifecycle. */
const STEPS: ShipmentState[] = [
  'ASSIGNED',
  'EN_ROUTE',
  'ARRIVED',
  'PICKED_UP',
  'IN_TRANSIT',
  'DELIVERED',
  'PAYMENT_PENDING',
  'PAID',
];

const STEP_LABEL: Record<ShipmentState, string> = {
  ASSIGNED: 'Confirmed — waiting for the driver',
  EN_ROUTE: 'Driver on the way to you',
  ARRIVED: 'Driver at your pickup point',
  PICKED_UP: 'Loaded — read out your code',
  IN_TRANSIT: 'On the way to the mandi',
  DELIVERED: 'Delivered at the mandi',
  PAYMENT_PENDING: 'Payment due',
  PAID: 'Paid',
  COMPLETED: 'Complete',
  CANCELLED: 'Cancelled',
};

const TRIP_LABEL: Record<TripState, string> = {
  FORMING: 'Filling up',
  EN_ROUTE: 'On the way',
  IN_TRANSIT: 'In transit',
  AT_DESTINATION: 'At the mandi',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
};

/** Before this the code is still needed; after it the driver already used it. */
const OTP_VISIBLE_STATES: ShipmentState[] = ['ASSIGNED', 'EN_ROUTE', 'ARRIVED'];

const CANCELLABLE_STATES: ShipmentState[] = ['ASSIGNED', 'EN_ROUTE', 'ARRIVED'];

export default function SharedTrip() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();

  const [detail, setDetail] = useState<TripDetail | null>(null);
  const [myId, setMyId] = useState('');
  const [live, setLive] = useState<{ lat: number; lng: number; etaMinutes?: number } | null>(null);
  const [polyline, setPolyline] = useState<Array<{ latitude: number; longitude: number }> | null>(
    null,
  );
  const [priceNote, setPriceNote] = useState<string | null>(null);
  const [paying, setPaying] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [unread, setUnread] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>();
  const socketRef = useRef<Socket | null>(null);

  const load = useCallback(async () => {
    setError(undefined);
    try {
      const user = await getUser();
      setMyId(user?._id ?? '');

      const trip = await api.getTrip(id);
      setDetail(trip);

      const mine = trip.shipments.find((s) => s.farmerId === user?._id);
      if (mine) {
        const route = await api.directions(
          { lat: mine.pickup.lat, lng: mine.pickup.lng },
          { lat: trip.trip.destination.lat, lng: trip.trip.destination.lng },
        );
        if (route.polyline) setPolyline(decodePolyline(route.polyline));
      }
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, [id]);

  /** Reconcile in the background — no spinner, no error surface, just newer truth. */
  const refresh = useCallback(async () => {
    try {
      setDetail(await api.getTrip(id));
    } catch {
      // the visible state is still valid; the next event or retry will correct it
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const mine: TripShipmentView | undefined = detail?.shipments.find((s) => s.farmerId === myId);
  const myShipmentId = mine?._id;

  useSocket(
    { type: 'trip', id },
    {
      // the whole point of pooling: the share is re-split and pushed, never re-fetched
      'trip:pricing_updated': (payload: PricingUpdatedEvent) => {
        const update = payload.updates.find((u) => u.shipmentId === myShipmentId);
        if (!update) return;

        setDetail((prev) =>
          prev
            ? {
                ...prev,
                shipments: prev.shipments.map((s) =>
                  s._id === update.shipmentId ? { ...s, allocatedPrice: update.amount } : s,
                ),
              }
            : prev,
        );
        setPriceNote(
          update.previousAmount != null && update.amount < update.previousAmount
            ? `Your cost dropped to ${rupees(update.amount)} because another farmer joined.`
            : `Your cost is now ${rupees(update.amount)}.`,
        );
      },

      'shipment:state': (payload: ShipmentStateEvent) => {
        setDetail((prev) =>
          prev
            ? {
                ...prev,
                shipments: prev.shipments.map((s) =>
                  s._id === payload.shipmentId ? { ...s, state: payload.state } : s,
                ),
              }
            : prev,
        );
      },

      'trip:capacity': (payload: TripCapacityEvent) => {
        setDetail((prev) =>
          prev ? { ...prev, trip: { ...prev.trip, capacity: payload.capacity } } : prev,
        );
        // capacity changed because someone joined or left — pull in who that is
        void refresh();
      },

      'trip:location': (payload: { lat: number; lng: number; etaMinutes?: number }) =>
        setLive(payload),
    },
  );

  // the price note is a nudge, not a state — it clears itself
  useEffect(() => {
    if (!priceNote) return;
    const timer = setTimeout(() => setPriceNote(null), 10000);
    return () => clearTimeout(timer);
  }, [priceNote]);

  /**
   * A second connection, only because <ChatSheet /> needs the Socket instance to
   * send on and useSocket does not hand one back.
   */
  useEffect(() => {
    let socket: Socket | null = null;
    void (async () => {
      socket = await connectTripSocket(id);
      socketRef.current = socket;
      socket?.on('chat:message', () =>
        setChatOpen((open) => {
          if (!open) setUnread((count) => count + 1);
          return open;
        }),
      );
    })();

    return () => {
      socket?.disconnect();
      socketRef.current = null;
    };
  }, [id]);

  const pay = async (): Promise<void> => {
    if (!mine) return;
    setPaying(true);
    setError(undefined);
    try {
      const order = await api.createOrder(mine._id);
      const user = await getUser();

      const result = await openCheckout({
        orderId: order.razorpayOrderId,
        amount: order.amount,
        keyId: order.keyId,
        demo: order.demo,
        prefill: { name: user?.name, contact: user?.phone },
        description: `${mine.cropType} to ${detail?.trip.destination.name ?? 'the mandi'}`,
      });

      await api.verifyPayment(result);
      // the webhook is what marks it PAID, so read the state back rather than assume
      await load();
    } catch (err) {
      setError(err);
    } finally {
      setPaying(false);
    }
  };

  if (loading) {
    return (
      <Screen>
        <Header title="Your trip" onBack={() => router.back()} />
        <Loading label="Loading your trip…" />
      </Screen>
    );
  }

  if (error && !detail) {
    return (
      <Screen>
        <Header title="Your trip" onBack={() => router.back()} />
        <ErrorView error={error} onRetry={() => void load()} />
      </Screen>
    );
  }

  if (!detail || !mine) {
    return (
      <Screen>
        <Header title="Your trip" onBack={() => router.back()} />
        <ErrorView
          error={new AppError('RESOURCE_NOT_FOUND', 'We could not find your load on this trip.')}
          onRetry={() => void load()}
        />
      </Screen>
    );
  }

  const { trip, vehicle, transporter, shipments } = detail;
  // everyone sharing this trip, delivered loads included — the roster is what the
  // farmer's price was split across, not just what is still in the vehicle
  const roster = shipments.filter((s) => s.state !== 'CANCELLED');
  const others = roster.filter((s) => s._id !== mine._id);
  const share = mine.finalPrice ?? mine.allocatedPrice;
  const saved = Math.max(mine.soloPrice - share, 0);
  const usedPct = trip.capacity.totalKg
    ? Math.min(trip.capacity.committedKg / trip.capacity.totalKg, 1)
    : 0;
  const stepIndex = mine.state === 'COMPLETED' ? STEPS.length : STEPS.indexOf(mine.state);

  return (
    <Screen
      refreshing={refreshing}
      onRefresh={() => {
        setRefreshing(true);
        void refresh().finally(() => setRefreshing(false));
      }}
      footer={
        mine.state === 'PAYMENT_PENDING' ? (
          <Button
            label={`Pay ${rupees(share)}`}
            icon="lock"
            loading={paying}
            onPress={() => void pay()}
          />
        ) : mine.state === 'PAID' || mine.state === 'COMPLETED' ? (
          <Button
            label="Rate the driver"
            icon="star"
            onPress={() => router.push(`/(farmer)/trips/${id}/rate?shipmentId=${mine._id}`)}
          />
        ) : CANCELLABLE_STATES.includes(mine.state) ? (
          <Button
            label="Cancel my load"
            variant="danger"
            icon="close"
            onPress={() =>
              void api
                .cancelRequest(mine.requestId, 'Cancelled by farmer')
                .then(() => load())
                .catch(setError)
            }
          />
        ) : null
      }
    >
      <Header
        title="Your trip"
        subtitle={`${mine.pickup.name} → ${trip.destination.name}`}
        onBack={() => router.back()}
        right={<StatusBadge status={trip.state} label={TRIP_LABEL[trip.state]} />}
      />

      {priceNote ? (
        <Banner tone="primary">
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
            <MaterialIcons name="trending-down" size={22} color={colors.onPrimary} />
            <Txt variant="labelLg" color={colors.onPrimary} style={{ flex: 1 }}>
              {priceNote}
            </Txt>
          </View>
        </Banner>
      ) : null}

      {error ? <ErrorView error={error} onRetry={() => void load()} /> : null}

      <TripMap
        pickup={{ lat: mine.pickup.lat, lng: mine.pickup.lng, title: 'Your pickup' }}
        destination={{
          lat: trip.destination.lat,
          lng: trip.destination.lng,
          title: trip.destination.name,
        }}
        vehicle={live ? { ...live, title: vehicle?.registrationNumber ?? 'Vehicle' } : null}
        markers={others.map((s) => ({
          lat: s.pickup.lat,
          lng: s.pickup.lng,
          title: `${s.farmer?.name ?? 'Another farmer'} · ${kg(s.quantityKg)}`,
        }))}
        polyline={polyline}
        height={260}
      />

      {live?.etaMinutes != null ? (
        <Card style={{ marginTop: space.md }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
            <MaterialIcons name="schedule" size={22} color={colors.primary} />
            <View>
              <Txt variant="headlineMd">{live.etaMinutes} min</Txt>
              <Txt variant="labelSm" color={colors.onSurfaceVariant}>
                Estimated time to the mandi
              </Txt>
            </View>
          </View>
        </Card>
      ) : null}

      {/* the code the farmer reads out — nobody else on the trip can see it */}
      {mine.pickupOtp && OTP_VISIBLE_STATES.includes(mine.state) ? (
        <View style={s.otpCard}>
          <Txt variant="labelLg" color={colors.onPrimaryContainer}>
            Your pickup code
          </Txt>
          <Txt variant="displayLg" color={colors.onPrimary} style={{ letterSpacing: 8 }}>
            {mine.pickupOtp}
          </Txt>
          <Txt variant="bodyMd" color={colors.onPrimaryContainer}>
            Read this out to the driver when he arrives. He cannot load your produce without it.
          </Txt>
        </View>
      ) : null}

      {/* what the pool has done to the bill */}
      <Card>
        <Txt variant="labelLg" color={colors.onSurfaceVariant}>
          Your share of this trip
        </Txt>
        <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: space.sm }}>
          <Txt variant="displayLg" color={colors.primary}>
            {rupees(share)}
          </Txt>
          <Txt
            variant="bodyLg"
            color={colors.onSurfaceVariant}
            style={{ textDecorationLine: 'line-through' }}
          >
            {rupees(mine.soloPrice)}
          </Txt>
        </View>
        <Txt variant="labelLg" color={colors.primary}>
          Pooling saves you {rupees(saved)}
          {mine.savingPct != null ? ` (${mine.savingPct}%)` : ''}
        </Txt>
        {mine.finalPrice == null ? (
          <Txt variant="labelSm" color={colors.onSurfaceVariant} style={{ marginTop: space.xs }}>
            This can still fall — it is re-split every time a farmer joins, and freezes when your
            produce is delivered.
          </Txt>
        ) : (
          <Txt variant="labelSm" color={colors.onSurfaceVariant} style={{ marginTop: space.xs }}>
            Final — frozen at delivery.
          </Txt>
        )}
      </Card>

      {/* the pool itself */}
      <Card>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
          <MaterialIcons name="groups" size={22} color={colors.primary} />
          <Txt variant="headlineMd" style={{ flex: 1 }}>
            {roster.length} farmer{roster.length === 1 ? '' : 's'} sharing this trip
          </Txt>
        </View>

        <View style={s.capacityTrack}>
          <View style={[s.capacityFill, { width: `${Math.round(usedPct * 100)}%` }]} />
        </View>
        <Txt variant="labelSm" color={colors.onSurfaceVariant}>
          {kg(trip.capacity.committedKg)} of {kg(trip.capacity.totalKg)} used ·{' '}
          {kg(trip.capacity.availableKg)} still free
        </Txt>

        <Divider />

        {roster.map((shipment) => (
          <View key={shipment._id} style={s.poolRow}>
            <MaterialIcons
              name={shipment._id === mine._id ? 'person' : 'person-outline'}
              size={18}
              color={shipment._id === mine._id ? colors.primary : colors.onSurfaceVariant}
            />
            <Txt variant="bodyMd" style={{ flex: 1 }}>
              {shipment._id === mine._id ? 'You' : (shipment.farmer?.name ?? 'Another farmer')}
            </Txt>
            <Txt variant="labelSm" color={colors.onSurfaceVariant}>
              {shipment.cropType} · {kg(shipment.quantityKg)}
            </Txt>
          </View>
        ))}

        {trip.state === 'FORMING' ? (
          <Txt variant="labelSm" color={colors.onSurfaceVariant} style={{ marginTop: space.xs }}>
            The driver is still taking loads, so more farmers may join and your share may fall
            again.
          </Txt>
        ) : null}
      </Card>

      {/* this farmer's own load, which advances independently of the trip */}
      <Card>
        <Txt variant="labelLg" color={colors.onSurfaceVariant} style={{ marginBottom: space.sm }}>
          Your produce
        </Txt>
        {mine.state === 'CANCELLED' ? (
          <Txt variant="bodyLg" color={colors.error}>
            This load was cancelled.
          </Txt>
        ) : (
          STEPS.map((step, index) => {
            const done = stepIndex >= index;
            const active = stepIndex === index;
            return (
              <View key={step} style={s.stepRow}>
                <View
                  style={[
                    s.stepDot,
                    {
                      backgroundColor: done ? colors.primary : colors.surfaceContainer,
                      borderWidth: active ? 3 : 0,
                    },
                  ]}
                >
                  <MaterialIcons
                    name={done ? 'check' : 'radio-button-unchecked'}
                    size={16}
                    color={done ? colors.onPrimary : colors.outline}
                  />
                </View>
                <Txt variant="labelLg" color={done ? colors.onSurface : colors.onSurfaceVariant}>
                  {STEP_LABEL[step]}
                </Txt>
              </View>
            );
          })
        )}
      </Card>

      {/* the driver */}
      <Card>
        <View style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
          <View style={{ flex: 1 }}>
            <Txt variant="headlineMd">{transporter?.name ?? 'Your driver'}</Txt>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
              <RatingStars value={transporter?.ratingAvg ?? 0} />
              <Txt variant="labelSm" color={colors.onSurfaceVariant}>
                {(transporter?.ratingAvg ?? 0).toFixed(1)}
              </Txt>
            </View>
            <Txt variant="labelSm" color={colors.onSurfaceVariant} style={{ marginTop: space.xs }}>
              {vehicle?.registrationNumber ?? '—'} · {vehicle?.vehicleType ?? '—'}
            </Txt>
          </View>
        </View>

        <Divider />

        <View style={{ flexDirection: 'row', gap: space.sm }}>
          <Pressable
            style={[s.action, { flex: 1 }]}
            onPress={() => {
              setChatOpen(true);
              setUnread(0);
            }}
          >
            <MaterialIcons name="chat" size={20} color={colors.primary} />
            <Txt variant="labelLg" color={colors.primary}>
              Chat{unread > 0 ? ` (${unread})` : ''}
            </Txt>
          </Pressable>

          <Pressable
            style={[s.action, { flex: 1, opacity: transporter?.phone ? 1 : 0.5 }]}
            disabled={!transporter?.phone}
            onPress={() => void Linking.openURL(`tel:${transporter?.phone ?? ''}`)}
          >
            <MaterialIcons name="call" size={20} color={colors.primary} />
            <Txt variant="labelLg" color={colors.primary}>
              {transporter?.phone ? 'Call driver' : 'No number'}
            </Txt>
          </Pressable>
        </View>
      </Card>

      <Card>
        <Row label="Crop" value={`${mine.cropType} · ${kg(mine.quantityKg)}`} />
        <Row label="Pickup order" value={`#${mine.pickupSequence + 1} of ${roster.length}`} />
        <Row label="Route" value={`${trip.routeDistanceKm.toFixed(1)} km`} />
      </Card>

      {/* help — a phone number before a chatbot, always */}
      <Card>
        <Txt variant="labelLg" color={colors.onSurfaceVariant} style={{ marginBottom: space.sm }}>
          Need help?
        </Txt>
        <View style={{ flexDirection: 'row', gap: space.sm }}>
          <Pressable
            style={[s.action, { flex: 1 }]}
            onPress={() => void Linking.openURL(`tel:${SUPPORT_PHONE.replace(/-/g, '')}`)}
          >
            <MaterialIcons name="headset-mic" size={20} color={colors.primary} />
            <Txt variant="labelLg" color={colors.primary}>
              Support
            </Txt>
          </Pressable>
          <Pressable
            style={[s.action, { flex: 1 }]}
            onPress={() => router.push('/(farmer)/support')}
          >
            <MaterialIcons name="report-problem" size={20} color={colors.primary} />
            <Txt variant="labelLg" color={colors.primary}>
              Report issue
            </Txt>
          </Pressable>
        </View>

        <View style={s.aiRow}>
          <View style={s.aiIcon}>
            <MaterialIcons name="smart-toy" size={20} color={colors.onPrimary} />
          </View>
          <View style={{ flex: 1 }}>
            <Txt variant="labelLg">Servo AI</Txt>
            <Txt variant="labelSm" color={colors.onSurfaceVariant}>
              Ask anything about this trip, in your own language
            </Txt>
          </View>
          <MaterialIcons name="mic" size={22} color={colors.primary} />
        </View>

        <View
          style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs, marginTop: space.gutter }}
        >
          <MaterialIcons name="lock" size={14} color={colors.outline} />
          <Txt variant="labelSm" color={colors.outline} style={{ flex: 1 }}>
            Every trip is monitored. Your pickup code is never shared with other farmers aboard.
          </Txt>
        </View>
      </Card>

      <ChatSheet
        visible={chatOpen}
        onClose={() => setChatOpen(false)}
        tripId={id}
        myUserId={myId}
        socket={socketRef.current}
        otherPartyName={transporter?.name ?? 'Driver'}
      />
    </Screen>
  );
}

const s = {
  otpCard: {
    backgroundColor: colors.primaryContainer,
    borderRadius: radius.xl,
    padding: space.md,
    marginBottom: space.gutter,
    gap: space.xs,
  },
  capacityTrack: {
    height: 10,
    borderRadius: radius.full,
    backgroundColor: colors.surfaceContainerHigh,
    overflow: 'hidden' as const,
    marginTop: space.gutter,
    marginBottom: space.xs,
  },
  capacityFill: { height: 10, borderRadius: radius.full, backgroundColor: colors.primary },
  poolRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: space.sm,
    paddingVertical: space.xs,
  },
  stepRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: space.gutter,
    paddingVertical: space.sm,
  },
  stepDot: {
    width: 28,
    height: 28,
    borderRadius: radius.full,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    borderColor: colors.secondaryContainer,
  },
  aiRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: space.gutter,
    marginTop: space.gutter,
    backgroundColor: colors.surfaceContainerLow,
    borderRadius: radius.md,
    padding: space.gutter,
  },
  aiIcon: {
    width: 36,
    height: 36,
    borderRadius: radius.full,
    backgroundColor: colors.primary,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  action: {
    minHeight: 48,
    borderRadius: radius.base,
    borderWidth: 1,
    borderColor: colors.primary,
    backgroundColor: colors.surfaceContainerLowest,
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    gap: space.sm,
  },
};
