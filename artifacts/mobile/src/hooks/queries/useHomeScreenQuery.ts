/**
 * Home Screen Query Hook with React Query
 * Provides data fetching for the home screen with caching and parallel loading
 * 
 * ARCHITECTURE: Offline-First with Zustand Persistence
 * - React Query handles network requests and caching
 * - Zustand stores data for offline access
 * - Sync happens in queryFn (NOT in useEffect) to prevent render loops
 */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useRef } from 'react';
import {
  categoriesApi,
  carBrandsApi,
  carModelsApi,
  productBrandsApi,
  productsApi,
  favoritesApi,
  promotionApi,
} from '../../services/api';
import { useAppStore } from '../../store/appStore';

// Query keys for home screen
export const homeScreenKeys = {
  all: ['homeScreen'] as const,
  categories: ['homeScreen', 'categories'] as const,
  carBrands: ['homeScreen', 'carBrands'] as const,
  carModels: ['homeScreen', 'carModels'] as const,
  productBrands: ['homeScreen', 'productBrands'] as const,
  products: ['homeScreen', 'products'] as const,
  favorites: ['homeScreen', 'favorites'] as const,
  banners: ['homeScreen', 'banners'] as const,
};

// Stable reference to store setters (prevents re-render loops)
const getStoreSetters = () => {
  const state = useAppStore.getState();
  return {
    setCategories: state.setCategories,
    setCarBrands: state.setCarBrands,
    setCarModels: state.setCarModels,
    setProductBrands: state.setProductBrands,
    setProducts: state.setProducts,
  };
};

/**
 * Hook to fetch all home screen data in parallel
 * 
 * STABILITY FIX: 
 * - Removed all useEffect-based sync to Zustand
 * - Sync now happens inside queryFn after successful fetch
 * - This prevents the render-cycle dependency that caused "Maximum update depth exceeded"
 */
