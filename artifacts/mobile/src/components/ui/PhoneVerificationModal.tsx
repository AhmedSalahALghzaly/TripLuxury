import React, { useState, useRef, useEffect } from 'react';
import {
  View, Text, TouchableOpacity, TextInput, StyleSheet,
  Modal, ActivityIndicator, Platform, Linking, ScrollView,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { BlurView } from 'expo-blur';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../hooks/useTheme';
import { useTranslation } from '../../hooks/useTranslation';
import { apiRequest, getApiUrl } from '@/lib/query-client';

interface PhoneVerificationModalProps {
  visible: boolean;
  onClose: () => void;
  onVerified: (phone: string) => void;
}

const COUNTRY_CODES = [
  { code: '+20', name: 'مصر', flag: '🇪🇬' },
  { code: '+966', name: 'السعودية', flag: '🇸🇦' },
  { code: '+971', name: 'الإمارات', flag: '🇦🇪' },
  { code: '+965', name: 'الكويت', flag: '🇰🇼' },
  { code: '+974', name: 'قطر', flag: '🇶🇦' },
  { code: '+973', name: 'البحرين', flag: '🇧🇭' },
  { code: '+968', name: 'عُمان', flag: '🇴🇲' },
  { code: '+962', name: 'الأردن', flag: '🇯🇴' },
  { code: '+961', name: 'لبنان', flag: '🇱🇧' },
  { code: '+963', name: 'سوريا', flag: '🇸🇾' },
  { code: '+964', name: 'العراق', flag: '🇮🇶' },
  { code: '+212', name: 'المغرب', flag: '🇲🇦' },
  { code: '+213', name: 'الجزائر', flag: '🇩🇿' },
  { code: '+216', name: 'تونس', flag: '🇹🇳' },
  { code: '+218', name: 'ليبيا', flag: '🇱🇾' },
  { code: '+249', name: 'السودان', flag: '🇸🇩' },
  { code: '+1', name: 'أمريكا', flag: '🇺🇸' },
  { code: '+44', name: 'بريطانيا', flag: '🇬🇧' },
  { code: '+49', name: 'ألمانيا', flag: '🇩🇪' },
  { code: '+33', name: 'فرنسا', flag: '🇫🇷' },
  { code: '+90', name: 'تركيا', flag: '🇹🇷' },
];

const OWNER_WA = '+0201011033571';
const WA_MESSAGE = 'قم بالتحقق من رقم الموبيل';

export function PhoneVerificationModal({ visible, onClose, onVerified }: PhoneVerificationModalProps) {
  const { isDark } = useTheme();
  const { language } = useTranslation();
  const ar = language === 'ar';

  const [selectedCountry, setSelectedCountry] = useState(COUNTRY_CODES[0]);
  const [phoneNumber, setPhoneNumber] = useState('');
  const [showCountryPicker, setShowCountryPicker] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [sent, setSent] = useState(false);

  const mountedRef = useRef(true);

  useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false; }; }, []);
  useEffect(() => { if (!visible) { reset(); } }, [visible]);

  const reset = () => {
    setPhoneNumber(''); setError(''); setSent(false); setLoading(false);
    setShowCountryPicker(false); setSelectedCountry(COUNTRY_CODES[0]);
  };

  const fullPhone = `${selectedCountry.code}${phoneNumber.replace(/^0+/, '')}`;

  const handleSend = async () => {
    if (!phoneNumber || phoneNumber.length < 7) {
      setError(ar ? 'يرجى إدخال رقم هاتف صحيح' : 'Please enter a valid phone number');
      return;
    }
    setLoading(true); setError('');
    try {
      const url = new URL('/api/phone-verification/submit-whatsapp', getApiUrl());
      await apiRequest('POST', url.toString(), { phone: fullPhone });

      const waUrl = `https://wa.me/${OWNER_WA.replace(/[^0-9]/g, '')}?text=${encodeURIComponent(WA_MESSAGE)}`;
      if (Platform.OS === 'web') {
        window.open(waUrl, '_blank');
      } else {
        await Linking.openURL(waUrl);
      }
      if (mountedRef.current) setSent(true);
    } catch (err: any) {
      const raw = err.message || '';
      try {
        const jsonStr = raw.includes('{') ? raw.slice(raw.indexOf('{')) : null;
        const parsed = jsonStr ? JSON.parse(jsonStr) : null;
        if (mountedRef.current) setError(parsed?.detail || (ar ? 'حدث خطأ' : 'An error occurred'));
      } catch { if (mountedRef.current) setError(ar ? 'حدث خطأ' : 'An error occurred'); }
    } finally { if (mountedRef.current) setLoading(false); }
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <BlurView intensity={25} tint={isDark ? 'dark' : 'light'} style={StyleSheet.absoluteFill} />
        <TouchableOpacity style={StyleSheet.absoluteFillObject} onPress={onClose} activeOpacity={1} />

        <View style={[styles.card, { backgroundColor: isDark ? '#0B1120' : '#FFFFFF' }]}>

          {/* Close */}
          <TouchableOpacity style={styles.closeBtn} onPress={onClose}>
            <Ionicons name="close" size={22} color={isDark ? '#64748B' : '#94A3B8'} />
          </TouchableOpacity>

          {sent ? (
            /* ── SENT STATE ── */
            <View style={styles.sentContainer}>
              <LinearGradient colors={['#25D366', '#128C7E']} style={styles.sentIcon}>
                <Ionicons name="checkmark-circle" size={44} color="#FFF" />
              </LinearGradient>
              <Text style={[styles.sentTitle, { color: isDark ? '#F1F5F9' : '#0F172A' }]}>
                {ar ? 'تم إرسال الطلب' : 'Request Sent!'}
              </Text>
              <Text style={[styles.sentMsg, { color: isDark ? '#94A3B8' : '#64748B' }]}>
                {ar
                  ? `تم إرسال رقمك ${fullPhone} للمراجعة\nسيتم التأكيد من المالك خلال دقائق`
                  : `Your number ${fullPhone} was sent for review\nOwner will confirm shortly`}
              </Text>
              <TouchableOpacity
                style={styles.sentBtn}
                onPress={() => { reset(); onClose(); }}
                activeOpacity={0.85}
              >
                <LinearGradient colors={['#25D366', '#128C7E']} style={styles.sentBtnGrad}>
                  <Text style={styles.sentBtnText}>{ar ? 'حسناً' : 'OK'}</Text>
                </LinearGradient>
              </TouchableOpacity>
            </View>
          ) : (
            /* ── INPUT STATE ── */
            <>
              {/* Large circular WhatsApp icon */}
              <View style={styles.waCircleOuter}>
                <LinearGradient colors={['#25D366', '#128C7E']} style={styles.waCircleInner}>
                  <Ionicons name="logo-whatsapp" size={42} color="#FFF" />
                </LinearGradient>
              </View>

              <Text style={[styles.title, { color: isDark ? '#F1F5F9' : '#0F172A' }]}>
                {ar ? 'تأكيد رقم الهاتف' : 'Verify Phone Number'}
              </Text>
              <Text style={[styles.subtitle, { color: isDark ? '#94A3B8' : '#64748B' }]}>
                {ar
                  ? 'أدخل رقمك لنرسله للمراجعة عبر واتس آب'
                  : 'Enter your number to send for review via WhatsApp'}
              </Text>

              {/* Phone input row */}
              <View style={[styles.phoneRow, {
                backgroundColor: isDark ? 'rgba(255,255,255,0.05)' : '#F8FAFC',
                borderColor: isDark ? 'rgba(255,255,255,0.1)' : '#E2E8F0',
              }]}>
                {/* Country code picker */}
                <TouchableOpacity
                  style={[styles.countryBtn, {
                    borderRightWidth: 1,
                    borderRightColor: isDark ? 'rgba(255,255,255,0.1)' : '#E2E8F0',
                  }]}
                  onPress={() => setShowCountryPicker(!showCountryPicker)}
                  activeOpacity={0.7}
                >
                  <Text style={styles.flag}>{selectedCountry.flag}</Text>
                  <Text style={[styles.countryCode, { color: isDark ? '#F1F5F9' : '#1E293B' }]}>
                    {selectedCountry.code}
                  </Text>
                  <Ionicons name={showCountryPicker ? 'chevron-up' : 'chevron-down'} size={14} color={isDark ? '#64748B' : '#94A3B8'} />
                </TouchableOpacity>

                <TextInput
                  style={[styles.phoneInput, { color: isDark ? '#F1F5F9' : '#1E293B' }]}
                  placeholder={ar ? 'رقم الهاتف' : 'Phone number'}
                  placeholderTextColor={isDark ? '#475569' : '#CBD5E1'}
                  value={phoneNumber}
                  onChangeText={setPhoneNumber}
                  keyboardType="phone-pad"
                  textAlign={ar ? 'right' : 'left'}
                />
              </View>

              {/* Country picker dropdown */}
              {showCountryPicker && (
                <View style={[styles.pickerDropdown, {
                  backgroundColor: isDark ? '#1E293B' : '#FFF',
                  borderColor: isDark ? 'rgba(255,255,255,0.1)' : '#E2E8F0',
                }]}>
                  <ScrollView style={{ maxHeight: 200 }} showsVerticalScrollIndicator={false}>
                    {COUNTRY_CODES.map((country, i) => (
                      <TouchableOpacity
                        key={i}
                        style={[styles.pickerItem, {
                          backgroundColor: selectedCountry.code === country.code
                            ? 'rgba(37,211,102,0.1)' : 'transparent',
                        }]}
                        onPress={() => { setSelectedCountry(country); setShowCountryPicker(false); }}
                        activeOpacity={0.7}
                      >
                        <Text style={styles.pickerFlag}>{country.flag}</Text>
                        <Text style={[styles.pickerName, { color: isDark ? '#F1F5F9' : '#1E293B' }]}>
                          {country.name}
                        </Text>
                        <Text style={[styles.pickerCode, { color: isDark ? '#94A3B8' : '#64748B' }]}>
                          {country.code}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                </View>
              )}

              {/* Full number preview */}
              {phoneNumber.length > 0 && (
                <View style={[styles.previewRow, {
                  backgroundColor: isDark ? 'rgba(37,211,102,0.08)' : 'rgba(37,211,102,0.05)',
                  borderColor: 'rgba(37,211,102,0.2)',
                }]}>
                  <Ionicons name="call-outline" size={14} color="#25D366" />
                  <Text style={styles.previewText}>{fullPhone}</Text>
                </View>
              )}

              {error ? (
                <View style={styles.errorBox}>
                  <Ionicons name="alert-circle" size={14} color="#EF4444" />
                  <Text style={styles.errorText}>{error}</Text>
                </View>
              ) : null}

              {/* Send button */}
              <TouchableOpacity
                style={[styles.sendBtn, loading && { opacity: 0.7 }]}
                onPress={handleSend}
                disabled={loading}
                activeOpacity={0.85}
              >
                <LinearGradient
                  colors={['#25D366', '#128C7E']}
                  style={styles.sendBtnGrad}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 0 }}
                >
                  {loading ? <ActivityIndicator color="#FFF" size="small" /> : (
                    <>
                      <Ionicons name="logo-whatsapp" size={20} color="#FFF" />
                      <Text style={styles.sendBtnText}>
                        {ar ? 'إرسال رمز التحقق' : 'Send Verification'}
                      </Text>
                    </>
                  )}
                </LinearGradient>
              </TouchableOpacity>

              {/* Info note */}
              <View style={[styles.infoRow, {
                backgroundColor: isDark ? 'rgba(37,211,102,0.05)' : 'rgba(37,211,102,0.04)',
              }]}>
                <Ionicons name="information-circle-outline" size={14} color="#25D366" />
                <Text style={[styles.infoText, { color: isDark ? '#64748B' : '#94A3B8' }]}>
                  {ar
                    ? 'سيفتح واتس آب تلقائياً. أرسل الرسالة لإتمام التحقق'
                    : 'WhatsApp will open automatically. Send the message to complete verification'}
                </Text>
              </View>

              <TouchableOpacity style={styles.skipBtn} onPress={onClose} activeOpacity={0.7}>
                <Text style={[styles.skipText, { color: isDark ? '#475569' : '#CBD5E1' }]}>
                  {ar ? 'تخطي الآن' : 'Skip for now'}
                </Text>
              </TouchableOpacity>
            </>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 20 },
  card: { width: '100%', maxWidth: 400, borderRadius: 32, padding: 28, shadowColor: '#000', shadowOffset: { width: 0, height: 24 }, shadowOpacity: 0.3, shadowRadius: 32, elevation: 24, position: 'relative' },
  closeBtn: { position: 'absolute', top: 16, right: 16, zIndex: 10, padding: 8, borderRadius: 20, backgroundColor: 'rgba(100,116,139,0.1)' },

  waCircleOuter: { alignItems: 'center', marginBottom: 20, marginTop: 8 },
  waCircleInner: { width: 96, height: 96, borderRadius: 48, alignItems: 'center', justifyContent: 'center', shadowColor: '#25D366', shadowOffset: { width: 0, height: 12 }, shadowOpacity: 0.4, shadowRadius: 20, elevation: 12 },

  title: { fontSize: 22, fontWeight: '800', textAlign: 'center', marginBottom: 8, letterSpacing: -0.3 },
  subtitle: { fontSize: 13, textAlign: 'center', lineHeight: 20, marginBottom: 24, paddingHorizontal: 8 },

  phoneRow: { flexDirection: 'row', alignItems: 'center', borderWidth: 1.5, borderRadius: 16, height: 56, overflow: 'hidden', marginBottom: 12 },
  countryBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, height: '100%' },
  flag: { fontSize: 22 },
  countryCode: { fontSize: 14, fontWeight: '700' },
  phoneInput: { flex: 1, fontSize: 16, paddingHorizontal: 12, height: '100%', paddingVertical: 0 },

  pickerDropdown: { borderRadius: 16, borderWidth: 1.5, overflow: 'hidden', marginBottom: 8, zIndex: 100 },
  pickerItem: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingVertical: 12 },
  pickerFlag: { fontSize: 20 },
  pickerName: { flex: 1, fontSize: 14 },
  pickerCode: { fontSize: 13, fontWeight: '600' },

  previewRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 12, borderWidth: 1, marginBottom: 12 },
  previewText: { fontSize: 14, color: '#25D366', fontWeight: '600', letterSpacing: 0.5 },

  errorBox: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: 'rgba(239,68,68,0.08)', borderRadius: 12, padding: 12, marginBottom: 12 },
  errorText: { color: '#EF4444', fontSize: 13, flex: 1 },

  sendBtn: { borderRadius: 18, overflow: 'hidden', marginBottom: 14 },
  sendBtnGrad: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', height: 54, gap: 10 },
  sendBtnText: { color: '#FFF', fontSize: 15, fontWeight: '700' },

  infoRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, borderRadius: 12, padding: 12, marginBottom: 14 },
  infoText: { fontSize: 12, flex: 1, lineHeight: 18 },

  skipBtn: { alignItems: 'center', paddingVertical: 6 },
  skipText: { fontSize: 13 },

  sentContainer: { alignItems: 'center', paddingVertical: 16, paddingTop: 8 },
  sentIcon: { width: 96, height: 96, borderRadius: 48, alignItems: 'center', justifyContent: 'center', marginBottom: 20, shadowColor: '#25D366', shadowOffset: { width: 0, height: 12 }, shadowOpacity: 0.4, shadowRadius: 20, elevation: 12 },
  sentTitle: { fontSize: 24, fontWeight: '800', marginBottom: 12, textAlign: 'center' },
  sentMsg: { fontSize: 14, textAlign: 'center', lineHeight: 22, marginBottom: 28, paddingHorizontal: 8 },
  sentBtn: { width: '100%', borderRadius: 16, overflow: 'hidden' },
  sentBtnGrad: { alignItems: 'center', justifyContent: 'center', height: 52 },
  sentBtnText: { color: '#FFF', fontSize: 16, fontWeight: '700' },
});
