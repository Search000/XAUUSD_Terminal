import { Router } from "express";
import { getAuth } from "@clerk/express";
import { db } from "@workspace/db";
import { tradesTable, investorsTable } from "@workspace/db";
import { eq, and, gte, lte } from "drizzle-orm";
import { requireAuth } from "../lib/auth";
import { requireLicense } from "../lib/licenseCheck";
import { asyncHandler } from "../lib/asyncHandler";

const router = Router();

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function weekRanges(year: number, month: number): { start: string; end: string; week: number }[] {
  const firstDay = new Date(year, month - 1, 1);
  const lastDay = new Date(year, month, 0);
  const weeks: { start: string; end: string; week: number }[] = [];
  let cursor = new Date(firstDay);
  let weekNum = 1;
  while (cursor <= lastDay) {
    const weekStart = new Date(cursor);
    const daysToFriday = (5 - cursor.getDay() + 7) % 7;
    const weekEnd = new Date(cursor);
    weekEnd.setDate(cursor.getDate() + daysToFriday);
    if (weekEnd > lastDay) weekEnd.setTime(lastDay.getTime());
    weeks.push({
      week: weekNum++,
      start: weekStart.toISOString().slice(0, 10),
      end: weekEnd.toISOString().slice(0, 10),
    });
    cursor = new Date(weekEnd);
    cursor.setDate(cursor.getDate() + 3);
    if (cursor.getDay() !== 1) {
      const toMon = (1 - cursor.getDay() + 7) % 7;
      cursor.setDate(cursor.getDate() + toMon);
    }
  }
  return weeks;
}

/** GET /api/reports/weekly */
router.get("/reports/weekly", requireAuth, requireLicense, asyncHandler(async (req, res) => {
  const { userId } = getAuth(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }

  const now = new Date();
  const month = parseInt(String(req.query.month ?? now.getMonth() + 1), 10);
  const year = parseInt(String(req.query.year ?? now.getFullYear()), 10);

  const investors = await db.select().from(investorsTable).where(eq(investorsTable.userId, userId));
  let runningBalance = investors.reduce((s, inv) => s + parseFloat(inv.investmentAmount), 0);

  const monthStart = `${year}-${String(month).padStart(2, "0")}-01`;
  const lastDayDate = new Date(year, month, 0);
  const monthEnd = lastDayDate.toISOString().slice(0, 10);

  const allTrades = await db
    .select()
    .from(tradesTable)
    .where(and(eq(tradesTable.userId, userId), gte(tradesTable.tradeDate, monthStart), lte(tradesTable.tradeDate, monthEnd)));

  const weeks = weekRanges(year, month);
  const rows = weeks.map((w) => {
    const weekTrades = allTrades.filter((t) => t.tradeDate >= w.start && t.tradeDate <= w.end);
    const closed = weekTrades.filter((t) => t.status === "TP Hit" || t.status === "SL Hit");
    const wins   = closed.filter((t) => t.pnl ? parseFloat(t.pnl) > 0 : t.status === "TP Hit").length;
    const losses = closed.filter((t) => t.pnl ? parseFloat(t.pnl) < 0 : t.status === "SL Hit").length;
    const winPips = weekTrades.filter((t) => t.pips && parseFloat(t.pips) > 0).reduce((s, t) => s + parseFloat(t.pips!), 0);
    const lossPips = weekTrades.filter((t) => t.pips && parseFloat(t.pips) < 0).reduce((s, t) => s + parseFloat(t.pips!), 0);

    const startBalance = runningBalance;
    const lastTrade = weekTrades.sort((a, b) => b.id - a.id)[0];
    const endBalance = lastTrade?.balance ? parseFloat(lastTrade.balance) : runningBalance;
    runningBalance = endBalance;

    const growthPct = startBalance > 0 ? ((endBalance - startBalance) / startBalance) * 100 : 0;

    const workDays = new Set(weekTrades.map((t) => t.tradeDate)).size;
    let totalWeekdays = 0;
    for (let d = new Date(w.start + "T00:00:00"); d <= new Date(w.end + "T00:00:00"); d.setDate(d.getDate() + 1)) {
      const day = d.getDay();
      if (day !== 0 && day !== 6) totalWeekdays++;
    }
    const offDays = Math.max(0, totalWeekdays - workDays);

    return {
      weekNumber: w.week,
      dateRange: `${w.start} to ${w.end}`,
      totalTrades: closed.length,
      wins,
      losses,
      winRate: closed.length > 0 ? wins / closed.length : 0,
      winPips: parseFloat(winPips.toFixed(2)),
      lossPips: parseFloat(lossPips.toFixed(2)),
      netPips: parseFloat((winPips + lossPips).toFixed(2)),
      startBalance: parseFloat(startBalance.toFixed(2)),
      endBalance: parseFloat(endBalance.toFixed(2)),
      growthPct: parseFloat(growthPct.toFixed(4)),
      workDays,
      offDays,
    };
  });

  res.json(rows);
}));

