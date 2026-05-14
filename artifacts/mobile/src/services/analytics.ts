/**
 * G1: Product analytics — PostHog wrapper.
 *
 * Provider:    <AnalyticsProvider> wraps the app in <PostHogProvider> when a
 *              key is present, and is a transparent fragment otherwise.
 * Capture API: `analytics.capture(event, props?)` — best-effort no-op when
 *              the SDK isn't initialised so callers never need to guard.
 *
 * Configure by setting `EXPO_PUBLIC_POSTHOG_KEY` (and optionally
 * `EXPO_PUBLIC_POSTHOG_HOST`, default `https://us.i.posthog.com`).
 */
import React from 'react';
import { PostHogProvider, usePostHog } from 'posthog-react-native';

const POSTHOG_KEY  = process.env.EXPO_PUBLIC_POSTHOG_KEY;
const POSTHOG_HOST = process.env.EXPO_PUBLIC_POSTHOG_HOST || 'https://us.i.posthog.com';

export const ANALYTICS_ENABLED = !!POSTHOG_KEY;

let _client: any = null;
type Props = Record<string, any>;

function setClient(client: any): void {
  _client = client;
}

/**
 * Provider that initialises PostHog when a key is configured.  When no key
 * is present we render children directly so the rest of the app behaves
 * identically (and `analytics.capture` becomes a no-op).
 */
export function AnalyticsProvider({ children }: { children: React.ReactNode }): React.ReactElement {
  if (!POSTHOG_KEY) {
    return React.createElement(React.Fragment, null, children);
  }
  return React.createElement(
    PostHogProvider,
    {
      apiKey: POSTHOG_KEY,
      options: {
        host: POSTHOG_HOST,
        // Capture every screen change (Expo Router) automatically.
        captureAppLifecycleEvents: true,
      },
      children: [
        React.createElement(_ClientBridge, { key: 'analytics-bridge' }),
        children,
      ],
    },
  );
}

/**
 * Tiny child component that pulls the live PostHog instance out of the
 * provider context and stashes it for the imperative `analytics.capture`
 * helper to use from non-React code (services, listeners, etc.).
 */
function _ClientBridge(): null {
  const ph = usePostHog();
  React.useEffect(() => {
    if (ph) setClient(ph);
  }, [ph]);
  return null;
}

export const analytics = {
  capture(event: string, props?: Props): void {
    try {
      _client?.capture?.(event, props);
    } catch {
      // Analytics must never throw into product code.
    }
  },
  identify(userId: string, props?: Props): void {
    try {
      _client?.identify?.(userId, props);
    } catch {
      /* no-op */
    }
  },
  reset(): void {
    try {
      _client?.reset?.();
    } catch {
      /* no-op */
    }
  },
};

/**
 * Standardised event names used across the app for the funnel:
 *   product_viewed  →  add_to_cart  →  checkout_started  →  order_placed
 */
export const AnalyticsEvents = {
  ProductViewed:    'product_viewed',
  SearchPerformed:  'search_performed',
  AddToCart:        'add_to_cart',
  CheckoutStarted:  'checkout_started',
  OrderPlaced:      'order_placed',
} as const;
