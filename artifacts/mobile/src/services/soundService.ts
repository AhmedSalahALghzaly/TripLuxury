import { Audio } from 'expo-av';

// Bundled local asset — no network required.
// Generated 880 Hz sine wave with fast attack + exponential decay (300 ms).
const CHIME_ASSET = require('../../assets/sounds/chime.wav') as number;

let _newOrderSound: Audio.Sound | null = null;

/**
 * Play a soft chime when a new order arrives.
 * Uses expo-av Audio with a fully bundled local WAV — works offline.
 * Errors are silently swallowed so the app never crashes on audio failures.
 */
export async function playNewOrderChime(): Promise<void> {
  try {
    await Audio.setAudioModeAsync({
      playsInSilentModeIOS: false,
      allowsRecordingIOS: false,
    });
    if (!_newOrderSound) {
      const { sound } = await Audio.Sound.createAsync(
        CHIME_ASSET,
        { shouldPlay: false, volume: 0.7 },
      );
      _newOrderSound = sound;
    }
    await _newOrderSound.setPositionAsync(0);
    await _newOrderSound.playAsync();
  } catch {
    // Silently ignore — never block the UI on audio failures
  }
}

/**
 * Release the cached sound object. Call on screen unmount to avoid leaks.
 */
export async function releaseNewOrderChime(): Promise<void> {
  try {
    if (_newOrderSound) {
      await _newOrderSound.unloadAsync();
      _newOrderSound = null;
    }
  } catch {
    // ignore
  }
}
