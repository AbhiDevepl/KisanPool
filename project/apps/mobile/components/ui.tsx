/**
 * The shared component set. One implementation, used unchanged by both the
 * (farmer) and (transporter) stacks — nothing here branches on User.role
 * (docs/DESIGN.md §6, ADR-017).
 */
import { MaterialIcons } from '@expo/vector-icons';
import { useEffect, useRef, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Animated,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, elevation, layout, radius, space, type } from '../theme';

// ---------- text ----------

type Variant = keyof typeof type;

export function Txt({
  variant = 'bodyLg',
  color = colors.onSurface,
  style,
  children,
  numberOfLines,
}: {
  variant?: Variant;
  color?: string;
  style?: StyleProp<TextStyle>;
  children: ReactNode;
  numberOfLines?: number;
}) {
  return (
    <Text style={[type[variant] as TextStyle, { color }, style]} numberOfLines={numberOfLines}>
      {children}
    </Text>
  );
}

/** Primary label in the user's language with the English gloss beneath (docs/DESIGN.md §2). */
export function Bilingual({ primary, english }: { primary: string; english: string }) {
  return (
    <View>
      <Txt variant="headlineMd">{primary}</Txt>
      <Txt variant="bilingualSubtext" color={colors.onSurfaceVariant}>
        {english}
      </Txt>
    </View>
  );
}

// ---------- screen shell ----------

export function Screen({
  children,
  scroll = true,
  padded = true,
  footer,
  header,
  onRefresh,
  refreshing = false,
  /** leaves room for <BottomNav />, which floats over the scroll view */
  withNav = false,
}: {
  children: ReactNode;
  scroll?: boolean;
  padded?: boolean;
  footer?: ReactNode;
  /** pinned above the scroll area — a top app bar, a search field, filter chips */
  header?: ReactNode;
  onRefresh?: () => void;
  refreshing?: boolean;
  withNav?: boolean;
}) {
  const body = (
    <View style={[padded && { paddingHorizontal: layout.edgeMargin }, { flex: scroll ? 0 : 1 }]}>
      {children}
    </View>
  );

  return (
    <SafeAreaView style={s.screen} edges={['top', 'left', 'right']}>
      {header}
      {scroll ? (
        <ScrollView
          contentContainerStyle={{ paddingBottom: space.xl + (withNav ? layout.navHeight : 0) }}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          showsVerticalScrollIndicator={false}
          refreshControl={
            onRefresh ? (
              <RefreshControl
                refreshing={refreshing}
                onRefresh={onRefresh}
                tintColor={colors.primary}
                colors={[colors.primary]}
              />
            ) : undefined
          }
        >
          {body}
        </ScrollView>
      ) : (
        body
      )}
      {footer ? <View style={s.footer}>{footer}</View> : null}
    </SafeAreaView>
  );
}

export function Header({
  title,
  subtitle,
  onBack,
  right,
}: {
  title: string;
  subtitle?: string;
  onBack?: () => void;
  right?: ReactNode;
}) {
  return (
    <View style={s.header}>
      {onBack ? (
        <Pressable onPress={onBack} hitSlop={12} style={s.headerBack}>
          <MaterialIcons name="arrow-back" size={24} color={colors.onSurface} />
        </Pressable>
      ) : null}
      <View style={{ flex: 1 }}>
        <Txt variant="headlineMd">{title}</Txt>
        {subtitle ? (
          <Txt variant="bodyMd" color={colors.onSurfaceVariant}>
            {subtitle}
          </Txt>
        ) : null}
      </View>
      {right}
    </View>
  );
}

// ---------- buttons ----------

