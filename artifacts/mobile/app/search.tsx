import React, { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  ScrollView,
  ActivityIndicator,
  useWindowDimensions,
  Platform,
} from 'react-native';
import { Image } from 'expo-image';
import { FlashList } from '@shopify/flash-list';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ProductCard } from '../src/components/ProductCard';
import ProductTypeStrip, { ProductType } from '../src/components/ProductTypeStrip';
import FitmentStrip from '../src/components/FitmentStrip';
import { DriftLoader } from '../src/components/ui/DriftLoader';
import { useTheme } from '../src/hooks/useTheme';
import { useTranslation } from '../src/hooks/useTranslation';
import { useAppStore } from '../src/store/appStore';
import { useInfiniteProducts } from '../src/hooks/useInfiniteProducts';
import { useQueryClient } from '@tanstack/react-query';
import { carBrandsApi, carModelsApi, productBrandsApi, categoriesApi, cartApi } from '../src/services/api';
import { shoppingHubKeys } from '../src/hooks/queries/useShoppingHubQuery';
import { FuelTypeSelector, FuelTypeIcon, type FuelType } from '../src/components/ui/FuelTypeSelector';
import { Footer } from '../src/components/Footer';
import { TYPE, COLORS } from '../src/constants/luxuryTokens';
import { getOpenStatusFromSchedule, getOpenStatus, formatOpeningHours, type DayHours } from '../src/utils/timeUtils';
import { OpenStatusBadge } from '../src/components/OpenStatusBadge';
import { useRestaurantHoursMap } from '../src/hooks/queries';

