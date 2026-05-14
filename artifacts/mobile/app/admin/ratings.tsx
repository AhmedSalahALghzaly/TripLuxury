import React, { useState, useCallback, useMemo, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Modal,
  ScrollView,
  RefreshControl,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  Alert,
} from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { useTheme } from '../../src/hooks/useTheme';
import { useTranslation } from '../../src/hooks/useTranslation';
import { ratingsApi, carModelsApi } from '../../src/services/api';
import { Header } from '../../src/components/Header';
import { NEON_NIGHT_THEME, useAppStore } from '../../src/store/appStore';
import { wsService } from '../../src/services/websocketService';
import { AccessGuard as __AccessGuard__ } from '../../src/components/AccessGuard';

interface OrderLineItem {
  name: string;
  name_ar?: string | null;
  qty?: number;
  quantity?: number;
  price?: number;
  unit_price?: number;
}

interface Rating {
  id: string;
  rating: number;
  comment?: string | null;
  user_name?: string | null;
  order_id: string;
  restaurant_id?: string | null;
  restaurant_name?: string | null;
  restaurant_name_ar?: string | null;
  created_at: string;
  admin_reply?: string | null;
  admin_reply_at?: string | null;
  order_items?: OrderLineItem[] | null;
}

interface RatingStats {
  avg_rating: string | null;
  total_count: string;
  star_1: string;
  star_2: string;
  star_3: string;
  star_4: string;
  star_5: string;
}

interface Restaurant {
  id: string;
  name?: string | null;
  name_ar?: string | null;
}

const STAR_COLOR = '#F59E0B';
const DELETE_COLOR = '#EF4444';

function StarRow({ rating, size = 16 }: { rating: number; size?: number }) {
  return (
    <View style={starRowStyles.row}>
      {[1, 2, 3, 4, 5].map((s) => (
        <Ionicons
          key={s}
          name={s <= rating ? 'star' : 'star-outline'}
          size={size}
          color={STAR_COLOR}
        />
      ))}
    </View>
  );
}

const starRowStyles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 2 },
});

const REPLY_COLOR = '#10B981';

