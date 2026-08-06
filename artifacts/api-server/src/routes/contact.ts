import { Router } from "express";
import { db } from "@workspace/db";
import { telegramSettingsTable, contactAttemptsTable, contactConfigTable, usersTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { sendTelegramMessage } from "../lib/telegram";
import { requireAuth } from "../lib/auth";
import { requirePermission } from "../lib/permissions";
import { asyncHandler } from "../lib/asyncHandler";
import { z } from "zod";

const updateContactConfigSchema = z.object({
  limit: z.number({ invalid_type_error: "limit must be a number" }).int("limit must be an integer").min(1, "limit must be at least 1").max(100, "limit must be at most 100"),
});

const router = Router();

/** Get global limit from DB (fallback = 3) */
async function getLimit(): Promise<number> {
  const [cfg] = await db.select().from(contactConfigTable).where(eq(contactConfigTable.id, 1));
  return cfg?.limit ?? 3;
}

/**
 * POST /api/contact  — public
 * Body: { phone: string, email?: string }
 */
router.post("/contact", asyncHandler(async (req, res) => {
  const { phone, email } = req.body as { phone?: string; email?: string };

  if (!phone?.trim()) {
    res.status(400).json({ error: "Phone number is required." });
    return;
  }

  // req.ip is safe here because app.set("trust proxy", 1) is set in app.ts.
  // Express resolves the real client IP from the proxy chain automatically,
  // ignoring any X-Forwarded-For headers the client itself injects.
  const ip = req.ip ?? req.socket.remoteAddress ?? "unknown";

  const limit = await getLimit();

  // Atomic upsert: a plain SELECT-then-UPDATE/INSERT lets two concurrent
  // requests from the same IP both read the same pre-increment count and
  // both pass the limit check (race condition / limit bypass). A single
  // INSERT ... ON CONFLICT DO UPDATE increments the row under Postgres's
  // own row-level locking, so concurrent requests are correctly serialized
  // and each gets a distinct, accurate incremented count.
  const [row] = await db
    .insert(contactAttemptsTable)
    .values({ ip, attempts: 1, lastEmail: email ?? null, lastPhone: phone.trim() })
    .onConflictDoUpdate({
      target: contactAttemptsTable.ip,
      set: {
        attempts: sql`${contactAttemptsTable.attempts} + 1`,
        lastEmail: email ?? sql`${contactAttemptsTable.lastEmail}`,
        lastPhone: phone.trim(),
        lastAt: new Date(),
      },
    })
    .returning();

  const newCount = row.attempts;
  // Count prior to this attempt (matches the pre-increment value the old
  // code checked against `limit`) — preserves identical limit semantics.
  const previousCount = newCount - 1;

  if (previousCount >= limit) {
    res.json({ success: false, limitReached: true });
    return;
  }

  const [settings] = await db
    .select({
      botToken: telegramSettingsTable.botToken,
      chatId: telegramSettingsTable.chatId,
      groupId: telegramSettingsTable.groupId,
    })
    .from(telegramSettingsTable)
    .innerJoin(usersTable, eq(usersTable.userId, telegramSettingsTable.userId))
    .where(eq(usersTable.isAdmin, true))
    .limit(1);
  if (settings?.botToken && settings?.chatId) {
    const text =
      `📞 *License Request*\n\n` +
      `👤 Email: \`${email ?? "Not provided"}\`\n` +
      `📱 Phone: \`${phone.trim()}\`\n` +
      `🌐 IP: \`${ip}\`\n` +
      `🔢 Attempt #${newCount} / ${limit}`;
    try {
      await sendTelegramMessage(settings.botToken, settings.chatId, text);
      if (settings.groupId) {
        await sendTelegramMessage(settings.botToken, settings.groupId, text).catch((err: unknown) => {
          req.log.warn({ err }, "Telegram group notification failed");
        });
      }
    } catch (err) {
      req.log.warn({ err }, "Telegram notification failed for contact request");
    }
  }

  res.json({ success: true, attemptsLeft: Math.max(0, limit - newCount) });
}));

// ─── Admin routes ────────────────────────────────────────────────────────────

/** GET /api/admin/contact-attempts */
router.get("/admin/contact-attempts", requireAuth, requirePermission("manage_contact_requests"), asyncHandler(async (_req, res) => {
  const rows = await db.select().from(contactAttemptsTable).orderBy(contactAttemptsTable.lastAt);
  const limit = await getLimit();
  res.json({ limit, rows });
}));

/** GET /api/admin/contact-config */
router.get("/admin/contact-config", requireAuth, requirePermission("manage_contact_requests"), asyncHandler(async (_req, res) => {
  const limit = await getLimit();
  res.json({ limit });
}));

/** PUT /api/admin/contact-config */
router.put("/admin/contact-config", requireAuth, requirePermission("manage_contact_requests"), asyncHandler(async (req, res) => {
  const parsed = updateContactConfigSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.errors[0]?.message ?? "Invalid request body" });
    return;
  }
  const { limit } = parsed.data;

  const [existing] = await db.select().from(contactConfigTable).where(eq(contactConfigTable.id, 1));
  if (existing) {
    await db.update(contactConfigTable).set({ limit }).where(eq(contactConfigTable.id, 1));
  } else {
    await db.insert(contactConfigTable).values({ id: 1, limit });
  }
  res.json({ limit });
}));

/** DELETE /api/admin/contact-attempts/:ip */
router.delete("/admin/contact-attempts/:ip", requireAuth, requirePermission("manage_contact_requests"), asyncHandler(async (req, res) => {
  const ip = decodeURIComponent(String(req.params.ip));
  await db.delete(contactAttemptsTable).where(eq(contactAttemptsTable.ip, ip));
  res.json({ success: true });
}));

/** DELETE /api/admin/contact-attempts */
router.delete("/admin/contact-attempts", requireAuth, requirePermission("manage_contact_requests"), asyncHandler(async (_req, res) => {
  await db.delete(contactAttemptsTable);
  res.json({ success: true });
}));

export default router;
