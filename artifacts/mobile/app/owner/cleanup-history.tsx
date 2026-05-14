/**
 * Cleanup History Screen — Owner Panel
 * Shows a table of housekeeping runs: when each job ran, which table was pruned, and how many rows were deleted.
 * Supports filtering by date range (CalendarPicker) and table name (chip strip).
 */
import React, { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  Modal,
  Platform,
} from 'react-native';
import Svg, { Rect, Text as SvgText, Line } from 'react-native-svg';
import { LinearGradient } from 'expo-linear-gradient';
import { BlurView } from 'expo-blur';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useAppStore } from '../../src/store/appStore';
import {
  useGetHousekeepingStats,
  getGetHousekeepingStatsQueryKey,
  useGetHousekeepingStatsByTable,
  getGetHousekeepingStatsByTableQueryKey,
} from '@workspace/api-client-react';
import type { HousekeepingStat, HousekeepingByTableRow } from '@workspace/api-client-react';
import { AccessGuard as __AccessGuard__ } from '../../src/components/AccessGuard';

// ─── Date helpers ──────────────────────────────────────────────────────────────

function startOfDay(d: Date) { const r = new Date(d); r.setHours(0, 0, 0, 0); return r; }
function endOfDay(d: Date)   { const r = new Date(d); r.setHours(23, 59, 59, 999); return r; }
function sameDay(a: Date, b: Date) { return a.toDateString() === b.toDateString(); }
function inRange(d: Date, start: Date, end: Date) { return d >= start && d <= end; }

const MONTHS_AR = ['يناير','فبراير','مارس','أبريل','مايو','يونيو','يوليو','أغسطس','سبتمبر','أكتوبر','نوفمبر','ديسمبر'];
const MONTHS_EN = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const DAYS_AR = ['أح','إث','ثل','أر','خم','جم','سب'];
const DAYS_EN = ['Su','Mo','Tu','We','Th','Fr','Sa'];

// ─── CalendarPicker ────────────────────────────────────────────────────────────

