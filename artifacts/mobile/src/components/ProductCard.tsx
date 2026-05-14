import React, { useState, useRef, useCallback, useMemo, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Animated, Platform, Alert } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useTheme } from '../hooks/useTheme';
import { useTranslation } from '../hooks/useTranslation';
import { useAppStore } from '../store/appStore';
import { AnimatedFavoriteButton, AnimatedCartButton, AnimatedCartButtonRef } from './AnimatedIconButton';
import { useBundleProducts } from '../hooks/queries/useBundleProducts';
import FitmentStrip from './FitmentStrip';
import { useCartMutations } from '../hooks/queries/useShoppingHubQuery';
import { useFavorites, useToggleFavorite } from '../hooks/useFavorites';
import * as Haptics from 'expo-haptics';
import { TYPE, RADII } from '../constants/luxuryTokens';

const GOLD_COLOR = '#C8A24A';

// ─── Allergen Registry ───────────────────────────────────────────────────────
// Each entry maps a normalised allergen key (lowercase) to a short badge code,
// a distinctive brand-safe colour, and bilingual labels (EN / AR).
const ALLERGEN_MAP: Record<
  string,
  { code: string; color: string; label: string; labelAr: string }
> = {
  gluten:      { code: 'G',  color: '#D97706', label: 'Gluten',    labelAr: 'جلوتين'     },
  wheat:       { code: 'G',  color: '#D97706', label: 'Wheat',     labelAr: 'قمح'        },
  dairy:       { code: 'D',  color: '#2563EB', label: 'Dairy',     labelAr: 'حليب'       },
  milk:        { code: 'D',  color: '#2563EB', label: 'Dairy',     labelAr: 'حليب'       },
  nuts:        { code: 'N',  color: '#92400E', label: 'Nuts',      labelAr: 'مكسرات'     },
  tree_nuts:   { code: 'N',  color: '#92400E', label: 'Nuts',      labelAr: 'مكسرات'     },
  peanuts:     { code: 'P',  color: '#78350F', label: 'Peanuts',   labelAr: 'فول سوداني' },
  eggs:        { code: 'E',  color: '#B45309', label: 'Eggs',      labelAr: 'بيض'        },
  egg:         { code: 'E',  color: '#B45309', label: 'Eggs',      labelAr: 'بيض'        },
  fish:        { code: 'F',  color: '#0369A1', label: 'Fish',      labelAr: 'سمك'        },
  shellfish:   { code: 'Sh', color: '#BE185D', label: 'Shellfish', labelAr: 'محار'       },
  crustacean:  { code: 'Sh', color: '#BE185D', label: 'Shellfish', labelAr: 'محار'       },
  soy:         { code: 'S',  color: '#166534', label: 'Soy',       labelAr: 'صويا'       },
  sesame:      { code: 'Se', color: '#6D28D9', label: 'Sesame',    labelAr: 'سمسم'       },
  mustard:     { code: 'M',  color: '#C2410C', label: 'Mustard',   labelAr: 'خردل'       },
  celery:      { code: 'C',  color: '#15803D', label: 'Celery',    labelAr: 'كرفس'       },
  sulfites:    { code: 'Su', color: '#7C3AED', label: 'Sulfites',  labelAr: 'كبريتيت'    },
  sulphites:   { code: 'Su', color: '#7C3AED', label: 'Sulfites',  labelAr: 'كبريتيت'    },
  lupin:       { code: 'L',  color: '#DB2777', label: 'Lupin',     labelAr: 'لوبين'      },
  molluscs:    { code: 'Mo', color: '#4F46E5', label: 'Molluscs',  labelAr: 'رخويات'     },
};

interface ProductCardProps {
  product: {
    id: string;
    name: string;
    name_ar: string;
    price: number;
    image_url?: string;
    product_brand_id?: string;
    // Enhanced fields for detailed display
    product_brand_name?: string;
    product_brand_name_ar?: string;
    manufacturer_country?: string;
    manufacturer_country_ar?: string;
    sku?: string;
    // Car compatibility fields - format: "Brand Model Year"
    compatible_car_model?: string;
    compatible_car_model_ar?: string;
    compatible_car_brand?: string;
    compatible_car_brand_ar?: string;
    compatible_car_year_from?: number;
    compatible_car_year_to?: number;
    compatible_car_models_count?: number;
    fitment_indicator?: string | null;
    is_tire?: boolean;
    product_type?: 'tire' | 'accessory' | 'exterior' | null;
    available_variants?: Array<{ indicator: string; price?: number; stock?: number }>;
    stock_quantity?: number | string | null;
    // Per-serving nutrition snapshot (jsonb on the product). We only read
    // `calories` here to render the at-a-glance chip; the dish detail page
    // owns the full breakdown.
    nutrition?: Record<string, unknown> | null;
  };
  onAddToCart?: (quantity: number, fitmentIndicator?: string | null) => void;
  cardWidth?: number;
  showDetails?: boolean;
  /** Restaurant name tags injected by the home screen from the carModels list.
   *  Pass all names when a dish belongs to multiple restaurants.
   *  Used as a fallback when compatible_car_model is not populated on the product. */
  restaurantNameTag?: string[];
  /** Restaurant IDs parallel to restaurantNameTag. When provided, each name pill
   *  becomes tappable and navigates to /car/[id] without triggering the card press. */
  restaurantIds?: string[];
}

