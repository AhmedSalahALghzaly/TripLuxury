/**
 * FloatingChatIcon
 * Draggable, magnetic-snap-to-edge floating action button.
 * - 56×56 rounded square with blue gradient
 * - Continuous ±8px bob via Reanimated (5s ease-in-out loop)
 * - PanGesture: drag anywhere on screen, snaps to nearest edge on release
 * - Unread badge pulses when unread_count > 0
 * - Navigates to /chat route on tap
 * - Real-time badge update via WebSocket chat_message events
 *
 * Mount inside an absoluteFillObject overlay with pointerEvents="box-none"
 * so it overlays all screen content without blocking underlying touches.
 */
import React, { useCallback, useEffect } from 'react';
import { View, Text, StyleSheet, Dimensions } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withSequence,
  withTiming,
  withSpring,
  Easing,
  runOnJS,
} from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { createShadow } from '../../utils/shadowUtils';
import { chatApi } from '../../services/api';
import { useWebSocketEvent } from '../../services/websocketService';

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');
const BTN_SIZE = 56;
const EDGE_MARGIN = 16;

export default function FloatingChatIcon() {
  const router = useRouter();
  const [unreadCount, setUnreadCount] = React.useState(0);
  const badgePulse = useSharedValue(1);

  const posX = useSharedValue(SCREEN_W - BTN_SIZE - EDGE_MARGIN);
  const posY = useSharedValue(SCREEN_H * 0.65);
  const isDragging = useSharedValue(false);
  const bobOffset = useSharedValue(0);

  useEffect(() => {
    bobOffset.value = withRepeat(
      withSequence(
        withTiming(-8, { duration: 2500, easing: Easing.inOut(Easing.sin) }),
        withTiming(0, { duration: 2500, easing: Easing.inOut(Easing.sin) }),
      ),
      -1,
      false,
    );
  }, []);

  useEffect(() => {
    if (unreadCount > 0) {
      badgePulse.value = withRepeat(
        withSequence(
          withTiming(1.3, { duration: 450 }),
          withTiming(1, { duration: 450 }),
        ),
        -1,
        false,
      );
    } else {
      badgePulse.value = withTiming(1);
    }
  }, [unreadCount]);

  const fetchUnread = useCallback(async () => {
    try {
      const res = await chatApi.getUnreadCount();
      setUnreadCount(res.data?.unread_count ?? 0);
    } catch {}
  }, []);

  useEffect(() => {
    fetchUnread();
    // Poll every 120s as safety net — WebSocket covers real-time updates.
    const interval = setInterval(fetchUnread, 120000);
    return () => clearInterval(interval);
  }, [fetchUnread]);

  // Real-time: bump the unread badge immediately when a new chat message
  // arrives via WebSocket, without waiting for the poll interval.
  useWebSocketEvent(['chat_message'], fetchUnread);

  const snapToEdge = () => {
    'worklet';
    const targetX =
      posX.value + BTN_SIZE / 2 < SCREEN_W / 2
        ? EDGE_MARGIN
        : SCREEN_W - BTN_SIZE - EDGE_MARGIN;
    const clampedY = Math.max(
      EDGE_MARGIN,
      Math.min(posY.value, SCREEN_H - BTN_SIZE - EDGE_MARGIN - 80),
    );
    posX.value = withSpring(targetX, { damping: 18, stiffness: 180 });
    posY.value = withSpring(clampedY, { damping: 18, stiffness: 180 });
  };

  const openChat = () => router.push('/chat');

  const startX = useSharedValue(0);
  const startY = useSharedValue(0);
  const wasDragged = useSharedValue(false);

  const panGesture = Gesture.Pan()
    .onBegin(() => {
      isDragging.value = true;
      startX.value = posX.value;
      startY.value = posY.value;
      wasDragged.value = false;
    })
    .onUpdate((e) => {
      if (Math.abs(e.translationX) > 4 || Math.abs(e.translationY) > 4) {
        wasDragged.value = true;
      }
      posX.value = startX.value + e.translationX;
      posY.value = startY.value + e.translationY;
    })
    .onEnd(() => {
      isDragging.value = false;
      snapToEdge();
      if (!wasDragged.value) runOnJS(openChat)();
    });

  const tapGesture = Gesture.Tap().onEnd(() => runOnJS(openChat)());

  const composed = Gesture.Exclusive(panGesture, tapGesture);

  const containerStyle = useAnimatedStyle(() => ({
    position: 'absolute',
    left: posX.value,
    top: posY.value + (isDragging.value ? 0 : bobOffset.value),
    zIndex: 999,
  }));

  const badgeStyle = useAnimatedStyle(() => ({
    transform: [{ scale: badgePulse.value }],
  }));

  return (
    <GestureDetector gesture={composed}>
      <Animated.View style={[styles.wrapper, containerStyle]}>
        <LinearGradient colors={['#2563EB', '#1D4ED8']} style={styles.button}>
          <Ionicons name="chatbubble-ellipses" size={26} color="#fff" />
          {unreadCount > 0 && (
            <Animated.View style={[styles.badge, badgeStyle]}>
              <Text style={styles.badgeText}>
                {unreadCount > 99 ? '99+' : unreadCount}
              </Text>
            </Animated.View>
          )}
        </LinearGradient>
      </Animated.View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    ...createShadow('#2563EB', 0, 6, 0.35, 14, 8),
    borderRadius: 16,
  },
  button: {
    width: BTN_SIZE,
    height: BTN_SIZE,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.9)',
    overflow: 'hidden',
  },
  badge: {
    position: 'absolute',
    top: -5,
    right: -5,
    minWidth: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: '#EF4444',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 5,
    borderWidth: 2,
    borderColor: '#fff',
  },
  badgeText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: '800',
  },
});
