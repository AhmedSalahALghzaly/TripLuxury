import React, {
  useState,
  useMemo,
  useCallback,
  memo,
  useEffect,
  useRef,
} from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  TextInput,
  ActivityIndicator,
  Image,
  Modal,
  RefreshControl,
  KeyboardAvoidingView,
  Platform,
  Switch,
  Animated,
  PanResponder,
  useWindowDimensions,
} from "react-native";
import { useQuery } from "@tanstack/react-query";
import { LineChart } from "react-native-chart-kit";
import { productsApi } from "../../src/services/api";
import { FlashList } from "@shopify/flash-list";
import {
  SafeAreaView,
  useSafeAreaInsets,
} from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter, useLocalSearchParams } from "expo-router";
import { useTheme } from "../../src/hooks/useTheme";
import { useTranslation } from "../../src/hooks/useTranslation";
import { useAdminSync } from "../../src/services/adminSyncService";
import { Header } from "../../src/components/Header";
import FitmentBadges from "../../src/components/FitmentBadges";
import FitmentStrip from "../../src/components/FitmentStrip";
import ProductTypeStrip, { ProductType } from "../../src/components/ProductTypeStrip";
import { ImageUploader } from "../../src/components/ui/ImageUploader";
import { Toast } from "../../src/components/ui/FormFeedback";
import {
  useAdminProductsListQuery,
  useProductMetadataQuery,
  useAdminProductMutations,
} from "../../src/hooks/queries";
import { useWebSocketEvent } from "../../src/services/websocketService";

import { AccessGuard as __AccessGuard__ } from '../../src/components/AccessGuard';
// ============================================================================
// Types
// ============================================================================
interface IngredientRow {
  key: string;
  en: string;
  ar: string;
}

let __ingredientRowSeq = 0;
const createIngredientRow = (en = "", ar = ""): IngredientRow => {
  __ingredientRowSeq += 1;
  return {
    key: `ing_${Date.now().toString(36)}_${__ingredientRowSeq}`,
    en,
    ar,
  };
};

interface FormState {
  name: string;
  nameAr: string;
  description: string;
  descriptionAr: string;
  ingredientRows: IngredientRow[];
  pairingNotes: string;
  pairingNotesAr: string;
  nutritionCalories: string;
  nutritionProtein: string;
  nutritionCarbs: string;
  nutritionFat: string;
  price: string;
  sku: string;
  stockQuantity: string;
  fitmentIndicator: string;
  productType: ProductType | null;
  selectedBrandId: string;
  selectedCategoryId: string;
  selectedCarModelIds: string[];
  images: string[];
  brandSearchQuery: string;
  categorySearchQuery: string;
  carModelSearchQuery: string;
  searchQuery: string;
  isEditMode: boolean;
  editingProduct: any;
  error: string;
  saving: boolean;
  showSuccess: boolean;
}

interface FormHandlers {
  setName: (v: string) => void;
  setNameAr: (v: string) => void;
  setDescription: (v: string) => void;
  setDescriptionAr: (v: string) => void;
  addIngredientRow: () => void;
  removeIngredientRow: (key: string) => void;
  moveIngredientRow: (key: string, direction: -1 | 1) => void;
  reorderIngredientRow: (key: string, toIndex: number) => void;
  updateIngredientRow: (key: string, side: "en" | "ar", value: string) => void;
  setPairingNotes: (v: string) => void;
  setPairingNotesAr: (v: string) => void;
  setNutritionCalories: (v: string) => void;
  setNutritionProtein: (v: string) => void;
  setNutritionCarbs: (v: string) => void;
  setNutritionFat: (v: string) => void;
  setPrice: (v: string) => void;
  setSku: (v: string) => void;
  setStockQuantity: (v: string) => void;
  setFitmentIndicator: (v: string) => void;
  setProductType: (v: ProductType | null) => void;
  setSelectedBrandId: (v: string) => void;
  setSelectedCategoryId: (v: string) => void;
  setSelectedCarModelIds: (v: string[]) => void;
  setImages: (v: string[]) => void;
  setBrandSearchQuery: (v: string) => void;
  setCategorySearchQuery: (v: string) => void;
  setCarModelSearchQuery: (v: string) => void;
  setSearchQuery: (v: string) => void;
  toggleCarModel: (id: string) => void;
  handleSave: () => void;
  resetForm: () => void;
}

interface Lookups {
  productBrands: any[];
  categories: any[];
  carModels: any[];
  brandMap: Record<string, any>;
  categoryMap: Record<string, any>;
  carModelMap: Record<string, any>;
}

interface ProductFormHeaderProps {
  formState: FormState;
  handlers: FormHandlers;
  lookups: Lookups;
  colors: any;
  language: string;
  isRTL: boolean;
  productsCount: number;
  router: any;
}

// ============================================================================
// Draggable ingredient row
// ----------------------------------------------------------------------------
// Each row owns its own PanResponder and Animated translateY so the user can
// long-tap the dedicated drag handle and physically drag a row up or down to
// reorder it. The arrow buttons remain as a one-tap accessibility fallback.
// On release we round the vertical displacement to a row-height step and
// hand the destination index back to the parent via `onReorder`.
// ============================================================================
interface IngredientRowItemProps {
  row: IngredientRow;
  index: number;
  total: number;
  colors: any;
  language: string;
  isRTL: boolean;
  onMove: (key: string, direction: -1 | 1) => void;
  onReorder: (key: string, toIndex: number) => void;
  onRemove: (key: string) => void;
  onUpdate: (key: string, side: "en" | "ar", value: string) => void;
  rowHeightRef: React.MutableRefObject<number>;
}

const IngredientRowItem = memo(function IngredientRowItem({
  row,
  index,
  total,
  colors,
  language,
  isRTL,
  onMove,
  onReorder,
  onRemove,
  onUpdate,
  rowHeightRef,
}: IngredientRowItemProps) {
  const dragY = useRef(new Animated.Value(0)).current;
  const [isDragging, setIsDragging] = useState(false);
  // Track the row's live index in a ref so the PanResponder closure (which
  // we only build once per row key) always sees the correct origin index
  // when the user releases the drag.
  const indexRef = useRef(index);
  useEffect(() => {
    indexRef.current = index;
  }, [index]);

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dy) > 2,
        onPanResponderGrant: () => {
          setIsDragging(true);
          dragY.setValue(0);
        },
        onPanResponderMove: (_, g) => {
          dragY.setValue(g.dy);
        },
        onPanResponderRelease: (_, g) => {
          const h = rowHeightRef.current || 120;
          const delta = Math.round(g.dy / h);
          dragY.setValue(0);
          setIsDragging(false);
          if (delta !== 0) {
            onReorder(row.key, indexRef.current + delta);
          }
        },
        onPanResponderTerminate: () => {
          dragY.setValue(0);
          setIsDragging(false);
        },
      }),
    [row.key, dragY, rowHeightRef, onReorder],
  );

  const isFirst = index === 0;
  const isLast = index === total - 1;

  return (
    <Animated.View
      onLayout={(e) => {
        const h = e.nativeEvent.layout.height;
        // Only update the shared row-height ref when not actively dragging
        // (dragging changes layout shadows/elevation and would skew the step
        // size used to compute the destination index).
        if (!isDragging && h > 40) rowHeightRef.current = h;
      }}
      style={[
        styles.ingredientRow,
        {
          borderColor: isDragging ? colors.primary : colors.border,
          backgroundColor: colors.surface,
          transform: [{ translateY: dragY }],
          ...(isDragging
            ? {
                zIndex: 10,
                elevation: 6,
                shadowColor: "#000",
                shadowOpacity: 0.18,
                shadowRadius: 8,
                shadowOffset: { width: 0, height: 4 },
              }
            : null),
        },
      ]}
    >
      <View style={styles.ingredientRowControls}>
        <Text
          style={[
            styles.ingredientRowIndex,
            { color: colors.textSecondary },
          ]}
        >
          {index + 1}
        </Text>
        <View
          {...panResponder.panHandlers}
          style={[
            styles.ingredientRowDragHandle,
            {
              borderColor: isDragging ? colors.primary : colors.border,
              backgroundColor: isDragging
                ? colors.primary + "18"
                : "transparent",
            },
          ]}
          accessibilityLabel={
            language === "ar"
              ? "اسحب لإعادة الترتيب"
              : "Drag to reorder"
          }
        >
          <Ionicons
            name="reorder-three"
            size={18}
            color={isDragging ? colors.primary : colors.text}
          />
        </View>
        <TouchableOpacity
          onPress={() => onMove(row.key, -1)}
          disabled={isFirst}
          style={[
            styles.ingredientRowBtn,
            { borderColor: colors.border, opacity: isFirst ? 0.35 : 1 },
          ]}
          accessibilityLabel={
            language === "ar" ? "حرّك للأعلى" : "Move up"
          }
        >
          <Ionicons name="chevron-up" size={14} color={colors.text} />
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => onMove(row.key, 1)}
          disabled={isLast}
          style={[
            styles.ingredientRowBtn,
            { borderColor: colors.border, opacity: isLast ? 0.35 : 1 },
          ]}
          accessibilityLabel={
            language === "ar" ? "حرّك للأسفل" : "Move down"
          }
        >
          <Ionicons name="chevron-down" size={14} color={colors.text} />
        </TouchableOpacity>
      </View>
      <View style={styles.ingredientRowFields}>
        <TextInput
          style={[
            styles.input,
            {
              backgroundColor: colors.card,
              borderColor: colors.border,
              color: colors.text,
            },
          ]}
          value={row.en}
          onChangeText={(text) => onUpdate(row.key, "en", text)}
          placeholder={
            language === "ar"
              ? "Hand-selected produce"
              : "English ingredient"
          }
          placeholderTextColor={colors.textSecondary}
        />
        <TextInput
          style={[
            styles.input,
            {
              backgroundColor: colors.card,
              borderColor: colors.border,
              color: colors.text,
              marginTop: 8,
              textAlign: "right",
            },
          ]}
          value={row.ar}
          onChangeText={(text) => onUpdate(row.key, "ar", text)}
          placeholder={
            language === "ar" ? "مكوّن بالعربية" : "مكوّن بالعربية"
          }
          placeholderTextColor={colors.textSecondary}
        />
      </View>
      <TouchableOpacity
        onPress={() => onRemove(row.key)}
        style={[
          styles.ingredientRowDelete,
          { backgroundColor: colors.error + "18" },
        ]}
        accessibilityLabel={
          language === "ar" ? "احذف المكوّن" : "Remove ingredient"
        }
      >
        <Ionicons name="trash-outline" size={16} color={colors.error} />
      </TouchableOpacity>
    </Animated.View>
  );
});

// ============================================================================
// Stock History inline section — shown in edit mode only
// ============================================================================
interface StockHistoryRow {
  id: string | number;
  changed_at: string;
  new_quantity: number | string | null;
  old_quantity: number | string | null;
  source: string;
  note?: string | null;
  changed_by_user_name?: string | null;
  changed_by_name?: string | null;
}

const STOCK_SOURCE_LABELS: Record<string, string> = {
  order:   'Order',
  restock: 'Restock',
  edit:    'Manual edit',
  manual:  'Manual edit',
};

const ProductStockHistorySection = memo(function ProductStockHistorySection({
  productId,
  colors,
  language,
}: {
  productId: string;
  colors: any;
  language: string;
}) {
  const { width: W } = useWindowDimensions();
  const chartW = W - 64; // account for card padding
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);

  const since30d = useMemo(
    () => new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
    [],
  );

  const { data: hist, isLoading, isError } = useQuery<StockHistoryRow[]>({
    queryKey: ['product-stock-history-chart', productId, since30d],
    enabled: !!productId,
    queryFn: () =>
      productsApi.getStockHistory(productId, { since: since30d }).then(
        (r: { data: StockHistoryRow[] }) => r.data,
      ),
    staleTime: 60_000,
  });

  const histKey = `${hist?.length ?? 0}:${hist?.[0]?.id ?? ''}`;
  useEffect(() => { setSelectedIdx(null); }, [histKey]);

  const chartData = useMemo(() => {
    if (!hist || hist.length === 0) return null;
    const rows = [...hist].reverse();
    const step = Math.ceil(rows.length / 6);
    const labels = rows.map((r: StockHistoryRow, i: number) => {
      if (i % step !== 0) return '';
      const d = new Date(r.changed_at);
      return `${d.getMonth() + 1}/${d.getDate()}`;
    });
    const values = rows.map((r: StockHistoryRow) =>
      Math.max(0, parseInt(String(r.new_quantity ?? 0), 10) || 0),
    );
    return { labels, values, rows };
  }, [hist]);

  const selectedEvent =
    selectedIdx !== null && chartData?.rows ? chartData.rows[selectedIdx] ?? null : null;

  const handleDotClick = useCallback(({ index }: { index: number }) => {
    setSelectedIdx(prev => (prev === index ? null : index));
  }, []);

  const formatTs = (iso: string) => {
    const d = new Date(iso);
    return (
      d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) +
      '  ' +
      d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
    );
  };

  const accentColor = colors.primary;
  const bgColor    = colors.surface ?? colors.card;
  const labelColor = colors.textSecondary;
  const borderColor = colors.border;

  return (
    <View style={[styles.formSectionInner, { borderColor }]}>
      <Text style={[styles.sectionLabel, { color: accentColor }]}>
        <Ionicons name="analytics" size={14} />{' '}
        {language === 'ar' ? 'سجل المخزون (آخر 30 يوم)' : 'Stock History (last 30 days)'}
      </Text>

      {isLoading ? (
        <View style={{ paddingVertical: 32, alignItems: 'center' }}>
          <ActivityIndicator color={accentColor} />
        </View>
      ) : isError ? (
        <View style={{ paddingVertical: 28, alignItems: 'center', gap: 8 }}>
          <Ionicons name="alert-circle-outline" size={28} color={colors.error} />
          <Text style={{ color: labelColor, fontSize: 13, textAlign: 'center' }}>
            {language === 'ar' ? 'تعذّر تحميل البيانات' : 'Failed to load chart data'}
          </Text>
        </View>
      ) : !chartData ? (
        <View style={{ paddingVertical: 28, alignItems: 'center', gap: 8 }}>
          <Ionicons name="analytics-outline" size={28} color={labelColor} />
          <Text style={{ color: labelColor, fontSize: 13, textAlign: 'center' }}>
            {language === 'ar' ? 'لا توجد تغييرات في المخزون بعد' : 'No stock changes recorded yet'}
          </Text>
        </View>
      ) : (
        <View style={{ overflow: 'hidden', marginHorizontal: -4 }}>
          <LineChart
            data={{
              labels: chartData.labels,
              datasets: [{ data: chartData.values, color: () => accentColor, strokeWidth: 2 }],
            }}
            width={chartW + 24}
            height={200}
            withDots
            withShadow={false}
            withInnerLines
            withOuterLines={false}
            withVerticalLabels
            withHorizontalLabels
            chartConfig={{
              backgroundColor: 'transparent',
              backgroundGradientFrom: bgColor,
              backgroundGradientTo: bgColor,
              color: () => accentColor,
              labelColor: () => labelColor,
              strokeWidth: 2,
              propsForDots: {
                r: chartData.values.length <= 20 ? '5' : '3',
                fill: accentColor,
                strokeWidth: '2',
                stroke: bgColor,
              },
              propsForBackgroundLines: { stroke: borderColor },
              decimalPlaces: 0,
            }}
            onDataPointClick={handleDotClick}
            bezier
            style={{ marginLeft: -16 }}
          />

          <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 4, marginTop: 4 }}>
            <Text style={{ fontSize: 11, color: labelColor }}>
              {hist!.length} {language === 'ar' ? 'تغيير' : `change${hist!.length !== 1 ? 's' : ''}`}
            </Text>
            <Text style={{ fontSize: 11, color: accentColor, fontWeight: '600' }}>
              {language === 'ar' ? `الحالي: ${chartData.values[chartData.values.length - 1]}` : `Current: ${chartData.values[chartData.values.length - 1]} units`}
            </Text>
          </View>

          {selectedIdx === null && (
            <Text style={{ fontSize: 11, color: labelColor, textAlign: 'center', fontStyle: 'italic', marginTop: 6 }}>
              {language === 'ar' ? 'اضغط على نقطة لعرض التفاصيل' : 'Tap a dot for change details'}
            </Text>
          )}

          {selectedEvent && (() => {
            const newQty = selectedEvent.new_quantity != null ? Number(selectedEvent.new_quantity) : null;
            const oldQty = selectedEvent.old_quantity != null ? Number(selectedEvent.old_quantity) : null;
            const delta  = newQty != null && oldQty != null ? newQty - oldQty : null;
            const isUp   = delta != null ? delta >= 0 : true;
            return (
              <View style={{
                marginTop: 10,
                backgroundColor: accentColor + '10',
                borderWidth: 1,
                borderColor: accentColor + '30',
                borderRadius: 12,
                padding: 12,
                gap: 8,
              }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                  <View style={{
                    flexDirection: 'row', alignItems: 'center', gap: 5,
                    backgroundColor: accentColor + '18',
                    borderRadius: 20, paddingHorizontal: 10, paddingVertical: 3,
                  }}>
                    <Ionicons
                      name={
                        selectedEvent.source === 'order'   ? 'cart-outline'
                        : selectedEvent.source === 'restock' ? 'add-circle-outline'
                        : 'create-outline'
                      }
                      size={13}
                      color={accentColor}
                    />
                    <Text style={{ fontSize: 12, color: accentColor, fontWeight: '600' }}>
                      {STOCK_SOURCE_LABELS[selectedEvent.source] ?? selectedEvent.source ?? 'Unknown'}
                    </Text>
                  </View>
                  <TouchableOpacity
                    onPress={() => setSelectedIdx(null)}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  >
                    <Ionicons name="close-circle" size={18} color={labelColor} />
                  </TouchableOpacity>
                </View>

                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <Text style={{ fontSize: 22, fontWeight: '700', color: labelColor }}>
                      {oldQty ?? '?'}
                    </Text>
                    <Ionicons name="arrow-forward" size={15} color={labelColor} />
                    <Text style={{ fontSize: 22, fontWeight: '700', color: isUp ? colors.primary : colors.error }}>
                      {newQty ?? '?'}
                    </Text>
                    <Text style={{ fontSize: 12, color: labelColor, marginLeft: 2 }}>
                      {language === 'ar' ? 'وحدة' : 'units'}
                    </Text>
                  </View>
                  {delta != null && (
                    <View style={{
                      backgroundColor: isUp ? accentColor + '18' : colors.error + '18',
                      borderRadius: 8, paddingHorizontal: 8, paddingVertical: 2,
                    }}>
                      <Text style={{ fontSize: 12, fontWeight: '600', color: isUp ? accentColor : colors.error }}>
                        {isUp ? '+' : ''}{delta}
                      </Text>
                    </View>
                  )}
                </View>

                <View style={{ gap: 3 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                    <Ionicons name="person-outline" size={12} color={labelColor} />
                    <Text style={{ fontSize: 12, color: labelColor }}>
                      {selectedEvent.changed_by_user_name ?? selectedEvent.changed_by_name ?? 'System'}
                    </Text>
                  </View>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                    <Ionicons name="time-outline" size={12} color={labelColor} />
                    <Text style={{ fontSize: 12, color: labelColor }}>
                      {selectedEvent.changed_at ? formatTs(selectedEvent.changed_at) : '—'}
                    </Text>
                  </View>
                  {selectedEvent.note ? (
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                      <Ionicons name="chatbubble-outline" size={12} color={labelColor} />
                      <Text style={{ fontSize: 12, color: labelColor }} numberOfLines={2}>
                        {selectedEvent.note}
                      </Text>
                    </View>
                  ) : null}
                </View>
              </View>
            );
          })()}
        </View>
      )}
    </View>
  );
});

