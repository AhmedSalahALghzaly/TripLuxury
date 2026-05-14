/**
 * ChefsSpecialSpotlight — 2026 Cinematic Bundle Carousel
 *
 * Full-bleed parallax slides showcasing active bundle deals fetched from
 * bundleOfferApi. Features mirror OfferSliderCarousel: parallax image, gold
 * shimmer border, breathing-glow pill dots, advancing shimmer sweep,
 * auto-advance progress bar (30 s), swipe-up dismiss, and drag hint (replays
 * every 30 s until the user swipes). Adds a small pause/play icon button so
 * the user can freeze auto-advance for 35 s.
 */
import React, {
  useRef,
  useCallback,
  useEffect,
  useState,
  memo,
  useMemo,
} from 'react';
import {
  View,
  Text,
  StyleSheet,
  Platform,
  useWindowDimensions,
  useColorScheme,
  ViewToken,
  Image as RNImage,
} from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { CarouselControlsTooltip, TOOLTIP_STORAGE_KEY } from './CarouselControlsTooltip';
import { Ionicons } from '@expo/vector-icons';
import {
  Gesture,
  GestureDetector,
  TouchableOpacity,
} from 'react-native-gesture-handler';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  useAnimatedRef,
  useAnimatedScrollHandler,
  withSpring,
  withTiming,
  withRepeat,
  withSequence,
  interpolate,
  Extrapolation,
  runOnJS,
  cancelAnimation,
  Easing,
  type SharedValue,
} from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useRouter } from 'expo-router';
import { useTranslation } from '../../hooks/useTranslation';
import { useWebSocketEvent } from '../../services/websocketService';
import {
  COLORS,
  OVERLAYS,
  GRADIENTS,
  RADII,
  SPACING,
  TYPE,
  ELEVATION,
  INDICATORS,
} from '../../constants/luxuryTokens';
import { bundleOfferApi, promotionApi } from '../../services/api';
import { Skeleton } from '../ui/Skeleton';

// ─── Constants ─────────────────────────────────────────────────────────────────
const SLIDE_HEIGHT = 400;
const SLIDE_MARGIN = 16;
const WIDE_BREAKPOINT = 480;
const WIDE_RATIO = 0.88;
const PARALLAX_STRENGTH = 24;
const AUTO_ADVANCE_MS = 30_000; // 30 s — different from OfferSliderCarousel
const PAUSE_RESUME_MS = 35_000;  // 35 s pause when button is tapped
const HINT_INTERVAL_MS = 30_000; // replay drag hint every 30 s

const HINT_DISMISSED_KEY = 'chef_spotlight_drag_hint_dismissed';

/**
 * Module-level locale tracker — same pattern as OfferSliderCarousel so a locale
 * switch mid-session replays the hint, and once the user drags it's set to
 * 'dismissed' to suppress further plays for the JS session.
 */
let hintShownForLocale: 'ltr' | 'rtl' | 'dismissed' | null = null;

const FALLBACK_IMAGES = [
  'https://images.unsplash.com/photo-1414235077428-338989a2e8c0?auto=format&fit=crop&w=1400&q=80',
  'https://images.unsplash.com/photo-1467003909585-2f8a72700288?auto=format&fit=crop&w=1400&q=80',
  'https://images.unsplash.com/photo-1559339352-11d035aa65de?auto=format&fit=crop&w=1400&q=80',
];

// ─── Types ──────────────────────────────────────────────────────────────────────

/** Raw shape returned by GET /bundle-offers. Fields typed loosely to match server
 *  output which can be string or number for numeric columns. */
interface BundleOfferApiResponse {
  id: string;
  name?: string;
  name_ar?: string;
  title?: string;
  title_ar?: string;
  image_url?: string;
  image?: string;
  discount_percentage?: number | string | null;
  original_total?: number | string | null;
  discounted_total?: number | string | null;
  product_count?: number | null;
  products?: { id: string }[];
  product_ids?: string[];
  is_active?: boolean;
  rating_average?: number | null;
  rating_count?: number;
}

/** Normalised in-component shape — all numeric fields are proper numbers. */
interface BundleItem {
  id: string;
  title: string;
  title_ar?: string;
  image?: string;
  discount_percentage?: number;
  original_total?: number;
  discounted_total?: number;
  product_count?: number;
  is_active?: boolean;
  rating_average?: number | null;
  rating_count?: number;
  /** 'promotion' for slider-type promos, 'bundle' for bundle offers (default) */
  itemType?: 'bundle' | 'promotion';
  target_restaurant_id?: string | null;
  target_product_id?: string | null;
}

function parseNum(v: number | string | null | undefined): number | undefined {
  if (v == null) return undefined;
  const n = parseFloat(String(v));
  return Number.isFinite(n) ? n : undefined;
}

function mapBundle(b: BundleOfferApiResponse, index: number): BundleItem {
  const rawDiscount = parseNum(b.discount_percentage);
  return {
    id: b.id,
    title: b.name || b.title || `Bundle ${index + 1}`,
    title_ar: b.name_ar || b.title_ar,
    image: b.image_url || b.image || FALLBACK_IMAGES[index % FALLBACK_IMAGES.length],
    discount_percentage: rawDiscount != null ? Math.round(rawDiscount) : undefined,
    original_total: parseNum(b.original_total),
    discounted_total: parseNum(b.discounted_total),
    product_count:
      b.product_count ??
      (Array.isArray(b.products) ? b.products.length : undefined) ??
      (Array.isArray(b.product_ids) ? b.product_ids.length : undefined),
    is_active: b.is_active,
    rating_average: b.rating_average ?? null,
    rating_count: b.rating_count ?? 0,
  };
}

function mapPromotion(p: any, index: number): BundleItem {
  const rawDiscount = p.discount_percentage != null ? parseNum(p.discount_percentage) : undefined;
  return {
    id: p.id,
    title: p.title || p.name || `Special ${index + 1}`,
    title_ar: p.title_ar || p.name_ar,
    image: p.image_url || p.image || FALLBACK_IMAGES[index % FALLBACK_IMAGES.length],
    discount_percentage: rawDiscount != null ? Math.round(rawDiscount) : undefined,
    is_active: p.is_active,
    itemType: 'promotion',
    target_restaurant_id: p.target_car_model_id || p.target_restaurant_id || null,
    target_product_id: p.target_product_id || null,
  };
}

