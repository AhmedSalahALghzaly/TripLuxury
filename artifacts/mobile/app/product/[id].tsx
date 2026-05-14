import React, { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  Keyboard,
  Animated as RNAnimated,
  Dimensions,
} from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Header } from '../../src/components/Header';
import { Footer } from '../../src/components/Footer';
import { useTheme } from '../../src/hooks/useTheme';
import { useTranslation } from '../../src/hooks/useTranslation';
import { useAppStore } from '../../src/store/appStore';
import type { LocalComment } from '../../src/store/appStore';
import { productsApi, cartApi, commentsApi, favoritesApi } from '../../src/services/api';
import { AnimatedFavoriteButton, AnimatedCartButton } from '../../src/components/AnimatedIconButton';
import { useBundleProducts } from '../../src/hooks/queries/useBundleProducts';
import { useConfirmModal } from '../../src/components/ConfirmModal';
import FitmentStrip from '../../src/components/FitmentStrip';
import { useCartMutations, shoppingHubKeys } from '../../src/hooks/queries/useShoppingHubQuery';
import { useQueryClient } from '@tanstack/react-query';
import Animated, { 
  useSharedValue, 
  useAnimatedStyle, 
  withSpring, 
  withSequence, 
  withTiming,
  interpolate,
  interpolateColor,
  Extrapolation,
  Easing,
  runOnJS,
  useAnimatedScrollHandler,
} from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import { TYPE, SPACING, RADII, ELEVATION, GRADIENTS } from '../../src/constants/luxuryTokens';
const { width: screenWidth } = Dimensions.get('window');
const GOLD_COLOR = '#C8A24A';
const HERO_HEIGHT = 460;
type DishTabKey = 'description' | 'ingredients' | 'pairing' | 'nutrition';

// Check if user can view entity profiles
const canViewEntityProfile = (userRole?: string, subscriptionStatus?: string, userObjRole?: string): boolean => {
  const allowedRoles = ['owner', 'admin', 'partner', 'subscriber'];
  return (
    allowedRoles.includes(userRole || '') ||
    allowedRoles.includes(userObjRole || '') ||
    subscriptionStatus === 'subscriber'
  );
};

interface Comment {
  id: string;
  product_id: string;
  user_id: string;
  user_name: string;
  user_picture?: string;
  text: string;
  rating?: number;
  created_at: string;
  is_owner: boolean;
}

interface CarModelCardProps {
  model: any;
  cardWidth: number;
  onPress: (id: string) => void;
  getName: (item: any) => string;
  colors: any;
}

const CarModelCard = React.memo<CarModelCardProps>(({ model, cardWidth, onPress, getName, colors }) => {
  // Use an intermediate variable for clarity and consistency
  const modelImage = model.image_url;
  // Get brand info for display
  const brandInfo = model.brand || model.car_brand;
  const brandName = brandInfo ? (brandInfo.name_ar || brandInfo.name || '') : '';

  return (
    <TouchableOpacity
      style={[
        carModelCardStyles.card, 
        { 
          width: cardWidth, 
          backgroundColor: colors.surface, 
          borderColor: colors.border,
          shadowColor: colors.text,
        }
      ]}
      onPress={() => onPress(model.id)}
      activeOpacity={0.85}
    >
      {/* Image Container with proper aspect ratio */}
      <View style={[carModelCardStyles.imageContainer, { backgroundColor: colors.background }]}>
        {modelImage ? (
          <Image
            source={{ uri: modelImage }}
            style={carModelCardStyles.image}
            contentFit="cover"
            transition={200}
            cachePolicy="disk"
          />
        ) : (
          <View style={carModelCardStyles.placeholderContainer}>
            <Ionicons name="restaurant" size={36} color={colors.textSecondary} />
          </View>
        )}
      </View>
      
      {/* Info Container */}
      <View style={carModelCardStyles.infoContainer}>
        {/* Model Name */}
        <Text style={[carModelCardStyles.modelName, { color: colors.text }]} numberOfLines={1}>
          {getName(model)}
        </Text>
        
        {brandName ? (
          <Text style={[carModelCardStyles.brandName, { color: colors.primary }]} numberOfLines={1}>
            {brandName}
          </Text>
        ) : null}
      </View>
    </TouchableOpacity>
  );
});

// Dedicated styles for CarModelCard - Professional and Clean
const carModelCardStyles = StyleSheet.create({
  card: {
    borderRadius: 15,
    borderWidth: 1.9,
    overflow: 'hidden',
    // Professional shadow
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 6,
    elevation: 3,
  },
  imageContainer: {
    width: '100%',
    aspectRatio: 1.5, // Optimal ratio for images
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
  },
  image: {
    width: '100%',
    height: '100%',
  },
  placeholderContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  infoContainer: {
    padding: 1.9 ,
    alignItems: 'center',
    minHeight: 55,
    justifyContent: 'center',
  },
  modelName: {
    fontSize: 11.9,
    fontWeight: '700',
    textAlign: 'center',
    lineHeight: 15.9,
  },
  brandName: {
    fontSize: 11,
    fontWeight: '700',
    textAlign: 'center',
    marginTop: 3,
  },
  yearBadge: {
    marginTop: 1,
    paddingHorizontal: 3,
    paddingVertical: 1.5,
    borderRadius: 9,
    textAlign: 'center',
  },
  yearText: {
    fontSize: 10.5,
    fontWeight: '700',
    textAlign: 'center',
  },
});

