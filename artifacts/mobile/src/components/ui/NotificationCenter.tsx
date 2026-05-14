/**
 * Notification Center — Rich real-time notifications
 */
import React, { useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Modal,
  Dimensions,
  Image,
  Platform,
  useWindowDimensions,
} from 'react-native';
import { BlurView } from 'expo-blur';
import { Ionicons } from '@expo/vector-icons';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withRepeat,
  withTiming,
  withSequence,
  Easing,
  interpolate,
} from 'react-native-reanimated';
import { useRouter } from 'expo-router';
import { minutesToHHMM } from '../../utils/timeUtils';
import { useAppStore, Notification, NotificationMetadata } from '../../store/appStore';
import { notificationApi } from '../../services/api';
import {
  ORDER_STATUS_LABELS_AR as STATUS_LABELS_AR,
  ORDER_STATUS_LABELS_EN as STATUS_LABELS_EN,
  ORDER_STATUS_COLORS as STATUS_COLORS,
  OrderStatus,
  asOrderStatus,
} from '../../constants/orderStatus';

const { height: SCREEN_HEIGHT } = Dimensions.get('window');

// ─────────────────────────────────────────────────────────────────────────────
// Responsive helpers
// ─────────────────────────────────────────────────────────────────────────────
// Fixed card width: 300px. Columns adapt automatically to screen size.
const CARD_WIDTH = 399;
const CARD_GAP   = 12;
const POPUP_PAD  = 16;  // total horizontal padding inside popup

function useLayout() {
  const { width } = useWindowDimensions();

  // Device tiers
  const isMobilePhone   = width < 600;
  const isMobileTablet  = width >= 600 && width < 768;

  // Popup takes nearly full available width on every tier
  const popupWidth = isMobilePhone ? width : width * 0.97;

  // How many 300px cards fit in the available space
  const available  = popupWidth - POPUP_PAD;
  const columns    = Math.max(1, Math.floor((available + CARD_GAP) / (CARD_WIDTH + CARD_GAP)));

  // Each card is exactly 300px — never stretched beyond that
  const cardWidth  = Math.min(CARD_WIDTH, (available - (columns - 1) * CARD_GAP) / columns);

  const showTabletUI = !isMobilePhone && !isMobileTablet;

  return { isMobilePhone, columns, popupWidth, cardWidth, screenWidth: width, showTabletUI };
}

// ─────────────────────────────────────────────────────────────────────────────
// Animated border with 4 glowing travelling dots
// ─────────────────────────────────────────────────────────────────────────────
const DOT_COLORS = ['#818CF8', '#A78BFA', '#38BDF8', '#34D399'];
const DOT_SIZE = 10;
const GLOW_SIZE = 15;

function GlowingDot({
  progress,
  offset,
  color,
  panelWidth,
  panelHeight,
  radius,
}: {
  progress: import('react-native-reanimated').SharedValue<number>;
  offset: number;
  color: string;
  panelWidth: number;
  panelHeight: number;
  radius: number;
}) {
  // Perimeter: right side (up) → top → left side (down) → bottom (hidden)
  // Moving direction: right to left on top side
  const W = panelWidth;
  const H = panelHeight;
  const P = 2 * (W + H);

  const animStyle = useAnimatedStyle(() => {
    const t = (progress.value + offset) % 1;
    const dist = t * P;

    let x = 0;
    let y = 0;

    // Segment 1: bottom-right → top-right (right side, going up)  [0, H)
    if (dist < H) {
      x = W;
      y = H - dist;
    }
    // Segment 2: top-right → top-left (top side, going left)  [H, H+W)
    else if (dist < H + W) {
      x = W - (dist - H);
      y = 0;
    }
    // Segment 3: top-left → bottom-left (left side, going down)  [H+W, 2H+W)
    else if (dist < 2 * H + W) {
      x = 0;
      y = dist - H - W;
    }
    // Segment 4: bottom-left → bottom-right (bottom, hidden)  [2H+W, P)
    else {
      x = dist - 2 * H - W;
      y = H;
    }

    // Fade out dots near the bottom (y > H * 0.85 means near bottom/invisible area)
    const opacity = y > H * 0.85 ? interpolate(y, [H * 0.85, H], [1, 0]) : 1;

    return {
      transform: [
        { translateX: x - GLOW_SIZE / 2 },
        { translateY: y - GLOW_SIZE / 2 },
      ],
      opacity,
    };
  });

  return (
    <Animated.View style={[styles.dotContainer, animStyle]} pointerEvents="none">
      {/* Outer glow */}
      <View
        style={[
          styles.dotGlow,
          { backgroundColor: color + '30', width: GLOW_SIZE, height: GLOW_SIZE, borderRadius: GLOW_SIZE / 2 },
        ]}
      />
      {/* Core dot */}
      <View
        style={[
          styles.dotCore,
          {
            backgroundColor: color,
            width: DOT_SIZE,
            height: DOT_SIZE,
            borderRadius: DOT_SIZE / 2,
            shadowColor: color,
          },
        ]}
      />
    </Animated.View>
  );
}

