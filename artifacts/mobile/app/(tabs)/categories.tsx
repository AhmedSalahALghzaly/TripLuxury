/**
 * Categories Screen - Optimized with React Query
 * Displays hierarchical category tree with animations
 */
import React, { useState, useRef, useCallback, useMemo, memo, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  Animated,
  Dimensions,
  Platform,
} from 'react-native';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { Header } from '../../src/components/Header';
import { useTheme } from '../../src/hooks/useTheme';
import { useTranslation } from '../../src/hooks/useTranslation';
import { useCategoriesTreeQuery } from '../../src/hooks/queries';
import { createShadow } from '../../src/utils/shadowUtils';

const { width } = Dimensions.get('window');

// Modern icon mapping for categories
const iconMap: { [key: string]: { icon: string; gradient: string[] } } = {
  'engine': { icon: 'engine', gradient: ['#FF6B6B', '#FF8E53'] },
  'car-suspension': { icon: 'car-brake-abs', gradient: ['#4FACFE', '#00F2FE'] },
  'car-clutch': { icon: 'cog-outline', gradient: ['#43E97B', '#38F9D7'] },
  'lightning-bolt': { icon: 'lightning-bolt', gradient: ['#FA709A', '#FEE140'] },
  'car-door': { icon: 'car-door', gradient: ['#667EEA', '#764BA2'] },
  'car-tire-alert': { icon: 'tire', gradient: ['#11998E', '#38EF7D'] },
  'filter': { icon: 'filter-variant', gradient: ['#FC466B', '#3F5EFB'] },
  'oil': { icon: 'oil', gradient: ['#F093FB', '#F5576C'] },
  'air-filter': { icon: 'air-filter', gradient: ['#4481EB', '#04BEFE'] },
  'fan': { icon: 'fan', gradient: ['#0BA360', '#3CBA92'] },
  'flash': { icon: 'flash', gradient: ['#FFD200', '#F7971E'] },
  'car-brake-abs': { icon: 'car-brake-abs', gradient: ['#ED4264', '#FFEDBC'] },
  'cog': { icon: 'cog', gradient: ['#3A1C71', '#D76D77'] },
  'battery': { icon: 'battery-charging', gradient: ['#36D1DC', '#5B86E5'] },
  'lightbulb': { icon: 'lightbulb-on', gradient: ['#F7971E', '#FFD200'] },
  'flip-horizontal': { icon: 'flip-horizontal', gradient: ['#7F7FD5', '#91EAE4'] },
  'car-side': { icon: 'car-side', gradient: ['#654EA3', '#EAAFC8'] },
};

// Sub-category icons
const subIconMap: { [key: string]: string } = {
  'filter': 'filter-outline',
  'oil': 'water-outline',
  'air-filter': 'weather-windy',
  'fan': 'fan',
  'flash': 'flash-outline',
  'car-brake-abs': 'disc',
  'cog': 'cog-outline',
  'battery': 'battery-outline',
  'lightbulb': 'lightbulb-outline',
  'flip-horizontal': 'reflect-horizontal',
  'car-side': 'restaurant-outline',
};

interface AnimatedCategoryProps {
  category: any;
  level: number;
  isExpanded: boolean;
  onToggle: () => void;
  onNavigate: () => void;
  colors: any;
  isRTL: boolean;
  getName: (item: any) => string;
  children?: React.ReactNode;
}

