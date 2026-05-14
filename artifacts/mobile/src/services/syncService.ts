/**
 * Background Sync Service v4.0
 * - Delta sync: fetches only changes since last sync (not all data)
 * - Exponential backoff on failure (avoids hammering a down server)
 * - Single instance guard (never starts twice)
 * - Background interval: 5 minutes (not 60s)
 * - Offline queue processing when connectivity restores
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAppStore } from '../store/appStore';
import { useDataCacheStore, OfflineAction, SyncResult } from '../store/useDataCacheStore';
import {
  cartApi,
  favoriteApi,
  orderApi,
  productApi,
  api
} from './api';

const SYNC_TIMESTAMP_KEY = 'alghazaly_last_sync';
const SYNC_INTERVAL_MS   = 5 * 60 * 1000; // 5 minutes
const CLEANUP_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes

// Exponential backoff: 10s, 20s, 40s, 80s, 160s (max 5 min)
const BACKOFF_BASE_MS  = 10_000;
const BACKOFF_MAX_MS   = SYNC_INTERVAL_MS;

// ─── helpers ────────────────────────────────────────────────────────────────

async function getLastSyncTimestamp(): Promise<string | null> {
  try { return await AsyncStorage.getItem(SYNC_TIMESTAMP_KEY); }
  catch { return null; }
}

async function saveLastSyncTimestamp(ts: string): Promise<void> {
  try { await AsyncStorage.setItem(SYNC_TIMESTAMP_KEY, ts); }
  catch { /* ignore */ }
}

function mergeItems(existing: any[], newItems: any[], deletedIds: string[], isDelta: boolean): any[] {
  if (!isDelta || existing.length === 0) return newItems;
  const updatedMap = new Map(newItems.map((i: any) => [i.id, i]));
  const deletedSet = new Set(deletedIds);
  const merged = existing
    .filter((i: any) => !deletedSet.has(i.id))
    .map((i: any) => updatedMap.has(i.id) ? updatedMap.get(i.id) : i);
  newItems.forEach((i: any) => {
    if (!merged.some((e: any) => e.id === i.id)) merged.push(i);
  });
  return merged;
}

// ─── SyncService ─────────────────────────────────────────────────────────────

class SyncService {
  private syncTimer: ReturnType<typeof setTimeout> | null = null;
  private cleanupInterval: ReturnType<typeof setInterval> | null = null;
  private isRunning = false;
  private failureCount = 0;
  private wasOffline = false;

  // ── lifecycle ───────────────────────────────────────────────────────────────

  start() {
    if (this.isRunning) return;
    this.isRunning = true;
    console.log('[SyncService v4] Started — interval 5 min, delta sync');

    this.scheduleNext(0); // immediate first sync

    this.cleanupInterval = setInterval(() => {
      this.performCleanup();
    }, CLEANUP_INTERVAL_MS);
  }

  stop() {
    if (this.syncTimer)      { clearTimeout(this.syncTimer);          this.syncTimer = null; }
    if (this.cleanupInterval){ clearInterval(this.cleanupInterval);   this.cleanupInterval = null; }
    this.isRunning = false;
    console.log('[SyncService v4] Stopped');
  }

  forceSync() {
    if (this.syncTimer) { clearTimeout(this.syncTimer); this.syncTimer = null; }
    return this.runSync();
  }

  handleNetworkChange(isOnline: boolean) {
    const cacheStore = useDataCacheStore.getState();
    const appStore   = useAppStore.getState();
    cacheStore.setOnline(isOnline);
    appStore.setOnline(isOnline);

    if (isOnline && this.wasOffline) {
      console.log('[SyncService v4] Network restored — processing offline queue then syncing');
      this.wasOffline = false;
      this.failureCount = 0; // reset backoff
      this.processOfflineQueue().then(() => this.forceSync());
    } else if (!isOnline) {
      this.wasOffline = true;
    }
  }

  forceProcessQueue() { return this.processOfflineQueue(); }

  setSyncInterval() {
    // interval is fixed at 5 min in this version
    if (this.isRunning) { this.stop(); this.start(); }
  }

  getSyncSummary() {
    const cacheStore = useDataCacheStore.getState();
    const lastResults = cacheStore.lastSyncResults;
    const conflicts   = cacheStore.getConflicts();
    const queueLength = cacheStore.getQueueLength();
    return {
      lastSyncTime:      cacheStore.lastSyncTime,
      syncResults:       lastResults,
      successCount:      lastResults.filter((r) => r.success).length,
      failCount:         lastResults.filter((r) => !r.success).length,
      conflictCount:     conflicts.length,
      pendingQueueItems: queueLength,
    };
  }

