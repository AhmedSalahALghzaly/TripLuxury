/**
 * Admin Products Query Hook with React Query
 * Provides data fetching for admin product management
 * Supports infinite scroll pagination
 */
import { useQuery, useMutation, useQueryClient, useInfiniteQuery } from '@tanstack/react-query';
import { useCallback, useMemo } from 'react';
import { productsApi, productBrandsApi, categoriesApi, carModelsApi, carBrandsApi } from '../../services/api';
import { useAdminSync } from '../../services/adminSyncService';

// Query keys for admin products
export const adminProductsKeys = {
  all: ['adminProducts'] as const,
  list: ['adminProducts', 'list'] as const,
  infinite: (filters?: Record<string, any>) => ['adminProducts', 'infinite', filters] as const,
  detail: (id: string) => ['adminProducts', 'detail', id] as const,
  metadata: ['adminProducts', 'metadata'] as const,
};

/**
 * Hook to fetch all admin products with infinite scroll support
 */
export function useAdminProductsInfinite(options: {
  pageSize?: number;
  searchQuery?: string;
  enabled?: boolean;
} = {}) {
  const { pageSize = 50, searchQuery = '', enabled = true } = options;

  return useInfiniteQuery({
    queryKey: adminProductsKeys.infinite({ searchQuery }),
    queryFn: async ({ pageParam }) => {
      const params: Record<string, any> = {
        limit: pageSize,
      };
      if (pageParam) {
        params.cursor = pageParam;
      }
      if (searchQuery.trim()) {
        params.search = searchQuery.trim();
      }

      const response = await productsApi.getAllAdmin(params);
      const products = response.data?.products || [];
      const nextCursor = response.data?.next_cursor;
      const hasMore = response.data?.has_more ?? products.length >= pageSize;
      const total = response.data?.total || 0;

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
    staleTime: 2 * 60 * 1000, // 2 minutes
    gcTime: 10 * 60 * 1000, // 10 minutes
  });
}

/**
 * Hook to fetch all admin products (non-paginated)
 */
export function useAdminProductsQuery() {
  return useQuery({
    queryKey: adminProductsKeys.list,
    queryFn: async () => {
      const response = await productsApi.getAllAdmin();
      return response.data?.products || [];
    },
    staleTime: 2 * 60 * 1000,
  });
}

/**
 * Hook to fetch product metadata (brands, categories, car models)
 */
export function useProductMetadataQuery() {
  return useQuery({
    queryKey: adminProductsKeys.metadata,
    queryFn: async () => {
      const [brandsRes, catsRes, modelsRes, carBrandsRes] = await Promise.all([
        productBrandsApi.getAll(),
        categoriesApi.getAll(),
        carModelsApi.getAll(),
        carBrandsApi.getAll(),
      ]);

      return {
        productBrands: brandsRes.data || [],
        categories: catsRes.data || [],
        carModels: modelsRes.data || [],
        carBrands: carBrandsRes.data || [],
      };
    },
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
}

/**
 * Hook for admin product mutations (create, update, delete)
 */
export function useAdminProductMutations() {
  const queryClient = useQueryClient();
  const adminSync = useAdminSync();

  // Create product
  const createProduct = useMutation({
    mutationFn: async (productData: any) => {
      return adminSync.createProduct(productData);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: adminProductsKeys.all });
    },
  });

  // Update product
  const updateProduct = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: any }) => {
      return adminSync.updateProduct(id, data);
    },
    onMutate: async ({ id, data }) => {
      // Cancel outgoing refetches
      await queryClient.cancelQueries({ queryKey: adminProductsKeys.list });
      
      // Snapshot previous value
      const previousProducts = queryClient.getQueryData(adminProductsKeys.list);
      
      // Optimistic update
      queryClient.setQueryData(adminProductsKeys.list, (old: any[]) => {
        if (!old) return old;
        return old.map(p => p.id === id ? { ...p, ...data } : p);
      });
      
      return { previousProducts };
    },
    onError: (err, variables, context) => {
      // Rollback on error
      if (context?.previousProducts) {
        queryClient.setQueryData(adminProductsKeys.list, context.previousProducts);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: adminProductsKeys.all });
    },
  });

  // Delete product
  const deleteProduct = useMutation({
    mutationFn: async (productId: string) => {
      return adminSync.deleteProduct(productId);
    },
    onMutate: async (productId) => {
      await queryClient.cancelQueries({ queryKey: adminProductsKeys.list });
      const previousProducts = queryClient.getQueryData(adminProductsKeys.list);
      
      // Optimistic removal
      queryClient.setQueryData(adminProductsKeys.list, (old: any[]) => {
        if (!old) return old;
        return old.filter(p => p.id !== productId);
      });
      
      return { previousProducts };
    },
    onError: (err, productId, context) => {
      if (context?.previousProducts) {
        queryClient.setQueryData(adminProductsKeys.list, context.previousProducts);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: adminProductsKeys.all });
    },
  });

  // Update quantity
  const updateQuantity = useMutation({
    mutationFn: async ({ productId, quantity }: { productId: string; quantity: number }) => {
      const product = queryClient.getQueryData<any[]>(adminProductsKeys.list)?.find(p => p.id === productId);
      if (product) {
        return productsApi.update(productId, {
          ...product,
          stock_quantity: quantity,
        });
      }
      throw new Error('Product not found');
    },
    onMutate: async ({ productId, quantity }) => {
      await queryClient.cancelQueries({ queryKey: adminProductsKeys.list });
      const previousProducts = queryClient.getQueryData(adminProductsKeys.list);
      
      // Optimistic update
      queryClient.setQueryData(adminProductsKeys.list, (old: any[]) => {
        if (!old) return old;
        return old.map(p => p.id === productId 
          ? { ...p, stock_quantity: quantity, stock: quantity } 
          : p
        );
      });
      
      return { previousProducts };
    },
    onError: (err, variables, context) => {
      if (context?.previousProducts) {
        queryClient.setQueryData(adminProductsKeys.list, context.previousProducts);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: adminProductsKeys.all });
    },
  });

  return {
    createProduct,
    updateProduct,
    deleteProduct,
    updateQuantity,
  };
}

export default useAdminProductsQuery;
