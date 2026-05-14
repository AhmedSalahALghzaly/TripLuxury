/**
 * useAppLiveness — exposes whether the app is in the foreground (AppState)
 * and whether the device has a usable network connection (NetInfo).
 *
 * Used to gate background polling and WebSocket reconnect attempts so that
 * we don't burn battery or show stale data while the phone is asleep or
 * offline.
 */
import { useEffect, useState } from 'react';
import { AppState, AppStateStatus } from 'react-native';
import NetInfo, { NetInfoState } from '@react-native-community/netinfo';

export interface AppLiveness {
  isForeground: boolean;
  isOnline: boolean;
  isLive: boolean;
}

let cachedForeground: boolean = AppState.currentState === 'active';
let cachedOnline: boolean = true;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((l) => l());
}

AppState.addEventListener('change', (next: AppStateStatus) => {
  const fg = next === 'active';
  if (fg !== cachedForeground) {
    cachedForeground = fg;
    emit();
  }
});

NetInfo.addEventListener((state: NetInfoState) => {
  // Treat unknown (`null`) as online to avoid false negatives during startup.
  const online =
    state.isConnected !== false &&
    (state.isInternetReachable === null || state.isInternetReachable !== false);
  if (online !== cachedOnline) {
    cachedOnline = online;
    emit();
  }
});

export function getAppLivenessSnapshot(): AppLiveness {
  return {
    isForeground: cachedForeground,
    isOnline: cachedOnline,
    isLive: cachedForeground && cachedOnline,
  };
}

export function subscribeAppLiveness(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useAppLiveness(): AppLiveness {
  const [state, setState] = useState<AppLiveness>(() => getAppLivenessSnapshot());

  useEffect(() => {
    const update = () => setState(getAppLivenessSnapshot());
    update();
    return subscribeAppLiveness(update);
  }, []);

  return state;
}
