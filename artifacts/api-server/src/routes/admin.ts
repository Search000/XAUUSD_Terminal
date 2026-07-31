import { Router } from "express";
import { db } from "@workspace/db";
import { usersTable, licensesTable, tradesTable, investorsTable, systemSettingsTable, notificationsTable } from "@workspace/db";
import { eq, and, count, sum, desc, or } from "drizzle-orm";
import { requireAuth, requireAdmin } from "../lib/auth";
import { asyncHandler } from "../lib/asyncHandler";
import { z } from "zod";

const router = Router();

/** GET /api/admin/users */
router.get("/admin/users", requireAuth, requireAdmin, asyncHandler(async (req, res) => {
  const users = await db.select().from(usersTable).orderBy(usersTable.createdAt);
  const now = new Date();

  const result = await Promise.all(
    users.map(async (user) => {
      const [
        [license],
        tradeCount,
        [latestTrade],
        [investor],
        investmentSum,
      ] = await Promise.all([
        db.select().from(licensesTable)
          .where(and(eq(licensesTable.usedByUserId, user.userId), eq(licensesTable.isActive, true))),
        db.select({ count: count() }).from(tradesTable).where(eq(tradesTable.userId, user.userId)),
        db.select({ balance: tradesTable.balance }).from(tradesTable)
          .where(eq(tradesTable.userId, user.userId))
          .orderBy(desc(tradesTable.id)).limit(1),
        db.select().from(investorsTable)
          .where(eq(investorsTable.userId, user.userId))
          .orderBy(investorsTable.createdAt).limit(1),
        db.select({ total: sum(investorsTable.investmentAmount) }).from(investorsTable)
          .where(eq(investorsTable.userId, user.userId)),
      ]);

      let isLicenseActive = false;
      let licenseExpiresAt: string | null = null;
      let daysRemaining: number | null = null;

      if (license && !license.isRevoked) {
        const expired = license.expiresAt && license.expiresAt < now;
        isLicenseActive = !expired;
        licenseExpiresAt = license.expiresAt?.toISOString() ?? null;
        daysRemaining = license.expiresAt
          ? Math.max(0, Math.ceil((license.expiresAt.getTime() - now.getTime()) / (24 * 60 * 60 * 1000)))
          : null;
      }

      return {
        userId: user.userId,
        email: user.email,
        createdAt: user.createdAt.toISOString(),
        lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
        hasLicense: !!license,
        isLicenseActive,
        licenseExpiresAt,
        daysRemaining,
        totalTrades: tradeCount[0]?.count ?? 0,
        licenseCode: license?.licenseCode ?? null,
        licenseTransactionCode: license?.transactionCode ?? null,
        licenseDurationDays: license?.durationDays ?? null,
        investorName: investor?.name ?? null,
        latestBalance: latestTrade?.balance ?? null,
        totalInvestment: investmentSum[0]?.total ?? null,
      };
    }),
  );

  res.json(result);
}));

/** GET /api/admin/stats */
router.get("/admin/stats", requireAuth, requireAdmin, asyncHandler(async (req, res) => {
  const now = new Date();
  const [totalUsers] = await db.select({ count: count() }).from(usersTable);
  const allLicenses = await db.select().from(licensesTable);

  const activeLicenses = allLicenses.filter(
    (l) => l.isActive && !l.isRevoked && (!l.expiresAt || l.expiresAt > now),
  ).length;
  const expiredLicenses = allLicenses.filter(
    (l) => l.isActive && !l.isRevoked && l.expiresAt && l.expiresAt <= now,
  ).length;
  const revokedLicenses = allLicenses.filter((l) => l.isRevoked).length;

  const activeUserRows = await db
    .select({ userId: tradesTable.userId })
    .from(tradesTable)
    .groupBy(tradesTable.userId);

  res.json({
    totalUsers: totalUsers.count,
    activeUsers: activeUserRows.length,
    totalLicenses: allLicenses.length,
    activeLicenses,
    expiredLicenses,
    revokedLicenses,
  });
}));