export function Button({
  label,
  onPress,
  variant = 'primary',
  icon = 'arrow-forward',
  loading = false,
  disabled = false,
  style,
}: {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  icon?: keyof typeof MaterialIcons.glyphMap | null;
  loading?: boolean;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const isDisabled = disabled || loading;

  const palette = {
    primary: { bg: colors.primaryContainer, fg: colors.onPrimary, border: 'transparent' },
    secondary: { bg: colors.surfaceContainerLowest, fg: colors.primary, border: colors.primary },
    ghost: { bg: 'transparent', fg: colors.primary, border: 'transparent' },
    danger: { bg: colors.errorContainer, fg: colors.onErrorContainer, border: 'transparent' },
  }[variant];

  return (
    <Pressable
      onPress={onPress}
      disabled={isDisabled}
      style={({ pressed }) => [
        s.button,
        {
          backgroundColor: palette.bg,
          borderColor: palette.border,
          borderWidth: variant === 'secondary' ? 1 : 0,
          opacity: isDisabled ? 0.5 : pressed ? 0.85 : 1,
        },
        variant === 'primary' && !isDisabled ? elevation.level2 : null,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={palette.fg} />
      ) : (
        <>
          <Txt variant="labelLg" color={palette.fg}>
            {label}
          </Txt>
          {icon ? <MaterialIcons name={icon} size={20} color={palette.fg} /> : null}
        </>
      )}
    </Pressable>
  );
}

// ---------- cards ----------

export function Card({
  children,
  style,
  onPress,
  raised = true,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  onPress?: () => void;
  raised?: boolean;
}) {
  const content = (
    <View style={[s.card, raised ? elevation.level1 : null, style]}>{children}</View>
  );
  if (!onPress) return content;
  return (
    <Pressable onPress={onPress} style={({ pressed }) => ({ opacity: pressed ? 0.9 : 1 })}>
      {content}
    </Pressable>
  );
}

/** 24px radius — the banner/sheet tier of the scale. */
export function Banner({
  children,
  tone = 'primary',
  style,
}: {
  children: ReactNode;
  tone?: 'primary' | 'warning' | 'error' | 'info';
  style?: StyleProp<ViewStyle>;
}) {
  const bg = {
    primary: colors.primaryContainer,
    warning: colors.warningContainer,
    error: colors.errorContainer,
    info: colors.infoContainer,
  }[tone];

  return <View style={[s.banner, { backgroundColor: bg }, style]}>{children}</View>;
}

// ---------- status badge ----------

const BADGE_TONE: Record<string, { bg: string; fg: string }> = {
  // request lifecycle
  OPEN: { bg: colors.infoContainer, fg: colors.onInfoContainer },
  TRANSPORTER_INTERESTED: { bg: colors.warningContainer, fg: colors.onWarningContainer },
  CONFIRMED: { bg: colors.secondaryContainer, fg: colors.onSecondaryContainer },
  EXPIRED: { bg: colors.surfaceContainerHigh, fg: colors.onSurfaceVariant },
  // offer lifecycle
  INTERESTED: { bg: colors.warningContainer, fg: colors.onWarningContainer },
  SELECTED: { bg: colors.secondaryContainer, fg: colors.onSecondaryContainer },
  WITHDRAWN: { bg: colors.surfaceContainerHigh, fg: colors.onSurfaceVariant },
  // trip lifecycle
  FORMING: { bg: colors.infoContainer, fg: colors.onInfoContainer },
  EN_ROUTE: { bg: colors.infoContainer, fg: colors.onInfoContainer },
  AT_DESTINATION: { bg: colors.warningContainer, fg: colors.onWarningContainer },
  COMPLETED: { bg: colors.secondaryContainer, fg: colors.onSecondaryContainer },
  // shipment lifecycle
  ASSIGNED: { bg: colors.infoContainer, fg: colors.onInfoContainer },
  ARRIVED: { bg: colors.warningContainer, fg: colors.onWarningContainer },
  PICKED_UP: { bg: colors.secondaryContainer, fg: colors.onSecondaryContainer },
  PAID: { bg: colors.secondaryContainer, fg: colors.onSecondaryContainer },
  BOOKED: { bg: colors.secondaryContainer, fg: colors.onSecondaryContainer },
  DELIVERED: { bg: colors.secondaryContainer, fg: colors.onSecondaryContainer },
  IN_TRANSIT: { bg: colors.infoContainer, fg: colors.onInfoContainer },
  SEARCHING: { bg: colors.infoContainer, fg: colors.onInfoContainer },
  MATCHED: { bg: colors.warningContainer, fg: colors.onWarningContainer },
  PAYMENT_PENDING: { bg: colors.warningContainer, fg: colors.onWarningContainer },
  PENDING: { bg: colors.warningContainer, fg: colors.onWarningContainer },
  CANCELLED: { bg: colors.errorContainer, fg: colors.onErrorContainer },
  REJECTED: { bg: colors.errorContainer, fg: colors.onErrorContainer },
  VERIFIED: { bg: colors.secondaryContainer, fg: colors.onSecondaryContainer },
};

export function StatusBadge({ status, label }: { status: string; label?: string }) {
  const tone = BADGE_TONE[status] ?? {
    bg: colors.surfaceContainerHigh,
    fg: colors.onSurfaceVariant,
  };
  return (
    <View style={[s.badge, { backgroundColor: tone.bg }]}>
      <Txt variant="labelSm" color={tone.fg}>
        {label ?? status}
      </Txt>
    </View>
  );
}

// ---------- inputs ----------

export function Field({
  label,
  error,
  style,
  ...props
}: TextInputProps & { label: string; error?: string }) {
  return (
    <View style={[{ marginBottom: space.md }, style]}>
      <Txt variant="labelLg" color={colors.onSurfaceVariant} style={{ marginBottom: space.xs }}>
        {label}
      </Txt>
      <TextInput
        placeholderTextColor={colors.outline}
        {...props}
        style={[s.input, error ? { borderColor: colors.error } : null]}
      />
      {error ? (
        <Txt variant="labelSm" color={colors.error} style={{ marginTop: space.xs }}>
          {error}
        </Txt>
      ) : null}
    </View>
  );
}

export function Chip({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={[
        s.chip,
        {
          backgroundColor: selected ? colors.primary : colors.surfaceContainerLowest,
          borderColor: selected ? colors.primary : colors.outlineVariant,
        },
      ]}
    >
      <Txt variant="labelLg" color={selected ? colors.onPrimary : colors.onSurfaceVariant}>
        {label}
      </Txt>
    </Pressable>
  );
}

// ---------- feedback ----------

export function Loading({ label = 'Loading…' }: { label?: string }) {
  return (
    <View style={s.center}>
      <ActivityIndicator color={colors.primary} size="large" />
      <Txt variant="bodyMd" color={colors.onSurfaceVariant} style={{ marginTop: space.sm }}>
        {label}
      </Txt>
    </View>
  );
}

export function EmptyState({
  icon = 'inbox',
  title,
  message,
  action,
}: {
  icon?: keyof typeof MaterialIcons.glyphMap;
  title: string;
  message?: string;
  action?: ReactNode;
}) {
  return (
    <View style={s.center}>
      <MaterialIcons name={icon} size={48} color={colors.outline} />
      <Txt variant="headlineMd" style={{ marginTop: space.md, textAlign: 'center' }}>
        {title}
      </Txt>
      {message ? (
        <Txt
          variant="bodyMd"
          color={colors.onSurfaceVariant}
          style={{ marginTop: space.xs, textAlign: 'center' }}
        >
          {message}
        </Txt>
      ) : null}
      {action ? <View style={{ marginTop: space.lg, alignSelf: 'stretch' }}>{action}</View> : null}
    </View>
  );
}

/** Rating display and input — one component for both (docs/DESIGN.md §6). */
export function RatingStars({
  value,
  size = 16,
  onChange,
}: {
  value: number;
  size?: number;
  onChange?: (stars: number) => void;
}) {
  return (
    <View style={{ flexDirection: 'row', gap: space.xs }}>
      {[1, 2, 3, 4, 5].map((star) => (
        <Pressable
          key={star}
          disabled={!onChange}
          onPress={() => onChange?.(star)}
          hitSlop={onChange ? 8 : 0}
        >
          <MaterialIcons
            name={star <= Math.round(value) ? 'star' : 'star-border'}
            size={size}
            color={star <= Math.round(value) ? colors.tertiaryContainer : colors.outlineVariant}
          />
        </Pressable>
      ))}
    </View>
  );
}

export function Row({
  label,
  value,
  bold = false,
}: {
  label: string;
  value: string;
  bold?: boolean;
}) {
  return (
    <View style={s.row}>
      <Txt variant="bodyMd" color={colors.onSurfaceVariant}>
        {label}
      </Txt>
      <Txt variant={bold ? 'headlineMd' : 'labelLg'}>{value}</Txt>
    </View>
  );
}

export function Divider() {
  return <View style={s.divider} />;
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.gutter,
    paddingVertical: space.md,
  },
  headerBack: {
    width: 40,
    height: 40,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceContainerLowest,
  },
  button: {
    minHeight: layout.minTouchTarget,
    borderRadius: radius.base, // 8px — buttons and inputs
    paddingHorizontal: space.lg,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
  },
  card: {
    backgroundColor: colors.surfaceContainerLowest,
    borderRadius: radius.lg, // 16px — cards
    borderWidth: 1,
    borderColor: colors.outlineVariant,
    padding: space.md,
    marginBottom: space.gutter,
  },
  banner: {
    borderRadius: radius.xl, // 24px — banners and sheets
    padding: space.md,
    marginBottom: space.md,
  },
  badge: {
    borderRadius: radius.md,
    paddingVertical: space.xs,
    paddingHorizontal: space.sm,
    alignSelf: 'flex-start',
  },
  input: {
    minHeight: layout.minTouchTarget,
    borderRadius: radius.base,
    borderWidth: 1,
    borderColor: colors.outlineVariant,
    backgroundColor: colors.surfaceContainerLowest,
    paddingHorizontal: space.gutter,
    fontFamily: type.bodyLg.fontFamily,
    fontSize: 16,
    color: colors.onSurface,
  },
  chip: {
    minHeight: 40,
    borderRadius: radius.full,
    borderWidth: 1,
    paddingHorizontal: space.md,
    justifyContent: 'center',
  },
  center: { alignItems: 'center', justifyContent: 'center', paddingVertical: space.xl * 2 },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: space.sm,
  },
  divider: { height: 1, backgroundColor: colors.outlineVariant, marginVertical: space.sm },
  footer: {
    padding: layout.edgeMargin,
    backgroundColor: colors.background,
    borderTopWidth: 1,
    borderTopColor: colors.outlineVariant,
  },
});

