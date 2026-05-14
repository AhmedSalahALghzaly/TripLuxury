import React, { useCallback } from 'react';
import { View, Text, Pressable, Animated, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useTheme } from '../hooks/useTheme';
import { useTranslation } from '../hooks/useTranslation';

interface Props {
  value: boolean;
  onChange: (v: boolean) => void;
}

const TireToggle: React.FC<Props> = ({ value, onChange }) => {
  const { colors, isDark } = useTheme();
  const { language } = useTranslation();
  const scale = React.useRef(new Animated.Value(1)).current;

  const handlePress = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    Animated.sequence([
      Animated.timing(scale, { toValue: 0.96, duration: 80, useNativeDriver: true }),
      Animated.spring(scale, { toValue: 1, useNativeDriver: true, speed: 30 }),
    ]).start();
    onChange(!value);
  }, [value, onChange, scale]);

  return (
    <Animated.View style={{ transform: [{ scale }] }}>
      <Pressable
        accessibilityRole="switch"
        accessibilityState={{ checked: value }}
        accessibilityLabel={language === 'ar' ? 'وجبات مميزة فقط' : 'Featured meals only'}
        onPress={handlePress}
        hitSlop={6}
        style={[
          styles.container,
          {
            backgroundColor: value
              ? colors.primary
              : (isDark ? 'rgba(255,255,255,0.08)' : '#FFFFFF'),
            borderColor: value ? colors.primary : (isDark ? 'rgba(255,255,255,0.18)' : '#E5E7EB'),
          },
        ]}
      >
        <Ionicons
          name="star"
          size={14}
          color={value ? '#FFFFFF' : colors.textSecondary}
          style={{ marginEnd: 6 }}
        />
        <Text style={[styles.label, { color: value ? '#FFFFFF' : colors.text }]}>
          {language === 'ar' ? 'وجبات مميزة' : 'Featured meals'}
        </Text>
      </Pressable>
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  container: {
    minHeight: 44,
    paddingHorizontal: 14,
    borderRadius: 22,
    borderWidth: 1.5,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: { fontSize: 14, fontWeight: '700' },
});

export default React.memo(TireToggle);
