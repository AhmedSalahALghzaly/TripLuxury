/**
 * Shopping Hub Query Hooks with React Query
 * Provides data fetching for cart, favorites, and orders
 * Uses centralized query keys for cache management
 * 
 * ENHANCED: Bundle duplicate prevention with professional Arabic alerts
 * FIXED: Enhanced cache invalidation for real-time state synchronization
 * FIXED: Removed Zustand updates from queryFn to prevent infinite re-renders
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef } from 'react';
import { Alert, Platform } from 'react-native';
import * as Haptics from 'expo-haptics';
import { useAppStore } from '../../store/appStore';
import { cartApi, favoriteApi, orderApi } from '../../services/api';
import api from '../../services/api';
import { queryKeys } from '../../lib/queryClient';
import type { CartItem, Favorite, Order, ProfileData } from '../shopping/types';

// ---------------------------------------------------------------------------
// Typed API response shapes — narrows the implicit `any` from axios so that
// property accesses on response.data are checked at compile time.
// ---------------------------------------------------------------------------

interface CartApiResponse {
  items?: CartItem[];
}

interface OrdersApiResponse {
  orders?: Order[];
}

interface FavoritesApiResponse {
  favorites?: unknown[];
}

interface AdminProfileBundleApiResponse {
  profile?: ProfileData;
  favorites?: unknown[];
  cart?: CartItem[];
  orders?: Order[];
  server_timing_ms?: number;
}

interface AdminCartApiResponse {
  cart?: CartItem[];
  items?: CartItem[];
}

interface AdminFavoritesApiResponse {
  favorites?: unknown[];
}

interface AdminOrdersApiResponse {
  orders?: Order[];
}

// ---------------------------------------------------------------------------
// Return type for fetchCustomerProfileBundle so callers are typed
// ---------------------------------------------------------------------------

export interface CustomerProfileBundle {
  profile: ProfileData | null;
  favorites: Favorite[];
  cart: CartItem[];
  orders: Order[];
}

// Extended query keys for shopping hub
export const shoppingHubKeys = {
  all: ['shoppingHub'] as const,
  favorites: queryKeys.favorites.all,
  cart: queryKeys.cart.current,
  orders: queryKeys.orders.all,
  customerFavorites: (customerId: string) => ['shoppingHub', 'customerFavorites', customerId] as const,
  customerCart: (customerId: string) => ['shoppingHub', 'customerCart', customerId] as const,
  customerOrders: (customerId: string) => ['shoppingHub', 'customerOrders', customerId] as const,
  customerProfileBundle: (customerId: string) => ['shoppingHub', 'customerProfileBundle', customerId] as const,
};

/**
 * Fetch the aggregated admin profile bundle (profile+favorites+cart+orders)
 * for a customer. Exported so it can be used in `prefetchQuery` from list screens.
 */
export async function fetchCustomerProfileBundle(customerId: string): Promise<CustomerProfileBundle> {
  const t0 = Date.now();
  const response = await api.get<AdminProfileBundleApiResponse>(`/customers/admin/customer/${customerId}/profile-bundle`);
  const elapsed = Date.now() - t0;
  const data: AdminProfileBundleApiResponse = response.data ?? {};
  const serverMs = typeof data.server_timing_ms === 'number' ? data.server_timing_ms : null;
  // eslint-disable-next-line no-console
  console.log(
    `[ProfileBundle] client fetch user=${customerId} in ${elapsed}ms` +
      (serverMs !== null ? ` (server ${serverMs}ms)` : ''),
  );
  return {
    profile: data.profile ?? null,
    favorites: processFavoritesData(data.favorites ?? []),
    cart: data.cart ?? [],
    orders: data.orders ?? [],
  };
}

/**
 * Processes favorites data to ensure consistent structure
 */
