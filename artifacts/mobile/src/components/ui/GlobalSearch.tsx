/**
 * Global Search Component
 * Real-time fuzzy search with ROLE-BASED DATA SCOPING
 * 
 * Data Universe Logic:
 * - Regular User: Products, Brands, Models only
 * - Subscriber: User data + Suppliers, Distributors
 * - Admin: User data + Suppliers, Distributors
 * - Owner/Partner: ALL data entities
 */
import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ScrollView,
  Keyboard,
  Dimensions,
  Modal,
} from 'react-native';
import { BlurView } from 'expo-blur';
import { Ionicons } from '@expo/vector-icons';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withSpring,
  FadeIn,
  FadeOut,
} from 'react-native-reanimated';
import { useAppStore } from '../../store/appStore';
import { useRouter } from 'expo-router';
import { getOpenStatusFromSchedule, getOpenStatus } from '../../utils/timeUtils';

const { height: SCREEN_HEIGHT } = Dimensions.get('window');

// Owner email constant
const OWNER_EMAIL = 'pc.2025.ai@gmail.com';

interface SearchResult {
  id: string;
  type: 'product' | 'brand' | 'model' | 'customer' | 'admin' | 'supplier' | 'distributor' | 'partner';
  title: string;
  subtitle: string;
  icon: string;
  color: string;
  route?: string;
}

interface GlobalSearchProps {
  visible: boolean;
  onClose: () => void;
}

// Simple fuzzy match function
const fuzzyMatch = (text: string, query: string): boolean => {
  if (!query) return true;
  const lowerText = text.toLowerCase();
  const lowerQuery = query.toLowerCase();
  
  // Check if all characters in query appear in order in text
  let queryIndex = 0;
  for (let i = 0; i < lowerText.length && queryIndex < lowerQuery.length; i++) {
    if (lowerText[i] === lowerQuery[queryIndex]) {
      queryIndex++;
    }
  }
  
  return queryIndex === lowerQuery.length || lowerText.includes(lowerQuery);
};

