/**
 * FitmentStrip — Unified fitment indicator UI for all surfaces
 *
 * Replaces the legacy FitmentBadges (display-only) and FitmentSelector
 * (interactive, single-select) components with one polished, neon-night
 * styled strip used across:
 *   - ProductCard (under title, above price)
 *   - InteractiveCarSelector inner card
 *   - CartTab line items (interactive variant swap)
 *   - Admin product form (single-select)
 *   - Search filters (multi-select)
 *   - Product detail screen
 *
 * Modes:
 *   - 'display'      — non-interactive badges (when there's nothing to choose)
 *   - 'interactive'  — single-select with animated highlight + haptic feedback
 *   - 'multi'        — multi-select for filter UIs
 *
 * Animations use transform+opacity only (no layout shifts) and respect
 * the OS reduced-motion preference where available.
 */
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  AccessibilityInfo,
  Animated,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  ViewStyle,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { useTheme } from '../hooks/useTheme';
import { NEON_NIGHT_THEME } from '../store/appStore';

export interface FitmentVariant {
  indicator: string;
  price?: number;
  stock?: number;
}

export type FitmentStripMode = 'display' | 'interactive' | 'multi';
export type FitmentStripSize = 'sm' | 'md';

interface BaseProps {
  variants?: FitmentVariant[] | null;
  /** Always-shown indicator if `variants` is empty (e.g. product.fitment_indicator). */
  fallbackIndicator?: string | null;
  size?: FitmentStripSize;
  hideOutOfStock?: boolean;
  containerStyle?: ViewStyle | ViewStyle[];
  /** Visually highlight the selected/displayed indicator more strongly. */
  emphasizeSelection?: boolean;
}

interface DisplayProps extends BaseProps {
  mode?: 'display';
  selected?: string | null;
}

interface InteractiveProps extends BaseProps {
  mode: 'interactive';
  selected?: string | null;
  onChange: (indicator: string) => void;
}

interface MultiProps extends BaseProps {
  mode: 'multi';
  selectedSet: Set<string> | string[];
  onToggle: (indicator: string) => void;
}

type Props = DisplayProps | InteractiveProps | MultiProps;

const ORDER = ['صغير', 'وسط', 'كبير', 'كومبو', 'عائلي'];

function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    let mounted = true;
    AccessibilityInfo.isReduceMotionEnabled?.().then((v) => {
      if (mounted) setReduced(!!v);
    }).catch(() => {});
    const sub = AccessibilityInfo.addEventListener?.(
      'reduceMotionChanged',
      (v) => setReduced(!!v),
    );
    return () => {
      mounted = false;
      // @ts-ignore older RN returns void from addEventListener
      sub?.remove?.();
    };
  }, []);
  return reduced;
}

