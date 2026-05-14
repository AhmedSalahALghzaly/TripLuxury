/**
 * Centralized Error Handling Hook
 * OPTIMIZED: Unified error handling for React Query across the app
 * v1.0.0
 * 
 * Features:
 * - Centralized error formatting
 * - Automatic retry logic based on error type
 * - Error categorization (network, auth, validation, server)
 * - User-friendly error messages in AR/EN
 * - Integration with Toast notifications
 */
import { useCallback, useMemo } from 'react';
import { useTranslation } from './useTranslation';
import { useAppStore } from '../store/appStore';
import { QueryClient } from '@tanstack/react-query';

// Error categories
export type ErrorCategory = 'network' | 'auth' | 'validation' | 'server' | 'unknown';

// Error structure
export interface FormattedError {
  category: ErrorCategory;
  code: string;
  message: string;
  messageAr: string;
  retryable: boolean;
  details?: any;
}

// HTTP status to category mapping
const STATUS_CATEGORY_MAP: Record<number, ErrorCategory> = {
  400: 'validation',
  401: 'auth',
  403: 'auth',
  404: 'validation',
  422: 'validation',
  429: 'network', // Rate limiting
  500: 'server',
  502: 'server',
  503: 'server',
  504: 'network',
};

// Retryable error codes
const RETRYABLE_CATEGORIES: ErrorCategory[] = ['network', 'server'];

// User-friendly messages
const ERROR_MESSAGES: Record<ErrorCategory, { en: string; ar: string }> = {
  network: {
    en: 'Connection error. Please check your internet.',
    ar: 'خطأ في الاتصال. يرجى التحقق من الإنترنت.',
  },
  auth: {
    en: 'Authentication required. Please log in again.',
    ar: 'مطلوب تسجيل الدخول. يرجى تسجيل الدخول مرة أخرى.',
  },
  validation: {
    en: 'Invalid request. Please check your input.',
    ar: 'طلب غير صالح. يرجى التحقق من البيانات.',
  },
  server: {
    en: 'Server error. Please try again later.',
    ar: 'خطأ في الخادم. يرجى المحاولة لاحقاً.',
  },
  unknown: {
    en: 'An unexpected error occurred.',
    ar: 'حدث خطأ غير متوقع.',
  },
};

// Specific error message mappings
const SPECIFIC_ERROR_MESSAGES: Record<string, { en: string; ar: string }> = {
  'Network request failed': {
    en: 'Unable to connect to the server.',
    ar: 'تعذر الاتصال بالخادم.',
  },
  'Timeout': {
    en: 'Request timed out. Please try again.',
    ar: 'انتهت مهلة الطلب. يرجى المحاولة مرة أخرى.',
  },
  'Product not found': {
    en: 'Product not found.',
    ar: 'المنتج غير موجود.',
  },
  'Order not found': {
    en: 'Order not found.',
    ar: 'الطلب غير موجود.',
  },
  'Cart is empty': {
    en: 'Your cart is empty.',
    ar: 'سلة التسوق فارغة.',
  },
  'Insufficient stock': {
    en: 'Insufficient stock for this product.',
    ar: 'الكمية المطلوبة غير متوفرة.',
  },
  'Invalid email or password': {
    en: 'Invalid email or password.',
    ar: 'البريد الإلكتروني أو كلمة المرور غير صحيحة.',
  },
  'Email already registered': {
    en: 'This email is already registered.',
    ar: 'هذا البريد الإلكتروني مسجل مسبقاً.',
  },
  'Token expired': {
    en: 'Session expired. Please log in again.',
    ar: 'انتهت صلاحية الجلسة. يرجى تسجيل الدخول مرة أخرى.',
  },
  'Permission denied': {
    en: 'You do not have permission for this action.',
    ar: 'ليس لديك صلاحية لهذا الإجراء.',
  },
};

/**
 * Parse and categorize an error
 */
export function parseError(error: any): FormattedError {
  // Default error structure
  let category: ErrorCategory = 'unknown';
  let code = 'UNKNOWN_ERROR';
  let message = ERROR_MESSAGES.unknown.en;
  let messageAr = ERROR_MESSAGES.unknown.ar;
  let details: any = undefined;

  try {
    // Network errors (no response)
    if (!error.response && error.message) {
      const networkMessages = ['Network request failed', 'network', 'timeout', 'fetch'];
      if (networkMessages.some(m => error.message.toLowerCase().includes(m.toLowerCase()))) {
        category = 'network';
        code = 'NETWORK_ERROR';
        message = ERROR_MESSAGES.network.en;
        messageAr = ERROR_MESSAGES.network.ar;
      }
    }

    // HTTP response errors
    if (error.response) {
      const status = error.response.status;
      category = STATUS_CATEGORY_MAP[status] || 'unknown';
      code = `HTTP_${status}`;
      message = ERROR_MESSAGES[category].en;
      messageAr = ERROR_MESSAGES[category].ar;

      // Extract server message if available
      const serverMessage = 
        error.response.data?.detail ||
        error.response.data?.message ||
        error.response.data?.error;

      if (serverMessage) {
        // Check for specific message mapping
        const specificMsg = Object.keys(SPECIFIC_ERROR_MESSAGES).find(
          key => serverMessage.toLowerCase().includes(key.toLowerCase())
        );

        if (specificMsg) {
          message = SPECIFIC_ERROR_MESSAGES[specificMsg].en;
          messageAr = SPECIFIC_ERROR_MESSAGES[specificMsg].ar;
        } else {
          message = serverMessage;
          messageAr = serverMessage; // Server should provide Arabic if needed
        }
      }

      // Extract validation details
      if (status === 422 && error.response.data?.detail) {
        details = error.response.data.detail;
      }
    }

    // Direct Error instance
    if (error instanceof Error && error.message) {
      const specificMsg = Object.keys(SPECIFIC_ERROR_MESSAGES).find(
        key => error.message.toLowerCase().includes(key.toLowerCase())
      );

      if (specificMsg) {
        message = SPECIFIC_ERROR_MESSAGES[specificMsg].en;
        messageAr = SPECIFIC_ERROR_MESSAGES[specificMsg].ar;
      }
    }
  } catch (parseErr) {
    console.error('[ErrorHandler] Parse error:', parseErr);
  }

  return {
    category,
    code,
    message,
    messageAr,
    retryable: RETRYABLE_CATEGORIES.includes(category),
    details,
  };
}

