/**
 * Return journey — the second half of the trip.
 *
 * The driver has just dropped the farmers' produce at the mandi and is about to
 * drive 220 km home with an empty vehicle. Everything on this screen is aimed at
 * one decision: is any of this worth stopping for?
 *
 * So it never leads with the fare. Each row shows what the load ADDS — kilometres,
 * minutes, weight — beside what it pays, because a ₹900 load that costs 40 km of
 * detour is a worse deal than a ₹600 one on the way, and a screen that showed only
 * the money would hide exactly that. "Free return" is never said, because it is
 * not free: it is cheap, and the reason it is cheap is that the journey is already
 * happening.
 */
import { useCallback, useState } from 'react';
import { Linking, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';
import type { BackhaulMatchDTO } from '@kisanpool/shared';
import { api } from '../../../../lib/api';
import { toAppError } from '../../../../lib/errors';
import { useSocket } from '../../../../lib/socket';
import { useLoader } from '../../../../lib/useLoader';
import { kg, km, rupees } from '../../../../lib/format';
import {
  BACKHAUL_COPY,
  BACKHAUL_NEXT,
  CARGO_ICON,
  CARGO_LABEL,
  RETURN_LEG_COPY,
} from '../../../../lib/machinery';
import {
  Banner,
  Button,
  Card,
  ConfirmDialog,
  Divider,
  EmptyState,
  Field,
  Header,
  IconBadge,
  Metric,
  ProgressTrack,
  Row,
  Screen,
  SectionHeader,
  Sheet,
  SkeletonList,
  StatusBadge,
  Toast,
  Txt,
} from '../../../../components/ui';
import { ErrorView } from '../../../../components/ErrorView';
import { ReturnLoadCard } from '../../../../components/ReturnLoadCard';
import { colors, radius, space } from '../../../../theme';

export default function ReturnJourney() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();

  const [accepting, setAccepting] = useState<BackhaulMatchDTO | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [otpFor, setOtpFor] = useState<{ _id: string; requester?: { name: string } } | null>(null);
  const [otp, setOtp] = useState('');
  const [otpError, setOtpError] = useState<string>();
  const [toast, setToast] = useState<string | null>(null);
  const [toastTone, setToastTone] = useState<'success' | 'error'>('success');

  const data = useLoader(
    useCallback(async () => {
      const [loads, leg] = await Promise.all([api.returnLoads(id), api.returnLeg(id)]);
      return { loads, leg };
    }, [id]),
  );

  // a load taken by another driver disappears from under this one; reconcile quietly
  useSocket({ type: 'trip', id }, { 'backhaul:booked': () => void data.reconcile() });

  const loads = data.data?.loads;
  const leg = data.data?.leg;
  const matches = loads?.matches ?? [];
  const booked = leg?.bookings ?? [];
  const utilisation = leg?.utilisation ?? null;
  const capacity = loads?.capacity ?? leg?.capacity ?? null;
  const legState = leg?.returnLeg?.state ?? 'NONE';

  const openLeg = async (): Promise<void> => {
    setBusy('open');
    try {
      await api.openReturnLeg(id);
      setToastTone('success');
      setToast('Return journey opened — here is what is going your way');
      data.refresh();
    } catch (err) {
      setToastTone('error');
      setToast(toAppError(err).message);
    } finally {
      setBusy(null);
    }
  };

  const accept = async (match: BackhaulMatchDTO): Promise<void> => {
    setBusy(match.request._id);
    try {
      const result = await api.acceptReturnLoad(id, match.request._id);
      setAccepting(null);
      setToastTone('success');
      setToast(`Booked — ${rupees(result.quote.transporterEarning)} on the way home`);
      data.refresh();
    } catch (err) {
      setAccepting(null);
      setToastTone('error');
      // CONCURRENT_BOOKING means another driver took it while this one read the card
      setToast(toAppError(err).message);
      data.refresh();
    } finally {
      setBusy(null);
    }
  };

  const advance = async (bookingId: string, state: string, code?: string): Promise<void> => {
    setBusy(bookingId);
    setOtpError(undefined);
    try {
      await api.setReturnLoadState(bookingId, state, code);
      setOtpFor(null);
      setOtp('');
      data.refresh();
    } catch (err) {
      const appError = toAppError(err);
      if (state === 'PICKED_UP' && appError.code === 'VALIDATION_ERROR') {
        setOtpError('That code is not correct. Ask the sender to read it again.');
      } else {
        setOtpFor(null);
        setToastTone('error');
        setToast(appError.message);
      }
    } finally {
      setBusy(null);
    }
  };

  return (
    <View style={{ flex: 1 }}>
      <Screen
        refreshing={data.refreshing}
        onRefresh={data.refresh}
        footer={
          legState === 'LOADING' && booked.every((b) => b.state !== 'BOOKED') ? (
            <Button
              label="Set off for home"
              icon="navigation"
              onPress={() => void api.setReturnLegState(id, 'IN_TRANSIT').then(() => data.refresh())}
            />
          ) : legState === 'IN_TRANSIT' && booked.every((b) => b.state === 'DELIVERED') ? (
            <Button
              label="Finish the return journey"
              icon="check-circle"
              onPress={() => void api.setReturnLegState(id, 'COMPLETED').then(() => data.refresh())}
            />
          ) : null
        }
      >
        <Header
          title="Return journey"
          subtitle={
            leg?.returnLeg?.origin
              ? `${loads?.leg?.from.name ?? 'Mandi'} → ${leg.returnLeg.origin.name}`
              : 'The way home'
          }
          onBack={() => router.back()}
          right={
            <StatusBadge
              status={RETURN_LEG_COPY[legState].badge}
              label={RETURN_LEG_COPY[legState].label}
            />
          }
        />

        {data.loading ? (
          <SkeletonList count={3} />
        ) : data.error ? (
          <ErrorView error={data.error} onRetry={data.refresh} />
        ) : legState === 'NONE' ? (
          // the gate that protects the farmers' trip
          <EmptyState
            icon="u-turn-left"
            title="Deliver the produce first"
            message="The return journey opens once every farmer's load is off the vehicle. Their trip always comes first — nothing you take home can get in its way."
            action={
              <Button
                label="Open the return journey"
                icon="u-turn-left"
                loading={busy === 'open'}
                onPress={() => void openLeg()}
              />
            }
          />
        ) : (
          <>
            {/* the empty run this is recovering — the whole premise, in one card */}
            <Card
              style={{
                backgroundColor: colors.primaryContainer,
                borderColor: colors.primaryContainer,
                borderRadius: radius.xl,
              }}
            >
              <Txt variant="bodyMd" color={colors.onPrimaryContainer}>
                You are driving home anyway
              </Txt>
              <Txt variant="displayLg" color={colors.onPrimary}>
                {km(loads?.leg?.emptyReturnKm ?? leg?.returnLeg?.emptyReturnKm ?? 0)}
              </Txt>
              <Txt variant="labelSm" color={colors.onPrimaryContainer}>
                That is the run you would make empty. Anything you carry on it is earning you
                would not otherwise have.
              </Txt>

              {capacity ? (
                <>
                  <Divider />
                  <View style={{ flexDirection: 'row', gap: space.md }}>
                    <Metric label="Space free" value={kg(capacity.availableKg)} tone="onPrimary" />
                    <Metric label="Booked back" value={kg(capacity.bookedKg)} tone="onPrimary" />
                    {utilisation ? (
                      <Metric
                        label="Return earning"
                        value={rupees(utilisation.returnEarning)}
                        tone="onPrimary"
                      />
                    ) : null}
                  </View>
                </>
              ) : null}
            </Card>

            {/* the round trip, both legs — what the feature is actually worth */}
            {utilisation && utilisation.returnEarning > 0 ? (
              <Card>
                <Txt variant="labelLg">This journey, both ways</Txt>
                <Divider />
                <Row label="Out to the mandi" value={`${km(utilisation.outboundKm)} · ${rupees(utilisation.outboundEarning)}`} />
                <Row label="Back home" value={`${km(utilisation.returnKm)} · ${rupees(utilisation.returnEarning)}`} />
                <Row label="Total earned" value={rupees(utilisation.totalEarning)} bold />
                <View style={{ marginTop: space.gutter }}>
                  <ProgressTrack pct={utilisation.utilisationPct} height={10} />
                  <Txt variant="labelSm" color={colors.onSurfaceVariant} style={{ marginTop: space.xs }}>
                    {utilisation.utilisationPct}% of {km(utilisation.totalKm)} driven with something
                    aboard · {km(utilisation.emptyKmRecovered)} that would have been empty
                  </Txt>
                </View>
              </Card>
            ) : null}

            {/* what is already booked onto the leg */}
            {booked.length > 0 ? (
              <>
                <SectionHeader title={`${booked.length} return load${booked.length === 1 ? '' : 's'} aboard`} />
                {booked.map((booking) => {
                  const copy = BACKHAUL_COPY[booking.state];
                  const next = BACKHAUL_NEXT[booking.state];
                  return (
                    <Card key={booking._id}>
                      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: space.gutter }}>
                        <IconBadge icon={CARGO_ICON[booking.cargoCategory]} />
                        <View style={{ flex: 1 }}>
                          <Txt variant="labelLg">{CARGO_LABEL[booking.cargoCategory]}</Txt>
                          <Txt variant="labelSm" color={colors.onSurfaceVariant}>
                            {kg(booking.weightKg)} · {booking.requester?.name ?? 'Sender'}
                          </Txt>
                        </View>
                        <StatusBadge status={copy.badge} label={copy.label} />
                      </View>

                      <View style={{ marginTop: space.gutter, gap: space.xs }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
                          <MaterialIcons name="my-location" size={15} color={colors.primary} />
                          <Txt variant="bodyMd" numberOfLines={1} style={{ flex: 1 }}>
                            {booking.pickup.name}
                          </Txt>
                        </View>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
                          <MaterialIcons name="place" size={15} color={colors.tertiary} />
                          <Txt variant="bodyMd" numberOfLines={1} style={{ flex: 1 }}>
                            {booking.destination.name}
                          </Txt>
                        </View>
                      </View>

                      <Divider />
                      <Row label="You earn" value={rupees(booking.transporterEarning)} bold />
                      <Row label="Added to your route" value={km(booking.detourKm)} />

                      <View style={{ flexDirection: 'row', gap: space.sm, marginTop: space.gutter }}>
                        {booking.requester?.phone ? (
                          <Button
                            label="Call"
                            variant="secondary"
                            icon="call"
                            onPress={() => void Linking.openURL(`tel:${booking.requester?.phone}`)}
                            style={{ flex: 1 }}
                          />
                        ) : null}
                        {next ? (
                          <Button
                            label={next.label}
                            icon={next.to === 'PICKED_UP' ? 'vpn-key' : 'arrow-forward'}
                            loading={busy === booking._id}
                            onPress={() => {
                              if (next.to === 'PICKED_UP') {
                                setOtp('');
                                setOtpError(undefined);
                                setOtpFor(booking);
                                return;
                              }
                              void advance(booking._id, next.to);
                            }}
                            style={{ flex: 2 }}
                          />
                        ) : null}
                      </View>
                    </Card>
                  );
                })}
              </>
            ) : null}

            {/* what is on offer */}
            <SectionHeader
              title={matches.length > 0 ? `${matches.length} going your way` : 'Nothing going your way'}
            />

            {matches.length === 0 ? (
              <EmptyState
                icon="search-off"
                title="No return loads on your route right now"
                message="Shops and farmers post loads through the day. We'll notify you if one appears before you set off — you can keep driving."
                action={<Button label="Check again" icon="refresh" onPress={data.refresh} />}
              />
            ) : (
              matches.map((match) => (
                <ReturnLoadCard
                  key={match.request._id}
                  match={match}
                  busy={busy === match.request._id}
                  onTake={() => setAccepting(match)}
                />
              ))
            )}
          </>
        )}
      </Screen>

      <ConfirmDialog
        visible={accepting !== null}
        title="Take this load home?"
        message={
          accepting
            ? `${accepting.request.description} — ${kg(accepting.request.weightKg)} from ${
                accepting.request.pickup.name
              } to ${accepting.request.destination.name}. It adds ${km(
                accepting.detourKm,
              )} and about ${accepting.addedMinutes} minutes to your journey, and pays you ${rupees(
                accepting.expectedEarning,
              )}.`
            : undefined
        }
        confirmLabel="Take it"
        busy={busy !== null}
        onCancel={() => setAccepting(null)}
        onConfirm={() => accepting && void accept(accepting)}
      />

      <Sheet
        visible={otpFor !== null}
        onClose={() => setOtpFor(null)}
        title="Collection code"
        subtitle={`Ask ${otpFor?.requester?.name ?? 'the sender'} for the 4-digit code on their phone.`}
      >
        <Field
          label="4-digit code"
          value={otp}
          onChangeText={setOtp}
          placeholder="0000"
          keyboardType="number-pad"
          maxLength={4}
          error={otpError}
        />
        <View style={{ flexDirection: 'row', gap: space.sm }}>
          <Button
            label="Cancel"
            variant="secondary"
            icon={null}
            onPress={() => setOtpFor(null)}
            style={{ flex: 1 }}
          />
          <Button
            label="Collect"
            icon="check-circle"
            loading={busy === otpFor?._id}
            disabled={otp.trim().length !== 4}
            onPress={() => otpFor && void advance(otpFor._id, 'PICKED_UP', otp.trim())}
            style={{ flex: 1 }}
          />
        </View>
      </Sheet>

      <Toast message={toast} tone={toastTone} onHide={() => setToast(null)} />
    </View>
  );
}


