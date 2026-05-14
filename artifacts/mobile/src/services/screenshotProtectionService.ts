/**
 * Screenshot Protection Service
 * Prevents screenshots on all screens except Home and Product Detail
 * Uses expo-screen-capture for cross-platform support
 */
import * as ScreenCapture from 'expo-screen-capture';
import { Platform, AppState, AppStateStatus } from 'react-native';

// Screens where screenshots ARE allowed
const ALLOWED_SCREENS = [
  '(tabs)',           // Home tab
  '(tabs)/index',     // Home screen
  'index',            // Home screen
  'product/[id]',     // Product detail
  'product',          // Product detail
];

class ScreenshotProtectionService {
  private isProtectionEnabled = false;
  private currentScreen = '';
  private appStateSubscription: any = null;

  /**
   * Initialize the screenshot protection service
   */
  async initialize(): Promise<void> {
    try {
      // Check if screen capture is available
      const isAvailable = await ScreenCapture.isAvailableAsync();
      
      if (!isAvailable) {
        console.log('[ScreenshotProtection] Screen capture API not available on this device');
        return;
      }

      // Subscribe to app state changes to manage protection
      this.appStateSubscription = AppState.addEventListener('change', this.handleAppStateChange);
      
      console.log('[ScreenshotProtection] Service initialized');
    } catch (error) {
      console.error('[ScreenshotProtection] Initialization failed:', error);
    }
  }

  /**
   * Handle app state changes
   */
  private handleAppStateChange = async (nextAppState: AppStateStatus) => {
    if (nextAppState === 'active') {
      // Re-apply protection when app comes to foreground
      if (!this.isScreenshotAllowed(this.currentScreen)) {
        await this.enableProtection();
      }
    }
  };

  /**
   * Check if screenshot is allowed for the current screen
   */
  isScreenshotAllowed(screenName: string): boolean {
    // Check if screen matches any allowed pattern
    return ALLOWED_SCREENS.some(allowed => {
      // Exact match
      if (screenName === allowed) return true;
      
      // Check if screen starts with allowed pattern (for nested routes)
      if (screenName.startsWith(allowed)) return true;
      
      // Check for product detail pattern
      if (allowed === 'product/[id]' && screenName.startsWith('product/')) return true;
      
      return false;
    });
  }

  /**
   * Update protection based on current screen
   */
  async updateForScreen(screenName: string): Promise<void> {
    this.currentScreen = screenName;
    
    console.log(`[ScreenshotProtection] Screen changed to: ${screenName}`);

    if (this.isScreenshotAllowed(screenName)) {
      console.log('[ScreenshotProtection] Screenshots ALLOWED on this screen');
      await this.disableProtection();
    } else {
      console.log('[ScreenshotProtection] Screenshots BLOCKED on this screen');
      await this.enableProtection();
    }
  }

  /**
   * Enable screenshot protection
   */
  async enableProtection(): Promise<void> {
    if (this.isProtectionEnabled) return;

    try {
      await ScreenCapture.preventScreenCaptureAsync();
      this.isProtectionEnabled = true;
      console.log('[ScreenshotProtection] Protection ENABLED');
    } catch (error) {
      console.error('[ScreenshotProtection] Failed to enable protection:', error);
    }
  }

  /**
   * Disable screenshot protection
   */
  async disableProtection(): Promise<void> {
    if (!this.isProtectionEnabled) return;

    try {
      await ScreenCapture.allowScreenCaptureAsync();
      this.isProtectionEnabled = false;
      console.log('[ScreenshotProtection] Protection DISABLED');
    } catch (error) {
      console.error('[ScreenshotProtection] Failed to disable protection:', error);
    }
  }

  /**
   * Get current protection status
   */
  getStatus(): { isEnabled: boolean; currentScreen: string; isAllowed: boolean } {
    return {
      isEnabled: this.isProtectionEnabled,
      currentScreen: this.currentScreen,
      isAllowed: this.isScreenshotAllowed(this.currentScreen),
    };
  }

  /**
   * Add listener for screenshot taken events
   */
  addScreenshotListener(callback: () => void): () => void {
    const subscription = ScreenCapture.addScreenshotListener(callback);
    return () => subscription.remove();
  }

  /**
   * Cleanup and disable protection
   */
  async cleanup(): Promise<void> {
    if (this.appStateSubscription) {
      this.appStateSubscription.remove();
      this.appStateSubscription = null;
    }
    
    await this.disableProtection();
    console.log('[ScreenshotProtection] Service cleaned up');
  }
}

export const screenshotProtectionService = new ScreenshotProtectionService();
export default screenshotProtectionService;