const STATIC_FALLBACK: BundleItem[] = [
  {
    id: 'static-bundle-1',
    title: "Chef's Tasting Bundle",
    title_ar: 'حزمة تذوق الشيف',
    image: FALLBACK_IMAGES[0],
    discount_percentage: 15,
    original_total: 250,
    discounted_total: 212.5,
    product_count: 5,
    is_active: true,
  },
  {
    id: 'static-bundle-2',
    title: 'Garden Pavilion Set',
    title_ar: 'مجموعة جناح الحديقة',
    image: FALLBACK_IMAGES[1],
    discount_percentage: 20,
    original_total: 180,
    discounted_total: 144,
    product_count: 4,
    is_active: true,
  },
  {
    id: 'static-bundle-3',
    title: 'Sunset Mezza Bundle',
    title_ar: 'حزمة ميزة الغروب',
    image: FALLBACK_IMAGES[2],
    discount_percentage: 18,
    original_total: 320,
    discounted_total: 262.4,
    product_count: 12,
    is_active: true,
  },
];

// ─── Layout helper ──────────────────────────────────────────────────────────────
interface Layout {
  isWide: boolean;
  slideWidth: number;
  itemWidth: number;
  sideInset: number;
}

function computeLayout(screenWidth: number): Layout {
  const isWide = screenWidth > WIDE_BREAKPOINT;
  const slideWidth = isWide
    ? Math.round(screenWidth * WIDE_RATIO)
    : screenWidth - SLIDE_MARGIN * 2;
  const itemWidth = isWide ? slideWidth : screenWidth;
  const sideInset = isWide ? Math.round((screenWidth - slideWidth) / 2) : 0;
  return { isWide, slideWidth, itemWidth, sideInset };
}

// ─── BundleSlide ────────────────────────────────────────────────────────────────
interface BundleSlideProps {
  bundle: BundleItem;
  index: number;
  scrollX: SharedValue<number>;
  onPress: (bundle: BundleItem) => void;
  onPauseToggle: () => void;
  language: string;
  isRTL: boolean;
  scrollStep: number;
  slideWidth: number;
  isActive: boolean;
  isPaused: boolean;
  progressKey: number;
  isAutoAdvanceRunning: boolean;
  isNextSlide: boolean;
  isAdvancing: boolean;
}

