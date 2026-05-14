/**
 * LocationBubble - Renders a chat message of type 'location'.
 *
 * Shows a static map preview thumbnail (via the public OpenStreetMap
 * staticmap service — no API key required) with a marker at the shared
 * coordinates, an address line if reverse-geocoded, and a tap affordance
 * that opens the device's native maps app pre-positioned on the pin.
 *
 * Fails gracefully:
 *  - If the static-map image fails to load, a gradient placeholder with
 *    a map icon is shown instead.
 *  - On web, falls back to opening Google Maps in a new browser tab.
 */
import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Image,
  Linking,
  Platform,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

interface Props {
  latitude: number;
  longitude: number;
  address?: string | null;
  mine: boolean;
}

const PREVIEW_W = 240;
const PREVIEW_H = 140;

function buildStaticMapUrl(lat: number, lng: number): string {
  // staticmap.openstreetmap.de is a free, key-less static map tile
  // service that's widely used for prototypes and chat thumbnails.
  // Returns a PNG centered on the coordinates with a red pushpin marker.
  return (
    `https://staticmap.openstreetmap.de/staticmap.php` +
    `?center=${lat},${lng}` +
    `&zoom=15` +
    `&size=${PREVIEW_W * 2}x${PREVIEW_H * 2}` +
    `&maptype=mapnik` +
    `&markers=${lat},${lng},red-pushpin`
  );
}

function openInMaps(lat: number, lng: number, label?: string | null) {
  const labelEnc = label ? encodeURIComponent(label) : '';
  if (Platform.OS === 'web') {
    Linking.openURL(`https://www.google.com/maps/search/?api=1&query=${lat},${lng}`);
    return;
  }
  if (Platform.OS === 'ios') {
    // Apple Maps URL scheme; falls back to Google Maps if the user
    // doesn't have Apple Maps installed (extremely rare).
    const url = labelEnc
      ? `maps:0,0?q=${labelEnc}@${lat},${lng}`
      : `maps:0,0?q=${lat},${lng}`;
    Linking.canOpenURL(url).then((ok) => {
      if (ok) Linking.openURL(url);
      else Linking.openURL(`https://www.google.com/maps/search/?api=1&query=${lat},${lng}`);
    });
    return;
  }
  // Android: prefer the geo: scheme so the user picks their default app.
  const geo = labelEnc
    ? `geo:${lat},${lng}?q=${lat},${lng}(${labelEnc})`
    : `geo:${lat},${lng}?q=${lat},${lng}`;
  Linking.canOpenURL(geo).then((ok) => {
    if (ok) Linking.openURL(geo);
    else Linking.openURL(`https://www.google.com/maps/search/?api=1&query=${lat},${lng}`);
  });
}

export function LocationBubble({ latitude, longitude, address, mine }: Props) {
  const [imgState, setImgState] = useState<'loading' | 'ok' | 'err'>('loading');
  const url = buildStaticMapUrl(latitude, longitude);
  const onPress = useCallback(() => {
    openInMaps(latitude, longitude, address);
  }, [latitude, longitude, address]);

  const coordsLabel =
    `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`;

  return (
    <TouchableOpacity activeOpacity={0.85} onPress={onPress} style={styles.wrap}>
      <View style={styles.previewBox}>
        {imgState !== 'err' ? (
          <Image
            source={{ uri: url }}
            style={styles.preview}
            onLoad={() => setImgState('ok')}
            onError={() => setImgState('err')}
            resizeMode="cover"
          />
        ) : (
          // Gradient-ish placeholder when the static-map service is
          // unreachable — keeps the bubble looking deliberate, not broken.
          <View style={[styles.preview, styles.previewFallback]}>
            <Ionicons name="map-outline" size={42} color="rgba(255,255,255,0.85)" />
          </View>
        )}

        {imgState === 'loading' && (
          <View style={styles.loadingOverlay}>
            <ActivityIndicator color="#fff" />
          </View>
        )}

        {/* Pin glyph overlay — even when the static map already shows a
            pushpin, the overlay stays visible so the bubble reads as a
            location regardless of the upstream service's marker styling. */}
        <View style={styles.pinOverlay} pointerEvents="none">
          <View style={styles.pinDot}>
            <Ionicons name="location" size={16} color="#fff" />
          </View>
        </View>
      </View>

      <View style={styles.metaRow}>
        <Ionicons
          name="location-outline"
          size={14}
          color={mine ? 'rgba(255,255,255,0.9)' : '#2563EB'}
          style={{ marginEnd: 4 }}
        />
        <Text
          style={[
            styles.addressText,
            { color: mine ? '#fff' : '#0f172a' },
          ]}
          numberOfLines={2}
        >
          {address && address.trim().length > 0 ? address : coordsLabel}
        </Text>
      </View>

      <View style={styles.openRow}>
        <Text
          style={[
            styles.openText,
            { color: mine ? 'rgba(255,255,255,0.9)' : '#2563EB' },
          ]}
        >
          فتح في الخرائط
        </Text>
        <Ionicons
          name="open-outline"
          size={13}
          color={mine ? 'rgba(255,255,255,0.9)' : '#2563EB'}
          style={{ marginStart: 4 }}
        />
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  wrap: {
    width: PREVIEW_W,
  },
  previewBox: {
    width: PREVIEW_W,
    height: PREVIEW_H,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: '#1e3a8a',
    position: 'relative',
  },
  preview: {
    width: '100%',
    height: '100%',
  },
  previewFallback: {
    backgroundColor: '#1E3A8A',
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.15)',
  },
  pinOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pinDot: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: '#EF4444',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#fff',
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
    transform: [{ translateY: -8 }],
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 8,
  },
  addressText: {
    flex: 1,
    fontSize: 13,
    fontWeight: '600',
    lineHeight: 18,
  },
  openRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
  },
  openText: {
    fontSize: 12,
    fontWeight: '700',
  },
});