export default function ProductDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { colors } = useTheme();
  const { t, isRTL, language } = useTranslation();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { showConfirm, ConfirmModalNode } = useConfirmModal();
  const { user, addToLocalCart, addLocalComment, deleteLocalComment, getProductComments } = useAppStore();
  const subscriptionStatus = useAppStore((state) => state.subscriptionStatus);
  const userRole = useAppStore((state) => state.userRole);
  const localComments = useAppStore((state) => state.localComments);

  // Check if this product is in any active bundle
  const { isProductInBundle } = useBundleProducts();
  const isInBundle = id ? isProductInBundle(id) : false;

  // Cart mutations with duplicate prevention
  const queryClient = useQueryClient();
  const { checkBundleDuplicate, addToCart: addToCartMutation } = useCartMutations();

  // Check if user should see subscribe button (not a subscriber and no pending request)
  const productPrivilegedRoles = ['owner', 'admin', 'partner', 'subscriber'];
  const showSubscribeButton =
    subscriptionStatus === 'none' &&
    !productPrivilegedRoles.includes(userRole || '') &&
    !productPrivilegedRoles.includes(user?.role || '');
  
  // RBAC: Check if user can view entity profiles
  const canViewProfile = canViewEntityProfile(userRole, subscriptionStatus, user?.role);
  
  // Golden Glow Animation for restricted access
  const glowProgress = useSharedValue(0);
  const [isGlowing, setIsGlowing] = useState(false);
  
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

  const [product, setProduct] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [addingToCart, setAddingToCart] = useState(false);
  const [quantity, setQuantity] = useState(1);
  const [selectedFitment, setSelectedFitment] = useState<string | null>(null);
  
  // Image slider state
  const [selectedImageIndex, setSelectedImageIndex] = useState(0);
  const [productImages, setProductImages] = useState<string[]>([]);
  
  // Favorites state
  const [isFavorite, setIsFavorite] = useState(false);
  const [favoriteLoading, setFavoriteLoading] = useState(false);
  
  // Comments state
  const [comments, setComments] = useState<Comment[]>([]);
  const [commentsLoading, setCommentsLoading] = useState(false);
  const [avgRating, setAvgRating] = useState<number | null>(null);
  const [ratingCount, setRatingCount] = useState(0);
  
  // New comment form
  const [commentText, setCommentText] = useState('');
  const [selectedRating, setSelectedRating] = useState(0);
  const [submittingComment, setSubmittingComment] = useState(false);
  const [showCommentForm, setShowCommentForm] = useState(false);

  // Active tab on the dish detail strip
  const [activeTab, setActiveTab] = useState<DishTabKey>('description');

  // Parallax scroll value for hero photography
  const scrollY = useSharedValue(0);
  const scrollHandler = useAnimatedScrollHandler({
    onScroll: (event) => {
      scrollY.value = event.contentOffset.y;
    },
  });

  const { carGridNumColumns, carGridCardWidth } = useMemo(() => {
    const MIN_COLUMNS = 5;
    const PADDING_HORIZONTAL = 10; // Total horizontal padding of the container (5 each side)
    const GAP = 5; // Gap between cards
    const availableWidth = screenWidth - PADDING_HORIZONTAL;
    const totalInternalGaps = GAP * (MIN_COLUMNS - 1);
    const cardWidth = (availableWidth - totalInternalGaps) / MIN_COLUMNS;

    return { carGridNumColumns: MIN_COLUMNS, carGridCardWidth: cardWidth };
  }, [screenWidth]);

  useEffect(() => {
    fetchProduct();
  }, [id]);

  useEffect(() => {
    if (id) {
      fetchComments();
      if (user) {
        checkFavoriteStatus();
      }
    }
  }, [id, user]);

  // Set up product images when product is loaded
  useEffect(() => {
    if (product) {
      const images: string[] = [];
      // Add images array first
      if (product.images && product.images.length > 0) {
        images.push(...product.images);
      } 
      // Add image_url if exists and not already in images
      else if (product.image_url && !images.includes(product.image_url)) {
        images.push(product.image_url);
      }
      setProductImages(images);
      setSelectedImageIndex(0);
    }
  }, [product]);

  const fetchProduct = useCallback(async () => {
    if (!id) return;
    try {
      const response = await productsApi.getById(id);
      setProduct(response.data);
      const variants: any[] = response.data?.available_variants || [];
      if (variants.length > 0) {
        const inStock = variants.filter((v: any) => (v.stock ?? 0) > 0);
        const def = inStock.find((v: any) => v.indicator === 'STD') || inStock[0] || variants[0];
        setSelectedFitment(def?.indicator || null);
      } else {
        setSelectedFitment(null);
      }
    } catch (error) {
      console.error('Error fetching product:', error);
    } finally {
      setLoading(false);
    }
  }, [id]);

  const localCommentsRef = React.useRef(localComments);
  React.useEffect(() => { localCommentsRef.current = localComments; }, [localComments]);

  const fetchComments = useCallback(async () => {
    if (!id) return;
    setCommentsLoading(true);
    try {
      const response = await commentsApi.getProductComments(id);
      const serverComments = response.data.comments || [];
      setComments(serverComments);
      const rawAvg = response.data.avg_rating;
      setAvgRating(rawAvg != null && rawAvg !== undefined ? parseFloat(String(rawAvg)) : null);
      setRatingCount(response.data.rating_count || 0);
    } catch (error) {
      console.error('Error fetching comments from server, using local comments:', error);
      const current = localCommentsRef.current;
      const productLocalComments = current.filter((c: LocalComment) => c.product_id === id);
      setComments(productLocalComments);
      const ratingsFromLocal = productLocalComments.filter((c: LocalComment) => c.rating && c.rating > 0);
      if (ratingsFromLocal.length > 0) {
        const avg = ratingsFromLocal.reduce((sum: number, c: LocalComment) => sum + (c.rating || 0), 0) / ratingsFromLocal.length;
        setAvgRating(avg);
        setRatingCount(ratingsFromLocal.length);
      } else {
        setAvgRating(null);
        setRatingCount(0);
      }
    } finally {
      setCommentsLoading(false);
    }
  }, [id]);

  const checkFavoriteStatus = useCallback(async () => {
    if (!id || !user) return;
    try {
      const response = await favoritesApi.check(id);
      setIsFavorite(response.data.is_favorite);
    } catch (error) {
      console.error('Error checking favorite status:', error);
    }
  }, [id, user]);

  const handleToggleFavorite = useCallback(async () => {
    if (!user) {
      router.push('/login');
      return;
    }
    if (!id) return;

    setFavoriteLoading(true);
    try {
      const response = await favoritesApi.toggle(id);
      setIsFavorite(response.data.is_favorite);
    } catch (error) {
      console.error('Error toggling favorite:', error);
      Alert.alert(t('error'));
    } finally {
      setFavoriteLoading(false);
    }
  }, [id, user, router, t]);

  const handleAddToCart = useCallback(async () => {
    if (!user) {
      router.push('/login');
      return;
    }
    if (!product) return;

    if (checkBundleDuplicate(product.id)) {
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
      const variants: any[] = product.available_variants || [];
      const variant = variants.find((v: any) => v.indicator === selectedFitment);
      const targetId = variant?.id || product.id;
      const indicator = selectedFitment || null;
      // Route through useCartMutations so that bundle-conflict, out_of_stock,
      // and stock_exceeded errors are surfaced consistently across the app
      // (the mutation handles its own Arabic/English Alerts and cart cache
      // invalidation in onSuccess/onError).
      await addToCartMutation.mutateAsync({
        productId: targetId,
        quantity,
        fitmentIndicator: indicator,
      });
      // Mirror the optimistic local-cart write so the floating cart badge and
      // any non-React-Query consumers stay in sync immediately.
      addToLocalCart({
        product_id: targetId,
        quantity,
        product: { ...product, id: targetId, fitment_indicator: indicator, price: variant?.price ?? product.price },
        fitment_indicator: indicator,
      });
      if (Platform.OS !== 'web') {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
      Alert.alert(
        '',
        (language === 'ar' ? 'أُضيف إلى الطلب ' : 'Added to your order ') + ' ✓',
        [{ text: 'OK' }],
      );
      setQuantity(1);
    } catch (error: any) {
      // Errors already surfaced by the mutation's onError handler:
      //   • DUPLICATE_PRODUCT / BUNDLE_DUPLICATE → user-friendly alert
      //   • out_of_stock / stock_exceeded → Arabic alert
      // Only show a generic fallback for truly unknown failures.
      const detail = error?.response?.data?.detail;
      const known =
        error?.message === 'DUPLICATE_PRODUCT' ||
        error?.message === 'BUNDLE_DUPLICATE' ||
        detail === 'out_of_stock' ||
        detail === 'stock_exceeded';
      if (!known) {
        console.error('Error adding to cart:', error);
        Alert.alert(t('error'));
      }
    } finally {
      setAddingToCart(false);
    }
  }, [user, product, quantity, selectedFitment, checkBundleDuplicate, router, language, t, addToCartMutation, addToLocalCart]);

  const handleSubmitComment = useCallback(async () => {
    if (!user) {
      router.push('/login');
      return;
    }
    if (!id) return;

    if (!commentText.trim()) {
      Alert.alert(language === 'ar' ? 'يرجى كتابة تعليق' : 'Please enter a comment');
      return;
    }

    setSubmittingComment(true);
    
    // Create a local comment object
    const newComment: LocalComment = {
      id: `local_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      product_id: id,
      user_id: user.id,
      user_name: user.name || user.email,
      user_picture: user.picture,
      text: commentText.trim(),
      rating: selectedRating > 0 ? selectedRating : undefined,
      created_at: new Date().toISOString(),
      is_owner: true,
    };
    
    try {
      // Try to submit to server first
      await commentsApi.addComment(id, commentText.trim(), selectedRating > 0 ? selectedRating : undefined);
      // On success: reset form and reload from server only (no local copy to avoid duplicates)
      setCommentText('');
      setSelectedRating(0);
      setShowCommentForm(false);
      Keyboard.dismiss();
      fetchComments();
      Alert.alert(language === 'ar' ? 'تم إضافة التعليق بنجاح' : 'Comment added successfully');
    } catch (error) {
      console.error('Error adding comment to server, saving locally:', error);
      // Save locally even if server fails (offline-first approach)
      addLocalComment(newComment);
      setCommentText('');
      setSelectedRating(0);
      setShowCommentForm(false);
      Keyboard.dismiss();
      // Update comments list immediately with local comment
      setComments(prev => [newComment, ...prev]);
      // Update rating calculations
      if (newComment.rating) {
        const newCount = ratingCount + 1;
        const newAvg = avgRating ? ((avgRating * ratingCount) + newComment.rating) / newCount : newComment.rating;
        setAvgRating(newAvg);
        setRatingCount(newCount);
      }
      Alert.alert(language === 'ar' ? 'تم حفظ التعليق محلياً' : 'Comment saved locally');
    } finally {
      setSubmittingComment(false);
    }
  }, [id, user, commentText, selectedRating, router, language, fetchComments, addLocalComment, avgRating, ratingCount]);

  const handleDeleteComment = useCallback((commentId: string) => {
    showConfirm({
      title: language === 'ar' ? 'حذف التعليق' : 'Delete Comment',
      message: language === 'ar' ? 'هل أنت متأكد من حذف هذا التعليق؟' : 'Are you sure you want to delete this comment?',
      confirmText: language === 'ar' ? 'حذف' : 'Delete',
      cancelText: language === 'ar' ? 'إلغاء' : 'Cancel',
      onConfirm: async () => {
        let previousComments: Comment[] = [];
        setComments(prev => {
          previousComments = prev;
          return prev.filter(c => c.id !== commentId);
        });
        deleteLocalComment(commentId);
        try {
          await commentsApi.deleteComment(commentId);
          fetchComments();
        } catch (error) {
          console.error('Error deleting comment:', error);
          setComments(previousComments);
        }
      },
    });
  }, [language, deleteLocalComment, fetchComments, showConfirm]);

  const getName = (item: any, field: string = 'name') => {
    const arField = `${field}_ar`;
    return language === 'ar' && item?.[arField] ? item[arField] : item?.[field] || '';
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString(language === 'ar' ? 'ar-EG' : 'en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  };

  interface StarsDisplayProps {
    rating: number;
    size?: number;
    interactive?: boolean;
    onPress?: (rating: number) => void;
    color?: string;
    secondaryColor?: string;
  }

  const StarsDisplay = React.memo<StarsDisplayProps>(({
    rating,
    size = 17.5,
    interactive = false,
    onPress,
    color = GOLD_COLOR, // Use the defined GOLD_COLOR constant
    secondaryColor = '#A9A9A9'
  }) => {
    return (
      <View style={styles.starsContainer}>
        {[1, 2, 3, 4, 5].map((star) => (
          <TouchableOpacity
            key={star}
            disabled={!interactive}
            onPress={() => onPress && onPress(star)}
            style={styles.starButton}
            activeOpacity={0.7}
          >
            <Ionicons
              name={star <= rating ? 'star' : 'star-outline'}
              size={size}
              color={star <= rating ? color : secondaryColor}
            />
          </TouchableOpacity>
        ))}
      </View>
    );
  });
  
  // Hero parallax transforms — declared before any early return so the
  // hook order stays stable across loading / loaded states (React's rules
  // of hooks). They only depend on the shared scrollY value.
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
          [1.4, 1, 1.06],
          Extrapolation.CLAMP,
        ),
      },
    ],
  }));
  const heroVeilStyle = useAnimatedStyle(() => ({
    opacity: interpolate(
      scrollY.value,
      [0, HERO_HEIGHT * 0.55],
      [0, 0.55],
      Extrapolation.CLAMP,
    ),
  }));

  if (loading) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      </View>
    );
  }

  if (!product) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={styles.errorContainer}>
          <Text style={[styles.errorText, { color: colors.textSecondary }]}>
            {t('error')}
          </Text>
        </View>
      </View>
    );
  }

  const dishName = getName(product);
  const dishDescription = getName(product, 'description') ||
    (language === 'ar'
      ? 'طبق مُعدّ بعناية يجمع بين أجود المكونات الموسمية وحرفية الشيف، ليُقدَّم على مائدتك بحضور لافت ونكهة لا تُنسى.'
      : 'A thoughtfully composed plate uniting the season\'s finest produce with our chef\'s artisan craft — designed to arrive at your table with quiet presence and an unforgettable flavour.');

  const TAB_ITEMS: { key: DishTabKey; en: string; ar: string }[] = [
    { key: 'description', en: 'Description', ar: 'الوصف' },
    { key: 'ingredients', en: 'Ingredients', ar: 'المكوّنات' },
    { key: 'pairing', en: 'AI Pairing', ar: 'اقتراح المرافقات' },
    { key: 'nutrition', en: 'Nutrition', ar: 'القيم الغذائية' },
  ];

  const handleTabSelect = (key: DishTabKey) => {
    if (Platform.OS !== 'web') {
      Haptics.selectionAsync();
    }
    setActiveTab(key);
  };

  // Pull the per-dish editorial fields from the product record. Each field
  // falls back to a curated placeholder so the polished tab strip never
  // collapses for dishes the operator has not yet enriched.
  const placeholderIngredients = language === 'ar'
    ? ['مكوّنات موسمية مختارة يدوياً', 'زيت زيتون بكر ممتاز', 'أعشاب طازجة من المزرعة', 'ملح بحري ناعم', 'لمسة الشيف الخاصة']
    : ['Hand-selected seasonal produce', 'Extra-virgin olive oil', 'Garden-fresh herbs', 'Fine sea salt', 'A signature finishing touch'];

  const sanitizeStringList = (raw: unknown): string[] => {
    if (Array.isArray(raw)) {
      return raw
        .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
        .filter((entry) => entry.length > 0);
    }
    if (typeof raw === 'string' && raw.trim().length > 0) {
      return raw
        .split(/\r?\n/)
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0);
    }
    return [];
  };

  const ingredientsField = language === 'ar'
    ? sanitizeStringList(product.ingredients_ar)
    : sanitizeStringList(product.ingredients);
  const ingredientList = ingredientsField.length > 0
    ? ingredientsField
    : placeholderIngredients;

  const placeholderPairing = language === 'ar'
    ? 'يقترح الكونسيرج الذكي مرافقة هذا الطبق بنبيذ أبيض جاف برائحة الحمضيات، أو شاي مثلج بالنعناع كخيار غير كحولي. للحلوى، أنهِ التجربة بقهوة عربية مهيلة.'
    : 'Our AI concierge suggests pairing this dish with a crisp citrus-led white, or — alcohol-free — a chilled mint iced tea. Close the experience with cardamom-laced Arabic coffee.';
  const pairingField = language === 'ar' ? product.pairing_notes_ar : product.pairing_notes;
  const pairingCopy = typeof pairingField === 'string' && pairingField.trim().length > 0
    ? pairingField.trim()
    : placeholderPairing;

  // Nutrition values come back as a jsonb object {calories, protein, carbs, fat}.
  // We render whichever of the four canonical fields the operator filled in,
  // and fall back to a per-serving placeholder set when nothing is on file.
  const nutritionLabels: Record<'calories' | 'protein' | 'carbs' | 'fat', { en: string; ar: string; unit: string }> = {
    calories: { en: 'Calories', ar: 'السعرات', unit: 'kcal' },
    protein: { en: 'Protein', ar: 'البروتين', unit: 'g' },
    carbs: { en: 'Carbs', ar: 'الكربوهيدرات', unit: 'g' },
    fat: { en: 'Fat', ar: 'الدهون', unit: 'g' },
  };
  const placeholderNutrition: Record<'calories' | 'protein' | 'carbs' | 'fat', number> = {
    calories: 420,
    protein: 24,
    carbs: 38,
    fat: 18,
  };
  const rawNutrition: Record<string, unknown> =
    product.nutrition && typeof product.nutrition === 'object' && !Array.isArray(product.nutrition)
      ? (product.nutrition as Record<string, unknown>)
      : {};
  const hasAnyNutrition = (['calories', 'protein', 'carbs', 'fat'] as const).some((key) => {
    const v = rawNutrition[key];
    if (v === null || v === undefined || v === '') return false;
    const n = typeof v === 'number' ? v : parseFloat(String(v));
    return Number.isFinite(n);
  });
  const nutritionRows = (['calories', 'protein', 'carbs', 'fat'] as const).map((key) => {
    const meta = nutritionLabels[key];
    const sourceValue = hasAnyNutrition ? rawNutrition[key] : placeholderNutrition[key];
    const numeric =
      sourceValue === null || sourceValue === undefined || sourceValue === ''
        ? null
        : typeof sourceValue === 'number'
          ? sourceValue
          : parseFloat(String(sourceValue));
    const displayValue = numeric !== null && Number.isFinite(numeric)
      ? `${numeric} ${meta.unit}`
      : '—';
    return {
      label: language === 'ar' ? meta.ar : meta.en,
      value: displayValue,
    };
  });

  return (
    <KeyboardAvoidingView
      style={[styles.container, { backgroundColor: colors.background }]}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      {/* Header */}
      <Header title={dishName} showBack={true} />

      <Animated.ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        onScroll={scrollHandler}
        scrollEventThrottle={16}
      >
        {/* ─── Parallax dish photography ─────────────────────────────── */}
        <View style={luxStyles.heroWrapper}>
          <Animated.View style={[StyleSheet.absoluteFill, heroImageStyle]}>
            {productImages.length > 0 ? (
              <Image
                source={{ uri: productImages[selectedImageIndex] }}
                style={luxStyles.heroImage}
                contentFit="cover"
                cachePolicy="disk"
                placeholder={{ blurhash: 'L6PZfSi_.AyE_3t7t7R**0o#DgR4' }}
                transition={250}
              />
            ) : (
              <LinearGradient
                colors={GRADIENTS.midnightBistro}
                style={StyleSheet.absoluteFill}
              />
            )}
          </Animated.View>
          <LinearGradient
            colors={['rgba(11,11,14,0.0)', 'rgba(11,11,14,0.45)', 'rgba(11,11,14,0.94)']}
            locations={[0, 0.55, 1]}
            style={StyleSheet.absoluteFill}
            pointerEvents="none"
          />
          <Animated.View
            style={[StyleSheet.absoluteFill, { backgroundColor: '#0B0B0E' }, heroVeilStyle]}
            pointerEvents="none"
          />

          {/* Floating favourite */}
          <View style={luxStyles.heroFavorite}>
            <AnimatedFavoriteButton
              isFavorite={isFavorite}
              isLoading={favoriteLoading}
              onPress={handleToggleFavorite}
              size={20}
              style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(247,242,233,0.92)' }}
            />
          </View>

          {isInBundle && (
            <View style={luxStyles.heroBundle}>
              <Ionicons name="gift" size={12} color="#1B1B1F" />
              <Text style={luxStyles.heroBundleText}>
                {language === 'ar' ? 'عرض موسمي' : 'Seasonal pairing'}
              </Text>
            </View>
          )}

          {productImages.length > 1 && (
            <View style={luxStyles.heroCounter}>
              <Text style={luxStyles.heroCounterText}>
                {selectedImageIndex + 1}/{productImages.length}
              </Text>
            </View>
          )}

          {/* Hero text */}
          <View style={luxStyles.heroContent}>
            {product.product_brand && (
              <Text style={luxStyles.heroEyebrow}>
                {product.product_brand.name?.toUpperCase()}
              </Text>
            )}
            <Text style={luxStyles.heroTitle} numberOfLines={3}>
              {dishName}
            </Text>
            <View style={luxStyles.heroMetaRow}>
              <Text style={luxStyles.heroPrice}>
                {parseFloat(String(product.price || 0)).toFixed(2)}{' '}
                <Text style={luxStyles.heroCurrency}>
                  {language === 'ar' ? 'ج.م' : 'EGP'}
                </Text>
              </Text>
              {avgRating !== null && avgRating !== undefined && typeof avgRating === 'number' && (
                <View style={luxStyles.heroRating}>
                  <Ionicons name="star" size={12} color="#E8D29A" />
                  <Text style={luxStyles.heroRatingText}>
                    {avgRating.toFixed(1)}{' '}
                    <Text style={luxStyles.heroRatingSubtle}>
                      ({ratingCount})
                    </Text>
                  </Text>
                </View>
              )}
            </View>
          </View>
        </View>

        {/* Thumbnails — kept under hero, restyled */}
        {productImages.length > 1 && (
          <View style={[luxStyles.thumbnailsWrap, { backgroundColor: colors.background }]}>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={luxStyles.thumbnailsRow}
            >
              {productImages.map((img, index) => (
                <TouchableOpacity
                  key={index}
                  style={[
                    luxStyles.thumbnail,
                    {
                      borderColor:
                        selectedImageIndex === index ? colors.primary : 'transparent',
                      backgroundColor: colors.surface,
                    },
                  ]}
                  onPress={() => setSelectedImageIndex(index)}
                  activeOpacity={0.85}
                >
                  <Image
                    source={{ uri: img }}
                    style={luxStyles.thumbnailImage}
                    contentFit="cover"
                    cachePolicy="disk"
                  />
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        )}

        {/* ─── Body sheet ────────────────────────────────────────────── */}
        <View style={[luxStyles.bodySheet, { backgroundColor: colors.background }]}>
          {/* Delivery & Feast Company — prefers category-linked supplier, falls back to brand-linked */}
          {(product.linked_supplier || product.supplier) && (
            <TouchableOpacity
              style={[
                luxStyles.supplierCard,
                { backgroundColor: colors.card, borderColor: colors.border },
                ELEVATION.card,
              ]}
              onPress={() => {
                const sc = product.linked_supplier || product.supplier;
                if (canViewProfile) {
                  router.push(`/owner/suppliers?viewMode=profile&id=${sc.id}`);
                } else {
                  triggerGoldenGlow();
                }
              }}
              activeOpacity={0.9}
            >
              <View style={luxStyles.supplierRow}>
                <View
                  style={[
                    luxStyles.supplierAvatar,
                    { backgroundColor: colors.surface, borderColor: colors.primary + '40' },
                  ]}
                >
                  {(product.linked_supplier || product.supplier).profile_image ? (
                    <Image
                      source={{ uri: (product.linked_supplier || product.supplier).profile_image }}
                      style={luxStyles.supplierAvatarImg}
                      contentFit="cover"
                    />
                  ) : (
                    <Ionicons name="bicycle" size={42} color={colors.primary} />
                  )}
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[luxStyles.supplierLabel, { color: colors.primary }]}>
                    {language === 'ar' ? 'شركة التوصيل' : 'Delivery & Feast Company'}
                  </Text>
                  <Text style={[luxStyles.supplierName, { color: colors.text }]} numberOfLines={1}>
                    {language === 'ar' && (product.linked_supplier || product.supplier).name_ar
                      ? (product.linked_supplier || product.supplier).name_ar
                      : (product.linked_supplier || product.supplier).name}
                  </Text>
                </View>
                <View style={[luxStyles.supplierArrow, { backgroundColor: colors.primary + '18' }]}>
                  <Ionicons
                    name={canViewProfile ? 'chevron-forward' : 'lock-closed'}
                    size={16}
                    color={colors.primary}
                  />
                </View>
              </View>
              {showSubscribeButton && (
                <View style={luxStyles.supplierBannerWrap}>
                  <LinearGradient
                    colors={GRADIENTS.midnightBistro}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 0 }}
                    style={luxStyles.supplierBanner}
                  >
                    <View style={luxStyles.supplierBannerEdge} />
                    <Ionicons name="sparkles" size={14} color={GOLD_COLOR} />
                    <Animated.Text style={[luxStyles.supplierBannerText, glowTextStyle]}>
                      {language === 'ar'
                        ? 'اشترك للوصول إلى تفاصيل شركة التوصيل والقائمة الكاملة'
                        : 'Subscribe to access full delivery company details & menu'}
                    </Animated.Text>
                    <Ionicons name="sparkles" size={14} color={GOLD_COLOR} />
                    <View style={luxStyles.supplierBannerEdgeRight} />
                  </LinearGradient>
                </View>
              )}
            </TouchableOpacity>
          )}

          {showSubscribeButton && (
            <TouchableOpacity
              style={[luxStyles.reserveBtn, ELEVATION.goldGlow]}
              onPress={() => router.push('/subscription-request')}
              activeOpacity={0.9}
            >
              <LinearGradient
                colors={GRADIENTS.goldShimmer}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={luxStyles.reserveGradient}
              >
                <View style={luxStyles.reserveIconWrap}>
                  <Ionicons name="star" size={20} color="#FFF" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={luxStyles.reserveTitle}>
                    {language === 'ar' ? 'انضم إلى ضيوفنا الكرام' : 'Join our valued guests'}
                  </Text>
                  <Text style={luxStyles.reserveSub}>
                    {language === 'ar' ? 'مزايا حصرية واقتراحات مخصصة' : 'Exclusive perks & curated picks'}
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color="#1B1B1F" />
              </LinearGradient>
            </TouchableOpacity>
          )}

          {/* Category & SKU chips */}
          <View style={luxStyles.metaChipRow}>
            {product.category && (
              <TouchableOpacity
                style={[luxStyles.metaChip, { borderColor: colors.border, backgroundColor: colors.card }]}
                onPress={() => router.push(`/search?category_id=${product.category.id}`)}
              >
                <Ionicons name="restaurant-outline" size={13} color={colors.primary} />
                <Text style={[luxStyles.metaChipText, { color: colors.text }]}>
                  {getName(product.category)}
                </Text>
              </TouchableOpacity>
            )}
            {product.sku ? (
              <View style={[luxStyles.metaChip, { borderColor: colors.border, backgroundColor: 'transparent' }]}>
                <Ionicons name="pricetag-outline" size={13} color={colors.textSecondary} />
                <Text style={[luxStyles.metaChipText, { color: colors.textSecondary }]}>
                  #{product.sku}
                </Text>
              </View>
            ) : null}
          </View>

          {/* ─── 4-tab strip ─────────────────────────────────────────── */}
          <View
            style={[
              luxStyles.tabStrip,
              { borderColor: colors.border, backgroundColor: colors.card },
            ]}
          >
            {TAB_ITEMS.map((tab) => {
              const isActive = activeTab === tab.key;
              return (
                <TouchableOpacity
                  key={tab.key}
                  style={[
                    luxStyles.tabItem,
                    isActive && {
                      backgroundColor: colors.primary + '18',
                      borderColor: colors.primary + '60',
                    },
                  ]}
                  onPress={() => handleTabSelect(tab.key)}
                  activeOpacity={0.8}
                >
                  <Text
                    style={[
                      luxStyles.tabText,
                      { color: isActive ? colors.primary : colors.textSecondary },
                    ]}
                    numberOfLines={1}
                  >
                    {language === 'ar' ? tab.ar : tab.en}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {/* Tab content */}
          <View style={luxStyles.tabPanel}>
            {activeTab === 'description' && (
              <Text style={[luxStyles.bodyCopy, { color: colors.textSecondary }]}>
                {dishDescription}
              </Text>
            )}
            {activeTab === 'ingredients' && (
              <View>
                <Text style={[luxStyles.panelEyebrow, { color: colors.primary }]}>
                  {language === 'ar' ? 'مكوّناتنا المنتقاة' : 'Curated ingredients'}
                </Text>
                {ingredientList.map((line, i) => (
                  <View key={i} style={luxStyles.ingredientRow}>
                    <View style={[luxStyles.ingredientDot, { backgroundColor: colors.primary }]} />
                    <Text style={[luxStyles.ingredientText, { color: colors.text }]}>
                      {line}
                    </Text>
                  </View>
                ))}
              </View>
            )}
            {activeTab === 'pairing' && (
              <View
                style={[
                  luxStyles.pairingCard,
                  {
                    backgroundColor: colors.primary + '10',
                    borderColor: colors.primary + '40',
                  },
                ]}
              >
                <View style={luxStyles.pairingHeaderRow}>
                  <View
                    style={[
                      luxStyles.pairingIconWrap,
                      { backgroundColor: colors.primary + '22' },
                    ]}
                  >
                    <Ionicons name="sparkles" size={16} color={colors.primary} />
                  </View>
                  <Text style={[luxStyles.pairingTitle, { color: colors.text }]}>
                    {language === 'ar' ? 'اقتراح كونسيرج الذكاء الاصطناعي' : 'AI concierge suggestion'}
                  </Text>
                </View>
                <Text style={[luxStyles.bodyCopy, { color: colors.textSecondary }]}>
                  {pairingCopy}
                </Text>
              </View>
            )}
            {activeTab === 'nutrition' && (
              <View>
                <Text style={[luxStyles.panelEyebrow, { color: colors.primary }]}>
                  {language === 'ar' ? 'لكل حصة' : 'Per serving'}
                </Text>
                <View style={luxStyles.nutritionGrid}>
                  {nutritionRows.map((row) => (
                    <View
                      key={row.label}
                      style={[
                        luxStyles.nutritionCell,
                        { backgroundColor: colors.card, borderColor: colors.border },
                      ]}
                    >
                      <Text style={[luxStyles.nutritionValue, { color: colors.primary }]}>
                        {row.value}
                      </Text>
                      <Text style={[luxStyles.nutritionLabel, { color: colors.textSecondary }]}>
                        {row.label}
                      </Text>
                    </View>
                  ))}
                </View>
              </View>
            )}
          </View>

          {/* ─── Available at Restaurants ─────────────────────────── */}
          {Array.isArray(product.car_models) && product.car_models.length > 0 && (
            <View style={[luxStyles.section, { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, paddingTop: SPACING.xl }]}>
              <View style={luxStyles.sectionHeaderRow}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <View style={[restSectionStyles.iconWrap, { backgroundColor: colors.primary + '18' }]}>
                    <Ionicons name="storefront-outline" size={15} color={colors.primary} />
                  </View>
                  <Text style={[luxStyles.sectionTitle, { color: colors.text }]}>
                    {language === 'ar' ? 'متوفر في' : 'Available at'}
                  </Text>
                </View>
                <View style={[restSectionStyles.countBadge, { backgroundColor: colors.primary + '18' }]}>
                  <Text style={[restSectionStyles.countText, { color: colors.primary }]}>
                    {product.car_models.length}
                  </Text>
                </View>
              </View>

              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={[restSectionStyles.hScroll, isRTL && { flexDirection: 'row-reverse' }]}
              >
                {product.car_models.map((model: any) => (
                  <CarModelCard
                    key={model.id}
                    model={model}
                    cardWidth={screenWidth * 0.44}
                    onPress={(id) => router.push(`/car/${id}`)}
                    getName={getName}
                    colors={colors}
                  />
                ))}
              </ScrollView>
            </View>
          )}

          {/* Reviews */}
          <View style={[luxStyles.section, { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, paddingTop: SPACING.xl }]}>
            <View style={luxStyles.sectionHeaderRow}>
              <Text style={[luxStyles.sectionTitle, { color: colors.text }]}>
                {language === 'ar' ? 'انطباعات الضيوف' : 'Guest impressions'}
              </Text>
              <Text style={[luxStyles.sectionCount, { color: colors.textSecondary }]}>
                {comments.length}
              </Text>
            </View>

            {!showCommentForm && (
              <TouchableOpacity
                style={[
                  luxStyles.reviewCta,
                  { backgroundColor: colors.primary + '12', borderColor: colors.primary + '40' },
                ]}
                onPress={() => {
                  if (!user) {
                    router.push('/login');
                    return;
                  }
                  setShowCommentForm(true);
                }}
              >
                <Ionicons name="create-outline" size={17} color={colors.primary} />
                <Text style={[luxStyles.reviewCtaText, { color: colors.primary }]}>
                  {language === 'ar' ? 'شاركنا انطباعك' : 'Share your impression'}
                </Text>
              </TouchableOpacity>
            )}

            {showCommentForm && (
              <View
                style={[
                  styles.commentForm,
                  { backgroundColor: colors.surface, borderColor: colors.border },
                ]}
              >
                <Text style={[styles.formLabel, { color: colors.text }]}>
                  {language === 'ar' ? 'تقييمك' : 'Your rating'}
                </Text>
                <StarsDisplay
                  rating={selectedRating}
                  size={28}
                  interactive={true}
                  onPress={setSelectedRating}
                  secondaryColor={colors.textSecondary}
                />
                <Text style={[styles.formLabel, { color: colors.text, marginTop: 12 }]}>
                  {language === 'ar' ? 'تعليقك' : 'Your note'}
                </Text>
                <TextInput
                  style={[
                    styles.commentInput,
                    {
                      backgroundColor: colors.background,
                      color: colors.text,
                      borderColor: colors.border,
                      textAlign: isRTL ? 'right' : 'left',
                    },
                  ]}
                  placeholder={
                    language === 'ar'
                      ? 'اكتب انطباعك هنا...'
                      : 'Write your impression here...'
                  }
                  placeholderTextColor={colors.textSecondary}
                  value={commentText}
                  onChangeText={setCommentText}
                  multiline
                  numberOfLines={4}
                />
                <View style={styles.formButtons}>
                  <TouchableOpacity
                    style={[styles.cancelButton, { borderColor: colors.border }]}
                    onPress={() => {
                      setShowCommentForm(false);
                      setCommentText('');
                      setSelectedRating(0);
                    }}
                  >
                    <Text style={[styles.cancelButtonText, { color: colors.textSecondary }]}>
                      {language === 'ar' ? 'إلغاء' : 'Cancel'}
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.submitButton, { backgroundColor: colors.primary }]}
                    onPress={handleSubmitComment}
                    disabled={submittingComment}
                  >
                    {submittingComment ? (
                      <ActivityIndicator size="small" color="#FFF" />
                    ) : (
                      <Text style={styles.submitButtonText}>
                        {language === 'ar' ? 'إرسال' : 'Submit'}
                      </Text>
                    )}
                  </TouchableOpacity>
                </View>
              </View>
            )}

            <FlashList
              data={comments}
              keyExtractor={(item) => item.id.toString()}
              estimatedItemSize={130}
              renderItem={({ item: comment }) => (
                <View
                  key={comment.id}
                  style={[
                    styles.commentCard,
                    {
                      backgroundColor: colors.surface,
                      borderColor: colors.border,
                      marginBottom: 9,
                    },
                  ]}
                >
                  <View style={styles.commentHeader}>
                    <View style={styles.commentUserInfo}>
                      <View
                        style={[
                          styles.commentAvatar,
                          { backgroundColor: colors.primary + '20' },
                        ]}
                      >
                        {comment.user_picture ? (
                          <Image
                            source={{ uri: comment.user_picture }}
                            style={styles.avatarImage}
                            contentFit="cover"
                            cachePolicy="disk"
                          />
                        ) : (
                          <Ionicons name="person" size={18} color={colors.primary} />
                        )}
                      </View>
                      <View>
                        <Text style={[styles.commentUserName, { color: colors.text }]}>
                          {comment.user_name}
                        </Text>
                        <Text style={[styles.commentDate, { color: colors.textSecondary }]}>
                          {formatDate(comment.created_at)}
                        </Text>
                      </View>
                    </View>
                    {comment.is_owner && (
                      <TouchableOpacity
                        style={styles.deleteCommentButton}
                        onPress={() => handleDeleteComment(comment.id)}
                      >
                        <Ionicons name="trash-outline" size={19} color={colors.error} />
                      </TouchableOpacity>
                    )}
                  </View>
                  {comment.rating && (
                    <View style={styles.commentRating}>
                      <StarsDisplay
                        rating={comment.rating}
                        size={14}
                        secondaryColor={colors.textSecondary}
                      />
                    </View>
                  )}
                  <Text style={[styles.commentText, { color: colors.text }]}>
                    {comment.text}
                  </Text>
                </View>
              )}
            />
          </View>

          {/* Bottom padding for sticky bar */}
          <View
            style={{
              height:
                160 +
                (insets.bottom || 0) +
                (Array.isArray(product.available_variants) && product.available_variants.length > 1
                  ? 60
                  : 0),
            }}
          />
        </View>
      </Animated.ScrollView>

      {/* Fitment chip strip — sits just above the sticky add-to-order bar */}
      {Array.isArray(product.available_variants) && product.available_variants.length > 1 && (
        <View
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            bottom: Platform.OS === 'ios' ? 96 : 78,
            paddingHorizontal: 16,
            paddingVertical: 8,
            borderTopWidth: StyleSheet.hairlineWidth,
            borderBottomWidth: StyleSheet.hairlineWidth,
            borderColor: colors.border,
            backgroundColor: colors.background,
            flexDirection: isRTL ? 'row-reverse' : 'row',
            alignItems: 'center',
            gap: 8,
            shadowColor: '#000',
            shadowOpacity: 0.06,
            shadowRadius: 6,
            shadowOffset: { width: 0, height: -2 },
            elevation: 4,
          }}
        >
          <Text style={[luxStyles.fitmentLabel, { color: colors.textSecondary }]}>
            {language === 'ar' ? 'الحجم:' : 'Portion:'}
          </Text>
          <View style={{ flex: 1 }}>
            <FitmentStrip
              mode="interactive"
              variants={product.available_variants}
              selected={selectedFitment}
              onChange={(ind: string) => setSelectedFitment(ind)}
              hideOutOfStock
              size="sm"
            />
          </View>
        </View>
      )}

      {/* Sticky "Add to Order" bar */}
      <AnimatedAddToCartBar
        onPress={handleAddToCart}
        isLoading={addingToCart}
        price={(() => {
          const v = (product.available_variants || []).find(
            (x: any) => x.indicator === selectedFitment,
          );
          return parseFloat(String(v?.price ?? product.price ?? 0)) || 0;
        })()}
        quantity={quantity}
        onQuantityChange={setQuantity}
        label={language === 'ar' ? 'أضف إلى الطلب' : 'Add to Order'}
        colors={colors}
        language={language}
        isRTL={isRTL}
        disabled={(() => {
          const v = (product.available_variants || []).find(
            (x: any) => x.indicator === selectedFitment,
          );
          if (!v) return false;
          return (v.stock ?? 0) <= 0;
        })()}
      />
      {ConfirmModalNode}
    </KeyboardAvoidingView>
  );
}


// Professional Animated Add to Cart Component with Quantity Selector
const AnimatedAddToCartBar: React.FC<{
  onPress: () => void;
  isLoading: boolean;
  price: number;
  quantity: number;
  onQuantityChange: (qty: number) => void;
  label: string;
  colors: any;
  language: string;
  isRTL: boolean;
  disabled?: boolean;
}> = ({ onPress, isLoading, price, quantity, onQuantityChange, label, colors, language, isRTL, disabled = false }) => {
  const scale = useSharedValue(1);
  const iconRotate = useSharedValue(0);
  const shimmerX = useSharedValue(-200);
  const successScale = useSharedValue(0);
  const priceScale = useSharedValue(1);
  const quantityScale = useSharedValue(1);
  const [showSuccess, setShowSuccess] = useState(false);

  // Calculate total price
  const totalPrice = price * quantity;

  // Start shimmer animation on mount
  useEffect(() => {
    const animateShimmer = () => {
      shimmerX.value = withSequence(
        withTiming(-200, { duration: 0 }),
        withTiming(400, { duration: 2000 })
      );
    };
    const interval = setInterval(animateShimmer, 3000);
    animateShimmer();
    return () => clearInterval(interval);
  }, []);

  const handlePress = () => {
    if (isLoading || disabled) return;
    
    // Haptic feedback
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    
    // Button press animation
    scale.value = withSequence(
      withSpring(0.92, { damping: 10, stiffness: 400 }),
      withSpring(1.05, { damping: 8, stiffness: 300 }),
      withSpring(1, { damping: 10, stiffness: 400 })
    );
    
    // Icon rotation animation
    iconRotate.value = withSequence(
      withTiming(-15, { duration: 80 }),
      withTiming(15, { duration: 80 }),
      withTiming(-10, { duration: 60 }),
      withTiming(10, { duration: 60 }),
      withTiming(0, { duration: 100 })
    );
    
    onPress();
  };

  const handleIncrease = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onQuantityChange(quantity + 1);
    
    // Animate quantity badge
    quantityScale.value = withSequence(
      withSpring(1.3, { damping: 5, stiffness: 300 }),
      withSpring(1, { damping: 5, stiffness: 300 })
    );
    
    // Animate price
    priceScale.value = withSequence(
      withTiming(1.1, { duration: 100 }),
      withSpring(1, { damping: 5, stiffness: 300 })
    );
  };

  const handleDecrease = () => {
    if (quantity > 1) {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      onQuantityChange(quantity - 1);
      
      // Animate quantity badge
      quantityScale.value = withSequence(
        withSpring(0.7, { damping: 5, stiffness: 300 }),
        withSpring(1, { damping: 5, stiffness: 300 })
      );
      
      // Animate price
      priceScale.value = withSequence(
        withTiming(0.9, { duration: 100 }),
        withSpring(1, { damping: 5, stiffness: 300 })
      );
    }
  };

  // Show success animation after loading completes
  useEffect(() => {
    if (!isLoading && showSuccess) {
      successScale.value = withSequence(
        withSpring(1.2, { damping: 8, stiffness: 400 }),
        withSpring(1, { damping: 10, stiffness: 400 })
      );
      setTimeout(() => setShowSuccess(false), 1500);
    }
  }, [isLoading]);

  const containerStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const iconStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${iconRotate.value}deg` }],
  }));

  const shimmerStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: shimmerX.value }],
  }));

  const priceAnimStyle = useAnimatedStyle(() => ({
    transform: [{ scale: priceScale.value }],
  }));

  const quantityAnimStyle = useAnimatedStyle(() => ({
    transform: [{ scale: quantityScale.value }],
  }));

  const successStyle = useAnimatedStyle(() => ({
    transform: [{ scale: successScale.value }],
    opacity: interpolate(successScale.value, [0, 0.5, 1], [0, 1, 1], Extrapolation.CLAMP),
  }));

  return (
    <View style={[
      addToCartStyles.container, 
      { backgroundColor: colors.card, borderTopColor: colors.border }
    ]}>
      {/* Left Side - Quantity Selector */}
      <View style={[addToCartStyles.quantitySection, isRTL && addToCartStyles.quantitySectionRTL]}>
        <TouchableOpacity
          onPress={handleDecrease}
          style={[
            addToCartStyles.qtyButton,
            { 
              backgroundColor: quantity > 1 ? colors.primary + '20' : colors.surface,
              borderColor: quantity > 1 ? colors.primary : colors.border,
            },
          ]}
          disabled={quantity <= 1}
        >
          <Ionicons name="remove" size={18} color={quantity > 1 ? colors.primary : colors.textSecondary} />
        </TouchableOpacity>
        
        <Animated.View style={[addToCartStyles.qtyBadge, { backgroundColor: colors.primary }, quantityAnimStyle]}>
          <Text style={addToCartStyles.qtyText}>{quantity}</Text>
        </Animated.View>
        
        <TouchableOpacity
          onPress={handleIncrease}
          style={[
            addToCartStyles.qtyButton,
            { 
              backgroundColor: colors.primary + '20',
              borderColor: colors.primary,
            },
          ]}
        >
          <Ionicons name="add" size={18} color={colors.primary} />
        </TouchableOpacity>
      </View>

      {/* Center - Dynamic Price */}
      <View style={addToCartStyles.priceSection}>
        <Text style={[addToCartStyles.priceLabel, { color: colors.textSecondary }]}>
          {language === 'ar' ? 'الإجمالي' : 'Total'}
        </Text>
        <Animated.Text style={[addToCartStyles.priceValue, { color: colors.text }, priceAnimStyle]}>
          {totalPrice?.toFixed(2)} <Text style={addToCartStyles.currency}>{language === 'ar' ? 'ج.م' : 'EGP'}</Text>
        </Animated.Text>
      </View>

      {/* Right - Add to Cart Button */}
      <Animated.View style={[addToCartStyles.buttonWrapper, containerStyle]}>
        <TouchableOpacity
          style={addToCartStyles.button}
          onPress={handlePress}
          disabled={isLoading}
          activeOpacity={1}
        >
          <LinearGradient
            colors={isLoading ? ['#6B7280', '#4B5563'] : ['#D9B265', '#C8A24A', '#A07F2F']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={addToCartStyles.gradient}
          >
            {/* Shimmer effect */}
            <Animated.View style={[addToCartStyles.shimmer, shimmerStyle]}>
              <LinearGradient
                colors={['transparent', 'rgba(255,255,255,0.45)', 'transparent']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={addToCartStyles.shimmerGradient}
              />
            </Animated.View>

            {isLoading ? (
              <View style={addToCartStyles.loadingContainer}>
                <ActivityIndicator size="small" color="#1B1B1F" />
              </View>
            ) : (
              <View style={addToCartStyles.buttonContent}>
                <Animated.View style={iconStyle}>
                  <Ionicons name="restaurant" size={18} color="#1B1B1F" />
                </Animated.View>
                <Text style={addToCartStyles.buttonLabel} numberOfLines={1}>
                  {label || (language === 'ar' ? 'أضف' : 'Add')}
                </Text>
              </View>
            )}
          </LinearGradient>
        </TouchableOpacity>
      </Animated.View>
    </View>
  );
};

const addToCartStyles = StyleSheet.create({
  container: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 50,
    paddingVertical: 10,
    paddingBottom: Platform.OS === 'ios' ? 28 : 10,
    borderTopWidth: 1,
    gap: 10,
  },
  quantitySection: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  quantitySectionRTL: {
    flexDirection: 'row-reverse',
  },
  qtyButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
  },
  qtyBadge: {
    minWidth: 36,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 10,
  },
  qtyText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },
  priceSection: {
    flex: 1,
    alignItems: 'center',
  },
  priceLabel: {
    fontSize: 10,
    fontWeight: '500',
    marginBottom: 2,
  },
  priceValue: {
    fontSize: 18,
    fontWeight: '800',
  },
  currency: {
    fontSize: 12,
    fontWeight: '600',
  },
  buttonWrapper: {
    minWidth: 110,
  },
  button: {
    borderRadius: 14,
    overflow: 'hidden',
    shadowColor: '#C8A24A',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.45,
    shadowRadius: 10,
    elevation: 7,
  },
  gradient: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    paddingHorizontal: 14,
    position: 'relative',
    overflow: 'hidden',
  },
  buttonLabel: {
    color: '#1B1B1F',
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 0.4,
    marginLeft: 6,
  },
  shimmer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    width: 100,
  },
  shimmerGradient: {
    flex: 1,
    width: 100,
  },
  loadingContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  buttonContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  buttonText: {
    color: '#FFF',
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  plusBadge: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: 'rgba(255,255,255,0.25)',
    alignItems: 'center',
    justifyContent: 'center',
  },
});

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  errorText: {
    fontSize: 16,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: 24,
  },
  imageContainer: {
    height: 275,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  productImage: {
    width: '100%',
    height: '100%',
  },
  // Golden Gift Icon for Bundle Products - Product Detail Page
  bundleIconContainer: {
    position: 'absolute',
    top: 16,
    left: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    zIndex: 10,
  },
  bundleIconBadge: {
    width: 35,
    height: 35,
    borderRadius: 18,
    backgroundColor: '#000000',
    borderWidth: 2,
    borderColor: '#FFD700',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#FFD700',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.4,
    shadowRadius: 6,
    elevation: 6,
  },
  bundleLabel: {
    backgroundColor: '#000000',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
    borderWidth: 1.5,
    borderColor: '#FFD700',
    color: '#FFD700',
    fontSize: 12,
    fontWeight: '700',
  },
  imageCounter: {
    position: 'absolute',
    bottom: 13,
    left: 19,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  imageCounterText: {
    color: '#FFF',
    fontSize: 12,
    fontWeight: '600',
  },
  thumbnailsContainer: {
    paddingVertical: 10,
    paddingHorizontal: 19,
  },
  thumbnailsContent: {
    gap: 7,
  },
  thumbnail: {
    width: 79,
    height: 79,
    borderRadius: 8,
    borderWidth: 1.9,
    overflow: 'hidden',
    marginRight: 10,
  },
  thumbnailImage: {
    width: '100%',
    height: '100%',
  },
  thumbnailOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderWidth: 2,
    borderRadius: 6,
  },
  favoriteButton: {
    position: 'absolute',
    top: 16,
    right: 16,
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
    elevation: 3,
  },
  infoContainer: {
    paddingVertical: 3,
    paddingHorizontal: 0, // Remove horizontal padding to allow children to fill width
    alignItems: 'center',
  },
  ratingContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 9,
    gap: 13,
  },
  starsContainer: {
    flexDirection: 'row',
  },
  starButton: {
    padding: 3.5,
  },
  ratingText: {
    fontSize: 19,
    fontWeight: '700',
  },
  ratingCount: {
    fontSize: 13,
  },
  rowContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
    paddingHorizontal: 15,
    marginVertical: 5,
  },
  brandBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 15,
    paddingVertical: 9,
    borderRadius: 12,
    gap: 5,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  brandText: {
    fontSize: 14,
    fontWeight: '600',
  },
  price: {
    fontSize: 30,
    fontWeight: '900',
  },
  productName: {
    fontSize: 19,
    fontWeight: '700',
    marginBottom: 7,
    lineHeight: 50,
    textAlign: 'center',
  },
  sku: {
    fontSize: 15,
    fontWeight: '900',
  },
  categoryBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 30,
    paddingVertical: 9,
    borderRadius: 8,
    borderWidth: 0.7,
    gap: 5,
  },
  categoryText: {
    fontSize: 17,
    fontWeight: '700',
  },
  section: {
    marginTop: 9,
    width: '100%', // Ensure section takes full width
    alignItems: 'center',
  },
  sectionTitle: {
    fontSize: 19,
    fontWeight: '700',
    marginBottom: 1,
    textAlign: 'center',
  },
  description: {
    fontSize: 19,
    fontWeight: '700',
    lineHeight: 30,
    textAlign: 'center',
  },
  
  // Comments Section
  commentsSection: {
    marginTop: 13,
    paddingTop: 13,
    borderTopWidth: 1.9,
    width: '95%', // Ensure section takes full width
  },
  commentsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 15,
    gap: 7,
  },
  commentsCount: {
    fontSize: 13,
  },
  addCommentButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 13,
    borderRadius: 15,
    gap: 8,
  },
  addCommentText: {
    fontSize: 17,
    fontWeight: '700',
  },
  commentForm: {
    padding: 13,
    borderRadius: 12,
    borderWidth: 1.9,
    marginBottom: 10,
  },
  formLabel: {
    fontSize: 15,
    fontWeight: '700',
    marginBottom: 7,
    textAlign: 'center',
  },
  commentInput: {
    minHeight: 110,
    borderWidth: 1.9,
    borderRadius: 8,
    padding: 13,
    fontSize: 15,
    textAlignVertical: 'top',
  },
  formButtons: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginTop: 16,
    gap: 15,
  },
  cancelButton: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1.9,
  },
  cancelButtonText: {
    fontSize: 14,
    fontWeight: '700',
  },
  submitButton: {
    paddingHorizontal: 24,
    paddingVertical: 10,
    borderRadius: 8,
    minWidth: 80,
    alignItems: 'center',
  },
  submitButtonText: {
    color: '#FFF',
    fontSize: 15,
    fontWeight: '700',
  },
  noComments: {
    alignItems: 'center',
    padding: 32,
    gap: 12,
  },
  noCommentsText: {
    fontSize: 14,
  },
  commentsList: {
    marginTop: 15,
  },
  commentCard: {
    padding: 15,
    borderRadius: 12,
    borderWidth: 1.9,
  },
  commentHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  commentUserInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 13,
  },
  commentAvatar: {
    width: 70,
    height: 70,
    borderRadius: 35,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  avatarImage: {
    width: '100%',
    height: '100%',
  },
  commentUserName: {
    fontSize: 15,
    fontWeight: '700',
  },
  commentDate: {
    fontSize: 11,
  },
  deleteCommentButton: {
    padding: 7,
  },
  commentRating: {
    marginTop: 10,
  },
  commentText: {
    fontSize: 17,
    lineHeight: 30,
    marginTop: 19,
  },
  // Supplier Button Styles
  supplierButton: {
    marginHorizontal: 16,
    marginTop: 8,
    marginBottom: 8,
    borderRadius: 16,
    borderWidth: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  supplierContent: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 14,
  },
  supplierImageContainer: {
    width: 70,
    height: 70,
    borderRadius: 30,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
    overflow: 'hidden',
  },
  supplierProfileImage: {
    width: 70,
    height: 70,
    borderRadius: 30,
  },
  supplierTextContainer: {
    flex: 1,
    alignItems: 'center',
  },
  supplierLabel: {
    fontSize: 11,
    fontWeight: '500',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    textAlign: 'center',
  },
  supplierName: {
    fontSize: 16,
    fontWeight: '700',
    marginTop: 2,
    textAlign: 'center',
  },
  supplierArrowContainer: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Premium Subscribe Button Styles
  subscribeButtonContainer: {
    marginHorizontal: 39,
    marginBottom: 7,
    borderRadius: 16,
    overflow: 'hidden',
    shadowColor: '#FFD711',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 6,
  },
  subscribeGradient: {
    borderRadius: 16,
  },
  subscribeContent: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 3,
    paddingHorizontal: 19,
  },
  subscribeIconContainer: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: 'rgba(255,255,255,0.25)',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 5,
  },
  subscribeTextContainer: {
    flex: 1,
  },
  subscribeTitle: {
    fontSize: 19,
    fontWeight: '700',
    textAlign: 'center',
    color: '#FFF',
    textShadowColor: 'rgba(0,0,0,0.2)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
  subscribeSubtitle: {
    fontSize: 15,
    fontWeight: '500',
    textAlign: 'center',
    color: 'rgba(255,255,255,0.9)',
    marginTop: 2,
  },
  subscribeArrowContainer: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Subscribe Banner inside Supplier/Distributor button
  subscribeBannerContainer: {
    marginTop: 7,
    borderRadius: 10,
    overflow: 'hidden',
  },
  subscribeBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    paddingHorizontal: 14,
    gap: 8,
    position: 'relative',
  },
  subscribeBannerGoldBorder: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: 3,
    backgroundColor: '#FFD700',
  },
  subscribeBannerGoldBorderRight: {
    position: 'absolute',
    right: 0,
    top: 0,
    bottom: 0,
    width: 3,
    backgroundColor: '#FFD700',
  },
  subscribeBannerText: {
    flex: 1,
    fontSize: 13,
    fontWeight: '700',
    color: '#FFFFFF',
    textAlign: 'center',
    letterSpacing: 0.3,
  },
});

