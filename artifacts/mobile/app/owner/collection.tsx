/**
 * Collection Screen - Product Inventory Management with Categories
 * View all products grouped by category with stock management
 * ENHANCED: Professional Dark/Light Mode Support
 */
import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  RefreshControl,
  Image,
  ActivityIndicator,
  Platform,
} from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
type RouterType = ReturnType<typeof useRouter>;
import * as Haptics from 'expo-haptics';
import { useAppStore } from '../../src/store/appStore';
import { useTheme } from '../../src/hooks/useTheme';
import { productsApi, categoriesApi, productBrandsApi, carModelsApi } from '../../src/services/api';
import { FuelTypeSelector, type FuelType } from '../../src/components/ui/FuelTypeSelector';
import { AccessGuard as __AccessGuard__ } from '../../src/components/AccessGuard';
import FitmentStrip, { type FitmentVariant } from '../../src/components/FitmentStrip';
import ReportComposerModal from '../../src/components/owner/ReportComposerModal';
type ViewMode = 'grid' | 'list';
type GroupBy = 'category' | 'brand' | 'stock' | 'carmodel';

// ─── SKU dedupe ────────────────────────────────────────────────────────────
// Group product rows that share the same SKU into one card with a fitment
// chip strip. STD-first ordering matches FitmentStrip / car detail / cart.
const FITMENT_ORDER: Record<string, number> = { STD: 0, '010': 1, '020': 2, '030': 3 };
function fitmentRank(ind: string | null | undefined): number {
  const k = (ind || 'STD').toUpperCase();
  return FITMENT_ORDER[k] ?? 99;
}
type SkuGroup = {
  key: string;
  primary: any;
  variants: Array<FitmentVariant & { productId: string }>;
};
function dedupeBySku(items: any[]): SkuGroup[] {
  // Two layers of dedupe:
  //  1) by product.id — the carmodel grouping path can push the same product
  //     multiple times when a product fits several models in the same group;
  //     also a defensive guard against any caller-side duplicates.
  //  2) by SKU (uppercase, trimmed) — siblings that share an SKU collapse into
  //     a single card with the fitment chip strip.
  const seenIds = new Set<string>();
  const bySku = new Map<string, Map<string, any>>();
  const order: string[] = [];
  for (const p of items) {
    const pid = String(p?.id ?? '');
    if (!pid || seenIds.has(pid)) continue;
    seenIds.add(pid);
    const skuRaw = p?.sku ? String(p.sku).trim().toUpperCase() : '';
    const sku = skuRaw || `__pid:${pid}`;
    if (!bySku.has(sku)) {
      bySku.set(sku, new Map());
      order.push(sku);
    }
    // Collapse duplicate fitment rows under the same SKU (defensive — DB should
    // already prevent this, but a stale cache could surface it).
    const variantKey = (p?.fitment_indicator || 'STD').toUpperCase();
    const variantMap = bySku.get(sku)!;
    if (!variantMap.has(variantKey)) variantMap.set(variantKey, p);
  }
  return order.map((sku) => {
    const rows = Array.from(bySku.get(sku)!.values()).sort(
      (a, b) => fitmentRank(a?.fitment_indicator) - fitmentRank(b?.fitment_indicator),
    );
    const primary = rows[0];
    const variants: Array<FitmentVariant & { productId: string }> = rows.map((r) => ({
      indicator: (r?.fitment_indicator || 'STD').toUpperCase(),
      price: Number(r?.price ?? 0),
      stock: Number(r?.stock_quantity ?? r?.stock ?? 0),
      productId: r?.id,
    }));
    return { key: sku, primary, variants };
  });
}

function CollectionScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors, isDark } = useTheme();
  const language = useAppStore((state) => state.language);
  const products = useAppStore((state) => state.products);
  const setProducts = useAppStore((state) => state.setProducts);
  const isRTL = language === 'ar';

  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [viewMode, setViewMode] = useState<ViewMode>('grid');
  const [groupBy, setGroupBy] = useState<GroupBy>('category');
  const [categories, setCategories] = useState<any[]>([]);
  const [brands, setBrands] = useState<any[]>([]);
  const [carModels, setCarModels] = useState<any[]>([]);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [selectedFuelTypes, setSelectedFuelTypes] = useState<FuelType[]>([]);
  const [showReportModal, setShowReportModal] = useState(false);

  // Dynamic colors based on theme
  const themeColors = useMemo(() => ({
    background: isDark ? colors.background : '#F8FAFC',
    surface: isDark ? colors.surface : '#FFFFFF',
    card: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.04)',
    cardBorder: isDark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.08)',
    text: colors.text,
    textSecondary: colors.textSecondary,
    primary: colors.primary,
    accent: isDark ? '#60A5FA' : '#3B82F6',
    searchBg: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)',
    pillBg: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.06)',
    pillActiveBg: isDark ? colors.primary : colors.primary,
    groupHeaderBg: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.03)',
    badgeBg: isDark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.08)',
  }), [isDark, colors]);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      const [productsRes, categoriesRes, brandsRes, carModelsRes] = await Promise.all([
        productsApi.getAllAdmin(),
        categoriesApi.getAll(),
        productBrandsApi.getAll(),
        carModelsApi.getAll().catch(() => ({ data: [] })),
      ]);
      setProducts(productsRes.data?.products || []);
      setCategories(categoriesRes.data || []);
      setBrands(brandsRes.data || []);
      setCarModels(Array.isArray(carModelsRes.data) ? carModelsRes.data : carModelsRes.data?.models || []);
      
      // Expand first group by default
      const firstGroupId = categoriesRes.data?.[0]?.id;
      if (firstGroupId) {
        setExpandedGroups(new Set([firstGroupId]));
      }
    } catch (error) {
      console.error('Error fetching data:', error);
    } finally {
      setLoading(false);
    }
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchData();
    setRefreshing(false);
  };

  // Filter and group products
  const groupedProducts = useMemo(() => {
    let filtered = products;

    // Apply search filter
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter((p: any) =>
        p.name?.toLowerCase().includes(query) ||
        p.name_ar?.toLowerCase().includes(query) ||
        p.sku?.toLowerCase().includes(query)
      );
    }

    // Apply fuel type filter — product matches if any of its car_model_ids
    // belongs to a model with the selected fuel_type
    if (selectedFuelTypes.length > 0) {
      const fuelModelIds = new Set(
        carModels
          .filter((m: any) => selectedFuelTypes.includes(m.fuel_type as FuelType))
          .map((m: any) => m.id)
      );
      filtered = filtered.filter((p: any) =>
        (p.car_model_ids || []).some((mid: string) => fuelModelIds.has(mid))
      );
    }

    // Group by selected criteria
    const groups: Record<string, { name: string; nameAr: string; products: any[]; color: string }> = {};

    if (groupBy === 'category') {
      categories.forEach((cat: any) => {
        groups[cat.id] = {
          name: cat.name,
          nameAr: cat.name_ar,
          products: [],
          color: themeColors.accent,
        };
      });
      groups['uncategorized'] = { name: 'Uncategorized', nameAr: 'بدون فئة', products: [], color: '#6B7280' };

      filtered.forEach((product: any) => {
        const catId = product.category_id || 'uncategorized';
        if (groups[catId]) {
          groups[catId].products.push(product);
        } else {
          groups['uncategorized'].products.push(product);
        }
      });
    } else if (groupBy === 'brand') {
      brands.forEach((brand: any) => {
        groups[brand.id] = {
          name: brand.name,
          nameAr: brand.name_ar,
          products: [],
          color: '#10B981',
        };
      });
      groups['unbrand'] = { name: 'No Brand', nameAr: 'بدون ماركة', products: [], color: '#6B7280' };

      filtered.forEach((product: any) => {
        const brandId = product.product_brand_id || 'unbrand';
        if (groups[brandId]) {
          groups[brandId].products.push(product);
        } else {
          groups['unbrand'].products.push(product);
        }
      });
    } else if (groupBy === 'carmodel') {
      carModels.forEach((model: any) => {
        groups[model.id] = {
          name: model.name || '',
          nameAr: model.name_ar || model.name || '',
          products: [],
          color: '#8B5CF6',
        };
      });
      groups['no_model'] = { name: 'No Restaurant', nameAr: 'بدون مطعم', products: [], color: '#6B7280' };

      filtered.forEach((product: any) => {
        const modelIds: string[] = product.car_model_ids || [];
        if (modelIds.length === 0) {
          groups['no_model'].products.push(product);
        } else {
          modelIds.forEach((mid: string) => {
            if (groups[mid]) groups[mid].products.push(product);
            else groups['no_model'].products.push(product);
          });
        }
      });
    } else if (groupBy === 'stock') {
      groups['out'] = { name: 'Out of Stock', nameAr: 'نفد المخزون', products: [], color: '#EF4444' };
      groups['low'] = { name: 'Low Stock (< 10)', nameAr: 'مخزون منخفض', products: [], color: '#F59E0B' };
      groups['good'] = { name: 'In Stock', nameAr: 'متوفر', products: [], color: '#10B981' };

      filtered.forEach((product: any) => {
        const stock = product.stock_quantity || product.stock || 0;
        if (stock === 0) {
          groups['out'].products.push(product);
        } else if (stock < 10) {
          groups['low'].products.push(product);
        } else {
          groups['good'].products.push(product);
        }
      });
    }

    // Filter out empty groups
    return Object.entries(groups)
      .filter(([_, group]) => group.products.length > 0)
      .map(([id, group]) => ({ id, ...group }));
  }, [products, categories, brands, carModels, searchQuery, groupBy, selectedFuelTypes, themeColors.accent]);

  const toggleGroup = (groupId: string) => {
    if (Platform.OS !== 'web') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    const newExpanded = new Set(expandedGroups);
    if (newExpanded.has(groupId)) {
      newExpanded.delete(groupId);
    } else {
      newExpanded.add(groupId);
    }
    setExpandedGroups(newExpanded);
  };

  // Stats
  const stats = useMemo(() => ({
    total: products.length,
    outOfStock: products.filter((p: any) => (p.stock_quantity || p.stock || 0) === 0).length,
    lowStock: products.filter((p: any) => {
      const stock = p.stock_quantity || p.stock || 0;
      return stock > 0 && stock < 10;
    }).length,
    totalValue: products.reduce((sum: number, p: any) => sum + ((p.price || 0) * (p.stock_quantity || p.stock || 0)), 0),
  }), [products]);

  const renderSkuGroup = (sg: SkuGroup) => (
    <OwnerProductCard
      key={sg.key}
      group={sg}
      viewMode={viewMode}
      themeColors={themeColors}
      brands={brands}
      carModels={carModels}
      isRTL={isRTL}
      router={router}
    />
  );

  // Legacy single-product card kept for reference/compat. The render loop now
  // groups by SKU first and uses OwnerProductCard for the chip-aware UI.
  const _renderProductItem = (product: any) => {
    const stock = product.stock_quantity || product.stock || 0;
    const stockColor = stock === 0 ? '#EF4444' : stock < 10 ? '#F59E0B' : '#10B981';

    const brandObj = brands.find((b: any) => b.id === product.product_brand_id);
    const brandName = brandObj ? (isRTL && brandObj.name_ar ? brandObj.name_ar : brandObj.name) : null;
    const modelNames = (product.car_model_ids || [])
      .slice(0, 2)
      .map((mid: string) => {
        const m = carModels.find((cm: any) => cm.id === mid);
        return m ? (isRTL && m.name_ar ? m.name_ar : m.name) : null;
      })
      .filter(Boolean);

    if (viewMode === 'list') {
      return (
        <TouchableOpacity
          key={product.id}
          style={[
            styles.listItem,
            {
              backgroundColor: themeColors.card,
              borderColor: themeColors.cardBorder,
            },
          ]}
          onPress={() => router.push(`/product/${product.id}`)}
          activeOpacity={0.7}
        >
          {product.images?.[0] || product.image_url ? (
            <Image source={{ uri: product.images?.[0] || product.image_url }} style={styles.listItemImage} />
          ) : (
            <View style={[styles.listItemImage, styles.placeholderImage, { backgroundColor: themeColors.cardBorder }]}>
              <Ionicons name="cube" size={20} color={themeColors.textSecondary} />
            </View>
          )}
          <View style={styles.listItemInfo}>
            <Text style={[styles.listItemName, { color: themeColors.text }]} numberOfLines={1}>
              {isRTL ? product.name_ar : product.name}
            </Text>
            {product.sku ? (
              <Text style={[styles.listItemSku, { color: themeColors.textSecondary }]}>SKU: {product.sku}</Text>
            ) : null}
            {brandName ? (
              <Text style={[styles.listItemSku, { color: themeColors.accent }]} numberOfLines={1}>🏷 {brandName}</Text>
            ) : null}
            {modelNames.length > 0 ? (
              <Text style={[styles.listItemSku, { color: '#8B5CF6' }]} numberOfLines={1}>🚗 {modelNames.join(' · ')}</Text>
            ) : null}
          </View>
          <View style={styles.listItemMeta}>
            <Text style={[styles.listItemPrice, { color: themeColors.primary }]}>{product.price?.toLocaleString()} ج.م</Text>
            <View style={[styles.stockBadge, { backgroundColor: stockColor + '20' }]}>
              <Text style={[styles.stockBadgeText, { color: stockColor }]}>{stock}</Text>
            </View>
          </View>
        </TouchableOpacity>
      );
    }

    // Grid view
    return (
      <TouchableOpacity
        key={product.id}
        style={[
          styles.gridItem,
          {
            backgroundColor: themeColors.card,
            borderColor: themeColors.cardBorder,
          },
        ]}
        onPress={() => router.push(`/product/${product.id}`)}
        activeOpacity={0.7}
      >
        {product.images?.[0] || product.image_url ? (
          <Image source={{ uri: product.images?.[0] || product.image_url }} style={styles.gridItemImage} />
        ) : (
          <View style={[styles.gridItemImage, styles.placeholderImage, { backgroundColor: themeColors.cardBorder }]}>
            <Ionicons name="cube" size={30} color={themeColors.textSecondary} />
          </View>
        )}
        <View style={[styles.gridStockBadge, { backgroundColor: stockColor }]}>
          <Text style={styles.gridStockText}>{stock}</Text>
        </View>
        <Text style={[styles.gridItemName, { color: themeColors.text }]} numberOfLines={2}>
          {isRTL ? product.name_ar : product.name}
        </Text>
        {product.sku ? (
          <Text style={[styles.gridItemSku, { color: themeColors.textSecondary }]} numberOfLines={1}>
            {product.sku}
          </Text>
        ) : null}
        {brandName ? (
          <Text style={[styles.gridItemSku, { color: themeColors.accent }]} numberOfLines={1}>
            🏷 {brandName}
          </Text>
        ) : null}
        {modelNames.length > 0 ? (
          <Text style={[styles.gridItemSku, { color: '#8B5CF6' }]} numberOfLines={1}>
            🚗 {modelNames.join(' · ')}
          </Text>
        ) : null}
        <Text style={[styles.gridItemPrice, { color: themeColors.primary }]}>{product.price?.toLocaleString()} ج.م</Text>
      </TouchableOpacity>
    );
  };

  return (
    <View style={[styles.container, { backgroundColor: themeColors.background }]}>
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={[styles.scrollContent, { paddingTop: insets.top }]}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={themeColors.primary}
            colors={[themeColors.primary]}
          />
        }
      >
        {/* Header */}
        <View style={[styles.header, isRTL && styles.headerRTL]}>
          <TouchableOpacity
            style={[styles.backButton, { backgroundColor: themeColors.card, borderColor: themeColors.cardBorder }]}
            onPress={() => router.back()}
          >
            <Ionicons name={isRTL ? 'arrow-forward' : 'arrow-back'} size={24} color={themeColors.text} />
          </TouchableOpacity>
          <Text style={[styles.headerTitle, { color: themeColors.text }]}>
            {isRTL ? 'المجموعة' : 'Collection'}
          </Text>
          <View style={styles.headerActions}>
            <TouchableOpacity
              style={[
                styles.viewToggle,
                { backgroundColor: themeColors.card, borderColor: themeColors.cardBorder },
              ]}
              onPress={() => setShowReportModal(true)}
              accessibilityLabel={isRTL ? 'تصدير تقرير' : 'Export report'}
            >
              <Ionicons name="print-outline" size={18} color={themeColors.primary} />
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                styles.viewToggle,
                { backgroundColor: themeColors.card, borderColor: themeColors.cardBorder },
                viewMode === 'grid' && { backgroundColor: themeColors.primary },
              ]}
              onPress={() => setViewMode('grid')}
            >
              <Ionicons name="grid" size={18} color={viewMode === 'grid' ? '#FFF' : themeColors.textSecondary} />
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                styles.viewToggle,
                { backgroundColor: themeColors.card, borderColor: themeColors.cardBorder },
                viewMode === 'list' && { backgroundColor: themeColors.primary },
              ]}
              onPress={() => setViewMode('list')}
            >
              <Ionicons name="list" size={18} color={viewMode === 'list' ? '#FFF' : themeColors.textSecondary} />
            </TouchableOpacity>
          </View>
        </View>

        {/* Stats Cards */}
        <View style={styles.statsRow}>
          <View style={[styles.statCard, { backgroundColor: themeColors.card, borderColor: themeColors.cardBorder }]}>
            <Text style={[styles.statValue, { color: themeColors.primary }]}>{stats.total}</Text>
            <Text style={[styles.statLabel, { color: themeColors.textSecondary }]}>{isRTL ? 'المنتجات' : 'Products'}</Text>
          </View>
          <View style={[styles.statCard, { backgroundColor: themeColors.card, borderColor: themeColors.cardBorder }]}>
            <Text style={[styles.statValue, { color: '#EF4444' }]}>{stats.outOfStock}</Text>
            <Text style={[styles.statLabel, { color: themeColors.textSecondary }]}>{isRTL ? 'نفد' : 'Out'}</Text>
          </View>
          <View style={[styles.statCard, { backgroundColor: themeColors.card, borderColor: themeColors.cardBorder }]}>
            <Text style={[styles.statValue, { color: '#F59E0B' }]}>{stats.lowStock}</Text>
            <Text style={[styles.statLabel, { color: themeColors.textSecondary }]}>{isRTL ? 'منخفض' : 'Low'}</Text>
          </View>
          <View style={[styles.statCard, { backgroundColor: themeColors.card, borderColor: themeColors.cardBorder }]}>
            <Text style={[styles.statValue, { color: '#10B981' }]}>{(stats.totalValue / 1000).toFixed(0)}K</Text>
            <Text style={[styles.statLabel, { color: themeColors.textSecondary }]}>{isRTL ? 'القيمة' : 'Value'}</Text>
          </View>
        </View>

        {/* Search Bar */}
        <View style={[styles.searchContainer, { backgroundColor: themeColors.searchBg, borderColor: themeColors.cardBorder }]}>
          <Ionicons name="search" size={20} color={themeColors.textSecondary} />
          <TextInput
            style={[styles.searchInput, { color: themeColors.text }]}
            value={searchQuery}
            onChangeText={setSearchQuery}
            placeholder={isRTL ? 'ابحث في المنتجات...' : 'Search products...'}
            placeholderTextColor={themeColors.textSecondary}
          />
          {searchQuery.length > 0 && (
            <TouchableOpacity onPress={() => setSearchQuery('')}>
              <Ionicons name="close-circle" size={20} color={themeColors.textSecondary} />
            </TouchableOpacity>
          )}
        </View>

        {/* Fuel Type Filter */}
        <View style={styles.fuelFilterContainer}>
          <FuelTypeSelector
            selected={selectedFuelTypes}
            onSelect={(type: FuelType) =>
              setSelectedFuelTypes(prev =>
                prev.includes(type) ? prev.filter(t => t !== type) : [...prev, type]
              )
            }
            multiSelect
            compact
          />
        </View>

        {/* Group By Pills */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.groupByContainer}>
          {[
            { id: 'category', label: 'Category', labelAr: 'الفئة' },
            { id: 'brand', label: 'Brand', labelAr: 'الماركة' },
            { id: 'stock', label: 'Stock Level', labelAr: 'المخزون' },
            { id: 'carmodel', label: 'Restaurant', labelAr: 'المطعم' },
          ].map((option) => (
            <TouchableOpacity
              key={option.id}
              style={[
                styles.groupByPill,
                { backgroundColor: themeColors.pillBg, borderColor: themeColors.cardBorder },
                groupBy === option.id && { backgroundColor: themeColors.pillActiveBg, borderColor: themeColors.primary },
              ]}
              onPress={() => {
                if (Platform.OS !== 'web') {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                }
                setGroupBy(option.id as GroupBy);
              }}
            >
              <Text
                style={[
                  styles.groupByText,
                  { color: themeColors.textSecondary },
                  groupBy === option.id && { color: '#FFF' },
                ]}
              >
                {isRTL ? option.labelAr : option.label}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        {/* Grouped Products */}
        {loading ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color={themeColors.primary} />
          </View>
        ) : groupedProducts.length === 0 ? (
          <View style={styles.emptyState}>
            <Ionicons name="cube-outline" size={64} color={themeColors.textSecondary} />
            <Text style={[styles.emptyText, { color: themeColors.textSecondary }]}>
              {searchQuery ? (isRTL ? 'لا توجد نتائج' : 'No results found') : (isRTL ? 'لا توجد منتجات' : 'No products yet')}
            </Text>
          </View>
        ) : (
          groupedProducts.map((group) => (
            <View key={group.id} style={styles.groupContainer}>
              <TouchableOpacity
                style={[styles.groupHeader, { backgroundColor: themeColors.groupHeaderBg, borderColor: themeColors.cardBorder }]}
                onPress={() => toggleGroup(group.id)}
                activeOpacity={0.7}
              >
                <View style={[styles.groupColorBar, { backgroundColor: group.color }]} />
                <Text style={[styles.groupName, { color: themeColors.text }]}>
                  {isRTL ? group.nameAr : group.name}
                </Text>
                <View style={[styles.groupBadge, { backgroundColor: themeColors.badgeBg }]}>
                  <Text style={[styles.groupBadgeText, { color: themeColors.text }]}>{group.products.length}</Text>
                </View>
                <Ionicons
                  name={expandedGroups.has(group.id) ? 'chevron-up' : 'chevron-down'}
                  size={20}
                  color={themeColors.textSecondary}
                />
              </TouchableOpacity>

              {expandedGroups.has(group.id) && (
                <View style={viewMode === 'grid' ? styles.gridContainer : styles.listContainer}>
                  {dedupeBySku(group.products).map(renderSkuGroup)}
                </View>
              )}
            </View>
          ))
        )}

        <View style={{ height: insets.bottom + 40 }} />
      </ScrollView>
      <ReportComposerModal
        visible={showReportModal}
        onClose={() => setShowReportModal(false)}
        products={products}
        brands={brands}
        carModels={carModels}
        categories={categories}
        language={language}
      />
    </View>
  );
}

