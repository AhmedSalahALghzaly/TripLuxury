import type { Request, Response, NextFunction } from "express";
import { logger } from "./logger";

/**
 * R1+R2: Final Express error handler. Express's Sentry integration
 * (setupExpressErrorHandler) runs BEFORE this and forwards the error to
 * Sentry; this handler is responsible for the pino structured log line
 * (with req.id correlation) and the JSON response shape.
 */
export function finalErrorHandler(
  err: unknown,
  req: Request,
  res: Response,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _next: NextFunction,
): void {
  const e = err as { message?: string; stack?: string; status?: number; statusCode?: number };
  const status = Number(e?.status || e?.statusCode) || 500;
  const log = (req as any).log || logger;
  log.error(
    {
      err: { message: e?.message, stack: e?.stack },
      reqId: (req as any).id,
      method: req.method,
      url: req.url?.split("?")[0],
      status,
    },
    "request_failed",
  );
  if (res.headersSent) return;
  res.status(status).json({
    detail: status >= 500 ? "Internal server error" : e?.message || "Request failed",
    requestId: (req as any).id,
  });
}
