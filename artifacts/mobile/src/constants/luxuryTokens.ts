/**
 * Luxury Dining 2026 — Design Tokens
 *
 * Centralized non-color tokens for the restaurant identity:
 *   - typography scale + font families (system fallbacks; no extra font files
 *     are added to keep the bundle small and avoid splash regressions)
 *   - radii, spacing, elevation/glass shadows
 *   - "ambience" gradient stops used by hero sections
 *
 * All consumers should import from this module rather than hard-coding
 * literals so a future design refresh stays single-source-of-truth.
 */
import { Platform } from 'react-native';
import type { TextStyle, ViewStyle } from 'react-native';

// ═════════════════════════════════════════════════════════════════════════════
// TYPOGRAPHY
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Font family aliases.
 *
 * `display` is the editorial serif used for hero headlines and prices;
 * `body` is the geometric sans for everything else; `arabic` is a
 * humanist Arabic stack with a graceful system fallback.
 *
 * Real Google Fonts (Playfair Display, Inter, Cairo) are not loaded
 * here — adding them at runtime would add ~200-400KB to the splash
 * payload and risk breaking the existing graceful-degradation flow in
 * `services/fontLoader.ts`. Instead we lean on the tasteful platform
 * serifs ('Cochin' / 'Didot' on iOS, 'serif' on Android, 'Georgia' on
 * web) which give a similar editorial feel with zero load cost.
 */
export const FONTS = {
  display: Platform.select({
    ios: 'Cochin',
    android: 'serif',
    web: 'Georgia, "Times New Roman", serif',
    default: 'serif',
  }) as string,

  body: Platform.select({
    ios: 'System',
    android: 'sans-serif',
    web: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    default: 'System',
  }) as string,

  arabic: Platform.select({
    ios: 'Geeza Pro',
    android: 'sans-serif',
    web: '"Cairo", "Tajawal", sans-serif',
    default: 'System',
  }) as string,

  mono: Platform.select({
    ios: 'Menlo',
    android: 'monospace',
    web: '"SF Mono", Menlo, monospace',
    default: 'monospace',
  }) as string,
} as const;

/**
 * Semantic typography ramp. Use these instead of inline `fontSize` /
 * `fontWeight` literals on new screens.
 */
export const TYPE = {
  hero: {
    fontFamily: FONTS.display,
    fontSize: 36,
    lineHeight: 42,
    fontWeight: '700' as const,
    letterSpacing: 0.2,
  },
  display: {
    fontFamily: FONTS.display,
    fontSize: 28,
    lineHeight: 34,
    fontWeight: '700' as const,
    letterSpacing: 0.15,
  },
  title: {
    fontFamily: FONTS.display,
    fontSize: 22,
    lineHeight: 28,
    fontWeight: '600' as const,
    letterSpacing: 0.1,
  },
  sectionLabel: {
    fontFamily: FONTS.body,
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '700' as const,
    letterSpacing: 1.6,
    textTransform: 'uppercase' as const,
  },
  bodyLarge: {
    fontFamily: FONTS.body,
    fontSize: 17,
    lineHeight: 24,
    fontWeight: '500' as const,
  },
  body: {
    fontFamily: FONTS.body,
    fontSize: 15,
    lineHeight: 22,
    fontWeight: '400' as const,
  },
  caption: {
    fontFamily: FONTS.body,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '500' as const,
    letterSpacing: 0.2,
  },
  price: {
    fontFamily: FONTS.display,
    fontSize: 20,
    lineHeight: 24,
    fontWeight: '700' as const,
    letterSpacing: 0.3,
  },
  button: {
    fontFamily: FONTS.body,
    fontSize: 14,
    lineHeight: 18,
    fontWeight: '700' as const,
    letterSpacing: 0.6,
  },
  /** Chip label — slightly smaller than `button`, all-caps. */
  chipLabel: {
    fontFamily: FONTS.body,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '700' as const,
    letterSpacing: 0.6,
    textTransform: 'uppercase' as const,
  },
  /** Numeric badge alongside a chip label (e.g. count of items). */
  chipCount: {
    fontFamily: FONTS.body,
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '600' as const,
    letterSpacing: 0.2,
  },
  /** Compact price used inside small badges. */
  priceCompact: {
    fontFamily: FONTS.display,
    fontSize: 18,
    lineHeight: 22,
    fontWeight: '700' as const,
    letterSpacing: 0.3,
  },
  /** Smaller variant of `sectionLabel` for chips and badges. */
  microLabel: {
    fontFamily: FONTS.body,
    fontSize: 10,
    lineHeight: 13,
    fontWeight: '700' as const,
    letterSpacing: 1.4,
    textTransform: 'uppercase' as const,
  },
  /** Even smaller variant for tight badge corners. */
  tinyLabel: {
    fontFamily: FONTS.body,
    fontSize: 9,
    lineHeight: 12,
    fontWeight: '700' as const,
    letterSpacing: 1.4,
    textTransform: 'uppercase' as const,
  },
  /** TextInput body copy. */
  inputText: {
    fontFamily: FONTS.body,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '400' as const,
  },
  /** Button text with extra letter-spacing for editorial section CTAs. */
  spacedButton: {
    fontFamily: FONTS.body,
    fontSize: 14,
    lineHeight: 18,
    fontWeight: '700' as const,
    letterSpacing: 0.8,
    textTransform: 'uppercase' as const,
  },
  /** Hero CTA — wider tracking than `spacedButton`. */
  heroButton: {
    fontFamily: FONTS.body,
    fontSize: 14,
    lineHeight: 18,
    fontWeight: '700' as const,
    letterSpacing: 1.1,
    textTransform: 'uppercase' as const,
  },
  /** Caption used inside small badges (date pill, etc). */
  badgeCaption: {
    fontFamily: FONTS.body,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '500' as const,
    letterSpacing: 1,
    textTransform: 'uppercase' as const,
  },
  /** 11px sectionLabel variant for tight section-header CTAs. */
  compactMicroLabel: {
    fontFamily: FONTS.body,
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '700' as const,
    letterSpacing: 1.4,
    textTransform: 'uppercase' as const,
  },
} as const;