// ============================================================================
// Standalone Product Form Header Component - OUTSIDE main component
// This prevents re-mounting when form state changes
// ============================================================================
const ProductFormHeader = memo(
  ({
    formState,
    handlers,
    lookups,
    colors,
    language,
    isRTL,
    productsCount,
    router,
  }: ProductFormHeaderProps) => {
    const {
      name,
      nameAr,
      description,
      descriptionAr,
      ingredientRows,
      pairingNotes,
      pairingNotesAr,
      nutritionCalories,
      nutritionProtein,
      nutritionCarbs,
      nutritionFat,
      price,
      sku,
      stockQuantity,
      fitmentIndicator,
      productType,
      selectedBrandId,
      selectedCategoryId,
      selectedCarModelIds,
      images,
      brandSearchQuery,
      categorySearchQuery,
      carModelSearchQuery,
      searchQuery,
      isEditMode,
      editingProduct,
      error,
      saving,
      showSuccess,
    } = formState;

    const {
      setName,
      setNameAr,
      setDescription,
      setDescriptionAr,
      addIngredientRow,
      removeIngredientRow,
      moveIngredientRow,
      reorderIngredientRow,
      updateIngredientRow,
      setPairingNotes,
      setPairingNotesAr,
      setNutritionCalories,
      setNutritionProtein,
      setNutritionCarbs,
      setNutritionFat,
      setPrice,
      setSku,
      setStockQuantity,
      setFitmentIndicator,
      setProductType,
      setSelectedBrandId,
      setSelectedCategoryId,
      setImages,
      setBrandSearchQuery,
      setCategorySearchQuery,
      setCarModelSearchQuery,
      setSearchQuery,
      toggleCarModel,
      handleSave,
      resetForm,
    } = handlers;

    const { productBrands, categories, carModels, brandMap } = lookups;

    // Shared row-height reference across all ingredient rows. Each row
    // updates this ref via onLayout so the drag step calculation always
    // matches the actual rendered row size, even after font scaling or
    // platform-specific padding changes.
    const ingredientRowHeightRef = useRef(120);

    const getSelectedBrandName = () => {
      if (!selectedBrandId) return null;
      const brand = brandMap[selectedBrandId];
      return language === "ar" ? brand?.name_ar : brand?.name;
    };

    return (
      <View style={styles.listHeaderContainer}>
        {/* Breadcrumb */}
        <View style={[styles.breadcrumb, isRTL && styles.breadcrumbRTL]}>
          <TouchableOpacity onPress={() => router.push("/admin")}>
            <Text style={[styles.breadcrumbText, { color: colors.primary }]}>
              {language === "ar" ? "لوحة التحكم" : "Admin"}
            </Text>
          </TouchableOpacity>
          <Ionicons
            name={isRTL ? "chevron-back" : "chevron-forward"}
            size={16}
            color={colors.textSecondary}
          />
          <Text
            style={[styles.breadcrumbText, { color: colors.textSecondary }]}
          >
            {language === "ar" ? "المنتجات" : "Products"}
          </Text>
        </View>

        {/* Add/Edit Form */}
        <View
          style={[
            styles.formCard,
            {
              backgroundColor: colors.card,
              borderColor: isEditMode ? colors.primary : colors.border,
            },
          ]}
        >
          <View style={styles.formTitleRow}>
            <Text
              style={[
                styles.formTitle,
                { color: isEditMode ? colors.primary : colors.text },
              ]}
            >
              {isEditMode
                ? language === "ar"
                  ? "تعديل المنتج"
                  : "Edit Product"
                : language === "ar"
                  ? "إضافة منتج جديد"
                  : "Add New Product"}
            </Text>
            {isEditMode && (
              <TouchableOpacity
                style={[
                  styles.cancelEditBtn,
                  { backgroundColor: colors.error + "20" },
                ]}
                onPress={resetForm}
              >
                <Ionicons name="close" size={18} color={colors.error} />
                <Text style={[styles.cancelEditText, { color: colors.error }]}>
                  {language === "ar" ? "إلغاء" : "Cancel"}
                </Text>
              </TouchableOpacity>
            )}
          </View>

          {/* Section 1: Basic Product Information */}
          <View
            style={[styles.formSectionInner, { borderColor: colors.border }]}
          >
            <Text style={[styles.sectionLabel, { color: colors.primary }]}>
              <Ionicons name="information-circle" size={14} />{" "}
              {language === "ar" ? "المعلومات الأساسية" : "Basic Information"}
            </Text>

            <View style={styles.formGroup}>
              <Text style={[styles.label, { color: colors.text }]}>
                {language === "ar"
                  ? "اسم المنتج (بالإنجليزية) *"
                  : "Product Name (English) *"}
              </Text>
              <TextInput
                style={[
                  styles.input,
                  {
                    backgroundColor: colors.surface,
                    borderColor: colors.border,
                    color: colors.text,
                  },
                ]}
                value={name}
                onChangeText={setName}
                placeholder={
                  language === "ar" ? "مثال: Oil Filter" : "e.g., Oil Filter"
                }
                placeholderTextColor={colors.textSecondary}
              />
            </View>

            <View style={styles.formGroup}>
              <Text style={[styles.label, { color: colors.text }]}>
                {language === "ar"
                  ? "اسم المنتج (بالعربية) *"
                  : "Product Name (Arabic) *"}
              </Text>
              <TextInput
                style={[
                  styles.input,
                  {
                    backgroundColor: colors.surface,
                    borderColor: colors.border,
                    color: colors.text,
                  },
                  isRTL && styles.inputRTL,
                ]}
                value={nameAr}
                onChangeText={setNameAr}
                placeholder={
                  language === "ar" ? "مثال: فلتر زيت" : "e.g., فلتر زيت"
                }
                placeholderTextColor={colors.textSecondary}
              />
            </View>

            <View style={styles.formGroup}>
              <Text style={[styles.label, { color: colors.text }]}>
                {language === "ar"
                  ? "الوصف (بالإنجليزية)"
                  : "Description (English)"}
              </Text>
              <TextInput
                style={[
                  styles.textArea,
                  {
                    backgroundColor: colors.surface,
                    borderColor: colors.border,
                    color: colors.text,
                  },
                ]}
                value={description}
                onChangeText={setDescription}
                placeholder={
                  language === "ar"
                    ? "وصف تفصيلي للمنتج..."
                    : "Detailed product description..."
                }
                placeholderTextColor={colors.textSecondary}
                multiline
                numberOfLines={3}
              />
            </View>

            <View style={styles.formGroup}>
              <Text style={[styles.label, { color: colors.text }]}>
                {language === "ar"
                  ? "الوصف (بالعربية)"
                  : "Description (Arabic)"}
              </Text>
              <TextInput
                style={[
                  styles.textArea,
                  {
                    backgroundColor: colors.surface,
                    borderColor: colors.border,
                    color: colors.text,
                  },
                  isRTL && styles.inputRTL,
                ]}
                value={descriptionAr}
                onChangeText={setDescriptionAr}
                placeholder={
                  language === "ar"
                    ? "وصف تفصيلي بالعربية..."
                    : "Arabic description..."
                }
                placeholderTextColor={colors.textSecondary}
                multiline
                numberOfLines={3}
              />
            </View>

            {/* ── Dish editorial fields ─────────────────────────────────
                Powers the four-tab strip on the customer dish detail page
                (Description / Ingredients / AI Pairing / Nutrition).

                Ingredients are managed as a paired EN/AR sortable list so
                operators can reorder with a tap instead of retyping the
                whole text-area, and so the two languages stay aligned
                row-by-row. On save we still emit the same `ingredients`
                / `ingredients_ar` JSON arrays the API expects. */}
            <View style={styles.formGroup}>
              <View style={styles.ingredientsHeaderRow}>
                <Text style={[styles.label, { color: colors.text, marginBottom: 0 }]}>
                  {language === "ar"
                    ? "المكوّنات (إنجليزي / عربي)"
                    : "Ingredients (EN / AR)"}
                </Text>
                <Text
                  style={[
                    styles.ingredientsCount,
                    { color: colors.textSecondary },
                  ]}
                >
                  {language === "ar"
                    ? `${ingredientRows.length} مكوّن`
                    : `${ingredientRows.length} item${ingredientRows.length === 1 ? "" : "s"}`}
                </Text>
              </View>
              <Text
                style={[
                  styles.fieldHint,
                  { color: colors.textSecondary },
                ]}
              >
                {language === "ar"
                  ? "كل صف يطابق نفس المكوّن في اللغتين. اسحب من المقبض لإعادة الترتيب أو استخدم الأسهم."
                  : "Each row pairs the same ingredient in both languages. Drag the handle to reorder, or use the arrows."}
              </Text>

              {ingredientRows.length === 0 ? (
                <View
                  style={[
                    styles.ingredientsEmpty,
                    {
                      borderColor: colors.border,
                      backgroundColor: colors.surface,
                    },
                  ]}
                >
                  <Ionicons
                    name="restaurant-outline"
                    size={18}
                    color={colors.textSecondary}
                  />
                  <Text
                    style={{ color: colors.textSecondary, fontSize: 13 }}
                  >
                    {language === "ar"
                      ? "لا توجد مكوّنات بعد. أضف الصف الأول."
                      : "No ingredients yet. Add the first row."}
                  </Text>
                </View>
              ) : (
                ingredientRows.map((row, idx) => (
                  <IngredientRowItem
                    key={row.key}
                    row={row}
                    index={idx}
                    total={ingredientRows.length}
                    colors={colors}
                    language={language}
                    isRTL={isRTL}
                    onMove={moveIngredientRow}
                    onReorder={reorderIngredientRow}
                    onRemove={removeIngredientRow}
                    onUpdate={updateIngredientRow}
                    rowHeightRef={ingredientRowHeightRef}
                  />
                ))
              )}

              <TouchableOpacity
                onPress={addIngredientRow}
                style={[
                  styles.ingredientAddBtn,
                  {
                    borderColor: colors.primary,
                    backgroundColor: colors.primary + "10",
                  },
                ]}
              >
                <Ionicons name="add" size={16} color={colors.primary} />
                <Text style={{ color: colors.primary, fontWeight: "600" }}>
                  {language === "ar" ? "أضف مكوّن" : "Add ingredient"}
                </Text>
              </TouchableOpacity>
            </View>

            <View style={styles.formGroup}>
              <Text style={[styles.label, { color: colors.text }]}>
                {language === "ar"
                  ? "اقتراح المرافقات (بالإنجليزية)"
                  : "AI pairing notes (English)"}
              </Text>
              <TextInput
                style={[
                  styles.textArea,
                  {
                    backgroundColor: colors.surface,
                    borderColor: colors.border,
                    color: colors.text,
                  },
                ]}
                value={pairingNotes}
                onChangeText={setPairingNotes}
                placeholder={
                  language === "ar"
                    ? "Pair this dish with a crisp citrus white..."
                    : "Pair this dish with a crisp citrus white..."
                }
                placeholderTextColor={colors.textSecondary}
                multiline
                numberOfLines={3}
              />
            </View>

            <View style={styles.formGroup}>
              <Text style={[styles.label, { color: colors.text }]}>
                {language === "ar"
                  ? "اقتراح المرافقات (بالعربية)"
                  : "AI pairing notes (Arabic)"}
              </Text>
              <TextInput
                style={[
                  styles.textArea,
                  {
                    backgroundColor: colors.surface,
                    borderColor: colors.border,
                    color: colors.text,
                  },
                  isRTL && styles.inputRTL,
                ]}
                value={pairingNotesAr}
                onChangeText={setPairingNotesAr}
                placeholder={
                  language === "ar"
                    ? "يقترح الكونسيرج الذكي مرافقة هذا الطبق..."
                    : "يقترح الكونسيرج الذكي مرافقة هذا الطبق..."
                }
                placeholderTextColor={colors.textSecondary}
                multiline
                numberOfLines={3}
              />
            </View>

            <View style={styles.formGroup}>
              <Text style={[styles.label, { color: colors.text }]}>
                {language === "ar"
                  ? "القيم الغذائية لكل حصة"
                  : "Nutrition (per serving)"}
              </Text>
              <View style={styles.row}>
                <View style={[styles.formGroup, { flex: 1, marginBottom: 0 }]}>
                  <Text style={[styles.label, { color: colors.textSecondary, fontSize: 12 }]}>
                    {language === "ar" ? "السعرات (kcal)" : "Calories (kcal)"}
                  </Text>
                  <TextInput
                    style={[
                      styles.input,
                      {
                        backgroundColor: colors.surface,
                        borderColor: colors.border,
                        color: colors.text,
                      },
                    ]}
                    value={nutritionCalories}
                    onChangeText={setNutritionCalories}
                    keyboardType="decimal-pad"
                    placeholder="420"
                    placeholderTextColor={colors.textSecondary}
                  />
                </View>
                <View style={[styles.formGroup, { flex: 1, marginLeft: 12, marginBottom: 0 }]}>
                  <Text style={[styles.label, { color: colors.textSecondary, fontSize: 12 }]}>
                    {language === "ar" ? "البروتين (g)" : "Protein (g)"}
                  </Text>
                  <TextInput
                    style={[
                      styles.input,
                      {
                        backgroundColor: colors.surface,
                        borderColor: colors.border,
                        color: colors.text,
                      },
                    ]}
                    value={nutritionProtein}
                    onChangeText={setNutritionProtein}
                    keyboardType="decimal-pad"
                    placeholder="24"
                    placeholderTextColor={colors.textSecondary}
                  />
                </View>
              </View>
              <View style={[styles.row, { marginTop: 12 }]}>
                <View style={[styles.formGroup, { flex: 1, marginBottom: 0 }]}>
                  <Text style={[styles.label, { color: colors.textSecondary, fontSize: 12 }]}>
                    {language === "ar" ? "الكربوهيدرات (g)" : "Carbs (g)"}
                  </Text>
                  <TextInput
                    style={[
                      styles.input,
                      {
                        backgroundColor: colors.surface,
                        borderColor: colors.border,
                        color: colors.text,
                      },
                    ]}
                    value={nutritionCarbs}
                    onChangeText={setNutritionCarbs}
                    keyboardType="decimal-pad"
                    placeholder="38"
                    placeholderTextColor={colors.textSecondary}
                  />
                </View>
                <View style={[styles.formGroup, { flex: 1, marginLeft: 12, marginBottom: 0 }]}>
                  <Text style={[styles.label, { color: colors.textSecondary, fontSize: 12 }]}>
                    {language === "ar" ? "الدهون (g)" : "Fat (g)"}
                  </Text>
                  <TextInput
                    style={[
                      styles.input,
                      {
                        backgroundColor: colors.surface,
                        borderColor: colors.border,
                        color: colors.text,
                      },
                    ]}
                    value={nutritionFat}
                    onChangeText={setNutritionFat}
                    keyboardType="decimal-pad"
                    placeholder="18"
                    placeholderTextColor={colors.textSecondary}
                  />
                </View>
              </View>
            </View>

            <View style={styles.row}>
              <View style={[styles.formGroup, { flex: 1 }]}>
                <Text style={[styles.label, { color: colors.text }]}>
                  SKU *
                </Text>
                <TextInput
                  style={[
                    styles.input,
                    {
                      backgroundColor: colors.surface,
                      borderColor: colors.border,
                      color: colors.text,
                    },
                  ]}
                  value={sku}
                  onChangeText={setSku}
                  placeholder="ABC-123"
                  placeholderTextColor={colors.textSecondary}
                />
              </View>
              <View style={[styles.formGroup, { flex: 1, marginLeft: 12 }]}>
                <Text style={[styles.label, { color: colors.text }]}>
                  {language === "ar" ? "السعر *" : "Price *"}
                </Text>
                <TextInput
                  style={[
                    styles.input,
                    {
                      backgroundColor: colors.surface,
                      borderColor: colors.border,
                      color: colors.text,
                    },
                  ]}
                  value={price}
                  onChangeText={setPrice}
                  keyboardType="decimal-pad"
                  placeholder="0.00"
                  placeholderTextColor={colors.textSecondary}
                />
              </View>
              <View style={[styles.formGroup, { flex: 1, marginLeft: 12 }]}>
                <Text style={[styles.label, { color: colors.text }]}>
                  {language === "ar" ? "الكمية" : "Stock"}
                </Text>
                <TextInput
                  style={[
                    styles.input,
                    {
                      backgroundColor: colors.surface,
                      borderColor: colors.border,
                      color: colors.text,
                    },
                  ]}
                  value={stockQuantity}
                  onChangeText={setStockQuantity}
                  keyboardType="number-pad"
                  placeholder="0"
                  placeholderTextColor={colors.textSecondary}
                />
              </View>
            </View>

            {/* Fitment indicator */}
            <View style={[styles.formGroup, { marginTop: 8 }]}>
              <Text style={[styles.label, { color: colors.text }]}>
                {language === "ar" ? "مؤشر التناسب" : "Fitment indicator"}
              </Text>
              <FitmentStrip
                mode="interactive"
                selected={fitmentIndicator || undefined}
                onChange={(ind) => setFitmentIndicator(ind === fitmentIndicator ? "" : ind)}
                size="md"
              />
              <Text style={{ color: colors.textSecondary, fontSize: 11, marginTop: 6 }}>
                {language === "ar"
                  ? "اختر الحجم إن كان المنتج له متغيرات (صغير/وسط/كبير...). اضغط مرة أخرى لإلغاء الاختيار."
                  : "Pick a size if this product has variants (صغير/وسط/كبير...). Tap again to deselect."}
              </Text>
            </View>

            {/* Product type strip — Tire / Accessory / Exterior Body */}
            <View style={[styles.formGroup, { marginTop: 12 }]}>
              <Text style={[styles.label, { color: colors.text }]}>
                {language === "ar" ? "نوع المنتج" : "Product type"}
              </Text>
              <ProductTypeStrip
                mode="single"
                value={productType}
                onChange={setProductType}
                size="md"
                allowClear
              />
              <Text style={{ color: colors.textSecondary, fontSize: 11, marginTop: 6 }}>
                {language === "ar"
                  ? "اختر النوع لعرض المنتج في الشريط المخصص. اضغط مرة أخرى لإلغاء الاختيار."
                  : "Pick a type to surface this product in its dedicated strip. Tap again to clear."}
              </Text>
            </View>
          </View>

          {/* Section 2: Product Relationships */}
          <View
            style={[styles.formSectionInner, { borderColor: colors.border }]}
          >
            <Text style={[styles.sectionLabel, { color: colors.primary }]}>
              <Ionicons name="link" size={14} />{" "}
              {language === "ar"
                ? "التصنيفات والعلاقات"
                : "Classifications & Relations"}
            </Text>

            {/* Product Brand Selection */}
            <View style={styles.formGroup}>
              <View style={styles.labelWithSearch}>
                <Text style={[styles.label, { color: colors.text }]}>
                  {language === "ar" ? "ماركة المنتج *" : "Product Brand *"}
                </Text>
                <View
                  style={[
                    styles.miniSearchContainer,
                    {
                      backgroundColor: colors.surface,
                      borderColor: colors.border,
                    },
                  ]}
                >
                  <Ionicons
                    name="search"
                    size={14}
                    color={colors.textSecondary}
                  />
                  <TextInput
                    style={[styles.miniSearchInput, { color: colors.text }]}
                    value={brandSearchQuery}
                    onChangeText={setBrandSearchQuery}
                    placeholder={language === "ar" ? "بحث..." : "Search..."}
                    placeholderTextColor={colors.textSecondary}
                  />
                  {brandSearchQuery.length > 0 && (
                    <TouchableOpacity onPress={() => setBrandSearchQuery("")}>
                      <Ionicons
                        name="close-circle"
                        size={14}
                        color={colors.textSecondary}
                      />
                    </TouchableOpacity>
                  )}
                </View>
              </View>
              <Text style={[styles.fieldHint, { color: colors.textSecondary }]}>
                {language === "ar"
                  ? "اختر الماركة المصنعة للمنتج"
                  : "Select the product manufacturer brand"}
              </Text>

              {selectedBrandId && (
                <View
                  style={[
                    styles.selectedDisplay,
                    {
                      backgroundColor: colors.primary + "15",
                      borderColor: colors.primary,
                    },
                  ]}
                >
                  {brandMap[selectedBrandId]?.logo && (
                    <Image
                      source={{ uri: brandMap[selectedBrandId]?.logo }}
                      style={styles.selectedBrandLogo}
                    />
                  )}
                  <Ionicons name="pricetag" size={16} color={colors.primary} />
                  <Text
                    style={[styles.selectedText, { color: colors.primary }]}
                  >
                    {getSelectedBrandName()}
                  </Text>
                  <TouchableOpacity
                    onPress={() => handlers.setSelectedBrandId("")}
                  >
                    <Ionicons
                      name="close-circle"
                      size={18}
                      color={colors.primary}
                    />
                  </TouchableOpacity>
                </View>
              )}

              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                style={styles.chipsContainer}
              >
                {productBrands
                  .filter((brand) => {
                    if (!brandSearchQuery.trim()) return true;
                    const query = brandSearchQuery.toLowerCase();
                    return (
                      (brand.name || "").toLowerCase().includes(query) ||
                      (brand.name_ar || "").toLowerCase().includes(query)
                    );
                  })
                  .map((brand) => (
                    <TouchableOpacity
                      key={brand.id}
                      style={[
                        styles.brandChip,
                        {
                          backgroundColor:
                            selectedBrandId === brand.id
                              ? colors.primary
                              : colors.surface,
                          borderColor:
                            selectedBrandId === brand.id
                              ? colors.primary
                              : colors.border,
                        },
                      ]}
                      onPress={() => setSelectedBrandId(brand.id)}
                    >
                      {brand.logo ? (
                        <Image
                          source={{ uri: brand.logo }}
                          style={[
                            styles.brandChipLogo,
                            {
                              borderColor:
                                selectedBrandId === brand.id
                                  ? "rgba(255,255,255,0.3)"
                                  : colors.border,
                            },
                          ]}
                        />
                      ) : (
                        <View
                          style={[
                            styles.brandChipPlaceholder,
                            { backgroundColor: colors.border },
                          ]}
                        >
                          <Ionicons
                            name="pricetag"
                            size={14}
                            color={colors.textSecondary}
                          />
                        </View>
                      )}
                      {selectedBrandId === brand.id && (
                        <Ionicons
                          name="checkmark-circle"
                          size={14}
                          color="#FFF"
                          style={{ marginLeft: 4 }}
                        />
                      )}
                      <Text
                        style={{
                          color:
                            selectedBrandId === brand.id ? "#FFF" : colors.text,
                          fontSize: 12,
                          fontWeight: "500",
                        }}
                      >
                        {language === "ar" ? brand.name_ar : brand.name}
                      </Text>
                    </TouchableOpacity>
                  ))}
              </ScrollView>
            </View>

            {/* Category Selection */}
            <View style={styles.formGroup}>
              <View style={styles.labelWithSearch}>
                <Text style={[styles.label, { color: colors.text }]}>
                  {language === "ar" ? "الفئة *" : "Category *"}
                </Text>
                <View
                  style={[
                    styles.miniSearchContainer,
                    {
                      backgroundColor: colors.surface,
                      borderColor: colors.border,
                    },
                  ]}
                >
                  <Ionicons
                    name="search"
                    size={14}
                    color={colors.textSecondary}
                  />
                  <TextInput
                    style={[styles.miniSearchInput, { color: colors.text }]}
                    value={categorySearchQuery}
                    onChangeText={setCategorySearchQuery}
                    placeholder={language === "ar" ? "بحث..." : "Search..."}
                    placeholderTextColor={colors.textSecondary}
                  />
                  {categorySearchQuery.length > 0 && (
                    <TouchableOpacity
                      onPress={() => setCategorySearchQuery("")}
                    >
                      <Ionicons
                        name="close-circle"
                        size={14}
                        color={colors.textSecondary}
                      />
                    </TouchableOpacity>
                  )}
                </View>
              </View>
              <Text style={[styles.fieldHint, { color: colors.textSecondary }]}>
                {language === "ar"
                  ? "اختر فئة المنتج"
                  : "Select product category"}
              </Text>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                style={styles.chipsContainer}
              >
                {categories
                  .filter((cat) => {
                    if (!categorySearchQuery.trim()) return true;
                    const query = categorySearchQuery.toLowerCase();
                    return (
                      (cat.name || "").toLowerCase().includes(query) ||
                      (cat.name_ar || "").toLowerCase().includes(query)
                    );
                  })
                  .map((cat) => (
                    <TouchableOpacity
                      key={cat.id}
                      style={[
                        styles.categoryChip,
                        {
                          backgroundColor:
                            selectedCategoryId === cat.id
                              ? colors.primary
                              : colors.surface,
                          borderColor:
                            selectedCategoryId === cat.id
                              ? colors.primary
                              : colors.border,
                        },
                      ]}
                      onPress={() => setSelectedCategoryId(cat.id)}
                    >
                      {cat.image_data || cat.icon ? (
                        <Image
                          source={{ uri: cat.image_data || cat.icon }}
                          style={[
                            styles.categoryChipImage,
                            {
                              borderColor:
                                selectedCategoryId === cat.id
                                  ? "rgba(255,255,255,0.3)"
                                  : colors.border,
                            },
                          ]}
                        />
                      ) : (
                        <View
                          style={[
                            styles.categoryChipPlaceholder,
                            { backgroundColor: colors.border },
                          ]}
                        >
                          <Ionicons
                            name="grid"
                            size={14}
                            color={colors.textSecondary}
                          />
                        </View>
                      )}
                      {selectedCategoryId === cat.id && (
                        <Ionicons
                          name="checkmark"
                          size={14}
                          color="#FFF"
                          style={{ marginLeft: 2 }}
                        />
                      )}
                      <Text
                        style={{
                          color:
                            selectedCategoryId === cat.id
                              ? "#FFF"
                              : colors.text,
                          fontSize: 13,
                          fontWeight: "500",
                        }}
                      >
                        {language === "ar" ? cat.name_ar : cat.name}
                      </Text>
                    </TouchableOpacity>
                  ))}
              </ScrollView>
            </View>

            {/* Meal Types Selection */}
            <View style={styles.formGroup}>
              <View style={styles.labelWithSearch}>
                <Text style={[styles.label, { color: colors.text }]}>
                  {language === "ar"
                    ? "المطاعم المرتبطة"
                    : "Linked Restaurants"}
                </Text>
                <View
                  style={[
                    styles.miniSearchContainer,
                    {
                      backgroundColor: colors.surface,
                      borderColor: colors.border,
                    },
                  ]}
                >
                  <Ionicons
                    name="search"
                    size={14}
                    color={colors.textSecondary}
                  />
                  <TextInput
                    style={[styles.miniSearchInput, { color: colors.text }]}
                    value={carModelSearchQuery}
                    onChangeText={setCarModelSearchQuery}
                    placeholder={language === "ar" ? "بحث..." : "Search..."}
                    placeholderTextColor={colors.textSecondary}
                  />
                  {carModelSearchQuery.length > 0 && (
                    <TouchableOpacity
                      onPress={() => setCarModelSearchQuery("")}
                    >
                      <Ionicons
                        name="close-circle"
                        size={14}
                        color={colors.textSecondary}
                      />
                    </TouchableOpacity>
                  )}
                </View>
              </View>
              <Text style={[styles.fieldHint, { color: colors.textSecondary }]}>
                {language === "ar"
                  ? "اختر أنواع الوجبات المتوافقة"
                  : "Select compatible meal types"}
              </Text>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                style={styles.chipsContainer}
              >
                {carModels
                  .filter((model) => {
                    if (!carModelSearchQuery.trim()) return true;
                    const query = carModelSearchQuery.toLowerCase();
                    return (
                      (model.name || "").toLowerCase().includes(query) ||
                      (model.name_ar || "").toLowerCase().includes(query)
                    );
                  })
                  .map((model) => {
                    const isSelected = selectedCarModelIds.includes(model.id);
                    const yearRange =
                      model.year_start && model.year_end
                        ? `${model.year_start} - ${model.year_end}`
                        : model.year_start
                          ? `${model.year_start}+`
                          : null;

                    return (
                      <TouchableOpacity
                        key={model.id}
                        style={[
                          styles.carModelChip,
                          {
                            backgroundColor: isSelected
                              ? "#10b981"
                              : colors.surface,
                            borderColor: isSelected ? "#10b981" : colors.border,
                          },
                        ]}
                        onPress={() => toggleCarModel(model.id)}
                      >
                        {model.image_url ? (
                          <Image
                            source={{ uri: model.image_url }}
                            style={[
                              styles.carModelChipImage,
                              {
                                borderColor: isSelected
                                  ? "rgba(255,255,255,0.3)"
                                  : colors.border,
                              },
                            ]}
                          />
                        ) : (
                          <View
                            style={[
                              styles.carModelChipPlaceholder,
                              { backgroundColor: colors.border },
                            ]}
                          >
                            <Ionicons
                              name="restaurant-outline"
                              size={16}
                              color={colors.textSecondary}
                            />
                          </View>
                        )}
                        <View style={styles.carModelChipTextContainer}>
                          <View style={styles.carModelNameRow}>
                            {isSelected && (
                              <Ionicons
                                name="checkmark"
                                size={14}
                                color="#FFF"
                                style={{ marginRight: 4 }}
                              />
                            )}
                            <Text
                              style={{
                                color: isSelected ? "#FFF" : colors.text,
                                fontSize: 13,
                                fontWeight: "500",
                              }}
                              numberOfLines={1}
                            >
                              {language === "ar" ? model.name_ar : model.name}
                            </Text>
                          </View>
                          {yearRange && (
                            <Text
                              style={[
                                styles.carModelYearText,
                                {
                                  color: isSelected
                                    ? "rgba(255,255,255,0.75)"
                                    : colors.textSecondary,
                                },
                              ]}
                            >
                              {yearRange}
                            </Text>
                          )}
                        </View>
                      </TouchableOpacity>
                    );
                  })}
              </ScrollView>
              {selectedCarModelIds.length > 0 && (
                <Text style={[styles.selectedCount, { color: colors.primary }]}>
                  {language === "ar"
                    ? `تم اختيار ${selectedCarModelIds.length} موديل`
                    : `${selectedCarModelIds.length} models selected`}
                </Text>
              )}
            </View>
          </View>

          {/* Section 3: Product Images */}
          <View
            style={[styles.formSectionInner, { borderColor: colors.border }]}
          >
            <Text style={[styles.sectionLabel, { color: colors.primary }]}>
              <Ionicons name="images" size={14} />{" "}
              {language === "ar" ? "صور المنتج" : "Product Images"}
            </Text>

            <ImageUploader
              mode="multiple"
              value={images}
              onChange={(newImages) => setImages(newImages as string[])}
              maxImages={15}
              size="medium"
              label={language === "ar" ? "صور المنتج" : "Product Images"}
              hint={
                language === "ar"
                  ? "يمكنك إضافة حتى 15 صورة"
                  : "You can add up to 15 images"
              }
            />
          </View>

          {/* Section 4: Stock History — edit mode only */}
          {isEditMode && editingProduct?.id && (
            <ProductStockHistorySection
              productId={String(editingProduct.id)}
              colors={colors}
              language={language}
            />
          )}

          {error ? <Text style={styles.errorText}>{error}</Text> : null}

          <TouchableOpacity
            style={[
              styles.saveButton,
              { backgroundColor: showSuccess ? "#10b981" : colors.primary },
            ]}
            onPress={handleSave}
            disabled={saving}
          >
            {saving ? (
              <ActivityIndicator color="#FFF" />
            ) : showSuccess ? (
              <>
                <Ionicons name="checkmark-circle" size={20} color="#FFF" />
                <Text style={styles.saveButtonText}>
                  {language === "ar" ? "تم الحفظ بنجاح" : "Saved Successfully"}
                </Text>
              </>
            ) : (
              <>
                <Ionicons
                  name={isEditMode ? "create" : "save"}
                  size={20}
                  color="#FFF"
                />
                <Text style={styles.saveButtonText}>
                  {isEditMode
                    ? language === "ar"
                      ? "تحديث المنتج"
                      : "Update Product"
                    : language === "ar"
                      ? "حفظ المنتج"
                      : "Save Product"}
                </Text>
              </>
            )}
          </TouchableOpacity>
        </View>

        {/* Existing Products List Header */}
        <View
          style={[
            styles.listCard,
            { backgroundColor: colors.card, borderColor: colors.border },
          ]}
        >
          <Text style={[styles.listTitle, { color: colors.text }]}>
            {language === "ar" ? "المنتجات الحالية" : "Existing Products"} (
            {productsCount})
          </Text>

          {/* Search Bar */}
          <View
            style={[
              styles.searchContainer,
              { backgroundColor: colors.surface, borderColor: colors.border },
            ]}
          >
            <Ionicons name="search" size={20} color={colors.textSecondary} />
            <TextInput
              style={[styles.searchInput, { color: colors.text }]}
              value={searchQuery}
              onChangeText={setSearchQuery}
              placeholder={
                language === "ar"
                  ? "ابحث بالاسم أو رمز SKU..."
                  : "Search by name or SKU..."
              }
              placeholderTextColor={colors.textSecondary}
            />
            {searchQuery.length > 0 && (
              <TouchableOpacity onPress={() => setSearchQuery("")}>
                <Ionicons
                  name="close-circle"
                  size={20}
                  color={colors.textSecondary}
                />
              </TouchableOpacity>
            )}
          </View>
        </View>
      </View>
    );
  },
);

