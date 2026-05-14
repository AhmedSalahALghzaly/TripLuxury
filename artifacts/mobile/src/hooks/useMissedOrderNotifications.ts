/**
 * useMissedOrderNotifications
 *
 * Fires bilingual local OS notifications for order status changes that
 * occurred while the app was backgrounded, closed, or offline — a gap that
 * the live WebSocket cannot fill because it is only connected in foreground.
 *
 * How it works:
 *  - Maintains a per-user AsyncStorage map of { orderId → lastKnownStatus }.
 *  - On cold start **and** every foreground transition, fetches the user's
 *    own orders and compares against the stored statuses.
 *  - Fires a bilingual local notification for each order whose status changed.
 *  - Persists the updated status map so subsequent replays are idempotent.
 *
 * Duplicate-prevention:
 *  - When the WebSocket fires a real-time order-status notification while the
 *    app is live, `updateStoredOrderStatus()` is called immediately so the
 *    replay pass never re-fires the same change.
 *
 * The hook is a no-op for unauthenticated users and swallows all errors so
 * it can never interrupt the normal app flow.
 */
import { useEffect, useRef } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAppStore } from '../store/appStore';
import { subscribeAppLiveness, getAppLivenessSnapshot } from './useAppLiveness';
import { getNotifLang, orderStatusNotifStrings } from '../i18n/notificationTranslations';
import { queueMissedNotifReplay } from './missedNotifQueue';

// ─── Types ────────────────────────────────────────────────────────────────────

interface OrderRow {
  id: string;
  order_number: string;
  status: string;
}

type StatusMap = Record<string, string>;

// ─── Storage helpers (user-scoped to prevent cross-account contamination) ────

function storageKey(userId: string): string {
  return `missed_notif_order_statuses_v1:${userId}`;
}

async function loadStatusMap(userId: string): Promise<StatusMap> {
  try {
    const raw = await AsyncStorage.getItem(storageKey(userId));
    return raw ? (JSON.parse(raw) as StatusMap) : {};
  } catch {
    return {};
  }
}

async function saveStatusMap(userId: string, map: StatusMap): Promise<void> {
  try {
    await AsyncStorage.setItem(storageKey(userId), JSON.stringify(map));
  } catch {
    // Best-effort — storage failures must not surface to the user.
  }
}

// ─── Public API: called by the WebSocket handler to keep status map fresh ────

/**
 * Call this whenever the live WebSocket fires an order-status notification so
 * the replay pass never re-fires the same change as a "missed" notification.
 */
export async function updateStoredOrderStatus(
  userId: string,
  orderId: string,
  newStatus: string
): Promise<void> {
  try {
    const map = await loadStatusMap(userId);
    map[orderId] = newStatus;
    await saveStatusMap(userId, map);
  } catch {
    // Best-effort.
  }
}

// ─── Core replay logic ────────────────────────────────────────────────────────

function parseOrderRow(raw: unknown): OrderRow | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const id = r.id != null ? String(r.id) : '';
  const order_number = r.order_number != null ? String(r.order_number) : id;
  const status = r.status != null ? String(r.status) : '';
  if (!id || !status) return null;
  return { id, order_number, status };
}

/**
 * Fetch the authenticated user's own orders.
 * The /orders endpoint returns only orders belonging to the session user
 * (server-side enforced), so `userId` is used only as a semantic label
 * for logging/storage — no client-side filter is required.
 */
async function fetchOrders(_userId: string): Promise<OrderRow[]> {
  try {
    const { default: api } = await import('../services/api');
    // Fetch recent orders — 200 covers the vast majority of active order
    // histories; the server-side enforced auth boundary ensures only the
    // session user's orders are returned.
    const res = await api.get<unknown>('/orders', { params: { limit: 200 } });
    const raw: unknown = res.data;
    const rows: unknown[] = Array.isArray(raw)
      ? raw
      : Array.isArray((raw as Record<string, unknown>)?.data)
        ? (raw as Record<string, unknown[]>).data
        : [];
    return rows.reduce<OrderRow[]>((acc, row) => {
      const parsed = parseOrderRow(row);
      if (parsed) acc.push(parsed);
      return acc;
    }, []);
  } catch {
    return [];
  }
}

async function replayMissedNotifications(userId: string): Promise<void> {
  const [orders, storedMap] = await Promise.all([
    fetchOrders(userId),
    loadStatusMap(userId),
  ]);

  if (!orders.length) return;

  const lang = getNotifLang();
  const newMap: StatusMap = { ...storedMap };
  const changed: OrderRow[] = [];

  for (const order of orders) {
    const lastKnown = storedMap[order.id];
    if (lastKnown !== order.status) {
      // Only notify if we had a previously-known status to compare against.
      // (New orders with no stored status are not "missed" notifications.)
      if (lastKnown !== undefined) {
        changed.push(order);
      }
      newMap[order.id] = order.status;
    }
  }

  // Always persist the updated map — even when there are no changes — so
  // newly-placed orders get seeded into the map for future comparisons.
  await saveStatusMap(userId, newMap);

  if (!changed.length) return;

  try {
    const { pushNotificationService } = await import('../services/pushNotificationService');
    for (const order of changed) {
      const { title, body } = orderStatusNotifStrings(order.order_number, order.status, lang);
      await pushNotificationService.scheduleLocalNotification({
        title,
        body,
        data: {
          orderId: order.id,
          orderNumber: order.order_number,
          status: order.status,
          type: 'order_status',
        },
      });
    }
  } catch {
    // Best-effort — notification failures must not block the resume flow.
  }
}

// ─── React hook ──────────────────────────────────────────────────────────────

export function useMissedOrderNotifications(): void {
  const user = useAppStore((state) => state.user);
  const userIdRef = useRef<string | undefined>(user?.id);

  // Keep the ref up-to-date without re-running downstream effects.
  useEffect(() => {
    userIdRef.current = user?.id;
  }, [user?.id]);

  // ── Cold-start / login replay ─────────────────────────────────────────────
  // Runs once per authenticated session. Catches missed notifications from
  // when the app was fully closed — the liveness-transition path below cannot
  // catch this because the app starts with `wasLive = isLive` (no transition).
  // Uses the shared sequential queue so this replay completes before the
  // push-log replay hook starts, preventing duplicate local notifications.
  useEffect(() => {
    if (!user?.id) return;
    const uid = user.id;
    queueMissedNotifReplay(() => replayMissedNotifications(uid));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  // ── Foreground-transition replay ──────────────────────────────────────────
  // Catches status changes that occurred while the app was backgrounded
  // (alive in memory but not visible). Uses the module-level liveness
  // subscription so it doesn't re-subscribe on every render.
  useEffect(() => {
    let wasLive = getAppLivenessSnapshot().isLive;

    const unsubscribe = subscribeAppLiveness(() => {
      const { isLive } = getAppLivenessSnapshot();
      const justCameForward = !wasLive && isLive;
      wasLive = isLive;

      if (justCameForward) {
        const uid = userIdRef.current;
        if (uid) {
          queueMissedNotifReplay(() => replayMissedNotifications(uid));
        }
      }
    });

    return unsubscribe;
  }, []);
}
