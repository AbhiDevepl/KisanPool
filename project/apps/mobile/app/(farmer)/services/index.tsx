/**
 * Farm Services — discovery.
 *
 * The screen answers one question: "who near me can do this job, on this day, for
 * how much?" Everything on it exists to make those four things comparable.
 *
 * The hard part is that providers quote in different units. A harvester is ₹2,400
 * per acre and a tractor is ₹650 per hour, and no farmer should have to convert
 * between them in their head to know which is dearer. So the screen never leads
 * with the rate: it asks for the job first, and every card then shows the rupees
 * THAT job costs, priced by the backend. The rate is shown underneath as
 * supporting detail.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';
import type { MachineCategory, BookingOperatorMode } from '@kisanpool/shared';
import { api, type MachineSearchResult } from '../../../lib/api';
import { getUser } from '../../../lib/session';
import { useLoader } from '../../../lib/useLoader';
import { kg, km, rupees } from '../../../lib/format';
import {
  MACHINE_ICON,
  MACHINE_LABEL,
  MACHINE_NATIVE,
  POPULAR_CATEGORIES,
  UNIT_LABEL,
  UNIT_NOUN,
  hoursBetween,
  windowLabel,
} from '../../../lib/machinery';
import {
  Banner,
  Button,
  Card,
  Chip,
  Divider,
  EmptyState,
  Field,
  FilterRow,
  Header,
  IconBadge,
  RatingStars,
  Row,
  Screen,
  SectionHeader,
  Sheet,
  SkeletonList,
  StatusBadge,
  Txt,
} from '../../../components/ui';
import { ErrorView } from '../../../components/ErrorView';
import { BottomNav } from '../../../components/BottomNav';
import { colors, radius, space } from '../../../theme';

type Slot = 'morning' | 'afternoon' | 'fullday';

const SLOTS: Array<{ key: Slot; label: string; startHour: number; hours: number }> = [
  { key: 'morning', label: 'Morning', startHour: 7, hours: 4 },
  { key: 'afternoon', label: 'Afternoon', startHour: 13, hours: 4 },
  { key: 'fullday', label: 'Full day', startHour: 7, hours: 9 },
];

const DAYS: Array<{ key: string; label: string; offset: number }> = [
  { key: 'tomorrow', label: 'Tomorrow', offset: 1 },
  { key: 'd2', label: 'In 2 days', offset: 2 },
  { key: 'd3', label: 'In 3 days', offset: 3 },
  { key: 'week', label: 'Next week', offset: 7 },
];

function windowFor(dayOffset: number, slot: Slot): { start: Date; end: Date } {
  const spec = SLOTS.find((s) => s.key === slot) ?? SLOTS[0];
  const start = new Date();
  start.setDate(start.getDate() + dayOffset);
  start.setHours(spec.startHour, 0, 0, 0);
  return { start, end: new Date(start.getTime() + spec.hours * 3_600_000) };
}

export default function FarmServices() {
  const router = useRouter();

  const [category, setCategory] = useState<MachineCategory>('TRACTOR_TROLLEY');
  const [dayKey, setDayKey] = useState('tomorrow');
  const [slot, setSlot] = useState<Slot>('morning');
  const [operatorMode, setOperatorMode] = useState<BookingOperatorMode>('WITH_OPERATOR');
  const [acres, setAcres] = useState('');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [site, setSite] = useState<{ name: string; lat: number; lng: number } | null>(null);

  useEffect(() => {
    void getUser().then((user) => {
      if (user?.defaultLocation) setSite(user.defaultLocation);
    });
  }, []);

  const dayOffset = DAYS.find((d) => d.key === dayKey)?.offset ?? 1;
  const jobWindow = useMemo(() => windowFor(dayOffset, slot), [dayOffset, slot]);

  const search = useLoader(
    useCallback(async () => {
      if (!site) return { machines: [] as MachineSearchResult[], demand: [] };
      const [machines, demand] = await Promise.all([
        api.findMachines({
          lat: site.lat,
          lng: site.lng,
          category,
          start: jobWindow.start.toISOString(),
          end: jobWindow.end.toISOString(),
          operatorMode,
          areaAcres: Number(acres) > 0 ? Number(acres) : undefined,
        }),
        // "four farmers near you want this too" — visible to the farmer as
        // reassurance that a provider is worth calling out for
        api.machineDemand(site.lat, site.lng).catch(() => []),
      ]);
      return { machines, demand };
    }, [site, category, jobWindow, operatorMode, acres]),
  );

  const machines = search.data?.machines ?? [];
  const cluster = (search.data?.demand ?? []).find((d) => d.category === category);
  const available = machines.filter((m) => m.availableForWindow);
  const busy = machines.filter((m) => !m.availableForWindow);

  return (
    <View style={{ flex: 1 }}>
      <Screen
        withNav
        refreshing={search.refreshing}
        onRefresh={search.refresh}
        header={
          <>
            <View style={{ paddingHorizontal: space.md }}>
              <Header
                title="Farm services"
                subtitle="शेती यंत्रे — भाड्याने"
                onBack={() => router.replace('/(farmer)/home')}
                right={
                  <Button
                    label="My bookings"
                    variant="ghost"
                    icon="assignment"
                    onPress={() => router.push('/(farmer)/services/bookings')}
                  />
                }
              />
            </View>
            <View style={{ paddingHorizontal: space.md, paddingBottom: space.sm }}>
              <FilterRow
                options={DAYS.map((d) => ({ key: d.key, label: d.label }))}
                value={dayKey}
                onChange={setDayKey}
              />
            </View>
          </>
        }
      >
        {/* what am I hiring? — the question that has to come first */}
        <SectionHeader title="What do you need?" />
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
          {POPULAR_CATEGORIES.map((item) => (
            <Chip
              key={item}
              label={MACHINE_LABEL[item]}
              selected={category === item}
              onPress={() => setCategory(item)}
            />
          ))}
        </View>

        {/* when, and how big — the two things that decide the price */}
        <Card style={{ marginTop: space.md }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
            <MaterialIcons name="event" size={20} color={colors.primary} />
            <View style={{ flex: 1 }}>
              <Txt variant="labelLg">{windowLabel(jobWindow.start, jobWindow.end)}</Txt>
              <Txt variant="labelSm" color={colors.onSurfaceVariant}>
                {site?.name ?? 'Set your location in Profile'}
              </Txt>
            </View>
            <Button
              label="Change"
              variant="ghost"
              icon="tune"
              onPress={() => setFiltersOpen(true)}
            />
          </View>
        </Card>

        {/* demand aggregation — honest, and only shown when it is real */}
        {cluster ? (
          <Banner tone="info">
            <View style={{ flexDirection: 'row', gap: space.sm }}>
              <MaterialIcons name="groups" size={20} color={colors.onInfoContainer} />
              <Txt variant="bodyMd" color={colors.onInfoContainer} style={{ flex: 1 }}>
                {cluster.farmerCount} farmers near {cluster.placeName} want a{' '}
                {MACHINE_LABEL[cluster.category].toLowerCase()} around the same days
                {cluster.totalAcres > 0 ? ` · ${cluster.totalAcres} acres between them` : ''}.
                Providers travel further when there is more than one field to do.
              </Txt>
            </View>
          </Banner>
        ) : null}

        {!site ? (
          <EmptyState
            icon="location-off"
            title="We need to know where your field is"
            message="Set your location in Profile and providers near you will appear here with a price for your job."
            action={
              <Button
                label="Set my location"
                icon="edit-location"
                onPress={() => router.push('/(farmer)/profile')}
              />
            }
          />
        ) : search.loading ? (
          <SkeletonList count={3} />
        ) : search.error ? (
          <ErrorView error={search.error} onRetry={search.refresh} />
        ) : machines.length === 0 ? (
          <EmptyState
            icon="agriculture"
            title={`No ${MACHINE_LABEL[category].toLowerCase()} listed near you`}
            message="Providers are added as they join. Try another day, another machine, or check back — we will keep looking."
            action={<Button label="Check again" icon="refresh" onPress={search.refresh} />}
          />
        ) : (
          <>
            <SectionHeader
              title={`${available.length} available ${
                available.length === 1 ? 'provider' : 'providers'
              }`}
            />

            {available.map((machine) => (
              <MachineCard
                key={machine._id}
                machine={machine}
                onPress={() =>
                  router.push({
                    pathname: '/(farmer)/services/[id]',
                    params: {
                      id: machine._id,
                      start: jobWindow.start.toISOString(),
                      end: jobWindow.end.toISOString(),
                      operatorMode,
                      acres,
                    },
                  })
                }
              />
            ))}

            {/* busy providers are shown, dimmed — a farmer should know they exist */}
            {busy.length > 0 ? (
              <>
                <SectionHeader title="Busy at that time" />
                {busy.map((machine) => (
                  <MachineCard key={machine._id} machine={machine} dimmed />
                ))}
              </>
            ) : null}
          </>
        )}
      </Screen>

      <Sheet
        visible={filtersOpen}
        onClose={() => setFiltersOpen(false)}
        title="Your job"
        subtitle="Providers are priced for exactly this — change it and the prices change."
      >
        <Txt variant="labelLg" color={colors.onSurfaceVariant}>
          Time of day
        </Txt>
        <View style={{ flexDirection: 'row', gap: space.sm, marginVertical: space.sm }}>
          {SLOTS.map((s) => (
            <Chip key={s.key} label={s.label} selected={slot === s.key} onPress={() => setSlot(s.key)} />
          ))}
        </View>

        <Txt variant="labelLg" color={colors.onSurfaceVariant}>
          Operator
        </Txt>
        <View style={{ flexDirection: 'row', gap: space.sm, marginVertical: space.sm }}>
          <Chip
            label="With operator"
            selected={operatorMode === 'WITH_OPERATOR'}
            onPress={() => setOperatorMode('WITH_OPERATOR')}
          />
          <Chip
            label="I will drive"
            selected={operatorMode === 'SELF_DRIVE'}
            onPress={() => setOperatorMode('SELF_DRIVE')}
          />
        </View>

        <Field
          label="Area (acres) — for machines priced per acre"
          value={acres}
          onChangeText={(text) => setAcres(text.replace(/[^0-9.]/g, ''))}
          keyboardType="decimal-pad"
          placeholder="e.g. 3"
        />

        <Button label="Show providers" icon="search" onPress={() => setFiltersOpen(false)} />
      </Sheet>

      <BottomNav role="farmer" active="home" />
    </View>
  );
}

