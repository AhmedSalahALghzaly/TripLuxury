/**
 * Notification History Log — Owner Panel
 * Shows a paginated, date-filterable list of all push alerts dispatched by the server.
 */
import React, { useState, useCallback, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  Modal,
  Platform,
  Image,
  TextInput,
  KeyboardAvoidingView,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { BlurView } from 'expo-blur';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import { useAppStore } from '../../src/store/appStore';
import {
  ORDER_STATUS_LABELS_AR,
  ORDER_STATUS_LABELS_EN,
  ORDER_STATUS_COLORS,
  asOrderStatus,
  isOrderStatus,
} from '../../src/constants/orderStatus';
import { pushLogApi, productApi, restaurantAnalyticsApi } from '../../src/services/api';
import { useWebSocketEvent, WSMessage } from '../../src/services/websocketService';
import { AccessGuard as __AccessGuard__ } from '../../src/components/AccessGuard';
import { useStatusToastQueue } from '../../src/hooks/shopping/useStatusToastQueue';
import { OrderStatusToastStack } from '../../src/components/shopping-hub/OrderStatusToastStack';

// ─── Types ────────────────────────────────────────────────────────────────────

interface PushLogEntry {
  id: string;
  event_type: string;
  title: string | null;
  body: string | null;
  title_en: string | null;
  title_ar: string | null;
  body_en: string | null;
  body_ar: string | null;
  payload: {
    order_id?: string;
    order_number?: string | number;
    restaurant_id?: string;
    product_id?: string;
    sku?: string;
    name?: string;
    name_ar?: string;
    image_url?: string | null;
    fitment_indicator?: string;
    stock?: number;
    threshold?: number;
    new_status?: string;
    previous_status?: string;
    [key: string]: unknown;
  };
  recipient_count: number;
  sent_at: string;
  acknowledged_at: string | null;
}

interface PushLogResponse {
  data: PushLogEntry[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    pages: number;
  };
}

// ─── Date helpers ─────────────────────────────────────────────────────────────

function startOfDay(d: Date) { const r = new Date(d); r.setHours(0,0,0,0); return r; }
function endOfDay(d: Date)   { const r = new Date(d); r.setHours(23,59,59,999); return r; }
function sameDay(a: Date, b: Date) { return a.toDateString() === b.toDateString(); }
function inRange(d: Date, start: Date, end: Date) { return d >= start && d <= end; }

const MONTHS_AR = ['يناير','فبراير','مارس','أبريل','مايو','يونيو','يوليو','أغسطس','سبتمبر','أكتوبر','نوفمبر','ديسمبر'];
const MONTHS_EN = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const DAYS_AR = ['أح','إث','ثل','أر','خم','جم','سب'];
const DAYS_EN = ['Su','Mo','Tu','We','Th','Fr','Sa'];

// ─── Calendar ─────────────────────────────────────────────────────────────────

function CalendarPicker({
  visible,
  isRTL,
  onClose,
  onConfirm,
  initialStart,
  initialEnd,
}: {
  visible: boolean;
  isRTL: boolean;
  onClose: () => void;
  onConfirm: (start: Date | null, end: Date | null) => void;
  initialStart: Date | null;
  initialEnd: Date | null;
}) {
  const today = new Date();
  const [viewYear, setViewYear]   = useState(today.getFullYear());
  const [viewMonth, setViewMonth] = useState(today.getMonth());
  const [start, setStart]         = useState<Date | null>(initialStart);
  const [end, setEnd]             = useState<Date | null>(initialEnd);
  const [pickingEnd, setPickingEnd] = useState(false);

  const daysInGrid = React.useMemo(() => {
    const firstDay = new Date(viewYear, viewMonth, 1).getDay();
    const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
    const grid: (Date | null)[] = Array(firstDay).fill(null);
    for (let d = 1; d <= daysInMonth; d++) grid.push(new Date(viewYear, viewMonth, d));
    while (grid.length % 7 !== 0) grid.push(null);
    return grid;
  }, [viewYear, viewMonth]);

  const handleDay = (day: Date) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (!start || (!pickingEnd && end !== null)) {
      setStart(startOfDay(day)); setEnd(null); setPickingEnd(true);
    } else if (pickingEnd) {
      if (day < start) { setStart(startOfDay(day)); setEnd(null); }
      else { setEnd(endOfDay(day)); setPickingEnd(false); }
    } else {
      setStart(startOfDay(day)); setEnd(null); setPickingEnd(true);
    }
  };

  const setPreset = (preset: 'today' | 'week' | 'month') => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const now = new Date();
    if (preset === 'today') {
      setStart(startOfDay(now)); setEnd(endOfDay(now));
    } else if (preset === 'week') {
      const s = new Date(now); s.setDate(now.getDate() - now.getDay());
      setStart(startOfDay(s)); setEnd(endOfDay(now));
    } else {
      setStart(new Date(now.getFullYear(), now.getMonth(), 1)); setEnd(endOfDay(now));
    }
    setPickingEnd(false);
    setViewYear(now.getFullYear()); setViewMonth(now.getMonth());
  };

  const handleConfirm = () => {
    onConfirm(start, start ? (end ?? endOfDay(start)) : null);
    onClose();
  };

  return (
    <Modal transparent visible={visible} animationType="fade" onRequestClose={onClose}>
      <TouchableOpacity style={cal.backdrop} activeOpacity={1} onPress={onClose}>
        <BlurView intensity={30} tint="dark" style={StyleSheet.absoluteFill} />
      </TouchableOpacity>
      <View style={cal.sheet}>
        <View style={cal.header}>
          <Text style={cal.title}>{isRTL ? 'تصفية بالتاريخ' : 'Filter by Date'}</Text>
          <TouchableOpacity onPress={onClose} style={cal.closeBtn}>
            <Ionicons name="close" size={20} color="#6B7280" />
          </TouchableOpacity>
        </View>

        <View style={cal.presets}>
          {[
            { key: 'today', ar: 'اليوم',      en: 'Today' },
            { key: 'week',  ar: 'هذا الأسبوع', en: 'This Week' },
            { key: 'month', ar: 'هذا الشهر',  en: 'This Month' },
          ].map(p => (
            <TouchableOpacity key={p.key} style={cal.preset} onPress={() => setPreset(p.key as any)}>
              <Text style={cal.presetText}>{isRTL ? p.ar : p.en}</Text>
            </TouchableOpacity>
          ))}
          <TouchableOpacity style={[cal.preset, { backgroundColor: '#FEE2E2' }]}
            onPress={() => { setStart(null); setEnd(null); setPickingEnd(false); }}>
            <Text style={[cal.presetText, { color: '#EF4444' }]}>{isRTL ? 'مسح' : 'Clear'}</Text>
          </TouchableOpacity>
        </View>

        <View style={cal.monthNav}>
          <TouchableOpacity style={cal.navBtn} onPress={() => {
            if (viewMonth === 0) { setViewMonth(11); setViewYear(y => y - 1); }
            else setViewMonth(m => m - 1);
          }}>
            <Ionicons name="chevron-back" size={18} color="#374151" />
          </TouchableOpacity>
          <Text style={cal.monthLabel}>
            {isRTL ? MONTHS_AR[viewMonth] : MONTHS_EN[viewMonth]} {viewYear}
          </Text>
          <TouchableOpacity style={cal.navBtn} onPress={() => {
            if (viewMonth === 11) { setViewMonth(0); setViewYear(y => y + 1); }
            else setViewMonth(m => m + 1);
          }}>
            <Ionicons name="chevron-forward" size={18} color="#374151" />
          </TouchableOpacity>
        </View>

        <View style={cal.weekRow}>
          {(isRTL ? DAYS_AR : DAYS_EN).map((d, i) => (
            <Text key={i} style={cal.weekDay}>{d}</Text>
          ))}
        </View>

        <View style={cal.grid}>
          {daysInGrid.map((day, idx) => {
            if (!day) return <View key={`e-${idx}`} style={cal.cell} />;
            const isSt = !!(start && sameDay(day, start));
            const isEn = !!(end && sameDay(day, end));
            const isMid = !!(start && end && inRange(day, start, end) && !isSt && !isEn);
            const isToday = sameDay(day, today);
            const sel = isSt || isEn;
            return (
              <TouchableOpacity key={day.toISOString()} style={[cal.cell, isMid && cal.cellMid, sel && cal.cellSel]}
                onPress={() => handleDay(day)} activeOpacity={0.7}>
                <View style={[cal.inner, sel && cal.innerSel]}>
                  <Text style={[cal.dayTxt, isToday && cal.todayTxt, sel && cal.selTxt, isMid && cal.midTxt]}>
                    {day.getDate()}
                  </Text>
                  {isToday && !sel && <View style={cal.dot} />}
                </View>
              </TouchableOpacity>
            );
          })}
        </View>

        {start && (
          <Text style={cal.rangeLabel}>
            {start.toLocaleDateString(isRTL ? 'ar-EG' : 'en-US', { day: 'numeric', month: 'short' })}
            {' → '}
            {end
              ? end.toLocaleDateString(isRTL ? 'ar-EG' : 'en-US', { day: 'numeric', month: 'short' })
              : (isRTL ? 'اختر نهاية' : 'pick end')}
          </Text>
        )}

        <View style={cal.actions}>
          <TouchableOpacity style={cal.cancelBtn} onPress={onClose}>
            <Text style={cal.cancelTxt}>{isRTL ? 'إلغاء' : 'Cancel'}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={cal.confirmBtn} onPress={handleConfirm}>
            <LinearGradient colors={['#6366F1', '#8B5CF6']} style={cal.confirmGrad}>
              <Ionicons name="checkmark" size={16} color="#FFF" />
              <Text style={cal.confirmTxt}>{isRTL ? 'تأكيد' : 'Confirm'}</Text>
            </LinearGradient>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

// ─── Bulk Restock Sheet ────────────────────────────────────────────────────────

interface BulkRestockItem {
  entryId: string;
  productId: string;
  productName: string;
  currentStock: number;
  qty: string;
}

function BulkRestockSheet({
  visible,
  isRTL,
  items,
  onClose,
  onSubmit,
  isPending,
}: {
  visible: boolean;
  isRTL: boolean;
  items: BulkRestockItem[];
  onClose: () => void;
  onSubmit: (updates: { productId: string; qty: number }[]) => void;
  isPending: boolean;
}) {
  const [qtys, setQtys] = useState<Record<string, string>>({});

  useEffect(() => {
    if (visible) {
      const initial: Record<string, string> = {};
      items.forEach(it => { initial[it.productId] = String(it.currentStock); });
      setQtys(initial);
    }
  }, [visible, items]);

  if (items.length === 0) return null;

  const allValid = items.every(it => {
    const v = parseInt(qtys[it.productId] ?? '', 10);
    return !isNaN(v) && v >= 0;
  });

  const handleSubmit = () => {
    if (!allValid || isPending) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const updates = items.map(it => ({
      productId: it.productId,
      qty: parseInt(qtys[it.productId] ?? '0', 10),
    }));
    onSubmit(updates);
  };

  return (
    <Modal
      transparent
      visible={visible}
      animationType="slide"
      onRequestClose={onClose}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={brs.kav}
      >
        <TouchableOpacity style={brs.backdrop} activeOpacity={1} onPress={onClose}>
          <BlurView intensity={30} tint="dark" style={StyleSheet.absoluteFill} />
        </TouchableOpacity>

        <View style={brs.sheet}>
          <View style={brs.handle} />

          <View style={brs.sheetHeader}>
            <View style={brs.sheetIconWrap}>
              <Ionicons name="layers-outline" size={22} color="#6366F1" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={brs.sheetTitle}>
                {isRTL ? 'إعادة تخزين متعددة' : 'Bulk Restock'}
              </Text>
              <Text style={brs.sheetSub}>
                {isRTL
                  ? `${items.length} منتجات محددة`
                  : `${items.length} products selected`}
              </Text>
            </View>
            <TouchableOpacity onPress={onClose} style={brs.closeBtn} activeOpacity={0.7}>
              <Ionicons name="close" size={20} color="#6B7280" />
            </TouchableOpacity>
          </View>

          <ScrollView
            style={brs.scroll}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            {items.map((item, idx) => {
              const rawQty = qtys[item.productId] ?? String(item.currentStock);
              const parsed = parseInt(rawQty, 10);
              const isValid = !isNaN(parsed) && parsed >= 0;
              const isLast = idx === items.length - 1;
              return (
                <View key={item.productId} style={[brs.itemRow, isLast && brs.itemRowLast]}>
                  <View style={brs.itemLeft}>
                    <View style={brs.itemIconWrap}>
                      <Ionicons name="cube-outline" size={16} color="#6366F1" />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={brs.itemName} numberOfLines={2}>{item.productName}</Text>
                      <Text style={brs.itemCurrent}>
                        {isRTL ? `المخزون الحالي: ${item.currentStock}` : `Current: ${item.currentStock}`}
                      </Text>
                    </View>
                  </View>
                  <TextInput
                    style={[brs.itemInput, !isValid && rawQty.length > 0 && brs.itemInputError]}
                    value={rawQty}
                    onChangeText={v => setQtys(prev => ({ ...prev, [item.productId]: v }))}
                    keyboardType="numeric"
                    returnKeyType="done"
                    placeholder="0"
                    placeholderTextColor="#9CA3AF"
                    textAlign="center"
                    editable={!isPending}
                  />
                </View>
              );
            })}
            <View style={{ height: 8 }} />
          </ScrollView>

          <View style={brs.sheetActions}>
            <TouchableOpacity style={brs.cancelBtn} onPress={onClose} activeOpacity={0.7}>
              <Text style={brs.cancelTxt}>{isRTL ? 'إلغاء' : 'Cancel'}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[brs.submitBtn, (!allValid || isPending) && brs.submitBtnDisabled]}
              onPress={handleSubmit}
              activeOpacity={0.7}
              disabled={!allValid || isPending}
            >
              <LinearGradient colors={['#6366F1', '#8B5CF6']} style={brs.submitGrad}>
                {isPending ? (
                  <ActivityIndicator size="small" color="#FFF" />
                ) : (
                  <>
                    <Ionicons name="checkmark-done" size={16} color="#FFF" />
                    <Text style={brs.submitTxt}>
                      {isRTL ? 'تحديث الكل' : 'Restock All'}
                    </Text>
                  </>
                )}
              </LinearGradient>
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ─── Quick Restock Sheet ───────────────────────────────────────────────────────

interface RestockTarget {
  productId: string;
  productName: string;
  currentStock: number;
}

function QuickRestockSheet({
  visible,
  isRTL,
  target,
  onClose,
  onSubmit,
  isPending,
}: {
  visible: boolean;
  isRTL: boolean;
  target: RestockTarget | null;
  onClose: () => void;
  onSubmit: (productId: string, newQty: number) => void;
  isPending: boolean;
}) {
  const [qty, setQty] = useState('');
  const inputRef = useRef<TextInput>(null);

  useEffect(() => {
    if (visible) {
      setQty(target ? String(target.currentStock) : '');
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [visible, target]);

  if (!target) return null;

  const parsed = parseInt(qty, 10);
  const isValid = !isNaN(parsed) && parsed >= 0;

  const handleSubmit = () => {
    if (!isValid || isPending) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    onSubmit(target.productId, parsed);
  };

  return (
    <Modal
      transparent
      visible={visible}
      animationType="slide"
      onRequestClose={onClose}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={rs.kav}
      >
        <TouchableOpacity style={rs.backdrop} activeOpacity={1} onPress={onClose}>
          <BlurView intensity={30} tint="dark" style={StyleSheet.absoluteFill} />
        </TouchableOpacity>

        <View style={rs.sheet}>
          {/* Handle */}
          <View style={rs.handle} />

          {/* Header */}
          <View style={rs.sheetHeader}>
            <View style={rs.sheetIconWrap}>
              <Ionicons name="layers-outline" size={22} color="#6366F1" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={rs.sheetTitle}>{isRTL ? 'إعادة التخزين السريع' : 'Quick Restock'}</Text>
              <Text style={rs.sheetProductName} numberOfLines={1}>{target.productName}</Text>
            </View>
            <TouchableOpacity onPress={onClose} style={rs.closeBtn} activeOpacity={0.7}>
              <Ionicons name="close" size={20} color="#6B7280" />
            </TouchableOpacity>
          </View>

          {/* Current stock row */}
          <View style={rs.currentRow}>
            <Text style={rs.currentLabel}>{isRTL ? 'المخزون الحالي' : 'Current Stock'}</Text>
            <View style={rs.currentBadge}>
              <Text style={[
                rs.currentValue,
                target.currentStock === 0 ? rs.currentValueRed : rs.currentValueAmber,
              ]}>
                {target.currentStock}
              </Text>
            </View>
          </View>

          {/* Input */}
          <View style={rs.inputSection}>
            <Text style={rs.inputLabel}>{isRTL ? 'الكمية الجديدة' : 'New Quantity'}</Text>
            <TextInput
              ref={inputRef}
              style={[rs.input, !isValid && qty.length > 0 && rs.inputError]}
              value={qty}
              onChangeText={setQty}
              keyboardType="numeric"
              returnKeyType="done"
              onSubmitEditing={handleSubmit}
              placeholder="0"
              placeholderTextColor="#9CA3AF"
              textAlign={isRTL ? 'right' : 'left'}
              editable={!isPending}
            />
            {!isValid && qty.length > 0 && (
              <Text style={rs.errorHint}>
                {isRTL ? 'أدخل رقمًا صحيحًا غير سالب' : 'Enter a valid non-negative number'}
              </Text>
            )}
          </View>

          {/* Actions */}
          <View style={rs.sheetActions}>
            <TouchableOpacity style={rs.cancelBtn} onPress={onClose} activeOpacity={0.7}>
              <Text style={rs.cancelTxt}>{isRTL ? 'إلغاء' : 'Cancel'}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[rs.submitBtn, (!isValid || isPending) && rs.submitBtnDisabled]}
              onPress={handleSubmit}
              activeOpacity={0.7}
              disabled={!isValid || isPending}
            >
              <LinearGradient
                colors={['#6366F1', '#8B5CF6']}
                style={rs.submitGrad}
              >
                {isPending ? (
                  <ActivityIndicator size="small" color="#FFF" />
                ) : (
                  <>
                    <Ionicons name="checkmark" size={16} color="#FFF" />
                    <Text style={rs.submitTxt}>{isRTL ? 'حفظ' : 'Save'}</Text>
                  </>
                )}
              </LinearGradient>
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ─── Product Detail Sheet ─────────────────────────────────────────────────────

interface ProductDetail {
  id: string;
  name: string;
  name_ar: string | null;
  sku: string | null;
  price: number | null;
  stock_quantity: number;
  stock_threshold: number | null;
  image_url: string | null;
  images: string[] | null;
  fitment_indicator: string | null;
}

interface StockHistoryEntry {
  id: string;
  old_quantity: number;
  new_quantity: number;
  source: string;
  changed_at: string;
  changed_by_name: string | null;
  changed_by_user_name: string | null;
}

function ProductDetailSheet({
  visible,
  productId,
  isRTL,
  onClose,
}: {
  visible: boolean;
  productId: string | null;
  isRTL: boolean;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [stockInput, setStockInput] = useState('');
  const [editingStock, setEditingStock] = useState(false);
  const [historyExpanded, setHistoryExpanded] = useState(false);
  const stockInputRef = useRef<TextInput>(null);

  const { data: product, isLoading, isError } = useQuery<ProductDetail>({
    queryKey: ['product-detail', productId],
    queryFn: () => productApi.getById(productId!).then(r => r.data as ProductDetail),
    enabled: visible && !!productId,
    staleTime: 30_000,
  });

  const { data: stockHistory, isLoading: historyLoading } = useQuery<StockHistoryEntry[]>({
    queryKey: ['stock-history', productId],
    queryFn: () => productApi.getStockHistory(productId!, { limit: 20 }).then(r => r.data as StockHistoryEntry[]),
    enabled: visible && !!productId && historyExpanded,
    staleTime: 30_000,
  });

  useEffect(() => {
    if (product) {
      setStockInput(String(product.stock_quantity ?? 0));
      setEditingStock(false);
    }
  }, [product]);

  const stockMutation = useMutation({
    mutationFn: ({ id, qty }: { id: string; qty: number }) =>
      productApi.updateStock(id, qty).then(r => r.data as { id: string; stock_quantity: number }),
    onSuccess: (result) => {
      queryClient.setQueryData<ProductDetail>(['product-detail', productId], (old) =>
        old ? { ...old, stock_quantity: result.stock_quantity } : old,
      );
      queryClient.invalidateQueries({ queryKey: ['push-log'], exact: false });
      queryClient.invalidateQueries({ queryKey: ['stock-history', productId] });
      setEditingStock(false);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    },
  });

  const parsed = parseInt(stockInput, 10);
  const isValidStock = !isNaN(parsed) && parsed >= 0;
  const stockChanged = product && parsed !== product.stock_quantity;

  const handleSaveStock = () => {
    if (!isValidStock || !product || stockMutation.isPending) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    stockMutation.mutate({ id: product.id, qty: parsed });
  };

  const currentStock = product?.stock_quantity ?? 0;
  const isOutOfStock = currentStock === 0;
  const isLowStock = !isOutOfStock && currentStock <= (product?.stock_threshold ?? 5);

  const stockColor = isOutOfStock ? '#DC2626' : isLowStock ? '#D97706' : '#059669';

  const displayName = isRTL && product?.name_ar ? product.name_ar : (product?.name ?? '');
  const imageUrl = product?.image_url ?? (product?.images?.[0] ?? null);

  return (
    <Modal
      transparent
      visible={visible}
      animationType="slide"
      onRequestClose={onClose}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={pd.kav}
      >
        <TouchableOpacity style={pd.backdrop} activeOpacity={1} onPress={onClose}>
          <BlurView intensity={30} tint="dark" style={StyleSheet.absoluteFill} />
        </TouchableOpacity>

        <View style={pd.sheet}>
          <View style={pd.handle} />

          {/* Header */}
          <View style={pd.sheetHeader}>
            <View style={pd.iconWrap}>
              <Ionicons name="cube-outline" size={22} color="#6366F1" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={pd.sheetTitle}>
                {isRTL ? 'تفاصيل المنتج' : 'Product Details'}
              </Text>
              {product?.sku ? (
                <Text style={pd.skuLabel}>SKU: {product.sku}</Text>
              ) : null}
            </View>
            <TouchableOpacity onPress={onClose} style={pd.closeBtn} activeOpacity={0.7}>
              <Ionicons name="close" size={20} color="#6B7280" />
            </TouchableOpacity>
          </View>

          {isLoading ? (
            <View style={pd.center}>
              <ActivityIndicator size="large" color="#6366F1" />
              <Text style={pd.loadingText}>
                {isRTL ? 'جاري التحميل...' : 'Loading...'}
              </Text>
            </View>
          ) : isError || !product ? (
            <View style={pd.center}>
              <Ionicons name="warning-outline" size={40} color="#EF4444" />
              <Text style={pd.errorText}>
                {isRTL ? 'تعذّر تحميل المنتج' : 'Failed to load product'}
              </Text>
            </View>
          ) : (
            <>
              {/* Product identity row */}
              <View style={pd.productRow}>
                <View style={pd.thumb}>
                  {imageUrl ? (
                    <Image source={{ uri: imageUrl }} style={pd.thumbImg} resizeMode="cover" />
                  ) : (
                    <Text style={pd.thumbInitial}>
                      {displayName.charAt(0).toUpperCase() || '?'}
                    </Text>
                  )}
                </View>
                <View style={{ flex: 1, gap: 3 }}>
                  <Text style={pd.productName} numberOfLines={2}>{displayName}</Text>
                  {product.name_ar && !isRTL && (
                    <Text style={pd.productNameAlt} numberOfLines={1}>{product.name_ar}</Text>
                  )}
                  {product.name && isRTL && (
                    <Text style={pd.productNameAlt} numberOfLines={1}>{product.name}</Text>
                  )}
                  {product.fitment_indicator ? (
                    <Text style={pd.fitment}>{product.fitment_indicator}</Text>
                  ) : null}
                  {product.price != null ? (
                    <Text style={pd.price}>
                      {isRTL ? `${Number(product.price).toFixed(2)} ج.م` : `EGP ${Number(product.price).toFixed(2)}`}
                    </Text>
                  ) : null}
                </View>
              </View>

              {/* Stock section */}
              <View style={pd.stockSection}>
                <View style={pd.stockHeader}>
                  <Text style={pd.stockSectionTitle}>
                    {isRTL ? 'المخزون الحالي' : 'Current Stock'}
                  </Text>
                  <TouchableOpacity
                    style={pd.editStockBtn}
                    onPress={() => {
                      setEditingStock(true);
                      setTimeout(() => stockInputRef.current?.focus(), 80);
                    }}
                    activeOpacity={0.7}
                  >
                    <Ionicons name="pencil-outline" size={13} color="#6366F1" />
                    <Text style={pd.editStockBtnText}>
                      {isRTL ? 'تعديل' : 'Edit'}
                    </Text>
                  </TouchableOpacity>
                </View>

                <View style={pd.stockValueRow}>
                  <View style={[pd.stockBadge, { backgroundColor: stockColor + '18', borderColor: stockColor + '40' }]}>
                    <Text style={[pd.stockValue, { color: stockColor }]}>{currentStock}</Text>
                    <Text style={[pd.stockUnit, { color: stockColor }]}>
                      {isRTL ? 'وحدة' : 'units'}
                    </Text>
                  </View>
                  {isOutOfStock && (
                    <View style={pd.stockAlertBadge}>
                      <Text style={pd.stockAlertText}>{isRTL ? 'نفذ المخزون' : 'Out of Stock'}</Text>
                    </View>
                  )}
                  {isLowStock && (
                    <View style={[pd.stockAlertBadge, pd.stockAlertAmber]}>
                      <Text style={[pd.stockAlertText, pd.stockAlertTextAmber]}>
                        {isRTL ? 'مخزون منخفض' : 'Low Stock'}
                      </Text>
                    </View>
                  )}
                </View>

                {editingStock && (
                  <View style={pd.stockEditArea}>
                    <Text style={pd.inputLabel}>{isRTL ? 'الكمية الجديدة' : 'New Quantity'}</Text>
                    <TextInput
                      ref={stockInputRef}
                      style={[pd.stockInput, !isValidStock && stockInput.length > 0 && pd.stockInputError]}
                      value={stockInput}
                      onChangeText={setStockInput}
                      keyboardType="numeric"
                      returnKeyType="done"
                      onSubmitEditing={handleSaveStock}
                      placeholder="0"
                      placeholderTextColor="#9CA3AF"
                      textAlign={isRTL ? 'right' : 'left'}
                      editable={!stockMutation.isPending}
                    />
                    {!isValidStock && stockInput.length > 0 && (
                      <Text style={pd.errorHint}>
                        {isRTL ? 'أدخل رقمًا صحيحًا غير سالب' : 'Enter a valid non-negative number'}
                      </Text>
                    )}
                    <View style={pd.stockEditActions}>
                      <TouchableOpacity
                        style={pd.cancelEditBtn}
                        onPress={() => {
                          setEditingStock(false);
                          setStockInput(String(product.stock_quantity ?? 0));
                        }}
                        activeOpacity={0.7}
                      >
                        <Text style={pd.cancelEditText}>{isRTL ? 'إلغاء' : 'Cancel'}</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[
                          pd.saveStockBtn,
                          (!isValidStock || !stockChanged || stockMutation.isPending) && pd.saveStockBtnDisabled,
                        ]}
                        onPress={handleSaveStock}
                        activeOpacity={0.7}
                        disabled={!isValidStock || !stockChanged || stockMutation.isPending}
                      >
                        <LinearGradient colors={['#6366F1', '#8B5CF6']} style={pd.saveStockGrad}>
                          {stockMutation.isPending ? (
                            <ActivityIndicator size="small" color="#FFF" />
                          ) : (
                            <>
                              <Ionicons name="checkmark" size={15} color="#FFF" />
                              <Text style={pd.saveStockText}>{isRTL ? 'حفظ' : 'Save'}</Text>
                            </>
                          )}
                        </LinearGradient>
                      </TouchableOpacity>
                    </View>
                  </View>
                )}
              </View>

              {stockMutation.isSuccess && (
                <View style={pd.successRow}>
                  <Ionicons name="checkmark-circle" size={16} color="#10B981" />
                  <Text style={pd.successText}>
                    {isRTL ? 'تم تحديث المخزون بنجاح' : 'Stock updated successfully'}
                  </Text>
                </View>
              )}

              {stockMutation.isError && (
                <View style={pd.errorRow}>
                  <Ionicons name="alert-circle" size={16} color="#EF4444" />
                  <Text style={pd.errorRowText}>
                    {isRTL ? 'تعذّر تحديث المخزون' : 'Failed to update stock'}
                  </Text>
                </View>
              )}

              {/* Stock History Section */}
              <TouchableOpacity
                style={pd.historyToggle}
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  setHistoryExpanded(v => !v);
                }}
                activeOpacity={0.7}
              >
                <View style={pd.historyToggleLeft}>
                  <Ionicons name="time-outline" size={15} color="#6366F1" />
                  <Text style={pd.historyToggleText}>
                    {isRTL ? 'سجل التغييرات' : 'Change History'}
                  </Text>
                </View>
                <Ionicons
                  name={historyExpanded ? 'chevron-up' : 'chevron-down'}
                  size={16}
                  color="#9CA3AF"
                />
              </TouchableOpacity>

              {historyExpanded && (
                <View style={pd.historyContainer}>
                  {historyLoading ? (
                    <View style={pd.historyEmpty}>
                      <ActivityIndicator size="small" color="#6366F1" />
                    </View>
                  ) : !stockHistory || stockHistory.length === 0 ? (
                    <View style={pd.historyEmpty}>
                      <Ionicons name="document-outline" size={24} color="#D1D5DB" />
                      <Text style={pd.historyEmptyText}>
                        {isRTL ? 'لا توجد تغييرات مسجّلة' : 'No changes recorded yet'}
                      </Text>
                    </View>
                  ) : (
                    <ScrollView style={pd.historyScroll} nestedScrollEnabled>
                      {stockHistory.map((entry, idx) => {
                        const isIncrease = entry.new_quantity > entry.old_quantity;
                        const delta = entry.new_quantity - entry.old_quantity;
                        const deltaColor = isIncrease ? '#059669' : '#DC2626';
                        const deltaLabel = isIncrease ? `+${delta}` : String(delta);
                        const dateStr = new Date(entry.changed_at).toLocaleDateString(
                          isRTL ? 'ar-EG' : 'en-US',
                          { day: 'numeric', month: 'short', year: 'numeric' },
                        );
                        const timeStr = new Date(entry.changed_at).toLocaleTimeString(
                          isRTL ? 'ar-EG' : 'en-US',
                          { hour: '2-digit', minute: '2-digit' },
                        );
                        const actor = entry.changed_by_user_name ?? entry.changed_by_name ?? (isRTL ? 'النظام' : 'System');
                        const isLast = idx === stockHistory.length - 1;
                        return (
                          <View key={entry.id} style={[pd.historyRow, isLast && pd.historyRowLast]}>
                            <View style={[pd.historyDot, { backgroundColor: deltaColor }]} />
                            <View style={pd.historyRowContent}>
                              <View style={pd.historyRowTop}>
                                <View style={pd.historyQtyRow}>
                                  <Text style={pd.historyQtyOld}>{entry.old_quantity}</Text>
                                  <Ionicons name="arrow-forward" size={11} color="#9CA3AF" />
                                  <Text style={pd.historyQtyNew}>{entry.new_quantity}</Text>
                                  <View style={[pd.historyDeltaBadge, { backgroundColor: deltaColor + '18' }]}>
                                    <Text style={[pd.historyDeltaText, { color: deltaColor }]}>{deltaLabel}</Text>
                                  </View>
                                </View>
                                <Text style={pd.historyTime}>{dateStr} · {timeStr}</Text>
                              </View>
                              <Text style={pd.historyActor} numberOfLines={1}>{actor}</Text>
                            </View>
                          </View>
                        );
                      })}
                    </ScrollView>
                  )}
                </View>
              )}
            </>
          )}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ─── Badge helpers ────────────────────────────────────────────────────────────

function getTypeLabel(eventType: string, isRTL: boolean): string {
  if (eventType === 'new_order')    return isRTL ? 'طلب جديد'       : 'New Order';
  if (eventType === 'order_updated') return isRTL ? 'تحديث الطلب'   : 'Order Update';
  if (eventType === 'low_stock')    return isRTL ? 'مخزون منخفض'    : 'Low Stock';
  if (eventType === 'out_of_stock') return isRTL ? 'نفذ المخزون'    : 'Out of Stock';
  return eventType;
}

function getTypeBadgeStyle(eventType: string): { backgroundColor: string } {
  if (eventType === 'low_stock')     return { backgroundColor: '#FEF3C7' };
  if (eventType === 'out_of_stock')  return { backgroundColor: '#FEE2E2' };
  if (eventType === 'order_updated') return { backgroundColor: '#F0FDF4' };
  return { backgroundColor: '#EEF2FF' };
}

function getTypeTextStyle(eventType: string): { color: string } {
  if (eventType === 'low_stock')     return { color: '#92400E' };
  if (eventType === 'out_of_stock')  return { color: '#991B1B' };
  if (eventType === 'order_updated') return { color: '#059669' };
  return { color: '#6366F1' };
}

// ─── Log Entry Card ───────────────────────────────────────────────────────────

// Small stateful thumb that falls back to the branded initial placeholder if
// the image URL is missing, malformed, or the network/Image load fails. This
// prevents broken-icon glyphs from ever surfacing on the notification log.
function StockThumb({ url, fallback }: { url?: string | null; fallback: React.ReactNode }) {
  const [errored, setErrored] = useState(false);
  const isValid = !!url && /^https?:\/\//i.test(url);
  if (!isValid || errored) return <>{fallback}</>;
  return (
    <Image
      source={{ uri: url! }}
      style={s.stockThumbImg}
      resizeMode="cover"
      onError={() => setErrored(true)}
    />
  );
}

function LogCard({ entry, isRTL, onOrderPress, onProductPress, onAcknowledge, onQuickRestock, isMultiSelect, isSelected, onToggleSelect, onEnterMultiSelect }: {
  entry: PushLogEntry;
  isRTL: boolean;
  onOrderPress: (orderId: string, orderNumber?: string | number) => void;
  onProductPress: (productId: string) => void;
  onAcknowledge: (id: string) => void;
  onQuickRestock: (productId: string, currentStock: number, productName: string) => void;
  isMultiSelect: boolean;
  isSelected: boolean;
  onToggleSelect: (id: string) => void;
  onEnterMultiSelect: (id: string) => void;
}) {
  const sentAt = new Date(entry.sent_at);
  const dateStr = sentAt.toLocaleDateString(isRTL ? 'ar-EG' : 'en-US', {
    day: 'numeric', month: 'short', year: 'numeric',
  });
  const timeStr = sentAt.toLocaleTimeString(isRTL ? 'ar-EG' : 'en-US', {
    hour: '2-digit', minute: '2-digit',
  });

  const orderNumber = entry.payload?.order_number;
  const orderId = entry.payload?.order_id;
  const isUnread = !entry.acknowledged_at;

  const isStockAlert = entry.event_type === 'low_stock' || entry.event_type === 'out_of_stock';
  const stockPayload = isStockAlert ? entry.payload : null;

  const handlePress = () => {
    if (isMultiSelect && isStockAlert) {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      onToggleSelect(entry.id);
    }
  };

  const handleLongPress = () => {
    if (isStockAlert && !isMultiSelect) {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      onEnterMultiSelect(entry.id);
    } else if (!isStockAlert && isUnread && !isMultiSelect) {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      onAcknowledge(entry.id);
    }
  };

  return (
    <TouchableOpacity
      onPress={handlePress}
      onLongPress={handleLongPress}
      activeOpacity={isMultiSelect && isStockAlert ? 0.7 : 0.85}
      delayLongPress={400}
    >
      <View style={[s.card, isUnread && s.cardUnread]}>
        <BlurView intensity={12} tint="light" style={s.cardBlur}>
          {isUnread && !isSelected && <View style={s.unreadDot} />}
          <View style={s.cardHeader}>
            {isMultiSelect && isStockAlert ? (
              <View style={[s.checkbox, isSelected && s.checkboxSelected]}>
                {isSelected && <Ionicons name="checkmark" size={14} color="#FFF" />}
              </View>
            ) : (
              <View style={[s.iconCircle, isUnread && s.iconCircleUnread]}>
                <Ionicons name="notifications" size={18} color={isUnread ? '#6366F1' : '#9CA3AF'} />
              </View>
            )}
            <View style={s.cardMeta}>
              <Text style={[s.cardTitle, isUnread && s.cardTitleUnread]} numberOfLines={1}>
                {(isRTL ? (entry.title_ar ?? entry.title) : (entry.title_en ?? entry.title)) ?? (isRTL ? 'تنبيه' : 'Alert')}
              </Text>
              <Text style={s.cardTime}>{dateStr} · {timeStr}</Text>
            </View>
            <View style={s.rightBadges}>
              {isUnread ? (
                <View style={s.newBadge}>
                  <Text style={s.newBadgeText}>{isRTL ? 'جديد' : 'New'}</Text>
                </View>
              ) : (
                <Ionicons name="checkmark-circle" size={16} color="#10B981" />
              )}
              <View style={s.recipientBadge}>
                <Ionicons name="people" size={12} color="#6B7280" />
                <Text style={s.recipientCount}>{entry.recipient_count}</Text>
              </View>
            </View>
          </View>

          {/* Bilingual body: show both EN and AR variants when available */}
          {(entry.body_en || entry.body_ar || entry.body) ? (
            <View style={s.bilingualBody}>
              {(entry.body_en || (!entry.body_ar && entry.body)) ? (
                <View style={s.bilingualRow}>
                  <Text style={s.bilingualLang}>EN</Text>
                  <Text style={s.cardBody} numberOfLines={2}>
                    {entry.body_en ?? entry.body}
                  </Text>
                </View>
              ) : null}
              {entry.body_ar ? (
                <View style={[s.bilingualRow, s.bilingualRowAr]}>
                  <Text style={[s.bilingualLang, s.bilingualLangAr]}>ع</Text>
                  <Text style={[s.cardBody, s.cardBodyAr]} numberOfLines={2}>
                    {entry.body_ar}
                  </Text>
                </View>
              ) : null}
            </View>
          ) : null}

          {/* Bilingual order-status chip — shown for order_updated entries */}
          {entry.event_type === 'order_updated' && entry.payload?.new_status ? (() => {
            const newStatus = asOrderStatus(entry.payload.new_status!);
            const prevStatus = isOrderStatus(entry.payload.previous_status) ? entry.payload.previous_status : undefined;
            const statusColor = ORDER_STATUS_COLORS[newStatus] ?? '#6B7280';
            const labelEN = ORDER_STATUS_LABELS_EN[newStatus] ?? newStatus;
            const labelAR = ORDER_STATUS_LABELS_AR[newStatus] ?? newStatus;
            const prevLabelEN = prevStatus ? (ORDER_STATUS_LABELS_EN[prevStatus] ?? prevStatus) : null;
            const prevLabelAR = prevStatus ? (ORDER_STATUS_LABELS_AR[prevStatus] ?? prevStatus) : null;
            return (
              <View style={[s.statusChipRow, { borderColor: statusColor + '40' }]}>
                {prevStatus && prevLabelEN && prevLabelAR ? (
                  <>
                    <View style={[s.statusChip, { backgroundColor: '#F3F4F6' }]}>
                      <Text style={[s.statusChipLangTag, { color: '#9CA3AF' }]}>EN</Text>
                      <Text style={[s.statusChipText, { color: '#6B7280' }]}>{prevLabelEN}</Text>
                    </View>
                    <Ionicons name="arrow-forward" size={12} color={statusColor} style={{ marginHorizontal: 4 }} />
                    <View style={[s.statusChip, { backgroundColor: statusColor + '18' }]}>
                      <Text style={[s.statusChipLangTag, { color: statusColor }]}>EN</Text>
                      <Text style={[s.statusChipText, { color: statusColor, fontWeight: '700' }]}>{labelEN}</Text>
                    </View>
                    <View style={s.statusChipDivider} />
                    <View style={[s.statusChip, { backgroundColor: '#F3F4F6' }]}>
                      <Text style={[s.statusChipLangTag, { color: '#9CA3AF' }]}>ع</Text>
                      <Text style={[s.statusChipText, { color: '#6B7280' }]}>{prevLabelAR}</Text>
                    </View>
                    <Ionicons name="arrow-back" size={12} color={statusColor} style={{ marginHorizontal: 4 }} />
                    <View style={[s.statusChip, { backgroundColor: statusColor + '18' }]}>
                      <Text style={[s.statusChipLangTag, { color: statusColor }]}>ع</Text>
                      <Text style={[s.statusChipText, { color: statusColor, fontWeight: '700' }]}>{labelAR}</Text>
                    </View>
                  </>
                ) : (
                  <>
                    <View style={[s.statusChip, { backgroundColor: statusColor + '18' }]}>
                      <Text style={[s.statusChipLangTag, { color: statusColor }]}>EN</Text>
                      <Text style={[s.statusChipText, { color: statusColor, fontWeight: '700' }]}>{labelEN}</Text>
                    </View>
                    <View style={s.statusChipDivider} />
                    <View style={[s.statusChip, { backgroundColor: statusColor + '18' }]}>
                      <Text style={[s.statusChipLangTag, { color: statusColor }]}>ع</Text>
                      <Text style={[s.statusChipText, { color: statusColor, fontWeight: '700' }]}>{labelAR}</Text>
                    </View>
                  </>
                )}
              </View>
            );
          })() : null}

          {stockPayload && (stockPayload.sku || stockPayload.name || stockPayload.name_ar) && (
            <TouchableOpacity
              activeOpacity={stockPayload.product_id && !isMultiSelect ? 0.7 : 1}
              onPress={stockPayload.product_id && !isMultiSelect ? () => onProductPress(stockPayload.product_id!) : undefined}
              style={[
                s.stockMiniCard,
                entry.event_type === 'out_of_stock' ? s.stockMiniCardRed : s.stockMiniCardAmber,
                stockPayload.product_id && !isMultiSelect ? s.stockMiniCardTappable : undefined,
              ]}
            >
              {/* Product thumbnail */}
              <View style={[
                s.stockThumb,
                entry.event_type === 'out_of_stock' ? s.stockThumbRed : s.stockThumbAmber,
              ]}>
                <StockThumb
                  url={stockPayload.image_url}
                  fallback={
                    <Text style={[
                      s.stockThumbInitial,
                      entry.event_type === 'out_of_stock' ? s.stockThumbInitialRed : s.stockThumbInitialAmber,
                    ]}>
                      {(isRTL && stockPayload.name_ar
                        ? stockPayload.name_ar
                        : (stockPayload.name ?? '?')
                      ).charAt(0).toUpperCase()}
                    </Text>
                  }
                />
              </View>

              <View style={s.stockMiniCardLeft}>
                {stockPayload.sku ? (
                  <View style={[
                    s.skuChip,
                    entry.event_type === 'out_of_stock' ? s.skuChipRed : s.skuChipAmber,
                  ]}>
                    <Text style={[
                      s.skuChipText,
                      entry.event_type === 'out_of_stock' ? s.skuChipTextRed : s.skuChipTextAmber,
                    ]}>
                      {stockPayload.sku}
                    </Text>
                  </View>
                ) : null}
                <Text style={s.stockProductName} numberOfLines={1}>
                  {isRTL && stockPayload.name_ar ? stockPayload.name_ar : (stockPayload.name ?? '')}
                </Text>
                {stockPayload.fitment_indicator ? (
                  <Text style={s.stockFitment} numberOfLines={1}>{stockPayload.fitment_indicator}</Text>
                ) : null}
                {stockPayload.product_id && !isMultiSelect ? (
                  <Text style={s.stockTapHint}>
                    {isRTL ? 'اضغط للعرض' : 'Tap to view'}
                  </Text>
                ) : null}
              </View>
              <View style={s.stockMiniCardRight}>
                <View style={s.stockStatBlock}>
                  <Text style={s.stockStatLabel}>{isRTL ? 'المخزون' : 'Stock'}</Text>
                  <Text style={[
                    s.stockStatValue,
                    entry.event_type === 'out_of_stock' ? s.stockStatValueRed : s.stockStatValueAmber,
                  ]}>
                    {stockPayload.stock ?? 0}
                  </Text>
                </View>
                {stockPayload.threshold != null && (
                  <View style={s.stockStatBlock}>
                    <Text style={s.stockStatLabel}>{isRTL ? 'الحد' : 'Limit'}</Text>
                    <Text style={s.stockStatValueGray}>{stockPayload.threshold}</Text>
                  </View>
                )}
                {stockPayload.product_id ? (
                  <Ionicons
                    name={isRTL ? 'chevron-back' : 'chevron-forward'}
                    size={16}
                    color={entry.event_type === 'out_of_stock' ? '#DC2626' : '#D97706'}
                    style={s.stockChevron}
                  />
                ) : null}
              </View>
            </TouchableOpacity>
          )}

          <View style={s.cardFooter}>
            <View style={[s.typeBadge, getTypeBadgeStyle(entry.event_type)]}>
              <Text style={[s.typeText, getTypeTextStyle(entry.event_type)]}>
                {getTypeLabel(entry.event_type, isRTL)}
              </Text>
            </View>

            <View style={s.footerRight}>
              {isMultiSelect && isStockAlert ? (
                <Text style={s.holdHint}>
                  {isSelected
                    ? (isRTL ? 'محدد' : 'Selected')
                    : (isRTL ? 'اضغط للتحديد' : 'Tap to select')}
                </Text>
              ) : (
                <>
                  {isUnread && !isMultiSelect && (
                    <Text style={s.holdHint}>
                      {isStockAlert
                        ? (isRTL ? 'اضغط مطولاً للتحديد' : 'Hold to multi-select')
                        : (isRTL ? 'اضغط مطولاً للتأكيد' : 'Hold to acknowledge')}
                    </Text>
                  )}
                  {isStockAlert && stockPayload?.product_id && !isMultiSelect && (
                    <>
                      <TouchableOpacity
                        style={[s.orderLink, s.restockBtn]}
                        onPress={() => {
                          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                          const name = (isRTL && stockPayload.name_ar ? stockPayload.name_ar : (stockPayload.name ?? ''));
                          onQuickRestock(stockPayload.product_id!, stockPayload.stock ?? 0, name);
                        }}
                        activeOpacity={0.7}
                      >
                        <Ionicons name="layers-outline" size={13} color="#059669" />
                        <Text style={[s.orderLinkText, s.restockBtnText]}>
                          {isRTL ? 'إعادة التخزين' : 'Quick Restock'}
                        </Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={s.orderLink}
                        onPress={() => onProductPress(stockPayload.product_id!)}
                        activeOpacity={0.7}
                      >
                        <Ionicons name="cube-outline" size={13} color="#6366F1" />
                        <Text style={s.orderLinkText}>
                          {isRTL ? 'عرض المنتج' : 'View Product'}
                        </Text>
                        <Ionicons name="open-outline" size={11} color="#6366F1" />
                      </TouchableOpacity>
                    </>
                  )}
                  {orderId && orderNumber && (
                    <TouchableOpacity
                      style={s.orderLink}
                      onPress={() => onOrderPress(orderId, orderNumber)}
                      activeOpacity={0.7}
                    >
                      <Ionicons name="receipt-outline" size={13} color="#6366F1" />
                      <Text style={s.orderLinkText}>#{orderNumber}</Text>
                      <Ionicons name="open-outline" size={11} color="#6366F1" />
                    </TouchableOpacity>
                  )}
                </>
              )}
            </View>
          </View>
        </BlurView>
      </View>
    </TouchableOpacity>
  );
}

// ─── Event Type Filter ────────────────────────────────────────────────────────

type EventTypeFilter = 'all' | 'new_order' | 'low_stock' | 'out_of_stock';

const EVENT_TYPE_FILTERS: { key: EventTypeFilter; ar: string; en: string; color: string; textColor: string }[] = [
  { key: 'all',          ar: 'الكل',        en: 'All',        color: '#EEF2FF', textColor: '#6366F1' },
  { key: 'new_order',    ar: 'طلب جديد',    en: 'New Order',  color: '#EEF2FF', textColor: '#6366F1' },
  { key: 'low_stock',    ar: 'مخزون منخفض', en: 'Low Stock',  color: '#FEF3C7', textColor: '#92400E' },
  { key: 'out_of_stock', ar: 'نفذ المخزون', en: 'Out of Stock', color: '#FEE2E2', textColor: '#991B1B' },
];

// ─── Main Screen ──────────────────────────────────────────────────────────────

function NotificationLogScreen() {
  const router      = useRouter();
  const urlParams   = useLocalSearchParams<{ restaurant_id?: string }>();
  const insets      = useSafeAreaInsets();
  const language    = useAppStore(state => state.language);
  const isRTL       = language === 'ar';
  const queryClient = useQueryClient();
  const user        = useAppStore(state => state.user);
  const userRole    = useAppStore(state => state.userRole);
  const setLastViewedPushLogAt = useAppStore(state => state.setLastViewedPushLogAt);

  // Clear the unread badge when this screen mounts.
  // Store the timestamp per user so multiple accounts on the same device stay isolated.
  useEffect(() => {
    if (!user?.id) return;
    const now = new Date().toISOString();
    setLastViewedPushLogAt(user.id, now);
    queryClient.invalidateQueries({ queryKey: ['push-log-unread-count'], exact: false });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  const [page, setPage]           = useState(1);
  const [startDate, setStartDate] = useState<Date | null>(null);
  const [endDate, setEndDate]     = useState<Date | null>(null);
  const [showCalendar, setShowCalendar] = useState(false);
  const [eventTypeFilter, setEventTypeFilter] = useState<EventTypeFilter>('all');
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [restaurantFilter, setRestaurantFilter] = useState<string | null>(
    typeof urlParams?.restaurant_id === 'string' ? urlParams.restaurant_id : null,
  );

  const limit = 30;

  // Restaurant list for filter strip (owners see all; assigned users see scoped)
  const { data: restaurantsData } = useQuery<{ restaurants: any[] }>({
    queryKey: ['restaurant-analytics', 'restaurants-for-filter'],
    queryFn: async () => {
      try {
        const res = await restaurantAnalyticsApi.getRestaurants();
        return res.data;
      } catch {
        try {
          const res = await restaurantAnalyticsApi.getMyAssignments();
          return res.data;
        } catch { return { restaurants: [] }; }
      }
    },
    staleTime: 5 * 60 * 1000,
    retry: false,
  });
  const restaurantsList: any[] = restaurantsData?.restaurants || [];

  // Auto-scope restaurant_user to their first assigned restaurant.
  // Fires once after the restaurant list loads so the filter strip
  // auto-selects correctly and the push-log query is pre-filtered.
  useEffect(() => {
    if (userRole === 'restaurant_user' && restaurantsList.length > 0 && !restaurantFilter) {
      const first = restaurantsList[0];
      const rid = first?.id || first?.restaurant_id || null;
      if (rid) setRestaurantFilter(rid);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userRole, restaurantsList.length]);

  // Exit multi-select mode automatically when the user navigates to a
  // different page or changes any filter — prevents an empty-sheet scenario
  // where selectedIds references entries that are no longer visible.
  useEffect(() => {
    setMultiSelectMode(false);
    setSelectedIds(new Set());
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, startDate, endDate, eventTypeFilter, unreadOnly, restaurantFilter]);

  const buildParams = useCallback(() => ({
    page,
    limit,
    ...(startDate ? { start_date: startDate.toISOString() } : {}),
    ...(endDate   ? { end_date:   endDate.toISOString()   } : {}),
    ...(eventTypeFilter !== 'all' ? { event_type: eventTypeFilter } : {}),
    ...(unreadOnly ? { unread_only: true } : {}),
    ...(restaurantFilter ? { restaurant_id: restaurantFilter } : {}),
  }), [page, startDate, endDate, eventTypeFilter, unreadOnly, restaurantFilter]);

  const queryKey = ['push-log', page, startDate?.toISOString(), endDate?.toISOString(), eventTypeFilter, unreadOnly, restaurantFilter];

  const { data, isLoading, isFetching, refetch, isError } = useQuery<PushLogResponse>({
    queryKey,
    queryFn: () => pushLogApi.getLog(buildParams()).then(r => r.data as PushLogResponse),
    staleTime: 30_000,
  });

  const { data: unreadCountData } = useQuery<{ count: number }>({
    queryKey: ['push-log-unread-count', restaurantFilter],
    queryFn: () => pushLogApi.getUnreadCount(
      restaurantFilter ? { restaurant_id: restaurantFilter } : undefined
    ).then(r => r.data as { count: number }),

    staleTime: 30_000,
  });

  // ── Real-time stock sync ──────────────────────────────────────────────────
  // When any connected user restocks a product the server broadcasts
  // `stock_updated` with { product_id, stock_quantity }.  We patch every
  // cached push-log page so the mini-card stock stat stays current without
  // requiring a pull-to-refresh.
  const handleStockUpdated = useCallback((msg: WSMessage) => {
    const product_id: string | undefined = msg.data?.product_id;
    const stock_quantity: number | undefined = msg.data?.stock_quantity;
    if (!product_id || stock_quantity == null) return;
    queryClient.setQueriesData<PushLogResponse>(
      { queryKey: ['push-log'], exact: false },
      (old) => {
        if (!old) return old;
        const updated = old.data.map(e => {
          if (
            (e.event_type === 'low_stock' || e.event_type === 'out_of_stock') &&
            e.payload?.product_id === product_id
          ) {
            return { ...e, payload: { ...e.payload, stock: stock_quantity } };
          }
          return e;
        });
        return { ...old, data: updated };
      },
    );
  }, [queryClient]);

  useWebSocketEvent(['stock_updated'], handleStockUpdated);

  const acknowledgeMutation = useMutation({
    mutationFn: (id: string) => pushLogApi.acknowledge(id).then(r => r.data),
    onSuccess: (_data, id) => {
      if (unreadOnly) {
        queryClient.setQueryData<PushLogResponse>(queryKey, old => {
          if (!old) return old;
          const next = old.data.filter(e => e.id !== id);
          return {
            ...old,
            data: next,
            pagination: {
              ...old.pagination,
              total: Math.max(0, old.pagination.total - 1),
            },
          };
        });
      } else {
        queryClient.setQueryData<PushLogResponse>(queryKey, old => {
          if (!old) return old;
          return {
            ...old,
            data: old.data.map(e =>
              e.id === id ? { ...e, acknowledged_at: new Date().toISOString() } : e,
            ),
          };
        });
      }
      queryClient.invalidateQueries({ queryKey: ['push-log'], exact: false });
    },
  });

  const acknowledgeAllMutation = useMutation({
    mutationFn: (filters?: { start_date?: string; end_date?: string; event_type?: string }) =>
      pushLogApi.acknowledgeAll(filters).then(r => r.data),
    onMutate: (filters) => {
      // Optimistic update: mark all visible entries as acknowledged
      const now = new Date().toISOString();
      queryClient.setQueryData<PushLogResponse>(queryKey, old => {
        if (!old) return old;
        if (unreadOnly) {
          return { ...old, data: [], pagination: { ...old.pagination, total: 0 } };
        }
        return {
          ...old,
          data: old.data.map(e => ({ ...e, acknowledged_at: e.acknowledged_at ?? now })),
        };
      });
      // Only zero out the global unread count when no filters are active — otherwise
      // entries outside the current filter window may still be unread.
      const isScoped = !!(filters?.start_date || filters?.end_date ||
        (filters?.event_type && filters.event_type !== 'all'));
      if (!isScoped) {
        queryClient.setQueryData<{ count: number }>(['push-log-unread-count'], { count: 0 });
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['push-log'], exact: false });
      queryClient.invalidateQueries({ queryKey: ['push-log-unread-count'], exact: false });
    },
  });

  const { statusToasts, pushStatusToast, dismissStatusToast } = useStatusToastQueue();

  const [restockTarget, setRestockTarget] = useState<RestockTarget | null>(null);
  const [restockSheetVisible, setRestockSheetVisible] = useState(false);

  const [productSheetProductId, setProductSheetProductId] = useState<string | null>(null);
  const [productSheetVisible, setProductSheetVisible] = useState(false);

  const [multiSelectMode, setMultiSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkRestockVisible, setBulkRestockVisible] = useState(false);

  const restockMutation = useMutation({
    mutationFn: ({ productId, qty }: { productId: string; qty: number }) =>
      productApi.updateStock(productId, qty).then(r => r.data as { id: string; stock_quantity: number }),
    onMutate: async ({ productId, qty }) => {
      // Cancel any in-flight refetches so they don't overwrite the optimistic value
      await queryClient.cancelQueries({ queryKey });
      // Snapshot the current cache value for rollback
      const snapshot = queryClient.getQueryData<PushLogResponse>(queryKey);
      // Apply optimistic update immediately
      queryClient.setQueryData<PushLogResponse>(queryKey, old => {
        if (!old) return old;
        return {
          ...old,
          data: old.data.map(e => {
            if (
              (e.event_type === 'low_stock' || e.event_type === 'out_of_stock') &&
              e.payload?.product_id === productId
            ) {
              return { ...e, payload: { ...e.payload, stock: qty } };
            }
            return e;
          }),
        };
      });
      return { snapshot };
    },
    onSuccess: (result, variables) => {
      setRestockSheetVisible(false);
      pushStatusToast(
        'success',
        `restock_${variables.productId}`,
        isRTL
          ? `تم تحديث المخزون إلى ${result.stock_quantity}`
          : `Stock updated to ${result.stock_quantity}`,
      );
      // Reconcile optimistic value with the server-confirmed stock_quantity
      queryClient.setQueryData<PushLogResponse>(queryKey, old => {
        if (!old) return old;
        return {
          ...old,
          data: old.data.map(e => {
            if (
              (e.event_type === 'low_stock' || e.event_type === 'out_of_stock') &&
              e.payload?.product_id === variables.productId
            ) {
              return { ...e, payload: { ...e.payload, stock: result.stock_quantity } };
            }
            return e;
          }),
        };
      });
    },
    onError: (_err, _vars, context) => {
      // Roll back to the snapshot captured in onMutate
      if (context?.snapshot) {
        queryClient.setQueryData<PushLogResponse>(queryKey, context.snapshot);
      }
      pushStatusToast(
        'error',
        `restock_err_${Date.now()}`,
        isRTL ? 'تعذّر تحديث المخزون' : 'Failed to update stock',
      );
    },
  });

  const [bulkPending, setBulkPending] = useState(false);

  const handleBulkRestock = useCallback(async (updates: { productId: string; qty: number }[]) => {
    setBulkPending(true);
    let successCount = 0;
    let failCount = 0;
    for (const { productId, qty } of updates) {
      try {
        const result = await productApi.updateStock(productId, qty).then(r => r.data as { id: string; stock_quantity: number });
        successCount++;
        // Apply optimistic update for each successful restock
        queryClient.setQueryData<PushLogResponse>(queryKey, old => {
          if (!old) return old;
          return {
            ...old,
            data: old.data.map(e => {
              if (
                (e.event_type === 'low_stock' || e.event_type === 'out_of_stock') &&
                e.payload?.product_id === productId
              ) {
                return { ...e, payload: { ...e.payload, stock: result.stock_quantity } };
              }
              return e;
            }),
          };
        });
      } catch {
        failCount++;
      }
    }
    setBulkPending(false);
    setBulkRestockVisible(false);
    setMultiSelectMode(false);
    setSelectedIds(new Set());
    if (successCount > 0 && failCount === 0) {
      pushStatusToast(
        'success',
        `bulk_restock_${Date.now()}`,
        isRTL
          ? `تم تحديث ${successCount} منتج بنجاح`
          : `${successCount} product${successCount > 1 ? 's' : ''} restocked`,
      );
    } else if (successCount > 0 && failCount > 0) {
      pushStatusToast(
        'error',
        `bulk_restock_partial_${Date.now()}`,
        isRTL
          ? `تم ${successCount} وفشل ${failCount}`
          : `${successCount} restocked, ${failCount} failed`,
      );
    } else {
      pushStatusToast(
        'error',
        `bulk_restock_err_${Date.now()}`,
        isRTL ? 'تعذّر تحديث المخزون' : 'Failed to update stock',
      );
    }
  }, [isRTL, pushStatusToast, queryClient, queryKey]);

  const entries    = data?.data ?? [];
  const totalPages = data?.pagination?.pages ?? 1;
  const total      = data?.pagination?.total ?? 0;
  const hasUnread  = (unreadCountData?.count ?? 0) > 0;

  const handleOrderPress = (orderId: string, orderNumber?: string | number) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.push(`/owner/orders?order_number=${orderNumber ?? orderId}` as any);
  };

  const handleProductPress = (productId: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setProductSheetProductId(productId);
    setProductSheetVisible(true);
  };

  const handleAcknowledge = (id: string) => {
    acknowledgeMutation.mutate(id);
  };

  const handleQuickRestock = (productId: string, currentStock: number, productName: string) => {
    setRestockTarget({ productId, currentStock, productName });
    setRestockSheetVisible(true);
  };

  const handleEnterMultiSelect = useCallback((entryId: string) => {
    setMultiSelectMode(true);
    setSelectedIds(new Set([entryId]));
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
  }, []);

  const handleToggleSelect = useCallback((entryId: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(entryId)) {
        next.delete(entryId);
      } else {
        next.add(entryId);
      }
      return next;
    });
  }, []);

  const handleExitMultiSelect = useCallback(() => {
    setMultiSelectMode(false);
    setSelectedIds(new Set());
  }, []);

  const selectedEntries = entries.filter(e =>
    selectedIds.has(e.id) &&
    (e.event_type === 'low_stock' || e.event_type === 'out_of_stock') &&
    e.payload?.product_id,
  );

  const bulkItems: BulkRestockItem[] = (() => {
    const seen = new Set<string>();
    return selectedEntries.reduce<BulkRestockItem[]>((acc, e) => {
      const pid = e.payload.product_id!;
      if (seen.has(pid)) return acc;
      seen.add(pid);
      acc.push({
        entryId: e.id,
        productId: pid,
        productName: (isRTL && e.payload.name_ar ? e.payload.name_ar : (e.payload.name ?? '')) as string,
        currentStock: e.payload.stock ?? 0,
        qty: String(e.payload.stock ?? 0),
      });
      return acc;
    }, []);
  })();

  const handleDateConfirm = (s: Date | null, e: Date | null) => {
    setStartDate(s);
    setEndDate(e);
    setPage(1);
  };

  const clearFilter = () => {
    setStartDate(null);
    setEndDate(null);
    setPage(1);
  };

  const hasDateFilter = !!(startDate || endDate);

  const formatShortDate = (d: Date | null) =>
    d ? d.toLocaleDateString(isRTL ? 'ar-EG' : 'en-US', { day: 'numeric', month: 'short' }) : '';

  return (
    <View style={s.root}>
      <LinearGradient colors={['#1E1E3F', '#2D2D5F', '#3D3D7F']} style={StyleSheet.absoluteFill} />

      {/* Header */}
      <View style={[s.header, { paddingTop: insets.top + 8 }]}>
        <TouchableOpacity style={s.backBtn} onPress={() => router.back()} activeOpacity={0.7}>
          <Ionicons name={isRTL ? 'arrow-forward' : 'arrow-back'} size={22} color="#FFF" />
        </TouchableOpacity>
        <View style={s.headerTitles}>
          <Text style={s.headerTitle}>
            {isRTL ? 'سجل التنبيهات' : 'Alert History'}
          </Text>
          <Text style={s.headerSub}>
            {total > 0
              ? (isRTL ? `${total} إشعار` : `${total} notifications`)
              : (isRTL ? 'لا توجد إشعارات' : 'No notifications yet')}
          </Text>
        </View>
        {hasUnread && (
          <TouchableOpacity
            style={s.markAllBtn}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
              acknowledgeAllMutation.mutate({
                ...(startDate ? { start_date: startDate.toISOString() } : {}),
                ...(endDate   ? { end_date:   endDate.toISOString()   } : {}),
                ...(eventTypeFilter !== 'all' ? { event_type: eventTypeFilter } : {}),
                ...(restaurantFilter ? { restaurant_id: restaurantFilter } : {}),
              });
            }}
            disabled={acknowledgeAllMutation.isPending}
            activeOpacity={0.7}
          >
            <Ionicons name="checkmark-done-outline" size={16} color="#6366F1" />
            <Text style={s.markAllText}>
              {(() => {
                const filtered = !!(startDate || endDate || eventTypeFilter !== 'all' || restaurantFilter);
                if (filtered) {
                  return isRTL ? 'تأكيد المعروض' : 'Mark all (filtered)';
                }
                return isRTL ? 'تأكيد الكل' : 'Mark all';
              })()}
            </Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity
          style={[s.filterBtn, hasDateFilter && s.filterBtnActive]}
          onPress={() => setShowCalendar(true)}
          activeOpacity={0.7}
        >
          <Ionicons name="calendar-outline" size={18} color={hasDateFilter ? '#6366F1' : '#FFF'} />
        </TouchableOpacity>
      </View>

      {/* Active filter strip */}
      {hasDateFilter && (
        <View style={s.filterStrip}>
          <Ionicons name="funnel" size={13} color="#6366F1" />
          <Text style={s.filterStripText}>
            {formatShortDate(startDate)}
            {endDate && startDate && ' → '}
            {formatShortDate(endDate)}
          </Text>
          <TouchableOpacity onPress={clearFilter} style={s.clearFilterBtn}>
            <Ionicons name="close-circle" size={16} color="#6B7280" />
          </TouchableOpacity>
        </View>
      )}

      {/* Restaurant filter strip (horizontal cards) */}
      {restaurantsList.length > 0 && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={s.restaurantStripContent}
          style={s.restaurantStrip}
        >
          <TouchableOpacity
            style={[
              s.restaurantChip,
              !restaurantFilter && s.restaurantChipActive,
            ]}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              setRestaurantFilter(null);
              setPage(1);
            }}
            activeOpacity={0.75}
          >
            <Ionicons
              name="apps"
              size={14}
              color={!restaurantFilter ? '#1F2937' : 'rgba(255,255,255,0.85)'}
            />
            <Text style={[
              s.restaurantChipText,
              !restaurantFilter && s.restaurantChipTextActive,
            ]}>
              {isRTL ? 'الكل' : 'All'}
            </Text>
          </TouchableOpacity>
          {restaurantsList.map((r: any) => {
            const id = r.id || r.restaurant_id;
            if (!id) return null;
            const active = restaurantFilter === id;
            const label = isRTL ? (r.name_ar || r.name || id) : (r.name || r.name_ar || id);
            return (
              <TouchableOpacity
                key={id}
                style={[
                  s.restaurantChip,
                  active && s.restaurantChipActive,
                ]}
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  setRestaurantFilter(active ? null : id);
                  setPage(1);
                }}
                activeOpacity={0.75}
              >
                {r.logo ? (
                  <Image source={{ uri: r.logo }} style={s.restaurantChipLogo} />
                ) : (
                  <Ionicons
                    name="restaurant"
                    size={14}
                    color={active ? '#1F2937' : 'rgba(255,255,255,0.85)'}
                  />
                )}
                <Text
                  style={[s.restaurantChipText, active && s.restaurantChipTextActive]}
                  numberOfLines={1}
                >
                  {label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      )}

      {/* Event type filter chips + unread toggle */}
      <View style={s.typeFilterRow}>
        {EVENT_TYPE_FILTERS.map(f => {
          const active = eventTypeFilter === f.key;
          return (
            <TouchableOpacity
              key={f.key}
              style={[
                s.typeChip,
                active
                  ? { backgroundColor: f.color, borderColor: f.textColor }
                  : { backgroundColor: 'rgba(255,255,255,0.08)', borderColor: 'rgba(255,255,255,0.15)' },
              ]}
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                setEventTypeFilter(f.key);
                setPage(1);
              }}
              activeOpacity={0.7}
            >
              <Text style={[s.typeChipText, active ? { color: f.textColor } : { color: 'rgba(255,255,255,0.75)' }]}>
                {isRTL ? f.ar : f.en}
              </Text>
            </TouchableOpacity>
          );
        })}

        {/* Unread-only toggle */}
        <TouchableOpacity
          style={[
            s.typeChip,
            unreadOnly
              ? { backgroundColor: '#FDE68A', borderColor: '#D97706' }
              : { backgroundColor: 'rgba(255,255,255,0.08)', borderColor: 'rgba(255,255,255,0.15)' },
          ]}
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            setUnreadOnly(v => !v);
            setPage(1);
          }}
          activeOpacity={0.7}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <Ionicons
              name="ellipse"
              size={8}
              color={unreadOnly ? '#D97706' : 'rgba(255,255,255,0.6)'}
            />
            <Text style={[s.typeChipText, unreadOnly ? { color: '#92400E' } : { color: 'rgba(255,255,255,0.75)' }]}>
              {isRTL ? 'غير مقروء' : 'Unread'}
            </Text>
          </View>
        </TouchableOpacity>
      </View>

      {/* List */}
      {isLoading ? (
        <View style={s.center}>
          <ActivityIndicator size="large" color="#6366F1" />
          <Text style={s.loadingText}>{isRTL ? 'جارٍ التحميل...' : 'Loading...'}</Text>
        </View>
      ) : isError ? (
        <View style={s.center}>
          <Ionicons name="alert-circle-outline" size={48} color="#EF4444" />
          <Text style={s.errorText}>{isRTL ? 'فشل التحميل' : 'Failed to load'}</Text>
          <TouchableOpacity style={s.retryBtn} onPress={() => refetch()}>
            <Text style={s.retryText}>{isRTL ? 'إعادة المحاولة' : 'Retry'}</Text>
          </TouchableOpacity>
        </View>
      ) : entries.length === 0 ? (
        <View style={s.center}>
          <Ionicons name="notifications-off-outline" size={56} color="rgba(255,255,255,0.3)" />
          <Text style={s.emptyTitle}>
            {isRTL ? 'لا توجد تنبيهات' : 'No alerts found'}
          </Text>
          <Text style={s.emptyText}>
            {unreadOnly
              ? (isRTL ? 'كل التنبيهات تم تأكيدها' : 'All alerts have been acknowledged')
              : hasDateFilter
                ? (isRTL ? 'جرّب نطاقاً زمنياً مختلفاً' : 'Try a different date range')
                : (isRTL ? 'ستظهر هنا تنبيهات الطلبات الجديدة' : 'New order alerts will appear here')}
          </Text>
        </View>
      ) : (
        <FlatList
          data={entries}
          keyExtractor={item => item.id}
          contentContainerStyle={[s.list, { paddingBottom: insets.bottom + 24 }]}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={isFetching}
              onRefresh={() => refetch()}
              tintColor="#6366F1"
            />
          }
          renderItem={({ item }) => (
            <LogCard
              entry={item}
              isRTL={isRTL}
              onOrderPress={handleOrderPress}
              onProductPress={handleProductPress}
              onAcknowledge={handleAcknowledge}
              onQuickRestock={handleQuickRestock}
              isMultiSelect={multiSelectMode}
              isSelected={selectedIds.has(item.id)}
              onToggleSelect={handleToggleSelect}
              onEnterMultiSelect={handleEnterMultiSelect}
            />
          )}
          ListFooterComponent={
            totalPages > 1 ? (
              <View style={s.pagination}>
                <TouchableOpacity
                  style={[s.pageBtn, page === 1 && s.pageBtnDisabled]}
                  onPress={() => { if (page > 1) { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setPage(p => p - 1); } }}
                  disabled={page === 1}
                  activeOpacity={0.7}
                >
                  <Ionicons name="chevron-back" size={18} color={page === 1 ? '#9CA3AF' : '#6366F1'} />
                  <Text style={[s.pageBtnText, page === 1 && s.pageBtnTextDisabled]}>
                    {isRTL ? 'السابق' : 'Prev'}
                  </Text>
                </TouchableOpacity>

                <View style={s.pageIndicator}>
                  <Text style={s.pageIndicatorText}>
                    {page} / {totalPages}
                  </Text>
                </View>

                <TouchableOpacity
                  style={[s.pageBtn, page >= totalPages && s.pageBtnDisabled]}
                  onPress={() => { if (page < totalPages) { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setPage(p => p + 1); } }}
                  disabled={page >= totalPages}
                  activeOpacity={0.7}
                >
                  <Text style={[s.pageBtnText, page >= totalPages && s.pageBtnTextDisabled]}>
                    {isRTL ? 'التالي' : 'Next'}
                  </Text>
                  <Ionicons name="chevron-forward" size={18} color={page >= totalPages ? '#9CA3AF' : '#6366F1'} />
                </TouchableOpacity>
              </View>
            ) : null
          }
        />
      )}

      {/* Multi-select bottom action bar */}
      {multiSelectMode && (
        <View style={[s.multiBar, { paddingBottom: insets.bottom + 8 }]}>
          <TouchableOpacity
            style={s.multiBarCancel}
            onPress={handleExitMultiSelect}
            activeOpacity={0.7}
          >
            <Ionicons name="close" size={18} color="#6B7280" />
            <Text style={s.multiBarCancelText}>
              {isRTL ? 'إلغاء' : 'Cancel'}
            </Text>
          </TouchableOpacity>

          <Text style={s.multiBarCount}>
            {isRTL
              ? `${bulkItems.length} منتج محدد`
              : `${bulkItems.length} product${bulkItems.length !== 1 ? 's' : ''} selected`}
          </Text>

          <TouchableOpacity
            style={[s.multiBarAction, bulkItems.length === 0 && s.multiBarActionDisabled]}
            onPress={() => {
              if (bulkItems.length === 0) return;
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
              setBulkRestockVisible(true);
            }}
            disabled={bulkItems.length === 0}
            activeOpacity={0.7}
          >
            <LinearGradient colors={['#059669', '#047857']} style={s.multiBarActionGrad}>
              <Ionicons name="layers-outline" size={16} color="#FFF" />
              <Text style={s.multiBarActionText}>
                {isRTL ? 'إعادة تخزين المحددة' : 'Restock all selected'}
              </Text>
            </LinearGradient>
          </TouchableOpacity>
        </View>
      )}

      {/* Calendar modal */}
      <CalendarPicker
        visible={showCalendar}
        isRTL={isRTL}
        onClose={() => setShowCalendar(false)}
        onConfirm={handleDateConfirm}
        initialStart={startDate}
        initialEnd={endDate}
      />

      {/* Quick Restock bottom sheet */}
      <QuickRestockSheet
        visible={restockSheetVisible}
        isRTL={isRTL}
        target={restockTarget}
        onClose={() => setRestockSheetVisible(false)}
        onSubmit={(productId, qty) => restockMutation.mutate({ productId, qty })}
        isPending={restockMutation.isPending}
      />

      {/* Bulk Restock Sheet */}
      <BulkRestockSheet
        visible={bulkRestockVisible}
        isRTL={isRTL}
        items={bulkItems}
        onClose={() => setBulkRestockVisible(false)}
        onSubmit={handleBulkRestock}
        isPending={bulkPending}
      />

      {/* Product detail sheet */}
      <ProductDetailSheet
        visible={productSheetVisible}
        productId={productSheetProductId}
        isRTL={isRTL}
        onClose={() => {
          setProductSheetVisible(false);
          setProductSheetProductId(null);
        }}
      />

      {/* Toast notifications */}
      <OrderStatusToastStack toasts={statusToasts} onDismiss={dismissStatusToast} />
    </View>
  );
}

