/**
 * Subscription Request Screen - Professional customer subscription form
 * Public endpoint - no authentication required
 */
import React, { useState, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Modal,
  Dimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withSequence,
  withDelay,
  runOnJS,
} from 'react-native-reanimated';
import { useTheme } from '../src/hooks/useTheme';
import { useAppStore } from '../src/store/appStore';
import { subscriptionRequestApi } from '../src/services/api';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

// Egyptian Governorates
const GOVERNORATES = [
  { id: 'cairo', name: 'Cairo', name_ar: 'القاهرة' },
  { id: 'giza', name: 'Giza', name_ar: 'الجيزة' },
  { id: 'alexandria', name: 'Alexandria', name_ar: 'الإسكندرية' },
  { id: 'dakahlia', name: 'Dakahlia', name_ar: 'الدقهلية' },
  { id: 'sharqia', name: 'Sharqia', name_ar: 'الشرقية' },
  { id: 'qalyubia', name: 'Qalyubia', name_ar: 'القليوبية' },
  { id: 'gharbia', name: 'Gharbia', name_ar: 'الغربية' },
  { id: 'monufia', name: 'Monufia', name_ar: 'المنوفية' },
  { id: 'beheira', name: 'Beheira', name_ar: 'البحيرة' },
  { id: 'kafr_el_sheikh', name: 'Kafr El Sheikh', name_ar: 'كفر الشيخ' },
  { id: 'fayoum', name: 'Fayoum', name_ar: 'الفيوم' },
  { id: 'beni_suef', name: 'Beni Suef', name_ar: 'بني سويف' },
  { id: 'minya', name: 'Minya', name_ar: 'المنيا' },
  { id: 'asyut', name: 'Asyut', name_ar: 'أسيوط' },
  { id: 'sohag', name: 'Sohag', name_ar: 'سوهاج' },
  { id: 'qena', name: 'Qena', name_ar: 'قنا' },
  { id: 'aswan', name: 'Aswan', name_ar: 'أسوان' },
  { id: 'luxor', name: 'Luxor', name_ar: 'الأقصر' },
  { id: 'red_sea', name: 'Red Sea', name_ar: 'البحر الأحمر' },
  { id: 'new_valley', name: 'New Valley', name_ar: 'الوادي الجديد' },
  { id: 'matruh', name: 'Matruh', name_ar: 'مطروح' },
  { id: 'north_sinai', name: 'North Sinai', name_ar: 'شمال سيناء' },
  { id: 'south_sinai', name: 'South Sinai', name_ar: 'جنوب سيناء' },
  { id: 'suez', name: 'Suez', name_ar: 'السويس' },
  { id: 'ismailia', name: 'Ismailia', name_ar: 'الإسماعيلية' },
  { id: 'port_said', name: 'Port Said', name_ar: 'بورسعيد' },
  { id: 'damietta', name: 'Damietta', name_ar: 'دمياط' },
];

