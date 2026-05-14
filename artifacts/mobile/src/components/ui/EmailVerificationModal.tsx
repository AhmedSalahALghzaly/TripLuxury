import React, { useState, useRef, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  TextInput,
  StyleSheet,
  Modal,
  ActivityIndicator,
  Platform,
  Animated,
  KeyboardAvoidingView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../hooks/useTheme';
import { useTranslation } from '../../hooks/useTranslation';
import { apiRequest, getApiUrl } from '@/lib/query-client';

interface EmailVerificationModalProps {
  visible: boolean;
  email: string;
  onClose: () => void;
  onVerified: () => void;
}

export function EmailVerificationModal({
  visible,
  email,
  onClose,
  onVerified,
}: EmailVerificationModalProps) {
  const { colors, isDark } = useTheme();
  const { language } = useTranslation();
  const ar = language === 'ar';

  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [countdown, setCountdown] = useState(0);
  const slideAnim = useRef(new Animated.Value(0)).current;
  const scaleAnim = useRef(new Animated.Value(0.95)).current;
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (visible) {
      Animated.parallel([
        Animated.timing(slideAnim, { toValue: 1, duration: 350, useNativeDriver: false }),
        Animated.spring(scaleAnim, { toValue: 1, tension: 60, friction: 8, useNativeDriver: false }),
      ]).start();
      handleSendCode();
    } else {
      slideAnim.setValue(0);
      scaleAnim.setValue(0.95);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [visible]);

  const startCountdown = () => {
    setCountdown(60);
    timerRef.current = setInterval(() => {
      setCountdown((c) => {
        if (c <= 1) {
          if (timerRef.current) clearInterval(timerRef.current);
          return 0;
        }
        return c - 1;
      });
    }, 1000);
  };

  const handleSendCode = async () => {
    setSending(true);
    setError('');
    setSuccess('');
    try {
      const url = new URL('/api/auth/send-email-verification', getApiUrl());
      await apiRequest('POST', url.toString(), { email, language });
      setSuccess(
        ar
          ? `تم إرسال رمز التحقق إلى ${email}`
          : `Verification code sent to ${email}`
      );
      startCountdown();
    } catch (err: any) {
      setError(err.message || (ar ? 'فشل إرسال الرمز' : 'Failed to send code'));
    } finally {
      setSending(false);
    }
  };

  const handleVerify = async () => {
    if (!code || code.length < 6) {
      setError(ar ? 'يرجى إدخال الرمز المكون من 6 أرقام' : 'Please enter the 6-digit code');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const url = new URL('/api/auth/verify-email-code', getApiUrl());
      await apiRequest('POST', url.toString(), { email, code });
      onVerified();
    } catch (err: any) {
      setError(err.message || (ar ? 'رمز غير صحيح أو منتهي الصلاحية' : 'Invalid or expired code'));
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    setCode('');
    setError('');
    setSuccess('');
    setCountdown(0);
    if (timerRef.current) clearInterval(timerRef.current);
    onClose();
  };

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={handleClose}>
      <KeyboardAvoidingView
        style={styles.overlay}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <View style={styles.backdrop}>
          <TouchableOpacity style={styles.backdropTouch} onPress={handleClose} activeOpacity={1} />
        </View>

        <Animated.View
          style={[
            styles.sheet,
            {
              backgroundColor: isDark ? '#0F172A' : '#FFFFFF',
              transform: [{ translateY: slideAnim.interpolate({ inputRange: [0, 1], outputRange: [400, 0] }) }],
            },
          ]}
        >
          <View style={styles.handle} />

          <TouchableOpacity style={styles.closeBtn} onPress={handleClose}>
            <View style={[styles.closeBtnInner, { backgroundColor: isDark ? '#1E293B' : '#F1F5F9' }]}>
              <Ionicons name="close" size={20} color={colors.textSecondary} />
            </View>
          </TouchableOpacity>

          <View style={styles.headerSection}>
            <View style={styles.iconRing}>
              <View style={styles.iconInner}>
                <Ionicons name="mail" size={36} color="#3B82F6" />
              </View>
            </View>
            <Text style={[styles.title, { color: colors.text }]}>
              {ar ? 'تأكيد البريد الإلكتروني' : 'Verify Your Email'}
            </Text>
            <Text style={[styles.emailLabel, { color: colors.textSecondary }]}>
              {ar ? 'تم إرسال رمز التحقق إلى' : 'A verification code was sent to'}
            </Text>
            <Text style={[styles.emailAddress, { color: '#3B82F6' }]} numberOfLines={1}>
              {email}
            </Text>
          </View>

          <View style={styles.formSection}>
            {success ? (
              <View style={[styles.successBox]}>
                <Ionicons name="checkmark-circle" size={16} color="#10B981" />
                <Text style={styles.successText}>{success}</Text>
              </View>
            ) : null}

            <View style={[styles.codeWrap, { backgroundColor: isDark ? '#1E293B' : '#F8FAFC', borderColor: code ? '#3B82F6' : colors.border }]}>
              <Ionicons name="key-outline" size={22} color="#3B82F6" style={{ marginRight: 10 }} />
              <TextInput
                style={[styles.codeInput, { color: colors.text }]}
                value={code}
                onChangeText={(t) => { setCode(t.replace(/[^0-9]/g, '')); setError(''); }}
                placeholder={ar ? 'الرمز المكون من 6 أرقام' : '6-digit code'}
                placeholderTextColor={colors.textSecondary}
                keyboardType="number-pad"
                maxLength={6}
                autoFocus
              />
              {code.length > 0 && (
                <TouchableOpacity onPress={() => setCode('')}>
                  <Ionicons name="close-circle" size={20} color={colors.textSecondary} />
                </TouchableOpacity>
              )}
            </View>

            {error ? (
              <View style={styles.errorBox}>
                <Ionicons name="alert-circle" size={15} color="#EF4444" />
                <Text style={styles.errorText}>{error}</Text>
              </View>
            ) : null}

            <TouchableOpacity
              style={[styles.verifyBtn, (loading || code.length < 6) && { opacity: 0.6 }]}
              onPress={handleVerify}
              disabled={loading || code.length < 6}
              activeOpacity={0.85}
            >
              {loading ? (
                <ActivityIndicator color="#FFF" size="small" />
              ) : (
                <>
                  <Ionicons name="shield-checkmark" size={20} color="#FFF" />
                  <Text style={styles.verifyBtnText}>
                    {ar ? 'تأكيد الرمز' : 'Verify Code'}
                  </Text>
                </>
              )}
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.resendRow, (countdown > 0 || sending) && { opacity: 0.5 }]}
              onPress={handleSendCode}
              disabled={countdown > 0 || sending}
            >
              {sending ? (
                <ActivityIndicator size="small" color="#3B82F6" />
              ) : (
                <Ionicons name="refresh" size={16} color="#3B82F6" />
              )}
              <Text style={[styles.resendText]}>
                {countdown > 0
                  ? (ar ? `إعادة الإرسال بعد ${countdown}ث` : `Resend in ${countdown}s`)
                  : (ar ? 'إعادة إرسال الرمز' : 'Resend code')}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.skipBtn} onPress={handleClose}>
              <Text style={[styles.skipText, { color: colors.textSecondary }]}>
                {ar ? 'تخطي الآن' : 'Skip for now'}
              </Text>
            </TouchableOpacity>
          </View>
        </Animated.View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { ...StyleSheet.absoluteFillObject },
  backdropTouch: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)' },
  sheet: {
    borderTopLeftRadius: 32,
    borderTopRightRadius: 32,
    paddingHorizontal: 24,
    paddingBottom: Platform.OS === 'web' ? 34 : 44,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -6 },
    shadowOpacity: 0.15,
    shadowRadius: 24,
    elevation: 12,
  },
  handle: {
    width: 44,
    height: 5,
    borderRadius: 3,
    backgroundColor: '#CBD5E1',
    alignSelf: 'center',
    marginTop: 14,
    marginBottom: 8,
  },
  closeBtn: { position: 'absolute', top: 20, right: 20, zIndex: 10 },
  closeBtnInner: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerSection: { alignItems: 'center', paddingTop: 16, paddingBottom: 24 },
  iconRing: {
    width: 90,
    height: 90,
    borderRadius: 45,
    backgroundColor: '#EFF6FF',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
    borderWidth: 3,
    borderColor: '#BFDBFE',
  },
  iconInner: { alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 22, fontWeight: '800', marginBottom: 10, textAlign: 'center' },
  emailLabel: { fontSize: 14, textAlign: 'center', marginBottom: 4 },
  emailAddress: { fontSize: 15, fontWeight: '700', textAlign: 'center' },
  formSection: { gap: 14 },
  successBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#D1FAE5',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 10,
  },
  successText: { color: '#065F46', fontSize: 13, flex: 1 },
  codeWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 2,
    borderRadius: 16,
    paddingHorizontal: 16,
    height: 58,
  },
  codeInput: {
    flex: 1,
    fontSize: 28,
    fontWeight: '800',
    letterSpacing: 10,
    textAlign: 'center',
    height: '100%',
  },
  errorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#FEE2E2',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 10,
  },
  errorText: { color: '#B91C1C', fontSize: 13, flex: 1 },
  verifyBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#3B82F6',
    height: 54,
    borderRadius: 16,
    gap: 10,
    marginTop: 4,
    shadowColor: '#3B82F6',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
    elevation: 6,
  },
  verifyBtnText: { color: '#FFF', fontSize: 17, fontWeight: '700' },
  resendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 4,
  },
  resendText: { color: '#3B82F6', fontSize: 14, fontWeight: '600' },
  skipBtn: { alignItems: 'center', paddingVertical: 6 },
  skipText: { fontSize: 14 },
});
