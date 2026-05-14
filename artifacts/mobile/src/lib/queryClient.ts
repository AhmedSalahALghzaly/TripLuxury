/**
 * React Query (TanStack Query) Configuration
 * Optimized for Al-Ghazaly Auto Parts with smart caching
 * ENHANCED: Centralized error handling with intelligent retry logic
 */
import { QueryClient } from '@tanstack/react-query';
import { parseError } from '../hooks/useErrorHandler';

// Create QueryClient with optimized settings and error handling
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Data considered fresh for 2 minutes
      staleTime: 2 * 60 * 1000,
      // Cache kept for 10 minutes
      gcTime: 10 * 60 * 1000,
      // Intelligent retry based on error type
      retry: (failureCount, error: any) => {
        const parsed = parseError(error);
        // Only retry network and server errors, max 3 times
        if (parsed.category === 'auth') return false;
        if (parsed.category === 'validation') return false;
        return parsed.retryable && failureCount < 3;
      },
      retryDelay: (attemptIndex, error: any) => {
        const parsed = parseError(error);
        // Network errors: quicker retry with jitter
        if (parsed.category === 'network') {
          const base = Math.min(1000 * Math.pow(2, attemptIndex), 10000);
          return base + Math.random() * 500;
        }
        // Server errors: slower retry
        return Math.min(2000 * Math.pow(2, attemptIndex), 30000);
      },
      // Don't refetch on window focus for mobile
      refetchOnWindowFocus: false,
      // Refetch on reconnect
      refetchOnReconnect: true,
    },
    mutations: {
      // Intelligent retry for mutations
      retry: (failureCount, error: any) => {
        const parsed = parseError(error);
        // Don't retry auth or validation errors
        if (parsed.category === 'auth' || parsed.category === 'validation') {
          return false;
        }
        // Retry network/server errors once
        return parsed.retryable && failureCount < 1;
      },
    },
  },
});

// Query keys factory for type-safe and organized keys
export const queryKeys = {
  // Products
  products: {
    all: ['products'] as const,
    list: (filters?: Record<string, unknown>) => ['products', 'list', filters] as const,
    detail: (id: string) => ['products', 'detail', id] as const,
    search: (query: string) => ['products', 'search', query] as const,
  },
  // Categories
  categories: {
    all: ['categories'] as const,
    tree: ['categories', 'tree'] as const,
  },
  // Car Brands
  carBrands: {
    all: ['carBrands'] as const,
  },
  // Car Models
  carModels: {
    all: ['carModels'] as const,
    byBrand: (brandId: string) => ['carModels', 'brand', brandId] as const,
  },
  // Product Brands
  productBrands: {
    all: ['productBrands'] as const,
  },
  // Orders
  orders: {
    all: ['orders'] as const,
    admin: ['orders', 'admin'] as const,
    detail: (id: string) => ['orders', 'detail', id] as const,
    userOrders: (userId: string) => ['orders', 'user', userId] as const,
  },
  // Cart
  cart: {
    current: ['cart'] as const,
  },
  // Favorites
  favorites: {
    all: ['favorites'] as const,
    check: (productId: string) => ['favorites', 'check', productId] as const,
  },
  // Customers (Admin)
  customers: {
    all: ['customers'] as const,
    detail: (id: string) => ['customers', 'detail', id] as const,
  },
  // Bundle Offers
  bundleOffers: {
    all: ['bundleOffers'] as const,
    active: ['bundleOffers', 'active'] as const,
  },
  // Delta Sync
  deltaSync: {
    products: (lastSync?: string) => ['deltaSync', 'products', lastSync] as const,
    categories: (lastSync?: string) => ['deltaSync', 'categories', lastSync] as const,
    full: (lastSync?: string, tables?: string) => ['deltaSync', 'full', lastSync, tables] as const,
  },
  // Analytics
  analytics: {
    overview: (startDate?: string, endDate?: string) => ['analytics', 'overview', startDate, endDate] as const,
  },
  // Suppliers
  suppliers: {
    all: ['suppliers'] as const,
    detail: (id: string) => ['suppliers', 'detail', id] as const,
  },
  // Distributors
  distributors: {
    all: ['distributors'] as const,
    detail: (id: string) => ['distributors', 'detail', id] as const,
  },
};

export default queryClient;