const RatingItem = React.memo(({
  item,
  colors,
  language,
  isRTL,
  onDelete,
  onReply,
}: {
  item: Rating;
  colors: any;
  language: string;
  isRTL: boolean;
  onDelete: (id: string, name: string) => void;
  onReply: (item: Rating) => void;
}) => {
  const restaurantName = language === 'ar'
    ? (item.restaurant_name_ar || item.restaurant_name || (language === 'ar' ? 'غير محدد' : 'Unknown'))
    : (item.restaurant_name || (language === 'ar' ? 'غير محدد' : 'Unknown'));

  const formatDate = (dateStr: string) =>
    new Date(dateStr).toLocaleDateString(language === 'ar' ? 'ar-EG' : 'en-US', {
      year: 'numeric', month: 'short', day: 'numeric',
    });

  const shortOrderId = item.order_id.slice(0, 8).toUpperCase();
  const hasReply = !!item.admin_reply;

  return (
    <View style={[ratingItemStyles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <View style={[ratingItemStyles.row, isRTL && ratingItemStyles.rowReverse]}>
        <View style={[ratingItemStyles.avatarCircle, { backgroundColor: NEON_NIGHT_THEME.primary + '20' }]}>
          <Ionicons name="person" size={20} color={NEON_NIGHT_THEME.primary} />
        </View>
        <View style={ratingItemStyles.info}>
          <Text style={[ratingItemStyles.userName, { color: colors.text }]} numberOfLines={1}>
            {item.user_name || (language === 'ar' ? 'مجهول' : 'Anonymous')}
          </Text>
          <StarRow rating={item.rating} size={14} />
          <Text style={[ratingItemStyles.meta, { color: colors.textSecondary }]} numberOfLines={1}>
            {restaurantName} · #{shortOrderId} · {formatDate(item.created_at)}
          </Text>
          {!!item.comment && (
            <Text style={[ratingItemStyles.comment, { color: colors.textSecondary }]} numberOfLines={3}>
              {item.comment}
            </Text>
          )}
          {item.order_items && item.order_items.length > 0 && (
            <View style={[ratingItemStyles.itemsBox, { backgroundColor: NEON_NIGHT_THEME.primary + '08', borderColor: NEON_NIGHT_THEME.primary + '20' }]}>
              <Text style={[ratingItemStyles.itemsLabel, { color: NEON_NIGHT_THEME.primary }]}>
                {language === 'ar' ? 'الطلب:' : 'Order:'}
              </Text>
              {item.order_items.slice(0, 3).map((li, idx) => {
                const qty = li.qty ?? li.quantity ?? 1;
                const itemName = language === 'ar' && li.name_ar ? li.name_ar : li.name;
                return (
                  <Text key={idx} style={[ratingItemStyles.itemsRow, { color: colors.textSecondary }]} numberOfLines={1}>
                    {qty > 1 ? `${qty}× ` : ''}{itemName}
                  </Text>
                );
              })}
              {item.order_items.length > 3 && (
                <Text style={[ratingItemStyles.itemsMore, { color: colors.textSecondary }]}>
                  +{item.order_items.length - 3} {language === 'ar' ? 'أكثر' : 'more'}
                </Text>
              )}
            </View>
          )}
        </View>
        <TouchableOpacity
          style={ratingItemStyles.deleteBtn}
          onPress={() => onDelete(item.id, item.user_name || shortOrderId)}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Ionicons name="trash-outline" size={18} color={DELETE_COLOR} />
        </TouchableOpacity>
      </View>

      {hasReply && (
        <View style={[ratingItemStyles.replyBox, { backgroundColor: REPLY_COLOR + '10', borderColor: REPLY_COLOR + '30' }]}>
          <View style={[ratingItemStyles.replyHeader, isRTL && ratingItemStyles.rowReverse]}>
            <Ionicons name="chatbubble-ellipses" size={13} color={REPLY_COLOR} />
            <Text style={[ratingItemStyles.replyLabel, { color: REPLY_COLOR }]}>
              {language === 'ar' ? 'رد الإدارة' : 'Owner replied'}
            </Text>
            {item.admin_reply_at && (
              <Text style={[ratingItemStyles.replyDate, { color: colors.textSecondary }]}>
                · {formatDate(item.admin_reply_at)}
              </Text>
            )}
          </View>
          <Text style={[ratingItemStyles.replyText, { color: colors.text }]} numberOfLines={4}>
            {item.admin_reply}
          </Text>
        </View>
      )}

      <TouchableOpacity
        style={[ratingItemStyles.replyBtn, { borderColor: hasReply ? REPLY_COLOR + '50' : colors.border, backgroundColor: hasReply ? REPLY_COLOR + '08' : 'transparent' }]}
        onPress={() => onReply(item)}
        activeOpacity={0.7}
      >
        <Ionicons name={hasReply ? 'create-outline' : 'chatbubble-outline'} size={14} color={REPLY_COLOR} />
        <Text style={[ratingItemStyles.replyBtnText, { color: REPLY_COLOR }]}>
          {hasReply
            ? (language === 'ar' ? 'تعديل الرد' : 'Edit reply')
            : (language === 'ar' ? 'رد' : 'Reply')}
        </Text>
      </TouchableOpacity>
    </View>
  );
});

const ratingItemStyles = StyleSheet.create({
  card: {
    marginHorizontal: 16,
    marginBottom: 10,
    borderRadius: 12,
    borderWidth: 1,
    padding: 14,
    gap: 10,
  },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  rowReverse: { flexDirection: 'row-reverse' },
  itemsBox: {
    borderRadius: 6,
    borderWidth: 1,
    padding: 8,
    gap: 3,
    marginTop: 4,
  },
  itemsLabel: { fontSize: 11, fontWeight: '700', marginBottom: 2 },
  itemsRow: { fontSize: 11, lineHeight: 15 },
  itemsMore: { fontSize: 10, fontStyle: 'italic', marginTop: 1 },
  avatarCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  info: { flex: 1, gap: 4 },
  userName: { fontSize: 14, fontWeight: '700' },
  meta: { fontSize: 12, marginTop: 2 },
  comment: { fontSize: 13, marginTop: 4, lineHeight: 18 },
  deleteBtn: { paddingTop: 2 },
  replyBox: {
    borderRadius: 8,
    borderWidth: 1,
    padding: 10,
    gap: 4,
  },
  replyHeader: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  replyLabel: { fontSize: 12, fontWeight: '700' },
  replyDate: { fontSize: 11 },
  replyText: { fontSize: 13, lineHeight: 18 },
  replyBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1,
  },
  replyBtnText: { fontSize: 13, fontWeight: '600' },
});

function StatsCard({
  stats,
  colors,
  language,
  activeRestaurantName,
}: {
  stats: RatingStats | null | undefined;
  colors: any;
  language: string;
  activeRestaurantName?: string | null;
}) {
  if (!stats) return null;

  const avg = stats.avg_rating ? parseFloat(stats.avg_rating) : 0;
  const total = parseInt(stats.total_count, 10) || 0;
  const starCounts = [
    parseInt(stats.star_5, 10) || 0,
    parseInt(stats.star_4, 10) || 0,
    parseInt(stats.star_3, 10) || 0,
    parseInt(stats.star_2, 10) || 0,
    parseInt(stats.star_1, 10) || 0,
  ];

  return (
    <View style={[statsStyles.card, { backgroundColor: NEON_NIGHT_THEME.primary }]}>
      <View style={statsStyles.left}>
        <Text style={statsStyles.avgValue}>{avg > 0 ? avg.toFixed(1) : '—'}</Text>
        <StarRow rating={Math.round(avg)} size={18} />
        <Text style={statsStyles.totalLabel}>
          {total} {language === 'ar' ? 'تقييم' : 'ratings'}
        </Text>
        {!!activeRestaurantName && (
          <View style={statsStyles.restaurantBadge}>
            <Ionicons name="storefront-outline" size={9} color={NEON_NIGHT_THEME.primary} />
            <Text style={statsStyles.restaurantBadgeText} numberOfLines={2}>
              {activeRestaurantName}
            </Text>
          </View>
        )}
      </View>
      <View style={statsStyles.divider} />
      <View style={statsStyles.bars}>
        {[5, 4, 3, 2, 1].map((star, idx) => {
          const count = starCounts[idx];
          const fillFlex = total > 0 ? Math.round((count / total) * 100) : 0;
          const emptyFlex = 100 - fillFlex;
          return (
            <View key={star} style={statsStyles.barRow}>
              <Text style={statsStyles.starLabel}>{star}</Text>
              <Ionicons name="star" size={10} color={STAR_COLOR} />
              <View style={statsStyles.barTrack}>
                <View style={[statsStyles.barFill, { flex: fillFlex || 0.001 }]} />
                <View style={{ flex: emptyFlex || 0.001 }} />
              </View>
              <Text style={statsStyles.barCount}>{count}</Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}

const statsStyles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    borderRadius: 16,
    padding: 18,
    marginHorizontal: 16,
    marginBottom: 12,
  },
  left: { alignItems: 'center', justifyContent: 'center', width: 80 },
  avgValue: { fontSize: 36, fontWeight: '800', color: '#FFF' },
  totalLabel: { fontSize: 11, color: 'rgba(255,255,255,0.7)', marginTop: 4 },
  divider: { width: 1, backgroundColor: 'rgba(255,255,255,0.3)', marginHorizontal: 16 },
  bars: { flex: 1, justifyContent: 'space-between' },
  barRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  starLabel: { color: '#FFF', fontSize: 11, width: 8, textAlign: 'center' },
  barTrack: { flex: 1, height: 6, borderRadius: 3, overflow: 'hidden', flexDirection: 'row', backgroundColor: 'rgba(255,255,255,0.2)' },
  barFill: { height: '100%', backgroundColor: STAR_COLOR, borderRadius: 3 },
  barCount: { color: 'rgba(255,255,255,0.8)', fontSize: 11, width: 22, textAlign: 'right' },
  restaurantBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: 'rgba(255,255,255,0.92)',
    borderRadius: 8,
    paddingHorizontal: 6,
    paddingVertical: 3,
    marginTop: 6,
    maxWidth: 76,
  },
  restaurantBadgeText: {
    fontSize: 9,
    fontWeight: '700',
    color: NEON_NIGHT_THEME.primary,
    flexShrink: 1,
  },
});

function StarFilterBar({
  starFilter,
  onStarFilter,
  colors,
  language,
}: {
  starFilter: number | null;
  onStarFilter: (s: number | null) => void;
  colors: any;
  language: string;
}) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={filterStyles.container}
    >
      <TouchableOpacity
        style={[filterStyles.chip, { borderColor: colors.border, backgroundColor: starFilter === null ? NEON_NIGHT_THEME.primary : colors.card }]}
        onPress={() => onStarFilter(null)}
      >
        <Text style={[filterStyles.chipText, { color: starFilter === null ? '#FFF' : colors.text }]}>
          {language === 'ar' ? 'الكل' : 'All'}
        </Text>
      </TouchableOpacity>
      {[5, 4, 3, 2, 1].map((s) => (
        <TouchableOpacity
          key={s}
          style={[filterStyles.chip, { borderColor: colors.border, backgroundColor: starFilter === s ? STAR_COLOR : colors.card }]}
          onPress={() => onStarFilter(starFilter === s ? null : s)}
        >
          <Ionicons name="star" size={13} color={starFilter === s ? '#FFF' : STAR_COLOR} />
          <Text style={[filterStyles.chipText, { color: starFilter === s ? '#FFF' : colors.text }]}>{s}</Text>
        </TouchableOpacity>
      ))}
    </ScrollView>
  );
}

