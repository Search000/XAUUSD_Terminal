/**
 * Cron-based auto-notification scheduler.
 *
 * Schedule (all times UTC, default timezone GMT+6):
 *   Daily recap   — every day at 17:00 UTC  = 11:00 PM GMT+6
 *   Weekly report — every Friday at 17:00 UTC
 *   Monthly stmt  — last day of month at 17:00 UTC
 *
 * Risk/drawdown alerts are event-driven (triggered per trade close in trades.ts).
 */

import cron from "node-cron";
import {
  sendDailyRecapToAll,
  sendWeeklyReportToAll,
  sendMonthlyReportToAll,
  sendTrialExpiryReminders,
  sendLicenseExpiryWarnings,
  sendLicenseRenewalReminders,
} from "./notifications";
import { archiveOldPendingTrades } from "./cleanup";
import { logger } from "./logger";

function isLastDayOfMonth(): boolean {
  const now = new Date();
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  return tomorrow.getMonth() !== now.getMonth();
}

export function startScheduler() {
  // ── Daily recap — every day at 17:00 UTC (11 PM GMT+6) ──────────────────
  cron.schedule("0 17 * * *", async () => {
    logger.info("[scheduler] running daily recap");
    await sendDailyRecapToAll().catch((e: unknown) =>
      logger.error({ err: e }, "[scheduler] daily recap error"),
    );
  });

  // ── Weekly report — every Friday at 17:00 UTC ────────────────────────────
  cron.schedule("0 17 * * 5", async () => {
    logger.info("[scheduler] running weekly report");
    await sendWeeklyReportToAll().catch((e: unknown) =>
      logger.error({ err: e }, "[scheduler] weekly report error"),
    );
  });

  // ── Monthly statement — last calendar day at 17:00 UTC ──────────────────
  cron.schedule("0 17 28-31 * *", async () => {
    if (!isLastDayOfMonth()) return;
    logger.info("[scheduler] running monthly statement");
    await sendMonthlyReportToAll().catch((e: unknown) =>
      logger.error({ err: e }, "[scheduler] monthly statement error"),
    );
  });

  // ── Trial expiry reminder — every hour ──────────────────────────────────
  cron.schedule("0 * * * *", async () => {
    await sendTrialExpiryReminders().catch((e: unknown) =>
      logger.error({ err: e }, "[scheduler] trial expiry reminder error"),
    );
  });

  // ── License expiry warning — daily at 09:00 UTC (3 PM GMT+6) ─────────────
  // Warns users 7 days before their license (paid or trial) expires via Telegram + in-app
  cron.schedule("0 9 * * *", async () => {
    logger.info("[scheduler] running license expiry warnings (7-day)");
    await sendLicenseExpiryWarnings().catch((e: unknown) =>
      logger.error({ err: e }, "[scheduler] license expiry warning error"),
    );
  });

  // ── License renewal reminder — daily at 09:05 UTC (3:05 PM GMT+6) ────────
  // Final urgent reminder 3 days before license expiry via Telegram + in-app
  cron.schedule("5 9 * * *", async () => {
    logger.info("[scheduler] running license renewal reminders (3-day)");
    await sendLicenseRenewalReminders().catch((e: unknown) =>
      logger.error({ err: e }, "[scheduler] license renewal reminder error"),
    );
  });

  // ── Nightly cleanup & archiving — daily at 00:00 UTC (6 AM GMT+6) ────────
  // Archives Pending trades older than 30 days (soft-delete: sets archivedAt)
  cron.schedule("0 0 * * *", async () => {
    logger.info("[scheduler] running auto-archive of stale pending trades");
    await archiveOldPendingTrades().catch((e: unknown) =>
      logger.error({ err: e }, "[scheduler] auto-archive error"),
    );
  });

  logger.info("[scheduler] notification jobs scheduled (daily/weekly/monthly/trial-reminder/license-expiry/renewal-reminder/auto-archive)");
}