// Memoized AnimatedCategory component for performance
const AnimatedCategory = memo(({
  category,
  level,
  isExpanded,
  onToggle,
  onNavigate,
  colors,
  isRTL,
  getName,
  children,
}: AnimatedCategoryProps) => {
  const animatedHeight = useRef(new Animated.Value(0)).current;
  const rotateAnim = useRef(new Animated.Value(0)).current;
  const scaleAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(animatedHeight, {
        toValue: isExpanded ? 1 : 0,
        duration: 300,
        useNativeDriver: false,
      }),
      Animated.timing(rotateAnim, {
        toValue: isExpanded ? 1 : 0,
        duration: 300,
        useNativeDriver: true,
      }),
    ]).start();
  }, [isExpanded]);

  const rotation = rotateAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '180deg'],
  });

  const hasChildren = category.children && category.children.length > 0;
  const iconData = iconMap[category.icon] || { icon: 'cube-outline', gradient: ['#667EEA', '#764BA2'] };
  const isMainCategory = level === 0;
  const hasImage = category.image_data && category.image_data.length > 0;

  const handlePressIn = useCallback(() => {
    Animated.spring(scaleAnim, {
      toValue: 0.98,
      useNativeDriver: true,
    }).start();
  }, [scaleAnim]);

  const handlePressOut = useCallback(() => {
    Animated.spring(scaleAnim, {
      toValue: 1,
      useNativeDriver: true,
    }).start();
  }, [scaleAnim]);

  if (isMainCategory) {
    return (
      <View style={styles.mainCategoryWrapper}>
        <Animated.View style={{ transform: [{ scale: scaleAnim }] }}>
          <TouchableOpacity
            activeOpacity={0.9}
            onPressIn={handlePressIn}
            onPressOut={handlePressOut}
            onPress={() => {
              if (hasChildren) {
                onToggle();
              } else {
                onNavigate();
              }
            }}
            style={[
              styles.mainCategoryCard,
              {
                backgroundColor: colors.card,
                borderColor: colors.border,
                shadowColor: colors.text,
              },
            ]}
          >
            {hasImage ? (
              <View style={styles.mainImageContainer}>
                <Image
                  source={{ uri: category.image_data }}
                  style={styles.mainCategoryImage}
                  contentFit="cover"
                  cachePolicy="memory-disk"
                />
              </View>
            ) : (
              <LinearGradient
                colors={iconData.gradient as any}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.mainIconGradient}
              >
                <MaterialCommunityIcons
                  name={iconData.icon as any}
                  size={28}
                  color="#FFFFFF"
                />
              </LinearGradient>
            )}

            <View style={[styles.mainCategoryInfo, isRTL && styles.mainCategoryInfoRTL]}>
              <Text style={[styles.mainCategoryName, { color: colors.text }]}>
                {getName(category)}
              </Text>
              {hasChildren && (
                <Text style={[styles.mainCategoryCount, { color: colors.textSecondary }]}>
                  {category.children.length} {isRTL ? 'أقسام فرعية' : 'subcategories'}
                </Text>
              )}
            </View>

            <View style={[styles.mainCategoryActions, isRTL && styles.mainCategoryActionsRTL]}>
              {hasChildren && (
                <Animated.View style={{ transform: [{ rotate: rotation }] }}>
                  <View style={[styles.expandButton, { backgroundColor: colors.primary + '15' }]}>
                    <Ionicons
                      name="chevron-down"
                      size={20}
                      color={colors.primary}
                    />
                  </View>
                </Animated.View>
              )}
              <TouchableOpacity
                style={[styles.navigateButton, { backgroundColor: colors.primary }]}
                onPress={onNavigate}
              >
                <Ionicons
                  name={isRTL ? 'arrow-back' : 'arrow-forward'}
                  size={18}
                  color="#FFFFFF"
                />
              </TouchableOpacity>
            </View>
          </TouchableOpacity>
        </Animated.View>

        {hasChildren && isExpanded && (
          <View style={[styles.subCategoriesContainer, { borderLeftColor: iconData.gradient[0] }]}>
            {children}
          </View>
        )}
      </View>
    );
  }

  // Sub Category
  const subIcon = subIconMap[category.icon] || 'chevron-forward-circle-outline';
  
  return (
    <Animated.View style={{ transform: [{ scale: scaleAnim }] }}>
      <TouchableOpacity
        activeOpacity={0.8}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        onPress={() => {
          if (hasChildren) {
            onToggle();
          } else {
            onNavigate();
          }
        }}
        style={[
          styles.subCategoryCard,
          {
            backgroundColor: colors.surface,
            borderColor: colors.border,
          },
          isRTL && styles.subCategoryCardRTL,
        ]}
      >
        <View style={[styles.subIconContainer, { backgroundColor: hasImage ? 'transparent' : colors.primary + '10' }]}>
          {hasImage ? (
            <Image
              source={{ uri: category.image_data }}
              style={styles.subCategoryImage}
              contentFit="cover"
              cachePolicy="memory-disk"
            />
          ) : (
            <MaterialCommunityIcons
              name={subIcon as any}
              size={20}
              color={colors.primary}
            />
          )}
        </View>

        <Text style={[styles.subCategoryName, { color: colors.text }, isRTL && styles.textRTL]}>
          {getName(category)}
        </Text>

        <View style={styles.subCategoryAction}>
          {hasChildren ? (
            <Animated.View style={{ transform: [{ rotate: rotation }] }}>
              <Ionicons name="chevron-down" size={18} color={colors.textSecondary} />
            </Animated.View>
          ) : (
            <View style={[styles.subArrowContainer, { backgroundColor: colors.primary + '15' }]}>
              <Ionicons
                name={isRTL ? 'chevron-back' : 'chevron-forward'}
                size={16}
                color={colors.primary}
              />
            </View>
          )}
        </View>
      </TouchableOpacity>

      {hasChildren && isExpanded && (
        <View style={styles.nestedSubContainer}>
          {children}
        </View>
      )}
    </Animated.View>
  );
});

