import React, { useState, useCallback, useEffect, useRef } from 'react';
import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Platform, View, StyleSheet, TouchableOpacity, Text, Pressable, Animated } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter, usePathname } from 'expo-router';
import { useTheme } from '../../src/hooks/useTheme';
import { useTranslation } from '../../src/hooks/useTranslation';
import { useAppStore, useCanAccessAdminPanel } from '../../src/store/appStore';
import { useCartQuery } from '../../src/hooks/queries/useShoppingHubQuery';
import { AdvancedSearchBottomSheet } from '../../src/components/ui/AdvancedSearchBottomSheet';
import { createShadow } from '../../src/utils/shadowUtils';
import FloatingChatIcon from '../../src/components/ui/FloatingChatIcon';
import FloatingAiAgentIcon from '../../src/components/ui/FloatingAiAgentIcon';
import { ConnectionStatusBanner } from '../../src/components/ui/ConnectionStatusBanner';
import { restaurantAnalyticsApi, api, pushLogApi } from '../../src/services/api';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useWebSocketEvent } from '../../src/services/websocketService';
import { useAppLiveness } from '../../src/hooks/useAppLiveness';
import NoRestaurantAssignment from '../owner/no-restaurant-assignment';

// Owner email that can always access the interface
const OWNER_EMAIL = 'pc.2025.ai@gmail.com';

// ─── Animated cart badge ────────────────────────────────────────────────────
function AnimatedCartBadge({ count }: { count: number }) {
  const scale = useRef(new Animated.Value(count > 0 ? 1 : 0)).current;
  const prevCount = useRef(count);

  useEffect(() => {
    if (count > 0) {
      if (prevCount.current !== count) {
        // Bounce on change
        Animated.sequence([
          Animated.spring(scale, { toValue: 1.45, useNativeDriver: true, speed: 35 }),
          Animated.spring(scale, { toValue: 1,    useNativeDriver: true, speed: 22 }),
        ]).start();
      } else {
        Animated.spring(scale, { toValue: 1, useNativeDriver: true, speed: 25 }).start();
      }
    } else {
      Animated.spring(scale, { toValue: 0, useNativeDriver: true, speed: 30 }).start();
    }
    prevCount.current = count;
  }, [count]);

  if (count <= 0) return null;
  return (
    <Animated.View style={[tabStyles.badge, { transform: [{ scale }] }]}>
      <Text style={tabStyles.badgeText}>{count > 99 ? '99+' : count}</Text>
    </Animated.View>
  );
}