const filterStyles = StyleSheet.create({
  container: { paddingHorizontal: 16, paddingBottom: 8, gap: 8, flexDirection: 'row', alignItems: 'center' },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20, borderWidth: 1 },
  chipText: { fontSize: 13, fontWeight: '600' },
});

function RestaurantPicker({
  restaurants,
  restaurantFilter,
  onRestaurantFilter,
  colors,
  language,
  isRTL,
}: {
  restaurants: Restaurant[];
  restaurantFilter: string | null;
  onRestaurantFilter: (id: string | null) => void;
  colors: any;
  language: string;
  isRTL: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');

  const selectedName = useMemo(() => {
    if (!restaurantFilter) return language === 'ar' ? 'جميع المطاعم' : 'All Restaurants';
    const r = restaurants.find((x) => x.id === restaurantFilter);
    if (!r) return language === 'ar' ? 'جميع المطاعم' : 'All Restaurants';
    return language === 'ar' ? (r.name_ar || r.name || '') : (r.name || '');
  }, [restaurantFilter, restaurants, language]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return restaurants;
    return restaurants.filter((r) => {
      const n = ((language === 'ar' ? r.name_ar : r.name) || r.name || '').toLowerCase();
      return n.includes(q);
    });
  }, [search, restaurants, language]);

  const handleSelect = useCallback((id: string | null) => {
    onRestaurantFilter(id);
    setSearch('');
    setOpen(false);
  }, [onRestaurantFilter]);

  const handleOpen = useCallback(() => {
    setSearch('');
    setOpen(true);
  }, []);

  const handleClose = useCallback(() => {
    setSearch('');
    setOpen(false);
  }, []);

  return (
    <>
      <View style={[pickerStyles.buttonWrap, { backgroundColor: colors.card, borderColor: restaurantFilter ? NEON_NIGHT_THEME.primary : colors.border }]}>
        <TouchableOpacity
          style={pickerStyles.buttonInner}
          onPress={handleOpen}
          activeOpacity={0.8}
        >
          <Ionicons name="storefront-outline" size={16} color={restaurantFilter ? NEON_NIGHT_THEME.primary : colors.textSecondary} />
          <Text
            style={[pickerStyles.buttonText, { color: restaurantFilter ? NEON_NIGHT_THEME.primary : colors.text }]}
            numberOfLines={1}
          >
            {selectedName}
          </Text>
          {!restaurantFilter && <Ionicons name="chevron-down" size={16} color={colors.textSecondary} />}
        </TouchableOpacity>
        {!!restaurantFilter && (
          <TouchableOpacity
            style={pickerStyles.clearBtn}
            onPress={() => onRestaurantFilter(null)}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Ionicons name="close-circle" size={18} color={NEON_NIGHT_THEME.primary} />
          </TouchableOpacity>
        )}
      </View>

      <Modal
        visible={open}
        transparent
        animationType="slide"
        onRequestClose={handleClose}
      >
        <KeyboardAvoidingView
          style={pickerStyles.overlay}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
          <TouchableOpacity style={pickerStyles.backdrop} activeOpacity={1} onPress={handleClose} />
          <View style={[pickerStyles.sheet, { backgroundColor: colors.card }]}>
            <View style={[pickerStyles.sheetHeader, isRTL && pickerStyles.rowReverse]}>
              <Text style={[pickerStyles.sheetTitle, { color: colors.text }]}>
                {language === 'ar' ? 'اختر مطعماً' : 'Select Restaurant'}
              </Text>
              <TouchableOpacity onPress={handleClose} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Ionicons name="close" size={22} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>

            <View style={[pickerStyles.searchRow, { backgroundColor: colors.surface ?? colors.background, borderColor: colors.border }]}>
              <Ionicons name="search-outline" size={16} color={colors.textSecondary} />
              <TextInput
                style={[pickerStyles.searchInput, { color: colors.text }]}
                placeholder={language === 'ar' ? 'ابحث عن مطعم...' : 'Search restaurants...'}
                placeholderTextColor={colors.textSecondary}
                value={search}
                onChangeText={setSearch}
                autoCorrect={false}
                textAlign={isRTL ? 'right' : 'left'}
              />
              {!!search && (
                <TouchableOpacity onPress={() => setSearch('')} hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}>
                  <Ionicons name="close-circle" size={16} color={colors.textSecondary} />
                </TouchableOpacity>
              )}
            </View>

            <ScrollView style={pickerStyles.list} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
              <TouchableOpacity
                style={[pickerStyles.option, { borderColor: colors.border }, !restaurantFilter && pickerStyles.optionActive]}
                onPress={() => handleSelect(null)}
              >
                <View style={[pickerStyles.optionIcon, { backgroundColor: (!restaurantFilter ? NEON_NIGHT_THEME.primary : colors.border) + '22' }]}>
                  <Ionicons name="grid-outline" size={16} color={!restaurantFilter ? NEON_NIGHT_THEME.primary : colors.textSecondary} />
                </View>
                <Text style={[pickerStyles.optionText, { color: !restaurantFilter ? NEON_NIGHT_THEME.primary : colors.text, fontWeight: !restaurantFilter ? '700' : '500' }]}>
                  {language === 'ar' ? 'جميع المطاعم' : 'All Restaurants'}
                </Text>
                {!restaurantFilter && <Ionicons name="checkmark-circle" size={20} color={NEON_NIGHT_THEME.primary} />}
              </TouchableOpacity>

              {filtered.map((r) => {
                const active = restaurantFilter === r.id;
                const name = language === 'ar' ? (r.name_ar || r.name || '') : (r.name || r.name_ar || '');
                return (
                  <TouchableOpacity
                    key={r.id}
                    style={[pickerStyles.option, { borderColor: colors.border }, active && pickerStyles.optionActive]}
                    onPress={() => handleSelect(r.id)}
                  >
                    <View style={[pickerStyles.optionIcon, { backgroundColor: (active ? NEON_NIGHT_THEME.primary : colors.border) + '22' }]}>
                      <Ionicons name="storefront-outline" size={16} color={active ? NEON_NIGHT_THEME.primary : colors.textSecondary} />
                    </View>
                    <Text style={[pickerStyles.optionText, { color: active ? NEON_NIGHT_THEME.primary : colors.text, fontWeight: active ? '700' : '500' }]} numberOfLines={1}>
                      {name}
                    </Text>
                    {active && <Ionicons name="checkmark-circle" size={20} color={NEON_NIGHT_THEME.primary} />}
                  </TouchableOpacity>
                );
              })}

              {filtered.length === 0 && (
                <View style={pickerStyles.noResults}>
                  <Ionicons name="search-outline" size={28} color={colors.border} />
                  <Text style={[pickerStyles.noResultsText, { color: colors.textSecondary }]}>
                    {language === 'ar' ? 'لا توجد نتائج' : 'No results'}
                  </Text>
                </View>
              )}
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </>
  );
}

