import React, { useEffect, useRef, useState } from 'react';
import { View, TouchableOpacity, StyleSheet, Platform, Animated } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, usePathname } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../hooks/useTheme';
import { useCartQuery } from '../hooks/queries/useShoppingHubQuery';
import { Text } from 'react-native';
import { useTranslation } from '../hooks/useTranslation';
import { NotificationBell, NotificationCenter } from './ui/NotificationCenter';

interface FooterProps {
  visible?: boolean;
}

function CartBadge({ count }: { count: number }) {
  const scale = useRef(new Animated.Value(count > 0 ? 1 : 0)).current;
  const prevCount = useRef(count);

  useEffect(() => {
    if (count > 0) {
      if (prevCount.current !== count) {
        Animated.sequence([
          Animated.spring(scale, { toValue: 1.4, useNativeDriver: true, speed: 30 }),
          Animated.spring(scale, { toValue: 1, useNativeDriver: true, speed: 20 }),
        ]).start();
      } else {
        Animated.spring(scale, { toValue: 1, useNativeDriver: true, speed: 25 }).start();
      }
    } else {
      Animated.spring(scale, { toValue: 0, useNativeDriver: true, speed: 25 }).start();
    }
    prevCount.current = count;
  }, [count]);

  if (count <= 0) return null;
  return (
    <Animated.View style={[styles.badge, { transform: [{ scale }] }]}>
      <Text style={styles.badgeText}>{count > 99 ? '99+' : count}</Text>
    </Animated.View>
  );
}

export const Footer: React.FC<FooterProps> = ({ visible = true }) => {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const router = useRouter();
  const pathname = usePathname();
  const insets = useSafeAreaInsets();
  const { data: cartQueryData } = useCartQuery();
  const cartCount = (cartQueryData ?? []).reduce((sum: number, item: any) => sum + (item.quantity || 0), 0);
  const [showNotifications, setShowNotifications] = useState(false);

  if (!visible) return null;

  const tabs = [
    { name: 'home',       icon: 'home',    route: '/',           label: t('home') },
    { name: 'categories', icon: 'grid',    route: '/categories', label: t('categories') },
    { name: 'cart',       icon: 'bag-handle', route: '/cart',    label: t('cart'), badge: cartCount },
    { name: 'profile',    icon: 'person',  route: '/profile',    label: t('profile') },
  ];

  const isActive = (route: string) => {
    if (route === '/') return pathname === '/' || pathname === '/index';
    return pathname.startsWith(route);
  };

  return (
    <>
      <View
        style={[
          styles.container,
          {
            backgroundColor: colors.tabBar,
            borderTopColor: colors.border,
            paddingBottom: insets.bottom > 0 ? insets.bottom : 8,
          },
        ]}
      >
        {tabs.map((tab) => {
          const active = isActive(tab.route);
          return (
            <TouchableOpacity
              key={tab.name}
              style={styles.tabButton}
              onPress={() => router.push(tab.route as any)}
            >
              <View style={styles.iconContainer}>
                <Ionicons
                  name={(active ? tab.icon : `${tab.icon}-outline`) as any}
                  size={21}
                  color={active ? colors.tabBarActive : colors.tabBarInactive}
                />
                {tab.badge !== undefined && <CartBadge count={tab.badge} />}
              </View>
              <Text
                style={[
                  styles.tabLabel,
                  { color: active ? colors.tabBarActive : colors.tabBarInactive },
                ]}
              >
                {tab.label}
              </Text>
            </TouchableOpacity>
          );
        })}

        {/* Notification Bell Tab */}
        <TouchableOpacity
          style={styles.tabButton}
          onPress={() => setShowNotifications(true)}
        >
          <NotificationBell onPress={() => setShowNotifications(true)} />
          <Text style={[styles.tabLabel, { color: colors.tabBarInactive }]}>
            {t('notifications') || 'الإشعارات'}
          </Text>
        </TouchableOpacity>
      </View>

      <NotificationCenter
        visible={showNotifications}
        onClose={() => setShowNotifications(false)}
      />
    </>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    borderTopWidth: 1.5,
    paddingTop: 1.5,
  },
  tabButton: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 1.5,
  },
  iconContainer: {
    position: 'relative',
  },
  badge: {
    position: 'absolute',
    top: -6,
    right: -10,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: '#EF4444',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
    borderWidth: 1.5,
    borderColor: '#FFF',
    ...Platform.select({
      android: { elevation: 3 },
      default: {},
    }),
  },
  badgeText: {
    color: '#FFF',
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: -0.3,
  },
  tabLabel: {
    fontSize: 11,
    fontWeight: '600',
    marginTop: 1,
  },
});