/** One provider, priced for the job the farmer described. */
function MachineCard({
  machine,
  onPress,
  dimmed = false,
}: {
  machine: MachineSearchResult;
  onPress?: () => void;
  dimmed?: boolean;
}) {
  const quote = machine.quote;
  const unit = machine.pricing.unit;

  return (
    <Card onPress={onPress} style={dimmed ? { opacity: 0.55 } : undefined}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: space.gutter }}>
        <IconBadge icon={MACHINE_ICON[machine.category]} tone={dimmed ? 'muted' : 'primary'} />
        <View style={{ flex: 1 }}>
          <Txt variant="labelLg">{machine.title}</Txt>
          <Txt variant="labelSm" color={colors.onSurfaceVariant}>
            {MACHINE_LABEL[machine.category]}
            {MACHINE_NATIVE[machine.category] ? ` · ${MACHINE_NATIVE[machine.category]}` : ''}
          </Txt>
        </View>
        {dimmed ? <StatusBadge status="PENDING" label="Busy" /> : null}
      </View>

      {/* the price for THIS job, which is the only number that compares */}
      {quote ? (
        <View style={s.priceBlock}>
          <Txt variant="labelSm" color={colors.onPrimaryContainer}>
            For your job
          </Txt>
          <Txt variant="displayLg" color={colors.onPrimary}>
            {rupees(quote.total)}
          </Txt>
          <Txt variant="labelSm" color={colors.onPrimaryContainer}>
            {UNIT_NOUN[unit](quote.billableUnits)} at {rupees(quote.rate)} {UNIT_LABEL[unit]}
            {quote.travelCost > 0 ? ` + ${rupees(quote.travelCost)} travel` : ''}
          </Txt>
        </View>
      ) : null}

      <Divider />
      <Row label="Comes from" value={`${km(machine.distanceKm)} away`} />
      {machine.owner ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, marginTop: space.xs }}>
          <Txt variant="bodyMd" style={{ flex: 1 }} numberOfLines={1}>
            {machine.owner.name}
          </Txt>
          <RatingStars value={machine.owner.ratingAvg} />
          <Txt variant="labelSm" color={colors.onSurfaceVariant}>
            {machine.completedJobs} job{machine.completedJobs === 1 ? '' : 's'}
          </Txt>
        </View>
      ) : null}

      {!dimmed && onPress ? (
        <Button label="See details & book" icon="event-available" onPress={onPress} style={{ marginTop: space.gutter }} />
      ) : null}
    </Card>
  );
}

const s = {
  priceBlock: {
    marginTop: space.gutter,
    backgroundColor: colors.primaryContainer,
    borderRadius: radius.lg,
    padding: space.gutter,
  },
};
