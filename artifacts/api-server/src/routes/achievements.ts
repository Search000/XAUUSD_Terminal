import { Router } from "express";
import { getAuth } from "@clerk/express";
import { db } from "@workspace/db";
import { tradesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireAuth } from "../lib/auth";
import { requireLicense } from "../lib/licenseCheck";
import { asyncHandler } from "../lib/asyncHandler";

const router = Router();

interface Badge {
  id: string;
  title: string;
  description: string;
  earned: boolean;
  icon: string;
  earnedAt: string | null;
  progress: number | null;
  target: number | null;
}

/** GET /api/achievements */
router.get("/achievements", requireAuth, requireLicense, asyncHandler(async (req, res) => {
  const { userId } = getAuth(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }

  const trades = await db.select().from(tradesTable).where(eq(tradesTable.userId, userId)).orderBy(tradesTable.tradeDate);

  const closedTrades = trades.filter((t) => t.status === "TP Hit" || t.status === "SL Hit");
  const winTrades = closedTrades.filter((t) => t.pnl ? parseFloat(t.pnl) > 0 : t.status === "TP Hit");
  const totalClosed = closedTrades.length;
  const winRate = totalClosed > 0 ? winTrades.length / totalClosed : 0;

  // Compute monthly growth %
  function getMonthlyGrowthPct(): number {
    const now = new Date();
    const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
    const monthTrades = trades.filter((t) => t.tradeDate >= monthStart);
    if (monthTrades.length === 0) return 0;
    const firstBalance = monthTrades[0].balance ? parseFloat(monthTrades[0].balance) : null;
    const lastBalance = monthTrades[monthTrades.length - 1].balance ? parseFloat(monthTrades[monthTrades.length - 1].balance) : null;
    if (!firstBalance || !lastBalance || firstBalance === 0) return 0;
    return ((lastBalance - firstBalance) / firstBalance) * 100;
  }

  // 7-day streak: consecutive calendar days with at least one trade (from today backward)
  function computeStreak(): number {
    const tradeDays = new Set(trades.map((t) => t.tradeDate));
    let streak = 0;
    const today = new Date();
    for (let i = 0; i < 60; i++) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      const dayStr = d.toISOString().slice(0, 10);
      if (tradeDays.has(dayStr)) { streak++; } else if (streak > 0) { break; }
    }
    return streak;
  }

  const streak = computeStreak();
  const monthlyGrowth = getMonthlyGrowthPct();

  const badges: Badge[] = [
    {
      id: "first_trade",
      title: "First Step",
      description: "Log your very first trade",
      earned: trades.length >= 1,
      icon: "🎯",
      earnedAt: trades.length >= 1 ? trades[0].createdAt.toISOString() : null,
      progress: trades.length >= 1 ? 100 : 0,
      target: 1,
    },
    {
      id: "ten_trades",
      title: "First 10 Trades",
      description: "Log 10 trades total",
      earned: trades.length >= 10,
      icon: "📊",
      earnedAt: trades.length >= 10 ? trades[9].createdAt.toISOString() : null,
      progress: Math.min(100, (trades.length / 10) * 100),
      target: 10,
    },
    {
      id: "fifty_trades",
      title: "50 Trades Logged",
      description: "Log 50 trades to show your dedication",
      earned: trades.length >= 50,
      icon: "🏆",
      earnedAt: trades.length >= 50 ? trades[49].createdAt.toISOString() : null,
      progress: Math.min(100, (trades.length / 50) * 100),
      target: 50,
    },
    {
      id: "hundred_trades",
      title: "Century Club",
      description: "Log 100 trades — a true journaling habit",
      earned: trades.length >= 100,
      icon: "💎",
      earnedAt: trades.length >= 100 ? trades[99].createdAt.toISOString() : null,
      progress: Math.min(100, (trades.length / 100) * 100),
      target: 100,
    },
    {
      id: "streak_3",
      title: "3-Day Streak",
      description: "Trade 3 consecutive days",
      earned: streak >= 3,
      icon: "🔥",
      earnedAt: streak >= 3 ? new Date().toISOString() : null,
      progress: Math.min(100, (streak / 3) * 100),
      target: 3,
    },
    {
      id: "streak_7",
      title: "7-Day Streak",
      description: "Trade 7 consecutive days",
      earned: streak >= 7,
      icon: "⚡",
      earnedAt: streak >= 7 ? new Date().toISOString() : null,
      progress: Math.min(100, (streak / 7) * 100),
      target: 7,
    },
    {
      id: "streak_30",
      title: "30-Day Warrior",
      description: "Trade every day for 30 consecutive days",
      earned: streak >= 30,
      icon: "🛡️",
      earnedAt: streak >= 30 ? new Date().toISOString() : null,
      progress: Math.min(100, (streak / 30) * 100),
      target: 30,
    },
    {
      id: "win_rate_60",
      title: "Profitable Trader",
      description: "Achieve 60% win rate on 10+ closed trades",
      earned: totalClosed >= 10 && winRate >= 0.6,
      icon: "📈",
      earnedAt: totalClosed >= 10 && winRate >= 0.6 ? new Date().toISOString() : null,
      progress: totalClosed >= 10 ? Math.min(100, (winRate / 0.6) * 100) : Math.min(100, (totalClosed / 10) * 100),
      target: null,
    },
    {
      id: "win_rate_70",
      title: "Sharp Shooter",
      description: "Achieve 70% win rate on 20+ closed trades",
      earned: totalClosed >= 20 && winRate >= 0.7,
      icon: "🎯",
      earnedAt: totalClosed >= 20 && winRate >= 0.7 ? new Date().toISOString() : null,
      progress: totalClosed >= 20 ? Math.min(100, (winRate / 0.7) * 100) : Math.min(100, (totalClosed / 20) * 100),
      target: null,
    },
    {
      id: "monthly_return_5",
      title: "5% Monthly Return",
      description: "Achieve 5% account growth in a single month",
      earned: monthlyGrowth >= 5,
      icon: "💰",
      earnedAt: monthlyGrowth >= 5 ? new Date().toISOString() : null,
      progress: Math.min(100, (monthlyGrowth / 5) * 100),
      target: null,
    },
    {
      id: "monthly_return_10",
      title: "10% Monthly Return",
      description: "Achieve 10% account growth in a single month — elite performance",
      earned: monthlyGrowth >= 10,
      icon: "🚀",
      earnedAt: monthlyGrowth >= 10 ? new Date().toISOString() : null,
      progress: Math.min(100, (monthlyGrowth / 10) * 100),
      target: null,
    },
    {
      id: "no_revenge_week",
      title: "Disciplined Week",
      description: "Complete a full week with no Revenge Trade losses",
      earned: (() => {
        const now = new Date();
        const monday = new Date(now);
        monday.setDate(now.getDate() - ((now.getDay() + 6) % 7));
        const weekStart = monday.toISOString().slice(0, 10);
        const weekLosses = trades.filter((t) => t.status === "SL Hit" && t.tradeDate >= weekStart);
        const hasRevenge = weekLosses.some((t) => t.lossReason === "Revenge Trade");
        return weekLosses.length > 0 && !hasRevenge;
      })(),
      icon: "🧘",
      earnedAt: null,
      progress: null,
      target: null,
    },
    {
      id: "mistake_journaler",
      title: "Mistake Journaler",
      description: "Log loss reason on 10 SL Hit trades",
      earned: (() => {
        const tagged = trades.filter((t) => t.status === "SL Hit" && t.lossReason);
        return tagged.length >= 10;
      })(),
      icon: "📓",
      earnedAt: null,
      progress: (() => {
        const tagged = trades.filter((t) => t.status === "SL Hit" && t.lossReason).length;
        return Math.min(100, (tagged / 10) * 100);
      })(),
      target: 10,
    },
  ];

  const totalEarned = badges.filter((b) => b.earned).length;
  res.json({ badges, totalEarned });
}));

export default router;
