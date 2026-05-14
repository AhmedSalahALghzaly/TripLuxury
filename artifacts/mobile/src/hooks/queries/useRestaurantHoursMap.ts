import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../services/api';
import { useAppStore } from '../../store/appStore';
import type { DayHours } from '../../utils/timeUtils';

export const restaurantHoursKeys = {
  bulk: (ids: string[]) => ['restaurant-hours-bulk', ids.slice().sort().join(',')],
};

export function useRestaurantHoursMap(ids: string[]): Record<string, DayHours[]> {
  const sortedKey = ids.slice().sort().join(',');

  const cachedMap = useAppStore((state) => state.restaurantHoursMap);
  const setRestaurantHoursMap = useAppStore((state) => state.setRestaurantHoursMap);

  const { data } = useQuery<Record<string, DayHours[]>>({
    queryKey: restaurantHoursKeys.bulk(ids),
    queryFn: async () => {
      if (!sortedKey) return {};
      const res = await api.get('/car-models/hours/bulk', { params: { ids: sortedKey } });
      return (res.data ?? {}) as Record<string, DayHours[]>;
    },
    enabled: ids.length > 0,
    staleTime: 5 * 60 * 1000,
  });

  useEffect(() => {
    if (data && Object.keys(data).length > 0) {
      setRestaurantHoursMap(data);
    }
  }, [data, setRestaurantHoursMap]);

  if (!ids.length) return {};

  const merged: Record<string, DayHours[]> = {};
  for (const id of ids) {
    const fresh = data?.[id];
    const cached = cachedMap[id];
    if (fresh) {
      merged[id] = fresh;
    } else if (cached) {
      merged[id] = cached;
    }
  }
  return merged;
}