const BundleSlide = memo(({
  bundle,
  index,
  scrollX,
  onPress,
  onPauseToggle,
  language,
  isRTL,
  scrollStep,
  slideWidth,
  isActive,
  isPaused,
  progressKey,
  isAutoAdvanceRunning,
  isNextSlide,
  isAdvancing,
}: BundleSlideProps) => {
  const inputPosition = index * scrollStep;

  // ─── Parallax image ────────────────────────────────────────────────────────────
  const imageStyle = useAnimatedStyle(() => {
    const translateX = interpolate(
      scrollX.value,
      [inputPosition - scrollStep, inputPosition, inputPosition + scrollStep],
      [PARALLAX_STRENGTH, 0, -PARALLAX_STRENGTH],
      Extrapolation.CLAMP,
    );
    return { transform: [{ translateX }] };
  });

  // ─── Slide opacity + scale (inactive dimming) ──────────────────────────────────
  const slideStyle = useAnimatedStyle(() => {
    const opacity = interpolate(
      scrollX.value,
      [inputPosition - scrollStep * 0.6, inputPosition, inputPosition + scrollStep * 0.6],
      [0.70, 1, 0.70],
      Extrapolation.CLAMP,
    );
    const scale = interpolate(
      scrollX.value,
      [inputPosition - scrollStep * 0.6, inputPosition, inputPosition + scrollStep * 0.6],
      [0.93, 1, 0.93],
      Extrapolation.CLAMP,
    );
    return { opacity, transform: [{ scale }] };
  });

  // ─── Gold shimmer border (active slide) ────────────────────────────────────────
  const shimmerOpacity = useSharedValue(0);
  useEffect(() => {
    if (isActive) {
      shimmerOpacity.value = withRepeat(
        withSequence(
          withTiming(0.9, { duration: 1100 }),
          withTiming(0.35, { duration: 1100 }),
        ),
        -1,
        false,
      );
    } else {
      shimmerOpacity.value = withTiming(0, { duration: 260 });
    }
  }, [isActive, shimmerOpacity]);

  const shimmerBorderStyle = useAnimatedStyle(() => ({
    opacity: shimmerOpacity.value,
  }));

  // ─── Paused pill ───────────────────────────────────────────────────────────────
  const pausedPillOpacity = useSharedValue(0);
  useEffect(() => {
    pausedPillOpacity.value = withTiming(
      isActive && isPaused ? 1 : 0,
      { duration: 280 },
    );
  }, [isActive, isPaused, pausedPillOpacity]);

  const pausedPillStyle = useAnimatedStyle(() => ({
    opacity: pausedPillOpacity.value,
  }));

  // ─── Auto-advance progress bar (30 s) ──────────────────────────────────────────
  const progressAnim = useSharedValue(0);

  useEffect(() => {
    if (isActive && isAutoAdvanceRunning) {
      cancelAnimation(progressAnim);
      progressAnim.value = 0;
      progressAnim.value = withTiming(1, {
        duration: AUTO_ADVANCE_MS,
        easing: Easing.linear,
      });
    } else {
      cancelAnimation(progressAnim);
      progressAnim.value = 0;
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isActive, isAutoAdvanceRunning, progressKey]);

  const progressFillStyle = useAnimatedStyle(() => {
    const scale = progressAnim.value;
    const tx = -(1 - scale) * slideWidth / 2;
    return {
      transform: [{ translateX: isRTL ? -tx : tx }, { scaleX: scale }],
    };
  });

  // ─── Advancing shimmer sweep ────────────────────────────────────────────────────
  const sweepX = useSharedValue(isRTL ? slideWidth : -slideWidth);
  const sweepOpacity = useSharedValue(0);

  useEffect(() => {
    if (isNextSlide && isAdvancing) {
      sweepOpacity.value = withTiming(1, { duration: 100 });
      sweepX.value = isRTL ? slideWidth : -slideWidth;
      sweepX.value = withTiming(isRTL ? -slideWidth * 1.5 : slideWidth * 1.5, {
        duration: 820,
        easing: Easing.out(Easing.quad),
      });
    } else {
      cancelAnimation(sweepX);
      sweepOpacity.value = withTiming(0, { duration: 260 });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isNextSlide, isAdvancing]);

  const advancingShimmerStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: sweepX.value }],
    opacity: sweepOpacity.value,
  }));

  // ─── Content derived from bundle ────────────────────────────────────────────────
  const title =
    language === 'ar'
      ? bundle.title_ar || bundle.title || ''
      : bundle.title || bundle.title_ar || '';

  const imageSource = bundle.image;
  const imageWrapperWidth = slideWidth + PARALLAX_STRENGTH * 2;
  const discountPct = bundle.discount_percentage ?? null;
  const productCount = bundle.product_count ?? null;
  const originalTotal = bundle.original_total ?? null;
  const discountedTotal = bundle.discounted_total ?? null;

  return (
    <View style={styles.slideOuter}>
      <Animated.View style={[{ width: slideWidth }, slideStyle]}>
        <Animated.View style={[styles.slideCard, { width: slideWidth }]}>
            {/* Gold shimmer border overlay */}
            <Animated.View
              style={[styles.shimmerBorder, shimmerBorderStyle]}
              pointerEvents="none"
            />

            {/* Advancing shimmer sweep */}
            <Animated.View
              style={[styles.advancingShimmerOuter, advancingShimmerStyle]}
              pointerEvents="none"
            >
              <LinearGradient
                colors={['transparent', 'rgba(200,162,74,0.28)', 'rgba(255,220,80,0.18)', 'transparent']}
                start={isRTL ? { x: 1, y: 0 } : { x: 0, y: 0 }}
                end={isRTL ? { x: 0, y: 0 } : { x: 1, y: 0 }}
                style={styles.advancingShimmerGradient}
              />
            </Animated.View>

            {/* Auto-advance progress bar */}
            {isActive && isAutoAdvanceRunning && (
              <View style={styles.progressTrack} pointerEvents="none">
                <Animated.View style={[styles.progressFill, progressFillStyle]} />
              </View>
            )}

            <TouchableOpacity
              activeOpacity={0.90}
              onPress={() => onPress(bundle)}
              style={styles.slideTouchable}
            >
              {/* Background image with parallax */}
              <View style={styles.imageClip}>
                <Animated.View
                  style={[
                    styles.imageWrapper,
                    { width: imageWrapperWidth, marginLeft: -PARALLAX_STRENGTH },
                    imageStyle,
                  ]}
                >
                  {imageSource ? (
                    imageSource.startsWith('data:') ? (
                      <RNImage
                        source={{ uri: imageSource }}
                        style={styles.slideImage}
                        resizeMode="cover"
                      />
                    ) : (
                      <ExpoImage
                        source={{ uri: imageSource }}
                        style={styles.slideImage}
                        contentFit="cover"
                        cachePolicy="memory-disk"
                        transition={350}
                      />
                    )
                  ) : (
                    <LinearGradient
                      colors={GRADIENTS.bundleCardBurgundy}
                      start={{ x: 0, y: 0 }}
                      end={{ x: 1, y: 1 }}
                      style={styles.slidePlaceholder}
                    >
                      <Ionicons name="gift" size={56} color={OVERLAYS.goldGlowSoft} />
                    </LinearGradient>
                  )}
                </Animated.View>
              </View>

              {/* Dark cinematic scrim */}
              <LinearGradient
                colors={['transparent', 'rgba(4,4,12,0.40)', 'rgba(4,4,12,0.92)']}
                start={{ x: 0, y: 0.25 }}
                end={{ x: 0, y: 1 }}
                style={styles.scrim}
              />

              {/* Leading corner gold accent (top-left LTR, top-right RTL) */}
              <View style={[styles.cornerAccent, isRTL ? styles.cornerAccentRTL : styles.cornerAccentLTR]}>
                <LinearGradient
                  colors={['rgba(200,162,74,0.55)', 'transparent']}
                  start={isRTL ? { x: 1, y: 0 } : { x: 0, y: 0 }}
                  end={isRTL ? { x: 0, y: 1 } : { x: 1, y: 1 }}
                  style={styles.cornerGradient}
                />
              </View>

              {/* Paused pill — top-center */}
              <Animated.View
                style={[styles.pausedPillWrapper, pausedPillStyle]}
                pointerEvents="none"
              >
                <View style={styles.pausedPill}>
                  <Ionicons name="pause-circle" size={13} color={COLORS.ivory} />
                  <Text style={styles.pausedPillText}>
                    {language === 'ar' ? 'متوقف مؤقتاً' : 'Paused'}
                  </Text>
                </View>
              </Animated.View>

              {/* Pause/Play button — trailing top corner, active slide only */}
              {isActive && (
                <TouchableOpacity
                  style={[
                    styles.pauseButton,
                    isRTL ? styles.pauseButtonLeadingRTL : styles.pauseButtonLeadingLTR,
                  ]}
                  onPress={onPauseToggle}
                  hitSlop={10}
                  activeOpacity={0.7}
                >
                  <Ionicons
                    name={isPaused ? 'play-circle' : 'pause-circle'}
                    size={26}
                    color="rgba(255,255,255,0.72)"
                  />
                </TouchableOpacity>
              )}

              {/* Bundle content card */}
              <View style={[styles.contentCard, isRTL && styles.contentCardRTL]}>
                {/* Top badge row: BUNDLE chip + discount + rating */}
                <View style={[styles.topBadgeRow, isRTL && styles.topBadgeRowRTL]}>
                  <View style={styles.bundleTypeChip}>
                    <Ionicons name="gift" size={11} color={COLORS.charcoalDeep} />
                    <Text style={styles.bundleTypeChipText}>
                      {language === 'ar' ? 'عرض مجمع' : 'BUNDLE DEAL'}
                    </Text>
                  </View>
                  <View style={styles.badgeTrailingRow}>
                    {bundle.rating_average != null && bundle.rating_average > 0 && (
                      <View style={styles.ratingChip}>
                        <Ionicons name="star" size={10} color={COLORS.gold} />
                        <Text style={styles.ratingChipText}>
                          {bundle.rating_average.toFixed(1)}
                          {(bundle.rating_count ?? 0) > 0
                            ? ` (${bundle.rating_count})`
                            : ''}
                        </Text>
                      </View>
                    )}
                    {discountPct != null && discountPct > 0 && (
                      <LinearGradient
                        colors={[COLORS.gold, COLORS.goldBright]}
                        start={{ x: 0, y: 0 }}
                        end={{ x: 1, y: 1 }}
                        style={styles.discountBadge}
                      >
                        <Text style={styles.discountNum}>{discountPct}%</Text>
                        <Text style={styles.discountLabel}>
                          {language === 'ar' ? 'خصم' : 'OFF'}
                        </Text>
                      </LinearGradient>
                    )}
                  </View>
                </View>

                {/* Title */}
                {title ? (
                  <Text
                    style={[styles.slideTitle, isRTL && styles.textRight]}
                    numberOfLines={2}
                  >
                    {title}
                  </Text>
                ) : null}

                {/* Product count chip */}
                {productCount != null && productCount > 0 && (
                  <View style={[styles.countChipRow, isRTL && styles.countChipRowRTL]}>
                    <View style={styles.countChip}>
                      <Ionicons name="fast-food-outline" size={11} color={COLORS.goldSoft} />
                      <Text style={styles.countChipText}>
                        {productCount} {language === 'ar' ? 'صنف' : 'items'}
                      </Text>
                    </View>
                  </View>
                )}

                {/* Price row: original → discounted */}
                {originalTotal != null && discountedTotal != null && (
                  <View style={[styles.priceRow, isRTL && styles.priceRowRTL]}>
                    <Text style={styles.oldPrice}>{originalTotal.toFixed(2)} ج.م</Text>
                    <Ionicons
                      name={isRTL ? 'arrow-back' : 'arrow-forward'}
                      size={14}
                      color="rgba(255,255,255,0.50)"
                    />
                    <Text style={styles.newPrice}>
                      {discountedTotal.toFixed(2)}{' '}
                      <Text style={styles.currency}>ج.م</Text>
                    </Text>
                  </View>
                )}

                {/* CTA pill */}
                <View style={[styles.ctaRow, isRTL && styles.ctaRowRTL]}>
                  <View style={styles.ctaPill}>
                    <Text style={styles.ctaPillText}>
                      {language === 'ar' ? 'اعرض التفاصيل' : 'View Bundle'}
                    </Text>
                    <Ionicons
                      name={isRTL ? 'arrow-back' : 'arrow-forward'}
                      size={11}
                      color={COLORS.charcoalDeep}
                    />
                  </View>
                </View>
              </View>
            </TouchableOpacity>
          </Animated.View>
        </Animated.View>
      </View>
  );
});

