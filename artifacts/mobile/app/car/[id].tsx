import React, { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Linking,
  Alert,
  Platform,
  Dimensions,
  LayoutAnimation,
  UIManager,
} from 'react-native';
import { Image } from 'expo-image';
import { VideoView, useVideoPlayer } from 'expo-video';
import { useEvent } from 'expo';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import * as FileSystem from 'expo-file-system/legacy';
import { MapsPreviewStrip } from '../../src/components/MapsPreviewStrip';
import { getOpenStatus, getOpenStatusFromSchedule, DayHours } from '../../src/utils/timeUtils';
import { OpenStatusBadge } from '../../src/components/OpenStatusBadge';
import * as Sharing from 'expo-sharing';
import * as Haptics from 'expo-haptics';

const SCREEN_WIDTH = Dimensions.get('window').width;
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSequence,
  withRepeat,
  withTiming,
  interpolate,
  interpolateColor,
  Easing,
  runOnJS,
  useAnimatedScrollHandler,
  Extrapolation,
} from 'react-native-reanimated';
import { Header } from '../../src/components/Header';
import { Footer } from '../../src/components/Footer';
import { useTheme } from '../../src/hooks/useTheme';
import { useTranslation } from '../../src/hooks/useTranslation';
import { useAppStore } from '../../src/store/appStore';
import { api, carModelsApi, cartApi, favoritesApi, ratingsApi } from '../../src/services/api';
import { useCartMutations, shoppingHubKeys } from '../../src/hooks/queries/useShoppingHubQuery';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AnimatedCartButton, AnimatedCartButtonRef, AnimatedFavoriteButton } from '../../src/components/AnimatedIconButton';
import { Skeleton } from '../../src/components/ui/Skeleton';
import { TYPE, SPACING, RADII, ELEVATION, GRADIENTS } from '../../src/constants/luxuryTokens';
import GlobalRatingsStrip from '../../src/components/home/GlobalRatingsStrip';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

const HERO_HEIGHT = 420;
const GOLD_COLOR = '#C8A24A';

const DEFAULT_INTERFACE_TEXTS: Record<string, string> = {
  estLabel_ar: 'منذ',
  estLabel_en: 'Est.',
  dishCountLabel_ar: 'طبق',
  dishCountLabel_en: 'dishes',
  cuisineSuffix_ar: 'مطبخ',
  cuisineSuffix_en: 'cuisine',
  featuredLabel_ar: 'مطعم مميز',
  featuredLabel_en: 'Featured restaurant',
  chefLabel_ar: 'الشيف المسؤول',
  chefLabel_en: "Head Chef & Maître d'",
  subscribeBanner_ar: 'اشترك للاطلاع على القائمة الكاملة وحجز الطاولة',
  subscribeBanner_en: 'Subscribe to view the full menu & reserve a table',
  reserveTitle_ar: 'احجز تجربتك الراقية',
  reserveTitle_en: 'Reserve your experience',
  reserveSub_ar: 'مزايا حصرية للأعضاء',
  reserveSub_en: 'Exclusive member privileges',
  storySectionLabel_ar: 'حكاية المطعم',
  storySectionLabel_en: 'The Story',
  storyTitle_ar: 'لمحة عن التجربة',
  storyTitle_en: 'About this restaurant',
  viewMenuLabel_ar: 'عرض القائمة الكاملة (PDF)',
  viewMenuLabel_en: 'View the full menu (PDF)',
  signatureLabel_ar: 'أطباقنا المميزة',
  signatureLabel_en: 'Signature Dishes',
  chefPickBadge_ar: 'موصى به',
  chefPickBadge_en: "Chef's pick",
  menuLabel_ar: 'القائمة',
  menuLabel_en: 'The Menu',
  courseLabel_ar: 'فصل',
  courseLabel_en: 'Course',
  emptyTitle_ar: 'القائمة قيد التحضير',
  emptyTitle_en: 'Menu coming soon',
  emptyBody_ar: 'يعمل طاقمنا على تقديم تجربة استثنائية. تابعونا قريباً.',
  emptyBody_en: 'Our chefs are crafting an exceptional experience. Stay tuned.',
  soldOutLabel_ar: 'نفذت الكمية',
  soldOutLabel_en: 'Sold out',
};

// ─────────────────────────────────────────────────────────────────────────────
// Group compatible products by SKU so each unique dish shows as a single card
// ─────────────────────────────────────────────────────────────────────────────
type CompatibleVariant = {
  id: string;
  indicator: string;
  price: number;
  stock: number;
};
type CompatibleGroup = {
  groupKey: string;
  primary: any;
  variants: CompatibleVariant[];
};

const STD_FIRST_ORDER = ['STD', '010', '020', '030', '040'];

function groupCompatibleBySku(products: any[]): CompatibleGroup[] {
  if (!Array.isArray(products) || products.length === 0) return [];
  const map = new Map<string, CompatibleGroup>();
  for (const p of products) {
    const key = p.sku ? `sku:${String(p.sku).toUpperCase()}` : `id:${p.id}`;
    const variantsFromServer: CompatibleVariant[] = Array.isArray(p.available_variants)
      ? p.available_variants.map((v: any) => ({
          id: String(v.id),
          indicator: String(v.indicator || 'STD').toUpperCase(),
          price: Number(v.price) || 0,
          stock: Number(v.stock) || 0,
        }))
      : [];
    const existing = map.get(key);
    if (existing) {
      for (const v of variantsFromServer) {
        if (!existing.variants.some((x) => x.id === v.id)) existing.variants.push(v);
      }
      const existingInd = String(existing.primary.fitment_indicator || 'STD').toUpperCase();
      const incomingInd = String(p.fitment_indicator || 'STD').toUpperCase();
      if (existingInd !== 'STD' && incomingInd === 'STD') existing.primary = p;
      continue;
    }
    const variants =
      variantsFromServer.length > 0
        ? variantsFromServer
        : [
            {
              id: String(p.id),
              indicator: String(p.fitment_indicator || 'STD').toUpperCase(),
              price: Number(p.price) || 0,
              stock: Number(p.stock_quantity) >= 0 ? Number(p.stock_quantity) : 0,
            },
          ];
    map.set(key, { groupKey: key, primary: p, variants });
  }
  for (const g of map.values()) {
    g.variants.sort((a, b) => {
      const ai = STD_FIRST_ORDER.indexOf(a.indicator);
      const bi = STD_FIRST_ORDER.indexOf(b.indicator);
      if (ai === -1 && bi === -1) return a.indicator.localeCompare(b.indicator);
      if (ai === -1) return 1;
      if (bi === -1) return -1;
      return ai - bi;
    });
  }
  return Array.from(map.values());
}

type MenuCourse = {
  key: string;
  label: { en: string; ar: string };
  groups: CompatibleGroup[];
};

const COURSE_BUCKETS: { key: string; en: string[]; ar: string[] }[] = [
  { key: 'starters', en: ['starter', 'appetizer', 'mezze', 'meze', 'salad', 'soup'], ar: ['مقبل', 'سلطة', 'شوربة', 'مزة'] },
  { key: 'mains',    en: ['main', 'entree', 'entrée', 'plate', 'pasta', 'rice', 'grill', 'meat', 'fish', 'seafood', 'chicken', 'lamb', 'beef'], ar: ['طبق رئيسي', 'الرئيسية', 'مشاوي', 'لحم', 'دجاج', 'سمك', 'أرز', 'مكرونة'] },
  { key: 'desserts', en: ['dessert', 'sweet', 'pastry', 'cake', 'ice cream'], ar: ['حلوى', 'حلويات', 'تحلية', 'حلو'] },
  { key: 'beverages', en: ['beverage', 'drink', 'coffee', 'tea', 'juice', 'cocktail', 'wine', 'water', 'soda'], ar: ['مشروب', 'مشروبات', 'قهوة', 'شاي', 'عصير', 'ماء'] },
  { key: 'sides', en: ['side', 'bread', 'extra', 'add-on', 'addon'], ar: ['جانبي', 'إضافات', 'خبز'] },
  { key: 'menu', en: ['menu', 'other', 'misc'], ar: ['القائمة', 'أخرى', 'متنوع'] },
];

