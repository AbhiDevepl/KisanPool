/**
 * The comparison screen — every transporter who has claimed this request.
 *
 * This is the decision point of the whole app: selecting is free, reserves the
 * capacity and puts the farmer on a shared trip. The headline on each card is the
 * saving against going alone, because that is the reason to pool at all.
 */
import { useCallback, useEffect, useState } from 'react';
import { View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';
import type {
  OfferReceivedEvent,
  OfferWithdrawnEvent,
  TransporterOfferDTO,
  TransportRequestDTO,
} from '@kisanpool/shared';
import { api } from '../../../../lib/api';
import { toAppError } from '../../../../lib/errors';
import { useSocket } from '../../../../lib/socket';
import { kg, km, rupees } from '../../../../lib/format';
import {
  Banner,
  Button,
  Card,
  Chip,
  Divider,
  EmptyState,
  Header,
  Loading,
  RatingStars,
  Row,
  Screen,
  Txt,
} from '../../../../components/ui';
import { ErrorView } from '../../../../components/ErrorView';
import { colors, radius, space } from '../../../../theme';

type SortKey = 'cheapest' | 'rated' | 'nearest';

const SORTS: Array<{ key: SortKey; label: string }> = [
  { key: 'cheapest', label: 'Cheapest' },
  { key: 'rated', label: 'Best rated' },
  { key: 'nearest', label: 'Nearest' },
];

const compare: Record<SortKey, (a: TransporterOfferDTO, b: TransporterOfferDTO) => number> = {
  cheapest: (a, b) => a.quotedPrice - b.quotedPrice,
  rated: (a, b) => (b.transporter?.ratingAvg ?? 0) - (a.transporter?.ratingAvg ?? 0),
  nearest: (a, b) => a.pickupDistanceKm - b.pickupDistanceKm,
};

export default function Offers() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();

  const [offers, setOffers] = useState<TransporterOfferDTO[]>([]);
  const [request, setRequest] = useState<TransportRequestDTO | null>(null);
  const [sort, setSort] = useState<SortKey>('cheapest');
  const [loading, setLoading] = useState(true);
  const [selecting, setSelecting] = useState<string | null>(null);
  const [error, setError] = useState<unknown>();

  const load = useCallback(async () => {
    setError(undefined);
    try {
      const [detail, claims] = await Promise.all([api.getRequest(id), api.offersFor(id)]);

      // already chosen — there is nothing left to compare, the trip is the screen
      if (detail.trip) {
        router.replace(`/(farmer)/trips/${detail.trip._id}`);
        return;
      }

      setRequest(detail.request);
      setOffers(claims);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, [id, router]);

  useEffect(() => {
    void load();
  }, [load]);

  // claims arrive while the farmer is looking at the list — no refresh, no refetch
  useSocket(
    { type: 'request', id },
    {
      'offer:received': (payload: OfferReceivedEvent) => {
        setOffers((prev) => [...prev.filter((o) => o._id !== payload.offer._id), payload.offer]);
      },
      'offer:withdrawn': (payload: OfferWithdrawnEvent) => {
        setOffers((prev) => prev.filter((o) => o._id !== payload.offerId));
      },
    },
  );

  const select = async (offer: TransporterOfferDTO): Promise<void> => {
    setSelecting(offer._id);
    setError(undefined);
    try {
      const result = await api.selectTransporter(id, offer._id);
      router.replace(`/(farmer)/trips/${result.trip._id}`);
    } catch (err) {
      setError(err);
      // the list the farmer just chose from is stale the moment a select fails
      await load();
    } finally {
      setSelecting(null);
    }
  };

  const appError = error ? toAppError(error) : null;
  const lostRace = appError?.code === 'CONCURRENT_BOOKING' || appError?.code === 'CAPACITY_EXCEEDED';
  const sorted = [...offers].sort(compare[sort]);

  return (
    <Screen>
      <Header
        title="Who will carry it"
        subtitle={
          request ? `${request.cropType} · ${kg(request.quantityKg)} · ${request.destination.name}` : undefined
        }
        onBack={() => router.back()}
      />

      {lostRace ? (
        <Banner tone="error">
          <Txt variant="headlineMd" color={colors.onErrorContainer}>
            That vehicle filled up
          </Txt>
          <Txt variant="bodyMd" color={colors.onErrorContainer} style={{ marginTop: space.xs }}>
            Another farmer took the last space while you were choosing. Nothing was charged — the
            list below is up to date, please pick someone else.
          </Txt>
        </Banner>
      ) : appError && offers.length > 0 ? (
        <ErrorView error={error} onRetry={() => void load()} />
      ) : null}

      {loading ? (
        <Loading label="Checking who has claimed your load…" />
      ) : appError && offers.length === 0 && !lostRace ? (
        <ErrorView error={error} onRetry={() => void load()} />
      ) : offers.length === 0 ? (
        <EmptyState
          icon="hourglass-empty"
          title="No transporter has claimed this yet"
          message="Your request is in the pool and nearby drivers can see it. We'll notify you the moment someone claims it."
          action={<Button label="Check again" icon="refresh" onPress={() => void load()} />}
        />
      ) : (
        <>
          <View style={{ flexDirection: 'row', gap: space.sm, marginBottom: space.md }}>
            {SORTS.map((option) => (
              <Chip
                key={option.key}
                label={option.label}
                selected={sort === option.key}
                onPress={() => setSort(option.key)}
              />
            ))}
          </View>

          {sorted.map((offer) => (
            <Card key={offer._id}>
              <View style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
                <View style={{ flex: 1 }}>
                  <Txt variant="headlineMd">{offer.transporter?.name ?? 'Transporter'}</Txt>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
                    <RatingStars value={offer.transporter?.ratingAvg ?? 0} />
                    <Txt variant="labelSm" color={colors.onSurfaceVariant}>
                      {(offer.transporter?.ratingAvg ?? 0).toFixed(1)} (
                      {offer.transporter?.ratingCount ?? 0} trips)
                    </Txt>
                  </View>
                  <Txt
                    variant="labelSm"
                    color={colors.onSurfaceVariant}
                    style={{ marginTop: space.xs }}
                  >
                    {offer.vehicle?.registrationNumber ?? '—'} · {offer.vehicle?.vehicleType ?? '—'}{' '}
                    · {kg(offer.vehicle?.remainingCapacityKg ?? 0)} free
                  </Txt>
                </View>
              </View>

              {/* the saving is the headline, not a footnote — it is why pooling exists */}
              <View style={s.priceBlock}>
                <Txt variant="labelLg" color={colors.onPrimaryContainer}>
                  You save {offer.savingPct}%
                </Txt>
                <View
                  style={{ flexDirection: 'row', alignItems: 'baseline', gap: space.sm, marginTop: space.xs }}
                >
                  <Txt variant="displayLg" color={colors.onPrimary}>
                    {rupees(offer.quotedPrice)}
                  </Txt>
                  <Txt
                    variant="bodyLg"
                    color={colors.onPrimaryContainer}
                    style={{ textDecorationLine: 'line-through' }}
                  >
                    {rupees(offer.soloPrice)}
                  </Txt>
                </View>
                <Txt variant="labelSm" color={colors.onPrimaryContainer}>
                  {offer.poolSize > 0
                    ? `Joining ${offer.poolSize} other farmer${offer.poolSize > 1 ? 's' : ''} on this vehicle`
                    : 'You would be the first aboard — the price falls further as others join'}
                </Txt>
              </View>

              <Divider />

              <Row label="Distance to your farm" value={km(offer.pickupDistanceKm)} />
              <Row label="Reaches you in" value={`${offer.etaMinutes} min`} />
              <Row label="Extra detour for you" value={km(offer.detourKm)} />

              {offer.message ? (
                <View style={s.message}>
                  <MaterialIcons name="format-quote" size={18} color={colors.onSurfaceVariant} />
                  <Txt variant="bodyMd" color={colors.onSurfaceVariant} style={{ flex: 1 }}>
                    {offer.message}
                  </Txt>
                </View>
              ) : null}

              <Button
                label={`Choose ${offer.transporter?.name?.split(' ')[0] ?? 'this driver'}`}
                icon="check"
                loading={selecting === offer._id}
                disabled={selecting !== null && selecting !== offer._id}
                onPress={() => void select(offer)}
                style={{ marginTop: space.gutter }}
              />
            </Card>
          ))}

          <View style={{ flexDirection: 'row', gap: space.sm, alignItems: 'flex-start' }}>
            <MaterialIcons name="info" size={18} color={colors.onSurfaceVariant} />
            <Txt variant="labelSm" color={colors.onSurfaceVariant} style={{ flex: 1 }}>
              Choosing is free — you pay only after your produce is delivered, and the price can
              still fall if more farmers join the same vehicle.
            </Txt>
          </View>
        </>
      )}
    </Screen>
  );
}

const s = {
  priceBlock: {
    marginTop: space.gutter,
    backgroundColor: colors.primaryContainer,
    borderRadius: radius.lg,
    padding: space.gutter,
  },
  message: {
    flexDirection: 'row' as const,
    gap: space.sm,
    alignItems: 'flex-start' as const,
    marginTop: space.gutter,
    backgroundColor: colors.surfaceContainer,
    borderRadius: radius.md,
    padding: space.gutter,
  },
};
