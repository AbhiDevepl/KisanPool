/**
 * the_pool — open farmer requests that fit this driver's route, and the claim action.
 *
 * A claim is an expression of interest, never a booking: several drivers may claim
 * the same load and the farmer picks one (PROMPT_1 §4). The copy on this screen has
 * to keep saying so, because the old screen's "Accept" made the opposite promise.
 */
import { useCallback, useEffect, useState } from 'react';
import { Modal, View } from 'react-native';
import { useRouter } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';
import type { VehicleDTO } from '@kisanpool/shared';
import { api, type PoolEntry } from '../../../lib/api';
import { toAppError } from '../../../lib/errors';
import { kg, km, rupees } from '../../../lib/format';
import {
  Banner,
  Button,
  Card,
  Divider,
  EmptyState,
  Field,
  Header,
  Loading,
  Row,
  Screen,
  Txt,
} from '../../../components/ui';
import { ErrorView } from '../../../components/ErrorView';
import { TripMap } from '../../../components/TripMap';
import { colors, radius, space } from '../../../theme';

type Pool = Awaited<ReturnType<typeof api.pool>>;

export default function LoadPool() {
  const router = useRouter();
  const [pool, setPool] = useState<Pool | null>(null);
  const [vehicle, setVehicle] = useState<VehicleDTO | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>();
  const [busy, setBusy] = useState(false);
  const [goingOnline, setGoingOnline] = useState(false);
  /** requests already claimed in this session — the row becomes a waiting state */
  const [claimed, setClaimed] = useState<string[]>([]);
  const [claiming, setClaiming] = useState<PoolEntry | null>(null);
  const [message, setMessage] = useState('');
  /** a claim failure belongs next to the load that failed, not over the whole list */
  const [claimError, setClaimError] = useState<{ requestId: string; message: string } | null>(null);

  const load = useCallback(async () => {
    setError(undefined);
    try {
      const [poolData, myVehicle] = await Promise.all([api.pool(), api.myVehicle()]);
      setPool(poolData);
      setVehicle(myVehicle);
    } catch (err) {
      // RESOURCE_NOT_FOUND (no vehicle) and KYC_PENDING_REVIEW both explain themselves
      setError(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const goOnline = async (): Promise<void> => {
    if (!vehicle) return;
    setGoingOnline(true);
    try {
      await api.setAvailability(vehicle._id, 'AVAILABLE');
      await load();
    } catch (err) {
      setError(err);
    } finally {
      setGoingOnline(false);
    }
  };

  const claim = async (entry: PoolEntry, note: string): Promise<void> => {
    setBusy(true);
    setClaimError(null);
    try {
      await api.claimRequest(entry.request._id, note.trim() || undefined);
      setClaimed((prev) => [...prev, entry.request._id]);
      setClaiming(null);
      setMessage('');
    } catch (err) {
      // CAPACITY_EXCEEDED carries the exact kg — show it, never a generic failure
      setClaimError({ requestId: entry.request._id, message: toAppError(err).message });
      setClaiming(null);
    } finally {
      setBusy(false);
    }
  };

  const availableKg = pool?.trip?.capacity.availableKg ?? vehicle?.capacityKg ?? 0;

  return (
    <Screen>
      <Header
        title="Load pool"
        subtitle="Claim what suits your route"
        onBack={() => router.back()}
      />

      {loading ? (
        <Loading label="Looking for loads near you…" />
      ) : error ? (
        <ErrorView error={error} onRetry={() => void load()} />
      ) : pool?.offline ? (
        // the driver chose this — an offline vehicle is a state, not a failure
        <EmptyState
          icon="cloud-off"
          title="You are offline"
          message="Go online and the loads on your route will appear here."
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
          {/* what still fits decides everything below it, so it leads */}
          <Card>
            <Txt variant="labelSm" color={colors.onSurfaceVariant}>
              Space still free
            </Txt>
            <Txt variant="displayLg">{kg(availableKg)}</Txt>
            {pool?.trip ? (
              <>
                <Divider />
                <Row label="Already booked in" value={kg(pool.trip.capacity.committedKg)} />
                <Row label="Total capacity" value={kg(pool.trip.capacity.totalKg)} />
                <Txt
                  variant="labelSm"
                  color={colors.onSurfaceVariant}
                  style={{ marginTop: space.xs }}
                >
                  Your trip is going to {pool.trip.trip.destination.name} — only loads on that route
                  show here.
                </Txt>
              </>
            ) : (
              <Txt variant="labelSm" color={colors.onSurfaceVariant}>
                Your first claim of the day decides where this trip is going.
              </Txt>
            )}
          </Card>

          <Banner tone="info">
            <View style={{ flexDirection: 'row', gap: space.sm }}>
              <MaterialIcons name="info" size={20} color={colors.onInfoContainer} />
              <Txt variant="bodyMd" color={colors.onInfoContainer} style={{ flex: 1 }}>
                Claiming is not a booking. The farmer sees every driver who claimed and chooses one
                — you can claim as many loads as you like.
              </Txt>
            </View>
          </Banner>

          {pool && pool.requests.length === 0 ? (
            <EmptyState
              icon="local-shipping"
              title="No loads right now"
              message="We will notify you when a farmer near your route needs space."
              action={<Button label="Check again" icon="refresh" onPress={() => void load()} />}
            />
          ) : null}

          {pool?.requests.map((entry) => {
            const { request } = entry;
            const waiting = claimed.includes(request._id);

            return (
              <Card key={request._id}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <View style={{ flex: 1 }}>
                    <Txt variant="headlineMd">{request.cropType}</Txt>
                    <Txt variant="labelSm" color={colors.onSurfaceVariant}>
                      {kg(request.quantityKg)} · fills {entry.utilisationPct}% of your vehicle
                    </Txt>
                  </View>
                  <Txt variant="labelLg" color={colors.primary}>
                    {rupees(entry.transporterEarning)}
                  </Txt>
                </View>

                <View style={{ marginTop: space.gutter }}>
                  <TripMap
                    pickup={{ ...request.pickup, title: 'Pickup' }}
                    destination={{ ...request.destination, title: request.destination.name }}
                    height={140}
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
                    {request.pickup.name}
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
                    {request.destination.name}
                  </Txt>
                </View>

                <Divider />
                <Row label="Pickup is" value={`${km(entry.pickupDistanceKm)} away`} />
                <Row
                  label="Detour"
                  value={
                    entry.detourKm > 0 ? `+${km(entry.detourKm)} off your route` : 'On your route'
                  }
                />
                <Row label="Reaching pickup" value={`~${entry.etaMinutes} min`} />
                <Row label="You earn" value={rupees(entry.transporterEarning)} bold />

                {claimError?.requestId === request._id ? (
                  <Banner tone="error" style={{ marginTop: space.gutter, marginBottom: 0 }}>
                    <Txt variant="labelLg" color={colors.onErrorContainer}>
                      This load will not fit right now
                    </Txt>
                    <Txt variant="bodyMd" color={colors.onErrorContainer}>
                      {claimError.message}
                    </Txt>
                  </Banner>
                ) : null}

                {waiting ? (
                  <Banner tone="primary" style={{ marginTop: space.gutter, marginBottom: 0 }}>
                    <View style={{ flexDirection: 'row', gap: space.sm, alignItems: 'center' }}>
                      <MaterialIcons name="hourglass-empty" size={20} color={colors.onPrimary} />
                      <View style={{ flex: 1 }}>
                        <Txt variant="labelLg" color={colors.onPrimary}>
                          Claimed — waiting for the farmer
                        </Txt>
                        <Txt variant="bodyMd" color={colors.onPrimary}>
                          They are comparing every driver who claimed this load.
                        </Txt>
                      </View>
                    </View>
                  </Banner>
                ) : (
                  <Button
                    label="Claim this load"
                    icon="pan-tool-alt"
                    onPress={() => {
                      setMessage('');
                      setClaimError(null);
                      setClaiming(entry);
                    }}
                    style={{ marginTop: space.gutter }}
                  />
                )}
              </Card>
            );
          })}

          {claimed.length > 0 ? (
            <Button
              label="See my claims"
              variant="secondary"
              icon="pan-tool-alt"
              onPress={() => router.push('/(transporter)/offers')}
            />
          ) : null}
        </>
      )}

      {/* a short note travels with the claim and is often what wins the farmer over */}
      <Modal
        visible={claiming !== null}
        transparent
        animationType="slide"
        onRequestClose={() => setClaiming(null)}
      >
        <View style={{ flex: 1, backgroundColor: 'rgba(25,28,27,0.4)', justifyContent: 'flex-end' }}>
          <View
            style={{
              backgroundColor: colors.background,
              borderTopLeftRadius: radius.xl,
              borderTopRightRadius: radius.xl,
              padding: space.md,
              paddingBottom: space.xl,
            }}
          >
            <Txt variant="headlineMd">
              Claim {claiming?.request.cropType} · {kg(claiming?.request.quantityKg ?? 0)}
            </Txt>
            <Txt variant="bodyMd" color={colors.onSurfaceVariant} style={{ marginBottom: space.md }}>
              The farmer will see your claim alongside the others and decide. Nothing is booked
              until they choose you.
            </Txt>

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
                onPress={() => setClaiming(null)}
                style={{ flex: 1 }}
              />
              <Button
                label="Send my claim"
                icon="pan-tool-alt"
                loading={busy}
                onPress={() => claiming && void claim(claiming, message)}
                style={{ flex: 1 }}
              />
            </View>
          </View>
        </View>
      </Modal>
    </Screen>
  );
}
