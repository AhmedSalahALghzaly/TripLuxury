import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, Dimensions, Modal, SafeAreaView, Platform, StatusBar, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withSequence,
  withTiming,
  withSpring,
  Easing,
  runOnJS,
} from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { createShadow } from '../../utils/shadowUtils';
import AiAgentTab from '../chat/AiAgentTab';
import { useChat } from '../../hooks/useChat';
import { useTranslation } from '../../hooks/useTranslation';
import { useTheme } from '../../hooks/useTheme';
import { COLORS, GLASS, GRADIENTS, OVERLAYS } from '../../constants/luxuryTokens';
import { LUXURY_MOTION } from '../../constants/animations';

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');
const BTN_SIZE = 50;
const EDGE_MARGIN = 16;

export default function FloatingAiAgentIcon() {
  const { colors } = useTheme();
  const { isRTL } = useTranslation();
  const {
    aiMessages,
    sending,
    sendAiMessage,
    setAiConversationId,
  } = useChat();

  const [modalVisible, setModalVisible] = useState(false);

  const posX = useSharedValue(EDGE_MARGIN);
  const posY = useSharedValue(SCREEN_H * 0.55);
  const isDragging = useSharedValue(false);
  const bobOffset = useSharedValue(0);

  // Slow gold-aura pulse driven by the LUXURY_MOTION.conciergeAura preset
  // so the floating button matches the rest of the rebrand.
  const auraScale = useSharedValue(1);
  const auraOpacity = useSharedValue(0.35);

  useEffect(() => {
    bobOffset.value = withRepeat(
      withSequence(
        withTiming(-6, { duration: 3000, easing: Easing.inOut(Easing.sin) }),
        withTiming(0, { duration: 3000, easing: Easing.inOut(Easing.sin) }),
      ),
      -1,
      false,
    );

    auraScale.value = withRepeat(
      withSequence(
        withTiming(1.22, LUXURY_MOTION.conciergeAura),
        withTiming(1, LUXURY_MOTION.conciergeAura),
      ),
      -1,
      false,
    );
    auraOpacity.value = withRepeat(
      withSequence(
        withTiming(0.55, LUXURY_MOTION.conciergeAura),
        withTiming(0.18, LUXURY_MOTION.conciergeAura),
      ),
      -1,
      false,
    );
  }, []);

  const snapToEdge = () => {
    'worklet';
    const targetX =
      posX.value + BTN_SIZE / 2 < SCREEN_W / 2
        ? EDGE_MARGIN
        : SCREEN_W - BTN_SIZE - EDGE_MARGIN;
    const clampedY = Math.max(
      EDGE_MARGIN,
      Math.min(posY.value, SCREEN_H - BTN_SIZE - EDGE_MARGIN - 80),
    );
    posX.value = withSpring(targetX, { damping: 18, stiffness: 180 });
    posY.value = withSpring(clampedY, { damping: 18, stiffness: 180 });
  };

  const openAiChat = () => setModalVisible(true);

  const startX = useSharedValue(0);
  const startY = useSharedValue(0);
  const wasDragged = useSharedValue(false);

  const panGesture = Gesture.Pan()
    .onBegin(() => {
      isDragging.value = true;
      startX.value = posX.value;
      startY.value = posY.value;
      wasDragged.value = false;
    })
    .onUpdate((e) => {
      if (Math.abs(e.translationX) > 4 || Math.abs(e.translationY) > 4) {
        wasDragged.value = true;
      }
      posX.value = startX.value + e.translationX;
      posY.value = startY.value + e.translationY;
    })
    .onEnd(() => {
      isDragging.value = false;
      snapToEdge();
      if (!wasDragged.value) runOnJS(openAiChat)();
    });

  const tapGesture = Gesture.Tap().onEnd(() => runOnJS(openAiChat)());

  const composed = Gesture.Exclusive(panGesture, tapGesture);

  const containerStyle = useAnimatedStyle(() => ({
    position: 'absolute',
    left: posX.value,
    top: posY.value + (isDragging.value ? 0 : bobOffset.value),
    zIndex: 998,
  }));

  const auraStyle = useAnimatedStyle(() => ({
    transform: [{ scale: auraScale.value }],
    opacity: auraOpacity.value,
  }));

  return (
    <>
      <GestureDetector gesture={composed}>
        <Animated.View style={[styles.wrapper, containerStyle]}>
          <Animated.View style={[styles.aura, auraStyle]} />
          <LinearGradient
            colors={[COLORS.goldBright, COLORS.gold, '#9B7B36']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.button}
          >
            <Ionicons name="sparkles" size={22} color={COLORS.charcoalDeep} />
          </LinearGradient>
          <View style={styles.labelBadge}>
            <Text style={styles.labelText}>
              {isRTL ? 'مضيف' : 'CONCIERGE'}
            </Text>
          </View>
        </Animated.View>
      </GestureDetector>

      <Modal
        visible={modalVisible}
        animationType="slide"
        presentationStyle="fullScreen"
        onRequestClose={() => setModalVisible(false)}
      >
        <SafeAreaView style={[styles.modalContainer, { backgroundColor: colors.background }]}>
          <LinearGradient
            colors={GRADIENTS.midnightBistro}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.modalHeader}
          >
            <TouchableOpacity
              onPress={() => setModalVisible(false)}
              style={styles.modalBackBtn}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Ionicons
                name={isRTL ? 'chevron-forward' : 'chevron-back'}
                size={24}
                color={COLORS.ivory}
              />
            </TouchableOpacity>
            <View style={styles.modalHeaderCenter}>
              <View style={styles.modalTitleRow}>
                <Ionicons name="sparkles" size={16} color={COLORS.goldSoft} />
                <Text style={styles.modalTitle}>
                  {isRTL ? 'مضيف غزالي' : 'Ghazaly Concierge'}
                </Text>
              </View>
              <Text style={styles.modalSubtitle}>
                {isRTL
                  ? 'كونسيرج الطعام الفاخر — جاهز لخدمتك'
                  : 'Fine-dining concierge — at your service'}
              </Text>
            </View>
            <View style={styles.modalHeaderRight}>
              <View style={styles.aiBadge}>
                <Text style={styles.aiBadgeText}>AI</Text>
              </View>
            </View>
          </LinearGradient>

          <AiAgentTab
            aiMessages={aiMessages}
            sending={sending}
            isRTL={isRTL}
            onSend={sendAiMessage}
            onSetAiConversationId={setAiConversationId}
          />
        </SafeAreaView>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    ...createShadow(COLORS.gold, 0, 6, 0.45, 16, 8),
    borderRadius: 14,
  },
  aura: {
    position: 'absolute',
    width: BTN_SIZE + 22,
    height: BTN_SIZE + 22,
    borderRadius: (BTN_SIZE + 22) / 2,
    backgroundColor: OVERLAYS.goldGlowSoft,
    top: -11,
    left: -11,
  },
  button: {
    width: BTN_SIZE,
    height: BTN_SIZE,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: 'rgba(251, 246, 236, 0.55)',
    overflow: 'hidden',
  },
  labelBadge: {
    position: 'absolute',
    bottom: -6,
    alignSelf: 'center',
    backgroundColor: COLORS.charcoalDeep,
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderWidth: 1,
    borderColor: COLORS.goldSoft,
  },
  labelText: {
    color: COLORS.goldSoft,
    fontSize: 8,
    fontWeight: '900',
    letterSpacing: 0.6,
  },
  modalContainer: {
    flex: 1,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 14,
    paddingTop:
      Platform.OS === 'android' ? (StatusBar.currentHeight ?? 0) + 14 : 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: GLASS.dark.borderColor,
  },
  modalBackBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(251, 246, 236, 0.08)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: GLASS.dark.borderColor,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalHeaderCenter: { flex: 1, alignItems: 'center' },
  modalTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  modalTitle: {
    color: COLORS.ivory,
    fontSize: 17,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  modalSubtitle: {
    color: 'rgba(251, 246, 236, 0.65)',
    fontSize: 11,
    fontWeight: '500',
    marginTop: 2,
    letterSpacing: 0.4,
  },
  modalHeaderRight: { width: 36, alignItems: 'center', justifyContent: 'center' },
  aiBadge: {
    backgroundColor: COLORS.goldSoft,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  aiBadgeText: {
    color: COLORS.charcoalDeep,
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 0.6,
  },
});
