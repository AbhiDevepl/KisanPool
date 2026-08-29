/**
 * F4 · Smart Pool Match — the transporters who ACCEPTED this request.
 *
 * The decision point of the whole app, and the screen where the pooling model is
 * easiest to get wrong. Every one of these transporters has accepted; none of
 * them is booked; none of them has reserved a gram of capacity. Choosing is what
 * creates the booking — so the header says so, each card is labelled "Accepted",
 * and the CTA is "Confirm", never "Book" or "Accept".
 *
 * Deliberate divergence from the Stitch export: it shows a fixed "Farmer share
 * 60% / Transporter share 40%" split, which the pricing model replaced (ADR-031)
 * with a route cost shared by weight across everyone aboard. Showing the old
 * split would be a made-up number, so the breakdown here is the real one — your
 * share, what going alone would cost, and what the pool saves you.
 */
import { useCallback, useState } from 'react';
import { View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';
import type {
  OfferReceivedEvent,
  OfferWithdrawnEvent,
  TransporterOfferDTO,
} from '@kisanpool/shared';
import { api } from '../../../../lib/api';
import { toAppError } from '../../../../lib/errors';
import { useSocket } from '../../../../lib/socket';
import { useLoader } from '../../../../lib/useLoader';
import { offerMatchScore } from '../../../../lib/pooling';
import { kg, km, rupees } from '../../../../lib/format';
import {
  Banner,
  Button,
  Card,
  ConfirmDialog,
  Divider,
  EmptyState,
  FilterRow,
  Header,
  ProgressTrack,
  RatingStars,
  Row,
  Screen,
  SkeletonList,
  StatusBadge,
  Txt,
} from '../../../../components/ui';
import { ErrorView } from '../../../../components/ErrorView';
import { colors, radius, space } from '../../../../theme';

type SortKey = 'match' | 'cheapest' | 'rated' | 'nearest';

const SORTS: Array<{ key: SortKey; label: string }> = [
  { key: 'match', label: 'Best match' },
  { key: 'cheapest', label: 'Cheapest' },
  { key: 'rated', label: 'Best rated' },
  { key: 'nearest', label: 'Nearest' },
];

const compare: Record<SortKey, (a: TransporterOfferDTO, b: TransporterOfferDTO) => number> = {
  match: (a, b) => offerMatchScore(b) - offerMatchScore(a),
  cheapest: (a, b) => a.quotedPrice - b.quotedPrice,
  rated: (a, b) => (b.transporter?.ratingAvg ?? 0) - (a.transporter?.ratingAvg ?? 0),
  nearest: (a, b) => a.pickupDistanceKm - b.pickupDistanceKm,
};

export default function SmartPoolMatch() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();

  const [offers, setOffers] = useState<TransporterOfferDTO[]>([]);
  const [sort, setSort] = useState<SortKey>('match');
  const [confirming, setConfirming] = useState<TransporterOfferDTO | null>(null);
  const [selecting, setSelecting] = useState<string | null>(null);
  const [selectError, setSelectError] = useState<unknown>();

  const detail = useLoader(
    useCallback(async () => {
      const [request, claims] = await Promise.all([api.getRequest(id), api.offersFor(id)]);
      // already confirmed — there is nothing left to compare, the trip is the screen
      if (request.trip) {
        router.replace(`/(farmer)/trips/${request.trip._id}`);
      }
      setOffers(claims);
      return request;
    }, [id, router]),
  );

  // acceptances arrive while the farmer is looking — no refresh, no refetch
  useSocket(
    { type: 'request', id },
    {
      'offer:received': (payload: OfferReceivedEvent) =>
        setOffers((prev) => [...prev.filter((o) => o._id !== payload.offer._id), payload.offer]),
      'offer:withdrawn': (payload: OfferWithdrawnEvent) =>
        setOffers((prev) => prev.filter((o) => o._id !== payload.offerId)),
    },
  );

  const confirm = async (offer: TransporterOfferDTO): Promise<void> => {
    setSelecting(offer._id);
    setSelectError(undefined);
    try {
      const result = await api.selectTransporter(id, offer._id);
      setConfirming(null);
      router.replace(`/(farmer)/trips/${result.trip._id}`);
    } catch (err) {
      setSelectError(err);
      setConfirming(null);
      // the list the farmer just chose from is stale the moment a select fails
      detail.refresh();
    } finally {
      setSelecting(null);
    }
  };

  const request = detail.data?.request;
  const appError = selectError ? toAppError(selectError) : null;
  const lostRace = appError?.code === 'CONCURRENT_BOOKING' || appError?.code === 'CAPACITY_EXCEEDED';
  const sorted = [...offers].sort(compare[sort]);

  return (
    <View style={{ flex: 1 }}>
      <Screen
        refreshing={detail.refreshing}
        onRefresh={detail.refresh}
        header={
          <View style={{ paddingHorizontal: space.md }}>
            <Header
              title="Smart pool match"
              subtitle={
                request
                  ? `${request.cropType} · ${kg(request.quantityKg)} → ${request.destination.name}`
                  : undefined
              }
              onBack={() => router.back()}
            />
          </View>
        }
      >
        {/* another farmer took the last space while this one was deciding */}
        {lostRace ? (
          <Banner tone="error">
            <Txt variant="headlineMd" color={colors.onErrorContainer}>
              That vehicle filled up
            </Txt>
            <Txt variant="bodyMd" color={colors.onErrorContainer} style={{ marginTop: space.xs }}>
              Another farmer confirmed the last space while you were choosing. Nothing was charged —
              the list below is up to date, please pick someone else.
            </Txt>
          </Banner>
        ) : appError ? (
          <ErrorView error={selectError} onRetry={detail.refresh} />
        ) : null}

        {detail.loading ? (
          <SkeletonList count={2} />
        ) : detail.error ? (
          <ErrorView error={detail.error} onRetry={detail.refresh} />
        ) : offers.length === 0 ? (
          <EmptyState
            icon="hourglass-empty"
            title="No transporter has accepted yet"
            message="Your request is in the pool and verified drivers nearby can see it. We'll notify you the moment someone accepts — you can close the app."
            action={<Button label="Check again" icon="refresh" onPress={detail.refresh} />}
          />
        ) : (
          <>
            {/* the state this screen exists to communicate */}
            <Banner tone="primary">
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.gutter }}>
                <MaterialIcons name="how-to-reg" size={28} color={colors.onPrimary} />
                <View style={{ flex: 1 }}>
                  <Txt variant="headlineMd" color={colors.onPrimary}>
                    {offers.length} transporter{offers.length === 1 ? '' : 's'} accepted
                  </Txt>
                  <Txt variant="labelSm" color={colors.onPrimaryContainer}>
                    Awaiting your confirmation — nothing is booked until you choose one.
                  </Txt>
                </View>
              </View>
            </Banner>

            <FilterRow
              options={SORTS}
              value={sort}
              onChange={setSort}
              style={{ marginBottom: space.sm }}
            />

            {sorted.map((offer, index) => {
              const best = sort === 'match' && index === 0;
              const score = offerMatchScore(offer);
              const vehicle = offer.vehicle;
              const freePct = vehicle?.capacityKg
                ? (vehicle.remainingCapacityKg / vehicle.capacityKg) * 100
                : 0;

              return (
                <Card
                  key={offer._id}
                  style={best ? { borderColor: colors.primary, borderWidth: 2 } : undefined}
                >
                  {/* rank */}
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
                    <View style={[s.rank, best ? { backgroundColor: colors.primary } : null]}>
                      <Txt
                        variant="labelLg"
                        color={best ? colors.onPrimary : colors.onSurfaceVariant}
                      >
                        {String(index + 1)}
                      </Txt>
                    </View>
                    {best ? <StatusBadge status="SELECTED" label="Best match" /> : null}
                    <View style={{ flex: 1 }} />
                    <StatusBadge status="PENDING" label="Accepted" />
                  </View>

                  {/* driver */}
                  <View style={{ flexDirection: 'row', alignItems: 'flex-start', marginTop: space.gutter }}>
                    <View style={{ flex: 1 }}>
                      <Txt variant="headlineMd">{offer.transporter?.name ?? 'Transporter'}</Txt>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
                        <RatingStars value={offer.transporter?.ratingAvg ?? 0} />
                        <Txt variant="labelSm" color={colors.onSurfaceVariant}>
                          {(offer.transporter?.ratingAvg ?? 0).toFixed(1)} (
                          {offer.transporter?.ratingCount ?? 0} trips)
                        </Txt>
                      </View>
                      <Txt variant="labelSm" color={colors.onSurfaceVariant} style={{ marginTop: 2 }}>
                        {vehicle?.registrationNumber ?? '—'} · {vehicle?.vehicleType ?? '—'}
                      </Txt>
                    </View>
                    <View style={{ alignItems: 'center' }}>
                      <View style={s.scoreRing}>
                        <Txt variant="labelLg" color={colors.primary}>
                          {score}%
                        </Txt>
                      </View>
                      <Txt variant="labelSm" color={colors.onSurfaceVariant}>
                        Match
                      </Txt>
                    </View>
                  </View>

                  {/* what is free on that vehicle right now */}
                  <View style={{ marginTop: space.gutter }}>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                      <Txt variant="labelSm" color={colors.onSurfaceVariant}>
                        Space available
                      </Txt>
                      <Txt variant="labelSm" color={colors.onSurfaceVariant}>
                        {kg(vehicle?.remainingCapacityKg ?? 0)} of {kg(vehicle?.capacityKg ?? 0)}
                      </Txt>
                    </View>
                    <ProgressTrack pct={freePct} height={8} />
                  </View>

                  {/* the saving is the headline — it is why pooling exists */}
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
                        : 'You would be first aboard — the price falls further as others join'}
                    </Txt>
                  </View>

                  <Divider />
                  <Row label="Your share" value={rupees(offer.quotedPrice)} bold />
                  <Row label="Going alone would cost" value={rupees(offer.soloPrice)} />
                  <Row
                    label="Pooling saves you"
                    value={rupees(Math.max(offer.soloPrice - offer.quotedPrice, 0))}
                  />
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
                    label={`Confirm ${offer.transporter?.name?.split(' ')[0] ?? 'this driver'}`}
                    icon="check"
                    loading={selecting === offer._id}
                    disabled={selecting !== null && selecting !== offer._id}
                    onPress={() => setConfirming(offer)}
                    style={{ marginTop: space.gutter }}
                  />
                </Card>
              );
            })}

            <View style={{ flexDirection: 'row', gap: space.sm, alignItems: 'flex-start' }}>
              <MaterialIcons name="info" size={18} color={colors.onSurfaceVariant} />
              <Txt variant="labelSm" color={colors.onSurfaceVariant} style={{ flex: 1 }}>
                Confirming is free — you pay only after your produce is delivered, and your share
                can still fall if more farmers join the same vehicle.
              </Txt>
            </View>
          </>
        )}
      </Screen>

      {/* the moment a booking is actually created — worth a confirmation step */}
      <ConfirmDialog
        visible={confirming !== null}
        title={`Confirm ${confirming?.transporter?.name ?? 'this transporter'}?`}
        message={
          confirming
            ? `This books your ${request?.cropType ?? 'load'} onto their vehicle and reserves ${kg(
                request?.quantityKg ?? 0,
              )} of space. Your share is ${rupees(confirming.quotedPrice)}, payable after delivery. The other transporters will be told you chose someone else.`
            : undefined
        }
        confirmLabel="Confirm booking"
        busy={selecting !== null}
        onCancel={() => setConfirming(null)}
        onConfirm={() => confirming && void confirm(confirming)}
      />
    </View>
  );
}

const s = {
  rank: {
    width: 28,
    height: 28,
    borderRadius: radius.full,
    backgroundColor: colors.surfaceContainerHigh,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  scoreRing: {
    width: 52,
    height: 52,
    borderRadius: radius.full,
    borderWidth: 3,
    borderColor: colors.secondaryContainer,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
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
