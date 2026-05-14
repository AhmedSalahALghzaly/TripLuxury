/**
 * CartTab - Shopping cart display and management tab
 * REDESIGNED: Larger product cards with SKU and compatible car models
 * ENHANCED: Real-time deletion with confirmation modal and haptic feedback
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, Pressable, Image, RefreshControl, Modal, Platform, ScrollView } from 'react-native';
import Animated, { useSharedValue, useAnimatedStyle, withTiming, withSequence } from 'react-native-reanimated';
import { FlashList } from '@shopify/flash-list';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { EmptyState } from '../ui/EmptyState';
import { Skeleton } from '../ui/Skeleton';
import { useTheme } from '../../hooks/useTheme';
import { useTranslation } from '../../hooks/useTranslation';
import { NEON_NIGHT_THEME } from '../../store/appStore';
import { TYPE, COLORS, RADII } from '../../constants/luxuryTokens';
import { LinearGradient } from 'expo-linear-gradient';
import FitmentStrip, { type FitmentVariant } from '../FitmentStrip';
import type { CartItem, CartItemProduct, CartItemVariant, ThemeColors } from '../../hooks/shopping/types';

const SHIPPING_COST = 50;

type CartRow =
  | { kind: 'group'; groupKey: string; entries: CartItem[]; variants: CartItemVariant[] }
  | { kind: 'single'; entry: CartItem };

interface CartTabProps {
  cartItems: CartItem[];
  isRTL: boolean;
  getSubtotal: () => number;
  getOriginalTotal: () => number;
  getTotalSavings: () => number;
  getItemCount: () => number;
  onUpdateQuantity: (productId: string, quantity: number, fitmentIndicator?: string | null) => void;
  onRemove: (productId: string, fitmentIndicator?: string | null) => void;
  onChangeFitment?: (
    productId: string,
    oldIndicator: string | null,
    newIndicator: string,
    quantity: number,
  ) => void;
  /** Adds a product to the cart — used by the always-on chip strip when the
   * user taps + on a fitment that hasn't been added yet (qty 0 → 1). */
  onAddToCart?: (product: CartItemProduct, quantity?: number) => void;
  onCheckout: () => void;
  onRefresh?: () => void;
  refreshing?: boolean;
  /** True only on the very first fetch when there's no cached data yet. */
  isInitialLoading?: boolean;
  /** Admin/owner view — cart is read-only; no quantity controls, no checkout */
  isAdminView?: boolean;
}

// Content-shaped skeleton row for cart items.
const CartRowSkeleton: React.FC<{ bg: string; border: string }> = ({ bg, border }) => (
  <View
    style={{
      flexDirection: 'row',
      padding: 14,
      borderRadius: 16,
      borderWidth: 1,
      marginBottom: 12,
      backgroundColor: bg,
      borderColor: border,
      minHeight: 140,
    }}
  >
    <Skeleton width={90} height={90} borderRadius={12} moodAware={false} />
    <View style={{ flex: 1, marginLeft: 12, justifyContent: 'space-between' }}>
      <View>
        <Skeleton width="80%" height={16} borderRadius={6} moodAware={false} />
        <View style={{ height: 8 }} />
        <Skeleton width={100} height={16} borderRadius={6} moodAware={false} />
        <View style={{ height: 10 }} />
        <Skeleton width="60%" height={14} borderRadius={6} moodAware={false} />
      </View>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 10 }}>
        <Skeleton width={90} height={32} borderRadius={8} moodAware={false} />
        <Skeleton width={80} height={20} borderRadius={6} moodAware={false} />
      </View>
    </View>
  </View>
);

