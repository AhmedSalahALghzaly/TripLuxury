/**
 * Settings Screen for Owner Interface
 */
import React from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Switch } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { BlurView } from 'expo-blur';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useAppStore, COLOR_MOODS } from '../../src/store/appStore';

import { AccessGuard as __AccessGuard__ } from '../../src/components/AccessGuard';
function SettingsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const language = useAppStore((state) => state.language);
  const currentMood = useAppStore((state) => state.currentMood);
  const setColorMood = useAppStore((state) => state.setColorMood);
  const theme = useAppStore((state) => state.theme);
  const setTheme = useAppStore((state) => state.setTheme);
  const isRTL = language === 'ar';

  return (
    <View style={styles.container}>
      <LinearGradient colors={['#374151', '#4B5563', '#6B7280']} style={StyleSheet.absoluteFill} />
      <ScrollView style={styles.scrollView} contentContainerStyle={[styles.scrollContent, { paddingTop: insets.top }]}>
        <View style={[styles.header, isRTL && styles.headerRTL]}>
          <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
            <Ionicons name={isRTL ? 'arrow-forward' : 'arrow-back'} size={24} color="#FFF" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>{isRTL ? 'الإعدادات' : 'Settings'}</Text>
        </View>

        {/* Theme Section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{isRTL ? 'المظهر' : 'Appearance'}</Text>
          <View style={styles.settingRow}>
            <BlurView intensity={15} tint="light" style={styles.settingBlur}>
              <Ionicons name={theme === 'dark' ? 'moon' : 'sunny'} size={24} color="#FFF" />
              <Text style={styles.settingLabel}>{isRTL ? 'الوضع الليلي' : 'Dark Mode'}</Text>
              <Switch
                value={theme === 'dark'}
                onValueChange={(val) => setTheme(val ? 'dark' : 'light')}
                trackColor={{ false: 'rgba(255,255,255,0.3)', true: '#8B5CF6' }}
                thumbColor="#FFF"
              />
            </BlurView>
          </View>
        </View>

        {/* Color Mood Section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{isRTL ? 'مزاج الألوان' : 'Color Mood'}</Text>
          <View style={styles.moodGrid}>
            {COLOR_MOODS.map((mood) => (
              <TouchableOpacity
                key={mood.id}
                style={[
                  styles.moodCard,
                  currentMood.id === mood.id && styles.moodCardActive,
                ]}
                onPress={() => setColorMood(mood)}
              >
                <LinearGradient
                  colors={mood.gradient as [string, string, string]}
                  style={styles.moodGradient}
                />
                <Text style={styles.moodName}>{mood.name}</Text>
                {currentMood.id === mood.id && (
                  <Ionicons name="checkmark-circle" size={20} color="#10B981" style={styles.moodCheck} />
                )}
              </TouchableOpacity>
            ))}
          </View>
        </View>

        <View style={{ height: insets.bottom + 40 }} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scrollView: { flex: 1 },
  scrollContent: { paddingHorizontal: 16 },
  header: { flexDirection: 'row', alignItems: 'center', paddingVertical: 16, gap: 12 },
  headerRTL: { flexDirection: 'row-reverse' },
  backButton: { width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.15)', alignItems: 'center', justifyContent: 'center' },
  headerTitle: { flex: 1, fontSize: 24, fontWeight: '700', color: '#FFF' },
  section: { marginTop: 24 },
  sectionTitle: { fontSize: 16, fontWeight: '600', color: 'rgba(255,255,255,0.7)', marginBottom: 12 },
  settingRow: { borderRadius: 12, overflow: 'hidden' },
  settingBlur: { flexDirection: 'row', alignItems: 'center', padding: 16, backgroundColor: 'rgba(255,255,255,0.1)', gap: 12 },
  settingLabel: { flex: 1, fontSize: 16, color: '#FFF' },
  moodGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  moodCard: { width: '30%', aspectRatio: 1, borderRadius: 12, overflow: 'hidden', borderWidth: 2, borderColor: 'transparent' },
  moodCardActive: { borderColor: '#10B981' },
  moodGradient: { flex: 1 },
  moodName: { position: 'absolute', bottom: 8, left: 0, right: 0, textAlign: 'center', fontSize: 10, fontWeight: '600', color: '#FFF', textShadowColor: 'rgba(0,0,0,0.5)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 2 },
  moodCheck: { position: 'absolute', top: 8, right: 8 },
});


/* __ACCESS_GUARD_APPLIED__ */
export default function SettingsScreenGuarded(props: any) {
  return (
    <__AccessGuard__ scope="owner">
      <SettingsScreen {...props} />
    </__AccessGuard__>
  );
}
