/**
 * Product Brands Admin - Refactored with standalone form component
 * Fixes TextInput focus loss by extracting form outside FlashList
 */
import React, { useState, useMemo, useCallback, memo } from 'react';
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
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTheme } from '../../src/hooks/useTheme';
import { useTranslation } from '../../src/hooks/useTranslation';
import { productBrandsApi } from '../../src/services/api';
import { useAdminSync } from '../../src/services/adminSyncService';
import { PageConfigPanel, usePageConfig } from '../../src/components/admin/PageConfigPanel';
import { Header } from '../../src/components/Header';
import { ImageUploader } from '../../src/components/ui/ImageUploader';
import { Toast } from '../../src/components/ui/FormFeedback';
import { queryKeys } from '../../src/lib/queryClient';
import { useConfirmModal } from '../../src/components/ConfirmModal';
import { AccessGuard as __AccessGuard__ } from '../../src/components/AccessGuard';
// Types
interface ProductBrand {
  id: string;
  name: string;
  name_ar: string;
  logo?: string;
  country_of_origin?: string;
  country_of_origin_ar?: string;
}

interface FormState {
  name: string;
  nameAr: string;
  logoImage: string;
  countryOfOrigin: string;
  countryOfOriginAr: string;
  isEditMode: boolean;
  editingBrand: ProductBrand | null;
  searchQuery: string;
}

