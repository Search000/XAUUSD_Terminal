import { useGetHeatmapByDayOfWeek, getGetHeatmapByDayOfWeekQueryKey } from "@workspace/api-client-react";
import { cn } from "@/lib/utils";

function interpolateColor(pnl: number, maxAbs: number): { bg: string; text: string; border: string } {
  if (maxAbs === 0 || pnl === 0) return { bg: "bg-secondary/30", text: "text-muted-foreground", border: "border-border/40" };
  const ratio = Math.min(Math.abs(pnl) / maxAbs, 1);
  if (pnl > 0) {
    if (ratio > 0.66) return { bg: "bg-green-500/30", text: "text-green-400", border: "border-green-500/40" };
    if (ratio > 0.33) return { bg: "bg-green-500/18", text: "text-green-500", border: "border-green-500/25" };
    return { bg: "bg-green-500/8", text: "text-green-600", border: "border-green-500/15" };
  } else {
    if (ratio > 0.66) return { bg: "bg-red-500/30", text: "text-red-400", border: "border-red-500/40" };
    if (ratio > 0.33) return { bg: "bg-red-500/18", text: "text-red-500", border: "border-red-500/25" };
    return { bg: "bg-red-500/8", text: "text-red-600", border: "border-red-500/15" };
  }
}