ProductFormHeader.displayName = "ProductFormHeader";

// ============================================================================
// ProductGroupCard — one polished card per SKU
// ----------------------------------------------------------------------------
// All sibling fitment variants of the same SKU live inside ONE card. The card
// shows the data for the currently *selected* variant (defaults to STD).
// When the SKU has 2+ variants we render an interactive chip row so the
// owner/admin can switch the active variant in-place; the price, stock and
// quantity input all swap to the picked variant. When the SKU only has the
// default STD row (no real variants) the chip row is suppressed entirely
// (per the global hide-STD-only rule).
// ============================================================================
interface ProductGroupCardProps {
  siblings: any[]; // every product row that shares the same SKU
  defaultProduct: any; // STD (or first sibling) — used as the initial selection
  colors: any;
  language: string;
  isRTL: boolean;
  brandName: string;
  categoryName: string;
  carModelNames: string;
  quantityInputs: Record<string, string>;
  updatingQuantityId: string | null;
  onQuantityChange: (productId: string, value: string) => void;
  onUpdateQuantity: (productId: string) => void;
  onEdit: (product: any) => void;
  onDelete: (product: any) => void;
  onOpenVariants: (product: any) => void;
  isHighlighted?: boolean;
}

const ProductGroupCard = memo(
  ({
    siblings,
    defaultProduct,
    colors,
    language,
    isRTL,
    brandName,
    categoryName,
    carModelNames,
    quantityInputs,
    updatingQuantityId,
    onQuantityChange,
    onUpdateQuantity,
    onEdit,
    onDelete,
    onOpenVariants,
    isHighlighted,
  }: ProductGroupCardProps) => {
    const highlightAnim = useRef(new Animated.Value(0)).current;

    useEffect(() => {
      if (isHighlighted) {
        highlightAnim.setValue(1);
        Animated.timing(highlightAnim, {
          toValue: 0,
          duration: 1800,
          useNativeDriver: false,
        }).start();
      }
    }, [isHighlighted, highlightAnim]);

    // Build the list of selectable indicators from the siblings array.
    const variantOptions = useMemo(
      () =>
        siblings.map((s: any) => ({
          indicator: String(s.fitment_indicator || ''),
          price: parseFloat(String(s.price ?? 0)) || 0,
          stock: Number(s.stock_quantity ?? s.stock ?? 0),
          id: s.id,
        })),
      [siblings],
    );

    const [selectedIndicator, setSelectedIndicator] = useState<string>(
      String(defaultProduct.fitment_indicator || ''),
    );

    // Keep the selected indicator valid if the underlying siblings change
    // (e.g. the owner just deleted the active variant from the modal).
    useEffect(() => {
      const exists = variantOptions.some(
        (v) => v.indicator === selectedIndicator,
      );
      if (!exists) {
        setSelectedIndicator(
          variantOptions[0]?.indicator || '',
        );
      }
    }, [variantOptions, selectedIndicator]);

    const activeProduct = useMemo(() => {
      const target = variantOptions.find(
        (v) => v.indicator === selectedIndicator,
      );
      return (
        siblings.find((s: any) => s.id === target?.id) || defaultProduct
      );
    }, [siblings, variantOptions, selectedIndicator, defaultProduct]);

    const activeStock = Number(
      activeProduct.stock_quantity ?? activeProduct.stock ?? 0,
    );
    const activeQtyInput =
      quantityInputs[activeProduct.id] || String(activeStock || 0);
    const isUpdatingActive = updatingQuantityId === activeProduct.id;

    // Show the variant chip strip only when there is something to choose
    // between (2+ siblings). A single sibling — STD or otherwise — has no
    // fitment to switch to, so the strip would just be visual noise.
    const showVariantChips = variantOptions.length >= 2;

    const productType =
      activeProduct.product_type ||
      (activeProduct.is_tire ? 'tire' : null);
    const productTypeLabels: Record<string, { en: string; ar: string }> = {
      tire: { en: 'TIRE', ar: 'إطار' },
      accessory: { en: 'ACCESSORY', ar: 'إكسسوار' },
      exterior: { en: 'EXTERIOR', ar: 'هيكل خارجي' },
    };
    const ptLabel = productType ? productTypeLabels[productType] : null;

    // Stock badge color: green > yellow (low) > red (out)
    const stockColor =
      activeStock <= 0
        ? '#ef4444'
        : activeStock <= 5
          ? '#f59e0b'
          : '#10b981';

    const highlightBorderColor = highlightAnim.interpolate({
      inputRange: [0, 1],
      outputRange: [colors.border, '#f59e0b'],
    });
    const highlightBgColor = highlightAnim.interpolate({
      inputRange: [0, 1],
      outputRange: [colors.card, '#fffbeb'],
    });

    return (
      <Animated.View
        style={[
          styles.productCard,
          {
            backgroundColor: highlightBgColor,
            borderColor: highlightBorderColor,
          },
        ]}
      >
        {/* ── HEADER ───────────────────────────────────────────────────── */}
        <View
          style={[
            styles.productHeader,
            isRTL && { flexDirection: 'row-reverse' },
          ]}
        >
          {activeProduct.image_url ||
          (activeProduct.images && activeProduct.images.length > 0) ||
          (defaultProduct.images && defaultProduct.images.length > 0) ||
          defaultProduct.image_url ? (
            <Image
              source={{
                uri:
                  activeProduct.images?.[0] ||
                  activeProduct.image_url ||
                  defaultProduct.images?.[0] ||
                  defaultProduct.image_url,
              }}
              style={styles.productImage}
            />
          ) : (
            <View
              style={[
                styles.productImagePlaceholder,
                { backgroundColor: colors.surface },
              ]}
            >
              <Ionicons name="cube" size={24} color={colors.textSecondary} />
            </View>
          )}
          <View
            style={[
              styles.productMainInfo,
              isRTL && { marginLeft: 0, marginRight: 12 },
            ]}
          >
            <Text
              style={[styles.productName, { color: colors.text }]}
              numberOfLines={1}
            >
              {language === 'ar' ? activeProduct.name_ar : activeProduct.name}
            </Text>
            <View
              style={{
                flexDirection: isRTL ? 'row-reverse' : 'row',
                alignItems: 'center',
                gap: 6,
                marginTop: 4,
                flexWrap: 'wrap',
              }}
            >
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  paddingHorizontal: 6,
                  paddingVertical: 2,
                  borderRadius: 6,
                  backgroundColor: colors.surface,
                  gap: 4,
                }}
              >
                <Ionicons
                  name="barcode-outline"
                  size={11}
                  color={colors.textSecondary}
                />
                <Text
                  style={{
                    fontSize: 11,
                    fontWeight: '700',
                    color: colors.textSecondary,
                  }}
                >
                  {activeProduct.sku}
                </Text>
              </View>
              {ptLabel && (
                <View
                  style={{
                    paddingHorizontal: 6,
                    paddingVertical: 2,
                    borderRadius: 4,
                    backgroundColor: colors.primary + '22',
                    borderWidth: 1,
                    borderColor: colors.primary,
                  }}
                >
                  <Text
                    style={{
                      fontSize: 10,
                      fontWeight: '700',
                      color: colors.primary,
                    }}
                  >
                    {language === 'ar' ? ptLabel.ar : ptLabel.en}
                  </Text>
                </View>
              )}
            </View>
            <Text
              style={[
                styles.productPrice,
                { color: colors.primary, marginTop: 6 },
              ]}
            >
              {parseFloat(String(activeProduct.price || 0)).toFixed(2)} ج.م
            </Text>
          </View>

          <View style={styles.actionButtonsContainer}>
            <TouchableOpacity
              style={[
                styles.actionButton,
                { backgroundColor: colors.error + '20' },
              ]}
              onPress={() => onDelete(activeProduct)}
            >
              <Ionicons name="trash" size={18} color={colors.error} />
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                styles.actionButton,
                { backgroundColor: colors.primary + '20' },
              ]}
              onPress={() => onEdit(activeProduct)}
            >
              <Ionicons name="create" size={18} color={colors.primary} />
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                styles.actionButton,
                { backgroundColor: '#8b5cf6' + '20' },
              ]}
              onPress={() => onOpenVariants(defaultProduct)}
            >
              <Ionicons name="layers" size={18} color="#8b5cf6" />
              {variantOptions.length > 1 ? (
                <View style={styles.variantBadge}>
                  <Text style={styles.variantBadgeText}>
                    {variantOptions.length}
                  </Text>
                </View>
              ) : null}
            </TouchableOpacity>
          </View>
        </View>

        {/* ── VARIANT CHIP STRIP (only when 2+ variants exist) ─────────── */}
        {showVariantChips && (
          <View
            style={{
              marginTop: 12,
              paddingTop: 10,
              borderTopWidth: StyleSheet.hairlineWidth,
              borderTopColor: colors.border,
            }}
          >
            <Text
              style={{
                fontSize: 11,
                fontWeight: '700',
                color: colors.textSecondary,
                marginBottom: 6,
                letterSpacing: 0.5,
                textAlign: isRTL ? 'right' : 'left',
              }}
            >
              {language === 'ar' ? 'مؤشرات التوافق' : 'FITMENT VARIANTS'}
            </Text>
            <FitmentStrip
              mode="interactive"
              variants={variantOptions}
              selected={selectedIndicator}
              onChange={(ind) => setSelectedIndicator(ind)}
              size="md"
              hideOutOfStock={false}
              containerStyle={{ justifyContent: 'flex-start' }}
            />
          </View>
        )}

        {/* ── META BOX ─────────────────────────────────────────────────── */}
        <View style={[styles.productMeta, { backgroundColor: colors.surface }]}>
          <View style={styles.metaRow}>
            <Ionicons name="pricetag" size={12} color={colors.textSecondary} />
            <Text style={[styles.metaLabel, { color: colors.textSecondary }]}>
              {language === 'ar' ? 'الماركة:' : 'Brand:'}
            </Text>
            <Text style={[styles.metaValue, { color: colors.text }]}>
              {brandName || '-'}
            </Text>
          </View>
          <View style={styles.metaRow}>
            <Ionicons name="grid" size={12} color={colors.textSecondary} />
            <Text style={[styles.metaLabel, { color: colors.textSecondary }]}>
              {language === 'ar' ? 'الفئة:' : 'Category:'}
            </Text>
            <Text style={[styles.metaValue, { color: colors.text }]}>
              {categoryName || '-'}
            </Text>
          </View>
          {activeProduct.car_model_ids?.length > 0 && (
            <View style={styles.metaRow}>
              <Ionicons name="restaurant-outline" size={12} color={colors.textSecondary} />
              <Text style={[styles.metaLabel, { color: colors.textSecondary }]}>
                {language === 'ar' ? 'المطاعم:' : 'Restaurants:'}
              </Text>
              <Text
                style={[styles.metaValue, { color: colors.text }]}
                numberOfLines={1}
              >
                {carModelNames}
              </Text>
            </View>
          )}
        </View>

        {/* ── QUANTITY CONTROLS (always per active variant) ────────────── */}
        <View style={styles.quantitySection}>
          <View
            style={[styles.currentQuantity, { backgroundColor: stockColor }]}
          >
            <Ionicons name="cube" size={14} color="#FFF" />
            <Text style={styles.currentQuantityText}>{activeStock}</Text>
          </View>
          <TextInput
            style={[
              styles.quantityInput,
              {
                backgroundColor: colors.surface,
                borderColor: colors.border,
                color: colors.text,
              },
            ]}
            value={activeQtyInput}
            onChangeText={(value) =>
              onQuantityChange(activeProduct.id, value)
            }
            keyboardType="number-pad"
            placeholder="0"
            placeholderTextColor={colors.textSecondary}
          />
          <TouchableOpacity
            style={[styles.updateQuantityBtn, { backgroundColor: '#f59e0b' }]}
            onPress={() => onUpdateQuantity(activeProduct.id)}
            disabled={isUpdatingActive}
          >
            {isUpdatingActive ? (
              <ActivityIndicator size="small" color="#FFF" />
            ) : (
              <Ionicons name="checkmark" size={16} color="#FFF" />
            )}
          </TouchableOpacity>
        </View>
      </Animated.View>
    );
  },
);

