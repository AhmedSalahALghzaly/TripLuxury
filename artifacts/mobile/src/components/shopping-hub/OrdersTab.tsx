/**
 * OrdersTab - Order history + Booking Strip (2026 design)
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ActivityIndicator,
  Alert,
  RefreshControl,
  TouchableOpacity,
  Modal,
  ScrollView,
  Linking,
} from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withSequence,
  withTiming,
  withSpring,
} from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import { EmptyState } from '../ui/EmptyState';
import { Skeleton } from '../ui/Skeleton';
import { useTheme } from '../../hooks/useTheme';
import { useTranslation } from '../../hooks/useTranslation';
import { NEON_NIGHT_THEME } from '../../store/appStore';
import { TYPE, COLORS } from '../../constants/luxuryTokens';
import { appointmentsApi } from '../../services/api';
import { useWebSocketEvent } from '../../services/websocketService';
import MaintenanceBookingModal from '../chat/MaintenanceBookingModal';
import { useAppStore } from '../../store/appStore';
import type { Order } from '../../hooks/shopping/types';
import { MapsPreviewStrip } from '../MapsPreviewStrip';

const localDateKey = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const ARABIC_MONTHS = [
  'يناير','فبراير','مارس','أبريل','مايو','يونيو',
  'يوليو','أغسطس','سبتمبر','أكتوبر','نوفمبر','ديسمبر',
];
const ENGLISH_MONTHS = [
  'January','February','March','April','May','June',
  'July','August','September','October','November','December',
];
const DAY_LABELS_AR = ['أح','إث','ث','أر','خ','ج','س'];
const DAY_LABELS_EN = ['Su','Mo','Tu','We','Th','Fr','Sa'];
const DAY_LABELS = DAY_LABELS_AR; // kept for legacy callers

interface Appointment {
  id: string;
  appointment_date: string;
  service_type?: string;
  status?: string;
  car_info?: string;
}

interface OrdersTabProps {
  orders: Order[];
  isRTL: boolean;
  canEditOrderStatus: boolean;
  updatingOrderId: string | null;
  onUpdateStatus: (orderId: string, newStatus: string) => void;
  onRefresh?: () => void;
  refreshing?: boolean;
  highlightAppointmentId?: string;
  onHighlightConsumed?: () => void;
  /** When the admin/owner is viewing a specific customer's profile,
   *  this is that customer's user_id — used to highlight their booking
   *  days distinctly in the calendar. */
  highlightCustomerUserId?: string;
  /** True only on the very first fetch when there's no cached data yet. */
  isInitialLoading?: boolean;
  /** True when the logged-in user is viewing their own profile (not an
   *  admin looking at someone else). Enables the personal bookings list
   *  below the calendar, mirroring what admin view shows for customers. */
  isOwnView?: boolean;
}

// Content-shaped skeleton row matching the order card height.
const OrderRowSkeleton: React.FC<{ bg: string; border: string }> = ({ bg, border }) => (
  <View
    style={{
      padding: 16,
      borderRadius: 14,
      borderWidth: 1,
      backgroundColor: bg,
      borderColor: border,
      marginBottom: 12,
    }}
  >
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
      <Skeleton width={120} height={18} borderRadius={6} moodAware={false} />
      <Skeleton width={80} height={22} borderRadius={11} moodAware={false} />
    </View>
    <View style={{ height: 10 }} />
    <Skeleton width="50%" height={14} borderRadius={6} moodAware={false} />
    <View style={{ height: 14 }} />
    <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
      <Skeleton width={90} height={16} borderRadius={6} moodAware={false} />
      <Skeleton width={70} height={20} borderRadius={6} moodAware={false} />
    </View>
  </View>
);

const getStatusInfo = (status: string) => {
  const statusMap: { [key: string]: { label: string; labelAr: string; color: string; icon: string } } = {
    pending:          { label: 'Pending',          labelAr: 'قيد الانتظار',  color: '#f59e0b', icon: 'time-outline' },
    confirmed:        { label: 'Confirmed',         labelAr: 'مؤكد',          color: '#6366f1', icon: 'checkmark-done-outline' },
    preparing:        { label: 'Preparing',         labelAr: 'جاري التحضير', color: '#8b5cf6', icon: 'construct-outline' },
    ready:            { label: 'Ready',             labelAr: 'جاهز',          color: '#06b6d4', icon: 'checkmark-circle-outline' },
    shipped:          { label: 'Shipped',           labelAr: 'تم الشحن',      color: '#3b82f6', icon: 'airplane-outline' },
    out_for_delivery: { label: 'Out for Delivery',  labelAr: 'في الطريق',     color: '#0ea5e9', icon: 'bicycle-outline' },
    delivered:        { label: 'Delivered',         labelAr: 'تم التسليم',    color: '#10b981', icon: 'checkmark-circle' },
    cancelled:        { label: 'Cancelled',         labelAr: 'ملغي',          color: '#ef4444', icon: 'close-circle' },
  };
  return statusMap[status] || statusMap.pending;
};

const StatusActionButton: React.FC<{
  orderId: string;
  status: string;
  label: string;
  labelAr: string;
  icon: string;
  color: string;
  updatingOrderId: string | null;
  language: string;
  onPress: () => void;
}> = ({ orderId, status, label, labelAr, icon, color, updatingOrderId, language, onPress }) => {
  const isLoading = updatingOrderId === `${orderId}_${status}`;
  return (
    <Pressable
      style={[styles.statusActionBtn, { backgroundColor: color }]}
      onPress={onPress}
      disabled={updatingOrderId !== null}
    >
      {isLoading ? (
        <ActivityIndicator size="small" color="#FFF" />
      ) : (
        <>
          <Ionicons name={icon as any} size={12} color="#FFF" />
          <Text style={styles.statusActionText}>{language === 'ar' ? labelAr : label}</Text>
        </>
      )}
    </Pressable>
  );
};

const TIME_SLOT_COUNT = 9; // 09:00 → 17:00

interface AppointmentFull extends Appointment {
  user_id?: string;
  user_name?: string;
  user_email?: string;
  user_phone?: string;
  notes?: string;
  restaurant_id?: string;
  restaurant_name?: string;
  restaurant_name_ar?: string;
  restaurant_latitude?: number | null;
  restaurant_longitude?: number | null;
  duration_minutes?: number;
  created_at?: string;
  rescheduled_from?: string | null;
}

interface HistoryEntry {
  id: string;
  action: 'rescheduled' | 'status_changed' | 'deleted' | string;
  actor_name?: string | null;
  actor_email?: string | null;
  old_values?: Record<string, any> | null;
  new_values?: Record<string, any> | null;
  created_at: string;
}

const formatHistoryDateTime = (iso: string) => {
  try {
    const d = new Date(iso);
    return `${d.toLocaleDateString('ar-EG', { day: 'numeric', month: 'short', year: 'numeric' })} · ${d.toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' })}`;
  } catch {
    return iso;
  }
};

const describeHistoryEntry = (h: HistoryEntry): string => {
  const fmtDate = (v?: string) => {
    if (!v) return '—';
    try {
      const d = new Date(v);
      return `${d.toLocaleDateString('ar-EG', { day: 'numeric', month: 'short' })} ${d.toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' })}`;
    } catch { return String(v); }
  };
  const statusAr = (s?: string) => (s ? (getStatusInfo(s).labelAr || s) : '—');
  if (h.action === 'rescheduled') {
    const oldD = h.old_values?.appointment_date;
    const newD = h.new_values?.appointment_date;
    return `تم تعديل الموعد: ${fmtDate(oldD)} ← ${fmtDate(newD)}`;
  }
  if (h.action === 'status_changed') {
    return `تغيير الحالة: ${statusAr(h.old_values?.status)} ← ${statusAr(h.new_values?.status)}`;
  }
  if (h.action === 'deleted') {
    return `تم حذف الموعد`;
  }
  return h.action;
};