// ─── OwnerProductCard ──────────────────────────────────────────────────────
// One card per SKU. When the SKU has multiple fitments, an interactive chip
// strip swaps between them and the price pulses on tap. Tapping the card
// opens the active variant's product page so the owner sees stock for the
// fitment they selected, not just the primary row.
type OwnerProductCardProps = {
  group: SkuGroup;
  viewMode: ViewMode;
  themeColors: any;
  brands: any[];
  carModels: any[];
  isRTL: boolean;
  router: RouterType;
};

const OwnerProductCard = React.memo(function OwnerProductCard({
  group,
  viewMode,
  themeColors,
  brands,
  carModels,
  isRTL,
  router,
}: OwnerProductCardProps) {
  const { primary, variants } = group;
  const [selectedIndicator, setSelectedIndicator] = useState<string>(
    variants[0]?.indicator ?? 'STD',
  );
  const activeVariant = useMemo(
    () => variants.find((v) => v.indicator === selectedIndicator) ?? variants[0],
    [variants, selectedIndicator],
  );
  const activeProduct = useMemo(() => {
    if (!activeVariant) return primary;
    return { ...primary, id: activeVariant.productId, price: activeVariant.price, stock_quantity: activeVariant.stock, fitment_indicator: activeVariant.indicator };
  }, [primary, activeVariant]);

  const stock = Number(activeProduct.stock_quantity ?? activeProduct.stock ?? 0);
  const stockColor = stock === 0 ? '#EF4444' : stock < 10 ? '#F59E0B' : '#10B981';

  // Pulse the price on chip change.
  const pulse = useSharedValue(1);
  useEffect(() => {
    pulse.value = withSequence(
      withTiming(1.12, { duration: 130 }),
      withTiming(1, { duration: 180 }),
    );
  }, [selectedIndicator, pulse]);
  const pulseStyle = useAnimatedStyle(() => ({ transform: [{ scale: pulse.value }] }));

  const onChipChange = useCallback(
    (ind: string) => {
      if (Platform.OS !== 'web') {
        Haptics.selectionAsync();
      }
      setSelectedIndicator(ind);
    },
    [],
  );

  const brandObj = brands.find((b: any) => b.id === primary.product_brand_id);
  const brandName = brandObj ? (isRTL && brandObj.name_ar ? brandObj.name_ar : brandObj.name) : null;
  const modelNames = (primary.car_model_ids || [])
    .slice(0, 2)
    .map((mid: string) => {
      const m = carModels.find((cm: any) => cm.id === mid);
      return m ? (isRTL && m.name_ar ? m.name_ar : m.name) : null;
    })
    .filter(Boolean);

  const showChips = variants.length > 1;
  const onPress = () => router.push(`/product/${activeProduct.id}` as any);
  const priceText = `${Number(activeProduct.price ?? 0).toLocaleString()} ج.م`;

  if (viewMode === 'list') {
    return (
      <TouchableOpacity
        style={[
          styles.listItem,
          { backgroundColor: themeColors.card, borderColor: themeColors.cardBorder },
        ]}
        onPress={onPress}
        activeOpacity={0.7}
      >
        {primary.images?.[0] || primary.image_url ? (
          <Image source={{ uri: primary.images?.[0] || primary.image_url }} style={styles.listItemImage} />
        ) : (
          <View style={[styles.listItemImage, styles.placeholderImage, { backgroundColor: themeColors.cardBorder }]}>
            <Ionicons name="cube" size={20} color={themeColors.textSecondary} />
          </View>
        )}
        <View style={styles.listItemInfo}>
          <Text style={[styles.listItemName, { color: themeColors.text }]} numberOfLines={1}>
            {isRTL ? primary.name_ar : primary.name}
          </Text>
          {primary.sku ? (
            <Text style={[styles.listItemSku, { color: themeColors.textSecondary }]}>SKU: {primary.sku}</Text>
          ) : null}
          {brandName ? (
            <Text style={[styles.listItemSku, { color: themeColors.accent }]} numberOfLines={1}>🏷 {brandName}</Text>
          ) : null}
          {showChips ? (
            <View style={styles.listChipRow}>
              <FitmentStrip
                mode="interactive"
                variants={variants}
                selected={selectedIndicator}
                onChange={onChipChange}
                size="sm"
                emphasizeSelection
                hideOutOfStock={false}
              />
            </View>
          ) : null}
          {modelNames.length > 0 ? (
            <Text style={[styles.listItemSku, { color: '#8B5CF6' }]} numberOfLines={1}>🚗 {modelNames.join(' · ')}</Text>
          ) : null}
        </View>
        <View style={styles.listItemMeta}>
          <Animated.Text style={[styles.listItemPrice, { color: themeColors.primary }, pulseStyle]}>
            {priceText}
          </Animated.Text>
          <View style={[styles.stockBadge, { backgroundColor: stockColor + '20' }]}>
            <Text style={[styles.stockBadgeText, { color: stockColor }]}>{stock}</Text>
          </View>
        </View>
      </TouchableOpacity>
    );
  }

  // Grid view
  return (
    <TouchableOpacity
      style={[
        styles.gridItem,
        { backgroundColor: themeColors.card, borderColor: themeColors.cardBorder },
      ]}
      onPress={onPress}
      activeOpacity={0.7}
    >
      {primary.images?.[0] || primary.image_url ? (
        <Image source={{ uri: primary.images?.[0] || primary.image_url }} style={styles.gridItemImage} />
      ) : (
        <View style={[styles.gridItemImage, styles.placeholderImage, { backgroundColor: themeColors.cardBorder }]}>
          <Ionicons name="cube" size={30} color={themeColors.textSecondary} />
        </View>
      )}
      <View style={[styles.gridStockBadge, { backgroundColor: stockColor }]}>
        <Text style={styles.gridStockText}>{stock}</Text>
      </View>
      <Text style={[styles.gridItemName, { color: themeColors.text }]} numberOfLines={2}>
        {isRTL ? primary.name_ar : primary.name}
      </Text>
      {primary.sku ? (
        <Text style={[styles.gridItemSku, { color: themeColors.textSecondary }]} numberOfLines={1}>
          {primary.sku}
        </Text>
      ) : null}
      {brandName ? (
        <Text style={[styles.gridItemSku, { color: themeColors.accent }]} numberOfLines={1}>
          🏷 {brandName}
        </Text>
      ) : null}
      {showChips ? (
        <View style={styles.gridChipRow}>
          <FitmentStrip
            mode="interactive"
            variants={variants}
            selected={selectedIndicator}
            onChange={onChipChange}
            size="sm"
            emphasizeSelection
            hideOutOfStock={false}
          />
        </View>
      ) : null}
      {modelNames.length > 0 ? (
        <Text style={[styles.gridItemSku, { color: '#8B5CF6' }]} numberOfLines={1}>
          🚗 {modelNames.join(' · ')}
        </Text>
      ) : null}
      <Animated.Text style={[styles.gridItemPrice, { color: themeColors.primary }, pulseStyle]}>
        {priceText}
      </Animated.Text>
    </TouchableOpacity>
  );
});

