// HomeHero — full-bleed parallax hero for the home screen.
// Uses standard react-native Animated (not reanimated) so the parallax
// shares the same scrollY Animated.Value the parent ScrollView feeds.
import React, { useMemo, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Animated,
  useWindowDimensions,
  TouchableOpacity,
  Easing,
} from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../services/api';
import { useTheme } from '../../hooks/useTheme';
import { useTranslation } from '../../hooks/useTranslation';
import {
  FONTS,
  TYPE,
  SPACING,
  RADII,
  ELEVATION,
  GRADIENTS,
  COLORS,
  OVERLAYS,
  TEXT_SHADOWS,
} from '../../constants/luxuryTokens';
import { LUXURY_MOTION } from '../../constants/animations';

const WIDE_BREAKPOINT = 480;

function computeHeroHeight(screenWidth: number): number {
  return Math.round(Math.min(560, Math.max(420, screenWidth * 1.15)));
}

const HERO_BACKDROPS = [
  'https://images.unsplash.com/photo-1414235077428-338989a2e8c0?auto=format&fit=crop&w=1400&q=80',
  'https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?auto=format&fit=crop&w=1400&q=80',
  'https://images.unsplash.com/photo-1467003909585-2f8a72700288?auto=format&fit=crop&w=1400&q=80',
];

interface HomeHeroProps {
  scrollY: Animated.Value;
  onCtaPress?: () => void;
  onExplorePress?: () => void;
}

const formatToday = (locale: string) => {
  try {
    const fmt = new Intl.DateTimeFormat(locale, {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
    });
    return fmt.format(new Date());
  } catch {
    return new Date().toDateString();
  }
};

