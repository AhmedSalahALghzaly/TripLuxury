/**
 * useHoursBackgroundRefresh — silently re-fetches restaurant opening hours
 * when the app comes to the foreground and the cached data is stale.
 *
 * Motivation: useRestaurantHoursMap refreshes the cache when a screen that
 * calls it mounts, but if the user skips those screens (e.g. goes straight to
 * GlobalSearch), the open/closed status can be hours out of date.  This hook
 * runs at the app root so the cache stays fresh regardless of which screens
 * the user visits.
 *
 * Strategy:
 *  - Watch AppState via useAppLiveness (foreground transition detection).
 *  - On each background → foreground transition, compare Date.now() against
 *    the stored restaurantHoursMapFetchedAt timestamp.
 *  - If the gap exceeds STALE_THRESHOLD_MS (30 minutes), and the cache
 *    contains at least one restaurant ID, call qc.fetchQuery to immediately
 *    execute a bulk hours request regardless of whether any subscriber is
 *    currently mounted.  This is stronger than invalidation: the HTTP request
 *    fires eagerly, the result is placed into the React Query cache (so
 *    mounted screens pick it up automatically), and the Zustand store is
 *    updated via setRestaurantHoursMap — which also stamps the new
 *    restaurantHoursMapFetchedAt so subsequent foreground transitions are not
 *    re-fetched until another 30 minutes elapses.
 *  - Network failures are silently swallowed; the stale cached data remains
 *    in place so the UI never breaks due to a background fetch error.
 */
import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAppLiveness } from './useAppLiveness';
import { useAppStore } from '../store/appStore';
import { restaurantHoursKeys } from './queries/useRestaurantHoursMap';
import { api } from '../services/api';
import type { DayHours } from '../utils/timeUtils';

const STALE_THRESHOLD_MS = 30 * 60 * 1000;

export function useHoursBackgroundRefresh(): void {
  const qc = useQueryClient();
  const { isForeground } = useAppLiveness();
  const wasForeground = useRef(isForeground);

  useEffect(() => {
    const prev = wasForeground.current;
    wasForeground.current = isForeground;

    // Only act on background → foreground transitions
    if (prev || !isForeground) return;

    const { restaurantHoursMap, restaurantHoursMapFetchedAt, setRestaurantHoursMap } =
      useAppStore.getState();

    const knownIds = Object.keys(restaurantHoursMap);
    if (!knownIds.length) return;

    const fetchedAt = restaurantHoursMapFetchedAt ?? 0;
    const ageMs = Date.now() - fetchedAt;
    if (ageMs < STALE_THRESHOLD_MS) return;

    // Cache is stale — perform a silent bulk re-fetch directly so the Zustand
    // store is updated even when no screen is currently mounted that calls
    // useRestaurantHoursMap.  We also prime the React Query cache so any
    // mounted subscribers get the fresh data immediately.
    const sortedIds = knownIds.slice().sort();
    const queryKey = restaurantHoursKeys.bulk(sortedIds);

    qc.fetchQuery<Record<string, DayHours[]>>({
      queryKey,
      queryFn: async () => {
        const res = await api.get('/car-models/hours/bulk', {
          params: { ids: sortedIds.join(',') },
        });
        return (res.data ?? {}) as Record<string, DayHours[]>;
      },
      staleTime: STALE_THRESHOLD_MS,
    }).then((data) => {
      if (data && Object.keys(data).length > 0) {
        setRestaurantHoursMap(data);
      }
    }).catch(() => {
      // Silent — stale cache is better than crashing on a background network error
    });
  }, [isForeground, qc]);
}
