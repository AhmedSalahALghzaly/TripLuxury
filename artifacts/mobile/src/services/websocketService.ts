/**
 * WebSocket Service for Real-time Notifications & Granular Cache Updates
 * OPTIMIZED: Supports granular updates for orders, products, customers
 * v2.0.0
 */
import { useEffect, useRef, useCallback, useMemo } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAppStore } from '../store/appStore';
import { useDataCacheStore } from '../store/useDataCacheStore';
import {
  getAppLivenessSnapshot,
  subscribeAppLiveness,
} from '../hooks/useAppLiveness';
import { t_notif } from '../i18n/notificationTranslations';
import { updateStoredOrderStatus } from '../hooks/useMissedOrderNotifications';

const WS_URL = (() => {
  const apiUrl = process.env.EXPO_PUBLIC_API_URL;
  if (apiUrl) return apiUrl.replace(/^http/, 'ws');
  const domain = process.env.EXPO_PUBLIC_DOMAIN;
  if (domain) {
    const cleaned = domain.replace(/^https?:\/\//, '');
    return `wss://${cleaned}`;
  }
  return 'ws://localhost:5000';
})();

// WebSocket message types for type safety
export type WSMessageType = 
  | 'notification'
  | 'sync'
  | 'ping'
  | 'pong'
  | 'order_created'
  | 'order_updated'
  | 'order_deleted'
  | 'product_created'
  | 'product_updated'
  | 'product_deleted'
  | 'product_stock_updated'
  | 'customer_created'
  | 'customer_updated'
  | 'customer_deleted'
  | 'cart_updated'
  | 'favorites_updated'
  | 'price_changed'
  | 'promotion_started'
  | 'promotion_ended'
  | 'promotion_created'
  | 'promotion_updated'
  | 'promotion_deleted'
  | 'promotion_reordered'
  | 'bundle_created'
  | 'bundle_updated'
  | 'bundle_deleted'
  | 'marketing_slider_changed'
  | 'category_created'
  | 'category_updated'
  | 'category_deleted'
  | 'car_brand_created'
  | 'car_brand_updated'
  | 'car_brand_deleted'
  | 'car_model_created'
  | 'car_model_updated'
  | 'car_model_deleted'
  | 'supplier_created'
  | 'supplier_updated'
  | 'supplier_deleted'
  | 'distributor_created'
  | 'distributor_updated'
  | 'distributor_deleted'
  | 'knowledge_base_created'
  | 'knowledge_base_deleted'
  | 'reconnect_sweep'
  | 'order_notification_read'
  | 'subscription_revoked'
  | 'appointment_created'
  | 'appointment_updated'
  | 'appointment_deleted'
  | 'out_of_stock'
  | 'low_stock_alert'
  | 'order_status_changed'
  | 'new_order'
  | 'chat_message'
  | 'restaurant_user_assigned'
  | 'rating_created'
  | 'rating_deleted'
  | 'rating_reply_updated'
  | 'stock_updated';

export interface WSMessage {
  type: WSMessageType;
  data?: any;
  timestamp?: string;
  affected_ids?: string[];
}

// Message handler type with priority
export interface MessageHandler {
  handler: (data: WSMessage) => void;
  priority: number;
  types?: WSMessageType[];
}

class WebSocketService {
  private ws: WebSocket | null = null;
  private reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;
  private messageHandlers: Map<string, MessageHandler> = new Map();
  private userId: string | undefined;
  private heartbeatInterval: ReturnType<typeof setInterval> | null = null;
  private lastPong: number = Date.now();
  private connectionState: 'disconnected' | 'connecting' | 'connected' | 'reconnecting' | 'paused' = 'disconnected';
  private stateListeners: Set<(state: string) => void> = new Set();
  private livenessUnsubscribe: (() => void) | null = null;
  private paused = false;
  private autoConnectRequested = false;

  // Connection state getter
  get state(): string {
    return this.connectionState;
  }

  // Subscribe to connection state changes
  onStateChange(listener: (state: string) => void): () => void {
    this.stateListeners.add(listener);
    return () => this.stateListeners.delete(listener);
  }

  private setConnectionState(state: 'disconnected' | 'connecting' | 'connected' | 'reconnecting' | 'paused') {
    this.connectionState = state;
    this.stateListeners.forEach(listener => listener(state));
  }

  private ensureLivenessSubscription() {
    if (this.livenessUnsubscribe) return;
    this.livenessUnsubscribe = subscribeAppLiveness(() => {
      const { isLive } = getAppLivenessSnapshot();
      if (!isLive) {
        if (!this.paused) {
          console.log('[WS] Pausing — app backgrounded or offline');
          this.pause();
        }
      } else if (this.paused) {
        console.log('[WS] Resuming — app foreground & online');
        this.resume();
      }
    });
  }

  private pause() {
    this.paused = true;
    this.stopHeartbeat();
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
    if (this.ws) {
      try { this.ws.close(1000, 'App paused'); } catch {}
      this.ws = null;
    }
    this.setConnectionState('paused');
  }

  private resume() {
    this.paused = false;
    this.reconnectAttempts = 0;
    if (this.autoConnectRequested) {
      this.connect(this.userId);
    }
  }

  connect(userId?: string) {
    this.autoConnectRequested = true;
    this.ensureLivenessSubscription();

    if (this.ws?.readyState === WebSocket.OPEN) {
      return;
    }

    this.userId = userId;

    // Don't try to connect while backgrounded or offline.
    const { isLive } = getAppLivenessSnapshot();
    if (!isLive) {
      this.paused = true;
      this.setConnectionState('paused');
      return;
    }

    this.paused = false;
    this.setConnectionState('connecting');

    const url = userId ? `${WS_URL}/api/ws?user_id=${userId}` : `${WS_URL}/api/ws`;
    
    try {
      this.ws = new WebSocket(url);

      this.ws.onopen = () => {
        console.log('[WS] Connected');
        const wasReconnect = this.reconnectAttempts > 0;
        this.reconnectAttempts = 0;
        this.setConnectionState('connected');
        this.startHeartbeat();
        
        // Send authentication if user is logged in
        if (userId) {
          this.send({ type: 'auth', userId });
        }

        // After a reconnect, fan out a synthetic event so handlers can
        // refresh canonical caches that may have changed while disconnected.
        if (wasReconnect) {
          console.log('[WS] Reconnect sweep — invalidating canonical caches');
          this.dispatchMessage({ type: 'reconnect_sweep' });
        }
      };

      this.ws.onmessage = (event) => {
        try {
          const data: WSMessage = JSON.parse(event.data);
          data.timestamp = data.timestamp || new Date().toISOString();
          
          // Handle pong for heartbeat
          if (data.type === 'pong') {
            this.lastPong = Date.now();
            return;
          }
          
          console.log('[WS] Message:', data.type, data.affected_ids?.length || 0, 'affected items');
          this.dispatchMessage(data);
        } catch (err) {
          console.error('[WS] Parse error:', err);
        }
      };

      this.ws.onerror = (error) => {
        console.error('[WS] Error:', error);
      };

      this.ws.onclose = (event) => {
        console.log('[WS] Disconnected:', event.code, event.reason);
        this.stopHeartbeat();
        if (this.paused) {
          this.setConnectionState('paused');
          return;
        }
        this.setConnectionState('disconnected');
        this.scheduleReconnect();
      };
    } catch (err) {
      console.error('[WS] Connection error:', err);
      this.setConnectionState('disconnected');
      this.scheduleReconnect();
    }
  }

  private startHeartbeat() {
    this.stopHeartbeat();
    this.heartbeatInterval = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        // Check if we received pong in last 30 seconds
        if (Date.now() - this.lastPong > 30000) {
          console.log('[WS] Heartbeat timeout, reconnecting...');
          this.ws?.close();
          return;
        }
        this.send({ type: 'ping' });
      }
    }, 15000);
  }

  private stopHeartbeat() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  private dispatchMessage(data: WSMessage) {
    // Sort handlers by priority (higher first)
    const sortedHandlers = Array.from(this.messageHandlers.values())
      .sort((a, b) => b.priority - a.priority);

    for (const { handler, types } of sortedHandlers) {
      // If handler has type filter, check if message type matches
      if (types && types.length > 0 && !types.includes(data.type)) {
        continue;
      }
      
      try {
        handler(data);
      } catch (err) {
        console.error('[WS] Handler error:', err);
      }
    }
  }

  private scheduleReconnect() {
    // Skip reconnect entirely while backgrounded or offline — resume() will
    // re-trigger connect() once liveness returns.
    if (this.paused) {
      return;
    }
    const { isLive } = getAppLivenessSnapshot();
    if (!isLive) {
      this.paused = true;
      this.setConnectionState('paused');
      return;
    }
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.log('[WS] Max reconnect attempts reached');
      return;
    }

    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
    }

    this.setConnectionState('reconnecting');

    // Exponential backoff with jitter
    const baseDelay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);
    const jitter = Math.random() * 1000;
    const delay = baseDelay + jitter;
    
    this.reconnectAttempts++;

    this.reconnectTimeout = setTimeout(() => {
      console.log(`[WS] Reconnecting (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})...`);
      this.connect(this.userId);
    }, delay);
  }

  disconnect() {
    this.stopHeartbeat();

    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }

    if (this.ws) {
      this.ws.close(1000, 'User disconnect');
      this.ws = null;
    }

    // Explicit disconnect: clear auto-connect intent and tear down the
    // liveness subscription so we don't leave a module-level listener around.
    this.autoConnectRequested = false;
    this.paused = false;
    if (this.livenessUnsubscribe) {
      this.livenessUnsubscribe();
      this.livenessUnsubscribe = null;
    }

    this.setConnectionState('disconnected');
  }

  send(data: any) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
      return true;
    }
    return false;
  }

  /**
   * Add a message handler with optional type filtering and priority
   * @param id Unique identifier for the handler
   * @param handler The handler function
   * @param options Optional configuration (types to listen for, priority)
   * @returns Cleanup function
   */
  addMessageHandler(
    id: string,
    handler: (data: WSMessage) => void,
    options?: { types?: WSMessageType[]; priority?: number }
  ): () => void {
    this.messageHandlers.set(id, {
      handler,
      priority: options?.priority ?? 0,
      types: options?.types,
    });
    return () => this.messageHandlers.delete(id);
  }

  removeMessageHandler(id: string) {
    this.messageHandlers.delete(id);
  }

  isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  // Manual reconnect (resets attempt counter)
  reconnect() {
    this.reconnectAttempts = 0;
    this.disconnect();
    setTimeout(() => this.connect(this.userId), 100);
  }
}

