/**
 * Restaurant Hub — Futuristic analytics dashboard for owners and restaurant users.
 * Shows all restaurants as a horizontal card strip; selecting one filters
 * orders, appointments and statistics to that restaurant.
 *
 * Access:
 *  - owner / partner / admin  → all restaurants, user-management controls
 *  - restaurant_user (≤3)     → only their assigned restaurant (pre-selected)
 */
import React, {
  useState, useEffect, useCallback, useRef, useMemo,
} from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  RefreshControl, ActivityIndicator, Modal, TextInput,
  Dimensions, StatusBar, Alert, FlatList, Share, Platform, Linking,
  Animated as RNAnimated,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { BlurView } from 'expo-blur';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams, useFocusEffect } from 'expo-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';

import { useAppStore } from '../../src/store/appStore';
import { useTranslation } from '../../src/hooks/useTranslation';
import { useTheme } from '../../src/hooks/useTheme';
import { restaurantAnalyticsApi, appointmentsApi, ratingsApi, pushLogApi, productsApi } from '../../src/services/api';
import { haptic } from '../../src/services/hapticService';
import { playNewOrderChime, releaseNewOrderChime } from '../../src/services/soundService';
import { pushNotificationService } from '../../src/services/pushNotificationService';
import { AccessGuard as __AccessGuard__ } from '../../src/components/AccessGuard';
import { useWebSocketEvent } from '../../src/services/websocketService';
import { useAppLiveness } from '../../src/hooks/useAppLiveness';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import * as FileSystem from 'expo-file-system/legacy';
import { WebView } from 'react-native-webview';
import { LineChart } from 'react-native-chart-kit';
import FitmentStrip from '../../src/components/FitmentStrip';
import { OrderStatusToastStack } from '../../src/components/shopping-hub/OrderStatusToastStack';
import { ConnectionStatusBanner } from '../../src/components/ui/ConnectionStatusBanner';
import { useStatusToastQueue } from '../../src/hooks/shopping/useStatusToastQueue';

const { width: W } = Dimensions.get('window');

// ─────────────────────────────────────────────────────────────────────────────
// Design tokens
// ─────────────────────────────────────────────────────────────────────────────
const C = {
  bg:          '#05050A',
  surface:     'rgba(255,255,255,0.04)',
  surfaceHi:   'rgba(255,255,255,0.08)',
  gold:        '#FFD700',
  goldMuted:   'rgba(255,215,0,0.12)',
  goldBright:  '#FFEC40',
  goldBorder:  'rgba(255,215,0,0.35)',
  cyan:        '#00E5FF',
  cyanMuted:   'rgba(0,229,255,0.10)',
  cyanBorder:  'rgba(0,229,255,0.45)',
  border:      'rgba(255,255,255,0.07)',
  text:        '#FFFFFF',
  textMuted:   'rgba(255,255,255,0.55)',
  textFaint:   'rgba(255,255,255,0.28)',
  green:       '#10B981',
  red:         '#EF4444',
  orange:      '#F59E0B',
  blue:        '#3B82F6',
  purple:      '#8B5CF6',
  pink:        '#EC4899',
  indigo:      '#6366F1',
  sky:         '#0EA5E9',
};

// ─────────────────────────────────────────────────────────────────────────────
// Theme-aware palette — returns C (dark defaults) or light overrides
// ─────────────────────────────────────────────────────────────────────────────
function usePalette() {
  const { colors, isDark } = useTheme();
  if (isDark) {
    // Modern dark palette — keep gold as accent but tone down "yellow-heavy" feel
    // by using a cooler primary text hue for prices/numbers.
    return {
      ...C,
      // Cooler accent colors that still complement gold (used for orderNum + subtotals)
      accent:        '#7CC2FF',     // cool cyan-blue accent for primary numbers
      accentSoft:    'rgba(124,194,255,0.12)',
      accentBorder:  'rgba(124,194,255,0.30)',
    };
  }
  return {
    ...C,
    bg:         colors.background,
    surface:    colors.card,
    surfaceHi:  'rgba(0,0,0,0.04)',
    border:     colors.border,
    text:       colors.text,
    textMuted:  colors.textSecondary,
    textFaint:  '#7C7468',
    // Light theme: deeper, modern accents for better readability
    gold:       colors.primary,                        // brand
    goldBright: colors.primaryDark || '#8C6A24',       // darker tone for emphasis
    goldMuted:  'rgba(200,162,74,0.10)',
    goldBorder: 'rgba(200,162,74,0.25)',
    accent:     '#1E5BBF',                             // navy-blue accent (hi-contrast on white)
    accentSoft: 'rgba(30,91,191,0.08)',
    accentBorder: 'rgba(30,91,191,0.22)',
  };
}

// Status helpers
const ORDER_STATUS: Record<string, { color: string; label: string; labelAr: string; icon: string }> = {
  pending:          { color: C.orange, label: 'Pending',          labelAr: 'قيد الانتظار', icon: 'time-outline' },
  confirmed:        { color: C.indigo, label: 'Confirmed',        labelAr: 'مؤكد',         icon: 'checkmark-done-outline' },
  preparing:        { color: C.purple, label: 'Preparing',        labelAr: 'جاري التحضير', icon: 'construct-outline' },
  ready:            { color: C.cyan,   label: 'Ready',            labelAr: 'جاهز',         icon: 'checkmark-circle-outline' },
  shipped:          { color: C.blue,   label: 'Shipped',          labelAr: 'تم الشحن',     icon: 'bicycle-outline' },
  out_for_delivery: { color: C.sky,    label: 'Out for Delivery', labelAr: 'في الطريق',    icon: 'navigate-outline' },
  delivered:        { color: C.green,  label: 'Delivered',        labelAr: 'تم التسليم',   icon: 'checkmark-done-outline' },
  cancelled:        { color: C.red,    label: 'Cancelled',        labelAr: 'ملغي',         icon: 'close-circle-outline' },
};

const APPT_STATUS: Record<string, { color: string; label: string; labelAr: string; icon: string }> = {
  pending:   { color: C.orange, label: 'Pending',   labelAr: 'قيد الانتظار', icon: 'time-outline' },
  confirmed: { color: C.green,  label: 'Confirmed', labelAr: 'مؤكد',         icon: 'checkmark-circle-outline' },
  completed: { color: C.blue,   label: 'Completed', labelAr: 'مكتمل',        icon: 'flag-outline' },
  cancelled: { color: C.red,    label: 'Cancelled', labelAr: 'ملغي',         icon: 'close-circle-outline' },
  no_show:   { color: C.red,    label: 'No-show',   labelAr: 'لم يحضر',      icon: 'help-circle-outline' },
};

const TABS = ['orders', 'appointments', 'analytics', 'ratings'] as const;
type Tab = typeof TABS[number];

// ─────────────────────────────────────────────────────────────────────────────
// Module-level date-range helpers (pure — no hooks, safe to call anywhere)
// ─────────────────────────────────────────────────────────────────────────────
type DateRangeKeyM = 'today' | 'yesterday' | 'last7' | 'last30' | 'all';

function _dateRangeBounds(key: DateRangeKeyM): { start: Date | null; end: Date | null } {
  const now  = new Date();
  const sod  = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const eod  = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
  switch (key) {
    case 'today':     return { start: sod, end: eod };
    case 'yesterday': {
      const s = new Date(sod); s.setDate(s.getDate() - 1);
      const e = new Date(eod); e.setDate(e.getDate() - 1);
      return { start: s, end: e };
    }
    case 'last7':  { const s = new Date(sod); s.setDate(s.getDate() -  6); return { start: s, end: eod }; }
    case 'last30': { const s = new Date(sod); s.setDate(s.getDate() - 29); return { start: s, end: eod }; }
    default:          return { start: null, end: null };
  }
}

/**
 * filterByDateRange — filter an array of records by a date field and a
 * DateRangeKey string. Returns the full array for the 'all' key.
 * Accepts any field name so it works for both orders (created_at) and
 * appointments (appointment_date).
 */
