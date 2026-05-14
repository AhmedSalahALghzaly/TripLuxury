/**
 * Advanced Search Component with Bottom Sheet
 * Unified search experience with advanced filtering
 * Uses @gorhom/bottom-sheet for smooth interactions
 */
import React, { useCallback, useMemo, useRef, useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ScrollView,
  Image,
  Dimensions,
  Keyboard,
  Platform,
} from 'react-native';
import BottomSheet, {
  BottomSheetBackdrop,
  BottomSheetScrollView,
  BottomSheetTextInput,
} from '@gorhom/bottom-sheet';
import { Ionicons } from '@expo/vector-icons';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withTiming,
  interpolate,
  Extrapolation,
  FadeIn,
  FadeOut,
  SlideInRight,
  Layout,
} from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import { BlurView } from 'expo-blur';

import { useTheme } from '../../hooks/useTheme';
import { useTranslation } from '../../hooks/useTranslation';
import { useAppStore, useColorMood } from '../../store/appStore';
import { DURATIONS, SPRINGS, HAPTIC_PATTERNS } from '../../constants/animations';
import { Skeleton } from './Skeleton';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

// Filter Types
type PriceRange = 'all' | 'budget' | 'mid' | 'premium' | 'luxury';
type SortOption = 'relevance' | 'price_asc' | 'price_desc' | 'newest' | 'popular';

interface FilterState {
  priceRange: PriceRange;
  sortBy: SortOption;
  categoryId: string | null;
  brandId: string | null;
  carModelId: string | null;
  inStock: boolean;
}

interface SearchResult {
  id: string;
  type: 'product' | 'category' | 'brand' | 'car';
  name: string;
  nameAr?: string;
  image?: string;
  price?: number;
  subtitle?: string;
}

interface AdvancedSearchProps {
  visible: boolean;
  onClose: () => void;
  initialQuery?: string;
}

const AnimatedTouchable = Animated.createAnimatedComponent(TouchableOpacity);

