/**
 * Error Capsule Component
 * Shows error messages for failed optimistic updates
 */
import React, { useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withTiming,
  withSequence,
  runOnJS,
} from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';

interface ErrorCapsuleProps {
  message: string;
  visible?: boolean;
  onDismiss: () => void;
  onRetry?: () => void;
  duration?: number;
  type?: 'error' | 'warning' | 'success';
}

export const ErrorCapsule: React.FC<ErrorCapsuleProps> = ({
  message,
  visible = true,
  onDismiss,
  duration = 4000,
  type = 'error',
}) => {
  const translateY = useSharedValue(-100);
  const scale = useSharedValue(0.8);
  const shake = useSharedValue(0);

  const config = {
    error: { color: '#EF4444', icon: 'alert-circle' as const, bg: '#FEF2F2' },
    warning: { color: '#F59E0B', icon: 'warning' as const, bg: '#FFFBEB' },
    success: { color: '#10B981', icon: 'checkmark-circle' as const, bg: '#ECFDF5' },
  };

  useEffect(() => {
    if (visible) {
      // Shake animation for error
      if (type === 'error') {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      }
      
      translateY.value = withSpring(60, { damping: 15 });
      scale.value = withSpring(1);
      
      // Shake effect for errors
      if (type === 'error') {
        shake.value = withSequence(
          withTiming(10, { duration: 50 }),
          withTiming(-10, { duration: 50 }),
          withTiming(10, { duration: 50 }),
          withTiming(-10, { duration: 50 }),
          withTiming(0, { duration: 50 })
        );
      }

      // Auto dismiss
      const timer = setTimeout(() => {
        dismiss();
      }, duration);

      return () => clearTimeout(timer);
    }
  }, [visible]);

  const dismiss = () => {
    translateY.value = withTiming(-100, { duration: 200 });
    scale.value = withTiming(0.8, { duration: 200 }, () => {
      runOnJS(onDismiss)();
    });
  };

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [
      { translateY: translateY.value },
      { translateX: shake.value },
      { scale: scale.value },
    ],
  }));

  if (!visible) return null;

  const { color, icon, bg } = config[type];

  return (
    <Animated.View style={[styles.container, animatedStyle]}>
      <TouchableOpacity
        style={[styles.capsule, { backgroundColor: bg, borderColor: color }]}
        onPress={dismiss}
        activeOpacity={0.9}
      >
        <Ionicons name={icon} size={20} color={color} />
        <Text style={[styles.message, { color }]} numberOfLines={2}>
          {message}
        </Text>
        <TouchableOpacity onPress={dismiss} style={styles.closeBtn}>
          <Ionicons name="close" size={18} color={color} />
        </TouchableOpacity>
      </TouchableOpacity>
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 9999,
    alignItems: 'center',
    paddingHorizontal: 16,
  },
  capsule: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 50,
    borderWidth: 1,
    gap: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 8,
    maxWidth: 350,
  },
  message: {
    flex: 1,
    fontSize: 14,
    fontWeight: '500',
  },
  closeBtn: {
    padding: 4,
  },
});

export default ErrorCapsule;
