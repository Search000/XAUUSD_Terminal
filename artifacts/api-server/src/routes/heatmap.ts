import { Router } from "express";
import { getAuth } from "@clerk/express";
import { db } from "@workspace/db";
import { tradesTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { requireAuth } from "../lib/auth";
import { requireLicense } from "../lib/licenseCheck";
import { asyncHandler } from "../lib/asyncHandler";

const router = Router();

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** GET /api/heatmap/dayofweek */
router.get("/heatmap/dayofweek", requireAuth, requireLicense, asyncHandler(async (req, res) => {
  const { userId } = getAuth(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }

  const trades = await db
    .select()
    .from(tradesTable)
    .where(and(
      eq(tradesTable.userId, userId),
    ));

  const closedTrades = trades.filter(
    (t) => t.status === "TP Hit" || t.status === "SL Hit"
  );

  const stats: Record<number, {
    dayIndex: number;
    tradeCount: number;
    wins: number;
    losses: number;
    totalPnl: number;
  }> = {};

  for (let i = 0; i < 7; i++) {
    stats[i] = { dayIndex: i, tradeCount: 0, wins: 0, losses: 0, totalPnl: 0 };
  }

  for (const trade of closedTrades) {
    const [y, m, d] = trade.tradeDate.split("-").map(Number);
    const date = new Date(y, m - 1, d);
    const dow = date.getDay();
    const pnl = trade.pnl ? parseFloat(trade.pnl) : 0;
    const isWin = pnl > 0 || trade.status === "TP Hit";

    stats[dow].tradeCount += 1;
    stats[dow].totalPnl += pnl;
    if (isWin) stats[dow].wins += 1;
    else stats[dow].losses += 1;
  }

  const ordered = [1, 2, 3, 4, 5, 6, 0].map((dow) => {
    const s = stats[dow];
    return {
      day: DAY_NAMES[dow],
      dayIndex: dow,
      tradeCount: s.tradeCount,
      wins: s.wins,
      losses: s.losses,
      totalPnl: parseFloat(s.totalPnl.toFixed(2)),
      avgPnl: s.tradeCount > 0 ? parseFloat((s.totalPnl / s.tradeCount).toFixed(2)) : 0,
      winRate: s.tradeCount > 0 ? parseFloat((s.wins / s.tradeCount).toFixed(4)) : 0,
    };
  });

  res.json(ordered);
}));

export default router;