export default function NotificationLog() {
  return (
    <__AccessGuard__ scope="owner">
      <NotificationLogScreen />
    </__AccessGuard__>
  );
}

// ─── Calendar Styles ──────────────────────────────────────────────────────────

const cal = StyleSheet.create({
  backdrop:    { ...StyleSheet.absoluteFillObject, zIndex: 10 },
  sheet: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    backgroundColor: '#FFF',
    borderTopLeftRadius: 28, borderTopRightRadius: 28,
    paddingHorizontal: 20, paddingBottom: Platform.OS === 'web' ? 40 : 32,
    paddingTop: 20, zIndex: 20,
    shadowColor: '#000', shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.15, shadowRadius: 20, elevation: 30,
  },
  header:      { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 },
  title:       { fontSize: 17, fontWeight: '700', color: '#111827' },
  closeBtn:    { width: 30, height: 30, borderRadius: 15, backgroundColor: '#F3F4F6', alignItems: 'center', justifyContent: 'center' },
  presets:     { flexDirection: 'row', gap: 8, marginBottom: 14, flexWrap: 'wrap' },
  preset:      { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20, backgroundColor: '#EEF2FF' },
  presetText:  { fontSize: 12, fontWeight: '600', color: '#6366F1' },
  monthNav:    { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  navBtn:      { width: 34, height: 34, borderRadius: 17, backgroundColor: '#F9FAFB', alignItems: 'center', justifyContent: 'center' },
  monthLabel:  { fontSize: 15, fontWeight: '700', color: '#1F2937' },
  weekRow:     { flexDirection: 'row', marginBottom: 4 },
  weekDay:     { flex: 1, textAlign: 'center', fontSize: 11, fontWeight: '600', color: '#9CA3AF' },
  grid:        { flexDirection: 'row', flexWrap: 'wrap' },
  cell:        { width: `${100/7}%`, height: 40, alignItems: 'center', justifyContent: 'center' },
  cellMid:     { backgroundColor: '#EEF2FF' },
  cellSel:     { backgroundColor: '#6366F1' },
  inner:       { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  innerSel:    { backgroundColor: '#6366F1' },
  dayTxt:      { fontSize: 13, color: '#374151' },
  todayTxt:    { fontWeight: '700', color: '#6366F1' },
  selTxt:      { color: '#FFF', fontWeight: '700' },
  midTxt:      { color: '#6366F1' },
  dot:         { width: 4, height: 4, borderRadius: 2, backgroundColor: '#6366F1', marginTop: 1 },
  rangeLabel:  { textAlign: 'center', color: '#6366F1', fontSize: 12, fontWeight: '600', marginTop: 4, marginBottom: 2 },
  actions:     { flexDirection: 'row', gap: 12, marginTop: 16 },
  cancelBtn:   { flex: 1, height: 46, borderRadius: 14, borderWidth: 1, borderColor: '#E5E7EB', alignItems: 'center', justifyContent: 'center' },
  cancelTxt:   { fontSize: 14, fontWeight: '600', color: '#6B7280' },
  confirmBtn:  { flex: 2, borderRadius: 14, overflow: 'hidden' },
  confirmGrad: { height: 46, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  confirmTxt:  { fontSize: 14, fontWeight: '700', color: '#FFF' },
});

// ─── Screen Styles ────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  root:   { flex: 1 },
  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 16, paddingBottom: 12, gap: 12,
  },
  backBtn: {
    width: 38, height: 38, borderRadius: 19,
    backgroundColor: 'rgba(255,255,255,0.15)',
    alignItems: 'center', justifyContent: 'center',
  },
  headerTitles: { flex: 1 },
  headerTitle:  { fontSize: 19, fontWeight: '700', color: '#FFF' },
  headerSub:    { fontSize: 12, color: 'rgba(255,255,255,0.6)', marginTop: 1 },
  filterBtn: {
    width: 38, height: 38, borderRadius: 19,
    backgroundColor: 'rgba(255,255,255,0.15)',
    alignItems: 'center', justifyContent: 'center',
  },
  filterBtnActive: { backgroundColor: '#FFF' },
  markAllBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: '#FFF',
    borderRadius: 18, paddingHorizontal: 10, paddingVertical: 6,
  },
  markAllText: { fontSize: 12, fontWeight: '700', color: '#6366F1' },

  filterStrip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    marginHorizontal: 16, marginBottom: 8,
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderRadius: 10, paddingHorizontal: 10, paddingVertical: 6,
  },
  filterStripText: { flex: 1, fontSize: 12, fontWeight: '600', color: '#FFF' },
  restaurantStrip: { maxHeight: 56, marginHorizontal: 12, marginBottom: 8 },
  restaurantStripContent: { gap: 8, paddingVertical: 6 },
  restaurantChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
    maxWidth: 180,
  },
  restaurantChipActive: { backgroundColor: '#FDE68A', borderColor: '#D97706' },
  restaurantChipLogo: { width: 18, height: 18, borderRadius: 9 },
  restaurantChipText: { fontSize: 12, fontWeight: '600', color: 'rgba(255,255,255,0.85)' },
  restaurantChipTextActive: { color: '#1F2937' },
  clearFilterBtn:  { padding: 2 },

  typeFilterRow: {
    flexDirection: 'row', gap: 6, flexWrap: 'wrap',
    paddingHorizontal: 16, marginBottom: 10,
  },
  typeChip: {
    paddingHorizontal: 10, paddingVertical: 5,
    borderRadius: 20, borderWidth: 1,
  },
  typeChipText: { fontSize: 11, fontWeight: '600' },

  list: { paddingHorizontal: 16, paddingTop: 4 },

  card: {
    marginBottom: 10,
    borderRadius: 16,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  cardUnread: {
    borderColor: '#6366F1',
    borderWidth: 2,
    shadowColor: '#6366F1',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.25,
    shadowRadius: 6,
    elevation: 4,
  },
  cardBlur: { padding: 14 },
  unreadDot: {
    position: 'absolute',
    top: 10, right: 10,
    width: 8, height: 8, borderRadius: 4,
    backgroundColor: '#6366F1',
    zIndex: 1,
  },
  cardHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginBottom: 8 },
  iconCircle: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: '#F3F4F6',
    alignItems: 'center', justifyContent: 'center',
  },
  iconCircleUnread: { backgroundColor: '#EEF2FF' },
  cardMeta:  { flex: 1 },
  cardTitle: { fontSize: 14, fontWeight: '600', color: '#374151' },
  cardTitleUnread: { fontWeight: '700', color: '#111827' },
  cardTime:  { fontSize: 11, color: '#6B7280', marginTop: 2 },
  rightBadges: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  newBadge: {
    backgroundColor: '#6366F1', borderRadius: 8,
    paddingHorizontal: 6, paddingVertical: 2,
  },
  newBadgeText: { fontSize: 10, fontWeight: '700', color: '#FFF' },
  recipientBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    backgroundColor: '#F3F4F6', borderRadius: 10,
    paddingHorizontal: 7, paddingVertical: 3,
  },
  recipientCount: { fontSize: 11, fontWeight: '600', color: '#6B7280' },

  cardBody: { fontSize: 13, color: '#374151', lineHeight: 18, flex: 1 },

  bilingualBody: { marginBottom: 10, gap: 4 },
  bilingualRow: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 6,
  },
  bilingualRowAr: { flexDirection: 'row-reverse' },
  bilingualLang: {
    fontSize: 10, fontWeight: '700', color: '#6366F1',
    backgroundColor: '#EEF2FF', borderRadius: 4,
    paddingHorizontal: 4, paddingVertical: 1,
    marginTop: 1, minWidth: 20, textAlign: 'center',
  },
  bilingualLangAr: { color: '#D97706', backgroundColor: '#FEF3C7' },
  cardBodyAr: { textAlign: 'right' },

  statusChipRow: {
    flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap',
    gap: 4, marginBottom: 10,
    borderWidth: 1, borderRadius: 10,
    paddingHorizontal: 8, paddingVertical: 6,
    backgroundColor: '#FAFAFA',
  },
  statusChip: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    borderRadius: 6, paddingHorizontal: 6, paddingVertical: 3,
  },
  statusChipLangTag: {
    fontSize: 9, fontWeight: '700',
    minWidth: 16, textAlign: 'center',
  },
  statusChipText: { fontSize: 12, fontWeight: '600' },
  statusChipDivider: {
    width: 1, height: 16, backgroundColor: '#E5E7EB', marginHorizontal: 4,
  },

  cardFooter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  footerRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  holdHint: { fontSize: 10, color: '#9CA3AF', fontStyle: 'italic' },
  typeBadge:  { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
  typeText:   { fontSize: 11, fontWeight: '600', color: '#6366F1' },
  orderLink: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: '#EEF2FF', borderRadius: 8,
    paddingHorizontal: 8, paddingVertical: 4,
  },
  orderLinkText: { fontSize: 12, fontWeight: '700', color: '#6366F1' },
  restockBtn:     { backgroundColor: '#ECFDF5' },
  restockBtnText: { color: '#059669' },

  stockMiniCard: {
    flexDirection: 'row', alignItems: 'center',
    borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8,
    marginBottom: 10, gap: 8,
    borderWidth: 1,
  },
  stockMiniCardAmber: { backgroundColor: '#FFFBEB', borderColor: '#FDE68A' },
  stockMiniCardRed:   { backgroundColor: '#FFF5F5', borderColor: '#FECACA' },
  stockMiniCardTappable: { opacity: 1 },
  stockMiniCardLeft:  { flex: 1, gap: 2 },
  stockMiniCardRight: { flexDirection: 'row', gap: 12, alignItems: 'center' },

  stockThumb: {
    width: 44, height: 44, borderRadius: 8,
    alignItems: 'center', justifyContent: 'center',
    overflow: 'hidden', flexShrink: 0,
  },
  stockThumbAmber: { backgroundColor: '#FEF3C7' },
  stockThumbRed:   { backgroundColor: '#FEE2E2' },
  stockThumbImg:   { width: 44, height: 44, borderRadius: 8 },
  stockThumbInitial:       { fontSize: 20, fontWeight: '800' },
  stockThumbInitialAmber:  { color: '#D97706' },
  stockThumbInitialRed:    { color: '#DC2626' },

  skuChip: {
    alignSelf: 'flex-start',
    borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2, marginBottom: 2,
  },
  skuChipAmber:    { backgroundColor: '#FEF3C7' },
  skuChipRed:      { backgroundColor: '#FEE2E2' },
  skuChipText:     { fontSize: 10, fontWeight: '700', fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },
  skuChipTextAmber: { color: '#92400E' },
  skuChipTextRed:   { color: '#991B1B' },

  stockProductName: { fontSize: 12, fontWeight: '600', color: '#1F2937' },
  stockFitment:     { fontSize: 11, color: '#6B7280' },
  stockTapHint:     { fontSize: 10, color: '#9CA3AF', fontStyle: 'italic', marginTop: 2 },
  stockChevron:     { marginLeft: 2 },

  stockStatBlock:      { alignItems: 'center', gap: 1 },
  stockStatLabel:      { fontSize: 10, color: '#9CA3AF', fontWeight: '500' },
  stockStatValue:      { fontSize: 15, fontWeight: '800' },
  stockStatValueAmber: { color: '#D97706' },
  stockStatValueRed:   { color: '#DC2626' },
  stockStatValueGray:  { fontSize: 15, fontWeight: '700', color: '#6B7280' },

  pagination: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginTop: 12, marginBottom: 4, gap: 8,
  },
  pageBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: '#FFF', borderRadius: 10,
    paddingHorizontal: 14, paddingVertical: 8,
    borderWidth: 1, borderColor: '#E5E7EB',
  },
  pageBtnDisabled: { backgroundColor: '#F9FAFB', borderColor: '#F3F4F6' },
  pageBtnText:     { fontSize: 13, fontWeight: '600', color: '#6366F1' },
  pageBtnTextDisabled: { color: '#9CA3AF' },
  pageIndicator: {
    flex: 1, alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.1)',
    borderRadius: 10, paddingVertical: 8,
  },
  pageIndicatorText: { fontSize: 13, fontWeight: '600', color: '#FFF' },

  center:      { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 60 },
  loadingText: { color: 'rgba(255,255,255,0.6)', marginTop: 12, fontSize: 14 },
  errorText:   { color: '#EF4444', marginTop: 12, fontSize: 15, fontWeight: '600' },
  retryBtn:    { marginTop: 12, backgroundColor: '#EF4444', borderRadius: 10, paddingHorizontal: 20, paddingVertical: 8 },
  retryText:   { color: '#FFF', fontWeight: '700', fontSize: 13 },
  emptyTitle:  { color: '#FFF', fontSize: 17, fontWeight: '700', marginTop: 16 },
  emptyText:   { color: 'rgba(255,255,255,0.5)', fontSize: 13, marginTop: 6, textAlign: 'center', paddingHorizontal: 32 },

  checkbox: {
    width: 24, height: 24, borderRadius: 12,
    borderWidth: 2, borderColor: '#D1D5DB',
    backgroundColor: 'rgba(255,255,255,0.9)',
    alignItems: 'center', justifyContent: 'center',
  },
  checkboxSelected: {
    backgroundColor: '#6366F1', borderColor: '#6366F1',
  },

  multiBar: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: '#FFF',
    paddingHorizontal: 16, paddingTop: 12,
    borderTopLeftRadius: 20, borderTopRightRadius: 20,
    shadowColor: '#000', shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.15, shadowRadius: 16, elevation: 24,
  },
  multiBarCancel: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 10, paddingVertical: 8,
    backgroundColor: '#F3F4F6', borderRadius: 12,
  },
  multiBarCancelText: { fontSize: 13, fontWeight: '600', color: '#6B7280' },
  multiBarCount: { flex: 1, textAlign: 'center', fontSize: 13, fontWeight: '700', color: '#374151' },
  multiBarAction: { borderRadius: 14, overflow: 'hidden' },
  multiBarActionDisabled: { opacity: 0.4 },
  multiBarActionGrad: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 14, paddingVertical: 10,
  },
  multiBarActionText: { fontSize: 13, fontWeight: '700', color: '#FFF' },
});