// ─── Dot indicator ──────────────────────────────────────────────────────────────
interface SpotlightDotProps {
  index: number;
  pillX: SharedValue<number>;
  onPress: () => void;
}

const DOT_ACTIVE_WIDTH = 14;
const DOT_STEP = INDICATORS.dot.width + SPACING.xs; // 6 + 4 = 10
const DOT_ACTIVE_SCALE_X = DOT_ACTIVE_WIDTH / INDICATORS.dot.width;

const SpotlightDot = memo(({ index, pillX, onPress }: SpotlightDotProps) => {
  const colorScheme = useColorScheme();
  const dotBg = colorScheme === 'dark' ? OVERLAYS.ivoryDot : 'rgba(0,0,0,0.22)';
  const animStyle = useAnimatedStyle(() => {
    const dist = Math.abs(pillX.value - index * DOT_STEP);
    const proximity = 1 - Math.min(dist / DOT_STEP, 1);
    const opacity = interpolate(proximity, [0, 1], [0.32, 1], Extrapolation.CLAMP);
    const scaleX = interpolate(proximity, [0, 1], [1, DOT_ACTIVE_SCALE_X], Extrapolation.CLAMP);
    return { opacity, transform: [{ scaleX }] };
  });

  return (
    <TouchableOpacity
      onPress={onPress}
      hitSlop={{ top: 10, bottom: 10, left: 6, right: 6 }}
      activeOpacity={0.7}
    >
      <Animated.View style={[styles.dot, { backgroundColor: dotBg }, animStyle]} />
    </TouchableOpacity>
  );
});

// ─── Sliding pill with breathing glow ──────────────────────────────────────────
interface SpotlightPillProps {
  pillX: SharedValue<number>;
  pillOpacity: SharedValue<number>;
  count: number;
  isPaused: boolean;
}

const SpotlightPill = memo(({ pillX, pillOpacity, count, isPaused }: SpotlightPillProps) => {
  const glowOpacity = useSharedValue(1);

  useEffect(() => {
    if (isPaused) {
      cancelAnimation(glowOpacity);
      glowOpacity.value = withTiming(0.55, {
        duration: 400,
        easing: Easing.inOut(Easing.sin),
      });
    } else {
      glowOpacity.value = withRepeat(
        withSequence(
          withTiming(0.38, { duration: 750, easing: Easing.inOut(Easing.sin) }),
          withTiming(1, { duration: 750, easing: Easing.inOut(Easing.sin) }),
        ),
        -1,
        false,
      );
    }
    return () => { cancelAnimation(glowOpacity); };
  }, [isPaused, glowOpacity]);

  const pillStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: count <= 1 ? 0 : pillX.value }],
    opacity: pillOpacity.value,
  }));

  const haloStyle = useAnimatedStyle(() => ({
    opacity: glowOpacity.value,
  }));

  return (
    <Animated.View style={[styles.slidingPillOuter, pillStyle]} pointerEvents="none">
      <Animated.View style={[styles.slidingPillGlowHalo, haloStyle]} />
      <View style={styles.slidingPillFill} />
    </Animated.View>
  );
});

// ─── Skeleton ───────────────────────────────────────────────────────────────────
export const ChefsSpotlightSkeleton: React.FC = () => {
  const { width: screenWidth } = useWindowDimensions();
  const { slideWidth } = useMemo(() => computeLayout(screenWidth), [screenWidth]);
  return (
    <View style={styles.skeletonWrapper}>
      <Skeleton width={slideWidth} height={SLIDE_HEIGHT} borderRadius={RADII.xl} animation="shimmer" />
      <View style={styles.skeletonDots}>
        {[0, 1, 2].map((i) => (
          <Skeleton
            key={i}
            width={6}
            height={6}
            borderRadius={3}
            style={{ marginHorizontal: 3 }}
            animation="pulse"
          />
        ))}
      </View>
    </View>
  );
};

