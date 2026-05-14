import React, { useRef, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Animated,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../hooks/useTheme';
import { useTranslation } from '../../hooks/useTranslation';

export type FuelType = 'regular' | 'vegetarian' | 'vegan' | 'gluten_free' | 'halal';
export type DietaryType = FuelType;

interface FuelTypeConfig {
  key: FuelType;
  label: string;
  labelAr: string;
  icon: keyof typeof Ionicons.glyphMap;
  color: string;
  gradient: string[];
}

export const FUEL_TYPES: FuelTypeConfig[] = [
  { key: 'regular', label: 'Regular', labelAr: 'عادي', icon: 'restaurant-outline', color: '#6B7280', gradient: ['#6B7280', '#4B5563'] },
  { key: 'vegetarian', label: 'Vegetarian', labelAr: 'نباتي', icon: 'leaf', color: '#22C55E', gradient: ['#22C55E', '#16A34A'] },
  { key: 'vegan', label: 'Vegan', labelAr: 'صرف', icon: 'leaf-outline', color: '#10B981', gradient: ['#10B981', '#059669'] },
  { key: 'gluten_free', label: 'G-Free', labelAr: 'خ.جلوتين', icon: 'shield-checkmark-outline', color: '#F59E0B', gradient: ['#F59E0B', '#D97706'] },
  { key: 'halal', label: 'Halal', labelAr: 'حلال', icon: 'checkmark-circle', color: '#8B5CF6', gradient: ['#8B5CF6', '#7C3AED'] },
];

export function getFuelTypeConfig(type: string): FuelTypeConfig {
  return FUEL_TYPES.find(f => f.key === type) || FUEL_TYPES[1];
}

interface FuelTypeSelectorProps {
  selected: FuelType | FuelType[] | null;
  onSelect: (type: FuelType) => void;
  multiSelect?: boolean;
  compact?: boolean;
  showLabel?: boolean;
}

function FuelButton({
  item,
  isSelected,
  onPress,
  compact,
  showLabel,
}: {
  item: FuelTypeConfig;
  isSelected: boolean;
  onPress: () => void;
  compact?: boolean;
  showLabel?: boolean;
}) {
  const { colors } = useTheme();
  const { language } = useTranslation();
  const scaleAnim = useRef(new Animated.Value(1)).current;
  const bgAnim = useRef(new Animated.Value(isSelected ? 1 : 0)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.spring(scaleAnim, {
        toValue: isSelected ? 1.05 : 1,
        useNativeDriver: Platform.OS !== 'web',
        tension: 150,
        friction: 8,
      }),
      Animated.timing(bgAnim, {
        toValue: isSelected ? 1 : 0,
        duration: 200,
        useNativeDriver: false,
      }),
    ]).start();
  }, [isSelected]);

  const handlePress = () => {
    Animated.sequence([
      Animated.timing(scaleAnim, { toValue: 0.92, duration: 80, useNativeDriver: Platform.OS !== 'web' }),
      Animated.spring(scaleAnim, { toValue: isSelected ? 1 : 1.05, useNativeDriver: Platform.OS !== 'web', tension: 200, friction: 8 }),
    ]).start();
    onPress();
  };

  const bgColor = bgAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [colors.surface, item.color + '25'],
  });

  const borderColor = bgAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['#cccecf', item.color],
  });

  const iconSize = compact ? 19.9: 30;
  const label = language === 'ar' ? item.labelAr : item.label;

  return (
    <Animated.View style={{ transform: [{ scale: scaleAnim }] }}>
      <TouchableOpacity
        onPress={handlePress}
        activeOpacity={0.7}
      >
        <Animated.View
          style={[
            compact ? fuelStyles.compactButton : fuelStyles.button,
            { backgroundColor: bgColor, borderColor },
          ]}
        >
          <View
            style={[
              fuelStyles.iconCircle,
              {
                backgroundColor: isSelected ? item.color : item.color + '20',
                width: compact ? 50 : 59,
                height: compact ? 30 : 39,
                borderRadius: compact ? 19 : 23,
              },
            ]}
          >
            <Ionicons name={item.icon} size={iconSize} color={isSelected ? '#FFF' : item.color} />
          </View>
          {(showLabel !== false) && (
            <Text
              style={[
                compact ? fuelStyles.compactLabel : fuelStyles.label,
                { color: isSelected ? item.color : colors.text },
              ]}
              numberOfLines={1}
            >
              {label}
            </Text>
          )}
        </Animated.View>
      </TouchableOpacity>
    </Animated.View>
  );
}

export function FuelTypeSelector({
  selected,
  onSelect,
  multiSelect = false,
  compact = false,
  showLabel = true,
}: FuelTypeSelectorProps) {
  const { colors } = useTheme();
  const { language } = useTranslation();

  const isSelected = (key: FuelType) => {
    if (Array.isArray(selected)) return selected.includes(key);
    return selected === key;
  };

  return (
    <View style={fuelStyles.container}>
      <View style={[fuelStyles.row, compact && fuelStyles.rowCompact]}>
        {FUEL_TYPES.map((item) => (
          <FuelButton
            key={item.key}
            item={item}
            isSelected={isSelected(item.key)}
            onPress={() => onSelect(item.key)}
            compact={compact}
            showLabel={showLabel}
          />
        ))}
      </View>
    </View>
  );
}

export function FuelTypeIcon({
  type,
  size = 15,
}: {
  type: string;
  size?: number;
}) {
  const config = getFuelTypeConfig(type);
  const iconSize = Math.round(size * 0.70);

  return (
    <View
      style={[
        fuelStyles.fuelIcon,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: config.color + 'DD',
        },
      ]}
    >
      <Ionicons name={config.icon} size={iconSize} color="#FFF" />
    </View>
  );
}

const fuelStyles = StyleSheet.create({
  container: { marginBottom: 1 },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 7,
  },
  rowCompact: { gap: 7 },
  button: {
    alignItems: 'center',
    paddingVertical: 3,
    paddingHorizontal: 3,
    borderRadius: 19,
    borderWidth: 1.9,
    minWidth: 55,
    gap: 9,
  },
  compactButton: {
    alignItems: 'center',
    paddingVertical: 3,
    paddingHorizontal: 3,
    borderRadius: 19,
    borderWidth: 0.7,
    minWidth: 55,
    gap: 1,
  },
  iconCircle: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    fontSize: 11,
    fontWeight: '700' as const,
    textAlign: 'center' as const,
  },
  compactLabel: {
    fontSize: 11,
    fontWeight: '700' as const,
    textAlign: 'center' as const,
  },
  fuelIcon: {
    alignItems: 'center',
    justifyContent: 'center',
    position: 'absolute' as const,
    top: 5,
    left: 5,
    zIndex: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 5,
    elevation: 5,
  },
});