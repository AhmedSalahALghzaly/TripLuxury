/**
 * useInfiniteProducts Hook
 * OPTIMIZED: Implements cursor-based pagination using React Query's useInfiniteQuery
 * Benefits: Built-in caching, automatic refetching, better error handling
 * v2.0.0
 */
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo, useEffect } from 'react';
import { productsApi } from '../services/api';
import { useAppStore } from '../store/appStore';
import { useDataCacheStore } from '../store/useDataCacheStore';

export interface ProductFilters {
  category_id?: string;
  product_brand_id?: string;
  car_model_id?: string;
  car_brand_id?: string;
  min_price?: number;
  max_price?: number;
  fitment?: string;
  is_tire?: boolean;
  product_type?: string;
  q?: string;
  open_now?: boolean;
}

export interface UseInfiniteProductsOptions {
  pageSize?: number;
  filters?: ProductFilters;
  enabled?: boolean;
  useSearchEndpoint?: boolean;
}

export interface UseInfiniteProductsResult {
  products: any[];
  isLoading: boolean;
  isLoadingMore: boolean;
  isRefreshing: boolean;
  error: string | null;
  hasMore: boolean;
  total: number;
  fetchNextPage: () => Promise<void>;
  refresh: () => Promise<void>;
  reset: () => void;
}

// Query key factory for consistent cache keys
const productQueryKeys = {
  all: ['products'] as const,
  infinite: (filters: ProductFilters) => ['products', 'infinite', filters] as const,
};

export function useInfiniteProducts(options: UseInfiniteProductsOptions = {}): UseInfiniteProductsResult {
  const { pageSize = 20, filters = {}, enabled = true, useSearchEndpoint = false } = options;
  
  // Global store access
  const setGlobalProducts = useAppStore((state) => state.setProducts);
  const isOnline = useDataCacheStore((state) => state.isOnline);
  const cachedProducts = useDataCacheStore((state) => state.products);
  const queryClient = useQueryClient();
  
  // Build filter params for API call
  const buildParams = useCallback((cursor?: string | null) => {
    const params: Record<string, any> = {
      limit: pageSize,
    };
    
    if (cursor) {
      params.cursor = cursor;
      params.direction = 'next';
    }
    
    // Apply filters
    if (filters.category_id) params.category_id = filters.category_id;
    if (filters.product_brand_id) params.product_brand_id = filters.product_brand_id;
    if (filters.car_model_id) params.car_model_id = filters.car_model_id;
    if (filters.car_brand_id) params.car_brand_id = filters.car_brand_id;
    if (filters.min_price !== undefined) params.min_price = filters.min_price;
    if (filters.max_price !== undefined) params.max_price = filters.max_price;
    if (filters.fitment) params.fitment = filters.fitment;
    if (filters.product_type) params.product_type = filters.product_type;
    else if (filters.is_tire !== undefined) params.is_tire = filters.is_tire;
    if (filters.q) params.q = filters.q;
    if (filters.open_now) params.open_now = 'true';

    return params;
  }, [pageSize, filters]);

  // Use React Query's useInfiniteQuery for data fetching
  const {
    data,
    isLoading,
    isFetchingNextPage,
    isRefetching,
    error,
    hasNextPage,
    fetchNextPage: fetchNext,
    refetch,
  } = useInfiniteQuery({
    queryKey: [...productQueryKeys.infinite(filters), useSearchEndpoint ? 'search' : 'list'],
    queryFn: async ({ pageParam }) => {
      const params = buildParams(pageParam);
      const response = useSearchEndpoint
        ? await productsApi.search(filters.q || '', {
            is_tire: filters.product_type ? undefined : filters.is_tire,
            product_type: filters.product_type,
            fitment: filters.fitment,
            open_now: filters.open_now ? 'true' : undefined,
          })
        : await productsApi.getAll(params);
      
      const products = response.data?.products || [];
      const nextCursor = response.data?.next_cursor;
      const hasMore = useSearchEndpoint
        ? false
        : (response.data?.has_more ?? products.length >= pageSize);
      const total = response.data?.total || products.length;
      
      return {
        products,
        nextCursor,
        hasMore,
        total,
      };
    },
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => {
      return lastPage.hasMore ? lastPage.nextCursor : undefined;
    },
    enabled,
    staleTime: 5 * 60 * 1000, // 5 minutes
    gcTime: 30 * 60 * 1000, // 30 minutes (formerly cacheTime)
    refetchOnWindowFocus: false,
    retry: isOnline ? 3 : 0,
  });

  // Flatten all pages into a single products array
  const products = useMemo(() => {
    if (!data?.pages) {
      // Fallback to cached products if offline and no data
      if (!isOnline && cachedProducts.length > 0) {
        return cachedProducts;
      }
      return [];
    }
    
    // Deduplicate products across pages
    const allProducts = data.pages.flatMap(page => page.products);
    const seen = new Set<string>();
    return allProducts.filter(product => {
      if (seen.has(product.id)) return false;
      seen.add(product.id);
      return true;
    });
  }, [data?.pages, isOnline, cachedProducts]);

  // Update global store when first page loads (must be useEffect, not useMemo — side effects cannot run during render)
  useEffect(() => {
    if (data?.pages?.[0]?.products) {
      setGlobalProducts(data.pages[0].products);
    }
  }, [data?.pages?.[0]?.products, setGlobalProducts]);

  // Calculate total from the latest page
  const total = useMemo(() => {
    if (!data?.pages?.length) return 0;
    return data.pages[data.pages.length - 1].total;
  }, [data?.pages]);

  // Check if there are more pages
  const hasMore = useMemo(() => {
    return hasNextPage ?? false;
  }, [hasNextPage]);

  // Fetch next page wrapper
  const fetchNextPage = useCallback(async () => {
    if (!hasMore || isFetchingNextPage || isLoading) return;
    await fetchNext();
  }, [hasMore, isFetchingNextPage, isLoading, fetchNext]);

  // Refresh (reload from start)
  const refresh = useCallback(async () => {
    await refetch();
  }, [refetch]);

  // Reset query
  const reset = useCallback(() => {
    queryClient.resetQueries({
      queryKey: productQueryKeys.infinite(filters),
    });
  }, [queryClient, filters]);

  // Format error message
  const errorMessage = useMemo(() => {
    if (!error) return null;
    return (error as Error).message || 'Failed to fetch products';
  }, [error]);

  return {
    products,
    isLoading,
    isLoadingMore: isFetchingNextPage,
    isRefreshing: isRefetching,
    error: errorMessage,
    hasMore,
    total,
    fetchNextPage,
    refresh,
    reset,
  };
}

export default useInfiniteProducts;