function bucketKeyFor(labelEn: string, labelAr: string): string {
  const en = labelEn.toLowerCase().trim();
  const ar = labelAr.trim();
  for (const bucket of COURSE_BUCKETS) {
    if (bucket.en.some((needle) => en.includes(needle))) return bucket.key;
    if (bucket.ar.some((needle) => ar.includes(needle))) return bucket.key;
  }
  return 'other';
}

const COURSE_PRIORITY: Record<string, number> = COURSE_BUCKETS.reduce(
  (acc, b, i) => ({ ...acc, [b.key]: i }),
  { other: COURSE_BUCKETS.length },
);

function buildMenuCourses(groups: CompatibleGroup[], language: string): MenuCourse[] {
  if (groups.length === 0) return [];

  const buckets = new Map<string, MenuCourse & { _priority: number }>();
  for (const g of groups) {
    const cat = g.primary.category;
    const key = cat?.id || 'menu';
    const labelEn = cat?.name || 'Menu';
    const labelAr = cat?.name_ar || cat?.name || 'القائمة';
    if (!buckets.has(key)) {
      const bucketKey = bucketKeyFor(labelEn, labelAr);
      buckets.set(key, {
        key,
        label: { en: labelEn, ar: labelAr },
        groups: [],
        _priority: COURSE_PRIORITY[bucketKey] ?? COURSE_BUCKETS.length,
      });
    }
    buckets.get(key)!.groups.push(g);
  }

  const courses = Array.from(buckets.values());
  courses.sort((a, b) => {
    if (a._priority !== b._priority) return a._priority - b._priority;
    return a.label.en.localeCompare(b.label.en);
  });
  return courses.map(({ _priority, ...rest }) => rest);
}

const canViewEntityProfile = (
  userRole?: string,
  subscriptionStatus?: string,
  userObjRole?: string,
): boolean => {
  const allowedRoles = ['owner', 'admin', 'partner', 'subscriber'];
  return (
    allowedRoles.includes(userRole || '') ||
    allowedRoles.includes(userObjRole || '') ||
    subscriptionStatus === 'subscriber'
  );
};