// ═════════════════════════════════════════════════════════════════════════════
// SPACING — 4-pt baseline grid
// ═════════════════════════════════════════════════════════════════════════════
export const SPACING = {
  xxs: 2,
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 28,
  xxxl: 36,
  hero: 48,
  cinematic: 64,
} as const;

// ═════════════════════════════════════════════════════════════════════════════
// RADII — softer than the legacy 12pt corners
// ═════════════════════════════════════════════════════════════════════════════
export const RADII = {
  none: 0,
  xs: 6,
  sm: 10,
  md: 14,
  lg: 18,
  xl: 22,
  xxl: 28,
  pill: 999,
} as const;

// ═════════════════════════════════════════════════════════════════════════════
// ELEVATION — gold-tinted shadows for the warm restaurant identity
// ═════════════════════════════════════════════════════════════════════════════
const isWeb = Platform.OS === 'web';

const buildShadow = (
  color: string,
  offsetY: number,
  radius: number,
  opacity: number,
  elevation: number,
) => {
  if (isWeb) {
    const rgba = color.startsWith('rgba')
      ? color
      : `rgba(27, 27, 31, ${opacity})`;
    return { boxShadow: `0px ${offsetY}px ${radius}px ${rgba}` } as any;
  }
  return {
    shadowColor: color,
    shadowOffset: { width: 0, height: offsetY },
    shadowOpacity: opacity,
    shadowRadius: radius,
    elevation,
  } as any;
};

export const ELEVATION = {
  resting: buildShadow('#1B1B1F', 1, 4, 0.06, 1),
  card: buildShadow('#1B1B1F', 4, 12, 0.10, 3),
  raised: buildShadow('#1B1B1F', 8, 20, 0.14, 6),
  hero: buildShadow('#1B1B1F', 16, 32, 0.18, 10),
  goldGlow: buildShadow('#C8A24A', 0, 24, 0.32, 8),
  burgundyGlow: buildShadow('#7A1F2B', 0, 18, 0.28, 6),
} as const;

// ═════════════════════════════════════════════════════════════════════════════
// HERO GRADIENTS — used by splash, login, home hero, AI concierge cards
// ═════════════════════════════════════════════════════════════════════════════
export const GRADIENTS = {
  midnightBistro: ['#0B0B0E', '#1C1C22', '#2A2218'] as const,
  champagneRise: ['#FBF6EC', '#EFE6D6', '#E8D29A'] as const,
  goldShimmer: ['#C8A24A', '#E8D29A', '#C8A24A'] as const,
  burgundyVelvet: ['#1B1B1F', '#3A1419', '#7A1F2B'] as const,
  gardenPavilion: ['#E8EAD6', '#C9D2B0', '#A1B286'] as const,
  conciergeAura: ['rgba(212, 176, 98, 0.0)', 'rgba(212, 176, 98, 0.18)', 'rgba(212, 176, 98, 0.0)'] as const,
  // 4-stop home backdrops — looped to ensure perfect tile on long pages.
  homeBackdropDark: ['#0B0B0E', '#1C1C22', '#2A2218', '#0B0B0E'] as const,
  homeBackdropLight: ['#FBF6EC', '#F4ECDA', '#EFE6D6', '#FBF6EC'] as const,
  bundleCardBurgundy: ['#3A1419', '#7A1F2B'] as const,
  bundleScrim: ['transparent', 'rgba(0, 0, 0, 0.5)'] as const,
} as const;