export const HomeHero: React.FC<HomeHeroProps> = ({
  scrollY,
  onCtaPress,
  onExplorePress,
}) => {
  const { isDark } = useTheme();
  const { isRTL, language } = useTranslation();
  const { width: screenWidth } = useWindowDimensions();

  const heroHeight = useMemo(() => computeHeroHeight(screenWidth), [screenWidth]);
  const isWide = screenWidth > WIDE_BREAKPOINT;

  const imageTranslateY = scrollY.interpolate({
    inputRange: [-heroHeight, 0, heroHeight],
    outputRange: [-heroHeight * 0.35, 0, heroHeight * 0.4],
    extrapolate: 'clamp',
  });
  const imageScale = scrollY.interpolate({
    inputRange: [-heroHeight, 0, heroHeight],
    outputRange: [1.35, 1.05, 1.05],
    extrapolate: 'clamp',
  });
  const contentTranslateY = scrollY.interpolate({
    inputRange: [0, heroHeight],
    outputRange: [0, heroHeight * 0.25],
    extrapolate: 'clamp',
  });
  const contentOpacity = scrollY.interpolate({
    inputRange: [0, heroHeight * 0.7, heroHeight],
    outputRange: [1, 0.35, 0],
    extrapolate: 'clamp',
  });

  const { data: heroData } = useQuery({
    queryKey: ['heroBackdrops'],
    queryFn: async () => {
      const res = await api.get('/promotions', { params: { promotion_type: 'hero', active_only: true } });
      return res.data as any[];
    },
    staleTime: 5 * 60 * 1000,
  });

  const { data: heroConfigData } = useQuery({
    queryKey: ['heroConfig'],
    queryFn: async () => {
      try {
        const res = await api.get('/admin/settings/hero_content');
        return res.data?.value as Record<string, string> | null;
      } catch {
        return null;
      }
    },
    staleTime: 5 * 60 * 1000,
    retry: false,
  });

  const indexAnim = useRef(new Animated.Value(0)).current;
  const backdrops = useMemo(() => {
    const dynamic = (heroData || []).filter((p: any) => p.image).map((p: any) => p.image as string);
    return dynamic.length > 0 ? dynamic : HERO_BACKDROPS;
  }, [heroData]);

  useEffect(() => {
    if (backdrops.length <= 1) return;
    const total = backdrops.length;
    const step = LUXURY_MOTION.curtainReveal.duration * 12;
    // LUXURY_MOTION easings are reanimated worklet factories; rebuild
    // the same decel curve with RN's Easing for std Animated.timing.
    const decel = Easing.bezier(0, 0, 0, 1);
    const animation = Animated.loop(
      Animated.sequence(
        backdrops.map((_, i) =>
          Animated.timing(indexAnim, {
            toValue: i,
            duration: i === 0 ? 0 : step,
            easing: decel,
            useNativeDriver: true,
          }),
        ).concat(
          backdrops.length > 1
            ? [Animated.timing(indexAnim, {
                toValue: total,
                duration: step,
                easing: decel,
                useNativeDriver: true,
              })]
            : [],
        ),
      ),
    );
    animation.start();
    return () => animation.stop();
  }, [backdrops, indexAnim]);

  const overlayColors = isDark
    ? ([OVERLAYS.curtainTop, OVERLAYS.scrimDeep, OVERLAYS.curtainBaseStrong] as const)
    : ([OVERLAYS.curtainTop, OVERLAYS.curtainMid, OVERLAYS.curtainBase] as const);

  const cfg = heroConfigData || {};
  const eyebrowText =
    language === 'ar'
      ? (cfg.eyebrow_ar || 'اليوم في الغزالي')
      : (cfg.eyebrow_en || 'TONIGHT AT AL-GHAZALY');
  const headlineText =
    language === 'ar'
      ? (cfg.headline_ar || 'مائدة مضاءة بالشموع')
      : (cfg.headline_en || 'A candle-lit table awaits');
  const subText =
    language === 'ar'
      ? (cfg.subline_ar || 'وصفات الشيف لهذا المساء، من المطبخ إلى مائدتكم.')
      : (cfg.subline_en || "Tonight's chef-curated tasting, from the kitchen to your table.");
  const primaryCta =
    language === 'ar'
      ? (cfg.cta_primary_ar || 'احجز طاولة')
      : (cfg.cta_primary_en || 'Reserve a Table');
  const primaryCtaIcon = (cfg.cta_primary_icon || 'restaurant') as any;
  const secondaryCta =
    language === 'ar'
      ? (cfg.cta_secondary_ar || 'اكتشف القائمة')
      : (cfg.cta_secondary_en || 'Explore the menu');

  const dateLabel = formatToday(language === 'ar' ? 'ar-EG' : 'en-US');

  return (
    <View style={[styles.heroWrapper, { height: heroHeight }]}>
      <Animated.View
        style={[
          StyleSheet.absoluteFillObject,
          {
            transform: [
              { translateY: imageTranslateY },
              { scale: imageScale },
            ],
          },
        ]}
      >
        {backdrops.map((uri, i) => {
          const multiImage = backdrops.length > 1;
          const opacity = indexAnim.interpolate({
            inputRange: [
              i - 1,
              i,
              i + 1,
              ...(i === 0 && multiImage ? [backdrops.length - 1, backdrops.length] : []),
            ],
            outputRange: [
              0,
              1,
              0,
              ...(i === 0 && multiImage ? [0, 1] : []),
            ],
            extrapolate: 'clamp',
          });
          const innerScale = indexAnim.interpolate({
            inputRange: [i - 1, i, i + 1],
            outputRange: [1.05, 1.18, 1.32],
            extrapolate: 'clamp',
          });
          return (
            <Animated.View
              key={uri}
              style={[
                StyleSheet.absoluteFillObject,
                { opacity, transform: [{ scale: innerScale }] },
              ]}
            >
              <Image
                source={{ uri }}
                style={StyleSheet.absoluteFillObject}
                contentFit="cover"
                cachePolicy="memory-disk"
                transition={400}
              />
            </Animated.View>
          );
        })}
      </Animated.View>

      <LinearGradient
        colors={GRADIENTS.midnightBistro}
        start={{ x: 0, y: 0 }}
        end={{ x: 0, y: 1 }}
        style={[StyleSheet.absoluteFillObject, { opacity: isDark ? 0.01 : 0.01 }]}
      />
      <LinearGradient
        colors={overlayColors}
        start={{ x: 0, y: 0 }}
        end={{ x: 0, y: 1 }}
        style={StyleSheet.absoluteFillObject}
      />

      <Animated.View
        style={[
          styles.contentLayer,
          {
            paddingHorizontal: isWide ? SPACING.xxl * 2 : SPACING.xl,
            opacity: contentOpacity,
            transform: [{ translateY: contentTranslateY }],
          },
        ]}
      >
        <View style={[styles.content, isRTL && styles.contentRTL]}>
          <View
            style={[
              styles.dateBadge,
              { borderColor: OVERLAYS.goldHairline },
            ]}
          >
            <Ionicons name="moon" size={12} color={COLORS.goldSoft} />
            <Text style={styles.dateBadgeText}>{dateLabel}</Text>
          </View>

          <Text
            style={[styles.eyebrow, isRTL && styles.textRTL]}
            numberOfLines={1}
          >
            {eyebrowText}
          </Text>

          <Text
            style={[styles.headline, isRTL && styles.textRTL]}
            numberOfLines={3}
          >
            {headlineText}
          </Text>

          <Text
            style={[
              styles.subline,
              isRTL && styles.textRTL,
              { maxWidth: Math.round(Math.min(560, screenWidth * 0.72)) },
            ]}
            numberOfLines={3}
          >
            {subText}
          </Text>

          <View
            style={[
              styles.ctaRow,
              { flexDirection: isRTL ? 'row-reverse' : 'row' },
            ]}
          >
            <TouchableOpacity
              activeOpacity={0.85}
              onPress={onCtaPress}
              style={styles.primaryCta}
              accessibilityRole="button"
              accessibilityLabel={primaryCta}
            >
              <LinearGradient
                colors={GRADIENTS.goldShimmer}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.primaryCtaGradient}
              >
                <Ionicons name={primaryCtaIcon} size={15} color={COLORS.charcoal} />
                <Text style={styles.primaryCtaText}>{primaryCta}</Text>
              </LinearGradient>
            </TouchableOpacity>

            <TouchableOpacity
              activeOpacity={0.7}
              onPress={onExplorePress}
              style={styles.secondaryCta}
              accessibilityRole="button"
              accessibilityLabel={secondaryCta}
            >
              <Text style={styles.secondaryCtaText}>{secondaryCta}</Text>
              <Ionicons
                name={isRTL ? 'arrow-back' : 'arrow-forward'}
                size={14}
                color={COLORS.ivory}
              />
            </TouchableOpacity>
          </View>
        </View>
      </Animated.View>
    </View>
  );
};

