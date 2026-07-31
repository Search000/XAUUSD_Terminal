import { Router } from "express";
import { getAuth } from "@clerk/express";
import { db } from "@workspace/db";
import { tradesTable, investorsTable, licensesTable } from "@workspace/db";
import { eq, and, gte, lte } from "drizzle-orm";
import { requireAuth } from "../lib/auth";
import { requireLicense } from "../lib/licenseCheck";
import { asyncHandler } from "../lib/asyncHandler";

const router = Router();

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

function monthRange(): { start: string; end: string } {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const start = `${y}-${m}-01`;
  const lastDay = new Date(y, now.getMonth() + 1, 0).getDate();
  const end = `${y}-${m}-${String(lastDay).padStart(2, "0")}`;
  return { start, end };
}

/** GET /api/dashboard/daily */
router.get("/dashboard/daily", requireAuth, requireLicense, asyncHandler(async (req, res) => {
  const { userId } = getAuth(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }

  const today = todayStr();
  const trades = await db
    .select()
    .from(tradesTable)
    .where(and(eq(tradesTable.userId, userId), eq(tradesTable.tradeDate, today)));

  const closedTrades = trades.filter((t) => t.status === "TP Hit" || t.status === "SL Hit");
  const wins = closedTrades.filter((t) => (t.pnl ? parseFloat(t.pnl) > 0 : t.status === "TP Hit")).length;
  const losses = closedTrades.filter((t) => (t.pnl ? parseFloat(t.pnl) < 0 : t.status === "SL Hit")).length;

  const plusPips = trades.filter((t) => t.pips && parseFloat(t.pips) > 0).reduce((s, t) => s + parseFloat(t.pips!), 0);
  const minusPips = trades.filter((t) => t.pips && parseFloat(t.pips) < 0).reduce((s, t) => s + parseFloat(t.pips!), 0);
  const netPips = plusPips + minusPips;

  const investors = await db.select().from(investorsTable).where(eq(investorsTable.userId, userId));
  const totalInvestment = investors.reduce((s, inv) => s + parseFloat(inv.investmentAmount), 0);

  const sortedTrades = [...trades].sort((a, b) => a.id - b.id);
  const startBalance = sortedTrades.length > 0 && sortedTrades[0].balance
    ? parseFloat(sortedTrades[0].balance)
    : totalInvestment;

  const totalPnl = closedTrades.reduce((s, t) => s + (t.pnl ? parseFloat(t.pnl) : 0), 0);
  const currentBalance = startBalance + totalPnl;
  const growthPct = startBalance > 0 ? (totalPnl / startBalance) * 100 : 0;

  res.json({
    date: today,
    totalTrades: closedTrades.length,
    wins,
    losses,
    winRate: closedTrades.length > 0 ? wins / closedTrades.length : 0,
    plusPips: parseFloat(plusPips.toFixed(2)),
    minusPips: parseFloat(minusPips.toFixed(2)),
    netPips: parseFloat(netPips.toFixed(2)),
    startBalance: parseFloat(startBalance.toFixed(2)),
    currentBalance: parseFloat(currentBalance.toFixed(2)),
    growthPct: parseFloat(growthPct.toFixed(4)),
    isOffDay: closedTrades.length === 0,
  });
}));

function currentWeekRange(): { start: string; end: string; weekNumber: number } {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth() + 1;

  const firstDay = new Date(y, m - 1, 1);
  const lastDay  = new Date(y, m, 0);
  const weeks: { start: string; end: string; week: number }[] = [];
  let cursor  = new Date(firstDay);
  let weekNum = 1;
  while (cursor <= lastDay) {
    const weekStart = new Date(cursor);
    const daysToFriday = (5 - cursor.getDay() + 7) % 7;
    const weekEnd = new Date(cursor);
    weekEnd.setDate(cursor.getDate() + daysToFriday);
    if (weekEnd > lastDay) weekEnd.setTime(lastDay.getTime());
    weeks.push({
      week:  weekNum++,
      start: weekStart.toISOString().slice(0, 10),
      end:   weekEnd.toISOString().slice(0, 10),
    });
    cursor = new Date(weekEnd);
    cursor.setDate(cursor.getDate() + 3);
    const toMon = (1 - cursor.getDay() + 7) % 7;
    if (toMon > 0) cursor.setDate(cursor.getDate() + toMon);
  }

  const todayISO = now.toISOString().slice(0, 10);
  let current = weeks.find((w) => todayISO >= w.start && todayISO <= w.end);
  if (!current) current = weeks[weeks.length - 1];

  return { start: current.start, end: current.end, weekNumber: current.week };
}

