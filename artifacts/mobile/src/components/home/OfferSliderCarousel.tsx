/**
 * OfferSliderCarousel — 2026 Cinematic Banner Carousel
 *
 * Full-bleed parallax slides with glassmorphism info card, animated gold
 * shimmer border on the active slide, auto-advance, and spring-animated
 * pill/dot indicators.
 *
 * Responsive: re-measures on orientation change via useWindowDimensions.
 * On wide screens (>480 pt) each item is 88% viewport for edge peeking.
 *
 * Interactions:
 *  - Drag horizontally to scroll (pauses auto-advance; resumes with fresh
 *    5 s timer on release).
 *  - Long-press any slide to pause auto-advance; a "Paused" pill fades in
 *    at the top. The 8 s resume countdown starts when the finger lifts.
 *    Swiping horizontally while paused cancels the pause immediately.
 *  - Swipe a slide upward (> 60 pt or fast flick) to dismiss it and jump
 *    to the next slide; the slide animates out upward with a spring-snap
 *    back if the swipe doesn't cross the threshold.
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
} from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
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
import { Skeleton } from '../ui/Skeleton';

const SLIDE_HEIGHT = 380;
const SLIDE_MARGIN = 16;
const WIDE_BREAKPOINT = 480;
const WIDE_RATIO = 0.88;
const PARALLAX_STRENGTH = 24;
const AUTO_ADVANCE_MS = 5000;
const LONG_PRESS_PAUSE_MS = 8000;
/** Upward translation threshold (pt) to commit a swipe-dismiss. */
const SWIPE_DISMISS_THRESHOLD = 60;

/**
 * Module-level locale tracker: stores the locale direction ('ltr' | 'rtl') for
 * which the hint was last played, so it can replay if the user switches language
 * mid-session. Set to 'dismissed' when the user drags, permanently suppressing
 * all further replays for the remainder of the JS session.
 */
let dragHintShownForLocale: 'ltr' | 'rtl' | 'dismissed' | null = null;
/** AsyncStorage key that persists the last hint playback timestamp (ms). */
const DRAG_HINT_TS_KEY = 'offer_carousel_drag_hint_last_played';
/** Minimum idle time (ms) before the hint replays on the next session. */
const DRAG_HINT_REPLAY_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours
/**
 * AsyncStorage key set to '1' the first time the user drags the carousel.
 * When present it permanently suppresses the hint and the swipe-arrow icon
 * for all future sessions — the user has demonstrated they know how to swipe.
 */
const DRAG_HINT_DISMISSED_KEY = 'offer_carousel_drag_hint_dismissed';
/** Velocity threshold (pt/s) to commit a swipe-dismiss regardless of distance. */
const SWIPE_DISMISS_VELOCITY = 500;

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

interface Banner {
  id: string;
  title?: string;
  title_ar?: string;
  /** Object-storage CDN URL (higher priority than `image`). */
  image_url?: string;
  image?: string;
  target_product_id?: string;
  target_restaurant_id?: string;
  target_car_model_id?: string;
}

const STATIC_FALLBACK_BANNERS: Banner[] = [
  {
    id: 'static-banner-1',
    title: 'Stories & Specials',
    title_ar: 'عروض خاصة',
    image_url: 'https://images.unsplash.com/photo-1414235077428-338989a2e8c0?auto=format&fit=crop&w=1400&q=80',
  },
  {
    id: 'static-banner-2',
    title: 'Nile Views & Fine Dining',
    title_ar: 'إطلالات النيل والطعام الراقي',
    image_url: 'https://images.unsplash.com/photo-1559339352-11d035aa65de?auto=format&fit=crop&w=1400&q=80',
  },
  {
    id: 'static-banner-3',
    title: 'Seasonal Chef Selections',
    title_ar: 'اختيارات الشيف الموسمية',
    image_url: 'https://images.unsplash.com/photo-1467003909585-2f8a72700288?auto=format&fit=crop&w=1400&q=80',
  },
];

interface SlideProps {
  banner: Banner;
  index: number;
  scrollX: SharedValue<number>;
  onPress: (banner: Banner) => void;
  /** Fires when onLongPress triggers (finger still held) — stops auto-advance and shows pill. */
  onLongPressStart: () => void;
  /** Fires when the finger lifts after a long-press — starts the 8 s resume timer. */
  onLongPressRelease: () => void;
  /** Fires after a successful upward swipe-dismiss animation completes. */
  onSwipeDismiss: () => void;
  language: string;
  isRTL: boolean;
  scrollStep: number;
  slideWidth: number;
  isActive: boolean;
  isPaused: boolean;
  /** Increments every time auto-advance restarts; used to reset the progress bar. */
  progressKey: number;
  /** True while the auto-advance interval is running; false during drags and pauses. */
  isAutoAdvanceRunning: boolean;
  /** True when this slide is the one about to become active during an auto-advance transition. */
  isNextSlide: boolean;
  /** True while the pill is mid-travel during auto-advance — matches parent isAdvancing state. */
  isAdvancing: boolean;
}

