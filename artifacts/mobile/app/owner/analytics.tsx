/**
 * Analytics Dashboard — Professional native-only redesign
 * No SVG dependencies. Uses LinearGradient bar charts and React Native views.
 */
import React, { useState, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Dimensions,
  Alert,
  Platform,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { BlurView } from 'expo-blur';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useWebSocketEvent } from '../../src/services/websocketService';
import * as Sharing from 'expo-sharing';
import * as FileSystem from 'expo-file-system/legacy';
import { useAppStore } from '../../src/store/appStore';
import { analyticsApi } from '../../src/services/api';
import { AccessGuard as __AccessGuard__ } from '../../src/components/AccessGuard';
const { width: SCREEN_WIDTH } = Dimensions.get('window');

const DATE_RANGES = [
  { id: '7d', label: '7 Days', labelAr: '7 أيام' },
  { id: '30d', label: '30 Days', labelAr: '30 يوم' },
  { id: '90d', label: '90 Days', labelAr: '90 يوم' },
  { id: 'all', label: 'All Time', labelAr: 'كل الوقت' },
];

// ─────────────────────────────────────────────────────────────────────────────
// Native Horizontal Bar Chart (for status breakdown)
// ─────────────────────────────────────────────────────────────────────────────
interface BarItem { label: string; value: number; color: string; gradient: [string, string] }

const HorizontalBarChart = ({ data }: { data: BarItem[] }) => {
  const maxVal = Math.max(...data.map(d => d.value), 1);
  return (
    <View style={{ gap: 12 }}>
      {data.map((item, i) => {
        const pct = Math.max((item.value / maxVal) * 100, item.value > 0 ? 6 : 0);
        return (
          <View key={i}>
            <View style={hStyles.barLabelRow}>
              <Text style={hStyles.barLabel}>{item.label}</Text>
              <Text style={[hStyles.barCount, { color: item.color }]}>{item.value}</Text>
            </View>
            <View style={hStyles.barTrack}>
              <LinearGradient
                colors={item.gradient}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={[hStyles.barFill, { width: `${pct}%` as any }]}
              />
            </View>
          </View>
        );
      })}
    </View>
  );
};

const hStyles = StyleSheet.create({
  barLabelRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 5 },
  barLabel: { fontSize: 13, color: 'rgba(255,255,255,0.75)', fontWeight: '500' },
  barCount: { fontSize: 13, fontWeight: '800' },
  barTrack: { height: 10, backgroundColor: 'rgba(255,255,255,0.08)', borderRadius: 6, overflow: 'hidden' },
  barFill: { height: '100%', borderRadius: 6 },
});

// ─────────────────────────────────────────────────────────────────────────────
// Sparkline Bar Chart (revenue over time)
// ─────────────────────────────────────────────────────────────────────────────
const SparkBars = ({ data }: { data: { label: string; value: number }[] }) => {
  const maxVal = Math.max(...data.map(d => d.value), 1);
  return (
    <View style={spStyles.container}>
      {data.map((d, i) => {
        const h = Math.max((d.value / maxVal) * 80, d.value > 0 ? 4 : 1);
        return (
          <View key={i} style={spStyles.col}>
            <Text style={spStyles.val} numberOfLines={1}>
              {d.value >= 1000 ? `${(d.value / 1000).toFixed(0)}k` : d.value > 0 ? d.value.toFixed(0) : ''}
            </Text>
            <View style={spStyles.trackWrap}>
              <LinearGradient
                colors={['#6366F1', '#8B5CF6']}
                start={{ x: 0, y: 0 }}
                end={{ x: 0, y: 1 }}
                style={[spStyles.bar, { height: h }]}
              />
            </View>
            <Text style={spStyles.day} numberOfLines={1}>{d.label}</Text>
          </View>
        );
      })}
    </View>
  );
};

const spStyles = StyleSheet.create({
  container: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', height: 120, paddingBottom: 18 },
  col: { flex: 1, alignItems: 'center', justifyContent: 'flex-end', gap: 4 },
  trackWrap: { width: '60%', minWidth: 14, justifyContent: 'flex-end' },
  bar: { width: '100%', borderRadius: 4 },
  val: { fontSize: 8, color: 'rgba(255,255,255,0.55)', fontWeight: '700' },
  day: { fontSize: 8, color: 'rgba(255,255,255,0.45)', position: 'absolute', bottom: 0 },
});

