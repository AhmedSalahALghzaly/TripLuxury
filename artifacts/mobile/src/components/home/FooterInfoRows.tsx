import React, { memo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Linking,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from '../../hooks/useTranslation';
import { useTheme } from '../../hooks/useTheme';
import {
  FONTS,
  SPACING,
  RADII,
  COLORS,
  OVERLAYS,
} from '../../constants/luxuryTokens';

export interface FooterConfig {
  // Contact info (three bilingual text-area pairs)
  info_phone?: string;
  info_email?: string;
  info_address_en?: string;
  info_address_ar?: string;
  info_hours_en?: string;
  info_hours_ar?: string;
  // Legacy keys kept for backward compat
  info_address?: string;
  info_hours?: string;
  // Custom info row (bilingual)
  info_custom_en?: string;
  info_custom_ar?: string;
  info_custom_icon?: string;
  // App identity (bilingual)
  app_name_en?: string;
  app_name_ar?: string;
  tagline_en?: string;
  tagline_ar?: string;
  // Copyright (bilingual)
  copyright_en?: string;
  copyright_ar?: string;
  // Visibility flags
  show_info_rows?: boolean;
}

interface InfoRowProps {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  value: string;
  onPress?: () => void;
  isDark: boolean;
}

function InfoRow({ icon, label, value, onPress, isDark }: InfoRowProps) {
  const rowBg = isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.03)';
  const textColor = isDark ? COLORS.ivory : COLORS.charcoal;
  const subColor = isDark ? COLORS.goldSoft : COLORS.bronze;

  const inner = (
    <View style={[styles.infoRow, { backgroundColor: rowBg }]}>
      <View style={[styles.iconCircle, { backgroundColor: isDark ? 'rgba(200,162,74,0.12)' : 'rgba(200,162,74,0.10)' }]}>
        <Ionicons name={icon} size={16} color={COLORS.gold} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[styles.infoLabel, { color: subColor }]}>{label}</Text>
        <Text style={[styles.infoValue, { color: textColor }]} numberOfLines={2}>
          {value}
        </Text>
      </View>
      {onPress && (
        <Ionicons name="chevron-forward" size={14} color={COLORS.gold} style={{ opacity: 0.6 }} />
      )}
    </View>
  );

  if (onPress) {
    return (
      <TouchableOpacity onPress={onPress} activeOpacity={0.75}>
        {inner}
      </TouchableOpacity>
    );
  }
  return inner;
}

interface Props {
  config: FooterConfig;
}

export default memo(function FooterInfoRows({ config }: Props) {
  const { language, isRTL } = useTranslation();
  const { isDark } = useTheme();

  if (config.show_info_rows === false) return null;

  // Resolve bilingual fields with fallbacks to legacy keys
  const address =
    language === 'ar'
      ? (config.info_address_ar || config.info_address)
      : (config.info_address_en || config.info_address);
  const hours =
    language === 'ar'
      ? (config.info_hours_ar || config.info_hours)
      : (config.info_hours_en || config.info_hours);
  const customInfo =
    language === 'ar' ? config.info_custom_ar : config.info_custom_en;
  const appName =
    language === 'ar'
      ? (config.app_name_ar || 'الغزالي')
      : (config.app_name_en || 'Al-Ghazaly');
  const tagline =
    language === 'ar'
      ? (config.tagline_ar || 'مطبخ أصيل')
      : (config.tagline_en || 'Fine Dining');
  const copyright =
    language === 'ar' ? config.copyright_ar : config.copyright_en;

  const hasAny =
    config.info_phone || config.info_email || address || hours || customInfo;
  if (!hasAny && !copyright) return null;

  const customIcon = (config.info_custom_icon as keyof typeof Ionicons.glyphMap) ?? 'information-circle';

  return (
    <View style={styles.wrapper}>
      {/* Contact info rows — three bilingual text-area pairs */}
      {hasAny && (
        <View style={styles.rows}>
          {config.info_phone ? (
            <InfoRow
              icon="call"
              label={language === 'ar' ? 'هاتف' : 'Phone'}
              value={config.info_phone}
              onPress={() => Linking.openURL(`tel:${config.info_phone}`)}
              isDark={isDark}
            />
          ) : null}

          {config.info_email ? (
            <InfoRow
              icon="mail"
              label={language === 'ar' ? 'البريد الإلكتروني' : 'Email'}
              value={config.info_email}
              onPress={() => Linking.openURL(`mailto:${config.info_email}`)}
              isDark={isDark}
            />
          ) : null}

          {address ? (
            <InfoRow
              icon="location"
              label={language === 'ar' ? 'العنوان' : 'Address'}
              value={address}
              isDark={isDark}
            />
          ) : null}

          {hours ? (
            <InfoRow
              icon="time"
              label={language === 'ar' ? 'ساعات العمل' : 'Hours'}
              value={hours}
              isDark={isDark}
            />
          ) : null}

          {customInfo ? (
            <InfoRow
              icon={customIcon}
              label={language === 'ar' ? 'معلومات' : 'Info'}
              value={customInfo}
              isDark={isDark}
            />
          ) : null}
        </View>
      )}

      {/* Divider */}
      <View style={[styles.footerDivider, { backgroundColor: OVERLAYS.goldHairline }]} />

      {/* Brand mark — CMS-driven app name & tagline */}
      <View style={styles.brandMark}>
        <Ionicons name="diamond" size={13} color={COLORS.gold} />
        <Text style={styles.brandName}>{appName}</Text>
        <Text style={styles.brandTagline}>· {tagline}</Text>
      </View>

      {/* Copyright */}
      {copyright ? (
        <Text style={[styles.copyright, { color: isDark ? OVERLAYS.ivoryDimSoft : OVERLAYS.charcoalChipText }]}>
          {copyright}
        </Text>
      ) : null}

      {/* Bottom safe space */}
      <View style={{ height: SPACING.xxl }} />
    </View>
  );
});

const styles = StyleSheet.create({
  wrapper: {
    marginTop: SPACING.xxl,
    paddingHorizontal: SPACING.xl,
  },
  rows: {
    gap: SPACING.sm,
    marginBottom: SPACING.xl,
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.md,
    borderRadius: RADII.md,
    padding: SPACING.md,
  },
  iconCircle: {
    width: 34,
    height: 34,
    borderRadius: RADII.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  infoLabel: {
    fontFamily: FONTS.body,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    marginBottom: 2,
  },
  infoValue: {
    fontFamily: FONTS.body,
    fontSize: 13,
    fontWeight: '500',
    lineHeight: 18,
  },
  footerDivider: {
    height: 1,
    marginBottom: SPACING.lg,
  },
  brandMark: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: SPACING.xs,
    marginBottom: SPACING.sm,
  },
  brandName: {
    fontFamily: FONTS.display,
    fontSize: 15,
    fontWeight: '700',
    color: COLORS.gold,
  },
  brandTagline: {
    fontFamily: FONTS.body,
    fontSize: 12,
    color: COLORS.gold,
    opacity: 0.7,
  },
  copyright: {
    fontFamily: FONTS.body,
    fontSize: 11,
    textAlign: 'center',
    lineHeight: 16,
  },
});
