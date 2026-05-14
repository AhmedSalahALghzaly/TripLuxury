/**
 * Product Brands Query Hook with React Query
 * Provides data fetching for product brands with caching and loading states
 */
import { useQuery } from '@tanstack/react-query';
import { productBrandsApi } from '../../services/api';

// Query key for product brands
export const productBrandsKeys = {
  all: ['productBrands'] as const,
  filtered: (filters: { country?: string; search?: string }) => 
    ['productBrands', 'filtered', filters] as const,
};

/**
 * Hook to fetch all product brands
 */
export function useBrandsQuery() {
  return useQuery({
    queryKey: productBrandsKeys.all,
    queryFn: async () => {
      const response = await productBrandsApi.getAll();
      // Map logo to image for consistent rendering
      const brands = response.data || [];
      return brands.map((brand: any) => ({
        ...brand,
        image: brand.image || brand.logo,
      }));
    },
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
}

export default useBrandsQuery;
