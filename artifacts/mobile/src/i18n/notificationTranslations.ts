/**
 * Notification translation strings & helpers.
 *
 * This module provides the same bilingual strings used by `useTranslation` but
 * as plain functions — no React hooks, safe to call from services, WebSocket
 * handlers, and background tasks that run outside React's render cycle.
 *
 * Usage:
 *   import { getNotifLang, t_notif } from '../i18n/notificationTranslations';
 *
 *   const lang = getNotifLang();                    // reads Zustand store
 *   const text = t_notif('orderReceived', lang);    // bilingual string
 */

export type NotifLang = 'ar' | 'en';

export type NotifStringKey =
  | 'orderPlacedTitle'
  | 'orderPlacedBody'
  | 'orderReceivedTitle'
  | 'statusPending'
  | 'statusPreparing'
  | 'statusShipped'
  | 'statusOutForDelivery'
  | 'statusDelivered'
  | 'statusCancelled'
  | 'stockOutTitle'
  | 'stockOutBody'
  | 'stockLowTitle'
  | 'stockLowBody'
  | 'newOrderTitle'
  | 'newOrderBody';

const STRINGS: Record<NotifStringKey, Record<NotifLang, string>> = {
  orderPlacedTitle: {
    en: 'Order Placed Successfully',
    ar: 'تم إتمام طلبك بنجاح',
  },
  orderPlacedBody: {
    en: 'Your order #{num} has been received. The restaurant will start preparing it soon.',
    ar: 'طلبك #{num} تم استلامه. سيبدأ المطعم في التحضير قريباً.',
  },
  orderReceivedTitle: {
    en: 'Order #{num}',
    ar: 'طلب #{num}',
  },
  statusPending: {
    en: 'Your order has been received and is being processed',
    ar: 'تم استلام طلبك وجاري معالجته',
  },
  statusPreparing: {
    en: 'Your order is being prepared',
    ar: 'جاري تحضير طلبك',
  },
  statusShipped: {
    en: 'Your order has been shipped',
    ar: 'تم شحن طلبك',
  },
  statusOutForDelivery: {
    en: 'Your order is out for delivery',
    ar: 'طلبك في الطريق إليك',
  },
  statusDelivered: {
    en: 'Your order has been delivered',
    ar: 'تم توصيل طلبك',
  },
  statusCancelled: {
    en: 'Your order has been cancelled',
    ar: 'تم إلغاء طلبك',
  },
  stockOutTitle: {
    en: '🔴 Out of Stock',
    ar: '🔴 نفذ المخزون',
  },
  stockOutBody: {
    en: '"{name}" is now out of stock — please restock immediately',
    ar: 'المنتج "{name}" نفذ من المخزون — يرجى إعادة التوريد فوراً',
  },
  stockLowTitle: {
    en: '🟡 Low Stock Alert',
    ar: '🟡 مخزون منخفض',
  },
  stockLowBody: {
    en: '"{name}" is running low — please review stock levels',
    ar: 'مخزون "{name}" أوشك على النفاد — راجع مستويات المخزون',
  },
  newOrderTitle: {
    en: 'New Order',
    ar: 'طلب جديد',
  },
  newOrderBody: {
    en: 'New order #{num} received',
    ar: 'تم استلام طلب جديد #{num}',
  },
};

/**
 * Translate a notification string key into the requested language.
 * Accepts an optional `vars` map for simple token substitution (`{key}`).
 */
export function t_notif(
  key: NotifStringKey,
  lang: NotifLang,
  vars?: Record<string, string>
): string {
  let str = STRINGS[key]?.[lang] ?? STRINGS[key]?.en ?? key;
  if (vars) {
    for (const [token, value] of Object.entries(vars)) {
      str = str.replace(`{${token}}`, value);
    }
  }
  return str;
}

/**
 * Read the current app language from the Zustand store without a React hook.
 * Falls back to the last value persisted in this module, then to 'en', so a
 * transient store-load failure during startup never silently flips an
 * English-speaking user's notifications to Arabic.
 */
let _lastKnownLang: NotifLang = 'en';

export function getNotifLang(): NotifLang {
  try {
    const { useAppStore } =
      require('../store/appStore') as typeof import('../store/appStore');
    const lang = useAppStore.getState().language;
    _lastKnownLang = lang === 'ar' ? 'ar' : 'en';
  } catch {
    // Store unavailable — return the last successfully-read value (default 'en').
  }
  return _lastKnownLang;
}

/**
 * Build bilingual order-status notification strings for a given status code.
 * Returns `{ title, body }` in the supplied language.
 */
export function orderStatusNotifStrings(
  orderNumber: string,
  status: string,
  lang: NotifLang
): { title: string; body: string } {
  const statusKeyMap: Record<string, NotifStringKey> = {
    pending: 'statusPending',
    preparing: 'statusPreparing',
    shipped: 'statusShipped',
    out_for_delivery: 'statusOutForDelivery',
    delivered: 'statusDelivered',
    cancelled: 'statusCancelled',
  };

  const bodyKey = statusKeyMap[status];
  const body = bodyKey
    ? t_notif(bodyKey, lang)
    : lang === 'ar'
      ? `حالة الطلب ${orderNumber}: ${status}`
      : `Order ${orderNumber} status: ${status}`;

  return {
    title: t_notif('orderReceivedTitle', lang, { num: orderNumber }),
    body,
  };
}
