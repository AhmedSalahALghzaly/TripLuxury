import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  FlatList,
  StyleSheet,
  ActivityIndicator,
  Alert,
  Modal,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withSequence,
  withTiming,
} from "react-native-reanimated";
import { useTheme } from "../../hooks/useTheme";
import { Conversation, Message } from "../../hooks/useChat";
import { customerApi, chatApi, ConversationGroup } from "../../services/api";
import ConversationView from "./ConversationView";

const GROUP_COLORS = [
  '#7C3AED', '#2563EB', '#10B981', '#F59E0B',
  '#EF4444', '#EC4899', '#06B6D4',
];

const RAIL_WIDTH = 80;
const DEBOUNCE_MS = 300;

interface CustomerInfo {
  id: string;
  user_id?: string;
  name?: string;
  email?: string;
  phone?: string;
  status?: string;
  role?: string;
}

interface Props {
  isPrivileged: boolean;
  isOwner: boolean;
  conversations: Conversation[];
  activeConversation: Conversation | null;
  messages: Message[];
  loading: boolean;
  sending: boolean;
  isRTL: boolean;
  onOpen: (conv: Conversation) => void;
  onBack: () => void;
  onSend: (
    content: string,
    message_type?: string,
    file_url?: string,
    extras?: { latitude?: number; longitude?: number; address?: string },
  ) => void;
  onMount: () => void;
  currentUserId?: string;
  currentUserEmail?: string;
  onArchive: (id: string) => void;
  onAiAutoReplyChange?: (convId: string, enabled: boolean) => void;
}

function getInitials(name: string): string {
  const parts = (name ?? "").trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return (name ?? "?").slice(0, 2).toUpperCase() || "?";
}

function useDebounce<T>(value: T, delay: number): T {
  const [deb, setDeb] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDeb(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return deb;
}

function OnlineGlow({ isOpen }: { isOpen: boolean }) {
  const opacity = useSharedValue(0);
  useEffect(() => {
    if (isOpen) {
      opacity.value = withRepeat(
        withSequence(
          withTiming(1, { duration: 1200 }),
          withTiming(0.3, { duration: 1200 }),
        ),
        -1,
        false,
      );
    } else {
      opacity.value = withTiming(0, { duration: 300 });
    }
  }, [isOpen]);
  const style = useAnimatedStyle(() => ({ opacity: opacity.value }));
  if (!isOpen) return null;
  return <Animated.View style={[st.glow, style]} />;
}

function UnreadPulse({ count }: { count: number }) {
  const scale = useSharedValue(1);
  useEffect(() => {
    if (count > 0) {
      scale.value = withRepeat(
        withSequence(
          withTiming(1.35, { duration: 500 }),
          withTiming(1, { duration: 500 }),
        ),
        -1,
        false,
      );
    } else {
      scale.value = withTiming(1);
    }
  }, [count]);
  const style = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));
  if (count <= 0) return null;
  return (
    <Animated.View style={[st.badge, style]}>
      <Text style={st.badgeText}>{count > 9 ? "9+" : count}</Text>
    </Animated.View>
  );
}

function RoleBadge({ role }: { role?: string }) {
  if (role !== 'owner' && role !== 'admin') return null;
  return (
    <View style={[st.roleBadge, { backgroundColor: role === 'owner' ? '#F59E0B' : '#2563EB' }]}>
      <Text style={st.roleBadgeText}>{role === 'owner' ? '👑' : '🛡️'}</Text>
    </View>
  );
}

function AvatarRailItem({
  displayName,
  isActive,
  isOpen,
  isOwner,
  totalUnread,
  aiAutoReply,
  isPrivileged,
  userRole: userRoleProp,
  onPress,
  onLongPress,
  onToggleAi,
  isRTL,
  colors,
}: {
  displayName: string;
  isActive: boolean;
  isOpen: boolean;
  isOwner: boolean;
  totalUnread: number;
  aiAutoReply: boolean;
  isPrivileged: boolean;
  userRole?: string;
  onPress: () => void;
  onLongPress: () => void;
  onToggleAi?: () => void;
  isRTL: boolean;
  colors: ReturnType<typeof useTheme>["colors"];
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      onLongPress={isOwner ? onLongPress : undefined}
      delayLongPress={600}
      activeOpacity={0.75}
      style={[
        st.railItem,
        isActive && {
          backgroundColor: colors.primary + "15",
          borderLeftWidth: isRTL ? 0 : 3,
          borderRightWidth: isRTL ? 3 : 0,
          borderLeftColor: isRTL ? "transparent" : colors.primary,
          borderRightColor: isRTL ? colors.primary : "transparent",
        },
      ]}
    >
      <View style={st.avatarWrap}>
        <OnlineGlow isOpen={isOpen} />
        <View
          style={[
            st.avatarCircle,
            {
              backgroundColor: isActive
                ? colors.primary
                : colors.primary + "30",
              borderColor: isOpen ? "#10B981" : colors.border,
            },
          ]}
        >
          <Text
            style={[
              st.avatarInitials,
              { color: isActive ? "#fff" : colors.primary },
            ]}
          >
            {getInitials(displayName)}
          </Text>
        </View>
        <UnreadPulse count={totalUnread} />
        {isPrivileged && (
          <TouchableOpacity
            onPress={onToggleAi}
            style={[
              st.aiIndicator,
              { backgroundColor: aiAutoReply ? '#7C3AED' : colors.surface, borderColor: aiAutoReply ? '#7C3AED' : colors.border },
            ]}
            hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
            activeOpacity={0.7}
          >
            <Ionicons name="sparkles" size={8} color={aiAutoReply ? '#fff' : colors.textSecondary} />
          </TouchableOpacity>
        )}
        <RoleBadge role={userRoleProp} />
      </View>
    </TouchableOpacity>
  );
}

