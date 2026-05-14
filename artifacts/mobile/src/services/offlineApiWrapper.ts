/**
 * Offline API Wrapper
 * Intercepts critical API calls and queues them when offline
 * v1.0 - Handles cart, orders, and favorites
 */
import { useDataCacheStore, OfflineActionType } from '../store/useDataCacheStore';
import { cartApi, orderApi, favoriteApi } from './api';

/**
 * Check if the device is currently online
 */
export const isDeviceOnline = (): boolean => {
  return useDataCacheStore.getState().isOnline;
};

/**
 * Queue an action for later execution when offline
 */
const queueAction = (
  type: OfflineActionType,
  endpoint: string,
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  payload?: any,
  maxRetries: number = 3
): void => {
  const store = useDataCacheStore.getState();
  store.addToOfflineQueue({
    type,
    endpoint,
    method,
    payload,
    maxRetries,
  });
  console.log(`[OfflineAPI] Queued action: ${type}`, payload);
};

/**
 * Offline-aware Cart API wrapper
 */
export const offlineCartApi = {
  /**
   * Add item to cart - queues if offline
   */
  addItem: async (productId: string, quantity: number): Promise<any> => {
    if (isDeviceOnline()) {
      return cartApi.addItem(productId, quantity);
    }
    
    queueAction('cart_add', '/cart/add', 'POST', { product_id: productId, quantity });
    
    // Return optimistic response
    return {
      data: {
        success: true,
        queued: true,
        message: 'Action queued for when you are back online',
      },
    };
  },

  /**
   * Update cart item - queues if offline
   */
  updateItem: async (productId: string, quantity: number): Promise<any> => {
    if (isDeviceOnline()) {
      return cartApi.updateItem(productId, quantity);
    }
    
    queueAction('cart_update', '/cart/update', 'PUT', { product_id: productId, quantity });
    
    return {
      data: {
        success: true,
        queued: true,
        message: 'Action queued for when you are back online',
      },
    };
  },

  /**
   * Clear cart - queues if offline
   */
  clear: async (): Promise<any> => {
    if (isDeviceOnline()) {
      return cartApi.clear();
    }
    
    queueAction('cart_clear', '/cart/clear', 'DELETE', undefined);
    
    return {
      data: {
        success: true,
        queued: true,
        message: 'Action queued for when you are back online',
      },
    };
  },

  /**
   * Get cart - returns cached data if offline
   */
  get: async (): Promise<any> => {
    if (isDeviceOnline()) {
      return cartApi.get();
    }
    
    // Return empty cart when offline (we can't fetch)
    console.log('[OfflineAPI] Offline - returning cached/empty cart');
    return {
      data: {
        items: [],
        offline: true,
      },
    };
  },
};

/**
 * Offline-aware Order API wrapper
 */
export const offlineOrderApi = {
  /**
   * Create order - queues if offline (NOT RECOMMENDED for orders)
   * Orders typically should require online connectivity for inventory checks
   */
  create: async (data: any): Promise<any> => {
    if (isDeviceOnline()) {
      return orderApi.create(data);
    }
    
    // For orders, we queue but warn about potential inventory issues
    queueAction('order_create', '/orders', 'POST', data, 5); // More retries for orders
    
    return {
      data: {
        success: true,
        queued: true,
        warning: 'Order queued - stock availability will be confirmed when online',
        message: 'Your order has been saved and will be submitted when you are back online',
      },
    };
  },

  /**
   * Get all orders - returns cached data if offline
   */
  getAll: async (): Promise<any> => {
    if (isDeviceOnline()) {
      return orderApi.getAll();
    }
    
    const cachedOrders = useDataCacheStore.getState().orders;
    console.log('[OfflineAPI] Offline - returning cached orders');
    return {
      data: {
        orders: cachedOrders,
        offline: true,
      },
    };
  },
};

/**
 * Offline-aware Favorites API wrapper
 */
export const offlineFavoriteApi = {
  /**
   * Toggle favorite - queues if offline
   */
  toggle: async (productId: string): Promise<any> => {
    if (isDeviceOnline()) {
      return favoriteApi.toggle(productId);
    }
    
    queueAction('favorite_toggle', '/favorites/toggle', 'POST', { product_id: productId });
    
    return {
      data: {
        success: true,
        queued: true,
        is_favorite: true, // Optimistic: assume it was added
        message: 'Favorite action queued for when you are back online',
      },
    };
  },

  /**
   * Get all favorites - returns cached data if offline
   */
  getAll: async (): Promise<any> => {
    if (isDeviceOnline()) {
      return favoriteApi.getAll();
    }
    
    // We don't cache favorites in the current store, return empty
    console.log('[OfflineAPI] Offline - favorites not available');
    return {
      data: {
        favorites: [],
        offline: true,
      },
    };
  },
};

/**
 * Get the current offline queue status
 */
export const getOfflineQueueStatus = () => {
  const store = useDataCacheStore.getState();
  const queue = store.offlineActionsQueue;
  
  return {
    isOnline: store.isOnline,
    queueLength: queue.length,
    pendingActions: queue.filter(a => a.status === 'pending').length,
    failedActions: queue.filter(a => a.status === 'failed').length,
    isProcessing: store.isProcessingQueue,
  };
};

/**
 * Clear failed actions from the queue
 */
export const clearFailedActions = () => {
  const store = useDataCacheStore.getState();
  const queue = store.offlineActionsQueue;
  
  queue.forEach(action => {
    if (action.status === 'failed') {
      store.removeFromOfflineQueue(action.id);
    }
  });
};

export default {
  cart: offlineCartApi,
  order: offlineOrderApi,
  favorite: offlineFavoriteApi,
  getQueueStatus: getOfflineQueueStatus,
  clearFailedActions,
  isOnline: isDeviceOnline,
};
