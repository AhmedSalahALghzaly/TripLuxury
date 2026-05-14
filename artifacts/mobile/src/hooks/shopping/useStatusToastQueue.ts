/**
 * useStatusToastQueue — Shared queue/dedupe state for OrderStatusToastStack.
 *
 * Both order status PATCHes (useOrderOperations) and appointment/booking
 * status PATCHes (restaurant-analytics) push success/error toasts through
 * this hook so admins triaging many records in a row get clear, per-PATCH
 * feedback rendered by `OrderStatusToastStack`.
 */
import { useCallback, useRef, useState } from 'react';
import type {
  OrderStatusToast,
  OrderStatusToastUndo,
} from '../../components/shopping-hub/OrderStatusToastStack';

const MAX_VISIBLE_TOASTS = 3;
const TOAST_DEDUPE_MS = 800;

export const useStatusToastQueue = () => {
  const [statusToasts, setStatusToasts] = useState<OrderStatusToast[]>([]);
  const recentToastsRef = useRef<Map<string, number>>(new Map());

  const dismissStatusToast = useCallback((id: string) => {
    setStatusToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const pushStatusToast = useCallback(
    (
      type: OrderStatusToast['type'],
      dedupeKey: string,
      message: string,
      undo?: OrderStatusToastUndo,
      onPress?: () => void,
    ) => {
      const now = Date.now();
      const last = recentToastsRef.current.get(dedupeKey) || 0;
      if (now - last < TOAST_DEDUPE_MS) return;
      recentToastsRef.current.set(dedupeKey, now);
      const toast: OrderStatusToast = {
        id: `${dedupeKey}_${now}_${Math.random().toString(36).slice(2, 7)}`,
        type,
        message,
        ...(undo ? { undo } : {}),
        ...(onPress ? { onPress } : {}),
      };
      setStatusToasts((prev) => {
        const next = [...prev, toast];
        return next.length > MAX_VISIBLE_TOASTS
          ? next.slice(next.length - MAX_VISIBLE_TOASTS)
          : next;
      });
    },
    []
  );

  return { statusToasts, pushStatusToast, dismissStatusToast };
};

export default useStatusToastQueue;
