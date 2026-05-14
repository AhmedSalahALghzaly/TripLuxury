/**
 * Knowledge Base Main Screen
 * Owner-only: 5 category cards to train the AI agent
 * Search filters across ALL knowledge base items (not just categories)
 */
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useAppStore } from '../../../src/store/appStore';
import { knowledgeBaseApi } from '../../../src/services/api';
import { useWebSocketEvent } from '../../../src/services/websocketService';

type KBType = 'text' | 'file' | 'link' | 'qa' | 'youtube';

interface KBItem {
  id: string;
  type: KBType;
  title?: string;
  content?: string;
  created_at: string;
  status?: string;
  // flattened metadata fields returned by API
  url?: string;
  hostname?: string;
  question?: string;
  answer?: string;
  category?: string;
  file_name?: string;
  file_type?: string;
  file_size?: number;
  video_id?: string;
  thumbnail?: string;
  channel_name?: string;
}

interface CategoryCard {
  id: KBType;
  route:
    | '/owner/knowledge-base/text'
    | '/owner/knowledge-base/file'
    | '/owner/knowledge-base/links'
    | '/owner/knowledge-base/qa'
    | '/owner/knowledge-base/youtube';
  icon: string;
  color: string;
  titleAr: string;
  titleEn: string;
  descAr: string;
  descEn: string;
}

const CATEGORIES: CategoryCard[] = [
  {
    id: 'text',
    route: '/owner/knowledge-base/text',
    icon: 'document-text',
    color: '#3B82F6',
    titleAr: 'نصوص',
    titleEn: 'Text',
    descAr: 'أضف محتوى نصياً لتدريب المساعد على معلومات محددة',
    descEn: 'Add text content to train the assistant on specific information',
  },
  {
    id: 'file',
    route: '/owner/knowledge-base/file',
    icon: 'attach',
    color: '#F59E0B',
    titleAr: 'ملفات',
    titleEn: 'Files',
    descAr: 'ارفع ملفات PDF وWord والجداول لاستخراج المعرفة منها',
    descEn: 'Upload PDF, Word, spreadsheets to extract knowledge',
  },
  {
    id: 'link',
    route: '/owner/knowledge-base/links',
    icon: 'link',
    color: '#10B981',
    titleAr: 'روابط',
    titleEn: 'Links',
    descAr: 'أضف روابط مواقع لاستخراج المحتوى تلقائياً',
    descEn: 'Add website links to automatically extract content',
  },
  {
    id: 'qa',
    route: '/owner/knowledge-base/qa',
    icon: 'help-circle',
    color: '#8B5CF6',
    titleAr: 'أسئلة وأجوبة',
    titleEn: 'Q&A',
    descAr: 'أنشئ أزواج أسئلة وأجوبة للردود السريعة والدقيقة',
    descEn: 'Create question & answer pairs for quick accurate responses',
  },
  {
    id: 'youtube',
    route: '/owner/knowledge-base/youtube',
    icon: 'logo-youtube',
    color: '#EF4444',
    titleAr: 'يوتيوب',
    titleEn: 'YouTube',
    descAr: 'أضف مقاطع يوتيوب لاستخراج المحتوى والتعليق منها',
    descEn: 'Add YouTube videos to extract content and commentary',
  },
];

const TYPE_COLORS: Record<KBType, string> = {
  text: '#3B82F6',
  file: '#F59E0B',
  link: '#10B981',
  qa: '#8B5CF6',
  youtube: '#EF4444',
};

const TYPE_ICONS: Record<KBType, string> = {
  text: 'document-text',
  file: 'attach',
  link: 'link',
  qa: 'help-circle',
  youtube: 'logo-youtube',
};

const TYPE_LABELS_AR: Record<KBType, string> = {
  text: 'نص',
  file: 'ملف',
  link: 'رابط',
  qa: 'سؤال وجواب',
  youtube: 'يوتيوب',
};

