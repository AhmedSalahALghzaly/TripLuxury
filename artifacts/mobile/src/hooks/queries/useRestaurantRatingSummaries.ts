import { useQuery } from '@tanstack/react-query';
import { ratingsApi } from '../../services/api';

export interface RatingSummary {
  restaurant_id: string;
  avg_rating: number;
  review_count: number;
}

export const ratingSummaryKeys = {
  batch: (ids: string[]) => ['ratingSummary', ...ids.slice().sort()] as const,
};

export function useRestaurantRatingSummaries(restaurantIds: string[]) {
  const sorted = restaurantIds.slice().sort();
  return useQuery({
    queryKey: ratingSummaryKeys.batch(sorted),
    queryFn: async (): Promise<Record<string, RatingSummary>> => {
      if (sorted.length === 0) return {};
      const res = await ratingsApi.getSummary(sorted);
      const map: Record<string, RatingSummary> = {};
      for (const row of res.data) {
        map[row.restaurant_id] = row;
      }
      return map;
    },
    enabled: restaurantIds.length > 0,
    staleTime: 2 * 60 * 1000,
  });
}