/** GET /api/admin/system-settings */
router.get("/admin/system-settings", requireAuth, requireAdmin, asyncHandler(async (_req, res) => {
  const [row] = await db.select().from(systemSettingsTable).where(eq(systemSettingsTable.id, 1));
  res.json({
    licenseEnforcementEnabled: row?.licenseEnforcementEnabled ?? true,
    trialModeEnabled: row?.trialModeEnabled ?? false,
    trialDurationDays: row?.trialDurationDays ?? 7,
  });
}));

/** PUT /api/admin/system-settings */
router.put("/admin/system-settings", requireAuth, requireAdmin, asyncHandler(async (req, res) => {
  const { licenseEnforcementEnabled, trialModeEnabled, trialDurationDays } = req.body as {
    licenseEnforcementEnabled?: boolean;
    trialModeEnabled?: boolean;
    trialDurationDays?: number;
  };

  if (licenseEnforcementEnabled !== undefined && typeof licenseEnforcementEnabled !== "boolean") {
    res.status(400).json({ error: "licenseEnforcementEnabled must be a boolean" });
    return;
  }
  if (trialModeEnabled !== undefined && typeof trialModeEnabled !== "boolean") {
    res.status(400).json({ error: "trialModeEnabled must be a boolean" });
    return;
  }
  if (trialDurationDays !== undefined && (typeof trialDurationDays !== "number" || trialDurationDays < 1 || trialDurationDays > 365)) {
    res.status(400).json({ error: "trialDurationDays must be a number between 1 and 365" });
    return;
  }

  const [existing] = await db.select().from(systemSettingsTable).where(eq(systemSettingsTable.id, 1));

  const patch: Partial<{ licenseEnforcementEnabled: boolean; trialModeEnabled: boolean; trialDurationDays: number; updatedAt: Date }> = { updatedAt: new Date() };
  if (licenseEnforcementEnabled !== undefined) patch.licenseEnforcementEnabled = licenseEnforcementEnabled;
  if (trialModeEnabled !== undefined) patch.trialModeEnabled = trialModeEnabled;
  if (trialDurationDays !== undefined) patch.trialDurationDays = trialDurationDays;

  if (existing) {
    const [updated] = await db
      .update(systemSettingsTable)
      .set(patch)
      .where(eq(systemSettingsTable.id, 1))
      .returning();
    res.json({
      licenseEnforcementEnabled: updated.licenseEnforcementEnabled,
      trialModeEnabled: updated.trialModeEnabled,
      trialDurationDays: updated.trialDurationDays,
    });
    return;
  }

  const [created] = await db
    .insert(systemSettingsTable)
    .values({
      id: 1,
      licenseEnforcementEnabled: licenseEnforcementEnabled ?? true,
      trialModeEnabled: trialModeEnabled ?? false,
      trialDurationDays: trialDurationDays ?? 7,
    })
    .returning();
  res.json({
    licenseEnforcementEnabled: created.licenseEnforcementEnabled,
    trialModeEnabled: created.trialModeEnabled,
  });
}));

/** GET /api/admin/activity — user activity log */
router.get("/admin/activity", requireAuth, requireAdmin, asyncHandler(async (_req, res) => {
  const users = await db.select().from(usersTable).orderBy(desc(usersTable.lastLoginAt));
  const now = new Date();

  const result = await Promise.all(
    users.map(async (user) => {
      const [[license], tradeCountRow] = await Promise.all([
        db.select().from(licensesTable)
          .where(and(eq(licensesTable.usedByUserId, user.userId), eq(licensesTable.isActive, true))),
        db.select({ count: count() }).from(tradesTable).where(eq(tradesTable.userId, user.userId)),
      ]);

      let isLicenseActive = false;
      let licenseExpiresAt: string | null = null;
      if (license && !license.isRevoked) {
        const expired = license.expiresAt && license.expiresAt < now;
        isLicenseActive = !expired;
        licenseExpiresAt = license.expiresAt?.toISOString() ?? null;
      }

      return {
        userId: user.userId,
        email: user.email,
        createdAt: user.createdAt.toISOString(),
        lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
        totalTrades: tradeCountRow[0]?.count ?? 0,
        isLicenseActive,
        licenseExpiresAt,
        hasLicense: !!license,
      };
    }),
  );

  res.json(result);
}));