export default function RestaurantDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { colors, isDark } = useTheme();
  const { t, isRTL, language } = useTranslation();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user, addToLocalCart } = useAppStore();
  const subscriptionStatus = useAppStore((state) => state.subscriptionStatus);
  const userRole = useAppStore((state) => state.userRole);

  const queryClient = useQueryClient();
  const { checkDuplicate } = useCartMutations();

  const privilegedRoles = ['owner', 'admin', 'partner', 'subscriber'];
  const canDownloadCatalog =
    subscriptionStatus === 'subscriber' ||
    privilegedRoles.includes(userRole || '') ||
    privilegedRoles.includes(user?.role || '');

  const showSubscribeButton =
    subscriptionStatus === 'none' &&
    !privilegedRoles.includes(userRole || '') &&
    !privilegedRoles.includes(user?.role || '');

  const canViewProfile = canViewEntityProfile(userRole, subscriptionStatus, user?.role);

  const [addedProducts, setAddedProducts] = useState<Set<string>>(new Set());
  const [addingProductId, setAddingProductId] = useState<string | null>(null);
  const [favoriteProducts, setFavoriteProducts] = useState<Set<string>>(new Set());
  const [togglingFavorite, setTogglingFavorite] = useState<Set<string>>(new Set());
  const [expandedCourse, setExpandedCourse] = useState<string | null>(null);

  // Non-blocking background fetch — screen renders immediately with defaults
  const { data: rawTexts } = useQuery({
    queryKey: ['public-settings', 'car_interface_texts'],
    queryFn: async () => {
      try {
        const r = await api.get('/public/settings/car_interface_texts');
        return (r.data?.value ?? {}) as Record<string, string>;
      } catch {
        return {} as Record<string, string>;
      }
    },
    staleTime: 5 * 60 * 1000,
    placeholderData: DEFAULT_INTERFACE_TEXTS,
  });
  const interfaceTexts = rawTexts ?? DEFAULT_INTERFACE_TEXTS;

  const cartButtonRefs = useRef<Map<string, AnimatedCartButtonRef>>(new Map());
  const setCartButtonRef = useCallback(
    (productId: string, ref: AnimatedCartButtonRef | null) => {
      if (ref) cartButtonRefs.current.set(productId, ref);
      else cartButtonRefs.current.delete(productId);
    },
    [],
  );

  const { data: ratingDist } = useQuery({
    queryKey: ['ratings-distribution', id],
    queryFn: async () => {
      try {
        const r = await ratingsApi.getDistribution({ restaurant_id: id as string });
        return r.data;
      } catch {
        return null;
      }
    },
    enabled: !!id,
    staleTime: 2 * 60 * 1000,
  });

  const { data: restaurantHours } = useQuery<DayHours[]>({
    queryKey: ['restaurant-hours', id],
    queryFn: async () => {
      try {
        const r = await api.get<DayHours[]>(`/car-models/${id}/hours`);
        return r.data || [];
      } catch {
        return [];
      }
    },
    enabled: !!id,
    staleTime: 5 * 60 * 1000,
  });

  // Subscribe banner shimmer
  const glowProgress = useSharedValue(0);
  const triggerGoldenGlow = useCallback(() => {
    if (Platform.OS !== 'web') {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    }
    const flash = 250;
    glowProgress.value = withSequence(
      withTiming(1, { duration: flash, easing: Easing.inOut(Easing.ease) }),
      withTiming(0, { duration: flash, easing: Easing.inOut(Easing.ease) }),
      withTiming(1, { duration: flash, easing: Easing.inOut(Easing.ease) }),
      withTiming(0, { duration: flash, easing: Easing.inOut(Easing.ease) }),
    );
  }, []);
  const glowTextStyle = useAnimatedStyle(() => ({
    color: interpolateColor(glowProgress.value, [0, 1], ['#FFFFFF', GOLD_COLOR]),
  }));

  const [carModel, setCarModel] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [downloadingCatalog, setDownloadingCatalog] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const carPromise = carModelsApi
      .getById(id as string)
      .then((res) => res.data)
      .catch((err) => {
        console.error('Error fetching restaurant:', err);
        return null;
      });
    const favPromise = user
      ? favoritesApi
          .getAll()
          .then(
            (res) =>
              new Set<string>(
                (res.data || []).map((f: any) => f.product_id || f.id),
              ),
          )
          .catch(() => new Set<string>())
      : Promise.resolve(new Set<string>());

    Promise.all([carPromise, favPromise]).then(([cm, favIds]) => {
      if (cancelled) return;
      setCarModel(cm);
      setFavoriteProducts(favIds);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [id, user]);

  const compatibleGroups = useMemo(
    () => groupCompatibleBySku(carModel?.compatible_products ?? []),
    [carModel?.compatible_products],
  );

  // Top 5 dishes are featured as "signature dishes"; remainder go into menu.
  const signatureDishes = useMemo(
    () => compatibleGroups.slice(0, 5),
    [compatibleGroups],
  );
  const menuGroups = useMemo(
    () => compatibleGroups.slice(5),
    [compatibleGroups],
  );
  const menuCourses = useMemo(
    () => buildMenuCourses(menuGroups, language),
    [menuGroups, language],
  );

  // Default to first course expanded once data loads
  useEffect(() => {
    if (menuCourses.length > 0 && expandedCourse === null) {
      setExpandedCourse(menuCourses[0].key);
    }
  }, [menuCourses, expandedCourse]);

  const handleToggleFavorite = useCallback(
    async (productId: string) => {
      if (!user) {
        router.push('/login');
        return;
      }
      setTogglingFavorite((prev) => new Set(prev).add(productId));
      try {
        const response = await favoritesApi.toggle(productId);
        setFavoriteProducts((prev) => {
          const next = new Set(prev);
          if (response.data.is_favorite) next.add(productId);
          else next.delete(productId);
          return next;
        });
      } catch (error) {
        console.error('Toggle favorite error:', error);
      } finally {
        setTogglingFavorite((prev) => {
          const next = new Set(prev);
          next.delete(productId);
          return next;
        });
      }
    },
    [user, router],
  );

  const handleDownloadCatalog = async () => {
    if (!carModel?.catalog_pdf) {
      Alert.alert(
        language === 'ar' ? 'غير متاح' : 'Not Available',
        language === 'ar'
          ? 'لا توجد قائمة متاحة لهذا المطعم حالياً'
          : 'No menu available for this restaurant yet',
      );
      return;
    }

    setDownloadingCatalog(true);
    try {
      const catalogData = carModel.catalog_pdf;
      const rawName = (carModel.name_ar || carModel.name || 'menu').replace(/\s+/g, '_');
      const fileName = `${rawName}_menu.pdf`;

      if (Platform.OS === 'web') {
        let blobUrl: string;
        if (catalogData.startsWith('data:application/pdf;base64,')) {
          const base64 = catalogData.split(',')[1];
          const binary = atob(base64);
          const bytes = new Uint8Array(binary.length);
          for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
          const blob = new Blob([bytes], { type: 'application/pdf' });
          blobUrl = URL.createObjectURL(blob);
        } else {
          window.open(catalogData, '_blank');
          return;
        }
        const link = document.createElement('a');
        link.href = blobUrl;
        link.download = fileName;
        link.style.display = 'none';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        setTimeout(() => URL.revokeObjectURL(blobUrl), 500);
      } else {
        const base64Data = catalogData.startsWith('data:')
          ? catalogData.split(',')[1]
          : catalogData;
        const fileUri = `${FileSystem.documentDirectory ?? ''}${fileName}`;
        await FileSystem.writeAsStringAsync(fileUri, base64Data, {
          encoding: 'base64',
        });
        if (await Sharing.isAvailableAsync()) {
          await Sharing.shareAsync(fileUri, {
            mimeType: 'application/pdf',
            dialogTitle: language === 'ar' ? 'افتح القائمة' : 'Open menu',
            UTI: 'com.adobe.pdf',
          });
        } else {
          await Linking.openURL(fileUri);
        }
      }
    } catch (error) {
      console.error('Error downloading menu:', error);
      Alert.alert(
        language === 'ar' ? 'خطأ' : 'Error',
        language === 'ar'
          ? 'فشل تحميل القائمة، يرجى المحاولة مرة أخرى'
          : 'Failed to download the menu, please try again',
      );
    } finally {
      setDownloadingCatalog(false);
    }
  };

  const getName = (item: any, field: string = 'name') => {
    if (!item) return '';
    const arField = `${field}_ar`;
    return language === 'ar' && item?.[arField] ? item[arField] : item?.[field] || '';
  };

  const ui = useCallback(
    (key: string): string => {
      const activeKey = language === 'ar' ? `${key}_ar` : `${key}_en`;
      return interfaceTexts[activeKey] !== undefined
        ? interfaceTexts[activeKey]
        : DEFAULT_INTERFACE_TEXTS[activeKey] ?? '';
    },
    [interfaceTexts, language],
  );

  const handleAddToCart = useCallback(
    async (product: any) => {
      if (!user) {
        router.push('/login');
        return;
      }
      if (checkDuplicate(product.id)) {
        const buttonRef = cartButtonRefs.current.get(product.id);
        if (buttonRef) buttonRef.triggerShake();
        if (Platform.OS !== 'web') {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
        }
        Alert.alert(
          language === 'ar' ? 'تنبيه' : 'Notice',
          language === 'ar'
            ? 'هذا الطبق موجود بالفعل في طلبك'
            : 'This dish is already in your order',
          [{ text: language === 'ar' ? 'حسناً' : 'OK', style: 'default' }],
          { cancelable: true },
        );
        return;
      }

      setAddingProductId(product.id);
      try {
        const fi: string | null = product?.fitment_indicator ?? null;
        await cartApi.addItem(product.id, 1, fi);
        queryClient.invalidateQueries({ queryKey: shoppingHubKeys.cart });
        addToLocalCart({ product_id: product.id, quantity: 1, product });
        setAddedProducts((prev) => new Set(prev).add(product.id));
        if (Platform.OS !== 'web') {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        }
      } catch (error) {
        console.error('Error adding to order:', error);
      } finally {
        setAddingProductId(null);
      }
    },
    [user, router, checkDuplicate, language, queryClient, addToLocalCart],
  );

  // Parallax scroll
  const scrollY = useSharedValue(0);
  const scrollHandler = useAnimatedScrollHandler({
    onScroll: (event) => {
      scrollY.value = event.contentOffset.y;
    },
  });

  const heroImageStyle = useAnimatedStyle(() => ({
    transform: [
      {
        translateY: interpolate(
          scrollY.value,
          [-HERO_HEIGHT, 0, HERO_HEIGHT],
          [-HERO_HEIGHT / 2, 0, HERO_HEIGHT * 0.55],
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
      [0, HERO_HEIGHT * 0.5],
      [0, 0.55],
      Extrapolation.CLAMP,
    ),
  }));

  if (loading) {
    const skBg = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.07)';
    const skBgAlt = isDark ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.05)';
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <Header title="" showBack={true} />
        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          {/* Hero */}
          <Skeleton width={SCREEN_WIDTH} height={HERO_HEIGHT} borderRadius={0} moodAware={false} />

          <View style={{ paddingHorizontal: SPACING.xl, paddingTop: SPACING.xxl }}>
            {/* Cuisine label + title */}
            <Skeleton width={110} height={11} borderRadius={5} moodAware={false} />
            <View style={{ height: SPACING.sm }} />
            <Skeleton width="75%" height={30} borderRadius={7} moodAware={false} />
            <View style={{ height: SPACING.sm }} />
            <View style={{ flexDirection: 'row', gap: SPACING.sm }}>
              <Skeleton width={80} height={26} borderRadius={RADII.pill} moodAware={false} />
              <Skeleton width={90} height={26} borderRadius={RADII.pill} moodAware={false} />
            </View>
            <View style={{ height: SPACING.xl }} />

            {/* Manager card */}
            <Skeleton width="100%" height={72} borderRadius={RADII.lg} moodAware={false} />
            <View style={{ height: SPACING.xl }} />

            {/* Story section */}
            <View style={{ alignItems: 'center', gap: SPACING.md }}>
              <Skeleton width={160} height={12} borderRadius={5} moodAware={false} />
              <Skeleton width="85%" height={22} borderRadius={6} moodAware={false} />
              <Skeleton width="100%" height={14} borderRadius={5} moodAware={false} />
              <Skeleton width="90%" height={14} borderRadius={5} moodAware={false} />
              <Skeleton width="80%" height={14} borderRadius={5} moodAware={false} />
            </View>
            <View style={{ height: SPACING.xxl }} />

            {/* Signature dishes carousel skeleton */}
            <Skeleton width={140} height={18} borderRadius={6} moodAware={false} />
            <View style={{ height: SPACING.lg }} />
          </View>

          {/* Horizontal signature scroll — extends to edges */}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ paddingHorizontal: SPACING.xl, gap: SPACING.md }}
            scrollEnabled={false}
          >
            {[0, 1, 2].map((i) => (
              <View key={i} style={{ width: 220, gap: 0 }}>
                <Skeleton width={220} height={160} borderRadius={RADII.lg} moodAware={false} />
                <View style={{ padding: SPACING.md, gap: SPACING.sm }}>
                  <Skeleton width={140} height={14} borderRadius={5} moodAware={false} />
                  <Skeleton width={90} height={11} borderRadius={4} moodAware={false} />
                  <Skeleton width={70} height={16} borderRadius={5} moodAware={false} />
                </View>
              </View>
            ))}
          </ScrollView>

          <View style={{ paddingHorizontal: SPACING.xl, paddingTop: SPACING.xxl }}>
            {/* Menu section header */}
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: SPACING.lg }}>
              <Skeleton width={100} height={20} borderRadius={6} moodAware={false} />
              <Skeleton width={60} height={16} borderRadius={5} moodAware={false} />
            </View>

            {/* Course accordion skeletons */}
            {[0, 1, 2].map((i) => (
              <View
                key={i}
                style={{
                  borderRadius: RADII.lg,
                  borderWidth: 1,
                  borderColor: colors.border,
                  marginBottom: SPACING.md,
                  overflow: 'hidden',
                }}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center', padding: SPACING.lg, gap: SPACING.md }}>
                  <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: skBg }} />
                  <View style={{ flex: 1, gap: SPACING.xs }}>
                    <View style={{ width: 60, height: 10, borderRadius: 4, backgroundColor: skBg }} />
                    <View style={{ width: '55%', height: 16, borderRadius: 6, backgroundColor: skBgAlt }} />
                  </View>
                  <View style={{ width: 18, height: 18, borderRadius: 9, backgroundColor: skBg }} />
                </View>

                {/* First course pre-expanded to show rows */}
                {i === 0 && (
                  <View style={{ paddingHorizontal: SPACING.lg, paddingBottom: SPACING.md, gap: 0 }}>
                    {[0, 1].map((j) => (
                      <View
                        key={j}
                        style={{
                          flexDirection: 'row',
                          alignItems: 'center',
                          paddingVertical: SPACING.md,
                          gap: SPACING.md,
                          borderTopWidth: j > 0 ? StyleSheet.hairlineWidth : 0,
                          borderTopColor: colors.border,
                        }}
                      >
                        <View style={{ width: 64, height: 64, borderRadius: RADII.md, backgroundColor: skBg }} />
                        <View style={{ flex: 1, gap: SPACING.xs }}>
                          <View style={{ width: '70%', height: 14, borderRadius: 5, backgroundColor: skBgAlt }} />
                          <View style={{ width: '55%', height: 11, borderRadius: 4, backgroundColor: skBg }} />
                          <View style={{ width: 80, height: 14, borderRadius: 5, backgroundColor: skBg }} />
                        </View>
                        <View style={{ gap: SPACING.sm }}>
                          <View style={{ width: 30, height: 30, borderRadius: 15, backgroundColor: skBg }} />
                          <View style={{ width: 30, height: 30, borderRadius: 15, backgroundColor: skBg }} />
                        </View>
                      </View>
                    ))}
                  </View>
                )}
              </View>
            ))}
          </View>
          <View style={{ height: SPACING.xxl + 40 }} />
        </ScrollView>
        <Footer />
      </View>
    );
  }

  if (!carModel) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <Header title={t('error')} showBack={true} />
        <View style={styles.errorContainer}>
          <Text style={[styles.errorText, { color: colors.textSecondary }]}>
            {t('error')}
          </Text>
        </View>
        <Footer />
      </View>
    );
  }

  const heroImages =
    carModel.images && carModel.images.length > 0
      ? carModel.images
      : carModel.image_url
      ? [carModel.image_url]
      : [];
  const heroImage = heroImages[0];

  const restaurantName = getName(carModel);
  const restaurantStory =
    getName(carModel, 'description') ||
    (language === 'ar'
      ? 'تجربة طعام راقية تدمج بين عراقة المكوّنات وحرفية الطهاة، حيث يصبح كل طبق قصة تستحق أن تُروى.'
      : 'A refined dining experience where heirloom ingredients meet contemporary craft, and every plate becomes a story worth telling.');
  const cuisineLabel = carModel.brand
    ? language === 'ar'
      ? `${getName(carModel.brand)} • ${ui('cuisineSuffix')}`
      : `${getName(carModel.brand)} ${ui('cuisineSuffix')}`
    : ui('featuredLabel');

  const handleCourseToggle = (key: string) => {
    if (Platform.OS !== 'web') {
      Haptics.selectionAsync();
    }
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setExpandedCourse((prev) => (prev === key ? null : key));
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <Header title={restaurantName} showBack={true} />

      <Animated.ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        onScroll={scrollHandler}
        scrollEventThrottle={16}
      >
        {/* ─── Parallax hero ────────────────────────────────────────────── */}
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

          <LinearGradient
            colors={['rgba(11,11,14,0.0)', 'rgba(11,11,14,0.5)', 'rgba(11,11,14,0.95)']}
            locations={[0, 0.55, 1]}
            style={StyleSheet.absoluteFill}
            pointerEvents="none"
          />
          <Animated.View
            style={[StyleSheet.absoluteFill, { backgroundColor: '#0B0B0E' }, heroVeilStyle]}
            pointerEvents="none"
          />

          <View style={styles.heroContent}>
            <Text style={styles.heroEyebrow}>{cuisineLabel.toUpperCase()}</Text>
            <Text style={styles.heroTitle} numberOfLines={2}>
              {restaurantName}
            </Text>
            <View style={styles.heroMetaRow}>
              {(() => {
                const hours = restaurantHours && restaurantHours.length > 0 ? restaurantHours : null;
                const status = hours
                  ? getOpenStatusFromSchedule(hours, language)
                  : getOpenStatus(carModel.year_start, carModel.year_end, language);
                return status ? <OpenStatusBadge status={status} size="md" /> : null;
              })()}
              {compatibleGroups.length > 0 ? (
                <View style={styles.heroMetaPill}>
                  <Ionicons name="restaurant-outline" size={12} color="#E8D29A" />
                  <Text style={styles.heroMetaText}>
                    {compatibleGroups.length}{' '}
                    {ui('dishCountLabel')}
                  </Text>
                </View>
              ) : null}
            </View>
          </View>
        </View>

        {/* ─── Body sheet ───────────────────────────────────────────────── */}
        <View style={[styles.bodySheet, { backgroundColor: colors.background }]}>
          {/* Delivery & Feast Company block — prefers linked_supplier, falls back to legacy distributor */}
          {(carModel.linked_supplier || carModel.distributor) && (
            <TouchableOpacity
              style={[
                styles.managerCard,
                { backgroundColor: colors.card, borderColor: colors.border },
                ELEVATION.card,
              ]}
              onPress={() => {
                const sc = carModel.linked_supplier || carModel.distributor;
                if (canViewProfile) {
                  if (carModel.linked_supplier) {
                    router.push(`/owner/suppliers?viewMode=profile&id=${sc.id}`);
                  } else {
                    router.push(`/owner/distributors?viewMode=profile&id=${sc.id}`);
                  }
                } else {
                  triggerGoldenGlow();
                }
              }}
              activeOpacity={0.9}
            >
              <View style={styles.managerRow}>
                <View
                  style={[
                    styles.managerAvatar,
                    { backgroundColor: colors.surface, borderColor: colors.primary + '40' },
                  ]}
                >
                  {(carModel.linked_supplier || carModel.distributor).profile_image ? (
                    <Image
                      source={{ uri: (carModel.linked_supplier || carModel.distributor).profile_image }}
                      style={styles.managerAvatarImg}
                      contentFit="cover"
                      cachePolicy="memory-disk"
                    />
                  ) : (
                    <Ionicons name="bicycle" size={42} color={colors.primary} />
                  )}
                </View>
                <View style={styles.managerText}>
                  <Text style={[styles.managerLabel, { color: colors.primary }]}>
                    {language === 'ar' ? 'شركة التوصيل الشريكة' : 'Delivery & Feast Partner'}
                  </Text>
                  <Text
                    style={[styles.managerName, { color: colors.text }]}
                    numberOfLines={1}
                  >
                    {language === 'ar' && (carModel.linked_supplier || carModel.distributor).name_ar
                      ? (carModel.linked_supplier || carModel.distributor).name_ar
                      : (carModel.linked_supplier || carModel.distributor).name}
                  </Text>
                </View>
                <View style={[styles.managerArrow, { backgroundColor: colors.primary + '18' }]}>
                  <Ionicons
                    name={canViewProfile ? 'chevron-forward' : 'lock-closed'}
                    size={16}
                    color={colors.primary}
                  />
                </View>
              </View>

              {showSubscribeButton && (
                <View style={styles.subscribeBannerWrap}>
                  <LinearGradient
                    colors={GRADIENTS.midnightBistro}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 0 }}
                    style={styles.subscribeBanner}
                  >
                    <View style={styles.subscribeBannerEdge} />
                    <Ionicons name="sparkles" size={14} color={GOLD_COLOR} />
                    <Animated.Text style={[styles.subscribeBannerText, glowTextStyle]}>
                      {ui('subscribeBanner')}
                    </Animated.Text>
                    <Ionicons name="sparkles" size={14} color={GOLD_COLOR} />
                    <View style={styles.subscribeBannerEdgeRight} />
                  </LinearGradient>
                </View>
              )}
            </TouchableOpacity>
          )}

          {showSubscribeButton && (
            <TouchableOpacity
              style={styles.reserveBtn}
              onPress={() => router.push('/subscription-request')}
              activeOpacity={0.9}
            >
              <LinearGradient
                colors={GRADIENTS.goldShimmer}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.reserveBtnGradient}
              >
                <View style={styles.reserveBtnIcon}>
                  <Ionicons name="star" size={20} color="#FFF" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.reserveBtnTitle}>
                    {ui('reserveTitle')}
                  </Text>
                  <Text style={styles.reserveBtnSub}>
                    {ui('reserveSub')}
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color="#1B1B1F" />
              </LinearGradient>
            </TouchableOpacity>
          )}

          {/* Story block */}
          <View style={styles.storyBlock}>
            <View style={styles.sectionLabelRow}>
              <View style={[styles.rule, { backgroundColor: colors.primary }]} />
              <Text style={[styles.sectionLabel, { color: colors.primary }]}>
                {ui('storySectionLabel')}
              </Text>
              <View style={[styles.rule, { backgroundColor: colors.primary }]} />
            </View>
            <Text style={[styles.storyTitle, { color: colors.text }]}>
              {ui('storyTitle')}
            </Text>
            <Text style={[styles.storyBody, { color: colors.textSecondary }]}>
              {restaurantStory}
            </Text>

            {/* Menu PDF chip */}
            <TouchableOpacity
              style={[
                styles.menuPdfChip,
                {
                  borderColor: colors.primary + '60',
                  backgroundColor: colors.primary + '10',
                  opacity: canDownloadCatalog ? 1 : 0.6,
                },
              ]}
              onPress={() => {
                if (canDownloadCatalog) handleDownloadCatalog();
                else router.push('/subscription-request');
              }}
              activeOpacity={0.85}
              disabled={downloadingCatalog}
            >
              {downloadingCatalog ? (
                <ActivityIndicator size="small" color={colors.primary} />
              ) : (
                <Ionicons
                  name={canDownloadCatalog ? 'document-text-outline' : 'lock-closed'}
                  size={15}
                  color={colors.primary}
                />
              )}
              <Text style={[styles.menuPdfText, { color: colors.primary }]}>
                {downloadingCatalog
                  ? language === 'ar'
                    ? 'جاري التحضير...'
                    : 'Preparing...'
                  : ui('viewMenuLabel')}
              </Text>
            </TouchableOpacity>
          </View>

          {/* Weekly Schedule */}
          {restaurantHours && restaurantHours.length > 0 && (() => {
            const DAY_EN = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
            const DAY_AR = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
            const today = new Date().getDay();
            return (
              <View style={[styles.section, { paddingHorizontal: SPACING.xl }]}>
                <View style={styles.sectionLabelRow}>
                  <View style={[styles.rule, { backgroundColor: colors.primary }]} />
                  <Text style={[styles.sectionLabel, { color: colors.primary }]}>
                    {language === 'ar' ? 'ساعات العمل' : 'Opening Hours'}
                  </Text>
                  <View style={[styles.rule, { backgroundColor: colors.primary }]} />
                </View>
                <View style={{ gap: 4 }}>
                  {restaurantHours.map((h) => {
                    const isToday = h.day_of_week === today;
                    const dayLabel = language === 'ar' ? DAY_AR[h.day_of_week] : DAY_EN[h.day_of_week];
                    let timeLabel: string;
                    if (h.is_closed) {
                      timeLabel = language === 'ar' ? 'مغلق' : 'Closed';
                    } else if (h.open_minutes != null && h.close_minutes != null) {
                      const fmt = (m: number) => {
                        const hh = Math.floor(m / 60) % 24;
                        const mm = m % 60;
                        const period = hh < 12 ? (language === 'ar' ? 'ص' : 'AM') : (language === 'ar' ? 'م' : 'PM');
                        const dh = hh % 12 || 12;
                        return `${String(dh).padStart(2, '0')}:${String(mm).padStart(2, '0')} ${period}`;
                      };
                      timeLabel = `${fmt(h.open_minutes)} — ${fmt(h.close_minutes)}`;
                    } else {
                      timeLabel = language === 'ar' ? 'غير محدد' : 'Hours not set';
                    }
                    return (
                      <View
                        key={h.day_of_week}
                        style={{
                          flexDirection: language === 'ar' ? 'row-reverse' : 'row',
                          alignItems: 'center',
                          paddingVertical: 7,
                          paddingHorizontal: 12,
                          borderRadius: 10,
                          borderWidth: isToday ? 1 : 0,
                          borderColor: isToday ? colors.primary + '50' : 'transparent',
                          backgroundColor: isToday ? colors.primary + '08' : 'transparent',
                        }}
                      >
                        <View style={{ flexDirection: language === 'ar' ? 'row-reverse' : 'row', alignItems: 'center', gap: 6, minWidth: 110 }}>
                          {isToday && (
                            <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: h.is_closed ? colors.error : '#22C55E' }} />
                          )}
                          <Text style={{
                            fontSize: 13,
                            fontWeight: isToday ? '700' : '400',
                            color: isToday ? colors.text : colors.textSecondary,
                          }}>
                            {dayLabel}
                          </Text>
                        </View>
                        <Text style={{
                          flex: 1,
                          fontSize: 13,
                          fontWeight: isToday ? '600' : '400',
                          color: h.is_closed ? colors.error : (isToday ? colors.primary : colors.textSecondary),
                          textAlign: language === 'ar' ? 'left' : 'right',
                        }}>
                          {timeLabel}
                        </Text>
                      </View>
                    );
                  })}
                </View>
              </View>
            );
          })()}

          {/* Signature dishes */}
          {signatureDishes.length > 0 && (
            <View style={styles.section}>
              <View style={styles.sectionHeaderRow}>
                <Text style={[styles.sectionTitle, { color: colors.text }]}>
                  {ui('signatureLabel')}
                </Text>
                <Text style={[styles.sectionCount, { color: colors.textSecondary }]}>
                  {signatureDishes.length}
                </Text>
              </View>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.signatureScroll}
                snapToInterval={236}
                decelerationRate="fast"
              >
                {signatureDishes.map((group) => (
                  <SignatureDishCard
                    key={group.groupKey}
                    group={group}
                    colors={colors}
                    isDark={isDark}
                    language={language}
                    ui={ui}
                    getName={getName}
                    router={router}
                    favoriteProducts={favoriteProducts}
                    togglingFavorite={togglingFavorite}
                    addedProducts={addedProducts}
                    addingProductId={addingProductId}
                    setCartButtonRef={setCartButtonRef}
                    handleToggleFavorite={handleToggleFavorite}
                    handleAddToCart={handleAddToCart}
                  />
                ))}
              </ScrollView>
            </View>
          )}

          {/* Menu accordion */}
          {menuCourses.length > 0 && (
            <View style={styles.section}>
              <View style={styles.sectionHeaderRow}>
                <Text style={[styles.sectionTitle, { color: colors.text }]}>
                  {ui('menuLabel')}
                </Text>
                <Text style={[styles.sectionCount, { color: colors.textSecondary }]}>
                  {menuGroups.length}{' '}
                  {ui('dishCountLabel')}
                </Text>
              </View>

              {menuCourses.map((course) => {
                const isOpen = expandedCourse === course.key;
                return (
                  <View
                    key={course.key}
                    style={[
                      styles.courseCard,
                      {
                        backgroundColor: colors.card,
                        borderColor: isOpen ? colors.primary + '50' : colors.border,
                      },
                      ELEVATION.resting,
                    ]}
                  >
                    <TouchableOpacity
                      style={styles.courseHeader}
                      onPress={() => handleCourseToggle(course.key)}
                      activeOpacity={0.85}
                    >
                      <View style={styles.courseHeaderLeft}>
                        <View
                          style={[
                            styles.courseIndex,
                            { borderColor: colors.primary + '40' },
                          ]}
                        >
                          <Text style={[styles.courseIndexText, { color: colors.primary }]}>
                            {String(menuCourses.findIndex((c) => c.key === course.key) + 1).padStart(2, '0')}
                          </Text>
                        </View>
                        <View>
                          <Text
                            style={[styles.courseLabel, { color: colors.primary }]}
                          >
                            {ui('courseLabel')}
                          </Text>
                          <Text style={[styles.courseTitle, { color: colors.text }]}>
                            {language === 'ar' ? course.label.ar : course.label.en}
                          </Text>
                        </View>
                      </View>
                      <View style={styles.courseHeaderRight}>
                        <Text
                          style={[styles.courseCount, { color: colors.textSecondary }]}
                        >
                          {course.groups.length}
                        </Text>
                        <Ionicons
                          name={isOpen ? 'chevron-up' : 'chevron-down'}
                          size={18}
                          color={colors.primary}
                        />
                      </View>
                    </TouchableOpacity>

                    {isOpen && (
                      <View style={styles.courseBody}>
                        {course.groups.map((group, idx) => (
                          <MenuDishRow
                            key={group.groupKey}
                            group={group}
                            colors={colors}
                            language={language}
                            ui={ui}
                            getName={getName}
                            router={router}
                            favoriteProducts={favoriteProducts}
                            togglingFavorite={togglingFavorite}
                            addedProducts={addedProducts}
                            addingProductId={addingProductId}
                            setCartButtonRef={setCartButtonRef}
                            handleToggleFavorite={handleToggleFavorite}
                            handleAddToCart={handleAddToCart}
                            isLast={idx === course.groups.length - 1}
                          />
                        ))}
                      </View>
                    )}
                  </View>
                );
              })}
            </View>
          )}

          {compatibleGroups.length === 0 && (
            <View style={styles.emptyState}>
              <Ionicons name="restaurant-outline" size={56} color={colors.textSecondary} />
              <Text style={[styles.emptyTitle, { color: colors.text }]}>
                {ui('emptyTitle')}
              </Text>
              <Text style={[styles.emptyBody, { color: colors.textSecondary }]}>
                {ui('emptyBody')}
              </Text>
            </View>
          )}

          {/* Restaurant video player */}
          {carModel?.video_url ? (
            <RestaurantVideoPlayer url={carModel.video_url} />
          ) : null}

          {/* Rating distribution chart */}
          {ratingDist && ratingDist.total > 0 && (
            <View style={{ marginTop: SPACING.xxl, paddingHorizontal: SPACING.md }}>
              <Text style={{ color: colors.textSecondary, fontSize: 12, fontWeight: '600', marginBottom: SPACING.sm, letterSpacing: 0.5 }}>
                {language === 'ar' ? 'توزيع التقييمات' : 'Rating Distribution'}
              </Text>
              {([5, 4, 3, 2, 1] as const).map((star) => {
                const count = ratingDist[String(star) as '1' | '2' | '3' | '4' | '5'] ?? 0;
                const pct = ratingDist.total > 0 ? count / ratingDist.total : 0;
                return (
                  <View key={star} style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 4 }}>
                    <Text style={{ color: colors.textSecondary, fontSize: 11, width: 14, textAlign: 'right' }}>{star}</Text>
                    <Ionicons name="star" size={10} color={GOLD_COLOR} style={{ marginHorizontal: 4 }} />
                    <View style={{ flex: 1, height: 6, backgroundColor: colors.surface, borderRadius: 3, overflow: 'hidden' }}>
                      <View style={{ width: `${Math.round(pct * 100)}%`, height: 6, backgroundColor: GOLD_COLOR, borderRadius: 3 }} />
                    </View>
                    <Text style={{ color: colors.textSecondary, fontSize: 10, marginLeft: 6, width: 24, textAlign: 'right' }}>{count}</Text>
                  </View>
                );
              })}
              <Text style={{ color: GOLD_COLOR, fontSize: 13, fontWeight: '700', marginTop: SPACING.sm }}>
                ★ {ratingDist.average.toFixed(1)}
                <Text style={{ color: colors.textSecondary, fontSize: 11, fontWeight: '400' }}>
                  {' '}({ratingDist.total} {language === 'ar' ? 'تقييم' : 'reviews'})
                </Text>
              </Text>
            </View>
          )}

          {/* Restaurant Location Preview */}
          {carModel?.latitude != null && carModel?.longitude != null ? (
            <View style={{ marginTop: SPACING.xxl, paddingHorizontal: SPACING.md }}>
              <Text style={{ color: colors.textSecondary, fontSize: 12, fontWeight: '600', marginBottom: SPACING.sm, letterSpacing: 0.5 }}>
                {language === 'ar' ? 'موقع المطعم' : 'Restaurant Location'}
              </Text>
              <MapsPreviewStrip
                latitude={Number(carModel.latitude)}
                longitude={Number(carModel.longitude)}
                height={180}
              />
            </View>
          ) : null}

          {/* Per-restaurant ratings strip */}
          <View style={{ marginHorizontal: -SPACING.xl, marginTop: SPACING.xxl }}>
            <GlobalRatingsStrip restaurantId={carModel?.id} showEmptyState />
          </View>

          <View style={{ height: SPACING.xxl + (insets.bottom || 0) }} />
        </View>
      </Animated.ScrollView>
      <Footer />
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SignatureDishCard — luxury vertical card for the horizontal carousel
// ─────────────────────────────────────────────────────────────────────────────
type DishCardProps = {
  group: CompatibleGroup;
  colors: any;
  isDark?: boolean;
  language: string;
  ui: (key: string) => string;
  getName: (item: any, field?: string) => string;
  router: any;
  favoriteProducts: Set<string>;
  togglingFavorite: Set<string>;
  addedProducts: Set<string>;
  addingProductId: string | null;
  setCartButtonRef: (productId: string, ref: AnimatedCartButtonRef | null) => void;
  handleToggleFavorite: (productId: string) => void;
  handleAddToCart: (product: any) => void;
};