ProductGroupCard.displayName = 'ProductGroupCard';

// ============================================================================
// Variant Matrix Modal - manage all size variants for a SKU at once
// ============================================================================
const FITMENT_INDICATORS = ["صغير", "وسط", "كبير", "كومبو", "عائلي"] as const;
type FitmentIndicator = (typeof FITMENT_INDICATORS)[number];

interface VariantMatrixModalProps {
  visible: boolean;
  onClose: () => void;
  sku: string;
  siblings: any[];
  colors: any;
  language: string;
  onSaveVariant: (productId: string, price: number, stock: number) => Promise<boolean>;
  onBulkSaveVariants: (
    updates: Array<{ id: string; price: number; stock_quantity: number }>,
  ) => Promise<{
    success: boolean;
    results: Array<{ id: string; success: boolean; error?: string }>;
    error?: string;
  }>;
  onCloneFromStd: (indicator: FitmentIndicator) => Promise<boolean>;
}

const VariantMatrixModal = memo(
  ({
    visible,
    onClose,
    sku,
    siblings,
    colors,
    language,
    onSaveVariant,
    onBulkSaveVariants,
    onCloneFromStd,
  }: VariantMatrixModalProps) => {
    const [rowState, setRowState] = useState<
      Record<
        string,
        {
          price: string;
          stock: string;
          saving: boolean;
          status?: "success" | "error" | null;
          statusMessage?: string;
          initialPrice?: string;
          initialStock?: string;
        }
      >
    >({});
    const [busyAdd, setBusyAdd] = useState<string | null>(null);
    const [localError, setLocalError] = useState<string>("");
    const [bulkSaving, setBulkSaving] = useState(false);

    const byIndicator = useMemo(() => {
      const m: Partial<Record<FitmentIndicator, any>> = {};
      siblings.forEach((p: any) => {
        const ind = (p.fitment_indicator || "") as FitmentIndicator;
        if (ind && FITMENT_INDICATORS.includes(ind)) m[ind] = p;
      });
      return m;
    }, [siblings]);

    // In the dining context any sibling can serve as the clone source.
    const primaryProduct = siblings.length > 0 ? siblings[0] : null;

    useEffect(() => {
      if (!visible) return;
      const next: Record<
        string,
        {
          price: string;
          stock: string;
          saving: boolean;
          status?: "success" | "error" | null;
          statusMessage?: string;
          initialPrice?: string;
          initialStock?: string;
        }
      > = {};
      siblings.forEach((p: any) => {
        const priceStr = String(p.price ?? "");
        const stockStr = String(p.stock_quantity ?? p.stock ?? 0);
        next[p.id] = {
          price: priceStr,
          stock: stockStr,
          saving: false,
          status: null,
          statusMessage: "",
          initialPrice: priceStr,
          initialStock: stockStr,
        };
      });
      setRowState(next);
      setLocalError("");
    }, [visible, siblings]);

    const updateRowField = useCallback(
      (id: string, field: "price" | "stock", value: string) => {
        setRowState((prev) => ({
          ...prev,
          [id]: {
            ...(prev[id] || { price: "", stock: "", saving: false }),
            [field]: value,
            // Editing clears any previous status indicator.
            status: null,
            statusMessage: "",
          },
        }));
      },
      [],
    );

    const dirtyRows = useMemo(() => {
      const out: Array<{ id: string; price: string; stock: string }> = [];
      siblings.forEach((p: any) => {
        const r = rowState[p.id];
        if (!r) return;
        if (
          r.price !== (r.initialPrice ?? "") ||
          r.stock !== (r.initialStock ?? "")
        ) {
          out.push({ id: p.id, price: r.price, stock: r.stock });
        }
      });
      return out;
    }, [rowState, siblings]);

    const handleSaveAll = useCallback(async () => {
      if (dirtyRows.length === 0 || bulkSaving) return;

      // Validate every dirty row up front; abort batch if any input is invalid
      // and surface a row-level error message for the offending rows.
      const validated: Array<{ id: string; price: number; stock_quantity: number }> = [];
      const validationErrors: Record<string, string> = {};
      for (const r of dirtyRows) {
        const priceNum = parseFloat(r.price);
        const stockNum = parseInt(r.stock || "0", 10);
        if (Number.isNaN(priceNum) || priceNum < 0) {
          validationErrors[r.id] = language === "ar" ? "السعر غير صالح" : "Invalid price";
          continue;
        }
        if (Number.isNaN(stockNum) || stockNum < 0) {
          validationErrors[r.id] = language === "ar" ? "الكمية غير صالحة" : "Invalid stock";
          continue;
        }
        validated.push({ id: r.id, price: priceNum, stock_quantity: stockNum });
      }

      if (Object.keys(validationErrors).length > 0) {
        setRowState((prev) => {
          const next = { ...prev };
          Object.entries(validationErrors).forEach(([id, msg]) => {
            if (next[id]) next[id] = { ...next[id], status: "error", statusMessage: msg };
          });
          return next;
        });
        setLocalError(
          language === "ar"
            ? "بعض الصفوف تحتوي على قيم غير صالحة"
            : "Some rows have invalid values",
        );
        if (validated.length === 0) return;
      } else {
        setLocalError("");
      }

      // Mark validated rows as saving and clear stale statuses.
      setBulkSaving(true);
      setRowState((prev) => {
        const next = { ...prev };
        validated.forEach((u) => {
          if (next[u.id]) next[u.id] = { ...next[u.id], saving: true, status: null, statusMessage: "" };
        });
        return next;
      });

      try {
        const resp = await onBulkSaveVariants(validated);
        setRowState((prev) => {
          const next = { ...prev };
          if (resp.error && (!resp.results || resp.results.length === 0)) {
            // Whole-batch failure: mark every validated row as errored.
            validated.forEach((u) => {
              if (next[u.id]) {
                next[u.id] = {
                  ...next[u.id],
                  saving: false,
                  status: "error",
                  statusMessage: resp.error,
                };
              }
            });
            return next;
          }
          const resultsById = new Map((resp.results || []).map((r) => [r.id, r]));
          (resp.results || []).forEach((r) => {
            const row = next[r.id];
            if (!row) return;
            if (r.success) {
              const submitted = validated.find((v) => v.id === r.id);
              next[r.id] = {
                ...row,
                saving: false,
                status: "success",
                statusMessage: language === "ar" ? "تم الحفظ" : "Saved",
                initialPrice: submitted ? String(submitted.price) : row.price,
                initialStock: submitted ? String(submitted.stock_quantity) : row.stock,
              };
            } else {
              next[r.id] = {
                ...row,
                saving: false,
                status: "error",
                statusMessage: r.error || (language === "ar" ? "فشل الحفظ" : "Save failed"),
              };
            }
          });
          // Any validated row that wasn't returned in results should be marked
          // as an explicit error rather than silently leaving it pending.
          validated.forEach((u) => {
            if (next[u.id] && !resultsById.has(u.id)) {
              next[u.id] = {
                ...next[u.id],
                saving: false,
                status: "error",
                statusMessage:
                  language === "ar" ? "لا توجد نتيجة من الخادم" : "No server result",
              };
            } else if (next[u.id] && next[u.id].saving) {
              next[u.id] = { ...next[u.id], saving: false };
            }
          });
          return next;
        });
      } finally {
        setBulkSaving(false);
      }
    }, [dirtyRows, bulkSaving, onBulkSaveVariants, language]);

    const handleSaveRow = useCallback(
      async (product: any) => {
        const row = rowState[product.id];
        if (!row) return;
        const priceNum = parseFloat(row.price);
        const stockNum = parseInt(row.stock || "0");
        if (Number.isNaN(priceNum) || priceNum < 0) {
          setLocalError(language === "ar" ? "السعر غير صالح" : "Invalid price");
          return;
        }
        if (Number.isNaN(stockNum) || stockNum < 0) {
          setLocalError(language === "ar" ? "الكمية غير صالحة" : "Invalid stock");
          return;
        }
        setLocalError("");
        setRowState((prev) => ({
          ...prev,
          [product.id]: { ...prev[product.id], saving: true, status: null, statusMessage: "" },
        }));
        let ok = false;
        try {
          ok = await onSaveVariant(product.id, priceNum, stockNum);
        } finally {
          setRowState((prev) => {
            if (!prev[product.id]) return prev;
            return {
              ...prev,
              [product.id]: {
                ...prev[product.id],
                saving: false,
                status: ok ? "success" : "error",
                statusMessage: ok
                  ? language === "ar"
                    ? "تم الحفظ"
                    : "Saved"
                  : language === "ar"
                    ? "فشل الحفظ"
                    : "Save failed",
                initialPrice: ok ? String(priceNum) : prev[product.id].initialPrice,
                initialStock: ok ? String(stockNum) : prev[product.id].initialStock,
              },
            };
          });
        }
      },
      [rowState, onSaveVariant, language],
    );

    const handleAddVariant = useCallback(
      async (indicator: FitmentIndicator) => {
        setLocalError("");
        setBusyAdd(indicator);
        try {
          await onCloneFromStd(indicator);
        } finally {
          setBusyAdd(null);
        }
      },
      [onCloneFromStd, language],
    );

    return (
      <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
        <View style={styles.modalOverlay}>
          <View
            style={[
              styles.variantModal,
              { backgroundColor: colors.card, borderColor: colors.border },
            ]}
          >
            <View style={styles.variantModalHeader}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.variantModalTitle, { color: colors.text }]}>
                  {language === "ar" ? "متغيرات المنتج" : "Variant Matrix"}
                </Text>
                <Text style={[styles.variantModalSubtitle, { color: colors.textSecondary }]}>
                  SKU: {sku}
                </Text>
              </View>
              <TouchableOpacity onPress={onClose} style={styles.modalCloseBtn}>
                <Ionicons name="close" size={22} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>

            {!primaryProduct ? (
              <View
                style={[
                  styles.variantWarning,
                  { backgroundColor: "#f59e0b" + "20", borderColor: "#f59e0b" },
                ]}
              >
                <Ionicons name="warning" size={16} color="#f59e0b" />
                <Text style={[styles.variantWarningText, { color: "#92400e" }]}>
                  {language === "ar"
                    ? "لا توجد منتجات لهذا الـ SKU بعد."
                    : "No products found for this SKU yet."}
                </Text>
              </View>
            ) : null}

            {localError ? (
              <Text style={[styles.errorText, { marginTop: 8 }]}>{localError}</Text>
            ) : null}

            <ScrollView style={{ maxHeight: 420 }}>
              <View style={[styles.variantRowHead, { borderColor: colors.border }]}>
                <Text style={[styles.variantHeadCell, { color: colors.textSecondary, flex: 0.8 }]}>
                  {language === "ar" ? "المؤشر" : "Indicator"}
                </Text>
                <Text style={[styles.variantHeadCell, { color: colors.textSecondary, flex: 1.2 }]}>
                  {language === "ar" ? "السعر" : "Price"}
                </Text>
                <Text style={[styles.variantHeadCell, { color: colors.textSecondary, flex: 1 }]}>
                  {language === "ar" ? "الكمية" : "Stock"}
                </Text>
                <Text
                  style={[
                    styles.variantHeadCell,
                    { color: colors.textSecondary, flex: 0.8, textAlign: "center" },
                  ]}
                >
                  {language === "ar" ? "إجراء" : "Action"}
                </Text>
              </View>

              {FITMENT_INDICATORS.map((indicator) => {
                const product = byIndicator[indicator];
                const row = product ? rowState[product.id] : null;
                const canAdd = true;
                return (
                  <View key={indicator}>
                  <View
                    style={[styles.variantRow, { borderColor: colors.border }]}
                  >
                    <View style={{ flex: 0.8 }}>
                      <FitmentBadges fitmentIndicator={indicator} size="sm" />
                    </View>

                    {product && row ? (
                      <>
                        <View style={{ flex: 1.2, paddingRight: 6 }}>
                          <TextInput
                            style={[
                              styles.variantInput,
                              {
                                backgroundColor: colors.surface,
                                borderColor:
                                  row.status === "error"
                                    ? "#ef4444"
                                    : row.status === "success"
                                      ? "#10b981"
                                      : colors.border,
                                color: colors.text,
                              },
                            ]}
                            value={row.price}
                            onChangeText={(v) => updateRowField(product.id, "price", v)}
                            keyboardType="decimal-pad"
                            placeholder="0.00"
                            placeholderTextColor={colors.textSecondary}
                          />
                        </View>
                        <View style={{ flex: 1, paddingRight: 6 }}>
                          <TextInput
                            style={[
                              styles.variantInput,
                              {
                                backgroundColor: colors.surface,
                                borderColor:
                                  row.status === "error"
                                    ? "#ef4444"
                                    : row.status === "success"
                                      ? "#10b981"
                                      : colors.border,
                                color: colors.text,
                              },
                            ]}
                            value={row.stock}
                            onChangeText={(v) => updateRowField(product.id, "stock", v)}
                            keyboardType="number-pad"
                            placeholder="0"
                            placeholderTextColor={colors.textSecondary}
                          />
                        </View>
                        <TouchableOpacity
                          style={[
                            styles.variantActionBtn,
                            { backgroundColor: colors.primary, flex: 0.8 },
                          ]}
                          onPress={() => handleSaveRow(product)}
                          disabled={row.saving || bulkSaving}
                        >
                          {row.saving ? (
                            <ActivityIndicator size="small" color="#FFF" />
                          ) : (
                            <>
                              <Ionicons name="save" size={14} color="#FFF" />
                              <Text style={styles.variantActionText}>
                                {language === "ar" ? "حفظ" : "Save"}
                              </Text>
                            </>
                          )}
                        </TouchableOpacity>
                      </>
                    ) : (
                      <>
                        <Text
                          style={[
                            styles.variantMissing,
                            { color: colors.textSecondary, flex: 2.2 },
                          ]}
                        >
                          {language === "ar" ? "غير موجود" : "Not created"}
                        </Text>
                        <TouchableOpacity
                          style={[
                            styles.variantActionBtn,
                            {
                              backgroundColor: canAdd ? "#10b981" : colors.border,
                              flex: 0.8,
                              opacity: canAdd ? 1 : 0.5,
                            },
                          ]}
                          onPress={() => handleAddVariant(indicator)}
                          disabled={!canAdd || busyAdd === indicator}
                        >
                          {busyAdd === indicator ? (
                            <ActivityIndicator size="small" color="#FFF" />
                          ) : (
                            <>
                              <Ionicons name="add" size={14} color="#FFF" />
                              <Text style={styles.variantActionText}>
                                {language === "ar" ? "إضافة" : "Add"}
                              </Text>
                            </>
                          )}
                        </TouchableOpacity>
                      </>
                    )}
                  </View>
                  {row?.statusMessage ? (
                    <View
                      style={{
                        flexDirection: "row",
                        alignItems: "center",
                        gap: 6,
                        paddingHorizontal: 4,
                        paddingBottom: 8,
                      }}
                    >
                      <Ionicons
                        name={row.status === "success" ? "checkmark-circle" : "alert-circle"}
                        size={14}
                        color={row.status === "success" ? "#10b981" : "#ef4444"}
                      />
                      <Text
                        style={{
                          color: row.status === "success" ? "#10b981" : "#ef4444",
                          fontSize: 12,
                          fontWeight: "600",
                        }}
                      >
                        {row.statusMessage}
                      </Text>
                    </View>
                  ) : null}
                  </View>
                );
              })}
            </ScrollView>

            {(() => {
              const successCount = Object.values(rowState).filter(
                (r) => r.status === "success",
              ).length;
              const errorCount = Object.values(rowState).filter(
                (r) => r.status === "error",
              ).length;
              const dirtyCount = dirtyRows.length;
              const disabled = dirtyCount === 0 || bulkSaving;
              return (
                <View style={{ marginTop: 12 }}>
                  {successCount + errorCount > 0 ? (
                    <Text
                      style={{
                        color: colors.textSecondary,
                        fontSize: 12,
                        marginBottom: 8,
                      }}
                    >
                      {language === "ar"
                        ? `${successCount} نجاح • ${errorCount} فشل`
                        : `${successCount} succeeded • ${errorCount} failed`}
                    </Text>
                  ) : null}
                  <TouchableOpacity
                    onPress={handleSaveAll}
                    disabled={disabled}
                    style={{
                      backgroundColor: disabled ? colors.border : colors.primary,
                      opacity: disabled ? 0.6 : 1,
                      paddingVertical: 12,
                      borderRadius: 8,
                      flexDirection: "row",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: 8,
                    }}
                  >
                    {bulkSaving ? (
                      <ActivityIndicator size="small" color="#FFF" />
                    ) : (
                      <Ionicons name="save" size={16} color="#FFF" />
                    )}
                    <Text style={{ color: "#FFF", fontWeight: "700", fontSize: 14 }}>
                      {language === "ar"
                        ? dirtyCount > 0
                          ? `حفظ كل التغييرات (${dirtyCount})`
                          : "حفظ كل التغييرات"
                        : dirtyCount > 0
                          ? `Save all changes (${dirtyCount})`
                          : "Save all changes"}
                    </Text>
                  </TouchableOpacity>
                </View>
              );
            })()}

            <Text style={[styles.fieldHint, { color: colors.textSecondary, marginTop: 12 }]}>
              {language === "ar"
                ? "إضافة حجم جديد ينسخ الاسم والماركة والفئة من المنتج الأساسي."
                : "Adding a size variant clones the name, brand, and category from the primary product."}
            </Text>
          </View>
        </View>
      </Modal>
    );
  },
);

