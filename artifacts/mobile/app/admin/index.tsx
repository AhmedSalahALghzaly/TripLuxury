import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useTheme } from '../../src/hooks/useTheme';
import { useTranslation } from '../../src/hooks/useTranslation';
import { useAppStore, useCanAccessAdminPanel, NEON_NIGHT_THEME } from '../../src/store/appStore';
import { Header } from '../../src/components/Header';
import { AdminPerformanceDashboard } from '../../src/components/AdminPerformanceDashboard';
import { authApi, adminApi } from '../../src/services/api';

const FALLBACK_ADMIN_EMAILS: string[] = [];

interface AdminSection {
  id: string;
  title: string;
  titleAr: string;
  icon: string;
  route: string;
  color: string;
}

const ADMIN_SECTIONS: AdminSection[] = [
  { id: 'dashboard', title: 'Dashboard', titleAr: 'لوحة الأداء', icon: 'bar-chart', route: '/admin/dashboard', color: '#10b981' },
  { id: 'marketing', title: 'Marketing Suite', titleAr: 'جناح التسويق', icon: 'megaphone', route: '/admin/marketing', color: '#e11d48' },
  { id: 'car-brands', title: 'Cuisine Origins', titleAr: 'منشأ المطبخ', icon: 'restaurant', route: '/admin/car-brands', color: '#3b82f6' },
  { id: 'models', title: 'Restaurants', titleAr: 'المطاعم', icon: 'storefront', route: '/admin/models', color: '#8b5cf6' },
  { id: 'product-brands', title: 'Chef Brands', titleAr: 'ماركات الشيف', icon: 'people-circle', route: '/admin/product-brands', color: '#06b6d4' },
  { id: 'categories', title: 'Categories', titleAr: 'الفئات', icon: 'grid', route: '/admin/categories', color: '#10b981' },
  { id: 'products', title: 'Products', titleAr: 'المنتجات', icon: 'cube', route: '/admin/products', color: '#f59e0b' },
  { id: 'price-hide', title: 'Price or Hide', titleAr: 'السعر أو الإخفاء', icon: 'eye-off', route: '/admin/price-hide', color: '#ef4444' },
  { id: 'customers', title: 'Customers', titleAr: 'العملاء', icon: 'people', route: '/admin/customers', color: '#ec4899' },
  { id: 'ratings', title: 'Ratings', titleAr: 'التقييمات', icon: 'star', route: '/admin/ratings', color: '#F59E0B' },
];

const KB_SECTION_COLOR = '#7C3AED';