const FitmentStrip: React.FC<Props> = (props) => {
  const {
    variants,
    fallbackIndicator,
    size = 'sm',
    hideOutOfStock = true,
    containerStyle,
    emphasizeSelection = true,
  } = props;
  const mode: FitmentStripMode = props.mode ?? 'display';
  const { colors, isDark } = useTheme();
  const reducedMotion = useReducedMotion();

  // Build the indicator list, preserving defined order (صغير → عائلي).
  const indicators = useMemo(() => {
    const set = new Set<string>();
    if (Array.isArray(variants)) {
      for (const v of variants) {
        if (!v?.indicator) continue;
        if (hideOutOfStock && (v.stock !== undefined && v.stock !== null && v.stock <= 0)) continue;
        set.add(String(v.indicator));
      }
    }
    if (fallbackIndicator) set.add(String(fallbackIndicator));
    if (set.size === 0 && mode !== 'display') {
      // Interactive/multi modes are useful even without variants (e.g. admin form, search).
      ORDER.forEach((k) => set.add(k));
    }
    const arr = Array.from(set);
    arr.sort((a, b) => {
      const ai = ORDER.indexOf(a);
      const bi = ORDER.indexOf(b);
      if (ai === -1 && bi === -1) return a.localeCompare(b);
      if (ai === -1) return 1;
      if (bi === -1) return -1;
      return ai - bi;
    });
    return arr;
  }, [variants, fallbackIndicator, hideOutOfStock, mode]);

  if (indicators.length === 0) return null;

  // Resolve selection state early so it's available to all branches below.
  const selectedSingle =
    mode === 'interactive' || mode === 'display'
      ? (props as InteractiveProps | DisplayProps).selected ?? fallbackIndicator ?? null
      : null;

  const selectedMulti =
    mode === 'multi'
      ? (() => {
          const raw = (props as MultiProps).selectedSet;
          return raw instanceof Set ? raw : new Set(raw);
        })()
      : null;

  // Hide single-indicator chips on display surfaces (product cards, etc.).
  // When there is only one option there is nothing to choose between — the
  // chip is pure visual noise. Also suppress "STD" (legacy fitment sentinel)
  // in all display contexts; it carries no useful information for the diner.
  // Interactive/multi modes (admin form, search filters) keep all options.
  if (mode === 'display') {
    if (indicators.length === 1) return null;
    // Filter out STD from mixed lists so it never appears as a chip.
    const withoutStd = indicators.filter((ind) => ind !== 'STD');
    if (withoutStd.length === 0) return null;
    if (withoutStd.length !== indicators.length) {
      return (
        <View style={[styles.row, size === 'md' ? styles.rowMd : styles.rowSm, containerStyle]}>
          {withoutStd.map((ind) => (
            <FitmentChip
              key={ind}
              label={ind}
              active={selectedSingle === ind}
              interactive={false}
              emphasizeSelection={emphasizeSelection}
              size={size}
              isDark={isDark}
              primary={colors.primary || NEON_NIGHT_THEME.primary}
              text={colors.text}
              textSecondary={colors.textSecondary}
              reducedMotion={reducedMotion}
              onPress={() => {}}
            />
          ))}
        </View>
      );
    }
  }

  const handlePress = useCallback(
    (ind: string) => {
      if (mode === 'display') return;
      if (Platform.OS !== 'web') {
        Haptics.selectionAsync().catch(() => {});
      }
      if (mode === 'interactive') {
        (props as InteractiveProps).onChange(ind);
      } else if (mode === 'multi') {
        (props as MultiProps).onToggle(ind);
      }
    },
    [mode, props],
  );

  return (
    <View
      style={[
        styles.row,
        size === 'md' ? styles.rowMd : styles.rowSm,
        containerStyle,
      ]}
    >
      {indicators.map((ind) => {
        const isActive =
          mode === 'multi'
            ? !!selectedMulti?.has(ind)
            : selectedSingle === ind;
        return (
          <FitmentChip
            key={ind}
            label={ind}
            active={isActive}
            interactive={mode !== 'display'}
            emphasizeSelection={emphasizeSelection}
            size={size}
            isDark={isDark}
            primary={colors.primary || NEON_NIGHT_THEME.primary}
            text={colors.text}
            textSecondary={colors.textSecondary}
            reducedMotion={reducedMotion}
            onPress={() => handlePress(ind)}
          />
        );
      })}
    </View>
  );
};

interface ChipProps {
  label: string;
  active: boolean;
  interactive: boolean;
  emphasizeSelection: boolean;
  size: FitmentStripSize;
  isDark: boolean;
  primary: string;
  text: string;
  textSecondary: string;
  reducedMotion: boolean;
  onPress: () => void;
}