export default function CategoriesScreen() {
  const { colors, isDark } = useTheme();
  const { t, isRTL, language } = useTranslation();
  const router = useRouter();

  // Use React Query for data fetching
  const {
    data: categories = [],
    isLoading,
    isRefetching,
    refetch,
  } = useCategoriesTreeQuery();

  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());

  const toggleExpand = useCallback((categoryId: string) => {
    setExpandedCategories((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(categoryId)) {
        newSet.delete(categoryId);
      } else {
        newSet.add(categoryId);
      }
      return newSet;
    });
  }, []);

  const getName = useCallback((item: any) => {
    return language === 'ar' && item.name_ar ? item.name_ar : item.name;
  }, [language]);

  // Memoize subcategory count calculation
  const subcategoryCount = useMemo(() => {
    return categories.reduce((acc: number, cat: any) => acc + (cat.children?.length || 0), 0);
  }, [categories]);

  const renderCategory = useCallback((category: any, level: number = 0): React.ReactNode => {
    const hasChildren = category.children && category.children.length > 0;
    const isExpanded = expandedCategories.has(category.id);

    return (
      <AnimatedCategory
        key={category.id}
        category={category}
        level={level}
        isExpanded={isExpanded}
        onToggle={() => toggleExpand(category.id)}
        onNavigate={() => router.push(`/category/${category.id}`)}
        colors={colors}
        isRTL={isRTL}
        getName={getName}
      >
        {hasChildren && category.children.map((child: any) => renderCategory(child, level + 1))}
      </AnimatedCategory>
    );
  }, [expandedCategories, toggleExpand, router, colors, isRTL, getName]);

  if (isLoading) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <Header title={t('allCategories')} showBack={false} />
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={[styles.loadingText, { color: colors.textSecondary }]}>
            {language === 'ar' ? 'جاري التحميل...' : 'Loading categories...'}
          </Text>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <Header title={t('allCategories')} showBack={false} />
      
      {/* Stats Header */}
      <View style={[styles.statsHeader, { backgroundColor: colors.surface, borderBottomColor: colors.border }]}>
        <View style={styles.statItem}>
          <View style={[styles.statIconContainer, { backgroundColor: colors.primary + '15' }]}>
            <Ionicons name="grid" size={20} color={colors.primary} />
          </View>
          <View>
            <Text style={[styles.statValue, { color: colors.text }]}>{categories.length}</Text>
            <Text style={[styles.statLabel, { color: colors.textSecondary }]}>
              {language === 'ar' ? 'قسم رئيسي' : 'Main Categories'}
            </Text>
          </View>
        </View>
        <View style={[styles.statDivider, { backgroundColor: colors.border }]} />
        <View style={styles.statItem}>
          <View style={[styles.statIconContainer, { backgroundColor: colors.secondary + '15' }]}>
            <Ionicons name="layers" size={20} color={colors.secondary} />
          </View>
          <View>
            <Text style={[styles.statValue, { color: colors.text }]}>
              {subcategoryCount}
            </Text>
            <Text style={[styles.statLabel, { color: colors.textSecondary }]}>
              {language === 'ar' ? 'قسم فرعي' : 'Subcategories'}
            </Text>
          </View>
        </View>
      </View>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl 
            refreshing={isRefetching} 
            onRefresh={refetch}
            colors={[colors.primary]}
            tintColor={colors.primary}
          />
        }
      >
        {/* Section Title */}
        <View style={[styles.sectionTitleContainer, isRTL && styles.sectionTitleContainerRTL]}>
          <View style={[styles.sectionTitleLine, { backgroundColor: colors.primary }]} />
          <Text style={[styles.sectionTitle, { color: colors.text }]}>
            {language === 'ar' ? 'تصفح حسب القسم' : 'Browse by Category'}
          </Text>
        </View>

        {categories.map((category: any) => renderCategory(category))}
        
        <View style={styles.bottomPadding} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 12,
  },
  loadingText: {
    fontSize: 14,
    marginTop: 8,
  },
  statsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    paddingVertical: 16,
    paddingHorizontal: 20,
    borderBottomWidth: 1,
  },
  statItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  statIconContainer: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  statValue: {
    fontSize: 20,
    fontWeight: '700',
  },
  statLabel: {
    fontSize: 12,
    marginTop: 2,
  },
  statDivider: {
    width: 1,
    height: 40,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
  },
  sectionTitleContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 20,
    gap: 10,
  },
  sectionTitleContainerRTL: {
    flexDirection: 'row-reverse',
  },
  sectionTitleLine: {
    width: 4,
    height: 24,
    borderRadius: 2,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '700',
  },
  mainCategoryWrapper: {
    marginBottom: 12,
  },
  mainCategoryCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 3,
  },
  mainIconGradient: {
    width: 56,
    height: 56,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  mainImageContainer: {
    width: 56,
    height: 56,
    borderRadius: 16,
    overflow: 'hidden',
  },
  mainCategoryImage: {
    width: 56,
    height: 56,
    borderRadius: 16,
  },
  mainCategoryInfo: {
    flex: 1,
    marginLeft: 16,
  },
  mainCategoryInfoRTL: {
    marginLeft: 0,
    marginRight: 16,
    alignItems: 'flex-end',
  },
  mainCategoryName: {
    fontSize: 17,
    fontWeight: '700',
    marginBottom: 4,
  },
  mainCategoryCount: {
    fontSize: 13,
  },
  mainCategoryActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  mainCategoryActionsRTL: {
    flexDirection: 'row-reverse',
  },
  expandButton: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  navigateButton: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  subCategoriesContainer: {
    marginTop: 8,
    marginLeft: 28,
    paddingLeft: 16,
    borderLeftWidth: 3,
    borderRadius: 2,
  },
  subCategoryCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 8,
  },
  subCategoryCardRTL: {
    flexDirection: 'row-reverse',
  },
  subIconContainer: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  subCategoryImage: {
    width: 36,
    height: 36,
    borderRadius: 10,
  },
  subCategoryName: {
    flex: 1,
    fontSize: 15,
    fontWeight: '500',
    marginLeft: 12,
  },
  textRTL: {
    marginLeft: 0,
    marginRight: 12,
    textAlign: 'right',
  },
  subCategoryAction: {
    marginLeft: 8,
  },
  subArrowContainer: {
    width: 28,
    height: 28,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  nestedSubContainer: {
    marginLeft: 20,
    marginTop: 4,
  },
  bottomPadding: {
    height: 100,
  },
});