export default function AdminPanel() {
  const { colors } = useTheme();
  const { language, isRTL } = useTranslation();
  const router = useRouter();
  const { user, userRole, setUserRole, admins } = useAppStore();
  const canAccessAdminPanel = useCanAccessAdminPanel();
  const [loading, setLoading] = useState(true);
  const [hasAccess, setHasAccess] = useState(false);

  // Check access on mount - synchronize with server
  useEffect(() => {
    const checkAccess = async () => {
      if (!user) {
        setLoading(false);
        setHasAccess(false);
        return;
      }

      try {
        // First check from store hook
        if (canAccessAdminPanel) {
          setHasAccess(true);
          setLoading(false);
          return;
        }

        // Check fallback emails
        const email = user.email?.toLowerCase();
        if (FALLBACK_ADMIN_EMAILS.includes(email)) {
          setHasAccess(true);
          setLoading(false);
          return;
        }

        // Check if user is in admins list
        const isInAdminsList = admins.some(
          (a: any) => a.email?.toLowerCase() === email
        );
        if (isInAdminsList) {
          setHasAccess(true);
          // Update role in store
          setUserRole('admin');
          setLoading(false);
          return;
        }

        // Refresh from server as last resort
        const response = await authApi.getMe();
        if (response.data?.role && ['owner', 'partner', 'admin'].includes(response.data.role)) {
          setHasAccess(true);
          setUserRole(response.data.role);
        }
      } catch (error) {
        console.log('Error checking admin access:', error);
      } finally {
        setLoading(false);
      }
    };

    checkAccess();
  }, [user, canAccessAdminPanel, admins, setUserRole]);

  // Show loading state
  if (loading) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
        <Header title={language === 'ar' ? 'لوحة التحكم' : 'Admin Panel'} showBack showSearch={false} showCart={false} />
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={NEON_NIGHT_THEME.primary} />
          <Text style={[styles.loadingText, { color: colors.textSecondary }]}>
            {language === 'ar' ? 'جاري التحقق...' : 'Checking access...'}
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  // Check admin access - using dynamic role check
  if (!hasAccess) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
        <Header title={language === 'ar' ? 'لوحة التحكم' : 'Admin Panel'} showBack showSearch={false} showCart={false} />
        <View style={styles.accessDenied}>
          <Ionicons name="lock-closed" size={64} color={colors.error} />
          <Text style={[styles.accessDeniedText, { color: colors.text }]}>
            {language === 'ar' ? 'غير مصرح بالدخول' : 'Access Denied'}
          </Text>
          <Text style={[styles.accessDeniedSubtext, { color: colors.textSecondary }]}>
            {language === 'ar' ? 'ليس لديك صلاحية الوصول لهذه الصفحة' : 'You do not have permission to access this page'}
          </Text>
          <Text style={[styles.accessDeniedHint, { color: colors.textSecondary }]}>
            {language === 'ar' ? 'تواصل مع المالك للحصول على صلاحية الإدارة' : 'Contact the owner to get admin access'}
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['bottom']}>
      <Header title={language === 'ar' ? 'لوحة التحكم' : 'Admin Panel'} showBack showSearch={false} showCart={false} />
      
      <ScrollView style={styles.scrollView} contentContainerStyle={styles.contentContainer}>
        <View style={[styles.welcomeCard, { backgroundColor: colors.primary }]}>
          <Ionicons name="shield-checkmark" size={32} color="#FFF" />
          <View style={styles.welcomeText}>
            <Text style={styles.welcomeTitle}>
              {language === 'ar' ? 'مرحباً بك في لوحة التحكم' : 'Welcome to Admin Panel'}
            </Text>
            <Text style={styles.welcomeSubtitle}>
              {user?.name || user?.email}
            </Text>
          </View>
        </View>

        <AdminPerformanceDashboard compact />

        <View style={styles.sectionsContainer}>
          {ADMIN_SECTIONS.map((section) => (
            <TouchableOpacity
              key={section.id}
              style={[styles.sectionButton, { backgroundColor: colors.card, borderColor: colors.border }]}
              onPress={() => router.push(section.route as any)}
              activeOpacity={0.7}
            >
              <View style={[styles.iconContainer, { backgroundColor: section.color + '20' }]}>
                <Ionicons name={section.icon as any} size={28} color={section.color} />
                <View style={[styles.plusBadge, { backgroundColor: section.color }]}>
                  <Ionicons name="add" size={14} color="#FFF" />
                </View>
              </View>
              <Text style={[styles.sectionTitle, { color: colors.text }, isRTL && styles.textRTL]}>
                {language === 'ar' ? section.titleAr : section.title}
              </Text>
              <Ionicons 
                name={isRTL ? 'chevron-back' : 'chevron-forward'} 
                size={20} 
                color={colors.textSecondary} 
              />
            </TouchableOpacity>
          ))}

          {/* Owner-only: Train AI Agent / Knowledge Base */}
          {userRole === 'owner' && (
            <>
              <View style={styles.ownerDivider}>
                <View style={[styles.dividerLine, { backgroundColor: colors.border }]} />
                <Text style={[styles.dividerLabel, { color: KB_SECTION_COLOR }]}>
                  {language === 'ar' ? 'خاص بالمالك' : 'Owner Only'}
                </Text>
                <View style={[styles.dividerLine, { backgroundColor: colors.border }]} />
              </View>
              <TouchableOpacity
                style={[styles.sectionButton, styles.ownerSectionButton, { borderColor: `${KB_SECTION_COLOR}40` }]}
                onPress={() => router.push('/owner/knowledge-base')}
                activeOpacity={0.7}
              >
                <View style={[styles.iconContainer, { backgroundColor: `${KB_SECTION_COLOR}20` }]}>
                  <Ionicons name="school" size={28} color={KB_SECTION_COLOR} />
                  <View style={[styles.plusBadge, { backgroundColor: KB_SECTION_COLOR }]}>
                    <Ionicons name="sparkles" size={10} color="#FFF" />
                  </View>
                </View>
                <Text style={[styles.sectionTitle, { color: KB_SECTION_COLOR }, isRTL && styles.textRTL]}>
                  {language === 'ar' ? 'تدريب المساعد الذكي' : 'Train AI Agent'}
                </Text>
                <Ionicons
                  name={isRTL ? 'chevron-back' : 'chevron-forward'}
                  size={20}
                  color={KB_SECTION_COLOR}
                />
              </TouchableOpacity>
            </>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollView: {
    flex: 1,
  },
  contentContainer: {
    padding: 16,
  },
  welcomeCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 20,
    borderRadius: 16,
    marginBottom: 24,
  },
  welcomeText: {
    marginLeft: 16,
    flex: 1,
  },
  welcomeTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#FFF',
    marginBottom: 4,
  },
  welcomeSubtitle: {
    fontSize: 14,
    color: 'rgba(255,255,255,0.8)',
  },
  sectionsContainer: {
    gap: 12,
  },
  sectionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
  },
  iconContainer: {
    width: 56,
    height: 56,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  plusBadge: {
    position: 'absolute',
    top: -4,
    right: -4,
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sectionTitle: {
    flex: 1,
    fontSize: 16,
    fontWeight: '600',
    marginLeft: 16,
  },
  textRTL: {
    textAlign: 'right',
    marginLeft: 0,
    marginRight: 16,
  },
  ownerSectionButton: {
    backgroundColor: '#F5F3FF',
  },
  ownerDivider: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginVertical: 4,
  },
  dividerLine: {
    flex: 1,
    height: 1,
  },
  dividerLabel: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  accessDenied: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  accessDeniedText: {
    fontSize: 24,
    fontWeight: '700',
    marginTop: 16,
  },
  accessDeniedSubtext: {
    fontSize: 14,
    marginTop: 8,
    textAlign: 'center',
  },
  accessDeniedHint: {
    fontSize: 12,
    marginTop: 6,
    textAlign: 'center',
    fontStyle: 'italic',
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  loadingText: {
    fontSize: 14,
  },
});
