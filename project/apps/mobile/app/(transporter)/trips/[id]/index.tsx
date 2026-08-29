/**
 * shared_trip — one vehicle, many farmers, one mandi.
 *
 * The trip and each farmer's shipment advance on separate state machines: the
 * driver may have collected two loads and still be en route to a third, so a
 * single status field could never describe this screen (packages/shared pooling.ts).
 * It also publishes vehicle:location every ~5s, which is what moves every farmer's map.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Linking, Modal, Pressable, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import type { Socket } from 'socket.io-client';
import {
  canTransitionShipment,
  canTransitionTrip,
  type ShipmentState,
  type TripState,
} from '@kisanpool/shared';
import { api, type TripPredictionDTO, type TripPredictionEvent } from '../../../../lib/api';
import { connectTripSocket } from '../../../../lib/socket';
import { InsightCard } from '../../../../components/InsightCard';
import { ServiceBanner, useServiceStatus } from '../../../../components/ServiceBanner';
import { getUser } from '../../../../lib/session';
import { toAppError } from '../../../../lib/errors';
import { kg, rupees } from '../../../../lib/format';
import { ledgerFrom, ledgerSegments, usedPct } from '../../../../lib/pooling';
import { SUPPORT_PHONE } from '../../../../lib/support';
import {
  Banner,
  Button,
  Card,
  Divider,
  EmptyState,
  Field,
  Header,
  Loading,
  ProgressTrack,
  Row,
  Screen,
  StatusBadge,
  Txt,
} from '../../../../components/ui';
import { ErrorView } from '../../../../components/ErrorView';
import { TripMap } from '../../../../components/TripMap';
import { ChatSheet } from '../../../../components/ChatSheet';
import { colors, radius, space } from '../../../../theme';

const GPS_INTERVAL_MS = 5000;

type TripDetail = Awaited<ReturnType<typeof api.getTrip>>;
type Shipment = TripDetail['shipments'][number];

const SHIPMENT_LABEL: Record<ShipmentState, string> = {
  ASSIGNED: 'To collect',
  EN_ROUTE: 'On the way',
  ARRIVED: 'At pickup',
  PICKED_UP: 'Loaded',
  IN_TRANSIT: 'In transit',
  DELIVERED: 'Delivered',
  PAYMENT_PENDING: 'Awaiting payment',
  PAID: 'Paid',
  COMPLETED: 'Done',
  CANCELLED: 'Cancelled',
};

const TRIP_LABEL: Record<TripState, string> = {
  FORMING: 'Taking loads',
  EN_ROUTE: 'Collecting',
  IN_TRANSIT: 'To the mandi',
  AT_DESTINATION: 'At the mandi',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
};

/** The one step forward from each shipment state — the rest of the machine is the server's. */
const SHIPMENT_NEXT: Partial<Record<ShipmentState, { to: ShipmentState; label: string }>> = {
  ASSIGNED: { to: 'EN_ROUTE', label: 'Heading to this pickup' },
  EN_ROUTE: { to: 'ARRIVED', label: 'I have arrived' },
  ARRIVED: { to: 'PICKED_UP', label: 'Collect with the farmer’s code' },
  PICKED_UP: { to: 'IN_TRANSIT', label: 'Loaded — moving on' },
  IN_TRANSIT: { to: 'DELIVERED', label: 'Delivered at the mandi' },
};

const TRIP_NEXT: Partial<Record<TripState, { to: TripState; label: string }>> = {
  FORMING: { to: 'EN_ROUTE', label: 'Start the trip — no more loads' },
  EN_ROUTE: { to: 'IN_TRANSIT', label: 'All collected — drive to the mandi' },
  IN_TRANSIT: { to: 'AT_DESTINATION', label: 'Arrived at the mandi' },
};

