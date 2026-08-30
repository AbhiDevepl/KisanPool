/**
 * The primary navigation for both roles.
 *
 * FARMER       Home · Bookings · Mandi · Support · Profile
 * TRANSPORTER  Dashboard · Requests · Trips · Earnings · Profile
 *
 * These five are the app's product areas — they are NOT sections of one screen.
 * The previous build had no navigation at all, so Home and Dashboard had grown
 * into single screens containing every feature; splitting them is the whole point
 * of this component (Stitch F1 / transporter_dashboard bottom bars).
 *
 * Sub-pages (a trip, a mandi, the new-request form) deliberately do not render it
 * — the Stitch exports suppress the bar on any screen reached by a back arrow.
 */
import { memo, useEffect } from 'react';
import { BackHandler, Pressable, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, layout, radius, space } from '../theme';
import { Txt } from './ui';

export type FarmerTab = 'home' | 'bookings' | 'mandi' | 'support' | 'profile';
export type TransporterTab = 'dashboard' | 'requests' | 'trips' | 'earnings' | 'profile';

interface Item {
  key: string;
  label: string;
  icon: keyof typeof MaterialIcons.glyphMap;
  href: string;
}

const FARMER_ITEMS: Item[] = [
  { key: 'home', label: 'Home', icon: 'home', href: '/(farmer)/home' },
  { key: 'bookings', label: 'Bookings', icon: 'assignment', href: '/(farmer)/bookings' },
  { key: 'mandi', label: 'Mandi', icon: 'storefront', href: '/(farmer)/mandis' },
  { key: 'support', label: 'Support', icon: 'support-agent', href: '/(farmer)/support' },
  { key: 'profile', label: 'Profile', icon: 'person', href: '/(farmer)/profile' },
];

const TRANSPORTER_ITEMS: Item[] = [
  { key: 'dashboard', label: 'Dashboard', icon: 'dashboard', href: '/(transporter)/home' },
  { key: 'requests', label: 'Requests', icon: 'local-shipping', href: '/(transporter)/requests' },
  { key: 'trips', label: 'Trips', icon: 'route', href: '/(transporter)/trips' },
  { key: 'earnings', label: 'Earnings', icon: 'payments', href: '/(transporter)/earnings' },
  { key: 'profile', label: 'Profile', icon: 'person', href: '/(transporter)/profile' },
];

/** Counts that belong on a tab, e.g. offers the farmer has not answered yet. */
export type NavBadges = Record<string, number | undefined>;

function BottomNavImpl({
  role,
  active,
  badges,
}: {
  role: 'farmer' | 'transporter';
  active: FarmerTab | TransporterTab;
  badges?: NavBadges;
}) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const items = role === 'farmer' ? FARMER_ITEMS : TRANSPORTER_ITEMS;
  const root = items[0];

  /*
   * Android hardware back.
   *
   * Tabs navigate with `replace`, so the stack holds one entry and back would
   * otherwise quit the app from wherever the user happens to be. Returning to
   * the role's root tab first is what every tabbed app does, and it means back
   * only ever exits from Home / Dashboard.
   */
  useEffect(() => {
    if (active === root.key) return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      router.replace(root.href as never);
      return true; // handled — do not fall through to "exit app"
    });
    return () => subscription.remove();
  }, [active, root, router]);

  return (
    <View
      accessibilityRole="tablist"
      style={[s.bar, { paddingBottom: Math.max(insets.bottom, space.sm) }]}
    >
      {items.map((item) => {
        const selected = item.key === active;
        const badge = badges?.[item.key] ?? 0;
        const labelWithBadge =
          badge > 0
            ? `${item.label}, ${badge > 9 ? '10 or more unread' : `${badge} unread`}`
            : item.label;

        return (
          <Pressable
            key={item.key}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            accessibilityLabel={labelWithBadge}
            accessibilityHint={`Navigates to ${item.label} tab`}
            // replace, not push — tabs are siblings, so the back stack stays flat
            onPress={() => (selected ? null : router.replace(item.href as never))}
            style={({ pressed }) => [
              s.item,
              selected ? s.itemActive : null,
              { opacity: pressed ? 0.7 : 1 },
            ]}
          >
            <View>
              <MaterialIcons
                name={item.icon}
                size={24}
                color={selected ? colors.primary : colors.onSurfaceVariant}
              />
              {badge > 0 ? (
                <View style={s.badge}>
                  <Txt variant="labelSm" color={colors.onError}>
                    {badge > 9 ? '9+' : String(badge)}
                  </Txt>
                </View>
              ) : null}
            </View>
            <Txt
              variant="labelSm"
              color={selected ? colors.primary : colors.onSurfaceVariant}
              style={selected ? { fontWeight: '700' } : undefined}
            >
              {item.label}
            </Txt>
          </Pressable>
        );
      })}
    </View>
  );
}

export const BottomNav = memo(BottomNavImpl);

const s = StyleSheet.create({
  bar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    paddingTop: space.sm,
    paddingHorizontal: space.xs,
    backgroundColor: colors.surfaceContainerLowest,
    borderTopWidth: 1,
    borderTopColor: colors.outlineVariant,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    // the bar overlays the scroll view, so it has to win touch dispatch on both
    // platforms: zIndex orders it on iOS, elevation does the same on Android
    shadowColor: '#000000',
    shadowOpacity: 0.05,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: -4 },
    elevation: 12,
  },
  item: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    minHeight: layout.minTouchTarget,
    borderRadius: radius.md,
    paddingVertical: space.xs,
    marginHorizontal: 2,
  },
  itemActive: { backgroundColor: colors.secondaryContainer },
  badge: {
    position: 'absolute',
    top: -5,
    right: -8,
    minWidth: 18,
    height: 18,
    paddingHorizontal: 4,
    borderRadius: radius.full,
    backgroundColor: colors.error,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

