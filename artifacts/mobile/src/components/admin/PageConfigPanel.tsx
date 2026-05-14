/**
 * Reusable Page Config Panel — extracted from admin/car-brands.tsx
 * so admin/models.tsx (Restaurants page = brand_page_config) and
 * admin/product-brands.tsx (Brands page = brands_page_config) can mount it
 * as a tab without duplicating ~250 lines of preview/form/state plumbing.
 */
import React, { memo, useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Image,
  useWindowDimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ImageUploader } from '../ui/ImageUploader';
import { api } from '../../services/api';

// ─── Types ───────────────────────────────────────────────────────────────────
export type PreviewIconName = 'restaurant' | 'briefcase';

export interface PageConfigShape {
  bg_image?: string;
  title_en?: string;
  title_ar?: string;
  subtitle_en?: string;
  subtitle_ar?: string;
  count_label_en?: string;
  count_label_ar?: string;
  cta_label_en?: string;
  cta_label_ar?: string;
}

export interface PageConfigDefaults extends PageConfigShape {}

interface PageHeaderPreviewProps {
  bgImage: string;
  titleEn: string;
  titleAr: string;
  subtitleEn: string;
  subtitleAr: string;
  language: string;
  colors: any;
  iconName?: PreviewIconName;
  focusedField?: 'title' | 'subtitle' | null;
}

const PageHeaderPreview = memo(({
  bgImage, titleEn, titleAr, subtitleEn, subtitleAr,
  language, colors, iconName = 'restaurant', focusedField,
}: PageHeaderPreviewProps) => {
  const [previewLang, setPreviewLang] = useState<'en' | 'ar'>(language === 'ar' ? 'ar' : 'en');
  useEffect(() => { setPreviewLang(language === 'ar' ? 'ar' : 'en'); }, [language]);
  const title = previewLang === 'ar' ? (titleAr || titleEn || '…') : (titleEn || titleAr || '…');
  const subtitle = previewLang === 'ar' ? (subtitleAr || subtitleEn || '') : (subtitleEn || subtitleAr || '');
  return (
    <View style={[previewStyles.wrapper, { borderColor: colors.border, backgroundColor: colors.card }]}>
      <View style={previewStyles.labelRow}>
        <Text style={[previewStyles.label, { color: colors.textSecondary }]}>
          {language === 'ar' ? 'معاينة مباشرة' : 'Live Preview'}
        </Text>
        <View style={previewStyles.langToggle}>
          <TouchableOpacity
            style={[previewStyles.langBtn, previewLang === 'en' && { backgroundColor: colors.primary }]}
            onPress={() => setPreviewLang('en')}
          >
            <Text style={[previewStyles.langBtnText, previewLang === 'en' && previewStyles.langBtnTextActive]}>EN</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[previewStyles.langBtn, previewLang === 'ar' && { backgroundColor: colors.primary }]}
            onPress={() => setPreviewLang('ar')}
          >
            <Text style={[previewStyles.langBtnText, previewLang === 'ar' && previewStyles.langBtnTextActive]}>AR</Text>
          </TouchableOpacity>
        </View>
      </View>
      <View style={[previewStyles.header, { backgroundColor: bgImage ? undefined : colors.primary }]}>
        {bgImage ? (
          <Image source={{ uri: bgImage }} style={StyleSheet.absoluteFill} resizeMode="cover" />
        ) : null}
        {bgImage ? <View style={[StyleSheet.absoluteFill, previewStyles.overlay]} /> : null}
        <View style={previewStyles.iconCircle}>
          <Ionicons name={iconName} size={20} color="#FFF" />
        </View>
        <View style={focusedField === 'title' ? previewStyles.fieldHighlight : undefined}>
          <Text style={previewStyles.previewTitle} numberOfLines={1}>{title}</Text>
        </View>
        {subtitle ? (
          <View style={focusedField === 'subtitle' ? previewStyles.fieldHighlight : undefined}>
            <Text style={previewStyles.previewSubtitle} numberOfLines={2}>{subtitle}</Text>
          </View>
        ) : null}
      </View>
    </View>
  );
});
PageHeaderPreview.displayName = 'PageHeaderPreview';

