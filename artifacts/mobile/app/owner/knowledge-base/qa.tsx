/**
 * Knowledge Base – Q&A Templates Screen
 * Owner-only: Create question & answer pairs for the AI agent
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

interface QAItem {
  id: string;
  question?: string;
  answer?: string;
  category?: string;
  tags?: string[];
  created_at: string;
  status?: string;
}

export default function KBQAScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const language = useAppStore((state) => state.language);
  const isRTL = language === 'ar';

  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState('');
  const [category, setCategory] = useState('');
  const [saving, setSaving] = useState(false);

  const [items, setItems] = useState<QAItem[]>([]);
  const [loadingItems, setLoadingItems] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const loadItems = useCallback(async () => {
    setLoadingItems(true);
    try {
      const res = await knowledgeBaseApi.getAll({ type: 'qa' });
      const data: QAItem[] = Array.isArray(res.data)
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
    if (!question.trim() || !answer.trim() || saving) return;
    setSaving(true);
    try {
      await knowledgeBaseApi.addQA({
        question: question.trim(),
        answer: answer.trim(),
        category: category.trim() || undefined,
      });
      setQuestion('');
      setAnswer('');
      setCategory('');
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
      isRTL ? 'هل تريد حذف هذا السؤال والجواب؟' : 'Delete this Q&A pair?',
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

  const isFormValid = question.trim().length > 0 && answer.trim().length > 0;

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
          <Ionicons name="help-circle" size={20} color="#C4B5FD" />
          <Text style={styles.headerTitle}>{isRTL ? 'أسئلة وأجوبة' : 'Q&A Templates'}</Text>
        </View>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={{ paddingBottom: insets.bottom + 32 }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* Form */}
        <View style={styles.formCard}>
          <Text style={[styles.formLabel, isRTL && styles.textRight]}>
            {isRTL ? 'السؤال *' : 'Question *'}
          </Text>
          <TextInput
            style={[styles.textArea, isRTL && styles.textRight]}
            value={question}
            onChangeText={setQuestion}
            placeholder={isRTL ? 'اكتب السؤال هنا...' : 'Write the question here...'}
            placeholderTextColor="#9CA3AF"
            multiline
            numberOfLines={3}
            textAlign={isRTL ? 'right' : 'left'}
            textAlignVertical="top"
          />

          <Text style={[styles.formLabel, isRTL && styles.textRight, { marginTop: 12 }]}>
            {isRTL ? 'الجواب *' : 'Answer *'}
          </Text>
          <TextInput
            style={[styles.textArea, styles.answerArea, isRTL && styles.textRight]}
            value={answer}
            onChangeText={setAnswer}
            placeholder={isRTL ? 'اكتب الجواب هنا...' : 'Write the answer here...'}
            placeholderTextColor="#9CA3AF"
            multiline
            numberOfLines={5}
            textAlign={isRTL ? 'right' : 'left'}
            textAlignVertical="top"
          />

          <Text style={[styles.formLabel, isRTL && styles.textRight, { marginTop: 12 }]}>
            {isRTL ? 'الفئة / الوسم (اختياري)' : 'Category / Tag (optional)'}
          </Text>
          <TextInput
            style={[styles.input, isRTL && styles.textRight]}
            value={category}
            onChangeText={setCategory}
            placeholder={isRTL ? 'مثال: ضمان، شحن، أسعار...' : 'e.g. warranty, shipping, pricing...'}
            placeholderTextColor="#9CA3AF"
            textAlign={isRTL ? 'right' : 'left'}
          />

          <TouchableOpacity
            style={[styles.saveBtn, (!isFormValid || saving) && styles.saveBtnDisabled]}
            onPress={handleSave}
            disabled={!isFormValid || saving}
          >
            {saving ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <>
                <Ionicons name="checkmark-circle" size={18} color="#fff" />
                <Text style={styles.saveBtnText}>{isRTL ? 'حفظ السؤال والجواب' : 'Save Q&A'}</Text>
              </>
            )}
          </TouchableOpacity>
        </View>

        {/* Accordion list */}
        <Text style={[styles.sectionTitle, isRTL && styles.textRight]}>
          {isRTL ? `الأسئلة والأجوبة (${items.length})` : `Q&A Pairs (${items.length})`}
        </Text>

        {loadingItems ? (
          <ActivityIndicator color="#8B5CF6" style={{ marginTop: 24 }} />
        ) : items.length === 0 ? (
          <View style={styles.emptyBox}>
            <Ionicons name="help-circle-outline" size={40} color="#D1D5DB" />
            <Text style={styles.emptyText}>{isRTL ? 'لا توجد أسئلة بعد' : 'No Q&A pairs yet'}</Text>
          </View>
        ) : (
          items.map((item) => {
            const expanded = expandedId === item.id;
            return (
              <View key={item.id} style={styles.qaCard}>
                <TouchableOpacity
                  style={styles.qaHeader}
                  onPress={() => setExpandedId(expanded ? null : item.id)}
                  activeOpacity={0.8}
                >
                  <Ionicons name="help-circle" size={18} color="#8B5CF6" />
                  <Text
                    style={[styles.qaQuestion, isRTL && styles.textRight]}
                    numberOfLines={expanded ? undefined : 2}
                  >
                    {item.question}
                  </Text>
                  <View style={styles.qaHeaderRight}>
                    {item.category && (
                      <View style={styles.categoryTag}>
                        <Text style={styles.categoryTagText}>{item.category}</Text>
                      </View>
                    )}
                    <TouchableOpacity onPress={() => handleDelete(item.id)} style={styles.deleteBtn}>
                      <Ionicons name="trash-outline" size={16} color="#EF4444" />
                    </TouchableOpacity>
                    <Ionicons
                      name={expanded ? 'chevron-up' : 'chevron-down'}
                      size={16}
                      color="#9CA3AF"
                    />
                  </View>
                </TouchableOpacity>

                {expanded && (
                  <View style={styles.qaBody}>
                    <View style={styles.answerLabel}>
                      <Ionicons name="checkmark-circle" size={14} color="#10B981" />
                      <Text style={styles.answerLabelText}>{isRTL ? 'الجواب' : 'Answer'}</Text>
                    </View>
                    <Text style={[styles.qaAnswer, isRTL && styles.textRight]}>
                      {item.answer}
                    </Text>
                    <Text style={styles.qaMeta}>
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
                )}
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
  textArea: {
    borderWidth: 1.5,
    borderColor: '#E5E7EB',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: '#1F2937',
    backgroundColor: '#F9FAFB',
    minHeight: 80,
  },
  answerArea: { minHeight: 120 },
  saveBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#8B5CF6',
    borderRadius: 14,
    paddingVertical: 14,
    marginTop: 16,
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
  qaCard: {
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
  qaHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    padding: 14,
    gap: 10,
  },
  qaQuestion: {
    flex: 1,
    fontSize: 14,
    fontWeight: '700',
    color: '#1F2937',
    lineHeight: 20,
  },
  qaHeaderRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  categoryTag: {
    backgroundColor: '#EDE9FE',
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  categoryTagText: { fontSize: 11, color: '#6D28D9', fontWeight: '700' },
  deleteBtn: { padding: 4 },
  qaBody: {
    paddingHorizontal: 14,
    paddingBottom: 14,
    borderTopWidth: 1,
    borderTopColor: '#F3F4F6',
    gap: 8,
  },
  answerLabel: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 8,
  },
  answerLabelText: { fontSize: 12, fontWeight: '700', color: '#10B981' },
  qaAnswer: {
    fontSize: 13,
    color: '#4B5563',
    lineHeight: 20,
  },
  qaMeta: { fontSize: 11, color: '#9CA3AF', marginTop: 4 },
});
