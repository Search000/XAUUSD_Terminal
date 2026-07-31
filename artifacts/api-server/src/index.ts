import app from "./app";
import { logger } from "./lib/logger";
import { runMigrations } from "./lib/migrate";
import { startScheduler } from "./lib/scheduler";
import { createChatWss } from "./lib/chatWs";
import { liveGoldFeed } from "./lib/liveGoldFeed";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

// ── Prevent unhandled rejections from crashing the process ───────────────────
// Render free tier: a single failed Yahoo Finance fetch must not kill the server
process.on("unhandledRejection", (reason) => {
  logger.error({ reason }, "Unhandled promise rejection — continuing");
});

process.on("uncaughtException", (err) => {
  logger.error({ err }, "Uncaught exception — continuing");
});

// ── Keep-alive (Render free tier spins down after 15 min without INBOUND traffic) ─
// NOTE: We intentionally do NOT self-ping localhost here. Render's spin-down timer
// only resets on inbound traffic that passes through its external routing layer —
// a loopback request from inside the same process never reaches that layer, so it
// does nothing to prevent sleep. Keep-alive is instead handled by an external
// monitor (UptimeRobot) hitting the public /api/healthz endpoint every 5 minutes,
// which keeps the process — and therefore the node-cron scheduler — continuously
// alive so daily/weekly/monthly Telegram reports fire on schedule.

// Run DB migrations before accepting traffic
runMigrations()
  .then(() => {
    const server = app.listen(port, () => {
      logger.info({ port }, "Server listening");
      startScheduler();
      liveGoldFeed.start(); // shared free live price feed for all users
    });
    // Attach WebSocket server for real-time encrypted chat
    createChatWss(server);
    server.on("error", (err) => {
      logger.error({ err }, "Error listening on port");
      process.exit(1);
    });
  })
  .catch((err) => {
    logger.error({ err }, "Startup migration failed — exiting");
    process.exit(1);
  });
