/**
 * Rate the driver after delivery.
 *
 * A rating belongs to one shipment, not the whole shared trip — several farmers
 * rode the same vehicle and each rates their own leg (ADR-030).
 */
import { useCallback, useEffect, useState } from 'react';
import { View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { api } from '../../../../lib/api';
import { toAppError } from '../../../../lib/errors';
import { getUser } from '../../../../lib/session';
import { Button, Card, Field, Header, Loading, RatingStars, Screen, Txt } from '../../../../components/ui';
import { ErrorView } from '../../../../components/ErrorView';
import { colors, space } from '../../../../theme';

export default function RateDriver() {
  const router = useRouter();
  const { id, shipmentId: shipmentParam } = useLocalSearchParams<{
    id: string;
    shipmentId?: string;
  }>();

  const [shipmentId, setShipmentId] = useState<string | null>(shipmentParam ?? null);
  const [driverName, setDriverName] = useState<string | null>(null);
  const [stars, setStars] = useState(5);
  const [comment, setComment] = useState('');
  const [loading, setLoading] = useState(!shipmentParam);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();

  // the trip carries several farmers' loads; the one being rated is this farmer's
  const load = useCallback(async () => {
    setError(undefined);
    try {
      const user = await getUser();
      const trip = await api.getTrip(id);
      setDriverName(trip.transporter?.name ?? null);
      const mine = trip.shipments.find((s) => s.farmerId === user?._id);
      if (mine) setShipmentId(mine._id);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const alreadyRated = error ? toAppError(error).code === 'BOOKING_ALREADY_RATED' : false;

  const submit = async (): Promise<void> => {
    if (!shipmentId) return;
    setBusy(true);
    setError(undefined);
    try {
      await api.rate(shipmentId, stars, comment.trim() || undefined);
      router.replace('/(farmer)/home');
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <Screen>
        <Header title="How was the trip?" onBack={() => router.back()} />
        <Loading />
      </Screen>
    );
  }

  return (
    <Screen
      footer={
        <Button
          label="Submit rating"
          loading={busy}
          disabled={alreadyRated || !shipmentId}
          onPress={() => void submit()}
        />
      }
    >
      <Header
        title="How was the trip?"
        subtitle={driverName ? `${driverName} carried your produce` : 'प्रवास कसा होता?'}
        onBack={() => router.back()}
      />

      <Card>
        <View style={{ alignItems: 'center', paddingVertical: space.md }}>
          <RatingStars value={stars} size={40} onChange={setStars} />
          <Txt variant="labelLg" color={colors.onSurfaceVariant} style={{ marginTop: space.sm }}>
            {['', 'Poor', 'Fair', 'Good', 'Very good', 'Excellent'][stars]}
          </Txt>
        </View>
      </Card>

      <Field
        label="Add a comment (optional)"
        value={comment}
        onChangeText={setComment}
        placeholder="Was the driver on time? Was the produce handled well?"
        multiline
        numberOfLines={4}
        style={{ marginTop: space.sm }}
      />

      {error ? <ErrorView error={error} onRetry={() => void submit()} /> : null}
    </Screen>
  );
}
