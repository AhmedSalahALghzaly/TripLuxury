/**
 * useOrderOperations - Order management operations hook
 * Handles order submission and status updates
 */
import { useState, useCallback } from 'react';
import { Alert } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { useAppStore } from '../../store/appStore';
import { orderApi } from '../../services/api';
import api from '../../services/api';
import { shoppingHubKeys } from '../queries/useShoppingHubQuery';
import { useStatusToastQueue } from './useStatusToastQueue';
import type { CartItem, Order } from './types';

const STATUS_LABELS: Record<string, { en: string; ar: string }> = {
  pending: { en: 'pending', ar: 'قيد الانتظار' },
  preparing: { en: 'preparing', ar: 'قيد التحضير' },
  shipped: { en: 'shipped', ar: 'تم الشحن' },
  out_for_delivery: { en: 'out for delivery', ar: 'في الطريق' },
  delivered: { en: 'delivered', ar: 'تم التسليم' },
  cancelled: { en: 'cancelled', ar: 'ملغي' },
};

export interface CheckoutForm {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  streetAddress: string;
  city: string;
  state: string;
  country: string;
  deliveryInstructions: string;
  paymentMethod: string;
  deliveryLatitude: number | null;
  deliveryLongitude: number | null;
}

interface UseOrderOperationsProps {
  cartItems: CartItem[];
  setLocalCartItems: (items: CartItem[]) => void;
  setOrders: (orders: Order[]) => void;
  customerId?: string;
  isAdminView: boolean;
  language: string;
}