function CalendarPicker({
  visible,
  isRTL,
  onClose,
  onConfirm,
  initialStart,
  initialEnd,
}: {
  visible: boolean;
  isRTL: boolean;
  onClose: () => void;
  onConfirm: (start: Date | null, end: Date | null) => void;
  initialStart: Date | null;
  initialEnd: Date | null;
}) {
  const today = new Date();
  const [viewYear, setViewYear]     = useState(today.getFullYear());
  const [viewMonth, setViewMonth]   = useState(today.getMonth());
  const [start, setStart]           = useState<Date | null>(initialStart);
  const [end, setEnd]               = useState<Date | null>(initialEnd);
  const [pickingEnd, setPickingEnd] = useState(false);

  useEffect(() => {
    if (visible) {
      const base = initialStart ?? new Date();
      setStart(initialStart);
      setEnd(initialEnd);
      setPickingEnd(false);
      setViewYear(base.getFullYear());
      setViewMonth(base.getMonth());
    }
  }, [visible]);

  const daysInGrid = useMemo(() => {
    const firstDay = new Date(viewYear, viewMonth, 1).getDay();
    const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
    const grid: (Date | null)[] = Array(firstDay).fill(null);
    for (let d = 1; d <= daysInMonth; d++) grid.push(new Date(viewYear, viewMonth, d));
    while (grid.length % 7 !== 0) grid.push(null);
    return grid;
  }, [viewYear, viewMonth]);

  const handleDay = (day: Date) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (!start || (!pickingEnd && end !== null)) {
      setStart(startOfDay(day)); setEnd(null); setPickingEnd(true);
    } else if (pickingEnd) {
      if (day < start) { setStart(startOfDay(day)); setEnd(null); }
      else { setEnd(endOfDay(day)); setPickingEnd(false); }
    } else {
      setStart(startOfDay(day)); setEnd(null); setPickingEnd(true);
    }
  };

  const setPreset = (preset: 'today' | 'week' | 'month') => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const now = new Date();
    if (preset === 'today') {
      setStart(startOfDay(now)); setEnd(endOfDay(now));
    } else if (preset === 'week') {
      const s = new Date(now); s.setDate(now.getDate() - now.getDay());
      setStart(startOfDay(s)); setEnd(endOfDay(now));
    } else {
      setStart(new Date(now.getFullYear(), now.getMonth(), 1)); setEnd(endOfDay(now));
    }
    setPickingEnd(false);
    setViewYear(now.getFullYear()); setViewMonth(now.getMonth());
  };

  const handleConfirm = () => {
    onConfirm(start, start ? (end ?? endOfDay(start)) : null);
    onClose();
  };

  return (
    <Modal transparent visible={visible} animationType="fade" onRequestClose={onClose}>
      <TouchableOpacity style={cal.backdrop} activeOpacity={1} onPress={onClose}>
        <BlurView intensity={30} tint="dark" style={StyleSheet.absoluteFill} />
      </TouchableOpacity>
      <View style={cal.sheet}>
        <View style={cal.header}>
          <Text style={cal.title}>{isRTL ? 'تصفية بالتاريخ' : 'Filter by Date'}</Text>
          <TouchableOpacity onPress={onClose} style={cal.closeBtn}>
            <Ionicons name="close" size={20} color="#6B7280" />
          </TouchableOpacity>
        </View>

        <View style={cal.presets}>
          {[
            { key: 'today', ar: 'اليوم',       en: 'Today' },
            { key: 'week',  ar: 'هذا الأسبوع', en: 'This Week' },
            { key: 'month', ar: 'هذا الشهر',   en: 'This Month' },
          ].map(p => (
            <TouchableOpacity key={p.key} style={cal.preset} onPress={() => setPreset(p.key as any)}>
              <Text style={cal.presetText}>{isRTL ? p.ar : p.en}</Text>
            </TouchableOpacity>
          ))}
          <TouchableOpacity style={[cal.preset, { backgroundColor: '#FEE2E2' }]}
            onPress={() => { setStart(null); setEnd(null); setPickingEnd(false); }}>
            <Text style={[cal.presetText, { color: '#EF4444' }]}>{isRTL ? 'مسح' : 'Clear'}</Text>
          </TouchableOpacity>
        </View>

        <View style={cal.monthNav}>
          <TouchableOpacity style={cal.navBtn} onPress={() => {
            if (viewMonth === 0) { setViewMonth(11); setViewYear(y => y - 1); }
            else setViewMonth(m => m - 1);
          }}>
            <Ionicons name="chevron-back" size={18} color="#374151" />
          </TouchableOpacity>
          <Text style={cal.monthLabel}>
            {isRTL ? MONTHS_AR[viewMonth] : MONTHS_EN[viewMonth]} {viewYear}
          </Text>
          <TouchableOpacity style={cal.navBtn} onPress={() => {
            if (viewMonth === 11) { setViewMonth(0); setViewYear(y => y + 1); }
            else setViewMonth(m => m + 1);
          }}>
            <Ionicons name="chevron-forward" size={18} color="#374151" />
          </TouchableOpacity>
        </View>

        <View style={cal.weekRow}>
          {(isRTL ? DAYS_AR : DAYS_EN).map((d, i) => (
            <Text key={i} style={cal.weekDay}>{d}</Text>
          ))}
        </View>

        <View style={cal.grid}>
          {daysInGrid.map((day, idx) => {
            if (!day) return <View key={`e-${idx}`} style={cal.cell} />;
            const isSt  = !!(start && sameDay(day, start));
            const isEn  = !!(end && sameDay(day, end));
            const isMid = !!(start && end && inRange(day, start, end) && !isSt && !isEn);
            const isToday = sameDay(day, today);
            const sel = isSt || isEn;
            return (
              <TouchableOpacity key={day.toISOString()} style={[cal.cell, isMid && cal.cellMid, sel && cal.cellSel]}
                onPress={() => handleDay(day)} activeOpacity={0.7}>
                <View style={[cal.inner, sel && cal.innerSel]}>
                  <Text style={[cal.dayTxt, isToday && cal.todayTxt, sel && cal.selTxt, isMid && cal.midTxt]}>
                    {day.getDate()}
                  </Text>
                  {isToday && !sel && <View style={cal.dot} />}
                </View>
              </TouchableOpacity>
            );
          })}
        </View>

        {start && (
          <Text style={cal.rangeLabel}>
            {start.toLocaleDateString(isRTL ? 'ar-EG' : 'en-US', { day: 'numeric', month: 'short' })}
            {' → '}
            {end
              ? end.toLocaleDateString(isRTL ? 'ar-EG' : 'en-US', { day: 'numeric', month: 'short' })
              : (isRTL ? 'اختر نهاية' : 'pick end')}
          </Text>
        )}

        <View style={cal.actions}>
          <TouchableOpacity style={cal.cancelBtn} onPress={onClose}>
            <Text style={cal.cancelTxt}>{isRTL ? 'إلغاء' : 'Cancel'}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={cal.confirmBtn} onPress={handleConfirm}>
            <LinearGradient colors={['#6366F1', '#8B5CF6']} style={cal.confirmGrad}>
              <Ionicons name="checkmark" size={16} color="#FFF" />
              <Text style={cal.confirmTxt}>{isRTL ? 'تأكيد' : 'Confirm'}</Text>
            </LinearGradient>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

function formatDate(iso: string, isRTL: boolean): string {
  try {
    return new Date(iso).toLocaleString(isRTL ? 'ar-EG' : 'en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

function friendlyTableName(name: string): string {
  return name.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatDateLabel(d: Date, isRTL: boolean): string {
  return d.toLocaleDateString(isRTL ? 'ar-EG' : 'en-US', { day: 'numeric', month: 'short' });
}

// ─── Summary Card ──────────────────────────────────────────────────────────────

function SummaryCard({ stats, isRTL }: { stats: HousekeepingStat[]; isRTL: boolean }) {
  const totalRows = stats.reduce((sum, s) => sum + s.rows_deleted, 0);

  const byTable: Record<string, number> = {};
  for (const s of stats) {
    byTable[s.table_name] = (byTable[s.table_name] ?? 0) + s.rows_deleted;
  }
  const topEntries = Object.entries(byTable)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3);

  return (
    <BlurView intensity={15} tint="light" style={styles.summaryCard}>
      <View style={styles.summaryHeader}>
        <View style={styles.summaryIconWrap}>
          <Ionicons name="stats-chart" size={20} color="#8B5CF6" />
        </View>
        <Text style={styles.summaryTitle}>{isRTL ? 'ملخص الحذف' : 'Deletion Summary'}</Text>
      </View>

      <View style={styles.summaryTotalRow}>
        <Text style={styles.summaryTotalLabel}>{isRTL ? 'إجمالي الصفوف المحذوفة' : 'Total rows deleted'}</Text>
        <View style={styles.summaryTotalBadge}>
          <Text style={styles.summaryTotalValue}>{totalRows.toLocaleString()}</Text>
        </View>
      </View>

      <View style={styles.summaryTotalRow}>
        <Text style={styles.summaryTotalLabel}>{isRTL ? 'عدد عمليات التنظيف' : 'Cleanup runs'}</Text>
        <View style={[styles.summaryTotalBadge, { backgroundColor: 'rgba(16,185,129,0.15)' }]}>
          <Text style={[styles.summaryTotalValue, { color: '#10B981' }]}>{stats.length}</Text>
        </View>
      </View>

      {topEntries.length > 0 && (
        <View style={styles.summaryTopSection}>
          <Text style={styles.summaryTopLabel}>{isRTL ? 'أكثر الجداول حذفًا' : 'Most pruned tables'}</Text>
          {topEntries.map(([tbl, count]) => (
            <View key={tbl} style={styles.summaryTopRow}>
              <View style={styles.summaryTopDot} />
              <Text style={styles.summaryTopTable} numberOfLines={1}>{friendlyTableName(tbl)}</Text>
              <Text style={styles.summaryTopCount}>{count.toLocaleString()}</Text>
            </View>
          ))}
        </View>
      )}
    </BlurView>
  );
}

// ─── Daily Bar Chart ───────────────────────────────────────────────────────────

const CHART_HEIGHT = 120;
const CHART_LABEL_H = 28;
const CHART_TOOLTIP_H = 26;   // reserved space above bars for tooltip
const CHART_BAR_COLOR_HIGH = '#8B5CF6';
const CHART_BAR_COLOR_LOW  = 'rgba(139,92,246,0.45)';
const CHART_BAR_COLOR_SEL  = '#A78BFA';
const AXIS_COLOR = 'rgba(255,255,255,0.15)';
const LABEL_COLOR = 'rgba(196,181,253,0.75)';

function DailyBarChart({
  stats,
  isRTL,
  onDayPress,
  activeDayFilter,
}: {
  stats: HousekeepingStat[];
  isRTL: boolean;
  onDayPress?: (day: string | null) => void;
  activeDayFilter?: string | null;
}) {
  const [chartWidth, setChartWidth] = useState(0);

  // Use the externally-controlled filter as the source of truth for highlighting.
  const selectedDay = activeDayFilter ?? null;

  const dailyTotals = useMemo(() => {
    const map: Record<string, number> = {};
    for (const s of stats) {
      const day = s.run_at.slice(0, 10);
      map[day] = (map[day] ?? 0) + s.rows_deleted;
    }
    const sorted = Object.entries(map).sort((a, b) => a[0].localeCompare(b[0]));
    return isRTL ? sorted.slice().reverse() : sorted;
  }, [stats, isRTL]);

  if (dailyTotals.length === 0) return null;

  const maxVal = Math.max(...dailyTotals.map(([, v]) => v), 1);

  const barAreaH = CHART_HEIGHT - CHART_LABEL_H;
  const n = dailyTotals.length;
  const maxBars = Math.min(n, 30);
  const visibleBars = dailyTotals.slice(isRTL ? 0 : n - maxBars, isRTL ? maxBars : n);
  const barCount = visibleBars.length;
  const slotW = chartWidth / barCount;
  const barW = Math.max(Math.min(slotW * 0.55, 28), 4);
  const hitW = Math.max(slotW * 0.9, barW + 8);  // wider transparent hit area

  const topCount = Math.max(...visibleBars.map(([, v]) => v));

  // Total SVG height = tooltip area + bars + label area + 2px padding
  const svgH = CHART_TOOLTIP_H + CHART_HEIGHT + 2;

  return (
    <View
      style={chartSt.wrap}
      onLayout={(e) => setChartWidth(e.nativeEvent.layout.width)}
    >
      <View style={[chartSt.titleRow, isRTL && chartSt.titleRowRTL]}>
        <Ionicons name="bar-chart-outline" size={14} color="#C4B5FD" />
        <Text style={chartSt.title}>
          {isRTL ? 'الصفوف المحذوفة يومياً' : 'Daily Deleted Rows'}
        </Text>
        <View style={chartSt.badge}>
          <Text style={chartSt.badgeText}>{topCount.toLocaleString()}</Text>
          <Text style={chartSt.badgeSub}> {isRTL ? 'ذروة' : 'peak'}</Text>
        </View>
      </View>

      {chartWidth > 0 && (
        <Svg width={chartWidth} height={svgH}>
          {/* Axis line — shifted down by CHART_TOOLTIP_H */}
          <Line
            x1={0} y1={CHART_TOOLTIP_H + barAreaH}
            x2={chartWidth} y2={CHART_TOOLTIP_H + barAreaH}
            stroke={AXIS_COLOR} strokeWidth={1}
          />

          {visibleBars.map(([day, val], idx) => {
            const barH = Math.max((val / maxVal) * barAreaH, 2);
            const x = idx * slotW + (slotW - barW) / 2;
            const barTop = CHART_TOOLTIP_H + barAreaH - barH;
            const isHigh = val === topCount && topCount > 0;
            const isSel = day === selectedDay;
            const color = isSel ? CHART_BAR_COLOR_SEL : isHigh ? CHART_BAR_COLOR_HIGH : CHART_BAR_COLOR_LOW;

            const d = new Date(day + 'T00:00:00');
            const label = d.toLocaleDateString(isRTL ? 'ar-EG' : 'en-US', { day: 'numeric', month: 'short' });
            const showLabel = barCount <= 14 || idx % Math.ceil(barCount / 10) === 0;

            // Tooltip geometry
            const tipLabel = val.toLocaleString();
            const tipW = Math.max(tipLabel.length * 7 + 10, 36);
            const tipH = 18;
            const tipX = Math.min(Math.max(x + barW / 2 - tipW / 2, 0), chartWidth - tipW);
            const tipY = barTop - tipH - 4;

            return (
              <React.Fragment key={day}>
                {/* Visible bar */}
                <Rect x={x} y={barTop} width={barW} height={barH} rx={3} fill={color} />

                {/* Selected bar ring highlight */}
                {isSel && (
                  <Rect
                    x={x - 1} y={barTop - 1}
                    width={barW + 2} height={barH + 1}
                    rx={4}
                    fill="none"
                    stroke="#DDD6FE"
                    strokeWidth={1.5}
                  />
                )}

                {/* Tooltip above selected bar */}
                {isSel && (
                  <>
                    <Rect
                      x={tipX} y={tipY}
                      width={tipW} height={tipH}
                      rx={5}
                      fill="#4C1D95"
                      stroke="#A78BFA"
                      strokeWidth={1}
                    />
                    <SvgText
                      x={tipX + tipW / 2}
                      y={tipY + tipH - 5}
                      fontSize={10}
                      fontWeight="700"
                      fill="#EDE9FE"
                      textAnchor="middle"
                    >
                      {tipLabel}
                    </SvgText>
                  </>
                )}

                {/* Date label */}
                {showLabel && (
                  <SvgText
                    x={x + barW / 2}
                    y={CHART_TOOLTIP_H + CHART_HEIGHT}
                    fontSize={9}
                    fill={isSel ? '#EDE9FE' : LABEL_COLOR}
                    textAnchor="middle"
                  >
                    {label}
                  </SvgText>
                )}

                {/* Transparent wider hit area covering full bar column */}
                <Rect
                  x={idx * slotW + (slotW - hitW) / 2}
                  y={CHART_TOOLTIP_H}
                  width={hitW}
                  height={barAreaH}
                  fill="transparent"
                  onPress={() => {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    onDayPress?.(isSel ? null : day);
                  }}
                />
              </React.Fragment>
            );
          })}
        </Svg>
      )}
    </View>
  );
}

// ─── Table Row ─────────────────────────────────────────────────────────────────

function StatRow({ stat, isRTL, isEven }: { stat: HousekeepingStat; isRTL: boolean; isEven: boolean }) {
  const deletedColor = stat.rows_deleted === 0 ? '#6B7280' : stat.rows_deleted > 1000 ? '#EF4444' : '#10B981';
  return (
    <View style={[styles.tableRow, isEven && styles.tableRowEven, isRTL && styles.tableRowRTL]}>
      <Text style={[styles.cellDate, isRTL && styles.cellRTL]} numberOfLines={2}>
        {formatDate(stat.run_at, isRTL)}
      </Text>
      <Text style={[styles.cellTable, isRTL && styles.cellRTL]} numberOfLines={2}>
        {friendlyTableName(stat.table_name)}
      </Text>
      <View style={[styles.cellCountWrap, isRTL && styles.cellCountWrapRTL]}>
        <Text style={[styles.cellCount, { color: deletedColor }]}>
          {stat.rows_deleted.toLocaleString()}
        </Text>
      </View>
    </View>
  );
}

// ─── By-Table Breakdown ────────────────────────────────────────────────────────

type BucketType = 'day' | 'week';
type DaysPreset = 7 | 30 | 90;

function formatBucketLabel(dateStr: string, bucket: BucketType, isRTL: boolean): string {
  try {
    const d = new Date(dateStr + 'T00:00:00');
    const formatted = d.toLocaleDateString(isRTL ? 'ar-EG' : 'en-US', { day: 'numeric', month: 'short' });
    if (bucket === 'week') {
      return isRTL ? `أسبوع ${formatted}` : `Week of ${formatted}`;
    }
    return formatted;
  } catch {
    return dateStr;
  }
}

const TABLE_COLORS = ['#8B5CF6', '#6366F1', '#EC4899', '#F59E0B', '#10B981', '#3B82F6'];

function ByTableBreakdown({ isRTL, onRegisterRefetch }: { isRTL: boolean; onRegisterRefetch?: (fn: () => void) => void }) {
  const [bucket, setBucket] = useState<BucketType>('day');
  const [days, setDays] = useState<DaysPreset>(30);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const { data, isLoading, isError, refetch } = useGetHousekeepingStatsByTable(
    { bucket, days },
    { query: { staleTime: 60_000, queryKey: getGetHousekeepingStatsByTableQueryKey({ bucket, days }) } },
  );

  useEffect(() => {
    onRegisterRefetch?.(() => { refetch(); });
  }, [refetch, onRegisterRefetch]);

  const groups = data?.groups ?? [];

  // Group by table_name → compute total and collect date rows
  const byTable: Record<string, { total: number; rows: HousekeepingByTableRow[] }> = {};
  for (const row of groups) {
    if (!byTable[row.table_name]) byTable[row.table_name] = { total: 0, rows: [] };
    byTable[row.table_name].total += row.total_rows;
    byTable[row.table_name].rows.push(row);
  }
  const tableEntries = Object.entries(byTable).sort((a, b) => b[1].total - a[1].total);

  const grandTotal = tableEntries.reduce((s, [, v]) => s + v.total, 0);
  const maxTotal   = tableEntries.length > 0 ? tableEntries[0][1].total : 1;

  const toggleExpanded = (tbl: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(tbl)) next.delete(tbl); else next.add(tbl);
      return next;
    });
  };

  return (
    <View>
      {/* Bucket & days controls */}
      <View style={bts.controls}>
        <View style={bts.segRow}>
          {(['day', 'week'] as BucketType[]).map((b) => (
            <TouchableOpacity
              key={b}
              style={[bts.seg, bucket === b && bts.segActive]}
              onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setBucket(b); }}
            >
              <Text style={[bts.segTxt, bucket === b && bts.segTxtActive]}>
                {b === 'day' ? (isRTL ? 'يومي' : 'Daily') : (isRTL ? 'أسبوعي' : 'Weekly')}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
        <View style={bts.segRow}>
          {([7, 30, 90] as DaysPreset[]).map((d) => (
            <TouchableOpacity
              key={d}
              style={[bts.seg, days === d && bts.segActive]}
              onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setDays(d); }}
            >
              <Text style={[bts.segTxt, days === d && bts.segTxtActive]}>
                {isRTL ? `${d} يوم` : `${d}d`}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {/* Loading */}
      {isLoading && (
        <View style={styles.center}>
          <ActivityIndicator size="large" color="#8B5CF6" />
          <Text style={styles.loadingText}>{isRTL ? 'جارٍ التحميل…' : 'Loading…'}</Text>
        </View>
      )}

      {/* Error */}
      {isError && (
        <BlurView intensity={15} tint="light" style={styles.errorCard}>
          <Ionicons name="alert-circle-outline" size={36} color="#EF4444" />
          <Text style={styles.errorTitle}>{isRTL ? 'تعذّر تحميل البيانات' : 'Failed to load data'}</Text>
          <TouchableOpacity style={styles.retryBtn} onPress={() => refetch()}>
            <Text style={styles.retryTxt}>{isRTL ? 'إعادة المحاولة' : 'Retry'}</Text>
          </TouchableOpacity>
        </BlurView>
      )}

      {/* Empty */}
      {!isLoading && !isError && tableEntries.length === 0 && (
        <BlurView intensity={15} tint="light" style={styles.emptyCard}>
          <Ionicons name="checkmark-done-circle-outline" size={48} color="#10B981" />
          <Text style={styles.emptyTitle}>{isRTL ? 'لا توجد سجلات' : 'No records found'}</Text>
          <Text style={styles.emptySub}>
            {isRTL ? 'لم تُسجَّل أي عمليات تنظيف خلال هذه الفترة.' : 'No cleanup runs recorded in this period.'}
          </Text>
        </BlurView>
      )}

      {/* Grand total banner */}
      {!isLoading && !isError && tableEntries.length > 0 && (
        <BlurView intensity={12} tint="light" style={bts.grandTotal}>
          <Text style={bts.grandTotalLabel}>{isRTL ? 'إجمالي المحذوف' : 'Grand total deleted'}</Text>
          <Text style={bts.grandTotalValue}>{grandTotal.toLocaleString()}</Text>
          <Text style={bts.grandTotalSub}>{isRTL ? `${tableEntries.length} جداول` : `${tableEntries.length} tables`}</Text>
        </BlurView>
      )}

      {/* Per-table cards */}
      {!isLoading && !isError && tableEntries.map(([tbl, { total, rows }], colorIdx) => {
        const color = TABLE_COLORS[colorIdx % TABLE_COLORS.length];
        const barPct = maxTotal > 0 ? total / maxTotal : 0;
        const isExp = expanded.has(tbl);
        return (
          <BlurView key={tbl} intensity={10} tint="light" style={bts.tableCard}>
            <TouchableOpacity style={bts.tableCardHeader} onPress={() => toggleExpanded(tbl)} activeOpacity={0.75}>
              <View style={[bts.tableColorDot, { backgroundColor: color }]} />
              <View style={{ flex: 1 }}>
                <Text style={bts.tableCardName} numberOfLines={1}>{friendlyTableName(tbl)}</Text>
                <View style={bts.barTrack}>
                  <View style={[bts.barFill, { width: `${Math.max(barPct * 100, 2)}%` as `${number}%`, backgroundColor: color }]} />
                </View>
              </View>
              <View style={bts.tableCardRight}>
                <Text style={[bts.tableCardTotal, { color }]}>{total.toLocaleString()}</Text>
                <Text style={bts.tableCardRowsLabel}>{isRTL ? 'صف' : 'rows'}</Text>
              </View>
              <Ionicons name={isExp ? 'chevron-up' : 'chevron-down'} size={16} color="rgba(196,181,253,0.7)" style={{ marginLeft: 6 }} />
            </TouchableOpacity>

            {/* Date sub-rows */}
            {isExp && (
              <View style={bts.dateRows}>
                {rows.map((row) => (
                  <View key={row.date_bucket} style={bts.dateRow}>
                    <Text style={bts.dateBucketLabel}>{formatBucketLabel(row.date_bucket, bucket, isRTL)}</Text>
                    <Text style={[bts.dateRowCount, { color }]}>{row.total_rows.toLocaleString()}</Text>
                  </View>
                ))}
              </View>
            )}
          </BlurView>
        );
      })}
    </View>
  );
}

// ─── Main Screen ───────────────────────────────────────────────────────────────

function CleanupHistoryScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const language = useAppStore((state) => state.language);
  const isRTL = language === 'ar';

  const [viewMode, setViewMode]           = useState<'runs' | 'breakdown'>('runs');
  const [refreshing, setRefreshing]       = useState(false);
  const breakdownRefetchRef               = useRef<(() => void) | null>(null);
  const handleRegisterBreakdownRefetch    = useCallback((fn: () => void) => { breakdownRefetchRef.current = fn; }, []);
  const [showCalendar, setShowCalendar] = useState(false);
  const [startDate, setStartDate]       = useState<Date | null>(null);
  const [endDate, setEndDate]           = useState<Date | null>(null);
  const [tableFilter, setTableFilter]   = useState<string | null>(null);

  const hasDateFilter = !!(startDate || endDate);
  const hasAnyFilter  = hasDateFilter || !!tableFilter;

  const { data, isLoading, isError, refetch } = useGetHousekeepingStats({
    query: { staleTime: 60_000, queryKey: getGetHousekeepingStatsQueryKey() },
  });

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  }, [refetch]);

  const allStats = data?.stats ?? [];

  const uniqueTableNames = useMemo(
    () => Array.from(new Set(allStats.map((s) => s.table_name))).sort(),
    [allStats],
  );

  const filteredStats = useMemo(() => {
    let list = allStats;
    if (tableFilter) {
      list = list.filter((s) => s.table_name === tableFilter);
    }
    if (startDate) {
      list = list.filter((s) => new Date(s.run_at) >= startDate);
    }
    if (endDate) {
      list = list.filter((s) => new Date(s.run_at) <= endDate);
    }
    return list;
  }, [allStats, tableFilter, startDate, endDate]);

  const handleDateConfirm = useCallback((start: Date | null, end: Date | null) => {
    setStartDate(start);
    setEndDate(end);
  }, []);

  const handleDayPress = useCallback((day: string | null) => {
    if (!day) {
      setStartDate(null);
      setEndDate(null);
      return;
    }
    const d = new Date(day + 'T00:00:00');
    setStartDate(startOfDay(d));
    setEndDate(endOfDay(d));
  }, []);

  const clearFilters = useCallback(() => {
    setStartDate(null);
    setEndDate(null);
    setTableFilter(null);
  }, []);

  return (
    <View style={styles.container}>
      <LinearGradient colors={['#1E1B4B', '#312E81', '#4C1D95']} style={StyleSheet.absoluteFill} />

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.scrollContent, { paddingTop: insets.top }]}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor="#8B5CF6"
            colors={['#8B5CF6']}
          />
        }
      >
        {/* Header */}
        <View style={[styles.header, isRTL && styles.headerRTL]}>
          <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
            <Ionicons name={isRTL ? 'arrow-forward' : 'arrow-back'} size={24} color="#FFF" />
          </TouchableOpacity>
          <View style={{ flex: 1 }}>
            <Text style={styles.headerTitle}>
              {isRTL ? 'سجل التنظيف' : 'Cleanup History'}
            </Text>
            <Text style={styles.headerSub}>
              {viewMode === 'runs'
                ? (isRTL ? 'آخر 100 عملية تنظيف دورية' : 'Last 100 housekeeping runs')
                : (isRTL ? 'مجموع الحذف حسب الجدول' : 'Deletion totals by table')}
            </Text>
          </View>
          {viewMode === 'runs' && (
            <TouchableOpacity
              style={[styles.filterBtn, hasDateFilter && styles.filterBtnActive]}
              onPress={() => setShowCalendar(true)}
            >
              <Ionicons
                name="calendar-outline"
                size={20}
                color={hasDateFilter ? '#6366F1' : '#C4B5FD'}
              />
            </TouchableOpacity>
          )}
          <TouchableOpacity
            style={styles.refreshBtn}
            onPress={() => {
              if (viewMode === 'breakdown') {
                breakdownRefetchRef.current?.();
              } else {
                refetch();
              }
            }}
          >
            <Ionicons name="refresh" size={20} color="#C4B5FD" />
          </TouchableOpacity>
        </View>

        {/* View mode tabs */}
        <View style={styles.viewToggle}>
          {([
            { key: 'runs',      arLabel: 'السجلات',    enLabel: 'Runs',       icon: 'list-outline'    },
            { key: 'breakdown', arLabel: 'حسب الجدول', enLabel: 'By Table',   icon: 'bar-chart-outline' },
          ] as const).map(({ key, arLabel, enLabel, icon }) => (
            <TouchableOpacity
              key={key}
              style={[styles.viewTab, viewMode === key && styles.viewTabActive]}
              onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setViewMode(key); }}
              activeOpacity={0.75}
            >
              <Ionicons name={icon} size={15} color={viewMode === key ? '#1E1B4B' : 'rgba(196,181,253,0.85)'} />
              <Text style={[styles.viewTabText, viewMode === key && styles.viewTabTextActive]}>
                {isRTL ? arLabel : enLabel}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* ── RUNS VIEW ── */}
        {viewMode === 'runs' && <>
          {/* Active filter strip */}
          {hasAnyFilter && (
            <View style={[styles.activeFilterStrip, isRTL && styles.activeFilterStripRTL]}>
              <Ionicons name="funnel" size={13} color="#C4B5FD" />
              <Text style={styles.activeFilterText} numberOfLines={1}>
                {[
                  tableFilter ? friendlyTableName(tableFilter) : null,
                  hasDateFilter
                    ? [
                        startDate ? formatDateLabel(startDate, isRTL) : null,
                        endDate   ? formatDateLabel(endDate, isRTL)   : null,
                      ]
                        .filter(Boolean)
                        .join(' → ')
                    : null,
                ]
                  .filter(Boolean)
                  .join('  ·  ')}
              </Text>
              <TouchableOpacity onPress={clearFilters} style={styles.clearFilterBtn} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Ionicons name="close-circle" size={16} color="rgba(196,181,253,0.7)" />
              </TouchableOpacity>
            </View>
          )}

          {/* Table-name chip strip (only shown once data is loaded) */}
          {!isLoading && !isError && uniqueTableNames.length > 1 && (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.chipStripContent}
              style={styles.chipStrip}
            >
              <TouchableOpacity
                style={[styles.tableChip, !tableFilter && styles.tableChipActive]}
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  setTableFilter(null);
                }}
                activeOpacity={0.75}
              >
                <Ionicons name="apps" size={13} color={!tableFilter ? '#1F2937' : 'rgba(255,255,255,0.85)'} />
                <Text style={[styles.tableChipText, !tableFilter && styles.tableChipTextActive]}>
                  {isRTL ? 'الكل' : 'All'}
                </Text>
              </TouchableOpacity>
              {uniqueTableNames.map((tbl) => {
                const active = tableFilter === tbl;
                return (
                  <TouchableOpacity
                    key={tbl}
                    style={[styles.tableChip, active && styles.tableChipActive]}
                    onPress={() => {
                      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                      setTableFilter(active ? null : tbl);
                    }}
                    activeOpacity={0.75}
                  >
                    <Ionicons name="server-outline" size={13} color={active ? '#1F2937' : 'rgba(255,255,255,0.85)'} />
                    <Text style={[styles.tableChipText, active && styles.tableChipTextActive]} numberOfLines={1}>
                      {friendlyTableName(tbl)}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          )}

          {/* Loading */}
          {isLoading && (
            <View style={styles.center}>
              <ActivityIndicator size="large" color="#8B5CF6" />
              <Text style={styles.loadingText}>
                {isRTL ? 'جارٍ التحميل…' : 'Loading…'}
              </Text>
            </View>
          )}

          {/* Error */}
          {isError && (
            <BlurView intensity={15} tint="light" style={styles.errorCard}>
              <Ionicons name="alert-circle-outline" size={40} color="#EF4444" />
              <Text style={styles.errorTitle}>
                {isRTL ? 'تعذّر تحميل البيانات' : 'Failed to load data'}
              </Text>
              <Text style={styles.errorSub}>
                {isRTL ? 'تحقق من صلاحياتك وحاول مجددًا' : 'Check your permissions and try again'}
              </Text>
              <TouchableOpacity style={styles.retryBtn} onPress={() => refetch()}>
                <Text style={styles.retryTxt}>{isRTL ? 'إعادة المحاولة' : 'Retry'}</Text>
              </TouchableOpacity>
            </BlurView>
          )}

          {/* Empty state */}
          {!isLoading && !isError && filteredStats.length === 0 && (
            <BlurView intensity={15} tint="light" style={styles.emptyCard}>
              <Ionicons
                name={allStats.length === 0 ? 'checkmark-done-circle-outline' : 'search-outline'}
                size={48}
                color={allStats.length === 0 ? '#10B981' : 'rgba(196,181,253,0.6)'}
              />
              <Text style={styles.emptyTitle}>
                {allStats.length === 0
                  ? (isRTL ? 'لا توجد سجلات بعد' : 'No cleanup runs yet')
                  : (isRTL ? 'لا توجد نتائج' : 'No results found')}
              </Text>
              <Text style={styles.emptySub}>
                {allStats.length === 0
                  ? (isRTL
                      ? 'ستظهر هنا بيانات التنظيف الدوري عند تشغيل المهام.'
                      : 'Periodic cleanup data will appear here once the jobs have run.')
                  : (isRTL
                      ? 'جرّب نطاقاً زمنياً مختلفاً أو جدولاً آخر.'
                      : 'Try a different date range or table filter.')}
              </Text>
              {hasAnyFilter && (
                <TouchableOpacity style={styles.retryBtn} onPress={clearFilters}>
                  <Text style={styles.retryTxt}>{isRTL ? 'مسح الفلاتر' : 'Clear filters'}</Text>
                </TouchableOpacity>
              )}
            </BlurView>
          )}
        </>}

        {/* ── BY-TABLE BREAKDOWN VIEW ── */}
        {viewMode === 'breakdown' && <ByTableBreakdown isRTL={isRTL} onRegisterRefetch={handleRegisterBreakdownRefetch} />}

        {/* Summary + Table (runs view only) */}
        {viewMode === 'runs' && !isLoading && !isError && filteredStats.length > 0 && (
          <>
            <SummaryCard stats={filteredStats} isRTL={isRTL} />

            <DailyBarChart
              stats={filteredStats}
              isRTL={isRTL}
              onDayPress={handleDayPress}
              activeDayFilter={
                startDate && endDate && startDate.toDateString() === endDate.toDateString()
                  ? `${startDate.getFullYear()}-${String(startDate.getMonth() + 1).padStart(2, '0')}-${String(startDate.getDate()).padStart(2, '0')}`
                  : null
              }
            />

            {/* Column Headers */}
            <BlurView intensity={10} tint="light" style={styles.tableHeaderRow}>
              <Text style={[styles.colHeader, styles.colDate, isRTL && styles.cellRTL]}>
                {isRTL ? 'التاريخ' : 'Date / Time'}
              </Text>
              <Text style={[styles.colHeader, styles.colTable, isRTL && styles.cellRTL]}>
                {isRTL ? 'الجدول' : 'Table'}
              </Text>
              <Text style={[styles.colHeader, styles.colCount, isRTL && styles.cellRTL]}>
                {isRTL ? 'صفوف' : 'Rows'}
              </Text>
            </BlurView>

            {/* Rows */}
            <View style={styles.tableBody}>
              {filteredStats.map((s, idx) => (
                <StatRow key={s.id} stat={s} isRTL={isRTL} isEven={idx % 2 === 1} />
              ))}
            </View>
          </>
        )}

        <View style={{ height: insets.bottom + 40 }} />
      </ScrollView>

      {/* Calendar modal */}
      <CalendarPicker
        visible={showCalendar}
        isRTL={isRTL}
        onClose={() => setShowCalendar(false)}
        onConfirm={handleDateConfirm}
        initialStart={startDate}
        initialEnd={endDate}
      />
    </View>
  );
}

