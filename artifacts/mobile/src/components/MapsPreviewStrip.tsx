import React, { useMemo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Linking, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../hooks/useTheme';
import { useTranslation } from '../hooks/useTranslation';

export interface MapsPreviewStripProps {
  latitude: number | null | undefined;
  longitude: number | null | undefined;
  height?: number;
  showOpenButton?: boolean;
  rounded?: boolean;
  label?: string;
  /** When provided, a "Move pin" button is shown so the user can drag the pin. */
  onMovePinPress?: () => void;
}

// Lazy-load WebView only on native — importing it on web throws
// "React Native WebView does not support this platform."
const WebViewNative: any =
  Platform.OS === 'web' ? null : require('react-native-webview').WebView;

export const MapsPreviewStrip: React.FC<MapsPreviewStripProps> = ({
  latitude,
  longitude,
  height = 160,
  showOpenButton = true,
  rounded = true,
  label,
  onMovePinPress,
}) => {
  const { colors, isDark } = useTheme();
  const { language } = useTranslation();

  const hasCoords =
    typeof latitude === 'number' &&
    typeof longitude === 'number' &&
    !Number.isNaN(latitude) &&
    !Number.isNaN(longitude);

  const embedUrl = useMemo(() => {
    if (!hasCoords) return '';
    return `https://maps.google.com/maps?q=${latitude},${longitude}&z=16&output=embed`;
  }, [hasCoords, latitude, longitude]);

  const embedHtml = useMemo(() => {
    if (!hasCoords) return '';
    return `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1"><style>html,body,iframe{margin:0;padding:0;border:0;width:100%;height:100%;background:${isDark ? '#0B1220' : '#F3F4F6'}}</style></head><body><iframe src="${embedUrl}" loading="lazy" referrerpolicy="no-referrer-when-downgrade" allowfullscreen></iframe></body></html>`;
  }, [hasCoords, embedUrl, isDark]);

  const openExternal = () => {
    if (!hasCoords) return;
    const q = `${latitude},${longitude}`;
    const url = Platform.select({
      ios: `https://maps.apple.com/?q=${q}&ll=${q}`,
      android: `geo:${q}?q=${q}`,
      default: `https://www.google.com/maps/search/?api=1&query=${q}`,
    })!;
    Linking.openURL(url).catch(() => {
      Linking.openURL(`https://www.google.com/maps/search/?api=1&query=${q}`).catch(() => {});
    });
  };

  if (!hasCoords) {
    return (
      <View
        style={[
          styles.empty,
          { height, backgroundColor: colors.surface, borderColor: colors.border, borderRadius: rounded ? 12 : 0 },
        ]}
      >
        <Ionicons name="map-outline" size={28} color={colors.textSecondary} />
        <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
          {label ?? (language === 'ar' ? 'لم يتم تحديد الموقع' : 'No location set')}
        </Text>
      </View>
    );
  }

  return (
    <View
      style={[
        styles.wrap,
        { height, borderColor: colors.border, borderRadius: rounded ? 12 : 0 },
      ]}
    >
      {Platform.OS === 'web' ? (
        // On web the proxied iframe works directly — RN-WebView is unsupported here.
        // Use createElement to avoid TSX type-checks on the DOM element.
        React.createElement('iframe', {
          src: embedUrl,
          loading: 'lazy',
          referrerPolicy: 'no-referrer-when-downgrade',
          allowFullScreen: true,
          style: {
            width: '100%',
            height: '100%',
            border: 0,
            borderRadius: rounded ? 12 : 0,
            background: isDark ? '#0B1220' : '#F3F4F6',
          },
        })
      ) : (
        <WebViewNative
          originWhitelist={['*']}
          source={{ html: embedHtml }}
          style={[styles.web, { borderRadius: rounded ? 12 : 0 }]}
          scrollEnabled={false}
          javaScriptEnabled
          domStorageEnabled={false}
          cacheEnabled
          androidLayerType="hardware"
          startInLoadingState={false}
        />
      )}
      {showOpenButton && (
        <TouchableOpacity
          onPress={openExternal}
          activeOpacity={0.85}
          style={[styles.cta, { backgroundColor: colors.primary }]}
        >
          <Ionicons name="navigate" size={14} color="#FFF" />
          <Text style={styles.ctaText}>
            {language === 'ar' ? 'فتح في الخرائط' : 'Open in Maps'}
          </Text>
        </TouchableOpacity>
      )}
      {onMovePinPress && (
        <TouchableOpacity
          onPress={onMovePinPress}
          activeOpacity={0.85}
          style={[styles.movePinBtn, { backgroundColor: colors.card }]}
        >
          <Ionicons name="pin" size={14} color={colors.primary} />
          <Text style={[styles.movePinText, { color: colors.primary }]}>
            {language === 'ar' ? 'تحريك الدبوس' : 'Move pin'}
          </Text>
        </TouchableOpacity>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  wrap: {
    width: '100%',
    overflow: 'hidden',
    borderWidth: 1,
    position: 'relative',
  },
  web: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  empty: {
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderStyle: 'dashed',
    gap: 6,
  },
  emptyText: {
    fontSize: 12,
    fontWeight: '600',
  },
  cta: {
    position: 'absolute',
    bottom: 8,
    right: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
  },
  ctaText: {
    color: '#FFF',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  movePinBtn: {
    position: 'absolute',
    bottom: 8,
    left: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
  },
  movePinText: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
});

export default MapsPreviewStrip;
