/**
 * API Service for Al-Ghazaly Auto Parts
 * Handles all API calls with axios
 * Updated for Replit environment - Email/Password Auth
 */
import axios from 'axios';
import { Platform } from 'react-native';
import { setBaseUrl, setAuthTokenGetter } from '@workspace/api-client-react';

// Get API URL from environment or use default
const getApiBaseUrl = (): string => {
  // Use EXPO_PUBLIC_DOMAIN for Replit environment
  const domain = process.env.EXPO_PUBLIC_DOMAIN;
  if (domain) {
    return `https://${domain}/api`;
  }
  
  // Fallback for web (same origin)
  if (Platform.OS === 'web') {
    return '/api';
  }
  
  // Fallback for development
  return '/api';
};

const API_BASE_URL = getApiBaseUrl();

export const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
  timeout: 30000,
  withCredentials: true,
});

// Wire the generated API client (customFetch) to use the same base URL and
// bearer token as the Axios instance, so generated hooks work out of the box.
setBaseUrl(API_BASE_URL);

// Token storage for authorization header
let authToken: string | null = null;

// Keep the generated client's auth token in sync with the module-level var.
setAuthTokenGetter(() => authToken);

// Callback registered by the auth store to handle session expiry
let onSessionExpiredCallback: (() => void) | null = null;

export const registerSessionExpiredCallback = (cb: () => void) => {
  onSessionExpiredCallback = cb;
};

// Function to set auth token (called from auth store)
export const setApiAuthToken = (token: string | null) => {
  authToken = token;
};

// Request interceptor to add authorization header
api.interceptors.request.use(
  (config) => {
    let token = authToken;

    // Fallback: if authToken not yet set (e.g. race condition on first load),
    // read directly from localStorage so requests still carry the Bearer token
    if (!token && Platform.OS === 'web' && typeof window !== 'undefined') {
      try {
        const stored = localStorage.getItem('alghazaly-app-storage-v3');
        if (stored) {
          const parsed = JSON.parse(stored);
          const t = parsed?.state?.sessionToken;
          if (t) {
            authToken = t; // cache it for future requests
            token = t;
          }
        }
      } catch {
        // ignore
      }
    }

    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// Response interceptor for error handling
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      console.log('API: Unauthorized request - user may need to login');
      // If we had a session token but got 401, the session has expired
      // Notify the auth store to clear the session
      if (authToken && onSessionExpiredCallback) {
        onSessionExpiredCallback();
      }
    } else if (error.response?.status === 403) {
      console.log('API: Access denied - insufficient permissions');
    }
    return Promise.reject(error);
  }
);

// Auth APIs - Email/Password based
export const authApi = {
  // Email/Password login (NEW - Replit compatible)
  login: (email: string, password: string) => 
    api.post('/auth/login', { email, password }),
  
  // Email/Password registration (NEW - Replit compatible)
  register: (email: string, password: string, name: string) => 
    api.post('/auth/register', { email, password, name }),
  
  // Legacy - kept for compatibility
  exchangeSession: (sessionId: string) => 
    api.post('/auth/session', { session_id: sessionId }),
  
  getMe: () => api.get('/auth/me'),
  updateLanguagePreference: (language: 'en' | 'ar') =>
    api.patch('/auth/me/language', { preferred_language: language }),
  logout: () => api.post('/auth/logout'),
  
  validateToken: async (): Promise<{ valid: boolean; user?: any }> => {
    try {
      const response = await api.get('/auth/me');
      return { valid: true, user: response.data };
    } catch (error: any) {
      if (error.response?.status === 401 || error.response?.status === 403) {
        return { valid: false };
      }
      return { valid: true };
    }
  },
};

// Car Brand APIs
export const carBrandApi = {
  getAll: () => api.get('/car-brands'),
  create: (data: any) => api.post('/car-brands', data),
  update: (id: string, data: any) => api.put(`/car-brands/${id}`, data),
  delete: (id: string) => api.delete(`/car-brands/${id}`),
};

// Car Model APIs
export const carModelApi = {
  getAll: (brandId?: string, openNow?: boolean) =>
    api.get('/car-models', { params: { brand_id: brandId, ...(openNow ? { open_now: 'true' } : {}) } }),
  getById: (id: string) => api.get(`/car-models/${id}`),
  create: (data: any) => api.post('/car-models', data),
  update: (id: string, data: any) => api.put(`/car-models/${id}`, data),
  delete: (id: string) => api.delete(`/car-models/${id}`),
};

