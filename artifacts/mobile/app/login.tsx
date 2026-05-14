import React, { useEffect, useState, useRef, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Platform,
  Animated,
  Linking,
  Dimensions,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import * as WebBrowser from 'expo-web-browser';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../src/hooks/useTheme';
import { useTranslation } from '../src/hooks/useTranslation';
import { useAppStore, useHasHydrated } from '../src/store/appStore';
import { setApiAuthToken } from '../src/services/api';
import { apiRequest, getApiUrl } from '@/lib/query-client';

WebBrowser.maybeCompleteAuthSession();

const { width: SW, height: SH } = Dimensions.get('window');
const LOGO_URL = 'https://customer-assets.emergentagent.com/job_carcomponents-3/artifacts/nipikb4p_1317.jpg';

function getGoogleOAuthUrl(): string {
  const clientId = process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID;
  if (!clientId) return '';
  const redirectUri =
    Platform.OS === 'web' && typeof window !== 'undefined'
      ? `${window.location.origin}/login`
      : `https://${(process.env.EXPO_PUBLIC_DOMAIN || '').replace(/:\d+$/, '')}/login`;
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'token',
    scope: 'openid email profile',
    include_granted_scopes: 'true',
  });
  return `https://accounts.google.com/o/oauth2/auth?${params.toString()}`;
}

// Floating orb component for background effect
function FloatingOrb({ x, y, size, color, delay }: { x: number; y: number; size: number; color: string; delay: number }) {
  const anim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.delay(delay),
        Animated.timing(anim, { toValue: 1, duration: 4000 + delay, useNativeDriver: false }),
        Animated.timing(anim, { toValue: 0, duration: 4000 + delay, useNativeDriver: false }),
      ])
    ).start();
  }, []);
  const translateY = anim.interpolate({ inputRange: [0, 1], outputRange: [0, -20] });
  const opacity = anim.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0.15, 0.3, 0.15] });
  return (
    <Animated.View
      style={{
        position: 'absolute',
        left: x,
        top: y,
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: color,
        transform: [{ translateY }],
        opacity,
        ...Platform.select({ web: { filter: `blur(${size * 0.4}px)` } as any, default: {} }),
      }}
    />
  );
}

