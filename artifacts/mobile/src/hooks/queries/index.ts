/**
 * Query Hooks Index
 * Export all query hooks for easy importing
 */
export { useBrandsQuery, productBrandsKeys } from './useBrandsQuery';
export {
  useCarBrandsQuery,
  useCarModelsQuery,
  useCarBrandsAndModelsQuery,
  carBrandsKeys,
} from './useCarBrandsQuery';
export {
  useAdminsQuery,
  useAdminProductsQuery,
  useAdminMutations,
  adminsKeys,
} from './useAdminsQuery';
export {
  useMarketingQuery,
  usePromotionsQuery,
  useBundlesQuery,
  usePromotionMutations,
  useBundleMutations,
  marketingKeys,
} from './useMarketingQuery';
export {
  useAdminProductsInfinite,
  useAdminProductsQuery as useAdminProductsListQuery,
  useProductMetadataQuery,
  useAdminProductMutations,
  adminProductsKeys,
} from './useAdminProductsQuery';
export {
  useFavoritesQuery,
  useCartQuery,
  useOrdersQuery,
  useShoppingHubQuery,
  useCustomerShoppingDataQuery,
  useCartMutations,
  useFavoritesMutations,
  shoppingHubKeys,
} from './useShoppingHubQuery';
export {
  useHomeScreenQuery,
  useCategoriesTreeQuery,
  homeScreenKeys,
} from './useHomeScreenQuery';
export {
  useRestaurantRatingSummaries,
  ratingSummaryKeys,
} from './useRestaurantRatingSummaries';
export {
  useRestaurantHoursMap,
  restaurantHoursKeys,
} from './useRestaurantHoursMap';
