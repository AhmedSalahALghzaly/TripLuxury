/**
 * GoldenGlowText - Animated golden flash effect for subscribe CTA
 * Uses react-native-reanimated for smooth color interpolation
 * Flashes between Gold (#FFD700) and White (#FFFFFF) 3 times
 */
import React, { useEffect, useCallback } from 'react';
import { StyleSheet, View, ViewStyle } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSequence,
  withTiming,
  withDelay,
  runOnJS,
  interpolateColor,
  Easing,
} from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';

interface GoldenGlowTextProps {
  children: React.ReactNode;
  isAnimating: boolean;
  onAnimationComplete?: () => void;
  style?: ViewStyle;
  textStyle?: any;
  baseColor?: string;
}

export const GoldenGlowText: React.FC<GoldenGlowTextProps> = ({
  children,
  isAnimating,
  onAnimationComplete,
  style,
  textStyle,
  baseColor = '#FFFFFF',
}) => {
  const colorProgress = useSharedValue(0);
  const glowIntensity = useSharedValue(0);
  const scale = useSharedValue(1);

  const triggerHaptic = useCallback(() => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
  }, []);

  const handleAnimationComplete = useCallback(() => {
    if (onAnimationComplete) {
      onAnimationComplete();
    }
  }, [onAnimationComplete]);

  useEffect(() => {
    if (isAnimating) {
      // Trigger haptic feedback
      triggerHaptic();

      // Animation: 3 cycles of flashing between white and gold
      // Each cycle: 250ms to gold, 250ms to white = 500ms per cycle
      const flashDuration = 250;
      
      colorProgress.value = withSequence(
        // Cycle 1
        withTiming(1, { duration: flashDuration, easing: Easing.inOut(Easing.ease) }),
        withTiming(0, { duration: flashDuration, easing: Easing.inOut(Easing.ease) }),
        // Cycle 2
        withTiming(1, { duration: flashDuration, easing: Easing.inOut(Easing.ease) }),
        withTiming(0, { duration: flashDuration, easing: Easing.inOut(Easing.ease) }),
        // Cycle 3
        withTiming(1, { duration: flashDuration, easing: Easing.inOut(Easing.ease) }),
        withTiming(0, { duration: flashDuration, easing: Easing.inOut(Easing.ease) }, () => {
          runOnJS(handleAnimationComplete)();
        })
      );

      // Glow intensity animation (shadow effect)
      glowIntensity.value = withSequence(
        withTiming(1, { duration: flashDuration }),
        withTiming(0.3, { duration: flashDuration }),
        withTiming(1, { duration: flashDuration }),
        withTiming(0.3, { duration: flashDuration }),
        withTiming(1, { duration: flashDuration }),
        withTiming(0, { duration: flashDuration })
      );

      // Subtle scale pulse
      scale.value = withSequence(
        withTiming(1.05, { duration: flashDuration }),
        withTiming(1, { duration: flashDuration }),
        withTiming(1.05, { duration: flashDuration }),
        withTiming(1, { duration: flashDuration }),
        withTiming(1.05, { duration: flashDuration }),
        withTiming(1, { duration: flashDuration })
      );
    }
  }, [isAnimating]);

  const animatedTextStyle = useAnimatedStyle(() => {
    const color = interpolateColor(
      colorProgress.value,
      [0, 1],
      [baseColor, '#FFD700']
    );

    return {
      color,
      transform: [{ scale: scale.value }],
      textShadowColor: interpolateColor(
        glowIntensity.value,
        [0, 1],
        ['transparent', '#FFD700']
      ),
      textShadowOffset: { width: 0, height: 0 },
      textShadowRadius: 10 * glowIntensity.value,
    };
  });

  const animatedContainerStyle = useAnimatedStyle(() => {
    return {
      shadowColor: '#FFD700',
      shadowOffset: { width: 0, height: 0 },
      shadowOpacity: 0.8 * glowIntensity.value,
      shadowRadius: 15 * glowIntensity.value,
    };
  });

  return (
    <Animated.View style={[styles.container, style, animatedContainerStyle]}>
      <Animated.Text style={[textStyle, animatedTextStyle]}>
        {children}
      </Animated.Text>
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});

export default GoldenGlowText;