function filterByDateRange<T extends Record<string, any>>(
  data: T[],
  dateField: keyof T,
  key: DateRangeKeyM,
): T[] {
  const { start, end } = _dateRangeBounds(key);
  if (!start || !end) return data;
  return data.filter((item) => {
    const raw = item[dateField];
    if (!raw) return false;
    const t = new Date(String(raw)).getTime();
    return !Number.isNaN(t) && t >= start.getTime() && t <= end.getTime();
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Tiny sub-components
// ─────────────────────────────────────────────────────────────────────────────
const StatusBadge = ({ status, type = 'order', lang }: { status: string; type?: 'order' | 'appt'; lang: string }) => {
  const map = type === 'order' ? ORDER_STATUS : APPT_STATUS;
  const s = map[status] ?? { color: '#666', label: status, labelAr: status, icon: 'ellipse-outline' };
  return (
    <View style={[sty.badge, { backgroundColor: s.color + '22', borderColor: s.color + '66' }]}>
      <Ionicons name={s.icon as any} size={10} color={s.color} />
      <Text style={[sty.badgeText, { color: s.color }]}>
        {lang === 'ar' ? s.labelAr : s.label}
      </Text>
    </View>
  );
};

const Divider = () => {
  const p = usePalette();
  return <View style={[sty.divider, { backgroundColor: p.border }]} />;
};

const MetricCard = ({
  icon, label, value, color, sub,
}: { icon: string; label: string; value: string | number; color: string; sub?: string }) => {
  const p = usePalette();
  return (
    <View style={[sty.metricCard, { backgroundColor: p.surface, borderColor: color + '33' }]}>
      <LinearGradient colors={[color + '18', 'transparent']} style={sty.metricGrad} />
      <Ionicons name={icon as any} size={22} color={color} style={{ marginBottom: 6 }} />
      <Text style={[sty.metricValue, { color }]}>{value}</Text>
      <Text style={[sty.metricLabel, { color: p.textMuted }]}>{label}</Text>
      {sub ? <Text style={[sty.metricSub, { color: p.textFaint }]}>{sub}</Text> : null}
    </View>
  );
};

// ── Stock alert sparkline — bar chart showing per-day alert counts ────────────
type SparklineData = { days: string[]; series: { low_stock: number[]; out_of_stock: number[] } };
const StockSparkline = ({
  data, range, lang,
}: { data: SparklineData | undefined; range: 7 | 30; lang: string }) => {
  const p = usePalette();
  const isRTL = lang === 'ar';

  // Build a full dense grid of all days in range using UTC dates so buckets
  // align with the server's DATE(sent_at AT TIME ZONE 'UTC') grouping.
  const allDays = useMemo(() => {
    const arr: string[] = [];
    const today = new Date();
    const todayUTC = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
    for (let i = range - 1; i >= 0; i--) {
      const ms = todayUTC - i * 86400000;
      const d = new Date(ms);
      arr.push(d.toISOString().slice(0, 10));
    }
    return arr;
  }, [range]);

  const lowMap  = useMemo(() => new Map((data?.days ?? []).map((d, i) => [d, data!.series.low_stock[i]])),  [data]);
  const outMap  = useMemo(() => new Map((data?.days ?? []).map((d, i) => [d, data!.series.out_of_stock[i]])), [data]);

  const maxVal = useMemo(() => {
    let m = 1;
    for (const d of allDays) {
      m = Math.max(m, lowMap.get(d) ?? 0, outMap.get(d) ?? 0);
    }
    return m;
  }, [allDays, lowMap, outMap]);

  const hasAny = useMemo(() => allDays.some(d => (lowMap.get(d) ?? 0) + (outMap.get(d) ?? 0) > 0), [allDays, lowMap, outMap]);

  const CHART_H = 48;
  const BAR_GAP = range === 7 ? 4 : 2;

  // Day-of-week abbreviations for 7-day x-axis labels
  const dowAr = ['أح', 'إث', 'ثل', 'أر', 'خم', 'جم', 'سب'];
  const dowEn = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

  return (
    <View style={[sty.sparklineCard, { backgroundColor: p.surface, borderColor: p.border }]}>
      <LinearGradient colors={[C.orange + '10', 'transparent']} style={StyleSheet.absoluteFill} />
      <View style={[sty.row, isRTL && sty.rowRev, { alignItems: 'center', marginBottom: 10 }]}>
        <Ionicons name="bar-chart-outline" size={13} color={p.textFaint} style={{ marginEnd: 5 }} />
        <Text style={[sty.sparklineTitle, { color: p.textMuted }]}>
          {lang === 'ar' ? 'تكرار التنبيهات يومياً' : 'Daily alert frequency'}
        </Text>
        <View style={[sty.row, { gap: 10, marginStart: 'auto' }]}>
          <View style={sty.row}>
            <View style={[sty.sparklineDot, { backgroundColor: C.orange }]} />
            <Text style={[sty.sparklineLegend, { color: p.textFaint }]}>{lang === 'ar' ? 'منخفض' : 'Low'}</Text>
          </View>
          <View style={sty.row}>
            <View style={[sty.sparklineDot, { backgroundColor: C.red }]} />
            <Text style={[sty.sparklineLegend, { color: p.textFaint }]}>{lang === 'ar' ? 'نافد' : 'Out'}</Text>
          </View>
        </View>
      </View>

      {!hasAny ? (
        <View style={{ height: CHART_H, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={[sty.sparklineLegend, { color: p.textFaint }]}>
            {lang === 'ar' ? 'لا توجد تنبيهات في هذه الفترة' : 'No alerts in this period'}
          </Text>
        </View>
      ) : (
        <View style={[sty.row, { height: CHART_H, alignItems: 'flex-end', gap: BAR_GAP }]}>
          {allDays.map(d => {
            const lo  = lowMap.get(d)  ?? 0;
            const out = outMap.get(d)  ?? 0;
            const loH  = lo  > 0 ? Math.max(3, Math.round((lo  / maxVal) * CHART_H)) : 0;
            const outH = out > 0 ? Math.max(3, Math.round((out / maxVal) * CHART_H)) : 0;
            const total = lo + out;
            return (
              <View key={d} style={{ flex: 1, alignItems: 'center', gap: 1 }}>
                <View style={{ width: '100%', gap: 1, alignItems: 'center', justifyContent: 'flex-end', height: CHART_H }}>
                  {outH > 0 && (
                    <View style={{ width: '100%', height: outH, backgroundColor: C.red + 'CC', borderRadius: 2 }} />
                  )}
                  {loH > 0 && (
                    <View style={{ width: '100%', height: loH, backgroundColor: C.orange + 'CC', borderRadius: 2 }} />
                  )}
                  {total === 0 && (
                    <View style={{ width: '100%', height: 2, backgroundColor: p.border, borderRadius: 1 }} />
                  )}
                </View>
              </View>
            );
          })}
        </View>
      )}

      {range === 7 && (
        <View style={[sty.row, { gap: BAR_GAP, marginTop: 4 }]}>
          {allDays.map(d => {
            const dow = new Date(d + 'T00:00:00').getDay();
            return (
              <Text key={d} style={[sty.sparklineXLabel, { color: p.textFaint, flex: 1, textAlign: 'center' }]}>
                {lang === 'ar' ? dowAr[dow] : dowEn[dow]}
              </Text>
            );
          })}
        </View>
      )}
    </View>
  );
};

// ── Stock history line chart bottom sheet ─────────────────────────────────────
const SOURCE_LABELS: Record<string, string> = {
  order: 'Order',
  restock: 'Restock',
  edit: 'Manual edit',
  manual: 'Manual edit',
};

const RANGE_OPTIONS: { label: string; days: number }[] = [
  { label: '7d', days: 7 },
  { label: '30d', days: 30 },
  { label: '90d', days: 90 },
];

const StockChartSheet = ({
  product,
  onClose,
}: {
  product: { id: string; name: string } | null;
  onClose: () => void;
}) => {
  const p = usePalette();
  const chartW = W - 48;
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);
  const [rangeDays, setRangeDays] = useState<number>(30);

  // Reset selection and range when the product changes
  useEffect(() => { setSelectedIdx(null); setRangeDays(30); }, [product?.id]);

  // Compute the "since" ISO string based on the chosen range
  const sinceDate = useMemo(
    () => new Date(Date.now() - rangeDays * 24 * 60 * 60 * 1000).toISOString(),
    [rangeDays],
  );

  const { data: hist, isLoading, isError } = useQuery({
    queryKey: ['product-stock-history-chart', product?.id, rangeDays],
    enabled: !!product?.id,
    queryFn: () =>
      productsApi.getStockHistory(product!.id, { since: sinceDate }).then((r: any) => r.data as any[]),
    staleTime: 60_000,
  });

  // Also reset selection when history refreshes (prevents stale index after refetch).
  // Keyed on both length and the first entry's id so equal-length refreshes are also caught.
  const histKey = `${hist?.length ?? 0}:${hist?.[0]?.id ?? ''}`;
  useEffect(() => { setSelectedIdx(null); }, [histKey]);

  const chartData = useMemo(() => {
    if (!hist || hist.length === 0) return null;
    const rows = [...hist].reverse();
    const step = Math.ceil(rows.length / 6);
    const labels = rows.map((r: any, i: number) => {
      if (i % step !== 0) return '';
      const d = new Date(r.changed_at);
      return `${d.getMonth() + 1}/${d.getDate()}`;
    });
    const values = rows.map((r: any) => Math.max(0, parseInt(String(r.new_quantity ?? 0), 10) || 0));
    return { labels, values, rows };
  }, [hist]);

  const selectedEvent = (selectedIdx !== null && chartData?.rows)
    ? chartData.rows[selectedIdx] ?? null
    : null;

  const handleDataPointClick = useCallback(({ index }: { index: number }) => {
    haptic.select();
    setSelectedIdx(prev => (prev === index ? null : index));
  }, []);

  const formatTs = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
      + '  ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  };

  return (
    <Modal
      visible={!!product}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <TouchableOpacity style={sty.modalOverlay} activeOpacity={1} onPress={onClose}>
        <TouchableOpacity activeOpacity={1} style={[sty.modalSheet, { paddingHorizontal: 0 }]}>
          <View style={sty.modalHandle} />
          <View style={{ paddingHorizontal: 24, marginBottom: 12 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <Text style={[sty.modalTitle, { flex: 1, marginRight: 12 }]} numberOfLines={1}>{product?.name}</Text>
              <TouchableOpacity onPress={onClose} style={sty.modalClose}>
                <Ionicons name="close" size={18} color={C.text} />
              </TouchableOpacity>
            </View>
            {/* Date range chip toggle */}
            <View style={{ flexDirection: 'row', gap: 8 }}>
              {RANGE_OPTIONS.map(opt => {
                const active = rangeDays === opt.days;
                return (
                  <TouchableOpacity
                    key={opt.days}
                    onPress={() => { setRangeDays(opt.days); setSelectedIdx(null); }}
                    style={{
                      paddingHorizontal: 14,
                      paddingVertical: 5,
                      borderRadius: 20,
                      borderWidth: 1,
                      borderColor: active ? C.cyan : 'rgba(255,255,255,0.15)',
                      backgroundColor: active ? 'rgba(0,229,255,0.12)' : 'transparent',
                    }}
                  >
                    <Text style={{ fontSize: 12, fontWeight: '600', color: active ? C.cyan : C.textFaint }}>
                      {opt.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
          {isLoading ? (
            <View style={{ paddingVertical: 48, alignItems: 'center' }}>
              <ActivityIndicator color={C.gold} />
            </View>
          ) : isError ? (
            <View style={{ paddingVertical: 40, alignItems: 'center', gap: 8, paddingHorizontal: 24 }}>
              <Ionicons name="alert-circle-outline" size={32} color={C.red} />
              <Text style={{ color: C.textMuted, fontSize: 13, textAlign: 'center' }}>Failed to load chart data</Text>
            </View>
          ) : !chartData ? (
            <View style={{ paddingVertical: 40, alignItems: 'center', gap: 8, paddingHorizontal: 24 }}>
              <Ionicons name="analytics-outline" size={32} color={C.textFaint} />
              <Text style={{ color: C.textMuted, fontSize: 13, textAlign: 'center' }}>No stock changes recorded yet</Text>
            </View>
          ) : (
            <View style={{ overflow: 'hidden' }}>
              <LineChart
                data={{
                  labels: chartData.labels,
                  datasets: [{ data: chartData.values, color: () => C.cyan, strokeWidth: 2 }],
                }}
                width={chartW + 48}
                height={220}
                withDots={true}
                withShadow={false}
                withInnerLines={true}
                withOuterLines={false}
                withVerticalLabels={true}
                withHorizontalLabels={true}
                chartConfig={{
                  backgroundColor: 'transparent',
                  backgroundGradientFrom: '#0F0F1A',
                  backgroundGradientTo: '#0F0F1A',
                  color: () => C.cyan,
                  labelColor: () => C.textFaint,
                  strokeWidth: 2,
                  propsForDots: {
                    r: chartData.values.length <= 20 ? '5' : '3',
                    fill: C.cyan,
                    strokeWidth: '2',
                    stroke: '#0F0F1A',
                  },
                  propsForBackgroundLines: { stroke: 'rgba(255,255,255,0.07)' },
                  decimalPlaces: 0,
                }}
                onDataPointClick={handleDataPointClick}
                bezier
                style={{ marginLeft: -24 }}
              />
              <View style={{ paddingHorizontal: 24, paddingTop: 6, flexDirection: 'row', justifyContent: 'space-between' }}>
                <Text style={{ fontSize: 11, color: C.textFaint }}>
                  {hist!.length} change{hist!.length !== 1 ? 's' : ''} recorded
                </Text>
                <Text style={{ fontSize: 11, color: C.cyan }}>
                  Current: {chartData.values[chartData.values.length - 1]} units
                </Text>
              </View>

              {/* Tap-to-inspect hint when nothing is selected */}
              {selectedIdx === null && (
                <View style={{ paddingHorizontal: 24, paddingTop: 8, paddingBottom: 4, alignItems: 'center' }}>
                  <Text style={{ fontSize: 11, color: C.textFaint, fontStyle: 'italic' }}>
                    Tap a dot for change details
                  </Text>
                </View>
              )}

              {/* Selected event detail card */}
              {selectedEvent && (
                <View style={{
                  marginHorizontal: 24, marginTop: 12, marginBottom: 4,
                  backgroundColor: 'rgba(0,229,255,0.06)',
                  borderWidth: 1, borderColor: 'rgba(0,229,255,0.18)',
                  borderRadius: 12, padding: 14, gap: 10,
                }}>
                  {/* Header row */}
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                    <View style={{
                      flexDirection: 'row', alignItems: 'center', gap: 6,
                      backgroundColor: 'rgba(0,229,255,0.12)',
                      borderRadius: 20, paddingHorizontal: 10, paddingVertical: 3,
                    }}>
                      <Ionicons
                        name={
                          selectedEvent.source === 'order' ? 'cart-outline'
                          : selectedEvent.source === 'restock' ? 'add-circle-outline'
                          : 'create-outline'
                        }
                        size={13}
                        color={C.cyan}
                      />
                      <Text style={{ fontSize: 12, color: C.cyan, fontWeight: '600' }}>
                        {SOURCE_LABELS[selectedEvent.source] ?? selectedEvent.source ?? 'Unknown'}
                      </Text>
                    </View>
                    <TouchableOpacity onPress={() => setSelectedIdx(null)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                      <Ionicons name="close-circle" size={18} color="rgba(255,255,255,0.3)" />
                    </TouchableOpacity>
                  </View>

                  {/* Quantity change */}
                  {(() => {
                    const newQty = selectedEvent.new_quantity != null ? Number(selectedEvent.new_quantity) : null;
                    const oldQty = selectedEvent.old_quantity != null ? Number(selectedEvent.old_quantity) : null;
                    const delta = (newQty != null && oldQty != null) ? newQty - oldQty : null;
                    const isUp = delta != null ? delta >= 0 : true;
                    return (
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                        <Text style={{ fontSize: 24, fontWeight: '700', color: C.textFaint, fontVariant: ['tabular-nums'] }}>
                          {oldQty ?? '?'}
                        </Text>
                        <Ionicons name="arrow-forward" size={16} color={C.textFaint} />
                        <Text style={{
                          fontSize: 24, fontWeight: '700', fontVariant: ['tabular-nums'],
                          color: isUp ? C.cyan : '#FF6B6B',
                        }}>
                          {newQty ?? '?'}
                        </Text>
                        <Text style={{ fontSize: 13, color: C.textFaint, marginLeft: 2 }}>units</Text>
                        {delta != null && (
                          <View style={{
                            marginLeft: 'auto',
                            backgroundColor: isUp ? 'rgba(0,229,255,0.12)' : 'rgba(255,107,107,0.12)',
                            borderRadius: 8, paddingHorizontal: 8, paddingVertical: 2,
                          }}>
                            <Text style={{ fontSize: 12, fontWeight: '600', color: isUp ? C.cyan : '#FF6B6B' }}>
                              {isUp ? '+' : ''}{delta}
                            </Text>
                          </View>
                        )}
                      </View>
                    );
                  })()}

                  {/* Meta row: who + when */}
                  <View style={{ gap: 4 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      <Ionicons name="person-outline" size={12} color={C.textFaint} />
                      <Text style={{ fontSize: 12, color: C.textMuted }}>
                        {selectedEvent.changed_by_user_name ?? selectedEvent.changed_by_name ?? 'System'}
                      </Text>
                    </View>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      <Ionicons name="time-outline" size={12} color={C.textFaint} />
                      <Text style={{ fontSize: 12, color: C.textMuted }}>
                        {selectedEvent.changed_at ? formatTs(selectedEvent.changed_at) : 'Unknown time'}
                      </Text>
                    </View>
                  </View>
                </View>
              )}
            </View>
          )}
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
};

const StatBar = ({ label, value, max, color }: { label: string; value: number; max: number; color: string }) => {
  const p = usePalette();
  const pct = max > 0 ? Math.max((value / max) * 100, value > 0 ? 4 : 0) : 0;
  return (
    <View style={sty.statBarRow}>
      <Text style={[sty.statBarLabel, { color: p.textMuted }]}>{label}</Text>
      <View style={[sty.statBarTrack, { backgroundColor: p.surfaceHi }]}>
        <LinearGradient
          colors={[color, color + 'AA']}
          start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
          style={[sty.statBarFill, { width: `${pct}%` as any }]}
        />
      </View>
      <Text style={[sty.statBarNum, { color }]}>{value}</Text>
    </View>
  );
};

const EmptyPlaceholder = ({ icon, msg }: { icon: string; msg: string }) => {
  const p = usePalette();
  return (
    <View style={sty.emptyWrap}>
      <View style={[sty.emptyIconBg, { backgroundColor: p.goldMuted, borderColor: p.goldBorder }]}>
        <Ionicons name={icon as any} size={36} color={p.gold} />
      </View>
      <Text style={[sty.emptyText, { color: p.textMuted }]}>{msg}</Text>
    </View>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Order card — expandable with 3 food-focused detail tabs + status management
// ─────────────────────────────────────────────────────────────────────────────
type OrderDetailTab = 'components' | 'values' | 'info';

// Strict forward-only flow for restaurant staff (no shipped/cancelled)
const STATUS_FLOW = ['pending', 'confirmed', 'preparing', 'ready', 'delivered'] as const;

const OrderCard = ({
  order, lang, isRTL, expanded, onToggle, onStatusChange, statusChanging, canMutateStatus, onPrintRow,
}: {
  order: any; lang: string; isRTL: boolean;
  expanded: boolean; onToggle: () => void;
  onStatusChange: (orderId: string, status: string) => void;
  statusChanging: boolean;
  /** false for admin role: status controls are hidden (backend also rejects admin mutations) */
  canMutateStatus: boolean;
  /** Per-row thermal print — opens chooser modal */
  onPrintRow: (order: any) => void;
}) => {
  const [detailTab, setDetailTab] = useState<OrderDetailTab>('components');
  const p = usePalette();

  const name  = order.customer_name  || order.user_name  || order.joined_user_name  || '—';
  const email = order.customer_email || order.user_email || order.joined_user_email || '';
  const phone = order.customer_phone || order.user_phone || order.joined_user_phone || '';
  const total = parseFloat(String(order.total_amount || 0));
  const shipping = parseFloat(String(order.shipping_cost || 0));
  const subtotal = total - shipping;
  const date  = order.created_at
    ? new Date(order.created_at).toLocaleDateString(
        lang === 'ar' ? 'ar-EG' : 'en-US', { day: 'numeric', month: 'short', year: 'numeric' },
      )
    : '—';

  // Display per-restaurant sequential number (stable CTE rank) alongside global order number
  const displayNum = order.restaurant_order_number
    ? `R-${order.restaurant_order_number} • #${order.order_number || order.id?.slice(0, 8)}`
    : `#${order.order_number || order.id?.slice(0, 8)}`;

  // Parse items from JSONB
  const items: any[] = (() => {
    try {
      if (Array.isArray(order.items)) return order.items;
      if (typeof order.items === 'string') return JSON.parse(order.items);
    } catch {}
    return [];
  })();

  // Distinct order-level sizes (excluding STD). Both the summary FitmentStrip
  // and the per-dish pills inside the Components detail tab use this — the
  // pills only render when the order spans ≥2 distinct sizes (matches the
  // ProductCard rule so single-size orders stay visually clean).
  const orderSizes: string[] = Array.from(new Set(
    items
      .map((it: any) => it?.fitment_indicator || it?.size || it?.product_fitment_indicator)
      .filter((s: any) => s && s !== 'STD'),
  )) as string[];
  const showItemSizePills = orderSizes.length >= 2;

  const DETAIL_TABS: { key: OrderDetailTab; label: string; labelAr: string; icon: string }[] = [
    { key: 'components', label: 'Components', labelAr: 'مكونات الطبق',  icon: 'fast-food-outline'  },
    { key: 'values',     label: 'Values',     labelAr: 'القيم الغذائية', icon: 'bar-chart-outline'  },
    { key: 'info',       label: 'Info',       labelAr: 'معلومات الطبق',  icon: 'information-circle-outline' },
  ];

  // For terminal/legacy statuses (shipped, cancelled) not in STATUS_FLOW,
  // treat as a completed terminal state where all pills are locked.
  const isTerminal = !STATUS_FLOW.includes(order.status as any);
  const currentStatusIdx = isTerminal ? STATUS_FLOW.length : STATUS_FLOW.indexOf(order.status as any);

  return (
    <TouchableOpacity activeOpacity={0.85} onPress={() => { haptic.tap(); onToggle(); }}
      style={[sty.card, { backgroundColor: p.surface, borderColor: p.border }]}>
      <LinearGradient
        colors={expanded ? ['rgba(255,215,0,0.08)', 'rgba(255,215,0,0.02)'] : ['rgba(255,215,0,0.04)', 'transparent']}
        style={StyleSheet.absoluteFill}
      />
      {/* Top row */}
      <View style={[sty.row, isRTL && sty.rowRev, { marginBottom: 8 }]}>
        <Text style={[sty.orderNum, { color: (p as any).accent || p.text, flex: 1 }]}>{displayNum}</Text>
        <StatusBadge status={order.status || 'pending'} type="order" lang={lang} />
        {/* Map icon — visible whenever the order has GPS coords or a text address */}
        {(order.delivery_latitude != null && order.delivery_longitude != null) || order.delivery_address || order.street_address ? (
          <TouchableOpacity
            onPress={(e) => {
              e.stopPropagation?.();
              haptic.tap();
              let url: string;
              if (order.delivery_latitude != null && order.delivery_longitude != null) {
                url = `https://maps.google.com/?q=${order.delivery_latitude},${order.delivery_longitude}`;
              } else {
                const addr = encodeURIComponent(
                  [order.delivery_address, order.street_address, order.city].filter(Boolean).join(', ')
                );
                url = `https://maps.google.com/?q=${addr}`;
              }
              if (Platform.OS === 'web') { window.open(url, '_blank'); }
              else { Linking.openURL(url).catch(() => {}); }
            }}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            accessibilityLabel={lang === 'ar' ? 'فتح في خرائط جوجل' : 'Open in Google Maps'}
          >
            <Ionicons name="location" size={16} color={p.gold} />
          </TouchableOpacity>
        ) : null}
        <TouchableOpacity
          onPress={(e) => { e.stopPropagation?.(); haptic.tap(); onPrintRow(order); }}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          accessibilityLabel={lang === 'ar' ? 'طباعة حرارية' : 'Thermal print'}
        >
          <Ionicons name="print-outline" size={16} color={(p as any).accent || p.text} />
        </TouchableOpacity>
        <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={14} color={p.textFaint} />
      </View>
      {/* Summary row */}
      <View style={[sty.row, isRTL && sty.rowRev, { justifyContent: 'space-between' }]}>
        <View style={[sty.row, isRTL && sty.rowRev]}>
          <Ionicons name="person-outline" size={12} color={p.textMuted} />
          <Text style={[sty.cardMeta, { color: p.textMuted }]} numberOfLines={1}>{name}</Text>
        </View>
        <View style={[sty.row, isRTL && sty.rowRev]}>
          <Ionicons name="restaurant-outline" size={12} color={p.textFaint} />
          <Text style={[sty.cardMeta, { color: p.textFaint }]}>{items.length} {lang === 'ar' ? 'طبق' : 'dishes'}</Text>
        </View>
        <Text style={[sty.orderTotal, { color: p.gold }]}>{total.toFixed(0)} ج.م</Text>
      </View>

      {/* ── Inline size indicators — only when items contain ≥2 distinct sizes.
          Honors the same rule as ProductCard: single-size orders stay clean. */}
      {showItemSizePills && (
        <View style={{ marginTop: 8 }}>
          <FitmentStrip
            mode="display"
            size="sm"
            variants={orderSizes.map((s) => ({ indicator: s }))}
            emphasizeSelection={false}
          />
        </View>
      )}

      {/* ── Expanded detail section ── */}
      {expanded && (
        <>
          <Divider />

          {/* ── Status changer — forward-only; hidden for read-only admin role ── */}
          {canMutateStatus && (
            <>
              <View style={{ marginBottom: 8 }}>
                <Text style={[sty.cardMeta, { marginBottom: 6, color: p.textFaint }]}>
                  {lang === 'ar' ? 'تقدّم الطلب:' : 'Order progress:'}
                </Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
                  {isTerminal ? (
                    <View style={[sty.statusPill, { borderColor: p.textFaint + '33', backgroundColor: p.surfaceHi, opacity: 0.7 }]}>
                      <Ionicons name="lock-closed-outline" size={10} color={p.textFaint} />
                      <Text style={[sty.statusPillText, { color: p.textFaint }]}>
                        {lang === 'ar' ? `حالة نهائية: ${ORDER_STATUS[order.status]?.labelAr ?? order.status}` : `Terminal: ${order.status}`}
                      </Text>
                    </View>
                  ) : (
                    STATUS_FLOW.map((s, idx) => {
                      const info = ORDER_STATUS[s];
                      const isCurrent = order.status === s;
                      const isPast = idx < currentStatusIdx;
                      const isFuture = idx > currentStatusIdx;
                      const isDisabled = isCurrent || isPast || statusChanging;
                      return (
                        <TouchableOpacity
                          key={s}
                          disabled={isDisabled}
                          onPress={(e) => { e.stopPropagation?.(); onStatusChange(order.id, s); }}
                          style={[
                            sty.statusPill,
                            {
                              borderColor: isPast ? p.textFaint + '33' : info.color + '66',
                              backgroundColor: isCurrent
                                ? info.color + '25'
                                : isPast ? p.surfaceHi : p.surface,
                              opacity: isPast ? 0.45 : 1,
                            },
                          ]}
                        >
                          <Ionicons
                            name={isPast ? 'checkmark-circle' : (info.icon as any)}
                            size={10}
                            color={isPast ? p.textFaint : info.color}
                          />
                          <Text style={[sty.statusPillText, { color: isCurrent ? info.color : isPast ? p.textFaint : p.textMuted }]}>
                            {lang === 'ar' ? info.labelAr : info.label}
                          </Text>
                          {isCurrent && <Ionicons name="checkmark" size={10} color={info.color} />}
                          {isFuture && !isCurrent && (
                            <Ionicons name="chevron-forward" size={8} color={p.textFaint} />
                          )}
                        </TouchableOpacity>
                      );
                    })
                  )}
                </ScrollView>
              </View>
              <Divider />
            </>
          )}
          {/* Detail tab bar — uses cool accent (cyan-blue dark / navy light)
              instead of yellow so the gold tone remains exclusive to the
              order grand total. */}
          <View style={sty.detailTabBar}>
            {DETAIL_TABS.map(t => (
              <TouchableOpacity
                key={t.key}
                style={[
                  sty.detailTabItem,
                  detailTab === t.key && {
                    backgroundColor: (p as any).accentSoft ?? p.surfaceHi,
                    borderColor: (p as any).accentBorder ?? p.border,
                  },
                ]}
                onPress={(e) => { e.stopPropagation?.(); setDetailTab(t.key); }}
              >
                <Ionicons
                  name={t.icon as any}
                  size={11}
                  color={detailTab === t.key ? p.accent : p.textFaint}
                  style={{ marginBottom: 2 }}
                />
                <Text style={[
                  sty.detailTabLabel,
                  detailTab === t.key && { color: p.accent, fontWeight: '700' },
                ]}>
                  {lang === 'ar' ? t.labelAr : t.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* ── Tab 1: مكونات الطبق — Dish components with image + description + price ── */}
          {detailTab === 'components' && (
            <View style={{ marginTop: 8, gap: 8 }}>
              {items.length === 0 ? (
                <Text style={[sty.cardMeta, { textAlign: 'center', paddingVertical: 8 }]}>
                  {lang === 'ar' ? 'لا توجد مكونات' : 'No dish components'}
                </Text>
              ) : (
                items.map((item: any, idx: number) => {
                  const itemName = lang === 'ar'
                    ? (item.name_ar || item.product_name_ar || item.name || item.product_name || `طبق ${idx + 1}`)
                    : (item.name || item.product_name || item.name_ar || `Dish ${idx + 1}`);
                  const description = lang === 'ar'
                    ? (item.description_ar || item.description || '')
                    : (item.description || item.description_ar || '');
                  const qty   = item.quantity ?? 1;
                  const price = parseFloat(String(item.unit_price || item.final_unit_price || item.original_unit_price || item.price || 0));
                  const imgUrl = item.image_url || (Array.isArray(item.images) ? item.images[0] : null) || null;
                  const itemSize: string | null = item?.fitment_indicator || item?.size || item?.product_fitment_indicator || null;
                  const showThisPill = showItemSizePills && !!itemSize && itemSize !== 'STD';
                  return (
                    <View
                      key={idx}
                      style={{ backgroundColor: p.surface, borderRadius: 12, padding: 10, gap: 8, borderWidth: 1, borderColor: p.border }}
                    >
                      {/* Image + name row */}
                      <View style={[sty.row, isRTL && sty.rowRev, { justifyContent: 'space-between' }]}>
                        {imgUrl ? (
                          <Image source={{ uri: imgUrl }} style={sty.dishThumb} contentFit="cover" />
                        ) : (
                          <View style={[sty.dishThumb, { backgroundColor: p.goldMuted, alignItems: 'center', justifyContent: 'center' }]}>
                            <Ionicons name="fast-food" size={16} color={p.gold} />
                          </View>
                        )}
                        <View style={{ flex: 1, marginHorizontal: 8 }}>
                          {/* Name + per-dish accent size pill (rendered only
                              when this order spans ≥2 distinct sizes — gold
                              stays reserved for the order grand total). */}
                          <View style={[sty.row, isRTL && sty.rowRev, { gap: 6, flexWrap: 'wrap' }]}>
                            <Text style={[sty.itemName, { color: p.text, flexShrink: 1 }]} numberOfLines={2}>{itemName}</Text>
                            {showThisPill && (
                              <View
                                style={{
                                  paddingHorizontal: 7,
                                  paddingVertical: 2,
                                  borderRadius: 999,
                                  borderWidth: 1,
                                  borderColor: ((p as any).accentBorder ?? (p as any).accent ?? p.border) as string,
                                  backgroundColor: ((p as any).accentSoft ?? p.surfaceHi) as string,
                                }}
                              >
                                <Text style={{ fontSize: 10, fontWeight: '700', color: ((p as any).accent ?? p.text) as string }}>
                                  {itemSize}
                                </Text>
                              </View>
                            )}
                          </View>
                          {description ? (
                            <Text style={[sty.cardMeta, { color: p.textMuted, marginTop: 3, lineHeight: 16 }]} numberOfLines={3}>
                              {description}
                            </Text>
                          ) : null}
                        </View>
                        {/* Clean price block — accent (cool navy/cyan) instead
                            of gold so per-item prices don't compete with the
                            order's grand total. */}
                        <View style={{ alignItems: 'flex-end' }}>
                          <Text style={[sty.itemPrice, { color: p.accent }]}>{price.toFixed(0)} ج.م</Text>
                          <Text style={[sty.cardMeta, { color: p.textMuted, marginTop: 2 }]}>× {qty}</Text>
                        </View>
                      </View>
                      {/* Component total */}
                      <View style={[sty.row, isRTL && sty.rowRev, { justifyContent: 'space-between', borderTopWidth: 1, borderTopColor: p.border, paddingTop: 6 }]}>
                        <Text style={[sty.cardMeta, { color: p.textFaint }]}>
                          {lang === 'ar' ? 'إجمالي المكوّن' : 'Component total'}
                        </Text>
                        <Text style={[sty.itemPrice, { color: p.accent }]}>{(price * qty).toFixed(0)} ج.م</Text>
                      </View>
                    </View>
                  );
                })
              )}
            </View>
          )}

          {/* ── Tab 2: القيم الغذائية — Nutritional values from product data ── */}
          {detailTab === 'values' && (
            <View style={{ marginTop: 8, gap: 8 }}>
              {items.length === 0 ? (
                <Text style={[sty.cardMeta, { textAlign: 'center', paddingVertical: 8 }]}>
                  {lang === 'ar' ? 'لا توجد بيانات غذائية' : 'No nutritional data'}
                </Text>
              ) : (
                items.map((item: any, idx: number) => {
                  const itemName = lang === 'ar'
                    ? (item.name_ar || item.product_name_ar || item.name || item.product_name || `طبق ${idx + 1}`)
                    : (item.name || item.product_name || item.name_ar || `Dish ${idx + 1}`);
                  const qty = item.quantity ?? 1;
                  // nutrition field from enriched product JOIN
                  const nutr = item.nutrition
                    ? (typeof item.nutrition === 'string' ? (() => { try { return JSON.parse(item.nutrition); } catch { return null; } })() : item.nutrition)
                    : null;
                  const calories = nutr?.calories ?? null;
                  const protein  = nutr?.protein  ?? null;
                  const carbs    = nutr?.carbs     ?? null;
                  const fat      = nutr?.fat       ?? null;
                  const hasNutr  = calories !== null || protein !== null || carbs !== null || fat !== null;

                  const NutrRow = ({ label, value, unit, color }: { label: string; value: number | null; unit: string; color: string }) => (
                    <View style={[sty.row, isRTL && sty.rowRev, { justifyContent: 'space-between', paddingVertical: 4 }]}>
                      <Text style={[sty.cardMeta, { color: p.textFaint }]}>{label}</Text>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                        <Text style={[sty.cardMeta, { color: value !== null ? color : p.textFaint, fontWeight: '600' }]}>
                          {value !== null ? value.toFixed(1) : '—'}
                        </Text>
                        {value !== null && <Text style={[sty.cardMeta, { color: p.textFaint }]}>{unit}</Text>}
                      </View>
                    </View>
                  );

                  return (
                    <View key={idx} style={{ backgroundColor: p.surface, borderRadius: 12, padding: 12, borderWidth: 1, borderColor: p.border }}>
                      {/* Dish name + qty */}
                      <View style={[sty.row, isRTL && sty.rowRev, { justifyContent: 'space-between', marginBottom: 8 }]}>
                        <Text style={[sty.itemName, { color: p.text }]} numberOfLines={1}>{itemName}</Text>
                        <View style={{ paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8, backgroundColor: (p as any).accentSoft ?? p.surfaceHi, borderWidth: 1, borderColor: (p as any).accentBorder ?? p.border }}>
                          <Text style={[sty.cardMeta, { color: p.accent, fontWeight: '700' }]}>× {qty}</Text>
                        </View>
                      </View>
                      {hasNutr ? (
                        <>
                          <View style={{ height: 1, backgroundColor: p.border, marginBottom: 8 }} />
                          <NutrRow label={lang === 'ar' ? 'السعرات' : 'Calories'} value={calories} unit="kcal" color={C.orange} />
                          <NutrRow label={lang === 'ar' ? 'البروتين' : 'Protein'}  value={protein}  unit="g"    color={C.blue} />
                          <NutrRow label={lang === 'ar' ? 'الكربوهيدرات' : 'Carbs'} value={carbs}   unit="g"    color={C.cyan} />
                          <NutrRow label={lang === 'ar' ? 'الدهون' : 'Fat'}        value={fat}      unit="g"    color={C.red} />
                          {qty > 1 && (
                            <Text style={[sty.cardMeta, { color: p.textFaint, marginTop: 6, fontStyle: 'italic' }]}>
                              {lang === 'ar' ? `× ${qty} حصص` : `× ${qty} servings`}
                            </Text>
                          )}
                        </>
                      ) : (
                        <Text style={[sty.cardMeta, { color: p.textFaint, fontStyle: 'italic' }]}>
                          {lang === 'ar' ? 'لا تتوفر بيانات غذائية لهذا الطبق' : 'No nutritional data for this dish'}
                        </Text>
                      )}
                    </View>
                  );
                })
              )}
            </View>
          )}

          {/* ── Tab 3: معلومات الطبق — Order summary + customer & delivery info ── */}
          {detailTab === 'info' && (
            <View style={{ marginTop: 8, gap: 8 }}>
              {/* Order financials summary */}
              <View style={{ backgroundColor: p.surfaceHi, borderRadius: 12, padding: 12, gap: 6, borderWidth: 1, borderColor: p.border }}>
                <Text style={[sty.cardMeta, { color: p.textFaint, marginBottom: 4, fontWeight: '600' }]}>
                  {lang === 'ar' ? 'ملخص الفاتورة' : 'Order Summary'}
                </Text>
                {/* Subtotal per line item */}
                {items.length > 0 && items.map((item: any, idx: number) => {
                  const itemName = lang === 'ar'
                    ? (item.name_ar || item.product_name_ar || item.name || item.product_name || `طبق ${idx + 1}`)
                    : (item.name || item.product_name || item.name_ar || `Dish ${idx + 1}`);
                  const qty   = item.quantity ?? 1;
                  const price = parseFloat(String(item.unit_price || item.final_unit_price || item.original_unit_price || item.price || 0));
                  return (
                    <View key={idx} style={[sty.row, isRTL && sty.rowRev, { justifyContent: 'space-between' }]}>
                      <Text style={[sty.cardMeta, { color: p.textMuted, flex: 1 }]} numberOfLines={1}>
                        {itemName}{qty > 1 ? ` × ${qty}` : ''}
                      </Text>
                      <Text style={[sty.cardMeta, { color: p.text }]}>{(price * qty).toFixed(0)} ج.م</Text>
                    </View>
                  );
                })}
                {/* Divider */}
                <View style={{ height: 1, backgroundColor: p.border, marginVertical: 4 }} />
                {/* Subtotal */}
                <View style={[sty.row, isRTL && sty.rowRev, { justifyContent: 'space-between' }]}>
                  <Text style={[sty.cardMeta, { color: p.textMuted }]}>{lang === 'ar' ? 'المجموع الفرعي' : 'Subtotal'}</Text>
                  <Text style={[sty.cardMeta, { color: p.text }]}>{subtotal.toFixed(0)} ج.م</Text>
                </View>
                {/* Shipping */}
                {shipping > 0 && (
                  <View style={[sty.row, isRTL && sty.rowRev, { justifyContent: 'space-between', alignItems: 'center' }]}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, flex: 1, flexWrap: 'wrap' }}>
                      <Text style={[sty.cardMeta, { color: p.textMuted }]}>{lang === 'ar' ? 'الشحن' : 'Shipping'}</Text>
                      {String(order.notes || '').includes('delivery_discount:subscriber_single_restaurant') && (
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2, backgroundColor: 'rgba(122,31,43,0.12)', borderWidth: 1, borderColor: 'rgba(122,31,43,0.35)', paddingHorizontal: 4, paddingVertical: 1, borderRadius: 5 }}>
                          <Text style={{ fontSize: 8, fontWeight: '700', color: '#7A1F2B' }}>
                            {lang === 'ar' ? '⭐ خصم مشترك' : '⭐ Sub'}
                          </Text>
                        </View>
                      )}
                    </View>
                    <Text style={[sty.cardMeta, { color: p.textMuted }]}>{shipping.toFixed(0)} ج.م</Text>
                  </View>
                )}
                {/* Grand total */}
                <View style={[sty.row, isRTL && sty.rowRev, { justifyContent: 'space-between', marginTop: 2 }]}>
                  <Text style={[sty.cardMeta, { color: p.gold, fontWeight: '700' }]}>{lang === 'ar' ? 'الإجمالي' : 'Total'}</Text>
                  <Text style={[sty.itemPrice, { color: p.goldBright }]}>{total.toFixed(0)} ج.م</Text>
                </View>
              </View>

              {/* Customer & delivery details */}
              <DetailRow icon="person-outline"   label={lang === 'ar' ? 'الاسم'    : 'Name'}    value={name}  isRTL={isRTL} />
              {email ? <DetailRow icon="mail-outline"   label={lang === 'ar' ? 'البريد'  : 'Email'}   value={email} isRTL={isRTL} /> : null}
              {phone ? <DetailRow icon="call-outline"   label={lang === 'ar' ? 'الهاتف'  : 'Phone'}   value={phone} isRTL={isRTL} /> : null}
              {(order.street_address || order.city || order.delivery_address) ? (
                <DetailRow
                  icon="location-outline"
                  label={lang === 'ar' ? 'العنوان' : 'Address'}
                  value={[
                    order.delivery_address,
                    order.street_address,
                    order.city,
                    order.state,
                  ].filter(Boolean).join(', ')}
                  isRTL={isRTL}
                />
              ) : null}
              {/* Quick-jump to Google Maps when the customer GPS-tagged the
                  order at checkout. Falls back to no row if no coords. */}
              {order.delivery_latitude != null && order.delivery_longitude != null ? (
                <TouchableOpacity
                  activeOpacity={0.7}
                  onPress={(e) => {
                    e.stopPropagation?.();
                    const lat = order.delivery_latitude;
                    const lng = order.delivery_longitude;
                    const url = `https://maps.google.com/?q=${lat},${lng}`;
                    if (Platform.OS === 'web') {
                      window.open(url, '_blank');
                    } else {
                      Linking.openURL(url).catch(() => {});
                    }
                  }}
                  style={[sty.row, isRTL && sty.rowRev, {
                    gap: 8,
                    paddingVertical: 6,
                    paddingHorizontal: 10,
                    borderRadius: 8,
                    backgroundColor: p.gold + '15',
                    borderWidth: 1,
                    borderColor: p.gold + '40',
                    marginTop: 4,
                    alignSelf: isRTL ? 'flex-end' : 'flex-start',
                  }]}
                >
                  <Ionicons name="navigate" size={14} color={p.goldBright} />
                  <Text style={{ color: p.goldBright, fontSize: 12, fontWeight: '700' }}>
                    {lang === 'ar' ? 'فتح في خرائط جوجل' : 'Open in Google Maps'}
                  </Text>
                </TouchableOpacity>
              ) : null}
              <DetailRow icon="calendar-outline" label={lang === 'ar' ? 'التاريخ'  : 'Date'}    value={date}  isRTL={isRTL} />
              <DetailRow
                icon="flag-outline"
                label={lang === 'ar' ? 'الحالة' : 'Status'}
                value={lang === 'ar' ? (ORDER_STATUS[order.status as keyof typeof ORDER_STATUS]?.labelAr ?? order.status) : (order.status ?? '—')}
                isRTL={isRTL}
              />
            </View>
          )}
        </>
      )}
    </TouchableOpacity>
  );
};

// Tiny helper for customer detail rows
const DetailRow = ({ icon, label, value, isRTL }: { icon: string; label: string; value: string; isRTL: boolean }) => {
  const dp = usePalette();
  return (
    <View style={[sty.row, isRTL && sty.rowRev, { gap: 8 }]}>
      <Ionicons name={icon as any} size={13} color={dp.textMuted} />
      <Text style={[sty.cardMeta, { width: 60, color: dp.textFaint }]}>{label}</Text>
      <Text style={[sty.cardDetail, { flex: 1, color: dp.text, textAlign: isRTL ? 'right' : 'left' }]} numberOfLines={2}>{value}</Text>
    </View>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Appointment card
// ─────────────────────────────────────────────────────────────────────────────
const AppointmentCard = ({ appt, lang, isRTL, onConfirm, onCancel, onComplete, onNoShow, mutatingId }: {
  appt: any; lang: string; isRTL: boolean;
  onConfirm?: (id: string) => void;
  onCancel?: (id: string) => void;
  onComplete?: (id: string) => void;
  onNoShow?: (id: string) => void;
  mutatingId?: string | null;
}) => {
  const ap = usePalette();
  const isMutating = mutatingId === appt.id;
  const status = (appt.status || 'pending').toLowerCase();
  // Terminal states: a card that's already completed/cancelled/no_show
  // doesn't expose mutation buttons. Confirm only makes sense from
  // pending. Complete and No-show are post-arrival outcomes for a
  // confirmed booking.
  const isTerminal = status === 'completed' || status === 'cancelled' || status === 'no_show';
  const canConfirm  = onConfirm  && !isTerminal && status !== 'confirmed';
  const canCancel   = onCancel   && !isTerminal;
  const canComplete = onComplete && !isTerminal && status === 'confirmed';
  const canNoShow   = onNoShow   && !isTerminal && status === 'confirmed';
  const apptDate = appt.appointment_date ? new Date(appt.appointment_date) : null;
  const tableNum = appt.service_type?.startsWith('table_')
    ? appt.service_type.replace('table_', '') : null;
  const serviceLabel = tableNum
    ? `${lang === 'ar' ? 'طاولة' : 'Table'} ${tableNum}`
    : appt.service_type ?? (lang === 'ar' ? 'حجز' : 'Booking');
  return (
    <View style={[sty.card, { backgroundColor: ap.surface, borderColor: ap.border }]}>
      <LinearGradient colors={['rgba(0,229,255,0.03)', 'transparent']} style={StyleSheet.absoluteFill} />
      <View style={[sty.row, isRTL && sty.rowRev, { marginBottom: 8 }]}>
        <View style={sty.apptServiceBadge}>
          <Ionicons name="restaurant-outline" size={12} color={C.cyan} />
          <Text style={[sty.badgeText, { color: C.cyan }]}>{serviceLabel}</Text>
        </View>
        <StatusBadge status={appt.status || 'pending'} type="appt" lang={lang} />
      </View>
      {appt.user_name ? (
        <View style={[sty.row, isRTL && sty.rowRev, { marginBottom: 4 }]}>
          <Ionicons name="person-outline" size={13} color={ap.textMuted} />
          <Text style={[sty.cardDetail, { color: ap.text }]}>{appt.user_name}</Text>
        </View>
      ) : null}
      {appt.user_email ? (
        <View style={[sty.row, isRTL && sty.rowRev, { marginBottom: 4 }]}>
          <Ionicons name="mail-outline" size={13} color={ap.textMuted} />
          <Text style={[sty.cardDetail, { color: ap.text }]} numberOfLines={1}>{appt.user_email}</Text>
        </View>
      ) : null}
      {appt.user_phone ? (
        <View style={[sty.row, isRTL && sty.rowRev, { marginBottom: 4 }]}>
          <Ionicons name="call-outline" size={13} color={ap.textMuted} />
          <Text style={[sty.cardDetail, { color: ap.text }]}>{appt.user_phone}</Text>
        </View>
      ) : null}
      {appt.notes ? (
        <View style={[sty.row, isRTL && sty.rowRev, { marginBottom: 4 }]}>
          <Ionicons name="document-text-outline" size={13} color={ap.textMuted} />
          <Text style={[sty.cardDetail, { color: ap.text }]} numberOfLines={2}>{appt.notes}</Text>
        </View>
      ) : null}
      <Divider />
      <View style={[sty.row, isRTL && sty.rowRev, { justifyContent: 'space-between' }]}>
        {apptDate ? (
          <>
            <View style={[sty.row, isRTL && sty.rowRev]}>
              <Ionicons name="calendar-outline" size={12} color={ap.textFaint} />
              <Text style={[sty.cardMeta, { color: ap.textFaint }]}>
                {apptDate.toLocaleDateString(lang === 'ar' ? 'ar-EG' : 'en-US', {
                  weekday: 'short', day: 'numeric', month: 'short',
                })}
              </Text>
            </View>
            <View style={[sty.row, isRTL && sty.rowRev]}>
              <Ionicons name="time-outline" size={12} color={C.cyan} />
              <Text style={[sty.cardMeta, { color: C.cyan }]}>
                {apptDate.toLocaleTimeString(lang === 'ar' ? 'ar-EG' : 'en-US', {
                  hour: '2-digit', minute: '2-digit',
                })}
              </Text>
            </View>
          </>
        ) : null}
        {appt.duration_minutes ? (
          <Text style={[sty.cardMeta, { color: ap.textFaint }]}>{appt.duration_minutes} {lang === 'ar' ? 'دقيقة' : 'min'}</Text>
        ) : null}
      </View>
      {/* ── Confirm / Complete / No-show / Cancel actions ── */}
      {(canConfirm || canCancel || canComplete || canNoShow) ? (
        <View style={[sty.row, isRTL && sty.rowRev, { gap: 8, marginTop: 10, flexWrap: 'wrap' }]}>
          {canConfirm ? (
            <TouchableOpacity
              disabled={isMutating}
              onPress={() => onConfirm?.(appt.id)}
              style={{
                flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
                gap: 6, paddingVertical: 9, borderRadius: 12, minWidth: 96,
                backgroundColor: C.green + '22', borderWidth: 1, borderColor: C.green + '55',
                opacity: isMutating ? 0.5 : 1,
              }}
            >
              {isMutating
                ? <ActivityIndicator size="small" color={C.green} />
                : <Ionicons name="checkmark-circle-outline" size={14} color={C.green} />}
              <Text style={{ fontSize: 12, fontWeight: '700', color: C.green }}>
                {lang === 'ar' ? 'تأكيد' : 'Confirm'}
              </Text>
            </TouchableOpacity>
          ) : null}
          {canComplete ? (
            <TouchableOpacity
              disabled={isMutating}
              onPress={() => onComplete?.(appt.id)}
              style={{
                flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
                gap: 6, paddingVertical: 9, borderRadius: 12, minWidth: 96,
                backgroundColor: C.blue + '1A', borderWidth: 1, borderColor: C.blue + '55',
                opacity: isMutating ? 0.5 : 1,
              }}
            >
              {isMutating
                ? <ActivityIndicator size="small" color={C.blue} />
                : <Ionicons name="flag-outline" size={14} color={C.blue} />}
              <Text style={{ fontSize: 12, fontWeight: '700', color: C.blue }}>
                {lang === 'ar' ? 'مكتمل' : 'Complete'}
              </Text>
            </TouchableOpacity>
          ) : null}
          {canNoShow ? (
            <TouchableOpacity
              disabled={isMutating}
              onPress={() => onNoShow?.(appt.id)}
              style={{
                flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
                gap: 6, paddingVertical: 9, borderRadius: 12, minWidth: 96,
                backgroundColor: C.orange + '1A', borderWidth: 1, borderColor: C.orange + '55',
                opacity: isMutating ? 0.5 : 1,
              }}
            >
              {isMutating
                ? <ActivityIndicator size="small" color={C.orange} />
                : <Ionicons name="help-circle-outline" size={14} color={C.orange} />}
              <Text style={{ fontSize: 12, fontWeight: '700', color: C.orange }}>
                {lang === 'ar' ? 'لم يحضر' : 'No-show'}
              </Text>
            </TouchableOpacity>
          ) : null}
          {canCancel ? (
            <TouchableOpacity
              disabled={isMutating}
              onPress={() => onCancel?.(appt.id)}
              style={{
                flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
                gap: 6, paddingVertical: 9, borderRadius: 12, minWidth: 96,
                backgroundColor: C.red + '1A', borderWidth: 1, borderColor: C.red + '55',
                opacity: isMutating ? 0.5 : 1,
              }}
            >
              {isMutating
                ? <ActivityIndicator size="small" color={C.red} />
                : <Ionicons name="close-circle-outline" size={14} color={C.red} />}
              <Text style={{ fontSize: 12, fontWeight: '700', color: C.red }}>
                {lang === 'ar' ? 'إلغاء' : 'Cancel'}
              </Text>
            </TouchableOpacity>
          ) : null}
        </View>
      ) : null}
    </View>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// User Management Modal (owner/partner only)
// ─────────────────────────────────────────────────────────────────────────────
const UserManagementModal = ({
  visible, onClose, restaurantId, restaurantName, lang, isRTL,
}: {
  visible: boolean; onClose: () => void;
  restaurantId: string; restaurantName: string;
  lang: string; isRTL: boolean;
}) => {
  const qc = useQueryClient();
  const p = usePalette();
  const router = useRouter();
  const [emailInput, setEmailInput] = useState('');

  const usersQ = useQuery({
    queryKey: ['ra-users', restaurantId],
    queryFn: () => restaurantAnalyticsApi.getUsers(restaurantId).then(r => r.data.users),
    enabled: visible && !!restaurantId,
  });

  const addMut = useMutation({
    mutationFn: (email: string) => restaurantAnalyticsApi.addUser(restaurantId, email),
    onSuccess: () => {
      setEmailInput('');
      qc.invalidateQueries({ queryKey: ['ra-users', restaurantId] });
      qc.invalidateQueries({ queryKey: ['ra-restaurants'] });
    },
    onError: (e: any) => {
      Alert.alert(lang === 'ar' ? 'خطأ' : 'Error',
        e?.response?.data?.error || (lang === 'ar' ? 'حدث خطأ' : 'An error occurred'));
    },
  });

  const removeMut = useMutation({
    mutationFn: (userId: string) => restaurantAnalyticsApi.removeUser(restaurantId, userId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ra-users', restaurantId] });
      qc.invalidateQueries({ queryKey: ['ra-restaurants'] });
    },
  });

  const users = usersQ.data ?? [];

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={sty.modalOverlay}>
        <BlurView intensity={40} tint="dark" style={StyleSheet.absoluteFill} />
        <View style={[sty.modalSheet, { backgroundColor: p.surface, borderColor: p.goldBorder }]}>
          <LinearGradient
            colors={['rgba(255,215,0,0.06)', 'rgba(0,0,0,0.6)']}
            style={StyleSheet.absoluteFill}
          />
          {/* Handle */}
          <View style={[sty.modalHandle, { backgroundColor: p.border }]} />

          {/* Header */}
          <View style={[sty.row, isRTL && sty.rowRev, { justifyContent: 'space-between', marginBottom: 20 }]}>
            <View>
              <Text style={[sty.modalTitle, { color: p.gold }]}>{lang === 'ar' ? 'إدارة المستخدمين' : 'Manage Users'}</Text>
              <Text style={[sty.modalSub, { color: p.textMuted }]} numberOfLines={1}>{restaurantName}</Text>
            </View>
            <TouchableOpacity onPress={onClose} style={[sty.modalClose, { backgroundColor: p.surfaceHi }]}>
              <Ionicons name="close" size={20} color={p.textMuted} />
            </TouchableOpacity>
          </View>

          <Text style={[sty.modalHint, { color: p.textFaint }]}>
            {lang === 'ar'
              ? 'يمكن تعيين حتى 3 مستخدمين لكل مطعم للوصول إلى لوحة التحليلات'
              : 'Up to 3 users can be assigned per restaurant to access its analytics'}
          </Text>

          {/* Assigned users */}
          {usersQ.isLoading ? (
            <ActivityIndicator color={p.gold} style={{ marginVertical: 20 }} />
          ) : (
            <View style={{ marginTop: 16, gap: 10 }}>
              {users.length === 0 ? (
                <Text style={[sty.modalHint, { color: p.textFaint }]}>{lang === 'ar' ? 'لا يوجد مستخدمون معيّنون' : 'No users assigned yet'}</Text>
              ) : (
                users.map((u: any) => (
                  <View key={u.user_id} style={[sty.userRow, { backgroundColor: p.surface, borderColor: p.border }]}>
                    <View style={[sty.userAvatar, { backgroundColor: p.goldMuted }]}>
                      {u.user_picture
                        ? <Image source={{ uri: u.user_picture }} style={sty.userAvatarImg} />
                        : <Ionicons name="person" size={18} color={p.gold} />}
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={[sty.userName, { color: p.text }]}>{u.user_name || '—'}</Text>
                      <Text style={[sty.userEmail, { color: p.textMuted }]} numberOfLines={1}>{u.user_email}</Text>
                    </View>
                    <TouchableOpacity
                      style={[sty.removeBtn, { marginRight: 6 }]}
                      onPress={() => {
                        onClose();
                        router.push({
                          pathname: '/owner/notification-log',
                          params: { restaurant_id: restaurantId, user_id: u.user_id },
                        });
                      }}
                      accessibilityLabel={lang === 'ar' ? 'سجل التنبيهات لهذا المستخدم' : 'Notification log for this user'}
                    >
                      <Ionicons name="notifications-outline" size={16} color={C.cyan} />
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={sty.removeBtn}
                      onPress={() => {
                        Alert.alert(
                          lang === 'ar' ? 'إزالة المستخدم' : 'Remove User',
                          lang === 'ar' ? `هل تريد إزالة ${u.user_name || u.user_email}؟` : `Remove ${u.user_name || u.user_email}?`,
                          [
                            { text: lang === 'ar' ? 'إلغاء' : 'Cancel', style: 'cancel' },
                            { text: lang === 'ar' ? 'إزالة' : 'Remove', style: 'destructive', onPress: () => removeMut.mutate(u.user_id) },
                          ],
                        );
                      }}
                    >
                      <Ionicons name="trash-outline" size={16} color={C.red} />
                    </TouchableOpacity>
                  </View>
                ))
              )}
            </View>
          )}

          {/* Add user */}
          {users.length < 3 && (
            <View style={[sty.addUserRow, isRTL && sty.rowRev, { marginTop: 20 }]}>
              <TextInput
                style={[sty.emailInput, { backgroundColor: p.surfaceHi, color: p.text, borderColor: p.border }, isRTL && { textAlign: 'right' }]}
                placeholder={lang === 'ar' ? 'أضف بريد المستخدم...' : 'Add user by email...'}
                placeholderTextColor={p.textFaint}
                value={emailInput}
                onChangeText={setEmailInput}
                keyboardType="email-address"
                autoCapitalize="none"
              />
              <TouchableOpacity
                style={[sty.addBtn, { backgroundColor: p.gold }, (!emailInput.trim() || addMut.isPending) && { opacity: 0.5 }]}
                onPress={() => emailInput.trim() && addMut.mutate(emailInput.trim())}
                disabled={!emailInput.trim() || addMut.isPending}
              >
                {addMut.isPending
                  ? <ActivityIndicator size="small" color="#000" />
                  : <Ionicons name="add" size={20} color="#000" />}
              </TouchableOpacity>
            </View>
          )}
          {users.length >= 3 && (
            <Text style={[sty.modalHint, { color: C.orange, marginTop: 12 }]}>
              {lang === 'ar' ? 'تم الوصول للحد الأقصى (3 مستخدمين)' : 'Maximum 3 users reached'}
            </Text>
          )}
        </View>
      </View>
    </Modal>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Main screen
// ─────────────────────────────────────────────────────────────────────────────
function RestaurantAnalyticsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { restaurantId: paramRestaurantId, tab: paramTab } = useLocalSearchParams<{ restaurantId?: string; tab?: string }>();
  const user = useAppStore(s => s.user);
  const userRole = useAppStore(s => s.userRole);
  const storedReceiptLanguage = useAppStore(s => s.receiptLanguage);
  const setReceiptLanguage = useAppStore(s => s.setReceiptLanguage);
  const lastViewedPushLogAtByUser = useAppStore(s => s.lastViewedPushLogAtByUser);
  const syncStatus = useAppStore(s => s.syncStatus);
  const { isLive } = useAppLiveness();
  const lastViewedPushLogAt = user?.id ? (lastViewedPushLogAtByUser[user.id] ?? null) : null;
  const { language: lang } = useTranslation();
  const { isDark } = useTheme();
  const p = usePalette();
  const isRTL = lang === 'ar';
  const isPrivileged = ['owner', 'partner', 'admin'].includes(userRole ?? '');
  const isOwnerOrPartner = ['owner', 'partner'].includes(userRole ?? '');
  const isRestaurantUser = userRole === 'restaurant_user';

  const [selectedRestaurant, setSelectedRestaurant] = useState<any>(null);
  const [activeTab, setActiveTab] = useState<Tab>('orders');
  const [orderStatus, setOrderStatus] = useState('all');
  const [apptStatus, setApptStatus] = useState('all');
  const [showUserModal, setShowUserModal] = useState(false);
  const [expandedOrderId, setExpandedOrderId] = useState<string | null>(null);
  const [tabAnim] = useState(() => new RNAnimated.Value(0));
  const [replyTarget, setReplyTarget] = useState<any>(null);
  const [replyText, setReplyText] = useState('');
  const [showReplyModal, setShowReplyModal] = useState(false);
  const stripRef = useRef<ScrollView>(null);
  const mainScrollRef = useRef<ScrollView>(null);
  const qc = useQueryClient();

  // ── Honor ?tab= param from push-notification deep-links ──────────────────
  // When a staff member taps a new-order push notification, _layout.tsx
  // navigates here with { tab: 'orders' }. If the screen is already mounted on
  // a different tab we switch it programmatically so the Orders list is shown.
  useEffect(() => {
    if (paramTab && TABS.includes(paramTab as Tab)) {
      setActiveTab(paramTab as Tab);
    }
  }, [paramTab]);

  // ── Data queries ──────────────────────────────────────────────────────────
  const restaurantsQ = useQuery({
    queryKey: ['ra-restaurants'],
    queryFn: () => restaurantAnalyticsApi.getRestaurants().then(r => r.data.restaurants),
    staleTime: 60_000,
  });

  const ordersQ = useQuery({
    queryKey: ['ra-orders', selectedRestaurant?.id, orderStatus],
    queryFn: () =>
      restaurantAnalyticsApi.getOrders(selectedRestaurant!.id, { status: orderStatus })
        .then(r => r.data),
    enabled: !!selectedRestaurant?.id,
    staleTime: 30_000,
  });

  const apptsQ = useQuery({
    queryKey: ['ra-appts', selectedRestaurant?.id, apptStatus],
    queryFn: () =>
      restaurantAnalyticsApi.getAppointments(selectedRestaurant!.id, { status: apptStatus })
        .then(r => r.data),
    enabled: !!selectedRestaurant?.id,
    staleTime: 30_000,
  });

  const statsQ = useQuery({
    queryKey: ['ra-stats', selectedRestaurant?.id],
    queryFn: () =>
      restaurantAnalyticsApi.getStats(selectedRestaurant!.id).then(r => r.data),
    // Stats are needed cross-tab now — the Print Hub's Analytics PDF sub-rows
    // (Daily Brief / Detailed) live under every tab and rely on this query.
    // Keeping the previous `activeTab === 'analytics'` gate would disable the
    // Analytics rows whenever the Hub was opened from Orders or Bookings.
    enabled: !!selectedRestaurant?.id,
    staleTime: 60_000,
  });

  const ratingsQ = useQuery({
    queryKey: ['ra-ratings', selectedRestaurant?.id],
    queryFn: () =>
      ratingsApi.adminGetAll({ restaurant_id: selectedRestaurant!.id, limit: 50 }).then(r => r.data),
    enabled: !!selectedRestaurant?.id && activeTab === 'ratings',
    staleTime: 30_000,
  });

  // ── Unread push-log count — drives badge on the Analytics tab ────────────
  // Scoped to the currently selected restaurant when one is active so each
  // restaurant card carries its own independent unread badge.
  const { data: pushLogUnreadData } = useQuery({
    queryKey: ['push-log-unread-count', user?.id, lastViewedPushLogAt, selectedRestaurant?.id ?? null],
    queryFn: () => pushLogApi.getUnreadCount({
      since: lastViewedPushLogAt,
      restaurant_id: selectedRestaurant?.id,
    }).then(r => r.data),
    enabled: !!user,
    staleTime: 60_000,
    refetchInterval: isLive ? 60_000 : false,
  });
  const pushLogUnreadCount = pushLogUnreadData?.count ?? 0;

  // ── Per-tab unread counts (Stock / New Orders) — drives sub-badges ─────
  const { data: pushLogStockData } = useQuery({
    queryKey: ['push-log-unread-stock', user?.id, lastViewedPushLogAt, selectedRestaurant?.id ?? null],
    queryFn: () => pushLogApi.getUnreadCount({
      since: lastViewedPushLogAt,
      restaurant_id: selectedRestaurant?.id,
      event_type: 'low_stock',
    }).then(r => r.data),
    enabled: !!user,
    staleTime: 60_000,
    refetchInterval: isLive ? 60_000 : false,
  });
  const { data: pushLogOOSData } = useQuery({
    queryKey: ['push-log-unread-oos', user?.id, lastViewedPushLogAt, selectedRestaurant?.id ?? null],
    queryFn: () => pushLogApi.getUnreadCount({
      since: lastViewedPushLogAt,
      restaurant_id: selectedRestaurant?.id,
      event_type: 'out_of_stock',
    }).then(r => r.data),
    enabled: !!user,
    staleTime: 60_000,
    refetchInterval: isLive ? 60_000 : false,
  });
  const { data: pushLogNewOrderData } = useQuery({
    queryKey: ['push-log-unread-neworder', user?.id, lastViewedPushLogAt, selectedRestaurant?.id ?? null],
    queryFn: () => pushLogApi.getUnreadCount({
      since: lastViewedPushLogAt,
      restaurant_id: selectedRestaurant?.id,
      event_type: 'new_order',
    }).then(r => r.data),
    enabled: !!user,
    staleTime: 60_000,
    refetchInterval: isLive ? 60_000 : false,
  });
  const pushLogStockUnread = (pushLogStockData?.count ?? 0) + (pushLogOOSData?.count ?? 0);
  const pushLogOrdersUnread = pushLogNewOrderData?.count ?? 0;

  const replyMut = useMutation({
    mutationFn: ({ id, reply }: { id: string; reply: string }) =>
      ratingsApi.adminReply(id, reply),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ra-ratings', selectedRestaurant?.id] });
      setShowReplyModal(false);
      setReplyTarget(null);
      setReplyText('');
    },
    onError: () => {
      pushStatusToast('error', 'rating-reply-error', lang === 'ar' ? 'تعذّر حفظ الرد' : 'Failed to save reply');
    },
  });

  const deleteReplyMut = useMutation({
    mutationFn: (id: string) => ratingsApi.adminDeleteReply(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ra-ratings', selectedRestaurant?.id] });
    },
    onError: () => {
      pushStatusToast('error', 'rating-delete-reply-error', lang === 'ar' ? 'تعذّر حذف الرد' : 'Failed to delete reply');
    },
  });

  // ── For restaurant_user: fetch my-assignments to pin the visible list ─────
  // Privileged users (owner/partner/admin) skip this — they see all restaurants
  // via restaurantsQ. restaurant_user gets an explicit ID-set from the server
  // so the strip is filtered client-side even if /restaurants returns more rows.
  const myAssignmentsQ = useQuery({
    queryKey: ['my-restaurant-assignments', user?.id],
    queryFn: () => restaurantAnalyticsApi.getMyAssignments().then(r => r.data.restaurants),
    enabled: isRestaurantUser,
    staleTime: 5 * 60 * 1000,
    retry: false,
  });

  // ── Derived: list of restaurants visible to the current user ─────────────
  // For restaurant_user: intersect /restaurants with my-assignments so the
  // card strip only shows the restaurants they actually manage (already scoped
  // server-side, but the client-side filter makes the intent explicit and
  // guards against any future backend behavioural change).
  const visibleRestaurants = useMemo(() => {
    const all = restaurantsQ.data ?? [];
    if (!isRestaurantUser) return all;
    const assignedIds = new Set((myAssignmentsQ.data ?? []).map((r: any) => r.id));
    return all.filter((r: any) => assignedIds.has(r.id));
  }, [restaurantsQ.data, myAssignmentsQ.data, isRestaurantUser]);

  // ── Per-PATCH success/error toast queue — declared early so the WS handlers
  //    that push "New order received!" toasts can reference pushStatusToast.
  const { statusToasts, pushStatusToast, dismissStatusToast } = useStatusToastQueue();

  // ── WebSocket: refresh orders on new orders and status changes ───────────
  // Server emits both `new_order` (kind field) and `order_created` (type field) — subscribe to both.
  useWebSocketEvent(
    ['new_order', 'order_created', 'order_updated', 'order_status_changed'],
    () => {
      qc.invalidateQueries({ queryKey: ['ra-orders'] });
      qc.invalidateQueries({ queryKey: ['ra-restaurants'] });
      qc.invalidateQueries({ queryKey: ['ra-stats'] });
    },
  );

  // ── WebSocket: show "New order received!" toast for restaurant managers ───
  // Fires on `new_order` and `order_created` only (not status-change events).
  // Visible to all roles on this screen; tapping the toast switches to the
  // orders tab and scrolls to the top of the list.
  useWebSocketEvent(
    ['new_order', 'order_created'],
    useCallback((msg) => {
      if (!selectedRestaurant) return;
      // If the event carries a restaurant_id, only show the toast when the
      // manager is viewing that specific restaurant (prevents cross-restaurant
      // false alerts in multi-restaurant setups). When restaurant_id is absent
      // (legacy events or new_order alias) we fall through and show the toast.
      const eventRestaurantId = msg.data?.restaurant_id;
      if (eventRestaurantId && eventRestaurantId !== selectedRestaurant.id) return;
      const orderNum = msg.data?.order_number;
      const total = msg.data?.total_amount;
      const numLabel = orderNum ? ` #${orderNum}` : '';
      const totalLabel = total != null
        ? ` • ${Number(total).toFixed(2)} ${lang === 'ar' ? 'ج.م' : 'EGP'}`
        : '';
      const message =
        lang === 'ar'
          ? `طلب جديد${numLabel}${totalLabel}`
          : `New order received!${numLabel}${totalLabel}`;
      const handleToastPress = () => {
        setActiveTab('orders');
        setTimeout(() => mainScrollRef.current?.scrollTo({ y: 0, animated: true }), 150);
      };
      haptic.newOrder();
      playNewOrderChime();
      pushStatusToast(
        'success',
        `new-order-${orderNum ?? Date.now()}`,
        message,
        undefined,
        handleToastPress,
      );
    }, [selectedRestaurant, lang, pushStatusToast]),
  );

  // ── WebSocket: refresh appointments on changes ───────────
  useWebSocketEvent(
    ['appointment_created', 'appointment_updated', 'appointment_deleted'],
    () => {
      qc.invalidateQueries({ queryKey: ['ra-appts'] });
      qc.invalidateQueries({ queryKey: ['ra-stats'] });
    },
  );

  // ── WebSocket: refresh ratings on create, reply, or delete ──────────────
  useWebSocketEvent(
    ['rating_created', 'rating_reply_updated', 'rating_deleted'],
    () => {
      qc.invalidateQueries({ queryKey: ['ra-ratings'] });
    },
  );

  // ── Report modal state ─────────────────────────────────────────────────────
  const [showReportModal, setShowReportModal] = useState(false);
  const [stockAlertRange, setStockAlertRange] = useState<7 | 30>(30);
  // (Removed: legacy `reportMode` state — the Print Hub now always passes
  // an explicit `mode` argument to `handleDownloadOrders`, so there is no
  // shared toggle to remember between modal opens.)

  // ── Stock alert count queries — fetches low_stock + out_of_stock push-log
  //    entries for the selected period (7 or 30 days). Always enabled so that
  //    analytics PDF exports work correctly from any active tab.
  const stockAlertStartDate = useMemo(() => {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - (stockAlertRange - 1));
    d.setUTCHours(0, 0, 0, 0);
    return d.toISOString();
  }, [stockAlertRange]);

  const lowStockAlertsQ = useQuery({
    queryKey: ['ra-stock-alerts-low', stockAlertRange, selectedRestaurant?.id],
    enabled: !!selectedRestaurant?.id,
    queryFn: () =>
      pushLogApi.getLog({ event_type: 'low_stock', start_date: stockAlertStartDate, limit: 200, restaurant_id: selectedRestaurant?.id })
        .then(r => r.data.pagination.total),
    staleTime: 5 * 60_000,
  });

  const outOfStockAlertsQ = useQuery({
    queryKey: ['ra-stock-alerts-out', stockAlertRange, selectedRestaurant?.id],
    enabled: !!selectedRestaurant?.id,
    queryFn: () =>
      pushLogApi.getLog({ event_type: 'out_of_stock', start_date: stockAlertStartDate, limit: 200, restaurant_id: selectedRestaurant?.id })
        .then(r => r.data.pagination.total),
    staleTime: 5 * 60_000,
  });

  const stockDailyCountsQ = useQuery({
    queryKey: ['ra-stock-daily', stockAlertRange, selectedRestaurant?.id],
    enabled: !!selectedRestaurant?.id,
    queryFn: () =>
      pushLogApi.getDailyCounts({ start_date: stockAlertStartDate, restaurant_id: selectedRestaurant?.id })
        .then(r => r.data),
    staleTime: 5 * 60_000,
  });

  // ── Top offenders — products with the most recurring stock alerts in the
  //    selected window. Honours the same restaurant scope + date range as the
  //    other stock-alert tiles above.
  const topOffendersQ = useQuery({
    queryKey: ['ra-stock-top-offenders', stockAlertRange, selectedRestaurant?.id],
    enabled: !!selectedRestaurant?.id,
    queryFn: () =>
      pushLogApi.getTopOffenders({
        start_date: stockAlertStartDate,
        restaurant_id: selectedRestaurant?.id,
        limit: 5,
      }).then(r => r.data.items),
    staleTime: 5 * 60_000,
  });

  // ── Stock history — recent manual stock changes for all products in the
  //    selected restaurant. Accessible to all roles on this screen (privileged
  //    users see all; restaurant_user sees only their assigned restaurant).
  const restaurantStockHistoryQ = useQuery({
    queryKey: ['ra-stock-history', selectedRestaurant?.id],
    enabled: !!selectedRestaurant?.id && activeTab === 'analytics',
    queryFn: () =>
      restaurantAnalyticsApi.getStockHistory(selectedRestaurant!.id, 15).then(r => r.data),
    staleTime: 60_000,
  });

  // ── Restock mutation — adds the suggested reorder qty to the product's
  //    current stock via PATCH /api/products/:id/stock. Mirrors the source
  //    of truth (`stock_quantity = old + qty`) so the existing stock-history
  //    + websocket broadcast pipeline reuses unchanged.
  const restockMut = useMutation({
    mutationFn: ({ productId, newQty }: { productId: string; newQty: number }) =>
      productsApi.updateStock(productId, newQty),
    onSuccess: (_data, vars) => {
      haptic.success?.();
      qc.invalidateQueries({ queryKey: ['ra-stock-top-offenders'] });
      qc.invalidateQueries({ queryKey: ['ra-stock-alerts-low'] });
      qc.invalidateQueries({ queryKey: ['ra-stock-alerts-out'] });
      qc.invalidateQueries({ queryKey: ['push-log-unread-stock'] });
      qc.invalidateQueries({ queryKey: ['push-log-unread-oos'] });
      qc.invalidateQueries({ queryKey: ['ra-stock-history'] });
      pushStatusToast(
        'success',
        `restock-${vars.productId}`,
        lang === 'ar' ? 'تم تحديث المخزون' : 'Stock updated',
      );
    },
    onError: () => {
      pushStatusToast(
        'error',
        'restock-error',
        lang === 'ar' ? 'تعذّر تحديث المخزون' : 'Failed to update stock',
      );
    },
  });

  const confirmRestock = useCallback((o: any) => {
    const productId = String(o.product_id ?? '');
    if (!productId) return;
    const current = parseInt(String(o.current_stock ?? 0), 10) || 0;
    const suggested = Math.max(1, parseInt(String(o.suggested_reorder_qty ?? 1), 10) || 1);
    const displayName = (lang === 'ar' ? (o.name_ar || o.name) : (o.name || o.name_ar)) || (lang === 'ar' ? 'المنتج' : 'product');
    const newQty = current + suggested;
    haptic.tap();
    Alert.alert(
      lang === 'ar' ? 'إعادة التخزين' : 'Restock item',
      lang === 'ar'
        ? `إضافة ${suggested} وحدة إلى "${displayName}"؟\nالمخزون: ${current} → ${newQty}`
        : `Add ${suggested} units to "${displayName}"?\nStock: ${current} → ${newQty}`,
      [
        { text: lang === 'ar' ? 'إلغاء' : 'Cancel', style: 'cancel' },
        {
          text: lang === 'ar' ? 'تأكيد' : 'Confirm',
          onPress: () => restockMut.mutate({ productId, newQty }),
        },
      ],
    );
  }, [lang, restockMut, pushStatusToast]);

  // ── Per-row thermal print modal state ──────────────────────────────────────
  const [thermalOrder, setThermalOrder] = useState<any | null>(null);
  const [thermalTab, setThermalTab] = useState<'info' | 'nutrition'>('info');
  const [stockChartProduct, setStockChartProduct] = useState<{ id: string; name: string } | null>(null);

  // Resolve the effective receipt language from the restaurant setting.
  // 'auto' (or missing) → fall back to UI lang; 'ar'/'en' → use that lang directly.
  const resolveReceiptLang = useCallback((): 'ar' | 'en' => {
    const pref = selectedRestaurant?.receipt_language;
    if (pref === 'ar' || pref === 'en') return pref;
    return lang === 'ar' ? 'ar' : 'en';
  }, [selectedRestaurant?.receipt_language, lang]);

  // Language toggle for per-row thermal receipts (last-used persisted preference takes priority)
  const [printLang, setPrintLang] = useState<'ar' | 'en'>(lang === 'ar' ? 'ar' : 'en');
  // Language toggle for hub (batch) thermal receipts
  const [hubPrintLang, setHubPrintLang] = useState<'ar' | 'en'>(lang === 'ar' ? 'ar' : 'en');
  // On modal open: use the persisted receipt language preference; fall back to the
  // restaurant-level setting (or UI lang) only when no preference has been stored yet.
  useEffect(() => { if (thermalOrder) setPrintLang(storedReceiptLanguage ?? resolveReceiptLang()); }, [!!thermalOrder]);
  useEffect(() => { if (showReportModal) setHubPrintLang(storedReceiptLanguage ?? resolveReceiptLang()); }, [showReportModal]);
  // When the selected restaurant changes, reset the print language to that
  // restaurant's configured receipt_language (or the resolved UI language).
  // This prevents stale language from a previous restaurant leaking into receipts.
  // If the new restaurant has a definitive (non-auto) receipt_language that differs
  // from the persisted Zustand preference, clear the persisted preference so the
  // restaurant-level setting takes precedence (per the documented resolution order).
  const prevRestaurantIdRef = useRef<string | null>(null);
  useEffect(() => {
    const newId = selectedRestaurant?.id ?? null;
    if (newId && newId !== prevRestaurantIdRef.current) {
      prevRestaurantIdRef.current = newId;
      const pref = selectedRestaurant?.receipt_language;
      if ((pref === 'ar' || pref === 'en') && storedReceiptLanguage && storedReceiptLanguage !== pref) {
        // Restaurant has a definitive fixed language that differs from persisted preference.
        // Clear the persisted preference so it no longer overrides restaurant-level setting,
        // and apply the restaurant language directly (avoids computing from stale persisted value).
        setReceiptLanguage(null);
        setPrintLang(pref);
        setHubPrintLang(pref);
      } else {
        // No conflict — resolve normally (persisted → restaurant → UI language)
        const resolved = resolveReceiptLang();
        setPrintLang(resolved);
        setHubPrintLang(resolved);
      }
    }
  }, [selectedRestaurant?.id, selectedRestaurant?.receipt_language, resolveReceiptLang, storedReceiptLanguage, setReceiptLanguage]);

  // ── Print Preview modal state ────────────────────────────────────────────
  const [printPreview, setPrintPreview] = useState<{ html: string; fileLabel: string; width?: number } | null>(null);

  // On web, react-native-webview shows "does not support this platform".
  // Instead we inject a plain <iframe> into a View container via a DOM ref.
  const webPreviewRef = useRef<any>(null);
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const node = webPreviewRef.current;
    if (!node) return;
    // Clear any previously injected iframe
    while ((node as any).firstChild) (node as any).removeChild((node as any).firstChild);
    if (!printPreview?.html) return;
    const iframe = (document as any).createElement('iframe');
    iframe.style.cssText = 'width:100%;height:100%;border:none;display:block;background:#fff;';
    iframe.srcdoc = printPreview.html;
    (node as any).appendChild(iframe);
  }, [printPreview?.html]);

  // ── Per-tile date-range selectors for the Print Hub modal ───────────────
  // Each of the three tiles (thermal / brief / detailed) keeps its own
  // independent range so user can compose, e.g. "thermal=today, brief=last7".
  // Analytics tab ignores these (snapshot is always live aggregate).
  type DateRangeKey = 'today' | 'yesterday' | 'last7' | 'last30' | 'all';
  const [orderHubRange, setOrderHubRange] = useState<{ thermal: DateRangeKey; brief: DateRangeKey; detailed: DateRangeKey }>(
    { thermal: 'today', brief: 'today', detailed: 'today' },
  );
  const [apptHubRange, setApptHubRange] = useState<{ thermal: DateRangeKey; brief: DateRangeKey; detailed: DateRangeKey }>(
    { thermal: 'today', brief: 'today', detailed: 'today' },
  );
  // ── Cross-tab PDF rows in the Print Hub (Daily Brief & Detailed each
  //    expose Orders / Bookings / Analytics). Each row keeps its own
  //    independent date range so a user can mix, e.g. "briefOrders=last7,
  //    detailedBookings=today". Analytics rows ignore the range (snapshot).
  type PdfHubRowKey =
    | 'briefOrders' | 'briefBookings' | 'briefAnalytics'
    | 'detailedOrders' | 'detailedBookings' | 'detailedAnalytics';
  const [pdfHubRange, setPdfHubRange] = useState<Record<PdfHubRowKey, DateRangeKey>>({
    briefOrders: 'today',
    briefBookings: 'today',
    briefAnalytics: 'today',
    detailedOrders: 'today',
    detailedBookings: 'today',
    detailedAnalytics: 'today',
  });
  // ── Optional "compare to" range per Analytics PDF row. 'none' disables
  //    comparison and renders the single-range PDF. Any other key produces
  //    a side-by-side KPI table + paired status bars.
  type CompareRangeKey = DateRangeKey | 'none';
  const [analyticsCompareRange, setAnalyticsCompareRange] = useState<{
    briefAnalytics: CompareRangeKey;
    detailedAnalytics: CompareRangeKey;
  }>({ briefAnalytics: 'none', detailedAnalytics: 'none' });

  // ── Appointment status mutation ────────────────────────────────────────────
  // `prevStatus` (when present) is captured at the call site so the success
  // toast can offer an Undo action that re-PATCHes the booking back to its
  // previous status. `isUndo` flips the success toast into a neutral
  // "reverted" confirmation and prevents recursive undo chains.
  const apptMut = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string; prevStatus?: string; isUndo?: boolean }) =>
      appointmentsApi.updateStatus(id, status),
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: ['ra-appts'] });
      qc.invalidateQueries({ queryKey: ['ra-stats'] });
      const meta = APPT_STATUS[variables.status];
      const statusLabel = meta
        ? (lang === 'ar' ? meta.labelAr : meta.label.toLowerCase())
        : variables.status;
      const ref = `#${String(variables.id).slice(0, 6)}`;
      if (variables.isUndo) {
        const message = lang === 'ar'
          ? `تم التراجع: ${ref} ← ${statusLabel}`
          : `Reverted: ${ref} → ${statusLabel}`;
        pushStatusToast('neutral', `appt_${variables.id}_${variables.status}_undo`, message);
        return;
      }
      const message = lang === 'ar'
        ? `الحجز ${ref} ← ${statusLabel}`
        : `Booking ${ref} → ${statusLabel}`;
      const prev = variables.prevStatus;
      const canUndo = !!prev && prev !== variables.status;
      const undo = canUndo
        ? {
            label: lang === 'ar' ? 'تراجع' : 'Undo',
            onPress: () =>
              apptMut.mutate({ id: variables.id, status: prev!, isUndo: true }),
          }
        : undefined;
      pushStatusToast(
        'success',
        `appt_${variables.id}_${variables.status}_success`,
        message,
        undo,
      );
    },
    onError: (e: any, variables) => {
      const reason =
        e?.response?.data?.detail ||
        e?.response?.data?.message ||
        e?.response?.data?.error ||
        e?.message ||
        (lang === 'ar' ? 'خطأ غير معروف' : 'Unknown error');
      const ref = `#${String(variables.id).slice(0, 6)}`;
      const prefix = variables.isUndo
        ? (lang === 'ar' ? 'فشل التراجع عن الحجز' : 'Failed to undo booking')
        : (lang === 'ar' ? 'فشل تحديث الحجز' : 'Failed to update booking');
      const message = `${prefix} ${ref}: ${reason}`;
      pushStatusToast('error', `appt_${variables.id}_${variables.status}_error`, message);
    },
  });

  // ── Order status mutation — scoped to selected restaurant ─────────────────
  const statusMut = useMutation({
    mutationFn: ({ orderId, status }: { orderId: string; status: string }) =>
      restaurantAnalyticsApi.updateOrderStatus(selectedRestaurant!.id, orderId, status),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ra-orders'] });
      qc.invalidateQueries({ queryKey: ['ra-restaurants'] });
    },
    onError: (e: any) => {
      Alert.alert(
        lang === 'ar' ? 'خطأ' : 'Error',
        e?.response?.data?.error || (lang === 'ar' ? 'تعذّر تغيير الحالة' : 'Failed to update status'),
      );
    },
  });

  // ── Auto-select restaurant ────────────────────────────────────────────────
  useEffect(() => {
    if (visibleRestaurants.length === 0) return;
    if (paramRestaurantId) {
      const match = visibleRestaurants.find((r: any) => r.id === paramRestaurantId);
      if (match) { setSelectedRestaurant(match); return; }
    }
    if (!isPrivileged && visibleRestaurants.length === 1) {
      setSelectedRestaurant(visibleRestaurants[0]);
    } else if (!selectedRestaurant) {
      setSelectedRestaurant(visibleRestaurants[0]);
    }
  }, [visibleRestaurants, paramRestaurantId, isPrivileged]);

  // Release the cached chime sound on unmount to free audio resources
  useEffect(() => {
    return () => { releaseNewOrderChime(); };
  }, []);

  // Clear the app-icon badge whenever staff views the orders screen so the
  // visual "pending orders" count resets after they have seen the list.
  useFocusEffect(
    useCallback(() => {
      void pushNotificationService.setBadgeCount(0);
    }, []),
  );

  // ── Build export text helper ───────────────────────────────────────────────
  const buildOrdersExportText = useCallback(() => {
    const orderList = ordersQ.data?.orders ?? [];
    const restName = selectedRestaurant
      ? (lang === 'ar' ? (selectedRestaurant.name_ar || selectedRestaurant.name) : selectedRestaurant.name)
      : '';
    const dateStr = new Date().toLocaleDateString(lang === 'ar' ? 'ar-EG' : 'en-US');
    const header = lang === 'ar'
      ? `تقرير طلبات — ${restName}\nالتاريخ: ${dateStr}\n${'─'.repeat(40)}\n`
      : `Orders Report — ${restName}\nDate: ${dateStr}\n${'─'.repeat(40)}\n`;
    const lines = orderList.map((o: any) => {
      const cName = o.customer_name || o.user_name || o.joined_user_name || '—';
      const total = parseFloat(String(o.total_amount || 0)).toFixed(0);
      const date  = o.created_at ? new Date(o.created_at).toLocaleDateString(lang === 'ar' ? 'ar-EG' : 'en-US') : '—';
      const num   = o.restaurant_order_number ? `R-${o.restaurant_order_number}` : `#${o.order_number || o.id?.slice(0, 8)}`;
      return lang === 'ar'
        ? `${num} | ${cName} | ${total} ج.م | ${o.status} | ${date}`
        : `${num} | ${cName} | ${total} EGP | ${o.status} | ${date}`;
    });
    return { text: header + lines.join('\n'), restName };
  }, [ordersQ.data, selectedRestaurant, lang]);

  // ── Open the Print Hub modal — tab-aware (orders / appointments / analytics).
  // The modal itself disables individual tiles when the active tab has no
  // records (and shows a "Nothing to print on this tab yet" hint), so the
  // opener has no early-exit logic of its own.
  const handleOpenPrintHub = useCallback(() => {
    setShowReportModal(true);
  }, []);

  // ─────────────────────────────────────────────────────────────────────────
  // PRINT HUB — Shared helpers, modern PDF builders, per-row print
  // ─────────────────────────────────────────────────────────────────────────

  // Derived data — declared early so the Print Hub callbacks below can
  // capture stable references without TDZ errors.
  // `visibleRestaurants` is pre-filtered: restaurant_user sees only their
  // assignments; privileged roles see all. All downstream references use this.
  const restaurants = visibleRestaurants;
  const orders = ordersQ.data?.orders ?? [];
  const appts = apptsQ.data?.appointments ?? [];
  const stats = statsQ.data;
  const ordSt = stats?.orders ?? {};
  const apptSt = stats?.appointments ?? {};
  const topProd = stats?.top_products ?? [];
  const ordMax = Math.max(
    ordSt.delivered ?? 0, ordSt.pending ?? 0, ordSt.preparing ?? 0,
    ordSt.shipped ?? 0, ordSt.cancelled ?? 0, 1,
  );
  const apptMax = Math.max(apptSt.confirmed ?? 0, apptSt.pending ?? 0, apptSt.cancelled ?? 0, 1);

  // ── Shared HTML helpers ───────────────────────────────────────────────
  const escapeHtml = useCallback((s: any) => String(s ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string
  )), []);

  // Wrap a number/money string in a LTR span so RTL context doesn't
  // reverse digit order when rendering inside an Arabic HTML document.
  const ltrNum = useCallback((s: string | number) =>
    `<span dir="ltr">${escapeHtml(String(s))}</span>`, [escapeHtml]);

  // ── Shared 80mm thermal CSS — fixes font (Arial for Arabic), dir on <body>,
  // max-width guard, and tabular-numeral columns. ──────────────────────────
  const buildThermalCss = useCallback((isAr: boolean) => `
@page { size: 80mm auto; margin: 4mm; }
* { box-sizing: border-box; }
body { font-family: ${`${isAr ? "'Arial','Helvetica',sans-serif" : "'Courier New',Courier,monospace"}`}; max-width: 72mm; width: 72mm; margin: 0 auto; padding: 0; color: #000; font-size: 12px; direction: ${`${isAr ? 'rtl' : 'ltr'}`}; }
.ctr { text-align: center; }
h1 { font-size: 16px; margin: 0 0 4px; letter-spacing: 0.3px; }
.logo { width: 44px; height: 44px; object-fit: contain; border-radius: 6px; margin-bottom: 6px; }
.sub { font-size: 11px; color: #333; margin-bottom: 6px; }
.hr { border-top: 1px dashed #000; margin: 6px 0; }
table { width: 100%; border-collapse: collapse; font-size: 11px; }
td { padding: 3px 0; vertical-align: top; }
td.qty { width: 28px; text-align: center; }
td.amt { width: 48px; text-align: ${`${isAr ? 'left' : 'right'}`}; font-variant-numeric: tabular-nums; }
td.lbl { color: #555; font-size: 10px; }
td.val { text-align: ${`${isAr ? 'left' : 'right'}`}; font-size: 10px; font-weight: 600; font-variant-numeric: tabular-nums; }
.dish { font-weight: 700; }
.dish-nm { font-weight: 700; margin-bottom: 1px; }
.uprice-line { font-size: 10px; color: #333; padding-${`${isAr ? 'right' : 'left'}`}: 4px; font-variant-numeric: tabular-nums; }
.nutr { font-size: 10px; color: #444; padding-${`${isAr ? 'right' : 'left'}`}: 4px; }
.total-row { font-size: 13px; font-weight: 700; border-top: 1px solid #000; padding-top: 4px; margin-top: 2px; }
.meta { font-size: 10px; color: #444; margin-top: 6px; }
.badge { display: inline-block; padding: 2px 8px; border: 1px solid #000; font-size: 10px; border-radius: 4px; }
.total { font-size: 13px; font-weight: 700; text-align: ${`${isAr ? 'right' : 'left'}`}; margin-top: 4px; font-variant-numeric: tabular-nums; }
`, []);

  const saveToDevice = useCallback(async (html: string, fileLabel: string, width?: number) => {
    try {
      if (Platform.OS === 'web') {
        if (typeof document === 'undefined') return;
        const blob = new Blob([html], { type: 'text/html' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${fileLabel}.html`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 5000);
        pushStatusToast('success', 'save_ok', lang === 'ar' ? `تم الحفظ: ${fileLabel}.html` : `Saved: ${fileLabel}.html`);
        return;
      }
      const opts: any = { html };
      if (width) opts.width = width;
      const { uri: tmpUri } = await Print.printToFileAsync(opts);
      const safeName = fileLabel.replace(/[^a-zA-Z0-9\u0600-\u06FF _-]/g, '_') + '.pdf';
      const destUri = `${FileSystem.documentDirectory ?? ''}${safeName}`;
      await FileSystem.copyAsync({ from: tmpUri, to: destUri });
      pushStatusToast('success', 'save_ok', lang === 'ar' ? `تم الحفظ: ${safeName}` : `Saved: ${safeName}`);
    } catch (e: any) {
      pushStatusToast('error', 'save_error', e?.message ?? (lang === 'ar' ? 'تعذّر الحفظ' : 'Save failed'));
    }
  }, [lang, pushStatusToast]);

  const sharePdf = useCallback(async (html: string, fileLabel: string, width?: number) => {
    try {
      if (Platform.OS === 'web') {
        // Hidden iframe pipeline. `Print.printAsync({ html })` on web swaps
        // the document body — which renders the *report modal UI* instead of
        // the report itself. Mounting the HTML inside an off-screen iframe
        // and triggering its `contentWindow.print()` keeps the host page
        // intact and prints just the report.
        if (typeof document === 'undefined') return;
        const iframe = document.createElement('iframe') as HTMLIFrameElement;
        iframe.setAttribute('aria-hidden', 'true');
        iframe.title = fileLabel;
        iframe.style.position = 'fixed';
        iframe.style.right = '0';
        iframe.style.bottom = '0';
        iframe.style.width = '0';
        iframe.style.height = '0';
        iframe.style.border = '0';
        iframe.style.opacity = '0';
        iframe.style.pointerEvents = 'none';
        document.body.appendChild(iframe);

        const cleanup = () => {
          try { iframe.parentNode?.removeChild(iframe); } catch {}
        };

        const triggerPrint = () => {
          try {
            const win = iframe.contentWindow;
            if (!win) { cleanup(); return; }
            const onAfterPrint = () => { cleanup(); };
            try { win.addEventListener('afterprint', onAfterPrint, { once: true } as any); } catch {}
            // Fallback removal in case `afterprint` never fires (e.g. user
            // dismisses the dialog without printing on some browsers).
            setTimeout(cleanup, 60_000);
            win.focus();
            win.print();
          } catch {
            cleanup();
          }
        };

        // Prefer srcdoc when supported; fall back to document.write.
        const ifr = iframe as any;
        ifr.onload = triggerPrint;
        if ('srcdoc' in iframe) {
          ifr.srcdoc = html;
        } else {
          const doc = ifr.contentDocument as Document | null;
          if (doc) {
            doc.open();
            doc.write(html);
            doc.close();
          } else {
            cleanup();
          }
        }
      } else {
        const opts: any = { html };
        if (width) opts.width = width;
        const { uri } = await Print.printToFileAsync(opts);
        const canShare = await Sharing.isAvailableAsync();
        if (canShare) {
          await Sharing.shareAsync(uri, { mimeType: 'application/pdf', dialogTitle: fileLabel, UTI: 'com.adobe.pdf' });
        }
      }
    } catch (e: any) {
      pushStatusToast('error', 'print_share_error', e?.message ?? (lang === 'ar' ? 'تعذّر التصدير' : 'Export failed'));
    }
  }, [lang, pushStatusToast]);

  // ── Date-range helpers (used by Print Hub date-pickers) ─────────────
  const rangeToBounds = useCallback((key: 'today' | 'yesterday' | 'last7' | 'last30' | 'all') => {
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const endOfToday   = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
    switch (key) {
      case 'today':     return { start: startOfToday, end: endOfToday, label: lang === 'ar' ? 'اليوم' : 'Today' };
      case 'yesterday': {
        const s = new Date(startOfToday); s.setDate(s.getDate() - 1);
        const e = new Date(endOfToday);   e.setDate(e.getDate() - 1);
        return { start: s, end: e, label: lang === 'ar' ? 'أمس' : 'Yesterday' };
      }
      case 'last7': {
        const s = new Date(startOfToday); s.setDate(s.getDate() - 6);
        return { start: s, end: endOfToday, label: lang === 'ar' ? 'آخر 7 أيام' : 'Last 7 days' };
      }
      case 'last30': {
        const s = new Date(startOfToday); s.setDate(s.getDate() - 29);
        return { start: s, end: endOfToday, label: lang === 'ar' ? 'آخر 30 يوم' : 'Last 30 days' };
      }
      default: return { start: null as Date | null, end: null as Date | null, label: lang === 'ar' ? 'كل الوقت' : 'All time' };
    }
  }, [lang]);

  const inRange = useCallback((iso: any, start: Date | null, end: Date | null) => {
    if (!start || !end) return true;
    if (!iso) return false;
    const t = new Date(iso).getTime();
    if (Number.isNaN(t)) return false;
    return t >= start.getTime() && t <= end.getTime();
  }, []);

  const fmtRangeDisplay = useCallback((start: Date | null, end: Date | null) => {
    if (!start || !end) return lang === 'ar' ? 'كل الوقت' : 'All time';
    const fmt = (d: Date) => d.toLocaleDateString(lang === 'ar' ? 'ar-EG' : 'en-US', { day: 'numeric', month: 'short', year: 'numeric' });
    const sameDay = start.getFullYear() === end.getFullYear() && start.getMonth() === end.getMonth() && start.getDate() === end.getDate();
    return sameDay ? fmt(start) : `${fmt(start)} – ${fmt(end)}`;
  }, [lang]);

  // ── Modern 2026 PDF shell — print-safe (no gradients in critical chrome),
  // accent navy header, gold reserved for grand totals only. ────────────
  const buildModernPdfHtml = useCallback((opts: {
    title: string;
    subtitle?: string;
    restName: string;
    logoUrl?: string;
    generatedAt: string;
    rangeLabel?: string;
    kpis?: Array<{ label: string; value: string; tone?: 'gold' | 'accent' | 'neutral' }>;
    bodyHtml: string;
  }) => {
    const dir = lang === 'ar' ? 'rtl' : 'ltr';
    const align = lang === 'ar' ? 'right' : 'left';
    const kpiHtml = (opts.kpis && opts.kpis.length > 0)
      ? `<div class="kpis" style="grid-template-columns:repeat(${Math.min(opts.kpis.length, 4)},1fr)">${opts.kpis.map(k => `
          <div class="kpi"><div class="l">${escapeHtml(k.label)}</div><div class="v ${k.tone || 'neutral'}">${ltrNum(k.value)}</div></div>
        `).join('')}</div>`
      : '';
    const logoHtml = opts.logoUrl
      ? `<img src="${escapeHtml(opts.logoUrl)}" alt="logo" onerror="this.style.display='none'" style="position:absolute;${lang === 'ar' ? 'left' : 'right'}:22px;top:50%;transform:translateY(-50%);height:60px;width:60px;object-fit:cover;border-radius:10px;border:2px solid rgba(255,255,255,0.25);">`
      : '';
    return `<!DOCTYPE html><html dir="${dir}"><head><meta charset="utf-8"><title>${escapeHtml(opts.title)} — ${escapeHtml(opts.restName)}</title><style>
@page { size: A4; margin: 14mm 12mm; }
* { box-sizing: border-box; }
body { font-family: ${lang === 'ar' ? "'Arial','Helvetica',sans-serif" : "-apple-system,BlinkMacSystemFont,'Segoe UI','Inter',Arial,sans-serif"}; color: #0F172A; margin: 0; padding: 0; font-size: 12px; line-height: 1.5; background: #FFFFFF; }
.hdr { background: #0F172A; color: #fff; padding: 22px 26px; border-radius: 14px; margin: 0 0 22px; position: relative; overflow: hidden; }
.hdr h1 { font-size: 22px; margin: 0 0 4px; font-weight: 800; letter-spacing: -0.4px; color: #FCD34D; }
.hdr .sub { font-size: 12px; opacity: 0.82; }
.hdr .meta { display: flex; gap: 18px; margin-top: 12px; font-size: 11px; opacity: 0.85; flex-wrap: wrap; }
.hdr .meta span b { color: #FCD34D; font-weight: 700; margin-${lang === 'ar' ? 'left' : 'right'}: 4px; }
.kpis { display: grid; gap: 10px; margin: 0 0 22px; }
.kpi { background: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 12px; padding: 14px; }
.kpi .l { font-size: 10px; color: #64748B; text-transform: uppercase; letter-spacing: 0.6px; font-weight: 600; margin-bottom: 6px; }
.kpi .v { font-size: 19px; font-weight: 800; color: #0F172A; letter-spacing: -0.4px; }
.kpi .v.gold { color: #B8872A; }
.kpi .v.accent { color: #1E5BBF; }
h3.sec { font-size: 13px; color: #0F172A; margin: 22px 0 10px; font-weight: 700; padding-${align}: 10px; border-${align}: 3px solid #B8872A; }
table.tbl { width: 100%; border-collapse: separate; border-spacing: 0; font-size: 11px; background: #FFFFFF; border: 1px solid #E2E8F0; border-radius: 12px; overflow: hidden; margin: 0 0 14px; }
table.tbl th { background: #F8FAFC; color: #475569; font-weight: 700; text-transform: uppercase; letter-spacing: 0.4px; font-size: 10px; padding: 10px 12px; text-align: ${align}; border-bottom: 1px solid #E2E8F0; }
table.tbl td { padding: 9px 12px; border-bottom: 1px solid #F1F5F9; vertical-align: middle; }
table.tbl tr:last-child td { border-bottom: none; }
table.tbl tr:nth-child(even) td { background: #FAFBFC; }
.t-num { font-variant-numeric: tabular-nums; font-weight: 600; text-align: ${lang === 'ar' ? 'left' : 'right'}; }
.t-tot { font-weight: 800; color: #B8872A; text-align: ${lang === 'ar' ? 'left' : 'right'}; }
.pill { display: inline-block; padding: 3px 9px; border-radius: 999px; font-size: 10px; font-weight: 700; }
.pill.size { background: #EFF6FF; color: #1E5BBF; border: 1px solid #BFDBFE; margin-${lang === 'ar' ? 'left' : 'right'}: 4px; }
.pill.delivered { background: #ECFDF5; color: #059669; border: 1px solid #A7F3D0; }
.pill.preparing { background: #EFF6FF; color: #1E5BBF; border: 1px solid #BFDBFE; }
.pill.pending   { background: #FEF3C7; color: #B45309; border: 1px solid #FDE68A; }
.pill.ready     { background: #ECFEFF; color: #0E7490; border: 1px solid #A5F3FC; }
.pill.shipped   { background: #EDE9FE; color: #6D28D9; border: 1px solid #DDD6FE; }
.pill.cancelled { background: #FEE2E2; color: #B91C1C; border: 1px solid #FECACA; }
.pill.confirmed { background: #ECFDF5; color: #059669; border: 1px solid #A7F3D0; }
.pill.completed { background: #EFF6FF; color: #1E5BBF; border: 1px solid #BFDBFE; }
.order { border: 1px solid #E2E8F0; border-radius: 12px; padding: 14px 16px; margin: 0 0 12px; background: #FFFFFF; page-break-inside: avoid; }
.order .ohead { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; padding-bottom: 8px; border-bottom: 1px dashed #E2E8F0; }
.order .ohead .num { font-size: 14px; font-weight: 800; color: #1E5BBF; }
.order .ometa { font-size: 10px; color: #64748B; margin-top: 2px; }
.otot { background: #FFF7E6; border: 1px solid rgba(184,135,42,0.30); border-radius: 8px; padding: 8px 14px; margin-top: 8px; display: flex; justify-content: space-between; align-items: center; font-weight: 700; }
.otot .l { color: #6b4d10; font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px; }
.otot .v { color: #B8872A; font-size: 15px; font-weight: 900; }
.grand { margin-top: 18px; padding: 14px 18px; background: #0F172A; color: #FCD34D; border-radius: 12px; display: flex; justify-content: space-between; align-items: center; font-size: 16px; font-weight: 800; }
.grand .l { font-size: 11px; text-transform: uppercase; letter-spacing: 0.8px; opacity: 0.85; }
.bar-row { display: flex; align-items: center; gap: 12px; margin: 8px 0; font-size: 11px; }
.bar-l { width: 110px; color: #475569; font-weight: 600; }
.bar-t { flex: 1; height: 10px; background: #F1F5F9; border-radius: 6px; overflow: hidden; }
.bar-f { height: 10px; border-radius: 6px; }
.bar-n { width: 36px; text-align: ${lang === 'ar' ? 'left' : 'right'}; font-weight: 800; color: #0F172A; }
.empty { padding: 40px; text-align: center; color: #94A3B8; font-size: 13px; background: #F8FAFC; border-radius: 12px; }
.ftr { margin-top: 28px; padding-top: 14px; border-top: 1px solid #E2E8F0; font-size: 10px; color: #94A3B8; text-align: center; letter-spacing: 0.4px; }
</style></head><body dir="${dir}">
<div class="hdr">
  ${logoHtml}
  <h1>${escapeHtml(opts.title)}</h1>
  <div class="sub">${escapeHtml(opts.restName)}${opts.subtitle ? ` · ${escapeHtml(opts.subtitle)}` : ''}</div>
  <div class="meta">
    ${opts.rangeLabel ? `<span><b>${lang === 'ar' ? 'الفترة:' : 'Period:'}</b>${escapeHtml(opts.rangeLabel)}</span>` : ''}
    <span><b>${lang === 'ar' ? 'صدر:' : 'Generated:'}</b>${escapeHtml(opts.generatedAt)}</span>
  </div>
</div>
${kpiHtml}
${opts.bodyHtml}
<div class="ftr">Al-Ghazaly Dining Platform · ${escapeHtml(opts.generatedAt)}</div>
</body></html>`;
  }, [lang, escapeHtml, ltrNum]);

  // Map order status → CSS pill class
  const orderPill = useCallback((status: string) => {
    const lbl = lang === 'ar' ? (ORDER_STATUS[status]?.labelAr ?? status) : (ORDER_STATUS[status]?.label ?? status);
    return `<span class="pill ${escapeHtml(status)}">${escapeHtml(lbl)}</span>`;
  }, [lang, escapeHtml]);

  const apptPill = useCallback((status: string) => {
    const lbl = lang === 'ar' ? (APPT_STATUS[status]?.labelAr ?? status) : (APPT_STATUS[status]?.label ?? status);
    return `<span class="pill ${escapeHtml(status)}">${escapeHtml(lbl)}</span>`;
  }, [lang, escapeHtml]);

  const itemSizeOf = useCallback((it: any) =>
    it?.fitment_indicator || it?.size || it?.product_fitment_indicator || null,
  []);

  const sizePillHtml = useCallback((size: string | null) => {
    if (!size || size === 'STD') return '';
    return `<span class="pill size">${escapeHtml(size)}</span>`;
  }, [escapeHtml]);

  // ── Orders PDF (Daily Brief / Detailed) — date-range aware ────────────
  const handleDownloadOrders = useCallback(async (mode: 'daily' | 'detailed' = 'daily', rangeKey: DateRangeKey = 'today') => {
    const allOrders = ordersQ.data?.orders ?? [];
    const { start, end, label } = rangeToBounds(rangeKey);
    const filtered = allOrders.filter((o: any) => inRange(o.created_at, start, end));
    if (filtered.length === 0) {
      pushStatusToast('error', 'print-no-orders',
        lang === 'ar' ? `لا توجد طلبات في الفترة (${label})` : `No orders in range: ${label}`);
      return;
    }
    const restName2 = selectedRestaurant
      ? (lang === 'ar' ? (selectedRestaurant.name_ar || selectedRestaurant.name) : selectedRestaurant.name)
      : 'restaurant';
    const parseItems = (o: any): any[] => {
      try { if (Array.isArray(o.items)) return o.items; if (typeof o.items === 'string') return JSON.parse(o.items); } catch {}
      return [];
    };
    const totalSum    = filtered.reduce((s: number, o: any) => s + parseFloat(String(o.total_amount || 0)), 0);
    const deliverySum = filtered.reduce((s: number, o: any) => s + parseFloat(String(o.shipping_cost || 0)), 0);
    const taxSum      = filtered.reduce((s: number, o: any) => s + parseFloat(String(o.tax_amount    || 0)), 0);
    const hasTax      = taxSum > 0;
    const dishCount   = filtered.reduce((s: number, o: any) => s + parseItems(o).reduce((q: number, it: any) => q + (it.quantity ?? 1), 0), 0);
    const generatedAt = new Date().toLocaleString(lang === 'ar' ? 'ar-EG' : 'en-US');
    const rangeLabel = fmtRangeDisplay(start, end);

    let body = '';
    if (mode === 'daily') {
      const tableRows = filtered.map((o: any) => {
        const num = o.restaurant_order_number ? `R-${o.restaurant_order_number}` : `#${o.order_number || String(o.id ?? '').slice(0, 8)}`;
        const cName = o.customer_name || o.user_name || o.joined_user_name || '—';
        const totalAmt    = parseFloat(String(o.total_amount  || 0));
        const shippingAmt = parseFloat(String(o.shipping_cost || 0));
        const taxAmt      = parseFloat(String(o.tax_amount    || 0));
        const subtotalAmt = totalAmt - shippingAmt - taxAmt;
        const total    = totalAmt.toFixed(0);
        const delivery = shippingAmt.toFixed(0);
        const tax      = taxAmt.toFixed(0);
        const subtotal = subtotalAmt.toFixed(0);
        const date = o.created_at ? new Date(o.created_at).toLocaleString(lang === 'ar' ? 'ar-EG' : 'en-US', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—';
        const items = parseItems(o);
        const sizes = Array.from(new Set(items.map(itemSizeOf).filter((s: any) => s && s !== 'STD')));
        const sizesHtml = sizes.map((s: any) => sizePillHtml(s)).join('');
        return `<tr>
          <td><strong style="color:#1E5BBF">${escapeHtml(num)}</strong></td>
          <td>${escapeHtml(cName)}</td>
          <td>${orderPill(o.status || 'pending')}</td>
          <td>${escapeHtml(date)}</td>
          <td style="text-align:center">${ltrNum(items.length)}${sizesHtml ? `<div style="margin-top:4px">${sizesHtml}</div>` : ''}</td>
          <td class="t-num">${ltrNum(subtotal)} ${lang === 'ar' ? 'ج.م' : 'EGP'}</td>
          <td class="t-num" style="color:#1E5BBF">${ltrNum(delivery)} ${lang === 'ar' ? 'ج.م' : 'EGP'}</td>
          ${hasTax ? `<td class="t-num" style="color:#059669">${ltrNum(tax)} ${lang === 'ar' ? 'ج.م' : 'EGP'}</td>` : ''}
          <td class="t-tot">${ltrNum(total)} ${lang === 'ar' ? 'ج.م' : 'EGP'}</td>
        </tr>`;
      }).join('');
      const subtotalSum = totalSum - deliverySum - taxSum;
      body = `<table class="tbl">
        <thead><tr>
          <th>${lang === 'ar' ? 'رقم الطلب' : 'Order #'}</th>
          <th>${lang === 'ar' ? 'العميل' : 'Customer'}</th>
          <th>${lang === 'ar' ? 'الحالة' : 'Status'}</th>
          <th>${lang === 'ar' ? 'التاريخ' : 'Date'}</th>
          <th style="text-align:center">${lang === 'ar' ? 'الأطباق' : 'Items'}</th>
          <th style="text-align:${lang === 'ar' ? 'left' : 'right'}">${lang === 'ar' ? 'المجموع الفرعي' : 'Subtotal'}</th>
          <th style="text-align:${lang === 'ar' ? 'left' : 'right'}">${lang === 'ar' ? 'التوصيل' : 'Delivery'}</th>
          ${hasTax ? `<th style="text-align:${lang === 'ar' ? 'left' : 'right'}">${lang === 'ar' ? 'الضريبة' : 'Tax'}</th>` : ''}
          <th style="text-align:${lang === 'ar' ? 'left' : 'right'}">${lang === 'ar' ? 'الإجمالي' : 'Total'}</th>
        </tr></thead>
        <tbody>${tableRows}</tbody>
      </table>
      <div class="grand" style="flex-direction:column;gap:6px;align-items:stretch;">
        <div style="display:flex;justify-content:space-between;font-size:11px;opacity:0.8;">
          <span>${lang === 'ar' ? 'المجموع الفرعي' : 'Subtotal'}</span><span>${ltrNum(subtotalSum.toFixed(0))} ${lang === 'ar' ? 'ج.م' : 'EGP'}</span>
        </div>
        <div style="display:flex;justify-content:space-between;font-size:11px;opacity:0.8;">
          <span>${lang === 'ar' ? 'إجمالي رسوم التوصيل' : 'Total Delivery Fees'}</span><span>${ltrNum(deliverySum.toFixed(0))} ${lang === 'ar' ? 'ج.م' : 'EGP'}</span>
        </div>
        ${hasTax ? `<div style="display:flex;justify-content:space-between;font-size:11px;opacity:0.8;"><span>${lang === 'ar' ? 'إجمالي الضريبة' : 'Total Tax'}</span><span>${ltrNum(taxSum.toFixed(0))} ${lang === 'ar' ? 'ج.م' : 'EGP'}</span></div>` : ''}
        <div style="display:flex;justify-content:space-between;border-top:1px solid rgba(252,211,77,0.4);padding-top:6px;margin-top:2px;">
          <span class="l">${lang === 'ar' ? 'الإجمالي الكلّي' : 'Grand Total'}</span><span>${ltrNum(totalSum.toFixed(0))} ${lang === 'ar' ? 'ج.م' : 'EGP'}</span>
        </div>
      </div>`;
    } else {
      body = filtered.map((o: any) => {
        const num = o.restaurant_order_number ? `R-${o.restaurant_order_number}` : `#${o.order_number || String(o.id ?? '').slice(0, 8)}`;
        const cName = o.customer_name || o.user_name || o.joined_user_name || '—';
        const phone = o.customer_phone || o.user_phone || '';
        const totalAmt2    = parseFloat(String(o.total_amount  || 0));
        const shippingAmt2 = parseFloat(String(o.shipping_cost || 0));
        const taxAmt2      = parseFloat(String(o.tax_amount    || 0));
        const subtotalAmt2 = totalAmt2 - shippingAmt2 - taxAmt2;
        const total    = totalAmt2.toFixed(0);
        const delivery = shippingAmt2.toFixed(0);
        const tax      = taxAmt2.toFixed(0);
        const subtotal = subtotalAmt2.toFixed(0);
        const date = o.created_at ? new Date(o.created_at).toLocaleString(lang === 'ar' ? 'ar-EG' : 'en-US') : '—';
        const items = parseItems(o);
        const dishRows = items.map((it: any, i: number) => {
          const nm = lang === 'ar'
            ? (it.name_ar || it.product_name_ar || it.name || it.product_name || `طبق ${i + 1}`)
            : (it.name || it.product_name || it.name_ar || `Dish ${i + 1}`);
          const q = it.quantity ?? 1;
          const pr = parseFloat(String(it.unit_price || it.final_unit_price || it.price || 0));
          const sz = itemSizeOf(it);
          return `<tr>
            <td><strong>${escapeHtml(nm)}</strong>${sz ? ` ${sizePillHtml(sz)}` : ''}</td>
            <td style="text-align:center">× ${q}</td>
            <td class="t-num">${ltrNum(pr.toFixed(0))}</td>
            <td class="t-num">${ltrNum((pr * q).toFixed(0))}</td>
          </tr>`;
        }).join('');
        return `<div class="order">
          <div class="ohead">
            <div>
              <div class="num">${escapeHtml(num)}</div>
              <div class="ometa">${escapeHtml(cName)}${phone ? ` · ${escapeHtml(phone)}` : ''} · ${escapeHtml(date)}</div>
            </div>
            ${orderPill(o.status || 'pending')}
          </div>
          <table class="tbl">
            <thead><tr>
              <th>${lang === 'ar' ? 'الطبق' : 'Dish'}</th>
              <th style="text-align:center">${lang === 'ar' ? 'الكمية' : 'Qty'}</th>
              <th style="text-align:${lang === 'ar' ? 'left' : 'right'}">${lang === 'ar' ? 'السعر' : 'Price'}</th>
              <th style="text-align:${lang === 'ar' ? 'left' : 'right'}">${lang === 'ar' ? 'الإجمالي' : 'Subtotal'}</th>
            </tr></thead>
            <tbody>${dishRows || `<tr><td colspan="4" style="text-align:center;color:#94A3B8">${lang === 'ar' ? 'لا توجد أطباق' : 'No dishes'}</td></tr>`}</tbody>
          </table>
          <div class="otot" style="flex-direction:column;align-items:stretch;gap:5px;">
            <div style="display:flex;justify-content:space-between;font-size:10px;color:#6b4d10;">
              <span>${lang === 'ar' ? 'المجموع الفرعي' : 'Subtotal'}</span><span>${ltrNum(subtotal)} ${lang === 'ar' ? 'ج.م' : 'EGP'}</span>
            </div>
            <div style="display:flex;justify-content:space-between;font-size:10px;color:#1E5BBF;">
              <span>${lang === 'ar' ? 'رسوم التوصيل' : 'Delivery'}</span><span>${ltrNum(delivery)} ${lang === 'ar' ? 'ج.م' : 'EGP'}</span>
            </div>
            ${taxAmt2 > 0 ? `<div style="display:flex;justify-content:space-between;font-size:10px;color:#059669;"><span>${lang === 'ar' ? 'الضريبة' : 'Tax'}</span><span>${ltrNum(tax)} ${lang === 'ar' ? 'ج.م' : 'EGP'}</span></div>` : ''}
            <div style="display:flex;justify-content:space-between;border-top:1px dashed rgba(184,135,42,0.35);padding-top:5px;margin-top:2px;">
              <span class="l">${lang === 'ar' ? 'إجمالي الطلب' : 'Order Total'}</span><span class="v">${ltrNum(total)} ${lang === 'ar' ? 'ج.م' : 'EGP'}</span>
            </div>
          </div>
        </div>`;
      }).join('');
      const subtotalSumD = totalSum - deliverySum - taxSum;
      body += `<div class="grand" style="flex-direction:column;gap:6px;align-items:stretch;">
        <div style="display:flex;justify-content:space-between;font-size:11px;opacity:0.8;">
          <span>${lang === 'ar' ? 'المجموع الفرعي' : 'Subtotal'}</span><span>${ltrNum(subtotalSumD.toFixed(0))} ${lang === 'ar' ? 'ج.م' : 'EGP'}</span>
        </div>
        <div style="display:flex;justify-content:space-between;font-size:11px;opacity:0.8;">
          <span>${lang === 'ar' ? 'إجمالي رسوم التوصيل' : 'Total Delivery Fees'}</span><span>${ltrNum(deliverySum.toFixed(0))} ${lang === 'ar' ? 'ج.م' : 'EGP'}</span>
        </div>
        ${hasTax ? `<div style="display:flex;justify-content:space-between;font-size:11px;opacity:0.8;"><span>${lang === 'ar' ? 'إجمالي الضريبة' : 'Total Tax'}</span><span>${ltrNum(taxSum.toFixed(0))} ${lang === 'ar' ? 'ج.م' : 'EGP'}</span></div>` : ''}
        <div style="display:flex;justify-content:space-between;border-top:1px solid rgba(252,211,77,0.4);padding-top:6px;margin-top:2px;">
          <span class="l">${lang === 'ar' ? 'الإجمالي الكلّي' : 'Grand Total'}</span><span>${ltrNum(totalSum.toFixed(0))} ${lang === 'ar' ? 'ج.م' : 'EGP'}</span>
        </div>
      </div>`;
    }

    const kpis: Array<{ label: string; value: string; tone: 'gold' | 'accent' | 'neutral' }> = [
      { label: lang === 'ar' ? 'الطلبات' : 'Orders',        value: String(filtered.length),                                    tone: 'accent'  },
      { label: lang === 'ar' ? 'الأطباق' : 'Dishes',        value: String(dishCount),                                          tone: 'neutral' },
      { label: lang === 'ar' ? 'الإيرادات' : 'Revenue',     value: `${totalSum.toFixed(0)} ${lang === 'ar' ? 'ج.م' : 'EGP'}`, tone: 'gold'    },
      { label: lang === 'ar' ? 'رسوم التوصيل' : 'Delivery', value: `${deliverySum.toFixed(0)} ${lang === 'ar' ? 'ج.م' : 'EGP'}`, tone: 'neutral' },
      ...(hasTax ? [{ label: lang === 'ar' ? 'الضريبة' : 'Tax', value: `${taxSum.toFixed(0)} ${lang === 'ar' ? 'ج.م' : 'EGP'}`, tone: 'neutral' as const }] : []),
    ];
    const html = buildModernPdfHtml({
      title: lang === 'ar'
        ? (mode === 'daily' ? 'تقرير الطلبات اليومي' : 'تقرير الطلبات التفصيلي')
        : (mode === 'daily' ? 'Orders — Daily Brief' : 'Orders — Detailed Report'),
      restName: restName2, logoUrl: selectedRestaurant?.image_url ?? undefined, generatedAt, rangeLabel, kpis, bodyHtml: body,
    });
    // Delay opening the preview so any outgoing modal (Print Hub) can finish
    // its dismiss animation before the preview slides in (iOS stacking guard).
    const _ordersPayload = { html, fileLabel: `${restName2} Orders ${rangeLabel}` };
    if (Platform.OS === 'ios') {
      setTimeout(() => setPrintPreview(_ordersPayload), 380);
    } else {
      setPrintPreview(_ordersPayload);
    }
  }, [ordersQ.data, selectedRestaurant, lang, rangeToBounds, inRange, fmtRangeDisplay, escapeHtml, orderPill, sizePillHtml, itemSizeOf, buildModernPdfHtml, pushStatusToast]);

  // ── Per-row 80mm thermal receipt (Dish Info / Nutrition) ──────────────
  const handlePrintThermal = useCallback(async (order: any, mode: 'info' | 'nutrition', cleanup?: () => void, receiptLang?: 'ar' | 'en') => {
    if (!order) return;
    const effectiveLang = receiptLang ?? (lang === 'ar' ? 'ar' : 'en');
    const restName2 = selectedRestaurant
      ? (effectiveLang === 'ar' ? (selectedRestaurant.name_ar || selectedRestaurant.name) : selectedRestaurant.name)
      : '';
    const items: any[] = (() => {
      try { if (Array.isArray(order.items)) return order.items; if (typeof order.items === 'string') return JSON.parse(order.items); } catch {}
      return [];
    })();
    const num   = order.restaurant_order_number ? `R-${order.restaurant_order_number}` : `#${order.order_number || String(order.id ?? '').slice(0, 8)}`;
    const cName = order.customer_name || order.user_name || order.joined_user_name || '—';
    const date  = order.created_at ? new Date(order.created_at).toLocaleString(effectiveLang === 'ar' ? 'ar-EG' : 'en-US') : '';
    const totalAmt   = parseFloat(String(order.total_amount || 0));
    const shipping   = parseFloat(String(order.shipping_cost || 0));
    const subtotal   = totalAmt - shipping;
    const totalFmt   = totalAmt.toFixed(0);
    const isAr       = effectiveLang === 'ar';
    const dir        = isAr ? 'rtl' : 'ltr';
    const logoUrl    = selectedRestaurant?.image_url ?? null;

    let rowsHtml = '';
    if (mode === 'info') {
      rowsHtml = items.map((it: any, i: number) => {
        const nm = isAr
          ? (it.name_ar || it.product_name_ar || it.name || it.product_name || `طبق ${i + 1}`)
          : (it.name || it.product_name || it.name_ar || `Dish ${i + 1}`);
        const q  = it.quantity ?? 1;
        const pr = parseFloat(String(it.unit_price || it.final_unit_price || it.original_unit_price || it.price || 0));
        const sz = itemSizeOf(it);
        const szTxt = sz && sz !== 'STD' ? ` [${sz}]` : '';
        // Two-row layout on 80mm: dish name, then qty × unit price = subtotal
        return `<tr><td colspan="3"><div class="dish-nm">${escapeHtml(nm)}${escapeHtml(szTxt)}</div><div class="uprice-line">${ltrNum(q)} × ${ltrNum(pr.toFixed(0))} ${isAr ? 'ج.م' : 'EGP'} = <strong>${ltrNum((pr * q).toFixed(0))} ${isAr ? 'ج.م' : 'EGP'}</strong></div></td></tr>`;
      }).join('');
    } else {
      rowsHtml = items.map((it: any, i: number) => {
        const nm = isAr
          ? (it.name_ar || it.product_name_ar || it.name || it.product_name || `طبق ${i + 1}`)
          : (it.name || it.product_name || it.name_ar || `Dish ${i + 1}`);
        const q = it.quantity ?? 1;
        const sz = itemSizeOf(it);
        const szTxt = sz && sz !== 'STD' ? ` [${sz}]` : '';
        const nutr = it.nutrition
          ? (typeof it.nutrition === 'string' ? (() => { try { return JSON.parse(it.nutrition); } catch { return null; } })() : it.nutrition)
          : null;
        const cal = nutr?.calories ?? null;
        const pro = nutr?.protein  ?? null;
        const car = nutr?.carbs    ?? null;
        const fat = nutr?.fat      ?? null;
        const line = (cal !== null || pro !== null || car !== null || fat !== null)
          ? `${cal !== null ? `${(+cal).toFixed(0)} kcal` : ''}${pro !== null ? ` · P ${(+pro).toFixed(1)}g` : ''}${car !== null ? ` · C ${(+car).toFixed(1)}g` : ''}${fat !== null ? ` · F ${(+fat).toFixed(1)}g` : ''}`
          : (isAr ? '— لا تتوفر بيانات' : '— no data');
        return `<tr><td colspan="3"><div class="dish">${escapeHtml(nm)}${escapeHtml(szTxt)} ×${q}</div><div class="nutr">${escapeHtml(line)}</div></td></tr>`;
      }).join('');
    }

    const headerLabel = mode === 'info'
      ? (isAr ? 'معلومات الطبق' : 'Dish Info')
      : (isAr ? 'القيم الغذائية' : 'Nutrition Values');

    // Shipping breakdown for info mode: subtotal + delivery + total
    const totalsHtml = mode === 'info' ? `
  <div class="hr"></div>
  <table>
    ${subtotal !== totalAmt ? `<tr><td class="lbl">${isAr ? 'المجموع الفرعي' : 'Subtotal'}</td><td class="val">${ltrNum(subtotal.toFixed(0))} ${isAr ? 'ج.م' : 'EGP'}</td></tr>` : ''}
    ${shipping > 0 ? `<tr><td class="lbl">${isAr ? 'توصيل' : 'Delivery'}</td><td class="val">${ltrNum(shipping.toFixed(0))} ${isAr ? 'ج.م' : 'EGP'}</td></tr>` : ''}
    <tr class="total-row"><td><strong>${isAr ? 'الإجمالي' : 'Total'}</strong></td><td class="val"><strong>${ltrNum(totalFmt)} ${isAr ? 'ج.م' : 'EGP'}</strong></td></tr>
  </table>` : '';

    const html = `<!DOCTYPE html>
<html dir="${dir}">
<head><meta charset="utf-8"><title>${escapeHtml(num)}</title>
<style>${buildThermalCss(isAr)}</style>
</head>
<body dir="${dir}">
  <div class="ctr">
    ${logoUrl ? `<img src="${escapeHtml(logoUrl)}" class="logo" alt="" onerror="this.style.display='none'" />` : ''}
    <h1>${escapeHtml(restName2)}</h1>
    <div class="sub">${escapeHtml(num)} · ${escapeHtml(cName)}</div>
    <div class="badge">${escapeHtml(headerLabel)}</div>
  </div>
  <div class="hr"></div>
  <table>${rowsHtml || `<tr><td class="ctr">${isAr ? 'لا توجد بيانات' : 'No data'}</td></tr>`}</table>
  ${totalsHtml}
  <div class="hr"></div>
  <div class="meta ctr">${escapeHtml(date)}</div>
  <div class="meta ctr">— Al-Ghazaly Dining —</div>
</body></html>`;
    // Dismiss the thermal chooser first, then open the print preview after
    // the modal dismiss animation finishes. On iOS, stacking a modal.present
    // on top of a modal.dismiss in the same render tick drops the incoming modal.
    cleanup?.();
    const _thermalPayload = { html, fileLabel: `${restName2} ${num}`, width: 226 };
    if (Platform.OS === 'ios') {
      setTimeout(() => setPrintPreview(_thermalPayload), 380);
    } else {
      setPrintPreview(_thermalPayload);
    }
  }, [selectedRestaurant, lang, escapeHtml, ltrNum, buildThermalCss, itemSizeOf, pushStatusToast]);

  // ── Per-row A4 PDF (Dish Info or Nutrition) — modern layout ───────────
  const handlePrintRowPdf = useCallback(async (order: any, mode: 'info' | 'nutrition') => {
    if (!order) return;
    const restName2 = selectedRestaurant
      ? (lang === 'ar' ? (selectedRestaurant.name_ar || selectedRestaurant.name) : selectedRestaurant.name)
      : 'restaurant';
    const items: any[] = (() => {
      try { if (Array.isArray(order.items)) return order.items; if (typeof order.items === 'string') return JSON.parse(order.items); } catch {}
      return [];
    })();
    const num   = order.restaurant_order_number ? `R-${order.restaurant_order_number}` : `#${order.order_number || String(order.id ?? '').slice(0, 8)}`;
    const cName = order.customer_name || order.user_name || order.joined_user_name || '—';
    const phone = order.customer_phone || order.user_phone || '';
    const dateF = order.created_at ? new Date(order.created_at).toLocaleString(lang === 'ar' ? 'ar-EG' : 'en-US') : '—';
    const total = parseFloat(String(order.total_amount || 0));
    const generatedAt = new Date().toLocaleString(lang === 'ar' ? 'ar-EG' : 'en-US');

    let body = '';
    if (mode === 'info') {
      const dishRows = items.map((it: any, i: number) => {
        const nm = lang === 'ar'
          ? (it.name_ar || it.product_name_ar || it.name || it.product_name || `طبق ${i + 1}`)
          : (it.name || it.product_name || it.name_ar || `Dish ${i + 1}`);
        const q  = it.quantity ?? 1;
        const pr = parseFloat(String(it.unit_price || it.final_unit_price || it.price || 0));
        const sz = itemSizeOf(it);
        return `<tr>
          <td><strong>${escapeHtml(nm)}</strong>${sz ? ` ${sizePillHtml(sz)}` : ''}</td>
          <td style="text-align:center">× ${q}</td>
          <td class="t-num">${ltrNum(pr.toFixed(0))}</td>
          <td class="t-num">${ltrNum((pr * q).toFixed(0))}</td>
        </tr>`;
      }).join('');
      body = `<h3 class="sec">${lang === 'ar' ? 'تفاصيل الأطباق' : 'Dish Details'}</h3>
      <table class="tbl"><thead><tr>
        <th>${lang === 'ar' ? 'الطبق' : 'Dish'}</th>
        <th style="text-align:center">${lang === 'ar' ? 'الكمية' : 'Qty'}</th>
        <th style="text-align:${lang === 'ar' ? 'left' : 'right'}">${lang === 'ar' ? 'السعر' : 'Price'}</th>
        <th style="text-align:${lang === 'ar' ? 'left' : 'right'}">${lang === 'ar' ? 'الإجمالي' : 'Subtotal'}</th>
      </tr></thead><tbody>${dishRows || `<tr><td colspan="4" class="empty">${lang === 'ar' ? 'لا توجد أطباق' : 'No dishes'}</td></tr>`}</tbody></table>
      <div class="grand"><span class="l">${lang === 'ar' ? 'إجمالي الطلب' : 'Order Total'}</span><span>${ltrNum(total.toFixed(0))} ${lang === 'ar' ? 'ج.م' : 'EGP'}</span></div>`;
    } else {
      const nutrRows = items.map((it: any, i: number) => {
        const nm = lang === 'ar'
          ? (it.name_ar || it.product_name_ar || it.name || it.product_name || `طبق ${i + 1}`)
          : (it.name || it.product_name || it.name_ar || `Dish ${i + 1}`);
        const q = it.quantity ?? 1;
        const sz = itemSizeOf(it);
        const nutr = it.nutrition
          ? (typeof it.nutrition === 'string' ? (() => { try { return JSON.parse(it.nutrition); } catch { return null; } })() : it.nutrition)
          : null;
        const cal = nutr?.calories ?? null;
        const pro = nutr?.protein  ?? null;
        const car = nutr?.carbs    ?? null;
        const fat = nutr?.fat      ?? null;
        const fmt = (v: any, suf: string) => v !== null && v !== undefined ? `${(+v).toFixed(1)} ${suf}` : '—';
        return `<tr>
          <td><strong>${escapeHtml(nm)}</strong>${sz ? ` ${sizePillHtml(sz)}` : ''}<div style="color:#64748B;font-size:10px;margin-top:2px">× ${q}</div></td>
          <td class="t-num">${cal !== null ? `${(+cal).toFixed(0)} kcal` : '—'}</td>
          <td class="t-num">${fmt(pro, 'g')}</td>
          <td class="t-num">${fmt(car, 'g')}</td>
          <td class="t-num">${fmt(fat, 'g')}</td>
        </tr>`;
      }).join('');
      body = `<h3 class="sec">${lang === 'ar' ? 'القيم الغذائية لكل طبق' : 'Nutrition per Dish'}</h3>
      <table class="tbl"><thead><tr>
        <th>${lang === 'ar' ? 'الطبق' : 'Dish'}</th>
        <th style="text-align:${lang === 'ar' ? 'left' : 'right'}">${lang === 'ar' ? 'سعرات' : 'Calories'}</th>
        <th style="text-align:${lang === 'ar' ? 'left' : 'right'}">${lang === 'ar' ? 'بروتين' : 'Protein'}</th>
        <th style="text-align:${lang === 'ar' ? 'left' : 'right'}">${lang === 'ar' ? 'كربوهيدرات' : 'Carbs'}</th>
        <th style="text-align:${lang === 'ar' ? 'left' : 'right'}">${lang === 'ar' ? 'دهون' : 'Fat'}</th>
      </tr></thead><tbody>${nutrRows || `<tr><td colspan="5" class="empty">${lang === 'ar' ? 'لا توجد بيانات غذائية' : 'No nutrition data'}</td></tr>`}</tbody></table>`;
    }

    const html = buildModernPdfHtml({
      title: mode === 'info'
        ? (lang === 'ar' ? `طلب ${num} — معلومات الأطباق` : `Order ${num} — Dish Info`)
        : (lang === 'ar' ? `طلب ${num} — القيم الغذائية` : `Order ${num} — Nutrition`),
      restName: restName2,
      logoUrl: selectedRestaurant?.image_url ?? undefined,
      subtitle: `${cName}${phone ? ` · ${phone}` : ''}`,
      generatedAt,
      rangeLabel: dateF,
      bodyHtml: body,
    });
    await sharePdf(html, `${restName2} ${num}`);
  }, [selectedRestaurant, lang, escapeHtml, ltrNum, itemSizeOf, sizePillHtml, buildModernPdfHtml, sharePdf]);

  // ── Bookings PDF — date-range aware ────────────────────────────────────
  const handleDownloadAppointments = useCallback(async (mode: 'daily' | 'detailed', rangeKey: DateRangeKey = 'today') => {
    const { start, end, label } = rangeToBounds(rangeKey);
    // All bookings now carry a restaurant_id (server validation +
    // backfill), so the restaurant-scoped query is the sole source.
    const list = (appts ?? []).filter((a: any) => inRange(a.appointment_date, start, end));
    if (list.length === 0) {
      pushStatusToast('error', 'print-no-bookings',
        lang === 'ar' ? `لا توجد حجوزات في الفترة (${label})` : `No bookings in range: ${label}`);
      return;
    }
    const restName2 = selectedRestaurant
      ? (lang === 'ar' ? (selectedRestaurant.name_ar || selectedRestaurant.name) : selectedRestaurant.name)
      : 'restaurant';
    const generatedAt = new Date().toLocaleString(lang === 'ar' ? 'ar-EG' : 'en-US');
    const rangeLabel = fmtRangeDisplay(start, end);

    const fmtTable = (a: any) => {
      const t = a.service_type?.startsWith('table_') ? a.service_type.replace('table_', '') : '—';
      return lang === 'ar' ? `طاولة ${t}` : `Table ${t}`;
    };
    const fmtDateTime = (a: any) => {
      if (!a.appointment_date) return '—';
      const d = new Date(a.appointment_date);
      return d.toLocaleString(lang === 'ar' ? 'ar-EG' : 'en-US',
        { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
    };

    const counts = list.reduce((acc: any, a: any) => {
      acc[a.status] = (acc[a.status] || 0) + 1; return acc;
    }, {});

    let body = '';
    if (mode === 'daily') {
      const rows = list.map((a: any) => `<tr>
        <td><strong style="color:#1E5BBF">${escapeHtml(fmtTable(a))}</strong></td>
        <td>${escapeHtml(a.user_name || '—')}</td>
        <td>${escapeHtml(a.user_phone || '—')}</td>
        <td>${escapeHtml(fmtDateTime(a))}${a.duration_minutes ? `<div style="font-size:10px;color:#64748B">${ltrNum(a.duration_minutes)} ${lang === 'ar' ? 'د' : 'min'}</div>` : ''}</td>
        <td style="text-align:center">${a.party_size ? ltrNum(a.party_size) : '—'}</td>
        <td>${apptPill(a.status || 'pending')}${(a.notes || a.special_requests) ? `<div style="font-size:10px;color:#64748B;margin-top:3px">${escapeHtml((a.notes || a.special_requests || '').slice(0, 60))}</div>` : ''}</td>
      </tr>`).join('');
      body = `<table class="tbl"><thead><tr>
        <th>${lang === 'ar' ? 'الطاولة' : 'Table'}</th>
        <th>${lang === 'ar' ? 'العميل' : 'Customer'}</th>
        <th>${lang === 'ar' ? 'الهاتف' : 'Phone'}</th>
        <th>${lang === 'ar' ? 'الوقت' : 'Date & Time'}</th>
        <th style="text-align:center">${lang === 'ar' ? 'العدد' : 'Party'}</th>
        <th>${lang === 'ar' ? 'الحالة / ملاحظات' : 'Status / Notes'}</th>
      </tr></thead><tbody>${rows}</tbody></table>`;
    } else {
      body = list.map((a: any) => `<div class="order">
        <div class="ohead">
          <div>
            <div class="num">${escapeHtml(fmtTable(a))}</div>
            <div class="ometa">${escapeHtml(a.user_name || '—')}${a.user_phone ? ` · ${escapeHtml(a.user_phone)}` : ''}${a.user_email ? ` · ${escapeHtml(a.user_email)}` : ''}</div>
          </div>
          ${apptPill(a.status || 'pending')}
        </div>
        <table class="tbl"><tbody>
          <tr><td style="width:30%;color:#64748B">${lang === 'ar' ? 'التاريخ والوقت' : 'Date & Time'}</td><td>${escapeHtml(fmtDateTime(a))}${a.duration_minutes ? ` · ${a.duration_minutes} ${lang === 'ar' ? 'د' : 'min'}` : ''}</td></tr>
          ${a.party_size ? `<tr><td style="color:#64748B">${lang === 'ar' ? 'عدد الضيوف' : 'Party Size'}</td><td>${ltrNum(a.party_size)}</td></tr>` : ''}
          ${a.notes ? `<tr><td style="color:#64748B">${lang === 'ar' ? 'ملاحظات' : 'Notes'}</td><td>${escapeHtml(a.notes)}</td></tr>` : ''}
        </tbody></table>
      </div>`).join('');
    }

    const kpis = [
      { label: lang === 'ar' ? 'الإجمالي' : 'Total',         value: String(list.length),         tone: 'accent' as const },
      { label: lang === 'ar' ? 'مؤكدة'   : 'Confirmed',     value: String(counts.confirmed || 0), tone: 'neutral' as const },
      { label: lang === 'ar' ? 'انتظار'  : 'Pending',       value: String(counts.pending   || 0), tone: 'neutral' as const },
      { label: lang === 'ar' ? 'ملغية'   : 'Cancelled',     value: String(counts.cancelled || 0), tone: 'neutral' as const },
    ];
    const html = buildModernPdfHtml({
      title: lang === 'ar'
        ? (mode === 'daily' ? 'تقرير الحجوزات اليومي' : 'تقرير الحجوزات التفصيلي')
        : (mode === 'daily' ? 'Bookings — Daily Brief' : 'Bookings — Detailed Report'),
      restName: restName2, logoUrl: selectedRestaurant?.image_url ?? undefined, generatedAt, rangeLabel, kpis, bodyHtml: body,
    });
    const _bookingsPayload = { html, fileLabel: `${restName2} Bookings ${rangeLabel}` };
    if (Platform.OS === 'ios') {
      setTimeout(() => setPrintPreview(_bookingsPayload), 380);
    } else {
      setPrintPreview(_bookingsPayload);
    }
  }, [appts, selectedRestaurant, lang, rangeToBounds, inRange, fmtRangeDisplay, escapeHtml, ltrNum, apptPill, buildModernPdfHtml, pushStatusToast]);

  // ── Analytics PDF — date-range aware ──────────────────────────────────
  // When `rangeKey` is omitted (or 'all'), the cumulative server `stats`
  // snapshot is used. When a specific range is chosen, KPIs and status
  // distributions are recomputed client-side from orders + appointments
  // that fall inside the range, giving a true "Analytics for last 7 days"
  // PDF that matches what the dashboard tiles show for the same window.
  const handleDownloadAnalytics = useCallback(async (
    mode: 'daily' | 'detailed',
    rangeKey: DateRangeKey = 'all',
    compareKey: CompareRangeKey = 'none',
  ) => {
    const lowStockCount  = lowStockAlertsQ.data  ?? 0;
    const outStockCount  = outOfStockAlertsQ.data ?? 0;
    if (!stats) {
      pushStatusToast('error', 'print-no-analytics',
        lang === 'ar' ? 'لا توجد بيانات تحليلية للتصدير' : 'No analytics data to export');
      return;
    }

    const ordersList: any[] = ordersQ.data?.orders ?? [];
    const sourceAppts: any[] = appts ?? [];

    // Compute a metrics bundle for one range (or use the server snapshot
    // when range='all'). Returned shape mirrors the historical localOrdSt /
    // localApptSt + a friendly label for the range.
    const computeBundle = (key: DateRangeKey) => {
      const { start, end } = rangeToBounds(key);
      const useSnapshot = !start || !end;
      const oList = useSnapshot ? ordersList : ordersList.filter((o: any) => inRange(o.created_at, start, end));
      const aList = useSnapshot ? sourceAppts : sourceAppts.filter((a: any) => inRange(a.appointment_date, start, end));

      const ord: any = useSnapshot ? { ...ordSt } : (() => {
        const acc: any = { total_orders: oList.length, total_revenue: 0, avg_order_value: 0, unique_customers: 0,
          pending: 0, preparing: 0, ready: 0, shipped: 0, delivered: 0, cancelled: 0 };
        const customers = new Set<string>();
        for (const o of oList) {
          acc.total_revenue += Number(o.total_amount) || 0;
          if (o.user_id) customers.add(String(o.user_id));
          const st = String(o.status || 'pending');
          if (st in acc) acc[st] += 1;
        }
        acc.unique_customers = customers.size;
        acc.avg_order_value = oList.length > 0 ? acc.total_revenue / oList.length : 0;
        return acc;
      })();

      const appt: any = useSnapshot ? { ...apptSt } : (() => {
        const acc: any = { total: aList.length, upcoming: 0, confirmed: 0, pending: 0, cancelled: 0 };
        const now = Date.now();
        for (const a of aList) {
          const st = String(a.status || 'pending');
          if (st in acc) acc[st] += 1;
          if (a.appointment_date && new Date(a.appointment_date).getTime() >= now) acc.upcoming += 1;
        }
        return acc;
      })();

      const label = useSnapshot
        ? (lang === 'ar' ? 'إجمالي تراكمي' : 'Cumulative')
        : fmtRangeDisplay(start, end);
      return { ord, appt, label };
    };

    const A = computeBundle(rangeKey);
    const compareEnabled = compareKey !== 'none';
    const B = compareEnabled ? computeBundle(compareKey as DateRangeKey) : null;

    // Combined max so paired bars share the same scale and stay visually
    // comparable across the two ranges.
    const ordMax = Math.max(
      A.ord.delivered ?? 0, A.ord.pending ?? 0, A.ord.preparing ?? 0, A.ord.shipped ?? 0, A.ord.cancelled ?? 0,
      B?.ord.delivered ?? 0, B?.ord.pending ?? 0, B?.ord.preparing ?? 0, B?.ord.shipped ?? 0, B?.ord.cancelled ?? 0,
      1,
    );
    const apptMax = Math.max(
      A.appt.confirmed ?? 0, A.appt.pending ?? 0, A.appt.cancelled ?? 0,
      B?.appt.confirmed ?? 0, B?.appt.pending ?? 0, B?.appt.cancelled ?? 0,
      1,
    );

    const restName2 = selectedRestaurant
      ? (lang === 'ar' ? (selectedRestaurant.name_ar || selectedRestaurant.name) : selectedRestaurant.name)
      : 'restaurant';
    const generatedAt = new Date().toLocaleString(lang === 'ar' ? 'ar-EG' : 'en-US');
    const rangeLabel = compareEnabled && B
      ? `${A.label} ${lang === 'ar' ? 'مقابل' : 'vs'} ${B.label}`
      : A.label;

    // Single-range bar (existing layout)
    const bar = (label: string, value: number, max: number, color: string) => {
      const pct = max > 0 ? Math.max((value / max) * 100, value > 0 ? 4 : 0) : 0;
      return `<div class="bar-row">
        <div class="bar-l">${escapeHtml(label)}</div>
        <div class="bar-t"><div class="bar-f" style="width:${pct.toFixed(1)}%;background:${color}"></div></div>
        <div class="bar-n">${ltrNum(value)}</div>
      </div>`;
    };

    // Paired bar — stacks two thin bars (A then B) inside one row so each
    // status is rendered as a side-by-side comparison.
    const pairBar = (label: string, vA: number, vB: number, max: number, color: string) => {
      const pctA = max > 0 ? Math.max((vA / max) * 100, vA > 0 ? 4 : 0) : 0;
      const pctB = max > 0 ? Math.max((vB / max) * 100, vB > 0 ? 4 : 0) : 0;
      return `<div class="bar-row" style="align-items:flex-start">
        <div class="bar-l">${escapeHtml(label)}</div>
        <div style="flex:1;display:flex;flex-direction:column;gap:4px">
          <div class="bar-t" style="height:8px"><div class="bar-f" style="width:${pctA.toFixed(1)}%;background:${color}"></div></div>
          <div class="bar-t" style="height:8px;background:#EEF2F7"><div class="bar-f" style="width:${pctB.toFixed(1)}%;background:${color};opacity:0.55"></div></div>
        </div>
        <div class="bar-n" style="text-align:${lang === 'ar' ? 'left' : 'right'}">${ltrNum(vA)} <span style="color:#94A3B8">/ ${ltrNum(vB)}</span></div>
      </div>`;
    };

    const renderStatus = () => {
      if (!compareEnabled || !B) {
        return `<h3 class="sec">${lang === 'ar' ? 'توزيع حالات الطلبات' : 'Orders by Status'}</h3>
        <div style="background:#F8FAFC;border:1px solid #E2E8F0;border-radius:12px;padding:14px 18px">
          ${bar(lang === 'ar' ? 'تم التسليم' : 'Delivered', A.ord.delivered ?? 0, ordMax, '#10B981')}
          ${bar(lang === 'ar' ? 'قيد التحضير' : 'Preparing', A.ord.preparing ?? 0, ordMax, '#3B82F6')}
          ${bar(lang === 'ar' ? 'انتظار' : 'Pending', A.ord.pending ?? 0, ordMax, '#F59E0B')}
          ${bar(lang === 'ar' ? 'تم الشحن' : 'Shipped', A.ord.shipped ?? 0, ordMax, '#8B5CF6')}
          ${bar(lang === 'ar' ? 'ملغي' : 'Cancelled', A.ord.cancelled ?? 0, ordMax, '#EF4444')}
        </div>
        <h3 class="sec">${lang === 'ar' ? 'توزيع حالات الحجوزات' : 'Bookings by Status'}</h3>
        <div style="background:#F8FAFC;border:1px solid #E2E8F0;border-radius:12px;padding:14px 18px">
          ${bar(lang === 'ar' ? 'مؤكدة' : 'Confirmed', A.appt.confirmed ?? 0, apptMax, '#10B981')}
          ${bar(lang === 'ar' ? 'انتظار' : 'Pending', A.appt.pending ?? 0, apptMax, '#F59E0B')}
          ${bar(lang === 'ar' ? 'ملغية' : 'Cancelled', A.appt.cancelled ?? 0, apptMax, '#EF4444')}
        </div>`;
      }
      const legend = `<div style="display:flex;gap:14px;font-size:10px;color:#64748B;margin:4px 0 8px">
        <span><span style="display:inline-block;width:10px;height:8px;background:#0F172A;vertical-align:middle;margin-${lang === 'ar' ? 'left' : 'right'}:4px"></span>${escapeHtml(A.label)}</span>
        <span><span style="display:inline-block;width:10px;height:8px;background:#0F172A;opacity:0.55;vertical-align:middle;margin-${lang === 'ar' ? 'left' : 'right'}:4px"></span>${escapeHtml(B.label)}</span>
      </div>`;
      return `<h3 class="sec">${lang === 'ar' ? 'توزيع حالات الطلبات (مقارنة)' : 'Orders by Status (Comparison)'}</h3>
      ${legend}
      <div style="background:#F8FAFC;border:1px solid #E2E8F0;border-radius:12px;padding:14px 18px">
        ${pairBar(lang === 'ar' ? 'تم التسليم' : 'Delivered', A.ord.delivered ?? 0, B.ord.delivered ?? 0, ordMax, '#10B981')}
        ${pairBar(lang === 'ar' ? 'قيد التحضير' : 'Preparing', A.ord.preparing ?? 0, B.ord.preparing ?? 0, ordMax, '#3B82F6')}
        ${pairBar(lang === 'ar' ? 'انتظار' : 'Pending', A.ord.pending ?? 0, B.ord.pending ?? 0, ordMax, '#F59E0B')}
        ${pairBar(lang === 'ar' ? 'تم الشحن' : 'Shipped', A.ord.shipped ?? 0, B.ord.shipped ?? 0, ordMax, '#8B5CF6')}
        ${pairBar(lang === 'ar' ? 'ملغي' : 'Cancelled', A.ord.cancelled ?? 0, B.ord.cancelled ?? 0, ordMax, '#EF4444')}
      </div>
      <h3 class="sec">${lang === 'ar' ? 'توزيع حالات الحجوزات (مقارنة)' : 'Bookings by Status (Comparison)'}</h3>
      ${legend}
      <div style="background:#F8FAFC;border:1px solid #E2E8F0;border-radius:12px;padding:14px 18px">
        ${pairBar(lang === 'ar' ? 'مؤكدة' : 'Confirmed', A.appt.confirmed ?? 0, B.appt.confirmed ?? 0, apptMax, '#10B981')}
        ${pairBar(lang === 'ar' ? 'انتظار' : 'Pending', A.appt.pending ?? 0, B.appt.pending ?? 0, apptMax, '#F59E0B')}
        ${pairBar(lang === 'ar' ? 'ملغية' : 'Cancelled', A.appt.cancelled ?? 0, B.appt.cancelled ?? 0, apptMax, '#EF4444')}
      </div>`;
    };

    const topHtml = (mode === 'detailed' && topProd.length > 0) ? `
    <h3 class="sec">${lang === 'ar' ? 'أكثر الأصناف طلباً' : 'Top Ordered Items'}</h3>
    <table class="tbl"><thead><tr>
      <th style="width:36px">#</th>
      <th>${lang === 'ar' ? 'الصنف' : 'Item'}</th>
      <th style="text-align:center">${lang === 'ar' ? 'الكمية' : 'Qty'}</th>
      <th style="text-align:center">${lang === 'ar' ? 'الطلبات' : 'Orders'}</th>
      <th style="text-align:${lang === 'ar' ? 'left' : 'right'}">${lang === 'ar' ? 'السعر' : 'Price'}</th>
    </tr></thead><tbody>${topProd.map((pr: any, i: number) => `<tr>
      <td><strong style="color:${i < 3 ? '#B8872A' : '#94A3B8'}">${i + 1}</strong></td>
      <td>${escapeHtml(lang === 'ar' ? (pr.name_ar || pr.name) : pr.name)}</td>
      <td style="text-align:center">${ltrNum(pr.total_qty)}</td>
      <td style="text-align:center">${ltrNum(pr.order_count)}</td>
      <td class="t-num">${ltrNum((+pr.price).toFixed(0))} ${lang === 'ar' ? 'ج.م' : 'EGP'}</td>
    </tr>`).join('')}</tbody></table>` : '';

    // KPI rendering — single column when no compare, two columns + delta %
    // when compareEnabled. The compare table is emitted inside bodyHtml so
    // the standard KPI grid stays out of its way.
    let kpis: Array<{ label: string; value: string; tone?: 'gold' | 'accent' | 'neutral' }> = [];
    let compareKpiHtml = '';
    const fmtMoney = (n: number) => `${n.toFixed(0)} ${lang === 'ar' ? 'ج.م' : 'EGP'}`;
    const deltaCell = (a: number, b: number) => {
      if (b === 0) {
        if (a === 0) return `<span style="color:#94A3B8">—</span>`;
        return `<span style="color:#10B981;font-weight:700">+∞%</span>`;
      }
      const d = ((a - b) / b) * 100;
      const sign = d > 0 ? '+' : '';
      const color = d > 0 ? '#10B981' : d < 0 ? '#EF4444' : '#64748B';
      return `<span style="color:${color};font-weight:700">${sign}${d.toFixed(1)}%</span>`;
    };

    if (compareEnabled && B) {
      const rows: Array<{ k: string; a: string; b: string; aN: number; bN: number }> = [
        { k: lang === 'ar' ? 'إجمالي الطلبات' : 'Orders',
          a: String(A.ord.total_orders ?? 0), b: String(B.ord.total_orders ?? 0),
          aN: Number(A.ord.total_orders ?? 0), bN: Number(B.ord.total_orders ?? 0) },
        { k: lang === 'ar' ? 'الإيرادات' : 'Revenue',
          a: fmtMoney(A.ord.total_revenue ?? 0), b: fmtMoney(B.ord.total_revenue ?? 0),
          aN: Number(A.ord.total_revenue ?? 0), bN: Number(B.ord.total_revenue ?? 0) },
        { k: lang === 'ar' ? 'متوسط الطلب' : 'Avg Order',
          a: fmtMoney(A.ord.avg_order_value ?? 0), b: fmtMoney(B.ord.avg_order_value ?? 0),
          aN: Number(A.ord.avg_order_value ?? 0), bN: Number(B.ord.avg_order_value ?? 0) },
        { k: lang === 'ar' ? 'العملاء' : 'Customers',
          a: String(A.ord.unique_customers ?? 0), b: String(B.ord.unique_customers ?? 0),
          aN: Number(A.ord.unique_customers ?? 0), bN: Number(B.ord.unique_customers ?? 0) },
        { k: lang === 'ar' ? 'إجمالي الحجوزات' : 'Total Bookings',
          a: String(A.appt.total ?? 0), b: String(B.appt.total ?? 0),
          aN: Number(A.appt.total ?? 0), bN: Number(B.appt.total ?? 0) },
      ];
      compareKpiHtml = `<h3 class="sec">${lang === 'ar' ? 'مقارنة المؤشرات' : 'KPI Comparison'}</h3>
      <table class="tbl"><thead><tr>
        <th style="width:34%">${lang === 'ar' ? 'المؤشر' : 'Metric'}</th>
        <th style="text-align:center">${escapeHtml(A.label)}</th>
        <th style="text-align:center">${escapeHtml(B.label)}</th>
        <th style="text-align:center;width:18%">Δ%</th>
      </tr></thead><tbody>${rows.map(r => `<tr>
        <td style="color:#64748B">${escapeHtml(r.k)}</td>
        <td class="t-num" style="text-align:center;font-weight:700">${ltrNum(r.a)}</td>
        <td class="t-num" style="text-align:center;color:#475569">${ltrNum(r.b)}</td>
        <td style="text-align:center">${deltaCell(r.aN, r.bN)}</td>
      </tr>`).join('')}</tbody></table>`;
    } else {
      kpis = [
        { label: lang === 'ar' ? 'إجمالي الطلبات' : 'Orders',     value: String(A.ord.total_orders ?? 0),                         tone: 'accent' as const },
        { label: lang === 'ar' ? 'الإيرادات'    : 'Revenue',     value: fmtMoney(A.ord.total_revenue ?? 0),                       tone: 'gold' as const },
        { label: lang === 'ar' ? 'متوسط الطلب' : 'Avg Order',    value: fmtMoney(A.ord.avg_order_value ?? 0),                     tone: 'neutral' as const },
        { label: lang === 'ar' ? 'العملاء'      : 'Customers',   value: String(A.ord.unique_customers ?? 0),                      tone: 'neutral' as const },
      ];
    }

    const bookingsTail = compareEnabled
      ? ''
      : `<h3 class="sec">${lang === 'ar' ? 'الحجوزات' : 'Bookings'}</h3>
      <table class="tbl"><tbody>
        <tr><td style="width:50%;color:#64748B">${lang === 'ar' ? 'إجمالي الحجوزات' : 'Total Bookings'}</td><td class="t-num">${ltrNum(A.appt.total ?? 0)}</td></tr>
        <tr><td style="color:#64748B">${lang === 'ar' ? 'حجوزات قادمة' : 'Upcoming'}</td><td class="t-num">${ltrNum(A.appt.upcoming ?? 0)}</td></tr>
      </tbody></table>`;

    const stockAlertsTail = `<h3 class="sec">${lang === 'ar' ? 'تنبيهات المخزون' : 'Stock Alerts'}</h3>
      <table class="tbl"><tbody>
        <tr>
          <td style="width:60%;color:#64748B">
            <span style="color:#F59E0B;font-weight:700">⚠</span> ${lang === 'ar' ? `مخزون منخفض (آخر ${stockAlertRange} يوم)` : `Low Stock (last ${stockAlertRange} days)`}
          </td>
          <td class="t-num" style="color:#F59E0B;font-weight:800">${ltrNum(lowStockCount)}</td>
        </tr>
        <tr>
          <td style="color:#64748B">
            <span style="color:#EF4444;font-weight:700">✕</span> ${lang === 'ar' ? `نفاد المخزون (آخر ${stockAlertRange} يوم)` : `Out of Stock (last ${stockAlertRange} days)`}
          </td>
          <td class="t-num" style="color:#EF4444;font-weight:800">${ltrNum(outStockCount)}</td>
        </tr>
      </tbody></table>`;

    const body = `${compareKpiHtml}${renderStatus()}${topHtml}${bookingsTail}${stockAlertsTail}`;

    const titleBase = lang === 'ar'
      ? (mode === 'daily' ? 'لقطة تحليلية' : 'تقرير تحليلي تفصيلي')
      : (mode === 'daily' ? 'Analytics — Snapshot' : 'Analytics — Detailed Report');
    const title = compareEnabled
      ? `${titleBase} · ${lang === 'ar' ? 'مقارنة' : 'Comparison'}`
      : titleBase;

    const html = buildModernPdfHtml({
      title, restName: restName2, logoUrl: selectedRestaurant?.image_url ?? undefined, generatedAt, rangeLabel, kpis, bodyHtml: body,
    });
    const _analyticsPayload = { html, fileLabel: `${restName2} Analytics ${rangeLabel}` };
    if (Platform.OS === 'ios') {
      setTimeout(() => setPrintPreview(_analyticsPayload), 380);
    } else {
      setPrintPreview(_analyticsPayload);
    }
  }, [stats, ordSt, apptSt, topProd, ordersQ.data, appts, selectedRestaurant, lang, stockAlertRange, lowStockAlertsQ.data, outOfStockAlertsQ.data, rangeToBounds, inRange, fmtRangeDisplay, escapeHtml, ltrNum, buildModernPdfHtml, pushStatusToast]);

  // ── CSV export helpers ─────────────────────────────────────────────────
  // CSV must be UTF-8 *with BOM* so that Microsoft Excel (which still
  // sniffs encoding via the BOM) renders Arabic columns correctly when
  // the file is opened on a manager's laptop.
  const csvEscape = useCallback((v: any): string => {
    if (v === null || v === undefined) return '';
    let s = String(v);
    // Formula-injection guard — Excel/Sheets execute cells starting with
    // = + - @ \t \r as formulas. Prefix with an apostrophe to neutralise.
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  }, []);
  const buildCsv = useCallback((rows: Array<Array<any>>): string => {
    const body = rows.map(r => r.map(csvEscape).join(',')).join('\r\n');
    return `\ufeff${body}\r\n`;
  }, [csvEscape]);
  const shareCsv = useCallback(async (csv: string, fileLabel: string) => {
    try {
      const safeLabel = fileLabel.replace(/[^\p{L}\p{N}\-_ .]+/gu, '_').slice(0, 80);
      const fileName = `${safeLabel || 'export'}.csv`;
      const uri = `${FileSystem.cacheDirectory ?? ''}${fileName}`;
      await FileSystem.writeAsStringAsync(uri, csv, { encoding: FileSystem.EncodingType.UTF8 });
      const canShare = await Sharing.isAvailableAsync();
      if (canShare) {
        await Sharing.shareAsync(uri, { mimeType: 'text/csv', dialogTitle: fileName, UTI: 'public.comma-separated-values-text' });
      } else {
        pushStatusToast('error', 'csv-share-unavailable',
          lang === 'ar' ? 'المشاركة غير متاحة على هذا الجهاز' : 'Sharing not available on this device');
      }
    } catch (e) {
      pushStatusToast('error', 'csv-share-failed',
        lang === 'ar' ? 'تعذّر تصدير CSV' : 'CSV export failed');
    }
  }, [lang, pushStatusToast]);

  const handleExportOrdersCsv = useCallback(async (rangeKey: DateRangeKey = 'today') => {
    const allOrders = ordersQ.data?.orders ?? [];
    const { start, end, label } = rangeToBounds(rangeKey);
    const filtered = allOrders.filter((o: any) => inRange(o.created_at, start, end));
    if (filtered.length === 0) {
      pushStatusToast('error', 'csv-no-orders',
        lang === 'ar' ? `لا توجد طلبات في الفترة (${label})` : `No orders in range: ${label}`);
      return;
    }
    const restName2 = selectedRestaurant
      ? (lang === 'ar' ? (selectedRestaurant.name_ar || selectedRestaurant.name) : selectedRestaurant.name)
      : 'restaurant';
    const parseItems = (o: any): any[] => {
      try { if (Array.isArray(o.items)) return o.items; if (typeof o.items === 'string') return JSON.parse(o.items); } catch {}
      return [];
    };
    const isAr = lang === 'ar';
    const header = isAr
      ? ['رقم الطلب','التاريخ','العميل','الهاتف','الحالة','عدد الأصناف','إجمالي الكمية','المجموع الفرعي','التوصيل','الضريبة','الإجمالي']
      : ['Order #','Date','Customer','Phone','Status','Items','Quantity','Subtotal','Delivery','Tax','Total'];
    const rows: Array<Array<any>> = [header];
    for (const o of filtered) {
      const num = o.restaurant_order_number ? `R-${o.restaurant_order_number}` : (o.order_number || String(o.id ?? '').slice(0, 8));
      const items = parseItems(o);
      const qty = items.reduce((q: number, it: any) => q + (it.quantity ?? 1), 0);
      const totalAmt    = parseFloat(String(o.total_amount  || 0));
      const shippingAmt = parseFloat(String(o.shipping_cost || 0));
      const taxAmt      = parseFloat(String(o.tax_amount    || 0));
      const subtotalAmt = totalAmt - shippingAmt - taxAmt;
      const dateIso = o.created_at ? new Date(o.created_at).toISOString() : '';
      rows.push([
        num,
        dateIso,
        o.customer_name || o.user_name || o.joined_user_name || '',
        o.customer_phone || o.user_phone || '',
        o.status || 'pending',
        items.length,
        qty,
        subtotalAmt.toFixed(2),
        shippingAmt.toFixed(2),
        taxAmt.toFixed(2),
        totalAmt.toFixed(2),
      ]);
    }
    const csv = buildCsv(rows);
    await shareCsv(csv, `${restName2} Orders ${label}`);
  }, [ordersQ.data, selectedRestaurant, lang, rangeToBounds, inRange, buildCsv, shareCsv, pushStatusToast]);

  const handleExportAppointmentsCsv = useCallback(async (rangeKey: DateRangeKey = 'today') => {
    const { start, end, label } = rangeToBounds(rangeKey);
    const list = (appts ?? []).filter((a: any) => inRange(a.appointment_date, start, end));
    if (list.length === 0) {
      pushStatusToast('error', 'csv-no-bookings',
        lang === 'ar' ? `لا توجد حجوزات في الفترة (${label})` : `No bookings in range: ${label}`);
      return;
    }
    const restName2 = selectedRestaurant
      ? (lang === 'ar' ? (selectedRestaurant.name_ar || selectedRestaurant.name) : selectedRestaurant.name)
      : 'restaurant';
    const isAr = lang === 'ar';
    const header = isAr
      ? ['الطاولة/الخدمة','التاريخ والوقت','المدة (د)','العميل','الهاتف','البريد','عدد الضيوف','الحالة','ملاحظات']
      : ['Table / Service','Date & Time','Duration (min)','Customer','Phone','Email','Party Size','Status','Notes'];
    const rows: Array<Array<any>> = [header];
    for (const a of list) {
      const svc = a.service_type?.startsWith('table_')
        ? `Table ${a.service_type.replace('table_', '')}`
        : (a.service_type || '');
      rows.push([
        svc,
        a.appointment_date ? new Date(a.appointment_date).toISOString() : '',
        a.duration_minutes ?? '',
        a.user_name || '',
        a.user_phone || '',
        a.user_email || '',
        a.party_size ?? '',
        a.status || 'pending',
        a.notes || a.special_requests || '',
      ]);
    }
    const csv = buildCsv(rows);
    await shareCsv(csv, `${restName2} Bookings ${label}`);
  }, [appts, selectedRestaurant, lang, rangeToBounds, inRange, buildCsv, shareCsv, pushStatusToast]);

  const handleExportAnalyticsCsv = useCallback(async (rangeKey: DateRangeKey = 'all') => {
    if (!stats) {
      pushStatusToast('error', 'csv-no-analytics',
        lang === 'ar' ? 'لا توجد بيانات تحليلية للتصدير' : 'No analytics data to export');
      return;
    }
    const { start, end, label } = rangeToBounds(rangeKey);
    const useSnapshot = !start || !end;
    const ordersList: any[] = ordersQ.data?.orders ?? [];
    const sourceAppts: any[] = appts ?? [];
    const oList = useSnapshot ? ordersList : ordersList.filter((o: any) => inRange(o.created_at, start, end));
    const aList = useSnapshot ? sourceAppts : sourceAppts.filter((a: any) => inRange(a.appointment_date, start, end));

    const ord: any = useSnapshot ? { ...ordSt } : (() => {
      const acc: any = { total_orders: oList.length, total_revenue: 0, avg_order_value: 0, unique_customers: 0,
        pending: 0, preparing: 0, ready: 0, shipped: 0, delivered: 0, cancelled: 0 };
      const customers = new Set<string>();
      for (const o of oList) {
        acc.total_revenue += Number(o.total_amount) || 0;
        if (o.user_id) customers.add(String(o.user_id));
        const st = String(o.status || 'pending');
        if (st in acc) acc[st] += 1;
      }
      acc.unique_customers = customers.size;
      acc.avg_order_value = oList.length > 0 ? acc.total_revenue / oList.length : 0;
      return acc;
    })();
    const appt: any = useSnapshot ? { ...apptSt } : (() => {
      const acc: any = { total: aList.length, upcoming: 0, confirmed: 0, pending: 0, cancelled: 0 };
      const now = Date.now();
      for (const a of aList) {
        const st = String(a.status || 'pending');
        if (st in acc) acc[st] += 1;
        if (a.appointment_date && new Date(a.appointment_date).getTime() >= now) acc.upcoming += 1;
      }
      return acc;
    })();

    const restName2 = selectedRestaurant
      ? (lang === 'ar' ? (selectedRestaurant.name_ar || selectedRestaurant.name) : selectedRestaurant.name)
      : 'restaurant';
    const isAr = lang === 'ar';
    const sectionRows: Array<Array<any>> = [
      [isAr ? 'الفترة' : 'Range', useSnapshot ? (isAr ? 'إجمالي تراكمي' : 'Cumulative') : label],
      [isAr ? 'المطعم' : 'Restaurant', restName2],
      [isAr ? 'تاريخ التوليد' : 'Generated At', new Date().toISOString()],
      [],
      [isAr ? 'المؤشر' : 'Metric', isAr ? 'القيمة' : 'Value'],
      [isAr ? 'إجمالي الطلبات' : 'Total Orders', ord.total_orders ?? 0],
      [isAr ? 'الإيرادات (ج.م)' : 'Revenue (EGP)', Number(ord.total_revenue ?? 0).toFixed(2)],
      [isAr ? 'متوسط قيمة الطلب (ج.م)' : 'Avg Order Value (EGP)', Number(ord.avg_order_value ?? 0).toFixed(2)],
      [isAr ? 'العملاء الفريدون' : 'Unique Customers', ord.unique_customers ?? 0],
      [isAr ? 'تم التسليم' : 'Delivered', ord.delivered ?? 0],
      [isAr ? 'قيد التحضير' : 'Preparing', ord.preparing ?? 0],
      [isAr ? 'انتظار (طلبات)' : 'Pending (Orders)', ord.pending ?? 0],
      [isAr ? 'تم الشحن' : 'Shipped', ord.shipped ?? 0],
      [isAr ? 'ملغي (طلبات)' : 'Cancelled (Orders)', ord.cancelled ?? 0],
      [isAr ? 'إجمالي الحجوزات' : 'Total Bookings', appt.total ?? 0],
      [isAr ? 'حجوزات قادمة' : 'Upcoming Bookings', appt.upcoming ?? 0],
      [isAr ? 'مؤكدة' : 'Confirmed', appt.confirmed ?? 0],
      [isAr ? 'انتظار (حجوزات)' : 'Pending (Bookings)', appt.pending ?? 0],
      [isAr ? 'ملغية (حجوزات)' : 'Cancelled (Bookings)', appt.cancelled ?? 0],
      [isAr ? 'مخزون منخفض' : 'Low Stock Alerts', lowStockAlertsQ.data ?? 0],
      [isAr ? 'نفاد المخزون' : 'Out Of Stock Alerts', outOfStockAlertsQ.data ?? 0],
    ];
    // Top items: when the user picked a specific range we recompute from
    // the order line-items inside that range so the section honours the
    // range filter. For the cumulative snapshot we fall back to the
    // server-side `topProd` aggregate.
    const parseItems = (o: any): any[] => {
      try { if (Array.isArray(o.items)) return o.items; if (typeof o.items === 'string') return JSON.parse(o.items); } catch {}
      return [];
    };
    type TopRow = { name: string; name_ar?: string; total_qty: number; order_count: number; price: number };
    let topRows: TopRow[] = [];
    if (useSnapshot) {
      topRows = (topProd ?? []).map((pr: any) => ({
        name: pr.name, name_ar: pr.name_ar,
        total_qty: Number(pr.total_qty ?? 0),
        order_count: Number(pr.order_count ?? 0),
        price: Number(pr.price ?? 0),
      }));
    } else {
      const agg = new Map<string, TopRow>();
      for (const o of oList) {
        const items = parseItems(o);
        const seen = new Set<string>();
        for (const it of items) {
          const key = String(it.product_id ?? it.id ?? it.name ?? it.product_name ?? '');
          if (!key) continue;
          const name = it.name || it.product_name || it.name_ar || key;
          const name_ar = it.name_ar || it.product_name_ar;
          const q = Number(it.quantity ?? 1);
          const pr = Number(it.unit_price ?? it.final_unit_price ?? it.price ?? 0);
          let row = agg.get(key);
          if (!row) { row = { name, name_ar, total_qty: 0, order_count: 0, price: pr }; agg.set(key, row); }
          row.total_qty += q;
          if (pr > 0) row.price = pr;
          if (!seen.has(key)) { row.order_count += 1; seen.add(key); }
        }
      }
      topRows = Array.from(agg.values()).sort((a, b) => b.total_qty - a.total_qty).slice(0, 10);
    }
    if (topRows.length > 0) {
      sectionRows.push([]);
      sectionRows.push([
        isAr ? 'الترتيب' : 'Rank',
        isAr ? 'الصنف' : 'Item',
        isAr ? 'الكمية' : 'Quantity',
        isAr ? 'عدد الطلبات' : 'Orders',
        isAr ? 'السعر (ج.م)' : 'Price (EGP)',
      ]);
      topRows.forEach((pr, i) => {
        sectionRows.push([
          i + 1,
          isAr ? (pr.name_ar || pr.name) : pr.name,
          pr.total_qty,
          pr.order_count,
          pr.price.toFixed(2),
        ]);
      });
    }
    const csv = buildCsv(sectionRows);
    await shareCsv(csv, `${restName2} Analytics ${useSnapshot ? 'Cumulative' : label}`);
  }, [stats, ordSt, apptSt, topProd, ordersQ.data, appts, selectedRestaurant, lang, rangeToBounds, inRange, lowStockAlertsQ.data, outOfStockAlertsQ.data, buildCsv, shareCsv, pushStatusToast]);

  // ── Tab-aware Thermal — accepts a date range for orders/bookings ─────
  const handleHubThermal = useCallback(async (rangeKey: DateRangeKey = 'today', receiptLang?: 'ar' | 'en') => {
    const effectiveLang = receiptLang ?? (lang === 'ar' ? 'ar' : 'en');
    const isAr2   = effectiveLang === 'ar';
    const restName2 = selectedRestaurant
      ? (isAr2 ? (selectedRestaurant.name_ar || selectedRestaurant.name) : selectedRestaurant.name)
      : '';
    const dateNow = new Date().toLocaleString(isAr2 ? 'ar-EG' : 'en-US');
    const { start, end } = rangeToBounds(rangeKey);
    // Build a range label in the receipt language (not the owner UI language)
    const rangeLabel = (() => {
      if (!start || !end) return isAr2 ? 'كل الوقت' : 'All time';
      const fmt = (d: Date) => d.toLocaleDateString(isAr2 ? 'ar-EG' : 'en-US', { day: 'numeric', month: 'short', year: 'numeric' });
      const sameDay = start.getFullYear() === end.getFullYear() && start.getMonth() === end.getMonth() && start.getDate() === end.getDate();
      return sameDay ? fmt(start) : `${fmt(start)} – ${fmt(end)}`;
    })();

    let title = '';
    let bodyHtml = '';

    if (activeTab === 'orders') {
      // Use module-level filterByDateRange utility (canonical date-range filtering)
      const list = filterByDateRange(ordersQ.data?.orders ?? [], 'created_at', rangeKey as DateRangeKeyM);
      if (list.length === 0) {
        pushStatusToast('error', 'thermal-no-orders',
          isAr2 ? `لا طلبات في الفترة (${rangeLabel})` : `No orders in (${rangeLabel})`);
        return;
      }
      title = isAr2 ? 'ملخص الطلبات' : 'Orders Summary';
      const sum = list.reduce((s: number, o: any) => s + parseFloat(String(o.total_amount || 0)), 0);
      bodyHtml = `<table>${list.map((o: any) => {
        const num = o.restaurant_order_number ? `R-${o.restaurant_order_number}` : `#${o.order_number || String(o.id ?? '').slice(0, 6)}`;
        const cName = (o.customer_name || o.user_name || '—').slice(0, 16);
        const t = parseFloat(String(o.total_amount || 0)).toFixed(0);
        const st = isAr2 ? (ORDER_STATUS[o.status]?.labelAr ?? o.status) : (ORDER_STATUS[o.status]?.label ?? o.status);
        return `<tr><td class="dish">${escapeHtml(num)}</td><td>${escapeHtml(cName)}</td><td class="amt">${ltrNum(t)}</td></tr><tr><td colspan="3" class="nutr">${escapeHtml(st)}</td></tr>`;
      }).join('')}</table>
      <div class="hr"></div>
      <div class="total">${isAr2 ? 'الإجمالي' : 'Total'}: ${ltrNum(sum.toFixed(0))} ${isAr2 ? 'ج.م' : 'EGP'}</div>
      <div class="meta ctr">${ltrNum(list.length)} ${isAr2 ? 'طلب' : 'orders'} · ${escapeHtml(rangeLabel)}</div>`;
    } else if (activeTab === 'appointments') {
      // Use module-level filterByDateRange utility (canonical date-range filtering)
      const list = filterByDateRange(appts, 'appointment_date', rangeKey as DateRangeKeyM);
      if (list.length === 0) {
        pushStatusToast('error', 'thermal-no-bookings',
          isAr2 ? `لا حجوزات في الفترة (${rangeLabel})` : `No bookings in (${rangeLabel})`);
        return;
      }
      title = isAr2 ? 'ملخص الحجوزات' : 'Bookings Summary';
      bodyHtml = `<table>${list.map((a: any) => {
        const tableLabel = a.service_type?.startsWith('table_') ? a.service_type.replace('table_', '') : '—';
        const d = a.appointment_date
          ? new Date(a.appointment_date).toLocaleString(isAr2 ? 'ar-EG' : 'en-US', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
          : '—';
        const cName    = (a.user_name || a.customer_name || '—').slice(0, 20);
        const party    = a.party_size || a.guests || a.guest_count || null;
        const notes    = (a.notes || a.special_requests || '').slice(0, 40);
        const st       = isAr2 ? (APPT_STATUS[a.status]?.labelAr ?? a.status) : (APPT_STATUS[a.status]?.label ?? a.status);
        const partyTxt = party ? ` · ${ltrNum(party)} ${isAr2 ? 'شخص' : 'pax'}` : '';
        const notesTxt = notes ? `<tr><td colspan="3" class="nutr" style="color:#555;font-style:italic">${escapeHtml(notes)}</td></tr>` : '';
        return `<tr>
  <td class="dish">${isAr2 ? 'طاولة' : 'T'} ${escapeHtml(tableLabel)}</td>
  <td>${escapeHtml(cName)}</td>
  <td class="amt">${escapeHtml(st)}</td>
</tr>
<tr><td colspan="3" class="nutr">${escapeHtml(d)}${partyTxt}</td></tr>
${notesTxt}`;
      }).join('')}</table>
      <div class="hr"></div>
      <div class="meta ctr">${ltrNum(list.length)} ${isAr2 ? 'حجز' : 'bookings'} · ${escapeHtml(rangeLabel)}</div>`;
    } else {
      if (!stats) {
        pushStatusToast('error', 'thermal-no-analytics',
          isAr2 ? 'لا توجد إحصاءات للتصدير' : 'No analytics data to export');
        return;
      }
      title = isAr2 ? 'لقطة تحليلية' : 'Analytics Snapshot';
      // ltrNum wraps each numeric value so RTL layout doesn't reverse digits
      const row = (k: string, v: string | number) =>
        `<tr><td>${escapeHtml(k)}</td><td class="amt">${ltrNum(v)}</td></tr>`;
      bodyHtml = `<table>
        ${row(isAr2 ? 'إجمالي الطلبات' : 'Orders', ordSt.total_orders ?? 0)}
        ${row(isAr2 ? 'الإيرادات' : 'Revenue', `${(ordSt.total_revenue ?? 0).toFixed(0)}`)}
        ${row(isAr2 ? 'متوسط الطلب' : 'Avg Order', `${(ordSt.avg_order_value ?? 0).toFixed(0)}`)}
        ${row(isAr2 ? 'عملاء فريدون' : 'Customers', ordSt.unique_customers ?? 0)}
        ${row(isAr2 ? 'الحجوزات' : 'Bookings', apptSt.total ?? 0)}
        ${row(isAr2 ? 'قادمة' : 'Upcoming', apptSt.upcoming ?? 0)}
      </table>
      <div class="hr"></div>
      <div class="dish ctr">${isAr2 ? 'حالات الطلبات' : 'Order Status'}</div>
      <table>
        ${row(isAr2 ? 'تسليم' : 'Delivered', ordSt.delivered ?? 0)}
        ${row(isAr2 ? 'تحضير' : 'Preparing', ordSt.preparing ?? 0)}
        ${row(isAr2 ? 'انتظار' : 'Pending', ordSt.pending ?? 0)}
        ${row(isAr2 ? 'ملغي' : 'Cancelled', ordSt.cancelled ?? 0)}
      </table>`;
    }

    const dir2    = isAr2 ? 'rtl' : 'ltr';
    const logoUrl2 = selectedRestaurant?.image_url ?? null;

    const html = `<!DOCTYPE html><html dir="${dir2}">
<head><meta charset="utf-8"><title>${escapeHtml(title)}</title>
<style>${buildThermalCss(isAr2)}</style>
</head>
<body dir="${dir2}">
  <div class="ctr">
    ${logoUrl2 ? `<img src="${escapeHtml(logoUrl2)}" class="logo" alt="" onerror="this.style.display='none'" />` : ''}
    <h1>${escapeHtml(restName2)}</h1>
    <div class="sub">${escapeHtml(dateNow)}</div>
    <div class="badge">${escapeHtml(title)} · ${escapeHtml(rangeLabel)}</div>
  </div>
  <div class="hr"></div>
  ${bodyHtml}
  <div class="hr"></div>
  <div class="meta ctr">— Al-Ghazaly Dining —</div>
</body></html>`;

    const _hubThermalPayload = { html, fileLabel: `${restName2} ${title}`, width: 226 };
    if (Platform.OS === 'ios') {
      setTimeout(() => setPrintPreview(_hubThermalPayload), 380);
    } else {
      setPrintPreview(_hubThermalPayload);
    }
  }, [activeTab, ordersQ.data, appts, stats, ordSt, apptSt, selectedRestaurant, lang, rangeToBounds, fmtRangeDisplay, escapeHtml, ltrNum, buildThermalCss, pushStatusToast]);

  // ── Print Hub dispatcher — receives the per-tile range from the modal ─
  const handleHubAction = useCallback((action: 'thermal' | 'brief' | 'detailed', rangeKey: DateRangeKey = 'today') => {
    setShowReportModal(false);
    if (activeTab === 'analytics') {
      // analytics has no date filter — snapshot is always aggregate
      if (action === 'thermal') { handleHubThermal(rangeKey, hubPrintLang); return; }
      const mode: 'daily' | 'detailed' = action === 'brief' ? 'daily' : 'detailed';
      handleDownloadAnalytics(mode);
      return;
    }
    if (action === 'thermal') { handleHubThermal(rangeKey, hubPrintLang); return; }
    const mode: 'daily' | 'detailed' = action === 'brief' ? 'daily' : 'detailed';
    if (activeTab === 'orders')            handleDownloadOrders(mode, rangeKey);
    else if (activeTab === 'appointments') handleDownloadAppointments(mode, rangeKey);
  }, [activeTab, handleHubThermal, hubPrintLang, handleDownloadOrders, handleDownloadAppointments, handleDownloadAnalytics]);


  // ── Tab animation ─────────────────────────────────────────────────────────
  const tabIndex = TABS.indexOf(activeTab);
  useEffect(() => {
    RNAnimated.timing(tabAnim, { toValue: tabIndex, duration: 220, useNativeDriver: false }).start();
  }, [tabIndex]);
  const tabUnderLeft = tabAnim.interpolate({
    inputRange: [0, 1, 2, 3],
    outputRange: ['0%', '25%', '50%', '75%'],
  });

  const handleSelectRestaurant = useCallback((r: any) => {
    haptic.tap();
    setSelectedRestaurant(r);
    setOrderStatus('all');
    setApptStatus('all');
  }, []);

  const handleRefresh = useCallback(() => {
    restaurantsQ.refetch();
    if (selectedRestaurant) {
      ordersQ.refetch();
      apptsQ.refetch();
      statsQ.refetch();
    }
  }, [selectedRestaurant, restaurantsQ, ordersQ, apptsQ, statsQ]);

  const isRefreshing = restaurantsQ.isFetching || ordersQ.isFetching || apptsQ.isFetching;
  const hasOrdersError   = ordersQ.isError;
  const hasApptsError    = apptsQ.isError;
  const hasStatsError    = statsQ.isError;
  const hasRestError     = restaurantsQ.isError;

  // ── Order status filter chips (matches 4-step forward flow) ─────────────────
  const ORDER_FILTERS = useMemo(() => [
    { key: 'all',       label: lang === 'ar' ? 'الكل'      : 'All' },
    { key: 'pending',   label: lang === 'ar' ? 'انتظار'    : 'Pending' },
    { key: 'preparing', label: lang === 'ar' ? 'تحضير'     : 'Preparing' },
    { key: 'ready',     label: lang === 'ar' ? 'جاهز'      : 'Ready' },
    { key: 'delivered', label: lang === 'ar' ? 'تسليم'     : 'Delivered' },
  ], [lang]);

  const APPT_FILTERS = useMemo(() => [
    { key: 'all',       label: lang === 'ar' ? 'الكل'      : 'All' },
    { key: 'pending',   label: lang === 'ar' ? 'انتظار'    : 'Pending' },
    { key: 'confirmed', label: lang === 'ar' ? 'مؤكد'      : 'Confirmed' },
    { key: 'cancelled', label: lang === 'ar' ? 'ملغي'      : 'Cancelled' },
  ], [lang]);

  // ─────────────────────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────────────────────
  return (
    <View style={[sty.root, { backgroundColor: p.bg }]}>
      <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} />

      {/* Per-PATCH success/error toast queue for booking status changes */}
      <OrderStatusToastStack toasts={statusToasts} onDismiss={dismissStatusToast} />

      {/* Offline / paused / reconnecting status banner */}
      <ConnectionStatusBanner topOffset={insets.top + 6} />

      {/* Background gradient — only shown in dark mode */}
      {isDark && (
        <LinearGradient
          colors={['#050508', '#090914', '#0D0D1A']}
          style={StyleSheet.absoluteFill}
          start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
        />
      )}

      {/* Decorative glow orbs */}
      <View style={[sty.glowOrb, { top: -80, left: -60, backgroundColor: isDark ? 'rgba(255,215,0,0.06)' : 'rgba(200,162,74,0.08)', width: 260, height: 260, borderRadius: 130 }]} />
      <View style={[sty.glowOrb, { top: 200, right: -80, backgroundColor: isDark ? 'rgba(0,229,255,0.04)' : 'rgba(200,162,74,0.04)', width: 220, height: 220, borderRadius: 110 }]} />

      <ScrollView
        ref={mainScrollRef}
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingBottom: insets.bottom + 32 }}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={isRefreshing} onRefresh={handleRefresh} tintColor={p.gold} />
        }
      >
        {/* ── Header ───────────────────────────────────────────────────────── */}
        <View style={[sty.header, { paddingTop: insets.top + 12 }]}>
          <TouchableOpacity style={sty.backBtn} onPress={() => { haptic.tap(); router.back(); }}>
            <BlurView intensity={25} tint={isDark ? 'dark' : 'light'} style={sty.backBtnBlur}>
              <Ionicons name={isRTL ? 'arrow-forward' : 'arrow-back'} size={20} color={p.text} />
            </BlurView>
          </TouchableOpacity>
          <View style={{ flex: 1, marginHorizontal: 16 }}>
            <Text style={[sty.headerTitle, { color: p.text }, isRTL && { textAlign: 'right' }]}>
              {lang === 'ar' ? 'مركز المطاعم' : 'Restaurant Hub'}
            </Text>
            <Text style={[sty.headerSub, { color: p.textMuted }, isRTL && { textAlign: 'right' }]}>
              {isRestaurantUser && selectedRestaurant
                ? (lang === 'ar'
                    ? (selectedRestaurant.name_ar || selectedRestaurant.name)
                    : selectedRestaurant.name)
                : (lang === 'ar'
                    ? `${restaurants.length} مطعم • بيانات حية`
                    : `${restaurants.length} restaurant${restaurants.length !== 1 ? 's' : ''} • Live data`)}
            </Text>
          </View>
          {selectedRestaurant && (activeTab === 'orders' || activeTab === 'appointments' || activeTab === 'analytics') ? (
            // ── Print Hub: ONE icon opens the tab-aware modal with 3 tiles
            // (Thermal / Daily Brief PDF / Detailed PDF). The redundant
            // print + download split was removed in favor of this hub.
            <TouchableOpacity style={sty.manageBtn} onPress={() => { haptic.tap(); handleOpenPrintHub(); }}>
              <BlurView intensity={25} tint={isDark ? 'dark' : 'light'} style={sty.manageBtnBlur}>
                <Ionicons name="print-outline" size={18} color={C.cyan} />
              </BlurView>
            </TouchableOpacity>
          ) : null}
          {/* ── Header bell: scoped notification log shortcut + unread counter.
              Mirrors the bell shown per-user in the user-mgmt modal so staff
              can jump to /owner/notification-log filtered to this restaurant. */}
          {selectedRestaurant ? (
            <View style={{ alignItems: 'center', gap: 2 }}>
              <TouchableOpacity
                style={sty.manageBtn}
                onPress={() => {
                  haptic.tap();
                  router.push({
                    pathname: '/owner/notification-log',
                    params: { restaurant_id: selectedRestaurant.id },
                  });
                }}
                accessibilityLabel={lang === 'ar' ? 'سجل التنبيهات لهذا المطعم' : 'Notification log for this restaurant'}
              >
                <BlurView intensity={25} tint={isDark ? 'dark' : 'light'} style={sty.manageBtnBlur}>
                  <Ionicons name="notifications-outline" size={18} color={C.cyan} />
                  {pushLogUnreadCount > 0 && (
                    <View style={sty.bellBadge}>
                      <Text style={sty.bellBadgeText}>
                        {pushLogUnreadCount > 99 ? '99+' : String(pushLogUnreadCount)}
                      </Text>
                    </View>
                  )}
                </BlurView>
              </TouchableOpacity>
              {(syncStatus === 'syncing' || syncStatus === 'error') && (
                <Text style={{ fontSize: 8, color: syncStatus === 'error' ? '#EF4444' : C.cyan, fontWeight: '600', letterSpacing: 0.2 }}>
                  {lang === 'ar' ? 'جارٍ الاتصال' : 'Reconnecting…'}
                </Text>
              )}
            </View>
          ) : null}
          {isOwnerOrPartner && selectedRestaurant ? (
            <TouchableOpacity
              style={sty.manageBtn}
              onPress={() => { haptic.tap(); setShowUserModal(true); }}
            >
              <BlurView intensity={25} tint={isDark ? 'dark' : 'light'} style={sty.manageBtnBlur}>
                <Ionicons name="people-outline" size={18} color={p.gold} />
              </BlurView>
            </TouchableOpacity>
          ) : null}
        </View>

        {/* ── Restaurant cards strip — hidden for restaurant_user with ≤1 restaurant ── */}
        {!(isRestaurantUser && restaurants.length <= 1) && (
        <View style={sty.stripSection}>
          <Text style={[sty.stripTitle, { color: p.textMuted }, isRTL && { textAlign: 'right' }]}>
            {lang === 'ar' ? 'المطاعم' : 'Restaurants'}
          </Text>
          {restaurantsQ.isLoading ? (
            <View style={sty.stripLoading}>
              <ActivityIndicator color={p.gold} />
              <Text style={[sty.loadingText, { color: p.textMuted }]}>{lang === 'ar' ? 'جارٍ التحميل...' : 'Loading...'}</Text>
            </View>
          ) : hasRestError ? (
            <EmptyPlaceholder icon="warning-outline" msg={lang === 'ar' ? 'تعذّر تحميل المطاعم' : 'Failed to load restaurants'} />
          ) : restaurants.length === 0 ? (
            <EmptyPlaceholder icon="storefront-outline" msg={lang === 'ar' ? 'لا توجد مطاعم مضافة بعد' : 'No restaurants added yet'} />
          ) : (
            <ScrollView
              ref={stripRef}
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={sty.stripScroll}
            >
              {restaurants.map((rest: any) => {
                const isSelected = selectedRestaurant?.id === rest.id;
                const imgSrc = rest.image_url || (Array.isArray(rest.images) && rest.images[0]) || null;
                return (
                  <TouchableOpacity
                    key={rest.id}
                    style={[sty.restaurantCard, { backgroundColor: p.surface, borderColor: p.border },
                            isSelected && { borderColor: p.goldBorder, borderWidth: 1.5 }]}
                    onPress={() => handleSelectRestaurant(rest)}
                    activeOpacity={0.85}
                  >
                    {isSelected && (
                      <LinearGradient
                        colors={['rgba(255,215,0,0.14)', 'rgba(255,215,0,0.04)']}
                        style={StyleSheet.absoluteFill}
                      />
                    )}
                    {/* Image / Icon */}
                    <View style={sty.restaurantImgWrap}>
                      {imgSrc ? (
                        <Image source={{ uri: imgSrc }} style={sty.restaurantImg} contentFit="cover" />
                      ) : (
                        <LinearGradient
                          colors={['rgba(255,215,0,0.2)', 'rgba(255,107,53,0.2)']}
                          style={sty.restaurantImgFallback}
                        >
                          <Ionicons name="storefront" size={28} color={isSelected ? p.gold : p.textMuted} />
                        </LinearGradient>
                      )}
                      {isSelected && <View style={[sty.restaurantImgGlow, { borderColor: p.goldBorder }]} />}
                    </View>
                    {/* Name */}
                    <Text style={[sty.restaurantName, { color: p.text }, isSelected && { color: p.gold }]} numberOfLines={2}>
                      {lang === 'ar' ? (rest.name_ar || rest.name) : rest.name}
                    </Text>
                    {rest.brand_name ? (
                      <Text style={[sty.restaurantBrand, { color: p.textFaint }]} numberOfLines={1}>
                        {lang === 'ar' ? (rest.brand_name_ar || rest.brand_name) : rest.brand_name}
                      </Text>
                    ) : null}
                    {/* Quick stats */}
                    <View style={sty.restaurantStats}>
                      <View style={[sty.restaurantStatChip, { backgroundColor: p.surfaceHi }]}>
                        <Ionicons name="receipt-outline" size={10} color={C.orange} />
                        <Text style={[sty.restaurantStatNum, { color: C.orange }]}>{rest.orders_count}</Text>
                      </View>
                      <View style={[sty.restaurantStatChip, { backgroundColor: p.surfaceHi }]}>
                        <Ionicons name="cash-outline" size={10} color={C.green} />
                        <Text style={[sty.restaurantStatNum, { color: C.green }]}>
                          {rest.total_revenue >= 1000
                            ? `${(rest.total_revenue / 1000).toFixed(1)}K`
                            : rest.total_revenue.toFixed(0)}
                        </Text>
                      </View>
                    </View>
                    {/* Users pill */}
                    {isOwnerOrPartner && (
                      <View style={sty.usersPill}>
                        <Ionicons name="people-outline" size={10} color={p.textFaint} />
                        <Text style={[sty.usersPillText, { color: p.textFaint }]}>{rest.assigned_users_count}/3</Text>
                      </View>
                    )}
                    {isSelected && <View style={[sty.selectedIndicator, { backgroundColor: p.gold }]} />}
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          )}
        </View>
        )}

        {/* ── Selected restaurant hero ──────────────────────────────────────── */}
        {selectedRestaurant && (
          <View style={[sty.heroSection, { borderColor: p.goldBorder, backgroundColor: p.surface }]}>
            <LinearGradient
              colors={['rgba(255,215,0,0.10)', 'rgba(0,229,255,0.06)', 'transparent']}
              style={sty.heroGrad}
              start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
            />
            <View style={[sty.row, isRTL && sty.rowRev, { justifyContent: 'space-between', alignItems: 'flex-start' }]}>
              <View style={{ flex: 1 }}>
                <Text style={[sty.heroName, { color: p.gold }, isRTL && { textAlign: 'right' }]}>
                  {lang === 'ar' ? (selectedRestaurant.name_ar || selectedRestaurant.name) : selectedRestaurant.name}
                </Text>
                {selectedRestaurant.brand_name ? (
                  <Text style={[sty.heroBrand, { color: p.textMuted }, isRTL && { textAlign: 'right' }]}>
                    {lang === 'ar' ? (selectedRestaurant.brand_name_ar || selectedRestaurant.brand_name) : selectedRestaurant.brand_name}
                  </Text>
                ) : null}
              </View>
              <View style={sty.heroPulse} />
            </View>
            {/* Quick metrics row */}
            <View style={[sty.heroMetricsRow, isRTL && sty.rowRev]}>
              <View style={sty.heroMetric}>
                <Text style={[sty.heroMetricVal, { color: C.orange }]}>{selectedRestaurant.orders_count}</Text>
                <Text style={[sty.heroMetricLabel, { color: p.textMuted }]}>{lang === 'ar' ? 'طلب' : 'Orders'}</Text>
              </View>
              <View style={[sty.heroMetricDivider, { backgroundColor: p.border }]} />
              <View style={sty.heroMetric}>
                <Text style={[sty.heroMetricVal, { color: C.green }]}>
                  {selectedRestaurant.total_revenue >= 1000
                    ? `${(selectedRestaurant.total_revenue / 1000).toFixed(1)}K`
                    : selectedRestaurant.total_revenue.toFixed(0)} ج.م
                </Text>
                <Text style={[sty.heroMetricLabel, { color: p.textMuted }]}>{lang === 'ar' ? 'إيرادات' : 'Revenue'}</Text>
              </View>
              <View style={[sty.heroMetricDivider, { backgroundColor: p.border }]} />
              <View style={sty.heroMetric}>
                <Text style={[sty.heroMetricVal, { color: C.purple }]}>
                  {selectedRestaurant.orders_count > 0
                    ? `${(selectedRestaurant.total_revenue / selectedRestaurant.orders_count).toFixed(0)}`
                    : '0'} ج.م
                </Text>
                <Text style={[sty.heroMetricLabel, { color: p.textMuted }]}>{lang === 'ar' ? 'متوسط الطلب' : 'Avg Order'}</Text>
              </View>
              <View style={[sty.heroMetricDivider, { backgroundColor: p.border }]} />
              <View style={sty.heroMetric}>
                <Text style={[sty.heroMetricVal, { color: C.cyan }]}>{selectedRestaurant.appointments_count}</Text>
                <Text style={[sty.heroMetricLabel, { color: p.textMuted }]}>{lang === 'ar' ? 'حجز' : 'Bookings'}</Text>
              </View>
            </View>
          </View>
        )}

        {/* ── Tab bar ───────────────────────────────────────────────────────── */}
        {selectedRestaurant && (
          <View style={[sty.tabBar, { backgroundColor: p.surface, borderColor: p.border }]}>
            <LinearGradient colors={['rgba(255,255,255,0.04)', 'transparent']} style={StyleSheet.absoluteFill} />
            {TABS.map((tab) => (
              <TouchableOpacity
                key={tab}
                style={sty.tabItem}
                onPress={() => { haptic.tap(); setActiveTab(tab); }}
              >
                <View style={{ position: 'relative', alignItems: 'center' }}>
                  <Text style={[sty.tabLabel, { color: p.textMuted }, activeTab === tab && { color: p.accent }]}>
                    {tab === 'orders'
                      ? (lang === 'ar' ? 'الطلبات' : 'Orders')
                      : tab === 'appointments'
                      ? (lang === 'ar' ? 'الحجوزات' : 'Bookings')
                      : tab === 'analytics'
                      ? (lang === 'ar' ? 'التحليلات' : 'Analytics')
                      : (lang === 'ar' ? 'التقييمات' : 'Ratings')}
                  </Text>
                  {tab === 'analytics' && pushLogStockUnread > 0 && (
                    <View style={[sty.tabAlertDot, { backgroundColor: '#EF4444' }]}>
                      <Text style={{ color: '#fff', fontSize: 9, fontWeight: '800', paddingHorizontal: 3 }}>
                        {pushLogStockUnread > 9 ? '9+' : pushLogStockUnread}
                      </Text>
                    </View>
                  )}
                  {tab === 'orders' && pushLogOrdersUnread > 0 && (
                    <View style={[sty.tabAlertDot, { backgroundColor: C.cyan }]}>
                      <Text style={{ color: '#fff', fontSize: 9, fontWeight: '800', paddingHorizontal: 3 }}>
                        {pushLogOrdersUnread > 9 ? '9+' : pushLogOrdersUnread}
                      </Text>
                    </View>
                  )}
                  {tab === 'analytics' && pushLogStockUnread === 0 && pushLogUnreadCount > 0 && (
                    <View style={sty.tabAlertDot} />
                  )}
                </View>
              </TouchableOpacity>
            ))}
            <RNAnimated.View style={[sty.tabUnderline, { backgroundColor: p.accent, left: tabUnderLeft }]} />
          </View>
        )}

        {/* ── Tab content ───────────────────────────────────────────────────── */}
        {selectedRestaurant ? (
          <View style={sty.tabContent}>

            {/* ─── ORDERS TAB ─── */}
            {activeTab === 'orders' && (
              <>
                {/* Status filter chips */}
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={sty.chipScroll}>
                  {ORDER_FILTERS.map(f => (
                    <TouchableOpacity
                      key={f.key}
                      style={[sty.chip, { backgroundColor: p.surface, borderColor: p.border },
                              orderStatus === f.key && { backgroundColor: p.goldMuted, borderColor: p.goldBorder }]}
                      onPress={() => { haptic.tap(); setOrderStatus(f.key); }}
                    >
                      <Text style={[sty.chipText, { color: p.textMuted }, orderStatus === f.key && { color: p.gold }]}>{f.label}</Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>

                {ordersQ.isLoading ? (
                  <View style={sty.centerLoad}><ActivityIndicator color={p.gold} /></View>
                ) : hasOrdersError ? (
                  <EmptyPlaceholder icon="warning-outline" msg={lang === 'ar' ? 'تعذّر تحميل الطلبات' : 'Failed to load orders'} />
                ) : orders.length === 0 ? (
                  <EmptyPlaceholder
                    icon="receipt-outline"
                    msg={lang === 'ar' ? 'لا توجد طلبات لهذا المطعم' : 'No orders for this restaurant'}
                  />
                ) : (
                  <View style={sty.listWrap}>
                    <View style={[sty.row, isRTL && sty.rowRev, { marginBottom: 10, justifyContent: 'space-between' }]}>
                      <Text style={[sty.listCount, { color: p.textMuted }]}>
                        {orders.length} {lang === 'ar' ? 'طلب' : 'orders'}
                        {ordersQ.data?.total && ordersQ.data.total > orders.length
                          ? ` ${lang === 'ar' ? 'من' : 'of'} ${ordersQ.data.total}`
                          : ''}
                      </Text>
                    </View>
                    {orders.map((order: any) => (
                      <OrderCard
                        key={order.id}
                        order={order}
                        lang={lang}
                        isRTL={isRTL}
                        expanded={expandedOrderId === order.id}
                        onToggle={() => setExpandedOrderId(prev => prev === order.id ? null : order.id)}
                        onStatusChange={(orderId, status) => statusMut.mutate({ orderId, status })}
                        statusChanging={statusMut.isPending}
                        canMutateStatus={userRole !== 'admin'}
                        onPrintRow={(o) => { setThermalTab('info'); setThermalOrder(o); }}
                      />
                    ))}
                  </View>
                )}
              </>
            )}

            {/* ─── APPOINTMENTS TAB ─── */}
            {activeTab === 'appointments' && (
              <>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={sty.chipScroll}>
                  {APPT_FILTERS.map(f => (
                    <TouchableOpacity
                      key={f.key}
                      style={[sty.chip, { backgroundColor: p.surface, borderColor: p.border },
                              apptStatus === f.key && { backgroundColor: p.goldMuted, borderColor: p.goldBorder }]}
                      onPress={() => { haptic.tap(); setApptStatus(f.key); }}
                    >
                      <Text style={[sty.chipText, { color: p.textMuted }, apptStatus === f.key && { color: p.gold }]}>{f.label}</Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>

                <View style={[sty.apptNote, { backgroundColor: p.surfaceHi, borderColor: p.border }, isRTL && { flexDirection: 'row-reverse' }]}>
                  <Ionicons name="information-circle-outline" size={14} color={C.cyan} />
                  <Text style={[sty.apptNoteText, { color: p.textMuted }, isRTL && { textAlign: 'right' }]}>
                    {lang === 'ar'
                      ? 'تُعرض جميع الحجوزات — الحجوزات لا ترتبط مباشرةً بمطعم محدد'
                      : 'All table bookings shown — bookings are not linked to a specific restaurant'}
                  </Text>
                </View>

                {apptsQ.isLoading ? (
                  <View style={sty.centerLoad}><ActivityIndicator color={C.cyan} /></View>
                ) : hasApptsError ? (
                  <EmptyPlaceholder icon="warning-outline" msg={lang === 'ar' ? 'تعذّر تحميل الحجوزات' : 'Failed to load bookings'} />
                ) : appts.length === 0 ? (
                  <EmptyPlaceholder
                    icon="calendar-outline"
                    msg={lang === 'ar' ? 'لا توجد حجوزات' : 'No appointments found'}
                  />
                ) : (
                  <View style={sty.listWrap}>
                    <View style={[sty.row, isRTL && sty.rowRev, { marginBottom: 10, justifyContent: 'space-between' }]}>
                      <Text style={[sty.listCount, { color: p.textMuted }]}>
                        {appts.length} {lang === 'ar' ? 'حجز' : 'bookings'}
                      </Text>
                    </View>
                    {appts.map((appt: any) => (
                      <AppointmentCard
                        key={appt.id}
                        appt={appt}
                        lang={lang}
                        isRTL={isRTL}
                        mutatingId={apptMut.isPending ? apptMut.variables?.id ?? null : null}
                        onConfirm={(id) => apptMut.mutate({
                          id,
                          status: 'confirmed',
                          prevStatus: (appt.status || 'pending').toLowerCase(),
                        })}
                        onComplete={(id) => apptMut.mutate({
                          id,
                          status: 'completed',
                          prevStatus: (appt.status || 'pending').toLowerCase(),
                        })}
                        onNoShow={(id) => apptMut.mutate({
                          id,
                          status: 'no_show',
                          prevStatus: (appt.status || 'pending').toLowerCase(),
                        })}
                        onCancel={(id) => {
                          const prevStatus = (appt.status || 'pending').toLowerCase();
                          Alert.alert(
                            lang === 'ar' ? 'إلغاء الحجز' : 'Cancel booking',
                            lang === 'ar' ? 'هل تريد إلغاء هذا الحجز؟' : 'Cancel this booking?',
                            [
                              { text: lang === 'ar' ? 'تراجع' : 'Back', style: 'cancel' },
                              { text: lang === 'ar' ? 'إلغاء الحجز' : 'Cancel', style: 'destructive',
                                onPress: () => apptMut.mutate({ id, status: 'cancelled', prevStatus }) },
                            ],
                          );
                        }}
                      />
                    ))}
                  </View>
                )}
              </>
            )}

            {/* ─── ANALYTICS TAB ─── */}
            {activeTab === 'analytics' && (
              <>
                {statsQ.isLoading ? (
                  <View style={sty.centerLoad}><ActivityIndicator color={p.gold} /></View>
                ) : hasStatsError ? (
                  <EmptyPlaceholder icon="warning-outline" msg={lang === 'ar' ? 'تعذّر تحميل الإحصاءات' : 'Failed to load analytics'} />
                ) : !stats ? (
                  <EmptyPlaceholder icon="stats-chart-outline" msg={lang === 'ar' ? 'لا توجد بيانات' : 'No data available'} />
                ) : (
                  <View style={sty.listWrap}>
                    {/* Key metrics */}
                    <Text style={[sty.sectionTitle, { color: p.textMuted }, isRTL && { textAlign: 'right' }]}>
                      {lang === 'ar' ? 'المؤشرات الرئيسية' : 'Key Metrics'}
                    </Text>
                    <View style={sty.metricsGrid}>
                      <MetricCard
                        icon="receipt-outline" color={C.orange}
                        label={lang === 'ar' ? 'إجمالي الطلبات' : 'Total Orders'}
                        value={ordSt.total_orders ?? 0}
                      />
                      <MetricCard
                        icon="cash-outline" color={C.green}
                        label={lang === 'ar' ? 'الإيرادات' : 'Revenue'}
                        value={`${((ordSt.total_revenue ?? 0) / 1000).toFixed(1)}K ج.م`}
                      />
                      <MetricCard
                        icon="trending-up-outline" color={C.purple}
                        label={lang === 'ar' ? 'متوسط الطلب' : 'Avg Order'}
                        value={`${(ordSt.avg_order_value ?? 0).toFixed(0)} ج.م`}
                      />
                      <MetricCard
                        icon="people-outline" color={C.blue}
                        label={lang === 'ar' ? 'عملاء فريدون' : 'Unique Customers'}
                        value={ordSt.unique_customers ?? 0}
                      />
                      <MetricCard
                        icon="calendar-outline" color={C.cyan}
                        label={lang === 'ar' ? 'إجمالي الحجوزات' : 'Total Bookings'}
                        value={apptSt.total ?? 0}
                      />
                      <MetricCard
                        icon="time-outline" color={C.pink}
                        label={lang === 'ar' ? 'حجوزات قادمة' : 'Upcoming'}
                        value={apptSt.upcoming ?? 0}
                      />
                    </View>

                    {/* Orders breakdown */}
                    <Text style={[sty.sectionTitle, { color: p.textMuted }, isRTL && { textAlign: 'right' }, { marginTop: 20 }]}>
                      {lang === 'ar' ? 'توزيع حالات الطلبات' : 'Orders by Status'}
                    </Text>
                    <View style={[sty.analyticsCard, { backgroundColor: p.surface, borderColor: p.border }]}>
                      <LinearGradient colors={['rgba(255,215,0,0.06)', 'transparent']} style={StyleSheet.absoluteFill} />
                      <StatBar label={lang === 'ar' ? 'تم التسليم' : 'Delivered'} value={ordSt.delivered ?? 0} max={ordMax} color={C.green} />
                      <StatBar label={lang === 'ar' ? 'قيد التحضير' : 'Preparing'} value={ordSt.preparing ?? 0} max={ordMax} color={C.blue} />
                      <StatBar label={lang === 'ar' ? 'انتظار'      : 'Pending'}   value={ordSt.pending   ?? 0} max={ordMax} color={C.orange} />
                      <StatBar label={lang === 'ar' ? 'تم الشحن'    : 'Shipped'}   value={ordSt.shipped   ?? 0} max={ordMax} color={C.purple} />
                      <StatBar label={lang === 'ar' ? 'ملغي'        : 'Cancelled'} value={ordSt.cancelled ?? 0} max={ordMax} color={C.red} />
                    </View>

                    {/* Appointments breakdown */}
                    <Text style={[sty.sectionTitle, { color: p.textMuted }, isRTL && { textAlign: 'right' }, { marginTop: 20 }]}>
                      {lang === 'ar' ? 'توزيع حالات الحجوزات' : 'Bookings by Status'}
                    </Text>
                    <View style={[sty.analyticsCard, { backgroundColor: p.surface, borderColor: p.border }]}>
                      <LinearGradient colors={['rgba(0,229,255,0.06)', 'transparent']} style={StyleSheet.absoluteFill} />
                      <StatBar label={lang === 'ar' ? 'مؤكدة'   : 'Confirmed'} value={apptSt.confirmed ?? 0} max={apptMax} color={C.green} />
                      <StatBar label={lang === 'ar' ? 'انتظار'  : 'Pending'}   value={apptSt.pending   ?? 0} max={apptMax} color={C.orange} />
                      <StatBar label={lang === 'ar' ? 'ملغية'   : 'Cancelled'} value={apptSt.cancelled ?? 0} max={apptMax} color={C.red} />
                    </View>

                    {/* Stock Alerts */}
                    <View style={[sty.row, isRTL && sty.rowRev, { marginTop: 20, marginBottom: 6, alignItems: 'center', justifyContent: 'space-between' }]}>
                      <Text style={[sty.sectionTitle, { color: p.textMuted, marginTop: 0, marginBottom: 0 }, isRTL && { textAlign: 'right' }]}>
                        {lang === 'ar' ? 'تنبيهات المخزون' : 'Stock Alerts'}
                      </Text>
                      <View style={[sty.row, { gap: 4 }]}>
                        {([7, 30] as const).map(d => (
                          <TouchableOpacity
                            key={d}
                            onPress={() => { haptic.tap(); setStockAlertRange(d); }}
                            style={[
                              sty.chip,
                              { paddingHorizontal: 10, paddingVertical: 4, backgroundColor: p.surface, borderColor: p.border },
                              stockAlertRange === d && { backgroundColor: C.orange + '22', borderColor: C.orange + '66' },
                            ]}
                          >
                            <Text style={[sty.chipText, { color: p.textMuted }, stockAlertRange === d && { color: C.orange }]}>
                              {lang === 'ar' ? `${d}ي` : `${d}d`}
                            </Text>
                          </TouchableOpacity>
                        ))}
                      </View>
                    </View>
                    <View style={sty.metricsGrid}>
                      <MetricCard
                        icon="warning-outline"
                        color={C.orange}
                        label={lang === 'ar' ? 'تنبيهات مخزون منخفض' : 'Low Stock Alerts'}
                        value={lowStockAlertsQ.isLoading ? '…' : (lowStockAlertsQ.data ?? 0)}
                        sub={lang === 'ar' ? `آخر ${stockAlertRange} يوم` : `Last ${stockAlertRange} days`}
                      />
                      <MetricCard
                        icon="alert-circle-outline"
                        color={C.red}
                        label={lang === 'ar' ? 'تنبيهات نفاد المخزون' : 'Out of Stock Alerts'}
                        value={outOfStockAlertsQ.isLoading ? '…' : (outOfStockAlertsQ.data ?? 0)}
                        sub={lang === 'ar' ? `آخر ${stockAlertRange} يوم` : `Last ${stockAlertRange} days`}
                      />
                    </View>
                    <StockSparkline
                      data={stockDailyCountsQ.data}
                      range={stockAlertRange}
                      lang={lang}
                    />

                    {/* Frequent stock alerts — top recurring offenders */}
                    {(() => {
                      const offenders = topOffendersQ.data ?? [];
                      const fmtAgo = (iso: string | null | undefined) => {
                        if (!iso) return '';
                        const t = new Date(iso).getTime();
                        if (Number.isNaN(t)) return '';
                        const diffMin = Math.max(0, Math.floor((Date.now() - t) / 60000));
                        if (diffMin < 1) return lang === 'ar' ? 'الآن' : 'just now';
                        if (diffMin < 60) return lang === 'ar' ? `قبل ${diffMin} د` : `${diffMin}m ago`;
                        const h = Math.floor(diffMin / 60);
                        if (h < 24) return lang === 'ar' ? `قبل ${h} س` : `${h}h ago`;
                        const d = Math.floor(h / 24);
                        return lang === 'ar' ? `قبل ${d} يوم` : `${d}d ago`;
                      };
                      return (
                        <>
                          <Text style={[sty.sectionTitle, { color: p.textMuted }, isRTL && { textAlign: 'right' }, { marginTop: 20 }]}>
                            {lang === 'ar' ? 'تنبيهات متكررة' : 'Frequent stock alerts'}
                          </Text>
                          <View style={[sty.analyticsCard, { backgroundColor: p.surface, borderColor: p.border }]}>
                            <LinearGradient colors={['rgba(239,68,68,0.06)', 'transparent']} style={StyleSheet.absoluteFill} />
                            {topOffendersQ.isLoading ? (
                              <View style={{ paddingVertical: 18, alignItems: 'center' }}>
                                <ActivityIndicator color={p.gold} />
                              </View>
                            ) : offenders.length === 0 ? (
                              <Text style={[sty.topProdSub, { color: p.textFaint, textAlign: 'center', paddingVertical: 14 }]}>
                                {lang === 'ar'
                                  ? `لا توجد منتجات بتنبيهات متكررة في آخر ${stockAlertRange} يوم`
                                  : `No products with recurring alerts in the last ${stockAlertRange} days`}
                              </Text>
                            ) : (
                              offenders.map((o: any, i: number) => {
                                const oos = parseInt(String(o.out_of_stock_count ?? 0), 10) || 0;
                                const low = parseInt(String(o.low_stock_count ?? 0), 10) || 0;
                                const total = parseInt(String(o.total_count ?? 0), 10) || (oos + low);
                                const displayName = (lang === 'ar' ? (o.name_ar || o.name) : (o.name || o.name_ar)) || (lang === 'ar' ? 'منتج' : 'Product');
                                const currentStock = parseInt(String(o.current_stock ?? 0), 10) || 0;
                                const suggested = Math.max(1, parseInt(String(o.suggested_reorder_qty ?? 1), 10) || 1);
                                const avgDaily = Number(o.avg_daily_sales ?? 0);
                                const coverDays = parseInt(String(o.cover_days ?? 7), 10) || 7;
                                const isRestocking =
                                  restockMut.isPending &&
                                  (restockMut.variables as any)?.productId === String(o.product_id);
                                return (
                                  <View
                                    key={o.product_id ?? i}
                                    style={[{ paddingVertical: 8, borderBottomWidth: i < offenders.length - 1 ? 1 : 0, borderBottomColor: p.border }]}
                                  >
                                    <TouchableOpacity
                                      onPress={() => {
                                        haptic.tap();
                                        const pId = String(o.product_id ?? '');
                                        const pName = (lang === 'ar' ? (o.name_ar || o.name) : (o.name || o.name_ar)) || (lang === 'ar' ? 'منتج' : 'Product');
                                        if (pId) setStockChartProduct({ id: pId, name: pName });
                                      }}
                                      activeOpacity={0.75}
                                      style={[sty.topProdRow, isRTL && sty.rowRev, { paddingVertical: 0 }]}
                                    >
                                      {o.image_url ? (
                                        <Image
                                          source={{ uri: o.image_url }}
                                          style={{ width: 40, height: 40, borderRadius: 8, backgroundColor: p.surfaceHi }}
                                          contentFit="cover"
                                        />
                                      ) : (
                                        <View style={{ width: 40, height: 40, borderRadius: 8, backgroundColor: p.surfaceHi, alignItems: 'center', justifyContent: 'center' }}>
                                          <Ionicons name="cube-outline" size={18} color={p.textFaint} />
                                        </View>
                                      )}
                                      <View style={{ flex: 1 }}>
                                        <Text style={[sty.topProdName, { color: p.text }]} numberOfLines={1}>
                                          {displayName}
                                        </Text>
                                        <View style={[sty.row, isRTL && sty.rowRev, { gap: 6, marginTop: 2, flexWrap: 'wrap' }]}>
                                          {oos > 0 && (
                                            <View style={[sty.chip, { paddingHorizontal: 6, paddingVertical: 2, backgroundColor: C.red + '22', borderColor: C.red + '55' }]}>
                                              <Text style={[sty.chipText, { color: C.red, fontSize: 10 }]}>
                                                {lang === 'ar' ? `نفاد ${oos}` : `OOS ${oos}`}
                                              </Text>
                                            </View>
                                          )}
                                          {low > 0 && (
                                            <View style={[sty.chip, { paddingHorizontal: 6, paddingVertical: 2, backgroundColor: C.orange + '22', borderColor: C.orange + '55' }]}>
                                              <Text style={[sty.chipText, { color: C.orange, fontSize: 10 }]}>
                                                {lang === 'ar' ? `منخفض ${low}` : `Low ${low}`}
                                              </Text>
                                            </View>
                                          )}
                                          <Text style={[sty.topProdSub, { color: p.textFaint }]} numberOfLines={1}>
                                            {fmtAgo(o.last_alert_at)}
                                          </Text>
                                        </View>
                                      </View>
                                      <View style={{ alignItems: isRTL ? 'flex-start' : 'flex-end' }}>
                                        <Text style={[sty.topProdPrice, { color: p.gold }]}>{total}</Text>
                                        <Text style={[sty.topProdSub, { color: p.textFaint, fontSize: 10 }]}>
                                          {lang === 'ar' ? 'تنبيه' : 'alerts'}
                                        </Text>
                                      </View>
                                      <Ionicons
                                        name="stats-chart-outline"
                                        size={16}
                                        color={p.cyan}
                                      />
                                    </TouchableOpacity>

                                    {/* Reorder suggestion + quick restock action */}
                                    <View style={[sty.row, isRTL && sty.rowRev, { gap: 8, marginTop: 8, alignItems: 'center', flexWrap: 'wrap' }]}>
                                      <View style={{ flex: 1, minWidth: 120 }}>
                                        <Text style={[sty.topProdSub, { color: p.textMuted, fontSize: 11 }, isRTL && { textAlign: 'right' }]}>
                                          {lang === 'ar'
                                            ? `اقتراح: +${suggested} وحدة (${coverDays} أيام تغطية)`
                                            : `Suggested: +${suggested} units (${coverDays}d cover)`}
                                        </Text>
                                        <Text style={[sty.topProdSub, { color: p.textFaint, fontSize: 10 }, isRTL && { textAlign: 'right' }]}>
                                          {lang === 'ar'
                                            ? `المخزون: ${currentStock} • مبيعات/يوم: ${avgDaily.toFixed(1)}`
                                            : `Stock: ${currentStock} • ${avgDaily.toFixed(1)}/day`}
                                        </Text>
                                      </View>
                                      <TouchableOpacity
                                        onPress={() => confirmRestock(o)}
                                        disabled={isRestocking}
                                        activeOpacity={0.8}
                                        style={[
                                          sty.chip,
                                          {
                                            paddingHorizontal: 12,
                                            paddingVertical: 6,
                                            backgroundColor: p.gold + (isRestocking ? '55' : 'CC'),
                                            borderColor: p.gold,
                                            flexDirection: 'row',
                                            alignItems: 'center',
                                            gap: 4,
                                          },
                                        ]}
                                      >
                                        {isRestocking ? (
                                          <ActivityIndicator size="small" color="#000" />
                                        ) : (
                                          <Ionicons name="add-circle-outline" size={14} color="#000" />
                                        )}
                                        <Text style={[sty.chipText, { color: '#000', fontWeight: '700' }]}>
                                          {lang === 'ar' ? `استعادة +${suggested}` : `Restock +${suggested}`}
                                        </Text>
                                      </TouchableOpacity>
                                    </View>
                                  </View>
                                );
                              })
                            )}
                          </View>
                        </>
                      );
                    })()}

                    {/* Top products */}
                    {topProd.length > 0 && (
                      <>
                        <Text style={[sty.sectionTitle, { color: p.textMuted }, isRTL && { textAlign: 'right' }, { marginTop: 20 }]}>
                          {lang === 'ar' ? 'أكثر الأصناف طلباً' : 'Top Ordered Items'}
                        </Text>
                        <View style={[sty.analyticsCard, { backgroundColor: p.surface, borderColor: p.border }]}>
                          <LinearGradient colors={['rgba(255,107,53,0.06)', 'transparent']} style={StyleSheet.absoluteFill} />
                          {topProd.map((prod: any, i: number) => (
                            <View key={i} style={[sty.topProdRow, isRTL && sty.rowRev]}>
                              <View style={[sty.topProdRank, { backgroundColor: i < 3 ? p.goldMuted : p.surfaceHi }]}>
                                <Text style={[sty.topProdRankNum, { color: i < 3 ? p.gold : p.textMuted }]}>{i + 1}</Text>
                              </View>
                              <View style={{ flex: 1 }}>
                                <Text style={[sty.topProdName, { color: p.text }]} numberOfLines={1}>
                                  {lang === 'ar' ? (prod.name_ar || prod.name) : prod.name}
                                </Text>
                                <Text style={[sty.topProdSub, { color: p.textFaint }]}>
                                  {prod.total_qty} {lang === 'ar' ? 'قطعة' : 'units'} • {prod.order_count} {lang === 'ar' ? 'طلب' : 'orders'}
                                </Text>
                              </View>
                              <Text style={[sty.topProdPrice, { color: p.gold }]}>{prod.price.toFixed(0)} ج.م</Text>
                            </View>
                          ))}
                        </View>
                      </>
                    )}

                    {/* ── Stock History ── */}
                    {(() => {
                      const histRows: any[] = restaurantStockHistoryQ.data ?? [];
                      const fmtAgoH = (iso: string | null | undefined) => {
                        if (!iso) return '';
                        const t = new Date(iso).getTime();
                        if (Number.isNaN(t)) return '';
                        const diffMin = Math.max(0, Math.floor((Date.now() - t) / 60000));
                        if (diffMin < 1) return lang === 'ar' ? 'الآن' : 'just now';
                        if (diffMin < 60) return lang === 'ar' ? `قبل ${diffMin} د` : `${diffMin}m ago`;
                        const h = Math.floor(diffMin / 60);
                        if (h < 24) return lang === 'ar' ? `قبل ${h} س` : `${h}h ago`;
                        const d = Math.floor(h / 24);
                        return lang === 'ar' ? `قبل ${d} يوم` : `${d}d ago`;
                      };
                      return (
                        <>
                          <Text style={[sty.sectionTitle, { color: p.textMuted }, isRTL && { textAlign: 'right' }, { marginTop: 20 }]}>
                            {lang === 'ar' ? 'سجل تعديلات المخزون' : 'Stock Change History'}
                          </Text>
                          <View style={[sty.analyticsCard, { backgroundColor: p.surface, borderColor: p.border }]}>
                            <LinearGradient colors={['rgba(99,102,241,0.06)', 'transparent']} style={StyleSheet.absoluteFill} />
                            {restaurantStockHistoryQ.isLoading ? (
                              <View style={{ paddingVertical: 18, alignItems: 'center' }}>
                                <ActivityIndicator color={p.gold} />
                              </View>
                            ) : restaurantStockHistoryQ.isError ? (
                              <Text style={[sty.topProdSub, { color: p.textFaint, textAlign: 'center', paddingVertical: 14 }]}>
                                {lang === 'ar' ? 'تعذّر تحميل السجل' : 'Failed to load history'}
                              </Text>
                            ) : histRows.length === 0 ? (
                              <Text style={[sty.topProdSub, { color: p.textFaint, textAlign: 'center', paddingVertical: 14 }]}>
                                {lang === 'ar' ? 'لا توجد تعديلات على المخزون بعد' : 'No stock changes yet'}
                              </Text>
                            ) : (
                              histRows.map((row: any, i: number) => {
                                const prodName = (lang === 'ar' ? (row.product_name_ar || row.product_name) : (row.product_name || row.product_name_ar)) || (lang === 'ar' ? 'منتج' : 'Product');
                                const oldQty = parseInt(String(row.old_quantity ?? 0), 10);
                                const newQty = parseInt(String(row.new_quantity ?? 0), 10);
                                const delta = newQty - oldQty;
                                const isIncrease = delta >= 0;
                                const deltaColor = isIncrease ? C.green : C.red;
                                const deltaLabel = isIncrease ? `+${delta}` : `${delta}`;
                                const changer = row.changed_by_user_name || row.changed_by_name || (lang === 'ar' ? 'النظام' : 'System');
                                const sourceLabel = row.source === 'restock' ? (lang === 'ar' ? 'تعبئة' : 'Restock') : row.source === 'order' ? (lang === 'ar' ? 'طلب' : 'Order') : row.source ?? '';
                                return (
                                  <TouchableOpacity
                                    key={row.id ?? i}
                                    onPress={() => {
                                      haptic.tap();
                                      const pId = String(row.product_id ?? '');
                                      const pName = (lang === 'ar' ? (row.product_name_ar || row.product_name) : (row.product_name || row.product_name_ar)) || (lang === 'ar' ? 'منتج' : 'Product');
                                      if (pId) setStockChartProduct({ id: pId, name: pName });
                                    }}
                                    activeOpacity={0.75}
                                    style={[
                                      { paddingVertical: 10, borderBottomWidth: i < histRows.length - 1 ? 1 : 0, borderBottomColor: p.border },
                                      sty.row,
                                      isRTL && sty.rowRev,
                                      { gap: 10, alignItems: 'center' },
                                    ]}
                                  >
                                    {/* Delta badge */}
                                    <View style={{
                                      width: 44, height: 44, borderRadius: 10,
                                      backgroundColor: deltaColor + '22',
                                      alignItems: 'center', justifyContent: 'center',
                                    }}>
                                      <Ionicons
                                        name={isIncrease ? 'arrow-up-circle-outline' : 'arrow-down-circle-outline'}
                                        size={20}
                                        color={deltaColor}
                                      />
                                    </View>
                                    {/* Info */}
                                    <View style={{ flex: 1 }}>
                                      <Text style={[sty.topProdName, { color: p.text }]} numberOfLines={1}>
                                        {prodName}
                                      </Text>
                                      <View style={[sty.row, isRTL && sty.rowRev, { gap: 4, marginTop: 2, flexWrap: 'wrap' }]}>
                                        <Text style={[sty.topProdSub, { color: p.textFaint, fontSize: 11 }]}>
                                          {oldQty} → {newQty}
                                        </Text>
                                        {sourceLabel ? (
                                          <View style={[sty.chip, { paddingHorizontal: 5, paddingVertical: 1, backgroundColor: p.surfaceHi, borderColor: p.border }]}>
                                            <Text style={[sty.chipText, { color: p.textMuted, fontSize: 10 }]}>{sourceLabel}</Text>
                                          </View>
                                        ) : null}
                                        <Text style={[sty.topProdSub, { color: p.textFaint, fontSize: 10 }]}>{changer}</Text>
                                      </View>
                                    </View>
                                    {/* Right side: delta + time + chart hint */}
                                    <View style={{ alignItems: isRTL ? 'flex-start' : 'flex-end' }}>
                                      <Text style={[sty.topProdPrice, { color: deltaColor, fontSize: 15 }]}>{deltaLabel}</Text>
                                      <Text style={[sty.topProdSub, { color: p.textFaint, fontSize: 10 }]}>{fmtAgoH(row.changed_at)}</Text>
                                    </View>
                                    <Ionicons name="stats-chart-outline" size={14} color={p.cyan} style={{ opacity: 0.7 }} />
                                  </TouchableOpacity>
                                );
                              })
                            )}
                          </View>
                        </>
                      );
                    })()}
                  </View>
                )}
              </>
            )}

            {/* ─── RATINGS TAB ─── */}
            {activeTab === 'ratings' && (
              <>
                {ratingsQ.isLoading ? (
                  <View style={sty.centerLoad}><ActivityIndicator color={C.gold} /></View>
                ) : ratingsQ.isError ? (
                  <EmptyPlaceholder icon="warning-outline" msg={lang === 'ar' ? 'تعذّر تحميل التقييمات' : 'Failed to load ratings'} />
                ) : ((ratingsQ.data as any)?.ratings ?? []).length === 0 ? (
                  <EmptyPlaceholder
                    icon="star-outline"
                    msg={lang === 'ar' ? 'لا توجد تقييمات لهذا المطعم بعد' : 'No ratings for this restaurant yet'}
                  />
                ) : (
                  <View style={sty.listWrap}>
                    {/* Stats summary row */}
                    {(ratingsQ.data as any)?.stats && (() => {
                      const st = (ratingsQ.data as any).stats;
                      const avg = st.avg_rating ? parseFloat(st.avg_rating) : 0;
                      const total = parseInt(st.total_count, 10) || 0;
                      return (
                        <View style={[sty.ratingsStatCard, { backgroundColor: p.surface, borderColor: p.goldBorder }]}>
                          <View style={sty.ratingsStatLeft}>
                            <Text style={[sty.ratingsStatAvg, { color: p.gold }]}>
                              {avg > 0 ? avg.toFixed(1) : '—'}
                            </Text>
                            <View style={{ flexDirection: 'row', gap: 2 }}>
                              {[1,2,3,4,5].map(s => (
                                <Ionicons key={s} name={s <= Math.round(avg) ? 'star' : 'star-outline'} size={14} color={C.gold} />
                              ))}
                            </View>
                          </View>
                          <View style={[sty.ratingsStatDivider, { backgroundColor: p.border }]} />
                          <View style={sty.ratingsStatRight}>
                            <Text style={[sty.ratingsStatTotal, { color: p.text }]}>
                              {total}
                            </Text>
                            <Text style={[sty.ratingsStatLabel, { color: p.textMuted }]}>
                              {lang === 'ar' ? 'تقييم' : 'ratings'}
                            </Text>
                          </View>
                        </View>
                      );
                    })()}

                    {/* Rating cards */}
                    {((ratingsQ.data as any)?.ratings ?? []).map((rating: any) => {
                      const hasReply = !!rating.admin_reply;
                      const shortId = String(rating.order_id ?? '').slice(0, 8).toUpperCase();
                      const userName = rating.user_name || (lang === 'ar' ? 'مجهول' : 'Anonymous');
                      const dateStr = rating.created_at
                        ? new Date(rating.created_at).toLocaleDateString(
                            lang === 'ar' ? 'ar-EG' : 'en-US',
                            { year: 'numeric', month: 'short', day: 'numeric' },
                          )
                        : '';
                      return (
                        <View key={rating.id} style={[sty.ratingCard, { backgroundColor: p.surface, borderColor: p.border }]}>
                          {/* Header row */}
                          <View style={[sty.row, isRTL && sty.rowRev, { gap: 10 }]}>
                            <View style={[sty.ratingAvatar, { backgroundColor: p.goldMuted }]}>
                              <Ionicons name="person" size={18} color={p.gold} />
                            </View>
                            <View style={{ flex: 1, gap: 3 }}>
                              <Text style={[sty.ratingUser, { color: p.text }]} numberOfLines={1}>{userName}</Text>
                              <View style={{ flexDirection: 'row', gap: 2 }}>
                                {[1,2,3,4,5].map(s => (
                                  <Ionicons key={s} name={s <= rating.rating ? 'star' : 'star-outline'} size={12} color={C.gold} />
                                ))}
                              </View>
                              <Text style={[sty.ratingMeta, { color: p.textFaint }]}>
                                #{shortId} · {dateStr}
                              </Text>
                            </View>
                          </View>

                          {/* Comment */}
                          {!!rating.comment && (
                            <Text style={[sty.ratingComment, { color: p.textMuted }]} numberOfLines={4}>
                              {rating.comment}
                            </Text>
                          )}

                          {/* Existing reply */}
                          {hasReply && (
                            <View style={[sty.ratingReplyBox, { backgroundColor: C.green + '10', borderColor: C.green + '30' }]}>
                              <View style={[sty.row, isRTL && sty.rowRev, { gap: 5, alignItems: 'center', marginBottom: 4 }]}>
                                <Ionicons name="chatbubble-ellipses" size={12} color={C.green} />
                                <Text style={[sty.ratingReplyLabel, { color: C.green }]}>
                                  {lang === 'ar' ? 'ردك' : 'Your reply'}
                                </Text>
                                {rating.admin_reply_at && (
                                  <Text style={[sty.ratingMeta, { color: p.textFaint }]}>
                                    · {new Date(rating.admin_reply_at).toLocaleDateString(
                                        lang === 'ar' ? 'ar-EG' : 'en-US',
                                        { month: 'short', day: 'numeric' },
                                      )}
                                  </Text>
                                )}
                              </View>
                              <Text style={[sty.ratingReplyText, { color: p.text }]} numberOfLines={4}>
                                {rating.admin_reply}
                              </Text>
                            </View>
                          )}

                          {/* Action buttons */}
                          <View style={[sty.row, isRTL && sty.rowRev, { gap: 8, marginTop: 4 }]}>
                            <TouchableOpacity
                              style={[sty.ratingReplyBtn, {
                                borderColor: hasReply ? C.green + '60' : p.border,
                                backgroundColor: hasReply ? C.green + '10' : 'transparent',
                              }]}
                              onPress={() => {
                                haptic.tap();
                                setReplyTarget(rating);
                                setReplyText(rating.admin_reply ?? '');
                                setShowReplyModal(true);
                              }}
                              activeOpacity={0.7}
                            >
                              <Ionicons
                                name={hasReply ? 'create-outline' : 'chatbubble-outline'}
                                size={13}
                                color={C.green}
                              />
                              <Text style={[sty.ratingReplyBtnText, { color: C.green }]}>
                                {hasReply
                                  ? (lang === 'ar' ? 'تعديل الرد' : 'Edit reply')
                                  : (lang === 'ar' ? 'رد' : 'Reply')}
                              </Text>
                            </TouchableOpacity>

                            {hasReply && (
                              <TouchableOpacity
                                style={[sty.ratingReplyBtn, { borderColor: C.red + '40', backgroundColor: C.red + '08' }]}
                                onPress={() => {
                                  haptic.tap();
                                  Alert.alert(
                                    lang === 'ar' ? 'حذف الرد' : 'Delete reply',
                                    lang === 'ar' ? 'هل تريد حذف ردك على هذا التقييم؟' : 'Delete your reply on this rating?',
                                    [
                                      { text: lang === 'ar' ? 'تراجع' : 'Cancel', style: 'cancel' },
                                      {
                                        text: lang === 'ar' ? 'حذف' : 'Delete',
                                        style: 'destructive',
                                        onPress: () => deleteReplyMut.mutate(rating.id),
                                      },
                                    ],
                                  );
                                }}
                                activeOpacity={0.7}
                              >
                                <Ionicons name="trash-outline" size={13} color={C.red} />
                                <Text style={[sty.ratingReplyBtnText, { color: C.red }]}>
                                  {lang === 'ar' ? 'حذف' : 'Delete'}
                                </Text>
                              </TouchableOpacity>
                            )}
                          </View>
                        </View>
                      );
                    })}
                  </View>
                )}
              </>
            )}
          </View>
        ) : (
          !restaurantsQ.isLoading && (
            <EmptyPlaceholder
              icon="storefront-outline"
              msg={lang === 'ar' ? 'اختر مطعماً للعرض' : 'Select a restaurant to view data'}
            />
          )
        )}
      </ScrollView>

      {/* User management modal */}
      {isOwnerOrPartner && selectedRestaurant && (
        <UserManagementModal
          visible={showUserModal}
          onClose={() => setShowUserModal(false)}
          restaurantId={selectedRestaurant.id}
          restaurantName={lang === 'ar' ? (selectedRestaurant.name_ar || selectedRestaurant.name) : selectedRestaurant.name}
          lang={lang}
          isRTL={isRTL}
        />
      )}

      {/* ── Rating reply modal ─────────────────────────────────────────────── */}
      <Modal
        visible={showReplyModal}
        animationType="slide"
        transparent
        onRequestClose={() => { setShowReplyModal(false); setReplyTarget(null); setReplyText(''); }}
      >
        <View style={sty.modalOverlay}>
          <BlurView intensity={50} tint="dark" style={StyleSheet.absoluteFill} />
          <View style={[sty.modalSheet, { backgroundColor: p.surface }]}>
            <LinearGradient
              colors={['rgba(16,185,129,0.08)', 'rgba(0,0,0,0.5)']}
              style={StyleSheet.absoluteFill}
            />
            <View style={[sty.modalHandle, { backgroundColor: p.border }]} />
            <View style={[sty.row, isRTL && sty.rowRev, { justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }]}>
              <View>
                <Text style={[sty.modalTitle, { color: C.green }]}>
                  {replyTarget?.admin_reply
                    ? (lang === 'ar' ? 'تعديل الرد' : 'Edit Reply')
                    : (lang === 'ar' ? 'رد على التقييم' : 'Reply to Rating')}
                </Text>
                {replyTarget?.user_name && (
                  <Text style={[sty.modalSub, { color: p.textMuted }]}>
                    {lang === 'ar' ? 'رد على' : 'Replying to'} {replyTarget.user_name}
                  </Text>
                )}
              </View>
              <TouchableOpacity
                style={sty.modalClose}
                onPress={() => { setShowReplyModal(false); setReplyTarget(null); setReplyText(''); }}
              >
                <Ionicons name="close" size={18} color={p.textMuted} />
              </TouchableOpacity>
            </View>

            {/* Original comment preview */}
            {replyTarget?.comment ? (
              <View style={[sty.ratingReplyPreview, { backgroundColor: p.surfaceHi, borderColor: p.border }]}>
                <View style={{ flexDirection: 'row', gap: 2, marginBottom: 4 }}>
                  {[1,2,3,4,5].map((s: number) => (
                    <Ionicons key={s} name={s <= (replyTarget?.rating ?? 0) ? 'star' : 'star-outline'} size={11} color={C.gold} />
                  ))}
                </View>
                <Text style={[sty.modalHint, { color: p.textMuted }]} numberOfLines={3}>
                  {replyTarget.comment}
                </Text>
              </View>
            ) : null}

            <TextInput
              style={[sty.replyInput, { backgroundColor: p.surfaceHi, borderColor: C.green + '50', color: p.text }]}
              multiline
              numberOfLines={4}
              placeholder={lang === 'ar' ? 'اكتب ردك هنا...' : 'Write your reply here...'}
              placeholderTextColor={p.textFaint}
              value={replyText}
              onChangeText={setReplyText}
              maxLength={500}
              textAlignVertical="top"
            />
            <Text style={[sty.modalHint, { color: p.textFaint, textAlign: 'right', marginBottom: 12 }]}>
              {replyText.length}/500
            </Text>

            <TouchableOpacity
              style={[sty.replySubmitBtn, {
                backgroundColor: replyMut.isPending || !replyText.trim() ? C.green + '40' : C.green,
                opacity: replyMut.isPending || !replyText.trim() ? 0.7 : 1,
              }]}
              onPress={() => {
                if (!replyTarget || !replyText.trim()) return;
                haptic.tap();
                replyMut.mutate({ id: replyTarget.id, reply: replyText.trim() });
              }}
              disabled={replyMut.isPending || !replyText.trim()}
              activeOpacity={0.8}
            >
              {replyMut.isPending ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <>
                  <Ionicons name="send" size={16} color="#fff" />
                  <Text style={sty.replySubmitBtnText}>
                    {lang === 'ar' ? 'إرسال الرد' : 'Send Reply'}
                  </Text>
                </>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* ── Print Hub modal ─────────────────────────────────────────────────
          A single tab-aware modal that replaces the previous orders-only
          report sheet. Shows three large icon tiles:
            1. Thermal Print (80mm) — current tab summary
            2. Daily Brief PDF — compact one-row-per-record table
            3. Detailed PDF — per-record breakdown / extra sections
          The dispatcher (`handleHubAction`) routes each tile to the right
          builder based on `activeTab` (orders / appointments / analytics).
          ─────────────────────────────────────────────────────────────── */}
      <Modal
        visible={showReportModal}
        animationType="slide"
        transparent
        onRequestClose={() => setShowReportModal(false)}
      >
        <View style={sty.modalOverlay}>
          <BlurView intensity={50} tint="dark" style={StyleSheet.absoluteFill} />
          <View style={[sty.modalSheet, { backgroundColor: p.surface, borderColor: p.goldBorder, maxHeight: '70%' }]}>
            <LinearGradient
              colors={['rgba(255,215,0,0.08)', 'rgba(0,0,0,0.7)']}
              style={StyleSheet.absoluteFill}
            />
            <View style={[sty.modalHandle, { backgroundColor: p.border }]} />

            {(() => {
              const hubTitle = activeTab === 'appointments'
                ? (lang === 'ar' ? 'تقارير الحجوزات' : 'Bookings Reports')
                : activeTab === 'analytics'
                ? (lang === 'ar' ? 'تقارير التحليلات' : 'Analytics Reports')
                : (lang === 'ar' ? 'تقارير الطلبات' : 'Orders Reports');
              const hubIcon = activeTab === 'appointments' ? 'calendar' : activeTab === 'analytics' ? 'stats-chart' : 'receipt-outline';
              const recordCount = activeTab === 'appointments' ? appts.length : activeTab === 'analytics' ? (stats ? 1 : 0) : (ordersQ.data?.orders ?? []).length;
              const recordLabel = activeTab === 'appointments'
                ? (lang === 'ar' ? `${appts.length} حجز` : `${appts.length} bookings`)
                : activeTab === 'analytics'
                ? (lang === 'ar' ? 'لقطة فورية' : 'Live snapshot')
                : (lang === 'ar' ? `${(ordersQ.data?.orders ?? []).length} طلب` : `${(ordersQ.data?.orders ?? []).length} orders`);

              const ordersList: any[] = ordersQ.data?.orders ?? [];
              // All bookings now carry a restaurant_id (server validation +
              // backfill), so the restaurant-scoped query is the sole source.
              const apptsList: any[] = appts ?? [];

              // Compute live count for a (scope, range) combo. Analytics rows
              // count orders + appointments inside the range so the user can
              // see "how much data this analytics PDF will summarize".
              const liveCountFor = (scope: 'orders' | 'bookings' | 'analytics', rangeKey: DateRangeKey) => {
                const { start, end } = rangeToBounds(rangeKey);
                if (scope === 'orders') return ordersList.filter((o: any) => inRange(o.created_at, start, end)).length;
                if (scope === 'bookings') return apptsList.filter((a: any) => inRange(a.appointment_date, start, end)).length;
                // analytics
                const o = ordersList.filter((x: any) => inRange(x.created_at, start, end)).length;
                const a = apptsList.filter((x: any) => inRange(x.appointment_date, start, end)).length;
                return o + a;
              };

              const totalCountFor = (scope: 'orders' | 'bookings' | 'analytics') =>
                scope === 'orders' ? ordersList.length : scope === 'bookings' ? apptsList.length : (stats ? 1 : 0);

              const rangeChips: Array<{ key: DateRangeKey; label: string }> = [
                { key: 'today',     label: lang === 'ar' ? 'اليوم'    : 'Today' },
                { key: 'yesterday', label: lang === 'ar' ? 'أمس'      : 'Yesterday' },
                { key: 'last7',     label: lang === 'ar' ? '٧ أيام'   : 'Last 7' },
                { key: 'last30',    label: lang === 'ar' ? '٣٠ يوم'   : 'Last 30' },
                { key: 'all',       label: lang === 'ar' ? 'الكل'     : 'All' },
              ];

              const accentColor: string = ((p as any).accent ?? C.cyan) as string;

              return (
                <>
                  {/* Header row */}
                  <View style={[sty.row, isRTL && sty.rowRev, { justifyContent: 'space-between', marginBottom: 6 }]}>
                    <View style={[sty.row, isRTL && sty.rowRev, { gap: 10 }]}>
                      <View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: p.goldMuted, alignItems: 'center', justifyContent: 'center' }}>
                        <Ionicons name={hubIcon as any} size={22} color={p.gold} />
                      </View>
                      <View>
                        <Text style={[sty.modalTitle, { color: p.gold }]}>{hubTitle}</Text>
                        <Text style={[sty.modalSub, { color: p.textMuted }]} numberOfLines={1}>
                          {selectedRestaurant
                            ? (lang === 'ar' ? (selectedRestaurant.name_ar || selectedRestaurant.name) : selectedRestaurant.name)
                            : ''}
                        </Text>
                      </View>
                    </View>
                    <TouchableOpacity onPress={() => setShowReportModal(false)} style={[sty.modalClose, { backgroundColor: p.surfaceHi }]}>
                      <Ionicons name="close" size={20} color={p.textMuted} />
                    </TouchableOpacity>
                  </View>

                  {/* Meta row — date + count */}
                  <View style={[sty.row, isRTL && sty.rowRev, { gap: 16, marginTop: 8, marginBottom: 18 }]}>
                    <View style={[sty.row, isRTL && sty.rowRev, { gap: 4 }]}>
                      <Ionicons name="calendar-outline" size={12} color={p.textFaint} />
                      <Text style={[sty.modalHint, { color: p.textFaint }]}>
                        {new Date().toLocaleDateString(lang === 'ar' ? 'ar-EG' : 'en-US')}
                      </Text>
                    </View>
                    <View style={[sty.row, isRTL && sty.rowRev, { gap: 4 }]}>
                      <Ionicons name="layers-outline" size={12} color={p.textFaint} />
                      <Text style={[sty.modalHint, { color: p.textFaint }]}>{recordLabel}</Text>
                    </View>
                  </View>

                  {/* Print Hub layout
                      ─────────────────
                      • Thermal tile (1 row, tab-aware quick-action with its own
                        chips for orders/bookings tabs).
                      • Daily Brief PDF group → 3 sub-rows (Orders / Bookings /
                        Analytics), each with its own date chips except
                        Analytics (live aggregate snapshot, no chips).
                      • Detailed PDF group → same 3 sub-row structure.
                      Each row dispatches to its dedicated builder so a user can
                      print bookings & analytics PDFs from any tab without
                      switching context. */}
                  <ScrollView style={{ maxHeight: 520 }} showsVerticalScrollIndicator={false}>
                    <View style={{ gap: 14, paddingBottom: 8 }}>
                      {/* ── Thermal tile (tab-aware) ──────────────────────────── */}
                      {(() => {
                        const showRange = activeTab !== 'analytics';
                        const rangeState = activeTab === 'appointments' ? apptHubRange : orderHubRange;
                        const setRangeState = activeTab === 'appointments' ? setApptHubRange : setOrderHubRange;
                        const currentRange = rangeState.thermal;
                        const liveCount = (() => {
                          if (!showRange) return recordCount;
                          const { start, end } = rangeToBounds(currentRange);
                          if (activeTab === 'orders') return ordersList.filter((o: any) => inRange(o.created_at, start, end)).length;
                          return apptsList.filter((a: any) => inRange(a.appointment_date, start, end)).length;
                        })();
                        const tileLabel = lang === 'ar' ? 'طباعة حرارية 80مم' : 'Thermal Print 80mm';
                        const tileSub = activeTab === 'appointments'
                          ? (lang === 'ar' ? 'إيصال حجوزات مضغوط' : 'Compact bookings receipt')
                          : activeTab === 'analytics'
                          ? (lang === 'ar' ? 'إيصال إحصاءات سريع' : 'Quick stats receipt')
                          : (lang === 'ar' ? 'ملخص طلبات على ورق حراري' : 'Orders summary on thermal paper');
                        return (
                          <View
                            style={{
                              borderRadius: 16,
                              backgroundColor: p.surfaceHi,
                              borderWidth: 1,
                              borderColor: p.border,
                              paddingVertical: 14,
                              paddingHorizontal: 14,
                              opacity: recordCount === 0 ? 0.5 : 1,
                            }}
                          >
                            <View style={{ flexDirection: isRTL ? 'row-reverse' : 'row', alignItems: 'center', gap: 12 }}>
                              <View style={{ width: 46, height: 46, borderRadius: 12, backgroundColor: p.gold + '22', borderWidth: 1, borderColor: p.gold + '55', alignItems: 'center', justifyContent: 'center' }}>
                                <Ionicons name="print" size={22} color={p.gold} />
                              </View>
                              <View style={{ flex: 1 }}>
                                <Text style={{ fontSize: 14, fontWeight: '700', color: p.text, textAlign: isRTL ? 'right' : 'left' }}>{tileLabel}</Text>
                                <Text style={{ fontSize: 11, color: p.textMuted, marginTop: 2, textAlign: isRTL ? 'right' : 'left' }}>{tileSub}</Text>
                              </View>
                            </View>
                            {showRange && (
                              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, paddingTop: 12 }}>
                                {rangeChips.map((rc) => {
                                  const active = currentRange === rc.key;
                                  return (
                                    <TouchableOpacity
                                      key={rc.key}
                                      onPress={() => { haptic.tap(); setRangeState((s) => ({ ...s, thermal: rc.key })); }}
                                      style={{ paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, borderWidth: 1, borderColor: active ? p.gold : p.border, backgroundColor: active ? p.gold + '22' : p.surface }}
                                    >
                                      <Text style={{ fontSize: 11, fontWeight: active ? '700' : '600', color: active ? p.gold : p.textMuted }}>{rc.label}</Text>
                                    </TouchableOpacity>
                                  );
                                })}
                              </ScrollView>
                            )}
                            {/* Hub thermal language toggle */}
                            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 12 }}>
                              <Text style={{ fontSize: 11, color: p.textFaint, flex: 1, textAlign: isRTL ? 'right' : 'left' }}>
                                {lang === 'ar' ? 'لغة الإيصال:' : 'Receipt lang:'}
                              </Text>
                              <View style={{ flexDirection: 'row', borderRadius: 7, overflow: 'hidden', borderWidth: 1, borderColor: p.border }}>
                                {(['ar', 'en'] as const).map((l) => (
                                  <TouchableOpacity
                                    key={l}
                                    onPress={() => { haptic.tap(); setHubPrintLang(l); setReceiptLanguage(l); }}
                                    style={{ paddingHorizontal: 12, paddingVertical: 5, backgroundColor: hubPrintLang === l ? p.gold : p.surfaceHi }}
                                  >
                                    <Text style={{ fontSize: 11, fontWeight: '700', color: hubPrintLang === l ? '#000' : p.textMuted }}>
                                      {l === 'ar' ? 'AR' : 'EN'}
                                    </Text>
                                  </TouchableOpacity>
                                ))}
                              </View>
                            </View>
                            <View style={{ flexDirection: isRTL ? 'row-reverse' : 'row', alignItems: 'center', gap: 10, marginTop: 10 }}>
                              {showRange ? (
                                <Text style={{ fontSize: 11, color: p.textFaint, flex: 1, textAlign: isRTL ? 'right' : 'left' }}>
                                  {lang === 'ar'
                                    ? `${liveCount} عنصر في الفترة`
                                    : `${liveCount} ${activeTab === 'appointments' ? 'bookings' : 'orders'} in range`}
                                </Text>
                              ) : <View style={{ flex: 1 }} />}
                              <TouchableOpacity
                                disabled={recordCount === 0 || (showRange && liveCount === 0)}
                                onPress={() => { haptic.tap(); handleHubAction('thermal', showRange ? currentRange : 'all'); }}
                                style={{ paddingHorizontal: 16, paddingVertical: 9, borderRadius: 10, backgroundColor: p.gold, flexDirection: isRTL ? 'row-reverse' : 'row', alignItems: 'center', gap: 6, opacity: (showRange && liveCount === 0) ? 0.4 : 1 }}
                              >
                                <Ionicons name={isRTL ? "arrow-back" : "arrow-forward"} size={14} color="#fff" />
                                <Text style={{ fontSize: 12, fontWeight: '800', color: '#fff', letterSpacing: 0.3 }}>{lang === 'ar' ? 'تشغيل' : 'Run'}</Text>
                              </TouchableOpacity>
                            </View>
                          </View>
                        );
                      })()}

                      {/* ── PDF groups (Daily Brief + Detailed) ──────────────── */}
                      {([
                        { mode: 'daily',    color: accentColor, icon: 'today-outline',         label: lang === 'ar' ? 'تقرير يومي مختصر' : 'Daily Brief PDF',
                          sub: lang === 'ar' ? 'مؤشرات وجدول مختصر' : 'KPIs + compact table',
                          ordersKey: 'briefOrders' as PdfHubRowKey, bookingsKey: 'briefBookings' as PdfHubRowKey, analyticsKey: 'briefAnalytics' as PdfHubRowKey },
                        { mode: 'detailed', color: C.green,     icon: 'document-text-outline', label: lang === 'ar' ? 'تقرير تفصيلي' : 'Detailed PDF',
                          sub: lang === 'ar' ? 'بطاقة لكل سجل بالتفاصيل' : 'A card per record with full details',
                          ordersKey: 'detailedOrders' as PdfHubRowKey, bookingsKey: 'detailedBookings' as PdfHubRowKey, analyticsKey: 'detailedAnalytics' as PdfHubRowKey },
                      ] as const).map((group) => (
                        <View
                          key={group.mode}
                          style={{
                            borderRadius: 16,
                            backgroundColor: p.surfaceHi,
                            borderWidth: 1,
                            borderColor: p.border,
                            paddingVertical: 14,
                            paddingHorizontal: 14,
                          }}
                        >
                          {/* Group head */}
                          <View style={{ flexDirection: isRTL ? 'row-reverse' : 'row', alignItems: 'center', gap: 12, marginBottom: 6 }}>
                            <View style={{ width: 42, height: 42, borderRadius: 12, backgroundColor: group.color + '22', borderWidth: 1, borderColor: group.color + '55', alignItems: 'center', justifyContent: 'center' }}>
                              <Ionicons name={group.icon as any} size={20} color={group.color} />
                            </View>
                            <View style={{ flex: 1 }}>
                              <Text style={{ fontSize: 14, fontWeight: '800', color: p.text, textAlign: isRTL ? 'right' : 'left' }}>{group.label}</Text>
                              <Text style={{ fontSize: 11, color: p.textMuted, marginTop: 2, textAlign: isRTL ? 'right' : 'left' }}>{group.sub}</Text>
                            </View>
                          </View>

                          {/* Sub-rows: Orders / Bookings / Analytics */}
                          {(['orders', 'bookings', 'analytics'] as const).map((scope) => {
                            // Every sub-row (Orders / Bookings / Analytics) now carries
                            // its own independent date-range chip set. Analytics still
                            // accepts an "all" implicit option via 'all' rangeKey to
                            // request the cumulative server snapshot.
                            const showRange = true;
                            const rangeKey: PdfHubRowKey =
                              scope === 'orders' ? group.ordersKey
                              : scope === 'bookings' ? group.bookingsKey
                              : group.analyticsKey;
                            const currentRange: DateRangeKey = pdfHubRange[rangeKey];
                            const liveCount = liveCountFor(scope, currentRange);
                            const total = totalCountFor(scope);
                            const rowDisabled = total === 0 || liveCount === 0;
                            const rowIcon = scope === 'orders' ? 'receipt-outline' : scope === 'bookings' ? 'calendar' : 'stats-chart';
                            const rowLabel = scope === 'orders'
                              ? (lang === 'ar' ? 'الطلبات' : 'Orders')
                              : scope === 'bookings'
                              ? (lang === 'ar' ? 'الحجوزات' : 'Bookings')
                              : (lang === 'ar' ? 'التحليلات' : 'Analytics');
                            const analyticsCompareKey = scope === 'analytics'
                              ? (rangeKey as 'briefAnalytics' | 'detailedAnalytics')
                              : null;
                            const currentCompare: CompareRangeKey = analyticsCompareKey
                              ? analyticsCompareRange[analyticsCompareKey]
                              : 'none';
                            const onRun = () => {
                              haptic.tap();
                              setShowReportModal(false);
                              const m: 'daily' | 'detailed' = group.mode;
                              if (scope === 'orders') handleDownloadOrders(m, currentRange);
                              else if (scope === 'bookings') handleDownloadAppointments(m, currentRange);
                              else handleDownloadAnalytics(m, currentRange, currentCompare);
                            };
                            const onRunCsv = () => {
                              haptic.tap();
                              setShowReportModal(false);
                              if (scope === 'orders') handleExportOrdersCsv(currentRange);
                              else if (scope === 'bookings') handleExportAppointmentsCsv(currentRange);
                              else handleExportAnalyticsCsv(currentRange);
                            };
                            return (
                              <View
                                key={scope}
                                style={{
                                  marginTop: 10,
                                  paddingVertical: 10,
                                  paddingHorizontal: 10,
                                  borderRadius: 12,
                                  backgroundColor: p.surface,
                                  borderWidth: 1,
                                  borderColor: p.border,
                                  opacity: rowDisabled ? 0.55 : 1,
                                }}
                              >
                                <View style={{ flexDirection: isRTL ? 'row-reverse' : 'row', alignItems: 'center', gap: 10 }}>
                                  <View style={{ width: 30, height: 30, borderRadius: 8, backgroundColor: group.color + '15', alignItems: 'center', justifyContent: 'center' }}>
                                    <Ionicons name={rowIcon as any} size={15} color={group.color} />
                                  </View>
                                  <Text style={{ flex: 1, fontSize: 12, fontWeight: '700', color: p.text, textAlign: isRTL ? 'right' : 'left' }}>{rowLabel}</Text>
                                  {!showRange && (
                                    <Text style={{ fontSize: 10, color: p.textFaint }}>
                                      {lang === 'ar' ? 'لقطة فورية' : 'Live snapshot'}
                                    </Text>
                                  )}
                                </View>

                                {showRange && (
                                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, paddingTop: 8 }}>
                                    {rangeChips.map((rc) => {
                                      const active = currentRange === rc.key;
                                      return (
                                        <TouchableOpacity
                                          key={rc.key}
                                          onPress={() => {
                                            haptic.tap();
                                            if (rangeKey) setPdfHubRange((s) => ({ ...s, [rangeKey]: rc.key }));
                                            // Auto-clear an analytics compare range that
                                            // would now collide with the primary range.
                                            if (analyticsCompareKey) {
                                              setAnalyticsCompareRange((s) =>
                                                s[analyticsCompareKey] === rc.key
                                                  ? { ...s, [analyticsCompareKey]: 'none' }
                                                  : s,
                                              );
                                            }
                                          }}
                                          style={{
                                            paddingHorizontal: 11, paddingVertical: 5,
                                            borderRadius: 999,
                                            borderWidth: 1,
                                            borderColor: active ? group.color : p.border,
                                            backgroundColor: active ? group.color + '22' : p.surfaceHi,
                                          }}
                                        >
                                          <Text style={{ fontSize: 10, fontWeight: active ? '700' : '600', color: active ? group.color : p.textMuted }}>{rc.label}</Text>
                                        </TouchableOpacity>
                                      );
                                    })}
                                  </ScrollView>
                                )}

                                {/* Analytics-only "Compare to" row — second optional
                                    range that, when active, makes the PDF render
                                    side-by-side KPI columns + paired status bars. */}
                                {analyticsCompareKey && (
                                  <View style={{ marginTop: 8 }}>
                                    <Text style={{ fontSize: 10, color: p.textFaint, fontWeight: '700', letterSpacing: 0.5, textTransform: 'uppercase', textAlign: isRTL ? 'right' : 'left' }}>
                                      {lang === 'ar' ? 'قارن مع' : 'Compare to'}
                                    </Text>
                                    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, paddingTop: 6 }}>
                                      {([{ key: 'none' as CompareRangeKey, label: lang === 'ar' ? 'بدون' : 'Off' }, ...rangeChips.map(rc => ({ key: rc.key as CompareRangeKey, label: rc.label }))]).map((rc) => {
                                        const active = currentCompare === rc.key;
                                        const sameAsPrimary = rc.key !== 'none' && rc.key === currentRange;
                                        return (
                                          <TouchableOpacity
                                            key={String(rc.key)}
                                            disabled={sameAsPrimary}
                                            onPress={() => {
                                              haptic.tap();
                                              setAnalyticsCompareRange((s) => ({ ...s, [analyticsCompareKey]: rc.key }));
                                            }}
                                            style={{
                                              paddingHorizontal: 11, paddingVertical: 5,
                                              borderRadius: 999,
                                              borderWidth: 1,
                                              borderColor: active ? group.color : p.border,
                                              backgroundColor: active ? group.color + '22' : p.surfaceHi,
                                              opacity: sameAsPrimary ? 0.35 : 1,
                                            }}
                                          >
                                            <Text style={{ fontSize: 10, fontWeight: active ? '700' : '600', color: active ? group.color : p.textMuted }}>{rc.label}</Text>
                                          </TouchableOpacity>
                                        );
                                      })}
                                    </ScrollView>
                                  </View>
                                )}

                                <View style={{ flexDirection: isRTL ? 'row-reverse' : 'row', alignItems: 'center', gap: 8, marginTop: 10 }}>
                                  {showRange ? (
                                    <Text style={{ fontSize: 10, color: p.textFaint, flex: 1, textAlign: isRTL ? 'right' : 'left' }}>
                                      {lang === 'ar'
                                        ? `${liveCount} عنصر في الفترة`
                                        : `${liveCount} ${scope === 'bookings' ? 'bookings' : scope === 'orders' ? 'orders' : 'records'} in range`}
                                    </Text>
                                  ) : <View style={{ flex: 1 }} />}
                                  <TouchableOpacity
                                    disabled={rowDisabled}
                                    onPress={onRunCsv}
                                    accessibilityLabel={lang === 'ar' ? 'تصدير CSV' : 'Export CSV'}
                                    style={{
                                      paddingHorizontal: 12, paddingVertical: 7,
                                      borderRadius: 9,
                                      backgroundColor: 'transparent',
                                      borderWidth: 1,
                                      borderColor: group.color,
                                      flexDirection: isRTL ? 'row-reverse' : 'row',
                                      alignItems: 'center', gap: 5,
                                    }}
                                  >
                                    <Ionicons name="grid-outline" size={12} color={group.color} />
                                    <Text style={{ fontSize: 11, fontWeight: '800', color: group.color, letterSpacing: 0.3 }}>CSV</Text>
                                  </TouchableOpacity>
                                  <TouchableOpacity
                                    disabled={rowDisabled}
                                    onPress={onRun}
                                    accessibilityLabel={lang === 'ar' ? 'تصدير PDF' : 'Export PDF'}
                                    style={{
                                      paddingHorizontal: 14, paddingVertical: 7,
                                      borderRadius: 9,
                                      backgroundColor: group.color,
                                      flexDirection: isRTL ? 'row-reverse' : 'row',
                                      alignItems: 'center', gap: 5,
                                    }}
                                  >
                                    <Ionicons name="document-text-outline" size={12} color="#fff" />
                                    <Text style={{ fontSize: 11, fontWeight: '800', color: '#fff', letterSpacing: 0.3 }}>PDF</Text>
                                  </TouchableOpacity>
                                </View>
                              </View>
                            );
                          })}
                        </View>
                      ))}
                    </View>
                  </ScrollView>

                  {(ordersList.length === 0 && apptsList.length === 0 && !stats) ? (
                    <Text style={[sty.modalHint, { color: p.textFaint, textAlign: 'center', marginTop: 16 }]}>
                      {lang === 'ar' ? 'لا توجد بيانات لطباعتها' : 'Nothing to print yet'}
                    </Text>
                  ) : null}
                </>
              );
            })()}
          </View>
        </View>
      </Modal>

      {/* ── Print Preview Modal ── */}
      <Modal
        visible={!!printPreview}
        animationType="slide"
        transparent
        onRequestClose={() => setPrintPreview(null)}
      >
        <View style={sty.modalOverlay}>
          <BlurView intensity={60} tint="dark" style={StyleSheet.absoluteFill} />
          <View style={[sty.modalSheet, { backgroundColor: p.surface, borderColor: p.goldBorder, maxHeight: '88%', flex: 0 }]}>
            <LinearGradient colors={['rgba(255,215,0,0.07)', 'rgba(0,0,0,0.7)']} style={StyleSheet.absoluteFill} />
            <View style={[sty.modalHandle, { backgroundColor: p.border }]} />

            {/* Header */}
            <View style={[sty.row, isRTL && sty.rowRev, { justifyContent: 'space-between', marginBottom: 12 }]}>
              <View style={[sty.row, isRTL && sty.rowRev, { gap: 10, flex: 1, marginEnd: 10 }]}>
                <View style={{ width: 38, height: 38, borderRadius: 11, backgroundColor: p.goldMuted, alignItems: 'center', justifyContent: 'center' }}>
                  <Ionicons name="eye-outline" size={20} color={p.gold} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[sty.modalTitle, { color: p.gold }]}>
                    {lang === 'ar' ? 'معاينة الطباعة' : 'Print Preview'}
                  </Text>
                  <Text style={[sty.modalSub, { color: p.textMuted }]} numberOfLines={1}>
                    {printPreview?.fileLabel ?? ''}
                  </Text>
                </View>
              </View>
              {/* Header action buttons: Print + Close */}
              <View style={{ flexDirection: isRTL ? 'row-reverse' : 'row', gap: 8, alignItems: 'center' }}>
                <TouchableOpacity
                  onPress={async () => {
                    if (!printPreview) return;
                    haptic.tap();
                    const { html, fileLabel, width } = printPreview;
                    await sharePdf(html, fileLabel, width);
                  }}
                  style={{
                    flexDirection: isRTL ? 'row-reverse' : 'row',
                    alignItems: 'center', gap: 5,
                    paddingHorizontal: 13, paddingVertical: 8,
                    borderRadius: 10, backgroundColor: p.gold,
                  }}
                >
                  <Ionicons name="print-outline" size={16} color="#000" />
                  <Text style={{ fontSize: 12, fontWeight: '800', color: '#000', letterSpacing: 0.2 }}>
                    {lang === 'ar' ? 'طباعة' : 'Print'}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => setPrintPreview(null)}
                  style={[sty.modalClose, { backgroundColor: p.surfaceHi }]}
                >
                  <Ionicons name="close" size={20} color={p.textMuted} />
                </TouchableOpacity>
              </View>
            </View>

            {/* Preview pane — iframe on web, WebView on native */}
            <View style={{ height: 460, borderRadius: 12, overflow: 'hidden', borderWidth: 1, borderColor: p.border, backgroundColor: '#fff', marginBottom: 14 }}>
              {Platform.OS === 'web' ? (
                /* On web, react-native-webview renders an error string.
                   webPreviewRef effect injects a srcdoc iframe into this View. */
                <View ref={webPreviewRef} style={{ flex: 1 }} />
              ) : (
                printPreview ? (
                  <WebView
                    source={{ html: printPreview.html }}
                    style={{ flex: 1 }}
                    scrollEnabled
                    showsVerticalScrollIndicator={false}
                    originWhitelist={['*']}
                    javaScriptEnabled
                    startInLoadingState
                    renderLoading={() => (
                      <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff' }}>
                        <ActivityIndicator color={p.gold} size="large" />
                      </View>
                    )}
                  />
                ) : null
              )}
            </View>

            {/* Bottom action bar */}
            <View style={{ flexDirection: isRTL ? 'row-reverse' : 'row', gap: 10 }}>
              <TouchableOpacity
                onPress={() => setPrintPreview(null)}
                style={{
                  flex: 1, paddingVertical: 13, borderRadius: 12,
                  backgroundColor: p.surfaceHi, alignItems: 'center', justifyContent: 'center',
                  borderWidth: 1, borderColor: p.border,
                  flexDirection: isRTL ? 'row-reverse' : 'row', gap: 6,
                }}
              >
                <Ionicons name="close-outline" size={18} color={p.textMuted} />
                <Text style={{ fontSize: 13, fontWeight: '700', color: p.textMuted }}>
                  {lang === 'ar' ? 'إغلاق' : 'Close'}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={async () => {
                  if (!printPreview) return;
                  haptic.tap();
                  const { html, fileLabel, width } = printPreview;
                  await saveToDevice(html, fileLabel, width);
                }}
                style={{
                  flex: 1, paddingVertical: 13, borderRadius: 12,
                  backgroundColor: p.surfaceHi, alignItems: 'center', justifyContent: 'center',
                  borderWidth: 1, borderColor: p.goldBorder,
                  flexDirection: isRTL ? 'row-reverse' : 'row', gap: 6,
                }}
              >
                <Ionicons name="download-outline" size={18} color={p.gold} />
                <Text style={{ fontSize: 13, fontWeight: '700', color: p.gold }}>
                  {lang === 'ar' ? 'حفظ' : 'Save'}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={async () => {
                  if (!printPreview) return;
                  haptic.tap();
                  const { html, fileLabel, width } = printPreview;
                  setPrintPreview(null);
                  await sharePdf(html, fileLabel, width);
                }}
                style={{
                  flex: 2, paddingVertical: 13, borderRadius: 12,
                  backgroundColor: p.gold, alignItems: 'center', justifyContent: 'center',
                  flexDirection: isRTL ? 'row-reverse' : 'row', gap: 6,
                }}
              >
                <Ionicons name="print-outline" size={18} color="#000" />
                <Text style={{ fontSize: 13, fontWeight: '800', color: '#000', letterSpacing: 0.3 }}>
                  {lang === 'ar' ? 'طباعة / مشاركة' : 'Print / Share'}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* ── Per-row Thermal Print Chooser ── */}
      <Modal
        visible={!!thermalOrder}
        animationType="fade"
        transparent
        onRequestClose={() => setThermalOrder(null)}
        onDismiss={() => setThermalOrder(null)}
      >
        <View style={sty.modalOverlay}>
          <BlurView intensity={50} tint="dark" style={StyleSheet.absoluteFill} />
          <View style={[sty.modalSheet, { backgroundColor: p.surface, borderColor: p.goldBorder, maxHeight: '60%' }]}>
            <LinearGradient colors={['rgba(255,215,0,0.06)', 'rgba(0,0,0,0.6)']} style={StyleSheet.absoluteFill} />
            <View style={[sty.modalHandle, { backgroundColor: p.border }]} />

            <View style={[sty.row, isRTL && sty.rowRev, { justifyContent: 'space-between', marginBottom: 14 }]}>
              <View style={[sty.row, isRTL && sty.rowRev, { gap: 10 }]}>
                <View style={{ width: 38, height: 38, borderRadius: 11, backgroundColor: p.goldMuted, alignItems: 'center', justifyContent: 'center' }}>
                  <Ionicons name="print-outline" size={20} color={p.gold} />
                </View>
                <View>
                  <Text style={[sty.modalTitle, { color: p.gold }]}>
                    {lang === 'ar' ? 'طباعة حرارية' : 'Thermal Print'}
                  </Text>
                  <Text style={[sty.modalSub, { color: p.textMuted }]} numberOfLines={1}>
                    {thermalOrder?.restaurant_order_number
                      ? `R-${thermalOrder.restaurant_order_number}`
                      : `#${thermalOrder?.order_number || thermalOrder?.id?.slice(0, 8)}`}
                  </Text>
                </View>
              </View>
              <TouchableOpacity onPress={() => setThermalOrder(null)} style={[sty.modalClose, { backgroundColor: p.surfaceHi }]}>
                <Ionicons name="close" size={20} color={p.textMuted} />
              </TouchableOpacity>
            </View>

            <Text style={[sty.modalHint, { color: p.textMuted, marginBottom: 10 }]}>
              {lang === 'ar' ? 'اختر صيغة الإخراج لكل قسم' : 'Pick a format for each section'}
            </Text>

            {/* Receipt language toggle */}
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 14 }}>
              <Text style={{ fontSize: 11, color: p.textFaint, flex: 1, textAlign: isRTL ? 'right' : 'left' }}>
                {lang === 'ar' ? 'لغة الإيصال:' : 'Receipt language:'}
              </Text>
              <View style={{ flexDirection: 'row', borderRadius: 8, overflow: 'hidden', borderWidth: 1, borderColor: p.border }}>
                {(['ar', 'en'] as const).map((l) => (
                  <TouchableOpacity
                    key={l}
                    onPress={() => { haptic.tap(); setPrintLang(l); setReceiptLanguage(l); }}
                    style={{
                      paddingHorizontal: 14, paddingVertical: 6,
                      backgroundColor: printLang === l ? p.gold : p.surfaceHi,
                    }}
                  >
                    <Text style={{ fontSize: 12, fontWeight: '700', color: printLang === l ? '#000' : p.textMuted }}>
                      {l === 'ar' ? 'AR' : 'EN'}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            {/* 2×2 grid: Dish Info (Thermal / PDF), Nutrition (Thermal / PDF) */}
            {(() => {
              const tiles: {
                key: string; mode: 'info' | 'nutrition'; format: 'thermal' | 'pdf';
                label: string; sub: string; icon: string; color: string;
              }[] = [
                { key: 'info-th',  mode: 'info',      format: 'thermal',
                  icon: 'print', color: p.gold,
                  label: lang === 'ar' ? 'معلومات الأطباق · حراري' : 'Dish Info · Thermal',
                  sub:   lang === 'ar' ? 'إيصال 80مم' : '80mm receipt' },
                { key: 'info-pdf', mode: 'info',      format: 'pdf',
                  icon: 'document-text-outline', color: (p as any).accent ?? C.cyan,
                  label: lang === 'ar' ? 'معلومات الأطباق · PDF' : 'Dish Info · PDF',
                  sub:   lang === 'ar' ? 'تقرير A4 أنيق' : 'Modern A4 report' },
                { key: 'nut-th',   mode: 'nutrition', format: 'thermal',
                  icon: 'print', color: C.cyan,
                  label: lang === 'ar' ? 'القيم الغذائية · حراري' : 'Nutrition · Thermal',
                  sub:   lang === 'ar' ? 'إيصال 80مم' : '80mm receipt' },
                { key: 'nut-pdf',  mode: 'nutrition', format: 'pdf',
                  icon: 'document-text-outline', color: C.green,
                  label: lang === 'ar' ? 'القيم الغذائية · PDF' : 'Nutrition · PDF',
                  sub:   lang === 'ar' ? 'تقرير A4 أنيق' : 'Modern A4 report' },
              ];
              return (
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
                  {tiles.map((t) => (
                    <TouchableOpacity
                      key={t.key}
                      onPress={() => {
                        haptic.tap();
                        const o = thermalOrder;
                        if (!o) return;
                        // For thermal: pass cleanup so modal closes in finally after print.
                        // For PDF: close immediately (sharePdf opens its own share sheet).
                        if (t.format === 'thermal') {
                          handlePrintThermal(o, t.mode, () => setThermalOrder(null), printLang);
                        } else {
                          setThermalOrder(null);
                          handlePrintRowPdf(o, t.mode);
                        }
                      }}
                      style={{
                        width: '48%',
                        paddingVertical: 16, paddingHorizontal: 12,
                        borderRadius: 14,
                        alignItems: 'center', justifyContent: 'center', gap: 6,
                        backgroundColor: t.color + '1F',
                        borderWidth: 1, borderColor: t.color + '55',
                      }}
                    >
                      <Ionicons name={t.icon as any} size={24} color={t.color} />
                      <Text style={{ fontSize: 12, fontWeight: '700', color: t.color, textAlign: 'center' }}>
                        {t.label}
                      </Text>
                      <Text style={{ fontSize: 10, color: p.textMuted, textAlign: 'center' }}>
                        {t.sub}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              );
            })()}
          </View>
        </View>
      </Modal>
      <StockChartSheet product={stockChartProduct} onClose={() => setStockChartProduct(null)} />
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Styles
// ─────────────────────────────────────────────────────────────────────────────
const CARD_W = 152;

const sty = StyleSheet.create({
  root:           { flex: 1, backgroundColor: C.bg },
  glowOrb:        { position: 'absolute' },

  // Header
  header:         { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingBottom: 16 },
  backBtn:        { borderRadius: 14, overflow: 'hidden' },
  backBtnBlur:    { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle:    { fontSize: 20, fontWeight: '800', color: C.text, letterSpacing: -0.3 },
  headerSub:      { fontSize: 12, color: C.textMuted, marginTop: 2 },
  manageBtn:      { borderRadius: 14, overflow: 'hidden' },
  manageBtnBlur:  { width: 40, height: 40, alignItems: 'center', justifyContent: 'center',
                    borderWidth: 1, borderColor: C.goldBorder },
  bellBadge:      { position: 'absolute', top: 2, right: 2, minWidth: 16, height: 16,
                    borderRadius: 8, backgroundColor: '#EF4444', alignItems: 'center',
                    justifyContent: 'center', paddingHorizontal: 4 },
  bellBadgeText:  { color: '#FFF', fontSize: 9, fontWeight: '800' },

  // Strip
  stripSection:   { paddingHorizontal: 16, marginBottom: 8 },
  stripTitle:     { fontSize: 13, fontWeight: '700', color: C.textMuted, letterSpacing: 1,
                    textTransform: 'uppercase', marginBottom: 12 },
  stripScroll:    { paddingRight: 16, paddingBottom: 8, gap: 10 },
  stripLoading:   { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 20 },
  loadingText:    { color: C.textMuted, fontSize: 14 },

  // Restaurant card
  restaurantCard: {
    width: CARD_W, borderRadius: 18, overflow: 'hidden',
    backgroundColor: C.surface, borderWidth: 1, borderColor: C.border,
    padding: 14, position: 'relative',
  },
  restaurantCardActive: { borderColor: C.goldBorder, borderWidth: 1.5 },
  restaurantImgWrap:    { width: 56, height: 56, borderRadius: 14, overflow: 'hidden', marginBottom: 10, alignSelf: 'center' },
  restaurantImg:        { width: 56, height: 56 },
  restaurantImgFallback:{ width: 56, height: 56, alignItems: 'center', justifyContent: 'center', borderRadius: 14 },
  restaurantImgGlow:    {
    position: 'absolute', inset: 0, borderRadius: 14,
    borderWidth: 1.5, borderColor: C.goldBorder,
  },
  restaurantName:  { fontSize: 13, fontWeight: '700', color: C.text, marginBottom: 2, textAlign: 'center' },
  restaurantBrand: { fontSize: 10, color: C.textFaint, marginBottom: 8, textAlign: 'center' },
  restaurantStats: { flexDirection: 'row', justifyContent: 'center', gap: 6, marginBottom: 6 },
  restaurantStatChip: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    backgroundColor: 'rgba(255,255,255,0.06)', borderRadius: 8, paddingHorizontal: 6, paddingVertical: 3,
  },
  restaurantStatNum:   { fontSize: 10, fontWeight: '700' },
  usersPill:           {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    justifyContent: 'center', marginTop: 2,
  },
  usersPillText:       { fontSize: 9, color: C.textFaint },
  selectedIndicator:   {
    position: 'absolute', bottom: 0, left: '25%', right: '25%',
    height: 3, backgroundColor: C.gold, borderRadius: 2,
  },

  // Hero
  heroSection:   { marginHorizontal: 16, borderRadius: 20, overflow: 'hidden',
                   borderWidth: 1, borderColor: C.goldBorder, padding: 18, marginBottom: 4 },
  heroGrad:      { ...StyleSheet.absoluteFillObject },
  heroName:      { fontSize: 18, fontWeight: '800', color: C.gold, letterSpacing: -0.3, marginBottom: 2 },
  heroBrand:     { fontSize: 12, color: C.textMuted },
  heroPulse:     { width: 8, height: 8, borderRadius: 4, backgroundColor: C.green, marginTop: 4 },
  heroMetricsRow:{ flexDirection: 'row', marginTop: 14, alignItems: 'center' },
  heroMetric:    { flex: 1, alignItems: 'center' },
  heroMetricVal: { fontSize: 20, fontWeight: '800' },
  heroMetricLabel:{ fontSize: 11, color: C.textMuted, marginTop: 2 },
  heroMetricDivider:{ width: 1, height: 36, backgroundColor: C.border },

  // Tab bar
  tabBar:        {
    flexDirection: 'row', marginHorizontal: 16, marginTop: 16, marginBottom: 0,
    borderRadius: 16, overflow: 'hidden', borderWidth: 1, borderColor: C.border,
    position: 'relative',
  },
  tabItem:       { flex: 1, alignItems: 'center', paddingVertical: 12 },
  tabLabel:      { fontSize: 12, fontWeight: '600', color: C.textMuted },
  tabLabelActive:{ color: C.gold },
  tabUnderline:  {
    position: 'absolute', bottom: 0, width: '25%',
    height: 2, backgroundColor: C.gold, borderRadius: 1,
  },
  tabContent:    { paddingHorizontal: 16, paddingTop: 16 },
  tabAlertDot:   {
    position: 'absolute', top: -4, right: -8,
    width: 7, height: 7, borderRadius: 3.5,
    backgroundColor: C.red, borderWidth: 1.5, borderColor: C.bg,
  },

  // Filter chips
  chipScroll:    { paddingBottom: 12, gap: 8, paddingRight: 8 },
  chip:          {
    paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20,
    backgroundColor: C.surface, borderWidth: 1, borderColor: C.border,
  },
  chipActive:    { backgroundColor: C.goldMuted, borderColor: C.goldBorder },
  chipText:      { fontSize: 12, color: C.textMuted, fontWeight: '600' },
  chipTextActive:{ color: C.gold },

  // Lists
  listWrap:      { gap: 10 },
  listCount:     { fontSize: 12, color: C.textMuted },

  // Cards
  card:          {
    borderRadius: 16, overflow: 'hidden', backgroundColor: C.surface,
    borderWidth: 1, borderColor: C.border, padding: 14,
  },
  row:           { flexDirection: 'row', alignItems: 'center', gap: 6 },
  rowRev:        { flexDirection: 'row-reverse' },
  divider:       { height: 1, backgroundColor: C.border, marginVertical: 10 },
  orderNum:      { fontSize: 14, fontWeight: '800', color: C.gold, flex: 1 },
  orderTotal:    { fontSize: 15, fontWeight: '800', color: C.goldBright },
  cardDetail:    { fontSize: 13, color: C.text, flex: 1 },
  cardMeta:      { fontSize: 11, color: C.textMuted },
  badge:         {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 8, paddingVertical: 4, borderRadius: 10, borderWidth: 1,
  },
  badgeText:     { fontSize: 10, fontWeight: '700' },
  apptServiceBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 8, paddingVertical: 4, borderRadius: 10,
    backgroundColor: C.cyanMuted, borderWidth: 1, borderColor: C.cyanBorder,
  },

  // Appointments note
  apptNote:      {
    flexDirection: 'row', alignItems: 'flex-start', gap: 6,
    backgroundColor: C.cyanMuted, borderRadius: 12, padding: 10,
    marginBottom: 12, borderWidth: 1, borderColor: C.cyanBorder,
  },
  apptNoteText:  { fontSize: 11, color: C.textMuted, flex: 1 },

  // Analytics
  metricsGrid:   { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  metricCard:    {
    width: (W - 48) / 2 - 5, borderRadius: 16, overflow: 'hidden',
    backgroundColor: C.surface, borderWidth: 1, padding: 14,
    alignItems: 'center',
  },
  metricGrad:    { ...StyleSheet.absoluteFillObject },
  metricValue:   { fontSize: 22, fontWeight: '900', marginBottom: 2 },
  metricLabel:   { fontSize: 11, color: C.textMuted, textAlign: 'center' },
  metricSub:     { fontSize: 10, color: C.textFaint, marginTop: 2 },
  sectionTitle:  { fontSize: 13, fontWeight: '700', color: C.textMuted,
                   letterSpacing: 0.8, textTransform: 'uppercase', marginBottom: 10 },
  analyticsCard: {
    borderRadius: 16, overflow: 'hidden', backgroundColor: C.surface,
    borderWidth: 1, borderColor: C.border, padding: 16, gap: 14,
  },
  sparklineCard: {
    borderRadius: 16, overflow: 'hidden', borderWidth: 1,
    padding: 14, marginTop: 10,
  },
  sparklineTitle:  { fontSize: 11, fontWeight: '700', letterSpacing: 0.5, textTransform: 'uppercase' },
  sparklineDot:    { width: 7, height: 7, borderRadius: 3.5, marginEnd: 4 },
  sparklineLegend: { fontSize: 10 },
  sparklineXLabel: { fontSize: 9 },

  statBarRow:    { flexDirection: 'row', alignItems: 'center', gap: 10 },
  statBarLabel:  { fontSize: 12, color: C.textMuted, width: 80, textAlign: 'right' },
  statBarTrack:  { flex: 1, height: 8, backgroundColor: 'rgba(255,255,255,0.06)', borderRadius: 4, overflow: 'hidden' },
  statBarFill:   { height: 8, borderRadius: 4 },
  statBarNum:    { fontSize: 12, fontWeight: '700', width: 32, textAlign: 'right' },
  topProdRow:    { flexDirection: 'row', alignItems: 'center', gap: 10 },
  topProdRank:   { width: 28, height: 28, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  topProdRankNum:{ fontSize: 13, fontWeight: '800' },
  topProdName:   { fontSize: 13, color: C.text, fontWeight: '600' },
  topProdSub:    { fontSize: 11, color: C.textFaint },
  topProdPrice:  { fontSize: 13, fontWeight: '700', color: C.gold },

  // Expandable order detail tabs
  detailTabBar:       {
    flexDirection: 'row', gap: 6, marginTop: 4,
  },
  detailTabItem:      {
    flex: 1, alignItems: 'center', paddingVertical: 7,
    borderRadius: 10, backgroundColor: 'rgba(255,255,255,0.05)',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)',
  },
  detailTabItemActive: {
    backgroundColor: C.goldMuted, borderColor: C.goldBorder,
  },
  detailTabLabel:      { fontSize: 11, fontWeight: '600', color: C.textMuted },
  detailTabLabelActive:{ color: C.gold },

  // Status change pill
  statusPill: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 10, paddingVertical: 6,
    borderRadius: 20, borderWidth: 1,
  },
  statusPillText: { fontSize: 10, fontWeight: '700' },

  // Dish thumbnail in expanded dish list
  dishThumb: { width: 36, height: 36, borderRadius: 8 },

  // Item row inside expanded card
  itemQtyBadge:  {
    width: 24, height: 24, borderRadius: 8,
    backgroundColor: 'rgba(255,215,0,0.15)', alignItems: 'center', justifyContent: 'center',
  },
  itemQtyText:   { fontSize: 11, fontWeight: '800', color: C.gold },
  itemName:      { fontSize: 12, color: C.text, flex: 1, lineHeight: 17 },
  itemPrice:     { fontSize: 12, fontWeight: '700', color: C.goldBright },

  // Empty & loading
  emptyWrap:     { alignItems: 'center', paddingVertical: 48, gap: 12 },
  emptyIconBg:   {
    width: 72, height: 72, borderRadius: 36,
    backgroundColor: C.goldMuted, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: C.goldBorder,
  },
  emptyText:     { fontSize: 14, color: C.textMuted, textAlign: 'center', maxWidth: 240 },
  centerLoad:    { alignItems: 'center', paddingVertical: 40 },

  // Ratings tab
  ratingsStatCard: {
    flexDirection: 'row', alignItems: 'center', borderRadius: 16, borderWidth: 1,
    padding: 16, marginBottom: 12, gap: 16,
  },
  ratingsStatLeft:  { alignItems: 'center', gap: 4 },
  ratingsStatAvg:   { fontSize: 28, fontWeight: '900' },
  ratingsStatDivider: { width: 1, height: 40 },
  ratingsStatRight: { alignItems: 'center', gap: 2 },
  ratingsStatTotal: { fontSize: 22, fontWeight: '800' },
  ratingsStatLabel: { fontSize: 12 },
  ratingCard: {
    borderRadius: 14, borderWidth: 1, padding: 14, marginBottom: 10, gap: 10,
  },
  ratingAvatar: {
    width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center',
  },
  ratingUser:        { fontSize: 14, fontWeight: '700' },
  ratingMeta:        { fontSize: 11 },
  ratingComment:     { fontSize: 13, lineHeight: 18 },
  ratingReplyBox:    { borderRadius: 8, borderWidth: 1, padding: 10, gap: 2 },
  ratingReplyLabel:  { fontSize: 12, fontWeight: '700' },
  ratingReplyText:   { fontSize: 13, lineHeight: 18 },
  ratingReplyBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start',
    paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20, borderWidth: 1,
  },
  ratingReplyBtnText: { fontSize: 13, fontWeight: '600' },
  ratingReplyPreview: {
    borderRadius: 10, borderWidth: 1, padding: 10, marginBottom: 12,
  },
  replyInput: {
    borderRadius: 12, borderWidth: 1, padding: 12, fontSize: 14,
    minHeight: 100, marginBottom: 6,
  },
  replySubmitBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    paddingVertical: 14, borderRadius: 14,
  },
  replySubmitBtnText: { fontSize: 16, fontWeight: '700', color: '#fff' },

  // Modal
  modalOverlay:  { flex: 1, justifyContent: 'flex-end' },
  modalSheet:    {
    borderTopLeftRadius: 28, borderTopRightRadius: 28, overflow: 'hidden',
    backgroundColor: '#0F0F1A', borderWidth: 1,
    borderColor: C.goldBorder, padding: 24, paddingBottom: 40,
    minHeight: 400,
  },
  modalHandle:   { width: 40, height: 4, backgroundColor: C.border, borderRadius: 2, alignSelf: 'center', marginBottom: 20 },
  modalTitle:    { fontSize: 18, fontWeight: '800', color: C.gold },
  modalSub:      { fontSize: 12, color: C.textMuted, marginTop: 2 },
  modalClose:    {
    width: 36, height: 36, borderRadius: 18, backgroundColor: C.surface,
    alignItems: 'center', justifyContent: 'center',
  },
  modalHint:     { fontSize: 12, color: C.textFaint, lineHeight: 18 },
  userRow:       {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: C.surface, borderRadius: 14, padding: 12,
    borderWidth: 1, borderColor: C.border,
  },
  userAvatar:    {
    width: 40, height: 40, borderRadius: 20, backgroundColor: C.goldMuted,
    alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
  },
  userAvatarImg: { width: 40, height: 40 },
  userName:      { fontSize: 14, fontWeight: '700', color: C.text },
  userEmail:     { fontSize: 12, color: C.textMuted },
  removeBtn:     { padding: 8 },
  addUserRow:    { flexDirection: 'row', gap: 8 },
  emailInput:    {
    flex: 1, backgroundColor: C.surface, borderRadius: 14, paddingHorizontal: 14,
    paddingVertical: 12, color: C.text, fontSize: 14, borderWidth: 1, borderColor: C.border,
  },
  addBtn:        {
    width: 48, height: 48, borderRadius: 14, backgroundColor: C.gold,
    alignItems: 'center', justifyContent: 'center',
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// Export with AccessGuard (owner role; restaurant users reach it via URL)
// ─────────────────────────────────────────────────────────────────────────────
/* __ACCESS_GUARD_APPLIED__ */
export default function RestaurantAnalyticsGuarded(props: any) {
  return (
    <__AccessGuard__ scope="owner">
      <RestaurantAnalyticsScreen {...props} />
    </__AccessGuard__>
  );
}
