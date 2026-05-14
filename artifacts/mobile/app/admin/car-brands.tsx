/**
 * Car Brands Admin - Cuisine Origins CRUD + 3 page config tabs
 * Tab 1: CRUD for cuisine origins (car_brands table)
 * Tab 2: car-brands.tsx page config (car_brands_page_config)
 * Tab 3: brand/[id].tsx page config (brand_page_config)
 * Tab 4: brands.tsx page config (brands_page_config)
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
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTheme } from '../../src/hooks/useTheme';
import { useTranslation } from '../../src/hooks/useTranslation';
import { carBrandsApi, api } from '../../src/services/api';
import { useAdminSync } from '../../src/services/adminSyncService';
import { Header } from '../../src/components/Header';
import { ImageUploader } from '../../src/components/ui/ImageUploader';
import { Toast } from '../../src/components/ui/FormFeedback';
import { queryKeys } from '../../src/lib/queryClient';
import { useConfirmModal } from '../../src/components/ConfirmModal';
import { AccessGuard as __AccessGuard__ } from '../../src/components/AccessGuard';

type ActiveTab = 'brands' | 'cuisines_page';

// Types
interface CarBrand {
  id: string;
  name: string;
  name_ar: string;
  logo?: string;
}

interface FormState {
  name: string;
  nameAr: string;
  logoImage: string;
  isEditMode: boolean;
  editingBrand: CarBrand | null;
  searchQuery: string;
}

interface FormHandlers {
  setName: (v: string) => void;
  setNameAr: (v: string) => void;
  setLogoImage: (v: string) => void;
  handleSave: () => void;
  resetForm: () => void;
  setSearchQuery: (v: string) => void;
}

interface FormHeaderProps {
  formState: FormState;
  handlers: FormHandlers;
  colors: any;
  language: string;
  isRTL: boolean;
  isSaving: boolean;
  brandsCount: number;
  router: any;
}

interface PageConfigPanelProps {
  bgImage: string;
  setBgImage: (v: string) => void;
  titleEn: string;
  setTitleEn: (v: string) => void;
  titleAr: string;
  setTitleAr: (v: string) => void;
  subtitleEn: string;
  setSubtitleEn: (v: string) => void;
  subtitleAr: string;
  setSubtitleAr: (v: string) => void;
  // Optional: restaurants-count label (Tab 3 only)
  countLabelEn?: string;
  setCountLabelEn?: (v: string) => void;
  countLabelAr?: string;
  setCountLabelAr?: (v: string) => void;
  // Optional: CTA button label (Tab 3 only)
  ctaLabelEn?: string;
  setCtaLabelEn?: (v: string) => void;
  ctaLabelAr?: string;
  setCtaLabelAr?: (v: string) => void;
  onSave: () => void;
  saving: boolean;
  /** Whether current values differ from last-saved server values (computed by parent) */
  isDirty: boolean;
  colors: any;
  language: string;
  isRTL: boolean;
  sectionTitle: string;
  previewIcon?: PreviewIconName;
}

// ============================================================================
// Page Header Preview — live scaled-down preview of the public page header
// ============================================================================
type PreviewIconName = 'restaurant' | 'briefcase';

interface PageHeaderPreviewProps {
  bgImage: string;
  titleEn: string;
  titleAr: string;
  subtitleEn: string;
  subtitleAr: string;
  language: string;
  colors: any;
  iconName?: PreviewIconName;
  focusedField?: 'title' | 'subtitle' | null;
}

const PageHeaderPreview = memo(({
  bgImage, titleEn, titleAr, subtitleEn, subtitleAr,
  language, colors, iconName = 'restaurant', focusedField,
}: PageHeaderPreviewProps) => {
  const [previewLang, setPreviewLang] = useState<'en' | 'ar'>(language === 'ar' ? 'ar' : 'en');
  useEffect(() => { setPreviewLang(language === 'ar' ? 'ar' : 'en'); }, [language]);
  const title = previewLang === 'ar' ? (titleAr || titleEn || '…') : (titleEn || titleAr || '…');
  const subtitle = previewLang === 'ar' ? (subtitleAr || subtitleEn || '') : (subtitleEn || subtitleAr || '');
  return (
    <View style={[previewStyles.wrapper, { borderColor: colors.border, backgroundColor: colors.card }]}>
      <View style={previewStyles.labelRow}>
        <Text style={[previewStyles.label, { color: colors.textSecondary }]}>
          {language === 'ar' ? 'معاينة مباشرة' : 'Live Preview'}
        </Text>
        <View style={previewStyles.langToggle}>
          <TouchableOpacity
            style={[previewStyles.langBtn, previewLang === 'en' && { backgroundColor: colors.primary }]}
            onPress={() => setPreviewLang('en')}
          >
            <Text style={[previewStyles.langBtnText, previewLang === 'en' && previewStyles.langBtnTextActive]}>EN</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[previewStyles.langBtn, previewLang === 'ar' && { backgroundColor: colors.primary }]}
            onPress={() => setPreviewLang('ar')}
          >
            <Text style={[previewStyles.langBtnText, previewLang === 'ar' && previewStyles.langBtnTextActive]}>AR</Text>
          </TouchableOpacity>
        </View>
      </View>
      <View style={[previewStyles.header, { backgroundColor: bgImage ? undefined : colors.primary }]}>
        {bgImage ? (
          <Image
            source={{ uri: bgImage }}
            style={StyleSheet.absoluteFill}
            resizeMode="cover"
          />
        ) : null}
        {bgImage ? (
          <View style={[StyleSheet.absoluteFill, previewStyles.overlay]} />
        ) : null}
        <View style={previewStyles.iconCircle}>
          <Ionicons name={iconName} size={20} color="#FFF" />
        </View>
        <View style={focusedField === 'title' ? previewStyles.fieldHighlight : undefined}>
          <Text style={previewStyles.previewTitle} numberOfLines={1}>{title}</Text>
        </View>
        {subtitle ? (
          <View style={focusedField === 'subtitle' ? previewStyles.fieldHighlight : undefined}>
            <Text style={previewStyles.previewSubtitle} numberOfLines={2}>{subtitle}</Text>
          </View>
        ) : null}
      </View>
    </View>
  );
});

