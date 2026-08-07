import { Router, type Request, type Response, type NextFunction } from "express";
import { db } from "@workspace/db";
import {
  opsActions,
  opsAlerts,
  opsErrorLogs,
  systemSettingsTable,
  licensesTable,
  usersTable,
  notificationsTable,
  type StaffRole,
} from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import { requirePermission, isStaffRole } from "../lib/permissions";
import { invalidateLicenseCache } from "../lib/licenseCheck";
import { liveGoldFeed } from "../lib/liveGoldFeed";
import { pushNotificationSSE } from "../lib/sseClients";
import {
  sendDailyRecapToAll,
  sendWeeklyReportToAll,
  sendMonthlyReportToAll,
  sendLicenseExpiryWarnings,
  sendLicenseRenewalReminders,
  sendTrialExpiryReminders,
} from "../lib/notifications";

const router = Router();

// ---------------------------------------------------------------------------
// Auth: two call paths hit this router —
//  1) Cloudflare Worker (cron + telegram) — no Clerk session, uses shared secret
//  2) Admin panel (owner logged in via Clerk) — uses requirePermission("manage_ops_agent")
// ---------------------------------------------------------------------------
function requireWorkerSecret(req: Request, res: Response, next: NextFunction) {
  const secret = req.header("x-ops-agent-secret");
  if (!secret || secret !== process.env.OPS_AGENT_SHARED_SECRET) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  next();
}

// Accept EITHER worker-secret OR owner Clerk session w/ permission
function requireOpsAccess(req: Request, res: Response, next: NextFunction) {
  const secret = req.header("x-ops-agent-secret");
  if (secret && secret === process.env.OPS_AGENT_SHARED_SECRET) {
    next();
    return;
  }
  requirePermission("manage_ops_agent")(req, res, next);
}

// ---------------------------------------------------------------------------
// GET /api/ops/health — basic self + DB + live gold feed check
// ---------------------------------------------------------------------------
router.get("/health", requireOpsAccess, async (_req, res) => {
  try {
    await db.execute("select 1");
    const latest = liveGoldFeed.getLatest();
    const feedOk = latest ? Date.now() - new Date(latest.timestamp).getTime() < 5 * 60_000 : false;
    res.json({
      ok: true,
      db: "up",
      goldFeed: feedOk ? "live" : "stale-or-down",
      goldFeedLastTick: latest?.timestamp ?? null,
      time: new Date().toISOString(),
    });
  } catch (err) {
    res.status(500).json({ ok: false, db: "down", error: String(err) });
  }
});

// ---------------------------------------------------------------------------
// POST /api/ops/client-error — frontend error capture (public, no auth —
// mount this BEFORE any auth middleware in routes/index.ts; it's rate-limited
// by the existing global /api rate limiter in app.ts)
// ---------------------------------------------------------------------------
router.post("/client-error", async (req, res) => {
  const { message, stack, route, meta } = req.body ?? {};
  if (!message) {
    res.status(400).json({ error: "message required" });
    return;
  }

  await db.insert(opsErrorLogs).values({
    source: "frontend",
    route: route ?? null,
    message,
    stack: stack ?? null,
    meta: meta ?? null,
  });

  res.status(201).json({ ok: true });
});

// ---------------------------------------------------------------------------
// GET /api/ops/logs — recent error logs (query: ?limit=50)
// ---------------------------------------------------------------------------
router.get("/logs", requireOpsAccess, async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  const rows = await db
    .select()
    .from(opsErrorLogs)
    .orderBy(desc(opsErrorLogs.createdAt))
    .limit(limit);
  res.json({ logs: rows });
});

// ---------------------------------------------------------------------------
// GET /api/ops/alerts — list alerts (query: ?limit=50&acknowledged=false)
// ---------------------------------------------------------------------------
router.get("/alerts", requireOpsAccess, async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  const rows = await db
    .select()
    .from(opsAlerts)
    .orderBy(desc(opsAlerts.createdAt))
    .limit(limit);
  res.json({ alerts: rows });
});

