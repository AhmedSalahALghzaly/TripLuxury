/**
 * Enhanced Skeleton Loading Component
 * Color mood-aware with gradient shimmer effects
 * Production-ready with multiple variants
 */
import React, { useEffect, useMemo } from 'react';
import { View, StyleSheet, Dimensions } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
  interpolate,
  Extrapolation,
} from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import { useColorMood } from '../../store/appStore';
import { useTheme } from '../../hooks/useTheme';
import { DURATIONS, EASINGS } from '../../constants/animations';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

interface SkeletonProps {
  width?: number | string;
  height?: number;
  borderRadius?: number;
  style?: any;
  variant?: 'default' | 'circular' | 'rectangular' | 'text';
  animation?: 'shimmer' | 'pulse' | 'wave';
  moodAware?: boolean;
}

export const Skeleton: React.FC<SkeletonProps> = ({
  width = '100%',
  height = 20,
  borderRadius = 4,
  style,
  variant = 'default',
  animation = 'shimmer',
  moodAware = true,
}) => {
  const mood = useColorMood();
  const { isDark } = useTheme();

  // Animation values
  const shimmerTranslate = useSharedValue(-SCREEN_WIDTH);
  const pulseOpacity = useSharedValue(0.3);

  // Get variant-specific border radius
  const variantRadius = useMemo(() => {
    switch (variant) {
      case 'circular':
        return typeof height === 'number' ? height / 2 : 50;
      case 'rectangular':
        return 0;
      case 'text':
        return 4;
      default:
        return borderRadius;
    }
  }, [variant, height, borderRadius]);

  // Get mood-aware colors
  const colors = useMemo(() => {
    if (!moodAware) {
      return isDark
        ? { base: '#374151', highlight: '#4B5563' }
        : { base: '#E5E7EB', highlight: '#F3F4F6' };
    }

    const primary = mood?.primary || '#3B82F6';
    const baseOpacity = isDark ? 0.15 : 0.08;
    const highlightOpacity = isDark ? 0.25 : 0.15;

    return {
      base: isDark ? '#374151' : '#E5E7EB',
      highlight: isDark ? '#4B5563' : '#F3F4F6',
      accent: `${primary}${Math.round(baseOpacity * 255).toString(16).padStart(2, '0')}`,
      accentHighlight: `${primary}${Math.round(highlightOpacity * 255).toString(16).padStart(2, '0')}`,
    };
  }, [mood, moodAware, isDark]);

  // Start shimmer animation
  useEffect(() => {
    if (animation === 'shimmer') {
      shimmerTranslate.value = withRepeat(
        withTiming(SCREEN_WIDTH * 2, {
          duration: DURATIONS.shimmer,
          easing: EASINGS.linear,
        }),
        -1,
        false
      );
    } else if (animation === 'pulse') {
      pulseOpacity.value = withRepeat(
        withTiming(0.8, {
          duration: DURATIONS.shimmerFast,
          easing: EASINGS.easeInOut,
        }),
        -1,
        true
      );
    }
  }, [animation]);

  // Shimmer animated style
  const shimmerStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: shimmerTranslate.value }],
  }));

  // Pulse animated style
  const pulseStyle = useAnimatedStyle(() => ({
    opacity: pulseOpacity.value,
  }));

  const containerStyle = useMemo(
    () => ({
      width,
      height,
      borderRadius: variantRadius,
      backgroundColor: moodAware ? colors.accent : colors.base,
      overflow: 'hidden' as const,
    }),
    [width, height, variantRadius, colors, moodAware]
  );

  if (animation === 'pulse') {
    return (
      <Animated.View style={[containerStyle, pulseStyle, style]} />
    );
  }

  return (
    <View style={[containerStyle, style]}>
      <Animated.View style={[styles.shimmerContainer, shimmerStyle]}>
        <LinearGradient
          colors={[
            'transparent',
            moodAware ? colors.accentHighlight || colors.highlight : colors.highlight,
            'transparent',
          ]}
          start={{ x: 0, y: 0.5 }}
          end={{ x: 1, y: 0.5 }}
          style={styles.shimmerGradient}
        />
      </Animated.View>
    </View>
  );
};

// ============================================
// PRESET SKELETON COMPONENTS
// ============================================

export const ProductCardSkeleton: React.FC<{ moodAware?: boolean }> = ({ moodAware = true }) => {
  const mood = useColorMood();
  const cardBg = moodAware ? `${mood?.primary || '#3B82F6'}05` : '#FFF';

  return (
    <View style={[styles.productCard, { backgroundColor: cardBg }]}>
      <Skeleton height={120} borderRadius={8} moodAware={moodAware} />
      <View style={styles.productContent}>
        <Skeleton width="80%" height={16} style={styles.mb8} moodAware={moodAware} />
        <Skeleton width="50%" height={14} style={styles.mb8} moodAware={moodAware} />
        <View style={styles.productFooter}>
          <Skeleton width={28} height={28} variant="circular" moodAware={moodAware} />
          <Skeleton width="30%" height={18} moodAware={moodAware} />
          <Skeleton width={28} height={28} variant="circular" moodAware={moodAware} />
        </View>
      </View>
    </View>
  );
};