// ─── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1 },
  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: 16 },

  header: { flexDirection: 'row', alignItems: 'center', paddingVertical: 16, gap: 10 },
  headerRTL: { flexDirection: 'row-reverse' },
  backBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.12)', alignItems: 'center', justifyContent: 'center' },
  filterBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(139,92,246,0.2)', alignItems: 'center', justifyContent: 'center' },
  filterBtnActive: { backgroundColor: '#FFF' },
  refreshBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(139,92,246,0.2)', alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 22, fontWeight: '700', color: '#FFF' },
  headerSub: { fontSize: 13, color: 'rgba(196,181,253,0.8)', marginTop: 2 },

  activeFilterStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 7,
    marginBottom: 8,
  },
  activeFilterStripRTL: { flexDirection: 'row-reverse' },
  activeFilterText: { flex: 1, fontSize: 12, fontWeight: '600', color: '#C4B5FD' },
  clearFilterBtn: { padding: 2 },

  chipStrip: { maxHeight: 52, marginBottom: 10 },
  chipStripContent: { gap: 8, paddingVertical: 4 },
  tableChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
    maxWidth: 180,
  },
  tableChipActive: { backgroundColor: '#FDE68A', borderColor: '#D97706' },
  tableChipText: { fontSize: 12, fontWeight: '600', color: 'rgba(255,255,255,0.85)' },
  tableChipTextActive: { color: '#1F2937' },

  center: { alignItems: 'center', justifyContent: 'center', paddingVertical: 60, gap: 12 },
  loadingText: { color: 'rgba(255,255,255,0.6)', fontSize: 14 },

  errorCard: { borderRadius: 16, overflow: 'hidden', backgroundColor: 'rgba(239,68,68,0.08)', padding: 24, alignItems: 'center', gap: 8, marginTop: 24 },
  errorTitle: { fontSize: 18, fontWeight: '700', color: '#FFF', textAlign: 'center' },
  errorSub: { fontSize: 14, color: 'rgba(255,255,255,0.6)', textAlign: 'center' },
  retryBtn: { marginTop: 8, paddingHorizontal: 20, paddingVertical: 10, borderRadius: 10, backgroundColor: 'rgba(139,92,246,0.3)' },
  retryTxt: { color: '#C4B5FD', fontWeight: '600' },

  emptyCard: { borderRadius: 16, overflow: 'hidden', backgroundColor: 'rgba(16,185,129,0.08)', padding: 32, alignItems: 'center', gap: 8, marginTop: 24 },
  emptyTitle: { fontSize: 18, fontWeight: '700', color: '#FFF', textAlign: 'center' },
  emptySub: { fontSize: 14, color: 'rgba(255,255,255,0.6)', textAlign: 'center', lineHeight: 20 },

  summaryCard: { borderRadius: 16, overflow: 'hidden', backgroundColor: 'rgba(255,255,255,0.08)', padding: 16, marginTop: 8, marginBottom: 16 },
  summaryHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 14 },
  summaryIconWrap: { width: 32, height: 32, borderRadius: 10, backgroundColor: 'rgba(139,92,246,0.2)', alignItems: 'center', justifyContent: 'center' },
  summaryTitle: { fontSize: 15, fontWeight: '700', color: '#FFF' },
  summaryTotalRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  summaryTotalLabel: { fontSize: 14, color: 'rgba(255,255,255,0.7)' },
  summaryTotalBadge: { backgroundColor: 'rgba(139,92,246,0.2)', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 },
  summaryTotalValue: { fontSize: 15, fontWeight: '700', color: '#C4B5FD' },
  summaryTopSection: { marginTop: 12, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.1)', paddingTop: 12 },
  summaryTopLabel: { fontSize: 12, color: 'rgba(255,255,255,0.5)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 },
  summaryTopRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 },
  summaryTopDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#8B5CF6' },
  summaryTopTable: { flex: 1, fontSize: 14, color: 'rgba(255,255,255,0.8)' },
  summaryTopCount: { fontSize: 14, fontWeight: '600', color: '#C4B5FD' },

  tableHeaderRow: {
    flexDirection: 'row',
    borderRadius: 10,
    overflow: 'hidden',
    backgroundColor: 'rgba(139,92,246,0.18)',
    paddingVertical: 10,
    paddingHorizontal: 12,
    marginBottom: 4,
  },
  colHeader: { fontSize: 12, fontWeight: '700', color: '#C4B5FD', textTransform: 'uppercase', letterSpacing: 0.4 },
  colDate: { flex: 2.2 },
  colTable: { flex: 2 },
  colCount: { flex: 1, textAlign: 'right' },

  tableBody: { borderRadius: 12, overflow: 'hidden', marginBottom: 8 },
  tableRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 11,
    paddingHorizontal: 12,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.05)',
  },
  tableRowEven: { backgroundColor: 'rgba(139,92,246,0.07)' },
  tableRowRTL: { flexDirection: 'row-reverse' },
  cellDate: { flex: 2.2, fontSize: 12, color: 'rgba(255,255,255,0.7)', lineHeight: 18 },
  cellTable: { flex: 2, fontSize: 13, color: '#FFF', fontWeight: '500', lineHeight: 18 },
  cellRTL: { textAlign: 'right' },
  cellCountWrap: { flex: 1, alignItems: 'flex-end' },
  cellCountWrapRTL: { alignItems: 'flex-start' },
  cellCount: { fontSize: 14, fontWeight: '700' },

  viewToggle: {
    flexDirection: 'row',
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: 12,
    padding: 3,
    marginBottom: 12,
    gap: 4,
  },
  viewTab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    paddingVertical: 8,
    borderRadius: 10,
  },
  viewTabActive: { backgroundColor: '#FDE68A' },
  viewTabText: { fontSize: 13, fontWeight: '600', color: 'rgba(196,181,253,0.85)' },
  viewTabTextActive: { color: '#1E1B4B' },
});