// POST /api/ops/alerts — worker creates an alert (e.g. after cron health-check finds issue)
router.post("/alerts", requireWorkerSecret, async (req, res) => {
  const { type, severity, title, detail, errorLogId } = req.body ?? {};
  if (!type || !title) {
    res.status(400).json({ error: "type and title required" });
    return;
  }

  const [row] = await db
    .insert(opsAlerts)
    .values({ type, severity: severity ?? "info", title, detail, errorLogId })
    .returning();

  res.status(201).json({ alert: row });
});

// ---------------------------------------------------------------------------
// Actions: propose -> approve/reject -> execute. Every step logged (audit trail).
// ---------------------------------------------------------------------------

// GET /api/ops/actions — list (query: ?status=pending)
router.get("/actions", requireOpsAccess, async (req, res) => {
  const status = typeof req.query.status === "string" ? req.query.status : undefined;
  const rows = await db
    .select()
    .from(opsActions)
    .orderBy(desc(opsActions.createdAt))
    .limit(100);
  res.json({ actions: status ? rows.filter((a) => a.status === status) : rows });
});

// POST /api/ops/actions — propose a new action (worker or admin can propose)
router.post("/actions", requireOpsAccess, async (req, res) => {
  const { alertId, actionType, description, reasoning, payload, requestedBy } = req.body ?? {};
  if (!actionType || !description) {
    res.status(400).json({ error: "actionType and description required" });
    return;
  }

  const RISKY_TYPES = new Set(["role_change", "license_revoke"]);

  const [row] = await db
    .insert(opsActions)
    .values({
      alertId: alertId ?? null,
      actionType,
      description,
      reasoning: reasoning ?? null,
      payload: payload ?? null,
      requestedBy: requestedBy ?? "ops-agent",
      status: "pending",
      requiresDoubleConfirm: RISKY_TYPES.has(actionType),
    })
    .returning();

  res.status(201).json({ action: row });
});

// POST /api/ops/actions/:id/confirm — second explicit confirm for risky action
// types (role_change, license_revoke). Must be called before /execute for those.
router.post("/actions/:id/confirm", requireOpsAccess, async (req, res) => {
  const id = Number(req.params.id);
  const [row] = await db
    .update(opsActions)
    .set({ doubleConfirmed: true })
    .where(eq(opsActions.id, id))
    .returning();
  if (!row) {
    res.status(404).json({ error: "action not found" });
    return;
  }
  res.json({ action: row });
});

// POST /api/ops/actions/:id/approve — owner approves; DOES NOT execute yet (explicit execute call after)
router.post("/actions/:id/approve", requireOpsAccess, async (req, res) => {
  const id = Number(req.params.id);
  const approvedBy = req.body?.approvedBy ?? "owner";

  const [row] = await db
    .update(opsActions)
    .set({ status: "approved", approvedBy, decidedAt: new Date() })
    .where(eq(opsActions.id, id))
    .returning();

  if (!row) {
    res.status(404).json({ error: "action not found" });
    return;
  }
  res.json({ action: row });
});

// POST /api/ops/actions/:id/reject
router.post("/actions/:id/reject", requireOpsAccess, async (req, res) => {
  const id = Number(req.params.id);
  const approvedBy = req.body?.approvedBy ?? "owner";

  const [row] = await db
    .update(opsActions)
    .set({ status: "rejected", approvedBy, decidedAt: new Date() })
    .where(eq(opsActions.id, id))
    .returning();

  if (!row) {
    res.status(404).json({ error: "action not found" });
    return;
  }
  res.json({ action: row });
});

// POST /api/ops/actions/:id/execute — runs the scope-limited action. Must be status=approved first.
router.post("/actions/:id/execute", requireOpsAccess, async (req, res) => {
  const id = Number(req.params.id);

  const [action] = await db.select().from(opsActions).where(eq(opsActions.id, id));
  if (!action) {
    res.status(404).json({ error: "action not found" });
    return;
  }
  if (action.status !== "approved") {
    res.status(409).json({ error: `action must be 'approved' first, currently '${action.status}'` });
    return;
  }
  if (action.requiresDoubleConfirm && !action.doubleConfirmed) {
    res.status(409).json({
      error: "this action type requires a second confirmation — POST /actions/:id/confirm first",
    });
    return;
  }

  let result: Record<string, unknown>;
  try {
    result = await executeAction(action.actionType, (action.payload as Record<string, unknown>) ?? {});
  } catch (err) {
    await db
      .update(opsActions)
      .set({ status: "failed", result: { error: String(err) } })
      .where(eq(opsActions.id, id));
    res.status(500).json({ error: "execution failed", detail: String(err) });
    return;
  }

  const [row] = await db
    .update(opsActions)
    .set({ status: "executed", executedAt: new Date(), result })
    .where(eq(opsActions.id, id))
    .returning();

  res.json({ action: row });
});

