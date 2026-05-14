/**
 * UnifiedShoppingHub - The Universal Shopping & Management Hub
 * FIXED: Removed parent ScrollView causing FlashList scrolling issues
 * FIXED: Removed Zustand sync useEffect causing infinite re-renders
 */
import React, { useEffect, useRef, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Image,
  Animated,
  RefreshControl,
  Linking,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';

// Theme and Translation hooks
import { useTheme } from '../hooks/useTheme';
import { useTranslation } from '../hooks/useTranslation';
import { useAppStore, NEON_NIGHT_THEME } from '../store/appStore';
import { TYPE, COLORS, RADII } from '../constants/luxuryTokens';

// Custom hooks for business logic
import {
  useShoppingHubData,
  useCartOperations,
  useOrderOperations,
  useFavoriteOperations,
} from '../hooks/shopping';
import type { FavoriteProduct, ProfileData } from '../hooks/shopping/types';
import { useQuery } from '@tanstack/react-query';
import { userAddressApi, type UserAddress } from '../services/api';

// Reusable UI components
import { GlassCard } from './ui/GlassCard';
import { TabBadge } from './ui/TabBadge';
import { OrderConfirmationModal } from './ui/OrderConfirmationModal';

// Tab components
import { ProfileTab } from './shopping-hub/ProfileTab';
import { FavoritesTab } from './shopping-hub/FavoritesTab';
import { CartTab } from './shopping-hub/CartTab';
import { CheckoutTab } from './shopping-hub/CheckoutTab';
import { OrdersTab } from './shopping-hub/OrdersTab';
import { OrderStatusToastStack } from './shopping-hub/OrderStatusToastStack';

// ============================================================================
// Types
// ============================================================================

interface UnifiedShoppingHubProps {
  customerId?: string;
  customerData?: ProfileData;
  isAdminView?: boolean;
  onClose?: () => void;
  initialTab?: 'profile' | 'favorites' | 'cart' | 'checkout' | 'orders';
  highlightAppointmentId?: string;
}

type TabKey = 'profile' | 'favorites' | 'cart' | 'checkout' | 'orders';

// ============================================================================
// Main Component
// ============================================================================

export const UnifiedShoppingHub: React.FC<UnifiedShoppingHubProps> = ({
  customerId,
  customerData,
  isAdminView = false,
  onClose,
  initialTab = 'cart',
  highlightAppointmentId,
}) => {
  const [pendingHighlight, setPendingHighlight] = React.useState<string | undefined>(highlightAppointmentId);
  React.useEffect(() => { setPendingHighlight(highlightAppointmentId); }, [highlightAppointmentId]);
  const { colors, isDark } = useTheme();
  const { language, isRTL } = useTranslation();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  // Store hooks
  const user = useAppStore((state) => state.user);
  const userRole = useAppStore((state) => state.userRole);
  const subscriptionStatus = useAppStore((state) => state.subscriptionStatus);

  // Tab state
  const [activeTab, setActiveTab] = React.useState<TabKey>(initialTab);

  // Animation refs
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(50)).current;

  // ============================================================================
  // Custom Hooks for Business Logic
  // ============================================================================

  // Data fetching and state management - React Query as source of truth
  const {
    loading,
    refreshing,
    favorites,
    cartItems,
    orders,
    profileData,
    targetUserId,
    isOwnProfile,
    loadData,
    onRefresh,
  } = useShoppingHubData({ customerId, customerData, isAdminView });

  // Cart operations - uses React Query data directly
  const {
    safeCartItems,
    updateCartQuantity,
    removeFromCart,
    addToCart,
    changeFitment,
    getSubtotal,
    getOriginalTotal,
    getTotalSavings,
    getItemCount,
  } = useCartOperations({
    cartItems,
    setLocalCartItems: () => {}, // No longer needed
    isAdminView,
    loadData,
  });

  // Order operations
  const {
    checkoutForm,
    setCheckoutForm,
    submittingOrder,
    updatingOrderId,
    showOrderConfirmation,
    confirmedOrder,
    canEditOrderStatus,
    prefillForm,
    handleSubmitOrder,
    updateOrderStatus,
    closeOrderConfirmation,
    statusToasts,
    dismissStatusToast,
  } = useOrderOperations({
    cartItems: safeCartItems,
    setLocalCartItems: () => {},
    setOrders: () => {},
    customerId,
    isAdminView,
    language,
  });

  // ── Subscriber single-restaurant discount ─────────────────────────────────
  const isSubscriberDiscount = useMemo(() => {
    if (subscriptionStatus !== 'subscriber') return false;
    if (safeCartItems.length === 0) return false;
    const brands = safeCartItems.map((i) => i.product_brand_name ?? (i.product?.brand_name ?? null)).filter(Boolean);
    const uniqueBrands = new Set(brands);
    return brands.length === safeCartItems.length && uniqueBrands.size === 1;
  }, [subscriptionStatus, safeCartItems]);

  // ── Saved addresses for checkout autofill ─────────────────────────────────
  const { data: savedAddressesData } = useQuery({
    queryKey: ['user-addresses', user?.id],
    queryFn: async () => {
      if (!user?.id) return [] as UserAddress[];
      const res = await userAddressApi.list();
      return res.data.addresses as UserAddress[];
    },
    enabled: !!user?.id,
    staleTime: 5 * 60 * 1000,
  });

  const applySavedAddress = useCallback((addr: UserAddress) => {
    setCheckoutForm({
      ...checkoutForm,
      streetAddress: addr.address || checkoutForm.streetAddress,
      city: addr.city || checkoutForm.city,
      state: addr.governorate || checkoutForm.state,
      deliveryInstructions: addr.notes || checkoutForm.deliveryInstructions,
      deliveryLatitude: addr.latitude != null ? Number(addr.latitude) : checkoutForm.deliveryLatitude,
      deliveryLongitude: addr.longitude != null ? Number(addr.longitude) : checkoutForm.deliveryLongitude,
    });
  }, [checkoutForm, setCheckoutForm]);

  // ── Orders-tab auto-refresh: reload when the user switches to the Orders tab
  const prevActiveTabRef = useRef<TabKey>(initialTab);
  useEffect(() => {
    if (activeTab === 'orders' && prevActiveTabRef.current !== 'orders') {
      loadData();
    }
    prevActiveTabRef.current = activeTab;
  }, [activeTab, loadData]);

  // Favorite operations
  const { toggleFavorite } = useFavoriteOperations({
    setFavorites: () => {},
    isAdminView,
  });

  // ============================================================================
  // Effects
  // ============================================================================

  // Entrance animation
  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, { toValue: 1, duration: 300, useNativeDriver: true }),
      Animated.timing(slideAnim, { toValue: 0, duration: 300, useNativeDriver: true }),
    ]).start();
  }, [fadeAnim, slideAnim]);

  // Pre-fill checkout form when profile data is available
  useEffect(() => {
    if (profileData) {
      prefillForm(profileData);
    }
  }, [profileData, prefillForm]);

  // ============================================================================
  // Callbacks
  // ============================================================================

  const handleAddFavoriteToCart = useCallback(
    (product: FavoriteProduct) => {
      addToCart(product);
      setActiveTab('cart');
    },
    [addToCart]
  );

  const handleOrderSubmit = useCallback(async () => {
    const success = await handleSubmitOrder();
    if (success) {
      // Will switch to orders tab after confirmation modal is closed
    }
  }, [handleSubmitOrder]);

  const handleOrderConfirmationClose = useCallback(() => {
    closeOrderConfirmation();
    setActiveTab('orders');
  }, [closeOrderConfirmation]);

  const handleUpdateOrderStatus = useCallback(
    (orderId: string, newStatus: string) => {
      updateOrderStatus(orderId, newStatus, orders);
    },
    [updateOrderStatus, orders]
  );

  // ============================================================================
  // Tab Configuration
  // ============================================================================

  const safeOrders = Array.isArray(orders) ? orders : [];
  const safeFavorites = Array.isArray(favorites) ? favorites : [];

  const tabs = [
    { key: 'profile' as TabKey, icon: 'person', label: language === 'ar' ? 'الملف' : 'Diner', count: 0 },
    { key: 'favorites' as TabKey, icon: 'bookmark', label: language === 'ar' ? 'محفوظ' : 'Saved', count: safeFavorites.length },
    { key: 'cart' as TabKey, icon: 'restaurant', label: language === 'ar' ? 'طلبك' : 'Order', count: getItemCount() },
    { key: 'checkout' as TabKey, icon: 'wine', label: language === 'ar' ? 'احجز' : 'Reserve', count: 0 },
    { key: 'orders' as TabKey, icon: 'sparkles', label: language === 'ar' ? 'الحجوزات' : 'Reservations', count: safeOrders.filter((o) => o.status === 'pending').length },
  ];

  // ============================================================================
  // Loading State — shell renders immediately; tabs show their own skeletons.
  // We only fall back to the full-screen spinner when there is no profile data
  // available at all (no customerData seed AND no fetched data yet).
  // ============================================================================

  const hasProfileShell = !!profileData;
  if (loading && !hasProfileShell && !isAdminView) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={NEON_NIGHT_THEME.primary} />
          <Text style={[styles.loadingText, { color: colors.textSecondary }]}>
            {language === 'ar' ? 'جاري التحميل...' : 'Loading...'}
          </Text>
        </View>
      </View>
    );
  }

  // ============================================================================
  // Not Logged In State
  // ============================================================================

  if (!targetUserId && isOwnProfile) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={styles.emptyContainer}>
          <View style={[styles.emptyIconContainer, { backgroundColor: colors.surface }]}>
            <Ionicons name="person-outline" size={60} color={NEON_NIGHT_THEME.primary} />
          </View>
          <Text style={[styles.emptyTitle, { color: colors.text }]}>
            {language === 'ar' ? 'انضم إلى المائدة' : 'Join the Table'}
          </Text>
          <Text style={[styles.emptySubtitle, { color: colors.textSecondary }]}>
            {language === 'ar' ? 'سجّل دخولك لاستعراض حجوزاتك وأطباقك المحفوظة' : 'Sign in to view your reservations and saved dishes'}
          </Text>
          <TouchableOpacity
            style={[styles.actionButton, { backgroundColor: COLORS.gold }]}
            onPress={() => router.push('/login')}
          >
            <Ionicons name="log-in-outline" size={20} color={COLORS.charcoalDeep} />
            <Text style={[styles.actionButtonText, { color: COLORS.charcoalDeep }]}>
              {language === 'ar' ? 'تسجيل الدخول' : 'Login'}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // ============================================================================
  // Main Render - FIXED: Removed parent ScrollView for tab content
  // ============================================================================

  return (
    <Animated.View
      style={[
        styles.container,
        { backgroundColor: colors.background, opacity: fadeAnim, transform: [{ translateY: slideAnim }] },
      ]}
    >
      {/* Profile Header */}
      <GlassCard style={[styles.profileHeader, { marginTop: isAdminView ? 0 : insets.top }]}>
        <View style={[styles.profileRow, isRTL && styles.rowReverse]}>
          <View style={[styles.avatarContainer, { backgroundColor: COLORS.gold }]}>
            {profileData?.picture ? (
              <Image source={{ uri: profileData.picture }} style={styles.avatar} />
            ) : (
              <Text style={styles.avatarText}>
                {(profileData?.name || profileData?.email || '?')[0].toUpperCase()}
              </Text>
            )}
            {isAdminView && (
              <View style={[styles.adminBadge, { backgroundColor: '#8B5CF6' }]}>
                <Ionicons name="eye" size={10} color="#FFF" />
              </View>
            )}
          </View>

          <View style={[styles.profileInfo, isRTL && { alignItems: 'flex-end' }]}>
            <Text style={[styles.profileName, { color: colors.text }]}>
              {profileData?.name || (language === 'ar' ? 'مستخدم' : 'User')}
            </Text>
            {/* Email — clickable mailto for owner/admin */}
            {(() => {
              const isPrivileged = userRole === 'owner' || userRole === 'admin';
              const emailEl = (
                <Text style={[styles.profileEmail, { color: colors.textSecondary }]}>
                  {profileData?.email}
                </Text>
              );
              return isAdminView && isPrivileged && profileData?.email ? (
                <TouchableOpacity
                  onPress={() => Linking.openURL(`mailto:${profileData.email}`)}
                  activeOpacity={0.7}
                >
                  {emailEl}
                </TouchableOpacity>
              ) : emailEl;
            })()}
            {/* Phone — verified=green, unverified=blue; clickable WhatsApp for owner/admin */}
            {profileData?.phone && (
              <View style={[styles.profileMeta, isRTL && styles.rowReverse]}>
                {(() => {
                  const verified = !!profileData?.phone_verified;
                  const phoneColor = verified ? '#10B981' : '#3B82F6';
                  const isPrivileged = userRole === 'owner' || userRole === 'admin';
                  const waNumber = profileData.phone.replace(/\D/g, '');
                  const phoneMeta = (
                    <View style={[styles.profileMeta, isRTL && styles.rowReverse]}>
                      <Ionicons name={verified ? 'call' : 'call-outline'} size={12} color={phoneColor} />
                      <Text style={[styles.profileMetaText, { color: phoneColor }]}>
                        {profileData.phone}
                      </Text>
                      {verified && (
                        <Ionicons name="checkmark-circle" size={11} color="#10B981" />
                      )}
                    </View>
                  );
                  return isAdminView && isPrivileged ? (
                    <TouchableOpacity
                      onPress={() => Linking.openURL(`https://wa.me/${waNumber}`)}
                      activeOpacity={0.7}
                    >
                      {phoneMeta}
                    </TouchableOpacity>
                  ) : phoneMeta;
                })()}
              </View>
            )}
          </View>

          {isAdminView && onClose && (
            <TouchableOpacity
              style={[styles.closeButton, { backgroundColor: colors.surface }]}
              onPress={onClose}
            >
              <Ionicons name="close" size={20} color={colors.text} />
            </TouchableOpacity>
          )}
        </View>

        {/* Admin View Badge */}
        {isAdminView && (
          <View style={styles.roleBadgeContainer}>
            <View style={[styles.roleBadge, { backgroundColor: '#8B5CF6' }]}>
              <Ionicons name="shield-checkmark" size={12} color="#FFF" />
              <Text style={styles.roleBadgeText}>
                {language === 'ar' ? 'عرض المسؤول' : 'Admin View'}
              </Text>
            </View>
          </View>
        )}
      </GlassCard>

      {/* Navigation Tabs */}
      <View style={[styles.tabsWrapper, { backgroundColor: colors.surface }]}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={[styles.tabsContainer, isRTL && styles.rowReverse]}
        >
          {tabs.map((tab) => (
            <TouchableOpacity
              key={tab.key}
              style={[
                styles.tab,
                activeTab === tab.key && {
                  backgroundColor: COLORS.gold + '18',
                  borderBottomColor: COLORS.gold,
                },
              ]}
              onPress={() => setActiveTab(tab.key)}
            >
              <View style={styles.tabContent}>
                <Ionicons
                  name={tab.icon as any}
                  size={18}
                  color={activeTab === tab.key ? COLORS.goldBright : colors.textSecondary}
                />
                <Text
                  style={[
                    styles.tabLabel,
                    { color: activeTab === tab.key ? COLORS.goldBright : colors.textSecondary },
                  ]}
                >
                  {tab.label}
                </Text>
                <TabBadge
                  count={tab.count}
                  color={activeTab === tab.key ? COLORS.goldBright : '#6B7280'}
                />
              </View>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>

      {/* Content Area - FIXED: No gaps, each tab handles its own scrolling */}
      <View style={styles.content}>
        {activeTab === 'profile' && (
          <ScrollView
            style={styles.tabScrollView}
            contentContainerStyle={styles.contentContainer}
            showsVerticalScrollIndicator={false}
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={onRefresh}
                tintColor={NEON_NIGHT_THEME.primary}
              />
            }
          >
            {/* In admin view `profileData` is seeded synchronously from
                the customer-row prop, so the skeleton inside ProfileTab
                only fires for the rare deep-link/no-seed case. */}
            <ProfileTab
              profileData={profileData}
              ordersCount={safeOrders.length}
              favoritesCount={safeFavorites.length}
              cartItemsCount={getItemCount()}
              isRTL={isRTL}
              isAdminView={isAdminView}
              customerEmail={profileData?.email}
              isInitialLoading={loading}
            />
            <View style={{ height: 100 }} />
          </ScrollView>
        )}

        {activeTab === 'favorites' && (
          <FavoritesTab
            favorites={safeFavorites}
            isRTL={isRTL}
            isAdminView={isAdminView}
            onAddToCart={handleAddFavoriteToCart}
            onToggleFavorite={toggleFavorite}
            onRefresh={onRefresh}
            refreshing={refreshing}
            isInitialLoading={loading}
          />
        )}

        {activeTab === 'cart' && (
          <CartTab
            cartItems={safeCartItems}
            isRTL={isRTL}
            getSubtotal={getSubtotal}
            getOriginalTotal={getOriginalTotal}
            getTotalSavings={getTotalSavings}
            getItemCount={getItemCount}
            onUpdateQuantity={updateCartQuantity}
            onRemove={removeFromCart}
            onChangeFitment={changeFitment}
            onAddToCart={addToCart}
            onCheckout={() => setActiveTab('checkout')}
            onRefresh={onRefresh}
            refreshing={refreshing}
            isInitialLoading={loading}
            isAdminView={isAdminView}
          />
        )}

        {activeTab === 'checkout' && (
          <ScrollView
            style={styles.tabScrollView}
            contentContainerStyle={styles.contentContainer}
            showsVerticalScrollIndicator={false}
          >
            {/* In normal use checkout is reached from the cart, so its
                skeleton only fires for direct deep-link / no-data cases. */}
            <CheckoutTab
              checkoutForm={checkoutForm}
              setCheckoutForm={setCheckoutForm}
              submittingOrder={submittingOrder}
              cartItemsCount={safeCartItems.length}
              getSubtotal={getSubtotal}
              getItemCount={getItemCount}
              isRTL={isRTL}
              onSubmitOrder={handleOrderSubmit}
              isInitialLoading={loading}
              isSubscriberDiscount={isSubscriberDiscount}
              savedAddresses={savedAddressesData}
              onApplySavedAddress={applySavedAddress}
              cartItems={safeCartItems}
            />
            <View style={{ height: 100 }} />
          </ScrollView>
        )}

        {activeTab === 'orders' && (
          <OrdersTab
            orders={safeOrders}
            isRTL={isRTL}
            canEditOrderStatus={canEditOrderStatus}
            updatingOrderId={updatingOrderId}
            onUpdateStatus={handleUpdateOrderStatus}
            onRefresh={onRefresh}
            refreshing={refreshing}
            highlightAppointmentId={pendingHighlight}
            onHighlightConsumed={() => setPendingHighlight(undefined)}
            highlightCustomerUserId={isAdminView && customerId ? customerId : undefined}
            isInitialLoading={loading}
            isOwnView={!isAdminView}
          />
        )}
      </View>

      {/* Order Confirmation Modal */}
      <OrderConfirmationModal
        visible={showOrderConfirmation}
        order={confirmedOrder}
        onClose={closeOrderConfirmation}
        onViewOrders={handleOrderConfirmationClose}
      />

      {/* Order status change toasts (admin/owner/partner feedback) */}
      <OrderStatusToastStack toasts={statusToasts} onDismiss={dismissStatusToast} />
    </Animated.View>
  );
};

// ============================================================================
// Styles
// ============================================================================

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    marginTop: 12,
    fontSize: 15,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  emptyIconContainer: {
    width: 120,
    height: 120,
    borderRadius: 60,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  emptyTitle: {
    ...TYPE.display,
    fontSize: 24,
    marginBottom: 8,
    textAlign: 'center',
  },
  emptySubtitle: {
    fontSize: 15,
    textAlign: 'center',
    marginBottom: 24,
  },
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 24,
    paddingVertical: 14,
    borderRadius: 12,
  },
  actionButtonText: {
    color: '#FFF',
    fontSize: 16,
    fontWeight: '600',
  },
  profileHeader: {
    marginTop: 0,
    marginBottom: 8,
  },
  profileRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  rowReverse: {
    flexDirection: 'row-reverse',
  },
  avatarContainer: {
    width: 64,
    height: 64,
    borderRadius: 32,
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
    borderWidth: 1.5,
    borderColor: COLORS.gold,
  },
  avatar: {
    width: 64,
    height: 64,
    borderRadius: 32,
  },
  avatarText: {
    fontSize: 24,
    fontWeight: '700',
    color: '#FFF',
  },
  adminBadge: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    width: 20,
    height: 20,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  profileInfo: {
    flex: 1,
    marginLeft: 12,
  },
  profileName: {
    ...TYPE.title,
    fontSize: 20,
  },
  profileEmail: {
    fontSize: 13,
    marginTop: 2,
  },
  profileMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 4,
  },
  profileMetaText: {
    fontSize: 12,
  },
  closeButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
  },
  roleBadgeContainer: {
    marginTop: 12,
    alignItems: 'flex-start',
  },
  roleBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  roleBadgeText: {
    color: '#FFF',
    fontSize: 11,
    fontWeight: '600',
  },
  tabsWrapper: {
    marginHorizontal: 16,
    borderRadius: 12,
    marginBottom: 8,
  },
  tabsContainer: {
    flexDirection: 'row',
    padding: 6,
  },
  tab: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: RADII.sm,
    marginRight: 6,
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  tabContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  tabLabel: {
    ...TYPE.chipLabel,
    fontSize: 11,
  },
  content: {
    flex: 1,
  },
  contentContainer: {
    paddingTop: 4,
  },
  tabScrollView: {
    flex: 1,
  },
});

export default UnifiedShoppingHub;
