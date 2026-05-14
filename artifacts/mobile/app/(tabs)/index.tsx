/**
 * Home Screen - Optimized with React Query
 * Main landing page with car brands, offers, products, and search
 */
import React, {
  useState,
  useCallback,
  useRef,
  useMemo,
  memo,
  useEffect,
} from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
  TextInput,
  Animated,
  Keyboard,
  useWindowDimensions,
  Platform,
  FlatList,
} from "react-native";
import { Image } from "expo-image";
import { BlurView } from "expo-blur";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Header } from "../../src/components/Header";
import { InteractiveCarSelector } from "../../src/components/InteractiveCarSelector";
import { AnimatedBrandCard } from "../../src/components/AnimatedBrandCard";
import { ProductCard } from "../../src/components/ProductCard";
import { HomeHero } from "../../src/components/home/HomeHero";
import { ChefsSpecialSpotlight } from "../../src/components/home/ChefsSpecialSpotlight";
import { MagazineSectionHeader } from "../../src/components/home/MagazineSectionHeader";
import { OfferSliderCarousel } from "../../src/components/home/OfferSliderCarousel";
import { MealCategoryRail } from "../../src/components/home/MealCategoryRail";
import GlobalRatingsStrip from "../../src/components/home/GlobalRatingsStrip";
import SocialMediaStrip from "../../src/components/home/SocialMediaStrip";
import FooterInfoRows from "../../src/components/home/FooterInfoRows";
import FooterVideo from "../../src/components/home/FooterVideo";
import RatingModal from "../../src/components/home/RatingModal";
import { useTheme } from "../../src/hooks/useTheme";
import { useTranslation } from "../../src/hooks/useTranslation";
import { useAppStore } from "../../src/store/appStore";
import { useQueryClient, useQuery } from "@tanstack/react-query";
import { cartApi, favoritesApi, supplierApi, api, carModelsApi } from "../../src/services/api";
import { shoppingHubKeys } from "../../src/hooks/queries/useShoppingHubQuery";
import {
  Skeleton,
  ProductCardSkeleton,
} from "../../src/components/ui/Skeleton";
import { LinearGradient } from "expo-linear-gradient";
import { getOpenStatus, getOpenStatusFromSchedule, formatOpeningHours, type DayHours } from "../../src/utils/timeUtils";
import { OpenStatusBadge } from "../../src/components/OpenStatusBadge";
import { useHomeScreenQuery, useRestaurantHoursMap } from "../../src/hooks/queries";
import { createTextShadow } from "../../src/utils/shadowUtils";
import {
  FONTS,
  SPACING,
  RADII,
  ELEVATION,
  GRADIENTS,
  OVERLAYS,
  COLORS,
} from "../../src/constants/luxuryTokens";

// Product card sizing
const BASE_CARD_WIDTH = 179;
const MAX_ENLARGEMENT_PERCENT = 0.19;
const MAX_CARD_WIDTH = Math.floor(
  BASE_CARD_WIDTH * (1 + MAX_ENLARGEMENT_PERCENT),
);
function calculateCardWidth(screenWidth: number): number {
  const horizontalPadding = 13 * 2;
  const cardGap = 11;
  const availableWidth = screenWidth - horizontalPadding;
  const minCardsPerRow = Math.floor(
    availableWidth / (BASE_CARD_WIDTH + cardGap),
  );
  const optimalWidth = Math.floor(
    (availableWidth - cardGap * (minCardsPerRow - 1)) / minCardsPerRow,
  );
  return Math.min(optimalWidth, MAX_CARD_WIDTH);
}

// Memoized components
const MemoizedBrandCard = memo(AnimatedBrandCard);
const MemoizedProductCard = memo(ProductCard);

// Memoized Car Model Card component — professional single-info-row design
const CarModelCard = memo(({ model, colors, getName, onPress, cardWidth, language, dishCount, schedule }: any) => {
  const sch =
    Array.isArray(schedule) && schedule.length > 0
      ? schedule
      : (Array.isArray(model.hours) && model.hours.length > 0 ? model.hours : null);
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
  const hasMeta = hasStatus || !!hoursLabel || dishCount > 0;

  return (
    <TouchableOpacity
      style={[styles.carModelCard, { width: cardWidth, backgroundColor: colors.card, borderColor: colors.border }]}
      onPress={onPress}
      activeOpacity={0.82}
    >
      {/* ── Image ── */}
      <View style={[styles.carModelImageContainer, { backgroundColor: colors.surface }]}>
        {model.image_url ? (
          <Image
            source={{ uri: model.image_url }}
            style={styles.carModelImage}
            contentFit="cover"
            cachePolicy="disk"
            transition={200}
          />
        ) : (
          <View style={styles.carModelImagePlaceholder}>
            <Ionicons name="restaurant-outline" size={38} color={colors.textSecondary} />
          </View>
        )}
        {/* Dish count badge — overlaid bottom-right on image */}
        {dishCount > 0 && (
          <View style={styles.carModelDishBadge}>
            <Ionicons name="restaurant" size={9} color="#FFF" />
            <Text style={styles.carModelDishBadgeText}>
              {dishCount}
            </Text>
          </View>
        )}
      </View>

      {/* ── Info section ── */}
      <View style={styles.carModelInfo}>
        <Text style={[styles.carModelName, { color: colors.text }]} numberOfLines={1}>
          {getName(model)}
        </Text>

        {/* Single elegant metadata row */}
        {hasMeta && (
          <View style={styles.carModelMetaRow}>
            {hasStatus && (
              <>
                <View style={[styles.carModelStatusDot, { backgroundColor: dotColor }]} />
                <Text style={[styles.carModelStatusText, { color: statusTextColor }]} numberOfLines={1}>
                  {status!.label}
                </Text>
              </>
            )}
            {hasStatus && hoursLabel && (
              <Text style={[styles.carModelMetaSep, { color: colors.textSecondary }]}>·</Text>
            )}
            {hoursLabel && (
              <Text style={[styles.carModelMetaHours, { color: colors.textSecondary }]} numberOfLines={1}>
                {hoursLabel}
              </Text>
            )}
            {(hasStatus || hoursLabel) && dishCount > 0 && (
              <Text style={[styles.carModelMetaSep, { color: colors.textSecondary }]}>·</Text>
            )}
            {dishCount > 0 && (
              <Text style={[styles.carModelMetaDish, { color: colors.textSecondary }]} numberOfLines={1}>
                {dishCount} {language === 'ar' ? 'طبق' : 'dishes'}
              </Text>
            )}
          </View>
        )}
      </View>
    </TouchableOpacity>
  );
});