// Product Brand APIs
export const productBrandApi = {
  getAll: () => api.get('/product-brands'),
  create: (data: any) => api.post('/product-brands', data),
  update: (id: string, data: any) => api.put(`/product-brands/${id}`, data),
  delete: (id: string) => api.delete(`/product-brands/${id}`),
};

// Category APIs
export const categoryApi = {
  getAll: () => api.get('/categories/all'),
  getTree: () => api.get('/categories/tree'),
  create: (data: any) => api.post('/categories', data),
  update: (id: string, data: any) => api.put(`/categories/${id}`, data),
  delete: (id: string) => api.delete(`/categories/${id}`),
};

// Product APIs
export const productApi = {
  getAll: (params?: any) => api.get('/products', { params }),
  getAllAdmin: (params?: Record<string, any>) => api.get('/products/all', { params }),
  getById: (id: string) => api.get(`/products/${id}`),
  search: (
    q: string,
    extra?: { is_tire?: boolean; product_type?: string; fitment?: string; open_now?: string },
  ) => api.get('/products/search', { params: { q, ...(extra || {}) } }),
  create: (data: any) => api.post('/products', data),
  update: (id: string, data: any) => api.put(`/products/${id}`, data),
  updatePrice: (id: string, price: number) => api.patch(`/products/${id}/price`, { price }),
  bulkUpdateVariants: (
    updates: Array<{ id: string; price: number; stock_quantity: number }>,
  ) => api.patch('/products/bulk-variants', { updates }),
  updateHidden: (id: string, hidden: boolean) => api.patch(`/products/${id}/hidden`, { hidden_status: hidden }),
  updateStock: (id: string, stock_quantity: number) => api.patch(`/products/${id}/stock`, { stock_quantity }),
  getStockHistory: (id: string, opts?: { limit?: number; since?: string }) => {
    const params = new URLSearchParams();
    if (opts?.limit) params.set('limit', String(opts.limit));
    if (opts?.since) params.set('since', opts.since);
    const qs = params.toString();
    return api.get(`/products/${id}/stock-history${qs ? `?${qs}` : ''}`);
  },
  delete: (id: string) => api.delete(`/products/${id}`),
};

// Cart APIs
export const cartApi = {
  get: () => api.get('/cart'),
  add: (productId: string, quantity: number = 1, options?: {
    bundle_group_id?: string;
    bundle_offer_id?: string;
    bundle_discount_percentage?: number;
  }) => api.post('/cart/add', { product_id: productId, quantity, ...options }),
  addItem: (productId: string, quantity: number, fitmentIndicator?: string | null) =>
    api.post('/cart/add', { product_id: productId, quantity, fitment_indicator: fitmentIndicator || null }),
  addEnhanced: (item: {
    product_id: string;
    quantity: number;
    original_unit_price?: number;
    final_unit_price?: number;
    discount_details?: any;
    bundle_group_id?: string;
    added_by_admin_id?: string;
  }) => api.post('/cart/add-enhanced', item),
  update: (productId: string, quantity: number, fitmentIndicator?: string | null) =>
    api.put('/cart/update', {
      product_id: productId,
      quantity,
      fitment_indicator: fitmentIndicator ?? null,
    }),
  updateItem: (productId: string, quantity: number) => api.put('/cart/update', { product_id: productId, quantity }),
  remove: (productId: string, fitmentIndicator?: string | null) =>
    api.delete(`/cart/remove/${productId}`, {
      data: { fitment_indicator: fitmentIndicator ?? null },
    }),
  voidBundle: (bundleGroupId: string) => api.delete(`/cart/void-bundle/${bundleGroupId}`),
  clear: () => api.delete('/cart/clear'),
  validateStock: () => api.post('/cart/validate-stock'),
};

// Order APIs
export const orderApi = {
  getAll: () => api.get('/orders'),
  getAllAdmin: () => api.get('/orders/admin'),
  create: (data: any) => api.post('/orders', data),
  createAdminAssisted: (data: {
    customer_id: string;
    items: Array<{
      product_id: string;
      quantity: number;
      original_unit_price?: number;
      final_unit_price?: number;
      discount_details?: any;
      bundle_group_id?: string;
    }>;
    shipping_address: string;
    phone: string;
    notes?: string;
  }) => api.post('/orders/admin-assisted', data),
  updateStatus: (id: string, status: string) => api.patch(`/orders/${id}/status`, null, { params: { status } }),
  updateDiscount: (id: string, discount: number) => api.patch(`/orders/${id}/discount`, { discount }),
  delete: (id: string) => api.delete(`/orders/${id}`),
  getPendingCount: (userId: string) => api.get(`/orders/pending-count/${userId}`),
  getById: (id: string) => api.get(`/orders/admin/${id}`),
};

