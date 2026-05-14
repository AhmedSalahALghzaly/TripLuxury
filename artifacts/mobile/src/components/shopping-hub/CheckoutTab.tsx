/**
 * CheckoutTab - Checkout form and order submission tab
 * Handles customer information, delivery details, GPS location, payment method, and cart items review
 */
import React, { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, TextInput,
  ActivityIndicator, Linking, Platform, ScrollView, Alert,
} from 'react-native';
import Reanimated, { useSharedValue, useAnimatedStyle, withTiming } from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { GlassCard } from '../ui/GlassCard';
import { Skeleton } from '../ui/Skeleton';
import { useTheme } from '../../hooks/useTheme';
import { useTranslation } from '../../hooks/useTranslation';
import { TYPE, COLORS, RADII } from '../../constants/luxuryTokens';
import { LinearGradient } from 'expo-linear-gradient';
import type { CheckoutForm } from '../../hooks/shopping/useOrderOperations';
import type { UserAddress, UserAddressLabel } from '../../services/api';
import type { CartItem } from '../../hooks/shopping/types';
import { MapsPreviewStrip } from '../MapsPreviewStrip';

const FULL_SHIPPING = 50;
const SUBSCRIBER_SHIPPING = 25;

const ADDR_SLOTS: { key: UserAddressLabel; ar: string; en: string; icon: 'home' | 'briefcase' | 'flag' }[] = [
  { key: 'home', ar: 'المنزل', en: 'Home', icon: 'home' },
  { key: 'work', ar: 'العمل',  en: 'Work', icon: 'briefcase' },
  { key: 'club', ar: 'النادي', en: 'Club', icon: 'flag' },
];

interface CheckoutTabProps {
  checkoutForm: CheckoutForm;
  setCheckoutForm: (form: CheckoutForm) => void;
  submittingOrder: boolean;
  cartItemsCount: number;
  getSubtotal: () => number;
  getItemCount: () => number;
  getTotalSavings?: () => number;
  getOriginalTotal?: () => number;
  isRTL: boolean;
  onSubmitOrder: () => void;
  isInitialLoading?: boolean;
  isSubscriberDiscount?: boolean;
  savedAddresses?: UserAddress[];
  onApplySavedAddress?: (addr: UserAddress) => void;
  cartItems?: CartItem[];
}