const processFavoritesData = (favoritesData: unknown[]): Favorite[] => {
  return (favoritesData as Array<Record<string, unknown>>).map((fav) => ({
    ...(fav as Omit<Favorite, 'product_id' | 'product'>),
    product_id: (fav.product_id || (fav.product as { id?: string } | undefined)?.id || '') as string,
    product: (fav.product as Favorite['product']) || {
      id: fav.product_id as string,
      name: fav.name as string,
      name_ar: fav.name_ar as string | undefined,
      price: fav.price as number | string,
      image_url: fav.image_url as string | null | undefined,
      sku: fav.sku as string | undefined,
      stock_quantity: fav.stock_quantity as number | undefined,
      car_model_ids: (fav.car_model_ids as string[]) || [],
      fitment_indicator: fav.fitment_indicator as string | null | undefined,
      product_brand_name: fav.product_brand_name as string | null | undefined,
      compatible_car_models: (fav.compatible_car_models as unknown[]) || [],
    },
  }));
};

/**
 * Hook to fetch user's favorites
 */
export function useFavoritesQuery(enabled = true) {
  return useQuery({
    queryKey: shoppingHubKeys.favorites,
    queryFn: async (): Promise<Favorite[]> => {
      const response = await favoriteApi.getAll();
      const body = response.data as FavoritesApiResponse | Favorite[];
      const favoritesData: unknown[] = Array.isArray(body)
        ? body
        : (body as FavoritesApiResponse).favorites ?? [];
      return processFavoritesData(favoritesData);
    },
    enabled,
    staleTime: 2 * 60 * 1000, // 2 minutes
  });
}

/**
 * Hook to fetch user's cart
 * FIXED: Removed setCartItems from queryFn to prevent infinite re-renders
 */
export function useCartQuery(enabled = true) {
  return useQuery({
    queryKey: shoppingHubKeys.cart,
    queryFn: async (): Promise<CartItem[]> => {
      const response = await cartApi.get();
      const body = response.data as CartApiResponse;
      return body?.items ?? [];
    },
    enabled,
    staleTime: 60 * 1000, // 1 minute
  });
}

/**
 * Hook to fetch user's orders.
 *
 * For privileged roles (owner / admin / partner) we fetch ALL orders via the
 * `/api/orders/admin` endpoint so the Cart → Orders tab actually shows the
 * orders they can manage (instead of being empty when the manager has not
 * personally placed any orders). Regular users still see only their own.
 *
 * The query key carries a `self|admin` discriminator so React Query keeps
 * the two scopes cached independently and prefix-based invalidations on
 * `['orders']` continue to work for both.
 */
export function useOrdersQuery(enabled = true) {
  const userRole = useAppStore((state) => state.userRole);
  const isPrivileged = ['owner', 'admin', 'partner'].includes(userRole ?? '');
  return useQuery({
    queryKey: [...shoppingHubKeys.orders, isPrivileged ? 'admin' : 'self'] as const,
    queryFn: async (): Promise<Order[]> => {
      if (isPrivileged) {
        const res = await api.get<AdminOrdersApiResponse>('/orders/admin');
        const list: Order[] = Array.isArray(res.data?.orders) ? res.data.orders : [];
        return list.map((o) => ({ ...o, items: o.items ?? [] }));
      }
      const response = await orderApi.getAll();
      const body = response.data as Order[] | OrdersApiResponse;
      const list: Order[] = Array.isArray(body)
        ? body
        : (body as OrdersApiResponse).orders ?? [];
      return list;
    },
    enabled,
    staleTime: 2 * 60 * 1000, // 2 minutes
  });
}

/**
 * Hook to fetch customer data for admin view.
 *
 * Uses three independent queries (favorites / cart / orders) so each tab
 * fetches and caches its own data independently.  A single failing request
 * can no longer silently zero-out the other tabs, and stale-cache hits on
 * one resource do not block fresh data for the others.
 */