PageHeaderPreview.displayName = 'PageHeaderPreview';

// ============================================================================
// Page Config Panel — reusable form for all 3 public page configs
// ============================================================================
const PageConfigPanel = memo(({
  bgImage, setBgImage,
  titleEn, setTitleEn,
  titleAr, setTitleAr,
  subtitleEn, setSubtitleEn,
  subtitleAr, setSubtitleAr,
  countLabelEn, setCountLabelEn,
  countLabelAr, setCountLabelAr,
  ctaLabelEn, setCtaLabelEn,
  ctaLabelAr, setCtaLabelAr,
  onSave, saving, isDirty,
  colors, language, isRTL,
  sectionTitle, previewIcon,
}: PageConfigPanelProps) => {
  const [focusedField, setFocusedField] = useState<'title' | 'subtitle' | null>(null);
  const { width } = useWindowDimensions();
  const isWide = width > 600;
  const previewColWidth = Math.min(340, Math.max(260, width * 0.35));

  const previewNode = (
    <PageHeaderPreview
      bgImage={bgImage}
      titleEn={titleEn}
      titleAr={titleAr}
      subtitleEn={subtitleEn}
      subtitleAr={subtitleAr}
      language={language}
      colors={colors}
      iconName={previewIcon}
      focusedField={focusedField}
    />
  );

  const formCards = (
    <>
      <View style={[cfgStyles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <Text style={[cfgStyles.cardLabel, { color: colors.textSecondary }]}>
          {language === 'ar' ? 'صورة الخلفية' : 'Background Image'}
        </Text>
        <ImageUploader
          mode="single"
          value={bgImage}
          onChange={(v) => setBgImage(v as string)}
          size="large"
          aspectRatio={[16, 9]}
          shape="rounded"
          hint={language === 'ar' ? 'اختر صورة خلفية (نسبة 16:9)' : 'Pick a background image (16:9 ratio)'}
        />
      </View>

      <View style={[cfgStyles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <Text style={[cfgStyles.cardHeading, { color: colors.text }]}>
          {language === 'ar' ? 'العنوان' : 'Title'}
        </Text>

        <Text style={[cfgStyles.label, { color: colors.textSecondary }]}>
          {language === 'ar' ? 'بالإنجليزية' : 'English'}
        </Text>
        <TextInput
          style={[cfgStyles.input, { backgroundColor: colors.surface, borderColor: colors.border, color: colors.text }]}
          value={titleEn}
          onChangeText={setTitleEn}
          placeholder="e.g., Cuisines"
          placeholderTextColor={colors.textSecondary}
          onFocus={() => setFocusedField('title')}
          onBlur={() => setFocusedField(null)}
        />

        <Text style={[cfgStyles.label, { color: colors.textSecondary, marginTop: 12 }]}>
          {language === 'ar' ? 'بالعربية' : 'Arabic'}
        </Text>
        <TextInput
          style={[cfgStyles.input, { backgroundColor: colors.surface, borderColor: colors.border, color: colors.text }, isRTL && { textAlign: 'right' }]}
          value={titleAr}
          onChangeText={setTitleAr}
          placeholder="مثال: المأكولات"
          placeholderTextColor={colors.textSecondary}
          onFocus={() => setFocusedField('title')}
          onBlur={() => setFocusedField(null)}
        />
      </View>

      <View style={[cfgStyles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <Text style={[cfgStyles.cardHeading, { color: colors.text }]}>
          {language === 'ar' ? 'الوصف' : 'Subtitle'}
        </Text>

        <Text style={[cfgStyles.label, { color: colors.textSecondary }]}>
          {language === 'ar' ? 'بالإنجليزية' : 'English'}
        </Text>
        <TextInput
          style={[cfgStyles.input, cfgStyles.multiline, { backgroundColor: colors.surface, borderColor: colors.border, color: colors.text }]}
          value={subtitleEn}
          onChangeText={setSubtitleEn}
          placeholder="e.g., Discover our finest cuisines"
          placeholderTextColor={colors.textSecondary}
          multiline
          numberOfLines={3}
          textAlignVertical="top"
          onFocus={() => setFocusedField('subtitle')}
          onBlur={() => setFocusedField(null)}
        />

        <Text style={[cfgStyles.label, { color: colors.textSecondary, marginTop: 12 }]}>
          {language === 'ar' ? 'بالعربية' : 'Arabic'}
        </Text>
        <TextInput
          style={[cfgStyles.input, cfgStyles.multiline, { backgroundColor: colors.surface, borderColor: colors.border, color: colors.text }, isRTL && { textAlign: 'right' }]}
          value={subtitleAr}
          onChangeText={setSubtitleAr}
          placeholder="مثال: اكتشف أرقى المأكولات"
          placeholderTextColor={colors.textSecondary}
          multiline
          numberOfLines={3}
          textAlignVertical="top"
          onFocus={() => setFocusedField('subtitle')}
          onBlur={() => setFocusedField(null)}
        />
      </View>

      {setCountLabelEn && setCountLabelAr && (
        <View style={[cfgStyles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[cfgStyles.cardHeading, { color: colors.text }]}>
            {language === 'ar' ? 'تسمية عدد المطاعم' : 'Restaurants Count Label'}
          </Text>
          <Text style={[cfgStyles.label, { color: colors.textSecondary }]}>
            {language === 'ar' ? 'بالإنجليزية' : 'English'}
          </Text>
          <TextInput
            style={[cfgStyles.input, { backgroundColor: colors.surface, borderColor: colors.border, color: colors.text }]}
            value={countLabelEn}
            onChangeText={setCountLabelEn}
            placeholder="e.g., Restaurant"
            placeholderTextColor={colors.textSecondary}
          />
          <Text style={[cfgStyles.label, { color: colors.textSecondary, marginTop: 12 }]}>
            {language === 'ar' ? 'بالعربية' : 'Arabic'}
          </Text>
          <TextInput
            style={[cfgStyles.input, { backgroundColor: colors.surface, borderColor: colors.border, color: colors.text }, isRTL && { textAlign: 'right' }]}
            value={countLabelAr}
            onChangeText={setCountLabelAr}
            placeholder="مثال: مطعم"
            placeholderTextColor={colors.textSecondary}
          />
        </View>
      )}

      {setCtaLabelEn && setCtaLabelAr && (
        <View style={[cfgStyles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[cfgStyles.cardHeading, { color: colors.text }]}>
            {language === 'ar' ? 'نص زر الاستعراض' : 'CTA Button Label'}
          </Text>
          <Text style={[cfgStyles.label, { color: colors.textSecondary }]}>
            {language === 'ar' ? 'بالإنجليزية' : 'English'}
          </Text>
          <TextInput
            style={[cfgStyles.input, { backgroundColor: colors.surface, borderColor: colors.border, color: colors.text }]}
            value={ctaLabelEn}
            onChangeText={setCtaLabelEn}
            placeholder="e.g., View menu"
            placeholderTextColor={colors.textSecondary}
          />
          <Text style={[cfgStyles.label, { color: colors.textSecondary, marginTop: 12 }]}>
            {language === 'ar' ? 'بالعربية' : 'Arabic'}
          </Text>
          <TextInput
            style={[cfgStyles.input, { backgroundColor: colors.surface, borderColor: colors.border, color: colors.text }, isRTL && { textAlign: 'right' }]}
            value={ctaLabelAr}
            onChangeText={setCtaLabelAr}
            placeholder="مثال: استعرض القائمة"
            placeholderTextColor={colors.textSecondary}
          />
        </View>
      )}

      <TouchableOpacity
        style={[cfgStyles.saveBtn, { backgroundColor: colors.primary, opacity: saving ? 0.7 : 1 }]}
        onPress={onSave}
        disabled={saving}
      >
        {saving ? (
          <ActivityIndicator color="#FFF" />
        ) : (
          <>
            <Ionicons name="save" size={18} color="#FFF" />
            <Text style={cfgStyles.saveBtnText}>
              {language === 'ar' ? 'حفظ الإعدادات' : 'Save Settings'}
            </Text>
            {isDirty && (
              <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: '#FFA500', marginLeft: 4 }} />
            )}
          </>
        )}
      </TouchableOpacity>
    </>
  );

  if (isWide) {
    return (
      <View style={cfgStyles.splitRow}>
        {/* Left column — scrollable form */}
        <ScrollView
          style={cfgStyles.splitLeft}
          contentContainerStyle={cfgStyles.splitLeftContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          nestedScrollEnabled
        >
          <Text style={[cfgStyles.sectionTitle, { color: colors.text }]}>{sectionTitle}</Text>
          {formCards}
        </ScrollView>

        {/* Right column — sticky preview */}
        <View style={[cfgStyles.splitRight, { borderLeftColor: colors.border, width: previewColWidth }]}>
          <Text style={[cfgStyles.sectionTitle, { color: colors.text, opacity: 0 }]}>
            {sectionTitle}
          </Text>
          {previewNode}
        </View>
      </View>
    );
  }

  return (
    <View style={cfgStyles.container}>
      <Text style={[cfgStyles.sectionTitle, { color: colors.text }]}>{sectionTitle}</Text>
      {previewNode}
      {formCards}
    </View>
  );
});

PageConfigPanel.displayName = 'PageConfigPanel';

// ============================================================================
// Standalone Form Header Component - OUTSIDE main component to prevent re-mounting
// ============================================================================
const CarBrandFormHeader = memo(({
  formState,
  handlers,
  colors,
  language,
  isRTL,
  isSaving,
  brandsCount,
  router,
}: FormHeaderProps) => {
  const { name, nameAr, logoImage, isEditMode, searchQuery } = formState;
  const { setName, setNameAr, setLogoImage, handleSave, resetForm, setSearchQuery } = handlers;

  return (
    <View style={styles.listHeaderContainer}>
      {/* Breadcrumb */}
      <View style={[styles.breadcrumb, isRTL && styles.breadcrumbRTL]}>
        <TouchableOpacity onPress={() => router.push('/admin')}>
          <Text style={[styles.breadcrumbText, { color: colors.primary }]}>
            {language === 'ar' ? 'لوحة التحكم' : 'Admin'}
          </Text>
        </TouchableOpacity>
        <Ionicons name={isRTL ? 'chevron-back' : 'chevron-forward'} size={16} color={colors.textSecondary} />
        <Text style={[styles.breadcrumbText, { color: colors.textSecondary }]}>
          {language === 'ar' ? 'منشأ المطبخ' : 'Cuisine Origins'}
        </Text>
      </View>

      {/* Add/Edit Form */}
      <View style={[styles.formCard, { backgroundColor: colors.card, borderColor: isEditMode ? colors.primary : colors.border }]}>
        <View style={styles.formTitleRow}>
          <Text style={[styles.formTitle, { color: isEditMode ? colors.primary : colors.text }]}>
            {isEditMode
              ? (language === 'ar' ? 'تعديل المنشأ' : 'Edit Cuisine Origin')
              : (language === 'ar' ? 'إضافة منشأ جديد' : 'Add New Cuisine Origin')
            }
          </Text>
          {isEditMode && (
            <TouchableOpacity
              style={[styles.cancelEditBtn, { backgroundColor: colors.error + '20' }]}
              onPress={resetForm}
            >
              <Ionicons name="close" size={18} color={colors.error} />
              <Text style={[styles.cancelEditText, { color: colors.error }]}>
                {language === 'ar' ? 'إلغاء' : 'Cancel'}
              </Text>
            </TouchableOpacity>
          )}
        </View>

        {/* Logo Upload Section */}
        <View style={styles.formGroup}>
          <ImageUploader
            mode="single"
            value={logoImage}
            onChange={(newImage) => setLogoImage(newImage as string)}
            size="medium"
            shape="circle"
            label={language === 'ar' ? 'شعار المنشأ' : 'Origin Logo'}
            hint={language === 'ar' ? 'اختر صورة الشعار' : 'Choose logo image'}
          />
        </View>

        <View style={styles.formGroup}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
            <Text style={[styles.label, { color: colors.text, marginBottom: 0 }]}>
              {language === 'ar' ? 'الاسم (بالإنجليزية) *' : 'Name (English) *'}
            </Text>
            <Text style={{ fontSize: 10, color: name.length > 80 ? colors.error : colors.textSecondary }}>
              {name.length}/100
            </Text>
          </View>
          <TextInput
            style={[styles.input, { backgroundColor: colors.surface, borderColor: name.length > 80 ? colors.error : colors.border, color: colors.text }]}
            value={name}
            onChangeText={setName}
            placeholder={language === 'ar' ? 'مثال: Egyptian' : 'e.g., Egyptian'}
            placeholderTextColor={colors.textSecondary}
            maxLength={100}
          />
        </View>

        <View style={styles.formGroup}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
            <Text style={[styles.label, { color: colors.text, marginBottom: 0 }]}>
              {language === 'ar' ? 'الاسم (بالعربية) *' : 'Name (Arabic) *'}
            </Text>
            <Text style={{ fontSize: 10, color: nameAr.length > 80 ? colors.error : colors.textSecondary }}>
              {nameAr.length}/100
            </Text>
          </View>
          <TextInput
            style={[styles.input, { backgroundColor: colors.surface, borderColor: nameAr.length > 80 ? colors.error : colors.border, color: colors.text }, isRTL && styles.inputRTL]}
            value={nameAr}
            onChangeText={setNameAr}
            placeholder={language === 'ar' ? 'مثال: مصري' : 'e.g., مصري'}
            placeholderTextColor={colors.textSecondary}
            maxLength={100}
          />
        </View>

        <TouchableOpacity
          style={[styles.saveButton, { backgroundColor: colors.primary }]}
          onPress={handleSave}
          disabled={isSaving}
        >
          {isSaving ? (
            <ActivityIndicator color="#FFF" />
          ) : (
            <>
              <Ionicons name={isEditMode ? "create" : "save"} size={20} color="#FFF" />
              <Text style={styles.saveButtonText}>
                {isEditMode
                  ? (language === 'ar' ? 'تحديث' : 'Update')
                  : (language === 'ar' ? 'حفظ' : 'Save')
                }
              </Text>
            </>
          )}
        </TouchableOpacity>
      </View>

      {/* List Header */}
      <View style={[styles.listCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <Text style={[styles.listTitle, { color: colors.text }]}>
          {language === 'ar' ? 'المناشئ الحالية' : 'Existing Origins'} ({brandsCount})
        </Text>

        {/* Search Bar */}
        <View style={[styles.searchContainer, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Ionicons name="search" size={20} color={colors.textSecondary} />
          <TextInput
            style={[styles.searchInput, { color: colors.text }]}
            value={searchQuery}
            onChangeText={setSearchQuery}
            placeholder={language === 'ar' ? 'ابحث بالاسم...' : 'Search by name...'}
            placeholderTextColor={colors.textSecondary}
          />
          {searchQuery.length > 0 && (
            <TouchableOpacity onPress={() => setSearchQuery('')}>
              <Ionicons name="close-circle" size={20} color={colors.textSecondary} />
            </TouchableOpacity>
          )}
        </View>
      </View>
    </View>
  );
});

CarBrandFormHeader.displayName = 'CarBrandFormHeader';

// ============================================================================
// Memoized Brand List Item Component
// ============================================================================
const BrandListItem = memo(({
  brand,
  colors,
  onEdit,
  onDelete,
}: {
  brand: CarBrand;
  colors: any;
  onEdit: (brand: CarBrand) => void;
  onDelete: (id: string) => void;
}) => (
  <View style={[styles.listItem, { borderColor: colors.border }]}>
    {brand.logo ? (
      <Image source={{ uri: brand.logo }} style={styles.brandLogo} />
    ) : (
      <View style={[styles.brandLogoPlaceholder, { backgroundColor: colors.surface }]}>
        <Ionicons name="restaurant" size={24} color={colors.textSecondary} />
      </View>
    )}
    <View style={styles.brandInfo}>
      <Text style={[styles.brandName, { color: colors.text }]}>{brand.name}</Text>
      <Text style={[styles.brandNameAr, { color: colors.textSecondary }]}>{brand.name_ar}</Text>
    </View>
    <View style={styles.actionButtons}>
      <TouchableOpacity
        style={[styles.editButton, { backgroundColor: colors.primary + '20' }]}
        onPress={() => onEdit(brand)}
      >
        <Ionicons name="create" size={18} color={colors.primary} />
      </TouchableOpacity>
      <TouchableOpacity
        style={[styles.deleteButton, { backgroundColor: colors.error + '20' }]}
        onPress={() => onDelete(brand.id)}
      >
        <Ionicons name="trash" size={18} color={colors.error} />
      </TouchableOpacity>
    </View>
  </View>
));

BrandListItem.displayName = 'BrandListItem';

// ============================================================================
// Main Component
// ============================================================================
function CarBrandsAdmin() {
  const { colors } = useTheme();
  const { language, isRTL } = useTranslation();
  const { showConfirm, ConfirmModalNode } = useConfirmModal();
  const router = useRouter();
  const queryClient = useQueryClient();
  const adminSync = useAdminSync();
  const insets = useSafeAreaInsets();

  // Active tab
  const [activeTab, setActiveTab] = useState<ActiveTab>('brands');

  // Form state (Tab 1 — brands CRUD)
  const [name, setName] = useState('');
  const [nameAr, setNameAr] = useState('');
  const [logoImage, setLogoImage] = useState<string>('');
  const [editingBrand, setEditingBrand] = useState<CarBrand | null>(null);
  const [isEditMode, setIsEditMode] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  // Toast state
  const [toastVisible, setToastVisible] = useState(false);
  const [toastMessage, setToastMessage] = useState('');
  const [toastType, setToastType] = useState<'success' | 'error' | 'warning' | 'info'>('success');

  // ── Config state for Tab 2: Cuisines Page (car_brands_page_config) ──
  const [cb_bgImage, setCb_bgImage] = useState('');
  const [cb_titleEn, setCb_titleEn] = useState('Cuisines');
  const [cb_titleAr, setCb_titleAr] = useState('المأكولات العالمية');
  const [cb_subtitleEn, setCb_subtitleEn] = useState('Discover the finest world cuisines at Al-Ghazaly');
  const [cb_subtitleAr, setCb_subtitleAr] = useState('اكتشف أرقى المأكولات العالمية في مطعم الغزالي');
  const [cb_saving, setCb_saving] = useState(false);

  // ── Fetch existing configs ──
  // (Tabs for brand_page_config and brands_page_config moved to admin/models.tsx
  //  and admin/product-brands.tsx respectively; only car_brands_page_config remains here.)
  const { data: cbConfig, isLoading: cbLoading } = useQuery({
    queryKey: ['setting', 'car_brands_page_config'],
    queryFn: async () => {
      try {
        const res = await api.get('/admin/settings/car_brands_page_config');
        return res.data?.value as Record<string, string> | null;
      } catch { return null; }
    },
    staleTime: 5 * 60 * 1000,
    retry: false,
  });

  // ── Populate form fields when configs load ──
  useEffect(() => {
    if (!cbConfig) return;
    if (cbConfig.bg_image !== undefined) setCb_bgImage(cbConfig.bg_image);
    if (cbConfig.title_en !== undefined) setCb_titleEn(cbConfig.title_en);
    if (cbConfig.title_ar !== undefined) setCb_titleAr(cbConfig.title_ar);
    if (cbConfig.subtitle_en !== undefined) setCb_subtitleEn(cbConfig.subtitle_en);
    if (cbConfig.subtitle_ar !== undefined) setCb_subtitleAr(cbConfig.subtitle_ar);
  }, [cbConfig]);

  // ── Per-tab dirty detection (compare current values vs server baseline) ──
  const cb_isDirty = useMemo(() => {
    if (!cbConfig) return false;
    return cb_bgImage !== (cbConfig.bg_image ?? '') ||
      cb_titleEn !== (cbConfig.title_en ?? '') ||
      cb_titleAr !== (cbConfig.title_ar ?? '') ||
      cb_subtitleEn !== (cbConfig.subtitle_en ?? '') ||
      cb_subtitleAr !== (cbConfig.subtitle_ar ?? '');
  }, [cbConfig, cb_bgImage, cb_titleEn, cb_titleAr, cb_subtitleEn, cb_subtitleAr]);

  // ── Generic config save ──
  const handleSaveConfig = useCallback(async (
    key: string,
    value: Record<string, string>,
    setSaving: (v: boolean) => void,
  ) => {
    setSaving(true);
    try {
      await api.put(`/admin/settings/${key}`, { value });
      queryClient.invalidateQueries({ queryKey: ['setting', key] });
      showToast(language === 'ar' ? 'تم حفظ الإعدادات بنجاح' : 'Settings saved successfully', 'success');
    } catch {
      showToast(language === 'ar' ? 'فشل في حفظ الإعدادات' : 'Failed to save settings', 'error');
    } finally {
      setSaving(false);
    }
  }, [language, queryClient]);

  // TanStack Query: Fetch Brands
  const {
    data: brandsData,
    isLoading,
    isRefetching,
    refetch,
  } = useQuery({
    queryKey: queryKeys.carBrands.all,
    queryFn: async () => {
      const response = await carBrandsApi.getAll();
      return response.data || [];
    },
    staleTime: 2 * 60 * 1000,
  });

  const brands: CarBrand[] = brandsData || [];

  const [brandSortBy, setBrandSortBy] = useState<'default' | 'name_asc' | 'name_desc'>('default');

  // Filter + sort brands based on search query and sort preference
  const filteredBrands = useMemo(() => {
    let list = brands;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter((brand) => {
        const brandName = (brand.name || '').toLowerCase();
        const brandNameAr = (brand.name_ar || '').toLowerCase();
        return brandName.includes(q) || brandNameAr.includes(q);
      });
    }
    if (brandSortBy === 'name_asc') return [...list].sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    if (brandSortBy === 'name_desc') return [...list].sort((a, b) => (b.name || '').localeCompare(a.name || ''));
    return list;
  }, [brands, searchQuery, brandSortBy]);

  // Create Mutation
  const createMutation = useMutation({
    mutationFn: async (data: any) => adminSync.createCarBrand(data),
    onSuccess: (result) => {
      if (result.success) {
        queryClient.invalidateQueries({ queryKey: queryKeys.carBrands.all });
        showToast(language === 'ar' ? 'تم إضافة المنشأ بنجاح' : 'Cuisine origin added successfully', 'success');
        resetForm();
      } else {
        showToast(result.error || 'Failed to create brand', 'error');
      }
    },
    onError: (error: any) => {
      showToast(error.message || 'Failed to create brand', 'error');
    },
  });

  // Update Mutation
  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: any }) => {
      const response = await carBrandsApi.update(id, data);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.carBrands.all });
      showToast(language === 'ar' ? 'تم تحديث المنشأ بنجاح' : 'Cuisine origin updated successfully', 'success');
      resetForm();
    },
    onError: (error: any) => {
      showToast(error.message || 'Failed to update brand', 'error');
    },
  });

  // Delete Mutation
  const deleteMutation = useMutation({
    mutationFn: async (id: string) => adminSync.deleteCarBrand(id),
    onMutate: async (deletedId) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.carBrands.all });
      const previousBrands = queryClient.getQueryData(queryKeys.carBrands.all);
      queryClient.setQueryData(queryKeys.carBrands.all, (old: CarBrand[] | undefined) =>
        old ? old.filter(b => b.id !== deletedId) : []
      );
      return { previousBrands };
    },
    onSuccess: (result) => {
      if (result.success) {
        showToast(language === 'ar' ? 'تم حذف المنشأ بنجاح' : 'Cuisine origin deleted successfully', 'success');
      } else {
        showToast(result.error || 'Failed to delete cuisine origin', 'error');
        queryClient.invalidateQueries({ queryKey: queryKeys.carBrands.all });
      }
    },
    onError: (error, variables, context) => {
      if (context?.previousBrands) {
        queryClient.setQueryData(queryKeys.carBrands.all, context.previousBrands);
      }
      showToast(language === 'ar' ? 'فشل في حذف المنشأ' : 'Failed to delete cuisine origin', 'error');
    },
  });

  const showToast = useCallback((message: string, type: 'success' | 'error' | 'warning' | 'info' = 'success') => {
    setToastMessage(message);
    setToastType(type);
    setToastVisible(true);
  }, []);

  const resetForm = useCallback(() => {
    setName('');
    setNameAr('');
    setLogoImage('');
    setIsEditMode(false);
    setEditingBrand(null);
  }, []);

  const handleEditBrand = useCallback((brand: CarBrand) => {
    setName(brand.name || '');
    setNameAr(brand.name_ar || '');
    setLogoImage(brand.logo || '');
    setEditingBrand(brand);
    setIsEditMode(true);
  }, []);

  const handleSave = useCallback(async () => {
    if (!name.trim() || !nameAr.trim()) {
      showToast(language === 'ar' ? 'يرجى إدخال الاسم بالإنجليزية والعربية' : 'Please enter name in both languages', 'error');
      return;
    }
    const brandData = {
      name: name.trim(),
      name_ar: nameAr.trim(),
      logo: logoImage || undefined,
    };
    if (isEditMode && editingBrand) {
      updateMutation.mutate({ id: editingBrand.id, data: brandData });
    } else {
      createMutation.mutate(brandData);
    }
  }, [name, nameAr, logoImage, isEditMode, editingBrand, language, showToast, createMutation, updateMutation]);

  const handleDelete = useCallback((id: string) => {
    showConfirm({
      title: language === 'ar' ? 'حذف المنشأ' : 'Delete Cuisine Origin',
      message: language === 'ar' ? 'هل أنت متأكد من حذف هذا المنشأ؟' : 'Are you sure you want to delete this cuisine origin?',
      confirmText: language === 'ar' ? 'حذف' : 'Delete',
      cancelText: language === 'ar' ? 'إلغاء' : 'Cancel',
      onConfirm: () => deleteMutation.mutate(id),
    });
  }, [deleteMutation, showConfirm, language]);

  const isSaving = createMutation.isPending || updateMutation.isPending;
  const { width: screenWidth } = useWindowDimensions();
  const isWide = screenWidth > 600;
  const isConfigTab = activeTab !== 'brands';

  const formState: FormState = useMemo(() => ({
    name, nameAr, logoImage, isEditMode, editingBrand, searchQuery,
  }), [name, nameAr, logoImage, isEditMode, editingBrand, searchQuery]);

  const formHandlers: FormHandlers = useMemo(() => ({
    setName, setNameAr, setLogoImage, handleSave, resetForm, setSearchQuery,
  }), [handleSave, resetForm]);

  const tabBar = (
    <View style={[styles.tabContainer, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <TouchableOpacity
        style={[styles.tab, activeTab === 'brands' && { backgroundColor: colors.primary }]}
        onPress={() => setActiveTab('brands')}
      >
        <Ionicons name="restaurant" size={15} color={activeTab === 'brands' ? '#FFF' : colors.textSecondary} />
        <Text style={[styles.tabText, { color: activeTab === 'brands' ? '#FFF' : colors.textSecondary }]}>
          {language === 'ar' ? 'المطابخ' : 'Origins'}
        </Text>
      </TouchableOpacity>
      <TouchableOpacity
        style={[styles.tab, activeTab === 'cuisines_page' && { backgroundColor: colors.primary }]}
        onPress={() => setActiveTab('cuisines_page')}
      >
        <Ionicons name="globe-outline" size={15} color={activeTab === 'cuisines_page' ? '#FFF' : colors.textSecondary} />
        <Text style={[styles.tabText, { color: activeTab === 'cuisines_page' ? '#FFF' : colors.textSecondary }]}>
          {language === 'ar' ? 'صفحة المطابخ' : 'Cuisines'}
        </Text>
        {cb_isDirty && <View style={styles.tabDirtyDot} />}
      </TouchableOpacity>
    </View>
  );

  const cuisinesPagePanel = cbLoading ? (
    <View style={styles.loadingContainer}>
      <ActivityIndicator size="large" color={colors.primary} />
    </View>
  ) : (
    <PageConfigPanel
      bgImage={cb_bgImage}
      setBgImage={setCb_bgImage}
      titleEn={cb_titleEn}
      setTitleEn={setCb_titleEn}
      titleAr={cb_titleAr}
      setTitleAr={setCb_titleAr}
      subtitleEn={cb_subtitleEn}
      setSubtitleEn={setCb_subtitleEn}
      subtitleAr={cb_subtitleAr}
      setSubtitleAr={setCb_subtitleAr}
      isDirty={cb_isDirty}
      onSave={() => handleSaveConfig('car_brands_page_config', {
        bg_image: cb_bgImage,
        title_en: cb_titleEn,
        title_ar: cb_titleAr,
        subtitle_en: cb_subtitleEn,
        subtitle_ar: cb_subtitleAr,
      }, setCb_saving)}
      saving={cb_saving}
      colors={colors}
      language={language}
      isRTL={isRTL}
      sectionTitle={language === 'ar' ? 'إعدادات صفحة المأكولات' : 'Cuisines Page Settings'}
      previewIcon="restaurant"
    />
  );

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['bottom']}>
      <Header title={language === 'ar' ? 'منشأ المطبخ' : 'Cuisine Origins'} showBack showSearch={false} showCart={false} />

      {tabBar}

      {/* Wide-screen config tabs: rendered outside the outer ScrollView so the
          PageConfigPanel's internal left-column ScrollView provides true scrolling
          while the right preview panel stays pinned at the top of its column. */}
      {isWide && isConfigTab ? (
        <View style={styles.wideConfigContainer}>
          {activeTab === 'cuisines_page' && cuisinesPagePanel}
        </View>
      ) : (
        <ScrollView
          style={styles.mainScrollView}
          contentContainerStyle={styles.mainScrollContent}
          showsVerticalScrollIndicator={true}
          keyboardShouldPersistTaps="handled"
          nestedScrollEnabled={true}
          refreshControl={
            activeTab === 'brands'
              ? <RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={colors.primary} />
              : undefined
          }
        >
          {/* ── Tab 1: Brands CRUD ── */}
          {activeTab === 'brands' && (
            <>
              <View style={styles.formSection}>
                <CarBrandFormHeader
                  formState={formState}
                  handlers={formHandlers}
                  colors={colors}
                  language={language}
                  isRTL={isRTL}
                  isSaving={isSaving}
                  brandsCount={filteredBrands.length}
                  router={router}
                />
              </View>

              {/* Sort controls */}
              <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, marginBottom: 8, gap: 8 }}>
                <Text style={{ color: colors.textSecondary, fontSize: 12 }}>
                  {language === 'ar' ? 'ترتيب:' : 'Sort:'}
                </Text>
                {(['default', 'name_asc', 'name_desc'] as const).map((opt) => {
                  const labels: Record<typeof opt, { en: string; ar: string }> = {
                    default: { en: 'Default', ar: 'افتراضي' },
                    name_asc: { en: 'A → Z', ar: 'أ ← ي' },
                    name_desc: { en: 'Z → A', ar: 'ي → أ' },
                  };
                  const active = brandSortBy === opt;
                  return (
                    <TouchableOpacity key={opt} onPress={() => setBrandSortBy(opt)}
                      style={{ paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12, backgroundColor: active ? colors.primary : colors.surface, borderWidth: 1, borderColor: active ? colors.primary : colors.border }}>
                      <Text style={{ fontSize: 11, fontWeight: active ? '700' : '400', color: active ? '#fff' : colors.textSecondary }}>
                        {language === 'ar' ? labels[opt].ar : labels[opt].en}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              <View style={styles.brandsListContainer}>
                {isLoading ? (
                  <View style={styles.loadingContainer}>
                    <ActivityIndicator size="large" color={colors.primary} />
                  </View>
                ) : filteredBrands.length === 0 ? (
                  <View style={styles.emptyContainer}>
                    <Ionicons name="restaurant-outline" size={48} color={colors.textSecondary} />
                    <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
                      {searchQuery ? (language === 'ar' ? 'لا توجد نتائج' : 'No results found') : (language === 'ar' ? 'لا توجد ماركات' : 'No brands found')}
                    </Text>
                  </View>
                ) : (
                  <View>
                    {filteredBrands.map((brand: CarBrand) => (
                      <BrandListItem
                        key={brand.id}
                        brand={brand}
                        colors={colors}
                        onEdit={handleEditBrand}
                        onDelete={handleDelete}
                      />
                    ))}
                  </View>
                )}
              </View>
            </>
          )}

          {/* Narrow config tabs (stacked layout) */}
          {activeTab === 'cuisines_page' && cuisinesPagePanel}

          <View style={{ height: insets.bottom + 40 }} />
        </ScrollView>
      )}

      <Toast
        visible={toastVisible}
        message={toastMessage}
        type={toastType}
        onDismiss={() => setToastVisible(false)}
      />
      {ConfirmModalNode}
    </SafeAreaView>
  );
}

// ============================================================================
// Styles
// ============================================================================
const styles = StyleSheet.create({
  container: { flex: 1 },
  mainScrollView: { flex: 1 },
  mainScrollContent: { paddingHorizontal: 16 },
  formSection: { paddingTop: 16 },
  brandsListContainer: { flex: 1 },
  loadingContainer: { padding: 40, alignItems: 'center' },
  emptyContainer: { padding: 40, alignItems: 'center' },
  listHeaderContainer: {},
  breadcrumb: { flexDirection: 'row', alignItems: 'center', marginBottom: 16, gap: 8 },
  breadcrumbRTL: { flexDirection: 'row-reverse' },
  breadcrumbText: { fontSize: 14 },
  formCard: { borderRadius: 12, borderWidth: 1.9, padding: 16, marginBottom: 16 },
  formTitleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 },
  formTitle: { fontSize: 18, fontWeight: '700' },
  cancelEditBtn: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20, gap: 4 },
  cancelEditText: { fontSize: 14, fontWeight: '600' },
  formGroup: { marginBottom: 16 },
  label: { fontSize: 14, fontWeight: '600', marginBottom: 8 },
  input: { borderWidth: 1, borderRadius: 8, padding: 12, fontSize: 16 },
  inputRTL: { textAlign: 'right' },
  saveButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', padding: 14, borderRadius: 8, gap: 8 },
  saveButtonText: { color: '#FFF', fontSize: 16, fontWeight: '600' },
  listCard: { borderRadius: 12, borderWidth: 1.9, padding: 16, marginBottom: 8 },
  listTitle: { fontSize: 18, fontWeight: '700', marginBottom: 16 },
  searchContainer: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10, gap: 10 },
  searchInput: { flex: 1, fontSize: 15, paddingVertical: 0 },
  emptyText: { textAlign: 'center', marginTop: 12, fontSize: 15 },
  listItem: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, borderBottomWidth: 1 },
  brandLogo: { width: 90, height: 90, borderRadius: 8 },
  brandLogoPlaceholder: { width: 48, height: 48, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  brandInfo: { flex: 1, marginLeft: 12 },
  brandName: { fontSize: 17, fontWeight: '700', textAlign: 'center' },
  brandNameAr: { fontSize: 15, fontWeight: '700', marginTop: 2, textAlign: 'center' },
  actionButtons: { flexDirection: 'column', gap: 8 },
  editButton: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  deleteButton: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  // Wide-screen config tab container (outside outer ScrollView)
  wideConfigContainer: {
    flex: 1,
  },
  // Tab bar
  tabContainer: {
    flexDirection: 'row',
    marginHorizontal: 16,
    marginTop: 8,
    borderRadius: 12,
    borderWidth: 1,
    overflow: 'hidden',
  },
  tab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    gap: 4,
  },
  tabText: {
    fontWeight: '600',
    fontSize: 11,
  },
  tabDirtyDot: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 7,
    height: 7,
    borderRadius: 3.5,
    backgroundColor: '#FFA500',
  },
});

