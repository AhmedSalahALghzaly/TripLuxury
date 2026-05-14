/**
 * Cart Tab - Unified Shopping Hub Entry Point
 * This replaces the old cart screen with the Universal Shopping & Management Hub
 */
import React from 'react';
import { View, StyleSheet } from 'react-native';
import { useTheme } from '../../src/hooks/useTheme';
import { UnifiedShoppingHub } from '../../src/components/UnifiedShoppingHub';
import { Header } from '../../src/components/Header';
import { useTranslation } from '../../src/hooks/useTranslation';
import { useLocalSearchParams } from 'expo-router';
import { useAppStore } from '../../src/store/appStore';

export default function CartScreen() {
  const { colors } = useTheme();
  const { language } = useTranslation();
  const { tab, appointmentId, customerId } = useLocalSearchParams<{
    tab?: string;
    appointmentId?: string;
    customerId?: string;
  }>();
  const userRole = useAppStore((s) => s.userRole);

  // Determine which tab to show - default to cart, but allow orders via query param
  const initialTab = (tab === 'orders' || tab === 'favorites' || tab === 'checkout' || tab === 'profile')
    ? tab
    : 'cart';

  // When the URL carries `?customerId=…` and the viewer is privileged
  // (owner/admin/partner), open the hub in admin-view mode for that customer.
  // This lets `/cart?customerId=…&tab=orders` deep-links from the Customers
  // admin page render the customer-scoped orders/favorites/cart instead of
  // the privileged user's own data.
  const isPrivileged = ['owner', 'admin', 'partner'].includes(userRole ?? '');
  const targetCustomerId = isPrivileged && typeof customerId === 'string' && customerId
    ? customerId
    : undefined;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <Header
        title={language === 'ar' ? 'حسابي' : 'My Account'}
        showBack={false}
        showSearch={true}
        showCart={false}
      />
      <UnifiedShoppingHub
        initialTab={initialTab}
        highlightAppointmentId={typeof appointmentId === 'string' ? appointmentId : undefined}
        customerId={targetCustomerId}
        isAdminView={!!targetCustomerId}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
});
