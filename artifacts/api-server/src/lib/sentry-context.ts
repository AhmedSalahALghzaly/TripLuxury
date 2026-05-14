import type { Request, Response, NextFunction } from "express";
import * as Sentry from "@sentry/node";

/**
 * R1: Tag the per-request Sentry isolation scope with `request_id`. We use
 * `getIsolationScope()` (not `getCurrentScope()`) so concurrent requests do
 * not bleed user/tag context across each other — @sentry/node creates a
 * fresh isolation scope per request when the Express integration is loaded.
 *
 * Authenticated user context is attached separately, *after* `requireAuth`
 * has populated `req.user`. See `bindSentryUser()` below — it is called
 * directly from `requireAuth` / `requireAdminRole`, because at the time
 * this middleware fires (before route matching) `req.user` is not yet set.
 *
 * Safe to mount unconditionally: when `SENTRY_DSN` is unset, every Sentry
 * call is a documented no-op.
 */
export function sentryContextMiddleware(
  req: Request,
  _res: Response,
  next: NextFunction,
): void {
  try {
    const reqId = (req as any).id;
    if (reqId) {
      Sentry.getIsolationScope().setTag("request_id", String(reqId));
    }
  } catch {
    // Never let context tagging break the request.
  }
  next();
}

/**
 * Called from auth middleware *after* `req.user` has been resolved. Writes
 * to the per-request isolation scope so cross-request leakage is impossible.
 */
export function bindSentryUser(user: {
  id?: unknown;
  email?: unknown;
  role?: unknown;
}): void {
  try {
    const scope = Sentry.getIsolationScope();
    scope.setUser({
      id: user.id != null ? String(user.id) : undefined,
      email: user.email != null ? String(user.email) : undefined,
    });
    if (user.role != null) {
      scope.setTag("user_role", String(user.role));
    }
  } catch {
    // No-op safety: monitoring must never break the request path.
  }
}
