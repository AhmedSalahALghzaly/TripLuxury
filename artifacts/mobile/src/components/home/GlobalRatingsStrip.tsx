import React, { memo, useState, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  useWindowDimensions,
  TouchableOpacity,
  Modal,
  ScrollView,
  Pressable,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../services/api';
import { wsService } from '../../services/websocketService';
import { useTranslation } from '../../hooks/useTranslation';
import { useTheme } from '../../hooks/useTheme';
import {
  FONTS,
  SPACING,
  RADII,
  COLORS,
  OVERLAYS,
  ELEVATION,
} from '../../constants/luxuryTokens';
import { LinearGradient } from 'expo-linear-gradient';

interface Rating {
  id: string;
  rating: number;
  comment?: string;
  user_name?: string;
  restaurant_name?: string;
  restaurant_name_ar?: string;
  created_at: string;
  admin_reply?: string | null;
  admin_reply_at?: string | null;
  order_items?: Array<{ name: string; name_ar?: string | null; quantity: number }> | null;
}

function relativeTime(dateStr: string, lang: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);
  if (mins < 2) return lang === 'ar' ? 'الآن' : 'Just now';
  if (mins < 60) return lang === 'ar' ? `منذ ${mins} د` : `${mins}m ago`;
  if (hours < 24) return lang === 'ar' ? `منذ ${hours} س` : `${hours}h ago`;
  if (days < 30) return lang === 'ar' ? `منذ ${days} يوم` : `${days}d ago`;
  return lang === 'ar' ? 'منذ أكثر من شهر' : 'Over a month ago';
}

function fullDate(dateStr: string, lang: string): string {
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleDateString(lang === 'ar' ? 'ar-EG' : 'en-GB', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });
  } catch {
    return '';
  }
}

function InitialsAvatar({ name, size = 22 }: { name: string; size?: number }) {
  const initials = name
    .trim()
    .split(/\s+/)
    .map((w) => w[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
  return (
    <View
      style={[
        styles.avatar,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
        },
      ]}
    >
      <Text style={[styles.avatarText, { fontSize: size * 0.38 }]}>{initials}</Text>
    </View>
  );
}

function StarDisplay({ value, size = 12 }: { value: number; size?: number }) {
  return (
    <View style={[styles.starRow, { gap: size * 0.18 }]}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Ionicons
          key={n}
          name={n <= value ? 'star' : 'star-outline'}
          size={size}
          color={n <= value ? COLORS.gold : OVERLAYS.goldHairline}
        />
      ))}
    </View>
  );
}

// ─── Rating Detail Modal ──────────────────────────────────────────────────────

interface RatingDetailModalProps {
  item: Rating | null;
  visible: boolean;
  onClose: () => void;
  isDark: boolean;
  lang: string;
}

