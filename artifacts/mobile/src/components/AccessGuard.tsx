import React from 'react';
import { View, Text, StyleSheet, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../hooks/useTheme';
import { useTranslation } from '../hooks/useTranslation';
import { Header } from './Header';
import {
  useAppStore,
  useCanAccessAdminPanel,
  useCanAccessOwnerInterface,
  NEON_NIGHT_THEME,
} from '../store/appStore';

const FALLBACK_ADMIN_EMAILS: string[] = [];

const FALLBACK_OWNER_EMAILS: string[] = [];

export type GuardScope = 'admin' | 'owner';

export interface AccessGuardProps {
  scope: GuardScope;
  title?: string;
  children: React.ReactNode;
}

/**
 * Wraps a screen in an authorization gate. If the current user does not
 * have the required role, renders a lock screen with the standard Arabic
 * "غير مصرح بالدخول" message instead of the children.
 *
 * Scope rules:
 *   admin  → owner | partner | admin | is_admin=true | fallback admin email
 *   owner  → owner | partner | fallback owner email
 */
export function AccessGuard({ scope, title, children }: AccessGuardProps) {
  const { colors } = useTheme();
  const { language } = useTranslation();
  const user = useAppStore((s) => s.user);
  const userRole = useAppStore((s) => s.userRole);
  const admins = useAppStore((s) => s.admins);
  const canAccessAdmin = useCanAccessAdminPanel();
  const canAccessOwner = useCanAccessOwnerInterface();

  // Still loading: no user object yet.
  if (user === undefined) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
        <Header
          title={title ?? (language === 'ar' ? 'لوحة التحكم' : 'Panel')}
          showBack
          showSearch={false}
          showCart={false}
        />
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={NEON_NIGHT_THEME.primary} />
          <Text style={[styles.loadingText, { color: colors.textSecondary }]}>
            {language === 'ar' ? 'جاري التحقق...' : 'Checking access...'}
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  const email = user?.email?.toLowerCase() ?? '';
  const inAdminsList = (admins ?? []).some(
    (a: any) => (a?.email ?? '').toLowerCase() === email,
  );

  let allowed = false;
  if (scope === 'owner') {
    allowed =
      canAccessOwner ||
      userRole === 'owner' ||
      userRole === 'partner' ||
      userRole === 'admin' ||
      userRole === 'restaurant_user' ||
      Boolean((user as any)?.is_admin) ||
      inAdminsList ||
      FALLBACK_OWNER_EMAILS.includes(email);
  } else {
    allowed =
      canAccessAdmin ||
      userRole === 'owner' ||
      userRole === 'partner' ||
      userRole === 'admin' ||
      Boolean((user as any)?.is_admin) ||
      inAdminsList ||
      FALLBACK_ADMIN_EMAILS.includes(email);
  }

  if (allowed) {
    return <>{children}</>;
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <Header
        title={title ?? (language === 'ar' ? 'لوحة التحكم' : 'Panel')}
        showBack
        showSearch={false}
        showCart={false}
      />
      <View style={styles.accessDenied}>
        <Ionicons name="lock-closed" size={64} color={colors.error} />
        <Text style={[styles.accessDeniedText, { color: colors.text }]}>
          {language === 'ar' ? 'غير مصرح بالدخول' : 'Access Denied'}
        </Text>
        <Text style={[styles.accessDeniedSubtext, { color: colors.textSecondary }]}>
          {language === 'ar'
            ? 'ليس لديك صلاحية الوصول لهذه الصفحة'
            : 'You do not have permission to access this page'}
        </Text>
        <Text style={[styles.accessDeniedHint, { color: colors.textSecondary }]}>
          {language === 'ar'
            ? 'تواصل مع المالك للحصول على صلاحية الإدارة'
            : 'Contact the owner to get admin access'}
        </Text>
      </View>
    </SafeAreaView>
  );
}

/**
 * Lightweight hook variant for screens that need to *conditionally render*
 * UI elements (e.g. hiding a "+" add button) instead of replacing the
 * whole screen with a lock.
 *
 * Returns `true` when the current user is allowed under the given scope.
 */
export function useHasAccess(scope: GuardScope): boolean {
  const user = useAppStore((s) => s.user);
  const userRole = useAppStore((s) => s.userRole);
  const admins = useAppStore((s) => s.admins);
  const canAccessAdmin = useCanAccessAdminPanel();
  const canAccessOwner = useCanAccessOwnerInterface();
  const email = user?.email?.toLowerCase() ?? '';

  const inAdminsList = (admins ?? []).some(
    (a: any) => (a?.email ?? '').toLowerCase() === email,
  );

  if (scope === 'owner') {
    return (
      canAccessOwner ||
      userRole === 'owner' ||
      userRole === 'partner' ||
      userRole === 'admin' ||
      userRole === 'restaurant_user' ||
      Boolean((user as any)?.is_admin) ||
      inAdminsList ||
      FALLBACK_OWNER_EMAILS.includes(email)
    );
  }

  return (
    canAccessAdmin ||
    userRole === 'owner' ||
    userRole === 'partner' ||
    userRole === 'admin' ||
    Boolean((user as any)?.is_admin) ||
    inAdminsList ||
    FALLBACK_ADMIN_EMAILS.includes(email)
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  loadingText: { marginTop: 12, fontSize: 14 },
  accessDenied: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24, gap: 10 },
  accessDeniedText: { fontSize: 22, fontWeight: '700', marginTop: 14, textAlign: 'center' },
  accessDeniedSubtext: { fontSize: 14, textAlign: 'center' },
  accessDeniedHint: { fontSize: 13, textAlign: 'center', marginTop: 6 },
});
