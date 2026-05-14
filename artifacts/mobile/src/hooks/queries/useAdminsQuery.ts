/**
 * Admins Query Hook with React Query
 * Provides data fetching for admins with caching and mutations
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { adminApi } from '../../services/api';
import { useAppStore } from '../../store/appStore';

// Query keys for admins
export const adminsKeys = {
  all: ['admins'] as const,
  detail: (id: string) => ['admins', 'detail', id] as const,
  products: (id: string) => ['admins', 'products', id] as const,
};

/**
 * Hook to fetch all admins
 */
export function useAdminsQuery() {
  const setAdmins = useAppStore((state) => state.setAdmins);

  return useQuery({
    queryKey: adminsKeys.all,
    queryFn: async () => {
      const response = await adminApi.getAll();
      const admins = response.data || [];
      // Sync to Zustand store
      setAdmins(admins);
      return admins;
    },
    staleTime: 2 * 60 * 1000, // 2 minutes
  });
}

/**
 * Hook to fetch admin products
 */
export function useAdminProductsQuery(adminId: string | null) {
  return useQuery({
    queryKey: adminsKeys.products(adminId || ''),
    queryFn: async () => {
      if (!adminId) return [];
      const response = await adminApi.getProducts(adminId);
      return response.data || [];
    },
    enabled: !!adminId,
    staleTime: 60 * 1000, // 1 minute
  });
}

/**
 * Hook for admin mutations (create, update, delete)
 */
export function useAdminMutations() {
  const queryClient = useQueryClient();
  const admins = useAppStore((state) => state.admins);
  const setAdmins = useAppStore((state) => state.setAdmins);

  // Create admin
  const createAdmin = useMutation({
    mutationFn: ({ email, name }: { email: string; name?: string }) =>
      adminApi.create(email, name),
    onMutate: async ({ email, name }) => {
      await queryClient.cancelQueries({ queryKey: adminsKeys.all });
      const previousAdmins = queryClient.getQueryData(adminsKeys.all);
      
      // Optimistic update
      const tempId = `temp-${Date.now()}`;
      const optimisticAdmin = {
        id: tempId,
        email,
        name: name || email.split('@')[0],
        revenue: 0,
        products_added: 0,
        products_delivered: 0,
        products_processing: 0,
      };
      
      const newAdmins = [...admins, optimisticAdmin];
      setAdmins(newAdmins);
      queryClient.setQueryData(adminsKeys.all, newAdmins);
      
      return { previousAdmins, tempId };
    },
    onError: (err, variables, context) => {
      if (context?.previousAdmins) {
        setAdmins(context.previousAdmins as any[]);
        queryClient.setQueryData(adminsKeys.all, context.previousAdmins);
      }
    },
    onSuccess: (data, variables, context) => {
      // Replace temp with real data
      const updatedAdmins = admins
        .filter((a: any) => a.id !== context?.tempId)
        .concat(data.data);
      setAdmins(updatedAdmins);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: adminsKeys.all });
    },
  });

  // Delete admin
  const deleteAdmin = useMutation({
    mutationFn: (adminId: string) => adminApi.delete(adminId),
    onMutate: async (adminId) => {
      await queryClient.cancelQueries({ queryKey: adminsKeys.all });
      const previousAdmins = [...admins];
      
      // Optimistic removal
      const newAdmins = admins.filter((a: any) => a.id !== adminId);
      setAdmins(newAdmins);
      queryClient.setQueryData(adminsKeys.all, newAdmins);
      
      return { previousAdmins };
    },
    onError: (err, adminId, context) => {
      if (context?.previousAdmins) {
        setAdmins(context.previousAdmins);
        queryClient.setQueryData(adminsKeys.all, context.previousAdmins);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: adminsKeys.all });
    },
  });

  // Clear revenue
  const clearRevenue = useMutation({
    mutationFn: (adminId: string) => adminApi.clearRevenue(adminId),
    onMutate: async (adminId) => {
      await queryClient.cancelQueries({ queryKey: adminsKeys.all });
      const previousAdmins = [...admins];
      
      // Optimistic update
      const newAdmins = admins.map((a: any) =>
        a.id === adminId ? { ...a, revenue: 0 } : a
      );
      setAdmins(newAdmins);
      queryClient.setQueryData(adminsKeys.all, newAdmins);
      
      return { previousAdmins };
    },
    onError: (err, adminId, context) => {
      if (context?.previousAdmins) {
        setAdmins(context.previousAdmins);
        queryClient.setQueryData(adminsKeys.all, context.previousAdmins);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: adminsKeys.all });
    },
  });

  return {
    createAdmin,
    deleteAdmin,
    clearRevenue,
  };
}

export default useAdminsQuery;
