/**
 * FavoritesTab — Professional responsive grid for saved dishes.
 * Cards adapt automatically to screen width (min 2 cols, +1 col every ~130 px of extra space).
 * Cards are 5 % smaller than the available slot so subtle gutters are visible on all densities.
 */
import React, { useCallback, useEffect, useMemo } from 'react';
import {
  View, Text, StyleSheet, Pressable, Image,
  RefreshControl, useWindowDimensions,
} from 'react-native';
import Animated, { useSharedValue, useAnimatedStyle, withTiming } from 'react-native-reanimated';
import { FlashList } from '@shopify/flash-list';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { EmptyState } from '../ui/EmptyState';
import { Skeleton } from '../ui/Skeleton';
import { useTheme } from '../../hooks/useTheme';
import { useTranslation } from '../../hooks/useTranslation';
import { NEON_NIGHT_THEME } from '../../store/appStore';
import { TYPE, COLORS, RADII } from '../../constants/luxuryTokens';
import type { Favorite, FavoriteProduct, FavoriteRef } from '../../hooks/shopping/types';

const CARD_PADDING = 16;
const COL_GAP = 10;
const MIN_COL_WIDTH = 130;
const CARD_SCALE = 0.95; // 5 % smaller than the available slot

function useGridMetrics() {
  const { width: screenW } = useWindowDimensions();
  return useMemo(() => {
    const numCols = Math.max(
      2,
      Math.floor((screenW - 2 * CARD_PADDING + COL_GAP) / (MIN_COL_WIDTH + COL_GAP)),
    );
    const cardW =
      ((screenW - 2 * CARD_PADDING - (numCols - 1) * COL_GAP) / numCols) * CARD_SCALE;
    const imgH = cardW * 0.85;
    return { numCols, cardW, imgH };
  }, [screenW]);
}

interface FavoritesTabProps {
  favorites: Favorite[];
  isRTL: boolean;
  isAdminView: boolean;
  onAddToCart: (product: FavoriteProduct) => void;
  onToggleFavorite: (productId: string) => void;
  onRefresh?: () => void;
  refreshing?: boolean;
  isInitialLoading?: boolean;
}

const FavoriteCardSkeleton: React.FC<{ bg: string; border: string; cardW: number; imgH: number }> = ({
  bg, border, cardW, imgH,
}) => (
  <View style={[skeletonStyle.card, { backgroundColor: bg, borderColor: border, width: cardW, marginHorizontal: COL_GAP / 2 }]}>
    <Skeleton width="100%" height={imgH} borderRadius={12} moodAware={false} />
    <View style={skeletonStyle.body}>
      <Skeleton width="90%" height={14} borderRadius={6} moodAware={false} />
      <View style={{ height: 6 }} />
      <Skeleton width="60%" height={14} borderRadius={6} moodAware={false} />
      <View style={{ height: 8 }} />
      <Skeleton width="80%" height={36} borderRadius={10} moodAware={false} />
    </View>
  </View>
);

const skeletonStyle = StyleSheet.create({
  card: { borderRadius: 16, borderWidth: 1, marginBottom: 14, overflow: 'hidden' },
  body: { padding: 10, gap: 5 },
});

