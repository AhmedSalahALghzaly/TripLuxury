import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import {
  Modal,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  Alert,
  Platform,
  Linking,
  Image,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useTheme } from '../../hooks/useTheme';
import { useAppStore } from '../../store/appStore';
import { appointmentsApi } from '../../services/api';
import api from '../../services/api';

interface ExistingAppointment {
  id: string;
  appointment_date: string;
  service_type?: string;
  car_info?: string;
  notes?: string;
}

interface Restaurant {
  id: string;
  name: string;
  name_ar: string;
  image_url?: string;
  tables_count?: number;
}

interface Props {
  visible: boolean;
  onClose: () => void;
  userEmail?: string;
  userPhone?: string;
  userName?: string;
  existingAppointment?: ExistingAppointment | null;
  onUpdated?: () => void;
}

const DEFAULT_TABLES = 12;

const TIME_SLOTS = [
  '09:00', '10:00', '11:00', '12:00',
  '13:00', '14:00', '15:00', '16:00',
  '17:00', '18:00', '19:00', '20:00',
  '21:00', '22:00', '23:00', '00:00',
];

const ENGLISH_MONTHS = [
  'January','February','March','April','May','June',
  'July','August','September','October','November','December',
];
const ENGLISH_DAYS_SHORT = ['Su','Mo','Tu','We','Th','Fr','Sa'];

const ARABIC_MONTHS = [
  'يناير','فبراير','مارس','أبريل','مايو','يونيو',
  'يوليو','أغسطس','سبتمبر','أكتوبر','نوفمبر','ديسمبر',
];
const ARABIC_DAYS_SHORT = ['أح', 'إث', 'ث', 'أر', 'خ', 'ج', 'س'];

function getDaysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate();
}
function getFirstDayOfMonth(year: number, month: number): number {
  return new Date(year, month, 1).getDay();
}

function buildCalendarGrid(year: number, month: number) {
  const daysInMonth = getDaysInMonth(year, month);
  const firstDay = getFirstDayOfMonth(year, month);
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const cells: { day: number | null; date: Date | null; past: boolean }[] = [];
  for (let i = 0; i < firstDay; i++) cells.push({ day: null, date: null, past: false });
  for (let d = 1; d <= daysInMonth; d++) {
    const date = new Date(year, month, d);
    cells.push({ day: d, date, past: date < today });
  }
  return cells;
}

function DayCell({
  day, date, past, selected, partiallyBooked, fullyBooked, onPress,
}: {
  day: number | null; date: Date | null; past: boolean;
  selected: boolean; partiallyBooked: boolean; fullyBooked: boolean; onPress: () => void;
}) {
  const scale = useSharedValue(1);
  const animStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  const disabled = !date || past || fullyBooked;

  const handlePress = () => {
    if (disabled) return;
    scale.value = withSequence(withSpring(0.85), withSpring(1));
    onPress();
  };

  if (!day || !date) return <View style={cal.emptyCell} />;

  const isToday = new Date().toDateString() === date.toDateString();
  return (
    <TouchableOpacity onPress={handlePress} activeOpacity={0.7} disabled={disabled}>
      <Animated.View
        style={[
          cal.dayCell,
          past && cal.pastCell,
          partiallyBooked && !fullyBooked && cal.partialCell,
          fullyBooked && cal.bookedCell,
          isToday && !fullyBooked && !partiallyBooked && cal.todayCell,
          selected && cal.selectedCell,
          animStyle,
        ]}
      >
        {selected && <View style={cal.selectedGlow} />}
        {fullyBooked && <View style={cal.bookedDot} />}
        <Text
          style={[
            cal.dayText,
            past && { color: '#555' },
            partiallyBooked && !fullyBooked && { color: '#F59E0B', fontWeight: '700' },
            fullyBooked && { color: '#EF4444', fontWeight: '700' },
            isToday && !selected && !fullyBooked && !partiallyBooked && { color: '#FFD700', fontWeight: '700' },
            selected && { color: '#000', fontWeight: '800' },
          ]}
        >
          {day}
        </Text>
        {fullyBooked && !past && <Text style={cal.bookedLabel}>مكتمل</Text>}
        {partiallyBooked && !fullyBooked && !past && (
          <Text style={[cal.bookedLabel, { color: '#F59E0B' }]}>جزئي</Text>
        )}
      </Animated.View>
    </TouchableOpacity>
  );
}

function MonthCalendar({
  year, month, selectedDate, bookedTimesMap, onSelectDate, language = 'ar',
}: {
  year: number; month: number; selectedDate: string;
  bookedTimesMap: Map<string, Set<string>>; onSelectDate: (iso: string) => void;
  language?: string;
}) {
  const cells = buildCalendarGrid(year, month);
  const totalSlots = TIME_SLOTS.length;
  const dayLabels = language === 'ar' ? ARABIC_DAYS_SHORT : ENGLISH_DAYS_SHORT;

  return (
    <View>
      <View style={cal.weekRow}>
        {dayLabels.map((d) => (
          <Text key={d} style={cal.weekDay}>{d}</Text>
        ))}
      </View>
      <View style={cal.grid}>
        {cells.map((cell, idx) => {
          const iso = cell.date
            ? `${cell.date.getFullYear()}-${String(cell.date.getMonth() + 1).padStart(2, '0')}-${String(cell.date.getDate()).padStart(2, '0')}`
            : '';
          const bookedTimes = iso ? (bookedTimesMap.get(iso) ?? new Set<string>()) : new Set<string>();
          const partiallyBooked = bookedTimes.size > 0 && bookedTimes.size < totalSlots;
          const fullyBooked = bookedTimes.size >= totalSlots;
          return (
            <DayCell
              key={idx}
              day={cell.day}
              date={cell.date}
              past={cell.past}
              partiallyBooked={partiallyBooked}
              fullyBooked={fullyBooked}
              selected={iso === selectedDate}
              onPress={() => onSelectDate(iso)}
            />
          );
        })}
      </View>
    </View>
  );
}