// ─────────────────────────────────────────────────────────────────────────────
// Top Products Horizontal Rank List
// ─────────────────────────────────────────────────────────────────────────────
const TopProductsList = ({ data }: { data: { label: string; value: number; color: string }[] }) => {
  const maxVal = Math.max(...data.map(d => d.value), 1);
  const RANK_COLORS = ['#F59E0B', '#94A3B8', '#CD7F32', '#60A5FA', '#A78BFA'];
  return (
    <View style={{ gap: 10 }}>
      {data.map((item, i) => {
        const pct = Math.max((item.value / maxVal) * 100, 6);
        return (
          <View key={i} style={tpStyles.row}>
            <View style={[tpStyles.rank, { backgroundColor: RANK_COLORS[i] + '25', borderColor: RANK_COLORS[i] + '60' }]}>
              <Text style={[tpStyles.rankNum, { color: RANK_COLORS[i] }]}>#{i + 1}</Text>
            </View>
            <View style={tpStyles.info}>
              <View style={tpStyles.nameRow}>
                <Text style={tpStyles.name} numberOfLines={1}>{item.label}</Text>
                <Text style={[tpStyles.count, { color: item.color }]}>{item.value}</Text>
              </View>
              <View style={tpStyles.track}>
                <View style={[tpStyles.fill, { width: `${pct}%` as any, backgroundColor: item.color }]} />
              </View>
            </View>
          </View>
        );
      })}
    </View>
  );
};

const tpStyles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  rank: { width: 36, height: 36, borderRadius: 10, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  rankNum: { fontSize: 11, fontWeight: '800' },
  info: { flex: 1, gap: 5 },
  nameRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  name: { fontSize: 13, color: '#FFF', fontWeight: '500', flex: 1, marginRight: 8 },
  count: { fontSize: 14, fontWeight: '800' },
  track: { height: 6, backgroundColor: 'rgba(255,255,255,0.08)', borderRadius: 3, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: 3 },
});