  // ── internal ─────────────────────────────────────────────────────────────────

  private scheduleNext(delayMs: number) {
    if (!this.isRunning) return;
    this.syncTimer = setTimeout(() => {
      this.runSync().then(() => {
        this.scheduleNext(SYNC_INTERVAL_MS);
      });
    }, delayMs);
  }

  private async runSync(): Promise<void> {
    const store = useAppStore.getState();

    if (!store.isOnline) {
      console.log('[SyncService v4] Offline — skipping sync');
      this.wasOffline = true;
      return;
    }

    if (store.syncStatus === 'syncing') {
      console.log('[SyncService v4] Already syncing — skipping');
      return;
    }

    if (this.wasOffline && store.isOnline) {
      this.wasOffline = false;
      await this.processOfflineQueue();
    }

    store.setSyncStatus('syncing');
    store.setSyncError(null);

    try {
      await this.performDeltaSync();
      this.failureCount = 0;
    } catch (err: any) {
      this.failureCount++;
      const backoff = Math.min(BACKOFF_BASE_MS * Math.pow(2, this.failureCount - 1), BACKOFF_MAX_MS);
      console.error(`[SyncService v4] Sync failed (attempt ${this.failureCount}), next retry in ${backoff / 1000}s:`, err.message);
      store.setSyncStatus('error');
      store.setSyncError(err.message || 'Sync failed');

      // Schedule a retry sooner than the normal 5-min interval
      if (this.syncTimer) { clearTimeout(this.syncTimer); this.syncTimer = null; }
      this.scheduleNext(backoff);
      setTimeout(() => {
        if (useAppStore.getState().syncStatus === 'error') {
          useAppStore.getState().setSyncStatus('idle');
        }
      }, 5000);
      return;
    }
  }

  /**
   * Delta sync via /api/delta-sync/full
   * - First call: full fetch (no last_sync param)
   * - Subsequent calls: only changed records since last_sync
   */
  private async performDeltaSync(): Promise<void> {
    const store      = useAppStore.getState();
    const cacheStore = useDataCacheStore.getState();

    const lastSync = await getLastSyncTimestamp();
    const params: any = { tables: 'products,categories,car_brands,car_models,product_brands' };
    if (lastSync) params.last_sync = lastSync;

    const response = await api.get('/delta-sync/full', { params });
    const { data, server_time, is_delta } = response.data;

    const syncResults: SyncResult[] = [];

    if (data.products) {
      const merged = mergeItems(store.products, data.products.items, data.products.deleted_ids, is_delta);
      store.setProducts(merged);
      cacheStore.setProducts(merged);
      syncResults.push({ resource: 'products', success: true, itemCount: data.products.items.length, timestamp: Date.now() });
    }

    if (data.categories) {
      const merged = mergeItems(store.categories, data.categories.items, data.categories.deleted_ids, is_delta);
      store.setCategories(merged);
      cacheStore.setCategories(merged);
      syncResults.push({ resource: 'categories', success: true, itemCount: data.categories.items.length, timestamp: Date.now() });
    }

    if (data.car_brands) {
      const merged = mergeItems(store.carBrands, data.car_brands.items, data.car_brands.deleted_ids, is_delta);
      store.setCarBrands(merged);
      cacheStore.setCarBrands(merged);
      syncResults.push({ resource: 'carBrands', success: true, itemCount: data.car_brands.items.length, timestamp: Date.now() });
    }

    if (data.car_models) {
      const merged = mergeItems(store.carModels, data.car_models.items, data.car_models.deleted_ids, is_delta);
      store.setCarModels(merged);
      cacheStore.setCarModels(merged);
      syncResults.push({ resource: 'carModels', success: true, itemCount: data.car_models.items.length, timestamp: Date.now() });
    }

    if (data.product_brands) {
      const merged = mergeItems(store.productBrands, data.product_brands.items, data.product_brands.deleted_ids, is_delta);
      store.setProductBrands(merged);
      cacheStore.setProductBrands(merged);
      syncResults.push({ resource: 'productBrands', success: true, itemCount: data.product_brands.items.length, timestamp: Date.now() });
    }

    // Privileged data: only for owners/partners — fetched independently, no delta
    const userRole = store.userRole;
    if (['owner', 'partner'].includes(userRole)) {
      try {
        const ordersRes = await orderApi.getAllAdmin();
        const orders = ordersRes.data?.orders || [];
        store.setOrders(orders);
        cacheStore.setOrders(orders);
        syncResults.push({ resource: 'orders', success: true, itemCount: orders.length, timestamp: Date.now() });
      } catch (e: any) {
        syncResults.push({ resource: 'orders', success: false, errorMessage: e.message, timestamp: Date.now() });
      }
    }

    // Update stores and timestamp
    await saveLastSyncTimestamp(server_time);
    store.setLastSyncTime(Date.now());
    cacheStore.setLastSyncTime(Date.now());
    cacheStore.setLastSyncResults(syncResults);
    store.setSyncStatus('success');
    cacheStore.cleanupAfterSync();

    const changed = syncResults.reduce((sum, r) => sum + (r.itemCount || 0), 0);
    console.log(`[SyncService v4] ${is_delta ? 'Delta' : 'Full'} sync done — ${changed} items across ${syncResults.length} tables`);

    setTimeout(() => {
      if (useAppStore.getState().syncStatus === 'success') {
        useAppStore.getState().setSyncStatus('idle');
      }
    }, 3000);
  }