const SignatureDishCard: React.FC<DishCardProps> = ({
  group,
  colors,
  isDark,
  language,
  ui,
  getName,
  router,
  favoriteProducts,
  togglingFavorite,
  addedProducts,
  addingProductId,
  setCartButtonRef,
  handleToggleFavorite,
  handleAddToCart,
}) => {
  const initial =
    group.variants.find((v) => v.indicator === 'STD')?.indicator ??
    group.variants[0]?.indicator ??
    'STD';
  const variant =
    group.variants.find((v) => v.indicator === initial) ?? group.variants[0];
  const productId = variant?.id ?? group.primary.id;
  const product = {
    ...group.primary,
    id: productId,
    fitment_indicator: variant?.indicator ?? 'STD',
    price: variant?.price ?? group.primary.price,
  };
  const price = variant?.price ?? (Number(group.primary.price) || 0);

  return (
    <TouchableOpacity
      style={[
        signatureStyles.card,
        {
          backgroundColor: colors.card,
          borderColor: isDark ? colors.border : 'rgba(200,162,74,0.18)',
        },
        ELEVATION.card,
      ]}
      onPress={() => router.push(`/product/${productId}`)}
      activeOpacity={0.9}
    >
      <View style={signatureStyles.imageWrap}>
        {group.primary.image_url ? (
          <Image
            source={{ uri: group.primary.image_url }}
            style={signatureStyles.image}
            contentFit="cover"
            cachePolicy="memory-disk"
            transition={150}
          />
        ) : (
          <LinearGradient
            colors={GRADIENTS.champagneRise}
            style={signatureStyles.image}
          >
            <Ionicons name="restaurant" size={36} color={colors.primary} />
          </LinearGradient>
        )}
        <LinearGradient
          colors={['transparent', 'rgba(11,11,14,0.65)']}
          style={signatureStyles.imageVeil}
          pointerEvents="none"
        />
        <View style={signatureStyles.badge}>
          <Ionicons name="star" size={10} color="#1B1B1F" />
          <Text style={signatureStyles.badgeText}>
            {ui('chefPickBadge')}
          </Text>
        </View>
        <View style={signatureStyles.favoriteFloat}>
          <AnimatedFavoriteButton
            isFavorite={favoriteProducts.has(productId)}
            isLoading={togglingFavorite.has(productId)}
            onPress={() => handleToggleFavorite(productId)}
            size={16}
            style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: 'rgba(247,242,233,0.92)' }}
          />
        </View>
      </View>

      <View style={signatureStyles.body}>
        <Text style={[signatureStyles.name, { color: colors.text }]} numberOfLines={2} ellipsizeMode="tail">
          {getName(group.primary)}
        </Text>
        {group.primary.category ? (
          <Text style={[signatureStyles.cuisine, { color: colors.textSecondary }]} numberOfLines={1} ellipsizeMode="tail">
            {getName(group.primary.category)}
          </Text>
        ) : null}

        <View style={signatureStyles.priceRow}>
          <Text style={[signatureStyles.price, { color: colors.primary }]}>
            {price.toFixed(2)} {language === 'ar' ? 'ج.م' : 'EGP'}
          </Text>
          <AnimatedCartButton
            ref={(ref) => setCartButtonRef(productId, ref)}
            isInCart={addedProducts.has(productId)}
            isLoading={addingProductId === productId}
            onPress={() => handleAddToCart(product)}
            size={16}
            primaryColor={colors.primary}
            style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: colors.primary + '18' }}
          />
        </View>
      </View>
    </TouchableOpacity>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// MenuDishRow — horizontal row inside the menu accordion