export default function KnowledgeBaseIndex() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const language = useAppStore((state) => state.language);
  const isRTL = language === 'ar';

  const [search, setSearch] = useState('');
  const [allItems, setAllItems] = useState<KBItem[]>([]);
  const [loadingItems, setLoadingItems] = useState(true);
  const [accessDenied, setAccessDenied] = useState(false);

  const loadItems = useCallback(async () => {
    setLoadingItems(true);
    setAccessDenied(false);
    try {
      const res = await knowledgeBaseApi.getAll();
      const data: KBItem[] = Array.isArray(res.data)
        ? res.data
        : res.data?.items ?? [];
      setAllItems(data);
    } catch (err: unknown) {
      const status = (err as { response?: { status?: number } })?.response?.status;
      if (status === 403) {
        setAccessDenied(true);
      }
      setAllItems([]);
    } finally {
      setLoadingItems(false);
    }
  }, []);

  useEffect(() => {
    loadItems();
  }, [loadItems]);

  // Refresh KB list whenever the server pushes a create/delete event so
  // the dashboard stays in sync across tabs without manual refresh.
  useWebSocketEvent(
    ['knowledge_base_created', 'knowledge_base_deleted', 'reconnect_sweep'],
    () => { loadItems(); },
  );

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const item of allItems) {
      c[item.type] = (c[item.type] || 0) + 1;
    }
    return c;
  }, [allItems]);

  const totalCount = allItems.length;

  // Cross-item search across all KB entries
  const searchResults = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return [];
    return allItems.filter(
      (item) =>
        item.title?.toLowerCase().includes(q) ||
        item.content?.toLowerCase().includes(q) ||
        item.question?.toLowerCase().includes(q) ||
        item.answer?.toLowerCase().includes(q) ||
        item.url?.toLowerCase().includes(q)
    );
  }, [allItems, search]);

  const isSearching = search.trim().length > 0;

  const getItemPreview = (item: KBItem) => {
    return (
      item.title ||
      item.question ||
      item.url ||
      item.content?.slice(0, 80) ||
      (isRTL ? 'بدون عنوان' : 'Untitled')
    );
  };

  if (accessDenied) {
    return (
      <View style={styles.container}>
        <LinearGradient colors={['#1E1B4B', '#2D2B6B', '#3730A3']} style={StyleSheet.absoluteFill} />
        <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
            <Ionicons name={isRTL ? 'arrow-forward' : 'arrow-back'} size={24} color="#fff" />
          </TouchableOpacity>
          <View style={styles.headerCenter}>
            <Text style={styles.headerTitle}>{isRTL ? 'قاعدة المعرفة' : 'Knowledge Base'}</Text>
          </View>
          <View style={{ width: 40 }} />
        </View>
        <View style={styles.accessDeniedContainer}>
          <Ionicons name="lock-closed" size={56} color="rgba(255,255,255,0.3)" />
          <Text style={styles.accessDeniedTitle}>
            {isRTL ? 'غير مصرح بالوصول' : 'Access Denied'}
          </Text>
          <Text style={styles.accessDeniedSub}>
            {isRTL
              ? 'هذه الميزة متاحة للمالك فقط'
              : 'This feature is available to the owner only'}
          </Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <LinearGradient
        colors={['#1E1B4B', '#2D2B6B', '#3730A3']}
        style={StyleSheet.absoluteFill}
      />

      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons
            name={isRTL ? 'arrow-forward' : 'arrow-back'}
            size={24}
            color="#fff"
          />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle}>
            {isRTL ? 'قاعدة المعرفة' : 'Knowledge Base'}
          </Text>
          <Text style={styles.headerSub}>
            {isRTL ? 'تدريب المساعد الذكي' : 'Train the AI Agent'}
          </Text>
        </View>
        <View style={styles.headerRight}>
          {loadingItems ? (
            <ActivityIndicator size="small" color="rgba(255,255,255,0.6)" />
          ) : (
            <View style={styles.totalBadge}>
              <Text style={styles.totalBadgeText}>{totalCount}</Text>
            </View>
          )}
        </View>
      </View>

      {/* Search Bar — filters across ALL items */}
      <View style={styles.searchContainer}>
        <Ionicons name="search-outline" size={18} color="rgba(255,255,255,0.6)" />
        <TextInput
          style={[styles.searchInput, isRTL && styles.searchInputRTL]}
          placeholder={isRTL ? 'ابحث في قاعدة المعرفة...' : 'Search all knowledge items...'}
          placeholderTextColor="rgba(255,255,255,0.4)"
          value={search}
          onChangeText={setSearch}
          textAlign={isRTL ? 'right' : 'left'}
        />
        {search.length > 0 && (
          <TouchableOpacity onPress={() => setSearch('')}>
            <Ionicons name="close-circle" size={18} color="rgba(255,255,255,0.6)" />
          </TouchableOpacity>
        )}
      </View>

      {/* Info Banner — hide when searching */}
      {!isSearching && (
        <View style={styles.infoBanner}>
          <Ionicons name="sparkles" size={16} color="#A78BFA" />
          <Text style={[styles.infoBannerText, isRTL && { textAlign: 'right' }]}>
            {isRTL
              ? 'كل ما تضيفه هنا يصبح جزءاً من معرفة مساعدك الذكي'
              : "Everything you add here becomes part of your AI assistant's knowledge"}
          </Text>
        </View>
      )}

      <ScrollView
        contentContainerStyle={[
          styles.listContent,
          { paddingBottom: insets.bottom + 32 },
        ]}
        showsVerticalScrollIndicator={false}
      >
        {isSearching ? (
          /* ─── Search results across ALL items ─── */
          <>
            <Text style={[styles.searchResultsLabel, isRTL && { textAlign: 'right' }]}>
              {isRTL
                ? `نتائج البحث (${searchResults.length})`
                : `Search Results (${searchResults.length})`}
            </Text>

            {loadingItems ? (
              <ActivityIndicator color="#A78BFA" style={{ marginTop: 40 }} />
            ) : searchResults.length === 0 ? (
              <View style={styles.noResults}>
                <Ionicons name="search" size={40} color="rgba(255,255,255,0.3)" />
                <Text style={styles.noResultsText}>
                  {isRTL ? 'لا توجد نتائج' : 'No results found'}
                </Text>
              </View>
            ) : (
              searchResults.map((item) => {
                const color = TYPE_COLORS[item.type] ?? '#6B7280';
                const icon = TYPE_ICONS[item.type] ?? 'document';
                const label = isRTL ? TYPE_LABELS_AR[item.type] : item.type;
                return (
                  <View key={item.id} style={styles.resultCard}>
                    <View style={[styles.resultAccent, { backgroundColor: color }]} />
                    <View style={[styles.resultIconWrap, { backgroundColor: color + '25' }]}>
                      <Ionicons name={icon as 'document-text' | 'attach' | 'link' | 'help-circle' | 'logo-youtube'} size={20} color={color} />
                    </View>
                    <View style={styles.resultBody}>
                      <Text style={[styles.resultTitle, isRTL && { textAlign: 'right' }]} numberOfLines={2}>
                        {getItemPreview(item)}
                      </Text>
                      <View style={[styles.resultMeta, isRTL && { flexDirection: 'row-reverse' }]}>
                        <View style={[styles.typePill, { backgroundColor: color + '25' }]}>
                          <Text style={[styles.typePillText, { color }]}>{label}</Text>
                        </View>
                        <Text style={styles.resultDate}>
                          {new Date(item.created_at).toLocaleDateString(isRTL ? 'ar-EG' : 'en-US')}
                        </Text>
                        <View style={[styles.statusDot, { backgroundColor: item.status === 'ready' ? '#10B981' : '#F59E0B' }]} />
                      </View>
                    </View>
                  </View>
                );
              })
            )}
          </>
        ) : (
          /* ─── Category cards ─── */
          CATEGORIES.map((cat) => {
            const count = counts[cat.id] ?? 0;
            return (
              <TouchableOpacity
                key={cat.id}
                style={styles.card}
                onPress={() => router.push(cat.route)}
                activeOpacity={0.85}
              >
                <View style={[styles.accentBar, { backgroundColor: cat.color }]} />
                <View style={[styles.iconWrap, { backgroundColor: cat.color + '20' }]}>
                  <Ionicons name={cat.icon as 'document-text' | 'attach' | 'link' | 'help-circle' | 'logo-youtube'} size={28} color={cat.color} />
                </View>
                <View style={styles.cardBody}>
                  <View style={styles.cardTitleRow}>
                    <Text style={styles.cardTitleMain}>
                      {isRTL ? cat.titleAr : cat.titleEn}
                    </Text>
                    <Text style={styles.cardTitleSub}>
                      {isRTL ? cat.titleEn : cat.titleAr}
                    </Text>
                  </View>
                  <Text
                    style={[styles.cardDesc, isRTL && { textAlign: 'right' }]}
                    numberOfLines={2}
                  >
                    {isRTL ? cat.descAr : cat.descEn}
                  </Text>
                </View>
                <View style={styles.cardRight}>
                  <View style={[styles.countBadge, { backgroundColor: cat.color + '20' }]}>
                    <Text style={[styles.countText, { color: cat.color }]}>{count}</Text>
                  </View>
                  <Ionicons
                    name={isRTL ? 'chevron-back' : 'chevron-forward'}
                    size={20}
                    color="rgba(255,255,255,0.4)"
                    style={{ marginTop: 8 }}
                  />
                </View>
              </TouchableOpacity>
            );
          })
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerCenter: { flex: 1, alignItems: 'center' },
  headerTitle: { color: '#fff', fontSize: 19, fontWeight: '800' },
  headerSub: { color: 'rgba(255,255,255,0.6)', fontSize: 12, marginTop: 2 },
  headerRight: { width: 40, alignItems: 'center' },
  totalBadge: {
    backgroundColor: 'rgba(255,255,255,0.2)',
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  totalBadgeText: { color: '#fff', fontSize: 14, fontWeight: '800' },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.12)',
    marginHorizontal: 16,
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 8,
    marginBottom: 12,
  },
  searchInput: { flex: 1, color: '#fff', fontSize: 14, padding: 0 },
  searchInputRTL: { textAlign: 'right' },
  infoBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(167,139,250,0.15)',
    marginHorizontal: 16,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 16,
  },
  infoBannerText: { color: '#C4B5FD', fontSize: 13, flex: 1, lineHeight: 18 },
  listContent: { paddingHorizontal: 16, gap: 12 },
  searchResultsLabel: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 13,
    fontWeight: '700',
    marginBottom: 8,
  },
  card: {
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderRadius: 16,
    flexDirection: 'row',
    alignItems: 'center',
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  accentBar: { width: 4, alignSelf: 'stretch' },
  iconWrap: {
    width: 56,
    height: 56,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    margin: 14,
  },
  cardBody: { flex: 1, paddingVertical: 14, paddingRight: 8, gap: 4 },
  cardTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  cardTitleMain: { color: '#fff', fontSize: 16, fontWeight: '800' },
  cardTitleSub: { color: 'rgba(255,255,255,0.5)', fontSize: 13, fontWeight: '500' },
  cardDesc: { color: 'rgba(255,255,255,0.6)', fontSize: 12, lineHeight: 17 },
  cardRight: { paddingRight: 14, alignItems: 'center' },
  countBadge: { borderRadius: 12, paddingHorizontal: 10, paddingVertical: 4, minWidth: 32, alignItems: 'center' },
  countText: { fontSize: 14, fontWeight: '800' },
  // Search result cards
  resultCard: {
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderRadius: 14,
    flexDirection: 'row',
    alignItems: 'center',
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  resultAccent: { width: 4, alignSelf: 'stretch' },
  resultIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    margin: 12,
  },
  resultBody: { flex: 1, paddingVertical: 12, paddingRight: 12, gap: 6 },
  resultTitle: { color: '#fff', fontSize: 14, fontWeight: '700', lineHeight: 19 },
  resultMeta: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  typePill: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 2 },
  typePillText: { fontSize: 11, fontWeight: '700' },
  resultDate: { color: 'rgba(255,255,255,0.4)', fontSize: 11 },
  statusDot: { width: 7, height: 7, borderRadius: 4 },
  noResults: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 80,
    gap: 12,
  },
  noResultsText: { color: 'rgba(255,255,255,0.5)', fontSize: 16 },
  accessDeniedContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
    gap: 12,
  },
  accessDeniedTitle: {
    color: '#fff',
    fontSize: 22,
    fontWeight: '800',
    textAlign: 'center',
  },
  accessDeniedSub: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: 15,
    textAlign: 'center',
    lineHeight: 22,
  },
});