export function useCustomerShoppingDataQuery(customerId: string | undefined, enabled = true) {
  const id = customerId ?? '';
  const isEnabled = enabled && !!id;

  const favoritesQuery = useQuery({
    queryKey: shoppingHubKeys.customerFavorites(id),
    queryFn: async (): Promise<Favorite[]> => {
      const res = await api.get<AdminFavoritesApiResponse>(`/customers/admin/customer/${id}/favorites`);
      return processFavoritesData(res.data?.favorites ?? []);
    },
    enabled: isEnabled,
    staleTime: 2 * 60 * 1000,
  });

  const cartQuery = useQuery({
    queryKey: shoppingHubKeys.customerCart(id),
    queryFn: async (): Promise<CartItem[]> => {
      const res = await api.get<AdminCartApiResponse>(`/customers/admin/customer/${id}/cart`);
      return res.data?.cart ?? res.data?.items ?? [];
    },
    enabled: isEnabled,
    staleTime: 60 * 1000,
  });

  const ordersQuery = useQuery({
    queryKey: shoppingHubKeys.customerOrders(id),
    queryFn: async (): Promise<Order[]> => {
      const res = await api.get<AdminOrdersApiResponse>(`/customers/admin/customer/${id}/orders`);
      const list: Order[] = res.data?.orders ?? [];
      return list.map((o) => ({ ...o, items: o.items ?? [] }));
    },
    enabled: isEnabled,
    staleTime: 2 * 60 * 1000,
  });

  // Lightweight profile fetch so the hub header shows the customer's name
  // when an admin navigates via /cart?customerId=…&tab=orders (no customerData prop).
  const profileQuery = useQuery({
    queryKey: ['shoppingHub', 'customerProfile', id] as const,
    queryFn: async (): Promise<ProfileData | null> => {
      const res = await api.get<AdminProfileBundleApiResponse>(`/customers/admin/customer/${id}/profile-bundle`);
      return res.data?.profile ?? null;
    },
    enabled: isEnabled,
    staleTime: 5 * 60 * 1000,
    // Profile is secondary — don't mark the whole hook as loading/error for it.
    notifyOnChangeProps: ['data'],
  });

  const refetch = useCallback(async () => {
    await Promise.all([
      favoritesQuery.refetch(),
      cartQuery.refetch(),
      ordersQuery.refetch(),
    ]);
  }, [favoritesQuery, cartQuery, ordersQuery]);

  return {
    profile: profileQuery.data ?? null,
    favorites: favoritesQuery.data ?? [] as Favorite[],
    cart: cartQuery.data ?? [] as CartItem[],
    orders: ordersQuery.data ?? [] as Order[],
    isLoading: favoritesQuery.isLoading || cartQuery.isLoading || ordersQuery.isLoading,
    isFetching: favoritesQuery.isFetching || cartQuery.isFetching || ordersQuery.isFetching,
    isError: favoritesQuery.isError || cartQuery.isError || ordersQuery.isError,
    refetch,
    isRefetching: favoritesQuery.isRefetching || cartQuery.isRefetching || ordersQuery.isRefetching,
  };
}

/**
 * Combined hook for shopping hub data (user's own data)
 * FIXED: Returns data directly from React Query without Zustand sync in queryFn
 */
export function useShoppingHubQuery(enabled = true) {
  const user = useAppStore((state) => state.user);
  const favoritesQuery = useFavoritesQuery(enabled && !!user);
  const cartQuery = useCartQuery(enabled && !!user);
  const ordersQuery = useOrdersQuery(enabled && !!user);

  const isLoading = favoritesQuery.isLoading || cartQuery.isLoading || ordersQuery.isLoading;
  const isRefetching = favoritesQuery.isRefetching || cartQuery.isRefetching || ordersQuery.isRefetching;

  const refetch = useCallback(async () => {
    await Promise.all([
      favoritesQuery.refetch(),
      cartQuery.refetch(),
      ordersQuery.refetch(),
    ]);
  }, [favoritesQuery, cartQuery, ordersQuery]);

  return {
    favorites: favoritesQuery.data || [] as Favorite[],
    cartItems: cartQuery.data || [] as CartItem[],
    orders: ordersQuery.data || [] as Order[],
    isLoading,
    isRefetching,
    isError: favoritesQuery.isError || cartQuery.isError || ordersQuery.isError,
    refetch,
    profileData: user,
  };
}

/**
 * Hook for cart mutations (add, update, remove)
 * ENHANCED: Bidirectional duplicate prevention - prevents adding duplicates in BOTH directions:
 *   1. Prevent adding a product as Normal Item if it exists in cart as Bundle Item
 *   2. Prevent adding a product to Bundle if it exists in cart as Normal Item
 * FIXED: Enhanced cache invalidation for immediate UI updates
 */
