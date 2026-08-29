/**
 * One provider, and the sheet that books them.
 *
 * The price breakdown is the point of this screen. A farmer being quoted ₹3,200
 * for four hours of a tractor deserves to see that it is ₹2,600 of work plus ₹600
 * of getting the machine to their field — because that is the number they can
 * argue with, and because "trust me" is not a pricing model.
 *
 * The booking sheet is a Sheet rather than a screen on purpose: the farmer has
 * already chosen the machine, the day and the slot on the way here. All that is
 * left is confirming, so a whole extra screen would be ceremony.
 */
import { useCallback, useMemo, useState } from 'react';
import { Linking, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';
import type { BookingOperatorMode } from '@kisanpool/shared';
import { api } from '../../../lib/api';
import { toAppError } from '../../../lib/errors';
import { getUser } from '../../../lib/session';
import { useLoader } from '../../../lib/useLoader';
import { km, rupees, shortDate } from '../../../lib/format';
import {
  MACHINE_ICON,
  MACHINE_LABEL,
  MACHINE_NATIVE,
  OPERATOR_LABEL,
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
  Field,
  Header,
  IconBadge,
  Loading,
  RatingStars,
  Row,
  Screen,
  Sheet,
  StatusBadge,
  Toast,
  Txt,
} from '../../../components/ui';
import { ErrorView } from '../../../components/ErrorView';
import { TripMap } from '../../../components/TripMap';
import { colors, radius, space } from '../../../theme';

export default function MachineDetail() {
  const router = useRouter();
  const params = useLocalSearchParams<{
    id: string;
    start?: string;
    end?: string;
    operatorMode?: BookingOperatorMode;
    acres?: string;
  }>();

  const [bookingOpen, setBookingOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [workType, setWorkType] = useState('');
  const [notes, setNotes] = useState('');
  const [acres, setAcres] = useState(params.acres ?? '');
  const [toast, setToast] = useState<string | null>(null);
  const [toastTone, setToastTone] = useState<'success' | 'error'>('success');
  const [bookError, setBookError] = useState<string>();

  const jobWindow = useMemo(() => {
    const start = params.start ? new Date(params.start) : new Date(Date.now() + 86_400_000);
    const end = params.end ? new Date(params.end) : new Date(start.getTime() + 4 * 3_600_000);
    return { start, end };
  }, [params.start, params.end]);

  const operatorMode: BookingOperatorMode = params.operatorMode ?? 'WITH_OPERATOR';

  const detail = useLoader(
    useCallback(async () => {
      const [machine, user] = await Promise.all([api.getMachine(params.id), getUser()]);
      // the quote has to come from the server for the site the work is at, so the
      // screen re-runs discovery for this one machine rather than doing sums here
      const site = user?.defaultLocation;
      const priced = site
        ? await api.findMachines({
            lat: site.lat,
            lng: site.lng,
            category: machine.category,
            start: jobWindow.start.toISOString(),
            end: jobWindow.end.toISOString(),
            areaAcres: Number(acres) > 0 ? Number(acres) : undefined,
          })
        : [];
      return {
        machine,
        site,
        row: priced.find((m) => m._id === params.id) ?? null,
      };
    }, [params.id, jobWindow, acres]),
  );

  const machine = detail.data?.machine;
  const row = detail.data?.row;
  const site = detail.data?.site;
  const quote = row?.quote ?? null;
  const needsAcres = machine?.pricing.unit === 'PER_ACRE';

  const book = async (): Promise<void> => {
    if (!machine || !site) return;
    setBusy(true);
    setBookError(undefined);
    try {
      const booking = await api.bookMachine({
        machineId: machine._id,
        start: jobWindow.start.toISOString(),
        end: jobWindow.end.toISOString(),
        location: site,
        operatorMode:
          machine.operatorMode === 'EITHER' ? operatorMode : (machine.operatorMode as BookingOperatorMode),
        workType: workType.trim() || undefined,
        areaAcres: Number(acres) > 0 ? Number(acres) : undefined,
        notes: notes.trim() || undefined,
      });
      setConfirming(false);
      setBookingOpen(false);
      router.replace({ pathname: '/(farmer)/services/bookings', params: { id: booking._id } });
    } catch (err) {
      const appError = toAppError(err);
      setConfirming(false);
      // CONCURRENT_BOOKING here means someone took the slot while they decided —
      // the screen has to say that plainly and offer another time, not "try again"
      setBookError(appError.message);
      if (appError.code === 'CONCURRENT_BOOKING') detail.refresh();
      setToastTone('error');
      setToast(appError.message);
    } finally {
      setBusy(false);
    }
  };

  if (detail.loading) {
    return (
      <Screen>
        <Header title="Provider" onBack={() => router.back()} />
        <Loading />
      </Screen>
    );
  }

  if (!machine) {
    return (
      <Screen>
        <Header title="Provider" onBack={() => router.back()} />
        <ErrorView error={detail.error} onRetry={detail.refresh} />
      </Screen>
    );
  }

  const available = row?.availableForWindow ?? true;

  return (
    <View style={{ flex: 1 }}>
      <Screen
        refreshing={detail.refreshing}
        onRefresh={detail.refresh}
        footer={
          available ? (
            <Button
              label={quote ? `Request for ${rupees(quote.total)}` : 'Request this machine'}
              icon="event-available"
              disabled={!site || (needsAcres && !(Number(acres) > 0))}
              onPress={() => setBookingOpen(true)}
            />
          ) : (
            <Button
              label="See other providers"
              variant="secondary"
              icon="search"
              onPress={() => router.back()}
            />
          )
        }
      >
        <Header
          title={machine.title}
          subtitle={`${MACHINE_LABEL[machine.category]}${
            MACHINE_NATIVE[machine.category] ? ` · ${MACHINE_NATIVE[machine.category]}` : ''
          }`}
          onBack={() => router.back()}
          right={
            <StatusBadge
              status={available ? 'ASSIGNED' : 'PENDING'}
              label={available ? 'Available' : 'Busy then'}
            />
          }
        />

        {!available ? (
          <Banner tone="warning">
            <Txt variant="labelLg" color={colors.onWarningContainer}>
              Already booked for {windowLabel(jobWindow.start, jobWindow.end)}
            </Txt>
            <Txt variant="bodyMd" color={colors.onWarningContainer}>
              Pick another day or time and this provider may be free.
            </Txt>
          </Banner>
        ) : null}

        {/* the provider */}
        <Card>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.gutter }}>
            <IconBadge icon={MACHINE_ICON[machine.category]} />
            <View style={{ flex: 1 }}>
              <Txt variant="labelLg">{machine.owner?.name ?? 'Provider'}</Txt>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
                <RatingStars value={machine.owner?.ratingAvg ?? 0} />
                <Txt variant="labelSm" color={colors.onSurfaceVariant}>
                  {machine.completedJobs} job{machine.completedJobs === 1 ? '' : 's'} done
                </Txt>
              </View>
            </View>
          </View>

          <Divider />
          {machine.makeModel ? <Row label="Machine" value={machine.makeModel} /> : null}
          <Row label="Operator" value={OPERATOR_LABEL[machine.operatorMode]} />
          {machine.attachments.length > 0 ? (
            <Row label="Comes with" value={machine.attachments.join(', ')} />
          ) : null}
          <Row label="Based at" value={machine.baseLocation.name} />
          <Row label="Travels up to" value={km(machine.serviceRadiusKm)} />
          {row ? <Row label="Distance to your field" value={km(row.distanceKm)} bold /> : null}
        </Card>

        {site ? (
          <TripMap
            pickup={{ lat: machine.baseLocation.lat, lng: machine.baseLocation.lng, title: 'Machine' }}
            destination={{ lat: site.lat, lng: site.lng, title: 'Your field' }}
            height={180}
          />
        ) : null}

        {/* WHY the price is the price */}
        {quote ? (
          <Card>
            <Txt variant="labelLg" color={colors.onSurfaceVariant}>
              Your price for this job
            </Txt>
            <Txt variant="displayLg" color={colors.primary}>
              {rupees(quote.total)}
            </Txt>

            <Divider />
            <Row
              label={`Work — ${UNIT_NOUN[quote.unit](quote.billableUnits)}`}
              value={rupees(quote.workCost)}
            />
            <Txt variant="labelSm" color={colors.outline}>
              {rupees(quote.rate)} {UNIT_LABEL[quote.unit]}
            </Txt>
            {quote.travelCost > 0 ? (
              <>
                <Row
                  label={`Travel — ${km(quote.travelKm)} each way`}
                  value={rupees(quote.travelCost)}
                />
                <Txt variant="labelSm" color={colors.outline}>
                  The machine has to reach your field and get home again.
                </Txt>
              </>
            ) : null}
            {quote.minimumTopUp > 0 ? (
              <>
                <Row label="Minimum charge top-up" value={rupees(quote.minimumTopUp)} />
                <Txt variant="labelSm" color={colors.outline}>
                  This provider does not turn out for less than {rupees(quote.total)}.
                </Txt>
              </>
            ) : null}
            <Divider />
            <Row label="Total" value={rupees(quote.total)} bold />
            <Txt variant="labelSm" color={colors.outline} style={{ marginTop: space.xs }}>
              Payable after the work is done. If the job runs longer or shorter than booked, a
              per-hour price is billed at what it actually took.
            </Txt>
          </Card>
        ) : needsAcres ? (
          <Banner tone="info">
            <Txt variant="bodyMd" color={colors.onInfoContainer}>
              This machine is priced per acre. Tell us the area and we will quote it exactly.
            </Txt>
            <Field
              label="Area (acres)"
              value={acres}
              onChangeText={(text) => setAcres(text.replace(/[^0-9.]/g, ''))}
              keyboardType="decimal-pad"
              placeholder="e.g. 3"
            />
          </Banner>
        ) : null}

        {/* when the machine is already committed — the calendar, plainly */}
        {machine.schedule.busy.length > 0 ? (
          <Card>
            <Txt variant="labelLg" color={colors.onSurfaceVariant}>
              Already booked
            </Txt>
            <Divider />
            {machine.schedule.busy.slice(0, 6).map((slot) => (
              <View
                key={slot.bookingId}
                style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingVertical: 4 }}
              >
                <MaterialIcons name="event-busy" size={16} color={colors.outline} />
                <Txt variant="bodyMd" color={colors.onSurfaceVariant} style={{ flex: 1 }}>
                  {windowLabel(slot.start, slot.end)}
                </Txt>
              </View>
            ))}
            {machine.schedule.blackouts.map((b, i) => (
              <View
                key={`blackout-${i}`}
                style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingVertical: 4 }}
              >
                <MaterialIcons name="block" size={16} color={colors.outline} />
                <Txt variant="bodyMd" color={colors.onSurfaceVariant} style={{ flex: 1 }}>
                  {shortDate(b.start)} — {b.reason ?? 'unavailable'}
                </Txt>
              </View>
            ))}
          </Card>
        ) : null}

        {bookError ? (
          <Banner tone="error">
            <Txt variant="bodyMd" color={colors.onErrorContainer}>
              {bookError}
            </Txt>
          </Banner>
        ) : null}
      </Screen>

      {/* confirming is one sheet, not a second screen — everything is already chosen */}
      <Sheet
        visible={bookingOpen}
        onClose={() => setBookingOpen(false)}
        title="Request this machine"
        subtitle={windowLabel(jobWindow.start, jobWindow.end)}
      >
        <Field
          label="What is the work? (optional)"
          value={workType}
          onChangeText={setWorkType}
          placeholder="e.g. Wheat harvesting"
          maxLength={60}
        />
        {needsAcres ? (
          <Field
            label="Area (acres)"
            value={acres}
            onChangeText={(text) => setAcres(text.replace(/[^0-9.]/g, ''))}
            keyboardType="decimal-pad"
            placeholder="e.g. 3"
          />
        ) : null}
        <Field
          label="Anything the provider should know? (optional)"
          value={notes}
          onChangeText={setNotes}
          placeholder="Narrow approach road, gate is on the east side"
          maxLength={300}
        />

        <View style={s.holdNote}>
          <MaterialIcons name="lock-clock" size={18} color={colors.onInfoContainer} />
          <Txt variant="labelSm" color={colors.onInfoContainer} style={{ flex: 1 }}>
            This holds the slot while the provider answers, so nobody else can take that time.
            You pay nothing until the work is done.
          </Txt>
        </View>

        <Button
          label={quote ? `Request for ${rupees(quote.total)}` : 'Send request'}
          icon="event-available"
          loading={busy}
          onPress={() => setConfirming(true)}
        />
      </Sheet>

      <ConfirmDialog
        visible={confirming}
        title="Send this request?"
        message={
          quote
            ? `${machine.title} on ${windowLabel(jobWindow.start, jobWindow.end)} for ${rupees(
                quote.total,
              )}, payable after the work. ${machine.owner?.name ?? 'The provider'} will accept or decline.`
            : undefined
        }
        confirmLabel="Send request"
        busy={busy}
        onCancel={() => setConfirming(false)}
        onConfirm={() => void book()}
      />

      <Toast message={toast} tone={toastTone} onHide={() => setToast(null)} />
    </View>
  );
}

const s = {
  holdNote: {
    flexDirection: 'row' as const,
    alignItems: 'flex-start' as const,
    gap: space.sm,
    backgroundColor: colors.infoContainer,
    borderRadius: radius.md,
    padding: space.gutter,
    marginBottom: space.gutter,
  },
};
