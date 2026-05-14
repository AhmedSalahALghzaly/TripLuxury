import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, TextInput,
  ActivityIndicator, Platform, ScrollView, KeyboardAvoidingView,
  Modal, Animated,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { BlurView } from 'expo-blur';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../src/hooks/useTheme';
import { useTranslation } from '../../src/hooks/useTranslation';
import { useAppStore, useHasHydrated } from '../../src/store/appStore';
import { setApiAuthToken } from '../../src/services/api';
import { apiRequest, getApiUrl } from '@/lib/query-client';

type Mode = 'signin' | 'change-password';

export default function EmailLoginScreen() {
  const { isDark } = useTheme();
  const { language } = useTranslation();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const hasHydrated = useHasHydrated();
  const isAuthenticated = useAppStore((s) => s.isAuthenticated);
  const setUser = useAppStore((s) => s.setUser);
  const setUserRole = useAppStore((s) => s.setUserRole);

  const ar = language === 'ar';
  const mountedRef = useRef(true);

  const [mode, setMode] = useState<Mode>('signin');
  const modeAnim = useRef(new Animated.Value(1)).current;

  // Sign-in fields
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Change-password fields
  const [cpEmail, setCpEmail] = useState('');
  const [cpOldPass, setCpOldPass] = useState('');
  const [cpNewPass, setCpNewPass] = useState('');
  const [cpConfirmPass, setCpConfirmPass] = useState('');
  const [showCpOld, setShowCpOld] = useState(false);
  const [showCpNew, setShowCpNew] = useState(false);
  const [showCpConfirm, setShowCpConfirm] = useState(false);
  const [cpLoading, setCpLoading] = useState(false);
  const [cpError, setCpError] = useState('');
  const [cpSuccess, setCpSuccess] = useState('');

  // Forgot password modal
  const [forgotVisible, setForgotVisible] = useState(false);
  const [forgotIdentifier, setForgotIdentifier] = useState('');
  const [forgotLoading, setForgotLoading] = useState(false);
  const [forgotError, setForgotError] = useState('');
  const [forgotSuccess, setForgotSuccess] = useState(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const wasAuthOnMount = useRef<boolean | null>(null);
  useEffect(() => {
    if (!hasHydrated) return;
    if (wasAuthOnMount.current === null) {
      wasAuthOnMount.current = isAuthenticated;
      return;
    }
    if (isAuthenticated && wasAuthOnMount.current === false) {
      router.replace('/(tabs)');
    }
    wasAuthOnMount.current = isAuthenticated;
  }, [isAuthenticated, hasHydrated]);

  const switchMode = useCallback((m: Mode) => {
    if (Platform.OS === 'web') {
      setMode(m);
      setError(''); setSuccess(''); setCpError(''); setCpSuccess('');
      if (m === 'change-password' && email) setCpEmail(email);
      return;
    }
    Animated.timing(modeAnim, { toValue: 0, duration: 150, useNativeDriver: false }).start(() => {
      setMode(m);
      setError(''); setSuccess(''); setCpError(''); setCpSuccess('');
      if (m === 'change-password' && email) setCpEmail(email);
      Animated.timing(modeAnim, { toValue: 1, duration: 250, useNativeDriver: false }).start();
    });
  }, [email, modeAnim]);

  const completeAuth = (user: any, session_token: string) => {
    if (session_token) setApiAuthToken(session_token);
    if (user) { setUser(user, session_token || null); setUserRole(user.role || 'user'); }
  };

  const handleLogin = async () => {
    setError(''); setSuccess('');
    if (!email.trim() || !password.trim()) {
      setError(ar ? 'يرجى ملء جميع الحقول' : 'Please fill all fields'); return;
    }
    setLoading(true);
    try {
      const url = new URL('/api/auth/login', getApiUrl());
      const res = await apiRequest('POST', url.toString(), { email: email.trim(), password });
      const data = await res.json() as any;
      if (data.user && data.session_token && mountedRef.current) {
        completeAuth(data.user, data.session_token);
        router.replace('/(tabs)');
      } else if (data.detail) {
        if (mountedRef.current) setError(data.detail);
      } else {
        if (mountedRef.current) setError(ar ? 'البريد الإلكتروني أو كلمة المرور غير صحيحة' : 'Invalid email or password');
      }
    } catch (err: any) {
      const raw = err.message || '';
      try {
        const jsonStr = raw.includes('{') ? raw.slice(raw.indexOf('{')) : null;
        const parsed = jsonStr ? JSON.parse(jsonStr) : null;
        if (mountedRef.current) setError(parsed?.detail || (ar ? 'البريد الإلكتروني أو كلمة المرور غير صحيحة' : 'Invalid email or password'));
      } catch { if (mountedRef.current) setError(ar ? 'خطأ في الاتصال' : 'Connection error'); }
    } finally { if (mountedRef.current) setLoading(false); }
  };

  const handleChangePassword = async () => {
    setCpError(''); setCpSuccess('');
    if (!cpEmail.trim() || !cpOldPass.trim() || !cpNewPass.trim() || !cpConfirmPass.trim()) {
      setCpError(ar ? 'يرجى ملء جميع الحقول' : 'Please fill all fields'); return;
    }
    if (cpNewPass !== cpConfirmPass) {
      setCpError(ar ? 'كلمة المرور الجديدة وتأكيدها غير متطابقتين' : 'Passwords do not match'); return;
    }
    if (cpNewPass.length < 6) {
      setCpError(ar ? 'كلمة المرور يجب 6 أحرف على الأقل' : 'Password must be at least 6 characters'); return;
    }
    if (cpOldPass === cpNewPass) {
      setCpError(ar ? 'كلمة المرور الجديدة يجب أن تختلف' : 'New password must differ from current'); return;
    }
    setCpLoading(true);
    try {
      const url = new URL('/api/auth/change-password', getApiUrl());
      const res = await apiRequest('POST', url.toString(), {
        email: cpEmail.trim(), old_password: cpOldPass, new_password: cpNewPass,
      });
      const data = await res.json() as any;
      if (data.success && mountedRef.current) {
        setCpSuccess(ar ? 'تم تغيير كلمة المرور بنجاح! يمكنك الدخول الآن.' : 'Password changed! You can now sign in.');
        setCpOldPass(''); setCpNewPass(''); setCpConfirmPass('');
        setTimeout(() => {
          if (mountedRef.current) { setEmail(cpEmail); setPassword(''); switchMode('signin'); }
        }, 2500);
      } else if (data.detail) {
        if (mountedRef.current) setCpError(data.detail);
      }
    } catch (err: any) {
      const raw = err.message || '';
      try {
        const jsonStr = raw.includes('{') ? raw.slice(raw.indexOf('{')) : null;
        const parsed = jsonStr ? JSON.parse(jsonStr) : null;
        if (mountedRef.current) setCpError(parsed?.detail || raw || (ar ? 'حدث خطأ' : 'An error occurred'));
      } catch { if (mountedRef.current) setCpError(ar ? 'حدث خطأ' : 'An error occurred'); }
    } finally { if (mountedRef.current) setCpLoading(false); }
  };

  const handleForgotPassword = async () => {
    setForgotError('');
    if (!forgotIdentifier.trim()) {
      setForgotError(ar ? 'أدخل البريد الإلكتروني أو رقم الهاتف' : 'Enter your email or phone'); return;
    }
    setForgotLoading(true);
    try {
      const url = new URL('/api/auth/forgot-password', getApiUrl());
      const res = await apiRequest('POST', url.toString(), { identifier: forgotIdentifier.trim() });
      const data = await res.json() as any;
      if (data.success) {
        setForgotSuccess(true);
      } else {
        setForgotError(data.detail || (ar ? 'حدث خطأ' : 'An error occurred'));
      }
    } catch (err: any) {
      const raw = err.message || '';
      try {
        const jsonStr = raw.includes('{') ? raw.slice(raw.indexOf('{')) : null;
        const parsed = jsonStr ? JSON.parse(jsonStr) : null;
        setForgotError(parsed?.detail || (ar ? 'لم يتم العثور على الحساب' : 'Account not found'));
      } catch { setForgotError(ar ? 'حدث خطأ في الاتصال' : 'Connection error'); }
    } finally { if (mountedRef.current) setForgotLoading(false); }
  };

  const topPad = Platform.OS === 'web' ? 67 : insets.top;
  const botPad = Platform.OS === 'web' ? 34 : Math.max(insets.bottom, 16);

  const animStyle = Platform.OS === 'web'
    ? {}
    : { opacity: modeAnim, transform: [{ translateY: modeAnim.interpolate({ inputRange: [0, 1], outputRange: [12, 0] }) }] };

  const WrapperView = Platform.OS === 'web' ? View : Animated.View;

  return (
    <View style={styles.root}>
      <LinearGradient
        colors={isDark ? ['#020817', '#040F2A', '#060D1E'] : ['#EFF6FF', '#DBEAFE', '#EFF6FF']}
        style={StyleSheet.absoluteFill}
        start={{ x: 0.3, y: 0 }}
        end={{ x: 0.7, y: 1 }}
      />
      <View style={[styles.bgOrb1, { backgroundColor: isDark ? 'rgba(37,99,235,0.08)' : 'rgba(59,130,246,0.1)' }]} />
      <View style={[styles.bgOrb2, { backgroundColor: isDark ? 'rgba(16,185,129,0.05)' : 'rgba(52,211,153,0.08)' }]} />

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'} enabled={Platform.OS !== 'web'}>
        <ScrollView
          contentContainerStyle={[styles.container, { paddingTop: topPad + 12, paddingBottom: botPad + 24 }]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} activeOpacity={0.7}>
            <View style={[styles.backBtnInner, { backgroundColor: isDark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.05)' }]}>
              <Ionicons name={ar ? 'arrow-forward' : 'arrow-back'} size={20} color={isDark ? '#94A3B8' : '#64748B'} />
            </View>
          </TouchableOpacity>

          {/* ── SIGN IN MODE ── */}
          {mode === 'signin' && (
            <WrapperView style={animStyle}>
              <View style={styles.header}>
                <LinearGradient colors={['#2563EB', '#3B82F6']} style={styles.iconGradient}>
                  <Ionicons name="mail" size={28} color="#FFF" />
                </LinearGradient>
                <Text style={[styles.title, { color: isDark ? '#F1F5F9' : '#0F172A' }]}>
                  {ar ? 'تسجيل الدخول' : 'Sign In'}
                </Text>
                <Text style={[styles.subtitle, { color: isDark ? '#64748B' : '#94A3B8' }]}>
                  {ar ? 'أدخل بياناتك للدخول إلى حسابك' : 'Enter your credentials to continue'}
                </Text>
              </View>

              <View style={[styles.card, {
                backgroundColor: isDark ? 'rgba(15,23,42,0.85)' : 'rgba(255,255,255,0.95)',
                borderColor: isDark ? 'rgba(255,255,255,0.09)' : 'rgba(0,0,0,0.07)',
              }]}>
                <View style={styles.fieldLabel}>
                  <Text style={[styles.labelText, { color: isDark ? '#94A3B8' : '#64748B' }]}>
                    {ar ? 'البريد الإلكتروني' : 'Email Address'}
                  </Text>
                </View>
                <View style={[styles.inputRow, {
                  backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : '#F8FAFC',
                  borderColor: isDark ? 'rgba(255,255,255,0.12)' : '#E2E8F0',
                }]}>
                  <Ionicons name="mail-outline" size={18} color="#3B82F6" />
                  <TextInput
                    style={[styles.input, { color: isDark ? '#F1F5F9' : '#1E293B', textAlign: ar ? 'right' : 'left' }]}
                    placeholder="example@email.com"
                    placeholderTextColor={isDark ? '#475569' : '#CBD5E1'}
                    value={email}
                    onChangeText={setEmail}
                    autoCapitalize="none"
                    keyboardType="email-address"
                  />
                </View>

                <View style={[styles.fieldLabel, { marginTop: 16 }]}>
                  <Text style={[styles.labelText, { color: isDark ? '#94A3B8' : '#64748B' }]}>
                    {ar ? 'كلمة المرور' : 'Password'}
                  </Text>
                </View>
                <View style={[styles.inputRow, {
                  backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : '#F8FAFC',
                  borderColor: isDark ? 'rgba(255,255,255,0.12)' : '#E2E8F0',
                }]}>
                  <Ionicons name="lock-closed-outline" size={18} color="#3B82F6" />
                  <TextInput
                    style={[styles.input, { color: isDark ? '#F1F5F9' : '#1E293B', textAlign: ar ? 'right' : 'left' }]}
                    placeholder={ar ? '••••••••' : '••••••••'}
                    placeholderTextColor={isDark ? '#475569' : '#CBD5E1'}
                    value={password}
                    onChangeText={setPassword}
                    secureTextEntry={!showPass}
                  />
                  <TouchableOpacity onPress={() => setShowPass(!showPass)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                    <Ionicons name={showPass ? 'eye-off-outline' : 'eye-outline'} size={18} color={isDark ? '#475569' : '#94A3B8'} />
                  </TouchableOpacity>
                </View>

                {error ? (
                  <View style={styles.errorBox}>
                    <Ionicons name="alert-circle" size={15} color="#EF4444" />
                    <Text style={styles.errorText}>{error}</Text>
                  </View>
                ) : null}

                <TouchableOpacity
                  style={[styles.primaryBtn, loading && { opacity: 0.7 }]}
                  onPress={handleLogin}
                  disabled={loading}
                  activeOpacity={0.85}
                >
                  <LinearGradient colors={['#2563EB', '#3B82F6']} style={styles.primaryBtnGradient} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}>
                    {loading ? <ActivityIndicator color="#FFF" size="small" /> : (
                      <>
                        <Ionicons name="log-in-outline" size={20} color="#FFF" />
                        <Text style={styles.primaryBtnText}>{ar ? 'تسجيل الدخول' : 'Sign In'}</Text>
                      </>
                    )}
                  </LinearGradient>
                </TouchableOpacity>

                {/* Change password link */}
                <TouchableOpacity
                  onPress={() => switchMode('change-password')}
                  activeOpacity={0.7}
                  style={styles.linkRow}
                >
                  <Ionicons name="key-outline" size={15} color={isDark ? '#60A5FA' : '#2563EB'} />
                  <Text style={[styles.linkText, { color: isDark ? '#60A5FA' : '#2563EB' }]}>
                    {ar ? 'تغيير كلمة المرور' : 'Change Password'}
                  </Text>
                </TouchableOpacity>

                {/* Forgot password link */}
                <TouchableOpacity
                  onPress={() => {
                    setForgotIdentifier(email || '');
                    setForgotError('');
                    setForgotSuccess(false);
                    setForgotVisible(true);
                  }}
                  activeOpacity={0.7}
                  style={[styles.linkRow, { marginTop: 4 }]}
                >
                  <Ionicons name="help-circle-outline" size={15} color={isDark ? '#A78BFA' : '#7C3AED'} />
                  <Text style={[styles.linkText, { color: isDark ? '#A78BFA' : '#7C3AED' }]}>
                    {ar ? 'الحصول على كلمة المرور' : 'Get Password'}
                  </Text>
                </TouchableOpacity>
              </View>
            </WrapperView>
          )}

          {/* ── CHANGE PASSWORD MODE ── */}
          {mode === 'change-password' && (
            <WrapperView style={animStyle}>
              <View style={styles.header}>
                <LinearGradient colors={['#7C3AED', '#8B5CF6']} style={styles.iconGradient}>
                  <Ionicons name="key" size={28} color="#FFF" />
                </LinearGradient>
                <Text style={[styles.title, { color: isDark ? '#F1F5F9' : '#0F172A' }]}>
                  {ar ? 'تغيير كلمة المرور' : 'Change Password'}
                </Text>
                <Text style={[styles.subtitle, { color: isDark ? '#94A3B8' : '#64748B' }]}>
                  {ar ? 'أدخل بياناتك لتغيير كلمة المرور' : 'Verify your identity to set a new password'}
                </Text>
              </View>

              <View style={[styles.card, {
                backgroundColor: isDark ? 'rgba(15,23,42,0.85)' : 'rgba(255,255,255,0.95)',
                borderColor: isDark ? 'rgba(255,255,255,0.09)' : 'rgba(0,0,0,0.07)',
              }]}>
                <View style={styles.fieldLabel}>
                  <Text style={[styles.labelText, { color: isDark ? '#94A3B8' : '#64748B' }]}>
                    {ar ? 'البريد الإلكتروني' : 'Email Address'}
                  </Text>
                </View>
                <View style={[styles.inputRow, {
                  backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : '#F8FAFC',
                  borderColor: isDark ? 'rgba(255,255,255,0.12)' : '#E2E8F0',
                }]}>
                  <Ionicons name="mail-outline" size={18} color="#7C3AED" />
                  <TextInput
                    style={[styles.input, { color: isDark ? '#F1F5F9' : '#1E293B', textAlign: ar ? 'right' : 'left' }]}
                    placeholder="example@email.com"
                    placeholderTextColor={isDark ? '#475569' : '#CBD5E1'}
                    value={cpEmail}
                    onChangeText={setCpEmail}
                    autoCapitalize="none"
                    keyboardType="email-address"
                  />
                </View>

                <View style={[styles.fieldLabel, { marginTop: 16 }]}>
                  <Text style={[styles.labelText, { color: isDark ? '#94A3B8' : '#64748B' }]}>
                    {ar ? 'كلمة المرور الحالية' : 'Current Password'}
                  </Text>
                </View>
                <View style={[styles.inputRow, {
                  backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : '#F8FAFC',
                  borderColor: isDark ? 'rgba(255,255,255,0.12)' : '#E2E8F0',
                }]}>
                  <Ionicons name="lock-closed-outline" size={18} color="#7C3AED" />
                  <TextInput
                    style={[styles.input, { color: isDark ? '#F1F5F9' : '#1E293B', textAlign: ar ? 'right' : 'left' }]}
                    placeholder={ar ? 'كلمة المرور الحالية' : 'Current password'}
                    placeholderTextColor={isDark ? '#475569' : '#CBD5E1'}
                    value={cpOldPass}
                    onChangeText={setCpOldPass}
                    secureTextEntry={!showCpOld}
                  />
                  <TouchableOpacity onPress={() => setShowCpOld(!showCpOld)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                    <Ionicons name={showCpOld ? 'eye-off-outline' : 'eye-outline'} size={18} color={isDark ? '#475569' : '#94A3B8'} />
                  </TouchableOpacity>
                </View>

                <View style={[styles.sectionDivider, { borderColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.07)' }]}>
                  <Text style={[styles.sectionDividerText, { color: isDark ? '#64748B' : '#94A3B8' }]}>
                    {ar ? 'كلمة المرور الجديدة' : 'New Password'}
                  </Text>
                </View>

                <View style={[styles.inputRow, {
                  backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : '#F8FAFC',
                  borderColor: isDark ? 'rgba(255,255,255,0.12)' : '#E2E8F0',
                }]}>
                  <Ionicons name="lock-open-outline" size={18} color="#10B981" />
                  <TextInput
                    style={[styles.input, { color: isDark ? '#F1F5F9' : '#1E293B', textAlign: ar ? 'right' : 'left' }]}
                    placeholder={ar ? 'كلمة المرور الجديدة' : 'New password (min. 6 chars)'}
                    placeholderTextColor={isDark ? '#475569' : '#CBD5E1'}
                    value={cpNewPass}
                    onChangeText={setCpNewPass}
                    secureTextEntry={!showCpNew}
                  />
                  <TouchableOpacity onPress={() => setShowCpNew(!showCpNew)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                    <Ionicons name={showCpNew ? 'eye-off-outline' : 'eye-outline'} size={18} color={isDark ? '#475569' : '#94A3B8'} />
                  </TouchableOpacity>
                </View>

                <View style={[styles.inputRow, {
                  marginTop: 12,
                  backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : '#F8FAFC',
                  borderColor: cpConfirmPass && cpConfirmPass !== cpNewPass ? '#EF4444' : isDark ? 'rgba(255,255,255,0.12)' : '#E2E8F0',
                }]}>
                  <Ionicons name="checkmark-circle-outline" size={18} color={cpConfirmPass && cpConfirmPass === cpNewPass ? '#10B981' : '#94A3B8'} />
                  <TextInput
                    style={[styles.input, { color: isDark ? '#F1F5F9' : '#1E293B', textAlign: ar ? 'right' : 'left' }]}
                    placeholder={ar ? 'تأكيد كلمة المرور الجديدة' : 'Confirm new password'}
                    placeholderTextColor={isDark ? '#475569' : '#CBD5E1'}
                    value={cpConfirmPass}
                    onChangeText={setCpConfirmPass}
                    secureTextEntry={!showCpConfirm}
                  />
                  <TouchableOpacity onPress={() => setShowCpConfirm(!showCpConfirm)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                    <Ionicons name={showCpConfirm ? 'eye-off-outline' : 'eye-outline'} size={18} color={isDark ? '#475569' : '#94A3B8'} />
                  </TouchableOpacity>
                </View>

                {cpNewPass.length > 0 && cpNewPass.length < 6 && (
                  <Text style={styles.hintText}>{ar ? '⚠ يجب أن تكون 6 أحرف على الأقل' : '⚠ At least 6 characters required'}</Text>
                )}

                {cpError ? (
                  <View style={styles.errorBox}>
                    <Ionicons name="alert-circle" size={15} color="#EF4444" />
                    <Text style={styles.errorText}>{cpError}</Text>
                  </View>
                ) : null}

                {cpSuccess ? (
                  <View style={styles.successBox}>
                    <Ionicons name="checkmark-circle" size={15} color="#10B981" />
                    <Text style={styles.successText}>{cpSuccess}</Text>
                  </View>
                ) : null}

                <TouchableOpacity
                  style={[styles.primaryBtn, cpLoading && { opacity: 0.7 }]}
                  onPress={handleChangePassword}
                  disabled={cpLoading}
                  activeOpacity={0.85}
                >
                  <LinearGradient colors={['#7C3AED', '#8B5CF6']} style={styles.primaryBtnGradient} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}>
                    {cpLoading ? <ActivityIndicator color="#FFF" size="small" /> : (
                      <>
                        <Ionicons name="shield-checkmark-outline" size={20} color="#FFF" />
                        <Text style={styles.primaryBtnText}>{ar ? 'تأكيد تغيير كلمة المرور' : 'Confirm Password Change'}</Text>
                      </>
                    )}
                  </LinearGradient>
                </TouchableOpacity>

                <TouchableOpacity onPress={() => switchMode('signin')} activeOpacity={0.7} style={styles.linkRow}>
                  <Ionicons name="arrow-back" size={15} color={isDark ? '#60A5FA' : '#2563EB'} />
                  <Text style={[styles.linkText, { color: isDark ? '#60A5FA' : '#2563EB' }]}>
                    {ar ? 'العودة لتسجيل الدخول' : 'Back to Sign In'}
                  </Text>
                </TouchableOpacity>
              </View>
            </WrapperView>
          )}

          <TouchableOpacity style={styles.backToMain} onPress={() => router.back()} activeOpacity={0.7}>
            <Ionicons name={ar ? 'arrow-forward' : 'arrow-back'} size={14} color={isDark ? '#475569' : '#CBD5E1'} />
            <Text style={[styles.backToMainText, { color: isDark ? '#475569' : '#CBD5E1' }]}>
              {ar ? 'العودة لصفحة الدخول الرئيسية' : 'Back to main login'}
            </Text>
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>

      {/* ── FORGOT PASSWORD MODAL ── */}
      <Modal visible={forgotVisible} transparent animationType="fade" onRequestClose={() => setForgotVisible(false)}>
        <View style={styles.modalOverlay}>
          <BlurView intensity={20} tint={isDark ? 'dark' : 'light'} style={StyleSheet.absoluteFill} />
          <View style={[styles.modalCard, { backgroundColor: isDark ? '#0F172A' : '#FFFFFF' }]}>
            {forgotSuccess ? (
              <View style={styles.forgotSuccessContainer}>
                <LinearGradient colors={['#10B981', '#059669']} style={styles.forgotSuccessIcon}>
                  <Ionicons name="checkmark-circle" size={40} color="#FFF" />
                </LinearGradient>
                <Text style={[styles.forgotSuccessTitle, { color: isDark ? '#F1F5F9' : '#0F172A' }]}>
                  {ar ? 'تم إرسال الطلب' : 'Request Sent'}
                </Text>
                <Text style={[styles.forgotSuccessMsg, { color: isDark ? '#94A3B8' : '#64748B' }]}>
                  {ar
                    ? 'يتم إرسال كلمة المرور\nقم بمراجعة الإيميل والواتس آب خلال دقائق'
                    : 'Your password will be sent\nCheck your email and WhatsApp within minutes'}
                </Text>
                <TouchableOpacity
                  style={styles.forgotSuccessBtn}
                  onPress={() => { setForgotVisible(false); setForgotSuccess(false); setForgotIdentifier(''); }}
                  activeOpacity={0.85}
                >
                  <LinearGradient colors={['#10B981', '#059669']} style={styles.forgotSuccessBtnGrad}>
                    <Text style={styles.forgotSuccessBtnText}>{ar ? 'حسناً' : 'OK'}</Text>
                  </LinearGradient>
                </TouchableOpacity>
              </View>
            ) : (
              <>
                <View style={styles.modalHeader}>
                  <LinearGradient colors={['#7C3AED', '#A78BFA']} style={styles.modalIconGrad}>
                    <Ionicons name="help-circle" size={28} color="#FFF" />
                  </LinearGradient>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.modalTitle, { color: isDark ? '#F1F5F9' : '#0F172A' }]}>
                      {ar ? 'الحصول على كلمة المرور' : 'Get Password'}
                    </Text>
                    <Text style={[styles.modalSubtitle, { color: isDark ? '#94A3B8' : '#64748B' }]}>
                      {ar ? 'سيتواصل معك المالك خلال دقائق' : 'The owner will contact you shortly'}
                    </Text>
                  </View>
                  <TouchableOpacity onPress={() => setForgotVisible(false)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                    <Ionicons name="close" size={22} color={isDark ? '#94A3B8' : '#64748B'} />
                  </TouchableOpacity>
                </View>

                <View style={[styles.forgotInputRow, {
                  backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : '#F8FAFC',
                  borderColor: isDark ? 'rgba(255,255,255,0.12)' : '#E2E8F0',
                }]}>
                  <Ionicons name="person-outline" size={18} color="#7C3AED" />
                  <TextInput
                    style={[styles.forgotInput, { color: isDark ? '#F1F5F9' : '#1E293B', textAlign: ar ? 'right' : 'left' }]}
                    placeholder={ar ? 'البريد الإلكتروني أو رقم الموبايل' : 'Email or phone number'}
                    placeholderTextColor={isDark ? '#475569' : '#CBD5E1'}
                    value={forgotIdentifier}
                    onChangeText={setForgotIdentifier}
                    autoCapitalize="none"
                    keyboardType="email-address"
                  />
                </View>

                {forgotError ? (
                  <View style={[styles.errorBox, { marginTop: 12 }]}>
                    <Ionicons name="alert-circle" size={14} color="#EF4444" />
                    <Text style={styles.errorText}>{forgotError}</Text>
                  </View>
                ) : null}

                <View style={styles.forgotSteps}>
                  {[
                    { icon: 'search-outline', text: ar ? 'التحقق من وجود حسابك' : 'Verify your account exists' },
                    { icon: 'notifications-outline', text: ar ? 'إشعار المالك بطلبك' : 'Owner notified of your request' },
                    { icon: 'send-outline', text: ar ? 'إرسال كلمة المرور عبر الإيميل أو الواتس آب' : 'Password sent via email or WhatsApp' },
                  ].map((step, i) => (
                    <View key={i} style={styles.forgotStep}>
                      <View style={styles.forgotStepIcon}>
                        <Ionicons name={step.icon as any} size={14} color="#7C3AED" />
                      </View>
                      <Text style={[styles.forgotStepText, { color: isDark ? '#94A3B8' : '#64748B' }]}>{step.text}</Text>
                    </View>
                  ))}
                </View>

                <TouchableOpacity
                  style={[styles.forgotConfirmBtn, forgotLoading && { opacity: 0.7 }]}
                  onPress={handleForgotPassword}
                  disabled={forgotLoading}
                  activeOpacity={0.85}
                >
                  <LinearGradient colors={['#7C3AED', '#A78BFA']} style={styles.forgotConfirmBtnGrad} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}>
                    {forgotLoading ? <ActivityIndicator color="#FFF" size="small" /> : (
                      <>
                        <Ionicons name="paper-plane" size={18} color="#FFF" />
                        <Text style={styles.forgotConfirmBtnText}>{ar ? 'تأكيد الطلب' : 'Submit Request'}</Text>
                      </>
                    )}
                  </LinearGradient>
                </TouchableOpacity>
              </>
            )}
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, overflow: 'hidden', backgroundColor: '#020817' },
  bgOrb1: { position: 'absolute', width: 280, height: 280, borderRadius: 140, top: -80, right: -60 },
  bgOrb2: { position: 'absolute', width: 220, height: 220, borderRadius: 110, bottom: 60, left: -60 },
  container: { flexGrow: 1, paddingHorizontal: 20 },
  backBtn: { marginTop: 8, marginBottom: 16, alignSelf: 'flex-start' },
  backBtnInner: { width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  header: { alignItems: 'center', marginBottom: 28 },
  iconGradient: { width: 68, height: 68, borderRadius: 20, alignItems: 'center', justifyContent: 'center', marginBottom: 18, shadowColor: '#2563EB', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.35, shadowRadius: 16, elevation: 10 },
  title: { fontSize: 26, fontWeight: '800', textAlign: 'center', marginBottom: 8, letterSpacing: -0.4 },
  subtitle: { fontSize: 14, textAlign: 'center', lineHeight: 20 },
  card: { borderRadius: 24, borderWidth: 1, padding: 24, shadowColor: '#000', shadowOffset: { width: 0, height: 12 }, shadowOpacity: 0.15, shadowRadius: 24, elevation: 10 },
  fieldLabel: { marginBottom: 8 },
  labelText: { fontSize: 12, fontWeight: '600', letterSpacing: 0.4, textTransform: 'uppercase' },
  inputRow: { flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1.5, borderRadius: 14, paddingHorizontal: 14, height: 52 },
  input: { flex: 1, fontSize: 15, paddingVertical: 0 },
  sectionDivider: { borderTopWidth: 1, marginTop: 20, marginBottom: 16, paddingTop: 16, alignItems: 'center' },
  sectionDividerText: { fontSize: 12, fontWeight: '700', letterSpacing: 0.5, textTransform: 'uppercase' },
  hintText: { fontSize: 12, color: '#F59E0B', marginTop: 6, marginLeft: 4 },
  errorBox: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, backgroundColor: 'rgba(239,68,68,0.1)', borderWidth: 1, borderColor: 'rgba(239,68,68,0.25)', paddingHorizontal: 12, paddingVertical: 10, borderRadius: 12, marginTop: 12 },
  errorText: { color: '#EF4444', fontSize: 13, flex: 1, lineHeight: 18 },
  successBox: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, backgroundColor: 'rgba(16,185,129,0.1)', borderWidth: 1, borderColor: 'rgba(16,185,129,0.25)', paddingHorizontal: 12, paddingVertical: 10, borderRadius: 12, marginTop: 12 },
  successText: { color: '#10B981', fontSize: 13, flex: 1, lineHeight: 18 },
  primaryBtn: { marginTop: 20, borderRadius: 16, overflow: 'hidden', shadowColor: '#2563EB', shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.3, shadowRadius: 14, elevation: 8 },
  primaryBtnGradient: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', height: 54, gap: 10, paddingHorizontal: 20 },
  primaryBtnText: { color: '#FFF', fontSize: 16, fontWeight: '700', letterSpacing: 0.2 },
  linkRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: 18, paddingVertical: 8 },
  linkText: { fontSize: 14, fontWeight: '600' },
  backToMain: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, marginTop: 28, paddingVertical: 8 },
  backToMainText: { fontSize: 12 },

  // Modal
  modalOverlay: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  modalCard: { width: '100%', maxWidth: 400, borderRadius: 28, padding: 24, shadowColor: '#000', shadowOffset: { width: 0, height: 20 }, shadowOpacity: 0.3, shadowRadius: 30, elevation: 20 },
  modalHeader: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 20 },
  modalIconGrad: { width: 52, height: 52, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  modalTitle: { fontSize: 18, fontWeight: '700' },
  modalSubtitle: { fontSize: 12, marginTop: 2 },
  forgotInputRow: { flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1.5, borderRadius: 14, paddingHorizontal: 14, height: 52 },
  forgotInput: { flex: 1, fontSize: 15, paddingVertical: 0 },
  forgotSteps: { marginTop: 16, gap: 10 },
  forgotStep: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  forgotStepIcon: { width: 26, height: 26, borderRadius: 13, backgroundColor: 'rgba(124,58,237,0.1)', alignItems: 'center', justifyContent: 'center' },
  forgotStepText: { fontSize: 13, flex: 1 },
  forgotConfirmBtn: { marginTop: 20, borderRadius: 16, overflow: 'hidden' },
  forgotConfirmBtnGrad: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', height: 52, gap: 10 },
  forgotConfirmBtnText: { color: '#FFF', fontSize: 15, fontWeight: '700' },

  // Forgot success
  forgotSuccessContainer: { alignItems: 'center', paddingVertical: 8 },
  forgotSuccessIcon: { width: 80, height: 80, borderRadius: 40, alignItems: 'center', justifyContent: 'center', marginBottom: 16 },
  forgotSuccessTitle: { fontSize: 22, fontWeight: '800', marginBottom: 12 },
  forgotSuccessMsg: { fontSize: 15, textAlign: 'center', lineHeight: 22, marginBottom: 24 },
  forgotSuccessBtn: { width: '100%', borderRadius: 16, overflow: 'hidden' },
  forgotSuccessBtnGrad: { alignItems: 'center', justifyContent: 'center', height: 52 },
  forgotSuccessBtnText: { color: '#FFF', fontSize: 16, fontWeight: '700' },
});
