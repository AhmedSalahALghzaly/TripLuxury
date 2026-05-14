/**
 * Push Notification Service
 * Native: Uses expo-notifications for iOS/Android
 * Web: Uses the Browser Web Notifications API
 */
import { Platform } from 'react-native';
import Constants from 'expo-constants';
import {
  t_notif,
  getNotifLang,
  orderStatusNotifStrings,
} from '../i18n/notificationTranslations';

export interface PushNotificationData {
  title: string;
  body: string;
  data?: Record<string, any>;
}

// ──────────────────────────────────────────────
// Web Notification helpers
// ──────────────────────────────────────────────
async function requestWebPermission(): Promise<boolean> {
  if (typeof Notification === 'undefined') return false;
  if (Notification.permission === 'granted') return true;
  if (Notification.permission === 'denied') return false;
  const result = await Notification.requestPermission();
  return result === 'granted';
}

function showWebNotification(title: string, body: string, icon?: string, language: 'ar' | 'en' = 'ar'): void {
  if (typeof Notification === 'undefined') return;
  if (Notification.permission !== 'granted') return;
  try {
    new Notification(title, {
      body,
      icon: icon || '/assets/icon.png',
      badge: '/assets/icon.png',
      lang: language,
      dir: language === 'ar' ? 'rtl' : 'ltr',
      // Prevent the browser from auto-dismissing the notification after ~4 s.
      // The user must interact with it (click or close) for it to disappear.
      requireInteraction: true,
    });
  } catch {}
}


// ──────────────────────────────────────────────
// Native-only imports (lazy to avoid web crash)
// ──────────────────────────────────────────────
let Notifications: typeof import('expo-notifications') | null = null;
let Device: typeof import('expo-device') | null = null;

if (Platform.OS !== 'web') {
  try {
    Notifications = require('expo-notifications');
    Device = require('expo-device');

    Notifications!.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowAlert: true,
        shouldPlaySound: true,
        shouldSetBadge: true,
        shouldShowBanner: true,
        shouldShowList: true,
      }),
    });
  } catch {}
}

class PushNotificationService {
  private expoPushToken: string | null = null;
  private notificationListener: any = null;
  private responseListener: any = null;

  // ──────────────────────────────────────────
  // Request permission
  // ──────────────────────────────────────────
  async requestPermission(): Promise<boolean> {
    if (Platform.OS === 'web') {
      return requestWebPermission();
    }

    if (!Device?.isDevice) {
      console.log('[Push] Physical device required for push notifications');
      return false;
    }

    try {
      const { status: existing } = await Notifications!.getPermissionsAsync();
      if (existing === 'granted') return true;
      const { status } = await Notifications!.requestPermissionsAsync();
      return status === 'granted';
    } catch {
      return false;
    }
  }

  // ──────────────────────────────────────────
  // Get Expo push token (native only)
  // ──────────────────────────────────────────
  async getExpoPushToken(): Promise<string | null> {
    if (Platform.OS === 'web') return null;
    if (!Device?.isDevice) return null;

    try {
      const granted = await this.requestPermission();
      if (!granted) return null;

      if (Platform.OS === 'android') {
        await Notifications!.setNotificationChannelAsync('default', {
          name: 'Default',
          importance: Notifications!.AndroidImportance.MAX,
          vibrationPattern: [0, 250, 250, 250],
          lightColor: '#3B82F6',
        });
        await Notifications!.setNotificationChannelAsync('orders', {
          name: 'Order Updates',
          description: 'Notifications for order status changes',
          importance: Notifications!.AndroidImportance.HIGH,
          vibrationPattern: [0, 250, 250, 250],
          lightColor: '#10B981',
        });
        await Notifications!.setNotificationChannelAsync('stock_alerts', {
          name: 'تنبيهات المخزون',
          description: 'إشعارات نفاد وانخفاض المخزون',
          importance: Notifications!.AndroidImportance.MAX,
          vibrationPattern: [0, 300, 200, 300, 200, 300],
          lightColor: '#EF4444',
          enableVibrate: true,
          showBadge: true,
        });
      }

      const projectId = Constants.expoConfig?.extra?.eas?.projectId;
      const token = await Notifications!.getExpoPushTokenAsync({ projectId });
      this.expoPushToken = token.data;
      return this.expoPushToken;
    } catch (err) {
      console.error('[Push] Error getting token:', err);
      return null;
    }
  }

  // ──────────────────────────────────────────
  // Register token with backend (native only)
  // ──────────────────────────────────────────
  async registerTokenWithBackend(userId: string): Promise<boolean> {
    if (Platform.OS === 'web') {
      // On web, just request browser permission
      return requestWebPermission();
    }

    if (!this.expoPushToken) {
      await this.getExpoPushToken();
    }
    if (!this.expoPushToken) return false;

    try {
      const { default: api } = await import('./api');
      await api.post('/notifications/register-token', {
        token: this.expoPushToken,
        platform: Platform.OS,
      });
      return true;
    } catch {
      return false;
    }
  }

