import { AppLayout } from "@/components/AppLayout";
import {
  useGetDailyDashboard, getGetDailyDashboardQueryKey,
  useGetWeeklyDashboard, getGetWeeklyDashboardQueryKey,
  useGetWeeklyReport, getGetWeeklyReportQueryKey,
  useGetAccountSettings, getGetAccountSettingsQueryKey,
  useGetTelegramSettings, getGetTelegramSettingsQueryKey,
  useListTrades, getListTradesQueryKey,
  useCreateTrade,
  useGetInvestorShares, getGetInvestorSharesQueryKey,
  TradeInputDirection,
} from "@workspace/api-client-react";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine } from "recharts";
import { Activity, CheckCircle2, Zap, Wallet, TrendingUp, TrendingDown, Flame, CalendarDays, Gauge, ArrowUpRight, Lock } from "lucide-react";
import { useState, useEffect, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useUser } from "@clerk/react";
import { DailyPnlCalendar } from "@/components/DailyPnlCalendar";
import { getAutoSession } from "@/lib/utils";

export default function DashboardPage() {
  const qc = useQueryClient();
  const { isLoaded, isSignedIn } = useUser();
  const now = new Date();
  const currentMonth = now.getMonth() + 1;
  const currentYear  = now.getFullYear();

  const { data: daily, isLoading: dailyLoading, isError: dailyError, error: dailyErr } = useGetDailyDashboard({
    query: {
      queryKey: getGetDailyDashboardQueryKey(),
      enabled: isLoaded && !!isSignedIn,
    },
  });
  const { data: weekly, isLoading: weeklyLoading, isError: weeklyError, error: weeklyErr } = useGetWeeklyDashboard(undefined, {
    query: {
      queryKey: getGetWeeklyDashboardQueryKey(),
      enabled: isLoaded && !!isSignedIn,
    },
  });
  const { data: weeklyReport } = useGetWeeklyReport(
    { month: currentMonth, year: currentYear },
    { query: { queryKey: getGetWeeklyReportQueryKey({ month: currentMonth, year: currentYear }) } },
  );
  const { data: settings } = useGetAccountSettings({ query: { queryKey: getGetAccountSettingsQueryKey() } });
  const { data: tgSettings } = useGetTelegramSettings({ query: { queryKey: getGetTelegramSettingsQueryKey(), enabled: isLoaded && !!isSignedIn } });
  const { data: shares } = useGetInvestorShares({ query: { queryKey: getGetInvestorSharesQueryKey() } });
  const createTrade = useCreateTrade();

  const monthWorkDays = weeklyReport?.reduce((s, w) => s + (w.workDays ?? 0), 0) ?? 0;
  const monthOffDays  = weeklyReport?.reduce((s, w) => s + (w.offDays  ?? 0), 0) ?? 0;

  // Month date range for trade fetch
  const monthStart = `${currentYear}-${String(currentMonth).padStart(2, "0")}-01`;
  const monthEnd   = new Date(currentYear, currentMonth, 0).toISOString().slice(0, 10);

  const { data: monthTrades } = useListTrades(
    { startDate: monthStart, endDate: monthEnd, limit: 500 },
    { query: { queryKey: getListTradesQueryKey({ startDate: monthStart, endDate: monthEnd, limit: 500 }) } },
  );
  const { data: allTrades } = useListTrades(
    { limit: 500 },
    { query: { queryKey: getListTradesQueryKey({ limit: 500 }) } },
  );

  // Balance growth chart data — cumulative daily balance
  const chartData = useMemo(() => {
    if (!monthTrades) return [];
    const investmentBal = shares?.totalInvestment ?? 0;
    const byDate: Record<string, number> = {};
    for (const t of monthTrades) {
      if ((t.status === "TP Hit" || t.status === "SL Hit") && t.pnl) {
        byDate[t.tradeDate] = (byDate[t.tradeDate] ?? 0) + t.pnl;
      }
    }
    const dates = Object.keys(byDate).sort();
    let running = investmentBal;
    return dates.map((d) => {
      running += byDate[d];
      return { date: d.slice(5), balance: parseFloat(running.toFixed(2)) };
    });
  }, [monthTrades, shares]);

  // Best / Worst trade this week
  const { bestTrade, worstTrade } = useMemo(() => {
    const [weekStart, weekEnd] = weekly?.dateRange?.split(" to ") ?? ["", ""];
    const weekTrades = (monthTrades ?? []).filter(
      (t) =>
        (t.status === "TP Hit" || t.status === "SL Hit") &&
        t.pnl != null &&
        t.tradeDate >= weekStart &&
        t.tradeDate <= weekEnd,
    );
    if (!weekTrades.length) return { bestTrade: null, worstTrade: null };
    const sorted = [...weekTrades].sort((a, b) => (b.pnl ?? 0) - (a.pnl ?? 0));
    return { bestTrade: sorted[0], worstTrade: sorted[sorted.length - 1] };
  }, [monthTrades, weekly?.dateRange]);

  // Daily target progress
  const dailyTarget    = settings?.dailyTargetPct ?? 2;
  const growthPct      = daily?.growthPct ?? 0;
  const targetHit      = dailyTarget > 0 && growthPct >= dailyTarget;
  // Bar fill: capped at 100 so it never resets. Use direct comparison (not >=100 on floats).
  const targetProgress = dailyTarget > 0
    ? Math.min(100, Math.max(0, (growthPct / dailyTarget) * 100))
    : 0;

  const closedAllTrades = useMemo(
    () => (allTrades ?? []).filter((trade) => trade.status === "TP Hit" || trade.status === "SL Hit").sort((a, b) => a.tradeDate.localeCompare(b.tradeDate) || a.id - b.id),
    [allTrades],
  );
  const streak = useMemo(() => {
    if (!closedAllTrades.length) return { count: 0, kind: "No streak" };
    const last = closedAllTrades[closedAllTrades.length - 1];
    const lastWon = (last.pnl ?? (last.status === "TP Hit" ? 1 : -1)) > 0;
    let count = 0;
    for (let index = closedAllTrades.length - 1; index >= 0; index -= 1) {
      const trade = closedAllTrades[index];
      const won = (trade.pnl ?? (trade.status === "TP Hit" ? 1 : -1)) > 0;
      if (won !== lastWon) break;
      count += 1;
    }
    return { count, kind: lastWon ? "win" : "loss" };
  }, [closedAllTrades]);
  const averageRR = useMemo(() => {
    const ratios = (allTrades ?? []).flatMap((trade) => {
      if (trade.entryPrice == null || trade.slPrice == null) return [];
      const risk = Math.abs(trade.entryPrice - trade.slPrice);
      if (risk <= 0) return [];
      // Use planned TP if available, otherwise fall back to actual close price
      const rewardRef = trade.tpPrice ?? trade.closePrice;
      if (rewardRef == null) return [];
      const reward = Math.abs(rewardRef - trade.entryPrice);
      return [reward / risk];
    });
    return ratios.length ? ratios.reduce((sum, ratio) => sum + ratio, 0) / ratios.length : 0;
  }, [allTrades]);
  const sessionStats = useMemo(() => {
    const stats = new Map<string, { pnl: number; trades: number }>();
    for (const trade of monthTrades ?? []) {
      if (!trade.session) continue;
      const current = stats.get(trade.session) ?? { pnl: 0, trades: 0 };
      current.pnl += trade.pnl ?? 0;
      current.trades += 1;
      stats.set(trade.session, current);
    }
    return ["Asia", "London", "New York"].map((session) => ({ session, ...(stats.get(session) ?? { pnl: 0, trades: 0 }) }));
  }, [monthTrades]);

  // Drawdown calculation
  const drawdown = useMemo(() => {
    const sorted = closedAllTrades;
    if (!sorted.length) return { maxDrawdownPct: 0, currentDrawdownPct: 0, peakBalance: 0, currentBalance: 0 };
    const startBal = shares?.totalInvestment ?? 1000;
    let running = startBal;
    let peak = startBal;
    let maxDD = 0;
    for (const t of sorted) {
      running += (t.pnl ?? 0);
      if (running > peak) peak = running;
      const dd = peak > 0 ? ((peak - running) / peak) * 100 : 0;
      if (dd > maxDD) maxDD = dd;
    }
    const currentDD = peak > 0 ? ((peak - running) / peak) * 100 : 0;
    return { maxDrawdownPct: maxDD, currentDrawdownPct: currentDD, peakBalance: peak, currentBalance: running };
  }, [closedAllTrades, shares]);

  const winRateTrend = useMemo(() => {
    const dates = Array.from(new Set(closedAllTrades.map((trade) => trade.tradeDate))).slice(-7);
    return dates.map((date) => {
      const dayTrades = closedAllTrades.filter((trade) => trade.tradeDate === date);
      const wins = dayTrades.filter((trade) => (trade.pnl ?? (trade.status === "TP Hit" ? 1 : -1)) > 0).length;
      return { date: date.slice(5), rate: dayTrades.length ? (wins / dayTrades.length) * 100 : 0 };
    });
  }, [closedAllTrades]);

  const [calcRisk, setCalcRisk] = useState("1.0");
  const [calcEntry, setCalcEntry] = useState("");
  const [calcSL, setCalcSL] = useState("");
  const [calcDirection, setCalcDirection] = useState("Long");
  const [calcClose, setCalcClose] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [lotMode, setLotMode] = useState<"auto" | "manual">("auto");
  const [manualLot, setManualLot] = useState("");

  useEffect(() => {
    if (settings?.defaultRiskPct) setCalcRisk(settings.defaultRiskPct.toString());
  }, [settings]);

  // Auto-direction: Entry vs SL
  useEffect(() => {
    const entry = parseFloat(calcEntry);
    const sl    = parseFloat(calcSL);
    if (isNaN(entry) || isNaN(sl) || entry === sl) return;
    setCalcDirection(entry > sl ? "Long" : "Short");
  }, [calcEntry, calcSL]);

  const investorBL = shares?.totalInvestment ?? 0;
  const balance = daily?.currentBalance || investorBL;
  const riskAmount = balance * (parseFloat(calcRisk) / 100);
  const slPips = Math.abs(parseFloat(calcEntry) - parseFloat(calcSL)) * 10;
  const autoLot = !isNaN(slPips) && slPips > 0 ? riskAmount / slPips / 10 : 0;
  const effectiveLot = lotMode === "manual" && manualLot !== "" && !isNaN(parseFloat(manualLot))
    ? parseFloat(manualLot)
    : autoLot;

  const entryN = parseFloat(calcEntry);
  const closeN = parseFloat(calcClose);
  const calcPips = calcClose && !isNaN(entryN) && !isNaN(closeN)
    ? (calcDirection === "Long" ? (closeN - entryN) * 10 : (entryN - closeN) * 10)
    : null;
  const calcPnl = calcPips !== null ? calcPips * effectiveLot * 10 : null;
  const calcStatus = calcClose && !isNaN(closeN)
    ? (calcPnl !== null && calcPnl > 0 ? "TP Hit" : "SL Hit")
    : effectiveLot > 0 ? "Running" : "Pending";

  function resetForm() {
    setCalcEntry(""); setCalcSL(""); setCalcClose(""); setCalcDirection("Long");
    setManualLot("");
    setSubmitted(true);
    setTimeout(() => setSubmitted(false), 2500);
  }

  const canSubmit = calcEntry && calcSL && !isNaN(parseFloat(calcEntry)) && !isNaN(parseFloat(calcSL)) && effectiveLot > 0;

  async function handleLogTrade() {
    if (!canSubmit) return;
    await createTrade.mutateAsync({
      data: {
        tradeDate: new Date().toISOString().split("T")[0],
        direction: calcDirection === "Long" ? TradeInputDirection.Long : TradeInputDirection.Short,
        balance: balance || undefined,
        riskPct: parseFloat(calcRisk) || undefined,
        entryPrice: parseFloat(calcEntry),
        slPrice: parseFloat(calcSL),
        lotSize: parseFloat(effectiveLot.toFixed(2)),
        status: calcStatus,
        closePrice: calcClose && !isNaN(closeN) ? closeN : undefined,
        pips: calcPips !== null ? parseFloat(calcPips.toFixed(2)) : undefined,
        pnl: calcPnl !== null ? parseFloat(calcPnl.toFixed(2)) : undefined,
        session: getAutoSession(),
      },
    });
    // Invalidate all dashboard + trades cache
    await qc.invalidateQueries({ queryKey: getGetDailyDashboardQueryKey() });
    await qc.invalidateQueries({ queryKey: getGetWeeklyDashboardQueryKey() });
    await qc.invalidateQueries({ queryKey: getListTradesQueryKey() });
    resetForm();
  }

  const fmt = (v?: number, d = 2) => (v ?? 0).toFixed(d);
  const pct = (v?: number) => `${fmt(v)}%`;

  // ── Risk warning banner — show when daily loss exceeds threshold ────────────
  const lossThreshold = parseFloat(String(tgSettings?.lossThresholdPct ?? 6));
  const dailyGrowthPct = daily?.growthPct ?? 0;
  const riskLimitBreached = dailyGrowthPct < 0 && Math.abs(dailyGrowthPct) >= lossThreshold;

  return (
    <AppLayout>
      <div className="container mx-auto p-3 lg:p-6 flex-1 flex flex-col xl:flex-row gap-4">

        {/* ── MAIN DASHBOARD AREA ── */}
        <div className="flex-1 min-w-0 space-y-4">

          {/* ── AUTO RISK WARNING BANNER ── */}
          {riskLimitBreached && (
            <div className="border border-red-500/50 rounded-lg bg-red-500/10 p-4 flex items-start gap-3">
              <span className="text-xl shrink-0">⚠️</span>
              <div className="flex-1 min-w-0">
                <p className="font-mono text-sm font-bold text-red-400 uppercase tracking-widest mb-1">
                  Daily Loss Limit Exceeded
                </p>
                <p className="font-mono text-xs text-slate-300">
                  Today's P&amp;L is <strong className="text-red-400">{dailyGrowthPct.toFixed(2)}%</strong> — your daily loss limit is <strong className="text-red-300">{lossThreshold}%</strong>. Stop trading for today to protect your capital.
                </p>
              </div>
            </div>
          )}

          {/* ── WEEKLY DASHBOARD ── */}
          <div className="border border-border rounded-lg bg-card overflow-hidden">
            <div className="bg-green-950 px-4 py-2 text-xs font-mono font-semibold text-white uppercase tracking-widest">
              Weekly Dashboard
            </div>
            {weeklyLoading ? (
              <div className="p-4 flex items-center gap-2">
                <Activity className="w-4 h-4 text-primary animate-pulse" />
                <span className="text-xs font-mono text-muted-foreground uppercase tracking-widest">Loading...</span>
              </div>
            ) : weeklyError ? (
              <div className="p-4 text-xs font-mono text-red-400 uppercase tracking-widest">
                {(weeklyErr as { status?: number })?.status === 403 ? "License required — activate your terminal to view data." : "Failed to load weekly data. Please refresh."}
              </div>
            ) : (
              <div className="overflow-x-auto">
              <table className="w-full text-xs font-mono min-w-[340px]">
                <tbody>
                  <tr className="border-b border-border bg-secondary/20">
                    <td className="px-4 py-2 text-muted-foreground font-medium uppercase tracking-widest">Total Trades</td>
                    <td className="px-4 py-2 text-muted-foreground font-medium uppercase tracking-widest">Total Wins</td>
                    <td className="px-4 py-2 text-muted-foreground font-medium uppercase tracking-widest">Total Loss</td>
                    <td className="px-4 py-2 text-muted-foreground font-medium uppercase tracking-widest text-right">Win Rate (%)</td>
                  </tr>
                  <tr className="border-b border-border">
                    <td className="px-4 py-2.5 text-white font-bold text-base">{weekly?.totalTrades ?? 0}</td>
                    <td className="px-4 py-2.5 text-green-500 font-bold text-base">{weekly?.wins ?? 0}</td>
                    <td className="px-4 py-2.5 text-red-500 font-bold text-base">{weekly?.losses ?? 0}</td>
                    <td className="px-4 py-2.5 text-white font-bold text-right">{pct(weekly?.winRate)}</td>
                  </tr>
                  <tr className="border-b border-border/50 bg-secondary/10">
                    <td className="px-4 py-2 text-muted-foreground uppercase tracking-widest" colSpan={3}>Total + PIPS</td>
                    <td className="px-4 py-2 text-green-500 font-bold text-right">{fmt(weekly?.winPips)}</td>
                  </tr>
                  <tr className="border-b border-border/50 bg-secondary/10">
                    <td className="px-4 py-2 text-muted-foreground uppercase tracking-widest" colSpan={3}>Total - PIPS</td>
                    <td className="px-4 py-2 text-red-500 font-bold text-right">{fmt(weekly?.lossPips)}</td>
                  </tr>
                  <tr className="bg-secondary/10">
                    <td className="px-4 py-2 text-muted-foreground uppercase tracking-widest" colSpan={3}>Net Profit</td>
                    <td className={`px-4 py-2 font-bold text-right ${(weekly?.netPips ?? 0) >= 0 ? "text-green-500" : "text-red-500"}`}>
                      {(weekly?.netPips ?? 0) >= 0 ? "+" : ""}{fmt(weekly?.netPips)}
                    </td>
                  </tr>
                </tbody>
              </table>
              </div>
            )}
          </div>

          {/* ── DAILY DASHBOARD ── */}
          <div className="border border-border rounded-lg bg-card overflow-hidden">
            <div className="bg-green-950 px-4 py-2 text-xs font-mono font-semibold text-white uppercase tracking-widest">
              Daily Dashboard
            </div>
            {dailyLoading ? (
              <div className="p-4 flex items-center gap-2">
                <Activity className="w-4 h-4 text-primary animate-pulse" />
                <span className="text-xs font-mono text-muted-foreground uppercase tracking-widest">Loading...</span>
              </div>
            ) : dailyError ? (
              <div className="p-4 text-xs font-mono text-red-400 uppercase tracking-widest">
                {(dailyErr as { status?: number })?.status === 403 ? "License required — activate your terminal to view data." : "Failed to load daily data. Please refresh."}
              </div>
            ) : (
              <div className="overflow-x-auto">
              <table className="w-full text-xs font-mono min-w-[420px]">
                <tbody>
                  <tr className="border-b border-border bg-secondary/20">
                    <td className="px-4 py-2 text-muted-foreground font-medium uppercase tracking-widest w-1/4">Total Trades</td>
                    <td className="px-4 py-2"></td>
                    <td className="px-4 py-2 text-muted-foreground font-medium uppercase tracking-widest w-1/4">Total Wins</td>
                    <td className="px-4 py-2"></td>
                    <td className="px-4 py-2 text-muted-foreground font-medium uppercase tracking-widest w-1/4">Total Loss</td>
                    <td className="px-4 py-2"></td>
                    <td className="px-4 py-2 text-muted-foreground font-medium uppercase tracking-widest text-right">Win Rate (%)</td>
                  </tr>
                  <tr className="border-b border-border">
                    <td className="px-4 py-2.5 text-white font-bold text-lg">{daily?.totalTrades ?? 0}</td>
                    <td></td>
                    <td className="px-4 py-2.5 text-green-500 font-bold text-lg">{daily?.wins ?? 0}</td>
                    <td></td>
                    <td className="px-4 py-2.5 text-red-500 font-bold text-lg">{daily?.losses ?? 0}</td>
                    <td></td>
                    <td className="px-4 py-2.5 text-white font-bold text-right">{pct(daily?.winRate)}</td>
                  </tr>
                  <tr className="border-b border-border bg-secondary/10">
                    <td className="px-4 py-2 text-muted-foreground uppercase tracking-widest" colSpan={4}>Total + PIPS</td>
                    <td className="px-4 py-2 text-green-500 font-bold text-right" colSpan={3}>{fmt(daily?.plusPips)}</td>
                  </tr>
                  <tr className="border-b border-border bg-secondary/10">
                    <td className="px-4 py-2 text-muted-foreground uppercase tracking-widest" colSpan={4}>Total - PIPS</td>
                    <td className="px-4 py-2 text-red-500 font-bold text-right" colSpan={3}>{fmt(daily?.minusPips)}</td>
                  </tr>
                  <tr className="border-b border-border bg-secondary/10">
                    <td className="px-4 py-2 text-muted-foreground uppercase tracking-widest" colSpan={4}>Net Profit</td>
                    <td className={`px-4 py-2 font-bold text-right ${(daily?.netPips ?? 0) >= 0 ? "text-green-500" : "text-red-500"}`} colSpan={3}>
                      {(daily?.netPips ?? 0) >= 0 ? "+" : ""}{fmt(daily?.netPips)}
                    </td>
                  </tr>
                  <tr className="border-b border-border bg-secondary/10">
                    <td className="px-4 py-2 text-muted-foreground uppercase tracking-widest" colSpan={4}>Yesterday last balance</td>
                    <td className="px-4 py-2 text-white font-medium text-right" colSpan={3}>${fmt(daily?.startBalance)}</td>
                  </tr>
                  <tr className="bg-secondary/10">
                    <td className="px-4 py-2 text-muted-foreground uppercase tracking-widest" colSpan={4}>Daily Growth</td>
                    <td className={`px-4 py-2 font-bold text-right ${(daily?.growthPct ?? 0) >= 0 ? "text-green-500" : "text-red-500"}`} colSpan={3}>
                      {(daily?.growthPct ?? 0) >= 0 ? "+" : ""}{pct(daily?.growthPct)}
                    </td>
                  </tr>
                </tbody>
              </table>
              </div>
            )}
          </div>

          {/* ── WORK TRACKER ── */}
          <div className="border border-border rounded-lg bg-card overflow-hidden">
            <div className="bg-green-950 px-3 py-1.5 text-[10px] font-mono font-semibold text-white uppercase tracking-widest">
              Work Tracker
            </div>

            {/* This Week */}
            <div className="px-3 py-1 text-[9px] font-mono text-muted-foreground uppercase tracking-widest border-b border-border/40">
              This Week
            </div>
            <div className="grid grid-cols-2 divide-x divide-border border-b border-border">
              <div className="flex flex-col items-center justify-center py-1.5 gap-0">
                <span className="text-[9px] font-mono text-muted-foreground uppercase tracking-widest">Working Days</span>
                <span className="text-xl font-bold font-mono text-green-400">{weekly?.workDays ?? 0}</span>
                <span className="text-[9px] font-mono text-green-400/60">day{(weekly?.workDays ?? 0) !== 1 ? "s" : ""} traded</span>
              </div>
              <div className="flex flex-col items-center justify-center py-1.5 gap-0">
                <span className="text-[9px] font-mono text-muted-foreground uppercase tracking-widest">Off Days</span>
                <span className="text-xl font-bold font-mono text-yellow-400">{weekly?.offDays ?? 0}</span>
                <span className="text-[9px] font-mono text-yellow-400/60">day{(weekly?.offDays ?? 0) !== 1 ? "s" : ""} rested</span>
              </div>
            </div>

            {/* This Month */}
            <div className="px-3 py-1 text-[9px] font-mono text-muted-foreground uppercase tracking-widest border-b border-border/40">
              This Month
            </div>
            <div className="grid grid-cols-2 divide-x divide-border">
              <div className="flex flex-col items-center justify-center py-1.5 gap-0">
                <span className="text-[9px] font-mono text-muted-foreground uppercase tracking-widest">Working Days</span>
                <span className="text-xl font-bold font-mono text-green-400">{monthWorkDays}</span>
                <span className="text-[9px] font-mono text-green-400/60">day{monthWorkDays !== 1 ? "s" : ""} traded</span>
              </div>
              <div className="flex flex-col items-center justify-center py-1.5 gap-0">
                <span className="text-[9px] font-mono text-muted-foreground uppercase tracking-widest">Off Days</span>
                <span className="text-xl font-bold font-mono text-yellow-400">{monthOffDays}</span>
                <span className="text-[9px] font-mono text-yellow-400/60">day{monthOffDays !== 1 ? "s" : ""} rested</span>
              </div>
            </div>
          </div>

          {/* ── PERFORMANCE SNAPSHOT ── */}
          <div className="border border-border rounded-lg bg-card overflow-hidden">
            <div className="bg-green-950 px-4 py-2 text-xs font-mono font-semibold text-white uppercase tracking-widest">
              Performance Snapshot
            </div>
            <div className="p-3 space-y-3">
              {/* Daily target */}
              <div className="space-y-2">
                <div className="flex justify-between items-center text-xs font-mono">
                  <span className="text-muted-foreground uppercase tracking-widest">Daily Target · Today's Growth</span>
                  <span className={`font-bold ${growthPct >= 0 ? "text-green-400" : "text-red-400"}`}>
                    {growthPct >= 0 ? "+" : ""}{growthPct.toFixed(2)}%
                  </span>
                </div>
                <div className="w-full bg-secondary rounded-full h-2.5 overflow-hidden">
                  <div
                    className={`h-2.5 rounded-full transition-all duration-500 ${
                      growthPct < 0 ? "bg-red-500" : targetHit ? "bg-green-400" : "bg-primary"
                    }`}
                    style={{
                      width: `${
                        growthPct < 0
                          ? Math.min(100, dailyTarget > 0 ? Math.abs(growthPct / dailyTarget) * 100 : 0)
                          : targetProgress
                      }%`,
                    }}
                  />
                </div>
                <div className="flex justify-between items-center text-[10px] font-mono text-muted-foreground">
                  <span>0%</span>
                  <span className={targetHit ? "text-green-400 font-bold" : ""}>
                    {targetHit
                      ? `${growthPct > dailyTarget ? `+${(growthPct - dailyTarget).toFixed(2)}% over!` : "Target Hit!"}`
                      : `Target: ${dailyTarget}%`}
                  </span>
                  <span>{dailyTarget}%</span>
                </div>
              </div>

              {/* Streak, R:R, trend, traded days */}
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 border-t border-border/60 pt-3">
                <div className="border border-border/70 rounded-md bg-secondary/10 p-2.5">
                  <div className="flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-widest text-muted-foreground"><Flame className="w-3.5 h-3.5 text-primary" /> Streak</div>
                  <div className={`mt-1.5 text-xl font-bold font-mono ${streak.kind === "loss" ? "text-red-400" : "text-green-400"}`}>{streak.count}</div>
                  <div className="text-[10px] font-mono text-muted-foreground">{streak.kind === "win" ? "winning trades" : streak.kind === "loss" ? "losing trades" : "closed trades"}</div>
                </div>
                <div className="border border-border/70 rounded-md bg-secondary/10 p-2.5">
                  <div className="flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-widest text-muted-foreground"><Gauge className="w-3.5 h-3.5 text-primary" /> Avg R:R</div>
                  <div className="mt-1.5 text-xl font-bold font-mono text-white">{averageRR ? `1:${averageRR.toFixed(2)}` : "—"}</div>
                  <div className="text-[10px] font-mono text-muted-foreground">risk:reward (tp or close)</div>
                </div>
                <div className="border border-border/70 rounded-md bg-secondary/10 p-2.5">
                  <div className="flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-widest text-muted-foreground"><ArrowUpRight className="w-3.5 h-3.5 text-green-400" /> Win trend</div>
                  <div className="mt-1.5 text-xl font-bold font-mono text-white">{winRateTrend.length ? `${winRateTrend[winRateTrend.length - 1].rate.toFixed(0)}%` : "—"}</div>
                  <div className="text-[10px] font-mono text-muted-foreground">{winRateTrend.length > 1 ? `${winRateTrend[winRateTrend.length - 1].rate >= winRateTrend[0].rate ? "↑ improving" : "↓ cooling"} · 7 sessions` : "not enough data"}</div>
                </div>
                <div className="border border-border/70 rounded-md bg-secondary/10 p-2.5">
                  <div className="flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-widest text-muted-foreground"><CalendarDays className="w-3.5 h-3.5 text-primary" /> Traded days</div>
                  <div className="mt-1.5 text-xl font-bold font-mono text-white">{new Set((monthTrades ?? []).map((trade) => trade.tradeDate)).size}</div>
                  <div className="text-[10px] font-mono text-muted-foreground">this month</div>
                </div>
              </div>

              {/* Drawdown tracker */}
              <div className="border-t border-border/60 pt-3">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[10px] font-mono uppercase tracking-widest text-red-300">Drawdown Tracker</span>
                  <span className="text-[10px] font-mono text-muted-foreground">risk monitor</span>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                  <div className="border border-border/70 rounded-md bg-secondary/10 p-2.5">
                    <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground mb-1">Max Drawdown</div>
                    <div className={`text-lg font-bold font-mono ${drawdown.maxDrawdownPct > 10 ? 'text-red-400' : drawdown.maxDrawdownPct > 5 ? 'text-amber-400' : 'text-green-400'}`}>-{drawdown.maxDrawdownPct.toFixed(2)}%</div>
                    <div className="text-[10px] font-mono text-muted-foreground">peak-to-trough</div>
                  </div>
                  <div className="border border-border/70 rounded-md bg-secondary/10 p-2.5">
                    <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground mb-1">Current Drawdown</div>
                    <div className={`text-lg font-bold font-mono ${drawdown.currentDrawdownPct > 10 ? 'text-red-400' : drawdown.currentDrawdownPct > 5 ? 'text-amber-400' : 'text-green-400'}`}>-{drawdown.currentDrawdownPct.toFixed(2)}%</div>
                    <div className="text-[10px] font-mono text-muted-foreground">from peak</div>
                  </div>
                  <div className="border border-border/70 rounded-md bg-secondary/10 p-2.5">
                    <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground mb-1">Peak Balance</div>
                    <div className="text-lg font-bold font-mono text-white">${drawdown.peakBalance.toFixed(2)}</div>
                    <div className="text-[10px] font-mono text-muted-foreground">all-time high</div>
                  </div>
                  <div className="border border-border/70 rounded-md bg-secondary/10 p-2.5">
                    <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground mb-1">Current Balance</div>
                    <div className={`text-lg font-bold font-mono ${drawdown.currentBalance >= drawdown.peakBalance ? 'text-green-400' : 'text-white'}`}>${drawdown.currentBalance.toFixed(2)}</div>
                    <div className="text-[10px] font-mono text-muted-foreground">running total</div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="w-full">
            <DailyPnlCalendar />
          </div>

          {/* ── SESSION PERFORMANCE ── */}
          <div className="border border-border rounded-lg bg-card overflow-hidden">
            <div className="bg-green-950 px-4 py-2 text-xs font-mono font-semibold text-white uppercase tracking-widest">Session Performance — This Month</div>
            <div className="grid grid-cols-1 sm:grid-cols-3 divide-y sm:divide-y-0 sm:divide-x divide-border">
              {sessionStats.map((item) => <div key={item.session} className="p-4">
                <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">{item.session}</div>
                <div className={`mt-2 text-lg font-bold font-mono ${item.pnl >= 0 ? "text-green-400" : "text-red-400"}`}>{item.pnl >= 0 ? "+" : ""}${item.pnl.toFixed(2)}</div>
                <div className="text-[10px] font-mono text-muted-foreground">{item.trades} trade{item.trades === 1 ? "" : "s"}</div>
              </div>)}
            </div>
          </div>

          {/* ── BEST / WORST TRADE THIS WEEK ── */}
          {(bestTrade || worstTrade) && (
            <div className="border border-border rounded-lg bg-card overflow-hidden">
              <div className="bg-green-950 px-4 py-2 text-xs font-mono font-semibold text-white uppercase tracking-widest">
                Best / Worst Trade — This Week
              </div>
              <div className="grid grid-cols-2 divide-x divide-border">
                <div className="p-4 space-y-1">
                  <div className="flex items-center gap-1.5 mb-2">
                    <TrendingUp className="w-3.5 h-3.5 text-green-400" />
                    <span className="text-[10px] font-mono text-muted-foreground uppercase tracking-widest">Best Trade</span>
                  </div>
                  {bestTrade ? (
                    <>
                      <div className="text-xl font-bold font-mono text-green-400">
                        {(bestTrade.pnl ?? 0) >= 0 ? "+$" : "-$"}{Math.abs(bestTrade.pnl ?? 0).toFixed(2)}
                      </div>
                      <div className="text-[10px] font-mono text-muted-foreground">{bestTrade.tradeDate}</div>
                      <div className="text-[10px] font-mono text-muted-foreground">
                        {bestTrade.direction} · {bestTrade.pips ? `${bestTrade.pips > 0 ? "+" : ""}${bestTrade.pips.toFixed(1)} pips` : "—"}
                      </div>
                    </>
                  ) : <span className="text-xs text-muted-foreground">—</span>}
                </div>
                <div className="p-4 space-y-1">
                  <div className="flex items-center gap-1.5 mb-2">
                    <TrendingDown className="w-3.5 h-3.5 text-red-400" />
                    <span className="text-[10px] font-mono text-muted-foreground uppercase tracking-widest">Worst Trade</span>
                  </div>
                  {worstTrade && worstTrade.id !== bestTrade?.id ? (
                    <>
                      <div className="text-xl font-bold font-mono text-red-400">
                        {(worstTrade.pnl ?? 0) >= 0 ? "+$" : "-$"}{Math.abs(worstTrade.pnl ?? 0).toFixed(2)}
                      </div>
                      <div className="text-[10px] font-mono text-muted-foreground">{worstTrade.tradeDate}</div>
                      <div className="text-[10px] font-mono text-muted-foreground">
                        {worstTrade.direction} · {worstTrade.pips ? `${worstTrade.pips > 0 ? "+" : ""}${worstTrade.pips.toFixed(1)} pips` : "—"}
                      </div>
                    </>
                  ) : <span className="text-xs text-muted-foreground">Only 1 trade this week</span>}
                </div>
              </div>
            </div>
          )}

          {/* ── BALANCE GROWTH CHART ── */}
          {chartData.length > 0 && (
            <div className="border border-border rounded-lg bg-card overflow-hidden">
              <div className="bg-green-950 px-4 py-2 text-xs font-mono font-semibold text-white uppercase tracking-widest">
                Balance Growth — This Month
              </div>
              <div className="p-4">
                <ResponsiveContainer width="100%" height={180}>
                  <LineChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                    <XAxis
                      dataKey="date"
                      tick={{ fontSize: 10, fontFamily: "monospace", fill: "#6b7280" }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <YAxis
                      tick={{ fontSize: 10, fontFamily: "monospace", fill: "#6b7280" }}
                      axisLine={false}
                      tickLine={false}
                      width={60}
                      tickFormatter={(v) => `$${v}`}
                    />
                    <Tooltip
                      contentStyle={{ background: "#1a1a2e", border: "1px solid #2d2d44", borderRadius: 6, fontSize: 11, fontFamily: "monospace" }}
                      labelStyle={{ color: "#9ca3af" }}
                      formatter={(v: number) => [`$${v.toFixed(2)}`, "Balance"]}
                    />
                    <ReferenceLine
                      y={shares?.totalInvestment ?? 0}
                      stroke="#4b5563"
                      strokeDasharray="3 3"
                    />
                    <Line
                      type="monotone"
                      dataKey="balance"
                      stroke="#22c55e"
                      strokeWidth={2}
                      dot={{ r: 3, fill: "#22c55e", strokeWidth: 0 }}
                      activeDot={{ r: 5 }}
                    />
                  </LineChart>
                </ResponsiveContainer>
                <p className="text-[10px] font-mono text-muted-foreground text-center mt-1">
                  Dashed line = investment balance ${(shares?.totalInvestment ?? 0).toFixed(2)}
                </p>
              </div>
            </div>
          )}

        </div>

        {/* ── RISK ENGINE SIDEBAR — desktop only, mobile has /execution page ── */}
        <div className="hidden xl:flex xl:w-60 shrink-0 flex-col sticky top-0 h-screen overflow-y-auto relative gap-2 py-3">
          <div className="border border-border rounded-lg bg-card overflow-hidden flex flex-col">
            {/* Header */}
            <div className="bg-secondary px-3 py-2 border-b border-border flex items-center gap-2 shrink-0">
              <Zap className="w-3.5 h-3.5 text-primary" />
              <h2 className="font-semibold text-white tracking-tight text-sm">Execution Panel</h2>
            </div>
            {/* Live Balance */}
            <div className="flex items-center justify-between px-3 py-1.5 bg-primary/5 border-b border-border shrink-0">
              <div className="flex items-center gap-1.5">
                <Wallet className="w-3 h-3 text-primary" />
                <span className="text-[10px] font-mono text-muted-foreground uppercase tracking-widest">Balance</span>
              </div>
              <span className="text-xs font-bold font-mono text-white">
                ${balance.toLocaleString(undefined, { minimumFractionDigits: 2 })}
              </span>
            </div>
            <div className="p-2.5 space-y-2 overflow-y-auto">

              {/* Risk % */}
              <div>
                <label className="text-[10px] text-muted-foreground font-mono uppercase tracking-widest mb-0.5 block">Risk %</label>
                <div className="relative">
                  <input
                    type="number"
                    value={calcRisk}
                    onChange={(e) => setCalcRisk(e.target.value)}
                    className="w-full bg-input border border-border rounded px-2.5 py-1.5 text-white font-mono focus:ring-1 focus:ring-primary outline-none text-xs pr-6"
                    placeholder="1.0"
                  />
                  <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground text-xs">%</span>
                </div>
              </div>

              {/* Entry */}
              <div>
                <label className="text-[10px] text-muted-foreground font-mono uppercase tracking-widest mb-0.5 block">Entry Price</label>
                <input
                  type="number"
                  value={calcEntry}
                  onChange={(e) => setCalcEntry(e.target.value)}
                  className="w-full bg-input border border-border rounded px-2.5 py-1.5 text-white font-mono focus:ring-1 focus:ring-primary outline-none text-xs"
                  placeholder="e.g. 3320.00"
                />
              </div>

              {/* SL */}
              <div>
                <label className="text-[10px] text-muted-foreground font-mono uppercase tracking-widest mb-0.5 block">Stop Loss</label>
                <input
                  type="number"
                  value={calcSL}
                  onChange={(e) => setCalcSL(e.target.value)}
                  className="w-full bg-input border border-border rounded px-2.5 py-1.5 text-white font-mono focus:ring-1 focus:ring-primary outline-none text-xs"
                  placeholder="e.g. 3310.00"
                />
              </div>

              {/* Direction */}
              <div>
                <label className="text-[10px] text-muted-foreground font-mono uppercase tracking-widest mb-0.5 block">
                  Direction <span className="text-primary/70 normal-case">(auto)</span>
                </label>
                {calcEntry && calcSL && !isNaN(parseFloat(calcEntry)) && !isNaN(parseFloat(calcSL)) && parseFloat(calcEntry) !== parseFloat(calcSL) ? (
                  <div className="flex h-7 items-center rounded border border-primary/30 bg-primary/5 px-2.5 text-primary font-mono text-xs">
                    {calcDirection} {calcDirection === "Long" ? "↑" : "↓"}
                  </div>
                ) : (
                  <div className="flex h-7 items-center rounded border border-border bg-secondary/20 px-2.5 font-mono text-xs text-muted-foreground/50" />
                )}
              </div>

              {/* Closing Price (optional) */}
              <div>
                <label className="text-[10px] text-muted-foreground font-mono uppercase tracking-widest mb-0.5 block">
                  Closing Price <span className="text-muted-foreground/50 normal-case">(optional)</span>
                </label>
                <input
                  type="number"
                  value={calcClose}
                  onChange={(e) => setCalcClose(e.target.value)}
                  className="w-full bg-input border border-border rounded px-2.5 py-1.5 text-white font-mono focus:ring-1 focus:ring-primary outline-none text-xs"
                  placeholder="Leave blank if open"
                />
              </div>

              {/* ── Auto-calculated results ── */}
              <div className="pt-2 border-t border-dashed border-border space-y-1.5">
                <div className="flex justify-between items-center">
                  <span className="text-[10px] text-muted-foreground font-mono uppercase tracking-widest">Risk Amount</span>
                  <span className="font-mono text-white text-xs">${riskAmount.toFixed(2)}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-[10px] text-muted-foreground font-mono uppercase tracking-widest">SL Pips</span>
                  <span className="font-mono text-white text-xs">{isNaN(slPips) || slPips === 0 ? "0.0" : slPips.toFixed(1)}</span>
                </div>
                {calcPips !== null && (
                  <div className="flex justify-between items-center">
                    <span className="text-[10px] text-muted-foreground font-mono uppercase tracking-widest">Pips</span>
                    <span className={`font-mono text-xs font-bold ${calcPips >= 0 ? "text-green-500" : "text-red-500"}`}>
                      {calcPips >= 0 ? "+" : ""}{calcPips.toFixed(1)}
                    </span>
                  </div>
                )}
                {calcPnl !== null && (
                  <div className="flex justify-between items-center">
                    <span className="text-[10px] text-muted-foreground font-mono uppercase tracking-widest">Trade P/L</span>
                    <span className={`font-mono text-xs font-bold ${calcPnl >= 0 ? "text-green-500" : "text-red-500"}`}>
                      {calcPnl >= 0 ? "+$" : "-$"}{Math.abs(calcPnl).toFixed(2)}
                    </span>
                  </div>
                )}

                {/* Lot size — compact single row */}
                <div className="flex items-center justify-between bg-primary/10 border border-primary/20 rounded px-2.5 py-1.5">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] text-primary/80 font-mono uppercase tracking-widest">Lot</span>
                    <div className="flex rounded overflow-hidden border border-primary/30 text-[9px] font-mono">
                      <button
                        type="button"
                        onClick={() => setLotMode("auto")}
                        className={`px-1.5 py-0.5 transition-colors ${lotMode === "auto" ? "bg-primary text-black font-bold" : "text-primary/70 hover:bg-primary/20"}`}
                      >
                        AUTO
                      </button>
                      <button
                        type="button"
                        onClick={() => setLotMode("manual")}
                        className={`px-1.5 py-0.5 transition-colors ${lotMode === "manual" ? "bg-primary text-black font-bold" : "text-primary/70 hover:bg-primary/20"}`}
                      >
                        MANUAL
                      </button>
                    </div>
                  </div>
                  {lotMode === "auto" ? (
                    <span className="text-base font-bold font-mono text-primary leading-none">
                      {autoLot > 0 ? autoLot.toFixed(2) : "0.00"}
                    </span>
                  ) : (
                    <div className="flex items-center gap-1">
                      {autoLot > 0 && (
                        <span className="text-[9px] text-primary/40 font-mono">auto:{autoLot.toFixed(2)}</span>
                      )}
                      <input
                        type="number"
                        step="0.01"
                        min="0.01"
                        value={manualLot}
                        onChange={(e) => setManualLot(e.target.value)}
                        placeholder={autoLot > 0 ? autoLot.toFixed(2) : "0.00"}
                        className="w-16 text-right text-base font-bold font-mono text-primary bg-transparent border-b border-primary/40 outline-none pb-0 placeholder:text-primary/30"
                      />
                    </div>
                  )}
                </div>

                {/* Status badge */}
                {calcEntry && calcSL && (
                  <div className="flex justify-between items-center">
                    <span className="text-[10px] text-muted-foreground font-mono uppercase tracking-widest">Status</span>
                    <span className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded ${
                      calcStatus === "TP Hit" ? "bg-green-500/20 text-green-400" :
                      calcStatus === "SL Hit" ? "bg-red-500/20 text-red-400" :
                      calcStatus === "Running" ? "bg-blue-500/20 text-blue-400" :
                      "bg-secondary text-muted-foreground"
                    }`}>{calcStatus}</span>
                  </div>
                )}
              </div>

              {/* Submit button */}
              <button
                onClick={handleLogTrade}
                disabled={!canSubmit || createTrade.isPending}
                className={`w-full py-2 rounded font-mono text-xs font-bold uppercase tracking-widest transition-all ${
                  submitted
                    ? "bg-green-600 text-white"
                    : canSubmit
                    ? "bg-primary text-primary-foreground hover:bg-primary/90 active:scale-95"
                    : "bg-secondary text-muted-foreground cursor-not-allowed opacity-50"
                }`}
              >
                {submitted ? (
                  <span className="flex items-center justify-center gap-2">
                    <CheckCircle2 className="w-4 h-4" /> Logged!
                  </span>
                ) : createTrade.isPending ? "Logging..." : "Log Trade →"}
              </button>

            </div>
          </div>

          {/* Specs note */}
          <div className="border border-border rounded-lg bg-card p-2 text-[10px] text-muted-foreground leading-relaxed shrink-0">
            <strong className="text-white block mb-0.5">XAUUSD Specs:</strong>
            1 lot = $10/pip · $1 move = 10 pips · Lot = Risk$ ÷ (SL pips × $10)
          </div>

          {/* ── LOCK OVERLAY — shown when no investment capital set ── */}
          {balance <= 0 && (
            <div className="absolute inset-0 z-20 backdrop-blur-sm bg-background/60 rounded-lg flex items-center justify-center">
              <div className="flex flex-col items-center gap-2 px-4 py-5 rounded-lg border border-border bg-card/90 shadow-lg text-center mx-3">
                <Lock className="w-5 h-5 text-primary" />
                <p className="text-xs font-mono text-muted-foreground uppercase tracking-widest leading-relaxed">
                  Set your Investment Capital<br />
                  <a href="/investors" className="text-primary/80 hover:text-primary underline underline-offset-2 transition-colors">
                    Investors
                  </a>
                  {" "}page to configure
                </p>
              </div>
            </div>
          )}
        </div>

      </div>
    </AppLayout>
  );
}
