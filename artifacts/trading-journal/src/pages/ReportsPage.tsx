import { AppLayout } from "@/components/AppLayout";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useGetWeeklyReport, useGetMonthlyReport, getGetWeeklyReportQueryKey, getGetMonthlyReportQueryKey, useListTrades, getListTradesQueryKey, useResetMonthlyReport } from "@workspace/api-client-react";
import { useUser } from "@clerk/react";
import { DayOfWeekHeatmap } from "@/components/DayOfWeekHeatmap";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { BarChart, Bar, Cell, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from "recharts";
import { cn } from "@/lib/utils";
import { useMemo, useState } from "react";
import { PageLoader, TableLoader } from "@/components/PageLoader";
import { RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

export default function ReportsPage() {
  const { isLoaded, isSignedIn } = useUser();
  const queryClient = useQueryClient();
  const currentMonth = new Date().getMonth() + 1;
  const currentYear = new Date().getFullYear();
  const monthStart = `${currentYear}-${String(currentMonth).padStart(2, '0')}-01`;
  const monthEnd = new Date(currentYear, currentMonth, 0).toISOString().slice(0, 10);

  const resetMutation = useResetMonthlyReport({
    mutation: {
      onSuccess: (data) => {
        queryClient.invalidateQueries({ queryKey: getGetWeeklyReportQueryKey({ month: currentMonth, year: currentYear }) });
        queryClient.invalidateQueries({ queryKey: getGetMonthlyReportQueryKey({ year: currentYear }) });
        queryClient.invalidateQueries({ queryKey: getListTradesQueryKey({ startDate: monthStart, endDate: monthEnd, limit: 500 }) });
        toast.success(`Month reset — ${data.deleted ?? 0} trade(s) deleted`);
      },
      onError: () => toast.error("Reset failed", { description: "Could not reset this month's trades." }),
    },
  });

  const { data: weeklyData, isLoading: weeklyLoading } = useGetWeeklyReport({ month: currentMonth, year: currentYear }, { query: { queryKey: getGetWeeklyReportQueryKey({ month: currentMonth, year: currentYear }), enabled: isLoaded && !!isSignedIn } });
  const { data: monthlyData, isLoading: monthlyLoading } = useGetMonthlyReport({ year: currentYear }, { query: { queryKey: getGetMonthlyReportQueryKey({ year: currentYear }), enabled: isLoaded && !!isSignedIn } });
  const previousYear = currentMonth === 1 ? currentYear - 1 : currentYear;
  const { data: previousMonthlyData } = useGetMonthlyReport({ year: previousYear }, { query: { queryKey: getGetMonthlyReportQueryKey({ year: previousYear }), enabled: isLoaded && !!isSignedIn } });
  const currentMonthRow = monthlyData?.find((row) => row.month === currentMonth);
  const previousMonthRow = previousMonthlyData?.find((row) => row.month === (currentMonth === 1 ? 12 : currentMonth - 1));

  const { data: monthTrades } = useListTrades(
    { startDate: monthStart, endDate: monthEnd, limit: 500 },
    { query: { queryKey: getListTradesQueryKey({ startDate: monthStart, endDate: monthEnd, limit: 500 }), enabled: isLoaded && !!isSignedIn } }
  );

  const sessionData = useMemo(() => {
    const sessions = ['Asia', 'London', 'New York'];
    return sessions.map((session) => {
      const trades = (monthTrades ?? []).filter(t => t.session === session && (t.status === 'TP Hit' || t.status === 'SL Hit'));
      const wins = trades.filter(t => (t.pnl ?? 0) > 0).length;
      const losses = trades.filter(t => (t.pnl ?? 0) <= 0).length;
      const totalPnl = trades.reduce((s, t) => s + (t.pnl ?? 0), 0);
      const totalPips = trades.reduce((s, t) => s + (t.pips ?? 0), 0);
      const winRate = trades.length > 0 ? (wins / trades.length) * 100 : 0;
      return { session, trades: trades.length, wins, losses, winRate, totalPnl, totalPips };
    });
  }, [monthTrades]);

  const customTooltip = ({ active, payload, label }: import("recharts").TooltipProps<number, string>) => {
    if (active && payload && payload.length) {
      return (
        <div className="bg-card border border-border p-3 rounded shadow-xl">
          <p className="font-mono text-sm text-white mb-2">{label}</p>
          {payload.map((p, i: number) => (
            <p key={i} className="font-mono text-sm" style={{ color: p.color }}>
              {p.name}: {p.value} pips
            </p>
          ))}
        </div>
      );
    }
    return null;
  };

  return (
    <AppLayout>
      <div className="container mx-auto p-4 lg:p-8 flex-1 flex flex-col">
        <div className="flex items-center justify-between mb-8">
          <h1 className="text-2xl font-bold text-white tracking-tight">Performance Reports</h1>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="outline" size="sm" className="gap-2 text-destructive border-destructive/40 hover:bg-destructive/10 hover:text-destructive">
                <RotateCcw className="h-4 w-4" />
                Reset Month
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Reset current month's trades?</AlertDialogTitle>
                <AlertDialogDescription>
                  This will permanently delete <strong>all trades</strong> logged in{" "}
                  {new Date().toLocaleDateString("en-US", { month: "long", year: "numeric" })}.
                  This action cannot be undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  className="bg-destructive hover:bg-destructive/90"
                  onClick={() => resetMutation.mutate({ data: {} })}
                  disabled={resetMutation.isPending}
                >
                  {resetMutation.isPending ? "Resetting…" : "Yes, reset month"}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>

        <Tabs defaultValue="weekly" className="flex-1 flex flex-col">
          <TabsList className="bg-card border border-border w-fit">
            <TabsTrigger value="weekly" className="data-[state=active]:bg-secondary data-[state=active]:text-white font-mono text-xs uppercase tracking-widest">Weekly</TabsTrigger>
            <TabsTrigger value="monthly" className="data-[state=active]:bg-secondary data-[state=active]:text-white font-mono text-xs uppercase tracking-widest">Monthly</TabsTrigger>
            <TabsTrigger value="session" className="data-[state=active]:bg-secondary data-[state=active]:text-white font-mono text-xs uppercase tracking-widest">Session</TabsTrigger>
            <TabsTrigger value="heatmap" className="data-[state=active]:bg-secondary data-[state=active]:text-white font-mono text-xs uppercase tracking-widest">Heatmap</TabsTrigger>
          </TabsList>

          <TabsContent value="weekly" className="flex-1 mt-6 space-y-8">
            <div className="border border-border rounded-lg bg-card p-6 h-80">
              {weeklyLoading ? (
                <div className="w-full h-full flex items-center justify-center"><PageLoader message="LOADING CHART..." /></div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={weeklyData?.map(d => ({ name: `W${d.weekNumber}`, netPips: d.netPips })) || []}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#26272E" vertical={false} />
                    <XAxis dataKey="name" stroke="#94A3B8" fontSize={12} tickLine={false} axisLine={false} />
                    <YAxis stroke="#94A3B8" fontSize={12} tickLine={false} axisLine={false} tickFormatter={(val) => `${val}`} />
                    <Tooltip content={customTooltip} cursor={{ fill: '#26272E', opacity: 0.4 }} />
                    <ReferenceLine y={0} stroke="#334155" />
                    <Bar dataKey="netPips" fill="#F59E0B" radius={[4, 4, 0, 0]}>
                      {weeklyData?.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.netPips >= 0 ? '#22C55E' : '#EF4444'} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>

            <div className="border border-border rounded-lg bg-card overflow-hidden">
              <Table>
                <TableHeader className="bg-secondary/50">
                  <TableRow>
                    <TableHead className="font-mono text-xs uppercase tracking-widest text-muted-foreground">Week</TableHead>
                    <TableHead className="font-mono text-xs uppercase tracking-widest text-muted-foreground text-right">Trades</TableHead>
                    <TableHead className="font-mono text-xs uppercase tracking-widest text-muted-foreground text-right">Win Rate</TableHead>
                    <TableHead className="font-mono text-xs uppercase tracking-widest text-muted-foreground text-right">W/L</TableHead>
                    <TableHead className="font-mono text-xs uppercase tracking-widest text-muted-foreground text-right">Net Pips</TableHead>
                    <TableHead className="font-mono text-xs uppercase tracking-widest text-muted-foreground text-right">Growth</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {weeklyLoading ? (
                    <TableLoader colSpan={6} />
                  ) : weeklyData?.length === 0 ? (
                    <TableRow><TableCell colSpan={6} className="h-32 text-center text-muted-foreground">No data available for this month.</TableCell></TableRow>
                  ) : (
                    weeklyData?.map((row) => (
                      <TableRow key={row.weekNumber} className="hover:bg-secondary/20">
                        <TableCell className="font-mono text-sm text-slate-300">W{row.weekNumber} <span className="text-muted-foreground text-xs ml-2">{row.dateRange}</span></TableCell>
                        <TableCell className="font-mono text-sm text-slate-300 text-right">{row.totalTrades}</TableCell>
                        <TableCell className="font-mono text-sm text-slate-300 text-right">{row.winRate.toFixed(1)}%</TableCell>
                        <TableCell className="font-mono text-sm text-slate-300 text-right">{row.wins}W - {row.losses}L</TableCell>
                        <TableCell className={cn("font-mono text-sm font-medium text-right", row.netPips > 0 ? "text-green-500" : row.netPips < 0 ? "text-red-500" : "text-slate-400")}>
                          {row.netPips > 0 ? '+' : ''}{row.netPips.toFixed(1)}
                        </TableCell>
                        <TableCell className={cn("font-mono text-sm font-medium text-right", (row.growthPct || 0) > 0 ? "text-green-500" : (row.growthPct || 0) < 0 ? "text-red-500" : "text-slate-400")}>
                          {(row.growthPct || 0) > 0 ? '+' : ''}{(row.growthPct || 0).toFixed(2)}%
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </TabsContent>

          <TabsContent value="monthly" className="flex-1 mt-6 space-y-8">
            <div className="border border-border rounded-lg bg-card overflow-hidden">
              <div className="bg-[#1a5c2a] px-4 py-2 text-xs font-mono font-semibold text-white uppercase tracking-widest">Monthly Comparison</div>
              <div className="grid grid-cols-2 divide-x divide-border">
                {[{ label: "This month", row: currentMonthRow }, { label: "Last month", row: previousMonthRow }].map(({ label, row }) => (
                  <div key={label} className="p-4">
                    <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">{label}</div>
                    <div className={cn("mt-2 text-xl font-bold font-mono", (row?.netPips ?? 0) >= 0 ? "text-green-400" : "text-red-400")}>
                      {row ? `${row.netPips >= 0 ? "+" : ""}${row.netPips.toFixed(1)} pips` : "No data"}
                    </div>
                    <div className="mt-2 grid grid-cols-2 gap-2 text-[10px] font-mono text-muted-foreground">
                      <span>Win rate <strong className="text-slate-300">{row ? `${(row.winRate * 100).toFixed(0)}%` : "—"}</strong></span>
                      <span>Trades <strong className="text-slate-300">{row?.totalTrades ?? "—"}</strong></span>
                      <span>Growth <strong className={(row?.growthPct ?? 0) >= 0 ? "text-green-400" : "text-red-400"}>{row ? `${row.growthPct >= 0 ? "+" : ""}${row.growthPct.toFixed(2)}%` : "—"}</strong></span>
                      <span>W/L <strong className="text-slate-300">{row ? `${row.wins}/${row.losses}` : "—"}</strong></span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {monthlyData?.map((row) => (
                <div key={row.month} className="border border-border rounded-lg bg-card p-6 flex flex-col gap-4">
                  <div className="flex justify-between items-center border-b border-border pb-4">
                    <h3 className="font-bold text-white text-xl">{row.monthName}</h3>
                    <span className={cn("font-mono font-bold text-lg", row.netPips > 0 ? "text-green-500" : row.netPips < 0 ? "text-red-500" : "text-slate-400")}>
                      {row.netPips > 0 ? '+' : ''}{row.netPips.toFixed(1)} pips
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-y-4">
                    <div>
                      <div className="font-mono text-xs uppercase tracking-widest text-muted-foreground mb-1">Trades</div>
                      <div className="font-mono text-slate-300">{row.totalTrades}</div>
                    </div>
                    <div>
                      <div className="font-mono text-xs uppercase tracking-widest text-muted-foreground mb-1">Win Rate</div>
                      <div className="font-mono text-slate-300">{row.winRate.toFixed(1)}%</div>
                    </div>
                    <div>
                      <div className="font-mono text-xs uppercase tracking-widest text-muted-foreground mb-1">W/L</div>
                      <div className="font-mono text-slate-300">{row.wins}W - {row.losses}L</div>
                    </div>
                    <div>
                      <div className="font-mono text-xs uppercase tracking-widest text-muted-foreground mb-1">Growth</div>
                      <div className={cn("font-mono font-medium", row.growthPct > 0 ? "text-green-500" : row.growthPct < 0 ? "text-red-500" : "text-slate-300")}>
                        {row.growthPct > 0 ? '+' : ''}{row.growthPct.toFixed(2)}%
                      </div>
                    </div>
                  </div>
                </div>
              ))}
              {(!monthlyData || monthlyData.length === 0) && !monthlyLoading && (
                <div className="col-span-3 h-32 flex items-center justify-center text-muted-foreground border border-border rounded-lg">
                  No monthly data available for {currentYear}.
                </div>
              )}
            </div>

          </TabsContent>

          <TabsContent value="session" className="flex-1 mt-6 space-y-6">
            {/* Session Win Rate Chart */}
            <div className="border border-border rounded-lg bg-card p-6">
              <h2 className="text-sm font-mono uppercase tracking-widest text-muted-foreground mb-6">
                Win Rate by Session — {new Date().toLocaleString('en-US', { month: 'long', year: 'numeric' })}
              </h2>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={sessionData} barSize={48}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#26272E" vertical={false} />
                    <XAxis dataKey="session" stroke="#94A3B8" fontSize={12} tickLine={false} axisLine={false} />
                    <YAxis stroke="#94A3B8" fontSize={12} tickLine={false} axisLine={false} tickFormatter={(v) => v + '%'} domain={[0, 100]} />
                    <Tooltip
                      content={({ active, payload, label }) =>
                        active && payload?.length ? (
                          <div className="bg-card border border-border p-3 rounded shadow-xl">
                            <p className="font-mono text-sm text-white mb-1">{label}</p>
                            <p className="font-mono text-sm text-amber-400">Win Rate: {(payload[0]?.value as number)?.toFixed(1)}%</p>
                          </div>
                        ) : null
                      }
                      cursor={{ fill: '#26272E', opacity: 0.4 }}
                    />
                    <ReferenceLine y={50} stroke="#F59E0B" strokeDasharray="4 4" strokeOpacity={0.5} />
                    <Bar dataKey="winRate" radius={[4, 4, 0, 0]}>
                      {sessionData.map((entry) => (
                        <Cell
                          key={entry.session}
                          fill={entry.winRate >= 50 ? '#22c55e' : entry.winRate >= 40 ? '#F59E0B' : '#ef4444'}
                        />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <p className="text-[10px] font-mono text-muted-foreground mt-3">Dashed line = 50% win rate target</p>
            </div>

            {/* Session Stats Table */}
            <div className="border border-border rounded-lg bg-card overflow-hidden">
              <table className="w-full text-xs font-mono">
                <thead>
                  <tr className="border-b border-border bg-secondary/30">
                    {['Session', 'Trades', 'Wins', 'Losses', 'Win Rate', 'Net Pips', 'Net P/L'].map(h => (
                      <th key={h} className="px-4 py-3 text-left text-muted-foreground uppercase tracking-widest font-medium">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sessionData.map((row) => (
                    <tr key={row.session} className="border-b border-border/50 hover:bg-secondary/10">
                      <td className="px-4 py-3 text-white font-semibold">{row.session}</td>
                      <td className="px-4 py-3 text-slate-300">{row.trades}</td>
                      <td className="px-4 py-3 text-green-400">{row.wins}</td>
                      <td className="px-4 py-3 text-red-400">{row.losses}</td>
                      <td className="px-4 py-3">
                        <span className={cn(
                          'font-bold',
                          row.winRate >= 50 ? 'text-green-400' : row.winRate >= 40 ? 'text-amber-400' : row.trades > 0 ? 'text-red-400' : 'text-slate-500'
                        )}>
                          {row.trades > 0 ? row.winRate.toFixed(1) + '%' : '—'}
                        </span>
                      </td>
                      <td className={cn('px-4 py-3 font-bold', row.totalPips > 0 ? 'text-green-400' : row.totalPips < 0 ? 'text-red-400' : 'text-slate-400')}>
                        {row.trades > 0 ? (row.totalPips > 0 ? '+' : '') + row.totalPips.toFixed(1) : '—'}
                      </td>
                      <td className={cn('px-4 py-3 font-bold', row.totalPnl > 0 ? 'text-green-400' : row.totalPnl < 0 ? 'text-red-400' : 'text-slate-400')}>
                        {row.trades > 0 ? (row.totalPnl >= 0 ? '+$' : '-$') + Math.abs(row.totalPnl).toFixed(2) : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {sessionData.every(s => s.trades === 0) && (
                <div className="py-12 text-center text-muted-foreground font-mono text-sm">
                  No closed trades this month
                </div>
              )}
            </div>
          </TabsContent>

          <TabsContent value="heatmap" className="mt-6">
            <DayOfWeekHeatmap />
          </TabsContent>

        </Tabs>
      </div>
    </AppLayout>
  );
}
