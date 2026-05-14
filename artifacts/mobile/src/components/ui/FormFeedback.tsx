/**
 * Form Feedback Components
 * Animated form validation feedback with modern 2025 UX
 */
import React, { useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Animated,
  TouchableOpacity,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useTheme } from '../../hooks/useTheme';

// Toast Notification Component
interface ToastProps {
  visible: boolean;
  message: string;
  type: 'success' | 'error' | 'warning' | 'info';
  onDismiss: () => void;
  duration?: number;
}

export const Toast: React.FC<ToastProps> = ({
  visible,
  message,
  type,
  onDismiss,
  duration = 3000,
}) => {
  const { colors } = useTheme();
  const translateY = useRef(new Animated.Value(-100)).current;
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      Haptics.notificationAsync(
        type === 'success' 
          ? Haptics.NotificationFeedbackType.Success 
          : type === 'error' 
          ? Haptics.NotificationFeedbackType.Error 
          : Haptics.NotificationFeedbackType.Warning
      );
      
      Animated.parallel([
        Animated.spring(translateY, {
          toValue: 0,
          useNativeDriver: true,
          tension: 80,
          friction: 10,
        }),
        Animated.timing(opacity, {
          toValue: 1,
          duration: 200,
          useNativeDriver: true,
        }),
      ]).start();

      const timer = setTimeout(() => {
        dismiss();
      }, duration);

      return () => clearTimeout(timer);
    }
  }, [visible]);

  const dismiss = () => {
    Animated.parallel([
      Animated.timing(translateY, {
        toValue: -100,
        duration: 200,
        useNativeDriver: true,
      }),
      Animated.timing(opacity, {
        toValue: 0,
        duration: 200,
        useNativeDriver: true,
      }),
    ]).start(() => onDismiss());
  };

  const getTypeConfig = () => {
    switch (type) {
      case 'success':
        return { icon: 'checkmark-circle', color: '#10B981', bgColor: '#D1FAE5' };
      case 'error':
        return { icon: 'alert-circle', color: '#EF4444', bgColor: '#FEE2E2' };
      case 'warning':
        return { icon: 'warning', color: '#F59E0B', bgColor: '#FEF3C7' };
      case 'info':
      default:
        return { icon: 'information-circle', color: '#3B82F6', bgColor: '#DBEAFE' };
    }
  };

  const config = getTypeConfig();

  if (!visible) return null;

  return (
    <Animated.View
      style={[
        styles.toastContainer,
        {
          transform: [{ translateY }],
          opacity,
          backgroundColor: config.bgColor,
          borderLeftColor: config.color,
        },
      ]}
    >
      <Ionicons name={config.icon as any} size={22} color={config.color} />
      <Text style={[styles.toastMessage, { color: config.color }]}>{message}</Text>
      <TouchableOpacity onPress={dismiss}>
        <Ionicons name="close" size={20} color={config.color} />
      </TouchableOpacity>
    </Animated.View>
  );
};

// Animated Input Border Component
interface AnimatedInputBorderProps {
  isValid: boolean | null;  // null = neutral, true = valid, false = invalid
  isFocused: boolean;
  children: React.ReactNode;
}

export const AnimatedInputBorder: React.FC<AnimatedInputBorderProps> = ({
  isValid,
  isFocused,
  children,
}) => {
  const { colors } = useTheme();
  const borderAnim = useRef(new Animated.Value(0)).current;
  const shakeAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (isValid === false) {
      // Shake animation for invalid
      Animated.sequence([
        Animated.timing(shakeAnim, { toValue: 10, duration: 50, useNativeDriver: true }),
        Animated.timing(shakeAnim, { toValue: -10, duration: 50, useNativeDriver: true }),
        Animated.timing(shakeAnim, { toValue: 10, duration: 50, useNativeDriver: true }),
        Animated.timing(shakeAnim, { toValue: 0, duration: 50, useNativeDriver: true }),
      ]).start();
    }
  }, [isValid]);

  useEffect(() => {
    Animated.timing(borderAnim, {
      toValue: isFocused ? 1 : 0,
      duration: 200,
      useNativeDriver: false,
    }).start();
  }, [isFocused]);

  const borderColor = borderAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [
      isValid === false ? colors.error : colors.border,
      isValid === false ? colors.error : isValid === true ? '#10B981' : colors.primary,
    ],
  });

  const borderWidth = borderAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 2],
  });

  return (
    <Animated.View
      style={[
        styles.inputBorderContainer,
        {
          borderColor,
          borderWidth,
          transform: [{ translateX: shakeAnim }],
        },
      ]}
    >
      {children}
    </Animated.View>
  );
};

// Validation Status Icon
interface ValidationIconProps {
  isValid: boolean | null;
  size?: number;
}

