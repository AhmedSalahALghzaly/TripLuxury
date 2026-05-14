/**
 * Offline Database Service
 * Persistent offline-first storage with intelligent sync management
 * Uses AsyncStorage for cross-platform compatibility
 * Supports 3GB+ storage with flexible capacity
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

// Storage keys
const STORAGE_KEYS = {
  products: '@alghazaly_products',
  categories: '@alghazaly_categories',
  carBrands: '@alghazaly_car_brands',
  carModels: '@alghazaly_car_models',
  productBrands: '@alghazaly_product_brands',
  orders: '@alghazaly_orders',
  offlineQueue: '@alghazaly_offline_queue',
  syncMetadata: '@alghazaly_sync_metadata',
  lastSyncTime: '@alghazaly_last_sync_time',
  lastActivity: '@alghazaly_last_activity',
  deletedIds: '@alghazaly_deleted_ids',
};

// Storage configuration
const STORAGE_LIMIT_GB = 3;
const STORAGE_LIMIT_BYTES = STORAGE_LIMIT_GB * 1024 * 1024 * 1024;

export interface SyncMetadata {
  lastSyncTimestamp: number;
  serverVersion: number;
  localVersion: number;
  isDeleted: boolean;
  needsSync: boolean;
}

export interface StoredItem {
  id: string;
  data: any;
  syncMetadata: {
    lastSyncTimestamp: number;
    serverVersion: number;
    localVersion: number;
    isDeleted: boolean;
    needsSync: boolean;
  };
  createdAt: number;
  updatedAt: number;
}

class OfflineDatabaseService {
  private isInitialized = false;
  private cache: Map<string, any> = new Map();

  /**
   * Initialize the offline database
   */
  async initialize(): Promise<boolean> {
    if (this.isInitialized) {
      return true;
    }

    try {
      console.log('[OfflineDB] Initializing offline storage...');
      
      // Load critical data into memory cache for faster access
      await this.loadCache();
      
      this.isInitialized = true;
      console.log('[OfflineDB] Offline storage initialized successfully');
      return true;
    } catch (error) {
      console.error('[OfflineDB] Failed to initialize:', error);
      return false;
    }
  }

  /**
   * Load frequently accessed data into cache
   */
  private async loadCache(): Promise<void> {
    try {
      const keys = Object.values(STORAGE_KEYS);
      const results = await AsyncStorage.multiGet(keys);
      
      for (const [key, value] of results) {
        if (value) {
          try {
            this.cache.set(key, JSON.parse(value));
          } catch {
            // Skip invalid JSON
          }
        }
      }
    } catch (error) {
      console.error('[OfflineDB] Cache loading error:', error);
    }
  }

  /**
   * Get storage size estimate
   */
  async getStorageSize(): Promise<number> {
    try {
      const keys = await AsyncStorage.getAllKeys();
      let totalSize = 0;
      
      for (const key of keys) {
        if (key.startsWith('@alghazaly_')) {
          const value = await AsyncStorage.getItem(key);
          if (value) {
            totalSize += value.length * 2; // UTF-16 encoding
          }
        }
      }
      
      return totalSize;
    } catch (error) {
      console.error('[OfflineDB] Error getting storage size:', error);
      return 0;
    }
  }

  /**
   * Get storage info
   */
  async getStorageInfo(): Promise<{ used: number; limit: number; percentage: number }> {
    const used = await this.getStorageSize();
    return {
      used,
      limit: STORAGE_LIMIT_BYTES,
      percentage: (used / STORAGE_LIMIT_BYTES) * 100,
    };
  }

  // ==================== Generic Storage Operations ====================

  private async getStoredData<T>(key: string): Promise<T[]> {
    try {
      // Check cache first
      if (this.cache.has(key)) {
        return this.cache.get(key) || [];
      }

      const data = await AsyncStorage.getItem(key);
      if (data) {
        const parsed = JSON.parse(data) as T[];
        this.cache.set(key, parsed);
        return parsed;
      }
      return [];
    } catch (error) {
      console.error(`[OfflineDB] Error getting ${key}:`, error);
      return [];
    }
  }

  private async setStoredData<T>(key: string, data: T[]): Promise<void> {
    try {
      const ITEM_LIMITS: Record<string, number> = {
        [STORAGE_KEYS.carModels]: 100,
        [STORAGE_KEYS.productBrands]: 50,
        [STORAGE_KEYS.categories]: 50,
        [STORAGE_KEYS.products]: 80,
        [STORAGE_KEYS.carBrands]: 50,
      };
      const limit = ITEM_LIMITS[key];
      const sliced = limit && data.length > limit ? data.slice(0, limit) : data;
      const jsonData = JSON.stringify(sliced);
      if (jsonData.length > 500_000) {
        console.warn(`[OfflineDB] Skipping ${key} — data too large (${Math.round(jsonData.length / 1024)}KB)`);
        return;
      }
      await AsyncStorage.setItem(key, jsonData);
      this.cache.set(key, sliced);
    } catch (error) {
      console.warn(`[OfflineDB] Could not save ${key} (storage may be full), skipping`);
    }
  }

  // ==================== Products ====================

  async saveProducts(products: any[]): Promise<void> {
    const now = Date.now();
    const storedProducts: StoredItem[] = products.map(p => ({
      id: p.id,
      data: p,
      syncMetadata: {
        lastSyncTimestamp: now,
        serverVersion: p._version || 1,
        localVersion: p._version || 1,
        isDeleted: false,
        needsSync: false,
      },
      createdAt: now,
      updatedAt: now,
    }));

    await this.setStoredData(STORAGE_KEYS.products, storedProducts);
    console.log(`[OfflineDB] Saved ${products.length} products`);
  }

  async getProducts(): Promise<any[]> {
    const stored = await this.getStoredData<StoredItem>(STORAGE_KEYS.products);
    return stored
      .filter(item => !item.syncMetadata.isDeleted)
      .map(item => item.data);
  }

  async getProductById(id: string): Promise<any | null> {
    const products = await this.getStoredData<StoredItem>(STORAGE_KEYS.products);
    const item = products.find(p => p.id === id && !p.syncMetadata.isDeleted);
    return item ? item.data : null;
  }

  async deleteProduct(id: string): Promise<void> {
    const products = await this.getStoredData<StoredItem>(STORAGE_KEYS.products);
    const updated = products.map(p =>
      p.id === id
        ? { ...p, syncMetadata: { ...p.syncMetadata, isDeleted: true }, updatedAt: Date.now() }
        : p
    );
    await this.setStoredData(STORAGE_KEYS.products, updated);
  }

  async syncProducts(serverProducts: any[], serverDeletedIds: string[] = []): Promise<void> {
    const now = Date.now();
    const stored = await this.getStoredData<StoredItem>(STORAGE_KEYS.products);
    const serverProductIds = new Set(serverProducts.map(p => p.id));

    // Create map for quick lookup
    const storedMap = new Map(stored.map(p => [p.id, p]));

    // Update or add server products
    for (const product of serverProducts) {
      const existing = storedMap.get(product.id);
      
      if (existing && existing.syncMetadata.needsSync) {
        // Conflict: last-write wins
        const serverUpdated = new Date(product.updated_at).getTime();
        if (serverUpdated > existing.updatedAt) {
          storedMap.set(product.id, {
            id: product.id,
            data: product,
            syncMetadata: {
              lastSyncTimestamp: now,
              serverVersion: product._version || 1,
              localVersion: product._version || 1,
              isDeleted: false,
              needsSync: false,
            },
            createdAt: existing.createdAt,
            updatedAt: now,
          });
        }
      } else {
        storedMap.set(product.id, {
          id: product.id,
          data: product,
          syncMetadata: {
            lastSyncTimestamp: now,
            serverVersion: product._version || 1,
            localVersion: product._version || 1,
            isDeleted: false,
            needsSync: false,
          },
          createdAt: existing?.createdAt || now,
          updatedAt: now,
        });
      }
    }

    // Mark deleted products
    for (const deletedId of serverDeletedIds) {
      const existing = storedMap.get(deletedId);
      if (existing) {
        storedMap.set(deletedId, {
          ...existing,
          syncMetadata: { ...existing.syncMetadata, isDeleted: true },
          updatedAt: now,
        });
      }
    }

    // Mark products not on server as deleted (if we have a complete list)
    if (serverProducts.length > 0) {
      for (const [id, item] of storedMap) {
        if (!serverProductIds.has(id) && !item.syncMetadata.isDeleted) {
          storedMap.set(id, {
            ...item,
            syncMetadata: { ...item.syncMetadata, isDeleted: true },
            updatedAt: now,
          });
        }
      }
    }

    await this.setStoredData(STORAGE_KEYS.products, Array.from(storedMap.values()));
    console.log(`[OfflineDB] Synced ${serverProducts.length} products`);
  }

  // ==================== Categories ====================

  async saveCategories(categories: any[]): Promise<void> {
    const now = Date.now();
    const stored: StoredItem[] = categories.map(c => ({
      id: c.id,
      data: c,
      syncMetadata: {
        lastSyncTimestamp: now,
        serverVersion: 1,
        localVersion: 1,
        isDeleted: false,
        needsSync: false,
      },
      createdAt: now,
      updatedAt: now,
    }));
    await this.setStoredData(STORAGE_KEYS.categories, stored);
  }

  async getCategories(): Promise<any[]> {
    const stored = await this.getStoredData<StoredItem>(STORAGE_KEYS.categories);
    return stored.filter(item => !item.syncMetadata.isDeleted).map(item => item.data);
  }

  async syncCategories(serverCategories: any[], serverDeletedIds: string[] = []): Promise<void> {
    const now = Date.now();
    const stored: StoredItem[] = serverCategories.map(c => ({
      id: c.id,
      data: c,
      syncMetadata: {
        lastSyncTimestamp: now,
        serverVersion: 1,
        localVersion: 1,
        isDeleted: false,
        needsSync: false,
      },
      createdAt: now,
      updatedAt: now,
    }));
    await this.setStoredData(STORAGE_KEYS.categories, stored);
  }

  // ==================== Car Brands ====================

  async saveCarBrands(brands: any[]): Promise<void> {
    const now = Date.now();
    const stored: StoredItem[] = brands.map(b => ({
      id: b.id,
      data: b,
      syncMetadata: {
        lastSyncTimestamp: now,
        serverVersion: 1,
        localVersion: 1,
        isDeleted: false,
        needsSync: false,
      },
      createdAt: now,
      updatedAt: now,
    }));
    await this.setStoredData(STORAGE_KEYS.carBrands, stored);
  }

  async getCarBrands(): Promise<any[]> {
    const stored = await this.getStoredData<StoredItem>(STORAGE_KEYS.carBrands);
    return stored.filter(item => !item.syncMetadata.isDeleted).map(item => item.data);
  }

  async syncCarBrands(serverBrands: any[], serverDeletedIds: string[] = []): Promise<void> {
    const now = Date.now();
    const stored: StoredItem[] = serverBrands.map(b => ({
      id: b.id,
      data: b,
      syncMetadata: {
        lastSyncTimestamp: now,
        serverVersion: 1,
        localVersion: 1,
        isDeleted: false,
        needsSync: false,
      },
      createdAt: now,
      updatedAt: now,
    }));
    await this.setStoredData(STORAGE_KEYS.carBrands, stored);
  }

  // ==================== Car Models ====================

  async saveCarModels(models: any[]): Promise<void> {
    const now = Date.now();
    const stored: StoredItem[] = models.map(m => ({
      id: m.id,
      data: m,
      syncMetadata: {
        lastSyncTimestamp: now,
        serverVersion: 1,
        localVersion: 1,
        isDeleted: false,
        needsSync: false,
      },
      createdAt: now,
      updatedAt: now,
    }));
    await this.setStoredData(STORAGE_KEYS.carModels, stored);
  }

  async getCarModels(): Promise<any[]> {
    const stored = await this.getStoredData<StoredItem>(STORAGE_KEYS.carModels);
    return stored.filter(item => !item.syncMetadata.isDeleted).map(item => item.data);
  }

  async syncCarModels(serverModels: any[], serverDeletedIds: string[] = []): Promise<void> {
    const now = Date.now();
    const stored: StoredItem[] = serverModels.map(m => ({
      id: m.id,
      data: m,
      syncMetadata: {
        lastSyncTimestamp: now,
        serverVersion: 1,
        localVersion: 1,
        isDeleted: false,
        needsSync: false,
      },
      createdAt: now,
      updatedAt: now,
    }));
    await this.setStoredData(STORAGE_KEYS.carModels, stored);
  }

  // ==================== Product Brands ====================

  async saveProductBrands(brands: any[]): Promise<void> {
    const now = Date.now();
    const stored: StoredItem[] = brands.map(b => ({
      id: b.id,
      data: b,
      syncMetadata: {
        lastSyncTimestamp: now,
        serverVersion: 1,
        localVersion: 1,
        isDeleted: false,
        needsSync: false,
      },
      createdAt: now,
      updatedAt: now,
    }));
    await this.setStoredData(STORAGE_KEYS.productBrands, stored);
  }

  async getProductBrands(): Promise<any[]> {
    const stored = await this.getStoredData<StoredItem>(STORAGE_KEYS.productBrands);
    return stored.filter(item => !item.syncMetadata.isDeleted).map(item => item.data);
  }

  // ==================== Orders ====================

  async saveOrders(orders: any[]): Promise<void> {
    const now = Date.now();
    const stored: StoredItem[] = orders.map(o => ({
      id: o.id,
      data: o,
      syncMetadata: {
        lastSyncTimestamp: now,
        serverVersion: 1,
        localVersion: 1,
        isDeleted: false,
        needsSync: false,
      },
      createdAt: now,
      updatedAt: now,
    }));
    await this.setStoredData(STORAGE_KEYS.orders, stored);
  }

  async getOrders(): Promise<any[]> {
    const stored = await this.getStoredData<StoredItem>(STORAGE_KEYS.orders);
    return stored.filter(item => !item.syncMetadata.isDeleted).map(item => item.data);
  }

  // ==================== Sync Metadata ====================

  async setLastSyncTime(time: number): Promise<void> {
    await AsyncStorage.setItem(STORAGE_KEYS.lastSyncTime, time.toString());
  }

  async getLastSyncTime(): Promise<number | null> {
    const time = await AsyncStorage.getItem(STORAGE_KEYS.lastSyncTime);
    return time ? parseInt(time, 10) : null;
  }

  // ==================== User Activity (Auto-Logout) ====================

  async updateLastActivity(userId: string): Promise<void> {
    await AsyncStorage.setItem(STORAGE_KEYS.lastActivity, JSON.stringify({
      userId,
      timestamp: Date.now(),
    }));
  }

  async getLastActivityTimestamp(): Promise<number | null> {
    const data = await AsyncStorage.getItem(STORAGE_KEYS.lastActivity);
    if (data) {
      const parsed = JSON.parse(data);
      return parsed.timestamp;
    }
    return null;
  }

  async shouldAutoLogout(): Promise<boolean> {
    const lastActivity = await this.getLastActivityTimestamp();
    if (!lastActivity) return false;

    const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;
    return (Date.now() - lastActivity) > NINETY_DAYS_MS;
  }

  // ==================== Offline Queue ====================

  async addToOfflineQueue(action: {
    type: string;
    endpoint: string;
    method: string;
    payload?: any;
  }): Promise<string> {
    const queue = await this.getStoredData<any>(STORAGE_KEYS.offlineQueue);
    const id = `action_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    queue.push({
      id,
      ...action,
      timestamp: Date.now(),
      retryCount: 0,
      maxRetries: 5,
      status: 'pending',
    });

    await this.setStoredData(STORAGE_KEYS.offlineQueue, queue);
    return id;
  }

  async getOfflineQueue(): Promise<any[]> {
    return this.getStoredData<any>(STORAGE_KEYS.offlineQueue);
  }

  async removeFromOfflineQueue(id: string): Promise<void> {
    const queue = await this.getStoredData<any>(STORAGE_KEYS.offlineQueue);
    const filtered = queue.filter(item => item.id !== id);
    await this.setStoredData(STORAGE_KEYS.offlineQueue, filtered);
  }

  async updateOfflineQueueItem(id: string, updates: any): Promise<void> {
    const queue = await this.getStoredData<any>(STORAGE_KEYS.offlineQueue);
    const updated = queue.map(item =>
      item.id === id ? { ...item, ...updates } : item
    );
    await this.setStoredData(STORAGE_KEYS.offlineQueue, updated);
  }

  // ==================== Cleanup ====================

  async cleanupOldData(maxAgeDays: number = 30): Promise<void> {
    const cutoffTime = Date.now() - (maxAgeDays * 24 * 60 * 60 * 1000);
    
    // Clean up deleted items older than cutoff
    for (const key of [STORAGE_KEYS.products, STORAGE_KEYS.categories, STORAGE_KEYS.carBrands, STORAGE_KEYS.carModels]) {
      const stored = await this.getStoredData<StoredItem>(key);
      const filtered = stored.filter(
        item => !item.syncMetadata.isDeleted || item.updatedAt > cutoffTime
      );
      await this.setStoredData(key, filtered);
    }

    // Clean up old queue items
    const queue = await this.getStoredData<any>(STORAGE_KEYS.offlineQueue);
    const filteredQueue = queue.filter(
      item => item.status !== 'failed' || item.timestamp > cutoffTime
    );
    await this.setStoredData(STORAGE_KEYS.offlineQueue, filteredQueue);

    console.log('[OfflineDB] Cleaned up old data');
  }

  /**
   * Clear all offline data (for testing/reset)
   */
  async clearAll(): Promise<void> {
    const keys = Object.values(STORAGE_KEYS);
    await AsyncStorage.multiRemove(keys);
    this.cache.clear();
    console.log('[OfflineDB] All data cleared');
  }

  /**
   * Close the database connection (no-op for AsyncStorage)
   */
  async close(): Promise<void> {
    this.cache.clear();
    this.isInitialized = false;
    console.log('[OfflineDB] Database closed');
  }
}

export const offlineDatabaseService = new OfflineDatabaseService();
export default offlineDatabaseService;