const pickerStyles = StyleSheet.create({
  buttonWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 16,
    borderRadius: 12,
    borderWidth: 1.5,
    marginBottom: 8,
    overflow: 'hidden',
  },
  buttonInner: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 11,
  },
  clearBtn: {
    paddingHorizontal: 12,
    paddingVertical: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonText: { flex: 1, fontSize: 14, fontWeight: '600' },
  overlay: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { flex: 1 },
  sheet: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingTop: 8,
    maxHeight: '75%',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 16,
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(0,0,0,0.1)',
  },
  rowReverse: { flexDirection: 'row-reverse' },
  sheetTitle: { fontSize: 17, fontWeight: '700' },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    margin: 12,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 10,
    borderWidth: 1,
  },
  searchInput: { flex: 1, fontSize: 14, paddingVertical: 0 },
  list: { paddingHorizontal: 12, paddingBottom: 24 },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 8,
    borderRadius: 10,
    borderWidth: 0,
    marginBottom: 2,
  },
  optionActive: { backgroundColor: NEON_NIGHT_THEME.primary + '12' },
  optionIcon: { width: 32, height: 32, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  optionText: { flex: 1, fontSize: 14 },
  noResults: { alignItems: 'center', paddingVertical: 32, gap: 8 },
  noResultsText: { fontSize: 14 },
});

const QUERY_KEY_BASE = ['admin', 'ratings'];

