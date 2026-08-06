import { Router } from "express";
import { getAuth } from "@clerk/express";
import { db } from "@workspace/db";
import { feedbackTable, usersTable, telegramSettingsTable } from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import { requireAuth } from "../lib/auth";
import { requirePermission } from "../lib/permissions";
import { sendTelegramMessage } from "../lib/telegram";
import { asyncHandler } from "../lib/asyncHandler";
import { z } from "zod";

const submitFeedbackSchema = z.object({
  rating: z.number({ invalid_type_error: "rating must be a number" }).int().min(1, "rating must be at least 1").max(5, "rating must be at most 5"),
  comment: z.string().max(1000, "comment must be 1000 characters or less").optional(),
});

const router = Router();

/** Always returns the admin's telegram settings — never any other user's. */
async function getAdminTelegram() {
  const [tg] = await db
    .select({
      botToken: telegramSettingsTable.botToken,
      chatId: telegramSettingsTable.chatId,
    })
    .from(telegramSettingsTable)
    .innerJoin(usersTable, eq(usersTable.userId, telegramSettingsTable.userId))
    .where(eq(usersTable.isAdmin, true))
    .limit(1);
  return tg ?? null;
}

/** POST /api/feedback — authenticated user submits rating */
router.post("/feedback", requireAuth, asyncHandler(async (req, res) => {
  const { userId } = getAuth(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }

  const parsed = submitFeedbackSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.errors[0]?.message ?? "Invalid request body" });
    return;
  }
  const { rating, comment } = parsed.data;

  const [user] = await db.select().from(usersTable).where(eq(usersTable.userId, userId));

  const [row] = await db.insert(feedbackTable).values({
    userId,
    email: user?.email ?? "",
    rating: Math.round(rating),
    comment: comment?.trim() || null,
  }).returning();

  try {
    const tg = await getAdminTelegram();
    if (tg?.botToken && tg?.chatId) {
      const stars = "⭐".repeat(Math.round(rating));
      const text =
        `💬 *New Feedback*\n\n` +
        `👤 Email: \`${user?.email ?? "Unknown"}\`\n` +
        `${stars} Rating: *${rating}/5*` +
        (comment?.trim() ? `\n📝 Comment: ${comment.trim()}` : "");
      await sendTelegramMessage(tg.botToken, tg.chatId, text);
    }
  } catch (err) {
    req.log.warn({ err }, "Telegram notification failed for feedback");
  }

  res.status(201).json({
    id: row.id,
    userId: row.userId,
    email: row.email,
    rating: row.rating,
    comment: row.comment ?? null,
    createdAt: row.createdAt.toISOString(),
  });
}));

/** GET /api/admin/feedback — admin only */
router.get("/admin/feedback", requireAuth, requirePermission("manage_feedback"), asyncHandler(async (_req, res) => {
  const rows = await db.select().from(feedbackTable).orderBy(desc(feedbackTable.createdAt));
  res.json(rows.map(r => ({
    id: r.id,
    userId: r.userId,
    email: r.email,
    rating: r.rating,
    comment: r.comment ?? null,
    createdAt: r.createdAt.toISOString(),
  })));
}));

export default router;