/** GET /api/dashboard/weekly */
router.get("/dashboard/weekly", requireAuth, requireLicense, asyncHandler(async (req, res) => {
  const { userId } = getAuth(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }

  const { start, end, weekNumber } = currentWeekRange();
  const trades = await db
    .select()
    .from(tradesTable)
    .where(and(eq(tradesTable.userId, userId), gte(tradesTable.tradeDate, start), lte(tradesTable.tradeDate, end)));

  const closedTrades = trades.filter((t) => t.status === "TP Hit" || t.status === "SL Hit");
  const wins = closedTrades.filter((t) => (t.pnl ? parseFloat(t.pnl) > 0 : t.status === "TP Hit")).length;
  const losses = closedTrades.filter((t) => (t.pnl ? parseFloat(t.pnl) < 0 : t.status === "SL Hit")).length;

  const winPips = trades.filter((t) => t.pips && parseFloat(t.pips) > 0).reduce((s, t) => s + parseFloat(t.pips!), 0);
  const lossPips = trades.filter((t) => t.pips && parseFloat(t.pips) < 0).reduce((s, t) => s + parseFloat(t.pips!), 0);

  const investors = await db.select().from(investorsTable).where(eq(investorsTable.userId, userId));
  const totalInvestmentW = investors.reduce((s, inv) => s + parseFloat(inv.investmentAmount), 0);
  const firstTradeW = [...trades].sort((a, b) => a.id - b.id)[0];
  const startBalance = firstTradeW?.balance ? parseFloat(firstTradeW.balance) : totalInvestmentW;
  const totalPnlW = closedTrades.reduce((s, t) => s + (t.pnl ? parseFloat(t.pnl) : 0), 0);
  const endBalance = startBalance + totalPnlW;
  const growthPct = startBalance > 0 ? (totalPnlW / startBalance) * 100 : 0;

  const workDaySet = new Set(trades.map((t) => t.tradeDate));
  let totalWeekdays = 0;
  for (let d = new Date(start + "T00:00:00"); d <= new Date(end + "T00:00:00"); d.setDate(d.getDate() + 1)) {
    const day = d.getDay();
    if (day !== 0 && day !== 6) totalWeekdays++;
  }
  const workDays = workDaySet.size;
  const offDays = Math.max(0, totalWeekdays - workDays);

  res.json({
    weekNumber,
    totalTrades: closedTrades.length,
    wins,
    losses,
    winRate: closedTrades.length > 0 ? wins / closedTrades.length : 0,
    winPips: parseFloat(winPips.toFixed(2)),
    lossPips: parseFloat(lossPips.toFixed(2)),
    netPips: parseFloat((winPips + lossPips).toFixed(2)),
    startBalance: parseFloat(startBalance.toFixed(2)),
    endBalance: parseFloat(endBalance.toFixed(2)),
    growthPct: parseFloat(growthPct.toFixed(4)),
    workDays,
    offDays,
    dateRange: `${start} to ${end}`,
  });
}));

/** GET /api/dashboard/summary */
router.get("/dashboard/summary", requireAuth, asyncHandler(async (req, res) => {
  const { userId } = getAuth(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }

  const { start, end } = monthRange();
  const trades = await db
    .select()
    .from(tradesTable)
    .where(and(eq(tradesTable.userId, userId), gte(tradesTable.tradeDate, start), lte(tradesTable.tradeDate, end)));

  const closedTrades = trades.filter((t) => t.status === "TP Hit" || t.status === "SL Hit");
  const wins = closedTrades.filter((t) => (t.pnl ? parseFloat(t.pnl) > 0 : t.status === "TP Hit")).length;

  const investorsS = await db.select().from(investorsTable).where(eq(investorsTable.userId, userId));
  const totalInvestmentS = investorsS.reduce((s, inv) => s + parseFloat(inv.investmentAmount), 0);
  const firstTradeS = [...trades].sort((a, b) => a.id - b.id)[0];
  const startBalS = firstTradeS?.balance ? parseFloat(firstTradeS.balance) : totalInvestmentS;
  const totalPnlS = closedTrades.reduce((s, t) => s + (t.pnl ? parseFloat(t.pnl) : 0), 0);
  const currentBalance = startBalS + totalPnlS;
  const growthPct = totalInvestmentS > 0 ? ((currentBalance - totalInvestmentS) / totalInvestmentS) * 100 : 0;

  const now = new Date();
  const [license] = await db
    .select()
    .from(licensesTable)
    .where(and(eq(licensesTable.usedByUserId, userId), eq(licensesTable.isActive, true)));

  let licenseStatus = "none";
  let licenseExpiresAt: string | null = null;
  let daysRemaining: number | null = null;

  if (license && !license.isRevoked) {
    const expired = license.expiresAt && license.expiresAt < now;
    licenseStatus = expired ? "expired" : "active";
    licenseExpiresAt = license.expiresAt?.toISOString() ?? null;
    daysRemaining = license.expiresAt
      ? Math.max(0, Math.ceil((license.expiresAt.getTime() - now.getTime()) / (24 * 60 * 60 * 1000)))
      : null;
  }

  res.json({
    currentBalance: parseFloat(currentBalance.toFixed(2)),
    monthlyGrowthPct: parseFloat(growthPct.toFixed(4)),
    totalTradesThisMonth: closedTrades.length,
    monthlyWinRate: closedTrades.length > 0 ? wins / closedTrades.length : 0,
    licenseStatus,
    licenseExpiresAt,
    daysRemaining,
  });
}));

export default router;
