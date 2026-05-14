/**
 * Knowledge Base – Links Screen
 * Owner-only: Add URLs to train the AI agent with web content
 */
import React, { useState, useEffect, useCallback } from 'react';
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

interface LinkItem {
  id: string;
  url?: string;
  title?: string;
  content?: string;
  created_at: string;
  status?: string;
}

function extractDomain(url?: string): string {
  if (!url) return '';
  try {
    const u = new URL(url.startsWith('http') ? url : `https://${url}`);
    return u.hostname;
  } catch {
    return url;
  }
}

function faviconUrl(domain: string): string {
  return `https://www.google.com/s2/favicons?domain=${domain}&sz=32`;
}

export default function KBLinksScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const language = useAppStore((state) => state.language);
  const isRTL = language === 'ar';

  const [urlVal, setUrlVal] = useState('');
  const [adding, setAdding] = useState(false);

  const [items, setItems] = useState<LinkItem[]>([]);
  const [loadingItems, setLoadingItems] = useState(true);

  const loadItems = useCallback(async () => {
    setLoadingItems(true);
    try {
      const res = await knowledgeBaseApi.getAll({ type: 'link' });
      const data: LinkItem[] = Array.isArray(res.data)
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

  const handleAdd = async () => {
    const trimmed = urlVal.trim();
    if (!trimmed || adding) return;
    setAdding(true);
    try {
      const normalised = trimmed.startsWith('http') ? trimmed : `https://${trimmed}`;
      await knowledgeBaseApi.addLink({ url: normalised });
      setUrlVal('');
      await loadItems();
    } catch {
      Alert.alert(
        isRTL ? 'خطأ' : 'Error',
        isRTL ? 'فشل في إضافة الرابط. تأكد من صحة الرابط.' : 'Failed to add link. Check the URL is valid.'
      );
    } finally {
      setAdding(false);
    }
  };

  const handleDelete = (id: string) => {
    Alert.alert(
      isRTL ? 'تأكيد الحذف' : 'Confirm Delete',
      isRTL ? 'هل تريد حذف هذا الرابط؟' : 'Delete this link?',
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
          <Ionicons name="link" size={20} color="#6EE7B7" />
          <Text style={styles.headerTitle}>{isRTL ? 'روابط الويب' : 'Web Links'}</Text>
        </View>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={{ paddingBottom: insets.bottom + 32 }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* URL input + Add button */}
        <View style={styles.formCard}>
          <Text style={[styles.formLabel, isRTL && styles.textRight]}>
            {isRTL ? 'أدخل رابط الموقع' : 'Enter website URL'}
          </Text>
          <View style={styles.inputRow}>
            <TextInput
              style={[styles.urlInput, isRTL && { textAlign: 'right' }]}
              value={urlVal}
              onChangeText={setUrlVal}
              placeholder="https://example.com"
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
          <Text style={styles.hint}>
            {isRTL
              ? 'سيتم استخراج العنوان والوصف تلقائياً من الموقع'
              : 'Title and description will be extracted automatically'}
          </Text>
        </View>

        {/* List */}
        <Text style={[styles.sectionTitle, isRTL && styles.textRight]}>
          {isRTL ? `الروابط المضافة (${items.length})` : `Added Links (${items.length})`}
        </Text>

        {loadingItems ? (
          <ActivityIndicator color="#10B981" style={{ marginTop: 24 }} />
        ) : items.length === 0 ? (
          <View style={styles.emptyBox}>
            <Ionicons name="link-outline" size={40} color="#D1D5DB" />
            <Text style={styles.emptyText}>{isRTL ? 'لا توجد روابط بعد' : 'No links yet'}</Text>
          </View>
        ) : (
          items.map((item) => {
            const domain = extractDomain(item.url);
            return (
              <View key={item.id} style={styles.linkCard}>
                <Image
                  source={{ uri: faviconUrl(domain) }}
                  style={styles.favicon}
                />
                <View style={styles.linkInfo}>
                  <Text style={[styles.linkTitle, isRTL && styles.textRight]} numberOfLines={1}>
                    {item.title || domain || (isRTL ? 'بدون عنوان' : 'Untitled')}
                  </Text>
                  {item.content && (
                    <Text style={[styles.linkDesc, isRTL && styles.textRight]} numberOfLines={2}>
                      {item.content}
                    </Text>
                  )}
                  <Text style={styles.linkUrl} numberOfLines={1}>
                    {item.url}
                  </Text>
                  <Text style={styles.linkDate}>
                    {isRTL ? 'تاريخ التعلم: ' : 'Learned at: '}
                    {new Date(item.created_at).toLocaleDateString(isRTL ? 'ar-EG' : 'en-US')}
                    {' · '}
                    <Text style={{ color: item.status === 'ready' ? '#10B981' : '#F59E0B' }}>
                      {item.status === 'ready'
                        ? (isRTL ? '✓ جاهز' : '✓ Ready')
                        : (isRTL ? '⏳ معالجة' : '⏳ Processing')}
                    </Text>
                  </Text>
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
    gap: 10,
  },
  formLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: '#374151',
  },
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
    backgroundColor: '#10B981',
    borderRadius: 12,
    paddingHorizontal: 18,
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 72,
  },
  addBtnDisabled: { backgroundColor: '#D1D5DB' },
  addBtnText: { color: '#fff', fontSize: 14, fontWeight: '800' },
  hint: { fontSize: 12, color: '#9CA3AF' },
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
  linkCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: '#fff',
    borderRadius: 14,
    marginHorizontal: 16,
    marginBottom: 10,
    padding: 14,
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
    gap: 12,
  },
  favicon: { width: 32, height: 32, borderRadius: 8, backgroundColor: '#F3F4F6', marginTop: 2 },
  linkInfo: { flex: 1, gap: 3 },
  linkTitle: { fontSize: 14, fontWeight: '700', color: '#1F2937' },
  linkDesc: { fontSize: 12, color: '#6B7280', lineHeight: 17 },
  linkUrl: { fontSize: 11, color: '#3B82F6', marginTop: 2 },
  linkDate: { fontSize: 11, color: '#9CA3AF', marginTop: 2 },
  deleteBtn: { padding: 6 },
});
