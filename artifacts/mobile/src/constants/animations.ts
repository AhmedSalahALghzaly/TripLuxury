/**
 * Animation Constants for Al-Ghazaly Auto Parts
 * Unified animation library for consistent, premium UX
 * 
 * Design Philosophy:
 * - Fast feedback: 150-200ms for micro-interactions
 * - Smooth transitions: 300-400ms for screen changes
 * - Spring physics: Natural, organic feel
 * - Staggered entries: Creates visual hierarchy
 */

import { Easing } from 'react-native-reanimated';

// ============================================
// DURATION CONSTANTS (milliseconds)
// ============================================
export const DURATIONS = {
  // Micro-interactions (instant feedback)
  instant: 100,
  fast: 150,
  normal: 250,
  
  // Transitions
  transition: 300,
  smooth: 400,
  slow: 500,
  
  // Complex animations
  elaborate: 600,
  dramatic: 800,
  
  // Skeleton shimmer
  shimmer: 1500,
  shimmerFast: 1000,
  
  // Stagger delays
  staggerBase: 50,
  staggerSlow: 100,
} as const;

// ============================================
// SPRING CONFIGURATIONS
// ============================================
export const SPRINGS = {
  // Snappy - for buttons, toggles, quick feedback
  snappy: {
    damping: 15,
    stiffness: 400,
    mass: 0.8,
  },
  
  // Bouncy - for playful elements, success states
  bouncy: {
    damping: 10,
    stiffness: 200,
    mass: 0.6,
  },
  
  // Gentle - for modals, sheets, overlays
  gentle: {
    damping: 20,
    stiffness: 150,
    mass: 1,
  },
  
  // Smooth - for page transitions, large elements
  smooth: {
    damping: 25,
    stiffness: 120,
    mass: 1.2,
  },
  
  // Wobbly - for attention-grabbing elements
  wobbly: {
    damping: 8,
    stiffness: 180,
    mass: 0.5,
  },
  
  // Stiff - for precise, controlled movements
  stiff: {
    damping: 30,
    stiffness: 300,
    mass: 1,
  },
  
  // Card - optimized for card animations
  card: {
    damping: 18,
    stiffness: 250,
    mass: 0.9,
  },
  
  // Bottom Sheet specific
  sheet: {
    damping: 50,
    stiffness: 500,
    mass: 0.8,
  },
} as const;

// ============================================
// EASING CURVES
// ============================================
export const EASINGS = {
  // Standard curves
  linear: Easing.linear,
  ease: Easing.ease,
  easeIn: Easing.in(Easing.ease),
  easeOut: Easing.out(Easing.ease),
  easeInOut: Easing.inOut(Easing.ease),
  
  // Cubic curves (Material Design inspired)
  standard: Easing.bezier(0.4, 0.0, 0.2, 1),
  decelerate: Easing.bezier(0.0, 0.0, 0.2, 1),
  accelerate: Easing.bezier(0.4, 0.0, 1, 1),
  
  // Expressive curves
  expressive: Easing.bezier(0.4, 0.0, 0.0, 1),
  expressiveDecel: Easing.bezier(0.0, 0.0, 0.0, 1),
  
  // Bounce effect
  bounce: Easing.bounce,
  
  // Elastic effect
  elastic: Easing.elastic(1),
  elasticSoft: Easing.elastic(0.5),
  
  // Back effect (overshoot)
  back: Easing.back(1.5),
  backSoft: Easing.back(1),
} as const;

// ============================================
// ANIMATION PRESETS
// ============================================
export const PRESETS = {
  // Fade animations
  fadeIn: {
    duration: DURATIONS.normal,
    easing: EASINGS.easeOut,
  },
  fadeOut: {
    duration: DURATIONS.fast,
    easing: EASINGS.easeIn,
  },
  
  // Scale animations
  scaleIn: {
    duration: DURATIONS.normal,
    easing: EASINGS.decelerate,
  },
  scaleOut: {
    duration: DURATIONS.fast,
    easing: EASINGS.accelerate,
  },
  scalePulse: {
    duration: DURATIONS.transition,
    easing: EASINGS.easeInOut,
  },
  
  // Slide animations
  slideUp: {
    duration: DURATIONS.transition,
    easing: EASINGS.decelerate,
  },
  slideDown: {
    duration: DURATIONS.normal,
    easing: EASINGS.accelerate,
  },
  slideLeft: {
    duration: DURATIONS.transition,
    easing: EASINGS.standard,
  },
  slideRight: {
    duration: DURATIONS.transition,
    easing: EASINGS.standard,
  },
  
  // Micro-interactions
  buttonPress: {
    duration: DURATIONS.instant,
    easing: EASINGS.easeOut,
  },
  buttonRelease: {
    duration: DURATIONS.fast,
    easing: EASINGS.decelerate,
  },
  
  // Skeleton shimmer
  shimmer: {
    duration: DURATIONS.shimmer,
    easing: EASINGS.linear,
  },
} as const;

// ============================================
// SCALE VALUES
// ============================================
export const SCALES = {
  // Press states
  pressed: 0.96,
  pressedLight: 0.98,
  pressedStrong: 0.92,
  
  // Hover/Focus states
  hover: 1.02,
  focus: 1.05,
  
  // Emphasis
  emphasis: 1.1,
  emphasisLarge: 1.2,
  
  // Minimized
  minimized: 0.8,
  hidden: 0,
} as const;

