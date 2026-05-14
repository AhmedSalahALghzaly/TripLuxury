/**
 * Cross-platform shadow utility for React Native / Expo
 * Supports both iOS native shadows and web boxShadow
 * 
 * Usage:
 * const styles = StyleSheet.create({
 *   card: {
 *     ...createShadow('#000', 0, 2, 0.1, 8, 3),
 *   }
 * });
 */

import { Platform, ViewStyle } from 'react-native';

type ShadowStyle = ViewStyle;

/**
 * Creates a cross-platform shadow style
 * @param color - Shadow color (hex or rgba)
 * @param offsetX - Horizontal offset
 * @param offsetY - Vertical offset  
 * @param opacity - Shadow opacity (0-1)
 * @param radius - Blur radius
 * @param elevation - Android elevation (optional, defaults to radius/2)
 */
export const createShadow = (
  color: string,
  offsetX: number,
  offsetY: number,
  opacity: number,
  radius: number,
  elevation?: number
): ShadowStyle => {
  if (Platform.OS === 'web') {
    // Convert to rgba if hex color
    const rgbaColor = hexToRgba(color, opacity);
    return {
      boxShadow: `${offsetX}px ${offsetY}px ${radius}px ${rgbaColor}`,
    } as ShadowStyle;
  }

  // iOS and Android native shadows
  return {
    shadowColor: color,
    shadowOffset: { width: offsetX, height: offsetY },
    shadowOpacity: opacity,
    shadowRadius: radius,
    elevation: elevation ?? Math.round(radius / 2),
  };
};

/**
 * Creates a text shadow style (cross-platform)
 */
export const createTextShadow = (
  color: string,
  offsetX: number,
  offsetY: number,
  radius: number
): Record<string, any> => {
  if (Platform.OS === 'web') {
    return {
      textShadow: `${offsetX}px ${offsetY}px ${radius}px ${color}`,
    };
  }

  return {
    textShadowColor: color,
    textShadowOffset: { width: offsetX, height: offsetY },
    textShadowRadius: radius,
  };
};

/**
 * Converts hex color to rgba
 */
const hexToRgba = (hex: string, alpha: number): string => {
  // Handle rgba colors
  if (hex.startsWith('rgba')) {
    return hex;
  }
  
  // Handle rgb colors
  if (hex.startsWith('rgb(')) {
    const match = hex.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
    if (match) {
      return `rgba(${match[1]}, ${match[2]}, ${match[3]}, ${alpha})`;
    }
  }

  // Handle hex colors
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (result) {
    const r = parseInt(result[1], 16);
    const g = parseInt(result[2], 16);
    const b = parseInt(result[3], 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  // Fallback
  return `rgba(0, 0, 0, ${alpha})`;
};

/**
 * Pre-defined shadow presets for common use cases
 */
export const shadowPresets = {
  // Card shadows
  card: createShadow('#000', 0, 2, 0.1, 8, 3),
  cardHover: createShadow('#000', 0, 4, 0.15, 12, 5),
  cardPressed: createShadow('#000', 0, 1, 0.08, 4, 2),
  
  // Header/Navigation
  header: createShadow('#000', 0, 4, 0.2, 12, 4),
  
  // Button shadows
  button: createShadow('#000', 0, 2, 0.15, 4, 2),
  buttonGlow: (color: string) => createShadow(color, 0, 0, 0.6, 12, 6),
  
  // Modal/Dialog
  modal: createShadow('#000', 0, 8, 0.3, 16, 8),
  
  // Floating elements
  floating: createShadow('#000', 0, 4, 0.15, 8, 4),
  
  // Golden glow effect
  goldenGlow: createShadow('#FFD700', 0, 0, 0.8, 15, 6),
  
  // Primary color glow
  primaryGlow: createShadow('#009688', 0, 0, 0.6, 12, 6),
};

export default { createShadow, createTextShadow, shadowPresets };