export default function DirectChatTab({
  isPrivileged,
  isOwner,
  conversations,
  activeConversation,
  messages,
  loading,
  sending,
  isRTL,
  onOpen,
  onBack,
  onSend,
  onMount,
  currentUserId,
  currentUserEmail,
  onArchive,
  onAiAutoReplyChange,
}: Props) {
  const { colors } = useTheme();
  const [searchText, setSearchText] = useState("");
  const debouncedSearch = useDebounce(searchText, DEBOUNCE_MS);
  const [customers, setCustomers] = useState<Map<string, CustomerInfo>>(
    new Map(),
  );

  useEffect(() => {
    onMount();
    if (isPrivileged) {
      customerApi
        .getAll()
        .then((res) => {
          const list: CustomerInfo[] = res.data?.customers ?? [];
          const map = new Map<string, CustomerInfo>();
          list.forEach((c) => {
            const key = c.user_id ?? c.id;
            if (key) map.set(key, c);
          });
          setCustomers(map);
        })
        .catch(() => {});
      loadGroups();
    }
  }, []);

  const getCustomerName = (conv: Conversation): string => {
    const c = customers.get(conv.user_id ?? "");
    return c?.name ?? conv.user_name ?? conv.user_email ?? "عميل";
  };

  // These two must live before filteredConversations (which references them)
  const [groups, setGroups] = useState<ConversationGroup[]>([]);
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);

  const filteredConversations = useMemo(() => {
    let result = conversations;
    // Filter by selected group
    if (selectedGroupId) {
      const grp = groups.find((g) => g.id === selectedGroupId);
      const ids = new Set(grp?.conversation_ids ?? []);
      result = result.filter((c) => ids.has(c.id));
    }
    // Filter by search text
    if (debouncedSearch.trim()) {
      const q = debouncedSearch.toLowerCase();
      result = result.filter((c) => {
        const cust = customers.get(c.user_id ?? "");
        const name = cust?.name ?? c.user_name ?? "";
        const email = cust?.email ?? c.user_email ?? "";
        const phone = cust?.phone ?? "";
        return (
          name.toLowerCase().includes(q) ||
          email.toLowerCase().includes(q) ||
          phone.includes(q)
        );
      });
    }
    return result;
  }, [conversations, debouncedSearch, customers, selectedGroupId, groups]);

  const dedupedUsers = useMemo(() => {
    const seenUserIds = new Set<string>();
    const result: {
      userId: string;
      displayName: string;
      latestConv: Conversation;
      totalUnread: number;
      aiAutoReply: boolean;
      userRole?: string;
    }[] = [];

    filteredConversations.forEach((conv) => {
      const uid = conv.user_id ?? conv.id;
      if (seenUserIds.has(uid)) {
        const existing = result.find((r) => r.userId === uid);
        if (existing) {
          existing.totalUnread += conv.unread_count ?? 0;
          if (
            new Date(conv.updated_at ?? 0) >
            new Date(existing.latestConv.updated_at ?? 0)
          ) {
            existing.latestConv = conv;
          }
        }
      } else {
        seenUserIds.add(uid);
        const cust = customers.get(uid);
        result.push({
          userId: uid,
          displayName: getCustomerName(conv),
          latestConv: conv,
          totalUnread: conv.unread_count ?? 0,
          aiAutoReply: conv.ai_auto_reply !== false,
          userRole: cust?.role ?? conv.user_role,
        });
      }
    });

    return result;
  }, [filteredConversations, customers]);

  const [aiToggleStates, setAiToggleStates] = useState<Record<string, boolean>>({});

  // Seed aiToggleStates from the conversations list (server value) whenever conversations update.
  // Only fills in conversations not yet explicitly toggled this session.
  useEffect(() => {
    if (!isPrivileged) return;
    setAiToggleStates((prev) => {
      const next = { ...prev };
      let changed = false;
      conversations.forEach((c) => {
        if (!(c.id in next)) {
          next[c.id] = c.ai_auto_reply !== false;
          changed = true;
        }
      });
      return changed ? next : prev;
    });
  }, [conversations, isPrivileged]);
  const [suggestedReplies, setSuggestedReplies] = useState<string[]>([]);
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);
  const suggestionsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Group Management State ──────────────────────────────────────────────
  const [groupModalVisible, setGroupModalVisible] = useState(false);
  const [newGroupName, setNewGroupName] = useState('');
  const [newGroupColor, setNewGroupColor] = useState(GROUP_COLORS[0]);
  const [selectedConvIds, setSelectedConvIds] = useState<Set<string>>(new Set());
  const [creatingGroup, setCreatingGroup] = useState(false);
  const [editingGroup, setEditingGroup] = useState<ConversationGroup | null>(null);

  const loadGroups = useCallback(async () => {
    if (!isPrivileged) return;
    try {
      const res = await chatApi.getGroups();
      setGroups(res.data?.groups ?? []);
    } catch { setGroups([]); }
  }, [isPrivileged]);

  const openCreateModal = useCallback(() => {
    setEditingGroup(null);
    setNewGroupName('');
    setNewGroupColor(GROUP_COLORS[0]);
    setSelectedConvIds(new Set());
    setGroupModalVisible(true);
  }, []);

  const openEditModal = useCallback((g: ConversationGroup) => {
    setEditingGroup(g);
    setNewGroupName(g.name);
    setNewGroupColor(g.color);
    setSelectedConvIds(new Set(g.conversation_ids));
    setGroupModalVisible(true);
  }, []);

  const handleSaveGroup = useCallback(async () => {
    const name = newGroupName.trim();
    if (!name) { Alert.alert('تنبيه', 'يرجى إدخال اسم المجموعة'); return; }
    setCreatingGroup(true);
    try {
      const ids = Array.from(selectedConvIds);
      if (editingGroup) {
        const res = await chatApi.updateGroup(editingGroup.id, { name, color: newGroupColor, conversation_ids: ids });
        setGroups((prev) => prev.map((g) => g.id === editingGroup.id ? (res.data?.group ?? g) : g));
      } else {
        const res = await chatApi.createGroup({ name, color: newGroupColor, conversation_ids: ids });
        if (res.data?.group) setGroups((prev) => [res.data.group, ...prev]);
      }
      setGroupModalVisible(false);
    } catch { Alert.alert('خطأ', 'فشل حفظ المجموعة'); }
    finally { setCreatingGroup(false); }
  }, [newGroupName, newGroupColor, selectedConvIds, editingGroup]);

  const handleDeleteGroup = useCallback((g: ConversationGroup) => {
    Alert.alert('حذف المجموعة', `هل تريد حذف مجموعة "${g.name}"؟`, [
      { text: 'إلغاء', style: 'cancel' },
      { text: 'حذف', style: 'destructive', onPress: async () => {
        try {
          await chatApi.deleteGroup(g.id);
          setGroups((prev) => prev.filter((x) => x.id !== g.id));
          if (selectedGroupId === g.id) setSelectedGroupId(null);
        } catch { Alert.alert('خطأ', 'فشل حذف المجموعة'); }
      }},
    ]);
  }, [selectedGroupId]);

  const toggleConvInModal = useCallback((convId: string) => {
    setSelectedConvIds((prev) => {
      const next = new Set(prev);
      if (next.has(convId)) next.delete(convId); else next.add(convId);
      return next;
    });
  }, []);

  const fetchSuggestions = useCallback(async (convId: string) => {
    if (!isPrivileged) return;
    setSuggestionsLoading(true);
    try {
      const res = await chatApi.suggestReplies(convId);
      setSuggestedReplies(res.data?.suggestions ?? []);
    } catch {
      setSuggestedReplies([]);
    } finally {
      setSuggestionsLoading(false);
    }
  }, [isPrivileged]);

  useEffect(() => {
    if (!isPrivileged || !activeConversation) {
      setSuggestedReplies([]);
      setSuggestionsLoading(false);
      return;
    }
    const convId = activeConversation.id;
    setSuggestedReplies([]);
    if (suggestionsTimerRef.current) clearTimeout(suggestionsTimerRef.current);
    suggestionsTimerRef.current = setTimeout(() => fetchSuggestions(convId), 800);
    return () => {
      if (suggestionsTimerRef.current) clearTimeout(suggestionsTimerRef.current);
    };
  }, [activeConversation?.id, isPrivileged]);

  useEffect(() => {
    if (!isPrivileged || !activeConversation || messages.length === 0) return;
    const lastMsg = messages[messages.length - 1];
    if (lastMsg?.sender_type === 'customer') {
      if (suggestionsTimerRef.current) clearTimeout(suggestionsTimerRef.current);
      suggestionsTimerRef.current = setTimeout(() => fetchSuggestions(activeConversation.id), 1200);
    }
  }, [messages.length]);

  const handleUseSuggestedReply = useCallback((text: string) => {
    onSend(text, 'text');
    setSuggestedReplies([]);
  }, [onSend]);

  const handleToggleAiAutoReply = useCallback(
    async (conv: Conversation, currentState: boolean) => {
      const next = !currentState;
      const convId = conv.id;
      setAiToggleStates((prev) => ({ ...prev, [convId]: next }));
      // Keep the useChat aiAutoReplyRef in sync so the WS handler always reflects latest state
      onAiAutoReplyChange?.(convId, next);
      try {
        await chatApi.toggleAiAutoReply(convId, next);
      } catch {
        setAiToggleStates((prev) => ({ ...prev, [convId]: currentState }));
        onAiAutoReplyChange?.(convId, currentState);
        Alert.alert("خطأ", "فشل تغيير إعداد الرد التلقائي");
      }
    },
    [onAiAutoReplyChange],
  );

  const confirmArchive = useCallback(
    (conv: Conversation) => {
      const name = getCustomerName(conv);
      const title = "أرشفة المحادثة";
      const body = `هل تريد أرشفة محادثة "${name}"؟ ستنتقل إلى سلة المحذوفات.`;
      const doArchive = async () => {
        try {
          // Close the open view immediately for instant UX; the conversation
          // will be transferred from active to trash in the next refetch
          // (and optimistically inside useChat.archiveConversation).
          if (activeConversation?.id === conv.id) onBack();
          await onArchive(conv.id);
        } catch (err: unknown) {
          const apiDetail = (err as { response?: { data?: { detail?: string } } }).response?.data?.detail;
          Alert.alert('خطأ', apiDetail ?? 'تعذّر أرشفة المحادثة');
        }
      };
      // Alert.alert is unreliable on web — fall back to window.confirm.
      if (Platform.OS === 'web') {
        // eslint-disable-next-line no-alert
        if (typeof window !== 'undefined' && window.confirm(`${title}\n\n${body}`)) {
          void doArchive();
        }
        return;
      }
      Alert.alert(title, body, [
        { text: "إلغاء", style: "cancel" },
        { text: "أرشفة", style: "destructive", onPress: doArchive },
      ]);
    },
    [onArchive, onBack, activeConversation, customers],
  );

  const [broadcastVisible, setBroadcastVisible] = useState(false);
  const [broadcastText, setBroadcastText] = useState("");
  const [broadcasting, setBroadcasting] = useState(false);

  const handleAiBroadcast = useCallback(() => {
    setBroadcastVisible(true);
  }, []);

  const handleSendBroadcast = useCallback(async () => {
    const text = broadcastText.trim();
    if (!text) return;
    // Send only to currently filtered conversations (respects selected group)
    const targets = filteredConversations.length > 0 ? filteredConversations : conversations;
    if (targets.length === 0) {
      Alert.alert("تنبيه", "لا توجد محادثات للإرسال");
      return;
    }
    setBroadcasting(true);
    let success = 0;
    let failed = 0;
    for (const conv of targets) {
      try {
        await chatApi.sendMessage({ conversation_id: conv.id, content: text, message_type: 'text' });
        success++;
      } catch {
        failed++;
      }
    }
    setBroadcasting(false);
    setBroadcastVisible(false);
    setBroadcastText("");
    Alert.alert(
      "تم الإرسال الجماعي",
      `✅ نجح: ${success} محادثة${failed > 0 ? `\n❌ فشل: ${failed}` : ""}`,
    );
  }, [broadcastText, filteredConversations, conversations]);

  if (loading && conversations.length === 0) {
    return (
      <View style={st.centered}>
        <ActivityIndicator color={colors.primary} size="large" />
      </View>
    );
  }

  if (!isPrivileged) {
    if (activeConversation) {
      return (
        <ConversationView
          conversation={activeConversation}
          messages={messages}
          loading={loading}
          sending={sending}
          isPrivileged={false}
          isOwner={false}
          currentUserId={currentUserId}
          onSend={onSend}
          onBack={onBack}
          isRTL={isRTL}
        />
      );
    }
    return (
      <View style={st.centered}>
        <Ionicons
          name="chatbubbles-outline"
          size={56}
          color={colors.textSecondary}
        />
        <Text style={[st.emptyTitle, { color: colors.text }]}>مرحباً بك!</Text>
        <Text style={[st.emptySub, { color: colors.textSecondary }]}>
          ستبدأ محادثتك مع الدعم تلقائياً
        </Text>
      </View>
    );
  }

  return (
    <View style={{ flex: 1 }}>
      {/* ── Broadcast Modal ── */}
      <Modal
        visible={broadcastVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setBroadcastVisible(false)}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={st.broadcastOverlay}
        >
          <View style={[st.broadcastSheet, { backgroundColor: colors.card }]}>
            <LinearGradient colors={['#7C3AED', '#4C1D95']} style={st.broadcastHeader}>
              <View style={st.broadcastHeaderContent}>
                <View style={st.broadcastIconCircle}>
                  <Ionicons name="megaphone" size={22} color="#fff" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={st.broadcastTitle}>إرسال جماعي</Text>
                  <Text style={st.broadcastSub}>
                    {selectedGroupId
                      ? `${filteredConversations.length} محادثة في المجموعة`
                      : `${conversations.length} محادثة نشطة`}
                  </Text>
                </View>
                <TouchableOpacity onPress={() => setBroadcastVisible(false)} style={st.broadcastClose}>
                  <Ionicons name="close" size={20} color="rgba(255,255,255,0.7)" />
                </TouchableOpacity>
              </View>
            </LinearGradient>

            <View style={st.broadcastBody}>
              <Text style={[st.broadcastLabel, { color: colors.textSecondary }]}>نص الرسالة الجماعية</Text>
              <TextInput
                style={[st.broadcastInput, { backgroundColor: colors.background, borderColor: '#7C3AED40', color: colors.text }]}
                value={broadcastText}
                onChangeText={setBroadcastText}
                placeholder="اكتب رسالتك هنا... (ستُرسل لجميع المحادثات)"
                placeholderTextColor={colors.textSecondary}
                multiline
                textAlign="right"
                autoFocus
              />
              <View style={st.broadcastActions}>
                <TouchableOpacity
                  style={[st.broadcastCancelBtn, { borderColor: colors.border }]}
                  onPress={() => setBroadcastVisible(false)}
                >
                  <Text style={[st.broadcastCancelText, { color: colors.textSecondary }]}>إلغاء</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[st.broadcastSendBtn, { opacity: !broadcastText.trim() || broadcasting ? 0.5 : 1 }]}
                  onPress={handleSendBroadcast}
                  disabled={!broadcastText.trim() || broadcasting}
                >
                  <LinearGradient colors={['#7C3AED', '#4C1D95']} style={st.broadcastSendGrad}>
                    {broadcasting ? (
                      <ActivityIndicator size="small" color="#fff" />
                    ) : (
                      <>
                        <Ionicons name="send" size={16} color="#fff" />
                        <Text style={st.broadcastSendText}>إرسال للجميع</Text>
                      </>
                    )}
                  </LinearGradient>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* ── Group Creation Modal ── */}
      <Modal
        visible={groupModalVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setGroupModalVisible(false)}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={st.broadcastOverlay}
        >
          <View style={[st.broadcastSheet, { backgroundColor: colors.card, maxHeight: '90%' }]}>
            <LinearGradient colors={['#2563EB', '#1E3A8A']} style={st.broadcastHeader}>
              <View style={st.broadcastHeaderContent}>
                <View style={st.broadcastIconCircle}>
                  <Ionicons name="people" size={22} color="#fff" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={st.broadcastTitle}>{editingGroup ? 'تعديل المجموعة' : 'مجموعة جديدة'}</Text>
                  <Text style={st.broadcastSub}>{selectedConvIds.size} محادثة مختارة</Text>
                </View>
                <TouchableOpacity onPress={() => setGroupModalVisible(false)} style={st.broadcastClose}>
                  <Ionicons name="close" size={20} color="rgba(255,255,255,0.7)" />
                </TouchableOpacity>
              </View>
            </LinearGradient>

            <ScrollView style={{ flex: 1 }} keyboardShouldPersistTaps="handled">
              <View style={st.broadcastBody}>
                {/* Group Name */}
                <Text style={[st.broadcastLabel, { color: colors.textSecondary }]}>اسم المجموعة</Text>
                <TextInput
                  style={[st.broadcastInput, { backgroundColor: colors.background, borderColor: '#2563EB40', color: colors.text, minHeight: 48, textAlignVertical: 'center' }]}
                  value={newGroupName}
                  onChangeText={setNewGroupName}
                  placeholder="مثال: عملاء VIP، طلبات معلقة..."
                  placeholderTextColor={colors.textSecondary}
                  textAlign="right"
                  autoFocus
                />

                {/* Color Picker */}
                <Text style={[st.broadcastLabel, { color: colors.textSecondary, marginTop: 8 }]}>لون المجموعة</Text>
                <View style={{ flexDirection: 'row', gap: 10, marginBottom: 16 }}>
                  {GROUP_COLORS.map((c) => (
                    <TouchableOpacity
                      key={c}
                      onPress={() => setNewGroupColor(c)}
                      style={[
                        st.colorDot,
                        { backgroundColor: c },
                        newGroupColor === c && st.colorDotSelected,
                      ]}
                    >
                      {newGroupColor === c && <Ionicons name="checkmark" size={14} color="#fff" />}
                    </TouchableOpacity>
                  ))}
                </View>

                {/* Conversation Multi-Select */}
                <Text style={[st.broadcastLabel, { color: colors.textSecondary }]}>
                  اختر المحادثات ({selectedConvIds.size} مختار)
                </Text>
                {dedupedUsers.map((u) => {
                  const isSelected = selectedConvIds.has(u.latestConv.id);
                  return (
                    <TouchableOpacity
                      key={u.userId}
                      style={[
                        st.convPickRow,
                        { backgroundColor: isSelected ? colors.primary + '15' : colors.background, borderColor: isSelected ? colors.primary : colors.border },
                      ]}
                      onPress={() => toggleConvInModal(u.latestConv.id)}
                      activeOpacity={0.75}
                    >
                      <View style={[st.convPickAvatar, { backgroundColor: colors.primary + '25' }]}>
                        <Text style={[st.convPickInitials, { color: colors.primary }]}>
                          {getInitials(u.displayName)}
                        </Text>
                      </View>
                      <Text style={[st.convPickName, { color: colors.text, flex: 1 }]} numberOfLines={1}>
                        {u.displayName}
                      </Text>
                      <View style={[
                        st.checkbox,
                        { borderColor: isSelected ? colors.primary : colors.border, backgroundColor: isSelected ? colors.primary : 'transparent' },
                      ]}>
                        {isSelected && <Ionicons name="checkmark" size={12} color="#fff" />}
                      </View>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </ScrollView>

            <View style={[st.broadcastBody, { paddingTop: 0 }]}>
              <View style={st.broadcastActions}>
                <TouchableOpacity
                  style={[st.broadcastCancelBtn, { borderColor: colors.border }]}
                  onPress={() => setGroupModalVisible(false)}
                >
                  <Text style={[st.broadcastCancelText, { color: colors.textSecondary }]}>إلغاء</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[st.broadcastSendBtn, { opacity: !newGroupName.trim() || creatingGroup ? 0.5 : 1 }]}
                  onPress={handleSaveGroup}
                  disabled={!newGroupName.trim() || creatingGroup}
                >
                  <LinearGradient colors={['#2563EB', '#1E3A8A']} style={st.broadcastSendGrad}>
                    {creatingGroup ? (
                      <ActivityIndicator size="small" color="#fff" />
                    ) : (
                      <>
                        <Ionicons name="save" size={16} color="#fff" />
                        <Text style={st.broadcastSendText}>{editingGroup ? 'حفظ التعديلات' : 'إنشاء المجموعة'}</Text>
                      </>
                    )}
                  </LinearGradient>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* ── Search Bar ── */}
      <View
        style={[
          st.searchBar,
          { backgroundColor: colors.card, borderBottomColor: colors.border },
        ]}
      >
        <Ionicons name="search" size={16} color={colors.textSecondary} />
        <TextInput
          style={[st.searchInput, { color: colors.text }]}
          value={searchText}
          onChangeText={setSearchText}
          placeholder="بحث بالاسم أو الجوال..."
          placeholderTextColor={colors.textSecondary}
          textAlign={isRTL ? "right" : "left"}
          returnKeyType="search"
          clearButtonMode="while-editing"
        />
        {searchText.length > 0 && (
          <TouchableOpacity onPress={() => setSearchText("")}>
            <Ionicons
              name="close-circle"
              size={16}
              color={colors.textSecondary}
            />
          </TouchableOpacity>
        )}
      </View>

      {/* ── Group Filter Chips Row ── */}
      {groups.length > 0 && (
        <View style={[st.groupRow, { backgroundColor: colors.card, borderBottomColor: colors.border }]}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={st.groupRowContent}
        >
          {/* "All" chip */}
          <TouchableOpacity
            style={[st.groupChip, { backgroundColor: !selectedGroupId ? colors.primary : colors.background, borderColor: colors.primary }]}
            onPress={() => setSelectedGroupId(null)}
            activeOpacity={0.75}
          >
            <Text style={[st.groupChipText, { color: !selectedGroupId ? '#fff' : colors.primary }]}>الكل</Text>
          </TouchableOpacity>
          {/* Group chips */}
          {groups.map((g) => {
            const active = selectedGroupId === g.id;
            return (
              <TouchableOpacity
                key={g.id}
                style={[st.groupChip, { backgroundColor: active ? g.color : g.color + '18', borderColor: g.color }]}
                onPress={() => setSelectedGroupId(active ? null : g.id)}
                onLongPress={() => openEditModal(g)}
                activeOpacity={0.75}
              >
                <View style={[st.groupChipDot, { backgroundColor: active ? '#fff' : g.color }]} />
                <Text style={[st.groupChipText, { color: active ? '#fff' : g.color }]} numberOfLines={1}>
                  {g.name}
                </Text>
                {active && (
                  <TouchableOpacity
                    onPress={() => handleDeleteGroup(g)}
                    hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
                  >
                    <Ionicons name="close-circle" size={13} color="rgba(255,255,255,0.8)" />
                  </TouchableOpacity>
                )}
              </TouchableOpacity>
            );
          })}
          {/* Add group shortcut */}
          <TouchableOpacity
            style={[st.groupChip, { backgroundColor: 'transparent', borderColor: colors.border, borderStyle: 'dashed' }]}
            onPress={openCreateModal}
            activeOpacity={0.75}
          >
            <Ionicons name="add" size={14} color={colors.textSecondary} />
            <Text style={[st.groupChipText, { color: colors.textSecondary }]}>جديد</Text>
          </TouchableOpacity>
        </ScrollView>
        </View>
      )}

      <View
        style={[st.split, { flexDirection: isRTL ? "row-reverse" : "row" }]}
      >
        <View
          style={[
            st.rail,
            {
              backgroundColor: colors.card,
              borderRightWidth: isRTL ? 0 : StyleSheet.hairlineWidth,
              borderLeftWidth: isRTL ? StyleSheet.hairlineWidth : 0,
              borderColor: colors.border,
            },
          ]}
        >
          <TouchableOpacity
            style={[st.aiBroadcast, { borderBottomColor: colors.border }]}
            onPress={handleAiBroadcast}
            activeOpacity={0.75}
          >
            <View style={[st.aiBroadcastCircle, { backgroundColor: "#7C3AED20" }]}>
              <Ionicons name="sparkles" size={18} color="#7C3AED" />
            </View>
          </TouchableOpacity>
          <TouchableOpacity
            style={[st.aiBroadcast, { borderBottomColor: colors.border }]}
            onPress={openCreateModal}
            activeOpacity={0.75}
          >
            <View style={[st.aiBroadcastCircle, { backgroundColor: "#2563EB20" }]}>
              <Ionicons name="people" size={19} color="#2563EB" />
            </View>
          </TouchableOpacity>

          {dedupedUsers.length === 0 ? (
            <View style={st.railEmpty}>
              <Ionicons
                name="chatbubbles-outline"
                size={24}
                color={colors.textSecondary}
              />
            </View>
          ) : (
            <ScrollView
              showsVerticalScrollIndicator={false}
              contentContainerStyle={{ paddingVertical: 4 }}
            >
              {dedupedUsers.map((u) => {
                const effectiveAi = aiToggleStates[u.latestConv.id] ?? u.aiAutoReply;
                const isActiveConv = activeConversation?.id === u.latestConv.id;
                return (
                  <AvatarRailItem
                    key={u.userId}
                    displayName={u.displayName}
                    isActive={
                      activeConversation?.user_id === u.userId ||
                      activeConversation?.id === u.latestConv.id
                    }
                    isOpen={isActiveConv}
                    isOwner={isOwner}
                    totalUnread={u.totalUnread}
                    aiAutoReply={effectiveAi}
                    isPrivileged={isPrivileged}
                    userRole={u.userRole}
                    onPress={() => onOpen(u.latestConv)}
                    onLongPress={() => confirmArchive(u.latestConv)}
                    onToggleAi={() => handleToggleAiAutoReply(u.latestConv, effectiveAi)}
                    isRTL={isRTL}
                    colors={colors}
                  />
                );
              })}
            </ScrollView>
          )}
        </View>

        <View style={{ flex: 1 }}>
          {activeConversation ? (
            <ConversationView
              conversation={activeConversation}
              messages={messages}
              loading={loading}
              sending={sending}
              isPrivileged={isPrivileged}
              isOwner={isOwner}
              currentUserId={currentUserId}
              customerInfo={customers.get(activeConversation.user_id ?? "")}
              onSend={onSend}
              onBack={onBack}
              onArchive={isPrivileged && activeConversation
                ? (_id: string) => confirmArchive(activeConversation)
                : undefined}
              isRTL={isRTL}
              suggestedReplies={isPrivileged ? suggestedReplies : []}
              suggestionsLoading={isPrivileged ? suggestionsLoading : false}
              onUseSuggestedReply={isPrivileged ? handleUseSuggestedReply : undefined}
            />
          ) : (
            <View style={st.noSel}>
              <Ionicons
                name={
                  conversations.length === 0
                    ? "chatbubbles-outline"
                    : "hand-left-outline"
                }
                size={42}
                color={colors.textSecondary}
              />
              <Text style={[st.noSelTitle, { color: colors.text }]}>
                {conversations.length === 0 ? "لا توجد محادثات" : "اختر محادثة"}
              </Text>
              <Text style={[st.noSelSub, { color: colors.textSecondary }]}>
                {conversations.length === 0
                  ? "ستظهر هنا محادثات العملاء"
                  : "اضغط على أحد الأيقونات"}
              </Text>
            </View>
          )}
        </View>
      </View>
    </View>
  );
}