// ─────────────────────────────────────────────────────────────────────────────
type MenuRowProps = DishCardProps & { isLast: boolean };

const MenuDishRow: React.FC<MenuRowProps> = ({
  group,
  colors,
  language,
  ui,
  getName,
  router,
  favoriteProducts,
  togglingFavorite,
  addedProducts,
  addingProductId,
  setCartButtonRef,
  handleToggleFavorite,
  handleAddToCart,
  isLast,
}) => {
  const initial =
    group.variants.find((v) => v.indicator === 'STD')?.indicator ??
    group.variants[0]?.indicator ??
    'STD';
  const variant =
    group.variants.find((v) => v.indicator === initial) ?? group.variants[0];
  const productId = variant?.id ?? group.primary.id;
  const product = {
    ...group.primary,
    id: productId,
    fitment_indicator: variant?.indicator ?? 'STD',
    price: variant?.price ?? group.primary.price,
  };
  const price = variant?.price ?? (Number(group.primary.price) || 0);
  const description = getName(group.primary, 'description');

  return (
    <TouchableOpacity
      style={[
        menuRowStyles.row,
        !isLast && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
      ]}
      onPress={() => router.push(`/product/${productId}`)}
      activeOpacity={0.85}
    >
      <View style={menuRowStyles.imageWrap}>
        {group.primary.image_url ? (
          <Image
            source={{ uri: group.primary.image_url }}
            style={menuRowStyles.image}
            contentFit="cover"
            cachePolicy="memory-disk"
          />
        ) : (
          <LinearGradient
            colors={GRADIENTS.champagneRise}
            style={menuRowStyles.image}
          >
            <Ionicons name="restaurant" size={20} color={colors.primary} />
          </LinearGradient>
        )}
      </View>

      <View style={menuRowStyles.body}>
        <Text style={[menuRowStyles.name, { color: colors.text }]} numberOfLines={1} ellipsizeMode="tail">
          {getName(group.primary)}
        </Text>
        {description ? (
          <Text
            style={[menuRowStyles.desc, { color: colors.textSecondary }]}
            numberOfLines={2}
            ellipsizeMode="tail"
          >
            {description}
          </Text>
        ) : null}
        <View style={menuRowStyles.footer}>
          <Text style={[menuRowStyles.price, { color: colors.primary }]}>
            {price.toFixed(2)} {language === 'ar' ? 'ج.م' : 'EGP'}
          </Text>
          {variant?.stock === 0 ? (
            <Text style={[menuRowStyles.outOfStock, { color: colors.error }]}>
              {ui('soldOutLabel')}
            </Text>
          ) : null}
        </View>
      </View>

      <View style={menuRowStyles.actions}>
        <AnimatedFavoriteButton
          isFavorite={favoriteProducts.has(productId)}
          isLoading={togglingFavorite.has(productId)}
          onPress={() => handleToggleFavorite(productId)}
          size={16}
        />
        <AnimatedCartButton
          ref={(ref) => setCartButtonRef(productId, ref)}
          isInCart={addedProducts.has(productId)}
          isLoading={addingProductId === productId}
          onPress={() => handleAddToCart(product)}
          size={16}
          primaryColor={colors.primary}
        />
      </View>
    </TouchableOpacity>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// RestaurantVideoPlayer — muted autoplay loop with tap-to-pause + fullscreen
// ─────────────────────────────────────────────────────────────────────────────
const RestaurantVideoPlayer = React.memo(({ url }: { url: string }) => {
  const videoRef = useRef<VideoView>(null);
  const { language } = useTranslation();

  const player = useVideoPlayer({ uri: url }, (p) => {
    p.loop = true;
    p.muted = true;
    p.play();
  });

  const { isPlaying } = useEvent(player, 'playingChange', { isPlaying: player.playing });
  const { status } = useEvent(player, 'statusChange', { status: player.status });

  const isReady = status === 'readyToPlay';
  const isBuffering = status === 'loading' || status === 'idle';

  // Animated shimmer for loading state using Reanimated shared values
  const shimmerOpacityVal = useSharedValue(0.3);
  useEffect(() => {
    shimmerOpacityVal.value = withRepeat(
      withSequence(
        withTiming(0.7, { duration: 900, easing: Easing.inOut(Easing.ease) }),
        withTiming(0.3, { duration: 900, easing: Easing.inOut(Easing.ease) }),
      ),
      -1,
      false,
    );
  }, [shimmerOpacityVal]);
  const shimmerAnimStyle = useAnimatedStyle(() => ({ opacity: shimmerOpacityVal.value }));

  const togglePlay = useCallback(() => {
    if (isPlaying) player.pause();
    else player.play();
  }, [isPlaying, player]);

  const openFullscreen = useCallback(() => {
    videoRef.current?.enterFullscreen();
  }, []);

  return (
    <View style={videoStyles.section}>
      {/* Section label */}
      <View style={videoStyles.labelRow}>
        <View style={videoStyles.rule} />
        <Text style={videoStyles.label}>
          {language === 'ar' ? 'فيديو المطعم' : 'RESTAURANT VIDEO'}
        </Text>
        <View style={videoStyles.rule} />
      </View>

      {/* Gold-accent cinematic frame */}
      <View style={videoStyles.frame}>
        <View style={videoStyles.container}>
          <VideoView
            ref={videoRef}
            player={player}
            style={videoStyles.video}
            contentFit="cover"
            nativeControls={false}
          />

          {/* Animated loading shimmer — shown until video is loaded */}
          {(!isReady || isBuffering) && (
            <Animated.View
              style={[videoStyles.loadingOverlay, shimmerAnimStyle]}
              pointerEvents="none"
            >
              <LinearGradient
                colors={['#1A1A1E', '#2A2416', '#1A1A1E']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={StyleSheet.absoluteFill}
              />
              <View style={videoStyles.loadingIcon}>
                <Ionicons name="film-outline" size={32} color={GOLD_COLOR} />
              </View>
            </Animated.View>
          )}

          {/* Tap overlay for play/pause */}
          <TouchableOpacity
            style={videoStyles.overlay}
            onPress={togglePlay}
            activeOpacity={1}
          >
            {isReady && !isPlaying && (
              <View style={videoStyles.playBtn}>
                <Ionicons name="play" size={28} color="#FFF" />
              </View>
            )}
          </TouchableOpacity>

          {/* Bottom vignette */}
          <LinearGradient
            colors={['transparent', 'rgba(0,0,0,0.45)']}
            style={videoStyles.vignette}
            pointerEvents="none"
          />

          {/* Fullscreen button */}
          <TouchableOpacity style={videoStyles.fullscreenBtn} onPress={openFullscreen}>
            <View style={videoStyles.fullscreenBtnInner}>
              <Ionicons name="expand-outline" size={15} color="#FFF" />
            </View>
          </TouchableOpacity>
        </View>

        {/* Gold corner accents */}
        <View style={[videoStyles.cornerAccent, videoStyles.cornerTL]} />
        <View style={[videoStyles.cornerAccent, videoStyles.cornerTR]} />
        <View style={[videoStyles.cornerAccent, videoStyles.cornerBL]} />
        <View style={[videoStyles.cornerAccent, videoStyles.cornerBR]} />
      </View>
    </View>
  );
});

const videoStyles = StyleSheet.create({
  section: {
    marginTop: SPACING.xxl,
    marginBottom: SPACING.sm,
  },
  labelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.md,
    marginBottom: SPACING.lg,
  },
  rule: { flex: 1, height: 1, backgroundColor: GOLD_COLOR, opacity: 0.3 },
  label: {
    ...TYPE.sectionLabel,
    color: GOLD_COLOR,
    letterSpacing: 2,
  },
  frame: {
    position: 'relative',
    borderRadius: RADII.lg + 2,
    borderWidth: 1,
    borderColor: `${GOLD_COLOR}50`,
    padding: 3,
    ...ELEVATION.goldGlow,
  },
  container: {
    width: '100%',
    height: 220,
    borderRadius: RADII.lg,
    overflow: 'hidden',
    backgroundColor: '#0B0B0E',
  },
  video: { width: '100%', height: '100%' },
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingIcon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: 'rgba(200,162,74,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: `${GOLD_COLOR}40`,
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  playBtn: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: `${GOLD_COLOR}70`,
  },
  vignette: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 60,
  },
  fullscreenBtn: {
    position: 'absolute',
    bottom: SPACING.sm,
    right: SPACING.sm,
  },
  fullscreenBtnInner: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: `${GOLD_COLOR}50`,
  },
  cornerAccent: {
    position: 'absolute',
    width: 14,
    height: 14,
    borderColor: GOLD_COLOR,
  },
  cornerTL: { top: -1, left: -1, borderTopWidth: 2, borderLeftWidth: 2, borderTopLeftRadius: RADII.lg + 2 },
  cornerTR: { top: -1, right: -1, borderTopWidth: 2, borderRightWidth: 2, borderTopRightRadius: RADII.lg + 2 },
  cornerBL: { bottom: -1, left: -1, borderBottomWidth: 2, borderLeftWidth: 2, borderBottomLeftRadius: RADII.lg + 2 },
  cornerBR: { bottom: -1, right: -1, borderBottomWidth: 2, borderRightWidth: 2, borderBottomRightRadius: RADII.lg + 2 },
});

