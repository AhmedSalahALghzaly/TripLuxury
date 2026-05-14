/**
 * Restaurants Admin — Luxury restaurant management panel
 * Al-Ghazaly Dining Platform
 */
import React, { useState, useMemo, useCallback, useEffect, useRef, memo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  Image,
  RefreshControl,
  ScrollView,
  useWindowDimensions,
  Platform,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTheme } from '../../src/hooks/useTheme';
import { useTranslation } from '../../src/hooks/useTranslation';
import { api, carBrandsApi, carModelsApi } from '../../src/services/api';
import { useAdminSync } from '../../src/services/adminSyncService';
import { PageConfigPanel, usePageConfig } from '../../src/components/admin/PageConfigPanel';
import { Header } from '../../src/components/Header';
import { Toast } from '../../src/components/ui/FormFeedback';
import { ImageUploader } from '../../src/components/ui/ImageUploader';
import { queryKeys } from '../../src/lib/queryClient';
import { useConfirmModal } from '../../src/components/ConfirmModal';
import { AccessGuard as __AccessGuard__ } from '../../src/components/AccessGuard';
import { useAppStore } from '../../src/store/appStore';
import { MapsPreviewStrip } from '../../src/components/MapsPreviewStrip';
import { minutesToHHMM, hhmmToMinutes } from '../../src/utils/timeUtils';

// ─── Weekly Hours Types & Helpers ────────────────────────────────────────────
const DAY_NAMES_EN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DAY_NAMES_AR = ['أحد', 'اثن', 'ثلا', 'أرب', 'خمي', 'جمع', 'سبت'];

interface DaySchedule {
  open: string;
  close: string;
  closed: boolean;
}

function makeDefaultWeeklyHours(): DaySchedule[] {
  return Array.from({ length: 7 }, () => ({ open: '09:00', close: '22:00', closed: false }));
}

