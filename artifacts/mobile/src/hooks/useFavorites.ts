/**
 * Favorites Hook with React Query
 * Implements optimistic toggle for instant feedback
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '../lib/queryClient';
import { favoriteApi } from '../services/api';
import { useAppStore } from '../store/appStore';
import * as Haptics from 'expo-haptics';
import { Platform } from 'react-native';

// Get all favorites
export function useFavorites() {
  const { isAuthenticated } = useAppStore();
  
  return useQuery({
    queryKey: queryKeys.favorites.all,
    queryFn: async () => {
      const response = await favoriteApi.getAll();
      return Array.isArray(response.data) ? response.data : (response.data?.favorites || []);
    },
    enabled: isAuthenticated,
    staleTime: 60 * 1000, // 1 minute
  });
}

// Check if product is favorited
export function useIsFavorite(productId: string) {
  const { isAuthenticated } = useAppStore();
  
  return useQuery({
    queryKey: queryKeys.favorites.check(productId),
    queryFn: async () => {
      const response = await favoriteApi.check(productId);
      return response.data?.is_favorite || false;
    },
    enabled: isAuthenticated && !!productId,
    staleTime: 60 * 1000,
  });
}

// Toggle favorite with optimistic update
export function useToggleFavorite() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (productId: string) => favoriteApi.toggle(productId),
    onMutate: async (productId) => {
      // Haptic feedback
      if (Platform.OS !== 'web') {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      }
      
      // Cancel outgoing refetches
      await queryClient.cancelQueries({ queryKey: queryKeys.favorites.check(productId) });
      await queryClient.cancelQueries({ queryKey: queryKeys.favorites.all });
      
      // Snapshot previous values
      const previousCheck = queryClient.getQueryData(queryKeys.favorites.check(productId));
      const previousAll = queryClient.getQueryData(queryKeys.favorites.all);
      
      // Optimistic toggle
      queryClient.setQueryData(queryKeys.favorites.check(productId), (old: boolean) => !old);
      
      // Optimistic update list
      queryClient.setQueryData(queryKeys.favorites.all, (old: any[]) => {
        if (!old) return old;
        const exists = old.some((f: any) => f.product_id === productId);
        if (exists) {
          return old.filter((f: any) => f.product_id !== productId);
        } else {
          return [...old, { product_id: productId }];
        }
      });
      
      return { previousCheck, previousAll };
    },
    onError: (err, productId, context) => {
      // Rollback
      if (context?.previousCheck !== undefined) {
        queryClient.setQueryData(queryKeys.favorites.check(productId), context.previousCheck);
      }
      if (context?.previousAll) {
        queryClient.setQueryData(queryKeys.favorites.all, context.previousAll);
      }
    },
    onSettled: (data, error, productId) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.favorites.check(productId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.favorites.all });
    },
  });
}
