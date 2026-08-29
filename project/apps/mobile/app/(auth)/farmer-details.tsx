/** f0.4_farmer_details — name plus the default pickup location. */
import { useEffect, useState } from 'react';
import { useRouter } from 'expo-router';
import * as Location from 'expo-location';
import { api } from '../../lib/api';
import { toAppError } from '../../lib/errors';
import { Button, Field, Header, Screen, Txt } from '../../components/ui';
import { TripMap } from '../../components/TripMap';
import { colors, space } from '../../theme';

export default function FarmerDetails() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [placeName, setPlaceName] = useState('');
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    void (async () => {
      try {
        const permission = await Location.requestForegroundPermissionsAsync();
        if (permission.status !== 'granted') return;

        const position = await Location.getCurrentPositionAsync({});
        setCoords({ lat: position.coords.latitude, lng: position.coords.longitude });

        const [place] = await Location.reverseGeocodeAsync(position.coords);
        if (place) setPlaceName([place.district ?? place.city, place.region].filter(Boolean).join(', '));
      } catch {
        // location is a convenience here; the farmer can type the place instead
      }
    })();
  }, []);

  const save = async (): Promise<void> => {
    setBusy(true);
    setError(undefined);
    try {
      await api.updateMe({
        name,
        ...(coords ? { defaultLocation: { name: placeName || 'My farm', ...coords } } : {}),
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

      <Field
        label="Default pickup place"
        value={placeName}
        onChangeText={setPlaceName}
        placeholder="e.g. Pimpri, Pune"
      />

      <Txt variant="labelSm" color={colors.onSurfaceVariant} style={{ marginBottom: space.sm }}>
        We use this so you do not have to type your village on every request.
      </Txt>

      <TripMap pickup={coords ? { ...coords, title: placeName } : null} height={200} />
    </Screen>
  );
}