// ---------------------------------------------------------------------------
// The rest of the set, added for the Stitch parity pass. Same rule as above:
// one implementation, no role branching, every value comes from a prop.
// ---------------------------------------------------------------------------

// ---------- top app bar ----------

/**
 * The KisanPool bar that sits above a primary (tab-level) screen: wordmark on the
 * left, notification bell on the right with an unread dot. Sub-pages use <Header />
 * with a back arrow instead — the Stitch exports suppress the bar's nav on those.
 */
export function AppBar({
  title,
  right,
  unread = 0,
  onNotifications,
}: {
  title?: string;
  right?: ReactNode;
  unread?: number;
  onNotifications?: () => void;
}) {
  return (
    <View style={s2.appBar}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, flex: 1 }}>
        <MaterialIcons name="energy-savings-leaf" size={26} color={colors.primary} />
        <Txt variant="headlineLg" color={colors.primary}>
          {title ?? 'KisanPool'}
        </Txt>
      </View>
      {right}
      {onNotifications ? (
        <Pressable onPress={onNotifications} hitSlop={10} style={s2.appBarIcon}>
          <MaterialIcons name="notifications" size={24} color={colors.primary} />
          {unread > 0 ? <View style={s2.unreadDot} /> : null}
        </Pressable>
      ) : null}
    </View>
  );
}

