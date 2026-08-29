/**
 * Farm Services — my hires, and my machines' inbox.
 *
 * Both sides on one screen, behind two tabs, because in this product they are the
 * same person. The farmer who hires a harvester in June is the one hiring out his
 * own tractor in November, and giving each side its own screen would have meant
 * building the provider half twice — once for "farmers who own machines" and once
 * for hiring centres — when they are identical.
 *
 * The tab only appears when the user actually owns a machine. Nobody should meet
 * an empty "incoming requests" tab they have no way to fill.
 */
import { useCallback, useState } from 'react';
import { Linking, View } from 'react-native';
import { useRouter } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';
import type { MachineBookingDTO, MachineBookingState } from '@kisanpool/shared';
import { api } from '../../../lib/api';
import { toAppError } from '../../../lib/errors';
import { useLoader } from '../../../lib/useLoader';
import { rupees } from '../../../lib/format';
import {
  BOOKING_COPY,
  LIVE_BOOKING_STATES,
  MACHINE_ICON,
  MACHINE_LABEL,
  PROVIDER_COPY,
  UNIT_LABEL,
  UNIT_NOUN,
  windowLabel,
} from '../../../lib/machinery';
import {
  Banner,
  Button,
  Card,
  ConfirmDialog,
  Divider,
  EmptyState,
  Field,
  FilterRow,
  Header,
  IconBadge,
  Row,
  Screen,
  Sheet,
  SkeletonList,
  StatusBadge,
  Toast,
  Txt,
} from '../../../components/ui';
import { ErrorView } from '../../../components/ErrorView';
import { BottomNav } from '../../../components/BottomNav';
import { colors, radius, space } from '../../../theme';

type Tab = 'hired' | 'providing';