export const CategoryCardSkeleton: React.FC<{ moodAware?: boolean }> = ({ moodAware = true }) => {
  return (
    <View style={styles.categoryCard}>
      <Skeleton width={70} height={70} variant="circular" moodAware={moodAware} />
      <Skeleton width={80} height={14} style={styles.mt8} moodAware={moodAware} />
    </View>
  );
};

export const ListItemSkeleton: React.FC<{ moodAware?: boolean }> = ({ moodAware = true }) => {
  return (
    <View style={styles.listItem}>
      <Skeleton width={50} height={50} variant="circular" moodAware={moodAware} />
      <View style={styles.listContent}>
        <Skeleton width="70%" height={16} style={styles.mb8} moodAware={moodAware} />
        <Skeleton width="40%" height={12} moodAware={moodAware} />
      </View>
    </View>
  );
};

export const DashboardCardSkeleton: React.FC<{ moodAware?: boolean }> = ({ moodAware = true }) => {
  const mood = useColorMood();
  const cardBg = moodAware ? `${mood?.primary || '#3B82F6'}08` : '#FFF';

  return (
    <View style={[styles.dashboardCard, { backgroundColor: cardBg }]}>
      <View style={styles.dashboardHeader}>
        <Skeleton width={40} height={40} variant="circular" moodAware={moodAware} />
        <View style={styles.dashboardHeaderText}>
          <Skeleton width="60%" height={14} style={styles.mb8} moodAware={moodAware} />
          <Skeleton width="40%" height={24} moodAware={moodAware} />
        </View>
      </View>
      <Skeleton width="100%" height={4} borderRadius={2} style={styles.mt12} moodAware={moodAware} />
    </View>
  );
};

export const CarBrandSkeleton: React.FC<{ moodAware?: boolean }> = ({ moodAware = true }) => {
  return (
    <View style={styles.brandCard}>
      <Skeleton width={50} height={50} variant="circular" style={styles.mb8} moodAware={moodAware} />
      <Skeleton width={60} height={12} moodAware={moodAware} />
      <Skeleton width={40} height={10} style={styles.mt4} moodAware={moodAware} />
    </View>
  );
};

export const OfferSliderSkeleton: React.FC<{ moodAware?: boolean }> = ({ moodAware = true }) => {
  return (
    <View style={styles.offerSlider}>
      <Skeleton width="100%" height={160} borderRadius={16} moodAware={moodAware} />
      <View style={styles.offerDots}>
        {[1, 2, 3].map((i) => (
          <Skeleton key={i} width={8} height={8} variant="circular" moodAware={moodAware} />
        ))}
      </View>
    </View>
  );
};

export const SearchResultSkeleton: React.FC<{ moodAware?: boolean }> = ({ moodAware = true }) => {
  return (
    <View style={styles.searchResult}>
      <Skeleton width={50} height={50} borderRadius={10} moodAware={moodAware} />
      <View style={styles.searchResultContent}>
        <Skeleton width="70%" height={16} style={styles.mb8} moodAware={moodAware} />
        <View style={styles.searchResultMeta}>
          <Skeleton width="30%" height={12} moodAware={moodAware} />
          <Skeleton width="25%" height={14} moodAware={moodAware} />
        </View>
      </View>
      <Skeleton width={20} height={20} variant="circular" moodAware={moodAware} />
    </View>
  );
};

export const OrderCardSkeleton: React.FC<{ moodAware?: boolean }> = ({ moodAware = true }) => {
  const mood = useColorMood();
  const cardBg = moodAware ? `${mood?.primary || '#3B82F6'}05` : '#FFF';

  return (
    <View style={[styles.orderCard, { backgroundColor: cardBg }]}>
      <View style={styles.orderHeader}>
        <View>
          <Skeleton width={100} height={12} style={styles.mb4} moodAware={moodAware} />
          <Skeleton width={80} height={10} moodAware={moodAware} />
        </View>
        <Skeleton width={70} height={24} borderRadius={12} moodAware={moodAware} />
      </View>
      <View style={styles.orderDivider}>
        <Skeleton width="100%" height={1} moodAware={moodAware} />
      </View>
      <View style={styles.orderItems}>
        <Skeleton width="60%" height={14} style={styles.mb8} moodAware={moodAware} />
        <Skeleton width="50%" height={14} moodAware={moodAware} />
      </View>
      <View style={styles.orderFooter}>
        <Skeleton width={50} height={12} moodAware={moodAware} />
        <Skeleton width={80} height={18} moodAware={moodAware} />
      </View>
    </View>
  );
};

