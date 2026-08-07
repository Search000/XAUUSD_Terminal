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

// Chat messages are encrypted with a key derived from SESSION_SECRET. If
// this is unset in production, chatEncryption.ts would silently fall back
// to a hardcoded key baked into the source — anyone with source/DB access
// could then decrypt every chat message, past and future. Fail loudly at
// startup instead of running silently insecure.
if (process.env["NODE_ENV"] === "production" && !process.env["SESSION_SECRET"]) {
  throw new Error(
    "SESSION_SECRET environment variable is required in production (used to derive the chat encryption key). Set it in the Render dashboard.",
  );
}

// Clerk auth silently no-ops on undefined keys instead of throwing, which
// would let the API boot into a broken, unauthenticated-looking state.
// Fail loudly at startup instead of discovering this via 401s in prod.
if (process.env["NODE_ENV"] === "production") {
  if (!process.env["CLERK_PUBLISHABLE_KEY"]) {
    throw new Error(
      "CLERK_PUBLISHABLE_KEY environment variable is required in production. Set it in the Render dashboard.",
    );
  }
  if (!process.env["CLERK_SECRET_KEY"]) {
    throw new Error(
      "CLERK_SECRET_KEY environment variable is required in production. Set it in the Render dashboard.",
    );
  }
  // An empty ALLOWED_ORIGINS silently blocks every credentialed
  // cross-origin request from the journal/admin frontends (see cors()
  // config in app.ts) — no crash, just broken CORS in the browser. Fail
  // startup instead of shipping that silently.
  if (!process.env["ALLOWED_ORIGINS"]?.trim()) {
    throw new Error(
      "ALLOWED_ORIGINS environment variable is required in production (comma-separated list of allowed frontend origins). Set it in the Render dashboard.",
    );
  }
}

// ── Prevent unhandled rejections from crashing the process ───────────────────
// Render free tier: a single failed Yahoo Finance fetch must not kill the server
process.on("unhandledRejection", (reason) => {
  logger.error({ reason }, "Unhandled promise rejection — continuing");
});

process.on("uncaughtException", (err) => {
  // Node's internal state can be corrupted after an uncaught exception —
  // continuing risks serving corrupt/partial state or running
  // security-sensitive operations incorrectly. Log and exit; Render
  // restarts the process automatically.
  logger.error({ err }, "Uncaught exception — exiting for restart");
  process.exit(1);
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