/** The location + language strip under the app bar on Farmer Home (Stitch F1). */
export function ContextStrip({
  location,
  language,
  onLocation,
  onLanguage,
}: {
  location: string;
  language: string;
  onLocation?: () => void;
  onLanguage?: () => void;
}) {
  return (
    <View style={s2.contextStrip}>
      <Pressable onPress={onLocation} style={s2.locationChip}>
        <MaterialIcons name="location-on" size={16} color={colors.primary} />
        <Txt variant="labelSm" numberOfLines={1} style={{ maxWidth: 170 }}>
          {location}
        </Txt>
        {onLocation ? (
          <MaterialIcons name="keyboard-arrow-down" size={16} color={colors.onSurfaceVariant} />
        ) : null}
      </Pressable>
      <Pressable onPress={onLanguage} style={s2.langChip}>
        <MaterialIcons name="translate" size={14} color={colors.primary} />
        <Txt variant="bilingualSubtext" color={colors.primary}>
          {language}
        </Txt>
      </Pressable>
    </View>
  );
}

// ---------- section header ----------

export function SectionHeader({
  title,
  actionLabel,
  onAction,
  style,
}: {
  title: string;
  actionLabel?: string;
  onAction?: () => void;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={[s2.sectionHeader, style]}>
      <Txt variant="headlineMd" style={{ flex: 1 }}>
        {title}
      </Txt>
      {actionLabel && onAction ? (
        <Pressable onPress={onAction} hitSlop={8}>
          <Txt variant="labelSm" color={colors.primary}>
            {actionLabel}
          </Txt>
        </Pressable>
      ) : null}
    </View>
  );
}

// ---------- avatar ----------

/** Initials on a tinted disc — no photo upload in the MVP, so this is the identity mark. */
export function Avatar({
  name,
  size = 48,
  tone = 'primary',
}: {
  name?: string | null;
  size?: number;
  tone?: 'primary' | 'muted';
}) {
  const initials = (name ?? '?')
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');

  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: radius.full,
        backgroundColor: tone === 'primary' ? colors.primaryContainer : colors.surfaceContainer,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Text
        style={{
          fontFamily: type.labelLg.fontFamily,
          fontSize: size * 0.36,
          fontWeight: '700',
          color: tone === 'primary' ? colors.onPrimary : colors.onSurfaceVariant,
        }}
      >
        {initials || '?'}
      </Text>
    </View>
  );
}

/** The 48px rounded-square icon that leads every list card in the Stitch exports. */
export function IconBadge({
  icon,
  tone = 'primary',
  size = 48,
}: {
  icon: keyof typeof MaterialIcons.glyphMap;
  tone?: 'primary' | 'tertiary' | 'muted' | 'error';
  size?: number;
}) {
  const palette = {
    primary: { bg: colors.secondaryContainer, fg: colors.primary },
    tertiary: { bg: colors.warningContainer, fg: colors.tertiary },
    muted: { bg: colors.surfaceContainer, fg: colors.onSurfaceVariant },
    error: { bg: colors.errorContainer, fg: colors.onErrorContainer },
  }[tone];

  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: radius.md,
        backgroundColor: palette.bg,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <MaterialIcons name={icon} size={size * 0.5} color={palette.fg} />
    </View>
  );
}

