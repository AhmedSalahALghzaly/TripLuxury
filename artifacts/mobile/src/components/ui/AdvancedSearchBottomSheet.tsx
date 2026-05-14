/**
 * AdvancedSearchBottomSheet - Modern search popup with glass blur effect
 * Auto-resizes based on search results with smooth animations
 */
import React, { useCallback, useMemo, useRef, useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ScrollView,
  Image,
  Dimensions,
  Keyboard,
  Platform,
  Modal,
} from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withTiming,
  interpolate,
  Extrapolation,
  FadeIn,
  FadeOut,
  SlideInUp,
  SlideOutDown,
  Layout,
  runOnJS,
} from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import { BlurView } from 'expo-blur';

import { useTheme } from '../../hooks/useTheme';
import { useTranslation } from '../../hooks/useTranslation';
import { useAppStore, useColorMood } from '../../store/appStore';
import { Skeleton } from './Skeleton';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

// Golden Grid Formula: 4 columns x 2 rows layout
// ITEM_WIDTH = (SCREEN_WIDTH - (sidePadding * 2) - (gap * (columns - 1))) / columns
const SIDE_PADDING = 15;
const GRID_GAP = 5;
const ITEM_WIDTH = Math.max(59, (SCREEN_WIDTH - (SIDE_PADDING * 2) - (7 * 3)) / 4);

// Constants for height calculation
const MIN_HEIGHT = 180; // Minimum height for search bar + quick actions
const MAX_HEIGHT = SCREEN_HEIGHT * 0.85; // Maximum 85% of screen
const RESULT_ITEM_HEIGHT = 72;
const HEADER_HEIGHT = 80;

interface SearchResult {
  id: string;
  type: 'product' | 'category' | 'brand' | 'car';
  name: string;
  nameAr?: string;
  image?: string;
  price?: number;
  subtitle?: string;
}

interface AdvancedSearchBottomSheetProps {
  visible: boolean;
  onClose: () => void;
}

const AnimatedBlurView = Animated.createAnimatedComponent(BlurView);

