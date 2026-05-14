// M4: Sentry must be imported before any other module so its OpenTelemetry
// auto-instrumentation can patch Express / http / pg before they load.
import "./instrument";
import * as Sentry from "@sentry/node";
import app, { registerRoutes } from "./app";
import { logger } from "./lib/logger";
import { finalErrorHandler } from "./lib/error-handler";
import { query } from "./server-db";

/**
 * One-shot backfill: ensure every push_notification_log row that targets a
 * product carries an `image_url` in its JSON payload. Loops in 500-row
 * batches with a small yield between batches so it never blocks the event
 * loop on cold-start with large tables. Bounded by a hard ceiling to guard
 * against runaway loops on data anomalies.
 */
async function backfillNotificationImages(): Promise<void> {
  const BATCH_SIZE = 500;
  const MAX_BATCHES = 200; // safety ceiling: 100k rows max per boot
  let totalUpdated = 0;
  // Cursor-paginate by sent_at so we never re-scan the same rows in this
  // process. Un-fixable rows (no product / NULL image_url) stay un-touched
  // and may be picked up on a future boot once their product gains an image.
  let cursor: string | null = null;
  try {
    for (let i = 0; i < MAX_BATCHES; i++) {
      const sel = await query(
        `SELECT pl.id, pl.sent_at
           FROM push_notification_log pl
          WHERE pl.payload->>'product_id' IS NOT NULL
            AND COALESCE(pl.payload->>'image_url', '') = ''
            AND ($1::timestamptz IS NULL OR pl.sent_at < $1::timestamptz)
          ORDER BY pl.sent_at DESC
          LIMIT $2`,
        [cursor, BATCH_SIZE],
      );
      const candidates = sel.rows as { id: string; sent_at: string }[];
      if (candidates.length === 0) break;

      const ids = candidates.map((r) => r.id);
      const upd = await query(
        `UPDATE push_notification_log pl
            SET payload = pl.payload || jsonb_build_object('image_url', p.image_url)
           FROM products p
          WHERE pl.id = ANY($1::uuid[])
            AND p.id = (pl.payload->>'product_id')::uuid
            AND p.image_url IS NOT NULL
            AND COALESCE(pl.payload->>'image_url', '') = ''`,
        [ids],
      );
      totalUpdated += upd.rowCount ?? 0;

      // Advance the cursor past the oldest row in this batch so the next
      // SELECT doesn't re-pick rows whose product still has no image.
      cursor = candidates[candidates.length - 1]!.sent_at;

      if (candidates.length < BATCH_SIZE) break;
      await new Promise((r) => setTimeout(r, 50));
    }
    if (totalUpdated > 0) {
      logger.info({ updated: totalUpdated }, "Backfilled notification image_url");
    }
  } catch (err) {
    logger.warn({ err }, "backfillNotificationImages failed (non-fatal)");
  }
}

/**
 * Periodic housekeeping: delete push_notification_log rows older than 30 days.
 * Both acknowledged and unacknowledged rows are removed — unacknowledged rows
 * older than 30 days are well past the 7-day mobile fetch window and will
 * never be seen by a user.
 * Runs once on startup (after a short delay) and then every 24 hours.
 */
async function expireOldPushLogs(): Promise<void> {
  let deleted = 0;
  try {
    const result = await query(
      `DELETE FROM push_notification_log
        WHERE sent_at < NOW() - INTERVAL '30 days'`,
    );
    deleted = result.rowCount ?? 0;
    if (deleted > 0) {
      logger.info({ deleted }, "push_notification_log: expired old rows");
    } else {
      logger.debug("push_notification_log: no rows to expire");
    }
  } catch (err) {
    logger.warn({ err }, "expireOldPushLogs: delete failed (non-fatal)");
    return;
  }
  // Persist the run result independently so a stats-insert failure never
  // masks whether the actual pruning succeeded.
  try {
    await query(
      `INSERT INTO housekeeping_stats (table_name, rows_deleted)
       VALUES ($1, $2)`,
      ["push_notification_log", deleted],
    );
  } catch (err) {
    logger.warn({ err }, "expireOldPushLogs: stats insert failed (non-fatal)");
  }
}

/**
 * Periodic housekeeping: delete sessions that have passed their expires_at
 * timestamp. The auth middleware already rejects them, but they stay in the
 * table forever without an explicit purge. Runs once on startup (after a short
 * delay) and then every 24 hours.
 */
async function expireOldSessions(): Promise<void> {
  let deleted = 0;
  try {
    const result = await query(
      `DELETE FROM sessions WHERE expires_at < NOW()`,
    );
    deleted = result.rowCount ?? 0;
    if (deleted > 0) {
      logger.info({ deleted }, "sessions: expired old rows");
    } else {
      logger.debug("sessions: no rows to expire");
    }
  } catch (err) {
    logger.warn({ err }, "expireOldSessions: delete failed (non-fatal)");
    return;
  }
  try {
    await query(
      `INSERT INTO housekeeping_stats (table_name, rows_deleted)
       VALUES ($1, $2)`,
      ["sessions", deleted],
    );
  } catch (err) {
    logger.warn({ err }, "expireOldSessions: stats insert failed (non-fatal)");
  }
}

/**
 * Periodic housekeeping: delete ai_training_logs rows older than 90 days.
 * Training logs are diagnostic records; they have no user-facing value after
 * the knowledge-base item they describe has been processed. Runs once on
 * startup (after a short delay) and then every 24 hours.
 */
