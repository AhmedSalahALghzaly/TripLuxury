import { useState, useEffect, useRef, useCallback } from 'react';
import { chatApi } from '../services/api';
import { useAppStore } from '../store/appStore';

export interface Message {
  id: string;
  conversation_id: string;
  sender_id?: string;
  sender_type: 'customer' | 'admin' | 'owner' | 'ai_agent';
  sender_name?: string;
  sender_picture?: string;
  content: string;
  message_type: string;
  file_url?: string;
  // Numeric coords from the server are returned as strings by node-pg
  // (NUMERIC type), so accept either form here and let the renderer
  // coerce as needed.
  latitude?: number | string | null;
  longitude?: number | string | null;
  address?: string | null;
  is_read: boolean;
  created_at: string;
}

export interface SendMessageExtras {
  latitude?: number;
  longitude?: number;
  address?: string;
}

export interface Conversation {
  id: string;
  user_id?: string;
  user_name?: string;
  user_email?: string;
  user_role?: string;
  type: string;
  status: string;
  unread_count: number;
  last_message?: string;
  last_message_at?: string;
  created_at: string;
  updated_at?: string;
  ai_auto_reply?: boolean;
}

function buildWsUrl(sessionToken?: string | null) {
  const base = process.env.EXPO_PUBLIC_DOMAIN
    ? `wss://${process.env.EXPO_PUBLIC_DOMAIN}/api/ws`
    : 'ws://localhost:8080/api/ws';
  // Pass the session token so the server can validate it server-side (never the user_id directly)
  return sessionToken ? `${base}?token=${encodeURIComponent(sessionToken)}` : base;
}

