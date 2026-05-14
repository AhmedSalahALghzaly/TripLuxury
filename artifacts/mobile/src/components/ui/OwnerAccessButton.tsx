/**
 * Owner Access Button Component
 * A beautiful animated button for accessing the Advanced Owner Interface
 * Only visible to owner email (pc.2025.ai@gmail.com) and partners
 */
import React, { useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Animated,
  Easing,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { useAppStore, useCanAccessOwnerInterface } from '../../store/appStore';

// Owner email that can always access the interface
const OWNER_EMAIL = 'pc.2025.ai@gmail.com';

interface OwnerAccessButtonProps {
  size?: 'small' | 'medium' | 'large';
  showLabel?: boolean;
}

export const OwnerAccessButton: React.FC<OwnerAccessButtonProps> = ({
  size = 'medium',
  showLabel = false,
}) => {
  const router = useRouter();
  const user = useAppStore((state) => state.user);
  const partners = useAppStore((state) => state.partners);
  const canAccess = useCanAccessOwnerInterface();

  // Animation values
  const glowAnim = useRef(new Animated.Value(0)).current;
  const rotateAnim = useRef(new Animated.Value(0)).current;
  const scaleAnim = useRef(new Animated.Value(1)).current;

  // Check if current user can access
  const isOwner = user?.email?.toLowerCase() === OWNER_EMAIL.toLowerCase();
  const isPartner = partners.some(
    (p: any) => p.email?.toLowerCase() === user?.email?.toLowerCase()
  );
  const hasAccess = isOwner || isPartner || canAccess;

  // Glow animation
  useEffect(() => {
    if (hasAccess) {
      const glow = Animated.loop(
        Animated.sequence([
          Animated.timing(glowAnim, {
            toValue: 1,
            duration: 2000,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: false,
          }),
          Animated.timing(glowAnim, {
            toValue: 0,
            duration: 2000,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: false,
          }),
        ])
      );
      glow.start();
      return () => glow.stop();
    }
  }, [hasAccess]);

  // Subtle rotation animation
  useEffect(() => {
    if (hasAccess) {
      const rotate = Animated.loop(
        Animated.timing(rotateAnim, {
          toValue: 1,
          duration: 8000,
          easing: Easing.linear,
          useNativeDriver: true,
        })
      );
      rotate.start();
      return () => rotate.stop();
    }
  }, [hasAccess]);

  // Don't render if user doesn't have access
  if (!hasAccess) {
    return null;
  }

  const handlePress = () => {
    // Bounce animation on press
    Animated.sequence([
      Animated.timing(scaleAnim, {
        toValue: 0.9,
        duration: 100,
        useNativeDriver: true,
      }),
      Animated.timing(scaleAnim, {
        toValue: 1,
        duration: 100,
        useNativeDriver: true,
      }),
    ]).start();

    // Navigate to owner interface
    router.push('/owner');
  };

  const rotation = rotateAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });

  const glowOpacity = glowAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0.3, 0.8],
  });

  const sizeConfig = {
    small: { container: 36, icon: 18, glow: 44 },
    medium: { container: 44, icon: 22, glow: 52 },
    large: { container: 56, icon: 28, glow: 64 },
  };

  const config = sizeConfig[size];

  return (
    <TouchableOpacity
      onPress={handlePress}
      activeOpacity={0.8}
      style={styles.wrapper}
    >
      {/* Glow effect behind the button */}
      <Animated.View
        style={[
          styles.glowContainer,
          {
            width: config.glow,
            height: config.glow,
            borderRadius: config.glow / 2,
            opacity: glowOpacity,
          },
        ]}
      >
        <LinearGradient
          colors={['#8B5CF6', '#EC4899', '#F59E0B']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={StyleSheet.absoluteFill}
        />
      </Animated.View>

      {/* Main button */}
      <Animated.View
        style={[
          styles.container,
          {
            width: config.container,
            height: config.container,
            borderRadius: config.container / 2,
            transform: [{ scale: scaleAnim }],
          },
        ]}
      >
        <LinearGradient
          colors={['#6366F1', '#8B5CF6', '#A855F7']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={[
            styles.gradient,
            { borderRadius: config.container / 2 },
          ]}
        >
          <Animated.View style={{ transform: [{ rotate: rotation }] }}>
            <Ionicons
              name="diamond"
              size={config.icon}
              color="#FFFFFF"
            />
          </Animated.View>
        </LinearGradient>
      </Animated.View>

      {showLabel && (
        <View style={styles.labelContainer}>
          <Text style={styles.label}>Owner</Text>
        </View>
      )}
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  wrapper: {
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  glowContainer: {
    position: 'absolute',
    overflow: 'hidden',
  },
  container: {
    overflow: 'hidden',
    shadowColor: '#8B5CF6',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
  },
  gradient: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  labelContainer: {
    marginTop: 4,
  },
  label: {
    fontSize: 10,
    fontWeight: '600',
    color: '#8B5CF6',
  },
});

export default OwnerAccessButton;
