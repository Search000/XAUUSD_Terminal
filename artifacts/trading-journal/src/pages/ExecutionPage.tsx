import { AppLayout } from "@/components/AppLayout";
import {
  useGetAccountSettings, getGetAccountSettingsQueryKey,
  useGetInvestorShares, getGetInvestorSharesQueryKey,
  useGetDailyDashboard, getGetDailyDashboardQueryKey,
  getGetWeeklyDashboardQueryKey,
  useCreateTrade,
  getListTradesQueryKey,
  TradeInputDirection,
} from "@workspace/api-client-react";
import { Zap, Wallet, CheckCircle2, Lock } from "lucide-react";
import { useState, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useUser } from "@clerk/react";
import { getAutoSession } from "@/lib/utils";

export default function ExecutionPage() {
  const qc = useQueryClient();
  const { isLoaded, isSignedIn } = useUser();

  const { data: settings } = useGetAccountSettings({
    query: { queryKey: getGetAccountSettingsQueryKey(), enabled: isLoaded && !!isSignedIn },
  });
  const { data: shares } = useGetInvestorShares({
    query: { queryKey: getGetInvestorSharesQueryKey(), enabled: isLoaded && !!isSignedIn },
  });
  const { data: daily } = useGetDailyDashboard({
    query: { queryKey: getGetDailyDashboardQueryKey(), enabled: isLoaded && !!isSignedIn },
  });
  const createTrade = useCreateTrade();

  const investorBL = shares?.totalInvestment ?? 0;
  const balance = daily?.currentBalance || investorBL;

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

  useEffect(() => {
    const entry = parseFloat(calcEntry);
    const sl = parseFloat(calcSL);
    if (isNaN(entry) || isNaN(sl) || entry === sl) return;
    setCalcDirection(entry > sl ? "Long" : "Short");
  }, [calcEntry, calcSL]);

  const riskAmount = balance * (parseFloat(calcRisk) / 100);
  const slPips = Math.abs(parseFloat(calcEntry) - parseFloat(calcSL)) * 10;
  const autoLot = !isNaN(slPips) && slPips > 0 ? riskAmount / slPips / 10 : 0;
  const effectiveLot =
    lotMode === "manual" && manualLot !== "" && !isNaN(parseFloat(manualLot))
      ? parseFloat(manualLot)
      : autoLot;

  const entryN = parseFloat(calcEntry);
  const closeN = parseFloat(calcClose);
  const calcPips =
    calcClose && !isNaN(entryN) && !isNaN(closeN)
      ? calcDirection === "Long"
        ? (closeN - entryN) * 10
        : (entryN - closeN) * 10
      : null;
  const calcPnl = calcPips !== null ? calcPips * effectiveLot * 10 : null;
  const calcStatus =
    calcClose && !isNaN(closeN)
      ? calcPnl !== null && calcPnl > 0
        ? "TP Hit"
        : "SL Hit"
      : effectiveLot > 0
      ? "Running"
      : "Pending";

  const canSubmit =
    calcEntry &&
    calcSL &&
    !isNaN(parseFloat(calcEntry)) &&
    !isNaN(parseFloat(calcSL)) &&
    effectiveLot > 0;

  function resetForm() {
    setCalcEntry("");
    setCalcSL("");
    setCalcClose("");
    setCalcDirection("Long");
    setManualLot("");
    setSubmitted(true);
    setTimeout(() => setSubmitted(false), 2500);
  }

  async function handleLogTrade() {
    if (!canSubmit) return;
    await createTrade.mutateAsync({
      data: {
        tradeDate: new Date().toISOString().split("T")[0],
        direction:
          calcDirection === "Long" ? TradeInputDirection.Long : TradeInputDirection.Short,
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
    await qc.invalidateQueries({ queryKey: getGetDailyDashboardQueryKey() });
    await qc.invalidateQueries({ queryKey: getGetWeeklyDashboardQueryKey() });
    await qc.invalidateQueries({ queryKey: getListTradesQueryKey() });
    resetForm();
  }

  return (
    <AppLayout>
      <div className="p-4 max-w-lg mx-auto w-full">
        <div className="border border-border rounded-lg bg-card overflow-hidden relative">
          {/* Header */}
          <div className="bg-secondary px-4 py-3 border-b border-border flex items-center gap-2">
            <Zap className="w-4 h-4 text-primary" />
            <h2 className="font-semibold text-white tracking-tight text-sm">Execution Panel</h2>
          </div>

          {/* Balance */}
          <div className="flex items-center justify-between px-4 py-2.5 bg-primary/5 border-b border-border">
            <div className="flex items-center gap-1.5">
              <Wallet className="w-3.5 h-3.5 text-primary" />
              <span className="text-xs font-mono text-muted-foreground uppercase tracking-widest">Balance</span>
            </div>
            <span className="text-sm font-bold font-mono text-white">
              ${balance.toLocaleString(undefined, { minimumFractionDigits: 2 })}
            </span>
          </div>

          <div className="p-4 space-y-3">
            {/* Risk % */}
            <div>
              <label className="text-xs text-muted-foreground font-mono uppercase tracking-widest mb-1 block">Risk %</label>
              <div className="relative">
                <input
                  type="number"
                  value={calcRisk}
                  onChange={(e) => setCalcRisk(e.target.value)}
                  className="w-full bg-input border border-border rounded px-3 py-2 text-white font-mono focus:ring-1 focus:ring-primary outline-none text-sm pr-8"
                  placeholder="1.0"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">%</span>
              </div>
            </div>

            {/* Entry */}
            <div>
              <label className="text-xs text-muted-foreground font-mono uppercase tracking-widest mb-1 block">Entry Price</label>
              <input
                type="number"
                value={calcEntry}
                onChange={(e) => setCalcEntry(e.target.value)}
                className="w-full bg-input border border-border rounded px-3 py-2 text-white font-mono focus:ring-1 focus:ring-primary outline-none text-sm"
                placeholder="e.g. 3320.00"
              />
            </div>

            {/* SL */}
            <div>
              <label className="text-xs text-muted-foreground font-mono uppercase tracking-widest mb-1 block">Stop Loss</label>
              <input
                type="number"
                value={calcSL}
                onChange={(e) => setCalcSL(e.target.value)}
                className="w-full bg-input border border-border rounded px-3 py-2 text-white font-mono focus:ring-1 focus:ring-primary outline-none text-sm"
                placeholder="e.g. 3310.00"
              />
            </div>

            {/* Direction */}
            <div>
              <label className="text-xs text-muted-foreground font-mono uppercase tracking-widest mb-1 block">
                Direction <span className="text-primary/70 normal-case">(auto)</span>
              </label>
              {calcEntry && calcSL && !isNaN(parseFloat(calcEntry)) && !isNaN(parseFloat(calcSL)) && parseFloat(calcEntry) !== parseFloat(calcSL) ? (
                <div className="flex h-10 items-center rounded border border-primary/30 bg-primary/5 px-3 text-primary font-mono text-sm">
                  {calcDirection} {calcDirection === "Long" ? "↑" : "↓"}
                </div>
              ) : (
                <div className="flex h-10 items-center rounded border border-border bg-secondary/20 px-3 font-mono text-xs text-muted-foreground/50" />
              )}
            </div>

            {/* Closing Price */}
            <div>
              <label className="text-xs text-muted-foreground font-mono uppercase tracking-widest mb-1 block">
                Closing Price <span className="text-muted-foreground/50 normal-case">(optional)</span>
              </label>
              <input
                type="number"
                value={calcClose}
                onChange={(e) => setCalcClose(e.target.value)}
                className="w-full bg-input border border-border rounded px-3 py-2 text-white font-mono focus:ring-1 focus:ring-primary outline-none text-sm"
                placeholder="Leave blank if open"
              />
            </div>

            {/* Results */}
            <div className="pt-3 border-t border-dashed border-border space-y-2">
              <div className="flex justify-between items-center">
                <span className="text-xs text-muted-foreground font-mono uppercase tracking-widest">Risk Amount</span>
                <span className="font-mono text-white text-sm">${riskAmount.toFixed(2)}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-xs text-muted-foreground font-mono uppercase tracking-widest">SL Pips</span>
                <span className="font-mono text-white text-sm">{isNaN(slPips) || slPips === 0 ? "0.0" : slPips.toFixed(1)}</span>
              </div>
              {calcPips !== null && (
                <div className="flex justify-between items-center">
                  <span className="text-xs text-muted-foreground font-mono uppercase tracking-widest">Pips</span>
                  <span className={`font-mono text-sm font-bold ${calcPips >= 0 ? "text-green-500" : "text-red-500"}`}>
                    {calcPips >= 0 ? "+" : ""}{calcPips.toFixed(1)}
                  </span>
                </div>
              )}
              {calcPnl !== null && (
                <div className="flex justify-between items-center">
                  <span className="text-xs text-muted-foreground font-mono uppercase tracking-widest">Trade P/L</span>
                  <span className={`font-mono text-sm font-bold ${calcPnl >= 0 ? "text-green-500" : "text-red-500"}`}>
                    {calcPnl >= 0 ? "+$" : "-$"}{Math.abs(calcPnl).toFixed(2)}
                  </span>
                </div>
              )}

              {/* Lot Size */}
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

              {/* Status */}
              {calcEntry && calcSL && (
                <div className="flex justify-between items-center">
                  <span className="text-xs text-muted-foreground font-mono uppercase tracking-widest">Status</span>
                  <span className={`text-xs font-mono font-bold px-2 py-0.5 rounded ${
                    calcStatus === "TP Hit" ? "bg-green-500/20 text-green-400" :
                    calcStatus === "SL Hit" ? "bg-red-500/20 text-red-400" :
                    calcStatus === "Running" ? "bg-blue-500/20 text-blue-400" :
                    "bg-secondary text-muted-foreground"
                  }`}>{calcStatus}</span>
                </div>
              )}
            </div>

            {/* Submit */}
            <button
              onClick={handleLogTrade}
              disabled={!canSubmit || createTrade.isPending}
              className={`w-full py-2.5 rounded font-mono text-sm font-bold uppercase tracking-widest transition-all ${
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

          {/* Specs */}
          <div className="border-t border-border px-4 py-3 text-xs text-muted-foreground leading-relaxed">
            <strong className="text-white block mb-1">XAUUSD Specs:</strong>
            1 lot = $10/pip · $1 move = 10 pips · Lot = Risk$ ÷ (SL pips × $10)
          </div>

          {/* Lock overlay */}
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