export const ordersApi = orderApi;

// User Saved Addresses (home / work / club) — used by /checkout and /profile.
// Each user can save up to 3 addresses, one per label.
export type UserAddressLabel = 'home' | 'work' | 'club';
export interface UserAddress {
  id: string;
  label: UserAddressLabel;
  address: string | null;
  governorate: string | null;
  city: string | null;
  latitude: string | number | null;
  longitude: string | number | null;
  phone: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}
export const userAddressApi = {
  list: () => api.get<{ addresses: UserAddress[] }>('/user-addresses'),
  upsert: (
    label: UserAddressLabel,
    body: Partial<Omit<UserAddress, 'id' | 'label' | 'created_at' | 'updated_at'>>,
  ) => api.put<{ address: UserAddress }>(`/user-addresses/${label}`, body),
  remove: (label: UserAddressLabel) =>
    api.delete<{ ok: true }>(`/user-addresses/${label}`),
};

// Customer APIs
export const customerApi = {
  getAll: (sortBy?: string) => api.get('/customers', { params: { sort_by: sortBy } }),
  getById: (id: string) => api.get(`/customers/${id}`),
  delete: (id: string) => api.delete(`/customers/${id}`),
  getFavorites: (userId: string) => api.get(`/customers/admin/customer/${userId}/favorites`),
  getCart: (userId: string) => api.get(`/customers/admin/customer/${userId}/cart`),
  getOrders: (userId: string) => api.get(`/customers/admin/customer/${userId}/orders`),
  markOrdersViewed: (userId: string) => api.patch(`/customers/admin/customer/${userId}/orders/mark-viewed`),
};

export const customersApi = customerApi;

// Favorite APIs
export const favoriteApi = {
  getAll: () => api.get('/favorites'),
  add: (productId: string) => api.post('/favorites', { product_id: productId }),
  remove: (productId: string) => api.delete(`/favorites/${productId}`),
  check: (productId: string) => api.get(`/favorites/check/${productId}`),
  toggle: (productId: string) => api.post('/favorites/toggle', { product_id: productId }),
};

export const favoritesApi = favoriteApi;

// Comment APIs
export const commentApi = {
  getForProduct: (productId: string) => api.get(`/comments/${productId}`),
  create: (productId: string, text: string, rating?: number) =>
    api.post('/comments', { product_id: productId, text, rating }),
  delete: (commentId: string) => api.delete(`/comments/${commentId}`),
};

export const commentsApi = {
  getProductComments: (productId: string) => api.get(`/comments/${productId}`),
  addComment: (productId: string, text: string, rating?: number) =>
    api.post('/comments', { product_id: productId, text, rating }),
  deleteComment: (commentId: string) => api.delete(`/comments/${commentId}`),
};

// Partner APIs
export const partnerApi = {
  getAll: () => api.get('/partners'),
  create: (data: any) => api.post('/partners', data),
  update: (id: string, data: any) => api.put(`/partners/${id}`, data),
  delete: (id: string) => api.delete(`/partners/${id}`),
};

// Admin APIs
export const adminApi = {
  getAll: () => api.get('/admins'),
  getById: (id: string) => api.get(`/admins/${id}`),
  checkAccess: () => api.get('/admins/check-access'),
  create: (email: string, name?: string) => api.post('/admins', { email, name }),
  update: (id: string, data: { email: string; name?: string }) => api.put(`/admins/${id}`, data),
  delete: (id: string) => api.delete(`/admins/${id}`),
  getProducts: (adminId: string) => api.get(`/admins/${adminId}/products`),
  settleRevenue: (adminId: string, productIds: string[], totalAmount: number) =>
    api.post(`/admins/${adminId}/settle`, { admin_id: adminId, product_ids: productIds, total_amount: totalAmount }),
  clearRevenue: (adminId: string) => api.post(`/admins/${adminId}/clear-revenue`),
  getHousekeepingStats: () => api.get('/admin/housekeeping-stats'),
};

