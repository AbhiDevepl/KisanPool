/**
 * f0.4b_machine_register — the machinery/service provider's onboarding step.
 *
 * A provider is a FARMER account (ADR-038: owning a machine is a fact about the
 * data, not a new role), so instead of "your default pickup" this collects the
 * one machine that makes them supply. They can list more later from Farm Services.
 */
import { useState } from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import {
  MACHINE_CATEGORIES,
  OPERATOR_MODES,
  PRICING_UNITS,
  type GeoPoint,
  type MachineCategory,
  type OperatorMode,
  type PricingUnit,
} from '@kisanpool/shared';
import { api } from '../../lib/api';
import { toAppError } from '../../lib/errors';
import { MACHINE_LABEL, OPERATOR_LABEL, UNIT_LABEL } from '../../lib/machinery';
import { Button, Card, Chip, Field, Header, Screen, Txt } from '../../components/ui';
import { LocationPicker } from '../../components/LocationPicker';
import { colors, space } from '../../theme';

/** The categories worth a chip on a small screen; every other one is under "More". */
const QUICK: MachineCategory[] = [
  'TRACTOR_TROLLEY',
  'COMBINE_HARVESTER',
  'ROTAVATOR',
  'THRESHER',
  'SEED_DRILL',
  'SPRAYER',
];

export default function MachineRegister() {
  const router = useRouter();

  const [name, setName] = useState('');
  const [category, setCategory] = useState<MachineCategory>('TRACTOR_TROLLEY');
  const [showAllCategories, setShowAllCategories] = useState(false);
  const [title, setTitle] = useState('');
  const [operatorMode, setOperatorMode] = useState<OperatorMode>('WITH_OPERATOR');
  const [base, setBase] = useState<GeoPoint | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [radiusKm, setRadiusKm] = useState('25');
  const [unit, setUnit] = useState<PricingUnit>('PER_ACRE');
  const [rate, setRate] = useState('');
  const [minCharge, setMinCharge] = useState('');
  const [travelRate, setTravelRate] = useState('');

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const valid =
    name.trim().length > 1 &&
    title.trim().length > 2 &&
    base != null &&
    Number(radiusKm) >= 1 &&
    Number(rate) >= 1;

  const save = async (): Promise<void> => {
    if (!valid || !base) return;
    setBusy(true);
    setError(undefined);
    try {
      await api.updateMe({ name: name.trim() });
      await api.listMachine({
        category,
        title: title.trim(),
        operatorMode,
        baseLocation: base,
        serviceRadiusKm: Number(radiusKm),
        pricing: {
          unit,
          rate: Number(rate),
          minimumCharge: Number(minCharge) || 0,
          travelRatePerKm: Number(travelRate) || 0,
        },
      });
      router.replace('/(auth)/success');
    } catch (err) {
      setError(toAppError(err).message);
    } finally {
      setBusy(false);
    }
  };

  const categories = showAllCategories ? [...MACHINE_CATEGORIES] : QUICK;

  return (
    <Screen
      footer={
        <Button label="List my machine" loading={busy} disabled={!valid} onPress={() => void save()} />
      }
    >
      <Header title="List your machine" subtitle="तुमचं यंत्र नोंदवा" onBack={() => router.back()} />

      <Field
        label="Your name"
        value={name}
        onChangeText={setName}
        placeholder="e.g. Krishi Seva Kendra"
        error={error}
      />

      <Txt variant="labelLg" color={colors.onSurfaceVariant} style={{ marginBottom: space.sm }}>
        What is it?
      </Txt>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginBottom: space.sm }}>
        {categories.map((c) => (
          <Chip
            key={c}
            label={MACHINE_LABEL[c]}
            selected={category === c}
            onPress={() => setCategory(c)}
          />
        ))}
        {!showAllCategories ? (
          <Chip label="More…" selected={false} onPress={() => setShowAllCategories(true)} />
        ) : null}
      </View>

      <Field
        label="Give it a name farmers will recognise"
        value={title}
        onChangeText={setTitle}
        placeholder="e.g. Mahindra 575 with rotavator"
        maxLength={80}
      />

      <Txt variant="labelLg" color={colors.onSurfaceVariant} style={{ marginBottom: space.sm }}>
        Operator
      </Txt>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginBottom: space.md }}>
        {OPERATOR_MODES.map((m) => (
          <Chip
            key={m}
            label={OPERATOR_LABEL[m]}
            selected={operatorMode === m}
            onPress={() => setOperatorMode(m)}
          />
        ))}
      </View>

      <Txt variant="labelLg" color={colors.onSurfaceVariant} style={{ marginBottom: space.sm }}>
        Where is it based?
      </Txt>
      <Card onPress={() => setPickerOpen(true)}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
          <View style={{ flex: 1 }}>
            <Txt variant="labelLg">{base?.name ?? 'Set the machine’s home'}</Txt>
            <Txt variant="labelSm" color={colors.onSurfaceVariant}>
              Farmers within your service area will see it. Search, drop a pin, or use GPS.
            </Txt>
          </View>
          <Txt variant="labelLg" color={colors.primary}>
            {base ? 'Change' : 'Set'}
          </Txt>
        </View>
      </Card>

      <Field
        label="How far will you travel to a field? (km)"
        value={radiusKm}
        onChangeText={(t) => setRadiusKm(t.replace(/\D/g, ''))}
        keyboardType="number-pad"
        placeholder="25"
        style={{ marginTop: space.md }}
      />

      <Txt variant="labelLg" color={colors.onSurfaceVariant} style={{ marginBottom: space.sm }}>
        How do you charge?
      </Txt>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginBottom: space.md }}>
        {PRICING_UNITS.map((u) => (
          <Chip key={u} label={UNIT_LABEL[u]} selected={unit === u} onPress={() => setUnit(u)} />
        ))}
      </View>

      <Field
        label={`Rate (₹ ${UNIT_LABEL[unit]})`}
        value={rate}
        onChangeText={(t) => setRate(t.replace(/[^0-9.]/g, ''))}
        keyboardType="decimal-pad"
        placeholder="e.g. 1100"
      />
      <Field
        label="Minimum charge (₹, optional)"
        value={minCharge}
        onChangeText={(t) => setMinCharge(t.replace(/[^0-9.]/g, ''))}
        keyboardType="decimal-pad"
        placeholder="e.g. 2200"
      />
      <Field
        label="Travel charge (₹ per km, optional)"
        value={travelRate}
        onChangeText={(t) => setTravelRate(t.replace(/[^0-9.]/g, ''))}
        keyboardType="decimal-pad"
        placeholder="e.g. 15"
      />
      <Txt variant="labelSm" color={colors.onSurfaceVariant} style={{ marginBottom: space.md }}>
        When several nearby farmers book the same day, KisanPool splits this travel charge across
        their jobs — more work for you, lower cost for each of them.
      </Txt>

      <LocationPicker
        visible={pickerOpen}
        onClose={() => setPickerOpen(false)}
        initial={base}
        title="Where is the machine based?"
        confirmLabel="Use this location"
        onPick={setBase}
      />
    </Screen>
  );
}