interface FormHandlers {
  setName: (v: string) => void;
  setNameAr: (v: string) => void;
  setLogoImage: (v: string) => void;
  setCountryOfOrigin: (v: string) => void;
  setCountryOfOriginAr: (v: string) => void;
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

// ============================================================================
// Standalone Form Header Component
// ============================================================================
const ProductBrandFormHeader = memo(({
  formState,
  handlers,
  colors,
  language,
  isRTL,
  isSaving,
  brandsCount,
  router,
}: FormHeaderProps) => {
  const { name, nameAr, logoImage, countryOfOrigin, countryOfOriginAr, isEditMode, searchQuery } = formState;
  const { setName, setNameAr, setLogoImage, setCountryOfOrigin, setCountryOfOriginAr, handleSave, resetForm, setSearchQuery } = handlers;

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
          {language === 'ar' ? 'ماركات الشيف' : 'Chef Brands'}
        </Text>
      </View>

      {/* Add/Edit Form */}
      <View style={[styles.formCard, { backgroundColor: colors.card, borderColor: isEditMode ? colors.primary : colors.border }]}>
        <View style={styles.formTitleRow}>
          <Text style={[styles.formTitle, { color: isEditMode ? colors.primary : colors.text }]}>
            {isEditMode 
              ? (language === 'ar' ? 'تعديل ماركة الشيف' : 'Edit Chef Brand')
              : (language === 'ar' ? 'إضافة ماركة شيف جديدة' : 'Add New Chef Brand')
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

        {/* Logo Upload */}
        <View style={styles.formGroup}>
          <ImageUploader
            mode="single"
            value={logoImage}
            onChange={(newImage) => setLogoImage(newImage as string)}
            size="medium"
            shape="circle"
            label={language === 'ar' ? 'صورة الشيف' : 'Chef Photo'}
            hint={language === 'ar' ? 'اختر صورة الشيف' : 'Choose chef photo'}
          />
        </View>

        <View style={styles.formGroup}>
          <Text style={[styles.label, { color: colors.text }]}>
            {language === 'ar' ? 'الاسم (بالإنجليزية) *' : 'Name (English) *'}
          </Text>
          <TextInput
            style={[styles.input, { backgroundColor: colors.surface, borderColor: colors.border, color: colors.text }]}
            value={name}
            onChangeText={setName}
            placeholder={language === 'ar' ? 'مثال: Chef Ahmed' : 'e.g., Chef Ahmed'}
            placeholderTextColor={colors.textSecondary}
          />
        </View>

        <View style={styles.formGroup}>
          <Text style={[styles.label, { color: colors.text }]}>
            {language === 'ar' ? 'الاسم (بالعربية) *' : 'Name (Arabic) *'}
          </Text>
          <TextInput
            style={[styles.input, { backgroundColor: colors.surface, borderColor: colors.border, color: colors.text }, isRTL && styles.inputRTL]}
            value={nameAr}
            onChangeText={setNameAr}
            placeholder={language === 'ar' ? 'مثال: الشيف أحمد' : 'e.g., الشيف أحمد'}
            placeholderTextColor={colors.textSecondary}
          />
        </View>

        {/* Country of Origin */}
        <View style={[styles.formSection, { borderColor: colors.border }]}>
          <Text style={[styles.sectionLabel, { color: colors.primary }]}>
            <Ionicons name="flag" size={14} /> {language === 'ar' ? 'تخصص الشيف' : 'Chef Specialty'}
          </Text>

          <View style={styles.formGroup}>
            <Text style={[styles.label, { color: colors.text }]}>
              {language === 'ar' ? 'التخصص (بالإنجليزية)' : 'Specialty (English)'}
            </Text>
            <TextInput
              style={[styles.input, { backgroundColor: colors.surface, borderColor: colors.border, color: colors.text }]}
              value={countryOfOrigin}
              onChangeText={setCountryOfOrigin}
              placeholder={language === 'ar' ? 'مثال: Italian Cuisine' : 'e.g., Italian Cuisine'}
              placeholderTextColor={colors.textSecondary}
            />
          </View>

          <View style={styles.formGroup}>
            <Text style={[styles.label, { color: colors.text }]}>
              {language === 'ar' ? 'التخصص (بالعربية)' : 'Specialty (Arabic)'}
            </Text>
            <TextInput
              style={[styles.input, { backgroundColor: colors.surface, borderColor: colors.border, color: colors.text }, isRTL && styles.inputRTL]}
              value={countryOfOriginAr}
              onChangeText={setCountryOfOriginAr}
              placeholder={language === 'ar' ? 'مثال: المطبخ الإيطالي' : 'e.g., المطبخ الإيطالي'}
              placeholderTextColor={colors.textSecondary}
            />
          </View>
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
          {language === 'ar' ? 'الشيفات الحاليون' : 'Existing Chef Brands'} ({brandsCount})
        </Text>

        {/* Search Bar */}
        <View style={[styles.searchContainer, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Ionicons name="search" size={20} color={colors.textSecondary} />
          <TextInput
            style={[styles.searchInput, { color: colors.text }]}
            value={searchQuery}
            onChangeText={setSearchQuery}
            placeholder={language === 'ar' ? 'ابحث بالاسم أو البلد...' : 'Search by name or country...'}
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

ProductBrandFormHeader.displayName = 'ProductBrandFormHeader';

// ============================================================================
// Memoized Brand List Item Component
// ============================================================================
const BrandListItem = memo(({
  brand,
  colors,
  language,
  onEdit,
  onDelete,
}: {
  brand: ProductBrand;
  colors: any;
  language: string;
  onEdit: (brand: ProductBrand) => void;
  onDelete: (id: string) => void;
}) => (
  <View style={[styles.listItem, { borderColor: colors.border }]}>
    {brand.logo ? (
      <Image source={{ uri: brand.logo }} style={styles.brandLogo} />
    ) : (
      <View style={[styles.brandIcon, { backgroundColor: colors.primary + '20' }]}>
        <Ionicons name="pricetag" size={24} color={colors.primary} />
      </View>
    )}
    <View style={styles.brandInfo}>
      <Text style={[styles.brandName, { color: colors.text }]}>
        {language === 'ar' ? brand.name_ar || brand.name : brand.name}
      </Text>
      {(brand.country_of_origin || brand.country_of_origin_ar) && (
        <View style={styles.countryRow}>
          <Ionicons name="flag" size={12} color={colors.textSecondary} />
          <Text style={[styles.countryText, { color: colors.textSecondary }]}>
            {language === 'ar' ? brand.country_of_origin_ar || brand.country_of_origin : brand.country_of_origin}
          </Text>
        </View>
      )}
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
function ProductBrandsAdmin() {
  const { colors } = useTheme();
  const { language, isRTL } = useTranslation();
  const { showConfirm, ConfirmModalNode } = useConfirmModal();
  const router = useRouter();
  const queryClient = useQueryClient();
  const adminSync = useAdminSync();
  const insets = useSafeAreaInsets();

  // Form state
  const [name, setName] = useState('');
  const [nameAr, setNameAr] = useState('');
  const [countryOfOrigin, setCountryOfOrigin] = useState('');
  const [countryOfOriginAr, setCountryOfOriginAr] = useState('');
  const [logoImage, setLogoImage] = useState<string>('');
  const [editingBrand, setEditingBrand] = useState<ProductBrand | null>(null);
  const [isEditMode, setIsEditMode] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  // Toast state
  const [toastVisible, setToastVisible] = useState(false);
  const [toastMessage, setToastMessage] = useState('');
  const [toastType, setToastType] = useState<'success' | 'error' | 'warning' | 'info'>('success');

  // Tabs: 'brands' = CRUD list, 'page' = brands_page_config
  const [activeTab, setActiveTab] = useState<'brands' | 'page'>('brands');

  // TanStack Query: Fetch Brands
  const {
    data: brandsData,
    isLoading,
    isRefetching,
    refetch,
  } = useQuery({
    queryKey: queryKeys.productBrands.all,
    queryFn: async () => {
      const response = await productBrandsApi.getAll();
      return response.data || [];
    },
    staleTime: 2 * 60 * 1000,
  });

  const brands: ProductBrand[] = brandsData || [];

  // Filter brands
  const filteredBrands = useMemo(() => {
    if (!searchQuery.trim()) return brands;
    const query = searchQuery.toLowerCase();
    return brands.filter((brand) => {
      const brandName = (brand.name || '').toLowerCase();
      const brandNameAr = (brand.name_ar || '').toLowerCase();
      const country = (brand.country_of_origin || '').toLowerCase();
      return brandName.includes(query) || brandNameAr.includes(query) || country.includes(query);
    });
  }, [brands, searchQuery]);

  // Mutations
  const createMutation = useMutation({
    mutationFn: async (data: any) => adminSync.createProductBrand(data),
    onSuccess: (result) => {
      if (result.success) {
        queryClient.invalidateQueries({ queryKey: queryKeys.productBrands.all });
        showToast(language === 'ar' ? 'تم إضافة ماركة الشيف بنجاح' : 'Chef brand added successfully', 'success');
        resetForm();
      } else {
        showToast(result.error || 'Failed to create brand', 'error');
      }
    },
    onError: (error: any) => showToast(error.message || 'Failed to create brand', 'error'),
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: any }) => adminSync.updateProductBrand(id, data),
    onSuccess: (result) => {
      if (result.success) {
        queryClient.invalidateQueries({ queryKey: queryKeys.productBrands.all });
        showToast(language === 'ar' ? 'تم تحديث ماركة الشيف بنجاح' : 'Chef brand updated successfully', 'success');
        resetForm();
      } else {
        showToast(result.error || 'Failed to update brand', 'error');
      }
    },
    onError: (error: any) => showToast(error.message || 'Failed to update brand', 'error'),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => adminSync.deleteProductBrand(id),
    onMutate: async (deletedId) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.productBrands.all });
      const previousBrands = queryClient.getQueryData(queryKeys.productBrands.all);
      queryClient.setQueryData(queryKeys.productBrands.all, (old: ProductBrand[] | undefined) =>
        old ? old.filter(b => b.id !== deletedId) : []
      );
      return { previousBrands };
    },
    onSuccess: (result) => {
      if (result.success) {
        showToast(language === 'ar' ? 'تم حذف ماركة الشيف بنجاح' : 'Chef brand deleted successfully', 'success');
      } else {
        showToast(result.error || 'Failed to delete brand', 'error');
        queryClient.invalidateQueries({ queryKey: queryKeys.productBrands.all });
      }
    },
    onError: (error, variables, context) => {
      if (context?.previousBrands) queryClient.setQueryData(queryKeys.productBrands.all, context.previousBrands);
      showToast(language === 'ar' ? 'فشل في حذف ماركة الشيف' : 'Failed to delete chef brand', 'error');
    },
  });

  const showToast = useCallback((message: string, type: 'success' | 'error' | 'warning' | 'info' = 'success') => {
    setToastMessage(message);
    setToastType(type);
    setToastVisible(true);
  }, []);

  const resetForm = useCallback(() => {
    setName(''); setNameAr(''); setCountryOfOrigin(''); setCountryOfOriginAr('');
    setLogoImage(''); setIsEditMode(false); setEditingBrand(null);
  }, []);

  const handleEditBrand = useCallback((brand: ProductBrand) => {
    setName(brand.name || ''); setNameAr(brand.name_ar || '');
    setCountryOfOrigin(brand.country_of_origin || '');
    setCountryOfOriginAr(brand.country_of_origin_ar || '');
    setLogoImage(brand.logo || ''); setEditingBrand(brand); setIsEditMode(true);
  }, []);

  const handleSave = useCallback(async () => {
    if (!name.trim() || !nameAr.trim()) {
      showToast(language === 'ar' ? 'يرجى إدخال الاسم بالإنجليزية والعربية' : 'Please enter name in both languages', 'error');
      return;
    }
    const brandData = {
      name: name.trim(), name_ar: nameAr.trim(), logo: logoImage || null,
      country_of_origin: countryOfOrigin.trim() || null, country_of_origin_ar: countryOfOriginAr.trim() || null,
    };
    if (isEditMode && editingBrand) updateMutation.mutate({ id: editingBrand.id, data: brandData });
    else createMutation.mutate(brandData);
  }, [name, nameAr, logoImage, countryOfOrigin, countryOfOriginAr, isEditMode, editingBrand, language, showToast, createMutation, updateMutation]);

  const handleDelete = useCallback((id: string) => {
    showConfirm({
      title: language === 'ar' ? 'حذف ماركة الشيف' : 'Delete Chef Brand',
      message: language === 'ar' ? 'هل أنت متأكد من حذف هذه الماركة؟' : 'Are you sure you want to delete this chef brand?',
      confirmText: language === 'ar' ? 'حذف' : 'Delete',
      cancelText: language === 'ar' ? 'إلغاء' : 'Cancel',
      onConfirm: () => deleteMutation.mutate(id),
    });
  }, [deleteMutation, showConfirm, language]);

  const isSaving = createMutation.isPending || updateMutation.isPending;

  const formState: FormState = useMemo(() => ({
    name, nameAr, logoImage, countryOfOrigin, countryOfOriginAr, isEditMode, editingBrand, searchQuery,
  }), [name, nameAr, logoImage, countryOfOrigin, countryOfOriginAr, isEditMode, editingBrand, searchQuery]);

  const formHandlers: FormHandlers = useMemo(() => ({
    setName, setNameAr, setLogoImage, setCountryOfOrigin, setCountryOfOriginAr, handleSave, resetForm, setSearchQuery,
  }), [handleSave, resetForm]);

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['bottom']}>
      <Header title={language === 'ar' ? 'ماركات الشيف' : 'Chef Brands'} showBack showSearch={false} showCart={false} />

      {/* Tab bar */}
      <View style={[tabBarStyles.row, { backgroundColor: colors.card, borderBottomColor: colors.border }]}>
        <TouchableOpacity
          style={[tabBarStyles.btn, activeTab === 'brands' && { borderBottomColor: colors.primary, borderBottomWidth: 2 }]}
          onPress={() => setActiveTab('brands')}
          activeOpacity={0.75}
        >
          <Ionicons name="pricetag-outline" size={16} color={activeTab === 'brands' ? colors.primary : colors.textSecondary} />
          <Text style={[tabBarStyles.label, { color: activeTab === 'brands' ? colors.primary : colors.textSecondary, fontWeight: activeTab === 'brands' ? '700' : '500' }]}>
            {language === 'ar' ? 'الماركات' : 'Brands'}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[tabBarStyles.btn, activeTab === 'page' && { borderBottomColor: colors.primary, borderBottomWidth: 2 }]}
          onPress={() => setActiveTab('page')}
          activeOpacity={0.75}
        >
          <Ionicons name="briefcase-outline" size={16} color={activeTab === 'page' ? colors.primary : colors.textSecondary} />
          <Text style={[tabBarStyles.label, { color: activeTab === 'page' ? colors.primary : colors.textSecondary, fontWeight: activeTab === 'page' ? '700' : '500' }]}>
            {language === 'ar' ? 'صفحة العلامات' : 'Brands Page'}
          </Text>
        </TouchableOpacity>
      </View>

      {activeTab === 'page' ? (
        <BrandsPageConfigTab
          colors={colors}
          language={language}
          isRTL={isRTL}
          insets={insets}
          showToast={showToast}
        />
      ) : (
      <ScrollView
        style={styles.mainScrollView}
        contentContainerStyle={styles.mainScrollContent}
        showsVerticalScrollIndicator={true}
        keyboardShouldPersistTaps="handled"
        nestedScrollEnabled={true}
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={colors.primary} />}
      >
        <View style={styles.formSection}>
          <ProductBrandFormHeader
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

        <View style={styles.brandsListContainer}>
          {isLoading ? (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="large" color={colors.primary} />
            </View>
          ) : filteredBrands.length === 0 ? (
            <View style={styles.emptyContainer}>
              <Ionicons name="pricetag-outline" size={48} color={colors.textSecondary} />
              <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
                {searchQuery ? (language === 'ar' ? 'لا توجد نتائج' : 'No results found') : (language === 'ar' ? 'لا توجد ماركات شيف' : 'No chef brands found')}
              </Text>
            </View>
          ) : (
            <View>
              {filteredBrands.map((brand: ProductBrand) => (
                <BrandListItem
                  key={brand.id}
                  brand={brand}
                  colors={colors}
                  language={language}
                  onEdit={handleEditBrand}
                  onDelete={handleDelete}
                />
              ))}
            </View>
          )}
        </View>
        
        <View style={{ height: insets.bottom + 40 }} />
      </ScrollView>
      )}