export function DayOfWeekHeatmap() {
  const { data, isLoading } = useGetHeatmapByDayOfWeek({
    query: { queryKey: getGetHeatmapByDayOfWeekQueryKey() },
  });

  const maxAbs = Math.max(...(data ?? []).map((d) => Math.abs(d.totalPnl)), 1);
  const totalTrades = (data ?? []).reduce((s, d) => s + d.tradeCount, 0);

  return (
    <div className="bg-card border border-border rounded-xl p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="font-semibold text-white text-base">Day of Week Performance</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            {totalTrades} total closed trades — color intensity = PnL magnitude
          </p>
        </div>
        {/* Legend */}
        <div className="hidden sm:flex items-center gap-3 text-[10px] font-mono text-muted-foreground">
          <div className="flex items-center gap-1.5">
            <div className="w-3 h-3 rounded-sm bg-green-500/30 border border-green-500/40" />
            <span>Profit</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-3 h-3 rounded-sm bg-red-500/30 border border-red-500/40" />
            <span>Loss</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-3 h-3 rounded-sm bg-secondary/30 border border-border/40" />
            <span>No trades</span>
          </div>
        </div>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-7 gap-2">
          {Array.from({ length: 7 }).map((_, i) => (
            <div key={i} className="h-32 rounded-lg bg-secondary/20 animate-pulse" />
          ))}
        </div>
      ) : (
        <>
          {/* Main heatmap grid */}
          <div className="grid grid-cols-7 gap-2">
            {(data ?? []).map((day) => {
              const colors = interpolateColor(day.totalPnl, maxAbs);
              const winPct = day.tradeCount > 0 ? Math.round(day.winRate * 100) : null;
              const noTrades = day.tradeCount === 0;

              return (
                <div
                  key={day.day}
                  className={cn(
                    "relative flex flex-col items-center justify-between rounded-lg border p-3 transition-all duration-200 group cursor-default",
                    colors.bg,
                    colors.border,
                    noTrades && "opacity-50"
                  )}
                  style={{ minHeight: "120px" }}
                >
                  {/* Day label */}
                  <div className="w-full text-center">
                    <span className={cn(
                      "text-[11px] font-mono font-bold uppercase tracking-widest",
                      noTrades ? "text-muted-foreground/60" : "text-white/80"
                    )}>
                      {day.day}
                    </span>
                  </div>

                  {/* Center: PnL */}
                  <div className="flex flex-col items-center gap-0.5 py-2">
                    {noTrades ? (
                      <span className="text-xs text-muted-foreground/40 font-mono">—</span>
                    ) : (
                      <>
                        <span className={cn("text-base font-bold font-mono leading-none", colors.text)}>
                          {day.totalPnl >= 0 ? "+" : ""}{day.totalPnl.toFixed(0)}
                        </span>
                        <span className="text-[9px] font-mono text-muted-foreground/70">USD</span>
                      </>
                    )}
                  </div>

                  {/* Bottom stats */}
                  <div className="w-full space-y-1">
                    {noTrades ? (
                      <p className="text-center text-[9px] font-mono text-muted-foreground/40">no data</p>
                    ) : (
                      <>
                        <div className="flex justify-between text-[9px] font-mono text-muted-foreground/70">
                          <span>{day.tradeCount}T</span>
                          <span className={cn(
                            winPct !== null && winPct >= 50 ? "text-green-500/80" : "text-red-500/80"
                          )}>
                            {winPct}%W
                          </span>
                        </div>
                        {/* Mini bar: wins vs losses */}
                        {day.tradeCount > 0 && (
                          <div className="w-full h-1 bg-secondary/40 rounded-full overflow-hidden">
                            <div
                              className="h-full bg-green-500/60 rounded-full"
                              style={{ width: `${(day.wins / day.tradeCount) * 100}%` }}
                            />
                          </div>
                        )}
                        <div className="flex justify-between text-[9px] font-mono">
                          <span className="text-green-500/70">{day.wins}W</span>
                          <span className="text-red-500/70">{day.losses}L</span>
                        </div>
                      </>
                    )}
                  </div>

                  {/* Tooltip on hover */}
                  {!noTrades && (
                    <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden group-hover:flex flex-col items-center z-10 pointer-events-none">
                      <div className="bg-popover border border-border rounded-lg shadow-xl p-3 text-xs font-mono w-40">
                        <p className="font-bold text-white mb-1">{day.day}</p>
                        <p className="text-muted-foreground">Trades: <span className="text-white">{day.tradeCount}</span></p>
                        <p className="text-muted-foreground">Wins: <span className="text-green-400">{day.wins}</span></p>
                        <p className="text-muted-foreground">Losses: <span className="text-red-400">{day.losses}</span></p>
                        <p className="text-muted-foreground">Win Rate: <span className="text-white">{winPct}%</span></p>
                        <p className="text-muted-foreground">Total P/L: <span className={day.totalPnl >= 0 ? "text-green-400" : "text-red-400"}>${day.totalPnl.toFixed(2)}</span></p>
                        <p className="text-muted-foreground">Avg P/L: <span className={day.avgPnl >= 0 ? "text-green-400" : "text-red-400"}>${day.avgPnl.toFixed(2)}</span></p>
                      </div>
                      <div className="w-2 h-2 border-r border-b border-border rotate-45 bg-popover -mt-1" />
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Summary row */}
          {data && data.some((d) => d.tradeCount > 0) && (
            <div className="mt-4 grid grid-cols-3 gap-3">
              {(() => {
                const sorted = [...data].filter((d) => d.tradeCount > 0).sort((a, b) => b.totalPnl - a.totalPnl);
                const best = sorted[0];
                const worst = sorted[sorted.length - 1];
                const mostActive = [...data].sort((a, b) => b.tradeCount - a.tradeCount)[0];
                return (
                  <>
                    <div className="bg-green-500/8 border border-green-500/20 rounded-lg p-3 text-center">
                      <p className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground mb-1">Best Day</p>
                      <p className="text-sm font-bold text-green-400 font-mono">{best?.day}</p>
                      <p className="text-xs text-green-500/70 font-mono">+${best?.totalPnl.toFixed(2)}</p>
                    </div>
                    <div className="bg-red-500/8 border border-red-500/20 rounded-lg p-3 text-center">
                      <p className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground mb-1">Worst Day</p>
                      <p className="text-sm font-bold text-red-400 font-mono">{worst?.day}</p>
                      <p className="text-xs text-red-500/70 font-mono">${worst?.totalPnl.toFixed(2)}</p>
                    </div>
                    <div className="bg-secondary/30 border border-border/40 rounded-lg p-3 text-center">
                      <p className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground mb-1">Most Active</p>
                      <p className="text-sm font-bold text-white font-mono">{mostActive?.day}</p>
                      <p className="text-xs text-muted-foreground font-mono">{mostActive?.tradeCount} trades</p>
                    </div>
                  </>
                );
              })()}
            </div>
          )}
        </>
      )}
    </div>
  );
}
