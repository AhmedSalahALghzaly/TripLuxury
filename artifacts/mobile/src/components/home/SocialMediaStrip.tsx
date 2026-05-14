import React, { memo } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Linking,
  useWindowDimensions,
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

// ── Types ────────────────────────────────────────────────────────────────────

/** Array-based format used by new social-links manager (preferred) */
export interface SocialLinkEntry {
  platform: string;
  url: string;
}

/** Full footer config shape passed from parent (either format accepted) */
export interface SocialConfig {
  /** Preferred: ordered array from the manager */
  social_links?: SocialLinkEntry[];
  /** Legacy individual keys — still accepted if social_links absent */
  social_facebook?: string;
  social_instagram?: string;
  social_twitter?: string;
  social_tiktok?: string;
  social_youtube?: string;
  social_whatsapp?: string;
  social_pinterest?: string;
  social_telegram?: string;
}

// ── Platform registry ────────────────────────────────────────────────────────

export interface SocialPlatformMeta {
  platform: string;
  legacyKey: string;
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  color: string;
  bgLight: string;
  bgDark: string;
}

export const ALL_SOCIAL_PLATFORMS: SocialPlatformMeta[] = [
  {
    platform: 'facebook',
    legacyKey: 'social_facebook',
    icon: 'logo-facebook',
    label: 'Facebook',
    color: '#1877F2',
    bgLight: '#E7F0FD',
    bgDark: 'rgba(24,119,242,0.15)',
  },
  {
    platform: 'instagram',
    legacyKey: 'social_instagram',
    icon: 'logo-instagram',
    label: 'Instagram',
    color: '#E1306C',
    bgLight: '#FDE7EF',
    bgDark: 'rgba(225,48,108,0.15)',
  },
  {
    platform: 'tiktok',
    legacyKey: 'social_tiktok',
    icon: 'logo-tiktok',
    label: 'TikTok',
    color: '#010101',
    bgLight: '#E8E8E8',
    bgDark: 'rgba(255,255,255,0.10)',
  },
  {
    platform: 'twitter',
    legacyKey: 'social_twitter',
    icon: 'logo-twitter',
    label: 'X / Twitter',
    color: '#1DA1F2',
    bgLight: '#E7F4FD',
    bgDark: 'rgba(29,161,242,0.15)',
  },
  {
    platform: 'youtube',
    legacyKey: 'social_youtube',
    icon: 'logo-youtube',
    label: 'YouTube',
    color: '#FF0000',
    bgLight: '#FFEBEB',
    bgDark: 'rgba(255,0,0,0.15)',
  },
  {
    platform: 'whatsapp',
    legacyKey: 'social_whatsapp',
    icon: 'logo-whatsapp',
    label: 'WhatsApp',
    color: '#25D366',
    bgLight: '#EBFDF3',
    bgDark: 'rgba(37,211,102,0.15)',
  },
  {
    platform: 'pinterest',
    legacyKey: 'social_pinterest',
    icon: 'logo-pinterest',
    label: 'Pinterest',
    color: '#E60023',
    bgLight: '#FFECEC',
    bgDark: 'rgba(230,0,35,0.15)',
  },
  {
    platform: 'telegram',
    legacyKey: 'social_telegram',
    icon: 'paper-plane',
    label: 'Telegram',
    color: '#0088CC',
    bgLight: '#E4F3FA',
    bgDark: 'rgba(0,136,204,0.15)',
  },
];

/** Look up platform metadata by short name */
export function getPlatformMeta(platform: string): SocialPlatformMeta | undefined {
  return ALL_SOCIAL_PLATFORMS.find((p) => p.platform === platform);
}

// ── Resolver: supports both array-based and legacy key-based configs ──────────

function resolveActiveLinks(config: SocialConfig): Array<{ meta: SocialPlatformMeta; url: string }> {
  // Prefer new array format
  if (Array.isArray(config.social_links) && config.social_links.length > 0) {
    return config.social_links
      .filter((l) => l.url?.trim())
      .map((l) => ({ meta: getPlatformMeta(l.platform)!, url: l.url }))
      .filter(({ meta }) => !!meta);
  }
  // Fall back to legacy individual keys
  return ALL_SOCIAL_PLATFORMS
    .filter((p) => {
      const url = (config as Record<string, any>)[p.legacyKey];
      return url && url.trim().length > 0;
    })
    .map((meta) => ({ meta, url: (config as Record<string, any>)[meta.legacyKey] as string }));
}

// ── Component ─────────────────────────────────────────────────────────────────

interface Props {
  config: SocialConfig;
}

export default memo(function SocialMediaStrip({ config }: Props) {
  const { language } = useTranslation();
  const { isDark } = useTheme();
  const { width: screenWidth } = useWindowDimensions();
  const iconSize = Math.round(Math.min(56, Math.max(44, screenWidth * 0.135)));

  const activeLinks = resolveActiveLinks(config);
  if (activeLinks.length === 0) return null;

  const handlePress = (url: string) => {
    const finalUrl = url.startsWith('http') ? url : `https://${url}`;
    Linking.openURL(finalUrl).catch(() => {});
  };

  return (
    <View style={styles.wrapper}>
      <View style={styles.dividerRow}>
        <View style={[styles.divider, { backgroundColor: OVERLAYS.goldHairline }]} />
        <Text style={styles.dividerText}>
          {language === 'ar' ? 'تابعنا' : 'FOLLOW US'}
        </Text>
        <View style={[styles.divider, { backgroundColor: OVERLAYS.goldHairline }]} />
      </View>

      <View style={styles.iconsRow}>
        {activeLinks.map(({ meta, url }) => {
          const bg = isDark ? meta.bgDark : meta.bgLight;
          return (
            <TouchableOpacity
              key={meta.platform}
              style={[styles.iconBtn, { width: iconSize, height: iconSize, backgroundColor: bg }]}
              onPress={() => handlePress(url)}
              activeOpacity={0.78}
              accessibilityLabel={meta.label}
            >
              <Ionicons name={meta.icon} size={22} color={meta.color} />
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  wrapper: {
    marginTop: SPACING.xxl,
    marginBottom: SPACING.md,
    paddingHorizontal: SPACING.xl,
  },
  dividerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.md,
    marginBottom: SPACING.xl,
  },
  divider: {
    flex: 1,
    height: 1,
  },
  dividerText: {
    fontFamily: FONTS.body,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 2,
    color: COLORS.gold,
    textTransform: 'uppercase',
  },
  iconsRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    flexWrap: 'wrap',
    gap: SPACING.md,
  },
  iconBtn: {
    borderRadius: RADII.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
