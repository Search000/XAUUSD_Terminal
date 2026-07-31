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

app.use(cors({ credentials: true, origin: true }));
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
  const message = (err as { message?: string })?.message ?? "Internal server error";
  req.log?.error({ err }, "Unhandled error");
  res.status(status).json({ error: message });
});

export default app;
