/**
 * CarouselControlsTooltip — Task #95
 *
 * First-run animated overlay that teaches users how to interact with the
 * home carousels (swipe, long-press pause, swipe-up dismiss, pause button).
 * Shown once per locale and permanently dismissed on "Got it!".
 *
 * Usage:
 *   <CarouselControlsTooltip
 *     visible={show}
 *     onDismiss={handleDismiss}
 *     isRTL={isRTL}
 *     language={language}
 *   />
 */
import React, { useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Modal,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withTiming,
  withSequence,
  withRepeat,
  withDelay,
} from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import {
  COLORS,
  OVERLAYS,
  RADII,
  SPACING,
  TYPE,
  FONTS,
} from '../../constants/luxuryTokens';

export const TOOLTIP_STORAGE_KEY = 'carousel_controls_tooltip_seen_v1';

interface CarouselControlsTooltipProps {
  visible: boolean;
  onDismiss: () => void;
  isRTL?: boolean;
  language?: string;
}

interface Tip {
  icon: string;
  labelEn: string;
  labelAr: string;
  descEn: string;
  descAr: string;
}

const TIPS: Tip[] = [
  {
    icon: 'swap-horizontal',
    labelEn: 'Swipe to browse',
    labelAr: 'اسحب للتصفح',
    descEn: 'Slide left or right to move between offers',
    descAr: 'اسحب يساراً أو يميناً للتنقل بين العروض',
  },
  {
    icon: 'hand-left',
    labelEn: 'Hold to pause',
    labelAr: 'اضغط للإيقاف',
    descEn: 'Long-press any slide to freeze auto-advance',
    descAr: 'اضغط مطولاً على الشريحة لإيقاف التنقل التلقائي',
  },
  {
    icon: 'chevron-up',
    labelEn: 'Swipe up to skip',
    labelAr: 'اسحب لأعلى للتخطي',
    descEn: 'Flick a slide upward to jump to the next',
    descAr: 'ارفع الشريحة لأعلى للانتقال إلى التالية',
  },
  {
    icon: 'pause-circle',
    labelEn: 'Pause button',
    labelAr: 'زر الإيقاف',
    descEn: 'Tap the corner icon to pause for 35 seconds',
    descAr: 'اضغط أيقونة الزاوية للإيقاف المؤقت 35 ثانية',
  },
];

function TipCard({
  tip,
  index,
  language,
  isRTL,
}: {
  tip: Tip;
  index: number;
  language: string;
  isRTL: boolean;
}) {
  const opacity = useSharedValue(0);
  const translateY = useSharedValue(18);
  const iconScale = useSharedValue(1);

  useEffect(() => {
    const delay = index * 80;
    opacity.value = withDelay(delay, withTiming(1, { duration: 340 }));
    translateY.value = withDelay(delay, withSpring(0, { damping: 17, stiffness: 210 }));
    iconScale.value = withDelay(
      delay + 420,
      withRepeat(
        withSequence(
          withSpring(1.28, { damping: 5, stiffness: 280 }),
          withSpring(1, { damping: 10, stiffness: 200 }),
          withTiming(1, { duration: 1400 }),
        ),
        -1,
        false,
      ),
    );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const cardAnimStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateY: translateY.value }],
  }));

  const iconAnimStyle = useAnimatedStyle(() => ({
    transform: [{ scale: iconScale.value }],
  }));

  return (
    <Animated.View style={[styles.tipCard, cardAnimStyle]}>
      <Animated.View style={[styles.tipIconWrap, iconAnimStyle]}>
        <Ionicons name={tip.icon as keyof typeof Ionicons.glyphMap} size={24} color={COLORS.gold} />
      </Animated.View>
      <View style={[styles.tipText, isRTL && styles.tipTextRTL]}>
        <Text style={[styles.tipLabel, isRTL && styles.textRight]}>
          {language === 'ar' ? tip.labelAr : tip.labelEn}
        </Text>
        <Text style={[styles.tipDesc, isRTL && styles.textRight]} numberOfLines={2}>
          {language === 'ar' ? tip.descAr : tip.descEn}
        </Text>
      </View>
    </Animated.View>
  );
}

