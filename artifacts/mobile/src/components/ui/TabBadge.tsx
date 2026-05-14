/**
 * TabBadge - Notification badge for tabs
 * Shows count with max display of 99+
 */
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

interface TabBadgeProps {
  count: number;
  color: string;
}

export const TabBadge: React.FC<TabBadgeProps> = ({ count, color }) => {
  if (count <= 0) return null;

  return (
    <View style={[styles.tabBadge, { backgroundColor: color }]}>
      <Text style={styles.tabBadgeText}>
        {count > 99 ? '99+' : count}
      </Text>
    </View>
  );
};

const styles = StyleSheet.create({
  tabBadge: {
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 4,
  },
  tabBadgeText: {
    color: '#FFF',
    fontSize: 10,
    fontWeight: '700',
  },
});

export default TabBadge;
