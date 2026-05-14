/**
 * Void Delete Gesture Component
 * A specialized drag-to-delete gesture that creates an "implode" effect
 * With fallback touch-based delete for better compatibility
 */
import React, { useState } from 'react';
import {
  View,
  StyleSheet,
  Dimensions,
  Text,
  TouchableOpacity,
  TouchableWithoutFeedback,
  Alert,
} from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withTiming,
  runOnJS,
  interpolate,
  Extrapolate,
} from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const DELETE_THRESHOLD = -SCREEN_WIDTH * 0.35;

interface VoidDeleteGestureProps {
  children: React.ReactNode;
  onDelete: () => void;
  enabled?: boolean;
  disabled?: boolean;
}

export const VoidDeleteGesture: React.FC<VoidDeleteGestureProps> = ({
  children,
  onDelete,
  enabled = true,
  disabled = false,
}) => {
  const isDisabled = disabled || !enabled;
  const translateX = useSharedValue(0);
  const scale = useSharedValue(1);
  const opacity = useSharedValue(1);
  const [showDeleteButton, setShowDeleteButton] = useState(false);

  const triggerHaptic = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
  };

  const triggerDelete = () => {
    triggerHaptic();
    onDelete();
  };

  const handleLongPress = () => {
    if (isDisabled) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setShowDeleteButton(true);
  };

  const showSwipeConfirm = () => {
    translateX.value = withSpring(0);
    scale.value = withSpring(1);
    Alert.alert(
      'تأكيد الحذف',
      'هل أنت متأكد من حذف هذا العنصر؟',
      [
        { text: 'إلغاء', style: 'cancel' },
        {
          text: 'حذف',
          style: 'destructive',
          onPress: () => {
            scale.value = withTiming(0, { duration: 200 });
            opacity.value = withTiming(0, { duration: 200 }, () => {
              runOnJS(triggerDelete)();
            });
          },
        },
      ],
      { cancelable: true }
    );
  };

  const handleDeletePress = () => {
    setShowDeleteButton(false);
    // Animate out
    scale.value = withTiming(0, { duration: 200 });
    opacity.value = withTiming(0, { duration: 200 }, () => {
      runOnJS(triggerDelete)();
    });
  };

  const handleCancelDelete = () => {
    setShowDeleteButton(false);
  };

  const panGesture = Gesture.Pan()
    .enabled(!isDisabled)
    .onUpdate((event) => {
      // Only allow left swipe
      const newX = event.translationX;
      translateX.value = Math.min(0, newX);
      
      // Calculate progress towards deletion
      const progress = Math.abs(translateX.value) / Math.abs(DELETE_THRESHOLD);
      scale.value = interpolate(progress, [0, 1], [1, 0.85], Extrapolate.CLAMP);
    })
    .onEnd(() => {
      if (translateX.value < DELETE_THRESHOLD) {
        // Spring back and show confirmation instead of directly deleting
        runOnJS(showSwipeConfirm)();
      } else {
        // Spring back
        translateX.value = withSpring(0);
        scale.value = withSpring(1);
      }
    });

  const longPressGesture = Gesture.LongPress()
    .enabled(!isDisabled)
    .minDuration(500)
    .onEnd((event, success) => {
      if (success) {
        runOnJS(handleLongPress)();
      }
    });

  const composedGestures = Gesture.Race(panGesture, longPressGesture);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.value },
      { scale: scale.value },
    ],
    opacity: opacity.value,
  }));

  const voidStyle = useAnimatedStyle(() => {
    const progress = Math.abs(translateX.value) / Math.abs(DELETE_THRESHOLD);
    return {
      opacity: interpolate(progress, [0, 0.5, 1], [0, 0.5, 1], Extrapolate.CLAMP),
      transform: [{ scale: interpolate(progress, [0, 1], [0.5, 1.2], Extrapolate.CLAMP) }],
    };
  });

  return (
    <View style={styles.container}>
      {/* Void indicator behind */}
      <Animated.View style={[styles.voidContainer, voidStyle]}>
        <View style={styles.voidCircle}>
          <Ionicons name="trash" size={24} color="#FFF" />
        </View>
        <Text style={styles.voidText}>Release to delete</Text>
      </Animated.View>

      {/* Main content with gesture */}
      <GestureDetector gesture={composedGestures}>
        <Animated.View style={[styles.content, animatedStyle]}>
          {children}
        </Animated.View>
      </GestureDetector>

      {/* Delete confirmation overlay */}
      {showDeleteButton && (
        <TouchableWithoutFeedback onPress={handleCancelDelete}>
          <View style={styles.deleteOverlay}>
            <View style={styles.deleteConfirm}>
              <TouchableOpacity
                style={styles.deleteButton}
                onPress={handleDeletePress}
                activeOpacity={0.8}
              >
                <Ionicons name="trash" size={20} color="#FFF" />
                <Text style={styles.deleteButtonText}>Delete</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.cancelButton}
                onPress={handleCancelDelete}
                activeOpacity={0.8}
              >
                <Text style={styles.cancelButtonText}>Cancel</Text>
              </TouchableOpacity>
            </View>
          </View>
        </TouchableWithoutFeedback>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    position: 'relative',
    overflow: 'hidden',
  },
  content: {
    backgroundColor: 'transparent',
  },
  voidContainer: {
    position: 'absolute',
    right: 16,
    top: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
    width: 80,
  },
  voidCircle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#EF4444',
    alignItems: 'center',
    justifyContent: 'center',
  },
  voidText: {
    color: '#EF4444',
    fontSize: 10,
    fontWeight: '600',
    marginTop: 4,
    textAlign: 'center',
  },
  deleteOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 100,
  },
  deleteConfirm: {
    backgroundColor: '#1E1E3F',
    borderRadius: 16,
    padding: 20,
    alignItems: 'center',
    gap: 12,
    minWidth: 200,
  },
  deleteButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#EF4444',
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 12,
    gap: 8,
  },
  deleteButtonText: {
    color: '#FFF',
    fontSize: 16,
    fontWeight: '700',
  },
  cancelButton: {
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  cancelButtonText: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 14,
    fontWeight: '600',
  },
});

export default VoidDeleteGesture;
