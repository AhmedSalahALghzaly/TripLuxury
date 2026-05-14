/**
 * Enhanced Haptic Feedback Service
 * Provides refined haptic patterns for different interactions
 */
import * as Haptics from 'expo-haptics';
import { Platform } from 'react-native';

// Haptic pattern types
export type HapticPattern = 
  | 'tap'           // Light tap for buttons
  | 'select'        // Selection feedback
  | 'success'       // Success notification
  | 'error'         // Error notification
  | 'warning'       // Warning notification
  | 'delete'        // Delete action
  | 'longPress'     // Long press start
  | 'drag'          // Dragging feedback
  | 'drop'          // Drop feedback
  | 'toggle'        // Toggle on/off
  | 'slide'         // Slider adjustment
  | 'pull'          // Pull to refresh
  | 'bounce'        // Bounce effect
  | 'confirm'       // Confirmation action
  | 'cancel'        // Cancel action
  | 'menu'          // Menu open
  | 'navigation'    // Navigation transition
  | 'newOrder';     // New incoming order (triple heavy pulse)

class HapticFeedbackService {
  private enabled: boolean = true;
  private lastTriggerTime: number = 0;
  private minInterval: number = 50; // Minimum ms between haptics

  /**
   * Enable or disable haptic feedback globally
   */
  setEnabled(enabled: boolean) {
    this.enabled = enabled;
  }

  /**
   * Check if enough time has passed since last haptic
   */
  private shouldTrigger(): boolean {
    const now = Date.now();
    if (now - this.lastTriggerTime < this.minInterval) {
      return false;
    }
    this.lastTriggerTime = now;
    return true;
  }

  /**
   * Trigger a haptic feedback pattern
   */
  async trigger(pattern: HapticPattern): Promise<void> {
    if (!this.enabled || !this.shouldTrigger()) return;

    try {
      switch (pattern) {
        case 'tap':
          await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          break;

        case 'select':
          await Haptics.selectionAsync();
          break;

        case 'success':
          await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          break;

        case 'error':
          await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
          break;

        case 'warning':
          await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
          break;

        case 'delete':
          // Heavy impact for destructive action
          await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
          // Follow with warning vibration
          setTimeout(() => {
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
          }, 100);
          break;

        case 'longPress':
          await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
          break;

        case 'drag':
          await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          break;

        case 'drop':
          await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
          setTimeout(() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          }, 50);
          break;

        case 'toggle':
          await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
          break;

        case 'slide':
          await Haptics.selectionAsync();
          break;

        case 'pull':
          await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
          break;

        case 'bounce':
          await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          setTimeout(() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          }, 80);
          break;

        case 'confirm':
          await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          break;

        case 'cancel':
          await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
          break;

        case 'menu':
          await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          break;

        case 'navigation':
          await Haptics.selectionAsync();
          break;

        case 'newOrder':
          // Triple heavy pulse to distinguish new orders from everything else
          await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
          await new Promise((r) => setTimeout(r, 120));
          await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
          await new Promise((r) => setTimeout(r, 120));
          await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
          break;

        default:
          await Haptics.selectionAsync();
      }
    } catch (error) {
      // Silently fail if haptics are not available
      console.warn('Haptic feedback failed:', error);
    }
  }

  /**
   * Create a rhythmic haptic pattern (for special effects)
   */
  async playRhythmicPattern(intervals: number[], intensity: Haptics.ImpactFeedbackStyle = Haptics.ImpactFeedbackStyle.Light): Promise<void> {
    if (!this.enabled) return;

    for (let i = 0; i < intervals.length; i++) {
      await Haptics.impactAsync(intensity);
      if (i < intervals.length - 1) {
        await new Promise(resolve => setTimeout(resolve, intervals[i]));
      }
    }
  }

  /**
   * Quick success pattern (double tap)
   */
  async quickSuccess(): Promise<void> {
    if (!this.enabled) return;
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setTimeout(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light), 100);
  }

  /**
   * Heartbeat pattern (for attention)
   */
  async heartbeat(): Promise<void> {
    if (!this.enabled) return;
    await this.playRhythmicPattern([150, 100], Haptics.ImpactFeedbackStyle.Heavy);
  }

  /**
   * Error shake pattern
   */
  async errorShake(): Promise<void> {
    if (!this.enabled) return;
    await this.playRhythmicPattern([50, 50, 50, 50, 50], Haptics.ImpactFeedbackStyle.Medium);
  }
}

// Export singleton instance
export const hapticService = new HapticFeedbackService();

// Export convenience functions
export const haptic = {
  tap: () => hapticService.trigger('tap'),
  select: () => hapticService.trigger('select'),
  success: () => hapticService.trigger('success'),
  error: () => hapticService.trigger('error'),
  warning: () => hapticService.trigger('warning'),
  delete: () => hapticService.trigger('delete'),
  longPress: () => hapticService.trigger('longPress'),
  drag: () => hapticService.trigger('drag'),
  drop: () => hapticService.trigger('drop'),
  toggle: () => hapticService.trigger('toggle'),
  slide: () => hapticService.trigger('slide'),
  pull: () => hapticService.trigger('pull'),
  bounce: () => hapticService.trigger('bounce'),
  confirm: () => hapticService.trigger('confirm'),
  cancel: () => hapticService.trigger('cancel'),
  menu: () => hapticService.trigger('menu'),
  navigation: () => hapticService.trigger('navigation'),
  newOrder: () => hapticService.trigger('newOrder'),
  quickSuccess: () => hapticService.quickSuccess(),
  heartbeat: () => hapticService.heartbeat(),
  errorShake: () => hapticService.errorShake(),
};

export default hapticService;