export const AdvancedSearchBottomSheet: React.FC<AdvancedSearchBottomSheetProps> = ({
  visible,
  onClose,
}) => {
  const { colors, isDark } = useTheme();
  const { language, isRTL } = useTranslation();
  const router = useRouter();
  const mood = useColorMood();

  // Store data
  const products = useAppStore((state) => state.products);
  const categories = useAppStore((state) => state.categories);
  const carBrands = useAppStore((state) => state.carBrands);
  const carModels = useAppStore((state) => state.carModels);
  const productBrands = useAppStore((state) => state.productBrands);

  // Refs
  const searchInputRef = useRef<TextInput>(null);

  // State
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [recentSearches, setRecentSearches] = useState<string[]>([]);

  // Animations
  const sheetHeight = useSharedValue(MIN_HEIGHT);
  const backdropOpacity = useSharedValue(0);
  const translateY = useSharedValue(SCREEN_HEIGHT);

  // Calculate dynamic height based on results
  const calculateHeight = useCallback((resultsCount: number, hasQuery: boolean) => {
    if (!hasQuery) {
      // Show quick actions when no query
      return Math.min(MIN_HEIGHT + 200, MAX_HEIGHT);
    }
    if (resultsCount === 0) {
      // No results state
      return Math.min(MIN_HEIGHT + 150, MAX_HEIGHT);
    }
    // Dynamic height based on results
    const contentHeight = HEADER_HEIGHT + (resultsCount * RESULT_ITEM_HEIGHT) + 60;
    return Math.min(Math.max(contentHeight, MIN_HEIGHT), MAX_HEIGHT);
  }, []);

  // Update height when results change
  useEffect(() => {
    const newHeight = calculateHeight(results.length, query.length > 0);
    sheetHeight.value = withSpring(newHeight, {
      damping: 20,
      stiffness: 150,
      mass: 0.8,
    });
  }, [results.length, query]);

  // Open/close animation
  useEffect(() => {
    if (visible) {
      backdropOpacity.value = withTiming(1, { duration: 200 });
      translateY.value = withSpring(0, {
        damping: 25,
        stiffness: 200,
        mass: 0.8,
      });
      setTimeout(() => searchInputRef.current?.focus(), 300);
    } else {
      backdropOpacity.value = withTiming(0, { duration: 150 });
      translateY.value = withTiming(SCREEN_HEIGHT, { duration: 200 });
      setQuery('');
      setResults([]);
    }
  }, [visible]);

  // Search logic with fuzzy matching
  const performSearch = useCallback((searchQuery: string) => {
    if (!searchQuery.trim()) {
      setResults([]);
      return;
    }

    setIsSearching(true);
    const lowerQuery = searchQuery.toLowerCase();

    // Search products
    const productResults: SearchResult[] = products
      .filter((p) => {
        const matchName = p.name?.toLowerCase().includes(lowerQuery);
        const matchNameAr = p.name_ar?.toLowerCase().includes(lowerQuery);
        const matchSku = p.sku?.toLowerCase().includes(lowerQuery);
        return matchName || matchNameAr || matchSku;
      })
      .slice(0, 8)
      .map((p) => ({
        id: p.id,
        type: 'product' as const,
        name: p.name,
        nameAr: p.name_ar,
        image: p.image_url,
        price: p.price,
        subtitle: `SKU: ${p.sku}`,
      }));

    // Search categories
    const categoryResults: SearchResult[] = categories
      .filter((c) => {
        const matchName = c.name?.toLowerCase().includes(lowerQuery);
        const matchNameAr = c.name_ar?.toLowerCase().includes(lowerQuery);
        return matchName || matchNameAr;
      })
      .slice(0, 4)
      .map((c) => ({
        id: c.id,
        type: 'category' as const,
        name: c.name,
        nameAr: c.name_ar,
        image: c.image_url,
        subtitle: language === 'ar' ? 'فئة' : 'Category',
      }));

    // Search car brands
    const carBrandResults: SearchResult[] = carBrands
      .filter((b) => {
        const matchName = b.name?.toLowerCase().includes(lowerQuery);
        const matchNameAr = b.name_ar?.toLowerCase().includes(lowerQuery);
        return matchName || matchNameAr;
      })
      .slice(0, 4)
      .map((b) => ({
        id: b.id,
        type: 'car' as const,
        name: b.name,
        nameAr: b.name_ar,
        image: b.logo_url,
        subtitle: language === 'ar' ? 'مطبخ عالمي' : 'Cuisine',
      }));

    // Combine results
    const allResults = [...productResults, ...categoryResults, ...carBrandResults];
    setResults(allResults);
    setIsSearching(false);
  }, [products, categories, carBrands, language]);

  // Debounced search
  useEffect(() => {
    const timer = setTimeout(() => {
      performSearch(query);
    }, 200);
    return () => clearTimeout(timer);
  }, [query, performSearch]);

  // Handle result selection
  const handleResultPress = (result: SearchResult) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    
    // Save to recent searches
    const name = language === 'ar' && result.nameAr ? result.nameAr : result.name;
    setRecentSearches((prev) => {
      const filtered = prev.filter((s) => s !== name);
      return [name, ...filtered].slice(0, 5);
    });

    onClose();

    // Navigate based on type
    switch (result.type) {
      case 'product':
        router.push(`/product/${result.id}`);
        break;
      case 'category':
        router.push(`/category/${result.id}`);
        break;
      case 'car':
        router.push(`/brand/${result.id}`);
        break;
      case 'brand':
        router.push(`/search?product_brand_id=${result.id}`);
        break;
    }
  };

  // Get display name
  const getName = (item: SearchResult) =>
    language === 'ar' && item.nameAr ? item.nameAr : item.name;

  // Result type icon
  const getResultIcon = (type: string) => {
    switch (type) {
      case 'product': return 'cube-outline';
      case 'category': return 'grid-outline';
      case 'car': return 'restaurant-outline';
      case 'brand': return 'pricetag-outline';
      default: return 'search-outline';
    }
  };

  // Animated styles
  const backdropStyle = useAnimatedStyle(() => ({
    opacity: backdropOpacity.value,
  }));

  const sheetStyle = useAnimatedStyle(() => ({
    height: sheetHeight.value,
    transform: [{ translateY: translateY.value }],
  }));

  if (!visible) return null;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      {/* Backdrop with blur */}
      <Animated.View style={[styles.backdrop, backdropStyle]}>
        <TouchableOpacity 
          style={StyleSheet.absoluteFill} 
          onPress={onClose}
          activeOpacity={1}
        >
          <BlurView
            intensity={isDark ? 40 : 30}
            tint={isDark ? 'dark' : 'light'}
            style={StyleSheet.absoluteFill}
          />
        </TouchableOpacity>
      </Animated.View>

      {/* Bottom Sheet Container */}
      <View style={styles.sheetContainer} pointerEvents="box-none">
        <Animated.View
          style={[
            styles.sheet,
            {
              backgroundColor: isDark ? 'rgba(26, 26, 46, 0.95)' : 'rgba(255, 255, 255, 0.95)',
            },
            sheetStyle,
          ]}
        >
          {/* Glass overlay */}
          <View style={[styles.glassOverlay, { opacity: isDark ? 0.1 : 0.5 }]} />

          {/* Handle indicator */}
          <View style={styles.handleContainer}>
            <View style={[styles.handle, { backgroundColor: colors.textSecondary }]} />
          </View>

          {/* Search Header */}
          <View style={[styles.searchHeader, { borderBottomColor: colors.border }]}>
            <View
              style={[
                styles.searchInputContainer,
                {
                  backgroundColor: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.05)',
                  borderColor: mood.primary + '40',
                },
              ]}
            >
              <Ionicons name="search" size={20} color={mood.primary} />
              <TextInput
                ref={searchInputRef}
                style={[
                  styles.searchInput,
                  { color: colors.text, textAlign: isRTL ? 'right' : 'left' },
                ]}
                placeholder={
                  language === 'ar'
                    ? 'ابحث عن منتجات، فئات، مطاعم...'
                    : 'Search products, categories, restaurants...'
                }
                placeholderTextColor={colors.textSecondary}
                value={query}
                onChangeText={setQuery}
                returnKeyType="search"
                autoCapitalize="none"
                autoCorrect={false}
              />
              {query.length > 0 && (
                <TouchableOpacity
                  onPress={() => {
                    setQuery('');
                    Haptics.selectionAsync();
                  }}
                  hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                >
                  <Ionicons name="close-circle" size={20} color={colors.textSecondary} />
                </TouchableOpacity>
              )}
            </View>

            {/* Close button */}
            <TouchableOpacity
              style={[
                styles.closeButton,
                { backgroundColor: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.05)' },
              ]}
              onPress={onClose}
            >
              <Ionicons name="close" size={20} color={colors.text} />
            </TouchableOpacity>
          </View>

          {/* Content */}
          <ScrollView
            style={styles.content}
            contentContainerStyle={styles.contentContainer}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            {/* Quick Actions - Show when no query */}
            {query.length === 0 && (
              <Animated.View entering={FadeIn.duration(200)} style={styles.quickActions}>
                <Text style={[styles.sectionTitle, { color: colors.text }]}>
                  {language === 'ar' ? 'استكشف' : 'Explore'}
                </Text>
                <View style={styles.quickActionsGrid}>
                  {/* Row 1: Categories | Models | Brands | Favorites */}
                  {/* 1. Categories (الفئات) */}
                  <TouchableOpacity
                    style={[styles.quickAction, { backgroundColor: colors.success + '15' }]}
                    onPress={() => {
                      onClose();
                      router.push('/(tabs)/categories');
                    }}
                  >
                    <Ionicons name="grid" size={22} color={colors.success} />
                    <Text style={[styles.quickActionText, { color: colors.success }]} numberOfLines={1}>
                      {language === 'ar' ? 'الفئات' : 'Categories'}
                    </Text>
                  </TouchableOpacity>
                  {/* 2. Models (موديلات) */}
                  <TouchableOpacity
                    style={[styles.quickAction, { backgroundColor: '#8B5CF6' + '15' }]}
                    onPress={() => {
                      onClose();
                      router.push('/models');
                    }}
                  >
                    <MaterialCommunityIcons name="car-multiple" size={22} color="#8B5CF6" />
                    <Text style={[styles.quickActionText, { color: '#8B5CF6' }]} numberOfLines={1}>
                      {language === 'ar' ? 'مطاعم' : 'Restaurants'}
                    </Text>
                  </TouchableOpacity>
                  {/* 3. Brands (الماركات) */}
                  <TouchableOpacity
                    style={[styles.quickAction, { backgroundColor: colors.warning + '15' }]}
                    onPress={() => {
                      onClose();
                      router.push('/brands');
                    }}
                  >
                    <Ionicons name="pricetag" size={22} color={colors.warning} />
                    <Text style={[styles.quickActionText, { color: colors.warning }]} numberOfLines={1}>
                      {language === 'ar' ? 'الماركات' : 'Brands'}
                    </Text>
                  </TouchableOpacity>
                  {/* 4. Favorites (المفضلة) */}
                  <TouchableOpacity
                    style={[styles.quickAction, { backgroundColor: colors.error + '15' }]}
                    onPress={() => {
                      onClose();
                      router.push('/cart?tab=favorites');
                    }}
                  >
                    <Ionicons name="heart" size={22} color={colors.error} />
                    <Text style={[styles.quickActionText, { color: colors.error }]} numberOfLines={1}>
                      {language === 'ar' ? 'المفضلة' : 'Favorites'}
                    </Text>
                  </TouchableOpacity>
                  {/* Row 2: Cars | Distributors | Suppliers | Products */}
                  {/* 5. Cars (السيارات) */}
                  <TouchableOpacity
                    style={[styles.quickAction, { backgroundColor: mood.primary + '15' }]}
                    onPress={() => {
                      onClose();
                      router.push('/car-brands');
                    }}
                  >
                    <Ionicons name="restaurant-outline" size={22} color={mood.primary} />
                    <Text style={[styles.quickActionText, { color: mood.primary }]} numberOfLines={1}>
                      {language === 'ar' ? 'المطابخ' : 'Cuisines'}
                    </Text>
                  </TouchableOpacity>
                  {/* 6. Distributors (الموزعون) */}
                  <TouchableOpacity
                    style={[styles.quickAction, { backgroundColor: 'rgba(55, 103, 135, 0.15)' }]}
                    onPress={() => {
                      onClose();
                      router.push('/owner/distributors');
                    }}
                  >
                    <MaterialCommunityIcons name="truck-delivery" size={22} color="#a1cced" />
                    <Text style={[styles.quickActionText, { color: '#a1cced' }]} numberOfLines={1}>
                      {language === 'ar' ? 'الموزعون' : 'Distributors'}
                    </Text>
                  </TouchableOpacity>
                  {/* 7. Suppliers (الموردون) */}
                  <TouchableOpacity
                    style={[styles.quickAction, { backgroundColor: 'rgba(255, 215, 0, 0.15)' }]}
                    onPress={() => {
                      onClose();
                      router.push('/owner/suppliers');
                    }}
                  >
                    <MaterialCommunityIcons name="warehouse" size={22} color="#D4AF37" />
                    <Text style={[styles.quickActionText, { color: '#D4AF37' }]} numberOfLines={1}>
                      {language === 'ar' ? 'الموردون' : 'Suppliers'}
                    </Text>
                  </TouchableOpacity>
                  {/* 8. Products (المنتجات) */}
                  <TouchableOpacity
                    style={[styles.quickAction, { backgroundColor: '#06B6D4' + '15' }]}
                    onPress={() => {
                      onClose();
                      router.push('/search');
                    }}
                  >
                    <Ionicons name="cube" size={22} color="#06B6D4" />
                    <Text style={[styles.quickActionText, { color: '#06B6D4' }]} numberOfLines={1}>
                      {language === 'ar' ? 'المنتجات' : 'Products'}
                    </Text>
                  </TouchableOpacity>
                </View>
              </Animated.View>
            )}

            {/* Loading State */}
            {isSearching && (
              <View style={styles.loadingContainer}>
                {[1, 2, 3].map((i) => (
                  <View key={i} style={styles.skeletonItem}>
                    <Skeleton width={50} height={50} borderRadius={10} />
                    <View style={styles.skeletonText}>
                      <Skeleton width="70%" height={16} />
                      <Skeleton width="40%" height={12} style={{ marginTop: 8 }} />
                    </View>
                  </View>
                ))}
              </View>
            )}

            {/* Search Results */}
            {!isSearching && results.length > 0 && (
              <View style={styles.resultsSection}>
                <Text style={[styles.resultsCount, { color: colors.textSecondary }]}>
                  {language === 'ar'
                    ? `${results.length} نتيجة`
                    : `${results.length} results`}
                </Text>
                {results.map((result, index) => (
                  <Animated.View
                    key={`${result.type}-${result.id}`}
                    entering={FadeIn.delay(index * 40).duration(200)}
                    layout={Layout.springify()}
                  >
                    <TouchableOpacity
                      style={[
                        styles.resultItem,
                        {
                          backgroundColor: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.03)',
                          borderColor: colors.border,
                        },
                      ]}
                      onPress={() => handleResultPress(result)}
                      activeOpacity={0.7}
                    >
                      {/* Result Image/Icon */}
                      <View
                        style={[
                          styles.resultImageContainer,
                          { backgroundColor: mood.primary + '15' },
                        ]}
                      >
                        {result.image ? (
                          <Image
                            source={{ uri: result.image }}
                            style={styles.resultImage}
                            resizeMode="cover"
                          />
                        ) : (
                          <Ionicons
                            name={getResultIcon(result.type) as any}
                            size={24}
                            color={mood.primary}
                          />
                        )}
                      </View>

                      {/* Result Info */}
                      <View style={styles.resultInfo}>
                        <Text
                          style={[styles.resultName, { color: colors.text }]}
                          numberOfLines={1}
                        >
                          {getName(result)}
                        </Text>
                        <View style={styles.resultMeta}>
                          <Text
                            style={[styles.resultSubtitle, { color: colors.textSecondary }]}
                          >
                            {result.subtitle}
                          </Text>
                          {result.price && (
                            <Text style={[styles.resultPrice, { color: mood.primary }]}>
                              {(parseFloat(String(result.price || 0)) || 0).toFixed(2)} {language === 'ar' ? 'ج.م' : 'EGP'}
                            </Text>
                          )}
                        </View>
                      </View>

                      {/* Arrow */}
                      <Ionicons
                        name={isRTL ? 'chevron-back' : 'chevron-forward'}
                        size={20}
                        color={colors.textSecondary}
                      />
                    </TouchableOpacity>
                  </Animated.View>
                ))}
              </View>
            )}

            {/* No Results */}
            {!isSearching && query.length > 0 && results.length === 0 && (
              <Animated.View 
                entering={FadeIn.duration(200)} 
                style={styles.noResults}
              >
                <Ionicons name="search" size={40} color={colors.textSecondary} />
                <Text style={[styles.noResultsText, { color: colors.textSecondary }]}>
                  {language === 'ar'
                    ? 'لا توجد نتائج لـ '
                    : 'No results for "'}
                  <Text style={{ color: colors.text, fontWeight: '600' }}>{query}</Text>
                  {language === 'ar' ? '' : '"'}
                </Text>
              </Animated.View>
            )}
          </ScrollView>
        </Animated.View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.3)',
  },
  sheetContainer: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  sheet: {
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -8 },
    shadowOpacity: 0.15,
    shadowRadius: 20,
    elevation: 20,
  },
  glassOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#FFFFFF',
  },
  handleContainer: {
    alignItems: 'center',
    paddingTop: 12,
    paddingBottom: 8,
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    opacity: 0.5,
  },
  searchHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    gap: 12,
  },
  searchInputContainer: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 2,
    borderRadius: 16,
    paddingHorizontal: 14,
    height: 50,
    gap: 10,
  },
  searchInput: {
    flex: 1,
    fontSize: 16,
    paddingVertical: 0,
  },
  closeButton: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: {
    flex: 1,
  },
  contentContainer: {
    paddingHorizontal: 16,
    paddingBottom: 32,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 12,
  },
  quickActions: {
    marginTop: 16,
  },
  quickActionsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: GRID_GAP,
    paddingHorizontal: SIDE_PADDING - 16, // Adjust for contentContainer padding
  },
  quickAction: {
    width: ITEM_WIDTH,
    height: ITEM_WIDTH,
    minWidth: 59,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
  },
  quickActionText: {
    fontSize: 11,
    fontWeight: '600',
    textAlign: 'center',
  },
  loadingContainer: {
    marginTop: 16,
    gap: 12,
  },
  skeletonItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 12,
  },
  skeletonText: {
    flex: 1,
  },
  resultsSection: {
    marginTop: 12,
  },
  resultsCount: {
    fontSize: 13,
    marginBottom: 10,
  },
  resultItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: 14,
    borderWidth: 1,
    marginBottom: 10,
    gap: 12,
  },
  resultImageContainer: {
    width: 70,
    height: 70,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  resultImage: {
    width: '100%',
    height: '100%',
  },
  resultInfo: {
    flex: 1,
  },
  resultName: {
    fontSize: 15,
    fontWeight: '600',
    marginBottom: 4,
  },
  resultMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  resultSubtitle: {
    fontSize: 12,
  },
  resultPrice: {
    fontSize: 14,
    fontWeight: '700',
  },
  noResults: {
    alignItems: 'center',
    paddingVertical: 32,
    gap: 12,
  },
  noResultsText: {
    fontSize: 15,
    textAlign: 'center',
  },
});

export default AdvancedSearchBottomSheet;
