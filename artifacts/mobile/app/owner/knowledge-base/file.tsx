/**
 * Knowledge Base – File Upload Screen
 * Owner-only: Upload PDF, DOCX, TXT, XLS, CSV, images
 * File cards are expandable with preview metadata
 */
import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import * as DocumentPicker from 'expo-document-picker';
import { useAppStore } from '../../../src/store/appStore';
import { knowledgeBaseApi } from '../../../src/services/api';
import { useWebSocketEvent } from '../../../src/services/websocketService';

interface FileItem {
  id: string;
  title?: string;
  content?: string;
  file_url?: string;
  created_at: string;
  status?: string;
  // flattened from metadata by API
  file_name?: string;
  file_type?: string;
  file_size?: number;
}

const ACCEPTED_TYPES = [
  'application/pdf',
  'text/plain',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/csv',
  'image/png',
  'image/jpeg',
];

type FileIconName = 'document-text' | 'grid' | 'image' | 'document';

function getFileIcon(mimeType?: string): { icon: FileIconName; color: string } {
  if (!mimeType) return { icon: 'document', color: '#6B7280' };
  if (mimeType.includes('pdf')) return { icon: 'document-text', color: '#EF4444' };
  if (mimeType.includes('word') || mimeType.includes('msword')) return { icon: 'document-text', color: '#3B82F6' };
  if (mimeType.includes('excel') || mimeType.includes('spreadsheet') || mimeType.includes('csv')) return { icon: 'grid', color: '#10B981' };
  if (mimeType.includes('image')) return { icon: 'image', color: '#8B5CF6' };
  return { icon: 'document', color: '#6B7280' };
}