// ═════════════════════════════════════════════════════════════════════════════
// GLASS — translucent overlays for headers and modals
// ═════════════════════════════════════════════════════════════════════════════
export const GLASS = {
  light: {
    backgroundColor: 'rgba(247, 242, 233, 0.82)',
    borderColor: 'rgba(200, 162, 74, 0.28)',
    borderWidth: 1,
  },
  dark: {
    backgroundColor: 'rgba(15, 15, 19, 0.82)',
    borderColor: 'rgba(212, 176, 98, 0.32)',
    borderWidth: 1,
  },
} as const;

// ═════════════════════════════════════════════════════════════════════════════
// COLORS — brand neutrals shared across both themes
// ═════════════════════════════════════════════════════════════════════════════
export const COLORS = {
  charcoal: '#1B1B1F',
  charcoalDeep: '#0B0B0E',
  ivory: '#FBF6EC',
  ivoryWarm: '#F7F2E9',
  gold: '#C8A24A',
  goldSoft: '#E8D29A',
  goldBright: '#D4B062',
  burgundy: '#7A1F2B',
  bronze: '#6E6353',
  black: '#000000',
} as const;

// ═════════════════════════════════════════════════════════════════════════════
// OVERLAYS — semi-opaque cinematic washes
// ═════════════════════════════════════════════════════════════════════════════
export const OVERLAYS = {
  curtainTop: 'rgba(11, 11, 14, 0.05)',
  curtainMid: 'rgba(11, 11, 14, 0.45)',
  curtainBase: 'rgba(11, 11, 14, 0.92)',
  curtainBaseStrong: 'rgba(11, 11, 14, 0.95)',
  scrim: 'rgba(11, 11, 14, 0.40)',
  scrimDeep: 'rgba(11, 11, 14, 0.55)',
  ivoryDim: 'rgba(251, 246, 236, 0.82)',
  ivoryDimSoft: 'rgba(251, 246, 236, 0.78)',
  ivoryWash: 'rgba(251, 246, 236, 0.85)',
  ivoryWashDim: 'rgba(251, 246, 236, 0.55)',
  ivoryDot: 'rgba(251, 246, 236, 0.32)',
  charcoalChipDim: 'rgba(27, 27, 31, 0.40)',
  charcoalChipText: 'rgba(27, 27, 31, 0.65)',
  goldHairline: 'rgba(232, 210, 154, 0.55)',
  goldInnerGlow: 'rgba(232, 210, 154, 0.18)',
  goldGlowSoft: 'rgba(212, 176, 98, 0.55)',
  dropShadow: 'rgba(0, 0, 0, 0.55)',
  glassWashLight: 'rgba(0, 0, 0, 0.02)',
  glassWashDark: 'rgba(255, 255, 255, 0.03)',
} as const;

// ═════════════════════════════════════════════════════════════════════════════
// INDICATORS — pagination dots, status pips
// ═════════════════════════════════════════════════════════════════════════════
export const INDICATORS = {
  dot: { width: 6, height: 6, borderRadius: 3 },
  /** Used by ChefsSpecialSpotlight and any other carousel that still uses the expanding-pill style. */
  dotActive: { width: 22, height: 6, borderRadius: 3 },
} as const;

// ═════════════════════════════════════════════════════════════════════════════
// TEXT_SHADOWS / EDITORIAL_FRAME — typed wrappers for web-only style props
// ═════════════════════════════════════════════════════════════════════════════
type WebTextStyle = TextStyle & { textShadow?: string };
type WebViewStyle = ViewStyle & { boxShadow?: string };

export const TEXT_SHADOWS: Record<'hero' | 'title', WebTextStyle> = {
  hero:
    Platform.OS === 'web'
      ? { textShadow: `0px 2px 12px ${OVERLAYS.dropShadow}` }
      : {
          textShadowColor: OVERLAYS.dropShadow,
          textShadowOffset: { width: 0, height: 2 },
          textShadowRadius: 12,
        },
  title:
    Platform.OS === 'web'
      ? { textShadow: `0 2px 10px ${OVERLAYS.dropShadow}` }
      : {
          textShadowColor: OVERLAYS.dropShadow,
          textShadowOffset: { width: 0, height: 2 },
          textShadowRadius: 10,
        },
};

export const EDITORIAL_FRAME: WebViewStyle =
  Platform.OS === 'web'
    ? {
        boxShadow: `0px 18px 36px ${OVERLAYS.scrim}, inset 0 0 0 1px ${OVERLAYS.goldInnerGlow}`,
      }
    : {};

export default {
  FONTS,
  TYPE,
  SPACING,
  RADII,
  ELEVATION,
  GRADIENTS,
  GLASS,
  COLORS,
  OVERLAYS,
  INDICATORS,
  TEXT_SHADOWS,
  EDITORIAL_FRAME,
};
