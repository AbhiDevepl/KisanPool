/**
 * my_claims — the requests this driver has claimed and is waiting on.
 *
 * A claim reserves nothing: the farmer compares every driver who put their hand up
 * and picks one. So this screen is a waiting room, not an order book — the only
 * action here is to take a claim back before the farmer decides.
 */
import { useCallback, useState } from 'react';
import { View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';
import { api } from '../../lib/api';
import { toAppError } from '../../lib/errors';
import { kg, km, rupees, timeAgo } from '../../lib/format';
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
} from '../../components/ui';
import { ErrorView } from '../../components/ErrorView';
import { colors, space } from '../../theme';

type MyOffer = Awaited<ReturnType<typeof api.myOffers>>[number];

export default function MyClaims() {
  const router = useRouter();
  const [offers, setOffers] = useState<MyOffer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>();
  const [busy, setBusy] = useState<string | null>(null);
  /** withdrawal failures belong on the row that failed, not over the whole list */
  const [rowError, setRowError] = useState<{ offerId: string; message: string } | null>(null);

  const load = useCallback(async () => {
    setError(undefined);
    try {
      setOffers(await api.myOffers());
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

  const withdraw = async (offerId: string): Promise<void> => {
    setBusy(offerId);
    setRowError(null);
    try {
      await api.withdrawOffer(offerId);
      await load();
    } catch (err) {
      // BOOKING_STATE_INVALID here means the farmer already chose — say that plainly
      setRowError({ offerId, message: toAppError(err).message });
    } finally {
      setBusy(null);
    }
  };

  return (
    <Screen>
      <Header
        title="My claims"
        subtitle="Waiting on the farmer's choice"
        onBack={() => router.back()}
      />

      {loading ? (
        <Loading label="Loading your claims…" />
      ) : error ? (
        <ErrorView error={error} onRetry={() => void load()} />
      ) : offers.length === 0 ? (
        <EmptyState
          icon="pan-tool-alt"
          title="You have not claimed anything"
          message="Open the load pool and claim the loads that suit your route."
          action={
            <Button
              label="Open the load pool"
              icon="local-shipping"
              onPress={() => router.push('/(transporter)/trips/available')}
            />
          }
        />
      ) : (
        offers.map((offer) => {
          const request = offer.request;
          const selected = offer.state === 'SELECTED';

          return (
            <Card key={offer._id}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <View style={{ flex: 1 }}>
                  <Txt variant="headlineMd">{request?.cropType ?? 'Load'}</Txt>
                  <Txt variant="labelSm" color={colors.onSurfaceVariant}>
                    {kg(request?.quantityKg ?? 0)} · claimed {timeAgo(offer.createdAt)}
                  </Txt>
                </View>
                <StatusBadge
                  status={selected ? 'BOOKED' : 'PENDING'}
                  label={selected ? 'Farmer chose you' : 'Farmer deciding'}
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
                <Txt variant="bodyMd" numberOfLines={1}>
                  {request?.pickup.name ?? '—'}
                </Txt>
              </View>
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: space.sm,
                  marginTop: space.xs,
                }}
              >
                <MaterialIcons name="place" size={16} color={colors.tertiary} />
                <Txt variant="bodyMd" numberOfLines={1}>
                  {request?.destination.name ?? '—'}
                </Txt>
              </View>

              {offer.message ? (
                <Txt
                  variant="bodyMd"
                  color={colors.onSurfaceVariant}
                  style={{ marginTop: space.sm }}
                >
                  “{offer.message}”
                </Txt>
              ) : null}

              <Divider />
              <Row label="Pickup is" value={km(offer.pickupDistanceKm)} />
              <Row label="Off your route" value={km(offer.detourKm)} />
              <Row label="Farmer would pay" value={rupees(offer.quotedPrice)} bold />

              {rowError?.offerId === offer._id ? (
                <Banner tone="error" style={{ marginTop: space.gutter, marginBottom: 0 }}>
                  <Txt variant="labelLg" color={colors.onErrorContainer}>
                    Could not withdraw
                  </Txt>
                  <Txt variant="bodyMd" color={colors.onErrorContainer}>
                    {rowError.message}
                  </Txt>
                </Banner>
              ) : null}

              {selected ? (
                <Button
                  label="Open the trip"
                  icon="local-shipping"
                  onPress={() =>
                    offer.tripId
                      ? router.push(`/(transporter)/trips/${offer.tripId}`)
                      : router.push('/(transporter)/home')
                  }
                  style={{ marginTop: space.gutter }}
                />
              ) : (
                <Button
                  label="Withdraw my claim"
                  variant="secondary"
                  icon="undo"
                  loading={busy === offer._id}
                  onPress={() => void withdraw(offer._id)}
                  style={{ marginTop: space.gutter }}
                />
              )}
            </Card>
          );
        })
      )}
    </Screen>
  );
}