// ─── Quick Restock Sheet Styles ───────────────────────────────────────────────

const rs = StyleSheet.create({
  kav: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { ...StyleSheet.absoluteFillObject, zIndex: 10 },
  sheet: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    backgroundColor: '#FFF',
    borderTopLeftRadius: 28, borderTopRightRadius: 28,
    paddingHorizontal: 20,
    paddingBottom: Platform.OS === 'web' ? 40 : 32,
    paddingTop: 12,
    zIndex: 20,
    shadowColor: '#000', shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.18, shadowRadius: 24, elevation: 32,
  },
  handle: {
    alignSelf: 'center', width: 40, height: 4,
    borderRadius: 2, backgroundColor: '#E5E7EB', marginBottom: 16,
  },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 20 },
  sheetIconWrap: {
    width: 42, height: 42, borderRadius: 21,
    backgroundColor: '#EEF2FF',
    alignItems: 'center', justifyContent: 'center',
  },
  sheetTitle:       { fontSize: 16, fontWeight: '700', color: '#111827' },
  sheetProductName: { fontSize: 12, color: '#6B7280', marginTop: 2 },
  closeBtn: {
    width: 32, height: 32, borderRadius: 16,
    backgroundColor: '#F3F4F6',
    alignItems: 'center', justifyContent: 'center',
  },

  currentRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: '#F9FAFB', borderRadius: 12,
    paddingHorizontal: 14, paddingVertical: 12, marginBottom: 16,
  },
  currentLabel: { fontSize: 13, fontWeight: '500', color: '#374151' },
  currentBadge: {
    backgroundColor: '#FFF', borderRadius: 8,
    paddingHorizontal: 10, paddingVertical: 4,
    borderWidth: 1, borderColor: '#E5E7EB',
  },
  currentValue:    { fontSize: 18, fontWeight: '800' },
  currentValueAmber: { color: '#D97706' },
  currentValueRed:   { color: '#DC2626' },

  inputSection: { marginBottom: 20 },
  inputLabel: { fontSize: 13, fontWeight: '600', color: '#374151', marginBottom: 8 },
  input: {
    height: 52, borderRadius: 12,
    borderWidth: 1.5, borderColor: '#E5E7EB',
    paddingHorizontal: 14, fontSize: 20, fontWeight: '700', color: '#111827',
    backgroundColor: '#FAFAFA',
  },
  inputError:  { borderColor: '#EF4444' },
  errorHint:   { fontSize: 11, color: '#EF4444', marginTop: 5 },

  sheetActions: { flexDirection: 'row', gap: 12 },
  cancelBtn: {
    flex: 1, height: 48, borderRadius: 14,
    borderWidth: 1, borderColor: '#E5E7EB',
    alignItems: 'center', justifyContent: 'center',
  },
  cancelTxt: { fontSize: 14, fontWeight: '600', color: '#6B7280' },
  submitBtn: { flex: 2, borderRadius: 14, overflow: 'hidden' },
  submitBtnDisabled: { opacity: 0.5 },
  submitGrad: {
    height: 48, flexDirection: 'row',
    alignItems: 'center', justifyContent: 'center', gap: 6,
  },
  submitTxt: { fontSize: 15, fontWeight: '700', color: '#FFF' },
});