const Slide = memo(({
  banner,
  index,
  scrollX,
  onPress,
  onLongPressStart,
  onLongPressRelease,
  onSwipeDismiss,
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
}: SlideProps) => {
  const inputPosition = index * scrollStep;

  // ─── Long-press navigation guard ────────────────────────────────────────────
  // React Native's Touchable does not guarantee onPress is suppressed after
  // onLongPress, so we track it with a ref and bail out in handlePress.
  const longPressActivatedRef = useRef(false);

  const handlePress = useCallback(() => {
    if (longPressActivatedRef.current) {
      return; // swallow — reset happens in handlePressOut
    }
    onPress(banner);
  }, [onPress, banner]);

  const handleLongPress = useCallback(() => {
    longPressActivatedRef.current = true;
    onLongPressStart();
  }, [onLongPressStart]);

  const handlePressOut = useCallback(() => {
    if (longPressActivatedRef.current) {
      longPressActivatedRef.current = false; // always reset on lift
      // Always call onLongPressRelease; the parent guards against stale
      // scheduling via a synchronous ref (longPressInProgressRef).
      onLongPressRelease();
    }
  }, [onLongPressRelease]);

  // ─── Swipe-up-to-dismiss gesture ────────────────────────────────────────────
  const dismissY = useSharedValue(0);
  const dismissOpacity = useSharedValue(1);

  const triggerDismiss = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    onSwipeDismiss();
    // Reset after the host has scrolled away so the slide looks normal if
    // it's revisited (FlatList recycles items).
    dismissY.value = 0;
    dismissOpacity.value = 1;
  }, [onSwipeDismiss, dismissY, dismissOpacity]);

  const swipeUpGesture = Gesture.Pan()
    // Activate only for upward swipes; fail for significant horizontal movement
    // so the FlatList can handle horizontal drags unimpeded.
    .activeOffsetY([-15, Number.POSITIVE_INFINITY])
    .failOffsetX([-20, 20])
    .onUpdate((e) => {
      if (e.translationY < 0) {
        dismissY.value = e.translationY;
        dismissOpacity.value = interpolate(
          e.translationY,
          [-SLIDE_HEIGHT, -SWIPE_DISMISS_THRESHOLD, 0],
          [0, 0.5, 1],
          Extrapolation.CLAMP,
        );
      }
    })
    .onEnd((e) => {
      const shouldDismiss =
        e.translationY < -SWIPE_DISMISS_THRESHOLD ||
        e.velocityY < -SWIPE_DISMISS_VELOCITY;

      if (shouldDismiss) {
        dismissY.value = withTiming(-(SLIDE_HEIGHT + 60), { duration: 240 }, () => {
          runOnJS(triggerDismiss)();
        });
        dismissOpacity.value = withTiming(0, { duration: 200 });
      } else {
        // Snap back to original position.
        dismissY.value = withSpring(0, { damping: 22, stiffness: 260 });
        dismissOpacity.value = withTiming(1, { duration: 180 });
      }
    });

  const dismissStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: dismissY.value }],
    opacity: dismissOpacity.value,
  }));

  // ─── Parallax image transform ────────────────────────────────────────────────
  const imageStyle = useAnimatedStyle(() => {
    const translateX = interpolate(
      scrollX.value,
      [inputPosition - scrollStep, inputPosition, inputPosition + scrollStep],
      [PARALLAX_STRENGTH, 0, -PARALLAX_STRENGTH],
      Extrapolation.CLAMP,
    );
    return { transform: [{ translateX }] };
  });

  // ─── Slide opacity + scale (inactive dimming) ────────────────────────────────
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

  // ─── Gold shimmer border (active slide only) ─────────────────────────────────
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
  }, [isActive]);

  const shimmerBorderStyle = useAnimatedStyle(() => ({
    opacity: shimmerOpacity.value,
  }));

  // ─── Paused pill (active + paused) ──────────────────────────────────────────
  const pausedPillOpacity = useSharedValue(0);
  useEffect(() => {
    pausedPillOpacity.value = withTiming(
      isActive && isPaused ? 1 : 0,
      { duration: 280 },
    );
  }, [isActive, isPaused]);

  const pausedPillStyle = useAnimatedStyle(() => ({
    opacity: pausedPillOpacity.value,
  }));

  // ─── Auto-advance progress bar ───────────────────────────────────────────────
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

  // ─── Incoming-slide shimmer sweep (advancing) ─────────────────────────────────
  // A narrow gold gradient strip that sweeps across the slide while the pill is
  // mid-travel to the next dot. Direction flips in RTL: starts at +slideWidth
  // and travels to -slideWidth*1.5 so the leading edge matches the carousel's
  // natural RTL direction. Fades in at the start of the transition and fades out
  // once isAdvancing is cleared (spring has settled).
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

  // ─── Content ─────────────────────────────────────────────────────────────────
  const title = language === 'ar'
    ? (banner.title_ar || banner.title || '')
    : (banner.title || banner.title_ar || '');

  const imageSource = banner.image_url || banner.image;
  const imageWrapperWidth = slideWidth + PARALLAX_STRENGTH * 2;

  return (
    <GestureDetector gesture={swipeUpGesture}>
      <View style={styles.slideOuter}>
        {/* dismissStyle wraps the card so the swipe-up lift happens outside overflow:hidden */}
        <Animated.View style={[{ width: slideWidth }, slideStyle, dismissStyle]}>
          <Animated.View style={[styles.slideCard, { width: slideWidth }]}>
            {/* Active gold shimmer border overlay */}
            <Animated.View
              style={[styles.shimmerBorder, shimmerBorderStyle]}
              pointerEvents="none"
            />

            {/* Advancing shimmer sweep — gold strip that crosses the incoming slide while the pill travels */}
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

            {/* Auto-advance progress bar — top edge, gold, active slide only while advancing */}
            {isActive && isAutoAdvanceRunning && (
              <View style={styles.progressTrack} pointerEvents="none">
                <Animated.View style={[styles.progressFill, progressFillStyle]} />
              </View>
            )}

            {/* ── Layer 1: background image (direct child of slideCard for reliable web rendering) ── */}
            {imageSource ? (
              <ExpoImage
                source={{ uri: imageSource }}
                style={StyleSheet.absoluteFillObject}
                contentFit="cover"
                cachePolicy="memory-disk"
                pointerEvents="none"
              />
            ) : (
              <LinearGradient
                colors={GRADIENTS.bundleCardBurgundy}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={[StyleSheet.absoluteFillObject, styles.slidePlaceholder]}
                pointerEvents="none"
              >
                <Ionicons name="restaurant" size={56} color={OVERLAYS.goldGlowSoft} />
              </LinearGradient>
            )}

            {/* ── Layer 2: dark cinematic scrim ── */}
            <LinearGradient
              colors={['transparent', 'rgba(4,4,12,0.40)', 'rgba(4,4,12,0.92)']}
              start={{ x: 0, y: 0.25 }}
              end={{ x: 0, y: 1 }}
              style={StyleSheet.absoluteFillObject}
              pointerEvents="none"
            />

            {/* ── Layer 3: touch capture (absoluteFill) ── */}
            <TouchableOpacity
              activeOpacity={0.90}
              onPress={handlePress}
              onLongPress={handleLongPress}
              onPressOut={handlePressOut}
              delayLongPress={400}
              style={styles.slideTouchable}
            >
              {/* Leading corner gold accent */}
              <View
                style={[styles.cornerAccent, isRTL ? styles.cornerAccentRTL : styles.cornerAccentLTR]}
                pointerEvents="none"
              >
                <LinearGradient
                  colors={['rgba(200,162,74,0.55)', 'transparent']}
                  start={isRTL ? { x: 1, y: 0 } : { x: 0, y: 0 }}
                  end={isRTL ? { x: 0, y: 1 } : { x: 1, y: 1 }}
                  style={styles.cornerGradient}
                />
              </View>

              {/* Paused indicator pill — top-center */}
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
            </TouchableOpacity>

            {/*
             * Glass info card — sibling of slideTouchable, direct child of
             * slideCard (position:relative). Resolves bottom:0 to slideCard.
             * pointerEvents="none" lets touches fall through to slideTouchable.
             */}
            <View style={styles.glassCard} pointerEvents="none">
              {title ? (
                <Text
                  style={[styles.slideTitle, isRTL && styles.textRight]}
                  numberOfLines={2}
                >
                  {title}
                </Text>
              ) : null}

              {/* CTA pill */}
              <View style={[styles.ctaRow, isRTL && styles.ctaRowRTL]}>
                <View style={styles.ctaPill}>
                  <Text style={styles.ctaPillText}>
                    {language === 'ar' ? 'اعرف أكثر' : 'View Offer'}
                  </Text>
                  <Ionicons
                    name={isRTL ? 'arrow-back' : 'arrow-forward'}
                    size={11}
                    color={COLORS.charcoalDeep}
                  />
                </View>
              </View>
            </View>
          </Animated.View>
        </Animated.View>
      </View>
    </GestureDetector>
  );
});

