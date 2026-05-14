/**
 * AnimatedIconButton - Modern, futuristic animated icon buttons
 * Enhanced with neon glow effects, particle animations, and professional interactions
 */
import React, { useRef, useEffect, useState } from 'react';
import { TouchableOpacity, Animated, StyleSheet, ViewStyle, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';

interface AnimatedIconButtonProps {
  iconName: keyof typeof Ionicons.glyphMap;
  iconNameActive?: keyof typeof Ionicons.glyphMap;
  size?: number;
  color: string;
  activeColor?: string;
  backgroundColor?: string;
  activeBackgroundColor?: string;
  isActive?: boolean;
  isLoading?: boolean;
  onPress: () => void;
  disabled?: boolean;
  style?: ViewStyle;
  animationType?: 'bounce' | 'pulse' | 'scale' | 'shake' | 'neon';
}

export const AnimatedIconButton: React.FC<AnimatedIconButtonProps> = ({
  iconName,
  iconNameActive,
  size = 20,
  color,
  activeColor,
  backgroundColor = 'transparent',
  activeBackgroundColor,
  isActive = false,
  isLoading = false,
  onPress,
  disabled = false,
  style,
  animationType = 'bounce',
}) => {
  const scaleAnim = useRef(new Animated.Value(1)).current;
  const rotateAnim = useRef(new Animated.Value(0)).current;
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const glowAnim = useRef(new Animated.Value(0)).current;
  const bounceAnim = useRef(new Animated.Value(0)).current;

  // Loading pulse animation
  useEffect(() => {
    if (isLoading) {
      Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, {
            toValue: 0.6,
            duration: 400,
            useNativeDriver: true,
          }),
          Animated.timing(pulseAnim, {
            toValue: 1,
            duration: 400,
            useNativeDriver: true,
          }),
        ])
      ).start();
    } else {
      pulseAnim.setValue(1);
    }
  }, [isLoading]);

  // Active state animation - neon glow effect
  useEffect(() => {
    if (isActive) {
      // Neon glow animation
      Animated.loop(
        Animated.sequence([
          Animated.timing(glowAnim, {
            toValue: 1,
            duration: 1000,
            useNativeDriver: true,
          }),
          Animated.timing(glowAnim, {
            toValue: 0.5,
            duration: 1000,
            useNativeDriver: true,
          }),
        ])
      ).start();

      // Initial bounce
      Animated.sequence([
        Animated.spring(scaleAnim, {
          toValue: 1.4,
          friction: 3,
          tension: 200,
          useNativeDriver: true,
        }),
        Animated.spring(scaleAnim, {
          toValue: 1,
          friction: 3,
          tension: 200,
          useNativeDriver: true,
        }),
      ]).start();
    } else {
      glowAnim.setValue(0);
    }
  }, [isActive]);

  const handlePress = () => {
    if (disabled || isLoading) return;

    // Trigger animation based on type
    switch (animationType) {
      case 'bounce':
      case 'neon':
        Animated.sequence([
          Animated.spring(scaleAnim, {
            toValue: 0.7,
            friction: 5,
            tension: 400,
            useNativeDriver: true,
          }),
          Animated.spring(scaleAnim, {
            toValue: 1.3,
            friction: 3,
            tension: 300,
            useNativeDriver: true,
          }),
          Animated.spring(scaleAnim, {
            toValue: 1,
            friction: 4,
            tension: 200,
            useNativeDriver: true,
          }),
        ]).start();
        break;

      case 'pulse':
        Animated.sequence([
          Animated.timing(scaleAnim, {
            toValue: 1.4,
            duration: 150,
            useNativeDriver: true,
          }),
          Animated.timing(scaleAnim, {
            toValue: 1,
            duration: 150,
            useNativeDriver: true,
          }),
        ]).start();
        break;

      case 'scale':
        Animated.spring(scaleAnim, {
          toValue: 0.85,
          friction: 4,
          tension: 300,
          useNativeDriver: true,
        }).start(() => {
          Animated.spring(scaleAnim, {
            toValue: 1,
            friction: 4,
            tension: 300,
            useNativeDriver: true,
          }).start();
        });
        break;

      case 'shake':
        Animated.sequence([
          Animated.timing(rotateAnim, { toValue: 1, duration: 50, useNativeDriver: true }),
          Animated.timing(rotateAnim, { toValue: -1, duration: 100, useNativeDriver: true }),
          Animated.timing(rotateAnim, { toValue: 1, duration: 100, useNativeDriver: true }),
          Animated.timing(rotateAnim, { toValue: 0, duration: 50, useNativeDriver: true }),
        ]).start();
        break;
    }

    onPress();
  };

  const spin = rotateAnim.interpolate({
    inputRange: [-1, 1],
    outputRange: ['-15deg', '15deg'],
  });

  const glowOpacity = glowAnim.interpolate({
    inputRange: [0, 0.5, 1],
    outputRange: [0, 0.4, 0.7],
  });

  const currentIcon = isActive && iconNameActive ? iconNameActive : iconName;
  const currentColor = isActive && activeColor ? activeColor : color;
  const currentBgColor = isActive && activeBackgroundColor ? activeBackgroundColor : backgroundColor;

  return (
    <TouchableOpacity
      onPress={handlePress}
      disabled={disabled || isLoading}
      activeOpacity={0.7}
      style={[
        styles.button,
        {
          backgroundColor: currentBgColor,
          opacity: disabled ? 0.5 : 1,
        },
        style,
      ]}
    >
      {/* Neon Glow Effect for active state */}
      {isActive && (
        <Animated.View
          style={[
            styles.glowRing,
            {
              opacity: glowOpacity,
              borderColor: activeColor || color,
              shadowColor: activeColor || color,
            },
          ]}
        />
      )}
      
      <Animated.View
        style={[
          styles.iconContainer,
          {
            transform: [
              { scale: Animated.multiply(scaleAnim, pulseAnim) },
              { rotate: spin },
            ],
          },
        ]}
      >
        <Ionicons name={currentIcon} size={size} color={currentColor} />
      </Animated.View>
    </TouchableOpacity>
  );
};

