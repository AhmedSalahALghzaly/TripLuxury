import React, { useState, useRef, useEffect } from 'react';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  TextInput,
  StyleSheet,
  Animated,
  ScrollView,
  useWindowDimensions,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from 'react-native';
import Reanimated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withSequence,
} from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import { useTheme } from '../../hooks/useTheme';
import { useTranslation } from '../../hooks/useTranslation';
import { api } from '../../services/api';
import {
  FONTS,
  SPACING,
  RADII,
  COLORS,
  OVERLAYS,
} from '../../constants/luxuryTokens';
import { LinearGradient } from 'expo-linear-gradient';

interface RatingModalProps {
  orderId: string | null;
  onClose: (submitted?: boolean) => void;
}

function AnimatedStar({
  n,
  selected,
  onPress,
}: {
  n: number;
  selected: boolean;
  onPress: () => void;
}) {
  const scale = useSharedValue(1);

  const animStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const handlePress = () => {
    scale.value = withSequence(
      withSpring(1.4, { damping: 4, stiffness: 300 }),
      withSpring(1, { damping: 8, stiffness: 200 }),
    );
    onPress();
  };

  return (
    <TouchableOpacity onPress={handlePress} activeOpacity={0.8} style={styles.starBtn}>
      <Reanimated.View style={animStyle}>
        <Ionicons
          name={selected ? 'star' : 'star-outline'}
          size={38}
          color={selected ? COLORS.gold : OVERLAYS.goldHairline}
        />
      </Reanimated.View>
    </TouchableOpacity>
  );
}

function StarRow({
  value,
  onChange,
}: {
  value: number;
  onChange: (n: number) => void;
}) {
  return (
    <View style={styles.starRow}>
      {[1, 2, 3, 4, 5].map((n) => (
        <AnimatedStar
          key={n}
          n={n}
          selected={n <= value}
          onPress={() => onChange(n)}
        />
      ))}
    </View>
  );
}

