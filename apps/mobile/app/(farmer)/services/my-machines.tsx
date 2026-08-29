/**
 * My machines — turning an idle asset into supply.
 *
 * This is the screen the whole Farm Resource Network exists for. A tractor in a
 * Maharashtra village works perhaps twenty days a year and is parked for the other
 * three hundred and forty-five; the loan on it does not pause for any of them.
 * Listing it here is the same move KisanPool already makes with a half-empty
 * truck, applied to the other machine standing idle in the yard.
 *
 * Deliberately small. No fleet management, no maintenance logs, no utilisation
 * dashboards — a farmer with one tractor needs to say what it is, what they charge
 * and how far they will travel, and then be left alone until someone books it.
 */
import { useCallback, useState } from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';
import type { MachineCategory, OperatorMode, PricingUnit } from '@kisanpool/shared';
import { DEFAULT_UNIT_FOR, MACHINE_CATEGORIES, PRICING_UNITS } from '@kisanpool/shared';
import { api } from '../../../lib/api';
import { toAppError } from '../../../lib/errors';
import { getUser } from '../../../lib/session';
import { useLoader } from '../../../lib/useLoader';
import { km, rupees } from '../../../lib/format';
import {
  MACHINE_ICON,
  MACHINE_LABEL,
  OPERATOR_LABEL,
  UNIT_LABEL,
} from '../../../lib/machinery';
import {
  Banner,
  Button,
  Card,
  Chip,
  Divider,
  EmptyState,
  Field,
  Header,
  IconBadge,
  Row,
  Screen,
  SectionHeader,
  Sheet,
  SkeletonList,
  StatusBadge,
  Toast,
  Txt,
} from '../../../components/ui';
import { ErrorView } from '../../../components/ErrorView';
import { colors, radius, space } from '../../../theme';