// ─── By-Table Breakdown Styles ────────────────────────────────────────────────

const bts = StyleSheet.create({
  controls: { gap: 8, marginBottom: 14 },
  segRow: { flexDirection: 'row', gap: 6 },
  seg: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  segActive: { backgroundColor: '#6366F1', borderColor: '#6366F1' },
  segTxt: { fontSize: 12, fontWeight: '600', color: 'rgba(255,255,255,0.75)' },
  segTxtActive: { color: '#FFF' },

  grandTotal: {
    borderRadius: 14,
    overflow: 'hidden',
    backgroundColor: 'rgba(99,102,241,0.12)',
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 16,
    marginBottom: 12,
    gap: 10,
  },
  grandTotalLabel: { flex: 1, fontSize: 13, color: 'rgba(255,255,255,0.7)' },
  grandTotalValue: { fontSize: 20, fontWeight: '800', color: '#C4B5FD' },
  grandTotalSub: { fontSize: 12, color: 'rgba(196,181,253,0.6)' },

  tableCard: {
    borderRadius: 14,
    overflow: 'hidden',
    backgroundColor: 'rgba(255,255,255,0.07)',
    marginBottom: 10,
  },
  tableCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 13,
    paddingHorizontal: 14,
    gap: 10,
  },
  tableColorDot: { width: 10, height: 10, borderRadius: 5 },
  tableCardName: { fontSize: 14, fontWeight: '700', color: '#FFF', marginBottom: 6 },
  barTrack: {
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.1)',
    overflow: 'hidden',
  },
  barFill: { height: 4, borderRadius: 2 },
  tableCardRight: { alignItems: 'flex-end', minWidth: 54 },
  tableCardTotal: { fontSize: 18, fontWeight: '800' },
  tableCardRowsLabel: { fontSize: 10, color: 'rgba(255,255,255,0.45)', marginTop: 1 },

  dateRows: {
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.08)',
    paddingHorizontal: 14,
    paddingBottom: 10,
    paddingTop: 8,
    gap: 6,
  },
  dateRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 3,
  },
  dateBucketLabel: { fontSize: 12, color: 'rgba(255,255,255,0.6)' },
  dateRowCount: { fontSize: 13, fontWeight: '700' },
});