// Supplier APIs
export const supplierApi = {
  getAll: () => api.get('/suppliers'),
  getById: (id: string) => api.get(`/suppliers/${id}`),
  create: (data: any) => api.post('/suppliers', data),
  update: (id: string, data: any) => api.put(`/suppliers/${id}`, data),
  delete: (id: string) => api.delete(`/suppliers/${id}`),
};

// Distributor APIs
export const distributorApi = {
  getAll: () => api.get('/distributors'),
  getById: (id: string) => api.get(`/distributors/${id}`),
  create: (data: any) => api.post('/distributors', data),
  update: (id: string, data: any) => api.put(`/distributors/${id}`, data),
  delete: (id: string) => api.delete(`/distributors/${id}`),
};

// Subscriber APIs
export const subscriberApi = {
  getAll: () => api.get('/subscribers'),
  getById: (id: string) => api.get(`/subscribers/${id}`),
  create: (data: any) => api.post('/subscribers', data),
  update: (id: string, data: any) => api.put(`/subscribers/${id}`, data),
  delete: (id: string) => api.delete(`/subscribers/${id}`),
};

// Subscription Request APIs
export const subscriptionRequestApi = {
  getAll: () => api.get('/subscription-requests'),
  getByEmail: (email: string) => api.get('/subscription-requests', { params: { email } }),
  create: (data: any) => api.post('/subscription-requests', data),
  approve: (id: string) => api.patch(`/subscription-requests/${id}/approve`),
  reject: (id: string) => api.patch(`/subscription-requests/${id}/reject`),
  delete: (id: string) => api.delete(`/subscription-requests/${id}`),
  getStatus: (email?: string, phone?: string) =>
    api.get('/subscription-status', { params: { email, phone } }),
};

// Notification APIs
export const notificationApi = {
  getAll: () => api.get('/notifications'),
  markRead: (id: string) => api.patch(`/notifications/${id}/read`),
  markAllRead: () => api.patch('/notifications/read-all'),
};

// Analytics API
export const analyticsApi = {
  getOverview: (params?: { start_date?: string; end_date?: string }) =>
    api.get('/analytics/overview', { params }),
  getCollections: (params?: { admin_id?: string }) =>
    api.get('/analytics/collections', { params }),
  getCustomers: (params?: { start_date?: string; end_date?: string }) =>
    api.get('/analytics/customers', { params }),
  getProducts: (params?: { start_date?: string; end_date?: string }) =>
    api.get('/analytics/products', { params }),
  getOrders: (params?: { start_date?: string; end_date?: string }) =>
    api.get('/analytics/orders', { params }),
  getRevenue: (params?: { start_date?: string; end_date?: string }) =>
    api.get('/analytics/revenue', { params }),
  getAdminPerformance: (params?: { start_date?: string; end_date?: string }) =>
    api.get('/analytics/admin-performance', { params }),
  getSales: () => api.get('/analytics/sales'),
  // G3: notification delivery analytics (sent / delivered / opened, last 30d)
  getNotifications: () => api.get('/analytics/notifications'),
};

// Collection APIs
export const collectionApi = {
  getAll: (adminId?: string) => api.get('/collections', { params: { admin_id: adminId } }),
};

// Sync APIs
export const syncApi = {
  pull: (lastPulledAt?: number, tables?: string[]) =>
    api.post('/sync/pull', { last_pulled_at: lastPulledAt, tables }),
};

// Marketing APIs
export const promotionApi = {
  getAll: (promotionType?: string, activeOnly: boolean = true) =>
    api.get('/promotions', { params: { promotion_type: promotionType, active_only: activeOnly } }),
  getAllForAdmin: (promotionType?: string) =>
    api.get('/promotions', { params: { promotion_type: promotionType, active_only: false } }),
  getById: (id: string) => api.get(`/promotions/${id}`),
  create: (data: any) => api.post('/promotions', data),
  update: (id: string, data: any) => api.put(`/promotions/${id}`, data),
  reorder: (id: string, sortOrder: number) => api.patch(`/promotions/${id}/reorder`, { sort_order: sortOrder }),
  delete: (id: string) => api.delete(`/promotions/${id}`),
};

export const bundleOfferApi = {
  getAll: (activeOnly: boolean = true) => api.get('/bundle-offers', { params: { active_only: activeOnly } }),
  getAllForAdmin: () => api.get('/bundle-offers', { params: { active_only: false } }),
  getById: (id: string) => api.get(`/bundle-offers/${id}`),
  create: (data: any) => api.post('/bundle-offers', data),
  update: (id: string, data: any) => api.put(`/bundle-offers/${id}`, data),
  delete: (id: string) => api.delete(`/bundle-offers/${id}`),
};

