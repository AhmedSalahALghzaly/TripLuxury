/**
 * Car Brands Query Hook with React Query
 * Provides data fetching for car brands and models with caching
 */
import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import { carBrandsApi, carModelsApi } from '../../services/api';
import { useAppStore } from '../../store/appStore';

// Query keys for car brands
export const carBrandsKeys = {
  all: ['carBrands'] as const,
  models: ['carModels'] as const,
  modelsByBrand: (brandId: string) => ['carModels', 'brand', brandId] as const,
};

/**
 * Hook to fetch all car brands
 */
export function useCarBrandsQuery() {
  return useQuery({
    queryKey: carBrandsKeys.all,
    queryFn: async () => {
      const response = await carBrandsApi.getAll();
      return response.data || [];
    },
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
}

/**
 * Hook to fetch all car models (restaurants).
 * After a successful fetch, prunes stale restaurant-hours cache entries that
 * are no longer present in the current list, keeping AsyncStorage bounded.
 */
export function useCarModelsQuery() {
  const pruneRestaurantHoursMap = useAppStore((s) => s.pruneRestaurantHoursMap);

  const query = useQuery({
    queryKey: carBrandsKeys.models,
    queryFn: async () => {
      const response = await carModelsApi.getAll();
      return response.data || [];
    },
    staleTime: 5 * 60 * 1000, // 5 minutes
  });

  useEffect(() => {
    if (!query.data) return;
    const currentIds: string[] = query.data.map((m: { id: string }) => m.id);
    pruneRestaurantHoursMap(currentIds);
  }, [query.data, pruneRestaurantHoursMap]);

  return query;
}

/**
 * Hook to fetch car brands and models together
 */
export function useCarBrandsAndModelsQuery() {
  const brandsQuery = useCarBrandsQuery();
  const modelsQuery = useCarModelsQuery();

  return {
    brands: brandsQuery.data || [],
    models: modelsQuery.data || [],
    isLoading: brandsQuery.isLoading || modelsQuery.isLoading,
    isError: brandsQuery.isError || modelsQuery.isError,
    error: brandsQuery.error || modelsQuery.error,
    refetch: async () => {
      await Promise.all([brandsQuery.refetch(), modelsQuery.refetch()]);
    },
    isRefetching: brandsQuery.isRefetching || modelsQuery.isRefetching,
  };
}

export default useCarBrandsQuery;