// ─────────────────────────────────────────────────────────────────────────────
// Styles
// ─────────────────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  container: { flex: 1 },
  scrollView: { flex: 1 },
  scrollContent: { paddingBottom: 0 },
  errorContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  errorText: { ...TYPE.body },

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
    left: SPACING.xl,
    right: SPACING.xl,
    bottom: SPACING.xl,
  },
  heroEyebrow: {
    ...TYPE.sectionLabel,
    color: '#E8D29A',
    marginBottom: SPACING.sm,
  },
  heroTitle: {
    ...TYPE.hero,
    color: '#F7F2E9',
    marginBottom: SPACING.md,
  },
  heroMetaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: SPACING.sm,
  },
  heroMetaPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: SPACING.md,
    paddingVertical: 6,
    borderRadius: RADII.pill,
    backgroundColor: 'rgba(247,242,233,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(232,210,154,0.32)',
  },
  heroMetaText: {
    ...TYPE.caption,
    color: '#E8D29A',
    fontWeight: '600',
  },

  // Body sheet
  bodySheet: {
    marginTop: -SPACING.xxl,
    borderTopLeftRadius: RADII.xxl,
    borderTopRightRadius: RADII.xxl,
    paddingTop: SPACING.xxl,
    paddingHorizontal: SPACING.xl,
  },

  // Manager card
  managerCard: {
    borderRadius: RADII.lg,
    borderWidth: 1,
    overflow: 'hidden',
    marginBottom: SPACING.lg,
  },
  managerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: SPACING.md,
    paddingHorizontal: SPACING.lg,
    gap: SPACING.md,
  },
  managerAvatar: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    borderWidth: 1,
  },
  managerAvatarImg: { width: 52, height: 52, borderRadius: 26 },
  managerText: { flex: 1 },
  managerLabel: {
    ...TYPE.caption,
    fontWeight: '700',
    letterSpacing: 1,
    textTransform: 'uppercase',
    marginBottom: 2,
  },
  managerName: { ...TYPE.title, fontSize: 17 },
  managerArrow: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  subscribeBannerWrap: {
    overflow: 'hidden',
  },
  subscribeBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: SPACING.md,
    paddingHorizontal: SPACING.xl,
    gap: SPACING.sm,
    position: 'relative',
  },
  subscribeBannerEdge: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: 3,
    backgroundColor: GOLD_COLOR,
  },
  subscribeBannerEdgeRight: {
    position: 'absolute',
    right: 0,
    top: 0,
    bottom: 0,
    width: 3,
    backgroundColor: GOLD_COLOR,
  },
  subscribeBannerText: {
    flex: 1,
    ...TYPE.caption,
    color: '#FFFFFF',
    fontWeight: '700',
    letterSpacing: 0.4,
    textAlign: 'center',
  },

  // Reserve / subscribe CTA
  reserveBtn: {
    borderRadius: RADII.lg,
    overflow: 'hidden',
    marginBottom: SPACING.lg,
    ...ELEVATION.goldGlow,
  },
  reserveBtnGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: SPACING.lg,
    paddingHorizontal: SPACING.lg,
    gap: SPACING.md,
  },
  reserveBtnIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(27,27,31,0.18)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  reserveBtnTitle: {
    ...TYPE.title,
    fontSize: 17,
    color: '#1B1B1F',
  },
  reserveBtnSub: {
    ...TYPE.caption,
    color: 'rgba(27,27,31,0.7)',
    fontWeight: '500',
  },

  // Story
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
    marginBottom: SPACING.lg,
  },
  menuPdfChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.sm,
    borderRadius: RADII.pill,
    borderWidth: 1,
  },
  menuPdfText: { ...TYPE.button, letterSpacing: 0.4 },

  // Generic section
  section: { marginBottom: SPACING.xxl },
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    marginBottom: SPACING.lg,
  },
  sectionTitle: { ...TYPE.title },
  sectionCount: { ...TYPE.caption, fontWeight: '600' },

  // Signature carousel
  signatureScroll: {
    paddingRight: SPACING.xl,
    gap: SPACING.md,
  },

  // Course accordion
  courseCard: {
    borderRadius: RADII.lg,
    borderWidth: 1,
    marginBottom: SPACING.md,
    overflow: 'hidden',
  },
  courseHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: SPACING.lg,
    paddingHorizontal: SPACING.lg,
  },
  courseHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.md,
    flex: 1,
  },
  courseIndex: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  courseIndexText: { ...TYPE.caption, fontWeight: '800' },
  courseLabel: {
    ...TYPE.caption,
    fontWeight: '700',
    letterSpacing: 1,
    textTransform: 'uppercase',
    marginBottom: 2,
  },
  courseTitle: { ...TYPE.title, fontSize: 18 },
  courseHeaderRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
  },
  courseCount: { ...TYPE.body, fontWeight: '600' },
  courseBody: { paddingHorizontal: SPACING.lg, paddingBottom: SPACING.md },

  // Empty
  emptyState: {
    alignItems: 'center',
    paddingVertical: SPACING.xxxl,
    gap: SPACING.md,
  },
  emptyTitle: { ...TYPE.title },
  emptyBody: { ...TYPE.body, textAlign: 'center' },
});