// Delete Confirmation Modal Component
const DeleteConfirmationModal: React.FC<{
  visible: boolean;
  productName: string;
  isRTL: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}> = ({ visible, productName, isRTL, onCancel, onConfirm }) => {
  const { colors } = useTheme();
  const { language } = useTranslation();

  return (
    <Modal
      animationType="fade"
      transparent={true}
      visible={visible}
      onRequestClose={onCancel}
    >
      <View style={styles.modalOverlay}>
        <View style={[styles.modalContent, { backgroundColor: colors.card, borderColor: colors.border }]}>
          {/* Warning Icon */}
          <View style={[styles.modalIconContainer, { backgroundColor: '#EF4444' + '15' }]}>
            <Ionicons name="trash-outline" size={32} color="#EF4444" />
          </View>

          {/* Title */}
          <Text style={[styles.modalTitle, { color: colors.text }]}>
            {language === 'ar' ? 'تأكيد الحذف' : 'Confirm Removal'}
          </Text>

          {/* Message */}
          <Text style={[styles.modalMessage, { color: colors.textSecondary }]}>
            {language === 'ar' 
              ? `هل أنت متأكد من حذف "${productName}" من السلة؟`
              : `Are you sure you want to remove "${productName}" from your cart?`}
          </Text>

          {/* Buttons */}
          <View style={[styles.modalButtons, isRTL && styles.rowReverse]}>
            <Pressable
              style={[styles.modalButton, styles.cancelButton, { backgroundColor: colors.surface, borderColor: colors.border }]}
              onPress={onCancel}
            >
              <Text style={[styles.cancelButtonText, { color: colors.text }]}>
                {language === 'ar' ? 'إلغاء' : 'Cancel'}
              </Text>
            </Pressable>

            <Pressable
              style={[styles.modalButton, styles.deleteButton]}
              onPress={onConfirm}
            >
              <Ionicons name="trash" size={18} color="#FFF" />
              <Text style={styles.deleteButtonText}>
                {language === 'ar' ? 'حذف' : 'Remove'}
              </Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
};

export const CartTab: React.FC<CartTabProps> = ({
  cartItems,
  isRTL,
  getSubtotal,
  getOriginalTotal,
  getTotalSavings,
  getItemCount,
  onUpdateQuantity,
  onRemove,
  onChangeFitment,
  onAddToCart,
  onCheckout,
  onRefresh,
  refreshing = false,
  isInitialLoading = false,
  isAdminView = false,
}) => {
  const { colors } = useTheme();
  const { language } = useTranslation();
  const router = useRouter();

  // State for delete confirmation modal
  const [deleteModalVisible, setDeleteModalVisible] = useState(false);
  const [itemToDelete, setItemToDelete] = useState<{ productId: string; productName: string; fitmentIndicator: string | null } | null>(null);

  const safeCartItems = useMemo(() => 
    Array.isArray(cartItems) ? cartItems : [], 
    [cartItems]
  );

  // Items in the cart are always shown — even when stock drops to 0 after
  // they were added. Out-of-stock items show a warning badge so the user can
  // decide to keep or remove them before checkout.
  const visibleCartItems = safeCartItems;

  // Group cart entries that share the same SKU (and are NOT part of a
  // bundle offer) into a single logical card so the cart no longer shows two
  // duplicate cards when the customer adds the same product with two different
  // fitment indicators (e.g. STD ×2 + 010 ×3). Bundle entries are passed
  // through untouched so the existing /offer/[id] flow is not affected.
  // Uses visibleCartItems (stock=0 single-fitment items pre-filtered out).
  const groupedItems = useMemo((): CartRow[] => {
    type GroupAccum = { entries: CartItem[]; variants: CartItemVariant[] };
    const groups = new Map<string, GroupAccum>();
    const order: string[] = [];
    const bundles: CartRow[] = [];
    for (const it of visibleCartItems) {
      if (it?.bundle_group_id) {
        bundles.push({ kind: 'single', entry: it });
        continue;
      }
      // Prefer SKU-based grouping so two cart_item rows for the *same SKU*
      // but different fitment_indicators (which the products table stores as
      // separate product rows / different product_ids) collapse into one
      // card. Falls back to product_id when the SKU is missing.
      const sku = String(it?.sku || it?.product?.sku || '').trim().toUpperCase();
      const key = sku
        ? `sku:${sku}`
        : `pid:${it?.product_id || it?.id || 'unknown'}`;
      if (!groups.has(key)) {
        groups.set(key, { entries: [], variants: [] });
        order.push(key);
      }
      const g = groups.get(key)!;
      g.entries.push(it);
      // Capture variants from the first entry that has them. The cart
      // endpoint LATERAL-joins all SKU siblings into available_variants so
      // the chip strip can show every fitment for the SKU — even those the
      // user hasn't added yet (they appear with qty 0 and are tappable).
      if (g.variants.length === 0) {
        const v = Array.isArray(it.available_variants)
          ? it.available_variants
          : Array.isArray(it.product?.available_variants)
            ? it.product.available_variants
            : [];
        if (v.length > 0) g.variants = v;
      }
    }
    const grouped: CartRow[] = order.map((key) => {
      const g = groups.get(key)!;
      // Render as a chip-strip "group" whenever the SKU has 2+ siblings, OR
      // when we have 2+ entries for the same SKU. Otherwise, fall back to
      // the legacy single-row renderer for the common single-fitment case.
      const showChips = g.variants.length > 1 || g.entries.length > 1;
      if (!showChips) return { kind: 'single', entry: g.entries[0] };
      return {
        kind: 'group',
        groupKey: key,
        entries: g.entries,
        variants: g.variants,
      };
    });
    return [...grouped, ...bundles];
  }, [visibleCartItems]);

  // Format compatible car models for display - check multiple sources
  const formatCarModels = useCallback((product: CartItem | CartItemProduct, item: CartItem | CartItemProduct) => {
    // Check for pre-populated car models array
    const carModels = product?.compatible_car_models || 
                      product?.car_models || 
                      item?.compatible_car_models ||
                      item?.car_models;
    
    if (carModels && Array.isArray(carModels) && carModels.length > 0) {
      if (carModels.length <= 2) {
        return carModels.map((m: any) => m.name || m.name_ar || m).join(', ');
      }
      const firstTwo = carModels.slice(0, 2).map((m: any) => m.name || m.name_ar || m).join(', ');
      return `${firstTwo} +${carModels.length - 2} ${language === 'ar' ? 'أخرى' : 'more'}`;
    }
    
    // Check for car_model_ids count
    const carModelIds = product?.car_model_ids || item?.car_model_ids;
    if (carModelIds && Array.isArray(carModelIds) && carModelIds.length > 0) {
      return language === 'ar' 
        ? `${carModelIds.length} مطعم متوافق` 
        : `${carModelIds.length} compatible restaurants`;
    }
    
    return null;
  }, [language]);

  // Handle delete button press - show modal with haptic feedback
  const handleDeletePress = useCallback((productId: string, productName: string, fitmentIndicator?: string | null) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setItemToDelete({ productId, productName, fitmentIndicator: fitmentIndicator ?? null });
    setDeleteModalVisible(true);
  }, []);

  // Handle delete confirmation
  const handleConfirmDelete = useCallback(async () => {
    if (itemToDelete) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setDeleteModalVisible(false);
      // Call the removal function
      await onRemove(itemToDelete.productId, itemToDelete.fitmentIndicator);
      setItemToDelete(null);
    }
  }, [itemToDelete, onRemove]);

  // Handle cancel delete
  const handleCancelDelete = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setDeleteModalVisible(false);
    setItemToDelete(null);
  }, []);

  // Handle quantity update with haptic feedback
  const handleQuantityUpdate = useCallback((productId: string, newQuantity: number, fitmentIndicator?: string | null) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onUpdateQuantity(productId, newQuantity, fitmentIndicator ?? null);
  }, [onUpdateQuantity]);

  // Render professional cart item card - INCREASED HEIGHT
  const renderCartItem = useCallback(({ item }: { item: CartItem }) => {
    const product = item.product ? { ...item, ...item.product } : item;
    const variants = Array.isArray(product?.available_variants)
      ? product.available_variants
      : Array.isArray(item?.available_variants)
        ? item.available_variants
        : [];
    const currentFitment: string | null =
      item.fitment_indicator ?? product.fitment_indicator ?? null;
    const variantPrice = (() => {
      if (!currentFitment) return null;
      const v = variants.find((x: any) => x?.indicator === currentFitment);
      if (v?.price !== undefined && v?.price !== null) {
        const n = parseFloat(String(v.price));
        return Number.isFinite(n) ? n : null;
      }
      return null;
    })();
    const originalPrice = parseFloat(String(item.original_unit_price ?? variantPrice ?? product.price ?? 0)) || 0;
    const finalPrice = parseFloat(String(item.final_unit_price ?? variantPrice ?? product.price ?? 0)) || 0;
    const isBundleItem = !!item.bundle_group_id;
    const bundleDiscountPct = isBundleItem
      ? (parseFloat(String(item.bundle_discount_percentage ?? 0)) || (
          originalPrice > 0 && finalPrice < originalPrice
            ? Math.round(((originalPrice - finalPrice) / originalPrice) * 100)
            : 0
        ))
      : 0;
    const hasDiscount = originalPrice > finalPrice && originalPrice > 0;
    const lineTotal = finalPrice * item.quantity;
    const carModelsDisplay = formatCarModels(product, item);
    const sku = product.sku || item.sku || 'N/A';
    const productName = language === 'ar' ? product.name_ar || product.name : product.name || product.name_ar;
    const canSwapFitment =
      !item.bundle_group_id &&
      !!onChangeFitment &&
      Array.isArray(variants) &&
      variants.length > 1;

    // Stock cap for simple (non-grouped) cart items
    const effectiveStock = (() => {
      if (variants.length > 0 && currentFitment) {
        const v = variants.find((x: any) => x?.indicator === currentFitment);
        if (v?.stock !== undefined && v?.stock !== null) return Number(v.stock);
      }
      const s = item.stock_quantity ?? product.stock_quantity;
      return s !== undefined && s !== null ? Number(s) : null;
    })();
    const atStockLimit = effectiveStock !== null && item.quantity >= effectiveStock;

    return (
      <View style={[styles.cartItem, { backgroundColor: colors.card, borderColor: colors.border }]}>
        {/* Product Image Section */}
        <Pressable
          style={[styles.productThumb, { backgroundColor: colors.surface }]}
          onPress={() => router.push(`/product/${item.product_id}`)}
        >
          {product.image_url || (product.images && product.images[0]) ? (
            <Image 
              source={{ uri: product.image_url || product.images?.[0] }} 
              style={styles.productImage} 
              resizeMode="cover"
            />
          ) : (
            <Ionicons name="cube-outline" size={32} color={colors.textSecondary} />
          )}
          {item.bundle_group_id && (
            <View style={[styles.bundleBadge, { backgroundColor: NEON_NIGHT_THEME.accent }]}>
              <Ionicons name="gift" size={10} color="#FFF" />
            </View>
          )}
        </Pressable>

        {/* Product Info Section */}
        <View style={styles.cartItemInfo}>
          {/* Product Name */}
          <Text style={[styles.productName, { color: colors.text }]} numberOfLines={2}>
            {productName}
          </Text>

          {/* Interactive Fitment Strip — directly under the title */}
          {canSwapFitment ? (
            <View style={styles.fitmentStripWrap}>
              <FitmentStrip
                mode="interactive"
                variants={variants as FitmentVariant[]}
                selected={currentFitment}
                onChange={(ind) =>
                  onChangeFitment?.(item.product_id, currentFitment, ind, item.quantity)
                }
                size="sm"
                hideOutOfStock={false}
              />
            </View>
          ) : currentFitment ? (
            <View style={styles.fitmentStripWrap}>
              <FitmentStrip
                mode="display"
                variants={[{ indicator: currentFitment }]}
                selected={currentFitment}
                size="sm"
              />
            </View>
          ) : null}

          {/* Selected variant details — show indicator + resolved unit price
              (and stock if known) so the user can see what the active chip
              represents at a glance. */}
          {currentFitment && (variantPrice !== null || (() => {
            const v = variants.find((x: any) => x?.indicator === currentFitment);
            return v?.stock !== undefined && v?.stock !== null;
          })()) ? (
            <View style={styles.variantDetailRow}>
              <Text style={[styles.variantDetailText, { color: colors.textSecondary }]}>
                {currentFitment}
                {variantPrice !== null
                  ? ` • ${variantPrice.toFixed(0)} ج.م`
                  : ''}
                {(() => {
                  const v = variants.find((x: any) => x?.indicator === currentFitment);
                  if (v?.stock === undefined || v?.stock === null) return '';
                  return ` • ${language === 'ar' ? 'المخزون' : 'Stock'}: ${v.stock}`;
                })()}
              </Text>
            </View>
          ) : null}

          {/* SKU Badge */}
          <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6 }}>
            <View style={[styles.skuContainer, { backgroundColor: colors.surface }]}>
              <Ionicons name="barcode-outline" size={12} color={colors.textSecondary} />
              <Text style={[styles.skuText, { color: colors.textSecondary }]}>
                SKU: {sku}
              </Text>
            </View>
          </View>

          {/* Brand Badge — server-enriched product_brand_name */}
          {(product.product_brand_name || item.product_brand_name) ? (
            <View style={[styles.brandBadge, { backgroundColor: '#8B5CF6' + '15', borderColor: '#8B5CF6' + '40' }]}>
              <Ionicons name="ribbon-outline" size={12} color="#8B5CF6" />
              <Text style={[styles.brandBadgeText, { color: '#8B5CF6' }]} numberOfLines={1}>
                {product.product_brand_name || item.product_brand_name}
              </Text>
            </View>
          ) : null}

          {/* Compatible Restaurants - Always show if available */}
          {carModelsDisplay && (
            <View style={[styles.carModelsContainer, { backgroundColor: '#3B82F6' + '15' }]}>
              <Ionicons name="restaurant-outline" size={12} color="#3B82F6" />
              <Text style={[styles.carModelsText, { color: '#3B82F6' }]} numberOfLines={1}>
                {carModelsDisplay}
              </Text>
            </View>
          )}

          {/* Bundle Discount Chip */}
          {isBundleItem && bundleDiscountPct > 0 && (
            <View style={styles.bundleDiscountChip}>
              <Ionicons name="gift" size={11} color={COLORS.charcoalDeep} />
              <Text style={styles.bundleDiscountChipText}>
                {language === 'ar' ? `خصم ${bundleDiscountPct}%` : `${bundleDiscountPct}% Bundle`}
              </Text>
            </View>
          )}

          {/* Price Row */}
          <View style={[styles.priceRow, isRTL && styles.rowReverse]}>
            {hasDiscount && (
              <Text style={[styles.originalPrice, { color: colors.textSecondary }]}>
                {originalPrice.toFixed(0)} ج.م
              </Text>
            )}
            <Text style={[styles.finalPrice, { color: isBundleItem ? '#10B981' : COLORS.goldBright }]}>
              {finalPrice.toFixed(0)} ج.م
            </Text>
            {hasDiscount && !isBundleItem && originalPrice > 0 && (
              <View style={styles.discountBadge}>
                <Text style={styles.discountText}>
                  -{Math.round(((originalPrice - finalPrice) / originalPrice) * 100)}%
                </Text>
              </View>
            )}
          </View>

          {/* Line Total */}
          <View style={[styles.lineTotalRow, isRTL && styles.rowReverse]}>
            <Text style={[styles.lineTotalLabel, { color: colors.textSecondary }]}>
              {language === 'ar' ? 'الإجمالي:' : 'Total:'}
            </Text>
            <Text style={[styles.lineTotalValue, { color: colors.text }]}>
              {lineTotal.toFixed(0)} ج.م
            </Text>
          </View>
        </View>

        {/* Actions Section */}
        <View style={styles.actionsSection}>
          {isAdminView ? (
            /* Admin view — read-only quantity badge */
            <View style={[styles.quantityControls, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <Text style={[styles.qtyText, { color: colors.text, paddingHorizontal: 10 }]}>{item.quantity}</Text>
            </View>
          ) : !item.bundle_group_id ? (
            <View style={[styles.quantityControls, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <Pressable
                style={[styles.qtyBtn, { backgroundColor: colors.card }]}
                onPress={() => handleQuantityUpdate(item.product_id, item.quantity - 1, item.fitment_indicator ?? null)}
              >
                <Ionicons name="remove" size={16} color={colors.text} />
              </Pressable>
              <Text style={[styles.qtyText, { color: colors.text }]}>{item.quantity}</Text>
              <Pressable
                style={[styles.qtyBtn, { backgroundColor: colors.card }, atStockLimit && styles.qtyBtnDisabled]}
                onPress={() => !atStockLimit && handleQuantityUpdate(item.product_id, item.quantity + 1, item.fitment_indicator ?? null)}
                disabled={atStockLimit}
              >
                <Ionicons name="add" size={16} color={atStockLimit ? '#9CA3AF' : colors.text} />
              </Pressable>
            </View>
          ) : (
            // Bundle item - show locked indicator instead of quantity controls
            <View style={[styles.bundleLockedIndicator, { backgroundColor: '#FFD700' + '20', borderColor: '#FFD700' }]}>
              <Ionicons name="gift" size={14} color="#FFD700" />
              <Text style={[styles.bundleLockedText, { color: '#FFD700' }]}>
                {language === 'ar' ? 'عرض خاص' : 'Bundle'}
              </Text>
            </View>
          )}

          {/* Remove Button — hidden in admin view */}
          {!isAdminView && (
            <Pressable
              style={[styles.removeBtn, { backgroundColor: '#EF4444' + '15' }]}
              onPress={() => handleDeletePress(item.product_id, productName ?? '', item.fitment_indicator ?? null)}
            >
              <Ionicons name="trash-outline" size={18} color="#EF4444" />
            </Pressable>
          )}
        </View>
      </View>
    );
  }, [colors, language, isRTL, router, handleQuantityUpdate, handleDeletePress, formatCarModels, isAdminView]);

  // Order Summary Component
  const OrderSummary = useMemo(() => {
    if (safeCartItems.length === 0) return null;
    
    return (
      <View style={[styles.summaryContainer, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <Text style={[styles.sectionTitle, { color: colors.text }]}>
          {language === 'ar' ? 'ملخّص طلبك' : 'Order Summary'}
        </Text>
        <View style={styles.goldRule} />

        {getTotalSavings() > 0 && (
          <View style={[styles.summaryRow, isRTL && styles.rowReverse]}>
            <View style={[styles.savingsRow, isRTL && styles.rowReverse]}>
              <Ionicons name="sparkles" size={14} color="#10B981" />
              <Text style={[styles.savingsLabel, { color: '#10B981' }]}>
                {language === 'ar' ? 'وفّرت (عروض مجمعة)' : 'Bundle savings'}
              </Text>
            </View>
            <Text style={[styles.savingsValue, { color: '#10B981' }]}>
              -{getTotalSavings().toFixed(0)} ج.م
            </Text>
          </View>
        )}

        <View style={[styles.summaryRow, isRTL && styles.rowReverse]}>
          <Text style={[styles.summaryLabel, { color: colors.textSecondary }]}>
            {language === 'ar' ? 'المجموع الفرعي' : 'Subtotal'}
          </Text>
          <Text style={[styles.summaryValue, { color: colors.text }]}>
            {getSubtotal().toFixed(0)} ج.م
          </Text>
        </View>

        <View style={[styles.summaryRow, isRTL && styles.rowReverse]}>
          <Text style={[styles.summaryLabel, { color: colors.textSecondary }]}>
            {language === 'ar' ? 'الشحن' : 'Shipping'}
          </Text>
          <Text style={[styles.summaryValue, { color: colors.text }]}>
            {SHIPPING_COST.toFixed(0)} ج.م
          </Text>
        </View>

        <View style={[styles.totalRow, { borderTopColor: colors.border }, isRTL && styles.rowReverse]}>
          <Text style={[styles.totalLabel, { color: colors.text }]}>
            {language === 'ar' ? 'الإجمالي' : 'Total'}
          </Text>
          <Text style={[styles.totalValue, { color: COLORS.goldBright }]}>
            {(getSubtotal() + SHIPPING_COST).toFixed(0)} ج.م
          </Text>
        </View>

        {!isAdminView && (
          <Pressable onPress={onCheckout} style={styles.checkoutBtnWrap}>
            <LinearGradient
              colors={[COLORS.gold, COLORS.goldSoft, COLORS.gold]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={styles.checkoutBtn}
            >
              <Ionicons name="wine" size={18} color={COLORS.charcoalDeep} />
              <Text style={[styles.checkoutBtnText, { color: COLORS.charcoalDeep }]}>
                {language === 'ar' ? 'تأكيد الحجز' : 'Reserve Your Table'}
              </Text>
              <Ionicons name={isRTL ? 'arrow-back' : 'arrow-forward'} size={18} color={COLORS.charcoalDeep} />
            </LinearGradient>
          </Pressable>
        )}
      </View>
    );
  }, [colors, language, isRTL, getSubtotal, getTotalSavings, onCheckout, safeCartItems.length, isAdminView]);

  // List Header - ZERO top padding to fix gap
  const ListHeaderComponent = useCallback(() => (
    <View>
      <View style={[styles.headerRow, isRTL && styles.rowReverse]}>
        <View>
          <Text style={[styles.kicker, { color: COLORS.goldBright }]}>
            {isAdminView
              ? (language === 'ar' ? 'عرض للمسؤول فقط' : 'Admin View — Read Only')
              : (language === 'ar' ? 'مائدتك تنتظر' : 'A Table for You')}
          </Text>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>
            {language === 'ar' ? 'الطلب الحالي' : 'Current Order'}
          </Text>
        </View>
        <View style={[styles.countBadge, { backgroundColor: isAdminView ? '#3B82F6' : COLORS.gold }]}>
          <Text style={[styles.countBadgeText, { color: isAdminView ? '#FFF' : COLORS.charcoalDeep }]}>{getItemCount()}</Text>
        </View>
      </View>
      <View style={styles.goldRule} />
    </View>
  ), [colors, language, isRTL, getItemCount, isAdminView]);

  // List Footer with summary
  const ListFooterComponent = useCallback(() => (
    <View>
      {OrderSummary}
      <View style={{ height: 100 }} />
    </View>
  ), [OrderSummary]);

  // Empty state — skeletons during initial load, then EmptyState.
  const ListEmptyComponent = useCallback(() => {
    if (isInitialLoading) {
      return (
        <View style={{ paddingTop: 4 }}>
          {Array.from({ length: 3 }).map((_, i) => (
            <CartRowSkeleton key={`cart-skel-${i}`} bg={colors.card} border={colors.border} />
          ))}
        </View>
      );
    }
    return (
      <View style={[styles.emptyContainer, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <EmptyState
          icon="restaurant-outline"
          title={
            isAdminView
              ? (language === 'ar' ? 'لا أطباق في طلب العميل' : 'No items in this customer\'s order')
              : (language === 'ar' ? 'لا أطباق في طلبك بعد' : 'No dishes on your order yet')
          }
          actionLabel={isAdminView ? undefined : (language === 'ar' ? 'تصفّح القائمة' : 'Browse the Menu')}
          onAction={isAdminView ? undefined : () => router.push('/')}
        />
      </View>
    );
  }, [language, router, colors, isInitialLoading, isAdminView]);

  // Crossfade real content in once initial loading completes.
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
        data={groupedItems}
        renderItem={({ item }: { item: CartRow }) => {
          if (item.kind === 'group') {
            return (
              <GroupedCartCard
                groupKey={item.groupKey}
                entries={item.entries}
                variants={item.variants}
                colors={colors}
                language={language}
                isRTL={isRTL}
                router={router}
                formatCarModels={formatCarModels}
                onUpdateQuantity={handleQuantityUpdate}
                onDeletePress={handleDeletePress}
                onAddToCart={onAddToCart}
              />
            );
          }
          return renderCartItem({ item: item.entry });
        }}
        keyExtractor={(row: CartRow, index: number) => {
          if (row?.kind === 'group') return `grp|${row.groupKey}`;
          const it = row?.entry ?? row;
          const pid = it?.product_id || `idx-${index}`;
          const fi = it?.fitment_indicator ?? 'STD';
          const bg = it?.bundle_group_id ?? '';
          return `${pid}|${fi}|${bg}`;
        }}
        estimatedItemSize={200}
        ListHeaderComponent={ListHeaderComponent}
        ListFooterComponent={ListFooterComponent}
        ListEmptyComponent={ListEmptyComponent}
        contentContainerStyle={styles.listContainer}
        showsVerticalScrollIndicator={false}
        extraData={safeCartItems.map(i => `${i.product_id}|${i.fitment_indicator ?? ''}|${i.quantity}|${i.bundle_group_id ?? ''}`).join(',')}
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

      {/* Delete Confirmation Modal */}
      <DeleteConfirmationModal
        visible={deleteModalVisible}
        productName={itemToDelete?.productName || ''}
        isRTL={isRTL}
        onCancel={handleCancelDelete}
        onConfirm={handleConfirmDelete}
      />
    </Animated.View>
  );
};

// ─── STD-first chip ordering shared with FitmentStrip ──────────────────────
const CART_CHIP_ORDER = ['STD', '010', '020', '030', '040'];
function sortChipIndicators(arr: string[]): string[] {
  return [...arr].sort((a, b) => {
    const ai = CART_CHIP_ORDER.indexOf(a);
    const bi = CART_CHIP_ORDER.indexOf(b);
    if (ai === -1 && bi === -1) return a.localeCompare(b);
    if (ai === -1) return 1;
    if (bi === -1) return -1;
    return ai - bi;
  });
}

// Grouped cart card — renders a single product card per SKU containing an
// always-on horizontal fitment chip strip. Each chip shows its real
// per-fitment price (from available_variants[].price), and stays visible
// even when its qty drops to 0 so the customer can re-add it without
// re-finding the product. Tapping a chip selects it; the +/- controls then
// operate on the selected variant's product_id (each fitment is its own row
// in the products table). Tapping + on a qty=0 chip calls onAddToCart with
// the variant's product_id, creating a fresh cart_item for that fitment.
const GroupedCartCard: React.FC<{
  groupKey: string;
  entries: CartItem[];
  variants: CartItemVariant[];
  colors: ThemeColors;
  language: string;
  isRTL: boolean;
  router: ReturnType<typeof useRouter>;
  formatCarModels: (product: CartItem | CartItemProduct, item: CartItem | CartItemProduct) => string | null;
  onUpdateQuantity: (productId: string, quantity: number, fitmentIndicator?: string | null) => void;
  onDeletePress: (productId: string, productName: string, fitmentIndicator?: string | null) => void;
  onAddToCart?: (product: CartItemProduct, quantity?: number) => void;
}> = ({
  groupKey,
  entries,
  variants,
  colors,
  language,
  isRTL,
  router,
  formatCarModels,
  onUpdateQuantity,
  onDeletePress,
  onAddToCart,
}) => {
  // ─── Representative product metadata (shared across all variants/entries) ──
  // Prefer a STD entry for the head so the card image/name come from the
  // canonical fitment when present.
  const head =
    entries.find(
      (e) => String(e.fitment_indicator ?? 'STD').toUpperCase() === 'STD',
    ) ?? entries[0];
  const product = head?.product ? { ...head, ...head.product } : head ?? {};
  const productName =
    language === 'ar'
      ? product.name_ar || product.name
      : product.name || product.name_ar;
  const sku = product.sku || head?.sku || 'N/A';
  const carModelsDisplay = formatCarModels(product, head);

  // ─── Build the unified chip list ──────────────────────────────────────────
  // Merge variants (all SKU siblings — even those not yet added) with the
  // entries actually in the cart. Each chip carries the variant's product_id
  // so +/- target the correct DB row.
  type Chip = {
    indicator: string;
    productId: string;
    price: number;
    stock: number | undefined;
    qty: number;
    inCart: boolean;
  };
  const chips: Chip[] = useMemo(() => {
    const indSet = new Set<string>();
    const variantByInd = new Map<string, any>();
    for (const v of variants || []) {
      if (!v?.indicator) continue;
      const ind = String(v.indicator).toUpperCase();
      indSet.add(ind);
      variantByInd.set(ind, v);
    }
    const entryByInd = new Map<string, any>();
    for (const e of entries) {
      const ind = String(e.fitment_indicator ?? 'STD').toUpperCase();
      indSet.add(ind);
      entryByInd.set(ind, e);
    }
    const ordered = sortChipIndicators(Array.from(indSet));
    return ordered.map((ind) => {
      const v = variantByInd.get(ind);
      const e = entryByInd.get(ind);
      const productId =
        e?.product_id ?? (v?.id ? String(v.id) : product.id ?? product.product_id);
      const priceRaw =
        v?.price !== undefined && v?.price !== null
          ? v.price
          : e?.final_unit_price ?? e?.product?.price ?? product.price ?? 0;
      const priceN = parseFloat(String(priceRaw));
      const stockRaw = v?.stock;
      return {
        indicator: ind,
        productId: String(productId ?? ''),
        price: Number.isFinite(priceN) ? priceN : 0,
        stock: stockRaw !== undefined && stockRaw !== null ? Number(stockRaw) : undefined,
        qty: Number(e?.quantity || 0),
        inCart: !!e,
      };
    });
  }, [variants, entries, product.id, product.product_id, product.price]);

  // Always show chips that are already in the cart (qty > 0), plus chips
  // whose stock is not known to be 0. This ensures users can see and remove
  // out-of-stock items they previously added.
  const visibleChips = useMemo(
    () => chips.filter((c) => c.qty > 0 || c.stock === undefined || c.stock > 0),
    [chips],
  );

  // Default selection: prefer the first visible chip with qty > 0, else STD, else first visible.
  const initialSel =
    visibleChips.find((c) => c.qty > 0)?.indicator ??
    visibleChips.find((c) => c.indicator === 'STD')?.indicator ??
    visibleChips[0]?.indicator ??
    'STD';
  const [selectedIndicator, setSelectedIndicator] = useState<string>(initialSel);
  // Keep selection valid when the visible chip list changes (e.g. server refetch).
  useEffect(() => {
    if (!visibleChips.find((c) => c.indicator === selectedIndicator)) {
      setSelectedIndicator(initialSel);
    }
  }, [visibleChips, selectedIndicator, initialSel]);

  const selectedChip =
    visibleChips.find((c) => c.indicator === selectedIndicator) ?? visibleChips[0];

  // Card totals across every chip (real, per-fitment).
  const cardTotal = chips.reduce((s, c) => s + c.price * c.qty, 0);
  const totalQuantity = chips.reduce((s, c) => s + c.qty, 0);

  // Animated price pulse on chip change → tiny, snappy, and futuristic.
  const priceScale = useSharedValue(1);
  const priceOpacity = useSharedValue(1);
  useEffect(() => {
    priceOpacity.value = withSequence(
      withTiming(0.4, { duration: 80 }),
      withTiming(1, { duration: 220 }),
    );
    priceScale.value = withSequence(
      withTiming(0.92, { duration: 80 }),
      withTiming(1, { duration: 240 }),
    );
  }, [selectedIndicator, priceOpacity, priceScale]);
  const priceAnimStyle = useAnimatedStyle(() => ({
    opacity: priceOpacity.value,
    transform: [{ scale: priceScale.value }],
  }));

  // ─── +/- handlers — operate on the selected chip's variant product_id ────
  const handleDecrement = useCallback(() => {
    if (!selectedChip) return;
    if (selectedChip.qty <= 0) return; // already 0 — nothing to remove
    if (Platform.OS !== 'web') Haptics.selectionAsync().catch(() => {});
    // qty - 1; when 0 the cart endpoint deletes the row, but the chip stays
    // visible in the UI because it's rendered from `variants`, not entries.
    onUpdateQuantity(
      selectedChip.productId,
      selectedChip.qty - 1,
      selectedChip.indicator,
    );
  }, [selectedChip, onUpdateQuantity]);

  const handleIncrement = useCallback(() => {
    if (!selectedChip) return;
    if (Platform.OS !== 'web') Haptics.selectionAsync().catch(() => {});
    // Stock cap: never exceed available stock for this fitment
    if (
      selectedChip.stock !== undefined &&
      selectedChip.stock !== null &&
      selectedChip.qty >= selectedChip.stock
    ) {
      return;
    }
    if (selectedChip.qty <= 0) {
      // First add for this fitment — must use addToCart (UPDATE on a
      // non-existent row would no-op). Falls back to update when the parent
      // didn't wire onAddToCart, so behavior is never silently broken.
      if (onAddToCart) {
        onAddToCart(
          {
            id: selectedChip.productId,
            name: productName ?? '',
            sku,
            fitment_indicator: selectedChip.indicator,
            price: selectedChip.price,
          },
          1,
        );
      } else {
        onUpdateQuantity(selectedChip.productId, 1, selectedChip.indicator);
      }
      return;
    }
    onUpdateQuantity(
      selectedChip.productId,
      selectedChip.qty + 1,
      selectedChip.indicator,
    );
  }, [selectedChip, onUpdateQuantity, onAddToCart, sku]);

  const handleDelete = useCallback(() => {
    if (!selectedChip || selectedChip.qty <= 0) return;
    onDeletePress(selectedChip.productId, productName ?? '', selectedChip.indicator);
  }, [selectedChip, productName, onDeletePress]);

  // Open the active variant's product page on image tap.
  const goToActiveProduct = useCallback(() => {
    const pid = selectedChip?.productId || head?.product_id || product.id;
    if (pid) router.push(`/product/${pid}`);
  }, [selectedChip, head, product, router]);

  // ─── Render ───────────────────────────────────────────────────────────────
  return (
    <View
      style={[
        styles.cartItem,
        { backgroundColor: colors.card, borderColor: colors.border },
      ]}
    >
      {/* Image */}
      <Pressable
        style={[styles.productThumb, { backgroundColor: colors.surface }]}
        onPress={goToActiveProduct}
      >
        {product.image_url || (product.images && product.images[0]) ? (
          <Image
            source={{ uri: product.image_url || product.images?.[0] }}
            style={styles.productImage}
            resizeMode="cover"
          />
        ) : (
          <Ionicons name="cube-outline" size={32} color={colors.textSecondary} />
        )}
      </Pressable>

      {/* Info */}
      <View style={styles.cartItemInfo}>
        <Text style={[styles.productName, { color: colors.text }]} numberOfLines={2}>
          {productName}
        </Text>

        {/* Always-on, single-row, scrollable fitment chip strip. Each chip
            carries the real per-fitment price; out-of-cart chips show qty 0
            and a faded outline so the customer can still tap + to add. */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{
            flexDirection: isRTL ? 'row-reverse' : 'row',
            gap: 8,
            paddingTop: 6,
            paddingBottom: 4,
            alignItems: 'center',
          }}
          style={{ marginBottom: 4, alignSelf: 'stretch' }}
        >
          {visibleChips.map((c) => {
            const isSel = c.indicator === selectedIndicator;
            const isZero = c.qty <= 0;
            const accentColor = NEON_NIGHT_THEME.primary;
            return (
              <Pressable
                key={`chip-${c.indicator}`}
                onPress={() => {
                  if (Platform.OS !== 'web')
                    Haptics.selectionAsync().catch(() => {});
                  setSelectedIndicator(c.indicator);
                }}
                accessibilityRole="button"
                accessibilityState={{ selected: isSel }}
                style={{
                  paddingHorizontal: 11,
                  paddingVertical: 7,
                  borderRadius: 14,
                  borderWidth: 1.5,
                  borderStyle: isZero && !isSel ? 'dashed' : 'solid',
                  borderColor: isSel
                    ? accentColor
                    : isZero
                      ? colors.textSecondary + '66'
                      : colors.border,
                  backgroundColor: isSel
                    ? accentColor + '18'
                    : isZero
                      ? 'transparent'
                      : colors.surface,
                  minWidth: 78,
                  alignItems: 'center',
                  opacity: isZero && !isSel ? 0.78 : 1,
                  ...(isSel
                    ? Platform.OS === 'web'
                      ? ({
                          // @ts-ignore web-only
                          boxShadow: `0 0 12px ${accentColor}66`,
                        } as any)
                      : {
                          shadowColor: accentColor,
                          shadowOffset: { width: 0, height: 0 },
                          shadowOpacity: 0.55,
                          shadowRadius: 8,
                          elevation: 5,
                        }
                    : null),
                }}
              >
                {/* Indicator + qty badge */}
                <View
                  style={{
                    flexDirection: isRTL ? 'row-reverse' : 'row',
                    alignItems: 'center',
                    gap: 6,
                  }}
                >
                  <Text
                    style={{
                      fontSize: 12,
                      fontWeight: '900',
                      letterSpacing: 0.6,
                      color: isSel ? accentColor : colors.text,
                    }}
                  >
                    {c.indicator}
                  </Text>
                  <View
                    style={{
                      minWidth: 24,
                      paddingHorizontal: 6,
                      paddingVertical: 1,
                      borderRadius: 999,
                      backgroundColor: isSel
                        ? accentColor
                        : isZero
                          ? colors.textSecondary
                          : colors.textSecondary,
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <Text
                      style={{
                        fontSize: 10,
                        fontWeight: '900',
                        color: '#FFF',
                      }}
                    >
                      ×{c.qty}
                    </Text>
                  </View>
                </View>
                {/* Per-fitment price (real, not STD-cloned) */}
                <Text
                  style={{
                    fontSize: 12,
                    fontWeight: '800',
                    marginTop: 3,
                    color: isSel ? accentColor : colors.text,
                  }}
                >
                  {c.price.toFixed(0)} ج.م
                </Text>
                {/* Out-of-stock warning for in-cart chips */}
                {c.qty > 0 && c.stock !== undefined && c.stock !== null && c.stock === 0 ? (
                  <Text style={{ fontSize: 9, fontWeight: '700', color: '#EF4444', marginTop: 1 }}>
                    {language === 'ar' ? 'نفد' : 'OOS'}
                  </Text>
                ) : null}
              </Pressable>
            );
          })}
        </ScrollView>

        {/* SKU */}
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: 6,
          }}
        >
          <View style={[styles.skuContainer, { backgroundColor: colors.surface }]}>
            <Ionicons name="barcode-outline" size={12} color={colors.textSecondary} />
            <Text style={[styles.skuText, { color: colors.textSecondary }]}>
              SKU: {sku}
            </Text>
          </View>
        </View>

        {/* Brand Badge — server-enriched product_brand_name */}
        {(product.product_brand_name || head.product_brand_name) ? (
          <View
            style={[
              styles.brandBadge,
              { backgroundColor: '#8B5CF6' + '15', borderColor: '#8B5CF6' + '40' },
            ]}
          >
            <Ionicons name="ribbon-outline" size={12} color="#8B5CF6" />
            <Text style={[styles.brandBadgeText, { color: '#8B5CF6' }]} numberOfLines={1}>
              {product.product_brand_name || head.product_brand_name}
            </Text>
          </View>
        ) : null}

        {/* Compatible models */}
        {carModelsDisplay && (
          <View
            style={[
              styles.carModelsContainer,
              { backgroundColor: '#3B82F6' + '15' },
            ]}
          >
            <Ionicons name="restaurant-outline" size={12} color="#3B82F6" />
            <Text
              style={[styles.carModelsText, { color: '#3B82F6' }]}
              numberOfLines={1}
            >
              {carModelsDisplay}
            </Text>
          </View>
        )}

        {/* Card-wide total (real-time, sum across every chip) */}
        <View style={[styles.lineTotalRow, isRTL && styles.rowReverse]}>
          <Text
            style={[styles.lineTotalLabel, { color: colors.textSecondary }]}
          >
            {language === 'ar'
              ? `إجمالي ${totalQuantity} قطعة:`
              : `Total (${totalQuantity}):`}
          </Text>
          <Animated.Text
            style={[
              styles.lineTotalValue,
              { color: NEON_NIGHT_THEME.primary, fontSize: 16 },
              priceAnimStyle,
            ]}
          >
            {cardTotal.toFixed(0)} ج.م
          </Animated.Text>
        </View>
      </View>

      {/* Actions — always visible, even when selected chip is at qty 0. */}
      <View style={styles.actionsSection}>
        <View
          style={[
            styles.quantityControls,
            { backgroundColor: colors.surface, borderColor: colors.border },
          ]}
        >
          <Pressable
            style={[
              styles.qtyBtn,
              {
                backgroundColor: colors.card,
                opacity: (selectedChip?.qty ?? 0) > 0 ? 1 : 0.45,
              },
            ]}
            onPress={handleDecrement}
            disabled={(selectedChip?.qty ?? 0) <= 0}
          >
            <Ionicons name="remove" size={16} color={colors.text} />
          </Pressable>
          <Text style={[styles.qtyText, { color: colors.text }]}>
            {selectedChip?.qty ?? 0}
          </Text>
          <Pressable
            style={[
              styles.qtyBtn,
              { backgroundColor: colors.card },
              (selectedChip?.stock !== undefined && selectedChip?.stock !== null && (selectedChip?.qty ?? 0) >= selectedChip.stock) && styles.qtyBtnDisabled,
            ]}
            onPress={handleIncrement}
            disabled={!!(selectedChip?.stock !== undefined && selectedChip?.stock !== null && (selectedChip?.qty ?? 0) >= selectedChip.stock)}
          >
            <Ionicons
              name="add"
              size={16}
              color={(selectedChip?.stock !== undefined && selectedChip?.stock !== null && (selectedChip?.qty ?? 0) >= selectedChip.stock) ? '#9CA3AF' : colors.text}
            />
          </Pressable>
        </View>
        <Pressable
          style={[
            styles.removeBtn,
            {
              backgroundColor: '#EF4444' + '15',
              opacity: (selectedChip?.qty ?? 0) > 0 ? 1 : 0.4,
            },
          ]}
          onPress={handleDelete}
          disabled={(selectedChip?.qty ?? 0) <= 0}
        >
          <Ionicons name="trash-outline" size={18} color="#EF4444" />
        </Pressable>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  listContainer: {
    paddingHorizontal: 16,
    paddingTop: 4,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  rowReverse: {
    flexDirection: 'row-reverse',
  },
  sectionTitle: {
    ...TYPE.title,
    fontSize: 22,
  },
  kicker: {
    ...TYPE.microLabel,
    marginBottom: 4,
  },
  goldRule: {
    height: 1,
    backgroundColor: COLORS.gold,
    opacity: 0.55,
    width: 56,
    marginTop: 4,
    marginBottom: 14,
  },
  countBadge: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 14,
  },
  countBadgeText: {
    color: '#FFF',
    fontSize: 13,
    fontWeight: '700',
  },
  emptyContainer: {
    borderRadius: 16,
    padding: 24,
    borderWidth: 1,
  },
  cartItem: {
    flexDirection: 'row',
    padding: 14,
    borderRadius: 16,
    borderWidth: 1,
    marginBottom: 12,
    minHeight: 140,
  },
  productThumb: {
    width: 100,
    height: 100,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
  },
  productImage: {
    width: 100,
    height: 100,
    borderRadius: 12,
  },
  bundleBadge: {
    position: 'absolute',
    top: 4,
    left: 4,
    width: 20,
    height: 20,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  cartItemInfo: {
    flex: 1,
    marginLeft: 12,
    justifyContent: 'flex-start',
  },
  productName: {
    ...TYPE.title,
    fontSize: 16,
    marginBottom: 6,
    lineHeight: 22,
  },
  fitmentStripWrap: {
    marginBottom: 8,
    alignItems: 'flex-start',
  },
  variantDetailRow: {
    marginBottom: 6,
  },
  variantDetailText: {
    fontSize: 12,
    fontWeight: '500',
  },
  skuContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    gap: 4,
    marginBottom: 6,
  },
  skuText: {
    fontSize: 11,
    fontWeight: '500',
  },
  carModelsContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    gap: 4,
    marginBottom: 8,
    maxWidth: '100%',
  },
  carModelsText: {
    fontSize: 11,
    fontWeight: '600',
    flexShrink: 1,
  },
  brandBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    borderWidth: 1,
    gap: 4,
    marginTop: 4,
    marginBottom: 4,
    maxWidth: '100%',
  },
  brandBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    flexShrink: 1,
  },
  priceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 4,
  },
  originalPrice: {
    fontSize: 12,
    textDecorationLine: 'line-through',
  },
  finalPrice: {
    fontSize: 16,
    fontWeight: '700',
  },
  discountBadge: {
    backgroundColor: '#10B981',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  discountText: {
    color: '#FFF',
    fontSize: 10,
    fontWeight: '700',
  },
  bundleDiscountChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: COLORS.gold,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 6,
    alignSelf: 'flex-start',
    marginBottom: 4,
  },
  bundleDiscountChipText: {
    color: COLORS.charcoalDeep,
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.3,
  },
  lineTotalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  lineTotalLabel: {
    fontSize: 12,
  },
  lineTotalValue: {
    fontSize: 14,
    fontWeight: '600',
  },
  actionsSection: {
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    paddingLeft: 8,
  },
  quantityControls: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 10,
    overflow: 'hidden',
  },
  bundleLockedIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
    gap: 6,
  },
  bundleLockedText: {
    fontSize: 12,
    fontWeight: '600',
  },
  qtyBtn: {
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  qtyBtnDisabled: {
    opacity: 0.4,
  },
  qtyText: {
    fontSize: 15,
    fontWeight: '700',
    paddingHorizontal: 8,
    minWidth: 30,
    textAlign: 'center',
  },
  removeBtn: {
    padding: 10,
    borderRadius: 10,
    marginTop: 8,
  },
  summaryContainer: {
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    marginTop: 8,
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  summaryLabel: {
    fontSize: 14,
  },
  summaryValue: {
    fontSize: 14,
    fontWeight: '500',
  },
  savingsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  savingsLabel: {
    fontSize: 14,
    fontWeight: '600',
  },
  savingsValue: {
    fontSize: 15,
    fontWeight: '700',
  },
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: 14,
    marginTop: 10,
    borderTopWidth: 1,
  },
  totalLabel: {
    ...TYPE.title,
    fontSize: 16,
  },
  totalValue: {
    ...TYPE.price,
    fontSize: 22,
  },
  checkoutBtnWrap: {
    marginTop: 16,
    borderRadius: RADII.sm,
    overflow: 'hidden',
  },
  checkoutBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingVertical: 16,
    borderRadius: RADII.sm,
  },
  checkoutBtnText: {
    ...TYPE.spacedButton,
    fontSize: 13,
  },
  // Modal Styles
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  modalContent: {
    width: '100%',
    maxWidth: 340,
    borderRadius: 20,
    padding: 24,
    alignItems: 'center',
    borderWidth: 1,
  },
  modalIconContainer: {
    width: 64,
    height: 64,
    borderRadius: 32,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: '700',
    marginBottom: 12,
    textAlign: 'center',
  },
  modalMessage: {
    fontSize: 15,
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 24,
  },
  modalButtons: {
    flexDirection: 'row',
    width: '100%',
    gap: 12,
  },
  modalButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    borderRadius: 12,
    gap: 8,
  },
  cancelButton: {
    borderWidth: 1,
  },
  cancelButtonText: {
    fontSize: 15,
    fontWeight: '600',
  },
  deleteButton: {
    backgroundColor: '#EF4444',
  },
  deleteButtonText: {
    color: '#FFF',
    fontSize: 15,
    fontWeight: '600',
  },
});

export default CartTab;
