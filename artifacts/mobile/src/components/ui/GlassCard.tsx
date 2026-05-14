/**
 * GlassCard - Glassmorphism styled card container with BlurView
 * Reusable component with theme support and frosted glass effect
 * Updated for 2026 standards with boxShadow support
 */
import React from 'react';
import { View, StyleSheet, ViewStyle, StyleProp, Platform } from 'react-native';
import { BlurView } from 'expo-blur';
import { useTheme } from '../../hooks/useTheme';

interface GlassCardProps {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  intensity?: number;
  tint?: 'light' | 'dark' | 'default';
}

// Cross-platform shadow style
const getCardShadow = (): ViewStyle => {
  if (Platform.OS === 'web') {
    return {
      boxShadow: '0px 2px 8px rgba(0, 0, 0, 0.1)',
    } as ViewStyle;
  }
  return {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 3,
  };
};

export const GlassCard: React.FC<GlassCardProps> = ({ 
  children, 
  style,
  intensity = 50,
  tint,
}) => {
  const { isDark } = useTheme();
  
  // Auto-select tint based on theme if not provided
  const blurTint = tint || (isDark ? 'dark' : 'light');

  // BlurView works best on iOS, fallback to semi-transparent background on web/Android
  if (Platform.OS === 'web') {
    return (
      <View
        style={[
          styles.glassCard,
          getCardShadow(),
          {
            backgroundColor: isDark
              ? 'rgba(30, 41, 59, 0.85)'
              : 'rgba(255, 255, 255, 0.85)',
            backdropFilter: 'blur(10px)',
          },
          style,
        ]}
      >
        {children}
      </View>
    );
  }

  return (
    <View style={[styles.glassCard, getCardShadow(), style]}>
      <BlurView
        intensity={intensity}
        tint={blurTint}
        style={StyleSheet.absoluteFill}
      />
      <View style={[
        styles.glassContent,
        {
          backgroundColor: isDark
            ? 'rgba(30, 41, 59, 0.3)'
            : 'rgba(255, 255, 255, 0.3)',
        }
      ]}>
        {children}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  glassCard: {
    borderRadius: 16,
    overflow: 'hidden',
    marginHorizontal: 16,
    marginBottom: 12,
  },
  glassContent: {
    padding: 16,
  },
});

export default GlassCard;
