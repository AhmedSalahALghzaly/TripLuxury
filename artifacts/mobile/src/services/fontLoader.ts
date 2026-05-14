/**
 * Asset Loading Service - High-Performance Architecture
 * 
 * Features:
 * - Graceful degradation for font loading (13500ms timeout)
 * - Pre-fetching during native splash phase
 * - Fail-safe mechanisms for immediate usability
 */
import * as Font from 'expo-font';
import * as SplashScreen from 'expo-splash-screen';
import { Platform } from 'react-native';

// Configuration Constants
const FONT_LOADING_TIMEOUT = 13500; // 13.5 seconds - graceful degradation threshold
const ASSET_PREFETCH_TIMEOUT = 10000; // 10 seconds for asset prefetch

// Asset loading state
interface AssetLoadingState {
  fontsLoaded: boolean;
  fontsError: boolean;
  assetsReady: boolean;
}

let assetState: AssetLoadingState = {
  fontsLoaded: false,
  fontsError: false,
  assetsReady: false,
};

/**
 * Load fonts with graceful degradation
 * If fonts fail to load within timeout, app proceeds with system fonts
 */
export const loadFontsWithGracefulDegradation = async (fonts?: Record<string, any>): Promise<boolean> => {
  // If no custom fonts specified, mark as loaded immediately
  if (!fonts || Object.keys(fonts).length === 0) {
    assetState.fontsLoaded = true;
    return true;
  }

  return new Promise((resolve) => {
    // Timeout handler - graceful degradation
    const timeoutId = setTimeout(() => {
      if (!assetState.fontsLoaded) {
        console.warn('[AssetLoader] Font loading timeout (13.5s) - proceeding with system fonts');
        assetState.fontsError = true;
        assetState.fontsLoaded = true; // Mark as "loaded" to allow app to proceed
        resolve(false);
      }
    }, FONT_LOADING_TIMEOUT);

    // Attempt to load fonts
    Font.loadAsync(fonts)
      .then(() => {
        clearTimeout(timeoutId);
        assetState.fontsLoaded = true;
        assetState.fontsError = false;
        resolve(true);
      })
      .catch((error) => {
        clearTimeout(timeoutId);
        console.warn('[AssetLoader] Font loading failed - using system fonts:', error.message);
        assetState.fontsError = true;
        assetState.fontsLoaded = true;
        resolve(false);
      });
  });
};

/**
 * Prefetch critical assets during splash screen
 * Called before main app renders
 */
export const prefetchCriticalAssets = async (): Promise<void> => {
  const startTime = Date.now();
  
  try {
    // Keep splash screen visible during prefetch
    await SplashScreen.preventAutoHideAsync().catch(() => {
      // Ignore if splash screen already hidden
    });

    // Web-specific: warm up document fonts
    if (Platform.OS === 'web' && typeof document !== 'undefined' && document.fonts) {
      await Promise.race([
        document.fonts.ready,
        new Promise((resolve) => setTimeout(resolve, ASSET_PREFETCH_TIMEOUT))
      ]).catch(() => {});
    }

    assetState.assetsReady = true;
    const elapsed = Date.now() - startTime;
    
    if (elapsed > 1000) {
      console.log(`[AssetLoader] Assets prefetched in ${elapsed}ms`);
    }
  } catch (error) {
    // Non-blocking - app should still proceed
    assetState.assetsReady = true;
  }
};

/**
 * Hide splash screen when app is ready
 */
export const hideSplashScreen = async (): Promise<void> => {
  try {
    await SplashScreen.hideAsync();
  } catch (error) {
    // Ignore errors - splash may already be hidden
  }
};

/**
 * Get current asset loading state
 */
export const getAssetState = (): AssetLoadingState => ({ ...assetState });

/**
 * Reset asset state (for testing/hot reload)
 */
export const resetAssetState = (): void => {
  assetState = {
    fontsLoaded: false,
    fontsError: false,
    assetsReady: false,
  };
};

export default {
  loadFontsWithGracefulDegradation,
  prefetchCriticalAssets,
  hideSplashScreen,
  getAssetState,
  resetAssetState,
  FONT_LOADING_TIMEOUT,
};
