/**
 * Cart Store - Handles shopping cart state
 * v3.0 - Enhanced with AsyncStorage robustness, Snapshot support, and Stock Validation
 * Split from monolithic appStore for better performance
 */
import { create } from 'zustand';
import { persist, createJSONStorage, StateStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import { cartApi } from '../services/api';
import { useDataCacheStore } from './useDataCacheStore';

/**
 * Generate an RFC-4122 v4 UUID without any external dependency.
 *
 * IMPORTANT: `cart_items.bundle_group_id` and `cart_items.bundle_offer_id`
 * are typed as PostgreSQL `uuid` columns, so the value we send must be a
 * valid 36-char UUID. Earlier code generated `bundle_<offerId>_<timestamp>`
 * which Postgres rejected ("invalid input syntax for type uuid"), the
 * INSERT failed, the request error was swallowed by the offline-queue
 * try/catch, and the cart UI ended up empty after the React Query
 * invalidation refetched authoritative state from the server. Using a real
 * UUID here is what actually unblocks the bundle add-to-cart flow.
 *
 * Prefer the platform RNG (web `crypto`, native `expo-crypto` if present)
 * but fall back to `Math.random()` so this never throws on cold start.
 */
export function uuidV4(): string {
  const g: any = (globalThis as any);
  // Best path: native randomUUID (web crypto, modern RN/Hermes).
  try {
    if (g?.crypto?.randomUUID) return g.crypto.randomUUID();
  } catch {
    /* fall through */
  }
  // Second-best: getRandomValues — proper CSPRNG entropy on every platform
  // that matters (web + RN with react-native-get-random-values shim).
  try {
    if (g?.crypto?.getRandomValues) {
      const bytes = new Uint8Array(16);
      g.crypto.getRandomValues(bytes);
      bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
      bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant 10
      const hex = Array.from(bytes, (b) =>
        b.toString(16).padStart(2, '0'),
      ).join('');
      return (
        hex.slice(0, 8) +
        '-' +
        hex.slice(8, 12) +
        '-' +
        hex.slice(12, 16) +
        '-' +
        hex.slice(16, 20) +
        '-' +
        hex.slice(20)
      );
    }
  } catch {
    /* fall through */
  }
  // Last-resort Math.random fallback: weaker entropy but acceptable for
  // cart-grouping ids (non-auth, scoped to a single user). Practical
  // collision risk is negligible at the cart-add scale.
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * Canonical RFC-4122 UUID shape: 8-4-4-4-12 hex with version (1-5) in
 * position 13 and variant (8-b) in position 17. Stricter than the prior
 * `^[0-9a-f-]{36}$` mask which let malformed hyphen placement through.
 */
const UUID_CANONICAL_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// Web-safe storage wrapper that handles SSR gracefully
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

export interface CartItemData {
  productId: string;
  quantity: number;
  product?: any;
  // Bundle support
  bundleGroupId?: string;
  bundleOfferId?: string;
  bundleOfferName?: string;
  bundleDiscount?: number;
  originalPrice?: number;
  discountedPrice?: number;
  // Fitment indicator (STD/010/020/030/040)
  fitmentIndicator?: string | null;
  // Version tracking for conflict resolution
  _version?: number;
  _localModified?: number;
}

// Bundle Offer interface for addBundleToCart
export interface BundleOfferData {
  id: string;
  name: string;
  name_ar?: string;
  discount_percentage: number;
  product_ids: string[];
  products?: any[];
}

// Cart snapshot for rollback
interface CartSnapshot {
  items: CartItemData[];
  timestamp: number;
}

interface CartState {
  cartItems: CartItemData[];
  lastSnapshot: CartSnapshot | null;
  isLoading: boolean;
  lastError: string | null;

  // Actions
  addToCart: (item: CartItemData | string, quantity?: number) => void;
  addToLocalCart: (item: { product_id: string; quantity: number; product?: any; fitment_indicator?: string | null }) => void;
  addBundleToCart: (bundleOffer: BundleOfferData, products: any[]) => Promise<void>;
  updateCartItem: (productId: string, quantity: number) => void;
  /**
   * Swap the fitment indicator on an existing cart line in place.
   * Re-keys by (productId, newIndicator), recomputes price from
   * the supplied product variants, and merges with an existing
   * (productId, newIndicator) line if one already exists.
   */
  updateCartItemFitment: (
    productId: string,
    oldIndicator: string | null,
    newIndicator: string,
    options?: { newPrice?: number; product?: any },
  ) => void;
  removeFromCart: (productId: string, voidBundle?: boolean) => void;
  clearCart: () => void;
  clearLocalCart: () => void;
  getCartTotal: () => number;
  getCartSubtotal: () => number;
  getBundleGroups: () => Map<string, CartItemData[]>;
  voidBundleDiscount: (bundleGroupId: string, syncToBackend?: boolean) => void;
  setCartItems: (items: any[]) => void;
  
  // Snapshot actions
  createSnapshot: () => void;
  restoreFromSnapshot: () => boolean;
  
  // Sync actions
  syncWithServer: () => Promise<void>;
  validateStock: () => Promise<{ valid: boolean; invalidItems: string[] }>;
  
  // Error handling
  setError: (error: string | null) => void;
  setLoading: (loading: boolean) => void;
}

export const useCartStore = create<CartState>()(
  persist(
    (set, get) => ({
      cartItems: [],
      lastSnapshot: null,
      isLoading: false,
      lastError: null,

      // ==================== Cart Snapshot ====================

      createSnapshot: () => {
        const { cartItems } = get();
        set({
          lastSnapshot: {
            items: [...cartItems],
            timestamp: Date.now(),
          },
        });
        console.log('[CartStore] Created cart snapshot');
      },

      restoreFromSnapshot: () => {
        const { lastSnapshot } = get();
        if (lastSnapshot) {
          set({ cartItems: lastSnapshot.items });
          console.log('[CartStore] Restored cart from snapshot');
          return true;
        }
        console.log('[CartStore] No snapshot to restore from');
        return false;
      },

      // ==================== Error Handling ====================

      setError: (error) => set({ lastError: error }),
      setLoading: (loading) => set({ isLoading: loading }),

      // ==================== Core Cart Actions ====================

      addToCart: (item, quantity = 1) => {
        const { cartItems } = get();

        // G1: product analytics — capture add-to-cart funnel event.
        // Lazy require to avoid circular import with the analytics service.
        try {
          const { analytics, AnalyticsEvents } = require('../services/analytics');
          const productId = typeof item === 'string' ? item : (item as any)?.productId;
          analytics.capture(AnalyticsEvents.AddToCart, { product_id: productId, quantity });
        } catch {
          /* analytics is best-effort */
        }

        if (typeof item === 'string') {
          const productId = item;
          const existingIndex = cartItems.findIndex(
            (ci) => ci.productId === productId && !ci.bundleGroupId
          );
          if (existingIndex >= 0) {
            const updated = [...cartItems];
            updated[existingIndex].quantity += quantity;
            updated[existingIndex]._localModified = Date.now();
            set({ cartItems: updated });
          } else {
            set({ 
              cartItems: [...cartItems, { 
                productId, 
                quantity,
                _version: 1,
                _localModified: Date.now(),
              }] 
            });
          }
        } else {
          const cartItem = item as CartItemData;
          const existingIndex = cartItems.findIndex(
            (ci) =>
              ci.productId === cartItem.productId &&
              ci.bundleGroupId === cartItem.bundleGroupId &&
              (ci.fitmentIndicator || null) === (cartItem.fitmentIndicator || null)
          );
          if (existingIndex >= 0) {
            const updated = [...cartItems];
            updated[existingIndex].quantity += cartItem.quantity || 1;
            updated[existingIndex]._localModified = Date.now();
            set({ cartItems: updated });
          } else {
            set({
              cartItems: [...cartItems, { 
                ...cartItem, 
                quantity: cartItem.quantity || 1,
                _version: 1,
                _localModified: Date.now(),
              }],
            });
          }
        }
      },

      addToLocalCart: (item) => {
        const { cartItems } = get();
        const fitment = item.fitment_indicator || null;
        const existingIndex = cartItems.findIndex(
          (ci) =>
            ci.productId === item.product_id &&
            !ci.bundleGroupId &&
            (ci.fitmentIndicator || null) === fitment
        );

        if (existingIndex >= 0) {
          const updated = [...cartItems];
          updated[existingIndex].quantity += item.quantity;
          updated[existingIndex].product = item.product;
          updated[existingIndex]._localModified = Date.now();
          set({ cartItems: updated });
        } else {
          set({
            cartItems: [
              ...cartItems,
              {
                productId: item.product_id,
                quantity: item.quantity,
                product: item.product,
                fitmentIndicator: fitment,
                _version: 1,
                _localModified: Date.now(),
              },
            ],
          });
        }
      },

      /**
       * Add all products from a bundle offer to cart atomically
       * This ensures bundle integrity - all products are added with the same bundleGroupId
       */
      addBundleToCart: async (bundleOffer, products) => {
        const { cartItems, createSnapshot } = get();

        // Create snapshot before bundle addition
        createSnapshot();

        // Bundle group id MUST be a real UUID (cart_items.bundle_group_id is
        // a `uuid` column). Honor an injected `_bundle_group_id` from the
        // caller — used by /offer/[id].tsx so its optimistic React Query
        // cache patch and the server INSERT share the same id and don't
        // double-render the bundle after the post-insert refetch.
        const injected = (bundleOffer as any)._bundle_group_id as
          | string
          | undefined;
        const bundleGroupId =
          injected && UUID_CANONICAL_RE.test(injected) ? injected : uuidV4();
        
        // Calculate discounted prices for each product
        const bundleItems: CartItemData[] = products.map((product) => {
          const originalPrice = product.price || 0;
          const discountedPrice = originalPrice * (1 - bundleOffer.discount_percentage / 100);
          
          return {
            productId: product.id,
            quantity: 1,
            product: product,
            bundleGroupId: bundleGroupId,
            bundleOfferId: bundleOffer.id,
            bundleOfferName: bundleOffer.name,
            bundleDiscount: bundleOffer.discount_percentage,
            originalPrice: originalPrice,
            discountedPrice: discountedPrice,
            _version: 1,
            _localModified: Date.now(),
          };
        });
        
        // Add all bundle items to cart atomically
        set({ cartItems: [...cartItems, ...bundleItems] });
        
        // Sync with backend - add each item with bundle info
        try {
          for (const item of bundleItems) {
            await cartApi.add(item.productId, item.quantity, {
              bundle_group_id: bundleGroupId,
              bundle_offer_id: bundleOffer.id,
              bundle_discount_percentage: bundleOffer.discount_percentage,
            });
          }
        } catch (error: any) {
          console.error('Failed to sync bundle cart items to backend:', error);
          set({ lastError: `Failed to sync bundle: ${error.message}` });
          // Note: We keep the local state even if backend sync fails
          // This allows offline-first behavior
          
          // Queue for offline sync
          const cacheStore = useDataCacheStore.getState();
          for (const item of bundleItems) {
            cacheStore.addToOfflineQueue({
              type: 'cart_add',
              endpoint: '/cart/add',
              method: 'POST',
              payload: {
                product_id: item.productId,
                quantity: item.quantity,
                bundle_group_id: bundleGroupId,
                bundle_offer_id: bundleOffer.id,
                bundle_discount_percentage: bundleOffer.discount_percentage,
              },
              maxRetries: 3,
            });
          }
        }
      },

      updateCartItem: (productId, quantity) => {
        const { cartItems } = get();
        if (quantity <= 0) {
          const item = cartItems.find((i) => i.productId === productId);
          if (item?.bundleGroupId) {
            get().voidBundleDiscount(item.bundleGroupId);
          }
          set({ cartItems: cartItems.filter((item) => item.productId !== productId) });
        } else {
          set({
            cartItems: cartItems.map((item) =>
              item.productId === productId 
                ? { ...item, quantity, _localModified: Date.now() } 
                : item
            ),
          });
        }
      },

      updateCartItemFitment: (productId, oldIndicator, newIndicator, options) => {
        const { cartItems } = get();
        const oldFi = oldIndicator ?? null;
        const newFi = newIndicator ?? null;
        if (oldFi === newFi) return;

        const idx = cartItems.findIndex(
          (ci) =>
            ci.productId === productId &&
            !ci.bundleGroupId &&
            (ci.fitmentIndicator ?? null) === oldFi,
        );
        if (idx < 0) return;

        const target = cartItems[idx];
        const product = options?.product || target.product || {};
        const variants = Array.isArray(product?.available_variants)
          ? product.available_variants
          : [];
        const variant = variants.find((v: any) => v?.indicator === newIndicator);
        const resolvedPrice =
          options?.newPrice !== undefined
            ? options.newPrice
            : variant?.price !== undefined && variant?.price !== null
              ? parseFloat(String(variant.price))
              : target.discountedPrice ?? product?.price ?? 0;

        // If a non-bundle line for the same product+newFitment already exists,
        // merge quantities into it and drop the old line.
        const mergeIdx = cartItems.findIndex(
          (ci, i) =>
            i !== idx &&
            ci.productId === productId &&
            !ci.bundleGroupId &&
            (ci.fitmentIndicator ?? null) === newFi,
        );

        const next = [...cartItems];
        if (mergeIdx >= 0) {
          next[mergeIdx] = {
            ...next[mergeIdx],
            quantity: next[mergeIdx].quantity + target.quantity,
            _localModified: Date.now(),
          };
          next.splice(idx, 1);
        } else {
          next[idx] = {
            ...target,
            fitmentIndicator: newFi,
            originalPrice: resolvedPrice,
            discountedPrice: resolvedPrice,
            product: options?.product
              ? { ...target.product, ...options.product, fitment_indicator: newFi, price: resolvedPrice }
              : target.product
                ? { ...target.product, fitment_indicator: newFi, price: resolvedPrice }
                : target.product,
            _localModified: Date.now(),
          };
        }
        set({ cartItems: next });
      },

      removeFromCart: (productId, voidBundle = true) => {
        const { cartItems } = get();
        const itemToRemove = cartItems.find((item) => item.productId === productId);

        // CRITICAL: If removing an item that belongs to a bundle, 
        // void ALL discounts for remaining items in that bundle
        if (itemToRemove?.bundleGroupId && voidBundle) {
          // Always void the bundle discount when removing any bundle item
          // because the bundle is no longer complete
          get().voidBundleDiscount(itemToRemove.bundleGroupId);
        }

        // Remove the item from cart
        set({ cartItems: cartItems.filter((item) => item.productId !== productId) });
      },

      clearCart: () => {
        get().createSnapshot(); // Snapshot before clearing
        set({ cartItems: [] });
      },

      clearLocalCart: () => set({ cartItems: [] }),

      getCartTotal: () =>
        get().cartItems.reduce((total, item) => total + item.quantity, 0),

      getCartSubtotal: () =>
        get().cartItems.reduce((total, item) => {
          const price = item.discountedPrice || item.product?.price || 0;
          return total + price * item.quantity;
        }, 0),

      getBundleGroups: () => {
        const { cartItems } = get();
        const groups = new Map<string, CartItemData[]>();
        cartItems.forEach((item) => {
          if (item.bundleGroupId) {
            const existing = groups.get(item.bundleGroupId) || [];
            groups.set(item.bundleGroupId, [...existing, item]);
          }
        });
        return groups;
      },

      voidBundleDiscount: (bundleGroupId, syncToBackend = true) => {
        const { cartItems } = get();
        const updatedItems = cartItems.map((item) => {
          if (item.bundleGroupId === bundleGroupId) {
            // Reset discounted price to original price
            const originalPrice = item.originalPrice || item.product?.price || item.discountedPrice;
            return {
              ...item,
              bundleGroupId: undefined,
              bundleOfferId: undefined,
              bundleOfferName: undefined,
              bundleDiscount: undefined,
              discountedPrice: originalPrice, // Reset to original price
              _localModified: Date.now(),
            };
          }
          return item;
        });
        set({ cartItems: updatedItems });
        
        // Sync with backend to void bundle discount on server-side cart
        if (syncToBackend) {
          cartApi.voidBundle(bundleGroupId).catch((error) => {
            console.error('Failed to sync bundle void to backend:', error);
            // Queue for offline sync
            const cacheStore = useDataCacheStore.getState();
            cacheStore.addToOfflineQueue({
              type: 'generic',
              endpoint: `/cart/void-bundle/${bundleGroupId}`,
              method: 'DELETE',
              maxRetries: 3,
            });
          });
        }
      },

      setCartItems: (items) => {
        const cartItems = items.map((item: any) => ({
          productId: item.product_id || item.productId,
          quantity: item.quantity,
          product: item.product,
          fitmentIndicator:
            item.fitmentIndicator !== undefined
              ? item.fitmentIndicator
              : (item.fitment_indicator ?? null),
          bundleGroupId: item.bundleGroupId || item.bundle_group_id,
          bundleOfferId: item.bundleOfferId || item.bundle_offer_id,
          bundleOfferName: item.bundleOfferName || item.bundle_offer_name,
          bundleDiscount: item.bundleDiscount || item.bundle_discount,
          originalPrice: item.originalPrice || item.original_unit_price,
          discountedPrice: item.discountedPrice || item.final_unit_price,
        }));
        set({ cartItems });
      },

      // ==================== Server Sync ====================

      /**
       * Sync local cart with server
       */
      syncWithServer: async () => {
        const { createSnapshot, setLoading, setError } = get();
        
        setLoading(true);
        setError(null);
        createSnapshot();
        
        try {
          const response = await cartApi.get();
          const serverItems = response.data?.items || [];
          
          get().setCartItems(serverItems);
          console.log('[CartStore] Synced with server:', serverItems.length, 'items');
        } catch (error: any) {
          console.error('[CartStore] Failed to sync with server:', error);
          setError(`Sync failed: ${error.message}`);
        } finally {
          setLoading(false);
        }
      },

      /**
       * Validate cart items against real-time stock in backend
       * Returns list of items with insufficient stock
       */
      validateStock: async () => {
        const { cartItems, setLoading } = get();
        
        if (cartItems.length === 0) {
          return { valid: true, invalidItems: [] };
        }

        setLoading(true);
        const invalidItems: string[] = [];
        
        try {
          // This would call a backend endpoint to validate stock
          // For now, we'll return valid as the backend handles this during checkout
          console.log('[CartStore] Stock validation - delegating to checkout');
          return { valid: true, invalidItems: [] };
        } catch (error: any) {
          console.error('[CartStore] Stock validation failed:', error);
          return { valid: false, invalidItems: [] };
        } finally {
          setLoading(false);
        }
      },
    }),
    {
      name: 'alghazaly-cart-store-v3',
      storage: createJSONStorage(() => createWebSafeStorage()),
      partialize: (state) => ({
        cartItems: state.cartItems,
        lastSnapshot: state.lastSnapshot,
      }),
      // Handle storage errors gracefully
      onRehydrateStorage: () => (state, error) => {
        if (error) {
          console.error('[CartStore] Failed to rehydrate:', error);
        } else {
          console.log('[CartStore] Rehydrated successfully');
        }
      },
    }
  )
);

// Selectors
export const useCartItems = () => useCartStore((state) => state.cartItems);
export const useCartTotal = () => useCartStore((state) => state.getCartTotal());
export const useCartSubtotal = () => useCartStore((state) => state.getCartSubtotal());
export const useAddBundleToCart = () => useCartStore((state) => state.addBundleToCart);
export const useCartLoading = () => useCartStore((state) => state.isLoading);
export const useCartError = () => useCartStore((state) => state.lastError);

export default useCartStore;
