/**
 * Owner Interface Dashboard
 * Advanced owner interface with reorganized icon grids, live metrics, and Partner management
 */
import React, { useEffect, useState, useRef, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Dimensions,
  StatusBar,
  Modal,
  TextInput,
  Animated,
  PanResponder,
  Vibration,
  ActivityIndicator,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { BlurView } from 'expo-blur';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useAppStore, useColorMood } from '../../src/store/appStore';
import { SyncIndicator } from '../../src/components/ui/SyncIndicator';
import { useWebSocket, useWebSocketEvent } from '../../src/services/websocketService';
import { partnerApi, supplierApi, distributorApi, customerApi, adminApi, pushLogApi } from '../../src/services/api';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { haptic } from '../../src/services/hapticService';
import { VoidDeleteGesture } from '../../src/components/ui/VoidDeleteGesture';
import { ConfettiEffect } from '../../src/components/ui/ConfettiEffect';
import { GlobalSearch } from '../../src/components/ui/GlobalSearch';
import { AdvancedSearchBottomSheet } from '../../src/components/ui/AdvancedSearchBottomSheet';

import { AccessGuard as __AccessGuard__ } from '../../src/components/AccessGuard';
const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

// Management Grid Icons - RTL Order (Right to Left per row)
const MANAGEMENT_ICONS_ROW1 = [
  { id: 'customers', icon: 'people', label: 'Customers', labelAr: 'العملاء', color: '#3B82F6', route: '/owner/customers' },
  { id: 'admins', icon: 'shield-checkmark', label: 'Admins', labelAr: 'المسؤولين', color: '#10B981', route: '/owner/admins' },
  { id: 'suppliers', icon: 'briefcase', label: 'Suppliers', labelAr: 'الموردون', color: '#14B8A6', route: '/owner/suppliers' },
  { id: 'distributors', icon: 'car', label: 'Distributors', labelAr: 'الموزعون', color: '#EF4444', route: '/owner/distributors' },
];

const MANAGEMENT_ICONS_ROW2 = [
  { id: 'analytics', icon: 'bar-chart', label: 'Analytics', labelAr: 'التحليلات', color: '#EC4899', route: '/owner/analytics' },
  { id: 'collection', icon: 'cube', label: 'Collection', labelAr: 'المجموعة', color: '#F59E0B', route: '/owner/collection' },
  { id: 'subscriptions', icon: 'card', label: 'Subscriptions', labelAr: 'الاشتراكات', color: '#8B5CF6', route: '/owner/subscriptions' },
  { id: 'new-entity', icon: 'add-circle', label: 'New Entity', labelAr: 'جهة جديدة', color: '#10B981', route: '/owner/new-entity-dashboard' },
];

const MANAGEMENT_ICONS_ROW3 = [
  { id: 'knowledge-base', icon: 'library', label: 'Train AI Agent', labelAr: 'تدريب المساعد الذكي', color: '#7C3AED', route: '/owner/knowledge-base' },
  { id: 'orders', icon: 'receipt', label: 'Orders', labelAr: 'الطلبات', color: '#0EA5E9', route: '/owner/orders' },
  { id: 'settings', icon: 'settings', label: 'Settings', labelAr: 'الإعدادات', color: '#64748B', route: '/owner/settings' },
];

const MANAGEMENT_ICONS_ROW4 = [
  { id: 'restaurant-analytics', icon: 'storefront', label: 'Restaurant Hub', labelAr: 'مركز المطاعم', color: '#FF6B35', route: '/owner/restaurant-analytics' },
  { id: 'notification-log', icon: 'notifications', label: 'Alert History', labelAr: 'سجل التنبيهات', color: '#6366F1', route: '/owner/notification-log' },
  { id: 'cleanup-history', icon: 'trash-bin', label: 'Cleanup History', labelAr: 'سجل التنظيف', color: '#7C3AED', route: '/owner/cleanup-history' },
];


