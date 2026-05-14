import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { OpenStatus } from '../utils/timeUtils';

interface OpenStatusBadgeProps {
  status: OpenStatus;
  size?: 'sm' | 'md';
}

const OPEN_TEXT = '#16a34a';
const CLOSED_TEXT = '#dc2626';

/**
 * Compact badge showing "Open Now" (green) or "Closed" (red).
 * Optionally shows a sublabel like "Closes at 22:00" or "Opens at 08:00".
 */
export const OpenStatusBadge = React.memo<OpenStatusBadgeProps>(({ status, size = 'sm' }) => {
  const isSm = size === 'sm';
  const badgeStyle = [
    styles.badge,
    isSm ? styles.badgeSm : styles.badgeMd,
    status.isOpen ? styles.badgeOpen : styles.badgeClosed,
  ];
  const dotColor = status.isOpen ? '#22c55e' : '#ef4444';
  const textColor = status.isOpen ? OPEN_TEXT : CLOSED_TEXT;

  return (
    <View style={styles.wrapper}>
      <View style={badgeStyle}>
        <View style={[styles.dot, { backgroundColor: dotColor }]} />
        <Text
          style={[styles.badgeText, isSm ? styles.textSm : styles.textMd, { color: textColor }]}
          numberOfLines={1}
        >
          {status.label}
        </Text>
      </View>
      {status.sublabel ? (
        <Text
          style={[styles.sublabel, isSm ? styles.sublabelSm : styles.sublabelMd]}
          numberOfLines={1}
        >
          {status.sublabel}
        </Text>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  wrapper: {
    flexDirection: 'column',
    alignItems: 'flex-start',
    gap: 2,
    marginTop: 3,
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 20,
    gap: 4,
  },
  badgeSm: {
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  badgeMd: {
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  badgeOpen: {
    backgroundColor: 'rgba(34, 197, 94, 0.15)',
  },
  badgeClosed: {
    backgroundColor: 'rgba(239, 68, 68, 0.13)',
  },
  dot: {
    width: 5,
    height: 5,
    borderRadius: 3,
  },
  badgeText: {
    fontWeight: '600',
    letterSpacing: 0.1,
  },
  textSm: {
    fontSize: 9.5,
  },
  textMd: {
    fontSize: 11,
  },
  sublabel: {
    fontSize: 8.5,
    color: '#888',
    paddingHorizontal: 2,
  },
  sublabelSm: {
    fontSize: 8.5,
  },
  sublabelMd: {
    fontSize: 10,
  },
});