// ---------- quick action tile ----------

export function QuickAction({
  icon,
  label,
  onPress,
  badge,
  tone = 'primary',
  tag,
}: {
  icon: keyof typeof MaterialIcons.glyphMap;
  label: string;
  onPress: () => void;
  /** unread/pending count rendered as a dot-badge on the tile */
  badge?: number;
  tone?: 'primary' | 'tertiary';
  /** tiny corner flag, e.g. "AI" */
  tag?: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [s2.quickAction, { opacity: pressed ? 0.85 : 1 }]}
    >
      {tag ? (
        <View style={s2.quickTag}>
          <Text style={s2.quickTagText}>{tag}</Text>
        </View>
      ) : null}
      <View
        style={[
          s2.quickIcon,
          { backgroundColor: tone === 'primary' ? colors.secondaryContainer : colors.warningContainer },
        ]}
      >
        <MaterialIcons
          name={icon}
          size={24}
          color={tone === 'primary' ? colors.primary : colors.tertiary}
        />
        {badge && badge > 0 ? <CountBadge count={badge} /> : null}
      </View>
      <Txt variant="labelSm" style={{ textAlign: 'center' }} numberOfLines={2}>
        {label}
      </Txt>
    </Pressable>
  );
}

export function CountBadge({ count }: { count: number }) {
  return (
    <View style={s2.countBadge}>
      <Text style={s2.countBadgeText}>{count > 99 ? '99+' : String(count)}</Text>
    </View>
  );
}

// ---------- metrics ----------

/** A labelled number. Used in rows of two or three; the value is always given. */
export function Metric({
  label,
  value,
  hint,
  icon,
  tone = 'default',
}: {
  label: string;
  value: string;
  hint?: string;
  icon?: keyof typeof MaterialIcons.glyphMap;
  tone?: 'default' | 'onPrimary';
}) {
  const fg = tone === 'onPrimary' ? colors.onPrimary : colors.onSurface;
  const muted = tone === 'onPrimary' ? colors.onPrimaryContainer : colors.onSurfaceVariant;

  return (
    <View style={{ flex: 1, gap: 2 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs }}>
        {icon ? <MaterialIcons name={icon} size={14} color={muted} /> : null}
        <Txt variant="labelSm" color={muted}>
          {label}
        </Txt>
      </View>
      <Txt variant="headlineMd" color={fg}>
        {value}
      </Txt>
      {hint ? (
        <Txt variant="labelSm" color={muted}>
          {hint}
        </Txt>
      ) : null}
    </View>
  );
}

// ---------- progress ----------

/**
 * A single-value bar. `segments` renders a stacked bar instead — used by the
 * capacity ledger, where loaded / confirmed / free are three different truths.
 */
export function ProgressTrack({
  pct,
  segments,
  height = 10,
  tone = colors.primary,
}: {
  pct?: number;
  segments?: Array<{ pct: number; color: string }>;
  height?: number;
  tone?: string;
}) {
  return (
    <View style={[s2.track, { height, borderRadius: height }]}>
      {segments ? (
        segments.map((segment, index) => (
          <View
            key={index}
            style={{
              width: `${Math.max(0, Math.min(100, segment.pct))}%`,
              backgroundColor: segment.color,
              height,
            }}
          />
        ))
      ) : (
        <View
          style={{
            width: `${Math.max(0, Math.min(100, pct ?? 0))}%`,
            backgroundColor: tone,
            height,
            borderRadius: height,
          }}
        />
      )}
    </View>
  );
}

// ---------- search ----------

export function SearchField({
  value,
  onChangeText,
  placeholder = 'Search…',
  onClear,
  right,
}: {
  value: string;
  onChangeText: (text: string) => void;
  placeholder?: string;
  onClear?: () => void;
  right?: ReactNode;
}) {
  return (
    <View style={s2.search}>
      <MaterialIcons name="search" size={20} color={colors.onSurfaceVariant} />
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.outline}
        returnKeyType="search"
        style={s2.searchInput}
      />
      {value.length > 0 ? (
        <Pressable onPress={() => (onClear ? onClear() : onChangeText(''))} hitSlop={8}>
          <MaterialIcons name="close" size={20} color={colors.onSurfaceVariant} />
        </Pressable>
      ) : null}
      {right}
    </View>
  );
}

// ---------- filters ----------

