import React, { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  Dimensions,
  Modal,
} from 'react-native';
import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, {
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
  interpolate,
  Extrapolation,
} from 'react-native-reanimated';
import { Header } from '../../src/components/Header';
import { Footer } from '../../src/components/Footer';
import { useTheme } from '../../src/hooks/useTheme';
import { useTranslation } from '../../src/hooks/useTranslation';
import { carBrandsApi, carModelsApi, api } from '../../src/services/api';
import { TYPE, SPACING, RADII, ELEVATION, GRADIENTS } from '../../src/constants/luxuryTokens';
import { useRestaurantRatingSummaries } from '../../src/hooks/queries';
import { useAppStore } from '../../src/store/appStore';

const SCREEN_WIDTH = Dimensions.get('window').width;
const HERO_HEIGHT = 360;
const AnimatedScroll = Animated.ScrollView;

interface BrandPageConfig {
  bg_image?: string;
  title_en?: string;
  title_ar?: string;
  subtitle_en?: string;
  subtitle_ar?: string;
  count_label_en?: string;
  count_label_ar?: string;
  cta_label_en?: string;
  cta_label_ar?: string;
}

export default function CuisineRestaurantsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { colors, isDark } = useTheme();
  const { isRTL, language } = useTranslation();
  const router = useRouter();

  const { cartItems, addToLocalCart, clearCart } = useAppStore();

  const [brand, setBrand] = useState<any>(null);
  const [models, setModels] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [pageConfig, setPageConfig] = useState<BrandPageConfig | null>(null);
  const [nutritionExpanded, setNutritionExpanded] = useState(false);
  const [brandNutrition, setBrandNutrition] = useState<{ avgCalories: number; maxCalories: number; itemsWithCalories: number; totalItems: number } | null>(null);
  const [brandProducts, setBrandProducts] = useState<any[]>([]);
  const [addingToCart, setAddingToCart] = useState(false);
  const [conflictModal, setConflictModal] = useState(false);
  const pendingAddRef = React.useRef<null | (() => void)>(null);

  const hasComboInCart = useMemo(() => {
    if (!Array.isArray(cartItems) || cartItems.length === 0) return false;
    const currentBrandId = id as string | undefined;
    if (!currentBrandId) return false;
    return cartItems.some((it: any) => {
      const itemBrand = it?.product?.car_brand_id ?? it?.car_brand_id ?? null;
      return itemBrand === currentBrandId;
    });
  }, [cartItems, id]);

  const guardedAdd = React.useCallback((fn: () => void) => {
    if (hasComboInCart) {
      pendingAddRef.current = fn;
      setConflictModal(true);
    } else {
      fn();
    }
  }, [hasComboInCart]);

  // Stock-aware: hide / disable items that are explicitly out of stock.
  const isInStock = (p: any): boolean => {
    if (p == null) return true;
    if (p.in_stock === false) return false;
    if (typeof p.stock === 'number') return p.stock > 0;
    if (typeof p.stock_quantity === 'number') return p.stock_quantity > 0;
    return true;
  };

  const modelIds = useMemo(() => models.map((m: any) => m.id as string), [models]);
  const { data: ratingSummaries = {} } = useRestaurantRatingSummaries(modelIds);

  // Cuisine-level aggregate rating — weighted average across all rated restaurants.
  const cuisineRating = useMemo(() => {
    const entries = Object.values(ratingSummaries) as { avg_rating: number; review_count: number }[];
    const rated = entries.filter(s => s.review_count > 0);
    if (rated.length === 0) return null;
    const totalReviews = rated.reduce((s, e) => s + e.review_count, 0);
    const weightedSum = rated.reduce((s, e) => s + e.avg_rating * e.review_count, 0);
    return { avg: weightedSum / totalReviews, count: totalReviews, restaurantCount: rated.length };
  }, [ratingSummaries]);

  useEffect(() => {
    api.get('/public/settings/brand_page_config')
      .then(res => { if (res.data?.value) setPageConfig(res.data.value as BrandPageConfig); })
      .catch(() => {});
  }, []);

  const scrollY = useSharedValue(0);
  const scrollHandler = useAnimatedScrollHandler({
    onScroll: (event) => {
      scrollY.value = event.contentOffset.y;
    },
  });

  const fetchData = async () => {
    try {
      const [brandsRes, modelsRes] = await Promise.all([
        carBrandsApi.getAll(),
        carModelsApi.getAll(id as string),
      ]);
      const foundBrand = brandsRes.data.find((b: any) => b.id === id);
      setBrand(foundBrand);
      const loadedModels = modelsRes.data || [];
      setModels(loadedModels);
      // Fetch products for nutritional data and "Add All to Cart"
      if (id) {
        api.get(`/products?car_brand_id=${id}&limit=200`)
          .then((res) => {
            // Endpoint returns { products: [...] } (paginated), not a bare array.
            const raw: any = res.data;
            const products: any[] = Array.isArray(raw) ? raw : (raw?.products ?? []);
            setBrandProducts(products);
            const withCalories = products.filter((p: any) => p.calories && p.calories > 0);
            if (withCalories.length > 0) {
              const avg = Math.round(withCalories.reduce((sum: number, p: any) => sum + p.calories, 0) / withCalories.length);
              const max = Math.max(...withCalories.map((p: any) => p.calories));
              setBrandNutrition({ avgCalories: avg, maxCalories: max, itemsWithCalories: withCalories.length, totalItems: products.length });
            } else {
              setBrandNutrition(null);
            }
          })
          .catch(() => {});
      }
    } catch (error) {
      console.error('Error fetching cuisine data:', error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [id]);

  const onRefresh = () => {
    setRefreshing(true);
    fetchData();
  };

  const getName = (item: any, field: string = 'name') => {
    if (!item) return '';
    const arField = `${field}_ar`;
    return language === 'ar' && item?.[arField] ? item[arField] : item?.[field] || '';
  };

  const heroImageStyle = useAnimatedStyle(() => ({
    transform: [
      {
        translateY: interpolate(
          scrollY.value,
          [-HERO_HEIGHT, 0, HERO_HEIGHT],
          [-HERO_HEIGHT / 2, 0, HERO_HEIGHT * 0.6],
          Extrapolation.CLAMP,
        ),
      },
      {
        scale: interpolate(
          scrollY.value,
          [-HERO_HEIGHT, 0, HERO_HEIGHT],
          [1.4, 1, 1.05],
          Extrapolation.CLAMP,
        ),
      },
    ],
  }));

  const heroOverlayStyle = useAnimatedStyle(() => ({
    opacity: interpolate(
      scrollY.value,
      [0, HERO_HEIGHT * 0.6],
      [0, 0.6],
      Extrapolation.CLAMP,
    ),
  }));

  if (loading) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <Header title="" showBack={true} />
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
        <Footer />
      </View>
    );
  }

  // Brand not found — show a graceful 404 state instead of blank parallax hero.
  if (!brand) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <Header title={language === 'ar' ? 'مطبخ غير موجود' : 'Cuisine Not Found'} showBack={true} />
        <View style={styles.loadingContainer}>
          <Ionicons name="restaurant-outline" size={64} color={colors.textSecondary} />
          <Text style={{ color: colors.textSecondary, fontSize: 16, marginTop: 16, textAlign: 'center' }}>
            {language === 'ar' ? 'لم يتم العثور على هذا المطبخ' : 'This cuisine could not be found.'}
          </Text>
        </View>
        <Footer />
      </View>
    );
  }

  const heroImage = brand?.image || brand?.logo || pageConfig?.bg_image;
  const restaurantsLabel = pageConfig?.count_label_ar && language === 'ar'
    ? pageConfig.count_label_ar
    : pageConfig?.count_label_en && language !== 'ar'
      ? pageConfig.count_label_en
      : (language === 'ar' ? 'مطعم' : models.length === 1 ? 'Restaurant' : 'Restaurants');
  const cuisineLabel = pageConfig
    ? (language === 'ar' ? (pageConfig.title_ar || 'مطبخ مميز') : (pageConfig.title_en || 'Featured Cuisine'))
    : (language === 'ar' ? 'مطبخ مميز' : 'Featured Cuisine');
  const storyTitle = language === 'ar' ? 'حكاية المطبخ' : 'About this cuisine';
  const configSubtitle = pageConfig
    ? (language === 'ar' ? (pageConfig.subtitle_ar || '') : (pageConfig.subtitle_en || ''))
    : '';
  const storyCopy = configSubtitle ||
    getName(brand, 'description') ||
    (language === 'ar'
      ? 'مجموعة منتقاة من أشهر مطاعمنا التي تحتفي بأصالة هذا المطبخ، حيث تلتقي النكهات الكلاسيكية بحرفية الطهاة المعاصرين.'
      : 'A curated collection of our finest restaurants celebrating the soul of this cuisine — classic flavours reimagined by today\'s most thoughtful chefs.');
  const restaurantsHeader = language === 'ar' ? 'مطاعمنا' : 'Our Restaurants';
  const stars = cuisineRating ? Math.round(cuisineRating.avg) : 0;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <Header title={getName(brand)} showBack={true} />

      <AnimatedScroll
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        onScroll={scrollHandler}
        scrollEventThrottle={16}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={colors.primary}
            progressViewOffset={HERO_HEIGHT}
          />
        }
      >
        {/* ─── Parallax hero ─────────────────────────────────────────────── */}
        <View style={styles.heroWrapper}>
          <Animated.View style={[StyleSheet.absoluteFill, heroImageStyle]}>
            {heroImage ? (
              <Image
                source={{ uri: heroImage }}
                style={styles.heroImage}
                contentFit="cover"
                cachePolicy="memory-disk"
                transition={200}
              />
            ) : (
              <LinearGradient
                colors={GRADIENTS.midnightBistro}
                style={StyleSheet.absoluteFill}
              />
            )}
          </Animated.View>

          {/* Gradient veil for legibility */}
          <LinearGradient
            colors={['rgba(11,11,14,0.0)', 'rgba(11,11,14,0.45)', 'rgba(11,11,14,0.92)']}
            locations={[0, 0.55, 1]}
            style={StyleSheet.absoluteFill}
            pointerEvents="none"
          />
          {/* Scroll-amplified veil */}
          <Animated.View
            style={[
              StyleSheet.absoluteFill,
              { backgroundColor: '#0B0B0E' },
              heroOverlayStyle,
            ]}
            pointerEvents="none"
          />

          <View style={[styles.heroContent, isRTL && styles.heroContentRTL]}>
            <Text style={styles.heroEyebrow}>{cuisineLabel.toUpperCase()}</Text>
            <Text style={styles.heroTitle}>{getName(brand)}</Text>
            <View style={styles.heroMetaRow}>
              <View style={styles.heroDot} />
              <Text style={styles.heroMeta}>
                {models.length} {restaurantsLabel}
              </Text>
            </View>
          </View>
        </View>

        {/* ─── Body content with rounded top edge over hero ──────────────── */}
        <View
          style={[
            styles.bodySheet,
            { backgroundColor: colors.background },
          ]}
        >
          {/* Story block */}
          <View style={styles.storyBlock}>
            <View style={styles.sectionLabelRow}>
              <View style={[styles.rule, { backgroundColor: colors.primary }]} />
              <Text style={[styles.sectionLabel, { color: colors.primary }]}>
                {language === 'ar' ? 'الحكاية' : 'The Story'}
              </Text>
              <View style={[styles.rule, { backgroundColor: colors.primary }]} />
            </View>
            <Text style={[styles.storyTitle, { color: colors.text }]}>
              {storyTitle}
            </Text>
            <Text style={[styles.storyBody, { color: colors.textSecondary }]}>
              {storyCopy}
            </Text>
          </View>

          {/* Restaurants list */}
          <View style={styles.restaurantsSection}>
            <View style={{ flexDirection: isRTL ? 'row-reverse' : 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: SPACING.lg }}>
              <Text style={[styles.sectionTitle, { color: colors.text, marginBottom: 0 }]}>
                {restaurantsHeader}
              </Text>
              {cuisineRating && (
                <View style={{ flexDirection: isRTL ? 'row-reverse' : 'row', alignItems: 'center', gap: 5,
                               backgroundColor: 'rgba(245,158,11,0.12)', borderRadius: 12, paddingHorizontal: 10, paddingVertical: 5,
                               borderWidth: 1, borderColor: 'rgba(245,158,11,0.35)' }}>
                  {[1,2,3,4,5].map(n => (
                    <Ionicons key={n} name={n <= stars ? 'star' : 'star-outline'} size={12} color="#F59E0B" />
                  ))}
                  <Text style={{ color: '#F59E0B', fontSize: 12, fontWeight: '700', marginLeft: 2 }}>
                    {cuisineRating.avg.toFixed(1)}
                  </Text>
                  <Text style={{ color: colors.textSecondary, fontSize: 11 }}>
                    ({cuisineRating.count})
                  </Text>
                </View>
              )}
            </View>

            {models.length === 0 ? (
              <View style={styles.emptyContainer}>
                <Ionicons name="restaurant-outline" size={56} color={colors.textSecondary} />
                <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
                  {language === 'ar' ? 'لا توجد مطاعم متاحة حالياً' : 'No restaurants available yet'}
                </Text>
              </View>
            ) : (
              models.map((model) => (
                <TouchableOpacity
                  key={model.id}
                  style={[
                    styles.restaurantCard,
                    {
                      backgroundColor: colors.card,
                      borderColor: isDark ? colors.border : 'rgba(200,162,74,0.18)',
                    },
                    ELEVATION.card,
                  ]}
                  activeOpacity={0.9}
                  onPress={() => router.push(`/car/${model.id}`)}
                >
                  <View style={styles.restaurantImageWrap}>
                    {model.image_url ? (
                      <Image
                        source={{ uri: model.image_url }}
                        style={styles.restaurantImage}
                        contentFit="cover"
                        cachePolicy="memory-disk"
                        transition={200}
                      />
                    ) : (
                      <LinearGradient
                        colors={GRADIENTS.champagneRise}
                        style={styles.restaurantImage}
                      >
                        <Ionicons name="restaurant" size={42} color={colors.primary} />
                      </LinearGradient>
                    )}
                    <LinearGradient
                      colors={['transparent', 'rgba(11,11,14,0.78)']}
                      style={styles.restaurantImageVeil}
                      pointerEvents="none"
                    />
                    <View style={styles.restaurantBadge}>
                      <Ionicons name="star" size={11} color={colors.primary} />
                      <Text style={[styles.restaurantBadgeText, { color: colors.primary }]}>
                        {language === 'ar' ? 'موصى به' : 'Featured'}
                      </Text>
                    </View>
                  </View>

                  <View style={styles.restaurantBody}>
                    <View style={styles.restaurantNameRow}>
                      <Text style={[styles.restaurantName, { color: colors.text, flex: 1 }]}>
                        {getName(model)}
                      </Text>
                      {ratingSummaries[model.id] && ratingSummaries[model.id].review_count > 0 && (
                        <View style={[styles.ratingBadge, { backgroundColor: 'rgba(245,158,11,0.12)', borderColor: 'rgba(245,158,11,0.4)' }]}>
                          <Ionicons name="star" size={11} color="#F59E0B" />
                          <Text style={styles.ratingBadgeAvg}>
                            {ratingSummaries[model.id].avg_rating.toFixed(1)}
                          </Text>
                          <Text style={[styles.ratingBadgeCount, { color: colors.textSecondary }]}>
                            ({ratingSummaries[model.id].review_count})
                          </Text>
                        </View>
                      )}
                    </View>
                    {model.year_start && model.year_end ? (
                      <Text style={[styles.restaurantTag, { color: colors.textSecondary }]}>
                        {language === 'ar' ? 'تأسس عام' : 'Est.'} {model.year_start}
                      </Text>
                    ) : null}
                    {model.variants && model.variants.length > 0 ? (
                      <View style={styles.restaurantMetaRow}>
                        <Ionicons name="leaf-outline" size={13} color={colors.primary} />
                        <Text style={[styles.restaurantMetaText, { color: colors.primary }]}>
                          {model.variants.length}{' '}
                          {language === 'ar' ? 'قائمة طعام' : 'menus'}
                        </Text>
                      </View>
                    ) : null}
                    <View style={styles.restaurantCtaRow}>
                      <Text style={[styles.restaurantCta, { color: colors.primary }]}>
                        {pageConfig
                          ? (language === 'ar' ? (pageConfig.cta_label_ar || 'استعرض القائمة') : (pageConfig.cta_label_en || 'View menu'))
                          : (language === 'ar' ? 'استعرض القائمة' : 'View menu')}
                      </Text>
                      <Ionicons
                        name={isRTL ? 'chevron-back' : 'chevron-forward'}
                        size={15}
                        color={colors.primary}
                      />
                    </View>
                  </View>
                </TouchableOpacity>
              ))
            )}
          </View>

          {/* Smart Nutritional Strip — expandable calories summary */}
          {models.length > 0 && (
            <TouchableOpacity
              activeOpacity={0.85}
              onPress={() => setNutritionExpanded((v) => !v)}
              style={[styles.allergenStrip, { backgroundColor: colors.card, borderColor: colors.border, flexDirection: 'column', alignItems: 'stretch', gap: 0 }]}
            >
              <View style={{ flexDirection: isRTL ? 'row-reverse' : 'row', alignItems: 'center', gap: 8 }}>
                <Ionicons name={nutritionExpanded ? 'chevron-up' : 'chevron-down'} size={15} color={colors.textSecondary} />
                <Ionicons name="nutrition-outline" size={16} color={brandNutrition ? '#10B981' : colors.textSecondary} />
                <Text style={[styles.allergenText, { color: colors.textSecondary, flex: 1 }]}>
                  {brandNutrition
                    ? (language === 'ar'
                        ? `متوسط السعرات: ${brandNutrition.avgCalories} كيلوكالوري — اضغط للتفاصيل`
                        : `Avg. ${brandNutrition.avgCalories} kcal per dish — tap for details`)
                    : (language === 'ar'
                        ? 'معلومات غذائية متاحة — اضغط للمزيد'
                        : 'Nutritional info available — tap to expand')}
                </Text>
              </View>
              {nutritionExpanded && (
                <View style={{ marginTop: 10, gap: 6 }}>
                  {brandNutrition ? (
                    <>
                      <View style={{ flexDirection: isRTL ? 'row-reverse' : 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                        <View style={{ flexDirection: isRTL ? 'row-reverse' : 'row', alignItems: 'center', gap: 6 }}>
                          <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: '#10B981' }} />
                          <Text style={{ color: colors.textSecondary, fontSize: 13 }}>
                            {language === 'ar' ? 'متوسط السعرات الحرارية' : 'Avg. Calories'}
                          </Text>
                        </View>
                        <Text style={{ color: colors.text, fontSize: 13, fontWeight: '700' }}>
                          {brandNutrition.avgCalories} {language === 'ar' ? 'ك.ح' : 'kcal'}
                        </Text>
                      </View>
                      <View style={{ flexDirection: isRTL ? 'row-reverse' : 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                        <View style={{ flexDirection: isRTL ? 'row-reverse' : 'row', alignItems: 'center', gap: 6 }}>
                          <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: '#F59E0B' }} />
                          <Text style={{ color: colors.textSecondary, fontSize: 13 }}>
                            {language === 'ar' ? 'أعلى قيمة' : 'Highest Dish'}
                          </Text>
                        </View>
                        <Text style={{ color: colors.text, fontSize: 13, fontWeight: '700' }}>
                          {brandNutrition.maxCalories} {language === 'ar' ? 'ك.ح' : 'kcal'}
                        </Text>
                      </View>
                      <View style={{ flexDirection: isRTL ? 'row-reverse' : 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                        <View style={{ flexDirection: isRTL ? 'row-reverse' : 'row', alignItems: 'center', gap: 6 }}>
                          <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: '#6366F1' }} />
                          <Text style={{ color: colors.textSecondary, fontSize: 13 }}>
                            {language === 'ar' ? 'أطباق بمعلومات غذائية' : 'Dishes with data'}
                          </Text>
                        </View>
                        <Text style={{ color: colors.text, fontSize: 13, fontWeight: '700' }}>
                          {brandNutrition.itemsWithCalories} / {brandNutrition.totalItems}
                        </Text>
                      </View>
                      <Text style={{ color: colors.textSecondary, fontSize: 11, marginTop: 4, textAlign: isRTL ? 'right' : 'left' }}>
                        {language === 'ar'
                          ? '* البدائل النباتية وتفاصيل المكونات متاحة في صفحة كل مطعم.'
                          : '* Vegetarian options & full ingredient details available on each restaurant page.'}
                      </Text>
                    </>
                  ) : (
                    <Text style={{ color: colors.textSecondary, fontSize: 13, textAlign: isRTL ? 'right' : 'left' }}>
                      {language === 'ar'
                        ? 'البدائل النباتية وتفاصيل المكونات متاحة في صفحة كل مطعم.'
                        : 'Vegetarian options & full ingredient details available on each restaurant page.'}
                    </Text>
                  )}
                </View>
              )}
            </TouchableOpacity>
          )}

          {/* Add All to Cart — guarded by the shared combo-conflict modal */}
          {brandProducts.length > 0 && (
            <View style={styles.addAllCartWrapper}>
              <TouchableOpacity
                style={[
                  styles.addAllCartBtn,
                  { backgroundColor: colors.card, borderColor: colors.primary },
                ]}
                activeOpacity={0.82}
                disabled={addingToCart}
                onPress={() => guardedAdd(() => {
                  // Add-all = every currently-displayed dish that's in stock.
                  const inStockProducts = brandProducts.filter(isInStock);
                  setAddingToCart(true);
                  inStockProducts.forEach((p: any) => {
                    addToLocalCart({ product_id: p.id, quantity: 1, product: p });
                  });
                  setAddingToCart(false);
                })}
              >
                <Ionicons name="cart-outline" size={18} color={colors.primary} />
                <Text style={[styles.addAllCartText, { color: colors.primary }]}>
                  {addingToCart
                    ? (language === 'ar' ? 'جارٍ الإضافة...' : 'Adding...')
                    : (() => {
                        const n = brandProducts.filter(isInStock).length;
                        return language === 'ar'
                          ? `إضافة ${n} أطباق إلى السلة`
                          : `Add ${n} Dishes to Cart`;
                      })()}
                </Text>
              </TouchableOpacity>
            </View>
          )}

          {/* Featured Dishes — per-dish list with image, name, price, calories,
              and individual add buttons routed through the conflict guard. */}
          {brandProducts.length > 0 && (
            <View style={styles.dishesSection}>
              <Text style={[styles.sectionTitle, { color: colors.text }]}>
                {language === 'ar' ? 'أبرز الأطباق' : 'Featured Dishes'}
              </Text>
              {hasComboInCart && (
                <View style={[styles.comboHintRow, { backgroundColor: 'rgba(200,162,74,0.10)', borderColor: 'rgba(200,162,74,0.35)' }]}>
                  <Ionicons name="information-circle" size={14} color={colors.primary} />
                  <Text style={[styles.comboHintText, { color: colors.textSecondary }]}>
                    {language === 'ar'
                      ? 'سلتك تحتوي على وجبة كومبو. أكمل أو احذف الوجبة الحالية قبل إضافة أطباق جديدة.'
                      : 'You already have a combo in your cart. Complete or remove it before adding new dishes.'}
                  </Text>
                </View>
              )}
              {brandProducts.map((dish: any) => {
                const dishName = (language === 'ar' && dish.name_ar) ? dish.name_ar : (dish.name ?? '');
                const price = Number(dish.price ?? 0);
                const calories = dish.calories ?? dish.nutrition_calories ?? null;
                const inStock = isInStock(dish);
                return (
                  <View
                    key={dish.id}
                    style={[styles.dishCard, { backgroundColor: colors.card, borderColor: colors.border, opacity: inStock ? 1 : 0.55 }]}
                  >
                    {dish.image_url ? (
                      <Image
                        source={{ uri: dish.image_url }}
                        style={styles.dishImage}
                        contentFit="cover"
                        cachePolicy="memory-disk"
                      />
                    ) : (
                      <View style={[styles.dishImage, { backgroundColor: 'rgba(200,162,74,0.12)', alignItems: 'center', justifyContent: 'center' }]}>
                        <Ionicons name="restaurant-outline" size={22} color={colors.primary} />
                      </View>
                    )}
                    <View style={styles.dishBody}>
                      <Text style={[styles.dishName, { color: colors.text }]} numberOfLines={1}>
                        {dishName}
                      </Text>
                      <View style={styles.dishMetaRow}>
                        <Text style={[styles.dishPrice, { color: colors.primary }]}>
                          {price.toFixed(0)} {language === 'ar' ? 'ج.م' : 'EGP'}
                        </Text>
                        {calories != null && (
                          <View style={styles.dishCaloriesPill}>
                            <Ionicons name="flame-outline" size={11} color="#10B981" />
                            <Text style={styles.dishCaloriesText}>
                              {calories} {language === 'ar' ? 'ك.ح' : 'kcal'}
                            </Text>
                          </View>
                        )}
                      </View>
                    </View>
                    <TouchableOpacity
                      style={[styles.dishAddBtn, {
                        backgroundColor: !inStock ? colors.border : (hasComboInCart ? colors.border : colors.primary),
                      }]}
                      activeOpacity={0.85}
                      disabled={!inStock}
                      onPress={() => guardedAdd(() => {
                        addToLocalCart({ product_id: dish.id, quantity: 1, product: dish });
                      })}
                    >
                      <Ionicons
                        name={!inStock ? 'close' : (hasComboInCart ? 'lock-closed' : 'add')}
                        size={20}
                        color={!inStock || hasComboInCart ? colors.textSecondary : '#0B0B0E'}
                      />
                    </TouchableOpacity>
                  </View>
                );
              })}
            </View>
          )}

          {/* Shared combo-conflict modal — opens whenever guardedAdd detects
              the cart already has items from another combo. */}
          <Modal
            visible={conflictModal}
            transparent
            animationType="fade"
            onRequestClose={() => { setConflictModal(false); pendingAddRef.current = null; }}
          >
            <View style={styles.conflictBackdrop}>
              <View style={[styles.conflictSheet, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <View style={styles.conflictIconWrap}>
                  <Ionicons name="swap-horizontal" size={28} color={colors.primary} />
                </View>
                <Text style={[styles.conflictTitle, { color: colors.text }]}>
                  {language === 'ar' ? 'المطبخ موجود بالفعل في السلة' : 'Combo already in cart'}
                </Text>
                <Text style={[styles.conflictBody, { color: colors.textSecondary }]}>
                  {language === 'ar'
                    ? 'لديك أطباق من هذا المطبخ في سلتك. أكمل أو احذف الكومبو الحالي قبل إضافة المزيد.'
                    : 'You already have dishes from this cuisine in your cart. Complete or remove the current combo before adding more.'}
                </Text>
                <View style={styles.conflictActions}>
                  <TouchableOpacity
                    style={[styles.conflictBtn, { borderColor: colors.border }]}
                    onPress={() => { setConflictModal(false); pendingAddRef.current = null; }}
                  >
                    <Text style={{ color: colors.textSecondary, fontWeight: '600' }}>
                      {language === 'ar' ? 'إلغاء' : 'Cancel'}
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.conflictBtn, { backgroundColor: colors.primary, borderColor: colors.primary }]}
                    onPress={() => {
                      const fn = pendingAddRef.current;
                      pendingAddRef.current = null;
                      clearCart();
                      setConflictModal(false);
                      // Wait a tick so the cart store fully clears before re-adding.
                      if (fn) setTimeout(fn, 50);
                    }}
                  >
                    <Text style={{ color: '#0B0B0E', fontWeight: '700' }}>
                      {language === 'ar' ? 'استبدال' : 'Replace'}
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          </Modal>

          {/* Browse dishes CTA */}
          <TouchableOpacity
            style={[styles.browseDishesBtn, ELEVATION.goldGlow]}
            onPress={() => router.push(`/search?car_brand_id=${id}`)}
            activeOpacity={0.85}
          >
            <LinearGradient
              colors={GRADIENTS.goldShimmer}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.browseDishesGradient}
            >
              <Ionicons name="search" size={18} color="#1B1B1F" />
              <Text style={styles.browseDishesText}>
                {language === 'ar'
                  ? 'تصفّح أطباق هذا المطبخ'
                  : 'Browse dishes from this cuisine'}
              </Text>
            </LinearGradient>
          </TouchableOpacity>
        </View>
      </AnimatedScroll>

      <Footer />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  scrollView: { flex: 1 },
  scrollContent: { paddingBottom: SPACING.xxxl },

  // Hero
  heroWrapper: {
    width: SCREEN_WIDTH,
    height: HERO_HEIGHT,
    overflow: 'hidden',
    backgroundColor: '#0B0B0E',
  },
  heroImage: { width: '100%', height: '100%' },
  heroContent: {
    position: 'absolute',
    bottom: SPACING.xl,
    left: SPACING.xl,
    right: SPACING.xl,
  },
  heroContentRTL: { alignItems: 'flex-end' },
  heroEyebrow: {
    ...TYPE.sectionLabel,
    color: '#E8D29A',
    marginBottom: SPACING.sm,
  },
  heroTitle: {
    ...TYPE.hero,
    color: '#F7F2E9',
    marginBottom: SPACING.sm,
  },
  heroMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
  },
  heroDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#C8A24A',
  },
  heroMeta: {
    ...TYPE.body,
    color: '#E8D29A',
    fontWeight: '500',
  },

  // Body sheet (overlaps hero with rounded top)
  bodySheet: {
    marginTop: -SPACING.xxl,
    borderTopLeftRadius: RADII.xxl,
    borderTopRightRadius: RADII.xxl,
    paddingTop: SPACING.xxl,
    paddingHorizontal: SPACING.xl,
  },

  // Story block
  storyBlock: {
    alignItems: 'center',
    marginBottom: SPACING.xxl,
  },
  sectionLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.md,
    marginBottom: SPACING.md,
  },
  rule: { width: 28, height: 1, opacity: 0.6 },
  sectionLabel: { ...TYPE.sectionLabel },
  storyTitle: {
    ...TYPE.display,
    textAlign: 'center',
    marginBottom: SPACING.md,
  },
  storyBody: {
    ...TYPE.body,
    textAlign: 'center',
    lineHeight: 24,
  },

  // Add All to Cart button
  addAllCartWrapper: {
    marginBottom: SPACING.lg,
  },
  addAllCartBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderWidth: 1.5,
    borderRadius: 12,
    paddingVertical: 13,
    paddingHorizontal: 20,
  },
  addAllCartText: {
    fontSize: 14,
    fontWeight: '700',
  },
  addAllConflictText: {
    fontSize: 12,
    textAlign: 'center',
    marginTop: 6,
    paddingHorizontal: 8,
  },
  conflictBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  conflictSheet: {
    width: '100%',
    maxWidth: 380,
    borderWidth: 1,
    borderRadius: 18,
    padding: 22,
    alignItems: 'center',
  },
  conflictIconWrap: {
    width: 56, height: 56, borderRadius: 28,
    backgroundColor: 'rgba(200,162,74,0.14)',
    alignItems: 'center', justifyContent: 'center',
    marginBottom: 12,
  },
  conflictTitle: { fontSize: 17, fontWeight: '700', textAlign: 'center', marginBottom: 6 },
  conflictBody: { fontSize: 13, textAlign: 'center', lineHeight: 19, marginBottom: 18 },
  conflictActions: { flexDirection: 'row', gap: 10, width: '100%' },
  conflictBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: 'center',
  },
  dishesSection: { marginTop: SPACING.lg, marginBottom: SPACING.lg, gap: 10 },
  comboHintRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingVertical: 8, paddingHorizontal: 10,
    borderRadius: 10, borderWidth: 1,
  },
  comboHintText: { flex: 1, fontSize: 12, fontWeight: '500' },
  dishCard: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 14,
    padding: 10,
    gap: 12,
  },
  dishImage: { width: 60, height: 60, borderRadius: 10 },
  dishBody: { flex: 1, gap: 4 },
  dishName: { fontSize: 14, fontWeight: '700' },
  dishMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  dishPrice: { fontSize: 13, fontWeight: '700' },
  dishCaloriesPill: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    paddingHorizontal: 7, paddingVertical: 2,
    backgroundColor: 'rgba(16,185,129,0.12)',
    borderRadius: 8,
  },
  dishCaloriesText: { fontSize: 11, fontWeight: '600', color: '#10B981' },
  dishAddBtn: {
    width: 36, height: 36, borderRadius: 18,
    alignItems: 'center', justifyContent: 'center',
  },

  // Restaurant cards
  restaurantsSection: { marginBottom: SPACING.xl },
  sectionTitle: {
    ...TYPE.title,
    marginBottom: SPACING.lg,
  },
  restaurantCard: {
    borderRadius: RADII.xl,
    borderWidth: 1,
    overflow: 'hidden',
    marginBottom: SPACING.lg,
  },
  restaurantImageWrap: {
    width: '100%',
    height: 200,
    position: 'relative',
    alignItems: 'center',
    justifyContent: 'center',
  },
  restaurantImage: {
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  restaurantImageVeil: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: '60%',
  },
  restaurantBadge: {
    position: 'absolute',
    top: SPACING.md,
    left: SPACING.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: SPACING.sm,
    paddingVertical: 4,
    borderRadius: RADII.pill,
    backgroundColor: 'rgba(11,11,14,0.72)',
    borderWidth: 1,
    borderColor: 'rgba(200,162,74,0.4)',
  },
  restaurantBadgeText: {
    ...TYPE.caption,
    fontWeight: '700',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  restaurantBody: { padding: SPACING.lg },
  restaurantNameRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: SPACING.sm,
    marginBottom: 2,
  },
  restaurantName: {
    ...TYPE.title,
  },
  ratingBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 10,
    borderWidth: 1,
    marginTop: 2,
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
  restaurantTag: {
    ...TYPE.caption,
    marginBottom: SPACING.sm,
    letterSpacing: 0.6,
  },
  restaurantMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: SPACING.md,
  },
  restaurantMetaText: { ...TYPE.caption, fontWeight: '600' },
  restaurantCtaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  restaurantCta: { ...TYPE.button },

  // Browse dishes CTA
  browseDishesBtn: {
    borderRadius: RADII.pill,
    overflow: 'hidden',
    marginTop: SPACING.md,
  },
  browseDishesGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: SPACING.lg,
    paddingHorizontal: SPACING.xl,
    gap: SPACING.sm,
  },
  browseDishesText: {
    ...TYPE.button,
    color: '#1B1B1F',
  },

  allergenStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    borderRadius: RADII.md,
    borderWidth: 1,
    padding: SPACING.md,
    marginBottom: SPACING.xl,
  },
  allergenText: { ...TYPE.caption, flex: 1, lineHeight: 18 },

  // Empty state
  emptyContainer: {
    alignItems: 'center',
    paddingVertical: SPACING.xxxl,
    gap: SPACING.md,
  },
  emptyText: { ...TYPE.body, textAlign: 'center' },
});