// ─── Product Detail Sheet Styles ──────────────────────────────────────────────

const pd = StyleSheet.create({
  kav: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { ...StyleSheet.absoluteFillObject, zIndex: 10 },
  sheet: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    backgroundColor: '#FFF',
    borderTopLeftRadius: 28, borderTopRightRadius: 28,
    paddingHorizontal: 20,
    paddingBottom: Platform.OS === 'web' ? 40 : 36,
    paddingTop: 12,
    zIndex: 20,
    shadowColor: '#000', shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.18, shadowRadius: 24, elevation: 32,
  },
  handle: {
    alignSelf: 'center', width: 40, height: 4,
    borderRadius: 2, backgroundColor: '#E5E7EB', marginBottom: 16,
  },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 20 },
  iconWrap: {
    width: 42, height: 42, borderRadius: 21,
    backgroundColor: '#EEF2FF',
    alignItems: 'center', justifyContent: 'center',
  },
  sheetTitle: { fontSize: 16, fontWeight: '700', color: '#111827' },
  skuLabel: { fontSize: 11, color: '#6B7280', marginTop: 1, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },
  closeBtn: {
    width: 32, height: 32, borderRadius: 16,
    backgroundColor: '#F3F4F6',
    alignItems: 'center', justifyContent: 'center',
  },
  center: { alignItems: 'center', justifyContent: 'center', paddingVertical: 40, gap: 10 },
  loadingText: { fontSize: 14, color: '#6B7280' },
  errorText: { fontSize: 14, fontWeight: '600', color: '#EF4444', textAlign: 'center' },
  productRow: { flexDirection: 'row', gap: 14, marginBottom: 20, alignItems: 'flex-start' },
  thumb: {
    width: 64, height: 64, borderRadius: 12,
    backgroundColor: '#EEF2FF',
    alignItems: 'center', justifyContent: 'center',
    overflow: 'hidden', flexShrink: 0,
  },
  thumbImg: { width: 64, height: 64, borderRadius: 12 },
  thumbInitial: { fontSize: 26, fontWeight: '800', color: '#6366F1' },
  productName: { fontSize: 15, fontWeight: '700', color: '#111827', lineHeight: 20 },
  productNameAlt: { fontSize: 12, color: '#6B7280' },
  fitment: { fontSize: 11, color: '#6B7280' },
  price: { fontSize: 13, fontWeight: '700', color: '#6366F1' },
  stockSection: {
    backgroundColor: '#F9FAFB', borderRadius: 16,
    padding: 14, marginBottom: 14,
    borderWidth: 1, borderColor: '#F3F4F6',
  },
  stockHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  stockSectionTitle: { fontSize: 13, fontWeight: '600', color: '#374151' },
  editStockBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: '#EEF2FF', borderRadius: 12,
    paddingHorizontal: 10, paddingVertical: 5,
  },
  editStockBtnText: { fontSize: 12, fontWeight: '600', color: '#6366F1' },
  stockValueRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  stockBadge: {
    flexDirection: 'row', alignItems: 'baseline', gap: 5,
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 12, borderWidth: 1,
  },
  stockValue: { fontSize: 28, fontWeight: '800' },
  stockUnit: { fontSize: 12, fontWeight: '600' },
  stockAlertBadge: {
    backgroundColor: '#FEE2E2', borderRadius: 8,
    paddingHorizontal: 8, paddingVertical: 4,
  },
  stockAlertAmber: { backgroundColor: '#FEF3C7' },
  stockAlertText: { fontSize: 11, fontWeight: '700', color: '#991B1B' },
  stockAlertTextAmber: { color: '#92400E' },
  stockEditArea: { marginTop: 14, gap: 8 },
  inputLabel: { fontSize: 13, fontWeight: '600', color: '#374151' },
  stockInput: {
    height: 52, borderRadius: 12,
    borderWidth: 1.5, borderColor: '#E5E7EB',
    paddingHorizontal: 14, fontSize: 20, fontWeight: '700', color: '#111827',
    backgroundColor: '#FAFAFA',
  },
  stockInputError: { borderColor: '#EF4444' },
  errorHint: { fontSize: 11, color: '#EF4444' },
  stockEditActions: { flexDirection: 'row', gap: 10, marginTop: 4 },
  cancelEditBtn: {
    flex: 1, height: 44, borderRadius: 12,
    borderWidth: 1, borderColor: '#E5E7EB',
    alignItems: 'center', justifyContent: 'center',
  },
  cancelEditText: { fontSize: 13, fontWeight: '600', color: '#6B7280' },
  saveStockBtn: { flex: 2, borderRadius: 12, overflow: 'hidden' },
  saveStockBtnDisabled: { opacity: 0.5 },
  saveStockGrad: {
    height: 44, flexDirection: 'row',
    alignItems: 'center', justifyContent: 'center', gap: 6,
  },
  saveStockText: { fontSize: 14, fontWeight: '700', color: '#FFF' },
  successRow: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: '#ECFDF5', borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 8,
  },
  successText: { fontSize: 13, fontWeight: '600', color: '#059669' },
  errorRow: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: '#FEF2F2', borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 8,
  },
  errorRowText: { fontSize: 13, fontWeight: '600', color: '#EF4444' },

  historyToggle: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginTop: 12,
    backgroundColor: '#F9FAFB', borderRadius: 12,
    paddingHorizontal: 14, paddingVertical: 10,
    borderWidth: 1, borderColor: '#F3F4F6',
  },
  historyToggleLeft: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  historyToggleText: { fontSize: 13, fontWeight: '600', color: '#374151' },

  historyContainer: {
    marginTop: 6,
    backgroundColor: '#F9FAFB', borderRadius: 12,
    borderWidth: 1, borderColor: '#F3F4F6',
    overflow: 'hidden',
  },
  historyScroll: { maxHeight: 220 },
  historyEmpty: {
    alignItems: 'center', paddingVertical: 20, gap: 6,
  },
  historyEmptyText: { fontSize: 12, color: '#9CA3AF', textAlign: 'center' },

  historyRow: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 10,
    paddingHorizontal: 14, paddingVertical: 10,
    borderBottomWidth: 1, borderBottomColor: '#F3F4F6',
  },
  historyRowLast: { borderBottomWidth: 0 },
  historyDot: { width: 8, height: 8, borderRadius: 4, marginTop: 5, flexShrink: 0 },
  historyRowContent: { flex: 1, gap: 2 },
  historyRowTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  historyQtyRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  historyQtyOld: { fontSize: 13, fontWeight: '600', color: '#6B7280' },
  historyQtyNew: { fontSize: 13, fontWeight: '700', color: '#111827' },
  historyDeltaBadge: { borderRadius: 6, paddingHorizontal: 5, paddingVertical: 1 },
  historyDeltaText: { fontSize: 11, fontWeight: '700' },
  historyTime: { fontSize: 10, color: '#9CA3AF' },
  historyActor: { fontSize: 11, color: '#6B7280' },
});