const signatureStyles = StyleSheet.create({
  card: {
    width: 220,
    borderRadius: RADII.lg,
    borderWidth: 1,
    overflow: 'hidden',
  },
  imageWrap: {
    width: '100%',
    height: 160,
    position: 'relative',
    alignItems: 'center',
    justifyContent: 'center',
  },
  image: { width: '100%', height: '100%', alignItems: 'center', justifyContent: 'center' },
  imageVeil: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: '60%',
  },
  badge: {
    position: 'absolute',
    top: SPACING.sm,
    left: SPACING.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: SPACING.sm,
    paddingVertical: 3,
    borderRadius: RADII.pill,
    backgroundColor: '#E8D29A',
  },
  badgeText: {
    ...TYPE.caption,
    color: '#1B1B1F',
    fontWeight: '700',
    letterSpacing: 0.6,
    fontSize: 10,
  },
  favoriteFloat: {
    position: 'absolute',
    top: SPACING.sm,
    right: SPACING.sm,
  },
  body: { padding: SPACING.md },
  name: { ...TYPE.title, fontSize: 16, lineHeight: 20, marginBottom: 2 },
  cuisine: {
    ...TYPE.caption,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    marginBottom: SPACING.sm,
  },
  priceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  price: { ...TYPE.price },
});

const menuRowStyles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: SPACING.md,
    gap: SPACING.md,
  },
  imageWrap: {
    width: 64,
    height: 64,
    borderRadius: RADII.md,
    overflow: 'hidden',
  },
  image: { width: '100%', height: '100%', alignItems: 'center', justifyContent: 'center' },
  body: { flex: 1 },
  name: { ...TYPE.bodyLarge, fontWeight: '700', marginBottom: 2 },
  desc: { ...TYPE.caption, lineHeight: 16, marginBottom: SPACING.xs },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: SPACING.sm,
  },
  price: { ...TYPE.price, fontSize: 16 },
  outOfStock: {
    ...TYPE.caption,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  actions: {
    alignItems: 'center',
    gap: SPACING.sm,
  },
});
