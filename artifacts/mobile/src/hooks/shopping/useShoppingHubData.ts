/**
 * useShoppingHubData - Main data fetching and state management hook
 * FIXED: Removed recursive state updates that caused infinite re-renders
 * Uses React Query as the single source of truth for cart data
 */
import { useCallback, useMemo } from 'react';
import { useAppStore } from '../../store/appStore';
import {
  useShoppingHubQuery,
  useCustomerShoppingDataQuery,
} from '../queries';
import type { CartItem, Favorite, Order, ProfileData } from './types';

export interface ShoppingHubState {
  loading: boolean;
  refreshing: boolean;
  favorites: Favorite[];
  cartItems: CartItem[];
  orders: Order[];
  profileData: ProfileData | null;
}

export interface UseShoppingHubDataProps {
  customerId?: string;
  customerData?: unknown;
  isAdminView: boolean;
}

/**
 * Main hook for shopping hub data - uses React Query as single source of truth
 * FIXED: No longer syncs to Zustand from here to prevent infinite loops
 */
export const useShoppingHubData = ({
  customerId,
  customerData,
  isAdminView,
}: UseShoppingHubDataProps) => {
  const user = useAppStore((state) => state.user);

  // Determine target user
  const targetUserId = customerId || user?.id;
  const isOwnProfile = !isAdminView && !customerId;

  // Use React Query hooks for data fetching
  const userDataQuery = useShoppingHubQuery(!isAdminView && isOwnProfile);
  const customerDataQuery = useCustomerShoppingDataQuery(
    customerId,
    isAdminView && !!customerId
  );

  // Derive state from queries
  const loading = useMemo(() => {
    if (isAdminView && customerId) {
      return customerDataQuery.isLoading;
    }
    return userDataQuery.isLoading;
  }, [isAdminView, customerId, customerDataQuery.isLoading, userDataQuery.isLoading]);

  const refreshing = useMemo(() => {
    if (isAdminView && customerId) {
      return customerDataQuery.isRefetching;
    }
    return userDataQuery.isRefetching;
  }, [isAdminView, customerId, customerDataQuery.isRefetching, userDataQuery.isRefetching]);

  const favorites = useMemo((): Favorite[] => {
    if (isAdminView && customerId) {
      return customerDataQuery.favorites;
    }
    return userDataQuery.favorites;
  }, [isAdminView, customerId, customerDataQuery.favorites, userDataQuery.favorites]);

  const cartItems = useMemo((): CartItem[] => {
    if (isAdminView && customerId) {
      return customerDataQuery.cart;
    }
    return userDataQuery.cartItems;
  }, [isAdminView, customerId, customerDataQuery.cart, userDataQuery.cartItems]);

  const orders = useMemo((): Order[] => {
    if (isAdminView && customerId) {
      return customerDataQuery.orders;
    }
    return userDataQuery.orders;
  }, [isAdminView, customerId, customerDataQuery.orders, userDataQuery.orders]);

  const profileData = useMemo((): ProfileData | null => {
    if (isAdminView && customerId) {
      // Prefer freshly-fetched bundle profile over the stale list-row prop so
      // the header/profile tab updates after the bundle resolves.
      return (customerDataQuery.profile ?? customerData ?? null) as ProfileData | null;
    }
    return (userDataQuery.profileData ?? null) as ProfileData | null;
  }, [isAdminView, customerId, customerData, customerDataQuery.profile, userDataQuery.profileData]);

  // Refresh function
  const onRefresh = useCallback(() => {
    if (isAdminView && customerId) {
      customerDataQuery.refetch();
    } else {
      userDataQuery.refetch();
    }
  }, [isAdminView, customerId, customerDataQuery, userDataQuery]);

  // Load data function (for backward compatibility)
  const loadData = useCallback(() => {
    onRefresh();
  }, [onRefresh]);

  // Stub functions for backward compatibility - no longer needed
  const setFavorites = useCallback((_favorites: Favorite[]) => {}, []);
  const setLocalCartItems = useCallback((_items: CartItem[]) => {}, []);
  const setOrders = useCallback((_orders: Order[]) => {}, []);

  return {
    loading,
    refreshing,
    favorites,
    cartItems,
    orders,
    profileData,
    targetUserId,
    isOwnProfile,
    loadData,
    onRefresh,
    setFavorites,
    setLocalCartItems,
    setOrders,
  };
};

export default useShoppingHubData;
