/**
 * F3 · Mandi details — is this the right market to send my produce to?
 *
 * Hero, open/closed state, the three facts that describe the yard, today's price
 * table with a trend per commodity, why this mandi, and a pinned "Select this
 * mandi" CTA that carries the destination into the new-request form.
 *
 * A sub-page: back arrow, no bottom navigation (Stitch F3).
 */
import { useCallback, useEffect, useState } from 'react';
import { View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';
import { getUser } from '../../../lib/session';
import { getFavourites, toggleFavourite } from '../../../lib/favourites';
import { api } from '../../../lib/api';
import { km, rupees } from '../../../lib/format';
import {
  distanceFrom,
  durationLabel,
  findMandi,
  travelMinutes,
  type Mandi,
  type Trend,
} from '../../../lib/mandis';
import {
  Button,
  Card,
  Divider,
  EmptyState,
  FavouriteStar,
  Header,
  Screen,
  Toast,
  Txt,
} from '../../../components/ui';
import { TripMap } from '../../../components/TripMap';
import { colors, radius, space } from '../../../theme';

const TREND_ICON: Record<Trend, keyof typeof MaterialIcons.glyphMap> = {
  UP: 'trending-up',
  FLAT: 'trending-flat',
  DOWN: 'trending-down',
};

const TREND_COLOR: Record<Trend, string> = {
  UP: '#0d631b',
  FLAT: '#707a6c',
  DOWN: '#ba1a1a',
};

const VALUE_PROPS = [
  { icon: 'trending-up' as const, label: 'High\ndemand' },
  { icon: 'verified-user' as const, label: 'Good\nprices' },
  { icon: 'payments' as const, label: 'Regular\npayments' },
  { icon: 'groups' as const, label: 'More\nbuyers' },
];

export default function MandiDetails() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [mandi, setMandi] = useState<Mandi | null>(() => findMandi(id) ?? null);

  const [origin, setOrigin] = useState<{ lat: number; lng: number } | null>(null);
  const [favourite, setFavourite] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    void getUser().then((user) => {
      if (user?.defaultLocation) {
        setOrigin({ lat: user.defaultLocation.lat, lng: user.defaultLocation.lng });
      }
    });
    void getFavourites().then((ids) => setFavourite(ids.includes(id)));
    void api
      .mandi(id)
      .then((dto) =>
        setMandi({
          id: dto._id,
          name: dto.name,
          district: dto.city,
          state: dto.state,
          lat: dto.location.lat,
          lng: dto.location.lng,
          categories: [],
          crops: dto.crops ?? [],
          hours: 'Hours vary — check locally',
          opensAt: 0,
          closesAt: 24 * 60,
          demand: 'MEDIUM',
          prices: [],
        }),
      )
      .catch(() => undefined);
  }, [id]);

  const star = useCallback(async () => {
    if (!mandi) return;
    const next = await toggleFavourite(mandi.id);
    const on = next.includes(mandi.id);
    setFavourite(on);
    setToast(on ? `${mandi.name} saved to favourites` : `${mandi.name} removed`);
  }, [mandi]);

  if (!mandi) {
    return (
      <Screen>
        <Header title="Mandi" onBack={() => router.back()} />
        <EmptyState
          icon="search-off"
          title="Mandi not found"
          message="That market is not in our list any more."
          action={<Button label="Browse mandis" onPress={() => router.replace('/(farmer)/mandis')} />}
        />
      </Screen>
    );
  }

  const distanceKm = origin ? distanceFrom(origin, mandi) : null;

  return (
    <View style={{ flex: 1 }}>
      <Screen
        footer={
          <View>
            <Button
              label="Select this mandi"
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
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs, justifyContent: 'center', marginTop: space.sm }}>
              <MaterialIcons name="lock" size={14} color={colors.outline} />
              <Txt variant="labelSm" color={colors.outline}>
                You can change the mandi later, before booking
              </Txt>
            </View>
          </View>
        }
      >
        <Header
          title="Mandi details"
          onBack={() => router.back()}
          right={<FavouriteStar active={favourite} onPress={() => void star()} />}
        />

        <TripMap
          pickup={origin ? { ...origin, title: 'You' } : null}
          destination={{ lat: mandi.lat, lng: mandi.lng, title: mandi.name }}
          markerVariant="shop"
          height={180}
        />

        <View style={{ marginTop: space.md }}>
          <Txt variant="headlineLg">{mandi.name}</Txt>
          <Txt variant="bodyMd" color={colors.onSurfaceVariant}>
            {mandi.district}, {mandi.state}
          </Txt>

          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginTop: space.sm }}>
            {distanceKm != null ? (
              <View style={[s.pill, { backgroundColor: colors.surfaceContainerLow }]}>
                <MaterialIcons name="directions-car" size={14} color={colors.onSurfaceVariant} />
                <Txt variant="labelSm" color={colors.onSurfaceVariant}>
                  {km(distanceKm)} · {durationLabel(travelMinutes(distanceKm))}
                </Txt>
              </View>
            ) : null}

            {mandi.crops.length ? (
              <View style={[s.pill, { backgroundColor: colors.secondaryContainer }]}>
                <MaterialIcons name="eco" size={14} color={colors.onSecondaryContainer} />
                <Txt variant="labelSm" color={colors.onSecondaryContainer}>
                  {mandi.crops.slice(0, 3).join(', ')}
                </Txt>
              </View>
            ) : null}
          </View>
        </View>

        {/* today's rates — only when the mandi carries price bands */}
        {mandi.prices.length > 0 ? (
        <Card style={{ marginTop: space.md }}>
          <Txt variant="headlineMd">Market information</Txt>
          <Txt variant="labelSm" color={colors.onSurfaceVariant}>
            Today's rates, per quintal
          </Txt>
          <Divider />

          <View style={s.tableHead}>
            <Txt variant="labelSm" color={colors.onSurfaceVariant} style={{ flex: 2 }}>
              Commodity
            </Txt>
            <Txt variant="labelSm" color={colors.onSurfaceVariant} style={{ flex: 1, textAlign: 'right' }}>
              Min
            </Txt>
            <Txt variant="labelSm" color={colors.onSurfaceVariant} style={{ flex: 1, textAlign: 'right' }}>
              Max
            </Txt>
            <Txt variant="labelSm" color={colors.onSurfaceVariant} style={{ flex: 1.2, textAlign: 'right' }}>
              Modal
            </Txt>
            <View style={{ width: 24 }} />
          </View>

          {mandi.prices.map((price) => (
            <View key={price.crop} style={s.tableRow}>
              <Txt variant="bodyMd" style={{ flex: 2 }} numberOfLines={1}>
                {price.crop}
              </Txt>
              <Txt variant="bodyMd" color={colors.onSurfaceVariant} style={{ flex: 1, textAlign: 'right' }}>
                {rupees(price.min)}
              </Txt>
              <Txt variant="bodyMd" color={colors.onSurfaceVariant} style={{ flex: 1, textAlign: 'right' }}>
                {rupees(price.max)}
              </Txt>
              <Txt variant="labelLg" style={{ flex: 1.2, textAlign: 'right' }}>
                {rupees(price.modal)}
              </Txt>
              <View style={{ width: 24, alignItems: 'flex-end' }}>
                <MaterialIcons
                  name={TREND_ICON[price.trend]}
                  size={18}
                  color={TREND_COLOR[price.trend]}
                />
              </View>
            </View>
          ))}

          <Txt variant="labelSm" color={colors.outline} style={{ marginTop: space.sm }}>
            Indicative rates for guidance. Your transport cost is calculated separately from
            distance and the vehicle's rate.
          </Txt>
        </Card>
        ) : null}

        {/* why this mandi */}
        <Txt variant="headlineMd" style={{ marginTop: space.md, marginBottom: space.sm }}>
          Why this mandi?
        </Txt>
        <View style={{ flexDirection: 'row', gap: space.sm }}>
          {VALUE_PROPS.map((prop) => (
            <View key={prop.label} style={s.prop}>
              <View style={s.propIcon}>
                <MaterialIcons name={prop.icon} size={20} color={colors.primary} />
              </View>
              <Txt variant="labelSm" style={{ textAlign: 'center' }}>
                {prop.label}
              </Txt>
            </View>
          ))}
        </View>
      </Screen>

      <Toast message={toast} onHide={() => setToast(null)} />
    </View>
  );
}

