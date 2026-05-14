/**
 * OrderItemCard — unified item card used inside order details views.
 *
 * Replaces the duplicated inline item rows that previously lived in:
 *   - app/orders.tsx → OrderDetailsModal items list
 *   - app/admin/order/[id].tsx → grouped item card body
 *
 * Mirrors the visual language of the cart card (image + name + SKU +
 * brand badge + car-models badge + fitment chip + qty + price) so a
 * customer's "I just bought this" view matches the cart they checked
 * out from. Styling stays close to the existing orders.tsx/admin order
 * style so we don't introduce a visual jump.
 */
import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { NEON_NIGHT_THEME } from '../../store/appStore';
import type { RichOrderItem, ThemeColors } from '../../hooks/shopping/types';

export interface OrderItemCardProps {
  item: RichOrderItem;
  language: string;
  isRTL: boolean;
  colors: ThemeColors;
  /** Optional tap target (e.g. navigate to product detail). */
  onPress?: () => void;
}

interface RestaurantEntry {
  id?: string;
  name: string;
}

const extractRestaurantEntries = (item: RichOrderItem, language: string): RestaurantEntry[] => {
  const arr =
    item?.compatible_car_models ||
    item?.car_models ||
    item?.product?.compatible_car_models ||
    item?.product?.car_models;
  if (!Array.isArray(arr) || arr.length === 0) return [];
  return arr
    .map((m: unknown) => {
      const rec = m as { id?: unknown; name?: string; name_ar?: string };
      return {
        id: rec?.id != null ? String(rec.id) : undefined,
        name: (language === 'ar' ? rec?.name_ar || rec?.name : rec?.name || rec?.name_ar) || '',
      };
    })
    .filter((e) => e.name.trim() !== '');
};

