import * as Sentry from "@sentry/node";
import { logger } from "./logger";

type Level = "info" | "warn" | "error";

function safeStringify(v: unknown): string {
  if (typeof v === "string") return v;
  if (v === null || v === undefined) return String(v);
  if (v instanceof Error) return v.message;
  try {
    return JSON.stringify(v);
  } catch {
    return "[unserializable]";
  }
}

function shim(level: Level) {
  return (...args: unknown[]): void => {
    const msg = args.map(safeStringify).join(" ");
    const err = args.find((a) => a instanceof Error) as Error | undefined;
    const fields: Record<string, unknown> = {};
    if (err) fields["err"] = { message: err.message, stack: err.stack, name: err.name };
    if (Object.keys(fields).length > 0) {
      logger[level](fields, msg);
    } else {
      logger[level](msg);
    }
    if (level === "error" && err && process.env["SENTRY_DSN"]) {
      try {
        Sentry.captureException(err, { extra: { logMessage: msg } });
      } catch {
        // Never let Sentry failures crash the request path.
      }
    }
  };
}

export const clog = {
  log: shim("info"),
  info: shim("info"),
  warn: shim("warn"),
  error: shim("error"),
};
