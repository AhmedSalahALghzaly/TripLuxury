import React, { memo, useCallback } from 'react';
import {
  View,
  TouchableOpacity,
  StyleSheet,
  Text,
  useWindowDimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { VideoView, useVideoPlayer } from 'expo-video';
import { useEvent } from 'expo';
import { useTranslation } from '../../hooks/useTranslation';
import { useTheme } from '../../hooks/useTheme';
import {
  FONTS,
  SPACING,
  RADII,
  COLORS,
  OVERLAYS,
} from '../../constants/luxuryTokens';

interface Props {
  videoUrl: string;
}

export default memo(function FooterVideo({ videoUrl }: Props) {
  const { language } = useTranslation();
  const { isDark } = useTheme();
  const { width: screenWidth } = useWindowDimensions();
  const playBtnSize = Math.round(Math.min(52, Math.max(36, screenWidth * 0.107)));
  const videoHeight = Math.round(Math.min(300, Math.max(200, screenWidth * 0.56)));

  const player = useVideoPlayer(videoUrl ? { uri: videoUrl } : null, (p) => {
    p.loop = true;
    p.muted = true;
    p.play();
  });

  const { isPlaying } = useEvent(player, 'playingChange', {
    isPlaying: player.playing,
  });

  const { muted: isMuted } = useEvent(player, 'mutedChange', {
    muted: player.muted,
  });

  const togglePlayback = useCallback(() => {
    if (player.playing) {
      player.pause();
    } else {
      player.play();
    }
  }, [player]);

  const toggleMute = useCallback(() => {
    player.muted = !player.muted;
  }, [player]);

  if (!videoUrl) return null;

  return (
    <View style={styles.wrapper}>
      {/* Section label */}
      <View style={styles.labelRow}>
        <View style={[styles.divider, { backgroundColor: OVERLAYS.goldHairline }]} />
        <Text style={styles.label}>
          {language === 'ar' ? 'لمسة خاصة' : 'OUR STORY'}
        </Text>
        <View style={[styles.divider, { backgroundColor: OVERLAYS.goldHairline }]} />
      </View>

      <View style={[
        styles.videoContainer,
        { height: videoHeight, borderColor: isDark ? OVERLAYS.goldInnerGlow : 'rgba(200,162,74,0.25)' },
      ]}>
        <VideoView
          player={player}
          style={styles.video}
          contentFit="cover"
          nativeControls={false}
        />

        {/* Subtle dark overlay */}
        <View style={styles.overlay} pointerEvents="none" />

        {/* Bottom controls row */}
        <View style={styles.controls}>
          {/* Tap-to-unmute / remute button (left) */}
          <TouchableOpacity
            style={[styles.ctrlBtn, styles.muteBtn]}
            onPress={toggleMute}
            activeOpacity={0.85}
            accessibilityLabel={isMuted ? 'Unmute video' : 'Mute video'}
          >
            <Ionicons
              name={isMuted ? 'volume-mute' : 'volume-high'}
              size={18}
              color={isMuted ? COLORS.ivory : COLORS.gold}
            />
            <Text style={[styles.muteLabel, { color: isMuted ? COLORS.ivory : COLORS.gold }]}>
              {isMuted
                ? (language === 'ar' ? 'إلغاء الكتم' : 'Unmute')
                : (language === 'ar' ? 'كتم' : 'Mute')}
            </Text>
          </TouchableOpacity>

          {/* Play / Pause button (right) */}
          <TouchableOpacity
            style={[styles.ctrlBtn, styles.playBtn, { width: playBtnSize, height: playBtnSize }]}
            onPress={togglePlayback}
            activeOpacity={0.85}
            accessibilityLabel={isPlaying ? 'Pause video' : 'Play video'}
          >
            <Ionicons
              name={isPlaying ? 'pause' : 'play'}
              size={20}
              color={COLORS.charcoalDeep}
            />
          </TouchableOpacity>
        </View>
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
  labelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.md,
    marginBottom: SPACING.lg,
  },
  divider: {
    flex: 1,
    height: 1,
  },
  label: {
    fontFamily: FONTS.body,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 2,
    color: COLORS.gold,
    textTransform: 'uppercase',
  },
  videoContainer: {
    borderRadius: RADII.lg,
    borderWidth: 1.5,
    overflow: 'hidden',
    position: 'relative',
  },
  video: {
    width: '100%',
    height: '100%',
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.20)',
  },
  controls: {
    position: 'absolute',
    bottom: SPACING.md,
    left: SPACING.md,
    right: SPACING.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  ctrlBtn: {
    borderRadius: RADII.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  muteBtn: {
    flexDirection: 'row',
    gap: 5,
    backgroundColor: 'rgba(0,0,0,0.55)',
    paddingHorizontal: SPACING.md,
    paddingVertical: 7,
  },
  muteLabel: {
    fontFamily: FONTS.body,
    fontSize: 11,
    fontWeight: '600',
  },
  playBtn: {
    backgroundColor: COLORS.gold,
  },
});
