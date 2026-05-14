/**
 * Car Brands Page - Refactored with FlashList and React Query
 * Displays all car brands with search and model counts
 */
import React, { useState, useMemo, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  TextInput,
  ScrollView,
} from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { Image } from 'expo-image';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useTheme } from '../src/hooks/useTheme';
import { useTranslation } from '../src/hooks/useTranslation';
import { Header } from '../src/components/Header';
import { useCarBrandsAndModelsQuery } from '../src/hooks/queries';
import { FuelTypeSelector, type FuelType } from '../src/components/ui/FuelTypeSelector';
import { api } from '../src/services/api';

interface PageConfig {
  bg_image?: string;
  title_en?: string;
  title_ar?: string;
  subtitle_en?: string;
  subtitle_ar?: string;
}

export default function CarBrandsPage() {
  const { colors } = useTheme();
  const { language, isRTL } = useTranslation();
  const router = useRouter();

  const [pageConfig, setPageConfig] = useState<PageConfig | null>(null);
  useEffect(() => {
    api.get('/public/settings/car_brands_page_config')
      .then(res => { if (res.data?.value) setPageConfig(res.data.value as PageConfig); })
      .catch(() => {});
  }, []);

  // Use React Query for data fetching
  const {
    brands,
    models,
    isLoading,
    isError,
    refetch,
    isRefetching,
  } = useCarBrandsAndModelsQuery();

  // Local state for search
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedFuelTypes, setSelectedFuelTypes] = useState<FuelType[]>([]);

  const handleFuelTypeToggle = useCallback((type: FuelType) => {
    setSelectedFuelTypes(prev =>
      prev.includes(type) ? prev.filter(t => t !== type) : [...prev, type]
    );
  }, []);

  // Filter brands based on search and selected fuel types
  const filteredBrands = useMemo(() => {
    let result = [...brands];
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      result = result.filter((brand: any) =>
        brand.name?.toLowerCase().includes(query) ||
        brand.name_ar?.includes(query)
      );
    }
    if (selectedFuelTypes.length > 0) {
      result = result.filter((brand: any) =>
        models.some((m: any) => m.brand_id === brand.id && selectedFuelTypes.includes(m.fuel_type))
      );
    }
    return result;
  }, [brands, models, searchQuery, selectedFuelTypes]);

  // Get models count for a brand
  const getModelsCount = useCallback((brandId: string) => {
    return models.filter((m: any) => m.brand_id === brandId).length;
  }, [models]);

  // Get localized name
  const getName = useCallback((item: any) => {
    return language === 'ar' && item.name_ar ? item.name_ar : item.name;
  }, [language]);

  const navigateToBrand = useCallback((brandId: string) => {
    router.push(`/brand/${brandId}`);
  }, [router]);

  // Render brand item for FlashList
  const renderBrandItem = useCallback(({ item: brand }: { item: any }) => {
    const modelsCount = getModelsCount(brand.id);
    return (
      <TouchableOpacity
        style={[styles.brandCard, { backgroundColor: colors.card, borderColor: colors.border }]}
        onPress={() => navigateToBrand(brand.id)}
        activeOpacity={0.7}
      >
        {/* Brand Logo */}
        <View style={[styles.brandLogoContainer, { backgroundColor: colors.primary + '15' }]}>
          {(brand.image || brand.logo) ? (
            <Image
              source={{ uri: brand.image || brand.logo }}
              style={styles.brandLogo}
              contentFit="contain"
              cachePolicy="disk"
              transition={200}
            />
          ) : (
            <Ionicons name="restaurant-outline" size={40} color={colors.primary} />
          )}
        </View>

        {/* Brand Info */}
        <View style={styles.brandInfo}>
          <Text style={[styles.brandName, { color: colors.text }]} numberOfLines={2}>
            {getName(brand)}
          </Text>
          {modelsCount > 0 && (
            <View style={styles.modelsRow}>
              <Ionicons name="restaurant" size={12} color={colors.textSecondary} />
              <Text style={[styles.modelsText, { color: colors.textSecondary }]}>
                {modelsCount} {language === 'ar' ? 'مطعم' : 'restaurants'}
              </Text>
            </View>
          )}
        </View>

        {/* Arrow Icon */}
        <View style={[styles.arrowContainer, { backgroundColor: colors.primary + '15' }]}>
          <Ionicons name={isRTL ? 'chevron-back' : 'chevron-forward'} size={18} color={colors.primary} />
        </View>
      </TouchableOpacity>
    );
  }, [colors, language, isRTL, getName, getModelsCount, navigateToBrand]);

  const ListHeaderComponent = useCallback(() => {
    const title = pageConfig
      ? (language === 'ar' ? (pageConfig.title_ar || 'المأكولات العالمية') : (pageConfig.title_en || 'Cuisines'))
      : (language === 'ar' ? 'المأكولات العالمية' : 'Cuisines');
    const subtitle = pageConfig
      ? (language === 'ar' ? (pageConfig.subtitle_ar || 'اكتشف أرقى المأكولات العالمية في مطعم الغزالي') : (pageConfig.subtitle_en || 'Discover the finest world cuisines at Al-Ghazaly'))
      : (language === 'ar' ? 'اكتشف أرقى المأكولات العالمية في مطعم الغزالي' : 'Discover the finest world cuisines at Al-Ghazaly');
    return (
      <View style={[styles.pageHeader, !pageConfig?.bg_image && { backgroundColor: colors.primary }]}>
        {pageConfig?.bg_image ? (
          <Image
            source={{ uri: pageConfig.bg_image }}
            style={StyleSheet.absoluteFill}
            contentFit="cover"
          />
        ) : null}
        {pageConfig?.bg_image ? (
          <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.5)' }]} />
        ) : null}
        <View style={styles.headerIcon}>
          <Ionicons name="restaurant" size={32} color="#FFF" />
        </View>
        <Text style={styles.pageTitle}>{title}</Text>
        <Text style={styles.pageSubtitle}>{subtitle}</Text>
      </View>
    );
  }, [colors, language, pageConfig]);

  // Empty component
  const ListEmptyComponent = useCallback(() => (
    <View style={styles.emptyContainer}>
      <Ionicons name="search-outline" size={60} color={colors.textSecondary} />
      <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
        {language === 'ar' ? 'لم نعثر على مأكولات' : 'No cuisines found'}
      </Text>
    </View>
  ), [colors, language]);

  // Loading state
  if (isLoading) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['bottom']}>
        <Header
          title={language === 'ar' ? 'المأكولات العالمية' : 'Cuisines'}
          showBack
          showSearch={false}
          showCart
        />
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      </SafeAreaView>
    );
  }

  // Error state
  if (isError) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['bottom']}>
        <Header
          title={language === 'ar' ? 'المأكولات العالمية' : 'Cuisines'}
          showBack
          showSearch={false}
          showCart
        />
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
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['bottom']}>
      <Header
        title={language === 'ar' ? 'المأكولات العالمية' : 'Cuisines'}
        showBack
        showSearch={false}
        showCart
      />

      {/* Search Bar - outside FlashList to prevent keyboard dismissal on each keystroke */}
      <View style={[styles.searchCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <View style={[styles.searchInputContainer, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Ionicons name="search" size={20} color={colors.textSecondary} />
          <TextInput
            style={[styles.searchInput, { color: colors.text }]}
            placeholder={language === 'ar' ? 'ابحث عن ماركة...' : 'Search brands...'}
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
      </View>

      {/* Fuel Type Filter */}
      <View style={styles.fuelFilterContainer}>
        <FuelTypeSelector
          selected={selectedFuelTypes}
          onSelect={handleFuelTypeToggle}
          multiSelect
          compact
        />
      </View>

      <View style={styles.resultsInfo}>
        <Text style={[styles.resultsText, { color: colors.textSecondary }]}>
          {language === 'ar' ? `عرض ${filteredBrands.length} ماركة` : `Showing ${filteredBrands.length} brands`}
        </Text>
      </View>

      <FlashList
        data={filteredBrands}
        renderItem={renderBrandItem}
        keyExtractor={(item) => item.id}
        estimatedItemSize={113}
        ListHeaderComponent={ListHeaderComponent}
        ListEmptyComponent={ListEmptyComponent}
        contentContainerStyle={styles.listContainer}
        onRefresh={refetch}
        refreshing={isRefetching}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 60,
  },
  listContainer: {
    paddingBottom: 32,
  },
  pageHeader: {
    padding: 35,
    alignItems: 'center',
    marginBottom: 13,
    overflow: 'hidden',
  },
  headerIcon: {
    width: 59,
    height: 59,
    borderRadius: 30,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 3,
  },
  pageTitle: {
    fontSize: 30,
    fontWeight: '700',
    color: '#FFF',
    marginBottom: 8,
  },
  pageSubtitle: {
    fontSize: 17,
    color: 'rgba(255,255,255,0.8)',
    textAlign: 'center',
  },
  searchCard: {
    marginHorizontal: 16,
    marginTop: 0,
    borderRadius: 12,
    borderWidth: 1,
    padding: 16,
  },
  searchInputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 12,
    height: 48,
    gap: 8,
  },
  searchInput: {
    flex: 1,
    fontSize: 16,
    height: '100%',
  },
  fuelFilterContainer: {
    paddingHorizontal: 15,
    paddingVertical: 15,
  },
  resultsInfo: {
    paddingHorizontal: 17,
    marginVertical: 8,
  },
  resultsText: {
    fontSize: 13,
  },
  emptyContainer: {
    alignItems: 'center',
    paddingVertical: 60,
  },
  emptyText: {
    fontSize: 16,
    marginTop: 16,
  },
  brandCard: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 12,
    borderWidth: 1,
    padding: 12,
    marginBottom: 12,
    marginHorizontal: 16,
  },
  brandLogoContainer: {
    width: 90,
    height: 90,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  brandLogo: {
    width: 79,
    height: 79,
  },
  brandInfo: {
    flex: 1,
    marginLeft: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  brandName: {
    fontSize: 17,
    fontWeight: '600',
    marginBottom: 7,
  },
  modelsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  modelsText: {
    fontSize: 12,
  },
  arrowContainer: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  retryButton: {
    marginTop: 16,
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 8,
  },
  retryButtonText: {
    color: '#FFF',
    fontWeight: '600',
    fontSize: 14,
  },
});
