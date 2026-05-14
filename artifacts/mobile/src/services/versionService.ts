/**
 * Version Management Service
 * Handles API version checking and cache management for deployment readiness
 * v1.0.0
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import { Alert, Platform } from 'react-native';
import { api } from './api';

// Storage keys
const VERSION_CACHE_KEY = '@alghazaly:last_api_version';
const LAST_CLEAR_KEY = '@alghazaly:last_cache_clear';
const UI_VERSION_KEY = '@alghazaly:ui_version';

// Current app version from app.json
const APP_VERSION = Constants.expoConfig?.version || '1.0.0';
const UI_VERSION = '4.1.0'; // Modern UI version identifier

interface VersionInfo {
  api_version: string;
  build_date: string;
  min_frontend_version: string;
  features: string[];
}

interface VersionCheckResult {
  isCompatible: boolean;
  needsRefresh: boolean;
  apiVersion: string | null;
  message: string;
}

/**
 * Compare semantic versions
 * Returns: -1 if a < b, 0 if a === b, 1 if a > b
 */
function compareVersions(a: string, b: string): number {
  const partsA = a.split('.').map(Number);
  const partsB = b.split('.').map(Number);
  
  for (let i = 0; i < Math.max(partsA.length, partsB.length); i++) {
    const numA = partsA[i] || 0;
    const numB = partsB[i] || 0;
    
    if (numA < numB) return -1;
    if (numA > numB) return 1;
  }
  
  return 0;
}

/**
 * Check if the frontend version is compatible with the API
 */
export async function checkVersionCompatibility(): Promise<VersionCheckResult> {
  try {
    const response = await api.get('/version');
    const versionInfo: VersionInfo = response.data;
    
    // Store the API version for future comparison
    const lastApiVersion = await AsyncStorage.getItem(VERSION_CACHE_KEY);
    await AsyncStorage.setItem(VERSION_CACHE_KEY, versionInfo.api_version);
    
    // Check if frontend meets minimum version requirement
    const isCompatible = compareVersions(APP_VERSION, versionInfo.min_frontend_version) >= 0;
    
    // Check if API version changed (might need cache refresh)
    const apiVersionChanged = lastApiVersion !== null && lastApiVersion !== versionInfo.api_version;
    
    // Check if UI version is current
    const storedUIVersion = await AsyncStorage.getItem(UI_VERSION_KEY);
    const uiVersionMismatch = storedUIVersion !== null && storedUIVersion !== UI_VERSION;
    
    // Store current UI version
    await AsyncStorage.setItem(UI_VERSION_KEY, UI_VERSION);
    
    const needsRefresh = apiVersionChanged || uiVersionMismatch;
    
    let message = 'Version check passed';
    if (!isCompatible) {
      message = `App version ${APP_VERSION} is below minimum required ${versionInfo.min_frontend_version}`;
    } else if (needsRefresh) {
      message = 'New version detected - cache refresh recommended';
    }
    
    return {
      isCompatible,
      needsRefresh,
      apiVersion: versionInfo.api_version,
      message,
    };
  } catch (error) {
    console.warn('[VersionService] Version check failed:', error);
    return {
      isCompatible: true, // Assume compatible if offline
      needsRefresh: false,
      apiVersion: null,
      message: 'Version check skipped (offline)',
    };
  }
}

/**
 * Clear all app caches for fresh start
 */
export async function clearAllCaches(): Promise<boolean> {
  try {
    // Get all AsyncStorage keys
    const allKeys = await AsyncStorage.getAllKeys();
    
    // Keys to preserve (authentication, user preferences)
    const preservePatterns = [
      '@alghazaly:auth_token',
      '@alghazaly:user_data',
      '@alghazaly:theme_mode',
      '@alghazaly:language',
    ];
    
    // Filter keys to remove
    const keysToRemove = allKeys.filter(key => {
      return !preservePatterns.some(pattern => key.includes(pattern));
    });
    
    // Remove filtered keys
    if (keysToRemove.length > 0) {
      await AsyncStorage.multiRemove(keysToRemove);
    }
    
    // Store cache clear timestamp
    await AsyncStorage.setItem(LAST_CLEAR_KEY, new Date().toISOString());
    
    console.log(`[VersionService] Cleared ${keysToRemove.length} cache entries`);
    return true;
  } catch (error) {
    console.error('[VersionService] Cache clear failed:', error);
    return false;
  }
}

/**
 * Force refresh the app data by clearing caches
 * Shows user confirmation dialog
 */
export async function forceRefreshWithConfirmation(
  language: 'en' | 'ar' = 'en'
): Promise<boolean> {
  return new Promise((resolve) => {
    const title = language === 'ar' ? 'تحديث البيانات' : 'Refresh Data';
    const message = language === 'ar' 
      ? 'سيتم مسح البيانات المؤقتة وإعادة تحميل أحدث البيانات. هل تريد المتابعة؟'
      : 'This will clear cached data and reload the latest data. Continue?';
    const confirmText = language === 'ar' ? 'تحديث' : 'Refresh';
    const cancelText = language === 'ar' ? 'إلغاء' : 'Cancel';
    
    Alert.alert(
      title,
      message,
      [
        {
          text: cancelText,
          style: 'cancel',
          onPress: () => resolve(false),
        },
        {
          text: confirmText,
          style: 'destructive',
          onPress: async () => {
            const success = await clearAllCaches();
            resolve(success);
          },
        },
      ]
    );
  });
}

/**
 * Get last cache clear timestamp
 */
export async function getLastCacheClear(): Promise<string | null> {
  return AsyncStorage.getItem(LAST_CLEAR_KEY);
}

/**
 * Get current version info
 */
export function getCurrentVersionInfo() {
  return {
    appVersion: APP_VERSION,
    uiVersion: UI_VERSION,
    platform: Platform.OS,
    isModernUI: true,
  };
}

/**
 * Check if should auto-clear cache (e.g., after major version update)
 */
export async function shouldAutoClearCache(): Promise<boolean> {
  try {
    const storedUIVersion = await AsyncStorage.getItem(UI_VERSION_KEY);
    
    // If no stored version, this is first run - don't clear
    if (!storedUIVersion) {
      await AsyncStorage.setItem(UI_VERSION_KEY, UI_VERSION);
      return false;
    }
    
    // If major version changed, auto-clear
    const storedMajor = parseInt(storedUIVersion.split('.')[0], 10);
    const currentMajor = parseInt(UI_VERSION.split('.')[0], 10);
    
    if (currentMajor > storedMajor) {
      console.log('[VersionService] Major version upgrade detected, auto-clearing cache');
      return true;
    }
    
    return false;
  } catch (error) {
    console.error('[VersionService] Error checking auto-clear:', error);
    return false;
  }
}

export default {
  checkVersionCompatibility,
  clearAllCaches,
  forceRefreshWithConfirmation,
  getLastCacheClear,
  getCurrentVersionInfo,
  shouldAutoClearCache,
  compareVersions,
};