/** A horizontally scrolling chip row with one selected value. */
export function FilterRow<T extends string>({
  options,
  value,
  onChange,
  style,
}: {
  options: Array<{ key: T; label: string; count?: number }>;
  value: T;
  onChange: (key: T) => void;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={[{ gap: space.sm, paddingVertical: space.xs }, style]}
    >
      {options.map((option) => {
        const selected = option.key === value;
        return (
          <Pressable
            key={option.key}
            onPress={() => onChange(option.key)}
            style={[
              s.chip,
              {
                backgroundColor: selected ? colors.primary : colors.surfaceContainerLowest,
                borderColor: selected ? colors.primary : colors.outlineVariant,
                flexDirection: 'row',
                alignItems: 'center',
                gap: space.xs,
              },
            ]}
          >
            <Txt variant="labelLg" color={selected ? colors.onPrimary : colors.onSurfaceVariant}>
              {option.label}
            </Txt>
            {option.count != null ? (
              <View
                style={[
                  s2.chipCount,
                  { backgroundColor: selected ? 'rgba(255,255,255,0.25)' : colors.surfaceContainer },
                ]}
              >
                <Txt variant="labelSm" color={selected ? colors.onPrimary : colors.onSurfaceVariant}>
                  {String(option.count)}
                </Txt>
              </View>
            ) : null}
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

/** The star that marks a favourite mandi. Filled state is driven, never internal. */
export function FavouriteStar({
  active,
  onPress,
  size = 24,
}: {
  active: boolean;
  onPress: () => void;
  size?: number;
}) {
  return (
    <Pressable onPress={onPress} hitSlop={10} accessibilityRole="button">
      <MaterialIcons
        name={active ? 'star' : 'star-border'}
        size={size}
        color={active ? colors.tertiaryContainer : colors.outline}
      />
    </Pressable>
  );
}

// ---------- skeletons ----------

/** A pulsing placeholder block. Shown on first load only; a refresh keeps the data. */
export function Skeleton({
  height = 16,
  width,
  style,
}: {
  height?: number;
  width?: number | `${number}%`;
  style?: StyleProp<ViewStyle>;
}) {
  const pulse = useRef(new Animated.Value(0.4)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 700, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0.4, duration: 700, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);

  return (
    <Animated.View
      style={[
        {
          height,
          width: width ?? '100%',
          borderRadius: radius.base,
          backgroundColor: colors.surfaceContainerHigh,
          opacity: pulse,
        },
        style,
      ]}
    />
  );
}

/** The card-shaped skeleton every list uses while its first page loads. */
export function SkeletonCard({ lines = 3 }: { lines?: number }) {
  return (
    <View style={[s.card, { gap: space.sm }]}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.gutter }}>
        <Skeleton height={48} width={48} style={{ borderRadius: radius.md }} />
        <View style={{ flex: 1, gap: space.sm }}>
          <Skeleton height={16} width="70%" />
          <Skeleton height={12} width="45%" />
        </View>
      </View>
      {Array.from({ length: Math.max(0, lines - 1) }).map((_, index) => (
        <Skeleton key={index} height={12} width={index % 2 ? '60%' : '85%'} />
      ))}
    </View>
  );
}

export function SkeletonList({ count = 3 }: { count?: number }) {
  return (
    <View>
      {Array.from({ length: count }).map((_, index) => (
        <SkeletonCard key={index} />
      ))}
    </View>
  );
}

// ---------- bottom sheet ----------

export function Sheet({
  visible,
  onClose,
  title,
  subtitle,
  children,
}: {
  visible: boolean;
  onClose: () => void;
  title?: string;
  subtitle?: string;
  children: ReactNode;
}) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={s2.scrim} onPress={onClose} />
      <View style={s2.sheet}>
        <View style={s2.sheetGrabber} />
        {title ? (
          <View style={{ marginBottom: subtitle ? space.xs : space.md }}>
            <Txt variant="headlineMd">{title}</Txt>
          </View>
        ) : null}
        {subtitle ? (
          <Txt variant="bodyMd" color={colors.onSurfaceVariant} style={{ marginBottom: space.md }}>
            {subtitle}
          </Txt>
        ) : null}
        {children}
      </View>
    </Modal>
  );
}

/**
 * A yes/no gate in front of anything destructive or irreversible — cancelling a
 * load, withdrawing a claim, signing out.
 */
export function ConfirmDialog({
  visible,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  destructive = false,
  busy = false,
  onConfirm,
  onCancel,
}: {
  visible: boolean;
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <View style={s2.dialogWrap}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onCancel} />
        <View style={s2.dialog}>
          <Txt variant="headlineMd">{title}</Txt>
          {message ? (
            <Txt variant="bodyMd" color={colors.onSurfaceVariant} style={{ marginTop: space.sm }}>
              {message}
            </Txt>
          ) : null}
          <View style={{ flexDirection: 'row', gap: space.sm, marginTop: space.lg }}>
            <Button
              label={cancelLabel}
              variant="secondary"
              icon={null}
              onPress={onCancel}
              style={{ flex: 1 }}
            />
            <Button
              label={confirmLabel}
              variant={destructive ? 'danger' : 'primary'}
              icon={null}
              loading={busy}
              onPress={onConfirm}
              style={{ flex: 1 }}
            />
          </View>
        </View>
      </View>
    </Modal>
  );
}

// ---------- success feedback ----------

/**
 * The confirmation every primary action owes the user. Auto-dismisses; a screen
 * holds the message in state and clears it, so it never outlives its context.
 */
export function Toast({
  message,
  tone = 'success',
  onHide,
}: {
  message: string | null;
  tone?: 'success' | 'error' | 'info';
  onHide: () => void;
}) {
  const slide = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!message) return;
    Animated.timing(slide, { toValue: 1, duration: 180, useNativeDriver: true }).start();
    const timer = setTimeout(() => {
      Animated.timing(slide, { toValue: 0, duration: 180, useNativeDriver: true }).start(onHide);
    }, 2600);
    return () => clearTimeout(timer);
  }, [message, slide, onHide]);

  if (!message) return null;

  const palette = {
    success: { bg: colors.primary, fg: colors.onPrimary, icon: 'check-circle' as const },
    error: { bg: colors.error, fg: colors.onError, icon: 'error-outline' as const },
    info: { bg: colors.inverseSurface, fg: colors.inverseOnSurface, icon: 'info' as const },
  }[tone];

  return (
    <Animated.View
      style={[
        s2.toast,
        {
          backgroundColor: palette.bg,
          opacity: slide,
          transform: [{ translateY: slide.interpolate({ inputRange: [0, 1], outputRange: [16, 0] }) }],
        },
      ]}
    >
      <MaterialIcons name={palette.icon} size={20} color={palette.fg} />
      <Txt variant="labelLg" color={palette.fg} style={{ flex: 1 }}>
        {message}
      </Txt>
    </Animated.View>
  );
}

