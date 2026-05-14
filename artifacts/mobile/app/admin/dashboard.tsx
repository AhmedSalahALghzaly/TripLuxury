/**
 * Admin Dashboard Screen - Full Performance Analytics
 */
import React from 'react';
import { View, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Header } from '../../src/components/Header';
import { AdminPerformanceDashboard } from '../../src/components/AdminPerformanceDashboard';
import { useTheme } from '../../src/hooks/useTheme';
import { useTranslation } from '../../src/hooks/useTranslation';
import { AccessGuard as __AccessGuard__ } from '../../src/components/AccessGuard';
function AdminDashboardScreen() {
  const { colors } = useTheme();
  const { language } = useTranslation();

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['bottom']}>
      <Header 
        title={language === 'ar' ? 'لوحة الأداء' : 'Performance Dashboard'} 
        showBack 
        showSearch={false} 
        showCart={false} 
      />
      <AdminPerformanceDashboard />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
});


/* __ACCESS_GUARD_APPLIED__ */
export default function AdminDashboardScreenGuarded(props: any) {
  return (
    <__AccessGuard__ scope="admin">
      <AdminDashboardScreen {...props} />
    </__AccessGuard__>
  );
}
