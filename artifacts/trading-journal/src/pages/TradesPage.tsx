import { AppLayout } from "@/components/AppLayout";
import { useListTrades, getListTradesQueryKey, useCreateTrade, useUpdateTrade, useDeleteTrade, TradeDirection, TradeStatus, Trade, useGetInvestorShares, getGetInvestorSharesQueryKey, getGetDailyDashboardQueryKey } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { useQueryClient } from "@tanstack/react-query";
import { useUser } from "@clerk/react";
import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { Plus, Pencil, Trash2, Zap, Download, Search, X, RotateCcw, CheckCircle2, Lock, Share2, ChevronLeft, ChevronRight } from "lucide-react";
import { TradeShareCard } from "@/components/TradeShareCard";
import { TableLoader } from "@/components/PageLoader";
import { cn, getAutoSession } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";
import { ToastAction } from "@/components/ui/toast";

const PAGE_SIZE = 50;

const LOSS_REASONS = [
  "FOMO",
  "Revenge Trade",
  "News",
  "Wrong SL Placement",
  "Overtrading",
  "No Trading Plan",
  "Poor Entry Timing",
  "Market Conditions",
  "Early Exit",
  "Other",
] as const;

const tradeSchema = z.object({
  tradeDate: z.string().min(1, "Date is required"),
  balance: z.coerce.number().optional().nullable(),
  riskPct: z.coerce.number().optional().nullable(),
  direction: z.enum([TradeDirection.Long, TradeDirection.Short]),
  status: z.enum([TradeStatus.Pending, TradeStatus.Running, TradeStatus.TP_Hit, TradeStatus.SL_Hit]),
  entryPrice: z.coerce.number().optional().nullable(),
  slPrice: z.coerce.number().optional().nullable(),
  tpPrice: z.coerce.number().optional().nullable(),
  lotSize: z.coerce.number().optional().nullable(),
  closePrice: z.coerce.number().optional().nullable(),
  pips: z.coerce.number().optional().nullable(),
  pnl: z.coerce.number().optional().nullable(),
  tags: z.string().optional().nullable(),
  session: z.enum(["Asia", "London", "New York"]).optional().nullable(),
  notes: z.string().optional().nullable(),
  lossReason: z.string().optional().nullable(),
});

type TradeFormValues = z.infer<typeof tradeSchema>;


function formatTradeDate(value: string) {
  const [year, month, day] = value.split("-");
  return year && month && day ? `${Number(month)}/${Number(day)}/${year}` : value;
}

function formatTradeNumber(value: number | null | undefined, maximumFractionDigits = 2) {
  return value == null ? "-" : value.toLocaleString("en-US", { maximumFractionDigits, useGrouping: false });
}

