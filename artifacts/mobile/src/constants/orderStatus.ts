import { OrderStatus } from "@workspace/api-client-react";

export { OrderStatus };

const ORDER_STATUS_SET = new Set<string>(Object.values(OrderStatus));

export function isOrderStatus(value: unknown): value is OrderStatus {
  return typeof value === 'string' && ORDER_STATUS_SET.has(value);
}

export function asOrderStatus(value: string): OrderStatus {
  if (isOrderStatus(value)) return value;
  return OrderStatus.pending;
}

export const ORDER_STATUS_LABELS_AR: Record<OrderStatus, string> = {
  pending:          'قيد الانتظار',
  confirmed:        'مؤكد',
  preparing:        'جاري التحضير',
  ready:            'جاهز',
  shipped:          'تم الشحن',
  out_for_delivery: 'في الطريق إليك',
  delivered:        'تم التوصيل',
  cancelled:        'ملغي',
};

export const ORDER_STATUS_LABELS_EN: Record<OrderStatus, string> = {
  pending:          'Pending',
  confirmed:        'Confirmed',
  preparing:        'Preparing',
  ready:            'Ready',
  shipped:          'Shipped',
  out_for_delivery: 'Out for Delivery',
  delivered:        'Delivered',
  cancelled:        'Cancelled',
};

export const ORDER_STATUS_COLORS: Record<OrderStatus, string> = {
  pending:          '#F59E0B',
  confirmed:        '#6366F1',
  preparing:        '#8B5CF6',
  ready:            '#06B6D4',
  shipped:          '#3B82F6',
  out_for_delivery: '#0EA5E9',
  delivered:        '#10B981',
  cancelled:        '#EF4444',
};
