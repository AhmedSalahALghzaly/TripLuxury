/**
 * Root Layout - High-Performance Startup Architecture
 * 
 * Optimizations:
 * - Integrated asset loading with graceful degradation
 * - Reduced hydration timeout (16s max)
 * - Pre-fetching during native splash phase
 * - Mobile loop prevention maintained via refs
 */
import React, { useEffect, useState, useRef, useCallback } from 'react';
import { View, StyleSheet, Platform } from 'react-native';
import { Stack, useRouter, useSegments } from 'expo-router';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { QueryProvider } from '../src/providers/QueryProvider';
import { useAppStore, useHasHydrated } from '../src/store/appStore';
import { adminApi, notificationApi, setApiAuthToken } from '../src/services/api';
import { syncService } from '../src/services/syncService';
import { networkService } from '../src/services/networkService';
import { screenshotProtectionService } from '../src/services/screenshotProtectionService';
import { autoLogoutService } from '../src/services/autoLogoutService';
import { offlineDatabaseService } from '../src/services/offlineDatabaseService';
import assetLoader from '../src/services/fontLoader';
import { DriftLoader } from '../src/components/ui/DriftLoader';
import { useWebSocket } from '../src/services/websocketService';
import { useResumeRefresh } from '../src/hooks/useResumeRefresh';
import { useHoursBackgroundRefresh } from '../src/hooks/useHoursBackgroundRefresh';
import { useMissedOrderNotifications } from '../src/hooks/useMissedOrderNotifications';
import { useMissedPushLogNotifications } from '../src/hooks/useMissedPushLogNotifications';
import { pushNotificationService } from '../src/services/pushNotificationService';
import { apiRequest, getApiUrl } from '@/lib/query-client';
import { analytics, AnalyticsProvider } from '../src/services/analytics';
import { initSentry } from '../src/services/monitoring';

// M4: initialise Sentry as early as the JS bundle loads (before React mounts)
// so the very first frame is also instrumented.  No-op without a DSN.
initSentry();

// Configuration Constants
const MIN_SPLASH_DISPLAY_MS = Platform.OS === 'web' ? 0 : 2000;
const HYDRATION_TIMEOUT_MS = Platform.OS === 'web' ? 800 : 5000;

/**
 * Auth Guard Component - Optimized Startup Lifecycle
 * 
 * Architecture:
 * 1. Asset prefetch during native splash
 * 2. Hydration with 10s timeout
 * 3. Minimum 2s DriftLoader display
 * 4. Graceful degradation for fonts
 */
function AuthGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const segments = useSegments();
  
  // Zustand state - minimal selectors for performance
  const isAuthenticated = useAppStore((state) => state.isAuthenticated);
  const hasHydrated = useHasHydrated();
  const user = useAppStore((state) => state.user);
  const currentMood = useAppStore((state) => state.currentMood);
  const setNotifications = useAppStore((state) => state.setNotifications);

  // Real-time WebSocket connection for ALL authenticated users
  useWebSocket();

  // Refresh stale React Query caches when the app comes back from
  // background/offline so screens don't show minutes-old data.
  useResumeRefresh();

  // Silently re-fetch restaurant opening hours on foreground if the cache is
  // older than 30 minutes — keeps open/closed badges accurate even when the
  // user never visits a screen that calls useRestaurantHoursMap.
  useHoursBackgroundRefresh();

  // Replay any order status changes that occurred while the app was
  // backgrounded or closed, firing bilingual local notifications for each.
  useMissedOrderNotifications();

  // Secondary replay path: fetches unacknowledged order_updated entries from
  // the server-side push_notification_log so local notifications are fired
  // even when the app was fully closed (not just backgrounded).
  useMissedPushLogNotifications();

  // Refs for preventing duplicate operations & mobile loop prevention
  const servicesInitialized = useRef(false);
  const adminsLoaded = useRef(false);
  const lastActivityRecorded = useRef(0);
  const assetsPreloaded = useRef(false);
  const notificationsLoaded = useRef(false);
  const sessionValidated = useRef(false);
  
  // App ready state — on web: skip splash entirely so the home screen renders immediately
  const isWeb = Platform.OS === 'web';
  const [appReady, setAppReady] = useState(false);
  const [minSplashElapsed, setMinSplashElapsed] = useState(isWeb);
  const [hydrationComplete, setHydrationComplete] = useState(
    isWeb ? useAppStore.getState()._hasHydrated : false
  );

  /**
   * Phase 1: Asset Prefetch - runs once on mount
   * Prefetches fonts/assets during native splash
   */
  useEffect(() => {
    if (assetsPreloaded.current) return;
    assetsPreloaded.current = true;

    const prefetchAssets = async () => {
      try {
        await assetLoader.prefetchCriticalAssets();
        // Load vector-icon fonts (Ionicons + MaterialCommunityIcons) with
        // graceful degradation (13.5s timeout). Without this the icons
        // render as empty rectangles app-wide.
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { Ionicons, MaterialCommunityIcons } = require('@expo/vector-icons');
        await assetLoader.loadFontsWithGracefulDegradation({
          ...(Ionicons.font || {}),
          ...(MaterialCommunityIcons.font || {}),
        });
      } catch (error) {
        // Non-blocking - app proceeds with system fonts
      }
    };

    prefetchAssets();
  }, []);

  /**
   * Minimum splash display timer
   * Ensures DriftLoader animation is visible
   */
  useEffect(() => {
    const timer = setTimeout(() => {
      setMinSplashElapsed(true);
    }, MIN_SPLASH_DISPLAY_MS);
    
    return () => clearTimeout(timer);
  }, []);

  /**
   * Hydration handler - optimized timeout (16s)
   * NO pathname dependency - prevents mobile infinite loop
   */
  useEffect(() => {
    if (hasHydrated) {
      setHydrationComplete(true);
      return;
    }
    
    // Fallback timeout - 16 seconds max
    const timeout = setTimeout(() => {
      const { setHasHydrated } = useAppStore.getState();
      setHasHydrated(true);
      setHydrationComplete(true);
    }, HYDRATION_TIMEOUT_MS);
    
    return () => clearTimeout(timeout);
  }, [hasHydrated]);

  /**
   * App ready determination
   * Ready when both: hydration complete AND minimum splash elapsed
   */
  useEffect(() => {
    if (hydrationComplete && minSplashElapsed && !appReady) {
      // Hide native splash and show app
      assetLoader.hideSplashScreen();
      setAppReady(true);
    }
  }, [hydrationComplete, minSplashElapsed, appReady]);

  /**
   * Initialize core services - runs ONCE when app is ready
   */
  useEffect(() => {
    if (!appReady || servicesInitialized.current) return;
    servicesInitialized.current = true;

    const initializeServices = async () => {
      try {
        await offlineDatabaseService.initialize();
        await networkService.initialize();
        await screenshotProtectionService.initialize();
        
        const { logout } = useAppStore.getState();
        await autoLogoutService.initialize(() => {
          logout();
          router.replace('/login');
        });

        syncService.start();
      } catch (error) {
        // Services will retry on next app open
      }
    };

    initializeServices();

    return () => {
      networkService.cleanup();
      screenshotProtectionService.cleanup();
      autoLogoutService.cleanup();
      syncService.stop();
      offlineDatabaseService.close();
    };
  }, [appReady]);

  /**
   * User activity tracking - debounced interval-based
   * NO pathname dependency
   */
  useEffect(() => {
    if (!appReady || !isAuthenticated || !user) return;

    const recordActivity = () => {
      const now = Date.now();
      if (now - lastActivityRecorded.current > 5000) {
        lastActivityRecorded.current = now;
        autoLogoutService.recordUserActivity();
        offlineDatabaseService.updateLastActivity(user.id);
      }
    };

    recordActivity();
    const interval = setInterval(recordActivity, 60000);

    return () => clearInterval(interval);
  }, [appReady, isAuthenticated, user?.id]);

  /**
   * Fetch notifications from server when user logs in
   * Also requests browser push permission on web
   */
  useEffect(() => {
    if (!appReady || !isAuthenticated || !user?.id || notificationsLoaded.current) return;
    notificationsLoaded.current = true;

    const loadNotifications = async () => {
      try {
        const response = await notificationApi.getAll();
        if (response.data) {
          setNotifications(response.data);
        }
      } catch {}

      // Register Expo push token with backend (native) or request web permission
      try {
        await pushNotificationService.registerTokenWithBackend(user!.id);
      } catch {}
    };

    loadNotifications();
  }, [appReady, isAuthenticated, user?.id]);

  /**
   * Push notification tap → deep-link handler
   * When a restaurant staff member taps a new-order push notification, navigate
   * to the owner analytics screen pre-selected on the Orders tab.
   */
  useEffect(() => {
    if (Platform.OS === 'web') return;

    const handleNotificationResponse = (response: any) => {
      const data = response?.notification?.request?.content?.data ?? {};

      // Order status push notifications (customer-facing) → go to orders tab in cart
      if (data.type === 'order_status') {
        setTimeout(() => {
          router.push({ pathname: '/(tabs)/cart', params: { tab: 'orders' } });
        }, 300);
        return;
      }

      // New-order push notifications (staff/owner-facing) carry order_id + restaurant_id
      if (data.order_id) {
        // Small delay to let the app finish any in-progress navigation
        setTimeout(() => {
          const params: Record<string, string> = { tab: 'orders' };
          // Pass restaurant_id so multi-restaurant users land on the right restaurant
          if (data.restaurant_id) params.restaurantId = String(data.restaurant_id);
          router.push({ pathname: '/owner/restaurant-analytics', params });
        }, 300);
      }
    };

    pushNotificationService.addListeners(undefined, handleNotificationResponse);
    return () => {
      pushNotificationService.removeListeners();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Reset notifications loaded ref on logout
   */
  useEffect(() => {
    if (!isAuthenticated) {
      notificationsLoaded.current = false;
    }
  }, [isAuthenticated]);

  /**
   * Fetch admins list - runs ONCE when authenticated
   */
  useEffect(() => {
    if (!appReady || !isAuthenticated || adminsLoaded.current) return;

    const fetchAdmins = async () => {
      try {
        const response = await adminApi.checkAccess();
        if (response.data) {
          const { setAdmins } = useAppStore.getState();
          setAdmins(response.data);
          adminsLoaded.current = true;
        }
      } catch (error) {
        // Non-blocking
      }
    };

    fetchAdmins();
  }, [appReady, isAuthenticated]);

  /**
   * Replit Auth auto-detection (web only)
   * Called on app startup to detect active Replit session.
   * After auth_with_repl_site redirect, user may land anywhere in the app —
   * this ensures they're logged in regardless of which page they land on.
   */
  const replitChecked = useRef(false);
  useEffect(() => {
    if (!appReady || Platform.OS !== 'web') return;
    // Mark as checked FIRST to prevent re-running after logout in the same session
    if (replitChecked.current) return;
    replitChecked.current = true;

    // Only auto-login if not already authenticated
    if (isAuthenticated) return;

    const checkReplitAuth = async () => {
      try {
        const url = new URL('/api/auth/replit-status', getApiUrl());
        const res = await apiRequest('GET', url.toString());
        const data = await res.json() as any;
        if (data.authenticated && data.user && data.session_token) {
          if (data.session_token) setApiAuthToken(data.session_token);
          const { setUser, setUserRole } = useAppStore.getState();
          setUser(data.user, data.session_token);
          setUserRole(data.user.role || 'user');
          console.log(`[ReplitAuth] Auto-login via headers: ${data.user.email}`);
        }
      } catch {
        // Non-blocking — Replit headers not present
      }
    };

    checkReplitAuth();
  }, [appReady, isAuthenticated]);

  /**
   * Session Validation - runs ONCE when app is ready for ALL authenticated users
   * Ensures the persisted session token is still valid with the server.
   * If the server rejects the token (401), the user is logged out gracefully.
   * Network errors are ignored — user stays logged in with cached state.
   */
  useEffect(() => {
    if (!appReady || !isAuthenticated || sessionValidated.current) return;
    sessionValidated.current = true;

    const validate = async () => {
      try {
        // Ensure the auth token is applied to the axios instance before validating.
        // This guards against any race condition where the token was persisted to
        // AsyncStorage but not yet forwarded to the HTTP client.
        const { sessionToken, validateSession } = useAppStore.getState();
        if (sessionToken) {
          setApiAuthToken(sessionToken);
        }
        await validateSession();
      } catch {
        // Non-blocking — network errors keep user logged in
      }
    };

    validate();
  }, [appReady, isAuthenticated]);

  /**
   * Navigation guard - auth-based routing
   * Uses segments only (stable on mobile)
   */
  useEffect(() => {
    if (!appReady) return;

    const timeout = setTimeout(() => {
      const inAuthGroup = segments[0] === 'login';
      const inProtectedRoute = 
        segments[0] === 'admin' || 
        segments[0] === 'owner' || 
        segments[0] === 'checkout' || 
        segments[0] === 'orders' ||
        segments[0] === 'favorites';

      if (isAuthenticated && inAuthGroup) {
        router.replace('/(tabs)');
      } else if (!isAuthenticated && inProtectedRoute) {
        router.replace('/login');
      }
    }, 150);

    return () => clearTimeout(timeout);
  }, [appReady, isAuthenticated, segments]);

  // Loading state - branded luxury splash (charcoal + champagne gold)
  if (!appReady) {
    return (
      <View style={[styles.loadingContainer, { backgroundColor: currentMood?.background || '#0B0B0E' }]}>
        <DriftLoader size="large" color={currentMood?.primary || '#D4B062'} />
      </View>
    );
  }

  return <>{children}</>;
}

/**
 * Root Layout - Minimal wrapper with providers
 */
export default function RootLayout() {
  const theme = useAppStore((state) => state.theme);

  return (
    <AnalyticsProvider>
      <QueryProvider>
        <GestureHandlerRootView style={styles.root}>
          <SafeAreaProvider>
            <StatusBar style={theme === 'dark' ? 'light' : 'dark'} />
            <AuthGuard>
              <Stack screenOptions={{ headerShown: false }}>
                <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
                <Stack.Screen name="login" options={{ presentation: 'modal' }} />
                <Stack.Screen name="auth/email" options={{ headerShown: false }} />
                <Stack.Screen name="product/[id]" />
                <Stack.Screen name="category/[id]" />
                <Stack.Screen name="car/[id]" />
                <Stack.Screen name="brand/[id]" />
                <Stack.Screen name="models" />
                <Stack.Screen name="search" />
                <Stack.Screen name="checkout" />
                <Stack.Screen name="orders" />
                <Stack.Screen name="favorites" />
                <Stack.Screen name="chat" options={{ animation: 'slide_from_bottom' }} />
              </Stack>
            </AuthGuard>
          </SafeAreaProvider>
        </GestureHandlerRootView>
      </QueryProvider>
    </AnalyticsProvider>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
});
