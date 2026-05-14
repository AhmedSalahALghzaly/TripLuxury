import express, { type Express } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import pinoHttp from "pino-http";
import { randomUUID } from "node:crypto";
import { logger } from "./lib/logger";
import { sentryContextMiddleware } from "./lib/sentry-context";
import { registerRoutes } from "./server-routes";

const app: Express = express();

// Replit's edge proxy terminates TLS and forwards via X-Forwarded-* headers.
// Trust exactly one hop so:
//   • req.ip resolves to the *real* client IP (used by express-rate-limit
//     to bucket per-user; without this, every request shares the proxy IP
//     and the limiter throttles all users together).
//   • req.protocol correctly returns 'https' for cookie/secure flags.
// "1" = trust the first proxy in the X-Forwarded-For chain.  We do NOT use
// `true` because that would trust client-spoofed headers.
app.set("trust proxy", 1);

app.use(
  pinoHttp({
    logger,
    // R2: stable request id propagated to every log line and to Sentry scope.
    genReqId: (req, res) => {
      const headerId = req.headers["x-request-id"];
      const id =
        (Array.isArray(headerId) ? headerId[0] : headerId) || randomUUID();
      res.setHeader("x-request-id", String(id));
      return String(id);
    },
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);

// R1: tag the active Sentry scope with the request id (and user, when set
// later by requireAuth).  Mounted BEFORE routes so all captures inherit.
app.use(sentryContextMiddleware);

// CORS - allow Replit domains (including expo subdomain)
app.use((req, res, next) => {
  const origin = req.header("origin");

  const isAllowed =
    !origin ||
    origin.startsWith("http://localhost:") ||
    origin.startsWith("http://127.0.0.1:") ||
    origin.includes(".replit.dev") ||
    origin.includes(".kirk.replit.dev") ||
    origin.includes(".repl.co");

  if (isAllowed && origin) {
    res.header("Access-Control-Allow-Origin", origin);
    res.header(
      "Access-Control-Allow-Methods",
      "GET, POST, PUT, DELETE, PATCH, OPTIONS",
    );
    res.header(
      "Access-Control-Allow-Headers",
      "Content-Type, Authorization, X-Requested-With",
    );
    res.header("Access-Control-Allow-Credentials", "true");
  }

  if (req.method === "OPTIONS") {
    res.sendStatus(200);
    return;
  }

  next();
});

app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: false, limit: "50mb" }));
app.use(cookieParser());

export { registerRoutes };
export default app;
