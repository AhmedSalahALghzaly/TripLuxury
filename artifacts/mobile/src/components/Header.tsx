import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Platform, StatusBar, Linking } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTheme } from '../hooks/useTheme';
import { useTranslation } from '../hooks/useTranslation';
import { useAppStore } from '../store/appStore';
import { useCartQuery } from '../hooks/queries/useShoppingHubQuery';
import { SyncIndicator } from './ui/SyncIndicator';
import { GlobalSearch } from './ui/GlobalSearch';
import { AdvancedSearch } from './ui/AdvancedSearch';
import { NotificationCenter, NotificationBell } from './ui/NotificationCenter';
import { PhoneVerificationModal } from './ui/PhoneVerificationModal';
import { apiRequest, getApiUrl } from '@/lib/query-client';
import { authApi } from '../services/api';
import { useStatusToastQueue } from '../hooks/shopping/useStatusToastQueue';
import { OrderStatusToastStack } from './shopping-hub/OrderStatusToastStack';

const LOGO_IMAGE = require('../../assets/images/logo.png');

// Admin emails that can access the Branch Page
const ADMIN_EMAILS = [
  'ahmed.salah.ghazaly.91@gmail.com',
  'ahmed.salah.mohamed.ai2025@gmail.com',
  'pc.2025.ai@gmail.com',
];

// Neon Night Theme (Default)

interface HeaderProps {
  title?: string;
  showBack?: boolean;
  showSearch?: boolean;
  showCart?: boolean;
  showSettings?: boolean;
}