async function expireOldAiTrainingLogs(): Promise<void> {
  let deleted = 0;
  try {
    const result = await query(
      `DELETE FROM ai_training_logs
        WHERE created_at < NOW() - INTERVAL '90 days'`,
    );
    deleted = result.rowCount ?? 0;
    if (deleted > 0) {
      logger.info({ deleted }, "ai_training_logs: expired old rows");
    } else {
      logger.debug("ai_training_logs: no rows to expire");
    }
  } catch (err) {
    logger.warn(
      { err },
      "expireOldAiTrainingLogs: delete failed (non-fatal)",
    );
    return;
  }
  try {
    await query(
      `INSERT INTO housekeeping_stats (table_name, rows_deleted)
       VALUES ($1, $2)`,
      ["ai_training_logs", deleted],
    );
  } catch (err) {
    logger.warn(
      { err },
      "expireOldAiTrainingLogs: stats insert failed (non-fatal)",
    );
  }
}

/**
 * Periodic housekeeping: delete email_verification_codes rows where expires_at
 * is in the past. The verification flow already rejects expired codes, but they
 * accumulate in the table indefinitely without an explicit purge. Runs once on
 * startup (after a short delay) and then every 24 hours.
 */
async function expireOldEmailVerificationCodes(): Promise<void> {
  let deleted = 0;
  try {
    const result = await query(
      `DELETE FROM email_verification_codes WHERE expires_at < NOW()`,
    );
    deleted = result.rowCount ?? 0;
    if (deleted > 0) {
      logger.info({ deleted }, "email_verification_codes: expired old rows");
    } else {
      logger.debug("email_verification_codes: no rows to expire");
    }
  } catch (err) {
    logger.warn(
      { err },
      "expireOldEmailVerificationCodes: delete failed (non-fatal)",
    );
    return;
  }
  try {
    await query(
      `INSERT INTO housekeeping_stats (table_name, rows_deleted)
       VALUES ($1, $2)`,
      ["email_verification_codes", deleted],
    );
  } catch (err) {
    logger.warn(
      { err },
      "expireOldEmailVerificationCodes: stats insert failed (non-fatal)",
    );
  }
}

const PUSH_LOG_CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours
const SESSION_CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours
const AI_TRAINING_LOG_CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours
const EMAIL_VERIFICATION_CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours

const rawPort = process.env["PORT"] ?? "8080";
const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

(async () => {
  // ── Integration readiness diagnostics ─────────────────────────────────────
  const hasOpenAI = !!(
    process.env["AI_INTEGRATIONS_OPENAI_API_KEY"] ||
    process.env["OPENAI_API_KEY"]
  );
  const hasObjectStorage = !!(
    process.env["DEFAULT_OBJECT_STORAGE_BUCKET_ID"] ||
    process.env["PRIVATE_OBJECT_DIR"]
  );
  const hasPostHog = !!process.env["EXPO_PUBLIC_POSTHOG_KEY"];
  logger.info(
    { hasOpenAI, hasObjectStorage, hasPostHog },
    "Integration readiness",
  );
  // ──────────────────────────────────────────────────────────────────────────

  const server = await registerRoutes(app);

  // M4: Sentry Express error handler must be added AFTER all routes have been
  // registered so it can capture exceptions thrown inside them.  No-op when
  // SENTRY_DSN is not configured.
  if (process.env["SENTRY_DSN"]) {
    Sentry.setupExpressErrorHandler(app);
  }

  // R1+R2: final structured-log + JSON-shaped error handler.  Runs after
  // Sentry's handler so the log line carries the same request id Sentry has.
  app.use(finalErrorHandler);

  // R1: process-level safety nets — surface async crashes that escape Express.
  process.on("unhandledRejection", (reason) => {
    logger.error({ err: reason }, "unhandled_promise_rejection");
    if (process.env["SENTRY_DSN"]) {
      try {
        Sentry.captureException(reason);
      } catch {}
    }
  });
  process.on("uncaughtException", (err) => {
    logger.fatal({ err }, "uncaught_exception");
    if (process.env["SENTRY_DSN"]) {
      try {
        Sentry.captureException(err);
      } catch {}
    }
  });

  server.listen(port, "0.0.0.0", () => {
    logger.info({ port }, "Server listening");
    // Fire-and-forget backfill — must not block server startup.
    backfillNotificationImages().catch(() => {});
    // Expire push_notification_log rows older than 30 days.
    // First run is deferred 30 s so the DB pool is fully warm.
    setTimeout(() => {
      expireOldPushLogs().catch(() => {});
      setInterval(
        () => expireOldPushLogs().catch(() => {}),
        PUSH_LOG_CLEANUP_INTERVAL_MS,
      ).unref();
    }, 30_000);
    // Expire sessions that have passed their expires_at timestamp.
    // Staggered 60 s after startup to avoid DB contention at boot.
    setTimeout(() => {
      expireOldSessions().catch(() => {});
      setInterval(
        () => expireOldSessions().catch(() => {}),
        SESSION_CLEANUP_INTERVAL_MS,
      ).unref();
    }, 60_000);
    // Expire ai_training_logs older than 90 days.
    // Staggered 90 s after startup to spread the initial burst of queries.
    setTimeout(() => {
      expireOldAiTrainingLogs().catch(() => {});
      setInterval(
        () => expireOldAiTrainingLogs().catch(() => {}),
        AI_TRAINING_LOG_CLEANUP_INTERVAL_MS,
      ).unref();
    }, 90_000);
    // Expire email_verification_codes where expires_at < NOW().
    // Staggered 120 s after startup to continue spreading the boot burst.
    setTimeout(() => {
      expireOldEmailVerificationCodes().catch(() => {});
      setInterval(
        () => expireOldEmailVerificationCodes().catch(() => {}),
        EMAIL_VERIFICATION_CLEANUP_INTERVAL_MS,
      ).unref();
    }, 120_000);
  });
})();
