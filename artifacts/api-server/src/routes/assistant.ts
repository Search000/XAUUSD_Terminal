import { Router } from "express";
import { getAuth, clerkClient } from "@clerk/express";
import { db, pool } from "@workspace/db";
import { assistantMessagesTable, systemSettingsTable } from "@workspace/db";
import { eq, asc } from "drizzle-orm";
import { requireAuth } from "../lib/auth";
import { asyncHandler } from "../lib/asyncHandler";
import { sendTelegramMessage } from "../lib/telegram";
import { logger } from "../lib/logger";

const router = Router();

/**
 * Keywords that suggest someone is probing for secrets, API keys, backend
 * internals, or "which AI/provider is this" — things the assistant is
 * instructed to never reveal. This is a light heuristic, not a hard filter;
 * it only feeds the abuse-alert counter below, it never blocks the message.
 */
const PROBE_PATTERNS = [
  /api[\s_-]?key/i,
  /secret/i,
  /database[\s_-]?url/i,
  /\benv\b|environment variable/i,
  /credential/i,
  /password/i,
  /source code/i,
  /backend|infrastructure|server setup/i,
  /which (ai|model|llm)/i,
  /(openai|gpt|claude|anthropic|cloudflare|llama)/i,
  /token\b/i,
  /hosting|hosted (on|by)/i,
];

function looksLikeProbe(content: string): boolean {
  return PROBE_PATTERNS.some((re) => re.test(content));
}

const ALERT_THRESHOLD = 6;

/** Increments the probe counter for a user; fires an admin Telegram alert
 *  every time the count crosses a multiple of ALERT_THRESHOLD. Best-effort —
 *  never throws, never blocks the chat response. */
async function trackProbeAttempt(userId: string): Promise<void> {
  try {
    const { rows } = await pool.query<{ count: number }>(
      `INSERT INTO assistant_probe_flags (user_id, count, updated_at)
       VALUES ($1, 1, NOW())
       ON CONFLICT (user_id) DO UPDATE
         SET count = assistant_probe_flags.count + 1, updated_at = NOW()
       RETURNING count`,
      [userId],
    );
    const count = rows[0]?.count ?? 0;

    if (count > 0 && count % ALERT_THRESHOLD === 0) {
      const botToken = process.env["ADMIN_TELEGRAM_BOT_TOKEN"];
      const chatId = process.env["ADMIN_TELEGRAM_CHAT_ID"];
      if (!botToken || !chatId) return; // not configured — skip silently

      let email = "unknown";
      try {
        const clerkUser = await clerkClient.users.getUser(userId);
        email = clerkUser.emailAddresses[0]?.emailAddress ?? "unknown";
      } catch {
        // best-effort only
      }

      await sendTelegramMessage(
        botToken,
        chatId,
        `⚠️ Terminal Assistant: repeated backend/secret probing detected.\nUser: ${email}\nUser ID: ${userId}\nAttempts so far: ${count}`,
      ).catch((err) => logger.error({ err }, "[assistant] admin alert send failed"));
    }
  } catch (err) {
    logger.error({ err }, "[assistant] probe tracking failed");
  }
}

/** GET /api/assistant/status — public, tells the frontend whether to show the assistant */
router.get("/assistant/status", asyncHandler(async (_req, res) => {
  const [row] = await db.select().from(systemSettingsTable).where(eq(systemSettingsTable.id, 1));
  res.json({ enabled: row?.assistantEnabled ?? true });
}));

/** GET /api/assistant/history — full conversation for the signed-in user */
router.get("/assistant/history", requireAuth, asyncHandler(async (req, res) => {
  const { userId } = getAuth(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }

  const rows = await db
    .select()
    .from(assistantMessagesTable)
    .where(eq(assistantMessagesTable.userId, userId))
    .orderBy(asc(assistantMessagesTable.createdAt));

  res.json(rows.map((r) => ({ id: r.id, role: r.role, content: r.content, feedback: r.feedback })));
}));

/** POST /api/assistant/history — append one message (user or assistant) */
router.post("/assistant/history", requireAuth, asyncHandler(async (req, res) => {
  const { userId } = getAuth(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }

  const { role, content } = req.body ?? {};
  if (
    (role !== "user" && role !== "assistant") ||
    typeof content !== "string" ||
    !content.trim()
  ) {
    res.status(400).json({ error: "Invalid message" });
    return;
  }

  const [inserted] = await db
    .insert(assistantMessagesTable)
    .values({ userId, role, content })
    .returning({ id: assistantMessagesTable.id });

  // Fire-and-forget: never block the chat response on this
  if (role === "user" && looksLikeProbe(content)) {
    trackProbeAttempt(userId).catch(() => {});
  }

  res.json({ success: true, id: inserted?.id });
}));

/** PATCH /api/assistant/history/:id/feedback — thumbs up/down (+ optional note) on one assistant message */
router.patch("/assistant/history/:id/feedback", requireAuth, asyncHandler(async (req, res) => {
  const { userId } = getAuth(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }

  const id = Number(req.params.id);
  const { rating, note } = req.body ?? {};
  if (!Number.isInteger(id) || (rating !== "up" && rating !== "down" && rating !== null)) {
    res.status(400).json({ error: "Invalid feedback" });
    return;
  }
  if (note !== undefined && note !== null && typeof note !== "string") {
    res.status(400).json({ error: "Invalid note" });
    return;
  }

  const [msg] = await db.select().from(assistantMessagesTable).where(eq(assistantMessagesTable.id, id));
  if (!msg || msg.userId !== userId) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  await db
    .update(assistantMessagesTable)
    .set({ feedback: rating, feedbackNote: rating === null ? null : (note ?? null) })
    .where(eq(assistantMessagesTable.id, id));
  res.json({ success: true });
}));

export default router;
