import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Dimensions,
  Linking,
  ToastAndroid,
} from 'react-native';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withTiming,
  interpolate,
  FadeIn,
  FadeInDown,
  FadeOut,
  SlideInRight,
  SlideOutLeft,
} from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import { useTheme } from '../src/hooks/useTheme';
import { useTranslation } from '../src/hooks/useTranslation';
import { useAppStore } from '../src/store/appStore';
import { ordersApi, cartApi, subscriptionRequestApi, userAddressApi, type UserAddress, type UserAddressLabel } from '../src/services/api';
import { useQuery } from '@tanstack/react-query';
import ConfettiEffect from '../src/components/ui/ConfettiEffect';
import { analytics, AnalyticsEvents } from '../src/services/analytics';
import { TYPE, COLORS, RADII } from '../src/constants/luxuryTokens';
import { MapsPreviewStrip } from '../src/components/MapsPreviewStrip';
import { PinPickerModal } from '../src/components/PinPickerModal';
import { pushNotificationService } from '../src/services/pushNotificationService';
import { t_notif } from '../src/i18n/notificationTranslations';

const { width: screenWidth } = Dimensions.get('window');

// Step indicator component
const StepIndicator = ({ currentStep, totalSteps, labels, isRTL, colors }: any) => {
  return (
    <View style={[styles.stepIndicatorContainer, isRTL && styles.rowReverse]}>
      {labels.map((label: string, index: number) => {
        const isActive = index <= currentStep;
        const isCurrent = index === currentStep;
        const isCompleted = index < currentStep;

        return (
          <React.Fragment key={index}>
            {index > 0 && (
              <View
                style={[
                  styles.stepLine,
                  {
                    backgroundColor: isActive
                      ? COLORS.goldBright
                      : colors.border,
                  },
                ]}
              />
            )}
            <View style={styles.stepItem}>
              <Animated.View
                entering={FadeIn.delay(index * 100)}
                style={[
                  styles.stepCircle,
                  {
                    backgroundColor: isActive
                      ? COLORS.goldBright
                      : colors.surface,
                    borderColor: isActive
                      ? COLORS.goldBright
                      : colors.border,
                  },
                  isCurrent && styles.stepCircleCurrent,
                ]}
              >
                {isCompleted ? (
                  <Ionicons name="checkmark" size={16} color="#FFF" />
                ) : (
                  <Text
                    style={[
                      styles.stepNumber,
                      { color: isActive ? '#FFF' : colors.textSecondary },
                    ]}
                  >
                    {index + 1}
                  </Text>
                )}
              </Animated.View>
              <Text
                style={[
                  styles.stepLabel,
                  {
                    color: isActive ? colors.text : colors.textSecondary,
                    fontWeight: isCurrent ? '700' : '500',
                  },
                ]}
                numberOfLines={1}
              >
                {label}
              </Text>
            </View>
          </React.Fragment>
        );
      })}
    </View>
  );
};