      <Toast visible={toastVisible} message={toastMessage} type={toastType} onDismiss={() => setToastVisible(false)} />
      {ConfirmModalNode}
    </SafeAreaView>
  );
}

// ─── Brands Page Config Tab (brands_page_config) ────────────────────────────
function BrandsPageConfigTab({
  colors, language, isRTL, insets, showToast,
}: {
  colors: any; language: string; isRTL: boolean; insets: { bottom: number };
  showToast: (msg: string, type?: 'success' | 'error' | 'warning' | 'info') => void;
}) {
  const { state, setters, save } = usePageConfig('brands_page_config', {
    title_en: 'Combo Meals',
    title_ar: 'وجبات الكومبو',
    subtitle_en: 'Discover the finest combo meals at Al-Ghazaly',
    subtitle_ar: 'استمتع بأشهى وجبات الكومبو من مطعم الغزالي',
  });

  const onSave = () => save(
    false,
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
        isDirty={state.isDirty}
        onSave={onSave}
        saving={state.saving}
        colors={colors}
        language={language}
        isRTL={isRTL}
        sectionTitle={language === 'ar' ? 'إعدادات صفحة العلامات' : 'Brands Page Settings'}
        previewIcon="briefcase"
      />
      <View style={{ height: insets.bottom + 40 }} />
    </View>
  );
}