function AnimatedBorder({
  panelWidth,
  panelHeight,
  radius = 28,
}: {
  panelWidth: number;
  panelHeight: number;
  radius?: number;
}) {
  const progress = useSharedValue(0);

  useEffect(() => {
    progress.value = withRepeat(
      withTiming(1, { duration: 30000, easing: Easing.linear }),
      -1,
      false,
    );
  }, []);

  return (
    <View
      style={[
        StyleSheet.absoluteFill,
        { borderRadius: radius, overflow: 'visible', pointerEvents: 'none' } as any,
      ]}
    >
      {/* Glowing border lines */}
      {/* Top */}
      <View style={[styles.borderLine, styles.borderTop, { width: panelWidth - radius * 2, left: radius, borderColor: '#6366F120' }]} />
      {/* Left */}
      <View style={[styles.borderLine, styles.borderLeft, { height: panelHeight - radius, top: radius, borderColor: '#8B5CF620' }]} />
      {/* Right */}
      <View style={[styles.borderLine, styles.borderRight, { height: panelHeight - radius, top: radius, right: 0, borderColor: '#38BDF820' }]} />

      {/* 4 glowing travelling dots */}
      {DOT_COLORS.map((color, i) => (
        <GlowingDot
          key={i}
          progress={progress}
          offset={i * 0.25}
          color={color}
          panelWidth={panelWidth}
          panelHeight={panelHeight}
          radius={radius}
        />
      ))}
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function formatTime(dateStr: string, lang: string) {
  const date = new Date(dateStr);
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);
  if (minutes < 1) return lang === 'ar' ? 'الآن' : 'Just now';
  if (minutes < 60) return lang === 'ar' ? `${minutes} دقيقة` : `${minutes}m ago`;
  if (hours < 24) return lang === 'ar' ? `${hours} ساعة` : `${hours}h ago`;
  return lang === 'ar' ? `${days} يوم` : `${days}d ago`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Customer Avatar
// ─────────────────────────────────────────────────────────────────────────────
function CustomerAvatar({ uri, name, size = 48 }: { uri?: string | null; name?: string; size?: number }) {
  const initials = (name || 'U').split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase();
  if (uri) {
    return <Image source={{ uri }} style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: '#E5E7EB' }} />;
  }
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: '#6366F1', alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ color: '#FFF', fontSize: size * 0.35, fontWeight: '700' }}>{initials}</Text>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Order Notification Card
// ─────────────────────────────────────────────────────────────────────────────
function OrderNotificationCard({
  notification, meta, onInfo, onMarkRead, language,
}: {
  notification: Notification;
  meta: NotificationMetadata;
  onInfo: () => void;
  onMarkRead: () => void;
  language: string;
}) {
  const isNew = meta.kind === 'new_order';
  const statusColor = meta.new_status ? (STATUS_COLORS[asOrderStatus(meta.new_status)] || '#6B7280') : '#10B981';
  const statusLabels = language === 'ar' ? STATUS_LABELS_AR : STATUS_LABELS_EN;
  const statusLabel = meta.new_status ? (statusLabels[asOrderStatus(meta.new_status)] || meta.new_status) : '';

  return (
    <TouchableOpacity
      style={[styles.card, !notification.read && styles.cardUnread]}
      onPress={onMarkRead}
      activeOpacity={0.85}
    >
      <View style={[styles.cardAccent, { backgroundColor: isNew ? '#10B981' : statusColor }]} />
      <View style={styles.cardBody}>
        <View style={styles.cardHeader}>
          <View style={[styles.typeIconBox, { backgroundColor: isNew ? '#D1FAE5' : statusColor + '20' }]}>
            <Ionicons name={isNew ? 'checkmark-circle' : 'refresh-circle'} size={18} color={isNew ? '#10B981' : statusColor} />
          </View>
          <View style={{ flex: 1, marginLeft: 9 }}>
            <Text style={styles.cardTitle} numberOfLines={1}>
              {language === 'ar' && notification.title_ar ? notification.title_ar : notification.title}
            </Text>
            <Text style={styles.cardTime}>{formatTime(notification.created_at, language)}</Text>
          </View>
          {!notification.read && <View style={styles.unreadDot} />}
        </View>

        <View style={styles.customerStrip}>
          <CustomerAvatar uri={meta.customer_avatar} name={meta.customer_name} size={50} />
          <View style={styles.customerInfo}>
            {meta.customer_name ? <Text style={styles.customerName} numberOfLines={1}>{meta.customer_name}</Text> : null}
            {meta.customer_email ? (
              <View style={styles.infoRow}>
                <Ionicons name="mail-outline" size={11} color="#9CA3AF" />
                <Text style={styles.infoText} numberOfLines={1}>{meta.customer_email}</Text>
              </View>
            ) : null}
            {meta.customer_phone ? (
              <View style={styles.infoRow}>
                <Ionicons name="call-outline" size={11} color="#9CA3AF" />
                <Text style={styles.infoText}>{meta.customer_phone}</Text>
              </View>
            ) : null}
          </View>
          <TouchableOpacity style={styles.infoBtn} onPress={onInfo} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Ionicons name="information-circle" size={30} color="#3B82F6" />
          </TouchableOpacity>
        </View>

        <View style={styles.cardFooter}>
          {statusLabel ? (
            <View style={[styles.statusBadge, { backgroundColor: statusColor + '15', borderColor: statusColor + '40' }]}>
              <Text style={[styles.statusText, { color: statusColor }]}>{statusLabel}</Text>
            </View>
          ) : null}
          {meta.admin_name && !isNew ? (
            <View style={styles.adminRow}>
              <Ionicons name="person-circle-outline" size={13} color="#6B7280" />
              <Text style={styles.adminText}>{meta.admin_name}</Text>
            </View>
          ) : null}
        </View>
      </View>
    </TouchableOpacity>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Promotion / Bundle Notification Card
// ─────────────────────────────────────────────────────────────────────────────
function PromoNotificationCard({
  notification, meta, onInfo, onMarkRead, onNavigateTarget, language,
}: {
  notification: Notification;
  meta: NotificationMetadata;
  onInfo?: () => void;
  onMarkRead: () => void;
  onNavigateTarget?: () => void;
  language: string;
}) {
  const isBundle = meta.kind === 'bundle_offer';
  const accentColor = isBundle ? '#F59E0B' : '#8B5CF6';

  const notifTitle = language === 'ar' && notification.title_ar ? notification.title_ar : notification.title;
  const headerTitle = isBundle && meta.product_count
    ? `${notifTitle} • ${meta.product_count} منتجات`
    : notifTitle;

  const hasTarget = !!(meta.car_model_name || meta.product_name);
  const targetName = meta.car_model_name || meta.product_name || '';
  const targetIsCarModel = !!meta.car_model_name;

  // Opening hours label (year_start/year_end stored as minutes-since-midnight)
  const yearLabel = targetIsCarModel && (meta.car_model_year_start != null || meta.car_model_year_end != null)
    ? (() => {
        const open = meta.car_model_year_start != null ? minutesToHHMM(Number(meta.car_model_year_start)) : null;
        const close = meta.car_model_year_end != null ? minutesToHHMM(Number(meta.car_model_year_end)) : null;
        if (open && close) return `${open} — ${close}`;
        return open ?? close ?? null;
      })()
    : null;

  return (
    <TouchableOpacity
      style={[styles.card, !notification.read && styles.cardUnread]}
      onPress={onMarkRead}
      activeOpacity={0.85}
    >
      <View style={[styles.cardAccent, { backgroundColor: accentColor }]} />
      <View style={styles.cardBody}>
        <View style={styles.cardHeader}>
          <View style={[styles.typeIconBox, { backgroundColor: accentColor + '20' }]}>
            <Ionicons name={isBundle ? 'pricetag' : 'megaphone'} size={19} color={accentColor} />
          </View>
          <View style={{ flex: 1, marginLeft: 9 }}>
            <Text style={styles.cardTitle} numberOfLines={1}>{headerTitle}</Text>
            <Text style={styles.cardTime}>{formatTime(notification.created_at, language)}</Text>
          </View>
          {!notification.read && <View style={styles.unreadDot} />}
        </View>

        <View style={styles.promoStrip}>
          <View style={styles.promoThumb}>
            {meta.image ? (
              <Image source={{ uri: meta.image }} style={StyleSheet.absoluteFill} resizeMode="cover" />
            ) : (
              <View style={[StyleSheet.absoluteFill, styles.promoImagePlaceholder]}>
                <Ionicons name={isBundle ? 'pricetag' : 'megaphone'} size={36} color={accentColor} />
              </View>
            )}
          </View>

          <View style={styles.promoDetails}>
            <Text style={styles.promoTitle} numberOfLines={2}>
              {meta.title || (language === 'ar' && notification.message_ar ? notification.message_ar : notification.message)}
            </Text>

            {meta.discount_percentage ? (
              <View style={[styles.discountBadge, { backgroundColor: accentColor + '15', borderColor: accentColor + '40' }]}>
                <Ionicons name="flash" size={11} color={accentColor} />
                <Text style={[styles.discountText, { color: accentColor }]}>خصم {meta.discount_percentage}%</Text>
              </View>
            ) : null}

            {hasTarget ? (
              <TouchableOpacity
                style={styles.targetRow}
                onPress={onNavigateTarget || onInfo}
                disabled={!onNavigateTarget && !onInfo}
                hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
                activeOpacity={0.7}
              >
                {targetIsCarModel && meta.car_model_image ? (
                  <Image
                    source={{ uri: meta.car_model_image }}
                    style={styles.targetCircleImg}
                    resizeMode="cover"
                  />
                ) : (
                  <View style={[styles.targetCircleIcon, { backgroundColor: accentColor + '20' }]}>
                    <Ionicons
                      name={targetIsCarModel ? 'restaurant' : 'cube'}
                      size={13}
                      color={accentColor}
                    />
                  </View>
                )}
                <View style={{ flex: 1 }}>
                  <Text style={[styles.targetName, { color: accentColor }]} numberOfLines={1}>
                    {targetName}
                  </Text>
                  {yearLabel ? (
                    <Text style={styles.targetYear}>{yearLabel}</Text>
                  ) : null}
                </View>
                {(onNavigateTarget || onInfo) && (
                  <Ionicons name="chevron-forward" size={11} color={accentColor} />
                )}
              </TouchableOpacity>
            ) : null}
          </View>

          {onInfo && !hasTarget ? (
            <TouchableOpacity style={styles.infoBtn} onPress={onInfo} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Ionicons name="information-circle" size={26} color="#3B82F6" />
            </TouchableOpacity>
          ) : null}
        </View>
      </View>
    </TouchableOpacity>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Default Notification Card
// ─────────────────────────────────────────────────────────────────────────────
function DefaultNotificationCard({
  notification, onMarkRead, onInfo, language,
}: {
  notification: Notification;
  onMarkRead: () => void;
  onInfo?: () => void;
  language: string;
}) {
  const iconMap: Record<string, { name: string; color: string }> = {
    success: { name: 'checkmark-circle', color: '#10B981' },
    warning: { name: 'warning',          color: '#F59E0B' },
    error:   { name: 'alert-circle',     color: '#EF4444' },
    info:    { name: 'information-circle', color: '#3B82F6' },
  };
  const icon = iconMap[notification.type] || iconMap.info;

  return (
    <TouchableOpacity
      style={[styles.card, !notification.read && styles.cardUnread]}
      onPress={onMarkRead}
      activeOpacity={0.85}
    >
      <View style={[styles.cardAccent, { backgroundColor: icon.color }]} />
      <View style={styles.cardBody}>
        <View style={styles.cardHeader}>
          <View style={[styles.typeIconBox, { backgroundColor: icon.color + '20' }]}>
            <Ionicons name={icon.name as any} size={18} color={icon.color} />
          </View>
          <View style={{ flex: 1, marginLeft: 8 }}>
            <Text style={styles.cardTitle}>
              {language === 'ar' && notification.title_ar ? notification.title_ar : notification.title}
            </Text>
            <Text style={styles.notifMessage}>
              {language === 'ar' && notification.message_ar ? notification.message_ar : notification.message}
            </Text>
            <Text style={styles.cardTime}>{formatTime(notification.created_at, language)}</Text>
          </View>
          {!notification.read && <View style={styles.unreadDot} />}
        </View>
        {onInfo && (
          <TouchableOpacity style={styles.infoBtn} onPress={onInfo} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Ionicons name="information-circle" size={18} color="#FFD700" />
            <Text style={styles.infoBtnText}>{language === 'ar' ? 'عرض التفاصيل' : 'View details'}</Text>
          </TouchableOpacity>
        )}
      </View>
    </TouchableOpacity>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Stock Notification Card — out_of_stock / low_stock / restock
// Renders a thumbnail + product details (name, sku, fitment, stock, price)
// alongside two action icons: an (i) info icon that jumps to the product
// page, and a pencil icon that jumps straight into the admin edit form
// for that exact product.
// ─────────────────────────────────────────────────────────────────────────────
function StockNotificationCard({
  notification, meta, onMarkRead, onInfo, onEdit, language,
}: {
  notification: Notification;
  meta: NotificationMetadata;
  onMarkRead: () => void;
  onInfo?: () => void;
  onEdit?: () => void;
  language: string;
}) {
  const kind = meta.kind;
  const accentColor =
    kind === 'restock' ? '#10B981'
    : kind === 'low_stock' ? '#F59E0B'
    : '#EF4444';
  const iconName: any =
    kind === 'restock' ? 'cube'
    : kind === 'low_stock' ? 'warning'
    : 'alert-circle';

  const displayName =
    (language === 'ar' ? (meta.name_ar || meta.name) : (meta.name || meta.name_ar)) || '';
  const fitment = meta.fitment_indicator ? String(meta.fitment_indicator) : '';
  const stockNum = typeof meta.stock === 'number' ? meta.stock : null;
  const priceNum = typeof meta.price === 'number' ? meta.price : null;
  const sku = meta.sku ? String(meta.sku) : '';
  // Server-enriched fields (added in stockNotifBase): brand name + up to
  // 3 compatible car model names. We display them as compact info rows so
  // the notification card matches the unified "product card" look used in
  // cart/favorites/etc. Both fields are best-effort — only render rows when
  // the data is actually present so older notifications don't show empty rows.
  const brandName = meta.product_brand_name ? String(meta.product_brand_name) : '';
  const carModelsArr: any[] = Array.isArray((meta as any).compatible_car_models)
    ? (meta as any).compatible_car_models
    : [];
  const carModelsLine = carModelsArr.length > 0
    ? carModelsArr
        .slice(0, 3)
        .map((m: any) => (language === 'ar' ? (m?.name_ar || m?.name) : (m?.name || m?.name_ar)) || '')
        .filter(Boolean)
        .join(' · ')
    : '';

  const stockLabel = language === 'ar'
    ? (stockNum === 0 ? 'نفذ من المخزون' : `المتبقي: ${stockNum}`)
    : (stockNum === 0 ? 'Out of stock' : `${stockNum} left`);

  return (
    <TouchableOpacity
      style={[styles.card, !notification.read && styles.cardUnread]}
      onPress={onMarkRead}
      activeOpacity={0.85}
    >
      <View style={[styles.cardAccent, { backgroundColor: accentColor }]} />
      <View style={styles.cardBody}>
        <View style={styles.cardHeader}>
          <View style={[styles.typeIconBox, { backgroundColor: accentColor + '20' }]}>
            <Ionicons name={iconName} size={18} color={accentColor} />
          </View>
          <View style={{ flex: 1, marginLeft: 9 }}>
            <Text style={styles.cardTitle} numberOfLines={1}>
              {language === 'ar' && notification.title_ar ? notification.title_ar : notification.title}
            </Text>
            <Text style={styles.cardTime}>{formatTime(notification.created_at, language)}</Text>
          </View>
          {!notification.read && <View style={styles.unreadDot} />}
        </View>

        <View style={styles.promoStrip}>
          <View style={styles.promoThumb}>
            {meta.image_url ? (
              <Image source={{ uri: String(meta.image_url) }} style={StyleSheet.absoluteFill} resizeMode="cover" />
            ) : (
              <View style={[StyleSheet.absoluteFill, styles.promoImagePlaceholder]}>
                <Ionicons name="cube-outline" size={36} color={accentColor} />
              </View>
            )}
          </View>

          <View style={styles.promoDetails}>
            <Text style={styles.promoTitle} numberOfLines={2}>
              {displayName || (language === 'ar' ? 'منتج' : 'Product')}
            </Text>

            <View style={[styles.discountBadge, { backgroundColor: accentColor + '15', borderColor: accentColor + '40' }]}>
              <Ionicons name="layers-outline" size={11} color={accentColor} />
              <Text style={[styles.discountText, { color: accentColor }]}>{stockLabel}</Text>
            </View>

            {sku ? (
              <View style={styles.infoRow}>
                <Ionicons name="barcode-outline" size={11} color="#9CA3AF" />
                <Text style={styles.infoText} numberOfLines={1}>SKU: {sku}</Text>
              </View>
            ) : null}
            {brandName ? (
              <View style={styles.infoRow}>
                <Ionicons name="ribbon-outline" size={11} color="#8B5CF6" />
                <Text style={[styles.infoText, { color: '#8B5CF6' }]} numberOfLines={1}>
                  {brandName}
                </Text>
              </View>
            ) : null}
            {carModelsLine ? (
              <View style={styles.infoRow}>
                <Ionicons name="restaurant-outline" size={11} color="#3B82F6" />
                <Text style={[styles.infoText, { color: '#3B82F6' }]} numberOfLines={1}>
                  {carModelsLine}
                </Text>
              </View>
            ) : null}
            {fitment ? (
              <View style={styles.infoRow}>
                <Ionicons name="construct-outline" size={11} color="#9CA3AF" />
                <Text style={styles.infoText} numberOfLines={1}>
                  {language === 'ar' ? 'التوافق: ' : 'Fitment: '}{fitment}
                </Text>
              </View>
            ) : null}
            {priceNum !== null ? (
              <View style={styles.infoRow}>
                <Ionicons name="pricetag-outline" size={11} color="#9CA3AF" />
                <Text style={styles.infoText} numberOfLines={1}>
                  {priceNum.toFixed(2)} {language === 'ar' ? 'ج.م' : 'EGP'}
                </Text>
              </View>
            ) : null}
          </View>

          <View style={{ alignItems: 'center', justifyContent: 'center', gap: 4 }}>
            {onInfo ? (
              <TouchableOpacity onPress={onInfo} hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}>
                <Ionicons name="information-circle" size={26} color="#3B82F6" />
              </TouchableOpacity>
            ) : null}
            {onEdit ? (
              <TouchableOpacity onPress={onEdit} hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}>
                <Ionicons name="create" size={22} color={accentColor} />
              </TouchableOpacity>
            ) : null}
          </View>
        </View>
      </View>
    </TouchableOpacity>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Component
// ─────────────────────────────────────────────────────────────────────────────
interface NotificationCenterProps {
  visible: boolean;
  onClose: () => void;
}

export const NotificationCenter: React.FC<NotificationCenterProps> = ({ visible, onClose }) => {
  const notifications = useAppStore((state) => state.notifications);
  const unreadCount   = useAppStore((state) => state.unreadCount);
  const markNotificationRead    = useAppStore((state) => state.markNotificationRead);
  const markAllNotificationsRead = useAppStore((state) => state.markAllNotificationsRead);
  const setNotifications = useAppStore((state) => state.setNotifications);
  const language = useAppStore((state) => state.language);
  const router   = useRouter();
  const layout   = useLayout();

  const slideY = useSharedValue(SCREEN_HEIGHT);

  // Panel measured height (for border animation)
  const [panelHeight, setPanelHeight] = React.useState(SCREEN_HEIGHT * 0.78);

  // Re-fetch notifications from server each time the panel opens
  useEffect(() => {
    if (visible) {
      slideY.value = withSpring(15, { damping: 59 });
      notificationApi.getAll().then((res) => {
        if (res?.data) setNotifications(res.data);
      }).catch(() => {});
    } else {
      slideY.value = withTiming(SCREEN_HEIGHT, { duration: 200 });
    }
  }, [visible]);

  const contentStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: slideY.value }],
  }));

  const handleMarkRead = async (id: string) => {
    try { markNotificationRead(id); await notificationApi.markRead(id); } catch {}
  };

  const handleMarkAllRead = async () => {
    try { markAllNotificationsRead(); await notificationApi.markAllRead(); } catch {}
  };

  const handleNavigate = (path: string) => {
    onClose();
    setTimeout(() => router.push(path as any), 300);
  };

  const renderCard = useCallback((notification: Notification, cardWidth: number) => {
    const meta = notification.metadata || {};
    const kind = meta.kind;

    const cardStyle = { width: cardWidth };

    if (kind === 'new_order' || kind === 'order_updated') {
      return (
        <View key={notification.id} style={cardStyle}>
          <OrderNotificationCard
            notification={notification}
            meta={meta}
            language={language}
            onMarkRead={() => handleMarkRead(notification.id)}
            onInfo={() => {
              handleMarkRead(notification.id);
              if (meta.order_id) handleNavigate(`/admin/order/${meta.order_id}`);
            }}
          />
        </View>
      );
    }

    if (kind === 'appointment_confirmed') {
      return (
        <View key={notification.id} style={cardStyle}>
          <DefaultNotificationCard
            notification={notification}
            language={language}
            onMarkRead={() => handleMarkRead(notification.id)}
            onInfo={() => {
              handleMarkRead(notification.id);
              const id = meta.appointment_id ? String(meta.appointment_id) : '';
              handleNavigate(id ? `/cart?tab=orders&appointmentId=${encodeURIComponent(id)}` : '/cart?tab=orders');
            }}
          />
        </View>
      );
    }

    // Operator rescheduled the customer's appointment. Tapping "view details"
    // navigates the customer to their bookings tab with the updated appointment
    // highlighted so they can immediately see the new date/time.
    if ((kind as string) === 'appointment_rescheduled') {
      return (
        <View key={notification.id} style={cardStyle}>
          <DefaultNotificationCard
            notification={notification}
            language={language}
            onMarkRead={() => handleMarkRead(notification.id)}
            onInfo={() => {
              handleMarkRead(notification.id);
              const id = meta.appointment_id ? String(meta.appointment_id) : '';
              handleNavigate(id ? `/cart?tab=orders&appointmentId=${encodeURIComponent(id)}` : '/cart?tab=orders');
            }}
          />
        </View>
      );
    }

    // Admin / owner side notification fired when a customer books a new
    // appointment. Tapping "view details" must land on the *customer's*
    // cart → orders tab — not the admin's own — so admins can see who
    // booked and act on it immediately.
    if (kind === 'customer_appointment_booked') {
      return (
        <View key={notification.id} style={cardStyle}>
          <DefaultNotificationCard
            notification={notification}
            language={language}
            onMarkRead={() => handleMarkRead(notification.id)}
            onInfo={() => {
              handleMarkRead(notification.id);
              const targetUserId = meta.target_user_id ? String(meta.target_user_id) : '';
              const apptId = meta.appointment_id ? String(meta.appointment_id) : '';
              const tab = meta.target_tab ? String(meta.target_tab) : 'orders';
              if (targetUserId) {
                const apptParam = apptId ? `&appointmentId=${encodeURIComponent(apptId)}` : '';
                handleNavigate(
                  `/admin/customers?customerId=${encodeURIComponent(targetUserId)}&tab=${encodeURIComponent(tab)}${apptParam}`,
                );
              } else {
                handleNavigate('/cart?tab=orders');
              }
            }}
          />
        </View>
      );
    }

    // Customer requested to reschedule or cancel an appointment.
    // Privileged users tap "view details" to jump straight into the
    // chat conversation that hosts the request.
    if (kind === 'appointment_change_request') {
      return (
        <View key={notification.id} style={cardStyle}>
          <DefaultNotificationCard
            notification={notification}
            language={language}
            onMarkRead={() => handleMarkRead(notification.id)}
            onInfo={() => {
              handleMarkRead(notification.id);
              const convId = meta.conversation_id ? String(meta.conversation_id) : '';
              handleNavigate(convId ? `/chat?conversationId=${encodeURIComponent(convId)}` : '/chat');
            }}
          />
        </View>
      );
    }

    if (kind === 'out_of_stock' || kind === 'low_stock' || kind === 'restock') {
      const productId = meta.product_id ? String(meta.product_id) : '';
      return (
        <View key={notification.id} style={cardStyle}>
          <StockNotificationCard
            notification={notification}
            meta={meta}
            language={language}
            onMarkRead={() => handleMarkRead(notification.id)}
            onInfo={productId ? () => {
              handleMarkRead(notification.id);
              handleNavigate(`/product/${productId}`);
            } : undefined}
            onEdit={productId ? () => {
              handleMarkRead(notification.id);
              handleNavigate(`/admin/products?editProductId=${encodeURIComponent(productId)}`);
            } : undefined}
          />
        </View>
      );
    }

    if (kind === 'promotion' || kind === 'bundle_offer') {
      const getPromoNavPath = () => {
        if (kind === 'bundle_offer' && meta.target_id) return `/offer/${meta.target_id}`;
        if (kind === 'promotion') {
          if (meta.target_product_id) return `/product/${meta.target_product_id}`;
          if (meta.target_car_model_id) return `/car/${meta.target_car_model_id}`;
        }
        return null;
      };
      const getTargetNavPath = () => {
        if (kind === 'bundle_offer' && meta.car_model_id) return `/car/${meta.car_model_id}`;
        if (kind === 'promotion') {
          if (meta.target_car_model_id) return `/car/${meta.target_car_model_id}`;
          if (meta.target_product_id) return `/product/${meta.target_product_id}`;
        }
        return null;
      };
      const navPath = getPromoNavPath();
      const targetNavPath = getTargetNavPath();
      return (
        <View key={notification.id} style={cardStyle}>
          <PromoNotificationCard
            notification={notification}
            meta={meta}
            language={language}
            onMarkRead={() => handleMarkRead(notification.id)}
            onInfo={navPath ? () => { handleMarkRead(notification.id); handleNavigate(navPath); } : undefined}
            onNavigateTarget={targetNavPath ? () => { handleMarkRead(notification.id); handleNavigate(targetNavPath); } : undefined}
          />
        </View>
      );
    }

    return (
      <View key={notification.id} style={cardStyle}>
        <DefaultNotificationCard
          notification={notification}
          language={language}
          onMarkRead={() => handleMarkRead(notification.id)}
        />
      </View>
    );
  }, [language]);

  if (!visible) return null;

  const { showTabletUI, columns, popupWidth, cardWidth } = layout;

  return (
    <Modal transparent visible={visible} animationType="none">
      {/* Backdrop */}
      <TouchableOpacity style={styles.overlay} activeOpacity={1} onPress={onClose}>
        <BlurView intensity={13} tint="dark" style={StyleSheet.absoluteFill} />
      </TouchableOpacity>

      {/* Panel */}
      <Animated.View
        style={[
          showTabletUI ? styles.tabletWrapper : styles.mobileWrapper,
          contentStyle,
          { pointerEvents: 'box-none' },
        ]}
      >
        <View
          style={[styles.content, showTabletUI && styles.contentTablet, { width: popupWidth }]}
          onLayout={(e) => setPanelHeight(e.nativeEvent.layout.height)}
        >
          {/* Animated glowing border with 4 travelling dots */}
          <AnimatedBorder
            panelWidth={popupWidth}
            panelHeight={panelHeight}
            radius={28}
          />

          {/* Handle (mobile only) */}
          {!showTabletUI && <View style={styles.handleBar} />}

          {/* Header */}
          <View style={styles.headerRow}>
            <View>
              <Text style={styles.headerTitle}>
                {language === 'ar' ? 'الإشعارات' : 'Notifications'}
              </Text>
              {unreadCount > 0 && (
                <Text style={styles.headerSub}>
                  {unreadCount} {language === 'ar' ? 'غير مقروء' : 'unread'}
                </Text>
              )}
            </View>
            <View style={styles.headerActions}>
              {unreadCount > 0 && (
                <TouchableOpacity onPress={handleMarkAllRead} style={styles.markAllBtn}>
                  <Ionicons name="checkmark-done" size={15} color="#FFF" />
                  <Text style={styles.markAllText}>
                    {language === 'ar' ? 'قراءة الكل' : 'Mark all read'}
                  </Text>
                </TouchableOpacity>
              )}
              {showTabletUI && (
                <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
                  <Ionicons name="close" size={20} color="#6B7280" />
                </TouchableOpacity>
              )}
            </View>
          </View>

          {/* List */}
          <ScrollView
            style={styles.list}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={[
              styles.listContent,
              columns > 1 && styles.listContentGrid,
            ]}
          >
            {notifications.length === 0 ? (
              <View style={styles.empty}>
                <Ionicons name="notifications-off-outline" size={52} color="#D1D5DB" />
                <Text style={styles.emptyText}>
                  {language === 'ar' ? 'لا توجد إشعارات' : 'No notifications yet'}
                </Text>
              </View>
            ) : columns > 1 ? (
              <View style={styles.grid}>
                {notifications.map(n => renderCard(n, cardWidth))}
              </View>
            ) : (
              notifications.map(n => renderCard(n, cardWidth))
            )}
          </ScrollView>
        </View>
      </Animated.View>
    </Modal>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Bell Button
// ─────────────────────────────────────────────────────────────────────────────
export const NotificationBell: React.FC<{ onPress: () => void }> = ({ onPress }) => {
  const unreadCount = useAppStore((state) => state.unreadCount);
  const pulseScale = useSharedValue(1);

  useEffect(() => {
    if (unreadCount > 0) {
      pulseScale.value = withRepeat(
        withSequence(withTiming(1.2, { duration: 500 }), withTiming(1, { duration: 500 })),
        -1,
        true,
      );
    } else {
      pulseScale.value = withTiming(1);
    }
  }, [unreadCount]);

  const pulseStyle = useAnimatedStyle(() => ({ transform: [{ scale: pulseScale.value }] }));

  return (
    <TouchableOpacity onPress={onPress} style={styles.bellButton}>
      <Ionicons name="notifications" size={22} color="#1a1a2e" />
      {unreadCount > 0 && (
        <Animated.View style={[styles.badge, pulseStyle]}>
          <Text style={styles.badgeText}>{unreadCount > 9 ? '9+' : unreadCount}</Text>
        </Animated.View>
      )}
    </TouchableOpacity>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Styles
// ─────────────────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  overlay: { ...StyleSheet.absoluteFillObject },

  // Mobile: slides up from bottom full width
  mobileWrapper: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
  },
  // Tablet/Desktop: centered vertically and horizontally
  tabletWrapper: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    alignItems: 'center',
  },

  content: {
    backgroundColor: '#F8FAFC',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    maxHeight: SCREEN_HEIGHT * 0.84,
    paddingBottom: Platform.OS === 'web' ? 34 : 0,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.14,
    shadowRadius: 20,
    elevation: 24,
    overflow: 'visible',
  },
  contentTablet: {
    borderRadius: 28,
    maxHeight: SCREEN_HEIGHT * 0.90,
  },

  // Animated border helpers
  borderLine: {
    position: 'absolute',
    borderWidth: 1.5,
  },
  borderTop: {
    top: 0,
    height: 0,
    borderTopWidth: 1.5,
    borderLeftWidth: 0,
    borderRightWidth: 0,
    borderBottomWidth: 0,
  },
  borderLeft: {
    left: 0,
    width: 0,
    borderLeftWidth: 1.5,
    borderTopWidth: 0,
    borderRightWidth: 0,
    borderBottomWidth: 0,
  },
  borderRight: {
    width: 0,
    borderRightWidth: 1.5,
    borderTopWidth: 0,
    borderLeftWidth: 0,
    borderBottomWidth: 0,
  },

  dotContainer: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
    width: GLOW_SIZE,
    height: GLOW_SIZE,
  },
  dotGlow: {
    position: 'absolute',
  },
  dotCore: {
    position: 'absolute',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 1,
    shadowRadius: 6,
    elevation: 8,
  },

  handleBar: {
    width: 40, height: 4, backgroundColor: '#D1D5DB',
    borderRadius: 2, alignSelf: 'center', marginTop: 12, marginBottom: 4,
  },
  headerRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 20, paddingVertical: 14,
    borderBottomWidth: 1, borderBottomColor: '#E5E7EB',
    backgroundColor: '#FFF',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
  },
  headerTitle: { fontSize: 20, fontWeight: '700', color: '#111827' },
  headerSub: { fontSize: 12, color: '#6B7280', marginTop: 1 },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  markAllBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: '#6366F1', paddingHorizontal: 12, paddingVertical: 7,
    borderRadius: 20,
  },
  markAllText: { color: '#FFF', fontSize: 12, fontWeight: '600' },
  closeBtn: {
    width: 32, height: 32, borderRadius: 16,
    backgroundColor: '#F3F4F6', alignItems: 'center', justifyContent: 'center',
  },

  list: { maxHeight: SCREEN_HEIGHT * 0.7 },
  listContent: { paddingBottom: 24, alignItems: 'center' },
  listContentGrid: {},

  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    justifyContent: 'center',
    paddingHorizontal: 8,
    paddingTop: 2,
  },

  empty: { alignItems: 'center', paddingVertical: 72 },
  emptyText: { color: '#9CA3AF', fontSize: 15, marginTop: 12, fontWeight: '500' },

  // Card base
  card: {
    flexDirection: 'row',
    marginHorizontal: 0,
    marginTop: 17,
    borderRadius: 16,
    backgroundColor: '#FFF',
    overflow: 'hidden',
    maxHeight: 300,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 6,
    elevation: 3,
  },
  cardUnread: { backgroundColor: '#F0F4FF' },
  cardAccent: { width: 4, borderTopLeftRadius: 16, borderBottomLeftRadius: 16 },
  cardBody: { flex: 1, padding: 12 },
  cardHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 10 },
  typeIconBox: {
    width: 34, height: 34, borderRadius: 10,
    alignItems: 'center', justifyContent: 'center',
  },
  cardTitle: { fontSize: 14, fontWeight: '700', color: '#1F2937' },
  cardTime: { fontSize: 11, color: '#9CA3AF', marginTop: 1 },
  unreadDot: {
    width: 8, height: 8, borderRadius: 4,
    backgroundColor: '#6366F1', marginLeft: 6,
  },

  // Customer strip
  customerStrip: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#F9FAFB', borderRadius: 12,
    paddingVertical: 10, paddingHorizontal: 10, gap: 10,
    marginBottom: 8,
  },
  customerInfo: { flex: 1, gap: 2 },
  customerName: { fontSize: 13, fontWeight: '700', color: '#1F2937' },
  infoRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  infoText: { fontSize: 11, color: '#6B7280', flex: 1 },
  infoBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 6, paddingHorizontal: 10, marginTop: 8, borderRadius: 8, backgroundColor: '#FFD70015', borderWidth: 1, borderColor: '#FFD70040', alignSelf: 'flex-start' },
  infoBtnText: { color: '#FFD700', fontSize: 12, fontWeight: '700' },

  // Footer
  cardFooter: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  statusBadge: {
    paddingHorizontal: 10, paddingVertical: 3,
    borderRadius: 20, borderWidth: 1,
  },
  statusText: { fontSize: 11, fontWeight: '600' },
  adminRow: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  adminText: { fontSize: 11, color: '#6B7280' },

  // Default card message
  notifMessage: { fontSize: 12, color: '#6B7280', marginTop: 3, lineHeight: 17 },

  // Promo strip
  promoStrip: {
    flexDirection: 'row', alignItems: 'stretch',
    backgroundColor: '#F9FAFB', borderRadius: 19,
    overflow: 'hidden', marginTop: 1, minHeight: 139,
  },
  promoThumb: { width: 159, position: 'relative' },
  promoImagePlaceholder: {
    backgroundColor: '#F3F4F6',
    alignItems: 'center', justifyContent: 'center',
  },
  promoDetails: { flex: 1, padding: 7, gap: 7, justifyContent: 'center' },
  promoTitle: { fontSize: 15, fontWeight: '700', color: '#1F2937', lineHeight: 19 },
  discountBadge: {
    flexDirection: 'row', alignItems: 'center',
    alignSelf: 'center', paddingHorizontal: 7, paddingVertical: 3,
    borderRadius: 20, borderWidth: 1.5,
  },
  discountText: { fontSize: 13, fontWeight: '700', marginLeft: 3 },
  targetRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  targetCircleImg: {
    width: 75, height: 55, borderRadius: 11,
    backgroundColor: '#fcfcfc',
  },
  targetCircleIcon: {
    width: 28, height: 28, borderRadius: 14,
    alignItems: 'center', justifyContent: 'center',
  },
  targetName: { fontSize: 13, fontWeight: '700' , textAlign: 'center' },
  targetYear: { fontSize: 13, color: '#9CA3AF', marginTop: 1, textAlign: 'center' , fontWeight: '700' },

  // Bell
  bellButton: { padding: 6, position: 'relative' },
  badge: {
    position: 'absolute', top: 0, right: 0,
    minWidth: 15, height: 15, borderRadius: 7.5,
    backgroundColor: '#EF4444',
    alignItems: 'center', justifyContent: 'center',
  },
  badgeText: { color: '#FFF', fontSize: 9, fontWeight: '700' },
});

export default NotificationCenter;
