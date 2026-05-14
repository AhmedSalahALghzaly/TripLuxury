import { describe, it, expect } from 'vitest';
import {
  ORDER_STATUS_LABELS_AR,
  ORDER_STATUS_LABELS_EN,
  ORDER_STATUS_COLORS,
  OrderStatus,
} from '../orderStatus';

describe('orderStatus constants', () => {
  const statuses = Object.values(OrderStatus);

  it('ORDER_STATUS_LABELS_AR and ORDER_STATUS_LABELS_EN have the same keys', () => {
    expect(Object.keys(ORDER_STATUS_LABELS_AR).sort()).toEqual(Object.keys(ORDER_STATUS_LABELS_EN).sort());
  });

  it('ORDER_STATUS_LABELS_AR and ORDER_STATUS_COLORS have the same keys', () => {
    expect(Object.keys(ORDER_STATUS_LABELS_AR).sort()).toEqual(Object.keys(ORDER_STATUS_COLORS).sort());
  });

  it('ORDER_STATUS_LABELS_EN and ORDER_STATUS_COLORS have the same keys', () => {
    expect(Object.keys(ORDER_STATUS_LABELS_EN).sort()).toEqual(Object.keys(ORDER_STATUS_COLORS).sort());
  });

  it('no map has an empty label', () => {
    for (const status of statuses) {
      expect(ORDER_STATUS_LABELS_AR[status].trim()).not.toBe('');
      expect(ORDER_STATUS_LABELS_EN[status].trim()).not.toBe('');
    }
  });

  it('all color values are valid hex strings', () => {
    for (const status of statuses) {
      expect(ORDER_STATUS_COLORS[status]).toMatch(/^#[0-9A-Fa-f]{3,8}$/);
    }
  });
});