export const FavoritesTab: React.FC<FavoritesTabProps> = ({
  favorites,
  isRTL,
  isAdminView,
  onAddToCart,
  onToggleFavorite,
  onRefresh,
  refreshing = false,
  isInitialLoading = false,
}) => {
  const { colors } = useTheme();
  const { language } = useTranslation();
  const router = useRouter();
  const { numCols, cardW, imgH } = useGridMetrics();

  const safeFavorites = useMemo(() =>
    Array.isArray(favorites) ? favorites : [],
    [favorites]
  );

  const renderFavoriteItem = useCallback(({ item }: { item: Favorite }) => {
    const product = item.product || {};
    const productId = item.product_id || product.id;
    const price = parseFloat(String(item.price || product.price || 0)) || 0;
    const originalPriceNum = parseFloat(String(product.original_price ?? product.originalPrice ?? 0)) || 0;
    const hasDiscount = originalPriceNum > price && originalPriceNum > 0;
    const brandName = item.product_brand_name || product.product_brand_name;
    const categoryName = language === 'ar'
      ? (item.category_name_ar || product.category_name_ar)
      : (item.category_name_en || product.category_name_en);
    const stock = (item.stock_quantity ?? product.stock_quantity) != null
      ? Number(item.stock_quantity ?? product.stock_quantity) : null;
    const stockColor = stock === null ? null
      : stock === 0 ? '#EF4444'
      : stock < 10 ? '#F59E0B'
      : '#10B981';
    const imgUri = item.images?.[0] || item.image_url
      || product.images?.[0] || product.image_url;
    const displayName = language === 'ar'
      ? (item.name_ar || product.name_ar || item.name || product.name)
      : (item.name || product.name || item.name_ar || product.name_ar);

    return (
      <Pressable
        style={[
          styles.card,
          {
            backgroundColor: colors.card,
            borderColor: colors.border,
            width: cardW,
            marginHorizontal: COL_GAP / 2,
          },
        ]}
        onPress={() => router.push(`/product/${productId}`)}
      >
        {/* ── Image ── */}
        <View style={[styles.imgWrap, { height: imgH }]}>
          {imgUri ? (
            <Image source={{ uri: imgUri }} style={styles.img} resizeMode="cover" />
          ) : (
            <View style={[styles.imgPlaceholder, { backgroundColor: colors.surface }]}>
              <Ionicons name="fast-food-outline" size={36} color={colors.textSecondary} />
            </View>
          )}

          {/* ── Overlay badges ── */}
          <View style={styles.imgOverlayTop}>
            {categoryName ? (
              <View style={styles.catBadge}>
                <Text style={styles.catBadgeText} numberOfLines={1}>{categoryName}</Text>
              </View>
            ) : null}
          </View>

          {stock !== null && (
            <View style={[styles.stockBadge, { backgroundColor: stockColor! }]}>
              <Text style={styles.stockBadgeText}>{stock}</Text>
            </View>
          )}

          {hasDiscount && (
            <View style={styles.discountBadge}>
              <Text style={styles.discountText}>
                -{Math.round(((originalPriceNum - price) / originalPriceNum) * 100)}%
              </Text>
            </View>
          )}
        </View>

        {/* ── Card body ── */}
        <View style={styles.cardBody}>
          {/* Product Name */}
          <Text
            style={[styles.productName, { color: colors.text }, isRTL && styles.textRTL]}
            numberOfLines={2}
          >
            {displayName}
          </Text>

          {/* Chef brand (non-tappable display only) */}
          {brandName ? (
            <View style={[styles.brandRow, isRTL && styles.rowReverse]}>
              <Ionicons name="ribbon-outline" size={11} color={COLORS.goldBright} />
              <Text style={[styles.brandText, isRTL && styles.textRTL]} numberOfLines={1}>
                {brandName}
              </Text>
            </View>
          ) : null}

          {/* Restaurant name pills — tappable, navigate to /car/[restaurantId] */}
          {(() => {
            const carModels: FavoriteRef[] =
              item.compatible_car_models || product.compatible_car_models || [];
            if (carModels.length === 0) return null;
            const pairs = carModels.slice(0, 3).map((m) => ({
              id: m.id,
              name: (language === 'ar' && m.name_ar) ? m.name_ar : (m.name || ''),
            })).filter((p) => p.name);
            if (pairs.length === 0) return null;
            return (
              <View style={[styles.restaurantPillRow, isRTL && styles.restaurantPillRowRTL]}>
                <Ionicons name="restaurant-outline" size={11} color={COLORS.goldBright} style={{ marginTop: 1 }} />
                {pairs.slice(0, 2).map(({ id: rid, name }) => (
                  <Pressable
                    key={rid}
                    style={styles.restaurantPill}
                    onPress={(e) => { e.stopPropagation?.(); router.push(`/car/${rid}`); }}
                    hitSlop={6}
                  >
                    <Text style={styles.restaurantPillText} numberOfLines={1}>{name}</Text>
                  </Pressable>
                ))}
                {pairs.length > 2 && (
                  <View style={styles.restaurantPillMore}>
                    <Text style={styles.restaurantPillMoreText}>{`+${pairs.length - 2}`}</Text>
                  </View>
                )}
              </View>
            );
          })()}

          {/* Price row */}
          <View style={[styles.priceRow, isRTL && styles.rowReverse]}>
            <Text style={styles.price}>{price.toFixed(0)}<Text style={styles.priceCurrency}> ج.م</Text></Text>
            {hasDiscount ? (
              <Text style={[styles.originalPrice, { color: colors.textSecondary }]}>
                {originalPriceNum.toFixed(0)}
              </Text>
            ) : null}
          </View>

          {/* Actions */}
          <View style={[styles.actionsRow, isRTL && styles.rowReverse]}>
            <Pressable
              style={[styles.orderBtn, { flex: 1 }]}
              onPress={() => onAddToCart(item.product)}
            >
              <Ionicons name="add" size={15} color={COLORS.charcoalDeep} />
              <Text style={styles.orderBtnText}>
                {language === 'ar' ? 'للطلب' : 'Order'}
              </Text>
            </Pressable>
            {!isAdminView && (
              <Pressable
                style={styles.removeBtn}
                onPress={() => onToggleFavorite(productId)}
              >
                <Ionicons name="heart-dislike-outline" size={16} color="#EF4444" />
              </Pressable>
            )}
          </View>
        </View>
      </Pressable>
    );
  }, [colors, language, router, isAdminView, isRTL, onAddToCart, onToggleFavorite, cardW, imgH]);

  const ListHeaderComponent = useCallback(() => (
    <View style={[styles.header, isRTL && styles.rowReverse]}>
      <View>
        <Text style={[styles.kicker, { color: COLORS.goldBright }]}>
          {language === 'ar' ? 'مفضلتك' : 'A Curated Menu'}
        </Text>
        <Text style={[styles.sectionTitle, { color: colors.text }]}>
          {language === 'ar' ? 'الأطباق المحفوظة' : 'Saved Dishes'}
        </Text>
        <View style={styles.goldRule} />
      </View>
      <View style={[styles.countBadge, { backgroundColor: COLORS.gold }]}>
        <Text style={[styles.countBadgeText, { color: COLORS.charcoalDeep }]}>
          {safeFavorites.length}
        </Text>
      </View>
    </View>
  ), [colors, language, isRTL, safeFavorites.length]);

  const ListFooterComponent = useCallback(() => <View style={{ height: 100 }} />, []);

  const ListEmptyComponent = useCallback(() => {
    if (isInitialLoading) {
      return (
        <View style={[styles.skeletonGrid, { paddingHorizontal: COL_GAP / 2 }]}>
          {Array.from({ length: numCols * 2 }).map((_, i) => (
            <FavoriteCardSkeleton key={`fav-skel-${i}`} bg={colors.card} border={colors.border} cardW={cardW} imgH={imgH} />
          ))}
        </View>
      );
    }
    return (
      <View style={[styles.emptyContainer, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <EmptyState
          icon="bookmark-outline"
          title={language === 'ar' ? 'لا توجد أطباق محفوظة بعد' : 'No saved dishes yet'}
          subtitle={language === 'ar' ? 'احفظ أطباقك المفضلة من صفحة الطبق' : 'Save dishes from any menu to revisit later'}
        />
      </View>
    );
  }, [language, colors, isInitialLoading, numCols, cardW, imgH]);

  const fadeOpacity = useSharedValue(1);
  useEffect(() => {
    if (!isInitialLoading) {
      fadeOpacity.value = 0.5;
      fadeOpacity.value = withTiming(1, { duration: 220 });
    }
  }, [isInitialLoading, fadeOpacity]);
  const fadeStyle = useAnimatedStyle(() => ({ opacity: fadeOpacity.value }));

  return (
    <Animated.View style={[{ flex: 1 }, fadeStyle]}>
      <FlashList
        data={safeFavorites}
        renderItem={renderFavoriteItem}
        keyExtractor={(item, index) => item.product_id || item.id || `fav-item-${index}`}
        numColumns={numCols}
        estimatedItemSize={imgH + 130}
        ListHeaderComponent={ListHeaderComponent}
        ListFooterComponent={ListFooterComponent}
        ListEmptyComponent={ListEmptyComponent}
        contentContainerStyle={[styles.listContainer, { paddingHorizontal: CARD_PADDING - COL_GAP / 2 }]}
        showsVerticalScrollIndicator={false}
        extraData={[safeFavorites, numCols]}
        refreshControl={
          onRefresh ? (
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={NEON_NIGHT_THEME.primary}
            />
          ) : undefined
        }
      />
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  listContainer: {
    paddingTop: 4,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
    paddingHorizontal: COL_GAP / 2,
  },
  rowReverse: {
    flexDirection: 'row-reverse',
  },
  kicker: {
    ...TYPE.microLabel,
    marginBottom: 4,
  },
  sectionTitle: {
    ...TYPE.title,
    fontSize: 22,
  },
  goldRule: {
    height: 2,
    backgroundColor: COLORS.gold,
    opacity: 0.6,
    width: 48,
    borderRadius: 1,
    marginTop: 6,
  },
  countBadge: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 16,
  },
  countBadgeText: {
    fontSize: 14,
    fontWeight: '700',
  },
  emptyContainer: {
    borderRadius: 16,
    padding: 24,
    borderWidth: 1,
    marginHorizontal: COL_GAP / 2,
  },
  skeletonGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  card: {
    borderRadius: 16,
    borderWidth: 1,
    marginBottom: 14,
    overflow: 'hidden',
  },
  imgWrap: {
    width: '100%',
    position: 'relative',
    overflow: 'hidden',
  },
  img: {
    width: '100%',
    height: '100%',
  },
  imgPlaceholder: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  imgOverlayTop: {
    position: 'absolute',
    top: 6,
    left: 6,
    right: 6,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
  },
  catBadge: {
    backgroundColor: 'rgba(0,0,0,0.55)',
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 8,
  },
  catBadgeText: {
    color: '#FFF',
    fontSize: 9,
    fontWeight: '600',
  },
  stockBadge: {
    position: 'absolute',
    bottom: 6,
    right: 6,
    minWidth: 22,
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderRadius: 7,
    alignItems: 'center',
  },
  stockBadgeText: {
    color: '#FFF',
    fontSize: 10,
    fontWeight: '700',
  },
  discountBadge: {
    position: 'absolute',
    top: 6,
    right: 6,
    backgroundColor: '#EF4444',
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderRadius: 7,
  },
  discountText: {
    color: '#FFF',
    fontSize: 9,
    fontWeight: '700',
  },
  cardBody: {
    padding: 9,
    gap: 4,
  },
  productName: {
    ...TYPE.title,
    fontSize: 13,
    lineHeight: 18,
  },
  textRTL: {
    textAlign: 'right',
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  brandText: {
    fontSize: 10,
    fontWeight: '600',
    color: COLORS.goldBright,
    flexShrink: 1,
  },
  priceRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 5,
    marginTop: 2,
  },
  price: {
    ...TYPE.price,
    fontSize: 15,
    color: COLORS.goldBright,
  },
  priceCurrency: {
    fontSize: 10,
    fontWeight: '500',
    color: COLORS.goldBright,
  },
  originalPrice: {
    fontSize: 10,
    textDecorationLine: 'line-through',
  },
  restaurantPillRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 4,
    marginBottom: 2,
  },
  restaurantPillRowRTL: {
    flexDirection: 'row-reverse',
  },
  restaurantPill: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 999,
    backgroundColor: COLORS.gold + '22',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: COLORS.gold + '88',
    maxWidth: 80,
  },
  restaurantPillText: {
    color: COLORS.goldBright,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.1,
    textDecorationLine: 'underline',
  },
  restaurantPillMore: {
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderRadius: 999,
    backgroundColor: COLORS.gold + '18',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: COLORS.gold + '55',
  },
  restaurantPillMoreText: {
    color: COLORS.goldBright,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.1,
  },
  actionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginTop: 4,
  },
  orderBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.gold,
    paddingVertical: 8,
    paddingHorizontal: 8,
    borderRadius: RADII.sm,
    gap: 3,
  },
  orderBtnText: {
    ...TYPE.spacedButton,
    fontSize: 10,
    color: COLORS.charcoalDeep,
  },
  removeBtn: {
    padding: 8,
    borderRadius: RADII.sm,
    backgroundColor: '#EF444418',
  },
});

export default FavoritesTab;