const tabBarStyles = StyleSheet.create({
  row: { flexDirection: 'row', borderBottomWidth: 1 },
  btn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 12, gap: 6, borderBottomWidth: 2, borderBottomColor: 'transparent' },
  label: { fontSize: 13 },
});

const styles = StyleSheet.create({
  container: { flex: 1 },
  mainScrollView: { flex: 1 },
  mainScrollContent: { paddingHorizontal: 16 },
  brandsListContainer: { flex: 1 },
  loadingContainer: { padding: 40, alignItems: 'center' },
  emptyContainer: { padding: 40, alignItems: 'center' },
  listHeaderContainer: {},
  breadcrumb: { flexDirection: 'row', alignItems: 'center', marginBottom: 16, gap: 8 },
  breadcrumbRTL: { flexDirection: 'row-reverse' },
  breadcrumbText: { fontSize: 14 },
  formCard: { borderRadius: 12, borderWidth: 1, padding: 16, marginBottom: 16 },
  formTitleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 },
  formTitle: { fontSize: 18, fontWeight: '700' },
  cancelEditBtn: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20, gap: 4 },
  cancelEditText: { fontSize: 14, fontWeight: '600' },
  formGroup: { marginBottom: 16 },
  formSection: { borderTopWidth: 1, paddingTop: 16, marginTop: 8, marginBottom: 16 },
  sectionLabel: { fontSize: 14, fontWeight: '700', marginBottom: 12 },
  label: { fontSize: 14, fontWeight: '600', marginBottom: 8 },
  input: { borderWidth: 1, borderRadius: 8, padding: 12, fontSize: 16 },
  inputRTL: { textAlign: 'right' },
  saveButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', padding: 14, borderRadius: 8, gap: 8 },
  saveButtonText: { color: '#FFF', fontSize: 16, fontWeight: '600' },
  listCard: { borderRadius: 12, borderWidth: 1, padding: 16, marginBottom: 8 },
  listTitle: { fontSize: 18, fontWeight: '700', marginBottom: 16 },
  searchContainer: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10, gap: 10 },
  searchInput: { flex: 1, fontSize: 15, paddingVertical: 0 },
  emptyText: { textAlign: 'center', marginTop: 12, fontSize: 15 },
  listItem: { flexDirection: 'row', alignItems: 'center', paddingVertical: 16, borderBottomWidth: 1 },
  brandLogo: { width: 90, height: 90, borderRadius: 28 },
  brandIcon: { width: 90, height: 90, borderRadius: 28, alignItems: 'center', justifyContent: 'center' },
  brandInfo: { flex: 1, marginLeft: 12 },
  brandName: { fontSize: 16, fontWeight: '600' ,textAlign: 'center', },
  countryRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginTop: 7, gap: 5 },
  countryText: { fontSize: 19, },
  actionButtons: { flexDirection: 'column', gap: 8 },
  editButton: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  deleteButton: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
});


/* __ACCESS_GUARD_APPLIED__ */
export default function ProductBrandsAdminGuarded(props: any) {
  return (
    <__AccessGuard__ scope="admin">
      <ProductBrandsAdmin {...props} />
    </__AccessGuard__>
  );
}
