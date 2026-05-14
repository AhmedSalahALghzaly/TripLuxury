import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Switch,
  Alert,
  Platform,
} from 'react-native';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Header } from '../../src/components/Header';
import { useTheme } from '../../src/hooks/useTheme';
import { useTranslation } from '../../src/hooks/useTranslation';
import { useAppStore, useCanAccessAdminPanel } from '../../src/store/appStore';
import { pushNotificationService } from '../../src/services/pushNotificationService';
import { useQueryClient } from '@tanstack/react-query';
import { authApi, setApiAuthToken } from '../../src/services/api';
import { AppVersionInfo } from '../../src/components/ui/AppVersionInfo';
import { useStatusToastQueue } from '../../src/hooks/shopping/useStatusToastQueue';
import { OrderStatusToastStack } from '../../src/components/shopping-hub/OrderStatusToastStack';

const OWNER_EMAIL = 'pc.2025.ai@gmail.com';

export default function ProfileScreen() {
  const { colors, isDark } = useTheme();
  const { t, isRTL, language } = useTranslation();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user, theme, toggleTheme, setLanguage, logout, userRole } = useAppStore();
  const partners = useAppStore((state) => state.partners);
  const admins = useAppStore((state) => state.admins);
  const canAccessAdminPanel = useCanAccessAdminPanel();
  const [loggingOut, setLoggingOut] = useState(false);
  const queryClient = useQueryClient();
  const { statusToasts, pushStatusToast, dismissStatusToast } = useStatusToastQueue();

  const isOwner = user?.email?.toLowerCase() === OWNER_EMAIL.toLowerCase();
  const isPartner = partners.some(
    (p: any) => p.email?.toLowerCase() === user?.email?.toLowerCase()
  );
  const isAdmin = admins.some(
    (a: any) => a.email?.toLowerCase() === user?.email?.toLowerCase()
  ) || userRole === 'admin';
  const canAccessOwner = isOwner || isPartner;

  const ar = language === 'ar';

  const performLogout = async () => {
    setLoggingOut(true);
    // Best-effort: unregister push token before clearing session
    try {
      await pushNotificationService.unregisterCurrentToken();
    } catch {}
    try {
      await authApi.logout();
    } catch {
      // ignore
    }
    setApiAuthToken(null);
    queryClient.clear();
    logout();
    setLoggingOut(false);
    router.replace('/(tabs)');
    setTimeout(() => router.replace('/login'), 50);
  };

  const handleLogout = () => {
    if (Platform.OS === 'web') {
      if (window.confirm(ar ? 'هل تريد تسجيل الخروج؟' : 'Are you sure you want to logout?')) {
        performLogout();
      }
    } else {
      Alert.alert(
        ar ? 'تسجيل الخروج' : 'Logout',
        ar ? 'هل تريد تسجيل الخروج؟' : 'Are you sure you want to logout?',
        [
          { text: ar ? 'إلغاء' : 'Cancel', style: 'cancel' },
          {
            text: ar ? 'تسجيل الخروج' : 'Logout',
            style: 'destructive',
            onPress: performLogout,
          },
        ]
      );
    }
  };

  const bottomPadding = Platform.OS === 'web' ? 34 : insets.bottom;

  // Guest State
  if (!user) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <Header title={ar ? 'حسابي' : 'My Profile'} showBack={false} />
        <View style={styles.guestContainer}>
          <View style={[styles.avatarPlaceholder, { backgroundColor: colors.surface }]}>
            <Ionicons name="person-outline" size={60} color={colors.textSecondary} />
          </View>
          <Text style={[styles.guestText, { color: colors.text }]}>
            {ar ? 'سجّل دخولك للوصول إلى حسابك' : 'Sign in to access your account'}
          </Text>
          <TouchableOpacity
            style={[styles.loginButton, { backgroundColor: colors.primary }]}
            onPress={() => router.push('/login')}
          >
            <Ionicons name="log-in-outline" size={22} color="#FFF" />
            <Text style={styles.loginButtonText}>
              {ar ? 'تسجيل الدخول' : 'Sign In'}
            </Text>
          </TouchableOpacity>

          <View style={[styles.settingsSection, { marginTop: 40 }]}>
            <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>
              {ar ? 'الإعدادات' : 'Settings'}
            </Text>

            <View style={[styles.settingItem, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <View style={styles.settingLeft}>
                <Ionicons name={isDark ? 'moon' : 'sunny'} size={22} color={colors.primary} />
                <Text style={[styles.settingText, { color: colors.text }]}>
                  {ar ? 'الوضع الداكن' : 'Dark Mode'}
                </Text>
              </View>
              <Switch
                value={isDark}
                onValueChange={toggleTheme}
                trackColor={{ false: colors.border, true: colors.primary }}
                thumbColor="#FFF"
              />
            </View>

            <TouchableOpacity
              style={[styles.settingItem, { backgroundColor: colors.card, borderColor: colors.border }]}
              onPress={() => setLanguage(language === 'en' ? 'ar' : 'en')}
            >
              <View style={styles.settingLeft}>
                <Ionicons name="language" size={22} color={colors.primary} />
                <Text style={[styles.settingText, { color: colors.text }]}>
                  {ar ? 'اللغة' : 'Language'}
                </Text>
              </View>
              <View style={styles.settingRight}>
                <Text style={[styles.settingValue, { color: colors.textSecondary }]}>
                  {language === 'en' ? 'English' : 'العربية'}
                </Text>
                <Ionicons
                  name={isRTL ? 'chevron-back' : 'chevron-forward'}
                  size={20}
                  color={colors.textSecondary}
                />
              </View>
            </TouchableOpacity>
          </View>

          <AppVersionInfo compact />
        </View>
        <OrderStatusToastStack toasts={statusToasts} onDismiss={dismissStatusToast} />
      </View>
    );
  }

  // Authenticated User State
  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <Header title={ar ? 'حسابي' : 'My Profile'} showBack={false} />

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: bottomPadding + 16 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* Profile Card */}
        <View style={[styles.profileCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          {user.picture ? (
            <Image
              source={{ uri: user.picture }}
              style={styles.avatar}
              contentFit="cover"
              cachePolicy="disk"
            />
          ) : (
            <View style={[styles.avatarPlaceholder, { backgroundColor: colors.primary + '22' }]}>
              <Text style={[styles.avatarText, { color: colors.primary }]}>
                {user.name?.charAt(0).toUpperCase()}
              </Text>
            </View>
          )}
          <View style={styles.userInfo}>
            <Text style={[styles.userName, { color: colors.text }]}>{user.name}</Text>
            <Text style={[styles.userEmail, { color: colors.textSecondary }]}>{user.email}</Text>
            {userRole && userRole !== 'user' && (
              <View style={[styles.roleBadge, { backgroundColor: colors.primary + '22' }]}>
                <Text style={[styles.roleText, { color: colors.primary }]}>
                  {userRole === 'owner' ? (ar ? 'مالك' : 'Owner') :
                   userRole === 'partner' ? (ar ? 'شريك' : 'Partner') :
                   userRole === 'admin' ? (ar ? 'مدير' : 'Admin') :
                   userRole === 'subscriber' ? (ar ? 'مشترك' : 'Subscriber') : userRole}
                </Text>
              </View>
            )}
          </View>
        </View>

        {/* Menu Items */}
        <View style={styles.menuSection}>
          <TouchableOpacity
            style={[styles.menuItem, { backgroundColor: colors.card, borderColor: colors.border }]}
            onPress={() => router.push({ pathname: '/(tabs)/cart', params: { tab: 'favorites' } })}
          >
            <View style={styles.menuLeft}>
              <View style={[styles.menuIcon, { backgroundColor: '#EF444420' }]}>
                <Ionicons name="heart" size={22} color="#EF4444" />
              </View>
              <Text style={[styles.menuText, { color: colors.text }]}>
                {ar ? 'المفضلة' : 'My Favorites'}
              </Text>
            </View>
            <Ionicons name={isRTL ? 'chevron-back' : 'chevron-forward'} size={20} color={colors.textSecondary} />
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.menuItem, { backgroundColor: colors.card, borderColor: colors.border }]}
            onPress={() => router.push({ pathname: '/(tabs)/cart', params: { tab: 'orders' } })}
          >
            <View style={styles.menuLeft}>
              <View style={[styles.menuIcon, { backgroundColor: colors.primary + '20' }]}>
                <Ionicons name="receipt-outline" size={22} color={colors.primary} />
              </View>
              <Text style={[styles.menuText, { color: colors.text }]}>
                {ar ? 'طلباتي' : 'My Orders'}
              </Text>
            </View>
            <Ionicons name={isRTL ? 'chevron-back' : 'chevron-forward'} size={20} color={colors.textSecondary} />
          </TouchableOpacity>

          {/* Saved Addresses — quick access to manage home/work/club. */}
          <TouchableOpacity
            style={[styles.menuItem, { backgroundColor: colors.card, borderColor: colors.border }]}
            onPress={() => router.push('/saved-addresses')}
          >
            <View style={styles.menuLeft}>
              <View style={[styles.menuIcon, { backgroundColor: '#10B98120' }]}>
                <Ionicons name="navigate" size={22} color="#10B981" />
              </View>
              <Text style={[styles.menuText, { color: colors.text }]}>
                {ar ? 'العناوين المحفوظة' : 'Saved Addresses'}
              </Text>
            </View>
            <Ionicons name={isRTL ? 'chevron-back' : 'chevron-forward'} size={20} color={colors.textSecondary} />
          </TouchableOpacity>

          {/* Owner Dashboard */}
          {canAccessOwner && (
            <TouchableOpacity
              style={[styles.menuItem, { backgroundColor: colors.card, borderColor: colors.border }]}
              onPress={() => router.push('/owner')}
            >
              <View style={styles.menuLeft}>
                <LinearGradient
                  colors={['#6366F1', '#8B5CF6', '#A855F7']}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={[styles.menuIcon, { borderRadius: 12 }]}
                >
                  <Ionicons name="diamond" size={20} color="#FFF" />
                </LinearGradient>
                <View>
                  <Text style={[styles.menuText, { color: colors.text }]}>
                    {ar ? 'لوحة المالك' : 'Owner Dashboard'}
                  </Text>
                  <Text style={{ fontSize: 11, color: '#8B5CF6', marginTop: 2 }}>
                    {isOwner ? (ar ? 'مالك' : 'Owner') : (ar ? 'شريك' : 'Partner')}
                  </Text>
                </View>
              </View>
              <View style={styles.ownerBadge}>
                <Ionicons name="sparkles" size={16} color="#8B5CF6" />
              </View>
            </TouchableOpacity>
          )}

          {/* Admin Dashboard */}
          {isAdmin && !canAccessOwner && (
            <TouchableOpacity
              style={[styles.menuItem, { backgroundColor: colors.card, borderColor: colors.border }]}
              onPress={() => router.push('/admin')}
            >
              <View style={styles.menuLeft}>
                <LinearGradient
                  colors={['#10B981', '#059669', '#047857']}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={[styles.menuIcon, { borderRadius: 12 }]}
                >
                  <Ionicons name="settings" size={20} color="#FFF" />
                </LinearGradient>
                <View>
                  <Text style={[styles.menuText, { color: colors.text }]}>
                    {ar ? 'لوحة الإدارة' : 'Admin Dashboard'}
                  </Text>
                  <Text style={{ fontSize: 11, color: '#10B981', marginTop: 2 }}>
                    {ar ? 'مدير' : 'Admin'}
                  </Text>
                </View>
              </View>
              <View style={styles.ownerBadge}>
                <Ionicons name="shield-checkmark" size={16} color="#10B981" />
              </View>
            </TouchableOpacity>
          )}
        </View>

        {/* Settings */}
        <View style={styles.settingsSection}>
          <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>
            {ar ? 'الإعدادات' : 'Settings'}
          </Text>

          <View style={[styles.settingItem, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={styles.settingLeft}>
              <Ionicons name={isDark ? 'moon' : 'sunny'} size={22} color={colors.primary} />
              <Text style={[styles.settingText, { color: colors.text }]}>
                {ar ? 'الوضع الداكن' : 'Dark Mode'}
              </Text>
            </View>
            <Switch
              value={isDark}
              onValueChange={toggleTheme}
              trackColor={{ false: colors.border, true: colors.primary }}
              thumbColor="#FFF"
            />
          </View>

          <TouchableOpacity
            style={[styles.settingItem, { backgroundColor: colors.card, borderColor: colors.border }]}
            onPress={async () => {
              const next = language === 'en' ? 'ar' : 'en';
              setLanguage(next);
              try {
                await authApi.updateLanguagePreference(next);
              } catch {
                setLanguage(language);
                pushStatusToast(
                  'error',
                  'lang_pref_save',
                  next === 'ar' ? 'تعذّر حفظ تفضيل اللغة' : 'Could not save language preference',
                );
              }
            }}
          >
            <View style={styles.settingLeft}>
              <Ionicons name="language" size={22} color={colors.primary} />
              <Text style={[styles.settingText, { color: colors.text }]}>
                {ar ? 'اللغة' : 'Language'}
              </Text>
            </View>
            <View style={styles.settingRight}>
              <Text style={[styles.settingValue, { color: colors.textSecondary }]}>
                {language === 'en' ? 'English' : 'العربية'}
              </Text>
              <Ionicons
                name={isRTL ? 'chevron-back' : 'chevron-forward'}
                size={20}
                color={colors.textSecondary}
              />
            </View>
          </TouchableOpacity>
        </View>

        <AppVersionInfo showDetails />

        {/* Logout */}
        <TouchableOpacity
          style={[styles.logoutButton, { borderColor: '#EF4444', opacity: loggingOut ? 0.6 : 1 }]}
          onPress={handleLogout}
          disabled={loggingOut}
        >
          <Ionicons name="log-out-outline" size={22} color="#EF4444" />
          <Text style={[styles.logoutText, { color: '#EF4444' }]}>
            {loggingOut ? (ar ? 'جاري الخروج...' : 'Signing out...') : (ar ? 'تسجيل الخروج' : 'Sign Out')}
          </Text>
        </TouchableOpacity>
      </ScrollView>
      <OrderStatusToastStack toasts={statusToasts} onDismiss={dismissStatusToast} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  guestContainer: { flex: 1, alignItems: 'center', paddingTop: 60, paddingHorizontal: 20 },
  guestText: { fontSize: 18, marginTop: 20, marginBottom: 24, textAlign: 'center' },
  loginButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 28,
    paddingVertical: 14,
    borderRadius: 12,
    gap: 10,
  },
  loginButtonText: { color: '#FFF', fontSize: 16, fontWeight: '700' },
  scrollView: { flex: 1 },
  scrollContent: { padding: 16 },
  profileCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 20,
    borderRadius: 16,
    borderWidth: 1,
    marginBottom: 24,
  },
  avatar: { width: 70, height: 70, borderRadius: 35 },
  avatarPlaceholder: {
    width: 70,
    height: 70,
    borderRadius: 35,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { fontSize: 28, fontWeight: '700' },
  userInfo: { marginLeft: 16, flex: 1 },
  userName: { fontSize: 20, fontWeight: '700', marginBottom: 4 },
  userEmail: { fontSize: 14 },
  roleBadge: {
    alignSelf: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 20,
    marginTop: 6,
  },
  roleText: { fontSize: 12, fontWeight: '600' },
  menuSection: { marginBottom: 24 },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 8,
  },
  menuLeft: { flexDirection: 'row', alignItems: 'center' },
  menuIcon: {
    width: 42,
    height: 42,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  menuText: { fontSize: 16, fontWeight: '500' },
  settingsSection: { marginBottom: 24, width: '100%' },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '700',
    marginBottom: 12,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  settingItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 8,
  },
  settingLeft: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  settingText: { fontSize: 16, fontWeight: '500' },
  settingRight: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  settingValue: { fontSize: 14 },
  logoutButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
    borderRadius: 12,
    borderWidth: 2,
    gap: 8,
    marginTop: 8,
  },
  logoutText: { fontSize: 16, fontWeight: '600' },
  ownerBadge: { flexDirection: 'row', alignItems: 'center' },
});