function AdminRatingsScreen() {
  const { colors } = useTheme();
  const { language, isRTL } = useTranslation();
  const router = useRouter();
  const queryClient = useQueryClient();

  // Persist filter state in Zustand so it survives navigation round-trips
  const storedRestaurantFilter = useAppStore((s) => s.adminRatingsRestaurantFilter);
  const storedStarFilter = useAppStore((s) => s.adminRatingsStarFilter);
  const setAdminRatingsFilter = useAppStore((s) => s.setAdminRatingsFilter);

  const [starFilter, setStarFilter] = useState<number | null>(storedStarFilter);
  const [restaurantFilter, setRestaurantFilter] = useState<string | null>(storedRestaurantFilter);
  const [page, setPage] = useState(1);
  const [isExporting, setIsExporting] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<{ visible: boolean; id: string; label: string }>({ visible: false, id: '', label: '' });
  const [replyModal, setReplyModal] = useState<{ visible: boolean; item: Rating | null }>({ visible: false, item: null });
  const [replyText, setReplyText] = useState('');

  const { data: restaurantsData } = useQuery({
    queryKey: ['admin', 'restaurants-list'],
    queryFn: async () => {
      const res = await carModelsApi.getAll();
      return (res.data as Restaurant[]) ?? [];
    },
    staleTime: 5 * 60 * 1000,
  });
  const restaurants: Restaurant[] = restaurantsData ?? [];

  const queryKey = useMemo(
    () => [...QUERY_KEY_BASE, { star: starFilter, restaurant: restaurantFilter, page }],
    [starFilter, restaurantFilter, page],
  );

  const { data, isLoading, isRefetching, refetch } = useQuery({
    queryKey,
    queryFn: async () => {
      const res = await ratingsApi.adminGetAll({
        page,
        limit: 20,
        star: starFilter ?? undefined,
        restaurant_id: restaurantFilter ?? undefined,
      });
      return res.data as {
        ratings: Rating[];
        total: number;
        page: number;
        limit: number;
        stats: RatingStats | null;
      };
    },
    staleTime: 60 * 1000,
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => ratingsApi.adminDelete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEY_BASE });
    },
  });

  const replyMutation = useMutation({
    mutationFn: ({ id, reply }: { id: string; reply: string }) =>
      ratingsApi.adminReply(id, reply),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEY_BASE });
      setReplyModal({ visible: false, item: null });
      setReplyText('');
    },
  });

  const deleteReplyMutation = useMutation({
    mutationFn: (id: string) => ratingsApi.adminDeleteReply(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEY_BASE });
      setReplyModal({ visible: false, item: null });
      setReplyText('');
    },
  });

  const handleDeletePress = useCallback((id: string, label: string) => {
    setDeleteConfirm({ visible: true, id, label });
  }, []);

  const handleConfirmDelete = useCallback(() => {
    if (deleteConfirm.id) {
      deleteMutation.mutate(deleteConfirm.id);
    }
    setDeleteConfirm({ visible: false, id: '', label: '' });
  }, [deleteConfirm.id, deleteMutation]);

  const handleReplyPress = useCallback((item: Rating) => {
    setReplyText(item.admin_reply ?? '');
    setReplyModal({ visible: true, item });
  }, []);

  const handleSubmitReply = useCallback(() => {
    if (!replyModal.item) return;
    const trimmed = replyText.trim();
    if (!trimmed) return;
    replyMutation.mutate({ id: replyModal.item.id, reply: trimmed });
  }, [replyModal.item, replyText, replyMutation]);

  const handleDeleteReply = useCallback(() => {
    if (!replyModal.item) return;
    deleteReplyMutation.mutate(replyModal.item.id);
  }, [replyModal.item, deleteReplyMutation]);

  const handleExport = useCallback(async () => {
    if (isExporting) return;
    setIsExporting(true);
    try {
      const params: { restaurant_id?: string; star?: number } = {};
      if (restaurantFilter) params.restaurant_id = restaurantFilter;
      if (starFilter !== null) params.star = starFilter;
      const res = await ratingsApi.adminExportCsv(params);
      const csvText = res.data as string;
      const dateStr = new Date().toISOString().slice(0, 10);
      const fileName = `ratings-${dateStr}.csv`;
      const fileUri = `${FileSystem.cacheDirectory ?? ''}${fileName}`;
      await FileSystem.writeAsStringAsync(fileUri, csvText, { encoding: FileSystem.EncodingType.UTF8 });
      const canShare = await Sharing.isAvailableAsync();
      if (canShare) {
        await Sharing.shareAsync(fileUri, { mimeType: 'text/csv', dialogTitle: fileName });
      } else {
        Alert.alert(
          language === 'ar' ? 'المشاركة غير متاحة' : 'Sharing Unavailable',
          language === 'ar'
            ? 'لا يمكن فتح نافذة المشاركة على هذا الجهاز.'
            : 'Sharing is not available on this device.',
        );
      }
    } catch {
      Alert.alert(
        language === 'ar' ? 'خطأ في التصدير' : 'Export Failed',
        language === 'ar'
          ? 'تعذّر تصدير التقييمات. يرجى المحاولة مرة أخرى.'
          : 'Could not export ratings. Please try again.',
      );
    } finally {
      setIsExporting(false);
    }
  }, [isExporting, restaurantFilter, starFilter, language]);

  const handleStarFilter = useCallback((s: number | null) => {
    setStarFilter(s);
    setAdminRatingsFilter(restaurantFilter, s);
    setPage(1);
  }, [restaurantFilter, setAdminRatingsFilter]);

  const handleRestaurantFilter = useCallback((id: string | null) => {
    setRestaurantFilter(id);
    // Selecting "All Restaurants" (null) also resets the star filter so stats
    // are always consistent with the full-restaurant view.
    const newStar = id === null ? null : starFilter;
    if (id === null) setStarFilter(null);
    setAdminRatingsFilter(id, newStar);
    setPage(1);
  }, [starFilter, setAdminRatingsFilter, setStarFilter]);

  const handleClearFilters = useCallback(() => {
    setRestaurantFilter(null);
    setStarFilter(null);
    setAdminRatingsFilter(null, null);
    setPage(1);
  }, [setAdminRatingsFilter]);

  // Real-time: refresh list when ratings are mutated by other users/screens
  useEffect(() => {
    const removeHandler = wsService.addMessageHandler(
      'admin-ratings-ws',
      () => {
        queryClient.invalidateQueries({ queryKey: QUERY_KEY_BASE });
      },
      {
        types: ['rating_created', 'rating_deleted', 'rating_reply_updated'],
        priority: 5,
      },
    );
    return removeHandler;
  }, [queryClient]);

  const ratings = data?.ratings ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / (data?.limit ?? 20)));

  const renderItem = useCallback(({ item }: { item: Rating }) => (
    <RatingItem
      item={item}
      colors={colors}
      language={language}
      isRTL={isRTL}
      onDelete={handleDeletePress}
      onReply={handleReplyPress}
    />
  ), [colors, language, isRTL, handleDeletePress, handleReplyPress]);

  const keyExtractor = useCallback((item: Rating) => item.id, []);

  const ListHeader = useMemo(() => (
    <View>
      <View style={[breadcrumbStyles.row, isRTL && breadcrumbStyles.rowReverse]}>
        <TouchableOpacity onPress={() => router.push('/admin' as any)}>
          <Text style={[breadcrumbStyles.link, { color: colors.primary }]}>
            {language === 'ar' ? 'لوحة التحكم' : 'Admin'}
          </Text>
        </TouchableOpacity>
        <Ionicons name={isRTL ? 'chevron-back' : 'chevron-forward'} size={16} color={colors.textSecondary} />
        <Text style={[breadcrumbStyles.current, { color: colors.textSecondary }]}>
          {language === 'ar' ? 'التقييمات' : 'Ratings'}
        </Text>
      </View>

      <StatsCard
        stats={data?.stats}
        colors={colors}
        language={language}
        activeRestaurantName={
          restaurantFilter
            ? (language === 'ar'
                ? restaurants.find((r) => r.id === restaurantFilter)?.name_ar || restaurants.find((r) => r.id === restaurantFilter)?.name
                : restaurants.find((r) => r.id === restaurantFilter)?.name)
            : null
        }
      />

      <Text style={[sectionLabelStyles.label, { color: colors.textSecondary }]}>
        {language === 'ar' ? 'تصفية حسب المطعم' : 'Filter by restaurant'}
      </Text>
      {restaurants.length > 0 && (
        <RestaurantPicker
          restaurants={restaurants}
          restaurantFilter={restaurantFilter}
          onRestaurantFilter={handleRestaurantFilter}
          colors={colors}
          language={language}
          isRTL={isRTL}
        />
      )}

      <Text style={[sectionLabelStyles.label, { color: colors.textSecondary }]}>
        {language === 'ar' ? 'تصفية حسب النجوم' : 'Filter by stars'}
      </Text>
      <StarFilterBar
        starFilter={starFilter}
        onStarFilter={handleStarFilter}
        colors={colors}
        language={language}
      />

      <View style={[listTitleStyles.row, isRTL && listTitleStyles.rowReverse]}>
        <Text style={[listTitleStyles.title, { color: colors.text }]}>
          {language === 'ar' ? 'جميع التقييمات' : 'All Ratings'}
        </Text>
        <Text style={[listTitleStyles.count, { color: colors.textSecondary }]}>
          {total} {language === 'ar' ? 'نتيجة' : 'results'}
        </Text>
      </View>
    </View>
  ), [data?.stats, colors, language, isRTL, starFilter, handleStarFilter, restaurantFilter, handleRestaurantFilter, restaurants, total, router]);

  const ListFooter = useMemo(() => {
    if (totalPages <= 1) return null;
    return (
      <View style={paginationStyles.row}>
        <TouchableOpacity
          style={[paginationStyles.btn, { backgroundColor: colors.card, borderColor: colors.border, opacity: page <= 1 ? 0.4 : 1 }]}
          onPress={() => setPage((p) => Math.max(1, p - 1))}
          disabled={page <= 1}
        >
          <Ionicons name="chevron-back" size={18} color={colors.text} />
        </TouchableOpacity>
        <Text style={[paginationStyles.label, { color: colors.textSecondary }]}>
          {page} / {totalPages}
        </Text>
        <TouchableOpacity
          style={[paginationStyles.btn, { backgroundColor: colors.card, borderColor: colors.border, opacity: page >= totalPages ? 0.4 : 1 }]}
          onPress={() => setPage((p) => Math.min(totalPages, p + 1))}
          disabled={page >= totalPages}
        >
          <Ionicons name="chevron-forward" size={18} color={colors.text} />
        </TouchableOpacity>
      </View>
    );
  }, [page, totalPages, colors]);

  const ListEmpty = useMemo(() => (
    <View style={emptyStyles.container}>
      {isLoading ? (
        <ActivityIndicator size="large" color={colors.primary} />
      ) : (
        <>
          <Ionicons name="star-outline" size={48} color={colors.border} />
          <Text style={[emptyStyles.text, { color: colors.textSecondary }]}>
            {language === 'ar' ? 'لا توجد تقييمات' : 'No ratings found'}
          </Text>
        </>
      )}
    </View>
  ), [isLoading, colors, language]);

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['bottom']}>
      <Header
        title={language === 'ar' ? 'إدارة التقييمات' : 'Manage Ratings'}
        showBack
        showSearch={false}
        showCart={false}
      />

      <View style={[exportBarStyles.bar, { backgroundColor: colors.background, borderBottomColor: colors.border }]}>
        {(restaurantFilter !== null || starFilter !== null) && (
          <TouchableOpacity
            style={[exportBarStyles.btn, exportBarStyles.clearBtn, { backgroundColor: DELETE_COLOR + '18', borderColor: DELETE_COLOR }]}
            onPress={handleClearFilters}
            activeOpacity={0.7}
          >
            <Ionicons name="close-circle-outline" size={16} color={DELETE_COLOR} />
            <Text style={[exportBarStyles.btnText, { color: DELETE_COLOR }]}>
              {language === 'ar' ? 'مسح الفلاتر' : 'Clear filters'}
            </Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity
          style={[exportBarStyles.btn, { backgroundColor: NEON_NIGHT_THEME.primary + '18', borderColor: NEON_NIGHT_THEME.primary }]}
          onPress={handleExport}
          disabled={isExporting}
          activeOpacity={0.7}
        >
          {isExporting ? (
            <ActivityIndicator size="small" color={NEON_NIGHT_THEME.primary} />
          ) : (
            <Ionicons name="download-outline" size={16} color={NEON_NIGHT_THEME.primary} />
          )}
          <Text style={[exportBarStyles.btnText, { color: NEON_NIGHT_THEME.primary }]}>
            {isExporting
              ? (language === 'ar' ? 'جارٍ التصدير...' : 'Exporting...')
              : (language === 'ar' ? 'تصدير CSV' : 'Export CSV')}
          </Text>
        </TouchableOpacity>
      </View>

      <FlashList
        data={ratings}
        renderItem={renderItem}
        keyExtractor={keyExtractor}
        estimatedItemSize={100}
        ListHeaderComponent={ListHeader}
        ListFooterComponent={ListFooter}
        ListEmptyComponent={ListEmpty}
        contentContainerStyle={styles.listContent}
        refreshControl={
          <RefreshControl
            refreshing={isRefetching}
            onRefresh={refetch}
            colors={[colors.primary]}
            tintColor={colors.primary}
          />
        }
        showsVerticalScrollIndicator={false}
      />

      <Modal
        visible={deleteConfirm.visible}
        transparent
        animationType="fade"
        onRequestClose={() => setDeleteConfirm({ visible: false, id: '', label: '' })}
      >
        <View style={delModalStyles.overlay}>
          <View style={[delModalStyles.card, { backgroundColor: colors.card }]}>
            <View style={delModalStyles.iconWrap}>
              <Ionicons name="trash" size={32} color={DELETE_COLOR} />
            </View>
            <Text style={[delModalStyles.title, { color: colors.text }]}>
              {language === 'ar' ? 'حذف التقييم' : 'Delete Rating'}
            </Text>
            <Text style={[delModalStyles.msg, { color: colors.textSecondary }]}>
              {language === 'ar'
                ? `هل أنت متأكد من حذف تقييم "${deleteConfirm.label}"؟ لا يمكن التراجع.`
                : `Are you sure you want to delete the rating by "${deleteConfirm.label}"? This cannot be undone.`}
            </Text>
            <View style={delModalStyles.btns}>
              <TouchableOpacity
                style={[delModalStyles.btn, { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1 }]}
                onPress={() => setDeleteConfirm({ visible: false, id: '', label: '' })}
              >
                <Text style={{ color: colors.text, fontWeight: '600', fontSize: 15 }}>
                  {language === 'ar' ? 'إلغاء' : 'Cancel'}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[delModalStyles.btn, { backgroundColor: DELETE_COLOR }]}
                onPress={handleConfirmDelete}
              >
                <Ionicons name="trash" size={16} color="#FFF" />
                <Text style={{ color: '#FFF', fontWeight: '700', fontSize: 15 }}>
                  {language === 'ar' ? 'حذف' : 'Delete'}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <Modal
        visible={replyModal.visible}
        transparent
        animationType="slide"
        onRequestClose={() => { setReplyModal({ visible: false, item: null }); setReplyText(''); }}
      >
        <KeyboardAvoidingView
          style={replyModalStyles.overlay}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
          <TouchableOpacity
            style={replyModalStyles.backdrop}
            activeOpacity={1}
            onPress={() => { setReplyModal({ visible: false, item: null }); setReplyText(''); }}
          />
          <View style={[replyModalStyles.sheet, { backgroundColor: colors.card }]}>
            <View style={[replyModalStyles.header, isRTL && replyModalStyles.rowReverse]}>
              <View style={[replyModalStyles.headerLeft, isRTL && replyModalStyles.rowReverse]}>
                <Ionicons name="chatbubble-ellipses" size={20} color={REPLY_COLOR} />
                <Text style={[replyModalStyles.title, { color: colors.text }]}>
                  {replyModal.item?.admin_reply
                    ? (language === 'ar' ? 'تعديل الرد' : 'Edit Reply')
                    : (language === 'ar' ? 'رد على التقييم' : 'Reply to Rating')}
                </Text>
              </View>
              <TouchableOpacity
                onPress={() => { setReplyModal({ visible: false, item: null }); setReplyText(''); }}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Ionicons name="close" size={22} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>

            {replyModal.item?.comment ? (
              <View style={[replyModalStyles.quoteBox, { backgroundColor: colors.surface ?? colors.background, borderColor: colors.border }]}>
                <Text style={[replyModalStyles.quoteLabel, { color: colors.textSecondary }]} numberOfLines={1}>
                  {replyModal.item.user_name || (language === 'ar' ? 'مجهول' : 'Anonymous')}
                </Text>
                <Text style={[replyModalStyles.quoteText, { color: colors.textSecondary }]} numberOfLines={2}>
                  "{replyModal.item.comment}"
                </Text>
              </View>
            ) : null}

            <TextInput
              style={[replyModalStyles.input, { backgroundColor: colors.surface ?? colors.background, borderColor: colors.border, color: colors.text }]}
              placeholder={language === 'ar' ? 'اكتب ردك هنا...' : 'Write your reply here...'}
              placeholderTextColor={colors.textSecondary}
              value={replyText}
              onChangeText={setReplyText}
              multiline
              maxLength={500}
              textAlignVertical="top"
              textAlign={isRTL ? 'right' : 'left'}
              autoFocus
            />
            <Text style={[replyModalStyles.charCount, { color: replyText.length > 450 ? DELETE_COLOR : colors.textSecondary }]}>
              {replyText.length}/500
            </Text>

            <View style={replyModalStyles.actions}>
              {replyModal.item?.admin_reply ? (
                <TouchableOpacity
                  style={[replyModalStyles.actionBtn, { borderColor: DELETE_COLOR + '50', backgroundColor: DELETE_COLOR + '08' }]}
                  onPress={handleDeleteReply}
                  disabled={deleteReplyMutation.isPending}
                >
                  <Ionicons name="trash-outline" size={15} color={DELETE_COLOR} />
                  <Text style={[replyModalStyles.actionBtnText, { color: DELETE_COLOR }]}>
                    {language === 'ar' ? 'حذف الرد' : 'Remove reply'}
                  </Text>
                </TouchableOpacity>
              ) : null}
              <TouchableOpacity
                style={[replyModalStyles.submitBtn, { backgroundColor: replyText.trim() ? REPLY_COLOR : colors.border, opacity: replyMutation.isPending ? 0.6 : 1 }]}
                onPress={handleSubmitReply}
                disabled={!replyText.trim() || replyMutation.isPending}
              >
                {replyMutation.isPending ? (
                  <ActivityIndicator size="small" color="#FFF" />
                ) : (
                  <Ionicons name="send" size={15} color="#FFF" />
                )}
                <Text style={replyModalStyles.submitBtnText}>
                  {language === 'ar' ? 'إرسال' : 'Submit'}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  listContent: { paddingBottom: 24, paddingTop: 8 },
});