export default function TradesPage() {
  const { isLoaded, isSignedIn } = useUser();
  const { data: shares } = useGetInvestorShares({ query: { queryKey: getGetInvestorSharesQueryKey(), enabled: isLoaded && !!isSignedIn } });
  const hasBalance = (shares?.totalInvestment ?? 0) > 0;
  const { data: trades, isLoading } = useListTrades({ query: { enabled: isLoaded && !!isSignedIn } });
  const [editingTrade, setEditingTrade] = useState<Trade | null>(null);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [sharingTrade, setSharingTrade] = useState<Trade | null>(null);
  const [search, setSearch] = useState("");
  const [tagFilter, setTagFilter] = useState("All");
  const [sessionFilter, setSessionFilter] = useState("All");
  const [page, setPage] = useState(0);
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<number | null>(null);
  const undoRef = useRef<{ trade: Trade; timerId: ReturnType<typeof setTimeout> } | null>(null);
  const queryClient = useQueryClient();

  const isAnyFilterActive = search.trim() !== "" || tagFilter !== "All" || sessionFilter !== "All";

  const resetFilters = () => {
    setSearch("");
    setTagFilter("All");
    setSessionFilter("All");
    setPage(0);
  };

  const createTrade = useCreateTrade({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListTradesQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetDailyDashboardQueryKey() });
        setIsDialogOpen(false);
        toast({ title: "Trade logged", description: "New trade has been saved successfully." });
      },
      onError: (err: unknown) => {
        const msg = (err as { message?: string })?.message ?? "Failed to save trade. Please try again.";
        toast({ title: "Save failed", description: msg, variant: "destructive" });
      },
    }
  });

  const updateTrade = useUpdateTrade({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListTradesQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetDailyDashboardQueryKey() });
        setIsDialogOpen(false);
        setEditingTrade(null);
        toast({ title: "Trade updated", description: "Your changes have been saved." });
      },
      onError: (err: unknown) => {
        const msg = (err as { message?: string })?.message ?? "Failed to update trade. Please try again.";
        toast({ title: "Update failed", description: msg, variant: "destructive" });
      },
    }
  });

  const deleteTrade = useDeleteTrade({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListTradesQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetDailyDashboardQueryKey() });
        setConfirmingDeleteId(null);
      },
      onError: (err: unknown) => {
        const msg = (err as { message?: string })?.message ?? "Failed to delete trade. Please try again.";
        toast({ title: "Delete failed", description: msg, variant: "destructive" });
      },
    }
  });

  const restoreTrade = useCreateTrade({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListTradesQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetDailyDashboardQueryKey() });
        toast({ title: "Trade restored", description: "The trade record has been recovered." });
      },
      onError: () => {
        toast({ title: "Restore failed", description: "Could not restore the trade. Please try again.", variant: "destructive" });
      },
    }
  });

  const handleDeleteTrade = (trade: Trade) => {
    if (undoRef.current) {
      clearTimeout(undoRef.current.timerId);
      undoRef.current = null;
    }
    deleteTrade.mutate({ id: trade.id });
    setConfirmingDeleteId(null);

    const { dismiss } = toast({
      title: "Trade deleted",
      description: "The record has been removed.",
      action: (
        <ToastAction
          altText="Undo delete"
          onClick={() => {
            if (undoRef.current) {
              clearTimeout(undoRef.current.timerId);
              undoRef.current = null;
            }
            restoreTrade.mutate({
              data: {
                tradeDate: trade.tradeDate,
                balance: trade.balance ?? undefined,
                riskPct: trade.riskPct ?? undefined,
                direction: trade.direction,
                status: trade.status,
                entryPrice: trade.entryPrice ?? undefined,
                slPrice: trade.slPrice ?? undefined,
                tpPrice: trade.tpPrice ?? undefined,
                lotSize: trade.lotSize ?? undefined,
                closePrice: trade.closePrice ?? undefined,
                pips: trade.pips ?? undefined,
                pnl: trade.pnl ?? undefined,
                tags: trade.tags ?? undefined,
                session: trade.session ?? undefined,
                notes: trade.notes ?? undefined,
              }
            });
            dismiss();
          }}
        >
          Undo
        </ToastAction>
      ),
    });

    const timerId = setTimeout(() => { undoRef.current = null; }, 8000);
    undoRef.current = { trade, timerId };
  };

  const form = useForm<TradeFormValues>({
    resolver: zodResolver(tradeSchema),
    defaultValues: {
      tradeDate: new Date().toISOString().split('T')[0],
      balance: null, riskPct: null,
      direction: TradeDirection.Long,
      status: TradeStatus.Pending,
      entryPrice: null, slPrice: null, tpPrice: null,
      lotSize: 0.1, closePrice: null,
      pips: null, pnl: null,
      tags: "", session: null, notes: "", lossReason: null,
    }
  });
  const watchedStatus = useWatch({ control: form.control, name: "status" });
  const isSLHit = watchedStatus === TradeStatus.SL_Hit;

  const watchedEntry = useWatch({ control: form.control, name: "entryPrice" });
  const watchedSL    = useWatch({ control: form.control, name: "slPrice" });
  const watchedTP    = useWatch({ control: form.control, name: "tpPrice" });
  const watchedClose = useWatch({ control: form.control, name: "closePrice" });
  const watchedLot   = useWatch({ control: form.control, name: "lotSize" });

  useEffect(() => {
    const entry = Number(watchedEntry), sl = Number(watchedSL);
    if (!watchedEntry || !watchedSL || isNaN(entry) || isNaN(sl) || entry === sl) return;
    form.setValue("direction", entry > sl ? TradeDirection.Long : TradeDirection.Short, { shouldDirty: false });
  }, [watchedEntry, watchedSL]);

  useEffect(() => {
    const entry = Number(watchedEntry), sl = Number(watchedSL), tp = Number(watchedTP),
          close = Number(watchedClose), lot = Number(watchedLot);
    const dir = form.getValues("direction");
    if (!watchedClose || isNaN(close) || !watchedEntry || isNaN(entry)) return;
    const isLong = dir === TradeDirection.Long;
    const pips = isLong ? (close - entry) * 10 : (entry - close) * 10;
    form.setValue("pips", parseFloat(pips.toFixed(1)), { shouldDirty: false });
    if (lot && !isNaN(lot)) form.setValue("pnl", parseFloat((pips * lot * 10).toFixed(2)), { shouldDirty: false });
    let status: TradeStatus;
    if (watchedTP && !isNaN(tp)) {
      const hitTP = isLong ? close >= tp : close <= tp;
      const hitSL = watchedSL && !isNaN(sl) ? (isLong ? close <= sl : close >= sl) : false;
      status = hitTP ? TradeStatus.TP_Hit : hitSL ? TradeStatus.SL_Hit : TradeStatus.Running;
    } else if (watchedSL && !isNaN(sl)) {
      status = (isLong ? close <= sl : close >= sl) ? TradeStatus.SL_Hit : TradeStatus.Running;
    } else {
      status = pips > 0 ? TradeStatus.TP_Hit : TradeStatus.SL_Hit;
    }
    form.setValue("status", status, { shouldDirty: false });
  }, [watchedClose, watchedEntry, watchedSL, watchedTP, watchedLot]);

  const onSubmit = (values: TradeFormValues) => {
    if (editingTrade) updateTrade.mutate({ id: editingTrade.id, data: values });
    else createTrade.mutate({ data: values });
  };

  const blankForm = (): TradeFormValues => ({
    tradeDate: new Date().toISOString().split('T')[0],
    balance: null, riskPct: null,
    direction: TradeDirection.Long, status: TradeStatus.Running,
    entryPrice: null, slPrice: null, tpPrice: null,
    lotSize: 0.1, closePrice: null, pips: null, pnl: null,
    tags: "", session: getAutoSession(), notes: "", lossReason: null,
  });

  const openNewTrade = () => {
    setEditingTrade(null);
    form.reset(blankForm());
    setIsDialogOpen(true);
  };

  const openEditTrade = (trade: Trade) => {
    setEditingTrade(trade);
    form.reset({
      tradeDate: trade.tradeDate,
      balance: trade.balance, riskPct: trade.riskPct,
      direction: trade.direction, status: trade.status,
      entryPrice: trade.entryPrice, slPrice: trade.slPrice, tpPrice: trade.tpPrice,
      lotSize: trade.lotSize, closePrice: trade.closePrice,
      pips: trade.pips ?? null, pnl: trade.pnl ?? null,
      tags: trade.tags ?? "", session: trade.session ?? null, notes: trade.notes,
      lossReason: (trade as Trade & { lossReason?: string | null }).lossReason ?? null,
    });
    setIsDialogOpen(true);
  };

  const fEntry = Number(watchedEntry), fClose = Number(watchedClose), fLot = Number(watchedLot);
  const fDir   = useWatch({ control: form.control, name: "direction" });
  const isLong = fDir === TradeDirection.Long;
  const autoPips = (watchedClose && watchedEntry && !isNaN(fClose) && !isNaN(fEntry))
    ? (isLong ? (fClose - fEntry) * 10 : (fEntry - fClose) * 10) : null;
  const autoPnl = autoPips !== null && fLot ? autoPips * fLot * 10 : null;

  const availableTags = useMemo(() => {
    const tags = new Set<string>();
    (trades ?? []).forEach((t) =>
      (t.tags ?? "").split(",").map((tag) => tag.trim()).filter(Boolean).forEach((tag) => tags.add(tag))
    );
    return Array.from(tags).sort();
  }, [trades]);

  const filteredTrades = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return (trades ?? []).filter((trade) => {
      const matchesSearch = !needle || [
        trade.tradeDate, trade.direction, trade.status, trade.tags ?? "", trade.session ?? "", trade.notes ?? "",
      ].join(" ").toLowerCase().includes(needle);
      const matchesTag = tagFilter === "All" || (trade.tags ?? "").split(",").map((t) => t.trim()).includes(tagFilter);
      const matchesSession = sessionFilter === "All" || trade.session === sessionFilter;
      return matchesSearch && matchesTag && matchesSession;
    });
  }, [trades, search, tagFilter, sessionFilter]);

  // Reset to page 0 whenever filters change
  useEffect(() => { setPage(0); }, [search, tagFilter, sessionFilter]);

  const totalPages  = Math.max(1, Math.ceil(filteredTrades.length / PAGE_SIZE));
  const pagedTrades = filteredTrades.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  const goTo = useCallback((p: number) => setPage(Math.max(0, Math.min(p, totalPages - 1))), [totalPages]);

  function downloadPdf() {
    const date = new Date().toISOString().slice(0, 10);
    const headers = ["Date", "Dir", "Status", "Entry", "SL", "TP", "Lots", "Pips", "PnL", "Risk %", "Session", "Tags", "Notes"];
    const rows = filteredTrades.map((t) => [
      t.tradeDate, t.direction, t.status,
      t.entryPrice, t.slPrice, t.tpPrice, t.lotSize,
      t.pips, t.pnl != null ? `$${Number(t.pnl).toFixed(2)}` : "",
      t.riskPct != null ? `${t.riskPct}%` : "",
      t.session ?? "", t.tags ?? "", t.notes ?? "",
    ]);

    const tableRows = rows.map((r) =>
      `<tr>${r.map((cell, i) => {
        const val = String(cell ?? "");
        const color = i === 1 ? (val === "BUY" ? "color:#22c55e" : val === "SELL" ? "color:#ef4444" : "") :
                      i === 2 ? (val === "WIN" ? "color:#22c55e" : val === "LOSS" ? "color:#ef4444" : "") :
                      i === 8 ? (Number(String(cell).replace("$","")) > 0 ? "color:#22c55e" : Number(String(cell).replace("$","")) < 0 ? "color:#ef4444" : "") : "";
        return `<td style="${color}">${val}</td>`;
      }).join("")}</tr>`
    ).join("");

    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"/>
<title>XAUUSD Trade Log — ${date}</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:'Segoe UI',Arial,sans-serif;background:#fff;color:#111;padding:28px 32px}
  h1{font-size:18px;font-weight:700;margin-bottom:2px;letter-spacing:.5px}
  .sub{font-size:11px;color:#666;margin-bottom:18px}
  table{width:100%;border-collapse:collapse;font-size:10.5px}
  th{background:#17181C;color:#F59E0B;font-weight:600;padding:6px 8px;text-align:left;border-bottom:2px solid #F59E0B;white-space:nowrap}
  td{padding:5px 8px;border-bottom:1px solid #e5e7eb;vertical-align:top;word-break:break-word}
  tr:nth-child(even) td{background:#f9fafb}
  @media print{body{padding:12px 16px}h1{font-size:15px}}
</style></head><body>
<h1>XAUUSD Terminal — Trade Log</h1>
<div class="sub">Exported ${date} · ${rows.length} trade${rows.length !== 1 ? "s" : ""}</div>
<table><thead><tr>${headers.map((h) => `<th>${h}</th>`).join("")}</tr></thead>
<tbody>${tableRows}</tbody></table>
</body></html>`;

    const blob = new Blob([html], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `XAUUSD-Trade-Log-${date}.html`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  return (
    <AppLayout>
      <div className="container mx-auto p-4 lg:p-8 flex-1 flex flex-col relative">
        <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
          <h1 className="text-2xl font-bold text-white tracking-tight">Trade Log</h1>
          <div className="flex gap-2">
            <Button variant="outline" onClick={downloadPdf} disabled={!filteredTrades.length} className="border-border text-slate-300 gap-2">
              <Download className="w-4 h-4" /> Export PDF
            </Button>
            <Button onClick={openNewTrade} className="bg-primary text-black hover:bg-amber-400 font-semibold gap-2">
              <Plus className="w-4 h-4" /> Log Trade
            </Button>
          </div>
        </div>

        {/* Filter bar */}
        <div className="flex flex-wrap gap-3 mb-4 items-center">
          <div className="relative min-w-[220px] flex-1">
            <Search className="w-4 h-4 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search notes, tags, direction…"
              className="w-full rounded-md border border-border bg-card pl-9 pr-3 py-2 text-sm text-white outline-none focus:ring-1 focus:ring-primary" />
          </div>
          <select value={tagFilter} onChange={(e) => setTagFilter(e.target.value)}
            className="rounded-md border border-border bg-card px-3 py-2 text-sm text-slate-300 outline-none">
            <option value="All">All tags</option>
            {availableTags.map((tag) => <option key={tag} value={tag}>{tag}</option>)}
          </select>
          <select value={sessionFilter} onChange={(e) => setSessionFilter(e.target.value)}
            className="rounded-md border border-border bg-card px-3 py-2 text-sm text-slate-300 outline-none">
            <option value="All">All sessions</option>
            {["Asia", "London", "New York"].map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          {isAnyFilterActive && (
            <Button variant="ghost" size="sm" onClick={resetFilters}
              className="gap-1.5 text-xs text-muted-foreground hover:text-white border border-border/50 hover:border-border">
              <RotateCcw className="w-3.5 h-3.5" /> Reset Filters
            </Button>
          )}
        </div>

        {/* ── MOBILE CARD VIEW (< md) ── */}
        <div className="flex flex-col gap-3 md:hidden">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <div className="text-xs font-mono text-muted-foreground uppercase tracking-widest animate-pulse">Loading trades…</div>
            </div>
          ) : !filteredTrades.length ? (
            <div className="text-center text-muted-foreground py-12 font-mono text-sm">
              {trades?.length ? "No trades match the current filters" : "No trades logged yet"}
            </div>
          ) : pagedTrades.map((trade) => {
            const isWin = trade.status === 'TP Hit' || (trade.pnl != null && Number(trade.pnl) > 0);
            const isLoss = trade.status === 'SL Hit' || (trade.pnl != null && Number(trade.pnl) < 0);
            const isPending = trade.status === 'Pending';
            const isRunning = trade.status === 'Running';
            const accentColor = isWin ? '#22c55e' : isLoss ? '#ef4444' : isRunning ? '#3b82f6' : '#64748b';
            const isLong = trade.direction === 'Long';
            return (
            <div key={trade.id} style={{
              background: 'linear-gradient(145deg, #1a1f2e 0%, #1e2435 100%)',
              borderRadius: '14px',
              border: `1px solid ${accentColor}28`,
              boxShadow: `0 0 0 0.5px ${accentColor}18, 0 4px 24px rgba(0,0,0,0.45)`,
              overflow: 'hidden',
              position: 'relative',
            }}>
              {/* Glow blob */}
              <div style={{
                position: 'absolute', top: '-40px', right: '-40px',
                width: '140px', height: '140px', borderRadius: '50%',
                background: `radial-gradient(circle, ${accentColor}18, transparent 70%)`,
                pointerEvents: 'none',
              }} />
              {/* Accent top bar */}
              <div style={{ height: '2px', background: `linear-gradient(90deg, ${accentColor}00, ${accentColor}cc, ${accentColor}00)` }} />

              <div className="p-4 space-y-3 relative">
                {/* Row 1: header */}
                <div className="flex items-start justify-between gap-2">
                  <div className="flex flex-col gap-1">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-[11px] text-slate-500 tracking-widest uppercase">{formatTradeDate(trade.tradeDate)}</span>
                      {trade.session && (
                        <span className="text-[9px] font-mono text-slate-600 uppercase tracking-widest border border-slate-700/50 rounded px-1.5 py-0.5">{trade.session}</span>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <span style={{
                        fontSize: '11px', fontWeight: '700', letterSpacing: '0.08em',
                        padding: '2px 10px', borderRadius: '999px',
                        background: isLong ? 'rgba(34,197,94,0.12)' : 'rgba(239,68,68,0.12)',
                        border: `1px solid ${isLong ? 'rgba(34,197,94,0.35)' : 'rgba(239,68,68,0.35)'}`,
                        color: isLong ? '#22c55e' : '#ef4444',
                        fontFamily: 'monospace',
                      }}>
                        {isLong ? '▲ LONG' : '▼ SHORT'}
                      </span>
                      <span style={{
                        fontSize: '10px', fontWeight: '700', letterSpacing: '0.1em',
                        padding: '2px 10px', borderRadius: '999px',
                        background: `${accentColor}14`,
                        border: `1px solid ${accentColor}45`,
                        color: accentColor,
                        fontFamily: 'monospace',
                        textTransform: 'uppercase',
                      }}>
                        {trade.status}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0 mt-0.5">
                    {confirmingDeleteId === trade.id ? (
                      <>
                        <Button size="sm" variant="destructive" className="h-7 px-2 text-xs"
                          onClick={() => handleDeleteTrade(trade)} disabled={deleteTrade.isPending}>
                          {deleteTrade.isPending ? "…" : "Yes"}
                        </Button>
                        <Button size="sm" variant="ghost" className="h-7 px-2 text-xs"
                          onClick={() => setConfirmingDeleteId(null)}>No</Button>
                      </>
                    ) : (
                      <>
                        <Button size="icon" variant="ghost" className="h-7 w-7 hover:bg-primary/10" onClick={() => openEditTrade(trade)}>
                          <Pencil className="w-3.5 h-3.5 text-primary" />
                        </Button>
                        <Button size="icon" variant="ghost" className="h-7 w-7 hover:bg-amber-500/10" onClick={() => setSharingTrade(trade)}>
                          <Share2 className="w-3.5 h-3.5 text-amber-500" />
                        </Button>
                        <Button size="icon" variant="ghost" className="h-7 w-7 hover:bg-red-500/10" onClick={() => setConfirmingDeleteId(trade.id)}>
                          <Trash2 className="w-3.5 h-3.5 text-red-500" />
                        </Button>
                      </>
                    )}
                  </div>
                </div>

                {/* Row 2: PnL hero + pips + risk */}
                <div style={{
                  background: 'rgba(255,255,255,0.03)',
                  border: '1px solid rgba(255,255,255,0.06)',
                  borderRadius: '10px',
                  padding: '12px',
                  display: 'grid',
                  gridTemplateColumns: '1fr 1px 1fr 1px 1fr',
                  gap: '0',
                  alignItems: 'center',
                }}>
                  <div className="text-center">
                    <div className="text-[8px] font-mono uppercase tracking-[0.15em] text-slate-500 mb-1">P / L</div>
                    <div style={{
                      fontFamily: 'monospace', fontWeight: '800', fontSize: '18px',
                      color: trade.pnl == null ? '#475569' : Number(trade.pnl) >= 0 ? '#22c55e' : '#ef4444',
                      textShadow: trade.pnl != null ? `0 0 16px ${Number(trade.pnl) >= 0 ? 'rgba(34,197,94,0.35)' : 'rgba(239,68,68,0.35)'}` : 'none',
                      letterSpacing: '-0.01em',
                    }}>
                      {trade.pnl != null ? `${Number(trade.pnl) >= 0 ? '+' : ''}$${formatTradeNumber(trade.pnl)}` : '—'}
                    </div>
                  </div>
                  <div style={{ width: '1px', height: '32px', background: 'rgba(255,255,255,0.07)', margin: '0 auto' }} />
                  <div className="text-center">
                    <div className="text-[8px] font-mono uppercase tracking-[0.15em] text-slate-500 mb-1">Pips</div>
                    <div style={{
                      fontFamily: 'monospace', fontWeight: '700', fontSize: '15px',
                      color: trade.pips == null ? '#475569' : Number(trade.pips) >= 0 ? '#22c55e' : '#ef4444',
                    }}>
                      {trade.pips != null ? `${Number(trade.pips) > 0 ? '+' : ''}${formatTradeNumber(trade.pips)}` : '—'}
                    </div>
                  </div>
                  <div style={{ width: '1px', height: '32px', background: 'rgba(255,255,255,0.07)', margin: '0 auto' }} />
                  <div className="text-center">
                    <div className="text-[8px] font-mono uppercase tracking-[0.15em] text-slate-500 mb-1">Risk</div>
                    <div style={{ fontFamily: 'monospace', fontWeight: '600', fontSize: '13px', color: '#94a3b8' }}>
                      {trade.riskPct != null ? `${formatTradeNumber(trade.riskPct)}%` : '—'}
                    </div>
                  </div>
                </div>

                {/* Row 3: prices grid */}
                {(trade.entryPrice != null || trade.slPrice != null || trade.tpPrice != null) && (
                  <div className="grid grid-cols-3 gap-1.5">
                    {[
                      { label: 'Entry', value: trade.entryPrice, color: '#e2e8f0' },
                      { label: 'SL', value: trade.slPrice, color: '#f87171' },
                      { label: 'TP', value: trade.tpPrice, color: '#4ade80' },
                    ].map(({ label, value, color }) => (
                      <div key={label} style={{
                        background: 'rgba(255,255,255,0.025)',
                        border: '1px solid rgba(255,255,255,0.05)',
                        borderRadius: '8px',
                        padding: '7px 6px',
                        textAlign: 'center',
                      }}>
                        <div style={{ fontSize: '8px', fontFamily: 'monospace', textTransform: 'uppercase', letterSpacing: '0.14em', color: '#475569', marginBottom: '3px' }}>{label}</div>
                        <div style={{ fontSize: '11px', fontFamily: 'monospace', fontWeight: '600', color: value != null ? color : '#334155' }}>
                          {value != null ? formatTradeNumber(value) : '—'}
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* Row 4: lots / close / tags */}
                {(trade.lotSize != null || trade.closePrice != null || trade.tags || trade.notes) && (
                  <div style={{ borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: '10px' }}
                    className="flex flex-wrap gap-x-4 gap-y-1 text-[10px] font-mono">
                    {trade.lotSize != null && <span className="text-slate-500">Lots <span className="text-slate-300">{formatTradeNumber(trade.lotSize)}</span></span>}
                    {trade.closePrice != null && <span className="text-slate-500">Close <span className="text-slate-300">{formatTradeNumber(trade.closePrice)}</span></span>}
                    {trade.balance != null && <span className="text-slate-500">Bal <span className="text-slate-300">${formatTradeNumber(trade.balance)}</span></span>}
                    {trade.tags && <span style={{ color: '#f59e0b99' }}>{trade.tags}</span>}
                    {trade.notes && <span className="text-slate-600 italic truncate max-w-full">{trade.notes}</span>}
                  </div>
                )}
              </div>
            </div>
            );
          })}
        </div>

        {/* ── DESKTOP TABLE VIEW (≥ md) ── */}
        <div className="hidden md:block bg-card border border-border rounded-xl overflow-x-auto">
          <Table className="min-w-[1200px]">
            <TableHeader>
              <TableRow className="border-border hover:bg-transparent">
                <TableHead className="font-mono text-xs uppercase tracking-widest text-muted-foreground">Date</TableHead>
                <TableHead className="font-mono text-xs uppercase tracking-widest text-muted-foreground">Balance</TableHead>
                <TableHead className="font-mono text-xs uppercase tracking-widest text-muted-foreground">Risk %</TableHead>
                <TableHead className="font-mono text-xs uppercase tracking-widest text-muted-foreground">Entry</TableHead>
                <TableHead className="font-mono text-xs uppercase tracking-widest text-muted-foreground">SL</TableHead>
                <TableHead className="font-mono text-xs uppercase tracking-widest text-muted-foreground">LOT SIZE</TableHead>
                <TableHead className="font-mono text-xs uppercase tracking-widest text-muted-foreground">Direction</TableHead>
                <TableHead className="font-mono text-xs uppercase tracking-widest text-muted-foreground">Status</TableHead>
                <TableHead className="font-mono text-xs uppercase tracking-widest text-muted-foreground">Close</TableHead>
                <TableHead className="font-mono text-xs uppercase tracking-widest text-muted-foreground">Pips</TableHead>
                <TableHead className="font-mono text-xs uppercase tracking-widest text-muted-foreground">Trade P/L</TableHead>
                <TableHead className="font-mono text-xs uppercase tracking-widest text-muted-foreground">Tags</TableHead>
                <TableHead className="font-mono text-xs uppercase tracking-widest text-muted-foreground">Session</TableHead>
                <TableHead className="w-20" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableLoader colSpan={14} />
              ) : !filteredTrades.length ? (
                <TableRow>
                  <TableCell colSpan={14} className="text-center text-muted-foreground py-12 font-mono">
                    {trades?.length ? "No trades match the current filters" : "No trades logged yet"}
                  </TableCell>
                </TableRow>
              ) : (
                pagedTrades.map((trade) => (
                  <TableRow key={trade.id} className="border-border hover:bg-secondary/30">
                    <TableCell className="font-mono text-sm text-slate-300">{formatTradeDate(trade.tradeDate)}</TableCell>
                    <TableCell className="font-mono text-sm text-slate-300">{formatTradeNumber(trade.balance)}</TableCell>
                    <TableCell className="font-mono text-sm text-slate-300">{formatTradeNumber(trade.riskPct)}</TableCell>
                    <TableCell className="font-mono text-sm text-slate-300">{formatTradeNumber(trade.entryPrice)}</TableCell>
                    <TableCell className="font-mono text-sm text-slate-300">{formatTradeNumber(trade.slPrice)}</TableCell>
                    <TableCell className="font-mono text-sm text-slate-300">{formatTradeNumber(trade.lotSize)}</TableCell>
                    <TableCell>
                      <span className={cn("text-xs font-mono font-bold px-2 py-0.5 rounded",
                        trade.direction === 'Long' ? "bg-green-500/10 text-green-500" : "bg-red-500/10 text-red-500")}>
                        {trade.direction}
                      </span>
                    </TableCell>
                    <TableCell>
                      <span className={cn("text-xs font-mono font-bold px-2 py-1 rounded border",
                        trade.status === 'Running'  && "bg-blue-500/10 border-blue-500/20 text-blue-500",
                        trade.status === 'TP Hit'   && "bg-green-500/10 border-green-500/20 text-green-500",
                        trade.status === 'SL Hit'   && "bg-red-500/10 border-red-500/20 text-red-500",
                        trade.status === 'Pending'  && "bg-slate-500/10 border-slate-500/20 text-slate-400")}>
                        {trade.status}
                      </span>
                    </TableCell>
                    <TableCell className="font-mono text-sm text-slate-300">{formatTradeNumber(trade.closePrice)}</TableCell>
                    <TableCell className={cn("font-mono text-sm font-bold",
                      (trade.pips || 0) > 0 ? "text-green-500" : (trade.pips || 0) < 0 ? "text-red-500" : "text-slate-400")}>
                      {trade.pips != null ? `${trade.pips > 0 ? '+' : ''}${formatTradeNumber(trade.pips)}` : '-'}
                    </TableCell>
                    <TableCell className={cn("font-mono text-sm font-bold",
                      (trade.pnl || 0) > 0 ? "text-green-500" : (trade.pnl || 0) < 0 ? "text-red-500" : "text-slate-400")}>
                      {trade.pnl != null ? `$${formatTradeNumber(trade.pnl)}` : "-"}
                    </TableCell>
                    <TableCell className="font-mono text-xs text-slate-400 max-w-[140px] truncate">{trade.tags || "-"}</TableCell>
                    <TableCell className="font-mono text-xs text-slate-400">{trade.session || "-"}</TableCell>
                    <TableCell>
                      {confirmingDeleteId === trade.id ? (
                        <div className="flex items-center gap-1">
                          <Button size="sm" variant="destructive" className="h-6 px-2 text-xs"
                            onClick={() => handleDeleteTrade(trade)} disabled={deleteTrade.isPending}>
                            {deleteTrade.isPending ? "…" : "Yes"}
                          </Button>
                          <Button size="sm" variant="ghost" className="h-6 px-2 text-xs"
                            onClick={() => setConfirmingDeleteId(null)}>No</Button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-1">
                          <Button size="icon" variant="ghost" className="h-7 w-7 hover:bg-primary/10" onClick={() => openEditTrade(trade)}>
                            <Pencil className="w-3.5 h-3.5 text-primary" />
                          </Button>
                          <Button size="icon" variant="ghost" className="h-7 w-7 hover:bg-amber-500/10"
                            onClick={() => setSharingTrade(trade)}>
                            <Share2 className="w-3.5 h-3.5 text-amber-500" />
                          </Button>
                          <Button size="icon" variant="ghost" className="h-7 w-7 hover:bg-red-500/10"
                            onClick={() => setConfirmingDeleteId(trade.id)}>
                            <Trash2 className="w-3.5 h-3.5 text-red-500" />
                          </Button>
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="w-[95vw] sm:max-w-[620px] border-border bg-card max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-white font-mono tracking-tight uppercase">
              {editingTrade ? 'Update Record' : 'New Record'}
            </DialogTitle>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 py-4">
              <div className="grid grid-cols-2 gap-4">
                <FormField control={form.control} name="tradeDate" render={({ field }) => (
                  <FormItem>
                    <FormLabel className="font-mono text-xs uppercase tracking-widest text-muted-foreground">Date</FormLabel>
                    <FormControl><Input type="date" className="font-mono bg-input" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="balance" render={({ field }) => (
                  <FormItem>
                    <FormLabel className="font-mono text-xs uppercase tracking-widest text-muted-foreground">Balance</FormLabel>
                    <FormControl><Input type="number" step="0.01" className="font-mono bg-input" placeholder="e.g. 10000" {...field} value={field.value ?? ''} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="riskPct" render={({ field }) => (
                  <FormItem>
                    <FormLabel className="font-mono text-xs uppercase tracking-widest text-muted-foreground">Risk %</FormLabel>
                    <FormControl><Input type="number" step="0.01" min="0" className="font-mono bg-input" placeholder="e.g. 1" {...field} value={field.value ?? ''} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="direction" render={({ field }) => {
                  const hasEntryAndSL = watchedEntry && watchedSL &&
                    !isNaN(Number(watchedEntry)) && !isNaN(Number(watchedSL)) &&
                    Number(watchedEntry) !== Number(watchedSL);
                  return (
                    <FormItem>
                      <FormLabel className="font-mono text-xs uppercase tracking-widest text-muted-foreground flex items-center gap-1.5">
                        Direction <span className="text-[10px] text-primary/70 normal-case font-normal flex items-center gap-0.5"><Zap className="w-2.5 h-2.5" /> auto</span>
                      </FormLabel>
                      {hasEntryAndSL ? (
                        <div className="flex h-10 items-center rounded-md border border-primary/30 bg-primary/5 px-3 font-mono text-sm text-primary">
                          {field.value === TradeDirection.Long ? "Long ↑" : "Short ↓"}
                        </div>
                      ) : (
                        <div className="flex h-10 items-center rounded-md border border-border bg-secondary/20 px-3 font-mono text-xs text-muted-foreground/50">
                        </div>
                      )}
                      <FormMessage />
                    </FormItem>
                  );
                }} />
                <FormField control={form.control} name="entryPrice" render={({ field }) => (
                  <FormItem>
                    <FormLabel className="font-mono text-xs uppercase tracking-widest text-muted-foreground">Entry Price</FormLabel>
                    <FormControl><Input type="number" step="0.01" className="font-mono bg-input" placeholder="e.g. 3320.00" {...field} value={field.value ?? ''} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="lotSize" render={({ field }) => (
                  <FormItem>
                    <FormLabel className="font-mono text-xs uppercase tracking-widest text-muted-foreground">Lots</FormLabel>
                    <FormControl><Input type="number" step="0.01" className="font-mono bg-input" {...field} value={field.value ?? ''} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="slPrice" render={({ field }) => (
                  <FormItem>
                    <FormLabel className="font-mono text-xs uppercase tracking-widest text-muted-foreground">Stop Loss</FormLabel>
                    <FormControl><Input type="number" step="0.01" className="font-mono bg-input" placeholder="e.g. 3310.00" {...field} value={field.value ?? ''} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="tpPrice" render={({ field }) => (
                  <FormItem>
                    <FormLabel className="font-mono text-xs uppercase tracking-widest text-muted-foreground">Take Profit</FormLabel>
                    <FormControl><Input type="number" step="0.01" className="font-mono bg-input" placeholder="e.g. 3340.00" {...field} value={field.value ?? ''} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="status" render={({ field }) => (
                  <FormItem>
                    <FormLabel className="font-mono text-xs uppercase tracking-widest text-muted-foreground flex items-center gap-1.5">
                      Status <span className="text-[10px] text-primary/70 normal-case font-normal flex items-center gap-0.5"><Zap className="w-2.5 h-2.5" /> auto</span>
                    </FormLabel>
                    <div className="flex h-10 items-center rounded-md border border-primary/30 bg-primary/5 px-3 font-mono text-sm text-primary">
                      {field.value}
                    </div>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="closePrice" render={({ field }) => (
                  <FormItem>
                    <FormLabel className="font-mono text-xs uppercase tracking-widest text-muted-foreground">
                      Close Price <span className="text-muted-foreground/50 normal-case">(auto-calc)</span>
                    </FormLabel>
                    <FormControl><Input type="number" step="0.01" className="font-mono bg-input" placeholder="Leave blank if open" {...field} value={field.value ?? ''} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <FormField control={form.control} name="tags" render={({ field }) => (
                  <FormItem>
                    <FormLabel className="font-mono text-xs uppercase tracking-widest text-muted-foreground">Tags</FormLabel>
                    <FormControl><Input className="font-mono bg-input" placeholder="Scalp, News" {...field} value={field.value ?? ''} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="session" render={({ field }) => (
                  <FormItem>
                    <FormLabel className="font-mono text-xs uppercase tracking-widest text-muted-foreground flex items-center gap-1.5">
                      Session <Zap className="w-2.5 h-2.5 text-primary/70" />
                    </FormLabel>
                    <div className="flex h-10 items-center rounded-md border border-primary/30 bg-primary/5 px-3 font-mono text-sm text-primary">
                      {field.value || getAutoSession()}
                    </div>
                    <FormMessage />
                  </FormItem>
                )} />
              </div>

              {watchedClose && autoPips !== null && (
                <div className="grid grid-cols-2 gap-3 p-3 bg-primary/5 border border-primary/20 rounded-lg">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground font-mono uppercase tracking-widest">Pips</span>
                    <span className={cn("text-sm font-bold font-mono", autoPips >= 0 ? "text-green-500" : "text-red-500")}>
                      {autoPips >= 0 ? "+" : ""}{autoPips.toFixed(1)}
                    </span>
                  </div>
                  {autoPnl !== null && (
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-muted-foreground font-mono uppercase tracking-widest">P/L</span>
                      <span className={cn("text-sm font-bold font-mono", autoPnl >= 0 ? "text-green-500" : "text-red-500")}>
                        {autoPnl >= 0 ? "+$" : "-$"}{Math.abs(autoPnl).toFixed(2)}
                      </span>
                    </div>
                  )}
                </div>
              )}

              <FormField control={form.control} name="notes" render={({ field }) => (
                <FormItem>
                  <FormLabel className="font-mono text-xs uppercase tracking-widest text-muted-foreground">Notes</FormLabel>
                  <FormControl><Input className="bg-input" {...field} value={field.value ?? ''} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />

              {/* Mistake Journal — only shown when SL Hit */}
              {isSLHit && (
                <FormField control={form.control} name="lossReason" render={({ field }) => (
                  <FormItem>
                    <FormLabel className="font-mono text-xs uppercase tracking-widest text-red-400 flex items-center gap-1.5">
                      📓 Loss Reason <span className="text-muted-foreground normal-case text-[10px] font-normal">(Mistake Journal)</span>
                    </FormLabel>
                    <select
                      value={field.value ?? ""}
                      onChange={(e) => field.onChange(e.target.value || null)}
                      className="w-full rounded-md border border-red-500/30 px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-red-500/50 font-mono"
                      style={{ backgroundColor: "#1C1D22", color: "#e2e8f0" }}
                    >
                      <option value="" style={{ backgroundColor: "#1C1D22", color: "#94a3b8" }}>— Select reason —</option>
                      {LOSS_REASONS.map((r) => (
                        <option key={r} value={r} style={{ backgroundColor: "#1C1D22", color: "#e2e8f0" }}>{r}</option>
                      ))}
                    </select>
                    <FormMessage />
                  </FormItem>
                )} />
              )}

              <DialogFooter className="mt-6 pt-4 border-t border-border">
                <Button type="button" variant="outline" onClick={() => setIsDialogOpen(false)} className="border-border text-slate-300">
                  Cancel
                </Button>
                <Button type="submit" disabled={createTrade.isPending || updateTrade.isPending} className="bg-primary text-black hover:bg-amber-400 font-semibold gap-2">
                  {(createTrade.isPending || updateTrade.isPending) ? (
                    <>{editingTrade ? 'Saving…' : 'Committing…'}</>
                  ) : (
                    <><CheckCircle2 className="w-4 h-4" />{editingTrade ? 'Update' : 'Commit'} Record</>
                  )}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      {/* ── PAGINATION ── */}
      {!isLoading && filteredTrades.length > PAGE_SIZE && (
        <div className="flex items-center justify-between mt-4 px-1">
          <span className="text-xs font-mono text-muted-foreground">
            {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, filteredTrades.length)} of {filteredTrades.length} trades
          </span>
          <div className="flex items-center gap-1">
            <Button
              variant="outline" size="sm"
              className="h-7 w-7 p-0 border-border text-slate-300 disabled:opacity-30"
              disabled={page === 0}
              onClick={() => goTo(page - 1)}
            >
              <ChevronLeft className="w-3.5 h-3.5" />
            </Button>
            {Array.from({ length: totalPages }, (_, i) => i)
              .filter(i => Math.abs(i - page) <= 2)
              .map(i => (
                <Button
                  key={i}
                  variant={i === page ? "default" : "outline"}
                  size="sm"
                  className={cn(
                    "h-7 w-7 p-0 text-xs font-mono border-border",
                    i === page ? "bg-primary text-black" : "text-slate-300"
                  )}
                  onClick={() => goTo(i)}
                >
                  {i + 1}
                </Button>
              ))}
            <Button
              variant="outline" size="sm"
              className="h-7 w-7 p-0 border-border text-slate-300 disabled:opacity-30"
              disabled={page >= totalPages - 1}
              onClick={() => goTo(page + 1)}
            >
              <ChevronRight className="w-3.5 h-3.5" />
            </Button>
          </div>
        </div>
      )}

      {/* ── TRADE SHARE CARD ── */}
      {sharingTrade && (
        <TradeShareCard
          trade={sharingTrade}
          open={!!sharingTrade}
          onClose={() => setSharingTrade(null)}
        />
      )}

        {/* ── LOCK OVERLAY — shown when no investment capital set ── */}
        {!hasBalance && (
          <div className="absolute inset-0 z-20 backdrop-blur-sm bg-background/60 flex items-center justify-center">
            <div className="flex flex-col items-center gap-2 px-6 py-5 rounded-lg border border-border bg-card/90 shadow-lg text-center">
              <Lock className="w-5 h-5 text-primary" />
              <p className="text-xs font-mono text-muted-foreground uppercase tracking-widest leading-relaxed">
                Investment Capital dao<br />
                <span className="text-primary/80">Investors</span> page theke set koro
              </p>
            </div>
          </div>
        )}
    </AppLayout>
  );
}