// ─── Main component ─────────────────────────────────────────────────────────────
export const ChefsSpecialSpotlight: React.FC = () => {
  const router = useRouter();
  const { language } = useTranslation();
  const isRTL = language === 'ar';
  const { width: screenWidth } = useWindowDimensions();

  const layout = useMemo(() => computeLayout(screenWidth), [screenWidth]);
  const { isWide, slideWidth, itemWidth, sideInset } = layout;

  const layoutRef = useRef(layout);
  useEffect(() => { layoutRef.current = layout; }, [layout]);

  // ─── Data fetching ─────────────────────────────────────────────────────────────
  const [bundles, setBundles] = useState<BundleItem[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchBundles = useCallback(async () => {
    try {
      const [bundleRes, promoRes] = await Promise.all([
        bundleOfferApi.getAll(true),
        promotionApi.getAll('slider', true).catch(() => ({ data: [] })),
      ]);
      const rawBundles: BundleOfferApiResponse[] = Array.isArray(bundleRes.data) ? bundleRes.data : [];
      const rawPromos: any[] = Array.isArray(promoRes.data) ? promoRes.data : [];

      const activeBundles = rawBundles.filter((b) => b.is_active !== false);
      const mappedBundles = activeBundles.map((b, i) => mapBundle(b, i));
      const mappedPromos = rawPromos.filter((p) => p.is_active !== false).map((p, i) => mapPromotion(p, i));

      const combined = [...mappedPromos, ...mappedBundles];
      setBundles(combined.length > 0 ? combined : STATIC_FALLBACK);
    } catch {
      setBundles(STATIC_FALLBACK);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchBundles(); }, [fetchBundles]);

  useWebSocketEvent(
    [
      'bundle_created',
      'bundle_updated',
      'bundle_deleted',
      'promotion_created',
      'promotion_updated',
      'promotion_deleted',
      'reconnect_sweep',
    ],
    () => { fetchBundles(); },
  );

  // ─── Carousel controls tooltip (Task #95) ──────────────────────────────────────
  const [showTooltip, setShowTooltip] = useState(false);

  useEffect(() => {
    let cancelled = false;
    AsyncStorage.getItem(TOOLTIP_STORAGE_KEY).then((val) => {
      if (!val && !cancelled) {
        const t = setTimeout(() => {
          if (!cancelled) setShowTooltip(true);
        }, 1800);
        return () => clearTimeout(t);
      }
    }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const handleTooltipDismiss = useCallback(() => {
    setShowTooltip(false);
    AsyncStorage.setItem(TOOLTIP_STORAGE_KEY, '1').catch(() => {});
  }, []);

  // ─── Carousel state ────────────────────────────────────────────────────────────
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const [isAdvancing, setIsAdvancing] = useState(false);
  const [progressKey, setProgressKey] = useState(0);
  const [isAutoAdvanceRunning, setIsAutoAdvanceRunning] = useState(false);
  const [hintAllowed, setHintAllowed] = useState(
    () => hintShownForLocale !== null && hintShownForLocale !== 'dismissed',
  );

  useEffect(() => {
    AsyncStorage.getItem(HINT_DISMISSED_KEY).then((val) => {
      if (val === '1') {
        hintShownForLocale = 'dismissed';
      } else {
        setHintAllowed(true);
      }
    }).catch(() => { setHintAllowed(true); });
  }, []);

  const count = bundles.length;
  const isSingle = count === 1;

  const currentIndexSV = useSharedValue(0);
  const animatedListRef = useAnimatedRef<Animated.FlatList<BundleItem>>();
  const scrollX = useSharedValue(0);
  const pillX = useSharedValue(0);
  const pillOpacity = useSharedValue(1);
  const itemWidthSV = useSharedValue(itemWidth);
  const isUserScrolling = useRef(false);
  const autoAdvanceRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const currentIndexRef = useRef(0);
  const pauseResumeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const scrollToIndex = useCallback((idx: number, animated = true) => {
    const { isWide: wide, itemWidth: iw } = layoutRef.current;
    if (wide) {
      animatedListRef.current?.scrollToOffset({ offset: idx * iw, animated });
    } else {
      animatedListRef.current?.scrollToIndex({ index: idx, animated });
    }
  }, []);

  const scrollWithWrapMask = useCallback((targetIdx: number) => {
    const isWrap = targetIdx === 0 && currentIndexRef.current > 0;
    if (isWrap) {
      pillOpacity.value = withTiming(0, { duration: 80 }, (finished) => {
        'worklet';
        if (!finished) return;
        pillX.value = 0;
        runOnJS(scrollToIndex)(0, false);
        pillOpacity.value = withTiming(1, { duration: 160 }, (fadeFinished) => {
          'worklet';
          if (fadeFinished) {
            runOnJS(setIsAdvancing)(false);
          }
        });
      });
    } else {
      scrollToIndex(targetIdx);
    }
  }, [pillOpacity, pillX, scrollToIndex]);

  const startAutoAdvance = useCallback(() => {
    if (isSingle || count === 0) return;
    if (autoAdvanceRef.current) clearInterval(autoAdvanceRef.current);
    setProgressKey((k) => k + 1);
    setIsAutoAdvanceRunning(true);
    autoAdvanceRef.current = setInterval(() => {
      if (isUserScrolling.current) return;
      const next = (currentIndexRef.current + 1) % count;
      setIsAdvancing(true);
      scrollWithWrapMask(next);
    }, AUTO_ADVANCE_MS);
  }, [count, isSingle, scrollWithWrapMask]);

  const stopAutoAdvance = useCallback(() => {
    if (autoAdvanceRef.current) {
      clearInterval(autoAdvanceRef.current);
      autoAdvanceRef.current = null;
    }
    setIsAutoAdvanceRunning(false);
    setIsAdvancing(false);
  }, []);

  // ─── Pause button handler ───────────────────────────────────────────────────────
  const handlePauseToggle = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (!isPaused) {
      stopAutoAdvance();
      setIsPaused(true);
      if (pauseResumeTimerRef.current) clearTimeout(pauseResumeTimerRef.current);
      pauseResumeTimerRef.current = setTimeout(() => {
        pauseResumeTimerRef.current = null;
        setIsPaused(false);
        startAutoAdvance();
      }, PAUSE_RESUME_MS);
    } else {
      if (pauseResumeTimerRef.current) {
        clearTimeout(pauseResumeTimerRef.current);
        pauseResumeTimerRef.current = null;
      }
      setIsPaused(false);
      startAutoAdvance();
    }
  }, [isPaused, stopAutoAdvance, startAutoAdvance]);


  // ─── Auto-advance + cleanup ─────────────────────────────────────────────────────
  useEffect(() => {
    startAutoAdvance();
    return () => {
      stopAutoAdvance();
      if (pauseResumeTimerRef.current) clearTimeout(pauseResumeTimerRef.current);
    };
  }, [startAutoAdvance, stopAutoAdvance]);

  useEffect(() => {
    currentIndexSV.value = currentIndex;
  }, [currentIndex, currentIndexSV]);

  const prevItemWidthRef = useRef(itemWidth);
  useEffect(() => {
    if (itemWidth === prevItemWidthRef.current) return;
    prevItemWidthRef.current = itemWidth;
    itemWidthSV.value = itemWidth;
    const idx = currentIndexRef.current;
    pillX.value = idx * DOT_STEP;
    animatedListRef.current?.scrollToOffset({ offset: itemWidth * idx, animated: false });
    stopAutoAdvance();
    startAutoAdvance();
  }, [itemWidth, sideInset, startAutoAdvance, stopAutoAdvance, itemWidthSV, pillX]);

  // ─── Scroll handler (UI thread) ────────────────────────────────────────────────
  const scrollHandler = useAnimatedScrollHandler({
    onScroll: (event) => {
      scrollX.value = event.contentOffset.x;
      const iw = itemWidthSV.value;
      if (iw > 0) {
        const maxX = (count - 1) * DOT_STEP;
        const raw = (event.contentOffset.x / iw) * DOT_STEP;
        pillX.value = Math.max(0, Math.min(maxX, raw));
      }
    },
  });

  // ─── Drag-hint animation (replays every 30 s) ──────────────────────────────────
  const hasUserInteractedRef = useRef(false);
  const hintTranslateX = useSharedValue(0);
  const hintIconOpacity = useSharedValue(0);
  const hintIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const playHintAnimation = useCallback(() => {
    if (hasUserInteractedRef.current) return;
    const nudgeDir = isRTL ? 1 : -1;
    hintTranslateX.value = withSequence(
      withTiming(nudgeDir * 12, { duration: 160, easing: Easing.out(Easing.quad) }),
      withSpring(nudgeDir * -10, { damping: 7, stiffness: 320 }),
      withSpring(0, { damping: 16, stiffness: 220 }),
    );
    hintIconOpacity.value = withSequence(
      withTiming(1, { duration: 220 }),
      withTiming(1, { duration: 1380 }),
      withTiming(0, { duration: 400 }),
    );
  }, [isRTL, hintTranslateX, hintIconOpacity]);

  useEffect(() => {
    const currentLocale = isRTL ? 'rtl' : 'ltr';
    if (count <= 1 || !hintAllowed) return;
    if (hintShownForLocale === 'dismissed') return;

    hintShownForLocale = currentLocale;

    const initialTimer = setTimeout(() => { playHintAnimation(); }, 900);
    if (hintIntervalRef.current) clearInterval(hintIntervalRef.current);
    hintIntervalRef.current = setInterval(() => { playHintAnimation(); }, HINT_INTERVAL_MS);

    return () => {
      clearTimeout(initialTimer);
      if (hintIntervalRef.current) {
        clearInterval(hintIntervalRef.current);
        hintIntervalRef.current = null;
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [count, hintAllowed, isRTL]);

  const hintStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: hintTranslateX.value }],
  }));

  const hintIconStyle = useAnimatedStyle(() => ({
    opacity: hintIconOpacity.value,
  }));

  // ─── Spring pill after scroll settles ──────────────────────────────────────────
  const springPillToCurrentIndex = useCallback(() => {
    pillX.value = withSpring(currentIndexRef.current * DOT_STEP, {
      damping: 20,
      stiffness: 200,
    }, (finished) => {
      'worklet';
      if (finished) { runOnJS(setIsAdvancing)(false); }
    });
  }, [pillX]);

  const onScrollEndDrag = useCallback(() => {
    isUserScrolling.current = false;
    springPillToCurrentIndex();
  }, [springPillToCurrentIndex]);

  const onMomentumScrollEnd = useCallback(() => {
    isUserScrolling.current = false;
    springPillToCurrentIndex();
    // If not in a button-pause, restart auto-advance after drag.
    if (!isPaused) {
      startAutoAdvance();
    }
    if (hasUserInteractedRef.current) {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
  }, [springPillToCurrentIndex, startAutoAdvance, isPaused]);

  const onViewableItemsChanged = useRef(
    ({ viewableItems }: { viewableItems: Array<ViewToken> }) => {
      if (viewableItems.length > 0 && viewableItems[0].index != null) {
        const idx = viewableItems[0].index;
        currentIndexRef.current = idx;
        setCurrentIndex(idx);
      }
    },
  ).current;

  const viewabilityConfig = useRef({ viewAreaCoveragePercentThreshold: 50 }).current;

  const onScrollBeginDrag = useCallback(() => {
    isUserScrolling.current = true;
    if (!hasUserInteractedRef.current) {
      hasUserInteractedRef.current = true;
      hintShownForLocale = 'dismissed';
      if (hintIntervalRef.current) {
        clearInterval(hintIntervalRef.current);
        hintIntervalRef.current = null;
      }
      AsyncStorage.setItem(HINT_DISMISSED_KEY, '1').catch(() => {});
    }
    // Cancel button-pause on drag
    if (pauseResumeTimerRef.current) {
      clearTimeout(pauseResumeTimerRef.current);
      pauseResumeTimerRef.current = null;
      setIsPaused(false);
    }
    stopAutoAdvance();
  }, [stopAutoAdvance]);

  // ─── Dot press + pan gesture ────────────────────────────────────────────────────
  const handleDotPress = useCallback((idx: number) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    stopAutoAdvance();
    scrollWithWrapMask(idx);
    if (!isPaused) startAutoAdvance();
  }, [stopAutoAdvance, scrollWithWrapMask, startAutoAdvance, isPaused]);

  const DOT_SWIPE_STEP = 50;
  const dotPanStartIndex = useSharedValue(0);
  const dotPanLastIndex = useSharedValue(-1);

  const handleDotPanBegin = useCallback(() => {
    if (!hasUserInteractedRef.current) {
      hasUserInteractedRef.current = true;
      hintShownForLocale = 'dismissed';
      if (hintIntervalRef.current) {
        clearInterval(hintIntervalRef.current);
        hintIntervalRef.current = null;
      }
      AsyncStorage.setItem(HINT_DISMISSED_KEY, '1').catch(() => {});
    }
  }, []);

  const handleDotPanUpdate = useCallback((newIdx: number) => {
    scrollToIndex(newIdx, false);
  }, [scrollToIndex]);

  const handleDotPanEnd = useCallback((newIdx: number) => {
    if (newIdx === currentIndexRef.current) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    stopAutoAdvance();
    scrollToIndex(newIdx, true);
    if (!isPaused) startAutoAdvance();
  }, [stopAutoAdvance, scrollToIndex, startAutoAdvance, isPaused]);

  const dotsRowPanGesture = Gesture.Pan()
    .activeOffsetX([-10, 10])
    .failOffsetY([-15, 15])
    .onBegin(() => {
      dotPanStartIndex.value = currentIndexSV.value;
      dotPanLastIndex.value = currentIndexSV.value;
      runOnJS(handleDotPanBegin)();
    })
    .onUpdate((e) => {
      const dragged = Math.round(-e.translationX / DOT_SWIPE_STEP);
      const newIdx = Math.max(0, Math.min(count - 1, dotPanStartIndex.value + dragged));
      if (newIdx !== dotPanLastIndex.value) {
        dotPanLastIndex.value = newIdx;
        runOnJS(handleDotPanUpdate)(newIdx);
      }
    })
    .onEnd((e) => {
      const dragged = Math.round(-e.translationX / DOT_SWIPE_STEP);
      const newIdx = Math.max(0, Math.min(count - 1, dotPanStartIndex.value + dragged));
      runOnJS(handleDotPanEnd)(newIdx);
    });

  // ─── Press handler ──────────────────────────────────────────────────────────────
  const handleBundlePress = useCallback((bundle: BundleItem) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    if (bundle.itemType === 'promotion') {
      if (bundle.target_restaurant_id) {
        router.push(`/brand/${bundle.target_restaurant_id}`);
      } else if (bundle.target_product_id) {
        router.push(`/product/${bundle.target_product_id}`);
      }
    } else {
      router.push(`/offer/${bundle.id}`);
    }
  }, [router]);

  // ─── Render item ────────────────────────────────────────────────────────────────
  const renderItem = useCallback(
    ({ item, index }: { item: BundleItem; index: number }) => {
      const nextIndex = (currentIndex + 1) % count;
      return (
        <BundleSlide
          bundle={item}
          index={index}
          scrollX={scrollX}
          onPress={handleBundlePress}
          onPauseToggle={handlePauseToggle}
          language={language}
          isRTL={isRTL}
          scrollStep={itemWidth}
          slideWidth={slideWidth}
          isActive={currentIndex === index}
          isPaused={isPaused}
          progressKey={progressKey}
          isAutoAdvanceRunning={isAutoAdvanceRunning}
          isNextSlide={!isSingle && index === nextIndex}
          isAdvancing={isAdvancing}
        />
      );
    },
    [
      scrollX, handleBundlePress, handlePauseToggle,
      language, isRTL, itemWidth, slideWidth, currentIndex, isPaused,
      progressKey, isAutoAdvanceRunning, isAdvancing, count, isSingle,
    ],
  );

  const keyExtractor = useCallback((item: BundleItem) => item.id, []);

  const getItemLayout = useCallback(
    (_data: ArrayLike<BundleItem> | null | undefined, index: number) => ({
      length: itemWidth,
      offset: sideInset + itemWidth * index,
      index,
    }),
    [itemWidth, sideInset],
  );

  if (loading) return <ChefsSpotlightSkeleton />;
  if (count === 0) return null;

  return (
    <>
    <View style={styles.container}>
      <Animated.FlatList
        ref={animatedListRef}
        data={bundles}
        renderItem={renderItem}
        keyExtractor={keyExtractor}
        horizontal
        pagingEnabled={!isWide}
        showsHorizontalScrollIndicator={false}
        bounces={false}
        decelerationRate="fast"
        snapToInterval={isWide ? itemWidth : undefined}
        snapToAlignment="start"
        getItemLayout={getItemLayout}
        onScroll={scrollHandler}
        scrollEventThrottle={16}
        onScrollBeginDrag={onScrollBeginDrag}
        onScrollEndDrag={onScrollEndDrag}
        onMomentumScrollEnd={onMomentumScrollEnd}
        onViewableItemsChanged={onViewableItemsChanged}
        viewabilityConfig={viewabilityConfig}
        initialScrollIndex={0}
        removeClippedSubviews
        contentContainerStyle={isWide ? { paddingHorizontal: sideInset } : undefined}
      />

      {!isSingle && (
        <GestureDetector gesture={dotsRowPanGesture}>
          <View style={styles.dotsRow}>
            <View style={styles.dotsRowInner}>
              <Animated.View style={[styles.dotsTrack, hintStyle]}>
                {bundles.map((_, i) => (
                  <SpotlightDot
                    key={i}
                    index={i}
                    pillX={pillX}
                    onPress={() => handleDotPress(i)}
                  />
                ))}
                <SpotlightPill
                  pillX={pillX}
                  pillOpacity={pillOpacity}
                  count={count}
                  isPaused={isPaused || isAdvancing}
                />
              </Animated.View>

              {hintAllowed && (
                <Animated.View
                  style={[styles.hintIconWrapper, hintIconStyle]}
                  pointerEvents="none"
                >
                  <Ionicons
                    name={isRTL ? 'chevron-back' : 'chevron-forward'}
                    size={10}
                    color={COLORS.goldSoft}
                  />
                  <Ionicons
                    name={isRTL ? 'chevron-back' : 'chevron-forward'}
                    size={10}
                    color={COLORS.goldSoft}
                    style={styles.hintIconSecondChevron}
                  />
                </Animated.View>
              )}
            </View>
          </View>
        </GestureDetector>
      )}
    </View>
    <CarouselControlsTooltip
      visible={showTooltip}
      onDismiss={handleTooltipDismiss}
      isRTL={isRTL}
      language={language}
    />
    </>
  );
};

