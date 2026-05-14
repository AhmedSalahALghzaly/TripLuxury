/**
 * Suppliers Management - Professional UI/UX with RBAC
 * Features:
 * - Role-Based Access Control (owner, admin, partner, subscriber can view)
 * - Golden Glow Animation for customer restrictions
 * - Luminous Blue contact fields
 * - Image Gallery with horizontal scroll
 * - AnimatedBrandCard for linked brands
 */
import React, { useState, useCallback, useMemo, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  RefreshControl,
  ActivityIndicator,
  Linking,
  Dimensions,
} from 'react-native';
import { Image } from 'expo-image';
import { FlashList } from '@shopify/flash-list';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSequence,
  withTiming,
  interpolateColor,
  Easing,
  runOnJS,
} from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import { useAppStore } from '../../src/store/appStore';
import { useTheme } from '../../src/hooks/useTheme';
import { supplierApi } from '../../src/services/api';
import { VoidDeleteGesture } from '../../src/components/ui/VoidDeleteGesture';
import { ErrorCapsule } from '../../src/components/ui/ErrorCapsule';
import { ConfettiEffect } from '../../src/components/ui/ConfettiEffect';
import { Toast } from '../../src/components/ui/FormFeedback';
import { queryKeys } from '../../src/lib/queryClient';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const LUMINOUS_BLUE = '#00D4FF';
const GOLD_COLOR = '#FFD700';

type ViewMode = 'list' | 'profile';

interface Supplier {
  id: string;
  name: string;
  name_ar?: string;
  // Backend uses phone_numbers array, but we also handle legacy 'phone' field
  phone?: string;
  phone_numbers?: string[];
  address?: string;
  address_ar?: string;
  description?: string;
  description_ar?: string;
  // Backend uses website_url, but we also handle legacy 'website' field
  website?: string;
  website_url?: string;
  contact_email?: string;
  profile_image?: string;
  images?: string[];
  slider_images?: string[];
  linked_brands?: string[];
  linked_product_brand_ids?: string[];
  linked_restaurant_ids?: string[];
  linked_category_ids?: string[];
  created_at?: string;
}

// Check if user can view entity profiles
const canViewEntityProfile = (userRole?: string, subscriptionStatus?: string, userObjRole?: string): boolean => {
  const allowedRoles = ['owner', 'admin', 'partner', 'subscriber'];
  return (
    allowedRoles.includes(userRole || '') ||
    allowedRoles.includes(userObjRole || '') ||
    subscriptionStatus === 'subscriber'
  );
};

// Memoized Supplier List Item with RBAC
const SupplierListItem = React.memo(({
  supplier,
  colors,
  isRTL,
  language,
  isOwnerOrAdmin,
  canViewProfile,
  onPress,
  onDelete,
  onRestrictedPress,
}: {
  supplier: Supplier;
  colors: any;
  isRTL: boolean;
  language: string;
  isOwnerOrAdmin: boolean;
  canViewProfile: boolean;
  onPress: (supplier: Supplier) => void;
  onDelete: (id: string) => void;
  onRestrictedPress: () => void;
}) => {
  const displayName = isRTL && supplier.name_ar ? supplier.name_ar : supplier.name;
  // Get first phone number from array or fallback to legacy phone field
  const displayPhone = supplier.phone_numbers?.[0] || supplier.phone;
  
  const handlePress = () => {
    if (canViewProfile) {
      onPress(supplier);
    } else {
      onRestrictedPress();
    }
  };
  
  return (
    <VoidDeleteGesture onDelete={() => onDelete(supplier.id)} enabled={isOwnerOrAdmin}>
      <TouchableOpacity
        style={[styles.supplierCard, { backgroundColor: colors.card, borderColor: colors.border }]}
        onPress={handlePress}
        activeOpacity={0.7}
      >
        <View style={[styles.supplierCardContent, isRTL && styles.cardRTL]}>
          {supplier.profile_image ? (
            <Image source={{ uri: supplier.profile_image }} style={styles.supplierImage} contentFit="cover" />
          ) : (
            <View style={[styles.supplierImagePlaceholder, { backgroundColor: colors.primary + '20' }]}>
              <Ionicons name="storefront-outline" size={28} color={colors.primary} />
            </View>
          )}
          <View style={[styles.supplierInfo, isRTL && styles.infoRTL]}>
            <Text style={[styles.supplierName, { color: colors.text }]} numberOfLines={1}>
              {displayName}
            </Text>
            {displayPhone && (
              <View style={[styles.supplierMeta, isRTL && styles.metaRTL]}>
                <Ionicons name="call" size={14} color={colors.textSecondary} />
                <Text style={[styles.supplierMetaText, { color: colors.textSecondary }]}>
                  {displayPhone}
                </Text>
              </View>
            )}
            {supplier.address && (
              <View style={[styles.supplierMeta, isRTL && styles.metaRTL]}>
                <Ionicons name="location" size={14} color={colors.textSecondary} />
                <Text style={[styles.supplierMetaText, { color: colors.textSecondary }]} numberOfLines={1}>
                  {isRTL && supplier.address_ar ? supplier.address_ar : supplier.address}
                </Text>
              </View>
            )}
          </View>
          <Ionicons name={isRTL ? 'chevron-back' : 'chevron-forward'} size={20} color={colors.textSecondary} />
        </View>
      </TouchableOpacity>
    </VoidDeleteGesture>
  );
});

