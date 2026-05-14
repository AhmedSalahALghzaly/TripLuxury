/**
 * Confetti Effect Component
 * Shows celebratory confetti animation
 */
import React, { useEffect, useState } from 'react';
import { View, StyleSheet, Dimensions } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withDelay,
  Easing,
} from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

const COLORS = ['#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FFEAA7', '#DDA0DD', '#98D8C8'];
const PARTICLE_COUNT = 50;

interface Particle {
  id: number;
  x: number;
  y: number;
  rotation: number;
  color: string;
  size: number;
  delay: number;
}

interface ConfettiParticleProps {
  particle: Particle;
  active: boolean;
}

const ConfettiParticle: React.FC<ConfettiParticleProps> = ({ particle, active }) => {
  const translateY = useSharedValue(-50);
  const translateX = useSharedValue(particle.x);
  const rotate = useSharedValue(0);
  const opacity = useSharedValue(1);

  useEffect(() => {
    if (active) {
      const targetY = SCREEN_HEIGHT + 100;
      const randomXOffset = (Math.random() - 0.5) * 200;
      
      translateY.value = withDelay(
        particle.delay,
        withTiming(targetY, { duration: 3000, easing: Easing.out(Easing.quad) })
      );
      
      translateX.value = withDelay(
        particle.delay,
        withTiming(particle.x + randomXOffset, { duration: 3000 })
      );
      
      rotate.value = withDelay(
        particle.delay,
        withTiming(particle.rotation + 720, { duration: 3000 })
      );
      
      opacity.value = withDelay(
        particle.delay + 2000,
        withTiming(0, { duration: 1000 })
      );
    }
  }, [active]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.value },
      { translateY: translateY.value },
      { rotate: `${rotate.value}deg` },
    ],
    opacity: opacity.value,
  }));

  return (
    <Animated.View
      style={[
        styles.particle,
        {
          width: particle.size,
          height: particle.size * 0.6,
          backgroundColor: particle.color,
          borderRadius: particle.size * 0.1,
        },
        animatedStyle,
      ]}
    />
  );
};

interface ConfettiEffectProps {
  active: boolean;
  onComplete?: () => void;
}

export const ConfettiEffect: React.FC<ConfettiEffectProps> = ({ active, onComplete }) => {
  const [particles, setParticles] = useState<Particle[]>([]);

  useEffect(() => {
    if (active) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      
      const newParticles: Particle[] = [];
      for (let i = 0; i < PARTICLE_COUNT; i++) {
        newParticles.push({
          id: i,
          x: Math.random() * SCREEN_WIDTH,
          y: -50,
          rotation: Math.random() * 360,
          color: COLORS[Math.floor(Math.random() * COLORS.length)],
          size: 8 + Math.random() * 8,
          delay: Math.random() * 500,
        });
      }
      setParticles(newParticles);

      // Cleanup after animation
      const timer = setTimeout(() => {
        setParticles([]);
        onComplete?.();
      }, 4000);

      return () => clearTimeout(timer);
    }
  }, [active]);

  if (!active || particles.length === 0) return null;

  return (
    <View style={styles.container} pointerEvents="none">
      {particles.map((particle) => (
        <ConfettiParticle key={particle.id} particle={particle} active={active} />
      ))}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 9999,
    pointerEvents: 'none',
  },
  particle: {
    position: 'absolute',
  },
});

export default ConfettiEffect;