function buildGoogleCalendarUrl(title: string, dateStr: string, timeStr: string, description: string): string {
  const dateForParsing = timeStr === '00:00'
    ? new Date(new Date(`${dateStr}T23:00:00`).getTime() + 60 * 60 * 1000)
    : new Date(`${dateStr}T${timeStr}:00`);
  const start = dateForParsing;
  const end = new Date(start.getTime() + 60 * 60 * 1000);
  const fmt = (d: Date) => d.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: title,
    dates: `${fmt(start)}/${fmt(end)}`,
    details: description,
    location: 'مطعم الغزالي — Al-Ghazaly Dining',
  });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

export default function MaintenanceBookingModal({
  visible, onClose, userEmail, userPhone, userName, existingAppointment, onUpdated,
}: Props) {
  const isEditMode = !!existingAppointment;
  const { colors } = useTheme();
  const language = useAppStore((s) => s.language);

  // ── State ───────────────────────────────────────────────────────────────────
  const [selectedRestaurant, setSelectedRestaurant] = useState<Restaurant | null>(null);
  const [selectedTable, setSelectedTable] = useState<number | null>(null);
  const [notes, setNotes] = useState('');
  const [selectedDate, setSelectedDate] = useState('');
  const [selectedTime, setSelectedTime] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [lastAppointment, setLastAppointment] = useState<{
    date: string; time: string; tableNumber: number; restaurantName: string;
  } | null>(null);
  const [lastAppointmentId, setLastAppointmentId] = useState<string | null>(null);
  const router = useRouter();

  // bookedSlotsPerTable: tableKey (e.g. "table_3") → dateKey → Set<timeKey>
  // Scoped to the currently selected restaurant
  const [bookedSlotsPerTable, setBookedSlotsPerTable] = useState<Map<string, Map<string, Set<string>>>>(new Map());

  const today = new Date();
  const [calYear, setCalYear] = useState(today.getFullYear());
  const [calMonth, setCalMonth] = useState(today.getMonth());

  // ── Fetch restaurants from car-models ───────────────────────────────────────
  const { data: restaurantsData, isLoading: restaurantsLoading } = useQuery({
    queryKey: ['restaurantsForBooking'],
    queryFn: () => api.get('/car-models').then((r: any) => {
      const d = r.data;
      return Array.isArray(d) ? d : (d?.models || d?.data || []);
    }),
    staleTime: 5 * 60 * 1000,
    enabled: visible,
  });
  const restaurants: Restaurant[] = restaurantsData || [];

  // ── Fetch booked slots scoped to selected restaurant ─────────────────────────
  const fetchBookedDates = useCallback((restaurantId?: string) => {
    appointmentsApi.getSlots(restaurantId ? { restaurant_id: restaurantId } : undefined)
      .then((res: any) => {
        const slotDetails: Array<{ date: string; table: string }> = res.data?.slot_details ?? [];
        const map = new Map<string, Map<string, Set<string>>>();
        slotDetails.forEach(({ date: isoStr, table: tableKey }) => {
          if (!tableKey) return;
          const d = new Date(isoStr);
          const dateKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
          const timeKey = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
          if (!map.has(tableKey)) map.set(tableKey, new Map());
          const dateMap = map.get(tableKey)!;
          if (!dateMap.has(dateKey)) dateMap.set(dateKey, new Set());
          dateMap.get(dateKey)!.add(timeKey);
        });
        setBookedSlotsPerTable(map);
      }).catch(() => {});
  }, []);

  // Re-fetch slots when restaurant changes
  useEffect(() => {
    if (!visible) return;
    fetchBookedDates(selectedRestaurant?.id);
  }, [visible, selectedRestaurant?.id, fetchBookedDates]);

  // ── Pre-fill form when editing ─────────────────────────────────────────────
  useEffect(() => {
    if (!visible || !existingAppointment) return;
    const d = new Date(existingAppointment.appointment_date);
    const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const time = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    setSelectedDate(iso);
    setSelectedTime(time);
    setNotes(existingAppointment.notes || '');
    setCalYear(d.getFullYear());
    setCalMonth(d.getMonth());
    if (existingAppointment.service_type?.startsWith('table_')) {
      const num = parseInt(existingAppointment.service_type.split('_')[1]);
      if (!isNaN(num)) setSelectedTable(num);
    }
  }, [visible, existingAppointment]);

  // Match restaurant when editing (match by name in car_info)
  useEffect(() => {
    if (!isEditMode || !existingAppointment?.car_info || restaurants.length === 0) return;
    const found = restaurants.find(
      (r) => r.name_ar === existingAppointment.car_info || r.name === existingAppointment.car_info
    );
    if (found) setSelectedRestaurant(found);
  }, [restaurants, isEditMode, existingAppointment?.car_info]);

  // ── Calendar navigation ─────────────────────────────────────────────────────
  const goToPrevMonth = () => {
    if (calMonth === 0) { setCalMonth(11); setCalYear(y => y - 1); }
    else setCalMonth(m => m - 1);
  };
  const goToNextMonth = () => {
    if (calMonth === 11) { setCalMonth(0); setCalYear(y => y + 1); }
    else setCalMonth(m => m + 1);
  };

  // ── Table count for selected restaurant ─────────────────────────────────────
  const tableCount = selectedRestaurant?.tables_count ?? DEFAULT_TABLES;

  // ── Availability maps for selected table ─────────────────────────────────────
  const tableKey = selectedTable ? `table_${selectedTable}` : null;
  const bookedTimesForTable: Map<string, Set<string>> = tableKey
    ? (bookedSlotsPerTable.get(tableKey) ?? new Map())
    : new Map();
  const bookedTimesForTableAndDay: Set<string> = selectedDate && tableKey
    ? (bookedSlotsPerTable.get(tableKey)?.get(selectedDate) ?? new Set<string>())
    : new Set<string>();

  // ── Submit ─────────────────────────────────────────────────────────────────
  const handleSubmit = async () => {
    if (!selectedRestaurant) {
      Alert.alert('تنبيه', 'يرجى اختيار المطعم أولاً');
      return;
    }
    if (!selectedTable) {
      Alert.alert('تنبيه', 'يرجى اختيار رقم الطاولة');
      return;
    }
    if (!selectedDate || !selectedTime) {
      Alert.alert('تنبيه', 'يرجى اختيار التاريخ والوقت');
      return;
    }
    setSubmitting(true);
    try {
      const restaurantName = selectedRestaurant.name_ar || selectedRestaurant.name;
      let appointmentDate: string;
      if (selectedTime === '00:00') {
        const nextDay = new Date(`${selectedDate}T23:59:59`);
        nextDay.setSeconds(nextDay.getSeconds() + 1);
        appointmentDate = nextDay.toISOString();
      } else {
        appointmentDate = new Date(`${selectedDate}T${selectedTime}:00`).toISOString();
      }

      if (isEditMode && existingAppointment) {
        await appointmentsApi.update(existingAppointment.id, {
          appointment_date: appointmentDate,
          service_type: `table_${selectedTable}`,
          car_info: restaurantName,
          notes: notes || undefined,
          duration_minutes: 60,
        });
        onUpdated?.();
        handleClose();
        return;
      }

      const createRes = await appointmentsApi.create({
        service_type: `table_${selectedTable}`,
        car_info: restaurantName,
        notes: notes || undefined,
        appointment_date: appointmentDate,
        duration_minutes: 60,
        user_name: userName,
        user_phone: userPhone,
        restaurant_id: selectedRestaurant.id,
      });
      setLastAppointmentId(createRes?.data?.id ?? null);
      setLastAppointment({
        date: selectedDate,
        time: selectedTime,
        tableNumber: selectedTable,
        restaurantName,
      });
      setSuccess(true);
      fetchBookedDates(selectedRestaurant.id);
    } catch (err: any) {
      Alert.alert('خطأ', err?.response?.data?.detail || (isEditMode ? 'فشل في تعديل الحجز' : 'فشل في حجز الطاولة'));
    } finally {
      setSubmitting(false);
    }
  };

  const handleAddToGoogleCalendar = () => {
    if (!lastAppointment) return;
    const title = `حجز طاولة ${lastAppointment.tableNumber} — ${lastAppointment.restaurantName}`;
    const description = `حجز طاولة رقم ${lastAppointment.tableNumber}\nالمطعم: ${lastAppointment.restaurantName}${notes ? `\nملاحظات: ${notes}` : ''}`;
    const url = buildGoogleCalendarUrl(title, lastAppointment.date, lastAppointment.time, description);
    Linking.openURL(url).catch(() => Alert.alert('خطأ', 'تعذّر فتح Google Calendar'));
  };

  const handleClose = () => {
    setSuccess(false);
    setSelectedRestaurant(null);
    setSelectedTable(null);
    setNotes('');
    setSelectedDate('');
    setSelectedTime('');
    setLastAppointment(null);
    setLastAppointmentId(null);
    onClose();
  };

  const formatSuccessDate = (iso: string) =>
    new Date(iso + 'T12:00:00').toLocaleDateString('ar-EG', {
      weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
    });

  // ── RENDER ─────────────────────────────────────────────────────────────────
  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={handleClose}
    >
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        {/* Header */}
        <LinearGradient colors={['#1A1A2E', '#16213E']} style={styles.header}>
          <TouchableOpacity onPress={handleClose} style={styles.closeBtn}>
            <Ionicons name="close" size={22} color="#fff" />
          </TouchableOpacity>
          <View style={styles.headerContent}>
            <View style={styles.headerIcon}>
              <Ionicons name="restaurant" size={22} color="#FFD700" />
            </View>
            <Text style={styles.headerTitle}>{isEditMode ? 'تعديل حجز الطاولة' : 'حجز طاولة'}</Text>
            <Text style={styles.headerSub}>مطعم الغزالي — Al-Ghazaly Dining</Text>
          </View>
        </LinearGradient>

        {/* Success screen */}
        {success && lastAppointment ? (
          <View style={styles.successContainer}>
            <LinearGradient colors={['#10B981', '#059669']} style={styles.successIcon}>
              <Ionicons name="checkmark-circle" size={48} color="#fff" />
            </LinearGradient>
            <Text style={[styles.successTitle, { color: colors.text }]}>تم حجز الطاولة بنجاح!</Text>
            <View style={[styles.summaryCard, { backgroundColor: colors.card, borderColor: '#FFD70040' }]}>
              <View style={styles.summaryRow}>
                <Ionicons name="storefront-outline" size={18} color="#FFD700" />
                <Text style={[styles.summaryLabel, { color: colors.textSecondary }]}>المطعم</Text>
                <Text style={[styles.summaryValue, { color: colors.text }]}>{lastAppointment.restaurantName}</Text>
              </View>
              <View style={styles.summaryRow}>
                <Ionicons name="restaurant-outline" size={18} color="#FFD700" />
                <Text style={[styles.summaryLabel, { color: colors.textSecondary }]}>الطاولة</Text>
                <Text style={[styles.summaryValue, { color: colors.text }]}>رقم {lastAppointment.tableNumber}</Text>
              </View>
              <View style={styles.summaryRow}>
                <Ionicons name="calendar-outline" size={18} color="#FFD700" />
                <Text style={[styles.summaryLabel, { color: colors.textSecondary }]}>التاريخ</Text>
                <Text style={[styles.summaryValue, { color: colors.text }]}>{formatSuccessDate(lastAppointment.date)}</Text>
              </View>
              <View style={styles.summaryRow}>
                <Ionicons name="time-outline" size={18} color="#FFD700" />
                <Text style={[styles.summaryLabel, { color: colors.textSecondary }]}>الوقت</Text>
                <Text style={[styles.summaryValue, { color: colors.text }]}>{lastAppointment.time}</Text>
              </View>
            </View>
            <Text style={[styles.successSub, { color: colors.textSecondary }]}>
              سيتواصل معك فريقنا لتأكيد الحجز
            </Text>
            <TouchableOpacity
              style={styles.orderNowBtn}
              onPress={() => {
                handleClose();
                const path = lastAppointmentId
                  ? `/cart?tab=orders&appointmentId=${lastAppointmentId}`
                  : '/cart?tab=orders';
                router.push(path as any);
              }}
              activeOpacity={0.85}
            >
              <LinearGradient colors={['#FFD700', '#FFA500']} style={styles.orderNowGrad}>
                <Ionicons name="restaurant" size={20} color="#000" />
                <Text style={styles.orderNowText}>احجز طلبك</Text>
                <Ionicons name="arrow-forward" size={18} color="#000" />
              </LinearGradient>
            </TouchableOpacity>
            <TouchableOpacity style={styles.gcalBtn} onPress={handleAddToGoogleCalendar} activeOpacity={0.8}>
              <LinearGradient colors={['#4285F4', '#34A853']} style={styles.gcalGrad}>
                <Ionicons name="logo-google" size={20} color="#fff" />
                <Text style={styles.gcalText}>أضف للتقويم Google</Text>
              </LinearGradient>
            </TouchableOpacity>
            <TouchableOpacity style={styles.doneBtn} onPress={handleClose}>
              <Text style={styles.doneBtnText}>إغلاق</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>

            {/* ══ STEP 1: اختيار المطعم ══ */}
            <View style={styles.stepHeader}>
              <View style={styles.stepBadge}>
                <Text style={styles.stepNum}>١</Text>
              </View>
              <View style={styles.stepLabelRow}>
                <Ionicons name="storefront" size={16} color="#FFD700" />
                <Text style={[styles.sectionLabel, { color: colors.text, marginTop: 0 }]}>اختر المطعم</Text>
                <View style={styles.requiredBadge}>
                  <Text style={styles.requiredText}>مطلوب</Text>
                </View>
              </View>
            </View>

            {restaurantsLoading ? (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.mealScroll}>
                {[1, 2, 3].map((i) => (
                  <View key={i} style={[styles.mealCardSkeleton, { backgroundColor: '#ffffff08', borderColor: '#ffffff10' }]}>
                    <View style={[styles.mealSkeletonImg, { backgroundColor: '#ffffff10' }]} />
                    <View style={[styles.mealSkeletonLine, { backgroundColor: '#ffffff10', width: 70 }]} />
                  </View>
                ))}
              </ScrollView>
            ) : restaurants.length === 0 ? (
              <View style={[styles.emptyState, { backgroundColor: '#ffffff08', borderColor: '#FFD70020' }]}>
                <Ionicons name="storefront-outline" size={24} color="#FFD70080" />
                <Text style={{ color: '#fff', fontSize: 14, fontWeight: '700' }}>لا توجد مطاعم مضافة</Text>
                <Text style={{ color: '#ffffff50', fontSize: 11, marginTop: 2 }}>يمكن إضافة المطاعم من لوحة التحكم</Text>
              </View>
            ) : (
              <>
                {!selectedRestaurant && (
                  <View style={[styles.hintRow, { backgroundColor: '#EF444410', borderColor: '#EF444440' }]}>
                    <Ionicons name="information-circle-outline" size={13} color="#EF4444" />
                    <Text style={{ color: '#EF4444', fontSize: 12 }}>يرجى اختيار المطعم للمتابعة</Text>
                  </View>
                )}
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.mealScroll}>
                  {restaurants.map((r) => {
                    const isActive = selectedRestaurant?.id === r.id;
                    return (
                      <TouchableOpacity
                        key={r.id}
                        onPress={() => {
                          setSelectedRestaurant(isActive ? null : r);
                          setSelectedTable(null);
                          setSelectedDate('');
                          setSelectedTime('');
                        }}
                        activeOpacity={0.8}
                        style={styles.mealCardWrap}
                      >
                        <View style={styles.mealCardImgWrap}>
                          {r.image_url ? (
                            <Image source={{ uri: r.image_url }} style={StyleSheet.absoluteFillObject} resizeMode="cover" />
                          ) : (
                            <LinearGradient colors={['#0D1B2A', '#1A2F4E']} style={StyleSheet.absoluteFillObject} />
                          )}
                          <LinearGradient
                            colors={['transparent', isActive ? 'rgba(255,215,0,0.85)' : 'rgba(0,0,0,0.7)']}
                            style={[StyleSheet.absoluteFillObject, { justifyContent: 'flex-end', padding: 8 }]}
                          >
                            {!r.image_url && (
                              <View style={{ alignItems: 'center', marginBottom: 4 }}>
                                <Ionicons name="storefront" size={26} color={isActive ? '#000' : '#FFD700'} />
                              </View>
                            )}
                          </LinearGradient>
                          {isActive && (
                            <View style={styles.mealActiveCheck}>
                              <Ionicons name="checkmark-circle" size={20} color="#FFD700" />
                            </View>
                          )}
                          <View style={[
                            StyleSheet.absoluteFillObject,
                            { borderRadius: 14, borderWidth: isActive ? 2.5 : 1, borderColor: isActive ? '#FFD700' : '#ffffff18' },
                          ]} pointerEvents="none" />
                        </View>
                        <View style={[styles.mealCardInfo, { backgroundColor: isActive ? '#FFD70015' : 'transparent' }]}>
                          <Text style={[styles.mealCardName, { color: isActive ? '#FFD700' : '#fff' }]} numberOfLines={2}>
                            {r.name_ar || r.name}
                          </Text>
                          {r.tables_count ? (
                            <Text style={{ color: isActive ? '#FFD70090' : '#ffffff45', fontSize: 9, marginTop: 2, textAlign: 'center' }}>
                              🪑 {r.tables_count} طاولة
                            </Text>
                          ) : null}
                        </View>
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>
              </>
            )}

            {/* ══ STEP 2: اختيار الطاولة (بعد اختيار المطعم) ══ */}
            {selectedRestaurant ? (
              <>
                <View style={styles.stepHeader}>
                  <View style={styles.stepBadge}>
                    <Text style={styles.stepNum}>٢</Text>
                  </View>
                  <View style={[styles.stepLabelRow, { flex: 1 }]}>
                    <Ionicons name="restaurant-outline" size={16} color="#FFD700" />
                    <Text style={[styles.sectionLabel, { color: colors.text, marginTop: 0, flex: 1 }]}>
                      طاولات {selectedRestaurant.name_ar || selectedRestaurant.name}
                    </Text>
                  </View>
                </View>

                {/* Selection pill */}
                {selectedTable ? (
                  <View style={styles.selectionPill}>
                    <LinearGradient colors={['#FFD70020', '#FFA50010']} style={styles.selectionPillGrad}>
                      <Ionicons name="restaurant" size={14} color="#FFD700" />
                      <Text style={styles.selectionPillText}>
                        {selectedRestaurant.name_ar || selectedRestaurant.name} · طاولة رقم {selectedTable}
                      </Text>
                    </LinearGradient>
                  </View>
                ) : null}

                <View style={styles.tableGrid}>
                  {Array.from({ length: tableCount }, (_, i) => i + 1).map((num) => {
                    const tKey = `table_${num}`;
                    const tableMap = bookedSlotsPerTable.get(tKey);
                    const totalBooked = tableMap ? Array.from(tableMap.values()).reduce((s, set) => s + set.size, 0) : 0;
                    const isSelected = selectedTable === num;
                    const hasBookings = totalBooked > 0;
                    return (
                      <TouchableOpacity
                        key={num}
                        onPress={() => { setSelectedTable(num); setSelectedDate(''); setSelectedTime(''); }}
                        activeOpacity={0.75}
                      >
                        <LinearGradient
                          colors={isSelected ? ['#FFD700', '#FFA500'] : hasBookings ? ['#1e2a1e', '#162116'] : ['#1a1a2e', '#16213e']}
                          style={[
                            styles.tableCard,
                            isSelected && styles.tableCardSelected,
                            !isSelected && { borderColor: hasBookings ? '#22c55e40' : '#ffffff15' },
                          ]}
                        >
                          <Ionicons
                            name="restaurant-outline"
                            size={16}
                            color={isSelected ? '#000' : hasBookings ? '#22c55e' : '#ffffff60'}
                          />
                          <Text style={[styles.tableNum, { color: isSelected ? '#000' : '#fff' }]}>{num}</Text>
                        </LinearGradient>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </>
            ) : (
              <View style={[styles.lockedSection, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <Ionicons name="lock-closed-outline" size={20} color={colors.textSecondary} />
                <Text style={{ color: colors.textSecondary, fontSize: 13 }}>اختر المطعم أولاً لعرض الطاولات المتاحة</Text>
              </View>
            )}

            {/* ══ STEP 3: التقويم (بعد اختيار الطاولة) ══ */}
            {selectedRestaurant && selectedTable ? (
              <>
                <View style={styles.stepHeader}>
                  <View style={styles.stepBadge}>
                    <Text style={styles.stepNum}>٣</Text>
                  </View>
                  <Text style={[styles.sectionLabel, { color: colors.text, marginTop: 0 }]}>اختر التاريخ</Text>
                </View>

                <View style={[styles.calCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                  <View style={styles.monthNav}>
                    <TouchableOpacity onPress={goToNextMonth} style={styles.navBtn}>
                      <Ionicons name="chevron-forward" size={20} color="#FFD700" />
                    </TouchableOpacity>
                    <Text style={[styles.monthTitle, { color: colors.text }]}>
                      {(language === 'ar' ? ARABIC_MONTHS : ENGLISH_MONTHS)[calMonth]} {calYear}
                    </Text>
                    <TouchableOpacity onPress={goToPrevMonth} style={styles.navBtn}>
                      <Ionicons name="chevron-back" size={20} color="#FFD700" />
                    </TouchableOpacity>
                  </View>
                  <MonthCalendar
                    year={calYear}
                    month={calMonth}
                    selectedDate={selectedDate}
                    bookedTimesMap={bookedTimesForTable}
                    onSelectDate={(iso) => { setSelectedDate(iso); setSelectedTime(''); }}
                    language={language}
                  />
                  {selectedDate ? (
                    <Text style={styles.selectedDateLabel}>
                      📅 {new Date(selectedDate + 'T12:00:00').toLocaleDateString('ar-EG', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
                    </Text>
                  ) : null}
                </View>
              </>
            ) : null}

            {/* ══ STEP 4: الوقت ══ */}
            {selectedRestaurant && selectedTable && selectedDate ? (
              <>
                <View style={styles.stepHeader}>
                  <View style={styles.stepBadge}>
                    <Text style={styles.stepNum}>٤</Text>
                  </View>
                  <Text style={[styles.sectionLabel, { color: colors.text, marginTop: 0 }]}>اختر وقت الحجز</Text>
                </View>
                <View style={styles.timeGrid}>
                  {TIME_SLOTS.map((t) => {
                    const active = selectedTime === t;
                    const isBooked = bookedTimesForTableAndDay.has(t);
                    return (
                      <TouchableOpacity
                        key={t}
                        style={[
                          styles.timeSlot,
                          isBooked && { backgroundColor: '#EF444420', borderColor: '#EF4444' },
                          active && { backgroundColor: '#FFD700', borderColor: '#FFD700' },
                          !isBooked && !active && { backgroundColor: colors.card, borderColor: colors.border },
                        ]}
                        onPress={() => { if (!isBooked) setSelectedTime(t); }}
                        disabled={isBooked}
                        activeOpacity={isBooked ? 1 : 0.7}
                      >
                        {isBooked && (
                          <Ionicons name="close-circle" size={12} color="#EF4444" style={{ marginBottom: 1 }} />
                        )}
                        <Text style={[
                          styles.timeLabel,
                          { color: active ? '#000' : isBooked ? '#EF4444' : colors.text },
                          isBooked && { textDecorationLine: 'line-through', fontSize: 11 },
                        ]}>{t}</Text>
                        {isBooked && <Text style={{ fontSize: 8, color: '#EF4444' }}>محجوز</Text>}
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </>
            ) : null}

            {/* ══ STEP 5: الملاحظات والإرسال ══ */}
            {selectedRestaurant && selectedTable && selectedDate && selectedTime ? (
              <>
                <View style={styles.stepHeader}>
                  <View style={styles.stepBadge}>
                    <Text style={styles.stepNum}>٥</Text>
                  </View>
                  <Text style={[styles.sectionLabel, { color: colors.text, marginTop: 0 }]}>ملاحظات إضافية</Text>
                </View>
                <TextInput
                  style={[styles.input, styles.notesInput, { backgroundColor: colors.card, borderColor: colors.border, color: colors.text }]}
                  value={notes}
                  onChangeText={setNotes}
                  placeholder="أي تفاصيل إضافية تود إضافتها..."
                  placeholderTextColor={colors.textSecondary}
                  multiline
                  textAlign="right"
                />

                <TouchableOpacity
                  style={[styles.submitBtn, { opacity: submitting ? 0.7 : 1 }]}
                  onPress={handleSubmit}
                  disabled={submitting}
                >
                  <LinearGradient colors={['#FFD700', '#FFA500']} style={styles.submitGrad}>
                    {submitting ? (
                      <ActivityIndicator color="#000" />
                    ) : (
                      <>
                        <Ionicons name="restaurant" size={20} color="#000" />
                        <Text style={styles.submitText}>{isEditMode ? 'حفظ التعديل' : 'تأكيد الحجز'}</Text>
                      </>
                    )}
                  </LinearGradient>
                </TouchableOpacity>
              </>
            ) : null}

            {/* Progress indicator when not all steps completed */}
            {!(selectedRestaurant && selectedTable && selectedDate && selectedTime) && (
              <View style={styles.progressHint}>
                <View style={[styles.progressStep, { backgroundColor: selectedRestaurant ? '#FFD700' : '#ffffff20' }]}>
                  <Text style={[styles.progressStepText, { color: selectedRestaurant ? '#000' : '#ffffff50' }]}>١</Text>
                </View>
                <View style={[styles.progressLine, { backgroundColor: selectedTable ? '#FFD70050' : '#ffffff10' }]} />
                <View style={[styles.progressStep, { backgroundColor: selectedTable ? '#FFD700' : '#ffffff20' }]}>
                  <Text style={[styles.progressStepText, { color: selectedTable ? '#000' : '#ffffff50' }]}>٢</Text>
                </View>
                <View style={[styles.progressLine, { backgroundColor: selectedDate ? '#FFD70050' : '#ffffff10' }]} />
                <View style={[styles.progressStep, { backgroundColor: selectedDate ? '#FFD700' : '#ffffff20' }]}>
                  <Text style={[styles.progressStepText, { color: selectedDate ? '#000' : '#ffffff50' }]}>٣</Text>
                </View>
                <View style={[styles.progressLine, { backgroundColor: selectedTime ? '#FFD70050' : '#ffffff10' }]} />
                <View style={[styles.progressStep, { backgroundColor: selectedTime ? '#FFD700' : '#ffffff20' }]}>
                  <Text style={[styles.progressStepText, { color: selectedTime ? '#000' : '#ffffff50' }]}>٤</Text>
                </View>
              </View>
            )}
          </ScrollView>
        )}
      </View>
    </Modal>
  );
}

const CELL_SIZE = 40;

const cal = StyleSheet.create({
  weekRow: { flexDirection: 'row', justifyContent: 'space-around', marginBottom: 6 },
  weekDay: { width: CELL_SIZE, textAlign: 'center', fontSize: 11, color: '#888', fontWeight: '700' },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  emptyCell: { width: CELL_SIZE, height: CELL_SIZE, margin: 1 },
  dayCell: {
    width: CELL_SIZE, height: CELL_SIZE, margin: 1,
    borderRadius: 20, alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'transparent',
  },
  pastCell: { opacity: 0.3 },
  bookedCell: { backgroundColor: '#EF444418', borderWidth: 1, borderColor: '#EF444440' },
  partialCell: { backgroundColor: '#F59E0B10', borderWidth: 1, borderColor: '#F59E0B40' },
  todayCell: { borderWidth: 1.5, borderColor: '#FFD70070' },
  selectedCell: { backgroundColor: '#FFD700' },
  selectedGlow: {
    position: 'absolute', width: CELL_SIZE + 8, height: CELL_SIZE + 8,
    borderRadius: 24, backgroundColor: '#FFD70030',
  },
  bookedDot: { position: 'absolute', top: 3, right: 5, width: 5, height: 5, borderRadius: 3, backgroundColor: '#EF4444' },
  bookedLabel: { fontSize: 7, color: '#EF4444', fontWeight: '700', marginTop: -3 },
  dayText: { fontSize: 14, color: '#ccc', fontWeight: '500' },
});

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    paddingTop: Platform.OS === 'ios' ? 16 : 20,
    paddingBottom: 24, paddingHorizontal: 20,
    alignItems: 'center', gap: 10,
  },
  closeBtn: {
    position: 'absolute', top: Platform.OS === 'ios' ? 16 : 20, left: 16,
    width: 36, height: 36, alignItems: 'center', justifyContent: 'center',
  },
  headerContent: { alignItems: 'center', gap: 6 },
  headerIcon: {
    width: 52, height: 52, borderRadius: 26,
    backgroundColor: '#FFD70020', alignItems: 'center', justifyContent: 'center',
    borderWidth: 1.5, borderColor: '#FFD70050',
  },
  headerTitle: { color: '#fff', fontSize: 18, fontWeight: '800' },
  headerSub: { color: '#ffffff80', fontSize: 12 },
  body: { padding: 20, gap: 6, paddingBottom: 40 },
  sectionLabel: { fontSize: 14, fontWeight: '700', marginTop: 12, marginBottom: 6 },

  // Step headers
  stepHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 16, marginBottom: 8 },
  stepBadge: {
    width: 28, height: 28, borderRadius: 14,
    backgroundColor: '#FFD70020', borderWidth: 1.5, borderColor: '#FFD700',
    alignItems: 'center', justifyContent: 'center',
  },
  stepNum: { color: '#FFD700', fontSize: 13, fontWeight: '800' },
  stepLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  requiredBadge: {
    backgroundColor: '#EF444420', borderRadius: 6,
    paddingHorizontal: 6, paddingVertical: 2, borderWidth: 1, borderColor: '#EF444440',
  },
  requiredText: { color: '#EF4444', fontSize: 10, fontWeight: '700' },
  hintRow: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    padding: 8, borderRadius: 10, borderWidth: 1, marginBottom: 6,
  },

  // Restaurant cards
  mealScroll: { paddingRight: 8, gap: 10, paddingBottom: 6, paddingTop: 4 },
  mealCardWrap: {
    width: 120, borderRadius: 14, overflow: 'hidden',
    shadowColor: '#FFD700', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.12, shadowRadius: 8, elevation: 4,
  },
  mealCardImgWrap: { height: 100, width: '100%', borderRadius: 14, overflow: 'hidden', position: 'relative' },
  mealActiveCheck: { position: 'absolute', top: 6, right: 6, backgroundColor: '#000000AA', borderRadius: 12 },
  mealCardInfo: { paddingHorizontal: 8, paddingVertical: 7, backgroundColor: '#0D1B2A' },
  mealCardName: { fontSize: 12, fontWeight: '700', textAlign: 'center', color: '#fff' },
  mealCardSkeleton: { width: 120, borderRadius: 14, borderWidth: 1, overflow: 'hidden' },
  mealSkeletonImg: { height: 100, width: '100%' },
  mealSkeletonLine: { height: 10, borderRadius: 5, margin: 8, marginBottom: 4 },
  emptyState: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    padding: 16, borderRadius: 14, borderWidth: 1,
  },

  // Table grid
  tableGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'flex-start', marginBottom: 4 },
  tableCard: {
    width: 58, height: 62, borderRadius: 14, borderWidth: 1.5,
    alignItems: 'center', justifyContent: 'center', gap: 4,
  },
  tableCardSelected: {
    borderColor: '#FFD700', shadowColor: '#FFD700',
    shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.5,
    shadowRadius: 10, elevation: 8,
  },
  tableNum: { fontSize: 16, fontWeight: '800' },
  lockedSection: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10,
    padding: 20, borderRadius: 16, borderWidth: 1, borderStyle: 'dashed', marginVertical: 8,
  },

  // Selection pill
  selectionPill: { marginBottom: 8, borderRadius: 20, overflow: 'hidden' },
  selectionPillGrad: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20,
    borderWidth: 1, borderColor: '#FFD70030',
  },
  selectionPillText: { color: '#FFD700', fontSize: 13, fontWeight: '700' },

  // Calendar
  calCard: { borderRadius: 16, borderWidth: 1, padding: 12, marginVertical: 8 },
  monthNav: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginBottom: 12, paddingHorizontal: 4,
  },
  navBtn: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: '#FFD70015' },
  monthTitle: { fontSize: 16, fontWeight: '800' },
  selectedDateLabel: { textAlign: 'center', color: '#FFD700', fontSize: 13, fontWeight: '600', marginTop: 10, paddingBottom: 4 },

  // Time slots
  timeGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  timeSlot: { paddingHorizontal: 16, paddingVertical: 9, borderRadius: 10, borderWidth: 1, alignItems: 'center' },
  timeLabel: { fontSize: 14, fontWeight: '600' },

  // Notes
  input: { borderRadius: 12, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 11, fontSize: 14 },
  notesInput: { height: 80, textAlignVertical: 'top', paddingTop: 11 },

  // Submit
  submitBtn: { marginTop: 20, borderRadius: 16, overflow: 'hidden' },
  submitGrad: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, paddingVertical: 16 },
  submitText: { color: '#000', fontSize: 16, fontWeight: '800' },

  // Progress indicator
  progressHint: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 4, marginTop: 24, marginBottom: 8,
  },
  progressStep: {
    width: 32, height: 32, borderRadius: 16,
    alignItems: 'center', justifyContent: 'center',
  },
  progressStepText: { fontSize: 13, fontWeight: '800' },
  progressLine: { height: 2, flex: 1, maxWidth: 40, borderRadius: 1 },

  // Success
  successContainer: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 14, padding: 32 },
  successIcon: { width: 96, height: 96, borderRadius: 48, alignItems: 'center', justifyContent: 'center' },
  successTitle: { fontSize: 22, fontWeight: '800' },
  summaryCard: { width: '100%', borderRadius: 16, borderWidth: 1.5, padding: 16, gap: 12, marginVertical: 4 },
  summaryRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  summaryLabel: { fontSize: 13, flex: 1 },
  summaryValue: { fontSize: 13, fontWeight: '700', textAlign: 'right', flex: 2 },
  successSub: { fontSize: 13, textAlign: 'center', lineHeight: 20 },
  gcalBtn: { borderRadius: 14, overflow: 'hidden', width: '100%', marginTop: 4 },
  gcalGrad: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, paddingVertical: 14 },
  gcalText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  orderNowBtn: { borderRadius: 16, overflow: 'hidden', width: '100%', marginTop: 4 },
  orderNowGrad: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, paddingVertical: 16, borderRadius: 16 },
  orderNowText: { color: '#000', fontSize: 16, fontWeight: '900', letterSpacing: 0.3 },
  doneBtn: { marginTop: 8, backgroundColor: '#FFD700', paddingHorizontal: 40, paddingVertical: 14, borderRadius: 14 },
  doneBtnText: { color: '#000', fontSize: 16, fontWeight: '800' },
});
