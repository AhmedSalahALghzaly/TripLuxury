import React, { useCallback } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet, Animated } from 'react-native';
import * as Haptics from 'expo-haptics';
import { useTheme } from '../hooks/useTheme';

export interface FitmentVariant {
  indicator: string;
  price?: number;
  stock?: number;
}

interface Props {
  variants: FitmentVariant[];
  selected?: string | null;
  onChange: (indicator: string) => void;
  multi?: boolean;
  selectedSet?: Set<string>;
  hideOutOfStock?: boolean;
}

const ORDER = ['صغير', 'وسط', 'كبير', 'كومبو', 'عائلي'];

const FitmentSelector: React.FC<Props> = ({
  variants,
  selected,
  onChange,
  multi = false,
  selectedSet,
  hideOutOfStock = true,
}) => {
  const { colors, isDark } = useTheme();

  const visible = (variants || []).filter((v) =>
    hideOutOfStock ? (v.stock === undefined || v.stock === null || v.stock > 0) : true,
  );
  const sorted = [...visible].sort(
    (a, b) => ORDER.indexOf(a.indicator) - ORDER.indexOf(b.indicator),
  );

  if (sorted.length === 0) return null;

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.row}
    >
      {sorted.map((v) => {
        const isActive = multi
          ? !!selectedSet?.has(v.indicator)
          : selected === v.indicator;
        return (
          <FitmentChip
            key={v.indicator}
            label={v.indicator}
            active={isActive}
            colors={colors}
            isDark={isDark}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
              onChange(v.indicator);
            }}
          />
        );
      })}
    </ScrollView>
  );
};

const FitmentChip: React.FC<{
  label: string;
  active: boolean;
  colors: any;
  isDark: boolean;
  onPress: () => void;
}> = ({ label, active, colors, isDark, onPress }) => {
  const scale = React.useRef(new Animated.Value(1)).current;
  const handleIn = useCallback(() => {
    Animated.spring(scale, { toValue: 0.97, useNativeDriver: true, speed: 60 }).start();
  }, [scale]);
  const handleOut = useCallback(() => {
    Animated.spring(scale, {
      toValue: active ? 1.05 : 1,
      useNativeDriver: true,
      speed: 30,
    }).start();
  }, [scale, active]);

  React.useEffect(() => {
    Animated.spring(scale, {
      toValue: active ? 1.05 : 1,
      useNativeDriver: true,
      speed: 30,
    }).start();
  }, [active, scale]);

  return (
    <Animated.View style={{ transform: [{ scale }] }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`الحجم ${label}`}
        accessibilityState={{ selected: active }}
        onPressIn={handleIn}
        onPressOut={handleOut}
        onPress={onPress}
        hitSlop={6}
        style={[
          styles.chip,
          {
            backgroundColor: active
              ? colors.primary
              : (isDark ? 'rgba(255,255,255,0.06)' : '#FFFFFF'),
            borderColor: active ? colors.primary : (isDark ? 'rgba(255,255,255,0.18)' : '#E5E7EB'),
          },
        ]}
      >
        <Text
          style={[
            styles.label,
            { color: active ? '#FFFFFF' : colors.text },
          ]}
        >
          {label}
        </Text>
      </Pressable>
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  row: { gap: 8, paddingVertical: 4, paddingHorizontal: 2 },
  chip: {
    minWidth: 56,
    minHeight: 44,
    paddingHorizontal: 14,
    borderRadius: 12,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: { fontSize: 14, fontWeight: '700', letterSpacing: 0.4 },
});

export default React.memo(FitmentSelector);