export const useOrderOperations = ({
  cartItems,
  setLocalCartItems,
  setOrders,
  customerId,
  isAdminView,
  language,
}: UseOrderOperationsProps) => {
  const userRole = useAppStore((state) => state.userRole);
  const queryClient = useQueryClient();

  const [checkoutForm, setCheckoutForm] = useState<CheckoutForm>({
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
    streetAddress: '',
    city: '',
    state: '',
    country: 'Egypt',
    deliveryInstructions: '',
    paymentMethod: 'cash_on_delivery',
    deliveryLatitude: null,
    deliveryLongitude: null,
  });
  const [submittingOrder, setSubmittingOrder] = useState(false);
  const [updatingOrderId, setUpdatingOrderId] = useState<string | null>(null);
  const [showOrderConfirmation, setShowOrderConfirmation] = useState(false);
  const [confirmedOrder, setConfirmedOrder] = useState<Order | null>(null);
  const { statusToasts, pushStatusToast, dismissStatusToast } = useStatusToastQueue();

  const safeCartItems = Array.isArray(cartItems) ? cartItems : [];

  // Check if user can edit order status
  const canEditOrderStatus = ['owner', 'partner', 'admin'].includes(userRole);

  /**
   * Pre-fill checkout form with user data
   */
  const prefillForm = useCallback((userData: { name?: string; email?: string; phone?: string } | null | undefined) => {
    if (userData) {
      setCheckoutForm((prev) => ({
        ...prev,
        firstName: userData.name?.split(' ')[0] || '',
        lastName: userData.name?.split(' ').slice(1).join(' ') || '',
        email: userData.email || '',
        phone: userData.phone || '',
      }));
    }
  }, []);

  /**
   * Submit order
   */
  const handleSubmitOrder = useCallback(async () => {
    if (
      !checkoutForm.firstName ||
      !checkoutForm.phone ||
      !checkoutForm.streetAddress ||
      !checkoutForm.city
    ) {
      Alert.alert(
        language === 'ar' ? 'خطأ' : 'Error',
        language === 'ar'
          ? 'يرجى ملء جميع الحقول المطلوبة'
          : 'Please fill all required fields'
      );
      return false;
    }

    if (safeCartItems.length === 0) {
      Alert.alert(
        language === 'ar' ? 'السلة فارغة' : 'Cart Empty',
        language === 'ar'
          ? 'أضف منتجات للسلة أولاً'
          : 'Add products to cart first'
      );
      return false;
    }

    setSubmittingOrder(true);
    try {
      let response;

      if (isAdminView && customerId) {
        // Admin creating order for customer
        const orderPayload = {
          user_id: customerId,
          first_name: checkoutForm.firstName,
          last_name: checkoutForm.lastName,
          email: checkoutForm.email,
          phone: checkoutForm.phone,
          street_address: checkoutForm.streetAddress,
          city: checkoutForm.city,
          state: checkoutForm.state,
          country: checkoutForm.country,
          delivery_instructions: checkoutForm.deliveryInstructions,
          payment_method: checkoutForm.paymentMethod,
          delivery_latitude: checkoutForm.deliveryLatitude ?? undefined,
          delivery_longitude: checkoutForm.deliveryLongitude ?? undefined,
          delivery_address: checkoutForm.streetAddress || undefined,
          items: safeCartItems.map((item) => ({
            product_id: item.product_id,
            quantity: item.quantity,
          })),
        };
        response = await api.post('/orders/admin/create', orderPayload);
      } else {
        // Customer placing own order
        response = await orderApi.create({
          first_name: checkoutForm.firstName,
          last_name: checkoutForm.lastName,
          email: checkoutForm.email,
          phone: checkoutForm.phone,
          street_address: checkoutForm.streetAddress,
          city: checkoutForm.city,
          state: checkoutForm.state,
          country: checkoutForm.country,
          delivery_instructions: checkoutForm.deliveryInstructions,
          payment_method: checkoutForm.paymentMethod,
          delivery_latitude: checkoutForm.deliveryLatitude ?? undefined,
          delivery_longitude: checkoutForm.deliveryLongitude ?? undefined,
          delivery_address: checkoutForm.streetAddress || undefined,
        });
      }

      setConfirmedOrder(response.data as Order);
      setShowOrderConfirmation(true);
      setLocalCartItems([]);

      // Clear the React Query cart cache immediately so CartTab shows empty
      // and the Footer badge resets to zero without waiting for a refetch.
      if (!isAdminView) {
        queryClient.setQueryData(shoppingHubKeys.cart, []);
        queryClient.invalidateQueries({ queryKey: shoppingHubKeys.cart });
      } else if (isAdminView && customerId) {
        queryClient.setQueryData(shoppingHubKeys.customerCart(customerId), []);
        queryClient.invalidateQueries({ queryKey: shoppingHubKeys.customerCart(customerId) });
      }

      // Invalidate orders cache so the Orders tab refreshes automatically.
      if (isAdminView && customerId) {
        queryClient.invalidateQueries({ queryKey: shoppingHubKeys.customerOrders(customerId) });
      }
      queryClient.invalidateQueries({ queryKey: shoppingHubKeys.orders });
      setOrders([]);

      return true;
    } catch {
      Alert.alert(
        language === 'ar' ? 'خطأ' : 'Error',
        language === 'ar' ? 'فشل إنشاء الطلب' : 'Failed to create order'
      );
      return false;
    } finally {
      setSubmittingOrder(false);
    }
  }, [checkoutForm, safeCartItems, isAdminView, customerId, language, setLocalCartItems, setOrders, queryClient]);

  /**
   * Invalidate all order-related caches that should reflect a status change
   * (the admin-view Shopping Hub and the owner analytics dashboard).
   */
  const invalidateOrderCaches = useCallback(() => {
    if (isAdminView && customerId) {
      queryClient.invalidateQueries({ queryKey: shoppingHubKeys.customerOrders(customerId) });
      queryClient.invalidateQueries({ queryKey: shoppingHubKeys.customerProfileBundle(customerId) });
    }
    queryClient.invalidateQueries({ queryKey: shoppingHubKeys.orders });
    queryClient.invalidateQueries({ queryKey: ['ra-orders'] });
  }, [isAdminView, customerId, queryClient]);

  /**
   * Revert an order back to a previous status. Used by the "Undo" action
   * surfaced in the success toast right after a status change.
   */
  const revertOrderStatus = useCallback(
    async (orderId: string, previousStatus: string, orderRef: string) => {
      try {
        await api.patch(`/orders/${orderId}/status?status=${previousStatus}`);
        invalidateOrderCaches();
        const previousLabel =
          STATUS_LABELS[previousStatus]?.[language === 'ar' ? 'ar' : 'en'] ||
          previousStatus;
        const message =
          language === 'ar'
            ? `تم التراجع: الطلب ${orderRef} ← ${previousLabel}`
            : `Reverted: Order ${orderRef} → ${previousLabel}`;
        pushStatusToast(
          'neutral',
          `${orderId}_${previousStatus}_revert`,
          message,
        );
      } catch (error: unknown) {
        const err = error as { response?: { data?: { message?: string; error?: string } }; message?: string };
        const reason =
          err?.response?.data?.message ||
          err?.response?.data?.error ||
          err?.message ||
          (language === 'ar' ? 'خطأ غير معروف' : 'Unknown error');
        const message =
          language === 'ar'
            ? `فشل التراجع عن الطلب ${orderRef}: ${reason}`
            : `Failed to undo order ${orderRef}: ${reason}`;
        pushStatusToast(
          'error',
          `${orderId}_${previousStatus}_revert_error`,
          message,
        );
      }
    },
    [invalidateOrderCaches, language, pushStatusToast],
  );

  /**
   * Update order status (admin only)
   */
  const updateOrderStatus = useCallback(
    async (orderId: string, newStatus: string, orders: Order[]) => {
      setUpdatingOrderId(orderId + '_' + newStatus);
      const order = orders.find((o) => o.id === orderId);
      const orderRef =
        order?.order_number != null
          ? `#${order.order_number}`
          : `#${String(orderId).slice(0, 6)}`;
      const statusLabel =
        STATUS_LABELS[newStatus]?.[language === 'ar' ? 'ar' : 'en'] || newStatus;
      // Capture the previous status BEFORE the PATCH so the toast's Undo
      // action can restore it. If the order is missing from the local cache
      // or already at the target status, we skip the undo affordance.
      const previousStatus: string | undefined =
        typeof order?.status === 'string' && order.status !== newStatus
          ? order.status
          : undefined;
      try {
        // 1 second loading feedback as per requirement
        await new Promise((resolve) => setTimeout(resolve, 1000));
        await api.patch(`/orders/${orderId}/status?status=${newStatus}`);

        // Optimistic local update for the legacy `setOrders` consumer.
        const updatedOrders: Order[] = orders.map((o) =>
          o.id === orderId ? { ...o, status: newStatus } : o
        );
        setOrders(updatedOrders);

        // Invalidate React Query caches so the Shopping Hub (admin-view of
        // a customer's profile) and the global owner orders dashboard both
        // re-fetch and reflect the change without waiting for a WS round-trip.
        // The WebSocket `order_updated` event will also invalidate these on
        // arrival; the explicit invalidation here guarantees an immediate
        // refresh on the device that triggered the change.
        invalidateOrderCaches();

        const message =
          language === 'ar'
            ? `الطلب ${orderRef} ← ${statusLabel}`
            : `Order ${orderRef} → ${statusLabel}`;
        const undo = previousStatus
          ? {
              label: language === 'ar' ? 'تراجع' : 'Undo',
              onPress: () =>
                revertOrderStatus(orderId, previousStatus, orderRef),
            }
          : undefined;
        pushStatusToast(
          'success',
          `${orderId}_${newStatus}_success`,
          message,
          undo,
        );
      } catch (error: unknown) {
        const err = error as { response?: { data?: { message?: string; error?: string } }; message?: string };
        const reason =
          err?.response?.data?.message ||
          err?.response?.data?.error ||
          err?.message ||
          (language === 'ar' ? 'خطأ غير معروف' : 'Unknown error');
        const message =
          language === 'ar'
            ? `فشل تحديث الطلب ${orderRef}: ${reason}`
            : `Failed to update order ${orderRef}: ${reason}`;
        pushStatusToast('error', `${orderId}_${newStatus}_error`, message);
      } finally {
        setUpdatingOrderId(null);
      }
    },
    [setOrders, invalidateOrderCaches, language, pushStatusToast, revertOrderStatus]
  );

  /**
   * Close confirmation modal
   */
  const closeOrderConfirmation = useCallback(() => {
    setShowOrderConfirmation(false);
  }, []);

  return {
    checkoutForm,
    setCheckoutForm,
    submittingOrder,
    updatingOrderId,
    showOrderConfirmation,
    confirmedOrder,
    canEditOrderStatus,
    prefillForm,
    handleSubmitOrder,
    updateOrderStatus,
    closeOrderConfirmation,
    statusToasts,
    dismissStatusToast,
  };
};

export default useOrderOperations;