export const GlobalSearch: React.FC<GlobalSearchProps> = ({ visible, onClose }) => {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const inputRef = useRef<TextInput>(null);
  
  // Get data from Zustand store
  const products = useAppStore((state) => state.products);
  const carBrands = useAppStore((state) => state.carBrands);
  const carModels = useAppStore((state) => state.carModels);
  const productBrands = useAppStore((state) => state.productBrands);
  const customers = useAppStore((state) => state.customers);
  const admins = useAppStore((state) => state.admins);
  const suppliers = useAppStore((state) => state.suppliers);
  const distributors = useAppStore((state) => state.distributors);
  const partners = useAppStore((state) => state.partners);
  const language = useAppStore((state) => state.language);
  const user = useAppStore((state) => state.user);
  const userRole = useAppStore((state) => state.userRole);
  const subscribers = useAppStore((state) => state.subscribers);

  // Read cached opening-hours from the store (populated by useRestaurantHoursMap on other screens)
  const hoursMap = useAppStore((state) => state.restaurantHoursMap);

  // Determine user's data access level
  const getUserAccessLevel = useMemo(() => {
    if (!user) return 'guest';
    
    // Check if owner
    if (user.email?.toLowerCase() === OWNER_EMAIL.toLowerCase()) return 'owner';
    
    // Check if partner
    if (partners?.some((p: any) => p.email?.toLowerCase() === user.email?.toLowerCase())) return 'owner';
    
    // Check if admin
    if (userRole === 'admin' || admins?.some((a: any) => a.email?.toLowerCase() === user.email?.toLowerCase())) return 'admin';
    
    // Check if subscriber
    if (subscribers?.some((s: any) => s.email?.toLowerCase() === user.email?.toLowerCase())) return 'subscriber';
    
    return 'user';
  }, [user, userRole, partners, admins, subscribers]);

  // Animation
  const overlayOpacity = useSharedValue(0);
  const contentTranslateY = useSharedValue(SCREEN_HEIGHT);

  useEffect(() => {
    if (visible) {
      overlayOpacity.value = withTiming(1, { duration: 200 });
      contentTranslateY.value = withSpring(0, { damping: 20 });
      setTimeout(() => inputRef.current?.focus(), 300);
    } else {
      overlayOpacity.value = withTiming(0, { duration: 200 });
      contentTranslateY.value = withTiming(SCREEN_HEIGHT, { duration: 200 });
      setQuery('');
    }
  }, [visible]);

  // Search results with ROLE-BASED DATA SCOPING
  const results = useMemo((): SearchResult[] => {
    if (!query || query.length < 2) return [];

    const allResults: SearchResult[] = [];
    const accessLevel = getUserAccessLevel;

    // === PRODUCTS (Available to ALL users) ===
    if (Array.isArray(products)) {
      products.forEach((p: any) => {
        const name = language === 'ar' ? (p.name_ar || p.name) : p.name;
        if (fuzzyMatch(name || '', query) || fuzzyMatch(p.sku || '', query)) {
          allResults.push({
            id: p.id,
            type: 'product',
            title: name || p.name,
            subtitle: `SKU: ${p.sku || 'N/A'} • ${p.price || 0} ج.م`,
            icon: 'cube',
            color: '#3B82F6',
            route: `/product/${p.id}`,
          });
        }
      });
    }

    // === CAR BRANDS (Available to ALL users) ===
    if (Array.isArray(carBrands)) {
      carBrands.forEach((b: any) => {
        const name = language === 'ar' ? (b.name_ar || b.name) : b.name;
        if (fuzzyMatch(name || '', query)) {
          allResults.push({
            id: b.id,
            type: 'brand',
            title: name || b.name,
            subtitle: language === 'ar' ? 'مطبخ عالمي' : 'Cuisine',
            icon: 'restaurant-outline',
            color: '#F59E0B',
            route: `/brand/${b.id}`,
          });
        }
      });
    }

    // === CAR MODELS (Available to ALL users) ===
    if (Array.isArray(carModels)) {
      carModels.forEach((m: any) => {
        const name = language === 'ar' ? (m.name_ar || m.name) : m.name;
        if (fuzzyMatch(name || '', query)) {
          const schedule = hoursMap[m.id];
          const status =
            Array.isArray(schedule) && schedule.length > 0
              ? getOpenStatusFromSchedule(schedule, language)
              : getOpenStatus(m.year_start, m.year_end, language);
          allResults.push({
            id: m.id,
            type: 'model',
            title: name || m.name,
            subtitle: status
              ? (status.sublabel ? `${status.label} · ${status.sublabel}` : status.label)
              : '',
            icon: 'car',
            color: status?.isOpen ? '#22c55e' : '#8B5CF6',
            route: `/car/${m.id}`,
          });
        }
      });
    }

    // === PRODUCT BRANDS (Available to ALL users) ===
    if (Array.isArray(productBrands)) {
      productBrands.forEach((b: any) => {
        const name = language === 'ar' ? (b.name_ar || b.name) : b.name;
        if (fuzzyMatch(name || '', query)) {
          allResults.push({
            id: b.id,
            type: 'brand',
            title: name || b.name,
            subtitle: language === 'ar' ? 'علامة منتج' : 'Product Brand',
            icon: 'pricetag',
            color: '#06B6D4',
          });
        }
      });
    }

    // === SUPPLIERS & DISTRIBUTORS (Subscriber, Admin, Owner only) ===
    if (['subscriber', 'admin', 'owner'].includes(accessLevel)) {
      if (Array.isArray(suppliers)) {
        suppliers.forEach((s: any) => {
        if (fuzzyMatch(s.name || '', query) || fuzzyMatch(s.contact_email || '', query)) {
          allResults.push({
            id: s.id,
            type: 'supplier',
            title: s.name,
            subtitle: s.contact_email || s.phone || '',
            icon: 'briefcase',
            color: '#14B8A6',
            route: `/owner/suppliers`,
          });
        }
      });
      }

      if (Array.isArray(distributors)) {
        distributors.forEach((d: any) => {
          if (fuzzyMatch(d.name || '', query) || fuzzyMatch(d.contact_email || '', query)) {
            allResults.push({
              id: d.id,
              type: 'distributor',
              title: d.name,
              subtitle: d.contact_email || d.phone || '',
              icon: 'send',
              color: '#EC4899',
              route: `/owner/distributors`,
            });
          }
        });
      }
    }

    // === CUSTOMERS, ADMINS, PARTNERS (Owner/Partner only) ===
    if (accessLevel === 'owner') {
      // Customers
      if (Array.isArray(customers)) {
        customers.forEach((c: any) => {
          if (fuzzyMatch(c.name || '', query) || fuzzyMatch(c.email || '', query)) {
            allResults.push({
              id: c.id,
              type: 'customer',
              title: c.name || c.email,
              subtitle: c.email,
              icon: 'person',
              color: '#10B981',
              route: `/owner/customers`,
            });
          }
        });
      }

      // Admins
      if (Array.isArray(admins)) {
        admins.forEach((a: any) => {
          if (fuzzyMatch(a.name || '', query) || fuzzyMatch(a.email || '', query)) {
            allResults.push({
              id: a.id,
              type: 'admin',
              title: a.name || a.email,
              subtitle: `Revenue: ${a.revenue || 0} ج.م`,
              icon: 'shield-checkmark',
              color: '#8B5CF6',
              route: `/owner/admins`,
            });
          }
        });
      }

      // Partners
      if (Array.isArray(partners)) {
        partners.forEach((p: any) => {
          if (fuzzyMatch(p.name || '', query) || fuzzyMatch(p.email || '', query)) {
            allResults.push({
              id: p.id,
              type: 'partner',
              title: p.name || p.email,
              subtitle: p.email,
              icon: 'people',
              color: '#6366F1',
            });
          }
        });
      }
    }

    return allResults.slice(0, 25); // Limit results
  }, [query, products, carBrands, carModels, productBrands, customers, admins, suppliers, distributors, partners, language, getUserAccessLevel, hoursMap]);

  const handleResultPress = (result: SearchResult) => {
    onClose();
    if (result.route) {
      router.push(result.route as any);
    }
  };

  const overlayStyle = useAnimatedStyle(() => ({
    opacity: overlayOpacity.value,
  }));

  const contentStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: contentTranslateY.value }],
  }));

  // Access level badge
  const getAccessBadge = () => {
    const level = getUserAccessLevel;
    const badges: Record<string, { text: string; color: string }> = {
      owner: { text: language === 'ar' ? 'وصول كامل' : 'Full Access', color: '#10B981' },
      admin: { text: language === 'ar' ? 'مسؤول' : 'Admin', color: '#8B5CF6' },
      subscriber: { text: language === 'ar' ? 'مشترك' : 'Subscriber', color: '#3B82F6' },
      user: { text: language === 'ar' ? 'أساسي' : 'Basic', color: '#9CA3AF' },
      guest: { text: language === 'ar' ? 'ضيف' : 'Guest', color: '#9CA3AF' },
    };
    return badges[level] || badges.guest;
  };

  if (!visible) return null;

  const accessBadge = getAccessBadge();

  return (
    <Modal transparent visible={visible} animationType="none">
      <TouchableOpacity
        style={StyleSheet.absoluteFill}
        activeOpacity={1}
        onPress={() => {
          Keyboard.dismiss();
          onClose();
        }}
      >
        <Animated.View style={[styles.overlay, overlayStyle]}>
          <BlurView intensity={30} tint="dark" style={StyleSheet.absoluteFill} />
        </Animated.View>
      </TouchableOpacity>

      <Animated.View style={[styles.container, contentStyle]} pointerEvents="box-none">
        <TouchableOpacity activeOpacity={1} style={styles.content}>
          {/* Access Level Badge */}
          <View style={styles.accessBadgeContainer}>
            <View style={[styles.accessBadge, { backgroundColor: accessBadge.color + '20' }]}>
              <View style={[styles.accessDot, { backgroundColor: accessBadge.color }]} />
              <Text style={[styles.accessText, { color: accessBadge.color }]}>
                {accessBadge.text}
              </Text>
            </View>
          </View>

          {/* Search Input */}
          <View style={styles.searchBar}>
            <Ionicons name="search" size={20} color="#9CA3AF" />
            <TextInput
              ref={inputRef}
              style={styles.input}
              placeholder={language === 'ar' ? 'ابحث في كل شيء...' : 'Search everything...'}
              placeholderTextColor="#9CA3AF"
              value={query}
              onChangeText={setQuery}
              autoCapitalize="none"
              autoCorrect={false}
            />
            {query.length > 0 && (
              <TouchableOpacity onPress={() => setQuery('')}>
                <Ionicons name="close-circle" size={20} color="#9CA3AF" />
              </TouchableOpacity>
            )}
          </View>

          {/* Results */}
          <ScrollView style={styles.results} showsVerticalScrollIndicator={false}>
            {query.length < 2 ? (
              <View style={styles.placeholder}>
                <Ionicons name="search" size={48} color="rgba(255,255,255,0.3)" />
                <Text style={styles.placeholderText}>
                  {language === 'ar' ? 'اكتب للبحث...' : 'Type to search...'}
                </Text>
                <Text style={styles.placeholderHint}>
                  {language === 'ar' 
                    ? `يمكنك البحث في: الاطباق، الوجبات، المطاعم${getUserAccessLevel !== 'user' && getUserAccessLevel !== 'guest' ? '، الموردين، الموزعين' : ''}${getUserAccessLevel === 'owner' ? '، العملاء، المسؤولين' : ''}`
                    : `Search: Dishes, Combo Meals, Restaurants${getUserAccessLevel !== 'user' && getUserAccessLevel !== 'guest' ? ', Suppliers, Distributors' : ''}${getUserAccessLevel === 'owner' ? ', Customers, Admins' : ''}`
                  }
                </Text>
              </View>
            ) : results.length === 0 ? (
              <View style={styles.placeholder}>
                <Ionicons name="alert-circle" size={48} color="rgba(255,255,255,0.3)" />
                <Text style={styles.placeholderText}>
                  {language === 'ar' ? 'لا توجد نتائج' : 'No results found'}
                </Text>
              </View>
            ) : (
              results.map((result) => (
                <TouchableOpacity
                  key={`${result.type}-${result.id}`}
                  style={styles.resultItem}
                  onPress={() => handleResultPress(result)}
                >
                  <View style={[styles.resultIcon, { backgroundColor: result.color + '30' }]}>
                    <Ionicons name={result.icon as any} size={20} color={result.color} />
                  </View>
                  <View style={styles.resultInfo}>
                    <Text style={styles.resultTitle} numberOfLines={1}>{result.title}</Text>
                    <Text style={styles.resultSubtitle} numberOfLines={1}>{result.subtitle}</Text>
                  </View>
                  <View style={styles.resultBadge}>
                    <Text style={[styles.resultBadgeText, { color: result.color }]}>
                      {result.type}
                    </Text>
                  </View>
                </TouchableOpacity>
              ))
            )}
          </ScrollView>

          {/* Close button */}
          <TouchableOpacity style={styles.closeButton} onPress={onClose}>
            <Text style={styles.closeText}>
              {language === 'ar' ? 'إغلاق' : 'Close'}
            </Text>
          </TouchableOpacity>
        </TouchableOpacity>
      </Animated.View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  container: {
    flex: 1,
    paddingTop: 100,
    paddingHorizontal: 16,
  },
  content: {
    backgroundColor: 'rgba(30,30,50,0.95)',
    borderRadius: 20,
    padding: 16,
    maxHeight: SCREEN_HEIGHT * 0.7,
  },
  accessBadgeContainer: {
    alignItems: 'center',
    marginBottom: 12,
  },
  accessBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    gap: 6,
  },
  accessDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  accessText: {
    fontSize: 12,
    fontWeight: '600',
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderRadius: 12,
    paddingHorizontal: 12,
    height: 48,
    gap: 8,
  },
  input: {
    flex: 1,
    fontSize: 16,
    color: '#FFF',
  },
  results: {
    marginTop: 16,
    maxHeight: SCREEN_HEIGHT * 0.45,
  },
  placeholder: {
    alignItems: 'center',
    paddingVertical: 40,
  },
  placeholderText: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: 14,
    marginTop: 12,
  },
  placeholderHint: {
    color: 'rgba(255,255,255,0.3)',
    fontSize: 11,
    marginTop: 8,
    textAlign: 'center',
    paddingHorizontal: 20,
  },
  resultItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: 12,
    marginBottom: 8,
  },
  resultIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  resultInfo: {
    flex: 1,
    marginLeft: 12,
  },
  resultTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: '#FFF',
  },
  resultSubtitle: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.6)',
    marginTop: 2,
  },
  resultBadge: {
    backgroundColor: 'rgba(255,255,255,0.1)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  resultBadgeText: {
    fontSize: 10,
    fontWeight: '600',
    textTransform: 'uppercase',
  },
  closeButton: {
    marginTop: 16,
    alignItems: 'center',
    paddingVertical: 12,
  },
  closeText: {
    color: '#8B5CF6',
    fontSize: 16,
    fontWeight: '600',
  },
});

export default GlobalSearch;