const RatingDetailModal = memo(
  ({ item, visible, onClose, isDark, lang }: RatingDetailModalProps) => {
    if (!item) return null;

    const bg = isDark ? '#1B1B1F' : '#FDFAF4';
    const cardBg = isDark ? 'rgba(255,255,255,0.04)' : 'rgba(200,162,74,0.06)';
    const borderColor = isDark ? OVERLAYS.goldInnerGlow : 'rgba(200,162,74,0.25)';
    const textColor = isDark ? COLORS.ivory : COLORS.charcoal;
    const subColor = isDark ? COLORS.goldSoft : COLORS.bronze;
    const overlayColor = isDark ? 'rgba(0,0,0,0.78)' : 'rgba(0,0,0,0.55)';

    const displayName = item.user_name || (lang === 'ar' ? 'ضيف' : 'Guest');
    const restaurantName =
      lang === 'ar'
        ? item.restaurant_name_ar || item.restaurant_name
        : item.restaurant_name;

    return (
      <Modal
        visible={visible}
        transparent
        animationType="slide"
        onRequestClose={onClose}
        statusBarTranslucent
      >
        <Pressable style={[styles.modalOverlay, { backgroundColor: overlayColor }]} onPress={onClose}>
          <Pressable
            style={[styles.modalSheet, { backgroundColor: bg, borderColor }]}
            onPress={() => {}}
          >
            <LinearGradient
              colors={['rgba(200,162,74,0.08)', 'transparent']}
              style={StyleSheet.absoluteFill}
              pointerEvents="none"
            />

            {/* Drag handle */}
            <View style={[styles.dragHandle, { backgroundColor: isDark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.15)' }]} />

            {/* Close button */}
            <TouchableOpacity style={styles.closeBtn} onPress={onClose} hitSlop={12}>
              <Ionicons
                name="close-circle"
                size={28}
                color={isDark ? 'rgba(255,255,255,0.4)' : 'rgba(0,0,0,0.3)'}
              />
            </TouchableOpacity>

            <ScrollView
              showsVerticalScrollIndicator={false}
              contentContainerStyle={styles.modalContent}
            >
              {/* Reviewer header */}
              <View style={styles.reviewerRow}>
                <InitialsAvatar name={displayName} size={52} />
                <View style={styles.reviewerInfo}>
                  <Text style={[styles.reviewerName, { color: textColor }]}>
                    {displayName}
                  </Text>
                  {restaurantName ? (
                    <View style={styles.restaurantRow}>
                      <Ionicons name="restaurant" size={12} color={COLORS.gold} />
                      <Text style={[styles.restaurantLabel, { color: subColor }]} numberOfLines={1}>
                        {restaurantName}
                      </Text>
                    </View>
                  ) : null}
                </View>
              </View>

              {/* Star rating + date */}
              <View style={[styles.ratingBox, { backgroundColor: cardBg, borderColor }]}>
                <View style={styles.ratingBoxInner}>
                  <StarDisplay value={item.rating} size={22} />
                  <Text style={[styles.ratingValue, { color: textColor }]}>
                    {item.rating} / 5
                  </Text>
                </View>
                <View style={styles.dateRow}>
                  <Ionicons name="calendar-outline" size={13} color={subColor} />
                  <Text style={[styles.dateText, { color: subColor }]}>
                    {fullDate(item.created_at, lang)}
                  </Text>
                  <Text style={[styles.relativeText, { color: subColor }]}>
                    · {relativeTime(item.created_at, lang)}
                  </Text>
                </View>
              </View>

              {/* What they ordered */}
              {item.order_items && item.order_items.length > 0 && (
                <View style={[styles.commentBox, { backgroundColor: cardBg, borderColor, gap: 6 }]}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <Ionicons name="restaurant-outline" size={14} color={COLORS.gold} />
                    <Text style={[styles.noComment, { color: subColor, fontWeight: '700', fontSize: 11 }]}>
                      {lang === 'ar' ? 'ما طلبه' : 'What they ordered'}
                    </Text>
                  </View>
                  {item.order_items.slice(0, 3).map((dish, idx) => (
                    <View key={idx} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      <Text style={[styles.noComment, { color: subColor, fontSize: 11 }]}>
                        {dish.quantity}×
                      </Text>
                      <Text style={[styles.noComment, { color: textColor, fontSize: 12, fontWeight: '600', flex: 1 }]} numberOfLines={1}>
                        {lang === 'ar' ? (dish.name_ar || dish.name) : dish.name}
                      </Text>
                    </View>
                  ))}
                </View>
              )}

              {/* Comment */}
              {item.comment ? (
                <View style={[styles.commentBox, { backgroundColor: cardBg, borderColor }]}>
                  <Ionicons
                    name="chatbubble-ellipses-outline"
                    size={16}
                    color={COLORS.gold}
                    style={styles.commentIcon}
                  />
                  <Text
                    style={[
                      styles.modalComment,
                      {
                        color: textColor,
                        textAlign: lang === 'ar' ? 'right' : 'left',
                        writingDirection: lang === 'ar' ? 'rtl' : 'ltr',
                      },
                    ]}
                  >
                    "{item.comment}"
                  </Text>
                </View>
              ) : (
                <View style={[styles.commentBox, { backgroundColor: cardBg, borderColor }]}>
                  <Text style={[styles.noComment, { color: subColor }]}>
                    {lang === 'ar' ? 'لم يترك العميل تعليقاً' : 'No written comment left'}
                  </Text>
                </View>
              )}

              {/* Admin reply */}
              {!!item.admin_reply && (
                <View style={[styles.adminReplyBox, { backgroundColor: 'rgba(16,185,129,0.08)', borderColor: 'rgba(16,185,129,0.25)' }]}>
                  <View style={styles.adminReplyHeader}>
                    <Ionicons name="chatbubble-ellipses" size={14} color="#10B981" />
                    <Text style={styles.adminReplyLabel}>
                      {lang === 'ar' ? 'رد الإدارة' : 'Owner replied'}
                    </Text>
                    {item.admin_reply_at && (
                      <Text style={[styles.adminReplyDate, { color: subColor }]}>
                        · {fullDate(item.admin_reply_at, lang)}
                      </Text>
                    )}
                  </View>
                  <Text
                    style={[
                      styles.adminReplyText,
                      {
                        color: textColor,
                        textAlign: lang === 'ar' ? 'right' : 'left',
                        writingDirection: lang === 'ar' ? 'rtl' : 'ltr',
                      },
                    ]}
                  >
                    {item.admin_reply}
                  </Text>
                </View>
              )}

              {/* Star breakdown */}
              <View style={styles.breakdownSection}>
                <Text style={[styles.breakdownLabel, { color: subColor }]}>
                  {lang === 'ar' ? 'تفاصيل التقييم' : 'Rating breakdown'}
                </Text>
                {[5, 4, 3, 2, 1].map((star) => {
                  const filled = star <= item.rating;
                  return (
                    <View key={star} style={styles.breakdownRow}>
                      <Text style={[styles.breakdownStar, { color: subColor }]}>{star}</Text>
                      <Ionicons
                        name="star"
                        size={12}
                        color={filled ? COLORS.gold : 'transparent'}
                        style={{ marginRight: 6 }}
                      />
                      <View
                        style={[
                          styles.breakdownBar,
                          {
                            backgroundColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)',
                          },
                        ]}
                      >
                        <View
                          style={[
                            styles.breakdownFill,
                            {
                              width: filled ? '100%' : '0%',
                              backgroundColor: COLORS.gold,
                            },
                          ]}
                        />
                      </View>
                    </View>
                  );
                })}
              </View>
            </ScrollView>

            {/* Close button row */}
            <TouchableOpacity
              style={[styles.closePill, { borderColor }]}
              onPress={onClose}
              activeOpacity={0.75}
            >
              <LinearGradient
                colors={[COLORS.gold, '#A8822A']}
                style={StyleSheet.absoluteFill}
              />
              <Text style={styles.closePillText}>
                {lang === 'ar' ? 'إغلاق' : 'Close'}
              </Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>
    );
  },
);

// ─── Rating Card ──────────────────────────────────────────────────────────────

const RatingCard = memo(
  ({
    item,
    isDark,
    lang,
    cardWidth,
    onPress,
  }: {
    item: Rating;
    isDark: boolean;
    lang: string;
    cardWidth: number;
    onPress: (item: Rating) => void;
  }) => {
    const bg = isDark ? 'rgba(27,27,31,0.92)' : 'rgba(255,255,255,0.92)';
    const border = isDark ? OVERLAYS.goldInnerGlow : 'rgba(200,162,74,0.18)';
    const textColor = isDark ? COLORS.ivory : COLORS.charcoal;
    const subColor = isDark ? COLORS.goldSoft : COLORS.bronze;

    const restaurantName =
      lang === 'ar'
        ? item.restaurant_name_ar || item.restaurant_name
        : item.restaurant_name;

    return (
      <TouchableOpacity
        activeOpacity={0.82}
        onPress={() => onPress(item)}
        style={[styles.card, { width: cardWidth, backgroundColor: bg, borderColor: border }]}
      >
        <LinearGradient
          colors={['rgba(200,162,74,0.06)', 'transparent']}
          style={StyleSheet.absoluteFill}
          pointerEvents="none"
        />
        <View style={styles.cardHeader}>
          <StarDisplay value={item.rating} />
          <Text style={[styles.timeText, { color: subColor }]}>
            {relativeTime(item.created_at, lang)}
          </Text>
        </View>
        {item.comment ? (
          <Text style={[styles.comment, { color: textColor }]} numberOfLines={3}>
            "{item.comment}"
          </Text>
        ) : (
          <Text style={[styles.comment, { color: subColor, fontStyle: 'italic' }]}>
            ★★★★★
          </Text>
        )}
        {item.order_items && item.order_items.length > 0 && (
          <View style={[styles.cardReplyBox, { backgroundColor: 'rgba(200,162,74,0.06)', borderColor: 'rgba(200,162,74,0.18)', flexDirection: 'row', alignItems: 'center', gap: 5 }]}>
            <Ionicons name="restaurant-outline" size={10} color={COLORS.gold} />
            <Text style={[styles.cardReplyText, { color: subColor, flex: 1 }]} numberOfLines={1}>
              {item.order_items
                .slice(0, 2)
                .map((d) => (lang === 'ar' ? d.name_ar || d.name : d.name))
                .join(', ')}
            </Text>
          </View>
        )}
        {!!item.admin_reply && (
          <View style={[styles.cardReplyBox, { backgroundColor: 'rgba(16,185,129,0.08)', borderColor: 'rgba(16,185,129,0.22)' }]}>
            <View style={styles.cardReplyHeader}>
              <Ionicons name="chatbubble-ellipses" size={10} color="#10B981" />
              <Text style={styles.cardReplyLabel}>
                {lang === 'ar' ? 'رد الإدارة' : 'Owner replied'}
              </Text>
              {!!item.admin_reply_at && (
                <Text style={[styles.cardReplyDate, { color: subColor }]}>
                  · {relativeTime(item.admin_reply_at, lang)}
                </Text>
              )}
            </View>
            <Text style={[styles.cardReplyText, { color: textColor }]} numberOfLines={2}>
              {item.admin_reply}
            </Text>
          </View>
        )}
        <View style={styles.cardFooter}>
          <InitialsAvatar name={item.user_name || (lang === 'ar' ? 'ضيف' : 'Guest')} />
          <Text style={[styles.userName, { color: subColor }]}>
            {item.user_name || (lang === 'ar' ? 'ضيف' : 'Guest')}
          </Text>
          {restaurantName ? (
            <>
              <Text style={[styles.dot, { color: subColor }]}>·</Text>
              <Ionicons name="restaurant" size={11} color={COLORS.gold} />
              <Text style={[styles.restaurantName, { color: subColor }]} numberOfLines={1}>
                {restaurantName}
              </Text>
            </>
          ) : null}
        </View>
        {/* Tap hint */}
        <View style={styles.tapHint}>
          <Ionicons name="expand-outline" size={11} color={COLORS.gold} />
          <Text style={[styles.tapHintText, { color: subColor }]}>
            {lang === 'ar' ? 'اضغط للتفاصيل' : 'Tap to expand'}
          </Text>
        </View>
      </TouchableOpacity>
    );
  },
);

const SkeletonCard = memo(({ isDark, cardWidth }: { isDark: boolean; cardWidth: number }) => {
  const bg = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)';
  return (
    <View
      style={[
        styles.card,
        {
          width: cardWidth,
          backgroundColor: isDark ? 'rgba(27,27,31,0.7)' : 'rgba(240,240,240,0.9)',
          borderColor: 'transparent',
          overflow: 'hidden',
        },
      ]}
    >
      <View style={[styles.skeletonLine, { width: 80, backgroundColor: bg }]} />
      <View style={[styles.skeletonLine, { width: '100%', height: 10, backgroundColor: bg }]} />
      <View style={[styles.skeletonLine, { width: '80%', height: 10, backgroundColor: bg }]} />
      <View style={[styles.skeletonLine, { width: 100, height: 10, backgroundColor: bg }]} />
    </View>
  );
});