export default function SharedTrip() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();

  const [detail, setDetail] = useState<TripDetail | null>(null);
  const [prediction, setPrediction] = useState<TripPredictionDTO | null>(null);
  const serviceStatus = useServiceStatus();
  const [position, setPosition] = useState<{ lat: number; lng: number } | null>(null);
  const [chatOpen, setChatOpen] = useState(false);
  const [unread, setUnread] = useState(0);
  const [myId, setMyId] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<unknown>();
  /** an action failure belongs on the row that failed, not over the whole trip */
  const [actionError, setActionError] = useState<{ key: string; message: string } | null>(null);
  const [otpFor, setOtpFor] = useState<Shipment | null>(null);
  const [otp, setOtp] = useState('');
  const [otpError, setOtpError] = useState<string>();
  const [freedSpace, setFreedSpace] = useState(false);
  const [pricingMoved, setPricingMoved] = useState(false);
  const socketRef = useRef<Socket | null>(null);

  const load = useCallback(async () => {
    setError(undefined);
    try {
      setDetail(await api.getTrip(id));
      setMyId((await getUser())?._id ?? '');
      // advisory delay + cancellation risk — best-effort, never blocks the trip
      api.tripPrediction(id).then(setPrediction).catch(() => setPrediction(null));
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    let socket: Socket | null = null;
    let interval: ReturnType<typeof setInterval> | null = null;

    void (async () => {
      socket = await connectTripSocket(id);
      socketRef.current = socket;
      if (!socket) return;

      socket.on('shipment:state', () => void load());
      socket.on('trip:capacity', () => void load());
      socket.on('trip:prediction', (payload: TripPredictionEvent) =>
        setPrediction((prev) =>
          prev ? { ...prev, delay: payload.delay } : { tripId: id, tripState: '', delay: payload.delay },
        ),
      );
      socket.on('trip:pricing_updated', () => {
        setPricingMoved(true);
        void load();
      });
      socket.on('chat:message', () =>
        setChatOpen((open) => {
          if (!open) setUnread((count) => count + 1);
          return open;
        }),
      );

      const permission = await Location.requestForegroundPermissionsAsync();
      if (permission.status !== 'granted') return;

      // publish GPS every ~5s so every farmer aboard sees the vehicle move
      interval = setInterval(() => {
        void (async () => {
          const current = await Location.getCurrentPositionAsync({
            accuracy: Location.Accuracy.Balanced,
          });
          const point = { lat: current.coords.latitude, lng: current.coords.longitude };
          setPosition(point);
          socket?.emit('vehicle:location', { tripId: id, ...point });
        })();
      }, GPS_INTERVAL_MS);
    })();

    return () => {
      if (interval) clearInterval(interval);
      socket?.disconnect();
      socketRef.current = null;
    };
  }, [id, load]);

  const advanceShipment = async (
    shipment: Shipment,
    to: ShipmentState,
    code?: string,
  ): Promise<void> => {
    setBusy(shipment._id);
    setActionError(null);
    setOtpError(undefined);
    try {
      await api.setShipmentState(shipment._id, to, code);
      if (to === 'DELIVERED') setFreedSpace(true);
      setOtpFor(null);
      setOtp('');
      await load();
    } catch (err) {
      const message = toAppError(err).message;
      // a wrong pickup code keeps the sheet open with the reason on the input
      if (to === 'PICKED_UP' && toAppError(err).code === 'VALIDATION_ERROR') {
        setOtpError('That code is not correct. Ask the farmer to read it again.');
      } else {
        setOtpFor(null);
        setActionError({ key: shipment._id, message });
      }
    } finally {
      setBusy(null);
    }
  };

  const advanceTrip = async (to: TripState): Promise<void> => {
    setBusy('trip');
    setActionError(null);
    try {
      await api.setTripState(id, to);
      await load();
    } catch (err) {
      setActionError({ key: 'trip', message: toAppError(err).message });
    } finally {
      setBusy(null);
    }
  };

  if (loading) {
    return (
      <Screen>
        <Header title="Trip" onBack={() => router.back()} />
        <Loading />
      </Screen>
    );
  }

  if (!detail) {
    return (
      <Screen>
        <Header title="Trip" onBack={() => router.back()} />
        <ErrorView error={error} onRetry={() => void load()} />
      </Screen>
    );
  }

  const { trip, shipments } = detail;
  const capacity = trip.capacity;
  const tripNext = TRIP_NEXT[trip.state];
  const canAddMore = ['FORMING', 'EN_ROUTE'].includes(trip.state) && capacity.availableKg > 0;

  // the pickup run, in the order the driver drives it
  const route = shipments
    .filter((shipment) => shipment.state !== 'CANCELLED')
    .sort((a, b) => a.pickupSequence - b.pickupSequence);
  const collected = route.filter((shipment) =>
    ['PICKED_UP', 'IN_TRANSIT', 'DELIVERED', 'PAYMENT_PENDING', 'PAID', 'COMPLETED'].includes(
      shipment.state,
    ),
  );
  const nextPickup = route.find(
    (shipment) => !['PICKED_UP', 'IN_TRANSIT', 'DELIVERED', 'PAYMENT_PENDING', 'PAID', 'COMPLETED'].includes(shipment.state),
  );
  const ledger = ledgerFrom(capacity);
  const overloaded = capacity.loadedKg > capacity.totalKg;
  /** the return journey's gate, mirrored from the server so the CTA never lies */
  const allDelivered =
    route.length > 0 &&
    route.every((shipment) =>
      ['DELIVERED', 'PAYMENT_PENDING', 'PAID', 'COMPLETED'].includes(shipment.state),
    );

  return (
    <Screen
      footer={
        tripNext && canTransitionTrip(trip.state, tripNext.to) ? (
          <Button
            label={tripNext.label}
            loading={busy === 'trip'}
            onPress={() => void advanceTrip(tripNext.to)}
          />
        ) : trip.state === 'AT_DESTINATION' ? (
          <Button
            label="Finish and bill"
            icon="check-circle"
            onPress={() => router.push(`/(transporter)/trips/${id}/complete`)}
          />
        ) : trip.state === 'COMPLETED' ? (
          <Button
            label="Rate the farmers"
            icon="star"
            onPress={() => router.push(`/(transporter)/trips/${id}/rate`)}
          />
        ) : null
      }
    >
      <Header
        title="Your trip"
        subtitle={`${shipments.length} ${shipments.length === 1 ? 'farmer' : 'farmers'} → ${trip.destination.name}`}
        onBack={() => router.back()}
        right={<StatusBadge status={trip.state} label={TRIP_LABEL[trip.state]} />}
      />

      {/* what the driver is doing right now, and what is next */}
      <Card style={{ marginTop: space.md }}>
        <View style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
          <View style={{ flex: 1 }}>
            <Txt variant="headlineMd" color={colors.primary}>
              {nextPickup
                ? `On the way to ${nextPickup.farmer?.name ?? 'the next pickup'}`
                : trip.state === 'AT_DESTINATION'
                  ? 'At the mandi'
                  : 'All loads collected'}
            </Txt>
            <Txt variant="labelSm" color={colors.onSurfaceVariant}>
              {collected.length} of {route.length} pickup{route.length === 1 ? '' : 's'} completed
            </Txt>
          </View>
          {nextPickup ? (
            <View style={{ alignItems: 'flex-end' }}>
              <Txt variant="labelSm" color={colors.onSurfaceVariant}>
                Next stop
              </Txt>
              <Txt variant="headlineMd">#{nextPickup.pickupSequence + 1}</Txt>
            </View>
          ) : null}
        </View>

        <View style={{ marginTop: space.gutter }}>
          <ProgressTrack
            pct={route.length ? (collected.length / route.length) * 100 : 0}
            height={8}
          />
        </View>

        <Divider />
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
          <MaterialIcons name="place" size={16} color={colors.tertiary} />
          <Txt variant="bodyMd" style={{ flex: 1 }} numberOfLines={1}>
            {trip.destination.name}
          </Txt>
          <Txt variant="labelSm" color={colors.onSurfaceVariant}>
            {trip.routeDistanceKm.toFixed(0)} km
          </Txt>
        </View>
      </Card>

      <TripMap
        destination={{ ...trip.destination, title: trip.destination.name }}
        vehicle={position ? { ...position, title: 'You' } : null}
        markers={shipments
          .filter((shipment) => shipment.state !== 'CANCELLED')
          .map((shipment) => ({
            lat: shipment.pickup.lat,
            lng: shipment.pickup.lng,
            title: `${shipment.pickupSequence + 1}. ${shipment.farmer?.name ?? 'Farmer'}`,
          }))}
        height={240}
      />

      {error ? <ErrorView error={error} onRetry={() => void load()} /> : null}

      {/* honest status during an incident — silent when everything is normal */}
      <ServiceBanner status={serviceStatus} />

      {/* advisory risk — each renders only for MEDIUM/HIGH (ADR-041) */}
      <InsightCard assessment={prediction?.delay} title="Possible delivery delay" />
      <InsightCard assessment={prediction?.cancellation} title="Cancellation risk" minLevel="HIGH" />

      {actionError?.key === 'trip' ? (
        <Banner tone="error" style={{ marginTop: space.md }}>
          <Txt variant="labelLg" color={colors.onErrorContainer}>
            Cannot do that yet
          </Txt>
          <Txt variant="bodyMd" color={colors.onErrorContainer}>
            {actionError.message}
          </Txt>
        </Banner>
      ) : null}

      <Card>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <Txt variant="labelLg">Load / capacity</Txt>
          <Txt variant="labelSm" color={colors.onSurfaceVariant}>
            {kg(capacity.committedKg)} / {kg(capacity.totalKg)}
          </Txt>
        </View>

        <View style={{ marginTop: space.gutter }}>
          <ProgressTrack
            height={12}
            segments={ledgerSegments(ledger, {
              loaded: colors.primary,
              confirmed: colors.primaryContainer,
            })}
          />
        </View>
        <View
          style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: space.sm }}
        >
          <Txt variant="labelSm" color={colors.onSurfaceVariant}>
            {usedPct(ledger)}% reserved
          </Txt>
          <Txt variant="labelSm" color={colors.onSurfaceVariant}>
            {kg(capacity.availableKg)} available
          </Txt>
        </View>

        <Divider />
        <Row label="Vehicle capacity" value={kg(capacity.totalKg)} />
        <Row label="Confirmed by farmers" value={kg(capacity.committedKg)} />
        <Row label="In the vehicle now" value={kg(capacity.loadedKg)} />
        <Row label="Still free" value={kg(capacity.availableKg)} bold />

        {overloaded ? (
          <Banner tone="error" style={{ marginTop: space.gutter, marginBottom: 0 }}>
            <View style={{ flexDirection: 'row', gap: space.sm, alignItems: 'center' }}>
              <MaterialIcons name="warning" size={20} color={colors.onErrorContainer} />
              <Txt variant="labelLg" color={colors.onErrorContainer} style={{ flex: 1 }}>
                Loaded weight is over your rated capacity — do not take more.
              </Txt>
            </View>
          </Banner>
        ) : (
          <View style={{ flexDirection: 'row', gap: space.sm, alignItems: 'center', marginTop: space.sm }}>
            <MaterialIcons name="verified-user" size={15} color={colors.outline} />
            <Txt variant="labelSm" color={colors.outline} style={{ flex: 1 }}>
              Stay within {kg(capacity.totalKg)} for a safe, legal trip.
            </Txt>
          </View>
        )}
      </Card>

      {/* the trip's money — the SAME numbers every farmer aboard is splitting */}
      {detail.pricing ? (
        <Card>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <Txt variant="labelLg">Trip economics</Txt>
            <Txt variant="labelSm" color={colors.onSurfaceVariant}>
              v{detail.pricing.version}
            </Txt>
          </View>

          <View style={{ marginTop: space.gutter }}>
            <Txt variant="labelSm" color={colors.onSurfaceVariant}>
              You expect to earn
            </Txt>
            <Txt variant="displayLg" color={colors.primary}>
              {rupees(detail.pricing.transporterEarning)}
            </Txt>
          </View>

          <Divider />
          <Row
            label="Route driven"
            value={`${detail.pricing.effectiveRouteKm.toFixed(0)} km`}
          />
          <Row label="Your rate" value={`${rupees(detail.pricing.ratePerKm)} / km`} />
          <Row label="Total trip value" value={rupees(detail.pricing.totalCost)} />
          <Row label="Platform fee" value={`− ${rupees(detail.pricing.platformFee)}`} />
          <Divider />
          <Row label="Pooled load" value={kg(detail.pricing.totalQuantityKg)} />
          <Row label="Remaining capacity" value={kg(capacity.availableKg)} bold />

          <Txt variant="labelSm" color={colors.outline} style={{ marginTop: space.sm }}>
            Every farmer aboard pays a slice of the {rupees(detail.pricing.totalCost)} above —
            their own detour, plus a share of the shared run by tonne-kilometres. Take another
            load and this grows.
          </Txt>
        </Card>
      ) : null}

      {/*
        The return journey.

        Offered only once every farmer's load is delivered, which is the same gate
        the server enforces — a driver should never be invited to think about the
        way home while produce is still aboard.
      */}
      {allDelivered ? (
        <Card
          style={{ borderColor: colors.primary, borderWidth: 2 }}
          onPress={() => router.push(`/(transporter)/trips/${id}/return`)}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
            <MaterialIcons name="u-turn-left" size={26} color={colors.primary} />
            <View style={{ flex: 1 }}>
              <Txt variant="headlineMd" color={colors.primary}>
                Don't drive back empty
              </Txt>
              <Txt variant="labelSm" color={colors.onSurfaceVariant}>
                Every load is delivered. There may be goods going your way — carrying one turns
                the run home into earning.
              </Txt>
            </View>
            <MaterialIcons name="chevron-right" size={22} color={colors.outline} />
          </View>
          <Button
            label="See return loads"
            icon="u-turn-left"
            onPress={() => router.push(`/(transporter)/trips/${id}/return`)}
            style={{ marginTop: space.gutter }}
          />
        </Card>
      ) : null}

      {/* a delivery hands the space back — the pool is where it gets used again */}
      {canAddMore ? (
        <Banner tone={freedSpace ? 'primary' : 'info'}>
          <View style={{ flexDirection: 'row', gap: space.sm }}>
            <MaterialIcons
              name="local-shipping"
              size={20}
              color={freedSpace ? colors.onPrimary : colors.onInfoContainer}
            />
            <View style={{ flex: 1 }}>
              <Txt variant="labelLg" color={freedSpace ? colors.onPrimary : colors.onInfoContainer}>
                {freedSpace ? 'Space just freed up' : `${kg(capacity.availableKg)} still fits`}
              </Txt>
              <Button
                label="Open the load pool"
                variant="secondary"
                icon="add"
                onPress={() => router.push('/(transporter)/requests')}
                style={{ marginTop: space.sm }}
              />
            </View>
          </View>
        </Banner>
      ) : null}

      {pricingMoved ? (
        <Banner tone="info">
          <Txt variant="bodyMd" color={colors.onInfoContainer}>
            The pool changed, so every farmer's share was recalculated.
          </Txt>
        </Banner>
      ) : null}

      <View style={{ flexDirection: 'row', gap: space.sm, marginBottom: space.gutter }}>
        <Pressable
          style={[actionButton, { flex: 1 }]}
          onPress={() => {
            setChatOpen(true);
            setUnread(0);
          }}
        >
          <MaterialIcons name="chat" size={20} color={colors.primary} />
          <Txt variant="labelLg" color={colors.primary}>
            Trip chat{unread > 0 ? ` (${unread})` : ''}
          </Txt>
        </Pressable>
        <Pressable
          style={[actionButton, { flex: 1 }]}
          onPress={() => void Linking.openURL(`tel:${SUPPORT_PHONE.replace(/-/g, '')}`)}
        >
          <MaterialIcons name="headset-mic" size={20} color={colors.primary} />
          <Txt variant="labelLg" color={colors.primary}>
            Support
          </Txt>
        </Pressable>
      </View>

      <Txt variant="headlineMd" style={{ marginBottom: space.sm }}>
        Pickups in order
      </Txt>

      {shipments.length === 0 ? (
        <EmptyState
          icon="inventory-2"
          title="No loads yet"
          message="Claim loads from the pool — a farmer choosing you puts their produce on this trip."
          action={
            <Button
              label="Open the load pool"
              icon="local-shipping"
              onPress={() => router.push('/(transporter)/requests')}
            />
          }
        />
      ) : (
        shipments.map((shipment) => {
          const next = SHIPMENT_NEXT[shipment.state];
          const canAdvance = next ? canTransitionShipment(shipment.state, next.to) : false;
          const phone = shipment.farmer?.phone;

          return (
            <Card key={shipment._id}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.gutter }}>
                <View style={sequenceChip}>
                  <Txt variant="labelLg" color={colors.onPrimary}>
                    {String(shipment.pickupSequence + 1)}
                  </Txt>
                </View>
                <View style={{ flex: 1 }}>
                  <Txt variant="labelLg">{shipment.farmer?.name ?? 'Farmer'}</Txt>
                  <Txt variant="labelSm" color={colors.onSurfaceVariant}>
                    {shipment.cropType} · {kg(shipment.quantityKg)}
                  </Txt>
                </View>
                <StatusBadge
                  status={shipment.state}
                  label={SHIPMENT_LABEL[shipment.state]}
                />
              </View>

              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: space.sm,
                  marginTop: space.gutter,
                }}
              >
                <MaterialIcons name="my-location" size={16} color={colors.primary} />
                <Txt variant="bodyMd" numberOfLines={1} style={{ flex: 1 }}>
                  {shipment.pickup.name}
                </Txt>
              </View>

              <Divider />
              <Row
                label="Farmer pays"
                value={rupees(shipment.pricing?.amount ?? shipment.finalPrice ?? shipment.allocatedPrice)}
                bold
              />
              {shipment.pricing ? (
                <Txt variant="labelSm" color={colors.outline}>
                  {shipment.pricing.rideKm.toFixed(0)} km aboard ·{' '}
                  {shipment.pricing.detourKm > 0
                    ? `${shipment.pricing.detourKm.toFixed(1)} km detour for them`
                    : 'on your route'}
                  {shipment.pricing.frozen ? ' · final' : ''}
                </Txt>
              ) : null}

              {actionError?.key === shipment._id ? (
                <Banner tone="error" style={{ marginTop: space.gutter, marginBottom: 0 }}>
                  <Txt variant="bodyMd" color={colors.onErrorContainer}>
                    {actionError.message}
                  </Txt>
                </Banner>
              ) : null}

              <View style={{ flexDirection: 'row', gap: space.sm, marginTop: space.gutter }}>
                <Pressable
                  style={[actionButton, { flex: 1, opacity: phone ? 1 : 0.5 }]}
                  disabled={!phone}
                  onPress={() => void Linking.openURL(`tel:${phone ?? ''}`)}
                >
                  <MaterialIcons name="call" size={20} color={colors.primary} />
                  <Txt variant="labelLg" color={colors.primary}>
                    {phone ? 'Call' : 'No number'}
                  </Txt>
                </Pressable>

                {next && canAdvance ? (
                  <Button
                    label={next.label}
                    icon={next.to === 'PICKED_UP' ? 'vpn-key' : 'arrow-forward'}
                    loading={busy === shipment._id}
                    onPress={() => {
                      if (next.to === 'PICKED_UP') {
                        setOtp('');
                        setOtpError(undefined);
                        setOtpFor(shipment);
                        return;
                      }
                      void advanceShipment(shipment, next.to);
                    }}
                    style={{ flex: 2 }}
                  />
                ) : null}
              </View>
            </Card>
          );
        })
      )}

      <Txt variant="labelSm" color={colors.onSurfaceVariant}>
        Your location is shared with the farmers on this trip only while it is running.
      </Txt>

      {/* the farmer's 4-digit code is what proves the right produce was collected */}
      <Modal
        visible={otpFor !== null}
        transparent
        animationType="slide"
        onRequestClose={() => setOtpFor(null)}
      >
        <View style={{ flex: 1, backgroundColor: 'rgba(25,28,27,0.4)', justifyContent: 'flex-end' }}>
          <View
            style={{
              backgroundColor: colors.background,
              borderTopLeftRadius: radius.xl,
              borderTopRightRadius: radius.xl,
              padding: space.md,
              paddingBottom: space.xl,
            }}
          >
            <Txt variant="headlineMd">Pickup code</Txt>
            <Txt variant="bodyMd" color={colors.onSurfaceVariant} style={{ marginBottom: space.md }}>
              Ask {otpFor?.farmer?.name ?? 'the farmer'} for the 4-digit code on their phone.
            </Txt>

            <Field
              label="4-digit code"
              value={otp}
              onChangeText={setOtp}
              placeholder="0000"
              keyboardType="number-pad"
              maxLength={4}
              error={otpError}
            />

            <View style={{ flexDirection: 'row', gap: space.sm }}>
              <Button
                label="Cancel"
                variant="secondary"
                icon={null}
                onPress={() => setOtpFor(null)}
                style={{ flex: 1 }}
              />
              <Button
                label="Confirm pickup"
                icon="check-circle"
                loading={busy === otpFor?._id}
                disabled={otp.trim().length !== 4}
                onPress={() => otpFor && void advanceShipment(otpFor, 'PICKED_UP', otp.trim())}
                style={{ flex: 1 }}
              />
            </View>
          </View>
        </View>
      </Modal>

      <ChatSheet
        visible={chatOpen}
        onClose={() => setChatOpen(false)}
        tripId={id}
        myUserId={myId}
        socket={socketRef.current}
        otherPartyName="Trip chat"
      />
    </Screen>
  );
}

const actionButton = {
  minHeight: 48,
  borderRadius: radius.base,
  borderWidth: 1,
  borderColor: colors.primary,
  backgroundColor: colors.surfaceContainerLowest,
  flexDirection: 'row' as const,
  alignItems: 'center' as const,
  justifyContent: 'center' as const,
  gap: space.sm,
};

const sequenceChip = {
  width: 32,
  height: 32,
  borderRadius: radius.full,
  backgroundColor: colors.primaryContainer,
  alignItems: 'center' as const,
  justifyContent: 'center' as const,
};