// ─── usePageConfig hook ──────────────────────────────────────────────────────
export function usePageConfig(settingKey: string, defaults: PageConfigDefaults = {}) {
  const queryClient = useQueryClient();

  const [bgImage, setBgImage] = useState(defaults.bg_image ?? '');
  const [titleEn, setTitleEn] = useState(defaults.title_en ?? '');
  const [titleAr, setTitleAr] = useState(defaults.title_ar ?? '');
  const [subtitleEn, setSubtitleEn] = useState(defaults.subtitle_en ?? '');
  const [subtitleAr, setSubtitleAr] = useState(defaults.subtitle_ar ?? '');
  const [countLabelEn, setCountLabelEn] = useState(defaults.count_label_en ?? '');
  const [countLabelAr, setCountLabelAr] = useState(defaults.count_label_ar ?? '');
  const [ctaLabelEn, setCtaLabelEn] = useState(defaults.cta_label_en ?? '');
  const [ctaLabelAr, setCtaLabelAr] = useState(defaults.cta_label_ar ?? '');
  const [saving, setSaving] = useState(false);

  const { data: cfg, isLoading } = useQuery({
    queryKey: ['setting', settingKey],
    queryFn: async () => {
      try {
        const res = await api.get(`/admin/settings/${settingKey}`);
        return res.data?.value as PageConfigShape | null;
      } catch { return null; }
    },
    staleTime: 5 * 60 * 1000,
    retry: false,
  });

  useEffect(() => {
    if (!cfg) return;
    if (cfg.bg_image !== undefined) setBgImage(cfg.bg_image);
    if (cfg.title_en !== undefined) setTitleEn(cfg.title_en);
    if (cfg.title_ar !== undefined) setTitleAr(cfg.title_ar);
    if (cfg.subtitle_en !== undefined) setSubtitleEn(cfg.subtitle_en);
    if (cfg.subtitle_ar !== undefined) setSubtitleAr(cfg.subtitle_ar);
    if (cfg.count_label_en !== undefined) setCountLabelEn(cfg.count_label_en);
    if (cfg.count_label_ar !== undefined) setCountLabelAr(cfg.count_label_ar);
    if (cfg.cta_label_en !== undefined) setCtaLabelEn(cfg.cta_label_en);
    if (cfg.cta_label_ar !== undefined) setCtaLabelAr(cfg.cta_label_ar);
  }, [cfg]);

  const isDirty = useMemo(() => {
    if (!cfg) return false;
    return bgImage !== (cfg.bg_image ?? '')
      || titleEn !== (cfg.title_en ?? '')
      || titleAr !== (cfg.title_ar ?? '')
      || subtitleEn !== (cfg.subtitle_en ?? '')
      || subtitleAr !== (cfg.subtitle_ar ?? '')
      || countLabelEn !== (cfg.count_label_en ?? '')
      || countLabelAr !== (cfg.count_label_ar ?? '')
      || ctaLabelEn !== (cfg.cta_label_en ?? '')
      || ctaLabelAr !== (cfg.cta_label_ar ?? '');
  }, [cfg, bgImage, titleEn, titleAr, subtitleEn, subtitleAr, countLabelEn, countLabelAr, ctaLabelEn, ctaLabelAr]);

  const save = useCallback(
    async (
      includeOptional: boolean,
      onSuccess?: () => void,
      onError?: (err: unknown) => void,
    ) => {
      setSaving(true);
      try {
        const value: Record<string, string> = {
          bg_image: bgImage,
          title_en: titleEn,
          title_ar: titleAr,
          subtitle_en: subtitleEn,
          subtitle_ar: subtitleAr,
        };
        if (includeOptional) {
          value.count_label_en = countLabelEn;
          value.count_label_ar = countLabelAr;
          value.cta_label_en = ctaLabelEn;
          value.cta_label_ar = ctaLabelAr;
        }
        await api.put(`/admin/settings/${settingKey}`, { value });
        queryClient.invalidateQueries({ queryKey: ['setting', settingKey] });
        onSuccess?.();
      } catch (err) {
        onError?.(err);
      } finally {
        setSaving(false);
      }
    },
    [settingKey, queryClient, bgImage, titleEn, titleAr, subtitleEn, subtitleAr,
      countLabelEn, countLabelAr, ctaLabelEn, ctaLabelAr],
  );

  return {
    state: { bgImage, titleEn, titleAr, subtitleEn, subtitleAr,
      countLabelEn, countLabelAr, ctaLabelEn, ctaLabelAr, saving, isDirty, isLoading },
    setters: { setBgImage, setTitleEn, setTitleAr, setSubtitleEn, setSubtitleAr,
      setCountLabelEn, setCountLabelAr, setCtaLabelEn, setCtaLabelAr },
    save,
  };
}