const styles = StyleSheet.create({
  heroWrapper: {
    width: '100%',
    overflow: 'hidden',
    backgroundColor: COLORS.charcoalDeep,
  },
  contentLayer: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'flex-end',
    paddingBottom: SPACING.cinematic,
  },
  content: {
    alignItems: 'flex-start',
  },
  contentRTL: {
    alignItems: 'flex-end',
  },
  dateBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.xs,
    paddingHorizontal: SPACING.sm,
    paddingVertical: SPACING.xxs + 2,
    borderRadius: RADII.pill,
    borderWidth: StyleSheet.hairlineWidth * 2,
    backgroundColor: OVERLAYS.scrim,
    marginBottom: SPACING.md,
  },
  dateBadgeText: {
    ...TYPE.badgeCaption,
    color: COLORS.goldSoft,
  },
  eyebrow: {
    ...TYPE.sectionLabel,
    color: COLORS.goldSoft,
    marginBottom: SPACING.sm,
  },
  headline: {
    ...TYPE.hero,
    fontFamily: FONTS.display,
    color: COLORS.ivory,
    marginBottom: SPACING.md,
    ...TEXT_SHADOWS.hero,
  },
  subline: {
    ...TYPE.bodyLarge,
    color: OVERLAYS.ivoryDim,
    marginBottom: SPACING.xl,
  },
  textRTL: {
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  ctaRow: {
    alignItems: 'center',
    gap: SPACING.md,
    flexWrap: 'wrap',
  },
  primaryCta: {
    borderRadius: RADII.pill,
    overflow: 'hidden',
    ...ELEVATION.goldGlow,
  },
  primaryCtaGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    paddingHorizontal: SPACING.xl,
    paddingVertical: SPACING.md,
    borderRadius: RADII.pill,
  },
  primaryCtaText: {
    ...TYPE.heroButton,
    color: COLORS.charcoal,
  },
  secondaryCta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    paddingVertical: SPACING.sm,
    paddingHorizontal: SPACING.md,
  },
  secondaryCtaText: {
    ...TYPE.spacedButton,
    color: COLORS.ivory,
  },
});

export default HomeHero;
