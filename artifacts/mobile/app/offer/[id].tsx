import React, { useEffect, useState, useRef, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Animated,
  Dimensions,
  ActivityIndicator,
  Platform,
  Alert,
} from 'react-native';
import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { useTheme } from '../../src/hooks/useTheme';
import { useTranslation } from '../../src/hooks/useTranslation';
import { useAppStore } from '../../src/store/appStore';
import { useCartStore, uuidV4 } from '../../src/store/useCartStore';
import { cartApi, bundleOfferApi, carModelApi } from '../../src/services/api';
import { Header } from '../../src/components/Header';
import { useCartMutations, useCartQuery, shoppingHubKeys } from '../../src/hooks/queries/useShoppingHubQuery';
import { useQueryClient } from '@tanstack/react-query';
import { AnimatedCartButton, AnimatedCartButtonRef } from '../../src/components/AnimatedIconButton';

const { width } = Dimensions.get('window');

// Placeholder product images when product has no image
const PRODUCT_IMAGES = [
  'https://images.unsplash.com/photo-1486262715619-67b85e0b08d3?w=400',
  'https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=400',
  'https://images.unsplash.com/photo-1619642751034-765dfdf7c58e?w=400',
  'https://images.unsplash.com/photo-1492144534655-ae79c964c9d7?w=400',
  'https://images.unsplash.com/photo-1503376780353-7e6692767b70?w=400',
];

// Color palettes for offers
const COLOR_PALETTES = [
  { accent: '#667EEA', icon: '#FF6B35' },
  { accent: '#11998E', icon: '#FFD93D' },
  { accent: '#FF6B6B', icon: '#4ECDC4' },
  { accent: '#3B82F6', icon: '#F59E0B' },
  { accent: '#EC4899', icon: '#10B981' },
];

interface BundleOffer {
  id: string;
  name: string;
  name_ar?: string;
  description?: string;
  description_ar?: string;
  discount_percentage: number;
  target_car_model_id?: string;
  target_car_model?: any;
  product_ids: string[];
  products?: any[];
  image?: string;
  image_url?: string;
  is_active: boolean;
  original_total?: number;
  discounted_total?: number;
}

