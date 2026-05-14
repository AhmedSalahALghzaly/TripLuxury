import React, { useCallback, useEffect, useState, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  useWindowDimensions,
  ScrollView,
} from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ProductCard } from '../../src/components/ProductCard';
import { CategoryCard } from '../../src/components/CategoryCard';
import { useTheme } from '../../src/hooks/useTheme';
import { useTranslation } from '../../src/hooks/useTranslation';
import { useAppStore } from '../../src/store/appStore';
import { productsApi, categoriesApi, cartApi, carModelsApi } from '../../src/services/api';
import { TYPE, SPACING, RADII } from '../../src/constants/luxuryTokens';

const GOLD_COLOR = '#C8A24A';

const MAX_CARD_WIDTH = 270;
const GAP = 9;
const PADDING = 18;

export default function CategoryScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { colors } = useTheme();
  const { t, isRTL, language } = useTranslation();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const { user, addToLocalCart, cartItems: cart } = useAppStore();

  const availableWidth = width - PADDING * 2;
  const numColumns = Math.max(2, Math.ceil(availableWidth / (MAX_CARD_WIDTH + GAP)));
  const cardWidth = (availableWidth - GAP * (numColumns - 1)) / numColumns;

  const [category, setCategory] = useState<any>(null);
  const [subcategories, setSubcategories] = useState<any[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [carModels, setCarModels] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [addingProductId, setAddingProductId] = useState<string | null>(null);

  const fetchData = async () => {
    try {
      const [allCats, prodsRes] = await Promise.all([
        categoriesApi.getAll(),
        productsApi.getAll({ category_id: id }),
      ]);
      const currentCat = allCats.data.find((c: any) => c.id === id);
      setCategory(currentCat);
      const subCats = allCats.data.filter((c: any) => c.parent_id === id);
      setSubcategories(subCats);
      setProducts(prodsRes.data.products || []);
    } catch (error) {
      console.error('Error fetching category data:', error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
    // Fetch restaurant names independently so a failure here never blocks
    // the core page content from loading.
    try {
      const modelsRes = await carModelsApi.getAll();
      setCarModels(modelsRes.data || []);
    } catch {
      // Pills simply won't appear — non-blocking
    }
  };

  useEffect(() => {
    fetchData();
  }, [id]);

  const onRefresh = () => {
    setRefreshing(true);
    fetchData();
  };

  const isInCart = (productId: string) => {
    if (!cart) return false;
    return cart.some((item: any) => (item.product_id || item.id) === productId);
  };

  const handleAddToCart = useCallback(async (product: any, quantity: number = 1, fitmentIndicator?: string | null) => {
    if (!user) {
      router.push('/login');
      return;
    }
    if (isInCart(product.id)) return;
    setAddingProductId(product.id);
    try {
      await cartApi.addItem(product.id, quantity, fitmentIndicator ?? undefined);
      addToLocalCart({ product_id: product.id, quantity, product, fitment_indicator: fitmentIndicator ?? null });
    } catch (error) {
      console.error('Error adding to cart:', error);
    } finally {
      setAddingProductId(null);
    }
  }, [user, cart, addToLocalCart, router]);

  const getName = (item: any) =>
    language === 'ar' && item?.name_ar ? item.name_ar : item?.name || '';

  // Restaurant id → localised name lookup built from the restaurants list
  const restaurantNameMap = useMemo(() => {
    const map: Record<string, string> = {};
    carModels.forEach((m: any) => {
      if (m.id) {
        map[m.id] = (language === 'ar' && m.name_ar) ? m.name_ar : (m.name || '');
      }
    });
    return map;
  }, [carModels, language]);

  const renderItem = useCallback(({ item }: { item: any }) => {
    const ids: string[] = item.restaurant_ids || [];
    const resolvedRestaurants = ids
      .map((id) => ({ id, name: restaurantNameMap[id] }))
      .filter((r): r is { id: string; name: string } => Boolean(r.name));
    const restaurantNameTag = resolvedRestaurants.map((r) => r.name);
    const restaurantIds = resolvedRestaurants.map((r) => r.id);
    return (
      <View style={{ padding: GAP / 2 }}>
        <ProductCard
          product={item}
          cardWidth={cardWidth}
          restaurantNameTag={restaurantNameTag.length > 0 ? restaurantNameTag : undefined}
          restaurantIds={restaurantIds.length > 0 ? restaurantIds : undefined}
          onAddToCart={(quantity: number, fitmentIndicator?: string | null) =>
            handleAddToCart(item, quantity, fitmentIndicator)
          }
        />
      </View>
    );
  }, [cardWidth, handleAddToCart, restaurantNameMap]);

  const ListHeaderComponent = useCallback(() => (
    <>
      <View style={styles.eyebrowWrap}>
        <View style={[styles.eyebrowRule, { backgroundColor: GOLD_COLOR }]} />
        <Text style={[styles.eyebrow, { color: GOLD_COLOR }]}>
          {language === 'ar' ? 'فصول من القائمة' : 'Chapters of the menu'}
        </Text>
        <View style={[styles.eyebrowRule, { backgroundColor: GOLD_COLOR }]} />
      </View>
      {subcategories.length > 0 && (
        <View style={styles.subcategoriesSection}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>
            {language === 'ar' ? 'الأقسام الفرعية' : 'Sub-sections'}
          </Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.subcategoriesList}
          >
            {subcategories.map((item) => (
              <CategoryCard key={item.id} category={item} size="small" />
            ))}
          </ScrollView>
        </View>
      )}
      <View style={styles.productsHeader}>
        <Text style={[styles.sectionTitle, { color: colors.text }]}>
          {language === 'ar' ? 'الأطباق' : 'On the menu'}
        </Text>
        <View style={[styles.countPill, { backgroundColor: GOLD_COLOR + '22', borderColor: GOLD_COLOR + '55' }]}>
          <Text style={[styles.productCount, { color: GOLD_COLOR }]}>
            {products.length}
          </Text>
        </View>
      </View>
    </>
  ), [subcategories, products.length, colors, language]);

  if (loading) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Header */}
      <View style={[
        styles.header,
        { backgroundColor: colors.background, borderBottomColor: colors.border, paddingTop: insets.top + 10 }
      ]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <Ionicons
            name={isRTL ? 'arrow-forward' : 'arrow-back'}
            size={24}
            color={colors.text}
          />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.text }]} numberOfLines={1}>
          {getName(category)}
        </Text>
        <View style={styles.placeholder} />
      </View>

      <View style={[styles.listContainer, { paddingHorizontal: PADDING - GAP / 2 }]}>
        <FlashList
          data={products}
          keyExtractor={(item) => item.id}
          numColumns={numColumns}
          estimatedItemSize={cardWidth + 60}
          renderItem={renderItem}
          ListHeaderComponent={ListHeaderComponent}
          ListEmptyComponent={() => (
            <View style={styles.emptyContainer}>
              <Ionicons name="restaurant-outline" size={60} color={colors.textSecondary} />
              <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
                {language === 'ar' ? 'لا توجد أطباق متوفرة حالياً' : 'No dishes are being served here yet'}
              </Text>
            </View>
          )}
          onRefresh={onRefresh}
          refreshing={refreshing}
          contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 16,
    borderBottomWidth: 1,
  },
  backButton: {
    padding: 8,
  },
  headerTitle: {
    ...TYPE.title,
    fontSize: 18,
    flex: 1,
    textAlign: 'center',
    letterSpacing: 0.4,
  },
  placeholder: {
    width: 40,
  },
  listContainer: {
    flex: 1,
  },
  eyebrowWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: SPACING.sm,
    paddingTop: SPACING.lg,
    paddingBottom: SPACING.md,
    paddingHorizontal: 4,
  },
  eyebrow: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 2.4,
    textTransform: 'uppercase',
  },
  eyebrowRule: {
    flex: 1,
    maxWidth: 56,
    height: StyleSheet.hairlineWidth,
    opacity: 0.6,
  },
  subcategoriesSection: {
    marginBottom: 16,
    paddingTop: 4,
  },
  sectionTitle: {
    ...TYPE.title,
    fontSize: 20,
    marginBottom: 12,
    paddingHorizontal: 4,
    letterSpacing: 0.3,
  },
  subcategoriesList: {
    paddingHorizontal: 4,
  },
  productsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
    paddingHorizontal: 4,
    gap: SPACING.sm,
  },
  countPill: {
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: RADII.pill,
    borderWidth: StyleSheet.hairlineWidth,
    marginBottom: 12,
  },
  productCount: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.4,
  },
  emptyContainer: {
    alignItems: 'center',
    paddingVertical: 60,
  },
  emptyText: {
    fontSize: 15,
    marginTop: 12,
    fontStyle: 'italic',
    letterSpacing: 0.3,
    textAlign: 'center',
    paddingHorizontal: 32,
  },
});