const cfgStyles = StyleSheet.create({
  container: { padding: 16 },
  sectionTitle: { fontSize: 17, fontWeight: '700', marginBottom: 16 },
  card: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 16,
    marginBottom: 14,
  },
  cardHeading: { fontSize: 15, fontWeight: '700', marginBottom: 12 },
  cardLabel: { fontSize: 13, fontWeight: '600', marginBottom: 10 },
  label: { fontSize: 13, fontWeight: '600', marginBottom: 6 },
  input: { borderWidth: 1, borderRadius: 8, padding: 12, fontSize: 15 },
  multiline: { minHeight: 80 },
  saveBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 14,
    borderRadius: 10,
    gap: 8,
    marginTop: 4,
  },
  saveBtnText: { color: '#FFF', fontSize: 16, fontWeight: '600' },
  // Wide-screen split-pane layout
  splitRow: {
    flexDirection: 'row',
    flex: 1,
    alignItems: 'flex-start',
  },
  splitLeft: {
    flex: 1,
  },
  splitLeftContent: {
    padding: 16,
    paddingRight: 12,
  },
  splitRight: {
    paddingTop: 16,
    paddingHorizontal: 12,
    borderLeftWidth: 1,
    alignSelf: 'flex-start',
  },
});

const previewStyles = StyleSheet.create({
  wrapper: {
    borderRadius: 12,
    borderWidth: 1,
    overflow: 'hidden',
    marginBottom: 14,
  },
  labelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: 6,
  },
  label: {
    fontSize: 11,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  langToggle: {
    flexDirection: 'row',
    borderRadius: 6,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(128,128,128,0.3)',
  },
  langBtn: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    backgroundColor: 'transparent',
  },
  langBtnText: {
    fontSize: 10,
    fontWeight: '700',
    color: 'rgba(128,128,128,0.7)',
  },
  langBtnTextActive: {
    color: '#FFF',
  },
  header: {
    height: 130,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
    overflow: 'hidden',
  },
  overlay: {
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  iconCircle: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 6,
  },
  previewTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#FFF',
    marginBottom: 4,
    textAlign: 'center',
  },
  previewSubtitle: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.8)',
    textAlign: 'center',
  },
  fieldHighlight: {
    borderRadius: 4,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.8)',
    backgroundColor: 'rgba(255,255,255,0.18)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    marginBottom: 2,
  },
});


/* __ACCESS_GUARD_APPLIED__ */
export default function CarBrandsAdminGuarded(props: any) {
  return (
    <__AccessGuard__ scope="admin">
      <CarBrandsAdmin {...props} />
    </__AccessGuard__>
  );
}
