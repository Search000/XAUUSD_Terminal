/**
 * Auto-cleanup & archiving jobs.
 *
 * Pending trades older than 30 days are automatically "archived" by setting
 * their status to "Archived". They are NOT deleted. Archived trades are
 * excluded from the active journal (GET /api/trades filters them out by default)
 * but remain in the database for a full audit trail.
 *
 * This approach uses the existing `status` text column — no DB migration needed.
 */

import { db } from "@workspace/db";
import {
  tradesTable,
  notificationsTable,
  telegramSettingsTable,
} from "@workspace/db";
import { eq, and, lt, ne } from "drizzle-orm";
import { broadcastTelegramMessage } from "./telegram";
import { pushNotificationSSE } from "./sseClients";
import pino from "pino";

const logger = pino({ name: "cleanup" });

async function saveNotificationForUser(
  userId: string,
  type: string,
  title: string,
  body: string,
) {
  await db.insert(notificationsTable).values({ userId, type, title, body });
  pushNotificationSSE(userId);
}

// ── Archive old Pending trades ────────────────────────────────────────────────

/**
 * Called nightly by the scheduler.
 * Finds every user's "Pending" trades that are older than 30 days and sets
 * their status to "Archived". Sends an in-app notification and a Telegram
 * message summarising what was archived.
 */
export async function archiveOldPendingTrades(): Promise<void> {
  const now = new Date();
  const cutoff = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000); // 30 days ago

  // Fetch all Pending trades older than 30 days that haven't been archived yet
  const stalePending = await db
    .select()
    .from(tradesTable)
    .where(
      and(
        eq(tradesTable.status, "Pending"),
        lt(tradesTable.createdAt, cutoff),
      )
    );

  if (stalePending.length === 0) {
    logger.info("[cleanup] no stale pending trades to archive");
    return;
  }

  // Group by userId so we can send one notification per user
  const byUser: Record<string, typeof stalePending> = {};
  for (const trade of stalePending) {
    (byUser[trade.userId] ??= []).push(trade);
  }

  for (const [userId, trades] of Object.entries(byUser)) {
    const ids = trades.map((t) => t.id);
    const archiveDate = now.toLocaleDateString("en-US", { dateStyle: "long" });
    const count = ids.length;

    // Bulk-update status to "Archived" for this user's stale trades
    for (const id of ids) {
      await db
        .update(tradesTable)
        .set({ status: "Archived" })
        .where(and(eq(tradesTable.id, id), eq(tradesTable.userId, userId)));
    }

    logger.info(`[cleanup] archived ${count} pending trade(s) for user ${userId}`);

    // ── In-app notification ───────────────────────────────────────────────
    const inAppTitle = `🗂️ ${count} pending trade${count !== 1 ? "s" : ""} auto-archived`;
    const inAppBody =
      `${count} trade${count !== 1 ? "s" : ""} with "Pending" status older than 30 days ` +
      `${count !== 1 ? "have" : "has"} been automatically archived on ${archiveDate}. ` +
      `They are no longer shown in your active journal but remain saved for records.`;

    await saveNotificationForUser(userId, "auto_archive", inAppTitle, inAppBody);

    // ── Telegram notification ─────────────────────────────────────────────
    const [tg] = await db
      .select()
      .from(telegramSettingsTable)
      .where(eq(telegramSettingsTable.userId, userId));

    if (tg?.botToken && tg?.chatId) {
      const msg =
        `╭──────────────────────────────╮\n` +
        ` 🗂️ AUTO ARCHIVE — ${archiveDate}\n` +
        `╰──────────────────────────────╯\n` +
        ` ┌─ SUMMARY\n` +
        ` │ • Archived  : ${count} pending trade${count !== 1 ? "s" : ""}\n` +
        ` │ • Reason    : 30+ days without result\n` +
        ` │ • Status    : Set to "Archived" (not deleted)\n` +
        ` └─────────────\n\n` +
        ` ▸ These trades are no longer shown in your\n` +
        ` ▸ active journal. Records are safely stored.`;

      await broadcastTelegramMessage(tg.botToken, tg.chatId, tg.groupId, msg).catch(
        (e: unknown) => logger.error({ err: e }, "[cleanup] archive telegram failed"),
      );
    }
  }

  logger.info(`[cleanup] archiving complete — ${stalePending.length} trade(s) across ${Object.keys(byUser).length} user(s)`);
}
