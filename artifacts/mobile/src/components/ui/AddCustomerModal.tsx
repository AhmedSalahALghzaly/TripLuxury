/**
 * AddCustomerModal - Reusable modal for creating new user accounts
 * Used by owner/admin in customer management screens
 */
import React, { useState, useRef, useEffect } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, TextInput,
  ActivityIndicator, Modal, Platform, ScrollView, KeyboardAvoidingView, Animated,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../hooks/useTheme';
import { useTranslation } from '../../hooks/useTranslation';
import { apiRequest, getApiUrl } from '@/lib/query-client';

interface AddCustomerModalProps {
  visible: boolean;
  onClose: () => void;
  onSuccess?: (user: any) => void;
}

export function AddCustomerModal({ visible, onClose, onSuccess }: AddCustomerModalProps) {
  const { colors, isDark } = useTheme();
  const { language } = useTranslation();
  const ar = language === 'ar';

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [phone, setPhone] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const mountedRef = useRef(true);
  const slideAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    if (visible) {
      setName('');
      setEmail('');
      setPassword('');
      setPhone('');
      setError('');
      setSuccess('');
      Animated.spring(slideAnim, { toValue: 1, useNativeDriver: false, bounciness: 6 }).start();
    } else {
      slideAnim.setValue(0);
    }
  }, [visible]);

  const handleCreate = async () => {
    setError('');
    setSuccess('');
    if (!name.trim()) {
      setError(ar ? 'يرجى إدخال الاسم الكامل' : 'Please enter the full name');
      return;
    }
    if (!email.trim()) {
      setError(ar ? 'يرجى إدخال البريد الإلكتروني' : 'Please enter the email');
      return;
    }
    if (!password || password.length < 6) {
      setError(ar ? 'كلمة المرور يجب أن تتكون من 6 أحرف على الأقل' : 'Password must be at least 6 characters');
      return;
    }

    setLoading(true);
    try {
      const body: any = { name: name.trim(), email: email.trim().toLowerCase(), password };
      if (phone.trim()) body.phone = phone.trim();

      const url = new URL('/api/customers/admin/create', getApiUrl());
      const res = await apiRequest('POST', url.toString(), body);
      const data = await res.json() as any;

      if (data.user && mountedRef.current) {
        setSuccess(ar ? `تم إنشاء حساب ${data.user.name} بنجاح ✓` : `Account for ${data.user.name} created ✓`);
        setTimeout(() => {
          if (mountedRef.current) {
            onSuccess?.(data.user);
            onClose();
          }
        }, 1200);
      } else if (data.detail && mountedRef.current) {
        setError(data.detail);
      } else {
        if (mountedRef.current) setError(ar ? 'حدث خطأ. يرجى المحاولة مجدداً.' : 'An error occurred. Please try again.');
      }
    } catch (err: any) {
      if (mountedRef.current) setError(err.message || (ar ? 'حدث خطأ' : 'An error occurred'));
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  };

  const sheetY = slideAnim.interpolate({ inputRange: [0, 1], outputRange: [400, 0] });

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onClose}>
      <KeyboardAvoidingView style={styles.overlay} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={onClose} />
        <Animated.View style={[styles.sheet, { backgroundColor: isDark ? '#111827' : '#FFF', transform: [{ translateY: sheetY }] }]}>
          <View style={styles.handle} />

          {/* Header */}
          <View style={styles.sheetHeader}>
            <View style={[styles.headerIconWrap, { backgroundColor: '#3B82F620' }]}>
              <Ionicons name="person-add" size={26} color="#3B82F6" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.sheetTitle, { color: colors.text }]}>
                {ar ? 'إضافة مستخدم جديد' : 'Add New User'}
              </Text>
              <Text style={[styles.sheetSubtitle, { color: colors.textSecondary }]}>
                {ar ? 'إنشاء حساب جديد بصلاحيات المستخدم' : 'Create account with user permissions'}
              </Text>
            </View>
            <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
              <Ionicons name="close" size={22} color={colors.textSecondary} />
            </TouchableOpacity>
          </View>

          <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            <View style={styles.form}>
              {/* Name */}
              <View style={styles.fieldGroup}>
                <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>
                  {ar ? 'الاسم الكامل *' : 'Full Name *'}
                </Text>
                <View style={[styles.inputRow, { backgroundColor: isDark ? '#1F2937' : '#F8FAFF', borderColor: isDark ? '#374151' : '#E2E8F0' }]}>
                  <Ionicons name="person-outline" size={18} color="#3B82F6" />
                  <TextInput
                    style={[styles.input, { color: colors.text, textAlign: ar ? 'right' : 'left' }]}
                    placeholder={ar ? 'أدخل الاسم الكامل' : 'Enter full name'}
                    placeholderTextColor={colors.textSecondary}
                    value={name}
                    onChangeText={setName}
                    autoCapitalize="words"
                  />
                </View>
              </View>

              {/* Email */}
              <View style={styles.fieldGroup}>
                <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>
                  {ar ? 'البريد الإلكتروني *' : 'Email Address *'}
                </Text>
                <View style={[styles.inputRow, { backgroundColor: isDark ? '#1F2937' : '#F8FAFF', borderColor: isDark ? '#374151' : '#E2E8F0' }]}>
                  <Ionicons name="mail-outline" size={18} color="#3B82F6" />
                  <TextInput
                    style={[styles.input, { color: colors.text, textAlign: ar ? 'right' : 'left' }]}
                    placeholder={ar ? 'أدخل البريد الإلكتروني' : 'Enter email address'}
                    placeholderTextColor={colors.textSecondary}
                    value={email}
                    onChangeText={setEmail}
                    autoCapitalize="none"
                    keyboardType="email-address"
                  />
                </View>
              </View>

              {/* Password */}
              <View style={styles.fieldGroup}>
                <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>
                  {ar ? 'كلمة المرور *' : 'Password *'}
                </Text>
                <View style={[styles.inputRow, { backgroundColor: isDark ? '#1F2937' : '#F8FAFF', borderColor: isDark ? '#374151' : '#E2E8F0' }]}>
                  <Ionicons name="lock-closed-outline" size={18} color="#3B82F6" />
                  <TextInput
                    style={[styles.input, { color: colors.text, textAlign: ar ? 'right' : 'left' }]}
                    placeholder={ar ? 'كلمة المرور (6 أحرف على الأقل)' : 'Password (min. 6 characters)'}
                    placeholderTextColor={colors.textSecondary}
                    value={password}
                    onChangeText={setPassword}
                    secureTextEntry={!showPass}
                  />
                  <TouchableOpacity onPress={() => setShowPass(!showPass)}>
                    <Ionicons name={showPass ? 'eye-off-outline' : 'eye-outline'} size={18} color={colors.textSecondary} />
                  </TouchableOpacity>
                </View>
              </View>

              {/* Phone (optional) */}
              <View style={styles.fieldGroup}>
                <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>
                  {ar ? 'رقم الهاتف (اختياري)' : 'Phone Number (optional)'}
                </Text>
                <View style={[styles.inputRow, { backgroundColor: isDark ? '#1F2937' : '#F8FAFF', borderColor: isDark ? '#374151' : '#E2E8F0' }]}>
                  <Ionicons name="call-outline" size={18} color="#3B82F6" />
                  <TextInput
                    style={[styles.input, { color: colors.text, textAlign: ar ? 'right' : 'left' }]}
                    placeholder={ar ? 'مثال: +201234567890' : 'e.g. +201234567890'}
                    placeholderTextColor={colors.textSecondary}
                    value={phone}
                    onChangeText={setPhone}
                    keyboardType="phone-pad"
                  />
                </View>
              </View>

              {/* Error */}
              {error ? (
                <View style={styles.errorBox}>
                  <Ionicons name="alert-circle" size={15} color="#EF4444" />
                  <Text style={styles.errorText}>{error}</Text>
                </View>
              ) : null}

              {/* Success */}
              {success ? (
                <View style={styles.successBox}>
                  <Ionicons name="checkmark-circle" size={15} color="#10B981" />
                  <Text style={styles.successText}>{success}</Text>
                </View>
              ) : null}

              {/* Submit */}
              <TouchableOpacity
                style={[styles.createBtn, loading && { opacity: 0.7 }]}
                onPress={handleCreate}
                disabled={loading}
              >
                {loading ? <ActivityIndicator color="#FFF" /> : (
                  <>
                    <Ionicons name="person-add" size={20} color="#FFF" />
                    <Text style={styles.createBtnText}>
                      {ar ? 'إنشاء الحساب' : 'Create Account'}
                    </Text>
                  </>
                )}
              </TouchableOpacity>
            </View>
          </ScrollView>
        </Animated.View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.55)' },
  sheet: {
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    maxHeight: '92%',
    paddingHorizontal: 20,
    paddingBottom: Platform.OS === 'web' ? 34 : 40,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -6 },
    shadowOpacity: 0.2,
    shadowRadius: 24,
    elevation: 16,
  },
  handle: { width: 40, height: 5, borderRadius: 3, backgroundColor: '#CBD5E1', alignSelf: 'center', marginTop: 12, marginBottom: 4 },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 16 },
  headerIconWrap: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  sheetTitle: { fontSize: 17, fontWeight: '800' },
  sheetSubtitle: { fontSize: 12, marginTop: 2 },
  closeBtn: { padding: 6 },
  form: { gap: 14, paddingBottom: 8 },
  fieldGroup: { gap: 6 },
  fieldLabel: { fontSize: 12, fontWeight: '600', marginLeft: 2 },
  inputRow: { flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1.5, borderRadius: 14, paddingHorizontal: 14, height: 52 },
  input: { flex: 1, fontSize: 15, height: '100%' },
  errorBox: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#FEE2E2', paddingHorizontal: 14, paddingVertical: 10, borderRadius: 10 },
  errorText: { color: '#EF4444', fontSize: 13, flex: 1 },
  successBox: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#D1FAE5', paddingHorizontal: 14, paddingVertical: 10, borderRadius: 10 },
  successText: { color: '#059669', fontSize: 13, flex: 1 },
  createBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: '#3B82F6', height: 54, borderRadius: 16, gap: 10, marginTop: 6, shadowColor: '#3B82F6', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 10, elevation: 6 },
  createBtnText: { color: '#FFF', fontSize: 16, fontWeight: '700' },
});