function AppointmentHistorySection({ appointmentId }: { appointmentId: string }) {
  const { colors } = useTheme();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [entries, setEntries] = useState<HistoryEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const toggle = useCallback(async () => {
    const willOpen = !open;
    setOpen(willOpen);
    if (willOpen && entries === null && !loading) {
      setLoading(true);
      setError(null);
      try {
        const res = await appointmentsApi.getHistory(appointmentId);
        const list: HistoryEntry[] = res.data?.history ?? [];
        setEntries(list);
      } catch (e: any) {
        setError('تعذر تحميل السجل');
      } finally {
        setLoading(false);
      }
    }
  }, [open, entries, loading, appointmentId]);

  return (
    <View style={{ marginTop: 6 }}>
      <TouchableOpacity
        onPress={toggle}
        style={strip.historyToggle}
        hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
      >
        <Ionicons name={open ? 'chevron-down' : 'chevron-forward'} size={12} color="#FFD700" />
        <Ionicons name="time-outline" size={13} color="#FFD700" />
        <Text style={strip.historyToggleText}>السجل</Text>
        {entries && entries.length > 0 ? (
          <Text style={[strip.historyToggleText, { opacity: 0.7 }]}>({entries.length})</Text>
        ) : null}
      </TouchableOpacity>
      {open ? (
        <View style={[strip.historyBox, { borderColor: colors.border }]}>
          {loading ? (
            <ActivityIndicator size="small" color="#FFD700" />
          ) : error ? (
            <Text style={[strip.historyEmpty, { color: '#EF4444' }]}>{error}</Text>
          ) : !entries || entries.length === 0 ? (
            <Text style={[strip.historyEmpty, { color: colors.textSecondary }]}>
              لا توجد تغييرات سابقة
            </Text>
          ) : (
            entries.map((h) => (
              <View key={h.id} style={strip.historyRow}>
                <View style={strip.historyDot} />
                <View style={{ flex: 1 }}>
                  <Text style={[strip.historyText, { color: colors.text }]} numberOfLines={2}>
                    {describeHistoryEntry(h)}
                  </Text>
                  <Text style={[strip.historyMeta, { color: colors.textSecondary }]}>
                    {formatHistoryDateTime(h.created_at)}
                    {h.actor_name || h.actor_email
                      ? ` · ${h.actor_name || h.actor_email}`
                      : ''}
                  </Text>
                </View>
              </View>
            ))
          )}
        </View>
      ) : null}
    </View>
  );
}

