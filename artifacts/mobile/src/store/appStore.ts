/**
 * Extended Zustand Store for Al-Ghazaly Auto Parts
 * Advanced Owner Interface - Complete State Management
 */
import { create, type StateCreator } from 'zustand';
import { persist, createJSONStorage, StateStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import { setApiAuthToken, authApi, registerSessionExpiredCallback } from '../services/api';
import type { DayHours } from '../utils/timeUtils';
import type { Order } from '../hooks/shopping/types';

// Grace period: after hydration with a stored session, wait this many ms before
// allowing 401 responses to force-logout the user. This prevents a race condition
// where eager API requests (fired before validateSession completes) return 401
// and log the user out before session validation has a chance to confirm the token.
let _hydrationGraceUntil = 0;
let _sessionValidating = false;

// Web-safe storage wrapper that handles SSR gracefully
const createWebSafeStorage = (): StateStorage => {
  // For SSR (no window), return a no-op storage
  if (typeof window === 'undefined') {
    return {
      getItem: () => null,
      setItem: () => {},
      removeItem: () => {},
    };
  }
  
  // On web, use localStorage
  if (Platform.OS === 'web') {
    return {
      getItem: (name) => {
        try {
          return localStorage.getItem(name);
        } catch {
          return null;
        }
      },
      setItem: (name, value) => {
        try {
          localStorage.setItem(name, value);
        } catch {
          // Ignore storage errors
        }
      },
      removeItem: (name) => {
        try {
          localStorage.removeItem(name);
        } catch {
          // Ignore storage errors
        }
      },
    };
  }
  
  // On native, use AsyncStorage
  return AsyncStorage;
};

// Types
export type SyncStatus = 'idle' | 'syncing' | 'success' | 'error';
export type UserRole = 'guest' | 'user' | 'subscriber' | 'admin' | 'partner' | 'owner' | 'restaurant_user';

export interface User {
  id: string;
  email: string;
  name: string;
  picture?: string;
  is_admin?: boolean;
  role?: UserRole;
  phone?: string | null;
  phone_verified?: boolean;
  preferred_language?: 'en' | 'ar';
}

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
}

export interface NotificationMetadata {
  kind?:
    | 'new_order'
    | 'order_updated'
    | 'order_confirmation'
    | 'promotion'
    | 'bundle_offer'
    | 'appointment_confirmed'
    | 'customer_appointment_booked'
    | 'appointment_change_request'
    | 'out_of_stock'
    | 'low_stock'
    | 'restock';
  // Stock-alert payload: surfaced by the StockNotificationCard so admins can
  // jump straight to the product page or its admin edit form from the bell tray.
  product_id?: string;
  sku?: string;
  name?: string;
  name_ar?: string;
  image_url?: string;
  price?: number;
  fitment_indicator?: string | null;
  stock?: number;
  threshold?: number;
  // Server-enriched product context (added in stockNotifBase). These let
  // the StockNotificationCard render the unified product-card layout
  // (brand badge + compatible-models row) without an extra DB query.
  product_brand_name?: string | null;
  compatible_car_models?: Array<{ id?: string; name?: string; name_ar?: string }>;
  appointment_id?: string;
  appointment_date?: string;
  service_type?: string;
  car_info?: string;
  order_id?: string;
  order_number?: string;
  new_status?: string;
  customer_name?: string;
  customer_email?: string;
  customer_phone?: string;
  customer_avatar?: string;
  admin_name?: string;
  target_id?: string;
  image?: string;
  discount_percentage?: number;
  title?: string;
  target_product_id?: string;
  target_car_model_id?: string;
  product_count?: number;
  product_name?: string;
  car_model_name?: string;
  car_model_image?: string;
  car_model_id?: string;
  target_user_id?: string;
  target_tab?: string;
  conversation_id?: string;
  car_model_year_start?: number;
  car_model_year_end?: number;
}

export interface Notification {
  id: string;
  user_id?: string;
  title: string;
  title_ar?: string;
  message: string;
  message_ar?: string;
  type: 'info' | 'success' | 'warning' | 'error';
  read: boolean;
  created_at: string;
  metadata?: NotificationMetadata;
}

// Local Comment interface for offline-first comments
export interface LocalComment {
  id: string;
  product_id: string;
  user_id: string;
  user_name: string;
  user_picture?: string;
  text: string;
  rating?: number;
  created_at: string;
  is_owner: boolean;
}