export function useCartMutations() {
  const queryClient = useQueryClient();
  const language = useAppStore((state) => state.language);

  // Debounce cart invalidation so rapid quantity taps (+ / −) don't trigger
  // a mid-flight refetch that returns stale server state and overwrites the
  // optimistic update from the next pending mutation. The refetch only fires
  // after the user pauses for 500 ms. Error rollbacks are unaffected — they
  // still happen immediately via onError → setQueryData.
  const invalidateTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // True while a removeFromCart mutation is in-flight. When set, the debounced
  // scheduleCartInvalidate becomes a no-op so a lagging updateQuantity.onSettled
  // (which fires after removeFromCart.onMutate has already cleared the old timer)
  // cannot schedule a new 500ms refetch that would restore the just-deleted item.
  const deleteInProgressRef = useRef(false);
  const scheduleCartInvalidate = useCallback(() => {
    if (deleteInProgressRef.current) return; // delete owns the cache — skip debounce
    if (invalidateTimerRef.current) clearTimeout(invalidateTimerRef.current);
    invalidateTimerRef.current = setTimeout(() => {
      invalidateTimerRef.current = null;
      queryClient.invalidateQueries({ queryKey: shoppingHubKeys.cart });
    }, 500);
  }, [queryClient]);
  // Clear any pending debounced invalidation when the hook unmounts to avoid
  // stale delayed refetches after navigation away from the cart screen.
  useEffect(() => () => {
    if (invalidateTimerRef.current) clearTimeout(invalidateTimerRef.current);
  }, []);

  /**
   * BIDIRECTIONAL: Check if product already exists in cart AT ALL
   * Used by /offer/[id] flow which intentionally blocks all duplicates
   * (a product can't be added to a bundle if it's already in the cart in any form,
   * and a bundle product can't be added separately if it's already in a bundle).
   * @param productId - The product ID to check
   * @returns true if product exists in cart (as bundle OR normal item)
   */
  const checkDuplicate = (productId: string): boolean => {
    const cartData = queryClient.getQueryData<CartItem[]>(shoppingHubKeys.cart);
    if (!cartData) return false;
    return cartData.some(item => item.product_id === productId);
  };

  /**
   * Legacy alias for backward compatibility
   * @deprecated Use checkDuplicate instead
   */
  const checkBundleDuplicate = checkDuplicate;

  /**
   * BUNDLE-ONLY conflict check: blocks adding a product as a regular item
   * ONLY when it is already in the cart as part of a bundle. Non-bundle duplicates
   * are allowed (the cart store merges them by fitment indicator into the same
   * grouped cart card with per-fitment quantity badges).
   * @param productId - The product ID to check
   * @returns true if product is currently in cart as a bundle item (block add)
   */
  const checkBundleConflict = (productId: string): boolean => {
    const cartData = queryClient.getQueryData<CartItem[]>(shoppingHubKeys.cart);
    if (!cartData) return false;
    return cartData.some(
      (item) => item.product_id === productId && !!item.bundle_group_id,
    );
  };

  /**
   * Show professional alert for duplicate product
   */
  const showDuplicateAlert = () => {
    if (Platform.OS !== 'web') {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    }
    
    Alert.alert(
      language === 'ar' ? 'تنبيه' : 'Notice',
      'عرض المنتج تم اضافته بالفعل',
      [
        {
          text: language === 'ar' ? 'حسناً' : 'OK',
          style: 'default',
        },
      ],
      { cancelable: true }
    );
  };

  /**
   * Legacy alias for backward compatibility
   * @deprecated Use showDuplicateAlert instead
   */
  const showBundleDuplicateAlert = showDuplicateAlert;

  const addToCart = useMutation({
    mutationFn: async (
      arg: string | { productId: string; quantity?: number; fitmentIndicator?: string | null; product?: CartItem['product'] },
    ) => {
      const productId = typeof arg === 'string' ? arg : arg.productId;
      const quantity = typeof arg === 'string' ? 1 : (arg.quantity ?? 1);
      const fi = typeof arg === 'string' ? null : (arg.fitmentIndicator ?? null);
      // BUNDLE-ONLY: only block if the product is already in the cart as a bundle item.
      // Non-bundle duplicates are allowed — the cart will merge them into the same
      // grouped product card with per-fitment quantity badges.
      if (checkBundleConflict(productId)) {
        showDuplicateAlert();
        throw new Error('DUPLICATE_PRODUCT');
      }
      return cartApi.addItem(productId, quantity, fi);
    },
    // Optimistic 0→1: instantly insert the row into the cart cache so the
    // counter / Footer badge / cart screen flips before the network roundtrip.
    // Server response (onSuccess) invalidates and replaces with authoritative
    // data including final quantity, brand_name and compatible_car_models.
    onMutate: async (arg) => {
      if (typeof arg === 'string') {
        // Legacy string-only call has no product hint — skip optimistic patch.
        return { previousCart: undefined as CartItem[] | undefined };
      }
      const productId = arg.productId;
      const quantity = arg.quantity ?? 1;
      const fi = arg.fitmentIndicator ?? null;
      const product = arg.product;
      if (!product) {
        return { previousCart: undefined as CartItem[] | undefined };
      }

      await queryClient.cancelQueries({ queryKey: shoppingHubKeys.cart });
      const previousCart = queryClient.getQueryData<CartItem[]>(shoppingHubKeys.cart);

      queryClient.setQueryData<CartItem[]>(shoppingHubKeys.cart, (old) => {
        const list: CartItem[] = Array.isArray(old) ? [...old] : [];
        const matchIdx = list.findIndex(
          (it) =>
            it?.product_id === productId &&
            ((it?.fitment_indicator ?? null) === fi),
        );
        if (matchIdx >= 0) {
          // Should not happen for 0→1 (already would have been handled by
          // updateQuantity), but be defensive: just bump quantity.
          list[matchIdx] = {
            ...list[matchIdx],
            quantity: (Number(list[matchIdx].quantity) || 0) + quantity,
          };
          return list;
        }
        // Insert a fresh optimistic row. Mark with __optimistic so anyone
        // inspecting can tell it isn't authoritative yet.
        list.push({
          __optimistic: true,
          product_id: productId,
          quantity,
          fitment_indicator: fi,
          price: Number(product.price) || 0,
          name: product.name,
          name_ar: product.name_ar,
          image_url: product.image_url,
          sku: product.sku,
          stock_quantity: product.stock_quantity,
          // Best-effort enrichment so the cart card renders fully even
          // before the server roundtrip; server response will overwrite.
          product_brand_name: product.product_brand_name ?? product.brand_name ?? null,
          compatible_car_models: product.compatible_car_models ?? [],
        });
        return list;
      });

      return { previousCart };
    },
    onSuccess: () => {
      scheduleCartInvalidate();
    },
    onError: (error: unknown, _variables, context) => {
      const err = error as { message?: string; response?: { data?: { detail?: string; stock?: number } } };
      // Roll back the optimistic insert if we did one.
      if (context && (context as { previousCart?: CartItem[] }).previousCart !== undefined) {
        queryClient.setQueryData(shoppingHubKeys.cart, (context as { previousCart?: CartItem[] }).previousCart);
      }
      // Don't show error for duplicate - already handled
      if (err?.message === 'DUPLICATE_PRODUCT' || err?.message === 'BUNDLE_DUPLICATE') {
        return;
      }
      const detail = err?.response?.data?.detail;
      if (detail === 'out_of_stock') {
        if (Platform.OS !== 'web') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        Alert.alert(
          language === 'ar' ? 'نفذ المخزون' : 'Out of Stock',
          language === 'ar'
            ? 'هذا المنتج غير متوفر حالياً في المخزون'
            : 'This product is currently out of stock',
          [{ text: language === 'ar' ? 'حسناً' : 'OK', style: 'default' }],
          { cancelable: true },
        );
        return;
      }
      if (detail === 'stock_exceeded') {
        const stock = err?.response?.data?.stock ?? 0;
        if (Platform.OS !== 'web') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
        Alert.alert(
          language === 'ar' ? 'الكمية تتجاوز المخزون' : 'Exceeds Available Stock',
          language === 'ar'
            ? `لا يمكن إضافة أكثر من ${stock} من هذا المنتج`
            : `Cannot add more than ${stock} of this product`,
          [{ text: language === 'ar' ? 'حسناً' : 'OK', style: 'default' }],
          { cancelable: true },
        );
        return;
      }
      console.error('[useCartMutations] Add to cart error:', error);
    },
  });

  const updateQuantity = useMutation({
    mutationFn: async ({ productId, quantity, fitmentIndicator }: { productId: string; quantity: number; fitmentIndicator?: string | null }) => {
      return cartApi.update(productId, quantity, fitmentIndicator ?? null);
    },
    onMutate: async ({ productId, quantity, fitmentIndicator }) => {
      // Cancel any outgoing refetches
      await queryClient.cancelQueries({ queryKey: shoppingHubKeys.cart });
      
      // Snapshot previous value
      const previousCart = queryClient.getQueryData<CartItem[]>(shoppingHubKeys.cart);
      const fi = fitmentIndicator ?? null;
      
      // Optimistically update the cache immediately (fitment-scoped)
      queryClient.setQueryData<CartItem[]>(shoppingHubKeys.cart, (old) => {
        if (!old) return old;
        const matches = (item: CartItem) =>
          item.product_id === productId &&
          ((item.fitment_indicator ?? null) === fi);
        if (quantity <= 0) {
          return old.filter(item => !matches(item));
        }
        return old.map(item =>
          matches(item) ? { ...item, quantity } : item
        );
      });
      
      return { previousCart };
    },
    onError: (err: unknown, _variables, context) => {
      // Rollback optimistic update on error
      if (context?.previousCart) {
        queryClient.setQueryData(shoppingHubKeys.cart, context.previousCart);
      }
      const apiErr = err as { response?: { data?: { detail?: string; stock?: number; capped?: number } } };
      const detail = apiErr?.response?.data?.detail;
      if (detail === 'stock_exceeded' || detail === 'out_of_stock') {
        const stock = apiErr?.response?.data?.stock ?? apiErr?.response?.data?.capped ?? 0;
        if (Platform.OS !== 'web') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
        Alert.alert(
          language === 'ar' ? 'الكمية تتجاوز المخزون' : 'Exceeds Available Stock',
          language === 'ar'
            ? stock > 0
              ? `الكمية المتاحة ${stock} فقط من هذا المنتج`
              : 'هذا المنتج نفذ من المخزون'
            : stock > 0
              ? `Only ${stock} available in stock`
              : 'This product is out of stock',
          [{ text: language === 'ar' ? 'حسناً' : 'OK', style: 'default' }],
          { cancelable: true },
        );
      }
    },
    onSettled: () => {
      // Debounced so rapid + / − taps don't fire a refetch mid-flight.
      scheduleCartInvalidate();
    },
  });

  const removeFromCart = useMutation({
    mutationFn: async (arg: string | { productId: string; fitmentIndicator?: string | null }) => {
      if (typeof arg === 'string') {
        return cartApi.remove(arg, null);
      }
      return cartApi.remove(arg.productId, arg.fitmentIndicator ?? null);
    },
    onMutate: async (arg) => {
      const productId = typeof arg === 'string' ? arg : arg.productId;
      const fi = typeof arg === 'string' ? null : (arg.fitmentIndicator ?? null);
      // Mark delete in-progress so any lagging updateQuantity.onSettled calls
      // that fire after this point cannot schedule a new debounce timer.
      deleteInProgressRef.current = true;
      // Clear any pending debounce invalidation from a prior quantity change.
      if (invalidateTimerRef.current) {
        clearTimeout(invalidateTimerRef.current);
        invalidateTimerRef.current = null;
      }
      await queryClient.cancelQueries({ queryKey: shoppingHubKeys.cart });
      const previousCart = queryClient.getQueryData<CartItem[]>(shoppingHubKeys.cart);
      
      // Optimistic removal - instant UI feedback (fitment-scoped)
      queryClient.setQueryData<CartItem[]>(shoppingHubKeys.cart, (old) => {
        if (!old) return old;
        return old.filter(item =>
          !(item.product_id === productId && (item.fitment_indicator ?? null) === fi)
        );
      });
      
      return { previousCart };
    },
    onError: (_err, _productId, context) => {
      deleteInProgressRef.current = false;
      if (context?.previousCart) {
        queryClient.setQueryData(shoppingHubKeys.cart, context.previousCart);
      }
    },
    onSuccess: () => {
      // Deletion is a one-shot action (not a rapid-fire tap like + / −), so
      // skip the debounce and sync with the server immediately to prevent the
      // deleted item from flickering back after the 500 ms debounce window.
      if (invalidateTimerRef.current) clearTimeout(invalidateTimerRef.current);
      invalidateTimerRef.current = null;
      queryClient.invalidateQueries({ queryKey: shoppingHubKeys.cart });
    },
    onSettled: () => {
      // Release the lock so normal debounce resumes after delete completes.
      deleteInProgressRef.current = false;
    },
  });

  /**
   * Swap the fitment indicator on an existing cart line.
   * Optimistically re-keys the line in the React Query cache,
   * then syncs by removing the old line and adding the new one.
   * If the new variant already exists in cart, quantities are merged.
   */
  const changeFitment = useMutation({
    mutationFn: async ({
      productId,
      oldIndicator,
      newIndicator,
      quantity,
      newLineExisted,
      existingNewLineQty,
    }: {
      productId: string;
      oldIndicator: string | null;
      newIndicator: string;
      quantity: number;
      newLineExisted: boolean;
      existingNewLineQty: number;
    }) => {
      // Order matters: add the new line FIRST, then remove the old. If add fails
      // we leave the old line untouched. Server keys by
      // (user_id, product_id, fitment_indicator) so it will not merge the new add
      // into the old line. If remove fails after add succeeds, we compensate by
      // either restoring the original new-line quantity (if the line pre-existed)
      // or fully removing the new line (if we just created it). Final
      // invalidation in onSettled reconciles any drift.
      await cartApi.addItem(productId, quantity, newIndicator);
      try {
        await cartApi.remove(productId, oldIndicator ?? null);
      } catch (removeErr) {
        try {
          if (newLineExisted) {
            // Restore the new-line quantity rather than deleting the
            // pre-existing user data.
            await cartApi.update(productId, existingNewLineQty, newIndicator);
          } else {
            await cartApi.remove(productId, newIndicator);
          }
        } catch (_compensationErr) {
          // Best-effort compensation; refetch in onSettled will reconcile.
        }
        throw removeErr;
      }
      return { productId, oldIndicator, newIndicator };
    },
    onMutate: async ({ productId, oldIndicator, newIndicator }) => {
      await queryClient.cancelQueries({ queryKey: shoppingHubKeys.cart });
      const previousCart = queryClient.getQueryData<CartItem[]>(shoppingHubKeys.cart);
      const oldFi = oldIndicator ?? null;

      queryClient.setQueryData<CartItem[]>(shoppingHubKeys.cart, (old) => {
        if (!old) return old;
        const oldIdx = old.findIndex(
          (i) =>
            i.product_id === productId &&
            (i.fitment_indicator ?? null) === oldFi,
        );
        if (oldIdx < 0) return old;
        const target = old[oldIdx];
        const variants = Array.isArray(target?.product?.available_variants)
          ? target.product.available_variants
          : Array.isArray(target?.available_variants)
            ? target.available_variants
            : [];
        const variant = variants.find((v) => v?.indicator === newIndicator);
        const newBasePrice =
          variant?.price !== undefined && variant?.price !== null
            ? parseFloat(String(variant.price))
            : null;

        // Preserve any active per-line discount as a ratio so totals stay
        // consistent with what the server will return.
        const oldOriginal = parseFloat(String(target.original_unit_price ?? 0));
        const oldFinal = parseFloat(String(target.final_unit_price ?? 0));
        const discountRatio =
          oldOriginal > 0 && oldFinal > 0 && oldFinal < oldOriginal
            ? oldFinal / oldOriginal
            : 1;
        const nextOriginal =
          newBasePrice !== null && Number.isFinite(newBasePrice)
            ? newBasePrice
            : oldOriginal || oldFinal || 0;
        const nextFinal = nextOriginal * discountRatio;

        // Merge with existing line if present
        const mergeIdx = old.findIndex(
          (i, idx) =>
            idx !== oldIdx &&
            i.product_id === productId &&
            (i.fitment_indicator ?? null) === newIndicator,
        );
        const next = [...old];
        if (mergeIdx >= 0) {
          next[mergeIdx] = {
            ...next[mergeIdx],
            quantity: (next[mergeIdx].quantity || 0) + (target.quantity || 0),
          };
          next.splice(oldIdx, 1);
        } else {
          // Flip the fitment indicator and update unit pricing optimistically
          // so row subtotal + cart total reflect the swap immediately. Any
          // active discount ratio is preserved; final reconciliation comes
          // from the cart query invalidation in onSuccess/onSettled.
          next[oldIdx] = {
            ...target,
            fitment_indicator: newIndicator,
            original_unit_price: nextOriginal,
            final_unit_price: nextFinal,
            product: target.product
              ? {
                  ...target.product,
                  fitment_indicator: newIndicator,
                  ...(newBasePrice !== null ? { price: newBasePrice } : {}),
                }
              : target.product,
          };
        }
        return next;
      });

      return { previousCart };
    },
    onError: (_err, _vars, context) => {
      if (context?.previousCart) {
        queryClient.setQueryData(shoppingHubKeys.cart, context.previousCart);
      }
    },
    onSettled: () => {
      // Reconcile with server after a fitment swap (covers both success and
      // partial-failure). Debounced to stay consistent with other mutations.
      scheduleCartInvalidate();
    },
  });

  const clearCart = useMutation({
    mutationFn: async () => {
      return cartApi.clear();
    },
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey: shoppingHubKeys.cart });
      const previousCart = queryClient.getQueryData<CartItem[]>(shoppingHubKeys.cart);
      queryClient.setQueryData<CartItem[]>(shoppingHubKeys.cart, []);
      return { previousCart };
    },
    onError: (_err, _variables, context) => {
      if (context?.previousCart) {
        queryClient.setQueryData(shoppingHubKeys.cart, context.previousCart);
      }
    },
    onSuccess: () => {
      scheduleCartInvalidate();
    },
  });

  return {
    addToCart,
    updateQuantity,
    removeFromCart,
    changeFitment,
    clearCart,
    checkDuplicate,
    checkBundleDuplicate, // Legacy alias for backward compatibility
    checkBundleConflict,
  };
}

