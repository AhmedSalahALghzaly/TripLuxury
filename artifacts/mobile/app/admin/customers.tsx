/**
 * Customers Admin - Refactored with TanStack Query + FlashList
 * High-performance, stable architecture with optimistic updates
 */
import React, { useState, useMemo, useCallback, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, Image, RefreshControl, Linking, Platform, Modal } from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTheme } from '../../src/hooks/useTheme';
import { useTranslation } from '../../src/hooks/useTranslation';
import { customersApi } from '../../src/services/api';
import api from '../../src/services/api';
import { Header } from '../../src/components/Header';
import { UnifiedShoppingHub } from '../../src/components/UnifiedShoppingHub';
import { NEON_NIGHT_THEME, useAppStore } from '../../src/store/appStore';
import { OrderStatusIndicator } from '../../src/components/ui/OrderStatusIndicator';
import { AddCustomerModal } from '../../src/components/ui/AddCustomerModal';
import { queryKeys } from '../../src/lib/queryClient';
import { shoppingHubKeys } from '../../src/hooks/queries/useShoppingHubQuery';
import { useWebSocketEvent } from '../../src/services/websocketService';
import { AccessGuard as __AccessGuard__ } from '../../src/components/AccessGuard';
interface Customer {
  id: string;
  user_id?: string;
  name?: string;
  email?: string;
  phone?: string;
  picture?: string;
  created_at?: string;
  status?: string;
}

// Memoized Customer List Item
const CustomerListItem = React.memo(({
  customer,
  colors,
  language,
  isRTL,
  orderStatus,
  formatDate,
  onOpenProfile,
  onViewOrders,
  onDelete,
  isOwner,
}: {
  customer: Customer;
  colors: any;
  language: string;
  isRTL: boolean;
  orderStatus: { status: string; activeCount: number } | undefined;
  formatDate: (dateStr?: string) => string;
  onOpenProfile: (customer: Customer, tab?: 'profile' | 'favorites' | 'cart' | 'checkout' | 'orders') => void;
  onViewOrders: (customer: Customer) => void;
  onDelete: (id: string, name: string) => void;
  isOwner: boolean;
}) => (
  <TouchableOpacity 
    style={[styles.customerItem, { borderColor: colors.border }]}
    onPress={() => onOpenProfile(customer, 'profile')}
    activeOpacity={0.7}
  >
    {/* Avatar */}
    <View style={[styles.avatar, { backgroundColor: NEON_NIGHT_THEME.primary + '20' }]}>
      {customer.picture ? (
        <Image source={{ uri: customer.picture }} style={styles.avatarImage} />
      ) : (
        <Text style={[styles.avatarText, { color: NEON_NIGHT_THEME.primary }]}>
          {(customer.name || customer.email || '?')[0].toUpperCase()}
        </Text>
      )}
    </View>

    {/* Customer Info */}
    <View style={styles.customerInfo}>
      <Text style={[styles.customerName, { color: colors.text }]}>
        {customer.name || customer.email?.split('@')[0] || 'Unknown'}
      </Text>
      <View style={[styles.customerMeta, isRTL && styles.rowReverse]}>
        <Ionicons name="mail-outline" size={12} color={colors.textSecondary} />
        <Text style={[styles.customerEmail, { color: colors.textSecondary }]} numberOfLines={1}>
          {customer.email}
        </Text>
      </View>
      {customer.phone && (
        <TouchableOpacity
          style={[styles.customerMeta, isRTL && styles.rowReverse]}
          onPress={() => {
            const clean = customer.phone!.replace(/[^0-9]/g, '');
            const url = `https://wa.me/${clean}`;
            if (Platform.OS === 'web') { window.open(url, '_blank'); }
            else { Linking.openURL(url); }
          }}
          activeOpacity={0.7}
        >
          <Ionicons name="logo-whatsapp" size={12} color="#25D366" />
          <Text style={[styles.customerPhone, { color: '#25D366', textDecorationLine: 'underline' }]}>
            {customer.phone}
          </Text>
        </TouchableOpacity>
      )}
      <Text style={[styles.customerDate, { color: colors.textSecondary }]}>
        {language === 'ar' ? 'انضم:' : 'Joined:'} {formatDate(customer.created_at)}
      </Text>
    </View>

    {/* Action Icons */}
    <View style={styles.actionIcons}>
      {/* Real-Time Order Status Indicator */}
      <View style={styles.statusIndicatorWrapper}>
        <OrderStatusIndicator 
          status={orderStatus?.status || 'no_active_order'}
          activeOrderCount={orderStatus?.activeCount || 0}
          size={24}
        />
      </View>

      {/* Quick Actions */}
      <TouchableOpacity 
        style={[styles.iconBtn, { backgroundColor: '#EF4444' + '20' }]}
        onPress={(e) => { e.stopPropagation(); onOpenProfile(customer, 'favorites'); }}
      >
        <Ionicons name="heart" size={16} color="#EF4444" />
      </TouchableOpacity>

      <TouchableOpacity 
        style={[styles.iconBtn, { backgroundColor: NEON_NIGHT_THEME.primary + '20' }]}
        onPress={(e) => { e.stopPropagation(); onOpenProfile(customer, 'cart'); }}
      >
        <Ionicons name="cart" size={16} color={NEON_NIGHT_THEME.primary} />
      </TouchableOpacity>

      <TouchableOpacity 
        style={[styles.iconBtn, { backgroundColor: '#10B981' + '20' }]}
        onPress={(e) => { e.stopPropagation(); onViewOrders(customer); }}
      >
        <Ionicons name="receipt" size={16} color="#10B981" />
      </TouchableOpacity>

      {/* View Details */}
      <TouchableOpacity 
        style={[styles.iconBtn, { backgroundColor: colors.surface }]}
        onPress={(e) => { e.stopPropagation(); onOpenProfile(customer, 'profile'); }}
      >
        <Ionicons name="eye" size={18} color={colors.text} />
      </TouchableOpacity>

      {/* Delete - Owner only */}
      {isOwner && (
        <TouchableOpacity
          style={[styles.iconBtn, { backgroundColor: colors.error + '20' }]}
          onPress={(e) => { e.stopPropagation(); onDelete(customer.user_id || customer.id, customer.name || customer.email || ''); }}
        >
          <Ionicons name="trash" size={16} color={colors.error} />
        </TouchableOpacity>
      )}
    </View>
  </TouchableOpacity>
));