export default function OfferDetailsScreen() {
  const { id } = useLocalSearchParams();
  const router = useRouter();
  const { colors, isDark } = useTheme();
  const { t, language, isRTL } = useTranslation();
  const insets = useSafeAreaInsets();
  const { user } = useAppStore();
  const { addBundleToCart, addToCart } = useCartStore();

  // Cart mutations with bidirectional duplicate prevention
  const queryClient = useQueryClient();
  const { checkDuplicate: checkDuplicateFromHook, checkBundleDuplicate } = useCartMutations();
  
  // Fetch cart data to ensure real-time duplicate checking
  const { data: cartItems = [] } = useCartQuery(true);
  
  // Enhanced duplicate check that uses fresh cart data
  const checkDuplicate = useCallback((productId: string): boolean => {
    // First check using the hook's checkDuplicate
    if (checkDuplicateFromHook(productId)) {
      return true;
    }
    
    // Fallback: Also check directly from cartItems
    if (cartItems && cartItems.length > 0) {
      return cartItems.some((item: any) => 
        item.product_id === productId || 
        item.productId === productId ||
        item.id === productId
      );
    }
    
    return false;
  }, [checkDuplicateFromHook, cartItems]);

  // Bundle offer data from API
  const [offer, setOffer] = useState<BundleOffer | null>(null);
  const [carModel, setCarModel] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  // Color palette for styling
  const colorIndex = id ? String(id).charCodeAt(0) % COLOR_PALETTES.length : 0;
  const palette = COLOR_PALETTES[colorIndex];
  
  // Animations
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(30)).current;
  const scaleAnim = useRef(new Animated.Value(0.95)).current;
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const glowAnim = useRef(new Animated.Value(0)).current;
  const cartIconAnim = useRef(new Animated.Value(1)).current;
  const rgbAnim = useRef(new Animated.Value(0)).current;
  const [addingToCart, setAddingToCart] = useState(false);
  const [addedProducts, setAddedProducts] = useState<Set<string>>(new Set());
  
  // Refs for cart buttons to trigger shake animation - using Map for dynamic product refs
  const cartButtonRefs = useRef<Map<string, AnimatedCartButtonRef>>(new Map());
  
  // Callback to set ref for each product
  const setCartButtonRef = useCallback((productId: string, ref: AnimatedCartButtonRef | null) => {
    if (ref) {
      cartButtonRefs.current.set(productId, ref);
    } else {
      cartButtonRefs.current.delete(productId);
    }
  }, []);

  // Fetch bundle offer from API
  useEffect(() => {
    const fetchOffer = async () => {
      if (!id) {
        setError('No offer ID provided');
        setLoading(false);
        return;
      }
      
      setLoading(true);
      setError(null);
      
      try {
        const response = await bundleOfferApi.getById(id as string);
        const offerData = response.data;
        
        if (!offerData) {
          setError('Offer not found');
          setLoading(false);
          return;
        }
        
        setOffer(offerData);
        
        // Fetch car model if available
        if (offerData.target_car_model_id) {
          try {
            const carModelRes = await carModelApi.getById(offerData.target_car_model_id);
            setCarModel(carModelRes.data);
          } catch (carErr) {
            console.error('Error fetching car model:', carErr);
          }
        }
      } catch (err) {
        console.error('Error fetching bundle offer:', err);
        setError('Failed to load offer details');
      } finally {
        setLoading(false);
      }
    };
    
    fetchOffer();
  }, [id]);

  useEffect(() => {
    // Entry animations
    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 500,
        useNativeDriver: true,
      }),
      Animated.timing(slideAnim, {
        toValue: 0,
        duration: 500,
        useNativeDriver: true,
      }),
      Animated.spring(scaleAnim, {
        toValue: 1,
        tension: 60,
        friction: 8,
        useNativeDriver: true,
      }),
    ]).start();

    // Pulse animation
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1.05,
          duration: 1000,
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 1000,
          useNativeDriver: true,
        }),
      ])
    ).start();

    // Glow animation
    Animated.loop(
      Animated.sequence([
        Animated.timing(glowAnim, {
          toValue: 1,
          duration: 2000,
          useNativeDriver: true,
        }),
        Animated.timing(glowAnim, {
          toValue: 0,
          duration: 2000,
          useNativeDriver: true,
        }),
      ])
    ).start();

    // RGB color animation for total price
    Animated.loop(
      Animated.timing(rgbAnim, {
        toValue: 1,
        duration: 4000,
        useNativeDriver: false,
      })
    ).start();
  }, []);

  // Get products from offer
  const products = offer?.products || [];
  
  // Calculate totals from actual products
  const originalTotal = parseFloat(String(offer?.original_total || 0)) || products.reduce((sum, p) => sum + (parseFloat(String(p.price || 0)) || 0), 0);
  const discount = parseFloat(String(offer?.discount_percentage || 0)) || 0;
  const discountAmount = (originalTotal * discount) / 100;
  const finalTotal = parseFloat(String(offer?.discounted_total || 0)) || (originalTotal - discountAmount);

  const getName = (item: any) => {
    return language === 'ar' && item.name_ar ? item.name_ar : item.name;
  };

  const getOfferName = () => {
    if (!offer) return '';
    return language === 'ar' && offer.name_ar ? offer.name_ar : offer.name;
  };

  const getOfferDescription = () => {
    if (!offer) return '';
    return language === 'ar' && offer.description_ar ? offer.description_ar : offer.description;
  };

  const handleAddToCart = useCallback(async (product: any) => {
    if (!user) {
      router.push('/login');
      return;
    }

    // BIDIRECTIONAL: Check if product already exists in cart (as bundle OR normal item)
    if (checkDuplicate(product.id)) {
      // Trigger shake animation on cart button
      const buttonRef = cartButtonRefs.current.get(product.id);
      if (buttonRef) {
        buttonRef.triggerShake();
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
      return;
    }

    setAddingToCart(true);
    try {
      // إضافة منتج واحد مع معلومات الخصم كعرض خاص (bundle_group_id)
      const originalPrice = product.price || 0;
      const discountedPrice = originalPrice * (1 - discount / 100);

      // bundle_group_id MUST be a real UUID — `cart_items.bundle_group_id`
      // is a Postgres `uuid` column and the previous `${offer.id}_${product.id}_${Date.now()}`
      // format failed the INSERT silently (caught by useCartStore's offline
      // queue try/catch), then the post-add refetch wiped the optimistic
      // item and the user saw nothing in the cart. Same fix as the bundle
      // "add all" path above — see uuidV4() in src/store/useCartStore.ts.
      const bundleGroupId = uuidV4();

      addToCart({
        productId: product.id,
        quantity: 1,
        product: product,
        bundleOfferId: offer?.id,
        bundleOfferName: offer?.name,
        bundleDiscount: discount,
        originalPrice: originalPrice,
        discountedPrice: discountedPrice,
        bundleGroupId: bundleGroupId, // This marks it as a special offer item
      });

      await cartApi.add(product.id, 1, {
        bundle_offer_id: offer?.id,
        bundle_discount_percentage: discount,
        bundle_group_id: bundleGroupId, // Send to API to mark as bundle item
      });
      
      // Invalidate cart query for real-time sync
      queryClient.invalidateQueries({ queryKey: shoppingHubKeys.cart });
      
      setAddedProducts(prev => new Set(prev).add(product.id));
      
      // Success feedback
      if (Platform.OS !== 'web') {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      }
    } catch (error) {
      console.error('Error adding to cart:', error);
    } finally {
      setAddingToCart(false);
    }
  }, [user, router, checkDuplicate, language, offer, discount, addToCart, queryClient]);

  /**
   * Bug Fix #1: استخدام addBundleToCart لإضافة كل منتجات العرض المجمع
   * هذا يضمن ربط جميع المنتجات بنفس bundleGroupId وحساب الخصومات الصحيحة
   * 
   * ENHANCED: BIDIRECTIONAL duplicate prevention
   * Check if any product from the bundle is already in cart (as normal item OR bundle item)
   * If so, show "تم إضافة العرض" (Offer Added) alert
   */
  const handleAddAllToCart = async () => {
    if (!user) {
      router.push('/login');
      return;
    }

    if (!offer || products.length === 0) return;

    // BIDIRECTIONAL: Check if ANY product from this bundle is already in cart (normal OR bundle)
    const anyProductInCart = products.some((product: any) => checkDuplicate(product.id));
    
    if (anyProductInCart) {
      // Haptic feedback for warning
      if (Platform.OS !== 'web') {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      }
      Alert.alert(
        language === 'ar' ? 'تنبيه' : 'Notice',
        language === 'ar' ? 'تم إضافة العرض' : 'Offer Already Added',
        [{ text: language === 'ar' ? 'حسناً' : 'OK', style: 'default' }],
        { cancelable: true }
      );
      return;
    }

    setAddingToCart(true);
    try {
      // Use the dedicated bundle helper which generates a single shared
      // bundle_group_id, sets per-item discounted prices, and POSTs each
      // item with the bundle metadata. The id MUST be a real UUID because
      // `cart_items.bundle_group_id` is a Postgres `uuid` column — sending
      // a non-UUID string causes the INSERT to fail and the cart UI ends
      // up empty after the post-add refetch. We pre-generate it here so
      // the optimistic cache patch (below) and the server INSERT use the
      // exact same id.
      const bundleGroupId = uuidV4();

      // OPTIMISTIC PATCH — write the bundle items directly into the
      // React Query cart cache (which is what CartTab reads) so the user
      // sees the items the instant they tap "Add". Previously we relied
      // on invalidateQueries → background refetch, which left a window
      // where the API succeeded but the cart UI was still empty.
      queryClient.setQueryData<any[]>(shoppingHubKeys.cart, (old) => {
        const list = Array.isArray(old) ? [...old] : [];
        for (const product of products) {
          const originalPrice = parseFloat(String(product.price ?? 0)) || 0;
          const finalPrice = originalPrice * (1 - discount / 100);
          list.push({
            __optimistic: true,
            product_id: product.id,
            quantity: 1,
            fitment_indicator: null,
            // Bundle metadata — CartTab keys off bundle_group_id to render
            // the locked "عرض خاص" indicator instead of qty controls.
            bundle_group_id: bundleGroupId,
            bundle_offer_id: offer.id,
            bundle_offer_name: offer.name,
            bundle_discount_percentage: discount,
            // Pricing fields used by getSubtotal / getTotalSavings.
            original_unit_price: originalPrice,
            final_unit_price: finalPrice,
            price: originalPrice,
            // Display fields surfaced by the renderCartItem fallback chain.
            name: product.name,
            name_ar: product.name_ar,
            sku: product.sku,
            image_url: product.image_url,
            stock_quantity: product.stock_quantity,
            product_brand_name: product?.product_brand?.name ?? null,
            compatible_car_models: [],
            available_variants: [],
            product: {
              id: product.id,
              name: product.name,
              name_ar: product.name_ar,
              price: originalPrice,
              image_url: product.image_url,
              sku: product.sku,
              stock_quantity: product.stock_quantity,
            },
          });
        }
        return list;
      });

      // Sync to backend — addBundleToCart awaits each POST. We pass the
      // pre-generated bundleGroupId via an injected helper so the server
      // rows match the optimistic cache entries exactly.
      await addBundleToCart(
        {
          id: offer.id,
          name: offer.name,
          name_ar: offer.name_ar,
          discount_percentage: discount,
          product_ids: offer.product_ids,
          products: products,
          // Internal: hand the precomputed group id to the store so cache
          // and DB rows share the exact same bundle_group_id string.
          _bundle_group_id: bundleGroupId,
        } as any,
        products
      );

      // Final reconciliation pass — invalidate so the next render swaps
      // the __optimistic placeholders for the authoritative server rows
      // (which include any stock/variant data we couldn't synthesize
      // locally). If the server is slow the cart already shows the
      // correct items thanks to the optimistic patch above.
      queryClient.invalidateQueries({ queryKey: shoppingHubKeys.cart });

      setAddedProducts(new Set(products.map(p => p.id)));
      
      // Success feedback
      if (Platform.OS !== 'web') {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
    } catch (error) {
      console.error('Error adding bundle to cart:', error);
      // Roll back the optimistic insert on failure so the cart never
      // shows phantom bundle items.
      queryClient.invalidateQueries({ queryKey: shoppingHubKeys.cart });
    } finally {
      setAddingToCart(false);
    }
  };

  const glowOpacity = glowAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0.3, 0.8],
  });

  // RGB color animation for total price
  const rgbColor = rgbAnim.interpolate({
    inputRange: [0, 0.14, 0.28, 0.42, 0.57, 0.71, 0.85, 1],
    outputRange: [
      '#FF0000', '#FF7F00', '#FFFF00', '#00FF00',
      '#00FFFF', '#0000FF', '#8B00FF', '#FF0000',
    ],
  });

  // Get a placeholder image for each product
  const getProductImage = (product: any, index: number) => {
    if (product.image_url) return product.image_url;
    if (product.images && product.images.length > 0) return product.images[0];
    return PRODUCT_IMAGES[index % PRODUCT_IMAGES.length];
  };

  // Loading state
  if (loading) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <Header showBack={true} title={language === 'ar' ? 'تفاصيل العرض' : 'Offer Details'} />
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={[styles.loadingText, { color: colors.textSecondary }]}>
            {language === 'ar' ? 'جاري التحميل...' : 'Loading...'}
          </Text>
        </View>
      </View>
    );
  }

  // Error state
  if (error || !offer) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <Header showBack={true} title={language === 'ar' ? 'تفاصيل العرض' : 'Offer Details'} />
        <View style={styles.errorContainer}>
          <Ionicons name="alert-circle-outline" size={64} color={colors.error} />
          <Text style={[styles.errorText, { color: colors.text }]}>
            {error || (language === 'ar' ? 'العرض غير موجود' : 'Offer not found')}
          </Text>
          <TouchableOpacity
            style={[styles.retryButton, { backgroundColor: colors.primary }]}
            onPress={() => router.back()}
          >
            <Text style={styles.retryButtonText}>
              {language === 'ar' ? 'العودة' : 'Go Back'}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Header */}
      <Header showBack={true} title={language === 'ar' ? 'تفاصيل العرض' : 'Offer Details'} />

      {/* Offer Image Header */}
      {(offer.image_url || offer.image) && (
        <View style={styles.offerImageContainer}>
          <Image source={{ uri: offer.image_url || offer.image }} style={styles.offerImage} contentFit="cover" cachePolicy="memory-disk" />
          <LinearGradient
            colors={['transparent', 'rgba(0,0,0,0.7)']}
            style={styles.imageGradientOverlay}
          />
        </View>
      )}

      <ScrollView 
        style={styles.scrollView}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
      >
        {/* Offer Title Section */}
        <Animated.View style={[styles.titleSection, { opacity: fadeAnim }]}>
          <Text style={[styles.offerTitle, { color: colors.text }]}>
            {getOfferName()}
          </Text>
          {getOfferDescription() && (
            <Text style={[styles.offerDescription, { color: colors.textSecondary }]}>
              {getOfferDescription()}
            </Text>
          )}
        </Animated.View>

        {/* Restaurant Badge - Modern Style */}
        {(carModel || offer.target_car_model) && (
          <Animated.View style={[styles.carBadgeSection, { opacity: fadeAnim }]}>
            <TouchableOpacity
              style={[styles.carModelBadge, { backgroundColor: isDark ? '#2a2a3e' : '#FFF' }]}
              onPress={() => router.push(`/car/${carModel?.id || offer.target_car_model?.id}`)}
              activeOpacity={0.8}
            >
              <View style={[styles.carIconContainer, { backgroundColor: palette.accent + '20' }]}>
                <Ionicons name="restaurant" size={22} color={palette.accent} />
              </View>
              <View style={styles.carTextContainer}>
                <Text style={[styles.carLabel, { color: colors.textSecondary }]}>
                  {language === 'ar' ? 'متاح في مطعم' : 'Available at'}
                </Text>
                <Text style={[styles.carModelText, { color: colors.text }]}>
                  {language === 'ar' 
                    ? (carModel?.name_ar || offer.target_car_model?.name_ar || carModel?.name || offer.target_car_model?.name)
                    : (carModel?.name || offer.target_car_model?.name)}
                </Text>
              </View>
              <View style={[styles.carArrowContainer, { backgroundColor: palette.accent }]}>
                <Ionicons name={isRTL ? 'chevron-back' : 'chevron-forward'} size={18} color="#FFF" />
              </View>
            </TouchableOpacity>
          </Animated.View>
        )}

        {/* Discount Banner - Premium Design */}
        <Animated.View 
          style={[
            styles.discountBanner,
            { transform: [{ scale: scaleAnim }] }
          ]}
        >
          <LinearGradient
            colors={[palette.accent, palette.icon]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.discountGradient}
          >
            <View style={styles.discountDecoLeft} />
            <View style={styles.discountDecoRight} />
            
            <View style={styles.discountContent}>
              <View style={styles.discountLeft}>
                <View style={styles.discountTitleRow}>
                  <Ionicons name="gift" size={20} color="#1a1a2e" />
                  <Text style={styles.discountTitle}>
                    {language === 'ar' ? 'عرض حصري' : 'Exclusive Offer'}
                  </Text>
                </View>
                <Text style={styles.discountSubtitle}>
                  {language === 'ar' 
                    ? `وفر ${discount}% على مشترياتك`
                    : `Save ${discount}% on your purchase`
                  }
                </Text>
              </View>
              
              <Animated.View style={[styles.discountCircle, { transform: [{ scale: pulseAnim }] }]}>
                <Text style={styles.discountPercentage}>{discount}%</Text>
                <Text style={styles.discountOff}>{language === 'ar' ? 'خصم' : 'OFF'}</Text>
              </Animated.View>
            </View>
          </LinearGradient>
        </Animated.View>

        {/* Products Section */}
        <View style={styles.productsSection}>
          <View style={styles.sectionHeader}>
            <View style={styles.sectionTitleRow}>
              <View style={[styles.sectionIcon, { backgroundColor: palette.accent + '20' }]}>
                <Ionicons name="cube" size={18} color={palette.accent} />
              </View>
              <Text style={[styles.sectionTitle, { color: colors.text }]}>
                {language === 'ar' ? 'منتجات العرض' : 'Offer Products'}
              </Text>
            </View>
            <View style={[styles.productCount, { backgroundColor: palette.accent + '15' }]}>
              <Text style={[styles.productCountText, { color: palette.accent }]}>
                {products.length} {language === 'ar' ? 'منتجات' : 'items'}
              </Text>
            </View>
          </View>
          
          {products.length === 0 ? (
            <View style={styles.emptyProductsContainer}>
              <Ionicons name="cube-outline" size={48} color={colors.textSecondary} />
              <Text style={[styles.emptyProductsText, { color: colors.textSecondary }]}>
                {language === 'ar' ? 'لا توجد منتجات في هذا العرض' : 'No products in this offer'}
              </Text>
            </View>
          ) : (
            products.map((product, index) => (
              <Animated.View
                key={product.id}
                style={[
                  styles.productCard,
                  { 
                    backgroundColor: isDark ? '#1e1e2e' : '#FFFFFF',
                    opacity: fadeAnim,
                    transform: [{ translateY: Animated.multiply(slideAnim, new Animated.Value(0.3 * (index + 1))) }],
                  }
                ]}
              >
                <View style={[styles.productNumberBadge, { backgroundColor: palette.accent }]}>
                  <Text style={styles.productNumber}>{index + 1}</Text>
                </View>

                <TouchableOpacity 
                  style={styles.productImageContainer}
                  onPress={() => router.push(`/product/${product.id}`)}
                  activeOpacity={0.8}
                >
                  <Image 
                    source={{ uri: getProductImage(product, index) }}
                    style={styles.productImage}
                    contentFit="cover"
                    cachePolicy="memory-disk"
                  />
                  <LinearGradient
                    colors={['transparent', 'rgba(0,0,0,0.3)']}
                    style={styles.productImageGradient}
                  />
                  <View style={styles.viewProductBadge}>
                    <Ionicons name="eye" size={12} color="#FFF" />
                    <Text style={styles.viewProductText}>
                      {language === 'ar' ? 'عرض' : 'View'}
                    </Text>
                  </View>
                </TouchableOpacity>
                
                <View style={styles.productInfo}>
                  <TouchableOpacity onPress={() => router.push(`/product/${product.id}`)}>
                    <Text style={[styles.productName, { color: colors.text }]} numberOfLines={2}>
                      {getName(product)}
                    </Text>
                  </TouchableOpacity>
                  
                  <View style={styles.productMeta}>
                    <View style={[styles.skuBadge, { backgroundColor: isDark ? '#2a2a3e' : '#f0f0f0' }]}>
                      <Ionicons name="barcode-outline" size={12} color={colors.textSecondary} />
                      <Text style={[styles.productSku, { color: colors.textSecondary }]}>
                        {product.sku || 'N/A'}
                      </Text>
                    </View>
                  </View>
                  
                  <View style={styles.priceContainer}>
                    <Text style={[styles.productPrice, { color: palette.accent }]}>
                      {(parseFloat(String(product.price || 0)) || 0).toFixed(2)}
                    </Text>
                    <Text style={[styles.priceCurrency, { color: palette.accent }]}>
                      ج.م
                    </Text>
                  </View>
                </View>

                {/* AnimatedCartButton with ref for shake animation */}
                <AnimatedCartButton
                  ref={(ref) => setCartButtonRef(product.id, ref)}
                  isInCart={addedProducts.has(product.id)}
                  isLoading={addingToCart}
                  onPress={() => handleAddToCart(product)}
                  size={22}
                  primaryColor={palette.accent}
                  style={styles.addButton}
                />
              </Animated.View>
            ))
          )}
        </View>

        {/* Add All to Cart Button */}
        {products.length > 0 && (
          <TouchableOpacity
            style={styles.addAllButton}
            onPress={handleAddAllToCart}
            disabled={addingToCart}
            activeOpacity={0.9}
          >
            <LinearGradient
              colors={[palette.accent, palette.icon]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.addAllGradient}
            >
              {addingToCart ? (
                <View style={styles.addAllLoadingContainer}>
                  <ActivityIndicator color="#FFF" size="small" />
                </View>
              ) : (
                <>
                  <View style={styles.priceInfoSection}>
                    <View style={styles.priceInfoRow}>
                      <View style={styles.priceInfoLeft}>
                        <Ionicons name="pricetag-outline" size={14} color="rgba(255,255,255,0.7)" />
                        <Text style={styles.priceInfoLabel}>
                          {language === 'ar' ? 'السعر الأصلي' : 'Original Price'}
                        </Text>
                      </View>
                      <Text style={styles.originalPriceValue}>
                        {originalTotal.toFixed(2)} ج.م
                      </Text>
                    </View>

                    <View style={styles.priceInfoRow}>
                      <View style={styles.priceInfoLeft}>
                        <Ionicons name="gift" size={14} color="#FFD93D" />
                        <Animated.Text style={[styles.priceInfoLabel, { color: rgbColor }]}>
                          {language === 'ar' ? `خصم ${discount}%` : `${discount}% Discount`}
                        </Animated.Text>
                      </View>
                      <Animated.Text style={[styles.discountValue, { color: rgbColor }]}>
                        -{discountAmount.toFixed(2)} ج.م
                      </Animated.Text>
                    </View>
                  </View>

                  <View style={styles.barDivider} />

                  <View style={styles.mainActionSection}>
                    <Animated.View 
                      style={[styles.addAllIconContainer, { transform: [{ scale: pulseAnim }] }]}
                    >
                      <View style={styles.cartIconCircle}>
                        <Ionicons name="cart" size={24} color="#FFF" />
                      </View>
                      <Animated.View 
                        style={[styles.cartIconRing, { borderColor: '#FFF', opacity: glowOpacity }]} 
                      />
                    </Animated.View>

                    <View style={styles.addAllCenterContent}>
                      <Text style={styles.addAllText}>
                        {language === 'ar' ? 'إضافة الكل للسلة' : 'Add All to Cart'}
                      </Text>
                      <Text style={styles.addAllSubtext}>
                        {products.length} {language === 'ar' ? 'منتجات' : 'products'}
                      </Text>
                    </View>

                    <View style={styles.addAllPriceSection}>
                      <Text style={styles.addAllTotalLabel}>
                        {language === 'ar' ? 'الإجمالي' : 'Total'}
                      </Text>
                      <View style={styles.addAllPriceRow}>
                        <Animated.Text style={[styles.addAllPrice, { color: rgbColor }]}>
                          {finalTotal.toFixed(2)}
                        </Animated.Text>
                        <Animated.Text style={[styles.addAllCurrency, { color: rgbColor }]}>
                          ج.م
                        </Animated.Text>
                      </View>
                    </View>
                  </View>
                </>
              )}
            </LinearGradient>
          </TouchableOpacity>
        )}

        <View style={{ height: 40 }} />
      </ScrollView>

      {/* Footer / Bottom Navigation */}
      <View style={[styles.footer, { backgroundColor: colors.card, borderTopColor: colors.border }]}>
        <TouchableOpacity style={styles.footerItem} onPress={() => router.push('/')}>
          <Ionicons name="home-outline" size={22} color={colors.textSecondary} />
          <Text style={[styles.footerText, { color: colors.textSecondary }]}>
            {language === 'ar' ? 'الرئيسية' : 'Home'}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.footerItem} onPress={() => router.push('/(tabs)/categories')}>
          <Ionicons name="grid-outline" size={22} color={colors.textSecondary} />
          <Text style={[styles.footerText, { color: colors.textSecondary }]}>
            {language === 'ar' ? 'الفئات' : 'Categories'}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.footerItem} onPress={() => router.push('/(tabs)/cart')}>
          <Ionicons name="cart-outline" size={22} color={colors.textSecondary} />
          <Text style={[styles.footerText, { color: colors.textSecondary }]}>
            {language === 'ar' ? 'السلة' : 'Cart'}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.footerItem} onPress={() => router.push('/(tabs)/profile')}>
          <Ionicons name="person-outline" size={22} color={colors.textSecondary} />
          <Text style={[styles.footerText, { color: colors.textSecondary }]}>
            {language === 'ar' ? 'الملف' : 'Profile'}
          </Text>
        </TouchableOpacity>
      </View>
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
  loadingText: {
    marginTop: 12,
    fontSize: 14,
  },
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  errorText: {
    fontSize: 16,
    marginTop: 16,
    marginBottom: 20,
    textAlign: 'center',
  },
  retryButton: {
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 8,
  },
  retryButtonText: {
    color: '#FFF',
    fontWeight: '600',
  },
  offerImageContainer: {
    height: 180,
    position: 'relative',
  },
  offerImage: {
    width: '100%',
    height: '100%',
  },
  imageGradientOverlay: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 60,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingTop: 12,
  },
  titleSection: {
    marginBottom: 16,
  },
  offerTitle: {
    fontSize: 24,
    fontWeight: '800',
    marginBottom: 8,
  },
  offerDescription: {
    fontSize: 14,
    lineHeight: 20,
  },
  carBadgeSection: {
    marginBottom: 16,
  },
  carModelBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 16,
    ...Platform.select({
      web: { boxShadow: '0 4px 15px rgba(0,0,0,0.08)' },
      default: { elevation: 4, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.08, shadowRadius: 8 },
    }),
  },
  carIconContainer: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  carTextContainer: {
    flex: 1,
    marginLeft: 14,
  },
  carLabel: {
    fontSize: 11,
    fontWeight: '500',
    marginBottom: 2,
  },
  carModelText: {
    fontSize: 15,
    fontWeight: '700',
  },
  carArrowContainer: {
    width: 32,
    height: 32,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  discountBanner: {
    marginBottom: 20,
    borderRadius: 20,
    overflow: 'hidden',
  },
  discountGradient: {
    padding: 20,
    position: 'relative',
    overflow: 'hidden',
  },
  discountDecoLeft: {
    position: 'absolute',
    left: -30,
    top: -30,
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: 'rgba(255,255,255,0.15)',
  },
  discountDecoRight: {
    position: 'absolute',
    right: -20,
    bottom: -40,
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: 'rgba(255,255,255,0.1)',
  },
  discountContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  discountLeft: {
    flex: 1,
    paddingRight: 16,
  },
  discountTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 6,
  },
  discountTitle: {
    color: '#1a1a2e',
    fontSize: 18,
    fontWeight: '800',
  },
  discountSubtitle: {
    color: '#1a1a2e',
    fontSize: 14,
    fontWeight: '600',
    opacity: 0.9,
  },
  discountCircle: {
    width: 70,
    height: 70,
    borderRadius: 35,
    backgroundColor: '#1a1a2e',
    alignItems: 'center',
    justifyContent: 'center',
    ...Platform.select({
      web: { boxShadow: '0 8px 25px rgba(0,0,0,0.3)' },
      default: { elevation: 10, shadowColor: '#000', shadowOffset: { width: 0, height: 5 }, shadowOpacity: 0.3, shadowRadius: 10 },
    }),
  },
  discountPercentage: {
    color: '#FFD93D',
    fontSize: 22,
    fontWeight: '900',
  },
  discountOff: {
    color: '#FFD93D',
    fontSize: 10,
    fontWeight: '700',
    marginTop: -2,
  },
  productsSection: {
    marginBottom: 20,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  sectionTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  sectionIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '700',
  },
  productCount: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
  },
  productCountText: {
    fontSize: 12,
    fontWeight: '700',
  },
  emptyProductsContainer: {
    alignItems: 'center',
    paddingVertical: 40,
  },
  emptyProductsText: {
    marginTop: 12,
    fontSize: 14,
  },
  productCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    borderRadius: 16,
    marginBottom: 12,
    position: 'relative',
    ...Platform.select({
      web: { boxShadow: '0 4px 15px rgba(0,0,0,0.06)' },
      default: { elevation: 3, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 8 },
    }),
  },
  productNumberBadge: {
    position: 'absolute',
    top: -6,
    left: -6,
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
  },
  productNumber: {
    color: '#FFF',
    fontSize: 12,
    fontWeight: '800',
  },
  productImageContainer: {
    width: 85,
    height: 85,
    borderRadius: 14,
    overflow: 'hidden',
    position: 'relative',
  },
  productImage: {
    width: '100%',
    height: '100%',
  },
  productImageGradient: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 30,
  },
  viewProductBadge: {
    position: 'absolute',
    bottom: 6,
    left: 6,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(0,0,0,0.6)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
  },
  viewProductText: {
    color: '#FFF',
    fontSize: 10,
    fontWeight: '600',
  },
  productInfo: {
    flex: 1,
    marginLeft: 14,
  },
  productName: {
    fontSize: 15,
    fontWeight: '700',
    marginBottom: 6,
    lineHeight: 20,
  },
  productMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  skuBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    gap: 4,
  },
  productSku: {
    fontSize: 11,
    fontWeight: '500',
  },
  priceContainer: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 4,
  },
  productPrice: {
    fontSize: 20,
    fontWeight: '800',
  },
  priceCurrency: {
    fontSize: 12,
    fontWeight: '700',
  },
  addButton: {
    width: 50,
    height: 50,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    ...Platform.select({
      web: { boxShadow: '0 4px 15px rgba(0,0,0,0.2)' },
      default: { elevation: 6, shadowColor: '#000', shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.2, shadowRadius: 6 },
    }),
  },
  addAllButton: {
    borderRadius: 20,
    overflow: 'hidden',
    marginBottom: 10,
    ...Platform.select({
      web: { boxShadow: '0 8px 25px rgba(0,0,0,0.3)' },
      default: { elevation: 10, shadowColor: '#000', shadowOffset: { width: 0, height: 5 }, shadowOpacity: 0.3, shadowRadius: 12 },
    }),
  },
  addAllGradient: {
    flexDirection: 'column',
    paddingVertical: 14,
    paddingHorizontal: 18,
  },
  addAllLoadingContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 30,
  },
  priceInfoSection: {
    marginBottom: 12,
  },
  priceInfoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 6,
  },
  priceInfoLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  priceInfoLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: 'rgba(255,255,255,0.7)',
  },
  originalPriceValue: {
    fontSize: 14,
    fontWeight: '600',
    color: 'rgba(255,255,255,0.6)',
    textDecorationLine: 'line-through',
  },
  discountValue: {
    fontSize: 14,
    fontWeight: '700',
  },
  barDivider: {
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.15)',
    marginBottom: 12,
  },
  mainActionSection: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  addAllIconContainer: {
    width: 52,
    height: 52,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  cartIconCircle: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cartIconRing: {
    position: 'absolute',
    width: 52,
    height: 52,
    borderRadius: 26,
    borderWidth: 2,
  },
  addAllCenterContent: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addAllText: {
    fontSize: 16,
    fontWeight: '800',
    color: '#FFFFFF',
    textAlign: 'center',
  },
  addAllSubtext: {
    fontSize: 11,
    fontWeight: '500',
    color: 'rgba(255,255,255,0.7)',
    marginTop: 2,
    textAlign: 'center',
  },
  addAllPriceSection: {
    alignItems: 'flex-end',
  },
  addAllTotalLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: 'rgba(255,255,255,0.85)',
    marginBottom: 4,
  },
  addAllPriceRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 4,
  },
  addAllPrice: {
    fontSize: 22,
    fontWeight: '900',
  },
  addAllCurrency: {
    fontSize: 12,
    fontWeight: '700',
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingVertical: 12,
    borderTopWidth: 1,
  },
  footerItem: {
    alignItems: 'center',
    paddingVertical: 4,
    paddingHorizontal: 16,
  },
  footerText: {
    fontSize: 11,
    fontWeight: '600',
    marginTop: 4,
  },
});