export default function TabLayout() {
  const { colors } = useTheme();
  const { t, isRTL, language } = useTranslation();
  const router = useRouter();
  const { data: cartQueryData } = useCartQuery();
  const user = useAppStore((state) => state.user);
  const partners = useAppStore((state) => state.partners);
  const admins = useAppStore((state) => state.admins);
  const userRole = useAppStore((state) => state.userRole);
  const canAccessAdminPanel = useCanAccessAdminPanel();
  const ratedOrderIds = useAppStore((state) => state.ratedOrderIds);
  const addPendingRating = useAppStore((state) => state.addPendingRating);
  const removePendingRating = useAppStore((state) => state.removePendingRating);
  const queryClient = useQueryClient();

  const lastViewedPushLogAtByUser = useAppStore((state) => state.lastViewedPushLogAtByUser);

  const [showSearch, setShowSearch] = useState(false);

  // ── Real-time restaurant assignment: when the owner links a restaurant to
  //    this account the server pushes restaurant_user_assigned. Invalidating
  //    the query causes myAssignmentsQ to refetch and, once it returns ≥1
  //    restaurant, the layout automatically swaps from NoRestaurantAssignment
  //    to the storefront button without any manual user action.
  useWebSocketEvent(['restaurant_user_assigned'], () => {
    queryClient.invalidateQueries({ queryKey: ['my-restaurant-assignments', user?.id] });
  });

  // ── Global rating trigger: lives here so it fires even when Home is unmounted
  useWebSocketEvent(['order_status_changed'], async (msg: any) => {
    if (!user) return;
    const status = msg?.data?.status ?? msg?.data?.new_status ?? msg?.status;
    const orderId = msg?.data?.order_id ?? msg?.data?.id ?? msg?.order_id;
    if (status !== 'delivered' || !orderId) return;
    if (ratedOrderIds.includes(orderId)) return;
    try {
      const { data } = await api.get(`/ratings/check/${orderId}`);
      if (!data?.rated) addPendingRating(orderId);
    } catch {
      // Server unavailable — skip (safe default: don't prompt)
    }
  });
  
  const cartCount = cartQueryData?.length ?? 0;

  // Check if user can access owner interface
  const isOwner = user?.email?.toLowerCase() === OWNER_EMAIL.toLowerCase();
  const isPartner = partners.some(
    (p: any) => p.email?.toLowerCase() === user?.email?.toLowerCase()
  );
  const isAdmin = admins.some(
    (a: any) => a.email?.toLowerCase() === user?.email?.toLowerCase()
  ) || userRole === 'admin';
  const canAccessOwner = isOwner || isPartner;

  // ── Restaurant manager check (restaurant_users table) ──────────────────
  // For accounts added via the "ادارة المستخدمين" popup on a specific restaurant.
  // They are NOT partners/admins but have scoped access to their assigned restaurant.
  const myAssignmentsQ = useQuery({
    queryKey: ['my-restaurant-assignments', user?.id],
    queryFn: () => restaurantAnalyticsApi.getMyAssignments().then((r) => r.data.restaurants),
    enabled: !!user && !canAccessOwner && !isAdmin, // skip if already privileged
    staleTime: 5 * 60 * 1000, // 5 min
    retry: false,
  });
  const assignedRestaurants: any[] = myAssignmentsQ.data ?? [];
  const isRestaurantManager = !canAccessOwner && !isAdmin && assignedRestaurants.length > 0;
  // restaurant_user whose assignments query finished but returned 0 restaurants
  const isUnassignedRestaurantUser =
    !canAccessOwner &&
    !isAdmin &&
    userRole === 'restaurant_user' &&
    myAssignmentsQ.isSuccess &&
    assignedRestaurants.length === 0;

  // Determine if we should show the center floating button
  // Unassigned restaurant_users are redirected to an info screen — no button shown for them
  const showCenterButton = canAccessOwner || isAdmin || isRestaurantManager;

  // ── Pulse animation for the diamond owner button on new alert ────────────
  const pulseScale = useRef(new Animated.Value(1)).current;
  const lastPulseAt = useRef(0);
  const pathname = usePathname();

  useWebSocketEvent(
    ['new_order', 'order_created', 'low_stock_alert', 'out_of_stock'],
    () => {
      if (!canAccessOwner) return;
      // Don't animate when the owner is already on the owner index screen
      if (pathname === '/owner') return;
      // Debounce: skip if another pulse fired within the last 2 s
      const now = Date.now();
      if (now - lastPulseAt.current < 2000) return;
      lastPulseAt.current = now;
      Animated.sequence([
        Animated.spring(pulseScale, { toValue: 1.35, useNativeDriver: true, speed: 30, bounciness: 8 }),
        Animated.spring(pulseScale, { toValue: 1,    useNativeDriver: true, speed: 20, bounciness: 5 }),
      ]).start();
    },
  );

  // ── Unread alert count for owner notification dot ─────────────────────────
  // Placed after canAccessOwner so the enabled flag is available.
  const lastViewedPushLogAt = user?.id ? (lastViewedPushLogAtByUser[user.id] ?? null) : null;
  const { isLive } = useAppLiveness();
  const { data: pushLogUnreadData } = useQuery({
    queryKey: ['push-log-unread-count', user?.id, lastViewedPushLogAt],
    queryFn: () => pushLogApi.getUnreadCount({ since: lastViewedPushLogAt }).then((r) => r.data),
    enabled: canAccessOwner,
    staleTime: 60_000,
    refetchInterval: isLive ? 60_000 : false,
  });
  const ownerUnreadCount = pushLogUnreadData?.count ?? 0;

  // Invalidate when alert WS events arrive so the dot appears immediately
  useWebSocketEvent(
    ['new_order', 'order_created', 'low_stock_alert', 'out_of_stock'],
    () => {
      if (canAccessOwner) {
        queryClient.invalidateQueries({ queryKey: ['push-log-unread-count'], exact: false });
      }
    },
  );

  // ── Custom center button for Owner/Admin/RestaurantManager access ───────
  const CenterAccessButton = useCallback(() => {
    // Owner / partner → futuristic diamond button → /owner
    if (canAccessOwner) {
      return (
        <Animated.View style={{ transform: [{ scale: pulseScale }] }}>
          <TouchableOpacity
            style={tabStyles.centerBtn}
            onPress={() => router.push('/owner')}
            activeOpacity={0.8}
          >
            <LinearGradient colors={['#D4B062', '#A98432']} style={tabStyles.centerBtnGrad}>
              <Ionicons name="diamond" size={30} color="#1B1B1F" />
            </LinearGradient>
            {ownerUnreadCount > 0 && pathname !== '/owner' && (
              <View style={tabStyles.alertDot}>
                {ownerUnreadCount <= 9 && (
                  <Text style={tabStyles.alertDotText}>{ownerUnreadCount}</Text>
                )}
              </View>
            )}
          </TouchableOpacity>
        </Animated.View>
      );
    }

    // Admin → settings (green)
    if (isAdmin) {
      return (
        <TouchableOpacity
          style={tabStyles.centerBtn}
          onPress={() => router.push('/admin')}
          activeOpacity={0.8}
        >
          <LinearGradient colors={['#7A9168', '#4A5D3A']} style={tabStyles.centerBtnGrad}>
            <Ionicons name="settings" size={24} color="#FFF" />
          </LinearGradient>
        </TouchableOpacity>
      );
    }

    // Restaurant manager (restaurant_users) → storefront icon → analytics for their restaurant
    if (isRestaurantManager) {
      const firstRestaurant = assignedRestaurants[0];
      return (
        <TouchableOpacity
          style={tabStyles.centerBtn}
          onPress={() =>
            router.push({
              pathname: '/owner/restaurant-analytics',
              params: { restaurantId: firstRestaurant.id },
            } as any)
          }
          activeOpacity={0.8}
        >
          <LinearGradient colors={['#B45309', '#78350F']} style={tabStyles.centerBtnGrad}>
            <Ionicons name="storefront" size={26} color="#FFD700" />
          </LinearGradient>
        </TouchableOpacity>
      );
    }

    return null;
  }, [canAccessOwner, isAdmin, isRestaurantManager, assignedRestaurants, router, ownerUnreadCount, pulseScale, pathname]);

  // Memoized search tab button
  const SearchTabButton = useCallback((props: any) => (
    <Pressable
      onPress={() => setShowSearch(true)}
      style={({ pressed }) => [
        { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 3, opacity: pressed ? 0.7 : 1 },
      ]}
    >
      <View style={{ alignItems: 'center' }}>
        <Ionicons name="search" size={24} color={colors.tabBarInactive} />
        <Text style={{ fontSize: 11, fontWeight: '700', color: colors.tabBarInactive, marginTop: 1.9 }}>
          {language === 'ar' ? 'بحث' : 'Search'}
        </Text>
      </View>
    </Pressable>
  ), [colors.tabBarInactive, language]);

  // Custom cart tab button with animated badge
  const CartTabButton = useCallback((props: any) => {
    const { onPress, children, style, ...rest } = props;
    return (
      <Pressable
        onPress={onPress}
        style={({ pressed }) => [
          { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 3, opacity: pressed ? 0.75 : 1 },
          style,
        ]}
        {...rest}
      >
        <View style={{ alignItems: 'center' }}>
          <View style={{ position: 'relative' }}>
            {children}
            <AnimatedCartBadge count={cartCount} />
          </View>
        </View>
      </Pressable>
    );
  }, [cartCount]);

  // ── Inline full-screen for unassigned restaurant_user ────────────────────
  // Rendered as an overlay so no navigation is required (and no typed-route
  // cast is needed). The tab bar and floating buttons are hidden beneath it.
  if (isUnassignedRestaurantUser) {
    return <NoRestaurantAssignment />;
  }

  return (
    <>
      <View style={{ flex: 1 }}>
        <Tabs
          screenOptions={{
            headerShown: false,
            tabBarStyle: {
              backgroundColor: colors.tabBar,
              borderTopColor: colors.border,
              height: Platform.OS === 'ios' ? 88 : 64,
              paddingBottom: Platform.OS === 'ios' ? 28 : 8,
              paddingTop: 1.9,
            },
            tabBarActiveTintColor: colors.tabBarActive,
            tabBarInactiveTintColor: colors.tabBarInactive,
            tabBarLabelStyle: {
              fontSize: 11,
              fontWeight: '700',
            },
          }}
        >
          <Tabs.Screen
            name="index"
            options={{
              title: t('home'),
              tabBarIcon: ({ color, size }) => (
                <Ionicons name="home" size={size} color={color} />
              ),
            }}
          />
          <Tabs.Screen
            name="categories"
            options={{
              title: t('categories'),
              tabBarIcon: ({ color, size }) => (
                <Ionicons name="grid" size={size} color={color} />
              ),
            }}
          />
          {/* Hidden owner-placeholder route */}
          <Tabs.Screen
            name="owner-placeholder"
            options={{ href: null }}
          />
          <Tabs.Screen
            name="cart"
            options={{
              title: language === 'ar' ? 'طلبي' : 'My Order',
              tabBarIcon: ({ color, size }) => (
                <Ionicons name="bag-handle" size={size} color={color} />
              ),
              tabBarBadge: cartCount > 0 ? cartCount : undefined,
              tabBarBadgeStyle: {
                backgroundColor: '#EF4444',
                fontSize: 10,
                fontWeight: '700',
                minWidth: 18,
                height: 18,
                lineHeight: 18,
                borderRadius: 9,
              },
            }}
          />
          <Tabs.Screen
            name="profile"
            options={{
              title: language === 'ar' ? 'بحث' : 'Search',
              tabBarIcon: ({ color, size }) => (
                <Ionicons name="search" size={size} color={color} />
              ),
              tabBarButton: SearchTabButton,
            }}
          />
        </Tabs>

        {/* Connection status banner — surfaces offline / paused / reconnecting */}
        <ConnectionStatusBanner topOffset={Platform.OS === 'ios' ? 50 : 28} />

        {/* Admin/Owner/RestaurantManager Center Floating Button */}
        {showCenterButton && (
          <View style={tabStyles.centerBtnContainer}>
            <CenterAccessButton />
          </View>
        )}

        {/* Chat + AI Floating Buttons */}
        {user && (
          <View style={StyleSheet.absoluteFillObject} pointerEvents="box-none">
            <FloatingChatIcon />
            <FloatingAiAgentIcon />
          </View>
        )}
      </View>

      <AdvancedSearchBottomSheet
        visible={showSearch}
        onClose={() => setShowSearch(false)}
      />
    </>
  );
}

const tabStyles = StyleSheet.create({
  centerBtnContainer: {
    position: 'absolute',
    bottom: Platform.OS === 'ios' ? 45 : 25,
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 1000,
  },
  centerBtn: {
    ...createShadow('#8B5CF6', 0, 5, 0.13, 9, 9),
  },
  centerBtnGrad: {
    width: 50,
    height: 50,
    borderRadius: 25,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 3,
    borderColor: '#FFF',
  },
  badge: {
    position: 'absolute',
    top: -7,
    right: -10,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: '#EF4444',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
    borderWidth: 1.5,
    borderColor: '#FFF',
  },
  badgeText: {
    color: '#FFF',
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: -0.3,
  },
  alertDot: {
    position: 'absolute',
    top: -3,
    right: -3,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: '#EF4444',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#FFF',
    paddingHorizontal: 2,
  },
  alertDotText: {
    color: '#FFF',
    fontSize: 8,
    fontWeight: '900',
    letterSpacing: -0.3,
  },
});
