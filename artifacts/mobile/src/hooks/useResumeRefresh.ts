/**
 * useResumeRefresh — when the app transitions from non-live (background or
 * offline) back to live (foreground + online), invalidate high-value React
 * Query caches so screens refresh immediately instead of showing stale data
 * until their next natural refetch.
 *
 * The WebSocket reconnect handler already fires its own `reconnect_sweep`,
 * but caches that aren't tied to WS events (analytics summaries, ratings,
 * push-log unread counts, orders lists) need a manual nudge.
 */
import { useEffect, useRef } from 'react';
import { useQueryClient, type QueryKey } from '@tanstack/react-query';
import { useAppLiveness } from './useAppLiveness';

const RESUME_INVALIDATION_KEYS: readonly QueryKey[] = [
  // Owner / restaurant-admin caches
  ['ra-orders'],
  ['ra-stats'],
  ['ra-ratings'],
  ['ra-appts'],
  ['ra-restaurants'],
  ['push-log-unread-count'],
  ['push-log-unread-stock'],
  ['push-log-unread-oos'],
  ['push-log-unread-neworder'],
  // Customer-facing caches. Invalidating the root prefix cascades to all
  // sub-keys (lists, details, by-id variants) thanks to React Query's
  // hierarchical key matching.
  ['shoppingHub'],
  ['orders'],
  ['cart'],
  ['favorites'],
  ['products'],
  ['categories'],
  ['homeScreen'],
  ['promotions'],
  ['marketing'],
  ['bundleOffers'],
  ['ratings-distribution'],
  ['public-ratings'],
  ['ratingSummary'],
  ['footer-config'],
  ['suppliers'],
];

export function useResumeRefresh(): void {
  const qc = useQueryClient();
  const { isLive } = useAppLiveness();
  const wasLive = useRef(isLive);

  useEffect(() => {
    const prev = wasLive.current;
    wasLive.current = isLive;
    if (prev || !isLive) return;

    for (const queryKey of RESUME_INVALIDATION_KEYS) {
      qc.invalidateQueries({ queryKey });
    }
  }, [isLive, qc]);
}