VariantMatrixModal.displayName = "VariantMatrixModal";

// ============================================================================
// Main Component
// ============================================================================
function ProductsAdmin() {
  const { colors } = useTheme();
  const { language, isRTL } = useTranslation();
  const router = useRouter();
  const params = useLocalSearchParams<{ editProductId?: string }>();
  const insets = useSafeAreaInsets();
  const scrollViewRef = useRef<ScrollView>(null);
  const [highlightedProductId, setHighlightedProductId] = useState<string | null>(null);
  const cardYOffsetsRef = useRef<Map<string, number>>(new Map());
  const listContainerYRef = useRef(0);
  const adminSync = useAdminSync();

  // React Query hooks
  const {
    data: products = [],
    isLoading: loading,
    isRefetching: refreshing,
    refetch,
  } = useAdminProductsListQuery();
  const { data: metadata, isLoading: metadataLoading } =
    useProductMetadataQuery();
  const {
    updateQuantity: updateQuantityMutation,
    deleteProduct: deleteProductMutation,
  } = useAdminProductMutations();

  useWebSocketEvent(
    ['product_created', 'product_updated', 'product_deleted', 'product_stock_updated', 'out_of_stock'],
    () => { refetch(); },
  );

  // Metadata
  const productBrands = useMemo(
    () => metadata?.productBrands || [],
    [metadata],
  );
  const categories = useMemo(() => metadata?.categories || [], [metadata]);
  const carModels = useMemo(() => metadata?.carModels || [], [metadata]);

  // Form state
  const [name, setName] = useState("");
  const [nameAr, setNameAr] = useState("");
  const [description, setDescription] = useState("");
  const [descriptionAr, setDescriptionAr] = useState("");
  const [ingredientRows, setIngredientRows] = useState<IngredientRow[]>([]);
  const [pairingNotes, setPairingNotes] = useState("");
  const [pairingNotesAr, setPairingNotesAr] = useState("");
  const [nutritionCalories, setNutritionCalories] = useState("");
  const [nutritionProtein, setNutritionProtein] = useState("");
  const [nutritionCarbs, setNutritionCarbs] = useState("");
  const [nutritionFat, setNutritionFat] = useState("");
  const [price, setPrice] = useState("");
  const [sku, setSku] = useState("");
  const [stockQuantity, setStockQuantity] = useState("0");
  const [fitmentIndicator, setFitmentIndicator] = useState<string>("صغير");
  const [productType, setProductType] = useState<ProductType | null>(null);
  const [selectedBrandId, setSelectedBrandId] = useState("");
  const [selectedCategoryId, setSelectedCategoryId] = useState("");
  const [selectedCarModelIds, setSelectedCarModelIds] = useState<string[]>([]);
  const [images, setImages] = useState<string[]>([]);
  const [brandSearchQuery, setBrandSearchQuery] = useState("");
  const [categorySearchQuery, setCategorySearchQuery] = useState("");
  const [carModelSearchQuery, setCarModelSearchQuery] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [availabilityFilter, setAvailabilityFilter] = useState<'all' | 'available' | 'out_of_stock'>('all');
  const [productSortBy, setProductSortBy] = useState<'default' | 'name_asc' | 'name_desc' | 'price_asc' | 'price_desc'>('default');
  const [isEditMode, setIsEditMode] = useState(false);
  const [editingProduct, setEditingProduct] = useState<any>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);

  // UI state
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [productToDelete, setProductToDelete] = useState<any>(null);
  const [deleting, setDeleting] = useState(false);
  const [quantityInputs, setQuantityInputs] = useState<Record<string, string>>(
    {},
  );
  const [updatingQuantityId, setUpdatingQuantityId] = useState<string | null>(
    null,
  );
  const [variantsModalSku, setVariantsModalSku] = useState<string | null>(null);
  const [toastVisible, setToastVisible] = useState(false);
  const [toastMessage, setToastMessage] = useState("");
  const [toastType, setToastType] = useState<
    "success" | "error" | "warning" | "info"
  >("success");

  // Lookup maps
  const brandMap = useMemo(() => {
    const map: Record<string, any> = {};
    productBrands.forEach((b: any) => {
      map[b.id] = b;
    });
    return map;
  }, [productBrands]);

  const categoryMap = useMemo(() => {
    const map: Record<string, any> = {};
    categories.forEach((c: any) => {
      map[c.id] = c;
    });
    return map;
  }, [categories]);

  const carModelMap = useMemo(() => {
    const map: Record<string, any> = {};
    carModels.forEach((m: any) => {
      map[m.id] = m;
    });
    return map;
  }, [carModels]);

  // Initialize quantity inputs
  const quantityInputsInitialized = useRef(false);
  useEffect(() => {
    if (products.length > 0 && !quantityInputsInitialized.current) {
      const quantities: Record<string, string> = {};
      products.forEach((p: any) => {
        quantities[p.id] = (p.stock_quantity || p.stock || 0).toString();
      });
      setQuantityInputs(quantities);
      quantityInputsInitialized.current = true;
    }
  }, [products]);

  useEffect(() => {
    if (products.length === 0) quantityInputsInitialized.current = false;
  }, [products.length]);

  // Handlers
  const showToast = useCallback(
    (message: string, type: "success" | "error" | "warning" | "info") => {
      setToastMessage(message);
      setToastType(type);
      setToastVisible(true);
    },
    [],
  );

  const resetForm = useCallback(() => {
    setName("");
    setNameAr("");
    setDescription("");
    setDescriptionAr("");
    setIngredientRows([]);
    setPairingNotes("");
    setPairingNotesAr("");
    setNutritionCalories("");
    setNutritionProtein("");
    setNutritionCarbs("");
    setNutritionFat("");
    setPrice("");
    setSku("");
    setStockQuantity("0");
    setFitmentIndicator("صغير");
    setProductType(null);
    setImages([]);
    setSelectedBrandId("");
    setSelectedCategoryId("");
    setSelectedCarModelIds([]);
    setIsEditMode(false);
    setEditingProduct(null);
    setError("");
  }, []);

  // Ingredient row mutators. Rows are paired EN/AR cells with a stable key,
  // so reordering, removal, and per-cell edits never recreate the inputs and
  // never lose focus or text-selection state.
  const addIngredientRow = useCallback(() => {
    setIngredientRows((prev) => [...prev, createIngredientRow()]);
  }, []);

  const removeIngredientRow = useCallback((key: string) => {
    setIngredientRows((prev) => prev.filter((r) => r.key !== key));
  }, []);

  const moveIngredientRow = useCallback(
    (key: string, direction: -1 | 1) => {
      setIngredientRows((prev) => {
        const idx = prev.findIndex((r) => r.key === key);
        if (idx < 0) return prev;
        const targetIdx = idx + direction;
        if (targetIdx < 0 || targetIdx >= prev.length) return prev;
        const next = prev.slice();
        const [item] = next.splice(idx, 1);
        next.splice(targetIdx, 0, item);
        return next;
      });
    },
    [],
  );

  // Used by the drag-and-drop handler in IngredientRowItem: moves the row
  // identified by `key` to an arbitrary destination index, clamped into
  // bounds. A no-op when the destination matches the current position so
  // a stray drag never triggers an unnecessary re-render.
  const reorderIngredientRow = useCallback(
    (key: string, toIndex: number) => {
      setIngredientRows((prev) => {
        const fromIdx = prev.findIndex((r) => r.key === key);
        if (fromIdx < 0) return prev;
        const clamped = Math.max(0, Math.min(prev.length - 1, toIndex));
        if (clamped === fromIdx) return prev;
        const next = prev.slice();
        const [item] = next.splice(fromIdx, 1);
        next.splice(clamped, 0, item);
        return next;
      });
    },
    [],
  );

  const updateIngredientRow = useCallback(
    (key: string, side: "en" | "ar", value: string) => {
      setIngredientRows((prev) =>
        prev.map((r) => (r.key === key ? { ...r, [side]: value } : r)),
      );
    },
    [],
  );

  const handleSave = useCallback(async () => {
    if (
      !name.trim() ||
      !nameAr.trim() ||
      !price ||
      !sku ||
      !selectedBrandId ||
      !selectedCategoryId
    ) {
      setError(
        language === "ar"
          ? "يرجى ملء جميع الحقول المطلوبة"
          : "Please fill all required fields",
      );
      return;
    }

    setSaving(true);
    setError("");

    // Convert the editorial fields back into the shape the API expects.
    // Each ingredient row contributes one EN entry and one AR entry; rows
    // where both sides are blank are dropped, while rows with only one
    // language filled still send the populated side (the server's
    // normalizeIngredients helper filters per-language empty strings).
    const ingredientsList: string[] = [];
    const ingredientsArList: string[] = [];
    ingredientRows.forEach((row) => {
      const en = row.en.trim();
      const ar = row.ar.trim();
      if (en.length === 0 && ar.length === 0) return;
      ingredientsList.push(en);
      ingredientsArList.push(ar);
    });
    const parseNutritionField = (raw: string): number | null => {
      const trimmed = raw.trim();
      if (trimmed.length === 0) return null;
      const n = parseFloat(trimmed);
      return Number.isFinite(n) ? n : null;
    };
    const nutritionPayload: Record<string, number> = {};
    const cal = parseNutritionField(nutritionCalories);
    if (cal !== null) nutritionPayload.calories = cal;
    const prot = parseNutritionField(nutritionProtein);
    if (prot !== null) nutritionPayload.protein = prot;
    const carbs = parseNutritionField(nutritionCarbs);
    if (carbs !== null) nutritionPayload.carbs = carbs;
    const fat = parseNutritionField(nutritionFat);
    if (fat !== null) nutritionPayload.fat = fat;

    const productData = {
      name: name.trim(),
      name_ar: nameAr.trim(),
      description: description.trim() || null,
      description_ar: descriptionAr.trim() || null,
      ingredients: ingredientsList.length > 0 ? ingredientsList : null,
      ingredients_ar: ingredientsArList.length > 0 ? ingredientsArList : null,
      pairing_notes: pairingNotes.trim() || null,
      pairing_notes_ar: pairingNotesAr.trim() || null,
      nutrition: Object.keys(nutritionPayload).length > 0 ? nutritionPayload : null,
      price: parseFloat(price),
      sku: sku.trim(),
      image_url: images.length > 0 ? images[0] : null,
      images,
      product_brand_id: selectedBrandId,
      category_id: selectedCategoryId,
      car_model_ids: selectedCarModelIds,
      stock_quantity: parseInt(stockQuantity) || 0,
      fitment_indicator: fitmentIndicator || "صغير",
      product_type: productType,
      is_tire: productType === "tire",
    };

    try {
      let result;
      if (isEditMode && editingProduct) {
        result = await adminSync.updateProduct(editingProduct.id, productData);
        if (result.success)
          showToast(
            language === "ar"
              ? "تم تحديث المنتج بنجاح"
              : "Product updated successfully",
            "success",
          );
        else {
          setError(result.error || "Failed to update product");
          showToast(result.error || "Failed", "error");
        }
      } else {
        result = await adminSync.createProduct(productData);
        if (result.success)
          showToast(
            language === "ar"
              ? "تم إضافة المنتج بنجاح"
              : "Product created successfully",
            "success",
          );
        else {
          setError(result.error || "Failed to create product");
          showToast(result.error || "Failed", "error");
        }
      }

      if (result.success) {
        setShowSuccess(true);
        resetForm();
        await refetch();
        setTimeout(() => setShowSuccess(false), 2000);
      }
    } catch (err: any) {
      setError(err.response?.data?.detail || "Error saving product");
      showToast("Operation failed", "error");
    } finally {
      setSaving(false);
    }
  }, [
    name,
    nameAr,
    description,
    descriptionAr,
    ingredientRows,
    pairingNotes,
    pairingNotesAr,
    nutritionCalories,
    nutritionProtein,
    nutritionCarbs,
    nutritionFat,
    price,
    sku,
    stockQuantity,
    images,
    selectedBrandId,
    selectedCategoryId,
    selectedCarModelIds,
    fitmentIndicator,
    productType,
    products,
    isEditMode,
    editingProduct,
    language,
    adminSync,
    refetch,
    resetForm,
    showToast,
  ]);

  // Auto-open the edit form when navigated here with ?editProductId=XYZ.
  // Used by the StockNotificationCard's pencil icon: an admin tapping the
  // restock / out-of-stock alert lands directly in the form with all
  // fields pre-filled for that exact variant. We strip the param after
  // applying it so the form does not re-open on subsequent renders.
  const autoEditAppliedRef = useRef(false);
  // Forward-ref to handleEditProduct (declared further below) so the
  // auto-open effect can call into the latest handler without circular
  // ordering issues at module initialization time.
  const handleEditProductRef = useRef<((product: any) => void) | null>(null);
  useEffect(() => {
    const target = params?.editProductId
      ? String(params.editProductId)
      : "";
    if (!target || autoEditAppliedRef.current) return;
    if (!products || products.length === 0) return;
    // Products are grouped per SKU by the list query; the ID may belong
    // to any sibling variant. Walk every group's siblings so the user
    // lands on the exact variant referenced by the notification.
    let match: any = null;
    for (const group of products as any[]) {
      if (group?.id === target) { match = group; break; }
      const siblings = (group as any).siblings || (group as any).variants || [];
      for (const sib of siblings) {
        if (sib?.id === target) { match = sib; break; }
      }
      if (match) break;
    }
    if (match) {
      autoEditAppliedRef.current = true;
      handleEditProductRef.current?.(match);
      // Compute the group key so we can scroll to and highlight the card.
      const matchSku = String(match.sku || '').trim();
      const matchGroupKey = matchSku ? `sku:${matchSku}` : `id:${match.id}`;
      setHighlightedProductId(matchGroupKey);
      // Clear the param so a back-nav or refresh does not reopen the form.
      router.setParams({ editProductId: undefined } as any);
    }
  }, [params?.editProductId, products, router]);

  // When a product is highlighted, scroll it into view. We attempt an
  // immediate scroll if the card was already measured; if not (first render),
  // the onLayout callback on the card wrapper will scroll when layout fires.
  useEffect(() => {
    if (!highlightedProductId) return;
    // Attempt immediate scroll if layout was already captured
    const existingY = cardYOffsetsRef.current.get(highlightedProductId);
    if (existingY != null) {
      scrollViewRef.current?.scrollTo({ y: listContainerYRef.current + existingY, animated: true });
    }
    // Clear the highlight state after the animation completes (1800 ms)
    const clearTimer = setTimeout(() => setHighlightedProductId(null), 2500);
    return () => clearTimeout(clearTimer);
  }, [highlightedProductId]);

  const handleEditProduct = useCallback((product: any) => {
    setName(product.name || "");
    setNameAr(product.name_ar || "");
    setDescription(product.description || "");
    setDescriptionAr(product.description_ar || "");
    // Hydrate the editorial fields. The API may return ingredients as either
    // a JSON array (jsonb) or a JSON-encoded string depending on how the
    // record was last persisted, so handle both shapes defensively. Once
    // both languages are normalized to arrays we zip them index-by-index
    // into paired EN/AR rows; the shorter side is padded with empty
    // strings so existing data never silently disappears on edit.
    const parseList = (raw: unknown): string[] => {
      let arr: unknown = raw;
      if (typeof raw === "string") {
        try {
          arr = JSON.parse(raw);
        } catch {
          // Legacy records were stored as newline-delimited plain text.
          // Split on newlines and trim so each line lands in its own row
          // instead of collapsing the whole list into one entry.
          return raw
            .split(/\r?\n/)
            .map((line) => line.trim())
            .filter((line) => line.length > 0);
        }
      }
      if (Array.isArray(arr)) {
        return arr.map((entry) => (typeof entry === "string" ? entry : ""));
      }
      return [];
    };
    const enList = parseList(product.ingredients);
    const arList = parseList(product.ingredients_ar);
    const pairedLen = Math.max(enList.length, arList.length);
    const hydratedRows: IngredientRow[] = [];
    for (let i = 0; i < pairedLen; i++) {
      hydratedRows.push(
        createIngredientRow(enList[i] ?? "", arList[i] ?? ""),
      );
    }
    setIngredientRows(hydratedRows);
    setPairingNotes(typeof product.pairing_notes === "string" ? product.pairing_notes : "");
    setPairingNotesAr(typeof product.pairing_notes_ar === "string" ? product.pairing_notes_ar : "");
    let nutritionObj: Record<string, unknown> = {};
    const rawNutrition = product.nutrition;
    if (rawNutrition && typeof rawNutrition === "object" && !Array.isArray(rawNutrition)) {
      nutritionObj = rawNutrition as Record<string, unknown>;
    } else if (typeof rawNutrition === "string") {
      try {
        const parsed = JSON.parse(rawNutrition);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          nutritionObj = parsed as Record<string, unknown>;
        }
      } catch {}
    }
    const formatNutritionVal = (v: unknown): string => {
      if (v === null || v === undefined || v === "") return "";
      const n = typeof v === "number" ? v : parseFloat(String(v));
      return Number.isFinite(n) ? String(n) : "";
    };
    setNutritionCalories(formatNutritionVal(nutritionObj.calories));
    setNutritionProtein(formatNutritionVal(nutritionObj.protein));
    setNutritionCarbs(formatNutritionVal(nutritionObj.carbs));
    setNutritionFat(formatNutritionVal(nutritionObj.fat));
    setPrice(product.price?.toString() || "");
    setSku(product.sku || "");
    setStockQuantity((product.stock_quantity || product.stock || 0).toString());
    setFitmentIndicator(product.fitment_indicator || "صغير");
    setProductType(
      (product.product_type as ProductType | null | undefined) ??
        (product.is_tire ? "tire" : null),
    );
    setImages(product.images || (product.image_url ? [product.image_url] : []));
    setSelectedBrandId(product.product_brand_id || "");
    setSelectedCategoryId(product.category_id || "");
    setSelectedCarModelIds(product.car_model_ids || []);
    setEditingProduct(product);
    setIsEditMode(true);
    setError("");
  }, []);

  // Keep the auto-open effect's ref pointed at the latest handler.
  useEffect(() => {
    handleEditProductRef.current = handleEditProduct;
  }, [handleEditProduct]);

  const toggleCarModel = useCallback((modelId: string) => {
    setSelectedCarModelIds((prev) =>
      prev.includes(modelId)
        ? prev.filter((id) => id !== modelId)
        : [...prev, modelId],
    );
  }, []);

  const handleQuantityInputChange = useCallback(
    (productId: string, value: string) => {
      setQuantityInputs((prev) => ({ ...prev, [productId]: value }));
    },
    [],
  );

  const handleUpdateQuantity = useCallback(
    async (productId: string) => {
      const newQuantity = parseInt(quantityInputs[productId]) || 0;
      setUpdatingQuantityId(productId);
      try {
        await updateQuantityMutation.mutateAsync({
          productId,
          quantity: newQuantity,
        });
        showToast(
          language === "ar" ? "تم تحديث الكمية" : "Quantity updated",
          "success",
        );
      } catch {
        showToast(language === "ar" ? "فشل تحديث الكمية" : "Failed", "error");
      } finally {
        setUpdatingQuantityId(null);
      }
    },
    [quantityInputs, updateQuantityMutation, language, showToast],
  );

  const openDeleteConfirm = useCallback((product: any) => {
    setProductToDelete(product);
    setShowDeleteModal(true);
  }, []);

  const handleDelete = useCallback(async () => {
    if (!productToDelete) return;
    setDeleting(true);
    try {
      const result = await deleteProductMutation.mutateAsync(
        productToDelete.id,
      );
      if (result.success)
        showToast(
          language === "ar" ? "تم حذف المنتج بنجاح" : "Deleted successfully",
          "success",
        );
      else showToast(result.error || "Failed", "error");
      setShowDeleteModal(false);
      setProductToDelete(null);
    } catch {
      showToast("Error deleting product", "error");
    } finally {
      setDeleting(false);
    }
  }, [productToDelete, deleteProductMutation, language, showToast]);

  // Group sibling counts by SKU (for badge on each card)
  const variantCountsBySku = useMemo(() => {
    const map: Record<string, number> = {};
    products.forEach((p: any) => {
      const key = (p.sku || "").trim();
      if (!key) return;
      map[key] = (map[key] || 0) + 1;
    });
    return map;
  }, [products]);

  const variantsModalSiblings = useMemo(() => {
    if (!variantsModalSku) return [];
    return products.filter(
      (p: any) => (p.sku || "").trim() === variantsModalSku.trim(),
    );
  }, [products, variantsModalSku]);

  const handleOpenVariants = useCallback((product: any) => {
    if (!product?.sku) {
      return;
    }
    setVariantsModalSku(String(product.sku).trim());
  }, []);

  const handleSaveVariantInline = useCallback(
    async (productId: string, price: number, stock: number) => {
      const product = products.find((p: any) => p.id === productId);
      if (!product) return false;
      const result = await adminSync.updateProduct(productId, {
        name: product.name,
        name_ar: product.name_ar,
        description: product.description ?? null,
        description_ar: product.description_ar ?? null,
        price,
        sku: product.sku,
        product_brand_id: product.product_brand_id,
        category_id: product.category_id,
        image_url: product.image_url ?? null,
        images: product.images || [],
        car_model_ids: product.car_model_ids || [],
        stock_quantity: stock,
        hidden_status: product.hidden_status || false,
        fitment_indicator: product.fitment_indicator || null,
        product_type: product.product_type ?? (product.is_tire ? "tire" : null),
        is_tire:
          (product.product_type ?? (product.is_tire ? "tire" : null)) === "tire",
      });
      if (result.success) {
        showToast(
          language === "ar" ? "تم تحديث المتغير" : "Variant updated",
          "success",
        );
        await refetch();
        return true;
      }
      showToast(result.error || "Failed", "error");
      return false;
    },
    [products, adminSync, language, refetch, showToast],
  );

  const handleBulkSaveVariants = useCallback(
    async (
      updates: Array<{ id: string; price: number; stock_quantity: number }>,
    ) => {
      const resp = await adminSync.bulkUpdateVariants(updates);
      if (resp.error && (!resp.results || resp.results.length === 0)) {
        showToast(resp.error, "error");
      } else {
        const successCount = resp.results.filter((r) => r.success).length;
        const failCount = resp.results.length - successCount;
        if (failCount === 0) {
          showToast(
            language === "ar"
              ? `تم حفظ ${successCount} متغير`
              : `Saved ${successCount} variant${successCount === 1 ? "" : "s"}`,
            "success",
          );
        } else {
          showToast(
            language === "ar"
              ? `تم حفظ ${successCount} مع فشل ${failCount}`
              : `Saved ${successCount}, ${failCount} failed`,
            successCount > 0 ? "warning" : "error",
          );
        }
      }
      await refetch();
      return resp;
    },
    [adminSync, language, refetch, showToast],
  );

  const handleCloneFromStd = useCallback(
    async (indicator: FitmentIndicator) => {
      if (!variantsModalSku) return false;
      const siblings = products.filter(
        (p: any) => (p.sku || "").trim() === variantsModalSku.trim(),
      );
      const exists = siblings.find(
        (p: any) => (p.fitment_indicator || "") === indicator,
      );
      if (exists) {
        showToast(
          language === "ar" ? "هذا الحجم موجود بالفعل" : "Variant already exists",
          "warning",
        );
        return false;
      }
      // Clone from any existing sibling as the source.
      const source = siblings[0];
      if (!source) {
        showToast(
          language === "ar" ? "لا يوجد منتج مصدر للنسخ" : "No source product to clone",
          "error",
        );
        return false;
      }
      const productData = {
        name: source.name,
        name_ar: source.name_ar,
        description: source.description ?? null,
        description_ar: source.description_ar ?? null,
        price: parseFloat(String(source.price ?? 0)),
        sku: source.sku,
        image_url: source.image_url ?? null,
        images: source.images || [],
        product_brand_id: source.product_brand_id,
        category_id: source.category_id,
        car_model_ids: source.car_model_ids || [],
        stock_quantity: 0,
        fitment_indicator: indicator,
        product_type: source.product_type ?? (source.is_tire ? "tire" : null),
        is_tire:
          (source.product_type ?? (source.is_tire ? "tire" : null)) === "tire",
      };
      const result = await adminSync.createProduct(productData);
      if (result.success) {
        showToast(
          language === "ar"
            ? `تمت إضافة المتغير ${indicator}`
            : `Variant ${indicator} added`,
          "success",
        );
        await refetch();
        return true;
      }
      showToast(result.error || "Failed", "error");
      return false;
    },
    [variantsModalSku, products, adminSync, language, refetch, showToast],
  );

  // Filtered products (search + availability + sort)
  const filteredProducts = useMemo(() => {
    let list: any[] = products;
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      list = list.filter(
        (p: any) =>
          (p.name || "").toLowerCase().includes(query) ||
          (p.name_ar || "").toLowerCase().includes(query) ||
          (p.sku || "").toLowerCase().includes(query),
      );
    }
    if (availabilityFilter === 'available') {
      list = list.filter((p: any) => !p.is_out_of_stock && p.is_available !== false);
    } else if (availabilityFilter === 'out_of_stock') {
      list = list.filter((p: any) => p.is_out_of_stock || p.is_available === false);
    }
    if (productSortBy !== 'default') {
      list = [...list].sort((a, b) => {
        if (productSortBy === 'name_asc') return (a.name || '').localeCompare(b.name || '');
        if (productSortBy === 'name_desc') return (b.name || '').localeCompare(a.name || '');
        if (productSortBy === 'price_asc') return (parseFloat(a.price) || 0) - (parseFloat(b.price) || 0);
        if (productSortBy === 'price_desc') return (parseFloat(b.price) || 0) - (parseFloat(a.price) || 0);
        return 0;
      });
    }
    return list;
  }, [products, searchQuery, availabilityFilter, productSortBy]);

  // Products with display data
  const productsWithDisplayData = useMemo(
    () =>
      filteredProducts.map((product: any) => ({
        ...product,
        _brandName: brandMap[product.product_brand_id]
          ? language === "ar"
            ? brandMap[product.product_brand_id].name_ar
            : brandMap[product.product_brand_id].name
          : "",
        _categoryName: categoryMap[product.category_id]
          ? language === "ar"
            ? categoryMap[product.category_id].name_ar
            : categoryMap[product.category_id].name
          : "",
        _carModelNames: (product.car_model_ids || [])
          .map((id: string) =>
            carModelMap[id]
              ? language === "ar"
                ? carModelMap[id].name_ar
                : carModelMap[id].name
              : "",
          )
          .filter(Boolean)
          .join(", "),
      })),
    [filteredProducts, brandMap, categoryMap, carModelMap, language],
  );

  // Group decorated products by SKU into a single card-per-SKU list. The
  // canonical (primary) sibling is the STD row when present; otherwise the
  // first row in the group. Display strings (brand/category/cars) come from
  // the primary so the card stays consistent regardless of which variant
  // chip the admin is currently inspecting. Products with no SKU stay as
  // standalone entries (each gets its own card).
  const groupedProductsForList = useMemo(() => {
    const groups = new Map<string, any[]>();
    for (const p of productsWithDisplayData) {
      const sku = String(p.sku || "").trim();
      const key = sku ? `sku:${sku}` : `id:${p.id}`;
      const list = groups.get(key);
      if (list) list.push(p);
      else groups.set(key, [p]);
    }
    return Array.from(groups.entries()).map(([key, siblings]) => {
      // Order by defined size sequence, then by creation date for unlabelled rows.
      const ORDER = FITMENT_INDICATORS as readonly string[];
      const sorted = [...siblings].sort((a, b) => {
        const ai = ORDER.indexOf(a.fitment_indicator || "");
        const bi = ORDER.indexOf(b.fitment_indicator || "");
        if (ai === -1 && bi === -1) return 0;
        if (ai === -1) return 1;
        if (bi === -1) return -1;
        return ai - bi;
      });
      return {
        key,
        primary: sorted[0],
        siblings: sorted,
      };
    });
  }, [productsWithDisplayData]);

  // Form state object for header
  const formState: FormState = useMemo(
    () => ({
      name,
      nameAr,
      description,
      descriptionAr,
      ingredientRows,
      pairingNotes,
      pairingNotesAr,
      nutritionCalories,
      nutritionProtein,
      nutritionCarbs,
      nutritionFat,
      price,
      sku,
      stockQuantity,
      fitmentIndicator,
      productType,
      selectedBrandId,
      selectedCategoryId,
      selectedCarModelIds,
      images,
      brandSearchQuery,
      categorySearchQuery,
      carModelSearchQuery,
      searchQuery,
      isEditMode,
      editingProduct,
      error,
      saving,
      showSuccess,
    }),
    [
      name,
      nameAr,
      description,
      descriptionAr,
      ingredientRows,
      pairingNotes,
      pairingNotesAr,
      nutritionCalories,
      nutritionProtein,
      nutritionCarbs,
      nutritionFat,
      price,
      sku,
      stockQuantity,
      fitmentIndicator,
      productType,
      selectedBrandId,
      selectedCategoryId,
      selectedCarModelIds,
      images,
      brandSearchQuery,
      categorySearchQuery,
      carModelSearchQuery,
      searchQuery,
      isEditMode,
      editingProduct,
      error,
      saving,
      showSuccess,
    ],
  );

  // Form handlers object for header
  const formHandlers: FormHandlers = useMemo(
    () => ({
      setName,
      setNameAr,
      setDescription,
      setDescriptionAr,
      addIngredientRow,
      removeIngredientRow,
      moveIngredientRow,
      reorderIngredientRow,
      updateIngredientRow,
      setPairingNotes,
      setPairingNotesAr,
      setNutritionCalories,
      setNutritionProtein,
      setNutritionCarbs,
      setNutritionFat,
      setPrice,
      setSku,
      setStockQuantity,
      setFitmentIndicator,
      setProductType,
      setSelectedBrandId,
      setSelectedCategoryId,
      setSelectedCarModelIds,
      setImages,
      setBrandSearchQuery,
      setCategorySearchQuery,
      setCarModelSearchQuery,
      setSearchQuery,
      toggleCarModel,
      handleSave,
      resetForm,
    }),
    [toggleCarModel, handleSave, resetForm],
  );

  // Lookups object for header
  const lookups: Lookups = useMemo(
    () => ({
      productBrands,
      categories,
      carModels,
      brandMap,
      categoryMap,
      carModelMap,
    }),
    [productBrands, categories, carModels, brandMap, categoryMap, carModelMap],
  );

  // Use refs to hold latest values - this keeps the callback stable while still having access to fresh data
  const formStateRef = useRef(formState);
  const formHandlersRef = useRef(formHandlers);
  const lookupsRef = useRef(lookups);
  const colorsRef = useRef(colors);
  const languageRef = useRef(language);
  const isRTLRef = useRef(isRTL);
  const productsCountRef = useRef(products.length);
  const routerRef = useRef(router);

  // Update refs when values change
  useEffect(() => {
    formStateRef.current = formState;
  }, [formState]);
  useEffect(() => {
    formHandlersRef.current = formHandlers;
  }, [formHandlers]);
  useEffect(() => {
    lookupsRef.current = lookups;
  }, [lookups]);
  useEffect(() => {
    colorsRef.current = colors;
  }, [colors]);
  useEffect(() => {
    languageRef.current = language;
  }, [language]);
  useEffect(() => {
    isRTLRef.current = isRTL;
  }, [isRTL]);
  useEffect(() => {
    productsCountRef.current = products.length;
  }, [products.length]);
  useEffect(() => {
    routerRef.current = router;
  }, [router]);

  // Render a *grouped* product card — one card per SKU, all sibling
  // fitment variants live inside the same card via the interactive chip row.
  const renderProductItem = useCallback(
    ({
      item: group,
    }: {
      item: { key: string; primary: any; siblings: any[] };
    }) => (
      <ProductGroupCard
        siblings={group.siblings}
        defaultProduct={group.primary}
        colors={colors}
        language={language}
        isRTL={isRTL}
        brandName={group.primary._brandName}
        categoryName={group.primary._categoryName}
        carModelNames={group.primary._carModelNames}
        quantityInputs={quantityInputs}
        updatingQuantityId={updatingQuantityId}
        onQuantityChange={handleQuantityInputChange}
        onUpdateQuantity={handleUpdateQuantity}
        onEdit={handleEditProduct}
        onDelete={openDeleteConfirm}
        onOpenVariants={handleOpenVariants}
      />
    ),
    [
      colors,
      language,
      isRTL,
      quantityInputs,
      updatingQuantityId,
      handleQuantityInputChange,
      handleUpdateQuantity,
      handleEditProduct,
      openDeleteConfirm,
      handleOpenVariants,
    ],
  );

  // Header component - uses refs for stable callback identity while accessing fresh values
  // CRITICAL: This prevents FlashList from remounting the header on every keystroke
  const ListHeaderComponent = useCallback(
    () => (
      <ProductFormHeader
        formState={formStateRef.current}
        handlers={formHandlersRef.current}
        lookups={lookupsRef.current}
        colors={colorsRef.current}
        language={languageRef.current}
        isRTL={isRTLRef.current}
        productsCount={productsCountRef.current}
        router={routerRef.current}
      />
    ),
    [],
  );

  return (
    <SafeAreaView
      style={[styles.container, { backgroundColor: colors.background }]}
      edges={["bottom"]}
    >
      <Header
        title={language === "ar" ? "المنتجات" : "Products"}
        showBack
        showSearch={false}
        showCart={false}
      />

      <ScrollView
        ref={scrollViewRef}
        style={styles.mainScrollView}
        contentContainerStyle={styles.mainScrollContent}
        showsVerticalScrollIndicator={true}
        keyboardShouldPersistTaps="handled"
        nestedScrollEnabled={true}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={refetch}
            tintColor={colors.primary}
          />
        }
      >
        {/* Form Section - OUTSIDE FlashList to prevent focus loss */}
        <View style={styles.formSection}>
          <ProductFormHeader
            formState={formState}
            handlers={formHandlers}
            lookups={lookups}
            colors={colors}
            language={language}
            isRTL={isRTL}
            productsCount={products.length}
            router={router}
          />
        </View>

        {/* Products filter + sort bar */}
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 12, paddingBottom: 8, gap: 6 }}>
          {(['all', 'available', 'out_of_stock'] as const).map((opt) => {
            const labels = { all: { en: 'All', ar: 'الكل' }, available: { en: 'In Stock', ar: 'متاح' }, out_of_stock: { en: 'Out of Stock', ar: 'نفذ' } };
            const active = availabilityFilter === opt;
            return (
              <TouchableOpacity key={opt} onPress={() => setAvailabilityFilter(opt)}
                style={{ paddingHorizontal: 10, paddingVertical: 4, borderRadius: 14, backgroundColor: active ? colors.primary : colors.surface, borderWidth: 1, borderColor: active ? colors.primary : colors.border }}>
                <Text style={{ fontSize: 11, fontWeight: active ? '700' : '400', color: active ? '#fff' : colors.textSecondary }}>
                  {language === 'ar' ? labels[opt].ar : labels[opt].en}
                </Text>
              </TouchableOpacity>
            );
          })}
          <View style={{ width: 1, backgroundColor: colors.border, marginHorizontal: 2 }} />
          {(['default', 'name_asc', 'name_desc', 'price_asc', 'price_desc'] as const).map((opt) => {
            const labels = { default: { en: 'Default', ar: 'افتراضي' }, name_asc: { en: 'A→Z', ar: 'أ→ي' }, name_desc: { en: 'Z→A', ar: 'ي→أ' }, price_asc: { en: '↑ Price', ar: '↑ سعر' }, price_desc: { en: '↓ Price', ar: '↓ سعر' } };
            const active = productSortBy === opt;
            return (
              <TouchableOpacity key={opt} onPress={() => setProductSortBy(opt)}
                style={{ paddingHorizontal: 10, paddingVertical: 4, borderRadius: 14, backgroundColor: active ? colors.primary : colors.surface, borderWidth: 1, borderColor: active ? colors.primary : colors.border }}>
                <Text style={{ fontSize: 11, fontWeight: active ? '700' : '400', color: active ? '#fff' : colors.textSecondary }}>
                  {language === 'ar' ? labels[opt].ar : labels[opt].en}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* Products List Section - Using map() since FlashList doesn't work inside ScrollView */}
        <View
          style={styles.productsListContainer}
          onLayout={(e) => { listContainerYRef.current = e.nativeEvent.layout.y; }}
        >
          {loading ? (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="large" color={colors.primary} />
            </View>
          ) : groupedProductsForList.length === 0 ? (
            <View style={styles.emptyContainer}>
              <Ionicons
                name="cube-outline"
                size={48}
                color={colors.textSecondary}
              />
              <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
                {language === "ar" ? "لا توجد منتجات" : "No products found"}
              </Text>
            </View>
          ) : (
            <View>
              {groupedProductsForList.map((group) => (
                <View
                  key={group.key}
                  onLayout={(e) => {
                    const y = e.nativeEvent.layout.y;
                    cardYOffsetsRef.current.set(group.key, y);
                    // If this card is the current highlight target and hasn't
                    // been measured yet, scroll to it now that layout is known.
                    if (highlightedProductId === group.key) {
                      scrollViewRef.current?.scrollTo({ y: listContainerYRef.current + y, animated: true });
                    }
                  }}
                >
                  <ProductGroupCard
                    siblings={group.siblings}
                    defaultProduct={group.primary}
                    colors={colors}
                    language={language}
                    isRTL={isRTL}
                    brandName={group.primary._brandName}
                    categoryName={group.primary._categoryName}
                    carModelNames={group.primary._carModelNames}
                    quantityInputs={quantityInputs}
                    updatingQuantityId={updatingQuantityId}
                    onQuantityChange={handleQuantityInputChange}
                    onUpdateQuantity={handleUpdateQuantity}
                    onEdit={handleEditProduct}
                    onDelete={openDeleteConfirm}
                    onOpenVariants={handleOpenVariants}
                    isHighlighted={highlightedProductId === group.key}
                  />
                </View>
              ))}
            </View>
          )}
        </View>

        <View style={{ height: insets.bottom + 40 }} />
      </ScrollView>

      {/* Variant Matrix Modal */}
      <VariantMatrixModal
        visible={!!variantsModalSku}
        onClose={() => setVariantsModalSku(null)}
        sku={variantsModalSku || ""}
        siblings={variantsModalSiblings}
        colors={colors}
        language={language}
        onSaveVariant={handleSaveVariantInline}
        onBulkSaveVariants={handleBulkSaveVariants}
        onCloneFromStd={handleCloneFromStd}
      />

      {/* Delete Confirmation Modal */}
      <Modal
        visible={showDeleteModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowDeleteModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View
            style={[
              styles.deleteConfirmModal,
              { backgroundColor: colors.card },
            ]}
          >
            <TouchableOpacity
              style={styles.modalCloseBtn}
              onPress={() => {
                setShowDeleteModal(false);
                setProductToDelete(null);
              }}
            >
              <Ionicons name="close" size={22} color={colors.textSecondary} />
            </TouchableOpacity>
            <View
              style={[
                styles.deleteIconCircle,
                { backgroundColor: "#ef4444" + "20" },
              ]}
            >
              <Ionicons name="trash" size={36} color="#ef4444" />
            </View>
            <Text style={[styles.deleteConfirmText, { color: colors.text }]}>
              {language === "ar"
                ? "هل أنت متأكد من حذف هذا المنتج؟"
                : "Are you sure you want to delete this product?"}
            </Text>
            {productToDelete && (
              <Text
                style={[
                  styles.deleteProductName,
                  { color: colors.textSecondary },
                ]}
              >
                {language === "ar"
                  ? productToDelete.name_ar
                  : productToDelete.name}
              </Text>
            )}
            <TouchableOpacity
              style={[styles.confirmDeleteBtn, { backgroundColor: "#ef4444" }]}
              onPress={handleDelete}
              disabled={deleting}
            >
              {deleting ? (
                <ActivityIndicator size="small" color="#FFF" />
              ) : (
                <>
                  <Ionicons name="trash" size={18} color="#FFF" />
                  <Text style={styles.confirmDeleteBtnText}>
                    {language === "ar" ? "حذف" : "Delete"}
                  </Text>
                </>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <Toast
        visible={toastVisible}
        message={toastMessage}
        type={toastType}
        onDismiss={() => setToastVisible(false)}
      />
    </SafeAreaView>
  );
}

// ============================================================================
// Styles
// ============================================================================
const styles = StyleSheet.create({
  container: { flex: 1 },
  mainScrollView: { flex: 1 },
  mainScrollContent: { paddingHorizontal: 16 },
  formSection: { paddingTop: 16 },
  listHeaderContainer: { paddingHorizontal: 16, paddingVertical: 8 },
  productsListContainer: { flex: 1 },
  loadingContainer: { padding: 40, alignItems: "center" },
  emptyContainer: { padding: 40, alignItems: "center" },
  breadcrumb: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 16,
    gap: 8,
  },
  breadcrumbRTL: { flexDirection: "row-reverse" },
  breadcrumbText: { fontSize: 14 },
  formCard: { borderRadius: 12, borderWidth: 1, padding: 16, marginBottom: 16 },
  formTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 20,
  },
  formTitle: { fontSize: 20, fontWeight: "700" },
  cancelEditBtn: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    gap: 6,
  },
  cancelEditText: { fontSize: 14, fontWeight: "600" },
  formSectionInner: {
    borderBottomWidth: 1,
    paddingBottom: 20,
    marginBottom: 20,
  },
  sectionLabel: { fontSize: 14, fontWeight: "700", marginBottom: 16 },
  formGroup: { marginBottom: 16 },
  label: { fontSize: 14, fontWeight: "600", marginBottom: 6 },
  fieldHint: { fontSize: 12, marginBottom: 8 },
  input: { borderWidth: 1, borderRadius: 10, padding: 12, fontSize: 15 },
  inputRTL: { textAlign: "right" },
  textArea: {
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
    fontSize: 15,
    minHeight: 80,
    textAlignVertical: "top",
  },
  row: { flexDirection: "row" },
  ingredientsHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 6,
  },
  ingredientsCount: { fontSize: 12, fontWeight: "500" },
  ingredientsEmpty: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 14,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderStyle: "dashed",
    marginBottom: 10,
  },
  ingredientRow: {
    flexDirection: "row",
    alignItems: "stretch",
    gap: 10,
    padding: 10,
    borderRadius: 10,
    borderWidth: 1,
    marginBottom: 8,
  },
  ingredientRowControls: {
    alignItems: "center",
    justifyContent: "flex-start",
    gap: 6,
    paddingTop: 2,
  },
  ingredientRowIndex: { fontSize: 12, fontWeight: "700", marginBottom: 2 },
  ingredientRowDragHandle: {
    width: 32,
    height: 32,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  ingredientRowBtn: {
    width: 28,
    height: 28,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  ingredientRowFields: { flex: 1, justifyContent: "center" },
  ingredientRowDelete: {
    width: 32,
    height: 32,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    alignSelf: "center",
  },
  ingredientAddBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderStyle: "dashed",
    marginTop: 4,
  },
  selectedDisplay: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    marginBottom: 10,
    gap: 8,
  },
  selectedText: { flex: 1, fontSize: 14, fontWeight: "600" },
  selectedBrandLogo: { width: 24, height: 24, borderRadius: 12 },
  chipsContainer: { flexDirection: "row", marginTop: 4 },
  brandChip: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 12,
    borderWidth: 1,
    marginRight: 10,
    marginBottom: 8,
    gap: 6,
  },
  brandChipLogo: { width: 28, height: 28, borderRadius: 6, borderWidth: 1 },
  brandChipPlaceholder: {
    width: 28,
    height: 28,
    borderRadius: 6,
    alignItems: "center",
    justifyContent: "center",
  },
  selectedCount: { fontSize: 12, marginTop: 8, fontWeight: "500" },
  labelWithSearch: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 6,
    flexWrap: "wrap",
    gap: 8,
  },
  miniSearchContainer: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
    gap: 4,
    minWidth: 100,
    maxWidth: 150,
  },
  miniSearchInput: { flex: 1, fontSize: 12, paddingVertical: 2 },
  categoryChip: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 12,
    borderWidth: 1,
    marginRight: 10,
    marginBottom: 8,
    gap: 6,
  },
  categoryChipImage: { width: 26, height: 26, borderRadius: 6, borderWidth: 1 },
  categoryChipPlaceholder: {
    width: 26,
    height: 26,
    borderRadius: 6,
    alignItems: "center",
    justifyContent: "center",
  },
  carModelChip: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 12,
    borderWidth: 1,
    marginRight: 10,
    marginBottom: 8,
    gap: 8,
    minWidth: 120,
  },
  carModelChipImage: { width: 36, height: 36, borderRadius: 8, borderWidth: 1 },
  carModelChipPlaceholder: {
    width: 36,
    height: 36,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  carModelChipTextContainer: { flexDirection: "column", flex: 1 },
  carModelNameRow: { flexDirection: "row", alignItems: "center" },
  carModelYearText: { fontSize: 10, marginTop: 2, fontWeight: "400" },
  errorText: { color: "#ef4444", fontSize: 14, marginBottom: 12 },
  saveButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    padding: 16,
    borderRadius: 12,
    gap: 8,
  },
  saveButtonText: { color: "#FFF", fontSize: 16, fontWeight: "700" },
  listCard: { borderRadius: 12, borderWidth: 1, padding: 16, marginBottom: 8 },
  listTitle: { fontSize: 18, fontWeight: "700", marginBottom: 16 },
  searchContainer: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    gap: 10,
  },
  searchInput: { flex: 1, fontSize: 15, paddingVertical: 0 },
  emptyText: { textAlign: "center", marginTop: 12, fontSize: 15 },
  productCard: { borderBottomWidth: 1, paddingVertical: 12 },
  productHeader: { flexDirection: "row", alignItems: "center" },
  productImage: { width: 56, height: 56, borderRadius: 10 },
  productImagePlaceholder: {
    width: 56,
    height: 56,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  productMainInfo: { flex: 1, marginLeft: 12 },
  productName: { fontSize: 15, fontWeight: "600" },
  productSku: { fontSize: 12, marginTop: 2 },
  productPrice: { fontSize: 14, fontWeight: "700", marginTop: 2 },
  actionButtonsContainer: { flexDirection: "column", gap: 8 },
  actionButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  productMeta: { marginTop: 10, padding: 10, borderRadius: 8 },
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 4,
    gap: 6,
  },
  metaLabel: { fontSize: 12 },
  metaValue: { fontSize: 12, fontWeight: "500", flex: 1 },
  quantitySection: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 10,
    gap: 10,
  },
  currentQuantity: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    gap: 6,
  },
  currentQuantityText: { color: "#FFF", fontSize: 14, fontWeight: "700" },
  quantityInput: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 14,
    textAlign: "center",
  },
  updateQuantityBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
  },
  deleteConfirmModal: {
    width: "100%",
    maxWidth: 320,
    borderRadius: 24,
    padding: 24,
    alignItems: "center",
    position: "relative",
  },
  modalCloseBtn: {
    position: "absolute",
    top: 12,
    right: 12,
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  deleteIconCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 16,
  },
  deleteConfirmText: {
    fontSize: 16,
    fontWeight: "600",
    textAlign: "center",
    marginBottom: 8,
  },
  deleteProductName: { fontSize: 14, textAlign: "center", marginBottom: 20 },
  confirmDeleteBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 24,
    gap: 8,
    minWidth: 120,
  },
  confirmDeleteBtnText: { color: "#FFF", fontSize: 16, fontWeight: "600" },
  variantBadge: {
    position: "absolute",
    top: -4,
    right: -4,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: "#8b5cf6",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 4,
  },
  variantBadgeText: { color: "#FFF", fontSize: 10, fontWeight: "700" },
  variantModal: {
    width: "100%",
    maxWidth: 560,
    borderRadius: 16,
    borderWidth: 1,
    padding: 20,
  },
  variantModalHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    marginBottom: 12,
  },
  variantModalTitle: { fontSize: 18, fontWeight: "700" },
  variantModalSubtitle: { fontSize: 12, marginTop: 2 },
  variantWarning: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: 1,
    borderRadius: 8,
    marginBottom: 8,
  },
  variantWarningText: { fontSize: 12, flex: 1, fontWeight: "600" },
  variantRowHead: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 8,
    borderBottomWidth: 1,
    gap: 6,
  },
  variantHeadCell: { fontSize: 12, fontWeight: "700" },
  variantRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 10,
    borderBottomWidth: 1,
    gap: 6,
  },
  variantInput: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 6,
    fontSize: 13,
  },
  variantMissing: { fontSize: 12, fontStyle: "italic" },
  variantActionBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 8,
    borderRadius: 8,
    gap: 4,
  },
  variantActionText: { color: "#FFF", fontSize: 12, fontWeight: "700" },
});


/* __ACCESS_GUARD_APPLIED__ */
export default function ProductsAdminGuarded(props: any) {
  return (
    <__AccessGuard__ scope="admin">
      <ProductsAdmin {...props} />
    </__AccessGuard__>
  );
}
