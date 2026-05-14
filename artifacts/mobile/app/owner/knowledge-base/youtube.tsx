/**
 * Knowledge Base – YouTube Screen
 * Owner-only: Add YouTube videos for AI knowledge extraction
 */
import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  Alert,
  Image,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useAppStore } from '../../../src/store/appStore';
import { knowledgeBaseApi } from '../../../src/services/api';
import { useWebSocketEvent } from '../../../src/services/websocketService';

interface YouTubeItem {
  id: string;
  title?: string;
  content?: string;
  created_at: string;
  status?: string;
  // flattened from metadata by API
  url?: string;
  video_id?: string;
  thumbnail?: string;
  channel_name?: string;
  duration?: string;
}

interface OEmbedData {
  title?: string;
  author_name?: string;
  thumbnail_url?: string;
}

function extractVideoId(url: string): string | null {
  const match = url.match(
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([^&?#\s]+)/
  );
  return match ? match[1] : null;
}

function thumbnailUrl(videoId: string): string {
  return `https://img.youtube.com/vi/${videoId}/mqdefault.jpg`;
}


export default function KBYouTubeScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const language = useAppStore((state) => state.language);
  const isRTL = language === 'ar';

  const [urlVal, setUrlVal] = useState('');
  const [durationVal, setDurationVal] = useState('');
  const [previewData, setPreviewData] = useState<OEmbedData | null>(null);
  const [fetchingPreview, setFetchingPreview] = useState(false);
  const [adding, setAdding] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [items, setItems] = useState<YouTubeItem[]>([]);
  const [loadingItems, setLoadingItems] = useState(true);

  const loadItems = useCallback(async () => {
    setLoadingItems(true);
    try {
      const res = await knowledgeBaseApi.getAll({ type: 'youtube' });
      const data: YouTubeItem[] = Array.isArray(res.data)
        ? res.data
        : res.data?.items ?? [];
      setItems(data);
    } catch {
      setItems([]);
    } finally {
      setLoadingItems(false);
    }
  }, []);

  useEffect(() => {
    loadItems();
  }, [loadItems]);

  // Stay in sync with KB changes from any client.
  useWebSocketEvent(
    ['knowledge_base_created', 'knowledge_base_deleted', 'reconnect_sweep'],
    () => { loadItems(); },
  );

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  const fetchPreview = useCallback(async (url: string) => {
    const videoId = extractVideoId(url);
    if (!videoId) {
      setPreviewData(null);
      return;
    }
    setFetchingPreview(true);
    try {
      const oembedUrl = `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`;
      const res = await fetch(oembedUrl);
      if (res.ok) {
        const data: OEmbedData = await res.json();
        setPreviewData(data);
      } else {
        setPreviewData({ title: 'YouTube Video', thumbnail_url: thumbnailUrl(videoId) });
      }
    } catch {
      setPreviewData({ thumbnail_url: thumbnailUrl(videoId) });
    } finally {
      setFetchingPreview(false);
    }
  }, []);

  const handleUrlChange = (val: string) => {
    setUrlVal(val);
    setPreviewData(null);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (val.length > 20) {
      debounceRef.current = setTimeout(() => fetchPreview(val), 600);
    }
  };

  const handleAdd = async () => {
    const trimmed = urlVal.trim();
    if (!trimmed || adding) return;
    if (!extractVideoId(trimmed)) {
      Alert.alert(
        isRTL ? 'رابط غير صالح' : 'Invalid URL',
        isRTL ? 'يرجى إدخال رابط يوتيوب صحيح' : 'Please enter a valid YouTube URL'
      );
      return;
    }
    setAdding(true);
    try {
      await knowledgeBaseApi.addYoutube({
        url: trimmed,
        ...(durationVal.trim() ? { duration: durationVal.trim() } : {}),
      });
      setUrlVal('');
      setDurationVal('');
      setPreviewData(null);
      await loadItems();
    } catch {
      Alert.alert(
        isRTL ? 'خطأ' : 'Error',
        isRTL ? 'فشل في إضافة الفيديو، حاول مجدداً' : 'Failed to add video, please try again'
      );
    } finally {
      setAdding(false);
    }
  };

  const handleDelete = (id: string) => {
    Alert.alert(
      isRTL ? 'تأكيد الحذف' : 'Confirm Delete',
      isRTL ? 'هل تريد حذف هذا الفيديو؟' : 'Delete this video?',
      [
        { text: isRTL ? 'إلغاء' : 'Cancel', style: 'cancel' },
        {
          text: isRTL ? 'حذف' : 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await knowledgeBaseApi.delete(id);
              setItems((prev) => prev.filter((i) => i.id !== id));
            } catch {
              Alert.alert(isRTL ? 'خطأ' : 'Error', isRTL ? 'فشل في الحذف' : 'Failed to delete');
            }
          },
        },
      ]
    );
  };

  const videoId = urlVal ? extractVideoId(urlVal) : null;

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name={isRTL ? 'arrow-forward' : 'arrow-back'} size={24} color="#fff" />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Ionicons name="logo-youtube" size={20} color="#FCA5A5" />
          <Text style={styles.headerTitle}>{isRTL ? 'مقاطع يوتيوب' : 'YouTube Videos'}</Text>
        </View>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={{ paddingBottom: insets.bottom + 32 }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* Input form */}
        <View style={styles.formCard}>
          <Text style={[styles.formLabel, isRTL && styles.textRight]}>
            {isRTL ? 'رابط فيديو يوتيوب' : 'YouTube Video URL'}
          </Text>
          <View style={styles.inputRow}>
            <TextInput
              style={[styles.urlInput, isRTL && { textAlign: 'right' }]}
              value={urlVal}
              onChangeText={handleUrlChange}
              placeholder="https://youtube.com/watch?v=..."
              placeholderTextColor="#9CA3AF"
              keyboardType="url"
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="done"
              onSubmitEditing={handleAdd}
            />
            <TouchableOpacity
              style={[styles.addBtn, (!urlVal.trim() || adding) && styles.addBtnDisabled]}
              onPress={handleAdd}
              disabled={!urlVal.trim() || adding}
            >
              {adding ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Text style={styles.addBtnText}>{isRTL ? 'إضافة' : 'Add'}</Text>
              )}
            </TouchableOpacity>
          </View>

          {/* Optional duration input */}
          <View style={styles.durationRow}>
            <Ionicons name="time-outline" size={16} color="#9CA3AF" />
            <TextInput
              style={[styles.durationInput, isRTL && { textAlign: 'right' }]}
              value={durationVal}
              onChangeText={setDurationVal}
              placeholder={isRTL ? 'المدة (اختياري) مثل: 5:30' : 'Duration (optional) e.g. 5:30'}
              placeholderTextColor="#9CA3AF"
              autoCapitalize="none"
              autoCorrect={false}
            />
          </View>

          {/* oEmbed preview */}
          {fetchingPreview && (
            <View style={styles.previewLoading}>
              <ActivityIndicator size="small" color="#EF4444" />
              <Text style={styles.previewLoadingText}>
                {isRTL ? 'جاري جلب معلومات الفيديو...' : 'Fetching video info...'}
              </Text>
            </View>
          )}

          {!fetchingPreview && (previewData || videoId) && (
            <View style={styles.previewCard}>
              <Image
                source={{ uri: previewData?.thumbnail_url || (videoId ? thumbnailUrl(videoId) : undefined) }}
                style={styles.previewThumb}
                resizeMode="cover"
              />
              <View style={styles.previewInfo}>
                <View style={styles.ytBadge}>
                  <Ionicons name="logo-youtube" size={14} color="#EF4444" />
                  <Text style={styles.ytBadgeText}>YouTube</Text>
                </View>
                <Text style={styles.previewTitle} numberOfLines={2}>
                  {previewData?.title || (isRTL ? 'فيديو يوتيوب' : 'YouTube Video')}
                </Text>
                {previewData?.author_name && (
                  <Text style={styles.previewChannel}>{previewData.author_name}</Text>
                )}
              </View>
            </View>
          )}
        </View>

        {/* List */}
        <Text style={[styles.sectionTitle, isRTL && styles.textRight]}>
          {isRTL ? `الفيديوهات المضافة (${items.length})` : `Added Videos (${items.length})`}
        </Text>

        {loadingItems ? (
          <ActivityIndicator color="#EF4444" style={{ marginTop: 24 }} />
        ) : items.length === 0 ? (
          <View style={styles.emptyBox}>
            <Ionicons name="logo-youtube" size={40} color="#D1D5DB" />
            <Text style={styles.emptyText}>{isRTL ? 'لا توجد فيديوهات بعد' : 'No videos yet'}</Text>
          </View>
        ) : (
          items.map((item) => {
            // Use pre-computed fields from backend-normalized response
            const vId = item.video_id || (item.url ? extractVideoId(item.url) : null);
            const thumb = item.thumbnail || (vId ? thumbnailUrl(vId) : undefined);
            return (
              <View key={item.id} style={styles.videoCard}>
                {thumb ? (
                  <Image
                    source={{ uri: thumb }}
                    style={styles.videoThumb}
                    resizeMode="cover"
                  />
                ) : (
                  <View style={[styles.videoThumb, styles.videoThumbPlaceholder]}>
                    <Ionicons name="logo-youtube" size={24} color="#EF4444" />
                  </View>
                )}
                <View style={styles.videoInfo}>
                  <View style={styles.ytBadge}>
                    <Ionicons name="logo-youtube" size={12} color="#EF4444" />
                    <Text style={[styles.ytBadgeText, { fontSize: 11 }]}>YouTube</Text>
                  </View>
                  <Text style={[styles.videoTitle, isRTL && styles.textRight]} numberOfLines={2}>
                    {item.title || (isRTL ? 'فيديو يوتيوب' : 'YouTube Video')}
                  </Text>
                  {item.channel_name && (
                    <Text style={styles.videoChannel} numberOfLines={1}>{item.channel_name}</Text>
                  )}
                  <View style={[styles.videoMetaRow, isRTL && { flexDirection: 'row-reverse' }]}>
                    {item.duration && (
                      <View style={styles.durationPill}>
                        <Ionicons name="time-outline" size={11} color="#6B7280" />
                        <Text style={styles.durationText}>{item.duration}</Text>
                      </View>
                    )}
                    <Text style={styles.videoDate}>
                      {isRTL ? 'تعلّم: ' : 'Learned: '}
                      {new Date(item.created_at).toLocaleDateString(isRTL ? 'ar-EG' : 'en-US')}
                    </Text>
                    <Text style={{ fontSize: 11, color: item.status === 'ready' ? '#10B981' : '#F59E0B' }}>
                      {item.status === 'ready'
                        ? (isRTL ? '✓ جاهز' : '✓ Ready')
                        : (isRTL ? '⏳ معالجة' : '⏳ Processing')}
                    </Text>
                  </View>
                </View>
                <TouchableOpacity onPress={() => handleDelete(item.id)} style={styles.deleteBtn}>
                  <Ionicons name="trash-outline" size={20} color="#EF4444" />
                </TouchableOpacity>
              </View>
            );
          })
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#F9FAFB' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingBottom: 12,
    backgroundColor: '#1E1B4B',
  },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerCenter: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  headerTitle: { color: '#fff', fontSize: 17, fontWeight: '800' },
  scroll: { flex: 1 },
  formCard: {
    margin: 16,
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 16,
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
    gap: 12,
  },
  formLabel: { fontSize: 13, fontWeight: '700', color: '#374151' },
  textRight: { textAlign: 'right' },
  inputRow: { flexDirection: 'row', gap: 10 },
  urlInput: {
    flex: 1,
    borderWidth: 1.5,
    borderColor: '#E5E7EB',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 13,
    color: '#1F2937',
    backgroundColor: '#F9FAFB',
  },
  addBtn: {
    backgroundColor: '#EF4444',
    borderRadius: 12,
    paddingHorizontal: 18,
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 72,
  },
  addBtnDisabled: { backgroundColor: '#D1D5DB' },
  addBtnText: { color: '#fff', fontSize: 14, fontWeight: '800' },
  previewLoading: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 10,
  },
  previewLoadingText: { fontSize: 13, color: '#9CA3AF' },
  previewCard: {
    flexDirection: 'row',
    backgroundColor: '#FEF2F2',
    borderRadius: 12,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#FECACA',
  },
  previewThumb: { width: 100, height: 70 },
  previewInfo: { flex: 1, padding: 10, gap: 3 },
  ytBadge: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  ytBadgeText: { fontSize: 12, color: '#EF4444', fontWeight: '700' },
  previewTitle: { fontSize: 13, fontWeight: '700', color: '#1F2937', lineHeight: 18 },
  previewChannel: { fontSize: 12, color: '#6B7280' },
  sectionTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: '#1F2937',
    paddingHorizontal: 16,
    marginTop: 8,
    marginBottom: 12,
  },
  emptyBox: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 40,
    gap: 12,
  },
  emptyText: { color: '#9CA3AF', fontSize: 15 },
  videoCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: '#fff',
    borderRadius: 14,
    marginHorizontal: 16,
    marginBottom: 10,
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
    overflow: 'hidden',
    gap: 12,
  },
  videoThumb: { width: 90, height: 68 },
  videoThumbPlaceholder: {
    backgroundColor: '#FEE2E2',
    alignItems: 'center',
    justifyContent: 'center',
  },
  videoInfo: { flex: 1, paddingVertical: 10, paddingRight: 8, gap: 4 },
  videoTitle: { fontSize: 13, fontWeight: '700', color: '#1F2937', lineHeight: 18 },
  videoChannel: { fontSize: 12, color: '#6B7280' },
  videoMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 2 },
  videoDate: { fontSize: 11, color: '#9CA3AF' },
  deleteBtn: { padding: 10, alignSelf: 'center' },
  durationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 2,
  },
  durationInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 13,
    color: '#1F2937',
    backgroundColor: '#F9FAFB',
  },
  durationPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: '#F3F4F6',
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  durationText: { fontSize: 11, color: '#6B7280', fontWeight: '600' },
});
