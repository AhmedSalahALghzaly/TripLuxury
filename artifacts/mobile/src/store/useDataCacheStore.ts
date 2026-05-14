/**
 * Data Cache Store - Handles cached data for offline-first
 * v3.0 - Enhanced with Snapshot mechanism, Smart Cache Cleanup, Conflict Resolution
 */
import { create } from 'zustand';
import { persist, createJSONStorage, StateStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

// Web-safe storage wrapper
const createWebSafeStorage = (): StateStorage => {
  if (typeof window === 'undefined') {
    return {
      getItem: () => null,
      setItem: () => {},
      removeItem: () => {},
    };
  }
  
  if (Platform.OS === 'web') {
    return {
      getItem: (name) => {
        try { return localStorage.getItem(name); } catch { return null; }
      },
      setItem: (name, value) => {
        try { localStorage.setItem(name, value); } catch { }
      },
      removeItem: (name) => {
        try { localStorage.removeItem(name); } catch { }
      },
    };
  }
  
  return AsyncStorage;
};

export type SyncStatus = 'idle' | 'syncing' | 'success' | 'error';

// Offline Action Types
export type OfflineActionType = 
  | 'cart_add' 
  | 'cart_update' 
  | 'cart_clear' 
  | 'order_create' 
  | 'favorite_toggle'
  | 'product_update'
  | 'generic';

export interface OfflineAction {
  id: string;
  type: OfflineActionType;
  endpoint: string;
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  payload?: any;
  timestamp: number;
  retryCount: number;
  maxRetries: number;
  status: 'pending' | 'processing' | 'failed';
  errorMessage?: string;
  // Conflict resolution
  resourceId?: string;
  resourceType?: string;
  localVersion?: number;
}

// Snapshot for rollback capability
export interface DataSnapshot {
  id: string;
  timestamp: number;
  description: string;
  data: {
    products?: any[];
    categories?: any[];
    orders?: any[];
    carBrands?: any[];
    carModels?: any[];
    productBrands?: any[];
  };
}

// Sync result for partial sync tracking
export interface SyncResult {
  resource: string;
  success: boolean;
  itemCount?: number;
  errorMessage?: string;
  timestamp: number;
}

// Resource versioning for conflict resolution
export interface ResourceVersion {
  resourceId: string;
  resourceType: string;
  localVersion: number;
  serverVersion?: number;
  lastModified: number;
  hasConflict: boolean;
}

interface DataCacheState {
  // Sync State
  syncStatus: SyncStatus;
  lastSyncTime: number | null;
  isOnline: boolean;
  syncError: string | null;
  lastSyncResults: SyncResult[];

  // Offline Action Queue
  offlineActionsQueue: OfflineAction[];
  isProcessingQueue: boolean;

  // Snapshots for rollback
  snapshots: DataSnapshot[];
  maxSnapshots: number;

  // Resource versioning
  resourceVersions: ResourceVersion[];

  // Data cache for offline-first
  carBrands: any[];
  carModels: any[];
  productBrands: any[];
  categories: any[];
  products: any[];
  suppliers: any[];
  distributors: any[];
  partners: any[];
  admins: any[];
  subscribers: any[];
  customers: any[];
  orders: any[];

  // Actions
  setOnline: (isOnline: boolean) => void;
  setSyncStatus: (status: SyncStatus) => void;
  setSyncError: (error: string | null) => void;
  setLastSyncTime: (time: number) => void;
  setLastSyncResults: (results: SyncResult[]) => void;

  // Offline Queue Actions
  addToOfflineQueue: (action: Omit<OfflineAction, 'id' | 'timestamp' | 'retryCount' | 'status'>) => void;
  removeFromOfflineQueue: (actionId: string) => void;
  updateQueueAction: (actionId: string, updates: Partial<OfflineAction>) => void;
  clearOfflineQueue: () => void;
  setProcessingQueue: (isProcessing: boolean) => void;
  getQueueLength: () => number;
  
  // Smart Cache Cleanup
  purgeOldQueueItems: (maxAgeDays?: number, maxRetries?: number) => number;
  cleanupAfterSync: () => void;
  
  // Aggressive Purging (Zero-Waste Policy)
  purgeDeletedItems: (serverIds: { [resourceType: string]: string[] }) => {
    purgedCounts: { [resourceType: string]: number };
    totalPurged: number;
  };
  
  // Single Item Operations (for real-time sync)
  addProduct: (product: any) => void;
  updateProductById: (productId: string, updates: any) => void;
  removeProductById: (productId: string) => void;
  
  addCategory: (category: any) => void;
  removeCategoryById: (categoryId: string) => void;
  
  addProductBrand: (brand: any) => void;
  removeProductBrandById: (brandId: string) => void;
  
  addCarBrand: (brand: any) => void;
  removeCarBrandById: (brandId: string) => void;
  
  addCarModel: (model: any) => void;
  updateCarModelById: (modelId: string, updates: any) => void;
  removeCarModelById: (modelId: string) => void;

  // Snapshot Actions
  createSnapshot: (description: string) => string;
  restoreSnapshot: (snapshotId: string) => boolean;
  deleteSnapshot: (snapshotId: string) => void;
  getSnapshots: () => DataSnapshot[];

  // Conflict Resolution
  trackResourceVersion: (resourceId: string, resourceType: string, version: number) => void;
  checkConflict: (resourceId: string, resourceType: string, serverVersion: number) => boolean;
  resolveConflict: (resourceId: string, resourceType: string, resolution: 'local' | 'server') => void;
  getConflicts: () => ResourceVersion[];

  // Data Actions
  setCarBrands: (data: any[]) => void;
  setCarModels: (data: any[]) => void;
  setProductBrands: (data: any[]) => void;
  setCategories: (data: any[]) => void;
  setProducts: (data: any[]) => void;
  setSuppliers: (data: any[]) => void;
  setDistributors: (data: any[]) => void;
  setPartners: (data: any[]) => void;
  setAdmins: (data: any[]) => void;
  setSubscribers: (data: any[]) => void;
  setCustomers: (data: any[]) => void;
  setOrders: (data: any[]) => void;

  // Bulk data update with versioning
  updateProductWithVersion: (productId: string, updates: any) => void;
  updateOrderWithVersion: (orderId: string, updates: any) => void;
}

// Generate unique ID for actions
const generateActionId = (): string => {
  return `action_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
};

// Generate unique ID for snapshots
const generateSnapshotId = (): string => {
  return `snapshot_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
};

// Constants
const MAX_QUEUE_AGE_DAYS = 3;
const MAX_RETRIES = 5;
const MAX_SNAPSHOTS = 5;

export const useDataCacheStore = create<DataCacheState>()(
  persist(
    (set, get) => ({
      syncStatus: 'idle',
      lastSyncTime: null,
      isOnline: true,
      syncError: null,
      lastSyncResults: [],
      
      // Offline Queue
      offlineActionsQueue: [],
      isProcessingQueue: false,

      // Snapshots
      snapshots: [],
      maxSnapshots: MAX_SNAPSHOTS,

      // Resource versions
      resourceVersions: [],

      // Data
      carBrands: [],
      carModels: [],
      productBrands: [],
      categories: [],
      products: [],
      suppliers: [],
      distributors: [],
      partners: [],
      admins: [],
      subscribers: [],
      customers: [],
      orders: [],

      setOnline: (isOnline) => set({ isOnline }),
      setSyncStatus: (status) => set({ syncStatus: status }),
      setSyncError: (error) => set({ syncError: error }),
      setLastSyncTime: (time) => set({ lastSyncTime: time }),
      setLastSyncResults: (results) => set({ lastSyncResults: results }),

      // ==================== Offline Queue Actions ====================
      
      addToOfflineQueue: (action) => set((state) => ({
        offlineActionsQueue: [
          ...state.offlineActionsQueue,
          {
            ...action,
            id: generateActionId(),
            timestamp: Date.now(),
            retryCount: 0,
            status: 'pending' as const,
          },
        ],
      })),

      removeFromOfflineQueue: (actionId) => set((state) => ({
        offlineActionsQueue: state.offlineActionsQueue.filter((a) => a.id !== actionId),
      })),

      updateQueueAction: (actionId, updates) => set((state) => ({
        offlineActionsQueue: state.offlineActionsQueue.map((a) =>
          a.id === actionId ? { ...a, ...updates } : a
        ),
      })),

      clearOfflineQueue: () => set({ offlineActionsQueue: [] }),

      setProcessingQueue: (isProcessing) => set({ isProcessingQueue: isProcessing }),

      getQueueLength: () => get().offlineActionsQueue.length,

      // ==================== Smart Cache Cleanup ====================

      /**
       * Purge old queue items based on age and retry count
       * Returns the number of items purged
       */
      purgeOldQueueItems: (maxAgeDays = MAX_QUEUE_AGE_DAYS, maxRetries = MAX_RETRIES) => {
        const state = get();
        const now = Date.now();
        const maxAgeMs = maxAgeDays * 24 * 60 * 60 * 1000;
        
        const itemsToPurge = state.offlineActionsQueue.filter((action) => {
          const age = now - action.timestamp;
          const isTooOld = age > maxAgeMs;
          const hasMaxRetries = action.retryCount >= maxRetries && action.status === 'failed';
          return isTooOld || hasMaxRetries;
        });

        if (itemsToPurge.length > 0) {
          console.log(`[DataCacheStore] Purging ${itemsToPurge.length} old/failed queue items`);
          set({
            offlineActionsQueue: state.offlineActionsQueue.filter(
              (action) => !itemsToPurge.find((p) => p.id === action.id)
            ),
          });
        }

        return itemsToPurge.length;
      },

      /**
       * Cleanup after successful sync
       * Removes confirmation tokens and temporary flags
       */
      cleanupAfterSync: () => {
        const state = get();
        
        // Remove successfully completed actions
        const completedActions = state.offlineActionsQueue.filter(
          (a) => a.status !== 'pending' && a.status !== 'processing'
        );
        
        if (completedActions.length > 0) {
          console.log(`[DataCacheStore] Cleaning up ${completedActions.length} completed actions`);
          set({
            offlineActionsQueue: state.offlineActionsQueue.filter((a) => 
              a.status === 'pending' || a.status === 'processing'
            ),
          });
        }

        // Clear old resource versions (keep only those modified in last 24 hours)
        const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
        set({
          resourceVersions: state.resourceVersions.filter(
            (rv) => rv.lastModified > oneDayAgo || rv.hasConflict
          ),
        });
      },

      // ==================== Aggressive Purging (Zero-Waste Policy) ====================

      /**
       * Purge deleted items by comparing local cache with server's active IDs
       * This implements the "Zero-Waste" data policy
       */
      purgeDeletedItems: (serverIds: { [resourceType: string]: string[] }) => {
        const state = get();
        const purgedCounts: { [resourceType: string]: number } = {};
        let totalPurged = 0;

        // Purge products
        if (serverIds.products) {
          const serverProductIds = new Set(serverIds.products);
          const localProducts = state.products;
          const filteredProducts = localProducts.filter((p) => serverProductIds.has(p.id));
          const purgedCount = localProducts.length - filteredProducts.length;
          if (purgedCount > 0) {
            console.log(`[DataCacheStore] Purging ${purgedCount} deleted products`);
            set({ products: filteredProducts });
            purgedCounts.products = purgedCount;
            totalPurged += purgedCount;
          }
        }

        // Purge categories
        if (serverIds.categories) {
          const serverCategoryIds = new Set(serverIds.categories);
          const localCategories = state.categories;
          const filteredCategories = localCategories.filter((c) => serverCategoryIds.has(c.id));
          const purgedCount = localCategories.length - filteredCategories.length;
          if (purgedCount > 0) {
            console.log(`[DataCacheStore] Purging ${purgedCount} deleted categories`);
            set({ categories: filteredCategories });
            purgedCounts.categories = purgedCount;
            totalPurged += purgedCount;
          }
        }

        // Purge car brands
        if (serverIds.carBrands) {
          const serverBrandIds = new Set(serverIds.carBrands);
          const localBrands = state.carBrands;
          const filteredBrands = localBrands.filter((b) => serverBrandIds.has(b.id));
          const purgedCount = localBrands.length - filteredBrands.length;
          if (purgedCount > 0) {
            console.log(`[DataCacheStore] Purging ${purgedCount} deleted car brands`);
            set({ carBrands: filteredBrands });
            purgedCounts.carBrands = purgedCount;
            totalPurged += purgedCount;
          }
        }

        // Purge car models
        if (serverIds.carModels) {
          const serverModelIds = new Set(serverIds.carModels);
          const localModels = state.carModels;
          const filteredModels = localModels.filter((m) => serverModelIds.has(m.id));
          const purgedCount = localModels.length - filteredModels.length;
          if (purgedCount > 0) {
            console.log(`[DataCacheStore] Purging ${purgedCount} deleted car models`);
            set({ carModels: filteredModels });
            purgedCounts.carModels = purgedCount;
            totalPurged += purgedCount;
          }
        }

        // Purge product brands
        if (serverIds.productBrands) {
          const serverBrandIds = new Set(serverIds.productBrands);
          const localBrands = state.productBrands;
          const filteredBrands = localBrands.filter((b) => serverBrandIds.has(b.id));
          const purgedCount = localBrands.length - filteredBrands.length;
          if (purgedCount > 0) {
            console.log(`[DataCacheStore] Purging ${purgedCount} deleted product brands`);
            set({ productBrands: filteredBrands });
            purgedCounts.productBrands = purgedCount;
            totalPurged += purgedCount;
          }
        }

        // Purge orders
        if (serverIds.orders) {
          const serverOrderIds = new Set(serverIds.orders);
          const localOrders = state.orders;
          const filteredOrders = localOrders.filter((o) => serverOrderIds.has(o.id));
          const purgedCount = localOrders.length - filteredOrders.length;
          if (purgedCount > 0) {
            console.log(`[DataCacheStore] Purging ${purgedCount} deleted orders`);
            set({ orders: filteredOrders });
            purgedCounts.orders = purgedCount;
            totalPurged += purgedCount;
          }
        }

        if (totalPurged > 0) {
          console.log(`[DataCacheStore] Total items purged: ${totalPurged}`);
        }

        return { purgedCounts, totalPurged };
      },

      // ==================== Single Item Operations (Real-Time Sync) ====================

      addProduct: (product) => {
        const state = get();
        // Prevent duplicates
        if (!state.products.find((p) => p.id === product.id)) {
          set({ products: [product, ...state.products] });
        }
      },

      updateProductById: (productId, updates) => {
        set((state) => ({
          products: state.products.map((p) =>
            p.id === productId ? { ...p, ...updates, _localModified: Date.now() } : p
          ),
        }));
      },

      removeProductById: (productId) => {
        set((state) => ({
          products: state.products.filter((p) => p.id !== productId),
        }));
      },

      addCategory: (category) => {
        const state = get();
        if (!state.categories.find((c) => c.id === category.id)) {
          set({ categories: [category, ...state.categories] });
        }
      },

      removeCategoryById: (categoryId) => {
        set((state) => ({
          categories: state.categories.filter((c) => c.id !== categoryId),
        }));
      },

      addProductBrand: (brand) => {
        const state = get();
        if (!state.productBrands.find((b) => b.id === brand.id)) {
          set({ productBrands: [brand, ...state.productBrands] });
        }
      },

      removeProductBrandById: (brandId) => {
        set((state) => ({
          productBrands: state.productBrands.filter((b) => b.id !== brandId),
        }));
      },

      addCarBrand: (brand) => {
        const state = get();
        if (!state.carBrands.find((b) => b.id === brand.id)) {
          set({ carBrands: [brand, ...state.carBrands] });
        }
      },

      removeCarBrandById: (brandId) => {
        set((state) => ({
          carBrands: state.carBrands.filter((b) => b.id !== brandId),
        }));
      },

      addCarModel: (model) => {
        const state = get();
        if (!state.carModels.find((m) => m.id === model.id)) {
          set({ carModels: [model, ...state.carModels] });
        }
      },

      updateCarModelById: (modelId, updates) => {
        set((state) => ({
          carModels: state.carModels.map((m) =>
            m.id === modelId ? { ...m, ...updates, _localModified: Date.now() } : m
          ),
        }));
      },

      removeCarModelById: (modelId) => {
        set((state) => ({
          carModels: state.carModels.filter((m) => m.id !== modelId),
        }));
      },

      // ==================== Snapshot Actions ====================

      /**
       * Create a snapshot of current data state before major sync
       */
      createSnapshot: (description) => {
        const state = get();
        const snapshotId = generateSnapshotId();
        
        const newSnapshot: DataSnapshot = {
          id: snapshotId,
          timestamp: Date.now(),
          description,
          data: {
            products: [...state.products],
            categories: [...state.categories],
            orders: [...state.orders],
            carBrands: [...state.carBrands],
            carModels: [...state.carModels],
            productBrands: [...state.productBrands],
          },
        };

        // Keep only the most recent snapshots
        const updatedSnapshots = [newSnapshot, ...state.snapshots].slice(0, state.maxSnapshots);
        
        set({ snapshots: updatedSnapshots });
        console.log(`[DataCacheStore] Created snapshot: ${snapshotId} - ${description}`);
        
        return snapshotId;
      },

      /**
       * Restore data from a snapshot (rollback)
       */
      restoreSnapshot: (snapshotId) => {
        const state = get();
        const snapshot = state.snapshots.find((s) => s.id === snapshotId);
        
        if (!snapshot) {
          console.error(`[DataCacheStore] Snapshot not found: ${snapshotId}`);
          return false;
        }

        console.log(`[DataCacheStore] Restoring snapshot: ${snapshotId}`);
        
        set({
          products: snapshot.data.products || state.products,
          categories: snapshot.data.categories || state.categories,
          orders: snapshot.data.orders || state.orders,
          carBrands: snapshot.data.carBrands || state.carBrands,
          carModels: snapshot.data.carModels || state.carModels,
          productBrands: snapshot.data.productBrands || state.productBrands,
        });

        return true;
      },

      deleteSnapshot: (snapshotId) => {
        set((state) => ({
          snapshots: state.snapshots.filter((s) => s.id !== snapshotId),
        }));
      },

      getSnapshots: () => get().snapshots,

      // ==================== Conflict Resolution ====================

      /**
       * Track local version of a resource for conflict detection
       */
      trackResourceVersion: (resourceId, resourceType, version) => {
        set((state) => {
          const existing = state.resourceVersions.find(
            (rv) => rv.resourceId === resourceId && rv.resourceType === resourceType
          );

          if (existing) {
            return {
              resourceVersions: state.resourceVersions.map((rv) =>
                rv.resourceId === resourceId && rv.resourceType === resourceType
                  ? { ...rv, localVersion: version, lastModified: Date.now() }
                  : rv
              ),
            };
          }

          return {
            resourceVersions: [
              ...state.resourceVersions,
              {
                resourceId,
                resourceType,
                localVersion: version,
                lastModified: Date.now(),
                hasConflict: false,
              },
            ],
          };
        });
      },

      /**
       * Check if there's a conflict between local and server versions
       */
      checkConflict: (resourceId, resourceType, serverVersion) => {
        const state = get();
        const tracked = state.resourceVersions.find(
          (rv) => rv.resourceId === resourceId && rv.resourceType === resourceType
        );

        if (!tracked) {
          return false; // No local version, no conflict
        }

        const hasConflict = tracked.localVersion !== serverVersion;
        
        if (hasConflict) {
          // Mark the conflict
          set({
            resourceVersions: state.resourceVersions.map((rv) =>
              rv.resourceId === resourceId && rv.resourceType === resourceType
                ? { ...rv, serverVersion, hasConflict: true }
                : rv
            ),
          });
          console.log(`[DataCacheStore] Conflict detected for ${resourceType}/${resourceId}`);
        }

        return hasConflict;
      },

      /**
       * Resolve a conflict by choosing local or server version
       */
      resolveConflict: (resourceId, resourceType, resolution) => {
        set((state) => ({
          resourceVersions: state.resourceVersions.map((rv) =>
            rv.resourceId === resourceId && rv.resourceType === resourceType
              ? {
                  ...rv,
                  hasConflict: false,
                  localVersion: resolution === 'server' ? rv.serverVersion || rv.localVersion : rv.localVersion,
                }
              : rv
          ),
        }));
        console.log(`[DataCacheStore] Resolved conflict for ${resourceType}/${resourceId} using ${resolution} version`);
      },

      /**
       * Get all resources with conflicts
       */
      getConflicts: () => {
        return get().resourceVersions.filter((rv) => rv.hasConflict);
      },

      // ==================== Data Actions ====================
      
      setCarBrands: (data) => set({ carBrands: data }),
      setCarModels: (data) => set({ carModels: data }),
      setProductBrands: (data) => set({ productBrands: data }),
      setCategories: (data) => set({ categories: data }),
      setProducts: (data) => set({ products: data }),
      setSuppliers: (data) => set({ suppliers: data }),
      setDistributors: (data) => set({ distributors: data }),
      setPartners: (data) => set({ partners: data }),
      setAdmins: (data) => set({ admins: data }),
      setSubscribers: (data) => set({ subscribers: data }),
      setCustomers: (data) => set({ customers: data }),
      setOrders: (data) => set({ orders: data }),

      // ==================== Versioned Updates ====================

      /**
       * Update a product with version tracking
       */
      updateProductWithVersion: (productId, updates) => {
        const state = get();
        const product = state.products.find((p) => p.id === productId);
        
        if (product) {
          const newVersion = (product._version || 0) + 1;
          
          set({
            products: state.products.map((p) =>
              p.id === productId ? { ...p, ...updates, _version: newVersion, _localModified: Date.now() } : p
            ),
          });
          
          // Track the version
          get().trackResourceVersion(productId, 'product', newVersion);
        }
      },

      /**
       * Update an order with version tracking
       */
      updateOrderWithVersion: (orderId, updates) => {
        const state = get();
        const order = state.orders.find((o) => o.id === orderId);
        
        if (order) {
          const newVersion = (order._version || 0) + 1;
          
          set({
            orders: state.orders.map((o) =>
              o.id === orderId ? { ...o, ...updates, _version: newVersion, _localModified: Date.now() } : o
            ),
          });
          
          // Track the version
          get().trackResourceVersion(orderId, 'order', newVersion);
        }
      },
    }),
    {
      name: 'alghazaly-data-cache-v4',
      storage: createJSONStorage(() => createWebSafeStorage()),
      partialize: (state) => ({
        // Essential sync data only
        lastSyncTime: state.lastSyncTime,
        offlineActionsQueue: state.offlineActionsQueue,
        
        // Snapshots: NOT persisted — they are transient (created before sync, deleted after)
        // Persisting snapshots fills up AsyncStorage quickly (each holds full product/model lists)
        
        // Resource versions (only conflicted ones, small subset)
        resourceVersions: state.resourceVersions.filter((rv) => rv.hasConflict).slice(0, 10),
        
        // Essential cached data (tight limits to avoid SQLITE_FULL)
        carBrands: state.carBrands.slice(0, 50),
        productBrands: state.productBrands.slice(0, 30),
        categories: state.categories.slice(0, 50),
        
        // Don't persist large lists — they'll be fetched fresh on startup
        // carModels, products, suppliers, distributors, partners, admins, subscribers, customers, orders
      }),
    }
  )
);

// Selectors
export const useSyncStatus = () => useDataCacheStore((state) => state.syncStatus);
export const useIsOnline = () => useDataCacheStore((state) => state.isOnline);
export const useOfflineQueue = () => useDataCacheStore((state) => state.offlineActionsQueue);
export const useIsProcessingQueue = () => useDataCacheStore((state) => state.isProcessingQueue);
export const useCarBrands = () => useDataCacheStore((state) => state.carBrands);
export const useCarModels = () => useDataCacheStore((state) => state.carModels);
export const useProductBrands = () => useDataCacheStore((state) => state.productBrands);
export const useCategories = () => useDataCacheStore((state) => state.categories);
export const useProducts = () => useDataCacheStore((state) => state.products);
export const useOrders = () => useDataCacheStore((state) => state.orders);
export const useSnapshots = () => useDataCacheStore((state) => state.snapshots);
export const useConflicts = () => useDataCacheStore((state) => state.resourceVersions.filter((rv) => rv.hasConflict));
export const useLastSyncResults = () => useDataCacheStore((state) => state.lastSyncResults);

export default useDataCacheStore;
