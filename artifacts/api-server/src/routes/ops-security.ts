import { Router, type Request, type Response, type NextFunction } from "express";
import { db } from "@workspace/db";
import { opsSecurityEvents } from "@workspace/db";
import { gte, desc, sql } from "drizzle-orm";
import { requirePermission } from "../lib/permissions";

const router = Router();

function requireWorkerSecret(req: Request, res: Response, next: NextFunction) {
  const secret = req.header("x-ops-agent-secret");
  if (!secret || secret !== process.env.OPS_AGENT_SHARED_SECRET) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  next();
}
function requireOpsAccess(req: Request, res: Response, next: NextFunction) {
  const secret = req.header("x-ops-agent-secret");
  if (secret && secret === process.env.OPS_AGENT_SHARED_SECRET) {
    next();
    return;
  }
  requirePermission("manage_ops_agent")(req, res, next);
}

// ---------------------------------------------------------------------------
// logSecurityEvent — import + call this DIRECTLY (not over HTTP) from your
// existing rate-limiter, CORS middleware, Clerk webhook handler, secret-probe
// detector, and payment-webhook error handler. Cheapest way to wire Phase 3
// items 17-20 without adding a network hop per request.
//
// Example (in your rate-limit middleware):
//   import { logSecurityEvent } from "../routes/ops-security";
//   if (limited) logSecurityEvent({ type: "rate_limit", ip: req.ip, detail: { route: req.path } });
// ---------------------------------------------------------------------------
export async function logSecurityEvent(event: {
  type: "rate_limit" | "cors_violation" | "secret_probe" | "suspicious_login" | "failed_payment" | "webhook_error";
  ip?: string;
  userId?: string;
  detail?: Record<string, unknown>;
  severity?: "info" | "warning" | "critical";
}) {
  await db.insert(opsSecurityEvents).values({
    type: event.type,
    ip: event.ip ?? null,
    userId: event.userId ?? null,
    detail: event.detail ?? null,
    severity: event.severity ?? "warning",
  });
}

// GET /api/ops/security/events — recent events (worker or owner)
router.get("/security/events", requireOpsAccess, async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 100, 500);
  const rows = await db
    .select()
    .from(opsSecurityEvents)
    .orderBy(desc(opsSecurityEvents.createdAt))
    .limit(limit);
  res.json({ events: rows });
});

// GET /api/ops/security/summary?windowMinutes=10
// Grouped counts by type — worker cron polls this to detect spikes (e.g.
// brute-force: many suspicious_login events from same-ish window).
router.get("/security/summary", requireWorkerSecret, async (req, res) => {
  const windowMinutes = Math.min(Number(req.query.windowMinutes) || 10, 1440);
  const since = new Date(Date.now() - windowMinutes * 60 * 1000);

  const rows = await db
    .select({
      type: opsSecurityEvents.type,
      count: sql<number>`count(*)`,
    })
    .from(opsSecurityEvents)
    .where(gte(opsSecurityEvents.createdAt, since))
    .groupBy(opsSecurityEvents.type);

  res.json({ windowMinutes, since: since.toISOString(), counts: rows });
});

export default router;