// ---------- timeline ----------

export interface TimelineItem {
  key: string;
  label: string;
  caption?: string;
  state: 'done' | 'active' | 'pending';
  icon?: keyof typeof MaterialIcons.glyphMap;
}

/** The vertical progress line from the Stitch trip screens. */
export function Timeline({ items }: { items: TimelineItem[] }) {
  return (
    <View>
      {items.map((item, index) => {
        const last = index === items.length - 1;
        const done = item.state === 'done';
        const active = item.state === 'active';
        return (
          <View key={item.key} style={{ flexDirection: 'row', gap: space.gutter }}>
            <View style={{ alignItems: 'center' }}>
              <View
                style={[
                  s2.timelineDot,
                  {
                    backgroundColor: done || active ? colors.primary : colors.surfaceContainer,
                    borderWidth: active ? 3 : 0,
                  },
                ]}
              >
                <MaterialIcons
                  name={done ? 'check' : (item.icon ?? 'radio-button-unchecked')}
                  size={15}
                  color={done || active ? colors.onPrimary : colors.outline}
                />
              </View>
              {!last ? (
                <View
                  style={{
                    width: 2,
                    flex: 1,
                    minHeight: 20,
                    backgroundColor: done ? colors.primary : colors.outlineVariant,
                  }}
                />
              ) : null}
            </View>
            <View style={{ flex: 1, paddingBottom: last ? 0 : space.md }}>
              <Txt
                variant="labelLg"
                color={done || active ? colors.onSurface : colors.onSurfaceVariant}
              >
                {item.label}
              </Txt>
              {item.caption ? (
                <Txt variant="labelSm" color={colors.onSurfaceVariant}>
                  {item.caption}
                </Txt>
              ) : null}
            </View>
          </View>
        );
      })}
    </View>
  );
}

// ---------- settings list ----------

/** One tappable row in Profile / Settings. */
export function SettingRow({
  icon,
  label,
  value,
  onPress,
  tone = 'default',
  right,
}: {
  icon: keyof typeof MaterialIcons.glyphMap;
  label: string;
  value?: string;
  onPress?: () => void;
  tone?: 'default' | 'danger';
  right?: ReactNode;
}) {
  const fg = tone === 'danger' ? colors.error : colors.onSurface;
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      style={({ pressed }) => [s2.settingRow, { opacity: pressed && onPress ? 0.7 : 1 }]}
    >
      <MaterialIcons name={icon} size={22} color={tone === 'danger' ? colors.error : colors.primary} />
      <Txt variant="bodyLg" color={fg} style={{ flex: 1 }}>
        {label}
      </Txt>
      {value ? (
        <Txt variant="labelSm" color={colors.onSurfaceVariant}>
          {value}
        </Txt>
      ) : null}
      {right ??
        (onPress ? (
          <MaterialIcons name="chevron-right" size={22} color={colors.outline} />
        ) : null)}
    </Pressable>
  );
}

