/**
 * All Car Models Screen - Refactored with FlashList and React Query
 * Displays all car models with search and brand filters
 */
import React, { useState, useMemo, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  TextInput,
  ScrollView,
} from 'react-native';
import { Image } from 'expo-image';
import { FlashList } from '@shopify/flash-list';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../src/hooks/useTheme';
import { useTranslation } from '../src/hooks/useTranslation';
import { useCarBrandsAndModelsQuery, useRestaurantRatingSummaries } from '../src/hooks/queries';
import { Footer } from '../src/components/Footer';
import { FuelTypeSelector, type FuelType } from '../src/components/ui/FuelTypeSelector';
import { api } from '../src/services/api';
import { useAppStore } from '../src/store/appStore';
import { getOpenStatus, getOpenStatusFromSchedule, formatOpeningHours, type DayHours } from '../src/utils/timeUtils';

interface ModelsPageConfig {
  bg_image?: string;
  title_en?: string;
  title_ar?: string;
  subtitle_en?: string;
  subtitle_ar?: string;
}

export default function AllModelsScreen() {
  const { colors } = useTheme();
  const { t, isRTL, language } = useTranslation();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  // Use React Query for data fetching
  const {
    brands,
    models,
    isLoading,
    isError,
    refetch,
    isRefetching,
  } = useCarBrandsAndModelsQuery();

  const modelIds = useMemo(() => models.map((m: any) => m.id as string), [models]);
  const { data: ratingSummaries = {} } = useRestaurantRatingSummaries(modelIds);

  // Read products from the Zustand store — already populated by the home screen's React Query
  // fetch (setProducts is called inside the queryFn). No extra network request is made here.
  const storeProducts = useAppStore((state) => state.products);

  // Apply the same "untyped dishes" filter that the home screen uses for its chip badges,
  // so counts are consistent across both surfaces.
  const untypedProducts = useMemo(() => {
    return storeProducts.filter((p: any) => {
      const t = p?.product_type;
      const hasType = t === 'tire' || t === 'accessory' || t === 'exterior';
      return !hasType && !p?.is_tire;
    });
  }, [storeProducts]);

  // Count dishes per restaurant from restaurant_ids on each untyped product.
  const restaurantDishCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const product of untypedProducts) {
      const ids: string[] = (product as any).restaurant_ids || [];
      for (const id of ids) {
        counts[id] = (counts[id] ?? 0) + 1;
      }
    }
    return counts;
  }, [untypedProducts]);

  // Page config
  const [pageConfig, setPageConfig] = useState<ModelsPageConfig | null>(null);
  useEffect(() => {
    api.get('/public/settings/models_page_config')
      .then((res) => { if (res.data?.value) setPageConfig(res.data.value as ModelsPageConfig); })
      .catch(() => {});
  }, []);

  // Local state for filters
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedBrand, setSelectedBrand] = useState<string | null>(null);
  const [selectedFuelTypes, setSelectedFuelTypes] = useState<FuelType[]>([]);
  const [sortBy, setSortBy] = useState<'default' | 'highest_rated' | 'most_reviewed'>('default');

  const handleFuelTypeToggle = useCallback((type: FuelType) => {
    setSelectedFuelTypes(prev =>
      prev.includes(type) ? prev.filter(t => t !== type) : [...prev, type]
    );
  }, []);

  // Filter + sort models based on search, brand, fuel type, and sort order
  const filteredModels = useMemo(() => {
    let filtered = [...models];

    // Filter by brand
    if (selectedBrand) {
      filtered = filtered.filter((m: any) => m.brand_id === selectedBrand);
    }

    // Filter by fuel types (multi-select)
    if (selectedFuelTypes.length > 0) {
      filtered = filtered.filter((m: any) => selectedFuelTypes.includes(m.fuel_type));
    }

    // Filter by search query
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter((m: any) =>
        m.name?.toLowerCase().includes(query) ||
        m.name_ar?.includes(query)
      );
    }

    // Sort by rating metrics
    if (sortBy === 'highest_rated') {
      filtered = [...filtered].sort((a, b) => {
        const ra = ratingSummaries[a.id]?.avg_rating ?? 0;
        const rb = ratingSummaries[b.id]?.avg_rating ?? 0;
        return rb - ra;
      });
    } else if (sortBy === 'most_reviewed') {
      filtered = [...filtered].sort((a, b) => {
        const ca = ratingSummaries[a.id]?.review_count ?? 0;
        const cb = ratingSummaries[b.id]?.review_count ?? 0;
        return cb - ca;
      });
    }

    return filtered;
  }, [models, searchQuery, selectedBrand, selectedFuelTypes, sortBy, ratingSummaries]);

  // Get localized name
  const getName = useCallback((item: any, field: string = 'name') => {
    if (!item) return '';
    const arField = `${field}_ar`;
    return language === 'ar' && item?.[arField] ? item[arField] : item?.[field] || '';
  }, [language]);

  // Get brand name by ID
  const getBrandName = useCallback((brandId: string) => {
    const brand = brands.find((b: any) => b.id === brandId);
    return getName(brand);
  }, [brands, getName]);

  // Render model item for FlashList
  const renderModelItem = useCallback(({ item: model }: { item: any }) => {
    const summary = ratingSummaries[model.id];
    const dishCount = restaurantDishCounts[model.id] ?? 0;

    // Compute open/closed status and today's hours label
    const sch: DayHours[] | null =
      Array.isArray(model.hours) && model.hours.length > 0 ? model.hours : null;
    const status = sch
      ? getOpenStatusFromSchedule(sch, language)
      : getOpenStatus(model.year_start, model.year_end, language);
    let hoursLabel: string | null = null;
    if (sch) {
      const today = new Date().getDay();
      const row = sch.find((h: DayHours) => h.day_of_week === today);
      if (row && !row.is_closed) {
        hoursLabel = formatOpeningHours(row.open_minutes, row.close_minutes, language);
      }
    } else {
      hoursLabel = formatOpeningHours(model.year_start, model.year_end, language);
    }
    const isOpen = status?.isOpen;
    const dotColor = isOpen ? '#22c55e' : '#ef4444';
    const statusTextColor = isOpen ? '#16a34a' : '#dc2626';
    const hasStatus = status != null;

    return (
      <TouchableOpacity
        style={[styles.modelCard, { backgroundColor: colors.card, borderColor: colors.border }]}
        onPress={() => router.push(`/car/${model.id}`)}
      >
        <View style={[styles.modelImageContainer, { backgroundColor: colors.surface }]}>
          {model.image_url ? (
            <Image
              source={{ uri: model.image_url }}
              style={styles.modelImage}
              contentFit="cover"
              cachePolicy="memory-disk"
            />
          ) : (
            <Ionicons name="nutrition" size={59} color={colors.textSecondary} />
          )}
          {dishCount > 0 && (
            <View style={styles.dishCountBadge}>
              <Ionicons name="restaurant" size={9} color="#FFF" />
              <Text style={styles.dishCountBadgeText}>
                {dishCount} {language === 'ar' ? 'طبق' : 'dishes'}
              </Text>
            </View>
          )}
        </View>
        <View style={styles.modelInfo}>
          <View style={[styles.brandTag, { backgroundColor: colors.primary + '15' }]}>
            <Text style={[styles.brandTagText, { color: colors.primary }]}>
              {getBrandName(model.brand_id)}
            </Text>
          </View>
          <Text style={[styles.modelName, { color: colors.text }]}>
            {getName(model)}
          </Text>
          {/* Open/Closed badge + today's hours label */}
          {(hasStatus || hoursLabel) && (
            <View style={styles.hoursRow}>
              {hasStatus && (
                <>
                  <View style={[styles.statusDot, { backgroundColor: dotColor }]} />
                  <Text style={[styles.statusText, { color: statusTextColor }]}>
                    {status!.label}
                  </Text>
                </>
              )}
              {hasStatus && hoursLabel && (
                <Text style={[styles.metaSep, { color: colors.textSecondary }]}>·</Text>
              )}
              {hoursLabel && (
                <Text style={[styles.hoursText, { color: colors.textSecondary }]} numberOfLines={1}>
                  {hoursLabel}
                </Text>
              )}
            </View>
          )}
          {/* Location Code Display */}
          {model.chassis_number && (
            <View style={[styles.chassisInfo, { backgroundColor: colors.secondary + '15' }]}>
              <Ionicons name="location-outline" size={13} color={colors.secondary} />
              <Text style={[styles.chassisText, { color: colors.secondary }]}>
                {model.chassis_number}
              </Text>
            </View>
          )}
          {model.variants && model.variants.length > 0 && (
            <View style={styles.variantsInfo}>
              <Ionicons name="layers-outline" size={15} color={colors.secondary} />
              <Text style={[styles.variantsText, { color: colors.secondary }]}>
                {model.variants.length} {language === 'ar' ? 'أحجام' : 'sizes'}
              </Text>
            </View>
          )}
          {summary && summary.review_count > 0 && (
            <View style={[styles.ratingBadge, { backgroundColor: '#F59E0B' + '20', borderColor: '#F59E0B' + '50' }]}>
              <Ionicons name="star" size={11} color="#F59E0B" />
              <Text style={styles.ratingBadgeAvg}>{summary.avg_rating.toFixed(1)}</Text>
              <Text style={[styles.ratingBadgeCount, { color: colors.textSecondary }]}>
                ({summary.review_count})
              </Text>
            </View>
          )}
        </View>
        <Ionicons
          name={isRTL ? 'chevron-back' : 'chevron-forward'}
          size={22}
          color={colors.textSecondary}
        />
      </TouchableOpacity>
    );
  }, [colors, language, isRTL, getName, getBrandName, router, ratingSummaries, restaurantDishCounts]);

  const ListHeaderComponent = useCallback(() => null, []);

  // Empty component
  const ListEmptyComponent = useCallback(() => (
    <View style={styles.emptyContainer}>
      <Ionicons name="restaurant-outline" size={60} color={colors.textSecondary} />
      <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
        {language === 'ar' ? 'لا توجد مطاعم' : 'No restaurants found'}
      </Text>
    </View>
  ), [colors, language]);

  // Loading state
  if (isLoading) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={[
          styles.header,
          { backgroundColor: colors.background, borderBottomColor: colors.border, paddingTop: insets.top + 10 }
        ]}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
            <Ionicons
              name={isRTL ? 'arrow-forward' : 'arrow-back'}
              size={24}
              color={colors.text}
            />
          </TouchableOpacity>
          <Text style={[styles.headerTitle, { color: colors.text }]}>
            {language === 'ar' ? 'جميع المطاعم' : 'All Restaurants'}
          </Text>
          <View style={styles.placeholder} />
        </View>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      </View>
    );
  }

  // Error state
  if (isError) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={[
          styles.header,
          { backgroundColor: colors.background, borderBottomColor: colors.border, paddingTop: insets.top + 10 }
        ]}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
            <Ionicons
              name={isRTL ? 'arrow-forward' : 'arrow-back'}
              size={24}
              color={colors.text}
            />
          </TouchableOpacity>
          <Text style={[styles.headerTitle, { color: colors.text }]}>
            {language === 'ar' ? 'جميع المطاعم' : 'All Restaurants'}
          </Text>
          <View style={styles.placeholder} />
        </View>
        <View style={styles.emptyContainer}>
          <Ionicons name="alert-circle-outline" size={60} color={colors.error} />
          <Text style={[styles.emptyText, { color: colors.error }]}>
            {language === 'ar' ? 'حدث خطأ أثناء تحميل البيانات' : 'Error loading data'}
          </Text>
          <TouchableOpacity
            style={[styles.retryButton, { backgroundColor: colors.primary }]}
            onPress={() => refetch()}
          >
            <Text style={styles.retryButtonText}>
              {language === 'ar' ? 'إعادة المحاولة' : 'Retry'}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Header */}
      <View style={[
        styles.header,
        { backgroundColor: colors.background, borderBottomColor: colors.border, paddingTop: insets.top + 10 }
      ]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <Ionicons
            name={isRTL ? 'arrow-forward' : 'arrow-back'}
            size={24}
            color={colors.text}
          />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.text }]}>
          {language === 'ar' ? 'جميع المطاعم' : 'All Restaurants'}
        </Text>
        <View style={styles.placeholder} />
      </View>

      {/* Page Config Hero Header */}
      {pageConfig && (
        <View style={[styles.pageHeader, !pageConfig.bg_image && { backgroundColor: colors.primary }]}>
          {pageConfig.bg_image ? (
            <>
              <Image source={{ uri: pageConfig.bg_image }} style={styles.pageHeaderBg} contentFit="cover" />
              <View style={styles.pageHeaderOverlay} />
            </>
          ) : null}
          <View style={styles.pageHeaderContent}>
            <Text style={styles.pageHeaderTitle}>
              {language === 'ar' ? (pageConfig.title_ar || 'جميع المطاعم') : (pageConfig.title_en || 'All Restaurants')}
            </Text>
            {(pageConfig.subtitle_en || pageConfig.subtitle_ar) ? (
              <Text style={styles.pageHeaderSubtitle}>
                {language === 'ar' ? (pageConfig.subtitle_ar || '') : (pageConfig.subtitle_en || '')}
              </Text>
            ) : null}
          </View>
        </View>
      )}

      {/* Search & Filter - outside FlashList to prevent keyboard dismissal */}
      <View style={[styles.searchSection, { backgroundColor: colors.surface }]}>
        <View style={[styles.searchContainer, { backgroundColor: colors.inputBackground, borderColor: colors.border }]}>
          <Ionicons name="search" size={20} color={colors.textSecondary} />
          <TextInput
            style={[styles.searchInput, { color: colors.text, textAlign: isRTL ? 'right' : 'left' }]}
            placeholder={language === 'ar' ? 'ابحث عن مطعم...' : 'Search restaurants...'}
            placeholderTextColor={colors.textSecondary}
            value={searchQuery}
            onChangeText={setSearchQuery}
          />
          {searchQuery.length > 0 && (
            <TouchableOpacity onPress={() => setSearchQuery('')}>
              <Ionicons name="close-circle" size={20} color={colors.textSecondary} />
            </TouchableOpacity>
          )}
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.brandsFilter}>
          <TouchableOpacity
            style={[styles.brandChip, { borderColor: colors.border }, !selectedBrand && { backgroundColor: colors.primary, borderColor: colors.primary }]}
            onPress={() => setSelectedBrand(null)}
          >
            <Text style={[styles.brandChipText, { color: !selectedBrand ? '#FFF' : colors.text }]}>
              {language === 'ar' ? 'الكل' : 'All'}
            </Text>
          </TouchableOpacity>
          {brands.map((brand: any) => (
            <TouchableOpacity
              key={brand.id}
              style={[styles.brandChip, { borderColor: colors.border }, selectedBrand === brand.id && { backgroundColor: colors.primary, borderColor: colors.primary }]}
              onPress={() => setSelectedBrand(selectedBrand === brand.id ? null : brand.id)}
            >
              <Ionicons name="restaurant" size={19} color={selectedBrand === brand.id ? '#FFF' : colors.primary} />
              <Text style={[styles.brandChipText, { color: selectedBrand === brand.id ? '#FFF' : colors.text }]}>
                {getName(brand)}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        {/* Fuel Type Filter */}
        <View style={styles.fuelFilterContainer}>
          <FuelTypeSelector
            selected={selectedFuelTypes}
            onSelect={handleFuelTypeToggle}
            multiSelect
            compact
          />
        </View>
      </View>
      {/* Sort Control */}
      <View style={[styles.sortRow, isRTL && styles.rowReverse]}>
        {(['default', 'highest_rated', 'most_reviewed'] as const).map((key) => {
          const label = key === 'default'
            ? (language === 'ar' ? 'افتراضي' : 'Default')
            : key === 'highest_rated'
              ? (language === 'ar' ? 'الأعلى تقييماً' : 'Highest Rated')
              : (language === 'ar' ? 'الأكثر تقييماً' : 'Most Reviewed');
          return (
            <TouchableOpacity
              key={key}
              style={[styles.sortChip, { borderColor: colors.border }, sortBy === key && { backgroundColor: colors.primary, borderColor: colors.primary }]}
              onPress={() => setSortBy(key)}
            >
              {key === 'highest_rated' && <Ionicons name="star" size={11} color={sortBy === key ? '#FFF' : colors.textSecondary} />}
              {key === 'most_reviewed' && <Ionicons name="chatbubble-outline" size={11} color={sortBy === key ? '#FFF' : colors.textSecondary} />}
              <Text style={[styles.sortChipText, { color: sortBy === key ? '#FFF' : colors.textSecondary }]}>{label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
      <View style={styles.resultsHeader}>
        <Text style={[styles.resultsCount, { color: colors.textSecondary }]}>
          {filteredModels.length} {language === 'ar' ? 'مطعم' : 'restaurants'}
        </Text>
      </View>

      {/* FlashList */}
      <FlashList
        data={filteredModels}
        renderItem={renderModelItem}
        keyExtractor={(item) => item.id}
        estimatedItemSize={159}
        ListEmptyComponent={ListEmptyComponent}
        contentContainerStyle={styles.scrollContent}
        onRefresh={refetch}
        refreshing={isRefetching}
      />
      <Footer />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  pageHeader: {
    overflow: 'hidden',
    minHeight: 90,
    justifyContent: 'flex-end',
  },
  pageHeaderBg: {
    ...StyleSheet.absoluteFillObject,
    width: '100%',
    height: '100%',
  },
  pageHeaderOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  pageHeaderContent: {
    padding: 16,
    paddingBottom: 14,
  },
  pageHeaderTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: '#FFF',
    letterSpacing: 0.2,
  },
  pageHeaderSubtitle: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.82)',
    marginTop: 3,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 13,
    paddingBottom: 10,
    borderBottomWidth: 1.9,
  },
  backButton: {
    padding: 5,
  },
  headerTitle: {
    fontSize: 19,
    fontWeight: '700',
    flex: 1,
    textAlign: 'center',
  },
  placeholder: {
    width: 40,
  },
  rowReverse: {
    flexDirection: 'row-reverse',
  },
  sortRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  sortChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1.5,
    gap: 4,
  },
  sortChipText: {
    fontSize: 12,
    fontWeight: '600',
  },
  searchSection: {
    padding: 16,
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 12,
    borderWidth: 1.9,
    paddingHorizontal: 13,
    height: 50,
    gap: 7,
    marginBottom: 11,
  },
  searchInput: {
    flex: 1,
    fontSize: 15,
    height: '100%',
  },
  brandsFilter: {
    paddingVertical: 5,
    gap: 9,
  },
  brandChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 13,
    paddingVertical: 7,
    borderRadius: 20,
    borderWidth: 1.9,
    marginRight: 7,
    gap: 7,
  },
  brandChipText: {
    fontSize: 15,
    fontWeight: '500',
  },
  resultsHeader: {
    paddingHorizontal: 17,
    paddingVertical: 9,
  },
  resultsCount: {
    fontSize: 15,
  },
  scrollContent: {
    paddingBottom: 32,
  },
  emptyContainer: {
    alignItems: 'center',
    paddingVertical: 60,
  },
  emptyText: {
    fontSize: 15,
    marginTop: 13,
  },
  modelCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 3,
    borderRadius: 12,
    borderWidth: 1.9,
    marginBottom: 7,
    marginHorizontal: 15,
  },
  fuelFilterContainer: {
    paddingVertical: 7,
    paddingHorizontal: 7,
  },
  modelImageContainer: {
    width: 131,
    height: 91,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  modelImage: {
    width: '100%',
    height: '100%',
  },
  dishCountBadge: {
    position: 'absolute',
    bottom: 5,
    right: 5,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: 'rgba(0,0,0,0.62)',
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 10,
  },
  dishCountBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#FFF',
  },
  modelInfo: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  brandTag: {
    paddingHorizontal: 13,
    paddingVertical: 1,
    borderRadius: 19,
    marginBottom: 1,
  },
  brandTagText: {
    fontSize: 17,
    fontWeight: '700',
  },
  modelName: {
    fontSize: 19,
    fontWeight: '700',
    marginBottom: 1,
  },
  modelYear: {
    fontSize: 15,
    marginBottom: 1,
  },
  variantsInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  variantsText: {
    fontSize: 11,
    fontWeight: '500',
  },
  chassisInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 7,
    marginBottom: 1,
  },
  chassisText: {
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: 1.1,
  },
  hoursRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 4,
    marginTop: 2,
    marginBottom: 2,
  },
  statusDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  statusText: {
    fontSize: 11,
    fontWeight: '600',
  },
  metaSep: {
    fontSize: 11,
  },
  hoursText: {
    fontSize: 11,
    fontWeight: '400',
  },
  ratingBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
    borderWidth: 1,
    alignSelf: 'center',
  },
  ratingBadgeAvg: {
    fontSize: 12,
    fontWeight: '700',
    color: '#F59E0B',
  },
  ratingBadgeCount: {
    fontSize: 11,
    fontWeight: '400',
  },
  retryButton: {
    marginTop: 16,
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 8,
  },
  retryButtonText: {
    color: '#FFF',
    fontWeight: '700',
    fontSize: 13,
  },
});
