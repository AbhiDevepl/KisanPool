/**
 * F2 · Mandi discovery — search, filter, map, ranked recommendations.
 *
 * A primary tab, so it keeps the bottom navigation (the Stitch export drew this
 * as a back-arrow sub-page; as a product area it needs the bar).
 *
 * Every number on a card — distance, travel time, modal rate, demand — comes from
 * lib/mandis.ts against the farmer's own pickup point. Nothing is a literal here.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';
import { getUser } from '../../../lib/session';
import { getFavourites, toggleFavourite } from '../../../lib/favourites';
import { km, rupees } from '../../../lib/format';
import {
  CATEGORIES,
  DEMAND_LABEL,
  durationLabel,
  rankMandis,
  topModalPrice,
  type Category,
  type RankedMandi,
} from '../../../lib/mandis';
import {
  AppBar,
  Card,
  EmptyState,
  FavouriteStar,
  FilterRow,
  IconBadge,
  Screen,
  SearchField,
  SectionHeader,
  SkeletonList,
  StatusBadge,
  Toast,
  Txt,
  Button,
} from '../../../components/ui';
import { TripMap } from '../../../components/TripMap';
import { BottomNav } from '../../../components/BottomNav';
import { colors, space } from '../../../theme';

export default function MandiDiscovery() {
  const router = useRouter();
  const params = useLocalSearchParams<{ filter?: string }>();

  const [origin, setOrigin] = useState<{ lat: number; lng: number } | null>(null);
  const [favourites, setFavourites] = useState<string[]>([]);
  const [category, setCategory] = useState<'All' | Category>('All');
  const [query, setQuery] = useState('');
  const [onlyFavourites, setOnlyFavourites] = useState(params.filter === 'favourites');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  /**
   * Re-read on every focus, not once on mount.
   *
   * Both of these change on OTHER screens: a farmer stars a mandi on its detail
   * page, or sets their pickup location in Profile. Reading them in a mount-only
   * effect meant coming back here showed the star they had just toggled in its
   * old state, and distances that were still sorted against no location at all.
   */
  const load = useCallback(async () => {
    try {
      const [user, saved] = await Promise.all([getUser(), getFavourites()]);
      setOrigin(
        user?.defaultLocation
          ? { lat: user.defaultLocation.lat, lng: user.defaultLocation.lng }
          : null,
      );
      setFavourites(saved);
    } catch {
      // both reads are local storage; a failure just means no location and no
      // favourites, which the screen already renders correctly
      setFavourites([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  // the tab may be re-entered with ?filter=favourites while already mounted, and
  // useState only reads its initial value once
  useEffect(() => {
    setOnlyFavourites(params.filter === 'favourites');
  }, [params.filter]);

  const ranked = useMemo(
    () => rankMandis(origin, favourites, { category, query }),
    [origin, favourites, category, query],
  );

  const list = onlyFavourites ? ranked.filter((mandi) => mandi.favourite) : ranked;

  const star = useCallback(
    async (mandi: RankedMandi) => {
      const next = await toggleFavourite(mandi.id);
      setFavourites(next);
      setToast(next.includes(mandi.id) ? `${mandi.name} saved` : `${mandi.name} removed`);
    },
    [],
  );

  const filters: Array<{ key: 'All' | Category; label: string }> = CATEGORIES.map((item) => ({
    key: item,
    label: item,
  }));

  return (
    <View style={{ flex: 1 }}>
      <Screen
        withNav
        refreshing={refreshing}
        onRefresh={() => {
          setRefreshing(true);
          void load().finally(() => setRefreshing(false));
        }}
        header={
          <>
            <AppBar
              title="Mandis"
              right={
                <Pressable
                  onPress={() => setOnlyFavourites((value) => !value)}
                  hitSlop={10}
                  style={{ padding: space.xs }}
                  accessibilityLabel="Show only favourites"
                >
                  <MaterialIcons
                    name={onlyFavourites ? 'favorite' : 'favorite-border'}
                    size={24}
                    color={onlyFavourites ? colors.error : colors.primary}
                  />
                </Pressable>
              }
            />
            <View style={{ paddingHorizontal: space.md, gap: space.sm, paddingBottom: space.sm }}>
              <SearchField
                value={query}
                onChangeText={setQuery}
                placeholder="Search mandi, district or crop…"
              />
              <FilterRow options={filters} value={category} onChange={setCategory} />
            </View>
          </>
        }
      >
        <TripMap
          pickup={origin ? { ...origin, title: 'You' } : null}
          markers={list.map((mandi) => ({ lat: mandi.lat, lng: mandi.lng, title: mandi.name }))}
          height={200}
          onMarkerPress={(index) => router.push(`/(farmer)/mandis/${list[index].id}`)}
        />

        {!origin ? (
          <Card raised={false} style={{ backgroundColor: colors.infoContainer, borderColor: colors.infoContainer, marginTop: space.gutter }}>
            <View style={{ flexDirection: 'row', gap: space.sm, alignItems: 'center' }}>
              <MaterialIcons name="info" size={18} color={colors.onInfoContainer} />
              <Txt variant="labelSm" color={colors.onInfoContainer} style={{ flex: 1 }}>
                Set your pickup location in Profile and we will sort mandis by how far they are
                from your farm.
              </Txt>
            </View>
          </Card>
        ) : null}

        <SectionHeader
          title={onlyFavourites ? 'Your favourite mandis' : 'Recommended for you'}
        />
        {!onlyFavourites ? (
          <Txt variant="labelSm" color={colors.onSurfaceVariant} style={{ marginTop: -space.xs, marginBottom: space.sm }}>
            Based on your location and today's demand
          </Txt>
        ) : null}

        {loading ? (
          <SkeletonList count={3} />
        ) : list.length === 0 ? (
          onlyFavourites ? (
            <EmptyState
              icon="star-border"
              title="No favourites yet"
              message="Star a mandi and it will be waiting here the next time you send produce."
              action={<Button label="Browse all mandis" onPress={() => setOnlyFavourites(false)} />}
            />
          ) : (
            <EmptyState
              icon="search-off"
              title={
                category === 'All'
                  ? 'No mandi matches that'
                  : `No ${category.toLowerCase()} mandi matches that`
              }
              message={
                query
                  ? `Nothing matching "${query}"${category === 'All' ? '' : ` under ${category}`}. Try another crop or district.`
                  : 'Try another category, or search for a crop or district.'
              }
              action={
                <Button
                  label="Clear filters"
                  icon="refresh"
                  onPress={() => {
                    setQuery('');
                    setCategory('All');
                  }}
                />
              }
            />
          )
        ) : (
          list.map((mandi, index) => {
            const price = topModalPrice(mandi);
            const recommended = !onlyFavourites && index === 0 && origin != null;

            return (
              <Card key={mandi.id} onPress={() => router.push(`/(farmer)/mandis/${mandi.id}`)}>
                <View style={{ flexDirection: 'row', gap: space.gutter }}>
                  <IconBadge icon="storefront" tone={recommended ? 'primary' : 'muted'} />
                  <View style={{ flex: 1 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: space.sm }}>
                      <View style={{ flex: 1 }}>
                        <Txt variant="labelLg" numberOfLines={1}>
                          {mandi.name}
                        </Txt>
                        <Txt variant="labelSm" color={colors.onSurfaceVariant}>
                          {mandi.district}, {mandi.state}
                        </Txt>
                      </View>
                      <FavouriteStar active={mandi.favourite} onPress={() => void star(mandi)} />
                    </View>

                    {recommended ? (
                      <View style={{ marginTop: space.xs }}>
                        <StatusBadge status="SELECTED" label="Recommended" />
                      </View>
                    ) : null}

                    <View style={{ flexDirection: 'row', gap: space.md, marginTop: space.sm }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs }}>
                        <MaterialIcons name="directions-car" size={14} color={colors.onSurfaceVariant} />
                        <Txt variant="labelSm" color={colors.onSurfaceVariant}>
                          {origin ? km(mandi.distanceKm) : '—'}
                        </Txt>
                      </View>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs }}>
                        <MaterialIcons name="schedule" size={14} color={colors.onSurfaceVariant} />
                        <Txt variant="labelSm" color={colors.onSurfaceVariant}>
                          {origin ? durationLabel(mandi.etaMinutes) : '—'}
                        </Txt>
                      </View>
                    </View>

                    <Txt variant="labelSm" color={colors.onSurfaceVariant} numberOfLines={1} style={{ marginTop: 2 }}>
                      {mandi.crops.join(' · ')}
                    </Txt>
                  </View>
                </View>

                <View style={s.metricsRow}>
                  <View>
                    <Txt variant="labelSm" color={colors.onSurfaceVariant}>
                      {price.crop} · modal rate
                    </Txt>
                    <Txt variant="labelLg" color={colors.primary}>
                      {rupees(price.modal)}{' '}
                      <Txt variant="labelSm" color={colors.onSurfaceVariant}>
                        / qtl
                      </Txt>
                    </Txt>
                  </View>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs }}>
                    <MaterialIcons
                      name={
                        mandi.demand === 'HIGH'
                          ? 'trending-up'
                          : mandi.demand === 'LOW'
                            ? 'trending-down'
                            : 'trending-flat'
                      }
                      size={16}
                      color={mandi.demand === 'HIGH' ? colors.primary : colors.onSurfaceVariant}
                    />
                    <Txt
                      variant="labelSm"
                      color={mandi.demand === 'HIGH' ? colors.primary : colors.onSurfaceVariant}
                    >
                      {DEMAND_LABEL[mandi.demand]}
                    </Txt>
                    <MaterialIcons name="chevron-right" size={18} color={colors.outline} />
                  </View>
                </View>
              </Card>
            );
          })
        )}
      </Screen>

      <Toast message={toast} onHide={() => setToast(null)} />
      <BottomNav role="farmer" active="mandi" />
    </View>
  );
}

const s = {
  metricsRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'space-between' as const,
    marginTop: space.gutter,
    paddingTop: space.sm,
    borderTopWidth: 1,
    borderTopColor: colors.surfaceVariant,
  },
};