export default function LoginScreen() {
  const { isDark } = useTheme();
  const { language } = useTranslation();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const hasHydrated = useHasHydrated();

  const setUser = useAppStore((s) => s.setUser);
  const setSessionToken = useAppStore((s) => s.setSessionToken);
  const setUserRole = useAppStore((s) => s.setUserRole);
  const isAuthenticated = useAppStore((s) => s.isAuthenticated);

  const [loading, setLoading] = useState(false);
  const [replitLoading, setReplitLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const ar = language === 'ar';

  // Animation refs
  const fadeIn = useRef(new Animated.Value(0)).current;
  const slideUp = useRef(new Animated.Value(40)).current;
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const ring1Anim = useRef(new Animated.Value(0)).current;
  const ring2Anim = useRef(new Animated.Value(0)).current;
  const ring3Anim = useRef(new Animated.Value(0)).current;
  const glowAnim = useRef(new Animated.Value(0)).current;
  const replitPulse = useRef(new Animated.Value(1)).current;
  const cardFloat = useRef(new Animated.Value(0)).current;

  const startAnimations = useCallback(() => {
    // Entrance animation
    Animated.parallel([
      Animated.timing(fadeIn, { toValue: 1, duration: 800, useNativeDriver: true }),
      Animated.timing(slideUp, { toValue: 0, duration: 800, useNativeDriver: true }),
    ]).start();

    // Pulse for Google circle
    Animated.loop(Animated.sequence([
      Animated.timing(pulseAnim, { toValue: 1.05, duration: 1800, useNativeDriver: true }),
      Animated.timing(pulseAnim, { toValue: 1, duration: 1800, useNativeDriver: true }),
    ])).start();

    // Glow animation
    Animated.loop(Animated.sequence([
      Animated.timing(glowAnim, { toValue: 1, duration: 2200, useNativeDriver: false }),
      Animated.timing(glowAnim, { toValue: 0, duration: 2200, useNativeDriver: false }),
    ])).start();

    // Card float
    Animated.loop(Animated.sequence([
      Animated.timing(cardFloat, { toValue: -5, duration: 3000, useNativeDriver: true }),
      Animated.timing(cardFloat, { toValue: 0, duration: 3000, useNativeDriver: true }),
    ])).start();

    // Replit button pulse
    Animated.loop(Animated.sequence([
      Animated.timing(replitPulse, { toValue: 1.04, duration: 2000, useNativeDriver: true }),
      Animated.timing(replitPulse, { toValue: 1, duration: 2000, useNativeDriver: true }),
    ])).start();

    // Ripple rings
    const makeRing = (anim: Animated.Value, delay: number) =>
      Animated.loop(Animated.sequence([
        Animated.delay(delay),
        Animated.timing(anim, { toValue: 1, duration: 2400, useNativeDriver: false }),
        Animated.timing(anim, { toValue: 0, duration: 0, useNativeDriver: false }),
      ]));
    makeRing(ring1Anim, 0).start();
    makeRing(ring2Anim, 800).start();
    makeRing(ring3Anim, 1600).start();
  }, []);

  useEffect(() => { startAnimations(); }, [startAnimations]);

  useEffect(() => {
    if (hasHydrated && isAuthenticated) router.replace('/(tabs)');
  }, [isAuthenticated, hasHydrated]);

  useEffect(() => {
    if (!hasHydrated || isAuthenticated) return;
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      const hash = window.location.hash;
      if (hash.includes('access_token=')) {
        const params = new URLSearchParams(hash.slice(1));
        const token = params.get('access_token');
        if (token) {
          window.history.replaceState(null, '', window.location.pathname);
          completeGoogleAuth(token);
          return;
        }
      }
      const searchParams = new URLSearchParams(window.location.search);
      const replitToken = searchParams.get('replit_token');
      if (replitToken) {
        window.history.replaceState(null, '', window.location.pathname);
        completeReplitAuthByToken(replitToken);
        return;
      }
      // Note: Replit auto-login on startup is handled by AuthGuard in _layout.tsx.
      // Do NOT call checkReplitStatus() here — it would auto-login after explicit logout.
    }
  }, [hasHydrated]);

  useEffect(() => {
    if (Platform.OS === 'web') return;
    const handleUrl = ({ url }: { url: string }) => {
      if (url.includes('auth-callback')) {
        const parts = url.split('?');
        const params = new URLSearchParams(parts[1] || '');
        const token = params.get('token');
        if (token) completeReplitAuthByToken(token);
      }
    };
    const sub = Linking.addEventListener('url', handleUrl);
    return () => sub.remove();
  }, []);

  const completeAuth = (user: any, session_token: string) => {
    if (session_token) setApiAuthToken(session_token);
    if (user) {
      setUser(user, session_token || null);
      setUserRole(user.role || 'user');
    }
  };

  const completeGoogleAuth = async (accessToken: string) => {
    setLoading(true);
    setError(null);
    try {
      const url = new URL('/api/auth/google', getApiUrl());
      const res = await apiRequest('POST', url.toString(), { access_token: accessToken });
      const data = await res.json() as any;
      if (data.user && data.session_token && mountedRef.current) {
        completeAuth(data.user, data.session_token);
        router.replace('/(tabs)');
      } else {
        if (mountedRef.current) setError(ar ? 'فشل تسجيل الدخول بحساب Google' : 'Google sign-in failed');
      }
    } catch (err: any) {
      if (mountedRef.current) setError(err.message || (ar ? 'حدث خطأ' : 'An error occurred'));
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  };

  const completeReplitAuthByToken = async (sessionToken: string) => {
    setReplitLoading(true);
    setError(null);
    try {
      const url = new URL('/api/auth/replit-validate', getApiUrl());
      const res = await apiRequest('POST', url.toString(), { session_token: sessionToken });
      const data = await res.json() as any;
      if (data.user && mountedRef.current) {
        completeAuth(data.user, data.session_token || sessionToken);
        router.replace('/(tabs)');
      } else {
        if (mountedRef.current) setError(ar ? 'فشل التحقق من حساب Replit' : 'Replit authentication failed');
      }
    } catch (err: any) {
      if (mountedRef.current) setError(err.message || (ar ? 'حدث خطأ' : 'An error occurred'));
    } finally {
      if (mountedRef.current) setReplitLoading(false);
    }
  };

  const checkReplitStatus = async () => {
    try {
      const url = new URL('/api/auth/replit-status', getApiUrl());
      const res = await apiRequest('GET', url.toString());
      const data = await res.json() as any;
      if (data.authenticated && data.user && mountedRef.current) {
        completeAuth(data.user, data.session_token);
        router.replace('/(tabs)');
      }
    } catch {}
  };

  const handleReplitSignIn = async () => {
    setReplitLoading(true);
    setError(null);
    try {
      if (Platform.OS === 'web' && typeof window !== 'undefined') {
        // Step 1: Try direct headers auth (works in deployed Replit apps)
        try {
          const url = new URL('/api/auth/replit-login', getApiUrl());
          const res = await apiRequest('POST', url.toString(), {});
          const data = await res.json() as any;
          if (data.user && data.session_token && mountedRef.current) {
            completeAuth(data.user, data.session_token);
            router.replace('/(tabs)');
            return;
          }
        } catch {}
        // Step 2: Redirect to Replit's official auth flow
        // After the user authenticates, they return to the app root,
        // and checkReplitStatus() auto-detects the active Replit session
        const hostname = window.location.hostname;
        window.location.href = `https://replit.com/auth_with_repl_site?domain=${encodeURIComponent(hostname)}`;
      } else {
        // Native: use WebBrowser with server-side Replit auth redirect
        const baseUrl = getApiUrl();
        const callbackScheme = 'alghazaly://auth-callback';
        const authUrl = `${baseUrl}auth/replit-signin?mobile=1&redirect=${encodeURIComponent(callbackScheme)}`;
        const result = await WebBrowser.openAuthSessionAsync(authUrl, callbackScheme);
        if (result.type === 'success' && result.url) {
          const parts = result.url.split('?');
          const params = new URLSearchParams(parts[1] || '');
          const token = params.get('token');
          if (token) {
            await completeReplitAuthByToken(token);
            return;
          }
        }
        if (mountedRef.current && result.type !== 'cancel') {
          setError(ar ? 'تم إلغاء تسجيل الدخول بـ Replit' : 'Replit sign-in was cancelled');
        }
      }
    } catch (err: any) {
      if (mountedRef.current) setError(err.message || (ar ? 'حدث خطأ' : 'An error occurred'));
    } finally {
      if (mountedRef.current) setReplitLoading(false);
    }
  };

  const handleGoogleLogin = async () => {
    setLoading(true);
    setError(null);
    const oauthUrl = getGoogleOAuthUrl();
    if (!oauthUrl) {
      setLoading(false);
      setError(ar ? 'تسجيل الدخول بـ Google غير مفعّل بعد' : 'Google sign-in is not configured yet');
      return;
    }
    try {
      if (Platform.OS === 'web' && typeof window !== 'undefined') {
        window.location.href = oauthUrl;
        return;
      }
      const result = await WebBrowser.openAuthSessionAsync(oauthUrl, '');
      if (result.type === 'success' && result.url) {
        const url = new URL(result.url);
        const hash = url.hash || url.search;
        const params = new URLSearchParams(hash.startsWith('#') ? hash.slice(1) : hash.slice(1));
        const token = params.get('access_token');
        if (token) await completeGoogleAuth(token);
      }
    } catch (err: any) {
      if (mountedRef.current) setError(err.message || (ar ? 'حدث خطأ' : 'An error occurred'));
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  };

  const topPad = Platform.OS === 'web' ? 67 : insets.top;
  const botPad = Platform.OS === 'web' ? 34 : Math.max(insets.bottom, 16);

  // Ring interpolations
  const r1O = ring1Anim.interpolate({ inputRange: [0, 0.4, 1], outputRange: [0.7, 0.2, 0] });
  const r1S = ring1Anim.interpolate({ inputRange: [0, 1], outputRange: [1, 2.6] });
  const r2O = ring2Anim.interpolate({ inputRange: [0, 0.4, 1], outputRange: [0.5, 0.15, 0] });
  const r2S = ring2Anim.interpolate({ inputRange: [0, 1], outputRange: [1, 2.2] });
  const r3O = ring3Anim.interpolate({ inputRange: [0, 0.4, 1], outputRange: [0.4, 0.1, 0] });
  const r3S = ring3Anim.interpolate({ inputRange: [0, 1], outputRange: [1, 1.9] });
  const glowO = glowAnim.interpolate({ inputRange: [0, 1], outputRange: [0.2, 0.55] });

  const hasGoogle = !!process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID;

  return (
    <View style={styles.root}>
      {/* Luxury Dining 2026 — Midnight Bistro / Champagne Brunch backdrop */}
      <LinearGradient
        colors={isDark
          ? ['#0B0B0E', '#1C1C22', '#2A2218', '#0B0B0E']
          : ['#FBF6EC', '#F4ECDA', '#EFE6D6', '#FBF6EC']}
        style={StyleSheet.absoluteFill}
        locations={[0, 0.35, 0.7, 1]}
        start={{ x: 0.3, y: 0 }}
        end={{ x: 0.7, y: 1 }}
      />

      {/* Floating background orbs — gold + burgundy halos for the
          editorial restaurant identity (replaces the legacy blue/indigo). */}
      <FloatingOrb x={-60} y={SH * 0.05} size={220} color={isDark ? '#5A4520' : '#D4B062'} delay={0} />
      <FloatingOrb x={SW - 100} y={SH * 0.2} size={180} color={isDark ? '#3A1419' : '#E8D29A'} delay={1200} />
      <FloatingOrb x={SW * 0.3} y={SH * 0.7} size={160} color={isDark ? '#7A1F2B' : '#C8A24A'} delay={600} />
      <FloatingOrb x={-40} y={SH * 0.6} size={130} color={isDark ? '#4A5D3A' : '#A1B286'} delay={2000} />

      {/* Subtle grid overlay on web */}
      {Platform.OS === 'web' && (
        <View style={[StyleSheet.absoluteFill, { opacity: isDark ? 0.03 : 0.04 }]}>
          <View style={{ flex: 1, backgroundImage: 'linear-gradient(rgba(100,100,255,1) 1px, transparent 1px), linear-gradient(90deg, rgba(100,100,255,1) 1px, transparent 1px)', backgroundSize: '40px 40px' } as any} />
        </View>
      )}

      <Animated.View
        style={[
          styles.screen,
          { paddingTop: topPad, paddingBottom: botPad, opacity: fadeIn, transform: [{ translateY: slideUp }] },
        ]}
      >
        {/* ── TOP HEADER ── */}
        <View style={styles.header}>
          {/* Logo badge */}
          <View style={styles.logoBadge}>
            <LinearGradient
              colors={['#3A1419', '#7A1F2B', '#A98432']}
              style={styles.logoBadgeGradient}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
            >
              <Image source={{ uri: LOGO_URL }} style={styles.logoImg} contentFit="cover" cachePolicy="disk" />
            </LinearGradient>
            <Animated.View style={[styles.logoGlow, { opacity: glowO }]} />
          </View>

          {/* Store name */}
          <View style={styles.headerTextWrap}>
            <Text style={[styles.storeName, { color: isDark ? '#F7F2E9' : '#1B1B1F' }]}>
              {ar ? 'الغزالي' : 'Al-Ghazaly'}
            </Text>
            <Text style={[styles.storeSubtitle, { color: isDark ? '#D4B062' : '#876615' }]}>
              {ar ? 'تجربة طعام فاخرة' : 'Luxury Dining'}
            </Text>
          </View>

          {/* Replit Sign In — compact pill button */}
          <Animated.View style={{ transform: [{ scale: replitPulse }] }}>
            <TouchableOpacity
              onPress={handleReplitSignIn}
              disabled={replitLoading}
              activeOpacity={0.82}
              style={styles.replitPill}
            >
              <LinearGradient
                colors={['#A98432', '#C8A24A', '#D4B062']}
                style={styles.replitPillGradient}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
              >
                {replitLoading ? (
                  <ActivityIndicator size="small" color="#FFF" />
                ) : (
                  <>
                    <View style={styles.replitIconBox}>
                      <Text style={styles.replitIconLetter}>R</Text>
                    </View>
                    <Text style={styles.replitPillText}>{ar ? 'دخول' : 'Sign in'}</Text>
                    <Ionicons name={ar ? 'arrow-back' : 'arrow-forward'} size={12} color="rgba(255,255,255,0.85)" />
                  </>
                )}
              </LinearGradient>
            </TouchableOpacity>
          </Animated.View>
        </View>

        {/* ── MAIN CARD ── */}
        <Animated.View style={[styles.card, { transform: [{ translateY: cardFloat }] }]}>
          <LinearGradient
            colors={isDark
              ? ['rgba(255,255,255,0.055)', 'rgba(255,255,255,0.03)']
              : ['rgba(255,255,255,0.92)', 'rgba(255,255,255,0.75)']}
            style={styles.cardGradient}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
          >
            {/* Card top border glow — gold filament */}
            <View style={[styles.cardTopBorder, { backgroundColor: isDark ? 'rgba(212,176,98,0.55)' : 'rgba(169,132,50,0.45)' }]} />

            {/* Welcome text */}
            <Text style={[styles.welcomeTitle, { color: isDark ? '#F7F2E9' : '#1B1B1F' }]}>
              {ar ? 'مرحباً بك في تجربتنا' : 'A Seat at Our Table'}
            </Text>
            <Text style={[styles.welcomeSub, { color: isDark ? '#A89A82' : '#6B6358' }]}>
              {ar ? 'سجّل دخولك لتجربة طعام لا تُنسى' : 'Sign in for an unforgettable dining experience'}
            </Text>

            {/* ── Google Animated Button ── */}
            <View style={styles.googleSection}>
              <TouchableOpacity
                onPress={handleGoogleLogin}
                disabled={loading}
                activeOpacity={0.88}
                style={styles.googleOrbitWrap}
              >
                {/* Ripple rings */}
                <Animated.View style={[styles.ring, { opacity: r1O, transform: [{ scale: r1S }], borderColor: '#4285F4' }]} />
                <Animated.View style={[styles.ring, { opacity: r2O, transform: [{ scale: r2S }], borderColor: '#34A853' }]} />
                <Animated.View style={[styles.ring, { opacity: r3O, transform: [{ scale: r3S }], borderColor: '#FBBC05' }]} />

                {/* Glow */}
                <Animated.View style={[styles.googleGlow, { opacity: glowO }]} />

                {/* Main circle */}
                <Animated.View style={{ transform: [{ scale: pulseAnim }] }}>
                  <LinearGradient
                    colors={['#FFFFFF', '#F0F4FF', '#E8EFFF']}
                    style={styles.googleCircle}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                  >
                    {loading ? (
                      <ActivityIndicator size="large" color="#4285F4" />
                    ) : (
                      <View style={styles.googleInner}>
                        {/* Google G */}
                        <Text style={styles.googleG}>G</Text>
                        {/* Corner dots */}
                        <View style={[styles.dot, { backgroundColor: '#4285F4', top: 10, left: '50%', marginLeft: -4 }]} />
                        <View style={[styles.dot, { backgroundColor: '#EA4335', top: 10, right: 10 }]} />
                        <View style={[styles.dot, { backgroundColor: '#34A853', bottom: 10, right: 10 }]} />
                        <View style={[styles.dot, { backgroundColor: '#FBBC05', bottom: 10, left: 10 }]} />
                      </View>
                    )}
                  </LinearGradient>
                </Animated.View>
              </TouchableOpacity>

              <Text style={[styles.tapHint, { color: isDark ? '#475569' : '#94A3B8' }]}>
                {ar ? 'اضغط للدخول بـ Google' : 'Tap to sign in with Google'}
              </Text>
            </View>

            {/* ── Auth Buttons ── */}
            <View style={styles.buttonsWrap}>
              {/* Google pill */}
              <TouchableOpacity
                onPress={handleGoogleLogin}
                disabled={loading}
                activeOpacity={0.78}
                style={[styles.authBtn, {
                  backgroundColor: isDark ? 'rgba(66,133,244,0.1)' : 'rgba(66,133,244,0.07)',
                  borderColor: isDark ? 'rgba(66,133,244,0.35)' : 'rgba(66,133,244,0.25)',
                }]}
              >
                {loading ? (
                  <ActivityIndicator size="small" color="#4285F4" />
                ) : (
                  <>
                    <View style={styles.authBtnIconWrap}>
                      <View style={[styles.authBtnIconBg, { backgroundColor: '#FFF' }]}>
                        <Text style={[styles.googleMiniG, { color: '#4285F4' }]}>G</Text>
                      </View>
                    </View>
                    <Text style={[styles.authBtnText, { color: '#4285F4' }]}>
                      {ar ? 'متابعة بحساب Google' : 'Continue with Google'}
                    </Text>
                    <Ionicons name={ar ? 'chevron-back' : 'chevron-forward'} size={16} color="rgba(66,133,244,0.6)" />
                  </>
                )}
              </TouchableOpacity>

              {/* Replit pill — gold/burgundy luxury treatment */}
              <TouchableOpacity
                onPress={handleReplitSignIn}
                disabled={replitLoading}
                activeOpacity={0.78}
                style={[styles.authBtn, {
                  backgroundColor: isDark ? 'rgba(212,176,98,0.10)' : 'rgba(169,132,50,0.07)',
                  borderColor: isDark ? 'rgba(212,176,98,0.35)' : 'rgba(169,132,50,0.30)',
                }]}
              >
                {replitLoading ? (
                  <ActivityIndicator size="small" color="#A98432" />
                ) : (
                  <>
                    <View style={styles.authBtnIconWrap}>
                      <LinearGradient
                        colors={['#7A1F2B', '#A98432']}
                        style={styles.authBtnIconBg}
                        start={{ x: 0, y: 0 }}
                        end={{ x: 1, y: 1 }}
                      >
                        <Text style={[styles.googleMiniG, { color: '#FFF', fontWeight: '900' as const }]}>R</Text>
                      </LinearGradient>
                    </View>
                    <Text style={[styles.authBtnText, { color: isDark ? '#D4B062' : '#876615' }]}>
                      {ar ? 'متابعة بحساب Replit' : 'Continue with Replit'}
                    </Text>
                    <Ionicons name={ar ? 'chevron-back' : 'chevron-forward'} size={16} color={isDark ? 'rgba(212,176,98,0.7)' : 'rgba(135,102,21,0.65)'} />
                  </>
                )}
              </TouchableOpacity>

              {/* Divider */}
              <View style={styles.dividerRow}>
                <View style={[styles.dividerLine, { backgroundColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)' }]} />
                <Text style={[styles.dividerText, { color: isDark ? '#334155' : '#CBD5E1' }]}>
                  {ar ? 'أو' : 'or'}
                </Text>
                <View style={[styles.dividerLine, { backgroundColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)' }]} />
              </View>

              {/* Email/password */}
              <TouchableOpacity
                onPress={() => router.push('/auth/email' as any)}
                activeOpacity={0.78}
                style={[styles.authBtn, {
                  backgroundColor: isDark ? 'rgba(100,116,139,0.08)' : 'rgba(100,116,139,0.06)',
                  borderColor: isDark ? 'rgba(100,116,139,0.25)' : 'rgba(100,116,139,0.18)',
                }]}
              >
                <View style={styles.authBtnIconWrap}>
                  <View style={[styles.authBtnIconBg, { backgroundColor: isDark ? 'rgba(100,116,139,0.2)' : 'rgba(100,116,139,0.12)' }]}>
                    <Ionicons name="mail" size={14} color={isDark ? '#94A3B8' : '#64748B'} />
                  </View>
                </View>
                <Text style={[styles.authBtnText, { color: isDark ? '#94A3B8' : '#64748B' }]}>
                  {ar ? 'البريد الإلكتروني وكلمة السر' : 'Email & Password'}
                </Text>
                <Ionicons name={ar ? 'chevron-back' : 'chevron-forward'} size={16} color={isDark ? 'rgba(148,163,184,0.5)' : 'rgba(100,116,139,0.4)'} />
              </TouchableOpacity>
            </View>

            {/* Error */}
            {error ? (
              <View style={[styles.errorBox, {
                backgroundColor: isDark ? 'rgba(239,68,68,0.12)' : '#FEF2F2',
                borderColor: isDark ? 'rgba(239,68,68,0.3)' : '#FECACA',
              }]}>
                <Ionicons name="alert-circle" size={16} color="#EF4444" />
                <Text style={styles.errorText}>{error}</Text>
              </View>
            ) : null}
          </LinearGradient>
        </Animated.View>

        {/* ── FOOTER ── */}
        <View style={styles.footer}>
          <View style={styles.footerBadge}>
            <Ionicons name="shield-checkmark" size={12} color={isDark ? '#475569' : '#94A3B8'} />
            <Text style={[styles.footerSecure, { color: isDark ? '#475569' : '#94A3B8' }]}>
              {ar ? 'تسجيل دخول آمن ومشفر' : 'Secure & encrypted login'}
            </Text>
          </View>
          <Text style={[styles.footerCopy, { color: isDark ? '#1E293B' : '#E2E8F0' }]}>
            © 2026 Al-Ghazaly Luxury Dining
          </Text>
        </View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, overflow: 'hidden', backgroundColor: '#0B0B0E' },
  screen: {
    flex: 1,
    paddingHorizontal: 20,
    justifyContent: 'space-between',
    alignItems: 'center',
  },

  // Header
  header: {
    width: '100%',
    maxWidth: 420,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingTop: 3,
  },
  logoBadge: { position: 'relative' },
  logoBadgeGradient: {
    width: 56,
    height: 59,
    borderRadius: 16,
    padding: 3,
    shadowColor: '#A98432',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.45,
    shadowRadius: 16,
    elevation: 12,
  },
  logoImg: { width: '100%', height: '100%', borderRadius: 13 },
  logoGlow: {
    position: 'absolute',
    bottom: -6,
    left: '50%',
    width: 36,
    height: 14,
    borderRadius: 20,
    backgroundColor: '#D4B062',
    marginLeft: -18,
    ...Platform.select({ web: { filter: 'blur(8px)' } as any, default: {} }),
  },
  headerTextWrap: { flex: 1 },
  storeName: {
    fontSize: 19,
    fontWeight: '800',
    letterSpacing: -0.3,
    fontFamily: Platform.select({ ios: 'Cochin', android: 'serif', default: 'serif' }),
  },
  storeSubtitle: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 2.2,
    textTransform: 'uppercase',
    marginTop: 2,
  },

  // Replit compact pill
  replitPill: {
    borderRadius: 22,
    overflow: 'hidden',
    shadowColor: '#A98432',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.45,
    shadowRadius: 12,
    elevation: 8,
  },
  replitPillGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 10,
    minWidth: 96,
    justifyContent: 'center',
  },
  replitIconBox: {
    width: 20,
    height: 20,
    borderRadius: 6,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  replitIconLetter: { fontSize: 12, fontWeight: '900', color: '#FFF' },
  replitPillText: { fontSize: 12, fontWeight: '700', color: '#FFF', letterSpacing: 0.2 },

  // Main card
  card: {
    width: '100%',
    maxWidth: 420,
    borderRadius: 28,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 20 },
    shadowOpacity: 0.25,
    shadowRadius: 40,
    elevation: 20,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  cardGradient: { padding: 13 },
  cardTopBorder: { height: 2, borderRadius: 2, marginBottom: 14 },

  welcomeTitle: {
    fontSize: 28,
    fontWeight: '700',
    letterSpacing: -0.2,
    marginBottom: 8,
    textAlign: 'center',
    fontFamily: Platform.select({ ios: 'Cochin', android: 'serif', default: 'serif' }),
  },
  welcomeSub: { fontSize: 14, textAlign: 'center', marginBottom: 32, letterSpacing: 0.2 },

  // Google orbit button
  googleSection: { alignItems: 'center', marginBottom: 18 },
  googleOrbitWrap: {
    width: 120,
    height: 110,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
    marginBottom: 14,
  },
  ring: {
    position: 'absolute',
    width: 120,
    height: 120,
    borderRadius: 60,
    borderWidth: 1.5,
  },
  googleGlow: {
    position: 'absolute',
    width: 120,
    height: 110,
    borderRadius: 60,
    backgroundColor: '#4285F4',
    ...Platform.select({ web: { filter: 'blur(22px)' } as any, default: {} }),
  },
  googleCircle: {
    width: 104,
    height: 104,
    borderRadius: 52,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#4285F4',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.35,
    shadowRadius: 16,
    elevation: 12,
  },
  googleInner: {
    width: 170,
    height: 150,
    borderRadius: 52,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  googleG: {
    fontSize: 50,
    fontWeight: '800',
    color: '#4285F4',
    letterSpacing: -1,
  },
  dot: {
    position: 'absolute',
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  tapHint: { fontSize: 12, fontWeight: '500', letterSpacing: 0.2 },

  // Auth buttons
  buttonsWrap: { gap: 5 },
  authBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 11,
    borderRadius: 16,
    borderWidth: 1.9,
  },
  authBtnIconWrap: {},
  authBtnIconBg: {
    width: 19,
    height: 19,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  googleMiniG: { fontSize: 15, fontWeight: '800' },
  authBtnText: { flex: 1, fontSize: 14, fontWeight: '600', letterSpacing: 0.1 },

  // Divider
  dividerRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginVertical: 2 },
  dividerLine: { flex: 1, height: 1 },
  dividerText: { fontSize: 12, fontWeight: '500' },

  // Error
  errorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginTop: 7,
    padding: 7,
    borderRadius: 12,
    borderWidth: 1,
  },
  errorText: { flex: 1, fontSize: 13, color: '#EF4444', fontWeight: '500' },

  // Footer
  footer: { width: '100%', alignItems: 'center', gap: 5, paddingTop: 9 },
  footerBadge: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  footerSecure: { fontSize: 12, fontWeight: '500' },
  footerCopy: { fontSize: 11 },
});
