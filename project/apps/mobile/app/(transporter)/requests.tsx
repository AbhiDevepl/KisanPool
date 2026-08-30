/**
 * Transporter · Requests — the load pool.
 *
 * ACCEPTING IS NOT BOOKING. Several transporters may accept the same load; the
 * farmer compares everyone who did and picks one. Only that pick reserves
 * capacity. Every piece of copy and every state on this screen has to keep saying
 * so, because the wording is the only thing standing between a driver and the
 * wrong mental model.
 *
 * A driver may accept as many compatible loads as they like — the accepted total
 * is tracked and shown, but it is never subtracted from available capacity.
 */
import { useCallback, useMemo, useState } from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';
import { api, type PoolEntry } from '../../lib/api';
import { toAppError } from '../../lib/errors';
import { useLoader } from '../../lib/useLoader';
import { acceptedKgFrom, emptyLedger, fits, ledgerFrom } from '../../lib/pooling';
import { kg, km, rupees } from '../../lib/format';
import {
  AppBar,
  Banner,
  Button,
  Card,
  Divider,
  EmptyState,
  Field,
  FilterRow,
  Row,
  Screen,
  SectionHeader,
  Sheet,
  SkeletonList,
  StatusBadge,
  Toast,
  Txt,
} from '../../components/ui';
import { ErrorView } from '../../components/ErrorView';
import { TripMap } from '../../components/TripMap';
import { BottomNav } from '../../components/BottomNav';
import { colors, radius, space } from '../../theme';

type Sort = 'fit' | 'distance' | 'earning';

const SORTS: Array<{ key: Sort; label: string }> = [
  { key: 'fit', label: 'Best match' },
  { key: 'distance', label: 'Nearest' },
  { key: 'earning', label: 'Adds the most' },
];

const compare: Record<Sort, (a: PoolEntry, b: PoolEntry) => number> = {
  fit: (a, b) => b.fitScore - a.fitScore,
  distance: (a, b) => a.pickupDistanceKm - b.pickupDistanceKm,
  earning: (a, b) => b.transporterEarning - a.transporterEarning,
};

/** A fit score turned into words — a driver reads "high match", not "0.87". */
function matchLabel(score: number): { label: string; tone: string } {
  const pct = Math.round(score * 100);
  if (pct >= 85) return { label: 'High match', tone: 'SELECTED' };
  if (pct >= 65) return { label: 'Good match', tone: 'ASSIGNED' };
  return { label: 'Fair match', tone: 'PENDING' };
}