export function useHomeScreenQuery() {
  const user = useAppStore((state) => state.user);
  const queryClient = useQueryClient();
  
  // Track if initial sync has been done to prevent redundant updates
  const syncedRef = useRef({
    categories: false,
    carBrands: false,
    carModels: false,
    productBrands: false,
    products: false,
  });

  // Categories query - syncs to Zustand inside queryFn
  const categoriesQuery = useQuery({
    queryKey: homeScreenKeys.categories,
    queryFn: async () => {
      const response = await categoriesApi.getTree();
      const data = response.data || [];
      
      // Sync to Zustand store INSIDE queryFn (not in useEffect)
      // This happens once per successful fetch, not on every render
      if (data.length > 0 && !syncedRef.current.categories) {
        const { setCategories } = getStoreSetters();
        setCategories(data);
        syncedRef.current.categories = true;
      }
      
      return data;
    },
    staleTime: 5 * 60 * 1000, // 5 minutes
    gcTime: 30 * 60 * 1000, // Keep in cache for 30 minutes
  });

  // Car Brands query - WS-driven invalidation; refetchOnWindowFocus as a safety net.
  const carBrandsQuery = useQuery({
    queryKey: homeScreenKeys.carBrands,
    queryFn: async () => {
      const response = await carBrandsApi.getAll();
      const data = response.data || [];
      if (data.length > 0) {
        const { setCarBrands } = getStoreSetters();
        setCarBrands(data);
        syncedRef.current.carBrands = true;
      }
      return data;
    },
    staleTime: 60 * 1000,
    gcTime: 30 * 60 * 1000,
    refetchOnWindowFocus: true,
  });

  // Car Models query - WS-driven invalidation; refetchOnWindowFocus as a safety net.
  const carModelsQuery = useQuery({
    queryKey: homeScreenKeys.carModels,
    queryFn: async () => {
      const response = await carModelsApi.getAll();
      const data = response.data || [];
      if (data.length > 0) {
        const { setCarModels } = getStoreSetters();
        setCarModels(data);
        syncedRef.current.carModels = true;
      }
      return data;
    },
    staleTime: 60 * 1000,
    gcTime: 30 * 60 * 1000,
    refetchOnWindowFocus: true,
  });

  // Product Brands query
  const productBrandsQuery = useQuery({
    queryKey: homeScreenKeys.productBrands,
    queryFn: async () => {
      const response = await productBrandsApi.getAll();
      const data = response.data || [];
      
      if (data.length > 0 && !syncedRef.current.productBrands) {
        const { setProductBrands } = getStoreSetters();
        setProductBrands(data);
        syncedRef.current.productBrands = true;
      }
      
      return data;
    },
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
  });

  // Products query - WS product_* events drive invalidation; window-focus is the safety net.
  const productsQuery = useQuery({
    queryKey: homeScreenKeys.products,
    queryFn: async () => {
      const response = await productsApi.getAll({ limit: 100 });
      const data = response.data?.products || [];
      // Always sync products to Zustand on every fetch so admin edits propagate
      if (data.length > 0) {
        const { setProducts } = getStoreSetters();
        setProducts(data);
        syncedRef.current.products = true;
      }
      return data;
    },
    staleTime: 30 * 1000, // 30 seconds - faster freshness
    gcTime: 15 * 60 * 1000,
    refetchOnWindowFocus: true,  // refresh when user focuses the window/tab
  });

  // Three typed product strips loaded as separate server-filtered queries so
  // the home screen can render dedicated horizontal strips per product type
  // without splitting a mixed list client-side.
  // WS product_* events drive invalidation; window-focus is the safety net.
  const tireProductsQuery = useQuery({
    queryKey: [...homeScreenKeys.products, 'type', 'tire'] as const,
    queryFn: async () => {
      const response = await productsApi.getAll({ limit: 50, product_type: 'tire' });
      return response.data?.products || [];
    },
    staleTime: 30 * 1000,
    gcTime: 15 * 60 * 1000,
    refetchOnWindowFocus: true,
  });
  const accessoryProductsQuery = useQuery({
    queryKey: [...homeScreenKeys.products, 'type', 'accessory'] as const,
    queryFn: async () => {
      const response = await productsApi.getAll({ limit: 50, product_type: 'accessory' });
      return response.data?.products || [];
    },
    staleTime: 30 * 1000,
    gcTime: 15 * 60 * 1000,
    refetchOnWindowFocus: true,
  });
  const exteriorProductsQuery = useQuery({
    queryKey: [...homeScreenKeys.products, 'type', 'exterior'] as const,
    queryFn: async () => {
      const response = await productsApi.getAll({ limit: 50, product_type: 'exterior' });
      return response.data?.products || [];
    },
    staleTime: 30 * 1000,
    gcTime: 15 * 60 * 1000,
    refetchOnWindowFocus: true,
  });
  const nonTireProductsQuery = useQuery({
    queryKey: [...homeScreenKeys.products, 'non-tires'] as const,
    queryFn: async () => {
      const response = await productsApi.getAll({ limit: 100, is_tire: false });
      return response.data?.products || [];
    },
    staleTime: 30 * 1000,
    gcTime: 15 * 60 * 1000,
    refetchOnWindowFocus: true,
  });

  // Favorites query (only when logged in)
  const favoritesQuery = useQuery({
    queryKey: homeScreenKeys.favorites,
    queryFn: async () => {
      if (!user) return new Set<string>();
      const response = await favoritesApi.getAll();
      const favIds = new Set<string>(
        (response.data?.favorites || []).map((f: any) => f.product_id)
      );
      return favIds;
    },
    enabled: !!user,
    staleTime: 2 * 60 * 1000,
    gcTime: 15 * 60 * 1000,
  });

  // Banners query
  const bannersQuery = useQuery({
    queryKey: homeScreenKeys.banners,
    queryFn: async () => {
      const response = await promotionApi.getAll();
      return (response.data || []).filter(
        (p: any) => p.promotion_type === 'banner' && p.is_active
      );
    },
    staleTime: 2 * 60 * 1000,
    gcTime: 15 * 60 * 1000,
  });

  // Check if any essential query is loading
  const isLoading =
    categoriesQuery.isLoading ||
    carBrandsQuery.isLoading ||
    carModelsQuery.isLoading ||
    productBrandsQuery.isLoading ||
    productsQuery.isLoading;

  const isRefetching =
    categoriesQuery.isRefetching ||
    carBrandsQuery.isRefetching ||
    carModelsQuery.isRefetching ||
    productBrandsQuery.isRefetching ||
    productsQuery.isRefetching;

  // Refetch all data - resets sync flags to allow fresh data to update store
  const refetch = useCallback(async () => {
    // Reset sync flags to allow fresh data to update Zustand
    syncedRef.current = {
      categories: false,
      carBrands: false,
      carModels: false,
      productBrands: false,
      products: false,
    };
    
    await Promise.all([
      categoriesQuery.refetch(),
      carBrandsQuery.refetch(),
      carModelsQuery.refetch(),
      productBrandsQuery.refetch(),
      productsQuery.refetch(),
      favoritesQuery.refetch(),
      bannersQuery.refetch(),
    ]);
  }, [
    categoriesQuery,
    carBrandsQuery,
    carModelsQuery,
    productBrandsQuery,
    productsQuery,
    favoritesQuery,
    bannersQuery,
  ]);

  return {
    categories: categoriesQuery.data || [],
    carBrands: carBrandsQuery.data || [],
    carModels: carModelsQuery.data || [],
    productBrands: productBrandsQuery.data || [],
    products: productsQuery.data || [],
    tireProducts: tireProductsQuery.data || [],
    accessoryProducts: accessoryProductsQuery.data || [],
    exteriorProducts: exteriorProductsQuery.data || [],
    nonTireProducts: nonTireProductsQuery.data || [],
    favorites: favoritesQuery.data || new Set<string>(),
    banners: bannersQuery.data || [],
    bannersLoading: bannersQuery.isLoading,
    isLoading,
    isRefetching,
    refetch,
  };
}

/**
 * Hook to fetch categories tree with caching
 */
export function useCategoriesTreeQuery() {
  return useQuery({
    queryKey: homeScreenKeys.categories,
    queryFn: async () => {
      console.log('[useCategoriesTreeQuery] Fetching categories tree...');
      const response = await categoriesApi.getTree();
      const data = response.data || [];
      console.log('[useCategoriesTreeQuery] Response received:', data.length, 'categories');
      
      // Sync to Zustand for offline access
      if (data.length > 0) {
        const { setCategories } = getStoreSetters();
        setCategories(data);
      }
      
      return data;
    },
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
  });
}

export default useHomeScreenQuery;
