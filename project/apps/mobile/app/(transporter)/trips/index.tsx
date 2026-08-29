/**
 * Transporter · Trips — everything this driver has in flight.
 *
 * Two different kinds of thing live here and the screen keeps them apart on
 * purpose:
 *
 *   ACCEPTED   an offer awaiting a farmer's decision. Reserves nothing. It may
 *              still come to nothing if the farmer picks someone else.
 *   CONFIRMED  a farmer chose this driver; the load is on a real trip and its
 *              weight is reserved.
 *
 * Presenting an acceptance as a booking is the exact mistake this build is here
 * to fix, so the two never share a section or a badge tone.
 */
import { useCallback, useMemo, useState } from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';
import { api } from '../../../lib/api';
import { toAppError } from '../../../lib/errors';
import { useLoader } from '../../../lib/useLoader';
import { OFFER_COPY, OPEN_TRIP_STATES } from '../../../lib/pooling';
import { kg, km, rupees, shortDate, timeAgo } from '../../../lib/format';
import {
  AppBar,
  Banner,
  Button,
  Card,
  ConfirmDialog,
  Divider,
  EmptyState,
  FilterRow,
  IconBadge,
  Row,
  Screen,
  SkeletonList,
  StatusBadge,
  Toast,
  Txt,
} from '../../../components/ui';
import { ErrorView } from '../../../components/ErrorView';
import { BottomNav } from '../../../components/BottomNav';
import { colors, space } from '../../../theme';

type Tab = 'accepted' | 'active' | 'completed';

const TRIP_LABEL: Record<string, string> = {
  FORMING: 'Taking loads',
  EN_ROUTE: 'Collecting',
  IN_TRANSIT: 'To the mandi',
  AT_DESTINATION: 'At the mandi',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
};