// ─── Styles ─────────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  container: {
    width: '100%',
  },
  slideOuter: {
    alignItems: 'center',
    paddingVertical: 4,
  },
  slideCard: {
    height: SLIDE_HEIGHT,
    borderRadius: RADII.xl,
    overflow: 'hidden',
    backgroundColor: COLORS.charcoalDeep,
    ...ELEVATION.hero,
    position: 'relative',
  },
  progressTrack: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 3,
    backgroundColor: 'rgba(200,162,74,0.22)',
    zIndex: 11,
    overflow: 'hidden',
  },
  progressFill: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: COLORS.goldBright,
    borderRadius: 1.5,
  },
  shimmerBorder: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: RADII.xl,
    borderWidth: 2,
    borderColor: COLORS.goldBright,
    zIndex: 10,
  },
  advancingShimmerOuter: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    width: '40%',
    zIndex: 8,
  },
  advancingShimmerGradient: {
    flex: 1,
  },
  slideTouchable: {
    flex: 1,
  },
  imageClip: {
    ...StyleSheet.absoluteFillObject,
    overflow: 'hidden',
  },
  imageWrapper: {
    height: '100%',
  },
  slideImage: {
    width: '100%',
    height: '100%',
  },
  slidePlaceholder: {
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  scrim: {
    ...StyleSheet.absoluteFillObject,
  },
  cornerAccent: {
    position: 'absolute',
    top: 0,
    width: 80,
    height: 80,
  },
  cornerAccentLTR: {
    left: 0,
  },
  cornerAccentRTL: {
    right: 0,
  },
  cornerGradient: {
    width: '100%',
    height: '100%',
  },
  pausedPillWrapper: {
    position: 'absolute',
    top: SPACING.md,
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 20,
  },
  pausedPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: RADII.pill,
  },
  pausedPillText: {
    ...TYPE.chipLabel,
    color: COLORS.ivory,
    fontSize: 12,
    letterSpacing: 0.4,
  },
  pauseButton: {
    position: 'absolute',
    top: SPACING.md,
    zIndex: 25,
    padding: 6,
    borderRadius: RADII.pill,
    backgroundColor: 'rgba(0,0,0,0.30)',
  },
  pauseButtonLeadingLTR: {
    right: SPACING.md,
  },
  pauseButtonLeadingRTL: {
    left: SPACING.md,
  },

  // ── Bundle content card ──
  contentCard: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: SPACING.xl,
    paddingTop: SPACING.lg,
    paddingBottom: SPACING.xl,
    gap: SPACING.sm,
    backgroundColor: 'rgba(255,255,255,0.07)',
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,215,0,0.18)',
  },
  contentCardRTL: {
    alignItems: 'flex-end',
  },
  topBadgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    flexWrap: 'wrap',
  },
  topBadgeRowRTL: {
    flexDirection: 'row-reverse',
  },
  badgeTrailingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexWrap: 'wrap',
  },
  ratingChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: 'rgba(200,162,74,0.16)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: RADII.pill,
    borderWidth: 1,
    borderColor: 'rgba(200,162,74,0.28)',
  },
  ratingChipText: {
    fontSize: 10,
    fontWeight: '700',
    color: COLORS.goldSoft,
    letterSpacing: 0.2,
  },
  bundleTypeChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: COLORS.goldSoft,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: RADII.pill,
  },
  bundleTypeChipText: {
    ...TYPE.microLabel,
    color: COLORS.charcoalDeep,
    fontSize: 10,
  },
  discountBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: RADII.pill,
    alignItems: 'center',
  },
  discountNum: {
    ...TYPE.priceCompact,
    color: COLORS.charcoalDeep,
    fontSize: 15,
    lineHeight: 18,
  },
  discountLabel: {
    ...TYPE.tinyLabel,
    color: COLORS.charcoalDeep,
    fontSize: 9,
  },
  slideTitle: {
    ...TYPE.display,
    color: COLORS.ivory,
    textShadowColor: 'rgba(0,0,0,0.5)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 8,
  },
  textRight: {
    textAlign: 'right',
  },
  countChipRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  countChipRowRTL: {
    flexDirection: 'row-reverse',
  },
  countChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(255,215,0,0.30)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: RADII.pill,
  },
  countChipText: {
    ...TYPE.chipLabel,
    color: COLORS.goldSoft,
    fontSize: 11,
  },
  priceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
  },
  priceRowRTL: {
    flexDirection: 'row-reverse',
  },
  oldPrice: {
    ...TYPE.body,
    color: 'rgba(255,255,255,0.50)',
    textDecorationLine: 'line-through',
    fontSize: 13,
  },
  newPrice: {
    ...TYPE.priceCompact,
    color: COLORS.goldSoft,
    fontSize: 17,
  },
  currency: {
    ...TYPE.caption,
    color: COLORS.goldSoft,
    fontSize: 12,
  },
  ctaRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  ctaRowRTL: {
    flexDirection: 'row-reverse',
  },
  ctaPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: COLORS.gold,
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: RADII.pill,
    alignSelf: 'flex-start',
  },
  ctaPillText: {
    ...TYPE.chipLabel,
    color: COLORS.charcoalDeep,
    fontSize: 12,
    letterSpacing: 0.5,
  },

  // ── Dots ──
  dotsRow: {
    alignItems: 'center',
    marginTop: SPACING.md,
    paddingVertical: SPACING.xs,
  },
  dotsRowInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.xs,
  },
  hintIconWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  hintIconSecondChevron: {
    marginLeft: -4,
  },
  dotsTrack: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.xs,
    position: 'relative',
  },
  dot: {
    width: INDICATORS.dot.width,
    height: INDICATORS.dot.height,
    borderRadius: INDICATORS.dot.borderRadius,
    backgroundColor: OVERLAYS.ivoryDot,
  },
  slidingPillOuter: {
    position: 'absolute',
    left: 0,
    top: 0,
    width: INDICATORS.dot.width,
    height: INDICATORS.dot.height,
    borderRadius: INDICATORS.dot.borderRadius,
  },
  slidingPillGlowHalo: {
    position: 'absolute',
    left: 0,
    top: 0,
    right: 0,
    bottom: 0,
    borderRadius: INDICATORS.dot.borderRadius,
    backgroundColor: COLORS.gold,
    ...(Platform.OS === 'web'
      ? { boxShadow: `0px 0px 6px 1px rgba(200, 162, 74, 0.75)` }
      : {
          shadowColor: COLORS.gold,
          shadowOffset: { width: 0, height: 0 },
          shadowOpacity: 0.75,
          shadowRadius: 4,
          elevation: 4,
        }),
  },
  slidingPillFill: {
    position: 'absolute',
    left: 0,
    top: 0,
    right: 0,
    bottom: 0,
    borderRadius: INDICATORS.dot.borderRadius,
    backgroundColor: COLORS.gold,
  },

  // ── Skeleton ──
  skeletonWrapper: {
    width: '100%',
    alignItems: 'center',
    paddingHorizontal: SLIDE_MARGIN,
  },
  skeletonDots: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: SPACING.md,
    gap: SPACING.xs,
  },
});

export default ChefsSpecialSpotlight;
