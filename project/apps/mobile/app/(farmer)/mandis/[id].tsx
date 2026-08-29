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
import { km, rupees } from '../../../lib/format';
import {
  DEMAND_LABEL,
  closingLabel,
  distanceFrom,
  durationLabel,
  findMandi,
  isOpenNow,
  travelMinutes,
  type Demand,
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

/**
 * "Why this mandi?" — the demand tile has to tell the truth.
 *
 * These four were hardcoded, so every market claimed "High demand" including
 * Solapur, which this app's own data marks LOW and whose card two screens back
 * says so. A farmer choosing where to send a lorry-load should not be told two
 * different things by the same app.
 *
 * The other three are genuine properties of an APMC yard rather than claims about
 * one market, so they stay as they are.
 */
const demandProp = (
  demand: Demand,
): { icon: keyof typeof MaterialIcons.glyphMap; label: string } => {
  if (demand === 'HIGH') return { icon: 'trending-up', label: 'High\ndemand' };
  if (demand === 'LOW') return { icon: 'trending-down', label: 'Quieter\nmarket' };
  return { icon: 'trending-flat', label: 'Steady\ndemand' };
};

const STANDING_PROPS = [
  { icon: 'verified-user' as const, label: 'Regulated\nAPMC' },
  { icon: 'payments' as const, label: 'Regular\npayments' },
  { icon: 'groups' as const, label: 'Licensed\nbuyers' },
];

export default function MandiDetails() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const mandi = findMandi(id);

  const [origin, setOrigin] = useState<{ lat: number; lng: number } | null>(null);
  const [favourite, setFavourite] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const [user, ids] = await Promise.all([getUser(), getFavourites()]);
        setOrigin(
          user?.defaultLocation
            ? { lat: user.defaultLocation.lat, lng: user.defaultLocation.lng }
            : null,
        );
        setFavourite(ids.includes(id));
      } catch {
        // local storage only — the screen renders fine without either
      }
    })();
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
  const open = isOpenNow(mandi);

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
          height={180}
        />

        <View style={{ marginTop: space.md }}>
          <Txt variant="headlineLg">{mandi.name}</Txt>
          <Txt variant="bodyMd" color={colors.onSurfaceVariant}>
            {mandi.district}, {mandi.state}
          </Txt>

          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginTop: space.sm }}>
            <View style={[s.pill, { backgroundColor: open ? colors.secondaryContainer : colors.surfaceContainerHigh }]}>
              <View
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: radius.full,
                  backgroundColor: open ? colors.primary : colors.outline,
                }}
              />
              <Txt variant="labelSm" color={open ? colors.onSecondaryContainer : colors.onSurfaceVariant}>
                {open ? `Open now · closes ${closingLabel(mandi)}` : `Closed · opens ${mandi.hours.split('–')[0].trim()}`}
              </Txt>
            </View>

            {distanceKm != null ? (
              <View style={[s.pill, { backgroundColor: colors.surfaceContainerLow }]}>
                <MaterialIcons name="directions-car" size={14} color={colors.onSurfaceVariant} />
                <Txt variant="labelSm" color={colors.onSurfaceVariant}>
                  {km(distanceKm)} · {durationLabel(travelMinutes(distanceKm))}
                </Txt>
              </View>
            ) : null}

            <View style={[s.pill, { backgroundColor: colors.warningContainer }]}>
              <MaterialIcons name="trending-up" size={14} color={colors.onWarningContainer} />
              <Txt variant="labelSm" color={colors.onWarningContainer}>
                {DEMAND_LABEL[mandi.demand]}
              </Txt>
            </View>
          </View>
        </View>

        {/* the three facts that describe the yard */}
        <View style={{ flexDirection: 'row', gap: space.sm, marginTop: space.md }}>
          <Fact icon="calendar-month" label="Established" value={String(mandi.establishedYear)} />
          <Fact icon="map" label="Area" value={`${mandi.areaAcres} acres`} />
          <Fact
            icon="group"
            label="Farmers"
            value={`${(mandi.registeredFarmers / 1000).toFixed(1)}k+`}
          />
        </View>

        {/* today's rates */}
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

        {/* why this mandi */}
        <Txt variant="headlineMd" style={{ marginTop: space.md, marginBottom: space.sm }}>
          Why this mandi?
        </Txt>
        <View style={{ flexDirection: 'row', gap: space.sm }}>
          {[demandProp(mandi.demand), ...STANDING_PROPS].map((prop) => (
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