export default function TransporterTrips() {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>('accepted');
  const [withdrawing, setWithdrawing] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [toastTone, setToastTone] = useState<'success' | 'error'>('success');

  const data = useLoader(
    useCallback(async () => {
      const [trips, offers] = await Promise.all([api.myTrips(), api.myOffers()]);
      return { trips, offers };
    }, []),
  );

  const trips = data.data?.trips ?? [];
  const offers = data.data?.offers ?? [];

  const pending = useMemo(
    () => offers.filter((offer) => offer.state === 'INTERESTED'),
    [offers],
  );
  const activeTrips = useMemo(
    () => trips.filter((trip) => OPEN_TRIP_STATES.includes(trip.state as never)),
    [trips],
  );
  const completedTrips = useMemo(
    () => trips.filter((trip) => trip.state === 'COMPLETED' || trip.state === 'CANCELLED'),
    [trips],
  );

  const tabs: Array<{ key: Tab; label: string; count?: number }> = [
    { key: 'accepted', label: 'Awaiting farmer', count: pending.length || undefined },
    { key: 'active', label: 'Confirmed & active', count: activeTrips.length || undefined },
    { key: 'completed', label: 'Completed', count: completedTrips.length || undefined },
  ];

  const withdraw = async (offerId: string): Promise<void> => {
    setBusy(true);
    try {
      await api.withdrawOffer(offerId);
      setWithdrawing(null);
      setToastTone('success');
      setToast('Acceptance withdrawn');
      data.refresh();
    } catch (err) {
      // BOOKING_STATE_INVALID here means the farmer already chose — say that plainly
      setWithdrawing(null);
      setToastTone('error');
      setToast(toAppError(err).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={{ flex: 1 }}>
      <Screen
        withNav
        refreshing={data.refreshing}
        onRefresh={data.refresh}
        header={
          <>
            <AppBar title="My trips" />
            <View style={{ paddingHorizontal: space.md, paddingBottom: space.sm }}>
              <FilterRow options={tabs} value={tab} onChange={setTab} />
            </View>
          </>
        }
      >
        {data.loading ? (
          <SkeletonList count={3} />
        ) : data.error ? (
          <ErrorView error={data.error} onRetry={data.refresh} />
        ) : tab === 'accepted' ? (
          pending.length === 0 ? (
            <EmptyState
              icon="pan-tool-alt"
              title="Nothing awaiting a decision"
              message="Loads you accept sit here while the farmer compares you against the other drivers who accepted."
              action={
                <Button
                  label="Browse requests"
                  icon="local-shipping"
                  onPress={() => router.push('/(transporter)/requests')}
                />
              }
            />
          ) : (
            <>
              <Banner tone="warning">
                <View style={{ flexDirection: 'row', gap: space.sm }}>
                  <MaterialIcons name="info" size={20} color={colors.onWarningContainer} />
                  <Txt variant="bodyMd" color={colors.onWarningContainer} style={{ flex: 1 }}>
                    None of these is booked. Each farmer is still choosing, and no space on your
                    vehicle is reserved for them yet.
                  </Txt>
                </View>
              </Banner>

              {pending.map((offer) => {
                const request = offer.request;
                const copy = OFFER_COPY.INTERESTED;
                return (
                  <Card key={offer._id}>
                    <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: space.gutter }}>
                      <IconBadge icon="pan-tool-alt" tone="tertiary" />
                      <View style={{ flex: 1 }}>
                        <Txt variant="labelLg">{request?.cropType ?? 'Load'}</Txt>
                        <Txt variant="labelSm" color={colors.onSurfaceVariant}>
                          {kg(request?.quantityKg ?? 0)} · accepted {timeAgo(offer.createdAt)}
                        </Txt>
                      </View>
                      <StatusBadge status={copy.badge} label={copy.label} />
                    </View>

                    <View style={{ marginTop: space.gutter, gap: space.xs }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
                        <MaterialIcons name="my-location" size={15} color={colors.primary} />
                        <Txt variant="bodyMd" numberOfLines={1} style={{ flex: 1 }}>
                          {request?.pickup.name ?? '—'}
                        </Txt>
                      </View>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
                        <MaterialIcons name="place" size={15} color={colors.tertiary} />
                        <Txt variant="bodyMd" numberOfLines={1} style={{ flex: 1 }}>
                          {request?.destination.name ?? '—'}
                        </Txt>
                      </View>
                    </View>

                    <Divider />
                    <Row label="Pickup is" value={km(offer.pickupDistanceKm)} />
                    <Row label="Off your route" value={km(offer.detourKm)} />
                    <Row label="Farmer would pay" value={rupees(offer.quotedPrice)} bold />

                    <Button
                      label="Withdraw my acceptance"
                      variant="secondary"
                      icon="undo"
                      onPress={() => setWithdrawing(offer._id)}
                      style={{ marginTop: space.gutter }}
                    />
                  </Card>
                );
              })}
            </>
          )
        ) : tab === 'active' ? (
          activeTrips.length === 0 ? (
            <EmptyState
              icon="route"
              title="No confirmed trip"
              message="A trip starts the moment a farmer confirms you. Until then, accepted loads stay under 'Awaiting farmer'."
              action={
                <Button
                  label="Browse requests"
                  icon="local-shipping"
                  onPress={() => router.push('/(transporter)/requests')}
                />
              }
            />
          ) : (
            activeTrips.map((trip) => (
              <Card key={trip._id} onPress={() => router.push(`/(transporter)/trips/${trip._id}`)}>
                <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: space.gutter }}>
                  <IconBadge icon="local-shipping" />
                  <View style={{ flex: 1 }}>
                    <Txt variant="labelLg">{trip.destination.name}</Txt>
                    <Txt variant="labelSm" color={colors.onSurfaceVariant}>
                      {trip.poolSize} {trip.poolSize === 1 ? 'farmer' : 'farmers'} confirmed ·{' '}
                      {trip.routeDistanceKm.toFixed(0)} km
                    </Txt>
                  </View>
                  <StatusBadge status={trip.state} label={TRIP_LABEL[trip.state] ?? trip.state} />
                </View>

                <Divider />
                <Row label="Reserved" value={kg(trip.capacity.committedKg)} />
                <Row label="Loaded" value={kg(trip.capacity.loadedKg)} />
                <Row label="Still fits" value={kg(trip.capacity.availableKg)} bold />

                <Button
                  label="Manage trip"
                  icon="navigation"
                  onPress={() => router.push(`/(transporter)/trips/${trip._id}`)}
                  style={{ marginTop: space.gutter }}
                />
              </Card>
            ))
          )
        ) : completedTrips.length === 0 ? (
          <EmptyState
            icon="task-alt"
            title="No completed trips yet"
            message="Finished trips and what they earned you are kept here."
          />
        ) : (
          completedTrips.map((trip) => (
            <Card key={trip._id} onPress={() => router.push(`/(transporter)/trips/${trip._id}`)}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.gutter }}>
                <IconBadge
                  icon={trip.state === 'COMPLETED' ? 'check-circle' : 'cancel'}
                  tone={trip.state === 'COMPLETED' ? 'primary' : 'error'}
                />
                <View style={{ flex: 1 }}>
                  <Txt variant="labelLg">{trip.destination.name}</Txt>
                  <Txt variant="labelSm" color={colors.onSurfaceVariant}>
                    {trip.poolSize} {trip.poolSize === 1 ? 'farmer' : 'farmers'} ·{' '}
                    {trip.completedAt ? shortDate(trip.completedAt) : '—'}
                  </Txt>
                </View>
                <StatusBadge status={trip.state} label={TRIP_LABEL[trip.state] ?? trip.state} />
              </View>
            </Card>
          ))
        )}
      </Screen>

      <ConfirmDialog
        visible={withdrawing !== null}
        title="Withdraw your acceptance?"
        message="The farmer will no longer see you as an option for this load. You can accept it again later if it is still open."
        confirmLabel="Withdraw"
        destructive
        busy={busy}
        onCancel={() => setWithdrawing(null)}
        onConfirm={() => withdrawing && void withdraw(withdrawing)}
      />

      <Toast message={toast} tone={toastTone} onHide={() => setToast(null)} />
      <BottomNav role="transporter" active="trips" badges={{ trips: pending.length }} />
    </View>
  );
}