export default function MyMachines() {
  const router = useRouter();
  const [formOpen, setFormOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [toastTone, setToastTone] = useState<'success' | 'error'>('success');
  const [formError, setFormError] = useState<string>();

  // the form
  const [category, setCategory] = useState<MachineCategory>('TRACTOR_TROLLEY');
  const [title, setTitle] = useState('');
  const [makeModel, setMakeModel] = useState('');
  const [operatorMode, setOperatorMode] = useState<OperatorMode>('WITH_OPERATOR');
  const [unit, setUnit] = useState<PricingUnit>('PER_HOUR');
  const [rate, setRate] = useState('');
  const [minimumCharge, setMinimumCharge] = useState('');
  const [travelRate, setTravelRate] = useState('');
  const [radiusKm, setRadiusKm] = useState('25');

  const data = useLoader(
    useCallback(async () => {
      const [machines, earnings, user] = await Promise.all([
        api.myMachines(),
        api.machineEarnings().catch(() => null),
        getUser(),
      ]);
      return { machines, earnings, user };
    }, []),
  );

  const machines = data.data?.machines ?? [];
  const earnings = data.data?.earnings;
  const base = data.data?.user?.defaultLocation ?? null;

  /** Picking a category proposes the unit that category is actually hired in. */
  const pickCategory = (next: MachineCategory): void => {
    setCategory(next);
    setUnit(DEFAULT_UNIT_FOR[next]);
    if (!title.trim()) setTitle(MACHINE_LABEL[next]);
  };

  const save = async (): Promise<void> => {
    if (!base) {
      setFormError('Set your location in Profile first — it is where the machine is based.');
      return;
    }
    setBusy(true);
    setFormError(undefined);
    try {
      await api.listMachine({
        category,
        title: title.trim(),
        makeModel: makeModel.trim() || undefined,
        operatorMode,
        baseLocation: base,
        serviceRadiusKm: Number(radiusKm) || 25,
        pricing: {
          unit,
          rate: Number(rate),
          minimumCharge: Number(minimumCharge) || 0,
          travelRatePerKm: Number(travelRate) || 0,
        },
      });
      setFormOpen(false);
      setTitle('');
      setMakeModel('');
      setRate('');
      setMinimumCharge('');
      setTravelRate('');
      setToastTone('success');
      setToast('Your machine is listed — farmers nearby can find it now');
      data.refresh();
    } catch (err) {
      setFormError(toAppError(err).message);
    } finally {
      setBusy(false);
    }
  };

  const togglePause = async (id: string, paused: boolean): Promise<void> => {
    try {
      await api.updateMachine(id, { status: paused ? 'LISTED' : 'PAUSED' });
      setToastTone('success');
      setToast(paused ? 'Listed again' : 'Paused — no new bookings');
      data.refresh();
    } catch (err) {
      setToastTone('error');
      setToast(toAppError(err).message);
    }
  };

  const valid = title.trim().length >= 3 && Number(rate) > 0;

  return (
    <View style={{ flex: 1 }}>
      <Screen
        refreshing={data.refreshing}
        onRefresh={data.refresh}
        footer={
          <Button
            label="List a machine"
            icon="add"
            onPress={() => {
              setFormError(undefined);
              setFormOpen(true);
            }}
          />
        }
      >
        <Header
          title="My machines"
          subtitle="माझी यंत्रे"
          onBack={() => router.back()}
        />

        {/* the value proposition, stated once and honestly */}
        <Banner tone="primary">
          <View style={{ flexDirection: 'row', gap: space.sm }}>
            <MaterialIcons name="autorenew" size={22} color={colors.onPrimary} />
            <View style={{ flex: 1 }}>
              <Txt variant="labelLg" color={colors.onPrimary}>
                An idle machine earns nothing
              </Txt>
              <Txt variant="bodyMd" color={colors.onPrimaryContainer}>
                Most farm machinery works a few weeks a year. List yours for the weeks you are
                not using it and a neighbour pays for the time it would have stood still.
              </Txt>
            </View>
          </View>
        </Banner>

        {earnings && earnings.total > 0 ? (
          <Card
            style={{
              backgroundColor: colors.primaryContainer,
              borderColor: colors.primaryContainer,
              borderRadius: radius.xl,
            }}
          >
            <Txt variant="bodyMd" color={colors.onPrimaryContainer}>
              Earned from your machines
            </Txt>
            <Txt variant="displayLg" color={colors.onPrimary}>
              {rupees(earnings.total)}
            </Txt>
            <Txt variant="labelSm" color={colors.onPrimaryContainer}>
              across {earnings.jobs.length} job{earnings.jobs.length === 1 ? '' : 's'} ·{' '}
              {rupees(earnings.settled)} settled
            </Txt>
          </Card>
        ) : null}

        <SectionHeader
          title={machines.length > 0 ? `${machines.length} listed` : 'Nothing listed yet'}
          actionLabel={machines.length > 0 ? 'Bookings' : undefined}
          onAction={() => router.push('/(farmer)/services/bookings')}
        />

        {data.loading ? (
          <SkeletonList count={2} />
        ) : data.error ? (
          <ErrorView error={data.error} onRetry={data.refresh} />
        ) : machines.length === 0 ? (
          <EmptyState
            icon="agriculture"
            title="List your first machine"
            message="Tell us what it is, what you charge and how far you will travel. Farmers nearby will see it straight away."
          />
        ) : (
          machines.map((machine) => (
            <Card key={machine._id}>
              <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: space.gutter }}>
                <IconBadge
                  icon={MACHINE_ICON[machine.category]}
                  tone={machine.status === 'LISTED' ? 'primary' : 'muted'}
                />
                <View style={{ flex: 1 }}>
                  <Txt variant="labelLg">{machine.title}</Txt>
                  <Txt variant="labelSm" color={colors.onSurfaceVariant}>
                    {MACHINE_LABEL[machine.category]}
                    {machine.makeModel ? ` · ${machine.makeModel}` : ''}
                  </Txt>
                </View>
                <StatusBadge
                  status={machine.status === 'LISTED' ? 'ASSIGNED' : 'PENDING'}
                  label={machine.status === 'LISTED' ? 'Listed' : 'Paused'}
                />
              </View>

              <Divider />
              <Row
                label="Rate"
                value={`${rupees(machine.pricing.rate)} ${UNIT_LABEL[machine.pricing.unit]}`}
              />
              {machine.pricing.minimumCharge > 0 ? (
                <Row label="Minimum" value={rupees(machine.pricing.minimumCharge)} />
              ) : null}
              {machine.pricing.travelRatePerKm > 0 ? (
                <Row label="Travel" value={`${rupees(machine.pricing.travelRatePerKm)} / km`} />
              ) : null}
              <Row label="Travels up to" value={km(machine.serviceRadiusKm)} />
              <Row label="Operator" value={OPERATOR_LABEL[machine.operatorMode]} />
              <Divider />
              <Row label="Jobs done" value={String(machine.completedJobs)} />
              <Row label="Upcoming" value={String(machine.upcoming)} bold />

              <Button
                label={machine.status === 'LISTED' ? 'Pause new bookings' : 'List it again'}
                variant="secondary"
                icon={machine.status === 'LISTED' ? 'pause' : 'play-arrow'}
                onPress={() => void togglePause(machine._id, machine.status !== 'LISTED')}
                style={{ marginTop: space.gutter }}
              />
              {machine.status === 'PAUSED' ? (
                <Txt variant="labelSm" color={colors.outline} style={{ marginTop: space.xs }}>
                  Bookings already accepted still stand — pausing only stops new ones.
                </Txt>
              ) : null}
            </Card>
          ))
        )}
      </Screen>

      <Sheet
        visible={formOpen}
        onClose={() => setFormOpen(false)}
        title="List a machine"
        subtitle="You set the price. KisanPool never marks it up — it takes a commission from the total."
      >
        <Txt variant="labelLg" color={colors.onSurfaceVariant}>
          What is it?
        </Txt>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginVertical: space.sm }}>
          {MACHINE_CATEGORIES.slice(0, 9).map((item) => (
            <Chip
              key={item}
              label={MACHINE_LABEL[item]}
              selected={category === item}
              onPress={() => pickCategory(item)}
            />
          ))}
        </View>

        <Field
          label="Name it the way farmers would ask for it"
          value={title}
          onChangeText={setTitle}
          placeholder="e.g. Mahindra 575 with trolley"
          maxLength={80}
        />
        <Field
          label="Make and model (optional)"
          value={makeModel}
          onChangeText={setMakeModel}
          placeholder="e.g. Mahindra 575 DI"
          maxLength={60}
        />

        <Txt variant="labelLg" color={colors.onSurfaceVariant}>
          Who drives it?
        </Txt>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginVertical: space.sm }}>
          {(['WITH_OPERATOR', 'SELF_DRIVE', 'EITHER'] as OperatorMode[]).map((mode) => (
            <Chip
              key={mode}
              label={OPERATOR_LABEL[mode]}
              selected={operatorMode === mode}
              onPress={() => setOperatorMode(mode)}
            />
          ))}
        </View>

        <Txt variant="labelLg" color={colors.onSurfaceVariant}>
          How do you charge?
        </Txt>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginVertical: space.sm }}>
          {PRICING_UNITS.map((u) => (
            <Chip key={u} label={UNIT_LABEL[u]} selected={unit === u} onPress={() => setUnit(u)} />
          ))}
        </View>

        <Field
          label={`Your rate (₹ ${UNIT_LABEL[unit]})`}
          value={rate}
          onChangeText={(t) => setRate(t.replace(/[^0-9.]/g, ''))}
          keyboardType="decimal-pad"
          placeholder="e.g. 650"
        />
        <Field
          label="Minimum charge (₹, optional)"
          value={minimumCharge}
          onChangeText={(t) => setMinimumCharge(t.replace(/[^0-9.]/g, ''))}
          keyboardType="decimal-pad"
          placeholder="You will not turn out for less than this"
        />
        <Field
          label="Travel charge (₹ per km, optional)"
          value={travelRate}
          onChangeText={(t) => setTravelRate(t.replace(/[^0-9.]/g, ''))}
          keyboardType="decimal-pad"
          placeholder="Charged both ways to reach the field"
        />
        <Field
          label="How far will you travel? (km)"
          value={radiusKm}
          onChangeText={(t) => setRadiusKm(t.replace(/\D/g, ''))}
          keyboardType="number-pad"
          placeholder="25"
          error={formError}
        />

        {base ? (
          <Txt variant="labelSm" color={colors.outline} style={{ marginBottom: space.sm }}>
            Based at {base.name}. Farmers within {radiusKm || 25} km of there will see it.
          </Txt>
        ) : (
          <Banner tone="warning" style={{ marginBottom: space.sm }}>
            <Txt variant="bodyMd" color={colors.onWarningContainer}>
              Set your location in Profile first — it is where the machine is based.
            </Txt>
          </Banner>
        )}

        <Button
          label="List it"
          icon="check"
          loading={busy}
          disabled={!valid || !base}
          onPress={() => void save()}
        />
      </Sheet>

      <Toast message={toast} tone={toastTone} onHide={() => setToast(null)} />
    </View>
  );
}