// Step 1: Review Cart with Enhanced Pricing
const ReviewStep = ({ cartItems, getTotal, getOriginalTotal, getTotalSavings, shippingCost, isSubscriberDiscount, language, isRTL, colors, onNext }: any) => {
  const totalSavings = getTotalSavings();
  
  return (
    <Animated.View
      entering={SlideInRight.duration(300)}
      exiting={SlideOutLeft.duration(300)}
      style={styles.stepContent}
    >
      <Text style={[styles.stepKicker, { color: COLORS.goldBright }, isRTL && styles.textRight]}>
        {language === 'ar' ? 'الدورة الأولى' : 'First Course'}
      </Text>
      <Text style={[styles.stepTitle, { color: colors.text }, isRTL && styles.textRight]}>
        {language === 'ar' ? 'راجع طلبك' : 'Review Your Selections'}
      </Text>
      <View style={[styles.goldRule, isRTL && { alignSelf: 'flex-end' }]} />
      <Text style={[styles.stepSubtitle, { color: colors.textSecondary }, isRTL && styles.textRight]}>
        {language === 'ar' ? 'تأكد من الأطباق والكميات قبل المتابعة' : 'Confirm your dishes and quantities before continuing'}
      </Text>

      <View style={[styles.cartReviewCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        {cartItems.map((item: any, index: number) => {
          // Use server-side cart pricing
          const originalPrice = parseFloat(String(item.original_unit_price ?? item.product?.price ?? 0)) || 0;
          const finalPrice = parseFloat(String(item.final_unit_price ?? item.discountedPrice ?? item.product?.price ?? 0)) || 0;
          const hasDiscount = originalPrice > finalPrice && originalPrice > 0;
          const discountDetails = item.discount_details;
          
          return (
            <Animated.View
              key={item.product_id || item.productId || index}
              entering={FadeInDown.delay(index * 50)}
              style={[
                styles.reviewItem,
                isRTL && styles.rowReverse,
                index < cartItems.length - 1 && { borderBottomWidth: 1, borderBottomColor: colors.border },
              ]}
            >
              <View style={styles.reviewItemImage}>
                {item.product?.image ? (
                  <Image 
                    source={{ uri: item.product.image }} 
                    style={styles.reviewImg} 
                    contentFit="cover"
                    cachePolicy="disk"
                  />
                ) : (
                  <View style={[styles.reviewImgPlaceholder, { backgroundColor: colors.border }]}>
                    <Ionicons name="cube-outline" size={24} color={colors.textSecondary} />
                  </View>
                )}
              </View>
              <View style={[styles.reviewItemInfo, isRTL && { alignItems: 'flex-end' }]}>
                <Text style={[styles.reviewItemName, { color: colors.text }]} numberOfLines={2}>
                  {language === 'ar' ? item.product?.name_ar || item.product?.name : item.product?.name || 'Product'}
                </Text>
                <View style={styles.reviewItemMeta}>
                  <Text style={[styles.reviewItemQty, { color: colors.textSecondary }]}>
                    {language === 'ar' ? `الكمية: ${item.quantity}` : `Qty: ${item.quantity}`}
                  </Text>
                  {hasDiscount && discountDetails?.discount_type === 'bundle' && (
                    <View style={[styles.reviewDiscountBadge, { backgroundColor: COLORS.burgundy }]}>
                      <Text style={styles.reviewDiscountBadgeText}>
                        -{discountDetails.discount_value}%
                      </Text>
                    </View>
                  )}
                </View>
              </View>
              <View style={styles.reviewItemPrice}>
                {hasDiscount && (
                  <Text style={[styles.reviewOriginalPrice, { color: colors.textSecondary }]}>
                    {(originalPrice * item.quantity).toFixed(0)} ج.م
                  </Text>
                )}
                <Text style={[styles.reviewFinalPrice, { color: COLORS.goldBright }]}>
                  {(finalPrice * item.quantity).toFixed(0)} ج.م
                </Text>
              </View>
            </Animated.View>
          );
        })}

        {/* Order Summary with Savings */}
        <View style={[styles.reviewSummary, { borderTopColor: colors.border }]}>
          {totalSavings > 0 && (
            <View style={[styles.reviewSummaryRow, isRTL && styles.rowReverse]}>
              <Text style={[styles.reviewSummaryLabel, { color: colors.textSecondary }]}>
                {language === 'ar' ? 'المجموع الأصلي:' : 'Original:'}
              </Text>
              <Text style={[styles.reviewOriginalTotal, { color: colors.textSecondary }]}>
                {getOriginalTotal().toFixed(0)} ج.م
              </Text>
            </View>
          )}
          {totalSavings > 0 && (
            <View style={[styles.reviewSummaryRow, isRTL && styles.rowReverse]}>
              <View style={styles.savingsIconRow}>
                <Ionicons name="sparkles" size={14} color={COLORS.burgundy} />
                <Text style={[styles.reviewSavingsLabel, { color: COLORS.burgundy }]}>
                  {language === 'ar' ? 'التوفير:' : 'Savings:'}
                </Text>
              </View>
              <Text style={[styles.reviewSavingsValue, { color: COLORS.burgundy }]}>
                -{totalSavings.toFixed(0)} ج.م
              </Text>
            </View>
          )}
          {/* Shipping fee row */}
          <View style={[styles.reviewSummaryRow, isRTL && styles.rowReverse]}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Text style={[styles.reviewSummaryLabel, { color: colors.textSecondary }]}>
                {language === 'ar' ? 'رسوم التوصيل:' : 'Delivery:'}
              </Text>
              {isSubscriberDiscount && (
                <View style={[styles.subscriberDiscountBadge]}>
                  <Ionicons name="star" size={10} color={COLORS.burgundy} />
                  <Text style={styles.subscriberDiscountBadgeText}>
                    {language === 'ar' ? 'خصم 50%' : '50% off'}
                  </Text>
                </View>
              )}
            </View>
            <Text style={[styles.reviewSummaryLabel, { color: isSubscriberDiscount ? COLORS.burgundy : colors.text, fontWeight: '600' }]}>
              {shippingCost ?? 50} ج.م
            </Text>
          </View>

          <View style={[styles.reviewTotal, isRTL && styles.rowReverse]}>
            <Text style={[styles.reviewTotalLabel, { color: colors.text }]}>
              {language === 'ar' ? 'الإجمالي:' : 'Total:'}
            </Text>
            <Text style={[styles.reviewTotalValue, { color: COLORS.goldBright }]}>
              {(getTotal() + (shippingCost ?? 50)).toFixed(0)} ج.م
            </Text>
          </View>
        </View>
      </View>
    </Animated.View>
  );
};

// Step 2: Shipping Details
const ShippingStep = ({
  governorate,
  setGovernorate,
  city,
  setCity,
  shippingAddress,
  setShippingAddress,
  phone,
  setPhone,
  notes,
  setNotes,
  language,
  isRTL,
  colors,
  subGovernorate,
  subCity,
  subAddress,
  subPhone,
  latitude,
  longitude,
  setLatitude,
  setLongitude,
  setLocationConfirmed,
  setResolvedAddress,
  pickGpsLocation,
  onPinConfirm,
  gpsLoading,
  savedAddresses,
  applySavedAddress,
  saveCurrentAs,
}: any) => {
  const [pinPickerVisible, setPinPickerVisible] = useState(false);

  const SLOTS: { key: 'home' | 'work' | 'club'; ar: string; en: string; icon: any }[] = [
    { key: 'home', ar: 'المنزل', en: 'Home', icon: 'home' },
    { key: 'work', ar: 'العمل',  en: 'Work', icon: 'briefcase' },
    { key: 'club', ar: 'النادي', en: 'Club', icon: 'flag' },
  ];
  const govModified  = subGovernorate && governorate && governorate !== subGovernorate;
  const cityModified = subCity && city && city !== subCity;
  const addrModified = subAddress && shippingAddress && shippingAddress !== subAddress;
  const phoneModified = subPhone && phone && phone !== subPhone;
  const hasAutoFill = !!(subGovernorate || subCity || subAddress || subPhone);

  return (
  <Animated.View
    entering={SlideInRight.duration(300)}
    exiting={SlideOutLeft.duration(300)}
    style={styles.stepContent}
  >
    <Text style={[styles.stepKicker, { color: COLORS.goldBright }, isRTL && styles.textRight]}>
      {language === 'ar' ? 'الدورة الثانية' : 'Second Course'}
    </Text>
    <Text style={[styles.stepTitle, { color: colors.text }, isRTL && styles.textRight]}>
      {language === 'ar' ? 'تفاصيل التوصيل' : 'Delivery Details'}
    </Text>
    <View style={[styles.goldRule, isRTL && { alignSelf: 'flex-end' }]} />
    <Text style={[styles.stepSubtitle, { color: colors.textSecondary }, isRTL && styles.textRight]}>
      {language === 'ar' ? 'إلى أين نحضر طلبك ورقم نتواصل عليه' : 'Where shall we deliver, and how to reach you'}
    </Text>

    {hasAutoFill && (
      <View style={[styles.autoFillBanner, { backgroundColor: COLORS.goldBright + '15', borderColor: COLORS.goldBright + '40' }]}>
        <Ionicons name="checkmark-circle" size={14} color={COLORS.goldBright} />
        <Text style={[styles.autoFillText, { color: COLORS.goldBright }]}>
          {language === 'ar' ? 'تم التعبئة التلقائية من بيانات الاشتراك' : 'Auto-filled from subscription data'}
        </Text>
      </View>
    )}

    {/* Saved addresses chip strip — one tap pre-fills the entire form. */}
    {Array.isArray(savedAddresses) && savedAddresses.length > 0 ? (
      <View style={{ marginTop: 4, marginBottom: 12 }}>
        <Text style={[styles.inputLabel, { color: colors.textSecondary, fontSize: 11 }, isRTL && { textAlign: 'right' }]}>
          {language === 'ar' ? 'العناوين المحفوظة' : 'Saved Addresses'}
        </Text>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: 8, paddingVertical: 4 }}
        >
          {SLOTS.map((slot) => {
            const existing = savedAddresses.find((a: any) => a.label === slot.key);
            if (!existing) return null;
            return (
              <TouchableOpacity
                key={slot.key}
                onPress={() => applySavedAddress(existing)}
                activeOpacity={0.85}
                style={{
                  flexDirection: 'row', alignItems: 'center', gap: 6,
                  paddingHorizontal: 12, paddingVertical: 8,
                  backgroundColor: COLORS.goldBright + '15',
                  borderColor: COLORS.goldBright + '50',
                  borderWidth: 1, borderRadius: 999,
                }}
              >
                <Ionicons name={slot.icon} size={14} color={COLORS.goldBright} />
                <Text style={{ color: COLORS.goldBright, fontWeight: '700', fontSize: 12 }}>
                  {language === 'ar' ? slot.ar : slot.en}
                </Text>
                {existing.latitude != null && existing.longitude != null && (
                  <Ionicons name="location" size={11} color={COLORS.goldBright} style={{ opacity: 0.85 }} />
                )}
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </View>
    ) : null}

    {/* Governorate field */}
    <View style={styles.formGroup}>
      <Text style={[styles.inputLabel, { color: colors.text }, isRTL && styles.textRight]}>
        {language === 'ar' ? 'المحافظة *' : 'Governorate *'}
      </Text>
      <View style={[styles.inputWrapper, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <Ionicons name="business-outline" size={20} color={COLORS.goldBright}
          style={[styles.inputIcon, isRTL && { marginLeft: 12, marginRight: 0 }]} />
        <TextInput
          style={[styles.textInput, { color: colors.text }, isRTL && { textAlign: 'right' }]}
          placeholder={language === 'ar' ? 'مثال: القاهرة' : 'e.g. Cairo'}
          placeholderTextColor={colors.textSecondary}
          value={governorate}
          onChangeText={setGovernorate}
        />
      </View>
      {govModified && (
        <View style={styles.modifiedStrip}>
          <Ionicons name="information-circle-outline" size={13} color="#F59E0B" />
          <Text style={styles.modifiedStripText} numberOfLines={1}>
            {language === 'ar' ? 'الاشتراك: ' : 'Subscription: '}{subGovernorate}
          </Text>
        </View>
      )}
    </View>

    {/* City / Village field */}
    <View style={styles.formGroup}>
      <Text style={[styles.inputLabel, { color: colors.text }, isRTL && styles.textRight]}>
        {language === 'ar' ? 'المدينة/المنطقة' : 'City / Area'}
      </Text>
      <View style={[styles.inputWrapper, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <Ionicons name="map-outline" size={20} color={COLORS.goldBright}
          style={[styles.inputIcon, isRTL && { marginLeft: 12, marginRight: 0 }]} />
        <TextInput
          style={[styles.textInput, { color: colors.text }, isRTL && { textAlign: 'right' }]}
          placeholder={language === 'ar' ? 'مثال: مدينة نصر' : 'e.g. Nasr City'}
          placeholderTextColor={colors.textSecondary}
          value={city}
          onChangeText={setCity}
        />
      </View>
      {cityModified && (
        <View style={styles.modifiedStrip}>
          <Ionicons name="information-circle-outline" size={13} color="#F59E0B" />
          <Text style={styles.modifiedStripText} numberOfLines={1}>
            {language === 'ar' ? 'الاشتراك: ' : 'Subscription: '}{subCity}
          </Text>
        </View>
      )}
    </View>

    {/* GPS Location Strip */}
    <View style={styles.formGroup}>
      <View style={[{ flexDirection: isRTL ? 'row-reverse' : 'row', alignItems: 'center', gap: 6, marginBottom: 4 }]}>
        <Text style={[styles.inputLabel, { color: colors.text, marginBottom: 0 }]}>
          {language === 'ar' ? 'موقع التوصيل' : 'Delivery Location'}
        </Text>
        <View style={{ backgroundColor: COLORS.burgundy + '20', borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 }}>
          <Text style={{ fontSize: 10, fontWeight: '700', color: COLORS.burgundy }}>
            {language === 'ar' ? 'مطلوب' : 'REQUIRED'}
          </Text>
        </View>
      </View>
      {!latitude && !longitude && (
        <Text style={{ fontSize: 12, color: colors.textSecondary, marginBottom: 6, textAlign: isRTL ? 'right' : 'left' }}>
          {language === 'ar'
            ? 'يُرجى تحديد موقعك على الخريطة لتأكيد التوصيل'
            : 'Pin your location on the map to confirm delivery'}
        </Text>
      )}
      <TouchableOpacity
        onPress={pickGpsLocation}
        disabled={gpsLoading}
        activeOpacity={0.85}
        style={[styles.inputWrapper, {
          backgroundColor: COLORS.goldBright + '10',
          borderColor: COLORS.goldBright + '60',
          paddingVertical: 12,
        }]}
      >
        <Ionicons
          name={gpsLoading ? 'sync' : 'navigate'}
          size={18}
          color={COLORS.goldBright}
          style={[styles.inputIcon, isRTL && { marginLeft: 12, marginRight: 0 }]}
        />
        <Text style={{ flex: 1, color: COLORS.goldBright, fontWeight: '700', fontSize: 13 }}>
          {gpsLoading
            ? (language === 'ar' ? 'جارِ تحديد الموقع...' : 'Locating...')
            : latitude && longitude
              ? (language === 'ar' ? '✓ تم تحديد الموقع — تحديث' : '✓ Location set — Update')
              : (language === 'ar' ? 'استخدام موقعي الحالي' : 'Use my current location')}
        </Text>
        {latitude && longitude ? (
          <TouchableOpacity onPress={() => { setLatitude(null); setLongitude(null); setLocationConfirmed(false); setResolvedAddress(null); }}>
            <Ionicons name="close-circle" size={18} color={colors.textSecondary} />
          </TouchableOpacity>
        ) : null}
      </TouchableOpacity>
      {latitude && longitude ? (
        <View style={{ marginTop: 8 }}>
          <MapsPreviewStrip
            latitude={latitude}
            longitude={longitude}
            height={140}
            onMovePinPress={() => setPinPickerVisible(true)}
          />
        </View>
      ) : null}
    </View>

    <PinPickerModal
      visible={pinPickerVisible}
      initialLatitude={latitude}
      initialLongitude={longitude}
      onConfirm={(result) => { onPinConfirm(result); setPinPickerVisible(false); }}
      onClose={() => setPinPickerVisible(false)}
    />

    {/* Save current address into one of the 3 slots — only shown when
        the user has actually entered an address. */}
    {shippingAddress.trim() && saveCurrentAs ? (
      <View style={{ marginBottom: 12 }}>
        <Text style={[styles.inputLabel, { color: colors.textSecondary, fontSize: 11 }, isRTL && { textAlign: 'right' }]}>
          {language === 'ar' ? 'احفظ هذا العنوان كـ' : 'Save this address as'}
        </Text>
        <View style={{ flexDirection: 'row', gap: 8, marginTop: 4 }}>
          {SLOTS.map((slot) => (
            <TouchableOpacity
              key={slot.key}
              onPress={() => saveCurrentAs(slot.key)}
              activeOpacity={0.85}
              style={{
                flex: 1, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 6,
                paddingVertical: 10, borderRadius: 10,
                borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface,
              }}
            >
              <Ionicons name={slot.icon} size={14} color={COLORS.goldBright} />
              <Text style={{ color: colors.text, fontWeight: '700', fontSize: 12 }}>
                {language === 'ar' ? slot.ar : slot.en}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>
    ) : null}

    {/* Detailed address field */}
    <View style={styles.formGroup}>
      <Text style={[styles.inputLabel, { color: colors.text }, isRTL && styles.textRight]}>
        {language === 'ar' ? 'العنوان بالتفصيل *' : 'Detailed Address *'}
      </Text>
      <View style={[styles.inputWrapper, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <Ionicons
          name="location-outline"
          size={20}
          color={COLORS.goldBright}
          style={[styles.inputIcon, isRTL && { marginLeft: 12, marginRight: 0 }]}
        />
        <TextInput
          style={[
            styles.textAreaInput,
            { color: colors.text },
            isRTL && { textAlign: 'right' },
          ]}
          placeholder={language === 'ar' ? 'الشارع، رقم المبنى، الدور...' : 'Street, building, floor...'}
          placeholderTextColor={colors.textSecondary}
          value={shippingAddress}
          onChangeText={setShippingAddress}
          multiline
          numberOfLines={3}
        />
      </View>
      {addrModified && (
        <View style={styles.modifiedStrip}>
          <Ionicons name="information-circle-outline" size={13} color="#F59E0B" />
          <Text style={styles.modifiedStripText} numberOfLines={1}>
            {language === 'ar' ? 'الاشتراك: ' : 'Subscription: '}{subAddress}
          </Text>
        </View>
      )}
    </View>

    <View style={styles.formGroup}>
      <Text style={[styles.inputLabel, { color: colors.text }, isRTL && styles.textRight]}>
        {language === 'ar' ? 'رقم الهاتف *' : 'Phone Number *'}
      </Text>
      <View style={[styles.inputWrapper, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <Ionicons
          name="call-outline"
          size={20}
          color={COLORS.goldBright}
          style={[styles.inputIcon, isRTL && { marginLeft: 12, marginRight: 0 }]}
        />
        <TextInput
          style={[
            styles.textInput,
            { color: colors.text },
            isRTL && { textAlign: 'right' },
          ]}
          placeholder={language === 'ar' ? '01xxxxxxxxx' : '01xxxxxxxxx'}
          placeholderTextColor={colors.textSecondary}
          value={phone}
          onChangeText={setPhone}
          keyboardType="phone-pad"
        />
        <TouchableOpacity
          onPress={() => Linking.openURL('https://wa.me/201011033571?text=%D8%AA%D9%81%D8%B6%D9%84%20%D9%83%D9%8A%D9%81%20%D9%8A%D9%85%D9%83%D9%86%D9%86%D9%8A%20%D9%85%D8%B3%D8%A7%D8%B9%D8%AF%D8%AA%D9%83')}
          activeOpacity={0.7}
          style={{ padding: 6 }}
        >
          <Ionicons name="logo-whatsapp" size={22} color="#25D366" />
        </TouchableOpacity>
      </View>
      {phoneModified && (
        <View style={styles.modifiedStrip}>
          <Ionicons name="information-circle-outline" size={13} color="#F59E0B" />
          <Text style={styles.modifiedStripText}>
            {language === 'ar' ? 'الاشتراك: ' : 'Subscription: '}{subPhone}
          </Text>
        </View>
      )}
    </View>

    <View style={styles.formGroup}>
      <Text style={[styles.inputLabel, { color: colors.text }, isRTL && styles.textRight]}>
        {language === 'ar' ? 'ملاحظات (اختياري)' : 'Notes (Optional)'}
      </Text>
      <View style={[styles.inputWrapper, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <Ionicons
          name="document-text-outline"
          size={20}
          color={COLORS.goldBright}
          style={[styles.inputIcon, isRTL && { marginLeft: 12, marginRight: 0 }]}
        />
        <TextInput
          style={[
            styles.textAreaInput,
            { color: colors.text },
            isRTL && { textAlign: 'right' },
          ]}
          placeholder={language === 'ar' ? 'ملاحظات إضافية...' : 'Additional notes...'}
          placeholderTextColor={colors.textSecondary}
          value={notes}
          onChangeText={setNotes}
          multiline
          numberOfLines={3}
        />
      </View>
    </View>
  </Animated.View>
  );
};

// Step 3: Confirmation with Enhanced Pricing Display
const ConfirmStep = ({
  cartItems,
  getTotal,
  getOriginalTotal,
  getTotalSavings,
  shippingCost,
  isSubscriberDiscount,
  shippingAddress,
  phone,
  notes,
  language,
  isRTL,
  colors,
}: any) => {
  const totalSavings = getTotalSavings();
  
  return (
    <Animated.View
      entering={SlideInRight.duration(300)}
      exiting={SlideOutLeft.duration(300)}
      style={styles.stepContent}
    >
      <Text style={[styles.stepKicker, { color: COLORS.goldBright }, isRTL && styles.textRight]}>
        {language === 'ar' ? 'الدورة الأخيرة' : 'Final Course'}
      </Text>
      <Text style={[styles.stepTitle, { color: colors.text }, isRTL && styles.textRight]}>
        {language === 'ar' ? 'تأكيد الحجز' : 'Confirm Reservation'}
      </Text>
      <View style={[styles.goldRule, isRTL && { alignSelf: 'flex-end' }]} />
      <Text style={[styles.stepSubtitle, { color: colors.textSecondary }, isRTL && styles.textRight]}>
        {language === 'ar' ? 'تفقّد التفاصيل قبل تأكيد الحجز' : 'Review the details before confirming your reservation'}
      </Text>

      {/* Order Summary with Savings */}
      <View style={[styles.confirmCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <View style={[styles.confirmSection, isRTL && styles.rowReverse]}>
          <View style={[styles.confirmIconCircle, { backgroundColor: `${COLORS.goldBright}20` }]}>
            <Ionicons name="cart" size={20} color={COLORS.goldBright} />
          </View>
          <View style={styles.confirmSectionContent}>
            <Text style={[styles.confirmSectionTitle, { color: colors.text }, isRTL && styles.textRight]}>
              {language === 'ar' ? 'ملخّص الحجز' : 'Reservation Summary'}
            </Text>
            <View style={[styles.orderPriceBreakdown, isRTL && { alignItems: 'flex-end' }]}>
              <Text style={[styles.confirmSectionValue, { color: colors.textSecondary }]}>
                {cartItems.length} {language === 'ar' ? 'طبق' : cartItems.length === 1 ? 'dish' : 'dishes'}
              </Text>
              {totalSavings > 0 && (
                <View style={[styles.confirmSavingsRow, isRTL && styles.rowReverse]}>
                  <Text style={[styles.confirmOriginalPrice, { color: colors.textSecondary }]}>
                    {getOriginalTotal().toFixed(0)} ج.م
                  </Text>
                  <View style={[styles.confirmSavingsBadge, { backgroundColor: COLORS.burgundy }]}>
                    <Ionicons name="sparkles" size={12} color="#FFF" />
                    <Text style={styles.confirmSavingsText}>
                      -{totalSavings.toFixed(0)}
                    </Text>
                  </View>
                </View>
              )}
              <Text style={[styles.confirmFinalPrice, { color: COLORS.goldBright }]}>
                {getTotal().toFixed(0)} ج.م
              </Text>
              {/* Shipping line */}
              <View style={[styles.confirmShippingRow, isRTL && styles.rowReverse]}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                  <Ionicons name="bicycle-outline" size={13} color={isSubscriberDiscount ? COLORS.burgundy : colors.textSecondary} />
                  <Text style={[styles.confirmSectionValue, { color: isSubscriberDiscount ? COLORS.burgundy : colors.textSecondary, fontSize: 12 }]}>
                    {language === 'ar' ? 'التوصيل' : 'Delivery'}
                  </Text>
                  {isSubscriberDiscount && (
                    <View style={[styles.subscriberDiscountBadge]}>
                      <Text style={styles.subscriberDiscountBadgeText}>
                        {language === 'ar' ? 'خصم مشترك' : 'Subscriber'}
                      </Text>
                    </View>
                  )}
                </View>
                <Text style={[styles.confirmSectionValue, { color: isSubscriberDiscount ? COLORS.burgundy : colors.textSecondary, fontSize: 12, fontWeight: '600' }]}>
                  {shippingCost ?? 50} ج.م
                </Text>
              </View>
              <Text style={[styles.confirmFinalPrice, { color: COLORS.goldBright, marginTop: 6 }]}>
                {language === 'ar' ? 'الإجمالي: ' : 'Total: '}{(getTotal() + (shippingCost ?? 50)).toFixed(0)} ج.م
              </Text>
            </View>
          </View>
        </View>

        <View style={[styles.confirmDivider, { backgroundColor: colors.border }]} />

        <View style={[styles.confirmSection, isRTL && styles.rowReverse]}>
          <View style={[styles.confirmIconCircle, { backgroundColor: `${COLORS.goldBright}20` }]}>
            <Ionicons name="location" size={20} color={COLORS.goldBright} />
          </View>
          <View style={styles.confirmSectionContent}>
            <Text style={[styles.confirmSectionTitle, { color: colors.text }, isRTL && styles.textRight]}>
              {language === 'ar' ? 'عنوان التوصيل' : 'Delivery Address'}
            </Text>
            <Text style={[styles.confirmSectionValue, { color: colors.textSecondary }, isRTL && styles.textRight]}>
              {shippingAddress}
            </Text>
          </View>
        </View>

        <View style={[styles.confirmDivider, { backgroundColor: colors.border }]} />

        <View style={[styles.confirmSection, isRTL && styles.rowReverse]}>
          <View style={[styles.confirmIconCircle, { backgroundColor: `${COLORS.goldBright}20` }]}>
            <Ionicons name="call" size={20} color={COLORS.goldBright} />
          </View>
          <View style={styles.confirmSectionContent}>
            <Text style={[styles.confirmSectionTitle, { color: colors.text }, isRTL && styles.textRight]}>
              {language === 'ar' ? 'رقم الهاتف' : 'Phone'}
            </Text>
            <Text style={[styles.confirmSectionValue, { color: colors.textSecondary }, isRTL && styles.textRight]}>
              {phone}
            </Text>
          </View>
        </View>

        {notes ? (
          <>
            <View style={[styles.confirmDivider, { backgroundColor: colors.border }]} />
            <View style={[styles.confirmSection, isRTL && styles.rowReverse]}>
              <View style={[styles.confirmIconCircle, { backgroundColor: `${COLORS.goldBright}20` }]}>
                <Ionicons name="document-text" size={20} color={COLORS.goldBright} />
              </View>
              <View style={styles.confirmSectionContent}>
                <Text style={[styles.confirmSectionTitle, { color: colors.text }, isRTL && styles.textRight]}>
                  {language === 'ar' ? 'ملاحظات' : 'Notes'}
                </Text>
                <Text style={[styles.confirmSectionValue, { color: colors.textSecondary }, isRTL && styles.textRight]}>
                  {notes}
                </Text>
              </View>
            </View>
          </>
        ) : null}
      </View>

      {/* Payment Method */}
      <View style={[styles.paymentCard, { backgroundColor: `${COLORS.gold}15`, borderColor: COLORS.gold }]}>
        <View style={[styles.paymentRow, isRTL && styles.rowReverse]}>
          <Ionicons name="cash-outline" size={24} color={COLORS.goldBright} />
          <Text style={[styles.paymentText, { color: colors.text }]}>
            {language === 'ar' ? 'الدفع عند الاستلام' : 'Settle the Bill on Arrival'}
          </Text>
          <View style={[styles.paymentBadge, { backgroundColor: COLORS.gold }]}>
            <Text style={[styles.paymentBadgeText, { color: COLORS.charcoalDeep }]}>
              {language === 'ar' ? 'كاش' : 'COD'}
            </Text>
          </View>
        </View>
      </View>
    </Animated.View>
  );
};

export default function CheckoutScreen() {
  const { colors } = useTheme();
  const { t, isRTL, language } = useTranslation();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { cartItems, clearLocalCart, user, clearCart, setCartItems, addNotification } = useAppStore();

  const [currentStep, setCurrentStep] = useState(0);
  const [governorate, setGovernorate] = useState('');
  const [city, setCity] = useState('');
  const [shippingAddress, setShippingAddress] = useState('');
  const [phone, setPhone] = useState('');
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(false);
  const [showConfetti, setShowConfetti] = useState(false);
  const [orderPlaced, setOrderPlaced] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);
  const [serverCartItems, setServerCartItems] = useState<any[]>([]);
  const [serverShippingCost, setServerShippingCost] = useState(50);
  const [serverSubscriberDiscount, setServerSubscriberDiscount] = useState(false);
  const [latitude, setLatitude] = useState<number | null>(null);
  const [longitude, setLongitude] = useState<number | null>(null);
  const [gpsLoading, setGpsLoading] = useState(false);
  const [resolvedAddress, setResolvedAddress] = useState<string | null>(null);
  const [locationConfirmed, setLocationConfirmed] = useState(false);

  // Track whether each address field has been manually edited by the user.
  // When true the field is "owned" by the user and autofill will not overwrite it.
  // Autofill resets the flag to false so subsequent pin moves can still refresh the value.
  const shippingAddressDirtyRef = useRef(false);
  const cityDirtyRef = useRef(false);
  const governorateDirtyRef = useRef(false);

  // Wrapped setters that mark fields dirty when the user types in them.
  const setShippingAddressManual = useCallback((v: string) => { shippingAddressDirtyRef.current = true; setShippingAddress(v); }, []);
  const setCityManual = useCallback((v: string) => { cityDirtyRef.current = true; setCity(v); }, []);
  const setGovernorateManual = useCallback((v: string) => { governorateDirtyRef.current = true; setGovernorate(v); }, []);

  const pickGpsLocation = useCallback(async () => {
    setGpsLoading(true);
    try {
      const Location = await import('expo-location');
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('', language === 'ar' ? 'تم رفض إذن الموقع' : 'Location permission denied');
        return;
      }
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      setLatitude(pos.coords.latitude);
      setLongitude(pos.coords.longitude);
      setLocationConfirmed(true);
      // Reverse-geocode for human-readable address autofill (best-effort, non-blocking)
      try {
        const geo = await Location.reverseGeocodeAsync({
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
        });
        const first = geo?.[0];
        if (first) {
          const parts = [
            first.name,
            first.street,
            first.district || first.subregion,
            first.city,
            first.region,
          ].filter(Boolean);
          const formatted = parts.join(', ');
          if (formatted) {
            setResolvedAddress(formatted);
            // Only autofill fields the user has NOT manually edited (dirty flag takes priority over blank check).
            if (!shippingAddressDirtyRef.current) { setShippingAddress(formatted); }
            if (!governorateDirtyRef.current && first.region) { setGovernorate(String(first.region)); }
            if (!cityDirtyRef.current && first.city) { setCity(String(first.city)); }
          }
        }
      } catch {/* reverse geocode best-effort */}
    } catch {
      Alert.alert('', language === 'ar' ? 'تعذّر تحديد الموقع' : 'Could not get location');
    } finally {
      setGpsLoading(false);
    }
  }, [language]);

  // Callback for PinPickerModal confirmation — runs in CheckoutScreen scope so
  // it can access the dirty refs and autofill the address fields appropriately.
  const onPinConfirm = useCallback(async (result: { latitude: number; longitude: number }) => {
    setLatitude(result.latitude);
    setLongitude(result.longitude);
    setLocationConfirmed(true);
    setResolvedAddress(null);
    if (Platform.OS === 'android') {
      ToastAndroid.show('✓ Location pinned', ToastAndroid.SHORT);
    }
    try {
      const Location = await import('expo-location');
      const geo = await Location.reverseGeocodeAsync({
        latitude: result.latitude,
        longitude: result.longitude,
      });
      const first = geo?.[0];
      if (first) {
        const parts = [
          first.name,
          first.street,
          first.district || first.subregion,
          first.city,
          first.region,
        ].filter(Boolean);
        const formatted = parts.join(', ');
        if (formatted) {
          setResolvedAddress(formatted);
          // Only autofill fields the user has NOT manually edited (dirty flag takes priority over blank check).
          if (!shippingAddressDirtyRef.current) { setShippingAddress(formatted); }
          if (!governorateDirtyRef.current && first.region) { setGovernorate(String(first.region)); }
          if (!cityDirtyRef.current && first.city) { setCity(String(first.city)); }
        }
      }
    } catch {/* reverse geocode best-effort */}
  }, []);

  const autoFilledRef = useRef(false);

  const subscriptionStatus = useAppStore((state) => state.subscriptionStatus);

  const { data: subRequests } = useQuery<any[]>({
    queryKey: ['/api/subscription-requests'],
    queryFn: () => subscriptionRequestApi.getAll().then((r: any) => r.data),
    enabled: !!user,
  });

  // Saved addresses (home / work / club) — chip strip in AddressStep
  // lets the customer one-tap autofill the entire delivery form.
  const { data: savedAddresses } = useQuery<UserAddress[]>({
    queryKey: ['/api/user-addresses'],
    queryFn: () => userAddressApi.list().then((r) => r.data.addresses),
    enabled: !!user,
  });

  const applySavedAddress = useCallback((addr: UserAddress) => {
    // Programmatic fill — reset dirty flags so subsequent GPS/pin autofill can refresh these values
    if (addr.governorate) { setGovernorate(addr.governorate); governorateDirtyRef.current = false; }
    if (addr.city) { setCity(addr.city); cityDirtyRef.current = false; }
    if (addr.address) { setShippingAddress(addr.address); shippingAddressDirtyRef.current = false; }
    if (addr.phone) setPhone(addr.phone);
    // CRITICAL: explicitly reset GPS state so we never carry stale
    // coordinates from a prior selection. Only re-confirm location if
    // the chosen slot actually carries coords.
    if (addr.latitude != null && addr.longitude != null) {
      setLatitude(Number(addr.latitude));
      setLongitude(Number(addr.longitude));
      setLocationConfirmed(true);
      setResolvedAddress(addr.address || '');
    } else {
      setLatitude(null);
      setLongitude(null);
      setLocationConfirmed(false);
      setResolvedAddress('');
    }
  }, []);

  const saveCurrentAs = useCallback(async (label: UserAddressLabel) => {
    if (!shippingAddress.trim()) {
      Alert.alert('', language === 'ar' ? 'الرجاء ملء العنوان أولاً' : 'Please fill the address first');
      return;
    }
    try {
      await userAddressApi.upsert(label, {
        address: shippingAddress.trim(),
        governorate: governorate.trim() || null,
        city: city.trim() || null,
        latitude, longitude,
        phone: phone.trim() || null,
      });
      Alert.alert('', language === 'ar' ? 'تم الحفظ' : 'Saved');
    } catch (e: any) {
      Alert.alert('', e?.response?.data?.detail || (language === 'ar' ? 'فشل الحفظ' : 'Save failed'));
    }
  }, [shippingAddress, governorate, city, latitude, longitude, phone, language]);

  const approvedSub = useMemo(() =>
    subRequests?.find((r: any) => r.status === 'approved') || null,
    [subRequests]
  );

  const subGovernorate = approvedSub?.governorate || '';
  const subCity        = approvedSub?.village || '';
  const subAddress     = approvedSub?.detailed_address || '';
  const subPhone       = approvedSub?.phone || '';

  useEffect(() => {
    if (approvedSub && !autoFilledRef.current) {
      autoFilledRef.current = true;
      // Programmatic fill — reset dirty flags so subsequent GPS/pin autofill can still refresh
      if (subGovernorate) { setGovernorate(subGovernorate); governorateDirtyRef.current = false; }
      if (subCity)        { setCity(subCity); cityDirtyRef.current = false; }
      if (subAddress)     { setShippingAddress(subAddress); shippingAddressDirtyRef.current = false; }
      if (subPhone)       setPhone(subPhone);
    }
  }, [approvedSub, subGovernorate, subCity, subAddress, subPhone]);

  // Fetch server cart on mount
  useEffect(() => {
    const fetchServerCart = async () => {
      if (!user) {
        setInitialLoading(false);
        return;
      }
      
      try {
        const response = await cartApi.get();
        const items = response.data.items || [];
        setServerCartItems(items);
        setCartItems(items);
        if (typeof response.data.shipping_cost === 'number') {
          setServerShippingCost(response.data.shipping_cost);
        }
        setServerSubscriberDiscount(!!response.data.subscriber_discount_eligible);
      } catch (error) {
        console.error('Error fetching cart:', error);
      } finally {
        setInitialLoading(false);
      }
    };
    
    fetchServerCart();
  }, [user]);

  // Use server cart items for display (fallback to store if not loaded yet)
  const displayCartItems = serverCartItems.length > 0 ? serverCartItems : cartItems;

  const stepLabels = language === 'ar'
    ? ['المراجعة', 'التوصيل', 'الحجز']
    : ['Review', 'Address', 'Reserve'];

  // Calculate total using server-side cart pricing (final_unit_price)
  const getTotal = useCallback(() => {
    return displayCartItems.reduce((sum, item: any) => {
      const price = parseFloat(String(item.final_unit_price ?? item.discountedPrice ?? item.product?.price ?? 0)) || 0;
      return sum + price * item.quantity;
    }, 0);
  }, [displayCartItems]);

  // Calculate original total (before any discounts)
  const getOriginalTotal = useCallback(() => {
    return displayCartItems.reduce((sum, item: any) => {
      const price = parseFloat(String(item.original_unit_price ?? item.product?.price ?? 0)) || 0;
      return sum + price * item.quantity;
    }, 0);
  }, [displayCartItems]);

  // Calculate total savings from discounts
  const getTotalSavings = useCallback(() => {
    return displayCartItems.reduce((sum, item: any) => {
      const originalPrice = parseFloat(String(item.original_unit_price ?? item.product?.price ?? 0)) || 0;
      const finalPrice = parseFloat(String(item.final_unit_price ?? item.discountedPrice ?? item.product?.price ?? 0)) || 0;
      return sum + (originalPrice - finalPrice) * item.quantity;
    }, 0);
  }, [displayCartItems]);

  const fullShippingAddress = [governorate, city, shippingAddress].filter(Boolean).join(' - ');

  const validateStep = () => {
    if (currentStep === 1) {
      if (!governorate.trim()) {
        Alert.alert('', language === 'ar' ? 'الرجاء إدخال المحافظة' : 'Please enter the governorate');
        return false;
      }
      if (!shippingAddress.trim()) {
        Alert.alert('', language === 'ar' ? 'الرجاء إدخال العنوان' : 'Please enter the address');
        return false;
      }
      if (!phone.trim()) {
        Alert.alert('', language === 'ar' ? 'الرجاء إدخال رقم الهاتف' : 'Please enter phone number');
        return false;
      }
    }
    return true;
  };

  const handleNext = () => {
    if (!validateStep()) return;
    if (currentStep < 2) {
      setCurrentStep(currentStep + 1);
    }
  };

  const handleBack = () => {
    if (currentStep > 0) {
      setCurrentStep(currentStep - 1);
    } else {
      router.back();
    }
  };

  const handlePlaceOrder = async () => {
    setLoading(true);

    // G1: capture checkout funnel — start of order placement attempt.
    analytics.capture(AnalyticsEvents.CheckoutStarted, {
      item_count: cartItems.length,
      total: getTotal(),
    });

    try {
      // Persist GPS as first-class structured fields. We also keep a light
      // legacy `[GPS: …]` tag in notes so existing admin UIs that haven't
      // been updated can still see the coordinates inline.
      const cleanNotes = (notes || '').replace(/\s*\[GPS:[^\]]*\]\s*/g, '').trim();
      const gpsTag = latitude != null && longitude != null
        ? `\n[GPS: ${latitude.toFixed(6)}, ${longitude.toFixed(6)} — https://maps.google.com/?q=${latitude},${longitude}]`
        : '';
      const finalNotes = (cleanNotes + gpsTag).trim() || undefined;
      const response = await ordersApi.create({
        shipping_address: fullShippingAddress,
        phone: phone,
        notes: finalNotes,
        delivery_latitude:  latitude  ?? undefined,
        delivery_longitude: longitude ?? undefined,
        delivery_address:   resolvedAddress || fullShippingAddress || undefined,
      });

      // Only clear cart and show success if we got a successful response (200 OK)
      if (response.status === 200 || response.status === 201) {
        // Extract order data with a typed assertion so we avoid `any` casts
        // throughout the rest of this block.
        const orderData = response.data as { id?: string; order_number?: string } | undefined;
        const confirmedOrderNum = orderData?.order_number;

        // G1: capture successful order placement.
        analytics.capture(AnalyticsEvents.OrderPlaced, {
          order_id: orderData?.id,
          item_count: cartItems.length,
          total: getTotal(),
        });

        setShowConfetti(true);
        setOrderPlaced(true);

        // 1. Add an in-app notification entry so the confirmation appears in
        //    the notification center even when OS-level permissions are off.
        //    Immediately sync the OS badge so the icon badge reflects the new
        //    unread count without waiting for the WebSocket confirmation round-trip.
        if (confirmedOrderNum) {
          addNotification({
            id: `order-confirmation-${orderData?.id ?? Date.now()}`,
            title: 'Order Placed Successfully',
            title_ar: 'تم إتمام طلبك بنجاح',
            message: `Your order #${confirmedOrderNum} has been received. The restaurant will start preparing it soon.`,
            message_ar: `طلبك #${confirmedOrderNum} تم استلامه. سيبدأ المطعم في التحضير قريباً.`,
            type: 'success',
            read: false,
            created_at: new Date().toISOString(),
            metadata: { kind: 'order_confirmation', order_number: confirmedOrderNum },
          });
          // Sync OS badge immediately with the now-updated unread count.
          const freshUnread = useAppStore.getState().unreadCount;
          pushNotificationService.setBadgeCount(freshUnread).catch(() => {});
        }

        // 2. Also fire a local OS notification so the confirmation persists in
        //    the device notification tray even after the app is backgrounded.
        //    Best-effort: failures must never block the checkout success flow.
        if (confirmedOrderNum) {
          const notifLang = language === 'ar' ? 'ar' : 'en';
          pushNotificationService.scheduleLocalNotification({
            title: t_notif('orderPlacedTitle', notifLang),
            body: t_notif('orderPlacedBody', notifLang, { num: confirmedOrderNum }),
            data: { type: 'order_confirmation', order_number: confirmedOrderNum },
          }).catch(() => {});
        }

        // Clear cart ONLY after successful order creation
        setTimeout(() => {
          clearLocalCart();
          clearCart();
          // Also clear server cart
          cartApi.clear().catch(() => {});
          router.replace({ pathname: '/(tabs)/cart', params: { tab: 'orders' } });
        }, 2500);
      } else {
        throw new Error('Order creation failed');
      }
    } catch (error: any) {
      console.error('Error placing order:', error);
      // DO NOT clear cart on failure - preserve user's items
      const errorMessage = error?.response?.data?.detail || (language === 'ar' ? 'فشل إرسال الطلب. يرجى المحاولة مرة أخرى.' : 'Failed to place order. Please try again.');
      Alert.alert(
        language === 'ar' ? 'خطأ' : 'Error', 
        errorMessage
      );
    } finally {
      setLoading(false);
    }
  };

  if (!user) {
    router.replace('/login');
    return null;
  }

  // Show loading while fetching cart
  if (initialLoading) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background, justifyContent: 'center', alignItems: 'center' }]}>
        <ActivityIndicator size="large" color={COLORS.goldBright} />
        <Text style={[styles.loadingText, { color: colors.textSecondary }]}>
          {language === 'ar' ? 'جاري تحضير طاولتك...' : 'Preparing your table…'}
        </Text>
      </View>
    );
  }

  // Show empty cart message
  if (displayCartItems.length === 0) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <View
          style={[
            styles.header,
            { backgroundColor: colors.background, borderBottomColor: colors.border, paddingTop: insets.top + 10 },
          ]}
        >
          <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
            <Ionicons name={isRTL ? 'arrow-forward' : 'arrow-back'} size={24} color={colors.text} />
          </TouchableOpacity>
          <Text style={[styles.headerTitle, { color: colors.text }]}>
            {language === 'ar' ? 'حجز طاولتك' : 'Reserve Your Table'}
          </Text>
          <View style={styles.placeholder} />
        </View>
        <View style={styles.emptyCartContainer}>
          <Ionicons name="restaurant-outline" size={80} color={COLORS.gold} />
          <Text style={[styles.emptyCartTitle, { color: colors.text }]}>
            {language === 'ar' ? 'لا أطباق على الطاولة بعد' : 'Your table is still being set'}
          </Text>
          <Text style={[styles.emptyCartSubtitle, { color: colors.textSecondary }]}>
            {language === 'ar' ? 'تصفح القائمة لإضافة أطباقك المفضلة' : 'Browse the menu and add a few dishes to continue'}
          </Text>
          <TouchableOpacity
            style={styles.shopButtonWrap}
            onPress={() => router.push('/')}
          >
            <LinearGradient
              colors={[COLORS.gold, COLORS.goldSoft, COLORS.gold]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={styles.shopButton}
            >
              <Text style={[styles.shopButtonText, { color: COLORS.charcoalDeep }]}>
                {language === 'ar' ? 'تصفّح القائمة' : 'Browse the Menu'}
              </Text>
            </LinearGradient>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  if (orderPlaced) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        {showConfetti && <ConfettiEffect active={showConfetti} />}
        <View style={styles.successContainer}>
          <Animated.View entering={FadeIn.duration(500)} style={[styles.successIcon, { backgroundColor: `${COLORS.gold}20`, borderColor: COLORS.gold, borderWidth: 1 }]}>
            <Ionicons name="wine" size={56} color={COLORS.goldBright} />
          </Animated.View>
          <Text style={[styles.successKicker, { color: COLORS.goldBright }]}>
            {language === 'ar' ? 'حجزك مؤكَّد' : 'Your Table Awaits'}
          </Text>
          <Text style={[styles.successTitle, { color: colors.text }]}>
            {language === 'ar' ? 'تم تأكيد الحجز' : 'Reservation Confirmed'}
          </Text>
          <View style={[styles.goldRule, { alignSelf: 'center', marginTop: 4 }]} />
          <Text style={[styles.successSubtitle, { color: colors.textSecondary }]}>
            {language === 'ar' ? 'سننقلك إلى سجل حجوزاتك...' : 'Taking you to your reservations…'}
          </Text>
        </View>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        {/* Header */}
        <View
          style={[
            styles.header,
            { backgroundColor: colors.background, borderBottomColor: colors.border, paddingTop: insets.top + 10 },
          ]}
        >
          <TouchableOpacity onPress={handleBack} style={styles.backButton}>
            <Ionicons name={isRTL ? 'arrow-forward' : 'arrow-back'} size={24} color={colors.text} />
          </TouchableOpacity>
          <Text style={[styles.headerTitle, { color: colors.text }]}>
            {language === 'ar' ? 'حجز طاولتك' : 'Reserve Your Table'}
          </Text>
          <View style={styles.placeholder} />
        </View>

        {/* Step Indicator */}
        <View style={[styles.stepIndicatorWrapper, { backgroundColor: colors.surface }]}>
          <StepIndicator
            currentStep={currentStep}
            totalSteps={3}
            labels={stepLabels}
            isRTL={isRTL}
            colors={colors}
          />
        </View>

        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {currentStep === 0 && (
            <ReviewStep
              cartItems={displayCartItems}
              getTotal={getTotal}
              getOriginalTotal={getOriginalTotal}
              getTotalSavings={getTotalSavings}
              shippingCost={serverShippingCost}
              isSubscriberDiscount={serverSubscriberDiscount}
              language={language}
              isRTL={isRTL}
              colors={colors}
            />
          )}
          {currentStep === 1 && (
            <ShippingStep
              governorate={governorate}
              setGovernorate={setGovernorateManual}
              city={city}
              setCity={setCityManual}
              shippingAddress={shippingAddress}
              setShippingAddress={setShippingAddressManual}
              phone={phone}
              setPhone={setPhone}
              notes={notes}
              setNotes={setNotes}
              language={language}
              isRTL={isRTL}
              colors={colors}
              subGovernorate={subGovernorate}
              subCity={subCity}
              subAddress={subAddress}
              subPhone={subPhone}
              latitude={latitude}
              longitude={longitude}
              setLatitude={setLatitude}
              setLongitude={setLongitude}
              setLocationConfirmed={setLocationConfirmed}
              setResolvedAddress={setResolvedAddress}
              pickGpsLocation={pickGpsLocation}
              onPinConfirm={onPinConfirm}
              gpsLoading={gpsLoading}
              savedAddresses={savedAddresses}
              applySavedAddress={applySavedAddress}
              saveCurrentAs={saveCurrentAs}
            />
          )}
          {currentStep === 2 && (
            <ConfirmStep
              cartItems={displayCartItems}
              getTotal={getTotal}
              getOriginalTotal={getOriginalTotal}
              getTotalSavings={getTotalSavings}
              shippingCost={serverShippingCost}
              isSubscriberDiscount={serverSubscriberDiscount}
              shippingAddress={fullShippingAddress}
              phone={phone}
              notes={notes}
              language={language}
              isRTL={isRTL}
              colors={colors}
            />
          )}
        </ScrollView>

        {/* Footer */}
        <View
          style={[
            styles.footer,
            { backgroundColor: colors.surface, borderTopColor: colors.border, paddingBottom: insets.bottom + 16 },
          ]}
        >
          {currentStep < 2 ? (
            <TouchableOpacity
              style={styles.nextButtonWrap}
              onPress={handleNext}
              activeOpacity={0.85}
            >
              <LinearGradient
                colors={[COLORS.gold, COLORS.goldSoft, COLORS.gold]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={styles.nextButton}
              >
                <Text style={[styles.nextButtonText, { color: COLORS.charcoalDeep }]}>
                  {language === 'ar' ? 'التالي' : 'Continue'}
                </Text>
                <Ionicons name={isRTL ? 'arrow-back' : 'arrow-forward'} size={18} color={COLORS.charcoalDeep} />
              </LinearGradient>
            </TouchableOpacity>
          ) : (
            <View>
              {getTotalSavings() > 0 && (
                <View style={[styles.footerSavingsRow, isRTL && styles.rowReverse]}>
                  <Ionicons name="sparkles" size={14} color={COLORS.goldBright} />
                  <Text style={[styles.footerSavingsText, { color: COLORS.goldBright }]}>
                    {language === 'ar' ? `توفير ${getTotalSavings().toFixed(0)} ج.م` : `Saving ${getTotalSavings().toFixed(0)} EGP`}
                  </Text>
                </View>
              )}
              {!locationConfirmed && (
                <View style={[styles.footerSavingsRow, isRTL && styles.rowReverse, { marginBottom: 6 }]}>
                  <Ionicons name="location-outline" size={14} color={colors.textSecondary} />
                  <Text style={[styles.footerSavingsText, { color: colors.textSecondary }]}>
                    {language === 'ar'
                      ? 'فضلًا أكّد موقع التوصيل قبل تأكيد الحجز'
                      : 'Please confirm your delivery location to continue'}
                  </Text>
                </View>
              )}
              <TouchableOpacity
                style={[styles.placeOrderWrap, (loading || !locationConfirmed) && { opacity: 0.55 }]}
                onPress={handlePlaceOrder}
                disabled={loading || !locationConfirmed}
                activeOpacity={0.85}
              >
                <LinearGradient
                  colors={[COLORS.gold, COLORS.goldSoft, COLORS.gold]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 0 }}
                  style={styles.placeOrderButton}
                >
                  {loading ? (
                    <ActivityIndicator size="small" color={COLORS.charcoalDeep} />
                  ) : (
                    <>
                      <Ionicons name="wine" size={20} color={COLORS.charcoalDeep} />
                      <Text style={[styles.placeOrderText, { color: COLORS.charcoalDeep }]}>
                        {language === 'ar' ? 'تأكيد الحجز' : 'Confirm Reservation'}
                      </Text>
                      <Text style={[styles.placeOrderPrice, { color: COLORS.charcoalDeep }]}>· {(getTotal() + serverShippingCost).toFixed(0)} ج.م</Text>
                    </>
                  )}
                </LinearGradient>
              </TouchableOpacity>
            </View>
          )}
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
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
    fontSize: 20,
  },
  placeholder: {
    width: 40,
  },
  stepIndicatorWrapper: {
    paddingVertical: 20,
    paddingHorizontal: 16,
  },
  stepIndicatorContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepItem: {
    alignItems: 'center',
    width: 70,
  },
  stepCircle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 2,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 6,
  },
  stepCircleCurrent: {
    width: 36,
    height: 36,
    borderRadius: 18,
  },
  stepNumber: {
    fontSize: 14,
    fontWeight: '700',
  },
  stepLabel: {
    fontSize: 11,
    textAlign: 'center',
  },
  stepLine: {
    width: 40,
    height: 2,
    marginHorizontal: 4,
    marginBottom: 24,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 120,
  },
  stepContent: {
    flex: 1,
  },
  stepKicker: {
    ...TYPE.microLabel,
    marginBottom: 4,
  },
  stepTitle: {
    ...TYPE.title,
    fontSize: 24,
    marginBottom: 6,
  },
  goldRule: {
    height: 1,
    backgroundColor: COLORS.gold,
    opacity: 0.55,
    width: 56,
    marginBottom: 14,
  },
  stepSubtitle: {
    fontSize: 14,
    marginBottom: 20,
  },
  cartReviewCard: {
    borderRadius: 16,
    borderWidth: 1,
    overflow: 'hidden',
  },
  reviewItem: {
    flexDirection: 'row',
    padding: 12,
    alignItems: 'center',
  },
  reviewItemImage: {
    width: 60,
    height: 60,
    borderRadius: 10,
    overflow: 'hidden',
    marginRight: 12,
  },
  reviewImg: {
    width: '100%',
    height: '100%',
  },
  reviewImgPlaceholder: {
    width: '100%',
    height: '100%',
    justifyContent: 'center',
    alignItems: 'center',
  },
  reviewItemInfo: {
    flex: 1,
  },
  reviewItemName: {
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 4,
    lineHeight: 18,
  },
  reviewItemQty: {
    fontSize: 12,
  },
  reviewItemPrice: {
    alignItems: 'flex-end',
    marginLeft: 12,
  },
  reviewOriginalPrice: {
    fontSize: 11,
    textDecorationLine: 'line-through',
  },
  reviewFinalPrice: {
    fontSize: 15,
    fontWeight: '700',
  },
  reviewSummary: {
    borderTopWidth: 1,
    paddingTop: 12,
    marginTop: 8,
  },
  reviewSummaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 4,
  },
  reviewSummaryLabel: {
    fontSize: 13,
  },
  reviewOriginalTotal: {
    fontSize: 13,
    textDecorationLine: 'line-through',
  },
  savingsIconRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  reviewSavingsLabel: {
    fontSize: 13,
    fontWeight: '600',
  },
  reviewSavingsValue: {
    fontSize: 14,
    fontWeight: '700',
  },
  reviewItemMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 2,
  },
  reviewDiscountBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  reviewDiscountBadgeText: {
    color: '#FFF',
    fontSize: 10,
    fontWeight: '700',
  },
  reviewTotal: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    borderTopWidth: 1,
  },
  reviewTotalLabel: {
    fontSize: 14,
  },
  reviewTotalValue: {
    fontSize: 20,
    fontWeight: '800',
  },
  autoFillBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 9,
    borderWidth: 1,
    marginBottom: 16,
  },
  autoFillText: {
    fontSize: 12,
    fontWeight: '600',
  },
  modifiedStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginTop: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
    backgroundColor: '#F59E0B15',
    borderRadius: 7,
    borderLeftWidth: 2,
    borderLeftColor: '#F59E0B',
  },
  modifiedStripText: {
    fontSize: 11,
    color: '#F59E0B',
    flex: 1,
    fontWeight: '500',
  },
  formGroup: {
    marginBottom: 20,
  },
  inputLabel: {
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 8,
  },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  inputIcon: {
    marginRight: 12,
    marginTop: 2,
  },
  textInput: {
    flex: 1,
    fontSize: 15,
    paddingVertical: 0,
  },
  textAreaInput: {
    flex: 1,
    fontSize: 15,
    minHeight: 60,
    textAlignVertical: 'top',
    paddingVertical: 0,
  },
  confirmCard: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 4,
    marginBottom: 16,
  },
  confirmSection: {
    flexDirection: 'row',
    padding: 14,
    alignItems: 'flex-start',
  },
  confirmIconCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  confirmSectionContent: {
    flex: 1,
  },
  confirmSectionTitle: {
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 4,
  },
  confirmSectionValue: {
    fontSize: 13,
    lineHeight: 18,
  },
  confirmDivider: {
    height: 1,
    marginHorizontal: 14,
  },
  paymentCard: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 16,
  },
  paymentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  paymentText: {
    flex: 1,
    fontSize: 15,
    fontWeight: '600',
  },
  paymentBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
  },
  paymentBadgeText: {
    color: '#FFF',
    fontSize: 11,
    fontWeight: '700',
  },
  footer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    padding: 16,
    borderTopWidth: 1,
  },
  nextButtonWrap: {
    borderRadius: RADII.sm,
    overflow: 'hidden',
  },
  nextButton: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 16,
    borderRadius: RADII.sm,
  },
  nextButtonText: {
    ...TYPE.spacedButton,
    fontSize: 13,
  },
  placeOrderWrap: {
    borderRadius: RADII.sm,
    overflow: 'hidden',
  },
  placeOrderButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 16,
    paddingHorizontal: 16,
    borderRadius: RADII.sm,
    gap: 10,
  },
  placeOrderText: {
    ...TYPE.spacedButton,
    fontSize: 13,
  },
  placeOrderPrice: {
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 0.4,
  },
  successContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
  },
  successIcon: {
    width: 120,
    height: 120,
    borderRadius: 60,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 24,
  },
  successKicker: {
    ...TYPE.microLabel,
    marginBottom: 6,
    textAlign: 'center',
  },
  successTitle: {
    ...TYPE.title,
    fontSize: 26,
    marginBottom: 10,
    textAlign: 'center',
  },
  successSubtitle: {
    fontSize: 14,
    textAlign: 'center',
    marginTop: 6,
  },
  rowReverse: {
    flexDirection: 'row-reverse',
  },
  textRight: {
    textAlign: 'right',
  },
  orderPriceBreakdown: {
    marginTop: 4,
  },
  confirmSavingsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 4,
  },
  confirmOriginalPrice: {
    fontSize: 13,
    textDecorationLine: 'line-through',
  },
  confirmSavingsBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  confirmSavingsText: {
    color: '#FFF',
    fontSize: 11,
    fontWeight: '700',
  },
  confirmFinalPrice: {
    fontSize: 18,
    fontWeight: '800',
    marginTop: 4,
  },
  confirmShippingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 6,
    paddingTop: 6,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(255,255,255,0.1)',
  },
  subscriberDiscountBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: 'rgba(122,31,43,0.15)',
    borderWidth: 1,
    borderColor: 'rgba(122,31,43,0.4)',
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderRadius: 6,
  },
  subscriberDiscountBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#7A1F2B',
  },
  footerSavingsRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 6,
    marginBottom: 10,
  },
  footerSavingsText: {
    fontSize: 14,
    fontWeight: '700',
  },
  loadingText: {
    marginTop: 16,
    fontSize: 16,
  },
  emptyCartContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  emptyCartTitle: {
    ...TYPE.title,
    fontSize: 22,
    marginTop: 16,
    textAlign: 'center',
  },
  emptyCartSubtitle: {
    fontSize: 15,
    marginTop: 8,
    textAlign: 'center',
  },
  shopButtonWrap: {
    marginTop: 24,
    borderRadius: RADII.sm,
    overflow: 'hidden',
  },
  shopButton: {
    paddingHorizontal: 32,
    paddingVertical: 14,
    borderRadius: RADII.sm,
  },
  shopButtonText: {
    ...TYPE.spacedButton,
    fontSize: 13,
    textAlign: 'center',
  },
});