// Luxury restaurant dish-detail styles
const luxStyles = StyleSheet.create({
  heroWrapper: {
    width: '100%',
    height: HERO_HEIGHT,
    backgroundColor: '#0B0B0E',
    overflow: 'hidden',
  },
  heroImage: {
    width: '100%',
    height: '100%',
  },
  heroFavorite: {
    position: 'absolute',
    top: SPACING.lg,
    right: SPACING.lg,
  },
  heroBundle: {
    position: 'absolute',
    top: SPACING.lg,
    left: SPACING.lg,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: RADII.pill,
    backgroundColor: GOLD_COLOR,
  },
  heroBundleText: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.5,
    color: '#1B1B1F',
    textTransform: 'uppercase',
  },
  heroCounter: {
    position: 'absolute',
    bottom: SPACING.md,
    right: SPACING.md,
    backgroundColor: 'rgba(11,11,14,0.55)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: RADII.pill,
  },
  heroCounterText: {
    color: '#F7F2E9',
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.4,
  },
  heroContent: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: SPACING.xl,
    paddingBottom: SPACING.xl + 4,
  },
  heroEyebrow: {
    color: GOLD_COLOR,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 2.4,
    marginBottom: SPACING.sm,
  },
  heroTitle: {
    ...TYPE.hero,
    color: '#F7F2E9',
    fontSize: 34,
    lineHeight: 40,
    marginBottom: SPACING.md,
  },
  heroMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: SPACING.md,
  },
  heroPrice: {
    color: '#F7F2E9',
    fontSize: 22,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  heroCurrency: {
    color: GOLD_COLOR,
    fontSize: 13,
    fontWeight: '600',
    letterSpacing: 0.6,
  },
  heroRating: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: RADII.pill,
    backgroundColor: 'rgba(247,242,233,0.14)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(232,210,154,0.4)',
  },
  heroRatingText: {
    color: '#F7F2E9',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  heroRatingSubtle: {
    color: 'rgba(247,242,233,0.65)',
    fontWeight: '500',
  },
  thumbnailsWrap: {
    paddingTop: SPACING.md,
    paddingHorizontal: SPACING.lg,
  },
  thumbnailsRow: {
    gap: SPACING.sm,
    paddingRight: SPACING.lg,
  },
  thumbnail: {
    width: 64,
    height: 64,
    borderRadius: RADII.md,
    borderWidth: 2,
    overflow: 'hidden',
  },
  thumbnailImage: {
    width: '100%',
    height: '100%',
  },
  bodySheet: {
    marginTop: -SPACING.xl,
    paddingTop: SPACING.xl,
    paddingHorizontal: SPACING.lg,
    borderTopLeftRadius: RADII.xl,
    borderTopRightRadius: RADII.xl,
  },
  supplierCard: {
    borderRadius: RADII.lg,
    borderWidth: StyleSheet.hairlineWidth,
    padding: SPACING.md,
    marginBottom: SPACING.md,
  },
  supplierRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.md,
  },
  supplierAvatar: {
    width: 52,
    height: 52,
    borderRadius: 26,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  supplierAvatarImg: {
    width: '100%',
    height: '100%',
  },
  supplierLabel: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.6,
    textTransform: 'uppercase',
    marginBottom: 2,
  },
  supplierName: {
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  supplierArrow: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  supplierBannerWrap: {
    marginTop: SPACING.md,
    borderRadius: RADII.md,
    overflow: 'hidden',
  },
  supplierBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 10,
    paddingHorizontal: 14,
    position: 'relative',
  },
  supplierBannerEdge: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: 3,
    backgroundColor: GOLD_COLOR,
  },
  supplierBannerEdgeRight: {
    position: 'absolute',
    right: 0,
    top: 0,
    bottom: 0,
    width: 3,
    backgroundColor: GOLD_COLOR,
  },
  supplierBannerText: {
    flex: 1,
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.3,
    textAlign: 'center',
  },
  reserveBtn: {
    borderRadius: RADII.lg,
    overflow: 'hidden',
    marginBottom: SPACING.md,
  },
  reserveGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.md,
    padding: SPACING.md,
  },
  reserveIconWrap: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.22)',
  },
  reserveTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: '#1B1B1F',
    letterSpacing: 0.3,
  },
  reserveSub: {
    fontSize: 12,
    color: '#3A3120',
    marginTop: 2,
  },
  metaChipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: SPACING.sm,
    marginBottom: SPACING.lg,
  },
  metaChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: RADII.pill,
    borderWidth: StyleSheet.hairlineWidth,
  },
  metaChipText: {
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.3,
  },
  tabStrip: {
    flexDirection: 'row',
    padding: 4,
    borderRadius: RADII.pill,
    borderWidth: StyleSheet.hairlineWidth,
    marginBottom: SPACING.md,
  },
  tabItem: {
    flex: 1,
    paddingVertical: 10,
    paddingHorizontal: 6,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: RADII.pill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'transparent',
  },
  tabText: {
    fontSize: 11.5,
    fontWeight: '700',
    letterSpacing: 0.4,
  },
  tabPanel: {
    paddingVertical: SPACING.md,
    minHeight: 120,
  },
  bodyCopy: {
    fontSize: 14.5,
    lineHeight: 23,
    letterSpacing: 0.2,
  },
  panelEyebrow: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.8,
    textTransform: 'uppercase',
    marginBottom: SPACING.md,
  },
  ingredientRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 10,
  },
  ingredientDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  ingredientText: {
    fontSize: 14,
    letterSpacing: 0.2,
    flex: 1,
  },
  pairingCard: {
    padding: SPACING.lg,
    borderRadius: RADII.lg,
    borderWidth: StyleSheet.hairlineWidth,
  },
  pairingHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: SPACING.md,
  },
  pairingIconWrap: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pairingTitle: {
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  nutritionGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: SPACING.sm,
  },
  nutritionCell: {
    flexBasis: '47%',
    flexGrow: 1,
    paddingVertical: SPACING.md,
    paddingHorizontal: SPACING.md,
    borderRadius: RADII.md,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
  },
  nutritionValue: {
    fontSize: 18,
    fontWeight: '800',
    letterSpacing: 0.4,
  },
  nutritionLabel: {
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.6,
    marginTop: 4,
    textTransform: 'uppercase',
  },
  section: {
    marginTop: SPACING.lg,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: SPACING.md,
  },
  sectionTitle: {
    ...TYPE.title,
    fontSize: 20,
    letterSpacing: 0.3,
  },
  sectionCount: {
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.4,
  },
  reviewCta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 12,
    paddingHorizontal: SPACING.lg,
    borderRadius: RADII.pill,
    borderWidth: StyleSheet.hairlineWidth,
    marginBottom: SPACING.md,
  },
  reviewCtaText: {
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 0.4,
  },
  fitmentLabel: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.4,
  },
});

// Car Model Grid Styles - Separate for cleaner organization
const carModelGridStyles = StyleSheet.create({
  gridContainer: {
    width: '100%',
    minHeight: 200,
    marginTop: 5,
  },
  listContent: {
    paddingVertical: 5,
  },
  cardWrapper: {
    flex: 1,
    padding: 5,
    minHeight: 160,
  },
});

const restSectionStyles = StyleSheet.create({
  iconWrap: {
    width: 28,
    height: 28,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  countBadge: {
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 12,
    minWidth: 28,
    alignItems: 'center',
  },
  countText: {
    fontSize: 13,
    fontWeight: '700',
  },
  hScroll: {
    paddingVertical: 12,
    gap: 10,
    paddingHorizontal: 2,
  },
});
