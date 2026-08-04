import { Router } from "express";
import { getAuth } from "@clerk/express";
import { db } from "@workspace/db";
import { supportMessagesTable, usersTable, telegramSettingsTable } from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import { paramToString } from "../lib/params";
import { requireAuth } from "../lib/auth";
import { requirePermission } from "../lib/permissions";
import { sendTelegramMessage } from "../lib/telegram";
import { asyncHandler } from "../lib/asyncHandler";
import { z } from "zod";

const submitSupportSchema = z.object({
  message: z.string().min(1, "Message is required").max(2000, "Message must be 2000 characters or less"),
});

const router = Router();

/** Always returns the admin's telegram settings — never any other user's. */
async function getAdminTelegram() {
  const [tg] = await db
    .select({ botToken: telegramSettingsTable.botToken, chatId: telegramSettingsTable.chatId })
    .from(telegramSettingsTable)
    .innerJoin(usersTable, eq(usersTable.userId, telegramSettingsTable.userId))
    .where(eq(usersTable.isAdmin, true))
    .limit(1);
  return tg ?? null;
}

/** POST /api/support/message */
router.post("/support/message", requireAuth, asyncHandler(async (req, res) => {
  const { userId } = getAuth(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }

  const parsed = submitSupportSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.errors[0]?.message ?? "Invalid request body" });
    return;
  }
  const { message } = parsed.data;

  const [user] = await db.select().from(usersTable).where(eq(usersTable.userId, userId));

  const [row] = await db.insert(supportMessagesTable).values({
    userId,
    email: user?.email ?? "",
    message: message.trim(),
  }).returning();

  try {
    const tg = await getAdminTelegram();
    if (tg?.botToken && tg?.chatId) {
      const text =
        `🆘 *Support Message*\n\n` +
        `👤 Email: \`${user?.email ?? "Unknown"}\`\n` +
        `💬 Message: ${message.trim()}`;
      await sendTelegramMessage(tg.botToken, tg.chatId, text);
    }
  } catch (err) {
    req.log.warn({ err }, "Telegram notification failed for support message");
  }

  res.status(201).json({
    id: row.id,
    message: row.message,
    createdAt: row.createdAt.toISOString(),
  });
}));

/** GET /api/admin/support/messages */
router.get("/admin/support/messages", requireAuth, requirePermission("manage_support"), asyncHandler(async (_req, res) => {
  const rows = await db
    .select()
    .from(supportMessagesTable)
    .orderBy(desc(supportMessagesTable.createdAt));

  res.json(rows.map(r => ({
    id: r.id,
    userId: r.userId,
    email: r.email,
    message: r.message,
    isRead: r.isRead,
    createdAt: r.createdAt.toISOString(),
  })));
}));

/** GET /api/admin/support/unread-count */
router.get("/admin/support/unread-count", requireAuth, requirePermission("manage_support"), asyncHandler(async (_req, res) => {
  const rows = await db
    .select()
    .from(supportMessagesTable)
    .where(eq(supportMessagesTable.isRead, false));
  res.json({ count: rows.length });
}));

/** PUT /api/admin/support/messages/:id/read */
router.put("/admin/support/messages/:id/read", requireAuth, requirePermission("manage_support"), asyncHandler(async (req, res) => {
  const id = parseInt(paramToString(req.params.id), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  await db.update(supportMessagesTable)
    .set({ isRead: true })
    .where(eq(supportMessagesTable.id, id));

  res.json({ success: true });
}));

/** PUT /api/admin/support/messages/read-all */
router.put("/admin/support/messages/read-all", requireAuth, requirePermission("manage_support"), asyncHandler(async (_req, res) => {
  await db.update(supportMessagesTable).set({ isRead: true });
  res.json({ success: true });
}));

export default router;
