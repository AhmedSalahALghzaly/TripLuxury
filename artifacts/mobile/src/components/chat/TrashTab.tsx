/**
 * Trash Tab — Owner only
 * Shows soft-deleted conversations with:
 *   • Preview action (tap row to see messages)
 *   • Restore action (sets status = 'active')
 *   • Permanent delete action with confirmation alert (DELETE from DB)
 */
import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
  Modal,
  SafeAreaView,
  ScrollView,
  Image,
  Linking,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../hooks/useTheme';
import { Conversation } from '../../hooks/useChat';
import { chatApi } from '../../services/api';

interface Props {
  deletedConversations: Conversation[];
  loading: boolean;
  isPrivileged: boolean;
  isRTL: boolean;
  onRestore: (id: string) => void;
  onDelete: (id: string) => void;
  onMount: () => void;
}

export default function TrashTab({
  deletedConversations,
  loading,
  isPrivileged,
  isRTL,
  onRestore,
  onDelete,
  onMount,
}: Props) {
  const { colors } = useTheme();
  const [previewConv, setPreviewConv] = useState<Conversation | null>(null);
  const [previewMessages, setPreviewMessages] = useState<any[]>([]);
  const [loadingMessages, setLoadingMessages] = useState(false);

  useEffect(() => {
    onMount();
  }, []);

  const openPreview = useCallback(async (conv: Conversation) => {
    setPreviewConv(conv);
    setPreviewMessages([]);
    setLoadingMessages(true);
    try {
      const res = await chatApi.getMessages(conv.id);
      const msgs = Array.isArray(res.data) ? res.data : (res.data?.messages ?? []);
      setPreviewMessages(msgs);
    } catch {
      setPreviewMessages([]);
    } finally {
      setLoadingMessages(false);
    }
  }, []);

  // Two-step destructive confirmation. On web, Alert.alert callbacks are
  // unreliable (some webviews show only the title), so we fall back to
  // window.confirm — same UX, but actually fires onDelete.
  const confirmDelete = (id: string, name: string) => {
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      const ok1 = window.confirm(
        `حذف نهائي\n\nهل تريد حذف محادثة "${name}" نهائياً؟ لا يمكن التراجع عن هذا الإجراء.`,
      );
      if (!ok1) return;
      const ok2 = window.confirm(
        '⚠️ تأكيد الحذف النهائي\n\nسيتم حذف جميع الرسائل والملفات نهائياً. هل أنت متأكد تماماً؟',
      );
      if (!ok2) return;
      onDelete(id);
      return;
    }
    Alert.alert(
      'حذف نهائي',
      `هل تريد حذف محادثة "${name}" نهائياً؟ لا يمكن التراجع عن هذا الإجراء.`,
      [
        { text: 'إلغاء', style: 'cancel' },
        {
          text: 'حذف نهائي',
          style: 'destructive',
          onPress: () => {
            Alert.alert(
              '⚠️ تأكيد الحذف النهائي',
              'سيتم حذف جميع الرسائل والملفات نهائياً. هل أنت متأكد تماماً؟',
              [
                { text: 'تراجع', style: 'cancel' },
                {
                  text: 'نعم، احذف نهائياً',
                  style: 'destructive',
                  onPress: () => onDelete(id),
                },
              ],
            );
          },
        },
      ],
    );
  };

  if (!isPrivileged) {
    return (
      <View style={styles.centered}>
        <Ionicons name="lock-closed-outline" size={48} color={colors.textSecondary} />
        <Text style={[styles.emptyTitle, { color: colors.text }]}>غير متاح</Text>
        <Text style={[styles.emptySubtitle, { color: colors.textSecondary }]}>
          هذا القسم متاح للمالك فقط
        </Text>
      </View>
    );
  }

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color={colors.primary} size="large" />
      </View>
    );
  }

  if (deletedConversations.length === 0) {
    return (
      <View style={styles.centered}>
        <Ionicons name="trash-outline" size={56} color={colors.textSecondary} />
        <Text style={[styles.emptyTitle, { color: colors.text }]}>السلة فارغة</Text>
        <Text style={[styles.emptySubtitle, { color: colors.textSecondary }]}>
          لا توجد محادثات محذوفة
        </Text>
      </View>
    );
  }

  const renderItem = ({ item }: { item: Conversation }) => {
    const displayName = item.user_name ?? item.user_email ?? 'عميل';
    const tsRaw = item.last_message_at ?? item.updated_at ?? item.created_at;
    let tsLabel = '';
    if (tsRaw) {
      try {
        tsLabel = new Date(tsRaw).toLocaleString('ar-EG', {
          day: '2-digit',
          month: 'short',
          hour: '2-digit',
          minute: '2-digit',
        });
      } catch {}
    }
    return (
      <TouchableOpacity
        style={[
          styles.row,
          { backgroundColor: colors.card, borderBottomColor: colors.border },
        ]}
        onPress={() => openPreview(item)}
        activeOpacity={0.7}
      >
        <View style={[styles.avatar, { backgroundColor: colors.textSecondary + '15' }]}>
          <Ionicons name="person" size={18} color={colors.textSecondary} />
        </View>
        <View style={styles.info}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
            <Text style={[styles.name, { color: colors.textSecondary, flex: 1 }]} numberOfLines={1}>
              {displayName}
            </Text>
            {!!tsLabel && (
              <Text style={[styles.preview, { color: colors.textSecondary, fontSize: 11 }]} numberOfLines={1}>
                {tsLabel}
              </Text>
            )}
          </View>
          <Text style={[styles.preview, { color: colors.textSecondary }]} numberOfLines={1}>
            {item.last_message ?? 'محادثة محذوفة'}
          </Text>
        </View>
        <View style={styles.actions}>
          <TouchableOpacity
            style={[styles.actionBtn, { backgroundColor: '#10B98115' }]}
            onPress={(e) => { e.stopPropagation?.(); onRestore(item.id); }}
            hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
          >
            <Ionicons name="refresh" size={15} color="#10B981" />
            <Text style={[styles.actionText, { color: '#10B981' }]}>استعادة</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.actionBtn, { backgroundColor: '#EF444415' }]}
            onPress={(e) => { e.stopPropagation?.(); confirmDelete(item.id, displayName); }}
            hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
          >
            <Ionicons name="trash" size={15} color="#EF4444" />
            <Text style={[styles.actionText, { color: '#EF4444' }]}>حذف نهائي</Text>
          </TouchableOpacity>
        </View>
      </TouchableOpacity>
    );
  };

  const previewDisplayName = previewConv
    ? (previewConv.user_name ?? previewConv.user_email ?? 'عميل')
    : '';

  return (
    <>
      <FlatList
        data={deletedConversations}
        keyExtractor={(c) => c.id}
        renderItem={renderItem}
        contentContainerStyle={{ paddingBottom: 24 }}
        ListHeaderComponent={
          <View style={[styles.header, { borderBottomColor: colors.border }]}>
            <Text style={[styles.headerText, { color: colors.textSecondary }]}>
              {deletedConversations.length} محادثة محذوفة — اضغط لمعاينة • الحذف النهائي لا يمكن التراجع عنه
            </Text>
          </View>
        }
      />

      {/* Preview Modal */}
      <Modal
        visible={!!previewConv}
        animationType="slide"
        transparent={false}
        onRequestClose={() => setPreviewConv(null)}
      >
        <SafeAreaView style={[styles.previewContainer, { backgroundColor: colors.background }]}>
          {/* Header */}
          <View style={[styles.previewHeader, { backgroundColor: colors.card, borderBottomColor: colors.border }]}>
            <TouchableOpacity onPress={() => setPreviewConv(null)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <Ionicons name="close" size={24} color={colors.text} />
            </TouchableOpacity>
            <View style={{ flex: 1, marginHorizontal: 12 }}>
              <Text style={[styles.previewTitle, { color: colors.text }]} numberOfLines={1}>
                {previewDisplayName}
              </Text>
              <Text style={[styles.previewSubtitle, { color: '#EF4444' }]}>معاينة — سلة المحذوفات</Text>
            </View>
            <TouchableOpacity
              style={[styles.actionBtn, { backgroundColor: '#10B98115' }]}
              onPress={() => { setPreviewConv(null); if (previewConv) onRestore(previewConv.id); }}
            >
              <Ionicons name="refresh" size={14} color="#10B981" />
              <Text style={[styles.actionText, { color: '#10B981' }]}>استعادة</Text>
            </TouchableOpacity>
          </View>
          {/* Messages */}
          {loadingMessages ? (
            <View style={styles.centered}>
              <ActivityIndicator color={colors.primary} size="large" />
            </View>
          ) : previewMessages.length === 0 ? (
            <View style={styles.centered}>
              <Ionicons name="chatbubble-outline" size={48} color={colors.textSecondary} />
              <Text style={[styles.emptyTitle, { color: colors.textSecondary }]}>لا توجد رسائل</Text>
            </View>
          ) : (
            <ScrollView contentContainerStyle={{ padding: 12, gap: 8 }}>
              {previewMessages.map((msg: any) => {
                const isCustomer = msg.sender_type === 'customer';
                const isAi = msg.sender_type === 'ai_agent';
                return (
                  <View
                    key={msg.id}
                    style={[
                      styles.msgBubble,
                      isCustomer ? styles.msgRight : styles.msgLeft,
                      { backgroundColor: isCustomer ? '#FFD70020' : isAi ? '#7C3AED15' : colors.card },
                    ]}
                  >
                    {!isCustomer && (
                      <Text style={[styles.msgSender, { color: isAi ? '#7C3AED' : colors.primary }]}>
                        {isAi
                          ? '🤖 ذكاء اصطناعي'
                          : (() => {
                              // Required format: "<icon> <name> · <role>"
                              const icon = msg.sender_type === 'owner' ? '👑' : '👤';
                              const role = msg.sender_type === 'owner' ? 'المالك' : 'مدير';
                              const name =
                                typeof msg.sender_name === 'string' ? msg.sender_name.trim() : '';
                              return name ? `${icon} ${name} · ${role}` : `${icon} ${role}`;
                            })()}
                      </Text>
                    )}
                    {msg.message_type === 'image' && msg.file_url ? (
                      <TouchableOpacity onPress={() => Linking.openURL(msg.file_url).catch(() => {})} activeOpacity={0.85}>
                        <Image
                          source={{ uri: msg.file_url }}
                          style={styles.previewImgThumb}
                          resizeMode="cover"
                        />
                        <Text style={[styles.msgText, { color: colors.textSecondary, fontSize: 10, marginTop: 2 }]}>اضغط للعرض الكامل</Text>
                      </TouchableOpacity>
                    ) : (msg.message_type === 'audio' || msg.message_type === 'voice') && msg.file_url ? (
                      <TouchableOpacity
                        style={styles.mediaRow}
                        onPress={() => Linking.openURL(msg.file_url).catch(() => {})}
                      >
                        <Ionicons name="mic-circle" size={22} color="#7C3AED" />
                        <Text style={[styles.msgText, { color: '#7C3AED', flex: 1 }]}>رسالة صوتية — اضغط للاستماع</Text>
                      </TouchableOpacity>
                    ) : msg.message_type === 'file' && msg.file_url ? (
                      <TouchableOpacity
                        style={styles.mediaRow}
                        onPress={() => Linking.openURL(msg.file_url).catch(() => {})}
                      >
                        <Ionicons name="document-attach" size={20} color={colors.primary} />
                        <Text style={[styles.msgText, { color: colors.primary, flex: 1 }]} numberOfLines={1}>
                          {msg.content || 'ملف مرفق'}
                        </Text>
                      </TouchableOpacity>
                    ) : null}
                    {msg.content && msg.message_type === 'text' ? (
                      <Text style={[styles.msgText, { color: colors.text }]}>{msg.content}</Text>
                    ) : msg.content && msg.message_type !== 'image' && msg.message_type !== 'audio' && msg.message_type !== 'voice' && msg.message_type !== 'file' ? (
                      <Text style={[styles.msgText, { color: colors.text }]}>{msg.content}</Text>
                    ) : null}
                    <Text style={[styles.msgTime, { color: colors.textSecondary }]}>
                      {new Date(msg.created_at).toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' })}
                    </Text>
                  </View>
                );
              })}
            </ScrollView>
          )}
        </SafeAreaView>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    padding: 24,
  },
  emptyTitle: { fontSize: 18, fontWeight: '700' },
  emptySubtitle: { fontSize: 14, textAlign: 'center' },
  header: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerText: { fontSize: 12, fontWeight: '600' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 10,
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  info: { flex: 1, minWidth: 0 },
  name: { fontSize: 13, fontWeight: '600', marginBottom: 2 },
  preview: { fontSize: 11 },
  actions: { flexDirection: 'row', gap: 6 },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 8,
  },
  actionText: { fontSize: 11, fontWeight: '700' },
  previewContainer: { flex: 1 },
  previewHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 8,
  },
  previewTitle: { fontSize: 15, fontWeight: '700' },
  previewSubtitle: { fontSize: 11 },
  msgBubble: {
    maxWidth: '80%',
    padding: 10,
    borderRadius: 14,
    gap: 2,
  },
  msgLeft: { alignSelf: 'flex-start', borderBottomLeftRadius: 4 },
  msgRight: { alignSelf: 'flex-end', borderBottomRightRadius: 4 },
  msgSender: { fontSize: 10, fontWeight: '700', marginBottom: 2 },
  msgText: { fontSize: 13, lineHeight: 18 },
  msgTime: { fontSize: 9, alignSelf: 'flex-end' },
  previewImgThumb: { width: 180, height: 130, borderRadius: 10, marginBottom: 2 },
  mediaRow: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 4 },
});