/**
 * Get user-friendly error message based on language
 */
export function getErrorMessage(error: any, language: 'ar' | 'en' = 'en'): string {
  const parsed = parseError(error);
  return language === 'ar' ? parsed.messageAr : parsed.message;
}

/**
 * Hook for centralized error handling
 */
export function useErrorHandler() {
  const { language } = useTranslation();
  const addNotification = useAppStore((state) => state.addNotification);
  const setUser = useAppStore((state) => state.setUser);

  /**
   * Handle an error with optional notification
   */
  const handleError = useCallback((
    error: any, 
    options?: {
      showNotification?: boolean;
      notificationType?: 'error' | 'warning' | 'info';
      customMessage?: string;
      customMessageAr?: string;
      onAuthError?: () => void;
    }
  ): FormattedError => {
    const parsed = parseError(error);
    const isAr = language === 'ar';

    // Handle auth errors specially
    if (parsed.category === 'auth') {
      // Clear user session on auth errors
      setUser(null);
      options?.onAuthError?.();
    }

    // Show notification if requested
    if (options?.showNotification !== false) {
      const displayMessage = options?.customMessage || options?.customMessageAr
        ? (isAr ? (options.customMessageAr || options.customMessage) : options.customMessage) || parsed.message
        : isAr ? parsed.messageAr : parsed.message;

      addNotification({
        id: `error-${Date.now()}`,
        title: isAr ? 'خطأ' : 'Error',
        message: displayMessage || (isAr ? parsed.messageAr : parsed.message),
        type: options?.notificationType || 'error',
        read: false,
        created_at: new Date().toISOString(),
      });
    }

    // Log error for debugging
    console.error('[ErrorHandler]', {
      category: parsed.category,
      code: parsed.code,
      message: parsed.message,
      details: parsed.details,
      originalError: error,
    });

    return parsed;
  }, [language, addNotification, setUser]);

  /**
   * Create error display text
   */
  const formatError = useCallback((error: any): string => {
    return getErrorMessage(error, language as 'ar' | 'en');
  }, [language]);

  /**
   * Check if error is retryable
   */
  const isRetryable = useCallback((error: any): boolean => {
    return parseError(error).retryable;
  }, []);

  /**
   * Get retry delay based on error type (for exponential backoff)
   */
  const getRetryDelay = useCallback((error: any, attemptIndex: number): number => {
    const parsed = parseError(error);
    
    // Network errors: quick retry
    if (parsed.category === 'network') {
      return Math.min(1000 * Math.pow(2, attemptIndex), 10000);
    }
    
    // Server errors: slower retry
    if (parsed.category === 'server') {
      return Math.min(2000 * Math.pow(2, attemptIndex), 30000);
    }
    
    // Don't retry other errors
    return 0;
  }, []);

  return {
    handleError,
    formatError,
    isRetryable,
    getRetryDelay,
    parseError,
  };
}

/**
 * React Query global error handler configuration
 * Use this to configure QueryClient with centralized error handling
 */
export function configureQueryClientErrorHandling(
  queryClient: QueryClient,
  addNotification: (notification: any) => void,
  language: 'ar' | 'en' = 'en'
) {
  // Set default options with error handling
  queryClient.setDefaultOptions({
    queries: {
      retry: (failureCount, error: any) => {
        const parsed = parseError(error);
        // Only retry network and server errors, max 3 times
        return parsed.retryable && failureCount < 3;
      },
      retryDelay: (attemptIndex, error: any) => {
        const parsed = parseError(error);
        if (parsed.category === 'network') {
          return Math.min(1000 * Math.pow(2, attemptIndex), 10000);
        }
        return Math.min(2000 * Math.pow(2, attemptIndex), 30000);
      },
    },
    mutations: {
      onError: (error: any) => {
        const parsed = parseError(error);
        
        // Don't show notification for auth errors (handled separately)
        if (parsed.category === 'auth') return;
        
        addNotification({
          id: `mutation-error-${Date.now()}`,
          title: language === 'ar' ? 'خطأ' : 'Error',
          message: language === 'ar' ? parsed.messageAr : parsed.message,
          type: 'error',
          read: false,
          created_at: new Date().toISOString(),
        });
      },
    },
  });
}

export default useErrorHandler;
