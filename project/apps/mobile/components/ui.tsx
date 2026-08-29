/**
 * The shared component set. One implementation, used unchanged by both the
 * (farmer) and (transporter) stacks — nothing here branches on User.role
 * (docs/DESIGN.md §6, ADR-017).
 */
import { MaterialIcons } from '@expo/vector-icons';
import type { ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
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
}: {
  children: ReactNode;
  scroll?: boolean;
  padded?: boolean;
  footer?: ReactNode;
}) {
  const body = (
    <View style={[padded && { paddingHorizontal: layout.edgeMargin }, { flex: scroll ? 0 : 1 }]}>
      {children}
    </View>
  );

  return (
    <SafeAreaView style={s.screen} edges={['top', 'left', 'right']}>
      {scroll ? (
        <ScrollView
          contentContainerStyle={{ paddingBottom: space.xl }}
          keyboardShouldPersistTaps="handled"
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
