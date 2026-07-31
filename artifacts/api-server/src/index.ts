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

// ── Keep-alive self-ping (Render free tier spins down after 15 min idle) ─────
// Pings /api/healthz every 14 minutes so the server never goes to sleep.
// Only runs in production to avoid noise in dev.
function startKeepAlive(serverPort: number) {
  if (process.env["NODE_ENV"] !== "production") return;
  const PING_INTERVAL = 14 * 60 * 1000; // 14 minutes
  setInterval(async () => {
    try {
      const res = await fetch(`http://localhost:${serverPort}/api/healthz`);
      logger.info({ status: res.status }, "Keep-alive ping");
    } catch (err) {
      logger.warn({ err }, "Keep-alive ping failed");
    }
  }, PING_INTERVAL).unref();
}

// Run DB migrations before accepting traffic
runMigrations()
  .then(() => {
    const server = app.listen(port, () => {
      logger.info({ port }, "Server listening");
      startScheduler();
      startKeepAlive(port);
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
