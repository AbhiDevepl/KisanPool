/** f2_mandi_discovery — nearby mandis on a map plus a list. */
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';
import { getUser } from '../../../lib/session';
import { km } from '../../../lib/format';
import { MANDIS, type Mandi, distanceFrom } from '../../../lib/mandis';
import { Card, Chip, Header, Screen, Txt } from '../../../components/ui';
import { TripMap } from '../../../components/TripMap';
import { colors, radius, space } from '../../../theme';

const CROPS = ['All', 'Onion', 'Tomato', 'Potato', 'Grapes'];

export default function MandiDiscovery() {
  const router = useRouter();
  const [origin, setOrigin] = useState<{ lat: number; lng: number } | null>(null);
  const [crop, setCrop] = useState('All');

  useEffect(() => {
    void getUser().then((user) => {
      if (user?.defaultLocation) {
        setOrigin({ lat: user.defaultLocation.lat, lng: user.defaultLocation.lng });
      }
    });
  }, []);

  const list: Array<Mandi & { distanceKm: number }> = MANDIS.map((mandi) => ({
    ...mandi,
    distanceKm: origin ? distanceFrom(origin, mandi) : 0,
  }))
    .filter((mandi) => crop === 'All' || mandi.crops.includes(crop))
    .sort((a, b) => a.distanceKm - b.distanceKm);

  return (
    <Screen>
      <Header title="Nearby mandis" subtitle="जवळच्या मंड्या" onBack={() => router.back()} />

      <TripMap
        pickup={origin ? { ...origin, title: 'You' } : null}
        markers={list.map((mandi) => ({ lat: mandi.lat, lng: mandi.lng, title: mandi.name }))}
        height={220}
        onMarkerPress={(index) => router.push(`/(farmer)/mandis/${list[index].id}`)}
      />

      <View style={{ flexDirection: 'row', gap: space.sm, marginVertical: space.md, flexWrap: 'wrap' }}>
        {CROPS.map((item) => (
          <Chip key={item} label={item} selected={crop === item} onPress={() => setCrop(item)} />
        ))}
      </View>

      {list.map((mandi) => (
        <Card key={mandi.id} onPress={() => router.push(`/(farmer)/mandis/${mandi.id}`)}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.gutter }}>
            <View
              style={{
                width: 48,
                height: 48,
                borderRadius: radius.md,
                backgroundColor: colors.surfaceContainer,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <MaterialIcons name="storefront" size={24} color={colors.primary} />
            </View>
            <View style={{ flex: 1 }}>
              <Txt variant="labelLg">{mandi.name}</Txt>
              <Txt variant="labelSm" color={colors.onSurfaceVariant}>
                {mandi.district} · {mandi.crops.join(', ')}
              </Txt>
            </View>
            <Txt variant="labelLg" color={colors.primary}>
              {origin ? km(mandi.distanceKm) : '—'}
            </Txt>
          </View>
        </Card>
      ))}
    </Screen>
  );
}