export default function HomeScreen() {
  const { colors, isDark } = useTheme();
  const { t, isRTL, language } = useTranslation();
  const router = useRouter();
  const { user, addToLocalCart, pendingRatingOrderIds, removePendingRating, userRole } = useAppStore();
  const queryClient = useQueryClient();
  const { width: screenWidth } = useWindowDimensions();
  const homeProductCardWidth = useMemo(
    () => calculateCardWidth(screenWidth),
    [screenWidth],
  );
  const carModelCardWidth = useMemo(
    () => Math.round(Math.min(200, Math.max(150, screenWidth * 0.4))),
    [screenWidth],
  );
  const venueCardWidth = useMemo(
    () => Math.round(Math.min(220, Math.max(140, screenWidth * 0.37))),
    [screenWidth],
  );
  const skeletonBrandCardWidth = useMemo(
    () => Math.round(Math.min(140, Math.max(100, screenWidth * 0.27))),
    [screenWidth],
  );
  const brandCardWidth = useMemo(
    () => Math.round(Math.min(170, Math.max(130, screenWidth * 0.34))),
    [screenWidth],
  );

  // Footer config from public settings
  const { data: footerConfigRaw } = useQuery({
    queryKey: ['footer-config'],
    queryFn: async () => {
      try {
        const res = await api.get('/public/settings/footer_config');
        return res.data?.value as Record<string, any> | null;
      } catch { return null; }
    },
    staleTime: 10 * 60 * 1000,
    retry: false,
  });
  const footerConfig = footerConfigRaw ?? {};

  // On mount: validate existing pending queue against server — discard already-rated orders
  React.useEffect(() => {
    if (!user || pendingRatingOrderIds.length === 0) return;
    pendingRatingOrderIds.forEach(async (orderId) => {
      try {
        const { data } = await api.get(`/ratings/check/${orderId}`);
        if (data?.rated) removePendingRating(orderId, true);
      } catch { /* server unavailable — keep in queue */ }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The first pending rating order (show one at a time)
  const privilegedRoles = ['owner', 'admin', 'restaurant_user', 'partner'];
  const activeRatingOrderId =
    !user || privilegedRoles.includes(userRole ?? user?.role ?? '')
      ? null
      : (pendingRatingOrderIds[0] ?? null);

  // Use React Query for all data fetching
  const {
    categories,
    carBrands,
    carModels,
    productBrands,
    products,
    tireProducts: tireProductsServer,
    accessoryProducts: accessoryProductsServer,
    exteriorProducts: exteriorProductsServer,
    nonTireProducts: nonTireProductsServer,
    favorites: favoritesSet,
    banners,
    bannersLoading,
    isLoading,
    isRefetching,
    refetch,
  } = useHomeScreenQuery();

  // Venues & Hotels — fetch suppliers for the home rail
  const { data: suppliersData } = useQuery({
    queryKey: ['suppliers', 'home-rail'],
    queryFn: async () => {
      const res = await supplierApi.getAll();
      return (res.data || []).slice(0, 8);
    },
    staleTime: 5 * 60 * 1000,
  });
  const homeVenues: any[] = suppliersData || [];

  // Local state
  const [searchQuery, setSearchQuery] = useState("");
  const [isSearchFocused, setIsSearchFocused] = useState(false);
  const [restaurantFilter, setRestaurantFilter] = useState<string | null>(null);
  const [openNowFilter, setOpenNowFilter] = useState(false);
  const searchAnim = useRef(new Animated.Value(0)).current;
  const [favorites, setFavorites] = useState<Set<string>>(new Set());
  const [cartLoadingStates, setCartLoadingStates] = useState<
    Record<string, boolean>
  >({});
  const [addedToCartStates, setAddedToCartStates] = useState<
    Record<string, boolean>
  >({});

  // Sync favorites from query - with strict value comparison guard
  const prevFavoritesRef = useRef<Set<string> | null>(null);
  useEffect(() => {
    if (favoritesSet instanceof Set) {
      // Only update if the favorites set has actually changed
      const prevFavs = prevFavoritesRef.current;
      const currentFavsArray = Array.from(favoritesSet).sort();
      const prevFavsArray = prevFavs ? Array.from(prevFavs).sort() : [];

      // Deep comparison of sets
      const hasChanged =
        currentFavsArray.length !== prevFavsArray.length ||
        currentFavsArray.some((id, idx) => id !== prevFavsArray[idx]);

      if (hasChanged) {
        prevFavoritesRef.current = new Set(favoritesSet);
        setFavorites(new Set(favoritesSet));
      }
    }
  }, [favoritesSet]);

  // Sync is started globally in _layout.tsx — do not start again here

  // Three product type strips — sourced from server-filtered queries.
  // Falls back to a client-side split of the mixed list only if the server
  // queries have not yet returned (e.g. offline first paint).
  const tireProducts = useMemo(() => {
    if (Array.isArray(tireProductsServer) && tireProductsServer.length > 0) {
      return tireProductsServer;
    }
    return (products || []).filter(
      (p: any) => p.product_type === "tire" || (!p.product_type && p.is_tire),
    );
  }, [tireProductsServer, products]);
  const accessoryProducts = useMemo(() => {
    if (
      Array.isArray(accessoryProductsServer) &&
      accessoryProductsServer.length > 0
    ) {
      return accessoryProductsServer;
    }
    return (products || []).filter((p: any) => p.product_type === "accessory");
  }, [accessoryProductsServer, products]);
  const exteriorProducts = useMemo(() => {
    if (
      Array.isArray(exteriorProductsServer) &&
      exteriorProductsServer.length > 0
    ) {
      return exteriorProductsServer;
    }
    return (products || []).filter((p: any) => p.product_type === "exterior");
  }, [exteriorProductsServer, products]);
  const nonTireProducts = useMemo(() => {
    if (Array.isArray(nonTireProductsServer) && nonTireProductsServer.length > 0) {
      return nonTireProductsServer;
    }
    return (products || []).filter((p: any) => !p.is_tire);
  }, [nonTireProductsServer, products]);

  // Untyped products = main grid (deterministic: items with no product_type AND not a
  // legacy is_tire row). Filtering by attribute — not by ID-set subtraction — keeps the
  // grid correct even when typed-strip queries are paginated/capped.
  const untypedProducts = useMemo(() => {
    return (nonTireProducts || []).filter((p: any) => {
      const t = p?.product_type;
      const hasType = t === "tire" || t === "accessory" || t === "exterior";
      return !hasType && !p?.is_tire;
    });
  }, [nonTireProducts]);

  // Set of restaurant IDs that are currently open (for "Open Now" filter).
  // Prefers per-day schedule (model.hours from restaurant_hours table),
  // falls back to legacy single-window year_start/year_end.
  const openRestaurantIds = useMemo(() => {
    const ids = new Set<string>();
    carModels.forEach((model: any) => {
      const sch = Array.isArray(model.hours) && model.hours.length > 0 ? model.hours : null;
      const status = sch
        ? getOpenStatusFromSchedule(sch, language)
        : getOpenStatus(model.year_start, model.year_end, language);
      if (status?.isOpen) ids.add(model.id);
    });
    return ids;
  }, [carModels, language]);

  // True when no restaurant is currently open — used to dim the "Open Now" chip.
  const openNowChipDisabled = openRestaurantIds.size === 0 && !openNowFilter;

  // Count of untyped dishes belonging to each restaurant (for chip badges).
  // When openNowFilter is on, count only dishes from open restaurants.
  // NOTE: the products API returns the field as `car_model_ids`; `restaurant_ids`
  // is only present on responses from a handful of admin endpoints.
  const restaurantDishCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const product of untypedProducts) {
      const ids: string[] = product.car_model_ids || product.restaurant_ids || [];
      for (const id of ids) {
        if (!openNowFilter || openRestaurantIds.has(id)) {
          counts[id] = (counts[id] ?? 0) + 1;
        }
      }
    }
    return counts;
  }, [untypedProducts, openNowFilter, openRestaurantIds]);

  // Search-aware per-restaurant dish counts: same as restaurantDishCounts when
  // the search box is empty; narrows to only dishes matching the query otherwise.
  // Used by inactive chips so their badge reflects the active search filter.
  const searchAwareDishCounts = useMemo(() => {
    if (searchQuery.trim() === "") return restaurantDishCounts;
    const query = searchQuery.toLowerCase();
    const counts: Record<string, number> = {};
    for (const product of untypedProducts) {
      if (openNowFilter) {
        const ids: string[] = product.car_model_ids || product.restaurant_ids || [];
        if (!ids.some((id) => openRestaurantIds.has(id))) continue;
      }
      const name = (product.name || "").toLowerCase();
      const nameAr = (product.name_ar || "").toLowerCase();
      const sku = (product.sku || "").toLowerCase();
      if (!name.includes(query) && !nameAr.includes(query) && !sku.includes(query)) continue;
      const ids: string[] = product.car_model_ids || product.restaurant_ids || [];
      for (const id of ids) {
        if (!openNowFilter || openRestaurantIds.has(id)) {
          counts[id] = (counts[id] ?? 0) + 1;
        }
      }
    }
    return counts;
  }, [searchQuery, untypedProducts, openNowFilter, openRestaurantIds, restaurantDishCounts]);

  // Total dish count for the "All" chip badge.
  // When search is empty falls back to raw untypedProducts.length (existing behaviour).
  // When search is active, counts only products matching the query (+ openNow).
  const allChipCount = useMemo(() => {
    if (searchQuery.trim() === "") return untypedProducts.length;
    const query = searchQuery.toLowerCase();
    return untypedProducts.filter((product: any) => {
      if (openNowFilter) {
        const ids: string[] = product.car_model_ids || product.restaurant_ids || [];
        if (!ids.some((id) => openRestaurantIds.has(id))) return false;
      }
      const name = (product.name || "").toLowerCase();
      const nameAr = (product.name_ar || "").toLowerCase();
      const sku = (product.sku || "").toLowerCase();
      return name.includes(query) || nameAr.includes(query) || sku.includes(query);
    }).length;
  }, [searchQuery, untypedProducts, openNowFilter, openRestaurantIds]);

  // When "Open Now" is active, limit the restaurant cards rail and chip list
  // to only restaurants that are currently open.
  const displayedCarModels = useMemo(() => {
    if (!openNowFilter) return carModels;
    return carModels.filter((m: any) => openRestaurantIds.has(m.id));
  }, [carModels, openNowFilter, openRestaurantIds]);

  // The per-meal-type search lives inside `MealCategoryRail` now —
  // the home screen only owns the global "Search the menu" box below.

  // Search + restaurant filter (main grid shows untyped products only; the 3
  // typed strips surface tires / accessories / exterior body separately above)
  const filteredProducts = useMemo(() => {
    let list = untypedProducts;

    // Open Now filter — limit to dishes that belong to at least one open restaurant.
    // When openNowFilter is true but openRestaurantIds is empty, all dishes are excluded.
    if (openNowFilter) {
      list = list.filter((product: any) => {
        const ids: string[] = product.car_model_ids || product.restaurant_ids || [];
        return ids.some((id) => openRestaurantIds.has(id));
      });
    }

    // Restaurant chip filter
    if (restaurantFilter) {
      list = list.filter((product: any) => {
        const ids: string[] = product.car_model_ids || product.restaurant_ids || [];
        return ids.includes(restaurantFilter);
      });
    }

    if (searchQuery.trim() === "") return list;

    const query = searchQuery.toLowerCase();
    return list.filter((product: any) => {
      const name = (product.name || "").toLowerCase();
      const nameAr = (product.name_ar || "").toLowerCase();
      const sku = (product.sku || "").toLowerCase();
      return (
        name.includes(query) || nameAr.includes(query) || sku.includes(query)
      );
    });
  }, [searchQuery, untypedProducts, restaurantFilter, openNowFilter, openRestaurantIds]);

  // Search focus animation - consolidated with debounce ref to prevent rapid calls
  const searchAnimTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );

  useEffect(() => {
    // Clear any pending animation timeout
    if (searchAnimTimeoutRef.current) {
      clearTimeout(searchAnimTimeoutRef.current);
    }

    // Debounce animation to prevent rapid calls
    searchAnimTimeoutRef.current = setTimeout(() => {
      Animated.timing(searchAnim, {
        toValue: isSearchFocused ? 1 : 0,
        duration: 200,
        useNativeDriver: false,
      }).start();
    }, 50);

    return () => {
      if (searchAnimTimeoutRef.current) {
        clearTimeout(searchAnimTimeoutRef.current);
      }
    };
  }, [isSearchFocused]); // Remove searchAnim from dependencies - it's a ref and stable

  // ── Parallax driver for the cinematic hero ─────────────────────────
  // The HomeHero subscribes to this Animated.Value to translate/scale
  // its backdrop as the page scrolls.  Keep useNativeDriver: true on
  // the scroll handler so the parallax stays at 60fps.
  const heroScrollY = useRef(new Animated.Value(0)).current;
  const onHeroScroll = useMemo(
    () =>
      Animated.event(
        [{ nativeEvent: { contentOffset: { y: heroScrollY } } }],
        { useNativeDriver: true },
      ),
    [heroScrollY],
  );

  const getName = useCallback(
    (item: any) => {
      return language === "ar" && item.name_ar ? item.name_ar : item.name;
    },
    [language],
  );

  // Pre-compute brand models count map to avoid expensive filter in renderItem
  const brandModelsCountMap = useMemo(() => {
    const map: Record<string, number> = {};
    carModels.forEach((m: any) => {
      if (m.brand_id) map[m.brand_id] = (map[m.brand_id] || 0) + 1;
    });
    return map;
  }, [carModels]);

  // Restaurant id → localised name lookup, built from the already-loaded carModels
  // list (each carModel represents a restaurant in this dining app).
  const restaurantNameMap = useMemo(() => {
    const map: Record<string, string> = {};
    carModels.forEach((m: any) => {
      if (m.id) {
        map[m.id] = (language === 'ar' && m.name_ar) ? m.name_ar : (m.name || '');
      }
    });
    return map;
  }, [carModels, language]);

  // Memoized render functions for FlatLists
  const renderCarBrandItem = useCallback(
    ({ item: brand }: { item: any }) => (
      <MemoizedBrandCard
        brand={brand}
        type="car"
        modelsCount={brandModelsCountMap[brand.id] || 0}
        cardWidth={brandCardWidth}
        onPress={() => router.push(`/brand/${brand.id}`)}
      />
    ),
    [brandModelsCountMap, router, brandCardWidth],
  );

  // Fetch per-day schedules for all restaurant cards on the home screen
  const carModelIds = useMemo(
    () => carModels.map((m: any) => m.id).filter(Boolean) as string[],
    [carModels],
  );
  const restaurantHoursMap = useRestaurantHoursMap(carModelIds);

  const renderCarModelItem = useCallback(
    ({ item: model }: { item: any }) => (
      <CarModelCard
        model={model}
        colors={colors}
        getName={getName}
        cardWidth={carModelCardWidth}
        language={language}
        dishCount={restaurantDishCounts[model.id] ?? 0}
        schedule={restaurantHoursMap[model.id]}
        onPress={() => router.push(`/car/${model.id}`)}
      />
    ),
    [colors, getName, router, carModelCardWidth, language, restaurantDishCounts, restaurantHoursMap],
  );

  const renderProductBrandItem = useCallback(
    ({ item: brand }: { item: any }) => (
      <MemoizedBrandCard
        brand={{
          ...brand,
          country_of_origin: brand.country_of_origin || "Japan",
        }}
        type="product"
        cardWidth={brandCardWidth}
        onPress={() => router.push(`/brand/${brand.id}`)}
      />
    ),
    [router, brandCardWidth],
  );

  const handleAddToCart = useCallback(
    async (product: any, quantity: number = 1, fitmentIndicator?: string | null) => {
      if (!user) {
        router.push("/login");
        return;
      }

      setCartLoadingStates((prev) => ({ ...prev, [product.id]: true }));

      try {
        await cartApi.addItem(product.id, quantity, fitmentIndicator ?? undefined);
        addToLocalCart({ product_id: product.id, quantity: quantity, product, fitment_indicator: fitmentIndicator ?? null });
        queryClient.invalidateQueries({ queryKey: shoppingHubKeys.cart });
        setAddedToCartStates((prev) => ({ ...prev, [product.id]: true }));

        setTimeout(() => {
          setAddedToCartStates((prev) => ({ ...prev, [product.id]: false }));
        }, 1500);
      } catch (error) {
        console.error("Error adding to cart:", error);
      } finally {
        setCartLoadingStates((prev) => ({ ...prev, [product.id]: false }));
      }
    },
    [user, router, addToLocalCart],
  );

  const handleToggleFavorite = useCallback(
    async (productId: string) => {
      if (!user) {
        router.push("/login");
        return;
      }
      try {
        const response = await favoritesApi.toggle(productId);
        setFavorites((prev) => {
          const newSet = new Set(prev);
          if (response.data.is_favorite) {
            newSet.add(productId);
          } else {
            newSet.delete(productId);
          }
          return newSet;
        });
      } catch (error) {
        console.error("Error toggling favorite:", error);
      }
    },
    [user, router],
  );

  // Render product item
  const renderProductItem = useCallback(
    ({ item: product }: { item: any }) => {
      // Resolve all restaurant names from the already-loaded restaurantNameMap
      // for every id in product.car_model_ids — so multi-restaurant dishes show
      // all venues instead of just the first match.
      const ids: string[] = product.car_model_ids || product.restaurant_ids || [];
      const resolvedRestaurants = ids
        .map((id) => ({ id, name: restaurantNameMap[id] }))
        .filter((r): r is { id: string; name: string } => Boolean(r.name));
      const restaurantNameTag = resolvedRestaurants.map((r) => r.name);
      const restaurantIds = resolvedRestaurants.map((r) => r.id);
      return (
        <MemoizedProductCard
          product={product}
          cardWidth={homeProductCardWidth}
          restaurantNameTag={restaurantNameTag.length > 0 ? restaurantNameTag : undefined}
          restaurantIds={restaurantIds.length > 0 ? restaurantIds : undefined}
          onAddToCart={(quantity: number, fitmentIndicator?: string | null) =>
            handleAddToCart(product, quantity, fitmentIndicator)
          }
        />
      );
    },
    [handleAddToCart, homeProductCardWidth, restaurantNameMap],
  );

  // Loading state
  if (isLoading) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <Header showBack={false} />
        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={styles.scrollContent}
        >
          <View style={styles.section}>
            <View
              style={[styles.sectionHeader, isRTL && styles.sectionHeaderRTL]}
            >
              <Skeleton width={135} height={30} />
              <Skeleton width={70} height={19} />
            </View>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.horizontalScroll}
            >
              {[1, 2, 3, 4].map((i) => (
                <View
                  key={i}
                  style={[
                    styles.brandCard,
                    {
                      width: skeletonBrandCardWidth,
                      height: skeletonBrandCardWidth,
                      backgroundColor: colors.card,
                      borderColor: colors.border,
                    },
                  ]}
                >
                  <Skeleton
                    width={50}
                    height={50}
                    borderRadius={25}
                    style={{ marginBottom: 9 }}
                  />
                  <Skeleton width={75} height={17} />
                </View>
              ))}
            </ScrollView>
          </View>
          <View style={styles.sliderSection}>
            <View
              style={[styles.sectionHeader, isRTL && styles.sectionHeaderRTL]}
            >
              <Skeleton width={155} height={30} />
            </View>
            <Skeleton
              height={170}
              borderRadius={12}
              style={{ marginHorizontal: 16 }}
            />
          </View>
          <View style={styles.section}>
            <View
              style={[styles.sectionHeader, isRTL && styles.sectionHeaderRTL]}
            >
              <Skeleton width={80} height={20} />
              <Skeleton width={60} height={16} />
            </View>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.horizontalScroll}
            >
              {[1, 2, 3].map((i) => (
                <ProductCardSkeleton key={i} />
              ))}
            </ScrollView>
          </View>
        </ScrollView>
      </View>
    );
  }

  const searchBorderColor = searchAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [colors.border, colors.primary],
  });

  return (
    <View style={styles.container}>
      <LinearGradient
        colors={isDark ? GRADIENTS.homeBackdropDark : GRADIENTS.homeBackdropLight}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      {Platform.OS !== "web" && (
        <BlurView
          intensity={15}
          tint={isDark ? "dark" : "light"}
          style={[StyleSheet.absoluteFill, styles.blurOverlay]}
        />
      )}
      <View
        style={[
          styles.glassOverlay,
          {
            backgroundColor: isDark
              ? OVERLAYS.glassWashDark
              : OVERLAYS.glassWashLight,
          },
        ]}
      />

      <Header showBack={false} />

      <Animated.ScrollView
        style={[styles.scrollView, { backgroundColor: "transparent" }]}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={isRefetching}
            onRefresh={refetch}
            tintColor={colors.primary}
          />
        }
        keyboardShouldPersistTaps="handled"
        scrollEventThrottle={16}
        onScroll={onHeroScroll}
      >
        {/* 1. Cinematic "Today at Al-Ghazaly" hero with parallax. */}
        <HomeHero
          scrollY={heroScrollY}
          onCtaPress={() => router.push("/cart")}
          onExplorePress={() => router.push("/search")}
        />

        {/* 2. Chef's Special — auto-cycling ken-burns spotlight. */}
        <View style={styles.sliderSection}>
          <MagazineSectionHeader
            eyebrow={language === "ar" ? "اختيار الشيف" : "TONIGHT'S TABLE"}
            title={
              language === "ar" ? "اختيار الشيف" : "Chef's Special"
            }
            caption={
              language === "ar"
                ? "إصدار جديد كل ليلة، يجمعه الشيف بنفسه."
                : "A new edition each evening, plated by the chef."
            }
          />
          <ChefsSpecialSpotlight />
        </View>

        {/* 3. Cuisines rail (formerly Car Brands). */}
        <View style={styles.section}>
          <MagazineSectionHeader
            eyebrow={language === "ar" ? "المأكولات" : "CUISINES"}
            title={t("carBrands") as string}
            caption={
              language === "ar"
                ? "تنوع عالمي يعكس مطبخ الغزالي."
                : "A globe-spanning palette under one roof."
            }
            ctaLabel={t("viewAll") as string}
            onCtaPress={() => router.push("/car-brands")}
          />
          <FlatList
            data={carBrands}
            renderItem={renderCarBrandItem}
            keyExtractor={(item) => item.id}
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.horizontalScroll}
            initialNumToRender={5}
            maxToRenderPerBatch={8}
            windowSize={3}
            removeClippedSubviews={true}
            inverted={isRTL}
          />
        </View>

        {/* 4. Restaurants (Car Models). */}
        {carModels.length > 0 && (
          <View style={styles.section}>
            <MagazineSectionHeader
              eyebrow={language === "ar" ? "صالاتنا" : "DINING ROOMS"}
              title={language === "ar" ? "مطاعمنا" : "Our Restaurants"}
              caption={
                openNowFilter
                  ? language === "ar"
                    ? `${displayedCarModels.length} مطعم مفتوح الآن`
                    : `${displayedCarModels.length} open now`
                  : language === "ar"
                  ? "أجواء مختارة بعناية لكل مناسبة."
                  : "Hand-curated rooms for every occasion."
              }
              ctaLabel={t("viewAll") as string}
              onCtaPress={() => router.push("/models")}
            />
            <FlatList
              data={displayedCarModels.slice(0, 10)}
              renderItem={renderCarModelItem}
              keyExtractor={(item) => item.id}
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.horizontalScroll}
              initialNumToRender={5}
              maxToRenderPerBatch={5}
              windowSize={3}
              removeClippedSubviews={true}
              inverted={isRTL}
            />
          </View>
        )}

        {/* 5. Combo Meals (Product Brands). */}
        <View style={styles.section}>
          <MagazineSectionHeader
            eyebrow={language === "ar" ? "وجبات الكومبو" : "COMBO MEALS"}
            title={t("productBrands") as string}
            caption={
              language === "ar"
                ? "تشكيلات معدّة لتجارب مكتملة."
                : "Pairings designed for full tastings."
            }
            ctaLabel={t("viewAll") as string}
            onCtaPress={() => router.push("/brands")}
          />
          <FlatList
            data={productBrands}
            renderItem={renderProductBrandItem}
            keyExtractor={(item) => item.id}
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.horizontalScroll}
            initialNumToRender={5}
            maxToRenderPerBatch={8}
            windowSize={3}
            removeClippedSubviews={true}
            inverted={isRTL}
          />
        </View>

        {/* 5b. Venues & Hotels — horizontal rail from suppliers */}
        {homeVenues.length > 0 && (
          <View style={styles.section}>
            <MagazineSectionHeader
              eyebrow={language === "ar" ? "فنادق وقاعات" : "VENUES & HOTELS"}
              title={language === "ar" ? "أماكن راقية" : "Luxury Venues"}
              caption={
                language === "ar"
                  ? "فنادق وقاعات مختارة لأرقى المناسبات."
                  : "Handpicked venues for the finest occasions."
              }
              ctaLabel={t("viewAll") as string}
              onCtaPress={() => router.push("/owner/suppliers")}
            />
            <FlatList
              data={homeVenues}
              keyExtractor={(item) => item.id}
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.horizontalScroll}
              inverted={isRTL}
              renderItem={({ item }) => {
                const name = language === "ar" && item.name_ar ? item.name_ar : item.name;
                const addr = language === "ar" && item.address_ar ? item.address_ar : item.address;
                return (
                  <TouchableOpacity
                    style={[styles.venueCard, { width: venueCardWidth, backgroundColor: colors.card, borderColor: colors.border }]}
                    onPress={() => router.push("/owner/suppliers")}
                    activeOpacity={0.75}
                  >
                    {item.profile_image ? (
                      <Image source={{ uri: item.profile_image }} style={styles.venueCardImage} contentFit="cover" />
                    ) : (
                      <View style={[styles.venueCardImagePlaceholder, { backgroundColor: colors.primary + '20' }]}>
                        <Ionicons name="bed-outline" size={32} color={colors.primary} />
                      </View>
                    )}
                    <View style={styles.venueCardBody}>
                      <Text style={[styles.venueCardName, { color: colors.text }]} numberOfLines={1}>{name}</Text>
                      {addr ? (
                        <Text style={[styles.venueCardAddr, { color: colors.textSecondary }]} numberOfLines={1}>{addr}</Text>
                      ) : null}
                    </View>
                  </TouchableOpacity>
                );
              }}
            />
          </View>
        )}

        {/* 6. Tasting Room — chip-toggled rail for the three meal types. */}
        <MealCategoryRail
          categories={[
            {
              key: "tire",
              label_en: "Family Meals",
              label_ar: "وجبات عائلية",
              icon: "people",
              list: tireProducts,
              empty_en: "No family meals found",
              empty_ar: "لا توجد وجبات",
              placeholder_en: "Search family meals...",
              placeholder_ar: "ابحث عن وجبة عائلية...",
            },
            {
              key: "accessory",
              label_en: "Drinks",
              label_ar: "المشروبات",
              icon: "wine",
              list: accessoryProducts,
              empty_en: "No drinks found",
              empty_ar: "لا توجد مشروبات",
              placeholder_en: "Search drinks...",
              placeholder_ar: "ابحث عن مشروب...",
            },
            {
              key: "exterior",
              label_en: "Additions",
              label_ar: "الإضافات",
              icon: "restaurant",
              list: exteriorProducts,
              empty_en: "No additions found",
              empty_ar: "لا توجد إضافات",
              placeholder_en: "Search additions...",
              placeholder_ar: "ابحث عن إضافة...",
            },
          ]}
          renderProduct={renderProductItem}
          onViewAll={(key) => router.push(`/search?product_type=${key}`)}
        />

        {/* 7. Dishes Section */}
        {untypedProducts.length > 0 && (
          <View style={styles.section}>
            <MagazineSectionHeader
              eyebrow={language === "ar" ? "أطباقنا" : "DISHES"}
              title={t("products") as string}
              caption={
                openNowFilter || restaurantFilter || searchQuery
                  ? language === "ar"
                    ? `${filteredProducts.length} نتيجة`
                    : `${filteredProducts.length} results`
                  : undefined
              }
              ctaLabel={t("viewAll") as string}
              onCtaPress={() => router.push("/search")}
            />

            {/* Restaurant filter chip strip */}
            {carModels.length > 0 && (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={[
                  styles.restaurantChipsContent,
                  { flexDirection: isRTL ? "row-reverse" : "row" },
                ]}
              >
                {/* "Open Now" chip — dimmed and non-interactive when no restaurants are open */}
                <TouchableOpacity
                  disabled={openNowChipDisabled}
                  style={[
                    styles.restaurantChip,
                    {
                      backgroundColor: openNowFilter
                        ? "#22c55e"
                        : isDark
                        ? "rgba(255,255,255,0.08)"
                        : "rgba(0,0,0,0.06)",
                      borderColor: openNowFilter
                        ? "#22c55e"
                        : "#22c55e66",
                      opacity: openNowChipDisabled ? 0.4 : 1,
                    },
                  ]}
                  onPress={() => {
                    const turningOn = !openNowFilter;
                    setOpenNowFilter(turningOn);
                    if (turningOn && restaurantFilter && !openRestaurantIds.has(restaurantFilter)) {
                      setRestaurantFilter(null);
                    }
                  }}
                  activeOpacity={0.75}
                >
                  <Ionicons
                    name="time-outline"
                    size={12}
                    color={openNowFilter ? "#1a1a1a" : "#22c55e"}
                    style={{ marginRight: isRTL ? 0 : 3, marginLeft: isRTL ? 3 : 0 }}
                  />
                  <Text
                    style={[
                      styles.restaurantChipLabel,
                      { color: openNowFilter ? "#1a1a1a" : colors.text },
                    ]}
                  >
                    {language === "ar"
                      ? `مفتوح الآن · ${openRestaurantIds.size}`
                      : `Open Now · ${openRestaurantIds.size}`}
                  </Text>
                </TouchableOpacity>

                {/* "All" chip */}
                <TouchableOpacity
                  style={[
                    styles.restaurantChip,
                    {
                      backgroundColor:
                        restaurantFilter === null && !openNowFilter
                          ? colors.primary
                          : isDark
                          ? "rgba(255,255,255,0.08)"
                          : "rgba(0,0,0,0.06)",
                      borderColor:
                        restaurantFilter === null && !openNowFilter
                          ? colors.primary
                          : colors.primary + "40",
                    },
                  ]}
                  onPress={() => {
                    setRestaurantFilter(null);
                    setOpenNowFilter(false);
                  }}
                  activeOpacity={0.75}
                >
                  <Text
                    style={[
                      styles.restaurantChipLabel,
                      {
                        color:
                          restaurantFilter === null && !openNowFilter
                            ? "#1a1a1a"
                            : colors.text,
                      },
                    ]}
                  >
                    {language === "ar" ? "الكل" : "All"}
                  </Text>
                  {allChipCount > 0 && (
                    <Text
                      style={[
                        styles.restaurantChipCount,
                        {
                          color:
                            restaurantFilter === null && !openNowFilter
                              ? "rgba(26,26,26,0.65)"
                              : colors.textSecondary,
                        },
                      ]}
                    >
                      {allChipCount}
                    </Text>
                  )}
                </TouchableOpacity>

                {displayedCarModels.map((model: any) => {
                  const active = restaurantFilter === model.id;
                  const name = getName(model);
                  const dishCount = searchAwareDishCounts[model.id] ?? 0;
                  const badgeCount = active ? filteredProducts.length : dishCount;
                  return (
                    <TouchableOpacity
                      key={model.id}
                      style={[
                        styles.restaurantChip,
                        {
                          backgroundColor: active
                            ? colors.primary
                            : isDark
                            ? "rgba(255,255,255,0.08)"
                            : "rgba(0,0,0,0.06)",
                          borderColor: active
                            ? colors.primary
                            : colors.primary + "40",
                        },
                      ]}
                      onPress={() =>
                        setRestaurantFilter(active ? null : model.id)
                      }
                      activeOpacity={0.75}
                    >
                      <Text
                        style={[
                          styles.restaurantChipLabel,
                          { color: active ? "#1a1a1a" : colors.text },
                        ]}
                        numberOfLines={1}
                      >
                        {name}
                      </Text>
                      {badgeCount > 0 && (
                        <Text
                          style={[
                            styles.restaurantChipCount,
                            {
                              color: active
                                ? "rgba(26,26,26,0.65)"
                                : colors.textSecondary,
                            },
                          ]}
                        >
                          {badgeCount}
                        </Text>
                      )}
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            )}

            {filteredProducts.length > 0 ? (
              <FlatList
                data={filteredProducts.slice(0, 20)}
                renderItem={renderProductItem}
                keyExtractor={(item) => item.id}
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.horizontalScroll}
                initialNumToRender={4}
                maxToRenderPerBatch={6}
                windowSize={3}
                removeClippedSubviews={true}
                inverted={isRTL}
              />
            ) : (
              <Text
                style={[
                  styles.emptyDishes,
                  {
                    color: colors.textSecondary,
                    textAlign: isRTL ? "right" : "left",
                  },
                ]}
              >
                {openNowFilter && restaurantFilter
                  ? language === "ar"
                    ? "لا توجد أطباق لهذا المطعم في وقت الفتح"
                    : "No open dishes for this restaurant"
                  : openNowFilter
                  ? language === "ar"
                    ? "لا توجد مطاعم مفتوحة الآن"
                    : "No restaurants open right now"
                  : restaurantFilter && searchQuery
                  ? language === "ar"
                    ? "لا توجد نتائج لهذا المطعم والبحث"
                    : "No results for this restaurant and search"
                  : restaurantFilter
                  ? language === "ar"
                    ? "لا توجد أطباق لهذا المطعم"
                    : "No dishes for this restaurant"
                  : language === "ar"
                  ? "لا توجد نتائج"
                  : "No results found"}
              </Text>
            )}
          </View>
        )}

        {/* 8. Search Bar */}
        <View style={styles.searchSection}>
          <MagazineSectionHeader
            eyebrow={language === "ar" ? "البحث" : "SEARCH"}
            title={language === "ar" ? "ابحث في القائمة" : "Search the menu"}
            caption={
              language === "ar"
                ? "أطباق، مشروبات، أو أرقام التشكيلة."
                : "Dishes, drinks, or SKU numbers."
            }
          />
          <Animated.View
            style={[
              styles.searchInputContainer,
              {
                backgroundColor: colors.surface,
                borderColor: searchBorderColor,
                flexDirection: isRTL ? "row-reverse" : "row",
              },
            ]}
          >
            <Ionicons
              name="search"
              size={18}
              color={isSearchFocused ? colors.primary : colors.textSecondary}
            />
            <TextInput
              style={[
                styles.searchInput,
                {
                  color: colors.text,
                  fontFamily: FONTS.body,
                  textAlign: isRTL ? "right" : "left",
                },
              ]}
              placeholder={
                language === "ar"
                  ? "ادخل اسم الطبق أو كود التشكيلة..."
                  : "Enter dish name or SKU..."
              }
              placeholderTextColor={colors.textSecondary}
              value={searchQuery}
              onChangeText={setSearchQuery}
              onFocus={() => setIsSearchFocused(true)}
              onBlur={() => setIsSearchFocused(false)}
              returnKeyType="search"
            />
            {searchQuery.length > 0 && (
              <TouchableOpacity
                onPress={() => {
                  setSearchQuery("");
                  Keyboard.dismiss();
                }}
                style={styles.clearButton}
              >
                <Ionicons
                  name="close-circle"
                  size={18}
                  color={colors.textSecondary}
                />
              </TouchableOpacity>
            )}
          </Animated.View>

          {searchQuery.length > 0 && (
            <View style={styles.searchResults}>
              <Ionicons
                name={
                  filteredProducts.length > 0
                    ? "checkmark-circle"
                    : "alert-circle"
                }
                size={16}
                color={
                  filteredProducts.length > 0 ? colors.success : colors.error
                }
              />
              <Text
                style={[
                  styles.searchResultsText,
                  {
                    color:
                      filteredProducts.length > 0
                        ? colors.success
                        : colors.error,
                  },
                ]}
              >
                {filteredProducts.length > 0
                  ? language === "ar"
                    ? `تم العثور على ${filteredProducts.length} منتج`
                    : `Found ${filteredProducts.length} products`
                  : language === "ar"
                    ? "لا توجد نتائج"
                    : "No results found"}
              </Text>
            </View>
          )}
        </View>

        <View style={{ height: 20 }} />

        {/* 9. Promotional Banners — animated carousel */}
        {(bannersLoading || banners.length > 0) && (
          <View style={styles.bannersSection}>
            <MagazineSectionHeader
              eyebrow={language === "ar" ? "المجلة" : "THE JOURNAL"}
              title={
                language === "ar" ? "اخبار ومقالات خاصة" : "Stories & Specials"
              }
              caption={
                language === "ar"
                  ? "أحدث ما يدور في صالات الغزالي."
                  : "The latest from inside Al-Ghazaly."
              }
            />
            <OfferSliderCarousel
              banners={banners}
              isLoading={bannersLoading}
            />
          </View>
        )}

        {/* 10. Global Ratings Strip */}
        {footerConfig.show_ratings_strip !== false && (
          <GlobalRatingsStrip />
        )}

        {/* 11. Social Media Strip */}
        {footerConfig.show_social_strip !== false && (
          <SocialMediaStrip config={footerConfig} />
        )}

        {/* 12. Optional Brand Video */}
        {footerConfig.show_video && footerConfig.video_url ? (
          <FooterVideo videoUrl={footerConfig.video_url} />
        ) : null}

        {/* 13. Footer Info Rows */}
        {footerConfig.show_info_rows !== false && (
          <FooterInfoRows config={footerConfig} />
        )}

        <View style={{ height: 120 }} />
      </Animated.ScrollView>

      {/* Post-delivery Rating Modal */}
      <RatingModal
        orderId={activeRatingOrderId}
        onClose={(submitted?: boolean) => {
          if (activeRatingOrderId) {
            removePendingRating(activeRatingOrderId, submitted === true);
          }
        }}
      />

      <InteractiveCarSelector />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.charcoalDeep,
  },
  blurOverlay: {
    zIndex: 0,
  },
  glassOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: OVERLAYS.glassWashDark,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: 19,
  },
  section: {
    marginTop: 19,
  },
  sliderSection: {
    marginTop: 7,
  },
  sectionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 37.9,
    marginBottom: 5,
  },
  sectionHeaderRTL: {
    flexDirection: "row-reverse",
  },
  horizontalScroll: {
    paddingHorizontal: 1,
  },
  brandCard: {
    borderRadius: 12,
    borderWidth: 1.9,
    alignItems: "center",
    justifyContent: "center",
    marginHorizontal: 10,
  },
  venueCard: {
    borderRadius: 12,
    borderWidth: 1,
    marginHorizontal: 6,
    overflow: "hidden",
  },
  venueCardImage: { width: "100%", height: 100 },
  venueCardImagePlaceholder: { width: "100%", height: 100, alignItems: "center", justifyContent: "center" },
  venueCardBody: { padding: 8 },
  venueCardName: { fontSize: 13, fontWeight: "700", marginBottom: 2 },
  venueCardAddr: { fontSize: 11 },
  carModelCard: {
    borderRadius: 14,
    borderWidth: 1.5,
    marginHorizontal: 2,
    overflow: "hidden",
  },
  carModelImageContainer: {
    width: "100%",
    aspectRatio: 1.45,
    overflow: "hidden",
  },
  carModelImagePlaceholder: {
    width: "100%",
    height: "100%",
    justifyContent: "center",
    alignItems: "center",
  },
  carModelImage: {
    width: "100%",
    height: "100%",
  },
  carModelDishBadge: {
    position: "absolute",
    bottom: 6,
    right: 6,
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    backgroundColor: "rgba(0,0,0,0.68)",
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 20,
  },
  carModelDishBadgeText: {
    fontSize: 10,
    fontWeight: "700",
    color: "#FFF",
  },
  carModelInfo: {
    paddingHorizontal: 10,
    paddingTop: 7,
    paddingBottom: 9,
    gap: 3,
  },
  carModelName: {
    fontSize: 13,
    fontWeight: "700",
    letterSpacing: 0.1,
  },
  carModelMetaRow: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "nowrap",
    gap: 4,
    minHeight: 14,
  },
  carModelStatusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    flexShrink: 0,
  },
  carModelStatusText: {
    fontSize: 10,
    fontWeight: "700",
    flexShrink: 0,
  },
  carModelMetaSep: {
    fontSize: 9,
    fontWeight: "400",
    flexShrink: 0,
    opacity: 0.5,
  },
  carModelMetaHours: {
    fontSize: 10,
    fontWeight: "500",
    flexShrink: 1,
  },
  carModelMetaDish: {
    fontSize: 10,
    fontWeight: "500",
    flexShrink: 0,
  },
  searchSection: {
    marginTop: SPACING.lg,
    paddingHorizontal: SPACING.xl,
  },
  searchInputContainer: {
    alignItems: "center",
    borderWidth: 1,
    borderRadius: RADII.lg,
    paddingHorizontal: SPACING.md,
    height: 50,
    gap: SPACING.sm,
    ...ELEVATION.resting,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
  },
  clearButton: {
    padding: SPACING.xxs,
  },
  searchResults: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 10,
    gap: 6,
  },
  searchResultsText: {
    fontSize: 13,
    fontWeight: "500",
  },
  bannersSection: {
    marginTop: 19,
    paddingHorizontal: 10,
  },
  restaurantChipsContent: {
    paddingHorizontal: SPACING.xl,
    paddingBottom: SPACING.md,
    gap: SPACING.sm,
  },
  restaurantChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: SPACING.xs,
    paddingVertical: SPACING.sm,
    paddingHorizontal: SPACING.lg,
    borderRadius: RADII.pill,
    borderWidth: 1,
  },
  restaurantChipLabel: {
    fontSize: 12,
    fontWeight: "600",
    letterSpacing: 0.2,
  },
  restaurantChipCount: {
    fontSize: 11,
    fontWeight: "600",
    letterSpacing: 0.2,
  },
  emptyDishes: {
    paddingHorizontal: SPACING.xl,
    paddingVertical: SPACING.md,
    fontSize: 14,
  },
});
