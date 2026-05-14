/**
 * Knowledge Base – Text Information Screen
 * Owner-only: Add rich text articles to train the AI agent
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
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useAppStore } from '../../../src/store/appStore';
import { knowledgeBaseApi } from '../../../src/services/api';
import { useWebSocketEvent } from '../../../src/services/websocketService';

const MAX_CHARS = 10000;

interface TextItem {
  id: string;
  title?: string;
  content?: string;
  created_at: string;
  status?: string;
}

export default function KBTextScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const language = useAppStore((state) => state.language);
  const isRTL = language === 'ar';

  const [titleVal, setTitleVal] = useState('');
  const [content, setContent] = useState('');
  const [saving, setSaving] = useState(false);
  const [boldActive, setBoldActive] = useState(false);
  const [italicActive, setItalicActive] = useState(false);
  const [underlineActive, setUnderlineActive] = useState(false);

  const [items, setItems] = useState<TextItem[]>([]);
  const [loadingItems, setLoadingItems] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const loadItems = useCallback(async () => {
    setLoadingItems(true);
    try {
      const res = await knowledgeBaseApi.getAll({ type: 'text' });
      const data: TextItem[] = Array.isArray(res.data)
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

  const handleSave = async () => {
    if (!content.trim()) return;
    setSaving(true);
    try {
      await knowledgeBaseApi.addText({
        title: titleVal.trim() || undefined,
        content: content.trim(),
      });
      setTitleVal('');
      setContent('');
      await loadItems();
    } catch {
      Alert.alert(
        isRTL ? 'خطأ' : 'Error',
        isRTL ? 'فشل في الحفظ، حاول مجدداً' : 'Failed to save, please try again'
      );
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = (id: string) => {
    Alert.alert(
      isRTL ? 'تأكيد الحذف' : 'Confirm Delete',
      isRTL ? 'هل تريد حذف هذا النص؟' : 'Delete this text item?',
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

  const charCount = content.length;
  const charColor = charCount > MAX_CHARS * 0.9 ? '#EF4444' : charCount > MAX_CHARS * 0.75 ? '#F59E0B' : '#9CA3AF';

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
          <Ionicons name="document-text" size={20} color="#93C5FD" />
          <Text style={styles.headerTitle}>{isRTL ? 'نصوص تدريبية' : 'Text Articles'}</Text>
        </View>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={{ paddingBottom: insets.bottom + 32 }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* Form Card */}
        <View style={styles.formCard}>
          <Text style={[styles.formLabel, isRTL && styles.textRight]}>
            {isRTL ? 'العنوان (اختياري)' : 'Title (optional)'}
          </Text>
          <TextInput
            style={[styles.input, isRTL && styles.textRight]}
            value={titleVal}
            onChangeText={setTitleVal}
            placeholder={isRTL ? 'عنوان النص...' : 'Article title...'}
            placeholderTextColor="#9CA3AF"
            textAlign={isRTL ? 'right' : 'left'}
          />

          <Text style={[styles.formLabel, isRTL && styles.textRight, { marginTop: 12 }]}>
            {isRTL ? 'المحتوى *' : 'Content *'}
          </Text>

          {/* Formatting toolbar */}
          <View style={styles.toolbar}>
            <TouchableOpacity
              style={[styles.toolBtn, boldActive && styles.toolBtnActive]}
              onPress={() => setBoldActive(!boldActive)}
            >
              <Text style={[styles.toolBtnText, boldActive && styles.toolBtnTextActive]}>B</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.toolBtn, italicActive && styles.toolBtnActive]}
              onPress={() => setItalicActive(!italicActive)}
            >
              <Text style={[styles.toolBtnText, italicActive && styles.toolBtnTextActive, { fontStyle: 'italic' }]}>I</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.toolBtn, underlineActive && styles.toolBtnActive]}
              onPress={() => setUnderlineActive(!underlineActive)}
            >
              <Text style={[styles.toolBtnText, underlineActive && styles.toolBtnTextActive, { textDecorationLine: 'underline' }]}>U</Text>
            </TouchableOpacity>
          </View>

          <TextInput
            style={[styles.textArea, isRTL && styles.textRight]}
            value={content}
            onChangeText={(t) => {
              if (t.length <= MAX_CHARS) setContent(t);
            }}
            placeholder={isRTL ? 'اكتب المحتوى التدريبي هنا...' : 'Write training content here...'}
            placeholderTextColor="#9CA3AF"
            multiline
            numberOfLines={10}
            textAlign={isRTL ? 'right' : 'left'}
            textAlignVertical="top"
          />

          <View style={styles.charCountRow}>
            <Text style={[styles.charCount, { color: charColor }]}>
              {charCount.toLocaleString()} / {MAX_CHARS.toLocaleString()}
            </Text>
          </View>

          <TouchableOpacity
            style={[styles.saveBtn, (!content.trim() || saving) && styles.saveBtnDisabled]}
            onPress={handleSave}
            disabled={!content.trim() || saving}
          >
            {saving ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <>
                <Ionicons name="checkmark-circle" size={18} color="#fff" />
                <Text style={styles.saveBtnText}>{isRTL ? 'حفظ' : 'Save'}</Text>
              </>
            )}
          </TouchableOpacity>
        </View>

        {/* Existing Items */}
        <Text style={[styles.sectionTitle, isRTL && styles.textRight]}>
          {isRTL ? `النصوص المحفوظة (${items.length})` : `Saved Texts (${items.length})`}
        </Text>

        {loadingItems ? (
          <ActivityIndicator color="#3B82F6" style={{ marginTop: 24 }} />
        ) : items.length === 0 ? (
          <View style={styles.emptyBox}>
            <Ionicons name="document-text-outline" size={40} color="#D1D5DB" />
            <Text style={styles.emptyText}>
              {isRTL ? 'لا توجد نصوص بعد' : 'No texts yet'}
            </Text>
          </View>
        ) : (
          items.map((item) => {
            const expanded = expandedId === item.id;
            return (
              <TouchableOpacity
                key={item.id}
                style={styles.itemCard}
                onPress={() => setExpandedId(expanded ? null : item.id)}
                activeOpacity={0.8}
              >
                <View style={styles.itemHeader}>
                  <View style={styles.itemHeaderLeft}>
                    <Ionicons name="document-text" size={16} color="#3B82F6" />
                    <Text style={styles.itemTitle} numberOfLines={expanded ? undefined : 1}>
                      {item.title || (isRTL ? 'بدون عنوان' : 'Untitled')}
                    </Text>
                  </View>
                  <View style={styles.itemHeaderRight}>
                    <View style={[
                      styles.statusDot,
                      { backgroundColor: item.status === 'ready' ? '#10B981' : '#F59E0B' },
                    ]} />
                    <TouchableOpacity onPress={() => handleDelete(item.id)} style={styles.deleteBtn}>
                      <Ionicons name="trash-outline" size={16} color="#EF4444" />
                    </TouchableOpacity>
                    <Ionicons
                      name={expanded ? 'chevron-up' : 'chevron-down'}
                      size={16}
                      color="#9CA3AF"
                    />
                  </View>
                </View>
                {expanded && (
                  <View style={styles.itemBody}>
                    <Text style={[styles.itemContent, isRTL && styles.textRight]}>
                      {item.content}
                    </Text>
                    <Text style={styles.itemMeta}>
                      {isRTL ? 'تاريخ التعلم: ' : 'Learned at: '}
                      {new Date(item.created_at).toLocaleDateString(isRTL ? 'ar-EG' : 'en-US')}
                      {' · '}
                      <Text style={{ color: item.status === 'ready' ? '#10B981' : '#F59E0B' }}>
                        {item.status === 'ready'
                          ? (isRTL ? '✓ جاهز' : '✓ Ready')
                          : (isRTL ? '⏳ قيد المعالجة' : '⏳ Processing')}
                      </Text>
                    </Text>
                  </View>
                )}
              </TouchableOpacity>
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
  },
  formLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: '#374151',
    marginBottom: 6,
  },
  textRight: { textAlign: 'right' },
  input: {
    borderWidth: 1.5,
    borderColor: '#E5E7EB',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: '#1F2937',
    backgroundColor: '#F9FAFB',
  },
  toolbar: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 8,
    paddingTop: 4,
  },
  toolBtn: {
    width: 36,
    height: 36,
    borderRadius: 8,
    borderWidth: 1.5,
    borderColor: '#D1D5DB',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F9FAFB',
  },
  toolBtnActive: {
    backgroundColor: '#3B82F6',
    borderColor: '#3B82F6',
  },
  toolBtnText: {
    fontSize: 15,
    fontWeight: '800',
    color: '#374151',
  },
  toolBtnTextActive: { color: '#fff' },
  textArea: {
    borderWidth: 1.5,
    borderColor: '#E5E7EB',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: '#1F2937',
    backgroundColor: '#F9FAFB',
    minHeight: 180,
  },
  charCountRow: {
    alignItems: 'flex-end',
    marginTop: 6,
    marginBottom: 4,
  },
  charCount: { fontSize: 12, fontWeight: '600' },
  saveBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#10B981',
    borderRadius: 14,
    paddingVertical: 14,
    marginTop: 8,
  },
  saveBtnDisabled: { backgroundColor: '#D1D5DB' },
  saveBtnText: { color: '#fff', fontSize: 16, fontWeight: '800' },
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
  itemCard: {
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
  },
  itemHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 14,
  },
  itemHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flex: 1,
  },
  itemTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#1F2937',
    flex: 1,
  },
  itemHeaderRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  deleteBtn: { padding: 4 },
  itemBody: {
    paddingHorizontal: 14,
    paddingBottom: 14,
    borderTopWidth: 1,
    borderTopColor: '#F3F4F6',
    gap: 8,
  },
  itemContent: {
    fontSize: 13,
    color: '#4B5563',
    lineHeight: 20,
  },
  itemMeta: { fontSize: 11, color: '#9CA3AF' },
});