// ---------------------------------------------------------------------------
// executeAction — scope-limited dispatcher.
// NEVER include: git push/deploy, destructive SQL, hard-delete. role_change
// and license_revoke are gated by requiresDoubleConfirm (enforced above).
// ---------------------------------------------------------------------------
async function executeAction(
  actionType: string,
  payload: Record<string, unknown>
): Promise<Record<string, unknown>> {
  switch (actionType) {
    // -------------------------------------------------------------------
    // db_flag_toggle — payload: { key: "assistantEnabled" | "licenseEnforcementEnabled" | "trialModeEnabled", value: boolean }
    // -------------------------------------------------------------------
    case "db_flag_toggle": {
      const key = payload.key as string;
      const value = payload.value as boolean;
      const ALLOWED = ["assistantEnabled", "licenseEnforcementEnabled", "trialModeEnabled"] as const;
      if (!ALLOWED.includes(key as (typeof ALLOWED)[number])) {
        throw new Error(`unsupported flag key: ${key}. allowed: ${ALLOWED.join(", ")}`);
      }
      if (typeof value !== "boolean") throw new Error("value must be boolean");

      const [existing] = await db.select().from(systemSettingsTable).where(eq(systemSettingsTable.id, 1));
      let previousValue: boolean | null = null;
      if (existing) {
        previousValue = (existing as Record<string, unknown>)[key] as boolean;
        await db
          .update(systemSettingsTable)
          .set({ [key]: value, updatedAt: new Date() } as Partial<typeof systemSettingsTable.$inferInsert>)
          .where(eq(systemSettingsTable.id, 1));
      } else {
        await db.insert(systemSettingsTable).values({ id: 1, [key]: value } as typeof systemSettingsTable.$inferInsert);
      }
      return { key, previousValue, newValue: value };
    }

    // -------------------------------------------------------------------
    // cache_clear — clears the in-memory license/system-settings cache
    // (lib/licenseCheck.ts). No payload needed.
    // -------------------------------------------------------------------
    case "cache_clear": {
      invalidateLicenseCache();
      return { cleared: "licenseCheck in-memory cache (license + system-settings)" };
    }

    // -------------------------------------------------------------------
    // retry_job — payload: { job: "daily_recap" | "weekly_report" | "monthly_report" |
    //                               "license_expiry_warnings" | "license_renewal_reminders" | "trial_expiry_reminders" }
    // -------------------------------------------------------------------
    case "retry_job": {
      const job = payload.job as string;
      const JOBS: Record<string, () => Promise<unknown>> = {
        daily_recap: sendDailyRecapToAll,
        weekly_report: sendWeeklyReportToAll,
        monthly_report: sendMonthlyReportToAll,
        license_expiry_warnings: sendLicenseExpiryWarnings,
        license_renewal_reminders: sendLicenseRenewalReminders,
        trial_expiry_reminders: sendTrialExpiryReminders,
      };
      const fn = JOBS[job];
      if (!fn) throw new Error(`unsupported job: ${job}. allowed: ${Object.keys(JOBS).join(", ")}`);
      await fn();
      return { job, status: "re-run triggered" };
    }

    // -------------------------------------------------------------------
    // force_refresh_feed — restarts the live gold/metals WS feed singleton.
    // -------------------------------------------------------------------
    case "force_refresh_feed": {
      liveGoldFeed.start();
      return { note: "liveGoldFeed.start() called — reconnect requested" };
    }

    // -------------------------------------------------------------------
    // notify_users — payload: { userIds: string[], title: string, message: string }
    // -------------------------------------------------------------------
    case "notify_users": {
      const userIds = payload.userIds as string[];
      const title = (payload.title as string) ?? "Ops Agent Notice";
      const message = payload.message as string;
      if (!Array.isArray(userIds) || userIds.length === 0) throw new Error("userIds must be a non-empty array");
      if (!message) throw new Error("message required");

      const inserted = await Promise.all(
        userIds.map(async (userId) => {
          const [row] = await db
            .insert(notificationsTable)
            .values({ userId, type: "admin", title, body: message })
            .returning();
          pushNotificationSSE(userId);
          return row;
        }),
      );
      return { sent: inserted.length, userIds };
    }

    // -------------------------------------------------------------------
    // broadcast_announcement — payload: { title: string, message: string }
    // -------------------------------------------------------------------
    case "broadcast_announcement": {
      const title = payload.title as string;
      const message = payload.message as string;
      if (!title || !message) throw new Error("title and message required");

      const [row] = await db
        .insert(notificationsTable)
        .values({ userId: "__admin__", type: "admin", title, body: message })
        .returning();
      pushNotificationSSE("__admin__");
      return { broadcast: row };
    }

    // -------------------------------------------------------------------
    // license_extend — payload: { licenseId: number, days: number }
    // -------------------------------------------------------------------
    case "license_extend": {
      const licenseId = Number(payload.licenseId);
      const days = Number(payload.days);
      if (!licenseId || !days) throw new Error("licenseId and days required");

      const [license] = await db.select().from(licensesTable).where(eq(licensesTable.id, licenseId));
      if (!license) throw new Error("license not found");

      const base = license.expiresAt && license.expiresAt > new Date() ? license.expiresAt : new Date();
      const newExpiresAt = new Date(base.getTime() + days * 24 * 60 * 60 * 1000);

      const [updated] = await db
        .update(licensesTable)
        .set({ expiresAt: newExpiresAt })
        .where(eq(licensesTable.id, licenseId))
        .returning();
      return { licenseId, previousExpiresAt: license.expiresAt, newExpiresAt: updated.expiresAt };
    }

    // -------------------------------------------------------------------
    // license_revoke — RISKY, double-confirm enforced above.
    // payload: { licenseId: number }
    // -------------------------------------------------------------------
    case "license_revoke": {
      const licenseId = Number(payload.licenseId);
      if (!licenseId) throw new Error("licenseId required");

      const [updated] = await db
        .update(licensesTable)
        .set({ isRevoked: true, isActive: false })
        .where(eq(licensesTable.id, licenseId))
        .returning();
      if (!updated) throw new Error("license not found");
      return { licenseId, revoked: true };
    }

    // -------------------------------------------------------------------
    // role_change — RISKY, double-confirm enforced above.
    // payload: { userId: string, newRole: string }
    // -------------------------------------------------------------------
    case "role_change": {
      const userId = payload.userId as string;
      const newRole = payload.newRole as string;
      if (!userId || !newRole) throw new Error("userId and newRole required");
      if (!isStaffRole(newRole) && newRole !== "user") throw new Error(`invalid role: ${newRole}`);

      const [before] = await db.select().from(usersTable).where(eq(usersTable.userId, userId));
      if (!before) throw new Error("user not found");
      if (before.role === "owner") throw new Error("cannot change the owner's own role via ops-agent");

      const [updated] = await db
        .update(usersTable)
        .set({ role: newRole as StaffRole | "user" })
        .where(eq(usersTable.userId, userId))
        .returning();
      return { userId, previousRole: before.role, newRole: updated.role };
    }

    // -------------------------------------------------------------------
    // settings_rollback — payload: { settingKey: string, previousValue: boolean | number }
    // -------------------------------------------------------------------
    case "settings_rollback": {
      const settingKey = payload.settingKey as string;
      const previousValue = payload.previousValue;
      const ALLOWED = ["licenseEnforcementEnabled", "trialModeEnabled", "trialDurationDays", "assistantEnabled"];
      if (!ALLOWED.includes(settingKey)) throw new Error(`unsupported settingKey: ${settingKey}`);

      await db
        .update(systemSettingsTable)
        .set({ [settingKey]: previousValue, updatedAt: new Date() } as Partial<typeof systemSettingsTable.$inferInsert>)
        .where(eq(systemSettingsTable.id, 1));
      return { settingKey, rolledBackTo: previousValue };
    }

    default:
      throw new Error(`unknown or unsupported actionType: ${actionType}`);
  }
}

export default router;