// Full page skeleton
export const PageSkeleton: React.FC<{ variant?: 'home' | 'product' | 'list' }> = ({ 
  variant = 'home' 
}) => {
  if (variant === 'home') {
    return (
      <View style={styles.pageSkeleton}>
        {/* Car Brands */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Skeleton width={120} height={20} />
            <Skeleton width={60} height={16} />
          </View>
          <View style={styles.horizontalScroll}>
            {[1, 2, 3, 4].map((i) => (
              <CarBrandSkeleton key={i} />
            ))}
          </View>
        </View>

        {/* Offer Slider */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Skeleton width={140} height={20} />
          </View>
          <OfferSliderSkeleton />
        </View>

        {/* Categories */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Skeleton width={100} height={20} />
            <Skeleton width={60} height={16} />
          </View>
          <View style={styles.horizontalScroll}>
            {[1, 2, 3, 4].map((i) => (
              <CategoryCardSkeleton key={i} />
            ))}
          </View>
        </View>

        {/* Products */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Skeleton width={80} height={20} />
            <Skeleton width={60} height={16} />
          </View>
          <View style={styles.horizontalScroll}>
            {[1, 2, 3].map((i) => (
              <ProductCardSkeleton key={i} />
            ))}
          </View>
        </View>
      </View>
    );
  }

  if (variant === 'product') {
    return (
      <View style={styles.pageSkeleton}>
        <Skeleton width="100%" height={280} />
        <View style={styles.productDetailContent}>
          <View style={styles.thumbnailRow}>
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} width={60} height={60} borderRadius={8} />
            ))}
          </View>
          <Skeleton width={80} height={24} borderRadius={12} style={styles.mt16} />
          <Skeleton width="90%" height={28} style={styles.mt12} />
          <Skeleton width="50%" height={16} style={styles.mt8} />
          <Skeleton width={120} height={32} style={styles.mt16} />
          <Skeleton width="100%" height={80} style={styles.mt24} />
        </View>
      </View>
    );
  }

  // List variant
  return (
    <View style={styles.pageSkeleton}>
      {[1, 2, 3, 4, 5].map((i) => (
        <ListItemSkeleton key={i} />
      ))}
    </View>
  );
};

const styles = StyleSheet.create({
  shimmerContainer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    width: SCREEN_WIDTH,
  },
  shimmerGradient: {
    flex: 1,
    width: SCREEN_WIDTH,
  },
  // Product Card
  productCard: {
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
    width: 160,
    marginHorizontal: 6,
  },
  productContent: {
    marginTop: 12,
  },
  productFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 8,
  },
  // Category Card
  categoryCard: {
    alignItems: 'center',
    padding: 16,
    marginHorizontal: 6,
  },
  // List Item
  listItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    backgroundColor: '#fff',
    borderRadius: 8,
    marginBottom: 8,
  },
  listContent: {
    flex: 1,
    marginLeft: 12,
  },
  // Dashboard Card
  dashboardCard: {
    borderRadius: 16,
    padding: 16,
    flex: 1,
    margin: 6,
    minHeight: 100,
  },
  dashboardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  dashboardHeaderText: {
    flex: 1,
    marginLeft: 12,
  },
  // Brand Card
  brandCard: {
    width: 100,
    height: 100,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginHorizontal: 6,
    backgroundColor: '#FFF',
  },
  // Offer Slider
  offerSlider: {
    marginHorizontal: 16,
  },
  offerDots: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 6,
    marginTop: 12,
  },
  // Search Result
  searchResult: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    gap: 12,
  },
  searchResultContent: {
    flex: 1,
  },
  searchResultMeta: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  // Order Card
  orderCard: {
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
  },
  orderHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  orderDivider: {
    marginVertical: 12,
  },
  orderItems: {
    marginBottom: 12,
  },
  orderFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  // Page Skeleton
  pageSkeleton: {
    flex: 1,
    paddingTop: 8,
  },
  section: {
    marginTop: 16,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    marginBottom: 12,
  },
  horizontalScroll: {
    flexDirection: 'row',
    paddingHorizontal: 16,
  },
  productDetailContent: {
    padding: 20,
  },
  thumbnailRow: {
    flexDirection: 'row',
    gap: 10,
  },
  // Spacing utilities
  mb4: { marginBottom: 4 },
  mb8: { marginBottom: 8 },
  mt4: { marginTop: 4 },
  mt8: { marginTop: 8 },
  mt12: { marginTop: 12 },
  mt16: { marginTop: 16 },
  mt24: { marginTop: 24 },
});

export default Skeleton;
