/**
 * useBundleProducts - Hook to track products included in active bundles
 * Uses React Query to fetch bundle offers and create a Set for O(1) lookup
 * 
 * Used globally to show golden gift icon on bundle products
 */
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { bundleOfferApi } from '../../services/api';

// Query key for bundle offers
export const bundleKeys = {
  all: ['bundleOffers'] as const,
  active: ['bundleOffers', 'active'] as const,
};

interface BundleOffer {
  id: string;
  name: string;
  name_ar?: string;
  product_ids: string[];
  discount_percentage: number;
  is_active: boolean;
}

/**
 * Hook to fetch all active bundle offers
 */
export function useBundleOffersQuery(enabled = true) {
  return useQuery({
    queryKey: bundleKeys.active,
    queryFn: async () => {
      const response = await bundleOfferApi.getAll(true); // active only
      return (response.data || []) as BundleOffer[];
    },
    enabled,
    staleTime: 5 * 60 * 1000, // 5 minutes - bundles don't change often
  });
}

/**
 * Hook to get Set of all product IDs that are part of any active bundle
 * Returns O(1) lookup for checking if a product is in a bundle
 */
export function useBundleProducts() {
  const { data: bundleOffers = [], isLoading, isError } = useBundleOffersQuery();

  // Flatten all product_ids from all active bundles into a Set
  const bundleProductIds = useMemo(() => {
    const productSet = new Set<string>();
    
    bundleOffers.forEach((bundle: BundleOffer) => {
      if (bundle.is_active && Array.isArray(bundle.product_ids)) {
        bundle.product_ids.forEach((productId: string) => {
          productSet.add(productId);
        });
      }
    });
    
    return productSet;
  }, [bundleOffers]);

  // Helper function to check if a product is in any bundle
  const isProductInBundle = (productId: string): boolean => {
    return bundleProductIds.has(productId);
  };

  // Get bundle info for a specific product (if any)
  const getBundleForProduct = (productId: string): BundleOffer | undefined => {
    return bundleOffers.find((bundle: BundleOffer) => 
      bundle.is_active && 
      Array.isArray(bundle.product_ids) && 
      bundle.product_ids.includes(productId)
    );
  };

  return {
    bundleProductIds,
    bundleOffers,
    isProductInBundle,
    getBundleForProduct,
    isLoading,
    isError,
  };
}

export default useBundleProducts;
