/**
 * AppVersionInfo Component
 * Displays app version, build timestamp, and cache status
 * Helps verify which code version is running
 * Now includes deployment readiness and cache management
 */
import React, { useMemo, useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
  Platform,
  ActivityIndicator,
} from 'react-native';
import Constants from 'expo-constants';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../hooks/useTheme';
import { useTranslation } from '../../hooks/useTranslation';
import versionService from '../../services/versionService';

// Build timestamp is injected at build time
const BUILD_TIMESTAMP = new Date().toISOString();

// Get app version from app.json through Expo Constants
const getAppVersion = () => {
  return Constants.expoConfig?.version || '1.0.0';
};

// Generate a unique build identifier based on timestamp
const getBuildId = () => {
  const now = new Date();
  const buildId = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}.${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}`;
  return buildId;
};

interface AppVersionInfoProps {
  showDetails?: boolean;
  compact?: boolean;
  showRefreshButton?: boolean;
}

export const AppVersionInfo: React.FC<AppVersionInfoProps> = ({
  showDetails = false,
  compact = false,
  showRefreshButton = false,
}) => {
  const { colors } = useTheme();
  const { language } = useTranslation();
  const [tapCount, setTapCount] = useState(0);
  const [isChecking, setIsChecking] = useState(false);
  const [apiVersion, setApiVersion] = useState<string | null>(null);
  const [needsRefresh, setNeedsRefresh] = useState(false);

  const appVersion = useMemo(() => getAppVersion(), []);
  const buildId = useMemo(() => getBuildId(), []);
  const buildDate = useMemo(() => {
    const now = new Date();
    return now.toLocaleDateString(language === 'ar' ? 'ar-EG' : 'en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }, [language]);

  // Check version compatibility on mount
  useEffect(() => {
    const checkVersion = async () => {
      const result = await versionService.checkVersionCompatibility();
      setApiVersion(result.apiVersion);
      setNeedsRefresh(result.needsRefresh);
    };
    checkVersion();
  }, []);

  const handleTap = () => {
    const newCount = tapCount + 1;
    setTapCount(newCount);

    // Easter egg: 5 taps reveals technical details
    if (newCount >= 5) {
      Alert.alert(
        language === 'ar' ? 'معلومات التطبيق' : 'App Info',
        `Version: ${appVersion}\nBuild: ${buildId}\nTimestamp: ${BUILD_TIMESTAMP}\nPlatform: ${Platform.OS}\nAPI Version: ${apiVersion || 'N/A'}\nUI: Modern v4.1\n\n${language === 'ar' ? 'تم التحقق من أحدث إصدار!' : 'Latest version verified!'}`
      );
      setTapCount(0);
    }
  };

  const handleRefresh = async () => {
    setIsChecking(true);
    try {
      const success = await versionService.forceRefreshWithConfirmation(language as 'en' | 'ar');
      if (success) {
        // Re-check version after refresh
        const result = await versionService.checkVersionCompatibility();
        setApiVersion(result.apiVersion);
        setNeedsRefresh(false);
        
        Alert.alert(
          language === 'ar' ? 'تم التحديث' : 'Refreshed',
          language === 'ar' ? 'تم مسح البيانات المؤقتة. يرجى إعادة تشغيل التطبيق.' : 'Cache cleared. Please restart the app.'
        );
      }
    } catch (error) {
      console.error('Refresh error:', error);
    } finally {
      setIsChecking(false);
    }
  };

  if (compact) {
    return (
      <TouchableOpacity onPress={handleTap} activeOpacity={0.7}>
        <Text style={[styles.compactText, { color: colors.textSecondary }]}>
          v{appVersion} {needsRefresh && '🔄'}
        </Text>
      </TouchableOpacity>
    );
  }

  return (
    <TouchableOpacity
      style={[
        styles.container,
        { backgroundColor: colors.surface, borderColor: needsRefresh ? colors.warning || '#F59E0B' : colors.border },
      ]}
      onPress={handleTap}
      activeOpacity={0.7}
    >
      <View style={styles.iconContainer}>
        <Ionicons 
          name={needsRefresh ? "refresh-circle-outline" : "information-circle-outline"} 
          size={20} 
          color={needsRefresh ? colors.warning || '#F59E0B' : colors.primary} 
        />
      </View>
      <View style={styles.infoContainer}>
        <Text style={[styles.label, { color: colors.textSecondary }]}>
          {language === 'ar' ? 'إصدار التطبيق' : 'App Version'}
        </Text>
        <Text style={[styles.version, { color: colors.text }]}>
          v{appVersion} ({buildId})
        </Text>
        {showDetails && (
          <>
            <Text style={[styles.timestamp, { color: colors.textSecondary }]}>
              {buildDate}
            </Text>
            {apiVersion && (
              <Text style={[styles.apiVersion, { color: colors.textSecondary }]}>
                API: {apiVersion}
              </Text>
            )}
          </>
        )}
      </View>
      
      {showRefreshButton && needsRefresh ? (
        <TouchableOpacity 
          style={[styles.refreshButton, { backgroundColor: colors.warning || '#F59E0B' }]}
          onPress={handleRefresh}
          disabled={isChecking}
        >
          {isChecking ? (
            <ActivityIndicator size="small" color="#FFF" />
          ) : (
            <Ionicons name="refresh" size={16} color="#FFF" />
          )}
        </TouchableOpacity>
      ) : (
        <View style={styles.badge}>
          <Text style={[styles.badgeText, { color: colors.success || '#10B981' }]}>
            {language === 'ar' ? 'محدث' : 'Latest'}
          </Text>
        </View>
      )}
    </TouchableOpacity>
  );
};

// Export a simple version string for use elsewhere
export const getVersionString = () => `v${getAppVersion()} (${getBuildId()})`;

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    marginVertical: 8,
  },
  iconContainer: {
    marginRight: 12,
  },
  infoContainer: {
    flex: 1,
  },
  label: {
    fontSize: 11,
    fontWeight: '500',
    textTransform: 'uppercase',
    marginBottom: 2,
  },
  version: {
    fontSize: 14,
    fontWeight: '600',
  },
  timestamp: {
    fontSize: 11,
    marginTop: 2,
  },
  apiVersion: {
    fontSize: 10,
    marginTop: 1,
  },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    backgroundColor: 'rgba(16, 185, 129, 0.1)',
  },
  badgeText: {
    fontSize: 10,
    fontWeight: '700',
  },
  compactText: {
    fontSize: 11,
    fontWeight: '500',
  },
  refreshButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

export default AppVersionInfo;