// ============================================
// OPACITY VALUES
// ============================================
export const OPACITIES = {
  visible: 1,
  semiVisible: 0.8,
  muted: 0.6,
  subtle: 0.4,
  faint: 0.2,
  invisible: 0,
  
  // Overlay states
  overlayLight: 0.3,
  overlayMedium: 0.5,
  overlayDark: 0.7,
  overlayBlack: 0.85,
  
  // Disabled states
  disabled: 0.5,
  disabledStrong: 0.3,
} as const;

// ============================================
// TRANSFORM VALUES
// ============================================
export const TRANSFORMS = {
  // Rotation (degrees)
  rotate: {
    slight: 2,
    tilt: 5,
    quarter: 90,
    half: 180,
    full: 360,
  },
  
  // Translation (pixels)
  translate: {
    micro: 2,
    small: 4,
    medium: 8,
    large: 16,
    xlarge: 32,
    screen: 100, // percentage for off-screen
  },
  
  // Shake effect values
  shake: {
    distance: 10,
    iterations: 4,
  },
} as const;

// ============================================
// STAGGER HELPERS
// ============================================
export const getStaggerDelay = (index: number, baseDelay: number = DURATIONS.staggerBase): number => {
  return index * baseDelay;
};

export const getStaggerDelayWithMax = (
  index: number, 
  baseDelay: number = DURATIONS.staggerBase,
  maxDelay: number = 500
): number => {
  return Math.min(index * baseDelay, maxDelay);
};

// ============================================
// COLOR MOOD ANIMATION HELPERS
// ============================================
export const getMoodTransitionConfig = (moodId: string) => {
  const configs: Record<string, { duration: number; intensity: number }> = {
    arctic_dawn: { duration: 400, intensity: 0.8 },
    desert_sunset: { duration: 500, intensity: 1.0 },
    forest_calm: { duration: 600, intensity: 0.7 },
    neon_night: { duration: 350, intensity: 1.2 },
    ocean_breeze: { duration: 450, intensity: 0.9 },
  };
  return configs[moodId] || { duration: 400, intensity: 1.0 };
};

// ============================================
// HAPTIC PATTERNS
// ============================================
export const HAPTIC_PATTERNS = {
  selection: 'selection' as const,
  light: 'light' as const,
  medium: 'medium' as const,
  heavy: 'heavy' as const,
  success: 'success' as const,
  warning: 'warning' as const,
  error: 'error' as const,
} as const;

// ============================================
// GESTURE THRESHOLDS
// ============================================
export const GESTURES = {
  // Swipe thresholds
  swipeVelocity: 500,
  swipeDistance: 50,
  
  // Long press
  longPressDelay: 500,
  
  // Drag thresholds
  dragThreshold: 10,
  dragActiveScale: 1.05,
  
  // Bottom sheet snap points
  sheetSnapPoints: {
    collapsed: '10%',
    quarter: '25%',
    half: '50%',
    threeQuarter: '75%',
    full: '90%',
  },
} as const;

// ============================================
// LAYOUT ANIMATION DEFAULTS
// ============================================
export const LAYOUT_ANIMATION = {
  entering: {
    duration: DURATIONS.transition,
    delay: 0,
  },
  exiting: {
    duration: DURATIONS.normal,
    delay: 0,
  },
  layout: {
    duration: DURATIONS.smooth,
  },
} as const;

// ============================================
// LUXURY MOTION — 2026 Editorial presets
// ============================================
//
// Higher-level presets built on the base DURATIONS/EASINGS/SPRINGS
// constants above. They encode the cinematic motion language used by
// the new luxury dining surfaces (hero parallax, glass rise, concierge
// aura, gold shimmer). Component-level animations should compose these
// rather than redefine the same magic numbers.
export const LUXURY_MOTION = {
  // Hero/header parallax — slow, decelerating; used on home hero scroll
  heroParallax: {
    duration: DURATIONS.smooth,
    easing: EASINGS.expressiveDecel,
  },
  // Glass-rise — bottom-sheets, modals, AI concierge surfaces
  glassRise: {
    damping: 22,
    stiffness: 180,
    mass: 0.95,
  },
  // Concierge aura — slow pulse around the AI agent floating button
  conciergeAura: {
    duration: 2400,
    easing: EASINGS.easeInOut,
  },
  // Gold shimmer — premium loading + section dividers
  goldShimmer: {
    duration: 2200,
    easing: EASINGS.linear,
  },
  // Plate bloom — splash/loader signature motion (replaces drift)
  plateBloom: {
    duration: 1600,
    easing: EASINGS.expressive,
  },
  // Dish reveal — product/dish detail entry
  dishReveal: {
    duration: DURATIONS.smooth,
    easing: EASINGS.expressiveDecel,
  },
  // Velvet tap — soft press feedback for high-end touch surfaces
  velvetTap: {
    damping: 24,
    stiffness: 320,
    mass: 0.7,
  },
  // Curtain reveal — used by product detail hero / login background
  curtainReveal: {
    duration: DURATIONS.elaborate,
    easing: EASINGS.expressive,
  },
} as const;

export default {
  DURATIONS,
  SPRINGS,
  EASINGS,
  PRESETS,
  SCALES,
  OPACITIES,
  TRANSFORMS,
  HAPTIC_PATTERNS,
  GESTURES,
  LAYOUT_ANIMATION,
  LUXURY_MOTION,
  getStaggerDelay,
  getStaggerDelayWithMax,
  getMoodTransitionConfig,
};