  // ──────────────────────────────────────────
  // Schedule / show a local notification
  // ──────────────────────────────────────────
  async scheduleLocalNotification(notification: PushNotificationData, delay: number = 0): Promise<string> {
    if (Platform.OS === 'web') {
      const lang = getNotifLang();
      if (delay > 0) {
        setTimeout(() => showWebNotification(notification.title, notification.body, undefined, lang), delay * 1000);
      } else {
        showWebNotification(notification.title, notification.body, undefined, lang);
      }
      return `web-${Date.now()}`;
    }

    const isStockAlert = notification.data?.kind === 'out_of_stock' || notification.data?.kind === 'low_stock';
    const isOrderNotif = notification.data?.type === 'order_confirmation' || notification.data?.type === 'order_status';
    const id = await Notifications!.scheduleNotificationAsync({
      content: {
        title: notification.title,
        body: notification.body,
        data: notification.data || {},
        sound: true,
        ...(Platform.OS === 'android' && {
          channelId: isStockAlert ? 'stock_alerts' : isOrderNotif ? 'orders' : 'default',
          priority: isStockAlert ? 'max' as any : undefined,
        }),
      },
      trigger: delay > 0 ? { type: Notifications!.SchedulableTriggerInputTypes.TIME_INTERVAL, seconds: delay } : null,
    });
    return id;
  }

  // ──────────────────────────────────────────
  // Show an order status notification
  // ──────────────────────────────────────────
  async sendOrderStatusNotification(
    orderId: string,
    orderNumber: string,
    status: string,
    language: 'en' | 'ar' = 'ar'
  ): Promise<void> {
    const { title, body } = orderStatusNotifStrings(orderNumber, status, language);
    await this.scheduleLocalNotification({
      title,
      body,
      data: { orderId, orderNumber, status, type: 'order_status' },
    });
  }

  // ──────────────────────────────────────────
  // Show a generic in-app notification on web
  // ──────────────────────────────────────────
  showWebAlert(title: string, body: string): void {
    if (Platform.OS !== 'web') return;
    showWebNotification(title, body, undefined, getNotifLang());
  }

  // ──────────────────────────────────────────
  // G3: report a delivery analytics event for a notification id
  // ──────────────────────────────────────────
  async trackNotificationEvent(notificationId: string, event: 'delivered' | 'opened'): Promise<void> {
    if (!notificationId) return;
    try {
      const { default: api } = await import('./api');
      await api.post(`/notifications/${notificationId}/track`, { event });
    } catch {
      // Best-effort — analytics must never block the UI flow.
    }
  }

  // ──────────────────────────────────────────
  // Native listeners
  // ──────────────────────────────────────────
  addListeners(
    onNotificationReceived?: (notification: any) => void,
    onNotificationResponse?: (response: any) => void
  ): void {
    if (Platform.OS === 'web' || !Notifications) return;

    this.notificationListener = Notifications.addNotificationReceivedListener((n) => {
      // G3: best-effort delivery tracking when the OS hands us the notification.
      const nid = n?.request?.content?.data?.notification_id as string | undefined;
      if (nid) this.trackNotificationEvent(nid, 'delivered');
      onNotificationReceived?.(n);
    });

    this.responseListener = Notifications.addNotificationResponseReceivedListener((r) => {
      // G3: a tap on the notification counts as 'opened'.
      const nid = r?.notification?.request?.content?.data?.notification_id as string | undefined;
      if (nid) this.trackNotificationEvent(nid, 'opened');
      onNotificationResponse?.(r);
    });
  }

  removeListeners(): void {
    if (Platform.OS === 'web' || !Notifications) return;
    if (this.notificationListener) this.notificationListener.remove?.();
    if (this.responseListener) this.responseListener.remove?.();
  }

  async getBadgeCount(): Promise<number> {
    if (Platform.OS === 'web' || !Notifications) return 0;
    return Notifications.getBadgeCountAsync();
  }

  async setBadgeCount(count: number): Promise<void> {
    if (Platform.OS === 'web' || !Notifications) return;
    await Notifications.setBadgeCountAsync(count);
  }

  async cancelAllNotifications(): Promise<void> {
    if (Platform.OS === 'web' || !Notifications) return;
    await Notifications.cancelAllScheduledNotificationsAsync();
  }

  // ──────────────────────────────────────────
  // Unregister current token from backend (call on logout)
  // ──────────────────────────────────────────
  async unregisterCurrentToken(): Promise<void> {
    if (Platform.OS === 'web') return;
    if (!this.expoPushToken) return;
    try {
      const { default: api } = await import('./api');
      await api.delete('/notifications/unregister-token', {
        data: { token: this.expoPushToken },
      });
    } catch {
      // Silently ignore — token cleanup is best-effort
    } finally {
      this.expoPushToken = null;
    }
  }
}

export const pushNotificationService = new PushNotificationService();
export default pushNotificationService;