function Fact({
  icon,
  label,
  value,
}: {
  icon: keyof typeof MaterialIcons.glyphMap;
  label: string;
  value: string;
}) {
  return (
    <View style={s.fact}>
      <View style={s.propIcon}>
        <MaterialIcons name={icon} size={18} color={colors.primary} />
      </View>
      <Txt variant="labelSm" color={colors.onSurfaceVariant}>
        {label}
      </Txt>
      <Txt variant="labelLg">{value}</Txt>
    </View>
  );
}

const s = {
  pill: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: space.xs,
    borderRadius: radius.full,
    paddingHorizontal: space.sm,
    paddingVertical: space.xs,
  },
  fact: {
    flex: 1,
    alignItems: 'center' as const,
    gap: space.xs,
    backgroundColor: colors.surfaceContainerLowest,
    borderWidth: 1,
    borderColor: colors.outlineVariant,
    borderRadius: radius.lg,
    paddingVertical: space.gutter,
  },
  tableHead: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: space.xs,
    paddingBottom: space.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.outlineVariant,
  },
  tableRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: space.xs,
    paddingVertical: space.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.surfaceContainer,
  },
  prop: {
    flex: 1,
    alignItems: 'center' as const,
    gap: space.xs,
    backgroundColor: colors.surfaceContainerLowest,
    borderWidth: 1,
    borderColor: colors.outlineVariant,
    borderRadius: radius.lg,
    paddingVertical: space.gutter,
    paddingHorizontal: space.xs,
  },
  propIcon: {
    width: 36,
    height: 36,
    borderRadius: radius.full,
    backgroundColor: colors.secondaryContainer,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
};
