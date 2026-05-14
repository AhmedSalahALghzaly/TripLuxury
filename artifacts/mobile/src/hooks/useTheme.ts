/**
 * Theme palette — Luxury Dining 2026
 *
 * Identity: charcoal / ivory / gold restaurant aesthetic. Replaces the
 * legacy auto-parts blue without changing the public shape, so every
 * consumer that already reads `colors.background`, `colors.primary`,
 * etc. inherits the new identity for free.
 *
 * Design tokens:
 *   - primary       : champagne gold      (#C8A24A)
 *   - secondary     : burgundy            (#7A1F2B)
 *   - accent        : warm amber          (#E0A04A)
 *   - background    : ivory / charcoal
 *   - surface       : cream tile / smoke
 *   - text          : graphite / parchment
 *   - tab bar       : ivory + gold (light) / charcoal + gold (dark)
 *
 * The named auto-parts shape (background, surface, card, text,
 * textSecondary, primary, primaryDark, secondary, accent, border, error,
 * success, warning, shadow, inputBackground, tabBar, tabBarActive,
 * tabBarInactive) is preserved 1:1.  New optional keys (gold, ivory,
 * charcoal, sage, bronze, glass, divider, overlay) are additive — older
 * call sites continue to typecheck because TypeScript widens the inferred
 * `ThemeColors` from `typeof lightTheme`.
 */
import { useAppStore } from '../store/appStore';

export const lightTheme = {
  // Surfaces
  background: '#F7F2E9',     // warm ivory canvas
  surface: '#EFE6D6',        // cream tile
  card: '#FFFFFF',           // crisp linen card
  inputBackground: '#FBF6EC',

  // Type
  text: '#1B1B1F',           // deep graphite
  textSecondary: '#6E6353',  // bronze taupe

  // Brand
  primary: '#C8A24A',        // champagne gold
  primaryDark: '#A98432',    // burnished gold
  secondary: '#7A1F2B',      // burgundy
  accent: '#E0A04A',         // warm amber

  // Structural
  border: '#E2D6BD',         // bone
  shadow: 'rgba(27, 27, 31, 0.10)',

  // Semantic
  error: '#C0392B',          // warm rouge (vs harsh red)
  success: '#4A5D3A',        // sage green
  warning: '#E0A04A',        // amber

  // Tab bar
  tabBar: '#FBF6EC',
  tabBarActive: '#C8A24A',
  tabBarInactive: '#9A8E7B',

  // Luxury accents (additive)
  gold: '#C8A24A',
  goldSoft: '#E8D29A',
  ivory: '#F7F2E9',
  charcoal: '#1B1B1F',
  burgundy: '#7A1F2B',
  sage: '#4A5D3A',
  bronze: '#6E6353',
  divider: 'rgba(27, 27, 31, 0.08)',
  overlay: 'rgba(27, 27, 31, 0.45)',
  glass: 'rgba(255, 255, 255, 0.72)',
  glassStroke: 'rgba(200, 162, 74, 0.28)',
  highlight: 'rgba(200, 162, 74, 0.10)',
};

export const darkTheme = {
  // Surfaces
  background: '#0B0B0E',     // charcoal
  surface: '#15151A',        // smoke
  card: '#1C1C22',           // velvet
  inputBackground: '#15151A',

  // Type
  text: '#F5EFE6',           // parchment
  textSecondary: '#B5A98F',  // muted bronze

  // Brand
  primary: '#D4B062',        // brighter gold for dark surfaces
  primaryDark: '#B7913F',
  secondary: '#A23142',      // warmer burgundy on dark
  accent: '#E8B26A',         // amber

  // Structural
  border: '#2A2A33',         // graphite hairline
  shadow: 'rgba(0, 0, 0, 0.55)',

  // Semantic
  error: '#E07060',
  success: '#7A9168',
  warning: '#E8B26A',

  // Tab bar
  tabBar: '#0F0F13',
  tabBarActive: '#D4B062',
  tabBarInactive: '#6E6353',

  // Luxury accents (additive)
  gold: '#D4B062',
  goldSoft: '#7A6433',
  ivory: '#F5EFE6',
  charcoal: '#0B0B0E',
  burgundy: '#A23142',
  sage: '#7A9168',
  bronze: '#B5A98F',
  divider: 'rgba(245, 239, 230, 0.08)',
  overlay: 'rgba(0, 0, 0, 0.65)',
  glass: 'rgba(28, 28, 34, 0.72)',
  glassStroke: 'rgba(212, 176, 98, 0.32)',
  highlight: 'rgba(212, 176, 98, 0.12)',
};

export type ThemeColors = typeof lightTheme;

export const useTheme = () => {
  const theme = useAppStore((state) => state.theme);
  const colors = theme === 'light' ? lightTheme : darkTheme;
  const isDark = theme === 'dark';

  return { colors, isDark, theme };
};
