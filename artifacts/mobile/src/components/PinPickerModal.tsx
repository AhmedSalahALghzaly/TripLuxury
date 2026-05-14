import React, { useState, useCallback, useEffect, useRef } from 'react';
import {
  Modal,
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Platform,
  StatusBar,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import { useTheme } from '../hooks/useTheme';
import { useTranslation } from '../hooks/useTranslation';
import { SafeAreaView } from 'react-native-safe-area-context';

// Lazy-load WebView only on native
const WebViewNative: any =
  Platform.OS === 'web' ? null : require('react-native-webview').WebView;

export interface PinPickerResult {
  latitude: number;
  longitude: number;
}

interface Props {
  visible: boolean;
  initialLatitude?: number | null;
  initialLongitude?: number | null;
  onConfirm: (result: PinPickerResult) => void;
  onClose: () => void;
}

const DEFAULT_LAT = 24.0889;
const DEFAULT_LNG = 32.8998; // Aswan, Egypt

function buildLeafletHtml(lat: number, lng: number, isDark: boolean, ar: boolean): string {
  const mapBg = isDark ? '#0B1220' : '#F3F4F6';
  const confirmLabel = ar ? 'تأكيد الموقع' : 'Confirm location';
  const hintLabel = ar ? 'اسحب الدبوس لتحديد موقعك بدقة' : 'Drag the pin to your exact delivery spot';
  return `<!doctype html>
<html lang="${ar ? 'ar' : 'en'}" dir="${ar ? 'rtl' : 'ltr'}">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no"/>
  <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
  <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    html, body { width: 100%; height: 100%; background: ${mapBg}; font-family: system-ui, sans-serif; }
    #map { position: absolute; inset: 0; bottom: 76px; }
    #footer {
      position: absolute; bottom: 0; left: 0; right: 0; height: 76px;
      background: ${isDark ? '#1a2540' : '#fff'};
      border-top: 1px solid ${isDark ? '#2a3a5c' : '#e5e7eb'};
      display: flex; flex-direction: column; align-items: center; justify-content: center;
      gap: 6px; padding: 0 16px;
    }
    #hint {
      font-size: 11px; color: ${isDark ? '#9ca3af' : '#6b7280'};
      text-align: center; letter-spacing: 0.2px;
    }
    #confirm {
      background: #F97316; color: #fff; border: none; border-radius: 999px;
      padding: 9px 32px; font-size: 14px; font-weight: 700; cursor: pointer;
      letter-spacing: 0.3px; min-width: 180px;
    }
    #confirm:active { opacity: 0.85; }
    .leaflet-control-zoom { border-radius: 8px !important; overflow: hidden; }
  </style>
</head>
<body>
  <div id="map"></div>
  <div id="footer">
    <div id="hint">${hintLabel}</div>
    <button id="confirm">${confirmLabel}</button>
  </div>
  <script>
    var lat = ${lat}, lng = ${lng};
    var map = L.map('map', { zoomControl: true }).setView([lat, lng], 16);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap contributors',
      maxZoom: 19,
    }).addTo(map);

    var icon = L.divIcon({
      className: '',
      html: '<div style="width:28px;height:28px;background:#F97316;border-radius:50% 50% 50% 0;transform:rotate(-45deg);border:3px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,0.4)"></div>',
      iconSize: [28, 28],
      iconAnchor: [14, 28],
    });

    var marker = L.marker([lat, lng], { icon: icon, draggable: true }).addTo(map);

    marker.on('dragend', function(e) {
      var pos = e.target.getLatLng();
      lat = pos.lat;
      lng = pos.lng;
    });

    map.on('click', function(e) {
      lat = e.latlng.lat;
      lng = e.latlng.lng;
      marker.setLatLng([lat, lng]);
    });

    document.getElementById('confirm').addEventListener('click', function() {
      var msg = JSON.stringify({ type: 'confirm', lat: lat, lng: lng });
      if (window.ReactNativeWebView) {
        window.ReactNativeWebView.postMessage(msg);
      } else {
        window.parent.postMessage(msg, '*');
      }
    });
  </script>
</body>
</html>`;
}

export const PinPickerModal: React.FC<Props> = ({
  visible,
  initialLatitude,
  initialLongitude,
  onConfirm,
  onClose,
}) => {
  const { colors, isDark } = useTheme();
  const { language } = useTranslation();
  const ar = language === 'ar';
  const [webLoaded, setWebLoaded] = useState(false);

  // Resolved coordinates — start null so the map only renders once we have them
  const [resolvedLat, setResolvedLat] = useState<number | null>(
    initialLatitude != null ? initialLatitude : null,
  );
  const [resolvedLng, setResolvedLng] = useState<number | null>(
    initialLongitude != null ? initialLongitude : null,
  );

  // Keep a stable ref to onConfirm so the useEffect listener doesn't need to
  // re-register every time the parent re-renders.
  const onConfirmRef = useRef(onConfirm);
  useEffect(() => { onConfirmRef.current = onConfirm; }, [onConfirm]);

  // When the modal opens, resolve the starting position:
  // 1. Prefer the explicit initialLatitude/initialLongitude props.
  // 2. Fall back to the device's last-known GPS fix (no permission prompt needed
  //    for cached data, but we catch any error gracefully).
  // 3. Final fallback: hardcoded Aswan default.
  useEffect(() => {
    if (!visible) return;

    // Reset both loading state and resolved coords on every open so the map
    // never briefly shows stale coordinates from a previous session before the
    // async lookup completes.
    setWebLoaded(false);
    setResolvedLat(null);
    setResolvedLng(null);

    if (initialLatitude != null && initialLongitude != null) {
      setResolvedLat(initialLatitude);
      setResolvedLng(initialLongitude);
      return;
    }

    let cancelled = false;

    (async () => {
      try {
        const last = await Location.getLastKnownPositionAsync({});
        if (!cancelled) {
          if (last) {
            setResolvedLat(last.coords.latitude);
            setResolvedLng(last.coords.longitude);
          } else {
            setResolvedLat(DEFAULT_LAT);
            setResolvedLng(DEFAULT_LNG);
          }
        }
      } catch {
        if (!cancelled) {
          setResolvedLat(DEFAULT_LAT);
          setResolvedLng(DEFAULT_LNG);
        }
      }
    })();

    return () => { cancelled = true; };
  }, [visible, initialLatitude, initialLongitude]);

  const lat = resolvedLat ?? DEFAULT_LAT;
  const lng = resolvedLng ?? DEFAULT_LNG;

  // Only build the HTML once we have resolved coordinates so the map doesn't
  // flicker from the default to the real position.
  const coordsReady = resolvedLat != null && resolvedLng != null;
  const html = coordsReady ? buildLeafletHtml(lat, lng, isDark, ar) : '';

  // Web platform: register / remove the cross-frame message listener exactly
  // once per modal open, and always clean up when the modal closes or unmounts.
  useEffect(() => {
    if (Platform.OS !== 'web' || !visible) return;

    const listener = (e: MessageEvent) => {
      try {
        const msg = typeof e.data === 'string' ? JSON.parse(e.data) : e.data;
        if (
          msg.type === 'confirm' &&
          typeof msg.lat === 'number' &&
          typeof msg.lng === 'number'
        ) {
          onConfirmRef.current({ latitude: msg.lat, longitude: msg.lng });
        }
      } catch {}
    };

    window.addEventListener('message', listener);
    return () => window.removeEventListener('message', listener);
  }, [visible]);

  // Native platform: WebView onMessage handler
  const handleWebMessage = useCallback(
    (event: { nativeEvent: { data: string } }) => {
      try {
        const msg = JSON.parse(event.nativeEvent.data);
        if (
          msg.type === 'confirm' &&
          typeof msg.lat === 'number' &&
          typeof msg.lng === 'number'
        ) {
          onConfirm({ latitude: msg.lat, longitude: msg.lng });
        }
      } catch {}
    },
    [onConfirm],
  );

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} />
      <SafeAreaView style={[styles.safe, { backgroundColor: colors.background }]}>
        <View style={[styles.header, { backgroundColor: colors.card, borderBottomColor: colors.border }]}>
          <TouchableOpacity
            onPress={onClose}
            style={styles.closeBtn}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Ionicons name="close" size={24} color={colors.text} />
          </TouchableOpacity>
          <Text style={[styles.title, { color: colors.text }]}>
            {ar ? 'تحديد موقع التسليم' : 'Set delivery pin'}
          </Text>
          <View style={{ width: 40 }} />
        </View>

        <View style={styles.mapContainer}>
          {(!coordsReady || !webLoaded) && (
            <View style={[styles.loadingOverlay, { backgroundColor: colors.surface }]}>
              <ActivityIndicator size="large" color={colors.primary} />
              <Text style={[styles.loadingText, { color: colors.textSecondary }]}>
                {ar ? 'جارِ تحميل الخريطة…' : 'Loading map…'}
              </Text>
            </View>
          )}

          {coordsReady && (
            Platform.OS === 'web'
              ? React.createElement('iframe', {
                  srcDoc: html,
                  style: {
                    width: '100%',
                    height: '100%',
                    border: 0,
                    background: isDark ? '#0B1220' : '#F3F4F6',
                  },
                  onLoad: () => setWebLoaded(true),
                  sandbox: 'allow-scripts allow-same-origin',
                })
              : (
                <WebViewNative
                  originWhitelist={['*']}
                  source={{ html }}
                  style={styles.webview}
                  javaScriptEnabled
                  domStorageEnabled={false}
                  cacheEnabled={false}
                  scrollEnabled={false}
                  androidLayerType="hardware"
                  onMessage={handleWebMessage}
                  onLoad={() => setWebLoaded(true)}
                />
              )
          )}
        </View>
      </SafeAreaView>
    </Modal>
  );
};

const styles = StyleSheet.create({
  safe: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  closeBtn: { width: 40, alignItems: 'flex-start' },
  title: { fontSize: 16, fontWeight: '700' },
  mapContainer: { flex: 1 },
  webview: { flex: 1 },
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    zIndex: 10,
  },
  loadingText: { fontSize: 13, fontWeight: '600' },
});

export default PinPickerModal;