export default function SearchScreen() {
  const params = useLocalSearchParams();
  const { colors } = useTheme();
  const { t, isRTL, language } = useTranslation();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user, addToLocalCart, products: storeProducts } = useAppStore();
  const { width: screenWidth } = useWindowDimensions();
  const queryClient = useQueryClient();

  const [carBrands, setCarBrands] = useState<any[]>([]);
  const [carModels, setCarModels] = useState<any[]>([]);
  const [filteredCarModels, setFilteredCarModels] = useState<any[]>([]);

  // Fetch per-day schedules for all restaurant filter cards
  const allCarModelIds = useMemo(() => carModels.map((m: any) => m.id).filter(Boolean) as string[], [carModels]);
  const restaurantHoursMap = useRestaurantHoursMap(allCarModelIds);

  // Derive which restaurants are currently open from the already-fetched per-day schedules.
  const openRestaurantIds = useMemo(() => {
    const ids = new Set<string>();
    carModels.forEach((model: any) => {
      const sch = restaurantHoursMap[model.id];
      const hasSchedule = Array.isArray(sch) && sch.length > 0;
      const status = hasSchedule
        ? getOpenStatusFromSchedule(sch, language)
        : getOpenStatus(model.year_start, model.year_end, language);
      if (status?.isOpen) ids.add(model.id);
    });
    return ids;
  }, [carModels, restaurantHoursMap, language]);

  // Dish count per restaurant — derived from the already-loaded store products (no extra fetch)
  const untypedProducts = useMemo(() => {
    return storeProducts.filter((p: any) => {
      const pt = p?.product_type;
      const hasType = pt === 'tire' || pt === 'accessory' || pt === 'exterior';
      return !hasType && !p?.is_tire;
    });
  }, [storeProducts]);

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

  const [productBrands, setProductBrands] = useState<any[]>([]);
  const [categories, setCategories] = useState<any[]>([]);

  // Calculate responsive card width and number of columns based on screen width.
  // This logic is fully dynamic, ensures fixed gaps, and respects a maximum card width.
  const { cardWidth, numColumns } = useMemo(() => {
    // --- Base Layout Constants ---
    const GAP = 9;
    const PADDING_HORIZONTAL = GAP * 2; // 18px total for left and right screen padding
    const MAX_CARD_WIDTH = 270; // The absolute maximum width a card can have.

    // The available width for cards and their internal gaps.
    const availableWidth = screenWidth - PADDING_HORIZONTAL;

    // --- Universal Logic for All Platforms (Web, Mobile, Tablet) ---

    // 1. Calculate the ideal number of columns.
    // This is the most important step: we calculate how many columns are needed
    // to ensure the card width does NOT exceed MAX_CARD_WIDTH.
    // We use Math.ceil to "force" a new column as soon as the limit is about to be breached.
    const idealCols = Math.ceil(availableWidth / (MAX_CARD_WIDTH + GAP));

    // 2. Apply platform-specific minimums.
    let finalNumColumns;
    if (Platform.OS === 'web') {
      // On web, allow as few as 1 column on very narrow browser windows.
      finalNumColumns = Math.max(1, idealCols);
    } else {
      // On mobile/tablet, enforce a minimum of 2 columns for a better layout.
      finalNumColumns = Math.max(2, idealCols);
    }

    // 3. Calculate the final, exact card width to create a perfect grid.
    // This width will now always be less than or equal to MAX_CARD_WIDTH because of the
    // logic in step 1.
    const totalInternalGaps = GAP * (finalNumColumns - 1);
    const finalCardWidth = (availableWidth - totalInternalGaps) / finalNumColumns;

    if (__DEV__) {
      console.log(
        `[Grid Debug] Platform: ${Platform.OS}, Screen: ${screenWidth}px, Cols: ${finalNumColumns}, CardWidth: ${finalCardWidth.toFixed(2)}px`
      );
    }

    return { cardWidth: finalCardWidth, numColumns: finalNumColumns };
  }, [screenWidth]);

  // Filters
  const [selectedCarBrand, setSelectedCarBrand] = useState<string | null>(params.car_brand_id as string || null);
  const [selectedCarModel, setSelectedCarModel] = useState<string | null>(params.car_model_id as string || null);
  const [selectedProductBrand, setSelectedProductBrand] = useState<string | null>(params.product_brand_id as string || null);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(params.category_id as string || null);
  const [minPrice, setMinPrice] = useState('');
  const [maxPrice, setMaxPrice] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const [openNowFilter, setOpenNowFilter] = useState(false);
  const [selectedFuelTypes, setSelectedFuelTypes] = useState<FuelType[]>([]);
  const [selectedFitments, setSelectedFitments] = useState<string[]>(
    typeof params.fitment === 'string' && params.fitment ? (params.fitment as string).split(',') : []
  );
  const [selectedProductTypes, setSelectedProductTypes] = useState<ProductType[]>(() => {
    const ALLOWED: ProductType[] = ['tire', 'accessory', 'exterior'];
    if (typeof params.product_type === 'string' && params.product_type) {
      return params.product_type
        .split(',')
        .map((s) => s.trim().toLowerCase())
        .filter((s): s is ProductType => (ALLOWED as string[]).includes(s));
    }
    if (params.is_tire === 'true') return ['tire'];
    return [];
  });
  const [searchText, setSearchText] = useState<string>(typeof params.q === 'string' ? params.q : '');
  const [debouncedQuery, setDebouncedQuery] = useState<string>(typeof params.q === 'string' ? params.q : '');
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(searchText.trim()), 300);
    return () => clearTimeout(t);
  }, [searchText]);

  // Build filters object for infinite products hook
  // Memoized with stable reference to prevent re-render loops
  const prevFiltersRef = useRef<string>('');
  const filters = useMemo(() => {
    const newFilters = {
      car_brand_id: selectedCarBrand && !selectedCarModel ? selectedCarBrand : undefined,
      car_model_id: selectedCarModel || undefined,
      product_brand_id: selectedProductBrand || undefined,
      category_id: selectedCategory || undefined,
      min_price: minPrice ? parseFloat(minPrice) : undefined,
      max_price: maxPrice ? parseFloat(maxPrice) : undefined,
      fitment: selectedFitments.length > 0 ? selectedFitments.join(',') : undefined,
      product_type: selectedProductTypes.length > 0 ? selectedProductTypes.join(',') : undefined,
      q: debouncedQuery || undefined,
      open_now: openNowFilter || undefined,
    };
    
    // Only return new object if values actually changed
    const newFiltersStr = JSON.stringify(newFilters);
    if (newFiltersStr === prevFiltersRef.current) {
      return JSON.parse(prevFiltersRef.current);
    }
    prevFiltersRef.current = newFiltersStr;
    return newFilters;
  }, [selectedCarBrand, selectedCarModel, selectedProductBrand, selectedCategory, minPrice, maxPrice, selectedFitments, selectedProductTypes, debouncedQuery, openNowFilter]);

  // Use infinite products hook with cursor-based pagination
  const {
    products,
    isLoading: loading,
    isLoadingMore,
    isRefreshing,
    hasMore,
    total,
    fetchNextPage,
    refresh,
  } = useInfiniteProducts({
    pageSize: 20,
    filters,
    // Only switch to /api/products/search when a text query is present;
    // otherwise the richer filter set (car brand/model, category, price)
    // requires the regular /api/products endpoint.
    // Both endpoints now support ?open_now=true.
    useSearchEndpoint: !!filters.q,
  });

  const fetchFilters = async () => {
    try {
      const [carBrandsRes, carModelsRes, prodBrandsRes, catsRes] = await Promise.all([
        carBrandsApi.getAll(),
        carModelsApi.getAll(),
        productBrandsApi.getAll(),
        categoriesApi.getAll(),
      ]);
      setCarBrands(carBrandsRes.data);
      setCarModels(carModelsRes.data);
      setFilteredCarModels(carModelsRes.data);
      setProductBrands(prodBrandsRes.data);
      setCategories(catsRes.data);
    } catch (error) {
      console.error('Error fetching filters:', error);
    }
  };

  // Filter car models when brand changes - with loop prevention
  const prevBrandRef = useRef<string | null>(null);
  useEffect(() => {
    // Skip if brand hasn't actually changed
    if (prevBrandRef.current === selectedCarBrand) {
      return;
    }
    prevBrandRef.current = selectedCarBrand;
    
    if (selectedCarBrand) {
      setFilteredCarModels(carModels.filter((m) => m.brand_id === selectedCarBrand));
      // Clear selected model if it doesn't belong to the selected brand
      if (selectedCarModel) {
        const model = carModels.find((m) => m.id === selectedCarModel);
        if (model && model.brand_id !== selectedCarBrand) {
          setSelectedCarModel(null);
        }
      }
    } else {
      setFilteredCarModels(carModels);
    }
  }, [selectedCarBrand, carModels, selectedCarModel]);

  useEffect(() => {
    fetchFilters();
  }, []);

  const handleAddToCart = useCallback(async (product: any, quantity: number = 1, fitmentIndicator?: string | null) => {
    if (!user) {
      router.push('/login');
      return;
    }

    try {
      await cartApi.addItem(product.id, quantity, fitmentIndicator ?? undefined);
      addToLocalCart({ product_id: product.id, quantity, product, fitment_indicator: fitmentIndicator ?? null });
      queryClient.invalidateQueries({ queryKey: shoppingHubKeys.cart });
    } catch (error) {
      console.error('Error adding to cart:', error);
    }
  }, [user, router, addToLocalCart, queryClient]);

  // Handle infinite scroll - load more when reaching end
  const handleEndReached = useCallback(() => {
    if (!isLoadingMore && hasMore) {
      fetchNextPage();
    }
  }, [isLoadingMore, hasMore, fetchNextPage]);

  const handleFuelTypeToggle = (type: FuelType) => {
    setSelectedFuelTypes(prev =>
      prev.includes(type) ? prev.filter(t => t !== type) : [...prev, type]
    );
  };

  const clearFilters = () => {
    setSelectedCarBrand(null);
    setSelectedCarModel(null);
    setSelectedProductBrand(null);
    setSelectedCategory(null);
    setMinPrice('');
    setMaxPrice('');
    setOpenNowFilter(false);
    setSelectedFuelTypes([]);
    setSearchText('');
    setSelectedFitments([]);
    setSelectedProductTypes([]);
  };

  const getName = (item: any) => {
    return language === 'ar' && item?.name_ar ? item.name_ar : item?.name || '';
  };

  const hasActiveFilters = selectedCarBrand || selectedCarModel || selectedProductBrand || selectedCategory || minPrice || maxPrice || selectedFuelTypes.length > 0 || searchText.trim().length > 0 || selectedFitments.length > 0 || selectedProductTypes.length > 0 || openNowFilter;

  // When "Open Now" is active, limit the restaurant card strip to open restaurants only.
  const displayedFilterModels = useMemo(() => {
    let list = filteredCarModels.filter(
      (m) => selectedFuelTypes.length === 0 || selectedFuelTypes.includes(m.fuel_type || 'regular'),
    );
    if (openNowFilter) {
      list = list.filter((m) => openRestaurantIds.has(m.id));
    }
    return list;
  }, [filteredCarModels, selectedFuelTypes, openNowFilter, openRestaurantIds]);

  // Server already applies open_now=true filtering — no client-side post-filter needed.
  // displayedProducts is an alias so FlashList and the count label share a single reference.
  const displayedProducts = products;

  // Restaurant id → localised name lookup built from the already-fetched carModels list
  const restaurantNameMap = useMemo(() => {
    const map: Record<string, string> = {};
    carModels.forEach((m: any) => {
      if (m.id) {
        map[m.id] = (language === 'ar' && m.name_ar) ? m.name_ar : (m.name || '');
      }
    });
    return map;
  }, [carModels, language]);

  // Memoized renderItem for FlashList
  const renderItem = useCallback(({ item }: { item: any }) => {
    const ids: string[] = item.restaurant_ids || [];
    const resolvedRestaurants = ids
      .map((id) => ({ id, name: restaurantNameMap[id] }))
      .filter((r): r is { id: string; name: string } => Boolean(r.name));
    const restaurantNameTag = resolvedRestaurants.map((r) => r.name);
    const restaurantIds = resolvedRestaurants.map((r) => r.id);
    return (
      <View style={styles.cardWrapper}>
        <ProductCard
          product={item}
          cardWidth={cardWidth}
          restaurantNameTag={restaurantNameTag.length > 0 ? restaurantNameTag : undefined}
          restaurantIds={restaurantIds.length > 0 ? restaurantIds : undefined}
          onAddToCart={(quantity: number, fitmentIndicator?: string | null) =>
            handleAddToCart(item, quantity, fitmentIndicator)
          }
        />
      </View>
    );
  }, [cardWidth, handleAddToCart, restaurantNameMap]);

  // Footer component for loading more indicator
  const renderFooter = useCallback(() => {
    if (!isLoadingMore) return null;
    return (
      <View style={styles.footerLoader}>
        <ActivityIndicator size="small" color={colors.primary} />
        <Text style={[styles.footerText, { color: colors.textSecondary }]}>
          {language === 'ar' ? 'جاري التحميل...' : 'Loading more...'}
        </Text>
      </View>
    );
  }, [isLoadingMore, colors, language]);

  return (
    <View style={[styles.container, { backgroundColor: colors.background } ]}>
      {/* Header */}
      <View style={[
        styles.header, 
        { backgroundColor: colors.background, borderBottomColor: '#053f59', paddingTop: insets.top + 3.5}
      ]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <Ionicons 
            name={isRTL ? 'arrow-forward' : 'arrow-back'} 
            size={30} 
            color={colors.text} 
          />
        </TouchableOpacity>
        <View style={{ alignItems: 'center' }}>
          <Text style={[styles.kicker, { color: COLORS.goldBright }]}>
            {language === 'ar' ? 'استكشف القائمة' : 'Curate the Menu'}
          </Text>
          <Text style={[styles.headerTitle, { color: colors.text }]}>
            {language === 'ar' ? 'بحث مفصّل' : 'Refined Search'}
          </Text>
          <View style={styles.goldRule} />
        </View>
        <TouchableOpacity 
          onPress={() => setShowFilters(!showFilters)} 
          style={styles.filterButton}
        >
          <Ionicons 
            name={showFilters ? 'options' : 'options-outline'} 
            size={30} 
            color={hasActiveFilters ? colors.primary : colors.text} 
          />
        </TouchableOpacity>
      </View>

      {/* Filters Panel */}
      {showFilters && (
        <ScrollView 
          style={[styles.filtersPanel, { backgroundColor: colors.surface  , borderBottomColor: '#053f59' }]}
          showsVerticalScrollIndicator={false}
        >
          {/* Text query input */}
          <View style={styles.filterSection}>
            <Text style={[styles.filterLabel, { color: colors.text }]}>
              {language === 'ar' ? 'بحث نصي' : 'Search text'}
            </Text>
            <TextInput
              style={[
                styles.priceInput,
                { backgroundColor: colors.background, borderColor: '#cccecf', color: colors.text, width: '100%' },
              ]}
              placeholder={language === 'ar' ? 'ابحث بالاسم أو SKU…' : 'Search by name or SKU…'}
              placeholderTextColor={colors.textSecondary}
              value={searchText}
              onChangeText={setSearchText}
              returnKeyType="search"
            />
          </View>

          {/* Product type multi-select strip */}
          <View style={styles.filterSection}>
            <Text style={[styles.filterLabel, { color: colors.text }]}>
              {language === 'ar' ? 'نوع المنتج' : 'Product type'}
            </Text>
            <ProductTypeStrip
              mode="multi"
              values={selectedProductTypes}
              onChange={setSelectedProductTypes}
              size="md"
            />
          </View>

          {/* Fitment indicator multi-select */}
          <View style={styles.filterSection}>
            <Text style={[styles.filterLabel, { color: colors.text }]}>
              {language === 'ar' ? 'مؤشر التناسب' : 'Fitment indicator'}
            </Text>
            <FitmentStrip
              mode="multi"
              selectedSet={selectedFitments}
              onToggle={(ind) =>
                setSelectedFitments((prev) =>
                  prev.includes(ind) ? prev.filter((x) => x !== ind) : [...prev, ind],
                )
              }
              size="md"
            />
          </View>

          {/* Fuel Type Filter */}
          <View style={styles.filterSection}>
            <Text style={[styles.filterLabel, { color: colors.text }]}>
              {language === 'ar' ? 'نوع الموتور' : 'Fuel Type'}
            </Text>
            <FuelTypeSelector
              selected={selectedFuelTypes}
              onSelect={handleFuelTypeToggle}
              multiSelect
              compact
            />
          </View>

          {/* Car Brands */}
          <View style={styles.filterSection}>
            <Text style={[styles.filterLabel, { color: colors.text }]}>
              {t('filterByBrand')}
            </Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              {carBrands.map((brand) => {
                // Car brands use 'logo' field for images (base64 format from admin panel)
                const brandImage = brand.logo;
                return (
                  <TouchableOpacity
                    key={brand.id}
                    style={[
                      styles.imageFilterCard,
                      { borderColor:'#cccecf', backgroundColor: colors.surface },
                      selectedCarBrand === brand.id && { borderColor: colors.primary, borderWidth: 1.9 },
                    ]}
                    onPress={() => setSelectedCarBrand(selectedCarBrand === brand.id ? null : brand.id)}
                  >
                    <View style={[styles.imageFilterImageContainer, { backgroundColor: colors.surface }]}>
                      {brandImage ? (
                        <Image
                          source={{ uri: brandImage }}
                          style={styles.carBrandImage}
                          contentFit="contain"
                          transition={200}
                        />
                      ) : (
                        <Ionicons name="restaurant-outline" size={40} color={colors.textSecondary} />
                      )}
                    </View>
                    <Text style={[
                      styles.imageFilterLabel,
                      { color: selectedCarBrand === brand.id ? colors.primary : colors.text },
                    ]} numberOfLines={1}>
                      {getName(brand)}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>

          {/* Car Models */}
          <View style={styles.filterSection}>
            <Text style={[styles.filterLabel, { color: colors.text }]}>
              {language === 'ar' ? 'فلتر حسب المطعم' : 'Filter by Restaurant'}
            </Text>
            {/* Open Now chip — always shows count; dims + disables when no restaurants open */}
            {(() => {
              const noOpen = openRestaurantIds.size === 0;
              const chipDisabled = noOpen && !openNowFilter;
              return (
                <TouchableOpacity
                  style={[
                    styles.filterChip,
                    {
                      alignSelf: 'flex-start',
                      marginBottom: 8,
                      backgroundColor: openNowFilter ? '#22c55e' : 'transparent',
                      borderColor: openNowFilter ? '#22c55e' : '#22c55e88',
                      opacity: chipDisabled ? 0.4 : 1,
                    },
                  ]}
                  onPress={() => setOpenNowFilter((v) => !v)}
                  disabled={chipDisabled}
                >
                  <Ionicons
                    name="time-outline"
                    size={14}
                    color={openNowFilter ? '#1a1a1a' : '#22c55e'}
                  />
                  <Text style={[styles.filterChipText, { color: openNowFilter ? '#1a1a1a' : colors.text }]}>
                    {language === 'ar'
                      ? `مفتوح الآن${openRestaurantIds.size > 0 ? ` · ${openRestaurantIds.size}` : ''}`
                      : `Open Now${openRestaurantIds.size > 0 ? ` · ${openRestaurantIds.size}` : ''}`}
                  </Text>
                </TouchableOpacity>
              );
            })()}
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              {displayedFilterModels.map((model) => {
                const modelImage = model.image_url;
                return (
                  <TouchableOpacity
                    key={model.id}
                    style={[
                      styles.imageFilterCardLarge,
                      { borderColor: '#cccecf' , backgroundColor: colors.surface },
                      selectedCarModel === model.id && { borderColor: colors.secondary, borderWidth: 1.9 },
                    ]}
                    onPress={() => setSelectedCarModel(selectedCarModel === model.id ? null : model.id)}
                  >
                    <View style={[styles.imageFilterImageContainerLarge, { backgroundColor: colors.surface }]}>
                      {modelImage ? (
                        <Image
                          source={{ uri: modelImage }}
                          style={styles.carModelImage}
                          contentFit="cover"
                          transition={200}
                        />
                      ) : (
                        <Ionicons name="restaurant-outline" size={50} color={colors.textSecondary} />
                      )}
                      {model.fuel_type && <FuelTypeIcon type={model.fuel_type} size={15} />}
                      {(restaurantDishCounts[model.id] ?? 0) > 0 && (
                        <View style={styles.dishCountBadge}>
                          <Ionicons name="fast-food-outline" size={9} color="#FFF" />
                          <Text style={styles.dishCountBadgeText}>
                            {restaurantDishCounts[model.id]} {language === 'ar' ? 'طبق' : 'dishes'}
                          </Text>
                        </View>
                      )}
                    </View>
                    <Text style={[
                      styles.imageFilterLabel,
                      { color: selectedCarModel === model.id ? colors.secondary : colors.text },
                    ]} numberOfLines={1}>
                      {getName(model)}
                    </Text>
                    {(() => {
                      const schedule = restaurantHoursMap[model.id];
                      const hasSchedule = Array.isArray(schedule) && schedule.length > 0;
                      const status = hasSchedule
                        ? getOpenStatusFromSchedule(schedule, language)
                        : getOpenStatus(model.year_start, model.year_end, language);

                      let hoursLabel: string | null = null;
                      if (hasSchedule) {
                        const today = new Date().getDay();
                        const row = schedule.find((h: DayHours) => h.day_of_week === today);
                        if (row && !row.is_closed) {
                          hoursLabel = formatOpeningHours(row.open_minutes, row.close_minutes, language);
                        }
                      } else {
                        hoursLabel = formatOpeningHours(model.year_start, model.year_end, language);
                      }

                      return (
                        <>
                          {status ? <OpenStatusBadge status={status} size="sm" /> : null}
                          {hoursLabel ? (
                            <Text style={[styles.restaurantHoursLabel, { color: '#888' }]} numberOfLines={1}>
                              {hoursLabel}
                            </Text>
                          ) : null}
                        </>
                      );
                    })()}
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
            {displayedFilterModels.length === 0 && (
              <Text style={[styles.noModelsText, { color: colors.textSecondary }]}>
                {openNowFilter
                  ? (language === 'ar' ? 'لا توجد مطاعم مفتوحة الآن' : 'No restaurants open right now')
                  : (language === 'ar' ? 'اختر مطبخاً لعرض المطاعم' : 'Select a cuisine to show restaurants')}
              </Text>
            )}
          </View>

          {/* Product Brands */}
          <View style={styles.filterSection}>
            <Text style={[styles.filterLabel, { color: colors.text }]}>
              {t('filterByProductBrand')}
            </Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              {productBrands.map((brand) => {
                // Product brands use 'logo' field for images (base64 format from admin panel)
                const brandLogo = brand.logo;
                return (
                  <TouchableOpacity
                    key={brand.id}
                    style={[
                      styles.imageFilterCard,
                      { borderColor: '#cccecf', backgroundColor: colors.surface },
                      selectedProductBrand === brand.id && { borderColor: colors.primary, borderWidth: 1.9 },
                    ]}
                    onPress={() => setSelectedProductBrand(selectedProductBrand === brand.id ? null : brand.id)}
                  >
                    <View style={[styles.imageFilterImageContainer, { backgroundColor: colors.surface }]}>
                      {brandLogo ? (
                        <Image
                          source={{ uri: brandLogo }}
                          style={styles.productBrandImage}
                          contentFit="contain"
                          transition={200}
                        />
                      ) : (
                        <Ionicons name="pricetag" size={40} color={colors.textSecondary} />
                      )}
                    </View>
                    <Text style={[
                      styles.imageFilterLabel,
                      { color: selectedProductBrand === brand.id ? colors.primary : colors.text },
                    ]} numberOfLines={1}>
                      {brand.name}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>

          {/* Categories */}
          <View style={styles.filterSection}>
            <Text style={[styles.filterLabel, { color: colors.text }]}>
              {t('filterByCategory')}
            </Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              {categories.map((cat) => {
                // Categories use 'image_data' field for images (base64 format from admin panel)
                const categoryImage = cat.image_data;
                return (
                  <TouchableOpacity
                    key={cat.id}
                    style={[
                      styles.imageFilterCardSmall,
                      { borderColor: '#cccecf', backgroundColor: colors.surface },
                      selectedCategory === cat.id && { borderColor: colors.primary, borderWidth: 1.9 },
                    ]}
                    onPress={() => setSelectedCategory(selectedCategory === cat.id ? null : cat.id)}
                  >
                    <View style={[styles.imageFilterImageContainerSmall, { backgroundColor: colors.surface }]}>
                      {categoryImage ? (
                        <Image
                          source={{ uri: categoryImage }}
                          style={styles.categoryImage}
                          contentFit="contain"
                          transition={200}
                        />
                      ) : (
                        <Ionicons name="grid" size={30} color={colors.textSecondary} />
                      )}
                    </View>
                    <Text style={[
                      styles.imageFilterLabelSmall,
                      { color: selectedCategory === cat.id ? colors.primary : colors.text },
                    ]} numberOfLines={1}>
                      {getName(cat)}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>

          {/* Price Range */}
          <View style={styles.filterSection}>
            <Text style={[styles.filterLabel, { color: colors.text }]}>
              {t('priceRange')}
            </Text>
            <View style={styles.priceInputs}>
              <TextInput
                style={[
                  styles.priceInput,
                  { backgroundColor: colors.background, borderColor: '#cccecf', color: colors.text },
                ]}
                placeholder="Min"
                placeholderTextColor={colors.textSecondary}
                value={minPrice}
                onChangeText={setMinPrice}
                keyboardType="numeric"
              />
              <Text style={[styles.priceSeparator, { color: colors.textSecondary }]}>-</Text>
              <TextInput
                style={[
                  styles.priceInput,
                  { backgroundColor: colors.background, borderColor: '#cccecf', color: colors.text },
                ]}
                placeholder="Max"
                placeholderTextColor={colors.textSecondary}
                value={maxPrice}
                onChangeText={setMaxPrice}
                keyboardType="numeric"
              />
            </View>
          </View>

          {/* Clear Filters */}
          {hasActiveFilters && (
            <TouchableOpacity
              style={[styles.clearButton, { borderColor: colors.error }]}
              onPress={clearFilters}
            >
              <Ionicons name="close-circle-outline" size={18} color={colors.error} />
              <Text style={[styles.clearButtonText, { color: colors.error }]}>
                {t('clearFilters')}
              </Text>
            </TouchableOpacity>
          )}
        </ScrollView>
      )}

      {/* Results */}
      {loading ? (
        <View style={styles.loadingContainer}>
          <DriftLoader size="large" color={colors.primary} />
        </View>
      ) : (
        <View style={[
          styles.flashListContainer, 
          // On web, explicitly set width to ensure FlashList calculates columns correctly
          Platform.OS === 'web' && { width: screenWidth }
        ]}>
          <FlashList
            data={displayedProducts}
            keyExtractor={(item) => item.id}
            numColumns={numColumns}
            key={`${numColumns}-${screenWidth}`} // Force re-render when columns or width change
            estimatedItemSize={250}
            contentContainerStyle={styles.listContent}
            columnWrapperStyle={{ gap: 9 }}
            onEndReached={handleEndReached}
            onEndReachedThreshold={0.5}
            refreshing={isRefreshing}
            onRefresh={refresh}
            ListHeaderComponent={
              <View>
                <Text style={[styles.resultsKicker, { color: COLORS.goldBright }]}>
                  {language === 'ar' ? 'الأطباق المتاحة' : 'Selections Available'}
                </Text>
                <Text style={[styles.resultsCount, { color: colors.text }]}>
                  {displayedProducts.length}{total > displayedProducts.length ? ` / ${total}` : ''} {language === 'ar' ? 'نتيجة' : 'results'}
                </Text>
              </View>
            }
            ListFooterComponent={renderFooter}
            renderItem={renderItem}
            ListEmptyComponent={
              <View style={styles.emptyContainer}>
                <Ionicons name="restaurant-outline" size={60} color={COLORS.gold} />
                <Text style={[styles.emptyKicker, { color: COLORS.goldBright }]}>
                  {language === 'ar' ? 'القائمة هادئة' : 'The Menu Is Quiet'}
                </Text>
                <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
                  {language === 'ar' ? 'جرّب اختيارات أخرى لاكتشاف المزيد' : 'Try different selections to discover more'}
                </Text>
              </View>
            }
          />
        </View>
      )}
      <Footer />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 19,
    paddingBottom: 0,
    borderBottomWidth: 0,
  },
  backButton: {
    padding: 3,
  },
  headerTitle: {
    ...TYPE.title,
    fontSize: 20,
  },
  kicker: {
    ...TYPE.microLabel,
    fontSize: 10,
    marginBottom: 2,
  },
  goldRule: {
    height: 1,
    backgroundColor: COLORS.gold,
    opacity: 0.55,
    width: 36,
    marginTop: 4,
  },
  filterButton: {
    padding: 1,
  },
  filtersPanel: {
    padding: 1.9,
    borderBottomWidth: 3.5,
    maxHeight: 375,
  },
  filterSection: {
    marginBottom: 5,
  },
  filterLabel: {
    ...TYPE.microLabel,
    fontSize: 11,
    color: COLORS.goldBright,
    marginBottom: 4,
    textAlign: 'center',
  },
  filterChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 15,
    paddingVertical: 7.5,
    borderRadius: 20,
    borderWidth: 1,
    marginRight: 8,
  },
  filterChipText: {
    fontSize: 13,
    fontWeight: '500',
  },
  priceInputs: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  priceInput: {
    flex: 1,
    height: 44,
    borderRadius: 9,
    borderWidth: 1,
    paddingHorizontal: 11,
    fontSize: 13,
  },
  priceSeparator: {
    marginHorizontal: 11,
    fontSize: 15,
  },
  clearButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 11,
    borderRadius: 9,
    borderWidth: 1,
    gap: 5,
  },
  clearButtonText: {
    fontSize: 13,
    fontWeight: '500',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  flashListContainer: {
    flex: 1,
    // Ensure full width on web for proper FlashList grid calculation
    ...(Platform.OS === 'web' ? { width: '100%' } : {}),
  },
  listContent: {
    paddingVertical: 0,
  },
    cardWrapper: {
    // The horizontal layout (width and gaps) is now fully controlled by
    // `cardWidth` from useMemo and `columnWrapperStyle` on the FlashList.
    // This wrapper's only responsibility is the vertical margin between rows.
    marginBottom: 5,
  },
  row: {
    justifyContent: 'flex-start',
  },
  noModelsText: {
    fontSize: 11,
    fontStyle: 'italic',
    marginTop: 5.5,
  },
  resultsKicker: {
    ...TYPE.microLabel,
    fontSize: 10,
    paddingHorizontal: 7,
    marginBottom: 2,
  },
  resultsCount: {
    ...TYPE.title,
    fontSize: 16,
    marginBottom: 10,
    paddingHorizontal: 7,
  },
  emptyContainer: {
    alignItems: 'center',
    paddingVertical: 60,
    gap: 6,
  },
  emptyKicker: {
    ...TYPE.microLabel,
    fontSize: 11,
    marginTop: 6,
  },
  emptyText: {
    ...TYPE.body,
    fontSize: 14,
    textAlign: 'center',
    marginTop: 4,
  },
  footerLoader: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 10,
    gap: 5,
  },
  footerText: {
    ...TYPE.microLabel,
    fontSize: 11,
  },
  // Image Filter Card Styles - Premium design with image-first layout
  imageFilterCard: {
    width: 77,
    marginRight: 5.9,
    borderRadius: 16,
    borderWidth: 0.5 ,
    overflow: 'hidden',
    padding: 3,
    alignItems: 'center',
  },
  imageFilterCardLarge: {
    width: 130,
    marginRight: 5.9,
    borderRadius: 17,
    borderWidth: 0.5 ,
    overflow: 'hidden',
    padding: 3,
    alignItems: 'center',
  },
  imageFilterCardSmall: {
    width: 57,
    marginRight: 5,
    borderRadius: 9,
    borderWidth: 0.5 ,
    overflow: 'hidden',
    padding: 1.9,
    alignItems: 'center',
  },
  imageFilterLabel: {
    fontSize: 11,
    fontWeight: '700',
    textAlign: 'center',
    marginTop: 1.5,
  },
  imageFilterLabelSmall: {
    fontSize: 9,
    fontWeight: '700',
    textAlign: 'center',
    marginTop: 3.5,
  },
  imageFilterImageContainer: {
    width: 70,
    height: 70,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  imageFilterImageContainerLarge: {
    width: 120,
    height: 90,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  imageFilterImageContainerSmall: {
    width: 50,
    height: 50,
    borderRadius: 3,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  
  },
  carBrandImage: {
    width: '100%',
    height: '100%',
  },
  carModelImage: {
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
  restaurantHoursLabel: {
    fontSize: 10,
    fontWeight: '500',
    textAlign: 'center',
    marginTop: 2,
  },
  productBrandImage: {
    width: '100%',
    height: '100%',
  },
  categoryImage: {
    width: '100%',
    height: '100%',
  },
});