interface Props {
  restaurantId?: string;
  showEmptyState?: boolean;
}

function computeCardWidth(screenWidth: number): number {
  return Math.round(Math.min(300, Math.max(200, screenWidth * 0.56)));
}

export default function GlobalRatingsStrip({ restaurantId, showEmptyState }: Props) {
  const { language } = useTranslation();
  const { isDark } = useTheme();
  const { width: screenWidth } = useWindowDimensions();
  const cardWidth = computeCardWidth(screenWidth);
  const queryClient = useQueryClient();

  const [selectedRating, setSelectedRating] = useState<Rating | null>(null);
  const [modalVisible, setModalVisible] = useState(false);

  const handleCardPress = useCallback((item: Rating) => {
    setSelectedRating(item);
    setModalVisible(true);
  }, []);

  const handleModalClose = useCallback(() => {
    setModalVisible(false);
    setSelectedRating(null);
  }, []);

  const { data: ratings = [], isLoading } = useQuery<Rating[]>({
    queryKey: ['public-ratings', restaurantId],
    queryFn: async () => {
      const params = restaurantId ? `?limit=20&restaurant_id=${restaurantId}` : '?limit=20';
      const res = await api.get(`/ratings${params}`);
      return res.data ?? [];
    },
    staleTime: 5 * 60 * 1000,
    retry: false,
  });

  // Real-time: invalidate ratings on any rating mutation broadcast
  useEffect(() => {
    const removeHandler = wsService.addMessageHandler(
      'ratings-strip-ws',
      () => {
        queryClient.invalidateQueries({ queryKey: ['public-ratings'] });
      },
      {
        types: ['rating_created', 'rating_deleted', 'rating_reply_updated'],
        priority: 5,
      },
    );
    return removeHandler;
  }, [queryClient]);

  const avgRating =
    ratings.length > 0
      ? (ratings.reduce((s, r) => s + r.rating, 0) / ratings.length).toFixed(1)
      : null;

  if (isLoading) {
    return (
      <View style={styles.wrapper}>
        <View style={styles.header}>
          <View>
            <View
              style={[
                styles.skeletonLine,
                { width: 90, height: 10, backgroundColor: COLORS.gold + '30', marginBottom: 6 },
              ]}
            />
            <View
              style={[
                styles.skeletonLine,
                {
                  width: 160,
                  height: 18,
                  backgroundColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)',
                },
              ]}
            />
          </View>
        </View>
        <FlatList
          data={[0, 1, 2]}
          keyExtractor={(i) => String(i)}
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.list}
          renderItem={() => <SkeletonCard isDark={isDark} cardWidth={cardWidth} />}
        />
      </View>
    );
  }

  if (ratings.length === 0) {
    if (!showEmptyState) return null;
    return (
      <View style={styles.wrapper}>
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <Text style={styles.eyebrow}>
              {language === 'ar' ? 'آراء العملاء' : 'GUEST VOICES'}
            </Text>
            <View style={styles.headlineRow}>
              <Text style={[styles.headline, { color: isDark ? COLORS.ivory : COLORS.charcoal }]}>
                {language === 'ar' ? 'ما يقوله ضيوفنا' : 'What our guests say'}
              </Text>
              <Text style={[styles.reviewCount, { color: isDark ? COLORS.goldSoft : COLORS.bronze }]}>
                {language === 'ar' ? ' · 0 تقييمات' : ' · 0 reviews'}
              </Text>
            </View>
          </View>
        </View>
        <View
          style={[
            styles.emptyCard,
            {
              backgroundColor: isDark ? 'rgba(27,27,31,0.7)' : 'rgba(240,235,225,0.7)',
              borderColor: isDark ? OVERLAYS.goldInnerGlow : 'rgba(200,162,74,0.2)',
            },
          ]}
        >
          <LinearGradient
            colors={['rgba(200,162,74,0.08)', 'transparent']}
            style={StyleSheet.absoluteFill}
          />
          <View style={styles.emptyStars}>
            {[1, 2, 3, 4, 5].map((n) => (
              <Ionicons key={n} name="star-outline" size={20} color={COLORS.gold} />
            ))}
          </View>
          <Text style={[styles.emptyTitle, { color: isDark ? COLORS.ivory : COLORS.charcoal }]}>
            {language === 'ar' ? 'كن أول من يقيّم هذا المطعم' : 'Be the first to rate'}
          </Text>
          <Text style={[styles.emptySub, { color: isDark ? COLORS.goldSoft : COLORS.bronze }]}>
            {language === 'ar'
              ? 'شاركنا رأيك بعد تجربتك وساعد الآخرين في الاختيار'
              : 'Share your experience after your visit and help other guests'}
          </Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.wrapper}>
      {/* Section header */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Text style={styles.eyebrow}>
            {language === 'ar' ? 'آراء العملاء' : 'GUEST VOICES'}
          </Text>
          <View style={styles.headlineRow}>
            <Text style={[styles.headline, { color: isDark ? COLORS.ivory : COLORS.charcoal }]}>
              {language === 'ar' ? 'ما يقوله ضيوفنا' : 'What our guests say'}
            </Text>
            <Text style={[styles.reviewCount, { color: isDark ? COLORS.goldSoft : COLORS.bronze }]}>
              {language === 'ar'
                ? ` · ${ratings.length} ${ratings.length === 1 ? 'تقييم' : 'تقييمات'}`
                : ` · ${ratings.length} ${ratings.length === 1 ? 'review' : 'reviews'}`}
            </Text>
          </View>
        </View>
        {avgRating && (
          <View style={styles.avgBadge}>
            <Ionicons name="star" size={13} color={COLORS.charcoalDeep} />
            <Text style={styles.avgText}>{avgRating}</Text>
          </View>
        )}
      </View>

      <FlatList
        data={ratings}
        keyExtractor={(item) => item.id}
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => (
          <RatingCard
            item={item}
            isDark={isDark}
            lang={language}
            cardWidth={cardWidth}
            onPress={handleCardPress}
          />
        )}
      />

      <RatingDetailModal
        item={selectedRating}
        visible={modalVisible}
        onClose={handleModalClose}
        isDark={isDark}
        lang={language}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    marginTop: SPACING.xxl,
    marginBottom: SPACING.sm,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    paddingHorizontal: SPACING.xl,
    marginBottom: SPACING.lg,
  },
  eyebrow: {
    fontFamily: FONTS.body,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.8,
    color: COLORS.gold,
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  headline: {
    fontFamily: FONTS.display,
    fontSize: 20,
    fontWeight: '700',
  },
  headerLeft: {
    flex: 1,
    flexShrink: 1,
  },
  headlineRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    flexWrap: 'wrap',
  },
  reviewCount: {
    fontFamily: FONTS.body,
    fontSize: 13,
    fontWeight: '500',
    opacity: 0.75,
  },
  avgBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: COLORS.gold,
    borderRadius: RADII.pill,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.xs,
    marginLeft: SPACING.sm,
  },
  avgText: {
    fontFamily: FONTS.display,
    fontSize: 15,
    fontWeight: '800',
    color: COLORS.charcoalDeep,
  },
  list: {
    paddingHorizontal: SPACING.xl,
    gap: SPACING.md,
  },
  card: {
    borderRadius: RADII.lg,
    borderWidth: 1,
    padding: SPACING.lg,
    gap: SPACING.sm,
    overflow: 'hidden',
    ...ELEVATION.card,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  starRow: {
    flexDirection: 'row',
  },
  timeText: {
    fontFamily: FONTS.body,
    fontSize: 10,
    fontWeight: '500',
  },
  comment: {
    fontFamily: FONTS.body,
    fontSize: 13,
    lineHeight: 19,
    flex: 1,
  },
  cardFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: SPACING.xs,
    flexWrap: 'wrap',
  },
  userName: {
    fontFamily: FONTS.body,
    fontSize: 11,
    fontWeight: '600',
  },
  dot: {
    fontSize: 11,
    lineHeight: 14,
  },
  restaurantName: {
    fontFamily: FONTS.body,
    fontSize: 11,
    fontWeight: '500',
    flex: 1,
  },
  tapHint: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    marginTop: 2,
  },
  tapHintText: {
    fontFamily: FONTS.body,
    fontSize: 9,
    fontWeight: '500',
    opacity: 0.7,
  },
  skeletonLine: {
    height: 12,
    borderRadius: RADII.xs,
    marginBottom: 6,
  },
  avatar: {
    backgroundColor: 'rgba(200,162,74,0.22)',
    borderWidth: 1,
    borderColor: COLORS.gold,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    fontFamily: FONTS.body,
    fontWeight: '800',
    color: COLORS.gold,
    letterSpacing: 0.3,
  },
  emptyCard: {
    marginHorizontal: SPACING.xl,
    borderRadius: RADII.lg,
    borderWidth: 1,
    padding: SPACING.xl,
    alignItems: 'center',
    gap: SPACING.md,
    overflow: 'hidden',
    ...ELEVATION.card,
  },
  emptyStars: {
    flexDirection: 'row',
    gap: SPACING.xs,
    marginBottom: SPACING.xs,
  },
  emptyTitle: {
    fontFamily: FONTS.display,
    fontSize: 17,
    fontWeight: '700',
    textAlign: 'center',
  },
  emptySub: {
    fontFamily: FONTS.body,
    fontSize: 13,
    lineHeight: 19,
    textAlign: 'center',
  },

  // ── Modal ──────────────────────────────────────────────────────────────────
  modalOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  modalSheet: {
    borderTopLeftRadius: RADII.xl,
    borderTopRightRadius: RADII.xl,
    borderWidth: 1,
    borderBottomWidth: 0,
    overflow: 'hidden',
    maxHeight: '88%',
    paddingTop: SPACING.md,
  },
  dragHandle: {
    alignSelf: 'center',
    width: 38,
    height: 4,
    borderRadius: 2,
    marginBottom: SPACING.sm,
  },
  closeBtn: {
    position: 'absolute',
    top: SPACING.md,
    right: SPACING.lg,
    zIndex: 10,
  },
  modalContent: {
    paddingHorizontal: SPACING.xl,
    paddingBottom: SPACING.lg,
    gap: SPACING.lg,
  },
  reviewerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.lg,
    marginTop: SPACING.sm,
  },
  reviewerInfo: {
    flex: 1,
    gap: 5,
  },
  reviewerName: {
    fontFamily: FONTS.display,
    fontSize: 19,
    fontWeight: '700',
  },
  restaurantRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  restaurantLabel: {
    fontFamily: FONTS.body,
    fontSize: 12,
    fontWeight: '500',
    flex: 1,
  },
  ratingBox: {
    borderRadius: RADII.lg,
    borderWidth: 1,
    padding: SPACING.lg,
    gap: SPACING.sm,
  },
  ratingBoxInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.md,
  },
  ratingValue: {
    fontFamily: FONTS.display,
    fontSize: 22,
    fontWeight: '800',
  },
  dateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  dateText: {
    fontFamily: FONTS.body,
    fontSize: 12,
    fontWeight: '500',
  },
  relativeText: {
    fontFamily: FONTS.body,
    fontSize: 12,
    opacity: 0.7,
  },
  commentBox: {
    borderRadius: RADII.lg,
    borderWidth: 1,
    padding: SPACING.lg,
  },
  commentIcon: {
    marginBottom: SPACING.sm,
  },
  modalComment: {
    fontFamily: FONTS.body,
    fontSize: 15,
    lineHeight: 24,
  },
  noComment: {
    fontFamily: FONTS.body,
    fontSize: 14,
    fontStyle: 'italic',
    textAlign: 'center',
    opacity: 0.7,
  },
  breakdownSection: {
    gap: SPACING.sm,
  },
  breakdownLabel: {
    fontFamily: FONTS.body,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  breakdownRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  breakdownStar: {
    fontFamily: FONTS.body,
    fontSize: 12,
    fontWeight: '600',
    width: 14,
    textAlign: 'center',
  },
  breakdownBar: {
    flex: 1,
    height: 6,
    borderRadius: 3,
    overflow: 'hidden',
  },
  breakdownFill: {
    height: '100%',
    borderRadius: 3,
  },
  closePill: {
    margin: SPACING.xl,
    marginTop: SPACING.md,
    borderRadius: RADII.pill,
    borderWidth: 1,
    overflow: 'hidden',
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closePillText: {
    fontFamily: FONTS.display,
    fontSize: 15,
    fontWeight: '700',
    color: COLORS.charcoalDeep,
    letterSpacing: 0.5,
  },

  // ── Admin Reply (inline card) ─────────────────────────────────────────────
  cardReplyBox: {
    borderRadius: RADII.sm,
    borderWidth: 1,
    padding: SPACING.sm,
    gap: 3,
  },
  cardReplyHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  cardReplyLabel: {
    fontFamily: FONTS.body,
    fontSize: 10,
    fontWeight: '700',
    color: '#10B981',
  },
  cardReplyDate: {
    fontFamily: FONTS.body,
    fontSize: 10,
    opacity: 0.7,
  },
  cardReplyText: {
    fontFamily: FONTS.body,
    fontSize: 12,
    lineHeight: 17,
  },

  // ── Admin Reply (modal) ───────────────────────────────────────────────────
  adminReplyBox: {
    borderRadius: RADII.md,
    borderWidth: 1,
    padding: SPACING.md,
    gap: 6,
  },
  adminReplyHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    flexWrap: 'wrap',
  },
  adminReplyLabel: {
    fontFamily: FONTS.body,
    fontSize: 12,
    fontWeight: '700',
    color: '#10B981',
  },
  adminReplyDate: {
    fontFamily: FONTS.body,
    fontSize: 11,
    opacity: 0.7,
  },
  adminReplyText: {
    fontFamily: FONTS.body,
    fontSize: 14,
    lineHeight: 21,
  },
});