const st = StyleSheet.create({
  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    padding: 24,
  },
  emptyTitle: { fontSize: 18, fontWeight: "700" },
  emptySub: { fontSize: 14, textAlign: "center" },
  searchBar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 8,
  },
  searchInput: { flex: 1, fontSize: 14, padding: 0 },
  split: { flex: 1 },
  rail: { width: RAIL_WIDTH },
  aiBroadcast: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  aiBroadcastCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
  },
  railEmpty: { alignItems: "center", paddingTop: 20 },
  railItem: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 8,
    borderLeftWidth: 3,
    borderRightWidth: 3,
    borderLeftColor: "transparent",
    borderRightColor: "transparent",
  },
  avatarWrap: { position: "relative", width: 50, height: 50 },
  glow: {
    position: "absolute",
    top: -2,
    left: -2,
    right: -2,
    bottom: -2,
    borderRadius: 27,
    borderWidth: 2.5,
    borderColor: "#10B981",
  },
  avatarCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
    position: "absolute",
    top: 3,
    left: 3,
  },
  avatarInitials: { fontSize: 13, fontWeight: "800" },
  badge: {
    position: "absolute",
    top: 0,
    right: 0,
    minWidth: 17,
    height: 17,
    borderRadius: 8.5,
    backgroundColor: "#EF4444",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 3,
    borderWidth: 1.5,
    borderColor: "#fff",
  },
  badgeText: { color: "#fff", fontSize: 9, fontWeight: "800" },
  aiIndicator: {
    position: "absolute",
    bottom: 0,
    right: 0,
    width: 16,
    height: 16,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1.5,
  },
  noSel: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    padding: 24,
    opacity: 0.6,
  },
  noSelTitle: { fontSize: 16, fontWeight: "700" },
  noSelSub: { fontSize: 13, textAlign: "center" },
  broadcastOverlay: {
    flex: 1, backgroundColor: '#4444070',
    justifyContent: 'flex-end',
  },
  broadcastSheet: {
    borderTopLeftRadius: 24, borderTopRightRadius: 24,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.3,
    shadowRadius: 16,
    elevation: 16,
  },
  broadcastHeader: { padding: 16 },
  broadcastHeaderContent: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
  },
  broadcastIconCircle: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center', justifyContent: 'center',
  },
  broadcastTitle: { color: '#fff', fontSize: 17, fontWeight: '800' },
  broadcastSub: { color: 'rgba(255,255,255,0.7)', fontSize: 12, marginTop: 1 },
  broadcastClose: {
    width: 32, height: 32, borderRadius: 16,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.15)',
  },
  broadcastBody: { padding: 16 },
  broadcastLabel: { fontSize: 13, fontWeight: '600', marginBottom: 8 },
  broadcastInput: {
    borderRadius: 14, borderWidth: 1,
    paddingHorizontal: 14, paddingVertical: 12,
    fontSize: 15, minHeight: 100, textAlignVertical: 'top',
    marginBottom: 16,
  },
  broadcastActions: { flexDirection: 'row', gap: 12 },
  broadcastCancelBtn: {
    flex: 1, paddingVertical: 13, borderRadius: 14,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1,
  },
  broadcastCancelText: { fontSize: 15, fontWeight: '600' },
  broadcastSendBtn: { flex: 2, borderRadius: 14, overflow: 'hidden' },
  broadcastSendGrad: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8, paddingVertical: 13,
  },
  broadcastSendText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  // Role badge (crown/shield on avatar)
  roleBadge: {
    position: 'absolute',
    top: -2,
    left: -2,
    width: 16,
    height: 16,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#fff',
  },
  roleBadgeText: { fontSize: 8 },
  // Group chips row wrapper — compact ~30 px, matches search bar height
  groupRow: {
    height: 30,
    overflow: 'hidden',
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  groupRowContent: {
    paddingHorizontal: 10,
    paddingVertical: 2,
    gap: 6,
    flexDirection: 'row',
    alignItems: 'center',
  },
  groupChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 1,
    borderRadius: 20,
    borderWidth: 1.5,
  },
  groupChipDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  groupChipText: {
    fontSize: 12,
    fontWeight: '700',
    maxWidth: 90,
  },
  // Group modal conversation picker
  convPickRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1.5,
    marginBottom: 8,
  },
  convPickAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  convPickInitials: {
    fontSize: 12,
    fontWeight: '800',
  },
  convPickName: {
    fontSize: 13,
    fontWeight: '600',
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  colorDot: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  colorDotSelected: {
    borderWidth: 2.5,
    borderColor: '#fff',
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
  },
});