export const CheckoutTab: React.FC<CheckoutTabProps> = ({
  checkoutForm,
  setCheckoutForm,
  submittingOrder,
  cartItemsCount,
  getSubtotal,
  getItemCount,
  getTotalSavings,
  isRTL,
  onSubmitOrder,
  isInitialLoading = false,
  isSubscriberDiscount = false,
  savedAddresses,
  onApplySavedAddress,
  cartItems = [],
}) => {
  const { colors } = useTheme();
  const { language } = useTranslation();
  const filledSlots = ADDR_SLOTS.filter(s => savedAddresses?.some(a => a.label === s.key));

  const [locating, setLocating] = useState(false);
  const [showCartItems, setShowCartItems] = useState(false);

  const shippingCost = isSubscriberDiscount ? SUBSCRIBER_SHIPPING : FULL_SHIPPING;

  const fade = useSharedValue(isInitialLoading && cartItemsCount === 0 ? 0.5 : 1);
  useEffect(() => {
    fade.value = withTiming(isInitialLoading && cartItemsCount === 0 ? 0.5 : 1, { duration: 220 });
  }, [isInitialLoading, cartItemsCount, fade]);
  const fadeStyle = useAnimatedStyle(() => ({ opacity: fade.value }));

  if (isInitialLoading && cartItemsCount === 0) {
    return (
      <Reanimated.View style={fadeStyle}>
        {[0, 1, 2].map((i) => (
          <View key={`co-skel-${i}`} style={{
            padding: 16, borderRadius: 14, borderWidth: 1,
            backgroundColor: colors.card, borderColor: colors.border, marginBottom: 12,
          }}>
            <Skeleton width="40%" height={16} borderRadius={6} moodAware={false} />
            <View style={{ height: 12 }} />
            <Skeleton width="100%" height={42} borderRadius={8} moodAware={false} />
          </View>
        ))}
      </Reanimated.View>
    );
  }

  const updateForm = (field: keyof CheckoutForm, value: string) => {
    setCheckoutForm({ ...checkoutForm, [field]: value });
  };

  const BUSINESS_WHATSAPP_NUMBER = '201011033571';
  const BUSINESS_WHATSAPP_TEXT = 'اريد معلومات اكثر عن الدفع والتوصيل وما هي المدة المقدرة لتوصيل الطلب وكيف يتم حساب مصاريف الشحن';
  const openBusinessWhatsApp = async () => {
    try {
      await Linking.openURL(`https://wa.me/${BUSINESS_WHATSAPP_NUMBER}?text=${encodeURIComponent(BUSINESS_WHATSAPP_TEXT)}`);
    } catch {}
  };

  const handleUseMyLocation = async () => {
    setLocating(true);
    try {
      const Location = await import('expo-location');
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert(
          language === 'ar' ? 'تعذّر الوصول للموقع' : 'Location access denied',
          language === 'ar' ? 'يرجى السماح للتطبيق باستخدام الموقع من الإعدادات' : 'Please allow location access in settings',
        );
        return;
      }
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      const { latitude, longitude } = pos.coords;
      let updated: CheckoutForm = { ...checkoutForm, deliveryLatitude: latitude, deliveryLongitude: longitude };
      try {
        const [geo] = await Location.reverseGeocodeAsync({ latitude, longitude });
        if (geo) {
          if (!updated.streetAddress && (geo.street || geo.name)) {
            updated = { ...updated, streetAddress: [geo.streetNumber, geo.street].filter(Boolean).join(' ') || geo.name || '' };
          }
          if (!updated.city && geo.city) updated = { ...updated, city: geo.city };
          if (!updated.state && (geo.region || geo.subregion)) updated = { ...updated, state: geo.region || geo.subregion || '' };
        }
      } catch {}
      setCheckoutForm(updated);
    } catch {
      Alert.alert('', language === 'ar' ? 'تعذّر تحديد الموقع' : 'Could not get location');
    } finally {
      setLocating(false);
    }
  };

  const hasLocation = checkoutForm.deliveryLatitude != null && checkoutForm.deliveryLongitude != null;

  return (
    <Reanimated.View style={fadeStyle}>
      <GlassCard>
        <Text style={[styles.kicker, { color: COLORS.goldBright }]}>
          {language === 'ar' ? 'احجز مكانك' : 'Reserve Your Table'}
        </Text>
        <Text style={[styles.sectionTitle, { color: colors.text }]}>
          {language === 'ar' ? 'احجز طاولتك' : 'Reserve Your Table'}
        </Text>
        <View style={styles.goldRule} />

        {/* ── Guest Information ──────────────────────────────────────────── */}
        <View style={styles.formSection}>
          <Text style={[styles.formSectionTitle, { color: COLORS.goldBright }]}>
            {language === 'ar' ? 'بيانات الضيف' : 'Guest Information'}
          </Text>

          <View style={styles.row}>
            <View style={[styles.inputGroup, { flex: 1 }]}>
              <Text style={[styles.inputLabel, { color: colors.text }]}>
                {language === 'ar' ? 'الاسم الأول *' : 'First Name *'}
              </Text>
              <TextInput
                style={[styles.input, { backgroundColor: colors.surface, borderColor: colors.border, color: colors.text }]}
                value={checkoutForm.firstName}
                onChangeText={(t) => updateForm('firstName', t)}
                placeholderTextColor={colors.textSecondary}
              />
            </View>
            <View style={[styles.inputGroup, { flex: 1, marginLeft: 8 }]}>
              <Text style={[styles.inputLabel, { color: colors.text }]}>
                {language === 'ar' ? 'الاسم الأخير' : 'Last Name'}
              </Text>
              <TextInput
                style={[styles.input, { backgroundColor: colors.surface, borderColor: colors.border, color: colors.text }]}
                value={checkoutForm.lastName}
                onChangeText={(t) => updateForm('lastName', t)}
                placeholderTextColor={colors.textSecondary}
              />
            </View>
          </View>

          <View style={styles.inputGroup}>
            <Text style={[styles.inputLabel, { color: colors.text }]}>
              {language === 'ar' ? 'البريد الإلكتروني' : 'Email'}
            </Text>
            <TextInput
              style={[styles.input, { backgroundColor: colors.surface, borderColor: colors.border, color: colors.text }]}
              value={checkoutForm.email}
              onChangeText={(t) => updateForm('email', t)}
              keyboardType="email-address"
              placeholderTextColor={colors.textSecondary}
            />
          </View>

          <View style={styles.inputGroup}>
            <View style={styles.phoneLabelRow}>
              <Text style={[styles.inputLabel, { color: colors.text }]}>
                {language === 'ar' ? 'رقم الهاتف *' : 'Phone *'}
              </Text>
              <TouchableOpacity style={styles.whatsappBadge} onPress={openBusinessWhatsApp}>
                <Ionicons name="logo-whatsapp" size={16} color="#25D366" />
              </TouchableOpacity>
            </View>
            <View style={styles.phoneInputRow}>
              <TextInput
                style={[styles.input, styles.phoneInput, { backgroundColor: colors.surface, borderColor: colors.border, color: colors.text }]}
                value={checkoutForm.phone}
                onChangeText={(t) => updateForm('phone', t)}
                keyboardType="phone-pad"
                placeholderTextColor={colors.textSecondary}
                placeholder="01xxxxxxxxx"
              />
              <TouchableOpacity
                style={[styles.whatsappIconBtn, { backgroundColor: '#25D36620', borderColor: '#25D36640' }]}
                onPress={openBusinessWhatsApp}
              >
                <Ionicons name="logo-whatsapp" size={22} color="#25D366" />
              </TouchableOpacity>
            </View>
          </View>
        </View>

        {/* ── Delivery Address ───────────────────────────────────────────── */}
        <View style={styles.formSection}>
          <Text style={[styles.formSectionTitle, { color: COLORS.goldBright }]}>
            {language === 'ar' ? 'عنوان التوصيل' : 'Delivery Address'}
          </Text>

          {/* GPS button */}
          <TouchableOpacity
            style={[styles.gpsBtn, { borderColor: hasLocation ? '#10B981' : COLORS.goldBright + '55', backgroundColor: hasLocation ? '#10B98112' : COLORS.goldBright + '10' }]}
            onPress={handleUseMyLocation}
            disabled={locating}
            activeOpacity={0.82}
          >
            {locating ? (
              <ActivityIndicator size="small" color={COLORS.goldBright} />
            ) : (
              <Ionicons
                name={hasLocation ? 'location' : 'location-outline'}
                size={16}
                color={hasLocation ? '#10B981' : COLORS.goldBright}
              />
            )}
            <Text style={[styles.gpsBtnText, { color: hasLocation ? '#10B981' : COLORS.goldBright }]}>
              {locating
                ? (language === 'ar' ? 'جاري تحديد الموقع…' : 'Getting location…')
                : hasLocation
                  ? (language === 'ar' ? 'تم تحديد الموقع ✓' : 'Location confirmed ✓')
                  : (language === 'ar' ? 'استخدام موقعي الحالي' : 'Use my current location')}
            </Text>
          </TouchableOpacity>

          {/* Map preview — appears when GPS location is confirmed */}
          {hasLocation && (
            <View style={styles.mapPreviewWrap}>
              <MapsPreviewStrip
                latitude={checkoutForm.deliveryLatitude}
                longitude={checkoutForm.deliveryLongitude}
                height={150}
                showOpenButton
                rounded
              />
            </View>
          )}

          {/* Saved address chips */}
          {filledSlots.length > 0 && onApplySavedAddress ? (
            <View style={styles.savedAddrWrap}>
              <Text style={[styles.savedAddrLabel, { color: colors.textSecondary }]}>
                {language === 'ar' ? 'ملأ تلقائي من عنوان محفوظ' : 'Autofill from saved address'}
              </Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingVertical: 4 }}>
                {filledSlots.map(slot => {
                  const addr = savedAddresses!.find(a => a.label === slot.key)!;
                  return (
                    <TouchableOpacity
                      key={slot.key}
                      activeOpacity={0.82}
                      onPress={() => onApplySavedAddress(addr)}
                      style={[styles.savedAddrChip, { borderColor: COLORS.goldBright + '55', backgroundColor: COLORS.goldBright + '12' }]}
                    >
                      <Ionicons name={slot.icon} size={13} color={COLORS.goldBright} />
                      <View style={{ flex: 1 }}>
                        <Text style={[styles.savedAddrChipTitle, { color: COLORS.goldBright }]}>
                          {language === 'ar' ? slot.ar : slot.en}
                        </Text>
                        {addr.address ? (
                          <Text style={[styles.savedAddrChipSub, { color: colors.textSecondary }]} numberOfLines={1}>
                            {addr.address}
                          </Text>
                        ) : null}
                      </View>
                      <Ionicons name="chevron-forward" size={13} color={COLORS.goldBright + '80'} />
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            </View>
          ) : null}

          <View style={styles.inputGroup}>
            <Text style={[styles.inputLabel, { color: colors.text }]}>
              {language === 'ar' ? 'العنوان *' : 'Street Address *'}
            </Text>
            <TextInput
              style={[styles.input, { backgroundColor: colors.surface, borderColor: colors.border, color: colors.text }]}
              value={checkoutForm.streetAddress}
              onChangeText={(t) => updateForm('streetAddress', t)}
              placeholderTextColor={colors.textSecondary}
            />
          </View>

          <View style={styles.row}>
            <View style={[styles.inputGroup, { flex: 1 }]}>
              <Text style={[styles.inputLabel, { color: colors.text }]}>
                {language === 'ar' ? 'المدينة *' : 'City *'}
              </Text>
              <TextInput
                style={[styles.input, { backgroundColor: colors.surface, borderColor: colors.border, color: colors.text }]}
                value={checkoutForm.city}
                onChangeText={(t) => updateForm('city', t)}
                placeholderTextColor={colors.textSecondary}
              />
            </View>
            <View style={[styles.inputGroup, { flex: 1, marginLeft: 8 }]}>
              <Text style={[styles.inputLabel, { color: colors.text }]}>
                {language === 'ar' ? 'المحافظة' : 'State'}
              </Text>
              <TextInput
                style={[styles.input, { backgroundColor: colors.surface, borderColor: colors.border, color: colors.text }]}
                value={checkoutForm.state}
                onChangeText={(t) => updateForm('state', t)}
                placeholderTextColor={colors.textSecondary}
              />
            </View>
          </View>

          <View style={styles.inputGroup}>
            <Text style={[styles.inputLabel, { color: colors.text }]}>
              {language === 'ar' ? 'تعليمات التوصيل' : 'Delivery Instructions'}
            </Text>
            <TextInput
              style={[styles.textArea, { backgroundColor: colors.surface, borderColor: colors.border, color: colors.text }]}
              value={checkoutForm.deliveryInstructions}
              onChangeText={(t) => updateForm('deliveryInstructions', t)}
              multiline
              numberOfLines={3}
              placeholderTextColor={colors.textSecondary}
            />
          </View>
        </View>

        {/* ── Payment Method ─────────────────────────────────────────────── */}
        <View style={styles.formSection}>
          <Text style={[styles.formSectionTitle, { color: COLORS.goldBright }]}>
            {language === 'ar' ? 'طريقة الدفع' : 'Payment Method'}
          </Text>
          <View style={styles.paymentRow}>
            {([
              { value: 'cash_on_delivery', arLabel: 'كاش عند الاستلام', enLabel: 'Cash on Delivery', icon: 'cash-outline' },
              { value: 'card', arLabel: 'بطاقة بنكية', enLabel: 'Card / Online', icon: 'card-outline' },
            ] as const).map((opt) => {
              const selected = checkoutForm.paymentMethod === opt.value;
              return (
                <TouchableOpacity
                  key={opt.value}
                  activeOpacity={0.82}
                  style={[
                    styles.paymentOption,
                    {
                      borderColor: selected ? COLORS.goldBright : colors.border,
                      backgroundColor: selected ? COLORS.goldBright + '18' : colors.surface,
                    },
                  ]}
                  onPress={() => setCheckoutForm({ ...checkoutForm, paymentMethod: opt.value })}
                >
                  <Ionicons
                    name={opt.icon}
                    size={20}
                    color={selected ? COLORS.goldBright : colors.textSecondary}
                  />
                  <Text style={[styles.paymentOptionText, { color: selected ? COLORS.goldBright : colors.textSecondary }]}>
                    {language === 'ar' ? opt.arLabel : opt.enLabel}
                  </Text>
                  {selected && <Ionicons name="checkmark-circle" size={15} color={COLORS.goldBright} />}
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        {/* ── Cart Items Review ──────────────────────────────────────────── */}
        {cartItems.length > 0 && (
          <View style={styles.formSection}>
            <TouchableOpacity
              style={[styles.cartReviewHeader, isRTL && styles.rowReverse]}
              activeOpacity={0.8}
              onPress={() => setShowCartItems((v) => !v)}
            >
              <Text style={[styles.formSectionTitle, { color: COLORS.goldBright, marginBottom: 0 }]}>
                {language === 'ar' ? 'مراجعة الطلب' : 'Order Items'}
              </Text>
              <View style={styles.cartReviewHeaderRight}>
                <Text style={[styles.cartReviewCount, { color: colors.textSecondary }]}>
                  {cartItems.length} {language === 'ar' ? 'صنف' : 'items'}
                </Text>
                <Ionicons
                  name={showCartItems ? 'chevron-up' : 'chevron-down'}
                  size={16}
                  color={colors.textSecondary}
                />
              </View>
            </TouchableOpacity>

            {showCartItems && (
              <View style={[styles.cartItemsList, { borderColor: colors.border }]}>
                {cartItems.map((item, idx) => {
                  const imgUrl = item.product?.image_url ?? item.image_url;
                  const itemName = language === 'ar'
                    ? (item.product?.name_ar ?? item.name_ar ?? item.product?.name ?? item.name ?? '')
                    : (item.product?.name ?? item.name ?? '');
                  const isBundleItem = !!item.bundle_group_id;
                  const originalPrice = parseFloat(String(item.original_unit_price ?? item.product?.price ?? 0));
                  const finalPrice = parseFloat(String(item.final_unit_price ?? item.product?.price ?? 0));
                  const hasBundleDiscount = isBundleItem && originalPrice > finalPrice && originalPrice > 0;
                  const bundlePct = hasBundleDiscount
                    ? Math.round(((originalPrice - finalPrice) / originalPrice) * 100)
                    : 0;
                  return (
                    <View
                      key={`${item.product_id}-${item.fitment_indicator ?? 'null'}-${idx}`}
                      style={[
                        styles.cartItemRow,
                        isRTL && styles.rowReverse,
                        idx < cartItems.length - 1 && { borderBottomWidth: 1, borderBottomColor: colors.border + '60' },
                      ]}
                    >
                      {imgUrl ? (
                        <Image source={{ uri: imgUrl }} style={styles.cartItemImg} contentFit="cover" />
                      ) : (
                        <View style={[styles.cartItemImg, { backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' }]}>
                          <Ionicons name="fast-food-outline" size={18} color={colors.textSecondary} />
                        </View>
                      )}
                      <View style={styles.cartItemInfo}>
                        <Text style={[styles.cartItemName, { color: colors.text }]} numberOfLines={1}>
                          {itemName}
                        </Text>
                        {item.fitment_indicator ? (
                          <Text style={[styles.cartItemSub, { color: colors.textSecondary }]}>
                            {item.fitment_indicator}
                          </Text>
                        ) : null}
                        {isBundleItem && (
                          <View style={styles.checkoutBundleChip}>
                            <Ionicons name="gift" size={9} color={COLORS.charcoalDeep} />
                            <Text style={styles.checkoutBundleChipText}>
                              {bundlePct > 0
                                ? (language === 'ar' ? `خصم ${bundlePct}%` : `${bundlePct}% Bundle`)
                                : (language === 'ar' ? 'عرض خاص' : 'Bundle')}
                            </Text>
                          </View>
                        )}
                      </View>
                      <View style={styles.cartItemPriceCol}>
                        <Text style={[styles.cartItemQty, { color: colors.textSecondary }]}>
                          ×{item.quantity}
                        </Text>
                        {hasBundleDiscount && (
                          <Text style={[styles.cartItemOriginalPrice, { color: colors.textSecondary }]}>
                            {(originalPrice * item.quantity).toFixed(0)} ج.م
                          </Text>
                        )}
                        <Text style={[styles.cartItemPrice, { color: hasBundleDiscount ? '#10B981' : COLORS.goldBright }]}>
                          {(finalPrice * item.quantity).toFixed(0)} ج.م
                        </Text>
                      </View>
                    </View>
                  );
                })}
              </View>
            )}
          </View>
        )}

        {/* ── Order Summary ──────────────────────────────────────────────── */}
        <View style={[styles.checkoutSummary, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Text style={[styles.formSectionTitle, { color: COLORS.goldBright }]}>
            {language === 'ar' ? 'ملخّص طلبك' : 'Order Summary'}
          </Text>
          <Text style={[styles.summaryDetail, { color: colors.textSecondary }]}>
            {language === 'ar' ? `${getItemCount()} منتج` : `${getItemCount()} items`}
          </Text>
          <View style={[styles.summaryRow, isRTL && styles.rowReverse]}>
            <Text style={[styles.summaryLabel, { color: colors.textSecondary }]}>
              {language === 'ar' ? 'المجموع الفرعي' : 'Subtotal'}
            </Text>
            <Text style={[styles.summaryValue, { color: colors.text }]}>
              {getSubtotal().toFixed(0)} ج.م
            </Text>
          </View>

          {getTotalSavings && getTotalSavings() > 0 && (
            <View style={[styles.summaryRow, isRTL && styles.rowReverse]}>
              <View style={[{ flexDirection: isRTL ? 'row-reverse' : 'row', alignItems: 'center', gap: 4 }]}>
                <Ionicons name="pricetag" size={12} color="#10B981" />
                <Text style={[styles.summaryLabel, { color: '#10B981' }]}>
                  {language === 'ar' ? 'وفّرت' : 'Bundle savings'}
                </Text>
              </View>
              <Text style={[styles.summaryValue, { color: '#10B981', fontWeight: '700' }]}>
                -{getTotalSavings().toFixed(0)} ج.م
              </Text>
            </View>
          )}

          <View style={[styles.summaryRow, isRTL && styles.rowReverse]}>
            <View style={[styles.shippingLabelWrap, isRTL && styles.rowReverse]}>
              <Text style={[styles.summaryLabel, { color: colors.textSecondary }]}>
                {language === 'ar' ? 'الشحن' : 'Shipping'}
              </Text>
              {isSubscriberDiscount && (
                <View style={styles.subscriberBadge}>
                  <Ionicons name="star" size={9} color="#78350F" />
                  <Text style={styles.subscriberBadgeText}>
                    {language === 'ar' ? 'خصم 50%' : '50% off'}
                  </Text>
                </View>
              )}
            </View>
            <View style={[styles.shippingValueWrap, isRTL && styles.rowReverse]}>
              {isSubscriberDiscount && (
                <Text style={[styles.shippingStrike, { color: colors.textSecondary }]}>
                  {FULL_SHIPPING} ج.م
                </Text>
              )}
              <Text style={[
                styles.summaryValue,
                isSubscriberDiscount && { color: '#10B981', fontWeight: '700' },
                !isSubscriberDiscount && { color: colors.text },
              ]}>
                {shippingCost} ج.م
              </Text>
            </View>
          </View>

          {isSubscriberDiscount && (
            <View style={styles.subscriberNote}>
              <Ionicons name="information-circle-outline" size={12} color="#D97706" />
              <Text style={styles.subscriberNoteText}>
                {language === 'ar'
                  ? 'مبروك! خصم المشترك يُطبَّق تلقائياً على طلبك'
                  : 'Subscriber discount applied automatically'}
              </Text>
            </View>
          )}

          <View style={[styles.totalRow, { borderTopColor: colors.border }, isRTL && styles.rowReverse]}>
            <Text style={[styles.totalLabel, { color: colors.text }]}>
              {language === 'ar' ? 'الإجمالي' : 'Total'}
            </Text>
            <Text style={[styles.totalValue, { color: COLORS.goldBright }]}>
              {(getSubtotal() + shippingCost).toFixed(0)} ج.م
            </Text>
          </View>
        </View>

        <TouchableOpacity
          onPress={onSubmitOrder}
          disabled={submittingOrder || cartItemsCount === 0}
          style={[styles.submitOrderBtnWrap, (submittingOrder || cartItemsCount === 0) && { opacity: 0.6 }]}
        >
          <LinearGradient
            colors={[COLORS.gold, COLORS.goldSoft, COLORS.gold]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={styles.submitOrderBtn}
          >
            {submittingOrder ? (
              <ActivityIndicator color={COLORS.charcoalDeep} />
            ) : (
              <>
                <Ionicons name="wine" size={18} color={COLORS.charcoalDeep} />
                <Text style={[styles.submitOrderBtnText, { color: COLORS.charcoalDeep }]}>
                  {language === 'ar' ? 'تأكيد الحجز' : 'Confirm Reservation'}
                </Text>
              </>
            )}
          </LinearGradient>
        </TouchableOpacity>
      </GlassCard>
    </Reanimated.View>
  );
};

const styles = StyleSheet.create({
  sectionTitle: {
    ...TYPE.title,
    fontSize: 24,
    marginBottom: 6,
  },
  kicker: {
    ...TYPE.microLabel,
    marginBottom: 4,
  },
  goldRule: {
    height: 1,
    backgroundColor: COLORS.gold,
    opacity: 0.55,
    width: 56,
    marginBottom: 18,
  },
  formSection: {
    marginBottom: 20,
  },
  formSectionTitle: {
    ...TYPE.microLabel,
    fontSize: 12,
    marginBottom: 12,
  },
  row: {
    flexDirection: 'row',
  },
  rowReverse: {
    flexDirection: 'row-reverse',
  },
  inputGroup: {
    marginBottom: 12,
  },
  phoneLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  whatsappBadge: {
    padding: 4,
  },
  phoneInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  phoneInput: {
    flex: 1,
  },
  whatsappIconBtn: {
    width: 44,
    height: 44,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  inputLabel: {
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 4,
  },
  input: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
  },
  textArea: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    minHeight: 70,
    textAlignVertical: 'top',
  },
  gpsBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginBottom: 12,
  },
  gpsBtnText: {
    fontSize: 13,
    fontWeight: '600',
    flex: 1,
  },
  paymentRow: {
    flexDirection: 'row',
    gap: 10,
  },
  paymentOption: {
    flex: 1,
    flexDirection: 'column',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1.5,
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 8,
  },
  paymentOptionText: {
    fontSize: 11,
    fontWeight: '600',
    textAlign: 'center',
  },
  cartReviewHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  cartReviewHeaderRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  cartReviewCount: {
    fontSize: 12,
  },
  cartItemsList: {
    borderWidth: 1,
    borderRadius: 10,
    overflow: 'hidden',
    marginBottom: 4,
  },
  cartItemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  cartItemImg: {
    width: 40,
    height: 40,
    borderRadius: 8,
  },
  cartItemInfo: {
    flex: 1,
    gap: 2,
  },
  cartItemName: {
    fontSize: 13,
    fontWeight: '500',
  },
  cartItemSub: {
    fontSize: 11,
  },
  cartItemPriceCol: {
    alignItems: 'flex-end',
    gap: 2,
  },
  cartItemQty: {
    fontSize: 11,
  },
  cartItemPrice: {
    fontSize: 13,
    fontWeight: '700',
  },
  cartItemOriginalPrice: {
    fontSize: 11,
    textDecorationLine: 'line-through',
  },
  checkoutBundleChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: COLORS.gold,
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderRadius: 5,
    alignSelf: 'flex-start',
    marginTop: 2,
  },
  checkoutBundleChipText: {
    color: COLORS.charcoalDeep,
    fontSize: 9,
    fontWeight: '800',
  },
  checkoutSummary: {
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 16,
  },
  summaryDetail: {
    fontSize: 12,
    marginBottom: 8,
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  summaryLabel: {
    fontSize: 14,
  },
  summaryValue: {
    fontSize: 14,
    fontWeight: '500',
  },
  shippingLabelWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  shippingValueWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  shippingStrike: {
    fontSize: 12,
    textDecorationLine: 'line-through',
    opacity: 0.7,
  },
  subscriberBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: '#FEF3C7',
    borderWidth: 1,
    borderColor: '#F59E0B',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 8,
  },
  subscriberBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#78350F',
  },
  subscriberNote: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: '#FEF3C715',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#F59E0B30',
  },
  subscriberNoteText: {
    fontSize: 11,
    color: '#D97706',
    flex: 1,
  },
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: 12,
    marginTop: 8,
    borderTopWidth: 1,
  },
  totalLabel: {
    ...TYPE.title,
    fontSize: 16,
  },
  totalValue: {
    ...TYPE.price,
    fontSize: 22,
  },
  mapPreviewWrap: {
    marginTop: 10,
    marginBottom: 4,
    borderRadius: 12,
    overflow: 'hidden',
  },
  savedAddrWrap: {
    marginBottom: 12,
    gap: 6,
  },
  savedAddrLabel: {
    fontSize: 11,
    fontWeight: '500',
    letterSpacing: 0.3,
    marginBottom: 2,
  },
  savedAddrChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 12,
    borderWidth: 1,
    minWidth: 110,
    maxWidth: 180,
  },
  savedAddrChipTitle: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  savedAddrChipSub: {
    fontSize: 10,
    marginTop: 1,
    opacity: 0.85,
  },
  submitOrderBtnWrap: {
    borderRadius: RADII.sm,
    overflow: 'hidden',
  },
  submitOrderBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingVertical: 16,
    borderRadius: RADII.sm,
  },
  submitOrderBtnText: {
    ...TYPE.spacedButton,
    fontSize: 13,
  },
});

export default CheckoutTab;
