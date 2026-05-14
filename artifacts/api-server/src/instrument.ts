/**
 * M4: Sentry performance + error monitoring for the API server.
 *
 * This file is imported BEFORE any other module in `index.ts` so that
 * `@sentry/node`'s OpenTelemetry-based auto-instrumentation can patch
 * Express, http, pg, etc. before they are required.
 *
 * Init is gated on the SENTRY_DSN env var so the server boots normally
 * (with a single info log) when no DSN is configured.
 */
import * as Sentry from "@sentry/node";
import { logger } from "./lib/logger";

const dsn = process.env["SENTRY_DSN"];

if (dsn) {
  // Wrap init so a misconfigured DSN / SDK runtime issue can never block
  // process startup — degrades gracefully to a "monitoring disabled" log.
  try {
    // R1: release tag — prefer an explicit env var (set by deploy pipeline),
    // fall back to the package version so local builds are still identifiable.
    const release =
      process.env["SENTRY_RELEASE"] ||
      process.env["REPLIT_DEPLOYMENT_ID"] ||
      process.env["npm_package_version"] ||
      "dev";
    Sentry.init({
      dsn,
      environment: process.env["NODE_ENV"] || "development",
      release,
      // Performance: 20% sample of incoming requests.  Adjust per traffic.
      tracesSampleRate: Number(process.env["SENTRY_TRACES_SAMPLE_RATE"] || 0.2),
      // Capture http breadcrumbs but redact common secret headers.
      sendDefaultPii: false,
    });
    logger.info({ env: process.env["NODE_ENV"] }, "Sentry initialised");
  } catch (err) {
    logger.warn(
      { err: (err as Error)?.message },
      "Sentry init failed — continuing without monitoring",
    );
  }
} else {
  logger.info("SENTRY_DSN not set — Sentry monitoring disabled");
}