// ─── Booking Strip ──────────────────────────────────────────────────────────
function BookingStrip({
  onOpenBooking,
  highlightAppointmentId,
  onHighlightConsumed,
  highlightCustomerUserId,
  onCustomerAppointmentsLoaded,
}: {
  onOpenBooking: () => void;
  highlightAppointmentId?: string;
  onHighlightConsumed?: () => void;
  highlightCustomerUserId?: string;
  onCustomerAppointmentsLoaded?: (appts: AppointmentFull[]) => void;
}) {
  const { colors } = useTheme();
  const { language } = useTranslation();
  const userRole = useAppStore((s) => s.userRole);
  const isPrivileged = userRole === 'owner' || userRole === 'admin' || userRole === 'partner';

  const [appointments, setAppointments] = useState<AppointmentFull[]>([]);
  const [bookedTimesMap, setBookedTimesMap] = useState<Map<string, Set<string>>>(new Map());
  const [loading, setLoading] = useState(false);
  const [viewYear, setViewYear] = useState(() => new Date().getFullYear());
  const [viewMonth, setViewMonth] = useState(() => new Date().getMonth());
  const [tooltipVisible, setTooltipVisible] = useState(false);
  const [tooltipDateLabel, setTooltipDateLabel] = useState('');
  const [tooltipAppts, setTooltipAppts] = useState<AppointmentFull[]>([]);
  const [pendingDelete, setPendingDelete] = useState<AppointmentFull | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [rescheduleAppt, setRescheduleAppt] = useState<AppointmentFull | null>(null);
  const [requestingChangeId, setRequestingChangeId] = useState<string | null>(null);
  const router = useRouter();

  // Customer-side handler: opens (or creates) the customer's chat with the
  // store, posts a "request to reschedule or cancel" message, then deep-links
  // to the chat screen so the AI auto-reply can take it from there.
  const handleRequestChange = useCallback(
    async (appt: AppointmentFull) => {
      if (requestingChangeId) return;
      setRequestingChangeId(appt.id);
      try {
        const res = await appointmentsApi.requestChange(appt.id);
        const convId = (res.data as any)?.conversation_id;
        setTooltipVisible(false);
        if (convId) {
          router.push(`/chat?conversationId=${encodeURIComponent(convId)}`);
        } else {
          router.push('/chat');
        }
      } catch (e: any) {
        Alert.alert(
          'تعذّر إرسال الطلب',
          e?.response?.data?.detail || 'حدث خطأ غير متوقع. يرجى المحاولة لاحقاً.',
        );
      } finally {
        setRequestingChangeId(null);
      }
    },
    [requestingChangeId, router],
  );

  // Use refs so loadData stays stable (deps=[]) and never causes
  // BookingStrip to remount when highlightCustomerUserId or the callback changes.
  const highlightCustomerUserIdRef = useRef(highlightCustomerUserId);
  const onCustomerAppointmentsLoadedRef = useRef(onCustomerAppointmentsLoaded);
  useEffect(() => { highlightCustomerUserIdRef.current = highlightCustomerUserId; }, [highlightCustomerUserId]);
  useEffect(() => { onCustomerAppointmentsLoadedRef.current = onCustomerAppointmentsLoaded; }, [onCustomerAppointmentsLoaded]);

  const loadData = useCallback(() => {
    setLoading(true);
    Promise.all([
      appointmentsApi.getAll().then((res) => {
        const data: AppointmentFull[] = Array.isArray(res.data)
          ? res.data
          : (res.data?.appointments ?? res.data?.items ?? []);
        setAppointments(data);
        const uid = highlightCustomerUserIdRef.current;
        const cb = onCustomerAppointmentsLoadedRef.current;
        // Always fire the callback when provided:
        //  • Admin view (uid set)  → filter to that customer's bookings
        //  • Own view (uid absent) → the API already scopes to the
        //    logged-in user, so emit the full list as-is.
        if (cb) {
          cb(uid ? data.filter((a) => (a as any).user_id === uid) : data);
        }
      }),
      appointmentsApi.getSlots().then((res) => {
        const slots: string[] = res.data?.slots ?? [];
        const map = new Map<string, Set<string>>();
        slots.forEach((isoStr: string) => {
          const d = new Date(isoStr);
          const dateKey = localDateKey(d);
          const timeKey = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
          if (!map.has(dateKey)) map.set(dateKey, new Set());
          map.get(dateKey)!.add(timeKey);
        });
        setBookedTimesMap(map);
      }),
    ]).catch(() => {}).finally(() => setLoading(false));
  }, []); // stable — reads props via refs, never causes remount

  useEffect(() => { loadData(); }, [loadData]);

  // Real-time refresh: any appointment change anywhere triggers a reload
  // so admin/owner BookingStrip + the customer's own calendar update
  // instantly without manual pull-to-refresh.
  //
  // CRITICAL — DO NOT REMOVE OR NARROW THIS SUBSCRIPTION.
  // This is the root of the booking-card live-update chain:
  //   1. Server broadcasts appointment_created/updated/deleted to the
  //      affected customer + every privileged user (see appointments.ts
  //      lines ~351, ~438, ~635, ~701).
  //   2. This hook calls loadData() → appointmentsApi.getAll() → emits
  //      the fresh list via onCustomerAppointmentsLoaded.
  //   3. OrdersTab.handleCustomerApptsLoaded does setCustomerAppts(...)
  //      which triggers FlashList's extraData re-render so the modern
  //      bookingCard rows reflect the new status / date / restaurant
  //      instantly in BOTH /cart?tab=orders (own view) and
  //      /admin/customers?customerId=… (admin view).
  // If you ever swap loadData() for a setQueryData() shortcut, ensure
  // it still re-runs the same callback or the booking list will go stale.
  useWebSocketEvent(
    ['appointment_created', 'appointment_updated', 'appointment_deleted'],
    () => { loadData(); },
  );

  const getApptKey = (a: AppointmentFull) => localDateKey(new Date(a.appointment_date));
  const getApptsForDate = (iso: string) => appointments.filter((a) => getApptKey(a) === iso);
  const myAppointmentForDate = (iso: string) => appointments.find((a) => getApptKey(a) === iso);
  const hasCustomerApptForDate = (iso: string) =>
    !!highlightCustomerUserId &&
    appointments.some(
      (a) => getApptKey(a) === iso && (a as any).user_id === highlightCustomerUserId,
    );

  const openDay = useCallback((iso: string, appts: AppointmentFull[]) => {
    if (!appts.length && !bookedTimesMap.get(iso)?.size) return;
    const dateLabel = new Date(`${iso}T12:00:00`).toLocaleDateString('ar-EG', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });
    setTooltipDateLabel(dateLabel);
    setTooltipAppts(appts);
    setTooltipVisible(true);
  }, [bookedTimesMap]);

  // When a highlightAppointmentId is provided (from notification deep-link),
  // jump to that appointment's month and open its detail panel.
  useEffect(() => {
    if (!highlightAppointmentId || !appointments.length) return;
    const target = appointments.find((a) => a.id === highlightAppointmentId);
    if (!target) return;
    const d = new Date(target.appointment_date);
    setViewYear(d.getFullYear());
    setViewMonth(d.getMonth());
    const iso = localDateKey(d);
    const dayAppts = isPrivileged ? getApptsForDate(iso) : [target];
    openDay(iso, dayAppts);
    onHighlightConsumed?.();
  }, [highlightAppointmentId, appointments]); // eslint-disable-line react-hooks/exhaustive-deps

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const firstDay = new Date(viewYear, viewMonth, 1).getDay();

  const cells: { day: number | null; iso: string | null }[] = [];
  for (let i = 0; i < firstDay; i++) cells.push({ day: null, iso: null });
  for (let d = 1; d <= daysInMonth; d++) {
    const iso = `${viewYear}-${String(viewMonth + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    cells.push({ day: d, iso });
  }

  const goNextMonth = () => {
    if (viewMonth === 11) { setViewMonth(0); setViewYear(y => y + 1); }
    else setViewMonth(m => m + 1);
  };
  const goPrevMonth = () => {
    if (viewMonth === 0) { setViewMonth(11); setViewYear(y => y - 1); }
    else setViewMonth(m => m - 1);
  };

  const handleDayPress = (iso: string) => {
    const bookedTimes = bookedTimesMap.get(iso);
    if (!bookedTimes || bookedTimes.size === 0) return;
    if (isPrivileged) {
      // Admin/Owner: show ALL bookings for this day
      openDay(iso, getApptsForDate(iso));
    } else {
      // Customer: only show their own appointment if any
      const mine = myAppointmentForDate(iso);
      openDay(iso, mine ? [mine] : []);
    }
  };

  const performDelete = async () => {
    if (!pendingDelete) return;
    setDeleting(true);
    try {
      await appointmentsApi.delete(pendingDelete.id);
      setPendingDelete(null);
      setTooltipVisible(false);
      loadData();
    } catch {
      // keep modal open; could show an inline error if needed
    } finally {
      setDeleting(false);
    }
  };

  const todayIso = localDateKey(today);

  return (
    <View style={[strip.container, { backgroundColor: colors.card, borderColor: colors.border }]}>
      {/* Strip Header */}
      <View style={strip.header}>
        <TouchableOpacity
          style={[strip.calIconBtn, { backgroundColor: '#FFD70015', borderColor: '#FFD70040' }]}
          onPress={onOpenBooking}
          activeOpacity={0.8}
        >
          <Ionicons name="calendar-outline" size={20} color="#FFD700" />
          <Text style={strip.calIconLabel}>{language === 'ar' ? 'حجز موعد' : 'Book'}</Text>
        </TouchableOpacity>

        <View style={strip.monthNav}>
          <TouchableOpacity onPress={goNextMonth} style={strip.navBtn}>
            <Ionicons name="chevron-forward" size={16} color="#FFD700" />
          </TouchableOpacity>
          <Text style={[strip.monthTitle, { color: colors.text }]}>
            {(language === 'ar' ? ARABIC_MONTHS : ENGLISH_MONTHS)[viewMonth]} {viewYear}
          </Text>
          <TouchableOpacity onPress={goPrevMonth} style={strip.navBtn}>
            <Ionicons name="chevron-back" size={16} color="#FFD700" />
          </TouchableOpacity>
        </View>
      </View>

      {/* Day Headers */}
      <View style={strip.dayRow}>
        {(language === 'ar' ? DAY_LABELS_AR : DAY_LABELS_EN).map((d) => (
          <Text key={d} style={strip.dayLabel}>{d}</Text>
        ))}
      </View>

      {/* Calendar Grid */}
      {loading ? (
        <ActivityIndicator color="#FFD700" style={{ marginVertical: 12 }} />
      ) : (
        <View style={strip.grid}>
          {cells.map((cell, idx) => {
            if (!cell.day || !cell.iso) {
              return <View key={idx} style={strip.emptyCell} />;
            }
            const bookedTimes = bookedTimesMap.get(cell.iso);
            const bookedCount = bookedTimes?.size ?? 0;
            const isPartial = bookedCount > 0 && bookedCount < TIME_SLOT_COUNT;
            const isFull = bookedCount >= TIME_SLOT_COUNT;
            const hasMyAppt = !!myAppointmentForDate(cell.iso);
            const isToday = cell.iso === todayIso;
            const isCustomerDay = hasCustomerApptForDate(cell.iso);
            const canPress = bookedCount > 0 || hasMyAppt;
            return (
              <TouchableOpacity
                key={idx}
                onPress={() => handleDayPress(cell.iso!)}
                activeOpacity={canPress ? 0.7 : 1}
                disabled={!canPress}
              >
                <View style={[
                  strip.dayCell,
                  isToday && !isPartial && !isFull && strip.todayCell,
                  isPartial && strip.partialCell,
                  isFull && strip.bookedCell,
                  isCustomerDay && strip.customerCell,
                ]}>
                  {isFull && <View style={strip.bookedGlow} />}
                  {isCustomerDay && <View style={strip.customerGlow} />}
                  <Text style={[
                    strip.dayNum,
                    isPartial && { color: '#F59E0B', fontWeight: '700' },
                    isFull && { color: '#EF4444', fontWeight: '800' },
                    !isPartial && !isFull && isToday && { color: '#FFD700', fontWeight: '700' },
                    !isPartial && !isFull && !isToday && { color: colors.textSecondary },
                  ]}>
                    {cell.day}
                  </Text>
                  {isPartial && <Text style={[strip.dayBadge, { color: '#F59E0B' }]}>{language === 'ar' ? 'جزئي' : 'Part.'}</Text>}
                  {isFull && <Text style={[strip.dayBadge, { color: '#EF4444' }]}>{language === 'ar' ? 'مكتمل' : 'Full'}</Text>}
                  {hasMyAppt && !isFull && <View style={strip.bookedDot} />}
                </View>
              </TouchableOpacity>
            );
          })}
        </View>
      )}

      {/* Legend */}
      <View style={strip.legend}>
        <View style={[strip.legendDot, { backgroundColor: '#F59E0B' }]} />
        <Text style={[strip.legendText, { color: colors.textSecondary }]}>محجوز جزئياً</Text>
        <View style={[strip.legendDot, { backgroundColor: '#EF4444', marginStart: 10 }]} />
        <Text style={[strip.legendText, { color: colors.textSecondary }]}>مكتمل</Text>
        <View style={[strip.legendDot, { backgroundColor: '#FFD700', marginStart: 10 }]} />
        <Text style={[strip.legendText, { color: colors.textSecondary }]}>موعدي</Text>
      </View>

      {/* Day-detail Modal: lists every appointment for the selected day */}
      <Modal
        visible={tooltipVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setTooltipVisible(false)}
      >
        <Pressable style={strip.overlay} onPress={() => setTooltipVisible(false)}>
          <Pressable
            style={[strip.tooltip, { backgroundColor: colors.card, borderColor: '#FFD70040' }]}
            onPress={(e) => e.stopPropagation()}
          >
            <LinearGradient colors={['#FFD70020', '#FFA50010']} style={strip.tooltipHeader}>
              <Ionicons name="calendar" size={22} color="#FFD700" />
              <View style={{ flex: 1 }}>
                <Text style={[strip.tooltipTitle, { color: colors.text }]}>{tooltipDateLabel}</Text>
                <Text style={[strip.tooltipMeta, { color: colors.textSecondary }]}>
                  {tooltipAppts.length > 0
                    ? `${tooltipAppts.length} ${tooltipAppts.length === 1 ? 'حجز' : 'حجوزات'}`
                    : 'هذا اليوم محجوز'}
                </Text>
              </View>
              <TouchableOpacity onPress={() => setTooltipVisible(false)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Ionicons name="close" size={22} color={colors.textSecondary} />
              </TouchableOpacity>
            </LinearGradient>

            <ScrollView style={{ maxHeight: 380 }} contentContainerStyle={{ padding: 12 }}>
              {tooltipAppts.length === 0 ? (
                <Text style={[strip.tooltipMeta, { color: colors.textSecondary, textAlign: 'center', padding: 16 }]}>
                  لا توجد تفاصيل لعرضها
                </Text>
              ) : (
                tooltipAppts.map((appt) => {
                  const time = new Date(appt.appointment_date).toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' });
                  const tableNum = appt.service_type?.startsWith('table_') ? appt.service_type.replace('table_', '') : null;
                  const serviceLabel = tableNum ? `طاولة ${tableNum}` : (appt.service_type || 'حجز');
                  return (
                    <View key={appt.id} style={[strip.apptCard, { borderColor: colors.border, backgroundColor: colors.background }]}>
                      <View style={strip.apptHeader}>
                        <View style={[strip.timeChip, { backgroundColor: '#FFD70020', borderColor: '#FFD70060' }]}>
                          <Ionicons name="time-outline" size={12} color="#FFD700" />
                          <Text style={[strip.timeChipText, { color: '#FFD700' }]}>{time}</Text>
                        </View>
                        <Text style={[strip.serviceText, { color: colors.text }]}>{serviceLabel}</Text>
                        {isPrivileged && (
                          <>
                            <TouchableOpacity
                              style={strip.rescheduleBtn}
                              onPress={() => {
                                setTooltipVisible(false);
                                setRescheduleAppt(appt);
                              }}
                              hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                            >
                              <Ionicons name="create-outline" size={14} color="#FFD700" />
                              <Text style={strip.rescheduleBtnText}>تعديل الموعد</Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                              style={strip.deleteBtn}
                              onPress={() => setPendingDelete(appt)}
                              hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                            >
                              <Ionicons name="trash-outline" size={18} color="#EF4444" />
                            </TouchableOpacity>
                          </>
                        )}
                        {!isPrivileged && (
                          <TouchableOpacity
                            style={strip.requestChangeBtn}
                            onPress={() => handleRequestChange(appt)}
                            hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                            disabled={requestingChangeId === appt.id}
                            accessibilityLabel="طلب تعديل أو إلغاء الموعد"
                          >
                            {requestingChangeId === appt.id ? (
                              <ActivityIndicator size="small" color="#22D3EE" />
                            ) : (
                              <>
                                <Ionicons name="chatbubble-ellipses" size={14} color="#22D3EE" />
                                <Text style={strip.requestChangeBtnText}>طلب تعديل/إلغاء</Text>
                              </>
                            )}
                          </TouchableOpacity>
                        )}
                      </View>
                      {isPrivileged && appt.user_name ? (
                        <View style={strip.apptRow}>
                          <Ionicons name="person-outline" size={13} color={colors.textSecondary} />
                          <Text style={[strip.apptRowText, { color: colors.text }]}>{appt.user_name}</Text>
                        </View>
                      ) : null}
                      {isPrivileged && appt.user_phone ? (
                        <View style={strip.apptRow}>
                          <Ionicons name="call-outline" size={13} color={colors.textSecondary} />
                          <Text style={[strip.apptRowText, { color: colors.text }]}>{appt.user_phone}</Text>
                        </View>
                      ) : null}
                      {isPrivileged && appt.user_email ? (
                        <View style={strip.apptRow}>
                          <Ionicons name="mail-outline" size={13} color={colors.textSecondary} />
                          <Text style={[strip.apptRowText, { color: colors.textSecondary }]}>{appt.user_email}</Text>
                        </View>
                      ) : null}
                      {appt.car_info ? (
                        <View style={strip.apptRow}>
                          <Ionicons name="storefront-outline" size={13} color={colors.textSecondary} />
                          <Text style={[strip.apptRowText, { color: colors.text }]}>{appt.car_info}</Text>
                        </View>
                      ) : null}
                      {appt.notes ? (
                        <View style={strip.apptRow}>
                          <Ionicons name="document-text-outline" size={13} color={colors.textSecondary} />
                          <Text style={[strip.apptRowText, { color: colors.textSecondary }]} numberOfLines={3}>{appt.notes}</Text>
                        </View>
                      ) : null}
                      {appt.status ? (
                        <View style={[strip.statusChip, { backgroundColor: (getStatusInfo(appt.status).color) + '22' }]}>
                          <Text style={[strip.statusChipText, { color: getStatusInfo(appt.status).color }]}>
                            {getStatusInfo(appt.status).labelAr}
                          </Text>
                        </View>
                      ) : null}
                      {isPrivileged ? (
                        <AppointmentHistorySection appointmentId={appt.id} />
                      ) : null}
                    </View>
                  );
                })
              )}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Reschedule modal — reuses the booking modal in edit mode */}
      <MaintenanceBookingModal
        visible={!!rescheduleAppt}
        onClose={() => setRescheduleAppt(null)}
        existingAppointment={rescheduleAppt ? {
          id: rescheduleAppt.id,
          appointment_date: rescheduleAppt.appointment_date,
          service_type: rescheduleAppt.service_type,
          car_info: rescheduleAppt.car_info,
          notes: rescheduleAppt.notes,
        } : null}
        onUpdated={() => {
          setRescheduleAppt(null);
          loadData();
        }}
      />

      {/* Custom delete-confirmation modal (works on web + native) */}
      <Modal
        visible={!!pendingDelete}
        transparent
        animationType="fade"
        onRequestClose={() => !deleting && setPendingDelete(null)}
      >
        <Pressable style={strip.overlay} onPress={() => !deleting && setPendingDelete(null)}>
          <Pressable
            style={[strip.confirmCard, { backgroundColor: colors.card, borderColor: '#EF444450' }]}
            onPress={(e) => e.stopPropagation()}
          >
            <View style={[strip.confirmIcon, { backgroundColor: '#EF444420' }]}>
              <Ionicons name="trash" size={28} color="#EF4444" />
            </View>
            <Text style={[strip.confirmTitle, { color: colors.text }]}>حذف الموعد</Text>
            <Text style={[strip.confirmMessage, { color: colors.textSecondary }]}>
              هل تريد حذف هذا الموعد نهائياً؟
              {pendingDelete ? `\n${new Date(pendingDelete.appointment_date).toLocaleDateString('ar-EG', { weekday: 'long', day: 'numeric', month: 'long' })} · ${new Date(pendingDelete.appointment_date).toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' })}` : ''}
            </Text>
            <View style={strip.confirmRow}>
              <TouchableOpacity
                style={[strip.confirmBtn, { backgroundColor: colors.surface, borderColor: colors.border }]}
                onPress={() => !deleting && setPendingDelete(null)}
                disabled={deleting}
              >
                <Text style={[strip.confirmBtnText, { color: colors.text }]}>إلغاء</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[strip.confirmBtn, { backgroundColor: '#EF4444' }]}
                onPress={performDelete}
                disabled={deleting}
              >
                {deleting ? (
                  <ActivityIndicator size="small" color="#FFF" />
                ) : (
                  <Text style={[strip.confirmBtnText, { color: '#FFF' }]}>حذف نهائي</Text>
                )}
              </TouchableOpacity>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

// ─── OrdersTab ───────────────────────────────────────────────────────────────
export const OrdersTab: React.FC<OrdersTabProps> = ({
  orders,
  isRTL,
  canEditOrderStatus,
  updatingOrderId,
  onUpdateStatus,
  onRefresh,
  refreshing = false,
  highlightAppointmentId,
  onHighlightConsumed,
  highlightCustomerUserId,
  isInitialLoading = false,
  isOwnView = false,
}) => {
  const { colors } = useTheme();
  const { language } = useTranslation();
  const router = useRouter();
  const [bookingVisible, setBookingVisible] = useState(false);
  const [customerAppts, setCustomerAppts] = useState<AppointmentFull[]>([]);
  const [expandedMapOrderId, setExpandedMapOrderId] = useState<string | null>(null);
  // Ref so ListHeaderComponent can read the latest appointments without
  // including customerAppts in its useCallback deps (which would cause
  // BookingStrip to unmount/remount and trigger an infinite load loop).
  const customerApptsRef = useRef<AppointmentFull[]>([]);

  // Stable callback — never changes reference, so BookingStrip.loadData
  // never needs to re-run because of it.
  const handleCustomerApptsLoaded = useCallback((appts: AppointmentFull[]) => {
    customerApptsRef.current = appts;
    setCustomerAppts(appts);
  }, []);

  const safeOrders = Array.isArray(orders) ? orders : [];

  // Real-time order updates: when an order is created/updated/status-changed
  // (either from the order screen or from /owner/restaurant-analytics), the
  // server broadcasts a WS event. Trigger the parent's refresh so this view
  // reflects new statuses for both customers and admin/owner immediately.
  useWebSocketEvent(
    ['order_created', 'order_updated', 'order_status_changed', 'new_order', 'order_deleted'],
    useCallback(() => {
      onRefresh?.();
    }, [onRefresh]),
  );

  const formatDate = useCallback((dateStr: string) => {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    return date.toLocaleDateString(language === 'ar' ? 'ar-EG' : 'en-US', {
      year: 'numeric', month: 'short', day: 'numeric',
    });
  }, [language]);

  const renderOrderItem = useCallback(({ item: order }: { item: Order }) => {
    const statusInfo = getStatusInfo(order.status);
    const isMapExpanded = expandedMapOrderId === order.id;

    // Effective discounted total
    const grossTotal = parseFloat(String(order.total || order.total_amount || 0)) || 0;
    const discountAmt =
      (parseFloat(String(order.discount_amount ?? 0)) || 0) +
      (parseFloat(String(order.discount ?? 0)) || 0) +
      (parseFloat(String(order.subscription_discount ?? 0)) || 0);
    const effectiveTotal = Math.max(0, grossTotal - discountAmt);

    // Metadata chips
    const itemCount = Array.isArray(order.items) ? order.items.length : 0;
    const phone = order.phone || order.customer_phone;
    const paymentMethod = order.payment_method;
    const hasDiscount = discountAmt > 0;

    // Address info for map toggle
    const addressText = order.delivery_address
      || [order.street_address, order.city].filter(Boolean).join(', ');
    const hasCoords = typeof order.delivery_latitude === 'number' && typeof order.delivery_longitude === 'number';
    const hasAddress = !!(addressText || hasCoords);

    const paymentLabel = (() => {
      if (!paymentMethod) return null;
      const map: Record<string, { ar: string; en: string }> = {
        cash_on_delivery: { ar: 'نقدي', en: 'Cash' },
        card: { ar: 'بطاقة', en: 'Card' },
        online: { ar: 'أونلاين', en: 'Online' },
        wallet: { ar: 'محفظة', en: 'Wallet' },
      };
      return map[paymentMethod] ?? { ar: paymentMethod, en: paymentMethod };
    })();

    return (
      <Pressable
        style={[styles.orderCard, { backgroundColor: colors.card, borderColor: colors.border }]}
        onPress={() => router.push(`/admin/order/${order.id}`)}
        android_ripple={{ color: colors.border }}
      >
        {/* Header: order number + status */}
        <View style={[styles.orderHeader, isRTL && styles.rowReverse]}>
          <Text style={[styles.orderNumber, { color: COLORS.goldBright }]}>
            {order.order_number}
          </Text>
          <View style={[styles.statusBadge, { backgroundColor: statusInfo.color }]}>
            <Ionicons name={statusInfo.icon as any} size={10} color="#FFF" />
            <Text style={styles.statusText}>
              {language === 'ar' ? statusInfo.labelAr : statusInfo.label}
            </Text>
          </View>
        </View>

        {/* Date + total */}
        <View style={[styles.orderDetails, isRTL && styles.rowReverse]}>
          <Text style={[styles.orderDate, { color: colors.textSecondary }]}>
            {formatDate(order.created_at ?? '')}
          </Text>
          <View style={[{ flexDirection: isRTL ? 'row-reverse' : 'row', alignItems: 'center', gap: 4 }]}>
            {hasDiscount && (
              <Text style={[styles.orderTotalStrike, { color: colors.textSecondary }]}>
                {grossTotal.toFixed(0)}
              </Text>
            )}
            <Text style={[styles.orderTotal, { color: hasDiscount ? '#10B981' : colors.text }]}>
              {effectiveTotal.toFixed(0)} ج.م
            </Text>
          </View>
        </View>

        {/* Metadata row 1: items count + phone */}
        {(itemCount > 0 || phone) && (
          <View style={[styles.metaRow, isRTL && styles.rowReverse]}>
            {itemCount > 0 && (
              <View style={[styles.metaChip, { backgroundColor: '#3B82F6' + '18', borderColor: '#3B82F6' + '30' }]}>
                <Ionicons name="fast-food-outline" size={11} color="#3B82F6" />
                <Text style={[styles.metaChipText, { color: '#3B82F6' }]}>
                  {itemCount} {language === 'ar' ? 'صنف' : 'items'}
                </Text>
              </View>
            )}
            {phone && (
              <View style={[styles.metaChip, { backgroundColor: '#8B5CF6' + '18', borderColor: '#8B5CF6' + '30' }]}>
                <Ionicons name="call-outline" size={11} color="#8B5CF6" />
                <Text style={[styles.metaChipText, { color: '#8B5CF6' }]} numberOfLines={1}>
                  {phone}
                </Text>
              </View>
            )}
          </View>
        )}

        {/* Metadata row 2: payment method + discount badge */}
        {(paymentLabel || hasDiscount) && (
          <View style={[styles.metaRow, isRTL && styles.rowReverse]}>
            {paymentLabel && (
              <View style={[styles.metaChip, { backgroundColor: '#F59E0B' + '18', borderColor: '#F59E0B' + '30' }]}>
                <Ionicons name="card-outline" size={11} color="#F59E0B" />
                <Text style={[styles.metaChipText, { color: '#F59E0B' }]}>
                  {language === 'ar' ? paymentLabel.ar : paymentLabel.en}
                </Text>
              </View>
            )}
            {hasDiscount && (
              <View style={[styles.metaChip, { backgroundColor: '#10B981' + '18', borderColor: '#10B981' + '30' }]}>
                <Ionicons name="pricetag-outline" size={11} color="#10B981" />
                <Text style={[styles.metaChipText, { color: '#10B981' }]}>
                  {language === 'ar' ? `وفّر ${discountAmt.toFixed(0)} ج.م` : `Saved ${discountAmt.toFixed(0)} EGP`}
                </Text>
              </View>
            )}
          </View>
        )}

        {/* Address row — toggles embedded map if coordinates are available */}
        {hasAddress && (
          <TouchableOpacity
            style={[styles.mapPinRow, isRTL && styles.rowReverse]}
            onPress={() => {
              if (hasCoords) {
                setExpandedMapOrderId(isMapExpanded ? null : order.id);
              } else {
                const encoded = encodeURIComponent(addressText);
                Linking.openURL(`https://www.google.com/maps/search/?api=1&query=${encoded}`).catch(() => {});
              }
            }}
            hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
          >
            <Ionicons name="location-outline" size={13} color={COLORS.goldBright} />
            <Text style={[styles.mapPinText, { color: COLORS.goldBright }]} numberOfLines={1}>
              {addressText}
            </Text>
            {hasCoords ? (
              <Ionicons name={isMapExpanded ? 'chevron-up' : 'map-outline'} size={13} color={COLORS.goldBright} />
            ) : (
              <Ionicons name="open-outline" size={11} color={COLORS.goldBright} />
            )}
          </TouchableOpacity>
        )}

        {/* Expandable inline map */}
        {isMapExpanded && hasCoords && (
          <View style={styles.inlineMapWrap}>
            <MapsPreviewStrip
              latitude={order.delivery_latitude}
              longitude={order.delivery_longitude}
              height={150}
              showOpenButton
              rounded
            />
          </View>
        )}

        {canEditOrderStatus && order.status !== 'delivered' && order.status !== 'cancelled' && (
          <View style={styles.orderActions}>
            {order.status === 'pending' && (
              <StatusActionButton orderId={order.id} status="preparing" label="Prepare" labelAr="تحضير" icon="construct-outline" color="#3B82F6" updatingOrderId={updatingOrderId} language={language} onPress={() => onUpdateStatus(order.id, 'preparing')} />
            )}
            {order.status === 'preparing' && (
              <StatusActionButton orderId={order.id} status="shipped" label="Ship" labelAr="شحن" icon="airplane-outline" color="#EAB308" updatingOrderId={updatingOrderId} language={language} onPress={() => onUpdateStatus(order.id, 'shipped')} />
            )}
            {order.status === 'shipped' && (
              <StatusActionButton orderId={order.id} status="out_for_delivery" label="Out" labelAr="في الطريق" icon="bicycle-outline" color="#6B7280" updatingOrderId={updatingOrderId} language={language} onPress={() => onUpdateStatus(order.id, 'out_for_delivery')} />
            )}
            {order.status === 'out_for_delivery' && (
              <StatusActionButton orderId={order.id} status="delivered" label="Deliver" labelAr="تسليم" icon="checkmark-circle" color="#10B981" updatingOrderId={updatingOrderId} language={language} onPress={() => onUpdateStatus(order.id, 'delivered')} />
            )}
            <StatusActionButton orderId={order.id} status="cancelled" label="Cancel" labelAr="إلغاء" icon="close-circle" color="#EF4444" updatingOrderId={updatingOrderId} language={language} onPress={() => onUpdateStatus(order.id, 'cancelled')} />
          </View>
        )}
      </Pressable>
    );
  }, [colors, language, isRTL, canEditOrderStatus, updatingOrderId, formatDate, router, onUpdateStatus, isOwnView, expandedMapOrderId]);

  // NOTE: customerAppts is intentionally NOT in deps — we read it via
  // customerApptsRef.current inside the callback to avoid recreating the
  // header (and re-mounting BookingStrip) whenever appointments load.
  // FlashList's extraData={customerAppts} triggers header re-renders instead.
  const ListHeaderComponent = useCallback(() => {
    // Read the latest appointments from the ref (always current at render time).
    const appts = customerApptsRef.current;
    return (
      <>
        <BookingStrip
          onOpenBooking={() => setBookingVisible(true)}
          highlightAppointmentId={highlightAppointmentId}
          onHighlightConsumed={onHighlightConsumed}
          highlightCustomerUserId={highlightCustomerUserId}
          onCustomerAppointmentsLoaded={
            highlightCustomerUserId || isOwnView ? handleCustomerApptsLoaded : undefined
          }
        />

        {/* ── Appointments list — shown in admin view (customer's bookings)
               AND in own-profile view (the logged-in user's own bookings).
               BookingStrip.loadData always fires the callback when provided:
               - admin view: filtered to highlightCustomerUserId
               - own view: all (API scopes to current user already). ── */}
        {(highlightCustomerUserId || isOwnView) && (
          <View style={styles.headerWrap}>
            <View style={[styles.sectionHeader, isRTL && styles.rowReverse]}>
              <View>
                <Text style={[styles.kicker, { color: COLORS.goldBright }]}>
                  {highlightCustomerUserId
                    ? (language === 'ar' ? 'مواعيد العميل' : 'Customer Appointments')
                    : (language === 'ar' ? 'مواعيدك' : 'Your Appointments')}
                </Text>
                <Text style={[styles.sectionTitle, { color: colors.text }]}>
                  {language === 'ar' ? 'الحجوزات المسجّلة' : 'Booked Appointments'}
                </Text>
              </View>
              <View style={[styles.countBadge, { backgroundColor: COLORS.gold }]}>
                <Text style={[styles.countBadgeText, { color: COLORS.charcoalDeep }]}>{appts.length}</Text>
              </View>
            </View>
            <View style={styles.goldRule} />
            {appts.length === 0 ? (
              <View style={[styles.emptyContainer, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <EmptyState
                  icon="calendar-outline"
                  title={language === 'ar' ? 'لا توجد مواعيد مسجّلة' : 'No appointments booked'}
                  subtitle={language === 'ar' ? 'لم يقم هذا العميل بحجز أي موعد بعد' : 'This customer has no booked appointments yet'}
                />
              </View>
            ) : (
              appts.map((appt) => {
                const apptDate = new Date(appt.appointment_date);
                const tableNum = appt.service_type?.startsWith('table_')
                  ? appt.service_type.replace('table_', '')
                  : null;
                const restaurantName =
                  (language === 'ar'
                    ? (appt.restaurant_name_ar || appt.restaurant_name)
                    : (appt.restaurant_name || appt.restaurant_name_ar))
                  || (language === 'ar' ? 'مطعم الغزالي' : 'Al-Ghazaly Dining');
                const hallInfo = appt.car_info?.trim() || null;
                const duration = Number(appt.duration_minutes) || 60;
                const statusInfo = getStatusInfo(appt.status ?? 'pending');
                const isUpcoming = apptDate.getTime() > Date.now();
                const dateLabel = apptDate.toLocaleDateString(
                  language === 'ar' ? 'ar-EG' : 'en-US',
                  { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' },
                );
                const timeLabel = apptDate.toLocaleTimeString(
                  language === 'ar' ? 'ar-EG' : 'en-GB',
                  { hour: '2-digit', minute: '2-digit' },
                );
                const isHighlighted = highlightAppointmentId === appt.id;
                return (
                  <View
                    key={appt.id}
                    style={[
                      styles.bookingCard,
                      {
                        backgroundColor: colors.card,
                        borderColor: isHighlighted ? COLORS.goldBright : '#FFD70022',
                        shadowColor: COLORS.gold,
                      },
                      isHighlighted && styles.bookingCardHighlight,
                    ]}
                  >
                    {/* Gold accent bar (RTL-aware: leading edge) */}
                    <View
                      style={[
                        styles.bookingAccentBar,
                        { backgroundColor: COLORS.gold },
                        isRTL ? styles.bookingAccentBarRtl : styles.bookingAccentBarLtr,
                      ]}
                    />

                    {/* Hero — restaurant + table + status */}
                    <View style={[styles.bookingHero, isRTL && styles.rowReverse]}>
                      <View style={styles.bookingHeroLeft}>
                        <View style={[styles.bookingRestaurantRow, isRTL && styles.rowReverse]}>
                          <Ionicons
                            name="restaurant"
                            size={14}
                            color={COLORS.goldBright}
                            style={isRTL ? { marginLeft: 6 } : { marginRight: 6 }}
                          />
                          <Text
                            style={[styles.bookingRestaurantName, { color: colors.text }]}
                            numberOfLines={1}
                          >
                            {restaurantName}
                          </Text>
                        </View>
                        {tableNum ? (
                          <View style={[styles.bookingTableBadge, isRTL && styles.rowReverse]}>
                            <Ionicons name="grid" size={11} color={COLORS.charcoalDeep} />
                            <Text style={styles.bookingTableBadgeText}>
                              {language === 'ar' ? `طاولة رقم ${tableNum}` : `Table ${tableNum}`}
                            </Text>
                          </View>
                        ) : (
                          <Text style={[styles.bookingSubtitle, { color: colors.textSecondary }]}>
                            {appt.service_type ?? (language === 'ar' ? 'حجز موعد' : 'Reservation')}
                          </Text>
                        )}
                      </View>
                      <View style={[styles.statusBadge, { backgroundColor: statusInfo.color }]}>
                        <Ionicons name={statusInfo.icon as any} size={10} color="#FFF" />
                        <Text style={styles.statusText}>
                          {language === 'ar' ? statusInfo.labelAr : statusInfo.label}
                        </Text>
                      </View>
                    </View>

                    {/* Date + Time chips */}
                    <View style={[styles.bookingChipRow, isRTL && styles.rowReverse]}>
                      <View
                        style={[
                          styles.bookingChip,
                          { backgroundColor: colors.background, borderColor: colors.border },
                        ]}
                      >
                        <Ionicons name="calendar-outline" size={12} color={COLORS.goldBright} />
                        <Text
                          style={[styles.bookingChipText, { color: colors.text }]}
                          numberOfLines={1}
                        >
                          {dateLabel}
                        </Text>
                      </View>
                      <View
                        style={[
                          styles.bookingChip,
                          {
                            backgroundColor: isUpcoming ? `${COLORS.gold}1F` : colors.background,
                            borderColor: isUpcoming ? COLORS.gold : colors.border,
                          },
                        ]}
                      >
                        <Ionicons name="time-outline" size={12} color={COLORS.goldBright} />
                        <Text
                          style={[
                            styles.bookingChipText,
                            { color: isUpcoming ? COLORS.goldBright : colors.text, fontWeight: '700' },
                          ]}
                        >
                          {timeLabel}
                        </Text>
                      </View>
                      <View
                        style={[
                          styles.bookingChip,
                          { backgroundColor: colors.background, borderColor: colors.border },
                        ]}
                      >
                        <Ionicons name="hourglass-outline" size={12} color={colors.textSecondary} />
                        <Text style={[styles.bookingChipText, { color: colors.textSecondary }]}>
                          {language === 'ar' ? `${duration} دقيقة` : `${duration} min`}
                        </Text>
                      </View>
                    </View>

                    {/* Hall / area info, when provided */}
                    {hallInfo ? (
                      <View style={[styles.bookingMetaRow, isRTL && styles.rowReverse]}>
                        <Ionicons
                          name="location-outline"
                          size={13}
                          color={COLORS.goldBright}
                          style={isRTL ? { marginLeft: 6 } : { marginRight: 6 }}
                        />
                        <Text
                          style={[styles.bookingMetaText, { color: colors.text }]}
                          numberOfLines={1}
                        >
                          {language === 'ar' ? `الصالة: ${hallInfo}` : `Hall: ${hallInfo}`}
                        </Text>
                      </View>
                    ) : null}

                    {/* ── Maps quick-access pill ── opens the restaurant in Google Maps */}
                    {appt.restaurant_latitude != null && appt.restaurant_longitude != null ? (
                      <TouchableOpacity
                        activeOpacity={0.85}
                        onPress={() => {
                          const lat = appt.restaurant_latitude;
                          const lng = appt.restaurant_longitude;
                          const label = encodeURIComponent(restaurantName);
                          Linking.openURL(`https://www.google.com/maps/search/?api=1&query=${lat},${lng}&query_place_id=${label}`).catch(() => {});
                        }}
                        style={[
                          styles.bookingMetaRow,
                          isRTL && styles.rowReverse,
                          {
                            backgroundColor: `${COLORS.gold}14`,
                            borderRadius: 10,
                            paddingHorizontal: 10,
                            paddingVertical: 8,
                            borderWidth: 1,
                            borderColor: `${COLORS.gold}44`,
                            marginTop: 8,
                          },
                        ]}
                      >
                        <Ionicons
                          name="navigate-outline"
                          size={13}
                          color={COLORS.goldBright}
                          style={isRTL ? { marginLeft: 6 } : { marginRight: 6 }}
                        />
                        <Text
                          style={[styles.bookingMetaText, { color: COLORS.goldBright, fontWeight: '700', flex: 1 }]}
                          numberOfLines={1}
                        >
                          {language === 'ar' ? 'افتح في خرائط جوجل' : 'Open in Google Maps'}
                        </Text>
                        <Ionicons
                          name={isRTL ? 'chevron-back' : 'chevron-forward'}
                          size={13}
                          color={COLORS.goldBright}
                        />
                      </TouchableOpacity>
                    ) : null}

                    {/* ── Rescheduled badge ── highlight when appointment was moved */}
                    {appt.rescheduled_from ? (
                      <View
                        style={[
                          styles.bookingMetaRow,
                          isRTL && styles.rowReverse,
                          {
                            backgroundColor: '#F59E0B1A',
                            borderRadius: 8,
                            paddingHorizontal: 8,
                            paddingVertical: 6,
                            borderWidth: 1,
                            borderColor: '#F59E0B55',
                            marginTop: 8,
                          },
                        ]}
                      >
                        <Ionicons
                          name="swap-horizontal-outline"
                          size={12}
                          color="#F59E0B"
                          style={isRTL ? { marginLeft: 6 } : { marginRight: 6 }}
                        />
                        <Text
                          style={[styles.bookingMetaText, { color: '#F59E0B', fontSize: 11 }]}
                          numberOfLines={2}
                        >
                          {(() => {
                            const oldDate = new Date(appt.rescheduled_from);
                            const oldStr = oldDate.toLocaleDateString(
                              language === 'ar' ? 'ar-EG' : 'en-US',
                              { day: 'numeric', month: 'short', year: 'numeric' },
                            );
                            return language === 'ar' ? `كان: ${oldStr}` : `was: ${oldStr}`;
                          })()}
                        </Text>
                      </View>
                    ) : null}

                    {/* Customer identity — admin view only */}
                    {highlightCustomerUserId && (appt.user_name || appt.user_phone) ? (
                      <View
                        style={[
                          styles.bookingCustomerRow,
                          { backgroundColor: `${COLORS.gold}10`, borderColor: `${COLORS.gold}30` },
                          isRTL && styles.rowReverse,
                        ]}
                      >
                        <Ionicons name="person-circle-outline" size={16} color={COLORS.goldBright} />
                        <Text
                          style={[styles.bookingCustomerName, { color: colors.text }]}
                          numberOfLines={1}
                        >
                          {appt.user_name || (language === 'ar' ? 'عميل' : 'Customer')}
                        </Text>
                        {appt.user_phone ? (
                          <>
                            <Text style={[styles.bookingDot, { color: colors.textSecondary }]}>
                              {' · '}
                            </Text>
                            <Text
                              style={[styles.bookingCustomerPhone, { color: colors.textSecondary }]}
                              numberOfLines={1}
                            >
                              {appt.user_phone}
                            </Text>
                          </>
                        ) : null}
                      </View>
                    ) : null}

                    {/* Notes */}
                    {appt.notes ? (
                      <View
                        style={[
                          styles.bookingNotesBlock,
                          { backgroundColor: colors.background, borderColor: colors.border },
                        ]}
                      >
                        <Text
                          style={[styles.bookingNotesLabel, { color: COLORS.goldBright }]}
                        >
                          {language === 'ar' ? 'ملاحظات' : 'Notes'}
                        </Text>
                        <Text
                          style={[styles.bookingNotesText, { color: colors.text }]}
                          numberOfLines={3}
                        >
                          {appt.notes}
                        </Text>
                      </View>
                    ) : null}
                  </View>
                );
              })
            )}
          </View>
        )}

        {/* ── Food orders section header ── */}
        <View style={styles.headerWrap}>
          <View style={[styles.sectionHeader, isRTL && styles.rowReverse]}>
            <View>
              <Text style={[styles.kicker, { color: COLORS.goldBright }]}>
                {language === 'ar' ? 'الطلبات السابقة' : 'Order History'}
              </Text>
              <Text style={[styles.sectionTitle, { color: colors.text }]}>
                {language === 'ar' ? 'الطلبات' : 'Orders'}
              </Text>
            </View>
            <View style={[styles.countBadge, { backgroundColor: COLORS.gold }]}>
              <Text style={[styles.countBadgeText, { color: COLORS.charcoalDeep }]}>{safeOrders.length}</Text>
            </View>
          </View>
          <View style={styles.goldRule} />
        </View>
      </>
    );
  // customerAppts deliberately excluded — use extraData on FlashList instead.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [colors, language, isRTL, safeOrders.length, highlightCustomerUserId, isOwnView, highlightAppointmentId, onHighlightConsumed, handleCustomerApptsLoaded]);

  const ListFooterComponent = useCallback(() => <View style={{ height: 100 }} />, []);

  const ListEmptyComponent = useCallback(() => {
    if (isInitialLoading) {
      return (
        <View style={{ paddingTop: 4 }}>
          {Array.from({ length: 4 }).map((_, i) => (
            <OrderRowSkeleton key={`order-skel-${i}`} bg={colors.card} border={colors.border} />
          ))}
        </View>
      );
    }
    return (
      <View style={[styles.emptyContainer, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <EmptyState
          icon="restaurant-outline"
          title={language === 'ar' ? 'لا توجد حجوزات بعد' : 'No reservations yet'}
          subtitle={language === 'ar' ? 'حجوزاتك المؤكّدة ستظهر هنا' : 'Your confirmed reservations will appear here'}
        />
      </View>
    );
  }, [language, colors, isInitialLoading]);

  // Crossfade real content in once initial loading completes.
  const fadeOpacity = useSharedValue(1);
  useEffect(() => {
    if (!isInitialLoading) {
      fadeOpacity.value = 0.5;
      fadeOpacity.value = withTiming(1, { duration: 220 });
    }
  }, [isInitialLoading, fadeOpacity]);
  const fadeStyle = useAnimatedStyle(() => ({ opacity: fadeOpacity.value }));

  return (
    <Animated.View style={[{ flex: 1 }, fadeStyle]}>
      <MaintenanceBookingModal
        visible={bookingVisible}
        onClose={() => setBookingVisible(false)}
      />
      <FlashList
        data={safeOrders}
        renderItem={renderOrderItem}
        keyExtractor={(item, index) => item.id || `order-item-${index}`}
        estimatedItemSize={100}
        ListHeaderComponent={ListHeaderComponent}
        ListFooterComponent={ListFooterComponent}
        ListEmptyComponent={ListEmptyComponent}
        contentContainerStyle={styles.listContainer}
        showsVerticalScrollIndicator={false}
        extraData={customerAppts}
        refreshControl={
          onRefresh ? (
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={NEON_NIGHT_THEME.primary}
            />
          ) : undefined
        }
      />
    </Animated.View>
  );
};

const CELL = 36;

const strip = StyleSheet.create({
  container: {
    marginHorizontal: 16,
    marginTop: 8,
    marginBottom: 12,
    borderRadius: 16,
    borderWidth: 1,
    padding: 12,
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  calIconBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 10,
    borderWidth: 1,
  },
  calIconLabel: { color: '#FFD700', fontSize: 13, fontWeight: '700' },
  monthNav: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  navBtn: {
    width: 28, height: 28, borderRadius: 14,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#FFD70015',
  },
  monthTitle: { fontSize: 13, fontWeight: '700' },
  dayRow: { flexDirection: 'row', justifyContent: 'space-around', marginBottom: 4 },
  dayLabel: { width: CELL, textAlign: 'center', fontSize: 10, color: '#888', fontWeight: '700' },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  emptyCell: { width: CELL, height: CELL, margin: 1 },
  dayCell: {
    width: CELL, height: CELL, margin: 1,
    borderRadius: CELL / 2,
    alignItems: 'center', justifyContent: 'center',
    position: 'relative',
  },
  todayCell: { borderWidth: 1.5, borderColor: '#FFD70070' },
  bookedCell: { backgroundColor: '#EF444420', borderWidth: 1, borderColor: '#EF444450' },
  partialCell: { backgroundColor: '#F59E0B18', borderWidth: 1, borderColor: '#F59E0B50' },
  bookedGlow: {
    position: 'absolute',
    width: CELL + 8, height: CELL + 8,
    borderRadius: (CELL + 8) / 2,
    backgroundColor: '#EF444425',
  },
  dayNum: { fontSize: 11, color: '#888' },
  dayBadge: { fontSize: 7, fontWeight: '800', textAlign: 'center' },
  bookedDot: {
    position: 'absolute', bottom: 2,
    width: 4, height: 4, borderRadius: 2,
    backgroundColor: '#FFD700',
  },
  // Distinct ring shown on calendar days that contain a booking by the
  // customer the admin/owner is currently viewing.
  customerCell: {
    borderWidth: 2,
    borderColor: '#22D3EE',
    backgroundColor: '#22D3EE18',
  },
  customerGlow: {
    position: 'absolute',
    width: CELL + 10, height: CELL + 10,
    borderRadius: (CELL + 10) / 2,
    backgroundColor: '#22D3EE22',
  },
  legend: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6, marginTop: 8 },
  legendDot: { width: 8, height: 8, borderRadius: 4 },
  legendText: { fontSize: 10 },
  deleteBtn: {
    padding: 6,
    borderRadius: 8,
    backgroundColor: '#EF444415',
    alignItems: 'center',
    justifyContent: 'center',
  },
  rescheduleBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 8,
    backgroundColor: '#FFD70015',
    borderWidth: 1,
    borderColor: '#FFD70040',
  },
  rescheduleBtnText: {
    color: '#FFD700',
    fontSize: 11,
    fontWeight: '700',
  },
  requestChangeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 10,
    backgroundColor: '#22D3EE15',
    borderWidth: 1,
    borderColor: '#22D3EE55',
    shadowColor: '#22D3EE',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.4,
    shadowRadius: 6,
    elevation: 3,
  },
  requestChangeBtnText: {
    color: '#22D3EE',
    fontSize: 11,
    fontWeight: '700',
  },
  overlay: {
    flex: 1, backgroundColor: '#00000080',
    alignItems: 'center', justifyContent: 'center',
  },
  tooltip: {
    width: '80%', borderRadius: 16, borderWidth: 1, overflow: 'hidden',
    shadowColor: '#FFD700', shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3, shadowRadius: 12, elevation: 10,
  },
  tooltipHeader: {
    flexDirection: 'row', alignItems: 'center',
    gap: 12, padding: 14,
    borderBottomWidth: 1, borderBottomColor: '#FFD70030',
  },
  tooltipTitle: { fontSize: 15, fontWeight: '800', marginBottom: 2 },
  tooltipTime: { fontSize: 18, fontWeight: '800', marginBottom: 2 },
  tooltipMeta: { fontSize: 12, marginBottom: 2 },
  tooltipDate: { fontSize: 12 },
  apptCard: {
    borderWidth: 1, borderRadius: 12, padding: 12, marginBottom: 10, gap: 6,
  },
  apptHeader: {
    flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginBottom: 4,
  },
  timeChip: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10, borderWidth: 1,
  },
  timeChipText: { fontSize: 11, fontWeight: '800' },
  serviceText: { flex: 1, fontSize: 13, fontWeight: '700' },
  apptRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  apptRowText: { fontSize: 12, flex: 1 },
  statusChip: { alignSelf: 'flex-start', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8, marginTop: 4 },
  statusChipText: { fontSize: 10, fontWeight: '800' },
  confirmCard: {
    width: '85%', maxWidth: 360, borderRadius: 16, borderWidth: 1, padding: 20,
    alignItems: 'center', gap: 10,
  },
  confirmIcon: {
    width: 56, height: 56, borderRadius: 28,
    alignItems: 'center', justifyContent: 'center', marginBottom: 4,
  },
  confirmTitle: { fontSize: 17, fontWeight: '800' },
  confirmMessage: { fontSize: 13, textAlign: 'center', lineHeight: 19 },
  confirmRow: { flexDirection: 'row', gap: 10, marginTop: 14, width: '100%' },
  confirmBtn: {
    flex: 1, paddingVertical: 12, borderRadius: 10, borderWidth: 1, borderColor: 'transparent',
    alignItems: 'center', justifyContent: 'center',
  },
  confirmBtnText: { fontSize: 14, fontWeight: '700' },
  historyToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    alignSelf: 'flex-start',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    backgroundColor: '#FFD70010',
    borderWidth: 1,
    borderColor: '#FFD70030',
  },
  historyToggleText: { color: '#FFD700', fontSize: 11, fontWeight: '700' },
  historyBox: {
    marginTop: 6,
    borderTopWidth: 1,
    paddingTop: 8,
    gap: 6,
  },
  historyEmpty: { fontSize: 11, textAlign: 'center', paddingVertical: 6 },
  historyRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 6 },
  historyDot: {
    width: 6, height: 6, borderRadius: 3,
    backgroundColor: '#FFD700', marginTop: 6,
  },
  historyText: { fontSize: 11, fontWeight: '600' },
  historyMeta: { fontSize: 10, marginTop: 1 },
});

const styles = StyleSheet.create({
  listContainer: { paddingHorizontal: 16, paddingTop: 8 },
  sectionHeader: {
    flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12, paddingHorizontal: 4,
  },
  rowReverse: { flexDirection: 'row-reverse' },
  sectionTitle: { ...TYPE.title, fontSize: 22 },
  kicker: { ...TYPE.microLabel, marginBottom: 4 },
  headerWrap: {},
  goldRule: {
    height: 1,
    backgroundColor: COLORS.gold,
    opacity: 0.55,
    width: 56,
    marginTop: 6,
    marginBottom: 14,
  },
  countBadge: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 14 },
  countBadgeText: { color: '#FFF', fontSize: 13, fontWeight: '700' },
  emptyContainer: { marginTop: 8, borderRadius: 16, padding: 16, borderWidth: 1 },
  orderCard: { padding: 12, borderRadius: 12, borderWidth: 1, marginBottom: 8 },
  // ─── Modern booking card (between calendar strip and orders list) ───
  bookingCard: {
    position: 'relative',
    padding: 14,
    paddingTop: 12,
    borderRadius: 16,
    borderWidth: 1,
    marginBottom: 10,
    overflow: 'hidden',
    shadowOpacity: 0.08,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  bookingCardHighlight: {
    shadowOpacity: 0.22,
    shadowRadius: 10,
    elevation: 5,
    borderWidth: 1.5,
  },
  bookingAccentBar: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 4,
  },
  bookingAccentBarLtr: { left: 0 },
  bookingAccentBarRtl: { right: 0 },
  bookingHero: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: 10,
    gap: 10,
  },
  bookingHeroLeft: { flex: 1, minWidth: 0 },
  bookingRestaurantRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 6,
  },
  bookingRestaurantName: { fontSize: 15, fontWeight: '800', flexShrink: 1 },
  bookingSubtitle: { fontSize: 12, fontWeight: '600' },
  bookingTableBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 4,
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: COLORS.gold,
  },
  bookingTableBadgeText: {
    fontSize: 11,
    fontWeight: '800',
    color: COLORS.charcoalDeep,
    letterSpacing: 0.2,
  },
  bookingChipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: 8,
  },
  bookingChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
  },
  bookingChipText: { fontSize: 11.5, fontWeight: '600' },
  bookingMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  bookingMetaText: { fontSize: 12.5, fontWeight: '600', flexShrink: 1 },
  bookingCustomerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    marginBottom: 8,
  },
  bookingCustomerName: { fontSize: 12.5, fontWeight: '700', flexShrink: 1 },
  bookingCustomerPhone: { fontSize: 12, fontWeight: '600' },
  bookingDot: { fontSize: 12 },
  bookingNotesBlock: {
    padding: 10,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
  },
  bookingNotesLabel: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    marginBottom: 3,
  },
  bookingNotesText: { fontSize: 12.5, lineHeight: 18, fontWeight: '500' },
  orderHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 },
  orderNumber: { fontSize: 14, fontWeight: '700' },
  statusBadge: { flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10 },
  statusText: { color: '#FFF', fontSize: 10, fontWeight: '600' },
  orderDetails: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  orderDate: { fontSize: 12 },
  orderTotal: { fontSize: 14, fontWeight: '700' },
  orderActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 10 },
  statusActionBtn: { flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 14 },
  statusActionText: { color: '#FFF', fontSize: 10, fontWeight: '600' },
  mapPinRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 },
  mapPinText: { flex: 1, fontSize: 11, fontWeight: '500' },
  orderTotalStrike: { fontSize: 12, textDecorationLine: 'line-through' },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 5, flexWrap: 'wrap' },
  metaChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    borderWidth: 1,
  },
  metaChipText: { fontSize: 11, fontWeight: '600' },
  inlineMapWrap: { marginTop: 8, borderRadius: 12, overflow: 'hidden' },
});

export default OrdersTab;
