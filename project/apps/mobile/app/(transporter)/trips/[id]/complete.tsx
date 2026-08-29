/**
 * trip_completion_billing — what each farmer owes for their leg, the trip total,
 * and the one action that closes the trip.
 *
 * The bill is per shipment, not per trip: each load's price froze at its own
 * delivery, so a farmer who joined late never pays for the leg they missed. There
 * is no proof-of-delivery photo any more — the farmer's pickup code is what proves
 * the right produce moved.
 */
import { useCallback, useEffect, useState } from 'react';
import { View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';
import { OCCUPIES_CAPACITY } from '@kisanpool/shared';
import { api } from '../../../../lib/api';
import { toAppError } from '../../../../lib/errors';
import { kg, rupees, shortDate } from '../../../../lib/format';
import {
  Banner,
  Button,
  Card,
  Divider,
  EmptyState,
  Header,
  Loading,
  Row,
  Screen,
  StatusBadge,
  Txt,
} from '../../../../components/ui';
import { ErrorView } from '../../../../components/ErrorView';
import { colors, space } from '../../../../theme';

type TripDetail = Awaited<ReturnType<typeof api.getTrip>>;
type Payout = Awaited<ReturnType<typeof api.payouts>>['payouts'][number];

export default function CompleteTrip() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();

  const [detail, setDetail] = useState<TripDetail | null>(null);
  const [payouts, setPayouts] = useState<Payout[]>([]);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>();
  /** the server's own reason for refusing to close the trip, shown by the button */
  const [blocked, setBlocked] = useState<string>();

  const load = useCallback(async () => {
    setError(undefined);
    try {
      const [trip, earnings] = await Promise.all([api.getTrip(id), api.payouts()]);
      setDetail(trip);
      setPayouts(earnings.payouts.filter((payout) => payout.tripId === id));
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const complete = async (): Promise<void> => {
    setBusy(true);
    setBlocked(undefined);
    try {
      await api.setTripState(id, 'COMPLETED');
      await load();
    } catch (err) {
      // BOOKING_STATE_INVALID counts the loads still aboard — pass that through
      setBlocked(toAppError(err).message);
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <Screen>
        <Header title="Complete trip" onBack={() => router.back()} />
        <Loading />
      </Screen>
    );
  }

  if (!detail) {
    return (
      <Screen>
        <Header title="Complete trip" onBack={() => router.back()} />
        <ErrorView error={error} onRetry={() => void load()} />
      </Screen>
    );
  }

  const { trip, shipments } = detail;
  const done = trip.state === 'COMPLETED';
  const outstanding = shipments.filter((shipment) => OCCUPIES_CAPACITY.includes(shipment.state));
  const billTotal = shipments
    .filter((shipment) => shipment.state !== 'CANCELLED')
    .reduce((sum, shipment) => sum + (shipment.finalPrice ?? shipment.allocatedPrice), 0);
  const paidOut = payouts.reduce((sum, payout) => sum + payout.amount, 0);

  return (
    <Screen
      footer={
        done ? (
          <Button
            label="Rate the farmers"
            icon="star"
            onPress={() => router.replace(`/(transporter)/trips/${id}/rate`)}
          />
        ) : (
          <Button
            label="Complete this trip"
            icon="check-circle"
            loading={busy}
            // the server is the authority; this only avoids an obvious wasted tap
            disabled={outstanding.length > 0}
            onPress={() => void complete()}
          />
        )
      }
    >
      <Header
        title={done ? 'Trip completed' : 'Complete trip'}
        subtitle={`${shipments.length} ${shipments.length === 1 ? 'farmer' : 'farmers'} → ${trip.destination.name}`}
        onBack={() => router.back()}
      />

      {done ? (
        <Card
          style={{
            backgroundColor: colors.secondaryContainer,
            borderColor: colors.secondaryContainer,
          }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
            <MaterialIcons name="check-circle" size={28} color={colors.primary} />
            <View style={{ flex: 1 }}>
              <Txt variant="headlineMd" color={colors.onSecondaryContainer}>
                Trip completed
              </Txt>
              <Txt variant="bodyMd" color={colors.onSecondaryContainer}>
                Each farmer's payout reaches your bank account on its own.
              </Txt>
            </View>
          </View>
        </Card>
      ) : null}

      {error ? <ErrorView error={error} onRetry={() => void load()} /> : null}

      {blocked ? (
        <Banner tone="error">
          <Txt variant="labelLg" color={colors.onErrorContainer}>
            This trip cannot close yet
          </Txt>
          <Txt variant="bodyMd" color={colors.onErrorContainer}>
            {blocked}
          </Txt>
        </Banner>
      ) : null}

      {!done && outstanding.length > 0 ? (
        <Banner tone="warning">
          <Txt variant="labelLg" color={colors.onWarningContainer}>
            {outstanding.length} {outstanding.length === 1 ? 'load is' : 'loads are'} still aboard
          </Txt>
          <Txt variant="bodyMd" color={colors.onWarningContainer}>
            Deliver every load on the trip screen, then come back to close it.
          </Txt>
        </Banner>
      ) : null}

      {shipments.length === 0 ? (
        <EmptyState
          icon="inventory-2"
          title="Nothing was carried"
          message="This trip has no loads on it."
        />
      ) : (
        shipments.map((shipment) => {
          const payout = payouts.find((row) => row.shipmentId === shipment._id);
          return (
            <Card key={shipment._id}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <View style={{ flex: 1 }}>
                  <Txt variant="labelLg">{shipment.farmer?.name ?? 'Farmer'}</Txt>
                  <Txt variant="labelSm" color={colors.onSurfaceVariant}>
                    {shipment.cropType} · {kg(shipment.quantityKg)}
                  </Txt>
                </View>
                <StatusBadge status={shipment.state} />
              </View>

              <Divider />
              <Row label="From" value={shipment.pickup.name} />
              {shipment.deliveredAt ? (
                <Row label="Delivered" value={shortDate(shipment.deliveredAt)} />
              ) : null}
              <Row
                label="Farmer's bill"
                value={rupees(shipment.finalPrice ?? shipment.allocatedPrice)}
              />
              <Row
                label="Your payout"
                value={payout ? rupees(payout.amount) : 'After they pay'}
                bold={Boolean(payout)}
              />
            </Card>
          );
        })
      )}

      <Card>
        <Txt variant="headlineMd">Trip total</Txt>
        <Divider />
        <Row label="Billed to farmers" value={rupees(billTotal)} />
        <Row label="Paid to you so far" value={rupees(paidOut)} bold />
        <Txt variant="labelSm" color={colors.onSurfaceVariant} style={{ marginTop: space.xs }}>
          Your share of each load lands automatically once that farmer pays.
        </Txt>
      </Card>
    </Screen>
  );
}