export default function RatingModal({ orderId, onClose }: RatingModalProps) {
  const { colors } = useTheme();
  const { language, isRTL } = useTranslation();
  const { height: screenHeight } = useWindowDimensions();
  const screenHeightRef = useRef(screenHeight);
  useEffect(() => { screenHeightRef.current = screenHeight; }, [screenHeight]);

  const queryClient = useQueryClient();

  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const slideAnim = useRef(new Animated.Value(screenHeight)).current;

  useEffect(() => {
    if (orderId) {
      setRating(0);
      setComment('');
      setDone(false);
      setErrorMsg(null);
      Animated.spring(slideAnim, {
        toValue: 0,
        useNativeDriver: true,
        tension: 65,
        friction: 11,
      }).start();
    }
  }, [orderId]);

  const dismiss = () => {
    Animated.timing(slideAnim, {
      toValue: screenHeightRef.current,
      duration: 280,
      useNativeDriver: true,
    }).start(() => onClose());
  };

  const submit = async () => {
    if (rating === 0) {
      setErrorMsg(language === 'ar' ? 'الرجاء اختيار تقييم' : 'Please pick a rating');
      return;
    }
    if (!comment.trim()) {
      setErrorMsg(language === 'ar' ? 'الرجاء كتابة تعليق على تجربتك' : 'Please write a comment about your experience');
      return;
    }
    setErrorMsg(null);
    setSubmitting(true);
    try {
      await api.post('/ratings', { order_id: orderId, rating, comment: comment.trim() });
      setDone(true);
      // Immediately refresh all ratings surfaces without waiting for WS broadcast
      queryClient.invalidateQueries({ queryKey: ['public-ratings'] });
      queryClient.invalidateQueries({ queryKey: ['ratings-distribution'] });
      queryClient.invalidateQueries({ queryKey: ['ra-ratings'] });
      queryClient.invalidateQueries({ queryKey: ['admin', 'ratings'] });
      queryClient.invalidateQueries({ queryKey: ['ratingSummary'] });
      setTimeout(() => {
        Animated.timing(slideAnim, {
          toValue: screenHeightRef.current,
          duration: 280,
          useNativeDriver: true,
        }).start(() => onClose(true));
      }, 1400);
      return;
    } catch (e: any) {
      const detail =
        e?.response?.data?.detail || e?.message ||
        (language === 'ar' ? 'تعذّر إرسال التقييم' : 'Could not submit rating');
      setErrorMsg(String(detail));
    } finally {
      setSubmitting(false);
    }
  };

  if (!orderId) return null;

  const labels = ['', '😞', '😐', '🙂', '😊', '🤩'];
  const labelTexts: Record<number, { ar: string; en: string }> = {
    1: { ar: 'سيء', en: 'Poor' },
    2: { ar: 'مقبول', en: 'Fair' },
    3: { ar: 'جيد', en: 'Good' },
    4: { ar: 'رائع', en: 'Great' },
    5: { ar: 'ممتاز!', en: 'Excellent!' },
  };

  return (
    <Modal transparent animationType="none" visible={!!orderId} onRequestClose={dismiss}>
      <View style={[styles.outerWrap, { backgroundColor: OVERLAYS.scrimDeep }]}>
        {/* Tap-to-dismiss — occupies all space ABOVE the sheet */}
        <TouchableOpacity
          style={styles.topDismiss}
          activeOpacity={1}
          onPress={dismiss}
        />

        {/* Bottom sheet with keyboard avoidance */}
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 24}
        >
          <Animated.View
            style={[
              styles.sheet,
              { backgroundColor: colors.card, transform: [{ translateY: slideAnim }] },
            ]}
          >
            <LinearGradient
              colors={['rgba(200,162,74,0.12)', 'transparent']}
              style={styles.sheetGradient}
              pointerEvents="none"
            />

            {/* Handle */}
            <View style={styles.handle} />

            {done ? (
              <View style={styles.doneWrap}>
                <Ionicons name="checkmark-circle" size={62} color={COLORS.gold} />
                <Text style={[styles.doneTitle, { color: colors.text }]}>
                  {language === 'ar' ? 'شكراً لك!' : 'Thank you!'}
                </Text>
                <Text style={[styles.doneSub, { color: colors.textSecondary }]}>
                  {language === 'ar' ? 'تقييمك يساعدنا على التحسين' : 'Your feedback helps us improve'}
                </Text>
              </View>
            ) : (
              <ScrollView
                showsVerticalScrollIndicator={false}
                keyboardShouldPersistTaps="handled"
                bounces={false}
              >
                <Text style={[styles.title, { color: colors.text }]}>
                  {language === 'ar' ? 'كيف كانت تجربتك؟' : 'How was your experience?'}
                </Text>
                <Text style={[styles.sub, { color: colors.textSecondary }]}>
                  {language === 'ar'
                    ? 'ساعدنا بتقييم طلبك الأخير'
                    : 'Rate your most recent order'}
                </Text>

                {/* Stars */}
                <StarRow value={rating} onChange={(v) => { setRating(v); setErrorMsg(null); }} />

                {/* Emoji label */}
                {rating > 0 && (
                  <Text style={styles.emojiLabel}>
                    {labels[rating]}{' '}
                    <Text style={{ color: colors.text, fontFamily: FONTS.body }}>
                      {language === 'ar' ? labelTexts[rating].ar : labelTexts[rating].en}
                    </Text>
                  </Text>
                )}

                {/* Comment — required field */}
                <Text style={[styles.inputLabel, { color: colors.textSecondary }]}>
                  {language === 'ar' ? 'تعليقك (مطلوب)' : 'Your comment (required)'}
                </Text>
                <TextInput
                  value={comment}
                  onChangeText={(t) => { setComment(t); if (errorMsg) setErrorMsg(null); }}
                  placeholder={
                    language === 'ar' ? 'اكتب تعليقك عن تجربتك…' : 'Write about your experience…'
                  }
                  placeholderTextColor={colors.textSecondary}
                  multiline
                  numberOfLines={4}
                  textAlignVertical="top"
                  textAlign={isRTL ? 'right' : 'left'}
                  style={[
                    styles.input,
                    {
                      backgroundColor: colors.surface,
                      borderColor: errorMsg && !comment.trim() ? '#EF4444' : colors.border,
                      color: colors.text,
                      fontFamily: FONTS.body,
                    },
                  ]}
                />

                {/* Inline error feedback */}
                {errorMsg && (
                  <View style={styles.errorRow}>
                    <Ionicons name="alert-circle" size={14} color="#EF4444" />
                    <Text style={styles.errorText} numberOfLines={2}>{errorMsg}</Text>
                  </View>
                )}

                {/* Actions */}
                <View style={styles.actions}>
                  <TouchableOpacity
                    style={[styles.skipBtn, { borderColor: colors.border }]}
                    onPress={dismiss}
                  >
                    <Text style={[styles.skipText, { color: colors.textSecondary }]}>
                      {language === 'ar' ? 'لاحقاً' : 'Later'}
                    </Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[
                      styles.submitBtn,
                      { opacity: (rating === 0 || !comment.trim()) ? 0.45 : 1 },
                    ]}
                    onPress={submit}
                    disabled={rating === 0 || !comment.trim() || submitting}
                    activeOpacity={0.85}
                  >
                    <LinearGradient
                      colors={[COLORS.gold, '#A98432']}
                      style={styles.submitGrad}
                      start={{ x: 0, y: 0 }}
                      end={{ x: 1, y: 0 }}
                    >
                      {submitting ? (
                        <ActivityIndicator size="small" color={COLORS.charcoalDeep} />
                      ) : (
                        <Text style={styles.submitText}>
                          {language === 'ar' ? 'أرسل التقييم' : 'Submit Rating'}
                        </Text>
                      )}
                    </LinearGradient>
                  </TouchableOpacity>
                </View>
              </ScrollView>
            )}
          </Animated.View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  outerWrap: {
    flex: 1,
    flexDirection: 'column',
    justifyContent: 'flex-end',
  },
  topDismiss: {
    flex: 1,
  },
  sheet: {
    borderTopLeftRadius: RADII.xxl,
    borderTopRightRadius: RADII.xxl,
    padding: SPACING.xl,
    paddingBottom: SPACING.hero,
    minHeight: 340,
  },
  sheetGradient: {
    ...StyleSheet.absoluteFillObject,
    borderTopLeftRadius: RADII.xxl,
    borderTopRightRadius: RADII.xxl,
  },
  handle: {
    width: 40,
    height: 5,
    borderRadius: 3,
    backgroundColor: OVERLAYS.goldHairline,
    alignSelf: 'center',
    marginBottom: SPACING.lg,
  },
  title: {
    fontFamily: FONTS.display,
    fontSize: 22,
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: SPACING.xs,
  },
  sub: {
    fontFamily: FONTS.body,
    fontSize: 14,
    textAlign: 'center',
    marginBottom: SPACING.xl,
  },
  starRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: SPACING.sm,
    marginBottom: SPACING.md,
  },
  starBtn: {
    padding: SPACING.xs,
  },
  emojiLabel: {
    textAlign: 'center',
    fontSize: 18,
    marginBottom: SPACING.lg,
  },
  inputLabel: {
    fontFamily: FONTS.body,
    fontSize: 12,
    fontWeight: '600',
    marginBottom: SPACING.xs,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  input: {
    borderWidth: 1,
    borderRadius: RADII.md,
    padding: SPACING.md,
    fontSize: 14,
    minHeight: 90,
    marginBottom: SPACING.xl,
  },
  actions: {
    flexDirection: 'row',
    gap: SPACING.md,
  },
  skipBtn: {
    flex: 1,
    borderWidth: 1,
    borderRadius: RADII.md,
    paddingVertical: SPACING.md,
    alignItems: 'center',
  },
  skipText: {
    fontFamily: FONTS.body,
    fontSize: 14,
    fontWeight: '600',
  },
  submitBtn: {
    flex: 2,
    borderRadius: RADII.md,
    overflow: 'hidden',
  },
  submitGrad: {
    paddingVertical: SPACING.md,
    alignItems: 'center',
  },
  submitText: {
    fontFamily: FONTS.body,
    fontSize: 14,
    fontWeight: '700',
    color: COLORS.charcoalDeep,
  },
  doneWrap: {
    alignItems: 'center',
    paddingVertical: SPACING.xxl,
    gap: SPACING.md,
  },
  doneTitle: {
    fontFamily: FONTS.display,
    fontSize: 24,
    fontWeight: '700',
  },
  doneSub: {
    fontFamily: FONTS.body,
    fontSize: 14,
    textAlign: 'center',
  },
  errorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: SPACING.md,
    paddingHorizontal: SPACING.sm,
  },
  errorText: {
    flex: 1,
    fontFamily: FONTS.body,
    fontSize: 12,
    color: '#EF4444',
    fontWeight: '600',
  },
});