// Specialized Heart/Favorite Button - RED when active with futuristic neon glow
export const AnimatedFavoriteButton: React.FC<{
  isFavorite: boolean;
  isLoading?: boolean;
  onPress: () => void;
  size?: number;
  style?: ViewStyle;
}> = ({ isFavorite, isLoading = false, onPress, size = 20, style }) => {
  const scaleAnim = useRef(new Animated.Value(1)).current;
  const glowAnim = useRef(new Animated.Value(0)).current;
  const particleAnims = useRef([
    new Animated.Value(0),
    new Animated.Value(0),
    new Animated.Value(0),
    new Animated.Value(0),
    new Animated.Value(0),
    new Animated.Value(0),
  ]).current;
  const [showParticles, setShowParticles] = useState(false);

  // Continuous glow animation when favorite
  useEffect(() => {
    if (isFavorite) {
      // Neon pulse glow
      Animated.loop(
        Animated.sequence([
          Animated.timing(glowAnim, {
            toValue: 1,
            duration: 800,
            useNativeDriver: true,
          }),
          Animated.timing(glowAnim, {
            toValue: 0.4,
            duration: 800,
            useNativeDriver: true,
          }),
        ])
      ).start();

      // Heart beat animation
      Animated.sequence([
        Animated.spring(scaleAnim, {
          toValue: 1.5,
          friction: 3,
          tension: 200,
          useNativeDriver: true,
        }),
        Animated.spring(scaleAnim, {
          toValue: 1,
          friction: 5,
          tension: 150,
          useNativeDriver: true,
        }),
      ]).start();

      // Particle explosion
      setShowParticles(true);
      particleAnims.forEach((anim, index) => {
        Animated.sequence([
          Animated.timing(anim, {
            toValue: 1,
            duration: 400,
            useNativeDriver: true,
          }),
          Animated.timing(anim, {
            toValue: 0,
            duration: 200,
            useNativeDriver: true,
          }),
        ]).start();
      });
      setTimeout(() => setShowParticles(false), 600);
    } else {
      glowAnim.setValue(0);
    }
  }, [isFavorite]);

  const handlePress = () => {
    // Bounce animation on press
    Animated.sequence([
      Animated.spring(scaleAnim, {
        toValue: 0.6,
        friction: 5,
        tension: 400,
        useNativeDriver: true,
      }),
      Animated.spring(scaleAnim, {
        toValue: 1.3,
        friction: 3,
        tension: 300,
        useNativeDriver: true,
      }),
      Animated.spring(scaleAnim, {
        toValue: 1,
        friction: 4,
        tension: 200,
        useNativeDriver: true,
      }),
    ]).start();

    onPress();
  };

  const glowOpacity = glowAnim.interpolate({
    inputRange: [0, 0.4, 1],
    outputRange: [0, 0.5, 0.9],
  });

  // Particle positions
  const particlePositions = [
    { angle: 0 }, { angle: 60 }, { angle: 120 },
    { angle: 180 }, { angle: 240 }, { angle: 300 },
  ];

  return (
    <TouchableOpacity
      onPress={handlePress}
      disabled={isLoading}
      activeOpacity={0.7}
      style={[
        styles.favoriteButton,
        {
          backgroundColor: isFavorite ? 'rgba(239, 68, 68, 0.15)' : 'rgba(239, 68, 68, 0.08)',
          borderColor: isFavorite ? '#EF4444' : 'rgba(239, 68, 68, 0.3)',
        },
        style,
      ]}
    >
      {/* Outer Neon Glow Ring */}
      {isFavorite && (
        <>
          <Animated.View
            style={[
              styles.neonGlowOuter,
              {
                opacity: glowOpacity,
                borderColor: '#EF4444',
                shadowColor: '#EF4444',
              },
            ]}
          />
          <Animated.View
            style={[
              styles.neonGlowInner,
              {
                opacity: glowAnim,
                backgroundColor: 'rgba(239, 68, 68, 0.3)',
              },
            ]}
          />
        </>
      )}

      {/* Particle Effects */}
      {showParticles && particlePositions.map((pos, index) => {
        const translateX = particleAnims[index].interpolate({
          inputRange: [0, 1],
          outputRange: [0, Math.cos(pos.angle * Math.PI / 180) * 20],
        });
        const translateY = particleAnims[index].interpolate({
          inputRange: [0, 1],
          outputRange: [0, Math.sin(pos.angle * Math.PI / 180) * 20],
        });
        const opacity = particleAnims[index].interpolate({
          inputRange: [0, 0.5, 1],
          outputRange: [1, 0.8, 0],
        });
        const scale = particleAnims[index].interpolate({
          inputRange: [0, 0.5, 1],
          outputRange: [0.5, 1, 0.3],
        });

        return (
          <Animated.View
            key={index}
            style={[
              styles.particle,
              {
                opacity,
                transform: [{ translateX }, { translateY }, { scale }],
                backgroundColor: '#EF4444',
              },
            ]}
          />
        );
      })}

      {/* Heart Icon */}
      <Animated.View
        style={[
          styles.iconContainer,
          {
            transform: [{ scale: scaleAnim }],
          },
        ]}
      >
        <Ionicons
          name={isFavorite ? 'heart' : 'heart-outline'}
          size={size}
          color="#EF4444"  // Always RED
        />
      </Animated.View>
    </TouchableOpacity>
  );
};

