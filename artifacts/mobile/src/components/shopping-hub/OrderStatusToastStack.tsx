/**
 * OrderStatusToastStack
 * Renders a vertically-stacked queue of success/error/neutral toasts emitted by
 * `useOrderOperations.updateOrderStatus` (and the appointment status PATCHes
 * on the analytics screen). Each toast auto-dismisses after a few seconds; up
 * to 3 are visible at once. Success toasts may carry an optional `undo`
 * action that reverts the underlying PATCH while the toast is still on screen.
 */
import React, { useEffect, useRef, useState } from 'react';
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

export interface OrderStatusToastUndo {
  label: string;
  onPress: () => void | Promise<void>;
}

export interface OrderStatusToast {
  id: string;
  type: 'success' | 'error' | 'neutral';
  message: string;
  undo?: OrderStatusToastUndo;
  onPress?: () => void;
}

interface ToastCardProps {
  toast: OrderStatusToast;
  index: number;
  onDismiss: (id: string) => void;
}

const TOAST_HEIGHT = 56;
const TOAST_GAP = 8;
const AUTO_DISMISS_MS = 3500;
// Toasts that carry an Undo action stay visible a touch longer so admins
// have a comfortable ~5s window to react after an accidental status change.
const AUTO_DISMISS_WITH_UNDO_MS = 5000;

const ToastCard: React.FC<ToastCardProps> = ({ toast, index, onDismiss }) => {
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(-20)).current;
  const [undoUsed, setUndoUsed] = useState(false);

  useEffect(() => {
    const haptic =
      toast.type === 'success'
        ? Haptics.NotificationFeedbackType.Success
        : toast.type === 'error'
          ? Haptics.NotificationFeedbackType.Error
          : Haptics.NotificationFeedbackType.Warning;
    Haptics.notificationAsync(haptic).catch(() => {});
    Animated.parallel([
      Animated.timing(opacity, { toValue: 1, duration: 180, useNativeDriver: true }),
      Animated.spring(translateY, { toValue: 0, useNativeDriver: true, tension: 80, friction: 10 }),
    ]).start();
    const dismissAfter = toast.undo ? AUTO_DISMISS_WITH_UNDO_MS : AUTO_DISMISS_MS;
    const timer = setTimeout(() => dismiss(), dismissAfter);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const dismiss = () => {
    Animated.parallel([
      Animated.timing(opacity, { toValue: 0, duration: 180, useNativeDriver: true }),
      Animated.timing(translateY, { toValue: -20, duration: 180, useNativeDriver: true }),
    ]).start(() => onDismiss(toast.id));
  };

  const handleUndoPress = () => {
    if (undoUsed || !toast.undo) return;
    setUndoUsed(true);
    // The undo handler is responsible for surfacing its own errors via toasts;
    // swallow rejections here so a failure can't crash the toast UI.
    Promise.resolve()
      .then(() => toast.undo!.onPress())
      .catch(() => {});
    dismiss();
  };

  const palette =
    toast.type === 'success'
      ? { fg: '#10B981', bg: '#D1FAE5', icon: 'checkmark-circle' as const }
      : toast.type === 'error'
        ? { fg: '#EF4444', bg: '#FEE2E2', icon: 'alert-circle' as const }
        : { fg: '#475569', bg: '#E2E8F0', icon: 'arrow-undo' as const };

  const showUndo = toast.type === 'success' && !!toast.undo && !undoUsed;

  const handleBodyPress = () => {
    if (toast.onPress) {
      toast.onPress();
      dismiss();
    }
  };

  return (
    <Animated.View
      style={[
        styles.card,
        {
          top: index * (TOAST_HEIGHT + TOAST_GAP),
          backgroundColor: palette.bg,
          borderLeftColor: palette.fg,
          opacity,
          transform: [{ translateY }],
        },
      ]}
    >
      <TouchableOpacity
        onPress={toast.onPress ? handleBodyPress : undefined}
        activeOpacity={toast.onPress ? 0.7 : 1}
        style={styles.bodyRow}
        disabled={!toast.onPress}
      >
        <Ionicons name={palette.icon} size={20} color={palette.fg} />
        <Text numberOfLines={2} style={[styles.message, { color: palette.fg }]}>
          {toast.message}
        </Text>
      </TouchableOpacity>
      {showUndo && (
        <TouchableOpacity
          onPress={handleUndoPress}
          hitSlop={8}
          style={[styles.undoButton, { borderColor: palette.fg }]}
          accessibilityRole="button"
          accessibilityLabel={toast.undo!.label}
        >
          <Text style={[styles.undoLabel, { color: palette.fg }]}>
            {toast.undo!.label}
          </Text>
        </TouchableOpacity>
      )}
      <TouchableOpacity onPress={dismiss} hitSlop={8}>
        <Ionicons name="close" size={18} color={palette.fg} />
      </TouchableOpacity>
    </Animated.View>
  );
};

interface OrderStatusToastStackProps {
  toasts: OrderStatusToast[];
  onDismiss: (id: string) => void;
}

export const OrderStatusToastStack: React.FC<OrderStatusToastStackProps> = ({
  toasts,
  onDismiss,
}) => {
  if (toasts.length === 0) return null;
  return (
    <View pointerEvents="box-none" style={styles.container}>
      {toasts.map((t, i) => (
        <ToastCard key={t.id} toast={t} index={i} onDismiss={onDismiss} />
      ))}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: Platform.OS === 'ios' ? 50 : 20,
    left: 16,
    right: 16,
    zIndex: 9999,
  },
  card: {
    position: 'absolute',
    left: 0,
    right: 0,
    minHeight: TOAST_HEIGHT,
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
  },
  bodyRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  message: {
    flex: 1,
    fontSize: 14,
    fontWeight: '500',
  },
  undoButton: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
  },
  undoLabel: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
});

export default OrderStatusToastStack;