export default function SubscriptionRequestScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors, isDark } = useTheme();
  const language = useAppStore((state) => state.language);
  const user = useAppStore((state) => state.user);
  const isRTL = language === 'ar';
  const [showEmailInfo, setShowEmailInfo] = useState(false);

  // Form state
  const [formData, setFormData] = useState({
    customer_name: '',
    email: '',
    phone: '',
    governorate: '',
    village: '',
    address: '',
    car_model: '',
    description: '',
  });

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  // Pre-fill email from logged-in user
  useEffect(() => {
    if (user?.email) {
      setFormData((prev) => ({ ...prev, email: user.email, customer_name: prev.customer_name || user.name || '' }));
    }
  }, [user?.email]);
  const [showSuccess, setShowSuccess] = useState(false);
  const [showGovernorateDropdown, setShowGovernorateDropdown] = useState(false);
  const [governorateSearch, setGovernorateSearch] = useState('');

  // Animation values
  const successScale = useSharedValue(0);
  const checkmarkProgress = useSharedValue(0);

  const filteredGovernorates = GOVERNORATES.filter((gov) => {
    const searchTerm = governorateSearch.toLowerCase();
    return (
      gov.name.toLowerCase().includes(searchTerm) ||
      gov.name_ar.includes(governorateSearch)
    );
  });

  const validateForm = (): boolean => {
    const newErrors: Record<string, string> = {};

    if (!formData.customer_name.trim()) {
      newErrors.customer_name = isRTL ? 'الاسم مطلوب' : 'Name is required';
    }
    if (!formData.email.trim()) {
      newErrors.email = isRTL ? 'البريد الإلكتروني أو اسم المستخدم مطلوب' : 'Email or username is required';
    } else if (formData.email.includes(' ')) {
      newErrors.email = isRTL ? 'لا يجب أن يحتوي على مسافات' : 'Must not contain spaces';
    }
    if (!formData.phone.trim()) {
      newErrors.phone = isRTL ? 'رقم الهاتف مطلوب' : 'Phone is required';
    } else if (!/^[0-9]{10,11}$/.test(formData.phone.replace(/\s/g, ''))) {
      newErrors.phone = isRTL ? 'رقم هاتف غير صالح' : 'Invalid phone number';
    }
    if (!formData.governorate) {
      newErrors.governorate = isRTL ? 'المحافظة مطلوبة' : 'Governorate is required';
    }
    if (!formData.village.trim()) {
      newErrors.village = isRTL ? 'القرية/المنطقة مطلوبة' : 'Village/Area is required';
    }
    if (!formData.address.trim()) {
      newErrors.address = isRTL ? 'العنوان مطلوب' : 'Address is required';
    }
    if (!formData.car_model.trim()) {
      newErrors.car_model = isRTL ? 'مطعمك المفضل مطلوب' : 'Favorite restaurant is required';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async () => {
    if (!validateForm()) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      return;
    }

    setSubmitting(true);

    try {
      await subscriptionRequestApi.create(formData);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      
      // Update subscription status to pending
      useAppStore.getState().setSubscriptionStatus('pending');
      
      // Show success modal with animation
      setShowSuccess(true);
      successScale.value = withSpring(1, { damping: 12, stiffness: 100 });
      checkmarkProgress.value = withDelay(200, withSpring(1, { damping: 15 }));
    } catch (error: any) {
      console.error('Subscription request failed:', error);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      
      // Check for duplicate request error
      const errorMessage = error.response?.data?.detail || '';
      if (errorMessage.includes('already have a pending') || errorMessage.includes('already a subscriber')) {
        setErrors({
          submit: isRTL
            ? 'لديك طلب اشتراك معلق بالفعل أو أنت مشترك حالياً.'
            : 'You already have a pending request or are already a subscriber.',
        });
      } else {
        setErrors({
          submit: isRTL
            ? 'فشل إرسال الطلب. يرجى المحاولة مرة أخرى.'
            : 'Failed to submit request. Please try again.',
        });
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleSuccessClose = () => {
    setShowSuccess(false);
    successScale.value = 0;
    checkmarkProgress.value = 0;
    router.back();
  };

  const selectGovernorate = (gov: typeof GOVERNORATES[0]) => {
    setFormData((prev) => ({ ...prev, governorate: isRTL ? gov.name_ar : gov.name }));
    setShowGovernorateDropdown(false);
    setGovernorateSearch('');
    setErrors((prev) => ({ ...prev, governorate: '' }));
  };

  const successAnimStyle = useAnimatedStyle(() => ({
    transform: [{ scale: successScale.value }],
    opacity: successScale.value,
  }));

  const checkmarkAnimStyle = useAnimatedStyle(() => ({
    transform: [{ scale: checkmarkProgress.value }],
    opacity: checkmarkProgress.value,
  }));

  const renderInput = (
    field: keyof typeof formData,
    label: string,
    labelAr: string,
    options?: {
      keyboardType?: 'default' | 'numeric' | 'phone-pad';
      multiline?: boolean;
      placeholder?: string;
      placeholderAr?: string;
    }
  ) => {
    const hasError = !!errors[field];
    return (
      <View style={styles.inputContainer}>
        <Text style={[styles.label, { color: colors.text }, isRTL && styles.labelRTL]}>
          {isRTL ? labelAr : label} <Text style={{ color: colors.error }}>*</Text>
        </Text>
        <TextInput
          style={[
            styles.input,
            {
              backgroundColor: isDark ? colors.surface : '#F9FAFB',
              color: colors.text,
              borderColor: hasError ? colors.error : colors.border,
              textAlign: isRTL ? 'right' : 'left',
            },
            options?.multiline && styles.multilineInput,
          ]}
          value={formData[field]}
          onChangeText={(text) => {
            setFormData((prev) => ({ ...prev, [field]: text }));
            if (errors[field]) setErrors((prev) => ({ ...prev, [field]: '' }));
          }}
          placeholder={isRTL ? options?.placeholderAr : options?.placeholder}
          placeholderTextColor={colors.textSecondary}
          keyboardType={options?.keyboardType || 'default'}
          multiline={options?.multiline}
          numberOfLines={options?.multiline ? 4 : 1}
          textAlignVertical={options?.multiline ? 'top' : 'center'}
        />
        {hasError && (
          <Text style={[styles.errorText, { color: colors.error }]}>{errors[field]}</Text>
        )}
      </View>
    );
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={[styles.scrollContent, { paddingTop: insets.top }]}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {/* Header */}
          <View style={[styles.header, isRTL && styles.headerRTL]}>
            <TouchableOpacity
              style={[styles.backButton, { backgroundColor: colors.surface }]}
              onPress={() => router.back()}
            >
              <Ionicons name={isRTL ? 'arrow-forward' : 'arrow-back'} size={24} color={colors.text} />
            </TouchableOpacity>
            <View style={styles.headerTitleContainer}>
              <Text style={[styles.headerTitle, { color: colors.text }]}>
                {isRTL ? 'طلب اشتراك' : 'Subscription Request'}
              </Text>
              <Text style={[styles.headerSubtitle, { color: colors.textSecondary }]}>
                {isRTL ? 'سجل بياناتك وسنتواصل معك' : 'Submit your details and we will contact you'}
              </Text>
            </View>
          </View>

          {/* Premium Badge */}
          <View style={[styles.premiumBadge, { backgroundColor: colors.primary + '15' }]}>
            <Ionicons name="star" size={20} color={colors.primary} />
            <Text style={[styles.premiumText, { color: colors.primary }]}>
              {isRTL ? 'خدمة مميزة' : 'Premium Service'}
            </Text>
          </View>

          {/* Form Card */}
          <View style={[styles.formCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            {renderInput('customer_name', 'Full Name', 'اسم العميل', {
              placeholder: 'Enter your full name',
              placeholderAr: 'أدخل اسمك الكامل',
            })}

            {/* Email Field — locked if user is logged in */}
            <View style={styles.inputContainer}>
              <View style={[styles.labelRow, isRTL && styles.labelRowRTL]}>
                <Text style={[styles.label, { color: colors.text }, isRTL && styles.labelRTL]}>
                  {isRTL ? 'البريد الإلكتروني' : 'Email Address'} <Text style={{ color: colors.error }}>*</Text>
                </Text>
                <TouchableOpacity onPress={() => setShowEmailInfo(!showEmailInfo)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                  <Ionicons name="information-circle-outline" size={18} color={colors.primary} />
                </TouchableOpacity>
              </View>
              {showEmailInfo && (
                <View style={[styles.emailInfoBox, { backgroundColor: colors.primary + '15', borderColor: colors.primary + '40' }]}>
                  <Text style={[styles.emailInfoText, { color: colors.primary }]}>
                    {isRTL
                      ? 'البريد الإلكتروني مرتبط بحسابك ولا يمكن تغييره في هذا النموذج. إذا أردت تغيير البريد، قم بإنشاء حساب جديد.'
                      : 'This email is linked to your account and cannot be changed here. To use a different email, create a new account.'}
                  </Text>
                </View>
              )}
              <View style={[
                styles.lockedEmailContainer,
                {
                  backgroundColor: isDark ? colors.surface : '#F3F4F6',
                  borderColor: colors.border,
                }
              ]}>
                <Ionicons name="mail" size={18} color={colors.primary} style={{ marginRight: 8 }} />
                <Text style={[styles.lockedEmailText, { color: colors.text, flex: 1 }]} numberOfLines={1}>
                  {formData.email || (isRTL ? 'غير متاح' : 'Not available')}
                </Text>
                <View style={[styles.lockedBadge, { backgroundColor: colors.primary + '20' }]}>
                  <Ionicons name="lock-closed" size={12} color={colors.primary} />
                  <Text style={[styles.lockedBadgeText, { color: colors.primary }]}>
                    {isRTL ? 'مثبت' : 'Fixed'}
                  </Text>
                </View>
              </View>
            </View>

            {renderInput('phone', 'Phone Number', 'رقم الهاتف', {
              keyboardType: 'phone-pad',
              placeholder: '01xxxxxxxxx',
              placeholderAr: '01xxxxxxxxx',
            })}

            {/* Governorate Dropdown */}
            <View style={styles.inputContainer}>
              <Text style={[styles.label, { color: colors.text }, isRTL && styles.labelRTL]}>
                {isRTL ? 'المحافظة' : 'Governorate'} <Text style={{ color: colors.error }}>*</Text>
              </Text>
              <TouchableOpacity
                style={[
                  styles.dropdownButton,
                  {
                    backgroundColor: isDark ? colors.surface : '#F9FAFB',
                    borderColor: errors.governorate ? colors.error : colors.border,
                  },
                ]}
                onPress={() => setShowGovernorateDropdown(true)}
              >
                <Text
                  style={[
                    styles.dropdownButtonText,
                    {
                      color: formData.governorate ? colors.text : colors.textSecondary,
                      textAlign: isRTL ? 'right' : 'left',
                    },
                  ]}
                >
                  {formData.governorate || (isRTL ? 'اختر المحافظة' : 'Select Governorate')}
                </Text>
                <Ionicons name="chevron-down" size={20} color={colors.textSecondary} />
              </TouchableOpacity>
              {errors.governorate && (
                <Text style={[styles.errorText, { color: colors.error }]}>{errors.governorate}</Text>
              )}
            </View>

            {renderInput('village', 'Village/Area', 'القرية/المنطقة', {
              placeholder: 'Enter your village or area',
              placeholderAr: 'أدخل القرية أو المنطقة',
            })}

            {renderInput('address', 'Detailed Address', 'العنوان بالتفصيل', {
              placeholder: 'Enter your detailed address',
              placeholderAr: 'أدخل عنوانك بالتفصيل',
            })}

            {renderInput('car_model', 'Favorite Restaurant', 'مطعمك المفضل', {
              placeholder: 'e.g., Al-Ghazaly Grill',
              placeholderAr: 'مثال: مطعم الغزالي',
            })}

            {renderInput('description', 'Notes (Optional)', 'ملاحظات إضافية (اختياري)', {
              multiline: true,
              placeholder: 'Any additional notes or requirements',
              placeholderAr: 'أي ملاحظات أو متطلبات إضافية',
            })}

            {/* Submit Error */}
            {errors.submit && (
              <View style={[styles.submitErrorContainer, { backgroundColor: colors.error + '15' }]}>
                <Ionicons name="alert-circle" size={20} color={colors.error} />
                <Text style={[styles.submitErrorText, { color: colors.error }]}>{errors.submit}</Text>
              </View>
            )}

            {/* Submit Button */}
            <TouchableOpacity
              style={[styles.submitButton, { backgroundColor: colors.primary }]}
              onPress={handleSubmit}
              disabled={submitting}
              activeOpacity={0.8}
            >
              {submitting ? (
                <ActivityIndicator size="small" color="#FFF" />
              ) : (
                <>
                  <Ionicons name="paper-plane" size={20} color="#FFF" />
                  <Text style={styles.submitButtonText}>
                    {isRTL ? 'إرسال الطلب' : 'Submit Request'}
                  </Text>
                </>
              )}
            </TouchableOpacity>
          </View>

          <View style={{ height: insets.bottom + 40 }} />
        </ScrollView>
      </KeyboardAvoidingView>

      {/* Governorate Dropdown Modal */}
      <Modal
        visible={showGovernorateDropdown}
        transparent
        animationType="slide"
        onRequestClose={() => setShowGovernorateDropdown(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.dropdownModal, { backgroundColor: colors.card }]}>
            <View style={[styles.dropdownHeader, { borderBottomColor: colors.border }]}>
              <Text style={[styles.dropdownTitle, { color: colors.text }]}>
                {isRTL ? 'اختر المحافظة' : 'Select Governorate'}
              </Text>
              <TouchableOpacity onPress={() => setShowGovernorateDropdown(false)}>
                <Ionicons name="close" size={24} color={colors.text} />
              </TouchableOpacity>
            </View>
            <TextInput
              style={[
                styles.searchInput,
                {
                  backgroundColor: isDark ? colors.surface : '#F9FAFB',
                  color: colors.text,
                  borderColor: colors.border,
                  textAlign: isRTL ? 'right' : 'left',
                },
              ]}
              placeholder={isRTL ? 'ابحث...' : 'Search...'}
              placeholderTextColor={colors.textSecondary}
              value={governorateSearch}
              onChangeText={setGovernorateSearch}
            />
            <ScrollView style={styles.dropdownList} showsVerticalScrollIndicator={false}>
              {filteredGovernorates.map((gov) => (
                <TouchableOpacity
                  key={gov.id}
                  style={[styles.dropdownItem, { borderBottomColor: colors.border }]}
                  onPress={() => selectGovernorate(gov)}
                >
                  <Text style={[styles.dropdownItemText, { color: colors.text }]}>
                    {isRTL ? gov.name_ar : gov.name}
                  </Text>
                  {formData.governorate === (isRTL ? gov.name_ar : gov.name) && (
                    <Ionicons name="checkmark-circle" size={20} color={colors.primary} />
                  )}
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Success Modal */}
      <Modal visible={showSuccess} transparent animationType="fade">
        <View style={styles.successOverlay}>
          <Animated.View style={[styles.successModal, { backgroundColor: colors.card }, successAnimStyle]}>
            <Animated.View style={[styles.successIconContainer, { backgroundColor: colors.primary }, checkmarkAnimStyle]}>
              <Ionicons name="checkmark" size={50} color="#FFF" />
            </Animated.View>
            <Text style={[styles.successTitle, { color: colors.text }]}>
              {isRTL ? 'تم إرسال الطلب بنجاح!' : 'Request Submitted!'}
            </Text>
            <Text style={[styles.successMessage, { color: colors.textSecondary }]}>
              {isRTL
                ? 'شكراً لك! سيتواصل معك فريقنا قريباً'
                : 'Thank you! Our team will contact you soon'}
            </Text>
            <TouchableOpacity
              style={[styles.successButton, { backgroundColor: colors.primary }]}
              onPress={handleSuccessClose}
            >
              <Text style={styles.successButtonText}>
                {isRTL ? 'حسناً' : 'OK'}
              </Text>
            </TouchableOpacity>
          </Animated.View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 16,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 16,
    gap: 12,
  },
  headerRTL: {
    flexDirection: 'row-reverse',
  },
  backButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitleContainer: {
    flex: 1,
  },
  headerTitle: {
    fontSize: 22,
    fontWeight: '700',
  },
  headerSubtitle: {
    fontSize: 13,
    marginTop: 2,
  },
  premiumBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'center',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    gap: 6,
    marginBottom: 16,
  },
  premiumText: {
    fontSize: 14,
    fontWeight: '600',
  },
  formCard: {
    borderRadius: 20,
    padding: 20,
    borderWidth: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 12,
    elevation: 5,
  },
  inputContainer: {
    marginBottom: 16,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 8,
  },
  labelRTL: {
    textAlign: 'right',
  },
  labelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  labelRowRTL: {
    flexDirection: 'row-reverse',
  },
  emailInfoBox: {
    borderWidth: 1,
    borderRadius: 10,
    padding: 10,
    marginBottom: 8,
  },
  emailInfoText: {
    fontSize: 12,
    lineHeight: 18,
  },
  lockedEmailContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 14,
  },
  lockedEmailText: {
    fontSize: 15,
    fontWeight: '500',
  },
  lockedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  lockedBadgeText: {
    fontSize: 11,
    fontWeight: '700',
  },
  input: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 15,
  },
  multilineInput: {
    minHeight: 100,
    paddingTop: 14,
  },
  errorText: {
    fontSize: 12,
    marginTop: 4,
  },
  dropdownButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  dropdownButtonText: {
    fontSize: 15,
    flex: 1,
  },
  submitErrorContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: 12,
    gap: 8,
    marginBottom: 16,
  },
  submitErrorText: {
    fontSize: 13,
    flex: 1,
  },
  submitButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 16,
    borderRadius: 14,
    gap: 8,
    marginTop: 8,
  },
  submitButtonText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#FFF',
  },
  // Modal styles
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  dropdownModal: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: '70%',
  },
  dropdownHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    borderBottomWidth: 1,
  },
  dropdownTitle: {
    fontSize: 18,
    fontWeight: '700',
  },
  searchInput: {
    margin: 16,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontSize: 15,
  },
  dropdownList: {
    maxHeight: 300,
  },
  dropdownItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderBottomWidth: 0.5,
  },
  dropdownItemText: {
    fontSize: 15,
  },
  // Success Modal
  successOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  successModal: {
    width: '100%',
    maxWidth: 340,
    borderRadius: 24,
    padding: 32,
    alignItems: 'center',
  },
  successIconContainer: {
    width: 100,
    height: 100,
    borderRadius: 50,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 24,
  },
  successTitle: {
    fontSize: 22,
    fontWeight: '700',
    marginBottom: 8,
    textAlign: 'center',
  },
  successMessage: {
    fontSize: 15,
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 24,
  },
  successButton: {
    paddingHorizontal: 48,
    paddingVertical: 14,
    borderRadius: 12,
  },
  successButtonText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#FFF',
  },
});
