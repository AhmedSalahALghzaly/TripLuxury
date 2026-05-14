// MagazineSectionHeader — eyebrow + serif title + optional gold CTA
// + champagne divider. RTL mirrors via isRTL.
import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../hooks/useTheme';
import { useTranslation } from '../../hooks/useTranslation';
import { FONTS, TYPE, SPACING } from '../../constants/luxuryTokens';

interface MagazineSectionHeaderProps {
  eyebrow?: string;
  title: string;
  caption?: string;
  ctaLabel?: string;
  ctaIcon?: keyof typeof Ionicons.glyphMap;
  onCtaPress?: () => void;
}

export const MagazineSectionHeader: React.FC<MagazineSectionHeaderProps> = ({
  eyebrow,
  title,
  caption,
  ctaLabel,
  ctaIcon = 'chevron-forward',
  onCtaPress,
}) => {
  const { colors } = useTheme();
  const { isRTL } = useTranslation();

  const rowDirection = isRTL ? 'row-reverse' : 'row';
  const arrowName = isRTL && ctaIcon === 'chevron-forward'
    ? 'chevron-back'
    : ctaIcon;

  return (
    <View style={styles.wrapper}>
      <View style={[styles.row, { flexDirection: rowDirection }]}>
        <View style={[styles.titleColumn, isRTL && styles.titleColumnRTL]}>
          {eyebrow ? (
            <Text
              style={[
                styles.eyebrow,
                { color: colors.primary },
                isRTL && styles.textRTL,
              ]}
              numberOfLines={1}
            >
              {eyebrow}
            </Text>
          ) : null}
          <Text
            style={[
              styles.title,
              { color: colors.text },
              isRTL && styles.textRTL,
            ]}
            numberOfLines={2}
          >
            {title}
          </Text>
          {caption ? (
            <Text
              style={[
                styles.caption,
                { color: colors.textSecondary },
                isRTL && styles.textRTL,
              ]}
              numberOfLines={2}
            >
              {caption}
            </Text>
          ) : null}
        </View>

        {ctaLabel ? (
          <TouchableOpacity
            onPress={onCtaPress}
            activeOpacity={0.7}
            style={styles.ctaButton}
            accessibilityRole="button"
          >
            <Text style={[styles.ctaText, { color: colors.primary }]}>
              {ctaLabel}
            </Text>
            <Ionicons name={arrowName} size={14} color={colors.primary} />
          </TouchableOpacity>
        ) : null}
      </View>

      {/* Champagne hairline divider — anchors the editorial feel. */}
      <View
        style={[
          styles.divider,
          { backgroundColor: colors.primary + '55' },
        ]}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  wrapper: {
    paddingHorizontal: SPACING.xl,
    marginBottom: SPACING.md,
  },
  row: {
    alignItems: 'flex-end',
    justifyContent: 'space-between',
  },
  titleColumn: {
    flex: 1,
  },
  titleColumnRTL: {
    alignItems: 'flex-end',
  },
  eyebrow: {
    ...TYPE.sectionLabel,
    marginBottom: SPACING.xs,
  },
  title: {
    ...TYPE.title,
  },
  caption: {
    ...TYPE.caption,
    marginTop: SPACING.xxs,
    fontFamily: FONTS.body,
  },
  textRTL: {
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  ctaButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: SPACING.xs,
    paddingHorizontal: SPACING.xs,
    gap: SPACING.xxs,
  },
  ctaText: {
    ...TYPE.compactMicroLabel,
  },
  divider: {
    height: StyleSheet.hairlineWidth * 2,
    marginTop: SPACING.sm,
    opacity: 0.85,
  },
});

export default MagazineSectionHeader;
