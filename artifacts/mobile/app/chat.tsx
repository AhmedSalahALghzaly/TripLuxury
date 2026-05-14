/**
 * Chat Screen - Full-Screen Route
 * Accessed from floating chat button via router.push('/chat')
 *
 * Tab visibility rules:
 *   Direct (Conversations) — all authenticated users
 *   Trash                 — owner only
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useLocalSearchParams } from 'expo-router';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  Platform,
  StatusBar,
  Animated,
} from 'react-native';
import type { ComponentProps } from 'react';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useTheme } from '../src/hooks/useTheme';
import { useTranslation } from '../src/hooks/useTranslation';
import { useChat } from '../src/hooks/useChat';
import DirectChatTab from '../src/components/chat/DirectChatTab';
import TrashTab from '../src/components/chat/TrashTab';

type IoniconName = ComponentProps<typeof Ionicons>['name'];
type TabId = 'direct' | 'trash';

interface TabDef {
  id: TabId;
  labelAr: string;
  labelEn: string;
  icon: IoniconName;
  showWhen: 'all' | 'owner';
}

const TABS: TabDef[] = [
  {
    id: 'direct',
    labelAr: 'المحادثات',
    labelEn: 'Chats',
    icon: 'chatbubbles',
    showWhen: 'all',
  },
  {
    id: 'trash',
    labelAr: 'المحذوفات',
    labelEn: 'Trash',
    icon: 'trash',
    showWhen: 'owner',
  },
];

export default function ChatScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const { language, isRTL } = useTranslation();
  const { conversationId: deepLinkConvId } = useLocalSearchParams<{ conversationId?: string }>();

  const {
    user,
    userRole,
    isPrivileged,
    conversations,
    deletedConversations,
    activeConversation,
    messages,
    loading,
    sending,
    loadConversations,
    loadDeletedConversations,
    openConversation,
    setActiveConversation,
    sendMessage,
    getOrCreateCustomerConversation,
    restoreConversation,
    archiveConversation,
    permanentlyDeleteConversation,
    setConvAiAutoReply,
  } = useChat();

  // Deep-link support: when navigated to /chat?conversationId=X, auto-open
  // that conversation as soon as the conversations list is loaded. Tracks
  // the last opened id so we don't keep re-opening on every render.
  const openedDeepLinkRef = useRef<string | null>(null);
  useEffect(() => {
    if (!deepLinkConvId || typeof deepLinkConvId !== 'string') return;
    if (openedDeepLinkRef.current === deepLinkConvId) return;
    const target = conversations.find((c) => c.id === deepLinkConvId);
    if (target) {
      openedDeepLinkRef.current = deepLinkConvId;
      openConversation(target);
    }
  }, [deepLinkConvId, conversations, openConversation]);

  const isOwner = userRole === 'owner';

  const visibleTabs = TABS.filter((t) => {
    if (t.showWhen === 'owner') return isOwner;
    return true;
  });

  const [activeTab, setActiveTab] = useState<TabId>('direct');
  const fadeAnim = useRef(new Animated.Value(1)).current;

  const handleBack = () => {
    if (activeConversation) {
      setActiveConversation(null);
    } else {
      router.back();
    }
  };

  const handleTabChange = useCallback(
    (id: TabId) => {
      if (id === activeTab) return;
      Animated.timing(fadeAnim, { toValue: 0, duration: 120, useNativeDriver: true }).start(() => {
        setActiveConversation(null);
        setActiveTab(id);
        if (id === 'direct') loadConversations();
        if (id === 'trash') loadDeletedConversations();
        Animated.timing(fadeAnim, { toValue: 1, duration: 180, useNativeDriver: true }).start();
      });
    },
    [activeTab, fadeAnim],
  );

  const renderContent = () => {
    switch (activeTab) {
      case 'direct':
        return (
          <DirectChatTab
            isPrivileged={isPrivileged}
            isOwner={isOwner}
            conversations={conversations}
            activeConversation={activeConversation}
            messages={messages}
            loading={loading}
            sending={sending}
            isRTL={isRTL}
            onOpen={openConversation}
            onBack={() => setActiveConversation(null)}
            onSend={sendMessage}
            onMount={isPrivileged ? loadConversations : getOrCreateCustomerConversation}
            currentUserId={user?.id}
            currentUserEmail={user?.email}
            onArchive={archiveConversation}
            onAiAutoReplyChange={setConvAiAutoReply}
          />
        );
      case 'trash':
        return (
          <TrashTab
            deletedConversations={deletedConversations}
            loading={loading}
            isPrivileged={isOwner}
            isRTL={isRTL}
            onRestore={restoreConversation}
            onDelete={permanentlyDeleteConversation}
            onMount={loadDeletedConversations}
          />
        );
      default:
        return null;
    }
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Gradient Header */}
      <LinearGradient colors={['#1E3A8A', '#2563EB']} style={styles.header}>
        <TouchableOpacity
          onPress={handleBack}
          style={styles.headerBtn}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Ionicons
            name={isRTL ? 'chevron-forward' : 'chevron-back'}
            size={24}
            color="#fff"
          />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle}>
            {language === 'ar' ? 'مركز الدعم' : 'Support Center'}
          </Text>
          <Text style={styles.headerSubtitle}>
            {language === 'ar' ? 'مطعم الغزالي' : 'Al-Ghazaly Dining'}
          </Text>
        </View>
        <View style={styles.headerRight}>
          <View style={styles.onlineDot} />
        </View>
      </LinearGradient>

      {/* Tab Bar — only shows when owner (trash tab exists) */}
      {visibleTabs.length > 1 && (
        <View
          style={[
            styles.tabBar,
            { backgroundColor: colors.card, borderBottomColor: colors.border },
          ]}
        >
          {visibleTabs.map((tab) => {
            const isActive = activeTab === tab.id;
            const label = language === 'ar' ? tab.labelAr : tab.labelEn;
            return (
              <TouchableOpacity
                key={tab.id}
                style={[
                  styles.tabItem,
                  isActive && [styles.tabItemActive, { borderBottomColor: colors.primary }],
                ]}
                onPress={() => handleTabChange(tab.id)}
                activeOpacity={0.7}
              >
                <Ionicons
                  name={tab.icon}
                  size={18}
                  color={isActive ? colors.primary : colors.textSecondary}
                />
                <Text
                  style={[
                    styles.tabLabel,
                    { color: isActive ? colors.primary : colors.textSecondary },
                    isActive && styles.tabLabelActive,
                  ]}
                >
                  {label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      )}

      {/* Content — fades on tab switch */}
      <Animated.View style={[styles.content, { opacity: fadeAnim }]}>
        {renderContent()}
      </Animated.View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 14,
    paddingTop:
      Platform.OS === 'android' ? (StatusBar.currentHeight ?? 0) + 14 : 14,
  },
  headerBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerCenter: { flex: 1, alignItems: 'center' },
  headerTitle: { color: '#fff', fontSize: 17, fontWeight: '800' },
  headerSubtitle: {
    color: 'rgba(255,255,255,0.75)',
    fontSize: 12,
    fontWeight: '500',
    marginTop: 1,
  },
  headerRight: { width: 36, alignItems: 'center', justifyContent: 'center' },
  onlineDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#10B981',
    borderWidth: 2,
    borderColor: '#fff',
  },
  tabBar: { flexDirection: 'row', borderBottomWidth: 1 },
  tabItem: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    paddingVertical: 12,
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  tabItemActive: { borderBottomWidth: 2 },
  tabLabel: { fontSize: 13, fontWeight: '600' },
  tabLabelActive: { fontWeight: '800' },
  content: { flex: 1 },
});