/** GET /api/reports/monthly */
router.get("/reports/monthly", requireAuth, requireLicense, asyncHandler(async (req, res) => {
  const { userId } = getAuth(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }

  const year = parseInt(String(req.query.year ?? new Date().getFullYear()), 10);
  const investors = await db.select().from(investorsTable).where(eq(investorsTable.userId, userId));
  let runningBalance = investors.reduce((s, inv) => s + parseFloat(inv.investmentAmount), 0);

  const rows = [];
  for (let m = 1; m <= 12; m++) {
    const monthStart = `${year}-${String(m).padStart(2, "0")}-01`;
    const lastDayDate = new Date(year, m, 0);
    const monthEnd = lastDayDate.toISOString().slice(0, 10);

    const trades = await db
      .select()
      .from(tradesTable)
      .where(and(eq(tradesTable.userId, userId), gte(tradesTable.tradeDate, monthStart), lte(tradesTable.tradeDate, monthEnd)));

    if (trades.length === 0 && m > new Date().getMonth() + 1) break;

    const closed = trades.filter((t) => t.status === "TP Hit" || t.status === "SL Hit");
    const wins   = closed.filter((t) => t.pnl ? parseFloat(t.pnl) > 0 : t.status === "TP Hit").length;
    const losses = closed.filter((t) => t.pnl ? parseFloat(t.pnl) < 0 : t.status === "SL Hit").length;
    const winPips = trades.filter((t) => t.pips && parseFloat(t.pips) > 0).reduce((s, t) => s + parseFloat(t.pips!), 0);
    const lossPips = trades.filter((t) => t.pips && parseFloat(t.pips) < 0).reduce((s, t) => s + parseFloat(t.pips!), 0);

    const startBalance = runningBalance;
    const lastTrade = trades.sort((a, b) => b.id - a.id)[0];
    const endBalance = lastTrade?.balance ? parseFloat(lastTrade.balance) : runningBalance;
    runningBalance = endBalance;
    const growthPct = startBalance > 0 ? ((endBalance - startBalance) / startBalance) * 100 : 0;

    const workDays = new Set(trades.map((t) => t.tradeDate)).size;
    let totalWeekdays = 0;
    const mStart = new Date(year, m - 1, 1);
    const mEnd   = new Date(year, m, 0);
    for (let d = new Date(mStart); d <= mEnd; d.setDate(d.getDate() + 1)) {
      const day = d.getDay();
      if (day !== 0 && day !== 6) totalWeekdays++;
    }
    const offDays = Math.max(0, totalWeekdays - workDays);

    rows.push({
      month: m,
      year,
      monthName: MONTH_NAMES[m - 1],
      totalTrades: closed.length,
      wins,
      losses,
      winRate: closed.length > 0 ? wins / closed.length : 0,
      winPips: parseFloat(winPips.toFixed(2)),
      lossPips: parseFloat(lossPips.toFixed(2)),
      netPips: parseFloat((winPips + lossPips).toFixed(2)),
      startBalance: parseFloat(startBalance.toFixed(2)),
      endBalance: parseFloat(endBalance.toFixed(2)),
      growthPct: parseFloat(growthPct.toFixed(4)),
      workDays,
      offDays,
    });
  }

  res.json(rows);
}));

/** POST /api/reports/reset */
router.post("/reports/reset", requireAuth, requireLicense, asyncHandler(async (req, res) => {
  const { userId } = getAuth(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }

  const now = new Date();
  const month = now.getMonth() + 1;
  const year = now.getFullYear();
  const monthStart = `${year}-${String(month).padStart(2, "0")}-01`;
  const lastDayDate = new Date(year, month, 0);
  const monthEnd = lastDayDate.toISOString().slice(0, 10);

  const result = await db
    .delete(tradesTable)
    .where(and(
      eq(tradesTable.userId, userId),
      gte(tradesTable.tradeDate, monthStart),
      lte(tradesTable.tradeDate, monthEnd),
    ))
    .returning({ id: tradesTable.id });

  res.json({ success: true, deleted: result.length });
}));

export default router;
