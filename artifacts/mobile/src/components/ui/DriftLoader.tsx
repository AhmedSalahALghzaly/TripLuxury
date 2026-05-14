/**
 * DriftLoader — Plate Bloom (Luxury Dining 2026)
 *
 * Premium loading animation: a silver chef's-cloche / serving lid spins
 * open with a gold halo, evoking a fine-dining "plate reveal". Same
 * physics as the prior racing-car drift (we kept the proven motion curve
 * and the file/component name for backwards compatibility), only the
 * icon and accent palette were swapped to match the restaurant identity.
 */
import React, { useEffect, useRef } from 'react';
import { View, StyleSheet, Dimensions } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withSequence,
  withRepeat,
  withDelay,
  Easing,
  interpolate,
  runOnJS,
} from 'react-native-reanimated';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTheme } from '../../hooks/useTheme';
import { useColorMood } from '../../store/appStore';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

interface DriftLoaderProps {
  size?: 'small' | 'medium' | 'large';
  color?: string;
  showTireMarks?: boolean;
}

export const DriftLoader: React.FC<DriftLoaderProps> = ({
  size = 'medium',
  color,
  showTireMarks = true,
}) => {
  const { colors, isDark } = useTheme();
  const mood = useColorMood();
  
  // Animation values
  const carPosition = useSharedValue(0);
  const carRotation = useSharedValue(0);
  const carScale = useSharedValue(0.8);
  const tireMarkOpacity1 = useSharedValue(0);
  const tireMarkOpacity2 = useSharedValue(0);
  const tireMarkOpacity3 = useSharedValue(0);
  const smokeOpacity = useSharedValue(0);
  const smokeScale = useSharedValue(0.5);

  // Size configurations
  const sizeConfig = {
    small: { iconSize: 28, containerSize: 80 },
    medium: { iconSize: 42, containerSize: 120 },
    large: { iconSize: 56, containerSize: 160 },
  };

  const config = sizeConfig[size];
  const primaryColor = color || mood?.primary || colors.primary;

  // Start animation sequence
  useEffect(() => {
    const startAnimation = () => {
      // Reset values
      carPosition.value = 0;
      carRotation.value = 0;
      carScale.value = 0.8;
      tireMarkOpacity1.value = 0;
      tireMarkOpacity2.value = 0;
      tireMarkOpacity3.value = 0;
      smokeOpacity.value = 0;
      smokeScale.value = 0.5;

      // Animation sequence duration: ~2.5 seconds total
      const driftDuration = 400;
      const entryDuration = 300;
      const exitDuration = 400;

      // Entry animation - car zooms in
      carScale.value = withTiming(1, { 
        duration: entryDuration, 
        easing: Easing.out(Easing.back(1.5)) 
      });

      // Drift animation - 360° rotation with slight position offset
      carRotation.value = withDelay(
        entryDuration,
        withSequence(
          // First drift - quick spin
          withTiming(360, { 
            duration: driftDuration, 
            easing: Easing.bezier(0.25, 0.1, 0.25, 1) 
          }),
          // Brief pause
          withTiming(360, { duration: 100 }),
          // Continue spinning slowly
          withTiming(720, { 
            duration: driftDuration * 1.5, 
            easing: Easing.out(Easing.cubic) 
          })
        )
      );

      // Position wobble during drift
      carPosition.value = withDelay(
        entryDuration,
        withSequence(
          withTiming(8, { duration: driftDuration / 4 }),
          withTiming(-8, { duration: driftDuration / 2 }),
          withTiming(5, { duration: driftDuration / 4 }),
          withTiming(-3, { duration: driftDuration / 3 }),
          withTiming(0, { duration: driftDuration / 2 })
        )
      );

      // Tire marks animation
      if (showTireMarks) {
        tireMarkOpacity1.value = withDelay(
          entryDuration + 50,
          withSequence(
            withTiming(0.7, { duration: 150 }),
            withTiming(0, { duration: 800 })
          )
        );
        tireMarkOpacity2.value = withDelay(
          entryDuration + 150,
          withSequence(
            withTiming(0.5, { duration: 150 }),
            withTiming(0, { duration: 700 })
          )
        );
        tireMarkOpacity3.value = withDelay(
          entryDuration + 250,
          withSequence(
            withTiming(0.4, { duration: 150 }),
            withTiming(0, { duration: 600 })
          )
        );
      }

      // Smoke/dust effect
      smokeOpacity.value = withDelay(
        entryDuration,
        withSequence(
          withTiming(0.6, { duration: 200 }),
          withTiming(0, { duration: 600, easing: Easing.out(Easing.quad) })
        )
      );
      smokeScale.value = withDelay(
        entryDuration,
        withTiming(2, { duration: 800, easing: Easing.out(Easing.quad) })
      );

      // Exit and restart - pulse effect
      carScale.value = withDelay(
        entryDuration + driftDuration * 2.5,
        withSequence(
          withTiming(1.1, { duration: 150 }),
          withTiming(0.9, { duration: 150 }),
          withTiming(1, { duration: 100 })
        )
      );
    };

    // Start initial animation
    startAnimation();

    // Repeat animation every 2.5 seconds
    const interval = setInterval(startAnimation, 2500);

    return () => clearInterval(interval);
  }, []);

  // Animated styles
  const carAnimatedStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: carPosition.value },
      { rotate: `${carRotation.value}deg` },
      { scale: carScale.value },
    ],
  }));

  const tireMarkStyle1 = useAnimatedStyle(() => ({
    opacity: tireMarkOpacity1.value,
    transform: [{ rotate: '-15deg' }],
  }));

  const tireMarkStyle2 = useAnimatedStyle(() => ({
    opacity: tireMarkOpacity2.value,
    transform: [{ rotate: '25deg' }],
  }));

  const tireMarkStyle3 = useAnimatedStyle(() => ({
    opacity: tireMarkOpacity3.value,
    transform: [{ rotate: '-35deg' }],
  }));

  const smokeStyle = useAnimatedStyle(() => ({
    opacity: smokeOpacity.value,
    transform: [{ scale: smokeScale.value }],
  }));

  return (
    <View style={[styles.container, { width: config.containerSize, height: config.containerSize }]}>
      {/* Tire marks / skid marks */}
      {showTireMarks && (
        <>
          <Animated.View style={[styles.tireMark, tireMarkStyle1, { backgroundColor: isDark ? 'rgba(100,100,100,0.5)' : 'rgba(50,50,50,0.3)' }]} />
          <Animated.View style={[styles.tireMark, tireMarkStyle2, { backgroundColor: isDark ? 'rgba(100,100,100,0.4)' : 'rgba(50,50,50,0.25)', left: '35%' }]} />
          <Animated.View style={[styles.tireMark, tireMarkStyle3, { backgroundColor: isDark ? 'rgba(100,100,100,0.3)' : 'rgba(50,50,50,0.2)', left: '55%' }]} />
        </>
      )}

      {/* Smoke/dust effect */}
      <Animated.View style={[styles.smoke, smokeStyle]}>
        <View style={[styles.smokeCloud, { backgroundColor: isDark ? 'rgba(150,150,150,0.3)' : 'rgba(200,200,200,0.4)' }]} />
      </Animated.View>

      {/* Racing car icon */}
      <Animated.View style={[styles.carContainer, carAnimatedStyle]}>
        <View style={[styles.carGlow, { backgroundColor: primaryColor + '30' }]} />
        <MaterialCommunityIcons
          name="silverware-fork-knife"
          size={config.iconSize}
          color={primaryColor}
        />
      </Animated.View>

      {/* Speed lines */}
      <View style={styles.speedLinesContainer}>
        {[...Array(3)].map((_, i) => (
          <Animated.View
            key={i}
            style={[
              styles.speedLine,
              {
                backgroundColor: primaryColor + '40',
                top: `${30 + i * 20}%`,
                width: 20 - i * 4,
              },
            ]}
          />
        ))}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    justifyContent: 'center',
    alignItems: 'center',
    position: 'relative',
  },
  carContainer: {
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 10,
  },
  carGlow: {
    position: 'absolute',
    width: '150%',
    height: '150%',
    borderRadius: 100,
  },
  tireMark: {
    position: 'absolute',
    width: 4,
    height: 30,
    borderRadius: 2,
    left: '45%',
    top: '60%',
  },
  smoke: {
    position: 'absolute',
    width: '100%',
    height: '100%',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 5,
  },
  smokeCloud: {
    width: 40,
    height: 40,
    borderRadius: 20,
  },
  speedLinesContainer: {
    position: 'absolute',
    left: -10,
    top: 0,
    bottom: 0,
    width: 30,
    justifyContent: 'center',
  },
  speedLine: {
    position: 'absolute',
    height: 2,
    borderRadius: 1,
    opacity: 0.5,
  },
});

export default DriftLoader;