export const bundleRatingApi = {
  getSummary: (bundleId: string) =>
    api.get(`/bundle-offers/${bundleId}/ratings/summary`),
  getMyRating: (bundleId: string) =>
    api.get(`/bundle-offers/${bundleId}/ratings/my`),
  submitRating: (bundleId: string, rating: number, review?: string) =>
    api.post(`/bundle-offers/${bundleId}/ratings`, { rating, review }),
};

export const marketingApi = {
  getHomeSlider: () => api.get('/marketing/home-slider'),
};

// Legacy aliases
export const categoriesApi = {
  getAll: categoryApi.getAll,
  getTree: categoryApi.getTree,
  create: categoryApi.create,
  delete: categoryApi.delete,
};

export const carBrandsApi = carBrandApi;
export const carModelsApi = carModelApi;
export const productBrandsApi = productBrandApi;
export const productsApi = productApi;

// Chat & AI Agent APIs
export const chatApi = {
  getConversations: () => api.get('/chat/conversations'),
  getDeletedConversations: () => api.get('/chat/conversations/deleted'),
  getUnreadCount: () => api.get('/chat/conversations/unread-count'),
  getConversation: (id: string) => api.get(`/chat/conversations/${id}`),
  createConversation: (data: { type?: string; user_id?: string }) =>
    api.post('/chat/conversations', data),
  updateConversationStatus: (id: string, status: string) =>
    api.patch(`/chat/conversations/${id}/status`, { status }),
  restoreConversation: (id: string) =>
    api.patch(`/chat/conversations/${id}/restore`),
  getMessages: (conversationId: string, params?: { limit?: number; offset?: number }) =>
    api.get(`/chat/messages/${conversationId}`, { params }),
  sendMessage: (data: {
    conversation_id: string;
    content?: string;
    message_type?: string;
    file_url?: string;
    latitude?: number;
    longitude?: number;
    address?: string;
  }) => api.post('/chat/messages', data),
  markMessagesRead: (conversationId: string) =>
    api.patch(`/chat/messages/read/${conversationId}`),
  deleteMessage: (id: string) => api.delete(`/chat/messages/${id}`),
  sendAiMessage: (data: { message?: string; conversation_id?: string; file_url?: string; message_type?: string }) =>
    api.post('/chat/ai-agent/message', data),
  getAiAssist: (data: { conversation_id: string; hint?: string; file_url?: string; message_type?: string }) =>
    api.post<{ response: string }>('/chat/ai-agent/assist', data),
  triggerAutoReply: (data: { message_id: string; conversation_id: string }) =>
    api.post<{ sent?: boolean; skipped?: boolean; message?: unknown }>('/chat/auto-reply', data),
  getQuickReplies: () =>
    api.get<{ chips: Array<{ id: string; question: string; answer: string; category: string | null }> }>('/chat/quick-replies'),
  sendQuickReply: (data: { conversation_id: string; qa_id: string }) =>
    api.post('/chat/quick-reply', data),
  getAiSummary: (conversationId: string) =>
    api.get(`/chat/ai-agent/summary/${conversationId}`),
  permanentlyDeleteConversation: (id: string) =>
    api.delete(`/chat/conversations/${id}`),
  toggleAiAutoReply: (id: string, enabled: boolean) =>
    api.patch(`/chat/conversations/${id}/ai-toggle`, { enabled }),
  getChatUploadUrl: () =>
    api.post<{ uploadURL: string; downloadURL: string; objectPath: string }>('/chat/upload-url'),
  uploadFile: (data: { data: string; content_type: string; file_name: string }) =>
    api.post<{ downloadURL: string; file_name: string }>('/chat/upload-file', data),
  transcribeAudio: (data: { audio_base64: string; content_type: string }) =>
    api.post<{ transcript: string }>('/chat/ai-agent/transcribe', data),
  tts: (data: { text: string; voice?: string }) =>
    api.post<{ audio_base64: string; content_type: string }>('/ai/tts', data),
  suggestReplies: (conversation_id: string) =>
    api.post<{ suggestions: string[] }>('/ai/suggest-replies', { conversation_id }),
  // Conversation Groups
  getGroups: () => api.get<{ groups: ConversationGroup[] }>('/chat/groups'),
  createGroup: (data: { name: string; color?: string; conversation_ids?: string[] }) =>
    api.post<{ group: ConversationGroup }>('/chat/groups', data),
  updateGroup: (id: string, data: { name?: string; color?: string; conversation_ids?: string[] }) =>
    api.put<{ group: ConversationGroup }>(`/chat/groups/${id}`, data),
  deleteGroup: (id: string) => api.delete(`/chat/groups/${id}`),
};