function OwnerDashboard() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const storedMood = useColorMood();
  const language = useAppStore((state) => state.language);
  const user = useAppStore((state) => state.user);
  const orders = useAppStore((state) => state.orders) || [];
  const customers = useAppStore((state) => state.customers) || [];
  const products = useAppStore((state) => state.products) || [];
  const setOrderFilter = useAppStore((state) => (state as any).setOrderFilter) as ((filter: any) => void) | undefined;
  const setGlobalPartners = useAppStore((state) => state.setPartners);
  const lastViewedPushLogAtByUser = useAppStore((state) => state.lastViewedPushLogAtByUser);
  const lastViewedPushLogAt = user?.id ? (lastViewedPushLogAtByUser[user.id] ?? null) : null;
  const setLastViewedPushLogAt = useAppStore((state) => state.setLastViewedPushLogAt);
  
  // Store setters for global search data
  const setSuppliers = useAppStore((state) => state.setSuppliers);
  const setDistributors = useAppStore((state) => state.setDistributors);
  const setCustomers = useAppStore((state) => state.setCustomers);
  const setAdmins = useAppStore((state) => state.setAdmins);

  // Partner management state
  const [showPartnersModal, setShowPartnersModal] = useState(false);
  const [showAddPartnerModal, setShowAddPartnerModal] = useState(false);
  const [showGlobalSearch, setShowGlobalSearch] = useState(false);
  const [showAdvancedSearch, setShowAdvancedSearch] = useState(false);
  const [partners, setPartners] = useState<any[]>([]);
  const [pendingPartners, setPendingPartners] = useState<any[]>([]);
  const [partnerEmail, setPartnerEmail] = useState('');
  const [addingPartner, setAddingPartner] = useState(false);
  const [addSuccess, setAddSuccess] = useState(false);
  const [partnerError, setPartnerError] = useState('');
  const [loadingPartners, setLoadingPartners] = useState(false);
  const [showConfetti, setShowConfetti] = useState(false);
  
  // Drag to delete state
  const [deletingPartner, setDeletingPartner] = useState<any>(null);
  const [showTrashZone, setShowTrashZone] = useState(false);
  const trashOpacity = useRef(new Animated.Value(0)).current;
  const dragPosition = useRef(new Animated.ValueXY()).current;

  // Long press gesture state for Partners icon
  const partnersLongPressTimer = useRef<any>(null);
  const [isLongPressing, setIsLongPressing] = useState(false);

  // Unread push-log count for the Alert History badge
  const queryClient = useQueryClient();
  const { data: pushLogUnreadData, isError: pushLogUnreadIsError } = useQuery({
    queryKey: ['push-log-unread-count', user?.id, lastViewedPushLogAt],
    queryFn: () => pushLogApi.getUnreadCount({ since: lastViewedPushLogAt }).then(r => r.data),
    staleTime: 60_000,
    refetchInterval: 60_000,
    refetchIntervalInBackground: true,
    retry: 1,
    retryDelay: 10_000,
  });
  const pushLogUnreadCount = pushLogUnreadData?.count ?? 0;

  // Animated values for the Alert History icon pulse/glow effect
  const alertPulseScale = useRef(new Animated.Value(1)).current;
  const alertPulseGlow = useRef(new Animated.Value(0)).current;

  // Bump the badge in real time when a new alert arrives via WebSocket.
  // new_order and low_stock_alert/out_of_stock events all generate push-log rows.
  useWebSocketEvent(
    ['new_order', 'order_created', 'low_stock_alert', 'out_of_stock'],
    () => {
      queryClient.invalidateQueries({ queryKey: ['push-log-unread-count'], exact: false });

      // Brief scale + glow pulse on the Alert History icon so owners notice instantly
      alertPulseScale.setValue(1);
      alertPulseGlow.setValue(0);
      Animated.sequence([
        Animated.parallel([
          Animated.spring(alertPulseScale, { toValue: 1.18, useNativeDriver: true, friction: 4, tension: 200 }),
          Animated.timing(alertPulseGlow, { toValue: 1, duration: 200, useNativeDriver: true }),
        ]),
        Animated.delay(500),
        Animated.parallel([
          Animated.spring(alertPulseScale, { toValue: 1, useNativeDriver: true, friction: 6, tension: 120 }),
          Animated.timing(alertPulseGlow, { toValue: 0, duration: 300, useNativeDriver: true }),
        ]),
      ]).start();
    },
  );

  // Auto-refresh interval
  const refreshIntervalRef = useRef<any>(null);

  // Default mood fallback
  const defaultMood = {
    primary: '#3B82F6',
    background: '#F0F9FF',
    surface: '#FFFFFF',
    text: '#1E3A5F',
    textSecondary: '#64748B',
    border: '#E2E8F0',
    success: '#10B981',
    warning: '#F59E0B',
    error: '#EF4444',
    card: '#FFFFFF',
    tabBar: '#FFFFFF',
    tabBarActive: '#3B82F6',
    tabBarInactive: '#9CA3AF',
    gradient: ['#1E1E3F', '#2D2D5F', '#3D3D7F'],
  };

  const mood = storedMood || defaultMood;
  const gradientColors = (mood as any).gradient && Array.isArray((mood as any).gradient) && (mood as any).gradient.length >= 3
    ? (mood as any).gradient
    : ['#1E1E3F', '#2D2D5F', '#3D3D7F'];

  // Connect WebSocket for real-time updates
  useWebSocket();

  // Calculate live metrics from store - ensure arrays are safe
  const safeOrders = Array.isArray(orders) ? orders : [];
  const safeCustomers = Array.isArray(customers) ? customers : [];
  const safeProducts = Array.isArray(products) ? products : [];
  
  const metrics = {
    todayOrders: safeOrders.filter((o: any) => {
      const today = new Date().toDateString();
      return new Date(o.created_at).toDateString() === today;
    }).length,
    pendingOrders: safeOrders.filter((o: any) => o.status === 'pending').length,
    totalRevenue: safeOrders.reduce((sum: number, o: any) => sum + (o.total || 0), 0),
    activeCustomers: safeCustomers.length,
    totalProducts: safeProducts.length,
    lowStock: safeProducts.filter((p: any) => (p.quantity || p.stock_quantity || 0) < 10).length,
  };

  const isRTL = language === 'ar';

  // Define fetchPartners first before using it in useEffect
  const fetchPartners = useCallback(async () => {
    setLoadingPartners(true);
    try {
      const response = await partnerApi.getAll();
      const partnersList = response.data || [];
      setPartners(partnersList);
      setPendingPartners([]); // No pending section needed
      
      // Update global store so footer can recognize partners
      setGlobalPartners(partnersList);
    } catch (error) {
      console.error('Error fetching partners:', error);
    } finally {
      setLoadingPartners(false);
    }
  }, [setGlobalPartners]);

  // Fetch all data for global search
  const fetchAllDataForSearch = useCallback(async () => {
    try {
      // Fetch suppliers
      const suppliersRes = await supplierApi.getAll();
      if (suppliersRes.data) setSuppliers(suppliersRes.data);
      
      // Fetch distributors
      const distributorsRes = await distributorApi.getAll();
      if (distributorsRes.data) setDistributors(distributorsRes.data);
      
      // Fetch customers
      const customersRes = await customerApi.getAll();
      if (customersRes.data) setCustomers(customersRes.data);
      
      // Fetch admins
      const adminsRes = await adminApi.getAll();
      if (adminsRes.data) setAdmins(adminsRes.data);
      
      console.log('All data fetched for global search');
    } catch (error) {
      console.error('Error fetching data for search:', error);
    }
  }, [setSuppliers, setDistributors, setCustomers, setAdmins]);

  // Fetch partners on mount and set up auto-refresh
  useEffect(() => {
    fetchPartners();
    fetchAllDataForSearch(); // جلب جميع البيانات للبحث الشامل
    
    // Cleanup on unmount
    return () => {
      if (refreshIntervalRef.current) {
        clearInterval(refreshIntervalRef.current);
      }
    };
  }, [fetchPartners, fetchAllDataForSearch]);

  // Start/stop auto-refresh when partners modal visibility changes
  useEffect(() => {
    if (showPartnersModal) {
      refreshIntervalRef.current = setInterval(fetchPartners, 30000);
    } else {
      if (refreshIntervalRef.current) {
        clearInterval(refreshIntervalRef.current);
      }
    }
  }, [showPartnersModal, fetchPartners]);

  const handleIconPress = (route: string) => {
    haptic.tap();
    if (route === '/owner/notification-log' && user?.id) {
      const now = new Date().toISOString();
      setLastViewedPushLogAt(user.id, now);
      queryClient.setQueryData(['push-log-unread-count', now], { count: 0 });
      queryClient.invalidateQueries({ queryKey: ['push-log-unread-count'], exact: false });
    }
    router.push(route as any);
  };

  const handleMetricPress = (metricType: string) => {
    haptic.select();
    
    switch (metricType) {
      case 'todayOrders':
        setOrderFilter?.({ type: 'today' });
        router.push('/owner/orders?filter=today' as any);
        break;
      case 'pendingOrders':
        setOrderFilter?.({ status: 'pending' });
        router.push('/owner/orders?filter=pending' as any);
        break;
      case 'totalRevenue':
        router.push('/owner/analytics' as any);
        break;
      case 'activeCustomers':
        router.push('/owner/customers' as any);
        break;
      case 'totalProducts':
        router.push('/admin/products' as any);
        break;
      case 'lowStock':
        setOrderFilter?.({ type: 'lowStock' });
        router.push('/admin/products?filter=lowstock' as any);
        break;
      default:
        break;
    }
  };

  // Partners icon handlers
  const handlePartnersTap = () => {
    haptic.menu();
    setShowPartnersModal(true);
  };

  const handlePartnersLongPressStart = () => {
    partnersLongPressTimer.current = setTimeout(() => {
      setIsLongPressing(true);
      haptic.longPress();
    }, 500);
  };

  const handlePartnersLongPressEnd = () => {
    if (partnersLongPressTimer.current) {
      clearTimeout(partnersLongPressTimer.current);
    }
    if (isLongPressing) {
      // Long press + release = open add partner modal
      setIsLongPressing(false);
      setShowAddPartnerModal(true);
    }
  };

  const handleAddPartner = async () => {
    if (!partnerEmail.trim()) {
      setPartnerError(language === 'ar' ? 'يرجى إدخال البريد الإلكتروني' : 'Please enter an email');
      return;
    }

    // Basic email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(partnerEmail.trim())) {
      setPartnerError(language === 'ar' ? 'بريد إلكتروني غير صالح' : 'Invalid email format');
      return;
    }

    setAddingPartner(true);
    setPartnerError('');

    try {
      await partnerApi.create({ email: partnerEmail.trim().toLowerCase(), name: partnerEmail.split('@')[0] });
      
      setAddSuccess(true);
      haptic.success();
      setShowConfetti(true);
      
      setTimeout(() => {
        setShowAddPartnerModal(false);
        setPartnerEmail('');
        setAddSuccess(false);
        setShowConfetti(false);
        fetchPartners();
      }, 1500);
    } catch (error: any) {
      setPartnerError(error.response?.data?.detail || (language === 'ar' ? 'فشل في إضافة الشريك' : 'Failed to add partner'));
      haptic.error();
    } finally {
      setAddingPartner(false);
    }
  };

  const handleDeletePartner = async (partner: any) => {
    try {
      await partnerApi.delete(partner.id);
      haptic.delete();
      fetchPartners();
    } catch (error) {
      console.error('Error deleting partner:', error);
      haptic.error();
    }
  };

  // Start drag to delete
  const startDragDelete = (partner: any) => {
    if (partner.role === 'owner') return; // Can't delete owner
    
    Vibration.vibrate(100);
    setDeletingPartner(partner);
    setShowTrashZone(true);
    
    Animated.timing(trashOpacity, {
      toValue: 1,
      duration: 300,
      useNativeDriver: true,
    }).start();
  };

  // End drag
  const endDrag = (inTrashZone: boolean) => {
    if (inTrashZone && deletingPartner) {
      handleDeletePartner(deletingPartner);
    }
    
    Animated.timing(trashOpacity, {
      toValue: 0,
      duration: 200,
      useNativeDriver: true,
    }).start(() => {
      setShowTrashZone(false);
      setDeletingPartner(null);
      dragPosition.setValue({ x: 0, y: 0 });
    });
  };

  // Render icon row with RTL support
  // badgeCounts: optional map of icon id → badge count (shows red circle when > 0)
  // staleBadgeIds: optional set of icon ids whose badge should appear dimmed (server unreachable)
  // pulseAnims: optional per-icon scale + glow animated values for flash effect
  const renderIconRow = (
    icons: typeof MANAGEMENT_ICONS_ROW1,
    badgeCounts?: Record<string, number>,
    staleBadgeIds?: Set<string>,
    pulseAnims?: Record<string, { scale: Animated.Value; glow: Animated.Value }>,
  ) => {
    const orderedIcons = isRTL ? [...icons].reverse() : icons;
    
    return (
      <View style={[styles.iconRow, isRTL && styles.iconRowRTL]}>
        {orderedIcons.map((item) => {
          const badge = badgeCounts?.[item.id] ?? 0;
          const badgeIsStale = staleBadgeIds?.has(item.id) ?? false;
          const anim = pulseAnims?.[item.id];
          return (
            <Animated.View
              key={item.id}
              style={[
                styles.iconCard,
                anim && { transform: [{ scale: anim.scale }] },
              ]}
            >
              <TouchableOpacity
                style={{ flex: 1 }}
                onPress={() => handleIconPress(item.route)}
                activeOpacity={0.7}
              >
                <BlurView intensity={20} tint="light" style={styles.iconBlur}>
                  <View style={{ position: 'relative' }}>
                    <View style={[styles.iconCircle, { backgroundColor: item.color + '30' }]}>
                      <Ionicons name={item.icon as any} size={28} color={item.color} />
                    </View>
                    {anim && (
                      <Animated.View
                        style={{
                          position: 'absolute',
                          top: 0,
                          left: 0,
                          width: 48,
                          height: 48,
                          borderRadius: 24,
                          backgroundColor: item.color + '70',
                          opacity: anim.glow,
                        }}
                        pointerEvents="none"
                      />
                    )}
                    {badge > 0 && (
                      <View style={[styles.badgeCircle, badgeIsStale && { opacity: 0.45 }]}>
                        <Text style={styles.badgeText}>
                          {badge > 99 ? '99+' : String(badge)}
                        </Text>
                      </View>
                    )}
                  </View>
                  <Text style={styles.iconLabel}>
                    {isRTL ? item.labelAr : item.label}
                  </Text>
                </BlurView>
              </TouchableOpacity>
            </Animated.View>
          );
        })}
      </View>
    );
  };

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" />
      
      {/* Gradient Background */}
      <LinearGradient
        colors={gradientColors as [string, string, string]}
        style={StyleSheet.absoluteFill}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
      />

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={[styles.scrollContent, { paddingTop: insets.top, paddingBottom: insets.bottom + 24 }]}
        showsVerticalScrollIndicator={false}
        overScrollMode="never"
        bounces={false}
      >
        {/* Header */}
        <View style={[styles.header, isRTL && styles.headerRTL]}>
          <TouchableOpacity
            style={styles.backButton}
            onPress={() => router.back()}
          >
            <Ionicons
              name={isRTL ? 'arrow-forward' : 'arrow-back'}
              size={24}
              color="#FFFFFF"
            />
          </TouchableOpacity>

          <View style={[styles.headerTitleContainer, isRTL && styles.headerTitleContainerRTL]}>
            <Text style={[styles.headerTitle, isRTL && styles.textRTL]}>
              {language === 'ar' ? 'لوحة التحكم' : 'Owner Dashboard'}
            </Text>
            <Text style={[styles.headerSubtitle, isRTL && styles.textRTL]}>
              {user?.name || user?.email}
            </Text>
          </View>

          {/* Search & Partners Icons */}
          <View style={styles.headerActionsContainer}>
            {/* Home Navigation Icon */}
            <TouchableOpacity
              style={styles.headerActionButton}
              onPress={() => {
                haptic.tap();
                router.push('/');
              }}
              activeOpacity={0.7}
            >
              <View style={styles.headerActionIconBg}>
                <Ionicons name="home" size={20} color="#FFF" />
              </View>
              <Text style={styles.headerActionText}>
                {language === 'ar' ? 'الرئيسية' : 'Home'}
              </Text>
            </TouchableOpacity>

            {/* Admin Panel Navigation Icon */}
            <TouchableOpacity
              style={styles.headerActionButton}
              onPress={() => {
                haptic.tap();
                router.push('/admin');
              }}
              activeOpacity={0.7}
            >
              <View style={[styles.headerActionIconBg, { backgroundColor: 'rgba(139, 92, 246, 0.3)' }]}>
                <Ionicons name="settings" size={20} color="#A78BFA" />
              </View>
              <Text style={styles.headerActionText}>
                {language === 'ar' ? 'الإدارة' : 'Admin'}
              </Text>
            </TouchableOpacity>

            {/* Global Search Icon */}
            <TouchableOpacity
              style={styles.headerActionButton}
              onPress={() => {
                haptic.tap();
                setShowGlobalSearch(true);
              }}
              activeOpacity={0.7}
            >
              <View style={[styles.headerActionIconBg, { backgroundColor: 'rgba(59, 130, 246, 0.3)' }]}>
                <Ionicons name="search" size={20} color="#60A5FA" />
              </View>
              <Text style={styles.headerActionText}>
                {language === 'ar' ? 'بحث' : 'Search'}
              </Text>
            </TouchableOpacity>

            {/* Partners Icon */}
            <TouchableOpacity
              style={styles.headerActionButton}
              onPress={handlePartnersTap}
              onPressIn={handlePartnersLongPressStart}
              onPressOut={handlePartnersLongPressEnd}
              activeOpacity={0.7}
            >
              <View style={[styles.headerActionIconBg, { backgroundColor: 'rgba(16, 185, 129, 0.3)' }]}>
                <Ionicons name="people" size={20} color="#34D399" />
              </View>
              <Text style={styles.headerActionText}>
                {language === 'ar' ? 'الشركاء' : 'Partners'}
              </Text>
            </TouchableOpacity>
          </View>

          <SyncIndicator compact />
        </View>

        {/* Management Grid */}
        <View style={styles.gridContainer}>
          <Text style={[styles.sectionTitle, isRTL && styles.textRTL]}>
            {language === 'ar' ? 'الإدارة' : 'Management'}
          </Text>
          
          <View style={styles.iconGrid}>
            {renderIconRow(MANAGEMENT_ICONS_ROW1)}
            {renderIconRow(MANAGEMENT_ICONS_ROW2)}
            {renderIconRow(MANAGEMENT_ICONS_ROW3)}
            {renderIconRow(
              MANAGEMENT_ICONS_ROW4,
              { 'notification-log': pushLogUnreadCount },
              pushLogUnreadIsError && pushLogUnreadCount > 0 ? new Set(['notification-log']) : undefined,
              { 'notification-log': { scale: alertPulseScale, glow: alertPulseGlow } },
            )}
          </View>
        </View>

        {/* Live Metrics Panel */}
        <View style={styles.metricsContainer}>
          <Text style={[styles.sectionTitle, isRTL && styles.textRTL]}>
            {language === 'ar' ? 'المقاييس الحية' : 'Live Metrics'}
          </Text>
          <Text style={[styles.sectionSubtitle, isRTL && styles.textRTL]}>
            {language === 'ar' ? 'اضغط للتفاصيل' : 'Tap for details'}
          </Text>

          {/* Metrics Row 1 (RTL: Products, Low Stock, Revenue) */}
          <View style={[styles.metricsRow, isRTL && styles.metricsRowRTL]}>
            <MetricCard
              icon="cube"
              label={language === 'ar' ? 'المنتجات' : 'Products'}
              value={metrics.totalProducts}
              color="#EC4899"
              onPress={() => handleMetricPress('totalProducts')}
            />
            <MetricCard
              icon="alert"
              label={language === 'ar' ? 'مخزون منخفض' : 'Low Stock'}
              value={metrics.lowStock}
              color="#EF4444"
              pulse={metrics.lowStock > 0}
              onPress={() => handleMetricPress('lowStock')}
            />
            <MetricCard
              icon="cash"
              label={language === 'ar' ? 'الإيرادات' : 'Revenue'}
              value={`${(metrics.totalRevenue / 1000).toFixed(1)}K`}
              color="#10B981"
              onPress={() => handleMetricPress('totalRevenue')}
            />
          </View>

          {/* Metrics Row 2 (RTL: Customers, Today's Orders, Pending) */}
          <View style={[styles.metricsRow, isRTL && styles.metricsRowRTL, { marginTop: 12 }]}>
            <MetricCard
              icon="people"
              label={language === 'ar' ? 'العملاء' : 'Customers'}
              value={metrics.activeCustomers}
              color="#8B5CF6"
              onPress={() => handleMetricPress('activeCustomers')}
            />
            <MetricCard
              icon="receipt"
              label={language === 'ar' ? 'طلبات اليوم' : "Today's Orders"}
              value={metrics.todayOrders}
              color="#3B82F6"
              onPress={() => handleMetricPress('todayOrders')}
            />
            <MetricCard
              icon="time"
              label={language === 'ar' ? 'قيد الانتظار' : 'Pending'}
              value={metrics.pendingOrders}
              color="#F59E0B"
              pulse={metrics.pendingOrders > 0}
              onPress={() => handleMetricPress('pendingOrders')}
            />
          </View>
        </View>

        {/* Quick Stats */}
        <View style={styles.quickStatsContainer}>
          <Text style={[styles.sectionTitle, isRTL && styles.textRTL]}>
            {language === 'ar' ? 'إحصائيات سريعة' : 'Quick Stats'}
          </Text>
          
          <View style={[styles.quickStatsRow, isRTL && styles.quickStatsRowRTL]}>
            <View style={styles.quickStatCard}>
              <BlurView intensity={15} tint="light" style={styles.quickStatBlur}>
                <Text style={styles.quickStatValue}>
                  {(Array.isArray(orders) ? orders : []).filter((o: any) => o.status === 'delivered').length}
                </Text>
                <Text style={styles.quickStatLabel}>
                  {language === 'ar' ? 'تم التسليم' : 'Delivered'}
                </Text>
              </BlurView>
            </View>
            <View style={styles.quickStatCard}>
              <BlurView intensity={15} tint="light" style={styles.quickStatBlur}>
                <Text style={styles.quickStatValue}>
                  {(Array.isArray(orders) ? orders : []).filter((o: any) => o.status === 'shipped').length}
                </Text>
                <Text style={styles.quickStatLabel}>
                  {language === 'ar' ? 'قيد الشحن' : 'Shipped'}
                </Text>
              </BlurView>
            </View>
            <View style={styles.quickStatCard}>
              <BlurView intensity={15} tint="light" style={styles.quickStatBlur}>
                <Text style={styles.quickStatValue}>
                  {(Array.isArray(orders) ? orders : []).filter((o: any) => o.status === 'cancelled').length}
                </Text>
                <Text style={styles.quickStatLabel}>
                  {language === 'ar' ? 'ملغي' : 'Cancelled'}
                </Text>
              </BlurView>
            </View>
          </View>
        </View>

        {/* Footer with Navigation */}
        <View style={styles.footer}>
          <View style={styles.footerNav}>
            {/* Advanced Search */}
            <TouchableOpacity
              style={styles.footerNavItem}
              onPress={() => {
                haptic.tap();
                setShowAdvancedSearch(true);
              }}
              activeOpacity={0.7}
            >
              <View style={[styles.footerNavIcon, { backgroundColor: 'rgba(20, 184, 166, 0.2)' }]}>
                <Ionicons name="options" size={22} color="#2DD4BF" />
              </View>
              <Text style={styles.footerNavText}>
                {language === 'ar' ? 'بحث متقدم' : 'Adv. Search'}
              </Text>
            </TouchableOpacity>

            {/* Home */}
            <TouchableOpacity
              style={styles.footerNavItem}
              onPress={() => {
                haptic.tap();
                router.push('/');
              }}
              activeOpacity={0.7}
            >
              <View style={[styles.footerNavIcon, { backgroundColor: 'rgba(59, 130, 246, 0.2)' }]}>
                <Ionicons name="home" size={22} color="#60A5FA" />
              </View>
              <Text style={styles.footerNavText}>
                {language === 'ar' ? 'الرئيسية' : 'Home'}
              </Text>
            </TouchableOpacity>

            {/* Global Search */}
            <TouchableOpacity
              style={styles.footerNavItem}
              onPress={() => {
                haptic.tap();
                setShowGlobalSearch(true);
              }}
              activeOpacity={0.7}
            >
              <View style={[styles.footerNavIcon, { backgroundColor: 'rgba(236, 72, 153, 0.2)' }]}>
                <Ionicons name="search" size={22} color="#F472B6" />
              </View>
              <Text style={styles.footerNavText}>
                {language === 'ar' ? 'بحث شامل' : 'Search'}
              </Text>
            </TouchableOpacity>

            {/* Admin Panel */}
            <TouchableOpacity
              style={styles.footerNavItem}
              onPress={() => {
                haptic.tap();
                router.push('/admin');
              }}
              activeOpacity={0.7}
            >
              <View style={[styles.footerNavIcon, { backgroundColor: 'rgba(139, 92, 246, 0.2)' }]}>
                <Ionicons name="settings" size={22} color="#A78BFA" />
              </View>
              <Text style={styles.footerNavText}>
                {language === 'ar' ? 'لوحة التحكم' : 'Admin'}
              </Text>
            </TouchableOpacity>

            {/* Product Search */}
            <TouchableOpacity
              style={styles.footerNavItem}
              onPress={() => {
                haptic.tap();
                router.push('/search');
              }}
              activeOpacity={0.7}
            >
              <View style={[styles.footerNavIcon, { backgroundColor: 'rgba(249, 115, 22, 0.2)' }]}>
                <Ionicons name="search-circle" size={22} color="#FB923C" />
              </View>
              <Text style={styles.footerNavText}>
                {language === 'ar' ? 'بحث المنتجات' : 'Products'}
              </Text>
            </TouchableOpacity>
          </View>

          <View style={styles.footerBrand}>
            <Text style={styles.footerText}>
              {language === 'ar' ? 'مطعم الغزالي' : 'Al-Ghazaly Dining'}
            </Text>
            <Text style={styles.footerVersion}>v2.0 - Owner Edition</Text>
          </View>
        </View>

        {/* Bottom padding */}
        <View style={{ height: insets.bottom + 40 }} />
      </ScrollView>

      {/* Partners List Modal */}
      <Modal
        visible={showPartnersModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowPartnersModal(false)}
      >
        <View style={styles.modalOverlay}>
          <BlurView intensity={80} tint="dark" style={StyleSheet.absoluteFill} />
          
          {/* Trash Zone (appears when dragging) */}
          {showTrashZone && (
            <Animated.View style={[styles.trashZone, { opacity: trashOpacity }]}>
              <Ionicons name="trash" size={40} color="#EF4444" />
              <Text style={styles.trashZoneText}>
                {language === 'ar' ? 'اسحب هنا للحذف' : 'Drop here to delete'}
              </Text>
            </Animated.View>
          )}

          <View style={[styles.partnersModal, { marginTop: insets.top + 60 }]}>
            {/* Modal Header */}
            <View style={[styles.partnersModalHeader, isRTL && styles.partnersModalHeaderRTL]}>
              <Text style={styles.partnersModalTitle}>
                {language === 'ar' ? 'الشركاء والمالك' : 'Partners & Owner'}
              </Text>
              <TouchableOpacity
                style={styles.modalCloseBtn}
                onPress={() => setShowPartnersModal(false)}
              >
                <Ionicons name="close" size={24} color="#FFF" />
              </TouchableOpacity>
            </View>

            {/* Hint Text */}
            <Text style={styles.partnersHint}>
              {language === 'ar' 
                ? 'اضغط مطولاً ثم اسحب للحذف' 
                : 'Long press and drag to delete'}
            </Text>

            {/* Partners List */}
            <ScrollView style={styles.partnersList}>
              {loadingPartners ? (
                <ActivityIndicator size="large" color="#3B82F6" />
              ) : partners.length === 0 ? (
                <Text style={styles.noPartnersText}>
                  {language === 'ar' ? 'لا يوجد شركاء' : 'No partners yet'}
                </Text>
              ) : (
                partners.map((partner) => (
                  <TouchableOpacity
                    key={partner.id}
                    style={[
                      styles.partnerItem,
                      partner.role === 'owner' && styles.partnerItemOwner,
                      deletingPartner?.id === partner.id && styles.partnerItemDragging,
                    ]}
                    onLongPress={() => startDragDelete(partner)}
                    delayLongPress={500}
                    activeOpacity={0.8}
                  >
                    <View style={[styles.partnerAvatar, { backgroundColor: partner.role === 'owner' ? '#F59E0B' : '#3B82F6' }]}>
                      <Ionicons 
                        name={partner.role === 'owner' ? 'star' : 'person'} 
                        size={20} 
                        color="#FFF" 
                      />
                    </View>
                    <View style={styles.partnerInfo}>
                      <Text style={styles.partnerEmail}>{partner.email}</Text>
                      <Text style={styles.partnerRole}>
                        {partner.role === 'owner' 
                          ? (language === 'ar' ? 'المالك' : 'Owner')
                          : (language === 'ar' ? 'شريك' : 'Partner')
                        }
                      </Text>
                    </View>
                    {partner.role !== 'owner' && (
                      <TouchableOpacity
                        style={styles.partnerDeleteBtn}
                        onPress={() => handleDeletePartner(partner)}
                      >
                        <Ionicons name="trash-outline" size={18} color="#EF4444" />
                      </TouchableOpacity>
                    )}
                  </TouchableOpacity>
                ))
              )}
            </ScrollView>

            {/* Add Partner Button */}
            <TouchableOpacity
              style={styles.addPartnerBtn}
              onPress={() => {
                setShowPartnersModal(false);
                setTimeout(() => setShowAddPartnerModal(true), 300);
              }}
            >
              <Ionicons name="add-circle" size={20} color="#FFF" />
              <Text style={styles.addPartnerBtnText}>
                {language === 'ar' ? 'إضافة شريك جديد' : 'Add New Partner'}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Add Partner Modal */}
      <Modal
        visible={showAddPartnerModal}
        transparent
        animationType="fade"
        onRequestClose={() => {
          setShowAddPartnerModal(false);
          setPartnerEmail('');
          setPartnerError('');
          setAddSuccess(false);
        }}
      >
        <View style={styles.modalOverlay}>
          <BlurView intensity={100} tint="dark" style={StyleSheet.absoluteFill} />
          
          <View style={styles.addPartnerModal}>
            {addSuccess ? (
              /* Success Animation */
              <View style={styles.successContainer}>
                <View style={styles.successCircle}>
                  <Ionicons name="checkmark" size={60} color="#10B981" />
                </View>
                <Text style={styles.successText}>
                  {language === 'ar' ? 'تمت الإضافة بنجاح!' : 'Partner Added!'}
                </Text>
              </View>
            ) : (
              <>
                {/* Modal Header */}
                <View style={styles.addPartnerHeader}>
                  <Text style={styles.addPartnerTitle}>
                    {language === 'ar' ? 'إضافة شريك جديد' : 'Add New Partner'}
                  </Text>
                  <TouchableOpacity
                    style={styles.modalCloseBtn}
                    onPress={() => {
                      setShowAddPartnerModal(false);
                      setPartnerEmail('');
                      setPartnerError('');
                    }}
                  >
                    <Ionicons name="close" size={24} color="#FFF" />
                  </TouchableOpacity>
                </View>

                {/* Email Input */}
                <View style={styles.emailInputContainer}>
                  <Ionicons name="mail-outline" size={22} color="rgba(255,255,255,0.6)" />
                  <TextInput
                    style={styles.emailInput}
                    value={partnerEmail}
                    onChangeText={setPartnerEmail}
                    placeholder={language === 'ar' ? 'البريد الإلكتروني للشريك' : "Partner's email address"}
                    placeholderTextColor="rgba(255,255,255,0.4)"
                    keyboardType="email-address"
                    autoCapitalize="none"
                    autoCorrect={false}
                  />
                </View>

                {/* Error Message */}
                {partnerError ? (
                  <Text style={styles.errorText}>{partnerError}</Text>
                ) : null}

                {/* Add Button */}
                <TouchableOpacity
                  style={[styles.confirmAddBtn, addingPartner && styles.confirmAddBtnDisabled]}
                  onPress={handleAddPartner}
                  disabled={addingPartner}
                >
                  {addingPartner ? (
                    <ActivityIndicator color="#FFF" />
                  ) : (
                    <>
                      <Ionicons name="person-add" size={20} color="#FFF" />
                      <Text style={styles.confirmAddBtnText}>
                        {language === 'ar' ? 'إضافة الشريك' : 'Add Partner'}
                      </Text>
                    </>
                  )}
                </TouchableOpacity>
              </>
            )}
          </View>
        </View>
      </Modal>

      {/* Confetti Effect for successful partner addition */}
      <ConfettiEffect active={showConfetti} onComplete={() => setShowConfetti(false)} />

      {/* Global Search Modal */}
      <GlobalSearch 
        visible={showGlobalSearch} 
        onClose={() => setShowGlobalSearch(false)} 
      />

      {/* Advanced Search Bottom Sheet */}
      <AdvancedSearchBottomSheet 
        visible={showAdvancedSearch} 
        onClose={() => setShowAdvancedSearch(false)} 
      />
    </View>
  );
}

