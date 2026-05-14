/**
 * Distributors Management - Professional UI/UX with RBAC
 * Features:
 * - Role-Based Access Control (owner, admin, partner, subscriber can view)
 * - Golden Glow Animation for customer restrictions
 * - Luminous Blue contact fields
 * - Image Gallery with horizontal scroll
 * - AnimatedBrandCard for linked brands
 * - Performance rating display
 * - Regions chips
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
import { distributorApi } from '../../src/services/api';
import { VoidDeleteGesture } from '../../src/components/ui/VoidDeleteGesture';
import { ErrorCapsule } from '../../src/components/ui/ErrorCapsule';
import { ConfettiEffect } from '../../src/components/ui/ConfettiEffect';
import { Toast } from '../../src/components/ui/FormFeedback';
import { queryKeys } from '../../src/lib/queryClient';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const LUMINOUS_BLUE = '#00D4FF';
const GOLD_COLOR = '#FFD700';

type ViewMode = 'list' | 'profile';

interface Distributor {
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
  // Distributors link to car brands, not product brands
  linked_car_brand_ids?: string[];
  linked_product_brand_ids?: string[];
  linked_category_ids?: string[];
  venue_types?: string[];
  regions?: string[];
  performance_rating?: number;
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

// Memoized Distributor List Item with RBAC
const DistributorListItem = React.memo(({
  distributor,
  colors,
  isRTL,
  language,
  isOwnerOrAdmin,
  canViewProfile,
  onPress,
  onDelete,
  onRestrictedPress,
}: {
  distributor: Distributor;
  colors: any;
  isRTL: boolean;
  language: string;
  isOwnerOrAdmin: boolean;
  canViewProfile: boolean;
  onPress: (distributor: Distributor) => void;
  onDelete: (id: string) => void;
  onRestrictedPress: () => void;
}) => {
  const displayName = isRTL && distributor.name_ar ? distributor.name_ar : distributor.name;
  // Get first phone number from array or fallback to legacy phone field
  const displayPhone = distributor.phone_numbers?.[0] || distributor.phone;
  
  const handlePress = () => {
    if (canViewProfile) {
      onPress(distributor);
    } else {
      onRestrictedPress();
    }
  };
  
  return (
    <VoidDeleteGesture onDelete={() => onDelete(distributor.id)} enabled={isOwnerOrAdmin}>
      <TouchableOpacity
        style={[styles.distributorCard, { backgroundColor: colors.card, borderColor: colors.border }]}
        onPress={handlePress}
        activeOpacity={0.7}
      >
        <View style={[styles.distributorCardContent, isRTL && styles.cardRTL]}>
          {distributor.profile_image ? (
            <Image source={{ uri: distributor.profile_image }} style={styles.distributorImage} contentFit="cover" />
          ) : (
            <View style={[styles.distributorImagePlaceholder, { backgroundColor: colors.primary + '20' }]}>
              <Ionicons name="bicycle" size={28} color={colors.primary} />
            </View>
          )}
          <View style={[styles.distributorInfo, isRTL && styles.infoRTL]}>
            <Text style={[styles.distributorName, { color: colors.text }]} numberOfLines={1}>
              {displayName}
            </Text>
            {displayPhone && (
              <View style={[styles.distributorMeta, isRTL && styles.metaRTL]}>
                <Ionicons name="call" size={14} color={colors.textSecondary} />
                <Text style={[styles.distributorMetaText, { color: colors.textSecondary }]}>
                  {displayPhone}
                </Text>
              </View>
            )}
            {distributor.regions && distributor.regions.length > 0 && (
              <View style={[styles.distributorMeta, isRTL && styles.metaRTL]}>
                <Ionicons name="map" size={14} color={colors.textSecondary} />
                <Text style={[styles.distributorMetaText, { color: colors.textSecondary }]} numberOfLines={1}>
                  {distributor.regions.slice(0, 2).join(', ')}
                  {distributor.regions.length > 2 && ` +${distributor.regions.length - 2}`}
                </Text>
              </View>
            )}
            {distributor.performance_rating !== undefined && (
              <View style={[styles.ratingBadge, { backgroundColor: colors.warning + '20' }]}>
                <Ionicons name="star" size={12} color={colors.warning} />
                <Text style={[styles.ratingText, { color: colors.warning }]}>
                  {distributor.performance_rating.toFixed(1)}
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

export default function DistributorsScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ viewMode?: string; id?: string }>();
  const insets = useSafeAreaInsets();
  const { colors, isDark } = useTheme();
  const queryClient = useQueryClient();
  const language = useAppStore((state) => state.language);
  const carBrands = useAppStore((state) => state.carBrands);
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
  const [selectedDistributor, setSelectedDistributor] = useState<Distributor | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedGalleryImage, setSelectedGalleryImage] = useState(0);
  const [isProfileLoading, setIsProfileLoading] = useState(false);
  const [activeVenueTypeFilter, setActiveVenueTypeFilter] = useState<string | null>(null);
  const [activeCategoryFilter, setActiveCategoryFilter] = useState<string | null>(null);

  // Golden Glow Animation State
  const [isGlowing, setIsGlowing] = useState(false);
  const glowProgress = useSharedValue(0);

  // Toast state
  const [toastVisible, setToastVisible] = useState(false);
  const [toastMessage, setToastMessage] = useState('');
  const [toastType, setToastType] = useState<'success' | 'error' | 'warning' | 'info'>('success');

  // TanStack Query: Fetch Distributors
  const {
    data: distributorsData,
    isLoading,
    isRefetching,
    refetch,
  } = useQuery({
    queryKey: queryKeys.distributors.all,
    queryFn: async () => {
      const res = await distributorApi.getAll();
      return res.data || [];
    },
    staleTime: 2 * 60 * 1000,
  });

  const distributors: Distributor[] = distributorsData || [];

  // Derive available filter options from the fetched data
  const availableVenueTypeFilters = useMemo(() => {
    const types = new Set<string>();
    distributors.forEach((d) => (d.venue_types || []).forEach((t) => types.add(t)));
    return Array.from(types).sort();
  }, [distributors]);

  const availableCategoryFilters = useMemo(() => {
    const ids = new Set<string>();
    distributors.forEach((d) => (d.linked_category_ids || []).forEach((id) => ids.add(id)));
    return categories.filter((c: any) => ids.has(c.id));
  }, [distributors, categories]);

  // Filter distributors based on search + active chips
  const filteredDistributors = useMemo(() => {
    let result = distributors;
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      result = result.filter((d) => {
        const name = (d.name || '').toLowerCase();
        const nameAr = (d.name_ar || '').toLowerCase();
        const phone = (d.phone || '').toLowerCase();
        const regions = (d.regions || []).join(' ').toLowerCase();
        return name.includes(query) || nameAr.includes(query) || phone.includes(query) || regions.includes(query);
      });
    }
    if (activeVenueTypeFilter) {
      result = result.filter((d) => (d.venue_types || []).includes(activeVenueTypeFilter));
    }
    if (activeCategoryFilter) {
      result = result.filter((d) => (d.linked_category_ids || []).includes(activeCategoryFilter));
    }
    return result;
  }, [distributors, searchQuery, activeVenueTypeFilter, activeCategoryFilter]);

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
      await distributorApi.delete(id);
      return id;
    },
    onMutate: async (deletedId) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.distributors.all });
      const previousDistributors = queryClient.getQueryData(queryKeys.distributors.all);
      queryClient.setQueryData(queryKeys.distributors.all, (old: Distributor[] | undefined) =>
        old ? old.filter(d => d.id !== deletedId) : []
      );
      return { previousDistributors };
    },
    onSuccess: () => {
      showToast(isRTL ? 'تم حذف الشركة بنجاح' : 'Company deleted successfully', 'success');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    },
    onError: (err: any, variables, context) => {
      if (context?.previousDistributors) {
        queryClient.setQueryData(queryKeys.distributors.all, context.previousDistributors);
      }
      setError(err.response?.data?.detail || 'Failed to delete distributor');
      showToast(err.response?.data?.detail || 'Failed to delete distributor', 'error');
    },
  });

  // Handle URL params for direct navigation to profile
  useEffect(() => {
    console.log('[Distributors] useEffect triggered:', { 
      viewModeParam: params.viewMode, 
      idParam: params.id,
      currentViewMode: viewMode,
      selectedDistributorId: selectedDistributor?.id 
    });
    
    // Only process if we have profile params
    if (params.viewMode !== 'profile' || !params.id) {
      console.log('[Distributors] No profile params, skipping');
      return;
    }
    
    // Handle restricted users - trigger golden glow
    if (!canViewProfile) {
      console.log('[Distributors] User cannot view profile, triggering glow');
      triggerGoldenGlow();
      router.setParams({ viewMode: undefined, id: undefined });
      return;
    }
    
    // Avoid re-triggering if already showing this exact profile
    if (viewMode === 'profile' && selectedDistributor?.id === params.id) {
      console.log('[Distributors] Already showing this profile, skipping');
      return;
    }
    
    console.log('[Distributors] Loading profile for ID:', params.id);
    
    // Set loading state immediately
    setIsProfileLoading(true);
    
    // Async function to fetch and display profile
    const loadProfile = async () => {
      try {
        console.log('[Distributors] Fetching distributor data...');
        // Always fetch from API to ensure fresh data
        const res = await distributorApi.getById(params.id as string);
        
        console.log('[Distributors] API Response:', res.data);
        
        if (res.data) {
          // CRITICAL: Set data FIRST, then switch view mode
          setSelectedDistributor(res.data);
          setSelectedGalleryImage(0);
          setViewMode('profile');
          setIsProfileLoading(false);
          console.log('[Distributors] Profile loaded successfully');
        } else {
          throw new Error('No data returned');
        }
      } catch (err) {
        console.error('[Distributors] Error fetching distributor:', err);
        setError(isRTL ? 'فشل في تحميل بيانات الشركة' : 'Failed to load company data');
        setIsProfileLoading(false);
        router.setParams({ viewMode: undefined, id: undefined });
      }
    };
    
    loadProfile();
  }, [params.viewMode, params.id, canViewProfile]);

  const handleDeleteDistributor = useCallback((distributorId: string) => {
    deleteMutation.mutate(distributorId);
  }, [deleteMutation]);

  const openProfileMode = useCallback((distributor: Distributor) => {
    console.log('[Distributors] openProfileMode called with distributor:', distributor.id, distributor.name);
    setSelectedDistributor(distributor);
    setSelectedGalleryImage(0);
    setViewMode('profile');
    console.log('[Distributors] State updated - viewMode set to profile');
    // Sync URL with UI state
    router.setParams({ viewMode: 'profile', id: distributor.id });
  }, [router]);

  const onRefresh = useCallback(() => {
    refetch();
  }, [refetch]);

  // Get all images for gallery
  const getDistributorImages = (distributor: Distributor): string[] => {
    const images: string[] = [];
    if (distributor.profile_image) images.push(distributor.profile_image);
    if (distributor.slider_images?.length) images.push(...distributor.slider_images);
    if (distributor.images?.length) images.push(...distributor.images.filter(img => img !== distributor.profile_image));
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
            {isRTL ? 'شركات الفنادق والأماكن' : 'Hotel & Venue Companies'}
          </Text>
          {canAddOrEdit && (
            <TouchableOpacity 
              style={[styles.addButton, { backgroundColor: colors.primary }]} 
              onPress={() => router.push('/owner/add-entity-form?entityType=distributor')}
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
            placeholder={isRTL ? 'ابحث عن شركة فنادق أو أماكن...' : 'Search hotel & venue companies...'}
            placeholderTextColor={colors.textSecondary}
          />
          {searchQuery.length > 0 && (
            <TouchableOpacity onPress={() => setSearchQuery('')}>
              <Ionicons name="close-circle" size={20} color={colors.textSecondary} />
            </TouchableOpacity>
          )}
        </View>

        {/* Filter chips – Venue Types */}
        {availableVenueTypeFilters.length > 0 && (
          <View style={styles.filterSection}>
            <Text style={[styles.filterLabel, { color: colors.textSecondary }]}>
              {isRTL ? 'نوع المكان:' : 'Venue type:'}
            </Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterChipsRow}>
              {availableVenueTypeFilters.map((vt) => {
                const active = activeVenueTypeFilter === vt;
                return (
                  <TouchableOpacity
                    key={vt}
                    style={[
                      styles.filterChip,
                      active
                        ? { backgroundColor: colors.primary, borderColor: colors.primary }
                        : { backgroundColor: colors.surface, borderColor: colors.border },
                    ]}
                    onPress={() => setActiveVenueTypeFilter(active ? null : vt)}
                    activeOpacity={0.75}
                  >
                    <Ionicons name="business" size={13} color={active ? '#FFF' : colors.textSecondary} />
                    <Text style={[styles.filterChipText, { color: active ? '#FFF' : colors.text }]}>{vt}</Text>
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
          <Text style={styles.statsValue}>{filteredDistributors.length}</Text>
          <Text style={styles.statsLabel}>
            {isRTL ? 'إجمالي شركات الفنادق والأماكن' : 'Total Hotel & Venue Companies'}
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
                {isRTL ? 'اشترك للتواصل مع شركات الفنادق والأماكن' : 'Subscribe to contact hotel & venue companies'}
              </Animated.Text>
              <Ionicons name="star" size={18} color={GOLD_COLOR} />
            </LinearGradient>
          </TouchableOpacity>
        )}
      </View>
    </View>
  ), [insets.top, isRTL, colors, isOwnerOrAdmin, searchQuery, filteredDistributors.length, router, canViewProfile, glowTextStyle, availableVenueTypeFilters, availableCategoryFilters, activeVenueTypeFilter, activeCategoryFilter]);

  // Empty component
  const ListEmptyComponent = useCallback(() => (
    <View style={styles.emptyContainer}>
      {isLoading ? (
        <ActivityIndicator size="large" color={colors.primary} />
      ) : (
        <>
          <Ionicons name="bicycle-outline" size={64} color={colors.textSecondary} />
          <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
            {searchQuery 
              ? (isRTL ? 'لا توجد نتائج' : 'No results found')
              : (isRTL ? 'لا توجد شركات فنادق أو أماكن' : 'No hotel & venue companies found')
            }
          </Text>
        </>
      )}
    </View>
  ), [isLoading, colors, searchQuery, isRTL]);

  // Render item
  const renderItem = useCallback(({ item }: { item: Distributor }) => (
    <DistributorListItem
      distributor={item}
      colors={colors}
      isRTL={isRTL}
      language={language}
      isOwnerOrAdmin={userRole === 'owner'}
      canViewProfile={canViewProfile}
      onPress={openProfileMode}
      onDelete={handleDeleteDistributor}
      onRestrictedPress={triggerGoldenGlow}
    />
  ), [colors, isRTL, language, userRole, canViewProfile, openProfileMode, handleDeleteDistributor, triggerGoldenGlow]);

  const keyExtractor = useCallback((item: Distributor) => item.id, []);

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
  if (viewMode === 'profile' && selectedDistributor) {
    const linkedCategoryObjects = categories.filter((c: any) =>
      (selectedDistributor.linked_category_ids || []).includes(c.id)
    );
    const venueTypesList: string[] = selectedDistributor.venue_types || [];
    const displayName = isRTL && selectedDistributor.name_ar ? selectedDistributor.name_ar : selectedDistributor.name;
    const displayAddress = isRTL && selectedDistributor.address_ar ? selectedDistributor.address_ar : selectedDistributor.address;
    const displayDescription = isRTL && selectedDistributor.description_ar ? selectedDistributor.description_ar : selectedDistributor.description;
    const galleryImages = getDistributorImages(selectedDistributor);

    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <ScrollView style={styles.scrollView} contentContainerStyle={[styles.scrollContent, { paddingTop: insets.top }]}>
          {/* Header */}
          <View style={[styles.profileHeader, isRTL && styles.headerRTL]}>
            <TouchableOpacity 
              style={[styles.profileBackButton, { backgroundColor: colors.surface }]} 
              onPress={() => { setViewMode('list'); setSelectedDistributor(null); router.setParams({ viewMode: undefined, id: undefined }); }}
            >
              <Ionicons name={isRTL ? 'arrow-forward' : 'arrow-back'} size={24} color={colors.text} />
            </TouchableOpacity>
            <Text style={[styles.profileHeaderTitle, { color: colors.text }]}>{displayName}</Text>
            {canAddOrEdit && (
              <TouchableOpacity 
                style={[styles.profileEditButton, { backgroundColor: colors.primary }]} 
                onPress={() => router.push(`/owner/add-entity-form?entityType=distributor&id=${selectedDistributor.id}`)}
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
                <Ionicons name="bicycle" size={80} color={colors.textSecondary} />
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

          {/* Performance Rating */}
          {selectedDistributor.performance_rating !== undefined && (
            <View style={[styles.ratingSection, { backgroundColor: colors.warning + '15' }]}>
              <Ionicons name="star" size={28} color={colors.warning} />
              <Text style={[styles.ratingSectionText, { color: colors.warning }]}>
                {selectedDistributor.performance_rating.toFixed(1)} / 5.0
              </Text>
              <Text style={[styles.ratingSectionLabel, { color: colors.textSecondary }]}>
                {isRTL ? 'تقييم الأداء' : 'Performance Rating'}
              </Text>
            </View>
          )}

          {/* Regions */}
          {selectedDistributor.regions && selectedDistributor.regions.length > 0 && (
            <View style={styles.regionsSection}>
              <Text style={[styles.sectionTitle, { color: colors.text }]}>
                {isRTL ? 'مناطق التوزيع' : 'Distribution Regions'}
              </Text>
              <View style={styles.regionChips}>
                {selectedDistributor.regions.map((region, index) => (
                  <View key={index} style={[styles.regionChip, { backgroundColor: colors.primary + '20' }]}>
                    <Ionicons name="location" size={14} color={colors.primary} />
                    <Text style={[styles.regionChipText, { color: colors.primary }]}>{region}</Text>
                  </View>
                ))}
              </View>
            </View>
          )}

          {/* Interactive Contact Fields - Luminous Blue */}
          <View style={styles.contactSection}>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>
              {isRTL ? 'معلومات التواصل' : 'Contact Information'}
            </Text>
            
            {/* Render all phone numbers from the array */}
            {(selectedDistributor.phone_numbers && selectedDistributor.phone_numbers.length > 0 ? 
              selectedDistributor.phone_numbers : 
              (selectedDistributor.phone ? [selectedDistributor.phone] : [])
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
                    {isRTL ? `الهاتف ${selectedDistributor.phone_numbers && selectedDistributor.phone_numbers.length > 1 ? index + 1 : ''}` : `Phone ${selectedDistributor.phone_numbers && selectedDistributor.phone_numbers.length > 1 ? index + 1 : ''}`}
                  </Text>
                  <Text style={[styles.contactValue, { color: LUMINOUS_BLUE }]}>
                    {phone}
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={20} color={LUMINOUS_BLUE} />
              </TouchableOpacity>
            ))}

            {selectedDistributor.contact_email && (
              <TouchableOpacity
                style={[styles.contactCard, { backgroundColor: colors.card, borderColor: colors.border }]}
                onPress={() => Linking.openURL(`mailto:${selectedDistributor.contact_email}`)}
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
                    {selectedDistributor.contact_email}
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={20} color={LUMINOUS_BLUE} />
              </TouchableOpacity>
            )}

            {/* Handle both website_url (backend) and website (legacy) */}
            {(selectedDistributor.website_url || selectedDistributor.website) && (
              <TouchableOpacity
                style={[styles.contactCard, { backgroundColor: colors.card, borderColor: colors.border }]}
                onPress={() => {
                  const url = selectedDistributor.website_url || selectedDistributor.website || '';
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
                    {selectedDistributor.website_url || selectedDistributor.website}
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

          {/* Venue Types */}
          {venueTypesList.length > 0 && (
            <View style={{ paddingHorizontal: 16, marginTop: 24 }}>
              <Text style={[styles.sectionTitle, { color: colors.text }]}>
                {isRTL ? 'أنواع الأماكن' : 'Venue Types'}
              </Text>
              <View style={styles.regionChips}>
                {venueTypesList.map((vt, index) => (
                  <View key={index} style={[styles.regionChip, { backgroundColor: colors.primary + '20' }]}>
                    <Ionicons name="business" size={14} color={colors.primary} />
                    <Text style={[styles.regionChipText, { color: colors.primary }]}>{vt}</Text>
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
              <View style={styles.regionChips}>
                {linkedCategoryObjects.map((c: any) => (
                  <View key={c.id} style={[styles.regionChip, { backgroundColor: colors.primary + '15' }]}>
                    <Ionicons name="grid" size={14} color={colors.primary} />
                    <Text style={[styles.regionChipText, { color: colors.primary }]}>
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
        data={filteredDistributors}
        renderItem={renderItem}
        keyExtractor={keyExtractor}
        estimatedItemSize={100}
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
        extraData={[colors, searchQuery, isGlowing, activeVenueTypeFilter, activeCategoryFilter]}
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
  distributorCard: { borderRadius: 12, borderWidth: 1, marginBottom: 12, overflow: 'hidden' },
  distributorCardContent: { flexDirection: 'row', alignItems: 'center', padding: 16 },
  cardRTL: { flexDirection: 'row-reverse' },
  distributorImage: { width: 56, height: 56, borderRadius: 28 },
  distributorImagePlaceholder: { width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center' },
  distributorInfo: { flex: 1, marginLeft: 12 },
  infoRTL: { marginLeft: 0, marginRight: 12, alignItems: 'flex-end' },
  distributorName: { fontSize: 16, fontWeight: '600' },
  distributorMeta: { flexDirection: 'row', alignItems: 'center', marginTop: 4, gap: 4 },
  metaRTL: { flexDirection: 'row-reverse' },
  distributorMetaText: { fontSize: 13 },
  ratingBadge: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 12, marginTop: 6, alignSelf: 'flex-start', gap: 4 },
  ratingText: { fontSize: 12, fontWeight: '600' },
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
  // Rating Section
  ratingSection: { 
    marginHorizontal: 16, 
    marginTop: 20, 
    padding: 16, 
    borderRadius: 14, 
    flexDirection: 'row', 
    alignItems: 'center', 
    justifyContent: 'center', 
    gap: 10 
  },
  ratingSectionText: { fontSize: 26, fontWeight: '800' },
  ratingSectionLabel: { fontSize: 14 },
  // Regions
  regionsSection: { paddingHorizontal: 16, marginTop: 20 },
  regionChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 10 },
  regionChip: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, gap: 6 },
  regionChipText: { fontSize: 14, fontWeight: '600' },
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
  // Description
  descriptionSection: { marginHorizontal: 16, marginTop: 24, padding: 16, borderRadius: 14, borderWidth: 1 },
  descriptionText: { fontSize: 14, lineHeight: 22 },
  // Brands
  brandsSection: { marginTop: 24, paddingHorizontal: 16 },
  brandsScroll: { marginTop: 8 },
  brandsContent: { paddingRight: 16 },
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