export default function SuppliersScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ viewMode?: string; id?: string }>();
  const insets = useSafeAreaInsets();
  const { colors, isDark } = useTheme();
  const queryClient = useQueryClient();
  const language = useAppStore((state) => state.language);
  const carModels = useAppStore((state) => state.carModels);
  const categories = useAppStore((state) => state.categories);
  const user = useAppStore((state) => state.user);
  const userRole = useAppStore((state) => state.userRole);
  const subscriptionStatus = useAppStore((state) => state.subscriptionStatus);
  const isRTL = language === 'ar';
  
  const isOwnerOrAdmin = userRole === 'owner' || userRole === 'admin' || user?.is_admin;
  // The "+" add button and the pencil edit button must only be available to
  // the owner and partner roles — admins cannot create or edit
  // suppliers/distributors. Subscribers/customers obviously cannot either.
  const canAddOrEdit = userRole === 'owner' || userRole === 'partner';
  const canViewProfile = canViewEntityProfile(userRole, subscriptionStatus, user?.role);

  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const [error, setError] = useState<string | null>(null);
  const [showConfetti, setShowConfetti] = useState(false);
  const [selectedSupplier, setSelectedSupplier] = useState<Supplier | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedGalleryImage, setSelectedGalleryImage] = useState(0);
  const [isProfileLoading, setIsProfileLoading] = useState(false);
  const [activeRestaurantFilter, setActiveRestaurantFilter] = useState<string | null>(null);
  const [activeCategoryFilter, setActiveCategoryFilter] = useState<string | null>(null);

  // Golden Glow Animation State
  const [isGlowing, setIsGlowing] = useState(false);
  const glowProgress = useSharedValue(0);

  // Toast state
  const [toastVisible, setToastVisible] = useState(false);
  const [toastMessage, setToastMessage] = useState('');
  const [toastType, setToastType] = useState<'success' | 'error' | 'warning' | 'info'>('success');

  // TanStack Query: Fetch Suppliers
  const {
    data: suppliersData,
    isLoading,
    isRefetching,
    refetch,
  } = useQuery({
    queryKey: queryKeys.suppliers.all,
    queryFn: async () => {
      const res = await supplierApi.getAll();
      return res.data || [];
    },
    staleTime: 2 * 60 * 1000,
  });

  const suppliers: Supplier[] = suppliersData || [];

  // Derive available filter options from the fetched data
  const availableRestaurantFilters = useMemo(() => {
    const ids = new Set<string>();
    suppliers.forEach((s) => (s.linked_restaurant_ids || []).forEach((id) => ids.add(id)));
    return carModels.filter((r: any) => ids.has(r.id));
  }, [suppliers, carModels]);

  const availableCategoryFilters = useMemo(() => {
    const ids = new Set<string>();
    suppliers.forEach((s) => (s.linked_category_ids || []).forEach((id) => ids.add(id)));
    return categories.filter((c: any) => ids.has(c.id));
  }, [suppliers, categories]);

  // Filter suppliers based on search + active chips
  const filteredSuppliers = useMemo(() => {
    let result = suppliers;
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      result = result.filter((s) => {
        const name = (s.name || '').toLowerCase();
        const nameAr = (s.name_ar || '').toLowerCase();
        const phone = (s.phone || '').toLowerCase();
        return name.includes(query) || nameAr.includes(query) || phone.includes(query);
      });
    }
    if (activeRestaurantFilter) {
      result = result.filter((s) => (s.linked_restaurant_ids || []).includes(activeRestaurantFilter));
    }
    if (activeCategoryFilter) {
      result = result.filter((s) => (s.linked_category_ids || []).includes(activeCategoryFilter));
    }
    return result;
  }, [suppliers, searchQuery, activeRestaurantFilter, activeCategoryFilter]);

  const showToast = useCallback((message: string, type: 'success' | 'error' | 'warning' | 'info' = 'success') => {
    setToastMessage(message);
    setToastType(type);
    setToastVisible(true);
  }, []);

  // Golden Glow Animation for restricted access
  const triggerGoldenGlow = useCallback(() => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    setIsGlowing(true);
    
    const flashDuration = 250;
    glowProgress.value = withSequence(
      withTiming(1, { duration: flashDuration, easing: Easing.inOut(Easing.ease) }),
      withTiming(0, { duration: flashDuration, easing: Easing.inOut(Easing.ease) }),
      withTiming(1, { duration: flashDuration, easing: Easing.inOut(Easing.ease) }),
      withTiming(0, { duration: flashDuration, easing: Easing.inOut(Easing.ease) }),
      withTiming(1, { duration: flashDuration, easing: Easing.inOut(Easing.ease) }),
      withTiming(0, { duration: flashDuration, easing: Easing.inOut(Easing.ease) }, () => {
        runOnJS(setIsGlowing)(false);
      })
    );
  }, []);

  const glowTextStyle = useAnimatedStyle(() => {
    return {
      color: interpolateColor(
        glowProgress.value,
        [0, 1],
        ['#FFFFFF', GOLD_COLOR]
      ),
    };
  });

  // Delete Mutation with Optimistic Update
  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await supplierApi.delete(id);
      return id;
    },
    onMutate: async (deletedId) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.suppliers.all });
      const previousSuppliers = queryClient.getQueryData(queryKeys.suppliers.all);
      queryClient.setQueryData(queryKeys.suppliers.all, (old: Supplier[] | undefined) =>
        old ? old.filter(s => s.id !== deletedId) : []
      );
      return { previousSuppliers };
    },
    onSuccess: () => {
      showToast(isRTL ? 'تم حذف الشركة بنجاح' : 'Company deleted successfully', 'success');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    },
    onError: (err: any, variables, context) => {
      if (context?.previousSuppliers) {
        queryClient.setQueryData(queryKeys.suppliers.all, context.previousSuppliers);
      }
      setError(err.response?.data?.detail || 'Failed to delete supplier');
      showToast(err.response?.data?.detail || 'Failed to delete supplier', 'error');
    },
  });

  // Handle URL params for direct navigation to profile
  useEffect(() => {
    console.log('[Suppliers] useEffect triggered:', { 
      viewModeParam: params.viewMode, 
      idParam: params.id,
      currentViewMode: viewMode,
      selectedSupplierId: selectedSupplier?.id 
    });
    
    // Only process if we have profile params
    if (params.viewMode !== 'profile' || !params.id) {
      console.log('[Suppliers] No profile params, skipping');
      return;
    }
    
    // Handle restricted users - trigger golden glow
    if (!canViewProfile) {
      console.log('[Suppliers] User cannot view profile, triggering glow');
      triggerGoldenGlow();
      router.setParams({ viewMode: undefined, id: undefined });
      return;
    }
    
    // Avoid re-triggering if already showing this exact profile
    if (viewMode === 'profile' && selectedSupplier?.id === params.id) {
      console.log('[Suppliers] Already showing this profile, skipping');
      return;
    }
    
    console.log('[Suppliers] Loading profile for ID:', params.id);
    
    // Set loading state immediately
    setIsProfileLoading(true);
    
    // Async function to fetch and display profile
    const loadProfile = async () => {
      try {
        console.log('[Suppliers] Fetching supplier data...');
        // Always fetch from API to ensure fresh data
        const res = await supplierApi.getById(params.id as string);
        
        console.log('[Suppliers] API Response:', res.data);
        
        if (res.data) {
          // CRITICAL: Set data FIRST, then switch view mode
          setSelectedSupplier(res.data);
          setSelectedGalleryImage(0);
          setViewMode('profile');
          setIsProfileLoading(false);
          console.log('[Suppliers] Profile loaded successfully');
        } else {
          throw new Error('No data returned');
        }
      } catch (err) {
        console.error('[Suppliers] Error fetching supplier:', err);
        setError(isRTL ? 'فشل في تحميل بيانات الشركة' : 'Failed to load company data');
        setIsProfileLoading(false);
        router.setParams({ viewMode: undefined, id: undefined });
      }
    };
    
    loadProfile();
  }, [params.viewMode, params.id, canViewProfile]);

  const handleDeleteSupplier = useCallback((supplierId: string) => {
    deleteMutation.mutate(supplierId);
  }, [deleteMutation]);

  const openProfileMode = useCallback((supplier: Supplier) => {
    console.log('[Suppliers] openProfileMode called with supplier:', supplier.id, supplier.name);
    setSelectedSupplier(supplier);
    setSelectedGalleryImage(0);
    setViewMode('profile');
    console.log('[Suppliers] State updated - viewMode set to profile');
    // Sync URL with UI state
    router.setParams({ viewMode: 'profile', id: supplier.id });
  }, [router]);

  const onRefresh = useCallback(() => {
    refetch();
  }, [refetch]);

  // Get all images for gallery
  const getSupplierImages = (supplier: Supplier): string[] => {
    const images: string[] = [];
    if (supplier.profile_image) images.push(supplier.profile_image);
    if (supplier.slider_images?.length) images.push(...supplier.slider_images);
    if (supplier.images?.length) images.push(...supplier.images.filter(img => img !== supplier.profile_image));
    return [...new Set(images)]; // Remove duplicates
  };

  // List Header Component
  const ListHeaderComponent = useCallback(() => (
    <View>
      <View style={[styles.listHeader, { paddingTop: insets.top }]}>
        <View style={[styles.headerRow, isRTL && styles.headerRTL]}>
          <TouchableOpacity 
            style={[styles.backButton, { backgroundColor: colors.surface }]} 
            onPress={() => router.back()}
          >
            <Ionicons name={isRTL ? 'arrow-forward' : 'arrow-back'} size={24} color={colors.text} />
          </TouchableOpacity>
          <Text style={[styles.headerTitle, { color: colors.text }]}>
            {isRTL ? 'شركات التوصيل والولائم' : 'Delivery & Feast Companies'}
          </Text>
          {canAddOrEdit && (
            <TouchableOpacity 
              style={[styles.addButton, { backgroundColor: colors.primary }]} 
              onPress={() => router.push('/owner/add-entity-form?entityType=supplier')}
            >
              <Ionicons name="add" size={24} color="#FFF" />
            </TouchableOpacity>
          )}
        </View>

        {/* Search Bar */}
        <View style={[styles.searchContainer, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Ionicons name="search" size={20} color={colors.textSecondary} />
          <TextInput
            style={[styles.searchInput, { color: colors.text }, isRTL && styles.textRTL]}
            value={searchQuery}
            onChangeText={setSearchQuery}
            placeholder={isRTL ? 'ابحث عن شركة توصيل أو وليمة...' : 'Search delivery & feast companies...'}
            placeholderTextColor={colors.textSecondary}
          />
          {searchQuery.length > 0 && (
            <TouchableOpacity onPress={() => setSearchQuery('')}>
              <Ionicons name="close-circle" size={20} color={colors.textSecondary} />
            </TouchableOpacity>
          )}
        </View>

        {/* Filter chips – Restaurants */}
        {availableRestaurantFilters.length > 0 && (
          <View style={styles.filterSection}>
            <Text style={[styles.filterLabel, { color: colors.textSecondary }]}>
              {isRTL ? 'المطعم:' : 'Restaurant:'}
            </Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterChipsRow}>
              {availableRestaurantFilters.map((r: any) => {
                const active = activeRestaurantFilter === r.id;
                return (
                  <TouchableOpacity
                    key={r.id}
                    style={[
                      styles.filterChip,
                      active
                        ? { backgroundColor: colors.primary, borderColor: colors.primary }
                        : { backgroundColor: colors.surface, borderColor: colors.border },
                    ]}
                    onPress={() => setActiveRestaurantFilter(active ? null : r.id)}
                    activeOpacity={0.75}
                  >
                    <Ionicons name="restaurant" size={13} color={active ? '#FFF' : colors.textSecondary} />
                    <Text style={[styles.filterChipText, { color: active ? '#FFF' : colors.text }]}>
                      {isRTL && r.name_ar ? r.name_ar : r.name}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>
        )}

        {/* Filter chips – Categories */}
        {availableCategoryFilters.length > 0 && (
          <View style={styles.filterSection}>
            <Text style={[styles.filterLabel, { color: colors.textSecondary }]}>
              {isRTL ? 'الفئة:' : 'Category:'}
            </Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterChipsRow}>
              {availableCategoryFilters.map((c: any) => {
                const active = activeCategoryFilter === c.id;
                return (
                  <TouchableOpacity
                    key={c.id}
                    style={[
                      styles.filterChip,
                      active
                        ? { backgroundColor: colors.primary, borderColor: colors.primary }
                        : { backgroundColor: colors.surface, borderColor: colors.border },
                    ]}
                    onPress={() => setActiveCategoryFilter(active ? null : c.id)}
                    activeOpacity={0.75}
                  >
                    <Ionicons name="grid" size={13} color={active ? '#FFF' : colors.textSecondary} />
                    <Text style={[styles.filterChipText, { color: active ? '#FFF' : colors.text }]}>
                      {isRTL && c.name_ar ? c.name_ar : c.name}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>
        )}

        {/* Stats */}
        <View style={[styles.statsCard, { backgroundColor: colors.primary }]}>
          <Text style={styles.statsValue}>{filteredSuppliers.length}</Text>
          <Text style={styles.statsLabel}>
            {isRTL ? 'إجمالي شركات التوصيل والولائم' : 'Total Delivery & Feast Companies'}
          </Text>
        </View>

        {/* Subscribe Banner for restricted users */}
        {!canViewProfile && (
          <TouchableOpacity 
            style={styles.subscribeBannerWrapper}
            onPress={() => router.push('/subscription-request')}
          >
            <LinearGradient
              colors={['#1a1a2e', '#2d2d44']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={styles.subscribeBanner}
            >
              <Ionicons name="star" size={18} color={GOLD_COLOR} />
              <Animated.Text style={[styles.subscribeBannerText, glowTextStyle]}>
                {isRTL ? 'اشترك للتواصل مع شركات التوصيل والولائم' : 'Subscribe to contact delivery & feast companies'}
              </Animated.Text>
              <Ionicons name="star" size={18} color={GOLD_COLOR} />
            </LinearGradient>
          </TouchableOpacity>
        )}
      </View>
    </View>
  ), [insets.top, isRTL, colors, isOwnerOrAdmin, searchQuery, filteredSuppliers.length, router, canViewProfile, glowTextStyle, availableRestaurantFilters, availableCategoryFilters, activeRestaurantFilter, activeCategoryFilter]);

  // Empty component
  const ListEmptyComponent = useCallback(() => (
    <View style={styles.emptyContainer}>
      {isLoading ? (
        <ActivityIndicator size="large" color={colors.primary} />
      ) : (
        <>
          <Ionicons name="business-outline" size={64} color={colors.textSecondary} />
          <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
            {searchQuery 
              ? (isRTL ? 'لا توجد نتائج' : 'No results found')
              : (isRTL ? 'لا توجد شركات توصيل أو ولائم' : 'No delivery & feast companies found')
            }
          </Text>
        </>
      )}
    </View>
  ), [isLoading, colors, searchQuery, isRTL]);

  // Render item
  const renderItem = useCallback(({ item }: { item: Supplier }) => (
    <SupplierListItem
      supplier={item}
      colors={colors}
      isRTL={isRTL}
      language={language}
      isOwnerOrAdmin={userRole === 'owner'}
      canViewProfile={canViewProfile}
      onPress={openProfileMode}
      onDelete={handleDeleteSupplier}
      onRestrictedPress={triggerGoldenGlow}
    />
  ), [colors, isRTL, language, userRole, canViewProfile, openProfileMode, handleDeleteSupplier, triggerGoldenGlow]);

  const keyExtractor = useCallback((item: Supplier) => item.id, []);

  // ============================================================================
  // Profile Loading State
  // ============================================================================
  if (isProfileLoading) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={[styles.loadingContainer, { paddingTop: insets.top + 60 }]}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={[styles.loadingText, { color: colors.textSecondary }]}>
            {isRTL ? 'جاري تحميل بيانات الشركة...' : 'Loading company profile...'}
          </Text>
        </View>
      </View>
    );
  }

  // ============================================================================
  // Profile View with Modern UI
  // ============================================================================
  if (viewMode === 'profile' && selectedSupplier) {
    const linkedRestaurants = carModels.filter((r: any) =>
      (selectedSupplier.linked_restaurant_ids || []).includes(r.id)
    );
    const linkedCategoryObjects = categories.filter((c: any) =>
      (selectedSupplier.linked_category_ids || []).includes(c.id)
    );
    const displayName = isRTL && selectedSupplier.name_ar ? selectedSupplier.name_ar : selectedSupplier.name;
    const displayAddress = isRTL && selectedSupplier.address_ar ? selectedSupplier.address_ar : selectedSupplier.address;
    const displayDescription = isRTL && selectedSupplier.description_ar ? selectedSupplier.description_ar : selectedSupplier.description;
    const galleryImages = getSupplierImages(selectedSupplier);

    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <ScrollView style={styles.scrollView} contentContainerStyle={[styles.scrollContent, { paddingTop: insets.top }]}>
          {/* Header */}
          <View style={[styles.profileHeader, isRTL && styles.headerRTL]}>
            <TouchableOpacity 
              style={[styles.profileBackButton, { backgroundColor: colors.surface }]} 
              onPress={() => { setViewMode('list'); setSelectedSupplier(null); router.setParams({ viewMode: undefined, id: undefined }); }}
            >
              <Ionicons name={isRTL ? 'arrow-forward' : 'arrow-back'} size={24} color={colors.text} />
            </TouchableOpacity>
            <Text style={[styles.profileHeaderTitle, { color: colors.text }]}>{displayName}</Text>
            {canAddOrEdit && (
              <TouchableOpacity 
                style={[styles.profileEditButton, { backgroundColor: colors.primary }]} 
                onPress={() => router.push(`/owner/add-entity-form?entityType=supplier&id=${selectedSupplier.id}`)}
              >
                <Ionicons name="pencil" size={20} color="#FFF" />
              </TouchableOpacity>
            )}
          </View>

          {/* Profile Image - Large Hero */}
          <View style={styles.heroImageContainer}>
            {galleryImages.length > 0 ? (
              <Image 
                source={{ uri: galleryImages[selectedGalleryImage] }} 
                style={styles.heroImage}
                contentFit="cover"
                transition={200}
              />
            ) : (
              <View style={[styles.heroImagePlaceholder, { backgroundColor: colors.surface }]}>
                <Ionicons name="storefront" size={80} color={colors.textSecondary} />
              </View>
            )}
            {/* Image Counter */}
            {galleryImages.length > 1 && (
              <View style={styles.imageCounter}>
                <Text style={styles.imageCounterText}>
                  {selectedGalleryImage + 1}/{galleryImages.length}
                </Text>
              </View>
            )}
          </View>

          {/* Image Gallery Thumbnails */}
          {galleryImages.length > 1 && (
            <ScrollView 
              horizontal 
              showsHorizontalScrollIndicator={false} 
              style={styles.galleryContainer}
              contentContainerStyle={styles.galleryContent}
            >
              {galleryImages.map((img, index) => (
                <TouchableOpacity
                  key={index}
                  style={[
                    styles.galleryThumbnail,
                    { borderColor: selectedGalleryImage === index ? LUMINOUS_BLUE : 'transparent' }
                  ]}
                  onPress={() => setSelectedGalleryImage(index)}
                >
                  <Image source={{ uri: img }} style={styles.thumbnailImage} contentFit="cover" />
                </TouchableOpacity>
              ))}
            </ScrollView>
          )}

          {/* Interactive Contact Fields - Luminous Blue */}
          <View style={styles.contactSection}>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>
              {isRTL ? 'معلومات التواصل' : 'Contact Information'}
            </Text>
            
            {/* Render all phone numbers from the array */}
            {(selectedSupplier.phone_numbers && selectedSupplier.phone_numbers.length > 0 ? 
              selectedSupplier.phone_numbers : 
              (selectedSupplier.phone ? [selectedSupplier.phone] : [])
            ).map((phone, index) => (
              <TouchableOpacity
                key={`phone-${index}`}
                style={[styles.contactCard, { backgroundColor: colors.card, borderColor: colors.border }]}
                onPress={() => Linking.openURL(`tel:${phone}`)}
                activeOpacity={0.7}
              >
                <View style={[styles.contactIconContainer, { backgroundColor: LUMINOUS_BLUE + '20' }]}>
                  <Ionicons name="call" size={22} color={LUMINOUS_BLUE} />
                </View>
                <View style={styles.contactTextContainer}>
                  <Text style={[styles.contactLabel, { color: colors.textSecondary }]}>
                    {isRTL ? `الهاتف ${selectedSupplier.phone_numbers && selectedSupplier.phone_numbers.length > 1 ? index + 1 : ''}` : `Phone ${selectedSupplier.phone_numbers && selectedSupplier.phone_numbers.length > 1 ? index + 1 : ''}`}
                  </Text>
                  <Text style={[styles.contactValue, { color: LUMINOUS_BLUE }]}>
                    {phone}
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={20} color={LUMINOUS_BLUE} />
              </TouchableOpacity>
            ))}

            {selectedSupplier.contact_email && (
              <TouchableOpacity
                style={[styles.contactCard, { backgroundColor: colors.card, borderColor: colors.border }]}
                onPress={() => Linking.openURL(`mailto:${selectedSupplier.contact_email}`)}
                activeOpacity={0.7}
              >
                <View style={[styles.contactIconContainer, { backgroundColor: LUMINOUS_BLUE + '20' }]}>
                  <Ionicons name="mail" size={22} color={LUMINOUS_BLUE} />
                </View>
                <View style={styles.contactTextContainer}>
                  <Text style={[styles.contactLabel, { color: colors.textSecondary }]}>
                    {isRTL ? 'البريد الإلكتروني' : 'Email'}
                  </Text>
                  <Text style={[styles.contactValue, { color: LUMINOUS_BLUE }]}>
                    {selectedSupplier.contact_email}
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={20} color={LUMINOUS_BLUE} />
              </TouchableOpacity>
            )}

            {/* Handle both website_url (backend) and website (legacy) */}
            {(selectedSupplier.website_url || selectedSupplier.website) && (
              <TouchableOpacity
                style={[styles.contactCard, { backgroundColor: colors.card, borderColor: colors.border }]}
                onPress={() => {
                  const url = selectedSupplier.website_url || selectedSupplier.website || '';
                  Linking.openURL(url.startsWith('http') ? url : `https://${url}`);
                }}
                activeOpacity={0.7}
              >
                <View style={[styles.contactIconContainer, { backgroundColor: LUMINOUS_BLUE + '20' }]}>
                  <Ionicons name="globe" size={22} color={LUMINOUS_BLUE} />
                </View>
                <View style={styles.contactTextContainer}>
                  <Text style={[styles.contactLabel, { color: colors.textSecondary }]}>
                    {isRTL ? 'الموقع الإلكتروني' : 'Website'}
                  </Text>
                  <Text style={[styles.contactValue, { color: LUMINOUS_BLUE }]} numberOfLines={1}>
                    {selectedSupplier.website_url || selectedSupplier.website}
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={20} color={LUMINOUS_BLUE} />
              </TouchableOpacity>
            )}

            {displayAddress && (
              <View style={[styles.contactCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <View style={[styles.contactIconContainer, { backgroundColor: colors.primary + '20' }]}>
                  <Ionicons name="location" size={22} color={colors.primary} />
                </View>
                <View style={styles.contactTextContainer}>
                  <Text style={[styles.contactLabel, { color: colors.textSecondary }]}>
                    {isRTL ? 'العنوان' : 'Address'}
                  </Text>
                  <Text style={[styles.contactValue, { color: colors.text }]}>
                    {displayAddress}
                  </Text>
                </View>
              </View>
            )}
          </View>


          {/* Description */}
          {displayDescription && (
            <View style={[styles.descriptionSection, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Text style={[styles.sectionTitle, { color: colors.text }]}>
                {isRTL ? 'نبذة عن الشركة' : 'About'}
              </Text>
              <Text style={[styles.descriptionText, { color: colors.textSecondary }]}>
                {displayDescription}
              </Text>
            </View>
          )}

          {/* Linked Restaurants */}
          {linkedRestaurants.length > 0 && (
            <View style={{ paddingHorizontal: 16, marginTop: 24 }}>
              <Text style={[styles.sectionTitle, { color: colors.text }]}>
                {isRTL ? 'المطاعم المرتبطة' : 'Linked Restaurants'}
              </Text>
              <View style={styles.chipsRow}>
                {linkedRestaurants.map((r: any) => (
                  <View key={r.id} style={[styles.chip, { backgroundColor: colors.primary + '20' }]}>
                    <Ionicons name="restaurant" size={14} color={colors.primary} />
                    <Text style={[styles.chipText, { color: colors.primary }]}>
                      {isRTL && r.name_ar ? r.name_ar : r.name}
                    </Text>
                  </View>
                ))}
              </View>
            </View>
          )}

          {/* Linked Categories */}
          {linkedCategoryObjects.length > 0 && (
            <View style={{ paddingHorizontal: 16, marginTop: 20 }}>
              <Text style={[styles.sectionTitle, { color: colors.text }]}>
                {isRTL ? 'الفئات المرتبطة' : 'Linked Categories'}
              </Text>
              <View style={styles.chipsRow}>
                {linkedCategoryObjects.map((c: any) => (
                  <View key={c.id} style={[styles.chip, { backgroundColor: colors.primary + '15' }]}>
                    <Ionicons name="grid" size={14} color={colors.primary} />
                    <Text style={[styles.chipText, { color: colors.primary }]}>
                      {isRTL && c.name_ar ? c.name_ar : c.name}
                    </Text>
                  </View>
                ))}
              </View>
            </View>
          )}

          {/* Bottom Padding */}
          <View style={{ height: 40 }} />
        </ScrollView>

        <Toast
          visible={toastVisible}
          message={toastMessage}
          type={toastType}
          onDismiss={() => setToastVisible(false)}
        />
      </View>
    );
  }

  // Main List View
  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <FlashList
        data={filteredSuppliers}
        renderItem={renderItem}
        keyExtractor={keyExtractor}
        estimatedItemSize={90}
        ListHeaderComponent={ListHeaderComponent}
        ListEmptyComponent={ListEmptyComponent}
        contentContainerStyle={styles.listContentContainer}
        refreshControl={
          <RefreshControl
            refreshing={isRefetching}
            onRefresh={onRefresh}
            colors={[colors.primary]}
            tintColor={colors.primary}
          />
        }
        extraData={[colors, searchQuery, isGlowing, activeRestaurantFilter, activeCategoryFilter]}
      />

      {error && (
        <ErrorCapsule
          message={error}
          onDismiss={() => setError(null)}
          onRetry={refetch}
        />
      )}

      {showConfetti && (
        <ConfettiEffect active={showConfetti} onComplete={() => setShowConfetti(false)} />
      )}

      <Toast
        visible={toastVisible}
        message={toastMessage}
        type={toastType}
        onDismiss={() => setToastVisible(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scrollView: { flex: 1 },
  scrollContent: { paddingBottom: 100 },
  listContentContainer: { paddingHorizontal: 16, paddingBottom: 100 },
  listHeader: { marginBottom: 16 },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 },
  headerRTL: { flexDirection: 'row-reverse' },
  backButton: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 24, fontWeight: '700' },
  addButton: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  // Loading styles
  loadingContainer: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  loadingText: { marginTop: 16, fontSize: 16, fontWeight: '500' },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginBottom: 16,
    gap: 10,
  },
  searchInput: { flex: 1, fontSize: 15, paddingVertical: 0 },
  textRTL: { textAlign: 'right' },
  statsCard: { borderRadius: 16, padding: 20, alignItems: 'center', marginBottom: 16 },
  statsValue: { fontSize: 32, fontWeight: '700', color: '#FFF' },
  statsLabel: { fontSize: 14, color: 'rgba(255,255,255,0.8)', marginTop: 4 },
  subscribeBannerWrapper: { marginBottom: 16, borderRadius: 12, overflow: 'hidden' },
  subscribeBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    paddingHorizontal: 16,
    gap: 10,
  },
  subscribeBannerText: { fontSize: 14, fontWeight: '700', textAlign: 'center' },
  supplierCard: { borderRadius: 12, borderWidth: 1, marginBottom: 12, overflow: 'hidden' },
  supplierCardContent: { flexDirection: 'row', alignItems: 'center', padding: 16 },
  cardRTL: { flexDirection: 'row-reverse' },
  supplierImage: { width: 56, height: 56, borderRadius: 28 },
  supplierImagePlaceholder: { width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center' },
  supplierInfo: { flex: 1, marginLeft: 12 },
  infoRTL: { marginLeft: 0, marginRight: 12, alignItems: 'flex-end' },
  supplierName: { fontSize: 16, fontWeight: '600' },
  supplierMeta: { flexDirection: 'row', alignItems: 'center', marginTop: 4, gap: 4 },
  metaRTL: { flexDirection: 'row-reverse' },
  supplierMetaText: { fontSize: 13 },
  emptyContainer: { alignItems: 'center', padding: 60 },
  emptyText: { fontSize: 16, marginTop: 16 },
  // Profile styles
  profileHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, marginBottom: 16 },
  profileBackButton: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  profileHeaderTitle: { fontSize: 20, fontWeight: '700', flex: 1, textAlign: 'center' },
  profileEditButton: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  // Hero Image
  heroImageContainer: { width: '100%', height: 240, position: 'relative' },
  heroImage: { width: '100%', height: '100%' },
  heroImagePlaceholder: { width: '100%', height: '100%', alignItems: 'center', justifyContent: 'center' },
  imageCounter: { 
    position: 'absolute', 
    bottom: 12, 
    right: 12, 
    backgroundColor: 'rgba(0,0,0,0.6)', 
    paddingHorizontal: 10, 
    paddingVertical: 4, 
    borderRadius: 12 
  },
  imageCounterText: { color: '#FFF', fontSize: 12, fontWeight: '600' },
  // Gallery
  galleryContainer: { marginTop: 12, paddingHorizontal: 16 },
  galleryContent: { gap: 10 },
  galleryThumbnail: { width: 70, height: 70, borderRadius: 10, borderWidth: 2, overflow: 'hidden' },
  thumbnailImage: { width: '100%', height: '100%' },
  // Contact Section
  contactSection: { paddingHorizontal: 16, marginTop: 24 },
  sectionTitle: { fontSize: 18, fontWeight: '700', marginBottom: 16 },
  contactCard: { 
    flexDirection: 'row', 
    alignItems: 'center', 
    padding: 14, 
    borderRadius: 14, 
    borderWidth: 1, 
    marginBottom: 12,
    gap: 12,
  },
  contactIconContainer: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  contactTextContainer: { flex: 1 },
  contactLabel: { fontSize: 12, fontWeight: '500', marginBottom: 2 },
  contactValue: { fontSize: 15, fontWeight: '600' },
  // Venue Details
  venueDetailsCard: { marginHorizontal: 16, marginTop: 24, padding: 16, borderRadius: 14, borderWidth: 1 },
  venueDetailRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, marginBottom: 14 },
  venueDetailIcon: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  venueDetailLabel: { fontSize: 11, fontWeight: '500', marginBottom: 2 },
  venueDetailValue: { fontSize: 14, fontWeight: '600' },
  // Description
  descriptionSection: { marginHorizontal: 16, marginTop: 24, padding: 16, borderRadius: 14, borderWidth: 1 },
  descriptionText: { fontSize: 14, lineHeight: 22 },
  // Chips
  chipsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 10 },
  chip: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, gap: 6 },
  chipText: { fontSize: 14, fontWeight: '600' },
  // Filter chips
  filterSection: { marginBottom: 10 },
  filterLabel: { fontSize: 12, fontWeight: '600', marginBottom: 6, paddingHorizontal: 2 },
  filterChipsRow: { gap: 8, paddingRight: 4 },
  filterChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 20,
    borderWidth: 1,
    gap: 5,
  },
  filterChipText: { fontSize: 13, fontWeight: '600' },
});