const broadcastSchema = z.object({
  title: z.string().min(1, "title is required"),
  body: z.string().min(1, "body is required"),
});

/** POST /api/admin/notifications/broadcast */
router.post("/admin/notifications/broadcast", requireAuth, requireAdmin, asyncHandler(async (req, res) => {
  const parsed = broadcastSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.errors[0]?.message ?? "Invalid request body" });
    return;
  }
  const { title, body } = parsed.data;

  const [row] = await db
    .insert(notificationsTable)
    .values({ userId: "__admin__", type: "admin", title, body, isRead: false })
    .returning();

  const { pushNotificationSSE } = await import("../lib/sseClients");
  pushNotificationSSE("__admin__");

  res.status(201).json(row);
}));

/** GET /api/admin/notifications */
router.get("/admin/notifications", requireAuth, requireAdmin, asyncHandler(async (_req, res) => {
  const rows = await db
    .select()
    .from(notificationsTable)
    .where(or(
      eq(notificationsTable.userId, "__admin__"),
      eq(notificationsTable.userId, "__targeted__"),
    ))
    .orderBy(desc(notificationsTable.createdAt))
    .limit(100);
  res.json(rows);
}));

/** DELETE /api/admin/notifications/:id */
router.delete("/admin/notifications/:id", requireAuth, requireAdmin, asyncHandler(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const [record] = await db
    .select()
    .from(notificationsTable)
    .where(and(
      eq(notificationsTable.id, id),
      or(eq(notificationsTable.userId, "__admin__"), eq(notificationsTable.userId, "__targeted__")),
    ));

  if (!record) { res.status(404).json({ error: "Not found" }); return; }

  if (record.userId === "__targeted__") {
    await db
      .delete(notificationsTable)
      .where(and(
        eq(notificationsTable.title, record.title),
        eq(notificationsTable.body, record.body),
        eq(notificationsTable.type, "admin"),
      ));
  }

  await db.delete(notificationsTable).where(eq(notificationsTable.id, id));
  res.json({ success: true });
}));

/** DELETE /api/admin/notifications */
router.delete("/admin/notifications", requireAuth, requireAdmin, asyncHandler(async (_req, res) => {
  await db
    .delete(notificationsTable)
    .where(eq(notificationsTable.type, "admin"));

  const deleted = await db
    .delete(notificationsTable)
    .where(or(
      eq(notificationsTable.userId, "__admin__"),
      eq(notificationsTable.userId, "__targeted__"),
    ))
    .returning();

  res.json({ deleted: deleted.length });
}));

const sendNotificationSchema = z.object({
  title:   z.string().min(1, "title is required").max(200),
  body:    z.string().min(1, "body is required").max(1000),
  userIds: z.array(z.string().min(1)).min(1, "userIds must be a non-empty array"),
});

/** POST /api/admin/notifications/send-to-users */
router.post("/admin/notifications/send-to-users", requireAuth, requireAdmin, asyncHandler(async (req, res) => {
  const parsed = sendNotificationSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.errors[0]?.message ?? "Invalid request body" });
    return;
  }
  const { title, body, userIds } = parsed.data;

  const { pushNotificationSSE } = await import("../lib/sseClients");

  const inserts = await Promise.all(
    userIds.map(async (userId) => {
      const [row] = await db
        .insert(notificationsTable)
        .values({ userId, type: "admin", title, body, isRead: false })
        .returning();
      pushNotificationSSE(userId);
      return row;
    }),
  );

  await db.insert(notificationsTable).values({
    userId: "__targeted__",
    type: "admin_targeted",
    title,
    body,
    isRead: false,
  });

  res.status(201).json({ sent: inserts.length });
}));

export default router;