const breadcrumbStyles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 16, marginBottom: 14 },
  rowReverse: { flexDirection: 'row-reverse' },
  link: { fontSize: 14 },
  current: { fontSize: 14 },
});

const sectionLabelStyles = StyleSheet.create({
  label: { fontSize: 12, fontWeight: '600', paddingHorizontal: 16, marginBottom: 4, marginTop: 4, textTransform: 'uppercase', letterSpacing: 0.5 },
});

const listTitleStyles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, marginBottom: 8, marginTop: 8 },
  rowReverse: { flexDirection: 'row-reverse' },
  title: { fontSize: 17, fontWeight: '700' },
  count: { fontSize: 13 },
});

const paginationStyles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 16, paddingVertical: 20 },
  btn: { width: 40, height: 40, borderRadius: 20, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  label: { fontSize: 15, fontWeight: '600' },
});

const emptyStyles = StyleSheet.create({
  container: { alignItems: 'center', paddingTop: 60, gap: 12 },
  text: { fontSize: 15 },
});

const exportBarStyles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  btn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
  },
  btnText: { fontSize: 13, fontWeight: '700' },
  clearBtn: { marginRight: 8 },
});

const delModalStyles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center', padding: 24 },
  card: { width: '100%', maxWidth: 400, borderRadius: 20, padding: 24, gap: 12 },
  iconWrap: { alignItems: 'center', marginBottom: 4 },
  title: { fontSize: 20, fontWeight: '700', textAlign: 'center' },
  msg: { fontSize: 14, textAlign: 'center', lineHeight: 20 },
  btns: { flexDirection: 'row', gap: 12, marginTop: 8 },
  btn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 14, borderRadius: 12, gap: 6 },
});