// ===== STANDALONE EMPTY COMPONENT (outside parent to prevent FlashList infinite loop) =====
const CustomersEmptyComponent = React.memo(({
  isLoading,
  colors,
  language,
}: {
  isLoading: boolean;
  colors: any;
  language: string;
}) => (
  <View style={styles.emptyContainer}>
    {isLoading ? (
      <ActivityIndicator size="large" color={colors.primary} />
    ) : (
      <>
        <Ionicons name="people-outline" size={48} color={colors.border} />
        <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
          {language === 'ar' ? 'لا يوجد عملاء' : 'No customers found'}
        </Text>
      </>
    )}
  </View>
));

// ===== STANDALONE HEADER (outside parent to prevent FlashList infinite loop) =====
const CustomersListHeader = React.memo(({
  isRTL, colors, language, customersCount, pendingOrderCounts, onNavigateAdmin, onRefresh, onAddCustomer,
}: {
  isRTL: boolean;
  colors: any;
  language: string;
  customersCount: number;
  pendingOrderCounts: Record<string, number>;
  onNavigateAdmin: () => void;
  onRefresh: () => void;
  onAddCustomer: () => void;
}) => {
  const totalPending = Object.values(pendingOrderCounts).reduce((a: number, b: number) => a + b, 0);
  return (
    <View>
      <View style={[styles.breadcrumb, isRTL && styles.breadcrumbRTL]}>
        <TouchableOpacity onPress={onNavigateAdmin}>
          <Text style={[styles.breadcrumbText, { color: colors.primary }]}>
            {language === 'ar' ? 'لوحة التحكم' : 'Admin'}
          </Text>
        </TouchableOpacity>
        <Ionicons name={isRTL ? 'chevron-back' : 'chevron-forward'} size={16} color={colors.textSecondary} />
        <Text style={[styles.breadcrumbText, { color: colors.textSecondary }]}>
          {language === 'ar' ? 'العملاء' : 'Customers'}
        </Text>
      </View>
      <View style={[styles.statsCard, { backgroundColor: NEON_NIGHT_THEME.primary }]}>
        <View style={styles.statItem}>
          <Text style={styles.statValue}>{customersCount}</Text>
          <Text style={styles.statLabel}>{language === 'ar' ? 'إجمالي العملاء' : 'Total Customers'}</Text>
        </View>
        <View style={styles.statDivider} />
        <View style={styles.statItem}>
          <Text style={styles.statValue}>{totalPending}</Text>
          <Text style={styles.statLabel}>{language === 'ar' ? 'طلبات معلقة' : 'Pending Orders'}</Text>
        </View>
      </View>
      <View style={[styles.listCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <View style={[styles.listHeader, isRTL && styles.listHeaderRTL]}>
          <Text style={[styles.listTitle, { color: colors.text }]}>
            {language === 'ar' ? 'قائمة العملاء' : 'Customer List'}
          </Text>
          <View style={styles.listHeaderActions}>
            <TouchableOpacity onPress={onRefresh} style={styles.headerActionBtn}>
              <Ionicons name="refresh" size={20} color={colors.primary} />
            </TouchableOpacity>
            <TouchableOpacity onPress={onAddCustomer} style={[styles.addBtn, { backgroundColor: NEON_NIGHT_THEME.primary }]}>
              <Ionicons name="add" size={20} color="#FFF" />
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </View>
  );
});

function CustomersAdmin() {
  const { colors } = useTheme();
  const { language, isRTL } = useTranslation();
  const router = useRouter();
  const params = useLocalSearchParams();
  const queryClient = useQueryClient();
  const userRole = useAppStore((state) => state.userRole);
  const isOwner = userRole === 'owner';

  // Customer Profile State
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [showProfile, setShowProfile] = useState(false);
  const [initialTab, setInitialTab] = useState<'profile' | 'favorites' | 'cart' | 'checkout' | 'orders'>('favorites');

  // Add Customer Modal State
  const [showAddModal, setShowAddModal] = useState(false);

  // Delete Confirmation State
  const [deleteConfirm, setDeleteConfirm] = useState<{ visible: boolean; id: string; name: string }>({ visible: false, id: '', name: '' });

  const handleAddCustomer = useCallback(() => {
    setShowAddModal(true);
  }, []);

  // TanStack Query: Fetch Customers — single query, no N+1 calls
  const {
    data: customersResult,
    isLoading,
    isRefetching,
    refetch,
  } = useQuery({
    queryKey: queryKeys.customers.all,
    queryFn: async () => {
      const response = await customersApi.getAll();
      const customersList = response.data?.customers || [];

      // Build status maps directly from the fields already returned by the API
      const counts: Record<string, number> = {};
      const statusMap: Record<string, { status: string; activeCount: number }> = {};

      customersList.forEach((customer: any) => {
        const userId = customer.id;
        if (!userId) return;
        const activeCount = Number(customer.active_orders_count) || 0;
        const activeStatus = customer.active_order_status || (Number(customer.orders_count) > 0 ? 'completed' : 'no_active_order');
        counts[userId] = activeCount;
        statusMap[userId] = { status: activeStatus, activeCount };
      });

      return {
        customers: customersList,
        pendingOrderCounts: counts,
        customerOrderStatus: statusMap,
      };
    },
    staleTime: 2 * 60 * 1000,
  });

  const customers: Customer[] = useMemo(() => customersResult?.customers || [], [customersResult]);
  const pendingOrderCounts = useMemo(() => customersResult?.pendingOrderCounts || {}, [customersResult]);
  const customerOrderStatus = useMemo(() => customersResult?.customerOrderStatus || {}, [customersResult]);

  useWebSocketEvent(['customer_created', 'customer_updated', 'customer_deleted'], () => {
    queryClient.invalidateQueries({ queryKey: queryKeys.customers.all });
  });

  // Delete Mutation with Optimistic Update
  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await customersApi.delete(id);
      return id;
    },
    onMutate: async (deletedId) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.customers.all });
      const previousData = queryClient.getQueryData(queryKeys.customers.all);

      queryClient.setQueryData(queryKeys.customers.all, (old: any) => {
        if (!old) return old;
        return {
          ...old,
          customers: old.customers.filter((c: Customer) => c.user_id !== deletedId && c.id !== deletedId),
        };
      });

      return { previousData };
    },
    onError: (err, variables, context) => {
      if (context?.previousData) {
        queryClient.setQueryData(queryKeys.customers.all, context.previousData);
      }
    },
  });

  // Handle customerId query param for direct navigation (only once per customerId)
  const profileOpenedRef = React.useRef<string | null>(null);
  useEffect(() => {
    if (params.customerId && customers.length > 0 && profileOpenedRef.current !== params.customerId) {
      const customer = customers.find(c => c.user_id === params.customerId || c.id === params.customerId);
      if (customer) {
        profileOpenedRef.current = params.customerId as string;
        const requestedTab = typeof params.tab === 'string' ? params.tab : '';
        const validTabs = ['profile', 'favorites', 'cart', 'checkout', 'orders'] as const;
        const initialTab = (validTabs as readonly string[]).includes(requestedTab)
          ? (requestedTab as typeof validTabs[number])
          : 'profile';
        openCustomerProfile(customer, initialTab);
      }
    }
  }, [params.customerId, params.tab, customers.length]);

  const prefetchCustomerData = useCallback((customer: Customer) => {
    const id = customer.id;
    if (!id) return;
    // Prefetch each resource independently so the three tabs load in parallel
    // when the admin opens the customer profile.
    queryClient.prefetchQuery({
      queryKey: shoppingHubKeys.customerFavorites(id),
      queryFn: () => api.get(`/customers/admin/customer/${id}/favorites`).then(r => r.data?.favorites ?? []),
      staleTime: 30 * 1000,
    }).catch(() => {});
    queryClient.prefetchQuery({
      queryKey: shoppingHubKeys.customerCart(id),
      queryFn: () => api.get(`/customers/admin/customer/${id}/cart`).then(r => r.data?.cart ?? []),
      staleTime: 30 * 1000,
    }).catch(() => {});
    queryClient.prefetchQuery({
      queryKey: shoppingHubKeys.customerOrders(id),
      queryFn: () => api.get(`/customers/admin/customer/${id}/orders`).then(r => r.data?.orders ?? []),
      staleTime: 30 * 1000,
    }).catch(() => {});
  }, [queryClient]);

  const openCustomerProfile = useCallback((customer: Customer, tab: 'profile' | 'favorites' | 'cart' | 'checkout' | 'orders' = 'profile') => {
    prefetchCustomerData(customer);
    setSelectedCustomer(customer);
    setInitialTab(tab);
    setShowProfile(true);
  }, [prefetchCustomerData]);

  const handleViewOrders = useCallback((customer: Customer) => {
    openCustomerProfile(customer, 'orders');
  }, [openCustomerProfile]);

  const handleDelete = useCallback((id: string, name: string) => {
    setDeleteConfirm({ visible: true, id, name });
  }, []);

  const handleConfirmDelete = useCallback(() => {
    if (deleteConfirm.id) {
      deleteMutation.mutate(deleteConfirm.id);
    }
    setDeleteConfirm({ visible: false, id: '', name: '' });
  }, [deleteConfirm.id, deleteMutation]);

  const formatDate = useCallback((dateStr?: string) => {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    return date.toLocaleDateString(language === 'ar' ? 'ar-EG' : 'en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  }, [language]);

  const onRefresh = useCallback(() => {
    refetch();
  }, [refetch]);

  const onNavigateAdmin = useCallback(() => {
    router.push('/admin');
  }, [router]);

  // NOTE: ListHeaderComponent is defined OUTSIDE this component (below) to prevent FlashList infinite loop

  // Empty JSX element passed directly - avoids FlashList infinite loop from function components

  // Render item
  const renderItem = useCallback(({ item }: { item: Customer }) => (
    <CustomerListItem
      customer={item}
      colors={colors}
      language={language}
      isRTL={isRTL}
      orderStatus={customerOrderStatus[item.id]}
      formatDate={formatDate}
      onOpenProfile={openCustomerProfile}
      onViewOrders={handleViewOrders}
      onDelete={handleDelete}
      isOwner={isOwner}
    />
  ), [colors, language, isRTL, customerOrderStatus, formatDate, openCustomerProfile, handleViewOrders, handleDelete, isOwner]);

  const keyExtractor = useCallback((item: Customer) => item.user_id || item.id, []);

  // Customer Profile Modal - Conditional rendering inside main return (fixes hooks violation)
  if (showProfile && selectedCustomer) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['bottom']}>
        <Header 
          title={selectedCustomer?.name || (language === 'ar' ? 'ملف العميل' : 'Customer Profile')} 
          showBack 
          showSearch={false} 
          showCart={false} 
        />
        <UnifiedShoppingHub
          customerId={selectedCustomer.id}
          customerData={selectedCustomer}
          isAdminView={true}
          onClose={() => {
            setShowProfile(false);
            setSelectedCustomer(null);
            refetch(); // Refresh list on close
          }}
          initialTab={initialTab}
        />
      </SafeAreaView>
    );
  }

  // Main Customer List View
  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['bottom']}>
      <Header title={language === 'ar' ? 'العملاء' : 'Customers'} showBack showSearch={false} showCart={false} />

      <CustomersListHeader
        isRTL={isRTL}
        colors={colors}
        language={language}
        customersCount={customers.length}
        pendingOrderCounts={pendingOrderCounts}
        onNavigateAdmin={onNavigateAdmin}
        onRefresh={onRefresh}
        onAddCustomer={handleAddCustomer}
      />

      <AddCustomerModal
        visible={showAddModal}
        onClose={() => setShowAddModal(false)}
        onSuccess={() => { refetch(); }}
      />

      {/* Delete Confirmation Modal */}
      <Modal visible={deleteConfirm.visible} transparent animationType="fade" onRequestClose={() => setDeleteConfirm({ visible: false, id: '', name: '' })}>
        <View style={delModalStyles.overlay}>
          <View style={[delModalStyles.card, { backgroundColor: colors.card }]}>
            <View style={delModalStyles.iconWrap}>
              <Ionicons name="trash" size={32} color="#EF4444" />
            </View>
            <Text style={[delModalStyles.title, { color: colors.text }]}>
              {language === 'ar' ? 'تأكيد الحذف' : 'Confirm Delete'}
            </Text>
            <Text style={[delModalStyles.msg, { color: colors.textSecondary }]}>
              {language === 'ar'
                ? `هل أنت متأكد من حذف حساب "${deleteConfirm.name}" نهائياً؟ لا يمكن التراجع عن هذا الإجراء.`
                : `Are you sure you want to permanently delete "${deleteConfirm.name}"? This action cannot be undone.`}
            </Text>
            <View style={delModalStyles.btns}>
              <TouchableOpacity
                style={[delModalStyles.btn, { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1 }]}
                onPress={() => setDeleteConfirm({ visible: false, id: '', name: '' })}
              >
                <Text style={{ color: colors.text, fontWeight: '600', fontSize: 15 }}>
                  {language === 'ar' ? 'إلغاء' : 'Cancel'}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[delModalStyles.btn, { backgroundColor: '#EF4444' }]}
                onPress={handleConfirmDelete}
              >
                <Ionicons name="trash" size={16} color="#FFF" />
                <Text style={{ color: '#FFF', fontWeight: '700', fontSize: 15 }}>
                  {language === 'ar' ? 'حذف نهائي' : 'Delete'}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <FlashList
        data={customers}
        renderItem={renderItem}
        keyExtractor={keyExtractor}
        estimatedItemSize={88}
        ListEmptyComponent={<CustomersEmptyComponent isLoading={isLoading} colors={colors} language={language} />}
        contentContainerStyle={styles.listContentContainer}
        refreshControl={
          <RefreshControl
            refreshing={isRefetching}
            onRefresh={onRefresh}
            colors={[colors.primary]}
            tintColor={colors.primary}
          />
        }
        extraData={customerOrderStatus}
        showsVerticalScrollIndicator={false}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  listContentContainer: { padding: 16 },
  breadcrumb: { flexDirection: 'row', alignItems: 'center', marginBottom: 16, gap: 8 },
  breadcrumbRTL: { flexDirection: 'row-reverse' },
  breadcrumbText: { fontSize: 14 },
  statsCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    padding: 20,
    borderRadius: 16,
    marginBottom: 16,
  },
  statItem: { alignItems: 'center' },
  statValue: { fontSize: 28, fontWeight: '700', color: '#FFF' },
  statLabel: { fontSize: 12, color: 'rgba(255,255,255,0.8)', marginTop: 4 },
  statDivider: { width: 1, height: 40, backgroundColor: 'rgba(255,255,255,0.3)' },
  listCard: { borderRadius: 12, borderWidth: 1, padding: 16 },
  listHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  listHeaderRTL: { flexDirection: 'row-reverse' },
  listTitle: { fontSize: 18, fontWeight: '700' },
  listHeaderActions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  headerActionBtn: { padding: 4 },
  addBtn: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', shadowColor: '#3B82F6', shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.3, shadowRadius: 6, elevation: 4 },
  emptyContainer: { alignItems: 'center', padding: 40 },
  emptyText: { marginTop: 12, textAlign: 'center', fontSize: 15 },
  customerItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 16,
    borderBottomWidth: 1,
  },
  avatar: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  avatarImage: { width: 52, height: 52, borderRadius: 26 },
  avatarText: { fontSize: 20, fontWeight: '700' },
  customerInfo: { flex: 1, marginLeft: 12 },
  customerName: { fontSize: 16, fontWeight: '600', marginBottom: 2 },
  customerMeta: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  rowReverse: { flexDirection: 'row-reverse' },
  customerEmail: { fontSize: 12 },
  customerPhone: { fontSize: 12 },
  customerDate: { fontSize: 11, marginTop: 4 },
  actionIcons: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  statusIndicatorWrapper: { marginRight: 4 },
  iconBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

const delModalStyles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', alignItems: 'center', padding: 24 },
  card: { width: '100%', maxWidth: 380, borderRadius: 20, padding: 24, alignItems: 'center', shadowColor: '#000', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.3, shadowRadius: 16, elevation: 12 },
  iconWrap: { width: 64, height: 64, borderRadius: 32, backgroundColor: '#FEE2E2', alignItems: 'center', justifyContent: 'center', marginBottom: 16 },
  title: { fontSize: 18, fontWeight: '800', marginBottom: 10 },
  msg: { fontSize: 14, textAlign: 'center', lineHeight: 22, marginBottom: 24 },
  btns: { flexDirection: 'row', gap: 12, width: '100%' },
  btn: { flex: 1, height: 48, borderRadius: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
});


/* __ACCESS_GUARD_APPLIED__ */
export default function CustomersAdminGuarded(props: any) {
  return (
    <__AccessGuard__ scope="admin">
      <CustomersAdmin {...props} />
    </__AccessGuard__>
  );
}