export const OrderItemCard: React.FC<OrderItemCardProps> = ({
  item,
  language,
  isRTL,
  colors,
  onPress,
}) => {
  const isAr = language === 'ar';
  const router = useRouter();
  const productName = item.product_name || item.name || item.name_ar || (isAr ? 'منتج' : 'Product');
  const sku = item.sku ? String(item.sku) : '';
  const fitment = item.fitment_indicator ? String(item.fitment_indicator) : '';
  const brandName =
    item.product_brand_name ||
    item.brand_name ||
    item?.product?.product_brand_name ||
    item?.product?.brand_name ||
    null;
  const restaurantEntries = extractRestaurantEntries(item, language);
  const qty = Number(item.quantity ?? 1) || 1;
  const unit = parseFloat(String(item.unit_price ?? item.price ?? 0)) || 0;
  const originalUnit = parseFloat(String(item.original_unit_price ?? 0)) || 0;
  const hasBundleDiscount = !!(item as any).bundle_discount_percentage && originalUnit > 0 && originalUnit > unit;
  const lineTotal = unit * qty;

  const Wrapper: any = onPress ? TouchableOpacity : View;
  const wrapperProps: any = onPress ? { onPress, activeOpacity: 0.85 } : {};

  return (
    <Wrapper
      {...wrapperProps}
      style={[
        styles.row,
        { borderBottomColor: colors.border },
        isRTL && styles.rowReverse,
      ]}
    >
      <View style={[styles.imageWrap, { backgroundColor: colors.surface }]}>
        {item.product_image || item.image_url ? (
          <Image
            source={{ uri: item.product_image || item.image_url || undefined }}
            style={styles.image}
            contentFit="cover"
          />
        ) : (
          <Ionicons name="cube-outline" size={24} color={colors.textSecondary} />
        )}
      </View>

      <View style={[styles.body, isRTL && { alignItems: 'flex-end' }]}>
        <Text style={[styles.name, { color: colors.text }]} numberOfLines={2}>
          {productName}
        </Text>

        {/* SKU + fitment row (kept compact, matches the existing layout) */}
        {(sku || fitment) ? (
          <View
            style={[
              styles.metaRow,
              isRTL && { flexDirection: 'row-reverse' },
            ]}
          >
            {sku ? (
              <Text style={[styles.metaText, { color: colors.textSecondary }]} numberOfLines={1}>
                SKU: {sku}
              </Text>
            ) : null}
            {fitment ? (
              <View
                style={[
                  styles.fitmentChip,
                  {
                    backgroundColor: NEON_NIGHT_THEME.primary + '22',
                    borderColor: NEON_NIGHT_THEME.primary + '55',
                  },
                ]}
              >
                <Text style={[styles.fitmentChipText, { color: NEON_NIGHT_THEME.primary }]}>
                  {fitment}
                </Text>
              </View>
            ) : null}
          </View>
        ) : null}

        {/* Brand badge — server-enriched product_brand_name */}
        {brandName ? (
          <View style={[styles.brandBadge, { backgroundColor: '#8B5CF615', borderColor: '#8B5CF640' }]}>
            <Ionicons name="ribbon-outline" size={11} color="#8B5CF6" />
            <Text style={[styles.brandText, { color: '#8B5CF6' }]} numberOfLines={1}>
              {brandName}
            </Text>
          </View>
        ) : null}

        {/* Compatible restaurants — one tappable pill per restaurant */}
        {restaurantEntries.length > 0 ? (
          <View
            style={[
              styles.modelsRow,
              isRTL && { flexDirection: 'row-reverse' },
            ]}
          >
            <Ionicons name="restaurant-outline" size={11} color="#3B82F6" style={{ marginTop: 1 }} />
            {restaurantEntries.slice(0, 3).map((entry, idx) => {
              if (entry.id) {
                return (
                  <TouchableOpacity
                    key={`${entry.id}-${idx}`}
                    style={styles.modelsPill}
                    activeOpacity={0.7}
                    hitSlop={{ top: 6, bottom: 6, left: 4, right: 4 }}
                    onPress={(e) => {
                      e.stopPropagation();
                      router.push(`/car/${entry.id}`);
                    }}
                  >
                    <Text style={[styles.modelsText, styles.modelsTextTappable]} numberOfLines={1}>
                      {entry.name}
                    </Text>
                  </TouchableOpacity>
                );
              }
              return (
                <View key={`${entry.name}-${idx}`} style={styles.modelsPill}>
                  <Text style={styles.modelsText} numberOfLines={1}>
                    {entry.name}
                  </Text>
                </View>
              );
            })}
            {restaurantEntries.length > 3 ? (
              <View style={styles.modelsMorePill}>
                <Text style={styles.modelsMoreText}>+{restaurantEntries.length - 3}</Text>
              </View>
            ) : null}
          </View>
        ) : null}

        <Text style={[styles.qtyText, { color: colors.textSecondary }]}>
          {isAr ? `الكمية: ${qty}` : `Qty: ${qty}`}
        </Text>
      </View>

      <View style={styles.priceCol}>
        {hasBundleDiscount && (
          <Text style={[styles.unitText, { color: colors.textSecondary, textDecorationLine: 'line-through' }]}>
            {(originalUnit * qty).toFixed(0)} ج.م
          </Text>
        )}
        <Text style={[styles.priceText, { color: hasBundleDiscount ? '#10B981' : NEON_NIGHT_THEME.primary }]}>
          {lineTotal.toFixed(0)} ج.م
        </Text>
        {hasBundleDiscount && (
          <View style={styles.bundleDiscountChip}>
            <Text style={styles.bundleDiscountChipText}>
              خصم {(item as any).bundle_discount_percentage}%
            </Text>
          </View>
        )}
        {!hasBundleDiscount && qty > 1 ? (
          <Text style={[styles.unitText, { color: colors.textSecondary }]}>
            {unit.toFixed(0)} × {qty}
          </Text>
        ) : null}
      </View>
    </Wrapper>
  );
};

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 12,
  },
  rowReverse: {
    flexDirection: 'row-reverse',
  },
  imageWrap: {
    width: 56,
    height: 56,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  image: { width: '100%', height: '100%' },
  body: {
    flex: 1,
    minWidth: 0,
    gap: 4,
  },
  name: { fontSize: 14, fontWeight: '700' },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexWrap: 'wrap',
  },
  metaText: { fontSize: 11, fontWeight: '500' },
  fitmentChip: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    borderWidth: 1,
  },
  fitmentChipText: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.3,
  },
  brandBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1,
    gap: 4,
    maxWidth: '100%',
  },
  brandText: { fontSize: 11, fontWeight: '700', flexShrink: 1 },
  modelsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 4,
    alignSelf: 'flex-start',
    maxWidth: '100%',
  },
  modelsPill: {
    backgroundColor: '#3B82F615',
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 6,
  },
  modelsText: { fontSize: 11, fontWeight: '600', color: '#3B82F6', flexShrink: 1 },
  modelsTextTappable: { textDecorationLine: 'underline' },
  modelsMorePill: {
    backgroundColor: 'rgba(59,130,246,0.10)',
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 6,
  },
  modelsMoreText: { fontSize: 10, fontWeight: '700', color: '#3B82F6' },
  qtyText: { fontSize: 11, fontWeight: '500', marginTop: 2 },
  priceCol: {
    alignItems: 'flex-end',
    minWidth: 70,
    paddingTop: 2,
  },
  priceText: { fontSize: 14, fontWeight: '800' },
  unitText: { fontSize: 10, marginTop: 2 },
  bundleDiscountChip: {
    marginTop: 3,
    backgroundColor: '#10B98122',
    borderRadius: 5,
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderWidth: 1,
    borderColor: '#10B98155',
  },
  bundleDiscountChipText: {
    fontSize: 9,
    fontWeight: '700',
    color: '#10B981',
  },
});

export default OrderItemCard;
