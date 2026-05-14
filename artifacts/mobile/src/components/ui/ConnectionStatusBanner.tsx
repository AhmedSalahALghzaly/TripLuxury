/**
 * ConnectionStatusBanner — small pill that surfaces when the app is offline,
 * backgrounded (paused), or the live WebSocket is reconnecting.
 *
 * Reads `useAppLiveness()` for foreground/online status and subscribes to
 * `wsService.onStateChange` for the realtime channel state. Hides itself
 * within ~1s of full liveness returning (i.e. foreground + online + WS
 * connected/disconnected-but-not-reconnecting).
 */
import React, { useEffect, useRef, useState } from 'react';
import { Animated, StyleSheet, View, Text, Platform, Easing } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAppLiveness } from '../../hooks/useAppLiveness';
import { wsService } from '../../services/websocketService';
import { useAppStore } from '../../store/appStore';

type Status = 'live' | 'offline' | 'paused' | 'reconnecting';

interface Props {
  /** Optional top offset (e.g. to clear a custom header). */
  topOffset?: number;
  /** Render absolutely positioned at top (default) or inline. */
  inline?: boolean;
}

export const ConnectionStatusBanner: React.FC<Props> = ({ topOffset = 0, inline = false }) => {
  const { isForeground, isOnline } = useAppLiveness();
  const language = useAppStore((s) => s.language);
  const [wsState, setWsState] = useState<string>(wsService.state);

  useEffect(() => {
    const unsub = wsService.onStateChange((s) => setWsState(s));
    return () => { unsub(); };
  }, []);

  // Determine current status. Treat WS 'disconnected' as live (we may simply
  // not have connected yet on this screen) — only flag explicit reconnect or
  // pause. Offline / background take priority over reconnecting.
  let status: Status = 'live';
  if (!isOnline) status = 'offline';
  else if (!isForeground) status = 'paused';
  else if (wsState === 'paused') status = 'paused';
  else if (wsState === 'reconnecting') status = 'reconnecting';

  const visible = status !== 'live';

  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(-12)).current;

  // Hide ~1s after liveness returns; show immediately when something breaks.
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [renderedStatus, setRenderedStatus] = useState<Status>(status);
  const [mounted, setMounted] = useState<boolean>(visible);

  useEffect(() => {
    if (visible) {
      if (hideTimer.current) { clearTimeout(hideTimer.current); hideTimer.current = null; }
      setRenderedStatus(status);
      setMounted(true);
      Animated.parallel([
        Animated.timing(opacity, { toValue: 1, duration: 220, useNativeDriver: true, easing: Easing.out(Easing.cubic) }),
        Animated.timing(translateY, { toValue: 0, duration: 220, useNativeDriver: true, easing: Easing.out(Easing.cubic) }),
      ]).start();
    } else if (mounted) {
      // Hold the current label for ~900ms while fading, total ~1s before unmount.
      if (hideTimer.current) clearTimeout(hideTimer.current);
      hideTimer.current = setTimeout(() => {
        Animated.parallel([
          Animated.timing(opacity, { toValue: 0, duration: 180, useNativeDriver: true, easing: Easing.in(Easing.cubic) }),
          Animated.timing(translateY, { toValue: -12, duration: 180, useNativeDriver: true, easing: Easing.in(Easing.cubic) }),
        ]).start(({ finished }) => { if (finished) setMounted(false); });
      }, 700);
    }
  }, [visible, status]);

  useEffect(() => () => { if (hideTimer.current) clearTimeout(hideTimer.current); }, []);

  if (!mounted) return null;

  const cfg = getStatusConfig(renderedStatus, language);

  const wrapperStyle = inline
    ? [styles.inlineWrapper]
    : [styles.absoluteWrapper, { top: topOffset }];

  return (
    <Animated.View
      pointerEvents="none"
      style={[wrapperStyle, { opacity, transform: [{ translateY }] }]}
    >
      <View style={[styles.pill, { backgroundColor: cfg.bg, borderColor: cfg.border }]}>
        <Ionicons name={cfg.icon} size={13} color={cfg.fg} />
        <Text style={[styles.label, { color: cfg.fg }]} numberOfLines={1}>
          {cfg.label}
        </Text>
      </View>
    </Animated.View>
  );
};

function getStatusConfig(status: Status, language: string) {
  const ar = language === 'ar';
  switch (status) {
    case 'offline':
      return {
        icon: 'cloud-offline' as const,
        label: ar ? 'غير متصل — في انتظار الإنترنت…' : "You're offline — reconnecting…",
        fg: '#FFFFFF',
        bg: 'rgba(127,29,29,0.92)',
        border: 'rgba(248,113,113,0.55)',
      };
    case 'paused':
      return {
        icon: 'pause-circle' as const,
        label: ar ? 'التحديثات متوقفة مؤقتاً' : 'Live updates paused',
        fg: '#FFFFFF',
        bg: 'rgba(75,85,99,0.92)',
        border: 'rgba(156,163,175,0.55)',
      };
    case 'reconnecting':
    default:
      return {
        icon: 'sync' as const,
        label: ar ? 'إعادة الاتصال…' : 'Reconnecting…',
        fg: '#1F2937',
        bg: 'rgba(254,243,199,0.95)',
        border: 'rgba(217,119,6,0.55)',
      };
  }
}

const styles = StyleSheet.create({
  absoluteWrapper: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 999,
    paddingTop: Platform.OS === 'ios' ? 6 : 4,
  },
  inlineWrapper: {
    alignItems: 'center',
    paddingVertical: 4,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    maxWidth: '92%',
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOpacity: 0.18,
        shadowRadius: 6,
        shadowOffset: { width: 0, height: 2 },
      },
      android: { elevation: 3 },
    }),
  },
  label: {
    fontSize: 11.5,
    fontWeight: '700',
    letterSpacing: -0.1,
  },
});

export default ConnectionStatusBanner;