const replyModalStyles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { flex: 1 },
  sheet: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingTop: 8,
    paddingHorizontal: 20,
    paddingBottom: 32,
    gap: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 16,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(0,0,0,0.1)',
  },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  rowReverse: { flexDirection: 'row-reverse' },
  title: { fontSize: 17, fontWeight: '700' },
  quoteBox: {
    borderRadius: 10,
    borderWidth: 1,
    padding: 10,
    gap: 3,
  },
  quoteLabel: { fontSize: 12, fontWeight: '600' },
  quoteText: { fontSize: 13, fontStyle: 'italic', lineHeight: 18 },
  input: {
    borderRadius: 10,
    borderWidth: 1,
    padding: 12,
    fontSize: 15,
    minHeight: 100,
    lineHeight: 22,
  },
  charCount: { fontSize: 12, textAlign: 'right' },
  actions: { flexDirection: 'row', gap: 10, justifyContent: 'flex-end' },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 11,
    borderRadius: 12,
    borderWidth: 1,
  },
  actionBtnText: { fontSize: 14, fontWeight: '600' },
  submitBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 20,
    paddingVertical: 11,
    borderRadius: 12,
  },
  submitBtnText: { color: '#FFF', fontSize: 15, fontWeight: '700' },
});

/* __ACCESS_GUARD_APPLIED__ */
export default function AdminRatingsScreenGuarded(props: any) {
  return (
    <__AccessGuard__ scope="admin">
      <AdminRatingsScreen {...props} />
    </__AccessGuard__>
  );
}