export interface ConversationGroup {
  id: string;
  name: string;
  color: string;
  conversation_ids: string[];
  created_at: string;
}

// Knowledge Base APIs (Owner only)
export const knowledgeBaseApi = {
  requestFileUploadUrl: (data: { file_name: string; file_type: string; file_size?: number }) =>
    api.post<{ uploadURL: string; objectPath: string }>('/knowledge-base/file/upload-url', data),
  getAll: (params?: { type?: string; search?: string }) =>
    api.get('/knowledge-base', { params }),
  addText: (data: { title?: string; content: string }) =>
    api.post('/knowledge-base/text', data),
  addFile: (data: {
    title?: string;
    object_path?: string;
    file_url?: string;
    file_name?: string;
    file_type?: string;
    file_size?: number;
    content?: string;
  }) => api.post('/knowledge-base/file', data),
  addLink: (data: { url: string }) => api.post('/knowledge-base/link', data),
  addQA: (data: { question: string; answer: string; category?: string; tags?: string[] }) =>
    api.post('/knowledge-base/qa', data),
  addYoutube: (data: { url: string; duration?: string }) => api.post('/knowledge-base/youtube', data),
  delete: (id: string) => api.delete(`/knowledge-base/${id}`),
};

// ── Restaurant Analytics API (owner / assigned restaurant users) ──────────────
export const restaurantAnalyticsApi = {
  getRestaurants: () =>
    api.get<{ restaurants: any[] }>('/restaurant-analytics/restaurants'),
  getOrders: (restaurantId: string, params?: { page?: number; status?: string }) =>
    api.get<{ orders: any[]; total: number; page: number; limit: number }>(
      `/restaurant-analytics/${restaurantId}/orders`, { params }
    ),
  getAppointments: (restaurantId: string, params?: { page?: number; status?: string }) =>
    api.get<{ appointments: any[]; total: number; page: number; limit: number }>(
      `/restaurant-analytics/${restaurantId}/appointments`, { params }
    ),
  getStats: (restaurantId: string) =>
    api.get<{ orders: any; appointments: any; top_products: any[] }>(
      `/restaurant-analytics/${restaurantId}/stats`
    ),
  getMyAssignments: () =>
    api.get<{ restaurants: any[] }>('/restaurant-analytics/my-assignments'),
  getUsers: (restaurantId: string) =>
    api.get<{ users: any[] }>(`/restaurant-analytics/${restaurantId}/users`),
  addUser: (restaurantId: string, email: string) =>
    api.post<{ ok: boolean; user: any }>(`/restaurant-analytics/${restaurantId}/users`, { email }),
  removeUser: (restaurantId: string, userId: string) =>
    api.delete(`/restaurant-analytics/${restaurantId}/users/${userId}`),
  updateOrderStatus: (restaurantId: string, orderId: string, status: string) =>
    api.patch(`/restaurant-analytics/${restaurantId}/orders/${orderId}/status`, { status }),
  getStockHistory: (restaurantId: string, limit?: number) =>
    api.get<any[]>(`/restaurants/${restaurantId}/stock-history${limit ? `?limit=${limit}` : ''}`),
};

export const appointmentsApi = {
  getAll: () => api.get('/appointments'),
  getSlots: (params?: { restaurant_id?: string }) =>
    api.get('/appointments/slots', { params }),
  create: (data: {
    service_type?: string;
    car_info?: string;
    notes?: string;
    appointment_date: string;
    duration_minutes?: number;
    user_name?: string;
    user_phone?: string;
    restaurant_id: string;
  }) => api.post('/appointments', data),
  updateStatus: (id: string, status: string) =>
    api.patch(`/appointments/${id}/status`, { status }),
  update: (
    id: string,
    data: {
      appointment_date: string;
      service_type?: string;
      car_info?: string;
      notes?: string;
      duration_minutes?: number;
    },
  ) => api.patch(`/appointments/${id}`, data),
  delete: (id: string) => api.delete(`/appointments/${id}`),
  getHistory: (id: string) => api.get(`/appointments/${id}/history`),
  // Customer-initiated reschedule/cancel request — opens a chat with the
  // store and posts a request message that triggers the AI auto-reply.
  // Returns { conversation_id } so the caller can deep-link the chat.
  requestChange: (id: string) =>
    api.post<{ ok: boolean; conversation_id: string; message_id: string }>(
      `/appointments/${id}/request-change`,
    ),
};

