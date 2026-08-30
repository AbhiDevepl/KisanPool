/**
 * Transporter · Dashboard — "am I available, what fits, what am I doing next?"
 *
 * The old screen was the whole app: availability, capacity, earnings, the load
 * pool, my claims, the vehicle record and the payouts link all on one scroll.
 * Requests, Trips, Earnings and Profile are now tabs of their own; what stays
 * here is only the status summary and the single next action.
 *
 * The capacity card is the important one. It shows FOUR different numbers because
 * they mean four different things, and folding them together would break pooling:
 *
 *   Accepted   claimed by me, no farmer has confirmed  -> reserves NOTHING
 *   Confirmed  a farmer chose me                       -> reserved
 *   Loaded     physically aboard                       -> reserved
 *   Available  what a farmer could still confirm into
 */
import { useCallback, useEffect, useState } from 'react';
import { Switch, View } from 'react-native';
import { useRouter } from 'expo-router';
import * as Location from 'expo-location';
import { MaterialIcons } from '@expo/vector-icons';
import type { TripCapacity, UserDTO, VehicleDTO } from '@kisanpool/shared';
import { api } from '../../lib/api';
import { useSocket } from '../../lib/socket';
import { getUser, setUser as persistUser } from '../../lib/session';
import { useLoader } from '../../lib/useLoader';
import { toAppError } from '../../lib/errors';
import {
  acceptedKgFrom,
  emptyLedger,
  ledgerFrom,
  ledgerSegments,
  usedPct,
  OPEN_TRIP_STATES,
} from '../../lib/pooling';

import { isToday, kg, rupees } from '../../lib/format';
import {
  AppBar,
  Banner,
  Button,
  Card,
  Divider,
  Metric,
  ProgressTrack,
  Row,
  Screen,
  SectionHeader,
  SkeletonCard,
  StatusBadge,
  Toast,
  Txt,
} from '../../components/ui';
import { ErrorView } from '../../components/ErrorView';
import { BottomNav } from '../../components/BottomNav';
import { VoiceAssistantButton } from '../../components/VoiceAssistantButton';
import { colors, radius, space } from '../../theme';

const TRIP_LABEL: Record<string, string> = {
  FORMING: 'Taking loads',
  EN_ROUTE: 'Collecting',
  IN_TRANSIT: 'To the mandi',
  AT_DESTINATION: 'At the mandi',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
};