function formatBytes(bytes?: number): string {
  if (!bytes) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function friendlyMime(mimeType?: string): string {
  if (!mimeType) return '—';
  const parts = mimeType.split('/');
  const sub = parts[parts.length - 1].toUpperCase();
  const map: Record<string, string> = {
    'VND.OPENXMLFORMATS-OFFICEDOCUMENT.WORDPROCESSINGML.DOCUMENT': 'DOCX',
    'VND.OPENXMLFORMATS-OFFICEDOCUMENT.SPREADSHEETML.SHEET': 'XLSX',
    'VND.MS-EXCEL': 'XLS',
    'MSWORD': 'DOC',
  };
  return map[sub] ?? sub;
}

export default function KBFileScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const language = useAppStore((state) => state.language);
  const isRTL = language === 'ar';

  const [pickedFile, setPickedFile] = useState<DocumentPicker.DocumentPickerAsset | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);

  const [items, setItems] = useState<FileItem[]>([]);
  const [loadingItems, setLoadingItems] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const loadItems = useCallback(async () => {
    setLoadingItems(true);
    try {
      const res = await knowledgeBaseApi.getAll({ type: 'file' });
      const data: FileItem[] = Array.isArray(res.data)
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

  const handlePickFile = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ACCEPTED_TYPES,
        copyToCacheDirectory: true,
      });
      if (!result.canceled && result.assets.length > 0) {
        setPickedFile(result.assets[0]);
        setUploadProgress(0);
      }
    } catch {
      Alert.alert(isRTL ? 'خطأ' : 'Error', isRTL ? 'لم يتم اختيار الملف' : 'File not selected');
    }
  };

  const handleUpload = async () => {
    if (!pickedFile || uploading) return;
    setUploading(true);
    setUploadProgress(5);
    try {
      const urlRes = await knowledgeBaseApi.requestFileUploadUrl({
        file_name: pickedFile.name,
        file_type: pickedFile.mimeType || 'application/octet-stream',
        file_size: pickedFile.size,
      });
      const { uploadURL, objectPath } = urlRes.data;
      setUploadProgress(20);

      const fileResponse = await fetch(pickedFile.uri);
      const fileBlob = await fileResponse.blob();
      setUploadProgress(45);

      await fetch(uploadURL, {
        method: 'PUT',
        headers: { 'Content-Type': pickedFile.mimeType || 'application/octet-stream' },
        body: fileBlob,
      });
      setUploadProgress(80);

      await knowledgeBaseApi.addFile({
        title: pickedFile.name,
        object_path: objectPath,
        file_name: pickedFile.name,
        file_type: pickedFile.mimeType || 'application/octet-stream',
        file_size: pickedFile.size,
      });
      setUploadProgress(100);

      setPickedFile(null);
      setUploadProgress(0);
      await loadItems();
    } catch {
      Alert.alert(
        isRTL ? 'خطأ في الرفع' : 'Upload Error',
        isRTL ? 'فشل رفع الملف، تأكد من الاتصال وحاول مجدداً' : 'Failed to upload file, check connection and try again'
      );
    } finally {
      setUploading(false);
    }
  };

  const handleDelete = (id: string) => {
    Alert.alert(
      isRTL ? 'تأكيد الحذف' : 'Confirm Delete',
      isRTL ? 'هل تريد حذف هذا الملف؟' : 'Delete this file?',
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
          <Ionicons name="attach" size={20} color="#FCD34D" />
          <Text style={styles.headerTitle}>{isRTL ? 'رفع الملفات' : 'Upload Files'}</Text>
        </View>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={{ paddingBottom: insets.bottom + 32 }}
        showsVerticalScrollIndicator={false}
      >
        {/* Upload Box */}
        <View style={styles.formCard}>
          <Text style={[styles.formLabel, isRTL && styles.textRight]}>
            {isRTL
              ? 'يدعم: PDF، Word، Excel، CSV، TXT، PNG، JPG'
              : 'Supports: PDF, Word, Excel, CSV, TXT, PNG, JPG'}
          </Text>

          <TouchableOpacity
            style={[styles.dropBox, pickedFile && styles.dropBoxActive]}
            onPress={handlePickFile}
            activeOpacity={0.8}
          >
            <Ionicons
              name={pickedFile ? 'document-attach' : 'cloud-upload-outline'}
              size={40}
              color={pickedFile ? '#F59E0B' : '#9CA3AF'}
            />
            <Text style={[styles.dropBoxText, pickedFile && styles.dropBoxTextActive]}>
              {pickedFile
                ? pickedFile.name
                : (isRTL ? 'اضغط لاختيار ملف' : 'Tap to select file')}
            </Text>
            {pickedFile && (
              <Text style={styles.dropBoxMeta}>
                {formatBytes(pickedFile.size)} · {friendlyMime(pickedFile.mimeType)}
              </Text>
            )}
          </TouchableOpacity>

          {/* Progress bar */}
          {uploadProgress > 0 && (
            <View style={styles.progressTrack}>
              <View style={[styles.progressFill, { width: `${uploadProgress}%` }]} />
              <Text style={styles.progressLabel}>{uploadProgress}%</Text>
            </View>
          )}

          {pickedFile && !uploading && (
            <TouchableOpacity style={styles.clearPickBtn} onPress={() => setPickedFile(null)}>
              <Ionicons name="close-circle-outline" size={16} color="#9CA3AF" />
              <Text style={styles.clearPickText}>{isRTL ? 'إلغاء الاختيار' : 'Clear selection'}</Text>
            </TouchableOpacity>
          )}

          <TouchableOpacity
            style={[styles.uploadBtn, (!pickedFile || uploading) && styles.uploadBtnDisabled]}
            onPress={handleUpload}
            disabled={!pickedFile || uploading}
          >
            {uploading ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <>
                <Ionicons name="cloud-upload" size={18} color="#fff" />
                <Text style={styles.uploadBtnText}>{isRTL ? 'رفع الملف' : 'Upload File'}</Text>
              </>
            )}
          </TouchableOpacity>
        </View>

        {/* Existing files (expandable cards) */}
        <Text style={[styles.sectionTitle, isRTL && styles.textRight]}>
          {isRTL ? `الملفات المرفوعة (${items.length})` : `Uploaded Files (${items.length})`}
        </Text>

        {loadingItems ? (
          <ActivityIndicator color="#F59E0B" style={{ marginTop: 24 }} />
        ) : items.length === 0 ? (
          <View style={styles.emptyBox}>
            <Ionicons name="cloud-upload-outline" size={40} color="#D1D5DB" />
            <Text style={styles.emptyText}>{isRTL ? 'لا توجد ملفات بعد' : 'No files yet'}</Text>
          </View>
        ) : (
          items.map((item) => {
            const { icon, color } = getFileIcon(item.file_type);
            const expanded = expandedId === item.id;
            return (
              <TouchableOpacity
                key={item.id}
                style={styles.fileCard}
                onPress={() => setExpandedId(expanded ? null : item.id)}
                activeOpacity={0.85}
              >
                {/* Collapsed row */}
                <View style={styles.fileRow}>
                  <View style={[styles.fileIconWrap, { backgroundColor: color + '15' }]}>
                    <Ionicons name={icon} size={26} color={color} />
                  </View>
                  <View style={styles.fileInfo}>
                    <Text style={styles.fileName} numberOfLines={1}>
                      {item.title || item.file_name || (isRTL ? 'بدون اسم' : 'Unnamed')}
                    </Text>
                    <Text style={styles.fileMeta}>
                      {formatBytes(item.file_size)}
                      {item.file_type ? ` · ${friendlyMime(item.file_type)}` : ''}
                    </Text>
                  </View>
                  <View style={styles.fileActions}>
                    <View style={[styles.statusDot, { backgroundColor: item.status === 'ready' ? '#10B981' : '#F59E0B' }]} />
                    <TouchableOpacity
                      onPress={() => handleDelete(item.id)}
                      style={styles.deleteBtn}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    >
                      <Ionicons name="trash-outline" size={18} color="#EF4444" />
                    </TouchableOpacity>
                    <Ionicons
                      name={expanded ? 'chevron-up' : 'chevron-down'}
                      size={16}
                      color="#9CA3AF"
                    />
                  </View>
                </View>

                {/* Expanded preview */}
                {expanded && (
                  <View style={styles.expandedSection}>
                    <View style={[styles.expandedRow, isRTL && { flexDirection: 'row-reverse' }]}>
                      <View style={styles.expandedMeta}>
                        <Text style={styles.expandedLabel}>
                          {isRTL ? 'الحجم' : 'Size'}
                        </Text>
                        <Text style={styles.expandedValue}>{formatBytes(item.file_size)}</Text>
                      </View>
                      <View style={styles.expandedMeta}>
                        <Text style={styles.expandedLabel}>
                          {isRTL ? 'النوع' : 'Type'}
                        </Text>
                        <Text style={styles.expandedValue}>{friendlyMime(item.file_type)}</Text>
                      </View>
                      <View style={styles.expandedMeta}>
                        <Text style={styles.expandedLabel}>
                          {isRTL ? 'الحالة' : 'Status'}
                        </Text>
                        <Text style={[styles.expandedValue, { color: item.status === 'ready' ? '#10B981' : '#F59E0B' }]}>
                          {item.status === 'ready'
                            ? (isRTL ? '✓ جاهز' : '✓ Ready')
                            : (isRTL ? '⏳ معالجة' : '⏳ Processing')}
                        </Text>
                      </View>
                    </View>
                    <Text style={[styles.learnedAt, isRTL && { textAlign: 'right' }]}>
                      {isRTL ? 'تاريخ التعلم: ' : 'Learned at: '}
                      {new Date(item.created_at).toLocaleString(isRTL ? 'ar-EG' : 'en-US')}
                    </Text>
                    {item.content && (
                      <Text style={[styles.contentPreview, isRTL && { textAlign: 'right' }]} numberOfLines={4}>
                        {item.content}
                      </Text>
                    )}
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
    gap: 12,
  },
  formLabel: { fontSize: 13, color: '#6B7280', fontWeight: '600' },
  textRight: { textAlign: 'right' },
  dropBox: {
    borderWidth: 2,
    borderStyle: 'dashed',
    borderColor: '#D1D5DB',
    borderRadius: 16,
    padding: 32,
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#F9FAFB',
  },
  dropBoxActive: { borderColor: '#F59E0B', backgroundColor: '#FFFBEB' },
  dropBoxText: { fontSize: 15, color: '#9CA3AF', fontWeight: '600', textAlign: 'center' },
  dropBoxTextActive: { color: '#B45309', fontWeight: '700' },
  dropBoxMeta: { fontSize: 12, color: '#D97706' },
  progressTrack: {
    height: 8,
    backgroundColor: '#E5E7EB',
    borderRadius: 4,
    overflow: 'hidden',
    position: 'relative',
    justifyContent: 'center',
  },
  progressFill: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    backgroundColor: '#F59E0B',
    borderRadius: 4,
  },
  progressLabel: {
    fontSize: 10,
    color: '#6B7280',
    textAlign: 'center',
    zIndex: 1,
  },
  clearPickBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'center' },
  clearPickText: { fontSize: 13, color: '#9CA3AF' },
  uploadBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#F59E0B',
    borderRadius: 14,
    paddingVertical: 14,
  },
  uploadBtnDisabled: { backgroundColor: '#D1D5DB' },
  uploadBtnText: { color: '#fff', fontSize: 16, fontWeight: '800' },
  sectionTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: '#1F2937',
    paddingHorizontal: 16,
    marginTop: 8,
    marginBottom: 12,
  },
  emptyBox: { alignItems: 'center', justifyContent: 'center', paddingVertical: 40, gap: 12 },
  emptyText: { color: '#9CA3AF', fontSize: 15 },
  fileCard: {
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
  fileRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    gap: 12,
  },
  fileIconWrap: {
    width: 48,
    height: 48,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fileInfo: { flex: 1, gap: 3 },
  fileName: { fontSize: 14, fontWeight: '700', color: '#1F2937' },
  fileMeta: { fontSize: 12, color: '#6B7280' },
  fileActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  deleteBtn: { padding: 4 },
  expandedSection: {
    borderTopWidth: 1,
    borderTopColor: '#F3F4F6',
    padding: 14,
    gap: 10,
    backgroundColor: '#FAFAFA',
  },
  expandedRow: { flexDirection: 'row', gap: 16 },
  expandedMeta: { flex: 1, gap: 2 },
  expandedLabel: { fontSize: 11, color: '#9CA3AF', fontWeight: '600', textTransform: 'uppercase' },
  expandedValue: { fontSize: 13, color: '#1F2937', fontWeight: '700' },
  learnedAt: { fontSize: 12, color: '#9CA3AF' },
  contentPreview: {
    fontSize: 12,
    color: '#6B7280',
    lineHeight: 18,
    backgroundColor: '#F3F4F6',
    borderRadius: 8,
    padding: 10,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
});
