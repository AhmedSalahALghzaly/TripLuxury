/**
 * M4: Performance + crash monitoring — Sentry wrapper.
 *
 * Init is gated on `EXPO_PUBLIC_SENTRY_DSN` so the app boots normally
 * without a DSN configured (single console.info, no errors).
 *
 * `initSentry()` is intentionally idempotent: invoking it more than once
 * will only initialise the SDK on the first call.
 */
import * as Sentry from '@sentry/react-native';

const DSN = process.env.EXPO_PUBLIC_SENTRY_DSN;
let _initialised = false;

export const MONITORING_ENABLED = !!DSN;

export function initSentry(): void {
  if (_initialised) return;
  if (!DSN) {
    // eslint-disable-next-line no-console
    console.info('[monitoring] EXPO_PUBLIC_SENTRY_DSN not set — Sentry disabled');
    _initialised = true;
    return;
  }
  try {
    Sentry.init({
      dsn: DSN,
      environment: process.env.EXPO_PUBLIC_ENV || 'development',
      // Trace 20% of transactions; tune later based on traffic.
      tracesSampleRate: Number(process.env.EXPO_PUBLIC_SENTRY_TRACES_SAMPLE_RATE || 0.2),
      enableAutoSessionTracking: true,
    });
    _initialised = true;
  } catch (err) {
    // Monitoring must never break the app boot.
    // eslint-disable-next-line no-console
    console.warn('[monitoring] Sentry init failed', err);
  }
}

/** Capture a handled exception. Safe no-op when Sentry isn't initialised. */
export function captureException(err: unknown, context?: Record<string, any>): void {
  try {
    if (!MONITORING_ENABLED) return;
    if (context) {
      Sentry.withScope((scope) => {
        Object.entries(context).forEach(([k, v]) => scope.setExtra(k, v));
        Sentry.captureException(err);
      });
    } else {
      Sentry.captureException(err);
    }
  } catch {
    /* no-op */
  }
}
