/**
 * Auto Logout Service
 * Automatically logs out user after 90 days (3 months) of inactivity
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState, AppStateStatus } from 'react-native';

const LAST_ACTIVITY_KEY = 'alghazaly_last_activity';
const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000; // 90 days in milliseconds

type LogoutCallback = () => void;

class AutoLogoutService {
  private lastActivityTimestamp: number = Date.now();
  private appStateSubscription: any = null;
  private checkInterval: ReturnType<typeof setInterval> | null = null;
  private logoutCallback: LogoutCallback | null = null;

  /**
   * Initialize the auto logout service
   */
  async initialize(onLogout: LogoutCallback): Promise<void> {
    this.logoutCallback = onLogout;

    // Load last activity from storage
    await this.loadLastActivity();

    // Check if user should be logged out immediately
    if (await this.shouldLogout()) {
      console.log('[AutoLogout] User inactive for 90+ days, logging out...');
      this.triggerLogout();
      return;
    }

    // Subscribe to app state changes
    this.appStateSubscription = AppState.addEventListener('change', this.handleAppStateChange);

    // Set up periodic check (every hour)
    this.checkInterval = setInterval(() => {
      this.checkAndLogoutIfNeeded();
    }, 60 * 60 * 1000); // 1 hour

    console.log('[AutoLogout] Service initialized');
  }

  /**
   * Load last activity timestamp from storage
   */
  private async loadLastActivity(): Promise<void> {
    try {
      const stored = await AsyncStorage.getItem(LAST_ACTIVITY_KEY);
      if (stored) {
        this.lastActivityTimestamp = parseInt(stored, 10);
      } else {
        // First time, set to now
        await this.updateActivity();
      }
    } catch (error) {
      console.error('[AutoLogout] Failed to load last activity:', error);
    }
  }

  /**
   * Handle app state changes
   */
  private handleAppStateChange = async (nextAppState: AppStateStatus) => {
    if (nextAppState === 'active') {
      // App came to foreground - check for logout and update activity
      await this.checkAndLogoutIfNeeded();
      await this.updateActivity();
    }
  };

  /**
   * Update last activity timestamp
   */
  async updateActivity(): Promise<void> {
    const now = Date.now();
    this.lastActivityTimestamp = now;

    try {
      await AsyncStorage.setItem(LAST_ACTIVITY_KEY, now.toString());
    } catch (error) {
      console.error('[AutoLogout] Failed to save last activity:', error);
    }
  }

  /**
   * Check if user should be logged out
   */
  async shouldLogout(): Promise<boolean> {
    const now = Date.now();
    const timeSinceLastActivity = now - this.lastActivityTimestamp;
    return timeSinceLastActivity > NINETY_DAYS_MS;
  }

  /**
   * Get days since last activity
   */
  getDaysSinceLastActivity(): number {
    const now = Date.now();
    const timeSinceLastActivity = now - this.lastActivityTimestamp;
    return Math.floor(timeSinceLastActivity / (24 * 60 * 60 * 1000));
  }

  /**
   * Get days until auto logout
   */
  getDaysUntilLogout(): number {
    const daysSinceActivity = this.getDaysSinceLastActivity();
    return Math.max(0, 90 - daysSinceActivity);
  }

  /**
   * Check and logout if needed
   */
  private async checkAndLogoutIfNeeded(): Promise<void> {
    if (await this.shouldLogout()) {
      console.log('[AutoLogout] Inactivity threshold reached, logging out...');
      this.triggerLogout();
    }
  }

  /**
   * Trigger the logout callback
   */
  private triggerLogout(): void {
    if (this.logoutCallback) {
      this.logoutCallback();
    }
  }

  /**
   * Get status info
   */
  getStatus(): {
    lastActivity: number;
    daysSinceActivity: number;
    daysUntilLogout: number;
    isAtRisk: boolean;
  } {
    const daysSinceActivity = this.getDaysSinceLastActivity();
    return {
      lastActivity: this.lastActivityTimestamp,
      daysSinceActivity,
      daysUntilLogout: this.getDaysUntilLogout(),
      isAtRisk: daysSinceActivity >= 75, // Warn when 15 days away from logout
    };
  }

  /**
   * Cleanup the service
   */
  cleanup(): void {
    if (this.appStateSubscription) {
      this.appStateSubscription.remove();
      this.appStateSubscription = null;
    }

    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }

    this.logoutCallback = null;
    console.log('[AutoLogout] Service cleaned up');
  }

  /**
   * Reset activity (call this on any user interaction)
   */
  async recordUserActivity(): Promise<void> {
    await this.updateActivity();
  }

  /**
   * Clear all stored activity data (on logout)
   */
  async clearActivityData(): Promise<void> {
    try {
      await AsyncStorage.removeItem(LAST_ACTIVITY_KEY);
      this.lastActivityTimestamp = Date.now();
    } catch (error) {
      console.error('[AutoLogout] Failed to clear activity data:', error);
    }
  }
}

export const autoLogoutService = new AutoLogoutService();
export default autoLogoutService;
