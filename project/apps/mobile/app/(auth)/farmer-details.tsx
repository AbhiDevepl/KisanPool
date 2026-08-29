/** f0.4_farmer_details — name plus the default pickup location (editable, not GPS-forced). */
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import * as Location from 'expo-location';
import type { GeoPoint } from '@kisanpool/shared';
import { api } from '../../lib/api';
import { toAppError } from '../../lib/errors';
import { Button, Card, Field, Header, Screen, Txt } from '../../components/ui';
import { LocationPicker } from '../../components/LocationPicker';
import { colors, space } from '../../theme';

export default function FarmerDetails() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [place, setPlace] = useState<GeoPoint | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  // GPS is only a SUGGESTION for the initial value — the farmer confirms or
  // replaces it in the picker. It is never forced.
  useEffect(() => {
    void (async () => {
      try {
        const permission = await Location.requestForegroundPermissionsAsync();
        if (permission.status !== 'granted') return;
        const position = await Location.getCurrentPositionAsync({});
        const coords = { lat: position.coords.latitude, lng: position.coords.longitude };
        let placeName = '';
        try {
          const [p] = await Location.reverseGeocodeAsync(position.coords);
          if (p) placeName = [p.name ?? p.district ?? p.city, p.region].filter(Boolean).join(', ');
        } catch {
          /* a name is optional */
        }
        setPlace((prev) => prev ?? { name: placeName || 'My farm', ...coords });
      } catch {
        // location is a convenience here; the farmer can search or drop a pin
      }
    })();
  }, []);

  const save = async (): Promise<void> => {
    setBusy(true);
    setError(undefined);
    try {
      await api.updateMe({
        name,
        ...(place ? { defaultLocation: place } : {}),
      });
      router.replace('/(auth)/success');
    } catch (err) {
      setError(toAppError(err).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen
      footer={
        <Button
          label="Continue"
          loading={busy}
          disabled={!name.trim()}
          onPress={() => void save()}
        />
      }
    >
      <Header title="About you" subtitle="तुमची माहिती" />

      <Field
        label="Your name"
        value={name}
        onChangeText={setName}
        placeholder="e.g. Rahul Patil"
        error={error}
      />

      <Txt variant="labelLg" color={colors.onSurfaceVariant} style={{ marginBottom: space.sm }}>
        Default pickup place
      </Txt>
      <Card onPress={() => setPickerOpen(true)}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
          <View style={{ flex: 1 }}>
            <Txt variant="labelLg">{place?.name ?? 'Set your pickup place'}</Txt>
            <Txt variant="labelSm" color={colors.onSurfaceVariant}>
              So you do not have to type your village on every request. Search, drop a pin, or use
              GPS — you can change it any time.
            </Txt>
          </View>
          <Txt variant="labelLg" color={colors.primary}>
            {place ? 'Change' : 'Set'}
          </Txt>
        </View>
      </Card>

      <LocationPicker
        visible={pickerOpen}
        onClose={() => setPickerOpen(false)}
        initial={place}
        title="Your default pickup place"
        confirmLabel="Save this place"
        onPick={setPlace}
      />
    </Screen>
  );
}