export const ValidationIcon: React.FC<ValidationIconProps> = ({
  isValid,
  size = 20,
}) => {
  const scaleAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (isValid !== null) {
      scaleAnim.setValue(0);
      Animated.spring(scaleAnim, {
        toValue: 1,
        useNativeDriver: true,
        tension: 100,
        friction: 8,
      }).start();
    }
  }, [isValid]);

  if (isValid === null) return null;

  return (
    <Animated.View style={{ transform: [{ scale: scaleAnim }] }}>
      <Ionicons
        name={isValid ? 'checkmark-circle' : 'alert-circle'}
        size={size}
        color={isValid ? '#10B981' : '#EF4444'}
      />
    </Animated.View>
  );
};

// Helper Text with animation
interface HelperTextProps {
  message: string;
  type: 'error' | 'hint';
  visible: boolean;
}

export const HelperText: React.FC<HelperTextProps> = ({
  message,
  type,
  visible,
}) => {
  const { colors } = useTheme();
  const height = useRef(new Animated.Value(0)).current;
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(height, {
        toValue: visible ? 20 : 0,
        duration: 150,
        useNativeDriver: false,
      }),
      Animated.timing(opacity, {
        toValue: visible ? 1 : 0,
        duration: 150,
        useNativeDriver: true,
      }),
    ]).start();
  }, [visible]);

  return (
    <Animated.View style={{ height, opacity }}>
      <Text
        style={[
          styles.helperText,
          { color: type === 'error' ? colors.error : colors.textSecondary },
        ]}
      >
        {message}
      </Text>
    </Animated.View>
  );
};

// Save Button with loading state
interface SaveButtonProps {
  onPress: () => void;
  loading?: boolean;
  success?: boolean;
  disabled?: boolean;
  label: string;
  successLabel?: string;
}

export const SaveButton: React.FC<SaveButtonProps> = ({
  onPress,
  loading = false,
  success = false,
  disabled = false,
  label,
  successLabel,
}) => {
  const { colors } = useTheme();
  const scaleAnim = useRef(new Animated.Value(1)).current;
  const widthAnim = useRef(new Animated.Value(1)).current;

  const handlePress = () => {
    if (disabled || loading) return;
    
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    
    Animated.sequence([
      Animated.timing(scaleAnim, {
        toValue: 0.95,
        duration: 100,
        useNativeDriver: true,
      }),
      Animated.timing(scaleAnim, {
        toValue: 1,
        duration: 100,
        useNativeDriver: true,
      }),
    ]).start();
    
    onPress();
  };

  useEffect(() => {
    if (success) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }
  }, [success]);

  return (
    <Animated.View style={{ transform: [{ scale: scaleAnim }] }}>
      <TouchableOpacity
        style={[
          styles.saveButton,
          {
            backgroundColor: success ? '#10B981' : colors.primary,
            opacity: disabled ? 0.5 : 1,
          },
        ]}
        onPress={handlePress}
        disabled={disabled || loading}
        activeOpacity={0.8}
      >
        {loading ? (
          <View style={styles.loadingDots}>
            <Animated.View style={[styles.dot, { backgroundColor: '#FFF' }]} />
            <Animated.View style={[styles.dot, { backgroundColor: '#FFF', opacity: 0.7 }]} />
            <Animated.View style={[styles.dot, { backgroundColor: '#FFF', opacity: 0.4 }]} />
          </View>
        ) : success ? (
          <>
            <Ionicons name="checkmark-circle" size={20} color="#FFF" />
            <Text style={styles.saveButtonText}>{successLabel || label}</Text>
          </>
        ) : (
          <>
            <Ionicons name="save" size={20} color="#FFF" />
            <Text style={styles.saveButtonText}>{label}</Text>
          </>
        )}
      </TouchableOpacity>
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  toastContainer: {
    position: 'absolute',
    top: Platform.OS === 'ios' ? 50 : 20,
    left: 16,
    right: 16,
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 12,
    borderLeftWidth: 4,
    gap: 10,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.15,
        shadowRadius: 8,
      },
      android: {
        elevation: 6,
      },
    }),
    zIndex: 9999,
  },
  toastMessage: {
    flex: 1,
    fontSize: 14,
    fontWeight: '500',
  },
  inputBorderContainer: {
    borderRadius: 10,
    backgroundColor: 'transparent',
  },
  helperText: {
    fontSize: 12,
    marginTop: 4,
  },
  saveButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    paddingHorizontal: 24,
    borderRadius: 12,
    gap: 8,
  },
  saveButtonText: {
    color: '#FFF',
    fontSize: 16,
    fontWeight: '600',
  },
  loadingDots: {
    flexDirection: 'row',
    gap: 4,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
});

export default {
  Toast,
  AnimatedInputBorder,
  ValidationIcon,
  HelperText,
  SaveButton,
};
