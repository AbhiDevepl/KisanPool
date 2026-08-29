/**
 * rate_farmers — a driver carried several farmers on one trip, so a rating belongs
 * to a shipment, not to the trip. Each leg is rated separately, or not at all.
 */
import { useCallback, useEffect, useState } from 'react';
import { View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';
import { api } from '../../../../lib/api';
import { toAppError } from '../../../../lib/errors';
import { kg } from '../../../../lib/format';
import {
  Banner,
  Button,
  Card,
  EmptyState,
  Field,
  Header,
  Loading,
  RatingStars,
  Screen,
  Txt,
} from '../../../../components/ui';
import { ErrorView } from '../../../../components/ErrorView';
import { colors, space } from '../../../../theme';

type TripDetail = Awaited<ReturnType<typeof api.getTrip>>;

/** Only a load that actually arrived can be rated — the server enforces the same list. */
const RATABLE = ['DELIVERED', 'PAYMENT_PENDING', 'PAID', 'COMPLETED'];

const WORDS = ['', 'Poor', 'Fair', 'Good', 'Very good', 'Excellent'];

export default function RateFarmers() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();

  const [detail, setDetail] = useState<TripDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>();
  const [stars, setStars] = useState<Record<string, number>>({});
  const [comments, setComments] = useState<Record<string, string>>({});
  const [rated, setRated] = useState<string[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [rowError, setRowError] = useState<{ shipmentId: string; message: string } | null>(null);

  const load = useCallback(async () => {
    setError(undefined);
    try {
      setDetail(await api.getTrip(id));
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const submit = async (shipmentId: string): Promise<void> => {
    setBusy(shipmentId);
    setRowError(null);
    try {
      await api.rate(shipmentId, stars[shipmentId] ?? 5, comments[shipmentId]?.trim() || undefined);
      setRated((prev) => [...prev, shipmentId]);
    } catch (err) {
      // BOOKING_ALREADY_RATED is not a failure the driver can act on — say it once
      const appError = toAppError(err);
      if (appError.code === 'BOOKING_ALREADY_RATED') setRated((prev) => [...prev, shipmentId]);
      else setRowError({ shipmentId, message: appError.message });
    } finally {
      setBusy(null);
    }
  };

  const ratable = (detail?.shipments ?? []).filter((shipment) => RATABLE.includes(shipment.state));

  return (
    <Screen
      footer={
        <Button
          label="Done"
          icon="check"
          onPress={() => router.replace('/(transporter)/home')}
        />
      }
    >
      <Header
        title="Rate the farmers"
        subtitle="शेतकऱ्यांना रेटिंग द्या"
        onBack={() => router.back()}
      />

      {loading ? (
        <Loading />
      ) : error ? (
        <ErrorView error={error} onRetry={() => void load()} />
      ) : ratable.length === 0 ? (
        <EmptyState
          icon="star-border"
          title="Nothing to rate yet"
          message="You can rate each farmer once their load has been delivered."
        />
      ) : (
        ratable.map((shipment) => {
          const value = stars[shipment._id] ?? 5;
          const isRated = rated.includes(shipment._id);

          return (
            <Card key={shipment._id}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
                <View style={{ flex: 1 }}>
                  <Txt variant="labelLg">{shipment.farmer?.name ?? 'Farmer'}</Txt>
                  <Txt variant="labelSm" color={colors.onSurfaceVariant}>
                    {shipment.cropType} · {kg(shipment.quantityKg)} · {shipment.pickup.name}
                  </Txt>
                </View>
                {isRated ? (
                  <MaterialIcons name="check-circle" size={24} color={colors.primary} />
                ) : null}
              </View>

              {isRated ? (
                <Txt variant="bodyMd" color={colors.onSurfaceVariant} style={{ marginTop: space.sm }}>
                  Rated. Thank you — this is what other drivers see.
                </Txt>
              ) : (
                <>
                  <View style={{ alignItems: 'center', paddingVertical: space.md }}>
                    <RatingStars
                      value={value}
                      size={40}
                      onChange={(next) => setStars((prev) => ({ ...prev, [shipment._id]: next }))}
                    />
                    <Txt variant="labelLg" color={colors.onSurfaceVariant} style={{ marginTop: space.sm }}>
                      {WORDS[value]}
                    </Txt>
                  </View>

                  <Field
                    label="Add a comment (optional)"
                    value={comments[shipment._id] ?? ''}
                    onChangeText={(text) =>
                      setComments((prev) => ({ ...prev, [shipment._id]: text }))
                    }
                    placeholder="Was the load ready on time?"
                    multiline
                    numberOfLines={3}
                  />

                  {rowError?.shipmentId === shipment._id ? (
                    <Banner tone="error" style={{ marginBottom: space.gutter }}>
                      <Txt variant="bodyMd" color={colors.onErrorContainer}>
                        {rowError.message}
                      </Txt>
                    </Banner>
                  ) : null}

                  <Button
                    label="Submit rating"
                    icon="star"
                    loading={busy === shipment._id}
                    onPress={() => void submit(shipment._id)}
                  />
                </>
              )}
            </Card>
          );
        })
      )}
    </Screen>
  );
}
