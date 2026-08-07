import { Router, type Request, type Response, type NextFunction } from "express";
import { db } from "@workspace/db";
import {
  opsDigests,
  opsTicketMeta,
  usersTable,
  licensesTable,
  feedbackTable,
  supportMessagesTable,
} from "@workspace/db";
import { eq, desc, gte, and, sql } from "drizzle-orm";
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
// GET /api/ops/digest/data?period=daily|weekly
// Raw stats only — worker turns this into an AI-written summary + telegram push.
// ---------------------------------------------------------------------------
router.get("/digest/data", requireWorkerSecret, async (req, res) => {
  const period = (req.query.period as string) === "weekly" ? "weekly" : "daily";
  const since = new Date(Date.now() - (period === "weekly" ? 7 : 1) * 24 * 60 * 60 * 1000);

  const [{ count: signups }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(usersTable)
    .where(gte(usersTable.createdAt, since));

  const [{ count: activeUsers }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(usersTable)
    .where(gte(usersTable.lastLoginAt, since));

  const [{ count: activeLicenses }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(licensesTable)
    .where(and(eq(licensesTable.isActive, true), eq(licensesTable.isRevoked, false)));

  const [{ count: newLicenses }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(licensesTable)
    .where(gte(licensesTable.createdAt, since));

  const churned = await db
    .select()
    .from(licensesTable)
    .where(and(eq(licensesTable.isActive, true), gte(licensesTable.expiresAt, new Date(0))))
    .then((rows) => rows.filter((l) => l.expiresAt && l.expiresAt < new Date()));

  const topErrors = await db.execute(sql`
    SELECT message, occurrences FROM ops_error_logs
    ORDER BY occurrences DESC, last_seen_at DESC LIMIT 5
  `);

  const stats = {
    period,
    since: since.toISOString(),
    signups,
    activeUsers,
    activeLicenses,
    newLicenses,
    churnedLicenses: churned.length,
    // No payments/Stripe table in this codebase — licenses are manually
    // generated codes, so there's no per-transaction revenue to sum. Leaving
    // this null rather than guessing; wire it if a payments table gets added.
    revenueEstimate: null,
    topErrors: (topErrors as unknown as { rows?: unknown[] }).rows ?? topErrors,
  };

  res.json({ stats });
});

// POST /api/ops/digest — worker stores the digest after generating AI summary
router.post("/digest", requireWorkerSecret, async (req, res) => {
  const { period, periodStart, periodEnd, stats, summary } = req.body ?? {};
  if (!period || !periodStart || !periodEnd || !stats) {
    res.status(400).json({ error: "period, periodStart, periodEnd, stats required" });
    return;
  }
  const [row] = await db
    .insert(opsDigests)
    .values({ period, periodStart: new Date(periodStart), periodEnd: new Date(periodEnd), stats, summary })
    .returning();
  res.status(201).json({ digest: row });
});

// GET /api/ops/digest — history (admin panel can show past digests)
router.get("/digest", requireOpsAccess, async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 20, 100);
  const rows = await db.select().from(opsDigests).orderBy(desc(opsDigests.createdAt)).limit(limit);
  res.json({ digests: rows });
});

// ---------------------------------------------------------------------------
// GET /api/ops/business/churn — licenses that lapsed (expired, not renewed) or were revoked
// ---------------------------------------------------------------------------
router.get("/business/churn", requireOpsAccess, async (_req, res) => {
  const all = await db.select().from(licensesTable);
  const now = new Date();
  const churned = all.filter(
    (l) => l.isRevoked || (l.expiresAt && l.expiresAt < now && l.isActive),
  );
  res.json({
    churned: churned.map((l) => ({
      licenseId: l.id,
      email: l.usedByEmail,
      reason: l.isRevoked ? "revoked" : "expired",
      expiresAt: l.expiresAt,
    })),
    count: churned.length,
  });
});

// GET /api/ops/business/conversion — signup -> trial -> paid funnel
// This codebase has no separate "trial" table — trials are licenses with a
// note/duration pattern set by POST /licenses/trial. We treat any license as
// "converted" once activated.
router.get("/business/conversion", requireOpsAccess, async (_req, res) => {
  const [{ count: totalUsers }] = await db.select({ count: sql<number>`count(*)::int` }).from(usersTable);
  const [{ count: totalLicenses }] = await db.select({ count: sql<number>`count(*)::int` }).from(licensesTable);
  const [{ count: activatedLicenses }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(licensesTable)
    .where(eq(licensesTable.isActive, true));

  res.json({
    funnel: {
      totalUsers,
      totalLicensesGenerated: totalLicenses,
      activatedLicenses,
      conversionRate: totalUsers > 0 ? parseFloat(((activatedLicenses / totalUsers) * 100).toFixed(1)) : 0,
    },
  });
});

// ---------------------------------------------------------------------------
// Feedback / support-ticket aggregation (Category C item 26)
// ---------------------------------------------------------------------------
router.get("/feedback/summary", requireOpsAccess, async (_req, res) => {
  const feedback = await db.select().from(feedbackTable).orderBy(desc(feedbackTable.createdAt)).limit(200);
  const avgRating =
    feedback.length > 0 ? feedback.reduce((sum, f) => sum + f.rating, 0) / feedback.length : null;
  const unreadSupport = await db
    .select()
    .from(supportMessagesTable)
    .where(eq(supportMessagesTable.isRead, false));

  res.json({
    feedbackCount: feedback.length,
    avgRating: avgRating !== null ? parseFloat(avgRating.toFixed(2)) : null,
    unreadSupportCount: unreadSupport.length,
    recentFeedback: feedback.slice(0, 20),
  });
});

// ---------------------------------------------------------------------------
// Tickets: worker reads raw messages from support_messages directly (not
// duplicated here), AI-categorizes + drafts reply, then posts result to
// ops_ticket_meta. `ticketId` below refers to support_messages.id.
// ---------------------------------------------------------------------------

// GET /api/ops/tickets/open — worker pulls unread support messages to process
router.get("/tickets/open", requireWorkerSecret, async (_req, res) => {
  const rows = await db
    .select()
    .from(supportMessagesTable)
    .where(eq(supportMessagesTable.isRead, false))
    .orderBy(desc(supportMessagesTable.createdAt))
    .limit(50);
  res.json({ tickets: rows });
});

// POST /api/ops/tickets/:id/categorize — worker stores AI category
router.post("/tickets/:id/categorize", requireWorkerSecret, async (req, res) => {
  const ticketId = Number(req.params.id);
  const { category } = req.body ?? {};
  if (!category) {
    res.status(400).json({ error: "category required" });
    return;
  }

  const [row] = await db
    .insert(opsTicketMeta)
    .values({ ticketId, category })
    .returning();
  res.status(201).json({ meta: row });
});

// POST /api/ops/tickets/:id/draft-reply — worker stores AI draft reply (owner reviews before sending)
router.post("/tickets/:id/draft-reply", requireWorkerSecret, async (req, res) => {
  const ticketId = Number(req.params.id);
  const { draftReply } = req.body ?? {};
  if (!draftReply) {
    res.status(400).json({ error: "draftReply required" });
    return;
  }

  const [row] = await db
    .insert(opsTicketMeta)
    .values({ ticketId, draftReply })
    .returning();
  res.status(201).json({ meta: row });
});

// GET /api/ops/tickets/meta — admin panel pulls category/draft overlay for tickets
router.get("/tickets/meta", requireOpsAccess, async (_req, res) => {
  const rows = await db.select().from(opsTicketMeta).orderBy(desc(opsTicketMeta.createdAt)).limit(100);
  res.json({ meta: rows });
});

export default router;
