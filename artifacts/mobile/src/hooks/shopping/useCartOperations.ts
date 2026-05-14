/**
 * useCartOperations - Cart manipulation operations hook
 * FIXED: Uses React Query mutations for real-time UI updates
 * ENHANCED: Optimistic updates with haptic feedback for instant UI response
 * Handles add, update, remove operations with immediate feedback
 */
import { useCallback } from 'react';
import * as Haptics from 'expo-haptics';
import { useCartMutations } from '../queries/useShoppingHubQuery';
import type { CartItem, CartItemProduct } from './types';

interface UseCartOperationsProps {
  cartItems: CartItem[];
  setLocalCartItems: (items: CartItem[]) => void;
  isAdminView: boolean;
  loadData: () => void;
}

export const useCartOperations = ({
  cartItems,
  setLocalCartItems,
  isAdminView,
  loadData,
}: UseCartOperationsProps) => {
  // Use React Query mutations for real-time updates
  const {
    updateQuantity: updateQuantityMutation,
    removeFromCart: removeFromCartMutation,
    addToCart: addToCartMutation,
    changeFitment: changeFitmentMutation,
  } = useCartMutations();

  // Safe array helper
  const safeCartItems = Array.isArray(cartItems) ? cartItems : [];

  /**
   * Remove item from cart - uses React Query mutation for instant UI update
   * Includes haptic feedback for better UX
   */
  const removeFromCart = useCallback(
    async (productId: string, fitmentIndicator?: string | null) => {
      const fi = fitmentIndicator ?? null;
      if (isAdminView) {
        // Admin view - just update local state with haptic feedback
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        setLocalCartItems(
          safeCartItems.filter(
            (item) =>
              !(item.product_id === productId &&
                ((item.fitment_indicator ?? null) === fi))
          )
        );
        return;
      }

      // Use mutation for optimistic update - haptic already triggered in CartTab
      try {
        await removeFromCartMutation.mutateAsync({ productId, fitmentIndicator: fi });
      } catch {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      }
    },
    [safeCartItems, setLocalCartItems, isAdminView, removeFromCartMutation]
  );

  /**
   * Update cart item quantity - uses React Query mutation for instant UI update
   */
  const updateCartQuantity = useCallback(
    async (productId: string, newQuantity: number, fitmentIndicator?: string | null) => {
      const fi = fitmentIndicator ?? null;
      if (newQuantity < 1) {
        removeFromCart(productId, fi);
        return;
      }

      if (isAdminView) {
        // Admin view - just update local state
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        setLocalCartItems(
          safeCartItems.map((item) =>
            item.product_id === productId &&
            ((item.fitment_indicator ?? null) === fi)
              ? { ...item, quantity: newQuantity }
              : item
          )
        );
        return;
      }

      // Use mutation for optimistic update
      try {
        await updateQuantityMutation.mutateAsync({ productId, quantity: newQuantity, fitmentIndicator: fi });
      } catch {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      }
    },
    [safeCartItems, setLocalCartItems, isAdminView, updateQuantityMutation, removeFromCart]
  );

  /**
   * Add product to cart - uses React Query mutation for instant UI update.
   * Honors product.fitment_indicator when present so the always-on chip
   * strip in CartTab can re-add a 0-qty fitment without losing the indicator
   * (otherwise the chip and the cart_item would disagree on which fitment
   * the row represents, and follow-up update/delete would silently no-op).
   */
  const addToCart = useCallback(
    async (product: CartItemProduct, quantity: number = 1) => {
      const fi: string | null = product?.fitment_indicator ?? null;
      const existing = safeCartItems.find(
        (item) =>
          item.product_id === product.id &&
          ((item.fitment_indicator ?? null) === fi),
      );

      if (existing) {
        await updateCartQuantity(product.id, existing.quantity + quantity, fi);
      } else {
        if (isAdminView) {
          const newItem: CartItem = {
            product_id: product.id,
            product: product,
            quantity: quantity,
            fitment_indicator: fi,
            original_unit_price: product.price,
            final_unit_price: product.price,
          };
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          setLocalCartItems([...safeCartItems, newItem]);
          return;
        }

        // Use mutation for optimistic update
        try {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          await addToCartMutation.mutateAsync({
            productId: product.id,
            quantity,
            fitmentIndicator: fi,
          });
        } catch {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        }
      }
    },
    [safeCartItems, setLocalCartItems, isAdminView, updateCartQuantity, addToCartMutation]
  );

  /**
   * Calculate cart totals
   */
  const getSubtotal = useCallback(() => {
    return safeCartItems.reduce((sum, item) => {
      const price = parseFloat(String(item.final_unit_price ?? item.product?.price ?? 0)) || 0;
      return sum + price * item.quantity;
    }, 0);
  }, [safeCartItems]);

  const getOriginalTotal = useCallback(() => {
    return safeCartItems.reduce((sum, item) => {
      const price = parseFloat(String(item.original_unit_price ?? item.product?.price ?? 0)) || 0;
      return sum + price * item.quantity;
    }, 0);
  }, [safeCartItems]);

  const getTotalSavings = useCallback(() => {
    // Only sum savings from bundle-discounted lines so non-bundle
    // discounts (e.g. owner manual discounts applied post-checkout)
    // are not accidentally shown as "Bundle savings".
    return safeCartItems.reduce((sum, item) => {
      if (!item.bundle_group_id) return sum;
      const original = parseFloat(String(item.original_unit_price ?? 0)) || 0;
      const final = parseFloat(String(item.final_unit_price ?? item.product?.price ?? 0)) || 0;
      const saving = (original - final) * item.quantity;
      return sum + (saving > 0 ? saving : 0);
    }, 0);
  }, [safeCartItems]);

  const getItemCount = useCallback(() => {
    return safeCartItems.reduce((sum, item) => sum + item.quantity, 0);
  }, [safeCartItems]);

  /**
   * Change the fitment indicator on an existing cart line.
   * Re-keys the line by (productId, newIndicator) and updates price live.
   */
  const changeFitment = useCallback(
    async (
      productId: string,
      oldIndicator: string | null,
      newIndicator: string,
      quantity: number,
    ) => {
      if ((oldIndicator ?? null) === newIndicator) return;
      if (isAdminView) {
        Haptics.selectionAsync().catch(() => {});
        const oldFi = oldIndicator ?? null;
        const target = safeCartItems.find(
          (i) => i.product_id === productId && (i.fitment_indicator ?? null) === oldFi,
        );
        if (!target) return;
        const variants = Array.isArray(target?.product?.available_variants)
          ? target.product.available_variants
          : Array.isArray(target?.available_variants)
            ? target.available_variants
            : [];
        const variant = variants.find((v) => v?.indicator === newIndicator);
        const newPrice =
          variant?.price !== undefined && variant?.price !== null
            ? parseFloat(String(variant.price))
            : (target.final_unit_price ?? target.product?.price ?? 0);
        const mergeIdx = safeCartItems.findIndex(
          (i) =>
            i !== target &&
            i.product_id === productId &&
            (i.fitment_indicator ?? null) === newIndicator,
        );
        const next = [...safeCartItems];
        const oldIdx = next.indexOf(target);
        if (mergeIdx >= 0) {
          next[mergeIdx] = {
            ...next[mergeIdx],
            quantity: (next[mergeIdx].quantity || 0) + (target.quantity || 0),
          };
          next.splice(oldIdx, 1);
        } else {
          next[oldIdx] = {
            ...target,
            fitment_indicator: newIndicator,
            original_unit_price: newPrice,
            final_unit_price: newPrice,
            product: target.product
              ? { ...target.product, fitment_indicator: newIndicator, price: newPrice }
              : target.product,
          };
        }
        setLocalCartItems(next);
        return;
      }

      try {
        Haptics.selectionAsync().catch(() => {});
        // Capture whether the new-variant line already existed BEFORE the swap
        // so the mutation can compensate safely on partial failure (it should
        // never delete pre-existing user data).
        const existingNewLine = safeCartItems.find(
          (i) =>
            i.product_id === productId &&
            (i.fitment_indicator ?? null) === newIndicator,
        );
        await changeFitmentMutation.mutateAsync({
          productId,
          oldIndicator: oldIndicator ?? null,
          newIndicator,
          quantity: Math.max(1, quantity || 1),
          newLineExisted: !!existingNewLine,
          existingNewLineQty: existingNewLine?.quantity ?? 0,
        });
      } catch {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      }
    },
    [isAdminView, safeCartItems, setLocalCartItems, changeFitmentMutation],
  );

  return {
    safeCartItems,
    updateCartQuantity,
    removeFromCart,
    addToCart,
    changeFitment,
    getSubtotal,
    getOriginalTotal,
    getTotalSavings,
    getItemCount,
  };
};

export default useCartOperations;