// ─── PageConfigPanel ─────────────────────────────────────────────────────────
export interface PageConfigPanelProps {
  bgImage: string;
  setBgImage: (v: string) => void;
  titleEn: string;
  setTitleEn: (v: string) => void;
  titleAr: string;
  setTitleAr: (v: string) => void;
  subtitleEn: string;
  setSubtitleEn: (v: string) => void;
  subtitleAr: string;
  setSubtitleAr: (v: string) => void;
  countLabelEn?: string;
  setCountLabelEn?: (v: string) => void;
  countLabelAr?: string;
  setCountLabelAr?: (v: string) => void;
  ctaLabelEn?: string;
  setCtaLabelEn?: (v: string) => void;
  ctaLabelAr?: string;
  setCtaLabelAr?: (v: string) => void;
  onSave: () => void;
  saving: boolean;
  isDirty: boolean;
  colors: any;
  language: string;
  isRTL: boolean;
  sectionTitle: string;
  previewIcon?: PreviewIconName;
}

export const PageConfigPanel = memo(({
  bgImage, setBgImage,
  titleEn, setTitleEn,
  titleAr, setTitleAr,
  subtitleEn, setSubtitleEn,
  subtitleAr, setSubtitleAr,
  countLabelEn, setCountLabelEn,
  countLabelAr, setCountLabelAr,
  ctaLabelEn, setCtaLabelEn,
  ctaLabelAr, setCtaLabelAr,
  onSave, saving, isDirty,
  colors, language, isRTL,
  sectionTitle, previewIcon,
}: PageConfigPanelProps) => {
  const [focusedField, setFocusedField] = useState<'title' | 'subtitle' | null>(null);
  const { width } = useWindowDimensions();
  const isWide = width > 600;
  const previewColWidth = Math.min(340, Math.max(260, width * 0.35));

  const previewNode = (
    <PageHeaderPreview
      bgImage={bgImage}
      titleEn={titleEn}
      titleAr={titleAr}
      subtitleEn={subtitleEn}
      subtitleAr={subtitleAr}
      language={language}
      colors={colors}
      iconName={previewIcon}
      focusedField={focusedField}
    />
  );

  const formCards = (
    <>
      <View style={[cfgStyles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <Text style={[cfgStyles.cardLabel, { color: colors.textSecondary }]}>
          {language === 'ar' ? 'صورة الخلفية' : 'Background Image'}
        </Text>
        <ImageUploader
          mode="single"
          value={bgImage}
          onChange={(v) => setBgImage(v as string)}
          size="large"
          aspectRatio={[16, 9]}
          shape="rounded"
          hint={language === 'ar' ? 'اختر صورة خلفية (نسبة 16:9)' : 'Pick a background image (16:9 ratio)'}
        />
      </View>

      <View style={[cfgStyles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <Text style={[cfgStyles.cardHeading, { color: colors.text }]}>
          {language === 'ar' ? 'العنوان' : 'Title'}
        </Text>
        <Text style={[cfgStyles.label, { color: colors.textSecondary }]}>
          {language === 'ar' ? 'بالإنجليزية' : 'English'}
        </Text>
        <TextInput
          style={[cfgStyles.input, { backgroundColor: colors.surface, borderColor: colors.border, color: colors.text }]}
          value={titleEn}
          onChangeText={setTitleEn}
          placeholder="e.g., Cuisines"
          placeholderTextColor={colors.textSecondary}
          onFocus={() => setFocusedField('title')}
          onBlur={() => setFocusedField(null)}
        />
        <Text style={[cfgStyles.label, { color: colors.textSecondary, marginTop: 12 }]}>
          {language === 'ar' ? 'بالعربية' : 'Arabic'}
        </Text>
        <TextInput
          style={[cfgStyles.input, { backgroundColor: colors.surface, borderColor: colors.border, color: colors.text }, isRTL && { textAlign: 'right' }]}
          value={titleAr}
          onChangeText={setTitleAr}
          placeholder="مثال: المأكولات"
          placeholderTextColor={colors.textSecondary}
          onFocus={() => setFocusedField('title')}
          onBlur={() => setFocusedField(null)}
        />
      </View>

      <View style={[cfgStyles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <Text style={[cfgStyles.cardHeading, { color: colors.text }]}>
          {language === 'ar' ? 'الوصف' : 'Subtitle'}
        </Text>
        <Text style={[cfgStyles.label, { color: colors.textSecondary }]}>
          {language === 'ar' ? 'بالإنجليزية' : 'English'}
        </Text>
        <TextInput
          style={[cfgStyles.input, cfgStyles.multiline, { backgroundColor: colors.surface, borderColor: colors.border, color: colors.text }]}
          value={subtitleEn}
          onChangeText={setSubtitleEn}
          placeholder="e.g., Discover our finest cuisines"
          placeholderTextColor={colors.textSecondary}
          multiline
          numberOfLines={3}
          textAlignVertical="top"
          onFocus={() => setFocusedField('subtitle')}
          onBlur={() => setFocusedField(null)}
        />
        <Text style={[cfgStyles.label, { color: colors.textSecondary, marginTop: 12 }]}>
          {language === 'ar' ? 'بالعربية' : 'Arabic'}
        </Text>
        <TextInput
          style={[cfgStyles.input, cfgStyles.multiline, { backgroundColor: colors.surface, borderColor: colors.border, color: colors.text }, isRTL && { textAlign: 'right' }]}
          value={subtitleAr}
          onChangeText={setSubtitleAr}
          placeholder="مثال: اكتشف أرقى المأكولات"
          placeholderTextColor={colors.textSecondary}
          multiline
          numberOfLines={3}
          textAlignVertical="top"
          onFocus={() => setFocusedField('subtitle')}
          onBlur={() => setFocusedField(null)}
        />
      </View>

      {setCountLabelEn && setCountLabelAr && (
        <View style={[cfgStyles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[cfgStyles.cardHeading, { color: colors.text }]}>
            {language === 'ar' ? 'تسمية عدد المطاعم' : 'Restaurants Count Label'}
          </Text>
          <Text style={[cfgStyles.label, { color: colors.textSecondary }]}>
            {language === 'ar' ? 'بالإنجليزية' : 'English'}
          </Text>
          <TextInput
            style={[cfgStyles.input, { backgroundColor: colors.surface, borderColor: colors.border, color: colors.text }]}
            value={countLabelEn}
            onChangeText={setCountLabelEn}
            placeholder="e.g., Restaurant"
            placeholderTextColor={colors.textSecondary}
          />
          <Text style={[cfgStyles.label, { color: colors.textSecondary, marginTop: 12 }]}>
            {language === 'ar' ? 'بالعربية' : 'Arabic'}
          </Text>
          <TextInput
            style={[cfgStyles.input, { backgroundColor: colors.surface, borderColor: colors.border, color: colors.text }, isRTL && { textAlign: 'right' }]}
            value={countLabelAr}
            onChangeText={setCountLabelAr}
            placeholder="مثال: مطعم"
            placeholderTextColor={colors.textSecondary}
          />
        </View>
      )}

      {setCtaLabelEn && setCtaLabelAr && (
        <View style={[cfgStyles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[cfgStyles.cardHeading, { color: colors.text }]}>
            {language === 'ar' ? 'نص زر الاستعراض' : 'CTA Button Label'}
          </Text>
          <Text style={[cfgStyles.label, { color: colors.textSecondary }]}>
            {language === 'ar' ? 'بالإنجليزية' : 'English'}
          </Text>
          <TextInput
            style={[cfgStyles.input, { backgroundColor: colors.surface, borderColor: colors.border, color: colors.text }]}
            value={ctaLabelEn}
            onChangeText={setCtaLabelEn}
            placeholder="e.g., View menu"
            placeholderTextColor={colors.textSecondary}
          />
          <Text style={[cfgStyles.label, { color: colors.textSecondary, marginTop: 12 }]}>
            {language === 'ar' ? 'بالعربية' : 'Arabic'}
          </Text>
          <TextInput
            style={[cfgStyles.input, { backgroundColor: colors.surface, borderColor: colors.border, color: colors.text }, isRTL && { textAlign: 'right' }]}
            value={ctaLabelAr}
            onChangeText={setCtaLabelAr}
            placeholder="مثال: استعرض القائمة"
            placeholderTextColor={colors.textSecondary}
          />
        </View>
      )}

      <TouchableOpacity
        style={[cfgStyles.saveBtn, { backgroundColor: colors.primary, opacity: saving ? 0.7 : 1 }]}
        onPress={onSave}
        disabled={saving}
      >
        {saving ? (
          <ActivityIndicator color="#FFF" />
        ) : (
          <>
            <Ionicons name="save" size={18} color="#FFF" />
            <Text style={cfgStyles.saveBtnText}>
              {language === 'ar' ? 'حفظ الإعدادات' : 'Save Settings'}
            </Text>
            {isDirty && (
              <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: '#FFA500', marginLeft: 4 }} />
            )}
          </>
        )}
      </TouchableOpacity>
    </>
  );

  if (isWide) {
    return (
      <View style={cfgStyles.splitRow}>
        <ScrollView
          style={cfgStyles.splitLeft}
          contentContainerStyle={cfgStyles.splitLeftContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          nestedScrollEnabled
        >
          <Text style={[cfgStyles.sectionTitle, { color: colors.text }]}>{sectionTitle}</Text>
          {formCards}
        </ScrollView>
        <View style={[cfgStyles.splitRight, { borderLeftColor: colors.border, width: previewColWidth }]}>
          <Text style={[cfgStyles.sectionTitle, { color: colors.text, opacity: 0 }]}>{sectionTitle}</Text>
          {previewNode}
        </View>
      </View>
    );
  }

  return (
    <View style={cfgStyles.container}>
      <Text style={[cfgStyles.sectionTitle, { color: colors.text }]}>{sectionTitle}</Text>
      {previewNode}
      {formCards}
    </View>
  );
});
PageConfigPanel.displayName = 'PageConfigPanel';

const cfgStyles = StyleSheet.create({
  container: { padding: 16, gap: 14 },
  splitRow: { flex: 1, flexDirection: 'row' },
  splitLeft: { flex: 1 },
  splitLeftContent: { padding: 16, paddingRight: 12, gap: 14 },
  splitRight: { paddingTop: 16, paddingHorizontal: 12, borderLeftWidth: 1, alignSelf: 'flex-start' },
  sectionTitle: { fontSize: 16, fontWeight: '700', marginBottom: 4 },
  card: { borderRadius: 12, borderWidth: 1, padding: 14, marginTop: 10, gap: 8 },
  cardLabel: { fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 },
  cardHeading: { fontSize: 14, fontWeight: '700' },
  label: { fontSize: 12, fontWeight: '600' },
  input: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14 },
  multiline: { minHeight: 70 },
  saveBtn: {
    marginTop: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8, paddingVertical: 14, borderRadius: 12,
  },
  saveBtnText: { color: '#FFF', fontSize: 15, fontWeight: '700' },
});

const previewStyles = StyleSheet.create({
  wrapper: { borderRadius: 12, borderWidth: 1, overflow: 'hidden', marginBottom: 14 },
  labelRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 12, paddingTop: 8, paddingBottom: 6,
  },
  label: { fontSize: 11, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5 },
  langToggle: {
    flexDirection: 'row', borderRadius: 6, overflow: 'hidden',
    borderWidth: 1, borderColor: 'rgba(128,128,128,0.3)',
  },
  langBtn: { paddingHorizontal: 8, paddingVertical: 3, backgroundColor: 'transparent' },
  langBtnText: { fontSize: 10, fontWeight: '700', color: 'rgba(128,128,128,0.7)' },
  langBtnTextActive: { color: '#FFF' },
  header: {
    height: 130, alignItems: 'center', justifyContent: 'center',
    padding: 16, overflow: 'hidden',
  },
  overlay: { backgroundColor: 'rgba(0,0,0,0.5)' },
  iconCircle: {
    width: 38, height: 38, borderRadius: 19,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center', justifyContent: 'center', marginBottom: 6,
  },
  previewTitle: { fontSize: 16, fontWeight: '700', color: '#FFF', marginBottom: 4, textAlign: 'center' },
  previewSubtitle: { fontSize: 12, color: 'rgba(255,255,255,0.8)', textAlign: 'center' },
  fieldHighlight: {
    borderRadius: 4, borderWidth: 1, borderColor: 'rgba(255,255,255,0.8)',
    backgroundColor: 'rgba(255,255,255,0.18)',
    paddingHorizontal: 6, paddingVertical: 2, marginBottom: 2,
  },
});

export default PageConfigPanel;