export default function ServiceBookings() {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>('hired');
  const [busy, setBusy] = useState<string | null>(null);
  const [otpFor, setOtpFor] = useState<MachineBookingDTO | null>(null);
  const [otp, setOtp] = useState('');
  const [otpError, setOtpError] = useState<string>();
  const [cancelling, setCancelling] = useState<MachineBookingDTO | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [toastTone, setToastTone] = useState<'success' | 'error'>('success');

  const data = useLoader(
    useCallback(async () => {
      const [hired, providing, machines] = await Promise.all([
        api.machineBookings('farmer'),
        api.machineBookings('provider'),
        api.myMachines().catch(() => []),
      ]);
      return { hired, providing, machines };
    }, []),
  );

  const hired = data.data?.hired ?? [];
  const providing = data.data?.providing ?? [];
  const isProvider = (data.data?.machines ?? []).length > 0;

  const needsAnswer = providing.filter((b) => b.state === 'REQUESTED').length;

  /**
   * Not-yet-grouped REQUESTED jobs on the same machine, same day — candidates the
   * provider could serve in one outing so travel splits (ADR-042). The server
   * re-checks the real proximity/window; this is just the affordance.
   */
  const groupableClusters = (() => {
    const buckets = new Map<string, MachineBookingDTO[]>();
    for (const b of providing) {
      if (b.state !== 'REQUESTED' || b.groupId) continue;
      const day = new Date(b.window.start).toDateString();
      const key = `${b.machineId}|${day}`;
      buckets.set(key, [...(buckets.get(key) ?? []), b]);
    }
    return [...buckets.values()].filter((rows) => rows.length >= 2);
  })();

  const [grouping, setGrouping] = useState(false);
  const groupCluster = async (rows: MachineBookingDTO[]): Promise<void> => {
    setGrouping(true);
    try {
      await api.groupMachineBookings(rows.map((r) => r._id));
      setToastTone('success');
      setToast('Jobs grouped — travel cost is now shared across them.');
      data.refresh();
    } catch (err) {
      setToastTone('error');
      setToast(toAppError(err).message);
    } finally {
      setGrouping(false);
    }
  };

  const advance = async (
    booking: MachineBookingDTO,
    to: MachineBookingState,
    extra?: { otp?: string; reason?: string },
  ): Promise<void> => {
    setBusy(booking._id);
    setOtpError(undefined);
    try {
      await api.setMachineBookingState(booking._id, to, extra);
      setOtpFor(null);
      setOtp('');
      setCancelling(null);
      setToastTone('success');
      setToast(`Booking ${to.toLowerCase().replace(/_/g, ' ')}`);
      data.refresh();
    } catch (err) {
      const appError = toAppError(err);
      // a wrong start code keeps the sheet open with the reason on the input
      if (to === 'IN_PROGRESS' && appError.code === 'VALIDATION_ERROR') {
        setOtpError('That code is not correct. Ask the farmer to read it again.');
      } else {
        setOtpFor(null);
        setCancelling(null);
        setToastTone('error');
        setToast(appError.message);
      }
    } finally {
      setBusy(null);
    }
  };

  const tabs: Array<{ key: Tab; label: string; count?: number }> = [
    { key: 'hired', label: 'I hired', count: hired.filter((b) => LIVE_BOOKING_STATES.includes(b.state)).length || undefined },
    ...(isProvider
      ? [{ key: 'providing' as Tab, label: 'My machines', count: needsAnswer || undefined }]
      : []),
  ];

  const rows = tab === 'hired' ? hired : providing;

  return (
    <View style={{ flex: 1 }}>
      <Screen
        withNav
        refreshing={data.refreshing}
        onRefresh={data.refresh}
        header={
          <>
            <View style={{ paddingHorizontal: space.md }}>
              <Header
                title="Farm bookings"
                onBack={() => router.replace('/(farmer)/services')}
                right={
                  <Button
                    label="List a machine"
                    variant="ghost"
                    icon="add"
                    onPress={() => router.push('/(farmer)/services/my-machines')}
                  />
                }
              />
            </View>
            {tabs.length > 1 ? (
              <View style={{ paddingHorizontal: space.md, paddingBottom: space.sm }}>
                <FilterRow options={tabs} value={tab} onChange={setTab} />
              </View>
            ) : null}
          </>
        }
      >
        {data.loading ? (
          <SkeletonList count={3} />
        ) : data.error ? (
          <ErrorView error={data.error} onRetry={data.refresh} />
        ) : rows.length === 0 ? (
          tab === 'hired' ? (
            <EmptyState
              icon="agriculture"
              title="You have not hired anything yet"
              message="Find a tractor, harvester or rotavator near you and book it for the day you need it."
              action={
                <Button
                  label="Browse farm services"
                  icon="search"
                  onPress={() => router.replace('/(farmer)/services')}
                />
              }
            />
          ) : (
            <EmptyState
              icon="inbox"
              title="No requests yet"
              message="When a farmer nearby books one of your machines it will appear here for you to accept."
            />
          )
        ) : (
          <>
            {tab === 'providing' && needsAnswer > 0 ? (
              <Banner tone="warning">
                <View style={{ flexDirection: 'row', gap: space.sm }}>
                  <MaterialIcons name="schedule" size={20} color={colors.onWarningContainer} />
                  <Txt variant="bodyMd" color={colors.onWarningContainer} style={{ flex: 1 }}>
                    {needsAnswer} request{needsAnswer > 1 ? 's are' : ' is'} holding time on your
                    machine. Answer soon so the slot is not wasted either way.
                  </Txt>
                </View>
              </Banner>
            ) : null}

            {tab === 'providing'
              ? groupableClusters.map((rows, i) => (
                  <Card key={`cluster-${i}`} style={{ borderColor: colors.primary, borderWidth: 1 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
                      <MaterialIcons name="groups" size={20} color={colors.primary} />
                      <Txt variant="labelLg" color={colors.primary} style={{ flex: 1 }}>
                        {rows.length} requests for {rows[0].machine?.title ?? 'this machine'} on{' '}
                        {new Date(rows[0].window.start).toLocaleDateString('en-IN', {
                          day: 'numeric',
                          month: 'short',
                        })}
                      </Txt>
                    </View>
                    <Txt variant="bodyMd" color={colors.onSurfaceVariant} style={{ marginTop: space.xs }}>
                      Serve them in one outing and the travel cost splits across all{' '}
                      {rows.length} — lower for each farmer, same drive for you.
                    </Txt>
                    <Button
                      label="Group & share travel"
                      icon="groups"
                      loading={grouping}
                      onPress={() => void groupCluster(rows)}
                      style={{ marginTop: space.gutter }}
                    />
                  </Card>
                ))
              : null}

            {rows.map((booking) => {
              const copy = tab === 'hired' ? BOOKING_COPY[booking.state] : PROVIDER_COPY[booking.state];
              const amount = booking.finalAmount ?? booking.quote.total;
              const other = tab === 'hired' ? booking.provider : booking.farmer;

              return (
                <Card key={booking._id}>
                  <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: space.gutter }}>
                    <IconBadge icon={MACHINE_ICON[booking.category]} />
                    <View style={{ flex: 1 }}>
                      <Txt variant="labelLg">{booking.machine?.title ?? MACHINE_LABEL[booking.category]}</Txt>
                      <Txt variant="labelSm" color={colors.onSurfaceVariant}>
                        {windowLabel(booking.window.start, booking.window.end)}
                      </Txt>
                    </View>
                    <StatusBadge status={copy.badge} label={copy.label} />
                  </View>

                  <Txt variant="bodyMd" color={colors.onSurfaceVariant} style={{ marginTop: space.sm }}>
                    {copy.detail}
                  </Txt>

                  <Divider />
                  <Row label="Field" value={booking.location.name} />
                  {booking.workType ? <Row label="Work" value={booking.workType} /> : null}
                  {booking.areaAcres ? <Row label="Area" value={`${booking.areaAcres} acres`} /> : null}
                  <Row
                    label={tab === 'hired' ? 'You pay' : 'You earn'}
                    value={rupees(tab === 'hired' ? amount : booking.quote.providerEarning)}
                    bold
                  />
                  <Txt variant="labelSm" color={colors.outline}>
                    {UNIT_NOUN[booking.quote.unit](booking.quote.billableUnits)} at{' '}
                    {rupees(booking.quote.rate)} {UNIT_LABEL[booking.quote.unit]}
                    {booking.quote.travelCost > 0
                      ? ` + ${rupees(booking.quote.travelCost)} travel${
                          booking.quote.travelShareCount > 1
                            ? ` (shared ${booking.quote.travelShareCount} ways)`
                            : ''
                        }`
                      : ''}
                    {booking.finalAmount != null && booking.finalAmount !== booking.quote.total
                      ? ' · billed at what the work took'
                      : ''}
                  </Txt>

                  {/* co-scheduled cluster this job shares an outing with (ADR-042) */}
                  {booking.group && booking.group.size > 1 ? (
                    <View
                      style={{
                        flexDirection: 'row',
                        alignItems: 'center',
                        gap: space.sm,
                        marginTop: space.sm,
                      }}
                    >
                      <MaterialIcons name="groups" size={16} color={colors.primary} />
                      <Txt variant="labelSm" color={colors.primary} style={{ flex: 1 }}>
                        {tab === 'providing'
                          ? `Grouped outing · ${booking.group.size} jobs · ${rupees(
                              booking.group.combinedProviderEarning,
                            )} total earning`
                          : `Shared with ${booking.group.size - 1} nearby ${
                              booking.group.size - 1 === 1 ? 'job' : 'jobs'
                            } — travel split ${booking.group.size} ways`}
                      </Txt>
                    </View>
                  ) : null}

                  {/* the farmer's start code — never shown to the provider */}
                  {tab === 'hired' && booking.startOtp && booking.state === 'CONFIRMED' ? (
                    <View style={s.otpCard}>
                      <Txt variant="labelSm" color={colors.onPrimaryContainer}>
                        Your start code
                      </Txt>
                      <Txt variant="displayLg" color={colors.onPrimary} style={{ letterSpacing: 8 }}>
                        {booking.startOtp}
                      </Txt>
                      <Txt variant="labelSm" color={colors.onPrimaryContainer}>
                        Read this out when the machine reaches your field.
                      </Txt>
                    </View>
                  ) : null}

                  {other?.phone ? (
                    <Button
                      label={`Call ${other.name.split(' ')[0]}`}
                      variant="secondary"
                      icon="call"
                      onPress={() => void Linking.openURL(`tel:${other.phone}`)}
                      style={{ marginTop: space.gutter }}
                    />
                  ) : null}

                  {/* the one action each side has, at each state */}
                  {tab === 'providing' && booking.state === 'REQUESTED' ? (
                    <View style={{ flexDirection: 'row', gap: space.sm, marginTop: space.gutter }}>
                      <Button
                        label="Decline"
                        variant="secondary"
                        icon="close"
                        onPress={() => void advance(booking, 'DECLINED')}
                        style={{ flex: 1 }}
                      />
                      <Button
                        label="Accept"
                        icon="check"
                        loading={busy === booking._id}
                        onPress={() => void advance(booking, 'CONFIRMED')}
                        style={{ flex: 1 }}
                      />
                    </View>
                  ) : tab === 'providing' && booking.state === 'CONFIRMED' ? (
                    <Button
                      label="Start work with the farmer's code"
                      icon="vpn-key"
                      loading={busy === booking._id}
                      onPress={() => {
                        setOtp('');
                        setOtpError(undefined);
                        setOtpFor(booking);
                      }}
                      style={{ marginTop: space.gutter }}
                    />
                  ) : tab === 'providing' && booking.state === 'IN_PROGRESS' ? (
                    <Button
                      label="Work finished"
                      icon="check-circle"
                      loading={busy === booking._id}
                      onPress={() => void advance(booking, 'COMPLETED')}
                      style={{ marginTop: space.gutter }}
                    />
                  ) : tab === 'hired' && ['REQUESTED', 'CONFIRMED'].includes(booking.state) ? (
                    <Button
                      label="Cancel this booking"
                      variant="secondary"
                      icon="close"
                      onPress={() => setCancelling(booking)}
                      style={{ marginTop: space.gutter }}
                    />
                  ) : null}
                </Card>
              );
            })}
          </>
        )}
      </Screen>

      {/* the farmer's code is what proves the machine reached the right field */}
      <Sheet
        visible={otpFor !== null}
        onClose={() => setOtpFor(null)}
        title="Start code"
        subtitle={`Ask ${otpFor?.farmer?.name ?? 'the farmer'} for the 4-digit code on their phone.`}
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
            label="Start work"
            icon="play-arrow"
            loading={busy === otpFor?._id}
            disabled={otp.trim().length !== 4}
            onPress={() => otpFor && void advance(otpFor, 'IN_PROGRESS', { otp: otp.trim() })}
            style={{ flex: 1 }}
          />
        </View>
      </Sheet>

      <ConfirmDialog
        visible={cancelling !== null}
        title="Cancel this booking?"
        message={
          cancelling
            ? `${cancelling.machine?.title ?? 'The machine'} on ${windowLabel(
                cancelling.window.start,
                cancelling.window.end,
              )}. The slot goes back to being free and nothing is charged.`
            : undefined
        }
        confirmLabel="Cancel booking"
        destructive
        busy={busy !== null}
        onCancel={() => setCancelling(null)}
        onConfirm={() => cancelling && void advance(cancelling, 'CANCELLED', { reason: 'Cancelled by farmer' })}
      />

      <Toast message={toast} tone={toastTone} onHide={() => setToast(null)} />
      <BottomNav role="farmer" active="bookings" badges={{ bookings: needsAnswer }} />
    </View>
  );
}

const s = {
  otpCard: {
    marginTop: space.gutter,
    backgroundColor: colors.primaryContainer,
    borderRadius: radius.lg,
    padding: space.gutter,
    alignItems: 'center' as const,
  },
};
