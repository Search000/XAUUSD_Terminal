import { useListTrades, getListTradesQueryKey } from "@workspace/api-client-react";
import { useUser } from "@clerk/react";
import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, TrendingUp, TrendingDown, Minus } from "lucide-react";
import { cn } from "@/lib/utils";

interface DayTrades {
  pnl: number;
  trades: number;
  wins: number;
  losses: number;
}

export function DailyPnlCalendar() {
  const { isLoaded, isSignedIn } = useUser();
  const now = new Date();
  const [viewYear, setViewYear] = useState(now.getFullYear());
  const [viewMonth, setViewMonth] = useState(now.getMonth() + 1);

  const monthStart = `${viewYear}-${String(viewMonth).padStart(2, "0")}-01`;
  const monthEnd = new Date(viewYear, viewMonth, 0).toISOString().slice(0, 10);
  const { data: trades, isLoading } = useListTrades(
    { startDate: monthStart, endDate: monthEnd, limit: 500 },
    { query: { queryKey: getListTradesQueryKey({ startDate: monthStart, endDate: monthEnd, limit: 500 }), enabled: isLoaded && !!isSignedIn } },
  );

  const dayMap = useMemo<Record<string, DayTrades>>(() => {
    const map: Record<string, DayTrades> = {};
    for (const trade of trades ?? []) {
      if (trade.status !== "TP Hit" && trade.status !== "SL Hit") continue;
      const key = trade.tradeDate;
      if (!map[key]) map[key] = { pnl: 0, trades: 0, wins: 0, losses: 0 };
      const pnl = trade.pnl ?? 0;
      map[key].pnl += pnl;
      map[key].trades += 1;
      if (pnl > 0 || trade.status === "TP Hit") map[key].wins += 1;
      else map[key].losses += 1;
    }
    return map;
  }, [trades]);

  const firstOfMonth = new Date(viewYear, viewMonth - 1, 1);
  const daysInMonth = new Date(viewYear, viewMonth, 0).getDate();
  const startDow = (firstOfMonth.getDay() + 6) % 7;
  const calendarDays: (number | null)[] = [
    ...Array(startDow).fill(null),
    ...Array.from({ length: daysInMonth }, (_, index) => index + 1),
  ];
  while (calendarDays.length % 7 !== 0) calendarDays.push(null);

  const monthNames = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
  ];

  function previousMonth() {
    if (viewMonth === 1) {
      setViewMonth(12);
      setViewYear((year) => year - 1);
    } else {
      setViewMonth((month) => month - 1);
    }
  }

  function nextMonth() {
    if (viewMonth === 12) {
      setViewMonth(1);
      setViewYear((year) => year + 1);
    } else {
      setViewMonth((month) => month + 1);
    }
  }

  const closedTrades = (trades ?? []).filter(
    (trade) => trade.status === "TP Hit" || trade.status === "SL Hit",
  );
  const totalPnl = closedTrades.reduce((sum, trade) => sum + (trade.pnl ?? 0), 0);
  const totalWins = closedTrades.filter((trade) => (trade.pnl ?? 0) > 0).length;
  const totalLosses = closedTrades.filter((trade) => (trade.pnl ?? 0) < 0).length;
  const winRate = closedTrades.length > 0 ? (totalWins / closedTrades.length) * 100 : 0;
  const profitDays = Object.values(dayMap).filter((day) => day.pnl > 0).length;
  const lossDays = Object.values(dayMap).filter((day) => day.pnl < 0).length;
  const today = now.toISOString().slice(0, 10);

  const summary = [
    {
      label: "Total P/L",
      value: `${totalPnl >= 0 ? "+" : ""}$${totalPnl.toFixed(2)}`,
      color: totalPnl > 0 ? "text-green-400" : totalPnl < 0 ? "text-red-400" : "text-muted-foreground",
    },
    {
      label: "Win Rate",
      value: `${winRate.toFixed(1)}%`,
      color: winRate >= 50 ? "text-green-400" : "text-red-400",
    },
    { label: "Trades", value: closedTrades.length.toString(), color: "text-foreground" },
    { label: "Profit Days", value: profitDays.toString(), color: "text-green-400" },
    { label: "Loss Days", value: lossDays.toString(), color: "text-red-400" },
  ];

  return (
    <div className="border border-border rounded-lg bg-card overflow-hidden">
      <div className="bg-[#1a5c2a] px-4 py-2 text-xs font-mono font-semibold text-white uppercase tracking-widest">
        Daily P&amp;L Calendar
      </div>

      <div className="p-2 lg:p-3 space-y-2">
        <div className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="text-sm font-bold text-foreground tracking-tight">
            Trade Calendar
          </h2>
          <div className="flex items-center gap-1.5 self-start sm:self-auto">
            <button
              type="button"
              onClick={previousMonth}
              className="p-1 rounded border border-border hover:bg-secondary/50 text-muted-foreground hover:text-foreground transition-colors"
              aria-label="Previous month"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
            </button>
            <span className="font-mono text-xs text-foreground px-2 min-w-[120px] text-center">
              {monthNames[viewMonth - 1]} {viewYear}
            </span>
            <button
              type="button"
              onClick={nextMonth}
              className="p-1 rounded border border-border hover:bg-secondary/50 text-muted-foreground hover:text-foreground transition-colors"
              aria-label="Next month"
            >
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        <div className="grid grid-cols-5 gap-1.5">
          {summary.map((item) => (
            <div key={item.label} className="border border-border rounded bg-secondary/20 px-2 py-1">
              <div className="text-[9px] font-mono uppercase tracking-widest text-muted-foreground">
                {item.label}
              </div>
              <div className={cn("text-sm font-bold font-mono", item.color)}>{item.value}</div>
            </div>
          ))}
        </div>

        <div className="border border-border rounded-lg overflow-hidden">
          <div className="grid grid-cols-7 border-b border-border">
            {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((day) => (
              <div
                key={day}
                className="py-1 text-center text-[9px] font-mono uppercase tracking-widest text-muted-foreground border-r border-border last:border-r-0"
              >
                {day}
              </div>
            ))}
          </div>

          {isLoading ? (
            <div className="p-4 text-center text-xs font-mono text-muted-foreground uppercase tracking-widest">
              Loading calendar...
            </div>
          ) : (
            <div className="grid grid-cols-7">
              {calendarDays.map((day, index) => {
                const key = day
                  ? `${viewYear}-${String(viewMonth).padStart(2, "0")}-${String(day).padStart(2, "0")}`
                  : "";
                const data = key ? dayMap[key] : undefined;
                const isToday = key === today;
                const isFuture = key > today;

                return (
                  <div
                    key={`${key}-${index}`}
                    className={cn(
                      "min-h-[46px] sm:min-h-[58px] p-1 border-r border-b border-border last:border-r-0 transition-colors",
                      !day && "bg-secondary/10",
                      day && !data && !isFuture && "bg-card",
                      day && !data && isFuture && "bg-card opacity-40",
                      data && data.pnl > 0 && "bg-green-500/5 border-green-500/20",
                      data && data.pnl < 0 && "bg-red-500/5 border-red-500/20",
                      data && data.pnl === 0 && "bg-card",
                    )}
                  >
                    {day && (
                      <>
                        <div
                          className={cn(
                            "text-[9px] font-mono mb-0.5 w-4 h-4 flex items-center justify-center rounded-full",
                            isToday ? "bg-primary text-black font-bold" : "text-muted-foreground",
                          )}
                        >
                          {day}
                        </div>
                        {data && (
                          <div className="mt-0.5 space-y-0.5">
                            <div
                              className={cn(
                                "text-[9px] font-bold font-mono truncate",
                                data.pnl > 0 ? "text-green-400" : "text-red-400",
                              )}
                            >
                              {data.pnl > 0 ? "+" : ""}${data.pnl.toFixed(2)}
                            </div>
                            <div className="flex items-center gap-0.5">
                              {data.pnl > 0 ? (
                                <TrendingUp className="w-2.5 h-2.5 text-green-400 shrink-0" />
                              ) : data.pnl < 0 ? (
                                <TrendingDown className="w-2.5 h-2.5 text-red-400 shrink-0" />
                              ) : (
                                <Minus className="w-2.5 h-2.5 text-muted-foreground shrink-0" />
                              )}
                              <span className="text-[8px] font-mono text-muted-foreground truncate">
                                {data.trades}T·{data.wins}W/{data.losses}L
                              </span>
                            </div>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="flex flex-wrap gap-x-4 gap-y-1 text-[9px] font-mono text-muted-foreground">
          <span>
            <i className="inline-block w-3 h-3 rounded-sm bg-green-500/20 border border-green-500/30 mr-2 align-middle" />
            Profit Day
          </span>
          <span>
            <i className="inline-block w-3 h-3 rounded-sm bg-red-500/20 border border-red-500/30 mr-2 align-middle" />
            Loss Day
          </span>
          <span>
            <i className="inline-block w-3 h-3 rounded-sm bg-card border border-border mr-2 align-middle" />
            No Trades
          </span>
        </div>
      </div>
    </div>
  );
}