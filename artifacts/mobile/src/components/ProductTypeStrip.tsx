import React, { useCallback, useMemo, useRef } from 'react';
import {
  View,
  Text,
  Pressable,
  Animated,
  StyleSheet,
  Platform,
  ViewStyle,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useTheme } from '../hooks/useTheme';
import { useTranslation } from '../hooks/useTranslation';

export type ProductType = 'tire' | 'accessory' | 'exterior';

interface IconDef {
  key: ProductType;
  icon: keyof typeof Ionicons.glyphMap;
  label_en: string;
  label_ar: string;
}

// NOTE: The internal `ProductType` keys (tire/accessory/exterior) remain
// unchanged because they map to the `product_type` column in Postgres and
// are referenced across the API. Only the visible label and icon are
// re-themed for the luxury restaurant identity:
//   tire      → Family Meals
//   accessory → Drinks
//   exterior  → Additions
// The default/general bucket (no product_type) reads as "Meals" in copy.
const ICONS: IconDef[] = [
  { key: 'tire',      icon: 'people',       label_en: 'Family Meals', label_ar: 'وجبات عائلية' },
  { key: 'accessory', icon: 'wine',         label_en: 'Drinks',       label_ar: 'المشروبات' },
  { key: 'exterior',  icon: 'restaurant',   label_en: 'Additions',    label_ar: 'الإضافات' },
];

interface SingleProps {
  mode?: 'single';
  value: ProductType | null;
  onChange: (value: ProductType | null) => void;
  size?: 'sm' | 'md' | 'lg';
  allowClear?: boolean;
  containerStyle?: ViewStyle;
}

interface MultiProps {
  mode: 'multi';
  values: ProductType[];
  onChange: (values: ProductType[]) => void;
  size?: 'sm' | 'md' | 'lg';
  containerStyle?: ViewStyle;
}

type Props = SingleProps | MultiProps;

const SIZES = {
  sm: { tile: 64,  icon: 22, font: 10 },
  md: { tile: 84,  icon: 30, font: 12 },
  lg: { tile: 104, icon: 38, font: 13 },
};

const Tile: React.FC<{
  def: IconDef;
  active: boolean;
  size: 'sm' | 'md' | 'lg';
  onPress: () => void;
}> = ({ def, active, size, onPress }) => {
  const { colors, isDark } = useTheme();
  const { language } = useTranslation();
  const scale = useRef(new Animated.Value(1)).current;
  const glow = useRef(new Animated.Value(active ? 1 : 0)).current;

  React.useEffect(() => {
    Animated.timing(glow, {
      toValue: active ? 1 : 0,
      duration: 220,
      useNativeDriver: false,
    }).start();
  }, [active, glow]);

  const handlePress = useCallback(() => {
    if (Platform.OS !== 'web') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    }
    Animated.sequence([
      Animated.timing(scale, { toValue: 0.92, duration: 90, useNativeDriver: true }),
      Animated.spring(scale, { toValue: 1, useNativeDriver: true, friction: 4, tension: 220 }),
    ]).start();
    onPress();
  }, [onPress, scale]);

  const dims = SIZES[size];
  const accent = colors.primary;

  const glowShadow = glow.interpolate({
    inputRange: [0, 1],
    outputRange: [0, 14],
  });
  const glowOpacity = glow.interpolate({
    inputRange: [0, 1],
    outputRange: [0, 0.85],
  });
  const borderColor = active ? accent : (isDark ? 'rgba(255,255,255,0.12)' : '#E5E7EB');
  const bgColor = active
    ? accent + (isDark ? '33' : '20')
    : (isDark ? 'rgba(255,255,255,0.04)' : '#FFFFFF');
  const iconColor = active ? accent : (isDark ? '#CBD5E1' : '#64748B');
  const labelColor = active ? accent : (isDark ? '#E2E8F0' : '#334155');
  const label = language === 'ar' ? def.label_ar : def.label_en;

  const isWeb = Platform.OS === 'web';
  // Web: static boxShadow (Animated boxShadow not supported by RNW). Native: drive
  // shadowOpacity/shadowRadius from the `glow` Animated.Value so the halo eases in/out.
  const webShadowStyle = isWeb
    ? {
        boxShadow: active
          ? `0px 0px 18px ${accent}66, 0px 4px 12px ${accent}33`
          : '0px 2px 6px rgba(0,0,0,0.06)',
      }
    : null;
  const nativeShadowStyle = !isWeb
    ? {
        shadowColor: accent,
        shadowOffset: { width: 0, height: 0 },
        shadowOpacity: glowOpacity,
        shadowRadius: glowShadow,
        elevation: active ? 6 : 0,
      }
    : null;

  return (
    <Animated.View
      style={[
        styles.tileWrapper,
        {
          width: dims.tile,
          transform: [{ scale }],
        },
        webShadowStyle,
        nativeShadowStyle,
      ]}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ selected: active }}
        accessibilityLabel={label}
        onPress={handlePress}
        style={[
          styles.tile,
          {
            backgroundColor: bgColor,
            borderColor,
            paddingVertical: size === 'sm' ? 8 : 10,
          },
        ]}
      >
        {active && Platform.OS === 'web' && (
          <View
            pointerEvents="none"
            style={{
              position: 'absolute',
              top: 0, left: 0, right: 0, bottom: 0,
              borderRadius: 14,
              borderWidth: 1.5,
              borderColor: accent,
              opacity: 0.6,
            }}
          />
        )}
        <Ionicons name={def.icon} size={dims.icon} color={iconColor} />
        <Text
          numberOfLines={1}
          style={[
            styles.label,
            { color: labelColor, fontSize: dims.font, marginTop: 4 },
          ]}
        >
          {label}
        </Text>
      </Pressable>
    </Animated.View>
  );
};

const ProductTypeStrip: React.FC<Props> = (props) => {
  const size = props.size || 'md';
  const containerStyle = props.containerStyle;

  const handleTilePress = useCallback(
    (key: ProductType) => {
      if (props.mode === 'multi') {
        const cur = props.values || [];
        const next = cur.includes(key) ? cur.filter((k) => k !== key) : [...cur, key];
        props.onChange(next);
      } else {
        const cur = props.value;
        if (cur === key) {
          if (props.allowClear !== false) props.onChange(null);
        } else {
          props.onChange(key);
        }
      }
    },
    [props],
  );

  const isActive = useCallback(
    (key: ProductType) => {
      if (props.mode === 'multi') return (props.values || []).includes(key);
      return props.value === key;
    },
    [props],
  );

  const tiles = useMemo(() => ICONS, []);

  return (
    <View style={[styles.container, containerStyle]}>
      {tiles.map((def) => (
        <Tile
          key={def.key}
          def={def}
          active={isActive(def.key)}
          size={size}
          onPress={() => handleTilePress(def.key)}
        />
      ))}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'stretch',
    justifyContent: 'center',
    gap: 10,
  },
  tileWrapper: {
    borderRadius: 16,
  },
  tile: {
    borderRadius: 14,
    borderWidth: 1.5,
    paddingHorizontal: 6,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 70,
    overflow: 'hidden',
  },
  label: {
    fontWeight: '700',
    textAlign: 'center',
  },
});

export default React.memo(ProductTypeStrip);