  // ── offline queue ────────────────────────────────────────────────────────────

  async processOfflineQueue(): Promise<number> {
    const cacheStore = useDataCacheStore.getState();
    const queue = cacheStore.offlineActionsQueue;
    if (queue.length === 0) return 0;
    if (cacheStore.isProcessingQueue) return 0;

    console.log(`[SyncService v4] Processing ${queue.length} offline actions`);
    cacheStore.setProcessingQueue(true);

    let successCount = 0;
    let failCount = 0;

    for (const action of queue) {
      if (action.status === 'processing') continue;
      try {
        cacheStore.updateQueueAction(action.id, { status: 'processing' });
        await this.executeOfflineAction(action);
        cacheStore.removeFromOfflineQueue(action.id);
        successCount++;
      } catch (error: any) {
        failCount++;
        const newRetryCount = action.retryCount + 1;
        if (newRetryCount >= action.maxRetries) {
          cacheStore.updateQueueAction(action.id, { status: 'failed', retryCount: newRetryCount, errorMessage: error.message });
        } else {
          cacheStore.updateQueueAction(action.id, { status: 'pending', retryCount: newRetryCount, errorMessage: error.message });
        }
      }
    }

    cacheStore.setProcessingQueue(false);
    console.log(`[SyncService v4] Queue done: ${successCount} ok, ${failCount} failed`);
    return successCount;
  }

  private async executeOfflineAction(action: OfflineAction): Promise<void> {
    switch (action.type) {
      case 'cart_add':
        await cartApi.addItem(action.payload.product_id, action.payload.quantity);
        break;
      case 'cart_update':
        await cartApi.updateItem(action.payload.product_id, action.payload.quantity);
        break;
      case 'cart_clear':
        await cartApi.clear();
        break;
      case 'order_create':
        await orderApi.create(action.payload);
        break;
      case 'favorite_toggle':
        await favoriteApi.toggle(action.payload.product_id);
        break;
      default: {
        const config: any = { method: action.method, url: action.endpoint };
        if (action.payload && ['POST', 'PUT', 'PATCH'].includes(action.method)) {
          config.data = action.payload;
        }
        await api(config);
      }
    }
  }

  // ── cleanup ──────────────────────────────────────────────────────────────────

  private performCleanup() {
    const cacheStore = useDataCacheStore.getState();
    const purged = cacheStore.purgeOldQueueItems();
    if (purged > 0) console.log(`[SyncService v4] Cleanup: purged ${purged} old queue items`);
    cacheStore.cleanupAfterSync();
  }
}

// ─── singleton ────────────────────────────────────────────────────────────────

export const syncService = new SyncService();

export const useSyncService = () => ({
  start:              () => syncService.start(),
  stop:               () => syncService.stop(),
  forceSync:          () => syncService.forceSync(),
  forceProcessQueue:  () => syncService.processOfflineQueue(),
  setSyncInterval:    (_ms: number) => syncService.setSyncInterval(),
  handleNetworkChange:(isOnline: boolean) => syncService.handleNetworkChange(isOnline),
  getSyncSummary:     () => syncService.getSyncSummary(),
});

export default syncService;