// Memoized ProductCard component
const ProductCardComponent: React.FC<ProductCardProps> = ({ 
  product, 
  onAddToCart, 
  cardWidth, 
  showDetails = true,
  restaurantNameTag,
  restaurantIds,
}) => {
  const { colors, isDark } = useTheme();
  const { language, isRTL } = useTranslation();
  const router = useRouter();
  const user = useAppStore(useCallback((state) => state.user, []));
  
  // Check if product is in any active bundle and get its discount
  const { isProductInBundle, getBundleForProduct } = useBundleProducts();
  const isInBundle = useMemo(() => isProductInBundle(product.id), [product.id, isProductInBundle]);
  const bundleOffer = useMemo(() => getBundleForProduct(product.id), [product.id, getBundleForProduct]);
  
  // Cart mutations for bidirectional duplicate checking
  const { checkBundleConflict, checkBundleDuplicate } = useCartMutations();
  
  // Ref for AnimatedCartButton to trigger shake animation
  const cartButtonRef = useRef<AnimatedCartButtonRef>(null);
  // Track the most-recent revert timer so a rapid second tap supersedes the
  // first one (instead of leaking timers), and so unmount can clear it.
  const revertTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Track mount state so we don't call setState on an unmounted component if
  // the optimistic timer or the awaited mutation resolves after the user
  // navigates away from the screen.
  const isMountedRef = useRef(true);
  useEffect(() => {
    return () => {
      isMountedRef.current = false;
      if (revertTimerRef.current) {
        clearTimeout(revertTimerRef.current);
        revertTimerRef.current = null;
      }
    };
  }, []);
  
  const { data: favoritesData } = useFavorites();
  const toggleFavoriteMutation = useToggleFavorite();
  const isFavorite = useMemo(() => {
    if (!favoritesData) return false;
    return favoritesData.some((f: any) => f.product_id === product.id);
  }, [favoritesData, product.id]);
  const favoriteLoading = toggleFavoriteMutation.isPending;
  const [cartLoading, setCartLoading] = useState(false);
  const [addedToCart, setAddedToCart] = useState(false);
  const [quantity, setQuantity] = useState(1);

  // Fitment selection state — defaults to product's own indicator or STD
  const variantList = useMemo(
    () => (Array.isArray(product.available_variants) ? product.available_variants : []),
    [product.available_variants],
  );
  // Only show the fitment strip when 2+ distinct meaningful size options exist.
  // Both 'STD' (legacy sentinel) and 'صغير' (the new default/base size) are
  // treated as "base" — a product with ONLY a base indicator shows nothing;
  // the strip appears only when the product has two or more distinct real sizes.
  const uniqueIndicators = useMemo(() => {
    const set = new Set<string>();
    for (const v of variantList) {
      if (v?.indicator) set.add(v.indicator);
    }
    if (product.fitment_indicator) set.add(product.fitment_indicator);
    set.delete('STD'); // legacy sentinel — never meaningful for display
    return set;
  }, [variantList, product.fitment_indicator]);
  const hasFitment = uniqueIndicators.size > 1;
  const initialFitment = useMemo(() => {
    if (!hasFitment) return null;
    if (product.fitment_indicator) return String(product.fitment_indicator);
    const std = variantList.find((v) => v?.indicator === 'STD');
    return std?.indicator || variantList[0]?.indicator || null;
  }, [hasFitment, product.fitment_indicator, variantList]);
  const [selectedFitment, setSelectedFitment] = useState<string | null>(initialFitment);

  const effectiveUnitPrice = useMemo(() => {
    if (selectedFitment && variantList.length > 0) {
      const v = variantList.find((x) => x?.indicator === selectedFitment);
      if (v?.price !== undefined && v?.price !== null) {
        const n = parseFloat(String(v.price));
        if (Number.isFinite(n)) return n;
      }
    }
    return parseFloat(String(product.price || 0)) || 0;
  }, [selectedFitment, variantList, product.price]);

  // True when the selected fitment's stock is known to be exactly 0.
  const isSelectedOutOfStock = useMemo(() => {
    if (variantList.length > 0 && selectedFitment) {
      const v = variantList.find((x) => x?.indicator === selectedFitment);
      if (v && v.stock !== undefined && v.stock !== null) {
        return Number(v.stock) === 0;
      }
    }
    if (variantList.length === 0) {
      const sq = product.stock_quantity;
      if (sq !== undefined && sq !== null) return Number(sq) === 0;
    }
    return false;
  }, [variantList, selectedFitment, product.stock_quantity]);
  
  // Animation refs
  const priceScaleAnim = useRef(new Animated.Value(1)).current;
  const quantityBounceAnim = useRef(new Animated.Value(1)).current;

  // Memoized computed values
  const displayName = useMemo(() => 
    language === 'ar' && product.name_ar ? product.name_ar : product.name,
    [language, product.name, product.name_ar]
  );

  // Paired restaurant {name, id} entries displayed on the card.
  // Priority order:
  //  1. restaurantNameTag[] + restaurantIds[] — injected by the home screen (zipped
  //     before filtering so IDs always correspond to their surviving name entry)
  //  2. compatible_car_model(_ar) — product-level fallback; no ID available here
  // Returns an empty array when all sources are absent/invalid (whitespace or "N/A").
  // The detail row is hidden entirely when this is empty.
  const restaurantPairs = useMemo<Array<{ name: string; id?: string }>>(() => {
    const INVALID = /^\s*$|^n\/?a$/i;
    // 1. Live carModels lookup injected by the home screen — zip names+ids, then filter
    if (Array.isArray(restaurantNameTag) && restaurantNameTag.length > 0) {
      const pairs = restaurantNameTag
        .map((n, i) => ({ name: n.trim(), id: restaurantIds?.[i] }))
        .filter(({ name }) => name && !INVALID.test(name));
      if (pairs.length > 0) return pairs;
    }
    // 2. Product-level fallback (used on non-home-screen surfaces; no id available)
    const raw = (language === 'ar' && product.compatible_car_model_ar)
      ? product.compatible_car_model_ar
      : (product.compatible_car_model || '');
    return INVALID.test(raw) ? [] : [{ name: raw.trim() }];
  }, [language, product.compatible_car_model, product.compatible_car_model_ar, restaurantNameTag, restaurantIds]);

  const totalPrice = useMemo(() => effectiveUnitPrice * quantity, [effectiveUnitPrice, quantity]);

  const formattedPrice = useMemo(() => `${totalPrice.toFixed(2)} ج.م`, [totalPrice]);

  // Per-serving calories live on `product.nutrition.calories` (jsonb). When
  // present we render a compact chip on the card; otherwise render nothing.
  const caloriesValue = useMemo<number | null>(() => {
    const raw = product.nutrition && typeof product.nutrition === 'object' && !Array.isArray(product.nutrition)
      ? (product.nutrition as Record<string, unknown>).calories
      : undefined;
    if (raw === null || raw === undefined || raw === '') return null;
    const n = typeof raw === 'number' ? raw : parseFloat(String(raw));
    return Number.isFinite(n) ? n : null;
  }, [product.nutrition]);
  const caloriesLabel = useMemo(() => {
    if (caloriesValue === null) return null;
    return language === 'ar' ? `${caloriesValue} سعرة` : `${caloriesValue} kcal`;
  }, [caloriesValue, language]);

  // Extract allergen keys from `product.nutrition.allergens` (string[]).
  // Unknown or malformed values are silently dropped. At most 6 badges are
  // shown on the card; any extra are collapsed into a "+N" overflow badge.
  const allergensList = useMemo<string[]>(() => {
    if (
      !product.nutrition ||
      typeof product.nutrition !== 'object' ||
      Array.isArray(product.nutrition)
    )
      return [];
    const raw = (product.nutrition as Record<string, unknown>).allergens;
    if (!Array.isArray(raw)) return [];
    return raw.filter((a): a is string => typeof a === 'string' && a.trim() !== '');
  }, [product.nutrition]);


  // Memoized handlers
  const handleCardPress = useCallback(() => {
    router.push(`/product/${product.id}`);
  }, [router, product.id]);

  const handleToggleFavorite = useCallback(() => {
    if (!user) {
      router.push('/login');
      return;
    }
    toggleFavoriteMutation.mutate(product.id);
  }, [user, router, product.id, toggleFavoriteMutation]);

  const animatePrice = useCallback(() => {
    Animated.sequence([
      Animated.timing(priceScaleAnim, {
        toValue: 1.15,
        duration: 100,
        useNativeDriver: true,
      }),
      Animated.spring(priceScaleAnim, {
        toValue: 1,
        friction: 5,
        tension: 300,
        useNativeDriver: true,
      }),
    ]).start();
  }, [priceScaleAnim]);

  const handleAddToCart = useCallback(async () => {
    if (!onAddToCart) return;
    
    // BUNDLE-ONLY: only block if the product is already in cart as a bundle item.
    // Non-bundle duplicates merge into the same grouped cart card by fitment indicator.
    if (checkBundleConflict(product.id)) {
      // Trigger shake animation on cart button
      if (cartButtonRef.current) {
        cartButtonRef.current.triggerShake();
      }
      
      // Haptic feedback for warning
      if (Platform.OS !== 'web') {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      }
      
      Alert.alert(
        language === 'ar' ? 'تنبيه' : 'Notice',
        'عرض المنتج تم اضافته بالفعل',
        [{ text: language === 'ar' ? 'حسناً' : 'OK', style: 'default' }],
        { cancelable: true }
      );
      
      // Do NOT set addedToCart to true - keep showing 'add' icon
      return;
    }
    
    // Success path - product is not a duplicate
    if (Platform.OS !== 'web') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    }
    
    // ── OPTIMISTIC 0→1 visual feedback ─────────────────────────────────────
    // Flip the cart icon to its "added" tick *immediately*, before awaiting
    // the network round-trip. The mutation hook (useCartMutations) already
    // performs an optimistic cache insert in onMutate, so this just keeps
    // the per-card visual in lockstep — no wait for the green tick.
    // If the backend rejects (out_of_stock / bundle conflict), we revert
    // both the icon and the loading flag inside catch().
    setAddedToCart(true);
    // Cancel any pending revert from a previous tap so a rapid second tap
    // doesn't fight with the first one's countdown — the new timer wins.
    if (revertTimerRef.current) clearTimeout(revertTimerRef.current);
    revertTimerRef.current = setTimeout(() => {
      revertTimerRef.current = null;
      if (isMountedRef.current) setAddedToCart(false);
    }, 1500);
    setCartLoading(true);

    try {
      await onAddToCart(quantity, selectedFitment);
      // Success path: icon already showing tick, nothing else to do.
    } catch (error) {
      // Rollback the optimistic tick so the user sees the error state.
      // Only touch state if we're still mounted; the screen may have
      // navigated away during the awaited round-trip.
      if (revertTimerRef.current) {
        clearTimeout(revertTimerRef.current);
        revertTimerRef.current = null;
      }
      if (isMountedRef.current) setAddedToCart(false);
      console.error('Error adding to cart:', error);
    } finally {
      if (isMountedRef.current) setCartLoading(false);
    }
  }, [onAddToCart, quantity, checkBundleConflict, product.id, language, selectedFitment]);

  const handleIncreaseQuantity = useCallback(() => {
    if (Platform.OS !== 'web') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    setQuantity(prev => prev + 1);
    
    Animated.sequence([
      Animated.spring(quantityBounceAnim, {
        toValue: 1.3,
        friction: 5,
        tension: 300,
        useNativeDriver: true,
      }),
      Animated.spring(quantityBounceAnim, {
        toValue: 1,
        friction: 5,
        tension: 300,
        useNativeDriver: true,
      }),
    ]).start();

    animatePrice();
  }, [quantityBounceAnim, animatePrice]);

  const handleDecreaseQuantity = useCallback(() => {
    if (quantity > 1) {
      if (Platform.OS !== 'web') {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      }
      setQuantity(prev => prev - 1);
      
      Animated.sequence([
        Animated.spring(quantityBounceAnim, {
          toValue: 0.7,
          friction: 5,
          tension: 300,
          useNativeDriver: true,
        }),
        Animated.spring(quantityBounceAnim, {
          toValue: 1,
          friction: 5,
          tension: 300,
          useNativeDriver: true,
        }),
      ]).start();

      animatePrice();
    }
  }, [quantity, quantityBounceAnim, animatePrice]);

  // Memoized style computations with Glassmorphism Dark Mode Enhancement
  const containerStyle = useMemo(() => [
    styles.container,
    {
      // Glassmorphism Background - 30% more solid in Dark Mode
      backgroundColor: isDark ? 'rgba(30, 41, 59, 0.91)' : 'rgba(255, 255, 255, 0.9)',
      // Enhanced Border for Dark Mode clarity
      borderColor: isDark ? 'rgba(255, 255, 255, 0.18)' : colors.border,
      borderWidth: 1,
      borderRadius: 20,
      width: cardWidth || 160,
      // Enhanced Shadow for Premium Depth
      ...Platform.select({
        web: {
          boxShadow: isDark 
            ? '0px 8px 32px rgba(0, 0, 0, 0.4), inset 0px 1px 0px rgba(255, 255, 255, 0.05)'
            : '0px 4px 16px rgba(0, 0, 0, 0.1)',
          backdropFilter: 'blur(15px)',
          WebkitBackdropFilter: 'blur(15px)',
        },
        default: {
          shadowColor: isDark ? '#000000' : '#000000',
          shadowOffset: { width: 0, height: isDark ? 8 : 4 },
          shadowOpacity: isDark ? 0.25 : 0.1,
          shadowRadius: isDark ? 15 : 8,
          elevation: isDark ? 12 : 6,
        },
      }),
    },
  ], [isDark, colors.border, cardWidth]);

  const imageContainerStyle = useMemo(() => [
    styles.imageContainer, 
    { backgroundColor: 'transparent' }
  ], []);

  return (
    <TouchableOpacity
      style={containerStyle}
      onPress={handleCardPress}
      activeOpacity={0.7}
    >
      {/* Image Container - with transparency support */}
      <View style={imageContainerStyle}>
        {product.image_url ? (
          <Image
            source={{ uri: product.image_url }}
            style={styles.image}
            contentFit="cover"
            cachePolicy="disk"
            transition={200}
          />
        ) : (
          <Ionicons name="cube-outline" size={48} color={colors.textSecondary} />
        )}
        
        {/* Golden Gift + Discount Badge for Bundle Products */}
        {isInBundle && (
          <View style={styles.bundleIconContainer}>
            <View style={styles.bundleIconBadge}>
              <Ionicons name="gift" size={14} color="#FFD700" />
            </View>
            {bundleOffer && bundleOffer.discount_percentage > 0 && (
              <View style={styles.bundleDiscountBadge}>
                <Text style={styles.bundleDiscountText}>
                  -{bundleOffer.discount_percentage}%
                </Text>
              </View>
            )}
          </View>
        )}

        {/* Calorie chip — only when product.nutrition.calories is populated.
            Pinned to the top-right of the image so it never collides with the
            bundle gift badge (top-left). Position is RTL-agnostic because the
            bundle badge is also pinned to the left in both languages. */}
        {caloriesLabel ? (
          <View style={styles.caloriesChipContainer}>
            <View style={[styles.caloriesChip, isRTL && styles.caloriesChipRTL]}>
              <Ionicons name="flame" size={11} color="#FFD27A" />
              <Text style={styles.caloriesChipText} numberOfLines={1}>
                {caloriesLabel}
              </Text>
            </View>
          </View>
        ) : null}

        {/* Allergen badge row — positioned at the bottom-right of the image.
            Each coloured circle shows a short allergen code (e.g. "G" for
            Gluten, "D" for Dairy). Up to 6 badges; extras collapse to "+N".
            RTL support mirrors the row to the bottom-left. */}
        {allergensList.length > 0 && (
          <View
            style={[
              styles.allergenRow,
              isRTL ? styles.allergenRowRTL : null,
            ]}
          >
            {allergensList.slice(0, 6).map((key) => {
              const entry = ALLERGEN_MAP[key.toLowerCase()];
              if (!entry) return null;
              return (
                <View
                  key={key}
                  style={[
                    styles.allergenBadge,
                    { backgroundColor: entry.color + 'E6' },
                  ]}
                  accessible
                  accessibilityLabel={language === 'ar' ? entry.labelAr : entry.label}
                >
                  <Text style={styles.allergenCode}>{entry.code}</Text>
                </View>
              );
            })}
            {allergensList.length > 6 && (
              <View
                style={[
                  styles.allergenBadge,
                  { backgroundColor: 'rgba(0, 0, 0, 0.58)' },
                ]}
              >
                <Text style={styles.allergenCode}>+{allergensList.length - 6}</Text>
              </View>
            )}
          </View>
        )}
      </View>
      
      <View style={styles.content}>
        {/* Product Name */}
        <Text style={[styles.name, { color: colors.text }]} numberOfLines={2}>
          {displayName}
        </Text>

        {/* Fitment Strip - directly under title, above price.
            Only shown when the product has REAL size variants (e.g. صغير/وسط/كبير).
            STD-only products are excluded via hasFitment; the strip is suppressed. */}
        {hasFitment && (
          <View style={styles.fitmentStripWrap}>
            <FitmentStrip
              mode={uniqueIndicators.size > 1 ? 'interactive' : 'display'}
              variants={
                variantList.length > 0
                  ? variantList
                  : [{ indicator: selectedFitment || String(product.fitment_indicator || '') }]
              }
              selected={selectedFitment || String(product.fitment_indicator || '')}
              onChange={(ind) => {
                setSelectedFitment(ind);
                Animated.sequence([
                  Animated.timing(priceScaleAnim, { toValue: 1.08, duration: 120, useNativeDriver: true }),
                  Animated.timing(priceScaleAnim, { toValue: 1, duration: 120, useNativeDriver: true }),
                ]).start();
              }}
              size="sm"
              hideOutOfStock={false}
            />
          </View>
        )}

        {/* Stock availability dot — shown only when stock_quantity is a known
            positive number. No dot = no stock info or out-of-stock. */}
        {!hasFitment && (() => {
          const sq = product.stock_quantity;
          const qty = sq !== undefined && sq !== null ? Number(sq) : NaN;
          if (!Number.isFinite(qty) || qty <= 0) return null;
          return (
            <View style={[styles.stockDotRow, isRTL && styles.stockDotRowRTL]}>
              <View style={styles.stockDot} />
              <Text style={[styles.stockDotLabel, { color: colors.textSecondary }]}>
                {language === 'ar' ? 'متوفر' : 'In stock'}
              </Text>
            </View>
          );
        })()}

        {showDetails && (
          <View style={styles.detailsContainer}>
            {restaurantPairs.length > 0 ? (
              <View style={[styles.restaurantPillRow, isRTL && styles.restaurantPillRowRTL]}>
                <Ionicons name="restaurant-outline" size={12} color={GOLD_COLOR} style={{ marginTop: 1 }} />
                {restaurantPairs.slice(0, 2).map(({ name, id: rid }) => {
                  if (rid) {
                    return (
                      <TouchableOpacity
                        key={rid}
                        style={styles.restaurantPill}
                        activeOpacity={0.7}
                        onPress={(e) => {
                          e.stopPropagation();
                          router.push(`/car/${rid}`);
                        }}
                        hitSlop={{ top: 6, bottom: 6, left: 4, right: 4 }}
                      >
                        <Text style={[styles.restaurantPillText, styles.restaurantPillTextTappable]} numberOfLines={1}>
                          {name}
                        </Text>
                      </TouchableOpacity>
                    );
                  }
                  return (
                    <View key={name} style={styles.restaurantPill}>
                      <Text style={styles.restaurantPillText} numberOfLines={1}>
                        {name}
                      </Text>
                    </View>
                  );
                })}
                {restaurantPairs.length > 2 && (
                  <View style={styles.restaurantPillMore}>
                    <Text style={styles.restaurantPillMoreText}>
                      {`+${restaurantPairs.length - 2}`}
                    </Text>
                  </View>
                )}
              </View>
            ) : null}
            {product.sku ? (
              <View style={[styles.detailRow, isRTL && styles.detailRowRTL]}>
                <Ionicons name="pricetag-outline" size={13} color={colors.textSecondary} />
                <Text style={[styles.detailText, { color: colors.textSecondary, fontSize: 12 }]} numberOfLines={1}>
                  #{product.sku}
                </Text>
              </View>
            ) : null}
          </View>
        )}
        
        {/* Quantity Selector Row */}
        <View style={[styles.quantityRow, isRTL && styles.quantityRowRTL]}>
          {/* Minus Button */}
          <TouchableOpacity
            onPress={handleDecreaseQuantity}
            style={[
              styles.quantityButton,
              { 
                backgroundColor: quantity > 1 ? colors.primary + '20' : colors.surface,
                borderColor: quantity > 1 ? colors.primary : colors.border,
              },
            ]}
            disabled={quantity <= 1}
          >
            <Ionicons 
              name="remove" 
              size={14} 
              color={quantity > 1 ? colors.primary : colors.textSecondary} 
            />
          </TouchableOpacity>
          
          {/* Quantity Display */}
          <Animated.View
            style={[
              styles.quantityBadge,
              { 
                backgroundColor: colors.primary,
                transform: [{ scale: quantityBounceAnim }],
              },
            ]}
          >
            <Text style={styles.quantityText}>{quantity}</Text>
          </Animated.View>
          
          {/* Plus Button */}
          <TouchableOpacity
            onPress={handleIncreaseQuantity}
            style={[
              styles.quantityButton,
              { 
                backgroundColor: colors.primary + '20',
                borderColor: colors.primary,
              },
            ]}
          >
            <Ionicons name="add" size={14} color={colors.primary} />
          </TouchableOpacity>
        </View>
        
        {/* Footer with Favorites button, Dynamic Price, and Add to Cart button */}
        <View style={[styles.footer, isRTL && styles.footerRTL]}>
          {/* Animated Favorites Button - Left */}
          <AnimatedFavoriteButton
            isFavorite={isFavorite}
            isLoading={favoriteLoading}
            onPress={handleToggleFavorite}
            size={16}
            style={styles.iconButton}
          />
          
          {/* Dynamic Price - Center */}
          <View style={{ alignItems: 'center', flex: 1 }}>
            <Animated.Text 
              style={[
                styles.price, 
                { 
                  color: colors.primary,
                  transform: [{ scale: priceScaleAnim }],
                }
              ]}
            >
              {formattedPrice}
            </Animated.Text>
          </View>
          
          {/* Animated Add to Cart Button - Right */}
          {onAddToCart && (
            <AnimatedCartButton
              ref={cartButtonRef}
              isInCart={addedToCart}
              isLoading={cartLoading}
              onPress={handleAddToCart}
              size={16}
              primaryColor={colors.primary}
              style={styles.iconButton}
              disabled={isSelectedOutOfStock}
            />
          )}
        </View>
      </View>
    </TouchableOpacity>
  );
};