interface DotProps {
  index: number;
  pillX: SharedValue<number>;
  onPress: () => void;
}

/**
 * When proximity = 1 the dot should look like a short pill (~14 pt wide).
 * We scale horizontally only so layout is unaffected and the dot expands
 * symmetrically from its centre — the pill (rendered later in JSX) stays
 * on top automatically.
 *
 * scaleX range: 1 → DOT_ACTIVE_SCALE_X (6 pt → ~14 pt).
 */
/** Active pill width — real pill/capsule shape (wider than an inactive dot). */
const PILL_W = 22;
const PILL_H = 7;

const Dot = memo(({ index, pillX, onPress }: DotProps) => {
  const colorScheme = useColorScheme();
  // Clear, visible colors that work on any banner background
  const dotBg = colorScheme === 'dark'
    ? 'rgba(255,255,255,0.60)'
    : 'rgba(0,0,0,0.45)';
  const animStyle = useAnimatedStyle(() => {
    // Distance in dot-track space between this dot's centre and the pill.
    const dist = Math.abs(pillX.value - index * DOT_STEP);
    // proximity: 1 when pill is exactly on this dot, 0 when ≥ one step away.
    const proximity = 1 - Math.min(dist / DOT_STEP, 1);
    // Inactive: 55% opacity; active: 100% — no scaleX (pill handles active state)
    const opacity = interpolate(proximity, [0, 1], [0.55, 1], Extrapolation.CLAMP);
    return { opacity };
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

/** One dot-width + one gap = the step between successive dot centres. */
const DOT_STEP = INDICATORS.dot.width + SPACING.xs; // 6 + 4 = 10

interface SlidingPillProps {
  /** Master pill position shared value — updated in real-time from the scroll
   *  worklet and spring-animated to the snapped dot after the scroll settles. */
  pillX: SharedValue<number>;
  /**
   * Opacity of the pill outer shell — driven to 0 just before a discontinuous
   * scroll jump (loop wrap) and back to 1 once the jump is complete, hiding
   * the flash that would otherwise be visible as scrollX changes abruptly.
   */
  pillOpacity: SharedValue<number>;
  count: number;
  /** When true the breathing animation pauses gracefully at a mid-dim level. */
  isPaused: boolean;
}

/**
 * Gold pill with two-phase motion:
 *  1. During drag / momentum — `pillX` is updated every frame directly from the
 *     scroll event on the UI thread (no JS bridge, no jank).
 *  2. After the scroll settles — `pillX` receives a `withSpring` to the exact
 *     dot-centre, giving a satisfying bounce finish.
 *
 * Breathing glow — two inner layers keep the gold fill visually solid while
 * the halo pulses:
 *  • `slidingPillGlowHalo`  — absolutely positioned, carries the shadow/box-
 *    shadow and an identical gold background; its opacity is animated so the
 *    glow breathes.  The shadow bleeds outside the element bounds so it
 *    remains visible even when the layer is at its dim phase.
 *  • `slidingPillFill`      — absolutely positioned on top of the halo, same
 *    size, same gold background, no shadow, always opaque.  It masks the halo's
 *    background without hiding the shadow, ensuring the pill colour never wavers.
 *
 * When `isPaused` is true the repeat loop is cancelled and the halo cross-fades
 * to a static mid-dim value so the glow doesn't vanish abruptly.
 */
const SlidingPill = memo(({ pillX, pillOpacity, count, isPaused }: SlidingPillProps) => {
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
    return () => {
      cancelAnimation(glowOpacity);
    };
  }, [isPaused, glowOpacity]);

  const pillStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: count <= 1 ? 0 : pillX.value }],
    opacity: pillOpacity.value,
  }));

  const haloStyle = useAnimatedStyle(() => ({
    opacity: glowOpacity.value,
  }));

  return (
    <Animated.View
      style={[styles.slidingPillOuter, pillStyle]}
      pointerEvents="none"
    >
      {/* Glow halo — shadow + gold bg; opacity pulses so the glow breathes */}
      <Animated.View style={[styles.slidingPillGlowHalo, haloStyle]} />
      {/* Solid fill — always opaque; sits on top to keep gold colour steady */}
      <View style={styles.slidingPillFill} />
    </Animated.View>
  );
});