// Specialized Cart Button - Futuristic with gradient and glow
// Enhanced with forwardRef to expose triggerShake function for external control
export interface AnimatedCartButtonRef {
  triggerShake: () => void;
}

export const AnimatedCartButton = React.forwardRef<
  AnimatedCartButtonRef,
  {
    isInCart?: boolean;
    isLoading?: boolean;
    onPress: () => void;
    size?: number;
    primaryColor?: string;
    style?: ViewStyle;
    disabled?: boolean;
  }
>(({ isInCart = false, isLoading = false, onPress, size = 20, primaryColor = '#3B82F6', style, disabled = false }, ref) => {
  const scaleAnim = useRef(new Animated.Value(1)).current;
  const rotateAnim = useRef(new Animated.Value(0)).current;
  const glowAnim = useRef(new Animated.Value(0)).current;
  const successPulse = useRef(new Animated.Value(0)).current;
  const shakeAnim = useRef(new Animated.Value(0)).current;

  // Expose triggerShake function via ref for external control (duplicate detection)
  React.useImperativeHandle(ref, () => ({
    triggerShake: () => {
      // Shake animation sequence for duplicate prevention feedback
      Animated.sequence([
        Animated.timing(shakeAnim, { toValue: 1, duration: 50, useNativeDriver: true }),
        Animated.timing(shakeAnim, { toValue: -1, duration: 50, useNativeDriver: true }),
        Animated.timing(shakeAnim, { toValue: 1, duration: 50, useNativeDriver: true }),
        Animated.timing(shakeAnim, { toValue: -1, duration: 50, useNativeDriver: true }),
        Animated.timing(shakeAnim, { toValue: 1, duration: 50, useNativeDriver: true }),
        Animated.timing(shakeAnim, { toValue: -1, duration: 50, useNativeDriver: true }),
        Animated.timing(shakeAnim, { toValue: 0, duration: 50, useNativeDriver: true }),
      ]).start();
    },
  }));

  // Shake rotation interpolation
  const shakeRotation = shakeAnim.interpolate({
    inputRange: [-1, 0, 1],
    outputRange: ['-15deg', '0deg', '15deg'],
  });

  useEffect(() => {
    if (isInCart) {
      // Success glow animation
      Animated.loop(
        Animated.sequence([
          Animated.timing(glowAnim, {
            toValue: 1,
            duration: 600,
            useNativeDriver: true,
          }),
          Animated.timing(glowAnim, {
            toValue: 0.3,
            duration: 600,
            useNativeDriver: true,
          }),
        ])
      ).start();

      // Success pulse
      Animated.sequence([
        Animated.spring(successPulse, {
          toValue: 1.5,
          friction: 3,
          tension: 200,
          useNativeDriver: true,
        }),
        Animated.spring(successPulse, {
          toValue: 1,
          friction: 5,
          tension: 150,
          useNativeDriver: true,
        }),
      ]).start();
    } else {
      glowAnim.setValue(0);
      successPulse.setValue(1);
    }
  }, [isInCart]);

  const handlePress = () => {
    if (isLoading || disabled) return;

    // Futuristic press animation
    Animated.parallel([
      Animated.sequence([
        Animated.spring(scaleAnim, {
          toValue: 0.7,
          friction: 5,
          tension: 400,
          useNativeDriver: true,
        }),
        Animated.spring(scaleAnim, {
          toValue: 1.2,
          friction: 3,
          tension: 300,
          useNativeDriver: true,
        }),
        Animated.spring(scaleAnim, {
          toValue: 1,
          friction: 4,
          tension: 200,
          useNativeDriver: true,
        }),
      ]),
      Animated.sequence([
        Animated.timing(rotateAnim, { toValue: -15, duration: 80, useNativeDriver: true }),
        Animated.timing(rotateAnim, { toValue: 15, duration: 80, useNativeDriver: true }),
        Animated.timing(rotateAnim, { toValue: -10, duration: 60, useNativeDriver: true }),
        Animated.timing(rotateAnim, { toValue: 0, duration: 80, useNativeDriver: true }),
      ]),
    ]).start();

    onPress();
  };

  const bgColor = disabled ? '#9CA3AF' : isInCart ? '#10B981' : primaryColor;
  const glowOpacity = glowAnim.interpolate({
    inputRange: [0, 0.3, 1],
    outputRange: [0, 0.4, 0.8],
  });

  return (
    <TouchableOpacity
      onPress={handlePress}
      disabled={isLoading || disabled}
      activeOpacity={0.8}
      style={[
        styles.cartButton,
        {
          backgroundColor: bgColor,
          shadowColor: bgColor,
          opacity: disabled ? 0.6 : 1,
        },
        style,
      ]}
    >
      {/* Neon glow effect */}
      {isInCart && (
        <Animated.View
          style={[
            styles.cartGlow,
            {
              opacity: glowOpacity,
              borderColor: '#10B981',
              shadowColor: '#10B981',
            },
          ]}
        />
      )}

      <Animated.View
        style={[
          styles.iconContainer,
          {
            transform: [
              { scale: isInCart ? successPulse : scaleAnim },
              { rotate: Animated.add(
                rotateAnim.interpolate({
                  inputRange: [-15, 15],
                  outputRange: [-15, 15],
                }),
                shakeAnim.interpolate({
                  inputRange: [-1, 0, 1],
                  outputRange: [-15, 0, 15],
                })
              ).interpolate({
                inputRange: [-30, 30],
                outputRange: ['-30deg', '30deg'],
              }) },
            ],
          },
        ]}
      >
        <Ionicons
          name={isInCart ? 'checkmark' : 'add'}
          size={size}
          color="#FFFFFF"
        />
      </Animated.View>
    </TouchableOpacity>
  );
});

// Display name for debugging
AnimatedCartButton.displayName = 'AnimatedCartButton';

const styles = StyleSheet.create({
  button: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  iconContainer: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  glowRing: {
    position: 'absolute',
    width: '120%',
    height: '120%',
    borderRadius: 100,
    borderWidth: 2,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 8,
  },
  favoriteButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    shadowColor: '#EF4444',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 3,
    overflow: 'visible',
  },
  neonGlowOuter: {
    position: 'absolute',
    width: '140%',
    height: '140%',
    borderRadius: 100,
    borderWidth: 2,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 1,
    shadowRadius: 12,
    elevation: 8,
  },
  neonGlowInner: {
    position: 'absolute',
    width: '100%',
    height: '100%',
    borderRadius: 100,
  },
  particle: {
    position: 'absolute',
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  cartButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 8,
    elevation: 6,
    overflow: 'visible',
  },
  cartGlow: {
    position: 'absolute',
    width: '130%',
    height: '130%',
    borderRadius: 100,
    borderWidth: 2,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 1,
    shadowRadius: 10,
    elevation: 8,
  },
});

export default AnimatedIconButton;
