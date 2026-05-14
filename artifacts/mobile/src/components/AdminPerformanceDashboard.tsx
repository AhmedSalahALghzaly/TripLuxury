/**
 * Admin Performance Dashboard
 * Shows personal metrics, quick stats, and intelligent product management info
 */
import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Dimensions,
  RefreshControl,
} from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useTheme } from '../hooks/useTheme';
import { useTranslation } from '../hooks/useTranslation';
import { useAppStore } from '../store/appStore';
import { analyticsApi, productApi } from '../services/api';

const { width } = Dimensions.get('window');
const CARD_WIDTH = (width - 48) / 2;

interface MetricCard {
  id: string;
  title: string;
  titleAr: string;
  value: string | number;
  change?: number;
  icon: string;
  color: string;
  gradient: string[];
}

interface AdminPerformanceDashboardProps {
  adminId?: string;
  compact?: boolean;
}

export const AdminPerformanceDashboard: React.FC<AdminPerformanceDashboardProps> = ({ 
  adminId, 
  compact = false 
}) => {
  const { colors, isDark } = useTheme();
  const { language, isRTL } = useTranslation();
  const user = useAppStore((state) => state.user);
  
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [metrics, setMetrics] = useState<MetricCard[]>([]);
  const [productStats, setProductStats] = useState<any>({});

  const fetchDashboardData = useCallback(async () => {
    try {
      const [analyticsRes, productsRes] = await Promise.all([
        analyticsApi.getOverview().catch(() => ({ data: {} })),
        productApi.getAll({ limit: 500 }).catch(() => ({ data: { products: [] } })),
      ]);

      const analytics = analyticsRes.data || {};
      const products = productsRes.data?.products || [];

      const totalProducts = analytics.total_products || products.length;
      const lowStockProducts = products.filter((p: any) => p.stock_quantity !== null && p.stock_quantity !== undefined && p.stock_quantity < 10).length;
      const outOfStockProducts = products.filter((p: any) => p.stock_quantity === 0).length;
      const activeProducts = products.filter((p: any) => !p.hidden_status).length;
      const totalOrders = analytics.total_orders || 0;
      const ordersByStatus = analytics.orders_by_status || {};
      const pendingOrders = ordersByStatus['pending'] || 0;
      const totalUsers = analytics.total_users || 0;

      const metricCards: MetricCard[] = [
        {
          id: 'total_products',
          title: 'Total Products',
          titleAr: 'إجمالي المنتجات',
          value: totalProducts,
          icon: 'cube',
          color: '#3B82F6',
          gradient: ['#3B82F6', '#60A5FA'],
        },
        {
          id: 'active_products',
          title: 'Active Products',
          titleAr: 'المنتجات النشطة',
          value: activeProducts,
          change: totalProducts > 0 ? Math.round((activeProducts / totalProducts) * 100) : 0,
          icon: 'checkmark-circle',
          color: '#10B981',
          gradient: ['#10B981', '#34D399'],
        },
        {
          id: 'low_stock',
          title: 'Low Stock',
          titleAr: 'مخزون منخفض',
          value: lowStockProducts,
          icon: 'warning',
          color: '#F59E0B',
          gradient: ['#F59E0B', '#FBBF24'],
        },
        {
          id: 'out_of_stock',
          title: 'Out of Stock',
          titleAr: 'نفذ المخزون',
          value: outOfStockProducts,
          icon: 'alert-circle',
          color: '#EF4444',
          gradient: ['#EF4444', '#F87171'],
        },
        {
          id: 'total_orders',
          title: 'Total Orders',
          titleAr: 'إجمالي الطلبات',
          value: totalOrders,
          icon: 'bag-handle',
          color: '#8B5CF6',
          gradient: ['#8B5CF6', '#A78BFA'],
        },
        {
          id: 'pending_orders',
          title: 'Pending Orders',
          titleAr: 'طلبات معلقة',
          value: pendingOrders,
          icon: 'time',
          color: '#F59E0B',
          gradient: ['#F59E0B', '#FBBF24'],
        },
        {
          id: 'total_users',
          title: 'Registered Users',
          titleAr: 'المستخدمين المسجلين',
          value: totalUsers,
          icon: 'people',
          color: '#3B82F6',
          gradient: ['#3B82F6', '#60A5FA'],
        },
      ];

      setMetrics(metricCards);
      setProductStats({
        total: totalProducts,
        active: activeProducts,
        hidden: totalProducts - activeProducts,
        lowStock: lowStockProducts,
        outOfStock: outOfStockProducts,
      });
    } catch (error) {
      console.error('Error fetching dashboard data:', error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [adminId]);

  useEffect(() => {
    fetchDashboardData();
  }, [fetchDashboardData]);

  const onRefresh = () => {
    setRefreshing(true);
    fetchDashboardData();
  };

  const getTitle = (card: MetricCard) => 
    language === 'ar' ? card.titleAr : card.title;

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  if (compact) {
    // Compact view - just metric cards
    return (
      <View style={styles.compactContainer}>
        <ScrollView 
          horizontal 
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.compactScroll}
        >
          {metrics.slice(0, 4).map((metric) => (
            <View 
              key={metric.id} 
              style={[styles.compactCard, { backgroundColor: metric.color + '15' }]}
            >
              <Ionicons name={metric.icon as any} size={24} color={metric.color} />
              <Text style={[styles.compactValue, { color: metric.color }]}>
                {metric.value}
              </Text>
              <Text style={[styles.compactLabel, { color: colors.textSecondary }]}>
                {getTitle(metric)}
              </Text>
            </View>
          ))}
        </ScrollView>
      </View>
    );
  }

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: colors.background }]}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
      }
      showsVerticalScrollIndicator={false}
    >
      {/* Header */}
      <View style={styles.header}>
        <Text style={[styles.headerTitle, { color: colors.text }]}>
          {language === 'ar' ? 'لوحة الأداء' : 'Performance Dashboard'}
        </Text>
        <TouchableOpacity 
          style={[styles.refreshButton, { backgroundColor: colors.surface }]}
          onPress={onRefresh}
        >
          <Ionicons name="refresh" size={20} color={colors.primary} />
        </TouchableOpacity>
      </View>

      {/* Metric Cards Grid */}
      <View style={styles.metricsGrid}>
        {metrics.map((metric, index) => (
          <TouchableOpacity 
            key={metric.id} 
            style={[styles.metricCard, { width: CARD_WIDTH }]}
            activeOpacity={0.8}
          >
            <LinearGradient
              colors={metric.gradient as [string, string, ...string[]]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.metricGradient}
            >
              <View style={styles.metricIconContainer}>
                <Ionicons name={metric.icon as any} size={28} color="#FFF" />
              </View>
              <Text style={styles.metricValue}>{metric.value}</Text>
              <Text style={styles.metricTitle}>{getTitle(metric)}</Text>
              {metric.change !== undefined && (
                <View style={styles.changeContainer}>
                  <Ionicons 
                    name={metric.change >= 0 ? 'arrow-up' : 'arrow-down'} 
                    size={12} 
                    color="rgba(255,255,255,0.8)" 
                  />
                  <Text style={styles.changeText}>{metric.change}%</Text>
                </View>
              )}
            </LinearGradient>
          </TouchableOpacity>
        ))}
      </View>

      <View style={{ height: 40 }} />
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    padding: 16,
  },
  loadingContainer: {
    height: 200,
    justifyContent: 'center',
    alignItems: 'center',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '800',
  },
  refreshButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  metricsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    marginBottom: 20,
  },
  metricCard: {
    borderRadius: 16,
    overflow: 'hidden',
  },
  metricGradient: {
    padding: 16,
    minHeight: 130,
  },
  metricIconContainer: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  metricValue: {
    fontSize: 26,
    fontWeight: '800',
    color: '#FFF',
    marginBottom: 4,
  },
  metricTitle: {
    fontSize: 12,
    fontWeight: '500',
    color: 'rgba(255,255,255,0.85)',
  },
  changeContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 6,
    gap: 2,
  },
  changeText: {
    fontSize: 11,
    color: 'rgba(255,255,255,0.8)',
  },
  compactContainer: {
    marginVertical: 8,
  },
  compactScroll: {
    paddingHorizontal: 16,
    gap: 10,
  },
  compactCard: {
    width: 100,
    padding: 12,
    borderRadius: 12,
    alignItems: 'center',
  },
  compactValue: {
    fontSize: 20,
    fontWeight: '800',
    marginTop: 6,
  },
  compactLabel: {
    fontSize: 10,
    textAlign: 'center',
    marginTop: 4,
  },
  section: {
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 12,
  },
  viewAllText: {
    fontSize: 13,
    fontWeight: '600',
  },
  infoTagsContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  infoTag: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    gap: 6,
  },
  infoTagText: {
    fontSize: 12,
    fontWeight: '600',
  },
  orderItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  orderInfo: {
    flex: 1,
  },
  orderNumber: {
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 2,
  },
  orderDate: {
    fontSize: 12,
  },
  orderStatus: {
    alignItems: 'flex-end',
  },
  statusBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 10,
    marginBottom: 4,
  },
  statusText: {
    fontSize: 11,
    fontWeight: '600',
    textTransform: 'capitalize',
  },
  orderTotal: {
    fontSize: 14,
    fontWeight: '700',
  },
});

export default AdminPerformanceDashboard;
