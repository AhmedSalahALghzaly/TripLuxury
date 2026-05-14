/**
 * New Entity Dashboard - Quick Access for all owner actions
 * 2 grids of 6 circular icons each
 */
import React, { useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Platform,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useAppStore } from '../../src/store/appStore';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withSequence,
} from 'react-native-reanimated';

import { AccessGuard as __AccessGuard__ } from '../../src/components/AccessGuard';
function NewEntityDashboard() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const language = useAppStore((state) => state.language);
  const isRTL = language === 'ar';

  const handlePress = useCallback((route: string) => {
    if (Platform.OS !== 'web') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    router.push(route as any);
  }, [router]);

  const BUSINESS_ENTITIES = [
    {
      icon: 'briefcase' as const,
      labelAr: 'فندق/قاعة',
      label: 'Hotel/Venue',
      color: '#14B8A6',
      gradient: ['#0D9488', '#14B8A6'] as [string, string],
      route: '/owner/add-entity-form?entityType=supplier',
    },
    {
      icon: 'car' as const,
      labelAr: 'توصيل',
      label: 'Delivery Co.',
      color: '#F87171',
      gradient: ['#DC2626', '#F87171'] as [string, string],
      route: '/owner/add-entity-form?entityType=distributor',
    },
    {
      icon: 'people' as const,
      labelAr: 'العملاء',
      label: 'Customers',
      color: '#60A5FA',
      gradient: ['#2563EB', '#60A5FA'] as [string, string],
      route: '/owner/customers',
    },
    {
      icon: 'shield-checkmark' as const,
      labelAr: 'المشرفون',
      label: 'Admins',
      color: '#A78BFA',
      gradient: ['#7C3AED', '#A78BFA'] as [string, string],
      route: '/owner/admins',
    },
    {
      icon: 'card' as const,
      labelAr: 'الاشتراكات',
      label: 'Subscriptions',
      color: '#F59E0B',
      gradient: ['#D97706', '#F59E0B'] as [string, string],
      route: '/owner/subscriptions',
    },
    {
      icon: 'cash' as const,
      labelAr: 'التحصيل',
      label: 'Collection',
      color: '#34D399',
      gradient: ['#059669', '#34D399'] as [string, string],
      route: '/owner/collection',
    },
  ];

  const CATALOG_ACTIONS = [
    {
      icon: 'restaurant-outline' as const,
      labelAr: 'الماركات',
      label: 'Cuisine Origins',
      color: '#FB923C',
      gradient: ['#EA580C', '#FB923C'] as [string, string],
      route: '/car-brands',
    },
    {
      icon: 'albums' as const,
      labelAr: 'المطاعم',
      label: 'Restaurants',
      color: '#2DD4BF',
      gradient: ['#0D9488', '#2DD4BF'] as [string, string],
      route: '/models',
    },
    {
      icon: 'receipt' as const,
      labelAr: 'الطلبات',
      label: 'Orders',
      color: '#E879F9',
      gradient: ['#A21CAF', '#E879F9'] as [string, string],
      route: '/owner/orders',
    },
    {
      icon: 'bar-chart' as const,
      labelAr: 'التحليلات',
      label: 'Analytics',
      color: '#67E8F9',
      gradient: ['#0891B2', '#67E8F9'] as [string, string],
      route: '/owner/analytics',
    },
    {
      icon: 'settings' as const,
      labelAr: 'الإعدادات',
      label: 'Settings',
      color: '#94A3B8',
      gradient: ['#475569', '#94A3B8'] as [string, string],
      route: '/owner/settings',
    },
    {
      icon: 'search' as const,
      labelAr: 'البحث',
      label: 'Search',
      color: '#F472B6',
      gradient: ['#DB2777', '#F472B6'] as [string, string],
      route: '/search',
    },
  ];

  return (
    <View style={styles.container}>
      <LinearGradient
        colors={['#0F0F2E', '#1E1E4F', '#2D1B69']}
        style={StyleSheet.absoluteFill}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
      />

      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
          <Ionicons name={isRTL ? 'arrow-forward' : 'arrow-back'} size={22} color="#FFF" />
        </TouchableOpacity>
        <View style={styles.headerTextContainer}>
          <Text style={styles.headerTitle}>
            {isRTL ? 'لوحة التحكم' : 'Quick Access'}
          </Text>
          <Text style={styles.headerSubtitle}>
            {isRTL ? 'وصول سريع لجميع الخيارات' : 'All owner actions at a glance'}
          </Text>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 24 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* Group 1: Business Entities */}
        <SectionGrid
          title={isRTL ? 'الشركاء والجهات' : 'Entities & Partners'}
          items={BUSINESS_ENTITIES}
          isRTL={isRTL}
          onPress={handlePress}
        />

        {/* Group 2: Catalog & Reports */}
        <SectionGrid
          title={isRTL ? 'الكتالوج والتقارير' : 'Catalog & Reports'}
          items={CATALOG_ACTIONS}
          isRTL={isRTL}
          onPress={handlePress}
        />
      </ScrollView>
    </View>
  );
}