export function CarouselControlsTooltip({
  visible,
  onDismiss,
  isRTL = false,
  language = 'en',
}: CarouselControlsTooltipProps) {
  const backdropOpacity = useSharedValue(0);
  const cardScale = useSharedValue(0.86);
  const cardOpacity = useSharedValue(0);
  const cardTranslateY = useSharedValue(40);

  useEffect(() => {
    if (visible) {
      backdropOpacity.value = withTiming(1, { duration: 300 });
      cardScale.value = withSpring(1, { damping: 20, stiffness: 230 });
      cardOpacity.value = withTiming(1, { duration: 280 });
      cardTranslateY.value = withSpring(0, { damping: 18, stiffness: 220 });
    } else {
      backdropOpacity.value = withTiming(0, { duration: 200 });
      cardScale.value = withTiming(0.92, { duration: 180 });
      cardOpacity.value = withTiming(0, { duration: 180 });
      cardTranslateY.value = withTiming(30, { duration: 180 });
    }
  }, [visible, backdropOpacity, cardScale, cardOpacity, cardTranslateY]);

  const backdropStyle = useAnimatedStyle(() => ({
    opacity: backdropOpacity.value,
  }));

  const cardStyle = useAnimatedStyle(() => ({
    transform: [{ scale: cardScale.value }, { translateY: cardTranslateY.value }],
    opacity: cardOpacity.value,
  }));

  if (!visible) return null;

  return (
    <Modal
      transparent
      animationType="none"
      visible={visible}
      onRequestClose={onDismiss}
      statusBarTranslucent
    >
      <Animated.View style={[styles.backdrop, backdropStyle]}>
        <TouchableOpacity
          style={StyleSheet.absoluteFillObject}
          activeOpacity={1}
          onPress={onDismiss}
        />

        <Animated.View style={[styles.card, cardStyle]}>
          {/* ── Header ── */}
          <LinearGradient
            colors={[COLORS.charcoal, COLORS.charcoalDeep]}
            style={styles.cardHeader}
          >
            <View style={[styles.headerRow, isRTL && styles.headerRowRTL]}>
              <LinearGradient
                colors={[COLORS.gold, COLORS.goldBright]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.goldBadge}
              >
                <Ionicons name="sparkles" size={12} color={COLORS.charcoalDeep} />
                <Text style={styles.goldBadgeText}>
                  {language === 'ar' ? 'دليل الاستخدام' : 'Quick Guide'}
                </Text>
              </LinearGradient>

              <TouchableOpacity onPress={onDismiss} hitSlop={14} style={styles.closeBtn}>
                <Ionicons name="close" size={20} color={OVERLAYS.ivoryDimSoft} />
              </TouchableOpacity>
            </View>

            <Text style={[styles.cardTitle, isRTL && styles.textRight]}>
              {language === 'ar' ? 'اكتشف المميزات' : 'Explore the carousels'}
            </Text>
            <Text style={[styles.cardSubtitle, isRTL && styles.textRight]}>
              {language === 'ar'
                ? 'إليك كل ما يمكنك فعله بعروضنا الحصرية'
                : 'Everything you can do with our exclusive offers'}
            </Text>
          </LinearGradient>

          {/* Gold divider */}
          <View style={styles.divider} />

          {/* ── Tips ── */}
          <View style={styles.tipsGrid}>
            {TIPS.map((tip, i) => (
              <TipCard
                key={tip.icon}
                tip={tip}
                index={i}
                language={language}
                isRTL={isRTL}
              />
            ))}
          </View>

          {/* ── CTA ── */}
          <View style={styles.ctaWrap}>
            <TouchableOpacity
              onPress={onDismiss}
              activeOpacity={0.85}
              style={styles.ctaOuter}
            >
              <LinearGradient
                colors={[COLORS.gold, COLORS.goldBright]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={styles.ctaGradient}
              >
                <Ionicons name="checkmark-circle" size={18} color={COLORS.charcoalDeep} />
                <Text style={styles.ctaText}>
                  {language === 'ar' ? 'فهمت، شكراً!' : "Got it, let's explore!"}
                </Text>
              </LinearGradient>
            </TouchableOpacity>
          </View>
        </Animated.View>
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(4,4,12,0.82)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: SPACING.xl,
  },
  card: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: '#13131A',
    borderRadius: RADII.xl,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(200,162,74,0.22)',
  },
  cardHeader: {
    paddingHorizontal: SPACING.xl,
    paddingTop: SPACING.lg,
    paddingBottom: SPACING.md,
    gap: SPACING.xs,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: SPACING.xs,
  },
  headerRowRTL: {
    flexDirection: 'row-reverse',
  },
  goldBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: RADII.pill,
  },
  goldBadgeText: {
    fontFamily: FONTS.body,
    fontSize: 11,
    fontWeight: '700',
    color: COLORS.charcoalDeep,
    letterSpacing: 0.5,
  },
  closeBtn: {
    padding: 4,
    borderRadius: RADII.pill,
  },
  cardTitle: {
    fontFamily: FONTS.display,
    fontSize: 20,
    fontWeight: '700',
    color: COLORS.ivory,
    letterSpacing: 0.3,
  },
  cardSubtitle: {
    fontFamily: FONTS.body,
    fontSize: 13,
    color: OVERLAYS.ivoryDimSoft,
    lineHeight: 18,
  },
  textRight: {
    textAlign: 'right',
  },
  divider: {
    height: 1,
    backgroundColor: 'rgba(200,162,74,0.18)',
  },
  tipsGrid: {
    padding: SPACING.lg,
    gap: SPACING.sm,
  },
  tipCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: SPACING.md,
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderRadius: RADII.md,
    padding: SPACING.md,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.07)',
  },
  tipIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(200,162,74,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(200,162,74,0.25)',
    flexShrink: 0,
  },
  tipText: {
    flex: 1,
    gap: 2,
  },
  tipTextRTL: {
    alignItems: 'flex-end',
  },
  tipLabel: {
    fontFamily: FONTS.body,
    fontSize: 14,
    fontWeight: '700',
    color: COLORS.ivory,
    letterSpacing: 0.2,
  },
  tipDesc: {
    fontFamily: FONTS.body,
    fontSize: 12,
    color: OVERLAYS.ivoryDimSoft,
    lineHeight: 17,
  },
  ctaWrap: {
    paddingHorizontal: SPACING.xl,
    paddingBottom: SPACING.xl,
  },
  ctaOuter: {
    borderRadius: RADII.pill,
    overflow: 'hidden',
  },
  ctaGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
    paddingHorizontal: SPACING.xl,
    borderRadius: RADII.pill,
  },
  ctaText: {
    fontFamily: FONTS.body,
    fontSize: 15,
    fontWeight: '700',
    color: COLORS.charcoalDeep,
    letterSpacing: 0.5,
  },
});