export default function Requests() {
  const router = useRouter();
  const [sort, setSort] = useState<Sort>('fit');
  const [accepting, setAccepting] = useState<PoolEntry | null>(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [goingOnline, setGoingOnline] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [toastTone, setToastTone] = useState<'success' | 'error'>('success');
  /** loads accepted in this session — the row turns into a waiting state, not a booking */
  const [accepted, setAccepted] = useState<string[]>([]);
  const [rowError, setRowError] = useState<{ requestId: string; message: string } | null>(null);

  const pool = useLoader(
    useCallback(async () => {
      const [poolData, vehicle, offers] = await Promise.all([
        api.pool(),
        api.myVehicle(),
        api.myOffers(),
      ]);
      return { pool: poolData, vehicle, offers };
    }, []),
  );

  const vehicle = pool.data?.vehicle ?? null;
  const poolData = pool.data?.pool;
  const offers = pool.data?.offers ?? [];

  const acceptedKg = acceptedKgFrom(offers);
  const ledger = poolData?.trip
    ? ledgerFrom(poolData.trip.capacity, acceptedKg)
    : emptyLedger(vehicle?.capacityKg ?? 0, acceptedKg);

  /** requests this driver has already accepted, from the server not just this session */
  const openOfferIds = useMemo(
    () =>
      new Set(
        offers.filter((offer) => offer.state === 'INTERESTED').map((offer) => String(offer.requestId)),
      ),
    [offers],
  );

  const entries = useMemo(
    () => [...(poolData?.requests ?? [])].sort(compare[sort]),
    [poolData?.requests, sort],
  );

  const goOnline = async (): Promise<void> => {
    if (!vehicle) return;
    setGoingOnline(true);
    try {
      await api.setAvailability(vehicle._id, 'AVAILABLE');
      pool.refresh();
      setToastTone('success');
      setToast("You're online");
    } catch (err) {
      setToastTone('error');
      setToast(toAppError(err).message);
    } finally {
      setGoingOnline(false);
    }
  };

  const accept = async (entry: PoolEntry, note: string): Promise<void> => {
    setBusy(true);
    setRowError(null);
    try {
      await api.claimRequest(entry.request._id, note.trim() || undefined);
      setAccepted((previous) => [...previous, entry.request._id]);
      setAccepting(null);
      setMessage('');
      setToastTone('success');
      setToast('Accepted — the farmer will now compare and decide');
      void pool.reconcile();
    } catch (err) {
      // CAPACITY_EXCEEDED carries the exact kg; show it on the row that failed
      setRowError({ requestId: entry.request._id, message: toAppError(err).message });
      setAccepting(null);
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={{ flex: 1 }}>
      <Screen
        withNav
        refreshing={pool.refreshing}
        onRefresh={pool.refresh}
        header={<AppBar title="Requests" />}
      >
        {pool.loading ? (
          <SkeletonList count={3} />
        ) : pool.error ? (
          <ErrorView error={pool.error} onRetry={pool.refresh} />
        ) : poolData?.offline ? (
          // offline is a choice the driver made, not a failure
          <EmptyState
            icon="cloud-off"
            title="You are offline"
            message="Go online and farmer requests on your route will appear here."
            action={
              <Button
                label="Go online"
                icon="wifi"
                loading={goingOnline}
                disabled={!vehicle}
                onPress={() => void goOnline()}
              />
            }
          />
        ) : (
          <>
            {/* what still fits governs everything below it, so it leads */}
            <Card>
              <View style={{ flexDirection: 'row', alignItems: 'flex-end' }}>
                <View style={{ flex: 1 }}>
                  <Txt variant="labelSm" color={colors.onSurfaceVariant}>
                    Space a farmer could still confirm
                  </Txt>
                  <Txt variant="displayLg" color={colors.primary}>
                    {kg(ledger.availableKg)}
                  </Txt>
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  <Txt variant="labelSm" color={colors.onSurfaceVariant}>
                    of {kg(ledger.totalKg)}
                  </Txt>
                </View>
              </View>

              <Divider />
              <Row label="Confirmed by farmers" value={kg(ledger.confirmedKg)} />
              {ledger.acceptedKg > 0 ? (
                <Row label="Accepted, awaiting decision" value={kg(ledger.acceptedKg)} />
              ) : null}

              {poolData?.trip ? (
                <Txt variant="labelSm" color={colors.onSurfaceVariant} style={{ marginTop: space.xs }}>
                  Your trip is going to {poolData.trip.trip.destination.name} — only loads on that
                  route show here.
                </Txt>
              ) : (
                <Txt variant="labelSm" color={colors.onSurfaceVariant} style={{ marginTop: space.xs }}>
                  Your first confirmed farmer decides where this trip is going.
                </Txt>
              )}
            </Card>

            <Banner tone="info">
              <View style={{ flexDirection: 'row', gap: space.sm }}>
                <MaterialIcons name="info" size={20} color={colors.onInfoContainer} />
                <Txt variant="bodyMd" color={colors.onInfoContainer} style={{ flex: 1 }}>
                  Accepting is not a booking. The farmer sees every driver who accepted and chooses
                  one — accept as many loads as you like.
                </Txt>
              </View>
            </Banner>

            {entries.length > 0 ? (
              <>
                <SectionHeader
                  title={`${entries.length} request${entries.length === 1 ? '' : 's'} nearby`}
                />
                <FilterRow options={SORTS} value={sort} onChange={setSort} style={{ marginBottom: space.sm }} />
              </>
            ) : null}

            {entries.length === 0 ? (
              <EmptyState
                icon="local-shipping"
                title="No loads on your route right now"
                message="Farmers post through the day. We'll notify you the moment one appears near you — you can keep the app closed."
                action={<Button label="Check again" icon="refresh" onPress={pool.refresh} />}
              />
            ) : (
              entries.map((entry) => {
                const { request } = entry;
                const waiting = accepted.includes(request._id) || openOfferIds.has(request._id);
                const tooBig = !fits(ledger, request.quantityKg);
                const match = matchLabel(entry.fitScore);

                return (
                  <Card key={request._id}>
                    <View style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
                      <View style={{ flex: 1 }}>
                        <Txt variant="headlineMd">{request.cropType}</Txt>
                        <Txt variant="labelSm" color={colors.onSurfaceVariant}>
                          {kg(request.quantityKg)} · fills {entry.utilisationPct}% of your vehicle
                        </Txt>
                      </View>
                      <StatusBadge status={match.tone} label={match.label} />
                    </View>

                    <View style={{ marginTop: space.gutter }}>
                      <TripMap
                        pickup={{ ...request.pickup, title: 'Pickup' }}
                        destination={{ ...request.destination, title: request.destination.name }}
                        markerVariant="shop-red"
                        height={130}
                      />
                    </View>

                    <View style={{ marginTop: space.gutter, gap: space.xs }}>
                      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: space.sm }}>
                        <MaterialIcons name="my-location" size={16} color={colors.primary} style={{ marginTop: 2 }} />
                        <View style={{ flex: 1 }}>
                          <Txt variant="bodyMd" numberOfLines={1}>
                            {request.pickup.name}
                          </Txt>
                          {entry.farmerName ? (
                            <Txt variant="labelSm" color={colors.onSurfaceVariant}>
                              Farmer: {entry.farmerName}
                            </Txt>
                          ) : null}
                        </View>
                      </View>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
                        <MaterialIcons name="place" size={16} color={colors.tertiary} />
                        <Txt variant="bodyMd" numberOfLines={1} style={{ flex: 1 }}>
                          {request.destination.name}
                        </Txt>
                      </View>
                    </View>

                    {/* the three numbers a driver decides on */}
                    <View style={s.metrics}>
                      <MetricCell icon="route" label="Distance" value={km(entry.distanceKm)} />
                      <MetricCell icon="scale" label="Load" value={kg(request.quantityKg)} />
                      <MetricCell
                        icon="payments"
                        label="Adds to your pay"
                        value={`+ ${rupees(entry.transporterEarning)}`}
                        highlight
                      />
                    </View>

                    <Divider />
                    <Row label="Pickup is" value={`${km(entry.pickupDistanceKm)} away`} />
                    <Row
                      label="Detour"
                      value={entry.detourKm > 0 ? `+${km(entry.detourKm)}` : 'On your route'}
                    />
                    <Row label="Reaching pickup" value={`~${entry.etaMinutes} min`} />
                    <Row label="Farmer would pay" value={rupees(entry.quotedPrice)} />
                    {/* the honest headline: your whole trip's worth after taking it,
                        not this load's fare counted as if the truck drove twice */}
                    <Row
                      label="Your trip would be worth"
                      value={rupees(entry.tripEarningAfter)}
                      bold
                    />

                    {rowError?.requestId === request._id ? (
                      <Banner tone="error" style={{ marginTop: space.gutter, marginBottom: 0 }}>
                        <Txt variant="labelLg" color={colors.onErrorContainer}>
                          This load will not fit
                        </Txt>
                        <Txt variant="bodyMd" color={colors.onErrorContainer}>
                          {rowError.message}
                        </Txt>
                      </Banner>
                    ) : null}

                    {waiting ? (
                      // accepted — and explicitly NOT a booking
                      <View style={s.waiting}>
                        <MaterialIcons name="hourglass-empty" size={20} color={colors.onWarningContainer} />
                        <View style={{ flex: 1 }}>
                          <Txt variant="labelLg" color={colors.onWarningContainer}>
                            Accepted — awaiting the farmer
                          </Txt>
                          <Txt variant="bodyMd" color={colors.onWarningContainer}>
                            Nothing is reserved yet. They are comparing every driver who accepted.
                          </Txt>
                        </View>
                      </View>
                    ) : tooBig ? (
                      <View style={s.waiting}>
                        <MaterialIcons name="block" size={20} color={colors.onWarningContainer} />
                        <Txt variant="bodyMd" color={colors.onWarningContainer} style={{ flex: 1 }}>
                          {kg(request.quantityKg)} will not fit in your remaining{' '}
                          {kg(ledger.availableKg)}.
                        </Txt>
                      </View>
                    ) : (
                      <Button
                        label="Accept this load"
                        icon="pan-tool-alt"
                        onPress={() => {
                          setMessage('');
                          setRowError(null);
                          setAccepting(entry);
                        }}
                        style={{ marginTop: space.gutter }}
                      />
                    )}
                  </Card>
                );
              })
            )}

            {ledger.acceptedKg > 0 ? (
              <Button
                label="See what I've accepted"
                variant="secondary"
                icon="pan-tool-alt"
                onPress={() => router.push('/(transporter)/trips')}
              />
            ) : null}
          </>
        )}
      </Screen>

      {/* a short note travels with the acceptance and is often what wins the farmer over */}
      <Sheet
        visible={accepting !== null}
        onClose={() => setAccepting(null)}
        title={
          accepting
            ? `Accept ${accepting.request.cropType} · ${kg(accepting.request.quantityKg)}`
            : undefined
        }
        subtitle="The farmer will see your acceptance alongside the others and decide. Nothing is booked, and no space is reserved, until they choose you."
      >
        <Field
          label="Message to the farmer (optional)"
          value={message}
          onChangeText={setMessage}
          placeholder="Passing your village at 7am"
          maxLength={200}
        />
        <View style={{ flexDirection: 'row', gap: space.sm }}>
          <Button
            label="Cancel"
            variant="secondary"
            icon={null}
            onPress={() => setAccepting(null)}
            style={{ flex: 1 }}
          />
          <Button
            label="Send acceptance"
            icon="pan-tool-alt"
            loading={busy}
            onPress={() => accepting && void accept(accepting, message)}
            style={{ flex: 1 }}
          />
        </View>
      </Sheet>

      <Toast message={toast} tone={toastTone} onHide={() => setToast(null)} />
      <BottomNav
        role="transporter"
        active="requests"
        badges={{ trips: offers.filter((offer) => offer.state === 'INTERESTED').length }}
      />
    </View>
  );
}

function MetricCell({
  icon,
  label,
  value,
  highlight = false,
}: {
  icon: keyof typeof MaterialIcons.glyphMap;
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <View style={{ flex: 1, alignItems: 'center', gap: 2 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs }}>
        <MaterialIcons name={icon} size={13} color={colors.onSurfaceVariant} />
        <Txt variant="labelSm" color={colors.onSurfaceVariant}>
          {label}
        </Txt>
      </View>
      <Txt variant="labelLg" color={highlight ? colors.primary : colors.onSurface}>
        {value}
      </Txt>
    </View>
  );
}

const s = {
  metrics: {
    flexDirection: 'row' as const,
    marginTop: space.gutter,
    backgroundColor: colors.surfaceContainerLow,
    borderRadius: radius.md,
    paddingVertical: space.gutter,
  },
  waiting: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: space.sm,
    backgroundColor: colors.warningContainer,
    borderRadius: radius.md,
    padding: space.gutter,
    marginTop: space.gutter,
  },
};
