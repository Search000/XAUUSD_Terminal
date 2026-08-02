import { Router } from "express";
import { getAuth } from "@clerk/express";
import { db } from "@workspace/db";
import { notificationsTable } from "@workspace/db";
import { eq, or, desc, and } from "drizzle-orm";
import { requireAuth } from "../lib/auth";
import { requireLicense } from "../lib/licenseCheck";
import { registerSSEClient } from "../lib/sseClients";
import { asyncHandler } from "../lib/asyncHandler";

const router = Router();

/**
 * GET /api/notifications/stream
 * Server-Sent Events stream — non-async, no DB call, no try/catch needed.
 */
router.get("/notifications/stream", requireAuth, (req, res): void => {
  const { userId } = getAuth(req);
  if (!userId) { res.status(401).end(); return; }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  res.write("event: connected\ndata: {}\n\n");

  const unregister = registerSSEClient(userId, res);

  const keepAlive = setInterval(() => {
    try { res.write(":ping\n\n"); } catch { cleanup(); }
  }, 25_000);

  function cleanup() {
    clearInterval(keepAlive);
    unregister();
  }

  req.on("close", cleanup);
});

/** GET /api/notifications */
router.get("/notifications", requireAuth, requireLicense, asyncHandler(async (req, res) => {
  const { userId } = getAuth(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }

  const rows = await db
    .select()
    .from(notificationsTable)
    .where(or(eq(notificationsTable.userId, userId), eq(notificationsTable.userId, "__admin__")))
    .orderBy(desc(notificationsTable.createdAt))
    .limit(50);

  res.json(rows);
}));

/** GET /api/notifications/unread-count */
router.get("/notifications/unread-count", requireAuth, requireLicense, asyncHandler(async (req, res) => {
  const { userId } = getAuth(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }

  // Badge count is driven by isSeen (per-item, UI-only), NOT isRead
  // (isRead is auto-set true on creation as a backend/Telegram-sync flag).
  const rows = await db
    .select()
    .from(notificationsTable)
    .where(
      and(
        or(eq(notificationsTable.userId, userId), eq(notificationsTable.userId, "__admin__")),
        eq(notificationsTable.isSeen, false),
      ),
    );

  res.json({ count: rows.length });
}));

/** PATCH /api/notifications/read-all */
router.patch("/notifications/read-all", requireAuth, requireLicense, asyncHandler(async (req, res) => {
  const { userId } = getAuth(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }

  await db
    .update(notificationsTable)
    .set({ isRead: true, isSeen: true })
    .where(or(eq(notificationsTable.userId, userId), eq(notificationsTable.userId, "__admin__")));

  res.json({ success: true });
}));

/** PATCH /api/notifications/:id/read — marks a single notification as seen
 *  (called when the user actually opens it in the app). This is what
 *  decrements the unread badge count, one notification at a time. */
router.patch("/notifications/:id/read", requireAuth, requireLicense, asyncHandler(async (req, res) => {
  const { userId } = getAuth(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }

  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  await db
    .update(notificationsTable)
    .set({ isRead: true, isSeen: true })
    .where(and(eq(notificationsTable.id, id), or(eq(notificationsTable.userId, userId), eq(notificationsTable.userId, "__admin__"))));

  res.json({ success: true });
}));

export default router;
