/**
 * SkeletonLoader - Animated loading placeholder
 * Reusable across the application
 */
import React, { useEffect, useRef } from 'react';
import { Animated, ViewStyle } from 'react-native';

interface SkeletonLoaderProps {
  width: number | string;
  height: number;
  style?: ViewStyle;
  color?: string;
  borderRadius?: number;
}

export const SkeletonLoader: React.FC<SkeletonLoaderProps> = ({
  width,
  height,
  style,
  color = '#3B82F6',
  borderRadius = 8,
}) => {
  const pulseAnim = useRef(new Animated.Value(0.3)).current;

  useEffect(() => {
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 800,
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 0.3,
          duration: 800,
          useNativeDriver: true,
        }),
      ])
    );
    animation.start();
    return () => animation.stop();
  }, [pulseAnim]);

  return (
    <Animated.View
      style={[
        {
          width,
          height,
          backgroundColor: color,
          borderRadius,
        } as object,
        { opacity: pulseAnim },
        style,
      ]}
    />
  );
};

export default SkeletonLoader;