export const Header: React.FC<HeaderProps> = ({
  title,
  showBack = false,
  showSearch = false, // Changed default to false - Search icon removed
  showCart = true,
  showSettings = true,
}) => {
  const { colors, isDark } = useTheme();
  const { t, isRTL } = useTranslation();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const toggleTheme = useAppStore((state) => state.setTheme);
  const theme = useAppStore((state) => state.theme);
  const language = useAppStore((state) => state.language);
  const setLanguage = useAppStore((state) => state.setLanguage);
  const { data: cartQueryData } = useCartQuery();
  const user = useAppStore((state) => state.user);
  const setColorMood = useAppStore((state) => state.setColorMood);
  const currentMood = useAppStore((state) => state.currentMood);
  const cartCount = cartQueryData?.length ?? 0;
  const subscribers = useAppStore((state) => state.subscribers) || [];
  const subscriptionStatus = useAppStore((state) => state.subscriptionStatus);
  const userRole = useAppStore((state) => state.userRole);
  const checkSubscriptionStatus = useAppStore((state) => state.checkSubscriptionStatus);

  // Effective subscription status — also consider userRole === 'subscriber' as a fallback
  const effectiveStatus: typeof subscriptionStatus = useMemo(() => {
    if (subscriptionStatus === 'subscriber') return 'subscriber';
    if (userRole === 'subscriber') return 'subscriber';
    if (subscriptionStatus !== 'none') return subscriptionStatus;
    if (!user) return 'none';
    const matchesSub = subscribers.some((sub: any) =>
      (user.email && sub.email?.toLowerCase() === user.email?.toLowerCase()) ||
      (user.phone && sub.phone === user.phone)
    );
    return matchesSub ? 'subscriber' : 'none';
  }, [user, subscribers, subscriptionStatus, userRole]);

  // Check if current user is a subscriber (by email or phone)
  const isUserSubscriber = effectiveStatus === 'subscriber';

  // Check subscription status when user logs in, and periodically refresh
  useEffect(() => {
    if (!user?.email && !user?.phone) return;
    checkSubscriptionStatus(user.email ?? undefined, user.phone ?? undefined);

    // Poll every 120s — approval is not time-critical (admin manually
    // toggles in dashboard) and we want to halve background traffic /
    // server CPU. Manual `checkSubscriptionStatus` is also called on
    // login + on relevant user actions, so the longer interval doesn't
    // delay the first reflection of approval.
    const interval = setInterval(() => {
      checkSubscriptionStatus(user.email ?? undefined, user.phone ?? undefined);
    }, 120000);

    return () => clearInterval(interval);
  }, [user?.email, user?.phone]);

  const setUser = useAppStore((state) => state.setUser);
  const setUserRole = useAppStore((state) => state.setUserRole);

  const { statusToasts, pushStatusToast, dismissStatusToast } = useStatusToastQueue();

  // State for search, notifications, phone verification
  const [showSearchModal, setShowSearchModal] = useState(false);
  const [showAdvancedSearch, setShowAdvancedSearch] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);
  const [showPhoneModal, setShowPhoneModal] = useState(false);

  const refreshUser = useCallback(async () => {
    try {
      const url = new URL('/api/auth/me', getApiUrl());
      const res = await apiRequest('GET', url.toString());
      const freshUser = await res.json() as any;
      if (freshUser) {
        setUser(freshUser);
        setUserRole(freshUser.role || 'user');
      }
    } catch {}
  }, [setUser, setUserRole]);

  // Header palette — Luxury Dining 2026 (warm ivory + graphite + gold).
  // We keep a fixed light header so the gold/burgundy iconography stays
  // legible regardless of the theme/mood the rest of the app is in.
  const headerBgColor = '#FBF6EC';        // warm ivory
  const headerTextColor = '#1B1B1F';      // graphite
  const headerIconColor = '#1B1B1F';      // graphite
  // Use a deeper antique gold for the small uppercase brand label so the
  // gold-on-ivory contrast clears WCAG AA at 12pt (~5.1:1 vs 3.4:1 for
  // the lighter #A98432). Larger gold accents elsewhere can stay brighter.
  const brandAccentColor = '#876615';     // antique gold (AA-safe at 12pt)

  const handleMoodSelect = () => {
    // Mood selection removed - Neon Night is default
  };

  return (
    <View style={[
      styles.container, 
      { 
        backgroundColor: headerBgColor,
        paddingTop: insets.top,
        borderBottomColor: isDark ? '#e0e0e0' : colors.border,
      }
    ]}>
      <StatusBar
        barStyle="dark-content"
        backgroundColor={headerBgColor}
      />
      
      <View style={[styles.content, isRTL && styles.contentRTL]}>
        {/* Logo Section with Brand Text - Far right in RTL, Far left in LTR */}
        {!showBack && (
          <TouchableOpacity 
            style={[styles.logoSection, isRTL && styles.logoSectionRTL]}
            onPress={() => router.push('/')}
            activeOpacity={0.9}
          >
            <Image
              source={LOGO_IMAGE}
              style={styles.logoImage}
              contentFit="contain"
              cachePolicy="memory-disk"
            />
            <Text style={[styles.brandText, { color: brandAccentColor }]}>
              {isRTL ? 'تجربة طعام فاخرة' : 'LUXURY DINING'}
            </Text>
          </TouchableOpacity>
        )}

        {/* Back Button with Title - Only when showBack is true */}
        {showBack && (
          <View style={[styles.backSection, isRTL && styles.backSectionRTL]}>
            <TouchableOpacity onPress={() => router.back()} style={styles.iconButton}>
              <Ionicons 
                name={isRTL ? 'arrow-forward' : 'arrow-back'} 
                size={24} 
                color={headerIconColor} 
              />
            </TouchableOpacity>
            {title && (
              <Text style={[styles.title, { color: headerTextColor }]} numberOfLines={1}>
                {title}
              </Text>
            )}
          </View>
        )}

        {/* Center Section - Title (when no back button) */}
        <View style={styles.centerSection}>
          {!showBack && !title && (
            <View style={{ flex: 1 }} />
          )}
        </View>

        {/* Icons Section - Far left in RTL, Far right in LTR */}
        <View style={[styles.iconsSection, isRTL && styles.iconsSectionRTL]}>
          {/* Phone icon: amber call-outline if not verified, WhatsApp if verified */}
          {user && !user.phone_verified && (
            <TouchableOpacity onPress={() => setShowPhoneModal(true)} style={styles.iconButton}>
              <Ionicons name="call-outline" size={22} color="#25D366" />
              <View style={styles.phoneBadge} />
            </TouchableOpacity>
          )}
          {user && user.phone_verified && (
            <TouchableOpacity
              onPress={() => {
                const msg = encodeURIComponent('ارسل لي كل العروض والصفقات وكل ما هو جديد في عالم المطاعم والطعام الفاخر');
                const url = `https://wa.me/0201011033571?text=${msg}`;
                if (Platform.OS === 'web') { window.open(url, '_blank'); }
                else { Linking.openURL(url); }
              }}
              style={[styles.iconButton, { backgroundColor: '#fcfeff' }]}
            >
              <Ionicons name="logo-whatsapp" size={25} color="#25D366" />
            </TouchableOpacity>
          )}

          {/* Subscription Request Icon - Different states */}
          <TouchableOpacity 
            onPress={() => {
              if (effectiveStatus === 'none') {
                router.push('/subscription-request');
              }
            }} 
            style={[
              styles.iconButton, 
              effectiveStatus === 'subscriber' && styles.subscriberIconButton,
              effectiveStatus === 'pending' && styles.pendingIconButton,
            ]}
            disabled={effectiveStatus !== 'none'}
          >
            <Ionicons 
              name={
                effectiveStatus === 'subscriber' ? "card" : 
                effectiveStatus === 'pending' ? "time" : 
                "card-outline"
              }
              size={22} 
              color={
                effectiveStatus === 'subscriber' ? '#FFD700' : 
                effectiveStatus === 'pending' ? '#F59E0B' : 
                headerIconColor
              }
            />
            {effectiveStatus === 'subscriber' && (
              <View style={styles.goldenBadge}>
                <Ionicons name="star" size={8} color="#FFD700" />
              </View>
            )}
            {effectiveStatus === 'pending' && (
              <View style={styles.pendingBadge}>
                <Ionicons name="hourglass" size={8} color="#F59E0B" />
              </View>
            )}
          </TouchableOpacity>

          {/* Profile/User Icon */}
          <TouchableOpacity 
            onPress={() => router.push('/(tabs)/profile')} 
            style={styles.iconButton}
          >
            <Ionicons 
              name={user ? 'person' : 'person-outline'} 
              size={22} 
              color={headerIconColor} 
            />
          </TouchableOpacity>

          {showCart && (
            <TouchableOpacity 
              onPress={() => router.push('/(tabs)/cart')} 
              style={styles.iconButton}
            >
              <Ionicons name="bag-handle-outline" size={22} color={headerIconColor} />
              {cartCount > 0 && (
                <View style={[styles.badge, { backgroundColor: colors.error }]}>
                  <Text style={styles.badgeText}>{cartCount > 9 ? '9+' : cartCount}</Text>
                </View>
              )}
            </TouchableOpacity>
          )}

          {/* Dark Mode Toggle */}
          <TouchableOpacity onPress={() => toggleTheme(theme === 'dark' ? 'light' : 'dark')} style={styles.iconButton}>
            <Ionicons 
              name={isDark ? 'sunny' : 'moon'} 
              size={22} 
              color={headerIconColor} 
            />
          </TouchableOpacity>

          {/* Sync Indicator - Now between mode switch and language */}
          <SyncIndicator compact={true} showLabel={false} />

          {/* Language Toggle */}
          <TouchableOpacity 
            onPress={async () => {
              const next = language === 'en' ? 'ar' : 'en';
              setLanguage(next);
              if (user) {
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
              }
            }} 
            style={styles.iconButton}
          >
            <Text style={[styles.langText, { color: headerIconColor }]}>
              {language === 'en' ? 'عر' : 'EN'}
            </Text>
          </TouchableOpacity>

          {/* Notification Bell */}
          <NotificationBell onPress={() => setShowNotifications(true)} />

          {/* Admin Panel Icon - Only visible for authorized admins */}
          {user && ADMIN_EMAILS.includes(user.email?.toLowerCase()) && (
            <TouchableOpacity 
              onPress={() => router.push('/admin')} 
              style={styles.iconButton}
            >
              <Ionicons name="shield-checkmark" size={22} color="#8B5CF6" />
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* Global Search Modal (Legacy - can be removed) */}
      <GlobalSearch visible={showSearchModal} onClose={() => setShowSearchModal(false)} />

      {/* Advanced Search Bottom Sheet */}
      <AdvancedSearch visible={showAdvancedSearch} onClose={() => setShowAdvancedSearch(false)} />

      {/* Notification Center */}
      <NotificationCenter visible={showNotifications} onClose={() => setShowNotifications(false)} />

      {/* Phone Verification Modal */}
      <PhoneVerificationModal
        visible={showPhoneModal}
        onClose={() => setShowPhoneModal(false)}
        onVerified={async (phone) => {
          setShowPhoneModal(false);
          await refreshUser();
        }}
      />

      {/* Language preference error toasts */}
      <OrderStatusToastStack toasts={statusToasts} onDismiss={dismissStatusToast} />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    borderBottomWidth: 1.9,
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 9,
    height: 59.5,
  },
  contentRTL: {
    flexDirection: 'row-reverse',
  },
  logoSection: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 0,
  },
  logoSectionRTL: {
    flexDirection: 'row-reverse',
  },
  logoImage: {
    width: 55.5,
    height: 55.5,
    marginRight: 0,
  },
  brandText: {
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 2.4,           // wide editorial tracking
    textTransform: 'uppercase',
    marginLeft: 2,
  },
  backSection: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  backSectionRTL: {
    flexDirection: 'row-reverse',
  },
  title: {
    fontSize: 17,
    fontWeight: '600',
  },
  centerSection: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconsSection: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  iconsSectionRTL: {
    flexDirection: 'row-reverse',
  },
  iconButton: {
    padding: 3.9,
    position: 'relative',
  },
  subscriberIconButton: {
    opacity: 0.9,
  },
  pendingIconButton: {
    opacity: 0.85,
  },
  goldenBadge: {
    position: 'absolute',
    top: 2,
    right: 2,
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: 'rgba(255, 215, 0, 0.3)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  pendingBadge: {
    position: 'absolute',
    top: 2,
    right: 2,
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: 'rgba(245, 158, 11, 0.3)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  phoneBadge: {
    position: 'absolute',
    top: 2,
    right: 2,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#F59E0B',
    borderWidth: 1.5,
    borderColor: '#FFF',
  },
  langText: {
    fontSize: 13,
    fontWeight: '700',
  },
  badge: {
    position: 'absolute',
    top: 0,
    right: 0,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: {
    color: '#FFF',
    fontSize: 9,
    fontWeight: '700',
  },
  // Mood Switcher styles
  moodOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-start',
    paddingTop: 120,
  },
  moodContainer: {
    marginHorizontal: 16,
    backgroundColor: '#FFF',
    borderRadius: 20,
    padding: 20,
    ...Platform.select({
      web: {
        boxShadow: '0px 4px 12px rgba(0, 0, 0, 0.2)',
      },
      default: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.2,
        shadowRadius: 12,
        elevation: 8,
      },
    }),
  },
  moodTitle: {
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 16,
    textAlign: 'center',
    color: '#1a1a2e',
  },
  moodGrid: {
    flexDirection: 'row',
    gap: 12,
  },
  moodItem: {
    width: 80,
    height: 90,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    gap: 8,
  },
  moodItemActive: {
    borderWidth: 3,
    transform: [{ scale: 1.05 }],
  },
  moodIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  moodName: {
    fontSize: 11,
    fontWeight: '600',
  },
});
