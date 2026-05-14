/**
 * Stores Index - Export all stores from a single location
 * v3.0 - Enhanced with Snapshot, Conflict Resolution, and Smart Cache features
 * This file provides a centralized export for all Zustand stores
 */

// Auth Store - handles authentication state
export {
  useAuthStore,
  useUser,
  useIsAuthenticated,
  useUserRole,
  useHasHydrated,
  useCanAccessOwnerInterface,
  useCanAccessAdminPanel,
} from './useAuthStore';
export type { User, UserRole } from './useAuthStore';

// Cart Store - handles shopping cart with snapshot support
export {
  useCartStore,
  useCartItems,
  useCartTotal,
  useCartSubtotal,
  useAddBundleToCart,
  useCartLoading,
  useCartError,
} from './useCartStore';
export type { CartItemData, BundleOfferData } from './useCartStore';

// Data Cache Store - handles offline-first data cache with enhanced features
export {
  useDataCacheStore,
  useSyncStatus,
  useIsOnline,
  useOfflineQueue,
  useIsProcessingQueue,
  useCarBrands,
  useCarModels,
  useProductBrands,
  useCategories,
  useProducts,
  useOrders,
  useSnapshots,
  useConflicts,
  useLastSyncResults,
} from './useDataCacheStore';
export type { 
  SyncStatus, 
  OfflineAction, 
  OfflineActionType, 
  DataSnapshot, 
  SyncResult, 
  ResourceVersion 
} from './useDataCacheStore';

// Legacy App Store - for backward compatibility
// This maintains the monolithic store for existing components
export {
  useAppStore,
  useColorMood,
  COLOR_MOODS,
  NEON_NIGHT_THEME,
} from './appStore';
export type { ColorMood, Notification, AppStoreState } from './appStore';