// ─── Bulk Restock Sheet Styles ────────────────────────────────────────────────

const brs = StyleSheet.create({
  kav: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { ...StyleSheet.absoluteFillObject, zIndex: 10 },
  sheet: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    backgroundColor: '#FFF',
    borderTopLeftRadius: 28, borderTopRightRadius: 28,
    paddingHorizontal: 20,
    paddingBottom: Platform.OS === 'web' ? 40 : 32,
    paddingTop: 12,
    zIndex: 20,
    shadowColor: '#000', shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.18, shadowRadius: 24, elevation: 32,
    maxHeight: '85%',
  },
  handle: {
    alignSelf: 'center', width: 40, height: 4,
    borderRadius: 2, backgroundColor: '#E5E7EB', marginBottom: 16,
  },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 16 },
  sheetIconWrap: {
    width: 42, height: 42, borderRadius: 21,
    backgroundColor: '#ECFDF5',
    alignItems: 'center', justifyContent: 'center',
  },
  sheetTitle: { fontSize: 16, fontWeight: '700', color: '#111827' },
  sheetSub: { fontSize: 12, color: '#6B7280', marginTop: 2 },
  closeBtn: {
    width: 32, height: 32, borderRadius: 16,
    backgroundColor: '#F3F4F6',
    alignItems: 'center', justifyContent: 'center',
  },

  scroll: { maxHeight: 320, marginBottom: 16 },

  itemRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: '#F3F4F6',
  },
  itemRowLast: { borderBottomWidth: 0 },
  itemLeft: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8 },
  itemIconWrap: {
    width: 32, height: 32, borderRadius: 8,
    backgroundColor: '#EEF2FF',
    alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  itemName: { fontSize: 13, fontWeight: '600', color: '#111827', lineHeight: 18 },
  itemCurrent: { fontSize: 11, color: '#9CA3AF', marginTop: 2 },
  itemInput: {
    width: 72, height: 44, borderRadius: 10,
    borderWidth: 1.5, borderColor: '#E5E7EB',
    fontSize: 18, fontWeight: '700', color: '#111827',
    backgroundColor: '#FAFAFA', textAlign: 'center',
  },
  itemInputError: { borderColor: '#EF4444' },

  sheetActions: { flexDirection: 'row', gap: 12 },
  cancelBtn: {
    flex: 1, height: 48, borderRadius: 14,
    borderWidth: 1, borderColor: '#E5E7EB',
    alignItems: 'center', justifyContent: 'center',
  },
  cancelTxt: { fontSize: 14, fontWeight: '600', color: '#6B7280' },
  submitBtn: { flex: 2, borderRadius: 14, overflow: 'hidden' },
  submitBtnDisabled: { opacity: 0.5 },
  submitGrad: {
    height: 48, flexDirection: 'row',
    alignItems: 'center', justifyContent: 'center', gap: 8,
  },
  submitTxt: { fontSize: 15, fontWeight: '700', color: '#FFF' },
});
