/**
 * The ONE design system for the whole app — the Farmer set, "Agri-Logistics
 * Standard" (docs/DESIGN.md, ADR-017).
 *
 * Inter only. Primary Green #0d631b, Secondary Green #2e7d32. Radii 8 / 16 / 24.
 * No second theme object, no per-role override map, no role-conditional styling.
 * If a value is not in here, it does not go on screen.
 */
import { Platform, type TextStyle, type ViewStyle } from 'react-native';

export const colors = {
  primary: '#0d631b',
  onPrimary: '#ffffff',
  primaryContainer: '#2e7d32',
  onPrimaryContainer: '#cbffc2',

  secondary: '#006e1c',
  onSecondary: '#ffffff',
  secondaryContainer: '#91f78e',
  onSecondaryContainer: '#00731e',

  tertiary: '#734e00',
  onTertiary: '#ffffff',
  tertiaryContainer: '#926500',
  onTertiaryContainer: '#ffefda',

  error: '#ba1a1a',
  onError: '#ffffff',
  errorContainer: '#ffdad6',
  onErrorContainer: '#93000a',

  surface: '#f8faf8',
  background: '#f8faf8',
  surfaceContainerLowest: '#ffffff',
  surfaceContainerLow: '#f2f4f2',
  surfaceContainer: '#eceeec',
  surfaceContainerHigh: '#e6e9e7',
  surfaceContainerHighest: '#e1e3e1',
  surfaceVariant: '#e1e3e1',

  onSurface: '#191c1b',
  onSurfaceVariant: '#40493d',
  outline: '#707a6c',
  outlineVariant: '#bfcaba',

  inverseSurface: '#2e3130',
  inverseOnSurface: '#eff1ef',
  surfaceTint: '#1b6d24',

  // status badge pairs (docs/DESIGN.md §6)
  infoContainer: '#dbe9ff',
  onInfoContainer: '#0b3a75',
  warningContainer: '#ffefda',
  onWarningContainer: '#604100',
} as const;

/** Inter is the only family. Loaded in app/_layout.tsx; falls back to the system face. */
export const fontFamily = Platform.select({
  ios: 'Inter',
  android: 'Inter',
  default: 'Inter',
}) as string;

export const type = {
  displayLg: {
    fontFamily,
    fontSize: 32,
    fontWeight: '700',
    lineHeight: 40,
    letterSpacing: -0.64,
  },
  headlineLg: { fontFamily, fontSize: 24, fontWeight: '600', lineHeight: 32 },
  headlineMd: { fontFamily, fontSize: 20, fontWeight: '600', lineHeight: 28 },
  bodyLg: { fontFamily, fontSize: 16, fontWeight: '400', lineHeight: 24 },
  bodyMd: { fontFamily, fontSize: 14, fontWeight: '400', lineHeight: 20 },
  labelLg: { fontFamily, fontSize: 14, fontWeight: '600', lineHeight: 20, letterSpacing: 0.14 },
  labelSm: { fontFamily, fontSize: 12, fontWeight: '500', lineHeight: 16 },
  /** the English gloss under a Marathi headline-md label */
  bilingualSubtext: { fontFamily, fontSize: 13, fontWeight: '400', lineHeight: 18 },
} satisfies Record<string, TextStyle>;

/** 4px baseline grid. */
export const space = {
  xs: 4,
  sm: 8,
  gutter: 12,
  md: 16,
  lg: 24,
  xl: 32,
} as const;

/** 8px buttons/inputs · 16px cards · 24px banners and sheets. */
export const radius = {
  sm: 4,
  base: 8,
  md: 12,
  lg: 16,
  xl: 24,
  full: 9999,
} as const;

/** Diffused, green-tinted — never neutral black against the warm ground. */
export const elevation = {
  level0: {} as ViewStyle,
  level1: {
    shadowColor: '#000000',
    shadowOpacity: 0.05,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  } as ViewStyle,
  level2: {
    shadowColor: colors.primaryContainer,
    shadowOpacity: 0.15,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 8 },
    elevation: 6,
  } as ViewStyle,
} as const;

/** 16px edge margin, 48px minimum touch target — one-handed, outdoors. */
export const layout = {
  edgeMargin: space.md,
  minTouchTarget: 48,
} as const;

export const theme = { colors, fontFamily, type, space, radius, elevation, layout } as const;
export default theme;
