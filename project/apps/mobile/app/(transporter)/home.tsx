/**
 * transporter_dashboard — availability toggle, the trip being built right now,
 * claims the farmers are still deciding on, earnings, and the verification banner.
 *
 * Same Farmer design tokens and the same shared components as the farmer stack —
 * nothing here branches on role for styling (ADR-017).
 */
import { useCallback, useState } from 'react';
import { Switch, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';
import type { TripCapacity, UserDTO, VehicleDTO } from '@kisanpool/shared';
import { api } from '../../lib/api';
import { useSocket } from '../../lib/socket';
import { getUser } from '../../lib/session';
import { kg, rupees } from '../../lib/format';
import {
  Banner,
  Button,
  Card,
  Divider,
  Loading,
  RatingStars,
  Row,
  Screen,
  StatusBadge,
  Txt,
} from '../../components/ui';
import { ErrorView } from '../../components/ErrorView';
import { colors, radius, space } from '../../theme';

type MyTrip = Awaited<ReturnType<typeof api.myTrips>>[number];

/** A trip still running — a vehicle may only ever have one of these. */
const OPEN_TRIP_STATES = ['FORMING', 'EN_ROUTE', 'IN_TRANSIT', 'AT_DESTINATION'];

const TRIP_LABEL: Record<string, string> = {
  FORMING: 'Taking loads',
  EN_ROUTE: 'Collecting',
  IN_TRANSIT: 'To the mandi',
  AT_DESTINATION: 'At the mandi',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
};

export default function TransporterHome() {
  const router = useRouter();
  const [user, setUserState] = useState<UserDTO | null>(null);
  const [vehicle, setVehicle] = useState<VehicleDTO | null>(null);
  const [trips, setTrips] = useState<MyTrip[]>([]);
  const [awaitingDecision, setAwaitingDecision] = useState(0);
  const [payoutTotal, setPayoutTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>();
  const [toggling, setToggling] = useState(false);
  const [newlySelected, setNewlySelected] = useState(0);

  const load = useCallback(async () => {
    setError(undefined);
    try {
      setUserState(await getUser());
      setVehicle(await api.myVehicle());
      setTrips(await api.myTrips());
      const offers = await api.myOffers();
      setAwaitingDecision(offers.filter((offer) => offer.state === 'INTERESTED').length);
      const payouts = await api.payouts();
      setPayoutTotal(payouts.total);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const openTrip = trips.find((trip) => OPEN_TRIP_STATES.includes(trip.state));
  const completed = trips.filter((trip) => trip.state === 'COMPLETED');

  /**
   * Live counts. The dashboard joins the open trip's room so a farmer choosing this
   * driver, a load moving, or capacity freeing up lands here without a pull to
   * refresh — refetching only on focus meant a driver staring at the screen saw
   * nothing move.
   */
  useSocket(openTrip ? { type: 'trip', id: openTrip._id } : null, {
    'offer:selected': () => {
      setNewlySelected((n) => n + 1);
      void load();
    },
    'shipment:state': () => {
      void load();
    },
    'trip:capacity': (payload: { capacity: TripCapacity; poolSize: number }) => {
      setTrips((prev) =>
        prev.map((trip) =>
          trip._id === openTrip?._id
            ? { ...trip, capacity: payload.capacity, poolSize: payload.poolSize }
            : trip,
        ),
      );
    },
  });

  const toggleAvailability = async (online: boolean): Promise<void> => {
    if (!vehicle) return;
    setToggling(true);
    setError(undefined);
    try {
      const updated = await api.setAvailability(vehicle._id, online ? 'AVAILABLE' : 'OFFLINE');
      setVehicle(updated);
    } catch (err) {
      // KYC_PENDING_REVIEW -> keep the screen, disable the control, say why
      setError(err);
    } finally {
      setToggling(false);
    }
  };

  if (loading) {
    return (
      <Screen>
        <Loading />
      </Screen>
    );
  }

  const verified = vehicle?.verificationStatus === 'VERIFIED';
  const online = vehicle?.status === 'AVAILABLE';

  return (
    <Screen>
      <View style={{ paddingTop: space.md, flexDirection: 'row', alignItems: 'center' }}>
        <View style={{ flex: 1 }}>
          <Txt variant="displayLg">{user?.name?.split(' ')[0] ?? 'Driver'}</Txt>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
            <RatingStars value={user?.ratingAvg ?? 0} />
            <Txt variant="labelSm" color={colors.onSurfaceVariant}>
              {(user?.ratingAvg ?? 0).toFixed(1)} ({user?.ratingCount ?? 0})
            </Txt>
          </View>
        </View>
        {vehicle ? <StatusBadge status={vehicle.verificationStatus} /> : null}
      </View>

      {/* the banner that explains why no loads are arriving */}
      {vehicle && !verified ? (
        <Banner tone="warning" style={{ marginTop: space.md }}>
          <View style={{ flexDirection: 'row', gap: space.sm }}>
            <MaterialIcons name="hourglass-empty" size={22} color={colors.onWarningContainer} />
            <View style={{ flex: 1 }}>
              <Txt variant="labelLg" color={colors.onWarningContainer}>
                {vehicle.verificationStatus === 'REJECTED'
                  ? 'Your documents were rejected'
                  : 'Verification in progress'}
              </Txt>
              <Txt
                variant="bodyMd"
                color={colors.onWarningContainer}
                style={{ marginTop: space.xs }}
              >
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

      <Card style={{ marginTop: space.md }}>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <View style={{ flex: 1 }}>
            <Txt variant="headlineMd">{online ? 'Online' : 'Offline'}</Txt>
            <Txt variant="labelSm" color={colors.onSurfaceVariant}>
              {verified
                ? online
                  ? 'The load pool is open to you'
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

      {error ? <ErrorView error={error} onRetry={() => void load()} /> : null}

      <View style={{ flexDirection: 'row', gap: space.gutter }}>
        <Card style={{ flex: 1 }}>
          <Txt variant="labelSm" color={colors.onSurfaceVariant}>
            Total earned
          </Txt>
          <Txt variant="headlineLg">{rupees(payoutTotal)}</Txt>
        </Card>
        <Card style={{ flex: 1 }}>
          <Txt variant="labelSm" color={colors.onSurfaceVariant}>
            Trips completed
          </Txt>
          <Txt variant="headlineLg">{completed.length}</Txt>
        </Card>
      </View>

      {/* one vehicle, one open trip — many farmers on it */}
      {openTrip ? (
        <Card onPress={() => router.push(`/(transporter)/trips/${openTrip._id}`)}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <Txt variant="labelLg">Current trip</Txt>
            <StatusBadge status={openTrip.state} label={TRIP_LABEL[openTrip.state] ?? openTrip.state} />
          </View>
          <Txt variant="bodyMd" color={colors.onSurfaceVariant} style={{ marginTop: space.xs }}>
            {openTrip.poolSize} {openTrip.poolSize === 1 ? 'farmer' : 'farmers'} →{' '}
            {openTrip.destination.name}
          </Txt>

          <View
            style={{
              flexDirection: 'row',
              height: 12,
              borderRadius: radius.full,
              overflow: 'hidden',
              backgroundColor: colors.surfaceContainerHigh,
              marginTop: space.gutter,
            }}
          >
            <View style={{ flex: Math.max(0, openTrip.capacity.loadedKg), backgroundColor: colors.primary }} />
            <View
              style={{
                flex: Math.max(0, openTrip.capacity.committedKg - openTrip.capacity.loadedKg),
                backgroundColor: colors.primaryContainer,
              }}
            />
            <View style={{ flex: Math.max(0, openTrip.capacity.availableKg) }} />
          </View>

          <Divider />
          <Row label="Booked in" value={kg(openTrip.capacity.committedKg)} />
          <Row label="Still fits" value={kg(openTrip.capacity.availableKg)} bold />
        </Card>
      ) : null}

      {!vehicle ? (
        <Card>
          <Txt variant="headlineMd">No vehicle registered</Txt>
          <Txt variant="bodyMd" color={colors.onSurfaceVariant} style={{ marginTop: space.xs }}>
            Add your vehicle to start claiming loads.
          </Txt>
          <Button
            label="Register my vehicle"
            onPress={() => router.push('/(auth)/vehicle-register')}
            style={{ marginTop: space.gutter }}
          />
        </Card>
      ) : (
        <Card>
          <Txt variant="labelLg">{vehicle.registrationNumber}</Txt>
          <Txt variant="labelSm" color={colors.onSurfaceVariant}>
            {vehicle.vehicleType}
          </Txt>
          <Divider />
          <Row label="Total capacity" value={kg(vehicle.capacityKg)} />
          <Row label="Rate" value={`${rupees(vehicle.ratePerKm)} / km`} />
        </Card>
      )}

      <View style={{ flexDirection: 'row', gap: space.gutter }}>
        <Card
          style={{ flex: 1 }}
          onPress={() => {
            setNewlySelected(0);
            router.push('/(transporter)/trips/available');
          }}
        >
          <View
            style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}
          >
            <MaterialIcons name="local-shipping" size={24} color={colors.primary} />
            {newlySelected > 0 ? <CountBadge count={newlySelected} /> : null}
          </View>
          <Txt variant="labelLg" style={{ marginTop: space.sm }}>
            Load pool
          </Txt>
          <Txt variant="labelSm" color={colors.onSurfaceVariant}>
            {openTrip ? `${kg(openTrip.capacity.availableKg)} still fits` : 'Claim what suits you'}
          </Txt>
        </Card>

        <Card style={{ flex: 1 }} onPress={() => router.push('/(transporter)/offers')}>
          <View
            style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}
          >
            <MaterialIcons name="pan-tool-alt" size={24} color={colors.primary} />
            {awaitingDecision > 0 ? <CountBadge count={awaitingDecision} /> : null}
          </View>
          <Txt variant="labelLg" style={{ marginTop: space.sm }}>
            My claims
          </Txt>
          <Txt variant="labelSm" color={colors.onSurfaceVariant}>
            {awaitingDecision > 0 ? 'Farmers deciding' : 'Nothing pending'}
          </Txt>
        </Card>
      </View>

      <Card onPress={() => router.push('/(transporter)/payouts')}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
          <MaterialIcons name="payments" size={24} color={colors.primary} />
          <Txt variant="labelLg">Earnings</Txt>
        </View>
      </Card>

      <View style={{ height: radius.xl }} />
    </Screen>
  );
}

function CountBadge({ count }: { count: number }) {
  return (
    <View
      style={{
        minWidth: 22,
        height: 22,
        paddingHorizontal: 6,
        borderRadius: radius.full,
        backgroundColor: colors.primary,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Txt variant="labelSm" color={colors.onPrimary}>
        {String(count)}
      </Txt>
    </View>
  );
}
