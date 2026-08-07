import express, { type Express, type Request, type Response, type NextFunction } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import { clerkMiddleware } from "@clerk/express";
import {
  CLERK_PROXY_PATH,
  clerkProxyMiddleware,
} from "./middlewares/clerkProxyMiddleware";
import router from "./routes";
import { logger } from "./lib/logger";
import { db } from "@workspace/db";
import { opsErrorLogs } from "@workspace/db";
import { logSecurityEvent } from "./routes/ops-security";

// ── In-memory rate limiter (no external dep) ──────────────────────────────────
interface RateBucket { count: number; resetAt: number }
const _buckets = new Map<string, RateBucket>();

function makeRateLimiter(maxRequests: number, windowMs: number, message = "Too many requests, please try again later.") {
  return (req: Request, res: Response, next: NextFunction) => {
    const key = `${req.ip}`;
    const now  = Date.now();
    let bucket = _buckets.get(key);
    if (!bucket || now > bucket.resetAt) {
      bucket = { count: 0, resetAt: now + windowMs };
      _buckets.set(key, bucket);
    }
    bucket.count += 1;
    res.setHeader("X-RateLimit-Limit",     String(maxRequests));
    res.setHeader("X-RateLimit-Remaining", String(Math.max(0, maxRequests - bucket.count)));
    if (bucket.count > maxRequests) {
      logSecurityEvent({ type: "rate_limit", ip: req.ip, detail: { route: req.path, count: bucket.count } }).catch(() => {});
      res.status(429).json({ error: message });
      return;
    }
    next();
  };
}

// General API: 300 req / 1 min per IP
const generalLimiter = makeRateLimiter(300, 60_000);
// Write operations: 60 req / 1 min per IP
const writeLimiter   = makeRateLimiter(60,  60_000, "Too many write requests, slow down.");

// Purge stale buckets every 5 minutes to prevent memory leak
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of _buckets) if (now > v.resetAt) _buckets.delete(k);
}, 5 * 60_000).unref();

const app: Express = express();

// Trust the first proxy in the chain (Nginx, Cloudflare, etc.)
// This makes req.ip return the real client IP from X-Forwarded-For,
// while ignoring any X-Forwarded-For headers the client itself sends.
app.set("trust proxy", 1);

app.use(
  pinoHttp({
    logger,
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

// Clerk proxy must be before body parsers (streams raw bytes)
app.use(CLERK_PROXY_PATH, clerkProxyMiddleware());

// Only these origins may make credentialed cross-origin requests.
// Configure via ALLOWED_ORIGINS (comma-separated) in production — e.g.
// "https://xauusd-terminal-journal.onrender.com,https://xauusd-terminal-admin.onrender.com"
// In non-production (local dev), any origin is allowed for convenience.
const allowedOrigins = (process.env.ALLOWED_ORIGINS ?? "")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

app.use(
  cors({
    credentials: true,
    origin(origin, callback) {
      // Same-origin / non-browser requests (curl, server-to-server) send no Origin header.
      if (!origin) return callback(null, true);
      if (process.env.NODE_ENV !== "production") return callback(null, true);
      if (allowedOrigins.includes(origin)) return callback(null, true);
      logSecurityEvent({ type: "cors_violation", ip: undefined, detail: { origin } }).catch(() => {});
      callback(new Error(`Origin ${origin} not allowed by CORS`));
    },
  }),
);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(
  clerkMiddleware({
    publishableKey: process.env.CLERK_PUBLISHABLE_KEY,
    secretKey: process.env.CLERK_SECRET_KEY,
  }),
);

// Apply rate limiters before routes
app.use("/api", generalLimiter);
app.use("/api", (req: Request, res: Response, next: NextFunction) => {
  if (["POST", "PATCH", "PUT", "DELETE"].includes(req.method)) {
    writeLimiter(req, res, next);
  } else {
    next();
  }
});

app.use("/api", router);

// Global JSON error handler — must be last, after all routes
// Prevents Express from returning raw HTML on unhandled errors
app.use((err: unknown, req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const status = (err as { status?: number; statusCode?: number })?.status
    ?? (err as { status?: number; statusCode?: number })?.statusCode
    ?? 500;
  req.log?.error({ err }, "Unhandled error");

  // Ops agent error capture — fire-and-forget, never blocks the response.
  // Repeated-pattern detection: bump `occurrences` if the same route+message
  // was already logged in the last hour instead of inserting a duplicate row.
  (async () => {
    try {
      const errMessage = (err as { message?: string })?.message ?? String(err);
      const stack = (err as { stack?: string })?.stack ?? null;
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
      const { eq, and, gte, sql } = await import("drizzle-orm");
      const [existing] = await db
        .select()
        .from(opsErrorLogs)
        .where(and(
          eq(opsErrorLogs.route, req.path),
          eq(opsErrorLogs.message, errMessage),
          gte(opsErrorLogs.lastSeenAt, oneHourAgo),
        ))
        .limit(1);

      if (existing) {
        await db
          .update(opsErrorLogs)
          .set({ occurrences: sql`${opsErrorLogs.occurrences} + 1`, lastSeenAt: new Date() })
          .where(eq(opsErrorLogs.id, existing.id));
      } else {
        await db.insert(opsErrorLogs).values({
          source: "backend",
          route: req.path,
          message: errMessage,
          stack,
          meta: { method: req.method, status },
        });
      }
    } catch {
      // never let error-logging itself crash the error handler
    }
  })();

  // For 5xx (unexpected) errors, never echo the raw error message back to
  // the client — it can leak internal details (DB hosts, stack traces,
  // third-party API errors). The real message still goes to the server log
  // above. Routes that intentionally return 4xx already send their own safe
  // message directly via res.status().json(), so this only affects the
  // "something unexpected broke" path.
  const message = status < 500
    ? ((err as { message?: string })?.message ?? "Request failed")
    : "Internal server error";
  res.status(status).json({ error: message });
});

export default app;