// Export memoized component with custom comparison
export const ProductCard = React.memo(ProductCardComponent, (prevProps, nextProps) => {
  // Compare the calorie value and allergens array directly so a nutrition
  // update flips the chips without a deep equality check on the whole jsonb.
  const prevNut =
    prevProps.product.nutrition && typeof prevProps.product.nutrition === 'object' && !Array.isArray(prevProps.product.nutrition)
      ? (prevProps.product.nutrition as Record<string, unknown>)
      : null;
  const nextNut =
    nextProps.product.nutrition && typeof nextProps.product.nutrition === 'object' && !Array.isArray(nextProps.product.nutrition)
      ? (nextProps.product.nutrition as Record<string, unknown>)
      : null;
  const prevCalories = prevNut?.calories;
  const nextCalories = nextNut?.calories;
  // Shallow-compare allergen arrays by joining to a stable string key.
  const prevAllergens = Array.isArray(prevNut?.allergens) ? (prevNut!.allergens as string[]).join(',') : '';
  const nextAllergens = Array.isArray(nextNut?.allergens) ? (nextNut!.allergens as string[]).join(',') : '';
  // Only re-render if these props change
  return (
    prevProps.product.id === nextProps.product.id &&
    prevProps.product.price === nextProps.product.price &&
    prevProps.product.image_url === nextProps.product.image_url &&
    prevProps.product.name === nextProps.product.name &&
    prevProps.product.name_ar === nextProps.product.name_ar &&
    prevProps.product.compatible_car_model === nextProps.product.compatible_car_model &&
    prevProps.product.compatible_car_model_ar === nextProps.product.compatible_car_model_ar &&
    (prevProps.restaurantNameTag ?? []).join('|') === (nextProps.restaurantNameTag ?? []).join('|') &&
    (prevProps.restaurantIds ?? []).join('|') === (nextProps.restaurantIds ?? []).join('|') &&
    prevProps.cardWidth === nextProps.cardWidth &&
    prevProps.showDetails === nextProps.showDetails &&
    prevCalories === nextCalories &&
    prevAllergens === nextAllergens
  );
});