export interface PushLogEntry {
  id: string;
  event_type: string;
  title: string | null;
  body: string | null;
  title_en: string | null;
  title_ar: string | null;
  body_en: string | null;
  body_ar: string | null;
  payload: Record<string, unknown>;
  recipient_user_ids: string[];
  recipient_count: number;
  sent_at: string;
  acknowledged_at: string | null;
}

export interface PushLogResponse {
  data: PushLogEntry[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    pages: number;
  };
}

export interface TopOffender {
  product_id: string;
  name: string | null;
  name_ar: string | null;
  sku: string | null;
  image_url: string | null;
  out_of_stock_count: number;
  low_stock_count: number;
  total_count: number;
  last_alert_at: string;
  current_stock: number;
  units_sold: number;
  avg_daily_sales: number;
  cover_days: number;
  suggested_reorder_qty: number;
}

export const pushLogApi = {
  getLog: (params?: { page?: number; limit?: number; start_date?: string; end_date?: string; event_type?: string; unread_only?: boolean; restaurant_id?: string }) =>
    api.get<PushLogResponse>('/notifications/push-log', { params }),
  acknowledge: (id: string) =>
    api.patch(`/notifications/push-log/${id}/acknowledge`),
  acknowledgeAll: (filters?: { start_date?: string; end_date?: string; event_type?: string; restaurant_id?: string }) =>
    api.post<{ acknowledged_count: number }>('/notifications/push-log/acknowledge-all', filters ?? {}),
  getUnreadCount: (params?: { since?: string | null; restaurant_id?: string; event_type?: string }) => {
    const cleaned: Record<string, string> = {};
    if (params?.since) cleaned.since = params.since;
    if (params?.restaurant_id) cleaned.restaurant_id = params.restaurant_id;
    if (params?.event_type) cleaned.event_type = params.event_type;
    return api.get<{ count: number }>('/notifications/push-log/unread-count', {
      params: Object.keys(cleaned).length > 0 ? cleaned : undefined,
    });
  },
  getDailyCounts: (params?: { start_date?: string; end_date?: string; restaurant_id?: string }) =>
    api.get<{ days: string[]; series: { low_stock: number[]; out_of_stock: number[] } }>(
      '/notifications/push-log/daily-counts',
      { params },
    ),
  getTopOffenders: (params?: { start_date?: string; end_date?: string; restaurant_id?: string; limit?: number }) =>
    api.get<{ items: TopOffender[] }>('/notifications/push-log/top-offenders', { params }),
};

export const ratingsApi = {
  submit: (data: { order_id: string; rating: number; comment?: string | null; restaurant_id?: string | null }) =>
    api.post('/ratings', data),
  getRecent: (params?: { limit?: number; restaurant_id?: string }) =>
    api.get('/ratings', { params }),
  getSummary: (restaurantIds: string[]) =>
    api.get<{ restaurant_id: string; avg_rating: number; review_count: number }[]>(
      '/ratings/summary',
      { params: { restaurant_ids: restaurantIds.join(',') } },
    ),
  adminGetAll: (params?: { page?: number; limit?: number; restaurant_id?: string; star?: number }) =>
    api.get('/admin/ratings', { params }),
  adminExportCsv: (params?: { restaurant_id?: string; star?: number }) =>
    api.get('/admin/ratings/export', { params, responseType: 'text' }),
  adminDelete: (id: string) =>
    api.delete(`/admin/ratings/${id}`),
  adminReply: (id: string, reply: string) =>
    api.put(`/admin/ratings/${id}/reply`, { reply }),
  adminDeleteReply: (id: string) =>
    api.delete(`/admin/ratings/${id}/reply`),
  getDistribution: (params?: { restaurant_id?: string }) =>
    api.get<{ '1': number; '2': number; '3': number; '4': number; '5': number; total: number; average: number }>(
      '/ratings/distribution',
      { params },
    ),
};

export default api;
