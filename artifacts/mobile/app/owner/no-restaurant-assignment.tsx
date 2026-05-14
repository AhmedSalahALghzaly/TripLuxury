import React, { useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, StatusBar, ActivityIndicator,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQueryClient } from '@tanstack/react-query';
import { useAppStore } from '../../src/store/appStore';
import { useTheme } from '../../src/hooks/useTheme';
import { haptic } from '../../src/services/hapticService';

export default function NoRestaurantAssignment() {
  const insets = useSafeAreaInsets();
  const { isDark } = useTheme();
  const language = useAppStore((s) => s.language);
  const user = useAppStore((s) => s.user);
  const isRTL = language === 'ar';
  const qc = useQueryClient();
  const [checking, setChecking] = useState(false);

  async function handleCheckAgain() {
    haptic.tap();
    setChecking(true);
    await qc.invalidateQueries({ queryKey: ['my-restaurant-assignments', user?.id] });
    setChecking(false);
  }

  const bg = isDark ? '#05050A' : '#F8F7F2';
  const textColor = isDark ? '#FFFFFF' : '#1A1A2E';
  const mutedColor = isDark ? 'rgba(255,255,255,0.55)' : 'rgba(30,30,60,0.55)';
  const cardBg = isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)';
  const borderColor = isDark ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.08)';

  return (
    <View style={[styles.root, { backgroundColor: bg }]}>
      <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} />

      {isDark && (
        <LinearGradient
          colors={['#050508', '#090914', '#0D0D1A']}
          style={StyleSheet.absoluteFill}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
        />
      )}

      {/* Decorative glow */}
      <View style={[styles.glowOrb, {
        backgroundColor: isDark ? 'rgba(180,83,9,0.08)' : 'rgba(180,83,9,0.05)',
      }]} />

      {/* Main content */}
      <View style={styles.content}>
        {/* Icon circle */}
        <View style={[styles.iconCircle, { backgroundColor: cardBg, borderColor }]}>
          <LinearGradient
            colors={['rgba(180,83,9,0.18)', 'rgba(120,53,15,0.10)']}
            style={styles.iconCircleGrad}
          >
            <Ionicons name="storefront-outline" size={52} color="#B45309" />
          </LinearGradient>
        </View>

        {/* Pending badge */}
        <View style={[styles.badge, { backgroundColor: 'rgba(180,83,9,0.12)', borderColor: 'rgba(180,83,9,0.30)' }]}>
          <Ionicons name="time-outline" size={13} color="#B45309" />
          <Text style={[styles.badgeText, { color: '#B45309' }]}>
            {isRTL ? 'قيد الانتظار' : 'Pending Assignment'}
          </Text>
        </View>

        {/* Headline */}
        <Text style={[styles.title, { color: textColor }, isRTL && styles.textRTL]}>
          {isRTL
            ? 'لم يتم تعيينك بعد'
            : 'No Restaurant Assigned Yet'}
        </Text>

        {/* Subtitle */}
        <Text style={[styles.subtitle, { color: mutedColor }, isRTL && styles.textRTL]}>
          {isRTL
            ? 'لم يتم ربط حسابك بأي مطعم بعد. يرجى التواصل مع صاحب العمل لإتمام التعيين.'
            : 'Your account has not been assigned to a restaurant yet. Contact the owner to get access.'}
        </Text>

        {/* Info card */}
        <View style={[styles.infoCard, { backgroundColor: cardBg, borderColor }]}>
          {[
            {
              icon: 'person-outline' as const,
              en: 'Your account is set up and ready',
              ar: 'حسابك مُعدّ وجاهز',
            },
            {
              icon: 'link-outline' as const,
              en: 'Waiting for the owner to link a restaurant',
              ar: 'بانتظار ربط المطعم من قِبل المالك',
            },
            {
              icon: 'refresh-outline' as const,
              en: 'Pull down on any screen to refresh',
              ar: 'اسحب للأسفل في أي شاشة لتحديث الصفحة',
            },
          ].map((item, i) => (
            <View key={i} style={[styles.infoRow, isRTL && styles.infoRowRTL]}>
              <View style={styles.infoIconWrap}>
                <Ionicons name={item.icon} size={16} color="#B45309" />
              </View>
              <Text style={[styles.infoText, { color: mutedColor }]}>
                {isRTL ? item.ar : item.en}
              </Text>
            </View>
          ))}
        </View>

        {/* Check again — invalidates the assignments query so the layout
             re-evaluates and transitions to the storefront view if the
             owner has assigned a restaurant in the meantime */}
        <TouchableOpacity
          style={styles.homeBtn}
          onPress={handleCheckAgain}
          activeOpacity={0.8}
          disabled={checking}
        >
          <LinearGradient colors={['#B45309', '#78350F']} style={styles.homeBtnGrad}>
            {checking
              ? <ActivityIndicator size="small" color="#FFD700" />
              : <Ionicons name="refresh-outline" size={18} color="#FFD700" />}
            <Text style={styles.homeBtnText}>
              {isRTL ? 'تحقق مجددًا' : 'Check Again'}
            </Text>
          </LinearGradient>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  glowOrb: {
    position: 'absolute',
    top: -100,
    right: -80,
    width: 300,
    height: 300,
    borderRadius: 150,
  },
  content: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 28,
    paddingBottom: 40,
    gap: 16,
  },
  iconCircle: {
    width: 110, height: 110,
    borderRadius: 55,
    borderWidth: 1.5,
    overflow: 'hidden',
    marginBottom: 4,
  },
  iconCircleGrad: {
    flex: 1,
    alignItems: 'center', justifyContent: 'center',
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 20,
    borderWidth: 1,
  },
  badgeText: {
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.3,
  },
  title: {
    fontSize: 24,
    fontWeight: '800',
    textAlign: 'center',
    letterSpacing: -0.3,
    marginTop: 4,
  },
  subtitle: {
    fontSize: 15,
    textAlign: 'center',
    lineHeight: 22,
  },
  textRTL: { textAlign: 'right' },
  infoCard: {
    width: '100%',
    borderRadius: 16,
    borderWidth: 1,
    paddingVertical: 16,
    paddingHorizontal: 18,
    gap: 14,
    marginTop: 4,
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  infoRowRTL: { flexDirection: 'row-reverse' },
  infoIconWrap: {
    width: 28, height: 28,
    borderRadius: 14,
    backgroundColor: 'rgba(180,83,9,0.12)',
    alignItems: 'center', justifyContent: 'center',
    flexShrink: 0,
    marginTop: 1,
  },
  infoText: { fontSize: 13.5, lineHeight: 20, flex: 1 },
  homeBtn: {
    width: '100%',
    borderRadius: 14,
    overflow: 'hidden',
    marginTop: 8,
  },
  homeBtnGrad: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
    paddingHorizontal: 24,
  },
  homeBtnText: {
    color: '#FFD700',
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
});