// Metric Card Component
interface MetricCardProps {
  icon: string;
  label: string;
  value: number | string;
  color: string;
  pulse?: boolean;
  onPress?: () => void;
}

const MetricCard: React.FC<MetricCardProps> = ({ icon, label, value, color, pulse, onPress }) => {
  return (
    <TouchableOpacity style={styles.metricCard} onPress={onPress} activeOpacity={0.7}>
      <BlurView intensity={15} tint="light" style={styles.metricBlur}>
        <View style={[styles.metricIconContainer, { backgroundColor: color + '20' }]}>
          <Ionicons name={icon as any} size={20} color={color} />
          {pulse && <View style={[styles.pulseDot, { backgroundColor: color }]} />}
        </View>
        <Text style={styles.metricValue}>{value}</Text>
        <Text style={styles.metricLabel}>{label}</Text>
        <View style={styles.metricArrow}>
          <Ionicons name="chevron-forward" size={14} color="rgba(255,255,255,0.4)" />
        </View>
      </BlurView>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1E1E3F',
  },
  scrollView: {
    flex: 1,
    backgroundColor: '#1E1E3F',
  },
  scrollContent: {
    paddingHorizontal: 16,
    backgroundColor: '#1E1E3F',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 16,
    gap: 12,
  },
  headerRTL: {
    flexDirection: 'row-reverse',
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitleContainer: {
    flex: 1,
  },
  headerTitleContainerRTL: {
    alignItems: 'flex-end',
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  headerSubtitle: {
    fontSize: 14,
    color: 'rgba(255,255,255,0.7)',
    marginTop: 2,
  },
  headerActionsContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  headerActionButton: {
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 50,
  },
  headerActionIconBg: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.15)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  headerActionText: {
    fontSize: 9,
    color: 'rgba(255,255,255,0.7)',
    marginTop: 3,
    fontWeight: '500',
  },
  searchButton: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  partnersButton: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  partnersButtonText: {
    fontSize: 10,
    color: 'rgba(255,255,255,0.7)',
    marginTop: 2,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#FFFFFF',
    marginBottom: 4,
  },
  sectionSubtitle: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.5)',
    marginBottom: 16,
  },
  textRTL: {
    textAlign: 'right',
  },
  gridContainer: {
    marginTop: 24,
  },
  iconGrid: {
    marginTop: 12,
    gap: 12,
  },
  iconRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
  },
  iconRowRTL: {
    flexDirection: 'row-reverse',
  },
  iconCard: {
    flex: 1,
    aspectRatio: 0.85,
    borderRadius: 16,
    overflow: 'hidden',
  },
  iconBlur: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 8,
    backgroundColor: 'rgba(255,255,255,0.1)',
  },
  iconCircle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  iconLabel: {
    fontSize: 11,
    fontWeight: '500',
    color: '#FFFFFF',
    textAlign: 'center',
  },
  badgeCircle: {
    position: 'absolute',
    top: -4,
    right: -4,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: '#EF4444',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.15)',
    zIndex: 1,
  },
  badgeText: {
    fontSize: 9,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  metricsContainer: {
    marginTop: 32,
  },
  metricsRow: {
    flexDirection: 'row',
    gap: 12,
  },
  metricsRowRTL: {
    flexDirection: 'row-reverse',
  },
  metricCard: {
    flex: 1,
    aspectRatio: 1,
    borderRadius: 16,
    overflow: 'hidden',
  },
  metricBlur: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 12,
    backgroundColor: 'rgba(255,255,255,0.1)',
  },
  metricIconContainer: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
    position: 'relative',
  },
  pulseDot: {
    position: 'absolute',
    top: 0,
    right: 0,
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  metricValue: {
    fontSize: 22,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  metricLabel: {
    fontSize: 10,
    color: 'rgba(255,255,255,0.7)',
    textAlign: 'center',
    marginTop: 4,
  },
  metricArrow: {
    position: 'absolute',
    bottom: 8,
    right: 8,
  },
  quickStatsContainer: {
    marginTop: 32,
  },
  quickStatsRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 12,
  },
  quickStatsRowRTL: {
    flexDirection: 'row-reverse',
  },
  quickStatCard: {
    flex: 1,
    borderRadius: 16,
    overflow: 'hidden',
  },
  quickStatBlur: {
    padding: 16,
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.1)',
  },
  quickStatValue: {
    fontSize: 24,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  quickStatLabel: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.7)',
    marginTop: 4,
  },
  footer: {
    marginTop: 40,
    alignItems: 'center',
    paddingVertical: 20,
    paddingHorizontal: 16,
  },
  footerNav: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
    width: '100%',
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: 20,
    paddingVertical: 16,
    paddingHorizontal: 12,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  footerNavItem: {
    alignItems: 'center',
    justifyContent: 'center',
    flex: 1,
    paddingHorizontal: 8,
  },
  footerNavIcon: {
    width: 48,
    height: 48,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 6,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  footerNavText: {
    fontSize: 11,
    fontWeight: '500',
    color: 'rgba(255,255,255,0.7)',
    textAlign: 'center',
  },
  footerBrand: {
    alignItems: 'center',
    paddingTop: 8,
  },
  footerText: {
    fontSize: 14,
    fontWeight: '600',
    color: 'rgba(255,255,255,0.5)',
  },
  footerVersion: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.3)',
    marginTop: 4,
  },
  // Modal Styles
  modalOverlay: {
    flex: 1,
    justifyContent: 'flex-start',
    alignItems: 'center',
  },
  partnersModal: {
    width: SCREEN_WIDTH - 40,
    maxHeight: SCREEN_HEIGHT * 0.6,
    backgroundColor: 'rgba(30, 30, 63, 0.95)',
    borderRadius: 24,
    padding: 20,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  partnersModalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  partnersModalHeaderRTL: {
    flexDirection: 'row-reverse',
  },
  partnersModalTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  modalCloseBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.1)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  partnersHint: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.4)',
    marginBottom: 16,
  },
  partnersList: {
    maxHeight: 300,
  },
  noPartnersText: {
    textAlign: 'center',
    color: 'rgba(255,255,255,0.5)',
    fontSize: 14,
    paddingVertical: 20,
  },
  partnerItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: 12,
    marginBottom: 10,
    gap: 12,
  },
  partnerItemOwner: {
    backgroundColor: 'rgba(245, 158, 11, 0.15)',
    borderWidth: 1,
    borderColor: 'rgba(245, 158, 11, 0.3)',
  },
  partnerItemDragging: {
    opacity: 0.5,
    transform: [{ scale: 1.05 }],
  },
  partnerItemPending: {
    backgroundColor: 'rgba(107, 114, 128, 0.2)',
    borderWidth: 1,
    borderColor: 'rgba(107, 114, 128, 0.3)',
    borderStyle: 'dashed',
  },
  pendingSectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 16,
    marginBottom: 10,
    gap: 8,
  },
  pendingSectionTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: '#F59E0B',
  },
  partnerAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  partnerInfo: {
    flex: 1,
  },
  partnerEmail: {
    fontSize: 14,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  partnerRole: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.5)',
    marginTop: 2,
  },
  partnerDeleteBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  addPartnerBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#3B82F6',
    paddingVertical: 14,
    borderRadius: 12,
    marginTop: 16,
    gap: 8,
  },
  addPartnerBtnText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  // Add Partner Modal
  addPartnerModal: {
    width: SCREEN_WIDTH - 48,
    backgroundColor: 'rgba(30, 30, 63, 0.98)',
    borderRadius: 24,
    padding: 24,
    marginTop: SCREEN_HEIGHT * 0.25,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
  },
  addPartnerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 24,
  },
  addPartnerTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  emailInputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  emailInput: {
    flex: 1,
    fontSize: 16,
    color: '#FFFFFF',
  },
  errorText: {
    color: '#EF4444',
    fontSize: 13,
    marginTop: 10,
  },
  confirmAddBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#10B981',
    paddingVertical: 16,
    borderRadius: 12,
    marginTop: 20,
    gap: 8,
  },
  confirmAddBtnDisabled: {
    opacity: 0.6,
  },
  confirmAddBtnText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  successContainer: {
    alignItems: 'center',
    paddingVertical: 30,
  },
  successCircle: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: 'rgba(16, 185, 129, 0.15)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
    borderWidth: 3,
    borderColor: '#10B981',
  },
  successText: {
    fontSize: 20,
    fontWeight: '700',
    color: '#10B981',
  },
  trashZone: {
    position: 'absolute',
    top: 80,
    alignSelf: 'center',
    backgroundColor: 'rgba(239, 68, 68, 0.2)',
    paddingHorizontal: 40,
    paddingVertical: 20,
    borderRadius: 16,
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#EF4444',
    borderStyle: 'dashed',
  },
  trashZoneText: {
    color: '#EF4444',
    fontSize: 14,
    fontWeight: '600',
    marginTop: 8,
  },
});


/* __ACCESS_GUARD_APPLIED__ */
export default function OwnerDashboardGuarded(props: any) {
  return (
    <__AccessGuard__ scope="owner">
      <OwnerDashboard {...props} />
    </__AccessGuard__>
  );
}