const styles = StyleSheet.create({
  container: {
    borderRadius: RADII.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: GOLD_COLOR + '55',
    overflow: 'hidden',
    margin: 5,
    ...Platform.select({
      web: { boxShadow: '0px 6px 20px rgba(11, 11, 14, 0.10)' },
      default: {
        shadowColor: '#1B1B1F',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.08,
        shadowRadius: 12,
        elevation: 3,
      },
    }),
  },
  imageContainer: {
    height: 139,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'transparent',
  },
  image: {
    width: '100%',
    height: '100%',
  },
  // Golden Gift Icon for Bundle Products - Premium Look
  bundleIconContainer: {
    position: 'absolute',
    top: 9,
    left: 9,
    zIndex: 10,
  },
  bundleIconBadge: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: '#000000',
    borderWidth: 1.5,
    borderColor: '#FFD700',
    justifyContent: 'center',
    alignItems: 'center',
    // Shadow for premium effect (cross-platform)
    ...Platform.select({
      web: {
        boxShadow: '0px 2px 4px rgba(255, 215, 0, 0.3)',
      },
      default: {
        shadowColor: '#FFD700',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.3,
        shadowRadius: 4,
        elevation: 5,
      },
    }),
  },
  bundleDiscountBadge: {
    marginTop: 3,
    backgroundColor: '#C8A24A',
    borderRadius: 6,
    paddingHorizontal: 5,
    paddingVertical: 2,
    alignSelf: 'center',
  },
  bundleDiscountText: {
    color: '#000',
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.3,
  },
  // Calorie chip lives on the image, opposite the bundle badge. Dark glass
  // pill keeps the value legible over both bright and shadowed dish photos.
  caloriesChipContainer: {
    position: 'absolute',
    top: 9,
    right: 9,
    zIndex: 10,
  },
  caloriesChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255, 210, 122, 0.55)',
  },
  caloriesChipRTL: {
    flexDirection: 'row-reverse',
  },
  caloriesChipText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  brandBadge: {
    position: 'absolute',
    bottom: 5,
    left: 5,
    right: 5,
    paddingHorizontal: 5,
    paddingVertical: 3,
    borderRadius: 4,
  },
  brandBadgeText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '700',
    textAlign: 'center',
  },
  content: {
    padding: 9,
    paddingTop: 5,
  },
  name: {
    ...TYPE.title,
    fontSize: 15,
    fontWeight: '700',
    marginBottom: 5,
    minHeight: 19.9,
    textAlign: 'center',
    letterSpacing: 0.2,
  },
  fitmentStripWrap: {
    alignItems: 'center',
    marginBottom: 6,
  },
  // Subtle availability indicator: green dot + "متوفر/In stock" label.
  // Only rendered when stock_quantity > 0 and no fitment strip is shown.
  stockDotRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    marginBottom: 5,
  },
  stockDotRowRTL: {
    flexDirection: 'row-reverse',
  },
  stockDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: '#22C55E',
  },
  stockDotLabel: {
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.2,
  },
  detailsContainer: {
    marginBottom: 7,
    gap: 5,
    alignItems: 'center',
  },
  detailRow: {
    flexDirection: 'row',
    gap: 5,
  },
  detailRowRTL: {
  flexDirection: 'row-reverse',
  },
  detailText: {
    fontSize: 13,
    flex: 1,
  },
  brandText: {
    fontWeight: '700',
    textAlign: 'center',
  },
  carModelText: {
    fontWeight: '700',
  },
  quantityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 9,
    gap: 9,
  },
  quantityRowRTL: {
    flexDirection: 'row-reverse',
  },
  quantityButton: {
    width: 30,
    height: 30,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.9,
  },
  quantityBadge: {
    minWidth: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 11,
  },
  quantityText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  footerRTL: {
    flexDirection: 'row-reverse',
  },
  price: {
    fontSize: 15,
    fontWeight: '800',
    flex: 1,
    textAlign: 'center',
    letterSpacing: 0.4,
  },
  iconButton: {
    padding: 5,
  },
  // ─── Restaurant pill row (multi-restaurant dish indicator) ───────────────
  restaurantPillRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 4,
    marginBottom: 2,
  },
  restaurantPillRowRTL: {
    flexDirection: 'row-reverse',
  },
  restaurantPill: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 999,
    backgroundColor: GOLD_COLOR + '22',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: GOLD_COLOR + '88',
    maxWidth: 90,
  },
  restaurantPillText: {
    color: GOLD_COLOR,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.1,
  },
  restaurantPillTextTappable: {
    textDecorationLine: 'underline',
  },
  restaurantPillMore: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 999,
    backgroundColor: 'rgba(200, 162, 74, 0.10)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: GOLD_COLOR + '55',
  },
  restaurantPillMoreText: {
    color: GOLD_COLOR,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.1,
  },
  // ─── Allergen badges (bottom of image overlay) ───────────────────────────
  allergenRow: {
    position: 'absolute',
    bottom: 7,
    right: 7,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    zIndex: 10,
    flexWrap: 'nowrap',
  },
  allergenRowRTL: {
    right: undefined,
    left: 7,
    flexDirection: 'row-reverse',
  },
  allergenBadge: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255, 255, 255, 0.45)',
    ...Platform.select({
      web: {
        boxShadow: '0 1px 4px rgba(0, 0, 0, 0.45)',
      },
      default: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.35,
        shadowRadius: 3,
        elevation: 4,
      },
    }),
  },
  allergenCode: {
    color: '#FFFFFF',
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.15,
    textAlign: 'center',
  },
});

export default ProductCard;