export const OfferSliderSkeleton: React.FC = () => {
  const { width: screenWidth } = useWindowDimensions();
  const { slideWidth } = useMemo(() => computeLayout(screenWidth), [screenWidth]);
  return (
    <View style={styles.skeletonWrapper}>
      <Skeleton width={slideWidth} height={SLIDE_HEIGHT} borderRadius={RADII.xl} animation="shimmer" />
      <View style={styles.skeletonDots}>
        {[0, 1, 2].map((i) => (
          <Skeleton
            key={i}
            width={i === 0 ? 22 : 6}
            height={7}
            borderRadius={4}
            style={{ marginHorizontal: 4 }}
            animation="pulse"
          />
        ))}
      </View>
    </View>
  );
};

interface OfferSliderCarouselProps {
  banners: Banner[];
  isLoading?: boolean;
}

export const OfferSliderCarousel: React.FC<OfferSliderCarouselProps> = ({
  banners,
  isLoading = false,
}) => {
  const router = useRouter();
  const { language } = useTranslation();
  const isRTL = language === 'ar';
  const { width: screenWidth } = useWindowDimensions();

  const layout = useMemo(() => computeLayout(screenWidth), [screenWidth]);
  const { isWide, slideWidth, itemWidth, sideInset } = layout;

  const layoutRef = useRef(layout);
  useEffect(() => { layoutRef.current = layout; }, [layout]);

  const [currentIndex, setCurrentIndex] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const [isAdvancing, setIsAdvancing] = useState(false);
  const [progressKey, setProgressKey] = useState(0);
  const [isAutoAdvanceRunning, setIsAutoAdvanceRunning] = useState(false);
  /**
   * True once we have confirmed (via AsyncStorage) that the hint is eligible
   * to play this session — either never played before or last played >24 h ago.
   * Stays false for the lifetime of the session if the hint already fired today,
   * preventing multiple plays even if the component remounts.
   *
   * Initialised to `true` on remount when the hint has already played for one
   * locale direction this session, so a locale switch can replay without waiting
   * for the AsyncStorage check to re-run (it exits early in that case).
   */
  const [hintAllowed, setHintAllowed] = useState(
    () => dragHintShownForLocale !== null && dragHintShownForLocale !== 'dismissed',
  );

  useEffect(() => {
    if (dragHintShownForLocale !== null) return; // already fired this JS session — no need to check storage
    Promise.all([
      AsyncStorage.getItem(DRAG_HINT_DISMISSED_KEY),
      AsyncStorage.getItem(DRAG_HINT_TS_KEY),
    ])
      .then(([dismissed, raw]) => {
        // If the user has ever dragged the carousel, never show the hint again.
        if (dismissed === '1') return;
        const parsed = Number(raw);
        const last = raw && Number.isFinite(parsed) ? parsed : 0;
        if (Date.now() - last >= DRAG_HINT_REPLAY_INTERVAL_MS) {
          setHintAllowed(true);
        }
      })
      .catch(() => {
        // If storage fails, default to allowing the hint so it degrades gracefully.
        setHintAllowed(true);
      });
  }, []);

  /** Shared value mirror of currentIndex — lets the dots-row pan gesture read
   *  the active slide index on the UI thread without crossing to JS. */
  const currentIndexSV = useSharedValue(0);

  const animatedListRef = useAnimatedRef<Animated.FlatList<Banner>>();
  const scrollX = useSharedValue(0);
  /**
   * Pill position shared value — two-phase animation:
   *  • Phase 1 (drag / momentum): updated every frame from the scroll worklet on
   *    the UI thread so the pill tracks the finger with zero JS-thread latency.
   *  • Phase 2 (settle): after the scroll comes to rest, JS assigns a withSpring
   *    to snap the pill to the exact dot centre with a satisfying bounce.
   */
  const pillX = useSharedValue(0);
  /**
   * Controls the pill's opacity during loop wrap transitions.
   * Driven to 0 before a discontinuous scroll jump and back to 1 once the
   * jump has settled, hiding the positional flash that would otherwise occur.
   */
  const pillOpacity = useSharedValue(1);
  /** UI-thread-readable mirror of itemWidth, needed by the scroll worklet. */
  const itemWidthSV = useSharedValue(itemWidth);
  const isUserScrolling = useRef(false);
  const autoAdvanceRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const currentIndexRef = useRef(0);
  const longPressPauseTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /**
   * Synchronous ref tracking whether a long-press is currently "in progress"
   * (i.e. auto-advance has been stopped and the 8 s timer has not yet been
   * scheduled or has been cancelled). This lets handleLongPressRelease avoid
   * scheduling a stale timer when the drag-cancel path (resumeFromLongPress)
   * already cleared the pause before onPressOut fires.
   */
  const longPressInProgressRef = useRef(false);

  const effectiveBanners = (!isLoading && banners.length === 0) ? STATIC_FALLBACK_BANNERS : banners;
  const count = effectiveBanners.length;
  const isSingle = count === 1;

  const scrollToIndex = useCallback((idx: number, animated = true) => {
    const { isWide: wide, itemWidth: iw } = layoutRef.current;
    if (wide) {
      animatedListRef.current?.scrollToOffset({ offset: idx * iw, animated });
    } else {
      animatedListRef.current?.scrollToIndex({ index: idx, animated });
    }
  }, []);

  /**
   * Navigate to `targetIdx`, masking any discontinuous pill jump with a brief
   * opacity dip when the carousel wraps last→first.
   *
   * When `targetIdx === 0` and the carousel is not already at the start, a
   * programmatic `scrollToIndex(0)` causes the scroll offset to jump
   * discontinuously (not via a real drag).  The scroll-handler worklet
   * immediately updates `pillX` from `(N-1)×DOT_STEP` to 0, producing a
   * visible flash.  This helper hides that discontinuity by:
   *
   *   1. Fading `pillOpacity` to 0 over 80 ms (pill becomes invisible)
   *   2. Inside the Reanimated UI-thread callback: snapping `pillX` to the
   *      target dot and calling `scrollToIndex` with `animated: false` (the
   *      instant jump now happens while the pill is hidden)
   *   3. Fading `pillOpacity` back to 1 over 160 ms
   *
   * All other navigations (non-wrap) call `scrollToIndex` normally with
   * animation so the pill tracks the FlatList in real time.
   */
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
    setProgressKey(k => k + 1);
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

  /**
   * Cancel any active long-press pause state/timer.
   * @param restartAdvance - When true (default), also immediately restarts
   *   auto-advance. Pass false when the caller (e.g. drag-begin) will stop
   *   auto-advance right after, to avoid a transient start/stop cycle.
   */
  const resumeFromLongPress = useCallback((restartAdvance = true) => {
    longPressInProgressRef.current = false; // guard must be cleared first (synchronous)
    if (longPressPauseTimeoutRef.current) {
      clearTimeout(longPressPauseTimeoutRef.current);
      longPressPauseTimeoutRef.current = null;
    }
    setIsPaused(false);
    if (restartAdvance) startAutoAdvance();
  }, [startAutoAdvance]);

  /**
   * Step 1 — fires when onLongPress triggers (finger still held).
   * Sets longPressInProgressRef=true (synchronous), stops auto-advance, and
   * shows the paused pill. Does NOT start the 8 s resume timer yet.
   */
  const handleLongPressStart = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    longPressInProgressRef.current = true;
    stopAutoAdvance();
    setIsPaused(true);
    if (longPressPauseTimeoutRef.current) {
      clearTimeout(longPressPauseTimeoutRef.current);
      longPressPauseTimeoutRef.current = null;
    }
  }, [stopAutoAdvance]);

  /**
   * Step 2 — fires when the finger lifts after a long-press (onPressOut in Slide).
   * The parent guards with longPressInProgressRef: if drag-cancel already cleared
   * it (resumeFromLongPress), we skip scheduling a stale timer.
   */
  const handleLongPressRelease = useCallback(() => {
    if (!longPressInProgressRef.current) return; // drag-cancel won the race
    longPressInProgressRef.current = false;
    if (longPressPauseTimeoutRef.current) {
      clearTimeout(longPressPauseTimeoutRef.current);
    }
    longPressPauseTimeoutRef.current = setTimeout(() => {
      longPressPauseTimeoutRef.current = null;
      setIsPaused(false);
      startAutoAdvance();
    }, LONG_PRESS_PAUSE_MS);
  }, [startAutoAdvance]);

  /**
   * Fires after a successful swipe-dismiss animation completes.
   * Clears all long-press pause state, advances to the next slide, and starts
   * a single fresh 5 s auto-advance interval.
   */
  const handleSwipeDismiss = useCallback(() => {
    longPressInProgressRef.current = false;
    if (longPressPauseTimeoutRef.current) {
      clearTimeout(longPressPauseTimeoutRef.current);
      longPressPauseTimeoutRef.current = null;
    }
    setIsPaused(false);

    const next = (currentIndexRef.current + 1) % count;
    scrollWithWrapMask(next);
    stopAutoAdvance();
    startAutoAdvance();
  }, [count, scrollWithWrapMask, stopAutoAdvance, startAutoAdvance]);

  useEffect(() => {
    startAutoAdvance();
    return () => {
      stopAutoAdvance();
      if (longPressPauseTimeoutRef.current) {
        clearTimeout(longPressPauseTimeoutRef.current);
      }
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
    // Snap pill immediately to the correct position after layout change.
    pillX.value = idx * DOT_STEP;
    animatedListRef.current?.scrollToOffset({
      offset: itemWidth * idx,
      animated: false,
    });
    stopAutoAdvance();
    startAutoAdvance();
  }, [itemWidth, sideInset, startAutoAdvance, stopAutoAdvance, itemWidthSV, pillX]);

  /**
   * Scroll handler — runs entirely on the UI thread.
   *
   * Phase 1: `pillX` is updated every frame from the raw scroll offset so the
   * gold pill tracks the finger continuously during a drag or momentum scroll.
   * The formula maps the FlatList coordinate space to the dot-track space:
   *   pillX = clamp((scrollX / itemWidth) * DOT_STEP, 0, (count−1) × DOT_STEP)
   *
   * Phase 2: after the scroll settles, JS sets `pillX = withSpring(target)` for
   * the final spring snap (see onMomentumScrollEnd / onScrollEndDrag).
   */
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

  const hasUserInteractedRef = useRef(false);

  // ─── Drag-hint animation (dots row) ─────────────────────────────────────────
  // Plays a subtle left-then-right nudge once per JS session (module-level flag
  // survives remounts) to hint that the dots row is swipeable.
  // Also replays at the start of a new session when the app has been idle for
  // more than 24 hours (controlled by the AsyncStorage-backed `hintAllowed` state).
  const hintTranslateX = useSharedValue(0);
  /**
   * Opacity for the swipe-arrow icon rendered next to the dots row.
   * Fades in when the nudge hint plays and fades out after ~2 s.
   * Starts at 0 so it is invisible until the hint fires.
   */
  const hintIconOpacity = useSharedValue(0);

  useEffect(() => {
    const currentLocale = isRTL ? 'rtl' : 'ltr';
    if (count <= 1 || !hintAllowed) return;
    if (dragHintShownForLocale === currentLocale || dragHintShownForLocale === 'dismissed') return;
    dragHintShownForLocale = currentLocale;
    const timer = setTimeout(() => {
      // Skip if the user already dragged during the startup delay — they've
      // shown they know how to swipe and we've already written the dismissed key.
      if (hasUserInteractedRef.current) return;
      const nudgeDir = isRTL ? 1 : -1;
      hintTranslateX.value = withSequence(
        withTiming(nudgeDir * 12, { duration: 160, easing: Easing.out(Easing.quad) }),
        withSpring(nudgeDir * -10, { damping: 7, stiffness: 320 }),
        withSpring(0, { damping: 16, stiffness: 220 }),
      );
      // Fade the swipe-arrow icon in, hold, then fade it out over ~2 s total.
      hintIconOpacity.value = withSequence(
        withTiming(1, { duration: 220 }),
        withTiming(1, { duration: 1380 }),
        withTiming(0, { duration: 400 }),
      );
      AsyncStorage.setItem(DRAG_HINT_TS_KEY, String(Date.now())).catch(() => {});
    }, 900);
    return () => clearTimeout(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [count, hintAllowed, isRTL]);

  const hintStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: hintTranslateX.value }],
  }));

  const hintIconStyle = useAnimatedStyle(() => ({
    opacity: hintIconOpacity.value,
  }));

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
    // Permanently suppress the hint for all future sessions once the user
    // has demonstrated they know how to swipe.
    if (!hasUserInteractedRef.current) {
      hasUserInteractedRef.current = true;
      dragHintShownForLocale = 'dismissed'; // cancel any pending mid-session hint timer
      AsyncStorage.setItem(DRAG_HINT_DISMISSED_KEY, '1').catch(() => {});
    }
    // Dragging while paused cancels the long-press pause. Pass false so
    // resumeFromLongPress skips the transient startAutoAdvance that would be
    // immediately undone by the stopAutoAdvance below.
    resumeFromLongPress(false);
    stopAutoAdvance();
  }, [stopAutoAdvance, resumeFromLongPress]);

  /** Spring the pill to the exact dot centre after the scroll comes to rest. */
  const springPillToCurrentIndex = useCallback(() => {
    pillX.value = withSpring(currentIndexRef.current * DOT_STEP, {
      damping: 20,
      stiffness: 200,
    }, (finished) => {
      'worklet';
      if (finished) {
        runOnJS(setIsAdvancing)(false);
      }
    });
  }, [pillX]);

  const onScrollEndDrag = useCallback(() => {
    isUserScrolling.current = false;
    // Cover the no-momentum case (very slow drag that snaps without flinging).
    springPillToCurrentIndex();
  }, [springPillToCurrentIndex]);

  const onMomentumScrollEnd = useCallback(() => {
    isUserScrolling.current = false;
    // Phase 2: spring the pill to the exact dot centre for a satisfying bounce.
    springPillToCurrentIndex();
    startAutoAdvance();
    if (hasUserInteractedRef.current) {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
  }, [springPillToCurrentIndex, startAutoAdvance]);

  const handleDotPress = useCallback((idx: number) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    resumeFromLongPress(false);
    stopAutoAdvance();
    scrollWithWrapMask(idx);
    startAutoAdvance();
  }, [resumeFromLongPress, stopAutoAdvance, scrollWithWrapMask, startAutoAdvance]);

  /** Pixels of horizontal drag required to advance one slide in the dots row. */
  const DOT_SWIPE_STEP = 50;

  /** Shared values used inside the dots-row pan worklet (UI-thread only). */
  const dotPanStartIndex = useSharedValue(0);
  const dotPanLastIndex = useSharedValue(-1);

  /**
   * Called on the JS thread at the start of a dots-row pan gesture.
   * Permanently dismisses the hint so any swipe-like interaction on the dots
   * row — not just a FlatList drag — counts as "user knows how to swipe".
   */
  const handleDotPanBegin = useCallback(() => {
    if (!hasUserInteractedRef.current) {
      hasUserInteractedRef.current = true;
      dragHintShownForLocale = 'dismissed';
      AsyncStorage.setItem(DRAG_HINT_DISMISSED_KEY, '1').catch(() => {});
    }
  }, []);

  /** Called on the JS thread when the live index changes during a dots-row drag. */
  const handleDotPanUpdate = useCallback((newIdx: number) => {
    scrollToIndex(newIdx, false);
  }, [scrollToIndex]);

  /** Called on the JS thread when the dots-row drag is released. */
  const handleDotPanEnd = useCallback((newIdx: number) => {
    if (newIdx === currentIndexRef.current) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    resumeFromLongPress(false);
    stopAutoAdvance();
    scrollToIndex(newIdx, true);
    startAutoAdvance();
  }, [resumeFromLongPress, stopAutoAdvance, scrollToIndex, startAutoAdvance]);

  /**
   * Horizontal pan gesture for the dots row.
   *
   * Activates on horizontal movement > 10 pt and fails on significant vertical
   * movement so the parent scroll view is not blocked. During the drag the
   * active slide updates proportionally (one slide per DOT_SWIPE_STEP pt).
   * On release the carousel snaps to the nearest whole slide index and auto-
   * advance is restarted, matching the behaviour of a dot tap.
   */
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

  const handleBannerPress = useCallback((banner: Banner) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    if (banner.target_restaurant_id) {
      router.push(`/brand/${banner.target_restaurant_id}`);
    } else if (banner.target_product_id) {
      router.push(`/product/${banner.target_product_id}`);
    } else if (banner.target_car_model_id) {
      router.push(`/car/${banner.target_car_model_id}`);
    }
  }, [router]);

  const renderItem = useCallback(
    ({ item, index }: { item: Banner; index: number }) => {
      const nextIndex = (currentIndex + 1) % count;
      return (
        <Slide
          banner={item}
          index={index}
          scrollX={scrollX}
          onPress={handleBannerPress}
          onLongPressStart={handleLongPressStart}
          onLongPressRelease={handleLongPressRelease}
          onSwipeDismiss={handleSwipeDismiss}
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
      scrollX, handleBannerPress, handleLongPressStart, handleLongPressRelease,
      handleSwipeDismiss, language, isRTL, itemWidth, slideWidth, currentIndex, isPaused,
      progressKey, isAutoAdvanceRunning, isAdvancing, count, isSingle,
    ],
  );

  const keyExtractor = useCallback((item: Banner) => item.id, []);

  const getItemLayout = useCallback(
    (_data: ArrayLike<Banner> | null | undefined, index: number) => ({
      length: itemWidth,
      offset: sideInset + itemWidth * index,
      index,
    }),
    [itemWidth, sideInset],
  );

  if (isLoading) return <OfferSliderSkeleton />;
  if (count === 0) return null;

  return (
    <View style={styles.container}>
      <Animated.FlatList
        ref={animatedListRef}
        data={effectiveBanners}
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
        removeClippedSubviews={Platform.OS !== 'web'}
        contentContainerStyle={isWide ? { paddingHorizontal: sideInset } : undefined}
      />

      {!isSingle && (
        <GestureDetector gesture={dotsRowPanGesture}>
          <View style={styles.dotsRow}>
            <View style={styles.dotsRowInner}>
              <Animated.View style={[styles.dotsTrack, hintStyle]}>
                {effectiveBanners.map((_, i) => (
                  <Dot key={i} index={i} pillX={pillX} onPress={() => handleDotPress(i)} />
                ))}
                <SlidingPill pillX={pillX} pillOpacity={pillOpacity} count={count} isPaused={isPaused || isAdvancing} />
              </Animated.View>
              {/* Swipe-arrow hint icon — only mounted when hint is eligible for this
                  session so it takes no layout space for returning users.
                  Fades in with the nudge animation, fades out after ~2 s. */}
              {hintAllowed && (
                <Animated.View
                  style={[styles.hintIconWrapper, hintIconStyle]}
                  pointerEvents="none"
                >
                  <Ionicons name={isRTL ? 'chevron-back' : 'chevron-forward'} size={10} color={COLORS.goldSoft} />
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
  );
};

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
  /** Slim gold progress bar at the top of the active slide */
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

  /** Animated gold shimmer border overlay — positioned absolutely over the card */
  shimmerBorder: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: RADII.xl,
    borderWidth: 2,
    borderColor: COLORS.goldBright,
    zIndex: 10,
  },

  /**
   * Advancing shimmer sweep — a ~40% wide strip that travels left-to-right
   * across the incoming slide while the pill is mid-travel.  The outer view
   * is translated; the inner LinearGradient provides the soft gold sweep shape.
   * overflow:'hidden' on the parent slideCard clips the strip at the card edges.
   */
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
    ...StyleSheet.absoluteFillObject,
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

  /**
   * Paused pill — absolutely positioned top-center.
   * The Animated.View wrapper handles opacity; the inner View is the pill shape.
   */
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

  /** Glassmorphism card — pinned to bottom of slide */
  glassCard: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: SPACING.xl,
    paddingTop: SPACING.lg,
    paddingBottom: SPACING.xl,
    gap: SPACING.sm,
    backgroundColor: 'rgba(255,255,255,0.07)',
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,215,0,0.18)',
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

  /** CTA pill */
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

  /** Dot indicators — outer centering row */
  dotsRow: {
    alignItems: 'center',
    marginTop: SPACING.md,
    paddingVertical: SPACING.xs,
  },
  /** Flex row that holds the dotsTrack + swipe-hint icon side by side */
  dotsRowInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.xs,
  },
  /** Swipe-arrow icon: two chevrons rendered flush together to form a » shape */
  hintIconWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  /** Pulls the second chevron leftward so the pair reads as a tight double-arrow */
  hintIconSecondChevron: {
    marginLeft: -4,
  },
  /** Inner track: relative container so the sliding pill can be positioned absolutely. */
  dotsTrack: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.xs,
    position: 'relative',
  },
  /** Fixed-size dim circle — all dots look identical; the sliding pill provides the active indicator. */
  dot: {
    width: INDICATORS.dot.width,
    height: INDICATORS.dot.height,
    borderRadius: INDICATORS.dot.borderRadius,
    backgroundColor: OVERLAYS.ivoryDot,
  },
  /**
   * Outer shell — handles only the horizontal translation.  No background,
   * no shadow here; those live in the two inner layers below.
   */
  slidingPillOuter: {
    position: 'absolute',
    // Centre the pill on each dot: (dotW − pillW)/2 = (6−22)/2 = −8
    left: (INDICATORS.dot.width - PILL_W) / 2,
    // Centre vertically: (dotH − pillH)/2 = (6−7)/2 = −0.5
    top: (INDICATORS.dot.height - PILL_H) / 2,
    width: PILL_W,
    height: PILL_H,
    borderRadius: PILL_H / 2, // fully-rounded capsule
  },
  /**
   * Glow halo — gold shadow that breathes, giving the pill a living quality.
   * Wider shadow than before (8px web / 5pt native) to complement the larger pill.
   */
  slidingPillGlowHalo: {
    position: 'absolute',
    left: 0,
    top: 0,
    right: 0,
    bottom: 0,
    borderRadius: PILL_H / 2,
    backgroundColor: COLORS.gold,
    ...(Platform.OS === 'web'
      ? { boxShadow: `0px 0px 8px 2px rgba(200, 162, 74, 0.80)` }
      : {
          shadowColor: COLORS.gold,
          shadowOffset: { width: 0, height: 0 },
          shadowOpacity: 0.85,
          shadowRadius: 5,
          elevation: 5,
        }),
  },
  /**
   * Solid fill — always fully opaque; masks the halo so gold stays vivid
   * regardless of the breathing animation phase.
   */
  slidingPillFill: {
    position: 'absolute',
    left: 0,
    top: 0,
    right: 0,
    bottom: 0,
    borderRadius: PILL_H / 2,
    backgroundColor: COLORS.gold,
  },

  /** Loading skeleton */
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

export default OfferSliderCarousel;