const s2 = StyleSheet.create({
  appBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingHorizontal: layout.edgeMargin,
    height: 56,
    backgroundColor: colors.background,
  },
  appBarIcon: { padding: space.xs },
  unreadDot: {
    position: 'absolute',
    top: 4,
    right: 4,
    width: 8,
    height: 8,
    borderRadius: radius.full,
    backgroundColor: colors.error,
  },
  contextStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.sm,
    paddingHorizontal: layout.edgeMargin,
    paddingBottom: space.sm,
    backgroundColor: colors.background,
  },
  locationChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    backgroundColor: colors.surfaceContainerLow,
    borderWidth: 1,
    borderColor: colors.surfaceVariant,
    borderRadius: radius.base,
    paddingHorizontal: space.sm,
    paddingVertical: space.xs,
    flexShrink: 1,
  },
  langChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.secondaryContainer,
    backgroundColor: colors.secondaryContainer,
    paddingHorizontal: space.sm,
    paddingVertical: space.xs,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    marginTop: space.md,
    marginBottom: space.sm,
  },
  quickAction: {
    flex: 1,
    alignItems: 'center',
    gap: space.sm,
    backgroundColor: colors.surfaceContainerLowest,
    borderWidth: 1,
    borderColor: colors.surfaceVariant,
    borderRadius: radius.lg,
    paddingVertical: space.gutter,
    paddingHorizontal: space.xs,
    minHeight: 96,
    justifyContent: 'center',
  },
  quickIcon: {
    width: 48,
    height: 48,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  quickTag: {
    position: 'absolute',
    top: 6,
    right: 6,
    backgroundColor: colors.primary,
    borderRadius: radius.sm,
    paddingHorizontal: 4,
  },
  quickTagText: {
    fontFamily: type.labelSm.fontFamily,
    fontSize: 9,
    fontWeight: '700',
    color: colors.onPrimary,
  },
  countBadge: {
    position: 'absolute',
    top: -4,
    right: -6,
    minWidth: 20,
    height: 20,
    paddingHorizontal: 5,
    borderRadius: radius.full,
    backgroundColor: colors.error,
    alignItems: 'center',
    justifyContent: 'center',
  },
  countBadgeText: {
    fontFamily: type.labelSm.fontFamily,
    fontSize: 11,
    fontWeight: '700',
    color: colors.onError,
  },
  track: {
    flexDirection: 'row',
    backgroundColor: colors.surfaceContainerHigh,
    overflow: 'hidden',
    width: '100%',
  },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    minHeight: layout.minTouchTarget,
    borderRadius: radius.base,
    borderWidth: 1,
    borderColor: colors.outlineVariant,
    backgroundColor: colors.surfaceContainerLowest,
    paddingHorizontal: space.gutter,
  },
  searchInput: {
    flex: 1,
    fontFamily: type.bodyLg.fontFamily,
    fontSize: 16,
    color: colors.onSurface,
    paddingVertical: space.sm,
  },
  chipCount: {
    minWidth: 20,
    paddingHorizontal: 5,
    borderRadius: radius.full,
    alignItems: 'center',
  },
  scrim: { flex: 1, backgroundColor: 'rgba(25,28,27,0.45)' },
  sheet: {
    backgroundColor: colors.background,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    padding: layout.edgeMargin,
    paddingBottom: space.xl,
  },
  sheetGrabber: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: radius.full,
    backgroundColor: colors.outlineVariant,
    marginBottom: space.md,
  },
  dialogWrap: {
    flex: 1,
    backgroundColor: 'rgba(25,28,27,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: space.lg,
  },
  dialog: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: colors.background,
    borderRadius: radius.xl,
    padding: space.md,
  },
  toast: {
    position: 'absolute',
    left: layout.edgeMargin,
    right: layout.edgeMargin,
    bottom: layout.fabOffset,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    borderRadius: radius.md,
    paddingVertical: space.gutter,
    paddingHorizontal: space.md,
    ...elevation.level2,
  },
  timelineDot: {
    width: 26,
    height: 26,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    borderColor: colors.secondaryContainer,
  },
  settingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.gutter,
    minHeight: layout.minTouchTarget,
    paddingVertical: space.gutter,
  },
});