export const wsService = new WebSocketService();

/**
 * React hook for WebSocket with granular cache updates
 * Optimizes real-time data by updating specific items instead of full refetch
 */
export const useWebSocket = () => {
  const user = useAppStore((state) => state.user);
  const language = useAppStore((state) => state.language);
  const addNotification = useAppStore((state) => state.addNotification);
  const setSyncStatus = useAppStore((state) => state.setSyncStatus);
  const setSubscriptionStatus = useAppStore((state) => state.setSubscriptionStatus);
  const queryClient = useQueryClient();
  
  // Track connection state
  const connectionStateRef = useRef<string>('disconnected');

  // Keep a ref so notification handlers always read the *current* language even
  // if the user switches locale after the effect has mounted.  The main WS
  // effect intentionally omits `language` from its deps (re-registering all
  // handlers on every language toggle would be wasteful), so we snapshot it
  // here and read `languageRef.current` inside the handlers instead.
  const languageRef = useRef<'ar' | 'en'>(language === 'ar' ? 'ar' : 'en');
  useEffect(() => {
    languageRef.current = language === 'ar' ? 'ar' : 'en';
  }, [language]);

  useEffect(() => {
    // Connect WebSocket
    wsService.connect(user?.id);

    // Listen for connection state changes
    const unsubscribeState = wsService.onStateChange((state) => {
      connectionStateRef.current = state;
    });

    // ==========================================
    // Notification Handler (Priority: 10)
    // ==========================================
    const removeNotificationHandler = wsService.addMessageHandler(
      'notification-handler',
      (data) => {
        if (data.type === 'notification' && data.data) {
          addNotification({
            id: data.data.id || `notif-${Date.now()}`,
            title: data.data.title,
            title_ar: data.data.title_ar || data.data.title,
            message: data.data.message,
            message_ar: data.data.message_ar || data.data.message,
            type: data.data.type || 'info',
            read: false,
            created_at: data.data.created_at || new Date().toISOString(),
            metadata: data.data.metadata || undefined,
          });
          // Fire local OS notifications for specific notification kinds.
          const notifKind = data.data?.metadata?.kind;
          // Use the ref so we always get the current language, even if the
          // user switched locale after this effect first mounted.
          const notifLang: 'ar' | 'en' = languageRef.current;

          // ── Order status change → show persistent local notification ──────
          if (notifKind === 'order_updated' && data.data?.metadata?.new_status) {
            void (async () => {
              try {
                const { default: pushService } = require('./pushNotificationService');
                await pushService.sendOrderStatusNotification(
                  data.data.metadata.order_id,
                  data.data.metadata.order_number,
                  data.data.metadata.new_status,
                  notifLang,
                );
                // Keep the stored status map in sync so the missed-notification
                // replay hook never re-fires this same change on next resume.
                const uid = useAppStore.getState().user?.id;
                if (uid && data.data.metadata.order_id) {
                  void updateStoredOrderStatus(
                    uid,
                    data.data.metadata.order_id,
                    data.data.metadata.new_status,
                  );
                }
              } catch {}
            })();
          }

          // ── Stock alerts → bilingual local push ───────────────────────────
          if (notifKind === 'out_of_stock' || notifKind === 'low_stock') {
            try {
              const { default: pushService } = require('./pushNotificationService');
              const nameAr = data.data.metadata?.name_ar || data.data.metadata?.name || '';
              const nameEn = data.data.metadata?.name || data.data.metadata?.name_ar || '';
              const prodName = notifLang === 'ar' ? nameAr : nameEn;
              const ind = data.data.metadata?.fitment_indicator
                ? ` (${data.data.metadata.fitment_indicator})`
                : '';
              const fullName = `${prodName}${ind}`;
              if (notifKind === 'out_of_stock') {
                pushService.scheduleLocalNotification({
                  title: t_notif('stockOutTitle', notifLang),
                  body: t_notif('stockOutBody', notifLang, { name: fullName }),
                  data: data.data.metadata,
                });
              } else {
                pushService.scheduleLocalNotification({
                  title: t_notif('stockLowTitle', notifLang),
                  body: t_notif('stockLowBody', notifLang, { name: fullName }),
                  data: data.data.metadata,
                });
              }
            } catch {}
          }

          // ── Badge count: reflect the new unread count on the app icon ─────
          // Runs after addNotification() has already incremented the store's
          // unreadCount so we can read the updated value immediately.
          try {
            const { default: pushService } = require('./pushNotificationService');
            const freshUnread = useAppStore.getState().unreadCount;
            pushService.setBadgeCount(freshUnread).catch(() => {});
          } catch {}

        } else if (data.type === 'out_of_stock' && data.data) {
          // Invalidate product caches so stock UI refreshes immediately
          queryClient.invalidateQueries({ queryKey: ['/api/products'] });
          queryClient.invalidateQueries({ queryKey: ['products'] });
          if (data.data.product_id) {
            queryClient.invalidateQueries({ queryKey: ['product', data.data.product_id] });
          }
        } else if (data.type === 'subscription_revoked') {
          // Owner deleted/revoked this user's subscription → reset status
          setSubscriptionStatus('none');
          queryClient.invalidateQueries({ queryKey: ['/api/subscription-status'] });
          queryClient.invalidateQueries({ queryKey: ['/api/subscription-requests'] });
        }
      },
      { types: ['notification', 'out_of_stock', 'subscription_revoked'], priority: 10 }
    );

    // ==========================================
    // Order Updates Handler (Priority: 8)
    // Granular cache update for orders
    // ==========================================
    const removeOrderHandler = wsService.addMessageHandler(
      'order-handler',
      (data) => {
        const orderId = data.data?.id;
        
        switch (data.type) {
          case 'order_created':
            // Invalidate orders list to refetch
            queryClient.invalidateQueries({ queryKey: ['orders'] });
            // Also refresh admin's "viewing this customer's orders" cache
            // so /cart?tab=orders updates instantly when admin is viewing
            // the customer that just placed an order.
            if (data.data?.user_id) {
              queryClient.invalidateQueries({
                queryKey: ['shoppingHub', 'customerOrders', data.data.user_id],
              });
            }
            // Add bilingual notification — show in the user's current language.
            addNotification({
              id: `order-${orderId}-created`,
              title: 'New Order',
              title_ar: 'طلب جديد',
              message: `New order #${data.data?.order_number || orderId?.slice(-8)} received`,
              message_ar: `تم استلام طلب جديد #${data.data?.order_number || orderId?.slice(-8)}`,
              type: 'success',
              read: false,
              created_at: new Date().toISOString(),
            });
            break;

          case 'order_updated':
            // Invalidate the orders list so useOrdersQuery (key ['orders','admin']
            // or ['orders','self']) picks up the change. setQueryData(['orders'],…)
            // would miss the key because the actual key has an extra 'admin'/'self'
            // discriminator segment, so we use invalidateQueries (prefix match).
            queryClient.invalidateQueries({ queryKey: ['orders'] });
            // Also update the single order query
            queryClient.setQueryData(['order', orderId], data.data);
            // Refresh admin's customer-orders cache for the affected user
            if (data.data?.user_id) {
              queryClient.invalidateQueries({
                queryKey: ['shoppingHub', 'customerOrders', data.data.user_id],
              });
            }
            break;

          case 'order_status_changed':
            // Broadcast by the restaurant-analytics PATCH /orders/:id/status.
            // Invalidate both the admin/self orders list and any customer-scoped
            // orders cache so every open view refreshes immediately.
            queryClient.invalidateQueries({ queryKey: ['orders'] });
            if (orderId) {
              queryClient.setQueryData(['order', orderId], (old: any) =>
                old ? { ...old, ...data.data } : data.data,
              );
            }
            if (data.data?.user_id) {
              queryClient.invalidateQueries({
                queryKey: ['shoppingHub', 'customerOrders', data.data.user_id],
              });
            }
            break;

          case 'new_order':
            // Alias for order_created — invalidate the full orders list.
            queryClient.invalidateQueries({ queryKey: ['orders'] });
            if (data.data?.user_id) {
              queryClient.invalidateQueries({
                queryKey: ['shoppingHub', 'customerOrders', data.data.user_id],
              });
            }
            break;

          case 'order_deleted':
            // Remove order from cache
            queryClient.setQueryData(['orders'], (old: any[] | undefined) => {
              if (!old) return old;
              return old.filter(order => order.id !== orderId);
            });
            queryClient.removeQueries({ queryKey: ['order', orderId] });
            break;

          case 'order_notification_read': {
            // Customer read a notification — update customer_last_read_status in cache
            const readOrderId = data.data?.order_id;
            const readStatus = data.data?.status;
            if (readOrderId && readStatus) {
              queryClient.setQueryData(['orders'], (old: any[] | undefined) => {
                if (!old) return old;
                return old.map((order: any) =>
                  order.id === readOrderId
                    ? { ...order, customer_last_read_status: readStatus, customer_read_at: new Date().toISOString() }
                    : order
                );
              });
            }
            break;
          }
        }
      },
      {
        types: [
          'order_created',
          'order_updated',
          'order_deleted',
          'order_notification_read',
          'order_status_changed',
          'new_order',
        ],
        priority: 8,
      }
    );

    // ==========================================
    // Appointment Updates Handler (Priority: 8)
    // Real-time refresh for the BookingStrip on every connected client.
    // BookingStrip itself listens via useWebSocketEvent and reloads its
    // own internal state — here we just invalidate any react-query keys
    // that depend on appointments (currently the customer-orders cache
    // for the admin's customer-detail view).
    // ==========================================
    const removeAppointmentHandler = wsService.addMessageHandler(
      'appointment-handler',
      (data) => {
        const affectedUserId = data.data?.user_id;
        // Invalidate any per-customer cache so admin's view of that
        // customer's bookings stays fresh too.
        if (affectedUserId) {
          queryClient.invalidateQueries({
            queryKey: ['shoppingHub', 'customerOrders', affectedUserId],
          });
        }
        // Generic appointments key (in case anything queries it)
        queryClient.invalidateQueries({ queryKey: ['appointments'] });
      },
      {
        types: ['appointment_created', 'appointment_updated', 'appointment_deleted'],
        priority: 8,
      },
    );

    // ==========================================
    // Product Updates Handler (Priority: 8)
    // Granular cache update for products
    // ==========================================
    const removeProductHandler = wsService.addMessageHandler(
      'product-handler',
      (data) => {
        const productId = data.data?.id;
        
        switch (data.type) {
          case 'product_created':
            queryClient.invalidateQueries({ queryKey: ['products'] });
            break;

          case 'product_updated':
          case 'product_stock_updated':
          case 'price_changed':
            // Update specific product in cache
            queryClient.setQueryData(['products', 'infinite'], (old: any) => {
              if (!old?.pages) return old;
              return {
                ...old,
                pages: old.pages.map((page: any) => ({
                  ...page,
                  products: page.products.map((product: any) =>
                    product.id === productId ? { ...product, ...data.data } : product
                  ),
                })),
              };
            });
            // Also update single product query
            queryClient.setQueryData(['product', productId], (old: any) => 
              old ? { ...old, ...data.data } : old
            );
            break;

          case 'product_deleted':
            // Remove product from infinite query cache
            queryClient.setQueryData(['products', 'infinite'], (old: any) => {
              if (!old?.pages) return old;
              return {
                ...old,
                pages: old.pages.map((page: any) => ({
                  ...page,
                  products: page.products.filter((product: any) => product.id !== productId),
                })),
              };
            });
            queryClient.removeQueries({ queryKey: ['product', productId] });
            break;
        }
        // Always invalidate the home-screen product slices (combined list +
        // typed strips). These use a separate query-key prefix from the
        // generic ['products'] cache, so without this they would otherwise
        // remain stale now that home-screen polling has been removed.
        queryClient.invalidateQueries({ queryKey: ['homeScreen', 'products'] });
      },
      { types: ['product_created', 'product_updated', 'product_deleted', 'product_stock_updated', 'price_changed'], priority: 8 }
    );

    // ==========================================
    // Customer Updates Handler (Priority: 7)
    // Granular cache update for customers
    // ==========================================
    const removeCustomerHandler = wsService.addMessageHandler(
      'customer-handler',
      (data) => {
        const customerId = data.data?.id || data.data?.user_id;
        
        switch (data.type) {
          case 'customer_created':
            queryClient.invalidateQueries({ queryKey: ['customers'] });
            break;

          case 'customer_updated':
            queryClient.setQueryData(['customers'], (old: any[] | undefined) => {
              if (!old) return old;
              return old.map(customer =>
                (customer.id === customerId || customer.user_id === customerId) 
                  ? { ...customer, ...data.data } 
                  : customer
              );
            });
            break;

          case 'customer_deleted':
            queryClient.setQueryData(['customers'], (old: any[] | undefined) => {
              if (!old) return old;
              return old.filter(customer => 
                customer.id !== customerId && customer.user_id !== customerId
              );
            });
            break;
        }
      },
      { types: ['customer_created', 'customer_updated', 'customer_deleted'], priority: 7 }
    );

    // ==========================================
    // Cart & Favorites Handler (Priority: 9)
    // For user-specific updates
    // ==========================================
    const removeCartHandler = wsService.addMessageHandler(
      'cart-favorites-handler',
      (data) => {
        switch (data.type) {
          case 'cart_updated':
            queryClient.invalidateQueries({ queryKey: ['cart'] });
            break;

          case 'favorites_updated':
            queryClient.invalidateQueries({ queryKey: ['favorites'] });
            break;
        }
      },
      { types: ['cart_updated', 'favorites_updated'], priority: 9 }
    );

    // ==========================================
    // Promotion Handler (Priority: 6)
    // Covers activation/deactivation, CRUD, and reorder events.
    // ==========================================
    const removePromoHandler = wsService.addMessageHandler(
      'promotion-handler',
      (data) => {
        if (data.type === 'promotion_started' || data.type === 'promotion_ended') {
          // Invalidate product queries to refresh prices
          queryClient.invalidateQueries({ queryKey: ['products'] });
        }
        // CRUD/reorder events refresh marketing dashboard + customer-side
        // banners + the home slider aggregator endpoint.
        queryClient.invalidateQueries({ queryKey: ['promotions'] });
        queryClient.invalidateQueries({ queryKey: ['marketing'] });
        queryClient.invalidateQueries({ queryKey: ['homeScreen', 'banners'] });
        queryClient.invalidateQueries({ queryKey: ['/api/marketing/home-slider'] });
      },
      {
        types: [
          'promotion_started',
          'promotion_ended',
          'promotion_created',
          'promotion_updated',
          'promotion_deleted',
          'promotion_reordered',
        ],
        priority: 6,
      },
    );

    // ==========================================
    // Bundle Offer Handler (Priority: 6)
    // ==========================================
    const removeBundleHandler = wsService.addMessageHandler(
      'bundle-handler',
      () => {
        queryClient.invalidateQueries({ queryKey: ['bundles'] });
        queryClient.invalidateQueries({ queryKey: ['bundleOffers'] });
        queryClient.invalidateQueries({ queryKey: ['marketing'] });
        queryClient.invalidateQueries({ queryKey: ['homeScreen', 'banners'] });
        queryClient.invalidateQueries({ queryKey: ['/api/marketing/home-slider'] });
      },
      {
        types: ['bundle_created', 'bundle_updated', 'bundle_deleted'],
        priority: 6,
      },
    );

    // ==========================================
    // Marketing Slider Handler (Priority: 6)
    // Aggregator endpoint emits this on any promotion or bundle change.
    // ==========================================
    const removeMarketingSliderHandler = wsService.addMessageHandler(
      'marketing-slider-handler',
      () => {
        queryClient.invalidateQueries({ queryKey: ['/api/marketing/home-slider'] });
        queryClient.invalidateQueries({ queryKey: ['homeScreen', 'banners'] });
      },
      { types: ['marketing_slider_changed'], priority: 6 },
    );

    // ==========================================
    // Categories Handler (Priority: 7)
    // Invalidates both the standalone categories cache and the
    // home-screen tree slice.
    // ==========================================
    const removeCategoryHandler = wsService.addMessageHandler(
      'category-handler',
      () => {
        queryClient.invalidateQueries({ queryKey: ['categories'] });
        queryClient.invalidateQueries({ queryKey: ['homeScreen', 'categories'] });
      },
      {
        types: ['category_created', 'category_updated', 'category_deleted'],
        priority: 7,
      },
    );

    // ==========================================
    // Car Brands / Models Handler (Priority: 7)
    // Replaces previous polling on home-screen brand/model strips.
    // ==========================================
    const removeCarBrandHandler = wsService.addMessageHandler(
      'car-brand-handler',
      () => {
        queryClient.invalidateQueries({ queryKey: ['carBrands'] });
        queryClient.invalidateQueries({ queryKey: ['homeScreen', 'carBrands'] });
      },
      {
        types: ['car_brand_created', 'car_brand_updated', 'car_brand_deleted'],
        priority: 7,
      },
    );
    const removeCarModelHandler = wsService.addMessageHandler(
      'car-model-handler',
      () => {
        queryClient.invalidateQueries({ queryKey: ['carModels'] });
        queryClient.invalidateQueries({ queryKey: ['homeScreen', 'carModels'] });
      },
      {
        types: ['car_model_created', 'car_model_updated', 'car_model_deleted'],
        priority: 7,
      },
    );

    // ==========================================
    // Suppliers Handler (Priority: 7)
    // ==========================================
    const removeSupplierHandler = wsService.addMessageHandler(
      'supplier-handler',
      () => {
        queryClient.invalidateQueries({ queryKey: ['suppliers'] });
      },
      {
        types: ['supplier_created', 'supplier_updated', 'supplier_deleted'],
        priority: 7,
      },
    );

    // ==========================================
    // Distributors Handler (Priority: 7)
    // ==========================================
    const removeDistributorHandler = wsService.addMessageHandler(
      'distributor-handler',
      () => {
        queryClient.invalidateQueries({ queryKey: ['distributors'] });
      },
      {
        types: ['distributor_created', 'distributor_updated', 'distributor_deleted'],
        priority: 7,
      },
    );

    // ==========================================
    // Knowledge Base Handler (Priority: 6)
    // Generic React Query invalidation; KB screens that hold local
    // state subscribe directly via `useWebSocketEvent` to refresh.
    // ==========================================
    const removeKnowledgeBaseHandler = wsService.addMessageHandler(
      'knowledge-base-handler',
      () => {
        queryClient.invalidateQueries({ queryKey: ['knowledge_base'] });
      },
      { types: ['knowledge_base_created', 'knowledge_base_deleted'], priority: 6 },
    );

    // ==========================================
    // Reconnect Sweep Handler (Priority: 4)
    // After a reconnect, refresh canonical real-time-backed caches.
    // ==========================================
    const removeReconnectSweepHandler = wsService.addMessageHandler(
      'reconnect-sweep-handler',
      () => {
        const keys = [
          ['products'],
          ['categories'],
          ['suppliers'],
          ['distributors'],
          ['promotions'],
          ['bundles'],
          ['bundleOffers'],
          ['marketing'],
          ['homeScreen'],
          ['orders'],
          ['customers'],
          ['cart'],
          ['favorites'],
          ['appointments'],
          ['knowledge_base'],
          ['/api/marketing/home-slider'],
          ['push-log-unread-count'],
        ];
        for (const key of keys) {
          queryClient.invalidateQueries({ queryKey: key });
        }
      },
      { types: ['reconnect_sweep'], priority: 4 },
    );

    // ==========================================
    // Sync Handler (Priority: 5)
    // Full data refresh when needed
    // ==========================================
    const removeSyncHandler = wsService.addMessageHandler(
      'sync-handler',
      (data) => {
        if (data.type === 'sync') {
          setSyncStatus('syncing');
          queryClient.invalidateQueries()
            .then(() => {
              setSyncStatus('success');
              setTimeout(() => setSyncStatus('idle'), 2000);
            })
            .catch(() => {
              setSyncStatus('error');
            });
        }
      },
      { types: ['sync'], priority: 5 }
    );

    // ==========================================
    // Ping Handler (Priority: 1)
    // ==========================================
    const removePingHandler = wsService.addMessageHandler(
      'ping-handler',
      (data) => {
        if (data.type === 'ping') {
          wsService.send({ type: 'pong' });
        }
      },
      { types: ['ping'], priority: 1 }
    );

    // Cleanup
    return () => {
      unsubscribeState();
      removeNotificationHandler();
      removeOrderHandler();
      removeAppointmentHandler();
      removeProductHandler();
      removeCustomerHandler();
      removeCartHandler();
      removePromoHandler();
      removeBundleHandler();
      removeMarketingSliderHandler();
      removeCategoryHandler();
      removeCarBrandHandler();
      removeCarModelHandler();
      removeSupplierHandler();
      removeDistributorHandler();
      removeKnowledgeBaseHandler();
      removeReconnectSweepHandler();
      removeSyncHandler();
      removePingHandler();
      wsService.disconnect();
    };
  }, [user?.id, queryClient, addNotification, setSyncStatus, setSubscriptionStatus]);

  const sendMessage = useCallback((data: any) => {
    return wsService.send(data);
  }, []);

  const reconnect = useCallback(() => {
    wsService.reconnect();
  }, []);

  return {
    isConnected: wsService.isConnected(),
    connectionState: connectionStateRef.current,
    sendMessage,
    reconnect,
  };
};

/**
 * Hook for subscribing to specific WebSocket event types.
 * Use this for component-specific real-time updates.
 *
 * The handler is held in a ref so that callers can pass an inline closure
 * that captures evolving state without re-subscribing — and without
 * accidentally invoking a stale closure from a previous render.
 */
export const useWebSocketEvent = (
  types: WSMessageType[],
  handler: (data: WSMessage) => void,
  enabled: boolean = true
) => {
  const handlerIdRef = useRef(`ws-event-${Math.random().toString(36).slice(2)}`);
  const handlerRef = useRef(handler);

  // Keep the ref pointed at the latest handler on every render.
  useEffect(() => {
    handlerRef.current = handler;
  }, [handler]);

  useEffect(() => {
    if (!enabled) return;

    const removeHandler = wsService.addMessageHandler(
      handlerIdRef.current,
      (data) => handlerRef.current(data),
      { types, priority: 5 }
    );

    return removeHandler;
  }, [enabled, JSON.stringify(types)]);
};

export default wsService;