export default function TransporterDashboard() {
  const router = useRouter();
  const [user, setUserState] = useState<UserDTO | null>(null);
  const [vehicle, setVehicle] = useState<VehicleDTO | null>(null);
  const [toggling, setToggling] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [toastTone, setToastTone] = useState<'success' | 'error'>('success');

  const dash = useLoader(
    useCallback(async () => {
      // paint from the cache immediately, then correct it from the server. The
      // cached user is written once at sign-in, so reading only that showed a
      // blank name and a 0.0 rating for the whole life of the session.
      setUserState(await getUser());

      const [me, myVehicle, trips, offers, payouts] = await Promise.all([
        api.me(),
        api.myVehicle(),
        api.myTrips(),
        api.myOffers(),
        api.payouts(),
      ]);
      setUserState(me);
      await persistUser(me);
      setVehicle(myVehicle);
      return { me, vehicle: myVehicle, trips, offers, payouts };
    }, []),
  );

  // push the driver's real position so the request pool matches by where they are
  useEffect(() => {
    void (async () => {
      try {
        const perm = await Location.requestForegroundPermissionsAsync();
        if (perm.status !== 'granted') return;
        const pos = await Location.getCurrentPositionAsync({});
        await api.updateVehicleLocation({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
        });
      } catch {
        // location is a matching hint; failing it must not break the dashboard
      }
    })();
  }, [dash.data?.vehicle?._id]);

  const trips = dash.data?.trips ?? [];
  const offers = dash.data?.offers ?? [];
  const payouts = dash.data?.payouts;

  const openTrip = trips.find((trip) => OPEN_TRIP_STATES.includes(trip.state as never));
  const completedCount = trips.filter((trip) => trip.state === 'COMPLETED').length;

  // weight this driver has claimed that no farmer has confirmed — not reserved
  const acceptedKg = acceptedKgFrom(offers);
  const awaitingFarmer = offers.filter((offer) => offer.state === 'INTERESTED').length;

  const ledger = openTrip
    ? ledgerFrom(openTrip.capacity, acceptedKg)
    : emptyLedger(vehicle?.capacityKg ?? 0, acceptedKg);

  const todayEarned = (payouts?.payouts ?? [])
    .filter((payout) => isToday(payout.createdAt))
    .reduce((sum, payout) => sum + payout.amount, 0);

  useSocket(openTrip ? { type: 'trip', id: openTrip._id } : null, {
    'offer:selected': () => void dash.reconcile(),
    'shipment:state': () => void dash.reconcile(),
    'trip:capacity': (payload: { capacity: TripCapacity; poolSize: number }) => {
      dash.set((previous) => ({
        ...previous,
        trips: previous.trips.map((trip) =>
          trip._id === openTrip?._id
            ? { ...trip, capacity: payload.capacity, poolSize: payload.poolSize }
            : trip,
        ),
      }));
    },
  });

  const verified = vehicle?.verificationStatus === 'VERIFIED';
  const online = vehicle?.status === 'AVAILABLE';

  const toggleAvailability = async (next: boolean): Promise<void> => {
    if (!vehicle) return;
    setToggling(true);
    try {
      const updated = await api.setAvailability(vehicle._id, next ? 'AVAILABLE' : 'OFFLINE');
      setVehicle(updated);
      setToastTone('success');
      setToast(next ? "You're online — loads will appear in Requests" : "You're offline");
    } catch (err) {
      setToastTone('error');
      setToast(toAppError(err).message);
    } finally {
      setToggling(false);
    }
  };

  return (
    <View style={{ flex: 1 }}>
      <Screen
        withNav
        refreshing={dash.refreshing}
        onRefresh={dash.refresh}
        header={
          <AppBar
            title={user?.name?.trim() ? `Hello, ${user.name.split(' ')[0]}` : 'Dashboard'}
            unread={awaitingFarmer}
            onNotifications={() => router.push('/(transporter)/trips')}
          />
        }
      >
        {dash.loading ? (
          <>
            <SkeletonCard lines={2} />
            <SkeletonCard lines={3} />
            <SkeletonCard lines={3} />
          </>
        ) : dash.error ? (
          <ErrorView error={dash.error} onRetry={dash.refresh} />
        ) : (
          <>
            {/* no vehicle at all — a real state with a way out, not a blank screen */}
            {!vehicle ? (
              <Banner tone="warning">
                <View style={{ flexDirection: 'row', gap: space.sm }}>
                  <MaterialIcons name="local-shipping" size={22} color={colors.onWarningContainer} />
                  <View style={{ flex: 1 }}>
                    <Txt variant="labelLg" color={colors.onWarningContainer}>
                      No vehicle registered yet
                    </Txt>
                    <Txt variant="bodyMd" color={colors.onWarningContainer}>
                      Register your vehicle and get it verified — loads can only be offered to a
                      verified vehicle.
                    </Txt>
                    <Button
                      label="Register my vehicle"
                      variant="secondary"
                      icon="add"
                      onPress={() => router.push('/(auth)/vehicle-register')}
                      style={{ marginTop: space.gutter }}
                    />
                  </View>
                </View>
              </Banner>
            ) : null}

            {/* why no loads are arriving, when that is the case */}
            {vehicle && !verified ? (
              <Banner tone="warning">
                <View style={{ flexDirection: 'row', gap: space.sm }}>
                  <MaterialIcons
                    name="hourglass-empty"
                    size={22}
                    color={colors.onWarningContainer}
                  />
                  <View style={{ flex: 1 }}>
                    <Txt variant="labelLg" color={colors.onWarningContainer}>
                      {vehicle.verificationStatus === 'REJECTED'
                        ? 'Your documents were rejected'
                        : 'Verification in progress'}
                    </Txt>
                    <Txt variant="bodyMd" color={colors.onWarningContainer}>
                      {vehicle.verificationStatus === 'REJECTED'
                        ? 'Please re-upload your RC and driving licence.'
                        : 'The load pool opens to you once your RC and licence are approved.'}
                    </Txt>
                    <Button
                      label="View documents"
                      variant="secondary"
                      icon="description"
                      onPress={() => router.push('/(auth)/kyc')}
                      style={{ marginTop: space.gutter }}
                    />
                  </View>
                </View>
              </Banner>
            ) : null}

            {/* am I available? */}
            <Card>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.gutter }}>
                <View
                  style={{
                    width: 12,
                    height: 12,
                    borderRadius: radius.full,
                    backgroundColor: online ? colors.secondary : colors.outline,
                  }}
                />
                <View style={{ flex: 1 }}>
                  <Txt variant="headlineMd" color={online ? colors.primary : colors.onSurface}>
                    {online ? 'Online' : 'Offline'}
                  </Txt>
                  <Txt variant="labelSm" color={colors.onSurfaceVariant}>
                    {verified
                      ? online
                        ? 'You are available for loads'
                        : 'Go online to see loads near you'
                      : 'Available once your documents are verified'}
                  </Txt>
                </View>
                <Switch
                  value={online}
                  disabled={!verified || toggling}
                  onValueChange={(next) => void toggleAvailability(next)}
                  trackColor={{ true: colors.primaryContainer, false: colors.surfaceContainerHigh }}
                  thumbColor={colors.surfaceContainerLowest}
                />
              </View>
            </Card>

            {/* how much have I earned? */}
            <Card
              style={{
                backgroundColor: colors.primaryContainer,
                borderColor: colors.primaryContainer,
                borderRadius: radius.xl,
              }}
            >
              <Txt variant="bodyMd" color={colors.onPrimaryContainer}>
                Today's earnings
              </Txt>
              <Txt variant="displayLg" color={colors.onPrimary}>
                {rupees(todayEarned)}
              </Txt>

              <View style={{ flexDirection: 'row', gap: space.md, marginTop: space.md }}>
                <Metric
                  label="Trips completed"
                  value={String(completedCount)}
                  tone="onPrimary"
                />
                <Metric
                  label="Paid out so far"
                  value={rupees(payouts?.total ?? 0)}
                  tone="onPrimary"
                />
                <View style={{ flex: 1 }}>
                  <Txt variant="labelSm" color={colors.onPrimaryContainer}>
                    Rating
                  </Txt>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs }}>
                    <MaterialIcons name="star" size={18} color={colors.tertiaryContainer} />
                    <Txt variant="headlineMd" color={colors.onPrimary}>
                      {(user?.ratingAvg ?? 0).toFixed(1)}
                    </Txt>
                  </View>
                </View>
              </View>

              <Divider />
              <Button
                label="View earnings details"
                variant="secondary"
                onPress={() => router.push('/(transporter)/earnings')}
              />
            </Card>

            {/* how much capacity do I have? */}
            <Card>
              <View
                style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}
              >
                <Txt variant="headlineMd" color={colors.primary}>
                  Capacity
                </Txt>
                <View style={s.capacityPill}>
                  <Txt variant="labelSm" color={colors.onSurfaceVariant}>
                    {kg(ledger.confirmedKg)} / {kg(ledger.totalKg)}
                  </Txt>
                </View>
              </View>

              <View
                style={{ flexDirection: 'row', alignItems: 'center', gap: space.gutter, marginTop: space.md }}
              >
                <MaterialIcons name="local-shipping" size={32} color={colors.primaryContainer} />
                <View style={{ flex: 1 }}>
                  <ProgressTrack
                    height={12}
                    segments={ledgerSegments(ledger, {
                      loaded: colors.primary,
                      confirmed: colors.primaryContainer,
                    })}
                  />
                </View>
                <Txt variant="labelLg" color={colors.primary}>
                  {usedPct(ledger)}%
                </Txt>
              </View>

              <Divider />

              {/* the four numbers, never collapsed into one */}
              <Row label="Vehicle capacity" value={kg(ledger.totalKg)} />
              <Row label="Confirmed by farmers" value={kg(ledger.confirmedKg)} />
              <Row label="Currently loaded" value={kg(ledger.loadedKg)} />
              <Row label="Available" value={kg(ledger.availableKg)} bold />

              {ledger.acceptedKg > 0 ? (
                <View style={s.acceptedNote}>
                  <MaterialIcons name="pan-tool-alt" size={16} color={colors.onWarningContainer} />
                  <Txt variant="labelSm" color={colors.onWarningContainer} style={{ flex: 1 }}>
                    You have accepted {kg(ledger.acceptedKg)} more, awaiting farmers' decisions.
                    That space is <Txt variant="labelSm" color={colors.onWarningContainer}>not</Txt>{' '}
                    reserved until a farmer confirms you.
                  </Txt>
                </View>
              ) : null}
            </Card>

            {/* do I have a trip? */}
            <SectionHeader
              title="Active trip"
              actionLabel="All trips"
              onAction={() => router.push('/(transporter)/trips')}
            />

            {openTrip ? (
              <Card onPress={() => router.push(`/(transporter)/trips/${openTrip._id}`)}>
                <View
                  style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}
                >
                  <Txt variant="labelLg">{openTrip.destination.name}</Txt>
                  <StatusBadge
                    status={openTrip.state}
                    label={TRIP_LABEL[openTrip.state] ?? openTrip.state}
                  />
                </View>
                <Txt variant="labelSm" color={colors.onSurfaceVariant} style={{ marginTop: space.xs }}>
                  {openTrip.poolSize} {openTrip.poolSize === 1 ? 'farmer' : 'farmers'} aboard ·{' '}
                  {kg(openTrip.capacity.availableKg)} still free
                </Txt>

                {/* the trip's money, computed once on the backend. Every farmer
                    aboard is looking at their slice of exactly these numbers. */}
                {openTrip.pricing ? (
                  <>
                    <Divider />
                    <Row
                      label="Route"
                      value={`${openTrip.pricing.effectiveRouteKm.toFixed(0)} km @ ${rupees(
                        openTrip.pricing.ratePerKm,
                      )}/km`}
                    />
                    <Row label="Total trip value" value={rupees(openTrip.pricing.totalCost)} />
                    <Row label="Pooled load" value={kg(openTrip.pricing.totalQuantityKg)} />
                    <Row
                      label="You earn"
                      value={rupees(openTrip.pricing.transporterEarning)}
                      bold
                    />
                    <Txt variant="labelSm" color={colors.outline} style={{ marginTop: space.xs }}>
                      After the {Math.round(
                        (openTrip.pricing.platformFee / (openTrip.pricing.totalCost || 1)) * 100,
                      )}% platform fee. It grows every time another farmer joins.
                    </Txt>
                  </>
                ) : null}

                <Button
                  label="Open trip"
                  icon="navigation"
                  onPress={() => router.push(`/(transporter)/trips/${openTrip._id}`)}
                  style={{ marginTop: space.gutter }}
                />
              </Card>
            ) : (
              <Card raised={false} style={{ alignItems: 'center', paddingVertical: space.lg }}>
                <MaterialIcons name="route" size={40} color={colors.outline} />
                <Txt variant="labelLg" style={{ marginTop: space.sm }}>
                  No trip running
                </Txt>
                <Txt
                  variant="labelSm"
                  color={colors.onSurfaceVariant}
                  style={{ textAlign: 'center', marginTop: space.xs }}
                >
                  {online
                    ? 'Accept a load from Requests — your first confirmed farmer starts the trip.'
                    : 'Go online to start seeing loads on your route.'}
                </Txt>
                <Button
                  label={online ? 'Browse requests' : 'Go online'}
                  icon={online ? 'local-shipping' : 'wifi'}
                  onPress={() =>
                    online ? router.push('/(transporter)/requests') : void toggleAvailability(true)
                  }
                  style={{ marginTop: space.gutter, alignSelf: 'stretch' }}
                />
              </Card>
            )}

            {/* what should I do next? */}
            {awaitingFarmer > 0 ? (
              <Card
                style={{ borderColor: colors.tertiaryContainer, borderWidth: 2 }}
                onPress={() => router.push('/(transporter)/trips')}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
                  <MaterialIcons name="hourglass-top" size={22} color={colors.tertiary} />
                  <View style={{ flex: 1 }}>
                    <Txt variant="labelLg">
                      {awaitingFarmer} load{awaitingFarmer > 1 ? 's' : ''} awaiting a farmer's
                      decision
                    </Txt>
                    <Txt variant="labelSm" color={colors.onSurfaceVariant}>
                      You accepted these. None is booked until the farmer chooses you.
                    </Txt>
                  </View>
                  <MaterialIcons name="chevron-right" size={22} color={colors.outline} />
                </View>
              </Card>
            ) : null}
          </>
        )}
      </Screen>

      <Toast message={toast} tone={toastTone} onHide={() => setToast(null)} />
      <VoiceAssistantButton language={user?.language} />
      <BottomNav role="transporter" active="dashboard" badges={{ trips: awaitingFarmer }} />
    </View>
  );
}

const s = {
  capacityPill: {
    backgroundColor: colors.surfaceContainer,
    borderRadius: radius.full,
    paddingHorizontal: space.gutter,
    paddingVertical: space.xs,
  },
  acceptedNote: {
    flexDirection: 'row' as const,
    alignItems: 'flex-start' as const,
    gap: space.sm,
    backgroundColor: colors.warningContainer,
    borderRadius: radius.md,
    padding: space.gutter,
    marginTop: space.sm,
  },
};
