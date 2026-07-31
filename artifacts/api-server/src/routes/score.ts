import { Router } from "express";
import { getAuth } from "@clerk/express";
import { db } from "@workspace/db";
import { tradesTable } from "@workspace/db";
import { eq, and, gte, lte } from "drizzle-orm";
import { requireAuth } from "../lib/auth";
import { requireLicense } from "../lib/licenseCheck";
import { asyncHandler } from "../lib/asyncHandler";

const router = Router();

function getWeekRange(): { weekStart: string; weekEnd: string; prevWeekStart: string; prevWeekEnd: string } {
  const now = new Date();
  const monday = new Date(now);
  monday.setDate(now.getDate() - ((now.getDay() + 6) % 7));
  monday.setHours(0, 0, 0, 0);
  const friday = new Date(monday);
  friday.setDate(monday.getDate() + 4);

  const prevMonday = new Date(monday);
  prevMonday.setDate(monday.getDate() - 7);
  const prevFriday = new Date(friday);
  prevFriday.setDate(friday.getDate() - 7);

  return {
    weekStart: monday.toISOString().slice(0, 10),
    weekEnd: friday.toISOString().slice(0, 10),
    prevWeekStart: prevMonday.toISOString().slice(0, 10),
    prevWeekEnd: prevFriday.toISOString().slice(0, 10),
  };
}

function computeScore(trades: { status: string; pnl: string | null; slPrice: string | null; tpPrice: string | null; entryPrice: string | null; tradeDate: string }[]) {
  const closed = trades.filter((t) => t.status === "TP Hit" || t.status === "SL Hit");
  const wins = closed.filter((t) => (t.pnl ? parseFloat(t.pnl) > 0 : t.status === "TP Hit"));
  const totalClosed = closed.length;
  const winRate = totalClosed > 0 ? wins.length / totalClosed : 0;

  const rrTrades = closed.filter((t) => t.slPrice && t.tpPrice && t.entryPrice);
  const avgRR = rrTrades.length > 0
    ? rrTrades.reduce((sum, t) => {
        const sl = Math.abs(parseFloat(t.entryPrice!) - parseFloat(t.slPrice!));
        const tp = Math.abs(parseFloat(t.tpPrice!) - parseFloat(t.entryPrice!));
        return sum + (sl > 0 ? tp / sl : 1);
      }, 0) / rrTrades.length
    : 0;

  const tradeDays = new Set(trades.map((t) => t.tradeDate)).size;
  const now = new Date();
  const monday = new Date(now);
  monday.setDate(now.getDate() - ((now.getDay() + 6) % 7));
  let weekdays = 0;
  for (let i = 0; i < 5; i++) {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    if (d <= now) weekdays++;
  }
  const consistencyPct = weekdays > 0 ? Math.min(1, tradeDays / weekdays) : 0;

  const winScore = Math.min(1, winRate / 0.7) * 40;
  const rrScore = Math.min(1, avgRR / 2) * 30;
  const consScore = consistencyPct * 30;
  const score = parseFloat((winScore + rrScore + consScore).toFixed(1));

  const grade: "A" | "B" | "C" | "D" | "F" =
    score >= 90 ? "A" :
    score >= 75 ? "B" :
    score >= 60 ? "C" :
    score >= 45 ? "D" : "F";

  return { score, grade, winRate, avgRR, consistencyPct, totalTrades: closed.length };
}

/** GET /api/score/weekly */
router.get("/score/weekly", requireAuth, requireLicense, asyncHandler(async (req, res) => {
  const { userId } = getAuth(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }

  const { weekStart, weekEnd, prevWeekStart, prevWeekEnd } = getWeekRange();

  const [currentTrades, prevTrades] = await Promise.all([
    db.select().from(tradesTable).where(and(
      eq(tradesTable.userId, userId),
      gte(tradesTable.tradeDate, weekStart),
      lte(tradesTable.tradeDate, weekEnd),
    )),
    db.select().from(tradesTable).where(and(
      eq(tradesTable.userId, userId),
      gte(tradesTable.tradeDate, prevWeekStart),
      lte(tradesTable.tradeDate, prevWeekEnd),
    )),
  ]);

  const current = computeScore(currentTrades);
  const prev = computeScore(prevTrades);

  const gradeOrder = ["F", "D", "C", "B", "A"];
  const curIdx = gradeOrder.indexOf(current.grade);
  const prevIdx = gradeOrder.indexOf(prev.grade);
  const gradeChange = prevTrades.length === 0 ? null : curIdx > prevIdx ? "up" : curIdx < prevIdx ? "down" : "same";

  res.json({
    ...current,
    weekStart,
    weekEnd,
    previousGrade: prevTrades.length > 0 ? prev.grade : null,
    gradeChange,
  });
}));

export default router;