// ─── Daily Bar Chart Styles ────────────────────────────────────────────────────

const chartSt = StyleSheet.create({
  wrap: {
    borderRadius: 14,
    overflow: 'hidden',
    backgroundColor: 'rgba(255,255,255,0.06)',
    padding: 12,
    marginBottom: 14,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 10,
  },
  titleRowRTL: { flexDirection: 'row-reverse' },
  title: {
    flex: 1,
    fontSize: 12,
    fontWeight: '600',
    color: 'rgba(196,181,253,0.85)',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'baseline',
    backgroundColor: 'rgba(139,92,246,0.2)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
  },
  badgeText: { fontSize: 13, fontWeight: '700', color: '#C4B5FD' },
  badgeSub:  { fontSize: 10, color: 'rgba(196,181,253,0.6)' },
});

// ─── Calendar Styles ───────────────────────────────────────────────────────────

const cal = StyleSheet.create({
  backdrop:    { ...StyleSheet.absoluteFillObject, zIndex: 10 },
  sheet: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    backgroundColor: '#FFF',
    borderTopLeftRadius: 28, borderTopRightRadius: 28,
    paddingHorizontal: 20, paddingBottom: Platform.OS === 'web' ? 40 : 32,
    paddingTop: 20, zIndex: 20,
    shadowColor: '#000', shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.15, shadowRadius: 20, elevation: 30,
  },
  header:      { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 },
  title:       { fontSize: 17, fontWeight: '700', color: '#111827' },
  closeBtn:    { width: 30, height: 30, borderRadius: 15, backgroundColor: '#F3F4F6', alignItems: 'center', justifyContent: 'center' },
  presets:     { flexDirection: 'row', gap: 8, marginBottom: 14, flexWrap: 'wrap' },
  preset:      { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20, backgroundColor: '#EEF2FF' },
  presetText:  { fontSize: 12, fontWeight: '600', color: '#6366F1' },
  monthNav:    { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  navBtn:      { width: 34, height: 34, borderRadius: 17, backgroundColor: '#F9FAFB', alignItems: 'center', justifyContent: 'center' },
  monthLabel:  { fontSize: 15, fontWeight: '700', color: '#1F2937' },
  weekRow:     { flexDirection: 'row', marginBottom: 4 },
  weekDay:     { flex: 1, textAlign: 'center', fontSize: 11, fontWeight: '600', color: '#9CA3AF' },
  grid:        { flexDirection: 'row', flexWrap: 'wrap' },
  cell:        { width: `${100/7}%` as any, height: 40, alignItems: 'center', justifyContent: 'center' },
  cellMid:     { backgroundColor: '#EEF2FF' },
  cellSel:     { backgroundColor: '#6366F1' },
  inner:       { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  innerSel:    { backgroundColor: '#6366F1' },
  dayTxt:      { fontSize: 13, color: '#374151' },
  todayTxt:    { fontWeight: '700', color: '#6366F1' },
  selTxt:      { color: '#FFF', fontWeight: '700' },
  midTxt:      { color: '#6366F1' },
  dot:         { width: 4, height: 4, borderRadius: 2, backgroundColor: '#6366F1', marginTop: 1 },
  rangeLabel:  { textAlign: 'center', color: '#6366F1', fontSize: 12, fontWeight: '600', marginTop: 4, marginBottom: 2 },
  actions:     { flexDirection: 'row', gap: 12, marginTop: 16 },
  cancelBtn:   { flex: 1, height: 46, borderRadius: 14, borderWidth: 1, borderColor: '#E5E7EB', alignItems: 'center', justifyContent: 'center' },
  cancelTxt:   { fontSize: 14, fontWeight: '600', color: '#6B7280' },
  confirmBtn:  { flex: 2, borderRadius: 14, overflow: 'hidden' },
  confirmGrad: { height: 46, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  confirmTxt:  { fontSize: 14, fontWeight: '700', color: '#FFF' },
});

/* __ACCESS_GUARD_APPLIED__ */
export default function CleanupHistoryScreenGuarded(props: any) {
  return (
    <__AccessGuard__ scope="owner">
      <CleanupHistoryScreen {...props} />
    </__AccessGuard__>
  );
}
