/**
 * Auth Store - Handles authentication state
 * Split from monolithic appStore for better performance
 * Includes real-time role synchronization with backend
 */
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';

export type UserRole = 'guest' | 'user' | 'subscriber' | 'admin' | 'partner' | 'owner';

export interface User {
  id: string;
  email: string;
  name: string;
  picture?: string;
  is_admin?: boolean;
  role?: UserRole;
}

interface AuthState {
  user: User | null;
  sessionToken: string | null;
  isAuthenticated: boolean;
  userRole: UserRole;
  _hasHydrated: boolean;
  lastRoleRefresh: number | null;

  // Actions
  setUser: (user: User | null, token?: string | null) => void;
  setSessionToken: (token: string | null) => void;
  setUserRole: (role: UserRole) => void;
  setHasHydrated: (hydrated: boolean) => void;
  logout: () => void;
  refreshUserFromServer: () => Promise<void>;
  updateUserRole: (role: UserRole) => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      sessionToken: null,
      isAuthenticated: false,
      userRole: 'guest',
      _hasHydrated: false,
      lastRoleRefresh: null,

      setUser: (user, token = null) => {
        set({
          user,
          sessionToken: token || get().sessionToken,
          isAuthenticated: !!user,
          userRole: user?.role || 'user',
        });
      },

      setSessionToken: (token) => set({ sessionToken: token }),

      setUserRole: (role) => set({ userRole: role }),

      setHasHydrated: (hydrated) => set({ _hasHydrated: hydrated }),

      logout: () => {
        set({
          user: null,
          sessionToken: null,
          isAuthenticated: false,
          userRole: 'guest',
          lastRoleRefresh: null,
        });
      },

      // Refresh user role from server - call this on app focus/login
      refreshUserFromServer: async () => {
        const { isAuthenticated } = get();
        if (!isAuthenticated) return;
        
        try {
          const response = await fetch('/api/auth/me', {
            credentials: 'include',
          });
          
          if (response.ok) {
            const data = await response.json();
            if (data.user) {
              const serverRole = data.user.role || 'user';
              set({
                user: {
                  ...get().user!,
                  ...data.user,
                  role: serverRole,
                },
                userRole: serverRole,
                lastRoleRefresh: Date.now(),
              });
            }
          }
        } catch (error) {
          console.log('Failed to refresh user from server:', error);
        }
      },

      // Update user role immediately (for local optimistic updates)
      updateUserRole: (role) => {
        const { user } = get();
        if (user) {
          set({
            user: { ...user, role },
            userRole: role,
          });
        }
      },
    }),
    {
      name: 'alghazaly-auth-store',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({
        user: state.user,
        sessionToken: state.sessionToken,
        isAuthenticated: state.isAuthenticated,
        userRole: state.userRole,
        lastRoleRefresh: state.lastRoleRefresh,
      }),
      onRehydrateStorage: () => (state) => {
        if (state) {
          state.setHasHydrated(true);
          // Refresh user role from server on app startup
          setTimeout(() => {
            state.refreshUserFromServer();
          }, 1000);
        }
      },
    }
  )
);

// Selectors
export const useUser = () => useAuthStore((state) => state.user);
export const useIsAuthenticated = () => useAuthStore((state) => state.isAuthenticated);
export const useUserRole = () => useAuthStore((state) => state.userRole);
export const useHasHydrated = () => useAuthStore((state) => state._hasHydrated);
export const useRefreshUser = () => useAuthStore((state) => state.refreshUserFromServer);

export const useCanAccessOwnerInterface = () => {
  const userRole = useAuthStore((state) => state.userRole);
  return userRole === 'owner' || userRole === 'partner';
};

// Admin panel access check - includes admin role
export const useCanAccessAdminPanel = () => {
  const userRole = useAuthStore((state) => state.userRole);
  const user = useAuthStore((state) => state.user);
  const isAdmin = ['owner', 'partner', 'admin'].includes(userRole);
  // Also check is_admin flag for backwards compatibility
  return isAdmin || user?.is_admin === true;
};

export default useAuthStore;