// ─── Opening Time Picker ──────────────────────────────────────────────────────
function OpeningTimePicker({
  label,
  value,
  onChange,
  colors,
  language,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  colors: any;
  language: string;
}) {
  const parsed = value && /^\d{2}:\d{2}$/.test(value) ? value : null;
  const hours = parsed ? parseInt(parsed.split(':')[0], 10) : null;
  const mins = parsed ? parseInt(parsed.split(':')[1], 10) : null;
  const hasValue = hours !== null && mins !== null;

  const period = hasValue && hours! < 12 ? (language === 'ar' ? 'ص' : 'AM') : (language === 'ar' ? 'م' : 'PM');
  const displayH = hasValue ? (hours! % 12 || 12) : null;

  const adjustHour = (delta: number) => {
    const h = hasValue ? hours! : 9;
    const m = hasValue ? mins! : 0;
    const newH = (h + delta + 24) % 24;
    onChange(`${String(newH).padStart(2, '0')}:${String(m).padStart(2, '0')}`);
  };

  const adjustMin = (delta: number) => {
    const h = hasValue ? hours! : 9;
    const m = hasValue ? mins! : 0;
    const newM = (m + delta + 60) % 60;
    onChange(`${String(h).padStart(2, '0')}:${String(newM).padStart(2, '0')}`);
  };

  const togglePeriod = () => {
    if (!hasValue) return;
    const newH = hours! < 12 ? hours! + 12 : hours! - 12;
    onChange(`${String(newH).padStart(2, '0')}:${String(mins!).padStart(2, '0')}`);
  };

  const clear = () => onChange('');

  return (
    <View style={{ flex: 1 }}>
      <Text style={[{ color: colors.textSecondary, fontSize: 11, fontWeight: '600', marginBottom: 6 }]}>{label}</Text>
      {hasValue ? (
        <View style={[{ flexDirection: 'row', alignItems: 'center', borderRadius: 12, borderWidth: 1.5, borderColor: colors.primary + '50', backgroundColor: colors.surface, overflow: 'hidden' }]}>
          {/* Hour control */}
          <View style={{ alignItems: 'center', paddingVertical: 4, paddingHorizontal: 10 }}>
            <TouchableOpacity onPress={() => adjustHour(1)} hitSlop={{ top: 8, bottom: 4, left: 8, right: 8 }}>
              <Ionicons name="chevron-up" size={14} color={colors.primary} />
            </TouchableOpacity>
            <Text style={{ color: colors.text, fontSize: 20, fontWeight: '700', fontVariant: ['tabular-nums'], lineHeight: 26 }}>
              {String(displayH).padStart(2, '0')}
            </Text>
            <TouchableOpacity onPress={() => adjustHour(-1)} hitSlop={{ top: 4, bottom: 8, left: 8, right: 8 }}>
              <Ionicons name="chevron-down" size={14} color={colors.primary} />
            </TouchableOpacity>
          </View>
          <Text style={{ color: colors.primary, fontSize: 20, fontWeight: '700' }}>:</Text>
          {/* Minute control */}
          <View style={{ alignItems: 'center', paddingVertical: 4, paddingHorizontal: 10 }}>
            <TouchableOpacity onPress={() => adjustMin(15)} hitSlop={{ top: 8, bottom: 4, left: 8, right: 8 }}>
              <Ionicons name="chevron-up" size={14} color={colors.primary} />
            </TouchableOpacity>
            <Text style={{ color: colors.text, fontSize: 20, fontWeight: '700', fontVariant: ['tabular-nums'], lineHeight: 26 }}>
              {String(mins).padStart(2, '0')}
            </Text>
            <TouchableOpacity onPress={() => adjustMin(-15)} hitSlop={{ top: 4, bottom: 8, left: 8, right: 8 }}>
              <Ionicons name="chevron-down" size={14} color={colors.primary} />
            </TouchableOpacity>
          </View>
          {/* AM/PM toggle */}
          <TouchableOpacity
            onPress={togglePeriod}
            style={{ paddingHorizontal: 10, paddingVertical: 8, backgroundColor: colors.primary + '18', marginLeft: 4 }}
          >
            <Text style={{ color: colors.primary, fontSize: 13, fontWeight: '800' }}>{period}</Text>
          </TouchableOpacity>
          {/* Clear */}
          <TouchableOpacity onPress={clear} style={{ paddingHorizontal: 8 }}>
            <Ionicons name="close-circle" size={16} color={colors.textSecondary} />
          </TouchableOpacity>
        </View>
      ) : (
        <TouchableOpacity
          onPress={() => onChange('09:00')}
          style={[{ flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 12, borderWidth: 1.5, borderColor: colors.border, backgroundColor: colors.surface, paddingHorizontal: 14, paddingVertical: 11 }]}
        >
          <Ionicons name="time-outline" size={16} color={colors.textSecondary} />
          <Text style={{ color: colors.textSecondary, fontSize: 14 }}>
            {language === 'ar' ? 'اضغط لتحديد الوقت' : 'Tap to set time'}
          </Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

// ─── Weekly Hours Grid Component ─────────────────────────────────────────────
const WeeklyHoursGrid = memo(function WeeklyHoursGrid({
  schedule,
  onChange,
  colors,
  language,
}: {
  schedule: DaySchedule[];
  onChange: (s: DaySchedule[]) => void;
  colors: any;
  language: string;
}) {
  const isAr = language === 'ar';
  const update = (idx: number, patch: Partial<DaySchedule>) => {
    const next = schedule.map((d, i) => (i === idx ? { ...d, ...patch } : d));
    onChange(next);
  };

  return (
    <View style={{ gap: 6 }}>
      {schedule.map((day, idx) => {
        const dayLabel = isAr ? DAY_NAMES_AR[idx] : DAY_NAMES_EN[idx];
        const isToday = new Date().getDay() === idx;
        return (
          <View
            key={idx}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 8,
              paddingVertical: 7,
              paddingHorizontal: 10,
              borderRadius: 10,
              borderWidth: 1,
              borderColor: isToday ? colors.primary + '50' : colors.border,
              backgroundColor: isToday ? colors.primary + '08' : colors.surface,
            }}
          >
            {/* Day label */}
            <View style={{ width: 34, alignItems: 'center' }}>
              <Text style={{ fontSize: 11, fontWeight: '700', color: isToday ? colors.primary : colors.textSecondary }}>
                {dayLabel}
              </Text>
              {isToday && (
                <Text style={{ fontSize: 9, color: colors.primary, fontWeight: '600' }}>
                  {isAr ? 'اليوم' : 'Today'}
                </Text>
              )}
            </View>

            {/* Closed toggle */}
            <TouchableOpacity
              onPress={() => update(idx, { closed: !day.closed })}
              style={{
                paddingHorizontal: 8,
                paddingVertical: 4,
                borderRadius: 8,
                borderWidth: 1,
                borderColor: day.closed ? colors.error + '60' : colors.border,
                backgroundColor: day.closed ? colors.error + '12' : colors.surface,
                minWidth: 56,
                alignItems: 'center',
              }}
              hitSlop={{ top: 6, bottom: 6, left: 4, right: 4 }}
            >
              <Text style={{ fontSize: 11, fontWeight: '600', color: day.closed ? colors.error : colors.textSecondary }}>
                {day.closed ? (isAr ? 'مغلق' : 'Closed') : (isAr ? 'مفتوح' : 'Open')}
              </Text>
            </TouchableOpacity>

            {!day.closed ? (
              <>
                {/* Open time */}
                <View style={{ flex: 1 }}>
                  <OpeningTimePicker
                    label={isAr ? 'من' : 'Open'}
                    value={day.open}
                    onChange={(v) => update(idx, { open: v })}
                    colors={colors}
                    language={language}
                  />
                </View>
                {/* Close time */}
                <View style={{ flex: 1 }}>
                  <OpeningTimePicker
                    label={isAr ? 'إلى' : 'Close'}
                    value={day.close}
                    onChange={(v) => update(idx, { close: v })}
                    colors={colors}
                    language={language}
                  />
                </View>
              </>
            ) : (
              <View style={{ flex: 1, alignItems: 'center' }}>
                <Text style={{ color: colors.textSecondary, fontSize: 12, fontStyle: 'italic' }}>
                  {isAr ? 'لا توجد ساعات عمل' : 'No service today'}
                </Text>
              </View>
            )}
          </View>
        );
      })}
    </View>
  );
});

// ─── Types ───────────────────────────────────────────────────────────────────
interface CarModel {
  id: string;
  name: string;
  name_ar: string;
  brand_id: string;
  year_start?: number;
  year_end?: number;
  chassis_number?: string;
  image_url?: string;
  catalog_pdf?: string;
  fuel_type?: string;
  video_url?: string;
  receipt_language?: string;
  latitude?: number | null;
  longitude?: number | null;
}

interface CarBrand {
  id: string;
  name: string;
  name_ar: string;
  logo?: string;
}

interface FormState {
  name: string;
  nameAr: string;
  selectedBrandId: string;
  yearFrom: string;
  yearTo: string;
  chassisNumber: string;
  images: string[];
  catalogPdf: string | null;
  catalogPdfName: string;
  isEditMode: boolean;
  editingModel: CarModel | null;
  searchQuery: string;
  fuelType: string;
  videoUrl: string;
  receiptLanguage: string;
  latitude: string;
  longitude: string;
  weeklyHours: DaySchedule[];
}

interface FormHandlers {
  setName: (v: string) => void;
  setNameAr: (v: string) => void;
  setSelectedBrandId: (v: string) => void;
  setYearFrom: (v: string) => void;
  setYearTo: (v: string) => void;
  setChassisNumber: (v: string) => void;
  setImages: (v: string[]) => void;
  setCatalogPdf: (v: string | null) => void;
  setCatalogPdfName: (v: string) => void;
  handleSave: () => void;
  resetForm: () => void;
  setSearchQuery: (v: string) => void;
  pickCatalogPdf: () => void;
  setFuelType: (v: string) => void;
  setVideoUrl: (v: string) => void;
  pickVideoFile: () => void;
  setReceiptLanguage: (v: string) => void;
  setLatitude: (v: string) => void;
  setLongitude: (v: string) => void;
  pickCurrentLocation: () => void;
  setWeeklyHours: (v: DaySchedule[]) => void;
  pdfLoading: boolean;
  videoLoading: boolean;
  gpsLoading: boolean;
}

interface FormHeaderProps {
  formState: FormState;
  handlers: FormHandlers;
  colors: any;
  isDark: boolean;
  language: string;
  isRTL: boolean;
  isSaving: boolean;
  modelsCount: number;
  brands: CarBrand[];
  router: any;
}

// ─── Shared dietary config ────────────────────────────────────────────────────
const DIETARY_OPTIONS = [
  { key: 'regular',      en: 'Regular',      ar: 'عادي',              color: '#6B7280', icon: 'silverware-fork-knife' as const },
  { key: 'vegetarian',   en: 'Vegetarian',   ar: 'نباتي',             color: '#22C55E', icon: 'leaf'                  as const },
  { key: 'vegan',        en: 'Vegan',        ar: 'نباتي صرف',         color: '#10B981', icon: 'sprout'                as const },
  { key: 'gluten_free',  en: 'Gluten-Free',  ar: 'خالي من الجلوتين', color: '#F59E0B', icon: 'barley-off'            as const },
  { key: 'halal',        en: 'Halal',        ar: 'حلال ✓',            color: '#8B5CF6', icon: 'check-decagram'        as const },
];

// ============================================================================
// Standalone Form Header — outside main component to avoid TextInput re-mount
// ============================================================================
const ModelFormHeader = memo(({
  formState, handlers, colors, isDark, language, isRTL,
  isSaving, modelsCount, brands, router,
}: FormHeaderProps) => {
  const {
    name, nameAr, selectedBrandId, yearFrom, yearTo, chassisNumber,
    images, catalogPdfName, isEditMode, searchQuery, fuelType, videoUrl, receiptLanguage,
    latitude, longitude, weeklyHours,
  } = formState;
  const {
    setName, setNameAr, setSelectedBrandId, setYearFrom, setYearTo,
    setChassisNumber, setImages, setCatalogPdf, setCatalogPdfName,
    handleSave, resetForm, setSearchQuery, pickCatalogPdf, setFuelType,
    setVideoUrl, pickVideoFile, setReceiptLanguage,
    setLatitude, setLongitude, pickCurrentLocation,
    setWeeklyHours,
    pdfLoading, videoLoading, gpsLoading,
  } = handlers;
  const anyUploading = pdfLoading || videoLoading || gpsLoading;

  return (
    <View>
      {/* Breadcrumb */}
      <View style={[styles.breadcrumb, isRTL && styles.breadcrumbRTL]}>
        <TouchableOpacity onPress={() => router.push('/admin')}>
          <Text style={[styles.breadcrumbText, { color: colors.primary }]}>
            {language === 'ar' ? 'لوحة التحكم' : 'Admin'}
          </Text>
        </TouchableOpacity>
        <Ionicons name={isRTL ? 'chevron-back' : 'chevron-forward'} size={14} color={colors.textSecondary} />
        <Text style={[styles.breadcrumbText, { color: colors.textSecondary }]}>
          {language === 'ar' ? 'المطاعم' : 'Restaurants'}
        </Text>
      </View>

      {/* ── Stats Banner ── */}
      <LinearGradient
        colors={isDark ? ['#0D1B2A', '#16213E'] : ['#EEF6FF', '#DBEAFE']}
        style={[styles.statsBanner, { borderColor: colors.primary + '30' }]}
      >
        <View style={styles.statsBannerInner}>
          <View style={[styles.statsIconWrap, { backgroundColor: colors.primary + '25' }]}>
            <MaterialCommunityIcons name="silverware-fork-knife" size={24} color={colors.primary} />
          </View>
          <View>
            <Text style={[styles.statsTitle, { color: colors.text }]}>
              {language === 'ar' ? 'إدارة المطاعم' : 'Restaurants Manager'}
            </Text>
            <Text style={[styles.statsSub, { color: colors.textSecondary }]}>
              {modelsCount} {language === 'ar' ? 'مطعم مضاف' : 'restaurants added'}
            </Text>
          </View>
        </View>
        <View style={[styles.statsCountBubble, { backgroundColor: colors.primary + '20' }]}>
          <Text style={[styles.statsCountNum, { color: colors.primary }]}>{modelsCount}</Text>
        </View>
      </LinearGradient>

      {/* ── Add / Edit Form ── */}
      <View style={[styles.formCard, { backgroundColor: colors.card, borderColor: isEditMode ? colors.primary : colors.border }]}>
        {/* Form title strip */}
        <LinearGradient
          colors={isEditMode
            ? [colors.primary + '20', colors.primary + '06']
            : [isDark ? '#1A2340' : '#F8FAFC', isDark ? '#111827' : '#F0F4FF']}
          style={styles.formTitleStrip}
        >
          <View style={styles.formTitleRow}>
            <View style={[styles.formTitleIconWrap, { backgroundColor: (isEditMode ? colors.primary : colors.textSecondary) + '20' }]}>
              <Ionicons
                name={isEditMode ? 'create' : 'add-circle'}
                size={17}
                color={isEditMode ? colors.primary : colors.textSecondary}
              />
            </View>
            <Text style={[styles.formTitle, { color: isEditMode ? colors.primary : colors.text }]}>
              {isEditMode
                ? (language === 'ar' ? 'تعديل بيانات المطعم' : 'Edit Restaurant')
                : (language === 'ar' ? 'إضافة مطعم جديد' : 'Add New Restaurant')}
            </Text>
            {isEditMode && (
              <TouchableOpacity
                style={[styles.cancelBtn, { backgroundColor: colors.error + '15', borderColor: colors.error + '30' }]}
                onPress={resetForm}
              >
                <Ionicons name="close" size={14} color={colors.error} />
                <Text style={[styles.cancelBtnText, { color: colors.error }]}>
                  {language === 'ar' ? 'إلغاء' : 'Cancel'}
                </Text>
              </TouchableOpacity>
            )}
          </View>
        </LinearGradient>

        <View style={styles.formBody}>
          {/* Restaurant Images */}
          <ImageUploader
            mode="multiple"
            value={images}
            onChange={(v) => setImages(v as string[])}
            maxImages={15}
            aspectRatio={[16, 9]}
            size="medium"
            label={language === 'ar' ? 'صور المطعم' : 'Restaurant Images'}
            hint={language === 'ar' ? 'يمكنك إضافة حتى 15 صورة' : 'Up to 15 images'}
          />

          {/* Cuisine Origin */}
          <View style={styles.fieldGroup}>
            <View style={styles.fieldLabelRow}>
              <Ionicons name="business-outline" size={14} color={colors.primary} />
              <Text style={[styles.fieldLabel, { color: colors.text }]}>
                {language === 'ar' ? 'المنشأ / الفئة *' : 'Cuisine Origin *'}
              </Text>
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipScroll}>
              {brands.map((brand) => (
                <TouchableOpacity
                  key={brand.id}
                  style={[
                    styles.selectChip,
                    selectedBrandId === brand.id
                      ? { backgroundColor: colors.primary, borderColor: colors.primary }
                      : { backgroundColor: colors.surface, borderColor: colors.border },
                  ]}
                  onPress={() => setSelectedBrandId(brand.id)}
                >
                  <Text style={{ color: selectedBrandId === brand.id ? '#FFF' : colors.text, fontWeight: '600', fontSize: 13 }}>
                    {language === 'ar' ? brand.name_ar : brand.name}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>

          {/* Arabic Name */}
          <View style={styles.fieldGroup}>
            <View style={styles.fieldLabelRow}>
              <MaterialCommunityIcons name="translate" size={14} color={colors.primary} />
              <Text style={[styles.fieldLabel, { color: colors.text }]}>
                {language === 'ar' ? 'الاسم بالعربية *' : 'Arabic Name *'}
              </Text>
            </View>
            <TextInput
              style={[styles.textInput, { backgroundColor: colors.surface, borderColor: colors.border, color: colors.text, textAlign: isRTL ? 'right' : 'left' }]}
              value={nameAr}
              onChangeText={setNameAr}
              placeholder={language === 'ar' ? 'مثال: مطعم الكبسة' : 'e.g., مطعم الكبسة'}
              placeholderTextColor={colors.textSecondary}
            />
          </View>

          {/* English Name */}
          <View style={styles.fieldGroup}>
            <View style={styles.fieldLabelRow}>
              <Ionicons name="language-outline" size={14} color={colors.primary} />
              <Text style={[styles.fieldLabel, { color: colors.text }]}>
                {language === 'ar' ? 'الاسم بالإنجليزية *' : 'English Name *'}
              </Text>
            </View>
            <TextInput
              style={[styles.textInput, { backgroundColor: colors.surface, borderColor: colors.border, color: colors.text }]}
              value={name}
              onChangeText={setName}
              placeholder={language === 'ar' ? 'مثال: Kabsa Restaurant' : 'e.g., Kabsa Restaurant'}
              placeholderTextColor={colors.textSecondary}
            />
          </View>

          {/* Weekly Opening Hours */}
          <View style={styles.fieldGroup}>
            <View style={styles.fieldLabelRow}>
              <Ionicons name="time-outline" size={14} color={colors.primary} />
              <Text style={[styles.fieldLabel, { color: colors.text }]}>
                {language === 'ar' ? 'ساعات العمل الأسبوعية' : 'Weekly Opening Hours'}
              </Text>
            </View>
            <WeeklyHoursGrid
              schedule={weeklyHours}
              onChange={setWeeklyHours}
              colors={colors}
              language={language}
            />
          </View>

          {/* Location Code */}
          <View style={styles.fieldGroup}>
            <View style={styles.fieldLabelRow}>
              <MaterialCommunityIcons name="map-marker-radius" size={14} color={colors.primary} />
              <Text style={[styles.fieldLabel, { color: colors.text }]}>
                {language === 'ar' ? 'كود الموقع' : 'Location Code'}
              </Text>
            </View>
            <TextInput
              style={[styles.textInput, { backgroundColor: colors.surface, borderColor: colors.border, color: colors.text }]}
              value={chassisNumber}
              onChangeText={setChassisNumber}
              placeholder={language === 'ar' ? 'مثال: REST-A01' : 'e.g., REST-A01'}
              placeholderTextColor={colors.textSecondary}
              autoCapitalize="characters"
            />
            <Text style={[styles.helperText, { color: colors.textSecondary }]}>
              {language === 'ar' ? 'كود فريد للبحث السريع عن الموقع' : 'Unique code for quick location search'}
            </Text>
          </View>

          {/* Dietary Style */}
          <View style={styles.fieldGroup}>
            <View style={styles.fieldLabelRow}>
              <MaterialCommunityIcons name="leaf" size={14} color={colors.primary} />
              <Text style={[styles.fieldLabel, { color: colors.text }]}>
                {language === 'ar' ? 'النمط الغذائي' : 'Dietary Style'}
              </Text>
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipScroll}>
              {DIETARY_OPTIONS.map((opt) => (
                <TouchableOpacity
                  key={opt.key}
                  style={[
                    styles.dietChip,
                    fuelType === opt.key
                      ? { backgroundColor: opt.color, borderColor: opt.color }
                      : { backgroundColor: colors.surface, borderColor: colors.border },
                  ]}
                  onPress={() => setFuelType(opt.key)}
                >
                  <MaterialCommunityIcons
                    name={opt.icon}
                    size={12}
                    color={fuelType === opt.key ? '#FFF' : colors.textSecondary}
                  />
                  <Text style={{ color: fuelType === opt.key ? '#FFF' : colors.text, fontWeight: '600', fontSize: 12 }}>
                    {language === 'ar' ? opt.ar : opt.en}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>

          {/* Ingredients PDF */}
          <View style={styles.fieldGroup}>
            <View style={styles.fieldLabelRow}>
              <Ionicons name="document-text-outline" size={14} color={colors.primary} />
              <Text style={[styles.fieldLabel, { color: colors.text }]}>
                {language === 'ar' ? 'قائمة المكونات (PDF)' : 'Ingredients List (PDF)'}
              </Text>
            </View>
            <TouchableOpacity
              style={[styles.pdfButton, { backgroundColor: colors.primary + '10', borderColor: colors.primary + '40', opacity: pdfLoading ? 0.6 : 1 }]}
              onPress={pickCatalogPdf}
              disabled={pdfLoading}
            >
              <View style={[styles.pdfIconWrap, { backgroundColor: colors.primary + '20' }]}>
                {pdfLoading
                  ? <ActivityIndicator size="small" color={colors.primary} />
                  : <Ionicons name="document-text" size={20} color={colors.primary} />}
              </View>
              <View style={{ flex: 1 }}>
                {catalogPdfName ? (
                  <>
                    <Text style={[styles.pdfFileName, { color: colors.text }]} numberOfLines={1}>{catalogPdfName}</Text>
                    <Text style={styles.pdfSelectedText}>{language === 'ar' ? '✓ تم اختيار الملف' : '✓ File selected'}</Text>
                  </>
                ) : (
                  <>
                    <Text style={[styles.pdfUploadLabel, { color: colors.primary }]}>
                      {language === 'ar' ? 'اضغط لاختيار ملف PDF' : 'Tap to select PDF'}
                    </Text>
                    <Text style={[styles.pdfHelper, { color: colors.textSecondary }]}>
                      {language === 'ar' ? 'للمشتركين الكرام فقط' : 'For VIP subscribers only'}
                    </Text>
                  </>
                )}
              </View>
              {catalogPdfName && (
                <TouchableOpacity onPress={() => { setCatalogPdf(null); setCatalogPdfName(''); }}>
                  <Ionicons name="close-circle" size={20} color={colors.error} />
                </TouchableOpacity>
              )}
            </TouchableOpacity>
          </View>

          {/* Restaurant Video */}
          <View style={styles.fieldGroup}>
            <View style={styles.fieldLabelRow}>
              <Ionicons name="videocam-outline" size={14} color={colors.primary} />
              <Text style={[styles.fieldLabel, { color: colors.text }]}>
                {language === 'ar' ? 'فيديو المطعم' : 'Restaurant Video'}
              </Text>
            </View>
            <TextInput
              style={[styles.textInput, { backgroundColor: colors.surface, borderColor: colors.border, color: colors.text }]}
              value={videoUrl}
              onChangeText={setVideoUrl}
              placeholder={language === 'ar' ? 'رابط الفيديو (اختياري)' : 'Video URL (optional)'}
              placeholderTextColor={colors.textSecondary}
              autoCapitalize="none"
              keyboardType="url"
            />
            <Text style={[styles.helperText, { color: colors.textSecondary, marginBottom: 8 }]}>
              {language === 'ar' ? 'أو اختر ملف فيديو من الجهاز:' : 'Or pick a video file from device:'}
            </Text>
            <TouchableOpacity
              style={[styles.pdfButton, { backgroundColor: colors.primary + '10', borderColor: colors.primary + '40', opacity: videoLoading ? 0.6 : 1 }]}
              onPress={pickVideoFile}
              disabled={videoLoading}
            >
              <View style={[styles.pdfIconWrap, { backgroundColor: colors.primary + '20' }]}>
                {videoLoading
                  ? <ActivityIndicator size="small" color={colors.primary} />
                  : <Ionicons name="film-outline" size={20} color={colors.primary} />}
              </View>
              <View style={{ flex: 1 }}>
                {videoUrl ? (
                  <>
                    <Text style={[styles.pdfFileName, { color: colors.text }]} numberOfLines={1}>{videoUrl}</Text>
                    <Text style={styles.pdfSelectedText}>{language === 'ar' ? '✓ فيديو محدد' : '✓ Video set'}</Text>
                  </>
                ) : (
                  <>
                    <Text style={[styles.pdfUploadLabel, { color: colors.primary }]}>
                      {language === 'ar' ? 'اضغط لاختيار فيديو' : 'Tap to pick video file'}
                    </Text>
                    <Text style={[styles.pdfHelper, { color: colors.textSecondary }]}>
                      {language === 'ar' ? 'MP4، MOV، WebM...' : 'MP4, MOV, WebM…'}
                    </Text>
                  </>
                )}
              </View>
              {videoUrl ? (
                <TouchableOpacity onPress={() => setVideoUrl('')}>
                  <Ionicons name="close-circle" size={20} color={colors.error} />
                </TouchableOpacity>
              ) : null}
            </TouchableOpacity>
          </View>

          {/* Restaurant Location (Map) */}
          <View style={styles.fieldGroup}>
            <View style={styles.fieldLabelRow}>
              <Ionicons name="location-outline" size={14} color={colors.primary} />
              <Text style={[styles.fieldLabel, { color: colors.text }]}>
                {language === 'ar' ? 'موقع المطعم على الخريطة' : 'Restaurant Location'}
              </Text>
            </View>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <TextInput
                style={[styles.textInput, { flex: 1, backgroundColor: colors.surface, borderColor: colors.border, color: colors.text }]}
                value={latitude}
                onChangeText={setLatitude}
                placeholder={language === 'ar' ? 'خط العرض' : 'Latitude'}
                placeholderTextColor={colors.textSecondary}
                keyboardType="numbers-and-punctuation"
              />
              <TextInput
                style={[styles.textInput, { flex: 1, backgroundColor: colors.surface, borderColor: colors.border, color: colors.text }]}
                value={longitude}
                onChangeText={setLongitude}
                placeholder={language === 'ar' ? 'خط الطول' : 'Longitude'}
                placeholderTextColor={colors.textSecondary}
                keyboardType="numbers-and-punctuation"
              />
            </View>
            <TouchableOpacity
              style={[styles.pdfButton, { backgroundColor: colors.primary + '10', borderColor: colors.primary + '40', marginTop: 8, opacity: gpsLoading ? 0.6 : 1 }]}
              onPress={pickCurrentLocation}
              disabled={gpsLoading}
            >
              <View style={[styles.pdfIconWrap, { backgroundColor: colors.primary + '20' }]}>
                {gpsLoading
                  ? <ActivityIndicator size="small" color={colors.primary} />
                  : <Ionicons name="navigate-outline" size={20} color={colors.primary} />}
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.pdfUploadLabel, { color: colors.primary }]}>
                  {language === 'ar' ? 'استخدم موقعي الحالي' : 'Use my current location'}
                </Text>
                <Text style={[styles.pdfHelper, { color: colors.textSecondary }]}>
                  {language === 'ar' ? 'يتطلب إذن الموقع' : 'Requires location permission'}
                </Text>
              </View>
            </TouchableOpacity>
            {latitude && longitude && !Number.isNaN(parseFloat(latitude)) && !Number.isNaN(parseFloat(longitude)) ? (
              <View style={{ marginTop: 8 }}>
                <MapsPreviewStrip
                  latitude={parseFloat(latitude)}
                  longitude={parseFloat(longitude)}
                  height={160}
                />
              </View>
            ) : null}
          </View>

          {/* Default Receipt Language */}
          <View style={styles.fieldGroup}>
            <View style={styles.fieldLabelRow}>
              <Ionicons name="receipt-outline" size={14} color={colors.primary} />
              <Text style={[styles.fieldLabel, { color: colors.text }]}>
                {language === 'ar' ? 'لغة الإيصال الافتراضية' : 'Default Receipt Language'}
              </Text>
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipScroll}>
              {([
                { key: 'auto', en: 'Auto (UI)', ar: 'تلقائي (واجهة)' },
                { key: 'ar',   en: 'Arabic',   ar: 'عربي'           },
                { key: 'en',   en: 'English',  ar: 'إنجليزي'        },
              ] as const).map((opt) => (
                <TouchableOpacity
                  key={opt.key}
                  style={[
                    styles.dietChip,
                    receiptLanguage === opt.key
                      ? { backgroundColor: colors.primary, borderColor: colors.primary }
                      : { backgroundColor: colors.surface, borderColor: colors.border },
                  ]}
                  onPress={() => setReceiptLanguage(opt.key)}
                >
                  <Text style={{ color: receiptLanguage === opt.key ? '#FFF' : colors.text, fontWeight: '600', fontSize: 12 }}>
                    {language === 'ar' ? opt.ar : opt.en}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
            <Text style={[styles.helperText, { color: colors.textSecondary }]}>
              {language === 'ar'
                ? 'تلقائي: تتبع لغة واجهة المستخدم عند فتح الإيصال'
                : "Auto: follows the user's UI language when the receipt is opened"}
            </Text>
          </View>

          {/* Save Button — also disabled while any upload is in flight */}
          <TouchableOpacity
            style={[styles.saveWrap, (isSaving || anyUploading) && { opacity: 0.7 }]}
            onPress={handleSave}
            disabled={isSaving || anyUploading}
            activeOpacity={0.85}
          >
            <LinearGradient
              colors={[colors.primary, colors.primary + 'BB']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={styles.saveBtn}
            >
              {isSaving ? (
                <ActivityIndicator color="#FFF" size="small" />
              ) : (
                <>
                  <Ionicons name={isEditMode ? 'checkmark-circle' : 'add-circle'} size={20} color="#FFF" />
                  <Text style={styles.saveBtnText}>
                    {isEditMode
                      ? (language === 'ar' ? 'حفظ التعديلات' : 'Save Changes')
                      : (language === 'ar' ? 'إضافة المطعم' : 'Add Restaurant')}
                  </Text>
                </>
              )}
            </LinearGradient>
          </TouchableOpacity>
        </View>
      </View>

      {/* ── Search Bar Section ── */}
      <View style={[styles.searchCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <View style={styles.searchTitleRow}>
          <Text style={[styles.searchTitle, { color: colors.text }]}>
            {language === 'ar' ? 'المطاعم المضافة' : 'Added Restaurants'}
          </Text>
          <View style={[styles.countPill, { backgroundColor: colors.primary + '18' }]}>
            <Text style={[styles.countPillText, { color: colors.primary }]}>{modelsCount}</Text>
          </View>
        </View>
        <View style={[styles.searchBar, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Ionicons name="search" size={16} color={colors.textSecondary} />
          <TextInput
            style={[styles.searchInput, { color: colors.text }]}
            value={searchQuery}
            onChangeText={setSearchQuery}
            placeholder={language === 'ar' ? 'ابحث عن مطعم...' : 'Search restaurant...'}
            placeholderTextColor={colors.textSecondary}
          />
          {searchQuery.length > 0 && (
            <TouchableOpacity onPress={() => setSearchQuery('')}>
              <Ionicons name="close-circle" size={16} color={colors.textSecondary} />
            </TouchableOpacity>
          )}
        </View>
      </View>
    </View>
  );
});
ModelFormHeader.displayName = 'ModelFormHeader';

// ============================================================================
// Restaurant Card Component
// ============================================================================
const ModelListItem = memo(({
  model, brandName, colors, isDark, language, onEdit, onDelete,
}: {
  model: CarModel;
  brandName: string;
  colors: any;
  isDark: boolean;
  language: string;
  onEdit: (model: CarModel) => void;
  onDelete: (id: string) => void;
}) => {
  const diet = DIETARY_OPTIONS.find(d => d.key === model.fuel_type) || DIETARY_OPTIONS[0];
  const hasTimes = !!(model.year_start || model.year_end);

  return (
    <View style={[styles.restCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
      {/* Image / Placeholder Header */}
      <View style={styles.restCardImg}>
        {model.image_url ? (
          <Image source={{ uri: model.image_url }} style={StyleSheet.absoluteFillObject} resizeMode="cover" />
        ) : (
          <LinearGradient
            colors={isDark ? ['#0D1B2A', '#162340'] : ['#EEF6FF', '#DBEAFE']}
            style={[StyleSheet.absoluteFillObject, styles.restCardPlaceholder]}
          >
            <MaterialCommunityIcons name="silverware-fork-knife" size={56} color={colors.primary + '55'} />
          </LinearGradient>
        )}
        {/* Gradient overlay for readability */}
        <LinearGradient
          colors={['transparent', 'rgba(0,0,0,0.5)']}
          style={[StyleSheet.absoluteFillObject, { justifyContent: 'flex-end', padding: 10 }]}
        >
          <Text style={styles.restCardImgName} numberOfLines={1}>
            {model.name_ar || model.name}
          </Text>
        </LinearGradient>
        {/* Dietary badge */}
        <View style={[styles.restDietBadge, { backgroundColor: diet.color + 'EE' }]}>
          <MaterialCommunityIcons name={diet.icon} size={10} color="#FFF" />
          <Text style={styles.restDietText}>{language === 'ar' ? diet.ar : diet.en}</Text>
        </View>
      </View>

      {/* Body */}
      <View style={styles.restCardBody}>
        <Text style={[styles.restNameAr, { color: colors.text }]} numberOfLines={1}>
          {model.name_ar || model.name}
        </Text>
        <Text style={[styles.restNameEn, { color: colors.textSecondary }]} numberOfLines={1}>
          {model.name}
        </Text>

        {/* Info chips */}
        <View style={styles.restChipRow}>
          {brandName ? (
            <View style={[styles.restChip, { backgroundColor: colors.primary + '12', borderColor: colors.primary + '25' }]}>
              <Ionicons name="business" size={10} color={colors.primary} />
              <Text style={[styles.restChipText, { color: colors.primary }]} numberOfLines={1}>{brandName}</Text>
            </View>
          ) : null}
          {hasTimes ? (
            <View style={[styles.restChip, { backgroundColor: '#F59E0B12', borderColor: '#F59E0B30' }]}>
              <Ionicons name="time-outline" size={10} color="#F59E0B" />
              <Text style={[styles.restChipText, { color: '#F59E0B' }]}>
                {minutesToHHMM(model.year_start) ?? ''}
                {model.year_end != null ? ` — ${minutesToHHMM(model.year_end)}` : ''}
              </Text>
            </View>
          ) : null}
          {model.chassis_number ? (
            <View style={[styles.restChip, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <MaterialCommunityIcons name="map-marker-radius" size={10} color={colors.textSecondary} />
              <Text style={[styles.restChipText, { color: colors.textSecondary }]} numberOfLines={1}>
                {model.chassis_number}
              </Text>
            </View>
          ) : null}
          {(() => {
            const rl = model.receipt_language || 'auto';
            const isAr = rl === 'ar';
            const isEn = rl === 'en';
            const bg = isAr ? '#7C3AED12' : isEn ? '#0369A112' : colors.surface;
            const border = isAr ? '#7C3AED30' : isEn ? '#0369A130' : colors.border;
            const iconColor = isAr ? '#7C3AED' : isEn ? '#0369A1' : colors.textSecondary;
            return (
              <View style={[styles.restChip, { backgroundColor: bg, borderColor: border }]}>
                <Ionicons name="receipt-outline" size={10} color={iconColor} />
                <Text style={[styles.restChipText, { color: iconColor, fontWeight: '700' }]}>
                  {rl === 'auto' ? 'Auto' : rl.toUpperCase()}
                </Text>
              </View>
            );
          })()}
        </View>
      </View>

      {/* Divider */}
      <View style={[styles.restDivider, { backgroundColor: colors.border }]} />

      {/* Actions */}
      <View style={styles.restActions}>
        <TouchableOpacity
          style={[styles.restActionBtn, { backgroundColor: colors.primary + '12', borderColor: colors.primary + '25' }]}
          onPress={() => onEdit(model)}
          activeOpacity={0.75}
        >
          <Ionicons name="create-outline" size={15} color={colors.primary} />
          <Text style={[styles.restActionText, { color: colors.primary }]}>
            {language === 'ar' ? 'تعديل' : 'Edit'}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.restActionBtn, { backgroundColor: colors.error + '10', borderColor: colors.error + '22' }]}
          onPress={() => onDelete(model.id)}
          activeOpacity={0.75}
        >
          <Ionicons name="trash-outline" size={15} color={colors.error} />
          <Text style={[styles.restActionText, { color: colors.error }]}>
            {language === 'ar' ? 'حذف' : 'Delete'}
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
});
ModelListItem.displayName = 'ModelListItem';

// ============================================================================
// Interface Texts Preview — live mock of /car/[id] key sections
// ============================================================================
const GOLD_COLOR = '#C8A24A';

const PREVIEW_BLOCK_FIELD_MAP: Record<string, readonly string[]> = {
  hero: ['estLabel', 'dishCountLabel', 'cuisineSuffix', 'featuredLabel'],
  chef: ['chefLabel'],
  subscribe: ['subscribeBanner'],
  reserve: ['reserveTitle', 'reserveSub'],
  story: ['storySectionLabel', 'storyTitle', 'viewMenuLabel'],
  signature: ['signatureLabel', 'chefPickBadge'],
  menu: ['menuLabel', 'courseLabel', 'soldOutLabel', 'dishCountLabel'],
  empty: ['emptyTitle', 'emptyBody'],
};

function InterfaceTextsPreview({
  values, colors, language, previewLang, onPreviewLangChange, focusedFieldKey,
}: {
  values: Record<string, string>;
  colors: any;
  language: string;
  previewLang: string;
  onPreviewLangChange: (lang: string) => void;
  focusedFieldKey?: string | null;
}) {
  const ui = (key: string): string => {
    const activeKey = previewLang === 'ar' ? `${key}_ar` : `${key}_en`;
    return values[activeKey] !== undefined ? values[activeKey] : '';
  };

  const isBlockActive = (blockId: string): boolean => {
    if (!focusedFieldKey) return false;
    return (PREVIEW_BLOCK_FIELD_MAP[blockId] ?? []).includes(focusedFieldKey);
  };

  const blockStyle = (blockId: string) => {
    const active = isBlockActive(blockId);
    return [
      pvStyles.block,
      { backgroundColor: colors.card, borderColor: active ? colors.primary : colors.border },
      active && pvStyles.blockHighlight,
    ];
  };

  return (
    <View style={{ gap: 0 }}>
      {/* Preview header: note + AR/EN language toggle */}
      <View style={[pvStyles.previewHeader, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <Text style={[pvStyles.sectionNote, { color: colors.textSecondary }]}>
          {language === 'ar' ? '⬇ معاينة مباشرة — تتحدث مع كل تعديل' : '⬇ Live preview — updates as you type'}
        </Text>
        <View style={pvStyles.langToggle}>
          <TouchableOpacity
            style={[pvStyles.langPill, previewLang === 'ar' && { backgroundColor: colors.primary }]}
            onPress={() => onPreviewLangChange('ar')}
            activeOpacity={0.8}
          >
            <Text style={[pvStyles.langPillText, { color: previewLang === 'ar' ? '#FFF' : colors.textSecondary }]}>AR</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[pvStyles.langPill, previewLang === 'en' && { backgroundColor: colors.primary }]}
            onPress={() => onPreviewLangChange('en')}
            activeOpacity={0.8}
          >
            <Text style={[pvStyles.langPillText, { color: previewLang === 'en' ? '#FFF' : colors.textSecondary }]}>EN</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* ── Hero badges ── */}
      <View style={blockStyle('hero')}>
        <Text style={[pvStyles.blockTitle, { color: colors.primary }]}>
          {language === 'ar' ? 'قسم البطل — الشارات' : 'Hero Section — Badges'}
        </Text>
        {isBlockActive('hero') && (
          <Text style={[pvStyles.blockHint, { color: colors.primary }]}>
            {previewLang === 'ar' ? '← الحقل الذي تعدله يظهر هنا' : '← field you\'re editing appears here'}
          </Text>
        )}
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
          <View style={pvStyles.heroPill}>
            <Ionicons name="time-outline" size={12} color="#E8D29A" />
            <Text style={[pvStyles.heroPillText, previewLang === 'ar' && { writingDirection: 'rtl' }]}>{ui('estLabel')} 1998</Text>
          </View>
          <View style={pvStyles.heroPill}>
            <Ionicons name="restaurant-outline" size={12} color="#E8D29A" />
            <Text style={[pvStyles.heroPillText, previewLang === 'ar' && { writingDirection: 'rtl' }]}>24 {ui('dishCountLabel')}</Text>
          </View>
          <View style={pvStyles.heroPill}>
            <Ionicons name="star-outline" size={12} color="#E8D29A" />
            <Text style={[pvStyles.heroPillText, previewLang === 'ar' && { writingDirection: 'rtl' }]}>{ui('featuredLabel')}</Text>
          </View>
          <View style={pvStyles.heroPill}>
            <Ionicons name="globe-outline" size={12} color="#E8D29A" />
            <Text style={[pvStyles.heroPillText, previewLang === 'ar' && { writingDirection: 'rtl' }]}>Italian {ui('cuisineSuffix')}</Text>
          </View>
        </View>
      </View>

      {/* ── Chef card ── */}
      <View style={blockStyle('chef')}>
        <Text style={[pvStyles.blockTitle, { color: colors.primary }]}>
          {language === 'ar' ? 'بطاقة الشيف' : 'Chef Card'}
        </Text>
        {isBlockActive('chef') && (
          <Text style={[pvStyles.blockHint, { color: colors.primary }]}>
            {language === 'ar' ? '← الحقل الذي تعدله يظهر هنا' : '← field you\'re editing appears here'}
          </Text>
        )}
        <View style={{ marginTop: 10, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <View style={[pvStyles.chefAvatar, { backgroundColor: colors.primary + '20', borderColor: colors.primary + '40' }]}>
            <Ionicons name="person-outline" size={20} color={colors.primary} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[pvStyles.chefName, { color: colors.text }]}>Ahmad Al-Masri</Text>
            <Text style={[pvStyles.chefRole, { color: colors.textSecondary }, previewLang === 'ar' && { writingDirection: 'rtl', textAlign: 'right' }]}>{ui('chefLabel')}</Text>
          </View>
        </View>
      </View>

      {/* ── Subscribe banner ── */}
      <View style={blockStyle('subscribe')}>
        <Text style={[pvStyles.blockTitle, { color: colors.primary }]}>
          {language === 'ar' ? 'شريط الاشتراك' : 'Subscribe Banner'}
        </Text>
        {isBlockActive('subscribe') && (
          <Text style={[pvStyles.blockHint, { color: colors.primary }]}>
            {language === 'ar' ? '← الحقل الذي تعدله يظهر هنا' : '← field you\'re editing appears here'}
          </Text>
        )}
        <View style={{ marginTop: 10, borderRadius: 10, overflow: 'hidden' }}>
          <LinearGradient
            colors={['#0B0B0E', '#1C1C22', '#2A2218']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={pvStyles.subscribeBanner}
          >
            <View style={pvStyles.bannerEdge} />
            <Ionicons name="sparkles" size={13} color={GOLD_COLOR} />
            <Text style={[pvStyles.subscribeBannerText, previewLang === 'ar' && { writingDirection: 'rtl', textAlign: 'right' }]} numberOfLines={2}>{ui('subscribeBanner')}</Text>
            <Ionicons name="sparkles" size={13} color={GOLD_COLOR} />
            <View style={pvStyles.bannerEdgeRight} />
          </LinearGradient>
        </View>
      </View>

      {/* ── Reserve button ── */}
      <View style={blockStyle('reserve')}>
        <Text style={[pvStyles.blockTitle, { color: colors.primary }]}>
          {language === 'ar' ? 'زر الحجز' : 'Reserve Button'}
        </Text>
        {isBlockActive('reserve') && (
          <Text style={[pvStyles.blockHint, { color: colors.primary }]}>
            {language === 'ar' ? '← الحقل الذي تعدله يظهر هنا' : '← field you\'re editing appears here'}
          </Text>
        )}
        <View style={{ marginTop: 10, borderRadius: 12, overflow: 'hidden' }}>
          <LinearGradient
            colors={['#C8A24A', '#E8D29A', '#C8A24A']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={pvStyles.reserveGradient}
          >
            <View style={pvStyles.reserveIcon}>
              <Ionicons name="star" size={18} color="#FFF" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[pvStyles.reserveTitle, previewLang === 'ar' && { writingDirection: 'rtl', textAlign: 'right' }]} numberOfLines={1}>{ui('reserveTitle')}</Text>
              <Text style={[pvStyles.reserveSub, previewLang === 'ar' && { writingDirection: 'rtl', textAlign: 'right' }]} numberOfLines={1}>{ui('reserveSub')}</Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color="#1B1B1F" />
          </LinearGradient>
        </View>
      </View>

      {/* ── Story block ── */}
      <View style={blockStyle('story')}>
        <Text style={[pvStyles.blockTitle, { color: colors.primary }]}>
          {language === 'ar' ? 'قسم القصة' : 'Story Block'}
        </Text>
        {isBlockActive('story') && (
          <Text style={[pvStyles.blockHint, { color: colors.primary }]}>
            {language === 'ar' ? '← الحقل الذي تعدله يظهر هنا' : '← field you\'re editing appears here'}
          </Text>
        )}
        <View style={{ marginTop: 10, alignItems: 'center', gap: 8 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <View style={[pvStyles.rule, { backgroundColor: colors.primary }]} />
            <Text style={[pvStyles.sectionLabel, { color: colors.primary }, previewLang === 'ar' && { writingDirection: 'rtl' }]}>{ui('storySectionLabel').toUpperCase()}</Text>
            <View style={[pvStyles.rule, { backgroundColor: colors.primary }]} />
          </View>
          <Text style={[pvStyles.storyTitle, { color: colors.text }, previewLang === 'ar' && { writingDirection: 'rtl', textAlign: 'right' }]} numberOfLines={2}>{ui('storyTitle')}</Text>
          <View style={[pvStyles.menuPdfChip, { borderColor: colors.primary + '60', backgroundColor: colors.primary + '10' }]}>
            <Ionicons name="document-text-outline" size={13} color={colors.primary} />
            <Text style={[pvStyles.menuPdfText, { color: colors.primary }, previewLang === 'ar' && { writingDirection: 'rtl' }]} numberOfLines={1}>{ui('viewMenuLabel')}</Text>
          </View>
        </View>
      </View>

      {/* ── Signature dishes header ── */}
      <View style={blockStyle('signature')}>
        <Text style={[pvStyles.blockTitle, { color: colors.primary }]}>
          {language === 'ar' ? 'قسم الأطباق المميزة' : 'Signature Dishes'}
        </Text>
        {isBlockActive('signature') && (
          <Text style={[pvStyles.blockHint, { color: colors.primary }]}>
            {language === 'ar' ? '← الحقل الذي تعدله يظهر هنا' : '← field you\'re editing appears here'}
          </Text>
        )}
        <View style={{ marginTop: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <Text style={[pvStyles.sectionTitle, { color: colors.text }, previewLang === 'ar' && { writingDirection: 'rtl', textAlign: 'right' }]}>{ui('signatureLabel')}</Text>
          <View style={pvStyles.chefBadge}>
            <Ionicons name="star" size={10} color="#1B1B1F" />
            <Text style={pvStyles.chefBadgeText}>{ui('chefPickBadge')}</Text>
          </View>
        </View>
      </View>

      {/* ── Menu accordion header ── */}
      <View style={blockStyle('menu')}>
        <Text style={[pvStyles.blockTitle, { color: colors.primary }]}>
          {language === 'ar' ? 'رأس قسم القائمة' : 'Menu Accordion Header'}
        </Text>
        {isBlockActive('menu') && (
          <Text style={[pvStyles.blockHint, { color: colors.primary }]}>
            {language === 'ar' ? '← الحقل الذي تعدله يظهر هنا' : '← field you\'re editing appears here'}
          </Text>
        )}
        <View style={{ marginTop: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
          <Text style={[pvStyles.sectionTitle, { color: colors.text }]}>{ui('menuLabel')}</Text>
          <Text style={[pvStyles.sectionCount, { color: colors.textSecondary }]}>12 {ui('dishCountLabel')}</Text>
        </View>
        <View style={[pvStyles.courseCard, { backgroundColor: colors.surface, borderColor: colors.primary + '50' }]}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 12 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 }}>
              <View style={[pvStyles.courseIndex, { borderColor: colors.primary + '40' }]}>
                <Text style={[pvStyles.courseIndexText, { color: colors.primary }]}>01</Text>
              </View>
              <View>
                <Text style={[pvStyles.courseLabel, { color: colors.primary }]}>{ui('courseLabel').toUpperCase()}</Text>
                <Text style={[pvStyles.courseTitle, { color: colors.text }]}>Starters</Text>
              </View>
            </View>
            <Ionicons name="chevron-up" size={16} color={colors.primary} />
          </View>
          <View style={[pvStyles.soldOutRow, { borderTopColor: colors.border }]}>
            <View style={[pvStyles.soldOutBadge, { backgroundColor: colors.error + '12' }]}>
              <Text style={[pvStyles.soldOutText, { color: colors.error }]}>{ui('soldOutLabel')}</Text>
            </View>
          </View>
        </View>
      </View>

      {/* ── Empty state ── */}
      <View style={blockStyle('empty')}>
        <Text style={[pvStyles.blockTitle, { color: colors.primary }]}>
          {language === 'ar' ? 'الحالة الفارغة' : 'Empty State'}
        </Text>
        {isBlockActive('empty') && (
          <Text style={[pvStyles.blockHint, { color: colors.primary }]}>
            {language === 'ar' ? '← الحقل الذي تعدله يظهر هنا' : '← field you\'re editing appears here'}
          </Text>
        )}
        <View style={{ marginTop: 10, alignItems: 'center', gap: 6, paddingVertical: 8 }}>
          <Ionicons name="restaurant-outline" size={28} color={colors.textSecondary} />
          <Text style={[pvStyles.emptyTitle, { color: colors.text }]}>{ui('emptyTitle')}</Text>
          <Text style={[pvStyles.emptyBody, { color: colors.textSecondary }]} numberOfLines={3}>{ui('emptyBody')}</Text>
        </View>
      </View>
    </View>
  );
}

const pvStyles = StyleSheet.create({
  previewHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderRadius: 10,
    borderWidth: 1,
    paddingVertical: 6,
    paddingHorizontal: 12,
    marginBottom: 12,
    gap: 8,
  },
  sectionNote: {
    flex: 1,
    fontSize: 12,
    fontWeight: '600',
    textAlign: 'center',
  },
  langToggle: {
    flexDirection: 'row',
    borderRadius: 999,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.12)',
  },
  langPill: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
  },
  langPillText: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  block: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 14,
    marginBottom: 12,
  },
  blockHighlight: {
    borderWidth: 2,
    shadowColor: '#C8A24A',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.35,
    shadowRadius: 8,
    elevation: 4,
  },
  blockHint: { fontSize: 10, fontWeight: '700', letterSpacing: 0.4, marginTop: 3, opacity: 0.8 },
  blockTitle: { fontSize: 11, fontWeight: '800', letterSpacing: 1.2, textTransform: 'uppercase' },
  heroPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: 'rgba(247,242,233,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(232,210,154,0.32)',
  },
  heroPillText: { fontSize: 12, color: '#E8D29A', fontWeight: '600' },
  subscribeBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    paddingHorizontal: 16,
    gap: 6,
    position: 'relative',
  },
  bannerEdge: { position: 'absolute', left: 0, top: 0, bottom: 0, width: 3, backgroundColor: GOLD_COLOR },
  bannerEdgeRight: { position: 'absolute', right: 0, top: 0, bottom: 0, width: 3, backgroundColor: GOLD_COLOR },
  subscribeBannerText: { flex: 1, fontSize: 12, color: '#FFFFFF', fontWeight: '700', letterSpacing: 0.4, textAlign: 'center' },
  reserveGradient: { flexDirection: 'row', alignItems: 'center', paddingVertical: 14, paddingHorizontal: 14, gap: 12 },
  reserveIcon: { width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(27,27,31,0.18)', alignItems: 'center', justifyContent: 'center' },
  reserveTitle: { fontSize: 16, fontWeight: '600', color: '#1B1B1F', letterSpacing: 0.1 },
  reserveSub: { fontSize: 12, color: 'rgba(27,27,31,0.7)', fontWeight: '500' },
  rule: { width: 24, height: 1, opacity: 0.6 },
  sectionLabel: { fontSize: 11, fontWeight: '700', letterSpacing: 1.6 },
  storyTitle: { fontSize: 20, fontWeight: '700', letterSpacing: 0.15, textAlign: 'center' },
  menuPdfChip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, paddingVertical: 6, borderRadius: 999, borderWidth: 1, marginTop: 4 },
  menuPdfText: { fontSize: 13, fontWeight: '700', letterSpacing: 0.4 },
  sectionTitle: { fontSize: 20, fontWeight: '600', letterSpacing: 0.1 },
  sectionCount: { fontSize: 12, fontWeight: '600' },
  chefBadge: { flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, backgroundColor: '#E8D29A' },
  chefBadgeText: { fontSize: 10, fontWeight: '700', color: '#1B1B1F', letterSpacing: 0.6 },
  courseCard: { borderRadius: 12, borderWidth: 1, overflow: 'hidden' },
  courseIndex: { width: 34, height: 34, borderRadius: 17, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  courseIndexText: { fontSize: 12, fontWeight: '800' },
  courseLabel: { fontSize: 11, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 1 },
  courseTitle: { fontSize: 16, fontWeight: '600' },
  soldOutRow: { paddingHorizontal: 12, paddingVertical: 10, borderTopWidth: StyleSheet.hairlineWidth },
  soldOutBadge: { alignSelf: 'flex-start', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  soldOutText: { fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.6 },
  emptyTitle: { fontSize: 18, fontWeight: '600' },
  emptyBody: { fontSize: 13, textAlign: 'center', lineHeight: 20 },
  chefAvatar: { width: 44, height: 44, borderRadius: 22, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  chefName: { fontSize: 14, fontWeight: '700', marginBottom: 2 },
  chefRole: { fontSize: 12, fontWeight: '500' },
});

// ============================================================================
// Interface Texts Panel — CMS for hardcoded strings on the /car/[id] screen
// ============================================================================
const TEXT_FIELD_GROUPS = [
  {
    key: 'hero',
    label_ar: 'قسم البطل',
    label_en: 'Hero Section',
    icon: 'image-outline' as const,
    fields: [
      { key: 'estLabel', label_ar: 'تسمية التأسيس', label_en: 'Established Label', default_ar: 'منذ', default_en: 'Est.' },
      { key: 'dishCountLabel', label_ar: 'عداد الأطباق', label_en: 'Dish Count Label', default_ar: 'طبق', default_en: 'dishes' },
      { key: 'cuisineSuffix', label_ar: 'لاحقة المطبخ', label_en: 'Cuisine Suffix', default_ar: 'مطبخ', default_en: 'cuisine' },
      { key: 'featuredLabel', label_ar: 'تسمية المطعم المميز', label_en: 'Featured Label', default_ar: 'مطعم مميز', default_en: 'Featured restaurant' },
    ],
  },
  {
    key: 'chef',
    label_ar: 'بطاقة الشيف',
    label_en: 'Chef Card',
    icon: 'person-outline' as const,
    fields: [
      { key: 'chefLabel', label_ar: 'لقب الشيف', label_en: 'Chef Title', default_ar: 'الشيف المسؤول', default_en: "Head Chef & Maître d'" },
    ],
  },
  {
    key: 'subscribe',
    label_ar: 'الاشتراك والحجز',
    label_en: 'Subscribe & Reserve',
    icon: 'star-outline' as const,
    fields: [
      { key: 'subscribeBanner', label_ar: 'نص شريط الاشتراك', label_en: 'Subscribe Banner', default_ar: 'اشترك للاطلاع على القائمة الكاملة وحجز الطاولة', default_en: 'Subscribe to view the full menu & reserve a table' },
      { key: 'reserveTitle', label_ar: 'عنوان زر الحجز', label_en: 'Reserve Button Title', default_ar: 'احجز تجربتك الراقية', default_en: 'Reserve your experience' },
      { key: 'reserveSub', label_ar: 'وصف زر الحجز', label_en: 'Reserve Button Subtitle', default_ar: 'مزايا حصرية للأعضاء', default_en: 'Exclusive member privileges' },
    ],
  },
  {
    key: 'story',
    label_ar: 'قسم القصة',
    label_en: 'Story Section',
    icon: 'book-outline' as const,
    fields: [
      { key: 'storySectionLabel', label_ar: 'تسمية القسم', label_en: 'Section Label', default_ar: 'حكاية المطعم', default_en: 'The Story' },
      { key: 'storyTitle', label_ar: 'عنوان القصة', label_en: 'Story Title', default_ar: 'لمحة عن التجربة', default_en: 'About this restaurant' },
      { key: 'viewMenuLabel', label_ar: 'نص زر PDF', label_en: 'View Menu Label', default_ar: 'عرض القائمة الكاملة (PDF)', default_en: 'View the full menu (PDF)' },
    ],
  },
  {
    key: 'signature',
    label_ar: 'الأطباق المميزة',
    label_en: 'Signature Dishes',
    icon: 'restaurant-outline' as const,
    fields: [
      { key: 'signatureLabel', label_ar: 'عنوان القسم', label_en: 'Section Title', default_ar: 'أطباقنا المميزة', default_en: 'Signature Dishes' },
      { key: 'chefPickBadge', label_ar: 'شارة اختيار الشيف', label_en: "Chef's Pick Badge", default_ar: 'موصى به', default_en: "Chef's pick" },
    ],
  },
  {
    key: 'menu',
    label_ar: 'قسم القائمة',
    label_en: 'Menu Section',
    icon: 'list-outline' as const,
    fields: [
      { key: 'menuLabel', label_ar: 'عنوان القائمة', label_en: 'Menu Title', default_ar: 'القائمة', default_en: 'The Menu' },
      { key: 'courseLabel', label_ar: 'تسمية الفصل', label_en: 'Course Label', default_ar: 'فصل', default_en: 'Course' },
      { key: 'soldOutLabel', label_ar: 'نص نفاد المخزون', label_en: 'Sold Out Label', default_ar: 'نفذت الكمية', default_en: 'Sold out' },
    ],
  },
  {
    key: 'empty',
    label_ar: 'الحالة الفارغة',
    label_en: 'Empty State',
    icon: 'alert-circle-outline' as const,
    fields: [
      { key: 'emptyTitle', label_ar: 'عنوان الحالة الفارغة', label_en: 'Empty State Title', default_ar: 'القائمة قيد التحضير', default_en: 'Menu coming soon' },
      { key: 'emptyBody', label_ar: 'وصف الحالة الفارغة', label_en: 'Empty State Body', default_ar: 'يعمل طاقمنا على تقديم تجربة استثنائية. تابعونا قريباً.', default_en: 'Our chefs are crafting an exceptional experience. Stay tuned.' },
    ],
  },
] as const;

function InterfaceTextsPanel({
  colors, isDark, language, isRTL,
}: { colors: any; isDark: boolean; language: string; isRTL: boolean }) {
  const queryClient = useQueryClient();
  const [values, setValues] = useState<Record<string, string>>({});
  const [hydrated, setHydrated] = useState(false);
  const [saving, setSaving] = useState(false);
  const [toastVisible, setToastVisible] = useState(false);
  const [toastMsg, setToastMsg] = useState('');
  const [toastType, setToastType] = useState<'success' | 'error'>('success');
  const [previewMode, setPreviewMode] = useState(false);
  const adminPreviewLang = useAppStore((s) => s.adminPreviewLang);
  const setAdminPreviewLang = useAppStore((s) => s.setAdminPreviewLang);
  // Use persisted adminPreviewLang from store; default to UI language on first use.
  const previewLangInitialized = useRef(false);
  useEffect(() => {
    if (!previewLangInitialized.current && adminPreviewLang === null) {
      setAdminPreviewLang(language === 'ar' ? 'ar' : 'en');
      previewLangInitialized.current = true;
    } else if (!previewLangInitialized.current) {
      previewLangInitialized.current = true;
    }
  }, [language, adminPreviewLang, setAdminPreviewLang]);
  const previewLang: string = adminPreviewLang ?? language;
  const setPreviewLang = useCallback((lang: string) => {
    setAdminPreviewLang(lang === 'ar' ? 'ar' : 'en');
  }, [setAdminPreviewLang]);
  const [focusedFieldKey, setFocusedFieldKey] = useState<string | null>(null);
  const { width: screenWidth } = useWindowDimensions();
  const isWide = screenWidth >= 768;

  const { data: settingData, isLoading } = useQuery({
    queryKey: ['admin-settings', 'car_interface_texts'],
    queryFn: async () => {
      try {
        const r = await api.get('/admin/settings/car_interface_texts');
        return (r.data?.value ?? {}) as Record<string, string>;
      } catch {
        return {} as Record<string, string>;
      }
    },
    staleTime: 60 * 1000,
  });

  useEffect(() => {
    if (settingData !== undefined && !hydrated) {
      const merged: Record<string, string> = {};
      for (const group of TEXT_FIELD_GROUPS) {
        for (const field of group.fields) {
          const arKey = `${field.key}_ar`;
          const enKey = `${field.key}_en`;
          merged[arKey] = settingData[arKey] !== undefined ? settingData[arKey] : field.default_ar;
          merged[enKey] = settingData[enKey] !== undefined ? settingData[enKey] : field.default_en;
        }
      }
      setValues(merged);
      setHydrated(true);
    }
  }, [settingData, hydrated]);

  const setField = useCallback((key: string, val: string) => {
    setValues(prev => ({ ...prev, [key]: val }));
  }, []);

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      await api.put('/admin/settings/car_interface_texts', { value: values });
      queryClient.invalidateQueries({ queryKey: ['admin-settings', 'car_interface_texts'] });
      setToastMsg(language === 'ar' ? 'تم حفظ النصوص بنجاح' : 'Interface texts saved');
      setToastType('success');
    } catch {
      setToastMsg(language === 'ar' ? 'فشل الحفظ، حاول مرة أخرى' : 'Save failed, try again');
      setToastType('error');
    } finally {
      setSaving(false);
      setToastVisible(true);
    }
  }, [values, language, queryClient]);

  if (isLoading && !hydrated) {
    const shimmer = colors.primary + '18';
    const shimmerDark = colors.border;
    return (
      <View style={{ padding: 16, gap: 14 }}>
        {[1, 2, 3, 4].map((n) => (
          <View key={n} style={[itStyles.groupCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={{ height: 40, backgroundColor: shimmer, borderRadius: 8, marginBottom: 12 }} />
            <View style={{ gap: 10 }}>
              {[1, 2].map((f) => (
                <View key={f} style={{ gap: 6 }}>
                  <View style={{ height: 12, width: '40%', backgroundColor: shimmerDark, borderRadius: 4 }} />
                  <View style={{ height: 40, backgroundColor: shimmerDark, borderRadius: 8 }} />
                  <View style={{ height: 12, width: '35%', backgroundColor: shimmerDark, borderRadius: 4 }} />
                  <View style={{ height: 40, backgroundColor: shimmerDark, borderRadius: 8 }} />
                </View>
              ))}
            </View>
          </View>
        ))}
      </View>
    );
  }

  const fieldGroupsJsx = TEXT_FIELD_GROUPS.map((group) => (
    <View
      key={group.key}
      style={[itStyles.groupCard, { backgroundColor: colors.card, borderColor: colors.border }]}
    >
      <LinearGradient
        colors={isDark ? [colors.primary + '18', colors.primary + '06'] : [colors.primary + '10', colors.primary + '04']}
        style={itStyles.groupHeader}
      >
        <View style={[itStyles.groupIconWrap, { backgroundColor: colors.primary + '20' }]}>
          <Ionicons name={group.icon} size={16} color={colors.primary} />
        </View>
        <Text style={[itStyles.groupTitle, { color: colors.primary }]}>
          {language === 'ar' ? group.label_ar : group.label_en}
        </Text>
      </LinearGradient>

      <View style={itStyles.groupBody}>
        {group.fields.map((field) => {
          const arKey = `${field.key}_ar`;
          const enKey = `${field.key}_en`;
          return (
            <View key={field.key} style={itStyles.fieldPair}>
              {/* Arabic */}
              <View style={itStyles.fieldHalf}>
                <View style={itStyles.fieldLabelRow}>
                  <Text style={[itStyles.fieldLang, { backgroundColor: colors.primary + '18', color: colors.primary }]}>ع</Text>
                  <Text style={[itStyles.fieldLabel, { color: colors.text }]}>
                    {field.label_ar}
                  </Text>
                </View>
                <TextInput
                  style={[itStyles.input, { backgroundColor: colors.surface, borderColor: colors.border, color: colors.text, textAlign: 'right' }]}
                  value={values[arKey] !== undefined ? values[arKey] : field.default_ar}
                  onChangeText={(v) => setField(arKey, v)}
                  onFocus={() => setFocusedFieldKey(field.key)}
                  onBlur={() => setFocusedFieldKey(null)}
                  placeholder={field.default_ar}
                  placeholderTextColor={colors.textSecondary}
                />
              </View>
              {/* English */}
              <View style={itStyles.fieldHalf}>
                <View style={itStyles.fieldLabelRow}>
                  <Text style={[itStyles.fieldLang, { backgroundColor: colors.textSecondary + '20', color: colors.textSecondary }]}>EN</Text>
                  <Text style={[itStyles.fieldLabel, { color: colors.text }]}>
                    {field.label_en}
                  </Text>
                </View>
                <TextInput
                  style={[itStyles.input, { backgroundColor: colors.surface, borderColor: colors.border, color: colors.text }]}
                  value={values[enKey] !== undefined ? values[enKey] : field.default_en}
                  onChangeText={(v) => setField(enKey, v)}
                  onFocus={() => setFocusedFieldKey(field.key)}
                  onBlur={() => setFocusedFieldKey(null)}
                  placeholder={field.default_en}
                  placeholderTextColor={colors.textSecondary}
                />
              </View>
            </View>
          );
        })}
      </View>
    </View>
  ));

  const saveButtonJsx = (
    <TouchableOpacity
      style={[itStyles.saveWrap, saving && { opacity: 0.7 }]}
      onPress={handleSave}
      disabled={saving}
      activeOpacity={0.85}
    >
      <LinearGradient
        colors={[colors.primary, colors.primary + 'BB']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 0 }}
        style={itStyles.saveBtn}
      >
        {saving ? (
          <ActivityIndicator color="#FFF" size="small" />
        ) : (
          <>
            <Ionicons name="save-outline" size={20} color="#FFF" />
            <Text style={itStyles.saveBtnText}>
              {language === 'ar' ? 'حفظ النصوص' : 'Save Texts'}
            </Text>
          </>
        )}
      </LinearGradient>
    </TouchableOpacity>
  );

  const previewJsx = (
    <InterfaceTextsPreview
      values={values}
      colors={colors}
      language={language}
      previewLang={previewLang}
      onPreviewLangChange={setPreviewLang}
      focusedFieldKey={focusedFieldKey}
    />
  );

  return (
    <View>
      {/* Header card */}
      <LinearGradient
        colors={isDark ? ['#0D1B2A', '#16213E'] : ['#EEF6FF', '#DBEAFE']}
        style={[itStyles.headerCard, { borderColor: colors.primary + '30' }]}
      >
        <View style={itStyles.headerInner}>
          <View style={[itStyles.headerIcon, { backgroundColor: colors.primary + '25' }]}>
            <Ionicons name={(isWide || previewMode) ? 'eye-outline' : 'text-outline'} size={22} color={colors.primary} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[itStyles.headerTitle, { color: colors.text }]}>
              {language === 'ar' ? 'نصوص واجهة صفحة المطعم' : 'Restaurant Screen Interface Texts'}
            </Text>
            <Text style={[itStyles.headerSub, { color: colors.textSecondary }]}>
              {isWide
                ? (language === 'ar' ? 'التعديل والمعاينة جنبًا إلى جنب' : 'Edit and preview side by side')
                : (language === 'ar'
                  ? 'تحكم في جميع النصوص الظاهرة في صفحة تفاصيل المطعم'
                  : 'Control all text displayed on the restaurant detail screen')}
            </Text>
          </View>
          {/* Preview toggle — hidden on wide screens where both panes are always visible */}
          {!isWide && (
            <TouchableOpacity
              style={[itStyles.previewToggle, {
                backgroundColor: previewMode ? colors.primary : colors.primary + '18',
                borderColor: colors.primary + '40',
              }]}
              onPress={() => {
                if (Platform.OS !== 'web') {
                  // Smooth height-animated transition between Edit and Preview on narrow screens.
                  // Avoid on web — LayoutAnimation triggers warnings under react-native-web.
                  // eslint-disable-next-line @typescript-eslint/no-var-requires
                  const RN = require('react-native');
                  if (RN?.UIManager?.setLayoutAnimationEnabledExperimental) {
                    RN.UIManager.setLayoutAnimationEnabledExperimental(true);
                  }
                  RN?.LayoutAnimation?.configureNext?.(RN.LayoutAnimation.Presets.easeInEaseOut);
                }
                setPreviewMode(v => !v);
              }}
              activeOpacity={0.8}
            >
              <Ionicons
                name={previewMode ? 'eye' : 'eye-outline'}
                size={15}
                color={previewMode ? '#FFF' : colors.primary}
              />
              <Text style={[itStyles.previewToggleText, { color: previewMode ? '#FFF' : colors.primary }]}>
                {previewMode
                  ? (language === 'ar' ? 'تعديل' : 'Edit')
                  : (language === 'ar' ? 'معاينة' : 'Preview')}
              </Text>
            </TouchableOpacity>
          )}
        </View>
      </LinearGradient>

      {isWide ? (
        /* ── Wide screen: side-by-side split pane ── */
        <View style={itStyles.splitRow}>
          {/* Left column: field groups + save button */}
          <View style={itStyles.splitLeft}>
            {fieldGroupsJsx}
            {saveButtonJsx}
          </View>
          {/* Right column: live preview — always visible */}
          <View style={itStyles.splitRight}>
            {previewJsx}
          </View>
        </View>
      ) : (
        /* ── Narrow screen: stacked toggle layout ── */
        <>
          {fieldGroupsJsx}
          {previewMode && previewJsx}
          {saveButtonJsx}
        </>
      )}

      <Toast visible={toastVisible} message={toastMsg} type={toastType} onDismiss={() => setToastVisible(false)} />
    </View>
  );
}

const itStyles = StyleSheet.create({
  loadingWrap: { padding: 48, alignItems: 'center', gap: 12 },
  loadingText: { fontSize: 14 },
  headerCard: { borderRadius: 16, borderWidth: 1, padding: 14, marginBottom: 16 },
  headerInner: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  headerIcon: { width: 46, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 15, fontWeight: '700', marginBottom: 2 },
  headerSub: { fontSize: 12 },
  groupCard: { borderRadius: 14, borderWidth: 1, marginBottom: 14, overflow: 'hidden' },
  groupHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12 },
  groupIconWrap: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  groupTitle: { fontSize: 14, fontWeight: '700' },
  groupBody: { padding: 14, gap: 14 },
  fieldPair: { gap: 10 },
  fieldHalf: { gap: 6 },
  fieldLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  fieldLang: { fontSize: 10, fontWeight: '800', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
  fieldLabel: { fontSize: 12, fontWeight: '600' },
  input: { borderWidth: 1.5, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14 },
  saveWrap: { borderRadius: 12, overflow: 'hidden', marginBottom: 8, marginTop: 4 },
  saveBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', padding: 14, gap: 8 },
  saveBtnText: { color: '#FFF', fontSize: 15, fontWeight: '700' },
  previewToggle: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 7, borderRadius: 10, borderWidth: 1, flexShrink: 0 },
  previewToggleText: { fontSize: 12, fontWeight: '700' },
  splitRow: { flexDirection: 'row', gap: 16, alignItems: 'flex-start' },
  splitLeft: { flex: 1 },
  splitRight: { flex: 1 },
});

// ============================================================================
// Main Component
// ============================================================================
function ModelsAdmin() {
  const { colors, isDark } = useTheme();
  const { language, isRTL } = useTranslation();
  const { showConfirm, ConfirmModalNode } = useConfirmModal();
  const router = useRouter();
  const queryClient = useQueryClient();
  const adminSync = useAdminSync();
  const insets = useSafeAreaInsets();

  const [selectedBrandId, setSelectedBrandId] = useState('');
  const [name, setName] = useState('');
  const [nameAr, setNameAr] = useState('');
  const [yearFrom, setYearFrom] = useState('');
  const [yearTo, setYearTo] = useState('');
  const [chassisNumber, setChassisNumber] = useState('');
  const [images, setImages] = useState<string[]>([]);
  const [catalogPdf, setCatalogPdf] = useState<string | null>(null);
  const [catalogPdfName, setCatalogPdfName] = useState('');
  const [videoUrl, setVideoUrl] = useState('');
  const [latitude, setLatitude] = useState('');
  const [longitude, setLongitude] = useState('');
  const [receiptLanguage, setReceiptLanguage] = useState('auto');
  const [editingModel, setEditingModel] = useState<CarModel | null>(null);
  const [isEditMode, setIsEditMode] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [fuelType, setFuelType] = useState('regular');
  const [weeklyHours, setWeeklyHours] = useState<DaySchedule[]>(makeDefaultWeeklyHours);
  const weeklyHoursRef = React.useRef<DaySchedule[]>(weeklyHours);
  useEffect(() => { weeklyHoursRef.current = weeklyHours; }, [weeklyHours]);
  const [toastVisible, setToastVisible] = useState(false);
  const [toastMessage, setToastMessage] = useState('');
  const [toastType, setToastType] = useState<'success' | 'error' | 'warning' | 'info'>('success');
  const [activeTab, setActiveTab] = useState(0);
  const [sortBy, setSortBy] = useState<'name_asc' | 'name_desc' | 'newest'>('newest');
  const [brandFilter, setBrandFilter] = useState('');

  const { data: brandsData } = useQuery({
    queryKey: queryKeys.carBrands.all,
    queryFn: async () => { const r = await carBrandsApi.getAll(); return r.data || []; },
    staleTime: 5 * 60 * 1000,
  });
  const brands: CarBrand[] = brandsData || [];

  const { data: modelsData, isLoading, isRefetching, refetch } = useQuery({
    queryKey: queryKeys.carModels.all,
    queryFn: async () => { const r = await carModelsApi.getAll(); return r.data || []; },
    staleTime: 2 * 60 * 1000,
  });
  const models: CarModel[] = modelsData || [];

  const brandNameMap = useMemo(() => {
    const map: Record<string, { name: string; name_ar: string }> = {};
    brands.forEach(b => { map[b.id] = { name: b.name, name_ar: b.name_ar }; });
    return map;
  }, [brands]);

  const getBrandName = useCallback((brandId: string) => {
    const b = brandNameMap[brandId];
    if (!b) return '';
    return language === 'ar' ? b.name_ar : b.name;
  }, [brandNameMap, language]);

  const filteredModels = useMemo(() => {
    let list = models;
    if (brandFilter) {
      list = list.filter(m => m.brand_id === brandFilter);
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter(m =>
        (m.name || '').toLowerCase().includes(q) ||
        (m.name_ar || '').toLowerCase().includes(q) ||
        getBrandName(m.brand_id).toLowerCase().includes(q),
      );
    }
    return [...list].sort((a, b) => {
      if (sortBy === 'name_asc') return (a.name || '').localeCompare(b.name || '');
      if (sortBy === 'name_desc') return (b.name || '').localeCompare(a.name || '');
      return 0;
    });
  }, [models, searchQuery, getBrandName, sortBy, brandFilter]);

  const showToast = useCallback((msg: string, type: 'success' | 'error' | 'warning' | 'info' = 'success') => {
    setToastMessage(msg); setToastType(type); setToastVisible(true);
  }, []);

  const createMutation = useMutation({
    mutationFn: async (data: any) => adminSync.createCarModel(data),
    onSuccess: (r) => {
      if (r.success) {
        queryClient.invalidateQueries({ queryKey: queryKeys.carModels.all });
        showToast(language === 'ar' ? 'تم إضافة المطعم بنجاح' : 'Restaurant added', 'success');
        resetForm();
      } else showToast(r.error || 'Error', 'error');
    },
    onError: (e: any) => showToast(e.message || 'Error', 'error'),
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: any }) => adminSync.updateCarModel(id, data),
    onSuccess: (r) => {
      if (r.success) {
        queryClient.invalidateQueries({ queryKey: queryKeys.carModels.all });
        showToast(language === 'ar' ? 'تم تحديث المطعم' : 'Restaurant updated', 'success');
        resetForm();
      } else showToast(r.error || 'Error', 'error');
    },
    onError: (e: any) => showToast(e.message || 'Error', 'error'),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => adminSync.deleteCarModel(id),
    onMutate: async (deletedId) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.carModels.all });
      const prev = queryClient.getQueryData(queryKeys.carModels.all);
      queryClient.setQueryData(queryKeys.carModels.all, (old: CarModel[] | undefined) =>
        old ? old.filter(m => m.id !== deletedId) : []);
      return { prev };
    },
    onSuccess: (r, _id, ctx) => {
      if (!r.success) {
        if (ctx?.prev) queryClient.setQueryData(queryKeys.carModels.all, ctx.prev);
        showToast(r.error || 'Error', 'error');
      } else showToast(language === 'ar' ? 'تم حذف المطعم' : 'Restaurant deleted', 'success');
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) queryClient.setQueryData(queryKeys.carModels.all, ctx.prev);
      showToast(language === 'ar' ? 'فشل في الحذف' : 'Delete failed', 'error');
    },
  });

  const [pdfLoading, setPdfLoading] = useState(false);
  const [videoLoading, setVideoLoading] = useState(false);
  const [gpsLoading, setGpsLoading] = useState(false);

  const pickCatalogPdf = useCallback(async () => {
    if (pdfLoading) return;
    setPdfLoading(true);
    try {
      const r = await DocumentPicker.getDocumentAsync({ type: 'application/pdf', copyToCacheDirectory: true });
      if (!r.canceled && r.assets?.[0]) {
        const file = r.assets[0];
        setCatalogPdfName(file.name || 'menu.pdf');
        try {
          const b64 = await FileSystem.readAsStringAsync(file.uri, { encoding: 'base64' });
          setCatalogPdf(`data:application/pdf;base64,${b64}`);
        } catch { setCatalogPdf(file.uri); }
        showToast(language === 'ar' ? 'تم اختيار القائمة' : 'Menu selected', 'success');
      }
    } catch { showToast(language === 'ar' ? 'فشل اختيار الملف' : 'Failed to select', 'error'); }
    finally { setPdfLoading(false); }
  }, [language, showToast, pdfLoading]);

  const pickVideoFile = useCallback(async () => {
    if (videoLoading) return;
    try {
      const r = await DocumentPicker.getDocumentAsync({
        type: ['video/mp4', 'video/quicktime', 'video/webm', 'video/*'],
        copyToCacheDirectory: true,
      });
      if (!r.canceled && r.assets?.[0]) {
        const file = r.assets[0];
        setVideoLoading(true);
        try {
          // Step 1: get a presigned PUT URL from the server
          const urlRes = await api.post<{ uploadURL: string; downloadURL: string; objectPath: string }>('/upload-url');
          const { uploadURL, objectPath } = urlRes.data;

          // Step 2: fetch the local file as a blob and PUT directly to GCS
          const fileBlob = await fetch(file.uri).then((resp) => resp.blob());
          const putResp = await fetch(uploadURL, {
            method: 'PUT',
            headers: { 'Content-Type': file.mimeType || 'video/mp4' },
            body: fileBlob,
          });

          if (!putResp.ok) throw new Error(`PUT failed: ${putResp.status}`);

          // Step 3: finalize — set ACL to public and get a stable serving URL
          const finalRes = await api.post<{ servingUrl: string }>('/finalize-upload', {
            object_path: objectPath,
          });
          setVideoUrl(finalRes.data.servingUrl);
          showToast(language === 'ar' ? 'تم رفع الفيديو' : 'Video uploaded', 'success');
        } catch {
          // Object Storage unavailable — fall back to URL-only entry
          showToast(
            language === 'ar'
              ? 'فشل رفع الفيديو، استخدم رابط URL بدلاً من ذلك'
              : 'Upload failed — enter a video URL instead',
            'error',
          );
        } finally { setVideoLoading(false); }
      }
    } catch { showToast(language === 'ar' ? 'فشل اختيار الفيديو' : 'Failed to select video', 'error'); }
  }, [language, showToast, videoLoading]);

  const resetForm = useCallback(() => {
    setName(''); setNameAr(''); setSelectedBrandId(''); setYearFrom(''); setYearTo('');
    setChassisNumber(''); setImages([]); setCatalogPdf(null); setCatalogPdfName('');
    setVideoUrl(''); setReceiptLanguage('auto'); setIsEditMode(false); setEditingModel(null); setFuelType('regular');
    setLatitude(''); setLongitude('');
    setWeeklyHours(makeDefaultWeeklyHours());
  }, []);

  const handleEditModel = useCallback(async (m: CarModel) => {
    setName(m.name || ''); setNameAr(m.name_ar || ''); setSelectedBrandId(m.brand_id || '');
    setYearFrom(m.year_start != null ? (minutesToHHMM(m.year_start) ?? '') : '');
    setYearTo(m.year_end != null ? (minutesToHHMM(m.year_end) ?? '') : '');
    setChassisNumber(m.chassis_number || '');
    const imgs: string[] = (m as any).images?.length > 0 ? (m as any).images : m.image_url ? [m.image_url] : [];
    setImages(imgs);
    setCatalogPdf(m.catalog_pdf || null); setCatalogPdfName(m.catalog_pdf ? 'menu.pdf' : '');
    setVideoUrl(m.video_url || '');
    setReceiptLanguage(m.receipt_language || 'auto');
    setLatitude(m.latitude != null ? String(m.latitude) : '');
    setLongitude(m.longitude != null ? String(m.longitude) : '');
    setFuelType(m.fuel_type || 'regular'); setEditingModel(m); setIsEditMode(true);
    try {
      const r = await api.get<Array<{ day_of_week: number; open_minutes: number | null; close_minutes: number | null; is_closed: boolean }>>(`/car-models/${m.id}/hours`);
      if (r.data && r.data.length > 0) {
        const base = makeDefaultWeeklyHours();
        for (const h of r.data) {
          if (h.day_of_week >= 0 && h.day_of_week <= 6) {
            base[h.day_of_week] = {
              closed: h.is_closed,
              open: h.open_minutes != null ? (minutesToHHMM(h.open_minutes) ?? '09:00') : '09:00',
              close: h.close_minutes != null ? (minutesToHHMM(h.close_minutes) ?? '22:00') : '22:00',
            };
          }
        }
        setWeeklyHours(base);
      } else {
        const legacyOpen = m.year_start != null ? (minutesToHHMM(m.year_start) ?? '09:00') : '09:00';
        const legacyClose = m.year_end != null ? (minutesToHHMM(m.year_end) ?? '22:00') : '22:00';
        setWeeklyHours(Array.from({ length: 7 }, () => ({ open: legacyOpen, close: legacyClose, closed: false })));
      }
    } catch {
      setWeeklyHours(makeDefaultWeeklyHours());
    }
  }, []);

  const handleSave = useCallback(async () => {
    if (!selectedBrandId || !name.trim() || !nameAr.trim()) {
      showToast(language === 'ar' ? 'يرجى ملء الحقول المطلوبة' : 'Fill required fields', 'error');
      return;
    }
    const data = {
      name: name.trim(), name_ar: nameAr.trim(), brand_id: selectedBrandId,
      year_start: yearFrom ? hhmmToMinutes(yearFrom) : null,
      year_end: yearTo ? hhmmToMinutes(yearTo) : null,
      chassis_number: chassisNumber.trim() || null,
      image_url: images[0] || null, images,
      catalog_pdf: catalogPdf || null,
      fuel_type: fuelType || 'regular',
      video_url: videoUrl.trim() || null,
      receipt_language: receiptLanguage || 'auto',
      latitude: latitude.trim() && !Number.isNaN(parseFloat(latitude)) ? parseFloat(latitude) : null,
      longitude: longitude.trim() && !Number.isNaN(parseFloat(longitude)) ? parseFloat(longitude) : null,
    };

    const saveHours = async (restaurantId: string) => {
      const hrs = weeklyHoursRef.current;
      const hoursPayload = hrs.map((d, idx) => ({
        day_of_week: idx,
        open_minutes: d.closed ? null : hhmmToMinutes(d.open),
        close_minutes: d.closed ? null : hhmmToMinutes(d.close),
        is_closed: d.closed,
      }));
      try {
        await api.put(`/car-models/${restaurantId}/hours`, { hours: hoursPayload });
      } catch {
        showToast(
          language === 'ar'
            ? 'تم حفظ المطعم، لكن فشل حفظ ساعات العمل'
            : 'Restaurant saved, but opening hours could not be saved',
          'warning',
        );
      }
    };

    if (isEditMode && editingModel) {
      updateMutation.mutate({ id: editingModel.id, data }, {
        onSuccess: async (r) => {
          if (r.success) await saveHours(editingModel.id);
        },
      });
    } else {
      createMutation.mutate(data, {
        onSuccess: async (r) => {
          if (r.success && r.data?.id) await saveHours(r.data.id);
        },
      });
    }
  }, [selectedBrandId, name, nameAr, yearFrom, yearTo, chassisNumber, images, catalogPdf, isEditMode, editingModel, language, fuelType, videoUrl, receiptLanguage, latitude, longitude, showToast, createMutation, updateMutation]);

  const handleDelete = useCallback((id: string) => {
    showConfirm({
      title: language === 'ar' ? 'حذف المطعم' : 'Delete Restaurant',
      message: language === 'ar' ? 'هل أنت متأكد من حذف هذا المطعم؟' : 'Delete this restaurant?',
      confirmText: language === 'ar' ? 'حذف' : 'Delete',
      cancelText: language === 'ar' ? 'إلغاء' : 'Cancel',
      onConfirm: () => deleteMutation.mutate(id),
    });
  }, [deleteMutation, showConfirm, language]);

  const isSaving = createMutation.isPending || updateMutation.isPending;

  const pickCurrentLocation = useCallback(async () => {
    if (gpsLoading) return;
    setGpsLoading(true);
    try {
      const Location = await import('expo-location');
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        showToast(language === 'ar' ? 'تم رفض إذن الموقع' : 'Location permission denied', 'error');
        return;
      }
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      setLatitude(String(pos.coords.latitude));
      setLongitude(String(pos.coords.longitude));
      showToast(language === 'ar' ? 'تم تحديد الموقع' : 'Location captured', 'success');
    } catch {
      showToast(language === 'ar' ? 'تعذّر تحديد الموقع' : 'Could not get location', 'error');
    } finally { setGpsLoading(false); }
  }, [language, showToast, gpsLoading]);

  const formState: FormState = useMemo(() => ({
    name, nameAr, selectedBrandId, yearFrom, yearTo, chassisNumber,
    images, catalogPdf, catalogPdfName, isEditMode, editingModel, searchQuery, fuelType, videoUrl, receiptLanguage,
    latitude, longitude, weeklyHours,
  }), [name, nameAr, selectedBrandId, yearFrom, yearTo, chassisNumber, images, catalogPdf, catalogPdfName, isEditMode, editingModel, searchQuery, fuelType, videoUrl, receiptLanguage, latitude, longitude, weeklyHours]);

  const formHandlers: FormHandlers = useMemo(() => ({
    setName, setNameAr, setSelectedBrandId, setYearFrom, setYearTo, setChassisNumber,
    setImages, setCatalogPdf, setCatalogPdfName, handleSave, resetForm, setSearchQuery,
    pickCatalogPdf, setFuelType, setVideoUrl, pickVideoFile, setReceiptLanguage,
    setLatitude, setLongitude, pickCurrentLocation,
    setWeeklyHours,
    pdfLoading, videoLoading, gpsLoading,
  }), [handleSave, resetForm, pickCatalogPdf, pickVideoFile, pickCurrentLocation, pdfLoading, videoLoading, gpsLoading]);

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['bottom']}>
      <Header title={language === 'ar' ? 'إدارة المطاعم' : 'Restaurants'} showBack showSearch={false} showCart={false} />

      {/* ── Tab Bar ── */}
      <View style={[styles.tabBar, { backgroundColor: colors.card, borderBottomColor: colors.border }]}>
        {([
          { label_ar: 'المطاعم', label_en: 'Restaurants', icon: 'restaurant-outline' as const },
          { label_ar: 'نصوص الواجهة', label_en: 'Interface Texts', icon: 'text-outline' as const },
          { label_ar: 'صفحة المطعم', label_en: 'Detail Page', icon: 'information-circle-outline' as const },
        ] as const).map((tab, idx) => (
          <TouchableOpacity
            key={idx}
            style={[
              styles.tabItem,
              activeTab === idx && { borderBottomColor: colors.primary, borderBottomWidth: 2 },
            ]}
            onPress={() => setActiveTab(idx)}
            activeOpacity={0.75}
          >
            <Ionicons
              name={tab.icon}
              size={16}
              color={activeTab === idx ? colors.primary : colors.textSecondary}
            />
            <Text style={[
              styles.tabLabel,
              { color: activeTab === idx ? colors.primary : colors.textSecondary,
                fontWeight: activeTab === idx ? '700' : '500' },
            ]}>
              {language === 'ar' ? tab.label_ar : tab.label_en}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {activeTab === 2 ? (
        <RestaurantsPageConfigTab
          colors={colors}
          language={language}
          isRTL={isRTL}
          insets={insets}
          showToast={showToast}
        />
      ) : activeTab === 0 ? (
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          nestedScrollEnabled
          refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={colors.primary} />}
        >
          <View style={styles.formSection}>
            <ModelFormHeader
              formState={formState}
              handlers={formHandlers}
              colors={colors}
              isDark={isDark}
              language={language}
              isRTL={isRTL}
              isSaving={isSaving}
              modelsCount={filteredModels.length}
              brands={brands}
              router={router}
            />
          </View>

          {/* Cuisine (brand) filter chips */}
          {brands.length > 0 && (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={{ marginBottom: 8 }}
              contentContainerStyle={{ paddingHorizontal: 16, gap: 6, flexDirection: 'row' }}
            >
              {[{ id: '', name: 'All', name_ar: 'الكل' }, ...brands].map(b => {
                const active = brandFilter === b.id;
                return (
                  <TouchableOpacity
                    key={b.id || '__all'}
                    onPress={() => setBrandFilter(active && b.id !== '' ? '' : b.id)}
                    style={{
                      paddingHorizontal: 13,
                      paddingVertical: 5,
                      borderRadius: 14,
                      backgroundColor: active ? colors.primary : colors.surface,
                      borderWidth: 1,
                      borderColor: active ? colors.primary : colors.border,
                    }}
                  >
                    <Text style={{ fontSize: 12, fontWeight: active ? '700' : '400', color: active ? '#fff' : colors.textSecondary }}>
                      {language === 'ar' ? b.name_ar : b.name}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          )}

          {/* Sort controls */}
          <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, marginBottom: 8, gap: 8 }}>
            <Text style={{ color: colors.textSecondary, fontSize: 12, marginRight: 4 }}>
              {language === 'ar' ? 'ترتيب:' : 'Sort:'}
            </Text>
            {(['newest', 'name_asc', 'name_desc'] as const).map((opt) => {
              const labels: Record<typeof opt, { en: string; ar: string }> = {
                newest: { en: 'Newest', ar: 'الأحدث' },
                name_asc: { en: 'A → Z', ar: 'أ ← ي' },
                name_desc: { en: 'Z → A', ar: 'ي → أ' },
              };
              const active = sortBy === opt;
              return (
                <TouchableOpacity
                  key={opt}
                  onPress={() => setSortBy(opt)}
                  style={{
                    paddingHorizontal: 10,
                    paddingVertical: 4,
                    borderRadius: 12,
                    backgroundColor: active ? colors.primary : colors.surface,
                    borderWidth: 1,
                    borderColor: active ? colors.primary : colors.border,
                  }}
                >
                  <Text style={{ fontSize: 11, fontWeight: active ? '700' : '400', color: active ? '#fff' : colors.textSecondary }}>
                    {language === 'ar' ? labels[opt].ar : labels[opt].en}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {/* Restaurants list */}
          <View style={styles.restGrid}>
            {isLoading ? (
              <View style={styles.centeredBox}>
                <ActivityIndicator size="large" color={colors.primary} />
                <Text style={[styles.centeredText, { color: colors.textSecondary }]}>
                  {language === 'ar' ? 'جاري تحميل المطاعم...' : 'Loading restaurants...'}
                </Text>
              </View>
            ) : filteredModels.length === 0 ? (
              <View style={styles.centeredBox}>
                <LinearGradient
                  colors={[colors.primary + '18', colors.primary + '06']}
                  style={styles.emptyIconCircle}
                >
                  <MaterialCommunityIcons name="silverware-fork-knife" size={52} color={colors.primary + '70'} />
                </LinearGradient>
                <Text style={[styles.emptyTitle, { color: colors.text }]}>
                  {searchQuery
                    ? (language === 'ar' ? 'لا توجد نتائج' : 'No results')
                    : (language === 'ar' ? 'لا توجد مطاعم بعد' : 'No restaurants yet')}
                </Text>
                {!searchQuery && (
                  <Text style={[styles.emptyHint, { color: colors.textSecondary }]}>
                    {language === 'ar' ? 'أضف أول مطعم باستخدام النموذج أعلاه' : 'Add your first restaurant above'}
                  </Text>
                )}
              </View>
            ) : (
              filteredModels.map((m: CarModel) => (
                <ModelListItem
                  key={m.id}
                  model={m}
                  brandName={getBrandName(m.brand_id)}
                  colors={colors}
                  isDark={isDark}
                  language={language}
                  onEdit={handleEditModel}
                  onDelete={handleDelete}
                />
              ))
            )}
          </View>

          <View style={{ height: insets.bottom + 40 }} />
        </ScrollView>
      ) : (
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.formSection}>
            <InterfaceTextsPanel
              colors={colors}
              isDark={isDark}
              language={language}
              isRTL={isRTL}
            />
          </View>
          <View style={{ height: insets.bottom + 40 }} />
        </ScrollView>
      )}

      <Toast visible={toastVisible} message={toastMessage} type={toastType} onDismiss={() => setToastVisible(false)} />
      {ConfirmModalNode}
    </SafeAreaView>
  );
}

// ─── Restaurants Detail Page Config Tab (brand_page_config) ────────────────
function RestaurantsPageConfigTab({
  colors, language, isRTL, insets, showToast,
}: {
  colors: any; language: string; isRTL: boolean; insets: { bottom: number };
  showToast: (msg: string, type?: 'success' | 'error' | 'warning' | 'info') => void;
}) {
  const { state, setters, save } = usePageConfig('brand_page_config', {
    title_en: 'Featured Cuisine',
    title_ar: 'مطبخ مميز',
    subtitle_en: "A curated collection of our finest restaurants celebrating the soul of this cuisine — classic flavours reimagined by today's most thoughtful chefs.",
    subtitle_ar: 'مجموعة منتقاة من أشهر مطاعمنا التي تحتفي بأصالة هذا المطبخ، حيث تلتقي النكهات الكلاسيكية بحرفية الطهاة المعاصرين.',
    count_label_en: 'Restaurant',
    count_label_ar: 'مطعم',
    cta_label_en: 'View menu',
    cta_label_ar: 'استعرض القائمة',
  });

  const onSave = () => save(
    true,
    () => showToast(language === 'ar' ? 'تم حفظ الإعدادات بنجاح' : 'Settings saved successfully', 'success'),
    () => showToast(language === 'ar' ? 'فشل في حفظ الإعدادات' : 'Failed to save settings', 'error'),
  );

  if (state.isLoading) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <View style={{ flex: 1 }}>
      <PageConfigPanel
        bgImage={state.bgImage} setBgImage={setters.setBgImage}
        titleEn={state.titleEn} setTitleEn={setters.setTitleEn}
        titleAr={state.titleAr} setTitleAr={setters.setTitleAr}
        subtitleEn={state.subtitleEn} setSubtitleEn={setters.setSubtitleEn}
        subtitleAr={state.subtitleAr} setSubtitleAr={setters.setSubtitleAr}
        countLabelEn={state.countLabelEn} setCountLabelEn={setters.setCountLabelEn}
        countLabelAr={state.countLabelAr} setCountLabelAr={setters.setCountLabelAr}
        ctaLabelEn={state.ctaLabelEn} setCtaLabelEn={setters.setCtaLabelEn}
        ctaLabelAr={state.ctaLabelAr} setCtaLabelAr={setters.setCtaLabelAr}
        isDirty={state.isDirty}
        onSave={onSave}
        saving={state.saving}
        colors={colors}
        language={language}
        isRTL={isRTL}
        sectionTitle={language === 'ar' ? 'إعدادات صفحة تفاصيل المطبخ' : 'Cuisine Detail Page Settings'}
        previewIcon="restaurant"
      />
      <View style={{ height: insets.bottom + 40 }} />
    </View>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  container: { flex: 1 },
  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: 16 },
  formSection: { paddingTop: 16 },

  // Breadcrumb
  breadcrumb: { flexDirection: 'row', alignItems: 'center', marginBottom: 14, gap: 6 },
  breadcrumbRTL: { flexDirection: 'row-reverse' },
  breadcrumbText: { fontSize: 13, fontWeight: '500' },

  // Stats Banner
  statsBanner: { borderRadius: 16, borderWidth: 1, padding: 14, marginBottom: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  statsBannerInner: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  statsIconWrap: { width: 46, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center' },
  statsTitle: { fontSize: 16, fontWeight: '800' },
  statsSub: { fontSize: 12, marginTop: 2 },
  statsCountBubble: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  statsCountNum: { fontSize: 18, fontWeight: '900' },

  // Form Card
  formCard: { borderRadius: 16, borderWidth: 1.5, marginBottom: 16, overflow: 'hidden' },
  formTitleStrip: { padding: 14, paddingBottom: 12 },
  formTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  formTitleIconWrap: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  formTitle: { flex: 1, fontSize: 15, fontWeight: '700' },
  cancelBtn: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20, borderWidth: 1, gap: 4 },
  cancelBtnText: { fontSize: 12, fontWeight: '600' },
  formBody: { padding: 16, paddingTop: 8 },
  fieldGroup: { marginBottom: 16 },
  fieldLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 },
  fieldLabel: { fontSize: 13, fontWeight: '600' },
  textInput: { borderWidth: 1.5, borderRadius: 10, paddingHorizontal: 13, paddingVertical: 11, fontSize: 15 },
  helperText: { fontSize: 11, marginTop: 4 },
  chipScroll: { gap: 8, paddingVertical: 2 },
  selectChip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, borderWidth: 1.5 },
  dietChip: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20, borderWidth: 1.5 },
  timeRow: { flexDirection: 'row', gap: 12, alignItems: 'flex-end' },
  timeDivider: { width: 1, height: 44, marginBottom: 1 },
  timeSubLabel: { fontSize: 11, marginBottom: 5 },
  pdfButton: { borderWidth: 1.5, borderStyle: 'dashed', borderRadius: 12, padding: 14, flexDirection: 'row', alignItems: 'center', gap: 12 },
  pdfIconWrap: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  pdfUploadLabel: { fontSize: 14, fontWeight: '600' },
  pdfHelper: { fontSize: 11, marginTop: 2 },
  pdfFileName: { fontSize: 13, fontWeight: '600' },
  pdfSelectedText: { fontSize: 11, color: '#10B981', marginTop: 2 },
  saveWrap: { borderRadius: 12, overflow: 'hidden', marginTop: 4 },
  saveBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', padding: 14, gap: 8 },
  saveBtnText: { color: '#FFF', fontSize: 15, fontWeight: '700' },

  // Search Card
  searchCard: { borderRadius: 14, borderWidth: 1, padding: 14, marginBottom: 12 },
  searchTitleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  searchTitle: { fontSize: 15, fontWeight: '700' },
  countPill: { paddingHorizontal: 10, paddingVertical: 3, borderRadius: 12 },
  countPillText: { fontSize: 12, fontWeight: '700' },
  searchBar: { flexDirection: 'row', alignItems: 'center', borderWidth: 1.5, borderRadius: 10, paddingHorizontal: 11, paddingVertical: 9, gap: 8 },
  searchInput: { flex: 1, fontSize: 14, paddingVertical: 0 },

  // Restaurant grid & cards
  restGrid: { gap: 12, paddingBottom: 8 },
  centeredBox: { padding: 48, alignItems: 'center', gap: 10 },
  centeredText: { fontSize: 14 },
  emptyIconCircle: { width: 96, height: 96, borderRadius: 48, alignItems: 'center', justifyContent: 'center', marginBottom: 8 },
  emptyTitle: { fontSize: 17, fontWeight: '700', textAlign: 'center' },
  emptyHint: { fontSize: 13, textAlign: 'center' },
  restCard: { borderRadius: 16, borderWidth: 1, overflow: 'hidden' },
  restCardImg: { height: 140, position: 'relative', overflow: 'hidden' },
  restCardPlaceholder: { alignItems: 'center', justifyContent: 'center' },
  restCardImgName: { color: '#FFF', fontSize: 16, fontWeight: '800', textShadowColor: 'rgba(0,0,0,0.8)', textShadowRadius: 4, textShadowOffset: { width: 0, height: 1 } },
  restDietBadge: { position: 'absolute', top: 10, right: 10, flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 10 },
  restDietText: { color: '#FFF', fontSize: 10, fontWeight: '700' },
  restCardBody: { padding: 14, paddingBottom: 10 },
  restNameAr: { fontSize: 17, fontWeight: '800' },
  restNameEn: { fontSize: 12, marginTop: 2, marginBottom: 9 },
  restChipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  restChip: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8, borderWidth: 1 },
  restChipText: { fontSize: 11, fontWeight: '600' },
  restDivider: { height: StyleSheet.hairlineWidth, marginHorizontal: 14 },
  restActions: { flexDirection: 'row', padding: 10, gap: 8 },
  restActionBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, paddingVertical: 9, borderRadius: 10, borderWidth: 1 },
  restActionText: { fontSize: 13, fontWeight: '700' },

  // Tab bar
  tabBar: { flexDirection: 'row', borderBottomWidth: StyleSheet.hairlineWidth },
  tabItem: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 12, borderBottomWidth: 2, borderBottomColor: 'transparent' },
  tabLabel: { fontSize: 13 },
});

/* __ACCESS_GUARD_APPLIED__ */
export default function ModelsAdminGuarded(props: any) {
  return (
    <__AccessGuard__ scope="admin">
      <ModelsAdmin {...props} />
    </__AccessGuard__>
  );
}
