/**
 * Global Sync Indicator Component
 * Shows the current sync status with beautiful animations
 * States: idle (subtle pulse), syncing (animated), success (checkmark), error (warning)
 */
import React, { useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Animated,
  TouchableOpacity,
  Easing,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSyncStatus, useIsOnline, useAppStore } from '../../store/appStore';
import { useSyncService } from '../../services/syncService';

interface SyncIndicatorProps {
  compact?: boolean;
  showLabel?: boolean;
}

export const SyncIndicator: React.FC<SyncIndicatorProps> = ({
  compact = false,
  showLabel = true,
}) => {
  const syncStatus = useSyncStatus();
  const isOnline = useIsOnline();
  const lastSyncTime = useAppStore((state) => state.lastSyncTime);
  const { forceSync } = useSyncService();

  // Animation values
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const rotateAnim = useRef(new Animated.Value(0)).current;
  const scaleAnim = useRef(new Animated.Value(0)).current;

  // Pulse animation for idle state
  useEffect(() => {
    if (syncStatus === 'idle' && isOnline) {
      const pulse = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, {
            toValue: 1.2,
            duration: 2000,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
          Animated.timing(pulseAnim, {
            toValue: 1,
            duration: 2000,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
        ])
      );
      pulse.start();
      return () => pulse.stop();
    } else {
      pulseAnim.setValue(1);
    }
  }, [syncStatus, isOnline]);

  // Rotation animation for syncing state
  useEffect(() => {
    if (syncStatus === 'syncing') {
      const rotate = Animated.loop(
        Animated.timing(rotateAnim, {
          toValue: 1,
          duration: 1000,
          easing: Easing.linear,
          useNativeDriver: true,
        })
      );
      rotate.start();
      return () => rotate.stop();
    } else {
      rotateAnim.setValue(0);
    }
  }, [syncStatus]);

  // Pop animation for success/error states
  useEffect(() => {
    if (syncStatus === 'success' || syncStatus === 'error') {
      scaleAnim.setValue(0); // Reset before animating
      Animated.sequence([
        Animated.timing(scaleAnim, {
          toValue: 1.3,
          duration: 150,
          useNativeDriver: true,
        }),
        Animated.timing(scaleAnim, {
          toValue: 1,
          duration: 150,
          useNativeDriver: true,
        }),
      ]).start();
    }
  }, [syncStatus]);

  const rotation = rotateAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });

  const getStatusConfig = () => {
    if (!isOnline) {
      return {
        icon: 'cloud-offline-outline' as const,
        color: '#9CA3AF',
        label: 'Offline',
        bgColor: '#F3F4F6',
      };
    }

    switch (syncStatus) {
      case 'syncing':
        return {
          icon: 'sync' as const,
          color: '#3B82F6',
          label: 'Syncing...',
          bgColor: '#EFF6FF',
        };
      case 'success':
        return {
          icon: 'checkmark-circle' as const,
          color: '#10B981',
          label: 'Synced',
          bgColor: '#ECFDF5',
        };
      case 'error':
        return {
          icon: 'alert-circle' as const,
          color: '#EF4444',
          label: 'Error',
          bgColor: '#FEF2F2',
        };
      default:
        return {
          icon: 'cloud-done-outline' as const,
          color: '#6B7280',
          label: 'Ready',
          bgColor: '#F9FAFB',
        };
    }
  };

  const config = getStatusConfig();

  const formatLastSync = () => {
    if (!lastSyncTime) return 'Never';
    const diff = Date.now() - lastSyncTime;
    const seconds = Math.floor(diff / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);

    if (seconds < 60) return 'Just now';
    if (minutes < 60) return `${minutes}m ago`;
    if (hours < 24) return `${hours}h ago`;
    return 'Long ago';
  };

  if (compact) {
    return (
      <TouchableOpacity onPress={forceSync} activeOpacity={0.7}>
        <Animated.View
          style={[
            styles.compactContainer,
            {
              backgroundColor: config.bgColor,
              transform: [
                { scale: syncStatus === 'idle' ? pulseAnim : scaleAnim },
                { rotate: syncStatus === 'syncing' ? rotation : '0deg' },
              ],
            },
          ]}
        >
          <Ionicons name={config.icon} size={16} color={config.color} />
        </Animated.View>
      </TouchableOpacity>
    );
  }

  return (
    <TouchableOpacity
      style={[styles.container, { backgroundColor: config.bgColor }]}
      onPress={forceSync}
      activeOpacity={0.7}
    >
      <Animated.View
        style={{
          transform: [
            { rotate: syncStatus === 'syncing' ? rotation : '0deg' },
            { scale: syncStatus === 'success' || syncStatus === 'error' ? scaleAnim : 1 },
          ],
        }}
      >
        <Ionicons name={config.icon} size={18} color={config.color} />
      </Animated.View>
      
      {showLabel && (
        <View style={styles.textContainer}>
          <Text style={[styles.label, { color: config.color }]}>
            {config.label}
          </Text>
          {syncStatus === 'idle' && lastSyncTime && (
            <Text style={styles.lastSync}>{formatLastSync()}</Text>
          )}
        </View>
      )}
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 16,
    gap: 6,
  },
  compactContainer: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  textContainer: {
    flexDirection: 'column',
  },
  label: {
    fontSize: 12,
    fontWeight: '600',
  },
  lastSync: {
    fontSize: 9,
    color: '#9CA3AF',
  },
});

export default SyncIndicator;