const FitmentChip: React.FC<ChipProps> = React.memo(
  ({
    label,
    active,
    interactive,
    emphasizeSelection,
    size,
    isDark,
    primary,
    text,
    textSecondary,
    reducedMotion,
    onPress,
  }) => {
    const scale = useRef(new Animated.Value(active ? 1.06 : 1)).current;
    const glow = useRef(new Animated.Value(active ? 1 : 0)).current;

    useEffect(() => {
      if (reducedMotion) {
        scale.setValue(active && emphasizeSelection ? 1.04 : 1);
        glow.setValue(active ? 1 : 0);
        return;
      }
      Animated.parallel([
        Animated.spring(scale, {
          toValue: active && emphasizeSelection ? 1.06 : 1,
          friction: 6,
          tension: 220,
          useNativeDriver: true,
        }),
        Animated.timing(glow, {
          toValue: active ? 1 : 0,
          duration: 180,
          useNativeDriver: false,
        }),
      ]).start();
    }, [active, emphasizeSelection, reducedMotion, scale, glow]);

    const handleIn = useCallback(() => {
      if (!interactive || reducedMotion) return;
      Animated.spring(scale, {
        toValue: 0.94,
        friction: 6,
        tension: 260,
        useNativeDriver: true,
      }).start();
    }, [interactive, reducedMotion, scale]);

    const handleOut = useCallback(() => {
      if (!interactive || reducedMotion) return;
      Animated.spring(scale, {
        toValue: active && emphasizeSelection ? 1.06 : 1,
        friction: 6,
        tension: 220,
        useNativeDriver: true,
      }).start();
    }, [interactive, reducedMotion, scale, active, emphasizeSelection]);

    const baseBg = isDark ? 'rgba(255,255,255,0.06)' : '#FFFFFF';
    const baseBorder = isDark ? 'rgba(255,255,255,0.18)' : '#E5E7EB';
    const activeBg = primary;
    const activeBorder = primary;

    const chipStyles = [
      styles.chip,
      size === 'md' ? styles.chipMd : styles.chipSm,
      {
        backgroundColor: active ? activeBg : baseBg,
        borderColor: active ? activeBorder : baseBorder,
      },
    ];

    // Glow as a separate absolute layer so we don't animate width/height.
    const glowOpacity = glow.interpolate({
      inputRange: [0, 1],
      outputRange: [0, 0.55],
    });

    const ChipBody = (
      <Animated.View
        style={[
          { transform: [{ scale }] },
          // Cross-platform halo: opacity-driven shadow on native, box-shadow on web.
          Platform.OS === 'web'
            ? {
                // @ts-ignore web-only property
                boxShadow: active
                  ? `0 0 12px ${primary}66, 0 0 4px ${primary}AA`
                  : 'none',
              }
            : {
                shadowColor: primary,
                shadowOffset: { width: 0, height: 0 },
                shadowOpacity: active ? 0.55 : 0,
                shadowRadius: active ? 8 : 0,
                elevation: active ? 6 : 0,
              },
        ]}
      >
        <View style={chipStyles}>
          {/* Animated inner glow ring (opacity only — no layout shift) */}
          {active && (
            <Animated.View
              pointerEvents="none"
              style={[
                StyleSheet.absoluteFillObject,
                styles.glowRing,
                {
                  borderColor: primary,
                  opacity: glowOpacity,
                },
              ]}
            />
          )}
          <Text
            style={[
              styles.label,
              size === 'md' ? styles.labelMd : styles.labelSm,
              {
                color: active ? '#FFFFFF' : text,
              },
            ]}
          >
            {label}
          </Text>
        </View>
      </Animated.View>
    );

    if (!interactive) {
      return ChipBody;
    }

    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`الحجم ${label}`}
        accessibilityState={{ selected: active }}
        onPressIn={handleIn}
        onPressOut={handleOut}
        onPress={onPress}
        hitSlop={6}
      >
        {ChipBody}
      </Pressable>
    );
  },
);

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowSm: { gap: 5 },
  rowMd: { gap: 8 },
  chip: {
    borderWidth: 1.4,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  chipSm: {
    minWidth: 38,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
  },
  chipMd: {
    minWidth: 56,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
  },
  label: {
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  labelSm: { fontSize: 11 },
  labelMd: { fontSize: 14 },
  glowRing: {
    borderRadius: 999,
    borderWidth: 1.5,
  },
});

export default React.memo(FitmentStrip);