// ─────────────────────────────────────────────────────────────────────────────
// Main Screen
// ─────────────────────────────────────────────────────────────────────────────
function AnalyticsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const language = useAppStore((state) => state.language);
  const orders = useAppStore((state) => state.orders);
  const products = useAppStore((state) => state.products);
  const customers = useAppStore((state) => state.customers);
  const admins = useAppStore((state) => state.admins);
  const isRTL = language === 'ar';

  const [dateRange, setDateRange] = useState('30d');

  const { data: overview } = useQuery<any>({
    queryKey: ['/api/analytics/overview'],
    queryFn: () => analyticsApi.getOverview().then((r: any) => r.data),
  });
  const { data: salesData } = useQuery<any[]>({
    queryKey: ['/api/analytics/sales'],
    queryFn: () => analyticsApi.getSales().then((r: any) => r.data),
  });
  // G3: notification delivery analytics for the owner tile.
  const { data: notifAnalytics } = useQuery<{
    totals: { sent: number; delivered: number; opened: number };
    rates: { delivery_rate: number; open_rate: number };
  }>({
    queryKey: ['/api/analytics/notifications'],
    queryFn: () => analyticsApi.getNotifications().then((r: any) => r.data),
  });

  useWebSocketEvent(['new_order', 'order_created', 'order_updated', 'order_status_changed'], () => {
    queryClient.invalidateQueries({ queryKey: ['/api/analytics/overview'] });
    queryClient.invalidateQueries({ queryKey: ['/api/analytics/sales'] });
    queryClient.invalidateQueries({ queryKey: ['/api/analytics/notifications'] });
  });

  const filteredOrders = useMemo(() => {
    const now = Date.now();
    const ranges: Record<string, number> = {
      '7d': 7 * 24 * 60 * 60 * 1000,
      '30d': 30 * 24 * 60 * 60 * 1000,
      '90d': 90 * 24 * 60 * 60 * 1000,
      'all': Infinity,
    };
    const cutoff = now - (ranges[dateRange] || Infinity);
    return orders.filter((o: any) => new Date(o.created_at).getTime() > cutoff);
  }, [orders, dateRange]);

  const metrics = useMemo(() => {
    const totalRevenue = overview?.total_revenue ?? filteredOrders.reduce((sum: number, o: any) => sum + (o.total || o.total_amount || 0), 0);
    const totalOrders = overview?.total_orders ?? filteredOrders.length;
    const avgOrderValue = totalOrders > 0 ? totalRevenue / totalOrders : 0;

    const ordersByStatus = overview?.orders_by_status ?? {
      pending: filteredOrders.filter((o: any) => o.status === 'pending').length,
      shipped: filteredOrders.filter((o: any) => o.status === 'shipped').length,
      delivered: filteredOrders.filter((o: any) => o.status === 'delivered').length,
      cancelled: filteredOrders.filter((o: any) => o.status === 'cancelled').length,
    };

    const productSales: Record<string, number> = {};
    filteredOrders.forEach((order: any) => {
      (order.items || []).forEach((item: any) => {
        const name = item.product_name || item.name || 'Unknown';
        productSales[name] = (productSales[name] || 0) + (item.quantity || 1);
      });
    });
    const topProducts = Object.entries(productSales)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 5)
      .map(([name, sales], i) => ({
        label: name,
        value: sales,
        color: ['#F59E0B', '#3B82F6', '#10B981', '#8B5CF6', '#EC4899'][i],
      }));

    const revenueOverTime = salesData && salesData.length > 0
      ? salesData.slice(-7).map((row: any) => ({
          label: new Date(row.date).toLocaleDateString('en', { weekday: 'short' }),
          value: parseFloat(row.revenue || '0'),
        }))
      : Array.from({ length: 7 }, (_, i) => {
          const dayOffset = 6 - i;
          const date = new Date();
          date.setDate(date.getDate() - dayOffset);
          const dayStr = date.toDateString();
          const dayRevenue = filteredOrders
            .filter((o: any) => new Date(o.created_at).toDateString() === dayStr)
            .reduce((sum: number, o: any) => sum + (o.total || o.total_amount || 0), 0);
          return { label: ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'][date.getDay()], value: dayRevenue };
        });

    return {
      totalRevenue,
      totalOrders,
      avgOrderValue,
      ordersByStatus,
      topProducts,
      revenueOverTime,
      todayRevenue: overview?.today_revenue ?? 0,
      todayOrders: overview?.today_orders ?? 0,
      monthRevenue: overview?.month_revenue ?? 0,
      monthOrders: overview?.month_orders ?? 0,
    };
  }, [filteredOrders, overview, salesData]);

  const handlePrint = async () => {
    try {
      const now = new Date().toLocaleDateString(isRTL ? 'ar-EG' : 'en-US', { year: 'numeric', month: 'long', day: 'numeric' });
      const fmtMoney = (n: number) => n.toLocaleString(isRTL ? 'ar-EG' : 'en-US', { style: 'currency', currency: 'EGP' });
      const rangeLabelMap: Record<string, string> = { '7d': isRTL ? '7 أيام' : '7 Days', '30d': isRTL ? '30 يوم' : '30 Days', '90d': isRTL ? '90 يوم' : '90 Days', 'all': isRTL ? 'كل الوقت' : 'All Time' };
      const rangeLabel = rangeLabelMap[dateRange] || dateRange;

      const statusRows = [
        { label: isRTL ? 'قيد الانتظار' : 'Pending', color: '#F59E0B', count: metrics.ordersByStatus.pending },
        { label: isRTL ? 'شحن' : 'Shipped', color: '#3B82F6', count: metrics.ordersByStatus.shipped },
        { label: isRTL ? 'تم التسليم' : 'Delivered', color: '#10B981', count: metrics.ordersByStatus.delivered },
        { label: isRTL ? 'ملغي' : 'Cancelled', color: '#EF4444', count: metrics.ordersByStatus.cancelled },
      ];

      const lowStock = products.filter((p: any) => (p.quantity || p.stock || 0) < 10).length;

      const html = `<!DOCTYPE html>
<html lang="${isRTL ? 'ar' : 'en'}" dir="${isRTL ? 'rtl' : 'ltr'}">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>${isRTL ? 'تقرير التحليلات — الغزالي' : 'Analytics Report — Al-Ghazaly'}</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Tajawal:wght@300;400;500;700;800&display=swap');
  *{box-sizing:border-box;margin:0;padding:0;}
  body{font-family:'Tajawal',Arial,sans-serif;background:#f1f5f9;color:#1e293b;min-height:100vh;}
  .wrapper{max-width:1100px;margin:0 auto;padding:32px 20px 60px;}
  .report-header{background:linear-gradient(135deg,#1e1b4b 0%,#4f46e5 50%,#7c3aed 100%);border-radius:16px;padding:20px 28px;margin-bottom:20px;color:#fff;display:flex;align-items:center;gap:16px;flex-wrap:wrap;}
  .brand-badge{width:48px;height:48px;flex-shrink:0;background:rgba(255,255,255,0.15);border:2px solid rgba(255,255,255,0.25);border-radius:14px;display:flex;align-items:center;justify-content:center;font-size:22px;}
  .header-main{flex:1;min-width:0;}
  .brand-name{font-size:20px;font-weight:800;letter-spacing:-0.3px;}
  .period-line{font-size:12px;color:rgba(255,255,255,0.7);margin-top:3px;}
  .report-badge{flex-shrink:0;background:rgba(255,255,255,0.12);border:1px solid rgba(255,255,255,0.2);border-radius:10px;padding:5px 14px;font-size:12px;color:rgba(255,255,255,0.85);font-weight:600;}
  .hero-card{background:linear-gradient(135deg,#4f46e5,#7c3aed,#8b5cf6);border-radius:16px;padding:24px 28px;margin-bottom:20px;color:#fff;}
  .hero-label{font-size:13px;color:rgba(255,255,255,0.75);font-weight:600;margin-bottom:6px;}
  .hero-value{font-size:40px;font-weight:900;color:#fff;}
  .hero-value span{font-size:18px;font-weight:600;opacity:0.8;}
  .hero-sub{display:flex;gap:32px;margin-top:16px;padding-top:16px;border-top:1px solid rgba(255,255,255,0.2);}
  .hero-stat-val{font-size:22px;font-weight:700;color:#fff;}
  .hero-stat-lbl{font-size:11px;color:rgba(255,255,255,0.65);margin-top:2px;}
  .stats-row{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:20px;}
  .stat-card{background:#fff;border:1px solid #e2e8f0;border-radius:14px;padding:16px;display:flex;flex-direction:column;align-items:center;gap:6px;box-shadow:0 1px 3px rgba(0,0,0,0.06);}
  .stat-icon{font-size:24px;}
  .stat-num{font-size:22px;font-weight:800;color:#0f172a;}
  .stat-lbl{font-size:11px;color:#64748b;text-align:center;}
  .section-title{font-size:16px;font-weight:700;color:#1e293b;margin:24px 0 12px;display:flex;align-items:center;gap:8px;}
  .section-dot{width:10px;height:10px;border-radius:50%;display:inline-block;}
  .table-card{background:#fff;border-radius:14px;overflow:hidden;border:1px solid #e2e8f0;box-shadow:0 2px 8px rgba(0,0,0,0.06);margin-bottom:20px;}
  table{width:100%;border-collapse:collapse;}
  thead tr{background:linear-gradient(90deg,#4f46e5,#7c3aed);}
  th{padding:12px 16px;font-size:11px;font-weight:700;color:#fff;text-align:${isRTL ? 'right' : 'left'};letter-spacing:0.4px;}
  td{padding:11px 16px;border-bottom:1px solid #f1f5f9;font-size:13px;}
  tr:last-child td{border-bottom:none;}
  tr:nth-child(even) td{background:#f8fafc;}
  .status-chip{padding:3px 10px;border-radius:20px;font-size:11px;font-weight:700;}
  .print-footer{text-align:center;margin-top:32px;color:#94a3b8;font-size:11px;}
  .print-btn{position:fixed;bottom:24px;right:24px;background:#4f46e5;color:#fff;border:none;border-radius:12px;padding:14px 28px;font-size:15px;font-weight:700;cursor:pointer;box-shadow:0 4px 20px rgba(79,70,229,0.4);font-family:inherit;}
  @media print{body{background:#fff;}.wrapper{padding:16px;}.print-btn{display:none;}.report-header,.hero-card{-webkit-print-color-adjust:exact;print-color-adjust:exact;}thead tr{-webkit-print-color-adjust:exact;print-color-adjust:exact;}}
</style>
</head>
<body>
<div class="wrapper">
  <div class="report-header">
    <div class="brand-badge">📊</div>
    <div class="header-main">
      <div class="brand-name">${isRTL ? 'مطعم الغزالي' : 'Al-Ghazaly Dining'}</div>
      <div class="period-line">${isRTL ? `تقرير التحليلات · الفترة: ${rangeLabel}` : `Analytics Report · Period: ${rangeLabel}`}</div>
    </div>
    <div class="report-badge">${isRTL ? '📋 تقرير رسمي' : '📋 Official Report'}</div>
  </div>
  <div class="hero-card">
    <div class="hero-label">${isRTL ? 'إجمالي الإيرادات' : 'Total Revenue'}</div>
    <div class="hero-value">${metrics.totalRevenue >= 1000 ? `${(metrics.totalRevenue / 1000).toFixed(1)}K` : metrics.totalRevenue.toFixed(0)} <span>${isRTL ? 'ج.م' : 'EGP'}</span></div>
    <div class="hero-sub">
      <div><div class="hero-stat-val">${metrics.totalOrders}</div><div class="hero-stat-lbl">${isRTL ? 'إجمالي الطلبات' : 'Total Orders'}</div></div>
      <div><div class="hero-stat-val">${metrics.avgOrderValue.toFixed(0)}</div><div class="hero-stat-lbl">${isRTL ? 'متوسط الطلب (ج.م)' : 'Avg Order (EGP)'}</div></div>
      <div><div class="hero-stat-val">${metrics.todayOrders}</div><div class="hero-stat-lbl">${isRTL ? 'طلبات اليوم' : "Today's Orders"}</div></div>
      <div><div class="hero-stat-val">${metrics.todayRevenue.toLocaleString()}</div><div class="hero-stat-lbl">${isRTL ? 'إيرادات اليوم' : "Today's Revenue"}</div></div>
    </div>
  </div>
  <div class="stats-row">
    <div class="stat-card"><div class="stat-icon">📦</div><div class="stat-num">${products.length}</div><div class="stat-lbl">${isRTL ? 'المنتجات' : 'Products'}</div></div>
    <div class="stat-card"><div class="stat-icon">👥</div><div class="stat-num">${customers.length}</div><div class="stat-lbl">${isRTL ? 'العملاء' : 'Customers'}</div></div>
    <div class="stat-card"><div class="stat-icon">📅</div><div class="stat-num">${metrics.monthRevenue.toLocaleString()}</div><div class="stat-lbl">${isRTL ? 'إيرادات الشهر (ج.م)' : 'Month Revenue (EGP)'}</div></div>
    <div class="stat-card"><div class="stat-icon">⚠️</div><div class="stat-num">${lowStock}</div><div class="stat-lbl">${isRTL ? 'مخزون منخفض' : 'Low Stock'}</div></div>
  </div>
  <div class="section-title"><span class="section-dot" style="background:#3B82F6;"></span>${isRTL ? 'حالة الطلبات' : 'Orders by Status'}</div>
  <div class="table-card">
    <table>
      <thead><tr><th>${isRTL ? 'الحالة' : 'Status'}</th><th>${isRTL ? 'العدد' : 'Count'}</th><th style="text-align:${isRTL ? 'left' : 'right'};">${isRTL ? 'النسبة %' : 'Percentage %'}</th></tr></thead>
      <tbody>${statusRows.map((row, i) => { const total = statusRows.reduce((s, r) => s + r.count, 0) || 1; const pct = ((row.count / total) * 100).toFixed(1); const bg = i % 2 === 0 ? '' : 'background:#f8fafc;'; return `<tr><td style="${bg}"><span class="status-chip" style="background:${row.color}18;color:${row.color};border:1px solid ${row.color}40;">${row.label}</span></td><td style="${bg}font-weight:700;">${row.count}</td><td style="${bg}text-align:${isRTL ? 'left' : 'right'};color:#64748b;">${pct}%</td></tr>`; }).join('')}</tbody>
    </table>
  </div>
  ${metrics.topProducts.length > 0 ? `<div class="section-title"><span class="section-dot" style="background:#F59E0B;"></span>${isRTL ? 'أفضل المنتجات' : 'Top Products'}</div><div class="table-card"><table><thead><tr><th>${isRTL ? 'الترتيب' : 'Rank'}</th><th>${isRTL ? 'المنتج' : 'Product'}</th><th style="text-align:${isRTL ? 'left' : 'right'};">${isRTL ? 'المبيعات' : 'Sales'}</th></tr></thead><tbody>${metrics.topProducts.map((p: any, i: number) => { const bg = i % 2 === 0 ? '' : 'background:#f8fafc;'; return `<tr><td style="${bg}font-weight:700;color:${p.color};">#${i + 1}</td><td style="${bg}">${p.label}</td><td style="${bg}text-align:${isRTL ? 'left' : 'right'};font-weight:700;">${p.value}</td></tr>`; }).join('')}</tbody></table></div>` : ''}
  <div class="print-footer">${isRTL ? `تم إنشاء هذا التقرير تلقائياً بواسطة نظام الغزالي · ${now}` : `Auto-generated by Al-Ghazaly Store Management System · ${now}`}</div>
</div>
<button class="print-btn" onclick="window.print()">${isRTL ? 'طباعة التقرير' : 'Print Report'}</button>
<script>window.onload=function(){setTimeout(function(){window.print();},800);};<\/script>
</body></html>`;

      if (Platform.OS === 'web') {
        const w = (window as any).open('', '_blank');
        if (w) { w.document.write(html); w.document.close(); }
      } else {
        const fileUri = (FileSystem.documentDirectory ?? '') + 'analytics-report.html';
        await FileSystem.writeAsStringAsync(fileUri, html, { encoding: 'utf8' });
        const canShare = await Sharing.isAvailableAsync();
        if (canShare) {
          await Sharing.shareAsync(fileUri, { mimeType: 'text/html', dialogTitle: isRTL ? 'مشاركة التقرير' : 'Share Report' });
        } else {
          Alert.alert(isRTL ? 'المشاركة غير متاحة' : 'Sharing not available');
        }
      }
    } catch (e: any) {
      Alert.alert('Error', e.message);
    }
  };

  const lowStock = products.filter((p: any) => (p.quantity || p.stock || 0) < 10).length;

  const statusBarData: BarItem[] = [
    { label: isRTL ? 'قيد الانتظار' : 'Pending', value: metrics.ordersByStatus.pending, color: '#F59E0B', gradient: ['#D97706', '#FBBF24'] },
    { label: isRTL ? 'شحن' : 'Shipped', value: metrics.ordersByStatus.shipped, color: '#3B82F6', gradient: ['#2563EB', '#60A5FA'] },
    { label: isRTL ? 'تم التسليم' : 'Delivered', value: metrics.ordersByStatus.delivered, color: '#10B981', gradient: ['#059669', '#34D399'] },
    { label: isRTL ? 'ملغي' : 'Cancelled', value: metrics.ordersByStatus.cancelled, color: '#EF4444', gradient: ['#DC2626', '#F87171'] },
  ];

  return (
    <View style={styles.container}>
      <LinearGradient colors={['#0F0F2E', '#1A1A4F', '#0F2027']} style={StyleSheet.absoluteFill} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} />

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={[styles.scrollContent, { paddingTop: insets.top }]}
        showsVerticalScrollIndicator={false}
        overScrollMode="never"
        bounces={false}
      >
        {/* Header */}
        <View style={[styles.header, isRTL && styles.headerRTL]}>
          <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
            <Ionicons name={isRTL ? 'arrow-forward' : 'arrow-back'} size={22} color="#FFF" />
          </TouchableOpacity>
          <View style={styles.headerCenter}>
            <Text style={styles.headerTitle}>{isRTL ? 'لوحة التحليلات' : 'Analytics Dashboard'}</Text>
            <Text style={styles.headerSub}>{isRTL ? 'مطعم الغزالي' : 'Al-Ghazaly Dining'}</Text>
          </View>
          <TouchableOpacity style={styles.printButton} onPress={handlePrint}>
            <Ionicons name="share-outline" size={20} color="#FFF" />
          </TouchableOpacity>
        </View>

        {/* Hero Revenue Card */}
        <View style={styles.heroCard}>
          <LinearGradient colors={['#4F46E5', '#7C3AED', '#8B5CF6']} style={styles.heroGradient} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}>
            <View style={styles.heroContent}>
              <View>
                <Text style={styles.heroLabel}>{isRTL ? 'إجمالي الإيرادات' : 'Total Revenue'}</Text>
                <Text style={styles.heroValue}>
                  {metrics.totalRevenue >= 1000000
                    ? `${(metrics.totalRevenue / 1000000).toFixed(2)}M`
                    : metrics.totalRevenue >= 1000
                    ? `${(metrics.totalRevenue / 1000).toFixed(1)}K`
                    : metrics.totalRevenue.toFixed(0)}
                  <Text style={styles.heroCurrency}> {isRTL ? 'ج.م' : 'EGP'}</Text>
                </Text>
              </View>
              <View style={styles.heroIconWrap}>
                <Ionicons name="trending-up" size={28} color="#FFF" />
              </View>
            </View>
            <View style={styles.heroRow}>
              {[
                { val: metrics.totalOrders, lbl: isRTL ? 'الطلبات' : 'Orders' },
                { val: metrics.avgOrderValue.toFixed(0), lbl: isRTL ? 'متوسط الطلب' : 'Avg Order' },
                { val: metrics.todayOrders, lbl: isRTL ? 'اليوم' : 'Today' },
                { val: metrics.monthOrders, lbl: isRTL ? 'الشهر' : 'Month' },
              ].map((s, i, arr) => (
                <React.Fragment key={i}>
                  <View style={styles.heroStat}>
                    <Text style={styles.heroStatValue}>{s.val}</Text>
                    <Text style={styles.heroStatLabel}>{s.lbl}</Text>
                  </View>
                  {i < arr.length - 1 && <View style={styles.heroStatDivider} />}
                </React.Fragment>
              ))}
            </View>
          </LinearGradient>
        </View>

        {/* Date Range Filter */}
        <View style={styles.dateRangeContainer}>
          {DATE_RANGES.map((range) => (
            <TouchableOpacity
              key={range.id}
              style={[styles.dateRangeButton, dateRange === range.id && styles.dateRangeActive]}
              onPress={() => setDateRange(range.id)}
            >
              <Text style={[styles.dateRangeText, dateRange === range.id && styles.dateRangeTextActive]}>
                {isRTL ? range.labelAr : range.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* KPI Row */}
        <View style={styles.kpiRow}>
          {[
            { icon: 'sunny' as const, value: `${metrics.todayRevenue.toLocaleString()}`, label: isRTL ? 'اليوم ج.م' : 'Today EGP', color: '#F59E0B', bg: '#F59E0B20' },
            { icon: 'calendar' as const, value: `${metrics.monthRevenue.toLocaleString()}`, label: isRTL ? 'الشهر ج.م' : 'Month EGP', color: '#10B981', bg: '#10B98120' },
            { icon: 'alert-circle' as const, value: `${lowStock}`, label: isRTL ? 'مخزون منخفض' : 'Low Stock', color: '#EF4444', bg: '#EF444420' },
          ].map((kpi, i) => (
            <View key={i} style={[styles.kpiCard, { backgroundColor: kpi.bg, borderColor: kpi.color + '50' }]}>
              <Ionicons name={kpi.icon} size={18} color={kpi.color} />
              <Text style={[styles.kpiValue, { color: kpi.color }]} numberOfLines={1}>{kpi.value}</Text>
              <Text style={styles.kpiLabel} numberOfLines={2}>{kpi.label}</Text>
            </View>
          ))}
        </View>

        {/* Platform Overview */}
        <View style={styles.sectionHeader}>
          <Ionicons name="bar-chart" size={16} color="#8B5CF6" />
          <Text style={styles.sectionTitle}>{isRTL ? 'نظرة عامة على المنصة' : 'Platform Overview'}</Text>
        </View>
        <View style={styles.overviewGrid}>
          {[
            { icon: 'people' as const, value: customers.length, label: isRTL ? 'العملاء' : 'Customers', color: '#8B5CF6' },
            { icon: 'cube' as const, value: products.length, label: isRTL ? 'المنتجات' : 'Products', color: '#EC4899' },
            { icon: 'shield-checkmark' as const, value: admins.length, label: isRTL ? 'المشرفون' : 'Admins', color: '#10B981' },
            { icon: 'card' as const, value: overview?.total_subscribers ?? 0, label: isRTL ? 'المشتركون' : 'Subscribers', color: '#F59E0B' },
            { icon: 'receipt' as const, value: overview?.total_orders ?? filteredOrders.length, label: isRTL ? 'كل الطلبات' : 'All Orders', color: '#3B82F6' },
            { icon: 'alert-circle' as const, value: lowStock, label: isRTL ? 'مخزون منخفض' : 'Low Stock', color: '#EF4444' },
          ].map((item, i) => (
            <View key={i} style={[styles.overviewItem, { borderColor: item.color + '30' }]}>
              <View style={[styles.overviewIconWrap, { backgroundColor: item.color + '20' }]}>
                <Ionicons name={item.icon} size={20} color={item.color} />
              </View>
              <Text style={styles.overviewValue}>{item.value}</Text>
              <Text style={styles.overviewLabel}>{item.label}</Text>
            </View>
          ))}
        </View>

        {/* Orders by Status — Horizontal Bar Chart */}
        <View style={styles.sectionHeader}>
          <Ionicons name="pie-chart" size={16} color="#3B82F6" />
          <Text style={styles.sectionTitle}>{isRTL ? 'حالة الطلبات' : 'Orders by Status'}</Text>
        </View>
        <View style={styles.chartCard}>
          <BlurView intensity={20} tint="dark" style={styles.chartBlur}>
            <HorizontalBarChart data={statusBarData} />
          </BlurView>
        </View>

        {/* Revenue Over Time — Spark Bars */}
        <View style={styles.sectionHeader}>
          <Ionicons name="trending-up" size={16} color="#10B981" />
          <Text style={styles.sectionTitle}>{isRTL ? 'الإيرادات (آخر 7 أيام)' : 'Revenue (Last 7 Days)'}</Text>
        </View>
        <View style={styles.chartCard}>
          <BlurView intensity={20} tint="dark" style={styles.chartBlur}>
            <SparkBars data={metrics.revenueOverTime} />
          </BlurView>
        </View>

        {/* Top Products */}
        {metrics.topProducts.length > 0 && (
          <>
            <View style={styles.sectionHeader}>
              <Ionicons name="star" size={16} color="#F59E0B" />
              <Text style={styles.sectionTitle}>{isRTL ? 'أفضل المنتجات' : 'Top Products'}</Text>
            </View>
            <View style={styles.chartCard}>
              <BlurView intensity={20} tint="dark" style={styles.chartBlur}>
                <TopProductsList data={metrics.topProducts} />
              </BlurView>
            </View>
          </>
        )}

        {/* G3: Notification Delivery (Last 30 Days) */}
        <View style={styles.sectionHeader}>
          <Ionicons name="notifications" size={16} color="#06B6D4" />
          <Text style={styles.sectionTitle}>
            {isRTL ? 'تسليم الإشعارات (آخر 30 يوم)' : 'Notification Delivery (Last 30 Days)'}
          </Text>
        </View>
        <View style={styles.chartCard}>
          <BlurView intensity={20} tint="dark" style={styles.chartBlur}>
            <View style={notifStyles.row}>
              {[
                { icon: 'send' as const,             value: notifAnalytics?.totals.sent      ?? 0, label: isRTL ? 'مرسلة'  : 'Sent',      color: '#06B6D4' },
                { icon: 'checkmark-done' as const,   value: notifAnalytics?.totals.delivered ?? 0, label: isRTL ? 'وصلت'   : 'Delivered', color: '#10B981' },
                { icon: 'eye' as const,              value: notifAnalytics?.totals.opened    ?? 0, label: isRTL ? 'مفتوحة' : 'Opened',    color: '#F59E0B' },
              ].map((s, i) => (
                <View key={i} style={notifStyles.cell}>
                  <View style={[notifStyles.icon, { backgroundColor: s.color + '22', borderColor: s.color + '55' }]}>
                    <Ionicons name={s.icon} size={18} color={s.color} />
                  </View>
                  <Text style={[notifStyles.val, { color: s.color }]}>{s.value}</Text>
                  <Text style={notifStyles.lbl}>{s.label}</Text>
                </View>
              ))}
            </View>
            <View style={notifStyles.ratesRow}>
              <View style={notifStyles.rateBox}>
                <Text style={notifStyles.rateLbl}>{isRTL ? 'معدل التسليم' : 'Delivery Rate'}</Text>
                <Text style={[notifStyles.rateVal, { color: '#10B981' }]}>
                  {Math.round(((notifAnalytics?.rates.delivery_rate) ?? 0) * 100)}%
                </Text>
              </View>
              <View style={notifStyles.rateBox}>
                <Text style={notifStyles.rateLbl}>{isRTL ? 'معدل الفتح' : 'Open Rate'}</Text>
                <Text style={[notifStyles.rateVal, { color: '#F59E0B' }]}>
                  {Math.round(((notifAnalytics?.rates.open_rate) ?? 0) * 100)}%
                </Text>
              </View>
            </View>
          </BlurView>
        </View>

        <View style={{ height: insets.bottom + 40 }} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0F0F2E' },
  scrollView: { flex: 1, backgroundColor: '#0F0F2E' },
  scrollContent: { paddingHorizontal: 16, backgroundColor: '#0F0F2E' },
  header: { flexDirection: 'row', alignItems: 'center', paddingVertical: 14, gap: 10 },
  headerRTL: { flexDirection: 'row-reverse' },
  headerCenter: { flex: 1 },
  backButton: { width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.12)', alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 18, fontWeight: '800', color: '#FFF' },
  headerSub: { fontSize: 11, color: 'rgba(255,255,255,0.5)', marginTop: 2 },
  printButton: { width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.12)', alignItems: 'center', justifyContent: 'center' },
  heroCard: { borderRadius: 20, overflow: 'hidden', marginBottom: 16 },
  heroGradient: { padding: 22 },
  heroContent: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 },
  heroLabel: { fontSize: 13, color: 'rgba(255,255,255,0.75)', fontWeight: '600', marginBottom: 6 },
  heroValue: { fontSize: 36, fontWeight: '900', color: '#FFF' },
  heroCurrency: { fontSize: 16, fontWeight: '600', color: 'rgba(255,255,255,0.8)' },
  heroIconWrap: { width: 52, height: 52, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.15)', alignItems: 'center', justifyContent: 'center' },
  heroRow: { flexDirection: 'row', alignItems: 'center' },
  heroStat: { flex: 1, alignItems: 'center' },
  heroStatValue: { fontSize: 18, fontWeight: '700', color: '#FFF' },
  heroStatLabel: { fontSize: 10, color: 'rgba(255,255,255,0.65)', marginTop: 2 },
  heroStatDivider: { width: 1, height: 30, backgroundColor: 'rgba(255,255,255,0.2)' },
  dateRangeContainer: { flexDirection: 'row', backgroundColor: 'rgba(255,255,255,0.08)', borderRadius: 12, padding: 4, marginBottom: 16 },
  dateRangeButton: { flex: 1, paddingVertical: 9, alignItems: 'center', borderRadius: 9 },
  dateRangeActive: { backgroundColor: 'rgba(99,102,241,0.9)' },
  dateRangeText: { fontSize: 12, color: 'rgba(255,255,255,0.55)', fontWeight: '700' },
  dateRangeTextActive: { color: '#FFF' },
  kpiRow: { flexDirection: 'row', gap: 8, marginBottom: 20 },
  kpiCard: { flex: 1, borderRadius: 14, borderWidth: 1, padding: 12, alignItems: 'center', gap: 4 },
  kpiValue: { fontSize: 14, fontWeight: '800' },
  kpiLabel: { fontSize: 9, color: 'rgba(255,255,255,0.6)', textAlign: 'center' },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12, marginTop: 4 },
  sectionTitle: { fontSize: 15, fontWeight: '700', color: '#FFF' },
  overviewGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 20 },
  overviewItem: { width: (SCREEN_WIDTH - 52) / 3, alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.06)', borderRadius: 14, borderWidth: 1, paddingVertical: 14, paddingHorizontal: 8, gap: 6 },
  overviewIconWrap: { width: 42, height: 42, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  overviewValue: { fontSize: 20, fontWeight: '800', color: '#FFF' },
  overviewLabel: { fontSize: 10, color: 'rgba(255,255,255,0.65)', textAlign: 'center' },
  chartCard: { marginBottom: 20, borderRadius: 18, overflow: 'hidden', backgroundColor: 'rgba(255,255,255,0.05)' },
  chartBlur: { padding: 20, backgroundColor: 'rgba(15,15,46,0.7)' },
});

// G3: notification analytics tile
const notifStyles = StyleSheet.create({
  row:      { flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
  cell:     { flex: 1, alignItems: 'center', gap: 6 },
  icon:     { width: 38, height: 38, borderRadius: 12, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  val:      { fontSize: 20, fontWeight: '800' },
  lbl:      { fontSize: 11, color: 'rgba(255,255,255,0.65)' },
  ratesRow: { flexDirection: 'row', gap: 10, marginTop: 16, paddingTop: 12, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.08)' },
  rateBox:  { flex: 1, alignItems: 'center', gap: 4 },
  rateLbl:  { fontSize: 11, color: 'rgba(255,255,255,0.6)' },
  rateVal:  { fontSize: 22, fontWeight: '800' },
});


/* __ACCESS_GUARD_APPLIED__ */
export default function AnalyticsScreenGuarded(props: any) {
  return (
    <__AccessGuard__ scope="owner">
      <AnalyticsScreen {...props} />
    </__AccessGuard__>
  );
}
