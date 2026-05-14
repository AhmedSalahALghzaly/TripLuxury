/**
 * useMissedPushLogNotifications
 *
 * Complements `useMissedOrderNotifications` by querying the server-side
 * push_notification_log for order status changes that were recorded while
 * the app was fully closed or offline, and that the client has not yet
 * acknowledged.
 *
 * Flow:
 *  1. On cold start (when the user is authenticated) fetch all unacknowledged
 *     `order_updated` entries from `GET /api/notifications/my-push-log`
 *     that arrived since the last-processed cursor (stored in AsyncStorage).
 *     When no cursor exists, all unacknowledged entries are fetched with no
 *     time restriction.
 *  2. On every foreground transition, repeat the fetch.
 *  3. For each entry, in a per-entry try/catch:
 *     a. Fire a bilingual local OS notification via `sendOrderStatusNotification`.
 *     b. Call `updateStoredOrderStatus` (from useMissedOrderNotifications) so
 *        the companion order-comparison hook sees this status as already known
 *        and does not emit a duplicate local notification.
 *     c. Acknowledge the entry via PATCH so the server won't return it again.
 *     d. Record its sent_at as the latest successfully handled timestamp.
 *  4. After the loop, advance the `since` cursor to 1 ms after the highest
 *     sent_at of entries that were fully and successfully handled. Entries that
 *     failed mid-processing remain unacknowledged; they will be returned again
 *     on the next foreground fetch because `unread_only=true` is always set.
 *     The cursor is NOT moved when no entries were processed successfully.
 *
 * Correctness guarantees:
 *  - Cursor advances only after successful per-entry processing → no data-loss
 *    on partial failure.
 *  - `unread_only=true` is always set → acknowledged entries are never returned
 *    again regardless of the cursor value.
 *  - `updateStoredOrderStatus` deduplicates against the order-comparison hook.
 *
 * The hook is a no-op for unauthenticated users and swallows all errors so
 * it can never disrupt the normal app flow.
 */
import { useEffect, useRef } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAppStore } from '../store/appStore';
import { subscribeAppLiveness, getAppLivenessSnapshot } from './useAppLiveness';
import { updateStoredOrderStatus } from './useMissedOrderNotifications';
import { queueMissedNotifReplay } from './missedNotifQueue';

// ─── Types ────────────────────────────────────────────────────────────────────

interface PushLogEntry {
  id: string;
  event_type: string;
  title: string;
  body: string;
  payload: {
    order_id?: string;
    order_number?: string;
    new_status?: string;
    previous_status?: string;
    user_id?: string;
  };
  sent_at: string;
  acknowledged_at: string | null;
}

// ─── AsyncStorage key (user-scoped) ──────────────────────────────────────────

function storageKey(userId: string): string {
  return `missed_push_log_since_v1:${userId}`;
}

async function loadSinceCursor(userId: string): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(storageKey(userId));
  } catch {
    return null;
  }
}

async function saveSinceCursor(userId: string, iso: string): Promise<void> {
  try {
    await AsyncStorage.setItem(storageKey(userId), iso);
  } catch {
    // Best-effort.
  }
}

// ─── Core replay logic ────────────────────────────────────────────────────────

async function replayMissedPushLog(userId: string): Promise<void> {
  try {
    const { default: api } = await import('../services/api');

    const since = await loadSinceCursor(userId);

    // Always filter to unacknowledged entries only.
    const params: Record<string, string> = { unread_only: 'true' };
    if (since) {
      // Only request entries newer than the last successfully processed one.
      params.since = since;
    }
    // When no cursor exists (first run), no `since` is passed → fetch ALL
    // unacknowledged entries for this user with no time restriction.

    const res = await api.get<{ data: PushLogEntry[] }>(
      '/notifications/my-push-log',
      { params },
    );

    const entries: PushLogEntry[] = Array.isArray(res.data?.data) ? res.data.data : [];

    if (!entries.length) return;

    const { pushNotificationService } = await import('../services/pushNotificationService');

    // Track the highest sent_at of entries that were fully and successfully
    // processed (notified + deduped + acknowledged).  The cursor only advances
    // this far after the loop so that any mid-loop failure leaves unprocessed
    // entries below the cursor and therefore still returned on the next fetch.
    let latestHandledMs = 0;

    for (const entry of entries) {
      // Per-entry isolation: a failure here does not abort subsequent entries.
      try {
        if (entry.event_type === 'order_updated' && entry.payload?.new_status) {
          const orderId = entry.payload.order_id ?? '';
          const orderNumber = entry.payload.order_number ?? orderId.slice(-8);
          const status = entry.payload.new_status;

          if (orderId && status) {
            const lang: 'ar' | 'en' =
              useAppStore.getState().language === 'en' ? 'en' : 'ar';

            await pushNotificationService.sendOrderStatusNotification(
              orderId,
              orderNumber,
              status,
              lang,
            );

            // Prevent the order-comparison hook from firing a duplicate local
            // notification for the same status change.
            await updateStoredOrderStatus(userId, orderId, status);
          }
        }

        // Acknowledge regardless of event_type so the server stops returning
        // entries we have already seen, even if they weren't order_updated.
        await api.patch(`/notifications/my-push-log/${entry.id}/acknowledge`);

        // Only count this entry as "handled" after both notification and ack
        // have completed successfully.
        const entryMs = new Date(entry.sent_at).getTime();
        if (!isNaN(entryMs) && entryMs > latestHandledMs) {
          latestHandledMs = entryMs;
        }
      } catch {
        // Entry-level failure: skip to next. This entry remains unacknowledged
        // on the server and will be returned again on the next foreground fetch.
      }
    }

    // Advance the cursor only after the loop and only as far as the highest
    // entry we successfully handled. Any entries we failed to handle remain
    // unacknowledged and will be returned again by `unread_only=true` on the
    // next fetch regardless of the cursor (the cursor is a performance hint,
    // not a correctness gate — acknowledged entries never reappear).
    if (latestHandledMs > 0) {
      await saveSinceCursor(userId, new Date(latestHandledMs + 1).toISOString());
    }
  } catch {
    // Best-effort — errors must never interrupt the app flow.
  }
}

// ─── React hook ──────────────────────────────────────────────────────────────

export function useMissedPushLogNotifications(): void {
  const user = useAppStore((state) => state.user);
  const userIdRef = useRef<string | undefined>(user?.id);

  useEffect(() => {
    userIdRef.current = user?.id;
  }, [user?.id]);

  // ── Cold-start / login replay ─────────────────────────────────────────────
  // Runs once per authenticated session. Enqueued AFTER the order-comparison
  // hook's cold-start task via the shared sequential queue, so by the time
  // this replay executes the status map already reflects any changes the
  // order-comparison hook found — preventing duplicate local notifications.
  useEffect(() => {
    if (!user?.id) return;
    const uid = user.id;
    queueMissedNotifReplay(() => replayMissedPushLog(uid));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  // ── Foreground-transition replay ──────────────────────────────────────────
  // Catches entries that arrived while the app was backgrounded or offline.
  // Uses a module-level subscription so it doesn't re-subscribe on every render.
  useEffect(() => {
    let wasLive = getAppLivenessSnapshot().isLive;

    const unsubscribe = subscribeAppLiveness(() => {
      const { isLive } = getAppLivenessSnapshot();
      const justCameForward = !wasLive && isLive;
      wasLive = isLive;

      if (justCameForward) {
        const uid = userIdRef.current;
        if (uid) {
          queueMissedNotifReplay(() => replayMissedPushLog(uid));
        }
      }
    });

    return unsubscribe;
  }, []);
}
