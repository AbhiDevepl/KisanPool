/** f3_mandi_details — price band, distance, "Ship here". */
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { getUser } from '../../../lib/session';
import { km, rupees } from '../../../lib/format';
import { MANDIS, distanceFrom } from '../../../lib/mandis';
import { Button, Card, Divider, Header, Row, Screen, Txt } from '../../../components/ui';
import { TripMap } from '../../../components/TripMap';
import { colors, space } from '../../../theme';

export default function MandiDetails() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const mandi = MANDIS.find((m) => m.id === id);
  const [origin, setOrigin] = useState<{ lat: number; lng: number } | null>(null);

  useEffect(() => {
    void getUser().then((user) => {
      if (user?.defaultLocation) {
        setOrigin({ lat: user.defaultLocation.lat, lng: user.defaultLocation.lng });
      }
    });
  }, []);

  if (!mandi) {
    return (
      <Screen>
        <Header title="Mandi" onBack={() => router.back()} />
        <Txt variant="bodyLg">That mandi is not in our list.</Txt>
      </Screen>
    );
  }

  return (
    <Screen
      footer={
        <Button
          label="Ship here"
          onPress={() =>
            router.push({
              pathname: '/(farmer)/requests/new',
              params: {
                destinationName: mandi.name,
                destinationLat: String(mandi.lat),
                destinationLng: String(mandi.lng),
              },
            })
          }
        />
      }
    >
      <Header title={mandi.name} subtitle={mandi.district} onBack={() => router.back()} />

      <TripMap
        pickup={origin ? { ...origin, title: 'You' } : null}
        destination={{ lat: mandi.lat, lng: mandi.lng, title: mandi.name }}
        height={200}
      />

      <Card style={{ marginTop: space.md }}>
        <Txt variant="headlineMd">Today's price band</Txt>
        <Txt variant="labelSm" color={colors.onSurfaceVariant} style={{ marginBottom: space.sm }}>
          Indicative, per quintal
        </Txt>
        <Divider />
        {mandi.prices.map((price) => (
          <Row
            key={price.crop}
            label={price.crop}
            value={`${rupees(price.min)} – ${rupees(price.max)}`}
          />
        ))}
      </Card>

      <Card>
        <Row label="Distance from you" value={origin ? km(distanceFrom(origin, mandi)) : '—'} />
        <Row label="Open" value={mandi.hours} />
        <Row label="Main crops" value={mandi.crops.join(', ')} />
      </Card>
    </Screen>
  );
}