interface GridItem {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  labelAr: string;
  color: string;
  gradient: [string, string];
  route: string;
}

function CircleButton({ item, isRTL, onPress }: { item: GridItem; isRTL: boolean; onPress: (route: string) => void }) {
  const scale = useSharedValue(1);

  const animStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const handlePress = () => {
    scale.value = withSequence(
      withSpring(0.88, { damping: 15, stiffness: 400 }),
      withSpring(1, { damping: 15, stiffness: 400 })
    );
    setTimeout(() => onPress(item.route), 120);
  };

  return (
    <Animated.View style={[styles.circleOuter, animStyle]}>
      <TouchableOpacity onPress={handlePress} activeOpacity={0.85} style={styles.circleTouch}>
        <LinearGradient
          colors={item.gradient}
          style={styles.circleGradient}
          start={{ x: 0.2, y: 0 }}
          end={{ x: 0.8, y: 1 }}
        >
          <Ionicons name={item.icon} size={26} color="#FFF" />
        </LinearGradient>
        <Text style={styles.circleLabel} numberOfLines={1}>
          {isRTL ? item.labelAr : item.label}
        </Text>
      </TouchableOpacity>
    </Animated.View>
  );
}

function SectionGrid({
  title,
  items,
  isRTL,
  onPress,
}: {
  title: string;
  items: GridItem[];
  isRTL: boolean;
  onPress: (route: string) => void;
}) {
  return (
    <View style={styles.sectionContainer}>
      <View style={styles.sectionHeader}>
        <View style={styles.sectionLine} />
        <Text style={styles.sectionTitle}>{title}</Text>
        <View style={styles.sectionLine} />
      </View>
      <View style={[styles.grid, isRTL && styles.gridRTL]}>
        {items.map((item) => (
          <CircleButton key={item.route} item={item} isRTL={isRTL} onPress={onPress} />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    paddingHorizontal: 20,
    paddingBottom: 16,
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
  },
  headerTextContainer: {
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 26,
    fontWeight: '800',
    color: '#FFF',
    textAlign: 'center',
  },
  headerSubtitle: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.6)',
    marginTop: 6,
    textAlign: 'center',
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingTop: 8,
    gap: 28,
  },
  sectionContainer: {
    gap: 16,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  sectionLine: {
    flex: 1,
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: 'rgba(255,255,255,0.55)',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    justifyContent: 'space-between',
  },
  gridRTL: {
    flexDirection: 'row-reverse',
  },
  circleOuter: {
    width: '30%',
    alignItems: 'center',
  },
  circleTouch: {
    alignItems: 'center',
    gap: 8,
    width: '100%',
  },
  circleGradient: {
    width: 68,
    height: 68,
    borderRadius: 34,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 10,
  },
  circleLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: 'rgba(255,255,255,0.85)',
    textAlign: 'center',
    maxWidth: 80,
  },
});


/* __ACCESS_GUARD_APPLIED__ */
export default function NewEntityDashboardGuarded(props: any) {
  return (
    <__AccessGuard__ scope="owner">
      <NewEntityDashboard {...props} />
    </__AccessGuard__>
  );
}