// Color Moods for theming - Neon Night is the default
export interface ColorMood {
  id: string;
  name: string;
  primary: string;
  secondary: string;
  background: string;
  surface: string;
  text: string;
  textSecondary: string;
  accent: string;
  gradient: string[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Luxury Dining 2026 — Color Moods
//
// Re-themed for the restaurant identity but keeping the legacy mood IDs
// (`neon_night`, `arctic_dawn`, `desert_sunset`, `forest_calm`,
// `ocean_breeze`) and `NEON_NIGHT_THEME` export name so persisted user
// preferences and any imports across the codebase keep resolving. Each
// mood now expresses a dining ambience:
//
//   neon_night    → Midnight Bistro   (default, charcoal + champagne gold)
//   arctic_dawn   → Champagne Brunch  (ivory + soft gold)
//   desert_sunset → Spice Souk        (terracotta + amber)
//   forest_calm   → Garden Pavilion   (sage + olive)
//   ocean_breeze  → Coastal Dusk      (deep teal + rose-gold)
// ─────────────────────────────────────────────────────────────────────────────
export const NEON_NIGHT_THEME: ColorMood = {
  id: 'neon_night',
  name: 'Midnight Bistro',
  primary: '#D4B062',        // champagne gold
  secondary: '#C8A24A',      // warm gold
  background: '#0B0B0E',     // charcoal
  surface: '#15151A',        // smoke
  text: '#F5EFE6',           // parchment
  textSecondary: '#B5A98F',  // bronze
  accent: '#A23142',         // burgundy
  gradient: ['#0B0B0E', '#1C1C22', '#2A2218'],
};

export const COLOR_MOODS: ColorMood[] = [
  NEON_NIGHT_THEME, // Midnight Bistro — default
  {
    id: 'arctic_dawn',
    name: 'Champagne Brunch',
    primary: '#C8A24A',
    secondary: '#E8D29A',
    background: '#F7F2E9',
    surface: '#FFFFFF',
    text: '#1B1B1F',
    textSecondary: '#6E6353',
    accent: '#A98432',
    gradient: ['#FBF6EC', '#EFE6D6', '#E2D6BD'],
  },
  {
    id: 'desert_sunset',
    name: 'Spice Souk',
    primary: '#C0392B',
    secondary: '#E0A04A',
    background: '#FCF1E4',
    surface: '#FFFFFF',
    text: '#5B1F12',
    textSecondary: '#8B4A2A',
    accent: '#7A1F2B',
    gradient: ['#FDE8D2', '#F5C896', '#E0A04A'],
  },
  {
    id: 'forest_calm',
    name: 'Garden Pavilion',
    primary: '#4A5D3A',
    secondary: '#7A9168',
    background: '#F2F1E5',
    surface: '#FFFFFF',
    text: '#1F2A18',
    textSecondary: '#4A5D3A',
    accent: '#C8A24A',
    gradient: ['#E8EAD6', '#C9D2B0', '#A1B286'],
  },
  {
    id: 'ocean_breeze',
    name: 'Coastal Dusk',
    primary: '#1F4E5A',
    secondary: '#3D7986',
    background: '#EFF4F4',
    surface: '#FFFFFF',
    text: '#0F2A33',
    textSecondary: '#3D7986',
    accent: '#D4A88C',
    gradient: ['#DCE8EB', '#A9C5CC', '#7AA0A9'],
  },
];

export interface AppStoreState {
  // Auth State
  user: User | null;
  sessionToken: string | null;
  isAuthenticated: boolean;
  userRole: UserRole;
  _hasHydrated: boolean;
  
  // UI State
  theme: 'light' | 'dark';
  language: 'en' | 'ar';
  isRTL: boolean;
  currentMood: ColorMood;
  receiptLanguage: 'ar' | 'en' | null;

  // Admin UI persistent filter state (non-persisted — reset on app restart)
  adminRatingsRestaurantFilter: string | null;
  adminRatingsStarFilter: number | null;
  adminPreviewLang: 'ar' | 'en' | null;
  
  // Sync State
  syncStatus: SyncStatus;
  lastSyncTime: number | null;
  isOnline: boolean;
  syncError: string | null;
  
  // Local Cart
  cartItems: CartItemData[];
  
  // Notifications
  notifications: Notification[];
  unreadCount: number;
  
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
  orders: Order[];
  
  // Local Comments Storage (offline-first)
  localComments: LocalComment[];
  
  // Subscription Status (for current user)
  subscriptionStatus: 'none' | 'pending' | 'approved' | 'subscriber';

  // Pending rating prompts — order IDs awaiting a post-delivery rating
  pendingRatingOrderIds: string[];
  // Order IDs that have been rated — prevents re-prompting across sessions
  ratedOrderIds: string[];
  
  // Analytics dashboard layout
  dashboardLayout: any[];

  // Per-user timestamps of when each owner last opened the notification-log screen.
  // Keyed by user.id so multiple accounts on the same device stay isolated.
  // Used to compute the unread badge count on the Alert History tile.
  lastViewedPushLogAtByUser: Record<string, string>;

  // Cached restaurant opening hours — keyed by restaurant id.
  // Persisted to AsyncStorage so the open/closed badge loads instantly on repeat visits.
  // The bulk fetch in useRestaurantHoursMap runs in the background to refresh stale data.
  restaurantHoursMap: Record<string, DayHours[]>;
  // Unix ms timestamp of the last successful bulk hours fetch. Used by
  // useHoursBackgroundRefresh to decide when the cache is stale enough to warrant
  // a silent re-fetch on app foreground.
  restaurantHoursMapFetchedAt: number | null;

  // Actions
  setUser: (user: User | null, token?: string | null) => void;
  setSessionToken: (token: string | null) => void;
  setUserRole: (role: UserRole) => void;
  setHasHydrated: (hydrated: boolean) => void;
  logout: () => void;
  validateSession: () => Promise<boolean>; // التحقق من صلاحية الجلسة
  checkSubscriptionStatus: (email?: string, phone?: string) => Promise<void>;
  setSubscriptionStatus: (status: 'none' | 'pending' | 'approved' | 'subscriber') => void;
  setTheme: (theme: 'light' | 'dark') => void;
  toggleTheme: () => void;
  setLanguage: (language: 'en' | 'ar') => void;
  setColorMood: (mood: ColorMood) => void;
  setReceiptLanguage: (lang: 'ar' | 'en' | null) => void;
  setAdminRatingsFilter: (restaurantId: string | null, star: number | null) => void;
  setAdminPreviewLang: (lang: 'ar' | 'en' | null) => void;
  setLastViewedPushLogAt: (userId: string, timestamp: string) => void;
  setOnline: (isOnline: boolean) => void;
  setSyncStatus: (status: SyncStatus) => void;
  setSyncError: (error: string | null) => void;
  setLastSyncTime: (time: number | null) => void;
  
  // Cart Actions
  addToCart: (item: CartItemData | string, quantity?: number) => void;
  addToLocalCart: (item: { product_id: string; quantity: number; product?: any; fitment_indicator?: string | null }) => void;
  updateCartItem: (productId: string, quantity: number) => void;
  removeFromCart: (productId: string, voidBundle?: boolean) => void;
  clearCart: () => void;
  clearLocalCart: () => void;
  setCartItems: (items: any[]) => void;
  getCartTotal: () => number;
  voidBundleDiscount: (bundleGroupId: string) => void;
  
  // Notification Actions
  addNotification: (notification: Notification) => void;
  setNotifications: (notifications: Notification[]) => void;
  markNotificationRead: (id: string) => void;
  markAllNotificationsRead: () => void;
  clearNotifications: () => void;
  
  // Data Actions (for offline-first cache)
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
  
  // Dashboard Actions
  setDashboardLayout: (layout: any[]) => void;

  // Restaurant hours cache
  setRestaurantHoursMap: (map: Record<string, DayHours[]>) => void;
  pruneRestaurantHoursMap: (allowedIds: string[]) => void;
  
  // Comment Actions (offline-first)
  addLocalComment: (comment: LocalComment) => void;
  deleteLocalComment: (commentId: string) => void;
  getProductComments: (productId: string) => LocalComment[];

  // Rating Actions
  addPendingRating: (orderId: string) => void;
  removePendingRating: (orderId: string, markAsRated?: boolean) => void;
}

type AppStateCreator = StateCreator<
  AppStoreState,
  [['zustand/persist', unknown]],
  [],
  AppStoreState
>;

const createAppStore: AppStateCreator = (set, get) => ({
      // Initial State
      user: null,
      sessionToken: null,
      isAuthenticated: false,
      userRole: 'guest',
      _hasHydrated: false,
      theme: 'dark', // Default to dark for Neon Night
      language: 'ar',
      isRTL: true,
      currentMood: NEON_NIGHT_THEME, // Neon Night is the default theme
      syncStatus: 'idle',
      lastSyncTime: null,
      isOnline: true,
      syncError: null,
      cartItems: [],
      notifications: [],
      unreadCount: 0,
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
      localComments: [],
      dashboardLayout: [],
      restaurantHoursMap: {},
      restaurantHoursMapFetchedAt: null,
      subscriptionStatus: 'none',
      pendingRatingOrderIds: [],
      ratedOrderIds: [],
      receiptLanguage: null,
      adminRatingsRestaurantFilter: null,
      adminRatingsStarFilter: null,
      adminPreviewLang: null,
      lastViewedPushLogAtByUser: {},

      // Auth Actions
      setUser: (user, token = null) => {
        const newToken = token || get().sessionToken;
        // إرسال الـ token للـ API interceptor
        setApiAuthToken(newToken);
        set({
          user,
          sessionToken: newToken,
          isAuthenticated: !!user,
          userRole: user?.role || 'user',
        });
      },

      setSessionToken: (token) => {
        // إرسال الـ token للـ API interceptor
        setApiAuthToken(token);
        set({ sessionToken: token });
      },

      setUserRole: (role) => set({ userRole: role }),

      setHasHydrated: (hydrated) => set({ _hasHydrated: hydrated }),

      logout: () => {
        // إزالة الـ token من الـ API interceptor
        setApiAuthToken(null);
        set({
          user: null,
          sessionToken: null,
          isAuthenticated: false,
          userRole: 'guest',
          cartItems: [],
          notifications: [],
          unreadCount: 0,
        });
      },

      // التحقق من صلاحية الجلسة عند بدء التطبيق
      validateSession: async () => {
        const state = get();
        if (!state.sessionToken) {
          return false;
        }

        _sessionValidating = true;
        // Extend the grace period to cover the full validation window
        _hydrationGraceUntil = Math.max(_hydrationGraceUntil, Date.now() + 10000);

        try {
          const result = await authApi.validateToken();
          
          if (result.valid === false) {
            // Only logout when server explicitly says the session is invalid (401/403)
            get().logout();
            return false;
          }
          
          if (result.valid && result.user) {
            // Session valid and user data refreshed
            set({
              user: result.user,
              isAuthenticated: true,
              userRole: result.user.role || 'user',
            });
            // Sync language from server so returning users immediately see
            // the language they selected in a previous session.
            // Uses setLanguage() to go through the shared action abstraction.
            const serverLang: 'en' | 'ar' | undefined = result.user.preferred_language;
            if (serverLang && serverLang !== get().language) {
              get().setLanguage(serverLang);
            }
            // Refresh subscription status in background after session validated
            const { checkSubscriptionStatus } = get();
            checkSubscriptionStatus(result.user.email, result.user.phone).catch(() => {});
            return true;
          }
          
          // Network error or other non-auth error: keep user logged in with persisted state
          return true;
        } catch (error) {
          // On unexpected error, preserve the current session
          return state.isAuthenticated;
        } finally {
          _sessionValidating = false;
          _hydrationGraceUntil = 0;
        }
      },

      // UI Actions
      setTheme: (theme) => set({ theme }),
      toggleTheme: () => set((state) => ({ theme: state.theme === 'dark' ? 'light' : 'dark' })),
      
      setLanguage: (language) => {
        set({
          language,
          isRTL: language === 'ar',
        });
      },

      setColorMood: (mood) => set({ currentMood: mood }),

      setReceiptLanguage: (lang) => set({ receiptLanguage: lang }),

      setAdminRatingsFilter: (restaurantId, star) =>
        set({ adminRatingsRestaurantFilter: restaurantId, adminRatingsStarFilter: star }),

      setAdminPreviewLang: (lang) => set({ adminPreviewLang: lang }),

      setLastViewedPushLogAt: (userId, timestamp) =>
        set((state) => ({
          lastViewedPushLogAtByUser: {
            ...state.lastViewedPushLogAtByUser,
            [userId]: timestamp,
          },
        })),

      setOnline: (isOnline) => set({ isOnline }),
      
      setSyncStatus: (status) => set({ syncStatus: status }),
      
      setSyncError: (error) => set({ syncError: error }),
      
      setLastSyncTime: (time) => set({ lastSyncTime: time }),

      setSubscriptionStatus: (status) => set({ subscriptionStatus: status }),
      
      checkSubscriptionStatus: async (email, phone) => {
        try {
          const { subscriptionRequestApi } = await import('../services/api');
          const response = await subscriptionRequestApi.getStatus(email, phone);
          const data = response.data;
          
          if (data.is_subscriber) {
            // Also sync userRole so role-based guards work even before re-login
            const currentRole = get().userRole;
            const roleNeedsUpdate = !['owner', 'admin', 'partner', 'subscriber'].includes(currentRole);
            set({
              subscriptionStatus: 'subscriber',
              ...(roleNeedsUpdate ? { userRole: 'subscriber' } : {}),
            });
          } else if (data.has_pending) {
            set({ subscriptionStatus: 'pending' });
          } else if (data.status === 'approved') {
            set({ subscriptionStatus: 'approved' });
          } else {
            set({ subscriptionStatus: 'none' });
          }
        } catch (error) {
          console.error('Error checking subscription status:', error);
        }
      },

      // Cart Actions
      addToCart: (item, quantity = 1) => {
        const { cartItems } = get();
        
        // Handle both string (productId) and full CartItemData object
        if (typeof item === 'string') {
          const productId = item;
          const existingIndex = cartItems.findIndex((ci) => ci.productId === productId && !ci.bundleGroupId);
          if (existingIndex >= 0) {
            const updated = [...cartItems];
            updated[existingIndex].quantity += quantity;
            set({ cartItems: updated });
          } else {
            set({ cartItems: [...cartItems, { productId, quantity }] });
          }
        } else {
          // Full CartItemData object (for bundle items)
          const cartItem = item as CartItemData;
          const existingIndex = cartItems.findIndex(
            (ci) => ci.productId === cartItem.productId && ci.bundleGroupId === cartItem.bundleGroupId
          );
          if (existingIndex >= 0) {
            const updated = [...cartItems];
            updated[existingIndex].quantity += cartItem.quantity || 1;
            set({ cartItems: updated });
          } else {
            set({ cartItems: [...cartItems, { ...cartItem, quantity: cartItem.quantity || 1 }] });
          }
        }
      },

      addToLocalCart: (item) => {
        const { cartItems } = get();
        const existingIndex = cartItems.findIndex((ci) => ci.productId === item.product_id && !ci.bundleGroupId);

        if (existingIndex >= 0) {
          const updated = [...cartItems];
          updated[existingIndex].quantity += item.quantity;
          updated[existingIndex].product = item.product;
          set({ cartItems: updated });
        } else {
          set({
            cartItems: [...cartItems, { productId: item.product_id, quantity: item.quantity, product: item.product }],
          });
        }
      },

      updateCartItem: (productId, quantity) => {
        const { cartItems } = get();
        if (quantity <= 0) {
          // Check if it's a bundle item and void the bundle
          const item = cartItems.find((i) => i.productId === productId);
          if (item?.bundleGroupId) {
            get().voidBundleDiscount(item.bundleGroupId);
          }
          set({ cartItems: cartItems.filter((item) => item.productId !== productId) });
        } else {
          set({
            cartItems: cartItems.map((item) =>
              item.productId === productId ? { ...item, quantity } : item
            ),
          });
        }
      },

      removeFromCart: (productId, voidBundle = true) => {
        const { cartItems } = get();
        const itemToRemove = cartItems.find((item) => item.productId === productId);
        
        // If item is part of a bundle and voidBundle is true, void the entire bundle discount
        if (itemToRemove?.bundleGroupId && voidBundle) {
          get().voidBundleDiscount(itemToRemove.bundleGroupId);
        }
        
        set({ cartItems: cartItems.filter((item) => item.productId !== productId) });
      },

      clearCart: () => set({ cartItems: [] }),

      clearLocalCart: () => set({ cartItems: [] }),

      setCartItems: (items) => {
        // Transform server cart items to local format
        const transformedItems = items.map((item: any) => ({
          productId: item.product_id || item.productId,
          product_id: item.product_id || item.productId,
          quantity: item.quantity || 1,
          product: item.product,
          // Server-side pricing fields
          original_unit_price: item.original_unit_price,
          final_unit_price: item.final_unit_price,
          discount_details: item.discount_details,
          // Bundle fields
          bundleGroupId: item.bundle_group_id || item.bundleGroupId,
          bundle_group_id: item.bundle_group_id || item.bundleGroupId,
          bundleOfferId: item.bundle_offer_id || item.bundleOfferId,
          bundleOfferName: item.bundle_offer_name || item.bundleOfferName,
          bundleDiscount: item.bundle_discount || item.bundleDiscount,
          // Legacy fields
          originalPrice: item.original_unit_price || item.originalPrice,
          discountedPrice: item.final_unit_price || item.discountedPrice,
        }));
        set({ cartItems: transformedItems });
      },

      getCartTotal: () => get().cartItems.reduce((total, item) => total + item.quantity, 0),

      // Void bundle discount - removes discount from all items in the bundle
      voidBundleDiscount: (bundleGroupId) => {
        const { cartItems } = get();
        const updatedItems = cartItems.map((item) => {
          if (item.bundleGroupId === bundleGroupId) {
            // Remove bundle info and restore original price
            return {
              ...item,
              bundleGroupId: undefined,
              bundleOfferId: undefined,
              bundleOfferName: undefined,
              bundleDiscount: undefined,
              discountedPrice: undefined,
              // Keep originalPrice as the actual price now
            };
          }
          return item;
        });
        set({ cartItems: updatedItems });
      },

      // Notification Actions
      addNotification: (notification) => {
        const { notifications } = get();
        set({
          notifications: [notification, ...notifications].slice(0, 100),
          unreadCount: get().unreadCount + 1,
        });
      },

      markNotificationRead: (id) => {
        const { notifications } = get();
        const updated = notifications.map((n) =>
          n.id === id ? { ...n, read: true } : n
        );
        const unreadCount = updated.filter((n) => !n.read).length;
        set({ notifications: updated, unreadCount });
      },

      markAllNotificationsRead: () => {
        const { notifications } = get();
        set({
          notifications: notifications.map((n) => ({ ...n, read: true })),
          unreadCount: 0,
        });
      },

      setNotifications: (notifications) => {
        const unreadCount = notifications.filter((n) => !n.read).length;
        set({ notifications, unreadCount });
      },

      clearNotifications: () => set({ notifications: [], unreadCount: 0 }),

      // Data Actions
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

      // Dashboard Actions
      setDashboardLayout: (layout) => set({ dashboardLayout: layout }),

      // Restaurant hours cache — merge incoming entries so callers can write partial updates.
      // Stamp restaurantHoursMapFetchedAt so background-refresh logic knows when data last arrived.
      setRestaurantHoursMap: (map) =>
        set((state) => ({
          restaurantHoursMap: { ...state.restaurantHoursMap, ...map },
          restaurantHoursMapFetchedAt: Date.now(),
        })),

      // Remove stale entries from the hours cache that are no longer in the
      // current set of known restaurant IDs.  Call this after loading a fresh
      // restaurant list to keep the persisted JSON blob from growing without bound.
      pruneRestaurantHoursMap: (allowedIds) =>
        set((state) => {
          const allowed = new Set(allowedIds);
          const existing = Object.keys(state.restaurantHoursMap);
          // Skip the state update entirely when nothing would be removed,
          // avoiding an unnecessary AsyncStorage write on every model refresh.
          const hasStale = existing.some((id) => !allowed.has(id));
          if (!hasStale) return {};
          const pruned: Record<string, DayHours[]> = {};
          for (const id of existing) {
            if (allowed.has(id)) {
              pruned[id] = state.restaurantHoursMap[id];
            }
          }
          return { restaurantHoursMap: pruned };
        }),
      
      // Comment Actions (offline-first)
      addLocalComment: (comment) => {
        const { localComments } = get();
        set({ localComments: [comment, ...localComments] });
      },
      
      deleteLocalComment: (commentId) => {
        const { localComments } = get();
        set({ localComments: localComments.filter((c) => c.id !== commentId) });
      },
      
      getProductComments: (productId) => {
        const { localComments } = get();
        return localComments.filter((c) => c.product_id === productId);
      },

      addPendingRating: (orderId) => {
        const { pendingRatingOrderIds, ratedOrderIds } = get();
        if (!pendingRatingOrderIds.includes(orderId) && !ratedOrderIds.includes(orderId)) {
          set({ pendingRatingOrderIds: [...pendingRatingOrderIds, orderId] });
        }
      },

      removePendingRating: (orderId, markAsRated = false) => {
        const { pendingRatingOrderIds, ratedOrderIds } = get();
        const filtered = pendingRatingOrderIds.filter((id) => id !== orderId);
        if (markAsRated && !ratedOrderIds.includes(orderId)) {
          set({ pendingRatingOrderIds: filtered, ratedOrderIds: [...ratedOrderIds, orderId] });
        } else {
          set({ pendingRatingOrderIds: filtered });
        }
      },
});

export const useAppStore = create<AppStoreState>()(
  persist(
    createAppStore,
    {
      name: 'alghazaly-app-storage-v3',
      storage: createJSONStorage(() => createWebSafeStorage()),
      // Bump version when the persisted shape changes. v4 introduces a one-shot
      // sanitization that strips legacy domain arrays (products, brands, etc.)
      // out of any older persisted payload — see partialize comment below.
      version: 4,
      migrate: (persistedState: any, fromVersion: number) => {
        if (!persistedState || typeof persistedState !== 'object') return persistedState;
        if (fromVersion < 4) {
          // Drop dynamic domain arrays so we never rehydrate stale snapshots.
          // The screens that need this data refetch from the API on mount.
          delete persistedState.products;
          delete persistedState.carBrands;
          delete persistedState.carModels;
          delete persistedState.productBrands;
          delete persistedState.categories;
          delete persistedState.suppliers;
          delete persistedState.distributors;
        }
        return persistedState;
      },
      // Defensive merge: even if a future caller writes domain arrays back into
      // storage, this merge function forces them empty on rehydration. The API
      // refetch will then populate them with fresh data on screen mount.
      merge: (persistedState: any, currentState: any) => {
        const merged = { ...currentState, ...(persistedState ?? {}) };
        merged.products = [];
        merged.carBrands = [];
        merged.carModels = [];
        merged.productBrands = [];
        merged.categories = [];
        merged.suppliers = [];
        merged.distributors = [];
        return merged;
      },
      // Persist ONLY non-volatile state (auth, preferences, local UI state).
      // Domain data — products, brands, categories, car models, suppliers,
      // distributors — is intentionally excluded so each screen always reads
      // a fresh copy from the API on mount. Persisting this data caused
      // stale snapshots after schema changes (e.g. fitment-variant rows
      // disappearing on /owner/collection reloads when an older snapshot
      // was rehydrated before the API refresh completed).
      partialize: (state) => ({
        user: state.user,
        sessionToken: state.sessionToken,
        isAuthenticated: state.isAuthenticated,
        userRole: state.userRole,
        subscriptionStatus: state.subscriptionStatus,
        theme: state.theme,
        language: state.language,
        isRTL: state.isRTL,
        currentMood: state.currentMood,
        lastSyncTime: state.lastSyncTime,
        cartItems: state.cartItems,
        notifications: state.notifications,
        unreadCount: state.unreadCount,
        dashboardLayout: state.dashboardLayout,
        localComments: state.localComments,
        ratedOrderIds: state.ratedOrderIds,
        receiptLanguage: state.receiptLanguage,
        adminPreviewLang: state.adminPreviewLang,
        adminRatingsRestaurantFilter: state.adminRatingsRestaurantFilter,
        adminRatingsStarFilter: state.adminRatingsStarFilter,
        lastViewedPushLogAtByUser: state.lastViewedPushLogAtByUser,
        restaurantHoursMap: state.restaurantHoursMap,
        restaurantHoursMapFetchedAt: state.restaurantHoursMapFetchedAt,
      }),
      onRehydrateStorage: () => (state, error) => {
        // Called when hydration is finished (or failed)
        if (error) {
          console.log('Hydration error:', error);
        }
        // Always mark hydration complete — even when storage is empty (state = null on first visit)
        if (!state) {
          useAppStore.setState({ _hasHydrated: true });
          return;
        }
        if (state) {
          state.setHasHydrated(true);

          // Fix stale userRole: if subscriptionStatus is 'subscriber' but userRole
          // is an unprivileged role (e.g. 'user'), upgrade it immediately from storage
          const privilegedRoles = ['owner', 'admin', 'partner', 'subscriber'];
          if (
            state.subscriptionStatus === 'subscriber' &&
            !privilegedRoles.includes(state.userRole)
          ) {
            useAppStore.setState({ userRole: 'subscriber' });
          }

          // تهيئة الـ API token من الـ session المحفوظ
          // نعتمد على الحالة المحفوظة دون التحقق الفوري
          // (لو انتهت صلاحية الـ session فسيظهر خطأ 401 عند أول طلب)
          if (state.sessionToken) {
            setApiAuthToken(state.sessionToken);
            // Grant a 12-second window so validateSession can run before any
            // stray 401 response from an eager API call forces a premature logout.
            _hydrationGraceUntil = Date.now() + 12000;
            console.log('Session token restored from storage');
          }
        }
      },
    }
  )
);

// Selectors
export const useUser = () => useAppStore((state) => state.user);
export const useIsAuthenticated = () => useAppStore((state) => state.isAuthenticated);
export const useUserRole = () => useAppStore((state) => state.userRole);
export const useHasHydrated = () => useAppStore((state) => state._hasHydrated);
export const useTheme = () => useAppStore((state) => state.theme);
export const useLanguage = () => useAppStore((state) => state.language);
export const useIsRTL = () => useAppStore((state) => state.isRTL);
export const useColorMood = () => useAppStore((state) => state.currentMood);
export const useSyncStatus = () => useAppStore((state) => state.syncStatus);
export const useIsOnline = () => useAppStore((state) => state.isOnline);
export const useCartItems = () => useAppStore((state) => state.cartItems);
export const useCartTotal = () => useAppStore((state) => state.getCartTotal());
export const useNotifications = () => useAppStore((state) => state.notifications);
export const useUnreadCount = () => useAppStore((state) => state.unreadCount);

// Data selectors
export const useCarBrands = () => useAppStore((state) => state.carBrands);
export const useCarModels = () => useAppStore((state) => state.carModels);
export const useProductBrands = () => useAppStore((state) => state.productBrands);
export const useCategories = () => useAppStore((state) => state.categories);
export const useProducts = () => useAppStore((state) => state.products);
export const useOrders = () => useAppStore((state) => state.orders);

// Check if user can access owner interface
export const useCanAccessOwnerInterface = () => {
  const userRole = useAppStore((state) => state.userRole);
  return userRole === 'owner' || userRole === 'partner';
};

// Check if user can access admin panel - includes all admin roles
export const useCanAccessAdminPanel = () => {
  const userRole = useAppStore((state) => state.userRole);
  const user = useAppStore((state) => state.user);
  const isAdmin = ['owner', 'partner', 'admin'].includes(userRole);
  // Also check is_admin flag for backwards compatibility
  return isAdmin || user?.is_admin === true;
};

// Check if user is specifically an admin (not owner/partner)
export const useIsAdmin = () => {
  const userRole = useAppStore((state) => state.userRole);
  return userRole === 'admin';
};

// Check if user is the owner only
export const useIsOwner = () => {
  const userRole = useAppStore((state) => state.userRole);
  return userRole === 'owner';
};

// Check if user is owner or partner
export const useIsOwnerOrPartner = () => {
  const userRole = useAppStore((state) => state.userRole);
  return userRole === 'owner' || userRole === 'partner';
};

// Register session expiry handler — when a 401 occurs with a valid session token,
// clear the auth state so the user is prompted to log in again.
// Guards:
//  1. _sessionValidating — skip logout while validateSession() is running
//  2. _hydrationGraceUntil — skip logout during the 12-second window after
//     hydration, preventing a race where eager React Query requests return 401
//     before validateSession has had a chance to confirm the stored token.
registerSessionExpiredCallback(() => {
  if (_sessionValidating) {
    console.log('[Auth] 401 received during session validation — ignoring');
    return;
  }
  if (_hydrationGraceUntil > 0 && Date.now() < _hydrationGraceUntil) {
    console.log('[Auth] 401 received within hydration grace period — ignoring');
    return;
  }
  const { isAuthenticated, logout } = useAppStore.getState();
  if (isAuthenticated) {
    console.log('[Auth] Session expired — clearing auth state');
    logout();
  }
});

export default useAppStore;