/**
 * Hook for favorites mutations
 * FIXED: Enhanced cache invalidation for immediate UI updates
 */
export function useFavoritesMutations() {
  const queryClient = useQueryClient();

  const toggleFavorite = useMutation({
    mutationFn: async (productId: string) => {
      return favoriteApi.toggle(productId);
    },
    onMutate: async (productId) => {
      await queryClient.cancelQueries({ queryKey: shoppingHubKeys.favorites });
      const previousFavorites = queryClient.getQueryData<Favorite[]>(shoppingHubKeys.favorites);
      
      // Optimistic toggle - remove if exists for instant UI feedback
      queryClient.setQueryData<Favorite[]>(shoppingHubKeys.favorites, (old) => {
        if (!old) return old;
        const exists = old.some(f => f.product_id === productId);
        if (exists) {
          return old.filter(f => f.product_id !== productId);
        }
        return old;
      });
      
      return { previousFavorites };
    },
    onError: (_err, _productId, context) => {
      if (context?.previousFavorites) {
        queryClient.setQueryData(shoppingHubKeys.favorites, context.previousFavorites);
      }
    },
    onSuccess: () => {
      // Always refetch to ensure sync with server
      queryClient.invalidateQueries({ queryKey: shoppingHubKeys.favorites });
    },
  });

  return {
    toggleFavorite,
  };
}

export default useShoppingHubQuery;