export function useChat() {
  const user = useAppStore((s) => s.user);
  const userRole = useAppStore((s) => s.userRole);

  const [conversations, _setConversations] = useState<Conversation[]>([]);
  const [deletedConversations, setDeletedConversations] = useState<Conversation[]>([]);
  // Mirror conversations in a ref so we can deterministically read the
  // current value (e.g. inside optimistic-update flows) without depending
  // on React's batched setState semantics.
  const conversationsRef = useRef<Conversation[]>([]);
  // Wrapper that always keeps the ref synchronized with the state — every
  // mutation path (load, WS patch, optimistic archive, manual setters)
  // funnels through here so consumers can trust conversationsRef.current.
  const setConversations = useCallback(
    (next: React.SetStateAction<Conversation[]>) => {
      _setConversations((prev) => {
        const resolved = typeof next === 'function' ? (next as (p: Conversation[]) => Conversation[])(prev) : next;
        conversationsRef.current = resolved;
        return resolved;
      });
    },
    [],
  );
  const [activeConversation, setActiveConversation] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [aiMessages, setAiMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);

  const wsRef = useRef<WebSocket | null>(null);
  // Tracks the deferred reconnect timer so we can cancel it during
  // intentional teardown (effect cleanup, sessionToken rotation,
  // explicit logout). Without this, a stale onclose-scheduled
  // reconnect can race a freshly-opened socket and leave two parallel
  // connections — each handling chat_message broadcasts and double-
  // appending bubbles.
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Marks closes that we initiated on purpose (cleanup, token rotation,
  // user logout). The onclose handler consults this before scheduling
  // a reconnect so intentional teardowns don't immediately re-open
  // the socket.
  const intentionalCloseRef = useRef(false);
  const isMountedRef = useRef(true);
  const aiConversationIdRef = useRef<string | null>(null);
  // Debounce conversation list reloads triggered by WS bursts so the optimistic
  // last_message patch applied above isn't immediately clobbered by a refetch.
  const reloadConvTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Keep a ref so the WS handler always sees the latest activeConversation
  const activeConversationRef = useRef<Conversation | null>(null);
  // Tracks ai_auto_reply state per conversation (keyed by conversation id)
  // Updated when conversations load and when the admin toggles the switch
  const aiAutoReplyRef = useRef<Record<string, boolean>>({});
  // Dedup set: prevents a message from triggering more than one auto-reply
  // (handles reconnect + replayed WS events). Entries expire after 5 min.
  const processedAutoReplyRef = useRef<Set<string>>(new Set());
  // Mirror of isPrivileged as a ref so the WS closure always reads latest value
  const isPrivilegedRef = useRef(false);

  const isPrivileged = userRole === 'admin' || userRole === 'owner';

  // Keep isPrivilegedRef in sync so the WS closure reads the latest value
  useEffect(() => {
    isPrivilegedRef.current = isPrivileged;
  }, [isPrivileged]);

  const sessionToken = useAppStore((s) => s.sessionToken);
  // Mirror connectWs in a ref so the deferred reconnect inside
  // `ws.onclose` always invokes the LATEST connection function (built
  // with the current sessionToken). Without this, a token rotation
  // mid-session would leave the WS reconnecting with a stale token
  // and silently dropping subsequent chat_message broadcasts.
  const connectWsRef = useRef<() => void>(() => {});

  const connectWs = useCallback(() => {
    if (!isMountedRef.current) return;
    // Guard both OPEN and CONNECTING — without the CONNECTING check a
    // burst of effect re-runs (or a reconnect timer firing while the
    // previous socket is still in handshake) can spin up parallel
    // sockets that each receive every broadcast.
    const rs = wsRef.current?.readyState;
    if (rs === WebSocket.OPEN || rs === WebSocket.CONNECTING) return;
    // Any pending reconnect is now superseded by this fresh attempt.
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    intentionalCloseRef.current = false;
    try {
      const ws = new WebSocket(buildWsUrl(sessionToken));
      wsRef.current = ws;
      ws.onmessage = (evt) => {
        if (!isMountedRef.current) return;
        try {
          const data = JSON.parse(evt.data);
          if (data.type === 'chat_message' || data.type === 'ai_message') {
            // Defensive guard: a malformed broadcast (e.g. server emits
            // `data:` instead of `message:` for a chat_message) would land
            // here as `undefined` and crash `prev.some(c => c.id === msg.conversation_id)`.
            // Drop the frame quietly rather than tearing down the chat UI
            // for the entire app.
            const msg: Message | undefined = data.message;
            if (!msg || !msg.conversation_id) return;
            const activeCid = activeConversationRef.current?.id ?? null;
            // Append to message list if it belongs to the currently open conversation.
            // Two dedupe paths:
            //   1. Exact ID match — server already delivered (POST response or
            //      a prior WS re-broadcast). Skip.
            //   2. Optimistic-echo match — we're the sender, an optimistic
            //      `temp-…` bubble already exists with the same content /
            //      sender / message_type / file_url. Replace the temp in
            //      place so the FlatList key transitions cleanly from
            //      `temp-…` → real id WITHOUT a full array swap that would
            //      reset scroll position.
            setMessages((prev) => {
              if (prev.find((m) => m.id === msg.id)) return prev;
              if (activeCid && msg.conversation_id === activeCid) {
                const tempIdx = prev.findIndex(
                  (m) =>
                    typeof m.id === 'string' &&
                    m.id.startsWith('temp-') &&
                    m.sender_type === msg.sender_type &&
                    (m.content || '') === (msg.content || '') &&
                    (m.file_url || null) === (msg.file_url || null) &&
                    (m.message_type || 'text') === (msg.message_type || 'text'),
                );
                if (tempIdx >= 0) {
                  const next = prev.slice();
                  next[tempIdx] = msg;
                  return next;
                }
                return [...prev, msg];
              }
              return prev;
            });
            // Instantly update last_message + unread_count, then re-sort so
            // the conversation jumps to the top of the list (matches the
            // server's `ORDER BY last_message_at DESC` ordering).
            // If the conversation isn't in the list yet (new customer's
            // first message arriving at an admin/owner inbox), force an
            // immediate refetch so the new conversation appears in real
            // time instead of waiting for the 1.5s debounced reconciliation.
            let conversationKnown = true;
            setConversations((prev) => {
              const exists = prev.some((c) => c.id === msg.conversation_id);
              if (!exists) {
                conversationKnown = false;
                return prev;
              }
              const patched = prev.map((c) =>
                c.id === msg.conversation_id
                  ? {
                      ...c,
                      last_message: msg.content || c.last_message,
                      last_message_at: msg.created_at,
                      updated_at: msg.created_at,
                      // Only increment unread for conversations NOT currently open
                      unread_count:
                        activeCid === msg.conversation_id
                          ? c.unread_count
                          : (c.unread_count ?? 0) + 1,
                    }
                  : c,
              );
              return [...patched].sort((a, b) => {
                const ta = a.last_message_at ? new Date(a.last_message_at).getTime() : 0;
                const tb = b.last_message_at ? new Date(b.last_message_at).getTime() : 0;
                return tb - ta;
              });
            });
            loadUnreadCount();
            // If this WS broadcast belongs to a conversation we don't have
            // yet (new customer's first message arriving at admin/owner
            // inbox), refetch the list immediately so the new conversation
            // appears in real time. Otherwise debounce by 1.5s to coalesce
            // bursts (e.g. customer message + AI auto-reply).
            if (!conversationKnown) {
              if (reloadConvTimerRef.current) {
                clearTimeout(reloadConvTimerRef.current);
                reloadConvTimerRef.current = null;
              }
              if (isMountedRef.current) loadConversations(true);
            } else {
              // Debounce list refetch — many WS messages arrive in quick bursts
              // (e.g. when the AI auto-reply lands right after a customer msg)
              // and an immediate full reload clobbers our optimistic patch.
              if (reloadConvTimerRef.current) {
                clearTimeout(reloadConvTimerRef.current);
              }
              reloadConvTimerRef.current = setTimeout(() => {
              // silent=true: this is a background reconciliation refetch
              // triggered by an incoming WS broadcast. Do NOT toggle the
              // shared `loading` flag — ConversationView shows a full-
              // screen loading spinner whenever `loading` is true, which
              // would yank the chat FlatList out of the tree mid-
              // conversation (especially visible after a customer
              // message that triggers a server-side AI auto-reply ~2.5s
              // later — the AI broadcast arrives, debounce timer
              // re-arms, refetch runs, list flickers back to top).
              if (isMountedRef.current) loadConversations(true);
              reloadConvTimerRef.current = null;
            }, 1500);
            }

            // ── AI AUTO-REPLY TRIGGER ─────────────────────────────────────────
            // Only fire when:
            //   1. Current user is privileged (admin/owner)
            //   2. Incoming message is from a customer (not self, not AI)
            //   3. The conversation has AI auto-reply enabled (local toggle state)
            //   4. This message has not already been attempted locally (pre-flight dedup)
            //
            // Server-side idempotency: /chat/auto-reply atomically flips
            // ai_auto_reply_sent on the message row (UPDATE ... WHERE ... = FALSE
            // RETURNING id). Only the first caller wins; all others get { skipped }.
            // This prevents duplicate replies even when multiple privileged users
            // are connected simultaneously.
            // If toggle state is not yet known for this conversation (startup race),
            // still attempt the call — the server reads the DB flag directly and
            // will skip if ai_auto_reply is false on the conversation.
            const toggleKnown = msg.conversation_id in aiAutoReplyRef.current;
            const toggleEnabled = !toggleKnown || aiAutoReplyRef.current[msg.conversation_id] === true;
            if (
              isPrivilegedRef.current &&
              msg.sender_type === 'customer' &&
              toggleEnabled &&
              !processedAutoReplyRef.current.has(msg.id)
            ) {
              processedAutoReplyRef.current.add(msg.id);
              // Expire local dedup entry after 5 min to prevent memory growth
              setTimeout(() => processedAutoReplyRef.current.delete(msg.id), 5 * 60 * 1000);

              (async () => {
                try {
                  await chatApi.triggerAutoReply({
                    message_id: msg.id,
                    conversation_id: msg.conversation_id,
                  });
                  // Server broadcasts the AI reply via WS — no further action needed
                } catch (e) {
                  console.error('[AutoReply] trigger failed:', e);
                }
              })();
            }
            // ── END AUTO-REPLY TRIGGER ────────────────────────────────────────
          }
        } catch {}
      };
      ws.onerror = () => {};
      ws.onclose = () => {
        // Skip reconnect when the close was intentional (effect
        // cleanup, token rotation, user logout) — otherwise we'd
        // immediately rebuild the socket we just tore down.
        if (!isMountedRef.current || intentionalCloseRef.current) {
          intentionalCloseRef.current = false;
          return;
        }
        if (reconnectTimerRef.current) {
          clearTimeout(reconnectTimerRef.current);
        }
        // Read latest connectWs via ref so reconnect picks up any
        // sessionToken rotation that occurred while the socket was
        // open.
        reconnectTimerRef.current = setTimeout(() => {
          reconnectTimerRef.current = null;
          connectWsRef.current();
        }, 3000);
      };
    } catch {}
  }, [sessionToken]);

  // Keep the ref in sync with the latest connectWs after every render
  // where sessionToken (and therefore connectWs) changed.
  useEffect(() => {
    connectWsRef.current = connectWs;
  }, [connectWs]);

  useEffect(() => {
    isMountedRef.current = true;
    if (user) {
      // Tear down any prior socket before opening a new one — important
      // when sessionToken rotates while the user is logged in (the
      // server-side channel auth changes and the old socket becomes
      // a no-op). Mark the close as intentional so the previous
      // socket's onclose doesn't schedule a competing reconnect.
      if (wsRef.current) {
        intentionalCloseRef.current = true;
        try { wsRef.current.close(); } catch {}
        wsRef.current = null;
      }
      // Cancel any deferred reconnect that may have been queued by
      // an earlier onclose — the new connectWs() call below supersedes
      // it and re-uses the latest sessionToken.
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      connectWs();
    }
    return () => {
      isMountedRef.current = false;
      if (reloadConvTimerRef.current) {
        clearTimeout(reloadConvTimerRef.current);
        reloadConvTimerRef.current = null;
      }
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      // Mark close as intentional so onclose doesn't reschedule.
      intentionalCloseRef.current = true;
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, [user, sessionToken]);

  const loadUnreadCount = useCallback(async () => {
    try {
      const res = await chatApi.getUnreadCount();
      setUnreadCount(res.data?.unread_count ?? 0);
    } catch {}
  }, []);

  // `silent=true` skips toggling the shared `loading` flag — used by the
  // WS-debounced background refetch so it doesn't make ConversationView
  // briefly swap its FlatList out for a loading spinner (which would
  // unmount the list, lose scroll position, and re-mount at the top
  // when the refetch resolves ~50-200ms later). Visible call sites
  // (initial mount, manual pull-to-refresh) keep `silent=false` so the
  // user still sees a loading state on first load.
  const loadConversations = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const res = await chatApi.getConversations();
      const data: Conversation[] = Array.isArray(res.data) ? res.data : (res.data?.conversations ?? []);
      setConversations(data);
      // Seed aiAutoReplyRef — preserve any explicitly-toggled state (don't overwrite existing keys)
      data.forEach((c) => {
        if (!(c.id in aiAutoReplyRef.current)) {
          aiAutoReplyRef.current[c.id] = c.ai_auto_reply !== false;
        }
      });
    } catch {
      if (!silent) setConversations([]);
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  const loadDeletedConversations = useCallback(async () => {
    try {
      const res = await chatApi.getDeletedConversations();
      const data = Array.isArray(res.data) ? res.data : (res.data?.conversations ?? []);
      setDeletedConversations(data);
    } catch {
      setDeletedConversations([]);
    }
  }, []);

  const loadMessages = useCallback(async (conversationId: string) => {
    setLoading(true);
    try {
      const res = await chatApi.getMessages(conversationId);
      const data = Array.isArray(res.data) ? res.data : (res.data?.messages ?? []);
      setMessages(data);
      await chatApi.markMessagesRead(conversationId);
      loadUnreadCount();
    } catch {
      setMessages([]);
    } finally {
      setLoading(false);
    }
  }, [loadUnreadCount]);

  const openConversation = useCallback(async (conv: Conversation) => {
    activeConversationRef.current = conv;
    setActiveConversation(conv);
    // Optimistically clear the unread count for this conversation so
    // the pulsing red badge on the customer rail / conversation row
    // stops immediately on tap. Server-side mark-as-read (inside
    // loadMessages) and the follow-up loadUnreadCount() will reconcile
    // any drift moments later.
    setConversations((prev) =>
      prev.map((c) => (c.id === conv.id ? { ...c, unread_count: 0 } : c)),
    );
    await loadMessages(conv.id);
  }, [loadMessages, setConversations]);

  const sendMessage = useCallback(async (
    content: string,
    message_type = 'text',
    file_url?: string,
    extras?: SendMessageExtras,
  ) => {
    // Allow media/file/location sends with empty text; block only pure empty-text sends
    const hasMedia = !!file_url && message_type !== 'text';
    const hasCoords =
      message_type === 'location' &&
      typeof extras?.latitude === 'number' &&
      typeof extras?.longitude === 'number';
    if (!activeConversation || (!content.trim() && !hasMedia && !hasCoords) || sending) return;
    const convId = activeConversation.id;
    const tempId = `temp-${Date.now()}`;
    // Optimistic update — show message immediately before server round-trip
    // Use the actual role so the bubble renders on the correct side with correct colour
    const senderType: Message['sender_type'] =
      userRole === 'owner' ? 'owner' :
      userRole === 'admin' ? 'admin' :
      'customer';
    const optimistic: Message = {
      id: tempId,
      conversation_id: convId,
      sender_type: senderType,
      content: content.trim(),
      message_type,
      file_url,
      latitude: hasCoords ? extras!.latitude! : undefined,
      longitude: hasCoords ? extras!.longitude! : undefined,
      address: hasCoords ? extras?.address : undefined,
      is_read: true,
      created_at: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, optimistic]);
    setSending(true);
    try {
      const res = await chatApi.sendMessage({
        conversation_id: convId,
        content: content.trim(),
        message_type,
        file_url,
        ...(hasCoords ? {
          latitude: extras!.latitude!,
          longitude: extras!.longitude!,
          address: extras?.address,
        } : {}),
      });
      // Replace the optimistic temp bubble with the server-returned real one
      // IN PLACE — this swaps a single array element instead of replacing
      // the whole list. Critical for FlatList scroll stability: a full
      // refetch (the previous `await loadMessages(convId)` call) would
      // hand FlatList a brand-new array reference with one different key
      // at the end (temp-… → real id), causing it to re-mount that row
      // and snap scroll back toward the top after the cascade had
      // already landed at the bottom.
      //
      // If the WS broadcast arrived first (race), it already swapped the
      // temp via the optimistic-echo dedup in the onmessage handler — in
      // that case `prev.id === tempId` matches nothing here and this is a
      // safe no-op. The same is true if the server-returned payload
      // shape is unexpected (defensive null check).
      const realMsg: Message | undefined = (res?.data as any)?.message;
      if (realMsg && realMsg.id) {
        setMessages((prev) =>
          prev.map((m) => (m.id === tempId ? realMsg : m)),
        );
      }
      // Optimistically bump the conversation row's last_message / sort
      // order locally so the rail re-orders without waiting for a full
      // refetch (which used to happen implicitly via loadMessages →
      // openConversation flow). The debounced WS-driven loadConversations
      // (1500ms after the broadcast lands) reconciles any drift.
      if (realMsg) {
        setConversations((prev) => {
          const patched = prev.map((c) =>
            c.id === convId
              ? {
                  ...c,
                  last_message: realMsg.content || c.last_message,
                  last_message_at: realMsg.created_at,
                  updated_at: realMsg.created_at,
                }
              : c,
          );
          return [...patched].sort((a, b) => {
            const ta = a.last_message_at ? new Date(a.last_message_at).getTime() : 0;
            const tb = b.last_message_at ? new Date(b.last_message_at).getTime() : 0;
            return tb - ta;
          });
        });
      }
    } catch (e) {
      // Remove optimistic message on error
      setMessages((prev) => prev.filter((m) => m.id !== tempId));
    } finally {
      setSending(false);
    }
  }, [activeConversation, sending, userRole]);

  const getOrCreateCustomerConversation = useCallback(async () => {
    setLoading(true);
    try {
      const res = await chatApi.getConversations();
      const convs: Conversation[] = Array.isArray(res.data) ? res.data : (res.data?.conversations ?? []);
      if (convs.length > 0) {
        setConversations(convs);
        await openConversation(convs[0]);
      } else {
        const created = await chatApi.createConversation({ type: 'customer_support' });
        const newConv: Conversation = created.data?.conversation ?? created.data;
        setConversations([newConv]);
        await openConversation(newConv);
      }
    } catch (err) {
      console.error('[useChat] getOrCreateCustomerConversation failed:', err);
    } finally {
      setLoading(false);
    }
  }, [openConversation]);

  const sendAiMessage = useCallback(async (content: string) => {
    if (!content.trim() || sending) return;
    const userMsg: Message = {
      id: `temp-${Date.now()}`,
      conversation_id: aiConversationIdRef.current ?? '',
      sender_type: 'customer',
      content: content.trim(),
      message_type: 'text',
      is_read: true,
      created_at: new Date().toISOString(),
    };
    setAiMessages((prev) => [...prev, userMsg]);
    setSending(true);
    try {
      const res = await chatApi.sendAiMessage({
        message: content.trim(),
        conversation_id: aiConversationIdRef.current ?? undefined,
      });
      const reply = res.data;
      if (reply?.conversation_id) {
        aiConversationIdRef.current = reply.conversation_id;
      }
      const aiMsg: Message = {
        id: `ai-${Date.now()}`,
        conversation_id: reply?.conversation_id ?? '',
        sender_type: 'ai_agent',
        content: reply?.response ?? reply?.message ?? 'عذراً، حدث خطأ.',
        message_type: 'text',
        is_read: true,
        created_at: new Date().toISOString(),
      };
      setAiMessages((prev) => [...prev, aiMsg]);
    } catch {
      const errMsg: Message = {
        id: `err-${Date.now()}`,
        conversation_id: '',
        sender_type: 'ai_agent',
        content: 'عذراً، حدث خطأ في الاتصال بالمساعد.',
        message_type: 'text',
        is_read: true,
        created_at: new Date().toISOString(),
      };
      setAiMessages((prev) => [...prev, errMsg]);
    } finally {
      setSending(false);
    }
  }, [sending]);

  const restoreConversation = useCallback(async (id: string) => {
    try {
      await chatApi.restoreConversation(id);
      await loadDeletedConversations();
      await loadConversations();
    } catch {}
  }, [loadDeletedConversations, loadConversations]);

  const archiveConversation = useCallback(async (id: string) => {
    // Capture snapshot deterministically from the ref BEFORE any state
    // updates — React's setState callback runs asynchronously and is not
    // guaranteed to populate a closure-scoped variable by the time the
    // next line executes.
    const snapshot = conversationsRef.current.find((c) => c.id === id);
    // Optimistic transfer: remove from active list and prepend to trash
    // list immediately so both DirectChatTab and TrashTab reflect the
    // change without waiting for the network round-trip.
    if (snapshot) {
      const nextActive = conversationsRef.current.filter((c) => c.id !== id);
      setConversations(nextActive);
      setDeletedConversations((prev) =>
        prev.some((c) => c.id === id)
          ? prev
          : [{ ...snapshot, status: 'deleted', updated_at: new Date().toISOString() }, ...prev],
      );
    }
    try {
      await chatApi.updateConversationStatus(id, 'deleted');
      await loadConversations();
      await loadDeletedConversations();
    } catch (err) {
      // Revert optimistic move on failure
      if (snapshot) {
        const reverted = [snapshot, ...conversationsRef.current.filter((c) => c.id !== id)];
        setConversations(reverted);
        setDeletedConversations((prev) => prev.filter((c) => c.id !== id));
      }
      throw err;
    }
  }, [loadConversations, loadDeletedConversations]);

  const permanentlyDeleteConversation = useCallback(async (id: string) => {
    try {
      await chatApi.permanentlyDeleteConversation(id);
      setDeletedConversations((prev) => prev.filter((c) => c.id !== id));
    } catch {}
  }, []);

  return {
    user,
    userRole,
    isPrivileged,
    conversations,
    deletedConversations,
    activeConversation,
    messages,
    aiMessages,
    loading,
    sending,
    unreadCount,
    setActiveConversation: (conv: Conversation | null) => {
      activeConversationRef.current = conv;
      setActiveConversation(conv);
    },
    loadConversations,
    loadDeletedConversations,
    loadUnreadCount,
    openConversation,
    sendMessage,
    sendAiMessage,
    setAiConversationId: (id: string | null) => { aiConversationIdRef.current = id; },
    getOrCreateCustomerConversation,
    restoreConversation,
    archiveConversation,
    permanentlyDeleteConversation,
    // Update ai_auto_reply state for a specific conversation in the ref
    // Called by DirectChatTab when the admin toggles the AI indicator
    setConvAiAutoReply: (convId: string, enabled: boolean) => {
      aiAutoReplyRef.current[convId] = enabled;
    },
  };
}