export const AdvancedSearch: React.FC<AdvancedSearchProps> = ({
  visible,
  onClose,
  initialQuery = '',
}) => {
  const { colors, isDark } = useTheme();
  const { language, isRTL } = useTranslation();
  const router = useRouter();
  const mood = useColorMood();

  // Store data
  const products = useAppStore((state) => state.products);
  const categories = useAppStore((state) => state.categories);
  const carBrands = useAppStore((state) => state.carBrands);
  const carModels = useAppStore((state) => state.carModels);
  const productBrands = useAppStore((state) => state.productBrands);

  // Refs
  const bottomSheetRef = useRef<BottomSheet>(null);
  const searchInputRef = useRef<any>(null);

  // State
  const [query, setQuery] = useState(initialQuery);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [recentSearches, setRecentSearches] = useState<string[]>([]);
  const [filters, setFilters] = useState<FilterState>({
    priceRange: 'all',
    sortBy: 'relevance',
    categoryId: null,
    brandId: null,
    carModelId: null,
    inStock: false,
  });

  // Animations
  const filterHeight = useSharedValue(0);
  const searchBarScale = useSharedValue(1);

  // Snap points for bottom sheet
  const snapPoints = useMemo(() => ['50%', '90%'], []);

  // Handle sheet changes
  const handleSheetChanges = useCallback((index: number) => {
    if (index === -1) {
      onClose();
      Keyboard.dismiss();
    }
  }, [onClose]);

  // Open/close sheet based on visibility
  useEffect(() => {
    if (visible) {
      bottomSheetRef.current?.expand();
      setTimeout(() => searchInputRef.current?.focus(), 300);
    } else {
      bottomSheetRef.current?.close();
    }
  }, [visible]);

  // Search logic with fuzzy matching
  const performSearch = useCallback((searchQuery: string) => {
    if (!searchQuery.trim()) {
      setResults([]);
      return;
    }

    setIsSearching(true);
    const lowerQuery = searchQuery.toLowerCase();

    // Search products
    const productResults: SearchResult[] = products
      .filter((p) => {
        const matchName = p.name?.toLowerCase().includes(lowerQuery);
        const matchNameAr = p.name_ar?.toLowerCase().includes(lowerQuery);
        const matchSku = p.sku?.toLowerCase().includes(lowerQuery);
        return matchName || matchNameAr || matchSku;
      })
      .slice(0, 10)
      .map((p) => ({
        id: p.id,
        type: 'product' as const,
        name: p.name,
        nameAr: p.name_ar,
        image: p.image_url,
        price: p.price,
        subtitle: `SKU: ${p.sku}`,
      }));

    // Search categories
    const categoryResults: SearchResult[] = categories
      .filter((c) => {
        const matchName = c.name?.toLowerCase().includes(lowerQuery);
        const matchNameAr = c.name_ar?.toLowerCase().includes(lowerQuery);
        return matchName || matchNameAr;
      })
      .slice(0, 5)
      .map((c) => ({
        id: c.id,
        type: 'category' as const,
        name: c.name,
        nameAr: c.name_ar,
        image: c.image_url,
        subtitle: language === 'ar' ? 'فئة' : 'Category',
      }));

    // Search car brands
    const carBrandResults: SearchResult[] = carBrands
      .filter((b) => {
        const matchName = b.name?.toLowerCase().includes(lowerQuery);
        const matchNameAr = b.name_ar?.toLowerCase().includes(lowerQuery);
        return matchName || matchNameAr;
      })
      .slice(0, 5)
      .map((b) => ({
        id: b.id,
        type: 'car' as const,
        name: b.name,
        nameAr: b.name_ar,
        image: b.logo_url,
        subtitle: language === 'ar' ? 'مطبخ عالمي' : 'Cuisine',
      }));

    // Combine and sort by relevance
    const allResults = [...productResults, ...categoryResults, ...carBrandResults];
    setResults(allResults);
    setIsSearching(false);
  }, [products, categories, carBrands, language]);

  // Debounced search
  useEffect(() => {
    const timer = setTimeout(() => {
      performSearch(query);
    }, 200);
    return () => clearTimeout(timer);
  }, [query, performSearch]);

  // Handle result selection
  const handleResultPress = (result: SearchResult) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    
    // Save to recent searches
    const name = language === 'ar' && result.nameAr ? result.nameAr : result.name;
    setRecentSearches((prev) => {
      const filtered = prev.filter((s) => s !== name);
      return [name, ...filtered].slice(0, 5);
    });

    onClose();

    // Navigate based on type
    switch (result.type) {
      case 'product':
        router.push(`/product/${result.id}`);
        break;
      case 'category':
        router.push(`/category/${result.id}`);
        break;
      case 'car':
        router.push(`/brand/${result.id}`);
        break;
      case 'brand':
        router.push(`/search?product_brand_id=${result.id}`);
        break;
    }
  };

  // Toggle filters with animation
  const toggleFilters = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setShowFilters((prev) => !prev);
    filterHeight.value = withSpring(showFilters ? 0 : 200, SPRINGS.gentle);
  };

  // Filter chip component
  const FilterChip: React.FC<{
    label: string;
    active: boolean;
    onPress: () => void;
  }> = ({ label, active, onPress }) => (
    <TouchableOpacity
      style={[
        styles.filterChip,
        {
          backgroundColor: active ? mood.primary : colors.surface,
          borderColor: active ? mood.primary : colors.border,
        },
      ]}
      onPress={() => {
        Haptics.selectionAsync();
        onPress();
      }}
      activeOpacity={0.7}
    >
      <Text
        style={[
          styles.filterChipText,
          { color: active ? '#FFF' : colors.text },
        ]}
      >
        {label}
      </Text>
    </TouchableOpacity>
  );

  // Price range labels
  const priceRanges: { key: PriceRange; label: string; labelAr: string }[] = [
    { key: 'all', label: 'All', labelAr: 'الكل' },
    { key: 'budget', label: '<100', labelAr: '<100' },
    { key: 'mid', label: '100-500', labelAr: '100-500' },
    { key: 'premium', label: '500-1000', labelAr: '500-1000' },
    { key: 'luxury', label: '>1000', labelAr: '>1000' },
  ];

  // Sort options
  const sortOptions: { key: SortOption; label: string; labelAr: string }[] = [
    { key: 'relevance', label: 'Relevance', labelAr: 'الصلة' },
    { key: 'price_asc', label: 'Price ↑', labelAr: 'السعر ↑' },
    { key: 'price_desc', label: 'Price ↓', labelAr: 'السعر ↓' },
    { key: 'newest', label: 'Newest', labelAr: 'الأحدث' },
    { key: 'popular', label: 'Popular', labelAr: 'الأكثر شعبية' },
  ];

  // Render backdrop
  const renderBackdrop = useCallback(
    (props: any) => (
      <BottomSheetBackdrop
        {...props}
        disappearsOnIndex={-1}
        appearsOnIndex={0}
        opacity={0.5}
      />
    ),
    []
  );

  // Get display name
  const getName = (item: SearchResult) =>
    language === 'ar' && item.nameAr ? item.nameAr : item.name;

  // Filter animation style
  const filterAnimatedStyle = useAnimatedStyle(() => ({
    height: filterHeight.value,
    opacity: interpolate(filterHeight.value, [0, 200], [0, 1], Extrapolation.CLAMP),
    overflow: 'hidden' as const,
  }));

  // Result type icon
  const getResultIcon = (type: string) => {
    switch (type) {
      case 'product': return 'cube-outline';
      case 'category': return 'grid-outline';
      case 'car': return 'restaurant-outline';
      case 'brand': return 'pricetag-outline';
      default: return 'search-outline';
    }
  };

  if (!visible) return null;

  return (
    <BottomSheet
      ref={bottomSheetRef}
      index={0}
      snapPoints={snapPoints}
      onChange={handleSheetChanges}
      enablePanDownToClose
      backdropComponent={renderBackdrop}
      handleIndicatorStyle={{ backgroundColor: colors.textSecondary }}
      backgroundStyle={{
        backgroundColor: colors.background,
        borderTopLeftRadius: 24,
        borderTopRightRadius: 24,
      }}
      keyboardBehavior="extend"
      keyboardBlurBehavior="restore"
    >
      <View style={styles.container}>
        {/* Search Header */}
        <View style={[styles.searchHeader, { borderBottomColor: colors.border }]}>
          {/* Search Input */}
          <View
            style={[
              styles.searchInputContainer,
              {
                backgroundColor: colors.surface,
                borderColor: mood.primary + '40',
              },
            ]}
          >
            <Ionicons name="search" size={20} color={mood.primary} />
            <BottomSheetTextInput
              ref={searchInputRef}
              style={[
                styles.searchInput,
                { color: colors.text, textAlign: isRTL ? 'right' : 'left' },
              ]}
              placeholder={
                language === 'ar'
                  ? 'ابحث عن منتجات، فئات، مطاعم...'
                  : 'Search products, categories, restaurants...'
              }
              placeholderTextColor={colors.textSecondary}
              value={query}
              onChangeText={setQuery}
              returnKeyType="search"
              autoCapitalize="none"
              autoCorrect={false}
            />
            {query.length > 0 && (
              <TouchableOpacity
                onPress={() => {
                  setQuery('');
                  Haptics.selectionAsync();
                }}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              >
                <Ionicons name="close-circle" size={20} color={colors.textSecondary} />
              </TouchableOpacity>
            )}
          </View>

          {/* Filter Toggle */}
          <TouchableOpacity
            style={[
              styles.filterToggle,
              {
                backgroundColor: showFilters ? mood.primary : colors.surface,
                borderColor: mood.primary,
              },
            ]}
            onPress={toggleFilters}
          >
            <Ionicons
              name="options"
              size={20}
              color={showFilters ? '#FFF' : mood.primary}
            />
          </TouchableOpacity>
        </View>

        {/* Filters Panel */}
        <Animated.View style={[styles.filtersPanel, filterAnimatedStyle]}>
          {/* Price Range */}
          <View style={styles.filterSection}>
            <Text style={[styles.filterLabel, { color: colors.text }]}>
              {language === 'ar' ? 'نطاق السعر' : 'Price Range'}
            </Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <View style={styles.filterChipsRow}>
                {priceRanges.map((range) => (
                  <FilterChip
                    key={range.key}
                    label={language === 'ar' ? range.labelAr : range.label}
                    active={filters.priceRange === range.key}
                    onPress={() =>
                      setFilters((prev) => ({ ...prev, priceRange: range.key }))
                    }
                  />
                ))}
              </View>
            </ScrollView>
          </View>

          {/* Sort By */}
          <View style={styles.filterSection}>
            <Text style={[styles.filterLabel, { color: colors.text }]}>
              {language === 'ar' ? 'ترتيب حسب' : 'Sort By'}
            </Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <View style={styles.filterChipsRow}>
                {sortOptions.map((option) => (
                  <FilterChip
                    key={option.key}
                    label={language === 'ar' ? option.labelAr : option.label}
                    active={filters.sortBy === option.key}
                    onPress={() =>
                      setFilters((prev) => ({ ...prev, sortBy: option.key }))
                    }
                  />
                ))}
              </View>
            </ScrollView>
          </View>

          {/* In Stock Toggle */}
          <TouchableOpacity
            style={styles.toggleRow}
            onPress={() => {
              Haptics.selectionAsync();
              setFilters((prev) => ({ ...prev, inStock: !prev.inStock }));
            }}
          >
            <Text style={[styles.toggleLabel, { color: colors.text }]}>
              {language === 'ar' ? 'متوفر فقط' : 'In Stock Only'}
            </Text>
            <View
              style={[
                styles.toggleSwitch,
                {
                  backgroundColor: filters.inStock ? mood.primary : colors.surface,
                  borderColor: filters.inStock ? mood.primary : colors.border,
                },
              ]}
            >
              <Animated.View
                style={[
                  styles.toggleKnob,
                  {
                    backgroundColor: '#FFF',
                    transform: [
                      { translateX: filters.inStock ? 18 : 2 },
                    ],
                  },
                ]}
              />
            </View>
          </TouchableOpacity>
        </Animated.View>

        {/* Results */}
        <BottomSheetScrollView
          style={styles.resultsContainer}
          contentContainerStyle={styles.resultsContent}
          showsVerticalScrollIndicator={false}
        >
          {/* Recent Searches - Show when no query */}
          {query.length === 0 && recentSearches.length > 0 && (
            <View style={styles.recentSection}>
              <View style={styles.recentHeader}>
                <Ionicons name="time-outline" size={18} color={colors.textSecondary} />
                <Text style={[styles.recentTitle, { color: colors.textSecondary }]}>
                  {language === 'ar' ? 'عمليات البحث الأخيرة' : 'Recent Searches'}
                </Text>
              </View>
              {recentSearches.map((search, index) => (
                <TouchableOpacity
                  key={index}
                  style={styles.recentItem}
                  onPress={() => setQuery(search)}
                >
                  <Ionicons name="search" size={16} color={colors.textSecondary} />
                  <Text style={[styles.recentText, { color: colors.text }]}>
                    {search}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          )}

          {/* Quick Actions - Show when no query */}
          {query.length === 0 && (
            <View style={styles.quickActions}>
              <Text style={[styles.quickActionsTitle, { color: colors.text }]}>
                {language === 'ar' ? 'استكشف' : 'Explore'}
              </Text>
              <View style={styles.quickActionsGrid}>
                <TouchableOpacity
                  style={[styles.quickAction, { backgroundColor: mood.primary + '15' }]}
                  onPress={() => {
                    onClose();
                    router.push('/car-brands');
                  }}
                >
                  <Ionicons name="restaurant-outline" size={24} color={mood.primary} />
                  <Text style={[styles.quickActionText, { color: mood.primary }]}>
                    {language === 'ar' ? 'المطابخ' : 'Cuisines'}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.quickAction, { backgroundColor: colors.success + '15' }]}
                  onPress={() => {
                    onClose();
                    router.push('/(tabs)/categories');
                  }}
                >
                  <Ionicons name="grid" size={24} color={colors.success} />
                  <Text style={[styles.quickActionText, { color: colors.success }]}>
                    {language === 'ar' ? 'الفئات' : 'Categories'}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.quickAction, { backgroundColor: colors.warning + '15' }]}
                  onPress={() => {
                    onClose();
                    router.push('/brands');
                  }}
                >
                  <Ionicons name="pricetag" size={24} color={colors.warning} />
                  <Text style={[styles.quickActionText, { color: colors.warning }]}>
                    {language === 'ar' ? 'الماركات' : 'Brands'}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.quickAction, { backgroundColor: colors.error + '15' }]}
                  onPress={() => {
                    onClose();
                    router.push('/cart?tab=favorites');
                  }}
                >
                  <Ionicons name="heart" size={24} color={colors.error} />
                  <Text style={[styles.quickActionText, { color: colors.error }]}>
                    {language === 'ar' ? 'المفضلة' : 'Favorites'}
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          )}

          {/* Loading State */}
          {isSearching && (
            <View style={styles.loadingContainer}>
              {[1, 2, 3].map((i) => (
                <View key={i} style={styles.skeletonItem}>
                  <Skeleton width={50} height={50} borderRadius={8} />
                  <View style={styles.skeletonText}>
                    <Skeleton width="70%" height={16} />
                    <Skeleton width="40%" height={12} style={{ marginTop: 8 }} />
                  </View>
                </View>
              ))}
            </View>
          )}

          {/* Search Results */}
          {!isSearching && results.length > 0 && (
            <View style={styles.resultsSection}>
              <Text style={[styles.resultsCount, { color: colors.textSecondary }]}>
                {language === 'ar'
                  ? `${results.length} نتيجة`
                  : `${results.length} results`}
              </Text>
              {results.map((result, index) => (
                <Animated.View
                  key={`${result.type}-${result.id}`}
                  entering={FadeIn.delay(index * 50).duration(200)}
                  layout={Layout.springify()}
                >
                  <TouchableOpacity
                    style={[
                      styles.resultItem,
                      { backgroundColor: colors.surface, borderColor: colors.border },
                    ]}
                    onPress={() => handleResultPress(result)}
                    activeOpacity={0.7}
                  >
                    {/* Result Image/Icon */}
                    <View
                      style={[
                        styles.resultImageContainer,
                        { backgroundColor: mood.primary + '10' },
                      ]}
                    >
                      {result.image ? (
                        <Image
                          source={{ uri: result.image }}
                          style={styles.resultImage}
                          resizeMode="cover"
                        />
                      ) : (
                        <Ionicons
                          name={getResultIcon(result.type) as any}
                          size={24}
                          color={mood.primary}
                        />
                      )}
                    </View>

                    {/* Result Info */}
                    <View style={styles.resultInfo}>
                      <Text
                        style={[styles.resultName, { color: colors.text }]}
                        numberOfLines={1}
                      >
                        {getName(result)}
                      </Text>
                      <View style={styles.resultMeta}>
                        <Text
                          style={[styles.resultSubtitle, { color: colors.textSecondary }]}
                        >
                          {result.subtitle}
                        </Text>
                        {result.price && (
                          <Text style={[styles.resultPrice, { color: mood.primary }]}>
                            {(parseFloat(String(result.price || 0)) || 0).toFixed(2)} {language === 'ar' ? 'ج.م' : 'EGP'}
                          </Text>
                        )}
                      </View>
                    </View>

                    {/* Arrow */}
                    <Ionicons
                      name={isRTL ? 'chevron-back' : 'chevron-forward'}
                      size={20}
                      color={colors.textSecondary}
                    />
                  </TouchableOpacity>
                </Animated.View>
              ))}
            </View>
          )}

          {/* No Results */}
          {!isSearching && query.length > 0 && results.length === 0 && (
            <View style={styles.noResults}>
              <Ionicons name="search" size={48} color={colors.textSecondary} />
              <Text style={[styles.noResultsText, { color: colors.textSecondary }]}>
                {language === 'ar'
                  ? 'لا توجد نتائج لـ '
                  : 'No results for "'}
                <Text style={{ color: colors.text, fontWeight: '600' }}>{query}</Text>
                {language === 'ar' ? '' : '"'}
              </Text>
              <Text style={[styles.noResultsHint, { color: colors.textSecondary }]}>
                {language === 'ar'
                  ? 'جرب كلمات مختلفة أو تحقق من الإملاء'
                  : 'Try different keywords or check spelling'}
              </Text>
            </View>
          )}
        </BottomSheetScrollView>
      </View>
    </BottomSheet>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  searchHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    gap: 12,
  },
  searchInputContainer: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 2,
    borderRadius: 16,
    paddingHorizontal: 14,
    height: 50,
    gap: 10,
  },
  searchInput: {
    flex: 1,
    fontSize: 16,
    paddingVertical: 0,
  },
  filterToggle: {
    width: 50,
    height: 50,
    borderRadius: 16,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  filtersPanel: {
    paddingHorizontal: 16,
    paddingTop: 12,
  },
  filterSection: {
    marginBottom: 16,
  },
  filterLabel: {
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 8,
  },
  filterChipsRow: {
    flexDirection: 'row',
    gap: 8,
  },
  filterChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
  },
  filterChipText: {
    fontSize: 13,
    fontWeight: '500',
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 8,
  },
  toggleLabel: {
    fontSize: 14,
    fontWeight: '500',
  },
  toggleSwitch: {
    width: 44,
    height: 26,
    borderRadius: 13,
    borderWidth: 1,
    justifyContent: 'center',
  },
  toggleKnob: {
    width: 22,
    height: 22,
    borderRadius: 11,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 2,
    elevation: 2,
  },
  resultsContainer: {
    flex: 1,
  },
  resultsContent: {
    paddingHorizontal: 16,
    paddingBottom: 40,
  },
  recentSection: {
    marginTop: 16,
  },
  recentHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
  },
  recentTitle: {
    fontSize: 14,
    fontWeight: '600',
  },
  recentItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
  },
  recentText: {
    fontSize: 15,
  },
  quickActions: {
    marginTop: 24,
  },
  quickActionsTitle: {
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 16,
  },
  quickActionsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  quickAction: {
    width: (SCREEN_WIDTH - 56) / 2,
    paddingVertical: 20,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  quickActionText: {
    fontSize: 14,
    fontWeight: '600',
  },
  loadingContainer: {
    marginTop: 16,
    gap: 12,
  },
  skeletonItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 12,
  },
  skeletonText: {
    flex: 1,
  },
  resultsSection: {
    marginTop: 16,
  },
  resultsCount: {
    fontSize: 13,
    marginBottom: 12,
  },
  resultItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 10,
    gap: 12,
  },
  resultImageContainer: {
    width: 50,
    height: 50,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  resultImage: {
    width: '100%',
    height: '100%',
  },
  resultInfo: {
    flex: 1,
  },
  resultName: {
    fontSize: 15,
    fontWeight: '600',
    marginBottom: 4,
  },
  resultMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  resultSubtitle: {
    fontSize: 12,
  },
  resultPrice: {
    fontSize: 14,
    fontWeight: '700',
  },
  noResults: {
    alignItems: 'center',
    paddingVertical: 48,
  },
  noResultsText: {
    fontSize: 16,
    marginTop: 16,
    textAlign: 'center',
  },
  noResultsHint: {
    fontSize: 13,
    marginTop: 8,
    textAlign: 'center',
  },
});

export default AdvancedSearch;
