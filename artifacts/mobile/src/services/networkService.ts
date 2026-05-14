/**
 * Network Service
 * Monitors network connectivity and triggers sync operations
 */
import NetInfo, { NetInfoState, NetInfoSubscription } from '@react-native-community/netinfo';
import { syncService } from './syncService';
import { useAppStore } from '../store/appStore';
import { useDataCacheStore } from '../store/useDataCacheStore';

type NetworkCallback = (isConnected: boolean) => void;

class NetworkService {
  private subscription: NetInfoSubscription | null = null;
  private isConnected: boolean = true;
  private wasOffline: boolean = false;
  private callbacks: Set<NetworkCallback> = new Set();

  /**
   * Initialize network monitoring
   */
  async initialize(): Promise<void> {
    try {
      // Get initial state
      const state = await NetInfo.fetch();
      this.updateConnectionState(state);

      // Subscribe to network changes
      this.subscription = NetInfo.addEventListener((state) => {
        this.updateConnectionState(state);
      });

      console.log('[NetworkService] Initialized, connected:', this.isConnected);
    } catch (error) {
      console.error('[NetworkService] Initialization failed:', error);
    }
  }

  /**
   * Update connection state and trigger appropriate actions
   */
  private updateConnectionState(state: NetInfoState): void {
    const newConnected = state.isConnected ?? false;
    const wasConnected = this.isConnected;

    this.isConnected = newConnected;

    // Update stores
    useAppStore.getState().setOnline(newConnected);
    useDataCacheStore.getState().setOnline(newConnected);

    // Notify callbacks
    this.callbacks.forEach((callback) => callback(newConnected));

    // Handle connection changes
    if (!wasConnected && newConnected) {
      // Just came online
      console.log('[NetworkService] Connection restored!');
      this.handleConnectionRestored();
    } else if (wasConnected && !newConnected) {
      // Just went offline
      console.log('[NetworkService] Connection lost!');
      this.handleConnectionLost();
    }
  }

  /**
   * Handle when connection is restored
   */
  private async handleConnectionRestored(): Promise<void> {
    this.wasOffline = false;

    // Trigger sync service to process offline queue and sync data
    syncService.handleNetworkChange(true);

    // Add notification
    useAppStore.getState().addNotification({
      id: `network-restored-${Date.now()}`,
      user_id: 'system',
      title: 'Connection Restored',
      message: 'Your internet connection has been restored. Syncing data...',
      type: 'success',
      read: false,
      created_at: new Date().toISOString(),
    });
  }

  /**
   * Handle when connection is lost
   */
  private handleConnectionLost(): void {
    this.wasOffline = true;

    // Notify sync service
    syncService.handleNetworkChange(false);

    // Add notification
    useAppStore.getState().addNotification({
      id: `network-lost-${Date.now()}`,
      user_id: 'system',
      title: 'Connection Lost',
      message: 'You are now offline. Your changes will be synced when connection is restored.',
      type: 'warning',
      read: false,
      created_at: new Date().toISOString(),
    });
  }

  /**
   * Check if currently connected
   */
  getIsConnected(): boolean {
    return this.isConnected;
  }

  /**
   * Check connection status immediately
   */
  async checkConnection(): Promise<boolean> {
    const state = await NetInfo.fetch();
    return state.isConnected ?? false;
  }

  /**
   * Get detailed network info
   */
  async getNetworkInfo(): Promise<{
    isConnected: boolean;
    type: string;
    isWifi: boolean;
    isCellular: boolean;
  }> {
    const state = await NetInfo.fetch();
    return {
      isConnected: state.isConnected ?? false,
      type: state.type,
      isWifi: state.type === 'wifi',
      isCellular: state.type === 'cellular',
    };
  }

  /**
   * Add callback for network changes
   */
  addListener(callback: NetworkCallback): () => void {
    this.callbacks.add(callback);
    return () => this.callbacks.delete(callback);
  }

  /**
   * Cleanup
   */
  cleanup(): void {
    if (this.subscription) {
      this.subscription();
      this.subscription = null;
    }
    this.callbacks.clear();
    console.log('[NetworkService] Cleaned up');
  }
}

export const networkService = new NetworkService();
export default networkService;