const styles = StyleSheet.create({
  container: { flex: 1 },
  scrollView: { flex: 1 },
  scrollContent: { paddingHorizontal: 16 },
  header: { flexDirection: 'row', alignItems: 'center', paddingVertical: 16, gap: 12 },
  headerRTL: { flexDirection: 'row-reverse' },
  backButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  headerTitle: { flex: 1, fontSize: 24, fontWeight: '700' },
  headerActions: { flexDirection: 'row', gap: 8 },
  viewToggle: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  statsRow: { flexDirection: 'row', gap: 10, marginTop: 8 },
  statCard: {
    flex: 1,
    borderRadius: 16,
    padding: 14,
    alignItems: 'center',
    borderWidth: 1,
  },
  statValue: { fontSize: 22, fontWeight: '700' },
  statLabel: { fontSize: 11, marginTop: 4, fontWeight: '500' },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginTop: 16,
    gap: 10,
    borderWidth: 1,
  },
  searchInput: { flex: 1, fontSize: 15 },
  fuelFilterContainer: { marginTop: 12, marginBottom: 4 },
  groupByContainer: { marginTop: 8, marginBottom: 8 },
  groupByPill: {
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 24,
    marginRight: 10,
    borderWidth: 1,
  },
  groupByText: { fontSize: 13, fontWeight: '600' },
  loadingContainer: { paddingVertical: 60, alignItems: 'center' },
  emptyState: { alignItems: 'center', paddingVertical: 60 },
  emptyText: { fontSize: 16, marginTop: 16 },
  groupContainer: { marginTop: 16 },
  groupHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 14,
    padding: 14,
    gap: 12,
    borderWidth: 1,
  },
  groupColorBar: { width: 4, height: 28, borderRadius: 2 },
  groupName: { flex: 1, fontSize: 16, fontWeight: '600' },
  groupBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12 },
  groupBadgeText: { fontSize: 13, fontWeight: '700' },
  gridContainer: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 12 },
  listContainer: { marginTop: 12, gap: 10 },
  gridItem: {
    width: '47%',
    borderRadius: 16,
    padding: 12,
    alignItems: 'center',
    borderWidth: 1,
  },
  gridItemImage: { width: '100%', aspectRatio: 1, borderRadius: 12, marginBottom: 10 },
  gridStockBadge: { position: 'absolute', top: 16, right: 16, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8 },
  gridStockText: { fontSize: 11, fontWeight: '700', color: '#FFF' },
  gridItemName: { fontSize: 13, fontWeight: '600', textAlign: 'center', marginBottom: 4 },
  gridItemSku: { fontSize: 10, textAlign: 'center', marginBottom: 4 },
  gridItemPrice: { fontSize: 15, fontWeight: '700' },
  gridChipRow: { width: '100%', marginTop: 4, marginBottom: 4, alignItems: 'center' },
  listChipRow: { marginTop: 6, marginBottom: 2 },
  listItem: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 14,
    padding: 12,
    gap: 12,
    borderWidth: 1,
  },
  listItemImage: { width: 56, height: 56, borderRadius: 10 },
  placeholderImage: { alignItems: 'center', justifyContent: 'center' },
  listItemInfo: { flex: 1 },
  listItemName: { fontSize: 14, fontWeight: '600' },
  listItemSku: { fontSize: 11, marginTop: 3 },
  listItemMeta: { alignItems: 'flex-end' },
  listItemPrice: { fontSize: 15, fontWeight: '700' },
  stockBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 10, marginTop: 6 },
  stockBadgeText: { fontSize: 12, fontWeight: '700' },
});


/* __ACCESS_GUARD_APPLIED__ */
export default function CollectionScreenGuarded(props: any) {
  return (
    <__AccessGuard__ scope="owner">
      <CollectionScreen {...props} />
    </__AccessGuard__>
  );
}
