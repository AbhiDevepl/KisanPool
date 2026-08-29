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
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Linking, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';
import type { BookingOperatorMode, GeoPoint } from '@kisanpool/shared';
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
import { LocationPicker } from '../../../components/LocationPicker';
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
  // the FIELD the work is at — seeded from the saved place, but the farmer picks
  // it: the machine may be for a plot that is not their default location
  const [site, setSite] = useState<GeoPoint | null>(null);
  const [siteTouched, setSiteTouched] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);

  useEffect(() => {
    void getUser().then((u) => {
      if (u?.defaultLocation && !siteTouched) setSite(u.defaultLocation);
    });
  }, [siteTouched]);

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
      // screen re-runs discovery for this one machine rather than doing sums here.
      // The site is the farmer's CHOICE (state), falling back to their saved place.
      const jobSite = site ?? user?.defaultLocation ?? null;
      const priced = jobSite
        ? await api.findMachines({
            lat: jobSite.lat,
            lng: jobSite.lng,
            category: machine.category,
            start: jobWindow.start.toISOString(),
            end: jobWindow.end.toISOString(),
            areaAcres: Number(acres) > 0 ? Number(acres) : undefined,
          })
        : [];
      // could this hire share a provider outing (and its travel cost) with jobs
      // already booked nearby? Advisory — never forces anything (ADR-042)
      const grouping = jobSite
        ? await api
            .machineGrouping(params.id, {
              lat: jobSite.lat,
              lng: jobSite.lng,
              start: jobWindow.start.toISOString(),
              end: jobWindow.end.toISOString(),
              areaAcres: Number(acres) > 0 ? Number(acres) : undefined,
            })
            .catch(() => null)
        : null;

      return {
        machine,
        site: jobSite,
        row: priced.find((m) => m._id === params.id) ?? null,
        grouping,
      };
    }, [params.id, jobWindow, acres, site]),
  );

  const machine = detail.data?.machine;
  const row = detail.data?.row;
  const grouping = detail.data?.grouping ?? null;
  /** the site actually used — the farmer's choice, or the resolved fallback */
  const effectiveSite = site ?? detail.data?.site ?? null;
  const quote = row?.quote ?? null;
  const needsAcres = machine?.pricing.unit === 'PER_ACRE';

  const book = async (): Promise<void> => {
    if (!machine || !effectiveSite) return;
    setBusy(true);
    setBookError(undefined);
    try {
      const booking = await api.bookMachine({
        machineId: machine._id,
        start: jobWindow.start.toISOString(),
        end: jobWindow.end.toISOString(),
        location: effectiveSite,
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
              disabled={!effectiveSite || (needsAcres && !(Number(acres) > 0))}
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

        {/* the field the work is at — the farmer's choice, editable */}
        <Card onPress={() => setPickerOpen(true)}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
            <MaterialIcons name="place" size={20} color={colors.primary} />
            <View style={{ flex: 1 }}>
              <Txt variant="labelLg">{effectiveSite?.name ?? 'Set the field location'}</Txt>
              <Txt variant="labelSm" color={colors.onSurfaceVariant}>
                Where the machine should come. Tap to search, drop a pin, or use GPS.
              </Txt>
            </View>
            <Txt variant="labelLg" color={colors.primary}>
              {effectiveSite ? 'Change' : 'Set'}
            </Txt>
          </View>
        </Card>

        {effectiveSite ? (
          <TripMap
            pickup={{ lat: machine.baseLocation.lat, lng: machine.baseLocation.lng, title: 'Machine' }}
            destination={{ lat: effectiveSite.lat, lng: effectiveSite.lng, title: 'Your field' }}
            height={180}
          />
        ) : null}

        <LocationPicker
          visible={pickerOpen}
          onClose={() => setPickerOpen(false)}
          initial={effectiveSite}
          title="Where is the work?"
          subtitle="The field the machine should come to — not necessarily your home village."
          confirmLabel="Use this field"
          onPick={(point) => {
            setSite(point);
            setSiteTouched(true);
          }}
        />

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
                  label={`Travel — ${km(quote.travelKm)} each way${
                    quote.travelShareCount > 1 ? ` · shared ${quote.travelShareCount} ways` : ''
                  }`}
                  value={rupees(quote.travelCost)}
                />
                <Txt variant="labelSm" color={colors.outline}>
                  {quote.travelShareCount > 1
                    ? `The provider serves ${quote.travelShareCount} nearby jobs in one outing, so you pay only your share of the drive.`
                    : 'The machine has to reach your field and get home again.'}
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

        {/* shared-machine utilisation — surfaced when this hire could ride along
            with nearby jobs and split the travel (ADR-042). Advisory only. */}
        {grouping && grouping.compatibility !== 'NONE' && grouping.projectedSaving > 0 ? (
          <View
            style={{
              backgroundColor: colors.primaryContainer,
              borderRadius: radius.md,
              padding: space.gutter,
              gap: space.xs,
            }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
              <MaterialIcons name="groups" size={20} color={colors.onPrimary} />
              <Txt variant="labelLg" color={colors.onPrimary} style={{ flex: 1 }}>
                {grouping.compatibility === 'HIGH'
                  ? 'You can share this trip'
                  : 'A nearby job could share this trip'}
              </Txt>
            </View>
            {grouping.reasons.map((reason) => (
              <Txt key={reason} variant="bodyMd" color={colors.onPrimary}>
                • {reason}
              </Txt>
            ))}
            <Txt variant="labelSm" color={colors.onPrimaryContainer} style={{ marginTop: space.xs }}>
              {grouping.compatibility === 'HIGH'
                ? 'Your quote already reflects the shared travel. Book to lock your slot.'
                : 'The provider decides whether to group jobs. If they do, your travel cost drops automatically.'}
            </Txt>
          </View>
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
